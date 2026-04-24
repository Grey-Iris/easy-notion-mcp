import { spawn, execSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { blocksToMarkdown } from "../../../src/blocks-to-markdown.ts";
import {
  getDatabase as notionGetDatabase,
  getMe,
  listChildren,
  listComments as notionListComments,
  listUsers as notionListUsers,
  queryDatabase as notionQueryDatabase,
} from "../../../src/notion-client.ts";
import {
  mintBearer,
  pickEphemeralPort,
  spawnHttpServer,
  type HttpHandle,
} from "../../e2e/helpers/http-server.ts";
import { buildRunContext } from "../../e2e/helpers/run-context.ts";
import { buildMcpConfig, parseStreamJson } from "./dispatch.ts";
import { buildManifest, sha256Hex, writeManifest } from "./manifest.ts";
import type {
  AssertContext,
  AssertResult,
  Scenario,
  ScenarioResult,
  TranscriptData,
  VerifyResult,
} from "./types.ts";
import { verifyGroundTruth, type SdkContext } from "./verifier.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const FRAMEWORK_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
const SUCCESS_EXIT_CODE = 0;
const NOTION_RETRY_ATTEMPTS = 3;
const NOTION_RETRY_BACKOFF_MS = 2_000;

type PageSummary = Awaited<ReturnType<SdkContext["findChildPages"]>>[number];
type DatabaseSummary = Awaited<ReturnType<SdkContext["findChildDatabases"]>>[number];

export interface RunnerResult {
  exitCode: 0 | 1 | 2;
  runId?: string;
  manifestPath?: string;
  scenarios: ScenarioResult[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withNotionRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NOTION_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < NOTION_RETRY_ATTEMPTS) {
        await delay(NOTION_RETRY_BACKOFF_MS);
      }
    }
  }

  throw new Error(
    `${label} failed after ${NOTION_RETRY_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPageTitle(page: unknown): string {
  if (!isRecord(page) || !isRecord(page.properties)) {
    return "";
  }

  for (const property of Object.values(page.properties)) {
    if (!isRecord(property) || property.type !== "title" || !Array.isArray(property.title)) {
      continue;
    }

    return property.title
      .map((item) => {
        if (!isRecord(item)) {
          return "";
        }
        if (typeof item.plain_text === "string") {
          return item.plain_text;
        }
        if (isRecord(item.text) && typeof item.text.content === "string") {
          return item.text.content;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function mapDatabaseSummary(database: Awaited<ReturnType<typeof notionGetDatabase>>): DatabaseSummary {
  return {
    id: database.id,
    title: database.title,
    properties: Object.fromEntries(
      database.properties.map((property) => [property.name, { type: property.type }]),
    ),
  };
}

function richTextArrayToString(value: unknown): string {
  return Array.isArray(value)
    ? value
      .map((item) => {
        if (!isRecord(item)) {
          return "";
        }
        if (typeof item.plain_text === "string") {
          return item.plain_text;
        }
        if (isRecord(item.text) && typeof item.text.content === "string") {
          return item.text.content;
        }
        return "";
      })
      .join("")
    : "";
}

function attachChildren(block: Record<string, unknown>, children: unknown[]): void {
  const blockType = typeof block.type === "string" ? block.type : "";
  if (!blockType || !isRecord(block[blockType])) {
    return;
  }
  (block[blockType] as Record<string, unknown>).children = children;
}

async function fetchBlocksRecursive(client: Client, blockId: string): Promise<Record<string, unknown>[]> {
  const blocks = await withNotionRetry(
    `blocks.children.list(${blockId})`,
    () => listChildren(client, blockId),
  );
  const results: Record<string, unknown>[] = [];

  for (const block of blocks as Record<string, unknown>[]) {
    if (block.has_children === true && typeof block.id === "string") {
      const children = await fetchBlocksRecursive(client, block.id);
      attachChildren(block, children);
    }
    results.push(block);
  }

  return results;
}

function createSdkContext(client: Client): SdkContext {
  return {
    listUsers: async () => {
      const users = await withNotionRetry("listUsers", () => notionListUsers(client));
      return users.map((user: any) => ({
        id: user.id,
        type: user.type,
        name: user.name ?? undefined,
      }));
    },
    findChildPages: async (parentId: string) => {
      const children = await withNotionRetry(
        `listChildren(${parentId})`,
        () => listChildren(client, parentId),
      );
      const pages: PageSummary[] = [];

      for (const child of children as any[]) {
        if (child.type !== "child_page") {
          continue;
        }

        const page = await withNotionRetry(
          `pages.retrieve(${child.id})`,
          () => client.pages.retrieve({ page_id: child.id }),
        );
        pages.push({
          id: child.id,
          title: extractPageTitle(page),
          icon: (page as any).icon ?? undefined,
          cover: (page as any).cover ?? undefined,
        });
      }

      return pages;
    },
    findChildDatabases: async (parentId: string) => {
      const children = await withNotionRetry(
        `listChildren(${parentId})`,
        () => listChildren(client, parentId),
      );
      const databases: DatabaseSummary[] = [];

      for (const child of children as any[]) {
        if (child.type !== "child_database") {
          continue;
        }

        const database = await withNotionRetry(
          `getDatabase(${child.id})`,
          () => notionGetDatabase(client, child.id),
        );
        databases.push(mapDatabaseSummary(database));
      }

      return databases;
    },
    getPageContent: async (pageId: string) => {
      const blocks = await fetchBlocksRecursive(client, pageId);
      return blocksToMarkdown(blocks as any);
    },
    queryDatabase: async (databaseId: string, filter?: Record<string, unknown>) => {
      const rows = await withNotionRetry(
        `queryDatabase(${databaseId})`,
        () => notionQueryDatabase(client, databaseId, filter),
      );
      return rows.map((row: any) => ({
        id: row.id,
        properties: row.properties ?? {},
      }));
    },
    listComments: async (pageId: string) => {
      const comments = await withNotionRetry(
        `listComments(${pageId})`,
        () => notionListComments(client, pageId),
      );
      return comments.map((comment: any) => ({
        id: comment.id,
        authorType: comment.created_by?.type ?? "",
        body: richTextArrayToString(comment.rich_text),
      }));
    },
    getDatabase: async (databaseId: string) => {
      const database = await withNotionRetry(
        `getDatabase(${databaseId})`,
        () => notionGetDatabase(client, databaseId),
      );
      return mapDatabaseSummary(database);
    },
  };
}

function formatIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function gitValue(command: string, fallback: string): string {
  try {
    const value = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function scenarioTimeoutMs(maxUsd: number): number {
  const raw = Math.round(maxUsd * 600_000);
  return Math.min(300_000, Math.max(60_000, raw));
}

function failureVerification(claim: string, message: string): VerifyResult {
  return {
    passed: false,
    claims: [
      {
        passed: false,
        claim,
        message,
      },
    ],
    warnings: [],
  };
}

function emptyTranscript(): TranscriptData {
  return {
    toolUses: [],
    toolResults: [],
    result: null,
    model: null,
    events: [],
  };
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(3)}`;
}

function renderTemplate<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === "string") {
    let rendered = value;
    for (const [key, replacement] of Object.entries(vars)) {
      rendered = rendered.replaceAll(`\${${key}}`, replacement);
    }
    return rendered as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, vars)) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, renderTemplate(entryValue, vars)]),
    ) as T;
  }

  return value;
}

function printSummary(results: ScenarioResult[], manifestPath?: string): void {
  if (results.length === 0) {
    console.log("No scenarios ran.");
    return;
  }

  const scenarioWidth = Math.max("Scenario".length, ...results.map((result) => result.id.length));
  const statusWidth = "Status".length;
  const durationWidth = "Duration".length;
  const costWidth = "Cost".length;

  const header = [
    "Scenario".padEnd(scenarioWidth),
    "Status".padEnd(statusWidth),
    "Duration".padEnd(durationWidth),
    "Cost".padEnd(costWidth),
  ].join("  ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const result of results) {
    console.log(
      [
        result.id.padEnd(scenarioWidth),
        result.status.toUpperCase().padEnd(statusWidth),
        formatDuration(result.durationMs).padEnd(durationWidth),
        formatCost(result.costUsd).padEnd(costWidth),
      ].join("  "),
    );
  }

  const totalCost = results.reduce((sum, result) => sum + result.costUsd, 0);
  const passedCount = results.filter((result) => result.status === "pass").length;
  const failedCount = results.filter((result) => result.status === "fail").length;
  const skippedCount = results.filter((result) => result.status === "skip").length;
  console.log("-".repeat(header.length));
  console.log(
    `Passed ${passedCount}, failed ${failedCount}, skipped ${skippedCount}, total cost ${formatCost(totalCost)}`,
  );

  if (manifestPath) {
    console.log(`Manifest: ${manifestPath}`);
  }
}

async function createBenchPage(client: Client, parentPageId: string, title: string): Promise<string> {
  const page = await withNotionRetry(
    `pages.create(${title})`,
    () =>
      client.pages.create({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: title } }],
          },
        },
      } as any),
  );

  return page.id;
}

async function runClaudeCommand(opts: {
  model: string;
  configPath: string;
  systemPromptPath: string;
  scenario: Scenario;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}> {
  const args = [
    "-p",
    "--model",
    opts.model,
    "--mcp-config",
    opts.configPath,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--max-budget-usd",
    String(opts.scenario.budget.max_usd),
    "--append-system-prompt-file",
    opts.systemPromptPath,
    opts.scenario.prompt,
  ];

  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child: ChildProcessWithoutNullStreams = spawn("claude", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    }, scenarioTimeoutMs(opts.scenario.budget.max_usd));

    const cleanup = () => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };

    const settle = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler();
    };

    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
    };

    const onStderr = (chunk: Buffer | string) => {
      stderr += chunk.toString();
    };

    const onError = (error: Error) => {
      settle(() => rejectPromise(error));
    };

    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      settle(() =>
        resolvePromise({
          stdout,
          stderr,
          exitCode,
          signal,
          timedOut,
        }),
      );
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  });
}

async function runScenarioAssert(
  scenario: Scenario,
  notion: Client,
  scenarioParentId: string,
  transcript: TranscriptData,
): Promise<AssertResult | null> {
  const assertPath = join(scenario.scenarioDir, "assert.ts");

  try {
    await access(assertPath);
  } catch {
    return null;
  }

  const mod = await import(pathToFileURL(assertPath).href);
  if (typeof mod.assert !== "function") {
    throw new Error(`Scenario assert file is missing an assert export: ${assertPath}`);
  }

  const ctx: AssertContext = {
    notion,
    scenarioParentId,
    transcript,
  };

  return mod.assert(ctx, transcript) as Promise<AssertResult>;
}

function mergeVerification(
  verification: VerifyResult,
  assertResult: AssertResult | null,
): VerifyResult {
  if (!assertResult) {
    return verification;
  }

  const claim = {
    claim: "assert.ts",
    passed: assertResult.passed,
    ...(assertResult.message ? { message: assertResult.message } : {}),
  };

  return {
    passed: verification.passed && assertResult.passed,
    claims: [...verification.claims, claim],
    warnings: [...verification.warnings],
  };
}

async function runScenario(opts: {
  scenario: Scenario;
  model: string;
  configPath: string;
  transcriptDirAbs: string;
  transcriptDirRel: string;
  systemPromptPath: string;
  sdkContext: SdkContext;
  notion: Client;
  scenarioParentId: string;
}): Promise<ScenarioResult> {
  if (opts.scenario.transport === "stdio") {
    return {
      id: opts.scenario.id,
      passed: true,
      status: "skip",
      durationMs: 0,
      costUsd: 0,
      transcript: emptyTranscript(),
      verification: {
        passed: true,
        claims: [],
        warnings: [],
      },
    };
  }

  const startedAt = Date.now();
  const transcriptPathRel = `${opts.transcriptDirRel}/scenario-${opts.scenario.id}.ndjson`;
  const transcriptPathAbs = join(opts.transcriptDirAbs, `scenario-${opts.scenario.id}.ndjson`);

  const commandResult = await runClaudeCommand({
    model: opts.model,
    configPath: opts.configPath,
    systemPromptPath: opts.systemPromptPath,
    scenario: opts.scenario,
  });

  const transcript = parseStreamJson(commandResult.stdout);
  await writeFile(transcriptPathAbs, commandResult.stdout, "utf8");

  const declarativeVerification =
    commandResult.timedOut
      ? failureVerification(
          "runner.timeout",
          `Timed out after ${formatDuration(scenarioTimeoutMs(opts.scenario.budget.max_usd))}`,
        )
      : commandResult.exitCode !== 0
        ? failureVerification(
            "runner.process_exit",
            [
              `claude exited with code ${commandResult.exitCode ?? "null"} and signal ${commandResult.signal ?? "null"}.`,
              commandResult.stderr.trim(),
            ]
              .filter((value) => value !== "")
              .join("\n"),
          )
        : await verifyGroundTruth(
            opts.scenario.ground_truth,
            transcript,
            opts.sdkContext,
            opts.scenarioParentId,
          ).catch((error) =>
            failureVerification(
              "runner.verification_error",
              error instanceof Error ? error.message : String(error),
            )
          );

  const verification =
    commandResult.exitCode === 0 && !commandResult.timedOut
      ? await runScenarioAssert(
          opts.scenario,
          opts.notion,
          opts.scenarioParentId,
          transcript,
        )
          .then((assertResult) => mergeVerification(declarativeVerification, assertResult))
          .catch((error) =>
            mergeVerification(
              declarativeVerification,
              {
                passed: false,
                message: error instanceof Error ? error.message : String(error),
              },
            ),
          )
      : declarativeVerification;

  const durationMs = Date.now() - startedAt;
  const costUsd = transcript.result?.costUsd ?? 0;
  const passed = commandResult.exitCode === 0 && !commandResult.timedOut && verification.passed;

  return {
    id: opts.scenario.id,
    passed,
    status: passed ? "pass" : "fail",
    durationMs,
    costUsd,
    transcript,
    verification,
    transcriptPath: transcriptPathRel,
    transcriptSha256: sha256Hex(commandResult.stdout),
  };
}

export async function runBenchHarness(scenarios: Scenario[]): Promise<RunnerResult> {
  const notionToken = process.env.NOTION_TOKEN;
  const rootPageId = process.env.BENCH_ROOT_PAGE_ID ?? process.env.E2E_ROOT_PAGE_ID;

  if (!notionToken) {
    console.error("NOTION_TOKEN is required for bench runs.");
    return {
      exitCode: FRAMEWORK_EXIT_CODE,
      scenarios: [],
    };
  }

  if (!rootPageId) {
    console.error("BENCH_ROOT_PAGE_ID or E2E_ROOT_PAGE_ID is required for bench runs.");
    return {
      exitCode: FRAMEWORK_EXIT_CODE,
      scenarios: [],
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "ANTHROPIC_API_KEY is not set. Continuing because Claude keychain auth may still work.",
    );
  }

  const harnessDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(harnessDir, "../../..");
  const systemPromptPath = resolve(repoRoot, "tests/bench/prompts/system-prefix.md");
  const runContext = await buildRunContext();
  const startedAtDate = runContext.startedAt;
  const startedAt = formatIso(startedAtDate);
  const datePart = startedAt.slice(0, 10);
  const runId = `run-${datePart}-${runContext.shortSha}`;
  const manifestPathRel = `.meta/bench/runs/${runId}.manifest.json`;
  const manifestPathAbs = resolve(repoRoot, manifestPathRel);
  const transcriptDirRel = `.meta/bench/transcripts/${runId}`;
  const transcriptDirAbs = resolve(repoRoot, transcriptDirRel);
  const runsDirAbs = resolve(repoRoot, ".meta/bench/runs");
  const model = process.env.BENCH_MODEL ?? DEFAULT_MODEL;
  const gitSha = gitValue("git rev-parse HEAD", runContext.shortSha);
  const gitBranch = gitValue("git rev-parse --abbrev-ref HEAD", "unknown");
  const notion = new Client({ auth: notionToken });
  const sdkContext = createSdkContext(notion);

  let handle: HttpHandle | undefined;
  let tempDir: string | undefined;
  let sandboxParentId: string | undefined;
  const scenarioResults: ScenarioResult[] = [];

  try {
    await mkdir(transcriptDirAbs, { recursive: true });
    await mkdir(runsDirAbs, { recursive: true });

    const me = await withNotionRetry("getMe", () => getMe(notion));
    const sandboxTitle = `BENCH: ${datePart}-${runContext.shortSha}`;
    sandboxParentId = await createBenchPage(notion, rootPageId, sandboxTitle);
    const dateValue = formatIso(startedAtDate);
    const botId = me.id;

    const needsHttpServer = scenarios.some((scenario) => scenario.transport !== "stdio");
    let configPath = "";

    if (needsHttpServer) {
      const bearer = mintBearer();
      const port = await pickEphemeralPort();

      handle = await spawnHttpServer({
        notionToken,
        port,
        bearer,
        serverPath: resolve(repoRoot, "dist/http.js"),
      });

      tempDir = await mkdtemp(join(tmpdir(), "bench-runner-"));
      configPath = join(tempDir, "mcp-config.json");
      await writeFile(
        configPath,
        `${JSON.stringify(buildMcpConfig(`${handle.url}/mcp`, bearer), null, 2)}\n`,
        "utf8",
      );
    }

    for (const scenario of scenarios) {
      const scenarioParentId = await createBenchPage(notion, sandboxParentId, `BENCH: ${scenario.id}`);
      const renderedScenario = renderTemplate(scenario, {
        SCENARIO_PARENT: scenarioParentId,
        SANDBOX_ID: sandboxParentId,
        DATE: dateValue,
        BOT_ID: botId,
      });

      scenarioResults.push(
        await runScenario({
          scenario: renderedScenario,
          model,
          configPath,
          transcriptDirAbs,
          transcriptDirRel,
          systemPromptPath,
          sdkContext,
          notion,
          scenarioParentId,
        }),
      );
    }

    const finishedAt = formatIso(new Date());
    const manifest = buildManifest({
      runId,
      gitSha,
      gitBranch,
      startedAt,
      finishedAt,
      model,
      nodeVersion: process.version,
      scenarios: scenarioResults,
    });

    await writeManifest(manifestPathAbs, manifest);
    printSummary(scenarioResults, manifestPathRel);

    return {
      exitCode: scenarioResults.every((result) => result.status !== "fail")
        ? SUCCESS_EXIT_CODE
        : FAILURE_EXIT_CODE,
      runId,
      manifestPath: manifestPathRel,
      scenarios: scenarioResults,
    };
  } catch (error) {
    if (scenarioResults.length > 0) {
      printSummary(scenarioResults);
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`Bench runner framework error: ${message}`);

    return {
      exitCode: FRAMEWORK_EXIT_CODE,
      runId,
      scenarios: scenarioResults,
    };
  } finally {
    if (handle) {
      await handle.kill().catch(() => undefined);
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

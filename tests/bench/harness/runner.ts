import { spawn, execSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import {
  mintBearer,
  pickEphemeralPort,
  spawnHttpServer,
  type HttpHandle,
} from "../../e2e/helpers/http-server.ts";
import { buildRunContext } from "../../e2e/helpers/run-context.ts";
import { buildMcpConfig, parseStreamJson } from "./dispatch.ts";
import { buildManifest, sha256Hex, writeManifest } from "./manifest.ts";
import type { Scenario, ScenarioResult, VerifyResult } from "./types.ts";
import { verifyGroundTruth, type SdkContext } from "./verifier.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const FRAMEWORK_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
const SUCCESS_EXIT_CODE = 0;

export interface RunnerResult {
  exitCode: 0 | 1 | 2;
  runId?: string;
  manifestPath?: string;
  scenarios: ScenarioResult[];
}

function createSdkContext(notionToken: string): SdkContext {
  const client = new Client({ auth: notionToken });

  return {
    listUsers: async () => {
      const response = await client.users.list({});
      return response.results.map((user) => ({
        id: user.id,
        type: user.type,
        name: user.name ?? undefined,
      }));
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

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(3)}`;
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
        (result.passed ? "PASS" : "FAIL").padEnd(statusWidth),
        formatDuration(result.durationMs).padEnd(durationWidth),
        formatCost(result.costUsd).padEnd(costWidth),
      ].join("  "),
    );
  }

  const totalCost = results.reduce((sum, result) => sum + result.costUsd, 0);
  const passedCount = results.filter((result) => result.passed).length;
  console.log("-".repeat(header.length));
  console.log(
    `Passed ${passedCount}/${results.length} scenarios, total cost ${formatCost(totalCost)}`,
  );

  if (manifestPath) {
    console.log(`Manifest: ${manifestPath}`);
  }
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

async function runScenario(opts: {
  scenario: Scenario;
  model: string;
  configPath: string;
  transcriptDirAbs: string;
  transcriptDirRel: string;
  systemPromptPath: string;
  sdkContext: SdkContext;
}): Promise<ScenarioResult> {
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

  const verification =
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
        : await verifyGroundTruth(opts.scenario.ground_truth, transcript, opts.sdkContext).catch(
            (error) =>
              failureVerification(
                "runner.verification_error",
                error instanceof Error ? error.message : String(error),
              ),
          );

  const durationMs = Date.now() - startedAt;
  const costUsd = transcript.result?.costUsd ?? 0;

  return {
    id: opts.scenario.id,
    passed: commandResult.exitCode === 0 && !commandResult.timedOut && verification.passed,
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

  if (!notionToken) {
    console.error("NOTION_TOKEN is required for bench runs.");
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
  const sdkContext = createSdkContext(notionToken);

  let handle: HttpHandle | undefined;
  let tempDir: string | undefined;
  const scenarioResults: ScenarioResult[] = [];

  try {
    await mkdir(transcriptDirAbs, { recursive: true });
    await mkdir(runsDirAbs, { recursive: true });

    const bearer = mintBearer();
    const port = await pickEphemeralPort();

    handle = await spawnHttpServer({
      notionToken,
      port,
      bearer,
      serverPath: resolve(repoRoot, "dist/http.js"),
    });

    tempDir = await mkdtemp(join(tmpdir(), "bench-runner-"));
    const configPath = join(tempDir, "mcp-config.json");
    await writeFile(
      configPath,
      `${JSON.stringify(buildMcpConfig(`${handle.url}/mcp`, bearer), null, 2)}\n`,
      "utf8",
    );

    for (const scenario of scenarios) {
      scenarioResults.push(
        await runScenario({
          scenario,
          model,
          configPath,
          transcriptDirAbs,
          transcriptDirRel,
          systemPromptPath,
          sdkContext,
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
      exitCode: scenarioResults.every((result) => result.passed)
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

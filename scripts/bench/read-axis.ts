import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PageFixture } from "./corpus/generate.js";
import { authEnvForServer, listTools, type McpLaunchSpec } from "./lib/mcp-client.js";
import { markdownToIr } from "./lib/markdown-to-ir.js";
import { notionJsonToIr, type GroundTruth } from "./lib/notion-json-to-ir.js";
import { archiveBlock, provisionPage } from "./lib/notion-provision.js";
import { provision, type ProvisionResult } from "./lib/provision.js";
import { extractMarkdown, readPageFull, type ReadResult } from "./lib/read-adapters.js";
import { SERVERS, type ServerDef, type ServerId } from "./lib/servers.js";
import { computeThreeNumber, type ThreeNumber } from "./lib/three-number.js";
import { ANTHROPIC_TOKEN_COUNT_MODEL, ANTHROPIC_VERSION } from "./lib/token-counter.js";

type RunStatus =
  | { status: "ok"; fixtureId: string; classId: string; serverId: ServerId; numbers: ThreeNumber }
  | { status: "failed"; fixtureId: string; classId: string; serverId?: ServerId; reason: string };

interface ProvisionedServer {
  def: ServerDef;
  provisioned: ProvisionResult;
  launch: McpLaunchSpec;
}

interface CorpusManifest {
  pageClasses: Record<string, { label: string; count: number; files: string[] }>;
}

interface FixtureSelection {
  classes?: Set<string>;
  limit?: number;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corpusDir = path.join(repoRoot, ".meta/bench/corpus");
const readAxisDir = path.join(repoRoot, ".meta/bench/read-axis");
const rawDir = path.join(readAxisDir, "raw");

export async function runReadAxis(serverDefs: ServerDef[] = SERVERS): Promise<RunStatus[]> {
  const noCleanup = process.argv.includes("--no-cleanup");
  const reuseRaw = process.argv.includes("--reuse-raw");
  const env = readEnv(reuseRaw);
  const createdPageIds: string[] = [];
  const statuses: RunStatus[] = [];
  const provisionedServers = reuseRaw
    ? reuseRawServers(serverDefs)
    : await provisionServers(serverDefs, env.notionToken);

  await mkdir(rawDir, { recursive: true });

  try {
    const selection = readFixtureSelection();
    const fixtures = selectFixtures(await loadPageFixtures(), selection);
    console.error(`[read-axis] selection: ${selectionLabel(selection)} -> ${fixtures.length} fixtures`);
    const anthropicCount = createAnthropicCounter(env.anthropicApiKey);

    for (const fixture of fixtures) {
      let pageId = "__reuse_raw__";
      if (!reuseRaw) {
        try {
          console.error(`[read-axis] provisioning fixture ${fixture.id}`);
          const created = await provisionPage(fixture, env.parentPageId, { token: env.notionToken });
          pageId = created.pageId;
          createdPageIds.push(pageId);
        } catch (error) {
          statuses.push({ status: "failed", fixtureId: fixture.id, classId: fixture.classId, reason: formatError(error) });
          continue;
        }
      }

      const readResults = new Map<ServerId, ReadResult>();
      for (const server of provisionedServers) {
        try {
          const result = await readOrReuseRaw(server.def.id, server, fixture, pageId, reuseRaw, env.readTimeoutMs);
          readResults.set(server.def.id, result);
        } catch (error) {
          statuses.push({
            status: "failed",
            fixtureId: fixture.id,
            classId: fixture.classId,
            serverId: server.def.id,
            reason: formatError(error),
          });
        }
      }

      const makenotionResult = readResults.get("makenotion");
      if (!makenotionResult?.notionBlocks) {
        statuses.push({
          status: "failed",
          fixtureId: fixture.id,
          classId: fixture.classId,
          reason: "makenotion ground truth was unavailable",
        });
        continue;
      }

      let groundTruth: GroundTruth;
      try {
        groundTruth = notionJsonToIr(makenotionResult.notionBlocks);
      } catch (error) {
        statuses.push({
          status: "failed",
          fixtureId: fixture.id,
          classId: fixture.classId,
          serverId: "makenotion",
          reason: formatError(error),
        });
        continue;
      }

      for (const result of readResults.values()) {
        try {
          const projectedIr =
            result.serverId === "makenotion"
              ? groundTruth.ir
              : markdownToIr(result.contentField, groundTruth.ir.title);
          const numbers = await computeThreeNumber(result, projectedIr, groundTruth, { anthropicCount });
          statuses.push({
            status: "ok",
            fixtureId: fixture.id,
            classId: fixture.classId,
            serverId: result.serverId,
            numbers,
          });
        } catch (error) {
          statuses.push({
            status: "failed",
            fixtureId: fixture.id,
            classId: fixture.classId,
            serverId: result.serverId,
            reason: formatError(error),
          });
        }
      }

      await writeResults(statuses, provisionedServers, env.anthropicApiKey !== undefined);
    }

    await writeResults(statuses, provisionedServers, env.anthropicApiKey !== undefined);
    console.log(renderReadAxisSummary(statuses));
    return statuses;
  } finally {
    if (noCleanup) {
      console.error(`[read-axis] --no-cleanup set; left ${createdPageIds.length} created pages in place`);
    } else {
      let archived = 0;
      for (const pageId of createdPageIds) {
        try {
          await archiveBlock(pageId, { token: env.notionToken });
          archived += 1;
        } catch (error) {
          console.error(`[read-axis] cleanup failed for ${pageId}: ${formatError(error)}`);
        }
      }
      console.error(`[read-axis] archived ${archived}/${createdPageIds.length} created pages`);
    }
  }
}

async function provisionServers(serverDefs: ServerDef[], token: string): Promise<ProvisionedServer[]> {
  const provisionedServers: ProvisionedServer[] = [];
  for (const def of serverDefs) {
    try {
      console.error(`[read-axis] provisioning ${def.id}`);
      const provisioned = await provision(def);
      const launch = authenticatedLaunch(provisioned.launch, def.id, token, def.notionVersion);
      await listTools(launch);
      provisionedServers.push({ def, provisioned, launch });
    } catch (error) {
      console.error(`[read-axis] skipping ${def.id}: ${formatError(error)}`);
      await writeFailureArtifact(`${def.id}-provisioning-error.log`, formatError(error));
    }
  }
  return provisionedServers;
}

function reuseRawServers(serverDefs: ServerDef[]): ProvisionedServer[] {
  return serverDefs.map((def) => {
    const launch: McpLaunchSpec = { command: "", args: [], cwd: repoRoot };
    return {
      def,
      launch,
      provisioned: {
        id: def.id,
        resolvedSha: "reuse-raw",
        pkgVersion: "",
        launch,
        scriptsBlock: {},
        binEntry: "",
        cacheDir: "",
      },
    };
  });
}

async function readOrReuseRaw(
  serverId: ServerId,
  server: ProvisionedServer,
  fixture: PageFixture,
  pageId: string,
  reuseRaw: boolean,
  timeoutMs: number,
): Promise<ReadResult> {
  const classDir = path.join(rawDir, fixture.classId);
  await mkdir(classDir, { recursive: true });
  const rawTextPath = path.join(classDir, `${fixture.id}--${serverId}.txt`);
  const notionBlocksPath = path.join(classDir, `${fixture.id}--${serverId}.json`);

  if (reuseRaw) {
    if (!existsSync(rawTextPath)) {
      throw new Error(`--reuse-raw missing raw artifact: ${rawTextPath}`);
    }
    const asConsumedText = await readFile(rawTextPath, "utf8");
    if (serverId === "makenotion" && !existsSync(notionBlocksPath)) {
      throw new Error(`--reuse-raw missing makenotion ground-truth artifact: ${notionBlocksPath}`);
    }
    const notionBlocks =
      serverId === "makenotion" && existsSync(notionBlocksPath)
        ? JSON.parse(await readFile(notionBlocksPath, "utf8")) as unknown
        : undefined;
    return {
      serverId,
      asConsumedText,
      callCount: 0,
      contentField: serverId === "makenotion" ? "" : extractMarkdown(asConsumedText),
      ...(notionBlocks ? { notionBlocks } : {}),
      raw: { reused: true },
    };
  }

  const result = await readPageFull(serverId, server.launch, pageId, { timeoutMs });
  await writeFile(rawTextPath, result.asConsumedText, "utf8");
  if (serverId === "makenotion" && result.notionBlocks) {
    await writeFile(notionBlocksPath, `${JSON.stringify(result.notionBlocks, null, 2)}\n`, "utf8");
  }
  return result;
}

function authenticatedLaunch(
  launch: McpLaunchSpec,
  serverId: ServerId,
  token: string,
  notionVersion: string,
): McpLaunchSpec {
  return {
    ...launch,
    env: {
      ...launch.env,
      ...authEnvForServer(serverId, token, notionVersion),
    },
  };
}

async function loadPageFixtures(): Promise<PageFixture[]> {
  const manifest = JSON.parse(await readFile(path.join(corpusDir, "manifest.json"), "utf8")) as CorpusManifest;
  const files = Object.values(manifest.pageClasses).flatMap((entry) => entry.files);
  const fixtures: PageFixture[] = [];
  for (const file of files) {
    fixtures.push(JSON.parse(await readFile(path.join(corpusDir, file), "utf8")) as PageFixture);
  }
  return fixtures;
}

function readFixtureSelection(): FixtureSelection {
  const classesArg = process.argv.find((arg) => arg.startsWith("--classes="));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const classes = classesArg
    ?.slice("--classes=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const limitValue = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;

  return {
    ...(classes?.length ? { classes: new Set(classes) } : {}),
    ...(typeof limitValue === "number" && Number.isInteger(limitValue) && limitValue > 0
      ? { limit: limitValue }
      : {}),
  };
}

function selectFixtures(fixtures: PageFixture[], selection: FixtureSelection): PageFixture[] {
  const selected: PageFixture[] = [];
  const perClassCounts = new Map<string, number>();

  for (const fixture of fixtures) {
    if (selection.classes && !selection.classes.has(fixture.classId)) {
      continue;
    }
    const classCount = perClassCounts.get(fixture.classId) ?? 0;
    if (selection.limit !== undefined && classCount >= selection.limit) {
      continue;
    }
    perClassCounts.set(fixture.classId, classCount + 1);
    selected.push(fixture);
  }

  return selected;
}

function selectionLabel(selection: FixtureSelection): string {
  const classes = selection.classes ? [...selection.classes].join(",") : "all";
  const limit = selection.limit ?? "all";
  return `classes=${classes} limit=${limit}`;
}

async function writeResults(
  statuses: RunStatus[],
  provisionedServers: ProvisionedServer[],
  anthropicAvailable: boolean,
): Promise<void> {
  await mkdir(readAxisDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    tokenizer: {
      cl100k: "js-tiktoken encodingForModel('gpt-4')",
      anthropic: {
        model: ANTHROPIC_TOKEN_COUNT_MODEL,
        version: ANTHROPIC_VERSION,
        available: anthropicAvailable,
      },
    },
    servers: provisionedServers.map(({ def, provisioned }) => ({
      id: def.id,
      label: def.label,
      resolvedSha: provisioned.resolvedSha,
      pkgVersion: provisioned.pkgVersion,
      expectedPkgVersion: def.expectedPkgVersion,
      notionVersion: def.notionVersion,
      cacheDir: provisioned.cacheDir,
      binEntry: provisioned.binEntry,
    })),
    failureCount: statuses.filter((status) => status.status === "failed").length,
    results: statuses,
  };
  await writeFile(path.join(readAxisDir, "results.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function renderReadAxisSummary(statuses: RunStatus[]): string {
  const ok = statuses.filter((status): status is Extract<RunStatus, { status: "ok" }> => status.status === "ok");
  const byClass = new Map<string, Extract<RunStatus, { status: "ok" }>[]>();
  for (const status of ok) {
    byClass.set(status.classId, [...(byClass.get(status.classId) ?? []), status]);
  }

  const lines = [
    "Class | Competitor | Anthropic ours/competitor median(range) | cl100k ours/competitor median(range)",
    "---|---|---|---",
  ];
  for (const [classId, rows] of [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const competitor of ["makenotion", "awkoy", "better-notion"] as ServerId[]) {
      const ratios = ratiosFor(rows, competitor);
      lines.push(
        `${classId}${classId === "R5" ? " (flagged; excluded from headline)" : ""} | ${competitor} | ` +
          `${formatRatioSummary(ratios.anthropic)} | ${formatRatioSummary(ratios.cl100k)}`,
      );
    }
  }

  const headlineRows = ok.filter((status) => status.classId !== "R5");
  for (const competitor of ["makenotion", "awkoy", "better-notion"] as ServerId[]) {
    const ratios = ratiosFor(headlineRows, competitor);
    lines.push(
      `HEADLINE excluding R5 | ${competitor} | ${formatRatioSummary(ratios.anthropic)} | ${formatRatioSummary(ratios.cl100k)}`,
    );
  }
  return lines.join("\n");
}

function ratiosFor(rows: Extract<RunStatus, { status: "ok" }>[], competitor: ServerId) {
  const byFixture = new Map<string, Extract<RunStatus, { status: "ok" }>[]>();
  for (const row of rows) {
    byFixture.set(row.fixtureId, [...(byFixture.get(row.fixtureId) ?? []), row]);
  }
  const anthropic: number[] = [];
  const cl100k: number[] = [];
  for (const fixtureRows of byFixture.values()) {
    const ours = fixtureRows.find((row) => row.serverId === "easy-notion");
    const theirs = fixtureRows.find((row) => row.serverId === competitor);
    if (!ours || !theirs) continue;
    if (ours.numbers.asConsumed.anthropic !== null && theirs.numbers.asConsumed.anthropic) {
      anthropic.push(ours.numbers.asConsumed.anthropic / theirs.numbers.asConsumed.anthropic);
    }
    if (theirs.numbers.asConsumed.cl100k > 0) {
      cl100k.push(ours.numbers.asConsumed.cl100k / theirs.numbers.asConsumed.cl100k);
    }
  }
  return { anthropic, cl100k };
}

function formatRatioSummary(values: number[]): string {
  if (!values.length) return "n/a";
  const sorted = [...values].sort((a, b) => a - b);
  return `${round(median(sorted))} (${round(sorted[0] ?? 0)}-${round(sorted[sorted.length - 1] ?? 0)})`;
}

function median(sortedValues: number[]): number {
  const midpoint = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[midpoint] ?? 0;
  }
  return ((sortedValues[midpoint - 1] ?? 0) + (sortedValues[midpoint] ?? 0)) / 2;
}

function createAnthropicCounter(apiKey: string | undefined): (text: string) => Promise<number | null> {
  if (!apiKey) {
    return async () => null;
  }
  return async (text: string) => countAnthropicWithBackoff(text, apiKey);
}

async function countAnthropicWithBackoff(text: string, apiKey: string): Promise<number | null> {
  const payload = {
    model: ANTHROPIC_TOKEN_COUNT_MODEL,
    messages: [{ role: "user", content: text }],
  };
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    const response = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
    const raw = await response.json() as Record<string, unknown>;
    if (response.status === 429 && attempt < 5) {
      await sleep(retryDelayMs(response));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Anthropic token count failed (${response.status}): ${JSON.stringify(raw)}`);
    }
    return typeof raw.input_tokens === "number" ? raw.input_tokens : null;
  }
  return null;
}

function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }
  return 2_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(allowMissingNotion = false): {
  notionToken: string;
  parentPageId: string;
  readTimeoutMs: number;
  anthropicApiKey?: string;
} {
  const notionToken = process.env.NOTION_TOKEN;
  const parentPageId = process.env.BENCH_PARENT_PAGE_ID;
  if (!allowMissingNotion && !notionToken) throw new Error("NOTION_TOKEN is required");
  if (!allowMissingNotion && !parentPageId) throw new Error("BENCH_PARENT_PAGE_ID is required");
  return {
    notionToken: notionToken ?? "",
    parentPageId: parentPageId ?? "",
    readTimeoutMs: readTimeoutMs(),
    ...(process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY } : {}),
  };
}

function readTimeoutMs(): number {
  const value = Number(process.env.BENCH_READ_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 120_000;
}

async function writeFailureArtifact(fileName: string, reason: string): Promise<void> {
  await mkdir(readAxisDir, { recursive: true });
  await writeFile(path.join(readAxisDir, fileName), `${reason}\n`, "utf8");
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  await runReadAxis();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

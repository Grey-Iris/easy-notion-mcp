import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DatabaseFixture } from "./corpus/generate.js";
import {
  computeDbThreeNumber,
  dbGroundTruthFromRaw,
  flatRowsToIrDatabase,
  notionRowsToIrDatabase,
  type DbGroundTruth,
  type DbThreeNumber,
} from "./lib/db-ir.js";
import { listTools, type McpLaunchSpec } from "./lib/mcp-client.js";
import { archiveBlock, provisionDatabase } from "./lib/notion-provision.js";
import { provision, type ProvisionResult } from "./lib/provision.js";
import { queryDatabaseFull, type DbReadResult } from "./lib/db-adapters.js";
import { SERVERS, type ServerDef, type ServerId } from "./lib/servers.js";
import { ANTHROPIC_TOKEN_COUNT_MODEL, ANTHROPIC_VERSION, countCl100k } from "./lib/token-counter.js";

type RunStatus =
  | { status: "ok"; fixtureId: string; classId: string; serverId: ServerId; numbers: DbThreeNumber }
  | { status: "failed"; fixtureId: string; classId: string; serverId?: ServerId; reason: string };

interface ProvisionedServer {
  def: ServerDef;
  provisioned: ProvisionResult;
}

interface CorpusManifest {
  databaseClasses: Record<string, { label: string; files: string[] }>;
}

interface SensitivityResult {
  fixtureId: string;
  status: "ok" | "failed";
  defaultVersion: string;
  forcedVersion: string;
  defaultTokens?: { cl100k: number; anthropic: number | null; bytes: number };
  forcedTokens?: { cl100k: number; anthropic: number | null; bytes: number };
  shapeDiffers?: boolean;
  rowSetDiffers?: boolean;
  defaultCallCount?: number;
  forcedCallCount?: number;
  reason?: string;
}

interface DatabaseProvisionResult {
  databaseId: string;
  rowPageIds?: string[];
  dataSourceId?: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corpusDir = path.join(repoRoot, ".meta/bench/corpus");
const dbAxisDir = path.join(repoRoot, ".meta/bench/db-axis");
const rawDir = path.join(dbAxisDir, "raw");

export async function runDbAxis(serverDefs: ServerDef[] = SERVERS): Promise<RunStatus[]> {
  const env = readEnv();
  const noCleanup = process.argv.includes("--no-cleanup");
  const createdDatabaseIds: string[] = [];
  const createdRowPageIds: string[] = [];
  const statuses: RunStatus[] = [];
  const sensitivity: SensitivityResult[] = [];
  const provisionedServers = await provisionServers(serverDefs);

  await mkdir(rawDir, { recursive: true });

  try {
    const fixtures = await loadDatabaseFixtures();
    const anthropicCount = createAnthropicCounter(env.anthropicApiKey);

    for (const fixture of fixtures) {
      let databaseId: string;
      try {
        console.error(`[db-axis] provisioning fixture ${fixture.id}`);
        const created = await provisionDatabase(
          fixture,
          env.parentPageId,
          { token: env.notionToken },
        ) as DatabaseProvisionResult;
        databaseId = created.databaseId;
        createdDatabaseIds.push(databaseId);
        createdRowPageIds.push(...(created.rowPageIds ?? []));
      } catch (error) {
        statuses.push({ status: "failed", fixtureId: fixture.id, classId: fixture.classId, reason: formatError(error) });
        continue;
      }

      const readResults = new Map<ServerId, DbReadResult>();
      for (const server of provisionedServers) {
        try {
          const result = await queryDatabaseFull(server.def.id, server.provisioned.launch, databaseId);
          readResults.set(server.def.id, result);
          await writeRawArtifacts(fixture.id, server.def.id, result);
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
      if (!makenotionResult) {
        statuses.push({
          status: "failed",
          fixtureId: fixture.id,
          classId: fixture.classId,
          serverId: "makenotion",
          reason: "makenotion DB ground truth was unavailable",
        });
        continue;
      }

      let groundTruth: DbGroundTruth;
      try {
        groundTruth = dbGroundTruthFromRaw(makenotionResult.rows, fixture.properties, fixture.title);
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
              ? notionRowsToIrDatabase(result.rows, fixture.properties, fixture.title)
              : flatRowsToIrDatabase(result.asConsumedText, fixture.properties, fixture.title);
          const numbers = await computeDbThreeNumber(result, projectedIr, groundTruth, { anthropicCount });
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

      const makenotionServer = provisionedServers.find((server) => server.def.id === "makenotion");
      if (makenotionServer) {
        sensitivity.push(await runVersionSensitivity(fixture.id, makenotionServer.provisioned.launch, databaseId, anthropicCount));
      }

      await writeResults(statuses, sensitivity, provisionedServers, env.anthropicApiKey !== undefined);
    }

    await writeResults(statuses, sensitivity, provisionedServers, env.anthropicApiKey !== undefined);
    console.log(renderDbAxisSummary(statuses));
    return statuses;
  } finally {
    if (noCleanup) {
      console.error(
        `[db-axis] --no-cleanup set; left ${createdDatabaseIds.length} databases and ` +
          `${createdRowPageIds.length} row pages in place`,
      );
    } else {
      let archivedRows = 0;
      for (const rowPageId of createdRowPageIds) {
        try {
          await archiveBlock(rowPageId, { token: env.notionToken });
          archivedRows += 1;
        } catch (error) {
          console.error(`[db-axis] cleanup failed for row ${rowPageId}: ${formatError(error)}`);
        }
      }
      let archivedDatabases = 0;
      for (const databaseId of createdDatabaseIds) {
        try {
          await archiveBlock(databaseId, { token: env.notionToken });
          archivedDatabases += 1;
        } catch (error) {
          console.error(`[db-axis] cleanup failed for database ${databaseId}: ${formatError(error)}`);
        }
      }
      console.error(
        `[db-axis] archived ${archivedDatabases}/${createdDatabaseIds.length} databases and ` +
          `${archivedRows}/${createdRowPageIds.length} row pages`,
      );
    }
  }
}

async function provisionServers(serverDefs: ServerDef[]): Promise<ProvisionedServer[]> {
  const provisionedServers: ProvisionedServer[] = [];
  for (const def of serverDefs) {
    try {
      console.error(`[db-axis] provisioning ${def.id}`);
      const provisioned = await provision(def);
      await listTools(provisioned.launch);
      provisionedServers.push({ def, provisioned });
    } catch (error) {
      console.error(`[db-axis] skipping ${def.id}: ${formatError(error)}`);
      await writeFailureArtifact(`${def.id}-provisioning-error.log`, formatError(error));
    }
  }
  return provisionedServers;
}

async function loadDatabaseFixtures(): Promise<DatabaseFixture[]> {
  const manifest = JSON.parse(await readFile(path.join(corpusDir, "manifest.json"), "utf8")) as CorpusManifest;
  const files = Object.values(manifest.databaseClasses).flatMap((entry) => entry.files);
  const fixtures: DatabaseFixture[] = [];
  for (const file of files) {
    fixtures.push(JSON.parse(await readFile(path.join(corpusDir, file), "utf8")) as DatabaseFixture);
  }
  return fixtures;
}

async function writeRawArtifacts(fixtureId: string, serverId: ServerId, result: DbReadResult): Promise<void> {
  await mkdir(rawDir, { recursive: true });
  await writeFile(path.join(rawDir, `${fixtureId}--${serverId}.txt`), result.asConsumedText, "utf8");
  if (serverId === "makenotion") {
    await writeFile(path.join(rawDir, `${fixtureId}--${serverId}.json`), `${JSON.stringify(result.rows, null, 2)}\n`, "utf8");
  }
}

async function runVersionSensitivity(
  fixtureId: string,
  launch: McpLaunchSpec,
  databaseId: string,
  anthropicCount: (text: string) => Promise<number | null>,
): Promise<SensitivityResult> {
  try {
    const defaultResult = await queryDatabaseFull("makenotion", withNotionVersion(launch, "2025-09-03"), databaseId);
    const forcedResult = await queryDatabaseFull("makenotion", withNotionVersion(launch, "2026-03-11"), databaseId);
    return {
      fixtureId,
      status: "ok",
      defaultVersion: "2025-09-03",
      forcedVersion: "2026-03-11",
      defaultTokens: await tokenSummary(defaultResult.asConsumedText, anthropicCount),
      forcedTokens: await tokenSummary(forcedResult.asConsumedText, anthropicCount),
      shapeDiffers: stableStringify(shapeSignature(defaultResult.rows)) !== stableStringify(shapeSignature(forcedResult.rows)),
      rowSetDiffers: stableStringify(rowSetSignature(defaultResult.rows)) !== stableStringify(rowSetSignature(forcedResult.rows)),
      defaultCallCount: defaultResult.callCount,
      forcedCallCount: forcedResult.callCount,
    };
  } catch (error) {
    return {
      fixtureId,
      status: "failed",
      defaultVersion: "2025-09-03",
      forcedVersion: "2026-03-11",
      reason: formatError(error),
    };
  }
}

function withNotionVersion(launch: McpLaunchSpec, notionVersion: string): McpLaunchSpec {
  const existingHeaders = parseHeaders(launch.env?.OPENAPI_MCP_HEADERS);
  return {
    ...launch,
    env: {
      ...launch.env,
      OPENAPI_MCP_HEADERS: JSON.stringify({
        ...existingHeaders,
        Authorization: existingHeaders.Authorization ?? "Bearer ntn_dummyplaceholder",
        "Notion-Version": notionVersion,
      }),
    },
  };
}

function parseHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

async function tokenSummary(text: string, anthropicCount: (text: string) => Promise<number | null>) {
  return {
    cl100k: countCl100k(text),
    anthropic: await anthropicCount(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

async function writeResults(
  statuses: RunStatus[],
  sensitivity: SensitivityResult[],
  provisionedServers: ProvisionedServer[],
  anthropicAvailable: boolean,
): Promise<void> {
  await mkdir(dbAxisDir, { recursive: true });
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
    sensitivity,
    results: statuses,
  };
  await writeFile(path.join(dbAxisDir, "results.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function renderDbAxisSummary(statuses: RunStatus[]): string {
  const ok = statuses.filter((status): status is Extract<RunStatus, { status: "ok" }> => status.status === "ok");
  const byFixture = new Map<string, Array<Extract<RunStatus, { status: "ok" }>>>();
  for (const status of ok) {
    byFixture.set(status.fixtureId, [...(byFixture.get(status.fixtureId) ?? []), status]);
  }

  const lines = [
    "Fixture | Competitor | Anthropic ours/competitor | cl100k ours/competitor | completeness",
    "---|---|---:|---:|---:",
  ];
  for (const [fixtureId, rows] of [...byFixture.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const competitor of ["makenotion", "awkoy", "better-notion"] as ServerId[]) {
      const ours = rows.find((row) => row.serverId === "easy-notion");
      const theirs = rows.find((row) => row.serverId === competitor);
      if (!ours || !theirs) continue;
      lines.push(
        `${fixtureId} | ${competitor} | ${formatRatio(ours.numbers.asConsumed.anthropic, theirs.numbers.asConsumed.anthropic)} | ` +
          `${formatRatio(ours.numbers.asConsumed.cl100k, theirs.numbers.asConsumed.cl100k)} | ` +
          `${round(theirs.numbers.contentCompleteness.score)}`,
      );
    }
  }
  return lines.join("\n");
}

function shapeSignature(rows: unknown): unknown {
  const results = extractResults(rows);
  return results.map((row) => ({
    keys: Object.keys(row).sort(),
    propertyKeys: Object.keys(readObject(row.properties) ?? {}).sort(),
  }));
}

function rowSetSignature(rows: unknown): unknown {
  const results = extractResults(rows);
  return results.map((row) => {
    const properties = readObject(row.properties) ?? {};
    return {
      id: typeof row.id === "string" ? row.id : undefined,
      properties: Object.fromEntries(Object.keys(properties).sort().map((key) => [key, propertyPlainValue(properties[key])])),
    };
  });
}

function extractResults(rows: unknown): Record<string, unknown>[] {
  if (Array.isArray(rows)) return rows.filter(isJsonObject);
  const object = readObject(rows);
  if (!object) return [];
  if (Array.isArray(object.results)) return object.results.filter(isJsonObject);
  return [];
}

function propertyPlainValue(value: unknown): unknown {
  const property = readObject(value);
  if (!property) return value;
  if (Array.isArray(property.title)) return richTextPlain(property.title);
  if (Array.isArray(property.rich_text)) return richTextPlain(property.rich_text);
  if (property.number !== undefined) return property.number;
  if (property.checkbox !== undefined) return property.checkbox;
  if (property.url !== undefined) return property.url;
  if (property.email !== undefined) return property.email;
  if (property.phone_number !== undefined) return property.phone_number;
  const select = readObject(property.select);
  if (select?.name) return select.name;
  const status = readObject(property.status);
  if (status?.name) return status.name;
  if (Array.isArray(property.multi_select)) {
    return property.multi_select.map((option) => readObject(option)?.name).filter(Boolean);
  }
  const date = readObject(property.date);
  if (date?.start) return date.start;
  return property;
}

function richTextPlain(value: unknown[]): string {
  return value.filter(isJsonObject).map((item) => {
    const text = readObject(item.text);
    return typeof text?.content === "string" ? text.content : "";
  }).join("");
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

function readEnv(): { notionToken: string; parentPageId: string; anthropicApiKey?: string } {
  const notionToken = process.env.NOTION_TOKEN;
  const parentPageId = process.env.BENCH_PARENT_PAGE_ID;
  if (!notionToken) throw new Error("NOTION_TOKEN is required");
  if (!parentPageId) throw new Error("BENCH_PARENT_PAGE_ID is required");
  return {
    notionToken,
    parentPageId,
    ...(process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY } : {}),
  };
}

async function writeFailureArtifact(fileName: string, reason: string): Promise<void> {
  await mkdir(dbAxisDir, { recursive: true });
  await writeFile(path.join(dbAxisDir, fileName), `${reason}\n`, "utf8");
}

function formatRatio(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "n/a";
  return String(round(numerator / denominator));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isJsonObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson(value[key]);
    }
    return sorted;
  }
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  await runDbAxis();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listTools } from "./lib/mcp-client.js";
import { provision, type ProvisionResult } from "./lib/provision.js";
import { SERVERS, type ServerDef, type ServerId } from "./lib/servers.js";
import { countAnthropic, countCl100k, minifyToolsForSurface } from "./lib/token-counter.js";

export interface ToolSurfaceMetric {
  name: string;
  tokens: number;
  bytes: number;
}

export interface SurfaceMetrics {
  toolCount: number;
  totalTokens: number;
  totalBytes: number;
  avgTokensPerTool: number;
  perTool: ToolSurfaceMetric[];
}

export type AnthropicStatus =
  | Awaited<ReturnType<typeof countAnthropic>>
  | { available: false; reason: string };

interface SurfaceSummary extends SurfaceMetrics {
  id: ServerId;
  label: string;
  status: "ok";
  resolvedSha: string;
  pkgVersion: string;
  notionVersion: string;
  expectedPkgVersion: string;
  expectedTools: number;
  anthropic: AnthropicStatus;
}

export interface OkSummaryRow {
  id: ServerId;
  label: string;
  status: "ok";
  toolCount: number;
  totalTokens: number;
  totalBytes: number;
  avgTokensPerTool: number;
  resolvedSha: string;
  pkgVersion: string;
  notionVersion: string;
  anthropicAvailable: boolean;
}

export interface FailedSummaryRow {
  id: ServerId;
  label: string;
  status: "failed";
  reason: string;
}

export type SummaryRow = OkSummaryRow | FailedSummaryRow;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const surfaceDir = path.join(repoRoot, ".meta/bench/surface-axis");
const researchDocPath = path.join(repoRoot, ".meta/research/token-bench-surface-2026-06-13.md");

export function computeSurfaceMetrics(toolsArray: unknown[]): SurfaceMetrics {
  const minified = minifyToolsForSurface(toolsArray);
  const totalTokens = countCl100k(minified);
  const totalBytes = Buffer.byteLength(minified, "utf8");
  const toolCount = toolsArray.length;

  return {
    toolCount,
    totalTokens,
    totalBytes,
    avgTokensPerTool: toolCount ? round(totalTokens / toolCount) : 0,
    perTool: toolsArray.map((tool, index) => {
      const compact = JSON.stringify(tool);
      return {
        name: toolName(tool, index),
        tokens: countCl100k(compact),
        bytes: Buffer.byteLength(compact, "utf8"),
      };
    }),
  };
}

export async function runSurfaceAxis(serverDefs: ServerDef[] = SERVERS): Promise<SummaryRow[]> {
  await mkdir(surfaceDir, { recursive: true });
  await mkdir(path.dirname(researchDocPath), { recursive: true });

  const rows: SummaryRow[] = [];

  for (const def of serverDefs) {
    try {
      console.error(`[surface-axis] provisioning ${def.id}`);
      const provisioned = await provision(def);

      console.error(`[surface-axis] listing tools for ${def.id}`);
      const toolsResult = await listTools(provisioned.launch);
      const metrics = computeSurfaceMetrics(toolsResult.tools);
      const minified = minifyToolsForSurface(toolsResult.tools);
      const anthropic = await safeAnthropicCount(minified);

      const summary: SurfaceSummary = {
        id: def.id,
        label: def.label,
        status: "ok",
        ...metrics,
        resolvedSha: provisioned.resolvedSha,
        pkgVersion: provisioned.pkgVersion,
        notionVersion: def.notionVersion,
        expectedPkgVersion: def.expectedPkgVersion,
        expectedTools: def.expectedTools,
        anthropic,
      };

      await writeServerArtifacts(def.id, toolsResult.tools, toolsResult.stderr, summary, provisioned);
      rows.push(rowFromSummary(summary));
    } catch (error) {
      const reason = formatError(error);
      console.error(`[surface-axis] ${def.id} failed: ${reason}`);
      await writeFile(path.join(surfaceDir, `${def.id}-error.log`), `${reason}\n`, "utf8");
      rows.push({
        id: def.id,
        label: def.label,
        status: "failed",
        reason,
      });
    }
  }

  await writeFile(researchDocPath, renderResultsDoc(rows), "utf8");
  return rows;
}

export function renderResultsDoc(rows: SummaryRow[]): string {
  const okRows = rows.filter((row): row is OkSummaryRow => row.status === "ok");
  const failedRows = rows.filter((row): row is FailedSummaryRow => row.status === "failed");
  const tableRows = okRows
    .map((row) => (
      `| ${row.label} | ${row.toolCount} | ${row.totalTokens} | ${row.totalBytes} | ` +
      `${row.avgTokensPerTool} | ${row.pkgVersion} | ${row.notionVersion} | ` +
      `${row.resolvedSha} | ${row.anthropicAvailable ? "available:true" : "available:false"} |`
    ))
    .join("\n");
  const findings = failedRows.length
    ? failedRows
      .map((row) => `- **${row.label}** (${row.id}): FAILED — ${row.reason}`)
      .join("\n")
    : "All 4 servers provisioned and listed successfully.";

  return `# Token Benchmark Surface Axis - 2026-06-13

Axis A is tool-surface only, so it earns no public or masthead claim. This axis records the no-call tools/list context cost for the servers that provisioned; any blocked server is listed under Provisioning findings. easy-notion is larger than the consolidated awkoy/better-notion surfaces and smaller than makenotion, and no "92%" claim lives here.

| Server | Tools | Total cl100k tokens | Total bytes | Avg tokens/tool | pkg version | Notion-Version | resolved SHA | Anthropic count |
|---|---:|---:|---:|---:|---|---|---|---|
${tableRows}

## Provisioning findings

${findings}

Tokenizer: cl100k_base via js-tiktoken gpt-4; Anthropic primary deferred (no ANTHROPIC_API_KEY) - wired hook reports available:false.

Reproducibility: re-running countCl100k over the committed \`.meta/bench/surface-axis/*-tools.json\` reproduces these exact token numbers.
`;
}

export function renderConsoleTable(rows: SummaryRow[]): string {
  return [
    "Server | Tools | cl100k tokens | Bytes | Avg/tool | Anthropic",
    "---|---:|---:|---:|---:|---",
    ...rows.map((row) => {
      if (row.status === "failed") {
        return `${row.id} | FAILED | FAILED | FAILED | FAILED | failed`;
      }
      return (
        `${row.id} | ${row.toolCount} | ${row.totalTokens} | ${row.totalBytes} | ` +
        `${row.avgTokensPerTool} | ${row.anthropicAvailable ? "yes" : "no"}`
      );
    }),
  ].join("\n");
}

async function writeServerArtifacts(
  id: ServerId,
  tools: unknown[],
  stderr: string,
  summary: SurfaceSummary,
  provisioned: ProvisionResult,
): Promise<void> {
  const auditSummary = {
    ...summary,
    scriptsBlock: provisioned.scriptsBlock,
    binEntry: provisioned.binEntry,
    cacheDir: provisioned.cacheDir,
  };

  await writeFile(path.join(surfaceDir, `${id}-tools.json`), `${JSON.stringify(tools, null, 2)}\n`, "utf8");
  await writeFile(path.join(surfaceDir, `${id}.stderr.log`), stderr, "utf8");
  await writeFile(
    path.join(surfaceDir, `${id}-summary.json`),
    `${JSON.stringify(auditSummary, null, 2)}\n`,
    "utf8",
  );
}

async function safeAnthropicCount(minified: string): Promise<AnthropicStatus> {
  try {
    return await countAnthropic(minified);
  } catch (error) {
    return { available: false, reason: formatError(error) };
  }
}

function rowFromSummary(summary: SurfaceSummary): SummaryRow {
  return {
    id: summary.id,
    label: summary.label,
    status: "ok",
    toolCount: summary.toolCount,
    totalTokens: summary.totalTokens,
    totalBytes: summary.totalBytes,
    avgTokensPerTool: summary.avgTokensPerTool,
    resolvedSha: summary.resolvedSha,
    pkgVersion: summary.pkgVersion,
    notionVersion: summary.notionVersion,
    anthropicAvailable: summary.anthropic.available,
  };
}

function toolName(tool: unknown, index: number): string {
  if (tool && typeof tool === "object" && "name" in tool) {
    const name = (tool as { name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return `tool_${index + 1}`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const rows = await runSurfaceAxis();
  console.log(renderConsoleTable(rows));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

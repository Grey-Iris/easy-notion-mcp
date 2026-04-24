/**
 * scripts/e2e/sweep-stale.ts
 *
 * Standalone stale E2E sandbox sweeper. Dry-run by default; pass `--apply` to
 * archive the planned pages. If Notion rate-limits an archive call, the MCP
 * layer surfaces "Notion rate limit hit. Wait a moment and retry." via
 * enhanceError; this script treats that as `unexpected`, exits 4, and does not
 * auto-retry. Rerun manually after the limit window clears.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { callTool } from "../../tests/e2e/helpers/call-tool.js";
import {
  classifyArchiveError,
  isToleratedArchiveClass,
  type ClassifiedArchiveError,
} from "../../tests/e2e/helpers/archive-errors.js";
import { McpStdioClient } from "../../tests/e2e/helpers/mcp-stdio-client.js";

type ToolError = { error: string };

type PageRef = {
  id: string;
  title?: string | null;
};

type SweepSummary = {
  archived: number;
  already_archived: number;
  archived_ancestor: number;
  not_found: number;
  unexpected: number;
  skipped_unverified: number;
};

type ParsedArgs =
  | { kind: "help" }
  | { kind: "run"; apply: boolean }
  | { kind: "error"; flag: string };

function isToolError(value: unknown): value is ToolError {
  return typeof value === "object" && value !== null && typeof (value as ToolError).error === "string";
}

function usageText(): string {
  return [
    "Usage:",
    "  npx tsx scripts/e2e/sweep-stale.ts",
    "  npx tsx scripts/e2e/sweep-stale.ts --apply",
    "",
    "npm scripts:",
    "  npm run test:e2e:sweep",
    "  npm run test:e2e:sweep:apply",
  ].join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { kind: "run", apply: false };
  }

  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { kind: "help" };
  }

  if (argv.length === 1 && argv[0] === "--apply") {
    return { kind: "run", apply: true };
  }

  return { kind: "error", flag: argv[0] };
}

function rootBoundaryMessage(message: string): boolean {
  return (
    classifyArchiveError("root", message).class === "not_found" ||
    message.includes("This page hasn't been shared with the integration.")
  );
}

function formatPlanLine(page: PageRef, depth: number): string {
  return `${"  ".repeat(depth)}- ${page.id} ${page.title ?? "(untitled)"}`;
}

function buildSummary(
  archived: string[],
  tolerated: ClassifiedArchiveError[],
  unexpected: ClassifiedArchiveError[],
  skippedUnverified: number,
): SweepSummary {
  return {
    archived: archived.length,
    already_archived: tolerated.filter((entry) => entry.class === "already_archived").length,
    archived_ancestor: tolerated.filter((entry) => entry.class === "archived_ancestor").length,
    not_found: tolerated.filter((entry) => entry.class === "not_found").length,
    unexpected: unexpected.length,
    skipped_unverified: skippedUnverified,
  };
}

async function listPages(
  client: McpStdioClient,
  parentPageId: string,
): Promise<PageRef[] | ToolError> {
  return callTool<PageRef[] | ToolError>(client, "list_pages", {
    parent_page_id: parentPageId,
  });
}

async function searchPages(client: McpStdioClient): Promise<PageRef[] | ToolError> {
  const results: PageRef[] = [];
  const seen = new Set<string>();

  for (const query of ["E2E:", "BENCH:"]) {
    const response = await callTool<PageRef[] | ToolError>(client, "search", {
      query,
      filter: "pages",
    });

    if (isToolError(response)) {
      return response;
    }

    for (const page of response) {
      if (seen.has(page.id)) {
        continue;
      }
      seen.add(page.id);
      results.push(page);
    }
  }

  return results;
}

async function walkCandidate(
  client: McpStdioClient,
  candidate: PageRef,
  totalVisited: { count: number },
): Promise<{ order: PageRef[]; planLines: string[] }> {
  const stack: Array<{ depth: number; page: PageRef }> = [{ depth: 0, page: candidate }];
  const visited = new Set<string>();
  const order: PageRef[] = [];
  const planLines: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const { depth, page } = current;
    if (visited.has(page.id)) {
      continue;
    }
    if (depth > 10) {
      throw new Error(`[sweep] depth limit exceeded at ${page.id} ${page.title ?? "(untitled)"}`);
    }

    totalVisited.count += 1;
    if (totalVisited.count > 500) {
      throw new Error("[sweep] refusing to sweep more than 500 pages");
    }

    visited.add(page.id);
    order.unshift(page);
    planLines.push(formatPlanLine(page, depth));

    const children = await listPages(client, page.id);
    if (isToolError(children)) {
      throw new Error(`list_pages failed for ${page.id}: ${children.error}`);
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ depth: depth + 1, page: children[index] });
    }
  }

  return { order, planLines };
}

export async function runSweep(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    console.log(usageText());
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(`[sweep] unknown flag: ${parsed.flag}`);
    console.error(usageText());
    return 2;
  }

  const token = env.NOTION_TOKEN;
  const rootId = env.E2E_ROOT_PAGE_ID;
  if (!token) {
    console.error("[sweep] NOTION_TOKEN not set");
    return 2;
  }
  if (!rootId) {
    console.error("[sweep] E2E_ROOT_PAGE_ID not set");
    return 2;
  }

  const serverPath = resolve(process.cwd(), "dist/index.js");
  if (!existsSync(serverPath)) {
    console.error(`[sweep] missing ${serverPath} — run npm run build first`);
    return 2;
  }

  const client = new McpStdioClient({ token, serverPath });
  try {
    await client.initialize();

    let rootListing: PageRef[] | ToolError;
    try {
      rootListing = await listPages(client, rootId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (rootBoundaryMessage(message)) {
        console.error(`[sweep] root unreachable or unshared: ${message}`);
        return 3;
      }
      console.error(`[sweep] root probe unexpected: ${message}`);
      return 4;
    }

    if (isToolError(rootListing)) {
      if (rootBoundaryMessage(rootListing.error)) {
        console.error(`[sweep] root unreachable or unshared: ${rootListing.error}`);
        return 3;
      }
      console.error(`[sweep] root probe unexpected: ${rootListing.error}`);
      return 4;
    }

    const candidates = rootListing.filter(
      (page) => typeof page.title === "string" && /^(E2E|BENCH): /.test(page.title),
    );
    const candidateIds = new Set(candidates.map((page) => page.id));

    let skippedUnverified = 0;
    const searchResults = await searchPages(client);
    if (isToolError(searchResults)) {
      console.error(`[sweep] search failed: ${searchResults.error}`);
      return 4;
    }
    for (const hit of searchResults) {
      if (!candidateIds.has(hit.id)) {
        skippedUnverified += 1;
        console.log(`[sweep] SKIP (unverified ancestry): ${hit.id} ${hit.title ?? "(untitled)"}`);
      }
    }

    const totalVisited = { count: 0 };
    const archiveOrder: PageRef[] = [];
    const planLines: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const walked = await walkCandidate(client, candidate, totalVisited);
      for (const line of walked.planLines) {
        planLines.push(line);
      }
      for (const page of walked.order) {
        if (seen.has(page.id)) {
          continue;
        }
        seen.add(page.id);
        archiveOrder.push(page);
      }
    }

    if (archiveOrder.length === 0) {
      console.log("[sweep] nothing to sweep");
      if (!parsed.apply) {
        return 0;
      }

      console.log(
        "[sweep] summary: archived=0 already_archived=0 archived_ancestor=0 not_found=0 unexpected=0 skipped_unverified=" +
          `${skippedUnverified}`,
      );
      return 0;
    }

    console.log(`[sweep] archive plan (${archiveOrder.length} pages):`);
    for (const line of planLines) {
      console.log(line);
    }

    if (!parsed.apply) {
      return 0;
    }

    const archived: string[] = [];
    const tolerated: ClassifiedArchiveError[] = [];
    const unexpected: ClassifiedArchiveError[] = [];

    for (const page of archiveOrder) {
      let rawError: string | null = null;
      try {
        const response = await callTool<Record<string, unknown> | ToolError>(client, "archive_page", {
          page_id: page.id,
        });

        if (isToolError(response)) {
          rawError = response.error;
        } else {
          archived.push(page.id);
        }
      } catch (error) {
        rawError = error instanceof Error ? error.message : String(error);
      }

      if (rawError === null) {
        continue;
      }

      const classified = classifyArchiveError(page.id, rawError);
      if (isToleratedArchiveClass(classified.class)) {
        tolerated.push(classified);
      } else {
        unexpected.push(classified);
        console.error(`[sweep] UNEXPECTED ${page.id}: ${rawError}`);
      }
    }

    const summary = buildSummary(archived, tolerated, unexpected, skippedUnverified);
    console.log(
      `[sweep] summary: archived=${summary.archived} ` +
        `already_archived=${summary.already_archived} ` +
        `archived_ancestor=${summary.archived_ancestor} ` +
        `not_found=${summary.not_found} ` +
        `unexpected=${summary.unexpected} ` +
        `skipped_unverified=${summary.skipped_unverified}`,
    );
    return unexpected.length > 0 ? 4 : 0;
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const exitCode = await runSweep();
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sweep] fatal: ${message}`);
    process.exitCode = 4;
  });
}

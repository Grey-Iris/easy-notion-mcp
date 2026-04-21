import { callTool } from "./call-tool.js";
import {
  classifyArchiveError,
  isToleratedArchiveClass,
  type ClassifiedArchiveError,
} from "./archive-errors.js";
import type { McpStdioClient } from "./mcp-stdio-client.js";

type ToolError = { error: string };

interface ArchivePageIdsSummary {
  archived: number;
  already_archived: number;
  archived_ancestor: number;
  not_found: number;
  unexpected: number;
}

export interface ArchivePageIdsResult {
  archived: string[];
  tolerated: ClassifiedArchiveError[];
  unexpected: ClassifiedArchiveError[];
  summary: ArchivePageIdsSummary;
}

function isToolError(value: unknown): value is ToolError {
  return typeof value === "object" && value !== null && typeof (value as ToolError).error === "string";
}

function buildSummary(
  archived: string[],
  tolerated: ClassifiedArchiveError[],
  unexpected: ClassifiedArchiveError[],
): ArchivePageIdsSummary {
  return {
    archived: archived.length,
    already_archived: tolerated.filter((entry) => entry.class === "already_archived").length,
    archived_ancestor: tolerated.filter((entry) => entry.class === "archived_ancestor").length,
    not_found: tolerated.filter((entry) => entry.class === "not_found").length,
    unexpected: unexpected.length,
  };
}

export async function createSandbox(
  client: McpStdioClient,
  rootId: string,
  ctx: { shortSha: string; startedAt: Date },
): Promise<{ id: string; name: string; url: string }> {
  const name = `E2E: ${ctx.startedAt.toISOString()} (${ctx.shortSha})`;
  const response = await callTool<{ id: string; url: string } | ToolError>(
    client,
    "create_page",
    {
      parent_page_id: rootId,
      title: name,
      markdown: "",
    },
  );

  if (isToolError(response)) {
    throw new Error(`createSandbox failed: ${response.error}`);
  }

  return {
    id: response.id,
    name,
    url: response.url,
  };
}

export async function archiveSandbox(
  client: McpStdioClient,
  sandboxId: string,
): Promise<{ archived: boolean }> {
  const response = await callTool<Record<string, unknown> | ToolError>(
    client,
    "archive_page",
    { page_id: sandboxId },
  );

  if (isToolError(response)) {
    throw new Error(`archiveSandbox failed: ${response.error}`);
  }

  return { archived: Boolean(response.archived ?? response.success) };
}

export async function archivePageIds(
  client: McpStdioClient,
  ids: string[],
): Promise<ArchivePageIdsResult> {
  const archived: string[] = [];
  const tolerated: ClassifiedArchiveError[] = [];
  const unexpected: ClassifiedArchiveError[] = [];

  for (const id of [...ids].reverse()) {
    let rawError: string | null = null;

    try {
      const response = await callTool<Record<string, unknown> | ToolError>(
        client,
        "archive_page",
        { page_id: id },
      );

      if (isToolError(response)) {
        rawError = response.error;
      } else {
        archived.push(id);
      }
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }

    if (rawError === null) {
      continue;
    }

    const classified = classifyArchiveError(id, rawError);
    if (isToleratedArchiveClass(classified.class)) {
      tolerated.push(classified);
    } else {
      unexpected.push(classified);
      console.error(`[e2e][teardown] UNEXPECTED archive_page failure for ${id}: ${rawError}`);
    }
  }

  const summary = buildSummary(archived, tolerated, unexpected);
  console.warn(
    `[e2e][teardown] cleanup summary: archived=${summary.archived} ` +
      `already_archived=${summary.already_archived} ` +
      `archived_ancestor=${summary.archived_ancestor} ` +
      `not_found=${summary.not_found} ` +
      `unexpected=${summary.unexpected}`,
  );

  return { archived, tolerated, unexpected, summary };
}

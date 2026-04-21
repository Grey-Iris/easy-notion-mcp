import { callTool } from "./call-tool.js";
import type { McpStdioClient } from "./mcp-stdio-client.js";

type ToolError = { error: string };

function isToolError(value: unknown): value is ToolError {
  return typeof value === "object" && value !== null && typeof (value as ToolError).error === "string";
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
): Promise<{ archived: string[]; failed: Array<{ id: string; error: string }> }> {
  const archived: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of [...ids].reverse()) {
    try {
      const response = await callTool<Record<string, unknown> | ToolError>(
        client,
        "archive_page",
        { page_id: id },
      );

      if (isToolError(response)) {
        failed.push({ id, error: response.error });
        console.error(`[e2e] archive_page failed for ${id}: ${response.error}`);
        continue;
      }

      archived.push(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id, error: message });
      console.error(`[e2e] archive_page failed for ${id}: ${message}`);
    }
  }

  return { archived, failed };
}

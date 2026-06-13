import { callTool, type McpLaunchSpec, type ToolCallResult } from "./mcp-client.js";
import type { ServerId } from "./servers.js";

export interface ReadResult {
  serverId: ServerId;
  asConsumedText: string;
  callCount: number;
  contentField: string;
  notionBlocks?: unknown;
  raw: unknown;
}

interface ReadPageFullOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxBlocks?: number;
}

type JsonObject = Record<string, unknown>;

const defaultMaxDepth = 12;
const defaultMaxBlocks = 5_000;

export async function readPageFull(
  serverId: ServerId,
  launch: McpLaunchSpec,
  pageId: string,
  opts: ReadPageFullOptions = {},
): Promise<ReadResult> {
  switch (serverId) {
    case "easy-notion":
      return readSingleMarkdown(serverId, launch, "read_page", { page_id: pageId }, opts);
    case "awkoy":
      return readSingleMarkdown(
        serverId,
        launch,
        "notion_execute",
        { operation: "get_page_markdown", payload: { page_id: pageId } },
        opts,
      );
    case "better-notion":
      return readSingleMarkdown(serverId, launch, "pages", { action: "get", page_id: pageId }, opts);
    case "makenotion":
      return readMakeNotion(launch, pageId, opts);
  }
}

async function readSingleMarkdown(
  serverId: ServerId,
  launch: McpLaunchSpec,
  toolName: string,
  args: Record<string, unknown>,
  opts: ReadPageFullOptions,
): Promise<ReadResult> {
  const result = await callTool(launch, toolName, args, { timeoutMs: opts.timeoutMs });
  const asConsumedText = result.contentTexts.join("\n");
  return {
    serverId,
    asConsumedText,
    callCount: 1,
    contentField: extractMarkdown(asConsumedText),
    raw: result.rawResult,
  };
}

async function readMakeNotion(
  launch: McpLaunchSpec,
  pageId: string,
  opts: ReadPageFullOptions,
): Promise<ReadResult> {
  const maxDepth = opts.maxDepth ?? defaultMaxDepth;
  const maxBlocks = opts.maxBlocks ?? defaultMaxBlocks;
  const calls: ToolCallResult[] = [];
  let blockCount = 0;

  async function trackedCall(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const result = await callTool(launch, toolName, args, { timeoutMs: opts.timeoutMs });
    calls.push(result);
    return result;
  }

  const pageCall = await trackedCall("API-retrieve-a-page", { page_id: pageId });
  const page = parseFirstJsonText(pageCall, "API-retrieve-a-page");

  async function fetchChildren(blockId: string, depth: number): Promise<JsonObject[]> {
    if (depth > maxDepth) {
      console.error(`[read-adapters] makenotion recursion depth cap hit at ${blockId}`);
      return [];
    }
    if (blockCount >= maxBlocks) {
      console.error(`[read-adapters] makenotion block cap hit at ${blockId}`);
      return [];
    }

    const children: JsonObject[] = [];
    let startCursor: string | undefined;
    do {
      const args: Record<string, unknown> = { block_id: blockId, page_size: 100 };
      if (startCursor) {
        args.start_cursor = startCursor;
      }
      const childCall = await trackedCall("API-get-block-children", args);
      const response = parseFirstJsonText(childCall, "API-get-block-children");
      const results = Array.isArray(response.results) ? response.results.filter(isJsonObject) : [];

      for (const block of results) {
        if (blockCount >= maxBlocks) {
          console.error(`[read-adapters] makenotion block cap hit at ${blockId}`);
          break;
        }
        blockCount += 1;
        children.push({ ...block });
      }

      startCursor =
        response.has_more === true && typeof response.next_cursor === "string"
          ? response.next_cursor
          : undefined;
    } while (startCursor && blockCount < maxBlocks);

    for (const block of children) {
      if (block.has_children === true && typeof block.id === "string") {
        block.children = await fetchChildren(block.id, depth + 1);
      }
    }

    return children;
  }

  const blocks = await fetchChildren(pageId, 0);

  return {
    serverId: "makenotion",
    asConsumedText: calls.flatMap((call) => call.contentTexts).join("\n"),
    callCount: calls.length,
    contentField: "",
    notionBlocks: { page, blocks },
    raw: calls.map((call) => call.rawResult),
  };
}

function extractMarkdown(text: string): string {
  const parsed = parseJson(text);
  if (isJsonObject(parsed) && typeof parsed.markdown === "string") {
    return parsed.markdown;
  }
  return text;
}

function parseFirstJsonText(result: ToolCallResult, label: string): JsonObject {
  const firstText = result.contentTexts[0] ?? "";
  const parsed = parseJson(firstText);
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} response was not a JSON object: ${firstText}`);
  }
  return parsed;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { callTool, type McpLaunchSpec, type ToolCallResult } from "./mcp-client.js";
import type { ServerId } from "./servers.js";

export interface DbReadResult {
  serverId: ServerId;
  asConsumedText: string;
  callCount: number;
  rows: unknown;
  raw: unknown;
}

interface QueryDatabaseFullOptions {
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

export async function queryDatabaseFull(
  serverId: ServerId,
  launch: McpLaunchSpec,
  databaseId: string,
  opts: QueryDatabaseFullOptions = {},
): Promise<DbReadResult> {
  switch (serverId) {
    case "easy-notion":
      return querySingle(serverId, launch, "query_database", { database_id: databaseId }, opts);
    case "awkoy":
      return querySingle(
        serverId,
        launch,
        "notion_execute",
        { operation: "query_database", payload: { database_id: databaseId } },
        opts,
      );
    case "better-notion":
      return querySingle(serverId, launch, "databases", { action: "query", database_id: databaseId }, opts);
    case "makenotion":
      return queryMakeNotion(launch, databaseId, opts);
  }
}

async function querySingle(
  serverId: ServerId,
  launch: McpLaunchSpec,
  toolName: string,
  args: Record<string, unknown>,
  opts: QueryDatabaseFullOptions,
): Promise<DbReadResult> {
  const result = await callTool(launch, toolName, args, { timeoutMs: opts.timeoutMs });
  const asConsumedText = result.contentTexts.join("\n");
  return {
    serverId,
    asConsumedText,
    callCount: 1,
    rows: parseRows(asConsumedText),
    raw: result.rawResult,
  };
}

async function queryMakeNotion(
  launch: McpLaunchSpec,
  databaseId: string,
  opts: QueryDatabaseFullOptions,
): Promise<DbReadResult> {
  const calls: ToolCallResult[] = [];

  async function trackedCall(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const result = await callTool(launch, toolName, args, { timeoutMs: opts.timeoutMs });
    calls.push(result);
    return result;
  }

  const databaseCall = await trackedCall("API-retrieve-a-database", { database_id: databaseId });
  const database = parseFirstJsonText(databaseCall, "API-retrieve-a-database");
  const dataSourceId = readDataSourceId(database);

  let queryResponses: JsonObject[];
  if (dataSourceId) {
    queryResponses = await queryPaginated(trackedCall, "API-query-data-source", "data_source_id", dataSourceId);
  } else {
    try {
      queryResponses = await queryPaginated(trackedCall, "API-post-database-query", "database_id", databaseId);
    } catch (error) {
      throw new Error(
        `makenotion database shape mismatch: API-retrieve-a-database returned no data_sources and ` +
          `API-post-database-query failed: ${formatError(error)}`,
      );
    }
  }

  const results = queryResponses.flatMap((response) =>
    Array.isArray(response.results) ? response.results.filter(isJsonObject) : [],
  );

  return {
    serverId: "makenotion",
    asConsumedText: calls.flatMap((call) => call.contentTexts).join("\n"),
    callCount: calls.length,
    rows: { database, results },
    raw: { database: databaseCall.rawResult, queries: queryResponses },
  };
}

async function queryPaginated(
  call: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>,
  toolName: string,
  idParam: "data_source_id" | "database_id",
  id: string,
): Promise<JsonObject[]> {
  const responses: JsonObject[] = [];
  let startCursor: string | undefined;

  do {
    const args: Record<string, unknown> = { [idParam]: id, page_size: 100 };
    if (startCursor) {
      args.start_cursor = startCursor;
    }
    const result = await call(toolName, args);
    const response = parseFirstJsonText(result, toolName);
    responses.push(response);
    startCursor =
      response.has_more === true && typeof response.next_cursor === "string"
        ? response.next_cursor
        : undefined;
  } while (startCursor);

  return responses;
}

function parseRows(text: string): unknown {
  const parsed = parseJson(text);
  if (!isJsonObject(parsed)) {
    return text;
  }
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (Array.isArray(parsed.data)) return parsed.data;
  return parsed;
}

function parseFirstJsonText(result: ToolCallResult, label: string): JsonObject {
  const firstText = result.contentTexts[0] ?? "";
  const parsed = parseJson(firstText);
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} response was not a JSON object: ${firstText}`);
  }
  return parsed;
}

function readDataSourceId(database: JsonObject): string | undefined {
  const dataSources = Array.isArray(database.data_sources) ? database.data_sources : [];
  const first = dataSources.find(isJsonObject);
  return typeof first?.id === "string" ? first.id : undefined;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

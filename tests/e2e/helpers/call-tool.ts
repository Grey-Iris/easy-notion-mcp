import type { McpStdioClient } from "./mcp-stdio-client.js";

export class McpCallError extends Error {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly code: number;

  constructor(opts: {
    tool: string;
    args: Record<string, unknown>;
    code: number;
    message: string;
  }) {
    super(`MCP tools/call failed for ${opts.tool}: ${opts.message}`);
    this.name = "McpCallError";
    this.tool = opts.tool;
    this.args = opts.args;
    this.code = opts.code;
  }
}

export async function callTool<T = unknown>(
  client: McpStdioClient,
  name: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const response = await client.request(
    "tools/call",
    { name, arguments: args },
    opts,
  );

  if (response.error) {
    throw new McpCallError({
      tool: name,
      args,
      code: response.error.code,
      message: response.error.message,
    });
  }

  const text = (response.result as {
    content?: Array<{ text?: string }>;
  } | undefined)?.content?.[0]?.text;

  if (typeof text !== "string") {
    throw new Error(`MCP tool response missing content[0].text for ${name}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse MCP tool response for ${name}: ${reason}. Raw text: ${text}`);
  }
}

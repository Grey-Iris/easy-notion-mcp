import { spawn } from "node:child_process";

export interface McpLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface ToolsListResult {
  tools: unknown[];
  stderr: string;
  raw: unknown;
}

export interface ToolCallResult {
  contentTexts: string[];
  rawResult: unknown;
  isError: boolean;
  stderr: string;
}

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export const DUMMY_TOKEN_ENV = {
  NOTION_TOKEN: "ntn_dummyplaceholder",
  INTERNAL_INTEGRATION_TOKEN: "ntn_dummyplaceholder",
  OPENAPI_MCP_HEADERS: JSON.stringify({
    Authorization: "Bearer ntn_dummyplaceholder",
    "Notion-Version": "2025-09-03",
  }),
};

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "surface-axis", version: "0.0.1" },
  },
};

const initializedNotification = {
  jsonrpc: "2.0",
  method: "notifications/initialized",
  params: {},
};

const toolsListRequest = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
};

export async function listTools(
  spec: McpLaunchSpec,
  opts: { timeoutMs?: number } = {},
): Promise<ToolsListResult> {
  const response = await rpcExchange(spec, toolsListRequest, "tools/list", opts.timeoutMs ?? 30_000);
  const result = readObject(response.raw);
  const responseResult = readObject(result?.result);
  const tools = responseResult?.tools;

  if (!Array.isArray(tools)) {
    throw new Error(
      `${labelFor(spec)} tools/list response did not contain result.tools array.\n` +
        `stdout:\n${response.stdout}\n\nstderr:\n${response.stderr}`,
    );
  }

  return {
    tools,
    stderr: response.stderr,
    raw: response.raw,
  };
}

export async function callTool(
  spec: McpLaunchSpec,
  toolName: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<ToolCallResult> {
  const response = await rpcExchange(
    spec,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    },
    `tools/call ${toolName}`,
    opts.timeoutMs ?? 30_000,
  );
  const message = readObject(response.raw);
  const result = readObject(message?.result);
  const content = Array.isArray(result?.content) ? result.content : [];

  return {
    contentTexts: content.flatMap((item) => {
      const contentItem = readObject(item);
      return contentItem?.type === "text" && typeof contentItem.text === "string" ? [contentItem.text] : [];
    }),
    rawResult: message?.result,
    isError: result?.isError === true,
    stderr: response.stderr,
  };
}

function rpcExchange(
  spec: McpLaunchSpec,
  request: JsonRpcMessage,
  label: string,
  timeoutMs: number,
): Promise<{ raw: JsonRpcMessage; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...DUMMY_TOKEN_ENV,
        ...spec.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    let initialized = false;

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `${labelFor(spec)} did not emit a ${label} response within ${timeoutMs}ms.\n` +
            `Command: ${spec.command} ${spec.args.join(" ")}\n` +
            `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
        ),
      );
    }, timeoutMs);

    const initializeRetry = setTimeout(() => {
      if (!settled && !initialized && child.stdin.writable) {
        send(initializeRequest);
      }
    }, 1_000);

    function finish(error: Error, result?: never): void;
    function finish(error: undefined, result: JsonRpcMessage): void;
    function finish(error?: Error, result?: JsonRpcMessage): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(initializeRetry);
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve({ raw: result as JsonRpcMessage, stdout, stderr });
      }
    }

    function send(message: unknown) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.on("error", (error) => {
      finish(
        new Error(
          `${labelFor(spec)} failed to spawn: ${formatError(error)}\n` +
            `Command: ${spec.command} ${spec.args.join(" ")}\n` +
            `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
        ),
      );
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            `${labelFor(spec)} exited before ${label} response (code=${code}, signal=${signal}).\n` +
              `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
          ),
        );
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutBuffer += text;

      while (stdoutBuffer.includes("\n")) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

        if (!line) continue;

        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish(
              new Error(
                `${labelFor(spec)} initialize failed: ${JSON.stringify(message.error)}\n` +
                  `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
              ),
            );
            return;
          }
          initialized = true;
          send(initializedNotification);
          send(request);
          continue;
        }

        if (message.id === request.id) {
          if (message.error) {
            finish(
              new Error(
                `${labelFor(spec)} ${label} failed: ${JSON.stringify(message.error)}\n` +
                  `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
              ),
            );
            return;
          }
          finish(undefined, message);
          return;
        }
      }
    });

    send(initializeRequest);
  });
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function labelFor(spec: McpLaunchSpec): string {
  return `${spec.command} ${spec.args.join(" ")}`.trim();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

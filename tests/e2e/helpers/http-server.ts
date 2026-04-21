import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const HTTP_ACCEPT = "application/json, text/event-stream";
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

function assertOk(response: Response, bodyText: string, context: string) {
  if (response.ok) {
    return;
  }

  throw new Error(
    `${context} failed (${response.status} ${response.statusText}): ${bodyText || "<empty body>"}`,
  );
}

function parseSseJsonRpcResponse(bodyText: string): JsonRpcResponse {
  const events: string[] = [];
  const currentDataLines: string[] = [];

  const flushEvent = () => {
    if (currentDataLines.length === 0) {
      return;
    }
    events.push(currentDataLines.join("\n"));
    currentDataLines.length = 0;
  };

  for (const rawLine of bodyText.split(/\r?\n/)) {
    if (rawLine === "") {
      flushEvent();
      continue;
    }

    if (rawLine.startsWith(":")) {
      continue;
    }

    if (rawLine.startsWith("data:")) {
      currentDataLines.push(rawLine.slice(5).trimStart());
    }
  }

  flushEvent();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (!candidate.trim()) {
      continue;
    }

    try {
      return JSON.parse(candidate) as JsonRpcResponse;
    } catch {
      // Ignore non-JSON SSE payloads and keep searching backwards.
    }
  }

  throw new Error(`SSE response missing JSON-RPC payload. Raw body: ${bodyText}`);
}

async function parseJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();

  assertOk(response, bodyText, "HTTP MCP request");

  if (contentType.includes("text/event-stream")) {
    return parseSseJsonRpcResponse(bodyText);
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(bodyText) as JsonRpcResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse JSON response: ${reason}. Raw body: ${bodyText}`);
    }
  }

  throw new Error(`Unsupported response content-type: ${contentType || "<missing>"}`);
}

async function postJsonRpc(
  url: string,
  bearer: string,
  body: Record<string, unknown>,
  opts?: {
    sessionId?: string;
    protocolVersion?: string;
    timeoutMs?: number;
  },
): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), opts?.timeoutMs ?? 30_000);

  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: HTTP_ACCEPT,
        "Content-Type": "application/json",
        ...(opts?.sessionId ? { "mcp-session-id": opts.sessionId } : {}),
        ...(opts?.protocolVersion ? { "mcp-protocol-version": opts.protocolVersion } : {}),
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function mintBearer(): string {
  return randomBytes(32).toString("hex");
}

export function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine ephemeral port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export interface HttpHandle {
  url: string;
  bearer: string;
  port: number;
  kill(): Promise<void>;
}

export function spawnHttpServer(opts: {
  notionToken: string;
  port: number;
  bearer: string;
  serverPath?: string;
  timeoutMs?: number;
}): Promise<HttpHandle> {
  const serverPath = opts.serverPath ?? resolve(process.cwd(), "dist/http.js");
  if (!existsSync(serverPath)) {
    throw new Error(`${serverPath} missing — run npm run build first`);
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NOTION_TOKEN: opts.notionToken,
      NOTION_MCP_BEARER: opts.bearer,
      NOTION_MCP_BIND_HOST: "127.0.0.1",
      NOTION_OAUTH_CLIENT_ID: "",
      NOTION_OAUTH_CLIENT_SECRET: "",
      OAUTH_REDIRECT_URI: "",
      PORT: String(opts.port),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const startupLine = `easy-notion-mcp HTTP server listening on 127.0.0.1:${opts.port}`;

  let killPromise: Promise<void> | undefined;

  const kill = async () => {
    if (killPromise) {
      return killPromise;
    }

    killPromise = (async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await once(child, "exit");
    })();

    return killPromise;
  };

  return new Promise((resolvePromise, rejectPromise) => {
    let stderr = "";
    const rl = createInterface({ input: child.stderr });

    const timeout = setTimeout(() => {
      cleanup();
      void kill();
      rejectPromise(new Error("spawnHttpServer timeout waiting for startup"));
    }, opts.timeoutMs ?? 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      rl.close();
      child.off("exit", onExit);
      child.stderr.off("data", onData);
    };

    const onData = (chunk: Buffer | string) => {
      stderr += chunk.toString();
      process.stderr.write(`[http stderr] ${chunk.toString()}`);
    };

    const onLine = (line: string) => {
      if (!line.includes(startupLine)) {
        return;
      }

      cleanup();
      resolvePromise({
        url: `http://127.0.0.1:${opts.port}`,
        bearer: opts.bearer,
        port: opts.port,
        kill,
      });
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      rejectPromise(
        new Error(
          `HTTP server exited before startup (code=${code}, signal=${signal}). stderr:\n${stderr}`,
        ),
      );
    };

    child.stderr.on("data", onData);
    rl.on("line", onLine);
    child.on("exit", onExit);
  });
}

export async function callToolHttp<T = unknown>(
  handle: HttpHandle,
  name: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const endpoint = `${handle.url}/mcp`;

  const initializeResponse = await postJsonRpc(
    endpoint,
    handle.bearer,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "tier1-e2e-http", version: "0.0.1" },
      },
    },
    { timeoutMs },
  );

  const sessionId = initializeResponse.headers.get("mcp-session-id");
  if (!sessionId) {
    const bodyText = await initializeResponse.text();
    throw new Error(`HTTP initialize missing mcp-session-id header. Body: ${bodyText}`);
  }

  const initializeBody = await parseJsonRpcResponse(initializeResponse);
  const negotiatedProtocolVersion =
    (initializeBody.result as { protocolVersion?: string } | undefined)?.protocolVersion
    ?? PROTOCOL_VERSION;

  if (initializeBody.error) {
    throw new Error(
      `HTTP initialize failed (${initializeBody.error.code}): ${initializeBody.error.message}`,
    );
  }

  let deleteError: Error | undefined;

  try {
    const initializedResponse = await postJsonRpc(
      endpoint,
      handle.bearer,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      {
        sessionId,
        protocolVersion: negotiatedProtocolVersion,
        timeoutMs,
      },
    );

    const initializedBody = await initializedResponse.text();
    assertOk(initializedResponse, initializedBody, "HTTP notifications/initialized");

    const toolResponse = await postJsonRpc(
      endpoint,
      handle.bearer,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      },
      {
        sessionId,
        protocolVersion: negotiatedProtocolVersion,
        timeoutMs,
      },
    );

    const parsed = await parseJsonRpcResponse(toolResponse);
    if (parsed.error) {
      throw new Error(`HTTP tools/call failed for ${name}: ${parsed.error.message}`);
    }

    const text = (parsed.result as {
      content?: Array<{ text?: string }>;
    } | undefined)?.content?.[0]?.text;

    if (typeof text !== "string") {
      throw new Error(`HTTP tool response missing content[0].text for ${name}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse HTTP tool response for ${name}: ${reason}. Raw text: ${text}`);
    }
  } finally {
    try {
      const abortController = new AbortController();
      const deleteTimeout = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${handle.bearer}`,
            Accept: "application/json",
            "mcp-session-id": sessionId,
            "mcp-protocol-version": negotiatedProtocolVersion,
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          deleteError = new Error(
            `HTTP DELETE /mcp failed (${response.status} ${response.statusText}): ${bodyText}`,
          );
        }
      } finally {
        clearTimeout(deleteTimeout);
      }
    } catch (error) {
      deleteError = error instanceof Error ? error : new Error(String(error));
    }

    if (deleteError) {
      throw deleteError;
    }
  }
}

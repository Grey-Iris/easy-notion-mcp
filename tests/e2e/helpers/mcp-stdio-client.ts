import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
};

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (response: JsonRpcResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class McpStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly rl: Interface;
  private readonly exitPromise: Promise<void>;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private isClosed = false;
  private closePromise?: Promise<void>;
  private stderrBuffer = "";

  constructor(opts: { token: string; serverPath?: string; extraEnv?: Record<string, string> }) {
    const serverPath = opts.serverPath ?? resolve(process.cwd(), "dist/index.js");
    if (!existsSync(serverPath)) {
      throw new Error(`${serverPath} missing — run npm run build first`);
    }

    this.child = spawn("node", [serverPath], {
      env: {
        ...process.env,
        ...opts.extraEnv,
        NOTION_TOKEN: opts.token,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (typeof message.id !== "number") {
          return;
        }

        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        pending.resolve(message);
      } catch {
        console.error("[client] malformed line from server:", line);
      }
    });

    this.child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      this.stderrBuffer += text;
      process.stderr.write(`[server stderr] ${text}`);
    });

    this.exitPromise = new Promise((resolveExit) => {
      this.child.on("exit", (code, signal) => {
        this.isClosed = true;
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timeout);
          pending.reject(
            new Error(`MCP server exited before response ${id} (code=${code}, signal=${signal})`),
          );
        }
        this.pending.clear();
        console.error(`[server exit] code=${code}${signal ? ` signal=${signal}` : ""}`);
        resolveExit();
      });
    });
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tier1-e2e-harness", version: "0.0.1" },
    });

    if (response.error) {
      const details = response.error.data === undefined
        ? ""
        : ` data=${JSON.stringify(response.error.data)}`;
      throw new Error(
        `MCP initialize failed (${response.error.code}): ${response.error.message}${details}`,
      );
    }

    this.notify("notifications/initialized", {});
  }

  request(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      this.child.stdin.write(frame, (error) => {
        if (!error) {
          return;
        }
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
        this.child.stdin.end();
      }

      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill();
      }

      await this.exitPromise;
      this.rl.close();
    })();

    return this.closePromise;
  }
}

import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 10_000;
const STDERR_TAIL_LENGTH = 500;

type ParsedArgs =
  | { kind: "help" }
  | { kind: "run" }
  | { kind: "error"; flag: string };

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type PendingRequest = {
  method: string;
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: McpError) => void;
  timeout: NodeJS.Timeout;
};

export interface SmokeDeps {
  mkTmpDir(): Promise<string>;
  rmTmpDir(dir: string): Promise<void>;
  installTarball(tmpDir: string): Promise<void>;
  runMcpHandshake(args: { tmpDir: string; token: string }): Promise<{ id: string; name: string; type: string }>;
}

export class NpmNotFoundError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = "NpmNotFoundError";
  }
}

export class InstallFailedError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = "InstallFailedError";
  }
}

export class McpError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = "McpError";
  }
}

export class BotShapeError extends Error {
  constructor(msg?: string) {
    super(msg);
    this.name = "BotShapeError";
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { kind: "run" };
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { kind: "help" };
  }
  return { kind: "error", flag: argv[0] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatStderrTail(stderrBuffer: string): string {
  const trimmed = stderrBuffer.trim();
  if (!trimmed) {
    return "";
  }
  const tail = trimmed.slice(-STDERR_TAIL_LENGTH);
  return ` (stderr: ${tail})`;
}

function preview(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, STDERR_TAIL_LENGTH);
  }
  try {
    return JSON.stringify(value).slice(0, STDERR_TAIL_LENGTH);
  } catch {
    return String(value).slice(0, STDERR_TAIL_LENGTH);
  }
}

async function closeChild(
  child: ChildProcessWithoutNullStreams,
  rl: Interface,
  waitForClose: Promise<void>,
): Promise<void> {
  rl.close();
  if (!child.stdin.destroyed) {
    child.stdin.end();
  }
  if (!child.killed) {
    child.kill();
  }
  await waitForClose;
}

export function usageText(): string {
  return [
    "Usage:",
    "  npx tsx scripts/release/postpublish-smoke.ts",
    "  npx tsx scripts/release/postpublish-smoke.ts --help",
    "",
    "npm scripts:",
    "  npm run release:smoke",
  ].join("\n");
}

export async function runSmoke(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps?: SmokeDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    console.log(usageText());
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(`[smoke] unknown flag: ${parsed.flag}`);
    console.error(usageText());
    return 2;
  }

  const token = env.NOTION_TOKEN;
  if (!token) {
    console.error("[smoke] NOTION_TOKEN not set");
    return 2;
  }

  const actualDeps = deps ?? defaultDeps;
  const tmpDir = await actualDeps.mkTmpDir();

  try {
    try {
      await actualDeps.installTarball(tmpDir);
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof NpmNotFoundError) {
        console.error(`[smoke] npm not found on PATH: ${message}`);
        return 2;
      }
      console.error(`[smoke] npm install failed: ${message}`);
      return 3;
    }

    let user: { id: string; name: string; type: string };
    try {
      user = await actualDeps.runMcpHandshake({ tmpDir, token });
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof BotShapeError) {
        console.error(`[smoke] get_me returned user is not a bot: ${message}`);
        return 5;
      }
      console.error(`[smoke] MCP handshake failed: ${message}`);
      return 4;
    }

    if (!user.id || !user.name || user.type !== "bot") {
      console.error(`[smoke] get_me returned user is not a bot: type=${user.type} id=${user.id}`);
      return 5;
    }

    console.log(`[smoke] success: bot user id=${user.id} name=${user.name}`);
    return 0;
  } finally {
    try {
      await actualDeps.rmTmpDir(tmpDir);
    } catch (error) {
      console.error(`[smoke] cleanup warning: ${errorMessage(error)}`);
    }
  }
}

const defaultDeps: SmokeDeps = {
  mkTmpDir: () => mkdtemp(join(tmpdir(), "easy-notion-mcp-smoke-")),
  rmTmpDir: async (dir: string) => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.error(`[smoke] cleanup warning: failed to remove ${dir}: ${errorMessage(error)}`);
    }
  },
  installTarball: async (tmpDir: string) => {
    const args = ["install", "easy-notion-mcp@latest", "--prefix", tmpDir, "--no-audit", "--no-fund", "--silent"];
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new NpmNotFoundError(error.message));
          return;
        }
        reject(new InstallFailedError(error.message));
      });
      child.once("close", (code, signal) => {
        if (signal) {
          reject(new InstallFailedError(`npm install exited from signal ${signal}${formatStderrTail(stderrBuffer + stdoutBuffer)}`));
          return;
        }
        if (code !== 0) {
          reject(
            new InstallFailedError(
              `npm install exited with code ${code}: ${(stderrBuffer || stdoutBuffer).trim() || "no output"}`,
            ),
          );
          return;
        }
        resolve();
      });
    });
  },
  runMcpHandshake: async ({ tmpDir, token }) => {
    const serverPath = join(tmpDir, "node_modules", "easy-notion-mcp", "dist", "index.js");
    if (!existsSync(serverPath)) {
      throw new McpError(`installed tarball missing dist/index.js at ${serverPath}`);
    }

    const child = spawn("node", [serverPath], {
      env: { ...process.env, NOTION_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: child.stdout });
    const pending = new Map<number, PendingRequest>();
    let nextId = 1;
    let stderrBuffer = "";
    const waitForClose = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    const rejectPending = (error: McpError): void => {
      for (const [id, entry] of pending.entries()) {
        clearTimeout(entry.timeout);
        pending.delete(id);
        entry.reject(error);
      }
    };

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.once("error", (error) => {
      rejectPending(new McpError(`failed to spawn server: ${error.message}${formatStderrTail(stderrBuffer)}`));
    });
    child.once("exit", (code) => {
      rejectPending(new McpError(`server exited with code ${code}${formatStderrTail(stderrBuffer)}`));
    });

    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (typeof response.id !== "number") {
          return;
        }
        const entry = pending.get(response.id);
        if (!entry) {
          return;
        }
        clearTimeout(entry.timeout);
        pending.delete(response.id);
        entry.resolve(response);
      } catch {
        // Ignore malformed lines until a request times out or the child exits.
      }
    });

    const request = (method: string, params: unknown): Promise<JsonRpcResponse> => {
      const id = nextId++;
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new McpError(`request timeout: ${method}${formatStderrTail(stderrBuffer)}`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, {
          method,
          resolve,
          reject,
          timeout,
        });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", (error) => {
          if (!error) {
            return;
          }
          clearTimeout(timeout);
          pending.delete(id);
          reject(new McpError(`failed to write ${method}: ${error.message}${formatStderrTail(stderrBuffer)}`));
        });
      });
    };

    const notify = (method: string, params: unknown): void => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    };

    try {
      const initializeResponse = await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "postpublish-smoke", version: "0.0.1" },
      });
      if (initializeResponse.error) {
        throw new McpError(`initialize failed: ${initializeResponse.error.message}${formatStderrTail(stderrBuffer)}`);
      }

      notify("notifications/initialized", {});

      const getMeResponse = await request("tools/call", {
        name: "get_me",
        arguments: {},
      });
      if (getMeResponse.error) {
        throw new McpError(`get_me failed: ${getMeResponse.error.message}${formatStderrTail(stderrBuffer)}`);
      }

      const text = (getMeResponse.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new BotShapeError(`malformed get_me response: ${preview(getMeResponse.result)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new BotShapeError(`malformed get_me response: ${preview(text)}`);
      }

      if (!parsed || typeof parsed !== "object") {
        throw new BotShapeError(`malformed get_me response: ${preview(parsed)}`);
      }

      const maybeUser = parsed as { error?: unknown; id?: unknown; name?: unknown; type?: unknown };
      if (typeof maybeUser.error === "string") {
        throw new McpError(`get_me returned error: ${maybeUser.error}`);
      }
      if (
        typeof maybeUser.id !== "string" ||
        typeof maybeUser.name !== "string" ||
        typeof maybeUser.type !== "string"
      ) {
        throw new BotShapeError(`malformed get_me response: ${preview(parsed)}`);
      }
      if (maybeUser.type !== "bot") {
        throw new BotShapeError(`returned user is not a bot: type=${maybeUser.type}`);
      }

      return { id: maybeUser.id, name: maybeUser.name, type: maybeUser.type };
    } finally {
      await closeChild(child, rl, waitForClose);
    }
  },
};

async function main(): Promise<void> {
  const exitCode = await runSmoke(process.argv.slice(2), process.env);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[smoke] fatal: ${errorMessage(error)}`);
    process.exitCode = 4;
  });
}

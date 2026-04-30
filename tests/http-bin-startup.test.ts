import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir: string | undefined;
let symlinkPath: string;
let port: number;

function waitForStartupMessage(
  child: ChildProcessWithoutNullStreams,
  expectedMessage: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for startup message. stderr:\n${stderr}`));
    }, 12_000);

    const onData = (chunk: Buffer | string) => {
      stderr += chunk.toString();

      if (stderr.includes(expectedMessage)) {
        cleanup();
        resolve(stderr);
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Process exited before printing startup message (code=${code}, signal=${signal}). stderr:\n${stderr}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };

    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await once(child, "exit");
}

describe("HTTP bin-shim startup", () => {
  beforeAll(async () => {
    const distPath = resolve(process.cwd(), "dist", "http.js");
    if (!existsSync(distPath)) {
      throw new Error("dist/http.js is missing. Run `npm run build` before this test.");
    }

    tempDir = await mkdtemp(join(tmpdir(), "easy-notion-mcp-bin-shim-"));
    symlinkPath = join(tempDir, "easy-notion-mcp-http");
    await symlink(distPath, symlinkPath);
    port = 30_000 + Math.floor(Math.random() * 30_000);
  });

  afterAll(async () => {
    if (!tempDir) {
      return;
    }

    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for temporary test files.
    }
  });

  it("starts when invoked via bin-shim symlink", async () => {
    const expectedMessage = `easy-notion-mcp HTTP server listening on 127.0.0.1:${port}`;
    const child = spawn(process.execPath, [symlinkPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        NOTION_TOKEN: "ntn_fake",
        NOTION_MCP_BEARER: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      await waitForStartupMessage(child, expectedMessage);

      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "ok",
        server: "easy-notion-mcp",
        transport: "streamable-http",
        endpoint: "/mcp",
      });
    } finally {
      await stopChildProcess(child);
    }
  }, 20_000);
});

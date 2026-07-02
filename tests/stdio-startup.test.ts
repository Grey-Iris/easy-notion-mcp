import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: any;
};

function waitForStartupMessage(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for startup message. stderr:\n${stderr}`));
    }, 12_000);

    const onData = (chunk: Buffer | string) => {
      stderr += chunk.toString();

      if (stderr.includes("easy-notion-mcp") && stderr.includes("stdio")) {
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

function waitForJsonRpcResponse(
  child: ChildProcessWithoutNullStreams,
  id: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let stdout = "";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}. stdout:\n${stdout}`));
    }, 12_000);

    const onData = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let message: JsonRpcResponse;
        try {
          message = JSON.parse(line);
        } catch (error) {
          cleanup();
          reject(new Error(`Malformed JSON-RPC line from server: ${line}`));
          return;
        }

        if (message.id === id) {
          cleanup();
          resolve(message);
          return;
        }
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Process exited before JSON-RPC response ${id} (code=${code}, signal=${signal}). stdout:\n${stdout}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

function waitForExitOutput(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      cleanup();
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for process exit. stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 12_000);

    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
    };
    const onStderr = (chunk: Buffer | string) => {
      stderr += chunk.toString();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal, stdout, stderr });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
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

describe("stdio startup", () => {
  it("prints guidance for HTTP clients on stderr", async () => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOTION_TOKEN: "ntn_fake",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const stderr = await waitForStartupMessage(child);

      expect(stderr).toContain("easy-notion-mcp running on stdio");
      expect(stderr).toContain("easy-notion-mcp-http");
    } finally {
      await stopChildProcess(child);
    }
  }, 15_000);

  it("starts the stdio MCP server with no args and completes initialize", async () => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOTION_TOKEN: "ntn_fake",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBeforeInitialize = "";
    const collectStdout = (chunk: Buffer | string) => {
      stdoutBeforeInitialize += chunk.toString();
    };
    child.stdout.on("data", collectStdout);

    try {
      const stderr = await waitForStartupMessage(child);
      child.stdout.off("data", collectStdout);

      expect(stderr).toContain("easy-notion-mcp running on stdio");
      expect(stdoutBeforeInitialize).toBe("");

      const initializeResponse = waitForJsonRpcResponse(child, 1);
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "stdio-startup-test", version: "0.0.1" },
        },
      })}\n`);

      await expect(initializeResponse).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: {
            name: "easy-notion-mcp",
          },
        },
      });
    } finally {
      child.stdout.off("data", collectStdout);
      await stopChildProcess(child);
    }
  }, 15_000);

  it("routes init before the NOTION_TOKEN startup check", async () => {
    const child = spawn(process.execPath, ["dist/index.js", "init"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOTION_TOKEN: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();

    const { stdout, stderr } = await waitForExitOutput(child);
    const output = `${stdout}\n${stderr}`;

    expect(output).not.toContain("NOTION_TOKEN is required");
    expect(output).toMatch(/easy-notion.*(init|setup|wizard)|Notion.*(init|setup|wizard)/i);
  }, 15_000);
});

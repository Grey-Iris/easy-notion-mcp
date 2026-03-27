import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

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
});

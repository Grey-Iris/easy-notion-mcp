import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodingForModel } from "js-tiktoken";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
};

type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
};

type SurfaceMetrics = {
  label: string;
  tool_count: number;
  total_tokens: number;
  total_bytes: number;
  avg_tokens_per_tool: number;
  tools: Array<{ name: string; tokens: number; bytes: number }>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const benchDir = path.join(repoRoot, ".meta/bench/token-remeasure");
const npmPrefix = path.join(benchDir, "npm-pkg");
const enc = encodingForModel("gpt-4");

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "token-compare", version: "0.0.1" },
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

async function main() {
  await mkdir(benchDir, { recursive: true });

  if (!existsSync(path.join(repoRoot, "dist/index.js"))) {
    await runCommand("npm", ["run", "build"], repoRoot, "local build");
  }

  const localTools = await captureToolsFromServer({
    label: "easy-notion-mcp local",
    command: "node",
    args: [path.join(repoRoot, "dist/index.js")],
    cwd: repoRoot,
  });

  const npmCommand = await prepareNpmServerCommand();
  const npmTools = await captureToolsFromServer({
    label: "@notionhq/notion-mcp-server",
    ...npmCommand,
  });
  await rm(npmPrefix, { recursive: true, force: true });

  const hostedTools = await readHostedFixture();

  await writeTools("local", localTools);
  await writeTools("npm", npmTools);
  await writeTools("hosted", hostedTools);

  const surfaces = {
    local: metrics("easy-notion-mcp (HEAD)", localTools),
    npm: metrics("@notionhq/notion-mcp-server (latest npm)", npmTools),
    hosted: metrics("mcp.notion.com Enhanced Markdown fixture (lower bound)", hostedTools),
  };

  const report = {
    timestamp: new Date().toISOString(),
    tokenizer: "cl100k_base",
    surfaces,
    ratios: {
      local_vs_npm: ratio(surfaces.local.total_tokens, surfaces.npm.total_tokens, "local", "npm"),
      local_vs_hosted: ratio(surfaces.local.total_tokens, surfaces.hosted.total_tokens, "local", "hosted"),
      npm_vs_hosted: ratio(surfaces.npm.total_tokens, surfaces.hosted.total_tokens, "npm", "hosted"),
    },
    caveats: [
      "Hosted mcp.notion.com tools were measured from .meta/bench/token-remeasure/hosted-tools-fixture.json because live capture requires OAuth.",
      "Hosted fixture includes verbatim published descriptions but empty inputSchemas, so hosted totals are a lower bound and likely undercount the real tools/list budget.",
      "All three surfaces were tokenized with js-tiktoken encodingForModel(\"gpt-4\"), which maps to cl100k_base.",
      "Per-tool and total measurements use compact JSON.stringify output and include any extra fields returned by a server, such as annotations.",
    ],
  };

  await writeFile(
    path.join(benchDir, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(benchDir, "summary.md"), renderSummary(report), "utf8");

  console.log(JSON.stringify(report, null, 2));
}

async function prepareNpmServerCommand(): Promise<{ command: string; args: string[]; cwd: string }> {
  await mkdir(npmPrefix, { recursive: true });

  try {
    await runCommand(
      "npm",
      ["i", "--prefix", npmPrefix, "@notionhq/notion-mcp-server@latest"],
      repoRoot,
      "install @notionhq/notion-mcp-server",
    );

    const packageJsonPath = path.join(
      npmPrefix,
      "node_modules/@notionhq/notion-mcp-server/package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binEntry = typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.["notion-mcp-server"] ?? Object.values(packageJson.bin ?? {})[0];

    if (!binEntry) {
      throw new Error(`No bin entry found in ${packageJsonPath}`);
    }

    return {
      command: "node",
      args: [path.join(npmPrefix, "node_modules/@notionhq/notion-mcp-server", binEntry)],
      cwd: npmPrefix,
    };
  } catch (error) {
    console.error(`npm package install/inspection failed; falling back to npx: ${formatError(error)}`);
    return {
      command: "npx",
      args: ["-y", "-p", "@notionhq/notion-mcp-server@latest", "notion-mcp-server"],
      cwd: repoRoot,
    };
  }
}

async function captureToolsFromServer(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
}): Promise<Tool[]> {
  const response = await talkJsonRpc(options);
  const result = response.result as { tools?: unknown } | undefined;
  if (!result || !Array.isArray(result.tools)) {
    throw new Error(`${options.label} tools/list response did not contain result.tools array`);
  }
  return result.tools as Tool[];
}

async function talkJsonRpc(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
}): Promise<JsonRpcMessage> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        NOTION_TOKEN: "ntn_dummyplaceholder",
        INTERNAL_INTEGRATION_TOKEN: "ntn_dummyplaceholder",
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: "Bearer ntn_dummyplaceholder",
          "Notion-Version": "2022-06-28",
        }),
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
          `${options.label} did not emit a tools/list response within 30s.\n` +
            `Command: ${options.command} ${options.args.join(" ")}\n` +
            `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
        ),
      );
    }, 30_000);

    function finish(error: Error, result?: never): void;
    function finish(error: undefined, result: JsonRpcMessage): void;
    function finish(error?: Error, result?: JsonRpcMessage): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve(result as JsonRpcMessage);
      }
    }

    function send(message: unknown) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.on("error", (error) => {
      finish(
        new Error(
          `${options.label} failed to spawn: ${formatError(error)}\n` +
            `Command: ${options.command} ${options.args.join(" ")}`,
        ),
      );
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            `${options.label} exited before tools/list response (code=${code}, signal=${signal}).\n` +
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
            finish(new Error(`${options.label} initialize failed: ${JSON.stringify(message.error)}`));
            return;
          }
          initialized = true;
          send(initializedNotification);
          send(toolsListRequest);
          continue;
        }

        if (message.id === 2) {
          if (message.error) {
            finish(new Error(`${options.label} tools/list failed: ${JSON.stringify(message.error)}`));
            return;
          }
          finish(undefined, message);
          return;
        }
      }
    });

    send(initializeRequest);

    setTimeout(() => {
      if (!settled && !initialized && child.stdin.writable) {
        send(initializeRequest);
      }
    }, 1_000);
  });
}

async function runCommand(command: string, args: string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${label} failed (code=${code}, signal=${signal}).\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });
}

async function readHostedFixture(): Promise<Tool[]> {
  const fixturePath = path.join(benchDir, "hosted-tools-fixture.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { tools?: unknown };
  if (!Array.isArray(fixture.tools)) {
    throw new Error(`${fixturePath} did not contain a tools array`);
  }
  return fixture.tools as Tool[];
}

async function writeTools(name: "local" | "npm" | "hosted", tools: Tool[]) {
  await writeFile(
    path.join(benchDir, `${name}-tools.json`),
    `${JSON.stringify(tools, null, 2)}\n`,
    "utf8",
  );
}

function metrics(label: string, tools: Tool[]): SurfaceMetrics {
  const compactTools = JSON.stringify(tools);
  const toolMetrics = tools.map((tool) => {
    const compact = JSON.stringify(tool);
    return {
      name: tool.name,
      tokens: enc.encode(compact).length,
      bytes: Buffer.byteLength(compact, "utf8"),
    };
  });

  return {
    label,
    tool_count: tools.length,
    total_tokens: enc.encode(compactTools).length,
    total_bytes: Buffer.byteLength(compactTools, "utf8"),
    avg_tokens_per_tool: round(tools.length === 0 ? 0 : enc.encode(compactTools).length / tools.length),
    tools: toolMetrics,
  };
}

function ratio(leftTokens: number, rightTokens: number, leftName: string, rightName: string) {
  const savings = rightTokens === 0 ? 0 : ((rightTokens - leftTokens) / rightTokens) * 100;
  return {
    [`${leftName}_tokens`]: leftTokens,
    [`${rightName}_tokens`]: rightTokens,
    ratio: rightTokens === 0 ? "NaN" : (leftTokens / rightTokens).toFixed(2),
    pct_savings: `${savings.toFixed(1).replace(/\.0$/, "")}%`,
  };
}

function renderSummary(report: {
  timestamp: string;
  tokenizer: string;
  surfaces: Record<string, SurfaceMetrics>;
  ratios: Record<string, Record<string, unknown>>;
  caveats: string[];
}): string {
  const surfaceRows = Object.entries(report.surfaces)
    .map(([key, surface]) => (
      `| ${key} | ${surface.label} | ${surface.tool_count} | ${surface.total_tokens} | ${surface.total_bytes} | ${surface.avg_tokens_per_tool} |`
    ))
    .join("\n");

  const ratioRows = Object.entries(report.ratios)
    .map(([key, value]) => `| ${key} | ${value.ratio} | ${value.pct_savings} |`)
    .join("\n");

  const topFiveSections = Object.entries(report.surfaces)
    .map(([key, surface]) => {
      const rows = [...surface.tools]
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5)
        .map((tool, index) => `| ${index + 1} | ${tool.name} | ${tool.tokens} | ${tool.bytes} |`)
        .join("\n");
      return `## Top 5: ${key}\n\n| Rank | Tool | Tokens | Bytes |\n|---:|---|---:|---:|\n${rows}`;
    })
    .join("\n\n");

  return `# MCP tools/list Token Comparison

- Timestamp: ${report.timestamp}
- Tokenizer: ${report.tokenizer}
- Hosted surface caveat: fixture-based lower bound; OAuth-gated live tools/list was not captured.

## Totals

| Surface | Label | Tools | Total tokens | Total bytes | Avg tokens/tool |
|---|---|---:|---:|---:|---:|
${surfaceRows}

## Ratios

| Comparison | Ratio | Pct savings |
|---|---:|---:|
${ratioRows}

${topFiveSections}

## Caveats

${report.caveats.map((caveat) => `- ${caveat}`).join("\n")}
`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

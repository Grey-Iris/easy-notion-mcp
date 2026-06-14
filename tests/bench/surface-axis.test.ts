import path from "node:path";
import { fileURLToPath } from "node:url";

async function importSurfaceAxis() {
  return import(new URL("../../scripts/bench/surface-axis.ts", import.meta.url).href);
}

async function importMcpClient() {
  return import(new URL("../../scripts/bench/lib/mcp-client.ts", import.meta.url).href);
}

async function importTokenCounter() {
  return import(new URL("../../scripts/bench/lib/token-counter.ts", import.meta.url).href);
}

describe("surface axis", () => {
  it("computes deterministic metrics for the tool surface counted unit", async () => {
    const { computeSurfaceMetrics } = await importSurfaceAxis();
    const { countCl100k, minifyToolsForSurface } = await importTokenCounter();
    const tools = [
      {
        name: "read_page",
        description: "Read a page",
        inputSchema: { type: "object", properties: { page_id: { type: "string" } } },
      },
      {
        name: "create_page",
        description: "Create a page",
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      },
    ];

    const metrics = computeSurfaceMetrics(tools);
    const minified = minifyToolsForSurface(tools);
    const expectedTokens = countCl100k(minified);

    expect(metrics.toolCount).toBe(2);
    expect(metrics.totalTokens).toBe(expectedTokens);
    expect(metrics.totalBytes).toBe(Buffer.byteLength(minified, "utf8"));
    expect(metrics.avgTokensPerTool).toBe(Number((expectedTokens / 2).toFixed(2)));
    expect(metrics.perTool).toEqual(
      tools.map((tool) => {
        const compact = JSON.stringify(tool);
        return {
          name: tool.name,
          tokens: countCl100k(compact),
          bytes: Buffer.byteLength(compact, "utf8"),
        };
      }),
    );
  });

  it("renders ok rows in the metrics table and failures as provisioning findings", async () => {
    const { renderResultsDoc } = await importSurfaceAxis();

    const doc = renderResultsDoc([
      {
        id: "easy-notion",
        label: "easy-notion-mcp (ours)",
        status: "ok",
        toolCount: 42,
        totalTokens: 1234,
        totalBytes: 5678,
        avgTokensPerTool: 29.38,
        resolvedSha: "abc123",
        pkgVersion: "0.9.3",
        notionVersion: "2026-03-11",
        anthropicAvailable: false,
      },
      {
        id: "better-notion",
        label: "better-notion-mcp (@n24q02m)",
        status: "failed",
        reason: "npm error code ETARGET No matching version found for @notionhq/client@^5.22.0",
      },
    ]);

    expect(doc).toContain(
      "| easy-notion-mcp (ours) | 42 | 1234 | 5678 | 29.38 | 0.9.3 | 2026-03-11 | abc123 | available:false |",
    );
    expect(doc).toContain("## Provisioning findings");
    expect(doc).toContain(
      "- **better-notion-mcp (@n24q02m)** (better-notion): FAILED — npm error code ETARGET No matching version found for @notionhq/client@^5.22.0",
    );

    const metricsTable = doc.slice(0, doc.indexOf("## Provisioning findings"));
    expect(metricsTable).not.toContain("better-notion-mcp (@n24q02m)");
  });

  it("lists tools from a stdio MCP server while keeping stderr out of the payload", async () => {
    const { listTools } = await importMcpClient();
    const fakeServer = `
let buffer = "";
const tools = [{ name: "fake_tool", description: "Fake", inputSchema: { type: "object" } }];
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
process.stderr.write("fake server stderr line\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\\n")) {
    const newlineIndex = buffer.indexOf("\\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "0.0.1" } } });
    }
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    }
  }
});
`;

    const result = await listTools(
      {
        command: process.execPath,
        args: ["-e", fakeServer],
        cwd: path.dirname(fileURLToPath(import.meta.url)),
      },
      { timeoutMs: 5_000 },
    );

    expect(result.tools).toEqual([
      { name: "fake_tool", description: "Fake", inputSchema: { type: "object" } },
    ]);
    expect(result.stderr).toContain("fake server stderr line");
    expect(JSON.stringify(result.tools)).not.toContain("fake server stderr line");
  });
});

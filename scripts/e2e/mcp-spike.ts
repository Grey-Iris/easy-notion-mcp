/**
 * scripts/e2e/mcp-spike.ts — stdio MCP reality-check for dispatched Codex agents.
 *
 * Spawns `node dist/index.js` as a subprocess, speaks MCP JSON-RPC over stdio,
 * and prints every server response to stdout so a Codex-style agent (which has
 * no `mcp__easy-notion__*` tool surface of its own) can parse them and drive
 * the Notion MCP via a scripted harness instead.
 *
 * Usage:
 *   NOTION_TOKEN=... npx tsx scripts/e2e/mcp-spike.ts
 *
 * The script requires that `dist/index.js` exists — run `npm run build` first.
 * It does NOT auto-build, because builds mutate the tree and this is a probe.
 */
import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const SERVER_PATH = resolve(process.cwd(), "dist/index.js");
const NOTION_TOKEN = process.env.NOTION_TOKEN;

if (!NOTION_TOKEN) { console.error("NOTION_TOKEN not set in env"); process.exit(2); }
if (!existsSync(SERVER_PATH)) { console.error(`missing ${SERVER_PATH} — run 'npm run build' first`); process.exit(2); }

type JsonRpcResponse = { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } };

class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (resp: JsonRpcResponse) => void>();

  constructor() {
    this.child = spawn("node", [SERVER_PATH], {
      env: { ...process.env, NOTION_TOKEN },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      } catch (e) { console.error("[client] malformed line from server:", line); }
    });
    this.child.stderr.on("data", (buf) => process.stderr.write(`[server stderr] ${buf}`));
    this.child.on("exit", (code) => console.error(`[server exit] code=${code}`));
  }

  request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((res) => {
      this.pending.set(id, res);
      this.child.stdin.write(frame);
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  close(): void { this.child.stdin.end(); this.child.kill(); }
}

function dump(label: string, value: unknown): void {
  console.log(`\n==== ${label} ====`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const client = new McpStdioClient();

  const initResp = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-spike", version: "0.0.1" },
  });
  dump("initialize response", initResp);
  if (initResp.error) { console.error("initialize failed"); client.close(); process.exit(1); }

  client.notify("notifications/initialized", {});

  const listResp = await client.request("tools/list", {});
  const tools = (listResp.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  dump("tools/list summary", {
    count: tools.length,
    names: tools.map((t) => t.name).slice(0, 10),
    truncated: tools.length > 10,
  });
  if (tools.length === 0) { console.error("tools/list returned 0 tools — bailing"); client.close(); process.exit(1); }

  const callResp = await client.request("tools/call", {
    name: "get_me",
    arguments: {},
  });
  dump("tools/call get_me response", callResp);

  client.close();
  console.log("\n==== spike OK ====");
}

main().catch((err) => { console.error("spike failed:", err); process.exit(1); });

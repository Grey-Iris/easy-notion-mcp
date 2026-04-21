import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

function makeNotion() {
  return {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
    blocks: { children: { list: vi.fn(), append: vi.fn() }, delete: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

describe("MCP server version", () => {
  it("advertises the version from package.json, not a stale hardcoded string", async () => {
    const server = createServer(() => makeNotion() as any, {});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new McpClient({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const info = client.getServerVersion();
      expect(info?.name).toBe("easy-notion-mcp");
      expect(info?.version).toBe(pkg.version);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

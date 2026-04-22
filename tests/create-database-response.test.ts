import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

function makeNotion(createResult: any) {
  return {
    databases: {
      retrieve: vi.fn(),
      create: vi.fn(async () => createResult),
    },
    dataSources: { retrieve: vi.fn() },
    pages: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
    blocks: { children: { list: vi.fn(), append: vi.fn() }, delete: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "create-database-response-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return {
    client,
    async close() {
      await Promise.all([a.close(), b.close()]);
    },
  };
}

describe("create_database response fidelity (G-4c)", () => {
  it("G4c-1: people schema now succeeds and the response includes Owner", async () => {
    const createResult = {
      id: "db-1",
      url: "https://notion.so/db-1",
      properties: {
        Title: { id: "title", type: "title", title: {} },
        Owner: { id: "owner", type: "people", people: {} },
      },
    };
    const notion = makeNotion(createResult);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "create_database",
        arguments: {
          title: "T",
          parent_page_id: "parent-1",
          schema: [
            { name: "Title", type: "title" },
            { name: "Owner", type: "people" },
          ],
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.properties.sort()).toEqual(["Owner", "Title"]);
    } finally {
      await close();
    }
  });

  it("G4c-2: all-supported schema — response properties still derived from result (regression guard)", async () => {
    const createResult = {
      id: "db-2",
      url: "https://notion.so/db-2",
      properties: {
        Title: { id: "title", type: "title", title: {} },
        Status: { id: "s", type: "status", status: { options: [] } },
        State: { id: "st", type: "select", select: { options: [] } },
      },
    };
    const notion = makeNotion(createResult);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "create_database",
        arguments: {
          title: "T",
          parent_page_id: "parent-1",
          schema: [
            { name: "Title", type: "title" },
            { name: "Status", type: "status" },
            { name: "State", type: "select" },
          ],
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.properties.sort()).toEqual(["State", "Status", "Title"]);
    } finally {
      await close();
    }
  });

  it("G4c-3: unknown schema types fail validation before Notion is called", async () => {
    const createResult = {
      id: "db-3",
      url: "https://notion.so/db-3",
      properties: {
        Title: { id: "title", type: "title", title: {} },
      },
    };
    const notion = makeNotion(createResult);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "create_database",
        arguments: {
          title: "T",
          parent_page_id: "parent-1",
          schema: [
            { name: "Title", type: "title" },
            { name: "Wut", type: "this_is_not_a_real_type" },
          ],
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/this_is_not_a_real_type|title|formula|relation|status/);
      expect(notion.databases.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

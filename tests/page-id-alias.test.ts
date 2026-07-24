import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePageIdAlias } from "../src/notion-client.js";
import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

function pageNotDatabaseError(id: string) {
  const error: any = new Error(`ID ${id} is a page, not a database`);
  error.code = "validation_error";
  error.body = { code: "validation_error", message: error.message };
  return error;
}

type MockClient = {
  databases: { retrieve: ReturnType<typeof vi.fn> };
  blocks: { children: { list: ReturnType<typeof vi.fn>; append: ReturnType<typeof vi.fn> }; delete: ReturnType<typeof vi.fn> };
};

function makeMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    databases: { retrieve: vi.fn(), ...overrides.databases },
    blocks: {
      children: { list: vi.fn(), append: vi.fn(), ...overrides.blocks?.children },
      delete: vi.fn(),
      ...overrides.blocks,
      children: { list: vi.fn(), append: vi.fn(), ...overrides.blocks?.children },
    },
  };
}

// --- resolvePageIdAlias unit tests ---

describe("resolvePageIdAlias", () => {
  beforeEach(() => vi.clearAllMocks());

  it("database_id only — fast path, no API calls", async () => {
    const client = makeMockClient();
    const result = await resolvePageIdAlias(client as any, { database_id: "db-123" });
    expect(result).toBe("db-123");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("page_id that IS a database ID — same-UUID passthrough", async () => {
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockResolvedValue({ id: "db-as-page", data_sources: [{ id: "ds-1" }] }) },
    });
    const result = await resolvePageIdAlias(client as any, { page_id: "db-as-page" });
    expect(result).toBe("db-as-page");
    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: "db-as-page" });
  });

  it("page_id resolving to a single inline database", async () => {
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-1")) },
      blocks: {
        children: {
          list: vi.fn().mockResolvedValue({
            results: [
              { type: "paragraph", id: "blk-1" },
              { type: "child_database", id: "inline-db-1", child_database: { title: "Tasks" } },
            ],
          }),
          append: vi.fn(),
        },
        delete: vi.fn(),
      },
    });
    const result = await resolvePageIdAlias(client as any, { page_id: "page-1" });
    expect(result).toBe("inline-db-1");
    expect(client.blocks.children.list).toHaveBeenCalledWith({ block_id: "page-1", page_size: 100 });
  });

  it("both provided and matching (with dash normalization) — proceeds", async () => {
    const client = makeMockClient();
    const result = await resolvePageIdAlias(client as any, {
      database_id: "12345678-1234-1234-1234-123456789abc",
      page_id: "12345678123412341234123456789abc",
    });
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("both provided and different — loud error", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { database_id: "db-aaa", page_id: "page-bbb" }),
    ).rejects.toThrow("database_id and page_id refer to different objects — pass one.");
  });

  it("page with 0 inline databases — error with guidance", async () => {
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-empty")) },
      blocks: {
        children: {
          list: vi.fn().mockResolvedValue({
            results: [
              { type: "paragraph", id: "blk-1" },
              { type: "heading_1", id: "blk-2" },
            ],
          }),
          append: vi.fn(),
        },
        delete: vi.fn(),
      },
    });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-empty" }),
    ).rejects.toThrow("no inline database — use list_databases");
  });

  it("page with 2 inline databases — error lists both candidates with titles", async () => {
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-multi")) },
      blocks: {
        children: {
          list: vi.fn().mockResolvedValue({
            results: [
              { type: "child_database", id: "db-alpha", child_database: { title: "Alpha DB" } },
              { type: "paragraph", id: "blk-1" },
              { type: "child_database", id: "db-beta", child_database: { title: "Beta DB" } },
            ],
          }),
          append: vi.fn(),
        },
        delete: vi.fn(),
      },
    });
    const error = await resolvePageIdAlias(client as any, { page_id: "page-multi" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("2 inline databases");
    expect(error.message).toContain("db-alpha (Alpha DB)");
    expect(error.message).toContain("db-beta (Beta DB)");
  });

  it("neither provided — error", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, {}),
    ).rejects.toThrow("Either database_id or page_id is required.");
  });

  it("cache: second resolution of same page_id makes no extra API call", async () => {
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-cached")) },
      blocks: {
        children: {
          list: vi.fn().mockResolvedValue({
            results: [
              { type: "child_database", id: "cached-db-1", child_database: { title: "Cached" } },
            ],
          }),
          append: vi.fn(),
        },
        delete: vi.fn(),
      },
    });

    const first = await resolvePageIdAlias(client as any, { page_id: "page-cached" });
    expect(first).toBe("cached-db-1");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
    expect(client.blocks.children.list).toHaveBeenCalledTimes(1);

    const second = await resolvePageIdAlias(client as any, { page_id: "page-cached" });
    expect(second).toBe("cached-db-1");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
    expect(client.blocks.children.list).toHaveBeenCalledTimes(1);
  });

  it("non-page-vs-database errors propagate unchanged", async () => {
    const original = new Error("rate limited");
    const client = makeMockClient({
      databases: { retrieve: vi.fn().mockRejectedValue(original) },
    });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-ratelimit" }),
    ).rejects.toBe(original);
  });
});

// --- Tool-level integration: verify wiring through MCP protocol ---

function makeFullNotion(dbRetrieve: any, blocksChildrenList?: any) {
  const dsId = "ds-for-tool-test";
  return {
    databases: {
      retrieve: typeof dbRetrieve === "function" ? dbRetrieve : vi.fn().mockResolvedValue(dbRetrieve),
      create: vi.fn(),
    },
    dataSources: {
      retrieve: vi.fn().mockResolvedValue({
        id: dsId,
        properties: { Name: { type: "title", title: {} } },
      }),
    },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(async () => ({ id: "page-new", url: "https://notion.so/page-new" })),
      update: vi.fn(),
      properties: { retrieve: vi.fn() },
    },
    blocks: {
      children: {
        list: blocksChildrenList ?? vi.fn().mockResolvedValue({ results: [] }),
        append: vi.fn(),
      },
      delete: vi.fn(),
    },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "page-id-alias-test", version: "1.0.0" },
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

describe("page_id alias — tool schemas", () => {
  it("all 5 database tools expose page_id in their schema", async () => {
    const notion = makeFullNotion({ id: "db-schema", data_sources: [{ id: "ds-schema" }] });
    const { client, close } = await connect(notion);
    try {
      const { tools } = await client.listTools();
      const targetTools = ["get_database", "query_database", "add_database_entry", "add_database_entries", "update_data_source"];
      for (const name of targetTools) {
        const tool = tools.find((t) => t.name === name);
        expect(tool, `${name} should exist`).toBeDefined();
        const props = (tool!.inputSchema as any).properties;
        expect(props.page_id, `${name} should have page_id`).toBeDefined();
        expect(props.page_id.type).toBe("string");
        expect(props.page_id.description).toContain("Alias");
      }
    } finally {
      await close();
    }
  });

  it("database_id is no longer required when page_id can substitute", async () => {
    const notion = makeFullNotion({ id: "db-req", data_sources: [{ id: "ds-req" }] });
    const { client, close } = await connect(notion);
    try {
      const { tools } = await client.listTools();
      for (const name of ["get_database", "query_database", "update_data_source"]) {
        const tool = tools.find((t) => t.name === name);
        const required = (tool!.inputSchema as any).required;
        expect(required ?? [], `${name} should not require database_id`).not.toContain("database_id");
      }
    } finally {
      await close();
    }
  });
});

describe("page_id alias — get_database tool wiring", () => {
  it("page_id resolves through to get_database result", async () => {
    const dbData = { id: "inline-db-wired", data_sources: [{ id: "ds-wired" }], title: [{ plain_text: "Wired DB" }], url: "https://notion.so/wired" };
    const dbRetrieve = vi.fn()
      .mockRejectedValueOnce(pageNotDatabaseError("page-wired"))
      .mockResolvedValue(dbData);
    const blocksChildrenList = vi.fn().mockResolvedValue({
      results: [
        { type: "child_database", id: "inline-db-wired", child_database: { title: "Wired DB" } },
      ],
    });
    const notion = makeFullNotion(dbRetrieve, blocksChildrenList);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "get_database",
        arguments: { page_id: "page-wired" },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.id).toBe("inline-db-wired");
    } finally {
      await close();
    }
  });

  it("both-conflicting returns error through tool", async () => {
    const notion = makeFullNotion({ id: "db-conflict", data_sources: [{ id: "ds-conflict" }] });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "get_database",
        arguments: { database_id: "db-one", page_id: "page-two" },
      });
      const text = parseToolText(result);
      expect(text).toContain("database_id and page_id refer to different objects");
    } finally {
      await close();
    }
  });
});

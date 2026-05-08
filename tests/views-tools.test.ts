import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

function parseToolJson<T>(result: { content?: Array<{ type: string; text?: string }> }): T {
  return JSON.parse(parseToolText(result)) as T;
}

function makeNotion() {
  return {
    views: {
      list: vi.fn(),
      retrieve: vi.fn(),
      queries: {
        create: vi.fn(),
        results: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "views-tools-test", version: "1.0.0" },
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

describe("Views MCP read tools", () => {
  it("lists read-only view tools with expected schemas", async () => {
    const { client, close } = await connect(makeNotion());

    try {
      const { tools } = await client.listTools();
      const listViews = tools.find((tool) => tool.name === "list_views");
      const getView = tools.find((tool) => tool.name === "get_view");
      const queryView = tools.find((tool) => tool.name === "query_view");

      expect(listViews?.inputSchema).toMatchObject({
        properties: {
          database_id: { type: "string" },
          data_source_id: { type: "string" },
          page_size: { type: "number" },
          start_cursor: { type: "string" },
        },
      });
      expect(getView?.inputSchema).toMatchObject({
        required: ["view_id"],
        properties: { view_id: { type: "string" } },
      });
      expect(queryView?.inputSchema).toMatchObject({
        required: ["view_id"],
        properties: {
          view_id: { type: "string" },
          page_size: { type: "number" },
          start_cursor: { type: "string" },
        },
      });
    } finally {
      await close();
    }
  });

  it("list_views validates exactly one parent identifier", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const missing = parseToolJson<{ error: string }>(
        await client.callTool({ name: "list_views", arguments: {} }),
      );
      const both = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "list_views",
          arguments: { database_id: "db-1", data_source_id: "ds-1" },
        }),
      );

      expect(missing.error).toContain("exactly one");
      expect(both.error).toContain("exactly one");
      expect(notion.views.list).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("list_views forwards database pagination parameters and returns raw response", async () => {
    const notion = makeNotion();
    const rawResponse = {
      object: "list",
      results: [{ object: "view", id: "view-1", type: "table" }],
      next_cursor: "next",
      has_more: true,
      type: "view",
      view: {},
    };
    notion.views.list.mockResolvedValue(rawResponse);
    const { client, close } = await connect(notion);

    try {
      const result = parseToolJson<typeof rawResponse>(
        await client.callTool({
          name: "list_views",
          arguments: { database_id: "db-1", page_size: 25, start_cursor: "cursor-1" },
        }),
      );

      expect(notion.views.list).toHaveBeenCalledWith({
        database_id: "db-1",
        page_size: 25,
        start_cursor: "cursor-1",
      });
      expect(result).toEqual(rawResponse);
    } finally {
      await close();
    }
  });

  it("list_views forwards data_source_id when provided", async () => {
    const notion = makeNotion();
    notion.views.list.mockResolvedValue({
      object: "list",
      results: [],
      next_cursor: null,
      has_more: false,
      type: "view",
      view: {},
    });
    const { client, close } = await connect(notion);

    try {
      await client.callTool({
        name: "list_views",
        arguments: { data_source_id: "ds-1" },
      });

      expect(notion.views.list).toHaveBeenCalledWith({ data_source_id: "ds-1" });
    } finally {
      await close();
    }
  });

  it("get_view retrieves by view_id and returns raw response", async () => {
    const notion = makeNotion();
    const rawResponse = {
      object: "view",
      id: "view-1",
      parent: { type: "database_id", database_id: "db-1" },
      name: "Table",
      type: "table",
    };
    notion.views.retrieve.mockResolvedValue(rawResponse);
    const { client, close } = await connect(notion);

    try {
      const result = parseToolJson<typeof rawResponse>(
        await client.callTool({ name: "get_view", arguments: { view_id: "view-1" } }),
      );

      expect(notion.views.retrieve).toHaveBeenCalledWith({ view_id: "view-1" });
      expect(result).toEqual(rawResponse);
    } finally {
      await close();
    }
  });

  it("query_view creates a query, fetches paginated results, deletes the query, and returns raw payloads", async () => {
    const notion = makeNotion();
    const query = {
      object: "view_query",
      id: "query-1",
      view_id: "view-1",
      expires_at: "2026-01-01T00:00:00.000Z",
      total_count: 2,
      results: [{ object: "page", id: "page-ref-1" }],
      next_cursor: "query-next",
      has_more: true,
    };
    const results = {
      object: "list",
      results: [{ object: "page", id: "page-1", properties: {} }],
      next_cursor: "next",
      has_more: true,
      type: "page",
      page: {},
    };
    notion.views.queries.create.mockResolvedValue(query);
    notion.views.queries.results.mockResolvedValue(results);
    notion.views.queries.delete.mockResolvedValue({
      object: "view_query",
      id: "query-1",
      deleted: true,
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolJson<{ query: typeof query; results: typeof results }>(
        await client.callTool({
          name: "query_view",
          arguments: { view_id: "view-1", page_size: 10, start_cursor: "cursor-1" },
        }),
      );

      expect(notion.views.queries.create).toHaveBeenCalledWith({
        view_id: "view-1",
        page_size: 10,
      });
      expect(notion.views.queries.results).toHaveBeenCalledWith({
        view_id: "view-1",
        query_id: "query-1",
        page_size: 10,
        start_cursor: "cursor-1",
      });
      expect(notion.views.queries.delete).toHaveBeenCalledWith({
        view_id: "view-1",
        query_id: "query-1",
      });
      expect(response).toEqual({ query, results });
      expect(notion.views.queries.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
        notion.views.queries.results.mock.invocationCallOrder[0],
      );
    } finally {
      await close();
    }
  });

  it("query_view deletes the temporary query when fetching results fails", async () => {
    const notion = makeNotion();
    notion.views.queries.create.mockResolvedValue({
      object: "view_query",
      id: "query-1",
      view_id: "view-1",
      expires_at: "2026-01-01T00:00:00.000Z",
      total_count: 0,
      results: [],
      next_cursor: null,
      has_more: false,
    });
    notion.views.queries.results.mockRejectedValue(new Error("results failed"));
    notion.views.queries.delete.mockResolvedValue({
      object: "view_query",
      id: "query-1",
      deleted: true,
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolJson<{ error: string }>(
        await client.callTool({ name: "query_view", arguments: { view_id: "view-1" } }),
      );

      expect(response.error).toContain("results failed");
      expect(notion.views.queries.delete).toHaveBeenCalledWith({
        view_id: "view-1",
        query_id: "query-1",
      });
    } finally {
      await close();
    }
  });
});

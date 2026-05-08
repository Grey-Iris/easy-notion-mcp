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
    databases: {
      retrieve: vi.fn(),
    },
    views: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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

describe("Views MCP tools", () => {
  it("lists view tools with expected schemas", async () => {
    const { client, close } = await connect(makeNotion());

    try {
      const { tools } = await client.listTools();
      const listViews = tools.find((tool) => tool.name === "list_views");
      const getView = tools.find((tool) => tool.name === "get_view");
      const queryView = tools.find((tool) => tool.name === "query_view");
      const createView = tools.find((tool) => tool.name === "create_view");
      const updateView = tools.find((tool) => tool.name === "update_view");
      const deleteView = tools.find((tool) => tool.name === "delete_view");

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
      expect(createView?.inputSchema).toMatchObject({
        required: ["database_id", "name", "type"],
        properties: {
          database_id: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["table", "board", "list", "calendar", "timeline", "gallery", "form", "chart", "map"],
          },
          filter: { type: "object" },
          sorts: { type: "array" },
          quick_filters: { type: "object" },
          configuration: { type: "object" },
          position: { type: "object" },
        },
      });
      expect(createView?.inputSchema.properties).not.toHaveProperty("placement");
      expect(createView?.inputSchema.properties).not.toHaveProperty("view_id");
      expect(updateView?.inputSchema).toMatchObject({
        required: ["view_id"],
        properties: {
          view_id: { type: "string" },
          name: { type: "string" },
          filter: { anyOf: [{ type: "object" }, { type: "null" }] },
          sorts: { anyOf: [{ type: "array", items: { type: "object" } }, { type: "null" }] },
          quick_filters: { anyOf: [{ type: "object" }, { type: "null" }] },
          configuration: { type: "object" },
        },
      });
      expect(deleteView?.inputSchema).toMatchObject({
        required: ["view_id", "confirm"],
        properties: {
          view_id: { type: "string" },
          confirm: { type: "boolean" },
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

  it("create_view validates database_id and rejects data_source_id", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const missing = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: { name: "Table", type: "table" },
        }),
      );
      const dataSourceId = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: { data_source_id: "ds-1", name: "Table", type: "table" },
        }),
      );

      expect(missing.error).toContain("database_id");
      expect(dataSourceId.error).toContain("data_source_id");
      expect(notion.views.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("create_view forwards database_id and maps compact response", async () => {
    const notion = makeNotion();
    notion.databases.retrieve.mockResolvedValue({ id: "db-1", data_sources: [{ id: "ds-1" }] });
    notion.views.create.mockResolvedValue({
      object: "view",
      id: "view-1",
      name: "Table",
      type: "table",
      url: "https://notion.so/view-1",
      data_source_id: "ds-1",
      extra: "ignored",
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolJson<Record<string, unknown>>(
        await client.callTool({
          name: "create_view",
          arguments: { database_id: "db-1", name: "Table", type: "table" },
        }),
      );

      expect(notion.databases.retrieve).toHaveBeenCalledWith({ database_id: "db-1" });
      expect(notion.views.create).toHaveBeenCalledWith({
        database_id: "db-1",
        data_source_id: "ds-1",
        name: "Table",
        type: "table",
      });
      expect(response).toEqual({
        id: "view-1",
        object: "view",
        name: "Table",
        type: "table",
        url: "https://notion.so/view-1",
        data_source_id: "ds-1",
      });
    } finally {
      await close();
    }
  });

  it("create_view rejects dashboard type, dashboard config, and dashboard widget fields", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const dashboardType = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: { database_id: "db-1", name: "Dashboard", type: "dashboard" },
        }),
      );
      const dashboardConfig = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: {
            database_id: "db-1",
            name: "Table",
            type: "table",
            configuration: { type: "dashboard" },
          },
        }),
      );
      const placement = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: {
            database_id: "db-1",
            name: "Table",
            type: "table",
            placement: { type: "new_row" },
          },
        }),
      );
      const widgetViewId = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "create_view",
          arguments: {
            database_id: "db-1",
            name: "Table",
            type: "table",
            view_id: "view-widget",
          },
        }),
      );

      expect(dashboardType.error).toContain("dashboard");
      expect(dashboardConfig.error).toContain("dashboard");
      expect(placement.error).toContain("placement");
      expect(widgetViewId.error).toContain("view_id");
      expect(notion.views.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("create_view forwards raw optional fields and maps compact response", async () => {
    const notion = makeNotion();
    notion.databases.retrieve.mockResolvedValue({ id: "db-1", data_sources: [{ id: "ds-1" }] });
    const filter = { property: "Status", select: { equals: "Todo" } };
    const sorts = [{ property: "Due", direction: "ascending" }];
    const quickFilters = { Mine: { people: { contains: "user-1" } } };
    const configuration = { type: "table", properties: [{ property_id: "title", visible: true }] };
    const position = { type: "after_view", view_id: "view-0" };
    notion.views.create.mockResolvedValue({
      object: "view",
      id: "view-1",
      name: "Roadmap",
      type: "table",
      url: "https://notion.so/view-1",
      data_source_id: "ds-1",
      filter: {},
      sorts: [],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolJson<Record<string, unknown>>(
        await client.callTool({
          name: "create_view",
          arguments: {
            database_id: "db-1",
            name: "Roadmap",
            type: "table",
            filter,
            sorts,
            quick_filters: quickFilters,
            configuration,
            position,
          },
        }),
      );

      expect(notion.views.create).toHaveBeenCalledWith({
        database_id: "db-1",
        data_source_id: "ds-1",
        name: "Roadmap",
        type: "table",
        filter,
        sorts,
        quick_filters: quickFilters,
        configuration,
        position,
      });
      expect(response).toEqual({
        id: "view-1",
        object: "view",
        name: "Roadmap",
        type: "table",
        url: "https://notion.so/view-1",
        data_source_id: "ds-1",
      });
    } finally {
      await close();
    }
  });

  it("update_view rejects empty update and dashboard config", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const empty = parseToolJson<{ error: string }>(
        await client.callTool({ name: "update_view", arguments: { view_id: "view-1" } }),
      );
      const dashboardConfig = parseToolJson<{ error: string }>(
        await client.callTool({
          name: "update_view",
          arguments: { view_id: "view-1", configuration: { type: "dashboard" } },
        }),
      );

      expect(empty.error).toContain("at least one");
      expect(dashboardConfig.error).toContain("dashboard");
      expect(notion.views.update).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("update_view forwards null clears and raw fields, then maps compact response", async () => {
    const notion = makeNotion();
    const quickFilters = { Urgent: null };
    const configuration = { type: "table", wrap_cells: true };
    notion.views.update.mockResolvedValue({
      object: "view",
      id: "view-1",
      name: "Updated",
      type: "table",
      url: "https://notion.so/view-1",
      data_source_id: "ds-1",
      filter: null,
      sorts: null,
      quick_filters: null,
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolJson<Record<string, unknown>>(
        await client.callTool({
          name: "update_view",
          arguments: {
            view_id: "view-1",
            name: "Updated",
            filter: null,
            sorts: null,
            quick_filters: quickFilters,
            configuration,
          },
        }),
      );

      expect(notion.views.update).toHaveBeenCalledWith({
        view_id: "view-1",
        name: "Updated",
        filter: null,
        sorts: null,
        quick_filters: quickFilters,
        configuration,
      });
      expect(response).toEqual({
        id: "view-1",
        object: "view",
        name: "Updated",
        type: "table",
        url: "https://notion.so/view-1",
        data_source_id: "ds-1",
      });
    } finally {
      await close();
    }
  });

  it("delete_view requires confirm true, calls SDK delete, and maps response", async () => {
    const notion = makeNotion();
    notion.views.delete.mockResolvedValue({
      object: "view",
      id: "view-1",
      type: "table",
      parent: { type: "database_id", database_id: "db-1" },
    });
    const { client, close } = await connect(notion);

    try {
      const missingConfirm = parseToolJson<{ error: string }>(
        await client.callTool({ name: "delete_view", arguments: { view_id: "view-1" } }),
      );
      expect(missingConfirm.error).toContain("confirm");
      expect(notion.views.delete).not.toHaveBeenCalled();

      const response = parseToolJson<Record<string, unknown>>(
        await client.callTool({
          name: "delete_view",
          arguments: { view_id: "view-1", confirm: true },
        }),
      );

      expect(notion.views.delete).toHaveBeenCalledWith({ view_id: "view-1" });
      expect(response).toEqual({
        success: true,
        deleted: "view-1",
        view: {
          id: "view-1",
          object: "view",
          type: "table",
        },
      });
    } finally {
      await close();
    }
  });
});

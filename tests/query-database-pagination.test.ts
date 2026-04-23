import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

function parseToolJson<T>(result: { content?: Array<{ type: string; text?: string }> }): T {
  return JSON.parse(parseToolText(result)) as T;
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "query-database-pagination-test", version: "1.0.0" },
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

type QueryDatabaseResponse = {
  results: Array<Record<string, unknown>>;
  warnings?: Array<{
    code: string;
    properties: Array<{
      name: string;
      type: string;
      returned_count: number;
      cap: number;
    }>;
    how_to_fetch_all?: string;
  }>;
};

const relationValues = (count: number, prefix = "target") => (
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }))
);

const relationItems = (count: number, prefix = "target") => (
  relationValues(count, prefix).map((relation) => ({
    object: "property_item",
    id: "p-ref",
    type: "relation",
    relation,
  }))
);

function makeQueryPage(id: string, relationCount: number) {
  return {
    id,
    object: "page",
    properties: {
      Ref: {
        id: "p-ref",
        type: "relation",
        relation: relationValues(relationCount),
      },
    },
  };
}

function makeNotionStub(opts: {
  rows: any[];
  retrievePages?: Array<{
    results: any[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
}) {
  const notion = {
    databases: {
      retrieve: vi.fn(async () => ({
        id: "db-1",
        data_sources: [{ id: "ds-1" }],
      })),
    },
    dataSources: {
      query: vi.fn(async () => ({
        results: opts.rows,
        has_more: false,
        next_cursor: null,
      })),
    },
    pages: {
      properties: {
        retrieve: vi.fn(async () => {
          const next = opts.retrievePages?.shift();
          if (!next) {
            throw new Error("unexpected pages.properties.retrieve call");
          }
          return next;
        }),
      },
    },
  };

  return notion;
}

describe("query_database property pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 30-item relation under the default cap with no warnings", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [{
        results: relationItems(30),
        has_more: false,
        next_cursor: null,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({ name: "query_database", arguments: { database_id: "db-1" } }),
      );

      expect(Array.isArray(result)).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].Ref).toHaveLength(30);
      expect(result.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("caps a 200-item relation at 75 by default and emits one warning", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [
        {
          results: relationItems(75),
          has_more: true,
          next_cursor: "c1",
        },
        {
          results: relationItems(75, "target-page-2"),
          has_more: true,
          next_cursor: "c2",
        },
        {
          results: relationItems(50, "target-page-3"),
          has_more: false,
          next_cursor: null,
        },
      ],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({ name: "query_database", arguments: { database_id: "db-1" } }),
      );

      expect(result.results[0].Ref).toHaveLength(75);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0].code).toBe("truncated_properties");
      expect(result.warnings?.[0].properties).toHaveLength(1);
      expect(result.warnings?.[0].properties[0]).toEqual({
        name: "Ref",
        type: "relation",
        returned_count: 75,
        cap: 75,
      });
      expect(result.warnings?.[0].how_to_fetch_all).toContain("max_property_items");
      expect(notion.pages.properties.retrieve).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it("fetches a 300-item relation with max_property_items set to 0", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [
        {
          results: relationItems(100, "target-page-1"),
          has_more: true,
          next_cursor: "c1",
        },
        {
          results: relationItems(100, "target-page-2"),
          has_more: true,
          next_cursor: "c2",
        },
        {
          results: relationItems(100, "target-page-3"),
          has_more: false,
          next_cursor: null,
        },
      ],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({
          name: "query_database",
          arguments: { database_id: "db-1", max_property_items: 0 },
        }),
      );

      expect(result.results[0].Ref).toHaveLength(300);
      expect(result.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("uses an explicit max_property_items cap", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [{
        results: relationItems(50),
        has_more: true,
        next_cursor: "c1",
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({
          name: "query_database",
          arguments: { database_id: "db-1", max_property_items: 25 },
        }),
      );

      expect(result.results[0].Ref).toHaveLength(25);
      expect(result.warnings?.[0].properties[0].cap).toBe(25);
    } finally {
      await close();
    }
  });

  it("rejects negative max_property_items before fetching page properties", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [{
        results: relationItems(30),
        has_more: false,
        next_cursor: null,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<{ error?: string }>(
        await client.callTool({
          name: "query_database",
          arguments: { database_id: "db-1", max_property_items: -1 },
        }),
      );

      expect(result.error).toContain("max_property_items");
      expect(notion.pages.properties.retrieve).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("wraps zero-warning responses with exactly a results key", async () => {
    const notion = makeNotionStub({
      rows: [
        makeQueryPage("page-1", 1),
        makeQueryPage("page-2", 2),
        makeQueryPage("page-3", 3),
      ],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({ name: "query_database", arguments: { database_id: "db-1" } }),
      );

      expect(Array.isArray(result)).toBe(false);
      expect(Object.keys(result)).toEqual(["results"]);
      expect(result.results).toHaveLength(3);
      expect(result.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("wraps warning responses with results and warnings keys", async () => {
    const notion = makeNotionStub({
      rows: [makeQueryPage("page-1", 25)],
      retrievePages: [{
        results: relationItems(75),
        has_more: true,
        next_cursor: "c1",
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<QueryDatabaseResponse>(
        await client.callTool({ name: "query_database", arguments: { database_id: "db-1" } }),
      );

      expect(Array.isArray(result)).toBe(false);
      expect(Object.keys(result)).toEqual(["results", "warnings"]);
      expect(result.results).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

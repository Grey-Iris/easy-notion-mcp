import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

type Schema = Record<string, { type: string }>;

/**
 * Decorate a flat properties object (Notion-write-shape, e.g.
 * `{Ref: {relation: [{id}]}}`) with the `type` discriminator the read path
 * expects (e.g. `{Ref: {type: "relation", relation: [{id}]}}`). Driven by the
 * test's fixed schema; mirrors Notion's on-the-wire shape closely enough that
 * `simplifyProperty` dispatches correctly when the stored page is read back
 * via `dataSources.query`.
 */
function decorateWithTypes(
  properties: Record<string, any>,
  schema: Schema,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(properties)) {
    const type = schema[key]?.type ?? "rich_text";
    out[key] = { type, ...value };
  }
  return out;
}

let counter = 0;
const freshDbId = (tag: string) => `db-rt-${tag}-${++counter}`;

/**
 * Build a stateful Notion mock backed by a single `pageStore` Map.
 *
 * `pages.create` and `pages.update` persist page state; `dataSources.query`
 * returns whatever is in the store. So whatever the handler writes is what
 * the read path reads — no false-green from hardcoded query results.
 */
function makeStatefulNotion(opts: { dbId: string; schema: Schema }) {
  const dsId = `ds-for-${opts.dbId}`;
  const pageStore = new Map<string, any>();

  const notion = {
    databases: {
      retrieve: vi.fn(async () => ({
        id: opts.dbId,
        data_sources: [{ id: dsId }],
      })),
      create: vi.fn(),
    },
    dataSources: {
      retrieve: vi.fn(async () => ({ properties: opts.schema })),
      query: vi.fn(async () => ({ results: Array.from(pageStore.values()) })),
    },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => {
        const stored = pageStore.get(page_id);
        if (stored) return stored;
        // For update_database_entry's parent-resolution lookup before write.
        return {
          id: page_id,
          parent: { type: "database_id", database_id: opts.dbId },
        };
      }),
      create: vi.fn(async ({ properties }: any) => {
        const id = `page-${pageStore.size + 1}`;
        const stored = {
          id,
          url: `https://notion.so/${id}`,
          parent: { type: "data_source_id", database_id: opts.dbId },
          properties: decorateWithTypes(properties, opts.schema),
        };
        pageStore.set(id, stored);
        return stored;
      }),
      update: vi.fn(async ({ page_id, properties }: any) => {
        const existing = pageStore.get(page_id);
        if (!existing) {
          throw new Error(`update on non-existent page ${page_id}`);
        }
        const merged = {
          ...existing,
          properties: {
            ...existing.properties,
            ...decorateWithTypes(properties, opts.schema),
          },
        };
        pageStore.set(page_id, merged);
        return merged;
      }),
    },
    blocks: { children: { list: vi.fn(), append: vi.fn() }, delete: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };

  return { notion, pageStore };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "relation-roundtrip-test", version: "1.0.0" },
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

describe("relation property — round-trip through write + read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const schema: Schema = {
    Name: { type: "title" },
    Ref: { type: "relation" },
  };

  it("I-1: round-trips a single relation ID through add_database_entry + query_database", async () => {
    const dbId = freshDbId("i1");
    const { notion } = makeStatefulNotion({ dbId, schema });
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "row1", Ref: "target-id-a" } },
      });
      const createCall = notion.pages.create.mock.calls[0][0];
      expect(createCall.properties.Ref).toEqual({ relation: [{ id: "target-id-a" }] });

      const queryResult = await client.callTool({
        name: "query_database",
        arguments: { database_id: dbId },
      });
      const parsed = JSON.parse(parseToolText(queryResult));
      const rows = parsed.results;
      expect(rows).toHaveLength(1);
      expect(rows[0].Ref).toEqual(["target-id-a"]);
    } finally {
      await close();
    }
  });

  it("I-2: round-trips an array of relation IDs", async () => {
    const dbId = freshDbId("i2");
    const { notion } = makeStatefulNotion({ dbId, schema });
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "add_database_entry",
        arguments: {
          database_id: dbId,
          properties: { Name: "row1", Ref: ["id-a", "id-b"] },
        },
      });
      const createCall = notion.pages.create.mock.calls[0][0];
      expect(createCall.properties.Ref).toEqual({
        relation: [{ id: "id-a" }, { id: "id-b" }],
      });

      const queryResult = await client.callTool({
        name: "query_database",
        arguments: { database_id: dbId },
      });
      const parsed = JSON.parse(parseToolText(queryResult));
      const rows = parsed.results;
      expect(rows).toHaveLength(1);
      expect(rows[0].Ref).toEqual(["id-a", "id-b"]);
    } finally {
      await close();
    }
  });

  it("I-3: round-trips an empty relation", async () => {
    const dbId = freshDbId("i3");
    const { notion } = makeStatefulNotion({ dbId, schema });
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "row1", Ref: [] } },
      });
      const createCall = notion.pages.create.mock.calls[0][0];
      expect(createCall.properties.Ref).toEqual({ relation: [] });

      const queryResult = await client.callTool({
        name: "query_database",
        arguments: { database_id: dbId },
      });
      const parsed = JSON.parse(parseToolText(queryResult));
      const rows = parsed.results;
      expect(rows).toHaveLength(1);
      expect(rows[0].Ref).toEqual([]);
    } finally {
      await close();
    }
  });

  it("I-4: round-trips relation update via update_database_entry", async () => {
    const dbId = freshDbId("i4");
    const { notion } = makeStatefulNotion({ dbId, schema });
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "row1", Ref: "id-a" } },
      });
      const createdId = JSON.parse(parseToolText(createResult)).id;

      await client.callTool({
        name: "update_database_entry",
        arguments: { page_id: createdId, properties: { Ref: "id-b" } },
      });
      const updateCall = notion.pages.update.mock.calls[0][0];
      expect(updateCall.properties.Ref).toEqual({ relation: [{ id: "id-b" }] });

      const queryResult = await client.callTool({
        name: "query_database",
        arguments: { database_id: dbId },
      });
      const parsed = JSON.parse(parseToolText(queryResult));
      const rows = parsed.results;
      expect(rows).toHaveLength(1);
      expect(rows[0].Ref).toEqual(["id-b"]);
    } finally {
      await close();
    }
  });
});

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

type StoredSchema = Record<string, { type: string; [key: string]: unknown }>;

function inferSchemaType(config: Record<string, unknown>) {
  return (
    (typeof config.type === "string" ? config.type : undefined) ??
    Object.keys(config).find((key) => key !== "type" && key !== "description") ??
    "unknown"
  );
}

function hydrateSchema(properties: Record<string, Record<string, unknown>>): StoredSchema {
  const out: StoredSchema = {};
  for (const [name, config] of Object.entries(properties ?? {})) {
    out[name] = { type: inferSchemaType(config), ...config };
  }
  return out;
}

function decorateWithTypes(
  properties: Record<string, any>,
  schema: StoredSchema,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(properties)) {
    const type = schema[key]?.type ?? "rich_text";
    out[key] = { type, ...value };
  }
  return out;
}

let counter = 0;
const freshDbId = (tag: string) => `db-prop-rt-${tag}-${++counter}`;

function makeStatefulNotion(dbId: string) {
  const dsId = `ds-for-${dbId}`;
  const pageStore = new Map<string, any>();
  let title = "Untitled";
  let schema: StoredSchema = {};

  const notion = {
    databases: {
      retrieve: vi.fn(async ({ database_id }: any) => ({
        id: database_id,
        title: [{ plain_text: title }],
        url: `https://notion.so/${database_id}`,
        data_sources: [{ id: dsId }],
      })),
      create: vi.fn(async (body: any) => {
        title = body.title?.[0]?.text?.content ?? title;
        schema = hydrateSchema(body.initial_data_source?.properties ?? {});
        return {
          id: dbId,
          url: `https://notion.so/${dbId}`,
        };
      }),
    },
    dataSources: {
      retrieve: vi.fn(async ({ data_source_id }: any) => ({
        id: data_source_id,
        properties: schema,
      })),
      query: vi.fn(async () => ({ results: Array.from(pageStore.values()) })),
      update: vi.fn(),
    },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => {
        const stored = pageStore.get(page_id);
        if (stored) return stored;
        return {
          id: page_id,
          parent: { type: "database_id", database_id: dbId },
        };
      }),
      create: vi.fn(async ({ properties }: any) => {
        const id = `page-${pageStore.size + 1}`;
        const stored = {
          id,
          url: `https://notion.so/${id}`,
          parent: { type: "data_source_id", database_id: dbId },
          properties: decorateWithTypes(properties, schema),
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
            ...decorateWithTypes(properties, schema),
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
    { name: "property-roundtrip-test", version: "1.0.0" },
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

describe("property schema roundtrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips a formula schema", async () => {
    const dbId = freshDbId("formula");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Formula DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Score", type: "formula", expression: 'prop("Count") * 2' },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.Score).toEqual({
        formula: { expression: 'prop("Count") * 2' },
      });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Score", type: "formula" })]),
      );
    } finally {
      await close();
    }
  });

  it("round-trips a rollup schema", async () => {
    const dbId = freshDbId("rollup");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Rollup DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            {
              name: "TotalHours",
              type: "rollup",
              function: "sum",
              relation_property: "Tasks",
              rollup_property: "Hours",
            },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.TotalHours).toEqual({
        rollup: {
          function: "sum",
          relation_property_name: "Tasks",
          rollup_property_name: "Hours",
        },
      });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "TotalHours", type: "rollup" })]),
      );
    } finally {
      await close();
    }
  });

  it("round-trips relation schemas for single_property and dual_property", async () => {
    const dbId = freshDbId("relation");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Relation DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Links", type: "relation", data_source_id: "ds-target" },
            {
              name: "Mirror",
              type: "relation",
              data_source_id: "ds-target",
              relation_type: "dual_property",
              synced_property_name: "Source",
            },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.Links).toEqual({
        relation: {
          data_source_id: `ds-for-${dbId}`,
          type: "single_property",
          single_property: {},
        },
      });
      expect(createCall.initial_data_source.properties.Mirror).toEqual({
        relation: {
          data_source_id: `ds-for-${dbId}`,
          type: "dual_property",
          dual_property: { synced_property_name: "Source" },
        },
      });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Links", type: "relation" }),
          expect.objectContaining({ name: "Mirror", type: "relation" }),
        ]),
      );
    } finally {
      await close();
    }
  });

  it("round-trips unique_id schemas with and without prefix", async () => {
    const dbId = freshDbId("unique");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Unique DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Ticket", type: "unique_id", prefix: "ENG" },
            { name: "Counter", type: "unique_id" },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.Ticket).toEqual({
        unique_id: { prefix: "ENG" },
      });
      expect(createCall.initial_data_source.properties.Counter).toEqual({
        unique_id: {},
      });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Ticket", type: "unique_id" }),
          expect.objectContaining({ name: "Counter", type: "unique_id" }),
        ]),
      );
    } finally {
      await close();
    }
  });

  it("round-trips people schema and values through add_database_entry and query_database", async () => {
    const dbId = freshDbId("people");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "People DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Owner", type: "people" },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);

      const addResult = parseToolJson<{ id?: string; error?: string }>(
        await client.callTool({
          name: "add_database_entry",
          arguments: {
            database_id: created.id,
            properties: { Task: "row1", Owner: "user-1" },
          },
        }),
      );
      expect(addResult.error).toBeUndefined();

      const createCall = notion.pages.create.mock.calls[0][0];
      expect(createCall.properties.Owner).toEqual({ people: [{ id: "user-1" }] });

      const rows = parseToolJson<Array<Record<string, unknown>>>(
        await client.callTool({ name: "query_database", arguments: { database_id: created.id } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({ Owner: ["user-1"] }));
    } finally {
      await close();
    }
  });

  it("round-trips files and verification schemas", async () => {
    const dbId = freshDbId("schema-only");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Schema Only DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Attachments", type: "files" },
            { name: "Verified", type: "verification" },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.Attachments).toEqual({ files: {} });
      expect(createCall.initial_data_source.properties.Verified).toEqual({ verification: {} });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Attachments", type: "files" }),
          expect.objectContaining({ name: "Verified", type: "verification" }),
        ]),
      );
    } finally {
      await close();
    }
  });

  it("round-trips number format and select-like options", async () => {
    const dbId = freshDbId("options");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const createResult = await client.callTool({
        name: "create_database",
        arguments: {
          title: "Options DB",
          parent_page_id: "parent-1",
          schema: [
            { name: "Task", type: "title" },
            { name: "Price", type: "number", format: "dollar" },
            { name: "State", type: "select", options: ["Todo", "Done"] },
            { name: "Tags", type: "multi_select", options: [{ name: "A", color: "blue" }] },
            { name: "Status", type: "status", options: ["Todo", "Doing", "Done"] },
          ],
        },
      });
      const created = parseToolJson<{ id: string }>(createResult);
      const createCall = notion.databases.create.mock.calls[0][0];
      expect(createCall.initial_data_source.properties.Price).toEqual({
        number: { format: "dollar" },
      });
      expect(createCall.initial_data_source.properties.State).toEqual({
        select: { options: [{ name: "Todo" }, { name: "Done" }] },
      });
      expect(createCall.initial_data_source.properties.Tags).toEqual({
        multi_select: { options: [{ name: "A", color: "blue" }] },
      });
      expect(createCall.initial_data_source.properties.Status).toEqual({
        status: { options: [{ name: "Todo" }, { name: "Doing" }, { name: "Done" }] },
      });

      const database = parseToolJson<{ properties: Array<{ name: string; type: string; options?: string[] }> }>(
        await client.callTool({ name: "get_database", arguments: { database_id: created.id } }),
      );
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Price", type: "number" }),
          expect.objectContaining({ name: "State", type: "select", options: ["Todo", "Done"] }),
          expect.objectContaining({ name: "Tags", type: "multi_select", options: ["A"] }),
          expect.objectContaining({ name: "Status", type: "status", options: ["Todo", "Doing", "Done"] }),
        ]),
      );
    } finally {
      await close();
    }
  });

  it("rejects unknown schema types before any SDK call", async () => {
    const dbId = freshDbId("unknown");
    const { notion } = makeStatefulNotion(dbId);
    const { client, close } = await connect(notion);
    try {
      const result = parseToolJson<{ error?: string }>(
        await client.callTool({
          name: "create_database",
          arguments: {
            title: "Unknown DB",
            parent_page_id: "parent-1",
            schema: [
              { name: "Task", type: "title" },
              { name: "Mystery", type: "this_is_not_a_real_type" },
            ],
          },
        }),
      );

      expect(result.error).toMatch(/this_is_not_a_real_type|title|formula|relation/);
      expect(notion.databases.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

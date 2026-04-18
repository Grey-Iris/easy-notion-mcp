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
 * Build a mock Notion client. Each test should use a unique `dbId` so the
 * module-scope schemaCache and dataSourceIdCache don't cross-contaminate.
 *
 * `schemaProvider` returns the schema that `dataSources.retrieve` should yield
 * on each call. Tests that need stale-then-fresh behavior can close over a
 * mutable variable and return different schemas on successive invocations.
 */
function makeNotion(opts: {
  dbId: string;
  schemaProvider: () => Schema;
  pageDbId?: string;
}) {
  const dsId = `ds-for-${opts.dbId}`;
  const pageDbId = opts.pageDbId ?? opts.dbId;

  return {
    databases: {
      retrieve: vi.fn(async () => ({
        id: opts.dbId,
        data_sources: [{ id: dsId }],
      })),
      create: vi.fn(),
    },
    dataSources: {
      retrieve: vi.fn(async () => ({ properties: opts.schemaProvider() })),
    },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => ({
        id: page_id,
        parent: { type: "database_id", database_id: pageDbId },
      })),
      create: vi.fn(async (body: any) => ({
        id: "created-page",
        url: "https://notion.so/created-page",
        properties: body.properties,
      })),
      update: vi.fn(async ({ page_id, properties }: any) => ({
        id: page_id,
        url: `https://notion.so/${page_id}`,
        properties,
      })),
    },
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
    { name: "db-strictness-test", version: "1.0.0" },
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

let counter = 0;
const freshDbId = (tag: string) => `db-${tag}-${++counter}`;

const titleSchema = { Name: { type: "title" } };
const titleAndSelectSchema = { Name: { type: "title" }, Status: { type: "select" } };

describe("Database write strictness — unknown keys (G-4a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G4a-1: single unknown key — response contains rejected key, valid keys, and pages.create is not called", async () => {
    const dbId = freshDbId("a1");
    const notion = makeNotion({ dbId, schemaProvider: () => titleAndSelectSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Statusx: "y" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Statusx'");
      expect(text).toContain("'Name'");
      expect(text).toContain("'Status'");
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4a-2: two unknown keys — both named in error", async () => {
    const dbId = freshDbId("a2");
    const notion = makeNotion({ dbId, schemaProvider: () => titleAndSelectSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: {
          database_id: dbId,
          properties: { Name: "x", Statusx: "y", Foo: "z" },
        },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Statusx'");
      expect(text).toContain("'Foo'");
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4a-3: all-valid keys — success (regression guard)", async () => {
    const dbId = freshDbId("a3");
    const notion = makeNotion({ dbId, schemaProvider: () => titleAndSelectSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Status: "Todo" } },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.id).toBe("created-page");
      expect(notion.pages.create).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it("G4a-4: update_database_entry with unknown key — error names key, lists valid keys, pages.update NOT called", async () => {
    const dbId = freshDbId("a4");
    const notion = makeNotion({ dbId, schemaProvider: () => titleAndSelectSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_database_entry",
        arguments: { page_id: "row-1", properties: { BadKey: "v" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'BadKey'");
      expect(text).toContain("'Name'");
      expect(text).toContain("'Status'");
      expect(notion.pages.update).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4a-5: add_database_entries sandwich [good, bad, good] — loop continues past throw", async () => {
    const dbId = freshDbId("a5");
    const notion = makeNotion({ dbId, schemaProvider: () => titleAndSelectSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entries",
        arguments: {
          database_id: dbId,
          entries: [
            { Name: "ok-0" },
            { Name: "ok-1", BadKey: "v" },
            { Name: "ok-2" },
          ],
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.succeeded).toHaveLength(2);
      expect(response.failed).toHaveLength(1);
      expect(response.failed[0].index).toBe(1);
      expect(response.failed[0].error).toContain("'BadKey'");
    } finally {
      await close();
    }
  });

  it("G4a-6: stale-cache bust — user adds a property in Notion UI, next call succeeds after refetch", async () => {
    const dbId = freshDbId("a6");
    let schemaVersion: Schema = { Name: { type: "title" } };
    const notion = makeNotion({ dbId, schemaProvider: () => schemaVersion });
    const { client, close } = await connect(notion);
    try {
      // Step 1: prime the cache with v1 schema (only Name).
      const firstResult = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "primer" } },
      });
      expect(JSON.parse(parseToolText(firstResult)).id).toBe("created-page");

      // Step 2: the Notion UI gets a new property; next retrieve returns v2.
      schemaVersion = { Name: { type: "title" }, New: { type: "rich_text" } };

      // Step 3: write with the new key — should succeed after bust + refetch.
      const secondResult = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "fresh", New: "value" } },
      });
      const response = JSON.parse(parseToolText(secondResult));
      expect(response.id).toBe("created-page");

      // The most recent pages.create call must include BOTH properties.
      const lastCall = notion.pages.create.mock.calls.at(-1)![0];
      expect(Object.keys(lastCall.properties)).toEqual(
        expect.arrayContaining(["Name", "New"]),
      );
    } finally {
      await close();
    }
  });

  it("G4a-7: genuine unknown still throws after bust — both retrieves return same stale schema", async () => {
    const dbId = freshDbId("a7");
    const notion = makeNotion({ dbId, schemaProvider: () => titleSchema });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Typo: "y" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Typo'");
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe("Database write strictness — unsupported property types (G-4b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G5a-1: relation property write succeeds — pages.create called with relation: [{id}]", async () => {
    const dbId = freshDbId("b1");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Ref: { type: "relation" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Ref: "abc" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("created-page");
      expect(notion.pages.create).toHaveBeenCalledTimes(1);
      const callArgs = notion.pages.create.mock.calls[0][0];
      expect(callArgs.properties.Ref).toEqual({ relation: [{ id: "abc" }] });
    } finally {
      await close();
    }
  });

  it("G4b-2: people property — 'does not support', NO future-release promise", async () => {
    const dbId = freshDbId("b2");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Owner: { type: "people" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Owner: "uid" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Owner'");
      expect(text).toContain("people");
      expect(text).toMatch(/does not support/i);
      expect(text).not.toMatch(/future release/i);
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4b-3: files property — 'does not support', NO future-release promise", async () => {
    const dbId = freshDbId("b3");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Attachments: { type: "files" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Attachments: "p" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Attachments'");
      expect(text).toContain("files");
      expect(text).toMatch(/does not support/i);
      expect(text).not.toMatch(/future release/i);
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4b-4: formula property — 'computed by Notion'", async () => {
    const dbId = freshDbId("b4");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Total: { type: "formula" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Total: "1" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Total'");
      expect(text).toContain("formula");
      expect(text).toMatch(/computed by Notion/i);
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G4b-5: rollup property — 'computed by Notion'", async () => {
    const dbId = freshDbId("b5");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Summary: { type: "rollup" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Summary: "1" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Summary'");
      expect(text).toContain("rollup");
      expect(text).toMatch(/computed by Notion/i);
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it.each([
    "created_time",
    "last_edited_time",
    "created_by",
    "last_edited_by",
    "unique_id",
    "verification",
  ])("G4b-6: %s property — 'computed by Notion'", async (typeName) => {
    const dbId = freshDbId(`b6-${typeName}`);
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Field: { type: typeName } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entry",
        arguments: { database_id: dbId, properties: { Name: "x", Field: "v" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("'Field'");
      expect(text).toContain(typeName);
      expect(text).toMatch(/computed by Notion/i);
      expect(notion.pages.create).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("G5a-7: update_database_entry with relation property succeeds — pages.update called with relation: [{id}]", async () => {
    const dbId = freshDbId("b7");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Ref: { type: "relation" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_database_entry",
        arguments: { page_id: "row-1", properties: { Ref: "abc" } },
      });
      const text = parseToolText(result);
      expect(text).toContain("row-1");
      expect(notion.pages.update).toHaveBeenCalledTimes(1);
      const callArgs = notion.pages.update.mock.calls[0][0];
      expect(callArgs.properties.Ref).toEqual({ relation: [{ id: "abc" }] });
    } finally {
      await close();
    }
  });

  it("G4b-8: add_database_entries sandwich [good, bad(people), good] — loop continues after throw", async () => {
    const dbId = freshDbId("b8");
    const notion = makeNotion({
      dbId,
      schemaProvider: () => ({ Name: { type: "title" }, Owner: { type: "people" } }),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "add_database_entries",
        arguments: {
          database_id: dbId,
          entries: [
            { Name: "ok-0" },
            { Name: "ok-1", Owner: "uid" },
            { Name: "ok-2" },
          ],
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.succeeded).toHaveLength(2);
      expect(response.failed).toHaveLength(1);
      expect(response.failed[0].index).toBe(1);
      expect(response.failed[0].error).toMatch(/people/);
      expect(response.failed[0].error).toMatch(/does not support/i);
    } finally {
      await close();
    }
  });
});

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

/** The structured shape Notion returns when an ID names a page, not a database. */
function pageNotDatabaseError(id: string) {
  const error: any = new Error(`ID ${id} is a page, not a database`);
  error.code = "validation_error";
  error.body = { code: "validation_error", message: error.message };
  return error;
}

/** Same rejection, but only the body carries the code and the message. */
function bodyOnlyPageNotDatabaseError(id: string) {
  const error: any = new Error("Request validation failed");
  error.body = {
    code: "validation_error",
    message: `${id} is a page, not a database.`,
  };
  return error;
}

/**
 * The shape the installed @notionhq/client actually throws. `APIResponseError`
 * carries `code` and `message` at the top level and keeps `body` as the raw
 * JSON response text, so `body?.code` and `body?.message` are both undefined
 * and only the top-level fallback can match.
 */
function sdkPageNotDatabaseError(id: string) {
  const message = `${id} is a page, not a database.`;
  const error: any = new Error(message);
  error.name = "APIResponseError";
  error.code = "validation_error";
  error.status = 400;
  error.body = JSON.stringify({
    object: "error",
    status: 400,
    code: "validation_error",
    message,
  });
  return error;
}

function paragraphs(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    type: "paragraph",
    id: `${prefix}-blk-${index}`,
  }));
}

/** Mock blocks.children.list that serves the given pages in sequence. */
function paginatedChildren(pages: any[][]) {
  return vi.fn(async ({ start_cursor }: any) => {
    const index = start_cursor === undefined ? 0 : Number(start_cursor);
    const isLast = index >= pages.length - 1;
    return {
      results: pages[index] ?? [],
      has_more: !isLast,
      next_cursor: isLast ? null : String(index + 1),
    };
  });
}

function makeMockClient(options: { retrieve?: any; children?: any } = {}) {
  return {
    databases: { retrieve: options.retrieve ?? vi.fn() },
    blocks: {
      children: {
        list: options.children ?? vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null }),
        append: vi.fn(),
      },
      delete: vi.fn(),
    },
  };
}

/**
 * Values that sit just outside the two forms the normalizer folds. Each pair
 * differs only by hexadecimal case, or by case and dash placement, so any
 * loosening of the normalizer (a length other than exactly 32, a dropped `^`
 * or `$`, an added `m` flag, or an added trim) would fold the pair together.
 * With the scope kept exact, both members stay opaque and stay distinct.
 */
const UPPER_UUID = "0A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D";
const LOWER_BARE_UUID = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d";

const OPAQUE_BOUNDARY_PAIRS: Array<{ label: string; a: string; b: string }> = [
  {
    label: "31 hexadecimal characters, differing only by case",
    a: "ABCDEF0123456789ABCDEF012345678",
    b: "abcdef0123456789abcdef012345678",
  },
  {
    label: "33 hexadecimal characters, differing only by case",
    a: "ABCDEF0123456789ABCDEF0123456789A",
    b: "abcdef0123456789abcdef0123456789a",
  },
  {
    label: "canonical UUID with one leading character",
    a: `z${UPPER_UUID}`,
    b: `z${LOWER_BARE_UUID}`,
  },
  {
    label: "canonical UUID with one trailing character",
    a: `${UPPER_UUID}z`,
    b: `${LOWER_BARE_UUID}z`,
  },
  {
    label: "canonical UUID with a trailing newline",
    a: `${UPPER_UUID}\n`,
    b: `${LOWER_BARE_UUID}\n`,
  },
  {
    label: "canonical UUID with trailing whitespace",
    a: `${UPPER_UUID} `,
    b: `${LOWER_BARE_UUID} `,
  },
  {
    label: "URL containing a UUID",
    a: `https://www.notion.so/Page-${UPPER_UUID}`,
    b: `https://www.notion.so/Page-${LOWER_BARE_UUID}`,
  },
];

// --- resolvePageIdAlias unit tests ---

describe("resolvePageIdAlias", () => {
  beforeEach(() => vi.clearAllMocks());

  it("database_id only: fast path, no API calls", async () => {
    const client = makeMockClient();
    const result = await resolvePageIdAlias(client as any, { database_id: "db-123" });
    expect(result).toBe("db-123");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("page_id that IS a database ID: same-UUID passthrough", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockResolvedValue({ id: "db-as-page", data_sources: [{ id: "ds-1" }] }),
    });
    const result = await resolvePageIdAlias(client as any, { page_id: "db-as-page" });
    expect(result).toBe("db-as-page");
    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: "db-as-page" });
  });

  it("page_id resolving to a single inline database", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-1")),
      children: paginatedChildren([[
        { type: "paragraph", id: "blk-1" },
        { type: "child_database", id: "inline-db-1", child_database: { title: "Tasks" } },
      ]]),
    });
    const result = await resolvePageIdAlias(client as any, { page_id: "page-1" });
    expect(result).toBe("inline-db-1");
  });

  // --- pagination: the child-block lookup must drain before deciding ---

  it("resolves a database that only appears after child 100", async () => {
    const children = paginatedChildren([
      paragraphs(100, "deep"),
      [{ type: "child_database", id: "deep-db", child_database: { title: "Deep" } }],
    ]);
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-deep")),
      children,
    });
    const result = await resolvePageIdAlias(client as any, { page_id: "page-deep" });
    expect(result).toBe("deep-db");
    expect(children).toHaveBeenCalledTimes(2);
  });

  it("errors instead of resolving when a second database appears on a later page", async () => {
    const children = paginatedChildren([
      [
        { type: "child_database", id: "early-db", child_database: { title: "Early" } },
        ...paragraphs(99, "amb"),
      ],
      [{ type: "child_database", id: "late-db", child_database: { title: "Late" } }],
    ]);
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-ambiguous")),
      children,
    });
    const error = await resolvePageIdAlias(client as any, { page_id: "page-ambiguous" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("2 inline databases");
    expect((error as Error).message).toContain("early-db (Early)");
    expect((error as Error).message).toContain("late-db (Late)");
    expect(children).toHaveBeenCalledTimes(2);
  });

  it("does not cache an ambiguous page", async () => {
    const children = paginatedChildren([
      [{ type: "child_database", id: "amb-a", child_database: { title: "A" } }],
      [{ type: "child_database", id: "amb-b", child_database: { title: "B" } }],
    ]);
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-nocache")),
      children,
    });
    await expect(resolvePageIdAlias(client as any, { page_id: "page-nocache" })).rejects.toThrow(
      "2 inline databases",
    );
    await expect(resolvePageIdAlias(client as any, { page_id: "page-nocache" })).rejects.toThrow(
      "2 inline databases",
    );
    expect(client.databases.retrieve).toHaveBeenCalledTimes(2);
  });

  // --- presence, validation, normalization ---

  it("both provided and matching (dash normalization): proceeds", async () => {
    const client = makeMockClient();
    const result = await resolvePageIdAlias(client as any, {
      database_id: "12345678-1234-1234-1234-123456789abc",
      page_id: "12345678123412341234123456789abc",
    });
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("both provided and matching (case normalization): proceeds", async () => {
    const client = makeMockClient();
    const result = await resolvePageIdAlias(client as any, {
      database_id: "12345678-1234-1234-1234-123456789ABC",
      page_id: "12345678-1234-1234-1234-123456789abc",
    });
    expect(result).toBe("12345678-1234-1234-1234-123456789ABC");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("non-UUID values differing only by a dash conflict", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { database_id: "db-1", page_id: "db1" }),
    ).rejects.toThrow("database_id and page_id refer to different objects. Pass exactly one.");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
  });

  it("values just outside the UUID forms are not folded together by the conflict check", async () => {
    for (const { label, a, b } of OPAQUE_BOUNDARY_PAIRS) {
      const client = makeMockClient();
      const outcome = await resolvePageIdAlias(client as any, { database_id: a, page_id: b }).then(
        (value) => `resolved to ${value}`,
        (error: Error) => error.message,
      );
      expect(outcome, label).toContain("database_id and page_id refer to different objects");
    }
  });

  it("both provided and different: loud error", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { database_id: "db-aaa", page_id: "page-bbb" }),
    ).rejects.toThrow("database_id and page_id refer to different objects. Pass exactly one.");
  });

  it("neither provided: error", async () => {
    const client = makeMockClient();
    await expect(resolvePageIdAlias(client as any, {})).rejects.toThrow(
      "Pass exactly one of `database_id` or `page_id`.",
    );
  });

  it("empty-string database_id is rejected, and does not bypass the conflict check", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { database_id: "", page_id: "page-x" }),
    ).rejects.toThrow("`database_id` must be a non-empty string.");
  });

  it("empty-string page_id is rejected", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { page_id: "   " }),
    ).rejects.toThrow("`page_id` must be a non-empty string.");
  });

  it("non-string database_id is rejected", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { database_id: 42 }),
    ).rejects.toThrow("`database_id` must be a non-empty string.");
  });

  it("non-string page_id is rejected", async () => {
    const client = makeMockClient();
    await expect(
      resolvePageIdAlias(client as any, { page_id: { id: "nope" } }),
    ).rejects.toThrow("`page_id` must be a non-empty string.");
  });

  it("page with 0 inline databases: error with guidance", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-empty")),
      children: paginatedChildren([[
        { type: "paragraph", id: "blk-1" },
        { type: "heading_1", id: "blk-2" },
      ]]),
    });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-empty" }),
    ).rejects.toThrow("no inline database. Use list_databases");
  });

  it("runtime error strings contain no em dash", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-dash")),
      children: paginatedChildren([[
        { type: "child_database", id: "dash-a", child_database: { title: "A" } },
        { type: "child_database", id: "dash-b", child_database: { title: "B" } },
      ]]),
    });
    const messages: string[] = [];
    messages.push(
      await resolvePageIdAlias(client as any, { database_id: "db-1", page_id: "page-2" }).catch(
        (e: Error) => e.message,
      ),
    );
    messages.push(
      await resolvePageIdAlias(client as any, { page_id: "page-dash" }).catch((e: Error) => e.message),
    );
    const emptyClient = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-dash-empty")),
      children: paginatedChildren([[{ type: "paragraph", id: "p" }]]),
    });
    messages.push(
      await resolvePageIdAlias(emptyClient as any, { page_id: "page-dash-empty" }).catch(
        (e: Error) => e.message,
      ),
    );
    for (const message of messages) {
      expect(message).not.toContain("—");
    }
  });

  // --- caching ---

  it("cache: second resolution of same page_id makes no extra API call", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError("page-cached")),
      children: paginatedChildren([[
        { type: "child_database", id: "cached-db-1", child_database: { title: "Cached" } },
      ]]),
    });

    const first = await resolvePageIdAlias(client as any, { page_id: "page-cached" });
    expect(first).toBe("cached-db-1");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);

    const second = await resolvePageIdAlias(client as any, { page_id: "page-cached" });
    expect(second).toBe("cached-db-1");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
  });

  it("cache key is dash- and case-insensitive", async () => {
    const dashed = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const undashed = "AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE";
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError(dashed)),
      children: paginatedChildren([[
        { type: "child_database", id: "norm-db", child_database: { title: "Norm" } },
      ]]),
    });
    expect(await resolvePageIdAlias(client as any, { page_id: dashed })).toBe("norm-db");
    expect(await resolvePageIdAlias(client as any, { page_id: undashed })).toBe("norm-db");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
  });

  it("a misplaced-dash value cannot reuse a canonical UUID's cached resolution", async () => {
    const canonical = "11111111-2222-3333-4444-555555555555";
    const misplaced = "111111112222-3333-4444-555555555555";
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError(canonical)),
      children: paginatedChildren([[
        { type: "child_database", id: "misplaced-db", child_database: { title: "Misplaced" } },
      ]]),
    });
    expect(await resolvePageIdAlias(client as any, { page_id: canonical })).toBe("misplaced-db");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
    expect(await resolvePageIdAlias(client as any, { page_id: misplaced })).toBe("misplaced-db");
    expect(client.databases.retrieve).toHaveBeenCalledTimes(2);
    expect(client.databases.retrieve).toHaveBeenLastCalledWith({ database_id: misplaced });
  });

  it("values just outside the UUID forms do not share a resolution-cache entry", async () => {
    for (const { label, a, b } of OPAQUE_BOUNDARY_PAIRS) {
      const client = makeMockClient({
        retrieve: vi.fn().mockRejectedValue(pageNotDatabaseError(a)),
        children: paginatedChildren([[
          { type: "child_database", id: "boundary-db", child_database: { title: "Boundary" } },
        ]]),
      });
      expect(await resolvePageIdAlias(client as any, { page_id: a }), label).toBe("boundary-db");
      expect(await resolvePageIdAlias(client as any, { page_id: b }), label).toBe("boundary-db");
      // A shared cache key would serve the second call from cache and leave one
      // retrieve. Two calls prove the keys stayed distinct, and the last call
      // proves the value reached the API exactly as it was written.
      expect(client.databases.retrieve, label).toHaveBeenCalledTimes(2);
      expect(client.databases.retrieve, label).toHaveBeenLastCalledWith({ database_id: b });
    }
  });

  // --- error-shape robustness ---

  it("resolves when only the error body carries the code and message", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(bodyOnlyPageNotDatabaseError("page-body")),
      children: paginatedChildren([[
        { type: "child_database", id: "body-db", child_database: { title: "Body" } },
      ]]),
    });
    expect(await resolvePageIdAlias(client as any, { page_id: "page-body" })).toBe("body-db");
  });

  it("resolves from the SDK top-level code and message when body is raw JSON text", async () => {
    const client = makeMockClient({
      retrieve: vi.fn().mockRejectedValue(sdkPageNotDatabaseError("page-sdk")),
      children: paginatedChildren([[
        { type: "child_database", id: "sdk-db", child_database: { title: "Sdk" } },
      ]]),
    });
    expect(await resolvePageIdAlias(client as any, { page_id: "page-sdk" })).toBe("sdk-db");
  });

  it("non-page-vs-database errors propagate unchanged", async () => {
    const original = new Error("rate limited");
    const client = makeMockClient({ retrieve: vi.fn().mockRejectedValue(original) });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-ratelimit" }),
    ).rejects.toBe(original);
    expect(client.blocks.children.list).not.toHaveBeenCalled();
  });

  it("a validation_error that does not mention the mismatch propagates unchanged", async () => {
    const original: any = new Error("body failed validation: body.filter should be defined");
    original.code = "validation_error";
    original.body = { code: "validation_error", message: original.message };
    const client = makeMockClient({ retrieve: vi.fn().mockRejectedValue(original) });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-othervalidation" }),
    ).rejects.toBe(original);
    expect(client.blocks.children.list).not.toHaveBeenCalled();
  });

  it("an object_not_found error propagates unchanged", async () => {
    const original: any = new Error("Could not find database with ID");
    original.code = "object_not_found";
    original.body = { code: "object_not_found", message: original.message };
    const client = makeMockClient({ retrieve: vi.fn().mockRejectedValue(original) });
    await expect(
      resolvePageIdAlias(client as any, { page_id: "page-missing" }),
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
        list:
          blocksChildrenList ??
          vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null }),
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

const ALIAS_TOOLS = [
  "get_database",
  "query_database",
  "add_database_entry",
  "add_database_entries",
  "update_data_source",
];

describe("page_id alias: tool schemas", () => {
  it("all 5 database tools expose page_id in their schema", async () => {
    const notion = makeFullNotion({ id: "db-schema", data_sources: [{ id: "ds-schema" }] });
    const { client, close } = await connect(notion);
    try {
      const { tools } = await client.listTools();
      for (const name of ALIAS_TOOLS) {
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

  it("all 5 tools require at least one of database_id or page_id via anyOf", async () => {
    const notion = makeFullNotion({ id: "db-req", data_sources: [{ id: "ds-req" }] });
    const { client, close } = await connect(notion);
    try {
      const { tools } = await client.listTools();
      for (const name of ALIAS_TOOLS) {
        const schema = tools.find((t) => t.name === name)!.inputSchema as any;
        expect(schema.required ?? [], `${name} should not require database_id`).not.toContain(
          "database_id",
        );
        expect(schema.anyOf, `${name} should declare anyOf`).toEqual([
          { required: ["database_id"] },
          { required: ["page_id"] },
        ]);
      }
    } finally {
      await close();
    }
  });

  it("payload-carrying tools keep their own required fields", async () => {
    const notion = makeFullNotion({ id: "db-keep", data_sources: [{ id: "ds-keep" }] });
    const { client, close } = await connect(notion);
    try {
      const { tools } = await client.listTools();
      const entry = tools.find((t) => t.name === "add_database_entry")!.inputSchema as any;
      const entries = tools.find((t) => t.name === "add_database_entries")!.inputSchema as any;
      expect(entry.required).toContain("properties");
      expect(entries.required).toContain("entries");
    } finally {
      await close();
    }
  });
});

describe("page_id alias: tool wiring", () => {
  it("page_id resolves through to get_database result", async () => {
    const dbData = {
      id: "inline-db-wired",
      data_sources: [{ id: "ds-wired" }],
      title: [{ plain_text: "Wired DB" }],
      url: "https://notion.so/wired",
    };
    const dbRetrieve = vi
      .fn()
      .mockRejectedValueOnce(pageNotDatabaseError("page-wired"))
      .mockResolvedValue(dbData);
    const blocksChildrenList = paginatedChildren([[
      { type: "child_database", id: "inline-db-wired", child_database: { title: "Wired DB" } },
    ]]);
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
      expect(parseToolText(result)).toContain("database_id and page_id refer to different objects");
    } finally {
      await close();
    }
  });

  it("update_data_source keeps its runtime database_id type guard", async () => {
    const notion = makeFullNotion({ id: "db-guard", data_sources: [{ id: "ds-guard" }] });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_data_source",
        arguments: { database_id: 42, title: "nope" },
      });
      expect(parseToolText(result)).toContain("`database_id` must be a string");
    } finally {
      await close();
    }
  });
});

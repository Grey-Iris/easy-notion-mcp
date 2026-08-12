import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer, type CreateServerConfig } from "../src/server.js";

function parseToolResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("expected text content in tool result");
  }
  return JSON.parse(text);
}

// The approved tool description, pinned whole. Fragment matching would still
// accept copy that added an edit class the step-0 probe never observed.
const LIST_PAGES_DESCRIPTION =
  "List child pages under a parent page. Each row returns id, title, created_time, and last_edited_time. Timestamps are full ISO-8601 values from Notion, rounded to the minute, and last_edited_time advances on page content and property edits.";

// Every timestamp below is distinct, and within each row created_time differs
// from last_edited_time, so a mapping that swaps them or reuses one for both
// cannot pass.
const CHILD_PAGES = {
  alpha: {
    object: "block",
    id: "cp-alpha",
    type: "child_page",
    child_page: { title: "Alpha" },
    created_time: "2026-01-02T03:04:00.000Z",
    last_edited_time: "2026-05-06T07:08:00.000Z",
    has_children: true,
    in_trash: false,
  },
  beta: {
    object: "block",
    id: "cp-beta",
    type: "child_page",
    child_page: { title: "Beta" },
    created_time: "2026-02-03T04:05:00.000Z",
    last_edited_time: "2026-06-07T08:09:00.000Z",
    has_children: false,
    in_trash: false,
  },
  // Trashed rows were included before this change and must stay included; a new
  // in_trash filter would be a behavior change this brief does not authorize.
  gamma: {
    object: "block",
    id: "cp-gamma",
    type: "child_page",
    child_page: { title: "Gamma" },
    created_time: "2026-03-04T05:06:00.000Z",
    last_edited_time: "2026-07-08T09:10:00.000Z",
    has_children: false,
    in_trash: true,
  },
};

const PARAGRAPH = {
  object: "block",
  id: "blk-paragraph",
  type: "paragraph",
  paragraph: { rich_text: [] },
  created_time: "2026-01-01T00:00:00.000Z",
  last_edited_time: "2026-01-01T00:00:00.000Z",
};

// A child_database is the near-miss case: it is a container like a child_page
// and carries both timestamps, so an implementation that filters only
// paragraphs and typeless entries would leak it.
const CHILD_DATABASE = {
  object: "block",
  id: "blk-database",
  type: "child_database",
  child_database: { title: "Some database" },
  created_time: "2026-01-01T00:00:00.000Z",
  last_edited_time: "2026-01-01T00:00:00.000Z",
};

// Partial block objects carry no `type` key at all.
const PARTIAL = { object: "block", id: "partial-1" };

const PAGE_ONE = {
  results: [CHILD_PAGES.alpha, PARAGRAPH, PARTIAL, CHILD_PAGES.beta],
  has_more: true,
  next_cursor: "cursor-2",
};

const PAGE_TWO = {
  results: [CHILD_DATABASE, CHILD_PAGES.gamma],
  has_more: false,
  next_cursor: null,
};

const EXPECTED_ROWS = [
  {
    id: "cp-alpha",
    title: "Alpha",
    created_time: "2026-01-02T03:04:00.000Z",
    last_edited_time: "2026-05-06T07:08:00.000Z",
  },
  {
    id: "cp-beta",
    title: "Beta",
    created_time: "2026-02-03T04:05:00.000Z",
    last_edited_time: "2026-06-07T08:09:00.000Z",
  },
  {
    id: "cp-gamma",
    title: "Gamma",
    created_time: "2026-03-04T05:06:00.000Z",
    last_edited_time: "2026-07-08T09:10:00.000Z",
  },
];

const ROW_KEYS = ["id", "title", "created_time", "last_edited_time"];

/**
 * A mocked client whose every Notion surface is a spy, so "zero additional API
 * calls" can be asserted rather than assumed.
 */
function makeNotion(listPages: Array<Record<string, unknown>>) {
  const list = vi.fn();
  for (const page of listPages) {
    list.mockResolvedValueOnce(page);
  }
  list.mockResolvedValue({ results: [], has_more: false, next_cursor: null });

  return {
    blocks: {
      children: { list, append: vi.fn() },
      retrieve: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pages: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
    databases: { retrieve: vi.fn(), query: vi.fn(), create: vi.fn(), update: vi.fn() },
    dataSources: { retrieve: vi.fn(), query: vi.fn(), create: vi.fn(), update: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
    search: vi.fn(),
  };
}

async function connect(notion: unknown, config: CreateServerConfig = {}) {
  const server = createServer(() => notion as any, config);
  const client = new McpClient(
    { name: "list-pages-timestamps-test", version: "1.0.0" },
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

async function callListPages(notion: unknown, parentId = "parent-1") {
  const { client, close } = await connect(notion);
  try {
    return parseToolResult(
      await client.callTool({ name: "list_pages", arguments: { parent_page_id: parentId } }),
    );
  } finally {
    await close();
  }
}

/**
 * Every Notion call surface on the mock except the child-block listing.
 *
 * Derived by walking the mock rather than hand-listing, so a surface added to
 * makeNotion cannot be silently left out of the zero-extra-calls assertion.
 */
function otherCallSurfaces(notion: ReturnType<typeof makeNotion>): Array<[string, ReturnType<typeof vi.fn>]> {
  const found: Array<[string, ReturnType<typeof vi.fn>]> = [];

  const walk = (value: any, path: string) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (typeof child === "function") {
        if (next !== "blocks.children.list") {
          found.push([next, child as ReturnType<typeof vi.fn>]);
        }
      } else {
        walk(child, next);
      }
    }
  };

  walk(notion, "");
  return found;
}

describe("list_pages timestamps", () => {
  it("returns the exact expected rows across a paginated listing", async () => {
    const notion = makeNotion([PAGE_ONE, PAGE_TWO]);

    const rows = await callListPages(notion);

    // Whole-array deep equality. The paragraph, the partial object, and the
    // child_database must be absent, and source order preserved.
    expect(rows).toEqual(EXPECTED_ROWS);
  });

  it("emits exactly the four expected keys, in order, on every row", async () => {
    const notion = makeNotion([PAGE_ONE, PAGE_TWO]);

    const rows = await callListPages(notion);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(ROW_KEYS);
    }
  });

  it("drains pagination with exact call arguments and exactly two calls", async () => {
    const notion = makeNotion([PAGE_ONE, PAGE_TWO]);

    await callListPages(notion);

    expect(notion.blocks.children.list).toHaveBeenCalledTimes(2);
    expect(notion.blocks.children.list.mock.calls[0]).toEqual([
      { block_id: "parent-1", start_cursor: undefined, page_size: 100 },
    ]);
    expect(notion.blocks.children.list.mock.calls[1]).toEqual([
      { block_id: "parent-1", start_cursor: "cursor-2", page_size: 100 },
    ]);
  });

  it("makes zero additional Notion API calls", async () => {
    const notion = makeNotion([PAGE_ONE, PAGE_TWO]);

    await callListPages(notion);

    const surfaces = otherCallSurfaces(notion);
    // Guard against a walk that silently found nothing.
    expect(surfaces.length).toBeGreaterThan(10);

    for (const [name, spy] of surfaces) {
      expect(spy, `${name} should not be called`).not.toHaveBeenCalled();
    }
  });

  it("returns full ISO-8601 timestamps, not the date-only form search uses", async () => {
    const notion = makeNotion([PAGE_ONE, PAGE_TWO]);

    const rows = await callListPages(notion);

    for (const row of rows) {
      expect(row.created_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.last_edited_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.created_time).not.toBe(row.last_edited_time);
    }
  });

  it("returns an empty array when the parent has no children", async () => {
    const notion = makeNotion([{ results: [], has_more: false, next_cursor: null }]);

    expect(await callListPages(notion)).toEqual([]);
    expect(notion.blocks.children.list).toHaveBeenCalledTimes(1);
  });

  it("returns a single row without needing a second page", async () => {
    const notion = makeNotion([
      { results: [CHILD_PAGES.alpha], has_more: false, next_cursor: null },
    ]);

    expect(await callListPages(notion)).toEqual([EXPECTED_ROWS[0]]);
    expect(notion.blocks.children.list).toHaveBeenCalledTimes(1);
  });

  it("keeps trashed child pages in the listing, as before this change", async () => {
    const notion = makeNotion([
      { results: [CHILD_PAGES.gamma], has_more: false, next_cursor: null },
    ]);

    expect(await callListPages(notion)).toEqual([EXPECTED_ROWS[2]]);
  });
});

describe("list_pages tool description", () => {
  it("ships the approved copy byte for byte", async () => {
    const { client, close } = await connect(makeNotion([]));
    try {
      const tools = await client.listTools();
      const listPages = tools.tools.find((tool) => tool.name === "list_pages");

      expect(listPages?.description).toBe(LIST_PAGES_DESCRIPTION);
    } finally {
      await close();
    }
  });

  it("claims no edit class the probe did not observe, and uses no dashes", async () => {
    const { client, close } = await connect(makeNotion([]));
    try {
      const tools = await client.listTools();
      const description = tools.tools.find((tool) => tool.name === "list_pages")?.description ?? "";

      expect(description).toContain("created_time");
      expect(description).toContain("last_edited_time");
      expect(description).toContain("ISO-8601");

      // The step-0 probe observed content edits and property edits only.
      for (const forbidden of ["any activity", "any page activity", "cover", "comment", "moved", "move"]) {
        expect(description.toLowerCase(), `must not claim "${forbidden}"`).not.toContain(forbidden);
      }
      expect(description).not.toContain("—");
      expect(description).not.toContain("–");
    } finally {
      await close();
    }
  });
});

describe("search is deliberately different and is not changed by this brief", () => {
  it("still truncates last_edited to a date", async () => {
    const notion = makeNotion([]);
    notion.search.mockResolvedValue({
      results: [
        {
          object: "page",
          id: "page-1",
          url: "https://notion.so/page-1",
          parent: { type: "page_id", page_id: "parent-1" },
          properties: { Name: { type: "title", title: [{ plain_text: "Some Page" }] } },
          last_edited_time: "2026-05-06T07:08:00.000Z",
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const { client, close } = await connect(notion);
    try {
      const rows = parseToolResult(
        await client.callTool({ name: "search", arguments: { query: "anything" } }),
      );

      // Whole-row equality, not just the timestamp field, so a change to any
      // other part of the search row shape fails here too.
      expect(rows).toEqual([
        {
          id: "page-1",
          type: "page",
          title: "Some Page",
          url: "https://notion.so/page-1",
          parent: "parent-1",
          last_edited: "2026-05-06",
        },
      ]);
      expect(Object.keys(rows[0])).toEqual(["id", "type", "title", "url", "parent", "last_edited"]);
      expect(rows[0]).not.toHaveProperty("last_edited_time");
      expect(rows[0]).not.toHaveProperty("created_time");

      expect(notion.search).toHaveBeenCalledTimes(1);
      expect(notion.search.mock.calls[0]).toEqual([
        { query: "anything", start_cursor: undefined, page_size: 100 },
      ]);
    } finally {
      await close();
    }
  });
});

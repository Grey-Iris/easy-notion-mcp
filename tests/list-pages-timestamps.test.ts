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

/*
 * Fixture design, and why the values look arbitrary.
 *
 * The CHANGELOG states that "row order is still the order Notion returns", so
 * the suite has to fail if anything reorders the rows. An earlier version of
 * this file could not: its fixtures were already sorted Alpha, Beta, Gamma with
 * ids and both timestamps rising in that same direction, so inserting an
 * alphabetical sort into the handler changed nothing and every test still
 * passed.
 *
 * These four fixtures are chosen so that no single-key sort can reproduce the
 * order the mock serves them in. With the source order below, every one of
 * these sorts yields something different, in BOTH directions:
 *
 *   source order       Alpha, Gamma Roadmap, Beta Notes, Delta Briefing Doc
 *   by title      asc  Alpha, Beta Notes, Delta Briefing Doc, Gamma Roadmap
 *   by title len  asc  Alpha, Beta Notes, Gamma Roadmap, Delta Briefing Doc
 *   by id         asc  Alpha, Beta Notes, Gamma Roadmap, Delta Briefing Doc
 *   by created    asc  Alpha, Delta Briefing Doc, Beta Notes, Gamma Roadmap
 *   by edited     asc  Gamma Roadmap, Alpha, Beta Notes, Delta Briefing Doc
 *   by in_trash   asc  Gamma Roadmap, Beta Notes, Delta Briefing Doc, Alpha
 *   by has_child  asc  Gamma Roadmap, Beta Notes, Delta Briefing Doc, Alpha
 *
 * The four contract fields (title, id, created_time, last_edited_time) each
 * produce a DIFFERENT order, so no two of them are interchangeable either.
 *
 * The titles carry deliberate suffixes because their lengths must also differ
 * in an order that is not the source order: with bare "Alpha"/"Beta"/"Gamma",
 * a sort by title length reproduces the source order and would survive.
 *
 * Three of the four sit on page one so that page one is long enough to be
 * non-monotonic on its own. A two-row page is always sorted by some key in one
 * of the two directions, which would let a per-page sort slip through.
 *
 * The order-guard test below re-derives this table at run time, so a later edit
 * to any fixture value cannot quietly return this file to a vacuous state.
 *
 * Within each row created_time differs from last_edited_time, and every one of
 * the eight timestamps is distinct, so a mapping that swaps the two fields or
 * reuses one for both cannot pass.
 */
const CHILD_PAGES = {
  alpha: {
    object: "block",
    id: "cp-1f3a",
    type: "child_page",
    child_page: { title: "Alpha" },
    created_time: "2026-01-02T03:04:00.000Z",
    last_edited_time: "2026-06-07T08:09:00.000Z",
    has_children: true,
    // Trashed rows were included before this change and must stay included; a
    // new in_trash filter would be a behavior change this brief does not
    // authorize.
    in_trash: true,
  },
  gamma: {
    object: "block",
    id: "cp-8c05",
    type: "child_page",
    child_page: { title: "Gamma Roadmap" },
    created_time: "2026-04-05T06:07:00.000Z",
    last_edited_time: "2026-05-06T07:08:00.000Z",
    has_children: false,
    in_trash: false,
  },
  beta: {
    object: "block",
    id: "cp-4b27",
    type: "child_page",
    child_page: { title: "Beta Notes" },
    created_time: "2026-03-04T05:06:00.000Z",
    last_edited_time: "2026-07-08T09:10:00.000Z",
    has_children: false,
    in_trash: false,
  },
  delta: {
    object: "block",
    id: "cp-9d04",
    type: "child_page",
    child_page: { title: "Delta Briefing Doc" },
    created_time: "2026-02-03T04:05:00.000Z",
    last_edited_time: "2026-08-09T10:11:00.000Z",
    has_children: false,
    in_trash: false,
  },
};

// The single source of truth for "the order Notion returned". The pagination
// fixtures below must serve exactly this sequence, which is asserted rather
// than assumed.
const SOURCE_FIXTURES = [
  CHILD_PAGES.alpha,
  CHILD_PAGES.gamma,
  CHILD_PAGES.beta,
  CHILD_PAGES.delta,
];

/*
 * Mutation-guard fixtures for the always-present timestamp contract.
 *
 * `created_time: ""` and `last_edited_time: ""` are INTENTIONALLY outside the
 * SDK-valid domain. The Notion API always returns a non-empty ISO-8601 string
 * for both fields on a child_page block, so no real response looks like this.
 * These rows exist for one reason: to force the handler to build the row object
 * unconditionally.
 *
 * Without them the suite cannot tell an unconditional property from a
 * conditional spread. Every realistic fixture has truthy timestamps, so
 * rewriting the handler as
 *
 *   ...(block.last_edited_time ? { last_edited_time: block.last_edited_time } : {})
 *
 * emits an identical row for all of them and passes the whole suite, while
 * silently dropping the key for any page whose timestamp is falsy.
 *
 * The empty string is the right sentinel because it is falsy yet survives
 * JSON serialization. `undefined` would not work: JSON.stringify strips
 * undefined-valued keys, so the conditional and unconditional handlers
 * serialize identically and the mutation stays invisible.
 *
 * Each timestamp is made falsy independently so a guard on either field alone
 * is caught and named by the failing test.
 */
const SENTINEL_EMPTY_CREATED = {
  object: "block",
  id: "cp-sentinel-created",
  type: "child_page",
  child_page: { title: "Sentinel: empty created_time" },
  created_time: "",
  last_edited_time: "2026-09-10T11:12:00.000Z",
  has_children: false,
  in_trash: false,
};

const SENTINEL_EMPTY_EDITED = {
  object: "block",
  id: "cp-sentinel-edited",
  type: "child_page",
  child_page: { title: "Sentinel: empty last_edited_time" },
  created_time: "2026-09-10T11:12:00.000Z",
  last_edited_time: "",
  has_children: false,
  in_trash: false,
};

// The same hole exists for the two fields that predate this change: every
// realistic fixture has a truthy id and title, so a conditional spread on
// either would also survive. This sentinel closes that gap, keeping the
// contract "exactly these four keys, always" rather than "at most these four".
const SENTINEL_EMPTY_IDENTITY = {
  object: "block",
  id: "",
  type: "child_page",
  child_page: { title: "" },
  created_time: "2026-09-10T11:12:00.000Z",
  last_edited_time: "2026-10-11T12:13:00.000Z",
  has_children: false,
  in_trash: false,
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
  results: [
    CHILD_PAGES.alpha,
    PARAGRAPH,
    CHILD_PAGES.gamma,
    PARTIAL,
    CHILD_PAGES.beta,
  ],
  has_more: true,
  next_cursor: "cursor-2",
};

const PAGE_TWO = {
  results: [CHILD_DATABASE, CHILD_PAGES.delta],
  has_more: false,
  next_cursor: null,
};

/*
 * Expected rows as literals, keyed by name rather than position.
 *
 * Positional access (EXPECTED_ROWS[0]) silently repoints at a different page
 * whenever the source order changes, which would pair a single-row test with
 * the wrong expectation and still pass or fail for the wrong reason.
 */
const EXPECTED = {
  alpha: {
    id: "cp-1f3a",
    title: "Alpha",
    created_time: "2026-01-02T03:04:00.000Z",
    last_edited_time: "2026-06-07T08:09:00.000Z",
  },
  gamma: {
    id: "cp-8c05",
    title: "Gamma Roadmap",
    created_time: "2026-04-05T06:07:00.000Z",
    last_edited_time: "2026-05-06T07:08:00.000Z",
  },
  beta: {
    id: "cp-4b27",
    title: "Beta Notes",
    created_time: "2026-03-04T05:06:00.000Z",
    last_edited_time: "2026-07-08T09:10:00.000Z",
  },
  delta: {
    id: "cp-9d04",
    title: "Delta Briefing Doc",
    created_time: "2026-02-03T04:05:00.000Z",
    last_edited_time: "2026-08-09T10:11:00.000Z",
  },
};

const EXPECTED_ROWS = [EXPECTED.alpha, EXPECTED.gamma, EXPECTED.beta, EXPECTED.delta];

// The literal order the tool must return, spelled out independently of the
// fixtures so the assertion is a statement of the contract, not a restatement
// of the input.
const EXPECTED_TITLE_ORDER = ["Alpha", "Gamma Roadmap", "Beta Notes", "Delta Briefing Doc"];

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

/** Serve a single page of results containing exactly the given blocks. */
function onePage(...blocks: Array<Record<string, unknown>>) {
  return makeNotion([{ results: blocks, has_more: false, next_cursor: null }]);
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

    expect(rows).toHaveLength(4);
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
    const notion = onePage(CHILD_PAGES.beta);

    expect(await callListPages(notion)).toEqual([EXPECTED.beta]);
    expect(notion.blocks.children.list).toHaveBeenCalledTimes(1);
  });

  it("keeps trashed child pages in the listing, as before this change", async () => {
    const notion = onePage(CHILD_PAGES.alpha);

    expect(await callListPages(notion)).toEqual([EXPECTED.alpha]);
  });
});

/*
 * M-1 guard. Each test below fails if the handler stops constructing one of the
 * four properties unconditionally. See the SENTINEL_* fixtures above for why
 * the empty string is the sentinel and why these inputs are deliberately
 * outside the SDK-valid domain.
 */
describe("list_pages builds every row property unconditionally", () => {
  it("emits created_time even when Notion's value is falsy", async () => {
    const rows = await callListPages(onePage(SENTINEL_EMPTY_CREATED));

    expect(rows).toEqual([
      {
        id: "cp-sentinel-created",
        title: "Sentinel: empty created_time",
        created_time: "",
        last_edited_time: "2026-09-10T11:12:00.000Z",
      },
    ]);
    expect(Object.keys(rows[0])).toEqual(ROW_KEYS);
  });

  it("emits last_edited_time even when Notion's value is falsy", async () => {
    const rows = await callListPages(onePage(SENTINEL_EMPTY_EDITED));

    expect(rows).toEqual([
      {
        id: "cp-sentinel-edited",
        title: "Sentinel: empty last_edited_time",
        created_time: "2026-09-10T11:12:00.000Z",
        last_edited_time: "",
      },
    ]);
    expect(Object.keys(rows[0])).toEqual(ROW_KEYS);
  });

  it("emits id and title even when their values are falsy", async () => {
    const rows = await callListPages(onePage(SENTINEL_EMPTY_IDENTITY));

    expect(rows).toEqual([
      {
        id: "",
        title: "",
        created_time: "2026-09-10T11:12:00.000Z",
        last_edited_time: "2026-10-11T12:13:00.000Z",
      },
    ]);
    expect(Object.keys(rows[0])).toEqual(ROW_KEYS);
  });

  it("keeps all four keys when both timestamps are falsy at once", async () => {
    const rows = await callListPages(
      onePage({
        object: "block",
        id: "cp-sentinel-both",
        type: "child_page",
        child_page: { title: "Sentinel: both timestamps empty" },
        created_time: "",
        last_edited_time: "",
        has_children: false,
        in_trash: false,
      }),
    );

    expect(rows).toEqual([
      {
        id: "cp-sentinel-both",
        title: "Sentinel: both timestamps empty",
        created_time: "",
        last_edited_time: "",
      },
    ]);
    expect(Object.keys(rows[0])).toEqual(ROW_KEYS);
  });
});

/*
 * M-2 guard. The CHANGELOG claims "row order is still the order Notion
 * returns", so that claim needs a test that a sort would actually break.
 */
describe("list_pages preserves Notion's row order", () => {
  const titlesOf = (blocks: any[]) => blocks.map((block) => block.child_page.title);

  // Always clone before sorting: Array.prototype.sort mutates in place, and
  // sorting the shared fixture array would corrupt the source-order reference
  // this whole guard is measured against.
  const sortedBy = (blocks: any[], key: (block: any) => string | number) =>
    [...blocks].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });

  const ORDER_PROBES: Array<[string, (block: any) => string | number]> = [
    ["title", (block) => block.child_page.title],
    ["title length", (block) => String(block.child_page.title).length],
    ["id", (block) => block.id],
    ["created_time", (block) => block.created_time],
    ["last_edited_time", (block) => block.last_edited_time],
    ["in_trash", (block) => (block.in_trash ? 1 : 0)],
    ["has_children", (block) => (block.has_children ? 1 : 0)],
  ];

  it("returns rows in source order, not any sorted order", async () => {
    const rows = await callListPages(makeNotion([PAGE_ONE, PAGE_TWO]));

    expect(rows.map((row: any) => row.title)).toEqual(EXPECTED_TITLE_ORDER);
  });

  it("serves the child pages in the documented source order across pagination", () => {
    const served = [...PAGE_ONE.results, ...PAGE_TWO.results].filter(
      (block: any) => block.type === "child_page",
    );

    expect(served).toEqual(SOURCE_FIXTURES);
    expect(titlesOf(served)).toEqual(EXPECTED_TITLE_ORDER);

    // Page one must carry at least three child pages. A two-row page is
    // trivially in sorted order for every key in one direction or the other,
    // which would let a sort applied per page slip through the guard below.
    const onPageOne = PAGE_ONE.results.filter((block: any) => block.type === "child_page");
    expect(onPageOne.length).toBeGreaterThanOrEqual(3);
  });

  /*
   * The guard that keeps this file honest. It fails if any fixture edit makes
   * the source order coincide with a sort, which is exactly the condition that
   * let the surviving sort mutation pass before.
   *
   * Both the fully drained list and page one on its own are checked, so a sort
   * applied to each API page separately is caught as well as one applied to the
   * flattened result.
   */
  it("uses fixtures no single-key sort can reproduce, in either direction", () => {
    const pageOne = PAGE_ONE.results.filter((block: any) => block.type === "child_page");

    for (const [label, slice] of [
      ["the drained listing", SOURCE_FIXTURES],
      ["page one alone", pageOne],
    ] as Array<[string, any[]]>) {
      const source = titlesOf(slice).join(" | ");

      for (const [name, key] of ORDER_PROBES) {
        const ascending = titlesOf(sortedBy(slice, key)).join(" | ");
        const descending = titlesOf(sortedBy(slice, key).reverse()).join(" | ");

        expect(ascending, `ascending ${name} sort reproduces ${label}`).not.toBe(source);
        expect(descending, `descending ${name} sort reproduces ${label}`).not.toBe(source);
      }
    }
  });

  it("gives each of the four row fields a distinct ordering", () => {
    const orders = ROW_KEYS.map((key) =>
      titlesOf(
        sortedBy(SOURCE_FIXTURES, (block) =>
          key === "title" ? block.child_page.title : block[key],
        ),
      ).join(" | "),
    );

    // No two contract fields sort the fixtures the same way, so a mutation that
    // sorts by one of them cannot be mistaken for a mutation that sorts by
    // another, and none of them is a stand-in for source order.
    expect(new Set(orders).size).toBe(ROW_KEYS.length);
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

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
    { name: "read-page-title-pagination-test", version: "1.0.0" },
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

type ReadPageResponse = {
  title?: string;
  warnings?: Array<Record<string, any>>;
  error?: string;
};

const titleText = (count: number, content = "x") => (
  Array.from({ length: count }, () => ({
    plain_text: content,
    type: "text",
    text: { content },
  }))
);

const titleItems = (count: number, content = "x") => (
  titleText(count, content).map((title) => ({
    object: "property_item",
    id: "title-prop",
    type: "title",
    title,
  }))
);

const relationValues = (count: number) => (
  Array.from({ length: count }, (_, index) => ({ id: `target-${index + 1}` }))
);

function makePage(titleCount: number, extras: Record<string, any> = {}) {
  return {
    id: "page-1",
    object: "page",
    url: "https://notion.so/page-1",
    properties: {
      Name: {
        id: "title-prop",
        type: "title",
        title: titleText(titleCount),
      },
      ...extras,
    },
  };
}

function makeNotionStub(opts: {
  page: any;
  retrievePages?: Array<{
    results: any[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
  blocks?: any[];
}) {
  return {
    pages: {
      retrieve: vi.fn(async () => opts.page),
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
    blocks: {
      children: {
        list: vi.fn(async () => ({
          results: opts.blocks ?? [],
          has_more: false,
          next_cursor: null,
        })),
      },
    },
  };
}

describe("read_page title pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rehydrates a 30-item title under the default cap with no warnings", async () => {
    const notion = makeNotionStub({
      page: makePage(25),
      retrievePages: [{
        results: titleItems(30),
        has_more: false,
        next_cursor: null,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } }),
      );

      expect(response.title).toBe("x".repeat(30));
      expect(response.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("caps a 200-item title at 75 by default and emits a truncated_properties warning", async () => {
    const notion = makeNotionStub({
      page: makePage(25),
      retrievePages: [
        {
          results: titleItems(75),
          has_more: true,
          next_cursor: "c1",
        },
        {
          results: titleItems(75),
          has_more: true,
          next_cursor: "c2",
        },
        {
          results: titleItems(50),
          has_more: false,
          next_cursor: null,
        },
      ],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } }),
      );

      expect(response.title).toHaveLength(75);
      expect(response.warnings).toEqual([
        {
          code: "truncated_properties",
          properties: [{
            name: "Name",
            type: "title",
            returned_count: 75,
            cap: 75,
          }],
          how_to_fetch_all: expect.stringContaining("max_property_items"),
        },
      ]);
    } finally {
      await close();
    }
  });

  it("does not paginate a title under 25 segments", async () => {
    const notion = makeNotionStub({
      page: makePage(10),
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } }),
      );

      expect(response.title).toBe("x".repeat(10));
      expect(response.warnings).toBeUndefined();
      expect(notion.pages.properties.retrieve).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("paginates only the title property when relation is also length 25", async () => {
    const notion = makeNotionStub({
      page: makePage(25, {
        Ref: {
          id: "relation-prop",
          type: "relation",
          relation: relationValues(25),
        },
      }),
      retrievePages: [{
        results: titleItems(30),
        has_more: false,
        next_cursor: null,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } }),
      );

      expect(response.title).toBe("x".repeat(30));
      expect(notion.pages.properties.retrieve).toHaveBeenCalledTimes(1);
      expect(notion.pages.properties.retrieve).toHaveBeenCalledWith({
        page_id: "page-1",
        property_id: "title-prop",
      });
    } finally {
      await close();
    }
  });

  it("fetches a 300-item title with max_property_items set to 0", async () => {
    const notion = makeNotionStub({
      page: makePage(25),
      retrievePages: [
        {
          results: titleItems(100),
          has_more: true,
          next_cursor: "c1",
        },
        {
          results: titleItems(100),
          has_more: true,
          next_cursor: "c2",
        },
        {
          results: titleItems(100),
          has_more: false,
          next_cursor: null,
        },
      ],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({
          name: "read_page",
          arguments: { page_id: "page-1", max_property_items: 0 },
        }),
      );

      expect(response.title).toHaveLength(300);
      expect(response.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("rejects negative max_property_items before retrieving the page", async () => {
    const notion = makeNotionStub({
      page: makePage(25),
      retrievePages: [{
        results: titleItems(30),
        has_more: false,
        next_cursor: null,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({
          name: "read_page",
          arguments: { page_id: "page-1", max_property_items: -1 },
        }),
      );

      expect(response.error).toContain("max_property_items");
      expect(notion.pages.retrieve).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("merges truncated_properties with omitted_block_types warnings", async () => {
    const notion = makeNotionStub({
      page: makePage(25),
      retrievePages: [{
        results: titleItems(75),
        has_more: true,
        next_cursor: "c1",
      }],
      blocks: [{
        id: "sync-1",
        type: "synced_block",
        synced_block: { synced_from: null },
        has_children: false,
      }],
    });
    const { client, close } = await connect(notion);
    try {
      const response = parseToolJson<ReadPageResponse>(
        await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } }),
      );

      expect(response.title).toHaveLength(75);
      expect(response.warnings?.map((warning) => warning.code)).toEqual([
        "omitted_block_types",
        "truncated_properties",
      ]);
      expect(response.warnings?.[0]).toEqual({
        code: "omitted_block_types",
        blocks: [{ id: "sync-1", type: "synced_block" }],
      });
      expect(response.warnings?.[1]).toMatchObject({
        code: "truncated_properties",
        properties: [{
          name: "Name",
          type: "title",
          returned_count: 75,
          cap: 75,
        }],
      });
      expect(response.warnings?.[1].how_to_fetch_all).toContain("max_property_items");
    } finally {
      await close();
    }
  });
});

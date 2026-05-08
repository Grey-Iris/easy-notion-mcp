import type { UpdatePageMarkdownParameters } from "@notionhq/client/build/src/api-endpoints.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

function makeNotion(
  updateMarkdownResult: any = {
    object: "page_markdown",
    id: "page-1",
    markdown: "...",
    truncated: false,
    unknown_block_ids: [],
  },
  retrieveMarkdownResult: any = {
    object: "page_markdown",
    id: "page-1",
    markdown: "...",
    truncated: false,
    unknown_block_ids: [],
  },
) {
  return {
    databases: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      retrieveMarkdown: vi.fn(async () => retrieveMarkdownResult),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(async () => updateMarkdownResult),
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
    { name: "find-replace-test", version: "1.0.0" },
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

describe("find_replace handler (synthesis C6)", () => {
  it("forwards a payload with exactly the expected shape (no swaps, no extra fields, single content update)", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "typo",
          replace: "fixed",
        },
      });

      const expectedPayload: UpdatePageMarkdownParameters = {
        page_id: "page-1",
        type: "update_content",
        update_content: {
          content_updates: [
            { old_str: "typo", new_str: "fixed" },
          ],
        },
      };

      expect(notion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: "page-1" });
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(notion.pages.updateMarkdown.mock.calls[0]?.[0]).toEqual(expectedPayload);
    } finally {
      await close();
    }
  });

  it("includes replace_all_matches:true when replace_all=true", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "x",
          replace: "y",
          replace_all: true,
        },
      });

      expect(notion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: "page-1" });
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(notion.pages.updateMarkdown.mock.calls[0]?.[0]).toEqual({
        page_id: "page-1",
        type: "update_content",
        update_content: {
          content_updates: [
            { old_str: "x", new_str: "y", replace_all_matches: true },
          ],
        },
      });
    } finally {
      await close();
    }
  });

  it("omits replace_all_matches when replace_all is false or unset", async () => {
    const notionUnset = makeNotion();
    const { client: unsetClient, close: closeUnset } = await connect(notionUnset);
    try {
      await unsetClient.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "x",
          replace: "y",
        },
      });

      expect(notionUnset.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(notionUnset.pages.updateMarkdown.mock.calls[0]?.[0]).toEqual({
        page_id: "page-1",
        type: "update_content",
        update_content: {
          content_updates: [
            { old_str: "x", new_str: "y" },
          ],
        },
      });
    } finally {
      await closeUnset();
    }

    const notionFalse = makeNotion();
    const { client: falseClient, close: closeFalse } = await connect(notionFalse);
    try {
      await falseClient.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "x",
          replace: "y",
          replace_all: false,
        },
      });

      expect(notionFalse.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(notionFalse.pages.updateMarkdown.mock.calls[0]?.[0]).toEqual({
        page_id: "page-1",
        type: "update_content",
        update_content: {
          content_updates: [
            { old_str: "x", new_str: "y" },
          ],
        },
      });
    } finally {
      await closeFalse();
    }
  });

  it("returns {success:true} with no truncated field when Notion's response has truncated:false", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "...",
      truncated: false,
      unknown_block_ids: [],
    }, {
      object: "page_markdown",
      id: "page-1",
      markdown: "Fix this typo once.",
      truncated: false,
      unknown_block_ids: [],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "typo",
          replace: "fixed",
        },
      });

      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ success: true, match_count: 1 });
    } finally {
      await close();
    }
  });

  it("returns first-only match_count and truncated:true when Notion's response sets truncated:true", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "...",
      truncated: true,
      unknown_block_ids: [],
    }, {
      object: "page_markdown",
      id: "page-1",
      markdown: "typo then typo again",
      truncated: false,
      unknown_block_ids: [],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "typo",
          replace: "fixed",
        },
      });

      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ success: true, match_count: 1, truncated: true });
    } finally {
      await close();
    }
  });

  it("returns replace_all match_count from the preflight markdown", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "...",
      truncated: false,
      unknown_block_ids: [],
    }, {
      object: "page_markdown",
      id: "page-1",
      markdown: "alpha old beta old gamma old",
      truncated: false,
      unknown_block_ids: [],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "old",
          replace: "new",
          replace_all: true,
        },
      });

      const response = JSON.parse(parseToolText(result));
      expect(notion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: "page-1" });
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(response).toEqual({ success: true, match_count: 3 });
    } finally {
      await close();
    }
  });

  it("does not convert a zero preflight count plus updateMarkdown rejection into success", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "no observable match metadata here",
      truncated: false,
      unknown_block_ids: [],
    }, {
      object: "page_markdown",
      id: "page-1",
      markdown: "no matching text",
      truncated: false,
      unknown_block_ids: [],
    });
    notion.pages.updateMarkdown.mockRejectedValueOnce(
      new Error("validation_error: could not find old_str"),
    );
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "missing",
          replace: "replacement",
        },
      });

      const response = JSON.parse(parseToolText(result));
      expect(notion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: "page-1" });
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(response.success).not.toBe(true);
      expect(response.match_count).toBeUndefined();
      expect(response.error).toMatch(/could not find old_str/);
    } finally {
      await close();
    }
  });

  it("surfaces unknown_block_ids from the API response as a warnings entry (PR3, DP6=A)", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "updated markdown from Notion",
      truncated: false,
      unknown_block_ids: ["block-aaa", "block-bbb"],
    }, {
      object: "page_markdown",
      id: "page-1",
      markdown: "x appears once",
      truncated: false,
      unknown_block_ids: [],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "find_replace",
        arguments: {
          page_id: "page-1",
          find: "x",
          replace: "y",
        },
      });

      // PR3 (DP6=A): we surface `unknown_block_ids` from the Notion response as
      // a non-fatal warning so callers learn which blocks the parser couldn't
      // represent. Mirrors the parallel behavior shipped on `replace_content`
      // in the same PR. Replaces the prior "KNOWN GAP" assertion that the
      // field was discarded.
      const response = JSON.parse(parseToolText(result));
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(response).toEqual({
        success: true,
        match_count: 1,
        warnings: [{ code: "unmatched_blocks", block_ids: ["block-aaa", "block-bbb"] }],
      });
    } finally {
      await close();
    }
  });
});

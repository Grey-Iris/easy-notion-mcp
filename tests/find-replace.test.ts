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
) {
  return {
    databases: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
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
      expect(response).toEqual({ success: true });
    } finally {
      await close();
    }
  });

  it("returns {success:true, truncated:true} when Notion's response sets truncated:true", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "...",
      truncated: true,
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
      expect(response).toEqual({ success: true, truncated: true });
    } finally {
      await close();
    }
  });

  it("KNOWN GAP: response carries no match count or zero-match indicator (handler does not inspect returned markdown)", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "no observable match metadata here",
      truncated: false,
      unknown_block_ids: [],
    });
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

      // KNOWN GAP — Frame 1 S8 / synthesis C6.
      // The handler never inspects the returned `markdown`, and the Notion
      // PageMarkdownResponse type only proves the response shape includes
      // `markdown` and `truncated`, not any match count or zero-match signal.
      // This assertion should flip when we surface match/no-op information via
      // markdown diffing or an explicit warnings/result field.
      const response = JSON.parse(parseToolText(result));
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(response).toEqual({ success: true });
    } finally {
      await close();
    }
  });

  it("KNOWN GAP: discards unknown_block_ids and markdown fields from the API response shape", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "page-1",
      markdown: "updated markdown from Notion",
      truncated: false,
      unknown_block_ids: ["block-aaa", "block-bbb"],
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

      // KNOWN GAP (planner-observed 2026-04-20).
      // The Notion type contract proves `markdown` and `unknown_block_ids`
      // exist on PageMarkdownResponse, but it does not prove the runtime rules
      // for what populates `unknown_block_ids`. Today we simply drop both
      // fields. This assertion should flip when a follow-up surfaces them in a
      // warnings/result shape instead of discarding them.
      const response = JSON.parse(parseToolText(result));
      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      expect(response).toEqual({ success: true });
    } finally {
      await close();
    }
  });
});

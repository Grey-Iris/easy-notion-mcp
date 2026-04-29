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
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(async () => updateMarkdownResult),
    },
    blocks: {
      retrieve: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      children: { list: vi.fn(), append: vi.fn() },
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
    { name: "replace-content-atomic-test", version: "1.0.0" },
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

describe("replace_content (atomic) handler", () => {
  it("forwards type:replace_content with translated Enhanced Markdown new_str", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "replace_content",
        arguments: {
          page_id: "page-1",
          markdown: "+++ Toggle title\nbody\n+++",
        },
      });

      // Old delete-children + append path is not invoked; atomic endpoint is the only network call.
      expect(notion.blocks.children.list).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();

      expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce();
      const payload = notion.pages.updateMarkdown.mock.calls[0][0] as any;
      expect(payload.page_id).toBe("page-1");
      expect(payload.type).toBe("replace_content");
      expect(payload.replace_content.new_str).toBe(
        "<details>\n<summary>Toggle title</summary>\n\tbody\n</details>",
      );
      expect(payload.replace_content.allow_deleting_content).toBe(true);
    } finally {
      await close();
    }
  });

  it("returns {success:true} on truncated:false / empty unknown_block_ids", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: { page_id: "p", markdown: "Hello." },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ success: true });
    } finally {
      await close();
    }
  });

  it("returns {success:true, truncated:true} when API echoes truncated:true", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "p",
      markdown: "...",
      truncated: true,
      unknown_block_ids: [],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: { page_id: "p", markdown: "Hello." },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ success: true, truncated: true });
    } finally {
      await close();
    }
  });

  it("surfaces unknown_block_ids as a warnings entry (departure from find_replace KNOWN GAP)", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "p",
      markdown: "...",
      truncated: false,
      unknown_block_ids: ["block-aaa", "block-bbb"],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: { page_id: "p", markdown: "Hello." },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.success).toBe(true);
      expect(response.warnings).toEqual([
        { code: "unmatched_blocks", block_ids: ["block-aaa", "block-bbb"] },
      ]);
    } finally {
      await close();
    }
  });

  it("surfaces translator warnings (e.g., bookmark_lost_on_atomic_replace)", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: {
          page_id: "p",
          markdown: "https://example.com/some-bookmark",
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.success).toBe(true);
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ code: "bookmark_lost_on_atomic_replace" }),
      );
    } finally {
      await close();
    }
  });

  it("merges translator warnings with unknown_block_ids warnings", async () => {
    const notion = makeNotion({
      object: "page_markdown",
      id: "p",
      markdown: "...",
      truncated: false,
      unknown_block_ids: ["sb-1"],
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: {
          page_id: "p",
          markdown: "https://example.com/x",
        },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ code: "bookmark_lost_on_atomic_replace" }),
      );
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ code: "unmatched_blocks", block_ids: ["sb-1"] }),
      );
    } finally {
      await close();
    }
  });

  it("does not include `deleted` or `appended` counts (atomic endpoint shape)", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "replace_content",
        arguments: { page_id: "p", markdown: "x" },
      });
      const response = JSON.parse(parseToolText(result));
      expect(response).not.toHaveProperty("deleted");
      expect(response).not.toHaveProperty("appended");
    } finally {
      await close();
    }
  });
});

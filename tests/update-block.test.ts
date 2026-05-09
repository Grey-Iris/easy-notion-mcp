import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

type RetrieveBehaviour = { type: string; [key: string]: unknown } | { __error: any };

function makeNotion(retrieveResult: RetrieveBehaviour = { type: "paragraph" }) {
  const retrieve =
    "__error" in retrieveResult
      ? vi.fn(async () => {
          throw retrieveResult.__error;
        })
      : vi.fn(async () => retrieveResult);

  return {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(),
    },
    blocks: {
      retrieve,
      update: vi.fn(async (args: any) => ({ object: "block", id: args.block_id, ...args })),
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
    { name: "update-block-test", version: "1.0.0" },
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

describe("update_block handler", () => {
  it("forwards a paragraph snippet against a paragraph block as { paragraph: { rich_text: [...] } }", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "block-1",
          markdown: "Updated paragraph text.",
        },
      });

      expect(notion.blocks.retrieve).toHaveBeenCalledWith({ block_id: "block-1" });
      expect(notion.blocks.update).toHaveBeenCalledOnce();

      const call = notion.blocks.update.mock.calls[0][0] as any;
      expect(call.block_id).toBe("block-1");
      expect(call.paragraph).toBeDefined();
      expect(call.paragraph.rich_text[0].text.content).toBe("Updated paragraph text.");
      expect(call.in_trash).toBeUndefined();

      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ id: "block-1", type: "paragraph", updated: true });
    } finally {
      await close();
    }
  });

  it("splits long paragraph rich_text in block update payloads", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const markdown = "x".repeat(2001);

      await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "block-1",
          markdown,
        },
      });

      const call = notion.blocks.update.mock.calls[0][0] as any;
      expect(call.paragraph.rich_text.map((item: any) => item.text.content.length)).toEqual([2000, 1]);
      expect(call.paragraph.rich_text.map((item: any) => item.text.content).join("")).toBe(markdown);
    } finally {
      await close();
    }
  });

  describe("forwards markdown for each editable type with the correct top-level key", () => {
    const cases: Array<{ existingType: string; markdown: string; key: string; assertContent?: (payload: any) => void }> = [
      {
        existingType: "heading_1",
        markdown: "# My H1 heading",
        key: "heading_1",
        assertContent: (p) => expect(p.heading_1.rich_text[0].text.content).toBe("My H1 heading"),
      },
      {
        existingType: "heading_2",
        markdown: "## My H2 heading",
        key: "heading_2",
        assertContent: (p) => expect(p.heading_2.rich_text[0].text.content).toBe("My H2 heading"),
      },
      {
        existingType: "heading_3",
        markdown: "### My H3 heading",
        key: "heading_3",
        assertContent: (p) => expect(p.heading_3.rich_text[0].text.content).toBe("My H3 heading"),
      },
      {
        existingType: "toggle",
        markdown: "+++ Toggle title\n+++",
        key: "toggle",
        assertContent: (p) => expect(p.toggle.rich_text[0].text.content).toBe("Toggle title"),
      },
      {
        existingType: "bulleted_list_item",
        markdown: "- bullet body",
        key: "bulleted_list_item",
        assertContent: (p) => expect(p.bulleted_list_item.rich_text[0].text.content).toBe("bullet body"),
      },
      {
        existingType: "numbered_list_item",
        markdown: "1. numbered body",
        key: "numbered_list_item",
        assertContent: (p) => expect(p.numbered_list_item.rich_text[0].text.content).toBe("numbered body"),
      },
      {
        existingType: "quote",
        markdown: "> quote body",
        key: "quote",
        assertContent: (p) => expect(p.quote.rich_text[0].text.content).toBe("quote body"),
      },
      {
        existingType: "callout",
        markdown: "> [!NOTE]\n> note body",
        key: "callout",
        assertContent: (p) => expect(p.callout.rich_text[0].text.content).toMatch(/note body/),
      },
      {
        existingType: "to_do",
        markdown: "- [ ] todo body",
        key: "to_do",
        assertContent: (p) => {
          expect(p.to_do.rich_text[0].text.content).toBe("todo body");
          expect(p.to_do.checked).toBe(false);
        },
      },
      {
        existingType: "code",
        markdown: "```ts\nconst x = 1;\n```",
        key: "code",
        assertContent: (p) => {
          expect(p.code.rich_text[0].text.content).toBe("const x = 1;");
          expect(p.code.language).toBe("ts");
        },
      },
      {
        existingType: "equation",
        markdown: "$$E = mc^2$$",
        key: "equation",
        assertContent: (p) => expect(p.equation.expression).toBe("E = mc^2"),
      },
    ];

    for (const tc of cases) {
      it(`type=${tc.existingType}`, async () => {
        const notion = makeNotion({ type: tc.existingType });
        const { client, close } = await connect(notion);
        try {
          const result = await client.callTool({
            name: "update_block",
            arguments: { block_id: "blk", markdown: tc.markdown },
          });
          expect(notion.blocks.retrieve).toHaveBeenCalledWith({ block_id: "blk" });
          expect(notion.blocks.update).toHaveBeenCalledOnce();
          const payload = notion.blocks.update.mock.calls[0][0] as any;
          expect(payload.block_id).toBe("blk");
          expect(payload[tc.key]).toBeDefined();
          tc.assertContent?.(payload);
          const response = JSON.parse(parseToolText(result));
          expect(response).toEqual({ id: "blk", type: tc.existingType, updated: true });
        } finally {
          await close();
        }
      });
    }
  });

  it("to_do checked: explicit `checked: true` argument overrides markdown syntax", async () => {
    const notion = makeNotion({ type: "to_do" });
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "todo-1",
          markdown: "- [ ] revisit later",
          checked: true,
        },
      });
      const payload = notion.blocks.update.mock.calls[0][0] as any;
      expect(payload.to_do.checked).toBe(true);
      expect(payload.to_do.rich_text[0].text.content).toBe("revisit later");
    } finally {
      await close();
    }
  });

  it("to_do checked: inferred from `- [x]` markdown when explicit flag is absent", async () => {
    const notion = makeNotion({ type: "to_do" });
    const { client, close } = await connect(notion);
    try {
      await client.callTool({
        name: "update_block",
        arguments: { block_id: "todo-2", markdown: "- [x] done" },
      });
      const payload = notion.blocks.update.mock.calls[0][0] as any;
      expect(payload.to_do.checked).toBe(true);
    } finally {
      await close();
    }
  });

  it("type mismatch: existing paragraph + heading_2 markdown returns error WITHOUT calling blocks.update", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "p1", markdown: "## I'm a heading" },
      });
      expect(notion.blocks.retrieve).toHaveBeenCalledOnce();
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/block type mismatch/i);
      expect(response.error).toMatch(/paragraph/);
      expect(response.error).toMatch(/heading_2/);
      expect(response.error).toMatch(/replace_content/);
    } finally {
      await close();
    }
  });

  it("archived:true sends in_trash:true, omits content key, returns archived:true", async () => {
    const notion = makeNotion({ type: "divider" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "d1", archived: true },
      });
      expect(notion.blocks.update).toHaveBeenCalledOnce();
      const payload = notion.blocks.update.mock.calls[0][0] as any;
      expect(payload.block_id).toBe("d1");
      expect(payload.in_trash).toBe(true);
      expect(payload.divider).toBeUndefined();
      expect(payload.archived).toBeUndefined();
      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ id: "d1", type: "divider", archived: true });
    } finally {
      await close();
    }
  });

  it("dry-run validates markdown update without calling blocks.update", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "block-1",
          markdown: "Updated paragraph text.",
          dry_run: true,
        },
      });

      expect(notion.blocks.retrieve).toHaveBeenCalledWith({ block_id: "block-1" });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(JSON.parse(parseToolText(result))).toEqual({
        id: "block-1",
        type: "paragraph",
        dry_run: true,
        operation: "update_block",
        would_update: true,
      });
    } finally {
      await close();
    }
  });

  it("dry-run validates archive without calling blocks.update", async () => {
    const notion = makeNotion({ type: "divider" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "d1", archived: true, dry_run: true },
      });

      expect(notion.blocks.retrieve).toHaveBeenCalledWith({ block_id: "d1" });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(JSON.parse(parseToolText(result))).toEqual({
        id: "d1",
        type: "divider",
        dry_run: true,
        operation: "update_block",
        would_archive: true,
      });
    } finally {
      await close();
    }
  });

  it("multi-block markdown returns an error pointing at replace_content / append_content", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "p1",
          markdown: "Para A\n\nPara B",
        },
      });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/multiple top-level blocks/);
      expect(response.error).toMatch(/replace_content|append_content/);
    } finally {
      await close();
    }
  });

  it("empty markdown returns a validation error before any API call", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "p1", markdown: "   \n\n  " },
      });
      expect(notion.blocks.retrieve).not.toHaveBeenCalled();
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/empty/i);
    } finally {
      await close();
    }
  });

  it("missing both markdown and archived returns a validation error", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "p1" },
      });
      expect(notion.blocks.retrieve).not.toHaveBeenCalled();
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/markdown.*archived|provide either/i);
    } finally {
      await close();
    }
  });

  it("both markdown and archived returns a validation error", async () => {
    const notion = makeNotion({ type: "paragraph" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "p1", markdown: "x", archived: true },
      });
      expect(notion.blocks.retrieve).not.toHaveBeenCalled();
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/either.*not both/i);
    } finally {
      await close();
    }
  });

  it("existing block type not in the updatable set returns explicit error pointing at archived:true / replace_content", async () => {
    const notion = makeNotion({ type: "synced_block" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "s1", markdown: "anything" },
      });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      const response = JSON.parse(parseToolText(result));
      expect(response.error).toMatch(/synced_block/);
      expect(response.error).toMatch(/archived|replace_content/);
    } finally {
      await close();
    }
  });

  it("non-updatable type with archived:true succeeds (divider archive path)", async () => {
    const notion = makeNotion({ type: "divider" });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_block",
        arguments: { block_id: "div-1", archived: true },
      });
      expect(notion.blocks.update).toHaveBeenCalledOnce();
      const response = JSON.parse(parseToolText(result));
      expect(response).toEqual({ id: "div-1", type: "divider", archived: true });
    } finally {
      await close();
    }
  });
});

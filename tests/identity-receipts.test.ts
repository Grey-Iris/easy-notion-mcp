import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer, type CreateServerConfig } from "../src/server.js";
import { appendResponseFixture } from "./helpers/append-response-fixture.js";

type RawBlock = Record<string, any> & { id: string; type: string; has_children?: boolean };

const tempDirs: string[] = [];

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return JSON.parse(text) as any;
}

function richText(text: string) {
  return [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
}

function paragraph(id: string, text: string, hasChildren = false): RawBlock {
  return { id, type: "paragraph", paragraph: { rich_text: richText(text) }, has_children: hasChildren };
}

function heading(id: string, type: "heading_1" | "heading_2" | "heading_3", text: string, isToggleable = false): RawBlock {
  return { id, type, [type]: { rich_text: richText(text), is_toggleable: isToggleable }, has_children: isToggleable };
}

function toggle(id: string, text: string, hasChildren = true): RawBlock {
  return { id, type: "toggle", toggle: { rich_text: richText(text) }, has_children: hasChildren };
}

function divider(id: string): RawBlock {
  return { id, type: "divider", divider: {} };
}

function appendPositionId(args: any) {
  return args.position?.type === "after_block" ? args.position.after_block.id : "";
}

function withCreatedBlockIds(children: any[], prefix: string) {
  return children.map((child: any, index: number) => ({
    id: `${prefix}-${index}`,
    type: child.type,
    [child.type]: child[child.type],
    has_children: child.has_children,
  }));
}

function makeNotion(tree: Record<string, RawBlock[]> = {}) {
  const appendCalls: string[] = [];

  return {
    databases: {
      retrieve: vi.fn(),
      create: vi.fn(async () => ({
        id: "db-1",
        url: "https://notion.so/db-1",
      })),
    },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(async () => ({
        id: "page-created",
        url: "https://notion.so/page-created",
      })),
      update: vi.fn(),
      updateMarkdown: vi.fn(async () => ({
        object: "page_markdown",
        id: "page-1",
        markdown: "...",
        truncated: false,
        unknown_block_ids: [],
      })),
      move: vi.fn(async () => ({
        id: "page-1",
        url: "https://notion.so/page-1",
      })),
    },
    blocks: {
      retrieve: vi.fn(async ({ block_id }: any) => {
        for (const blocks of Object.values(tree)) {
          const found = blocks.find((block) => block.id === block_id);
          if (found) return found;
        }
        return { id: block_id, type: "paragraph", paragraph: { rich_text: richText("Existing") } };
      }),
      update: vi.fn(async ({ block_id, ...payload }: any) => ({ object: "block", id: block_id, ...payload })),
      delete: vi.fn(async ({ block_id }: any) => ({ id: block_id })),
      children: {
        list: vi.fn(async ({ block_id }: any) => ({
          results: tree[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        })),
        append: vi.fn(async (args: any) => {
          appendCalls.push(`append:${args.block_id}:${appendPositionId(args)}`);
          return {
            results: withCreatedBlockIds(args.children, `new-${appendCalls.length}`),
          };
        }),
      },
    },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
    appendCalls,
  };
}

async function connect(notion: any, config: CreateServerConfig = {}) {
  const server = createServer(() => notion, config);
  const client = new McpClient(
    { name: "identity-receipts-test", version: "1.0.0" },
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

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.clearAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("identity-bearing mutation receipts", () => {
  it("create_page returns success and a capped plain-text block_map for created top-level children", async () => {
    const longPlainText = "Plain ".repeat(20);
    const notion = makeNotion({
      "page-created": [
        paragraph("created-p", longPlainText),
        heading("created-h", "heading_2", "Heading text stays plain"),
        divider("created-divider"),
      ],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "create_page",
        arguments: {
          title: "Receipt page",
          parent_page_id: "parent-1",
          markdown: `${longPlainText}\n\n## Heading **text** stays plain\n\n---`,
        },
      }));

      expect(response).toMatchObject({
        id: "page-created",
        title: "Receipt page",
        url: "https://notion.so/page-created",
        success: true,
        block_map: [
          { block_id: "created-p", type: "paragraph", text_preview: longPlainText.slice(0, 80) },
          { block_id: "created-h", type: "heading_2", text_preview: "Heading text stays plain" },
          { block_id: "created-divider", type: "divider", text_preview: "" },
        ],
      });
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);
      expect(response.block_map[0].text_preview).toHaveLength(80);
      expect(response.block_map[1].text_preview).not.toContain("**");
    } finally {
      await close();
    }
  });

  it("create_page_from_file returns success and block_map from created top-level children", async () => {
    const rootDir = await makeTempDir("identity-receipts-");
    const filePath = join(rootDir, "receipt.md");
    await writeFile(filePath, "# Imported\nFile body");
    const notion = makeNotion({
      "page-created": [
        heading("file-h", "heading_1", "Imported"),
        paragraph("file-p", "File body"),
      ],
    });
    const { client, close } = await connect(notion, {
      transport: "stdio",
      workspaceRoot: rootDir,
    });

    try {
      const response = parseToolText(await client.callTool({
        name: "create_page_from_file",
        arguments: {
          title: "Imported receipt",
          file_path: filePath,
          parent_page_id: "parent-1",
        },
      }));

      expect(response).toMatchObject({
        id: "page-created",
        title: "Imported receipt",
        url: "https://notion.so/page-created",
        success: true,
        block_map: [
          { block_id: "file-h", type: "heading_1", text_preview: "Imported" },
          { block_id: "file-p", type: "paragraph", text_preview: "File body" },
        ],
      });
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);
    } finally {
      await close();
    }
  });

  it("append_content returns block_map matching blocks_added and omits it for zero appended blocks", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "append_content",
        arguments: {
          page_id: "page-1",
          markdown: "Appended **plain** text\n\n- Item",
        },
      }));

      expect(response).toMatchObject({
        success: true,
        blocks_added: 2,
        block_map: [
          { block_id: "new-1-0", type: "paragraph", text_preview: "Appended plain text" },
          { block_id: "new-1-1", type: "bulleted_list_item", text_preview: "Item" },
        ],
      });
      expect(response.block_map).toHaveLength(response.blocks_added);
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);

      const emptyResponse = parseToolText(await client.callTool({
        name: "append_content",
        arguments: { page_id: "page-1", markdown: "   " },
      }));
      expect(emptyResponse).toEqual({ success: true, blocks_added: 0 });
      expect(emptyResponse).not.toHaveProperty("block_map");
    } finally {
      await close();
    }
  });

  it("test 9 keeps plain append_content receipts exact with realistic created-only rows", async () => {
    const notion = makeNotion();
    const fixedCreatedRows = [
      {
        id: "t9-created-1",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "Plain append" } }] },
      },
      {
        id: "t9-created-2",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "Item" } }] },
      },
    ];
    const fixedLowLevelResponse = {
      results: fixedCreatedRows,
      has_more: false,
      next_cursor: null,
    };
    const fixedExpectedReceipt = {
      success: true,
      blocks_added: 2,
      block_map: [
        { block_id: "t9-created-1", type: "paragraph", text_preview: "Plain append" },
        { block_id: "t9-created-2", type: "bulleted_list_item", text_preview: "Item" },
      ],
    };
    const observedResponses: unknown[] = [];
    notion.blocks.children.append.mockImplementation(async (args: any) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t9-created-1", "t9-created-2"],
        trailingRows: [],
      });
      observedResponses.push(response);
      return response;
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "append_content",
        arguments: {
          page_id: "page-1",
          markdown: "Plain append\n\n- Item",
        },
      }));

      expect(response).toEqual(fixedExpectedReceipt);
      expect(response.blocks_added).toBe(2);
      expect(response.block_map).toEqual([
        { block_id: "t9-created-1", type: "paragraph", text_preview: "Plain append" },
        { block_id: "t9-created-2", type: "bulleted_list_item", text_preview: "Item" },
      ]);
      expect(observedResponses).toEqual([fixedLowLevelResponse]);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.append).toHaveBeenCalledWith({
        block_id: "page-1",
        children: [
          {
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: "Plain append" } }] },
          },
          {
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ type: "text", text: { content: "Item" } }] },
          },
        ],
      });
    } finally {
      await close();
    }
  });

  it("replace_content live returns block_map after replace and omits it when no children remain", async () => {
    const notion = makeNotion({
      "page-1": [
        paragraph("post-p", "After replace"),
        heading("post-h", "heading_3", "After heading"),
      ],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "replace_content",
        arguments: { page_id: "page-1", markdown: "After replace\n\n### After heading" },
      }));

      expect(response).toEqual({
        success: true,
        block_map: [
          { block_id: "post-p", type: "paragraph", text_preview: "After replace" },
          { block_id: "post-h", type: "heading_3", text_preview: "After heading" },
        ],
      });
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);

      notion.blocks.children.list.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const emptyResponse = parseToolText(await client.callTool({
        name: "replace_content",
        arguments: { page_id: "page-1", markdown: "" },
      }));
      expect(emptyResponse).toEqual({ success: true });
      expect(emptyResponse).not.toHaveProperty("block_map");
    } finally {
      await close();
    }
  });

  it("update_section default path returns deleted_blocks and block_map whose lengths match frozen counts", async () => {
    const notion = makeNotion({
      "page-1": [
        paragraph("intro", "Intro"),
        heading("h2-target", "heading_2", "Target"),
        paragraph("old-body", "Old body"),
        heading("h2-next", "heading_2", "Next"),
      ],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "## Replacement heading\nReplacement body",
        },
      }));

      expect(response).toEqual({
        deleted: 2,
        appended: 2,
        deleted_blocks: [
          { block_id: "h2-target", type: "heading_2", text_preview: "Target" },
          { block_id: "old-body", type: "paragraph", text_preview: "Old body" },
        ],
        block_map: [
          { block_id: "new-1-0", type: "heading_2", text_preview: "Replacement heading" },
          { block_id: "new-1-1", type: "paragraph", text_preview: "Replacement body" },
        ],
      });
      expect(response.deleted_blocks).toHaveLength(response.deleted);
      expect(response.block_map).toHaveLength(response.appended);
      expect(Object.keys(response.deleted_blocks[0])).toEqual(["block_id", "type", "text_preview"]);
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);
    } finally {
      await close();
    }
  });

  it("update_toggle returns deleted_blocks, block_map, and omits deleted_blocks when there were no existing children", async () => {
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details"), toggle("empty-toggle", "Empty", false)],
      "toggle-1": [paragraph("old-1", "Old one"), paragraph("old-2", "Old two")],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "Details",
          markdown: "New body\n\n- item",
        },
      }));

      expect(response).toEqual({
        success: true,
        block_id: "toggle-1",
        type: "toggle",
        deleted: 2,
        appended: 2,
        deleted_blocks: [
          { block_id: "old-1", type: "paragraph", text_preview: "Old one" },
          { block_id: "old-2", type: "paragraph", text_preview: "Old two" },
        ],
        block_map: [
          { block_id: "new-1-0", type: "paragraph", text_preview: "New body" },
          { block_id: "new-1-1", type: "bulleted_list_item", text_preview: "item" },
        ],
      });
      expect(response.deleted_blocks).toHaveLength(response.deleted);
      expect(response.block_map).toHaveLength(response.appended);
      expect(Object.keys(response.deleted_blocks[0])).toEqual(["block_id", "type", "text_preview"]);
      expect(Object.keys(response.block_map[0])).toEqual(["block_id", "type", "text_preview"]);

      const noDeleteResponse = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "Empty",
          markdown: "Fresh body",
        },
      }));
      expect(noDeleteResponse).toMatchObject({
        success: true,
        block_id: "empty-toggle",
        type: "toggle",
        deleted: 0,
        appended: 1,
        block_map: [
          { block_id: "new-2-0", type: "paragraph", text_preview: "Fresh body" },
        ],
      });
      expect(noDeleteResponse).not.toHaveProperty("deleted_blocks");
    } finally {
      await close();
    }
  });

  it("update_block live updated and archived receipts include success true", async () => {
    const notion = makeNotion({
      "page-1": [
        paragraph("block-1", "Old"),
        divider("divider-1"),
      ],
    });
    const { client, close } = await connect(notion);

    try {
      const updated = parseToolText(await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "block-1",
          markdown: "Updated paragraph",
        },
      }));
      expect(updated).toEqual({
        id: "block-1",
        type: "paragraph",
        updated: true,
        success: true,
      });

      const archived = parseToolText(await client.callTool({
        name: "update_block",
        arguments: {
          block_id: "divider-1",
          archived: true,
        },
      }));
      expect(archived).toEqual({
        id: "divider-1",
        type: "divider",
        archived: true,
        success: true,
      });
    } finally {
      await close();
    }
  });

  it("move_page and create_database receipts include success true", async () => {
    const notion = makeNotion();
    const { client, close } = await connect(notion);

    try {
      const moved = parseToolText(await client.callTool({
        name: "move_page",
        arguments: {
          page_id: "page-1",
          new_parent_id: "new-parent",
        },
      }));
      expect(moved).toEqual({
        id: "page-1",
        url: "https://notion.so/page-1",
        parent_id: "new-parent",
        success: true,
      });

      const createdDatabase = parseToolText(await client.callTool({
        name: "create_database",
        arguments: {
          title: "Receipt DB",
          parent_page_id: "parent-1",
          schema: [{ name: "Name", type: "title" }],
        },
      }));
      expect(createdDatabase).toEqual({
        id: "db-1",
        title: "Receipt DB",
        url: "https://notion.so/db-1",
        properties: ["Name"],
        success: true,
      });
    } finally {
      await close();
    }
  });
});

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";
import { appendResponseFixture } from "./helpers/append-response-fixture.js";

type Raw = Record<string, any> & { id: string; type: string; has_children?: boolean };

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return JSON.parse(text) as any;
}

function richText(text: string) {
  return [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
}

function paragraph(id: string, text: string, hasChildren = false): Raw {
  return { id, type: "paragraph", paragraph: { rich_text: richText(text) }, has_children: hasChildren };
}

function toggle(id: string, text: string, hasChildren = true): Raw {
  return { id, type: "toggle", toggle: { rich_text: richText(text) }, has_children: hasChildren };
}

function heading(id: string, type: "heading_1" | "heading_2" | "heading_3", text: string, isToggleable = true): Raw {
  return { id, type, [type]: { rich_text: richText(text), is_toggleable: isToggleable }, has_children: isToggleable };
}

function appendPositionId(args: any) {
  return args.position?.type === "after_block" ? args.position.after_block.id : "";
}

function makeNotion(
  tree: Record<string, Raw[]>,
  mutations: string[] = [],
) {
  return {
    blocks: {
      retrieve: vi.fn(),
      update: vi.fn(async ({ block_id, ...payload }: any) => {
        mutations.push(`update:${block_id}:${JSON.stringify(payload)}`);
        return { id: block_id, ...payload };
      }),
      delete: vi.fn(async ({ block_id }: any) => {
        mutations.push(`delete:${block_id}`);
        return { id: block_id };
      }),
      children: {
        list: vi.fn(async ({ block_id }: any) => ({
          results: tree[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        })),
        append: vi.fn(async (args: any) => {
          mutations.push(`append:${args.block_id}:${appendPositionId(args)}`);
          return {
            results: args.children.map((child: any, index: number) => ({
              id: `new-${index}`,
              type: child.type,
              [child.type]: child[child.type],
            })),
          };
        }),
      },
    },
    pages: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn(), updateMarkdown: vi.fn() },
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "update-toggle-test", version: "1.0.0" },
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

describe("update_toggle handler", () => {
  it("replaces a plain toggle body under the same toggle block id", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
      "toggle-1": [paragraph("old-1", "Old one"), paragraph("old-2", "Old two")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: " details ",
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
          { block_id: "new-0", type: "paragraph", text_preview: "New body" },
          { block_id: "new-1", type: "bulleted_list_item", text_preview: "item" },
        ],
      });
      expect(mutations).toEqual([
        "delete:old-1",
        "delete:old-2",
        "append:toggle-1:",
      ]);
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "toggle-1",
      }));
      expect(notion.blocks.children.append.mock.calls[0][0].children[0]).toEqual(expect.objectContaining({
        type: "paragraph",
        paragraph: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "New body" } })]),
        }),
      }));
    } finally {
      await close();
    }
  });

  it("replaces a toggleable heading body while preserving the heading block", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [heading("heading-toggle", "heading_2", "Script")],
      "heading-toggle": [paragraph("old-child", "Old child")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "script",
          markdown: "Replacement child",
        },
      }));

      expect(response).toEqual({
        success: true,
        block_id: "heading-toggle",
        type: "heading_2",
        deleted: 1,
        appended: 1,
        deleted_blocks: [
          { block_id: "old-child", type: "paragraph", text_preview: "Old child" },
        ],
        block_map: [
          { block_id: "new-0", type: "paragraph", text_preview: "Replacement child" },
        ],
      });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(mutations).toEqual([
        "delete:old-child",
        "append:heading-toggle:",
      ]);
    } finally {
      await close();
    }
  });

  it("returns available toggles when the title is missing", async () => {
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Available"), heading("heading-toggle", "heading_3", "Heading Toggle")],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "Missing",
          markdown: "Replacement",
        },
      }));

      expect(response.error).toBe(`Toggle not found: 'Missing'. Available toggles: ["Available","Heading Toggle"]`);
      expect(response.available_toggles).toEqual(["Available", "Heading Toggle"]);
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("treats a matching top-level wrapper as optional and appends only its children", async () => {
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
      "toggle-1": [paragraph("old-child", "Old child")],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "Details",
          markdown: "+++ Details\nWrapped replacement\n+++",
        },
      }));

      expect(response).toMatchObject({ success: true, block_id: "toggle-1", deleted: 1, appended: 1 });
      expect(notion.blocks.children.append.mock.calls[0][0].children).toHaveLength(1);
      expect(notion.blocks.children.append.mock.calls[0][0].children[0]).toEqual(expect.objectContaining({
        type: "paragraph",
        paragraph: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Wrapped replacement" } })]),
        }),
      }));
    } finally {
      await close();
    }
  });

  it("dry-run plans child replacement without deleting or appending", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
      "toggle-1": [paragraph("old-1", "Old one"), paragraph("old-2", "Old two")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "update_toggle",
        arguments: {
          page_id: "page-1",
          title: "Details",
          markdown: "New body\n\n- item",
          dry_run: true,
        },
      }));

      expect(response).toEqual({
        success: true,
        dry_run: true,
        operation: "update_toggle",
        page_id: "page-1",
        title: "Details",
        block_id: "toggle-1",
        type: "toggle",
        deleted: 2,
        appended: 2,
        would_delete_block_ids: ["old-1", "old-2"],
        append_parent_id: "toggle-1",
      });
      expect(mutations).toEqual([]);
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("test 7 reports only created rows from a synthetic over-returning update_toggle append", async () => {
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details", false)],
    });
    const trailingRows = [
      { id: "t7-trail-1", type: "paragraph", paragraph: { rich_text: richText("Trailing one") } },
      { id: "t7-trail-2", type: "paragraph", paragraph: { rich_text: richText("Trailing two") } },
    ];
    const fixedCreatedRows = [
      {
        id: "t7-created-1",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "New body" } }] },
      },
      {
        id: "t7-created-2",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "item" } }] },
      },
    ];
    const fixedLowLevelResponse = {
      results: [...fixedCreatedRows, ...trailingRows],
      has_more: false,
      next_cursor: null,
    };
    const fixedExpectedReceipt = {
      success: true,
      block_id: "toggle-1",
      type: "toggle",
      deleted: 0,
      appended: 2,
      block_map: [
        { block_id: "t7-created-1", type: "paragraph", text_preview: "New body" },
        { block_id: "t7-created-2", type: "bulleted_list_item", text_preview: "item" },
      ],
    };
    const observedResponses: unknown[] = [];
    notion.blocks.children.append.mockImplementation(async (args: any) => {
      // This is a mutation discriminator for source behavior unavailable in the retained observations and is not a model of those observations.
      const response = appendResponseFixture({
        mode: "synthetic-overreturn",
        children: args.children,
        createdIds: ["t7-created-1", "t7-created-2"],
        trailingRows,
      });
      observedResponses.push(response);
      return response;
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

      expect(response).toEqual(fixedExpectedReceipt);
      expect(response.appended).toBe(2);
      expect(response.block_map).toEqual([
        { block_id: "t7-created-1", type: "paragraph", text_preview: "New body" },
        { block_id: "t7-created-2", type: "bulleted_list_item", text_preview: "item" },
      ]);
      expect(JSON.stringify(response)).not.toContain("t7-trail-1");
      expect(JSON.stringify(response)).not.toContain("t7-trail-2");
      expect(observedResponses).toEqual([fixedLowLevelResponse]);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.append).toHaveBeenCalledWith({
        block_id: "toggle-1",
        children: [
          {
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: "New body" } }] },
          },
          {
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ type: "text", text: { content: "item" } }] },
          },
        ],
      });
    } finally {
      await close();
    }
  });
});

describe("archive_toggle handler", () => {
  it("lists restore_toggle with block-id schema", async () => {
    const { client, close } = await connect(makeNotion({}));

    try {
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "restore_toggle");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toMatchObject({
        type: "object",
        required: ["block_id"],
        properties: {
          block_id: { type: "string" },
          dry_run: { type: "boolean" },
        },
      });
      expect((tool?.inputSchema as any).properties).not.toHaveProperty("title");
      expect((tool?.inputSchema as any).properties).not.toHaveProperty("page_id");
    } finally {
      await close();
    }
  });

  it("archives a plain toggle container by title", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
      "toggle-1": [paragraph("child-1", "Child")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "archive_toggle",
        arguments: {
          page_id: "page-1",
          title: " details ",
        },
      }));

      expect(response).toEqual({
        success: true,
        archived: "toggle-1",
        title: "Details",
        type: "toggle",
      });
      expect(notion.blocks.update).toHaveBeenCalledWith({
        block_id: "toggle-1",
        in_trash: true,
      });
      expect(notion.blocks.children.list).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "page-1",
      }));
      expect(notion.blocks.children.list).not.toHaveBeenCalledWith(expect.objectContaining({
        block_id: "toggle-1",
      }));
    } finally {
      await close();
    }
  });

  it("archives a toggleable heading container by title", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [heading("heading-toggle", "heading_3", "Heading Toggle")],
      "heading-toggle": [paragraph("child-1", "Child")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "archive_toggle",
        arguments: {
          page_id: "page-1",
          title: "heading toggle",
        },
      }));

      expect(response).toEqual({
        success: true,
        archived: "heading-toggle",
        title: "Heading Toggle",
        type: "heading_3",
      });
      expect(notion.blocks.update).toHaveBeenCalledWith({
        block_id: "heading-toggle",
        in_trash: true,
      });
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("returns available toggles when the title is missing", async () => {
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Available"), heading("heading-toggle", "heading_2", "Heading Toggle")],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "archive_toggle",
        arguments: {
          page_id: "page-1",
          title: "Missing",
        },
      }));

      expect(response.error).toBe(`Toggle not found: 'Missing'. Available toggles: ["Available","Heading Toggle"]`);
      expect(response.available_toggles).toEqual(["Available", "Heading Toggle"]);
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("archives only the matched container without deleting children or appending blocks", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
      "toggle-1": [paragraph("child-1", "Child one"), paragraph("child-2", "Child two")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "archive_toggle",
        arguments: {
          page_id: "page-1",
          title: "Details",
        },
      }));

      expect(response).toMatchObject({ success: true, archived: "toggle-1" });
      expect(mutations).toEqual([
        "update:toggle-1:{\"in_trash\":true}",
      ]);
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("dry-run returns the archive target without mutating the toggle", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({
      "page-1": [toggle("toggle-1", "Details")],
    }, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "archive_toggle",
        arguments: {
          page_id: "page-1",
          title: "Details",
          dry_run: true,
        },
      }));

      expect(response).toEqual({
        success: true,
        dry_run: true,
        operation: "archive_toggle",
        page_id: "page-1",
        would_archive: "toggle-1",
        title: "Details",
        type: "toggle",
      });
      expect(mutations).toEqual([]);
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe("restore_toggle handler", () => {
  it("dry-run returns the restore target without mutating", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({}, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "restore_toggle",
        arguments: {
          block_id: "toggle-1",
          dry_run: true,
        },
      }));

      expect(response).toEqual({
        success: true,
        dry_run: true,
        operation: "restore_toggle",
        would_restore: "toggle-1",
      });
      expect(mutations).toEqual([]);
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("restores the archived block id with in_trash false", async () => {
    const mutations: string[] = [];
    const notion = makeNotion({}, mutations);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "restore_toggle",
        arguments: {
          block_id: "toggle-1",
        },
      }));

      expect(response).toEqual({
        success: true,
        restored: "toggle-1",
      });
      expect(notion.blocks.update).toHaveBeenCalledWith({
        block_id: "toggle-1",
        in_trash: false,
      });
      expect(mutations).toEqual([
        "update:toggle-1:{\"in_trash\":false}",
      ]);
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return JSON.parse(text) as any;
}

function richText(text: string) {
  return [{ plain_text: text, text: { content: text } }];
}

function appendPositionId(args: any) {
  return args.position?.type === "after_block" ? args.position.after_block.id : "";
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "update-section-test", version: "1.0.0" },
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

function makeUpdateSectionNotion(
  pageBlocks: any[],
  childBlocksById: Record<string, any[]> = {},
  mutations: string[] = [],
) {
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
      retrieve: vi.fn(),
      update: vi.fn(async (args: any) => {
        mutations.push(`update:${args.block_id}`);
        return { object: "block", id: args.block_id, ...args };
      }),
      delete: vi.fn(async (args: any) => {
        mutations.push(`delete:${args.block_id}`);
        return { id: args.block_id };
      }),
      children: {
        list: vi.fn(async (args: any) => ({
          results: args.block_id === "page-1" ? pageBlocks : childBlocksById[args.block_id] ?? [],
          has_more: false,
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
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

function getHeadingLevel(type: string): number {
  if (type === "heading_1") return 1;
  if (type === "heading_2") return 2;
  if (type === "heading_3") return 3;
  return 0;
}

function findSectionEnd(blocks: { type: string }[], headingIndex: number): number {
  const headingLevel = getHeadingLevel(blocks[headingIndex].type);
  let sectionEnd = blocks.length;

  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const level = getHeadingLevel(blocks[index].type);
    if (level > 0 && (headingLevel === 1 || level <= headingLevel)) {
      sectionEnd = index;
      break;
    }
  }

  return sectionEnd;
}

describe("update_section boundary logic", () => {
  it("H1 section ends at the next heading of any level", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "paragraph" },
      { type: "heading_2" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(3);
  });

  it("H1 section ends at the next H1", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "heading_1" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H1 section ends at next H3", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H1 with no subsequent headings extends to end", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(3);
  });

  it("H2 section ends at next H1 or H2 but not H3", () => {
    const blocks = [
      { type: "heading_2" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_2" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(4);
  });

  it("H2 section ends at H1", () => {
    const blocks = [
      { type: "heading_2" },
      { type: "paragraph" },
      { type: "heading_1" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H3 section ends at next H1, H2, or H3", () => {
    const blocks = [
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H3 section ends at H2", () => {
    const blocks = [
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_2" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });
});

describe("update_section handler", () => {
  it("preserves a non-first plain heading and replaces only its body", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "intro", type: "paragraph", paragraph: { rich_text: richText("Intro") } },
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement body",
          preserve_heading: true,
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 1, appended: 1 });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).toHaveBeenCalledWith({ block_id: "old-body" });
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "page-1",
        position: { type: "after_block", after_block: { id: "h2-target" } },
      }));
      expect(notion.blocks.children.append.mock.calls[0][0].children[0]).toEqual(expect.objectContaining({
        type: "paragraph",
        paragraph: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Replacement body" } })]),
        }),
      }));
    } finally {
      await close();
    }
  });

  it("preserves first-section ordering when preserve mode markdown is body-only", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement body",
          preserve_heading: true,
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 1, appended: 1 });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).toHaveBeenCalledWith({ block_id: "old-body" });
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "page-1",
        position: { type: "after_block", after_block: { id: "h2-target" } },
      }));
    } finally {
      await close();
    }
  });

  it("preserves the heading and allows an empty replacement body", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "",
          preserve_heading: true,
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 1, appended: 0 });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).toHaveBeenCalledWith({ block_id: "old-body" });
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("preserves a toggleable heading and replaces its children plus section body", async () => {
    const mutations: string[] = [];
    const notion = makeUpdateSectionNotion(
      [
        {
          id: "h2-target",
          type: "heading_2",
          has_children: true,
          heading_2: { rich_text: richText("Target"), is_toggleable: true },
        },
        { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
        { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
      ],
      {
        "h2-target": [
          { id: "old-child", type: "paragraph", paragraph: { rich_text: richText("Old child") } },
        ],
      },
      mutations,
    );
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement child",
          preserve_heading: true,
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 2, appended: 1 });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(mutations).toEqual([
        "delete:old-child",
        "delete:old-body",
        "append:h2-target:",
      ]);
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "h2-target",
      }));
    } finally {
      await close();
    }
  });

  it("strips a leading matching heading in preserve mode and uses its children plus following blocks", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "+++ ##  TARGET \nInside\n+++\nAfter",
          preserve_heading: true,
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 1, appended: 2 });
      const children = notion.blocks.children.append.mock.calls[0][0].children;
      expect(children.map((block: any) => block.type)).toEqual(["paragraph", "paragraph"]);
      expect(children[0].paragraph.rich_text[0].text.content).toBe("Inside");
      expect(children[1].paragraph.rich_text[0].text.content).toBe("After");
    } finally {
      await close();
    }
  });

  it("keeps default non-preserve behavior as full-section replacement", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "intro", type: "paragraph", paragraph: { rich_text: richText("Intro") } },
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement body",
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 2, appended: 1 });
      expect(notion.blocks.delete).toHaveBeenNthCalledWith(1, { block_id: "h2-target" });
      expect(notion.blocks.delete).toHaveBeenNthCalledWith(2, { block_id: "old-body" });
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "page-1",
        position: { type: "after_block", after_block: { id: "intro" } },
      }));
    } finally {
      await close();
    }
  });

  it("replaces the first section without moving replacement blocks after the next sibling heading", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "## Target\nReplacement body",
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 1, appended: 1 });
      expect(notion.blocks.update).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "h2-target",
        heading_2: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Target" } })]),
          is_toggleable: false,
        }),
      }));
      expect(notion.blocks.delete).toHaveBeenCalledOnce();
      expect(notion.blocks.delete).toHaveBeenCalledWith({ block_id: "old-body" });
      expect(notion.blocks.children.append).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "page-1",
        position: { type: "after_block", after_block: { id: "h2-target" } },
      }));
      expect(notion.blocks.children.append.mock.calls[0][0].children[0]).toEqual(expect.objectContaining({
        type: "paragraph",
        paragraph: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Replacement body" } })]),
        }),
      }));
    } finally {
      await close();
    }
  });

  it("reconciles a first-section toggle heading to a plain heading and deletes old body blocks before appending replacement blocks", async () => {
    const mutations: string[] = [];
    const notion = makeUpdateSectionNotion(
      [
        {
          id: "h2-target",
          type: "heading_2",
          has_children: true,
          heading_2: { rich_text: richText("Target"), is_toggleable: true },
        },
        { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
        { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
      ],
      {
        "h2-target": [
          { id: "old-child", type: "paragraph", paragraph: { rich_text: richText("Old child") } },
        ],
      },
      mutations,
    );
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "## Target\nReplacement body",
        },
      });

      expect(parseToolText(result)).toEqual({ deleted: 2, appended: 1 });
      expect(notion.blocks.update).toHaveBeenCalledWith(expect.objectContaining({
        block_id: "h2-target",
        heading_2: expect.objectContaining({ is_toggleable: false }),
      }));
      expect(mutations).toEqual([
        "update:h2-target",
        "delete:old-child",
        "delete:old-body",
        "append:page-1:h2-target",
      ]);
    } finally {
      await close();
    }
  });

  it("rejects first-section replacement that starts with the wrong heading type before destructive mutation", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "# Target\nReplacement body",
        },
      });

      expect(parseToolText(result)).toEqual({
        error: "update_section: when replacing the first section, markdown must start with a heading_2 block so following sections can stay in place.",
      });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("dry-run plans a non-first section replacement without mutating blocks", async () => {
    const notion = makeUpdateSectionNotion([
      { id: "intro", type: "paragraph", paragraph: { rich_text: richText("Intro") } },
      { id: "h2-target", type: "heading_2", heading_2: { rich_text: richText("Target") } },
      { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      { id: "h2-next", type: "heading_2", heading_2: { rich_text: richText("Next") } },
    ]);
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement body",
          dry_run: true,
        },
      });

      expect(parseToolText(result)).toEqual({
        success: true,
        dry_run: true,
        operation: "update_section",
        page_id: "page-1",
        heading: "Target",
        target_block_id: "h2-target",
        target_block_type: "heading_2",
        preserve_heading: false,
        deleted: 2,
        appended: 1,
        would_delete_block_ids: ["h2-target", "old-body"],
        append_parent_id: "page-1",
        append_after_block_id: "intro",
      });
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("dry-run preserve heading includes toggleable heading children in the delete plan", async () => {
    const notion = makeUpdateSectionNotion(
      [
        {
          id: "h2-target",
          type: "heading_2",
          has_children: true,
          heading_2: { rich_text: richText("Target"), is_toggleable: true },
        },
        { id: "old-body", type: "paragraph", paragraph: { rich_text: richText("Old body") } },
      ],
      {
        "h2-target": [
          { id: "old-child", type: "paragraph", paragraph: { rich_text: richText("Old child") } },
        ],
      },
    );
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({
        name: "update_section",
        arguments: {
          page_id: "page-1",
          heading: "Target",
          markdown: "Replacement child",
          preserve_heading: true,
          dry_run: true,
        },
      });

      expect(parseToolText(result)).toMatchObject({
        success: true,
        dry_run: true,
        operation: "update_section",
        target_block_id: "h2-target",
        preserve_heading: true,
        deleted: 2,
        appended: 1,
        would_delete_block_ids: ["old-child", "old-body"],
        append_parent_id: "h2-target",
      });
      expect(notion.blocks.children.list).toHaveBeenCalledWith(expect.objectContaining({ block_id: "h2-target" }));
      expect(notion.blocks.update).not.toHaveBeenCalled();
      expect(notion.blocks.delete).not.toHaveBeenCalled();
      expect(notion.blocks.children.append).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

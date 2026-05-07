import { describe, expect, it, vi } from "vitest";

import { appendBlocks, appendBlocksAfter, createPage } from "../src/notion-client.js";
import type { NotionBlock, RichText } from "../src/types.js";

function paragraph(index: number): NotionBlock {
  return {
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: `Block ${index}` } }],
    },
  };
}

function text(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function richText(
  content: string,
  options: {
    link?: string;
    responseOnly?: Record<string, unknown>;
    annotations?: RichText["annotations"];
  } = {},
): RichText {
  const segment: RichText & Record<string, unknown> = {
    type: "text",
    text: {
      content,
      ...(options.link ? { link: { url: options.link } } : {}),
    },
    ...options.responseOnly,
    ...(options.annotations ? { annotations: options.annotations } : {}),
  };
  return segment;
}

function bullet(content: string, children?: NotionBlock[]): NotionBlock {
  return {
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: text(content),
      ...(children ? { children } : {}),
    },
  };
}

function toggle(content: string, children?: NotionBlock[]): NotionBlock {
  return {
    type: "toggle",
    toggle: {
      rich_text: text(content),
      ...(children ? { children } : {}),
    },
  };
}

function callout(content: string, children?: NotionBlock[]): NotionBlock {
  return {
    type: "callout",
    callout: {
      rich_text: text(content),
      icon: { type: "emoji", emoji: "\u{1F4A1}" },
      ...(children ? { children } : {}),
    },
  } as NotionBlock;
}

function column(children: NotionBlock[]): NotionBlock {
  return {
    type: "column",
    column: { children },
  };
}

function columnList(columns: NotionBlock[]): NotionBlock {
  return {
    type: "column_list",
    column_list: { children: columns },
  };
}

function tableRow(content: string): NotionBlock {
  return {
    type: "table_row",
    table_row: { cells: [[{ type: "text", text: { content } }]] },
  };
}

function table(rows: NotionBlock[]): NotionBlock {
  return {
    type: "table",
    table: {
      table_width: 1,
      has_column_header: true,
      has_row_header: false,
      children: rows,
    },
  };
}

function codeBlock(content: string): NotionBlock {
  return {
    type: "code",
    code: {
      rich_text: [richText(content)],
      language: "typescript",
    },
  };
}

function blockText(block: NotionBlock) {
  return (block as any).paragraph.rich_text[0].text.content;
}

function blockLabel(block: NotionBlock) {
  switch (block.type) {
    case "paragraph":
      return block.paragraph.rich_text[0]?.text.content ?? "paragraph";
    case "bulleted_list_item":
      return block.bulleted_list_item.rich_text[0]?.text.content ?? "bulleted_list_item";
    case "numbered_list_item":
      return block.numbered_list_item.rich_text[0]?.text.content ?? "numbered_list_item";
    case "toggle":
      return block.toggle.rich_text[0]?.text.content ?? "toggle";
    case "callout":
      return block.callout.rich_text[0]?.text.content ?? "callout";
    case "heading_1":
      return block.heading_1.rich_text[0]?.text.content ?? "heading_1";
    case "heading_2":
      return block.heading_2.rich_text[0]?.text.content ?? "heading_2";
    case "heading_3":
      return block.heading_3.rich_text[0]?.text.content ?? "heading_3";
    case "table_row":
      return block.table_row.cells[0]?.[0]?.text.content ?? "table_row";
    case "column":
      return `column:${block.column.children[0] ? blockLabel(block.column.children[0]) : "empty"}`;
    case "column_list":
      return "column_list";
    default:
      return block.type;
  }
}

function makeBlocks(count: number) {
  return Array.from({ length: count }, (_, index) => paragraph(index));
}

function makeNotionClient() {
  const childrenByParentId = new Map<string, any[]>();

  function materializeChildren(children: NotionBlock[]) {
    return children.map((block) => {
      const result = {
        id: blockLabel(block),
        type: block.type,
      };
      const nestedChildren = (block as any)[block.type]?.children;
      if (Array.isArray(nestedChildren)) {
        childrenByParentId.set(result.id, materializeChildren(nestedChildren));
      }
      return result;
    });
  }

  return {
    pages: {
      create: vi.fn(async ({ children }: any) => {
        childrenByParentId.set("created-page-id", materializeChildren(children ?? []));
        return {
          id: "created-page-id",
          url: "https://notion.so/created-page-id",
        };
      }),
      update: vi.fn(async () => ({
        id: "created-page-id",
        in_trash: true,
      })),
    },
    blocks: {
      children: {
        append: vi.fn(async ({ children }: any) => ({
          results: materializeChildren(children),
        })),
        list: vi.fn(async ({ block_id }: any) => ({
          results: childrenByParentId.get(block_id) ?? [],
          has_more: false,
          next_cursor: null,
        })),
      },
    },
  } as any;
}

describe("notion-client block append chunking", () => {
  const afterBlockPosition = (id: string) => ({
    type: "after_block",
    after_block: { id },
  });

  it("splits long paragraph rich_text in page creation payloads while preserving metadata", async () => {
    const notion = makeNotionClient();
    const content = "a".repeat(4501);
    const link = "https://example.com/long";
    const annotations = { bold: true, italic: true, color: "red" };
    const blocks: NotionBlock[] = [{
      type: "paragraph",
      paragraph: {
        rich_text: [richText(content, {
          link,
          annotations,
          responseOnly: { href: link, plain_text: content },
        })],
      },
    }];

    await createPage(notion, "parent-page-id", "Long page", blocks);

    const sentRichText = notion.pages.create.mock.calls[0][0].children[0].paragraph.rich_text;
    expect(sentRichText.map((item: RichText) => item.text.content.length)).toEqual([2000, 2000, 501]);
    expect(sentRichText.map((item: RichText) => item.text.content).join("")).toBe(content);
    expect(sentRichText).toEqual(
      sentRichText.map((item: RichText) => ({
        type: "text",
        text: { content: item.text.content, link: { url: link } },
        annotations,
      })),
    );
    expect(sentRichText.some((item: Record<string, unknown>) => "href" in item || "plain_text" in item)).toBe(false);
  });

  it("splits long table cell rich_text before appending", async () => {
    const notion = makeNotionClient();
    const content = "b".repeat(2001);
    const blocks = [
      table([{
        type: "table_row",
        table_row: {
          cells: [[richText(content, { annotations: { code: true } })]],
        },
      }]),
    ];

    await appendBlocks(notion, "page-id", blocks);

    const sentCells = notion.blocks.children.append.mock.calls[0][0].children[0].table.children[0].table_row.cells;
    expect(sentCells[0].map((item: RichText) => item.text.content.length)).toEqual([2000, 1]);
    expect(sentCells[0].map((item: RichText) => item.text.content).join("")).toBe(content);
    expect(sentCells[0].every((item: RichText) => item.annotations?.code === true)).toBe(true);
  });

  it("splits long deferred nested code rich_text before appending child blocks", async () => {
    const notion = makeNotionClient();
    const content = "c".repeat(4005);

    await appendBlocks(notion, "page-id", [toggle("Toggle", [codeBlock(content)])]);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(2);
    const sentCode = notion.blocks.children.append.mock.calls[1][0].children[0].code;
    expect(sentCode.rich_text.map((item: RichText) => item.text.content.length)).toEqual([2000, 2000, 5]);
    expect(sentCode.rich_text.map((item: RichText) => item.text.content).join("")).toBe(content);
    expect(sentCode.language).toBe("typescript");
  });

  it("splits long callout child rich_text through deferred child appends", async () => {
    const notion = makeNotionClient();
    const content = "d".repeat(2001);

    await createPage(notion, "parent-page-id", "Callout page", [callout("Callout", [{
      type: "paragraph",
      paragraph: { rich_text: [richText(content, { annotations: { underline: true } })] },
    }])]);

    expect(notion.pages.create).toHaveBeenCalledTimes(1);
    expect((notion.pages.create.mock.calls[0][0].children[0] as any).callout.children).toBeUndefined();
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    expect(notion.blocks.children.append.mock.calls[0][0].block_id).toBe("Callout");

    const sentParagraph = notion.blocks.children.append.mock.calls[0][0].children[0].paragraph;
    expect(sentParagraph.rich_text.map((item: RichText) => item.text.content.length)).toEqual([2000, 1]);
    expect(sentParagraph.rich_text.map((item: RichText) => item.text.content).join("")).toBe(content);
    expect(sentParagraph.rich_text.every((item: RichText) => item.annotations?.underline === true)).toBe(true);
  });

  it("creates a page with at most 100 children and appends the remaining top-level blocks", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(101);

    const page = await createPage(notion, "parent-page-id", "Chunked page", blocks);

    expect(page).toEqual({
      id: "created-page-id",
      url: "https://notion.so/created-page-id",
    });
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
    expect(notion.pages.create.mock.calls[0][0].children).toEqual(blocks.slice(0, 100));
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    expect(notion.blocks.children.append).toHaveBeenCalledWith({
      block_id: "created-page-id",
      children: blocks.slice(100),
    });
    expect(notion.pages.update).not.toHaveBeenCalled();
  });

  it("appends page creation overflow in 100-block chunks while preserving order", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(250);

    await createPage(notion, "parent-page-id", "Chunked page", blocks);

    expect(notion.pages.create.mock.calls[0][0].children.map(blockText)).toEqual(
      blocks.slice(0, 100).map(blockText),
    );
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(2);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.length)).toEqual([100, 50]);
    expect(notion.blocks.children.append.mock.calls.flatMap(([args]: any[]) => args.children).map(blockText)).toEqual(
      blocks.slice(100).map(blockText),
    );
    expect(notion.pages.update).not.toHaveBeenCalled();
  });

  it("trashes the created page and rethrows the original error when overflow append fails", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(101);
    const appendError = new Error("append failed");
    notion.blocks.children.append.mockRejectedValueOnce(appendError);

    await expect(createPage(notion, "parent-page-id", "Chunked page", blocks)).rejects.toBe(appendError);

    expect(notion.pages.create).toHaveBeenCalledTimes(1);
    expect(notion.pages.create.mock.calls[0][0].children).toEqual(blocks.slice(0, 100));
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    expect(notion.pages.update).toHaveBeenCalledTimes(1);
    expect(notion.pages.update).toHaveBeenCalledWith({
      page_id: "created-page-id",
      in_trash: true,
    });
  });

  it("still rethrows the original append error if rollback fails", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(101);
    const appendError = new Error("append failed");
    notion.blocks.children.append.mockRejectedValueOnce(appendError);
    notion.pages.update.mockRejectedValueOnce(new Error("rollback failed"));

    await expect(createPage(notion, "parent-page-id", "Chunked page", blocks)).rejects.toBe(appendError);

    expect(notion.pages.update).toHaveBeenCalledWith({
      page_id: "created-page-id",
      in_trash: true,
    });
  });

  it("appendBlocks chunks at 100 blocks and preserves order", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(250);

    const results = await appendBlocks(notion, "page-id", blocks);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.length)).toEqual([100, 100, 50]);
    expect(notion.blocks.children.append.mock.calls.flatMap(([args]: any[]) => args.children).map(blockText)).toEqual(
      blocks.map(blockText),
    );
    expect(results.map((result: any) => result.id)).toEqual(blocks.map(blockText));
  });

  it("appends deeply nested list children recursively without grandchildren in the first request", async () => {
    const notion = makeNotionClient();
    const blocks = [
      bullet("Level 1", [
        bullet("Level 2", [
          bullet("Level 3", [
            bullet("Level 4"),
          ]),
        ]),
      ]),
    ];

    const results = await appendBlocks(notion, "page-id", blocks);

    expect(results.map((result: any) => result.id)).toEqual(["Level 1"]);
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(4);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "page-id",
      "Level 1",
      "Level 2",
      "Level 3",
    ]);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.map(blockLabel))).toEqual([
      ["Level 1"],
      ["Level 2"],
      ["Level 3"],
      ["Level 4"],
    ]);
    expect((notion.blocks.children.append.mock.calls[0][0].children[0] as any).bulleted_list_item.children).toBeUndefined();
    expect((notion.blocks.children.append.mock.calls[1][0].children[0] as any).bulleted_list_item.children).toBeUndefined();
    expect((notion.blocks.children.append.mock.calls[2][0].children[0] as any).bulleted_list_item.children).toBeUndefined();
  });

  it("chunks deferred direct children at 100 while preserving order", async () => {
    const notion = makeNotionClient();
    const children = makeBlocks(101);

    await appendBlocks(notion, "page-id", [toggle("Toggle", children)]);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.length)).toEqual([1, 100, 1]);
    expect((notion.blocks.children.append.mock.calls[0][0].children[0] as any).toggle.children).toBeUndefined();
    expect(notion.blocks.children.append.mock.calls[1][0].block_id).toBe("Toggle");
    expect(notion.blocks.children.append.mock.calls[2][0].block_id).toBe("Toggle");
    expect(notion.blocks.children.append.mock.calls.slice(1).flatMap(([args]: any[]) => args.children).map(blockText)).toEqual(
      children.map(blockText),
    );
  });

  it("defers nested callout children recursively without grandchildren in the first request", async () => {
    const notion = makeNotionClient();

    await appendBlocks(notion, "page-id", [callout("Callout", [bullet("Parent", [paragraph(1)])])]);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "page-id",
      "Callout",
      "Parent",
    ]);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.map(blockLabel))).toEqual([
      ["Callout"],
      ["Parent"],
      ["Block 1"],
    ]);
    expect((notion.blocks.children.append.mock.calls[0][0].children[0] as any).callout.children).toBeUndefined();
    expect((notion.blocks.children.append.mock.calls[1][0].children[0] as any).bulleted_list_item.children).toBeUndefined();
  });

  it("creates column lists with required column seed children and defers deeper column content", async () => {
    const notion = makeNotionClient();
    const blocks = [
      columnList([
        column([bullet("Left parent", [bullet("Left child")]), paragraph(1)]),
        column([paragraph(2)]),
      ]),
    ];

    await appendBlocks(notion, "page-id", blocks);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "page-id",
      "Left parent",
      "column:Left parent",
    ]);

    const columnListRequest = notion.blocks.children.append.mock.calls[0][0].children[0] as any;
    expect(columnListRequest.column_list.children).toHaveLength(2);
    expect(columnListRequest.column_list.children[0].column.children.map(blockLabel)).toEqual(["Left parent"]);
    expect(columnListRequest.column_list.children[0].column.children[0].bulleted_list_item.children).toBeUndefined();
    expect(JSON.stringify(columnListRequest)).not.toContain("Left child");

    expect(notion.blocks.children.append.mock.calls[1][0].children.map(blockLabel)).toEqual(["Left child"]);
    expect(notion.blocks.children.append.mock.calls[2][0].children.map(blockLabel)).toEqual(["Block 1"]);
    expect(notion.blocks.children.list.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "column_list",
      "column:Left parent",
    ]);
  });

  it("uses a safe placeholder seed when a column starts with a table", async () => {
    const notion = makeNotionClient();
    const blocks = [
      columnList([
        column([table([tableRow("Header")])]),
        column([paragraph(2)]),
      ]),
    ];

    await appendBlocks(notion, "page-id", blocks);

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(2);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "page-id",
      "column:paragraph",
    ]);

    const columnListRequest = notion.blocks.children.append.mock.calls[0][0].children[0] as any;
    const firstColumnSeed = columnListRequest.column_list.children[0].column.children[0];
    expect(firstColumnSeed.type).toBe("paragraph");
    expect(JSON.stringify(columnListRequest)).not.toContain("table_row");
    expect(JSON.stringify(columnListRequest)).not.toContain("Header");

    const deferredTable = notion.blocks.children.append.mock.calls[1][0].children[0] as any;
    expect(deferredTable.type).toBe("table");
    expect(deferredTable.table.children.map(blockLabel)).toEqual(["Header"]);
    expect(notion.blocks.children.list.mock.calls.map(([args]: any[]) => args.block_id)).toEqual(["column_list"]);
  });

  it("trashes the created page and rethrows when a deferred nested append fails", async () => {
    const notion = makeNotionClient();
    const appendError = new Error("nested append failed");
    notion.blocks.children.append.mockRejectedValueOnce(appendError);

    await expect(
      createPage(notion, "parent-page-id", "Nested page", [bullet("Parent", [bullet("Child")])]),
    ).rejects.toBe(appendError);

    expect(notion.pages.create).toHaveBeenCalledTimes(1);
    expect((notion.pages.create.mock.calls[0][0].children[0] as any).bulleted_list_item.children).toBeUndefined();
    expect(notion.blocks.children.list).toHaveBeenCalledWith({
      block_id: "created-page-id",
      start_cursor: undefined,
      page_size: 100,
    });
    expect(notion.pages.update).toHaveBeenCalledWith({
      page_id: "created-page-id",
      in_trash: true,
    });
  });

  it("appendBlocksAfter chunks at 100 blocks and carries the append position forward", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(250);

    const results = await appendBlocksAfter(notion, "page-id", blocks, "after-block-id");

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.length)).toEqual([100, 100, 50]);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.position)).toEqual([
      afterBlockPosition("after-block-id"),
      afterBlockPosition("Block 99"),
      afterBlockPosition("Block 199"),
    ]);
    expect(results.map((result: any) => result.id)).toEqual(blocks.map(blockText));
  });

  it("appendBlocksAfter preserves the top-level append position when nested children are deferred", async () => {
    const notion = makeNotionClient();
    const blocks = [
      bullet("Parent", [paragraph(999)]),
      ...makeBlocks(100),
    ];

    const results = await appendBlocksAfter(notion, "page-id", blocks, "after-block-id");

    expect(results.map((result: any) => result.id)).toEqual(["Parent", ...makeBlocks(100).map(blockText)]);
    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.block_id)).toEqual([
      "page-id",
      "Parent",
      "page-id",
    ]);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.position)).toEqual([
      afterBlockPosition("after-block-id"),
      undefined,
      afterBlockPosition("Block 98"),
    ]);
  });
});

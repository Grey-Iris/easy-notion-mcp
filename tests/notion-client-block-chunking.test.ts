import { describe, expect, it, vi } from "vitest";

import { appendBlocks, appendBlocksAfter, createPage } from "../src/notion-client.js";
import type { NotionBlock } from "../src/types.js";

function paragraph(index: number): NotionBlock {
  return {
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: `Block ${index}` } }],
    },
  };
}

function blockText(block: NotionBlock) {
  return (block as any).paragraph.rich_text[0].text.content;
}

function makeBlocks(count: number) {
  return Array.from({ length: count }, (_, index) => paragraph(index));
}

function makeNotionClient() {
  return {
    pages: {
      create: vi.fn(async () => ({
        id: "created-page-id",
        url: "https://notion.so/created-page-id",
      })),
      update: vi.fn(async () => ({
        id: "created-page-id",
        in_trash: true,
      })),
    },
    blocks: {
      children: {
        append: vi.fn(async ({ children }: any) => ({
          results: children.map((block: NotionBlock) => ({
            id: blockText(block),
          })),
        })),
      },
    },
  } as any;
}

describe("notion-client block append chunking", () => {
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

  it("appendBlocksAfter chunks at 100 blocks and carries the after cursor forward", async () => {
    const notion = makeNotionClient();
    const blocks = makeBlocks(250);

    const results = await appendBlocksAfter(notion, "page-id", blocks, "after-block-id");

    expect(notion.blocks.children.append).toHaveBeenCalledTimes(3);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.children.length)).toEqual([100, 100, 50]);
    expect(notion.blocks.children.append.mock.calls.map(([args]: any[]) => args.after)).toEqual([
      "after-block-id",
      "Block 99",
      "Block 199",
    ]);
    expect(results.map((result: any) => result.id)).toEqual(blocks.map(blockText));
  });
});

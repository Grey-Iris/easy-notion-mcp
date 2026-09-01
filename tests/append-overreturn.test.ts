import { describe, expect, it, vi } from "vitest";

import { appendBlocks, appendBlocksAfter } from "../src/notion-client.js";
import type { NotionBlock } from "../src/types.js";
import {
  APPEND_RESPONSE_FIXTURE_CURSOR,
  appendResponseFixture,
  type AppendResponseFixtureRow,
} from "./helpers/append-response-fixture.js";

function richText(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function paragraph(content: string): NotionBlock {
  return {
    type: "paragraph",
    paragraph: { rich_text: richText(content) },
  };
}

function toggle(content: string, children?: NotionBlock[]): NotionBlock {
  return {
    type: "toggle",
    toggle: {
      rich_text: richText(content),
      ...(children ? { children } : {}),
    },
  };
}

function row(id: string, type: string, payload: Record<string, unknown>): AppendResponseFixtureRow {
  return { id, type, [type]: payload };
}

function createdRow(id: string, block: NotionBlock): AppendResponseFixtureRow {
  return row(id, block.type, (block as any)[block.type]);
}

function paragraphRow(id: string, content: string): AppendResponseFixtureRow {
  return row(id, "paragraph", { rich_text: richText(content) });
}

function position(id: string) {
  return { type: "after_block", after_block: { id } };
}

function clientWithAppend(
  responder: (args: any, callIndex: number) => ReturnType<typeof appendResponseFixture>,
) {
  const append = vi.fn(async (args: any) => responder(args, append.mock.calls.length - 1));
  return {
    client: { blocks: { children: { append } } } as any,
    append,
  };
}

describe("append response over-return handling", () => {
  it("test 1 returns only created rows from a realistic single partial positioned chunk", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const trailingRows = [
      paragraphRow("t1-trail-1", "Trailing one"),
      paragraphRow("t1-trail-2", "Trailing two"),
      paragraphRow("t1-trail-3", "Trailing three"),
    ];
    const expectedCreated = [
      createdRow("t1-created-1", blocks[0]),
      createdRow("t1-created-2", blocks[1]),
    ];
    const fixedResponse = {
      results: [...expectedCreated, ...trailingRows],
      has_more: false,
      next_cursor: null,
    };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t1-created-1", "t1-created-2"],
        trailingRows,
      });
      observedResponses.push(response);
      return response;
    });

    const result = await appendBlocksAfter(client, "page-id", blocks, "after-block-id");

    expect(result).toEqual(expectedCreated);
    expect(result).toHaveLength(2);
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: blocks,
      position: position("after-block-id"),
    });
  });

  it("test 2 advances multi-chunk cursors from created rows under synthetic over-return", async () => {
    const blocks = Array.from({ length: 250 }, (_, index) => paragraph(`Block ${index}`));
    const expectedCreated = blocks.map((block, index) => createdRow(`t2-created-${index}`, block));
    const trailingByCall = [
      [paragraphRow("t2-c1-trail-1", "C1 trailing one"), paragraphRow("t2-c1-trail-2", "C1 trailing two")],
      [paragraphRow("t2-c2-trail-1", "C2 trailing one"), paragraphRow("t2-c2-trail-2", "C2 trailing two")],
      [paragraphRow("t2-c3-trail-1", "C3 trailing one"), paragraphRow("t2-c3-trail-2", "C3 trailing two")],
    ];
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args, callIndex) => {
      const start = callIndex * 100;
      // This is a mutation discriminator for source behavior unavailable in the retained observations and is not a model of those observations.
      const response = appendResponseFixture({
        mode: "synthetic-overreturn",
        children: args.children,
        createdIds: args.children.map((_: unknown, offset: number) => `t2-created-${start + offset}`),
        trailingRows: trailingByCall[callIndex],
      });
      observedResponses.push(response);
      return response;
    });

    const result = await appendBlocksAfter(client, "page-id", blocks, "after-block-id");

    expect(result).toEqual(expectedCreated);
    expect(append).toHaveBeenCalledTimes(3);
    expect(append.mock.calls.map(([args]) => args)).toEqual([
      { block_id: "page-id", children: blocks.slice(0, 100), position: position("after-block-id") },
      { block_id: "page-id", children: blocks.slice(100, 200), position: position("t2-created-99") },
      { block_id: "page-id", children: blocks.slice(200), position: position("t2-created-199") },
    ]);
    expect(observedResponses).toEqual([
      { results: [...expectedCreated.slice(0, 100), ...trailingByCall[0]], has_more: false, next_cursor: null },
      { results: [...expectedCreated.slice(100, 200), ...trailingByCall[1]], has_more: false, next_cursor: null },
      { results: [...expectedCreated.slice(200), ...trailingByCall[2]], has_more: false, next_cursor: null },
    ]);
  });

  it("test 3 models the realistic response cap without claiming to kill the cursor mutation", async () => {
    const blocks = Array.from({ length: 120 }, (_, index) => paragraph(`Block ${index}`));
    const expectedCreated = blocks.map((block, index) => createdRow(`t3-created-${index}`, block));
    const trailingRows = [
      paragraphRow("t3-trail-1", "Trailing one"),
      paragraphRow("t3-trail-2", "Trailing two"),
      paragraphRow("t3-trail-3", "Trailing three"),
      paragraphRow("t3-trail-4", "Trailing four"),
    ];
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args, callIndex) => {
      const start = callIndex * 100;
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: args.children.map((_: unknown, offset: number) => `t3-created-${start + offset}`),
        trailingRows,
      });
      observedResponses.push(response);
      return response;
    });

    const result = await appendBlocksAfter(client, "page-id", blocks, "after-block-id");

    expect(result).toEqual(expectedCreated);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map(([args]) => args)).toEqual([
      { block_id: "page-id", children: blocks.slice(0, 100), position: position("after-block-id") },
      { block_id: "page-id", children: blocks.slice(100), position: position("t3-created-99") },
    ]);
    expect(observedResponses).toEqual([
      {
        results: expectedCreated.slice(0, 100),
        has_more: true,
        next_cursor: APPEND_RESPONSE_FIXTURE_CURSOR,
      },
      {
        results: [...expectedCreated.slice(100), ...trailingRows],
        has_more: false,
        next_cursor: null,
      },
    ]);
  });

  it("test 4 rejects appendBlocks under-return with the exact error", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const returnedRows = [paragraphRow("t4-append-under-1", "Returned one")];
    const fixedResponse = { results: returnedRows, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      // This is a mutation discriminator and is not a model of a retained successful response.
      const response = appendResponseFixture({
        mode: "synthetic-invariant-violation",
        children: args.children,
        returnedRows,
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocks(client, "page-id", blocks)).rejects.toEqual(
      new Error("Notion append returned fewer results than blocks sent (sent 2, returned 1)"),
    );
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({ block_id: "page-id", children: blocks });
  });

  it("test 4 accepts appendBlocks at the exact response boundary", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const expectedCreated = [
      createdRow("t4-append-boundary-1", blocks[0]),
      createdRow("t4-append-boundary-2", blocks[1]),
    ];
    const fixedResponse = { results: expectedCreated, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t4-append-boundary-1", "t4-append-boundary-2"],
        trailingRows: [],
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocks(client, "page-id", blocks)).resolves.toEqual(expectedCreated);
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({ block_id: "page-id", children: blocks });
  });

  it("test 4 rejects appendBlocksAfter under-return with the exact error", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const returnedRows = [paragraphRow("t4-after-under-1", "Returned one")];
    const fixedResponse = { results: returnedRows, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      // This is a mutation discriminator and is not a model of a retained successful response.
      const response = appendResponseFixture({
        mode: "synthetic-invariant-violation",
        children: args.children,
        returnedRows,
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).rejects.toEqual(
      new Error("Notion append returned fewer results than blocks sent (sent 2, returned 1)"),
    );
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: blocks,
      position: position("after-block-id"),
    });
  });

  it("test 4 accepts appendBlocksAfter at the exact response boundary", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const expectedCreated = [
      createdRow("t4-after-boundary-1", blocks[0]),
      createdRow("t4-after-boundary-2", blocks[1]),
    ];
    const fixedResponse = { results: expectedCreated, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t4-after-boundary-1", "t4-after-boundary-2"],
        trailingRows: [],
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).resolves.toEqual(expectedCreated);
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: blocks,
      position: position("after-block-id"),
    });
  });

  it("test 4a checks under-return before a deferred child append", async () => {
    const blocks = [toggle("Outer", [toggle("Inner", [paragraph("Leaf")])]), paragraph("After")];
    const returnedRows = [row("t4a-under-toggle", "toggle", { rich_text: richText("Outer") })];
    const fixedResponse = { results: returnedRows, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      // This is a mutation discriminator and is not a model of a retained successful response.
      const response = appendResponseFixture({
        mode: "synthetic-invariant-violation",
        children: args.children,
        returnedRows,
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).rejects.toEqual(
      new Error("Notion append returned fewer results than blocks sent (sent 2, returned 1)"),
    );
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: [toggle("Outer"), paragraph("After")],
      position: position("after-block-id"),
    });
    expect(append.mock.calls.some(([args]) => args.block_id === "t4a-under-toggle")).toBe(false);
  });

  it("test 4a checks order and type before a deferred child append", async () => {
    const blocks = [toggle("Outer", [toggle("Inner", [paragraph("Leaf")])]), paragraph("After")];
    const returnedRows = [
      paragraphRow("t4a-mismatch-paragraph-1", "Foreign one"),
      paragraphRow("t4a-mismatch-paragraph-2", "Foreign two"),
    ];
    const fixedResponse = { results: returnedRows, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      // This is a mutation discriminator and is not a model of a retained successful response.
      const response = appendResponseFixture({
        mode: "synthetic-invariant-violation",
        children: args.children,
        returnedRows,
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).rejects.toEqual(
      new Error("Notion append results do not match sent block types (index 0: sent toggle, returned paragraph)"),
    );
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: [toggle("Outer"), paragraph("After")],
      position: position("after-block-id"),
    });
    expect(append.mock.calls.some(([args]) => args.block_id === "t4a-mismatch-paragraph-1")).toBe(false);
  });

  it("test 4b rejects an exact-length positional type mismatch", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const returnedRows = [
      row("t4b-divider", "divider", {}),
      paragraphRow("t4b-paragraph", "Two"),
    ];
    const fixedResponse = { results: returnedRows, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      // This is a mutation discriminator and is not a model of a retained successful response.
      const response = appendResponseFixture({
        mode: "synthetic-invariant-violation",
        children: args.children,
        returnedRows,
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).rejects.toEqual(
      new Error("Notion append results do not match sent block types (index 0: sent paragraph, returned divider)"),
    );
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: blocks,
      position: position("after-block-id"),
    });
  });

  it("test 4b accepts matching types in sent order", async () => {
    const blocks = [paragraph("One"), paragraph("Two")];
    const expectedCreated = [
      createdRow("t4b-created-1", blocks[0]),
      createdRow("t4b-created-2", blocks[1]),
    ];
    const fixedResponse = { results: expectedCreated, has_more: false, next_cursor: null };
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t4b-created-1", "t4b-created-2"],
        trailingRows: [],
      });
      observedResponses.push(response);
      return response;
    });

    await expect(appendBlocksAfter(client, "page-id", blocks, "after-block-id")).resolves.toEqual(expectedCreated);
    expect(observedResponses).toEqual([fixedResponse]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-id",
      children: blocks,
      position: position("after-block-id"),
    });
  });

  it("test 5 targets deferred children at the created container row", async () => {
    const inner = toggle("Inner", [paragraph("Leaf")]);
    const outer = toggle("Outer", [inner]);
    const expectedCreated = [row("t5-created-container", "toggle", { rich_text: richText("Outer") })];
    const trailingRows = [
      paragraphRow("t5-trail-1", "Trailing one"),
      paragraphRow("t5-trail-2", "Trailing two"),
    ];
    const observedResponses: unknown[] = [];
    const { client, append } = clientWithAppend((args) => {
      const topLevel = args.block_id === "page-id";
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: [topLevel ? "t5-created-container" : "t5-created-inner"],
        trailingRows: topLevel ? trailingRows : [],
      });
      observedResponses.push(response);
      return response;
    });

    const result = await appendBlocksAfter(client, "page-id", [outer], "after-block-id");

    expect(result).toEqual(expectedCreated);
    expect(observedResponses).toEqual([
      { results: [...expectedCreated, ...trailingRows], has_more: false, next_cursor: null },
      {
        results: [row("t5-created-inner", "toggle", {
          rich_text: richText("Inner"),
          children: [paragraph("Leaf")],
        })],
        has_more: false,
        next_cursor: null,
      },
    ]);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map(([args]) => args)).toEqual([
      {
        block_id: "page-id",
        children: [toggle("Outer")],
        position: position("after-block-id"),
      },
      {
        block_id: "t5-created-container",
        children: [inner],
      },
    ]);
    expect(append.mock.calls.filter(([args]) => args.block_id === "t5-created-container")).toHaveLength(1);
    expect(append.mock.calls.some(([args]) => args.block_id === "t5-trail-1")).toBe(false);
    expect(append.mock.calls.some(([args]) => args.block_id === "t5-trail-2")).toBe(false);
  });
});

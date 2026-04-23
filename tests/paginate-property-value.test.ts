import { describe, expect, it, vi } from "vitest";

import { paginatePropertyValue } from "../src/notion-client.js";

function makeStub(pages: Array<{ results: any[]; next_cursor: string | null; has_more: boolean }>) {
  let callIdx = 0;
  const calls: any[] = [];
  const retrieve = vi.fn(async (args: any) => {
    calls.push(args);
    return pages[callIdx++];
  });
  return { client: { pages: { properties: { retrieve } } } as any, retrieve, calls };
}

function relationItems(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    type: "relation",
    relation: { id: `rel-${offset + index}` },
  }));
}

function titleItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    type: "title",
    title: {
      type: "text",
      plain_text: `title-${index}`,
      text: { content: `title-${index}` },
    },
  }));
}

function richTextItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    type: "rich_text",
    rich_text: {
      type: "text",
      plain_text: `text-${index}`,
      text: { content: `text-${index}` },
    },
  }));
}

function peopleItems(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    type: "people",
    people: { id: `user-${offset + index}`, name: `User ${offset + index}` },
  }));
}

describe("paginatePropertyValue", () => {
  it("returns a single page relation value with more than 25 items", async () => {
    const { client, retrieve, calls } = makeStub([
      { results: relationItems(27), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "prop-1", "relation", 75);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ page_id: "page-1", property_id: "prop-1" });
    expect(result.values).toHaveLength(27);
    expect(result.values).toEqual(
      Array.from({ length: 27 }, (_, index) => ({ id: `rel-${index}` })),
    );
    expect(result.truncatedAtCap).toBe(false);
  });

  it("stops relation pagination at the cap when more pages exist", async () => {
    const { client, retrieve } = makeStub([
      { results: relationItems(75), next_cursor: "c1", has_more: true },
      { results: relationItems(75, 75), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "prop-1", "relation", 75);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.values).toHaveLength(75);
    expect(result.truncatedAtCap).toBe(true);
  });

  it("fetches all relation items when cap is zero", async () => {
    const { client, retrieve, calls } = makeStub([
      { results: relationItems(75), next_cursor: "c1", has_more: true },
      { results: relationItems(75, 75), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "prop-1", "relation", 0);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual({ page_id: "page-1", property_id: "prop-1", start_cursor: "c1" });
    expect(result.values).toHaveLength(150);
    expect(result.values[149]).toEqual({ id: "rel-149" });
    expect(result.truncatedAtCap).toBe(false);
  });

  it("reshapes title property items to rich text values", async () => {
    const { client, retrieve } = makeStub([
      { results: titleItems(30), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "title-prop", "title", 75);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.values).toHaveLength(30);
    expect(result.values[0]).toEqual({
      type: "text",
      plain_text: "title-0",
      text: { content: "title-0" },
    });
    expect(result.truncatedAtCap).toBe(false);
  });

  it("returns exactly 25 rich text items without truncation when no more pages exist", async () => {
    const { client, retrieve } = makeStub([
      { results: richTextItems(25), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "text-prop", "rich_text", 75);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.values).toHaveLength(25);
    expect(result.values[24]).toEqual({
      type: "text",
      plain_text: "text-24",
      text: { content: "text-24" },
    });
    expect(result.truncatedAtCap).toBe(false);
  });

  it("fetches all people items across three pages when cap is zero", async () => {
    const { client, retrieve } = makeStub([
      { results: peopleItems(100), next_cursor: "c1", has_more: true },
      { results: peopleItems(100, 100), next_cursor: "c2", has_more: true },
      { results: peopleItems(100, 200), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "people-prop", "people", 0);

    expect(retrieve).toHaveBeenCalledTimes(3);
    expect(result.values).toHaveLength(300);
    expect(result.values[299]).toEqual({ id: "user-299", name: "User 299" });
    expect(result.truncatedAtCap).toBe(false);
  });

  it("trims overshoot to the cap and reports truncation", async () => {
    const { client, retrieve } = makeStub([
      { results: relationItems(80), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePropertyValue(client, "page-1", "prop-1", "relation", 75);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.values).toHaveLength(75);
    expect(result.values[74]).toEqual({ id: "rel-74" });
    expect(result.truncatedAtCap).toBe(true);
  });

  it("throws when a paginated response has no results", async () => {
    const { client } = makeStub([
      { results: [], next_cursor: null, has_more: true },
    ]);

    await expect(
      paginatePropertyValue(client, "page-1", "prop-1", "relation", 0),
    ).rejects.toThrow(/runaway/);
  });

  it("throws when the next cursor does not advance", async () => {
    const { client } = makeStub([
      { results: relationItems(1), next_cursor: "x", has_more: true },
      { results: relationItems(1, 1), next_cursor: "x", has_more: true },
    ]);

    await expect(
      paginatePropertyValue(client, "page-1", "prop-1", "relation", 0),
    ).rejects.toThrow(/runaway/);
  });
});

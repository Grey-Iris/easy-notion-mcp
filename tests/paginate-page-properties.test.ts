import { describe, expect, it, vi } from "vitest";

import { paginatePageProperties } from "../src/notion-client.js";

function makeClient(pages: Array<{ results: any[]; next_cursor: string | null; has_more: boolean }>) {
  let callIdx = 0;
  const retrieve = vi.fn(async () => pages[callIdx++]);
  return { client: { pages: { properties: { retrieve } } } as any, retrieve };
}

function relationValues(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({ id: `rel-${offset + index}` }));
}

function relationItems(count: number, offset = 0) {
  return relationValues(count, offset).map((relation) => ({
    type: "relation",
    relation,
  }));
}

function peopleValues(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${offset + index}`,
    name: `User ${offset + index}`,
  }));
}

function peopleItems(count: number, offset = 0) {
  return peopleValues(count, offset).map((people) => ({
    type: "people",
    people,
  }));
}

function richTextValues(count: number, prefix = "text") {
  return Array.from({ length: count }, (_, index) => ({
    type: "text",
    plain_text: `${prefix}-${index}`,
    text: { content: `${prefix}-${index}` },
  }));
}

function titleItems(count: number) {
  return richTextValues(count, "title").map((title) => ({
    type: "title",
    title,
  }));
}

function richTextItems(count: number) {
  return richTextValues(count, "text").map((rich_text) => ({
    type: "rich_text",
    rich_text,
  }));
}

function pageWithProperties(properties: Record<string, any>) {
  return {
    object: "page",
    id: "page-1",
    properties,
  };
}

describe("paginatePageProperties", () => {
  it("paginates one relation property beyond the initial 25 values without mutating input", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(25),
      },
    });
    const { client } = makeClient([
      { results: relationItems(27), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(result.page).not.toBe(inputPage);
    expect(result.page.properties.Ref.relation).toHaveLength(27);
    expect(result.warnings).toEqual([]);
    expect(inputPage.properties.Ref.relation).toHaveLength(25);
  });

  it("keeps exactly 25 relation values when the full retrieved value has no more pages", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(25),
      },
    });
    const { client } = makeClient([
      { results: relationItems(25), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(result.page.properties.Ref.relation).toHaveLength(25);
    expect(result.warnings).toEqual([]);
  });

  it("skips multi select properties with 25 values", async () => {
    const inputPage = pageWithProperties({
      Tags: {
        id: "prop-tags",
        type: "multi_select",
        multi_select: Array.from({ length: 25 }, (_, index) => ({ name: `tag-${index}` })),
      },
    });
    const { client, retrieve } = makeClient([]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(retrieve).not.toHaveBeenCalled();
    expect(result.page.properties).toEqual(inputPage.properties);
    expect(result.warnings).toEqual([]);
  });

  it("warns when a people property is truncated at the cap", async () => {
    const inputPage = pageWithProperties({
      Assignees: {
        id: "prop-people",
        type: "people",
        people: peopleValues(25),
      },
    });
    const { client } = makeClient([
      { results: peopleItems(200), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(result.warnings[0]).toEqual({
      name: "Assignees",
      type: "people",
      returned_count: 75,
      cap: 75,
    });
    expect(result.page.properties.Assignees.people).toHaveLength(75);
  });

  it("paginates three truncated properties sequentially and reports three warnings", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(25),
      },
      Assignees: {
        id: "prop-people",
        type: "people",
        people: peopleValues(25),
      },
      Name: {
        id: "prop-title",
        type: "title",
        title: richTextValues(25, "title"),
      },
    });
    const { client, retrieve } = makeClient([
      { results: relationItems(200), next_cursor: null, has_more: false },
      { results: peopleItems(200), next_cursor: null, has_more: false },
      { results: titleItems(200), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(retrieve.mock.calls).toHaveLength(3);
    expect(result.warnings).toEqual([
      { name: "Ref", type: "relation", returned_count: 75, cap: 75 },
      { name: "Assignees", type: "people", returned_count: 75, cap: 75 },
      { name: "Name", type: "title", returned_count: 75, cap: 75 },
    ]);
    expect(result.page.properties.Ref.relation).toHaveLength(75);
    expect(result.page.properties.Assignees.people).toHaveLength(75);
    expect(result.page.properties.Name.title).toHaveLength(75);
  });

  it("paginates only requested property types", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(25),
      },
      Assignees: {
        id: "prop-people",
        type: "people",
        people: peopleValues(25),
      },
      Name: {
        id: "prop-title",
        type: "title",
        title: richTextValues(25, "title"),
      },
    });
    const { client, retrieve } = makeClient([
      { results: titleItems(30), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, {
      maxPropertyItems: 75,
      onlyTypes: ["title"],
    });

    expect(retrieve.mock.calls).toHaveLength(1);
    expect(result.page.properties.Ref.relation).toHaveLength(25);
    expect(result.page.properties.Assignees.people).toHaveLength(25);
    expect(result.page.properties.Name.title).toHaveLength(30);
  });

  it("does not paginate when no truncatable property has length 25", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(24),
      },
      Assignees: {
        id: "prop-people",
        type: "people",
        people: peopleValues(26),
      },
      Name: {
        id: "prop-title",
        type: "title",
        title: richTextValues(1, "title"),
      },
    });
    const { client, retrieve } = makeClient([]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(retrieve).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([]);
    expect(result.page.properties).toEqual(inputPage.properties);
  });

  it("does not mutate the input page while replacing paginated properties", async () => {
    const inputPage = pageWithProperties({
      Ref: {
        id: "prop-ref",
        type: "relation",
        relation: relationValues(25),
      },
    });
    const { client } = makeClient([
      { results: relationItems(30), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(result.page).not.toBe(inputPage);
    expect(inputPage.properties.Ref.relation).toHaveLength(25);
    expect(result.page.properties.Ref.relation).toHaveLength(30);
  });

  it("paginates rich text properties with 25 input values", async () => {
    const inputPage = pageWithProperties({
      Notes: {
        id: "prop-rich-text",
        type: "rich_text",
        rich_text: richTextValues(25, "text"),
      },
    });
    const { client } = makeClient([
      { results: richTextItems(30), next_cursor: null, has_more: false },
    ]);

    const result = await paginatePageProperties(client, inputPage, { maxPropertyItems: 75 });

    expect(result.page.properties.Notes.rich_text).toHaveLength(30);
    expect(result.warnings).toEqual([]);
  });
});

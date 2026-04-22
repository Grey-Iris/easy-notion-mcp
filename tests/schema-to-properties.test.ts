import { describe, expect, it } from "vitest";

import { schemaToProperties } from "../src/notion-client.js";

function asSchema<T extends Array<Record<string, unknown>>>(schema: T) {
  return schema as Array<{ name: string; type: string }>;
}

describe("schemaToProperties", () => {
  it("maps formula with expression", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Score", type: "formula", expression: 'prop("Count") * 2' },
        ]),
      ),
    ).toEqual({
      Score: { formula: { expression: 'prop("Count") * 2' } },
    });
  });

  it("throws when formula.expression is missing", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          { name: "Score", type: "formula" },
        ]),
      ),
    ).toThrow(/Score/);
  });

  it("maps rollup with function and property names", () => {
    expect(
      schemaToProperties(
        asSchema([
          {
            name: "TotalHours",
            type: "rollup",
            function: "sum",
            relation_property: "Tasks",
            rollup_property: "Hours",
          },
        ]),
      ),
    ).toEqual({
      TotalHours: {
        rollup: {
          function: "sum",
          relation_property_name: "Tasks",
          rollup_property_name: "Hours",
        },
      },
    });
  });

  it("throws when rollup.function is missing", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          {
            name: "TotalHours",
            type: "rollup",
            relation_property: "Tasks",
            rollup_property: "Hours",
          },
        ]),
      ),
    ).toThrow(/TotalHours/);
  });

  it("throws when rollup.relation_property is missing", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          {
            name: "TotalHours",
            type: "rollup",
            function: "sum",
            rollup_property: "Hours",
          },
        ]),
      ),
    ).toThrow(/TotalHours/);
  });

  it("throws when rollup.rollup_property is missing", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          {
            name: "TotalHours",
            type: "rollup",
            function: "sum",
            relation_property: "Tasks",
          },
        ]),
      ),
    ).toThrow(/TotalHours/);
  });

  it("maps relation to single_property by default", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Tasks", type: "relation", data_source_id: "ds-123" },
        ]),
      ),
    ).toEqual({
      Tasks: {
        relation: {
          data_source_id: "ds-123",
          type: "single_property",
          single_property: {},
        },
      },
    });
  });

  it("maps relation to dual_property with synced_property_name", () => {
    expect(
      schemaToProperties(
        asSchema([
          {
            name: "Tasks",
            type: "relation",
            data_source_id: "ds-123",
            relation_type: "dual_property",
            synced_property_name: "Parent Project",
          },
        ]),
      ),
    ).toEqual({
      Tasks: {
        relation: {
          data_source_id: "ds-123",
          type: "dual_property",
          dual_property: { synced_property_name: "Parent Project" },
        },
      },
    });
  });

  it("throws when relation.data_source_id is missing", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          { name: "Tasks", type: "relation" },
        ]),
      ),
    ).toThrow(/Tasks/);
  });

  it("maps unique_id with and without prefix", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Ticket", type: "unique_id", prefix: "ENG" },
          { name: "Auto", type: "unique_id" },
        ]),
      ),
    ).toEqual({
      Ticket: { unique_id: { prefix: "ENG" } },
      Auto: { unique_id: {} },
    });
  });

  it("maps number with and without format", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Price", type: "number", format: "dollar" },
          { name: "Count", type: "number" },
        ]),
      ),
    ).toEqual({
      Price: { number: { format: "dollar" } },
      Count: { number: {} },
    });
  });

  it("maps select, multi_select, and status string options", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "State", type: "select", options: ["Todo", "Done"] },
          { name: "Tags", type: "multi_select", options: ["A", "B"] },
          { name: "Status", type: "status", options: ["Todo", "Doing", "Done"] },
        ]),
      ),
    ).toEqual({
      State: { select: { options: [{ name: "Todo" }, { name: "Done" }] } },
      Tags: { multi_select: { options: [{ name: "A" }, { name: "B" }] } },
      Status: {
        status: { options: [{ name: "Todo" }, { name: "Doing" }, { name: "Done" }] },
      },
    });
  });

  it("passes through structured options for select, multi_select, and status", () => {
    const todo = { name: "Todo", color: "red", description: "Needs work" };
    const doing = { name: "Doing", color: "blue", description: "Active" };

    expect(
      schemaToProperties(
        asSchema([
          { name: "State", type: "select", options: [todo] },
          { name: "Tags", type: "multi_select", options: [doing] },
          { name: "Status", type: "status", options: [todo, doing] },
        ]),
      ),
    ).toEqual({
      State: { select: { options: [todo] } },
      Tags: { multi_select: { options: [doing] } },
      Status: { status: { options: [todo, doing] } },
    });
  });

  it("maps empty-object schema types", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Owner", type: "people" },
          { name: "Attachments", type: "files" },
          { name: "Created", type: "created_time" },
          { name: "Edited", type: "last_edited_time" },
          { name: "Author", type: "created_by" },
          { name: "Editor", type: "last_edited_by" },
          { name: "Verified", type: "verification" },
          { name: "Geo", type: "place" },
          { name: "Action", type: "button" },
          { name: "Where", type: "location" },
        ]),
      ),
    ).toEqual({
      Owner: { people: {} },
      Attachments: { files: {} },
      Created: { created_time: {} },
      Edited: { last_edited_time: {} },
      Author: { created_by: {} },
      Editor: { last_edited_by: {} },
      Verified: { verification: {} },
      Geo: { place: {} },
      Action: { button: {} },
      Where: { location: {} },
    });
  });

  it("maps text as rich_text", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Notes", type: "text" },
        ]),
      ),
    ).toEqual({
      Notes: { rich_text: {} },
    });
  });

  it("preserves existing simple types", () => {
    expect(
      schemaToProperties(
        asSchema([
          { name: "Title", type: "title" },
          { name: "Due", type: "date" },
          { name: "Done", type: "checkbox" },
          { name: "Link", type: "url" },
          { name: "Email", type: "email" },
          { name: "Phone", type: "phone" },
        ]),
      ),
    ).toEqual({
      Title: { title: {} },
      Due: { date: {} },
      Done: { checkbox: {} },
      Link: { url: {} },
      Email: { email: {} },
      Phone: { phone_number: {} },
    });
  });

  it("throws on unknown property types with a valid-types list", () => {
    expect(() =>
      schemaToProperties(
        asSchema([
          { name: "Mystery", type: "this_is_not_a_real_type" },
        ]),
      ),
    ).toThrow(/this_is_not_a_real_type|title|formula|relation|status/);
  });
});

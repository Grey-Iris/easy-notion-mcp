import { describe, expect, it } from "vitest";

import { simplifyProperty } from "../src/server.js";

describe("simplifyProperty", () => {
  it("simplifies formula number values", () => {
    expect(
      simplifyProperty({ type: "formula", formula: { type: "number", number: 42 } }),
    ).toBe(42);
  });

  it("simplifies formula string values", () => {
    expect(
      simplifyProperty({ type: "formula", formula: { type: "string", string: "done" } }),
    ).toBe("done");
  });

  it("simplifies formula boolean values", () => {
    expect(
      simplifyProperty({ type: "formula", formula: { type: "boolean", boolean: true } }),
    ).toBe(true);
  });

  it("simplifies formula date values", () => {
    expect(
      simplifyProperty({
        type: "formula",
        formula: {
          type: "date",
          date: { start: "2026-04-21", end: null, time_zone: "America/Los_Angeles" },
        },
      }),
    ).toEqual({
      start: "2026-04-21",
      end: null,
      time_zone: "America/Los_Angeles",
    });
  });

  it("simplifies rollup number values", () => {
    expect(
      simplifyProperty({ type: "rollup", rollup: { type: "number", number: 12, function: "sum" } }),
    ).toBe(12);
  });

  it("simplifies rollup date values", () => {
    expect(
      simplifyProperty({
        type: "rollup",
        rollup: {
          type: "date",
          date: { start: "2026-04-21", end: null },
          function: "latest_date",
        },
      }),
    ).toEqual({ start: "2026-04-21", end: null });
  });

  it("simplifies rollup arrays recursively", () => {
    expect(
      simplifyProperty({
        type: "rollup",
        rollup: {
          type: "array",
          function: "show_original",
          array: [
            { type: "number", number: 2 },
            { type: "select", select: { name: "Done" } },
            { type: "place", place: { lat: 1.2, lon: 3.4, name: "HQ" } },
          ],
        },
      }),
    ).toEqual([2, "Done", { lat: 1.2, lon: 3.4, name: "HQ" }]);
  });

  it("returns null for unsupported and incomplete rollups", () => {
    expect(
      simplifyProperty({ type: "rollup", rollup: { type: "unsupported", unsupported: {}, function: "sum" } }),
    ).toBeNull();
    expect(
      simplifyProperty({ type: "rollup", rollup: { type: "incomplete", incomplete: {}, function: "sum" } }),
    ).toBeNull();
  });

  it("simplifies external files", () => {
    expect(
      simplifyProperty({
        type: "files",
        files: [
          {
            type: "external",
            name: "Spec",
            external: { url: "https://example.com/spec.pdf" },
          },
        ],
      }),
    ).toEqual([
      { type: "external", url: "https://example.com/spec.pdf", name: "Spec" },
    ]);
  });

  it("simplifies internal files", () => {
    expect(
      simplifyProperty({
        type: "files",
        files: [
          {
            type: "file",
            name: "Internal",
            file: { url: "https://files.notion.so/internal.pdf" },
          },
        ],
      }),
    ).toEqual([
      { type: "file", url: "https://files.notion.so/internal.pdf", name: "Internal" },
    ]);
  });

  it("simplifies mixed files", () => {
    expect(
      simplifyProperty({
        type: "files",
        files: [
          {
            type: "external",
            name: "Spec",
            external: { url: "https://example.com/spec.pdf" },
          },
          {
            type: "file",
            name: "Internal",
            file: { url: "https://files.notion.so/internal.pdf" },
          },
        ],
      }),
    ).toEqual([
      { type: "external", url: "https://example.com/spec.pdf", name: "Spec" },
      { type: "file", url: "https://files.notion.so/internal.pdf", name: "Internal" },
    ]);
  });

  it("preserves existing people behavior", () => {
    expect(
      simplifyProperty({
        type: "people",
        people: [{ name: "Ada", id: "user-1" }, { name: null, id: "user-2" }],
      }),
    ).toEqual(["Ada", "user-2"]);
  });

  it("simplifies unique_id with and without prefix, and null", () => {
    expect(
      simplifyProperty({ type: "unique_id", unique_id: { prefix: "ENG", number: 42 } }),
    ).toBe("ENG-42");
    expect(
      simplifyProperty({ type: "unique_id", unique_id: { prefix: null, number: 42 } }),
    ).toBe("42");
    expect(
      simplifyProperty({ type: "unique_id", unique_id: null }),
    ).toBeNull();
  });

  it("passes through created_time and last_edited_time", () => {
    expect(
      simplifyProperty({ type: "created_time", created_time: "2026-04-21T12:00:00.000Z" }),
    ).toBe("2026-04-21T12:00:00.000Z");
    expect(
      simplifyProperty({ type: "last_edited_time", last_edited_time: "2026-04-21T12:30:00.000Z" }),
    ).toBe("2026-04-21T12:30:00.000Z");
  });

  it("simplifies created_by and last_edited_by with name fallback to id", () => {
    expect(
      simplifyProperty({ type: "created_by", created_by: { name: "Ada", id: "user-1" } }),
    ).toBe("Ada");
    expect(
      simplifyProperty({ type: "last_edited_by", last_edited_by: { name: null, id: "user-2" } }),
    ).toBe("user-2");
  });

  it("simplifies verification states", () => {
    expect(
      simplifyProperty({
        type: "verification",
        verification: {
          state: "verified",
          verified_by: { name: "Ada", id: "user-1" },
          date: { start: "2026-04-21T12:00:00.000Z", end: null, time_zone: null },
        },
      }),
    ).toEqual({
      state: "verified",
      verified_by: "Ada",
      date: { start: "2026-04-21T12:00:00.000Z", end: null, time_zone: null },
    });

    expect(
      simplifyProperty({
        type: "verification",
        verification: {
          state: "expired",
          verified_by: { name: null, id: "user-2" },
          date: { start: "2026-04-20T12:00:00.000Z", end: null, time_zone: null },
        },
      }),
    ).toEqual({
      state: "expired",
      verified_by: "user-2",
      date: { start: "2026-04-20T12:00:00.000Z", end: null, time_zone: null },
    });

    expect(
      simplifyProperty({
        type: "verification",
        verification: { state: "unverified", verified_by: null, date: null },
      }),
    ).toEqual({
      state: "unverified",
      verified_by: null,
      date: null,
    });
  });

  it("passes through place values and returns null when place is missing", () => {
    expect(
      simplifyProperty({
        type: "place",
        place: { lat: 1.2, lon: 3.4, name: "HQ", address: "1 Main St" },
      }),
    ).toEqual({ lat: 1.2, lon: 3.4, name: "HQ", address: "1 Main St" });
    expect(
      simplifyProperty({ type: "place", place: null }),
    ).toBeNull();
  });

  it("returns null for location on the read path", () => {
    expect(
      simplifyProperty({
        type: "location",
        location: { lat: 1.2, lon: 3.4, name: "HQ" },
      }),
    ).toBeNull();
  });

  it("returns null for button and unknown types", () => {
    expect(
      simplifyProperty({ type: "button", button: {} }),
    ).toBeNull();
    expect(
      simplifyProperty({ type: "future_type", future_type: { enabled: true } }),
    ).toBeNull();
  });

  it("preserves existing simple property behavior", () => {
    expect(
      simplifyProperty({
        type: "title",
        title: [{ plain_text: "Title" }, { plain_text: " Value" }],
      }),
    ).toBe("Title Value");
    expect(
      simplifyProperty({
        type: "rich_text",
        rich_text: [{ plain_text: "Hello" }, { plain_text: " world" }],
      }),
    ).toBe("Hello world");
    expect(simplifyProperty({ type: "number", number: 5 })).toBe(5);
    expect(simplifyProperty({ type: "select", select: { name: "Done" } })).toBe("Done");
    expect(
      simplifyProperty({ type: "multi_select", multi_select: [{ name: "A" }, { name: "B" }] }),
    ).toEqual(["A", "B"]);
    expect(
      simplifyProperty({ type: "date", date: { start: "2026-04-21", end: null } }),
    ).toBe("2026-04-21");
    expect(simplifyProperty({ type: "checkbox", checkbox: true })).toBe(true);
    expect(simplifyProperty({ type: "url", url: "https://example.com" })).toBe("https://example.com");
    expect(simplifyProperty({ type: "email", email: "dev@example.com" })).toBe("dev@example.com");
    expect(simplifyProperty({ type: "phone_number", phone_number: "555-0100" })).toBe("555-0100");
    expect(simplifyProperty({ type: "status", status: { name: "Doing" } })).toBe("Doing");
    expect(
      simplifyProperty({ type: "relation", relation: [{ id: "page-1" }, { id: "page-2" }] }),
    ).toEqual(["page-1", "page-2"]);
  });
});

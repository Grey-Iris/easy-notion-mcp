import { describe, expect, it } from "vitest";

import { convertPropertyValue } from "../src/notion-client.js";

function convert(type: string, value: unknown) {
  return convertPropertyValue(type, "Property", value);
}

describe("convertPropertyValue", () => {
  it("converts title text to Notion rich text", () => {
    expect(convert("title", "Launch plan")).toEqual({
      title: [{ type: "text", text: { content: "Launch plan" } }],
    });
  });

  it("converts rich_text text to Notion rich text", () => {
    expect(convert("rich_text", "Ready for review")).toEqual({
      rich_text: [{ type: "text", text: { content: "Ready for review" } }],
    });
  });

  it("converts a number without string coercion", () => {
    expect(convert("number", 42.5)).toEqual({
      number: 42.5,
    });
  });

  it("converts select to a named option", () => {
    expect(convert("select", "High")).toEqual({
      select: { name: "High" },
    });
  });

  it("converts multi_select to all named options", () => {
    expect(convert("multi_select", ["Backend", "Docs"])).toEqual({
      multi_select: [{ name: "Backend" }, { name: "Docs" }],
    });
  });

  it("converts status to a named option", () => {
    expect(convert("status", "In progress")).toEqual({
      status: { name: "In progress" },
    });
  });

  it("converts date to a start value", () => {
    expect(convert("date", "2026-05-06")).toEqual({
      date: { start: "2026-05-06" },
    });
  });

  it("converts checkbox to a boolean value", () => {
    expect(convert("checkbox", true)).toEqual({
      checkbox: true,
    });
  });

  it("converts url to a string value", () => {
    expect(convert("url", "https://example.com")).toEqual({
      url: "https://example.com",
    });
  });

  it("converts email to a string value", () => {
    expect(convert("email", "team@example.com")).toEqual({
      email: "team@example.com",
    });
  });

  it("converts phone_number to a string value", () => {
    expect(convert("phone_number", "+1 555 0100")).toEqual({
      phone_number: "+1 555 0100",
    });
  });

  it("converts a single people ID", () => {
    expect(convertPropertyValue("people", "Owner", "user-1")).toEqual({
      people: [{ id: "user-1" }],
    });
  });

  it("converts multiple people IDs", () => {
    expect(convertPropertyValue("people", "Owner", ["user-1", "user-2"])).toEqual({
      people: [{ id: "user-1" }, { id: "user-2" }],
    });
  });

  it("throws for files with the deferred task pointer", () => {
    expect(() => convertPropertyValue("files", "Attachments", "https://example.com/file.pdf")).toThrow(
      /files|notion-files-value-write/i,
    );
  });

  it("throws for verification with the deferred task pointer", () => {
    expect(() => convertPropertyValue("verification", "Verified", true)).toThrow(
      /verification|notion-verification-value-write/i,
    );
  });

  it("throws for place and button with a type-specific message", () => {
    expect(() => convertPropertyValue("place", "Geo", { lat: 1.2, lon: 3.4 })).toThrow(/place/i);
    expect(() => convertPropertyValue("button", "Run", "click")).toThrow(/button/i);
  });

  it("throws for computed Notion types", () => {
    for (const type of [
      "formula",
      "rollup",
      "unique_id",
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
    ]) {
      expect(() => convertPropertyValue(type, "Computed", "value")).toThrow(/computed by Notion/i);
    }
  });
});

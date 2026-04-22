import { describe, expect, it } from "vitest";

import { convertPropertyValue } from "../src/notion-client.js";

describe("convertPropertyValue", () => {
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

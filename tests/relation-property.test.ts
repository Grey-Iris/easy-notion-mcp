import { describe, expect, it } from "vitest";

import { convertPropertyValue } from "../src/notion-client.js";
import { simplifyProperty } from "../src/server.js";

// Thin wrapper around the production write-side dispatcher. Pinning the type
// to "relation" + a stable key keeps the assertion bodies focused on the
// relation-shape contract; any drift inside convertPropertyValue's relation
// branch surfaces here.
function convertRelation(value: unknown): { relation: Array<{ id: string }> } {
  return convertPropertyValue("relation", "Ref", value) as {
    relation: Array<{ id: string }>;
  };
}

// The production simplifyProperty dispatches on prop.type; the assertion
// bodies below pass bare {relation: ...} payloads, so we inject the
// discriminator here. Spread first so the test payload still controls the
// relation field shape (array, null, undefined, missing).
function simplifyRelation(prop: any): string[] {
  return simplifyProperty({ ...prop, type: "relation" }) as string[];
}

describe("relation property", () => {
  describe("write path (convertPropertyValues)", () => {
    it("converts an array of IDs to relation objects", () => {
      expect(convertRelation(["id-1", "id-2"])).toEqual({
        relation: [{ id: "id-1" }, { id: "id-2" }],
      });
    });

    it("wraps a single ID in a relation array", () => {
      expect(convertRelation("single-id")).toEqual({
        relation: [{ id: "single-id" }],
      });
    });

    it("filters out falsy values from an array", () => {
      expect(convertRelation(["id-1", "", null, undefined, "id-2"])).toEqual({
        relation: [{ id: "id-1" }, { id: "id-2" }],
      });
    });

    it("returns an empty relation array for an empty array", () => {
      expect(convertRelation([])).toEqual({
        relation: [],
      });
    });
  });

  describe("read path (simplifyProperty)", () => {
    it("extracts IDs from multiple relation objects", () => {
      expect(
        simplifyRelation({
          relation: [{ id: "a" }, { id: "b" }],
        }),
      ).toEqual(["a", "b"]);
    });

    it("extracts a single ID from a relation object", () => {
      expect(
        simplifyRelation({
          relation: [{ id: "a" }],
        }),
      ).toEqual(["a"]);
    });

    it("returns an empty array for an empty relation array", () => {
      expect(
        simplifyRelation({
          relation: [],
        }),
      ).toEqual([]);
    });

    it("returns an empty array for a null relation", () => {
      expect(
        simplifyRelation({
          relation: null,
        }),
      ).toEqual([]);
    });

    it("returns an empty array when relation is undefined", () => {
      expect(simplifyRelation({})).toEqual([]);
    });
  });
});

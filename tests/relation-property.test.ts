import { describe, expect, it } from "vitest";

// Copy of the relation branch from simplifyProperty (src/server.ts:77-78)
function simplifyRelation(prop: any): string[] {
  return prop.relation?.map((r: any) => r.id) ?? [];
}

// Copy of the relation branch from convertPropertyValues (src/notion-client.ts:240-248)
function convertRelation(value: unknown): { relation: Array<{ id: string }> } {
  return {
    relation: (Array.isArray(value) ? value : [value])
      .filter((id) => id)
      .map((id) => ({
        id: String(id),
      })),
  };
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

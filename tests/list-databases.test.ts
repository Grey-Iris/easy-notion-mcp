import { describe, expect, it } from "vitest";

// Copy of the mapping lambda from list_databases handler (src/server.ts)
function mapDataSource(r: any) {
  return {
    id: r.parent?.database_id ?? r.id,
    title: r.title?.[0]?.plain_text ?? "",
    url: r.url,
  };
}

describe("list_databases mapping", () => {
  it("extracts database_id from a database parent", () => {
    expect(
      mapDataSource({
        id: "ds-1",
        parent: { type: "database_id", database_id: "db-1" },
        title: [{ plain_text: "My DB" }],
        url: "https://notion.so/db-1",
      }),
    ).toEqual({ id: "db-1", title: "My DB", url: "https://notion.so/db-1" });
  });

  it("extracts database_id from a data_source parent (synced DB)", () => {
    expect(
      mapDataSource({
        id: "ds-2",
        parent: {
          type: "data_source_id",
          data_source_id: "ds-parent",
          database_id: "db-2",
        },
        title: [{ plain_text: "Synced" }],
        url: "https://notion.so/db-2",
      }),
    ).toEqual({ id: "db-2", title: "Synced", url: "https://notion.so/db-2" });
  });

  it("falls back to r.id when parent is missing", () => {
    expect(
      mapDataSource({
        id: "ds-3",
        title: [{ plain_text: "Orphan" }],
        url: "https://notion.so/ds-3",
      }),
    ).toEqual({ id: "ds-3", title: "Orphan", url: "https://notion.so/ds-3" });
  });

  it("returns empty string for an empty title array", () => {
    expect(
      mapDataSource({
        id: "ds-4",
        parent: { type: "database_id", database_id: "db-4" },
        title: [],
        url: "https://notion.so/db-4",
      }),
    ).toEqual({ id: "db-4", title: "", url: "https://notion.so/db-4" });
  });
});

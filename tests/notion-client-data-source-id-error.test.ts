import { describe, expect, it, vi } from "vitest";
import { getCachedSchema } from "../src/notion-client.js";

type MockClient = {
  dataSources: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  databases: {
    retrieve: ReturnType<typeof vi.fn>;
  };
};

function objectNotFoundError(message = "Could not find database") {
  const error: any = new Error(message);
  error.code = "object_not_found";
  error.body = { code: "object_not_found", message };
  return error;
}

describe("getCachedSchema data source ID errors", () => {
  it("getCachedSchema resolves normally for a database container ID", async () => {
    const schema = { id: "ds-happy", properties: { Name: { type: "title" } } };
    const client: MockClient = {
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-happy", data_sources: [{ id: "ds-happy" }] }),
      },
      dataSources: {
        retrieve: vi.fn().mockResolvedValue(schema),
      },
    };

    await expect(getCachedSchema(client as any, "db-happy")).resolves.toBe(schema);

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: "db-happy" });
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: "ds-happy" });
    expect(client.dataSources.retrieve).not.toHaveBeenCalledWith({ data_source_id: "db-happy" });
  });

  it("getCachedSchema rejects a data_source ID with layer-mismatch guidance and parent database ID", async () => {
    const client: MockClient = {
      databases: {
        retrieve: vi.fn().mockRejectedValue(objectNotFoundError()),
      },
      dataSources: {
        retrieve: vi.fn().mockResolvedValue({
          object: "data_source",
          id: "ds-wrong",
          parent: { type: "database_id", database_id: "db-parent" },
          properties: {},
        }),
      },
    };

    let thrown: unknown;
    try {
      await getCachedSchema(client as any, "ds-wrong");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("data_source");
    expect(message).toContain("list_databases");
    expect(message).toContain("db-parent");
    expect(message).not.toContain("Make sure the page/database is shared with your Notion integration");
  });

  it("getCachedSchema preserves original object_not_found when neither database nor data source exists", async () => {
    const original: any = new Error("Could not find database");
    original.code = "object_not_found";
    original.body = { code: "object_not_found", message: "Could not find database" };
    const fallback = objectNotFoundError("Could not find data source");
    const client: MockClient = {
      databases: {
        retrieve: vi.fn().mockRejectedValue(original),
      },
      dataSources: {
        retrieve: vi.fn().mockRejectedValue(fallback),
      },
    };

    await expect(getCachedSchema(client as any, "db-missing-specific")).rejects.toBe(original);
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: "db-missing-specific" });
  });

  it("getCachedSchema does not cache layer-mismatch failures and allows a later successful resolution", async () => {
    const schema = { id: "ds-cache-good", properties: { Name: { type: "title" } } };
    const client: MockClient = {
      databases: {
        retrieve: vi
          .fn()
          .mockRejectedValueOnce(objectNotFoundError())
          .mockResolvedValueOnce({ id: "db-cache-parent", data_sources: [{ id: "ds-cache-good" }] }),
      },
      dataSources: {
        retrieve: vi
          .fn()
          .mockResolvedValueOnce({
            object: "data_source",
            id: "ds-cache-mismatch",
            parent: { type: "database_id", database_id: "db-cache-parent" },
            properties: {},
          })
          .mockResolvedValueOnce(schema),
      },
    };

    await expect(getCachedSchema(client as any, "ds-cache-mismatch")).rejects.toThrow(/data_source/);
    await expect(getCachedSchema(client as any, "db-cache-parent")).resolves.toBe(schema);

    expect(client.dataSources.retrieve).toHaveBeenCalledTimes(2);
    expect(client.dataSources.retrieve).toHaveBeenNthCalledWith(1, { data_source_id: "ds-cache-mismatch" });
    expect(client.dataSources.retrieve).toHaveBeenNthCalledWith(2, { data_source_id: "ds-cache-good" });
  });
});

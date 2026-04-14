import { describe, expect, it, vi } from "vitest";
import * as notionClient from "../src/notion-client.js";

type MockClient = {
  dataSources: {
    update: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
  };
  databases: {
    retrieve: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function makeMockClient(overrides?: Partial<MockClient>): MockClient {
  return {
    dataSources: {
      update: vi.fn().mockResolvedValue({ id: "ds-updated" }),
      retrieve: vi.fn().mockResolvedValue({ id: "ds-1", properties: {} }),
      ...overrides?.dataSources,
    },
    databases: {
      retrieve: vi.fn().mockResolvedValue({ id: "db-1", data_sources: [{ id: "ds-1" }] }),
      create: vi.fn().mockResolvedValue({ id: "db-created", url: "https://notion.so/db-created" }),
      ...overrides?.databases,
    },
  };
}

function getUpdateDataSource() {
  expect((notionClient as any).updateDataSource).toBeTypeOf("function");
  return (notionClient as any).updateDataSource as (
    client: any,
    databaseId: string,
    updates: {
      title?: string;
      properties?: Record<string, unknown>;
      in_trash?: boolean;
    },
  ) => Promise<any>;
}

describe("updateDataSource", () => {
  it("forwards a raw properties map unchanged", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-raw", data_sources: [{ id: "ds-raw" }] }),
      } as Partial<MockClient["databases"]>,
    });
    const properties = {
      Status: {
        status: {
          options: [{ name: "A" }, { name: "B" }],
        },
      },
    };

    await getUpdateDataSource()(client as any, "db-raw", { properties });

    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data_source_id: "ds-raw",
        properties,
      }),
    );
    expect(client.dataSources.update.mock.calls[0]?.[0]?.properties).toBe(properties);
  });

  it("resolves databaseId to dataSourceId before dispatching update", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-456", data_sources: [{ id: "ds-123" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await getUpdateDataSource()(client as any, "db-456", { title: "Renamed" });

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: "db-456" });
    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "ds-123" }),
    );
  });

  it("wraps title via rich text before sending", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-title", data_sources: [{ id: "ds-title" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await getUpdateDataSource()(client as any, "db-title", { title: "New name" });

    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: [{ type: "text", text: { content: "New name" } }],
      }),
    );
  });

  it("forwards in_trash literally and never aliases archived", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-trash", data_sources: [{ id: "ds-trash" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await getUpdateDataSource()(client as any, "db-trash", { in_trash: true });

    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({ in_trash: true }),
    );
    expect(client.dataSources.update.mock.calls[0]?.[0]).not.toHaveProperty("archived");
  });

  it("throws on an empty updates object before any network call", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-empty", data_sources: [{ id: "ds-empty" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await expect(getUpdateDataSource()(client as any, "db-empty", {})).rejects.toThrow(
      "updateDataSource: at least one of `title`, `properties`, or `in_trash` must be provided",
    );
    expect(client.databases.retrieve).not.toHaveBeenCalled();
    expect(client.dataSources.update).not.toHaveBeenCalled();
  });

  it("preserves property delete via null", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-null", data_sources: [{ id: "ds-null" }] }),
      } as Partial<MockClient["databases"]>,
    });
    const properties = { Legacy: null };

    await getUpdateDataSource()(client as any, "db-null", { properties });

    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({ properties }),
    );
    expect(client.dataSources.update.mock.calls[0]?.[0]?.properties).toEqual({ Legacy: null });
  });

  it("passes property rename payloads through untouched", async () => {
    const client = makeMockClient({
      databases: {
        retrieve: vi.fn().mockResolvedValue({ id: "db-rename", data_sources: [{ id: "ds-rename" }] }),
      } as Partial<MockClient["databases"]>,
    });
    const properties = { Old: { name: "New" } };

    await getUpdateDataSource()(client as any, "db-rename", { properties });

    expect(client.dataSources.update).toHaveBeenCalledWith(
      expect.objectContaining({ properties }),
    );
  });

  it("invalidates cached schema after a successful update but not after a failed update", async () => {
    const successClient = makeMockClient({
      dataSources: {
        retrieve: vi
          .fn()
          .mockResolvedValueOnce({ id: "ds-cache-success", properties: { Name: { type: "title" } } })
          .mockResolvedValueOnce({ id: "ds-cache-success", properties: { Name: { type: "rich_text" } } }),
      } as Partial<MockClient["dataSources"]>,
      databases: {
        retrieve: vi
          .fn()
          .mockResolvedValue({ id: "db-cache-success", data_sources: [{ id: "ds-cache-success" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await notionClient.getCachedSchema(successClient as any, "db-cache-success");
    expect(successClient.dataSources.retrieve).toHaveBeenCalledTimes(1);

    await getUpdateDataSource()(successClient as any, "db-cache-success", { title: "Fresh schema" });
    await notionClient.getCachedSchema(successClient as any, "db-cache-success");

    expect(successClient.dataSources.retrieve).toHaveBeenCalledTimes(2);

    const failedClient = makeMockClient({
      dataSources: {
        update: vi.fn().mockRejectedValue(new Error("boom")),
        retrieve: vi
          .fn()
          .mockResolvedValueOnce({ id: "ds-cache-fail", properties: { Name: { type: "title" } } }),
      } as Partial<MockClient["dataSources"]>,
      databases: {
        retrieve: vi
          .fn()
          .mockResolvedValue({ id: "db-cache-fail", data_sources: [{ id: "ds-cache-fail" }] }),
      } as Partial<MockClient["databases"]>,
    });

    await notionClient.getCachedSchema(failedClient as any, "db-cache-fail");
    expect(failedClient.dataSources.retrieve).toHaveBeenCalledTimes(1);

    await expect(
      getUpdateDataSource()(failedClient as any, "db-cache-fail", { title: "Should fail" }),
    ).rejects.toThrow("boom");
    await notionClient.getCachedSchema(failedClient as any, "db-cache-fail");

    expect(failedClient.dataSources.retrieve).toHaveBeenCalledTimes(1);
  });
});

describe("createDatabase", () => {
  it("still omits is_inline when options are not provided", async () => {
    const client = makeMockClient();
    const schema = [{ name: "Name", type: "title" }];

    await notionClient.createDatabase(client as any, "parent-1", "Tasks", schema);

    expect(client.databases.create).toHaveBeenCalledTimes(1);
    const body = client.databases.create.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty("is_inline");
    expect(body).toEqual(
      expect.objectContaining({
        parent: { type: "page_id", page_id: "parent-1" },
        title: [{ type: "text", text: { content: "Tasks" } }],
      }),
    );
  });

  it("forwards is_inline: true when requested", async () => {
    const client = makeMockClient();

    await notionClient.createDatabase(
      client as any,
      "parent-inline-true",
      "Inline true",
      [{ name: "Name", type: "title" }],
      { is_inline: true } as any,
    );

    expect(client.databases.create).toHaveBeenCalledWith(
      expect.objectContaining({ is_inline: true }),
    );
  });

  it("forwards is_inline: false when requested", async () => {
    const client = makeMockClient();

    await notionClient.createDatabase(
      client as any,
      "parent-inline-false",
      "Inline false",
      [{ name: "Name", type: "title" }],
      { is_inline: false } as any,
    );

    expect(client.databases.create).toHaveBeenCalledWith(
      expect.objectContaining({ is_inline: false }),
    );
  });
});

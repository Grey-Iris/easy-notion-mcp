import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/notion-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/notion-client.js")>(
    "../src/notion-client.js",
  );

  return {
    ...actual,
    createPage: vi.fn(),
    findWorkspacePages: vi.fn(),
  };
});

import { createPage, findWorkspacePages } from "../src/notion-client.js";
import { createServer, type CreateServerConfig } from "../src/server.js";

function parseToolResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Expected text content in tool result");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function createConnectedClient(config: CreateServerConfig = {}) {
  const notion = {};
  const server = createServer(() => notion as any, config);
  const client = new McpClient(
    { name: "parent-resolution-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    async close() {
      await Promise.all([
        clientTransport.close(),
        serverTransport.close(),
      ]);
    },
  };
}

describe("parent resolution", () => {
  beforeEach(() => {
    vi.mocked(createPage).mockResolvedValue({
      id: "new-page-id",
      url: "https://notion.so/new-page",
    } as any);
    vi.mocked(findWorkspacePages).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prefers explicit parent_page_id", async () => {
    const { client, close } = await createConnectedClient();

    try {
      await client.callTool({
        name: "create_page",
        arguments: {
          title: "Explicit Parent",
          markdown: "Body",
          parent_page_id: "parent-123",
        },
      });

      expect(createPage).toHaveBeenCalledWith(
        expect.anything(),
        { type: "page_id", page_id: "parent-123" },
        "Explicit Parent",
        expect.any(Array),
        undefined,
        undefined,
      );
    } finally {
      await close();
    }
  });

  it("falls back to rootPageId when no explicit parent is provided", async () => {
    const { client, close } = await createConnectedClient({ rootPageId: "root-456" });

    try {
      await client.callTool({
        name: "create_page",
        arguments: {
          title: "Root Parent",
          markdown: "Body",
        },
      });

      expect(createPage).toHaveBeenCalledWith(
        expect.anything(),
        { type: "page_id", page_id: "root-456" },
        "Root Parent",
        expect.any(Array),
        undefined,
        undefined,
      );
    } finally {
      await close();
    }
  });

  it("reuses the last explicit parent within the same session", async () => {
    const { client, close } = await createConnectedClient();

    try {
      await client.callTool({
        name: "create_page",
        arguments: {
          title: "First",
          markdown: "Body",
          parent_page_id: "sticky-789",
        },
      });

      await client.callTool({
        name: "create_page",
        arguments: {
          title: "Second",
          markdown: "Body",
        },
      });

      expect(createPage).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        { type: "page_id", page_id: "sticky-789" },
        "Second",
        expect.any(Array),
        undefined,
        undefined,
      );
    } finally {
      await close();
    }
  });

  it("uses a workspace parent in OAuth mode and returns a note", async () => {
    const { client, close } = await createConnectedClient({ allowWorkspaceParent: true });

    try {
      const result = await client.callTool({
        name: "create_page",
        arguments: {
          title: "Workspace Parent",
          markdown: "Body",
        },
      });

      expect(createPage).toHaveBeenCalledWith(
        expect.anything(),
        { type: "workspace", workspace: true },
        "Workspace Parent",
        expect.any(Array),
        undefined,
        undefined,
      );

      expect(parseToolResult(result).note).toBe(
        "Created as a private workspace page. Use move_page to relocate.",
      );
    } finally {
      await close();
    }
  });

  it("returns an error when no parent can be resolved", async () => {
    vi.mocked(findWorkspacePages).mockResolvedValue([
      { id: "page-1", title: "Top Level" },
    ]);

    const { client, close } = await createConnectedClient();

    try {
      const result = await client.callTool({
        name: "create_page",
        arguments: {
          title: "Missing Parent",
          markdown: "Body",
        },
      });

      const response = parseToolResult(result);
      expect(response.error).toContain("parent_page_id is required");
      expect(findWorkspacePages).toHaveBeenCalledWith(expect.anything(), 5);
    } finally {
      await close();
    }
  });
});

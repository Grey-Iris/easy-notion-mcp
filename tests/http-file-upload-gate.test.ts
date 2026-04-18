import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/notion-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/notion-client.js")>(
    "../src/notion-client.js",
  );
  return {
    ...actual,
    uploadFile: vi.fn(),
    createPage: vi.fn(),
    appendBlocks: vi.fn(),
    listChildren: vi.fn(),
    deleteBlock: vi.fn(),
    appendBlocksAfter: vi.fn(),
    updatePage: vi.fn(),
    findWorkspacePages: vi.fn(),
  };
});

import {
  appendBlocks,
  appendBlocksAfter,
  createPage,
  deleteBlock,
  findWorkspacePages,
  listChildren,
  updatePage,
  uploadFile,
} from "../src/notion-client.js";
import { createServer, type CreateServerConfig } from "../src/server.js";

const GATE_PHRASE = /only supported in stdio transport/i;

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Expected text content in tool result");
  }
  return text;
}

async function createConnectedClient(config: CreateServerConfig = {}) {
  const notion = {};
  const server = createServer(() => notion as any, config);
  const client = new McpClient(
    { name: "http-file-upload-gate-test", version: "1.0.0" },
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
      await Promise.all([clientTransport.close(), serverTransport.close()]);
    },
  };
}

function headingBlock(id: string, text: string) {
  return {
    id,
    type: "heading_1",
    heading_1: { rich_text: [{ plain_text: text }] },
  };
}

describe("HTTP file:// upload gate (G-1a)", () => {
  beforeEach(() => {
    vi.mocked(uploadFile).mockReset();
    vi.mocked(createPage).mockReset();
    vi.mocked(appendBlocks).mockReset();
    vi.mocked(listChildren).mockReset();
    vi.mocked(deleteBlock).mockReset();
    vi.mocked(appendBlocksAfter).mockReset();
    vi.mocked(updatePage).mockReset();
    vi.mocked(findWorkspacePages).mockReset();

    vi.mocked(createPage).mockResolvedValue({
      id: "page-123",
      url: "https://notion.so/page-123",
    } as any);
    vi.mocked(appendBlocks).mockResolvedValue([]);
    vi.mocked(listChildren).mockResolvedValue([]);
    vi.mocked(deleteBlock).mockResolvedValue(undefined as any);
    vi.mocked(appendBlocksAfter).mockResolvedValue([]);
    vi.mocked(updatePage).mockResolvedValue({
      id: "page-123",
      url: "https://notion.so/page-123",
      properties: { title: { title: [{ plain_text: "Updated" }] } },
    } as any);
    vi.mocked(findWorkspacePages).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rejects file:// over HTTP transport", () => {
    it("FU-1: create_page with [x](file://...) returns gate error; uploadFile not called", async () => {
      const { client, close } = await createConnectedClient({
        transport: "http",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "[x](file:///tmp/x.png)",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(createPage).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("FU-2: append_content with [x](file://...) returns gate error; uploadFile not called", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.callTool({
          name: "append_content",
          arguments: {
            page_id: "page-123",
            markdown: "[x](file:///tmp/x.png)",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(appendBlocks).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("FU-3: replace_content with [x](file://...) returns gate error; uploadFile not called", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.callTool({
          name: "replace_content",
          arguments: {
            page_id: "page-123",
            markdown: "[x](file:///tmp/x.png)",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(appendBlocks).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("FU-4: update_section with [x](file://...) returns gate error; uploadFile not called", async () => {
      vi.mocked(listChildren).mockResolvedValue([headingBlock("h1", "Section")] as any);
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.callTool({
          name: "update_section",
          arguments: {
            page_id: "page-123",
            heading: "Section",
            markdown: "# Section\n[x](file:///tmp/x.png)",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(appendBlocksAfter).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("FU-5: update_page with cover: file://... returns gate error; uploadFile not called", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.callTool({
          name: "update_page",
          arguments: {
            page_id: "page-123",
            cover: "file:///tmp/cover.png",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(updatePage).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("FU-10: multiple file:// URLs in one markdown payload: gate fires once, no partial uploads", async () => {
      const { client, close } = await createConnectedClient({
        transport: "http",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "[a](file:///tmp/a.png)\n[b](file:///tmp/b.png)",
          },
        });

        expect(parseToolText(result)).toMatch(GATE_PHRASE);
        expect(uploadFile).toHaveBeenCalledTimes(0);
        expect(createPage).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });
  });

  describe("HTTP transport regression guards (file:// gate must NOT fire)", () => {
    it("FU-6: create_page with https:// URL succeeds (gate ignores non-file schemes)", async () => {
      const { client, close } = await createConnectedClient({
        transport: "http",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "![img](https://example.com/img.png)",
          },
        });

        expect(parseToolText(result)).not.toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(createPage).toHaveBeenCalledTimes(1);
      } finally {
        await close();
      }
    });

    it("FU-7: file:// inside a fenced code block does not fire the gate", async () => {
      const { client, close } = await createConnectedClient({
        transport: "http",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "```md\n[x](file:///tmp/x.png)\n```",
          },
        });

        expect(parseToolText(result)).not.toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(createPage).toHaveBeenCalledTimes(1);
      } finally {
        await close();
      }
    });

    it("FU-11: plain-text file:// outside markdown link syntax does not fire the gate", async () => {
      const { client, close } = await createConnectedClient({
        transport: "http",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "# Heading\n\nfile:///tmp/x.png is not a link",
          },
        });

        expect(parseToolText(result)).not.toMatch(GATE_PHRASE);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(createPage).toHaveBeenCalledTimes(1);
      } finally {
        await close();
      }
    });
  });

  describe("stdio transport regression guards (file:// gate does NOT apply)", () => {
    it("FU-8: stdio create_page with [x](file://...) still attempts upload", async () => {
      vi.mocked(uploadFile).mockResolvedValue({ id: "upload-1", blockType: "image" } as any);
      const { client, close } = await createConnectedClient({
        transport: "stdio",
        rootPageId: "root-123",
      });
      try {
        const result = await client.callTool({
          name: "create_page",
          arguments: {
            title: "Test",
            markdown: "![x](file:///tmp/x.png)",
          },
        });

        expect(parseToolText(result)).not.toMatch(GATE_PHRASE);
        expect(uploadFile).toHaveBeenCalledTimes(1);
        expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "file:///tmp/x.png");
      } finally {
        await close();
      }
    });

    it("FU-9: stdio update_page with cover: file://... still attempts upload", async () => {
      vi.mocked(uploadFile).mockResolvedValue({ id: "upload-cover", blockType: "image" } as any);
      const { client, close } = await createConnectedClient({ transport: "stdio" });
      try {
        const result = await client.callTool({
          name: "update_page",
          arguments: {
            page_id: "page-123",
            cover: "file:///tmp/cover.png",
          },
        });

        expect(parseToolText(result)).not.toMatch(GATE_PHRASE);
        expect(uploadFile).toHaveBeenCalledTimes(1);
        expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "file:///tmp/cover.png");
      } finally {
        await close();
      }
    });
  });

  describe("tool-description accuracy (§ 3.5)", () => {
    it("FU-12: create_page description advertises the stdio-only caveat for file://", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.listTools();
        const tool = result.tools.find((t) => t.name === "create_page");
        expect(tool).toBeDefined();
        expect(tool!.description).toMatch(/file:\/\//);
        expect(tool!.description).toMatch(/stdio/i);
      } finally {
        await close();
      }
    });

    it("FU-13: update_page description advertises the stdio-only caveat for file:// cover", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });
      try {
        const result = await client.listTools();
        const tool = result.tools.find((t) => t.name === "update_page");
        expect(tool).toBeDefined();
        expect(tool!.description).toMatch(/file:\/\//);
        expect(tool!.description).toMatch(/stdio/i);
      } finally {
        await close();
      }
    });
  });
});

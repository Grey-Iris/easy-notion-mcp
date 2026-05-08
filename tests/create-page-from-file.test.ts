import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadMarkdownFile } = vi.hoisted(() => ({
  mockReadMarkdownFile: vi.fn(),
}));

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

vi.mock("../src/read-markdown-file.js", () => ({
  readMarkdownFile: mockReadMarkdownFile,
}));

import { createPage, findWorkspacePages } from "../src/notion-client.js";
import { readMarkdownFile } from "../src/read-markdown-file.ts";
import { createServer, type CreateServerConfig } from "../src/server.js";

type TestServerConfig = CreateServerConfig & {
  transport?: "stdio" | "http";
  workspaceRoot?: string;
};

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Expected text content in tool result");
  }
  return text;
}

function parseToolResult(result: { content?: Array<{ type: string; text?: string }> }) {
  return JSON.parse(parseToolText(result)) as Record<string, unknown>;
}

async function createConnectedClient(config: TestServerConfig = {}) {
  const notion = {};
  const server = createServer(() => notion as any, config as CreateServerConfig);
  const client = new McpClient(
    { name: "create-page-from-file-test", version: "1.0.0" },
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

const tempDirs: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("create_page_from_file", () => {
  beforeEach(() => {
    vi.mocked(createPage).mockResolvedValue({
      id: "new-page-id",
      url: "https://notion.so/new-page",
    } as any);
    vi.mocked(findWorkspacePages).mockResolvedValue([]);
    mockReadMarkdownFile.mockReset();
    mockReadMarkdownFile.mockResolvedValue("# Placeholder");
  });

  afterEach(async () => {
    vi.clearAllMocks();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  describe("readMarkdownFile", () => {
    let realReadMarkdownFile: typeof readMarkdownFile;

    beforeEach(async () => {
      const actual = await vi.importActual<typeof import("../src/read-markdown-file.js")>(
        "../src/read-markdown-file.js",
      );
      realReadMarkdownFile = actual.readMarkdownFile;
    });

    it("reads a valid .md file inside the allowed root", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, "note.md");

      await writeFile(filePath, "# Hello\nWorld");

      await expect(realReadMarkdownFile(filePath, rootDir)).resolves.toBe("# Hello\nWorld");
    });

    it("rejects relative paths", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");

      await expect(realReadMarkdownFile("./foo.md", rootDir)).rejects.toThrow(/absolute path/i);
    });

    it("rejects paths outside the allowed root", async () => {
      const allowedRoot = await makeTempDir("read-markdown-file-allowed-");
      const otherRoot = await makeTempDir("read-markdown-file-other-");
      const filePath = join(otherRoot, "outside.md");

      await writeFile(filePath, "# Outside");

      await expect(realReadMarkdownFile(filePath, allowedRoot)).rejects.toThrow(/allowed root|outside/i);
    });

    it("rejects non-existent files with a clean error", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, "missing.md");

      await expect(realReadMarkdownFile(filePath, rootDir)).rejects.toThrow(/file not found/i);
    });

    it("rejects files larger than 1,048,576 bytes", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, "too-large.md");

      await writeFile(filePath, Buffer.alloc(1_048_577, 0x61));

      await expect(realReadMarkdownFile(filePath, rootDir)).rejects.toThrow(/1048576-byte cap|exceeds/i);
    });

    it("accepts files up to 1,048,576 bytes", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, "max-size.md");

      await writeFile(filePath, Buffer.alloc(1_048_576, 0x61));

      await expect(realReadMarkdownFile(filePath, rootDir)).resolves.toBe("a".repeat(1_048_576));
    });

    it("rejects binary files that are not valid UTF-8", async () => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, "binary.md");

      await writeFile(filePath, Buffer.from([0xFF, 0xFE, 0x00]));

      await expect(realReadMarkdownFile(filePath, rootDir)).rejects.toThrow(/not valid UTF-8/i);
    });

    it("rejects symlinks that escape the allowed root", async () => {
      const allowedRoot = await makeTempDir("read-markdown-file-allowed-");
      const escapedRoot = await makeTempDir("read-markdown-file-escaped-");
      const escapedFile = join(escapedRoot, "escaped.md");
      const symlinkPath = join(allowedRoot, "link.md");

      await writeFile(escapedFile, "# Escaped");
      await symlink(escapedFile, symlinkPath);

      await expect(realReadMarkdownFile(symlinkPath, allowedRoot)).rejects.toThrow(/allowed root|outside/i);
    });

    it.each([
      "notes.txt",
      "data.json",
      "README",
    ])("rejects disallowed extension %s", async (filename) => {
      const rootDir = await makeTempDir("read-markdown-file-root-");
      const filePath = join(rootDir, filename);

      await writeFile(filePath, "content");

      await expect(realReadMarkdownFile(filePath, rootDir)).rejects.toThrow(/extension|\.md/i);
    });

    it("uses separator-aware containment instead of naive prefix matching", async () => {
      const parentDir = await makeTempDir("read-markdown-file-parent-");
      const allowedRoot = join(parentDir, "root");
      const siblingRoot = join(parentDir, "rootbar");
      const filePath = join(siblingRoot, "file.md");

      await mkdir(allowedRoot);
      await mkdir(siblingRoot);
      await writeFile(filePath, "# Wrong root");

      await expect(realReadMarkdownFile(filePath, allowedRoot)).rejects.toThrow(/allowed root|outside/i);
    });
  });

  describe("transport filtering", () => {
    it("lists create_page_from_file in stdio mode", async () => {
      const { client, close } = await createConnectedClient({
        transport: "stdio",
        workspaceRoot: "/tmp",
      });

      try {
        const result = await client.listTools();
        const toolNames = result.tools.map((tool) => tool.name);

        expect(toolNames).toContain("create_page_from_file");
        expect(result.tools).toHaveLength(35);
      } finally {
        await close();
      }
    });

    it("does not list create_page_from_file in http mode", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });

      try {
        const result = await client.listTools();
        const toolNames = result.tools.map((tool) => tool.name);

        expect(toolNames).not.toContain("create_page_from_file");
        expect(result.tools).toHaveLength(34);
      } finally {
        await close();
      }
    });

    it("keeps http tools equal to stdio tools minus create_page_from_file", async () => {
      const stdioConnection = await createConnectedClient({
        transport: "stdio",
        workspaceRoot: "/tmp",
      });
      const httpConnection = await createConnectedClient({ transport: "http" });

      try {
        const stdioTools = await stdioConnection.client.listTools();
        const httpTools = await httpConnection.client.listTools();
        const stdioToolNames = new Set(stdioTools.tools.map((tool) => tool.name));
        const httpToolNames = new Set(httpTools.tools.map((tool) => tool.name));

        stdioToolNames.delete("create_page_from_file");

        expect(httpToolNames).toEqual(stdioToolNames);
        expect(stdioTools.tools).toHaveLength(httpTools.tools.length + 1);

        for (const sharedTool of ["create_page", "read_page", "search", "update_data_source"]) {
          expect(httpToolNames).toContain(sharedTool);
          expect(new Set(stdioTools.tools.map((tool) => tool.name))).toContain(sharedTool);
        }
      } finally {
        await Promise.all([
          stdioConnection.close(),
          httpConnection.close(),
        ]);
      }
    });

    it("defaults to stdio transport when transport is omitted", async () => {
      const { client, close } = await createConnectedClient({ workspaceRoot: "/tmp" });

      try {
        const result = await client.listTools();
        const toolNames = result.tools.map((tool) => tool.name);

        expect(toolNames).toContain("create_page_from_file");
      } finally {
        await close();
      }
    });

    it("returns a transport-specific error when called in http mode", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });

      try {
        const result = await client.callTool({
          name: "create_page_from_file",
          arguments: {
            title: "From file",
            file_path: "/tmp/note.md",
            parent_page_id: "parent-123",
          },
        });

        expect(parseToolText(result)).toContain("not available in 'http' transport mode");
        expect(createPage).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("does not leak transports metadata in listTools responses", async () => {
      const { client, close } = await createConnectedClient({
        transport: "stdio",
        workspaceRoot: "/tmp",
      });

      try {
        const result = await client.listTools();

        for (const tool of result.tools) {
          expect(Object.keys(tool).sort()).toEqual(["description", "inputSchema", "name"]);
          expect(tool).not.toHaveProperty("transports");
        }
      } finally {
        await close();
      }
    });

    it("preserves create_database.is_inline in the listed schema", async () => {
      const { client, close } = await createConnectedClient({ transport: "http" });

      try {
        const result = await client.listTools();
        const createDatabaseTool = result.tools.find((tool) => tool.name === "create_database");

        expect(createDatabaseTool).toBeDefined();
        expect(createDatabaseTool?.inputSchema).toMatchObject({
          properties: {
            is_inline: expect.any(Object),
          },
        });
      } finally {
        await close();
      }
    });
  });

  describe("create_page_from_file handler", () => {
    it("creates a page from markdown read from a local file", async () => {
      mockReadMarkdownFile.mockResolvedValue("# Hello\nWorld");
      vi.mocked(createPage).mockResolvedValue({
        id: "page-123",
        url: "https://notion.so/page",
      } as any);

      const { client, close } = await createConnectedClient({
        transport: "stdio",
        workspaceRoot: "/tmp",
      });

      try {
        const result = await client.callTool({
          name: "create_page_from_file",
          arguments: {
            title: "Imported from file",
            file_path: "/tmp/import.md",
            parent_page_id: "parent-123",
          },
        });

        expect(mockReadMarkdownFile).toHaveBeenCalledWith("/tmp/import.md", "/tmp");
        expect(createPage).toHaveBeenCalledWith(
          expect.anything(),
          { type: "page_id", page_id: "parent-123" },
          "Imported from file",
          expect.any(Array),
        );

        const response = parseToolResult(result);
        expect(response.id).toBe("page-123");
        expect(response.url).toBe("https://notion.so/page");
      } finally {
        await close();
      }
    });

    it("returns an error when workspaceRoot is not configured", async () => {
      const { client, close } = await createConnectedClient({ transport: "stdio" });

      try {
        const result = await client.callTool({
          name: "create_page_from_file",
          arguments: {
            title: "Imported from file",
            file_path: "/tmp/import.md",
            parent_page_id: "parent-123",
          },
        });

        expect(parseToolText(result)).toContain("workspaceRoot");
      } finally {
        await close();
      }
    });

    it("propagates readMarkdownFile errors to the tool response", async () => {
      mockReadMarkdownFile.mockRejectedValue(new Error("file not found"));

      const { client, close } = await createConnectedClient({
        transport: "stdio",
        workspaceRoot: "/tmp",
      });

      try {
        const result = await client.callTool({
          name: "create_page_from_file",
          arguments: {
            title: "Imported from file",
            file_path: "/tmp/missing.md",
            parent_page_id: "parent-123",
          },
        });

        expect(parseToolText(result)).toContain("file not found");
      } finally {
        await close();
      }
    });
  });
});

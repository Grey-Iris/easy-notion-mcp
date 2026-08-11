import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  };
});

vi.mock("../src/read-markdown-file.js", () => ({
  readMarkdownFile: mockReadMarkdownFile,
}));

import { runCli } from "../src/cli/run.js";
import { saveProfileConfig } from "../src/cli/profile-config.js";
import { createPage } from "../src/notion-client.js";
import { createServer, type CreateServerConfig } from "../src/server.js";

// The two creation tools this feature is scoped to, and nothing else.
const EXPECTED_MCP_TOOLS = ["create_page", "create_page_from_file"];
const EXPECTED_CLI_COMMANDS = ["page create", "page create-from-file"];

// create_page's tool description is pinned byte for byte. The brief forbids
// growing it, and a fixed string is the direct proof that this change left it
// alone: the parameter documentation lives on the schema instead.
const CREATE_PAGE_DESCRIPTION =
  "Create a Notion page from markdown as native Notion blocks. Server handles 100-block batching, 2000-char splitting, and deep nesting, so no pre-chunking. Supports stdio-only file:// uploads. Syntax: easy-notion://docs/markdown. Mentions: @[Title](notion-url). Returns { id, title, url, success: true }, note for workspace-parent pages, plus block_map for top-level created blocks when present.";

const MARKDOWN = "# Title\n\nbody";

// The exact converted body, with and without the leading H1.
const BLOCKS_WITH_H1 = [
  { type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "Title" } }] } },
  { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "body" } }] } },
];
const BLOCKS_WITHOUT_H1 = [
  { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "body" } }] } },
];

type TestServerConfig = CreateServerConfig & {
  transport?: "stdio" | "http";
  workspaceRoot?: string;
};

async function withClient<T>(
  fn: (client: McpClient) => Promise<T>,
  config: TestServerConfig = { transport: "stdio", workspaceRoot: "/tmp" },
) {
  const notion = {
    blocks: {
      children: {
        list: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
      },
    },
  };
  const server = createServer(() => notion as any, config as CreateServerConfig);
  const client = new McpClient({ name: "strip-leading-h1-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

describe("strip_leading_h1 parameter surface", () => {
  it("is offered by exactly the two title-bearing creation tools and no others", async () => {
    const result = await withClient((client) => client.listTools());

    // Guard against a vacuously empty listing.
    expect(result.tools.length).toBeGreaterThan(20);

    const carrying = result.tools
      .filter((tool) => "strip_leading_h1" in ((tool.inputSchema as any)?.properties ?? {}))
      .map((tool) => tool.name);

    expect(new Set(carrying)).toEqual(new Set(EXPECTED_MCP_TOOLS));
    expect(carrying).toHaveLength(EXPECTED_MCP_TOOLS.length);
  });

  it("declares the option as an optional boolean on both tools", async () => {
    const result = await withClient((client) => client.listTools());

    for (const name of EXPECTED_MCP_TOOLS) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      const schema = tool?.inputSchema as any;
      expect(schema.properties.strip_leading_h1.type).toBe("boolean");
      expect(schema.required ?? []).not.toContain("strip_leading_h1");
    }
  });

  it("documents the unconditional first-block semantics on the parameter schema", async () => {
    const result = await withClient((client) => client.listTools());

    for (const name of EXPECTED_MCP_TOOLS) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      const description = (tool?.inputSchema as any).properties.strip_leading_h1.description;

      expect(description).toContain("first converted top-level block");
      expect(description).toContain("non-toggleable");
      expect(description).toContain("heading_1");
      expect(description).toContain("Default false");
      expect(description).not.toContain("—");
    }
  });

  it("leaves create_page's tool description byte for byte unchanged", async () => {
    const result = await withClient((client) => client.listTools());
    const createPageTool = result.tools.find((candidate) => candidate.name === "create_page");

    expect(createPageTool?.description).toBe(CREATE_PAGE_DESCRIPTION);
    expect(createPageTool?.description?.length).toBeLessThan(400);

    for (const tool of result.tools) {
      expect(tool.description ?? "", `${tool.name} inlined the option`).not.toContain(
        "strip_leading_h1",
      );
    }
  });
});

describe("create_page handler", () => {
  beforeEach(() => {
    vi.mocked(createPage).mockReset();
    vi.mocked(createPage).mockResolvedValue({
      id: "page-123",
      url: "https://notion.so/page",
    } as any);
  });

  async function callCreatePage(args: Record<string, unknown>) {
    await withClient((client) =>
      client.callTool({
        name: "create_page",
        arguments: { title: "Doc", markdown: MARKDOWN, parent_page_id: "parent-123", ...args },
      }),
    );
  }

  function expectExactlyOneCallWith(blocks: unknown) {
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPage).mock.calls[0].slice(1)).toEqual([
      { type: "page_id", page_id: "parent-123" },
      "Doc",
      blocks,
      undefined,
      undefined,
    ]);
  }

  it("sends the H1 through when strip_leading_h1 is absent", async () => {
    await callCreatePage({});
    expectExactlyOneCallWith(BLOCKS_WITH_H1);
  });

  it("sends the H1 through when strip_leading_h1 is explicitly false", async () => {
    await callCreatePage({ strip_leading_h1: false });
    expectExactlyOneCallWith(BLOCKS_WITH_H1);
  });

  it("removes the H1 when strip_leading_h1 is true", async () => {
    await callCreatePage({ strip_leading_h1: true });
    expectExactlyOneCallWith(BLOCKS_WITHOUT_H1);
  });
});

describe("create_page_from_file handler", () => {
  beforeEach(() => {
    vi.mocked(createPage).mockReset();
    vi.mocked(createPage).mockResolvedValue({
      id: "page-123",
      url: "https://notion.so/page",
    } as any);
    mockReadMarkdownFile.mockReset();
    mockReadMarkdownFile.mockResolvedValue(MARKDOWN);
  });

  async function callCreateFromFile(args: Record<string, unknown>) {
    await withClient((client) =>
      client.callTool({
        name: "create_page_from_file",
        arguments: {
          title: "Doc",
          file_path: "/tmp/import.md",
          parent_page_id: "parent-123",
          ...args,
        },
      }),
    );
  }

  function expectExactlyOneCallWith(blocks: unknown) {
    expect(createPage).toHaveBeenCalledTimes(1);
    // This handler calls createPage with exactly four arguments: no icon, no
    // cover. Pinning the whole call keeps that shape from drifting.
    expect(vi.mocked(createPage).mock.calls[0].slice(1)).toEqual([
      { type: "page_id", page_id: "parent-123" },
      "Doc",
      blocks,
    ]);
  }

  it("sends the H1 through when strip_leading_h1 is absent", async () => {
    await callCreateFromFile({});
    expectExactlyOneCallWith(BLOCKS_WITH_H1);
  });

  it("sends the H1 through when strip_leading_h1 is explicitly false", async () => {
    await callCreateFromFile({ strip_leading_h1: false });
    expectExactlyOneCallWith(BLOCKS_WITH_H1);
  });

  it("removes the H1 when strip_leading_h1 is true", async () => {
    await callCreateFromFile({ strip_leading_h1: true });
    expectExactlyOneCallWith(BLOCKS_WITHOUT_H1);
  });
});

describe("--strip-leading-h1 CLI flag", () => {
  async function runCreate(argv: string[]) {
    const configDir = await mkdtemp(join(tmpdir(), "easy-notion-strip-h1-"));
    await saveProfileConfig(configDir, {
      default: "rw",
      profiles: { rw: { token_env: "WORK_TOKEN", mode: "readwrite" } },
    });

    const createPageOp = vi.fn(async () => ({ id: "page-1", url: "https://notion.so/page-1" }));
    const ops = {
      createClient: vi.fn(() => ({}) as any),
      processFileUploads: vi.fn(async (_client: unknown, markdown: string) => markdown),
      createPage: createPageOp,
    };

    const io = {
      env: { WORK_TOKEN: "secret-token-value" },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: Readable.from([]) as NodeJS.ReadStream,
      cwd: process.cwd(),
    };

    const code = await runCli(argv, io as any, { configDir, ops: ops as any });
    expect(code).toBe(0);
    return createPageOp;
  }

  describe("page create", () => {
    const base = ["page", "create", "--title", "Doc", "--parent", "parent-123", "--markdown", MARKDOWN];

    function expectExactlyOneCallWith(op: ReturnType<typeof vi.fn>, blocks: unknown) {
      expect(op).toHaveBeenCalledTimes(1);
      expect(op.mock.calls[0].slice(1)).toEqual([
        { type: "page_id", page_id: "parent-123" },
        "Doc",
        blocks,
        undefined,
        undefined,
      ]);
    }

    it("sends the H1 through when the flag is absent", async () => {
      expectExactlyOneCallWith(await runCreate(base), BLOCKS_WITH_H1);
    });

    it("removes the H1 when the flag is present", async () => {
      expectExactlyOneCallWith(await runCreate([...base, "--strip-leading-h1"]), BLOCKS_WITHOUT_H1);
    });
  });

  describe("page create-from-file", () => {
    let markdownFile: string;

    beforeEach(async () => {
      const dir = await mkdtemp(join(tmpdir(), "easy-notion-strip-h1-src-"));
      markdownFile = join(dir, "doc.md");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(markdownFile, MARKDOWN, "utf8");
    });

    function expectExactlyOneCallWith(op: ReturnType<typeof vi.fn>, blocks: unknown) {
      expect(op).toHaveBeenCalledTimes(1);
      expect(op.mock.calls[0].slice(1)).toEqual([
        { type: "page_id", page_id: "parent-123" },
        "Doc",
        blocks,
      ]);
    }

    it("sends the H1 through when the flag is absent", async () => {
      const op = await runCreate([
        "page", "create-from-file", "--title", "Doc", "--parent", "parent-123", "--file", markdownFile,
      ]);
      expectExactlyOneCallWith(op, BLOCKS_WITH_H1);
    });

    it("removes the H1 when the flag is present", async () => {
      const op = await runCreate([
        "page", "create-from-file", "--title", "Doc", "--parent", "parent-123", "--file", markdownFile,
        "--strip-leading-h1",
      ]);
      expectExactlyOneCallWith(op, BLOCKS_WITHOUT_H1);
    });
  });

  it("advertises the flag on exactly the two creation commands", async () => {
    let stdout = "";
    const io = {
      env: {},
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: () => {} },
      stdin: Readable.from([]) as NodeJS.ReadStream,
      cwd: process.cwd(),
    };

    await runCli(["--help"], io as any, {
      configDir: await mkdtemp(join(tmpdir(), "easy-notion-strip-h1-help-")),
    });

    // The CLI emits help inside a JSON envelope, so the whole usage block
    // arrives as one physical stdout line. Parse it before splitting, or a
    // per-command assertion degrades into "the flag appears somewhere".
    const help = (JSON.parse(stdout) as { result: { help: string } }).result.help;
    const usageLines = help.split("\n").map((line) => line.trim());

    expect(usageLines.filter((line) => line.startsWith("page create")).length).toBe(2);

    const advertising = usageLines.filter((line) => line.includes("--strip-leading-h1"));

    expect(advertising).toHaveLength(EXPECTED_CLI_COMMANDS.length);
    for (const command of EXPECTED_CLI_COMMANDS) {
      expect(
        advertising.filter((line) => line.startsWith(`${command} `)),
        `${command} does not advertise the flag exactly once`,
      ).toHaveLength(1);
    }
  });
});

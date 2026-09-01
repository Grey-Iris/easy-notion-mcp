import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli/run.js";
import { saveProfileConfig } from "../src/cli/profile-config.js";
import { createServer } from "../src/server.js";
import { appendResponseFixture } from "./helpers/append-response-fixture.js";

async function withClient<T>(fn: (client: McpClient) => Promise<T>) {
  const server = createServer(() => ({}) as any, {});
  const client = new McpClient({ name: "surface-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

// Every markdown-writing surface. find_replace, update_page, and the database
// entry tools are excluded on purpose: their values bypass these converters.
const MARKDOWN_WRITING_TOOLS = [
  "create_page",
  "create_page_from_file",
  "append_content",
  "replace_content",
  "update_section",
  "update_toggle",
  "update_block",
  "add_comment",
];

const NOT_IN_SCOPE = ["find_replace", "update_page", "add_database_entry", "update_database_entry"];

describe("collapse_soft_wraps parameter surface", () => {
  it("is offered by every markdown-writing tool", async () => {
    const result = await withClient((client) => client.listTools());

    for (const name of MARKDOWN_WRITING_TOOLS) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      const properties = (tool?.inputSchema as any)?.properties ?? {};
      expect(properties.collapse_soft_wraps, `${name} is missing the option`).toBeDefined();
      expect(properties.collapse_soft_wraps.type).toBe("boolean");
    }
  });

  it("is absent from tools whose content bypasses the converters", async () => {
    const result = await withClient((client) => client.listTools());

    for (const name of NOT_IN_SCOPE) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      const properties = (tool?.inputSchema as any)?.properties ?? {};
      expect(properties.collapse_soft_wraps, `${name} should not offer the option`).toBeUndefined();
    }
  });

  it("is never required, so the default cannot move", async () => {
    const result = await withClient((client) => client.listTools());

    for (const name of MARKDOWN_WRITING_TOOLS) {
      const tool = result.tools.find((candidate) => candidate.name === name);
      expect((tool?.inputSchema as any)?.required ?? []).not.toContain("collapse_soft_wraps");
    }
  });

  it("describes the default, the use case, and the replace_content caveat", async () => {
    const result = await withClient((client) => client.listTools());
    const tool = result.tools.find((candidate) => candidate.name === "create_page");
    const description = (tool?.inputSchema as any).properties.collapse_soft_wraps.description;

    expect(description).toContain("Default false");
    expect(description).toContain("CommonMark");
    expect(description).toContain("hard-wrapped");
    // The documented limitation must travel with the parameter, not just the docs.
    expect(description).toContain("replace_content renders an in-paragraph line break");
    expect(description).not.toContain("—");
  });

  it("gives add_comment its own wording, without the code-block clause", async () => {
    const result = await withClient((client) => client.listTools());
    const comment = result.tools.find((candidate) => candidate.name === "add_comment");
    const description = (comment?.inputSchema as any).properties.collapse_soft_wraps.description;

    // add_comment runs the inline lexer only, so it has no fenced code blocks.
    expect(description).toContain("Default false");
    expect(description).not.toContain("code blocks");
    expect(description).not.toContain("replace_content");
  });

  it("keeps the option out of the tool descriptions themselves", async () => {
    const result = await withClient((client) => client.listTools());

    // create_page sits at 398 against a pinned 400-char cap, so the full text
    // lives on the parameter schema. No tool description may carry it.
    const createPage = result.tools.find((candidate) => candidate.name === "create_page");
    expect(createPage?.description?.length ?? 0).toBeLessThan(400);

    for (const tool of result.tools) {
      expect(tool.description ?? "", `${tool.name} inlined the option`).not.toContain(
        "collapse_soft_wraps",
      );
    }
  });
});

describe("--collapse-soft-wraps CLI flag", () => {
  async function runAppend(argv: string[]) {
    const configDir = await mkdtemp(join(tmpdir(), "easy-notion-collapse-"));
    await saveProfileConfig(configDir, {
      default: "rw",
      profiles: { rw: { token_env: "WORK_TOKEN", mode: "readwrite" } },
    });

    const appendBlocks = vi.fn(async () => [{ id: "block-1" }]);
    const ops = {
      createClient: vi.fn(() => ({}) as any),
      processFileUploads: vi.fn(async (_client: unknown, markdown: string) => markdown),
      appendBlocks,
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
    return appendBlocks.mock.calls[0][2] as any[];
  }

  const WRAPPED = "content append line one\nline two";

  it("collapses the wrap when the flag is present", async () => {
    const blocks = await runAppend(["content", "append", "page-1", "--markdown", WRAPPED, "--collapse-soft-wraps"]);

    expect(blocks[0].paragraph.rich_text[0].text.content).toBe("content append line one line two");
  });

  it("leaves the wrap alone when the flag is absent", async () => {
    const blocks = await runAppend(["content", "append", "page-1", "--markdown", WRAPPED]);

    expect(blocks[0].paragraph.rich_text[0].text.content).toBe(WRAPPED);
  });

  it("is advertised in the CLI usage text", async () => {
    let stdout = "";
    const io = {
      env: {},
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: () => {} },
      stdin: Readable.from([]) as NodeJS.ReadStream,
      cwd: process.cwd(),
    };

    await runCli(["--help"], io as any, { configDir: await mkdtemp(join(tmpdir(), "easy-notion-help-")) });

    for (const command of ["page create ", "page create-from-file", "content append", "comment add"]) {
      const line = stdout.split("\n").find((candidate) => candidate.includes(command));
      expect(line, `${command} usage line missing`).toBeDefined();
      expect(line, `${command} does not advertise the flag`).toContain("--collapse-soft-wraps");
    }
  });

  it("test 8 reports only created rows through the real positioned CLI append seam", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "easy-notion-append-receipt-"));
    await saveProfileConfig(configDir, {
      default: "rw",
      profiles: { rw: { token_env: "WORK_TOKEN", mode: "readwrite" } },
    });
    const pageRows = [
      {
        id: "intro",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Intro", text: { content: "Intro" } }] },
      },
      {
        id: "h2-target",
        type: "heading_2",
        heading_2: { rich_text: [{ plain_text: "Target", text: { content: "Target" } }] },
      },
      {
        id: "old-body",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Old body", text: { content: "Old body" } }] },
      },
      {
        id: "h2-next",
        type: "heading_2",
        heading_2: { rich_text: [{ plain_text: "Next", text: { content: "Next" } }] },
      },
    ];
    const trailingRows = [
      {
        id: "t8-trail-1",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Trailing one", text: { content: "Trailing one" } }] },
      },
      {
        id: "t8-trail-2",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Trailing two", text: { content: "Trailing two" } }] },
      },
    ];
    const fixedCreatedRows = [{
      id: "t8-created-1",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: "Replacement body" } }] },
    }];
    const fixedLowLevelResponse = {
      results: [...fixedCreatedRows, ...trailingRows],
      has_more: false,
      next_cursor: null,
    };
    const list = vi.fn(async () => ({
      results: pageRows,
      has_more: false,
      next_cursor: null,
    }));
    const deleteBlock = vi.fn(async ({ block_id }: any) => ({ id: block_id }));
    const observedResponses: unknown[] = [];
    const append = vi.fn(async (args: any) => {
      const response = appendResponseFixture({
        mode: "realistic-capped",
        children: args.children,
        createdIds: ["t8-created-1"],
        trailingRows,
      });
      observedResponses.push(response);
      return response;
    });
    const lowLevelClient = {
      blocks: {
        delete: deleteBlock,
        children: { list, append },
      },
    };
    const createClient = vi.fn(() => lowLevelClient as any);
    let stdout = "";
    const io = {
      env: { WORK_TOKEN: "secret-token-value" },
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: () => {} },
      stdin: Readable.from([]) as NodeJS.ReadStream,
      cwd: process.cwd(),
    };

    const code = await runCli(
      [
        "content",
        "update-section",
        "page-1",
        "--heading",
        "Target",
        "--markdown",
        "Replacement body",
      ],
      io as any,
      { configDir, ops: { createClient } as any },
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      result: { deleted: 2, appended: 1 },
    });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("secret-token-value");
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      block_id: "page-1",
      start_cursor: undefined,
      page_size: 100,
    });
    expect(deleteBlock).toHaveBeenCalledTimes(2);
    expect(deleteBlock).toHaveBeenNthCalledWith(1, { block_id: "h2-target" });
    expect(deleteBlock).toHaveBeenNthCalledWith(2, { block_id: "old-body" });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      block_id: "page-1",
      children: [{
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "Replacement body" } }] },
      }],
      position: { type: "after_block", after_block: { id: "intro" } },
    });
    expect(observedResponses).toEqual([fixedLowLevelResponse]);
  });
});

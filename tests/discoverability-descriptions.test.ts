import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

async function listTools() {
  const server = createServer(() => ({}) as any, {});
  const client = new McpClient(
    { name: "description-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await client.listTools();
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

const markdownPipelineTools = [
  "create_page",
  "create_page_from_file",
  "append_content",
  "update_toggle",
];

async function toolDescription(name: string) {
  const { tools } = await listTools();
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!.description ?? "";
}

describe("Tool-description discoverability (Phase 1)", () => {
  it.each(markdownPipelineTools)(
    "%s description says markdown becomes native Notion blocks",
    async (toolName) => {
      const description = await toolDescription(toolName);
      expect(description).toMatch(/native Notion block/i);
    },
  );

  it.each(markdownPipelineTools)(
    "%s description says server-side limit handling means callers do not pre-chunk",
    async (toolName) => {
      const description = await toolDescription(toolName);
      expect(description).toMatch(
        /(automatic|server).{0,40}(chunk|split|batch|limit)|no need to (pre-)?(chunk|split)/i,
      );
    },
  );

  it("create_page description documents the current return receipt", async () => {
    const description = await toolDescription("create_page");
    expect(description).toMatch(/\bid\b/);
    expect(description).toMatch(/\btitle\b/);
    expect(description).toMatch(/\burl\b/);
    expect(description).toMatch(/success\s*:\s*true/i);
    expect(description).toMatch(/\bnote\b/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
    // The receipt is a shipped 1.x guarantee, so the description must not claim
    // the response omits per-block IDs.
    expect(description).not.toMatch(/no block count|no per-block ID/i);
  });

  it("create_page_from_file description documents the current return receipt", async () => {
    const description = await toolDescription("create_page_from_file");
    expect(description).toMatch(/\bid\b/);
    expect(description).toMatch(/\btitle\b/);
    expect(description).toMatch(/\burl\b/);
    expect(description).toMatch(/success\s*:\s*true/i);
    expect(description).toMatch(/\bnote\b/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
    expect(description).not.toMatch(/no block count|no per-block ID/i);
  });

  it("append_content description documents the current return receipt", async () => {
    const description = await toolDescription("append_content");
    expect(description).toMatch(/success\s*:\s*true/i);
    expect(description).toMatch(/blocks_added/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
    expect(description).toMatch(/warnings/);
  });

  it("update_toggle description documents the current return receipt", async () => {
    const description = await toolDescription("update_toggle");
    expect(description).toMatch(/success\s*:\s*true/i);
    expect(description).toMatch(/block_id/);
    expect(description).toMatch(/\btype\b/);
    expect(description).toMatch(/deleted/);
    expect(description).toMatch(/appended/);
    expect(description).toMatch(/deleted_blocks/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
  });

  it("update_section description documents the current return receipt", async () => {
    const description = await toolDescription("update_section");
    expect(description).toMatch(/deleted/);
    expect(description).toMatch(/appended/);
    expect(description).toMatch(/deleted_blocks/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
  });

  it("replace_content description says atomic markdown produces native Notion blocks and documents the current return receipt", async () => {
    const description = await toolDescription("replace_content");
    expect(description).toMatch(/native Notion block/i);
    expect(description).toMatch(/success\s*:\s*true/i);
    expect(description).toMatch(/truncated/);
    expect(description).toMatch(/warnings/);
    expect(description).toMatch(/unmatched_blocks/);
    expect(description).toMatch(/block_map/);
    expect(description).toMatch(/top-level/i);
  });

  const mentionCapableWriteTools = [
    "create_page",
    "create_page_from_file",
    "append_content",
    "replace_content",
    "update_section",
    "update_block",
    "update_toggle",
    "add_comment",
  ];

  it.each(mentionCapableWriteTools)(
    "%s description surfaces the page-mention syntax",
    async (toolName) => {
      const description = await toolDescription(toolName);
      expect(description).toContain("@[Title](notion-url)");
    },
  );

  it("add_comment description states that comments do not downgrade unresolvable mentions", async () => {
    const description = await toolDescription("add_comment");
    expect(description).toMatch(/not downgraded/i);
    expect(description).toMatch(/append_content/);
  });
});

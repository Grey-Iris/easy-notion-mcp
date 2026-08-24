import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer, type ServerTransport } from "../src/server.js";

const RETURN_BLOCK_MAP_DESCRIPTION =
  "Include block_map in the response. Default true. Set false to skip the per-block id list when you do not plan to edit individual blocks.";

const CREATE_PAGE_DESCRIPTION =
  "Create a Notion page from markdown as native Notion blocks. Server handles 100-block batching, 2000-char splitting, and deep nesting, so no pre-chunking. Supports stdio-only file:// uploads. Syntax: easy-notion://docs/markdown. Mentions: @[Title](notion-url). Returns { id, title, url, success: true }, note for workspace-parent pages, plus block_map for top-level created blocks when present.";


// Every carrying tool's description is pinned independently (sha256 of the
// exact base bytes plus length), so a one-byte edit to any of the six fails
// here, not only an edit to create_page.
const DESCRIPTION_PINS: Record<string, { sha256: string; length: number }> = {
  create_page: { sha256: "7bb89971a39d440395c22074d8adf66043f38200f07ceb033fd028b896510a8b", length: 393 },
  create_page_from_file: { sha256: "127f8c7932acfbc0d3ea4213f13be640d9c4fb9cb0613b5c61d6bfdca7d79fa6", length: 1269 },
  append_content: { sha256: "948153ea9a979397308897f566ca1e26c0fff08d9ce2878f0cd01005d55c54c0", length: 802 },
  replace_content: { sha256: "66f96421253c3c8112f744cdf0a89c614488de2c40ea2c69378b931bfb377274", length: 1569 },
  update_section: { sha256: "9201f0fff2f5c6e3b43be0facebb5e3080860cf2593988eb13231afd1680edbc", length: 1790 },
  update_toggle: { sha256: "c476672a3dda834d629b97feb8214c494d9aedef3f9942bae0c88b2f224fcf1b", length: 1689 },
};

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const STDIO_TOOLS = [
  "create_page",
  "create_page_from_file",
  "append_content",
  "replace_content",
  "update_section",
  "update_toggle",
];

const HTTP_TOOLS = [
  "create_page",
  "append_content",
  "replace_content",
  "update_section",
  "update_toggle",
];

async function listTools(transport: ServerTransport) {
  const server = createServer(() => ({}) as any, { transport, workspaceRoot: "/tmp" });
  const client = new McpClient(
    { name: `return-block-map-${transport}-surface`, version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    return (await client.listTools()).tools;
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

function carryingTools(tools: Awaited<ReturnType<typeof listTools>>) {
  return tools
    .filter((tool) => "return_block_map" in ((tool.inputSchema as any)?.properties ?? {}))
    .map((tool) => tool.name);
}

describe("return_block_map parameter surface", () => {
  it("is offered by exactly the receipt tools in each complete transport catalog", async () => {
    const stdioCatalog = await listTools("stdio");
    const httpCatalog = await listTools("http");
    const stdioCarriers = carryingTools(stdioCatalog);
    const httpCarriers = carryingTools(httpCatalog);

    expect(stdioCatalog.length).toBeGreaterThan(20);
    expect(httpCatalog.length).toBeGreaterThan(20);
    expect(new Set(stdioCarriers)).toEqual(new Set(STDIO_TOOLS));
    expect(stdioCarriers).toHaveLength(STDIO_TOOLS.length);
    expect(new Set(httpCarriers)).toEqual(new Set(HTTP_TOOLS));
    expect(httpCarriers).toHaveLength(HTTP_TOOLS.length);
  });

  it("pins the optional boolean parameter copy on every carrying tool", async () => {
    for (const transport of ["stdio", "http"] as const) {
      const tools = await listTools(transport);
      const expected = transport === "stdio" ? STDIO_TOOLS : HTTP_TOOLS;

      for (const name of expected) {
        const tool = tools.find((candidate) => candidate.name === name);
        const schema = tool?.inputSchema as any;

        expect(schema.properties.return_block_map.type).toBe("boolean");
        expect(schema.properties.return_block_map.description).toBe(RETURN_BLOCK_MAP_DESCRIPTION);
        expect(schema.properties.return_block_map.description).not.toContain(String.fromCodePoint(0x2014));
        expect(schema.required ?? []).not.toContain("return_block_map");
      }
    }
  });

  it("leaves every tool description unchanged by the parameter", async () => {
    const tools = await listTools("stdio");
    const createPage = tools.find((tool) => tool.name === "create_page");

    expect(createPage?.description).toBe(CREATE_PAGE_DESCRIPTION);
    expect(createPage?.description?.length).toBe(393);
    expect(createPage?.description?.length).toBeLessThan(400);

    for (const [name, pin] of Object.entries(DESCRIPTION_PINS)) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      expect(description.length, `${name} description length moved`).toBe(pin.length);
      expect(sha256(description), `${name} description bytes moved`).toBe(pin.sha256);
    }

    for (const tool of tools) {
      expect(tool.description ?? "", `${tool.name} inlined the parameter`).not.toContain(
        "return_block_map",
      );
    }
  });

  it("does not add the parameter to the CLI", async () => {
    const source = await readFile(new URL("../src/cli/run.ts", import.meta.url), "utf8");
    expect(source).not.toContain("return_block_map");
  });
});

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

async function withClient<T>(fn: (client: McpClient) => Promise<T>) {
  const server = createServer(() => ({}) as any, {});
  const client = new McpClient(
    { name: "resources-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await fn(client);
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

async function readResourceText(uri: string) {
  return withClient(async (client) => {
    const result = await client.readResource({ uri });
    expect(result.contents).toHaveLength(1);
    return "text" in result.contents[0] ? result.contents[0].text : "";
  });
}

describe("MCP documentation resources", () => {
  it("lists the shared documentation resources", async () => {
    const result = await withClient((client) => client.listResources());

    expect(result.resources).toEqual([
      expect.objectContaining({
        uri: "easy-notion://docs/markdown",
        name: "markdown-conventions",
        mimeType: "text/markdown",
      }),
      expect.objectContaining({
        uri: "easy-notion://docs/warnings",
        name: "warning-shapes",
        mimeType: "text/markdown",
      }),
      expect.objectContaining({
        uri: "easy-notion://docs/property-pagination",
        name: "property-pagination",
        mimeType: "text/markdown",
      }),
      expect.objectContaining({
        uri: "easy-notion://docs/update-data-source",
        name: "update-data-source-guide",
        mimeType: "text/markdown",
      }),
    ]);
    expect(result.resources.every((resource) => typeof resource.size === "number" && resource.size > 0)).toBe(true);
  });

  it("reads markdown conventions on demand", async () => {
    const result = await withClient((client) =>
      client.readResource({ uri: "easy-notion://docs/markdown" })
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: "easy-notion://docs/markdown",
      mimeType: "text/markdown",
    });
    expect("text" in result.contents[0] ? result.contents[0].text : "").toContain("+++ Title");
    expect("text" in result.contents[0] ? result.contents[0].text : "").toContain("file://");
  });

  it("documents warning shapes using the runtime contract", async () => {
    const text = await readResourceText("easy-notion://docs/warnings");
    const expectedShapes = [
      [
        "omitted_block_types",
        '"blocks": [{ "id": "block-id", "type": "meeting_notes" }]',
      ],
      [
        "truncated_properties",
        '"properties": [{ "name": "Name", "type": "title", "returned_count": 75, "cap": 75 }]',
      ],
      ["unmatched_blocks", '"block_ids": ["block-id"]'],
      [
        "bookmark_lost_on_atomic_replace",
        '{ "code": "bookmark_lost_on_atomic_replace", "url": "https://example.com/some-page" }',
      ],
      [
        "embed_lost_on_atomic_replace",
        '{ "code": "embed_lost_on_atomic_replace", "url": "https://example.com/embed-target" }',
      ],
    ] as const;

    for (const [code, shape] of expectedShapes) {
      expect(text).toContain(`## ${code}`);
      expect(text).toContain(`"code": "${code}"`);
      expect(text).toContain(shape);
    }
    expect(text).not.toContain('"property":');
    expect(text).not.toContain('"returned":');
    expect(text).not.toContain('"has_more":');
  });

  it("keeps safety-critical update_data_source warning inline while pointing to detailed resource", async () => {
    const result = await withClient((client) => client.listTools());
    const tool = result.tools.find((candidate) => candidate.name === "update_data_source");

    expect(tool?.description).toMatch(/CRITICAL: full-list semantics/);
    expect(tool?.description).toMatch(/silently reassigned/i);
    expect(tool?.description).toContain("easy-notion://docs/update-data-source");
  });

  it("moves reference-heavy markdown docs out of create_page description", async () => {
    const result = await withClient((client) => client.listTools());
    const tool = result.tools.find((candidate) => candidate.name === "create_page");

    expect(tool?.description).toContain("easy-notion://docs/markdown");
    expect(tool?.description).not.toContain("+++ Title\\ncontent\\n+++");
    expect(tool?.description?.length).toBeLessThan(400);
  });
});

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

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

describe("Destructive-edit tool descriptions (G-3a)", () => {
  it("G3a-1: replace_content description warns DESTRUCTIVE, no rollback, and names duplicate_page (or a non-destructive alternative) as recovery", async () => {
    const { tools } = await listTools();
    const replaceContent = tools.find((tool) => tool.name === "replace_content");
    expect(replaceContent).toBeDefined();
    const description = replaceContent!.description ?? "";
    expect(description).toMatch(/DESTRUCTIVE/);
    expect(description).toMatch(/no rollback/i);
    expect(description).toMatch(/(duplicate_page[^.]*first|non-destructive)/i);
  });

  it("G3a-2: update_section description warns DESTRUCTIVE, no rollback, names duplicate_page recovery, and mentions the heading-anchor retry-impossibility", async () => {
    const { tools } = await listTools();
    const updateSection = tools.find((tool) => tool.name === "update_section");
    expect(updateSection).toBeDefined();
    const description = updateSection!.description ?? "";
    expect(description).toMatch(/DESTRUCTIVE/);
    expect(description).toMatch(/no rollback/i);
    expect(description).toMatch(/duplicate_page[^.]*first/i);
    expect(description).toMatch(/heading anchor/i);
  });
});

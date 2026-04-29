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
  it("G3a-1: replace_content description (post-PR3 atomic) names matched-block ID preservation and the child_page / synced_block / child_database non-preservation, not DESTRUCTIVE", async () => {
    const { tools } = await listTools();
    const replaceContent = tools.find((tool) => tool.name === "replace_content");
    expect(replaceContent).toBeDefined();
    const description = replaceContent!.description ?? "";
    // PR3 (DP5=B) softened the warning: the atomic endpoint preserves block IDs
    // for matched content, so the "DESTRUCTIVE no rollback" framing overclaims
    // risk. The remaining honest hazard is that block types the parser doesn't
    // represent (child_page, synced_block, child_database, link_to_page) get
    // dropped on replace.
    expect(description).not.toMatch(/DESTRUCTIVE/);
    expect(description).toMatch(/atomically|preserve|matched/i);
    expect(description).toMatch(/child_page|synced_block|child_database/);
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

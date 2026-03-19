#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNotionClient } from "./notion-client.js";
import { createServer } from "./server.js";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error("NOTION_TOKEN is required");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);
const server = createServer(
  () => notion,
  {
    rootPageId: process.env.NOTION_ROOT_PAGE_ID,
    trustContent: process.env.NOTION_TRUST_CONTENT === "true",
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("easy-notion-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});

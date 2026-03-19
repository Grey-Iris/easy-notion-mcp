/**
 * Live API test script for easy-notion-mcp.
 * Requires NOTION_TOKEN and NOTION_ROOT_PAGE_ID env vars.
 *
 * Usage: npx tsx scripts/test-live.ts
 */
import "dotenv/config";
import {
  createNotionClient,
  searchNotion,
  createPage,
  getPage,
  archivePage,
  restorePage,
  movePage,
  createDatabase,
  createDatabaseEntry,
  queryDatabase,
  updateDatabaseEntry,
} from "../src/notion-client.js";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;

if (!NOTION_TOKEN || !ROOT_PAGE_ID) {
  console.error("NOTION_TOKEN and NOTION_ROOT_PAGE_ID must be set");
  process.exit(1);
}

const client = createNotionClient(NOTION_TOKEN);
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
    failed++;
  }
}

async function main() {
  console.log("Live API Tests\n");

  // --- Basic operations ---
  console.log("Basic operations:");
  let testPageId: string | undefined;

  await test("search", async () => {
    const results = await searchNotion(client, "test");
    if (!Array.isArray(results)) throw new Error("Expected array");
  });

  await test("create page", async () => {
    const page = (await createPage(client, ROOT_PAGE_ID, "SDK Live Test Page", [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: "Hello from v5 SDK" } }],
        },
      },
    ])) as any;
    testPageId = page.id;
    if (!testPageId) throw new Error("No page ID returned");
  });

  await test("get page", async () => {
    if (!testPageId) throw new Error("No test page");
    const page = (await getPage(client, testPageId)) as any;
    if (page.id !== testPageId) throw new Error("ID mismatch");
  });

  await test("archive page", async () => {
    if (!testPageId) throw new Error("No test page");
    await archivePage(client, testPageId);
  });

  // --- Move page ---
  console.log("\nMove page:");
  let moveTargetId: string | undefined;

  await test("create target page for move", async () => {
    const page = (await createPage(client, ROOT_PAGE_ID, "Move Target", [])) as any;
    moveTargetId = page.id;
  });

  await test("move page", async () => {
    if (!testPageId || !moveTargetId) throw new Error("Missing pages");
    // Restore first since we archived it above
    await restorePage(client, testPageId);
    await movePage(client, testPageId, moveTargetId);
  });

  await test("cleanup move test pages", async () => {
    if (testPageId) await archivePage(client, testPageId);
    if (moveTargetId) await archivePage(client, moveTargetId);
  });

  // --- Database operations ---
  console.log("\nDatabase operations:");
  let dbId: string | undefined;
  let entryId: string | undefined;

  await test("create database", async () => {
    const db = (await createDatabase(client, ROOT_PAGE_ID, "SDK Test DB", [
      { name: "Name", type: "title" },
      { name: "Count", type: "number" },
      { name: "Status", type: "select" },
    ])) as any;
    dbId = db.id;
    if (!dbId) throw new Error("No database ID returned");
  });

  await test("add database entry", async () => {
    if (!dbId) throw new Error("No test DB");
    const entry = (await createDatabaseEntry(client, dbId, {
      Name: "Test Entry",
      Count: 42,
      Status: "Active",
    })) as any;
    entryId = entry.id;
    if (!entryId) throw new Error("No entry ID returned");
  });

  await test("query database", async () => {
    if (!dbId) throw new Error("No test DB");
    const results = await queryDatabase(client, dbId);
    if (results.length === 0) throw new Error("Expected at least 1 result");
  });

  await test("update database entry", async () => {
    if (!entryId) throw new Error("No test entry");
    await updateDatabaseEntry(client, entryId, { Count: 99 });
  });

  await test("archive database entry", async () => {
    if (!entryId) throw new Error("No test entry");
    await archivePage(client, entryId);
  });

  // --- Cleanup ---
  if (dbId) {
    try {
      await archivePage(client, dbId);
    } catch {}
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

import { Client } from "@notionhq/client";
import { NOTION_VERSION } from "../src/notion-version.js";

const token = process.env.NOTION_TOKEN!;
const rootPageId = process.env.NOTION_ROOT_PAGE_ID!;

if (!token || !rootPageId) {
  console.error("Set NOTION_TOKEN and NOTION_ROOT_PAGE_ID");
  process.exit(1);
}

const notion = new Client({ auth: token, notionVersion: NOTION_VERSION });

// Import the functions we need to test
import {
  createDatabase,
  getDatabase,
  buildTextFilter,
  queryDatabase,
  createDatabaseEntry,
  searchNotion,
  createNotionClient,
} from "../src/notion-client.js";

async function main() {
  const client = createNotionClient(token);

  console.log("1. Creating test database...");
  const db = await createDatabase(client, rootPageId, "DX Test DB", [
    { name: "Name", type: "title" },
    { name: "Status", type: "select" },
    { name: "Priority", type: "select" },
    { name: "Notes", type: "text" },
  ]) as any;
  console.log(`   Created: ${db.id}`);

  console.log("2. Getting database schema...");
  const schema = await getDatabase(client, db.id);
  console.log(`   Title: ${schema.title}`);
  console.log(`   Properties: ${JSON.stringify(schema.properties, null, 2)}`);

  console.log("3. Adding entries...");
  const entry1 = await createDatabaseEntry(client, db.id, {
    Name: "Buy groceries",
    Status: "Todo",
    Notes: "Milk and eggs",
  }) as any;
  console.log(`   Entry 1: ${entry1.id}`);

  const entry2 = await createDatabaseEntry(client, db.id, {
    Name: "Fix bug report",
    Status: "In Progress",
    Notes: "Critical issue with login",
  }) as any;
  console.log(`   Entry 2: ${entry2.id}`);

  // Small delay for Notion indexing
  await new Promise(r => setTimeout(r, 2000));

  console.log("4. Text search for 'groceries'...");
  const textFilter = await buildTextFilter(client, db.id, "groceries");
  console.log(`   Filter: ${JSON.stringify(textFilter)}`);
  const results = await queryDatabase(client, db.id, textFilter as any) as any[];
  console.log(`   Found ${results.length} result(s)`);
  for (const r of results) {
    const title = Object.values(r.properties).find((p: any) => p.type === "title") as any;
    console.log(`   - ${title?.title?.[0]?.plain_text}`);
  }

  console.log("5. Searching for database...");
  const searchResults = await searchNotion(client, "DX Test DB", "databases") as any[];
  console.log(`   Found ${searchResults.length} result(s)`);

  console.log("6. Cleanup — archiving test database...");
  await client.databases.update({ database_id: db.id, in_trash: true } as any);
  console.log("   Done!");

  console.log("\n✓ All DX tests passed!");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});

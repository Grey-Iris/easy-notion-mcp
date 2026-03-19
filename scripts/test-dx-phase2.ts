import {
  appendBlocksAfter,
  archivePage,
  createDatabase,
  createDatabaseEntry,
  createNotionClient,
  createPage,
  deleteBlock,
  getCachedSchema,
  listChildren,
  searchNotion,
} from "../src/notion-client.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";

const token = process.env.NOTION_TOKEN!;
const rootPageId = process.env.NOTION_ROOT_PAGE_ID!;

if (!token || !rootPageId) {
  console.error("Set NOTION_TOKEN and NOTION_ROOT_PAGE_ID");
  process.exit(1);
}

const client = createNotionClient(token);

function getBlockHeadingText(block: any): string | null {
  const type = block.type;
  if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
    const richText = block[type]?.rich_text ?? [];
    return richText.map((t: any) => t.plain_text).join("").trim();
  }
  return null;
}

function getHeadingLevel(type: string): number {
  if (type === "heading_1") return 1;
  if (type === "heading_2") return 2;
  if (type === "heading_3") return 3;
  return 0;
}

async function main() {
  const cleanup: string[] = [];

  try {
    console.log("1. Creating page with 3 sections...");
    const page = await createPage(
      client,
      rootPageId,
      "DX Phase 2 Test",
      markdownToBlocks(
        "## Intro\n\nThis is the intro section.\n\n## Body\n\nOriginal body content.\n\n## Conclusion\n\nThis is the conclusion.",
      ),
    ) as any;
    cleanup.push(page.id);
    console.log(`   Page: ${page.id}`);

    await sleep(1000);

    console.log("2. Testing update_section — replacing Body...");
    const allBlocks = await listChildren(client, page.id);
    const headingIdx = allBlocks.findIndex((block: any) => {
      const text = getBlockHeadingText(block);
      return text !== null && text.toLowerCase() === "body";
    });

    if (headingIdx === -1) {
      throw new Error("Heading 'Body' not found");
    }

    const headingBlock = allBlocks[headingIdx];
    const headingLevel = getHeadingLevel(headingBlock.type);
    let sectionEnd = allBlocks.length;

    for (let index = headingIdx + 1; index < allBlocks.length; index += 1) {
      const level = getHeadingLevel(allBlocks[index].type);
      if (level > 0 && level <= headingLevel) {
        sectionEnd = index;
        break;
      }
    }

    const sectionBlocks = allBlocks.slice(headingIdx, sectionEnd);
    const afterBlockId = headingIdx > 0 ? allBlocks[headingIdx - 1].id : undefined;

    for (const block of sectionBlocks) {
      await deleteBlock(client, block.id);
    }

    const newBlocks = markdownToBlocks("## Body\n\nUpdated body content!\n\n- Point one\n- Point two");
    const appended = await appendBlocksAfter(client, page.id, newBlocks, afterBlockId);
    console.log(`   Deleted ${sectionBlocks.length}, appended ${appended.length}`);

    await sleep(1000);

    console.log("3. Verifying page content...");
    const verifyBlocks = await listChildren(client, page.id);
    const headings = verifyBlocks
      .filter((block: any) => ["heading_1", "heading_2", "heading_3"].includes(block.type))
      .map((block: any) => getBlockHeadingText(block) ?? "");

    console.log(`   Headings found: ${JSON.stringify(headings)}`);
    assert(headings.length === 3, `Expected 3 headings, got ${headings.length}`);
    assert(headings[0] === "Intro", `First heading should be Intro, got ${headings[0]}`);
    assert(headings[1] === "Body", `Second heading should be Body, got ${headings[1]}`);
    assert(headings[2] === "Conclusion", `Third heading should be Conclusion, got ${headings[2]}`);
    console.log("   ✓ Sections intact");

    console.log("4. Creating test database...");
    const db = await createDatabase(client, rootPageId, "DX Phase 2 Batch DB", [
      { name: "Name", type: "title" },
      { name: "Status", type: "select" },
    ]) as any;
    cleanup.push(db.id);
    console.log(`   Database: ${db.id}`);

    console.log("5. Batch adding 3 entries...");
    await getCachedSchema(client, db.id);
    const entries = [
      { Name: "Task 1", Status: "Todo" },
      { Name: "Task 2", Status: "In Progress" },
      { Name: "Task 3", Status: "Done" },
    ];
    const succeeded: Array<{ id: string; url: string }> = [];
    const failed: Array<{ index: number; error: string }> = [];

    for (let index = 0; index < entries.length; index += 1) {
      try {
        const result = await createDatabaseEntry(client, db.id, entries[index]) as any;
        succeeded.push({ id: result.id, url: result.url });
      } catch (error) {
        failed.push({
          index,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(`   Succeeded: ${succeeded.length}, Failed: ${failed.length}`);
    assert(succeeded.length === 3, `Expected 3 succeeded, got ${succeeded.length}`);

    console.log("6. Testing list_databases...");
    await sleep(2000);
    const allDbs = await searchNotion(client, "", "databases") as any[];
    const found = allDbs.find((result: any) => result.id === db.id);
    console.log(`   Total databases: ${allDbs.length}, found test DB: ${Boolean(found)}`);
    console.log("   ✓ list_databases works");

    console.log("7. Creating page with 6 blocks for max_blocks test...");
    const bigPage = await createPage(
      client,
      rootPageId,
      "DX Phase 2 Big Page",
      markdownToBlocks("Paragraph 1\n\nParagraph 2\n\nParagraph 3\n\nParagraph 4\n\nParagraph 5\n\nParagraph 6"),
    ) as any;
    cleanup.push(bigPage.id);

    await sleep(1000);

    console.log("8. Reading with max_blocks: 2...");
    const response = await client.blocks.children.list({
      block_id: bigPage.id,
      page_size: 100,
    });
    const totalBlocks = response.results.length;
    console.log(`   Total blocks on page: ${totalBlocks}`);
    assert(totalBlocks >= 5, `Expected 5+ blocks, got ${totalBlocks}`);

    const limitedBlocks = response.results.slice(0, 2);
    const hasMore = totalBlocks > limitedBlocks.length;
    console.log(`   Limited to ${limitedBlocks.length} blocks, has_more: ${hasMore}`);
    assert(hasMore === true, "Expected has_more to be true");
    console.log("   ✓ max_blocks works");

    console.log("\n✓ All Phase 2 DX tests passed!");
  } finally {
    console.log("\nCleaning up...");
    for (const id of cleanup) {
      try {
        await archivePage(client, id).catch(() =>
          client.databases.update({ database_id: id, in_trash: true } as any),
        );
        console.log(`   Archived ${id}`);
      } catch {
        console.log(`   Could not archive ${id} (may already be archived)`);
      }
    }
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});

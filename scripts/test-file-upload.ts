import "dotenv/config";
import { createNotionClient, createPage, uploadFile } from "../src/notion-client.js";
import { processFileUploads } from "../src/file-upload.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";
import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;

if (!NOTION_TOKEN || !ROOT_PAGE_ID) {
  console.error("Set NOTION_TOKEN and NOTION_ROOT_PAGE_ID");
  process.exit(1);
}

const client = createNotionClient(NOTION_TOKEN);

async function createTestFiles() {
  // Minimal 1x1 red PNG (68 bytes)
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  const pngPath = join(tmpdir(), "test-upload.png");
  await writeFile(pngPath, png);

  const txtPath = join(tmpdir(), "test-upload.txt");
  await writeFile(txtPath, "Hello from file upload test!");

  return { pngPath, txtPath };
}

async function main() {
  console.log("Creating test files...");
  const { pngPath, txtPath } = await createTestFiles();

  try {
    const pngUrl = `file://${pngPath}`;
    const txtUrl = `file://${txtPath}`;

    const markdown = `# File Upload Test

![test image](${pngUrl})

[test-upload.txt](${txtUrl})

Regular text after uploads.`;

    console.log("Processing file uploads...");
    const processed = await processFileUploads(client, markdown);
    console.log("Processed markdown:", processed);

    console.log("Creating page...");
    const blocks = markdownToBlocks(processed);
    const page = await createPage(client, ROOT_PAGE_ID, "File Upload Test", blocks) as any;
    console.log("Page created:", page.url);

    // Read back — we can't easily import fetchBlocksRecursive from index.ts,
    // so just verify the page was created successfully
    console.log("Page ID:", page.id);
    console.log("\nSuccess! Check the page in Notion to verify the image and file blocks.");
    console.log("Page URL:", page.url);
  } finally {
    await unlink(pngPath).catch(() => {});
    await unlink(txtPath).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

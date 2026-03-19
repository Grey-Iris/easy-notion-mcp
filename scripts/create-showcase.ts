import {
  addComment,
  archivePage,
  createDatabase,
  createDatabaseEntry,
  createNotionClient,
  createPage,
  getCachedSchema,
  getPage,
  listChildren,
  queryDatabase,
} from "../src/notion-client.js";
import { blockTextToRichText, markdownToBlocks } from "../src/markdown-to-blocks.js";
import { processFileUploads } from "../src/file-upload.js";
import type { NotionBlock } from "../src/types.js";
import { unlink, writeFile } from "fs/promises";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;

if (!NOTION_TOKEN || !NOTION_ROOT_PAGE_ID) {
  console.error("NOTION_TOKEN and NOTION_ROOT_PAGE_ID env vars are required");
  process.exit(1);
}

const SHOWCASE_PNG_PATH = "/tmp/easy-notion-showcase.svg";
const SHOWCASE_TEXT_PATH = "/tmp/easy-notion-showcase-readme.md";
const SHOWCASE_PNG_URL = `file://${SHOWCASE_PNG_PATH}`;
const SHOWCASE_TEXT_URL = `file://${SHOWCASE_TEXT_PATH}`;

async function createPageWithUploads(
  client: ReturnType<typeof createNotionClient>,
  parentId: string,
  title: string,
  markdown: string,
  icon?: string,
): Promise<any> {
  const processed = await processFileUploads(client, markdown);
  const blocks: NotionBlock[] = markdownToBlocks(processed);
  return createPage(client, parentId, title, blocks, icon);
}

function buildShowcaseMarkdown(): string {
  return [
    "[toc]",
    "",
    "# Rich Text & Typography",
    "",
    "This section demonstrates **bold**, *italic*, ~~strikethrough~~, `inline code`, and [links](https://example.com).",
    "",
    "Here's a paragraph with **mixed *nested* formatting** and some `code spans` for good measure.",
    "",
    "## Lists",
    "",
    "- First bullet item",
    "- Second bullet item",
    "  - Nested sub-item",
    "- Third bullet item",
    "",
    "1. First numbered item",
    "2. Second numbered item",
    "3. Third numbered item",
    "",
    "- [ ] Unchecked task",
    "- [x] Completed task",
    "- [ ] Another todo",
    "",
    "## Code Blocks",
    "",
    "```javascript",
    "function greet(name) {",
    "  return `Hello, ${name}!`;",
    "}",
    'console.log(greet("Notion"));',
    "```",
    "",
    "```python",
    "def fibonacci(n):",
    "    a, b = 0, 1",
    "    for _ in range(n):",
    "        a, b = b, a + b",
    "    return a",
    "",
    "print(fibonacci(10))",
    "```",
    "",
    "```",
    "This is a plain code block",
    "with no language specified.",
    "```",
    "",
    "## Tables",
    "",
    "| Feature | Status | Category |",
    "| --- | --- | --- |",
    "| Markdown conversion | Done | Core |",
    "| File uploads | Done | Core |",
    "| Database operations | Done | Core |",
    "",
    "## Callout Types",
    "",
    "> [!NOTE]",
    "> This is a note callout - use it for additional context.",
    "",
    "> [!TIP]",
    "> This is a tip callout - use it for helpful suggestions.",
    "",
    "> [!WARNING]",
    "> This is a warning callout - use it for potential issues.",
    "",
    "> [!IMPORTANT]",
    "> This is an important callout - use it for critical information.",
    "",
    "> [!INFO]",
    "> This is an info callout - use it for general information.",
    "",
    "> [!SUCCESS]",
    "> This is a success callout - use it for confirmations.",
    "",
    "> [!ERROR]",
    "> This is an error callout - use it for error messages.",
    "",
    "## Toggle Blocks",
    "",
    "+++ Click to expand this toggle",
    "This content is hidden inside a toggle block.",
    "",
    "It can contain **bold**, *italic*, and `code`.",
    "+++",
    "",
    "+++ Another toggle with a list",
    "- Item one",
    "- Item two",
    "- Item three",
    "+++",
    "",
    "## Column Layout",
    "",
    "::: columns",
    "::: column",
    "**Left Column**",
    "",
    "Content on the left side with some text.",
    ":::",
    "::: column",
    "**Right Column**",
    "",
    "Content on the right side with some text.",
    ":::",
    ":::",
    "",
    "## Equations",
    "",
    "$$E = mc^2$$",
    "",
    "$$",
    "\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    "$$",
    "",
    "## Special Blocks",
    "",
    "---",
    "",
    "https://github.com/jwigg/easy-notion-mcp",
    "",
    "[embed](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
    "",
    "## Images & File Uploads",
    "",
    `![easy-notion-mcp banner](${SHOWCASE_PNG_URL})`,
    "",
    `[showcase-readme.md](${SHOWCASE_TEXT_URL})`,
    "",
    "## Blockquotes",
    "",
    "> This is a regular blockquote. It should render as a quote block, not a callout.",
  ].join("\n");
}

async function createTestFiles() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0c29"/>
      <stop offset="50%" style="stop-color:#302b63"/>
      <stop offset="100%" style="stop-color:#24243e"/>
    </linearGradient>
  </defs>
  <rect width="800" height="200" fill="url(#bg)" rx="16"/>
  <text x="400" y="90" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="bold">easy-notion-mcp</text>
  <text x="400" y="135" text-anchor="middle" fill="#a78bfa" font-family="system-ui, -apple-system, sans-serif" font-size="22">Markdown-first Notion MCP server</text>
  <text x="400" y="170" text-anchor="middle" fill="#6ee7b7" font-family="system-ui, -apple-system, sans-serif" font-size="16">87% fewer tokens per operation</text>
</svg>`;

  const readme = `# easy-notion-mcp

This file was uploaded to Notion via the \`file://\` protocol.

## How it works

Agents write markdown with \`file://\` paths:
- \`![screenshot](file:///tmp/screenshot.png)\` → image block
- \`[report.pdf](file:///tmp/report.pdf)\` → file block
- \`[recording.mp3](file:///tmp/recording.mp3)\` → audio block

The server handles the upload transparently. No extra tools needed.

## Stats
- 25 tools
- 19 block types
- 87% token reduction vs raw Notion API
`;

  await writeFile(SHOWCASE_PNG_PATH, svg);
  await writeFile(SHOWCASE_TEXT_PATH, readme);
}

function logStepError(step: string, error: unknown) {
  console.error(`  ${step} failed:`, error instanceof Error ? error.message : error);
}

async function main() {
  const client = createNotionClient(NOTION_TOKEN);
  const showcaseMarkdown = buildShowcaseMarkdown();
  const subPageMarkdown = [
    "This is a child page created by the showcase script.",
    "",
    "> [!TIP]",
    "> Child pages inherit their parent's permissions.",
  ].join("\n");

  let showcasePageId: string | undefined;
  let showcasePageUrl: string | undefined;

  console.log("🚀 easy-notion-mcp Showcase Generator\n");

  try {
    console.log("Step 1: Creating test files...");
    try {
      await createTestFiles();
    } catch (error) {
      logStepError("Test file creation", error);
      throw error;
    }

    console.log("Step 2: Creating showcase page with all markdown features...");
    try {
      const showcasePage = await createPageWithUploads(
        client,
        NOTION_ROOT_PAGE_ID,
        "easy-notion-mcp Showcase",
        showcaseMarkdown,
        "🚀",
      );
      showcasePageId = (showcasePage as any).id;
      showcasePageUrl = (showcasePage as any).url;
      console.log(`  Created showcase page: ${showcasePageUrl ?? showcasePageId}`);
    } catch (error) {
      logStepError("Main page creation", error);
      throw error;
    }

    if (!showcasePageId) {
      throw new Error("Showcase page ID missing after page creation");
    }

    console.log("Step 3: Creating Feature Tracker database...");
    try {
      const db = (await createDatabase(client, showcasePageId, "Feature Tracker", [
        { name: "Name", type: "title" },
        { name: "Status", type: "select" },
        { name: "Priority", type: "select" },
        { name: "Category", type: "multi_select" },
        { name: "Notes", type: "text" },
        { name: "Completed", type: "checkbox" },
        { name: "Due", type: "date" },
      ])) as any;

      const dbId = db.id as string;
      console.log(`  Created database: ${dbId}`);

      const entriesToCreate: Array<Record<string, unknown>> = [
        {
          Name: "Markdown conversion",
          Status: "Done",
          Priority: "High",
          Category: ["Core"],
          Notes: "Full round-trip",
          Completed: true,
          Due: "2026-03-01",
        },
        {
          Name: "File uploads",
          Status: "Done",
          Priority: "High",
          Category: ["Core", "New"],
          Notes: "Via file:// protocol",
          Completed: true,
          Due: "2026-03-18",
        },
        {
          Name: "Database operations",
          Status: "Done",
          Priority: "Medium",
          Category: ["Core"],
          Notes: "Auto-schema conversion",
          Completed: true,
          Due: "2026-03-05",
        },
        {
          Name: "Section editing",
          Status: "Done",
          Priority: "Medium",
          Category: ["DX"],
          Notes: "Edit by heading name",
          Completed: true,
          Due: "2026-03-18",
        },
        {
          Name: "HTTP transport",
          Status: "Not started",
          Priority: "Low",
          Category: ["Future"],
          Notes: "Multi-user support",
          Completed: false,
        },
      ];

      for (const properties of entriesToCreate) {
        await createDatabaseEntry(client, dbId, properties);
      }
      console.log(`  Added ${entriesToCreate.length} entries`);

      const schema = (await getCachedSchema(client, dbId)) as any;
      console.log(`  Cached schema has ${Object.keys(schema.properties ?? {}).length} properties`);

      const entries = await queryDatabase(client, dbId);
      console.log(`  Queried ${entries.length} entries`);
    } catch (error) {
      logStepError("Database demo", error);
    }

    console.log("Step 4: Adding comment...");
    try {
      await addComment(
        client,
        showcasePageId,
        blockTextToRichText(
          "This page was generated automatically by easy-notion-mcp to demonstrate all features. 🚀",
        ),
      );
      console.log("  Comment added");
    } catch (error) {
      logStepError("Comments demo", error);
    }

    console.log("Step 5: Reading page back...");
    try {
      const page = await getPage(client, showcasePageId);
      const blocks = await listChildren(client, showcasePageId);
      const title =
        (page as any).properties?.title?.title?.[0]?.plain_text ??
        (page as any).properties?.Title?.title?.[0]?.plain_text ??
        "unknown";

      console.log(`  Page has ${blocks.length} top-level blocks`);
      console.log(`  Page title: ${title}`);
    } catch (error) {
      logStepError("Read-back demo", error);
    }

    console.log("Step 6: Demonstrating page operations...");
    try {
      const subPage = (await createPage(
        client,
        showcasePageId,
        "Showcase Sub-Page",
        markdownToBlocks(subPageMarkdown),
      )) as any;
      console.log(`  Created sub-page: ${subPage.id}`);

      const subBlocks = await listChildren(client, subPage.id);
      console.log(`  Sub-page has ${subBlocks.length} top-level blocks`);

      const duplicate = (await createPage(
        client,
        showcasePageId,
        "Showcase Sub-Page (Copy)",
        markdownToBlocks(subPageMarkdown),
      )) as any;
      console.log(`  Created duplicate page: ${duplicate.id}`);

      await archivePage(client, duplicate.id);
      console.log("  Archived duplicate page");
    } catch (error) {
      logStepError("Page operations demo", error);
    }

    console.log(`\n✅ Showcase page: ${showcasePageUrl ?? "unknown"}`);
  } finally {
    await unlink(SHOWCASE_PNG_PATH).catch(() => {});
    await unlink(SHOWCASE_TEXT_PATH).catch(() => {});
  }
}

main().catch((error) => {
  console.error("Showcase generation failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

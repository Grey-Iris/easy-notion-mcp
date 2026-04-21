import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../src/markdown-to-blocks.js";
import type { NotionBlock } from "../../src/types.js";
import { checkE2eEnv } from "./helpers/env-gate.js";
import { McpStdioClient } from "./helpers/mcp-stdio-client.js";
import { callTool } from "./helpers/call-tool.js";
import { createSandbox, archivePageIds } from "./helpers/sandbox.js";
import { buildRunContext, type RunContext } from "./helpers/run-context.js";
import {
  CONTENT_NOTICE,
  stripContentNotice,
  expectContentNoticePresent,
} from "./helpers/content-notice.js";
import { assertNoWarnings } from "./helpers/warnings.js";

const env = checkE2eEnv();

type ToolsListResult = {
  tools?: Array<{ name: string }>;
};

type GetMeResponse = {
  id: string;
  name: string;
  type: string;
};

type CreatePageResponse = {
  id: string;
  title?: string;
  url: string;
  error?: string;
};

type ReadPageResponse = {
  id: string;
  title: string | null;
  url: string;
  markdown: string;
  warnings?: unknown;
  error?: string;
  in_trash?: boolean;
};

const PIXEL_PATH = resolve(process.cwd(), "tests/e2e/fixtures/pixel.png");
const GOLDEN_PATH_FIXTURE = resolve(process.cwd(), "tests/e2e/fixtures/golden-path.md");
const IMAGE_URL_RE = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/;

function getChildBlocks(block: NotionBlock): NotionBlock[] {
  switch (block.type) {
    case "heading_1":
      return block.heading_1.children ?? [];
    case "heading_2":
      return block.heading_2.children ?? [];
    case "heading_3":
      return block.heading_3.children ?? [];
    case "toggle":
      return block.toggle.children ?? [];
    case "bulleted_list_item":
      return block.bulleted_list_item.children ?? [];
    case "numbered_list_item":
      return block.numbered_list_item.children ?? [];
    case "table":
      return block.table.children ?? [];
    case "column_list":
      return block.column_list.children ?? [];
    case "column":
      return block.column.children ?? [];
    default:
      return [];
  }
}

function countBlocksDeep(blocks: NotionBlock[]): number {
  return blocks.reduce((total, block) => total + 1 + countBlocksDeep(getChildBlocks(block)), 0);
}

function isAllowedNotionFileHost(hostname: string): boolean {
  return (
    hostname === "prod-files-secure.s3.us-west-2.amazonaws.com" ||
    hostname === "prod-files-secure.s3.amazonaws.com" ||
    hostname === "file.notion.so" ||
    hostname === "www.notion.so" ||
    /(^|\.)notion\.so$/i.test(hostname) ||
    /.+\.amazonaws\.com$/i.test(hostname)
  );
}

describe.skipIf(!env.shouldRun)(
  "Tier-1 E2E harness" + (env.reason ? ` (skipped: ${env.reason})` : ""),
  () => {
    let client: McpStdioClient;
    let ctx: RunContext;

    beforeAll(async () => {
      client = new McpStdioClient({ token: env.token! });
      await client.initialize();

      ctx = await buildRunContext();

      const sandbox = await createSandbox(client, env.rootId!, ctx);
      ctx.sandboxId = sandbox.id;
      ctx.sandboxName = sandbox.name;
      ctx.createdPageIds.push(sandbox.id);

      console.error(`[e2e] sandbox ready: ${sandbox.name} id=${sandbox.id}`);
    }, 30_000);

    afterAll(async () => {
      try {
        if (client && ctx?.createdPageIds.length) {
          const cleanup = await archivePageIds(client, ctx.createdPageIds);
          if (cleanup.failed.length > 0) {
            console.error(
              `[e2e] cleanup failures: ${JSON.stringify(cleanup.failed)}`,
            );
          }
        }
      } finally {
        await client?.close();
      }
    }, 60_000);

    it("A1: auth / transport smoke", async () => {
      expect(client).toBeTruthy();

      const listResponse = await client.request("tools/list", {});
      expect(listResponse.error).toBeUndefined();

      const tools = ((listResponse.result as ToolsListResult | undefined)?.tools) ?? [];
      expect(tools.length).toBeGreaterThanOrEqual(27);

      const me = await callTool<GetMeResponse>(client, "get_me", {});
      expect(me.id).toEqual(expect.any(String));
      expect(me.id.length).toBeGreaterThan(0);
      expect(me.name).toEqual(expect.any(String));
      expect(me.type).toBe("bot");
    });

    it("B1: round-trip fidelity", async () => {
      const fixture = readFileSync(GOLDEN_PATH_FIXTURE, "utf8");
      const expectedBlockCount = countBlocksDeep(markdownToBlocks(fixture));

      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "B1 round-trip fidelity",
        markdown: fixture,
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const readBack = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
        max_blocks: 100,
      });

      expect(readBack.error).toBeUndefined();
      assertNoWarnings(readBack);

      const body = stripContentNotice(readBack.markdown);
      expect(body).toContain("ROUND-TRIP-SENTINEL-B1");

      // `read_page` does not expose a block count, so compare the parser-visible
      // block tree on both sides. This is less brittle than raw paragraph splits
      // and still catches dropped representable block types.
      const actualBlockCount = countBlocksDeep(markdownToBlocks(body));
      expect(actualBlockCount).toBe(expectedBlockCount);

      expect(body).toContain("# heading_1 H1 line");
      expect(body).toContain("## heading_2 H2 line");
      expect(body).toContain("### heading_3 H3 line");
      expect(body).toContain("[link](https://example.com/b1)");
      expect(body).toContain("+++ Toggle block title");
      expect(body).toContain("- Bullet item one");
      expect(body).toContain("1. Numbered item one");
      expect(body).toContain("> Quote block line for B1.");
      expect(body).toContain("> [!NOTE]");
      expect(body).toContain("$$E=mc^2$$");
      expect(body).toContain("| Header A | Header B |");
      expect(body).toContain("```typescript");
      expect(body).toMatch(/(?:^|\n)---(?:\n|$)/);
      expect(body).toMatch(/(?:^|\n)- \[x\] Checked task(?:\n|$)/);
      expect(body).toMatch(/(?:^|\n)- \[ \] Unchecked task(?:\n|$)/);
      expect(body).toContain("[toc]");
      expect(body).toContain("https://example.com/b1-bookmark");
      expect(body).toContain("[embed](https://example.com/b1-embed)");
    });

    it("B2: content-notice sentinel", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "B2 content notice",
        markdown: "Tiny body paragraph.",
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });

      expect(page.error).toBeUndefined();
      assertNoWarnings(page);
      expect(page.markdown.startsWith(CONTENT_NOTICE)).toBe(true);
      expectContentNoticePresent(page.markdown);
    });

    it("E1: stdio file upload", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "E1 file upload",
        markdown: `# File Upload Test\n\n![pixel](file://${PIXEL_PATH})`,
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });

      expect(page.error).toBeUndefined();
      assertNoWarnings(page);

      const markdown = stripContentNotice(page.markdown);
      expect(markdown).toContain("https://");
      expect(markdown).not.toContain("file://");

      const imageUrl = markdown.match(IMAGE_URL_RE)?.[1];
      expect(imageUrl).toBeDefined();

      const host = new URL(imageUrl!).hostname;
      expect(isAllowedNotionFileHost(host)).toBe(true);
    });

    it("KNOWN GAP: archiving a parent does not cascade archive to children", async () => {
      const scratchParent = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "TC1 scratch parent",
        markdown: "",
      });
      expect(scratchParent.error).toBeUndefined();
      ctx.createdPageIds.push(scratchParent.id);

      const scratchChild = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: scratchParent.id,
        title: "TC1 scratch child",
        markdown: "child body",
      });
      expect(scratchChild.error).toBeUndefined();
      ctx.createdPageIds.push(scratchChild.id);

      const archived = await callTool<{ success?: boolean; archived?: string; error?: string }>(
        client,
        "archive_page",
        { page_id: scratchParent.id },
      );
      expect(archived.error).toBeUndefined();
      expect(archived.success).toBe(true);

      // Preflight showed Notion does not cascade here. We pin that current behavior
      // so a future server-side cascade or recursive archive implementation flips red.
      const child = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: scratchChild.id,
      });

      expect(child.error).toBeUndefined();
      expect(child.id).toBe(scratchChild.id);
      expect(child.in_trash).not.toBe(true);
      expectContentNoticePresent(child.markdown);
    });
  },
);

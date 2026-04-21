import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../src/markdown-to-blocks.js";
import type { NotionBlock } from "../../src/types.js";
import { checkE2eEnv } from "./helpers/env-gate.js";
import { McpStdioClient } from "./helpers/mcp-stdio-client.js";
import { callTool } from "./helpers/call-tool.js";
import {
  callToolHttp,
  mintBearer,
  pickEphemeralPort,
  spawnHttpServer,
  type HttpHandle,
} from "./helpers/http-server.js";
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

type CreateDatabaseResponse = {
  id: string;
  title: string;
  url: string;
  properties: string[] | Record<string, unknown>;
  error?: string;
};

type UpdateDataSourceResponse = {
  id: string;
  title: string;
  url: string;
  properties: string[];
  error?: string;
};

type GetDatabaseResponse = {
  id: string;
  title: string;
  url: string;
  properties: Array<{
    name: string;
    type: string;
    options?: string[];
  }>;
  error?: string;
};

type AddDatabaseEntryResponse = {
  id: string;
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

type HttpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: {
    serverInfo?: {
      name: string;
      version?: string;
    };
    protocolVersion?: string;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const PIXEL_PATH = resolve(process.cwd(), "tests/e2e/fixtures/pixel.png");
const GOLDEN_PATH_FIXTURE = resolve(process.cwd(), "tests/e2e/fixtures/golden-path.md");
const MULTI_SECTION_FIXTURE = resolve(process.cwd(), "tests/e2e/fixtures/multi-section.md");
const IMAGE_URL_RE = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/;
const HTTP_ACCEPT = "application/json, text/event-stream";
const HTTP_PROTOCOL_VERSION = "2024-11-05";
const F2_OVERSIZE_ERROR =
  "body failed validation: body.children[0].code.rich_text[0].text.content.length should be ≤ `2000`, instead was `2050`. Check property names and types with get_database.";

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

function normalizeSectionBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseH2Sections(markdown: string): Array<{ heading: string; body: string }> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headings = Array.from(normalized.matchAll(/^## (.+)$/gm));

  return headings.map((match, index) => {
    const headingLine = match[0];
    const headingStart = match.index ?? 0;
    const bodyStart = headingStart + headingLine.length + 1;
    const bodyEnd = index + 1 < headings.length
      ? (headings[index + 1].index ?? normalized.length)
      : normalized.length;

    return {
      heading: match[1].trim(),
      body: normalized.slice(bodyStart, bodyEnd),
    };
  });
}

function parseSseJsonRpc(bodyText: string): HttpJsonRpcResponse {
  const events: string[] = [];
  const currentData: string[] = [];

  const flush = () => {
    if (currentData.length === 0) {
      return;
    }
    events.push(currentData.join("\n"));
    currentData.length = 0;
  };

  for (const rawLine of bodyText.split(/\r?\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }

    if (rawLine.startsWith("data:")) {
      currentData.push(rawLine.slice(5).trimStart());
    }
  }

  flush();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(events[index]) as HttpJsonRpcResponse;
    } catch {
      // Ignore non-JSON SSE payloads and continue.
    }
  }

  throw new Error(`Missing JSON-RPC payload in SSE body: ${bodyText}`);
}

async function parseHttpJsonRpcResponse(response: Response): Promise<HttpJsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();

  if (contentType.includes("text/event-stream")) {
    return parseSseJsonRpc(bodyText);
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(bodyText) as HttpJsonRpcResponse;
  }

  throw new Error(`Unsupported HTTP response content-type: ${contentType || "<missing>"}`);
}

async function postHttpInitialize(
  handle: HttpHandle,
  authorization?: string,
): Promise<Response> {
  return fetch(`${handle.url}/mcp`, {
    method: "POST",
    headers: {
      Accept: HTTP_ACCEPT,
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: HTTP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "e2e-h2", version: "0.0.1" },
      },
    }),
  });
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
          if (cleanup.unexpected.length > 0) {
            console.error(
              `[e2e] cleanup UNEXPECTED failures: ${JSON.stringify(cleanup.unexpected)}`,
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
    }, 20_000);

    it("KNOWN GAP: create_database silently drops formula-type columns", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C1 formula drop",
        schema: [
          { name: "Task", type: "title" },
          { name: "Count", type: "number" },
          { name: "Score", type: "formula" },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      expect(Array.isArray(created.properties)).toBe(true);
      expect(created.properties).toEqual(["Task", "Count"]);
      expect(created.properties).toContain("Task");
      expect(created.properties).toContain("Count");
      expect(created.properties).not.toContain("Score");

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.error).toBeUndefined();
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Task", type: "title" }),
          expect.objectContaining({ name: "Count", type: "number" }),
        ]),
      );
      expect(database.properties).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Score" })]),
      );
      expect(database.properties.some((property) => property.type === "formula")).toBe(false);
    }, 20_000);

    it("KNOWN GAP: unsupported property types return null without warning", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C2 unsupported property null fallback",
        schema: [
          { name: "Title", type: "title" },
          { name: "Count", type: "number" },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const updated = await callTool<UpdateDataSourceResponse>(client, "update_data_source", {
        database_id: created.id,
        properties: {
          Formula: {
            formula: {
              expression: 'prop("Count")',
            },
          },
        },
      });

      expect(updated.error).toBeUndefined();
      expect(updated.properties).toContain("Formula");

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Formula", type: "formula" }),
        ]),
      );

      const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Title: "row1",
          Count: 5,
        },
      });

      expect(entry.error).toBeUndefined();
      ctx.createdPageIds.push(entry.id);

      const rows = await callTool<Array<Record<string, unknown>>>(client, "query_database", {
        database_id: created.id,
      });

      expect(Array.isArray(rows)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(rows, "warnings")).toBe(false);

      const row = rows.find((candidate) => candidate.Title === "row1");
      expect(row).toBeDefined();
      expect(row).toEqual(expect.objectContaining({ Title: "row1", Count: 5, Formula: null }));
    }, 30_000);

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
    }, 20_000);

    it("F1: update_section edits one section, leaves siblings untouched", async () => {
      const fixture = readFileSync(MULTI_SECTION_FIXTURE, "utf8");
      const expectedSections = parseH2Sections(fixture);

      expect(expectedSections.map((section) => section.heading)).toEqual(["Alpha", "Beta", "Gamma"]);

      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F1 update_section",
        markdown: fixture,
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const updated = await callTool<{ deleted?: number; appended?: number; error?: string }>(
        client,
        "update_section",
        {
          page_id: created.id,
          heading: "Beta",
          markdown: [
            "## Beta",
            "",
            "Updated Beta paragraph.",
            "",
            "- Beta bullet new 1",
            "- Beta bullet new 2",
          ].join("\n"),
        },
      );

      expect(updated.error).toBeUndefined();
      expect(updated.deleted).toBeGreaterThanOrEqual(1);
      expect(updated.appended).toBeGreaterThanOrEqual(1);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });

      expect(page.error).toBeUndefined();
      assertNoWarnings(page);

      const actualSections = parseH2Sections(stripContentNotice(page.markdown));
      expect(actualSections).toHaveLength(3);
      expect(actualSections.map((section) => section.heading)).toEqual(["Alpha", "Beta", "Gamma"]);

      const [alpha, beta, gamma] = actualSections;
      expect(normalizeSectionBody(alpha.body)).toBe(normalizeSectionBody(expectedSections[0].body));
      expect(normalizeSectionBody(gamma.body)).toBe(normalizeSectionBody(expectedSections[2].body));
      expect(normalizeSectionBody(beta.body)).toContain("Updated Beta paragraph.");
      expect(normalizeSectionBody(beta.body)).toContain("- Beta bullet new 1");
      expect(normalizeSectionBody(beta.body)).toContain("- Beta bullet new 2");
      expect(normalizeSectionBody(beta.body)).not.toContain("Beta bullet 1");
      expect(normalizeSectionBody(beta.body)).not.toContain("Beta bullet 2");
    }, 30_000);

    it("F2: replace_content with oversize payload — current destructive behavior", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F2 replace_content",
        markdown: "**before-replace** sentinel",
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const validReplace = await callTool<{ deleted?: number; appended?: number; error?: string }>(
        client,
        "replace_content",
        {
          page_id: created.id,
          markdown: "Valid replacement content with [link](https://example.com/f2)",
        },
      );

      expect(validReplace.error).toBeUndefined();
      expect(validReplace.deleted).toBeGreaterThanOrEqual(1);
      expect(validReplace.appended).toBeGreaterThanOrEqual(1);

      const pageAfterValidReplace = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });

      expect(pageAfterValidReplace.error).toBeUndefined();
      assertNoWarnings(pageAfterValidReplace);
      expect(stripContentNotice(pageAfterValidReplace.markdown)).toContain(
        "Valid replacement content with [link](https://example.com/f2)",
      );

      const bigLine = "x".repeat(2050);
      const oversizePayload = `\`\`\`\n${bigLine}\n\`\`\``;

      const oversizeReplace = await callTool<{ error?: string; deleted?: number; appended?: number }>(
        client,
        "replace_content",
        {
          page_id: created.id,
          markdown: oversizePayload,
        },
      );

      expect(oversizeReplace).toEqual({
        error: F2_OVERSIZE_ERROR,
      });

      const pageAfterOversizeReplace = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });

      expect(pageAfterOversizeReplace.error).toBeUndefined();
      assertNoWarnings(pageAfterOversizeReplace);

      const strippedAfterOversize = stripContentNotice(pageAfterOversizeReplace.markdown);
      expect(strippedAfterOversize.trim()).toBe("");
      expect(strippedAfterOversize).not.toContain("Valid replacement content");
      expect(strippedAfterOversize).not.toContain("before-replace");
    }, 30_000);

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

    describe("HTTP parity", () => {
      let httpHandle: HttpHandle;

      beforeAll(async () => {
        const port = await pickEphemeralPort();
        const bearer = mintBearer();
        httpHandle = await spawnHttpServer({
          notionToken: env.token!,
          port,
          bearer,
        });

        console.error(`[e2e] HTTP server ready: ${httpHandle.url}`);
      }, 15_000);

      afterAll(async () => {
        try {
          await httpHandle?.kill();
        } catch (err) {
          console.error(`[e2e] HTTP server kill failed: ${err}`);
        }
      }, 10_000);

      it("H1: health endpoint returns the canonical shape", async () => {
        const response = await fetch(`${httpHandle.url}/`);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/json");
        await expect(response.json()).resolves.toEqual({
          status: "ok",
          server: "easy-notion-mcp",
          transport: "streamable-http",
          endpoint: "/mcp",
        });
      });

      it("H2: bearer-required security posture", async () => {
        const noAuth = await postHttpInitialize(httpHandle);
        expect(noAuth.status).toBe(401);
        expect(noAuth.headers.get("www-authenticate")).toBeTruthy();
        await expect(noAuth.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const emptyBearer = await postHttpInitialize(httpHandle, "Bearer ");
        expect(emptyBearer.status).toBe(401);
        await expect(emptyBearer.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const wrongSameLength = await postHttpInitialize(httpHandle, `Bearer ${"a".repeat(64)}`);
        expect(wrongSameLength.status).toBe(401);
        await expect(wrongSameLength.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const wrongLength = await postHttpInitialize(httpHandle, "Bearer too-short");
        expect(wrongLength.status).toBe(401);
        await expect(wrongLength.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const correctBearer = await postHttpInitialize(
          httpHandle,
          `Bearer ${httpHandle.bearer}`,
        );
        expect(correctBearer.status).toBeGreaterThanOrEqual(200);
        expect(correctBearer.status).toBeLessThan(300);

        const correctBody = await parseHttpJsonRpcResponse(correctBearer);
        expect(correctBody.error).toBeUndefined();
        expect(correctBody.result?.serverInfo?.name).toBe("easy-notion-mcp");

        const sessionId = correctBearer.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();

        const unauthGet = await fetch(`${httpHandle.url}/mcp`);
        expect(unauthGet.status).toBe(401);
        await expect(unauthGet.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const unauthDelete = await fetch(`${httpHandle.url}/mcp`, {
          method: "DELETE",
        });
        expect(unauthDelete.status).toBe(401);
        await expect(unauthDelete.json()).resolves.toEqual(
          expect.objectContaining({ error: "invalid_token" }),
        );

        const cleanup = await fetch(`${httpHandle.url}/mcp`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${httpHandle.bearer}`,
            Accept: "application/json",
            "mcp-session-id": sessionId!,
            "mcp-protocol-version": correctBody.result?.protocolVersion ?? HTTP_PROTOCOL_VERSION,
          },
        });
        expect(cleanup.status).toBe(200);
      });

      it("H3: transport parity — stdio and HTTP return the same get_me result", async () => {
        const stdioMe = await callTool<GetMeResponse>(client, "get_me", {});
        const httpMe = await callToolHttp<GetMeResponse>(httpHandle, "get_me", {});

        expect(stdioMe).toEqual(httpMe);
      });

      it("H4: HTTP mode rejects file:// URLs in create_page", async () => {
        const response = await callToolHttp<CreatePageResponse>(httpHandle, "create_page", {
          parent_page_id: ctx.sandboxId!,
          title: "H4 file scheme",
          markdown: "![x](file:///etc/passwd)",
        });

        expect(response.error).not.toMatch(/invalid_token/i);
        expect(response.error).toMatch(/file:\/\/.*only supported in stdio/i);
      });
    });
  },
);

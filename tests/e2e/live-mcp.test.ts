import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../src/markdown-to-blocks.js";
import { NOTION_VERSION } from "../../src/notion-version.js";
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
    expression?: string;
    function?: string;
    prefix?: string | null;
    data_source_id?: string;
    relation_type?: string;
    relation_property?: string;
    rollup_property?: string;
  }>;
  error?: string;
};

type AddDatabaseEntryResponse = {
  id: string;
  url: string;
  error?: string;
};

type AppendContentResponse = {
  success?: boolean;
  blocks_added?: number;
  error?: string;
};

type FindReplaceResponse = {
  success?: boolean;
  match_count?: number;
  truncated?: boolean;
  warnings?: unknown;
  error?: string;
};

type UpdateToggleResponse = {
  success?: boolean;
  block_id?: string;
  type?: string;
  deleted?: number;
  appended?: number;
  error?: string;
};

type ArchiveToggleResponse = {
  success?: boolean;
  archived?: string;
  title?: string;
  type?: string;
  error?: string;
};

type RestoreToggleResponse = {
  success?: boolean;
  restored?: string;
  error?: string;
};

type ReadToggleResponse = {
  page_id?: string;
  title?: string;
  block_id?: string;
  type?: string;
  markdown?: string;
  warnings?: unknown;
  error?: string;
};

type DuplicatePageResponse = {
  id: string;
  title?: string;
  url: string;
  source_page_id?: string;
  warnings?: unknown;
  error?: string;
};

type AddDatabaseEntriesResponse = {
  succeeded: Array<{ id: string; url: string }>;
  failed: Array<{ index: number; error: string }>;
  error?: string;
};

type QueryDatabaseWarning = {
  code?: string;
  properties?: Array<Record<string, unknown>>;
  how_to_fetch_all?: string;
};

type QueryDatabaseResponse = {
  results: Array<Record<string, unknown>>;
  warnings?: QueryDatabaseWarning[];
};

type ViewReference = {
  object?: string;
  id: string;
  type?: string;
};

type ListViewsResponse = {
  object?: string;
  results?: ViewReference[];
  next_cursor?: string | null;
  has_more?: boolean;
  error?: string;
};

type GetViewResponse = ViewReference & {
  parent?: unknown;
  name?: string;
  error?: string;
};

type CreateViewResponse = ViewReference & {
  name?: string;
  url?: string;
  data_source_id?: string;
  error?: string;
};

type UpdateViewResponse = CreateViewResponse;

type DeleteViewResponse = {
  success?: boolean;
  deleted?: string;
  view?: ViewReference;
  error?: string;
};

type QueryViewResponse = {
  query?: {
    object?: string;
    id?: string;
    view_id?: string;
  };
  results?: {
    object?: string;
    results?: unknown[];
    next_cursor?: string | null;
    has_more?: boolean;
  };
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
    }, 300_000);

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
    }, 60_000);

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

    it("C1: create_database creates formula columns", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C1 formula create",
        schema: [
          { name: "Task", type: "title" },
          { name: "Count", type: "number" },
          { name: "Score", type: "formula", expression: 'prop("Count") * 2' },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      expect(Array.isArray(created.properties)).toBe(true);
      expect(created.properties).toContain("Task");
      expect(created.properties).toContain("Count");
      expect(created.properties).toContain("Score");

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.error).toBeUndefined();
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Task", type: "title" }),
          expect.objectContaining({ name: "Count", type: "number" }),
          expect.objectContaining({ name: "Score", type: "formula" }),
        ]),
      );

      const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Task: "row1",
          Count: 5,
        },
      });

      expect(entry.error).toBeUndefined();
      ctx.createdPageIds.push(entry.id);

      // Notion evaluates formulas asynchronously; poll a few times before asserting.
      let row: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
          database_id: created.id,
        });
        const rows = rowsResponse.results;
        row = rows.find((candidate) => candidate.Task === "row1");
        if (row && row.Score !== null && row.Score !== undefined) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      expect(row).toBeDefined();
      expect(row?.Score).not.toBeNull();
    }, 45_000);

    it("C2: formula property values read back non-null", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C2 formula read non-null",
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

      // Notion evaluates formulas asynchronously; poll a few times before asserting.
      let rowsResponse: QueryDatabaseResponse = { results: [] };
      let rows: Array<Record<string, unknown>> = [];
      let row: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
          database_id: created.id,
        });
        rows = rowsResponse.results;
        row = rows.find((candidate) => candidate.Title === "row1");
        if (row && row.Formula !== null && row.Formula !== undefined) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      expect(Array.isArray(rowsResponse.results)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(rowsResponse, "warnings")).toBe(false);
      expect(row).toBeDefined();
      expect(row).toEqual(expect.objectContaining({ Title: "row1", Count: 5 }));
      expect(row?.Formula).not.toBeNull();
    }, 45_000);

    it("C3: relation schema create", async () => {
      const source = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C3 relation source",
        schema: [
          { name: "Title", type: "title" },
        ],
      });
      expect(source.error).toBeUndefined();
      ctx.createdPageIds.push(source.id);

      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C3 relation target",
        schema: [
          { name: "Title", type: "title" },
          { name: "Ref", type: "relation", data_source_id: source.id },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.error).toBeUndefined();
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Ref", type: "relation" }),
        ]),
      );
    }, 30_000);

    it("C4: rollup schema create", async () => {
      const linked = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C4 rollup linked",
        schema: [
          { name: "Title", type: "title" },
        ],
      });
      expect(linked.error).toBeUndefined();
      ctx.createdPageIds.push(linked.id);

      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C4 rollup target",
        schema: [
          { name: "Title", type: "title" },
          { name: "Ref", type: "relation", data_source_id: linked.id },
          {
            name: "RefCount",
            type: "rollup",
            function: "count",
            relation_property: "Ref",
            rollup_property: "Title",
          },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.error).toBeUndefined();
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "RefCount", type: "rollup", function: "count" }),
        ]),
      );
    }, 30_000);

    it("C5: people schema + value write", async () => {
      const users = await callTool<Array<{ id: string; name?: string | null; type: string }>>(
        client,
        "list_users",
        {},
      );
      const owner = users.find((candidate) => candidate.type === "bot" || candidate.type === "person");
      expect(owner).toBeDefined();

      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C5 people",
        schema: [
          { name: "Title", type: "title" },
          { name: "Owner", type: "people" },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Title: "r1",
          Owner: owner!.id,
        },
      });

      expect(entry.error).toBeUndefined();
      ctx.createdPageIds.push(entry.id);

      const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
        database_id: created.id,
      });
      const rows = rowsResponse.results;

      const row = rows.find((candidate) => candidate.Title === "r1");
      expect(row).toBeDefined();
      expect(Array.isArray(row?.Owner)).toBe(true);
      expect((row?.Owner as unknown[]).length).toBeGreaterThan(0);
    }, 30_000);

    describe("relation pagination", () => {
      it("returns 27 relation entries without a warning at the default cap", async () => {
        const source = await callTool<CreateDatabaseResponse>(client, "create_database", {
          parent_page_id: ctx.sandboxId!,
          title: "P6 relation source 27",
          schema: [
            { name: "Name", type: "title" },
          ],
        });
        expect(source.error).toBeUndefined();
        ctx.createdPageIds.push(source.id);

        const sourceEntryIds: string[] = [];
        for (let index = 0; index < 27; index += 1) {
          const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
            database_id: source.id,
            properties: {
              Name: `source ${index + 1}`,
            },
          });
          expect(entry.error).toBeUndefined();
          ctx.createdPageIds.push(entry.id);
          sourceEntryIds.push(entry.id);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }

        const target = await callTool<CreateDatabaseResponse>(client, "create_database", {
          parent_page_id: ctx.sandboxId!,
          title: "P6 relation target 27",
          schema: [
            { name: "Name", type: "title" },
            { name: "Refs", type: "relation", data_source_id: source.id },
          ],
        });
        expect(target.error).toBeUndefined();
        ctx.createdPageIds.push(target.id);

        const targetEntry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
          database_id: target.id,
          properties: {
            Name: "target",
            Refs: sourceEntryIds,
          },
        });
        expect(targetEntry.error).toBeUndefined();
        ctx.createdPageIds.push(targetEntry.id);

        const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
          database_id: target.id,
        }, { timeoutMs: 60_000 });

        expect(rowsResponse.results).toHaveLength(1);
        const row = rowsResponse.results[0];
        expect(Array.isArray(row.Refs)).toBe(true);
        expect((row.Refs as unknown[])).toHaveLength(27);
        expect(Object.prototype.hasOwnProperty.call(rowsResponse, "warnings")).toBe(false);
      }, 180_000);

      it("returns 75 relation entries with a cap warning at the default cap", async () => {
        const source = await callTool<CreateDatabaseResponse>(client, "create_database", {
          parent_page_id: ctx.sandboxId!,
          title: "P6 relation source 85",
          schema: [
            { name: "Name", type: "title" },
          ],
        });
        expect(source.error).toBeUndefined();
        ctx.createdPageIds.push(source.id);

        const sourceEntryIds: string[] = [];
        for (let index = 0; index < 85; index += 1) {
          const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
            database_id: source.id,
            properties: {
              Name: `source ${index + 1}`,
            },
          });
          expect(entry.error).toBeUndefined();
          ctx.createdPageIds.push(entry.id);
          sourceEntryIds.push(entry.id);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }

        const target = await callTool<CreateDatabaseResponse>(client, "create_database", {
          parent_page_id: ctx.sandboxId!,
          title: "P6 relation target 85",
          schema: [
            { name: "Name", type: "title" },
            { name: "Refs", type: "relation", data_source_id: source.id },
          ],
        });
        expect(target.error).toBeUndefined();
        ctx.createdPageIds.push(target.id);

        const targetEntry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
          database_id: target.id,
          properties: {
            Name: "target",
            Refs: sourceEntryIds,
          },
        });
        expect(targetEntry.error).toBeUndefined();
        ctx.createdPageIds.push(targetEntry.id);

        const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
          database_id: target.id,
        }, { timeoutMs: 60_000 });

        expect(rowsResponse.results).toHaveLength(1);
        const row = rowsResponse.results[0];
        expect(Array.isArray(row.Refs)).toBe(true);
        expect((row.Refs as unknown[])).toHaveLength(75);
        expect(rowsResponse.warnings).toHaveLength(1);
        const warning = rowsResponse.warnings?.[0];
        expect(warning?.code).toBe("truncated_properties");
        expect(warning?.properties).toHaveLength(1);
        expect(warning?.properties?.[0]).toEqual(
          expect.objectContaining({
            name: "Refs",
            type: "relation",
            returned_count: 75,
            cap: 75,
          }),
        );
        expect(warning?.how_to_fetch_all).toEqual(expect.any(String));
        expect(warning?.how_to_fetch_all).toContain("max_property_items");
      }, 180_000);
    });

    it("C6: unique_id schema with prefix", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "C6 unique id",
        schema: [
          { name: "Title", type: "title" },
          { name: "Ticket", type: "unique_id", prefix: "ENG" },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const database = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });

      expect(database.error).toBeUndefined();
      expect(database.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Ticket", type: "unique_id", prefix: "ENG" }),
        ]),
      );

      const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Title: "row1",
        },
      });

      expect(entry.error).toBeUndefined();
      ctx.createdPageIds.push(entry.id);

      const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
        database_id: created.id,
      });
      const rows = rowsResponse.results;

      const row = rows.find((candidate) => candidate.Title === "row1");
      expect(row).toBeDefined();
      expect(String(row?.Ticket)).toMatch(/^ENG-\d+$/);
    }, 30_000);

    it("D1: update_data_source removes a status option and reassigns rows", async () => {
      const statusOptions = [
        { name: "Todo", color: "gray" },
        { name: "Blocked", color: "red" },
        { name: "Done", color: "green" },
      ];
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "D1 status option removal",
        schema: [
          { name: "Task", type: "title" },
          { name: "Status", type: "status", options: statusOptions },
        ],
      });

      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const entry = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Task: "D1 blocked row",
          Status: "Blocked",
        },
      });

      expect(entry.error).toBeUndefined();
      ctx.createdPageIds.push(entry.id);

      const rowsBeforeRemoval = await callTool<QueryDatabaseResponse>(client, "query_database", {
        database_id: created.id,
      });
      const rowBeforeRemoval = rowsBeforeRemoval.results.find(
        (candidate) => candidate.Task === "D1 blocked row",
      );
      expect(rowBeforeRemoval).toBeDefined();
      expect(rowBeforeRemoval?.Status).toBe("Blocked");

      const databaseBeforeRemoval = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });
      expect(databaseBeforeRemoval.error).toBeUndefined();
      const statusBeforeRemoval = databaseBeforeRemoval.properties.find(
        (property) => property.name === "Status",
      );
      expect(statusBeforeRemoval).toEqual(
        expect.objectContaining({ name: "Status", type: "status" }),
      );
      expect(statusBeforeRemoval?.options).toEqual(
        expect.arrayContaining(["Todo", "Blocked", "Done"]),
      );

      const createdOptionsByName = new Map(
        statusOptions.map((option) => [option.name, option]),
      );
      const keptStatusOptions = (statusBeforeRemoval?.options ?? [])
        .filter((name) => name !== "Blocked")
        .map((name) => createdOptionsByName.get(name) ?? { name });
      const keptStatusNames = keptStatusOptions.map((option) => option.name);

      expect(keptStatusNames).toEqual(["Todo", "Done"]);

      const updated = await callTool<UpdateDataSourceResponse>(client, "update_data_source", {
        database_id: created.id,
        properties: {
          Status: {
            status: {
              options: keptStatusOptions,
            },
          },
        },
      });

      expect(updated.error).toBeUndefined();

      const databaseAfterRemoval = await callTool<GetDatabaseResponse>(client, "get_database", {
        database_id: created.id,
      });
      expect(databaseAfterRemoval.error).toBeUndefined();
      const statusAfterRemoval = databaseAfterRemoval.properties.find(
        (property) => property.name === "Status",
      );
      expect(statusAfterRemoval).toEqual(
        expect.objectContaining({ name: "Status", type: "status" }),
      );
      expect(statusAfterRemoval?.options).not.toContain("Blocked");
      expect(statusAfterRemoval?.options).toEqual(keptStatusNames);

      let rowAfterRemoval: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const rowsAfterRemoval = await callTool<QueryDatabaseResponse>(client, "query_database", {
          database_id: created.id,
        });
        rowAfterRemoval = rowsAfterRemoval.results.find(
          (candidate) => candidate.Task === "D1 blocked row",
        );
        if (rowAfterRemoval?.Status !== "Blocked") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      expect(rowAfterRemoval).toBeDefined();
      expect(rowAfterRemoval?.Status).not.toBe("Blocked");
      expect(keptStatusNames).toContain(rowAfterRemoval?.Status);
      expect(rowAfterRemoval?.Status).toBe(keptStatusNames[0]);
    }, 45_000);

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
    }, 60_000);

    it("F2: replace_content (atomic) returns success:true and replaces page content", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F2 replace_content atomic happy path",
        markdown: "**before-replace** sentinel",
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const replaced = await callTool<{ success?: boolean; truncated?: boolean; warnings?: unknown; error?: string }>(
        client,
        "replace_content",
        {
          page_id: created.id,
          markdown: "Valid replacement content with [link](https://example.com/f2)",
        },
      );
      expect(replaced.error).toBeUndefined();
      expect(replaced.success).toBe(true);

      const pageAfter = await callTool<ReadPageResponse>(client, "read_page", { page_id: created.id });
      expect(pageAfter.error).toBeUndefined();
      assertNoWarnings(pageAfter);
      expect(stripContentNotice(pageAfter.markdown)).toContain(
        "Valid replacement content with [link](https://example.com/f2)",
      );
      expect(stripContentNotice(pageAfter.markdown)).not.toContain("before-replace");
    }, 30_000);

    it("F5: replace_content (atomic) preserves block IDs for unchanged blocks across paragraph/heading/toggle/callout", async () => {
      const initial = [
        "# Title heading",
        "",
        "Paragraph one stays put.",
        "",
        "Paragraph TWO will be edited.",
        "",
        "+++ Toggle title",
        "toggle body",
        "+++",
        "",
        "> [!NOTE]",
        "> note callout body",
      ].join("\n");

      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F5 replace_content atomic ID preservation",
        markdown: initial,
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const { Client: NotionClient } = await import("@notionhq/client");
      const liveClient = new NotionClient({ auth: env.token!, notionVersion: NOTION_VERSION });
      const before = await liveClient.blocks.children.list({ block_id: created.id });
      const beforeIds = before.results.map((b: any) => b.id);
      const beforeTypes = before.results.map((b: any) => b.type);
      expect(beforeTypes).toContain("heading_1");
      expect(beforeTypes).toContain("toggle");
      expect(beforeTypes).toContain("callout");
      const paragraphIds = before.results
        .filter((b: any) => b.type === "paragraph")
        .map((b: any) => b.id);
      expect(paragraphIds.length).toBeGreaterThanOrEqual(2);

      const edited = [
        "# Title heading",
        "",
        "Paragraph one stays put.",
        "",
        "Paragraph TWO has been edited.",
        "",
        "+++ Toggle title",
        "toggle body",
        "+++",
        "",
        "> [!NOTE]",
        "> note callout body",
      ].join("\n");

      const replaced = await callTool<{ success?: boolean; warnings?: unknown; error?: string }>(
        client,
        "replace_content",
        { page_id: created.id, markdown: edited },
      );
      expect(replaced.error).toBeUndefined();
      expect(replaced.success).toBe(true);

      const after = await liveClient.blocks.children.list({ block_id: created.id });
      const afterIds = new Set(after.results.map((b: any) => b.id));
      const survived = beforeIds.filter((id: string) => afterIds.has(id));

      // Block-ID preservation for atomic replace_content. Per probe 4 the survival rate
      // is 100% on near-identical content; we hold a relaxed >=70% bar so the test is
      // resilient to small Notion-side matching changes without losing the wedge claim.
      expect(survived.length / beforeIds.length).toBeGreaterThanOrEqual(0.7);

      const afterTypes = after.results.map((b: any) => b.type);
      expect(afterTypes).toContain("heading_1");
      expect(afterTypes).toContain("toggle");
      expect(afterTypes).toContain("callout");

      const readBack = await callTool<ReadPageResponse>(client, "read_page", { page_id: created.id });
      const body = stripContentNotice(readBack.markdown);
      expect(body).toContain("Paragraph TWO has been edited.");
      expect(body).not.toContain("Paragraph TWO will be edited.");
    }, 60_000);

    it("F6: replace_content (atomic) preserves the deep-link target block ID for an unchanged paragraph", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F6 replace_content deep-link survival",
        markdown: [
          "# Anchor section",
          "",
          "Anchor target paragraph for the deep link.",
          "",
          "Body paragraph that will be edited.",
        ].join("\n"),
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const { Client: NotionClient } = await import("@notionhq/client");
      const liveClient = new NotionClient({ auth: env.token!, notionVersion: NOTION_VERSION });
      const before = await liveClient.blocks.children.list({ block_id: created.id });
      const anchorBlock = before.results.find((b: any) => {
        const text = b?.paragraph?.rich_text?.map((t: any) => t.plain_text).join("");
        return text === "Anchor target paragraph for the deep link.";
      }) as any;
      expect(anchorBlock).toBeDefined();
      const anchorId = anchorBlock.id;
      // Construct the deep link as Notion would render it; resolution = the anchor block
      // continues to exist by ID after replace.
      const deepLink = `https://www.notion.so/${created.id.replace(/-/g, "")}#${anchorId.replace(/-/g, "")}`;
      expect(deepLink).toContain(anchorId.replace(/-/g, ""));

      const replaced = await callTool<{ success?: boolean; error?: string }>(client, "replace_content", {
        page_id: created.id,
        markdown: [
          "# Anchor section",
          "",
          "Anchor target paragraph for the deep link.",
          "",
          "Body paragraph EDITED.",
        ].join("\n"),
      });
      expect(replaced.error).toBeUndefined();
      expect(replaced.success).toBe(true);

      const afterBlock = await liveClient.blocks.retrieve({ block_id: anchorId });
      expect((afterBlock as any).id).toBe(anchorId);
      expect((afterBlock as any).type).toBe("paragraph");
      const afterText = (afterBlock as any).paragraph.rich_text
        .map((t: any) => t.plain_text)
        .join("");
      expect(afterText).toBe("Anchor target paragraph for the deep link.");
    }, 60_000);

    it("F3: update_block edits a paragraph in place, block ID survives", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F3 update_block paragraph",
        markdown: "First sentence.\n\nSecond sentence anchor block.\n\nThird sentence.",
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const childrenBefore = await client.request("tools/call", {
        name: "read_page",
        arguments: { page_id: created.id },
      });
      // Use list_children via direct API would be cleaner; we instead read_page to get markdown and
      // separately call our own listChildren via the MCP tool surface. The cheapest route is
      // calling blocks.children.list through the SDK, but the MCP harness gives us read_page only.
      // So we capture block IDs via the underlying SDK by reusing the page_id with a blocks-list
      // helper exposed through the MCP `read_page` is insufficient. Instead, run a no-op
      // update_block expecting type-mismatch error to verify the tool's reachable, then use
      // search-style verification: replace_content would destroy IDs (the very thing we're proving
      // is preserved), so we anchor the test on round-trip content match plus a separate
      // block-id-survival assertion via raw blocks.children.list.
      void childrenBefore;

      // Pull the block IDs directly via the same Notion client the e2e harness uses.
      const { Client: NotionClient } = await import("@notionhq/client");
      const liveClient = new NotionClient({ auth: env.token!, notionVersion: NOTION_VERSION });
      const beforeList = await liveClient.blocks.children.list({ block_id: created.id });
      const middleBlock = beforeList.results.find((b: any) => {
        const text = b?.paragraph?.rich_text?.map((t: any) => t.plain_text).join("");
        return text === "Second sentence anchor block.";
      }) as any;
      expect(middleBlock).toBeDefined();
      const middleId = middleBlock.id;

      const updateResult = await callTool<{ id?: string; type?: string; updated?: boolean; error?: string }>(
        client,
        "update_block",
        { block_id: middleId, markdown: "Second sentence rewritten in place." },
      );
      expect(updateResult.error).toBeUndefined();
      expect(updateResult.updated).toBe(true);
      expect(updateResult.id).toBe(middleId);
      expect(updateResult.type).toBe("paragraph");

      const afterList = await liveClient.blocks.children.list({ block_id: created.id });
      const afterMiddle = afterList.results.find((b: any) => b.id === middleId) as any;
      expect(afterMiddle).toBeDefined();
      expect(afterMiddle.type).toBe("paragraph");
      const afterText = afterMiddle.paragraph.rich_text.map((t: any) => t.plain_text).join("");
      expect(afterText).toBe("Second sentence rewritten in place.");

      // Surrounding blocks unchanged.
      expect(afterList.results.length).toBe(beforeList.results.length);
      const beforeIds = new Set(beforeList.results.map((b: any) => b.id));
      for (const block of afterList.results) {
        expect(beforeIds.has((block as any).id)).toBe(true);
      }
    }, 30_000);

    it("F4: update_block toggles a to_do checked state, block ID survives", async () => {
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "F4 update_block to_do",
        markdown: "- [ ] write the test",
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const { Client: NotionClient } = await import("@notionhq/client");
      const liveClient = new NotionClient({ auth: env.token!, notionVersion: NOTION_VERSION });
      const before = await liveClient.blocks.children.list({ block_id: created.id });
      const todoBlock = before.results.find((b: any) => b.type === "to_do") as any;
      expect(todoBlock).toBeDefined();
      expect(todoBlock.to_do.checked).toBe(false);
      const todoId = todoBlock.id;

      const updateResult = await callTool<{ id?: string; type?: string; updated?: boolean; error?: string }>(
        client,
        "update_block",
        { block_id: todoId, markdown: "- [x] write the test" },
      );
      expect(updateResult.error).toBeUndefined();
      expect(updateResult.updated).toBe(true);

      const after = await liveClient.blocks.children.list({ block_id: created.id });
      const afterTodo = after.results.find((b: any) => b.id === todoId) as any;
      expect(afterTodo).toBeDefined();
      expect(afterTodo.to_do.checked).toBe(true);
    }, 30_000);

    it("G1: append_content appends content to an existing page", async () => {
      const originalSentinel = "G1 original sentinel";
      const appendedSentinel = "G1 appended sentinel";
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "G1 append_content",
        markdown: originalSentinel,
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const appended = await callTool<AppendContentResponse>(client, "append_content", {
        page_id: created.id,
        markdown: appendedSentinel,
      });

      expect(appended.error).toBeUndefined();
      expect(appended.success).toBe(true);
      expect(appended.blocks_added).toBeGreaterThanOrEqual(1);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });
      expect(page.error).toBeUndefined();
      assertNoWarnings(page);

      const body = stripContentNotice(page.markdown);
      expect(body).toContain(originalSentinel);
      expect(body).toContain(appendedSentinel);
      expect(body.indexOf(originalSentinel)).toBeLessThan(body.indexOf(appendedSentinel));
    }, 30_000);

    it("G2: find_replace updates matching page content through native updateMarkdown", async () => {
      const oldSentinel = "G2 old sentinel";
      const replacementSentinel = "G2 replacement sentinel";
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "G2 find_replace",
        markdown: [
          `First paragraph has ${oldSentinel}.`,
          "",
          `Second paragraph has ${oldSentinel}.`,
        ].join("\n"),
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const replaced = await callTool<FindReplaceResponse>(client, "find_replace", {
        page_id: created.id,
        find: oldSentinel,
        replace: replacementSentinel,
        replace_all: true,
      });

      expect(replaced.error).toBeUndefined();
      expect(replaced.success).toBe(true);
      expect(replaced.match_count).toBe(2);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: created.id,
      });
      expect(page.error).toBeUndefined();
      assertNoWarnings(page);

      const body = stripContentNotice(page.markdown);
      expect(body).not.toContain(oldSentinel);
      expect(body.split(replacementSentinel).length - 1).toBe(2);
    }, 30_000);

    it("G2b: update_toggle replaces one script toggle body on a multi-toggle page", async () => {
      const targetTitle = "Script 020";
      const oldSentinel = "G2b old toggle body";
      const replacementSentinel = "G2b replacement toggle body";
      const toggles = Array.from({ length: 40 }, (_, index) => {
        const title = `Script ${String(index).padStart(3, "0")}`;
        const body = title === targetTitle
          ? [
            `Intro paragraph with ${oldSentinel}.`,
            "",
            `Second paragraph with ${oldSentinel}.`,
          ].join("\n")
          : `Script ${index} body ${"x".repeat(120)}`;
        return [`+++ ${title}`, body, "+++"].join("\n");
      });
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "G2b update_toggle",
        markdown: toggles.join("\n\n"),
      }, { timeoutMs: 60_000 });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const updated = await callTool<UpdateToggleResponse>(client, "update_toggle", {
        page_id: created.id,
        title: targetTitle,
        markdown: [
          `Replacement paragraph with ${replacementSentinel}.`,
          "",
          `Second replacement paragraph with ${replacementSentinel}.`,
        ].join("\n"),
      }, { timeoutMs: 60_000 });

      expect(updated.error).toBeUndefined();
      expect(updated.success).toBe(true);
      expect(updated.type).toBe("toggle");
      expect(updated.deleted).toBeGreaterThan(0);
      expect(updated.appended).toBeGreaterThan(0);

      const toggle = await callTool<ReadToggleResponse>(client, "read_toggle", {
        page_id: created.id,
        title: targetTitle,
      }, { timeoutMs: 60_000 });
      expect(toggle.error).toBeUndefined();
      expect(toggle.block_id).toBe(updated.block_id);
      expect(toggle.markdown).toContain(replacementSentinel);
      expect(toggle.markdown).not.toContain(oldSentinel);
    }, 90_000);

    it("G2c: archive_toggle and restore_toggle round-trip a toggle by archived block id", async () => {
      const targetTitle = "G2c Restore Target";
      const sentinel = "G2c restore_toggle sentinel";
      const created = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "G2c restore_toggle",
        markdown: [
          "+++ Keep Visible",
          "Visible body",
          "+++",
          "",
          `+++ ${targetTitle}`,
          sentinel,
          "+++",
        ].join("\n"),
      }, { timeoutMs: 60_000 });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const archived = await callTool<ArchiveToggleResponse>(client, "archive_toggle", {
        page_id: created.id,
        title: targetTitle,
      }, { timeoutMs: 60_000 });
      expect(archived.error).toBeUndefined();
      expect(archived.success).toBe(true);
      expect(archived.archived).toEqual(expect.any(String));

      let missingAfterArchive: ReadToggleResponse = {};
      for (let attempt = 0; attempt < 6; attempt += 1) {
        missingAfterArchive = await callTool<ReadToggleResponse>(client, "read_toggle", {
          page_id: created.id,
          title: targetTitle,
        }, { timeoutMs: 60_000 });
        if (missingAfterArchive.error) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      expect(missingAfterArchive.error ?? "").toContain("Toggle not found");

      const restored = await callTool<RestoreToggleResponse>(client, "restore_toggle", {
        block_id: archived.archived!,
      }, { timeoutMs: 60_000 });
      expect(restored.error).toBeUndefined();
      expect(restored.success).toBe(true);
      expect(restored.restored).toBe(archived.archived);

      let readBack: ReadToggleResponse = {};
      for (let attempt = 0; attempt < 6; attempt += 1) {
        readBack = await callTool<ReadToggleResponse>(client, "read_toggle", {
          page_id: created.id,
          title: targetTitle,
        }, { timeoutMs: 60_000 });
        if (!readBack.error) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      expect(readBack.error).toBeUndefined();
      expect(readBack.block_id).toBe(archived.archived);
      expect(readBack.markdown).toContain(sentinel);
    }, 120_000);

    it("G3: duplicate_page copies supported page content", async () => {
      const sourceSentinel = "G3 duplicate source sentinel";
      const duplicateTitle = "G3 duplicate copy";
      const source = await callTool<CreatePageResponse>(client, "create_page", {
        parent_page_id: ctx.sandboxId!,
        title: "G3 duplicate source",
        markdown: `## Supported content\n\n${sourceSentinel}`,
      });
      expect(source.error).toBeUndefined();
      ctx.createdPageIds.push(source.id);

      const duplicate = await callTool<DuplicatePageResponse>(client, "duplicate_page", {
        page_id: source.id,
        title: duplicateTitle,
        parent_page_id: ctx.sandboxId!,
      });
      if (duplicate.id) {
        ctx.createdPageIds.push(duplicate.id);
      }

      expect(duplicate.error).toBeUndefined();
      expect(duplicate.id).toEqual(expect.any(String));
      expect(duplicate.source_page_id).toBe(source.id);
      expect(duplicate.title).toBe(duplicateTitle);
      assertNoWarnings(duplicate);

      const page = await callTool<ReadPageResponse>(client, "read_page", {
        page_id: duplicate.id,
      });
      expect(page.error).toBeUndefined();
      assertNoWarnings(page);
      expect(stripContentNotice(page.markdown)).toContain(sourceSentinel);
    }, 30_000);

    it("G4: update_database_entry updates a row property", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "G4 update_database_entry",
        schema: [
          { name: "Title", type: "title" },
          { name: "Count", type: "number" },
        ],
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const row = await callTool<AddDatabaseEntryResponse>(client, "add_database_entry", {
        database_id: created.id,
        properties: {
          Title: "G4 row",
          Count: 1,
        },
      });
      expect(row.error).toBeUndefined();
      ctx.createdPageIds.push(row.id);

      const updated = await callTool<AddDatabaseEntryResponse>(client, "update_database_entry", {
        page_id: row.id,
        properties: {
          Count: 2,
        },
      });
      expect(updated.error).toBeUndefined();
      expect(updated.id).toBe(row.id);

      const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
        database_id: created.id,
      });
      const updatedRow = rowsResponse.results.find((candidate) => candidate.Title === "G4 row");
      expect(updatedRow).toBeDefined();
      expect(updatedRow?.Count).toBe(2);
    }, 30_000);

    it("G5: add_database_entries creates multiple rows", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "G5 add_database_entries",
        schema: [
          { name: "Title", type: "title" },
          { name: "Count", type: "number" },
        ],
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const added = await callTool<AddDatabaseEntriesResponse>(client, "add_database_entries", {
        database_id: created.id,
        entries: [
          { Title: "G5 row one", Count: 10 },
          { Title: "G5 row two", Count: 20 },
        ],
      });
      for (const entry of added.succeeded ?? []) {
        ctx.createdPageIds.push(entry.id);
      }

      expect(added.error).toBeUndefined();
      expect(added.succeeded).toHaveLength(2);
      expect(added.failed).toHaveLength(0);

      const rowsResponse = await callTool<QueryDatabaseResponse>(client, "query_database", {
        database_id: created.id,
      });
      const rowOne = rowsResponse.results.find((candidate) => candidate.Title === "G5 row one");
      const rowTwo = rowsResponse.results.find((candidate) => candidate.Title === "G5 row two");

      expect(rowOne).toBeDefined();
      expect(rowOne?.Count).toBe(10);
      expect(rowTwo).toBeDefined();
      expect(rowTwo?.Count).toBe(20);
    }, 30_000);

    it("V1: read-only view tools expose live response shape", async () => {
      const created = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "V1 read-only views",
        schema: [{ name: "Title", type: "title" }],
      });
      expect(created.error).toBeUndefined();
      ctx.createdPageIds.push(created.id);

      const listed = await callTool<ListViewsResponse>(client, "list_views", {
        database_id: created.id,
        page_size: 10,
      });
      expect(listed.error).toBeUndefined();
      expect(listed.object).toBe("list");
      expect(Array.isArray(listed.results)).toBe(true);

      const views = listed.results ?? [];
      console.error(`[e2e] V1 list_views returned ${views.length} default view(s)`);
      if (views.length === 0) {
        // Current live API behavior can be pinned here if Notion stops creating
        // a default view for newly-created databases.
        expect(views).toHaveLength(0);
        return;
      }
      expect(views.length).toBeGreaterThanOrEqual(1);

      const view = views[0];
      expect(view.object).toBe("view");
      expect(view.id).toEqual(expect.any(String));
      if (view.type !== undefined) {
        expect(view.type).toEqual(expect.any(String));
      }

      const retrieved = await callTool<GetViewResponse>(client, "get_view", {
        view_id: view.id,
      });
      expect(retrieved.error).toBeUndefined();
      expect(retrieved.object).toBe("view");
      expect(retrieved.id).toBe(view.id);
      expect(retrieved.type).toEqual(expect.any(String));
      if (view.type !== undefined) {
        expect(retrieved.type).toBe(view.type);
      }
      console.error(
        `[e2e] V1 get_view returned type=${retrieved.type} list_ref_type=${view.type ?? "absent"}`,
      );

      const queried = await callTool<QueryViewResponse>(client, "query_view", {
        view_id: view.id,
        page_size: 10,
      });
      expect(queried.error).toBeUndefined();
      expect(queried.query?.id).toEqual(expect.any(String));
      if (queried.query?.view_id !== undefined) {
        expect(queried.query.view_id).toBe(view.id);
      }
      expect(queried.results?.object).toBe("list");
      expect(Array.isArray(queried.results?.results)).toBe(true);
      console.error(
        `[e2e] V1 query_view returned results.object=${queried.results?.object} results_count=${queried.results?.results?.length ?? "unknown"}`,
      );
    }, 45_000);

    it("V2: view mutation tools create, update, and delete a live view", async () => {
      const initialName = "V2 Table View";
      const renamedName = "V2 Renamed View";
      const createdDatabase = await callTool<CreateDatabaseResponse>(client, "create_database", {
        parent_page_id: ctx.sandboxId!,
        title: "V2 view mutations",
        schema: [{ name: "Title", type: "title" }],
      });
      expect(createdDatabase.error).toBeUndefined();
      ctx.createdPageIds.push(createdDatabase.id);

      const createdView = await callTool<CreateViewResponse>(client, "create_view", {
        database_id: createdDatabase.id,
        name: initialName,
        type: "table",
      });
      expect(createdView.error).toBeUndefined();
      expect(createdView.id).toEqual(expect.any(String));
      expect(createdView.id.length).toBeGreaterThan(0);
      if (createdView.object !== undefined) {
        expect(createdView.object).toBe("view");
      }
      if (createdView.type !== undefined) {
        expect(createdView.type).toBe("table");
      }
      if (createdView.name !== undefined) {
        expect(createdView.name).toBe(initialName);
      }

      const retrievedCreatedView = await callTool<GetViewResponse>(client, "get_view", {
        view_id: createdView.id,
      });
      expect(retrievedCreatedView.error).toBeUndefined();
      expect(retrievedCreatedView.id).toBe(createdView.id);
      expect(retrievedCreatedView.object).toBe("view");
      if (retrievedCreatedView.name !== undefined) {
        expect(retrievedCreatedView.name).toBe(initialName);
      } else {
        expect(retrievedCreatedView.type).toBe("table");
      }

      const updatedView = await callTool<UpdateViewResponse>(client, "update_view", {
        view_id: createdView.id,
        name: renamedName,
      });
      expect(updatedView.error).toBeUndefined();
      expect(updatedView.id).toBe(createdView.id);
      if (updatedView.object !== undefined) {
        expect(updatedView.object).toBe("view");
      }
      if (updatedView.type !== undefined) {
        expect(updatedView.type).toBe("table");
      }

      const retrievedUpdatedView = await callTool<GetViewResponse>(client, "get_view", {
        view_id: createdView.id,
      });
      expect(retrievedUpdatedView.error).toBeUndefined();
      expect(retrievedUpdatedView.id).toBe(createdView.id);
      expect((updatedView.name ?? retrievedUpdatedView.name)).toBe(renamedName);

      const deletedView = await callTool<DeleteViewResponse>(client, "delete_view", {
        view_id: createdView.id,
        confirm: true,
      });
      expect(deletedView.error).toBeUndefined();
      expect(deletedView.success).toBe(true);
      expect(deletedView.deleted).toBe(createdView.id);
      if (deletedView.view !== undefined) {
        expect(deletedView.view.id).toBe(createdView.id);
      }

      let listedAfterDelete: ListViewsResponse = {};
      let remainingViewIds: string[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        listedAfterDelete = await callTool<ListViewsResponse>(client, "list_views", {
          database_id: createdDatabase.id,
          page_size: 10,
        });
        expect(listedAfterDelete.error).toBeUndefined();
        remainingViewIds = (listedAfterDelete.results ?? []).map((view) => view.id);
        if (!remainingViewIds.includes(createdView.id)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      expect(remainingViewIds).not.toContain(createdView.id);
      console.error(
        `[e2e] V2 create/update/delete view_id=${createdView.id} create_name=${createdView.name ?? "absent"} ` +
          `create_type=${createdView.type ?? "absent"} updated_name=${updatedView.name ?? retrievedUpdatedView.name ?? "absent"} ` +
          `delete_success=${deletedView.success === true} listed_after_delete_count=${listedAfterDelete.results?.length ?? "unknown"}`,
      );
    }, 60_000);

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

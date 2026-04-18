#!/usr/bin/env -S npx tsx
/**
 * PR 2 runtime probe — five scenarios per plan § 5.2.
 *
 * Drives the built MCP server (`dist/index.js`) via stdio against real Notion.
 * Run against `public/dev` (pre-fix) and the PR 2 branch (post-fix); paste
 * both outputs side-by-side into the PR description.
 *
 * Env vars:
 *   NOTION_TOKEN              — required
 *   NOTION_ROOT_PAGE_ID       — required; parent under which all probe pages
 *                               are created, then archived at the end.
 *   PR2_PROBE_TARGET_DIR      — optional, defaults to cwd. Used to point at a
 *                               different checkout (e.g., a dev worktree).
 *   PR2_PROBE_LABEL           — optional label embedded in output.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TARGET_DIR = path.resolve(process.env.PR2_PROBE_TARGET_DIR ?? process.cwd());
const LABEL = process.env.PR2_PROBE_LABEL ?? path.basename(TARGET_DIR);
const OUT_DIR = path.resolve(".meta/runtime-evidence");
mkdirSync(OUT_DIR, { recursive: true });

const envFile = path.join(TARGET_DIR, ".env");
let envFileContents = "";
try {
  envFileContents = readFileSync(envFile, "utf8");
} catch {
  throw new Error(`Missing .env in target dir: ${envFile}`);
}

const envFromFile = Object.fromEntries(
  envFileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? envFromFile.NOTION_TOKEN;
const NOTION_ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID ?? envFromFile.NOTION_ROOT_PAGE_ID;
if (!NOTION_TOKEN || !NOTION_ROOT_PAGE_ID) {
  throw new Error("Need NOTION_TOKEN and NOTION_ROOT_PAGE_ID in .env");
}

type ScenarioResult = { name: string; detail: Record<string, any> };
const results: ScenarioResult[] = [];

const stripNoise = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripNoise);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (["id", "url", "source_page_id"].includes(k) && typeof v === "string") {
        out[k] = v.length > 30 ? v.slice(0, 12) + "…" : v;
      } else {
        out[k] = stripNoise(v);
      }
    }
    return out;
  }
  return obj;
};

function parseText(result: any): any {
  const text = result?.content?.find((c: any) => c.type === "text")?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: TARGET_DIR,
    env: {
      ...process.env,
      NOTION_TOKEN,
      NOTION_ROOT_PAGE_ID,
    },
  });
  const client = new McpClient(
    { name: "pr2-probe", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  console.error(`[probe:${LABEL}] connected`);

  // --- parent page -------------------------------------------------------
  const parentResp = parseText(
    await client.callTool({
      name: "create_page",
      arguments: {
        title: "pr2-builder-test-pages-2026-04-18",
        markdown: "Probe parent; archived at end of run.",
        parent_page_id: NOTION_ROOT_PAGE_ID,
      },
    }),
  );
  const parentId = parentResp.id as string;
  console.error(`[probe:${LABEL}] parent page: ${parentId} ${parentResp.url}`);

  try {
    // ---- Scenario A: G-4a unknown key ----------------------------------
    {
      const dbA = parseText(
        await client.callTool({
          name: "create_database",
          arguments: {
            title: "pr2-A",
            parent_page_id: parentId,
            schema: [
              { name: "Name", type: "title" },
              { name: "Status", type: "select" },
              { name: "Priority", type: "select" },
            ],
          },
        }),
      );
      const addResult = parseText(
        await client.callTool({
          name: "add_database_entry",
          arguments: {
            database_id: dbA.id,
            properties: { Name: "Test A", Statusx: "Todo" },
          },
        }),
      );
      const query = parseText(
        await client.callTool({
          name: "query_database",
          arguments: { database_id: dbA.id },
        }),
      );
      results.push({
        name: "A — G-4a unknown key",
        detail: {
          create_database: stripNoise(dbA),
          add_database_entry: stripNoise(addResult),
          query_database_row_count: Array.isArray(query) ? query.length : "error",
          row_samples: Array.isArray(query) ? query.map(stripNoise).slice(0, 2) : query,
        },
      });
    }

    // ---- Scenario B: G-4b relation --------------------------------------
    {
      const dbB = parseText(
        await client.callTool({
          name: "create_database",
          arguments: {
            title: "pr2-B",
            parent_page_id: parentId,
            schema: [{ name: "Name", type: "title" }],
          },
        }),
      );
      const getDb = parseText(
        await client.callTool({ name: "get_database", arguments: { database_id: dbB.id } }),
      );
      // Notion API returns database_id as the "database" — we need the data_source id.
      // The update_data_source handler resolves it internally via getDataSourceId.
      // For relation, Notion needs a data_source_id target; we self-reference.
      // We use the database_id; the tool's internal resolution handles the mapping.
      const updateDs = parseText(
        await client.callTool({
          name: "update_data_source",
          arguments: {
            database_id: dbB.id,
            properties: {
              Ref: {
                relation: {
                  data_source_id: await resolveDataSourceId(dbB.id),
                  single_property: {},
                },
              },
            },
          },
        }),
      );
      const target = parseText(
        await client.callTool({
          name: "add_database_entry",
          arguments: {
            database_id: dbB.id,
            properties: { Name: "Target" },
          },
        }),
      );
      const source = parseText(
        await client.callTool({
          name: "add_database_entry",
          arguments: {
            database_id: dbB.id,
            properties: { Name: "Source", Ref: target.id },
          },
        }),
      );
      const query = parseText(
        await client.callTool({
          name: "query_database",
          arguments: { database_id: dbB.id },
        }),
      );
      results.push({
        name: "B — G-4b relation write",
        detail: {
          create_database: stripNoise(dbB),
          update_data_source_Ref: stripNoise(updateDs),
          add_entry_Target: stripNoise(target),
          add_entry_Source_with_Ref: stripNoise(source),
          query_database_row_count: Array.isArray(query) ? query.length : "error",
          row_samples: Array.isArray(query) ? query.map(stripNoise) : query,
        },
      });
    }

    // ---- Scenario C: G-4c response fidelity ----------------------------
    {
      const dbC = parseText(
        await client.callTool({
          name: "create_database",
          arguments: {
            title: "pr2-C",
            parent_page_id: parentId,
            schema: [
              { name: "Title", type: "title" },
              { name: "Owner", type: "people" },
            ],
          },
        }),
      );
      const getDbC = parseText(
        await client.callTool({ name: "get_database", arguments: { database_id: dbC.id } }),
      );
      results.push({
        name: "C — G-4c create_database response fidelity",
        detail: {
          create_database_response: stripNoise(dbC),
          get_database_confirms_actual: stripNoise(getDbC),
        },
      });
    }

    // ---- Scenario D: G-3b omitted-block warnings -----------------------
    {
      const Dparent = parseText(
        await client.callTool({
          name: "create_page",
          arguments: {
            title: "D-parent",
            markdown: "# Hello\n\nparagraph",
            parent_page_id: parentId,
          },
        }),
      );
      await client.callTool({
        name: "create_page",
        arguments: {
          title: "D-child",
          markdown: "child",
          parent_page_id: Dparent.id,
        },
      });
      const readResult = parseText(
        await client.callTool({
          name: "read_page",
          arguments: { page_id: Dparent.id },
        }),
      );
      const duplicateResult = parseText(
        await client.callTool({
          name: "duplicate_page",
          arguments: { page_id: Dparent.id, parent_page_id: parentId },
        }),
      );
      results.push({
        name: "D — G-3b omitted-block warnings",
        detail: {
          read_page: {
            has_warnings_field: "warnings" in readResult,
            warnings: readResult.warnings,
            markdown_snippet: typeof readResult.markdown === "string"
              ? readResult.markdown.slice(0, 200)
              : readResult.markdown,
          },
          duplicate_page: {
            has_warnings_field: "warnings" in duplicateResult,
            warnings: duplicateResult.warnings,
          },
        },
      });
    }

    // ---- Scenario E: G-3a descriptions -----------------------------------
    {
      const { tools } = await client.listTools();
      const interesting = ["replace_content", "update_section", "read_page", "duplicate_page"];
      const descriptions: Record<string, any> = {};
      for (const tool of tools) {
        if (!interesting.includes(tool.name)) continue;
        const d = tool.description ?? "";
        descriptions[tool.name] = {
          has_DESTRUCTIVE: /DESTRUCTIVE/.test(d),
          has_no_rollback: /no rollback/i.test(d),
          has_duplicate_page: /duplicate_page/i.test(d),
          has_warnings: /warnings/i.test(d),
          first_line: d.split("\n")[0].slice(0, 200),
        };
      }
      results.push({
        name: "E — G-3a tool descriptions",
        detail: descriptions,
      });
    }
  } finally {
    // ---- cleanup ---------------------------------------------------------
    await client.callTool({
      name: "archive_page",
      arguments: { page_id: parentId },
    });
    console.error(`[probe:${LABEL}] archived parent ${parentId}`);
    await client.close();
  }

  const outPath = path.join(OUT_DIR, `probe-${LABEL}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        label: LABEL,
        target_dir: TARGET_DIR,
        parent_page_id: parentId,
        parent_url: parentResp.url,
        scenarios: results,
      },
      null,
      2,
    ) + "\n",
  );
  console.error(`[probe:${LABEL}] wrote ${outPath}`);

  /**
   * Helper: resolve a database's primary data_source_id by peeking at its
   * raw Notion shape. We do this via the Notion SDK rather than a tool so
   * the probe can construct a self-referential relation schema.
   */
  async function resolveDataSourceId(databaseId: string): Promise<string> {
    const { Client } = await import("@notionhq/client");
    const c = new Client({ auth: NOTION_TOKEN, notionVersion: "2025-09-03" });
    const db = (await c.databases.retrieve({ database_id: databaseId })) as any;
    return db.data_sources?.[0]?.id as string;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";

type Raw = Record<string, any> & { id: string; type: string; has_children?: boolean };

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return JSON.parse(text) as any;
}

function richText(text: string) {
  return [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
}

function heading(id: string, type: "heading_1" | "heading_2" | "heading_3", text: string, isToggleable = false): Raw {
  return { id, type, [type]: { rich_text: richText(text), is_toggleable: isToggleable }, has_children: isToggleable };
}

function paragraph(id: string, text: string, hasChildren = false): Raw {
  return { id, type: "paragraph", paragraph: { rich_text: richText(text) }, has_children: hasChildren };
}

function toggle(id: string, text: string, hasChildren = true): Raw {
  return { id, type: "toggle", toggle: { rich_text: richText(text) }, has_children: hasChildren };
}

function callout(id: string, text: string, hasChildren = true): Raw {
  return {
    id,
    type: "callout",
    callout: { rich_text: richText(text), icon: { type: "emoji", emoji: "\u{1F4A1}" } },
    has_children: hasChildren,
  };
}

function columnList(id: string): Raw {
  return {
    id,
    type: "column_list",
    column_list: {},
    has_children: true,
  };
}

function column(id: string): Raw {
  return {
    id,
    type: "column",
    column: {},
    has_children: true,
  };
}

function unsupported(id: string, type = "synced_block"): Raw {
  return { id, type, [type]: {}, has_children: false };
}

function makeNotion(tree: Record<string, Raw[]>, retrieve: Record<string, Raw> = {}) {
  return {
    blocks: {
      retrieve: vi.fn(async ({ block_id }: any) => {
        const block = retrieve[block_id] ?? Object.values(tree).flat().find((candidate) => candidate.id === block_id);
        if (!block) throw new Error(`missing block ${block_id}`);
        return block;
      }),
      children: {
        list: vi.fn(async ({ block_id }: any) => ({
          results: tree[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        })),
        append: vi.fn(),
      },
      update: vi.fn(),
      delete: vi.fn(),
    },
    pages: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn(), updateMarkdown: vi.fn() },
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "read-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return {
    client,
    async close() {
      await Promise.all([a.close(), b.close()]);
    },
  };
}

describe("targeted read tools", () => {
  it("read_section mirrors update_section H2 boundaries and fetches nested children only for the selected slice", async () => {
    const tree = {
      "page-1": [
        paragraph("intro", "Intro"),
        heading("h2-target", "heading_2", "Target"),
        paragraph("body", "Body"),
        heading("h3-child", "heading_3", "Nested"),
        toggle("toggle-1", "Details"),
        heading("h2-next", "heading_2", "Next"),
        paragraph("after", "After"),
      ],
      "toggle-1": [paragraph("toggle-child", "Hidden")],
      "h2-next": [paragraph("next-child", "Should not fetch")],
    };
    const notion = makeNotion(tree);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_section",
        arguments: { page_id: "page-1", heading: " target " },
      }));

      expect(response).toMatchObject({
        page_id: "page-1",
        heading: "Target",
        block_id: "h2-target",
        type: "heading_2",
      });
      expect(response.markdown).toContain("## Target");
      expect(response.markdown).toContain("### Nested");
      expect(response.markdown).toContain("+++ Details\nHidden\n+++");
      expect(response.markdown).not.toContain("## Next");
      expect(notion.blocks.children.list).toHaveBeenCalledWith(expect.objectContaining({ block_id: "toggle-1" }));
      expect(notion.blocks.children.list).not.toHaveBeenCalledWith(expect.objectContaining({ block_id: "h2-next" }));
    } finally {
      await close();
    }
  });

  it("read_section returns available top-level headings when the heading is missing", async () => {
    const { client, close } = await connect(makeNotion({
      "page-1": [
        heading("h1", "heading_1", "Overview"),
        heading("h2", "heading_2", "Details"),
      ],
    }));

    try {
      const response = parseToolText(await client.callTool({
        name: "read_section",
        arguments: { page_id: "page-1", heading: "Missing" },
      }));

      expect(response.error).toBe(`Heading not found: 'Missing'. Available headings: ["Overview","Details"]`);
      expect(response.available_headings).toEqual(["Overview", "Details"]);
    } finally {
      await close();
    }
  });

  it("read_block recursively renders toggle, callout, and structural container blocks", async () => {
    const tree = {
      "toggle-1": [paragraph("toggle-child", "Hidden")],
      "callout-1": [paragraph("callout-child", "Inside callout")],
      "columns-1": [column("column-1")],
      "column-1": [paragraph("column-child", "Inside column")],
    };
    const retrieve = {
      "toggle-1": toggle("toggle-1", "Toggle root"),
      "callout-1": callout("callout-1", "Callout root"),
      "columns-1": columnList("columns-1"),
    };
    const notion = makeNotion(tree, retrieve);
    const { client, close } = await connect(notion);

    try {
      const toggleResponse = parseToolText(await client.callTool({
        name: "read_block",
        arguments: { block_id: "toggle-1" },
      }));
      expect(toggleResponse.markdown).toContain("+++ Toggle root\nHidden\n+++");

      const calloutResponse = parseToolText(await client.callTool({
        name: "read_block",
        arguments: { block_id: "callout-1" },
      }));
      expect(calloutResponse.markdown).toContain("> [!NOTE]");
      expect(calloutResponse.markdown).toContain("Inside callout");

      const containerResponse = parseToolText(await client.callTool({
        name: "read_block",
        arguments: { block_id: "columns-1" },
      }));
      expect(containerResponse.markdown).toContain("::: columns");
      expect(containerResponse.markdown).toContain("Inside column");
    } finally {
      await close();
    }
  });

  it("read_block returns a clear error for unsupported root block types", async () => {
    const { client, close } = await connect(makeNotion({}, {
      "db-1": unsupported("db-1", "child_database"),
    }));

    try {
      const response = parseToolText(await client.callTool({
        name: "read_block",
        arguments: { block_id: "db-1" },
      }));

      expect(response).toEqual({
        error: "read_block: block type 'child_database' is not supported for markdown rendering.",
        id: "db-1",
        type: "child_database",
      });
    } finally {
      await close();
    }
  });

  it("read_toggle searches recursively and matches toggleable headings", async () => {
    const tree = {
      "page-1": [paragraph("parent", "Parent", true), heading("h2-toggle", "heading_2", "Heading Toggle", true)],
      parent: [toggle("nested-toggle", "Nested Toggle")],
      "nested-toggle": [paragraph("nested-child", "Nested body")],
      "h2-toggle": [paragraph("heading-child", "Heading body")],
    };
    const { client, close } = await connect(makeNotion(tree));

    try {
      const nested = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "page-1", title: " nested toggle " },
      }));
      expect(nested).toMatchObject({ block_id: "nested-toggle", type: "toggle", title: "Nested Toggle" });
      expect(nested.markdown).toContain("Nested body");

      const headingToggle = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "page-1", title: "heading toggle" },
      }));
      expect(headingToggle).toMatchObject({ block_id: "h2-toggle", type: "heading_2", title: "Heading Toggle" });
      expect(headingToggle.markdown).toContain("+++ ## Heading Toggle\nHeading body\n+++");
    } finally {
      await close();
    }
  });

  it("read_toggle scans sibling titles before fetching toggle bodies", async () => {
    const tree = {
      "page-1": [
        toggle("first-script", "First Script"),
        toggle("target-script", "Target Script"),
      ],
      "first-script": [paragraph("first-body", "Should not fetch")],
      "target-script": [paragraph("target-body", "Target body")],
    };
    const notion = makeNotion(tree);
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "page-1", title: "target script" },
      }));

      expect(response).toMatchObject({ block_id: "target-script", type: "toggle", title: "Target Script" });
      expect(response.markdown).toContain("Target body");
      expect(notion.blocks.children.list).not.toHaveBeenCalledWith(expect.objectContaining({ block_id: "first-script" }));
    } finally {
      await close();
    }
  });

  it("read_toggle returns available titles on miss and propagates unsupported nested-block warnings", async () => {
    const tree = {
      "page-1": [toggle("toggle-1", "Available")],
      "toggle-1": [unsupported("sync-1")],
    };
    const { client, close } = await connect(makeNotion(tree));

    try {
      const missing = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "page-1", title: "Missing" },
      }));
      expect(missing.error).toBe(`Toggle not found: 'Missing'. Available toggles: ["Available"]`);
      expect(missing.available_toggles).toEqual(["Available"]);

      const found = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "page-1", title: "available" },
      }));
      expect(found.warnings).toEqual([{
        code: "omitted_block_types",
        blocks: [{ id: "sync-1", type: "synced_block" }],
      }]);
    } finally {
      await close();
    }
  });
});

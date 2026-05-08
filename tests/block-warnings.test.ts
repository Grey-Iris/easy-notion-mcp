import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";
import { SUPPORTED_BLOCK_TYPES } from "../src/server.js";

type Raw = Record<string, any> & { id: string; type: string; has_children?: boolean };

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return text;
}

/**
 * Build a mock `notion` client whose `blocks.children.list` walks a tree map
 * keyed by block_id. Every other SDK surface is a stub.
 */
function makeNotion(
  tree: Record<string, Raw[]>,
  page: Record<string, any> = {},
  blocks: Record<string, Raw> = {},
) {
  const byId: Record<string, Raw> = { ...blocks };
  for (const rawBlocks of Object.values(tree)) {
    for (const raw of rawBlocks) {
      byId[raw.id] = raw;
    }
  }

  return {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => ({
        id: page_id,
        url: `https://notion.so/${page_id}`,
        properties: { title: { type: "title", title: [{ plain_text: "Test page" }] } },
        parent: { type: "page_id", page_id: "parent-page-id" },
        ...page,
      })),
      create: vi.fn(async ({ parent, ...rest }: any) => ({
        id: "new-page-id",
        url: "https://notion.so/new-page-id",
        ...rest,
      })),
      update: vi.fn(),
    },
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }: any) => ({
          results: tree[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        })),
        append: vi.fn(),
      },
      retrieve: vi.fn(async ({ block_id }: any) => {
        const block = byId[block_id];
        if (!block) throw new Error(`missing mock block ${block_id}`);
        return block;
      }),
      delete: vi.fn(),
    },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

async function connect(notion: any) {
  const server = createServer(() => notion, {});
  const client = new McpClient(
    { name: "block-warnings-test", version: "1.0.0" },
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

// --- raw-block builders ----------------------------------------------------

function rt(content: string) {
  return [{ type: "text", text: { content }, plain_text: content }];
}
function para(id: string): Raw {
  return { id, type: "paragraph", paragraph: { rich_text: [] }, has_children: false };
}
function paraText(id: string, content: string, has_children = false): Raw {
  return { id, type: "paragraph", paragraph: { rich_text: rt(content) }, has_children };
}
function toggleText(id: string, content: string, has_children = false): Raw {
  return { id, type: "toggle", toggle: { rich_text: rt(content) }, has_children };
}
function transcription(id: string, children: Record<string, string | undefined>, has_children = false): Raw {
  return {
    id,
    type: "transcription",
    transcription: { title: rt("Team Sync"), status: "notes_ready", children },
    has_children,
  };
}
function meetingNotes(id: string, children: Record<string, string | undefined>, has_children = false): Raw {
  return {
    id,
    type: "meeting_notes",
    meeting_notes: { title: rt("Planning"), status: "notes_ready", children },
    has_children,
  };
}
function heading1(id: string): Raw {
  return { id, type: "heading_1", heading_1: { rich_text: [] }, has_children: false };
}
function bulleted(id: string): Raw {
  return { id, type: "bulleted_list_item", bulleted_list_item: { rich_text: [] }, has_children: false };
}
function syncedBlock(id: string): Raw {
  return { id, type: "synced_block", synced_block: { synced_from: null }, has_children: false };
}
function linkToPage(id: string): Raw {
  return { id, type: "link_to_page", link_to_page: { type: "page_id", page_id: "some-page" }, has_children: false };
}
function childDatabase(id: string): Raw {
  return { id, type: "child_database", child_database: { title: "db" }, has_children: false };
}
function childPage(id: string): Raw {
  return { id, type: "child_page", child_page: { title: "sub" }, has_children: false };
}
function malformedImage(id: string): Raw {
  return { id, type: "image", image: {}, has_children: false };
}
function paraWithChildren(id: string): Raw {
  return { id, type: "paragraph", paragraph: { rich_text: [] }, has_children: true };
}

function extractResponse(text: string): any {
  return JSON.parse(text);
}

describe("Block-warnings on read_page and duplicate_page (G-3b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G3b-1: read_page with only supported blocks — no warnings field", async () => {
    const tree: Record<string, Raw[]> = {
      "page-1": [para("b1"), heading1("b2"), bulleted("b3")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-1" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("G3b-2: read_page with one synced_block — warnings contains it", async () => {
    const tree: Record<string, Raw[]> = {
      "page-2": [para("b1"), syncedBlock("sync-1")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-2" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toEqual([
        { code: "omitted_block_types", blocks: [{ id: "sync-1", type: "synced_block" }] },
      ]);
    } finally {
      await close();
    }
  });

  it("G3b-3: read_page with synced_block + link_to_page + child_database — all three omitted", async () => {
    const tree: Record<string, Raw[]> = {
      "page-3": [syncedBlock("sync-1"), linkToPage("link-1"), childDatabase("cdb-1")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-3" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toHaveLength(1);
      const warning = response.warnings[0];
      expect(warning.code).toBe("omitted_block_types");
      expect(warning.blocks).toEqual([
        { id: "sync-1", type: "synced_block" },
        { id: "link-1", type: "link_to_page" },
        { id: "cdb-1", type: "child_database" },
      ]);
    } finally {
      await close();
    }
  });

  it("G3b-4: read_page where recursive child fetch yields an unsupported type — ctx flows through recursion", async () => {
    const tree: Record<string, Raw[]> = {
      "page-4": [paraWithChildren("p-parent")],
      "p-parent": [syncedBlock("sync-child")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-4" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0].blocks).toEqual([{ id: "sync-child", type: "synced_block" }]);
    } finally {
      await close();
    }
  });

  it("G3b-5: duplicate_page where source has a child_page — warnings include it; duplicate still lacks it", async () => {
    const tree: Record<string, Raw[]> = {
      "page-5": [para("b1"), childPage("cp-1")],
    };
    const notion = makeNotion(tree, {});
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({ name: "duplicate_page", arguments: { page_id: "page-5" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0]).toEqual({
        code: "omitted_block_types",
        blocks: [{ id: "cp-1", type: "child_page" }],
      });
      // The new page's block list should not include a child_page block.
      expect(notion.pages.create).toHaveBeenCalled();
      const createCall = notion.pages.create.mock.calls[0][0];
      const createdBlockTypes = (createCall.children ?? []).map((b: any) => b.type);
      expect(createdBlockTypes).not.toContain("child_page");
    } finally {
      await close();
    }
  });

  it("G3b-6: max_blocks=5, 6th raw is synced_block but cap fires first — no warning (not examined)", async () => {
    const tree: Record<string, Raw[]> = {
      "page-6": [para("b1"), para("b2"), para("b3"), para("b4"), para("b5"), syncedBlock("sync-6")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({
        name: "read_page",
        arguments: { page_id: "page-6", max_blocks: 5 },
      });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toBeUndefined();
      expect(response.has_more).toBe(true);
    } finally {
      await close();
    }
  });

  it("G3b-7: max_blocks=5, 2nd raw is synced_block within the examined window — warning includes it", async () => {
    const tree: Record<string, Raw[]> = {
      "page-7": [para("b1"), syncedBlock("sync-2"), para("b3"), para("b4"), para("b5"), para("b6")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({
        name: "read_page",
        arguments: { page_id: "page-7", max_blocks: 5 },
      });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0].blocks).toEqual([{ id: "sync-2", type: "synced_block" }]);
    } finally {
      await close();
    }
  });

  it("G3b-8: malformed image + synced_block — warnings EXCLUDE the malformed image (not a type-gap)", async () => {
    const tree: Record<string, Raw[]> = {
      "page-8": [malformedImage("img-1"), syncedBlock("sync-1")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-8" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0].blocks).toEqual([{ id: "sync-1", type: "synced_block" }]);
    } finally {
      await close();
    }
  });

  it("read_page renders a raw transcription block summary as a synthetic toggle", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-summary": [transcription("mn-1", { summary_block_id: "summary-root" })],
      "summary-root": [paraText("summary-child", "Summary child")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "summary-root": paraText("summary-root", "Summary root"),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-summary" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("+++ AI Meeting Notes: Team Sync");
      expect(response.markdown).toContain("Status: notes_ready");
      expect(response.markdown).toContain("## Summary");
      expect(response.markdown).toContain("Summary root");
      expect(response.markdown).toContain("Summary child");
      expect(response.warnings).toEqual([
        {
          code: "read_only_block_rendered",
          blocks: [{ id: "mn-1", type: "transcription" }],
          message: expect.stringContaining("read-only Notion AI meeting notes"),
        },
      ]);
    } finally {
      await close();
    }
  });

  it("read_page renders a raw meeting_notes block notes section as a synthetic toggle", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-notes": [meetingNotes("mn-2", { notes_block_id: "notes-root" })],
      "notes-root": [paraText("notes-child", "Notes child")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "notes-root": paraText("notes-root", "Notes root"),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-notes" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("+++ AI Meeting Notes: Planning");
      expect(response.markdown).toContain("## Notes");
      expect(response.markdown).toContain("Notes root");
      expect(response.markdown).toContain("Notes child");
      expect(response.warnings[0].blocks).toEqual([{ id: "mn-2", type: "meeting_notes" }]);
    } finally {
      await close();
    }
  });

  it("read_page omits Transcript by default when a transcript pointer exists", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-transcript-default": [transcription("mn-3", {
        summary_block_id: "summary-root",
        transcript_block_id: "transcript-root",
      })],
      "summary-root": [paraText("summary-child", "Summary text")],
      "transcript-root": [paraText("transcript-child", "Transcript text")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "summary-root": paraText("summary-root", ""),
      "transcript-root": paraText("transcript-root", "Transcript root"),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-transcript-default" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("## Summary");
      expect(response.markdown).not.toContain("## Transcript");
      expect(response.markdown).not.toContain("Transcript text");
      expect(response.markdown).not.toContain("Transcript root");
      expect(response.warnings[0].blocks).toEqual([
        { id: "mn-3", type: "transcription", transcript_omitted: true },
      ]);
    } finally {
      await close();
    }
  });

  it("read_page includes Transcript when include_transcript is true", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-transcript": [transcription("mn-4", { transcript_block_id: "transcript-root" })],
      "transcript-root": [paraText("transcript-child", "Transcript child")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "transcript-root": paraText("transcript-root", "Transcript root"),
    }));
    try {
      const result = await client.callTool({
        name: "read_page",
        arguments: { page_id: "page-mn-transcript", include_transcript: true },
      });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("## Transcript");
      expect(response.markdown).toContain("Transcript root");
      expect(response.markdown).toContain("Transcript child");
    } finally {
      await close();
    }
  });

  it("read_page does not render pointerless meeting-note direct children by default", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-direct-default": [transcription("mn-5", {}, true)],
      "mn-5": [paraText("direct-child", "Direct child")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-direct-default" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("+++ AI Meeting Notes: Team Sync");
      expect(response.markdown).not.toContain("Direct child");
      expect(response.warnings[0]).toMatchObject({
        code: "read_only_block_rendered",
        blocks: [{ id: "mn-5", type: "transcription", transcript_omitted: true }],
      });
    } finally {
      await close();
    }
  });

  it("read_page falls back to direct children when pointerless meeting notes are read with include_transcript", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-direct": [transcription("mn-5b", {}, true)],
      "mn-5b": [paraText("direct-child", "Direct child")],
    };
    const { client, close } = await connect(makeNotion(tree));
    try {
      const result = await client.callTool({
        name: "read_page",
        arguments: { page_id: "page-mn-direct", include_transcript: true },
      });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("Direct child");
      expect(response.warnings[0].blocks).toEqual([{ id: "mn-5b", type: "transcription" }]);
    } finally {
      await close();
    }
  });

  it("read_page preserves supported section-root container hierarchy", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-section-hierarchy": [transcription("mn-6a", { summary_block_id: "summary-toggle" })],
      "summary-toggle": [paraText("summary-child", "Nested summary")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "summary-toggle": toggleText("summary-toggle", "Root toggle", true),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-section-hierarchy" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("## Summary\n\n+++ Root toggle\nNested summary\n+++");
    } finally {
      await close();
    }
  });

  it("read_page uses section pointers instead of also recursing into the meeting-note block", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-no-dup": [transcription("mn-6", { summary_block_id: "summary-root" }, true)],
      "mn-6": [paraText("direct-child", "Should not appear")],
      "summary-root": [paraText("summary-child", "Pointer child")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "summary-root": paraText("summary-root", "Pointer root"),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-no-dup" } });
      const response = extractResponse(parseToolText(result));
      expect(response.markdown).toContain("Pointer root");
      expect(response.markdown).toContain("Pointer child");
      expect(response.markdown).not.toContain("Should not appear");
    } finally {
      await close();
    }
  });

  it("read_page returns read_only_block_rendered plus omitted_block_types for mixed meeting notes and unsupported blocks", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-mixed": [transcription("mn-7", { summary_block_id: "summary-root" }), syncedBlock("sync-1")],
      "summary-root": [paraText("summary-child", "Summary")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "summary-root": paraText("summary-root", ""),
    }));
    try {
      const result = await client.callTool({ name: "read_page", arguments: { page_id: "page-mn-mixed" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings.map((warning: any) => warning.code)).toEqual([
        "omitted_block_types",
        "read_only_block_rendered",
      ]);
      expect(response.warnings[0].blocks).toEqual([{ id: "sync-1", type: "synced_block" }]);
      expect(response.warnings[1].blocks).toEqual([{ id: "mn-7", type: "transcription" }]);
    } finally {
      await close();
    }
  });

  it("max_blocks caps top-level traversal but renders selected sections for an included meeting-notes block", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-max": [para("b1"), transcription("mn-8", { notes_block_id: "notes-root" }), syncedBlock("sync-3")],
      "notes-root": [paraText("notes-child", "Notes inside cap")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "notes-root": paraText("notes-root", ""),
    }));
    try {
      const result = await client.callTool({
        name: "read_page",
        arguments: { page_id: "page-mn-max", max_blocks: 2 },
      });
      const response = extractResponse(parseToolText(result));
      expect(response.has_more).toBe(true);
      expect(response.markdown).toContain("## Notes");
      expect(response.markdown).toContain("Notes inside cap");
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0].code).toBe("read_only_block_rendered");
    } finally {
      await close();
    }
  });

  it("duplicate_page copies meeting-notes summary/notes as ordinary blocks, omits transcript by default, and warns", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-dup": [meetingNotes("mn-9", {
        summary_block_id: "summary-root",
        notes_block_id: "notes-root",
        transcript_block_id: "transcript-root",
      })],
      "summary-root": [paraText("summary-child", "Dup summary")],
      "notes-root": [paraText("notes-child", "Dup notes")],
      "transcript-root": [paraText("transcript-child", "Dup transcript")],
    };
    const notion = makeNotion(tree, {}, {
      "summary-root": paraText("summary-root", ""),
      "notes-root": paraText("notes-root", ""),
      "transcript-root": paraText("transcript-root", ""),
    });
    const { client, close } = await connect(notion);
    try {
      const result = await client.callTool({ name: "duplicate_page", arguments: { page_id: "page-mn-dup" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings).toEqual([
        {
          code: "read_only_block_rendered",
          blocks: [{ id: "mn-9", type: "meeting_notes", transcript_omitted: true }],
          message: expect.stringContaining("read-only Notion AI meeting notes"),
        },
      ]);
      const createCall = notion.pages.create.mock.calls[0][0];
      const markdownSource = JSON.stringify(createCall.children);
      expect(markdownSource).toContain("Dup summary");
      expect(markdownSource).toContain("Dup notes");
      expect(markdownSource).not.toContain("Dup transcript");
      expect((createCall.children ?? []).map((block: any) => block.type)).toEqual(["toggle"]);
    } finally {
      await close();
    }
  });

  it("duplicate_page returns read_only_block_rendered plus omitted_block_types for mixed meeting notes and unsupported blocks", async () => {
    const tree: Record<string, Raw[]> = {
      "page-mn-dup-mixed": [meetingNotes("mn-10", { notes_block_id: "notes-root" }), childPage("cp-1")],
      "notes-root": [paraText("notes-child", "Dup notes")],
    };
    const { client, close } = await connect(makeNotion(tree, {}, {
      "notes-root": paraText("notes-root", ""),
    }));
    try {
      const result = await client.callTool({ name: "duplicate_page", arguments: { page_id: "page-mn-dup-mixed" } });
      const response = extractResponse(parseToolText(result));
      expect(response.warnings.map((warning: any) => warning.code)).toEqual([
        "omitted_block_types",
        "read_only_block_rendered",
      ]);
      expect(response.warnings[0].blocks).toEqual([{ id: "cp-1", type: "child_page" }]);
      expect(response.warnings[1].blocks).toEqual([{ id: "mn-10", type: "meeting_notes" }]);
    } finally {
      await close();
    }
  });

  it("G3b-9: read_page description documents the warnings contract, include_transcript, and round-trip caveat", async () => {
    const { client, close } = await connect(makeNotion({}));
    try {
      const { tools } = await client.listTools();
      const readPage = tools.find((t) => t.name === "read_page");
      const description = readPage!.description ?? "";
      expect(description).toMatch(/omitted from the markdown/i);
      expect(description).toMatch(/include_transcript/i);
      expect(description).toMatch(/read_only_block_rendered/i);
      expect(description).toMatch(/do NOT round-trip/i);
    } finally {
      await close();
    }
  });

  it("G3b-10: duplicate_page description documents warnings + deep-duplication limit", async () => {
    const { client, close } = await connect(makeNotion({}));
    try {
      const { tools } = await client.listTools();
      const duplicatePage = tools.find((t) => t.name === "duplicate_page");
      const description = duplicatePage!.description ?? "";
      expect(description).toMatch(/warnings/i);
      expect(description).toMatch(/read_only_block_rendered/i);
      expect(description).toMatch(/Deep-duplication/i);
      expect(description).toMatch(/not yet supported/i);
    } finally {
      await close();
    }
  });

  it("G3b-11: SUPPORTED_BLOCK_TYPES drift-invariant — every entry yields no omitted warning when read", async () => {
    // Build a minimal-valid raw block for each supported type. If a maintainer
    // adds a type to SUPPORTED_BLOCK_TYPES without teaching normalizeBlock to
    // handle it, that type will normalize to null and bubble up as a warning.
    const builders: Record<string, (id: string) => Raw> = {
      heading_1: (id) => ({ id, type: "heading_1", heading_1: { rich_text: [] }, has_children: false }),
      heading_2: (id) => ({ id, type: "heading_2", heading_2: { rich_text: [] }, has_children: false }),
      heading_3: (id) => ({ id, type: "heading_3", heading_3: { rich_text: [] }, has_children: false }),
      paragraph: (id) => ({ id, type: "paragraph", paragraph: { rich_text: [] }, has_children: false }),
      toggle: (id) => ({ id, type: "toggle", toggle: { rich_text: [] }, has_children: false }),
      bulleted_list_item: (id) => ({ id, type: "bulleted_list_item", bulleted_list_item: { rich_text: [] }, has_children: false }),
      numbered_list_item: (id) => ({ id, type: "numbered_list_item", numbered_list_item: { rich_text: [] }, has_children: false }),
      quote: (id) => ({ id, type: "quote", quote: { rich_text: [] }, has_children: false }),
      callout: (id) => ({ id, type: "callout", callout: { rich_text: [], icon: { type: "emoji", emoji: "\u{1F4A1}" } }, has_children: false }),
      equation: (id) => ({ id, type: "equation", equation: { expression: "x" }, has_children: false }),
      table: (id) => ({ id, type: "table", table: { table_width: 1, has_column_header: true, has_row_header: false, children: [] }, has_children: false }),
      table_row: (id) => ({ id, type: "table_row", table_row: { cells: [] }, has_children: false }),
      column_list: (id) => ({ id, type: "column_list", column_list: {}, has_children: false }),
      column: (id) => ({ id, type: "column", column: {}, has_children: false }),
      code: (id) => ({ id, type: "code", code: { rich_text: [], language: "text" }, has_children: false }),
      divider: (id) => ({ id, type: "divider", divider: {}, has_children: false }),
      to_do: (id) => ({ id, type: "to_do", to_do: { rich_text: [], checked: false }, has_children: false }),
      table_of_contents: (id) => ({ id, type: "table_of_contents", table_of_contents: {}, has_children: false }),
      bookmark: (id) => ({ id, type: "bookmark", bookmark: { url: "https://example.com" }, has_children: false }),
      embed: (id) => ({ id, type: "embed", embed: { url: "https://example.com" }, has_children: false }),
      image: (id) => ({ id, type: "image", image: { type: "external", external: { url: "https://example.com/i.png" } }, has_children: false }),
      file: (id) => ({ id, type: "file", file: { type: "external", external: { url: "https://example.com/f.pdf" }, name: "f.pdf" }, has_children: false }),
      audio: (id) => ({ id, type: "audio", audio: { type: "external", external: { url: "https://example.com/a.mp3" } }, has_children: false }),
      video: (id) => ({ id, type: "video", video: { type: "external", external: { url: "https://example.com/v.mp4" } }, has_children: false }),
      transcription: (id) => transcription(id, {}),
      meeting_notes: (id) => meetingNotes(id, {}),
    };
    for (const type of SUPPORTED_BLOCK_TYPES) {
      expect(builders[type], `builder missing for supported type '${type}' — add one to this test`).toBeDefined();
    }
    for (const type of SUPPORTED_BLOCK_TYPES) {
      const tree = { "page-invariant": [builders[type](`${type}-block`)] };
      const { client, close } = await connect(makeNotion(tree));
      try {
        const result = await client.callTool({
          name: "read_page",
          arguments: { page_id: "page-invariant" },
        });
        const response = extractResponse(parseToolText(result));
        const omittedWarnings = (response.warnings ?? []).filter(
          (warning: any) => warning.code === "omitted_block_types",
        );
        expect(omittedWarnings, `type '${type}' surfaced as omitted — add a normalizeBlock case`).toEqual([]);
      } finally {
        await close();
      }
    }
  });
});

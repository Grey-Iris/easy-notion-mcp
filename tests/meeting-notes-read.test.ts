import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

type Raw = Record<string, any> & { id: string; type: string; has_children?: boolean };

const PAGE_ID = "page-meeting-notes";
const MEETING_ID = "meeting-notes-1";
const SUMMARY_ID = "summary-section-1";
const NOTES_ID = "notes-section-1";
const TRANSCRIPT_ID = "transcript-section-1";
const TITLE_TEXT = "AI meeting notes for 2026-05-08";
const START_TIME = "2026-05-08T14:54:00.000Z";
const END_TIME = "2026-05-08T14:58:00.000Z";

function parseToolText(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("expected text content");
  return JSON.parse(text) as any;
}

function annotations(overrides: Record<string, any> = {}) {
  return {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
    ...overrides,
  };
}

function rt(content: string, annotationOverrides: Record<string, any> = {}) {
  return [{
    type: "text",
    text: { content, link: null },
    annotations: annotations(annotationOverrides),
    plain_text: content,
    href: null,
  }];
}

function rtMention(
  plainText: string,
  opts: { mentionType?: "date" | "user"; start?: string } = {},
) {
  const mentionType = opts.mentionType ?? "user";
  return [{
    type: "mention",
    mention: mentionType === "date"
      ? {
        type: "date",
        date: { start: opts.start ?? "2026-05-08", end: null, time_zone: null },
      }
      : {
        type: "user",
        user: {
          object: "user",
          id: "user-1",
          name: plainText.replace(/^@/, ""),
          avatar_url: null,
          type: "person",
          person: { email: "some.user@example.com" },
        },
      },
    annotations: annotations(),
    plain_text: plainText,
    href: null,
  }];
}

function titleRichText() {
  return [
    ...rt("AI meeting notes for ", { bold: true }),
    ...rt(""),
    ...rtMention("2026-05-08", { mentionType: "date", start: "2026-05-08" }),
  ];
}

function paragraph(id: string, text: string | any[], hasChildren = false): Raw {
  return {
    id,
    type: "paragraph",
    paragraph: { rich_text: typeof text === "string" ? rt(text) : text },
    has_children: hasChildren,
  };
}

function heading3(id: string, text: string): Raw {
  return {
    id,
    type: "heading_3",
    heading_3: { rich_text: rt(text), is_toggleable: false },
    has_children: false,
  };
}

function heading2(id: string, text: string): Raw {
  return {
    id,
    type: "heading_2",
    heading_2: { rich_text: rt(text), is_toggleable: false },
    has_children: false,
  };
}

function toDo(id: string, text: string, checked = false): Raw {
  return {
    id,
    type: "to_do",
    to_do: { rich_text: rt(text), checked },
    has_children: false,
  };
}

function bulleted(id: string, richText: string | any[]): Raw {
  return {
    id,
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: typeof richText === "string" ? rt(richText) : richText },
    has_children: false,
  };
}

function syncedBlock(id: string): Raw {
  return { id, type: "synced_block", synced_block: { synced_from: null }, has_children: false };
}

type MeetingOptions = {
  title?: any[];
  status?: string;
  children?: Record<string, string>;
  recording?: { start_time?: string; end_time?: string } | null;
  has_children?: boolean;
};

function meetingNotes(id: string, options: MeetingOptions = {}): Raw {
  return meetingLikeBlock("meeting_notes", id, options);
}

function transcription(id: string, options: MeetingOptions = {}): Raw {
  return meetingLikeBlock("transcription", id, options);
}

function meetingLikeBlock(type: "meeting_notes" | "transcription", id: string, options: MeetingOptions): Raw {
  const body = {
    title: options.title ?? titleRichText(),
    status: options.status ?? "notes_ready",
    children: options.children ?? {
      summary_block_id: SUMMARY_ID,
      notes_block_id: NOTES_ID,
      transcript_block_id: TRANSCRIPT_ID,
    },
    recording: "recording" in options
      ? options.recording
      : { start_time: START_TIME, end_time: END_TIME },
  };
  return { id, type, [type]: body, has_children: options.has_children ?? false };
}

function sectionRoot(id: string): Raw {
  return paragraph(id, [], true);
}

function objectNotFound(blockId: string) {
  const err = new Error(`Could not find block ${blockId}`) as any;
  err.code = "object_not_found";
  err.body = { code: "object_not_found", message: `Could not find block ${blockId}` };
  return err;
}

function makeNotion(
  tree: Record<string, Raw[]>,
  retrieve: Record<string, Raw> = {},
  retrieveErrors: Record<string, any> = {},
) {
  return {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => ({
        id: page_id,
        url: `https://notion.so/${page_id}`,
        properties: { title: { type: "title", title: [{ plain_text: "Meeting page" }] } },
        parent: { type: "page_id", page_id: "parent-page-id" },
      })),
      create: vi.fn(),
      update: vi.fn(),
    },
    blocks: {
      retrieve: vi.fn(async ({ block_id }: any) => {
        if (retrieveErrors[block_id]) throw retrieveErrors[block_id];
        const block = retrieve[block_id] ?? Object.values(tree).flat().find((candidate) => candidate.id === block_id);
        if (!block) throw objectNotFound(block_id);
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
    { name: "meeting-notes-read-test", version: "1.0.0" },
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

function standardFixture(options: {
  block?: Raw;
  summaryChildren?: Raw[];
  notesChildren?: Raw[];
  transcriptChildren?: Raw[];
  retrieveErrors?: Record<string, any>;
} = {}) {
  const block = options.block ?? meetingNotes(MEETING_ID);
  const tree: Record<string, Raw[]> = {
    [PAGE_ID]: [block],
    [SUMMARY_ID]: options.summaryChildren ?? [
      heading3("summary-heading", "Decisions"),
      toDo("summary-todo", "Send recap", false),
      bulleted("summary-user-mention", [
        ...rt("Owner: "),
        ...rtMention("@Some User"),
        ...rt(" will follow up."),
      ]),
    ],
    [NOTES_ID]: options.notesChildren ?? [
      heading3("notes-heading", "Discussion"),
      bulleted("notes-bullet", "Discussed launch timing."),
    ],
    [TRANSCRIPT_ID]: options.transcriptChildren ?? [
      paragraph("transcript-p1", "Transcript line one."),
      paragraph("transcript-p2", "Transcript line two."),
    ],
  };
  const retrieve = {
    [SUMMARY_ID]: sectionRoot(SUMMARY_ID),
    [NOTES_ID]: sectionRoot(NOTES_ID),
    [TRANSCRIPT_ID]: sectionRoot(TRANSCRIPT_ID),
    [MEETING_ID]: block,
  };
  const notion = makeNotion(tree, retrieve, options.retrieveErrors);
  return { block, notion, tree };
}

describe("Notion AI meeting-notes read support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a meeting_notes block as a synthetic toggle without fetching transcript by default", async () => {
    const { notion } = standardFixture();
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(response.markdown).toContain(`> [!INFO]\n> Recorded ${START_TIME} – ${END_TIME}`);
      expect(response.markdown).toContain("## Summary");
      expect(response.markdown).toContain("## Notes");
      expect(response.markdown).not.toContain("## Transcript");
      expect(response.markdown).not.toContain("Transcript line one.");
      expect(response.markdown).not.toContain("Status:");
      expect(response.markdown).toContain("- Owner: @Some User will follow up.");
      expect(response.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{ id: MEETING_ID, type: "meeting_notes", transcript_omitted: true }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);
      expect(notion.blocks.retrieve).not.toHaveBeenCalledWith(
        expect.objectContaining({ block_id: TRANSCRIPT_ID }),
      );
    } finally {
      await close();
    }
  });

  it("includes the transcript when read_page receives include_transcript: true", async () => {
    const { notion } = standardFixture();
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID, include_transcript: true },
      }));

      expect(response.markdown).toContain("## Transcript");
      expect(response.markdown).toContain("Transcript line one.");
      expect(response.warnings).toHaveLength(1);
      expect(response.warnings[0]).toMatchObject({
        code: "read_only_block_rendered",
        blocks: [{ id: MEETING_ID, type: "meeting_notes" }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      });
      expect(response.warnings[0].blocks[0]).not.toHaveProperty("transcript_omitted");
      expect(notion.blocks.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ block_id: TRANSCRIPT_ID }),
      );
    } finally {
      await close();
    }
  });

  it("continues rendering summary and notes when a transcript section pointer is stale", async () => {
    const { notion } = standardFixture({
      retrieveErrors: { [TRANSCRIPT_ID]: objectNotFound(TRANSCRIPT_ID) },
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID, include_transcript: true },
      }));

      expect(response.markdown).toContain("## Summary");
      expect(response.markdown).toContain("## Notes");
      expect(response.markdown).not.toContain("## Transcript");
      expect(response.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{
          id: MEETING_ID,
          type: "meeting_notes",
          sections_unreadable: [{
            key: "transcript_block_id",
            block_id: TRANSCRIPT_ID,
            code: "object_not_found",
          }],
        }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);
    } finally {
      await close();
    }
  });

  it("falls back to direct children when section pointers are absent and the meeting_notes block has children", async () => {
    const block = meetingNotes(MEETING_ID, { children: {}, has_children: true });
    const notion = makeNotion({
      [PAGE_ID]: [block],
      [MEETING_ID]: [
        paragraph("fallback-1", "Fallback paragraph one."),
        paragraph("fallback-2", "Fallback paragraph two."),
      ],
    }, { [MEETING_ID]: block });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(response.markdown).toContain("Fallback paragraph one.");
      expect(response.markdown).toContain("Fallback paragraph two.");
      expect(response.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{ id: MEETING_ID, type: "meeting_notes" }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);
    } finally {
      await close();
    }
  });

  it("renders an unknown meeting_notes status literally", async () => {
    const { notion } = standardFixture({
      block: meetingNotes(MEETING_ID, { status: "processing_failed" }),
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain("Status: processing_failed");
    } finally {
      await close();
    }
  });

  it("suppresses the notes_ready status", async () => {
    const { notion } = standardFixture({
      block: meetingNotes(MEETING_ID, { status: "notes_ready" }),
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).not.toContain("Status:");
      expect(response.markdown).toContain("## Summary");
    } finally {
      await close();
    }
  });

  it("renders the deprecated transcription variant with the same synthetic toggle contract", async () => {
    const { notion } = standardFixture({
      block: transcription(MEETING_ID),
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(response.markdown).toContain("## Summary");
      expect(response.markdown).toContain("## Notes");
      expect(response.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{ id: MEETING_ID, type: "transcription", transcript_omitted: true }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);
    } finally {
      await close();
    }
  });

  it("keeps omitted_block_types warnings from unknown section descendants alongside read_only_block_rendered", async () => {
    const { notion } = standardFixture({
      summaryChildren: [
        heading3("summary-heading", "Decisions"),
        syncedBlock("summary-sync"),
        bulleted("summary-bullet", "Visible summary content."),
      ],
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain("Visible summary content.");
      expect(response.warnings).toEqual(expect.arrayContaining([
        {
          code: "omitted_block_types",
          blocks: [{ id: "summary-sync", type: "synced_block" }],
        },
        {
          code: "read_only_block_rendered",
          blocks: [{ id: MEETING_ID, type: "meeting_notes", transcript_omitted: true }],
          message: expect.stringContaining("read-only Notion AI meeting notes"),
        },
      ]));
    } finally {
      await close();
    }
  });

  it("omits the recording INFO callout when recording is null", async () => {
    const { notion } = standardFixture({
      block: meetingNotes(MEETING_ID, { recording: null }),
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(response.markdown).not.toContain("> [!INFO]");
      expect(response.markdown).not.toContain("Recorded");
    } finally {
      await close();
    }
  });

  it.each([
    ["missing end time", { start_time: START_TIME, end_time: "" }],
    ["missing start time", { start_time: "", end_time: END_TIME }],
  ])("omits the recording INFO callout when recording is partial: %s", async (_name, recording) => {
    const { notion } = standardFixture({
      block: meetingNotes(MEETING_ID, { recording }),
    });
    const { client, close } = await connect(notion);

    try {
      const response = parseToolText(await client.callTool({
        name: "read_page",
        arguments: { page_id: PAGE_ID },
      }));

      expect(response.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(response.markdown).not.toContain("> [!INFO]");
      expect(response.markdown).not.toContain("Recorded");
    } finally {
      await close();
    }
  });

  it("covers targeted read behavior for meeting notes blocks and synthetic toggle discovery", async () => {
    const sectionMeeting = meetingNotes("section-meeting", {
      children: {
        summary_block_id: "section-summary",
        notes_block_id: "section-notes",
        transcript_block_id: "section-transcript",
      },
    });
    const tree: Record<string, Raw[]> = {
      [MEETING_ID]: [
        paragraph("block-summary-child", "Read block summary."),
      ],
      [SUMMARY_ID]: [
        paragraph("summary-child", "Summary from read_block."),
      ],
      [NOTES_ID]: [
        paragraph("notes-child", "Notes from read_block."),
      ],
      [TRANSCRIPT_ID]: [
        paragraph("transcript-child", "Transcript should stay hidden."),
      ],
      "section-page": [
        heading2("target-heading", "Target"),
        sectionMeeting,
        heading2("next-heading", "Next"),
      ],
      "section-summary": [paragraph("section-summary-child", "Summary from read_section.")],
      "section-notes": [paragraph("section-notes-child", "Notes from read_section.")],
      "section-transcript": [paragraph("section-transcript-child", "Hidden section transcript.")],
      "toggle-page": [meetingNotes("toggle-meeting")],
    };
    const retrieve: Record<string, Raw> = {
      [MEETING_ID]: meetingNotes(MEETING_ID),
      [SUMMARY_ID]: sectionRoot(SUMMARY_ID),
      [NOTES_ID]: sectionRoot(NOTES_ID),
      [TRANSCRIPT_ID]: sectionRoot(TRANSCRIPT_ID),
      "section-meeting": sectionMeeting,
      "section-summary": sectionRoot("section-summary"),
      "section-notes": sectionRoot("section-notes"),
      "section-transcript": sectionRoot("section-transcript"),
    };
    const notion = makeNotion(tree, retrieve);
    const { client, close } = await connect(notion);

    try {
      const toggleMiss = parseToolText(await client.callTool({
        name: "read_toggle",
        arguments: { page_id: "toggle-page", title: `AI Meeting Notes: ${TITLE_TEXT}` },
      }));
      expect(toggleMiss.error).toContain("Toggle not found");
      expect(toggleMiss.available_toggles).not.toContain(`AI Meeting Notes: ${TITLE_TEXT}`);

      const blockResponse = parseToolText(await client.callTool({
        name: "read_block",
        arguments: { block_id: MEETING_ID },
      }));
      expect(blockResponse.error).toBeUndefined();
      expect(blockResponse.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(blockResponse.markdown).toContain("## Summary");
      expect(blockResponse.markdown).toContain("## Notes");
      expect(blockResponse.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{ id: MEETING_ID, type: "meeting_notes", transcript_omitted: true }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);

      const sectionResponse = parseToolText(await client.callTool({
        name: "read_section",
        arguments: { page_id: "section-page", heading: "Target" },
      }));
      expect(sectionResponse.markdown).toContain(`+++ AI Meeting Notes: ${TITLE_TEXT}`);
      expect(sectionResponse.markdown).toContain("Summary from read_section.");
      expect(sectionResponse.warnings).toEqual([{
        code: "read_only_block_rendered",
        blocks: [{ id: "section-meeting", type: "meeting_notes", transcript_omitted: true }],
        message: expect.stringContaining("read-only Notion AI meeting notes"),
      }]);
    } finally {
      await close();
    }
  });
});

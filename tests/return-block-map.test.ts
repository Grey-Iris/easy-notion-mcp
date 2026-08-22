import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer, type CreateServerConfig } from "../src/server.js";

type RawBlock = Record<string, any> & { id: string; type: string; has_children?: boolean };
type JournalEntry = [string, any];
type ReturnState = "absent" | "true" | "false";

const STATES: ReturnState[] = ["absent", "true", "false"];
const NOTE = "Created as a private workspace page. Use move_page to relocate.";
const MENTION_ID = "1a2b3c4d5e6f7081920a1b2c3d4e5f60";
const MENTION_URL = `https://www.notion.so/${MENTION_ID}`;
const tempDirs: string[] = [];

function stateArgs(state: ReturnState) {
  return state === "absent" ? {} : { return_block_map: state === "true" };
}

function writeText(content: string, link?: string) {
  return {
    type: "text",
    text: {
      content,
      ...(link ? { link: { url: link } } : {}),
    },
  };
}

function writeParagraph(content: string) {
  return { type: "paragraph", paragraph: { rich_text: [writeText(content)] } };
}

function writeHeading2(content: string, isToggleable = false) {
  return {
    type: "heading_2",
    heading_2: {
      rich_text: [writeText(content)],
      ...(isToggleable ? { is_toggleable: true } : {}),
    },
  };
}

function rawRichText(content: string) {
  return [{ plain_text: content, text: { content, link: null }, annotations: {} }];
}

function paragraph(id: string, content: string): RawBlock {
  return { id, type: "paragraph", paragraph: { rich_text: rawRichText(content) } };
}

function heading2(id: string, content: string, isToggleable = false): RawBlock {
  return {
    id,
    type: "heading_2",
    heading_2: { rich_text: rawRichText(content), is_toggleable: isToggleable },
    has_children: isToggleable,
  };
}

function toggle(id: string, content: string): RawBlock {
  return {
    id,
    type: "toggle",
    toggle: { rich_text: rawRichText(content) },
    has_children: true,
  };
}

function listed(blockId: string) {
  return { block_id: blockId, start_cursor: undefined, page_size: 100 };
}

function createdBlocks(children: any[], attempt: number) {
  return children.map((child, index) => ({
    id: `new-${attempt}-${index}`,
    type: child.type,
    [child.type]: child[child.type],
    has_children: child.has_children,
  }));
}

function makeNotion(options: {
  tree?: Record<string, RawBlock[]>;
  updateMarkdownResult?: Record<string, unknown>;
  failingReadBlockId?: string;
  failFirstAppend?: boolean;
} = {}) {
  const tree = options.tree ?? {};
  const journal: JournalEntry[] = [];
  let appendAttempt = 0;

  const notion = {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(async (args: any) => {
        journal.push(["pages.create", args]);
        return { id: "page-created", url: "https://notion.so/page-created" };
      }),
      update: vi.fn(async (args: any) => {
        journal.push(["pages.update", args]);
        return { id: args.page_id };
      }),
      updateMarkdown: vi.fn(async (args: any) => {
        journal.push(["pages.updateMarkdown", args]);
        return options.updateMarkdownResult ?? {
          truncated: false,
          unknown_block_ids: [],
        };
      }),
    },
    blocks: {
      retrieve: vi.fn(async (args: any) => {
        journal.push(["blocks.retrieve", args]);
        return paragraph(args.block_id, "Existing");
      }),
      update: vi.fn(async (args: any) => {
        journal.push(["blocks.update", args]);
        return { object: "block", id: args.block_id };
      }),
      delete: vi.fn(async (args: any) => {
        journal.push(["blocks.delete", args]);
        return { id: args.block_id };
      }),
      children: {
        list: vi.fn(async (args: any) => {
          journal.push(["blocks.children.list", args]);
          if (args.block_id === options.failingReadBlockId) {
            throw new Error("readback failed after write");
          }
          return {
            results: tree[args.block_id] ?? [],
            has_more: false,
            next_cursor: null,
          };
        }),
        append: vi.fn(async (args: any) => {
          appendAttempt += 1;
          journal.push(["blocks.children.append", args]);
          if (options.failFirstAppend && appendAttempt === 1) {
            throw { code: "validation_error" };
          }
          return { results: createdBlocks(args.children, appendAttempt) };
        }),
      },
    },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
    journal,
  };

  return notion;
}

async function connect(notion: any, config: CreateServerConfig = {}) {
  const server = createServer(() => notion, config);
  const client = new McpClient(
    { name: "return-block-map-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await Promise.all([clientTransport.close(), serverTransport.close()]);
    },
  };
}

async function callRaw(
  notion: any,
  name: string,
  args: Record<string, unknown>,
  config: CreateServerConfig = {},
) {
  const { client, close } = await connect(notion, config);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("expected text content");
    return text;
  } finally {
    await close();
  }
}

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("return_block_map live receipts and call journals", () => {
  it("pins create_page absent, true, and false receipts and calls", async () => {
    const full = `{"id":"page-created","title":"Created","url":"https://notion.so/page-created","success":true,"note":"${NOTE}","block_map":[{"block_id":"created-p","type":"paragraph","text_preview":"Created body"}]}`;
    const lean = `{"id":"page-created","title":"Created","url":"https://notion.so/page-created","success":true,"note":"${NOTE}"}`;
    const createArgs = {
      parent: { type: "workspace", workspace: true },
      properties: { title: { title: [writeText("Created")] } },
      children: [writeParagraph("Created body")],
    };

    for (const state of STATES) {
      const notion = makeNotion({
        tree: { "page-created": [paragraph("created-p", "Created body")] },
      });
      const raw = await callRaw(
        notion,
        "create_page",
        { title: "Created", markdown: "Created body", ...stateArgs(state) },
        { allowWorkspaceParent: true },
      );

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["pages.create", createArgs],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-created")] as JournalEntry]),
      ]);
      expect(notion.pages.create).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }
  });

  it("pins create_page_from_file absent, true, and false receipts and calls", async () => {
    const root = await makeTempDir("return-block-map-file-");
    const filePath = join(root, "import.md");
    await writeFile(filePath, "Imported body", "utf8");
    const full = `{"id":"page-created","title":"Imported","url":"https://notion.so/page-created","success":true,"note":"${NOTE}","block_map":[{"block_id":"file-p","type":"paragraph","text_preview":"Imported body"}]}`;
    const lean = `{"id":"page-created","title":"Imported","url":"https://notion.so/page-created","success":true,"note":"${NOTE}"}`;
    const createArgs = {
      parent: { type: "workspace", workspace: true },
      properties: { title: { title: [writeText("Imported")] } },
      children: [writeParagraph("Imported body")],
    };

    for (const state of STATES) {
      const notion = makeNotion({
        tree: { "page-created": [paragraph("file-p", "Imported body")] },
      });
      const raw = await callRaw(
        notion,
        "create_page_from_file",
        { title: "Imported", file_path: filePath, ...stateArgs(state) },
        { allowWorkspaceParent: true, transport: "stdio", workspaceRoot: root },
      );

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["pages.create", createArgs],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-created")] as JournalEntry]),
      ]);
      expect(notion.pages.create).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }
  });

  it("pins append_content mention fallback receipts and calls", async () => {
    const mentionWrite = {
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "mention", mention: { type: "page", page: { id: MENTION_ID } } }],
      },
    };
    const linkWrite = writeParagraph("Title");
    linkWrite.paragraph.rich_text[0].text.link = { url: MENTION_URL };
    const warning = `{"code":"mention_target_unresolved","page_id":"${MENTION_ID}","url":"${MENTION_URL}"}`;
    const full = `{"success":true,"blocks_added":1,"block_map":[{"block_id":"new-2-0","type":"paragraph","text_preview":"Title"}],"warnings":[${warning}]}`;
    const lean = `{"success":true,"blocks_added":1,"warnings":[${warning}]}`;

    for (const state of STATES) {
      const notion = makeNotion({ failFirstAppend: true });
      const raw = await callRaw(notion, "append_content", {
        page_id: "page-1",
        markdown: `@[Title](${MENTION_URL})`,
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["blocks.children.append", { block_id: "page-1", children: [mentionWrite] }],
        ["blocks.children.append", { block_id: "page-1", children: [linkWrite] }],
      ]);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(2);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(0);
    }
  });

  it("pins replace_content truncated and warning receipts and calls", async () => {
    const full = "{\"success\":true,\"truncated\":true,\"warnings\":[{\"code\":\"unmatched_blocks\",\"block_ids\":[\"missing-1\"]}],\"block_map\":[{\"block_id\":\"post-p\",\"type\":\"paragraph\",\"text_preview\":\"Replacement\"}]}";
    const lean = "{\"success\":true,\"truncated\":true,\"warnings\":[{\"code\":\"unmatched_blocks\",\"block_ids\":[\"missing-1\"]}]}";
    const updateArgs = {
      page_id: "page-1",
      type: "replace_content",
      replace_content: { new_str: "Replacement", allow_deleting_content: true },
    };

    for (const state of STATES) {
      const notion = makeNotion({
        tree: { "page-1": [paragraph("post-p", "Replacement")] },
        updateMarkdownResult: { truncated: true, unknown_block_ids: ["missing-1"] },
      });
      const raw = await callRaw(notion, "replace_content", {
        page_id: "page-1",
        markdown: "Replacement",
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["pages.updateMarkdown", updateArgs],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-1")] as JournalEntry]),
      ]);
      expect(notion.pages.updateMarkdown).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }
  });

  it("pins update_section preserve-heading receipts and calls", async () => {
    const full = "{\"deleted\":2,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-child\",\"type\":\"paragraph\",\"text_preview\":\"Old child\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}],\"block_map\":[{\"block_id\":\"new-1-0\",\"type\":\"paragraph\",\"text_preview\":\"Replacement child\"}]}";
    const lean = "{\"deleted\":2,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-child\",\"type\":\"paragraph\",\"text_preview\":\"Old child\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}]}";

    for (const state of STATES) {
      const notion = makeNotion({
        tree: {
          "page-1": [
            heading2("h2-target", "Target", true),
            paragraph("old-body", "Old body"),
            heading2("h2-next", "Next"),
          ],
          "h2-target": [paragraph("old-child", "Old child")],
        },
      });
      const raw = await callRaw(notion, "update_section", {
        page_id: "page-1",
        heading: "Target",
        markdown: "Replacement child",
        preserve_heading: true,
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["blocks.children.list", listed("page-1")],
        ["blocks.children.list", listed("h2-target")],
        ["blocks.delete", { block_id: "old-child" }],
        ["blocks.delete", { block_id: "old-body" }],
        ["blocks.children.append", {
          block_id: "h2-target",
          children: [writeParagraph("Replacement child")],
        }],
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(2);
      expect(notion.blocks.delete).toHaveBeenCalledTimes(2);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    }
  });

  it("pins update_section first-block heading rewrite receipts and calls", async () => {
    const full = "{\"deleted\":2,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-child\",\"type\":\"paragraph\",\"text_preview\":\"Old child\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}],\"block_map\":[{\"block_id\":\"new-1-0\",\"type\":\"paragraph\",\"text_preview\":\"Replacement body\"}]}";
    const lean = "{\"deleted\":2,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-child\",\"type\":\"paragraph\",\"text_preview\":\"Old child\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}]}";

    for (const state of STATES) {
      const notion = makeNotion({
        tree: {
          "page-1": [
            heading2("h2-target", "Target", true),
            paragraph("old-body", "Old body"),
            heading2("h2-next", "Next"),
          ],
          "h2-target": [paragraph("old-child", "Old child")],
        },
      });
      const raw = await callRaw(notion, "update_section", {
        page_id: "page-1",
        heading: "Target",
        markdown: "## Target\nReplacement body",
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["blocks.children.list", listed("page-1")],
        ["blocks.children.list", listed("h2-target")],
        ["blocks.update", {
          block_id: "h2-target",
          heading_2: { rich_text: [writeText("Target")], is_toggleable: false },
        }],
        ["blocks.delete", { block_id: "old-child" }],
        ["blocks.delete", { block_id: "old-body" }],
        ["blocks.children.append", {
          block_id: "page-1",
          children: [writeParagraph("Replacement body")],
          position: { type: "after_block", after_block: { id: "h2-target" } },
        }],
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(2);
      expect(notion.blocks.update).toHaveBeenCalledTimes(1);
      expect(notion.blocks.delete).toHaveBeenCalledTimes(2);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    }
  });

  it("pins update_section default delete-and-append receipts and calls", async () => {
    const full = "{\"deleted\":2,\"appended\":2,\"deleted_blocks\":[{\"block_id\":\"h2-target\",\"type\":\"heading_2\",\"text_preview\":\"Target\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}],\"block_map\":[{\"block_id\":\"new-1-0\",\"type\":\"heading_2\",\"text_preview\":\"Replacement\"},{\"block_id\":\"new-1-1\",\"type\":\"paragraph\",\"text_preview\":\"Replacement body\"}]}";
    const lean = "{\"deleted\":2,\"appended\":2,\"deleted_blocks\":[{\"block_id\":\"h2-target\",\"type\":\"heading_2\",\"text_preview\":\"Target\"},{\"block_id\":\"old-body\",\"type\":\"paragraph\",\"text_preview\":\"Old body\"}]}";

    for (const state of STATES) {
      const notion = makeNotion({
        tree: {
          "page-1": [
            paragraph("intro", "Intro"),
            heading2("h2-target", "Target"),
            paragraph("old-body", "Old body"),
            heading2("h2-next", "Next"),
          ],
        },
      });
      const raw = await callRaw(notion, "update_section", {
        page_id: "page-1",
        heading: "Target",
        markdown: "## Replacement\nReplacement body",
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["blocks.children.list", listed("page-1")],
        ["blocks.delete", { block_id: "h2-target" }],
        ["blocks.delete", { block_id: "old-body" }],
        ["blocks.children.append", {
          block_id: "page-1",
          children: [writeHeading2("Replacement"), writeParagraph("Replacement body")],
          position: { type: "after_block", after_block: { id: "intro" } },
        }],
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(1);
      expect(notion.blocks.delete).toHaveBeenCalledTimes(2);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    }
  });

  it("pins update_toggle receipts and keeps both reads in every state", async () => {
    const full = "{\"success\":true,\"block_id\":\"toggle-1\",\"type\":\"toggle\",\"deleted\":1,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-toggle-child\",\"type\":\"paragraph\",\"text_preview\":\"Old toggle child\"}],\"block_map\":[{\"block_id\":\"new-1-0\",\"type\":\"paragraph\",\"text_preview\":\"New toggle body\"}]}";
    const lean = "{\"success\":true,\"block_id\":\"toggle-1\",\"type\":\"toggle\",\"deleted\":1,\"appended\":1,\"deleted_blocks\":[{\"block_id\":\"old-toggle-child\",\"type\":\"paragraph\",\"text_preview\":\"Old toggle child\"}]}";

    for (const state of STATES) {
      const notion = makeNotion({
        tree: {
          "page-1": [toggle("toggle-1", "Details")],
          "toggle-1": [paragraph("old-toggle-child", "Old toggle child")],
        },
      });
      const raw = await callRaw(notion, "update_toggle", {
        page_id: "page-1",
        title: "Details",
        markdown: "New toggle body",
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : full);
      expect(notion.journal).toEqual([
        ["blocks.children.list", listed("page-1")],
        ["blocks.children.list", listed("toggle-1")],
        ["blocks.delete", { block_id: "old-toggle-child" }],
        ["blocks.children.append", {
          block_id: "toggle-1",
          children: [writeParagraph("New toggle body")],
        }],
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(2);
      expect(notion.blocks.delete).toHaveBeenCalledTimes(1);
      expect(notion.blocks.children.append).toHaveBeenCalledTimes(1);
    }
  });
});

describe("return_block_map readback failures", () => {
  it("pins create_page failure semantics with a fresh mock for every state", async () => {
    const error = "{\"error\":\"readback failed after write\"}";
    const lean = `{"id":"page-created","title":"Created","url":"https://notion.so/page-created","success":true,"note":"${NOTE}"}`;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const state of STATES) {
      const notion = makeNotion({ failingReadBlockId: "page-created" });
      const raw = await callRaw(
        notion,
        "create_page",
        { title: "Created", markdown: "Created body", ...stateArgs(state) },
        { allowWorkspaceParent: true },
      );

      expect(raw).toBe(state === "false" ? lean : error);
      expect(notion.journal).toEqual([
        ["pages.create", {
          parent: { type: "workspace", workspace: true },
          properties: { title: { title: [writeText("Created")] } },
          children: [writeParagraph("Created body")],
        }],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-created")] as JournalEntry]),
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }

    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("pins replace_content failure semantics with a fresh mock for every state", async () => {
    const error = "{\"error\":\"readback failed after write\"}";
    const lean = "{\"success\":true}";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateArgs = {
      page_id: "page-1",
      type: "replace_content",
      replace_content: { new_str: "Replacement", allow_deleting_content: true },
    };

    for (const state of STATES) {
      const notion = makeNotion({ failingReadBlockId: "page-1" });
      const raw = await callRaw(notion, "replace_content", {
        page_id: "page-1",
        markdown: "Replacement",
        ...stateArgs(state),
      });

      expect(raw).toBe(state === "false" ? lean : error);
      expect(notion.journal).toEqual([
        ["pages.updateMarkdown", updateArgs],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-1")] as JournalEntry]),
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }

    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});

describe("return_block_map empty maps", () => {
  it("keeps empty-body create_page identical and never reads children", async () => {
    const expected = `{"id":"page-created","title":"Empty","url":"https://notion.so/page-created","success":true,"note":"${NOTE}"}`;

    for (const state of STATES) {
      const notion = makeNotion();
      const raw = await callRaw(
        notion,
        "create_page",
        { title: "Empty", markdown: "   ", ...stateArgs(state) },
        { allowWorkspaceParent: true },
      );

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([["pages.create", {
        parent: { type: "workspace", workspace: true },
        properties: { title: { title: [writeText("Empty")] } },
        children: [],
      }]]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(0);
    }
  });

  it("keeps empty-body create_page_from_file identical and never reads children", async () => {
    const root = await makeTempDir("return-block-map-empty-file-");
    const filePath = join(root, "empty.md");
    await writeFile(filePath, "   ", "utf8");
    const expected = `{"id":"page-created","title":"Empty file","url":"https://notion.so/page-created","success":true,"note":"${NOTE}"}`;

    for (const state of STATES) {
      const notion = makeNotion();
      const raw = await callRaw(
        notion,
        "create_page_from_file",
        { title: "Empty file", file_path: filePath, ...stateArgs(state) },
        { allowWorkspaceParent: true, transport: "stdio", workspaceRoot: root },
      );

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([["pages.create", {
        parent: { type: "workspace", workspace: true },
        properties: { title: { title: [writeText("Empty file")] } },
        children: [],
      }]]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(0);
    }
  });

  it("keeps empty replace_content receipts identical while skipping only the false read", async () => {
    const expected = "{\"success\":true}";
    const updateArgs = {
      page_id: "page-1",
      type: "replace_content",
      replace_content: { new_str: "", allow_deleting_content: true },
    };

    for (const state of STATES) {
      const notion = makeNotion({ tree: { "page-1": [] } });
      const raw = await callRaw(notion, "replace_content", {
        page_id: "page-1",
        markdown: "",
        ...stateArgs(state),
      });

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([
        ["pages.updateMarkdown", updateArgs],
        ...(state === "false"
          ? []
          : [["blocks.children.list", listed("page-1")] as JournalEntry]),
      ]);
      expect(notion.blocks.children.list).toHaveBeenCalledTimes(state === "false" ? 0 : 1);
    }
  });
});

describe("return_block_map dry runs", () => {
  it("has no effect on replace_content dry runs", async () => {
    const expected = "{\"success\":true,\"dry_run\":true,\"operation\":\"replace_content\",\"page_id\":\"page-1\",\"would_update\":true}";

    for (const state of ["absent", "false"] as const) {
      const notion = makeNotion();
      const raw = await callRaw(notion, "replace_content", {
        page_id: "page-1",
        markdown: "Replacement",
        dry_run: true,
        ...stateArgs(state),
      });

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([]);
    }
  });

  it("has no effect on update_section dry runs", async () => {
    const expected = "{\"success\":true,\"dry_run\":true,\"operation\":\"update_section\",\"page_id\":\"page-1\",\"heading\":\"Target\",\"target_block_id\":\"h2-target\",\"target_block_type\":\"heading_2\",\"preserve_heading\":false,\"deleted\":2,\"appended\":1,\"would_delete_block_ids\":[\"h2-target\",\"old-body\"],\"append_parent_id\":\"page-1\",\"append_after_block_id\":\"intro\"}";

    for (const state of ["absent", "false"] as const) {
      const notion = makeNotion({
        tree: {
          "page-1": [
            paragraph("intro", "Intro"),
            heading2("h2-target", "Target"),
            paragraph("old-body", "Old body"),
            heading2("h2-next", "Next"),
          ],
        },
      });
      const raw = await callRaw(notion, "update_section", {
        page_id: "page-1",
        heading: "Target",
        markdown: "Replacement body",
        dry_run: true,
        ...stateArgs(state),
      });

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([["blocks.children.list", listed("page-1")]]);
    }
  });

  it("has no effect on update_toggle dry runs", async () => {
    const expected = "{\"success\":true,\"dry_run\":true,\"operation\":\"update_toggle\",\"page_id\":\"page-1\",\"title\":\"Details\",\"block_id\":\"toggle-1\",\"type\":\"toggle\",\"deleted\":1,\"appended\":1,\"would_delete_block_ids\":[\"old-toggle-child\"],\"append_parent_id\":\"toggle-1\"}";

    for (const state of ["absent", "false"] as const) {
      const notion = makeNotion({
        tree: {
          "page-1": [toggle("toggle-1", "Details")],
          "toggle-1": [paragraph("old-toggle-child", "Old toggle child")],
        },
      });
      const raw = await callRaw(notion, "update_toggle", {
        page_id: "page-1",
        title: "Details",
        markdown: "New toggle body",
        dry_run: true,
        ...stateArgs(state),
      });

      expect(raw).toBe(expected);
      expect(notion.journal).toEqual([
        ["blocks.children.list", listed("page-1")],
        ["blocks.children.list", listed("toggle-1")],
      ]);
    }
  });
});

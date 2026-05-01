import { describe, expect, it } from "vitest";

import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";
import type { NotionBlock } from "../src/types.js";

/**
 * `update_block` accepts a markdown snippet and rewrites a single block. This
 * test simulates the full pipeline: agent input → `markdownToBlocks` → block
 * variant body (the shape `update_block`'s handler extracts and forwards to
 * `blocks.update`) → `blocksToMarkdown` → check we got back the same snippet
 * (or a canonical form). If this round-trip is faithful for every editable
 * type, then `update_block` cannot silently corrupt content.
 *
 * Mirrors the type matrix in plan §5.4. Excludes container/structural types
 * (toggle children, table rows, columns) which `update_block` can't edit
 * anyway — see plan §3.3.
 */

function readFirstBlockBack(parsed: NotionBlock[]): NotionBlock {
  expect(parsed).toHaveLength(1);
  return parsed[0];
}

function roundTrip(markdown: string): string {
  const parsed = markdownToBlocks(markdown);
  const block = readFirstBlockBack(parsed);
  return blocksToMarkdown([block]);
}

describe("update_block round-trip fidelity (markdown → block → markdown)", () => {
  it("paragraph", () => {
    expect(roundTrip("A simple paragraph.")).toBe("A simple paragraph.");
  });

  it("paragraph with inline annotations", () => {
    expect(roundTrip("Some **bold** and *italic* and `code`.")).toBe(
      "Some **bold** and *italic* and `code`.",
    );
  });

  it("heading_1", () => {
    expect(roundTrip("# Heading one")).toBe("# Heading one");
  });

  it("heading_2", () => {
    expect(roundTrip("## Heading two")).toBe("## Heading two");
  });

  it("heading_3", () => {
    expect(roundTrip("### Heading three")).toBe("### Heading three");
  });

  it("bulleted_list_item", () => {
    expect(roundTrip("- bullet body")).toBe("- bullet body");
  });

  it("numbered_list_item", () => {
    expect(roundTrip("1. numbered body")).toBe("1. numbered body");
  });

  it("quote", () => {
    expect(roundTrip("> quote body")).toBe("> quote body");
  });

  it("callout (NOTE)", () => {
    expect(roundTrip("> [!NOTE]\n> note body")).toBe("> [!NOTE]\n> note body");
  });

  it("to_do unchecked", () => {
    expect(roundTrip("- [ ] todo body")).toBe("- [ ] todo body");
  });

  it("to_do checked", () => {
    expect(roundTrip("- [x] done body")).toBe("- [x] done body");
  });

  it("code with language", () => {
    expect(roundTrip("```ts\nconst x = 1;\n```")).toBe("```ts\nconst x = 1;\n```");
  });

  it("equation", () => {
    expect(roundTrip("$$E = mc^2$$")).toBe("$$E = mc^2$$");
  });

  it("toggle (plain)", () => {
    expect(roundTrip("+++ Toggle title\n+++")).toBe("+++ Toggle title\n+++");
  });
});

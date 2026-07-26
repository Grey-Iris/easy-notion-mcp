import { describe, expect, it } from "vitest";
import { blockTextToRichText, markdownToBlocks } from "../src/markdown-to-blocks.js";
import { translateGfmToEnhancedMarkdown } from "../src/markdown-to-enhanced.js";
import type { NotionBlock, RichText } from "../src/types.js";

function textOf(richText: RichText[] | undefined): string {
  return (richText ?? [])
    .map((item) => (item.type === "text" ? item.text.content : item.plain_text ?? ""))
    .join("");
}

function richTextOf(block: NotionBlock): RichText[] {
  return ((block as any)[block.type]?.rich_text ?? []) as RichText[];
}

const ON = { collapseSoftWraps: true };

// A paragraph hard-wrapped at ~78 columns, the convention in most repo markdown.
const HARD_WRAPPED = [
  "The converter walks the token tree produced by the markdown parser and",
  "maps each token onto the Notion block that represents it, which keeps the",
  "agent-facing interface plain markdown.",
].join("\n");

const HARD_WRAPPED_JOINED =
  "The converter walks the token tree produced by the markdown parser and " +
  "maps each token onto the Notion block that represents it, which keeps the " +
  "agent-facing interface plain markdown.";

describe("collapse_soft_wraps", () => {
  // 1. The default must not move. This is the whole point of the opt-in shape.
  describe("default is unchanged", () => {
    it("keeps a soft-wrapped paragraph as one rich-text item containing newlines", () => {
      const blocks = markdownToBlocks(HARD_WRAPPED);

      // Exact block-array assertion, not concatenated text, so any drift in the
      // default shape fails here rather than hiding behind a join().
      expect(blocks).toEqual([
        {
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: HARD_WRAPPED } }],
          },
        },
      ]);
    });

    it("is identical whether the option is absent or explicitly false", () => {
      expect(markdownToBlocks(HARD_WRAPPED, { collapseSoftWraps: false })).toEqual(
        markdownToBlocks(HARD_WRAPPED),
      );
    });
  });

  // 2. The reported defect, fixed only when asked for.
  it("collapses a hard-wrapped paragraph into one run with spaces when ON", () => {
    const blocks = markdownToBlocks(HARD_WRAPPED, ON);

    expect(blocks).toHaveLength(1);
    const runs = richTextOf(blocks[0]);
    expect(runs).toHaveLength(1);
    expect(textOf(runs)).not.toContain("\n");
    expect(textOf(runs)).toBe(HARD_WRAPPED_JOINED);
  });

  // 3. Blank lines are paragraph breaks, not soft wraps.
  it("still splits blank-line-separated paragraphs when ON", () => {
    const blocks = markdownToBlocks("First para line one\nfirst line two\n\nSecond para.", ON);

    expect(blocks).toHaveLength(2);
    expect(textOf(richTextOf(blocks[0]))).toBe("First para line one first line two");
    expect(textOf(richTextOf(blocks[1]))).toBe("Second para.");
  });

  // 4. Explicit hard breaks keep their block-path behavior in BOTH modes.
  describe("explicit hard breaks are untouched on the block path", () => {
    for (const [name, markdown] of [
      ["trailing backslash", "line one\\\nline two"],
      ["two trailing spaces", "line one  \nline two"],
    ] as const) {
      it(`${name} stays a literal newline when ON`, () => {
        expect(textOf(richTextOf(markdownToBlocks(markdown, ON)[0]))).toBe("line one\nline two");
      });

      it(`${name} stays a literal newline by default`, () => {
        expect(textOf(richTextOf(markdownToBlocks(markdown)[0]))).toBe("line one\nline two");
      });
    }
  });

  // 5. Code is literal by definition.
  it("leaves newlines inside a fenced code block untouched when ON", () => {
    const blocks = markdownToBlocks("```js\nconst a = 1;\nconst b = 2;\n```", ON);

    expect(blocks[0].type).toBe("code");
    expect(textOf(richTextOf(blocks[0]))).toBe("const a = 1;\nconst b = 2;");
  });

  // 6. The "\n\n" join trap: blockquoteToBlock packs a multi-paragraph quote or
  // callout body into ONE rich-text field separated by blank lines. Collapsing
  // those would destroy paragraph structure that round-trip fixtures pin.
  describe("multi-paragraph quote and callout keep their paragraph separation", () => {
    const quote = "> para one\n> wrapped on\n>\n> para two";
    const callout = "> [!NOTE]\n> para one\n> wrapped on\n>\n> para two";

    it("quote, ON: wraps collapse but the blank-line separator survives", () => {
      const blocks = markdownToBlocks(quote, ON);

      expect(blocks[0].type).toBe("quote");
      expect(textOf(richTextOf(blocks[0]))).toBe("para one wrapped on\n\npara two");
    });

    it("callout, ON: wraps collapse but the blank-line separator survives", () => {
      const blocks = markdownToBlocks(callout, ON);

      expect(blocks[0].type).toBe("callout");
      expect(textOf(richTextOf(blocks[0]))).toBe("para one wrapped on\n\npara two");
    });

    it("quote, OFF: byte-for-byte unchanged", () => {
      expect(markdownToBlocks(quote, { collapseSoftWraps: false })).toEqual(
        markdownToBlocks(quote),
      );
      expect(textOf(richTextOf(markdownToBlocks(quote)[0]))).toBe(
        "para one\nwrapped on\n\npara two",
      );
    });

    it("callout, OFF: byte-for-byte unchanged", () => {
      expect(textOf(richTextOf(markdownToBlocks(callout)[0]))).toBe(
        "para one\nwrapped on\n\npara two",
      );
    });
  });

  // 7. The wrap problem is not paragraph-only.
  describe("collapsing reaches nested inline text when ON", () => {
    it("collapses inside list items", () => {
      const blocks = markdownToBlocks("- item one wrapped\n  across lines\n- item two", ON);

      expect(blocks).toHaveLength(2);
      expect(textOf(richTextOf(blocks[0]))).toBe("item one wrapped across lines");
      expect(textOf(richTextOf(blocks[1]))).toBe("item two");
    });

    it("collapses inside a single-paragraph quote", () => {
      const blocks = markdownToBlocks("> quoted line one\n> quoted line two", ON);

      expect(blocks[0].type).toBe("quote");
      expect(textOf(richTextOf(blocks[0]))).toBe("quoted line one quoted line two");
    });

    it("collapses inside toggles", () => {
      const blocks = markdownToBlocks("+++ Title\nbody line one\nbody line two\n+++", ON);

      expect(blocks[0].type).toBe("toggle");
      const children = (blocks[0] as any).toggle.children as NotionBlock[];
      expect(textOf(richTextOf(children[0]))).toBe("body line one body line two");
    });

    it("collapses across an emphasis span", () => {
      const blocks = markdownToBlocks("**bold start\nbold end** tail", ON);

      expect(textOf(richTextOf(blocks[0]))).toBe("bold start bold end tail");
      expect(richTextOf(blocks[0])[0].annotations?.bold).toBe(true);
    });

    it("normalizes CRLF wraps", () => {
      expect(textOf(richTextOf(markdownToBlocks("line one\r\nline two", ON)[0]))).toBe(
        "line one line two",
      );
    });

    it("does not double up spaces around a wrapped line", () => {
      expect(textOf(richTextOf(markdownToBlocks("line one \n    line two", ON)[0]))).toBe(
        "line one line two",
      );
    });
  });

  // 8. The enhanced path (replace_content) shares the one converter.
  describe("enhanced path", () => {
    it("collapses soft wraps when ON", () => {
      expect(translateGfmToEnhancedMarkdown(HARD_WRAPPED, ON).enhanced).toBe(HARD_WRAPPED_JOINED);
    });

    it("is byte-identical to today when OFF", () => {
      expect(translateGfmToEnhancedMarkdown(HARD_WRAPPED, { collapseSoftWraps: false }).enhanced).toBe(
        translateGfmToEnhancedMarkdown(HARD_WRAPPED).enhanced,
      );
      expect(translateGfmToEnhancedMarkdown(HARD_WRAPPED).enhanced).toBe(HARD_WRAPPED);
    });

    it("serializes an explicit hard break as a bare newline, in both modes", () => {
      // Documents a real limitation rather than leaving it silent: Notion's
      // Enhanced Markdown import treats a raw newline as a paragraph split, so a
      // hard break written through replace_content arrives as two paragraphs.
      // collapse_soft_wraps neither causes nor fixes that.
      expect(translateGfmToEnhancedMarkdown("line one\\\nline two").enhanced).toBe(
        "line one\nline two",
      );
      expect(translateGfmToEnhancedMarkdown("line one\\\nline two", ON).enhanced).toBe(
        "line one\nline two",
      );
    });
  });

  // 9. add_comment routes through the inline lexer, so it gets the same option.
  describe("comment text", () => {
    it("collapses soft wraps when ON", () => {
      expect(textOf(blockTextToRichText("comment line one\ncomment line two", ON))).toBe(
        "comment line one comment line two",
      );
    });

    it("is unchanged by default", () => {
      expect(textOf(blockTextToRichText("comment line one\ncomment line two"))).toBe(
        "comment line one\ncomment line two",
      );
    });
  });
});

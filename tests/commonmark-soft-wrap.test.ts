import { describe, expect, it } from "vitest";
import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";
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

// A paragraph hard-wrapped at ~78 columns, the convention in most repo markdown.
const HARD_WRAPPED = [
  "The converter walks the token tree produced by the markdown parser and",
  "maps each token onto the Notion block that represents it, which keeps the",
  "agent-facing interface plain markdown.",
].join("\n");

describe("CommonMark soft-wrap collapsing", () => {
  // 1. The reported defect: hard-wrapped source must not arrive with ragged breaks.
  it("collapses a hard-wrapped paragraph into one run with spaces", () => {
    const blocks = markdownToBlocks(HARD_WRAPPED);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");

    const runs = richTextOf(blocks[0]);
    expect(runs).toHaveLength(1);
    expect(textOf(runs)).not.toContain("\n");
    expect(textOf(runs)).toBe(
      "The converter walks the token tree produced by the markdown parser and " +
        "maps each token onto the Notion block that represents it, which keeps the " +
        "agent-facing interface plain markdown.",
    );
  });

  // 2. Blank lines are paragraph breaks, not soft wraps.
  it("still splits blank-line-separated paragraphs into separate blocks", () => {
    const blocks = markdownToBlocks("First paragraph line one\nfirst line two\n\nSecond paragraph.");

    expect(blocks).toHaveLength(2);
    expect(textOf(richTextOf(blocks[0]))).toBe("First paragraph line one first line two");
    expect(textOf(richTextOf(blocks[1]))).toBe("Second paragraph.");
  });

  // 3. Hard break, backslash form.
  it("keeps a trailing-backslash hard break as a literal newline", () => {
    const blocks = markdownToBlocks("line one\\\nline two");

    expect(textOf(richTextOf(blocks[0]))).toBe("line one\nline two");
  });

  // 4. Hard break, two-trailing-spaces form.
  it("keeps a two-trailing-space hard break as a literal newline", () => {
    const blocks = markdownToBlocks("line one  \nline two");

    expect(textOf(richTextOf(blocks[0]))).toBe("line one\nline two");
  });

  // 5. Code is literal by definition.
  it("leaves newlines inside a fenced code block untouched", () => {
    const blocks = markdownToBlocks("```js\nconst a = 1;\nconst b = 2;\n```");

    expect(blocks[0].type).toBe("code");
    expect(textOf(richTextOf(blocks[0]))).toBe("const a = 1;\nconst b = 2;");
  });

  // 6. The opt-out must reproduce the pre-change behavior exactly. These
  // expectations were captured from the converter before the default changed.
  describe("preserve_line_breaks reproduces the previous behavior", () => {
    const pinned: Array<{ name: string; markdown: string; expected: string }> = [
      {
        name: "hard-wrapped paragraph",
        markdown: HARD_WRAPPED,
        expected: HARD_WRAPPED,
      },
      { name: "two lines", markdown: "line one\nline two", expected: "line one\nline two" },
      {
        name: "list item wrapped across lines",
        markdown: "- item one wrapped\n  across lines",
        expected: "item one wrapped\nacross lines",
      },
      {
        name: "quote wrapped across lines",
        markdown: "> quoted line one\n> quoted line two",
        expected: "quoted line one\nquoted line two",
      },
    ];

    for (const { name, markdown, expected } of pinned) {
      it(name, () => {
        const blocks = markdownToBlocks(markdown, { preserveLineBreaks: true });
        expect(textOf(richTextOf(blocks[0]))).toBe(expected);
      });
    }

    it("leaves paragraph splitting alone", () => {
      const blocks = markdownToBlocks("a one\na two\n\nb one", { preserveLineBreaks: true });
      expect(blocks).toHaveLength(2);
      expect(textOf(richTextOf(blocks[0]))).toBe("a one\na two");
    });
  });

  // 7. Round-trip symmetry: a real Notion line break must survive read, edit, write.
  describe("round-trip symmetry", () => {
    it("preserves an intra-block newline through blocksToMarkdown and back", () => {
      const original: NotionBlock[] = [
        { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "line one\nline two" } }] } },
      ];

      const markdown = blocksToMarkdown(original);
      // Emitted as a CommonMark hard break, not a bare newline.
      expect(markdown).toBe("line one\\\nline two");

      const roundTripped = markdownToBlocks(markdown);
      expect(textOf(richTextOf(roundTripped[0]))).toBe("line one\nline two");
    });

    it("preserves an intra-block newline inside a quote", () => {
      const original: NotionBlock[] = [
        { type: "quote", quote: { rich_text: [{ type: "text", text: { content: "q one\nq two" } }] } },
      ];

      const roundTripped = markdownToBlocks(blocksToMarkdown(original));
      expect(roundTripped[0].type).toBe("quote");
      expect(textOf(richTextOf(roundTripped[0]))).toBe("q one\nq two");
    });

    it("leaves a paragraph break inside a quote as a blank quote line", () => {
      // A blank line is already a paragraph break in markdown, so it needs no
      // hard-break marker. Marking it would put a stray backslash on the empty line.
      const original: NotionBlock[] = [
        { type: "quote", quote: { rich_text: [{ type: "text", text: { content: "q one\n\nq two" } }] } },
      ];

      const markdown = blocksToMarkdown(original);
      expect(markdown).toBe("> q one\n> \n> q two");
      expect(textOf(richTextOf(markdownToBlocks(markdown)[0]))).toBe("q one\n\nq two");
    });

    it("marks a lone newline but not the blank line beside it", () => {
      const original: NotionBlock[] = [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: "one\ntwo\n\nthree" } }] },
        },
      ];

      expect(blocksToMarkdown(original)).toBe("one\\\ntwo\n\nthree");
    });

    it("survives a second round trip without accumulating backslashes", () => {
      const original: NotionBlock[] = [
        { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "line one\nline two" } }] } },
      ];

      const once = blocksToMarkdown(original);
      const twice = blocksToMarkdown(markdownToBlocks(once));
      expect(twice).toBe(once);
    });

    it("emits a hard break into Enhanced Markdown so replace_content keeps it", () => {
      const { enhanced } = translateGfmToEnhancedMarkdown("line one\\\nline two");
      expect(enhanced).toBe("line one\\\nline two");
    });

    it("collapses newlines in table cells, which cannot express a break", () => {
      const original: NotionBlock[] = [
        {
          type: "table",
          table: {
            table_width: 1,
            has_column_header: true,
            has_row_header: false,
            children: [
              { type: "table_row", table_row: { cells: [[{ type: "text", text: { content: "a\nb" } }]] } },
            ],
          },
        },
      ];

      expect(blocksToMarkdown(original)).toBe("| a b |\n| --- |");
    });
  });

  // 8. The wrap problem is not paragraph-only.
  describe("collapsing applies to nested inline text", () => {
    it("collapses inside list items", () => {
      const blocks = markdownToBlocks("- item one wrapped\n  across lines\n- item two");

      expect(blocks).toHaveLength(2);
      expect(textOf(richTextOf(blocks[0]))).toBe("item one wrapped across lines");
      expect(textOf(richTextOf(blocks[1]))).toBe("item two");
    });

    it("collapses inside quotes", () => {
      const blocks = markdownToBlocks("> quoted line one\n> quoted line two");

      expect(blocks[0].type).toBe("quote");
      expect(textOf(richTextOf(blocks[0]))).toBe("quoted line one quoted line two");
    });

    it("keeps blank-line paragraph breaks inside a quote", () => {
      const blocks = markdownToBlocks("> q one\n> q two\n>\n> q three");

      expect(textOf(richTextOf(blocks[0]))).toBe("q one q two\n\nq three");
    });

    it("collapses inside callouts", () => {
      const blocks = markdownToBlocks("> [!NOTE]\n> callout line one\n> callout line two");

      expect(blocks[0].type).toBe("callout");
      expect(textOf(richTextOf(blocks[0]))).toBe("callout line one callout line two");
    });

    it("collapses inside toggles", () => {
      const blocks = markdownToBlocks("+++ Title\nbody line one\nbody line two\n+++");

      expect(blocks[0].type).toBe("toggle");
      const children = (blocks[0] as any).toggle.children as NotionBlock[];
      expect(textOf(richTextOf(children[0]))).toBe("body line one body line two");
    });

    it("collapses inside emphasis spanning a wrap", () => {
      const blocks = markdownToBlocks("**bold start\nbold end** tail");

      expect(textOf(richTextOf(blocks[0]))).toBe("bold start bold end tail");
      expect(richTextOf(blocks[0])[0].annotations?.bold).toBe(true);
    });

    it("collapses inside table cells", () => {
      const blocks = markdownToBlocks("| h |\n| --- |\n| cell |");

      expect(blocks[0].type).toBe("table");
    });

    it("collapses inside headings", () => {
      const blocks = markdownToBlocks("# Heading");

      expect(blocks[0].type).toBe("heading_1");
      expect(textOf(richTextOf(blocks[0]))).toBe("Heading");
    });
  });

  describe("whitespace handling", () => {
    it("does not double up spaces when a wrapped line has trailing whitespace", () => {
      // One trailing space is not a hard break; two would be.
      const blocks = markdownToBlocks("line one \nline two");

      expect(textOf(richTextOf(blocks[0]))).toBe("line one line two");
    });

    it("strips leading indentation on a continuation line", () => {
      const blocks = markdownToBlocks("line one\n    line two");

      expect(textOf(richTextOf(blocks[0]))).toBe("line one line two");
    });

    it("normalizes CRLF wraps", () => {
      const blocks = markdownToBlocks("line one\r\nline two");

      expect(textOf(richTextOf(blocks[0]))).toBe("line one line two");
    });
  });
});

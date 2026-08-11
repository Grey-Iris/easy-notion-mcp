import { describe, expect, it } from "vitest";
import { markdownToBlocks, stripLeadingH1 } from "../src/markdown-to-blocks.js";
import type { NotionBlock } from "../src/types.js";

// A pure leaf factory. It builds a literal rich-text run so the block fixtures
// below stay readable; it never compares anything, so a fixture can only match
// the exact object it spells out.
function t(content: string, annotations?: Record<string, boolean>) {
  return annotations
    ? { type: "text", text: { content }, annotations }
    : { type: "text", text: { content } };
}

const BODY: NotionBlock = {
  type: "paragraph",
  paragraph: { rich_text: [t("body")] },
} as NotionBlock;

// A paragraph hard wrapped the way repo markdown usually is, so the combined
// collapse_soft_wraps row can actually observe the collapse.
const WRAPPED_SOURCE = "Body line one\nline two";
const WRAPPED_JOINED = "Body line one line two";

type Row = {
  name: string;
  markdown: string;
  /** Converter options used for BOTH the off and on fixtures of this row. */
  options?: { collapseSoftWraps?: boolean };
  /** Exact converter output with the strip not applied. */
  off: NotionBlock[];
  /** Exact converter output with the strip applied. */
  on: NotionBlock[];
};

const ATX_OFF: NotionBlock[] = [
  { type: "heading_1", heading_1: { rich_text: [t("Title")] } } as NotionBlock,
  BODY,
];
const ATX_ON: NotionBlock[] = [BODY];

// Every row spells out both results as fixed objects. Nested and no-op rows
// repeat the same array in `off` and `on` on purpose: the proof that the flag
// is a no-op there is that both equal the SAME literal, not that they equal
// each other.
const MATRIX: Row[] = [
  { name: "ATX H1, LF", markdown: "# Title\n\nbody", off: ATX_OFF, on: ATX_ON },
  { name: "ATX H1, CRLF", markdown: "# Title\r\n\r\nbody", off: ATX_OFF, on: ATX_ON },
  { name: "setext H1, LF", markdown: "Title\n=====\n\nbody", off: ATX_OFF, on: ATX_ON },
  { name: "setext H1, CRLF", markdown: "Title\r\n=====\r\n\r\nbody", off: ATX_OFF, on: ATX_ON },
  {
    name: "leading blank and whitespace-only lines before the H1",
    markdown: "\n\n   \n# Title\n\nbody",
    off: ATX_OFF,
    on: ATX_ON,
  },
  {
    name: "formatted H1 strips as a whole block",
    markdown: "# **Bold** title\n\nbody",
    off: [
      {
        type: "heading_1",
        heading_1: { rich_text: [t("Bold", { bold: true }), t(" title")] },
      } as NotionBlock,
      BODY,
    ],
    on: [BODY],
  },
  {
    name: "mention-bearing H1 strips as a whole block",
    markdown:
      "# @[Some Page](https://www.notion.so/Some-Page-1234567890abcdef1234567890abcdef)\n\nbody",
    off: [
      {
        type: "heading_1",
        heading_1: {
          rich_text: [
            {
              type: "mention",
              mention: { type: "page", page: { id: "1234567890abcdef1234567890abcdef" } },
              plain_text: "Some Page",
              href: "https://www.notion.so/Some-Page-1234567890abcdef1234567890abcdef",
            },
          ],
        },
      } as unknown as NotionBlock,
      BODY,
    ],
    on: [BODY],
  },
  {
    // Production does not recognize YAML frontmatter. It converts to a divider
    // and a setext heading_2, so the H1 is not the first block and the flag is
    // a no-op. Ignoring frontmatter is a separate feature, out of scope here.
    name: "frontmatter pushes the H1 out of first position, so it is a no-op",
    markdown: "---\ntitle: Meta\n---\n# Title\n\nbody",
    off: [
      { type: "divider", divider: {} } as NotionBlock,
      { type: "heading_2", heading_2: { rich_text: [t("title: Meta")] } } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } } as NotionBlock,
      BODY,
    ],
    on: [
      { type: "divider", divider: {} } as NotionBlock,
      { type: "heading_2", heading_2: { rich_text: [t("title: Meta")] } } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } } as NotionBlock,
      BODY,
    ],
  },
  {
    name: "H2 first is a no-op",
    markdown: "## Second-level\n\nbody",
    off: [
      { type: "heading_2", heading_2: { rich_text: [t("Second-level")] } } as NotionBlock,
      BODY,
    ],
    on: [
      { type: "heading_2", heading_2: { rich_text: [t("Second-level")] } } as NotionBlock,
      BODY,
    ],
  },
  {
    name: "H1 nested inside a toggle is a no-op",
    markdown: "+++ Toggle\n# Child\n+++",
    off: [
      {
        type: "toggle",
        toggle: {
          rich_text: [t("Toggle")],
          children: [
            { type: "heading_1", heading_1: { rich_text: [t("Child")] } },
          ],
        },
      } as NotionBlock,
    ],
    on: [
      {
        type: "toggle",
        toggle: {
          rich_text: [t("Toggle")],
          children: [
            { type: "heading_1", heading_1: { rich_text: [t("Child")] } },
          ],
        },
      } as NotionBlock,
    ],
  },
  {
    name: "a toggleable heading_1 container is never stripped",
    markdown: "+++ # Toggle heading\nbody\n+++",
    off: [
      {
        type: "heading_1",
        heading_1: {
          rich_text: [t("Toggle heading")],
          is_toggleable: true,
          children: [BODY],
        },
      } as NotionBlock,
    ],
    on: [
      {
        type: "heading_1",
        heading_1: {
          rich_text: [t("Toggle heading")],
          is_toggleable: true,
          children: [BODY],
        },
      } as NotionBlock,
    ],
  },
  {
    // Anti-filter-then-strip. An implementation that skips the toggleable
    // heading and strips the next ordinary heading_1 fails here.
    name: "a leading toggleable H1 does not promote the following ordinary H1",
    markdown: "+++ # Toggle heading\nbody\n+++\n\n# Ordinary Title\n\nbody",
    off: [
      {
        type: "heading_1",
        heading_1: {
          rich_text: [t("Toggle heading")],
          is_toggleable: true,
          children: [BODY],
        },
      } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Ordinary Title")] } } as NotionBlock,
      BODY,
    ],
    on: [
      {
        type: "heading_1",
        heading_1: {
          rich_text: [t("Toggle heading")],
          is_toggleable: true,
          children: [BODY],
        },
      } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Ordinary Title")] } } as NotionBlock,
      BODY,
    ],
  },
  {
    // Anti-filter-then-strip. An implementation that skips the leading
    // paragraph and strips the next heading_1 fails here.
    name: "a leading paragraph does not promote the following H1",
    markdown: "Intro paragraph.\n\n# Ordinary Title\n\nbody",
    off: [
      { type: "paragraph", paragraph: { rich_text: [t("Intro paragraph.")] } } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Ordinary Title")] } } as NotionBlock,
      BODY,
    ],
    on: [
      { type: "paragraph", paragraph: { rich_text: [t("Intro paragraph.")] } } as NotionBlock,
      { type: "heading_1", heading_1: { rich_text: [t("Ordinary Title")] } } as NotionBlock,
      BODY,
    ],
  },
  {
    name: "H1 inside a column is a no-op",
    markdown: "::: columns\n::: column\n# In column\n:::\n:::",
    off: [
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: {
                children: [
                  { type: "heading_1", heading_1: { rich_text: [t("In column")] } },
                ],
              },
            },
          ],
        },
      } as NotionBlock,
    ],
    on: [
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: {
                children: [
                  { type: "heading_1", heading_1: { rich_text: [t("In column")] } },
                ],
              },
            },
          ],
        },
      } as NotionBlock,
    ],
  },
  {
    name: "H1 inside a blockquote is a no-op",
    markdown: "> # Quoted\n\nbody",
    off: [
      { type: "quote", quote: { rich_text: [t("# Quoted")] } } as NotionBlock,
      BODY,
    ],
    on: [
      { type: "quote", quote: { rich_text: [t("# Quoted")] } } as NotionBlock,
      BODY,
    ],
  },
  {
    name: "H1 inside a list item is a no-op",
    markdown: "- # In list\n\nbody",
    off: [
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [t("In list")] },
      } as NotionBlock,
      BODY,
    ],
    on: [
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [t("In list")] },
      } as NotionBlock,
      BODY,
    ],
  },
  {
    name: "a document that is only an H1 yields an empty body",
    markdown: "# Title",
    off: [{ type: "heading_1", heading_1: { rich_text: [t("Title")] } } as NotionBlock],
    on: [],
  },
  {
    name: "combined with collapse_soft_wraps, both apply",
    markdown: `# Title\n\n${WRAPPED_SOURCE}`,
    options: { collapseSoftWraps: true },
    off: [
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } } as NotionBlock,
      { type: "paragraph", paragraph: { rich_text: [t(WRAPPED_JOINED)] } } as NotionBlock,
    ],
    on: [
      { type: "paragraph", paragraph: { rich_text: [t(WRAPPED_JOINED)] } } as NotionBlock,
    ],
  },
];

describe("stripLeadingH1 input-class matrix", () => {
  for (const row of MATRIX) {
    describe(row.name, () => {
      it("matches the fixed expected blocks with the flag absent", () => {
        expect(markdownToBlocks(row.markdown, row.options ?? {})).toEqual(row.off);
      });

      it("matches the same fixed expected blocks with the flag explicitly false", () => {
        expect(
          stripLeadingH1(markdownToBlocks(row.markdown, row.options ?? {}), false),
        ).toEqual(row.off);
      });

      it("matches the fixed expected blocks with the flag true", () => {
        expect(
          stripLeadingH1(markdownToBlocks(row.markdown, row.options ?? {}), true),
        ).toEqual(row.on);
      });

      // Supplemental only. The fixed-object assertions above are the proof.
      it("is identical whether the flag is absent or explicitly false", () => {
        expect(
          stripLeadingH1(markdownToBlocks(row.markdown, row.options ?? {}), false),
        ).toEqual(markdownToBlocks(row.markdown, row.options ?? {}));
      });
    });
  }
});

describe("stripLeadingH1 orthogonality with collapse_soft_wraps", () => {
  const markdown = `# Title\n\n${WRAPPED_SOURCE}`;

  it("strips without collapsing when only the strip is on", () => {
    expect(stripLeadingH1(markdownToBlocks(markdown), true)).toEqual([
      { type: "paragraph", paragraph: { rich_text: [t(WRAPPED_SOURCE)] } },
    ]);
  });

  it("collapses without stripping when only collapse is on", () => {
    expect(markdownToBlocks(markdown, { collapseSoftWraps: true })).toEqual([
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } },
      { type: "paragraph", paragraph: { rich_text: [t(WRAPPED_JOINED)] } },
    ]);
  });
});

describe("stripLeadingH1 boundaries", () => {
  it("returns an empty array unchanged", () => {
    expect(stripLeadingH1([], true)).toEqual([]);
  });

  it("strips a heading_1 that carries an explicit is_toggleable: false", () => {
    const blocks = [
      {
        type: "heading_1",
        heading_1: { rich_text: [t("Title")], is_toggleable: false },
      },
      BODY,
    ] as NotionBlock[];

    expect(stripLeadingH1(blocks, true)).toEqual([BODY]);
  });

  it("leaves a leading heading_2 and a leading heading_3 alone", () => {
    const h2 = [
      { type: "heading_2", heading_2: { rich_text: [t("Two")] } },
      BODY,
    ] as NotionBlock[];
    const h3 = [
      { type: "heading_3", heading_3: { rich_text: [t("Three")] } },
      BODY,
    ] as NotionBlock[];

    expect(stripLeadingH1(h2, true)).toEqual([
      { type: "heading_2", heading_2: { rich_text: [t("Two")] } },
      BODY,
    ]);
    expect(stripLeadingH1(h3, true)).toEqual([
      { type: "heading_3", heading_3: { rich_text: [t("Three")] } },
      BODY,
    ]);
  });

  it("does not mutate the array it is given, on the branch that strips", () => {
    const blocks = [
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } },
      BODY,
    ] as NotionBlock[];

    const result = stripLeadingH1(blocks, true);

    expect(result).toEqual([BODY]);
    expect(blocks).toEqual([
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } },
      BODY,
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("returns the same array reference when the flag is off, so the default path allocates nothing", () => {
    const blocks = [
      { type: "heading_1", heading_1: { rich_text: [t("Title")] } },
    ] as NotionBlock[];

    expect(stripLeadingH1(blocks, false)).toBe(blocks);
    expect(stripLeadingH1(blocks, undefined)).toBe(blocks);
  });
});

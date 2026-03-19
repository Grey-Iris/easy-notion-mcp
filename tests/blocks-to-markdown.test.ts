import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";
import type { NotionBlock, RichText } from "../src/types.js";

function text(
  content: string,
  options: {
    link?: string;
    annotations?: RichText["annotations"];
  } = {},
): RichText {
  const result: RichText = {
    type: "text",
    text: {
      content,
    },
  };

  if (options.link) {
    result.text.link = { url: options.link };
  }

  if (options.annotations) {
    result.annotations = options.annotations;
  }

  return result;
}

describe("blocksToMarkdown", () => {
  it("converts headings", () => {
    const blocks: NotionBlock[] = [
      { type: "heading_1", heading_1: { rich_text: [text("H1")] } },
      { type: "heading_2", heading_2: { rich_text: [text("H2")] } },
      { type: "heading_3", heading_3: { rich_text: [text("H3")] } },
    ];

    expect(blocksToMarkdown(blocks)).toBe("# H1\n\n## H2\n\n### H3");
  });

  it("converts paragraphs with inline markdown", () => {
    const blocks: NotionBlock[] = [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            text("bold", { annotations: { bold: true } }),
            text(" "),
            text("italic", { annotations: { italic: true } }),
            text(" "),
            text("code", { annotations: { code: true } }),
            text(" "),
            text("link", { link: "https://example.com" }),
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("**bold** *italic* `code` [link](https://example.com)");
  });

  it("converts bulleted list items", () => {
    const blocks: NotionBlock[] = [
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [text("item")] },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("- item");
  });

  it("converts numbered list items", () => {
    const blocks: NotionBlock[] = [
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [text("item")] },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("1. item");
  });

  it("converts quotes", () => {
    const blocks: NotionBlock[] = [
      { type: "quote", quote: { rich_text: [text("quoted text")] } },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> quoted text");
  });

  it("converts note callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a note")],
          icon: { type: "emoji", emoji: "💡" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!NOTE]\n> This is a note");
  });

  it("converts tip callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a tip")],
          icon: { type: "emoji", emoji: "💚" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!TIP]\n> This is a tip");
  });

  it("converts warning callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a warning")],
          icon: { type: "emoji", emoji: "⚠️" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!WARNING]\n> This is a warning");
  });

  it("converts important callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is important")],
          icon: { type: "emoji", emoji: "🔴" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!IMPORTANT]\n> This is important");
  });

  it("converts info callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is info")],
          icon: { type: "emoji", emoji: "ℹ️" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!INFO]\n> This is info");
  });

  it("converts success callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is success")],
          icon: { type: "emoji", emoji: "✅" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!SUCCESS]\n> This is success");
  });

  it("converts error callouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "callout",
        callout: {
          rich_text: [text("This is error")],
          icon: { type: "emoji", emoji: "❌" },
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("> [!ERROR]\n> This is error");
  });

  it("converts equation blocks", () => {
    const blocks: NotionBlock[] = [
      {
        type: "equation",
        equation: { expression: "E=mc^2" },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("$$E=mc^2$$");
  });

  it("normalizes multi-line equation markdown", () => {
    expect(blocksToMarkdown(markdownToBlocks("$$\nE=mc^2\n$$"))).toBe("$$E=mc^2$$");
  });

  it("converts code blocks", () => {
    const blocks: NotionBlock[] = [
      {
        type: "code",
        code: { rich_text: [text("console.log(\"hello\")")], language: "javascript" },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("```javascript\nconsole.log(\"hello\")\n```");
  });

  it("converts dividers", () => {
    const blocks: NotionBlock[] = [{ type: "divider", divider: {} }];

    expect(blocksToMarkdown(blocks)).toBe("---");
  });

  it("converts todos", () => {
    const blocks: NotionBlock[] = [
      { type: "to_do", to_do: { rich_text: [text("unchecked")], checked: false } },
      { type: "to_do", to_do: { rich_text: [text("checked")], checked: true } },
    ];

    expect(blocksToMarkdown(blocks)).toBe("- [ ] unchecked\n- [x] checked");
  });

  it("converts images", () => {
    const blocks: NotionBlock[] = [
      {
        type: "image",
        image: { type: "external", external: { url: "https://example.com/img.png" } },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("![](https://example.com/img.png)");
  });

  it("converts nested list items", () => {
    const blocks: NotionBlock[] = [
      {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [text("parent")],
          children: [
            {
              type: "bulleted_list_item",
              bulleted_list_item: { rich_text: [text("child")] },
            },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("- parent\n  - child");
  });

  it("converts tables to markdown", () => {
    const blocks: NotionBlock[] = [
      {
        type: "table",
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            { type: "table_row", table_row: { cells: [[text("Name")], [text("Age")]] } },
            { type: "table_row", table_row: { cells: [[text("Jane")], [text("30")]] } },
            { type: "table_row", table_row: { cells: [[text("John")], [text("28")]] } },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      "| Name | Age |\n| --- | --- |\n| Jane | 30 |\n| John | 28 |",
    );
  });

  it("converts tables with inline formatting in cells", () => {
    const blocks: NotionBlock[] = [
      {
        type: "table",
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            { type: "table_row", table_row: { cells: [[text("Name")], [text("Notes")]] } },
            {
              type: "table_row",
              table_row: {
                cells: [[text("Jane")], [text("Lead", { annotations: { bold: true } })]],
              },
            },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      "| Name | Notes |\n| --- | --- |\n| Jane | **Lead** |",
    );
  });

  it("converts simple toggles", () => {
    const blocks: NotionBlock[] = [
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Details")],
          children: [{ type: "paragraph", paragraph: { rich_text: [text("Hidden text")] } }],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("+++ Details\nHidden text\n+++");
  });

  it("converts toggles with multiple children", () => {
    const blocks: NotionBlock[] = [
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Details")],
          children: [
            { type: "paragraph", paragraph: { rich_text: [text("Paragraph")] } },
            { type: "bulleted_list_item", bulleted_list_item: { rich_text: [text("item")] } },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("+++ Details\nParagraph\n\n- item\n+++");
  });

  it("converts empty toggles", () => {
    const blocks: NotionBlock[] = [
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Empty")],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("+++ Empty\n+++");
  });

  it("round-trips toggle markdown", () => {
    const markdown = "+++ Details\nParagraph\n\n- item\n+++";
    expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);
  });

  it("converts two-column layouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: {
                children: [{ type: "paragraph", paragraph: { rich_text: [text("Left side content")] } }],
              },
            },
            {
              type: "column",
              column: {
                children: [{ type: "paragraph", paragraph: { rich_text: [text("Right side content")] } }],
              },
            },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      "::: columns\n::: column\nLeft side content\n:::\n::: column\nRight side content\n:::\n:::",
    );
  });

  it("converts three-column layouts", () => {
    const blocks: NotionBlock[] = [
      {
        type: "column_list",
        column_list: {
          children: [
            { type: "column", column: { children: [{ type: "paragraph", paragraph: { rich_text: [text("One")] } }] } },
            { type: "column", column: { children: [{ type: "paragraph", paragraph: { rich_text: [text("Two")] } }] } },
            { type: "column", column: { children: [{ type: "paragraph", paragraph: { rich_text: [text("Three")] } }] } },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      "::: columns\n::: column\nOne\n:::\n::: column\nTwo\n:::\n::: column\nThree\n:::\n:::",
    );
  });

  it("converts columns with mixed content", () => {
    const blocks: NotionBlock[] = [
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: {
                children: [
                  { type: "heading_1", heading_1: { rich_text: [text("Left")] } },
                  { type: "paragraph", paragraph: { rich_text: [text("Paragraph")] } },
                ],
              },
            },
            {
              type: "column",
              column: {
                children: [{ type: "heading_2", heading_2: { rich_text: [text("Right")] } }],
              },
            },
          ],
        },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      "::: columns\n::: column\n# Left\n\nParagraph\n:::\n::: column\n## Right\n:::\n:::",
    );
  });

  it("converts bookmark blocks", () => {
    const blocks: NotionBlock[] = [
      {
        type: "bookmark",
        bookmark: { url: "https://example.com" },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("https://example.com");
  });

  it("converts table of contents blocks", () => {
    const blocks: NotionBlock[] = [
      {
        type: "table_of_contents",
        table_of_contents: {},
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("[toc]");
  });

  it("converts embed blocks", () => {
    const blocks: NotionBlock[] = [
      {
        type: "embed",
        embed: { url: "https://example.com/video" },
      },
    ];

    expect(blocksToMarkdown(blocks)).toBe("[embed](https://example.com/video)");
  });

  it("converts file blocks with external URL", () => {
    const blocks: NotionBlock[] = [
      {
        type: "file",
        file: { type: "external", external: { url: "https://example.com/doc.pdf" }, name: "doc.pdf" },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe("[doc.pdf](https://example.com/doc.pdf)");
  });

  it("converts audio blocks with external URL", () => {
    const blocks: NotionBlock[] = [
      {
        type: "audio",
        audio: { type: "external", external: { url: "https://example.com/song.mp3" } },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe("[audio](https://example.com/song.mp3)");
  });

  it("converts video blocks with external URL", () => {
    const blocks: NotionBlock[] = [
      {
        type: "video",
        video: { type: "external", external: { url: "https://example.com/clip.mp4" } },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe("[video](https://example.com/clip.mp4)");
  });

  it("converts file blocks with file_upload type (empty URL)", () => {
    const blocks: NotionBlock[] = [
      {
        type: "file",
        file: { type: "file_upload", file_upload: { id: "upload-123" }, name: "doc.pdf" },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe("[doc.pdf]()");
  });
});

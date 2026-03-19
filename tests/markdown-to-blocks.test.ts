import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { isSafeUrl, markdownToBlocks } from "../src/markdown-to-blocks.js";
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

describe("markdownToBlocks", () => {
  it("validates safe URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("not-a-url")).toBe(false);
  });

  it("converts headings", () => {
    expect(markdownToBlocks("# H1")).toEqual([
      { type: "heading_1", heading_1: { rich_text: [text("H1")] } },
    ]);
    expect(markdownToBlocks("## H2")).toEqual([
      { type: "heading_2", heading_2: { rich_text: [text("H2")] } },
    ]);
    expect(markdownToBlocks("### H3")).toEqual([
      { type: "heading_3", heading_3: { rich_text: [text("H3")] } },
    ]);
  });

  it("converts a paragraph", () => {
    expect(markdownToBlocks("Hello world")).toEqual([
      { type: "paragraph", paragraph: { rich_text: [text("Hello world")] } },
    ]);
  });

  it("converts bold text", () => {
    expect(markdownToBlocks("**bold**")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("bold", { annotations: { bold: true } })] },
      },
    ]);
  });

  it("converts italic text", () => {
    expect(markdownToBlocks("*italic*")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("italic", { annotations: { italic: true } })] },
      },
    ]);
  });

  it("converts strikethrough text", () => {
    expect(markdownToBlocks("~~strike~~")).toEqual([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [text("strike", { annotations: { strikethrough: true } })],
        },
      },
    ]);
  });

  it("converts inline code", () => {
    expect(markdownToBlocks("`code`")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("code", { annotations: { code: true } })] },
      },
    ]);
  });

  it("converts links", () => {
    expect(markdownToBlocks("[text](https://example.com)")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("text", { link: "https://example.com" })] },
      },
    ]);
  });

  it("converts composed annotations", () => {
    expect(markdownToBlocks("***bold italic***")).toEqual([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [text("bold italic", { annotations: { bold: true, italic: true } })],
        },
      },
    ]);
  });

  it("converts bulleted lists", () => {
    expect(markdownToBlocks("- item 1\n- item 2")).toEqual([
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [text("item 1")] },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [text("item 2")] },
      },
    ]);
  });

  it("converts numbered lists", () => {
    expect(markdownToBlocks("1. first\n2. second")).toEqual([
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [text("first")] },
      },
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [text("second")] },
      },
    ]);
  });

  it("converts nested lists", () => {
    expect(markdownToBlocks("- parent\n  - child")).toEqual([
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
    ]);
  });

  it("converts todo items", () => {
    expect(markdownToBlocks("- [ ] unchecked\n- [x] checked")).toEqual([
      { type: "to_do", to_do: { rich_text: [text("unchecked")], checked: false } },
      { type: "to_do", to_do: { rich_text: [text("checked")], checked: true } },
    ]);
  });

  it("converts blockquotes", () => {
    expect(markdownToBlocks("> quoted text")).toEqual([
      { type: "quote", quote: { rich_text: [text("quoted text")] } },
    ]);
  });

  it("converts code blocks", () => {
    expect(markdownToBlocks("```javascript\nconsole.log(\"hello\")\n```")).toEqual([
      {
        type: "code",
        code: { rich_text: [text("console.log(\"hello\")")], language: "javascript" },
      },
    ]);
  });

  it("converts dividers", () => {
    expect(markdownToBlocks("---")).toEqual([{ type: "divider", divider: {} }]);
  });

  it("converts images", () => {
    expect(markdownToBlocks("![alt](https://example.com/img.png)")).toEqual([
      {
        type: "image",
        image: { type: "external", external: { url: "https://example.com/img.png" } },
      },
    ]);
  });

  it("keeps safe image URLs as image blocks", () => {
    expect(markdownToBlocks("![alt](https://example.com/image.png)")).toEqual([
      {
        type: "image",
        image: { type: "external", external: { url: "https://example.com/image.png" } },
      },
    ]);
  });

  it("renders unsafe image URLs as paragraphs", () => {
    expect(markdownToBlocks("![alt](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("alt")] },
      },
    ]);
  });

  it("converts NOTE callouts", () => {
    expect(markdownToBlocks("> [!NOTE]\n> This is a note")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a note")],
          icon: { type: "emoji", emoji: "💡" },
        },
      },
    ]);
  });

  it("converts TIP callouts", () => {
    expect(markdownToBlocks("> [!TIP]\n> This is a tip")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a tip")],
          icon: { type: "emoji", emoji: "💚" },
        },
      },
    ]);
  });

  it("converts WARNING callouts", () => {
    expect(markdownToBlocks("> [!WARNING]\n> This is a warning")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is a warning")],
          icon: { type: "emoji", emoji: "⚠️" },
        },
      },
    ]);
  });

  it("converts IMPORTANT callouts", () => {
    expect(markdownToBlocks("> [!IMPORTANT]\n> This is important")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is important")],
          icon: { type: "emoji", emoji: "🔴" },
        },
      },
    ]);
  });

  it("converts INFO callouts", () => {
    expect(markdownToBlocks("> [!INFO]\n> This is info")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is info")],
          icon: { type: "emoji", emoji: "ℹ️" },
        },
      },
    ]);
  });

  it("converts SUCCESS callouts", () => {
    expect(markdownToBlocks("> [!SUCCESS]\n> This is success")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is success")],
          icon: { type: "emoji", emoji: "✅" },
        },
      },
    ]);
  });

  it("converts ERROR callouts", () => {
    expect(markdownToBlocks("> [!ERROR]\n> This is error")).toEqual([
      {
        type: "callout",
        callout: {
          rich_text: [text("This is error")],
          icon: { type: "emoji", emoji: "❌" },
        },
      },
    ]);
  });

  it("converts single-line equations", () => {
    expect(markdownToBlocks("$$E=mc^2$$")).toEqual([
      {
        type: "equation",
        equation: { expression: "E=mc^2" },
      },
    ]);
  });

  it("converts multi-line equations", () => {
    expect(markdownToBlocks("$$\nE=mc^2\n$$")).toEqual([
      {
        type: "equation",
        equation: { expression: "E=mc^2" },
      },
    ]);
  });

  it("converts table of contents blocks", () => {
    expect(markdownToBlocks("[toc]")).toEqual([
      {
        type: "table_of_contents",
        table_of_contents: {},
      },
    ]);
  });

  it("converts embed blocks", () => {
    expect(markdownToBlocks("[embed](https://example.com/video)")).toEqual([
      {
        type: "embed",
        embed: { url: "https://example.com/video" },
      },
    ]);
  });

  it("renders unsafe embed URLs as paragraphs", () => {
    expect(markdownToBlocks("[embed](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("embed")] },
      },
    ]);
  });

  it("converts a complex document", () => {
    const markdown = [
      "# Title",
      "",
      "Hello **world**",
      "",
      "- item 1",
      "- [x] done",
      "",
      "> [!NOTE]",
      "> Remember this",
      "",
      "```ts",
      "console.log(\"ok\")",
      "```",
      "",
      "---",
      "",
      "![alt](https://example.com/image.png)",
    ].join("\n");

    expect(markdownToBlocks(markdown)).toEqual([
      { type: "heading_1", heading_1: { rich_text: [text("Title")] } },
      {
        type: "paragraph",
        paragraph: {
          rich_text: [text("Hello "), text("world", { annotations: { bold: true } })],
        },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [text("item 1")] },
      },
      { type: "to_do", to_do: { rich_text: [text("done")], checked: true } },
      {
        type: "callout",
        callout: {
          rich_text: [text("Remember this")],
          icon: { type: "emoji", emoji: "💡" },
        },
      },
      {
        type: "code",
        code: { rich_text: [text("console.log(\"ok\")")], language: "ts" },
      },
      { type: "divider", divider: {} },
      {
        type: "image",
        image: { type: "external", external: { url: "https://example.com/image.png" } },
      },
    ]);
  });

  it("converts simple tables", () => {
    expect(markdownToBlocks("| Name | Age |\n| --- | --- |\n| Jane | 30 |\n| John | 28 |")).toEqual([
      {
        type: "table",
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              type: "table_row",
              table_row: { cells: [[text("Name")], [text("Age")]] },
            },
            {
              type: "table_row",
              table_row: { cells: [[text("Jane")], [text("30")]] },
            },
            {
              type: "table_row",
              table_row: { cells: [[text("John")], [text("28")]] },
            },
          ],
        },
      },
    ]);
  });

  it("converts three-column tables", () => {
    expect(markdownToBlocks("| Name | Role | Team |\n| --- | --- | --- |\n| Jane | Dev | Alpha |")).toEqual([
      {
        type: "table",
        table: {
          table_width: 3,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              type: "table_row",
              table_row: { cells: [[text("Name")], [text("Role")], [text("Team")]] },
            },
            {
              type: "table_row",
              table_row: { cells: [[text("Jane")], [text("Dev")], [text("Alpha")]] },
            },
          ],
        },
      },
    ]);
  });

  it("converts tables with formatted cells", () => {
    expect(markdownToBlocks("| Name | Notes |\n| --- | --- |\n| Jane | **Lead** |")).toEqual([
      {
        type: "table",
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              type: "table_row",
              table_row: { cells: [[text("Name")], [text("Notes")]] },
            },
            {
              type: "table_row",
              table_row: {
                cells: [[text("Jane")], [text("Lead", { annotations: { bold: true } })]],
              },
            },
          ],
        },
      },
    ]);
  });

  it("converts single-row tables", () => {
    expect(markdownToBlocks("| Name | Age |\n| --- | --- |\n| Jane | 30 |")).toEqual([
      {
        type: "table",
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              type: "table_row",
              table_row: { cells: [[text("Name")], [text("Age")]] },
            },
            {
              type: "table_row",
              table_row: { cells: [[text("Jane")], [text("30")]] },
            },
          ],
        },
      },
    ]);
  });

  it("converts simple toggles", () => {
    expect(markdownToBlocks("+++ Details\nHidden text\n+++")).toEqual([
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Details")],
          children: [{ type: "paragraph", paragraph: { rich_text: [text("Hidden text")] } }],
        },
      },
    ]);
  });

  it("converts toggles with multiple children", () => {
    expect(markdownToBlocks("+++ Details\nParagraph\n\n- item\n+++\n")).toEqual([
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
    ]);
  });

  it("converts empty toggles", () => {
    expect(markdownToBlocks("+++ Empty\n+++")).toEqual([
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Empty")],
        },
      },
    ]);
  });

  it("round-trips toggle markdown", () => {
    const markdown = "+++ Details\nParagraph\n\n- item\n+++";
    expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);
  });

  it("converts two-column layouts", () => {
    expect(
      markdownToBlocks("::: columns\n::: column\nLeft side content\n:::\n::: column\nRight side content\n:::\n:::"),
    ).toEqual([
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: {
                children: [
                  { type: "paragraph", paragraph: { rich_text: [text("Left side content")] } },
                ],
              },
            },
            {
              type: "column",
              column: {
                children: [
                  { type: "paragraph", paragraph: { rich_text: [text("Right side content")] } },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it("converts three-column layouts", () => {
    expect(
      markdownToBlocks("::: columns\n::: column\nOne\n:::\n::: column\nTwo\n:::\n::: column\nThree\n:::\n:::"),
    ).toEqual([
      {
        type: "column_list",
        column_list: {
          children: [
            {
              type: "column",
              column: { children: [{ type: "paragraph", paragraph: { rich_text: [text("One")] } }] },
            },
            {
              type: "column",
              column: { children: [{ type: "paragraph", paragraph: { rich_text: [text("Two")] } }] },
            },
            {
              type: "column",
              column: {
                children: [{ type: "paragraph", paragraph: { rich_text: [text("Three")] } }],
              },
            },
          ],
        },
      },
    ]);
  });

  it("converts columns with mixed content", () => {
    expect(
      markdownToBlocks("::: columns\n::: column\n# Left\n\nParagraph\n:::\n::: column\n## Right\n:::\n:::"),
    ).toEqual([
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
    ]);
  });

  it("converts bare URLs into bookmark blocks", () => {
    expect(markdownToBlocks("https://example.com")).toEqual([
      {
        type: "bookmark",
        bookmark: { url: "https://example.com" },
      },
    ]);
  });

  it("keeps safe bookmark URLs as bookmark blocks", () => {
    expect(markdownToBlocks("https://example.com/path")).toEqual([
      {
        type: "bookmark",
        bookmark: { url: "https://example.com/path" },
      },
    ]);
  });

  it("renders unsafe bookmark URLs as paragraphs", () => {
    expect(markdownToBlocks("javascript:alert(1)")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("javascript:alert(1)")] },
      },
    ]);
  });

  it("keeps inline URLs inside paragraphs", () => {
    expect(markdownToBlocks("Check this https://example.com out")).toEqual([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            text("Check this "),
            text("https://example.com", { link: "https://example.com" }),
            text(" out"),
          ],
        },
      },
    ]);
  });

  it("keeps named links as paragraphs", () => {
    expect(markdownToBlocks("[Example](https://example.com)")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("Example", { link: "https://example.com" })] },
      },
    ]);
  });

  it("renders unsafe inline links as plain text", () => {
    expect(markdownToBlocks("[click](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        paragraph: { rich_text: [text("click")] },
      },
    ]);
  });

  it("ignores custom delimiters inside fenced code blocks", () => {
    expect(markdownToBlocks("```md\n+++ Not a toggle\n:::\n```")).toEqual([
      {
        type: "code",
        code: {
          rich_text: [text("+++ Not a toggle\n:::")],
          language: "md",
        },
      },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(markdownToBlocks("")).toEqual([]);
  });

  it("converts notion-upload image tokens to file_upload image blocks", () => {
    expect(markdownToBlocks("![screenshot](notion-upload:abc123:image)")).toEqual([
      {
        type: "image",
        image: { type: "file_upload", file_upload: { id: "abc123" } },
      },
    ]);
  });

  it("converts notion-upload file tokens to file blocks", () => {
    expect(markdownToBlocks("[report.pdf](notion-upload:def456:file)")).toEqual([
      {
        type: "file",
        file: { type: "file_upload", file_upload: { id: "def456" }, name: "report.pdf" },
      },
    ]);
  });

  it("converts notion-upload audio tokens to audio blocks", () => {
    expect(markdownToBlocks("[song.mp3](notion-upload:ghi789:audio)")).toEqual([
      {
        type: "audio",
        audio: { type: "file_upload", file_upload: { id: "ghi789" } },
      },
    ]);
  });

  it("converts notion-upload video tokens to video blocks", () => {
    expect(markdownToBlocks("[clip.mp4](notion-upload:jkl012:video)")).toEqual([
      {
        type: "video",
        video: { type: "file_upload", file_upload: { id: "jkl012" } },
      },
    ]);
  });
});

import { blocksToMarkdown } from "../src/blocks-to-markdown.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";

function roundTrip(markdown: string): string {
  return blocksToMarkdown(markdownToBlocks(markdown));
}

describe("round-trip fidelity", () => {
  it("round-trips headings", () => {
    const input = ["# Main Title", "", "## Section", "", "### Subsection"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a paragraph with inline formatting", () => {
    const input =
      "This has **bold**, *italic*, ~~struck~~, `code`, and [a link](https://example.com)";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a bullet list with nested items", () => {
    const input = ["- First item", "  - Nested under first", "- Second item"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a numbered list with nested items", () => {
    const input = ["1. Step one", "  1. Sub-step", "1. Step two"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a task list", () => {
    const input = ["- [ ] Buy groceries", "- [x] Write tests"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a code block with language", () => {
    const input = [
      "```typescript",
      "function greet(name: string): string {",
      "  return `Hello, ${name}!`;",
      "}",
      "```",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a code block without language", () => {
    const input = [
      "```",
      "some plain text content",
      "with multiple lines",
      "```",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a table", () => {
    const input = [
      "| Feature | Status | Owner |",
      "| --- | --- | --- |",
      "| Auth | **Done** | Alice |",
      "| Search | Pending | Bob |",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a blockquote", () => {
    const input = "> This is a quoted passage";

    expect(roundTrip(input)).toBe(input);
  });

  it.each([
    ["NOTE", "Remember to check the logs"],
    ["TIP", "Use keyboard shortcuts for speed"],
    ["WARNING", "This action cannot be undone"],
    ["IMPORTANT", "Read the migration guide first"],
    ["INFO", "Server maintenance scheduled Friday"],
    ["SUCCESS", "All tests passed"],
    ["ERROR", "Build failed with exit code 1"],
  ])("round-trips %s callouts", (label, body) => {
    const input = [`> [!${label}]`, `> ${body}`].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a toggle with content", () => {
    const input = ["+++ Click to expand", "This content is hidden by default", "+++"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a toggle with nested blocks", () => {
    const input = [
      "+++ Implementation details",
      "Key points:",
      "",
      "- Uses a recursive parser",
      "- Handles edge cases",
      "",
      "```typescript",
      "const result = parse(input);",
      "```",
      "+++",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a column layout", () => {
    const input = [
      "::: columns",
      "::: column",
      "Left side content",
      ":::",
      "::: column",
      "Right side content",
      ":::",
      ":::",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a single-line equation", () => {
    const input = "$$E=mc^2$$";

    expect(roundTrip(input)).toBe(input);
  });

  it("normalizes a multi-line equation to single-line output", () => {
    expect(roundTrip("$$\nE=mc^2\n$$")).toBe("$$E=mc^2$$");
  });

  it("round-trips a divider", () => {
    const input = "---";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a bookmark", () => {
    const input = "https://example.com/article";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips an image", () => {
    const input = "![](https://example.com/photo.jpg)";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips an embed", () => {
    const input = "[embed](https://youtube.com/watch?v=abc123)";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips a table of contents block", () => {
    const input = "[toc]";

    expect(roundTrip(input)).toBe(input);
  });

  it("keeps a named link as a paragraph instead of a bookmark", () => {
    const input = "[Example Site](https://example.com)";

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips an empty toggle", () => {
    const input = ["+++ Empty section", "+++"].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("round-trips mixed content", () => {
    const input = [
      "# Project Status",
      "",
      "This project is **actively maintained** and open source.",
      "",
      "## Features",
      "",
      "- Markdown parsing",
      "- Block conversion",
      "  - Nested support",
      "",
      "> [!NOTE]",
      "> See the docs for details",
      "",
      "```typescript",
      'console.log("hello");',
      "```",
      "",
      "---",
      "",
      "[toc]",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });
});

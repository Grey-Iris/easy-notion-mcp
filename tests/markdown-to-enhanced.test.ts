import { describe, expect, it } from "vitest";

import { translateGfmToEnhancedMarkdown } from "../src/markdown-to-enhanced.js";

/**
 * Property-style coverage for the GFM-with-extensions → Notion Enhanced Markdown
 * translator. For each block type in SUPPORTED_BLOCK_TYPES we assert two things:
 *
 *   1. The translator emits the documented Enhanced Markdown form
 *      (https://developers.notion.com/guides/data-apis/enhanced-markdown).
 *   2. The output diverges from the input only where Probe 2 (live findings,
 *      .meta/research/pr3-live-probe-findings-2026-04-28.md) showed it has to
 *      diverge — i.e. for the custom syntaxes Notion's atomic replace endpoint
 *      does NOT recognize. Where input and output already match (e.g. headings,
 *      code), we hold them stable to catch silent over-translation.
 */

describe("translateGfmToEnhancedMarkdown — per-block-type coverage", () => {
  it("paragraph passes through unchanged", () => {
    const { enhanced, warnings } = translateGfmToEnhancedMarkdown("Hello world.");
    expect(enhanced).toBe("Hello world.");
    expect(warnings).toEqual([]);
  });

  it("paragraph with inline annotations preserves markdown form", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("Some **bold** and *italic* and `code` and ~~strike~~.");
    expect(enhanced).toBe("Some **bold** and *italic* and `code` and ~~strike~~.");
  });

  it("paragraph with link preserves markdown form", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("Visit [example](https://example.com).");
    expect(enhanced).toBe("Visit [example](https://example.com).");
  });

  it("heading_1 passes through unchanged", () => {
    expect(translateGfmToEnhancedMarkdown("# H1").enhanced).toBe("# H1");
  });

  it("heading_2 passes through unchanged", () => {
    expect(translateGfmToEnhancedMarkdown("## H2").enhanced).toBe("## H2");
  });

  it("heading_3 passes through unchanged", () => {
    expect(translateGfmToEnhancedMarkdown("### H3").enhanced).toBe("### H3");
  });

  it("toggle: +++ Title / +++ → <details><summary>Title</summary>...</details>", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("+++ Toggle title\nbody content\n+++");
    expect(enhanced).toBe("<details>\n<summary>Toggle title</summary>\n\tbody content\n</details>");
  });

  it("toggle without body emits empty <details>", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("+++ Empty toggle\n+++");
    expect(enhanced).toBe("<details>\n<summary>Empty toggle</summary>\n</details>");
  });

  it("toggle heading: +++ ## Title → ## Title {toggle=\"true\"} with indented children", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("+++ ## Toggleable H2\nchild paragraph\n+++");
    expect(enhanced).toBe("## Toggleable H2 {toggle=\"true\"}\n\tchild paragraph");
  });

  it("bulleted_list_item passes through with indented children", () => {
    expect(translateGfmToEnhancedMarkdown("- bullet body").enhanced).toBe("- bullet body");
  });

  it("numbered_list_item passes through", () => {
    expect(translateGfmToEnhancedMarkdown("1. numbered body").enhanced).toBe("1. numbered body");
  });

  it("quote passes through", () => {
    expect(translateGfmToEnhancedMarkdown("> quote body").enhanced).toBe("> quote body");
  });

  it("callout (NOTE) translates to <callout> XML", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("> [!NOTE]\n> note body");
    expect(enhanced).toBe('<callout icon="\u{1F4A1}" color="default">\n\tnote body\n</callout>');
  });

  it("callout (WARNING) uses warning emoji", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("> [!WARNING]\n> warning body");
    expect(enhanced).toBe('<callout icon="⚠️" color="yellow_background">\n\twarning body\n</callout>');
  });

  it.each([
    ["NOTE", "💡", "default"],
    ["TIP", "💡", "green_background"],
    ["WARNING", "⚠️", "yellow_background"],
    ["IMPORTANT", "⚠️", "red_background"],
    ["INFO", "ℹ️", "blue_background"],
    ["SUCCESS", "✅", "green_background"],
    ["ERROR", "❌", "red_background"],
  ])("callout (%s) emits the required icon and color", (marker, icon, color) => {
    const { enhanced } = translateGfmToEnhancedMarkdown(`> [!${marker}]\n> ${marker.toLowerCase()} body`);
    expect(enhanced).toBe(`<callout icon="${icon}" color="${color}">\n\t${marker.toLowerCase()} body\n</callout>`);
  });

  it("equation: $$expr$$ → block-level $$\\nexpr\\n$$", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("$$E = mc^2$$");
    expect(enhanced).toBe("$$\nE = mc^2\n$$");
  });

  it("equation multi-line keeps its expression", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("$$\nx + y = z\n$$");
    expect(enhanced).toBe("$$\nx + y = z\n$$");
  });

  it("table_of_contents: [toc] → <table_of_contents/>", () => {
    expect(translateGfmToEnhancedMarkdown("[toc]").enhanced).toBe("<table_of_contents/>");
  });

  it("divider: --- passes through", () => {
    expect(translateGfmToEnhancedMarkdown("---").enhanced).toBe("---");
  });

  it("to_do unchecked passes through", () => {
    expect(translateGfmToEnhancedMarkdown("- [ ] todo body").enhanced).toBe("- [ ] todo body");
  });

  it("to_do checked passes through", () => {
    expect(translateGfmToEnhancedMarkdown("- [x] done body").enhanced).toBe("- [x] done body");
  });

  it("code block with language preserves fence + language", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("```ts\nconst x = 1;\n```");
    expect(enhanced).toBe("```ts\nconst x = 1;\n```");
  });

  it("code block without language uses 'plain text' label", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("```\nbare code\n```");
    expect(enhanced).toBe("```plain text\nbare code\n```");
  });

  it("columns: ::: columns syntax → <columns><column>... XML", () => {
    const input = "::: columns\n::: column\nLeft.\n:::\n::: column\nRight.\n:::\n:::";
    const { enhanced } = translateGfmToEnhancedMarkdown(input);
    expect(enhanced).toContain("<columns>");
    expect(enhanced).toContain("<column>");
    expect(enhanced).toContain("Left.");
    expect(enhanced).toContain("Right.");
    expect(enhanced).toContain("</column>");
    expect(enhanced).toContain("</columns>");
  });

  it("table: GFM pipe-table → <table> XML with rows", () => {
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { enhanced } = translateGfmToEnhancedMarkdown(input);
    expect(enhanced).toContain("<table");
    expect(enhanced).toContain("<tr>");
    expect(enhanced).toContain("<td>A</td>");
    expect(enhanced).toContain("<td>1</td>");
  });

  it("escapes literal closing callout tags in callout body text", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("> [!NOTE]\n> Literal </callout> text");
    expect(enhanced).toBe('<callout icon="💡" color="default">\n\tLiteral \\</callout\\> text\n</callout>');
  });

  it("escapes literal XML-like tags in callout body text", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("> [!NOTE]\n> Use <tag> here");
    expect(enhanced).toBe('<callout icon="💡" color="default">\n\tUse \\<tag\\> here\n</callout>');
  });

  it("escapes XML-like text in details summary and body text", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("+++ <summary>\nBody </details> text\n+++");
    expect(enhanced).toBe("<details>\n<summary>\\<summary\\></summary>\n\tBody \\</details\\> text\n</details>");
  });

  it("escapes pipe characters in table cells", () => {
    const input = "| Value |\n| --- |\n| a \\| b |";
    const { enhanced } = translateGfmToEnhancedMarkdown(input);
    expect(enhanced).toContain("<td>a \\| b</td>");
  });

  it("escapes literal closing column tags in column body text", () => {
    const input = "::: columns\n::: column\nLiteral </column> text\n:::\n:::";
    const { enhanced } = translateGfmToEnhancedMarkdown(input);
    expect(enhanced).toContain("\t\tLiteral \\</column\\> text");
  });

  it("does not escape inline code content inside callout body text", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("> [!NOTE]\n> `</callout>`");
    expect(enhanced).toBe('<callout icon="💡" color="default">\n\t`</callout>`\n</callout>');
  });

  it("does not escape plain top-level paragraph body text", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("Use <tag> here");
    expect(enhanced).toBe("Use <tag> here");
  });

  it("image: ![](url) → markdown form preserved", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("![alt](https://example.com/x.png)");
    expect(enhanced).toBe("![](https://example.com/x.png)");
  });

  it("bookmark: bare URL emits URL + bookmark_lost warning", () => {
    const { enhanced, warnings } = translateGfmToEnhancedMarkdown("https://example.com/some-page");
    expect(enhanced).toBe("https://example.com/some-page");
    expect(warnings).toEqual([
      { code: "bookmark_lost_on_atomic_replace", url: "https://example.com/some-page" },
    ]);
  });

  it("embed: [embed](url) emits URL + embed_lost warning", () => {
    const { enhanced, warnings } = translateGfmToEnhancedMarkdown("[embed](https://example.com/embed-target)");
    expect(enhanced).toBe("https://example.com/embed-target");
    expect(warnings).toEqual([
      { code: "embed_lost_on_atomic_replace", url: "https://example.com/embed-target" },
    ]);
  });

  it("multiple blocks separated by single newlines", () => {
    const input = "# Title\n\nA paragraph.\n\n- a bullet";
    const { enhanced } = translateGfmToEnhancedMarkdown(input);
    expect(enhanced).toBe("# Title\nA paragraph.\n- a bullet");
  });

  it("empty markdown returns empty translation with no warnings", () => {
    const { enhanced, warnings } = translateGfmToEnhancedMarkdown("");
    expect(enhanced).toBe("");
    expect(warnings).toEqual([]);
  });

  it("whitespace-only markdown returns empty translation", () => {
    const { enhanced } = translateGfmToEnhancedMarkdown("\n\n   \n");
    expect(enhanced).toBe("");
  });
});

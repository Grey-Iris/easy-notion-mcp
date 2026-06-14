import { describe, expect, it } from "vitest";

import { markdownToIr } from "./markdown-to-ir.js";

describe("markdownToIr", () => {
  it("projects headings, nested lists, code, tables, and inline spans", () => {
    const ir = markdownToIr(`# Title

Intro with **bold** and [link](https://example.com).

- Parent
  - Child

\`\`\`typescript
const x = 1;
\`\`\`

| Name | Value |
|---|---|
| A | B |
`);

    expect(ir.title).toBe("Title");
    expect(ir.blocks.map((block) => block.kind)).toEqual([
      "heading_1",
      "paragraph",
      "bulleted_list_item",
      "code",
      "table",
    ]);
    expect(ir.blocks[1]?.spans).toEqual([
      { text: "Intro with " },
      { text: "bold", annotations: { bold: true } },
      { text: " and " },
      { text: "link", href: "https://example.com" },
      { text: "." },
    ]);
    expect(ir.blocks[2]).toMatchObject({
      kind: "bulleted_list_item",
      text: "Parent",
      children: [{ kind: "bulleted_list_item", text: "Child" }],
    });
    expect(ir.blocks[3]).toMatchObject({
      kind: "code",
      language: "typescript",
      text: "const x = 1;",
    });
    expect(ir.blocks[4]?.children?.map((row) => row.text)).toEqual(["Name | Value", "A | B"]);
  });
});

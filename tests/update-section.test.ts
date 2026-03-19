import { describe, expect, it } from "vitest";

function getHeadingLevel(type: string): number {
  if (type === "heading_1") return 1;
  if (type === "heading_2") return 2;
  if (type === "heading_3") return 3;
  return 0;
}

function findSectionEnd(blocks: { type: string }[], headingIndex: number): number {
  const headingLevel = getHeadingLevel(blocks[headingIndex].type);
  let sectionEnd = blocks.length;

  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const level = getHeadingLevel(blocks[index].type);
    if (level > 0 && (headingLevel === 1 || level <= headingLevel)) {
      sectionEnd = index;
      break;
    }
  }

  return sectionEnd;
}

describe("update_section boundary logic", () => {
  it("H1 section ends at the next heading of any level", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "paragraph" },
      { type: "heading_2" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(3);
  });

  it("H1 section ends at the next H1", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "heading_1" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H1 section ends at next H3", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H1 with no subsequent headings extends to end", () => {
    const blocks = [
      { type: "heading_1" },
      { type: "paragraph" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(3);
  });

  it("H2 section ends at next H1 or H2 but not H3", () => {
    const blocks = [
      { type: "heading_2" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_2" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(4);
  });

  it("H2 section ends at H1", () => {
    const blocks = [
      { type: "heading_2" },
      { type: "paragraph" },
      { type: "heading_1" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H3 section ends at next H1, H2, or H3", () => {
    const blocks = [
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_3" },
      { type: "paragraph" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });

  it("H3 section ends at H2", () => {
    const blocks = [
      { type: "heading_3" },
      { type: "paragraph" },
      { type: "heading_2" },
    ];
    expect(findSectionEnd(blocks, 0)).toBe(2);
  });
});

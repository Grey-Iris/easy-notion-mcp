import { notionUrlToPageId } from "../src/markdown-to-blocks.js";

describe("notionUrlToPageId", () => {
  it.each([
    [
      "titled 32-hex page URL",
      "https://www.notion.so/Some-Page-Title-1a2b3c4d5e6f7081920a1b2c3d4e5f60",
      "1a2b3c4d5e6f7081920a1b2c3d4e5f60",
    ],
    [
      "bare 32-hex page URL",
      "https://www.notion.so/1a2b3c4d5e6f7081920a1b2c3d4e5f60",
      "1a2b3c4d5e6f7081920a1b2c3d4e5f60",
    ],
    [
      "dashed UUID page URL",
      "https://www.notion.so/1a2b3c4d-5e6f-7081-920a-1b2c3d4e5f60",
      "1a2b3c4d-5e6f-7081-920a-1b2c3d4e5f60",
    ],
    [
      "peek URL p query param",
      "https://www.notion.so/workspace/Db-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&p=1a2b3c4d5e6f7081920a1b2c3d4e5f60",
      "1a2b3c4d5e6f7081920a1b2c3d4e5f60",
    ],
    [
      "trailing query and hash",
      "https://www.notion.so/Some-Page-Title-1a2b3c4d5e6f7081920a1b2c3d4e5f60?pvs=4#anchor",
      "1a2b3c4d5e6f7081920a1b2c3d4e5f60",
    ],
    [
      "app.notion.com /p/ peek-style URL",
      "https://app.notion.com/p/385be876242f815a992efcedca5bf228",
      "385be876242f815a992efcedca5bf228",
    ],
    [
      "www.notion.com titled URL",
      "https://www.notion.com/My-Page-1a2b3c4d5e6f7081920a1b2c3d4e5f60",
      "1a2b3c4d5e6f7081920a1b2c3d4e5f60",
    ],
  ])("extracts the page id from a %s", (_name, url, expected) => {
    expect(notionUrlToPageId(url)).toBe(expected);
  });

  it("returns null for non-Notion hosts", () => {
    expect(notionUrlToPageId("https://example.com/Some-Page-1a2b3c4d5e6f7081920a1b2c3d4e5f60")).toBeNull();
  });

  it("returns null when no page id is parseable", () => {
    expect(notionUrlToPageId("https://www.notion.so/")).toBeNull();
  });
});

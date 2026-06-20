import {
  blocksContainPageMention,
  downgradeMentionsToLinks,
  isMentionTargetError,
} from "../src/markdown-to-blocks.js";
import type { NotionBlock, RichText } from "../src/types.js";

function text(content: string, link?: string): RichText {
  const item: RichText = { type: "text", text: { content } };
  if (link) {
    item.text.link = { url: link };
  }
  return item;
}

function mention(pageId = "1a2b3c4d5e6f7081920a1b2c3d4e5f60", url = "https://www.notion.so/Page-1a2b3c4d5e6f7081920a1b2c3d4e5f60"): RichText {
  return {
    type: "mention",
    mention: {
      type: "page",
      page: { id: pageId },
    },
    plain_text: "Title",
    href: url,
  } as unknown as RichText;
}

describe("page mention fallback helpers", () => {
  it("detects page mentions in top-level and nested rich text", () => {
    const plain: NotionBlock[] = [
      { type: "paragraph", paragraph: { rich_text: [text("plain")] } },
    ];
    const topLevelMention: NotionBlock[] = [
      { type: "paragraph", paragraph: { rich_text: [mention()] } },
    ];
    const nestedMention: NotionBlock[] = [
      {
        type: "toggle",
        toggle: {
          rich_text: [text("Details")],
          children: [{ type: "paragraph", paragraph: { rich_text: [mention()] } }],
        },
      },
    ];

    expect(blocksContainPageMention(plain)).toBe(false);
    expect(blocksContainPageMention(topLevelMention)).toBe(true);
    expect(blocksContainPageMention(nestedMention)).toBe(true);
  });

  it("downgrades page mentions to text links and reports downgraded targets", () => {
    const pageId = "1a2b3c4d5e6f7081920a1b2c3d4e5f60";
    const url = "https://www.notion.so/Page-1a2b3c4d5e6f7081920a1b2c3d4e5f60";
    const blocks: NotionBlock[] = [
      { type: "paragraph", paragraph: { rich_text: [mention(pageId, url)] } },
    ];

    expect(downgradeMentionsToLinks(blocks)).toEqual({
      blocks: [
        {
          type: "paragraph",
          paragraph: {
            rich_text: [text("Title", url)],
          },
        },
      ],
      downgraded: [{ page_id: pageId, url }],
    });
  });

  it("identifies only Notion mention target errors", () => {
    expect(isMentionTargetError({ code: "validation_error" })).toBe(true);
    expect(isMentionTargetError({ code: "object_not_found" })).toBe(true);
    expect(isMentionTargetError({ code: "rate_limited" })).toBe(false);
    expect(isMentionTargetError(new Error("validation_error"))).toBe(false);
    expect(isMentionTargetError(null)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import { addComment, convertPropertyValue } from "../src/notion-client.js";
import { splitLongRichText } from "../src/rich-text.js";

describe("rich text write normalization", () => {
  it("splits title and rich_text property values at the Notion request limit", () => {
    const title = "t".repeat(4501);
    const notes = "n".repeat(2001);

    expect(convertPropertyValue("title", "Name", title)).toEqual({
      title: [
        { type: "text", text: { content: "t".repeat(2000) } },
        { type: "text", text: { content: "t".repeat(2000) } },
        { type: "text", text: { content: "t".repeat(501) } },
      ],
    });
    expect(convertPropertyValue("rich_text", "Notes", notes)).toEqual({
      rich_text: [
        { type: "text", text: { content: "n".repeat(2000) } },
        { type: "text", text: { content: "n" } },
      ],
    });
  });

  it("sanitizes incoming comment rich_text while preserving link and annotations", async () => {
    const client = {
      comments: {
        create: vi.fn(async (payload: unknown) => payload),
      },
    };
    const content = "linked ".repeat(400);
    const link = { url: "https://example.com" };
    const annotations = { bold: true, color: "blue" };

    await addComment(client as any, "page-1", [{
      type: "text",
      text: { content, link, extra: "drop me" },
      href: link.url,
      plain_text: content,
      annotations,
    }]);

    const payload = client.comments.create.mock.calls[0][0] as any;
    expect(payload.rich_text.map((item: any) => item.text.content).join("")).toBe(content);
    expect(payload.rich_text.every((item: any) => item.text.link === link)).toBe(true);
    expect(payload.rich_text.every((item: any) => item.annotations === annotations)).toBe(true);
    expect(payload.rich_text.every((item: any) => item.type === "text")).toBe(true);
    expect(JSON.stringify(payload.rich_text)).not.toContain("plain_text");
    expect(JSON.stringify(payload.rich_text)).not.toContain("href");
    expect(JSON.stringify(payload.rich_text)).not.toContain("extra");
  });

  it("preserves non-text rich_text items while dropping common response-only fields", () => {
    const mention = {
      type: "mention",
      mention: {
        type: "page",
        page: { id: "page-1" },
      },
      annotations: { italic: true },
      plain_text: "Mentioned page",
      href: "https://www.notion.so/page-1",
    };

    expect(splitLongRichText([mention])).toEqual([{
      type: "mention",
      mention: {
        type: "page",
        page: { id: "page-1" },
      },
      annotations: { italic: true },
    }]);
  });

  it("does not split surrogate pairs and keeps chunks within 2000 UTF-16 code units", () => {
    const emoji = "🙂";
    const content = `${"a".repeat(1999)}${emoji}b`;

    const chunks = splitLongRichText([{ type: "text", text: { content } }]);

    expect(chunks.map((item) => item.text.content.length)).toEqual([1999, 3]);
    expect(chunks.map((item) => item.text.content).join("")).toBe(content);
    expect(chunks.every((item) => item.text.content.length <= 2000)).toBe(true);
    expect(chunks[1].text.content.startsWith(emoji)).toBe(true);
  });
});

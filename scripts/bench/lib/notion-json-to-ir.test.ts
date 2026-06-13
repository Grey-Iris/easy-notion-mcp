import { describe, expect, it } from "vitest";

import { notionJsonToIr } from "./notion-json-to-ir.js";

describe("notionJsonToIr", () => {
  it("projects nested Notion JSON and inventories metadata and colored spans", () => {
    const groundTruth = notionJsonToIr({
      page: {
        id: "page-1",
        properties: {
          Name: { title: [{ type: "text", text: { content: "Fixture title" } }] },
        },
      },
      blocks: [
        block("toggle-1", {
          type: "toggle",
          has_children: true,
          toggle: { rich_text: [{ type: "text", text: { content: "Toggle" } }] },
          children: [
            block("paragraph-1", {
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: "Red" },
                    annotations: { color: "red", bold: true },
                    href: "https://example.com",
                  },
                ],
              },
            }),
          ],
        }),
        block("code-1", {
          type: "code",
          code: { rich_text: [{ type: "text", text: { content: "const x = 1;" } }], language: "typescript" },
        }),
      ],
    });

    expect(groundTruth.ir).toMatchObject({
      kind: "page",
      title: "Fixture title",
      blocks: [
        {
          kind: "toggle",
          text: "Toggle",
          children: [
            {
              kind: "paragraph",
              text: "Red",
              spans: [
                {
                  text: "Red",
                  href: "https://example.com",
                  annotations: { color: "red", bold: true },
                },
              ],
            },
          ],
        },
        { kind: "code", text: "const x = 1;", language: "typescript" },
      ],
    });
    expect(groundTruth.blockCount).toBe(3);
    expect(groundTruth.metadataSlots).toEqual({
      blockId: 3,
      createdTime: 3,
      lastEditedTime: 3,
      createdBy: 3,
      lastEditedBy: 3,
      archived: 3,
    });
    expect(groundTruth.colorSpanSlots).toBe(1);
  });
});

function block(id: string, fields: Record<string, unknown>) {
  return {
    id,
    created_time: "2026-06-13T00:00:00.000Z",
    last_edited_time: "2026-06-13T00:00:00.000Z",
    created_by: { id: "user-1" },
    last_edited_by: { id: "user-1" },
    archived: false,
    ...fields,
  };
}

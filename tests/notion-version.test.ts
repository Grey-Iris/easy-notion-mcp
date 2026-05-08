import { describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() =>
  vi.fn(function MockClient(this: { options?: unknown }, options: unknown) {
    this.options = options;
  }),
);

vi.mock("@notionhq/client", () => ({
  Client: mockClient,
}));

import { createNotionClient } from "../src/notion-client.js";
import { NOTION_VERSION } from "../src/notion-version.js";

describe("Notion API version", () => {
  it("pins the central version constant to the 2026 API", () => {
    expect(NOTION_VERSION).toBe("2026-03-11");
  });

  it("uses the central version when creating SDK clients", () => {
    createNotionClient("secret-token");

    expect(mockClient).toHaveBeenCalledWith({
      auth: "secret-token",
      notionVersion: NOTION_VERSION,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  countOccurrences,
  findSectionRange,
  findToggleRecursiveWithListChildren,
} from "../src/server.js";
import { markdownToBlocks } from "../src/markdown-to-blocks.js";
import { translateGfmToEnhancedMarkdown } from "../src/markdown-to-enhanced.js";

// Regression coverage for issue #69: five entry points that threw an unhandled
// TypeError when an argument arrived as undefined. Each guard returns the
// existing "nothing to do / not found" result instead of crashing.

describe("null guards (issue #69)", () => {
  describe("countOccurrences", () => {
    it("returns 0 when text is undefined (divider block yields undefined markdown)", () => {
      expect(countOccurrences(undefined as any, "needle")).toBe(0);
    });

    it("returns 0 when find is undefined", () => {
      expect(countOccurrences("some text", undefined as any)).toBe(0);
    });

    it("still counts occurrences for well-formed input", () => {
      expect(countOccurrences("a-a-a", "a")).toBe(3);
      expect(countOccurrences("no match here", "xyz")).toBe(0);
    });
  });

  describe("findSectionRange", () => {
    it("does not throw when heading is undefined; reports not found", () => {
      const result = findSectionRange([], undefined as any);
      expect(result.ok).toBe(false);
    });

    it("still resolves a real heading for well-formed input", () => {
      const blocks = [
        { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Intro" }] } },
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } },
      ];
      const result = findSectionRange(blocks, "Intro");
      expect(result.ok).toBe(true);
    });
  });

  describe("markdownToBlocks", () => {
    it("returns [] when markdown is undefined", () => {
      expect(markdownToBlocks(undefined as any)).toEqual([]);
    });

    it("still converts well-formed markdown", () => {
      const blocks = markdownToBlocks("hello");
      expect(blocks.length).toBeGreaterThan(0);
    });
  });

  describe("translateGfmToEnhancedMarkdown", () => {
    it("returns empty result when markdown is undefined", () => {
      const result = translateGfmToEnhancedMarkdown(undefined as any);
      expect(result.enhanced).toBe("");
      expect(result.warnings).toEqual([]);
    });

    it("still translates well-formed markdown", () => {
      const result = translateGfmToEnhancedMarkdown("hello");
      expect(result.enhanced.length).toBeGreaterThan(0);
    });
  });

  describe("findToggleRecursiveWithListChildren", () => {
    it("does not throw when title is undefined; reports no match", async () => {
      const listChildren = async () => [];
      const result = await findToggleRecursiveWithListChildren(
        {} as any,
        "page-1",
        undefined as any,
        listChildren,
      );
      expect(result.block).toBeNull();
      expect(result.availableTitles).toEqual([]);
    });

    it("still finds a matching toggle for well-formed input", async () => {
      const listChildren = async () => [
        { id: "t1", type: "toggle", has_children: false, toggle: { rich_text: [{ plain_text: "Scripts" }] } },
      ];
      const result = await findToggleRecursiveWithListChildren(
        {} as any,
        "page-1",
        "Scripts",
        listChildren,
      );
      expect(result.block?.id).toBe("t1");
    });
  });
});

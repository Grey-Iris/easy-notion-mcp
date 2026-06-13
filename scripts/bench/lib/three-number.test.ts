import { describe, expect, it } from "vitest";

import type { GroundTruth } from "./notion-json-to-ir.js";
import type { ReadResult } from "./read-adapters.js";
import { computeThreeNumber } from "./three-number.js";

describe("computeThreeNumber", () => {
  it("penalizes markdown projections for color and metadata while full projections score complete", async () => {
    const groundTruth: GroundTruth = {
      ir: {
        kind: "page",
        title: "Fixture",
        blocks: [
          {
            kind: "paragraph",
            text: "Red",
            spans: [{ text: "Red", annotations: { color: "red" } }],
          },
        ],
      },
      metadataSlots: {
        blockId: 1,
        createdTime: 1,
        lastEditedTime: 1,
        createdBy: 1,
        lastEditedBy: 1,
        archived: 1,
      },
      colorSpanSlots: 1,
      blockCount: 1,
    };
    const markdownProjection = {
      kind: "page" as const,
      title: "Fixture",
      blocks: [{ kind: "paragraph" as const, text: "Red", spans: [{ text: "Red" }] }],
    };
    const counterInputs: string[] = [];
    const anthropicCount = async (text: string) => {
      counterInputs.push(text);
      return text.length;
    };

    const markdownNumbers = await computeThreeNumber(
      readResult("easy-notion", "raw markdown"),
      markdownProjection,
      groundTruth,
      { anthropicCount },
    );
    const fullNumbers = await computeThreeNumber(
      readResult("makenotion", "raw notion json"),
      groundTruth.ir,
      groundTruth,
      { anthropicCount },
    );

    expect(markdownNumbers.contentCompleteness.score).toBeLessThan(1);
    expect(markdownNumbers.contentCompleteness.lossy).toContain("color");
    expect(markdownNumbers.fullCompleteness.score).toBeLessThan(markdownNumbers.contentCompleteness.score);
    expect(markdownNumbers.fullCompleteness.missing).toEqual(
      expect.arrayContaining(["block-uuid", "timestamps", "authors", "archived"]),
    );
    expect(markdownNumbers.asConsumed.anthropic).toBe("raw markdown".length);
    expect(markdownNumbers.commonIr.anthropic).toBeGreaterThan(0);

    expect(fullNumbers.contentCompleteness.score).toBe(1);
    expect(fullNumbers.fullCompleteness.score).toBe(1);
    expect(fullNumbers.asConsumed.anthropic).toBe("raw notion json".length);
    expect(counterInputs).toHaveLength(4);
  });
});

function readResult(serverId: "easy-notion" | "makenotion", asConsumedText: string): ReadResult {
  return {
    serverId,
    asConsumedText,
    callCount: 1,
    contentField: serverId === "makenotion" ? "" : asConsumedText,
    raw: {},
  };
}

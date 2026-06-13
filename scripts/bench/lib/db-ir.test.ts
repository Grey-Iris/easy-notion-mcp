import { describe, expect, it } from "vitest";

import type { PropertyFixture } from "../corpus/generate.js";
import {
  computeDbThreeNumber,
  dbGroundTruthFromRaw,
  flatRowsToIrDatabase,
  notionRowsToIrDatabase,
} from "./db-ir.js";
import type { DbReadResult } from "./db-adapters.js";

const schema: PropertyFixture[] = [
  { name: "Name", type: "title" },
  { name: "Priority", type: "select", options: ["High", "Low"] },
  { name: "Tags", type: "multi_select", options: ["a", "b"] },
  { name: "Done", type: "checkbox" },
];

describe("DB IR", () => {
  it("projects raw Notion rows and flattened rows into comparable database IR", async () => {
    const raw = {
      results: [
        {
          id: "row-1",
          created_time: "2026-06-13T00:00:00.000Z",
          last_edited_time: "2026-06-13T00:00:00.000Z",
          created_by: { id: "user-1" },
          last_edited_by: { id: "user-1" },
          archived: false,
          properties: {
            Name: {
              id: "title-prop",
              title: [{ type: "text", text: { content: "Row 1" } }],
            },
            Priority: {
              id: "priority-prop",
              select: { id: "option-high", name: "High", color: "red" },
            },
            Tags: {
              id: "tags-prop",
              multi_select: [
                { id: "option-a", name: "a", color: "blue" },
                { id: "option-b", name: "b", color: "green" },
              ],
            },
            Done: { id: "done-prop", checkbox: true },
          },
        },
      ],
    };
    const notionIr = notionRowsToIrDatabase(raw, schema, "DB");
    const flatIr = flatRowsToIrDatabase(
      JSON.stringify({ rows: [{ Name: "Row 1", Priority: "High", Tags: ["a", "b"], Done: true }] }),
      schema,
      "DB",
    );
    const groundTruth = dbGroundTruthFromRaw(raw, schema, "DB");
    const anthropicInputs: string[] = [];
    const anthropicCount = async (text: string) => {
      anthropicInputs.push(text);
      return text.length;
    };

    expect(notionIr.rows[0]?.properties).toEqual({
      Name: "Row 1",
      Priority: { id: "option-high", name: "High", color: "red" },
      Tags: [
        { id: "option-a", name: "a", color: "blue" },
        { id: "option-b", name: "b", color: "green" },
      ],
      Done: true,
    });
    expect(flatIr.rows[0]?.properties).toEqual({
      Name: "Row 1",
      Priority: "High",
      Tags: ["a", "b"],
      Done: true,
    });
    expect(groundTruth.metadataSlots).toEqual({
      rowId: 1,
      createdTime: 1,
      lastEditedTime: 1,
      createdBy: 1,
      lastEditedBy: 1,
      archived: 1,
    });
    expect(groundTruth.propertyMetadataSlots).toEqual({
      propertyId: 4,
      optionId: 3,
      optionColor: 3,
    });

    const flatNumbers = await computeDbThreeNumber(readResult("easy-notion", "flat rows"), flatIr, groundTruth, {
      anthropicCount,
    });
    const notionNumbers = await computeDbThreeNumber(readResult("makenotion", "raw rows"), notionIr, groundTruth, {
      anthropicCount,
    });
    const lossyFlat = flatRowsToIrDatabase(
      JSON.stringify({ rows: [{ Name: "Row 1", Tags: ["a", "b"], Done: true }] }),
      schema,
      "DB",
    );
    const lossyNumbers = await computeDbThreeNumber(readResult("awkoy", "lossy rows"), lossyFlat, groundTruth);

    expect(flatNumbers.contentCompleteness.score).toBe(1);
    expect(flatNumbers.fullCompleteness.score).toBeLessThan(1);
    expect(flatNumbers.fullCompleteness.missing).toEqual(
      expect.arrayContaining(["row-uuid", "timestamps", "authors", "property-id", "select-option-id", "select-option-color"]),
    );
    expect(notionNumbers.contentCompleteness.score).toBe(1);
    expect(notionNumbers.fullCompleteness.score).toBe(1);
    expect(lossyNumbers.contentCompleteness.score).toBeLessThan(1);
    expect(lossyNumbers.contentCompleteness.lossy).toContain("property-value");
    expect(flatNumbers.asConsumed.anthropic).toBe("flat rows".length);
    expect(anthropicInputs).toHaveLength(4);
  });
});

function readResult(serverId: "easy-notion" | "makenotion" | "awkoy", asConsumedText: string): DbReadResult {
  return {
    serverId,
    asConsumedText,
    callCount: 1,
    rows: {},
    raw: {},
  };
}

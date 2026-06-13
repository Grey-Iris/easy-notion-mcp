import { completenessScore, serializeIr, type CompletenessScore, type IrBlock, type IrPage } from "./ir.js";
import type { ReadResult } from "./read-adapters.js";
import type { ServerId } from "./servers.js";
import { countCl100k } from "./token-counter.js";
import type { GroundTruth } from "./notion-json-to-ir.js";

export interface ThreeNumber {
  serverId: ServerId;
  asConsumed: { cl100k: number; anthropic: number | null; bytes: number };
  commonIr: { cl100k: number; anthropic: number | null; bytes: number };
  contentCompleteness: CompletenessScore;
  fullCompleteness: CompletenessScore;
  callCount: number;
}

export interface ComputeThreeNumberOptions {
  anthropicCount?: (text: string) => Promise<number | null>;
}

interface SlotCounts {
  preserved: number;
  total: number;
  missing: Set<string>;
  lossy: Set<string>;
}

export async function computeThreeNumber(
  readResult: ReadResult,
  projectedIr: IrPage,
  groundTruth: GroundTruth,
  opts: ComputeThreeNumberOptions = {},
): Promise<ThreeNumber> {
  const serializedIr = serializeIr(projectedIr);
  const asConsumedAnthropic = opts.anthropicCount ? await opts.anthropicCount(readResult.asConsumedText) : null;
  const commonIrAnthropic = opts.anthropicCount ? await opts.anthropicCount(serializedIr) : null;
  const contentSlots = scoreContent(projectedIr, groundTruth);
  const contentCompleteness = completenessScore({
    preserved: contentSlots.preserved,
    total: contentSlots.total,
    missing: [...contentSlots.missing],
    lossy: [...contentSlots.lossy],
  });
  const metadataTotal = metadataSlotTotal(groundTruth);
  const metadataPreserved = readResult.serverId === "makenotion" ? metadataTotal : 0;
  const fullMissing = new Set(contentCompleteness.missing);

  if (metadataPreserved < metadataTotal) {
    if (groundTruth.metadataSlots.blockId > 0) fullMissing.add("block-uuid");
    if (groundTruth.metadataSlots.createdTime + groundTruth.metadataSlots.lastEditedTime > 0) {
      fullMissing.add("timestamps");
    }
    if (groundTruth.metadataSlots.createdBy + groundTruth.metadataSlots.lastEditedBy > 0) {
      fullMissing.add("authors");
    }
    if (groundTruth.metadataSlots.archived > 0) fullMissing.add("archived");
  }

  return {
    serverId: readResult.serverId,
    asConsumed: {
      cl100k: countCl100k(readResult.asConsumedText),
      anthropic: asConsumedAnthropic,
      bytes: Buffer.byteLength(readResult.asConsumedText, "utf8"),
    },
    commonIr: {
      cl100k: countCl100k(serializedIr),
      anthropic: commonIrAnthropic,
      bytes: Buffer.byteLength(serializedIr, "utf8"),
    },
    contentCompleteness,
    fullCompleteness: completenessScore({
      preserved: contentSlots.preserved + metadataPreserved,
      total: contentSlots.total + metadataTotal,
      missing: [...fullMissing],
      lossy: contentCompleteness.lossy,
    }),
    callCount: readResult.callCount,
  };
}

function scoreContent(projectedIr: IrPage, groundTruth: GroundTruth): SlotCounts {
  const counts: SlotCounts = { preserved: 0, total: 0, missing: new Set(), lossy: new Set() };
  const groundBlocks = flattenBlocks(groundTruth.ir.blocks);
  const projectedBlocks = flattenBlocks(projectedIr.blocks);

  for (const [index, groundBlock] of groundBlocks.entries()) {
    const projectedBlock = projectedBlocks[index];
    slot(counts, projectedBlock?.kind === groundBlock.kind, "block-kind");

    if (groundBlock.text) {
      slot(counts, projectedBlock?.text === groundBlock.text, "text");
    }

    if ((groundBlock.children?.length ?? 0) > 0) {
      slot(counts, (projectedBlock?.children?.length ?? 0) > 0, "nesting");
    }

    switch (groundBlock.kind) {
      case "code":
        slot(counts, projectedBlock?.language === groundBlock.language, "code-language");
        break;
      case "to_do":
        slot(counts, projectedBlock?.checked === groundBlock.checked, "checked");
        break;
      case "image":
      case "file":
      case "bookmark":
      case "embed":
        slot(counts, projectedBlock?.url === groundBlock.url, "asset-metadata");
        if (groundBlock.caption) {
          slot(counts, projectedBlock?.caption === groundBlock.caption, "asset-metadata");
        }
        break;
    }

    scoreSpanAttributes(counts, groundBlock, projectedBlock);
  }

  const projectedColorSlots = projectedBlocks.flatMap((block) => block.spans ?? [])
    .filter((span) => span.annotations?.color && span.annotations.color !== "default").length;
  for (let index = 0; index < groundTruth.colorSpanSlots; index += 1) {
    const preserved = index < projectedColorSlots;
    slot(counts, preserved, "color", "color");
  }

  return counts;
}

function scoreSpanAttributes(counts: SlotCounts, groundBlock: IrBlock, projectedBlock: IrBlock | undefined): void {
  for (const span of groundBlock.spans ?? []) {
    const projectedSpan = findProjectedSpan(projectedBlock, span.text);
    if (span.href) {
      slot(counts, projectedSpan?.href === span.href, "link");
    }
    if (span.annotations?.bold === true) {
      slot(counts, projectedSpan?.annotations?.bold === true, "bold");
    }
    if (span.annotations?.italic === true) {
      slot(counts, projectedSpan?.annotations?.italic === true, "italic");
    }
    if (span.annotations?.strikethrough === true) {
      slot(counts, projectedSpan?.annotations?.strikethrough === true, "strikethrough");
    }
  }
}

function findProjectedSpan(block: IrBlock | undefined, text: string) {
  return block?.spans?.find((span) => span.text === text);
}

function slot(counts: SlotCounts, preserved: boolean, label: string, lossyLabel?: string): void {
  counts.total += 1;
  if (preserved) {
    counts.preserved += 1;
    return;
  }
  counts.missing.add(label);
  if (lossyLabel) counts.lossy.add(lossyLabel);
}

function flattenBlocks(blocks: IrBlock[]): IrBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children ?? [])]);
}

function metadataSlotTotal(groundTruth: GroundTruth): number {
  return Object.values(groundTruth.metadataSlots).reduce((sum, count) => sum + count, 0);
}

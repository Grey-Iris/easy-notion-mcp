import type { IrAnnotations, IrBlock, IrPage, IrTextSpan } from "./ir.js";

export interface GroundTruth {
  ir: IrPage;
  metadataSlots: {
    blockId: number;
    createdTime: number;
    lastEditedTime: number;
    createdBy: number;
    lastEditedBy: number;
    archived: number;
  };
  colorSpanSlots: number;
  blockCount: number;
}

type JsonObject = Record<string, unknown>;

export function notionJsonToIr(notionBlocks: unknown): GroundTruth {
  const root = readObject(notionBlocks);
  const page = readObject(root?.page);
  const blocks = Array.isArray(root?.blocks) ? root.blocks.filter(isJsonObject) : [];
  const metadataSlots = {
    blockId: 0,
    createdTime: 0,
    lastEditedTime: 0,
    createdBy: 0,
    lastEditedBy: 0,
    archived: 0,
  };
  let colorSpanSlots = 0;
  let blockCount = 0;

  function convertBlock(block: JsonObject): IrBlock {
    blockCount += 1;
    countMetadata(block, metadataSlots);
    colorSpanSlots += countBlockColorSpans(block);

    const type = typeof block.type === "string" ? block.type : "unsupported";
    const container = readObject(block[type]);
    const spans = richTextSpans(readRichText(container));
    const children = readChildren(block).map(convertBlock);
    const base: IrBlock = {
      kind: blockKind(type),
      ...(spans.length ? { text: spans.map((span) => span.text).join(""), spans } : {}),
      ...(children.length ? { children } : {}),
    };

    switch (type) {
      case "code":
        return { ...base, language: typeof container?.language === "string" ? container.language : undefined };
      case "to_do":
        return { ...base, checked: container?.checked === true };
      case "callout":
        return { ...base, properties: { icon: calloutIcon(container?.icon) } };
      case "table":
        return { ...base, children: readChildren(container).map(convertBlock) };
      case "table_row":
        return tableRowToIr(block, container);
      case "image":
      case "file":
      case "bookmark":
      case "embed":
        return mediaToIr(base, type, container);
      default:
        return base;
    }
  }

  const ir: IrPage = {
    kind: "page",
    title: pageTitle(page),
    blocks: blocks.map(convertBlock),
  };

  return { ir, metadataSlots, colorSpanSlots, blockCount };
}

function tableRowToIr(block: JsonObject, container: JsonObject | undefined): IrBlock {
  countBlockColorSpans(block);
  const cells = Array.isArray(container?.cells) ? container.cells : [];
  const cellTexts = cells.map((cell) => richTextSpans(Array.isArray(cell) ? cell : []).map((span) => span.text).join(""));
  const spans = cells.flatMap((cell) => richTextSpans(Array.isArray(cell) ? cell : []));
  return {
    kind: "table_row",
    text: cellTexts.join(" | "),
    spans,
    properties: { cells: [cellTexts] },
  };
}

function mediaToIr(base: IrBlock, type: string, container: JsonObject | undefined): IrBlock {
  const captionSpans = richTextSpans(Array.isArray(container?.caption) ? container.caption : []);
  return {
    ...base,
    url: mediaUrl(container),
    caption: captionSpans.map((span) => span.text).join(""),
    ...(captionSpans.length ? { spans: [...(base.spans ?? []), ...captionSpans] } : {}),
  };
}

function pageTitle(page: JsonObject | undefined): string {
  const properties = readObject(page?.properties);
  if (properties) {
    for (const value of Object.values(properties)) {
      const property = readObject(value);
      if (Array.isArray(property?.title)) {
        return richTextSpans(property.title).map((span) => span.text).join("");
      }
    }
  }
  return typeof page?.title === "string" ? page.title : "";
}

function readChildren(block: JsonObject | undefined): JsonObject[] {
  return Array.isArray(block?.children) ? block.children.filter(isJsonObject) : [];
}

function readRichText(container: JsonObject | undefined): unknown[] {
  return Array.isArray(container?.rich_text) ? container.rich_text : [];
}

function richTextSpans(richText: unknown[]): IrTextSpan[] {
  return richText.filter(isJsonObject).map((item) => {
    const textObject = readObject(item.text);
    const content =
      typeof textObject?.content === "string"
        ? textObject.content
        : typeof item.plain_text === "string"
          ? item.plain_text
          : "";
    const annotations = readAnnotations(item.annotations);
    const href = typeof item.href === "string" ? item.href : readLink(textObject?.link);
    return {
      text: content,
      ...(href ? { href } : {}),
      ...(Object.keys(annotations).length ? { annotations } : {}),
    };
  });
}

function readAnnotations(value: unknown): IrAnnotations {
  const raw = readObject(value);
  if (!raw) return {};
  const annotations: IrAnnotations = {};
  for (const key of ["bold", "italic", "strikethrough", "underline", "code"] as const) {
    if (typeof raw[key] === "boolean") annotations[key] = raw[key];
  }
  if (typeof raw.color === "string") annotations.color = raw.color;
  return annotations;
}

function readLink(value: unknown): string | undefined {
  const link = readObject(value);
  return typeof link?.url === "string" ? link.url : undefined;
}

function mediaUrl(container: JsonObject | undefined): string | undefined {
  if (!container) return undefined;
  if (typeof container.url === "string") return container.url;
  const external = readObject(container.external);
  if (typeof external?.url === "string") return external.url;
  const file = readObject(container.file);
  if (typeof file?.url === "string") return file.url;
  return undefined;
}

function calloutIcon(value: unknown): string {
  const icon = readObject(value);
  if (typeof icon?.emoji === "string") return icon.emoji;
  const external = readObject(icon?.external);
  if (typeof external?.url === "string") return external.url;
  return "";
}

function countMetadata(block: JsonObject, metadataSlots: GroundTruth["metadataSlots"]): void {
  if ("id" in block) metadataSlots.blockId += 1;
  if ("created_time" in block) metadataSlots.createdTime += 1;
  if ("last_edited_time" in block) metadataSlots.lastEditedTime += 1;
  if ("created_by" in block) metadataSlots.createdBy += 1;
  if ("last_edited_by" in block) metadataSlots.lastEditedBy += 1;
  if ("archived" in block || "in_trash" in block) metadataSlots.archived += 1;
}

function countBlockColorSpans(block: JsonObject): number {
  let count = 0;
  visitRichTextArrays(block, (richText) => {
    for (const item of richText.filter(isJsonObject)) {
      const annotations = readObject(item.annotations);
      if (typeof annotations?.color === "string" && annotations.color !== "default") {
        count += 1;
      }
    }
  });
  return count;
}

function visitRichTextArrays(value: unknown, visit: (items: unknown[]) => void): void {
  if (Array.isArray(value)) {
    if (value.every((item) => isJsonObject(item) && item.type === "text")) {
      visit(value);
    }
    for (const item of value) visitRichTextArrays(item, visit);
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "children") continue;
    if (key === "rich_text" && Array.isArray(child)) {
      visit(child);
      continue;
    }
    if (key === "caption" && Array.isArray(child)) {
      visit(child);
      continue;
    }
    if (key === "cells" && Array.isArray(child)) {
      visitRichTextArrays(child, visit);
      continue;
    }
    visitRichTextArrays(child, visit);
  }
}

function blockKind(type: string): IrBlock["kind"] {
  switch (type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do":
    case "toggle":
    case "quote":
    case "callout":
    case "code":
    case "equation":
    case "table":
    case "table_row":
    case "image":
    case "file":
    case "bookmark":
    case "embed":
    case "divider":
      return type;
    default:
      return "unsupported";
  }
}

function readObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

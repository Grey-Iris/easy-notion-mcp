import type { NotionBlock, RichText } from "./types.js";

export const NOTION_RICH_TEXT_CONTENT_LIMIT = 2000;
type LooseRichText = {
  type?: unknown;
  text?: {
    content?: unknown;
    link?: RichText["text"]["link"];
  } | null;
  annotations?: RichText["annotations"];
  plain_text?: unknown;
  href?: unknown;
};

function splitTextContent(content: string): string[] {
  const chunks: string[] = [];
  let chunk = "";

  for (const char of content) {
    if (chunk.length > 0 && chunk.length + char.length > NOTION_RICH_TEXT_CONTENT_LIMIT) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function sanitizeTextRichText(item: LooseRichText, content: string): RichText {
  const sanitized: RichText = {
    type: "text",
    text: {
      content,
    },
  };

  if (item.text?.link !== undefined) {
    sanitized.text.link = item.text.link;
  }

  if (item.annotations !== undefined) {
    sanitized.annotations = item.annotations;
  }

  return sanitized;
}

function sanitizeNonTextRichText(item: LooseRichText): LooseRichText {
  const { plain_text: _plainText, href: _href, ...requestItem } = item;
  return requestItem;
}

export function splitLongRichText(richText: LooseRichText[]): any[] {
  const result: any[] = [];

  for (const item of richText) {
    const content = item.text?.content;
    if (item.type !== "text" || typeof content !== "string") {
      result.push(sanitizeNonTextRichText(item));
      continue;
    }
    if (content.length <= NOTION_RICH_TEXT_CONTENT_LIMIT) {
      result.push(sanitizeTextRichText(item, content));
      continue;
    }

    result.push(...splitTextContent(content).map((chunk) => sanitizeTextRichText(item, chunk)));
  }

  return result;
}

function normalizeRichTextContainer<T extends { rich_text: RichText[] }>(container: T): T {
  return {
    ...container,
    rich_text: splitLongRichText(container.rich_text),
  };
}

export function normalizeBlockRichTextForWrite(block: NotionBlock): NotionBlock {
  switch (block.type) {
    case "heading_1":
      return {
        ...block,
        heading_1: {
          ...normalizeRichTextContainer(block.heading_1),
          ...(block.heading_1.children
            ? { children: block.heading_1.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "heading_2":
      return {
        ...block,
        heading_2: {
          ...normalizeRichTextContainer(block.heading_2),
          ...(block.heading_2.children
            ? { children: block.heading_2.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "heading_3":
      return {
        ...block,
        heading_3: {
          ...normalizeRichTextContainer(block.heading_3),
          ...(block.heading_3.children
            ? { children: block.heading_3.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "paragraph":
      return { ...block, paragraph: normalizeRichTextContainer(block.paragraph) };
    case "toggle":
      return {
        ...block,
        toggle: {
          ...normalizeRichTextContainer(block.toggle),
          ...(block.toggle.children
            ? { children: block.toggle.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "bulleted_list_item":
      return {
        ...block,
        bulleted_list_item: {
          ...normalizeRichTextContainer(block.bulleted_list_item),
          ...(block.bulleted_list_item.children
            ? { children: block.bulleted_list_item.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "numbered_list_item":
      return {
        ...block,
        numbered_list_item: {
          ...normalizeRichTextContainer(block.numbered_list_item),
          ...(block.numbered_list_item.children
            ? { children: block.numbered_list_item.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "quote":
      return { ...block, quote: normalizeRichTextContainer(block.quote) };
    case "callout":
      const callout = block.callout as typeof block.callout & { children?: NotionBlock[] };
      return {
        ...block,
        callout: {
          ...normalizeRichTextContainer(block.callout),
          ...(callout.children
            ? { children: callout.children.map((child) => normalizeBlockRichTextForWrite(child)) }
            : {}),
        },
      };
    case "code":
      return { ...block, code: normalizeRichTextContainer(block.code) };
    case "to_do":
      return { ...block, to_do: normalizeRichTextContainer(block.to_do) };
    case "table_row":
      return {
        ...block,
        table_row: {
          ...block.table_row,
          cells: block.table_row.cells.map((cell) => splitLongRichText(cell as LooseRichText[])),
        },
      };
    case "table":
      return {
        ...block,
        table: {
          ...block.table,
          children: block.table.children.map((child) => normalizeBlockRichTextForWrite(child)),
        },
      };
    case "column_list":
      return {
        ...block,
        column_list: {
          ...block.column_list,
          children: block.column_list.children.map((child) => normalizeBlockRichTextForWrite(child)),
        },
      };
    case "column":
      return {
        ...block,
        column: {
          ...block.column,
          children: block.column.children.map((child) => normalizeBlockRichTextForWrite(child)),
        },
      };
    default:
      return block;
  }
}

export function normalizeBlockUpdatePayloadRichTextForWrite(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...payload };

  for (const [key, value] of Object.entries(normalized)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const container = value as { rich_text?: unknown; cells?: unknown };
    const nextContainer: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    let changed = false;

    if (Array.isArray(container.rich_text)) {
      nextContainer.rich_text = splitLongRichText(container.rich_text as LooseRichText[]);
      changed = true;
    }
    if (Array.isArray(container.cells)) {
      nextContainer.cells = container.cells.map((cell) =>
        Array.isArray(cell) ? splitLongRichText(cell as LooseRichText[]) : cell,
      );
      changed = true;
    }

    if (changed) {
      normalized[key] = nextContainer;
    }
  }

  return normalized;
}

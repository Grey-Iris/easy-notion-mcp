import { marked } from "marked";
import type { IrAnnotations, IrBlock, IrPage, IrTextSpan } from "./ir.js";

type MarkedToken = Record<string, unknown>;

export function markdownToIr(markdown: string, title?: string): IrPage {
  let tokens: MarkedToken[] = [];
  try {
    tokens = marked.lexer(markdown, { gfm: true }) as MarkedToken[];
  } catch {
    tokens = [{ type: "paragraph", text: markdown }];
  }

  const blocks = tokens.flatMap(tokenToBlocks);
  return {
    kind: "page",
    title: title ?? firstHeading(blocks) ?? "",
    blocks,
  };
}

function tokenToBlocks(token: MarkedToken): IrBlock[] {
  try {
    switch (token.type) {
      case "space":
        return [];
      case "heading":
        return [headingToBlock(token)];
      case "paragraph":
        return [textBlock("paragraph", token)];
      case "list":
        return listToBlocks(token);
      case "code":
        return [{
          kind: "code",
          text: typeof token.text === "string" ? token.text : "",
          spans: [{ text: typeof token.text === "string" ? token.text : "" }],
          language: typeof token.lang === "string" ? token.lang : undefined,
        }];
      case "blockquote":
        return blockquoteToBlocks(token);
      case "table":
        return [tableToBlock(token)];
      case "hr":
        return [{ kind: "divider" }];
      default:
        return [{
          kind: "unsupported",
          text: typeof token.raw === "string" ? token.raw : "",
        }];
    }
  } catch {
    return [{ kind: "paragraph", text: typeof token.raw === "string" ? token.raw : "" }];
  }
}

function headingToBlock(token: MarkedToken): IrBlock {
  const depth = typeof token.depth === "number" ? token.depth : 1;
  const kind = depth === 1 ? "heading_1" : depth === 2 ? "heading_2" : "heading_3";
  const spans = inlineSpans(token.tokens, token.text);
  return { kind, text: spans.map((span) => span.text).join(""), spans };
}

function textBlock(kind: IrBlock["kind"], token: MarkedToken): IrBlock {
  const spans = inlineSpans(token.tokens, token.text);
  return { kind, text: spans.map((span) => span.text).join(""), spans };
}

function listToBlocks(token: MarkedToken): IrBlock[] {
  const ordered = token.ordered === true;
  const items = Array.isArray(token.items) ? token.items.filter(isToken) : [];
  return items.map((item) => listItemToBlock(item, ordered));
}

function listItemToBlock(item: MarkedToken, ordered: boolean): IrBlock {
  const nestedChildren: IrBlock[] = [];
  const inlineTokens: unknown[] = [];

  for (const child of Array.isArray(item.tokens) ? item.tokens : []) {
    if (!isToken(child)) continue;
    if (child.type === "list") {
      nestedChildren.push(...listToBlocks(child));
      continue;
    }
    if (child.type === "text" && Array.isArray(child.tokens)) {
      inlineTokens.push(...child.tokens);
      continue;
    }
    if (child.type === "paragraph" && Array.isArray(child.tokens)) {
      inlineTokens.push(...child.tokens);
      continue;
    }
  }

  const spans = inlineTokens.length ? inlineSpans(inlineTokens, item.text) : inlineSpans(undefined, item.text);
  const task = item.task === true;
  return {
    kind: task ? "to_do" : ordered ? "numbered_list_item" : "bulleted_list_item",
    text: spans.map((span) => span.text).join(""),
    spans,
    ...(task ? { checked: item.checked === true } : {}),
    ...(nestedChildren.length ? { children: nestedChildren } : {}),
  };
}

function blockquoteToBlocks(token: MarkedToken): IrBlock[] {
  const childTokens = Array.isArray(token.tokens) ? token.tokens.filter(isToken) : [];
  const childBlocks = childTokens.flatMap(tokenToBlocks);
  if (!childBlocks.length) {
    return [textBlock("quote", token)];
  }
  const text = childBlocks.map((block) => block.text).filter(Boolean).join("\n");
  return [{ kind: "quote", text, spans: [{ text }], children: childBlocks }];
}

function tableToBlock(token: MarkedToken): IrBlock {
  const header = Array.isArray(token.header) ? token.header : [];
  const rows = Array.isArray(token.rows) ? token.rows : [];
  const allRows = [header, ...rows].filter((row): row is unknown[] => Array.isArray(row));
  return {
    kind: "table",
    children: allRows.map((row) => {
      const cells = row.map((cell) => {
        const cellToken = isToken(cell) ? cell : {};
        return inlineSpans(cellToken.tokens, cellToken.text).map((span) => span.text).join("");
      });
      return {
        kind: "table_row",
        text: cells.join(" | "),
        spans: cells.map((cell) => ({ text: cell })),
        properties: { cells: [cells] },
      };
    }),
  };
}

function inlineSpans(tokens: unknown, fallback: unknown, annotations: IrAnnotations = {}, href?: string): IrTextSpan[] {
  const items = Array.isArray(tokens) ? tokens.filter(isToken) : [];
  if (!items.length) {
    const text = typeof fallback === "string" ? fallback : "";
    return text ? [{ text, ...(href ? { href } : {}), ...(hasAnnotations(annotations) ? { annotations } : {}) }] : [];
  }

  return items.flatMap((token) => {
    switch (token.type) {
      case "text":
      case "escape":
        return inlineSpans(token.tokens, token.text, annotations, href);
      case "strong":
        return inlineSpans(token.tokens, token.text, { ...annotations, bold: true }, href);
      case "em":
        return inlineSpans(token.tokens, token.text, { ...annotations, italic: true }, href);
      case "del":
        return inlineSpans(token.tokens, token.text, { ...annotations, strikethrough: true }, href);
      case "codespan": {
        const text = typeof token.text === "string" ? token.text : "";
        return text ? [{ text, ...(href ? { href } : {}), annotations: { ...annotations, code: true } }] : [];
      }
      case "link":
        return inlineSpans(
          token.tokens,
          token.text,
          annotations,
          typeof token.href === "string" ? token.href : href,
        );
      case "br":
        return [{ text: "\n", ...(href ? { href } : {}), ...(hasAnnotations(annotations) ? { annotations } : {}) }];
      default: {
        const text = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
        return text ? [{ text, ...(href ? { href } : {}), ...(hasAnnotations(annotations) ? { annotations } : {}) }] : [];
      }
    }
  });
}

function firstHeading(blocks: IrBlock[]): string | undefined {
  return blocks.find((block) => block.kind === "heading_1" && block.text)?.text;
}

function hasAnnotations(annotations: IrAnnotations): boolean {
  return Object.keys(annotations).length > 0;
}

function isToken(value: unknown): value is MarkedToken {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

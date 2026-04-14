import { marked } from "marked";
import type { NotionBlock, RichText } from "./types.js";

type RichTextAnnotations = NonNullable<RichText["annotations"]>;
type Segment =
  | { type: "markdown"; content: string }
  | { type: "toggle"; title: string; content: string }
  | { type: "columns"; columns: string[] }
  | { type: "equation"; expression: string };

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function createRichText(
  content: string,
  annotations: RichTextAnnotations = {},
  link?: string,
): RichText {
  const richText: RichText = {
    type: "text",
    text: {
      content,
    },
  };

  if (link) {
    richText.text.link = { url: link };
  }

  if (Object.keys(annotations).length > 0) {
    richText.annotations = annotations;
  }

  return richText;
}

function mergeAnnotations(
  current: RichTextAnnotations,
  next: RichTextAnnotations,
): RichTextAnnotations {
  return { ...current, ...next };
}

function inlineTokensToRichText(
  tokens: any[],
  annotations: RichTextAnnotations = {},
  link?: string,
): RichText[] {
  const richText: RichText[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        richText.push(
          ...inlineTokensToRichText(
            token.tokens ?? [],
            mergeAnnotations(annotations, { bold: true }),
            link,
          ),
        );
        break;
      case "em":
        richText.push(
          ...inlineTokensToRichText(
            token.tokens ?? [],
            mergeAnnotations(annotations, { italic: true }),
            link,
          ),
        );
        break;
      case "del":
        richText.push(
          ...inlineTokensToRichText(
            token.tokens ?? [],
            mergeAnnotations(annotations, { strikethrough: true }),
            link,
          ),
        );
        break;
      case "codespan":
        richText.push(
          createRichText(token.text ?? "", mergeAnnotations(annotations, { code: true }), link),
        );
        break;
      case "link":
        if (token.href && !isSafeUrl(token.href)) {
          richText.push(
            ...inlineTokensToRichText(token.tokens ?? [], annotations, link),
          );
        } else {
          richText.push(
            ...inlineTokensToRichText(token.tokens ?? [], annotations, token.href ?? link),
          );
        }
        break;
      case "text":
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          richText.push(...inlineTokensToRichText(token.tokens, annotations, link));
        } else {
          richText.push(createRichText(token.text ?? "", annotations, link));
        }
        break;
      case "br":
        richText.push(createRichText("\n", annotations, link));
        break;
      default:
        if (typeof token.text === "string") {
          richText.push(createRichText(token.text, annotations, link));
        }
        break;
    }
  }

  return richText;
}

export function blockTextToRichText(text: string): RichText[] {
  return inlineTokensToRichText(marked.Lexer.lexInline(text) as any[]);
}

function listItemToRichText(item: any): RichText[] {
  const inlineTokens: any[] = [];

  for (const token of item.tokens ?? []) {
    if (token.type === "checkbox" || token.type === "list") {
      continue;
    }

    if (Array.isArray(token.tokens) && token.type !== "image") {
      inlineTokens.push(...token.tokens);
      continue;
    }

    inlineTokens.push(token);
  }

  return inlineTokensToRichText(inlineTokens);
}

function listTokenToBlocks(token: any): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  for (const item of token.items ?? []) {
    const children = (item.tokens ?? [])
      .filter((child: any) => child.type === "list")
      .flatMap((child: any) => listTokenToBlocks(child));

    if (item.task) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: listItemToRichText(item),
          checked: Boolean(item.checked),
        },
      });
      continue;
    }

    const listItemBlock =
      token.ordered
        ? {
            type: "numbered_list_item" as const,
            numbered_list_item: {
              rich_text: listItemToRichText(item),
              ...(children.length > 0 ? { children } : {}),
            },
          }
        : {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: listItemToRichText(item),
              ...(children.length > 0 ? { children } : {}),
            },
          };

    blocks.push(listItemBlock);
  }

  return blocks;
}

function blockquoteToBlock(token: any): NotionBlock {
  const paragraphText = token.tokens?.[0]?.text ?? token.text ?? "";
  const calloutMatch = paragraphText.match(
    /^\[!(NOTE|TIP|WARNING|IMPORTANT|INFO|SUCCESS|ERROR)\]\s*(?:\n?([\s\S]*))?$/i,
  );

  if (calloutMatch) {
    const calloutType = calloutMatch[1].toUpperCase();
    const content = (calloutMatch[2] ?? "").trim();
    const emojiMap: Record<string, string> = {
      NOTE: "💡",
      TIP: "💚",
      WARNING: "⚠️",
      IMPORTANT: "🔴",
      INFO: "ℹ️",
      SUCCESS: "✅",
      ERROR: "❌",
    };
    const emoji = emojiMap[calloutType] ?? "💡";

    return {
      type: "callout",
      callout: {
        rich_text: blockTextToRichText(content),
        icon: { type: "emoji", emoji },
      },
    };
  }

  return {
    type: "quote",
    quote: {
      rich_text: blockTextToRichText(paragraphText.replace(/\n/g, "\n")),
    },
  };
}

function createTableRow(cells: RichText[][]): NotionBlock {
  return {
    type: "table_row",
    table_row: { cells },
  };
}

function isBookmarkParagraph(token: any): boolean {
  if (token.tokens?.length !== 1 || token.tokens[0].type !== "link") {
    return false;
  }

  const linkToken = token.tokens[0];
  const linkText = linkToken.text ?? "";
  const linkHref = linkToken.href ?? "";
  return linkText === linkHref || linkToken.raw === linkHref;
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function normalizeOrderedListIndentation(markdown: string): string {
  const lines = markdown.split("\n");
  const normalized: string[] = [];
  let fenceMarker: string | null = null;

  for (const line of lines) {
    const wasInFence = fenceMarker !== null;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (wasInFence) {
      if (
        fenceMatch &&
        fenceMarker &&
        fenceMatch[1][0] === fenceMarker[0] &&
        fenceMatch[1].length >= fenceMarker.length
      ) {
        fenceMarker = null;
      }
      normalized.push(line);
      continue;
    }

    if (fenceMatch) {
      fenceMarker = fenceMatch[1];
      normalized.push(line);
      continue;
    }

    const orderedMatch = line.match(/^( +)(\d+)\.\s+/);
    if (orderedMatch && orderedMatch[1].length % 2 === 0) {
      const indent = orderedMatch[1];
      normalized.push(`${" ".repeat(indent.length * 2)}${line.slice(indent.length)}`);
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function flushMarkdownSegment(segments: Segment[], lines: string[]) {
  if (lines.length === 0) {
    return;
  }

  segments.push({ type: "markdown", content: joinLines(lines) });
  lines.length = 0;
}

function splitCustomSyntax(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const markdownLines: string[] = [];
  const lines = markdown.split("\n");

  let fenceMarker: string | null = null;
  let toggleTitle: string | null = null;
  let toggleLines: string[] = [];
  let rawToggleLines: string[] = [];
  let columnLines: string[] | null = null;
  let columns: string[] = [];
  let rawColumnsLines: string[] = [];
  let equationLines: string[] | null = null;
  let rawEquationLines: string[] = [];
  let inColumns = false;

  for (const line of lines) {
    const wasInFence = fenceMarker !== null;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (wasInFence) {
      if (
        fenceMatch &&
        fenceMarker &&
        fenceMatch[1][0] === fenceMarker[0] &&
        fenceMatch[1].length >= fenceMarker.length
      ) {
        fenceMarker = null;
      }
    } else if (fenceMatch) {
      fenceMarker = fenceMatch[1];
    }
    const lineInFence = wasInFence || Boolean(fenceMatch);

    if (toggleTitle !== null) {
      rawToggleLines.push(line);
      if (!lineInFence && line === "+++") {
        segments.push({
          type: "toggle",
          title: toggleTitle,
          content: joinLines(toggleLines),
        });
        toggleTitle = null;
        toggleLines = [];
        rawToggleLines = [];
      } else {
        toggleLines.push(line);
      }
      continue;
    }

    if (inColumns) {
      rawColumnsLines.push(line);

      if (!lineInFence && line === "::: column" && columnLines === null) {
        columnLines = [];
        continue;
      }

      if (!lineInFence && line === ":::") {
        if (columnLines !== null) {
          columns.push(joinLines(columnLines));
          columnLines = null;
        } else {
          segments.push({ type: "columns", columns: [...columns] });
          columns = [];
          rawColumnsLines = [];
          inColumns = false;
        }
        continue;
      }

      if (columnLines !== null) {
        columnLines.push(line);
      }
      continue;
    }

    if (equationLines !== null) {
      rawEquationLines.push(line);
      if (!lineInFence && line === "$$") {
        segments.push({
          type: "equation",
          expression: joinLines(equationLines),
        });
        equationLines = null;
        rawEquationLines = [];
      } else {
        equationLines.push(line);
      }
      continue;
    }

    if (!lineInFence && line.startsWith("+++ ")) {
      flushMarkdownSegment(segments, markdownLines);
      toggleTitle = line.slice(4);
      toggleLines = [];
      rawToggleLines = [line];
      continue;
    }

    if (!lineInFence && line === "::: columns") {
      flushMarkdownSegment(segments, markdownLines);
      columns = [];
      columnLines = null;
      rawColumnsLines = [line];
      inColumns = true;
      continue;
    }

    if (!lineInFence && line === "$$") {
      flushMarkdownSegment(segments, markdownLines);
      equationLines = [];
      rawEquationLines = [line];
      continue;
    }

    if (!lineInFence && line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      flushMarkdownSegment(segments, markdownLines);
      segments.push({
        type: "equation",
        expression: line.slice(2, -2),
      });
      continue;
    }

    markdownLines.push(line);
  }

  if (toggleTitle !== null) {
    markdownLines.push(...rawToggleLines);
  }

  if (inColumns) {
    markdownLines.push(...rawColumnsLines);
  }

  if (equationLines !== null) {
    markdownLines.push(...rawEquationLines);
  }

  flushMarkdownSegment(segments, markdownLines);
  return segments;
}

function tokenToBlocks(token: any): NotionBlock[] {
  switch (token.type) {
    case "space":
      return [];
    case "heading": {
      const richText = inlineTokensToRichText(token.tokens ?? []);
      if (token.depth === 1) {
        return [{ type: "heading_1", heading_1: { rich_text: richText } }];
      }
      if (token.depth === 2) {
        return [{ type: "heading_2", heading_2: { rich_text: richText } }];
      }
      return [{ type: "heading_3", heading_3: { rich_text: richText } }];
    }
    case "paragraph": {
      if (token.tokens?.length === 1 && token.tokens[0].type === "image") {
        const href = token.tokens[0].href ?? "";
        if (href.startsWith("notion-upload:")) {
          const parts = href.split(":");
          const uploadId = parts[1];
          return [{
            type: "image",
            image: { type: "file_upload", file_upload: { id: uploadId } },
          }];
        }
        if (isSafeUrl(href)) {
          return [
            {
              type: "image",
              image: {
                type: "external",
                external: { url: href },
              },
            },
          ];
        }
      }

      if (token.tokens?.length === 1 && token.tokens[0].type === "link") {
        const linkHref = token.tokens[0].href ?? "";
        if (linkHref.startsWith("notion-upload:")) {
          const parts = linkHref.split(":");
          const uploadId = parts[1];
          const blockType = parts[2];
          const name = token.tokens[0].text ?? "file";
          if (blockType === "audio") {
            return [{ type: "audio", audio: { type: "file_upload", file_upload: { id: uploadId } } }];
          }
          if (blockType === "video") {
            return [{ type: "video", video: { type: "file_upload", file_upload: { id: uploadId } } }];
          }
          return [{ type: "file", file: { type: "file_upload", file_upload: { id: uploadId }, name } }];
        }
      }

      if (token.tokens?.length === 1 && token.tokens[0].type === "link" && token.tokens[0].text === "embed") {
        const href = token.tokens[0].href ?? "";
        if (isSafeUrl(href)) {
          return [{ type: "embed", embed: { url: href } }];
        }
      }

      if (isBookmarkParagraph(token)) {
        const href = token.tokens[0].href ?? "";
        if (isSafeUrl(href)) {
          return [
            {
              type: "bookmark",
              bookmark: { url: href },
            },
          ];
        }
      }

      if (
        token.tokens?.length === 1 &&
        token.tokens[0].type === "text" &&
        token.tokens[0].text === "[toc]"
      ) {
        return [{ type: "table_of_contents", table_of_contents: {} }];
      }

      return [
        {
          type: "paragraph",
          paragraph: {
            rich_text: inlineTokensToRichText(token.tokens ?? []),
          },
        },
      ];
    }
    case "list":
      return listTokenToBlocks(token);
    case "blockquote":
      return [blockquoteToBlock(token)];
    case "table": {
      const headerRow = createTableRow(
        (token.header ?? []).map((cell: any) => inlineTokensToRichText(cell.tokens ?? [])),
      );
      const bodyRows = (token.rows ?? []).map((row: any[]) =>
        createTableRow(row.map((cell: any) => inlineTokensToRichText(cell.tokens ?? []))),
      );

      return [
        {
          type: "table",
          table: {
            table_width: token.header?.length ?? 0,
            has_column_header: true,
            has_row_header: false,
            children: [headerRow, ...bodyRows],
          },
        },
      ];
    }
    case "code":
      return [
        {
          type: "code",
          code: {
            rich_text: [createRichText(token.text ?? "")],
            language: token.lang || "plain text",
          },
        },
      ];
    case "hr":
      return [{ type: "divider", divider: {} }];
    default:
      return [];
  }
}

export function markdownToBlocks(markdown: string): NotionBlock[] {
  if (!markdown.trim()) {
    return [];
  }

  const segments = splitCustomSyntax(markdown);

  return segments.flatMap((segment) => {
    if (segment.type === "toggle") {
      // Detect toggle heading syntax: "+++ ## Title" → toggleable heading_2
      const headingMatch = segment.title.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        const depth = headingMatch[1].length;
        const headingText = headingMatch[2];
        const childrenBlocks = segment.content.trim()
          ? markdownToBlocks(segment.content)
          : [];
        if (depth === 1) {
          return [{
            type: "heading_1",
            heading_1: {
              rich_text: blockTextToRichText(headingText),
              is_toggleable: true,
              ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
            },
          }];
        }
        if (depth === 2) {
          return [{
            type: "heading_2",
            heading_2: {
              rich_text: blockTextToRichText(headingText),
              is_toggleable: true,
              ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
            },
          }];
        }
        return [{
          type: "heading_3",
          heading_3: {
            rich_text: blockTextToRichText(headingText),
            is_toggleable: true,
            ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
          },
        }];
      }
      return [
        {
          type: "toggle",
          toggle: {
            rich_text: blockTextToRichText(segment.title),
            ...(segment.content.trim()
              ? { children: markdownToBlocks(segment.content) }
              : {}),
          },
        },
      ];
    }

    if (segment.type === "columns") {
      return [
        {
          type: "column_list",
          column_list: {
            children: segment.columns.map((column) => ({
              type: "column",
              column: {
                children: markdownToBlocks(column),
              },
            })),
          },
        },
      ];
    }

    if (segment.type === "equation") {
      return [
        {
          type: "equation",
          equation: { expression: segment.expression },
        },
      ];
    }

    const tokens = marked.lexer(normalizeOrderedListIndentation(segment.content)) as any[];
    return tokens.flatMap((token) => tokenToBlocks(token));
  });
}

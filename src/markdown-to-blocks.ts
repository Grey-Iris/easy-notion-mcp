import { marked } from "marked";
import type { MentionRichText, NotionBlock, RichText, TextRichText } from "./types.js";

type RichTextAnnotations = NonNullable<RichText["annotations"]>;

/**
 * Options shared by every markdown-to-Notion conversion entry point.
 *
 * `collapseSoftWraps` opts in to CommonMark soft-wrap handling: a single newline
 * inside a paragraph becomes a space. Default off, so conversion behavior is
 * unchanged unless a caller asks for it. Threaded as an argument rather than
 * module state so concurrent conversions cannot observe each other's settings.
 */
export type ConversionOptions = {
  collapseSoftWraps?: boolean;
};

/**
 * CommonMark treats a single newline inside a paragraph as a soft line break,
 * which renders as a space. Collapsing it lets hard-wrapped source text rejoin
 * into flowing paragraphs instead of arriving with ragged mid-sentence breaks.
 *
 * Blank-line runs are preserved verbatim. They separate paragraphs, and
 * `blockquoteToBlock` deliberately joins a multi-paragraph quote or callout body
 * with "\n\n" into one rich-text field, so collapsing those would destroy the
 * paragraph structure that round-trip fixtures pin as correct.
 *
 * Explicit hard breaks never reach this function: `marked` emits a trailing
 * backslash or two trailing spaces as a separate `br` token.
 */
function collapseSoftWraps(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(\n{2,})/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/[ \t]*\n[ \t]*/g, " ")))
    .join("");
}

function applyLineBreakPolicy(text: string, options: ConversionOptions): string {
  return options.collapseSoftWraps ? collapseSoftWraps(text) : text;
}

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

const NOTION_PAGE_ID_PATTERN = "[0-9a-fA-F]{32}";
const NOTION_DASHED_PAGE_ID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const NOTION_PAGE_ID_EXACT = new RegExp(`^(?:${NOTION_PAGE_ID_PATTERN}|${NOTION_DASHED_PAGE_ID_PATTERN})$`);
const NOTION_PAGE_ID_TRAILING = new RegExp(`(${NOTION_PAGE_ID_PATTERN}|${NOTION_DASHED_PAGE_ID_PATTERN})$`);

function isNotionHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "notion.so" ||
    host.endsWith(".notion.so") ||
    host === "notion.com" ||
    host.endsWith(".notion.com") ||
    host.endsWith(".notion.site")
  );
}

export function notionUrlToPageId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!isNotionHost(parsed.hostname)) {
    return null;
  }

  const peekPageId = parsed.searchParams.get("p");
  if (peekPageId && NOTION_PAGE_ID_EXACT.test(peekPageId)) {
    return peekPageId;
  }

  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) {
    return null;
  }

  return lastSegment.match(NOTION_PAGE_ID_TRAILING)?.[1] ?? null;
}

function createRichText(
  content: string,
  annotations: RichTextAnnotations = {},
  link?: string,
): TextRichText {
  const richText: TextRichText = {
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

function createMentionRichText(
  content: string,
  href: string,
  pageId: string,
  annotations: RichTextAnnotations,
): MentionRichText {
  const richText: MentionRichText = {
    type: "mention",
    mention: {
      type: "page",
      page: { id: pageId },
    },
    plain_text: content,
    href,
  };

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
  options: ConversionOptions = {},
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
            options,
          ),
        );
        break;
      case "em":
        richText.push(
          ...inlineTokensToRichText(
            token.tokens ?? [],
            mergeAnnotations(annotations, { italic: true }),
            link,
            options,
          ),
        );
        break;
      case "del":
        richText.push(
          ...inlineTokensToRichText(
            token.tokens ?? [],
            mergeAnnotations(annotations, { strikethrough: true }),
            link,
            options,
          ),
        );
        break;
      case "codespan":
        richText.push(
          createRichText(token.text ?? "", mergeAnnotations(annotations, { code: true }), link),
        );
        break;
      case "link":
        if (token.href && link === undefined) {
          const pageId = notionUrlToPageId(token.href);
          const previous = richText[richText.length - 1];
          if (pageId && previous?.type === "text" && previous.text.content.endsWith("@")) {
            previous.text.content = previous.text.content.slice(0, -1);
            if (previous.text.content.length === 0) {
              richText.pop();
            }
            richText.push(createMentionRichText(token.text ?? "", token.href, pageId, annotations));
            break;
          }
        }

        if (token.href && !isSafeUrl(token.href)) {
          richText.push(
            ...inlineTokensToRichText(token.tokens ?? [], annotations, link, options),
          );
        } else {
          richText.push(
            ...inlineTokensToRichText(token.tokens ?? [], annotations, token.href ?? link, options),
          );
        }
        break;
      case "text":
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          richText.push(...inlineTokensToRichText(token.tokens, annotations, link, options));
        } else {
          richText.push(
            createRichText(applyLineBreakPolicy(token.text ?? "", options), annotations, link),
          );
        }
        break;
      case "br":
        // An explicit hard break (trailing backslash or two trailing spaces).
        // Stays literal in both modes; soft-wrap collapsing never sees it.
        richText.push(createRichText("\n", annotations, link));
        break;
      default:
        if (typeof token.text === "string") {
          richText.push(createRichText(applyLineBreakPolicy(token.text, options), annotations, link));
        }
        break;
    }
  }

  return richText;
}

/**
 * The inline lexer keeps a newline at the very start or end of the string inside
 * the first or last text token, where collapsing would turn it into a stray
 * leading or trailing space. A newline at the edge of an inline string separates
 * nothing, so it is dropped rather than collapsed.
 *
 * Only applied when collapsing is on: the default path stays byte-identical.
 */
function trimBoundaryNewlines(text: string): string {
  return text.replace(/^[ \t]*(?:\r?\n[ \t]*)+/, "").replace(/(?:[ \t]*\r?\n)+[ \t]*$/, "");
}

export function blockTextToRichText(
  text: string,
  options: ConversionOptions = {},
): RichText[] {
  const input = options.collapseSoftWraps ? trimBoundaryNewlines(text) : text;
  return inlineTokensToRichText(marked.Lexer.lexInline(input) as any[], {}, undefined, options);
}

function listItemToRichText(item: any, options: ConversionOptions): RichText[] {
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

  return inlineTokensToRichText(inlineTokens, {}, undefined, options);
}

function listTokenToBlocks(token: any, options: ConversionOptions): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  for (const item of token.items ?? []) {
    const children = (item.tokens ?? [])
      .filter((child: any) => child.type === "list")
      .flatMap((child: any) => listTokenToBlocks(child, options));

    if (item.task) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: listItemToRichText(item, options),
          checked: Boolean(item.checked),
          ...(children.length > 0 ? { children } : {}),
        },
      });
      continue;
    }

    const listItemBlock =
      token.ordered
        ? {
            type: "numbered_list_item" as const,
            numbered_list_item: {
              rich_text: listItemToRichText(item, options),
              ...(children.length > 0 ? { children } : {}),
            },
          }
        : {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: listItemToRichText(item, options),
              ...(children.length > 0 ? { children } : {}),
            },
          };

    blocks.push(listItemBlock);
  }

  return blocks;
}

function blockquoteToBlock(token: any, options: ConversionOptions): NotionBlock {
  const paragraphTexts: string[] = Array.isArray(token.tokens)
    ? token.tokens
        .filter((child: any) => child?.type === "paragraph")
        .map((child: any) => child.text ?? "")
    : [];
  const combinedText =
    paragraphTexts.length > 0 ? paragraphTexts.join("\n\n") : token.text ?? "";

  const calloutMatch = combinedText.match(
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
        rich_text: blockTextToRichText(content, options),
        icon: { type: "emoji", emoji },
      },
    };
  }

  return {
    type: "quote",
    quote: {
      rich_text: blockTextToRichText(combinedText, options),
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

function tokenToBlocks(token: any, options: ConversionOptions): NotionBlock[] {
  switch (token.type) {
    case "space":
      return [];
    case "heading": {
      const richText = inlineTokensToRichText(token.tokens ?? [], {}, undefined, options);
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
            rich_text: inlineTokensToRichText(token.tokens ?? [], {}, undefined, options),
          },
        },
      ];
    }
    case "list":
      return listTokenToBlocks(token, options);
    case "blockquote":
      return [blockquoteToBlock(token, options)];
    case "table": {
      const headerRow = createTableRow(
        (token.header ?? []).map((cell: any) =>
          inlineTokensToRichText(cell.tokens ?? [], {}, undefined, options),
        ),
      );
      const bodyRows = (token.rows ?? []).map((row: any[]) =>
        createTableRow(
          row.map((cell: any) => inlineTokensToRichText(cell.tokens ?? [], {}, undefined, options)),
        ),
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

export function markdownToBlocks(
  markdown: string,
  options: ConversionOptions = {},
): NotionBlock[] {
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
          ? markdownToBlocks(segment.content, options)
          : [];
        if (depth === 1) {
          return [{
            type: "heading_1",
            heading_1: {
              rich_text: blockTextToRichText(headingText, options),
              is_toggleable: true,
              ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
            },
          }];
        }
        if (depth === 2) {
          return [{
            type: "heading_2",
            heading_2: {
              rich_text: blockTextToRichText(headingText, options),
              is_toggleable: true,
              ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
            },
          }];
        }
        return [{
          type: "heading_3",
          heading_3: {
            rich_text: blockTextToRichText(headingText, options),
            is_toggleable: true,
            ...(childrenBlocks.length ? { children: childrenBlocks } : {}),
          },
        }];
      }
      return [
        {
          type: "toggle",
          toggle: {
            rich_text: blockTextToRichText(segment.title, options),
            ...(segment.content.trim()
              ? { children: markdownToBlocks(segment.content, options) }
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
                children: markdownToBlocks(column, options),
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
    return tokens.flatMap((token) => tokenToBlocks(token, options));
  });
}

function richTextContainsPageMention(richText: RichText[] | undefined): boolean {
  return Boolean(richText?.some((item) => item.type === "mention" && item.mention.type === "page"));
}

function childBlocks(block: NotionBlock): NotionBlock[] {
  const value = (block as any)[block.type];
  if (Array.isArray(value?.children)) {
    return value.children as NotionBlock[];
  }
  return [];
}

function blockRichTextArrays(block: NotionBlock): RichText[][] {
  const value = (block as any)[block.type];
  const arrays: RichText[][] = [];

  if (Array.isArray(value?.rich_text)) {
    arrays.push(value.rich_text as RichText[]);
  }
  if (block.type === "table_row") {
    arrays.push(...block.table_row.cells);
  }

  return arrays;
}

export function blocksContainPageMention(blocks: NotionBlock[]): boolean {
  return blocks.some((block) =>
    blockRichTextArrays(block).some(richTextContainsPageMention) ||
    blocksContainPageMention(childBlocks(block))
  );
}

type DowngradedMention = { page_id: string; url?: string };

function downgradeRichText(richText: RichText[], downgraded: DowngradedMention[]): RichText[] {
  return richText.map((item) => {
    if (item.type !== "mention" || item.mention.type !== "page") {
      return item;
    }

    const pageId = item.mention.page.id;
    if (item.href) {
      downgraded.push({ page_id: pageId, url: item.href });
    } else {
      downgraded.push({ page_id: pageId });
    }

    return {
      type: "text",
      text: {
        content: item.plain_text || item.href || pageId,
        ...(item.href ? { link: { url: item.href } } : {}),
      },
    };
  });
}

function downgradeBlock(block: NotionBlock, downgraded: DowngradedMention[]): NotionBlock {
  switch (block.type) {
    case "heading_1":
      return {
        ...block,
        heading_1: {
          ...block.heading_1,
          rich_text: downgradeRichText(block.heading_1.rich_text, downgraded),
          ...(block.heading_1.children
            ? { children: block.heading_1.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "heading_2":
      return {
        ...block,
        heading_2: {
          ...block.heading_2,
          rich_text: downgradeRichText(block.heading_2.rich_text, downgraded),
          ...(block.heading_2.children
            ? { children: block.heading_2.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "heading_3":
      return {
        ...block,
        heading_3: {
          ...block.heading_3,
          rich_text: downgradeRichText(block.heading_3.rich_text, downgraded),
          ...(block.heading_3.children
            ? { children: block.heading_3.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "paragraph":
      return { ...block, paragraph: { ...block.paragraph, rich_text: downgradeRichText(block.paragraph.rich_text, downgraded) } };
    case "toggle":
      return {
        ...block,
        toggle: {
          ...block.toggle,
          rich_text: downgradeRichText(block.toggle.rich_text, downgraded),
          ...(block.toggle.children
            ? { children: block.toggle.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "bulleted_list_item":
      return {
        ...block,
        bulleted_list_item: {
          ...block.bulleted_list_item,
          rich_text: downgradeRichText(block.bulleted_list_item.rich_text, downgraded),
          ...(block.bulleted_list_item.children
            ? { children: block.bulleted_list_item.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "numbered_list_item":
      return {
        ...block,
        numbered_list_item: {
          ...block.numbered_list_item,
          rich_text: downgradeRichText(block.numbered_list_item.rich_text, downgraded),
          ...(block.numbered_list_item.children
            ? { children: block.numbered_list_item.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "quote":
      return { ...block, quote: { ...block.quote, rich_text: downgradeRichText(block.quote.rich_text, downgraded) } };
    case "callout": {
      const callout = block.callout as typeof block.callout & { children?: NotionBlock[] };
      return {
        ...block,
        callout: {
          ...block.callout,
          rich_text: downgradeRichText(block.callout.rich_text, downgraded),
          ...(callout.children
            ? { children: callout.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    }
    case "code":
      return { ...block, code: { ...block.code, rich_text: downgradeRichText(block.code.rich_text, downgraded) } };
    case "to_do":
      return {
        ...block,
        to_do: {
          ...block.to_do,
          rich_text: downgradeRichText(block.to_do.rich_text, downgraded),
          ...(block.to_do.children
            ? { children: block.to_do.children.map((child) => downgradeBlock(child, downgraded)) }
            : {}),
        },
      };
    case "table_row":
      return {
        ...block,
        table_row: {
          ...block.table_row,
          cells: block.table_row.cells.map((cell) => downgradeRichText(cell, downgraded)),
        },
      };
    case "table":
      return {
        ...block,
        table: {
          ...block.table,
          children: block.table.children.map((child) => downgradeBlock(child, downgraded)),
        },
      };
    case "column_list":
      return {
        ...block,
        column_list: {
          ...block.column_list,
          children: block.column_list.children.map((child) => downgradeBlock(child, downgraded)),
        },
      };
    case "column":
      return {
        ...block,
        column: {
          ...block.column,
          children: block.column.children.map((child) => downgradeBlock(child, downgraded)),
        },
      };
    default:
      return block;
  }
}

export function downgradeMentionsToLinks(blocks: NotionBlock[]): { blocks: NotionBlock[]; downgraded: DowngradedMention[] } {
  const downgraded: DowngradedMention[] = [];
  return {
    blocks: blocks.map((block) => downgradeBlock(block, downgraded)),
    downgraded,
  };
}

export function isMentionTargetError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const code = (err as { code?: unknown }).code;
  return code === "validation_error" || code === "object_not_found";
}

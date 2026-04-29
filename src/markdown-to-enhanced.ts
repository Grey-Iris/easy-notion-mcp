import { markdownToBlocks } from "./markdown-to-blocks.js";
import type { NotionBlock, RichText } from "./types.js";

/**
 * GFM-with-extensions → Notion Enhanced Markdown translator.
 *
 * Bridges this server's I/O dialect (GFM plus the conventions in CLAUDE.md
 * "Custom markdown conventions") to the dialect Notion's `pages.updateMarkdown`
 * actually parses (Enhanced / Notion-flavored Markdown, with XML-style tags
 * for callouts, toggles, columns, tables, mentions, ToC).
 *
 * Spec source: https://developers.notion.com/guides/data-apis/enhanced-markdown
 *
 * Live-probe ground truth (`scripts/bench/pr3-live-probes.ts`, findings memo
 * `.meta/research/pr3-live-probe-findings-2026-04-28.md`):
 * - `+++ Toggle`, `::: columns`, `> [!NOTE]`, `[toc]`, `$$equation$$`, bare-URL
 *   bookmarks all land as paragraphs/quotes when sent unmodified through
 *   `pages.updateMarkdown` with `replace_content`. Translation is mandatory.
 * - GFM-alerts (`> [!NOTE]`) → Enhanced `<callout>` mapping owned by us; spec
 *   does not auto-convert them.
 *
 * Design: re-use `markdownToBlocks` (our existing GFM-extensions parser) to
 * produce a `NotionBlock` tree, then serialize each block to Enhanced Markdown.
 * This sidesteps a fragile text-to-text translator and reuses the parser the
 * server has been hardened against for v0.1–v0.5.
 */

export type TranslateWarning =
  | { code: "bookmark_lost_on_atomic_replace"; url: string }
  | { code: "embed_lost_on_atomic_replace"; url: string }
  | { code: "unrepresentable_block"; type: string };

export type TranslateResult = {
  enhanced: string;
  warnings: TranslateWarning[];
};

const TAB = "\t";

function indent(text: string, depth: number): string {
  if (depth === 0) return text;
  const pad = TAB.repeat(depth);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function richTextToEnhanced(richText: RichText[] | undefined): string {
  if (!richText) return "";
  return richText
    .map((rt) => {
      let content = rt.text?.content ?? "";
      const annotations = rt.annotations ?? {};
      if (annotations.code) content = `\`${content}\``;
      if (annotations.bold) content = `**${content}**`;
      if (annotations.italic) content = `*${content}*`;
      if (annotations.strikethrough) content = `~~${content}~~`;
      if (rt.text?.link?.url) content = `[${content}](${rt.text.link.url})`;
      return content;
    })
    .join("");
}

const CALLOUT_DEFAULT_ICON = "💡";

function calloutIcon(block: any): string {
  const icon = block?.callout?.icon;
  if (icon?.type === "emoji" && typeof icon.emoji === "string") return icon.emoji;
  if (icon?.type === "external" && icon?.external?.url) return icon.external.url;
  return CALLOUT_DEFAULT_ICON;
}

function serializeBlocks(blocks: NotionBlock[], depth: number, warnings: TranslateWarning[]): string {
  return blocks
    .map((block) => serializeBlock(block, depth, warnings))
    .filter((line) => line !== null && line !== "")
    .join("\n");
}

function serializeBlock(
  block: NotionBlock,
  depth: number,
  warnings: TranslateWarning[],
): string {
  const b = block as any;
  switch (block.type) {
    case "paragraph":
      return indent(richTextToEnhanced(b.paragraph.rich_text), depth);
    case "heading_1": {
      const text = richTextToEnhanced(b.heading_1.rich_text);
      const toggle = b.heading_1.is_toggleable ? ` {toggle="true"}` : "";
      const head = indent(`# ${text}${toggle}`, depth);
      const children = b.heading_1.children as NotionBlock[] | undefined;
      if (toggle && children?.length) {
        return `${head}\n${serializeBlocks(children, depth + 1, warnings)}`;
      }
      return head;
    }
    case "heading_2": {
      const text = richTextToEnhanced(b.heading_2.rich_text);
      const toggle = b.heading_2.is_toggleable ? ` {toggle="true"}` : "";
      const head = indent(`## ${text}${toggle}`, depth);
      const children = b.heading_2.children as NotionBlock[] | undefined;
      if (toggle && children?.length) {
        return `${head}\n${serializeBlocks(children, depth + 1, warnings)}`;
      }
      return head;
    }
    case "heading_3": {
      const text = richTextToEnhanced(b.heading_3.rich_text);
      const toggle = b.heading_3.is_toggleable ? ` {toggle="true"}` : "";
      const head = indent(`### ${text}${toggle}`, depth);
      const children = b.heading_3.children as NotionBlock[] | undefined;
      if (toggle && children?.length) {
        return `${head}\n${serializeBlocks(children, depth + 1, warnings)}`;
      }
      return head;
    }
    case "bulleted_list_item": {
      const text = richTextToEnhanced(b.bulleted_list_item.rich_text);
      const head = indent(`- ${text}`, depth);
      const children = b.bulleted_list_item.children as NotionBlock[] | undefined;
      if (children?.length) {
        return `${head}\n${serializeBlocks(children, depth + 1, warnings)}`;
      }
      return head;
    }
    case "numbered_list_item": {
      const text = richTextToEnhanced(b.numbered_list_item.rich_text);
      const head = indent(`1. ${text}`, depth);
      const children = b.numbered_list_item.children as NotionBlock[] | undefined;
      if (children?.length) {
        return `${head}\n${serializeBlocks(children, depth + 1, warnings)}`;
      }
      return head;
    }
    case "to_do": {
      const text = richTextToEnhanced(b.to_do.rich_text);
      const checked = b.to_do.checked ? "x" : " ";
      return indent(`- [${checked}] ${text}`, depth);
    }
    case "quote":
      return indent(`> ${richTextToEnhanced(b.quote.rich_text)}`, depth);
    case "callout": {
      const text = richTextToEnhanced(b.callout.rich_text);
      const icon = calloutIcon(block);
      const inner = indent(text, 1);
      const calloutBlock = `<callout icon="${escapeAttr(icon)}">\n${inner}\n</callout>`;
      return indent(calloutBlock, depth);
    }
    case "toggle": {
      const title = richTextToEnhanced(b.toggle.rich_text);
      const children = b.toggle.children as NotionBlock[] | undefined;
      const childContent =
        children && children.length > 0 ? indent(serializeBlocks(children, 0, warnings), 1) : "";
      const detailsBlock = childContent
        ? `<details>\n<summary>${title}</summary>\n${childContent}\n</details>`
        : `<details>\n<summary>${title}</summary>\n</details>`;
      return indent(detailsBlock, depth);
    }
    case "code": {
      const text = (b.code.rich_text ?? [])
        .map((rt: RichText) => rt.text?.content ?? "")
        .join("");
      const lang = b.code.language ?? "plain text";
      const fence = `\`\`\`${lang}\n${text}\n\`\`\``;
      return indent(fence, depth);
    }
    case "equation":
      return indent(`$$\n${b.equation.expression}\n$$`, depth);
    case "divider":
      return indent("---", depth);
    case "table_of_contents":
      return indent(`<table_of_contents/>`, depth);
    case "column_list": {
      const cols = (b.column_list.children ?? []) as NotionBlock[];
      const inner = cols
        .map((col) => serializeBlock(col, 0, warnings))
        .filter((line) => line !== "")
        .join("\n");
      const block = `<columns>\n${indent(inner, 1)}\n</columns>`;
      return indent(block, depth);
    }
    case "column": {
      const children = (b.column.children ?? []) as NotionBlock[];
      const inner = serializeBlocks(children, 0, warnings);
      const block = `<column>\n${indent(inner, 1)}\n</column>`;
      return block;
    }
    case "table": {
      const rows = (b.table.children ?? []) as any[];
      const headerRow = b.table.has_column_header ? "true" : "false";
      const headerCol = b.table.has_row_header ? "true" : "false";
      const rowsXml = rows
        .map((row) => {
          const cells = row.table_row.cells as RichText[][];
          return `<tr>\n${cells
            .map((cell) => `${TAB}<td>${richTextToEnhanced(cell)}</td>`)
            .join("\n")}\n</tr>`;
        })
        .join("\n");
      const block = `<table header-row="${headerRow}" header-column="${headerCol}">\n${indent(rowsXml, 1)}\n</table>`;
      return indent(block, depth);
    }
    case "bookmark": {
      const url = b.bookmark.url ?? "";
      warnings.push({ code: "bookmark_lost_on_atomic_replace", url });
      return indent(url, depth);
    }
    case "embed": {
      const url = b.embed.url ?? "";
      warnings.push({ code: "embed_lost_on_atomic_replace", url });
      return indent(url, depth);
    }
    case "image": {
      const url =
        (b.image as any)?.external?.url ?? (b.image as any)?.file?.url ?? "";
      return indent(`![](${url})`, depth);
    }
    case "file":
    case "audio":
    case "video": {
      const fb = (b as any)[block.type];
      const url = fb?.external?.url ?? fb?.file?.url ?? "";
      return indent(url, depth);
    }
    default:
      warnings.push({ code: "unrepresentable_block", type: block.type });
      return "";
  }
}

/**
 * Translate a GFM-with-extensions markdown string to Notion Enhanced Markdown.
 * The output is suitable for `pages.updateMarkdown` with `replace_content`,
 * `insert_content`, or any other endpoint that consumes Enhanced Markdown.
 */
export function translateGfmToEnhancedMarkdown(markdown: string): TranslateResult {
  const warnings: TranslateWarning[] = [];
  if (!markdown.trim()) {
    return { enhanced: "", warnings };
  }
  const blocks = markdownToBlocks(markdown);
  const enhanced = serializeBlocks(blocks, 0, warnings);
  return { enhanced, warnings };
}

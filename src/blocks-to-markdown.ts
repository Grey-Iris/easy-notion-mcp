import type { NotionBlock, RichText } from "./types.js";

function applyAnnotations(text: string, richText: RichText): string {
  let result = text;
  const annotations = richText.annotations ?? {};

  if (annotations.code) {
    result = `\`${result}\``;
  }
  if (annotations.bold) {
    result = `**${result}**`;
  }
  if (annotations.italic) {
    result = `*${result}*`;
  }
  if (annotations.strikethrough) {
    result = `~~${result}~~`;
  }
  if (richText.text.link?.url) {
    result = `[${result}](${richText.text.link.url})`;
  }

  return result;
}

function richTextToMarkdown(richText: RichText[]): string {
  return richText
    .map((item) => applyAnnotations(item.text.content, item))
    .join("");
}

function tableRowToMarkdown(row: Extract<NotionBlock, { type: "table_row" }>): string {
  const cells = row.table_row.cells.map((cell) => richTextToMarkdown(cell));
  return `| ${cells.join(" | ")} |`;
}

function isListLikeBlock(block: NotionBlock): boolean {
  return (
    block.type === "bulleted_list_item" ||
    block.type === "numbered_list_item" ||
    block.type === "to_do"
  );
}

function renderBlocks(blocks: NotionBlock[], indent = 0): string {
  let output = "";

  for (const [index, block] of blocks.entries()) {
    const rendered = renderBlock(block, indent);
    if (!rendered) {
      continue;
    }

    if (output.length > 0) {
      const previous = blocks[index - 1];
      output += isListLikeBlock(previous) && isListLikeBlock(block) ? "\n" : "\n\n";
    }

    output += rendered;
  }

  return output;
}

function renderListChildren(children: NotionBlock[] | undefined, indent: number): string {
  if (!children || children.length === 0) {
    return "";
  }

  return `\n${renderBlocks(children, indent + 2)}`;
}

function renderBlock(block: NotionBlock, indent: number): string {
  const prefix = " ".repeat(indent);

  switch (block.type) {
    case "heading_1": {
      const h1Text = `${prefix}# ${richTextToMarkdown(block.heading_1.rich_text)}`;
      const h1Children = block.heading_1.children ?? [];
      if (h1Children.length > 0) {
        return `${h1Text}\n\n${renderBlocks(h1Children, indent)}`;
      }
      return h1Text;
    }
    case "heading_2": {
      const h2Text = `${prefix}## ${richTextToMarkdown(block.heading_2.rich_text)}`;
      const h2Children = block.heading_2.children ?? [];
      if (h2Children.length > 0) {
        return `${h2Text}\n\n${renderBlocks(h2Children, indent)}`;
      }
      return h2Text;
    }
    case "heading_3": {
      const h3Text = `${prefix}### ${richTextToMarkdown(block.heading_3.rich_text)}`;
      const h3Children = block.heading_3.children ?? [];
      if (h3Children.length > 0) {
        return `${h3Text}\n\n${renderBlocks(h3Children, indent)}`;
      }
      return h3Text;
    }
    case "paragraph":
      return `${prefix}${richTextToMarkdown(block.paragraph.rich_text)}`;
    case "toggle": {
      const title = richTextToMarkdown(block.toggle.rich_text);
      const children = block.toggle.children ?? [];
      const childContent = children.length > 0 ? `\n${renderBlocks(children, indent)}` : "";
      return `${prefix}+++ ${title}${childContent}\n${prefix}+++`;
    }
    case "bulleted_list_item":
      return `${prefix}- ${richTextToMarkdown(
        block.bulleted_list_item.rich_text,
      )}${renderListChildren(block.bulleted_list_item.children, indent)}`;
    case "numbered_list_item":
      return `${prefix}1. ${richTextToMarkdown(
        block.numbered_list_item.rich_text,
      )}${renderListChildren(block.numbered_list_item.children, indent)}`;
    case "quote":
      return richTextToMarkdown(block.quote.rich_text)
        .split("\n")
        .map((line) => `${prefix}> ${line}`)
        .join("\n");
    case "callout": {
      const emoji = block.callout.icon?.emoji;
      const emojiToLabel: Record<string, string> = {
        "⚠️": "WARNING",
        "💚": "TIP",
        "💡": "NOTE",
        "🔴": "IMPORTANT",
        "ℹ️": "INFO",
        "✅": "SUCCESS",
        "❌": "ERROR",
      };
      const label = emojiToLabel[emoji ?? ""] ?? "NOTE";
      const content = richTextToMarkdown(block.callout.rich_text)
        .split("\n")
        .map((line) => `${prefix}> ${line}`)
        .join("\n");
      return `${prefix}> [!${label}]\n${content}`;
    }
    case "equation":
      return `${prefix}$$${block.equation.expression}$$`;
    case "table": {
      const rows = (block.table.children ?? []).filter(
        (child): child is Extract<NotionBlock, { type: "table_row" }> => child.type === "table_row",
      );
      if (rows.length === 0) {
        return "";
      }

      const [headerRow, ...bodyRows] = rows;
      const separator = `| ${headerRow.table_row.cells.map(() => "---").join(" | ")} |`;
      const renderedRows = [tableRowToMarkdown(headerRow), separator, ...bodyRows.map(tableRowToMarkdown)];
      return `${prefix}${renderedRows.join(`\n${prefix}`)}`;
    }
    case "table_row":
      return "";
    case "column_list": {
      const columns = (block.column_list.children ?? []).filter(
        (child): child is Extract<NotionBlock, { type: "column" }> => child.type === "column",
      );
      const rendered = columns
        .map((column) => {
          const content = renderBlocks(column.column.children ?? [], indent);
          return content
            ? `${prefix}::: column\n${content}\n${prefix}:::`
            : `${prefix}::: column\n${prefix}:::`;
        })
        .join("\n");
      return `${prefix}::: columns\n${rendered}\n${prefix}:::`;
    }
    case "column":
      return "";
    case "code": {
      const lang = block.code.language === "plain text" ? "" : block.code.language;
      return `${prefix}\`\`\`${lang}\n${block.code.rich_text
        .map((item) => item.text.content)
        .join("")}\n${prefix}\`\`\``;
    }
    case "divider":
      return `${prefix}---`;
    case "to_do":
      return `${prefix}- [${block.to_do.checked ? "x" : " "}] ${richTextToMarkdown(
        block.to_do.rich_text,
      )}`;
    case "table_of_contents":
      return `${prefix}[toc]`;
    case "bookmark":
      return `${prefix}${block.bookmark.url}`;
    case "embed":
      return `${prefix}[embed](${block.embed.url})`;
    case "image": {
      const url = block.image.type === "external"
        ? block.image.external.url
        : (block.image as any).file?.url ?? "";
      return `${prefix}![](${url})`;
    }
    case "file": {
      const url = block.file.type === "external" ? block.file.external.url : "";
      const name = ("name" in block.file ? block.file.name : undefined) ?? "file";
      return `${prefix}[${name}](${url})`;
    }
    case "audio": {
      const url = block.audio.type === "external" ? block.audio.external.url : "";
      return `${prefix}[audio](${url})`;
    }
    case "video": {
      const url = block.video.type === "external" ? block.video.external.url : "";
      return `${prefix}[video](${url})`;
    }
    default:
      return "";
  }
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  return renderBlocks(blocks);
}

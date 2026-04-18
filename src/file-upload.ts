import type { Client } from "@notionhq/client";
import { uploadFile } from "./notion-client.js";

export type FileUploadTransport = "stdio" | "http";

export const FILE_SCHEME_HTTP_ERROR =
  "file:// URLs are only supported in stdio transport, where the server runs on your machine. In HTTP mode, host the file at an HTTPS URL and use that instead.";

type CodeRange = { start: number; end: number };

function isInRange(position: number, ranges: CodeRange[]): boolean {
  return ranges.some((range) => position >= range.start && position < range.end);
}

export function getCodeRanges(markdown: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let fenceStart: number | null = null;
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineStart = offset;
    const hasNewline = index < lines.length - 1;
    const lineEnd = lineStart + line.length + (hasNewline ? 1 : 0);
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);

    if (fenceMarker !== null) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fenceMarker[0] &&
        fenceMatch[1].length >= fenceMarker.length
      ) {
        ranges.push({ start: fenceStart ?? lineStart, end: lineEnd });
        fenceStart = null;
        fenceMarker = null;
      }
    } else if (fenceMatch) {
      fenceStart = lineStart;
      fenceMarker = fenceMatch[1];
    }

    offset = lineEnd;
  }

  if (fenceStart !== null) {
    ranges.push({ start: fenceStart, end: markdown.length });
  }

  const inlineCodeRegex = /`+[^`]*`+/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCodeRegex.exec(markdown)) !== null) {
    if (isInRange(match.index, ranges)) {
      continue;
    }

    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges.sort((left, right) => left.start - right.start);
}

export async function processFileUploads(
  client: Client,
  markdown: string,
  transport: FileUploadTransport,
): Promise<string> {
  // Match file:// URLs in both ![alt](file://...) and [text](file://...) syntax
  const fileUrlRegex = /(?:!\[[^\]]*\]|(?<!\!)\[[^\]]*\])\((file:\/\/[^)]+)\)/g;

  const matches: { full: string; url: string; start: number }[] = [];
  let match;
  while ((match = fileUrlRegex.exec(markdown)) !== null) {
    matches.push({ full: match[0], url: match[1], start: match.index });
  }

  if (matches.length === 0) return markdown;
  const codeRanges = getCodeRanges(markdown);
  const realMatches = matches.filter((m) => !isInRange(m.start, codeRanges));
  if (realMatches.length === 0) return markdown;

  if (transport !== "stdio") {
    throw new Error(FILE_SCHEME_HTTP_ERROR);
  }

  // Upload all files in parallel
  const uploads = await Promise.all(
    realMatches.map(async (m) => {
      const result = await uploadFile(client, m.url);
      return { ...m, uploadId: result.id, blockType: result.blockType };
    }),
  );

  // Replace file:// URLs with notion-upload tokens (replace in reverse to preserve indices)
  let result = markdown;
  for (const upload of uploads.reverse()) {
    result = result.replace(upload.url, `notion-upload:${upload.uploadId}:${upload.blockType}`);
  }

  return result;
}

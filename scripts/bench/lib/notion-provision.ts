import type { BlockFixture, DatabaseFixture, PageFixture, PropertyFixture, RowFixture } from "../corpus/generate.js";
import type { RichText } from "../../../src/types.js";

export interface NotionProvisionDeps {
  token: string;
  notionVersion?: string;
  fetchImpl?: typeof fetch;
}

type JsonObject = Record<string, unknown>;
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const notionApiBase = "https://api.notion.com";
const defaultNotionVersion = "2025-09-03";
const maxChildrenPerRequest = 100;
const maxRetries = 5;
const retryScheduleMs = [250, 500, 1_000, 2_000, 4_000];

const knownCodeLanguages = new Set([
  "abap",
  "arduino",
  "bash",
  "basic",
  "c",
  "clojure",
  "coffeescript",
  "c++",
  "c#",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "elm",
  "erlang",
  "flow",
  "fortran",
  "f#",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mermaid",
  "nix",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "python",
  "r",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "sql",
  "swift",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

export async function provisionPage(
  fixture: PageFixture,
  parentPageId: string,
  deps: NotionProvisionDeps,
): Promise<{ pageId: string }> {
  const context = requestContext(deps);
  const firstBlocks = fixture.blocks.slice(0, maxChildrenPerRequest).map((block) => blockToNotion(block));
  const response = await notionRequest<JsonObject>(
    context,
    "POST",
    "/v1/pages",
    {
      parent: { type: "page_id", page_id: parentPageId },
      properties: { title: { title: [textRT(fixture.title)] } },
      children: firstBlocks,
    },
  );
  const pageId = readId(response, "page create");
  const createdFirstBlocks = await createdBlocksForPageCreate(context, pageId, response, firstBlocks.length);
  await appendDeferredChildren(context, fixture.blocks.slice(0, createdFirstBlocks.length), createdFirstBlocks);

  if (fixture.blocks.length > maxChildrenPerRequest) {
    await appendBlocksRecursive(context, pageId, fixture.blocks.slice(maxChildrenPerRequest));
  }

  return { pageId };
}

export async function provisionDatabase(
  fixture: DatabaseFixture,
  parentPageId: string,
  deps: NotionProvisionDeps,
): Promise<{ databaseId: string }> {
  const context = requestContext(deps);
  const response = await notionRequest<JsonObject>(
    context,
    "POST",
    "/v1/databases",
    {
      parent: { type: "page_id", page_id: parentPageId },
      title: [textRT(fixture.title)],
      properties: databaseSchema(fixture.properties),
    },
  );
  const databaseId = readId(response, "database create");
  const titleProperty = fixture.properties.find((property) => property.type === "title")?.name ?? "Name";

  for (const row of fixture.rows) {
    await createDatabaseRow(context, databaseId, titleProperty, fixture.properties, row);
  }

  return { databaseId };
}

export async function archiveBlock(id: string, deps: NotionProvisionDeps): Promise<void> {
  const context = requestContext(deps);
  const failures: string[] = [];

  for (const body of [{ in_trash: true }, { archived: true }]) {
    for (const path of [`/v1/pages/${id}`, `/v1/databases/${id}`, `/v1/blocks/${id}`]) {
      try {
        await notionRequest(context, "PATCH", path, body);
        return;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(`Failed to archive ${id}:\n${failures.join("\n")}`);
}

async function createDatabaseRow(
  context: RequestContext,
  databaseId: string,
  titleProperty: string,
  properties: PropertyFixture[],
  row: RowFixture,
): Promise<void> {
  const response = await notionRequest<JsonObject>(
    context,
    "POST",
    "/v1/pages",
    {
      parent: { type: "database_id", database_id: databaseId },
      properties: rowProperties(titleProperty, properties, row),
      children: row.body.slice(0, maxChildrenPerRequest).map((block) => blockToNotion(block)),
    },
  );
  const pageId = readId(response, "database row create");
  const createdFirstBlocks = await createdBlocksForPageCreate(
    context,
    pageId,
    response,
    Math.min(row.body.length, maxChildrenPerRequest),
  );
  await appendDeferredChildren(context, row.body.slice(0, createdFirstBlocks.length), createdFirstBlocks);

  if (row.body.length > maxChildrenPerRequest) {
    await appendBlocksRecursive(context, pageId, row.body.slice(maxChildrenPerRequest));
  }
}

async function appendBlocksRecursive(
  context: RequestContext,
  parentBlockId: string,
  blocks: BlockFixture[],
): Promise<void> {
  for (const chunk of chunkArray(blocks, maxChildrenPerRequest)) {
    const response = await notionRequest<JsonObject>(
      context,
      "PATCH",
      `/v1/blocks/${parentBlockId}/children`,
      { children: chunk.map((block) => blockToNotion(block)) },
    );
    const createdBlocks = readResults(response, `append children to ${parentBlockId}`);
    await appendDeferredChildren(context, chunk, createdBlocks);
  }
}

async function appendDeferredChildren(
  context: RequestContext,
  fixtures: BlockFixture[],
  createdBlocks: JsonObject[],
): Promise<void> {
  for (const [index, fixture] of fixtures.entries()) {
    const children = fixtureChildren(fixture);
    if (!children.length) continue;

    const created = createdBlocks[index];
    const id = typeof created?.id === "string" ? created.id : undefined;
    if (!id) {
      throw new Error(`Notion response did not include id for created ${fixture.type} block at index ${index}`);
    }
    await appendBlocksRecursive(context, id, children);
  }
}

async function createdBlocksForPageCreate(
  context: RequestContext,
  pageId: string,
  response: JsonObject,
  expectedCount: number,
): Promise<JsonObject[]> {
  const inlineResults = Array.isArray(response.results)
    ? (response.results.filter(isJsonObject) as JsonObject[])
    : [];
  if (inlineResults.length >= expectedCount) {
    return inlineResults.slice(0, expectedCount);
  }
  if (expectedCount === 0) {
    return [];
  }

  const listed = await notionRequest<JsonObject>(context, "GET", `/v1/blocks/${pageId}/children?page_size=100`);
  return readResults(listed, `list children for created page ${pageId}`).slice(0, expectedCount);
}

function blockToNotion(block: BlockFixture): JsonObject {
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return { type: block.type, [block.type]: { rich_text: [textRT(block.text)] } };
    case "paragraph":
      return { type: "paragraph", paragraph: { rich_text: paragraphRichText(block) } };
    case "bulleted_list_item":
    case "numbered_list_item":
    case "toggle":
      return { type: block.type, [block.type]: { rich_text: [textRT(block.text)] } };
    case "to_do":
      return { type: "to_do", to_do: { rich_text: [textRT(block.text)], checked: block.checked } };
    case "quote":
      return { type: "quote", quote: { rich_text: [textRT(block.text)] } };
    case "callout":
      return {
        type: "callout",
        callout: {
          rich_text: [textRT(block.text)],
          icon: { type: "emoji", emoji: emojiIcon(block.icon) },
        },
      };
    case "code":
      return {
        type: "code",
        code: {
          rich_text: [textRT(block.text)],
          language: knownCodeLanguages.has(block.language) ? block.language : "plain text",
        },
      };
    case "table":
      return {
        type: "table",
        table: {
          table_width: block.rows[0]?.length ?? 0,
          has_column_header: true,
          has_row_header: false,
          children: block.rows.map((row) => ({
            type: "table_row",
            table_row: { cells: row.map((cell) => [textRT(cell)]) },
          })),
        },
      };
    case "image":
    case "file":
    case "bookmark":
    case "embed":
      return externalBlock(block);
  }
}

function externalBlock(block: Extract<BlockFixture, { type: "image" | "file" | "bookmark" | "embed" }>): JsonObject {
  const caption = captionRT(block.caption);
  if (block.type === "bookmark" || block.type === "embed") {
    return { type: block.type, [block.type]: { url: block.url, caption } };
  }
  return {
    type: block.type,
    [block.type]: {
      type: "external",
      external: { url: block.url },
      caption,
    },
  };
}

function paragraphRichText(block: Extract<BlockFixture, { type: "paragraph" }>): RichText[] {
  if (!block.annotations?.length) {
    return [textRT(block.text)];
  }

  const boundaries = new Set([0, block.text.length]);
  for (const annotation of block.annotations) {
    boundaries.add(clamp(annotation.start, 0, block.text.length));
    boundaries.add(clamp(annotation.end, 0, block.text.length));
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const richText: RichText[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index] ?? 0;
    const end = sorted[index + 1] ?? start;
    if (start === end) continue;

    const content = block.text.slice(start, end);
    const annotation = block.annotations.find((candidate) => candidate.start <= start && candidate.end >= end);
    if (!annotation) {
      richText.push(textRT(content));
      continue;
    }

    const annotations: NonNullable<RichText["annotations"]> = { color: annotation.color ?? "default" };
    if (annotation.bold !== undefined) annotations.bold = annotation.bold;
    if (annotation.italic !== undefined) annotations.italic = annotation.italic;
    richText.push(textRT(content, annotations));
  }

  return richText;
}

function textRT(content: string, annotations?: RichText["annotations"]): RichText {
  return {
    type: "text",
    text: { content },
    ...(annotations ? { annotations } : {}),
  };
}

function captionRT(caption: string | undefined): RichText[] {
  return caption ? [textRT(caption)] : [];
}

function emojiIcon(icon: string | undefined): string {
  return icon && /\p{Extended_Pictographic}/u.test(icon) ? icon : "💡";
}

function fixtureChildren(block: BlockFixture): BlockFixture[] {
  return "children" in block && Array.isArray(block.children) ? block.children : [];
}

function databaseSchema(properties: PropertyFixture[]): JsonObject {
  const schema: JsonObject = {};
  for (const property of properties) {
    if (property.type === "people") continue;
    if (property.type === "phone") {
      schema[property.name] = { phone_number: {} };
      continue;
    }
    if (property.type === "select" || property.type === "multi_select") {
      schema[property.name] = { [property.type]: { options: (property.options ?? []).map((name) => ({ name })) } };
      continue;
    }
    schema[property.name] = { [property.type]: {} };
  }
  return schema;
}

function rowProperties(
  titleProperty: string,
  properties: PropertyFixture[],
  row: RowFixture,
): JsonObject {
  const values: JsonObject = {};
  for (const property of properties) {
    if (property.type === "people") continue;
    if (property.type === "title") {
      values[property.name] = { title: [textRT(row.title)] };
      continue;
    }

    const value = row.properties[property.name];
    if (value === undefined) continue;
    const converted = rowPropertyValue(property.type, value);
    if (converted) {
      values[property.name] = converted;
    }
  }

  if (!values[titleProperty]) {
    values[titleProperty] = { title: [textRT(row.title)] };
  }

  return values;
}

function rowPropertyValue(type: PropertyFixture["type"], value: string | number | boolean | string[]): JsonObject | undefined {
  switch (type) {
    case "title":
      return { title: [textRT(String(value))] };
    case "rich_text":
      return { rich_text: [textRT(String(value))] };
    case "number":
      return typeof value === "number" ? { number: value } : undefined;
    case "select":
      return typeof value === "string" ? { select: { name: value } } : undefined;
    case "multi_select":
      return Array.isArray(value) ? { multi_select: value.map((name) => ({ name })) } : undefined;
    case "status":
      return typeof value === "string" ? { status: { name: value } } : undefined;
    case "date":
      return typeof value === "string" ? { date: { start: value } } : undefined;
    case "checkbox":
      return typeof value === "boolean" ? { checkbox: value } : undefined;
    case "url":
      return typeof value === "string" ? { url: value } : undefined;
    case "email":
      return typeof value === "string" ? { email: value } : undefined;
    case "phone":
      return typeof value === "string" ? { phone_number: value } : undefined;
    case "people":
      return undefined;
  }
}

interface RequestContext {
  token: string;
  notionVersion: string;
  fetchImpl: typeof fetch;
}

function requestContext(deps: NotionProvisionDeps): RequestContext {
  return {
    token: deps.token,
    notionVersion: deps.notionVersion ?? defaultNotionVersion,
    fetchImpl: deps.fetchImpl ?? fetch,
  };
}

async function notionRequest<T = unknown>(
  context: RequestContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let lastResponseBody = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await context.fetchImpl(`${notionApiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${context.token}`,
        "Notion-Version": context.notionVersion,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    lastResponseBody = await response.text();

    if (response.status === 429 && attempt < maxRetries) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${lastResponseBody}`);
    }

    return (lastResponseBody ? JSON.parse(lastResponseBody) : {}) as T;
  }

  throw new Error(`${method} ${path} failed with repeated 429 responses: ${lastResponseBody}`);
}

function retryDelayMs(response: FetchResponse, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000;
    }
  }
  return retryScheduleMs[attempt] ?? retryScheduleMs[retryScheduleMs.length - 1] ?? 1_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readId(value: JsonObject, label: string): string {
  if (typeof value.id === "string") {
    return value.id;
  }
  throw new Error(`Notion ${label} response did not contain an id`);
}

function readResults(value: JsonObject, label: string): JsonObject[] {
  if (Array.isArray(value.results) && value.results.every(isJsonObject)) {
    return value.results;
  }
  throw new Error(`Notion ${label} response did not contain a results array`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

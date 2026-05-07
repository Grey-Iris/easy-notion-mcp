import { Client } from "@notionhq/client";
import type { UpdateDataSourceParameters } from "@notionhq/client/build/src/api-endpoints.js";
import { readFile, stat } from "fs/promises";
import { basename, extname } from "path";
import { fileURLToPath } from "url";
import type { NotionBlock } from "./types.js";

export type PageParent =
  | { type: "page_id"; page_id: string }
  | { type: "workspace"; workspace: true };

export function createNotionClient(token: string) {
  return new Client({ auth: token, notionVersion: "2025-09-03" });
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const NOTION_BLOCK_CHILDREN_LIMIT = 100;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".heic": "image/heic", ".bmp": "image/bmp", ".tiff": "image/tiff",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".pdf": "application/pdf", ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv", ".zip": "application/zip",
  ".md": "text/markdown", ".txt": "text/plain",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function titleRichText(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function emptyParagraphBlock(): NotionBlock {
  return {
    type: "paragraph",
    paragraph: { rich_text: [] },
  };
}

function getBlockChildren(block: NotionBlock): NotionBlock[] {
  const body = (block as any)[block.type];
  return Array.isArray(body?.children) ? body.children : [];
}

function withoutBlockChildren(block: NotionBlock): any {
  const body = { ...((block as any)[block.type] ?? {}) };
  delete body.children;
  return { ...block, [block.type]: body };
}

function isOptionalChildrenContainer(block: NotionBlock): boolean {
  switch (block.type) {
    case "bulleted_list_item":
    case "numbered_list_item":
    case "toggle":
      return true;
    case "heading_1":
      return block.heading_1.is_toggleable === true;
    case "heading_2":
      return block.heading_2.is_toggleable === true;
    case "heading_3":
      return block.heading_3.is_toggleable === true;
    default:
      return false;
  }
}

function canUseAsColumnSeed(block: NotionBlock): boolean {
  return block.type !== "table" && block.type !== "column_list";
}

function usesPlaceholderColumnSeed(block: NotionBlock): boolean {
  if (block.type !== "column") {
    return false;
  }
  const firstChild = getBlockChildren(block)[0];
  return firstChild !== undefined && !canUseAsColumnSeed(firstChild);
}

function prepareBlockForWrite(block: NotionBlock): any {
  if (isOptionalChildrenContainer(block)) {
    return withoutBlockChildren(block);
  }

  if (block.type === "table") {
    const rows = getBlockChildren(block);
    const table = { ...block.table };
    delete (table as any).children;
    if (rows.length > 0) {
      table.children = [prepareBlockForWrite(rows[0])];
    }
    return { ...block, table };
  }

  if (block.type === "column_list") {
    return {
      ...block,
      column_list: {
        ...block.column_list,
        children: getBlockChildren(block).map((child) => prepareBlockForWrite(child)),
      },
    };
  }

  if (block.type === "column") {
    const children = getBlockChildren(block);
    const column = { ...block.column };
    delete (column as any).children;
    const seed = children[0] && canUseAsColumnSeed(children[0])
      ? children[0]
      : emptyParagraphBlock();
    column.children = [prepareBlockForWrite(seed)];
    return { ...block, column };
  }

  return block;
}

function needsDeferredChildWrites(block: NotionBlock): boolean {
  const children = getBlockChildren(block);

  if (isOptionalChildrenContainer(block)) {
    return children.length > 0;
  }

  if (block.type === "table") {
    return children.length > 1;
  }

  if (block.type === "column") {
    return usesPlaceholderColumnSeed(block) ||
      children.length > 1 ||
      (children[0] ? needsDeferredChildWrites(children[0]) : false);
  }

  if (block.type === "column_list") {
    return children.some((child) => needsDeferredChildWrites(child));
  }

  return false;
}

async function requireCreatedChildId(
  client: Client,
  parentId: string,
  index: number,
  context: string,
): Promise<string> {
  const children = await listChildren(client, parentId);
  const childId = (children[index] as any)?.id;
  if (typeof childId !== "string" || childId.length === 0) {
    throw new Error(`Notion append returned no id for ${context}`);
  }
  return childId;
}

async function appendDeferredChildren(client: Client, blockId: string, sourceBlock: NotionBlock): Promise<void> {
  const children = getBlockChildren(sourceBlock);

  if (isOptionalChildrenContainer(sourceBlock)) {
    if (children.length > 0) {
      await appendBlocks(client, blockId, children);
    }
    return;
  }

  if (sourceBlock.type === "table") {
    if (children.length > 1) {
      await appendBlocks(client, blockId, children.slice(1));
    }
    return;
  }

  if (sourceBlock.type === "column") {
    if (children.length === 0) {
      return;
    }

    if (usesPlaceholderColumnSeed(sourceBlock)) {
      await appendBlocks(client, blockId, children);
      return;
    }

    if (needsDeferredChildWrites(children[0])) {
      const firstChildId = await requireCreatedChildId(client, blockId, 0, "column child block");
      await appendDeferredChildren(client, firstChildId, children[0]);
    }

    if (children.length > 1) {
      await appendBlocks(client, blockId, children.slice(1));
    }
    return;
  }

  if (sourceBlock.type === "column_list") {
    const columns = children.filter((child): child is Extract<NotionBlock, { type: "column" }> => child.type === "column");
    if (columns.length === 0 || !columns.some((column) => needsDeferredChildWrites(column))) {
      return;
    }

    const createdColumns = await listChildren(client, blockId);
    for (let index = 0; index < columns.length; index += 1) {
      if (!needsDeferredChildWrites(columns[index])) {
        continue;
      }
      const columnId = (createdColumns[index] as any)?.id;
      if (typeof columnId !== "string" || columnId.length === 0) {
        throw new Error("Notion append returned no id for column block");
      }
      await appendDeferredChildren(client, columnId, columns[index]);
    }
  }
}

async function appendPreparedBlocks(
  client: Client,
  parentBlockId: string,
  blocks: NotionBlock[],
  afterBlockId?: string,
) {
  const results: any[] = [];

  for (let index = 0; index < blocks.length; index += NOTION_BLOCK_CHILDREN_LIMIT) {
    const chunk = blocks.slice(index, index + NOTION_BLOCK_CHILDREN_LIMIT);
    const response = await client.blocks.children.append({
      block_id: parentBlockId,
      children: chunk.map((block) => prepareBlockForWrite(block)) as any[],
      ...(afterBlockId ? { after: afterBlockId } : {}),
    } as any);
    results.push(...response.results);

    if (response.results.length > 0) {
      afterBlockId = (response.results[response.results.length - 1] as any).id;
    }

    for (let offset = 0; offset < chunk.length; offset += 1) {
      if (!needsDeferredChildWrites(chunk[offset])) {
        continue;
      }
      const createdBlockId = (response.results[offset] as any)?.id;
      if (typeof createdBlockId !== "string" || createdBlockId.length === 0) {
        throw new Error("Notion append returned no id for child block");
      }
      await appendDeferredChildren(client, createdBlockId, chunk[offset]);
    }
  }

  return results;
}

type PropertiesUpdate = UpdateDataSourceParameters["properties"];
export type PaginatedPropertyType = "title" | "rich_text" | "relation" | "people";

export type TruncatedPropertyEntry = {
  name: string;
  type: PaginatedPropertyType;
  returned_count: number;
  cap: number;
};

export type PaginationOpts = {
  maxPropertyItems: number;
  onlyTypes?: PaginatedPropertyType[];
};

const PROPERTY_PAGINATION_RUNAWAY_ERROR =
  "paginatePropertyValue: runaway loop detected (no progress)";

export type SchemaEntry = {
  name: string;
  type: string;
  [extra: string]: unknown;
};

const VALID_SCHEMA_TYPES = [
  "title",
  "rich_text",
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "formula",
  "rollup",
  "relation",
  "unique_id",
  "people",
  "files",
  "verification",
  "place",
  "location",
  "button",
  "created_time",
  "last_edited_time",
  "created_by",
  "last_edited_by",
] as const;
const VALID_SCHEMA_TYPES_SET = new Set<string>(VALID_SCHEMA_TYPES);
const RAW_PROPERTY_SHAPE_KEYS = new Set([
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "formula",
  "rollup",
  "relation",
  "people",
  "files",
  "unique_id",
  "verification",
  "place",
  "button",
  "location",
  "created_time",
  "last_edited_time",
  "created_by",
  "last_edited_by",
  "name",
]);

const schemaCache = new Map<string, { schema: any; expires: number }>();
const dataSourceIdCache = new Map<string, { dsId: string; expires: number }>();
const SCHEMA_CACHE_TTL = 5 * 60 * 1000;

function isPaginatedPropertyType(type: unknown): type is PaginatedPropertyType {
  return type === "title" || type === "rich_text" || type === "relation" || type === "people";
}

function propertyItemValue(item: any, propertyType: PaginatedPropertyType): unknown {
  switch (propertyType) {
    case "title":
      return item.title;
    case "rich_text":
      return item.rich_text;
    case "relation":
      return item.relation;
    case "people":
      return item.people;
  }
}

export async function paginatePageProperties(
  client: Client,
  page: any,
  opts: PaginationOpts,
): Promise<{ page: any; warnings: TruncatedPropertyEntry[] }> {
  if (!page?.properties) {
    return { page, warnings: [] };
  }

  const properties = page.properties as Record<string, any>;
  const nextProperties = { ...properties };
  const warnings: TruncatedPropertyEntry[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propertyType = prop?.type;
    if (!isPaginatedPropertyType(propertyType)) {
      continue;
    }
    if (opts.onlyTypes && !opts.onlyTypes.includes(propertyType)) {
      continue;
    }

    const values = prop[propertyType];
    if (!Array.isArray(values) || values.length !== 25) {
      continue;
    }

    const paginated = await paginatePropertyValue(
      client,
      page.id,
      prop.id,
      propertyType,
      opts.maxPropertyItems,
    );

    nextProperties[name] = { ...prop, [propertyType]: paginated.values };
    if (paginated.truncatedAtCap) {
      warnings.push({
        name,
        type: propertyType,
        returned_count: paginated.values.length,
        cap: opts.maxPropertyItems,
      });
    }
  }

  return { page: { ...page, properties: nextProperties }, warnings };
}

async function paginatePropertyValue(
  client: Client,
  pageId: string,
  propertyId: string,
  propertyType: PaginatedPropertyType,
  cap: number,
): Promise<{ values: unknown[]; truncatedAtCap: boolean }> {
  const values: unknown[] = [];
  let cursor: string | undefined;

  while (true) {
    const request: { page_id: string; property_id: string; start_cursor?: string } = {
      page_id: pageId,
      property_id: propertyId,
    };
    if (cursor !== undefined) {
      request.start_cursor = cursor;
    }

    const response = await client.pages.properties.retrieve(request as any) as any;
    if (!Array.isArray(response?.results)) {
      throw new Error("paginatePropertyValue: expected paginated property results");
    }

    const hasMore = response.has_more === true;
    if (hasMore && response.results.length === 0) {
      throw new Error(PROPERTY_PAGINATION_RUNAWAY_ERROR);
    }

    const nextCursor = typeof response.next_cursor === "string" ? response.next_cursor : undefined;
    if (hasMore && (!nextCursor || nextCursor === cursor)) {
      throw new Error(PROPERTY_PAGINATION_RUNAWAY_ERROR);
    }

    values.push(...response.results.map((item: any) => propertyItemValue(item, propertyType)));

    if (cap > 0 && values.length >= cap) {
      return {
        values: values.slice(0, cap),
        truncatedAtCap: values.length > cap || hasMore,
      };
    }

    if (!hasMore) {
      return { values, truncatedAtCap: false };
    }

    cursor = nextCursor;
  }
}

/**
 * Resolve a database_id to its primary data_source_id.
 * Caches the mapping with the same TTL as schema cache.
 */
async function getDataSourceId(client: Client, dbId: string): Promise<string> {
  const cached = dataSourceIdCache.get(dbId);
  if (cached && cached.expires > Date.now()) {
    return cached.dsId;
  }
  const db = await client.databases.retrieve({ database_id: dbId }) as any;
  const dsId = db.data_sources?.[0]?.id;
  if (!dsId) {
    throw new Error(`Database ${dbId} has no data sources`);
  }
  dataSourceIdCache.set(dbId, { dsId, expires: Date.now() + SCHEMA_CACHE_TTL });
  return dsId;
}

/**
 * Get cached schema (properties) for a database.
 * In API 2025-09-03, properties live on the data source, not the database.
 */
export async function getCachedSchema(client: Client, dbId: string) {
  const cached = schemaCache.get(dbId);
  if (cached && cached.expires > Date.now()) {
    return cached.schema;
  }
  const dsId = await getDataSourceId(client, dbId);
  const ds = await client.dataSources.retrieve({ data_source_id: dsId });
  schemaCache.set(dbId, { schema: ds, expires: Date.now() + SCHEMA_CACHE_TTL });
  return ds;
}

export async function uploadFile(client: Client, fileUrl: string): Promise<{ id: string; blockType: string }> {
  const filePath = fileURLToPath(fileUrl);
  const filename = basename(filePath);
  const contentType = getMimeType(filePath);

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
  if (fileStat.size > MAX_FILE_SIZE) throw new Error(`File too large (${Math.round(fileStat.size / 1024 / 1024)}MB). Max 20MB: ${filePath}`);

  const upload = await client.fileUploads.create({
    mode: "single_part",
    filename,
    content_type: contentType,
  });

  const buffer = await readFile(filePath);
  const blob = new Blob([buffer], { type: contentType });

  await client.fileUploads.send({
    file_upload_id: upload.id,
    file: { data: blob, filename },
  });

  const blockType = contentType.startsWith("image/") ? "image"
    : contentType.startsWith("audio/") ? "audio"
    : contentType.startsWith("video/") ? "video"
    : "file";

  return { id: upload.id, blockType };
}

export async function getDatabase(client: Client, dbId: string) {
  const db = await client.databases.retrieve({ database_id: dbId }) as any;
  const ds = await getCachedSchema(client, dbId) as any;
  const properties = Object.entries(ds.properties ?? {}).map(([name, config]: [string, any]) => {
    const prop: Record<string, unknown> = { name, type: config.type };
    if (config.type === "select" && config.select?.options) {
      prop.options = config.select.options.map((o: any) => o.name);
    } else if (config.type === "multi_select" && config.multi_select?.options) {
      prop.options = config.multi_select.options.map((o: any) => o.name);
    } else if (config.type === "status" && config.status?.options) {
      prop.options = config.status.options.map((o: any) => o.name);
    } else if (config.type === "formula" && config.formula?.expression !== undefined) {
      prop.expression = config.formula.expression;
    } else if (config.type === "relation") {
      if (config.relation?.data_source_id !== undefined) {
        prop.data_source_id = config.relation.data_source_id;
      }
      if (config.relation?.type !== undefined) {
        prop.relation_type = config.relation.type;
      }
    } else if (config.type === "rollup") {
      if (config.rollup?.function !== undefined) {
        prop.function = config.rollup.function;
      }
      if (config.rollup?.relation_property_name ?? config.rollup?.relation_property_id) {
        prop.relation_property =
          config.rollup.relation_property_name ?? config.rollup.relation_property_id;
      }
      if (config.rollup?.rollup_property_name ?? config.rollup?.rollup_property_id) {
        prop.rollup_property =
          config.rollup.rollup_property_name ?? config.rollup.rollup_property_id;
      }
    } else if (config.type === "unique_id" && config.unique_id?.prefix !== undefined) {
      prop.prefix = config.unique_id.prefix;
    } else if (config.type === "number" && config.number?.format !== undefined) {
      prop.format = config.number.format;
    }
    return prop;
  });

  return {
    id: db.id,
    title: db.title?.[0]?.plain_text ?? "",
    url: db.url,
    properties,
  };
}

export async function buildTextFilter(client: Client, dbId: string, text: string) {
  const schema = await getCachedSchema(client, dbId) as any;
  const props = schema.properties ?? {};
  const textTypes = ["title", "rich_text", "url", "email", "phone_number"];
  const textProps = Object.entries(props)
    .filter(([_, v]: any) => textTypes.includes(v.type))
    .map(([name, v]: any) => ({ property: name, [v.type]: { contains: text } }));
  if (textProps.length === 0) return undefined;
  if (textProps.length === 1) return textProps[0];
  return { or: textProps };
}

function validTypeList() {
  return VALID_SCHEMA_TYPES.join(", ");
}

function invalidSchemaTypeError(name: string, type: string) {
  return new Error(
    `Property "${name}" has type "${type}", which is not a valid Notion property type. ` +
      `Valid types: ${validTypeList()}.`,
  );
}

function normalizeSchemaOptions(name: string, options: unknown) {
  if (options === undefined) {
    return undefined;
  }
  if (!Array.isArray(options)) {
    throw new Error(`Property "${name}" must provide options as an array.`);
  }

  return options.map((option) => {
    if (typeof option === "string") {
      return { name: option };
    }
    if (option && typeof option === "object" && !Array.isArray(option)) {
      const { name: optionName, color, description } = option as Record<string, unknown>;
      if (typeof optionName !== "string" || optionName.length === 0) {
        throw new Error(`Property "${name}" has an option without a valid name.`);
      }
      const normalized: Record<string, unknown> = { name: optionName };
      if (color !== undefined) normalized.color = color;
      if (description !== undefined) normalized.description = description;
      return normalized;
    }
    throw new Error(`Property "${name}" has an invalid option. Use a string or {name, color, description}.`);
  });
}

async function maybeResolveSchemaDataSourceId(client: Client, value: string) {
  try {
    return await getDataSourceId(client, value);
  } catch {
    return value;
  }
}

async function resolveRelationDataSourceIds(client: Client, schema: SchemaEntry[], props: Record<string, any>) {
  for (const entry of schema) {
    if (entry.type !== "relation") {
      continue;
    }
    const dataSourceId = entry.data_source_id;
    if (typeof dataSourceId === "string" && props[entry.name]?.relation) {
      props[entry.name].relation.data_source_id = await maybeResolveSchemaDataSourceId(client, dataSourceId);
    }
  }
  return props;
}

function isSchemaShapePropertiesMap(properties: Record<string, unknown>) {
  return Object.values(properties).every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string" || !VALID_SCHEMA_TYPES_SET.has(record.type)) {
      return false;
    }
    return !Object.keys(record).some((key) => key !== "type" && RAW_PROPERTY_SHAPE_KEYS.has(key));
  });
}

export function schemaToProperties(schema: SchemaEntry[]) {
  const props: Record<string, any> = {};

  for (const entry of schema) {
    const { name, type } = entry;
    switch (type) {
      case "title":
        props[name] = { title: {} };
        break;
      case "rich_text":
      case "text":
        props[name] = { rich_text: {} };
        break;
      case "number": {
        const format = entry.format;
        props[name] = { number: format !== undefined ? { format } : {} };
        break;
      }
      case "select": {
        const options = normalizeSchemaOptions(name, entry.options);
        props[name] = { select: options ? { options } : {} };
        break;
      }
      case "multi_select": {
        const options = normalizeSchemaOptions(name, entry.options);
        props[name] = { multi_select: options ? { options } : {} };
        break;
      }
      case "status": {
        const options = normalizeSchemaOptions(name, entry.options);
        props[name] = { status: options ? { options } : {} };
        break;
      }
      case "date":
        props[name] = { date: {} };
        break;
      case "checkbox":
        props[name] = { checkbox: {} };
        break;
      case "url":
        props[name] = { url: {} };
        break;
      case "email":
        props[name] = { email: {} };
        break;
      case "phone":
        props[name] = { phone_number: {} };
        break;
      case "formula":
        if (typeof entry.expression !== "string" || entry.expression.trim().length === 0) {
          throw new Error(`Property "${name}" is a formula and requires a non-empty expression.`);
        }
        props[name] = { formula: { expression: entry.expression } };
        break;
      case "rollup":
        if (typeof entry.function !== "string" || entry.function.length === 0) {
          throw new Error(`Property "${name}" is a rollup and requires a function.`);
        }
        if (typeof entry.relation_property !== "string" || entry.relation_property.length === 0) {
          throw new Error(`Property "${name}" is a rollup and requires relation_property.`);
        }
        if (typeof entry.rollup_property !== "string" || entry.rollup_property.length === 0) {
          throw new Error(`Property "${name}" is a rollup and requires rollup_property.`);
        }
        props[name] = {
          rollup: {
            function: entry.function,
            relation_property_name: entry.relation_property,
            rollup_property_name: entry.rollup_property,
          },
        };
        break;
      case "relation": {
        if (typeof entry.data_source_id !== "string" || entry.data_source_id.length === 0) {
          throw new Error(`Property "${name}" is a relation and requires data_source_id.`);
        }
        const relationType =
          entry.relation_type === "dual_property" ? "dual_property" : "single_property";
        props[name] = relationType === "dual_property"
          ? {
              relation: {
                data_source_id: entry.data_source_id,
                type: "dual_property",
                dual_property: entry.synced_property_name !== undefined
                  ? { synced_property_name: entry.synced_property_name }
                  : {},
              },
            }
          : {
              relation: {
                data_source_id: entry.data_source_id,
                type: "single_property",
                single_property: {},
              },
            };
        break;
      }
      case "unique_id":
        props[name] = { unique_id: entry.prefix !== undefined ? { prefix: entry.prefix } : {} };
        break;
      case "people":
        props[name] = { people: {} };
        break;
      case "files":
        props[name] = { files: {} };
        break;
      case "verification":
        props[name] = { verification: {} };
        break;
      case "place":
        props[name] = { place: {} };
        break;
      case "location":
        props[name] = { location: {} };
        break;
      case "button":
        props[name] = { button: {} };
        break;
      case "created_time":
        props[name] = { created_time: {} };
        break;
      case "last_edited_time":
        props[name] = { last_edited_time: {} };
        break;
      case "created_by":
        props[name] = { created_by: {} };
        break;
      case "last_edited_by":
        props[name] = { last_edited_by: {} };
        break;
      default:
        throw invalidSchemaTypeError(name, type);
    }
  }

  return props;
}

/** @internal Exported for test seams; not part of the public API contract. */
export function convertPropertyValue(
  type: string,
  key: string,
  value: unknown,
): Record<string, unknown> {
  switch (type) {
    case "title":
      return { title: titleRichText(String(value)) };
    case "rich_text":
      return { rich_text: titleRichText(String(value)) };
    case "number":
      return { number: Number(value) };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select":
      return {
        multi_select: (Array.isArray(value) ? value : [value]).map((item) => ({
          name: String(item),
        })),
      };
    case "date":
      return { date: { start: String(value) } };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: String(value) };
    case "email":
      return { email: String(value) };
    case "phone_number":
      return { phone_number: String(value) };
    case "status":
      return { status: { name: String(value) } };
    case "relation":
      return {
        relation: (Array.isArray(value) ? value : [value])
          .filter((id) => id)
          .map((id) => ({ id: String(id) })),
      };
    case "people":
      return {
        people: (Array.isArray(value) ? value : [value])
          .filter((id) => id)
          .map((id) => ({ id: String(id) })),
      };
    case "files":
      throw new Error(
        `Property '${key}' has type '${type}'. ` +
          `easy-notion-mcp does not support writing '${type}' properties yet. ` +
          `Tracked task: notion-files-value-write. Only external URL writes are planned. ` +
          `Remove '${key}' from the payload, or set this field in the Notion UI.`,
      );
    case "formula":
    case "rollup":
    case "created_time":
    case "last_edited_time":
    case "created_by":
    case "last_edited_by":
    case "unique_id":
      throw new Error(
        `Property '${key}' has type '${type}'. ` +
          `This type is computed by Notion and cannot be set via API. ` +
          `Remove '${key}' from the payload; Notion populates the value automatically.`,
      );
    case "verification":
      throw new Error(
        `Property '${key}' has type '${type}'. ` +
          `easy-notion-mcp does not support writing '${type}' properties yet. ` +
          `Tracked task: notion-verification-value-write. ` +
          `Remove '${key}' from the payload, or set this field in the Notion UI.`,
      );
    case "place":
    case "location":
      throw new Error(
        `Property '${key}' has type '${type}'. ` +
          `This type is computed by Notion or not yet supported for writes. ` +
          `Remove '${key}' from the payload for now.`,
      );
    case "button":
      throw new Error(
        `Property '${key}' has type '${type}'. ` +
          `This type is trigger-only; buttons have no write value. ` +
          `Remove '${key}' from the payload for now.`,
      );
    default:
      throw new Error(
        `Property '${key}' has type '${type}', which this server does not recognize. ` +
          `Remove '${key}' from the payload for now, or set it in the Notion UI. ` +
          `If this is a new Notion property type, file an issue at the easy-notion-mcp repository.`,
      );
  }
}

async function convertPropertyValues(
  client: Client,
  dbId: string,
  values: Record<string, unknown>,
) {
  let ds = (await getCachedSchema(client, dbId)) as any;
  const quoted = (ks: string[]) => ks.map((k) => `'${k}'`).join(", ");

  let unknownKeys = Object.keys(values).filter((k) => !(k in (ds.properties ?? {})));
  if (unknownKeys.length > 0) {
    // Cache may be stale (5-minute TTL); a user who just added a property in
    // the Notion UI would otherwise be told their new key is unknown. Bust
    // and refetch ONCE before throwing so the error reflects reality.
    schemaCache.delete(dbId);
    ds = (await getCachedSchema(client, dbId)) as any;
    unknownKeys = Object.keys(values).filter((k) => !(k in (ds.properties ?? {})));
  }

  if (unknownKeys.length > 0) {
    const validKeys = Object.keys(ds.properties ?? {});
    throw new Error(
      `Unknown property name(s): ${quoted(unknownKeys)}. ` +
        `Valid property names for this database: ${quoted(validKeys)}. ` +
        `Property names are case-sensitive.`,
    );
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(values)) {
    const propConfig = ds.properties[key];
    result[key] = convertPropertyValue(propConfig.type, key, value);
  }

  return result;
}

export async function createPage(
  client: Client,
  parent: string | PageParent,
  title: string,
  blocks: NotionBlock[],
  icon?: string,
  cover?: string,
) {
  const resolvedParent = typeof parent === "string"
    ? { type: "page_id" as const, page_id: parent }
    : parent;
  const initialBlocks = blocks.slice(0, NOTION_BLOCK_CHILDREN_LIMIT);
  const initialBlocksNeedDeferredWrites = initialBlocks.some((block) => needsDeferredChildWrites(block));

  const page = await client.pages.create({
    parent: resolvedParent,
    properties: {
      title: {
        title: titleRichText(title),
      },
    },
    children: initialBlocks.map((block) => prepareBlockForWrite(block)) as any[],
    ...(icon ? { icon: { type: "emoji", emoji: icon as any } } : {}),
    ...(cover ? { cover: { type: "external", external: { url: cover } } } : {}),
  } as any);

  const remainingBlocks = blocks.slice(NOTION_BLOCK_CHILDREN_LIMIT);
  if (initialBlocksNeedDeferredWrites || remainingBlocks.length > 0) {
    try {
      if (initialBlocksNeedDeferredWrites) {
        const createdInitialBlocks = await listChildren(client, (page as any).id);
        for (let index = 0; index < initialBlocks.length; index += 1) {
          if (!needsDeferredChildWrites(initialBlocks[index])) {
            continue;
          }
          const createdBlockId = (createdInitialBlocks[index] as any)?.id;
          if (typeof createdBlockId !== "string" || createdBlockId.length === 0) {
            throw new Error("Notion page creation returned no id for child block");
          }
          await appendDeferredChildren(client, createdBlockId, initialBlocks[index]);
        }
      }

      if (remainingBlocks.length > 0) {
        await appendBlocks(client, (page as any).id, remainingBlocks);
      }
    } catch (error) {
      try {
        await client.pages.update({ page_id: (page as any).id, in_trash: true } as any);
      } catch {
        // Best-effort rollback: preserve the append failure as the caller-visible error.
      }
      throw error;
    }
  }

  return page;
}

export async function findWorkspacePages(
  client: Client,
  limit: number = 5,
): Promise<Array<{ id: string; title: string }>> {
  const pages: Array<{ id: string; title: string }> = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.search({
      filter: { property: "object", value: "page" },
      sort: { timestamp: "last_edited_time", direction: "descending" },
      start_cursor,
      page_size: 20,
    });

    for (const page of response.results as any[]) {
      if (page.parent?.type !== "workspace") {
        continue;
      }

      const titleProperty = Object.values(page.properties ?? {}).find(
        (property: any) => property?.type === "title",
      ) as any;
      const title = (titleProperty?.title ?? [])
        .map((item: any) => item.plain_text ?? item.text?.content ?? "")
        .join("");

      pages.push({ id: page.id, title: title || "Untitled" });
      if (pages.length >= limit) {
        return pages;
      }
    }

    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return pages;
}

export async function appendBlocks(client: Client, pageId: string, blocks: NotionBlock[]) {
  return appendPreparedBlocks(client, pageId, blocks);
}

export async function appendBlocksAfter(
  client: Client,
  pageId: string,
  blocks: NotionBlock[],
  afterBlockId?: string,
) {
  return appendPreparedBlocks(client, pageId, blocks, afterBlockId);
}

export async function listChildren(client: Client, blockId: string) {
  const results: any[] = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      start_cursor,
      page_size: 100,
    });
    results.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return results;
}

export async function deleteBlock(client: Client, blockId: string) {
  return client.blocks.delete({ block_id: blockId });
}

export async function retrieveBlock(client: Client, blockId: string) {
  return client.blocks.retrieve({ block_id: blockId });
}

export async function replacePageMarkdown(
  client: Client,
  pageId: string,
  newStr: string,
  options: { allowDeletingContent?: boolean } = {},
) {
  return (client as any).pages.updateMarkdown({
    page_id: pageId,
    type: "replace_content",
    replace_content: {
      new_str: newStr,
      allow_deleting_content: options.allowDeletingContent ?? true,
    },
  });
}

export async function updateBlock(
  client: Client,
  blockId: string,
  payload: Record<string, unknown>,
) {
  return (client.blocks as any).update({ block_id: blockId, ...payload });
}

export async function getPage(client: Client, pageId: string) {
  return client.pages.retrieve({ page_id: pageId });
}

export async function updatePage(
  client: Client,
  pageId: string,
  props: { title?: string; icon?: string; cover?: string | { type: string; [key: string]: any } },
) {
  const payload: Record<string, any> = {};

  if (props.title) {
    payload.properties = {
      title: {
        title: titleRichText(props.title),
      },
    };
  }

  if (props.icon) {
    payload.icon = { type: "emoji", emoji: props.icon };
  }

  if (props.cover) {
    if (typeof props.cover === "string") {
      payload.cover = { type: "external", external: { url: props.cover } };
    } else {
      payload.cover = props.cover;
    }
  }

  return client.pages.update({
    page_id: pageId,
    ...payload,
  } as any);
}

export async function archivePage(client: Client, pageId: string) {
  return client.pages.update({ page_id: pageId, in_trash: true });
}

export async function restorePage(client: Client, pageId: string) {
  return client.pages.update({ page_id: pageId, in_trash: false });
}

export async function movePage(client: Client, pageId: string, newParentId: string) {
  return client.pages.move({
    page_id: pageId,
    parent: { page_id: newParentId },
  });
}

export async function searchNotion(
  client: Client,
  query: string,
  filter?: "pages" | "databases",
) {
  const results: any[] = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.search({
      query,
      start_cursor,
      page_size: 100,
      ...(filter
        ? {
            filter: {
              property: "object" as const,
              value: filter === "pages" ? ("page" as const) : ("data_source" as const),
            },
          }
        : {}),
    });

    results.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return results;
}

export async function createDatabase(
  client: Client,
  parentId: string,
  title: string,
  schema: SchemaEntry[],
  options?: { is_inline?: boolean },
) {
  const properties = await resolveRelationDataSourceIds(client, schema, schemaToProperties(schema));
  return client.databases.create({
    parent: { type: "page_id", page_id: parentId },
    title: titleRichText(title),
    initial_data_source: { properties },
    ...(options?.is_inline !== undefined ? { is_inline: options.is_inline } : {}),
  } as any);
}

export async function updateDataSource(
  client: Client,
  databaseId: string,
  updates: {
    title?: string;
    properties?: PropertiesUpdate;
    in_trash?: boolean;
  },
) {
  if (
    updates.title === undefined &&
    updates.properties === undefined &&
    updates.in_trash === undefined
  ) {
    throw new Error(
      "updateDataSource: at least one of `title`, `properties`, or `in_trash` must be provided",
    );
  }

  const dataSourceId = await getDataSourceId(client, databaseId);

  const body: Record<string, unknown> = { data_source_id: dataSourceId };
  if (updates.title !== undefined) body.title = titleRichText(updates.title);
  if (updates.properties !== undefined) {
    const rawProperties = updates.properties as Record<string, unknown>;
    const schemaEntries = Object.entries(rawProperties).map(([name, value]) => (
      { name, ...(value as Record<string, unknown>) }
    )) as SchemaEntry[];
    body.properties = isSchemaShapePropertiesMap(rawProperties)
      ? await resolveRelationDataSourceIds(
          client,
          schemaEntries,
          schemaToProperties(schemaEntries),
        )
      : updates.properties;
  }
  if (updates.in_trash !== undefined) body.in_trash = updates.in_trash;

  const result = await client.dataSources.update(body as any);
  schemaCache.delete(databaseId);
  return result;
}

export async function queryDatabase(
  client: Client,
  dbId: string,
  filter?: Record<string, unknown>,
  sorts?: unknown[],
) {
  const dsId = await getDataSourceId(client, dbId);
  const results: any[] = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.dataSources.query({
      data_source_id: dsId,
      start_cursor,
      page_size: 100,
      ...(filter ? { filter: filter as any } : {}),
      ...(sorts ? { sorts: sorts as any } : {}),
    });

    results.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return results;
}

export async function listComments(client: Client, pageId: string) {
  const results: any[] = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.comments.list({
      block_id: pageId,
      start_cursor,
      page_size: 100,
    });
    results.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return results;
}

export async function addComment(client: Client, pageId: string, richText: any[]) {
  return client.comments.create({
    parent: { page_id: pageId },
    rich_text: richText,
  });
}

export async function createDatabaseEntry(
  client: Client,
  dbId: string,
  properties: Record<string, unknown>,
) {
  const dsId = await getDataSourceId(client, dbId);
  const convertedProperties = await convertPropertyValues(client, dbId, properties);

  return client.pages.create({
    parent: { data_source_id: dsId },
    properties: convertedProperties,
  } as any);
}

export async function updateDatabaseEntry(
  client: Client,
  pageId: string,
  properties: Record<string, unknown>,
) {
  const page = (await client.pages.retrieve({ page_id: pageId })) as any;
  // Support both old (database_id) and new (data_source_id) parent types
  const dbId = page.parent?.type === "database_id"
    ? page.parent.database_id
    : page.parent?.type === "data_source_id"
      ? page.parent.database_id  // data_source parent also exposes database_id
      : null;

  if (!dbId) {
    throw new Error("Page is not part of a database");
  }

  const convertedProperties = await convertPropertyValues(client, dbId, properties);

  return client.pages.update({
    page_id: pageId,
    properties: convertedProperties,
  } as any);
}

export async function listUsers(client: Client) {
  const results: any[] = [];
  let start_cursor: string | undefined;

  do {
    const response = await client.users.list({
      start_cursor,
      page_size: 100,
    });
    results.push(...response.results);
    start_cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (start_cursor);

  return results;
}

export async function getMe(client: Client) {
  return client.users.me({});
}

/** @internal */
export { paginatePropertyValue };

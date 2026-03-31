import { Client } from "@notionhq/client";
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

const schemaCache = new Map<string, { schema: any; expires: number }>();
const dataSourceIdCache = new Map<string, { dsId: string; expires: number }>();
const SCHEMA_CACHE_TTL = 5 * 60 * 1000;

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

function schemaToProperties(schema: Array<{ name: string; type: string }>) {
  const props: Record<string, any> = {};

  for (const { name, type } of schema) {
    switch (type) {
      case "title":
        props[name] = { title: {} };
        break;
      case "text":
        props[name] = { rich_text: {} };
        break;
      case "number":
        props[name] = { number: {} };
        break;
      case "select":
        props[name] = { select: {} };
        break;
      case "multi_select":
        props[name] = { multi_select: {} };
        break;
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
      case "status":
        props[name] = { status: {} };
        break;
      default:
        break;
    }
  }

  return props;
}

async function convertPropertyValues(
  client: Client,
  dbId: string,
  values: Record<string, unknown>,
) {
  const ds = (await getCachedSchema(client, dbId)) as any;
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(values)) {
    const propConfig = ds.properties[key];
    if (!propConfig) {
      continue;
    }

    switch (propConfig.type) {
      case "title":
        result[key] = { title: titleRichText(String(value)) };
        break;
      case "rich_text":
        result[key] = { rich_text: titleRichText(String(value)) };
        break;
      case "number":
        result[key] = { number: Number(value) };
        break;
      case "select":
        result[key] = { select: { name: String(value) } };
        break;
      case "multi_select":
        result[key] = {
          multi_select: (Array.isArray(value) ? value : [value]).map((item) => ({
            name: String(item),
          })),
        };
        break;
      case "date":
        result[key] = { date: { start: String(value) } };
        break;
      case "checkbox":
        result[key] = { checkbox: Boolean(value) };
        break;
      case "url":
        result[key] = { url: String(value) };
        break;
      case "email":
        result[key] = { email: String(value) };
        break;
      case "phone_number":
        result[key] = { phone_number: String(value) };
        break;
      case "status":
        result[key] = { status: { name: String(value) } };
        break;
      case "relation":
        result[key] = {
          relation: (Array.isArray(value) ? value : [value])
              .filter((id) => id)
              .map((id) => ({
                id: String(id),
              })),
        };
        break;
      default:
        break;
    }
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

  return client.pages.create({
    parent: resolvedParent,
    properties: {
      title: {
        title: titleRichText(title),
      },
    },
    children: blocks as any[],
    ...(icon ? { icon: { type: "emoji", emoji: icon as any } } : {}),
    ...(cover ? { cover: { type: "external", external: { url: cover } } } : {}),
  } as any);
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
  const results: any[] = [];

  for (let index = 0; index < blocks.length; index += 100) {
    const chunk = blocks.slice(index, index + 100);
    const response = await client.blocks.children.append({
      block_id: pageId,
      children: chunk as any[],
    });
    results.push(...response.results);
  }

  return results;
}

export async function appendBlocksAfter(
  client: Client,
  pageId: string,
  blocks: NotionBlock[],
  afterBlockId?: string,
) {
  const results: any[] = [];

  for (let index = 0; index < blocks.length; index += 100) {
    const chunk = blocks.slice(index, index + 100);
    const response = await client.blocks.children.append({
      block_id: pageId,
      children: chunk as any[],
      ...(afterBlockId ? { after: afterBlockId } : {}),
    } as any);
    results.push(...response.results);

    if (response.results.length > 0) {
      afterBlockId = (response.results[response.results.length - 1] as any).id;
    }
  }

  return results;
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
  schema: Array<{ name: string; type: string }>,
) {
  return client.databases.create({
    parent: { type: "page_id", page_id: parentId },
    title: titleRichText(title),
    initial_data_source: { properties: schemaToProperties(schema) },
  } as any);
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

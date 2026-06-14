import type { PropertyFixture } from "../corpus/generate.js";
import { completenessScore, serializeIr, type CompletenessScore, type IrDatabase, type IrDatabaseRow } from "./ir.js";
import type { DbReadResult } from "./db-adapters.js";
import type { ServerId } from "./servers.js";
import { countCl100k } from "./token-counter.js";

export interface DbMetadataSlots {
  rowId: number;
  createdTime: number;
  lastEditedTime: number;
  createdBy: number;
  lastEditedBy: number;
  archived: number;
}

export interface DbPropertyMetadataSlots {
  propertyId: number;
  optionId: number;
  optionColor: number;
}

export interface DbGroundTruth {
  ir: IrDatabase;
  metadataSlots: DbMetadataSlots;
  propertyMetadataSlots: DbPropertyMetadataSlots;
  contentSlots: number;
  rowCount: number;
}

export interface DbThreeNumber {
  serverId: ServerId;
  asConsumed: { cl100k: number; anthropic: number | null; bytes: number };
  commonIr: { cl100k: number; anthropic: number | null; bytes: number };
  contentCompleteness: CompletenessScore;
  fullCompleteness: CompletenessScore;
  callCount: number;
}

export interface ComputeDbThreeNumberOptions {
  anthropicCount?: (text: string) => Promise<number | null>;
}

type JsonObject = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function notionRowsToIrDatabase(rawRows: unknown, schema: PropertyFixture[], title = ""): IrDatabase {
  const rows = extractRows(rawRows);
  return {
    kind: "database",
    title,
    properties: schema.map((property) => ({
      name: property.name,
      type: property.type,
      ...(property.options ? { options: property.options } : {}),
    })),
    rows: rows.map((row) => notionRowToIr(row, schema)),
  };
}

export function flatRowsToIrDatabase(text: string, schema: PropertyFixture[], title = ""): IrDatabase {
  const parsed = parseJson(text);
  const rows = extractFlatRows(parsed ?? text);
  return {
    kind: "database",
    title,
    properties: schema.map((property) => ({
      name: property.name,
      type: property.type,
      ...(property.options ? { options: property.options } : {}),
    })),
    rows: rows.map((row) => flatRowToIr(row, schema)),
  };
}

export function dbGroundTruthFromRaw(rawRows: unknown, schema: PropertyFixture[], title = ""): DbGroundTruth {
  const rows = extractRows(rawRows);
  const ir = notionRowsToIrDatabase(rawRows, schema, title);
  const metadataSlots: DbMetadataSlots = {
    rowId: 0,
    createdTime: 0,
    lastEditedTime: 0,
    createdBy: 0,
    lastEditedBy: 0,
    archived: 0,
  };
  const propertyMetadataSlots: DbPropertyMetadataSlots = {
    propertyId: 0,
    optionId: 0,
    optionColor: 0,
  };

  for (const row of rows) {
    if ("id" in row) metadataSlots.rowId += 1;
    if ("created_time" in row) metadataSlots.createdTime += 1;
    if ("last_edited_time" in row) metadataSlots.lastEditedTime += 1;
    if ("created_by" in row) metadataSlots.createdBy += 1;
    if ("last_edited_by" in row) metadataSlots.lastEditedBy += 1;
    if ("archived" in row || "in_trash" in row) metadataSlots.archived += 1;

    const properties = readObject(row.properties);
    if (!properties) continue;
    for (const propertyValue of Object.values(properties)) {
      const property = readObject(propertyValue);
      if (!property) continue;
      if ("id" in property) propertyMetadataSlots.propertyId += 1;
      countOptionMetadata(property, propertyMetadataSlots);
    }
  }

  return {
    ir,
    metadataSlots,
    propertyMetadataSlots,
    contentSlots: ir.rows.reduce((sum, row) => sum + Object.keys(row.properties).length, 0),
    rowCount: ir.rows.length,
  };
}

export async function computeDbThreeNumber(
  readResult: DbReadResult,
  projectedIr: IrDatabase,
  groundTruth: DbGroundTruth,
  opts: ComputeDbThreeNumberOptions = {},
): Promise<DbThreeNumber> {
  const serializedIr = serializeIr(projectedIr);
  const asConsumedAnthropic = opts.anthropicCount ? await opts.anthropicCount(readResult.asConsumedText) : null;
  const commonIrAnthropic = opts.anthropicCount ? await opts.anthropicCount(serializedIr) : null;
  const content = scoreDbContent(projectedIr, groundTruth.ir);
  const metadataTotal = metadataSlotTotal(groundTruth.metadataSlots);
  const propertyMetadataTotal = propertyMetadataSlotTotal(groundTruth.propertyMetadataSlots);
  const fidelityTotal = metadataTotal + propertyMetadataTotal;
  const fidelityPreserved = readResult.serverId === "makenotion" ? fidelityTotal : 0;
  const fullMissing = new Set(content.missing);

  if (fidelityPreserved < fidelityTotal) {
    if (groundTruth.metadataSlots.rowId > 0) fullMissing.add("row-uuid");
    if (groundTruth.metadataSlots.createdTime + groundTruth.metadataSlots.lastEditedTime > 0) {
      fullMissing.add("timestamps");
    }
    if (groundTruth.metadataSlots.createdBy + groundTruth.metadataSlots.lastEditedBy > 0) {
      fullMissing.add("authors");
    }
    if (groundTruth.metadataSlots.archived > 0) fullMissing.add("archived");
    if (groundTruth.propertyMetadataSlots.propertyId > 0) fullMissing.add("property-id");
    if (groundTruth.propertyMetadataSlots.optionId > 0) fullMissing.add("select-option-id");
    if (groundTruth.propertyMetadataSlots.optionColor > 0) fullMissing.add("select-option-color");
  }

  return {
    serverId: readResult.serverId,
    asConsumed: {
      cl100k: countCl100k(readResult.asConsumedText),
      anthropic: asConsumedAnthropic,
      bytes: Buffer.byteLength(readResult.asConsumedText, "utf8"),
    },
    commonIr: {
      cl100k: countCl100k(serializedIr),
      anthropic: commonIrAnthropic,
      bytes: Buffer.byteLength(serializedIr, "utf8"),
    },
    contentCompleteness: completenessScore({
      preserved: content.preserved,
      total: content.total,
      missing: [...content.missing],
      lossy: [...content.lossy],
    }),
    fullCompleteness: completenessScore({
      preserved: content.preserved + fidelityPreserved,
      total: content.total + fidelityTotal,
      missing: [...fullMissing],
      lossy: [...content.lossy],
    }),
    callCount: readResult.callCount,
  };
}

function notionRowToIr(row: JsonObject, schema: PropertyFixture[]): IrDatabaseRow {
  const properties = readObject(row.properties) ?? {};
  const rowProperties: Record<string, JsonValue> = {};
  let title = "";

  for (const property of schema) {
    const value = notionPropertyValue(properties[property.name], property.type);
    if (value === undefined) continue;
    rowProperties[property.name] = value;
    if (property.type === "title") {
      title = String(contentValue(value));
    }
  }

  return { title, properties: rowProperties };
}

function flatRowToIr(row: unknown, schema: PropertyFixture[]): IrDatabaseRow {
  const object = readObject(row) ?? {};
  const sourceProperties = readObject(object.properties) ?? object;
  const rowProperties: Record<string, JsonValue> = {};
  let title = "";

  for (const property of schema) {
    const raw = sourceProperties[property.name] ?? sourceProperties[property.name.toLowerCase()];
    if (raw === undefined) continue;
    const value = flatPropertyValue(raw, property.type);
    rowProperties[property.name] = value;
    if (property.type === "title") {
      title = String(contentValue(value));
    }
  }

  if (!title && typeof object.title === "string") {
    title = object.title;
  }
  return { title, properties: rowProperties };
}

function notionPropertyValue(value: unknown, type: PropertyFixture["type"]): JsonValue | undefined {
  const property = readObject(value);
  if (!property) return undefined;

  switch (type) {
    case "title":
      return richTextPlain(Array.isArray(property.title) ? property.title : []);
    case "rich_text":
      return richTextPlain(Array.isArray(property.rich_text) ? property.rich_text : []);
    case "number":
      return typeof property.number === "number" ? property.number : null;
    case "select":
      return optionValue(property.select);
    case "multi_select":
      return Array.isArray(property.multi_select) ? property.multi_select.map(optionValue).filter(isJsonValue) : [];
    case "status":
      return optionValue(property.status);
    case "date": {
      const date = readObject(property.date);
      return typeof date?.start === "string" ? date.start : null;
    }
    case "checkbox":
      return property.checkbox === true;
    case "url":
      return typeof property.url === "string" ? property.url : null;
    case "email":
      return typeof property.email === "string" ? property.email : null;
    case "phone":
      return typeof property.phone_number === "string" ? property.phone_number : null;
    case "people":
      return undefined;
  }
}

function flatPropertyValue(value: unknown, type: PropertyFixture["type"]): JsonValue {
  if (isJsonValue(value)) {
    if (type === "select" || type === "status") {
      const object = readObject(value);
      return object && typeof object.name === "string" ? object.name : value;
    }
    if (type === "multi_select" && Array.isArray(value)) {
      return value.map((item) => {
        const object = readObject(item);
        return object && typeof object.name === "string" ? object.name : item;
      }).filter(isJsonValue);
    }
    return value;
  }
  return String(value);
}

function optionValue(value: unknown): JsonValue {
  const option = readObject(value);
  if (!option) return null;
  return {
    ...(typeof option.id === "string" ? { id: option.id } : {}),
    ...(typeof option.name === "string" ? { name: option.name } : {}),
    ...(typeof option.color === "string" ? { color: option.color } : {}),
  };
}

function richTextPlain(value: unknown[]): string {
  return value.filter(isJsonObject).map((item) => {
    const text = readObject(item.text);
    if (typeof text?.content === "string") return text.content;
    return typeof item.plain_text === "string" ? item.plain_text : "";
  }).join("");
}

function scoreDbContent(projected: IrDatabase, groundTruth: IrDatabase) {
  const counts = { preserved: 0, total: 0, missing: new Set<string>(), lossy: new Set<string>() };

  for (const [rowIndex, groundRow] of groundTruth.rows.entries()) {
    const projectedRow = projected.rows[rowIndex];
    for (const [propertyName, groundValue] of Object.entries(groundRow.properties)) {
      counts.total += 1;
      const projectedValue = projectedRow?.properties[propertyName];
      if (sameContentValue(projectedValue, groundValue)) {
        counts.preserved += 1;
      } else {
        counts.missing.add(`property-value:${propertyName}`);
        counts.lossy.add("property-value");
      }
    }
  }

  return counts;
}

function sameContentValue(projected: unknown, ground: unknown): boolean {
  return stableStringify(contentValue(projected)) === stableStringify(contentValue(ground));
}

function contentValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(contentValue);
  }
  const object = readObject(value);
  if (object) {
    if ("name" in object && typeof object.name === "string") return object.name;
    if ("start" in object && typeof object.start === "string") return object.start;
  }
  return value;
}

function countOptionMetadata(property: JsonObject, slots: DbPropertyMetadataSlots): void {
  for (const key of ["select", "status"] as const) {
    const option = readObject(property[key]);
    if (!option) continue;
    if ("id" in option) slots.optionId += 1;
    if ("color" in option) slots.optionColor += 1;
  }
  if (Array.isArray(property.multi_select)) {
    for (const value of property.multi_select) {
      const option = readObject(value);
      if (!option) continue;
      if ("id" in option) slots.optionId += 1;
      if ("color" in option) slots.optionColor += 1;
    }
  }
}

function extractRows(rawRows: unknown): JsonObject[] {
  if (Array.isArray(rawRows)) return rawRows.filter(isJsonObject);
  const object = readObject(rawRows);
  if (!object) return [];
  if (Array.isArray(object.results)) return object.results.filter(isJsonObject);
  if (Array.isArray(object.rows)) return object.rows.filter(isJsonObject);
  return [];
}

function extractFlatRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const object = readObject(raw);
  if (!object) return [];
  if (Array.isArray(object.rows)) return object.rows;
  if (Array.isArray(object.results)) return object.results;
  if (Array.isArray(object.data)) return object.data;
  return [];
}

function metadataSlotTotal(slots: DbMetadataSlots): number {
  return Object.values(slots).reduce((sum, value) => sum + value, 0);
}

function propertyMetadataSlotTotal(slots: DbPropertyMetadataSlots): number {
  return Object.values(slots).reduce((sum, value) => sum + value, 0);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isJsonObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isJsonObject(value)) {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson(value[key]);
    }
    return sorted;
  }
  return value;
}

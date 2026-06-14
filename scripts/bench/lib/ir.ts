export type IrBlockKind =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "equation"
  | "table"
  | "table_row"
  | "image"
  | "file"
  | "bookmark"
  | "embed"
  | "divider"
  | "unsupported";

export interface IrAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

export interface IrTextSpan {
  text: string;
  href?: string;
  annotations?: IrAnnotations;
}

export interface IrBlock {
  kind: IrBlockKind;
  text?: string;
  spans?: IrTextSpan[];
  language?: string;
  checked?: boolean;
  url?: string;
  caption?: string;
  children?: IrBlock[];
  properties?: Record<string, JsonValue>;
}

export interface IrPage {
  kind: "page";
  title: string;
  blocks: IrBlock[];
  properties?: Record<string, JsonValue>;
}

export interface IrDatabase {
  kind: "database";
  title: string;
  properties: IrDatabaseProperty[];
  rows: IrDatabaseRow[];
}

export interface IrDatabaseProperty {
  name: string;
  type: string;
  options?: string[];
}

export interface IrDatabaseRow {
  title?: string;
  properties: Record<string, JsonValue>;
  body?: IrBlock[];
}

export type CanonicalIr = IrPage | IrDatabase;

export interface ThreeNumberTokenCost {
  asConsumed: {
    tokens: number;
    bytes: number;
    unit: "verbatim-response";
  };
  commonIr: {
    tokens: number;
    bytes: number;
    unit: "canonical-ir";
  };
  completeness: CompletenessScore;
}

export interface CompletenessScoreInput {
  preserved: number;
  total: number;
  missing?: string[];
  lossy?: string[];
}

export interface CompletenessScore {
  preserved: number;
  total: number;
  score: number;
  missing: string[];
  lossy: string[];
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function serializeIr(ir: unknown): string {
  return JSON.stringify(sortJson(ir));
}

export function completenessScore(input: CompletenessScoreInput): CompletenessScore {
  if (!Number.isInteger(input.preserved) || input.preserved < 0) {
    throw new Error("preserved must be a non-negative integer");
  }
  if (!Number.isInteger(input.total) || input.total < 0) {
    throw new Error("total must be a non-negative integer");
  }
  if (input.preserved > input.total) {
    throw new Error("preserved cannot exceed total");
  }

  return {
    preserved: input.preserved,
    total: input.total,
    score: input.total === 0 ? 1 : input.preserved / input.total,
    missing: [...(input.missing ?? [])].sort(),
    lossy: [...(input.lossy ?? [])].sort(),
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortJson(child);
      }
    }
    return sorted;
  }

  return value;
}

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface CorpusManifest {
  pageClasses: Record<string, { label: string; count: number; files: string[] }>;
  databaseClasses: Record<string, { label: string; files: string[] }>;
}

export interface PageFixture {
  id: string;
  classId: string;
  label: string;
  title: string;
  blocks: BlockFixture[];
}

export interface DatabaseFixture {
  id: string;
  classId: "D1" | "D2";
  label: string;
  title: string;
  properties: PropertyFixture[];
  rows: RowFixture[];
}

export interface PropertyFixture {
  name: string;
  type:
    | "title"
    | "rich_text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "checkbox"
    | "url"
    | "email"
    | "phone"
    | "people";
  options?: string[];
}

export interface RowFixture {
  title: string;
  properties: Record<string, string | number | boolean | string[]>;
  body: BlockFixture[];
}

export type BlockFixture =
  | { type: "heading_1" | "heading_2" | "heading_3"; text: string }
  | { type: "paragraph"; text: string; annotations?: Array<{ start: number; end: number; color?: string; bold?: boolean; italic?: boolean }> }
  | { type: "bulleted_list_item" | "numbered_list_item" | "toggle"; text: string; children?: BlockFixture[] }
  | { type: "to_do"; text: string; checked: boolean }
  | { type: "quote" | "callout"; text: string; icon?: string }
  | { type: "code"; language: string; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "image" | "file" | "bookmark" | "embed"; url: string; caption?: string };

const PAGE_CLASSES: Array<{ id: string; label: string; make: (index: number) => BlockFixture[] }> = [
  { id: "R1", label: "favorable-rich", make: makeR1 },
  { id: "R2", label: "typical-prose", make: makeR2 },
  { id: "R3", label: "adversarial-content-light-metadata-heavy", make: makeR3 },
  { id: "R4", label: "adversarial-plain-text-heavy", make: makeR4 },
  { id: "R5", label: "adversarial-annotation-pathological", make: makeR5 },
  { id: "R6", label: "adversarial-code-dominant", make: makeR6 },
  { id: "R7", label: "deep-nesting-many-small-blocks", make: makeR7 },
  { id: "R8", label: "media-embed-file-heavy", make: makeR8 },
];

export async function generateCorpus(outputDir = defaultOutputDir()): Promise<CorpusManifest> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.join(outputDir, "pages"), { recursive: true });
  await mkdir(path.join(outputDir, "databases"), { recursive: true });

  const manifest: CorpusManifest = { pageClasses: {}, databaseClasses: {} };

  for (const pageClass of PAGE_CLASSES) {
    const files: string[] = [];
    const dir = path.join(outputDir, "pages", `${pageClass.id}-${pageClass.label}`);
    await mkdir(dir, { recursive: true });

    for (let index = 1; index <= 5; index += 1) {
      const fixture: PageFixture = {
        id: `${pageClass.id}-${index.toString().padStart(2, "0")}`,
        classId: pageClass.id,
        label: pageClass.label,
        title: `${pageClass.id} ${pageClass.label} ${index}`,
        blocks: pageClass.make(index),
      };
      const relativePath = path.join("pages", `${pageClass.id}-${pageClass.label}`, `${fixture.id}.json`);
      await writeJson(path.join(outputDir, relativePath), fixture);
      files.push(relativePath);
    }

    manifest.pageClasses[pageClass.id] = {
      label: pageClass.label,
      count: files.length,
      files,
    };
  }

  for (const fixture of makeDatabaseFixtures()) {
    const relativePath = path.join("databases", `${fixture.id}.json`);
    await writeJson(path.join(outputDir, relativePath), fixture);
    const entry = manifest.databaseClasses[fixture.classId] ?? {
      label: fixture.label,
      files: [],
    };
    entry.files.push(relativePath);
    manifest.databaseClasses[fixture.classId] = entry;
  }

  await writeJson(path.join(outputDir, "manifest.json"), manifest);
  return manifest;
}

function makeR1(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Rich brief ${index}` },
    { type: "paragraph", text: sentence(index, 24) },
    {
      type: "bulleted_list_item",
      text: `Nested decision ${index}.1`,
      children: [
        { type: "numbered_list_item", text: `Substep ${index}.1.a` },
        { type: "numbered_list_item", text: `Substep ${index}.1.b` },
      ],
    },
    { type: "callout", icon: "info", text: `Callout with context ${index}` },
    { type: "code", language: "typescript", text: `export const case${index} = ${index};\nconsole.log(case${index});` },
    { type: "table", rows: [["Metric", "Value"], ["Index", String(index)], ["Class", "R1"]] },
  ];
}

function makeR2(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Typical prose ${index}` },
    { type: "paragraph", text: sentence(index, 38) },
    { type: "paragraph", text: sentence(index + 10, 34) },
    { type: "paragraph", text: sentence(index + 20, 31) },
    { type: "bulleted_list_item", text: `First implication ${index}` },
    { type: "bulleted_list_item", text: `Second implication ${index}` },
    { type: "bulleted_list_item", text: `Third implication ${index}` },
  ];
}

function makeR3(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Stub ${index}` },
    { type: "paragraph", text: index % 2 === 0 ? "" : "TBD" },
  ];
}

function makeR4(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Plain text heavy ${index}` },
    { type: "paragraph", text: sentence(index, 260) },
    { type: "paragraph", text: sentence(index + 1, 240) },
  ];
}

function makeR5(index: number): BlockFixture[] {
  const text = sentence(index, 60);
  const colors = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", "default"];
  return [
    { type: "heading_1", text: `Annotation pathological ${index}` },
    {
      type: "paragraph",
      text,
      annotations: Array.from({ length: 30 }, (_, annotationIndex) => ({
        start: annotationIndex * 5,
        end: annotationIndex * 5 + 4,
        color: colors[(annotationIndex + index) % colors.length],
        bold: annotationIndex % 2 === 0,
        italic: annotationIndex % 3 === 0,
      })),
    },
  ];
}

function makeR6(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Code dominant ${index}` },
    {
      type: "code",
      language: "typescript",
      text: Array.from({ length: 90 }, (_, line) => `const value${line} = ${line + index};`).join("\n"),
    },
  ];
}

function makeR7(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Deep nesting ${index}` },
    ...Array.from({ length: 24 }, (_, blockIndex) => nestedBlock(index, blockIndex, 0)),
  ];
}

function makeR8(index: number): BlockFixture[] {
  return [
    { type: "heading_1", text: `Media heavy ${index}` },
    { type: "image", url: `https://example.com/bench/${index}/diagram.png`, caption: `Diagram ${index}` },
    { type: "embed", url: `https://example.com/bench/${index}/embed`, caption: `Embed ${index}` },
    { type: "file", url: `https://example.com/bench/${index}/brief.pdf`, caption: `Brief ${index}` },
    { type: "bookmark", url: `https://example.com/bench/${index}/reference`, caption: `Reference ${index}` },
    { type: "paragraph", text: sentence(index, 12) },
  ];
}

function nestedBlock(index: number, blockIndex: number, depth: number): BlockFixture {
  const block: BlockFixture = {
    type: depth % 2 === 0 ? "bulleted_list_item" : "toggle",
    text: `Node ${index}.${blockIndex}.${depth}`,
  };
  if (depth < 4) {
    block.children = [nestedBlock(index, blockIndex, depth + 1)];
  }
  return block;
}

function makeDatabaseFixtures(): DatabaseFixture[] {
  return [
    makeWideDatabase("D1-wide-005", 5),
    makeWideDatabase("D1-wide-100", 100),
    {
      id: "D2-structured-020",
      classId: "D2",
      label: "adversarial-structured-data-heavy",
      title: "D2 structured data heavy",
      properties: d2Properties(),
      rows: Array.from({ length: 20 }, (_, index) => ({
        title: `Structured row ${index + 1}`,
        properties: {
          Priority: ["P0", "P1", "P2"][index % 3],
          Score: index * 7,
          Active: index % 2 === 0,
          Due: `2026-07-${((index % 20) + 1).toString().padStart(2, "0")}`,
          Tags: [`tag-${index % 4}`, `track-${index % 3}`],
          Status: ["Not started", "In progress", "Done"][index % 3],
          OwnerEmail: `owner${index + 1}@example.com`,
        },
        body: [],
      })),
    },
  ];
}

function makeWideDatabase(id: string, rowCount: number): DatabaseFixture {
  return {
    id,
    classId: "D1",
    label: "wide-db",
    title: `${id} wide database`,
    properties: d1Properties(),
    rows: Array.from({ length: rowCount }, (_, index) => ({
      title: `Wide row ${index + 1}`,
      properties: {
        Summary: `Summary ${index + 1}`,
        Estimate: (index % 13) + 1,
        Priority: ["Low", "Medium", "High"][index % 3],
        Tags: [`area-${index % 5}`, `kind-${index % 4}`],
        Status: ["Not started", "In progress", "Done"][index % 3],
        Due: `2026-08-${((index % 28) + 1).toString().padStart(2, "0")}`,
        Done: index % 3 === 0,
        Link: `https://example.com/item/${index + 1}`,
        Contact: `contact${index + 1}@example.com`,
        Phone: `+1-555-01${(index % 100).toString().padStart(2, "0")}`,
      },
      body: [{ type: "paragraph", text: `Body note ${index + 1}` }],
    })),
  };
}

function d1Properties(): PropertyFixture[] {
  return [
    { name: "Name", type: "title" },
    { name: "Summary", type: "rich_text" },
    { name: "Estimate", type: "number" },
    { name: "Priority", type: "select", options: ["Low", "Medium", "High"] },
    { name: "Tags", type: "multi_select", options: ["area-0", "area-1", "area-2", "area-3", "area-4"] },
    { name: "Status", type: "status", options: ["Not started", "In progress", "Done"] },
    { name: "Due", type: "date" },
    { name: "Done", type: "checkbox" },
    { name: "Link", type: "url" },
    { name: "Contact", type: "email" },
    { name: "Phone", type: "phone" },
  ];
}

function d2Properties(): PropertyFixture[] {
  return [
    { name: "Name", type: "title" },
    { name: "Priority", type: "select", options: ["P0", "P1", "P2"] },
    { name: "Score", type: "number" },
    { name: "Active", type: "checkbox" },
    { name: "Due", type: "date" },
    { name: "Tags", type: "multi_select", options: ["tag-0", "tag-1", "tag-2", "tag-3"] },
    { name: "Status", type: "status", options: ["Not started", "In progress", "Done"] },
    { name: "OwnerEmail", type: "email" },
  ];
}

function sentence(seed: number, words: number): string {
  const vocabulary = [
    "agent",
    "page",
    "block",
    "token",
    "schema",
    "markdown",
    "context",
    "database",
    "property",
    "fixture",
    "stable",
    "reader",
    "result",
    "field",
    "surface",
  ];
  return Array.from({ length: words }, (_, index) => vocabulary[(seed + index * 7) % vocabulary.length]).join(" ");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${stableStringify(value)}\n`, "utf8");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
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

function defaultOutputDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.meta/bench/corpus");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputDir();
  generateCorpus(outputDir)
    .then((manifest) => {
      console.log(JSON.stringify({ outputDir, manifest }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

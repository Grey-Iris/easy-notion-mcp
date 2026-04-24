import { stripContentNotice } from "../../e2e/helpers/content-notice.ts";
import type {
  ClaimResult,
  CommentsClaim,
  DatabaseClaim,
  GroundTruth,
  PageClaim,
  PagesUnderParentClaim,
  QueryClaim,
  RowsClaim,
  SchemaDropDetectionClaim,
  TranscriptData,
  VerifyResult,
} from "./types.ts";

type PageSummary = {
  id: string;
  title: string;
  icon?: unknown;
  cover?: unknown;
};

type DatabaseSummary = {
  id: string;
  title: string;
  properties: Record<string, { type: string }>;
};

type RowSummary = {
  id: string;
  properties: Record<string, unknown>;
};

type CommentSummary = {
  id: string;
  authorType: string;
  body: string;
};

const SDK_RETRY_ATTEMPTS = 3;
const SDK_RETRY_BACKOFF_MS = 2_000;

export interface SdkContext {
  listUsers: () => Promise<Array<{ id: string; type: string; name?: string }>>;
  findChildPages: (parentId: string) => Promise<PageSummary[]>;
  findChildDatabases: (parentId: string) => Promise<DatabaseSummary[]>;
  getPageContent: (pageId: string) => Promise<string>;
  queryDatabase: (databaseId: string, filter?: Record<string, unknown>) => Promise<RowSummary[]>;
  listComments: (pageId: string) => Promise<CommentSummary[]>;
  getDatabase: (databaseId: string) => Promise<DatabaseSummary>;
}

function claimResult(
  claim: string,
  passed: boolean,
  message?: string,
  warnings?: string[],
): ClaimResult {
  return {
    passed,
    claim,
    ...(message ? { message } : {}),
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSdkRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SDK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < SDK_RETRY_ATTEMPTS) {
        await delay(SDK_RETRY_BACKOFF_MS);
      }
    }
  }

  throw new Error(
    `${label} failed after ${SDK_RETRY_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function findToolUsesBySuffix(transcript: TranscriptData, suffix: string) {
  return transcript.toolUses.filter((toolUse) => toolUse.name.endsWith(suffix));
}

function extractPlainText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      if (typeof item.plain_text === "string") {
        return item.plain_text;
      }

      if (isRecord(item.text) && typeof item.text.content === "string") {
        return item.text.content;
      }

      return "";
    })
    .join("");
}

function propertyValueToComparable(property: unknown): string {
  if (!isRecord(property) || typeof property.type !== "string") {
    if (property === null || property === undefined) {
      return "";
    }
    return String(property);
  }

  switch (property.type) {
    case "title":
      return extractPlainText(property.title);
    case "rich_text":
      return extractPlainText(property.rich_text);
    case "select":
      return isRecord(property.select) && typeof property.select.name === "string"
        ? property.select.name
        : "";
    case "status":
      return isRecord(property.status) && typeof property.status.name === "string"
        ? property.status.name
        : "";
    case "multi_select":
      return Array.isArray(property.multi_select)
        ? property.multi_select
          .filter(isRecord)
          .map((item) => (typeof item.name === "string" ? item.name : ""))
          .filter((value) => value !== "")
          .join(", ")
        : "";
    case "number":
      return typeof property.number === "number" ? String(property.number) : "";
    case "checkbox":
      return typeof property.checkbox === "boolean" ? String(property.checkbox) : "";
    case "url":
      return typeof property.url === "string" ? property.url : "";
    case "email":
      return typeof property.email === "string" ? property.email : "";
    case "phone_number":
      return typeof property.phone_number === "string" ? property.phone_number : "";
    case "date":
      return isRecord(property.date) && typeof property.date.start === "string"
        ? property.date.start
        : "";
    case "relation":
      return Array.isArray(property.relation)
        ? property.relation
          .filter(isRecord)
          .map((item) => (typeof item.id === "string" ? item.id : ""))
          .filter((value) => value !== "")
          .join(", ")
        : "";
    case "people":
      return Array.isArray(property.people)
        ? property.people
          .filter(isRecord)
          .map((item) => {
            if (typeof item.name === "string") {
              return item.name;
            }
            return typeof item.id === "string" ? item.id : "";
          })
          .filter((value) => value !== "")
          .join(", ")
        : "";
    case "formula":
      return isRecord(property.formula) ? propertyValueToComparable(property.formula) : "";
    default:
      return "";
  }
}

function rowMatches(row: RowSummary, matcher: Record<string, string>): boolean {
  return Object.entries(matcher).every(([key, expectedValue]) => {
    const actualValue = propertyValueToComparable(row.properties[key]);
    return actualValue === expectedValue;
  });
}

function findRowTitle(row: RowSummary): string {
  for (const property of Object.values(row.properties)) {
    if (isRecord(property) && property.type === "title") {
      return propertyValueToComparable(property);
    }
  }

  return "";
}

function markdownLines(markdown: string): string[] {
  return stripContentNotice(markdown).split(/\r?\n/);
}

function countParagraphs(markdown: string): string[] {
  const lines = markdownLines(markdown);
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const text = current.join(" ").trim();
    if (text !== "") {
      paragraphs.push(text);
    }
    current = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      flush();
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const isBlockLine =
      line === "" ||
      /^#{1,6}\s/.test(line) ||
      /^- \[[ xX]\]\s/.test(line) ||
      /^- /.test(line) ||
      /^\d+\.\s/.test(line) ||
      /^> /.test(line) ||
      /^\|/.test(line) ||
      /^:::$/.test(line) ||
      /^::: /.test(line) ||
      /^\+\+\+/.test(line) ||
      /^---$/.test(line) ||
      /^\[toc\]$/.test(line);

    if (isBlockLine) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return paragraphs;
}

function countBlockMatches(markdown: string, type: string): string[] {
  const lines = markdownLines(markdown);

  switch (type) {
    case "heading_1":
      return lines.filter((line) => /^#\s+/.test(line));
    case "heading_2":
      return lines.filter((line) => /^##\s+/.test(line));
    case "heading_3":
      return lines.filter((line) => /^###\s+/.test(line));
    case "to_do":
      return lines.filter((line) => /^- \[[ xX]\]\s+/.test(line));
    case "bulleted_list_item":
      return lines.filter((line) => /^- (?!\[[ xX]\])/.test(line));
    case "numbered_list_item":
      return lines.filter((line) => /^\d+\.\s+/.test(line));
    case "paragraph":
      return countParagraphs(markdown);
    case "code":
      return lines.filter((line) => /^```/.test(line));
    default:
      return [];
  }
}

function compareIconOrCover(
  actual: unknown,
  expected: { type: string; emoji?: string; external?: string },
  label: "icon" | "cover",
): string | null {
  if (!isRecord(actual) || actual.type !== expected.type) {
    return `Expected ${label} type ${expected.type}`;
  }

  if (expected.emoji && actual.type === "emoji" && actual.emoji !== expected.emoji) {
    return `Expected ${label} emoji ${expected.emoji}, got ${String(actual.emoji ?? "")}`;
  }

  if (expected.external && actual.type === "external") {
    const url = isRecord(actual.external) && typeof actual.external.url === "string"
      ? actual.external.url
      : "";
    if (url !== expected.external) {
      return `Expected ${label} external URL ${expected.external}, got ${url}`;
    }
  }

  return null;
}

async function findPageByTitle(
  sdkContext: SdkContext,
  parentId: string,
  titleMatch: string,
): Promise<PageSummary | null> {
  const pages = await withSdkRetry(
    `findChildPages(${parentId})`,
    () => sdkContext.findChildPages(parentId),
  );
  return pages.find((page) => page.title.includes(titleMatch)) ?? null;
}

async function findDatabaseByTitle(
  sdkContext: SdkContext,
  parentId: string,
  titleMatch: string,
): Promise<DatabaseSummary | null> {
  const databases = await withSdkRetry(
    `findChildDatabases(${parentId})`,
    () => sdkContext.findChildDatabases(parentId),
  );
  return databases.find((database) => database.title.includes(titleMatch)) ?? null;
}

async function verifyUsersClaims(
  groundTruth: GroundTruth,
  sdkContext: SdkContext,
): Promise<ClaimResult[]> {
  if (!groundTruth.users || groundTruth.users.length === 0) {
    return [];
  }

  const users = await withSdkRetry("listUsers", () => sdkContext.listUsers());

  return groundTruth.users.map((claim, index) => {
    const failures: string[] = [];

    if (claim.must_include_bot && !users.some((user) => user.type === "bot")) {
      failures.push("Expected user list to include a bot user");
    }

    if (typeof claim.size_min === "number" && users.length < claim.size_min) {
      failures.push(
        `Expected user list size to be at least ${claim.size_min}, got ${users.length}`,
      );
    }

    return claimResult(
      `users[${index}]`,
      failures.length === 0,
      failures.length > 0 ? failures.join("; ") : undefined,
    );
  });
}

async function verifyPageClaim(
  claim: PageClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const parentId = claim.parent ?? scenarioParentId;
  const page = await findPageByTitle(sdkContext, parentId, claim.title_matches);

  if (!page) {
    return claimResult(
      `pages[${index}]`,
      false,
      `Expected a page containing "${claim.title_matches}" under ${parentId}`,
    );
  }

  let markdown = "";
  const failures: string[] = [];
  const warnings: string[] = [];
  const needsContent =
    Boolean(claim.must_round_trip_clean) ||
    Boolean(claim.only_section_changed) ||
    Boolean(claim.must_contain_blocks && claim.must_contain_blocks.length > 0);

  if (needsContent) {
    markdown = stripContentNotice(
      await withSdkRetry(`getPageContent(${page.id})`, () => sdkContext.getPageContent(page.id)),
    );
  }

  if (claim.must_contain_blocks) {
    for (const blockClaim of claim.must_contain_blocks) {
      const matches = countBlockMatches(markdown, blockClaim.type).filter((match) =>
        blockClaim.text ? match.includes(blockClaim.text) : true
      );

      if (typeof blockClaim.count_min === "number" && matches.length < blockClaim.count_min) {
        failures.push(
          `Expected at least ${blockClaim.count_min} ${blockClaim.type} block(s)` +
            (blockClaim.text ? ` containing "${blockClaim.text}"` : "") +
            `, got ${matches.length}`,
        );
      }

      if (typeof blockClaim.count_max === "number" && matches.length > blockClaim.count_max) {
        failures.push(
          `Expected at most ${blockClaim.count_max} ${blockClaim.type} block(s)` +
            (blockClaim.text ? ` containing "${blockClaim.text}"` : "") +
            `, got ${matches.length}`,
        );
      }

      if (
        blockClaim.count_min === undefined &&
        blockClaim.count_max === undefined &&
        matches.length === 0
      ) {
        failures.push(
          `Expected a ${blockClaim.type} block` +
            (blockClaim.text ? ` containing "${blockClaim.text}"` : ""),
        );
      }
    }
  }

  if (claim.only_section_changed) {
    const sectionMarker = `## ${claim.only_section_changed}`;
    if (!markdown.includes(sectionMarker)) {
      failures.push(`Expected page to include section "${claim.only_section_changed}"`);
    } else {
      warnings.push(
        "only_section_changed verified section presence only; fixture diff is not implemented in PR-A1",
      );
    }
  }

  if (claim.icon) {
    const iconError = compareIconOrCover(page.icon, claim.icon, "icon");
    if (iconError) {
      failures.push(iconError);
    }
  }

  if (claim.cover) {
    const coverError = compareIconOrCover(page.cover, claim.cover, "cover");
    if (coverError) {
      failures.push(coverError);
    }
  }

  return claimResult(
    `pages[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
    warnings,
  );
}

async function verifyDatabaseClaim(
  claim: DatabaseClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const parentId = claim.parent ?? scenarioParentId;
  const database = await findDatabaseByTitle(sdkContext, parentId, claim.title_matches);

  if (!database) {
    return claimResult(
      `databases[${index}]`,
      false,
      `Expected a database containing "${claim.title_matches}" under ${parentId}`,
    );
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  for (const propertyClaim of claim.must_have_properties ?? []) {
    const actual = database.properties[propertyClaim.name];
    if (!actual) {
      failures.push(`Missing property "${propertyClaim.name}"`);
      continue;
    }

    if (actual.type !== propertyClaim.type) {
      failures.push(
        `Property "${propertyClaim.name}" expected type ${propertyClaim.type}, got ${actual.type}`,
      );
    }
  }

  if ((claim.requested_schema?.length ?? 0) > 0) {
    const missing = claim.requested_schema
      ?.filter((requested) => database.properties[requested.name]?.type !== requested.type)
      .map((requested) => `${requested.name}:${requested.type}`) ?? [];

    if (missing.length > 0) {
      const message = `Requested schema entries missing from persisted schema: ${missing.join(", ")}`;
      if (claim.schema_drop_policy === "fail") {
        failures.push(message);
      } else if (claim.schema_drop_policy === "warn") {
        warnings.push(message);
      }
    }
  }

  return claimResult(
    `databases[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
    warnings,
  );
}

async function verifyRowsClaim(
  claim: RowsClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const database = await findDatabaseByTitle(
    sdkContext,
    scenarioParentId,
    claim.database_title_matches,
  );

  if (!database) {
    return claimResult(
      `rows[${index}]`,
      false,
      `Expected a database containing "${claim.database_title_matches}" under ${scenarioParentId}`,
    );
  }

  const rows = await withSdkRetry(
    `queryDatabase(${database.id})`,
    () => sdkContext.queryDatabase(database.id),
  );
  const failures: string[] = [];

  if (typeof claim.size_min === "number" && rows.length < claim.size_min) {
    failures.push(`Expected at least ${claim.size_min} row(s), got ${rows.length}`);
  }

  if (typeof claim.size_max === "number" && rows.length > claim.size_max) {
    failures.push(`Expected at most ${claim.size_max} row(s), got ${rows.length}`);
  }

  for (const mustExist of claim.must_exist ?? []) {
    const row = rows.find((candidate) => rowMatches(candidate, mustExist.match));
    if (!row) {
      failures.push(`Missing row matching ${JSON.stringify(mustExist.match)}`);
      continue;
    }

    if (mustExist.expect && !rowMatches(row, mustExist.expect)) {
      failures.push(
        `Row matching ${JSON.stringify(mustExist.match)} did not satisfy ${JSON.stringify(mustExist.expect)}`,
      );
    }
  }

  for (const mustNotExist of claim.must_not_exist ?? []) {
    if (rows.some((row) => rowMatches(row, mustNotExist.match))) {
      failures.push(`Unexpected row matching ${JSON.stringify(mustNotExist.match)}`);
    }
  }

  return claimResult(
    `rows[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
  );
}

async function verifyQueryClaim(
  claim: QueryClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const database = await findDatabaseByTitle(
    sdkContext,
    scenarioParentId,
    claim.database_title_matches,
  );

  if (!database) {
    return claimResult(
      `query[${index}]`,
      false,
      `Expected a database containing "${claim.database_title_matches}" under ${scenarioParentId}`,
    );
  }

  const rows = await withSdkRetry(
    `queryDatabase(${database.id})`,
    () => sdkContext.queryDatabase(database.id, claim.filter),
  );
  const titles = rows.map(findRowTitle);
  const failures: string[] = [];

  if (typeof claim.result_size_min === "number" && rows.length < claim.result_size_min) {
    failures.push(`Expected at least ${claim.result_size_min} query result(s), got ${rows.length}`);
  }

  if (typeof claim.result_size_max === "number" && rows.length > claim.result_size_max) {
    failures.push(`Expected at most ${claim.result_size_max} query result(s), got ${rows.length}`);
  }

  for (const expectedTitle of claim.result_must_include_titles ?? []) {
    if (!titles.some((title) => title === expectedTitle)) {
      failures.push(`Expected query results to include title "${expectedTitle}"`);
    }
  }

  for (const forbiddenTitle of claim.result_must_not_include_titles ?? []) {
    if (titles.some((title) => title === forbiddenTitle)) {
      failures.push(`Expected query results not to include title "${forbiddenTitle}"`);
    }
  }

  return claimResult(
    `query[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
  );
}

async function verifyPagesUnderParentClaim(
  claim: PagesUnderParentClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const parentId = claim.parent ?? scenarioParentId;
  const pages = await withSdkRetry(
    `findChildPages(${parentId})`,
    () => sdkContext.findChildPages(parentId),
  );
  const titles = pages.map((page) => page.title);
  const failures: string[] = [];

  for (const expectedTitle of claim.must_include_titles ?? []) {
    if (!titles.includes(expectedTitle)) {
      failures.push(`Expected child page title "${expectedTitle}" under ${parentId}`);
    }
  }

  for (const forbiddenTitle of claim.must_not_include_titles ?? []) {
    if (titles.includes(forbiddenTitle)) {
      failures.push(`Unexpected child page title "${forbiddenTitle}" under ${parentId}`);
    }
  }

  return claimResult(
    `pages_under_parent[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
  );
}

async function verifyCommentsClaim(
  claim: CommentsClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<ClaimResult> {
  const page = await findPageByTitle(sdkContext, scenarioParentId, claim.page_title_matches);

  if (!page) {
    return claimResult(
      `comments[${index}]`,
      false,
      `Expected a page containing "${claim.page_title_matches}" under ${scenarioParentId}`,
    );
  }

  const comments = await withSdkRetry(
    `listComments(${page.id})`,
    () => sdkContext.listComments(page.id),
  );
  const failures: string[] = [];

  if (typeof claim.size_min === "number" && comments.length < claim.size_min) {
    failures.push(`Expected at least ${claim.size_min} comment(s), got ${comments.length}`);
  }

  let cursor = 0;
  for (const expected of claim.must_include_ordered ?? []) {
    let matched = false;
    while (cursor < comments.length) {
      const comment = comments[cursor];
      cursor += 1;

      if (!comment.body.includes(expected.body_contains)) {
        continue;
      }

      if (
        typeof expected.author_is_bot === "boolean" &&
        (comment.authorType === "bot") !== expected.author_is_bot
      ) {
        continue;
      }

      matched = true;
      break;
    }

    if (!matched) {
      failures.push(`Expected ordered comment containing "${expected.body_contains}"`);
    }
  }

  return claimResult(
    `comments[${index}]`,
    failures.length === 0,
    failures.length > 0 ? failures.join("; ") : undefined,
  );
}

async function verifySchemaDropDetectionClaim(
  claim: SchemaDropDetectionClaim,
  index: number,
  sdkContext: SdkContext,
  scenarioParentId: string,
  groundTruth: GroundTruth,
): Promise<ClaimResult> {
  const database = await findDatabaseByTitle(
    sdkContext,
    scenarioParentId,
    claim.database_title_matches,
  );

  if (!database) {
    return claimResult(
      `schema_drop_detection[${index}]`,
      false,
      `Expected a database containing "${claim.database_title_matches}" under ${scenarioParentId}`,
    );
  }

  const fullDatabase = await withSdkRetry(
    `getDatabase(${database.id})`,
    () => sdkContext.getDatabase(database.id),
  );
  const matchingDatabaseClaim = groundTruth.databases?.find(
    (databaseClaim) => databaseClaim.title_matches === claim.database_title_matches,
  );

  if (!matchingDatabaseClaim?.requested_schema || matchingDatabaseClaim.requested_schema.length === 0) {
    return claimResult(
      `schema_drop_detection[${index}]`,
      false,
      `schema_drop_detection for "${claim.database_title_matches}" requires a matching databases claim with requested_schema`,
    );
  }

  const missing = matchingDatabaseClaim.requested_schema.filter(
    (requested) => fullDatabase.properties[requested.name]?.type !== requested.type,
  );

  if (claim.must_not_have_missing_properties && missing.length > 0) {
    return claimResult(
      `schema_drop_detection[${index}]`,
      false,
      `Persisted schema is missing requested properties: ${missing.map((entry) => `${entry.name}:${entry.type}`).join(", ")}`,
    );
  }

  return claimResult(`schema_drop_detection[${index}]`, true);
}

export async function verifyGroundTruth(
  groundTruth: GroundTruth,
  transcript: TranscriptData,
  sdkContext: SdkContext,
  scenarioParentId: string,
): Promise<VerifyResult> {
  const claims: ClaimResult[] = [];
  const warnings: string[] = [];

  claims.push(...await verifyUsersClaims(groundTruth, sdkContext));

  if (groundTruth.pages) {
    for (const [index, claim] of groundTruth.pages.entries()) {
      claims.push(await verifyPageClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.databases) {
    for (const [index, claim] of groundTruth.databases.entries()) {
      claims.push(await verifyDatabaseClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.rows) {
    for (const [index, claim] of groundTruth.rows.entries()) {
      claims.push(await verifyRowsClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.query) {
    for (const [index, claim] of groundTruth.query.entries()) {
      claims.push(await verifyQueryClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.pages_under_parent) {
    for (const [index, claim] of groundTruth.pages_under_parent.entries()) {
      claims.push(await verifyPagesUnderParentClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.comments) {
    for (const [index, claim] of groundTruth.comments.entries()) {
      claims.push(await verifyCommentsClaim(claim, index, sdkContext, scenarioParentId));
    }
  }

  if (groundTruth.schema_drop_detection) {
    for (const [index, claim] of groundTruth.schema_drop_detection.entries()) {
      claims.push(
        await verifySchemaDropDetectionClaim(
          claim,
          index,
          sdkContext,
          scenarioParentId,
          groundTruth,
        ),
      );
    }
  }

  if (groundTruth.tools_must_be_called && groundTruth.tools_must_be_called.length > 0) {
    const claimWarnings = groundTruth.tools_must_be_called
      .filter((requiredTool) => findToolUsesBySuffix(transcript, requiredTool).length === 0)
      .map((requiredTool) => `Expected tool to be called: ${requiredTool}`);

    warnings.push(...claimWarnings);
    claims.push(claimResult("tools_must_be_called", true, undefined, claimWarnings));
  }

  if (groundTruth.tools_must_not_be_called && groundTruth.tools_must_not_be_called.length > 0) {
    const forbiddenCalls = groundTruth.tools_must_not_be_called.flatMap((forbiddenTool) =>
      findToolUsesBySuffix(transcript, forbiddenTool).map((toolUse) => ({
        forbiddenTool,
        toolName: toolUse.name,
      }))
    );

    claims.push(
      claimResult(
        "tools_must_not_be_called",
        forbiddenCalls.length === 0,
        forbiddenCalls.length > 0
          ? forbiddenCalls
            .map(({ forbiddenTool, toolName }) => `Forbidden tool called: ${forbiddenTool} (${toolName})`)
            .join("; ")
          : undefined,
      ),
    );
  }

  for (const claim of claims) {
    if (claim.warnings) {
      warnings.push(...claim.warnings);
    }
  }

  return {
    passed: claims.every((claim) => claim.passed),
    claims,
    warnings,
  };
}

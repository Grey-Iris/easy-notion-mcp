# PR 2 — G-3 destructive-edit warnings + G-4 DB write strictness

**Date:** 2026-04-18
**Author:** planner (PM session, Claude Opus 4.7 1M)
**Branch:** `dev` (currently at `8bc209b`; PR 1 merged)
**Inputs:** synthesis `.meta/audits/synthesis-pre-v030-2026-04-17.md` §1 C-1/C-2/C-3/C-4 + §6 G-3/G-4; audit A `.meta/audits/pre-v030-2026-04-17.md` C1/H1/H2/H3/H7; audit B `.meta/audits/pre-v030-audit-b-2026-04-17.md` F-3/F-5/F-6/F-8/F-9; frame 1 `.meta/research/frame-1-archeologist-2026-04-17.md` Probe 4; frame 5 `.meta/research/frame-5-agent-2026-04-17.md` T2 + T7.
**Approach doc:** `.meta/plans/pr2-approach-2026-04-18.md` (approved by orchestrator; all 5 open questions resolved, 3 additional directives folded in).
**Status after Codex review:** see appendix § 9 — both passes ran, all blockers dispositioned, plan revised inline.

This plan covers PR 2 of the v0.3.0 gate work. Scope: **G-3 (destructive-edit warnings + omitted-block warnings) + G-4 (DB row-write value strictness + `create_database` response truthfulness)**. Narrow framing per Codex Pass A #1: "DB write strictness" as a broader claim would include `schemaToProperties`'s `default: break` on database *schema creation* (not row writes). G-4c makes that drop visible in the `create_database` response, but G-4 does not close the `schemaToProperties` throw path itself — that's in v0.3.1 per § 10. G-5 relation support, AT-2 heading-preserving `update_section` fix, C-18 misleading-hint, and read-side `simplifyProperty` drops are also deferred.

---

## 1. Problem statement

Five silent-success patterns in today's tool surface. Common shape: success response returned while data is lost, dropped, or misrepresented. Citations below.

- **G-3a destructive edits non-atomic with no user-visible warning.** `replace_content` (`src/server.ts:1016-1028`) and `update_section` (`:1029-1081`) delete-then-append; if the append fails (parse error, >100 children, rich-text 2000-char overflow, rate-limit, network), the page is left emptier. Notion has no transactional primitive; rollback is not implementable (audit B F-3 debate → "design limitation requiring prominent warnings"). Current descriptions at `:507` + `:519` don't flag this.
- **G-3b omitted-block silent drop on read.** `normalizeBlock` (`:122-279`) returns `null` for any block type outside its enumeration; `fetchBlocksRecursive` (`:322-326`) and `fetchBlocksWithLimit` (`:364-367`) filter and continue. Types dropped: `synced_block`, `child_page`, `child_database`, `link_to_page`, `pdf`, `breadcrumb`, `template`, `unsupported`, plus future Notion types. Consumers: `read_page` (`:1106-1144`), `duplicate_page` (`:1146-1174`). Compound with G-3a: read lossy → edit → `replace_content` destroys omitted blocks. Frame 1 Probe 4 ranks HIGHEST-CONSEQUENCE; frame 5 T7 runtime-reproduced `duplicate_page` silently dropping nested `child_page`.
- **G-4a unknown property names silently dropped on DB writes.** `convertPropertyValues` (`src/notion-client.ts:200-203`) does `if (!propConfig) continue;` when a key isn't in the cached schema. Write proceeds with what survived. Runtime-confirmed in frame 5 T2 + frame 6 §3 case 10. Shared by `createDatabaseEntry` (`:554`), `updateDatabaseEntry` (`:568`), `add_database_entries` (`src/server.ts:1344`). Audit B F-9 compounds with 5-min schema cache.
- **G-4b unsupported property types silently dropped.** Same function `:205-245`: 11 types handled; `relation`, `people`, `files`, `formula`, `rollup`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `unique_id`, `verification` fall through `default: break` at `:243-244`. `tests/relation-property.test.ts` tests a copied lambda (audit B F-2 / synthesis C-7) so production has no relation branch but suite is green. PR 2 throws; PR 3 (G-5) replaces relation error with support.
- **G-4c `create_database` response lies.** `schemaToProperties` (`src/notion-client.ts:183-184`) has its own `default: break` dropping unsupported types; handler at `src/server.ts:1263` then does `properties: schema.map(s => s.name)` — response reports the requested schema, not what Notion actually created. `create_database({schema: [title, people]})` → response shows `["Title", "Owner"]` even though `Owner` was never created.

**What makes these a shared PR:** same anti-pattern (silent success). PR 2 defines the `warnings` field once (§ 2), applies it consistently, and converts silent-success to loud-error where writes are at risk.

---

## 2. Warnings-field schema

### 2.1 Shape

```jsonc
{
  "id": "...",
  "title": "...",
  "url": "...",
  "markdown": "...",
  "warnings": [
    {
      "code": "omitted_block_types",
      "blocks": [
        { "id": "block-id-1", "type": "synced_block" },
        { "id": "block-id-2", "type": "link_to_page" }
      ]
    }
  ]
}
```

### 2.2 Rules

- `warnings` is an array of warning objects on the top-level tool response.
- **Conditional inclusion:** the field is omitted when empty. Matches the existing project convention for optional response fields: `truncated` on `find_replace` (`src/server.ts:1103`), `has_more` on `read_page` (`:1133-1135`), `note` on `create_page`/`duplicate_page` (`:1005-1007`, `:1171-1173`).
- **Code discriminator:** every warning object has a mandatory `code: string` snake_case identifier plus warning-specific detail fields.
- **Codes are part of the contract once shipped.** Renaming or repurposing a code is a breaking change.
- A single code may appear multiple times in the array if a future surface splits sub-categories; for PR 2 each code appears at most once per response.

### 2.3 Codes defined in PR 2

- `omitted_block_types` — used by `read_page` and `duplicate_page` (§ 3.2). Detail: `blocks: Array<{id: string, type: string}>`. Each entry is one raw Notion block whose `type` is not in `normalizeBlock`'s supported set. **Narrowed per Codex Pass A #2:** the warning fires ONLY for unsupported block types, not for malformed supported types (e.g., an `image` block missing its URL at `src/server.ts:244-251` returns `null` from `normalizeBlock` but is NOT an omitted-type case — it's a malformed instance of a supported type). The collector in § 3.2 uses a `SUPPORTED_BLOCK_TYPES` set to disambiguate so the `omitted_block_types` code name remains accurate.

### 2.4 Future reuse

Schema is named so a future lenient DB-write mode (hypothetical `strict: false`) can reuse it: `{code: "dropped_property_keys", keys, valid_keys}`. PR 2 only ships `omitted_block_types`.

### 2.5 CLAUDE.md "Key decisions" addition

Per orchestrator directive A, add one bullet to `CLAUDE.md` after line 135:

> - **Non-fatal `warnings` field on tool responses** — tools may return an optional `warnings: Array<{code: string, ...detail}>` for non-fatal data-fidelity concerns (e.g., `omitted_block_types` on `read_page`). Omitted when empty. Codes are part of the contract once shipped — new tools should reuse existing codes or add specific descriptive names.

Single bullet; does not disturb neighboring decisions.

---

## 3. Fix design

### 3.1 G-3a — destructive-edit description updates

**Approach:** rewrite `replace_content` (`src/server.ts:507`) and `update_section` (`src/server.ts:519`) descriptions to open with a prominent "destructive; no rollback" callout, matching the **CRITICAL**-opener tone of `update_data_source` (`src/server.ts:669`, the in-repo reference per audit B positive-patterns).

**Replacement for `replace_content`:**

```
DESTRUCTIVE — no rollback: this tool deletes every block on the page, then writes new blocks. If the write fails mid-call (invalid markdown, rate limit, network error, Notion rejection of any single block), the page is left partially or fully emptied and there is no automatic recovery. For irreplaceable content, duplicate_page the target first so you have a restore point, or use find_replace / append_content which are non-destructive.

Replaces all page content with the provided markdown. Supports the same markdown syntax as create_page (headings, tables, callouts, toggles, columns, bookmarks, etc.).
```

**Replacement for `update_section`:**

```
DESTRUCTIVE — no rollback: this tool deletes the heading block and every block in the section, then writes new blocks. If the write fails mid-call, the section is left partially or fully emptied AND the heading anchor is gone, so a retry will fail with "heading not found." For irreplaceable sections, duplicate_page the target first so you have a restore point.

Update a section of a page by heading name. Finds the heading, replaces everything from that heading to the next section boundary. For H1 headings, the section extends to the next heading of any level. For H2/H3 headings, it extends to the next heading of the same or higher level. Include the heading itself in the markdown. More efficient than replace_content for editing one section of a large page.
```

Opens with DESTRUCTIVE + em-dash; states the specific failure mode; names `duplicate_page` recovery. Second paragraph preserves original copy so agent routing doesn't break. No handler behavior change — descriptions only.

### 3.2 G-3b — omitted-block warnings on read

**Approach:** thread a collector through `fetchBlocksRecursive` and `fetchBlocksWithLimit`. Push `{id, type}` when a raw block's type is NOT in the supported set. Surface collected list in `read_page` and `duplicate_page` responses under `warnings` (§ 2).

**Edits in `src/server.ts`:**

1. **New types + supported-types set (Codex A #2 — avoids false-positive warnings on malformed `image` blocks):**

```ts
type OmittedBlock = { id: string; type: string };
type FetchContext = { omitted: OmittedBlock[] };

// Must stay in sync with the switch in normalizeBlock below.
const SUPPORTED_BLOCK_TYPES = new Set<string>([
  "heading_1", "heading_2", "heading_3", "paragraph", "toggle",
  "bulleted_list_item", "numbered_list_item", "quote", "callout",
  "equation", "table", "table_row", "column_list", "column", "code",
  "divider", "to_do", "table_of_contents", "bookmark", "embed",
  "image", "file", "audio", "video",
]);
```

2. **`fetchBlocksRecursive` (`:315`) + `fetchBlocksWithLimit` (`:341`)** accept optional `ctx?: FetchContext`. At the `if (!normalized) continue` site, push when `ctx && !SUPPORTED_BLOCK_TYPES.has(raw.type)`. Thread `ctx` through recursive calls.

3. **Inline `table.children` filter at `:186-189`** — leave as-is; today only `table_row` children occur under tables (Notion schema guarantee), so unsupported types don't surface there. Add one-line comment referencing the `SUPPORTED_BLOCK_TYPES` invariant. Full refactor (remove inline normalization, rely on `has_children` + recursive fetch) is scope creep — defer to v0.3.1.

4. **`read_page` handler (`:1106-1144`):** construct `const ctx: FetchContext = { omitted: [] };` before the fetch, pass to `fetchBlocksRecursive`/`fetchBlocksWithLimit`. After fetch, `if (ctx.omitted.length > 0) response.warnings = [{ code: "omitted_block_types", blocks: ctx.omitted }];` before `textResponse`.

5. **`duplicate_page` handler (`:1146-1174`):** same `ctx` pattern at `:1160`; same response-wrap at `:1165-1174`.

6. **`read_page` description rewrite at `:546`** (Codex A #10a — today's "round-trips cleanly" claim stays an overclaim after PR 2):

```
Read a page and return its metadata plus markdown content. Recursively fetches nested blocks. Output uses the same conventions as input: toggles as +++ blocks, columns as ::: blocks, callouts as > [!NOTE], tables as | pipes |. If the page contains block types this server does not yet represent in markdown (e.g. synced_block, child_database, link_to_page), those blocks are omitted from the markdown AND listed in a `warnings` field with their ids and types. Do NOT round-trip the markdown back through replace_content when warnings are present — the omitted blocks will be deleted from the page.
```

7. **`duplicate_page` description rewrite at `:565`** (Codex A #10b):

```
Duplicate a page. Reads all blocks from the source and creates a new page with the same content that this server can represent. If the source contains block types this server does not yet support (e.g. child_page subpages, synced_block, child_database, link_to_page), those are omitted from the duplicate AND listed in a `warnings` field. Deep-duplication of subpages is not yet supported.
```

**Behavior preservation:** filtering unsupported blocks from the markdown view stays correct (audit B F-5 debate). `duplicate_page` still loses the omitted blocks from the duplicate (deep-copy is v0.3.x scope). `max_blocks` only warns for blocks within the cap. Malformed supported blocks (image-no-URL) still return null from `normalizeBlock` but do NOT warn — they're rare, Notion-side corruption, not server-gap.

### 3.3 `update_section` AT-2 heading-preserving fix — DEFERRED to v0.3.1

Deferred per approach § 3 + orchestrator directive 1. **Codex Pass A #9 pushed back on the test-infra reason** (boundary test doesn't need rewriting), so the deferral stands on revised grounds:

1. **Dedup-logic behavior-contract risk.** Tool description says "Include the heading itself in the markdown." Under AT-2, callers passing `# Heading\nbody` would double-preserve the body unless new dedup logic correctly matches the leading heading (level + rich-text content). Notion's rich-text representation after parsing may not byte-match — subtle comparison bugs create new silent-drop modes.
2. **PR 2 size budget.** Codex's patch is ~15 lines but the dedup tests + description rewrite + edge-case probes are meaningfully larger. Plan already tight against cap.
3. **G-3a description warning covers the acute pain.** Agents now see DESTRUCTIVE warning and can `duplicate_page` first.

Codex's minimal patch specifics recorded in § 10 item 1.

### 3.4 G-4a — reject unknown property names on DB writes

**Approach:** collect unknown keys at loop start; if any, **bust the schema cache and refetch once** (Codex A #6), recompute, throw if still unknown. Cache-bust fixes the 5-min-TTL false-positive case where a user just added a property via Notion UI — without the bust, the error would name their new key as unknown and tell them to "Call get_database" (same stale cache; advice is wrong).

**Edit in `src/notion-client.ts:191-249`:**

```ts
async function convertPropertyValues(client: Client, dbId: string, values: Record<string, unknown>) {
  let ds = (await getCachedSchema(client, dbId)) as any;
  const quoted = (ks: string[]) => ks.map((k) => `'${k}'`).join(", ");

  let unknownKeys = Object.keys(values).filter((k) => !(k in ds.properties));
  if (unknownKeys.length > 0) {
    // Cache may be stale (5-min TTL). Bust and refetch ONCE before throwing.
    schemaCache.delete(dbId);
    ds = (await getCachedSchema(client, dbId)) as any;
    unknownKeys = Object.keys(values).filter((k) => !(k in ds.properties));
  }

  if (unknownKeys.length > 0) {
    throw new Error(
      `Unknown property name(s): ${quoted(unknownKeys)}. ` +
      `Valid property names for this database: ${quoted(Object.keys(ds.properties))}. ` +
      `Property names are case-sensitive.`
    );
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(values)) {
    const propConfig = ds.properties[key];
    switch (propConfig.type) { /* unchanged 11 cases + new throws (§ 3.5) */ }
  }
  return result;
}
```

`schemaCache` is module-scope at `src/notion-client.ts:42` — no new exports. Pattern mirrors existing `schemaCache.delete(databaseId)` on `updateDataSource` success at `:500`. Error message omits the "Call get_database" suggestion (Codex A #6 — misleading because of shared cache; the in-code bust is the real fix). Self-servable: lists rejected keys, valid keys, case-sensitivity reminder.

**Propagation:**
- `createDatabaseEntry` (`src/notion-client.ts:554-566`) calls `convertPropertyValues` — throw bubbles up through `add_database_entry` handler (`src/server.ts:1322-1330`).
- `updateDatabaseEntry` (`src/notion-client.ts:568-591`) calls `convertPropertyValues` — same.
- `add_database_entries` (`src/server.ts:1331-1355`) wraps each `createDatabaseEntry` call in try/catch — throws land in the per-entry `failed[]` array, preserving the batch contract.

**No changes needed in the `add_database_entries` handler**; the existing per-entry error shape already does the right thing with the new throw.

### 3.5 G-4b — reject unsupported property types on DB writes

**Approach:** replace the `default: break` at `src/notion-client.ts:243-244` with a thrown error naming the property, its Notion type, and why the server rejects it.

**Message design (post-Codex-Pass-A #4 revision):** three buckets:

1. **Relation** gets "future release" framing — this is the ONLY type where PR 3 (G-5) is already scoped to add support, so the roadmap signal is accurate.
2. **People, files** get "not supported by this server" framing WITHOUT any future-release promise. Per Codex Pass A #4: grouping these with relation over-promises work that's not committed. Honest framing is better.
3. **Computed/read-only types** (formula, rollup, created_time, last_edited_time, created_by, last_edited_by, unique_id, verification) get a distinct "computed by Notion, cannot be set via API" framing. This class is accurate-by-Notion-API-design, unlike #1 and #2 which are server-limitations.

**Edit in the `convertPropertyValues` switch:**

```ts
switch (propConfig.type) {
  // ... existing 11 cases unchanged ...
  case "relation":
    throw new Error(
      `Property '${key}' has type 'relation'. ` +
      `This server does not yet support writing relation properties — support is planned for a future release. ` +
      `Remove '${key}' from this payload if you want the rest of the row to succeed, then set the relation in the Notion UI.`
    );
  case "people":
  case "files":
    throw new Error(
      `Property '${key}' has type '${propConfig.type}'. ` +
      `easy-notion-mcp does not support writing '${propConfig.type}' properties. ` +
      `Remove '${key}' from the payload, or set this field in the Notion UI.`
    );
  case "formula":
  case "rollup":
  case "created_time":
  case "last_edited_time":
  case "created_by":
  case "last_edited_by":
  case "unique_id":
  case "verification":
    throw new Error(
      `Property '${key}' has type '${propConfig.type}'. ` +
      `This type is computed by Notion and cannot be set via API. ` +
      `Remove '${key}' from the payload; Notion populates the value automatically.`
    );
  default:
    // Reached only if Notion ships a brand-new property type; keep defensive.
    throw new Error(
      `Property '${key}' has type '${propConfig.type}', which this server does not recognize. ` +
      `Remove '${key}' from the payload for now, or set it in the Notion UI. ` +
      `If this is a new Notion property type, file an issue at the easy-notion-mcp repository.`
    );
}
```

**Ordering note (per brief):** PR 3 (G-5) replaces the `relation` case with actual support. Test that asserts `relation` throws in PR 2 flips to asserting `relation` succeeds in PR 3 — clean sequence. Error message wording is forward-compat; PR 3 simply lifts the relation case out of the throw group.

### 3.6 G-4c — `create_database` response fidelity

**Approach:** derive response's `properties` field from `result.properties` (actual API result), not requested schema.

**Edit at `src/server.ts:1263`:** `properties: schema.map(s => s.name)` → `properties: Object.keys(result.properties ?? {})`. Matches the pattern already at `:1286` (`update_data_source`). Defensive `?? {}` guards malformed API response.

**Consequence:** if `schemaToProperties` silently drops a property type during request-build (`src/notion-client.ts:183-184`'s `default: break` — still present; throw deferred per brief scope + § 10), response truthfully reports what Notion actually created. `properties: ["Title"]` when agent asked for `["Title", "Owner"]` → visible mismatch → agent routes to `update_data_source` to add missing property.

**Why not also fix `schemaToProperties` throw here?** (a) response-fidelity fix already converts silent-success to visible mismatch; (b) adding that throw doubles the classification work of § 3.5 (future-PR vs computed) for schema-creation context; (c) brief's § 6 G-4 lists only three items (unknown-key, unsupported-type, response fidelity) — expanding is scope creep. Tracked in § 10.

---

## 4. Test plan

TDD per learning [e9dcf6]: write failing tests, observe failure, then implement. Tests assert observable behavior (response content, thrown error messages, tool description text), not implementation shape.

### 4.1 New test file: `tests/database-write-strictness.test.ts` — G-4a + G-4b

Pattern from `tests/http-file-upload-gate.test.ts`: `InMemoryTransport.createLinkedPair()` drives the MCP server in-process; mock SDK methods on the fake Notion client; assert on the tool response's text payload.

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| G4a-1 | `add_database_entry({Name: "x", Statusx: "y"})` on schema `{Name: title, Status: select}` — single unknown key | tool response `{id, url}` (silent success); `pages.create` called | error response; text contains `'Statusx'` AND `'Name'` AND `'Status'`; `pages.create` NOT called |
| G4a-2 | Same with two unknowns `Statusx`, `Foo` | silent success | error text contains both `'Statusx'` and `'Foo'` in the rejected list |
| G4a-3 | Same with all-valid keys `{Name, Status}` | success | success (regression guard) |
| G4a-4 | `update_database_entry({page_id, properties: {BadKey: "v"}})` (shared helper) | silent success | error text contains `'BadKey'` + valid-key list; `pages.update` NOT called (Codex B #5) |
| G4a-5 | `add_database_entries({entries: [{Name: "ok"}, {Name: "ok", BadKey: "v"}, {Name: "ok2"}]})` — **`[good, bad, good]` sandwich** (Codex B #3) proves loop continues past the throw | partial mixed | `succeeded[0]` + `succeeded[1]` (the second good, proves iteration continued); `failed[0] == {index: 1, error: <'BadKey'>}` |
| G4a-6 | **Stale-cache bust (Codex B #4).** Step 1: call `add_database_entry({Name: "x"})` with mock schema `{Name}` — this primes cache with stale schema (pre-warm confirmed). Step 2: user adds `New` property in Notion UI; next `dataSources.retrieve` would return `{Name, New}`. Step 3: call `add_database_entry({Name: "y", New: "z"})`. | silent success on pre-fix (cache stale → `New` silently dropped; or first tool call already empty-dropped `Name`); agent has no recovery path within 5 min | call succeeds on post-fix: response is `{id, url}`; row has both `Name` and `New` set. The behavioral outcome (success after stale-cache bust) is the primary assertion; the internal "retrieve called twice" is dropped from the assertion per Codex B #2. |
| G4a-7 | Genuine-unknown still throws after bust: mock returns `{Name}` for both retrieves. `add_database_entry({Name, Typo: "x"})` | silent success | throws with `'Typo'`. Primary assertion is behavior (throw); internal retrieve-count is not asserted. |
| G4b-1 | `add_database_entry({Name, Ref: "x"})` where `Ref` is `relation` | silent success | error text contains `'Ref'` AND `'relation'` AND `'future release'` AND `'Remove'` (immediate-fix clause per Codex B #10) |
| G4b-2 | Same with `people`-typed property | silent success | error text contains property name AND `'people'` AND `'easy-notion-mcp does not support'` (NO 'future release' — honest framing per Codex A #4) |
| G4b-3 | Same with `files`-typed property | silent success | error text contains property name AND `'files'` AND `'easy-notion-mcp does not support'` |
| G4b-4 | `formula`-typed property | silent success | error text contains property name AND `'formula'` AND `'computed by Notion'` |
| G4b-5 | `rollup`-typed property | silent success | same pattern for `'rollup'` |
| G4b-6 | Parametrized across `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `unique_id`, `verification` | silent success | error text contains type name AND `'computed by Notion'` |
| G4b-7 | `update_database_entry` with relation property (shared helper) | silent success | error text contains `'Ref'` + `'relation'`; `pages.update` NOT called (Codex B #5 — extend pre-write guard to update path) |
| G4b-8 | `add_database_entries` with `[good, bad(relation), good]` sandwich (Codex B #3) | mixed silent | `succeeded[0]` + `succeeded[1]` (proves loop continues); `failed[0]` contains G4b-1 error text |
| G4b-9 | **Mixed payload throw-before-write (Codex B #5):** `add_database_entry({Name: "ok", Ref: "x"})` where `Name: title`, `Ref: relation`. | silent-partial: `Name` written, `Ref` dropped | throws with `'Ref'`; `pages.create` NOT called — guards against half-written state |

**Mock surface:** each test builds a fake schema via `vi.mock` of `getCachedSchema` (or its underlying `client.dataSources.retrieve`), constructs the properties record the test wants, then drives the tool through the MCP client. The `pages.create`/`pages.update` mock is a `vi.fn()` — assertions verify it was NOT called when the throw fires, and WAS called when the test expects success.

**Behavioral discipline per orchestrator directive B:** each test asserts on response text content (or thrown error message). No test asserts on internal call counts as a primary signal; "mock not called" is a supplementary side-effect guard.

### 4.2 New test file: `tests/create-database-response.test.ts` — G-4c

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| G4c-1 | `create_database({schema: [{name: "Title", type: "title"}, {name: "Owner", type: "people"}]})`; mock `databases.create` returns `{id, url, properties: {Title: {id, type, title: {}}}}` (people silently dropped by `schemaToProperties`) | response text `{properties: ["Title", "Owner"]}` — lies | response text `{properties: ["Title"]}` — truthful |
| G4c-2 | All-supported types `[title, select, status]`; mock returns full 3-key properties | response `{properties: ["Title", "Status", "State"]}` (coincidental match) | response `{properties: ["Title", "Status", "State"]}` (now derived from result — regression guard) |
| G4c-3 | Requested schema includes an unknown type not in `schemaToProperties`'s switch | response claims it was created | response reflects reality: unknown type absent |

Previous G4c-3 (malformed-API defensive case) dropped per Codex B #11 — low-yield defensive, not a core regression.

### 4.3 New test file: `tests/block-warnings.test.ts` — G-3b

Pattern: mock `client.blocks.children.list` to return synthesized raw block arrays including unsupported types; assert warnings present/absent in tool response.

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| G3b-1 | `read_page` where `blocks.children.list` returns paragraph + heading + bulleted | response has no `warnings` key | unchanged (empty warnings → field omitted) |
| G3b-2 | Same returning one `synced_block` raw block | markdown doesn't contain synced_block content; response has no warnings | markdown unchanged; response `warnings: [{code: "omitted_block_types", blocks: [{id: "<synced-id>", type: "synced_block"}]}]` |
| G3b-3 | Returns `synced_block` + `link_to_page` + `child_database` | all silently dropped | warnings array has one entry with `blocks` listing all three `{id, type}` pairs |
| G3b-4 | Returns paragraph (top-level, has_children=true) whose child fetch returns a `synced_block` | nested drop; no warning | warning captured from recursion — asserts the `ctx` flows through recursive calls |
| G3b-5 | `duplicate_page` where source page's block list contains `child_page` (runtime-confirmed in frame 5 T7) | duplicate created; no warning | duplicate still missing child_page; response `warnings: [{code: "omitted_block_types", blocks: [{id, type: "child_page"}]}]` |
| G3b-6 | `read_page` with `max_blocks: 5` on page whose first 5 blocks are supported but 6th would be `synced_block` | capped reading; synced_block not examined | no warning; `has_more: true` still set (warnings only surface for blocks that were fetched) |
| G3b-7 | `read_page` with `max_blocks: 5` on page whose 2nd block is `synced_block` (within cap) | nested drop; no warning | warning includes the 2nd block; `has_more` may or may not be set depending on total count |
| G3b-8 | **Malformed-image-no-false-warn (Codex B #7 redesign):** `read_page` where `blocks.children.list` returns one malformed `image` block `{id: "img-1", type: "image", image: {}}` AND one `synced_block` `{id: "sync-1", type: "synced_block"}`. | no warnings field pre-fix (vacuous) | response `warnings[0].blocks` contains EXACTLY `[{id: "sync-1", type: "synced_block"}]` — proves the malformed image is excluded by `SUPPORTED_BLOCK_TYPES` gate. Asserts on array contents, not just presence. |
| G3b-9 | `read_page` description (Codex B #8 tightening) | pre-fix asserts "round-trips cleanly" | description regex: `/omitted from the markdown/i` AND `/warnings/i` AND `/Do NOT round-trip/i` — pins the load-bearing clause from § 3.2 step 6 |
| G3b-10 | `duplicate_page` description (Codex B #8 tightening) | pre-fix asserts "same content" | description regex: `/warnings/i` AND `/Deep-duplication/i` AND `/not yet supported/i` — pins § 3.2 step 7's clause |
| G3b-11 | **SUPPORTED_BLOCK_TYPES invariant (Codex B #6 drift guard):** parametrized test iterates every type in `SUPPORTED_BLOCK_TYPES`; for each, builds a minimally-valid raw block (e.g. `{id, type, [type]: { rich_text: [] }}`) and calls `normalizeBlock`. | n/a (set didn't exist) | every type returns non-null. Fails loudly if a future maintainer adds a case to `SUPPORTED_BLOCK_TYPES` without implementing it in `normalizeBlock`. |

### 4.4 New test file: `tests/destructive-edit-descriptions.test.ts` — G-3a

Per Codex B #9, regex tightened to pin the mitigation clause, not a bare tool-name scan.

| # | Test | Assertion |
|---|---|---|
| G3a-1 | `tools/list` description for `replace_content` | `/DESTRUCTIVE/` AND `/no rollback/i` AND `/(duplicate_page[^.]*first\|non-destructive)/i` — pins the mitigation clause |
| G3a-2 | `tools/list` description for `update_section` | `/DESTRUCTIVE/` AND `/no rollback/i` AND `/duplicate_page[^.]*first/i` AND `/heading anchor/i` (pins the retry-impossibility detail specific to update_section) |

Previous G3a-3 (HTTP-transport duplicate) dropped per Codex B #11 — `tools/list` reads the same source across transports; PR 1 already verified.

### 4.5 Unchanged tests — regression check

All 225 pre-PR-2 tests + PR 1's `tests/http-file-upload-gate.test.ts` tests must stay green. Specifically verify:

- `tests/markdown-to-blocks.test.ts`, `tests/blocks-to-markdown.test.ts`, `tests/roundtrip.test.ts` — converter tests; untouched by PR 2 edits.
- `tests/http-transport.test.ts`, `tests/http-file-upload-gate.test.ts` — PR 1 territory; untouched.
- `tests/create-page-from-file.test.ts`, `tests/file-upload.test.ts` — file-upload territory; untouched.
- `tests/parent-resolution.test.ts` — untouched.
- `tests/update-data-source.test.ts` — writes against a known schema; won't hit G-4a throws. Confirm with a dry run.
- `tests/list-databases.test.ts` — copied-lambda test (audit B F-2); PR 2 doesn't rewire it (that's G-5 / v0.3.x territory). Still passes.
- `tests/update-section.test.ts` — copied-lambda test; PR 2 doesn't rewire (AT-2 deferred). Still passes.
- `tests/relation-property.test.ts` — copied-lambda test; PR 2 doesn't rewire (that's PR 3's G-5). The test hits copied helpers with valid inputs, so none of PR 2's new throws fire. Still passes.
- `tests/stdio-startup.test.ts`, `tests/token-store.test.ts` — untouched.

### 4.6 Test count target

New tests: ~34 (G4a: 7 incl. cache-bust; G4b: 9 incl. mixed-payload throw-before-write; G4c: 3; G3b: 11 incl. invariant test + redesigned malformed-image test; G3a: 2). Existing: ~225+ PR1-adds. Target post-PR-2 total: ~259+.

---

## 5. Runtime evidence plan

Goal per PR-1 pattern: reproduce every failure mode the synthesis flagged against live Notion on `dev` pre-fix, then prove post-fix behavior on the builder's branch.

### 5.1 Parent page

Builder creates `pr2-test-pages-2026-04-18` under `NOTION_ROOT_PAGE_ID`. All pre- and post-fix probe runs create children inside; builder archives parent at end of session (cascades). Parent URL + ID TBD — planner fills after pre-fix run.

### 5.2 Scenarios

**Tool-input shapes corrected per Codex B #1** (create_database needs `title`, `parent_page_id`, `schema: [{name, type}]`; create_page needs `parent_page_id`).

**Scenario A — G-4a unknown key.**
1. `create_database({title: "pr2-A", parent_page_id: <parent>, schema: [{name: "Name", type: "title"}, {name: "Status", type: "select"}, {name: "Priority", type: "select"}]})` → `<dbA>`.
2. `add_database_entry({database_id: <dbA>, properties: {Name: "Test A", Statusx: "Todo"}})`.
3. Pre-fix: `{id, url}` success; `query_database({database_id: <dbA>})` shows the row with empty `Status`.
4. Post-fix: error containing `'Statusx'`, `'Name'`, `'Status'`, `'Priority'`; `query_database` returns empty — no row created.

**Scenario B — G-4b relation.**
1. `create_database({title: "pr2-B", parent_page_id: <parent>, schema: [{name: "Name", type: "title"}]})` → `<dbB>`.
2. Get dbB's data_source_id via `get_database({database_id: <dbB>})`, then `update_data_source({database_id: <dbB>, properties: {Ref: {relation: {data_source_id: <dbB-dsId>, single_property: {}}}}})` — self-referential relation column.
3. `add_database_entry({database_id: <dbB>, properties: {Name: "Target"}})` → `<targetId>`.
4. `add_database_entry({database_id: <dbB>, properties: {Name: "Source", Ref: "<targetId>"}})`.
5. Pre-fix: `{id, url}` success; `query_database` shows Source with empty `Ref`.
6. Post-fix: error containing `'Ref'` + `'relation'` + `'future release'` + `'Remove'`; no Source row.

**Scenario C — G-4c response fidelity.**
1. `create_database({title: "pr2-C", parent_page_id: <parent>, schema: [{name: "Title", type: "title"}, {name: "Owner", type: "people"}]})`.
2. Pre-fix: response `properties: ["Title", "Owner"]` (lie).
3. Post-fix: response `properties: ["Title"]` (truthful).
4. Cross-check: `get_database({database_id: <dbC>})` on both runs shows only `Title`.

**Scenario D — G-3b omitted-block warnings.**
1. `create_page({parent_page_id: <parent>, title: "D-parent", markdown: "# Hello\n\nparagraph"})` → `<Dparent>`.
2. `create_page({parent_page_id: <Dparent>, title: "D-child", markdown: "child"})` — creates `child_page` block on Dparent.
3. `read_page({page_id: <Dparent>})`.
4. Pre-fix: markdown has heading + paragraph, no D-child; no `warnings` in response.
5. Post-fix: markdown unchanged; response `warnings: [{code: "omitted_block_types", blocks: [{id: <child-page-block-id>, type: "child_page"}]}]`.
6. Also: `duplicate_page({page_id: <Dparent>})` post-fix — response has the same warnings shape; duplicate page lacks D-child (deep-copy v0.3.x).

**Scenario E — G-3a description verification (Codex B #1 — missing C-1 coverage).**
1. Drive `tools/list` via stdio MCP.
2. Post-fix expected: `replace_content.description` contains `"DESTRUCTIVE"` + `"no rollback"` + `"duplicate_page"`. `update_section.description` contains same + `"heading anchor"` clause.
3. Pre-fix: neither description contains `"DESTRUCTIVE"` — confirms C-1 user-visible mitigation is absent on `dev`.

Note: E is effectively a runtime snapshot of what § 4.4 asserts in unit tests. Included because synthesis C-1 is a Tier A gate item and the probe audit trail should show a real-server confirmation, not only a mocked test.

### 5.3 Probe script

`.meta/plans/pr2-probe.sh` (bash) or `.ts` (stdio MCP client) — builder's choice. Scenarios run sequentially. Hardened per PR 1 pattern: `set -euo pipefail`, trap cleanup, env validation (`NOTION_TOKEN` + `NOTION_ROOT_PAGE_ID`), per-scenario log capture, pass/fail summary at end. Builder re-runs on builder branch post-fix; output pasted into PR description.

### 5.4 Cleanup

All probe pages live under the parent. Builder calls `archive_page` on parent at end of session — cascades to children. No state persists between runs.

### 5.5 Parent page URL + ID

**TBD — planner fills after pre-fix probe run.** Don't ship plan without this.

---

## 6. README updates

Minimal per brief. No new security posture section; accuracy fixes only in the tool reference table.

### 6.1 Tool reference table

README's `## Tools` section (approximately lines 200–270 in current `dev`) lists tool names with one-line descriptions. Update the `replace_content` and `update_section` rows to include a "(destructive; duplicate_page first for irreplaceable content)" tail:

| Tool | Description |
|---|---|
| `replace_content` | Replace all page content with new markdown (destructive; duplicate_page first for irreplaceable content). |
| `update_section` | Replace a section identified by heading (destructive; duplicate_page first for irreplaceable content). |

If the README's tool table formatting differs from the above, builder adapts the sentence structure while preserving the "destructive" + "duplicate_page first" signal.

### 6.2 Database tools — strictness note

In the README section that describes `add_database_entry` / `update_database_entry` / `create_database` (approximately lines 235–260), add one paragraph:

> As of v0.3.0, database write tools reject unknown property names and unsupported property types with a clear error instead of silently dropping them. Call `get_database` first to confirm property names and types. Supported property types for writes: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone, status. Other types (relation, people, files, formula, rollup, computed types) are rejected; support for relation/people/files is planned for future releases.

### 6.3 No new environment variables

G-3 and G-4 don't introduce any new env vars, unlike PR 1's `NOTION_MCP_BEARER` / `NOTION_MCP_BIND_HOST`. README's env-var table is untouched.

### 6.4 CLAUDE.md update

Per § 2.5: add one bullet to `CLAUDE.md` "Key decisions" after line 135. Pre-approved per CLAUDE.md's block-type checklist exception being analogous (the new bullet documents a cross-cutting project convention, not a block type, but the same spirit applies). Builder confirms with orchestrator before committing if in doubt.

---

## 7. Risk + tradeoff analysis

### 7.1 Behavior changes for current users

- `add_database_entry`/`update_database_entry` with unknown key or unsupported type: silent success → loud error (G-4a/b).
- `add_database_entries` under a bad entry: batch still partial-succeeds; bad entry lands in `failed[]` with the new error text.
- `create_database` response: `properties` now reflects actual created shape, not requested schema.
- `read_page`/`duplicate_page`: unchanged on pages with only supported blocks; adds a `warnings` field when unsupported blocks are present.
- `replace_content`/`update_section` descriptions: open with **DESTRUCTIVE — no rollback** callout.

### 7.2 Breaking changes

- G-4a/G-4b: silent-success → loud-error on unknown keys + unsupported types. Migration: `get_database` first, filter payload.
- G-4c: `create_database` response `properties` may be a subset of requested schema. Migration: subset-of check, or use only supported types.
- G-3b: optional `warnings` field added; empty-omitted per § 2.2.
- G-3a + G-3b descriptions: text-only deltas; behavior unchanged.

CHANGELOG must call out the three wire-level breaks if the project adopts one; out of scope here.

### 7.3 Write-strict / read-still-lossy asymmetry

PR 2 fixes write-side drops but leaves `simplifyProperty` read-side drops intact — `query_database` on rows with unhandled property types returns `null` without warning. Fence-out to v0.3.1 per orchestrator directive 4. Asymmetric but intentional: write-drops corrupt user data; read-drops only misrepresent existing data that an agent can re-query.

### 7.4 Deferred to v0.3.x

G-5 (PR 3), AT-2 (v0.3.1), `schemaToProperties` throws (v0.3.1), `simplifyProperty` read-drop (v0.3.1), `enhanceError` misleading hint (synthesis C-18), `Boolean("false")` coercion (F-7), `duplicate_page` deep-copy (warnings in G-3b signals the loss), `find_replace` bare success (C-18), 2000-char rich-text unguarded (C-16), `fetchBlocksRecursive` depth limit (audit A C3).

---

## 8. Builder briefing checklist

When the orchestrator dispatches the builder, the brief must include:

1. **This plan as primary input.** Reference § 3 for each fix's exact edit locations.
2. **TDD requirement per learning [e9dcf6]:** write failing tests per § 4 first, observe failure with output captured, then implement the fix, then assert green.
3. **Scope discipline:** G-3a + G-3b + G-4a + G-4b + G-4c ONLY. Do NOT bundle G-5, AT-2, `schemaToProperties` throws, `simplifyProperty` throws, or any v0.3.x item. If the builder sees an adjacent fix that looks tempting, note it in the PR description and defer.
4. **Self-servable error text principle (carried from PR 1):** every user-facing error introduced here must contain enough information for an agent to recover without reading source. Specifically:
   - G-4a: rejected key, full valid-key list, case-sensitivity reminder, `get_database` recovery hint.
   - G-4b: property name, type name, future-PR vs read-only classification, actionable next step.
   - G-3b warnings: each block entry has `id` + `type`; agent can cross-reference with Notion UI to identify the omitted structure.
5. **Warnings schema discipline:** only ship `omitted_block_types` code in PR 2. Do not add `dropped_property_keys` or any other code — G-4a/G-4b throw; they don't warn. Reserve the schema for future use.
6. **CLAUDE.md bullet** per § 2.5 — add exactly one bullet under "Key decisions"; do not touch neighboring lines.
7. **Tool description rewrites (G-3a):** use template-literal syntax (matching `update_data_source`'s description), preserve the original description as paragraph 2. Do not add marketing or filler.
8. **Runtime probe re-run:** after implementation, run `.meta/plans/pr2-probe.sh` against the builder's branch. Capture output to PR description showing post-fix behavior matches § 5.2 post-fix expectations for all 4 scenarios.
9. **Notion test cleanup:** archive the parent page at the end of the builder's session. Report parent ID in PR description.
10. **No bypass of failing tests / no `--no-verify`** per CLAUDE.md commit safety.
11. **Pre-flight verifications:**
    - Run `npm test` on `dev` pre-edit — 225+ baseline confirmed.
    - `grep` for other callers of `convertPropertyValues` beyond `createDatabaseEntry` and `updateDatabaseEntry`. If any exist, flag to orchestrator before proceeding (Codex Pass A confirmation; see § 9).
    - `grep` for other callers of `normalizeBlock` beyond `fetchBlocksRecursive` and `fetchBlocksWithLimit` (and the `table.children` recursion inside `normalizeBlock` itself). If any exist, flag.
    - `grep` for other handlers that return a `warnings` field today. If any exist, flag (the schema is meant to be new).
12. **No premature cleanup:** do not delete or modify the four existing copied-lambda tests (`tests/relation-property.test.ts`, `tests/list-databases.test.ts`, `tests/update-section.test.ts`, plus the relation portions of others). They stay green and get rewired in later PRs.

---

## 9. Codex review appendix

### 9.1 Pass A — fix design attack surface

- **Session name:** `pr2-codex-pass-a-fix-design`
- **Session ID:** `019d9ff3-47ff-7843-bedb-560abdfe0572`
- **Model:** codex-5.3, `reasoningEffort: high`
- **Prompt summary:** asked Codex to (a) verify no write-path beyond `convertPropertyValues` has the silent-drop pattern; per orchestrator directive B, specifically challenge `schemaToProperties` and any other `default: break` in the schema→API translation surface; (b) verify `normalizeBlock`'s return-null path is only consumed by `fetchBlocksRecursive` / `fetchBlocksWithLimit` and the `table.children` recursion inside `normalizeBlock` itself; (c) challenge the warnings-field schema for collisions with existing response fields; (d) challenge the split-message design for G-4b (future-PR types vs read-only computed types) — accept uniform only with specific implementation-complexity reasoning; (e) confirm `enhanceError`'s `validation_error` tail suffix doesn't compound with the new G-4a/G-4b throws in a confusing way; (f) press on whether `simplifyProperty`'s read-side drop should be in PR 2 for symmetry (expected: no, per brief fence-offs).
- **Outcome:** Codex delivered substantive pushback — NOT rubber-stamp. 10 findings; 6 accepted as revisions to the plan (4 load-bearing revisions: `schemaToProperties` framing narrowed, `SUPPORTED_BLOCK_TYPES` set introduced to avoid `image`-null false positives, cache-bust-on-miss for G-4a, revised G-4b messaging to drop "future release" overpromise on people/files); 2 accepted as additions (read_page + duplicate_page description rewrites); 2 dispositioned (`simplifyProperty` fence-out confirmed; AT-2 deferral kept but reasoning revised). Dispositions below.

### 9.2 Pass B — test plan + error-message clarity

- **Session name:** `pr2-codex-pass-b-tests-errors`
- **Session ID:** `019da001-3c8d-7b91-9be8-e8a5f52c88e3`
- **Model:** codex-5.3, `reasoningEffort: high`
- **Prompt summary:** asked Codex to (a) judge tests for behavior-assertion vs implementation-shape; (b) read each new error message cold and rate self-servability on PR-1's standard (can an agent self-correct in one turn?); (c) identify missing regression tests (e.g., `add_database_entries` batch contract under G-4 throws); (d) verify runtime probe scenarios cover every failure mode synthesis flagged for G-3/G-4 (specifically Tier A C-1 through C-4); (e) challenge whether tool description tests are brittle (keyword scan) or semantic.
- **Outcome:** Codex delivered substantive pushback across 9 findings — NOT rubber-stamp. Key load-bearing misses found: (1) missing C-1 runtime probe; (2) API-shape errors in all 4 probe scenarios (missing `parent_page_id`, wrong schema format); (3) batch tests put bad entry last, not proving loop-continues-after-throw; (4) G4a-6 cache-bust test could pass without actually busting; (5) missing `pages.update` pre-write guards in G4a-4 + G4b rows; (6) no invariant test for `SUPPORTED_BLOCK_TYPES` drift; (7) G3b-8 false-green — malformed-image-no-warn is vacuous pre-fix; (8) description tests under-specified; (9) G-4b relation + default error messages missing immediate-fix clause. All 9 accepted as revisions (see § 9.3 below).

### 9.3 Feedback disposition

Unified table across both passes. Acc = accepted (revision landed). Conf = accepted as confirmation (no change needed). Partial = partial-accept. Reas = accepted with revised reasoning.

| # | Pass | Finding (abbrev) | Disp | Landed in |
|---|---|---|---|---|
| 1 | A | `schemaToProperties` still silent-drops on schema creation; "DB write strictness" headline overclaims | Acc | § 1.5, § 7.4, § 10, intro |
| 2 | A | `normalizeBlock` image-null-URL path mislabels malformed supported block as "omitted type" | Acc | § 2.3, § 3.2 step 1–3, § 4.3 G3b-8 |
| 3 | A | `warnings` field no collision with existing response keys | Conf | § 2.2 |
| 4 | A | G-4b split-message over-promises on `people`/`files` — only `relation` has committed PR 3 | Acc | § 3.5, § 4.1 G4b-2/3 |
| 5 | A | `enhanceError` does NOT compound with new throws | Conf | § 3.4–3.5 |
| 6 | A | Cache stale: "Call `get_database`" advice is wrong (same cache); needs cache-bust-on-miss | Acc | § 3.4, § 4.1 G4a-6/7 |
| 7 | A | `simplifyProperty` read-drop fence-out correct — needs broader per-row warning contract anyway | Conf | § 7.3, § 10 |
| 8 | A | `warnings: [{code, ...detail}]` array shape is right long-term | Conf | § 2 |
| 9 | A | AT-2 deferral test-infra reason doesn't hold; dedup-logic risk + size budget do | Reas | § 3.3, § 10 item 1 |
| 10a | A | `read_page` description still claims "round-trips cleanly" post-PR-2 | Acc | § 3.2 step 6, § 4.3 G3b-9 |
| 10b | A | `duplicate_page` description still claims "same content" | Acc | § 3.2 step 7, § 4.3 G3b-10 |
| 10c | A | `omitted_block_types` code name ambiguous if it captures malformed supported blocks | Acc (via #2) | § 2.3 |
| 11 | B | Runtime scenarios lack C-1 coverage | Acc | § 5.2 Scenario E |
| 12 | B | Tool-input shapes invalid in Scenarios A-D (missing `parent_page_id`, wrong schema format) | Acc | § 5.2 |
| 13 | B | Exact-call-count assertions on G4a-6/G4a-7; "normalizeBlock returns null" on G3b-8 = impl coupling | Acc | § 4.1 G4a-6/7, § 4.3 G3b-8 |
| 14 | B | Batch tests put bad entry last → doesn't prove loop continues | Acc | § 4.1 G4a-5, G4b-8 (sandwich) |
| 15 | B | Cache-bust test could pass without actually busting; needs explicit prewarm | Acc | § 4.1 G4a-6 redesign |
| 16 | B | Missing `pages.update`/`pages.create` pre-write guards on G4a-4 + G4b rows | Acc | § 4.1 G4a-4, G4b-7, G4b-9 |
| 17 | B | No `SUPPORTED_BLOCK_TYPES` drift-invariant test | Acc | § 4.3 G3b-11 |
| 18 | B | G3b-8 false-green (no warnings pre-fix = trivial match) | Acc (via #13) | § 4.3 G3b-8 |
| 19 | B | Description tests G3b-9/10 too weak; miss load-bearing clauses | Acc | § 4.3 G3b-9, G3b-10 |
| 20 | B | G-3a recovery-path regex `/duplicate_page\|find_replace\|append_content/` too loose | Acc | § 4.4 G3a-1, G3a-2 |
| 21 | B | G-4b relation error needs immediate-fix clause ("Remove 'Ref' from payload") | Acc | § 3.5, § 4.1 G4b-1 |
| 22 | B | G-4b default error "file an issue" not immediate-fix | Acc | § 3.5 |
| 23 | B | Minor test overfit (G4c malformed-API, G3a transport-dup) | Partial | § 4.2, § 4.4 |
| 24 | B | Error messages for G-4a/people/files/computed all self-servable | Conf | § 3.4–3.5 |
| 25 | B | Existing 225 tests stay green — no collisions | Conf | § 4.5 |

**Totals:** 25 findings · 18 revisions · 6 confirmations · 1 partial · 0 outstanding blockers.

**Press-test:** neither pass rubber-stamped. Pass A unprompted pushback on `schemaToProperties`, image-null false-positives, cache-bust-on-miss, G-4b overpromise, AT-2 reasoning. Pass B unprompted pushback on 9 items (invalid API shapes, impl-coupling tests, false-green tests, weak regexes, missing pre-write guards, missing invariant, error-message recovery clauses, batch positioning). No need for re-press.

**Plan status:** both passes complete; ready for orchestrator screen + builder dispatch.

---

## 10. v0.3.1 tracklist (items surfaced by PR 2's scope decisions)

Not shipped in PR 2; each is flagged in the plan for the next release's planner:

1. **AT-2 `update_section` heading-preserving fix** (approach § 3; audit B F-3). Per Codex Pass A #9 minimal-patch proposal: change `sectionBlocks` to `allBlocks.slice(headingIndex + 1, sectionEnd)`; set `afterBlockId = headingBlock.id`; parse replacement markdown once via `markdownToBlocks`; if the first replacement block is a heading whose text + level matches the preserved heading, drop it before append; otherwise append all replacement blocks. `tests/update-section.test.ts` is a boundary test and doesn't need rewriting — handler-level test coverage for the new behavior is what the next planner must add. Deferred from PR 2 due to dedup-logic behavior-contract risk and PR 2 size budget, not test-infra cost.
2. **`schemaToProperties` throw on unsupported types** (§ 3.6). Symmetric with G-4b; would close the `create_database` silent-drop on the request side (G-4c fixes the response side only).
3. **`simplifyProperty` read-side silent drops** (§ 7.3, approach § 4). When `query_database` returns relation/people/formula/rollup values, return a structured placeholder + warning instead of `null`.
4. **G-5 (PR 3) relation write support + test rewire.** Already slated for PR 3, but noting the PR 2 throws for `relation` need to flip to success assertions.
5. **`tests/list-databases.test.ts` + `tests/update-section.test.ts` rewiring.** Copied-lambda tests (audit B F-2); PR 2 doesn't touch them. Either PR 3's G-5 bundles them or v0.3.1 does.
6. **`add_database_entries` 429 rate-limit classification** (synthesis C-6; frame 6 §2 case 1). Unchanged by PR 2.

---

## Appendix — file paths touched by PR 2

- `src/server.ts` — 4 edits (description replacements at `:507` and `:519`; `fetchBlocksRecursive` / `fetchBlocksWithLimit` signatures; `read_page` + `duplicate_page` handlers; `create_database` handler at `:1263`).
- `src/notion-client.ts` — 1 edit (`convertPropertyValues` unknown-key throw + default-branch split throws).
- `CLAUDE.md` — 1 bullet added under "Key decisions" after line 135.
- `README.md` — 2 minimal edits (tool table destructive-warning rows; DB-tools strictness paragraph).
- `tests/database-write-strictness.test.ts` — new file.
- `tests/create-database-response.test.ts` — new file.
- `tests/block-warnings.test.ts` — new file.
- `tests/destructive-edit-descriptions.test.ts` — new file.
- `.meta/plans/pr2-probe.sh` — new file (uncommitted; planner-provided).

No changes to: OAuth surface, HTTP transport, file-upload, markdown-to-blocks, blocks-to-markdown, package.json, vitest.config.ts.

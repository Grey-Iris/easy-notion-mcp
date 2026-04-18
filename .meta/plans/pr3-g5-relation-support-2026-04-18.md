# PR 3 — G-5 relation support + test rewire

**Date:** 2026-04-18
**Author:** planner (PM session, Claude Opus 4.7 1M)
**Branch:** `dev` (at or after `82f6dd4`; PR 1 `8bc209b` + PR 2 `82f6dd4` merged)
**Inputs:** synthesis `.meta/audits/synthesis-pre-v030-2026-04-17.md` §1 C-7 + §6 G-5; audit A `.meta/audits/pre-v030-2026-04-17.md` surprise #1 + H2; audit B `.meta/audits/pre-v030-audit-b-2026-04-17.md` F-2; PR 2 plan `.meta/plans/pr2-g3-g4-silent-success-2026-04-18.md` §3.5 (the throw this PR replaces).
**Approach doc:** approved by orchestrator with six directives folded into § 3 and § 9 (Option B default + Codex-attack-it; G-5e defer approved; CHANGELOG flip of PR 2's G-4b relation language; dual_property prose-only; runtime parent under `NOTION_ROOT_PAGE_ID`; Codex Pass A probe for `buildTextFilter` at `notion-client.ts:140`).
**Status after Codex review:** see appendix § 9 — both passes ran, blockers dispositioned, plan revised inline.

PR 3 closes the acute G-5 case: full relation WRITE support plus the corresponding READ branch, and rewires `tests/relation-property.test.ts` to exercise the production code instead of copied lambdas (synthesis C-7's anchor). PR 2 shipped a forward-compat throw on relation writes; PR 3 lifts that throw. `create_database` schema-side relation support (G-5e) is **deferred to v0.3.x** — see § 3.5 rationale.

---

## 1. Problem statement

Three intertwined defects around the Notion `relation` property type:

- **G-5a (write, acute).** `convertPropertyValues` (`src/notion-client.ts:191-297`) throws on relation writes (lines 261-266, the PR 2 forward-compat throw). Pre-PR-2 the branch silently dropped the key — the user got `{id, url}` success while the relation was never linked. PR 2 converted the silent drop to a loud error with forward-compat phrasing ("support is planned for a future release"). PR 3 replaces the throw with conversion. Shared by `createDatabaseEntry` (`:608`), `updateDatabaseEntry` (`:633`), and `add_database_entries` (via `createDatabaseEntry` per-entry at `src/server.ts:1395`).

- **G-5b (read, latent).** `simplifyProperty` (`src/server.ts:49-83`) has no `relation` case. Relation falls through `default: return null` (`:80-81`). Result: `query_database` on a database row with a relation column returns `null` for that column — the IDs are available in the raw Notion response but are erased by the simplifier. Per Codex Pass A §2, `simplifyProperty` feeds `simplifyEntry` (`src/server.ts:85`), which is **only** consumed by `query_database` (`src/server.ts:1355`). `read_page` (`src/server.ts:1141`) does NOT surface database properties — it returns `{id, title, url, markdown, ...}` built directly. This PR's read fix therefore affects `query_database` only; `read_page` relation disclosure is a separate future concern (tracked in § 10). Not previously flagged because test coverage used a copied lambda (see G-5c).

- **G-5c (test drift, convergence anchor).** `tests/relation-property.test.ts` lines 3-17 define `simplifyRelation` and `convertRelation` as local copies of what the test's own comments say live in production — with explicit line-number citations (`src/server.ts:77-78`, `src/notion-client.ts:240-248`) that are **already stale** post-PR-2 (convert is now at 261-266). The test asserts against the copies, not the real functions. Suite stays green while production has no relation branch at all. Synthesis §1 C-7 flagged this as the convergence anchor: one of three test files exhibiting the pattern, and the one with the most acute underlying gap.

**Why this PR.** Relation is not a niche Notion feature — it's the primitive that turns databases into a graph. An MCP surface that can read/write rows but silently fails on the column linking them to related databases is incomplete in a way users will hit within their first hour. PR 2's throw with forward-compat phrasing held the line on silent-success; PR 3 delivers the actual capability so that phrasing becomes "support added in v0.3.0" in the CHANGELOG.

**What is NOT in this PR:**
- **G-5e (create_database relation schema support)** — deferred. Requires a new schema-input shape carrying the target `data_source_id` (per Notion 2025-09-03 wire shape), a separate API contract decision; PR 2's G-4c already removes the silent-drop on the response, and `update_data_source` already provides a raw-passthrough workaround today. § 3.5 rationale, § 6.3 CHANGELOG "Known limits" update.
- **C-7 sibling rewires** (`list-databases.test.ts`, `update-section.test.ts` copied-helper patterns) — synthesis ruled deferral to v0.3.x; these do not mask a production gap the way relation-property does.
- **Read-side `simplifyProperty` default-null for other unsupported types** — PR 2 fenced this out; planned for v0.3.1 with a `warnings` schema.
- **Any G-1, G-2, G-3, G-4 work** — shipped in PR 1 and PR 2.

---

## 2. Investigation findings (code-grounded)

Evidence-based answers to the five planner questions, read against the post-PR-2 tree.

### 2.1 `simplifyProperty` location and relation support

**Location:** `src/server.ts:49-83`. Declared `function simplifyProperty(prop: any): unknown` — file-local, not exported. Consumed by `simplifyEntry` (`:85-91`), which is used **only** by `query_database` at `src/server.ts:1355` (confirmed by Codex Pass A §2). `read_page` builds its response directly from page metadata and fetched blocks at `:1141` and does not go through `simplifyProperty`. The read-side fix therefore affects `query_database` (and tools calling it) but not `read_page`.

**Relation branch:** **absent.** Handled types: `title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status, people, unique_id`. Default (`:80-81`) returns `null`. Relation hits the default. The test file's comment at line 3 ("src/server.ts:77-78") is slightly off; the copied `simplifyRelation` lambda it references would correspond to a hypothetical line 80 case that does not exist.

**Therefore G-5b is a real production fix**, not just a test-import change.

### 2.2 `convertPropertyValues` location and relation throw

**Location:** `src/notion-client.ts:191-297`. Declared `async function convertPropertyValues(client, dbId, values)` — NOT exported. Consumed by `createDatabaseEntry` (`:608`) and `updateDatabaseEntry` (`:633`); `add_database_entries` reaches it via `createDatabaseEntry` per-entry at `src/server.ts:1395`.

**Relation branch:** throw at `:261-266` (PR 2). Message: `Property '<key>' has type 'relation'. This server does not yet support writing relation properties — support is planned for a future release. Remove '<key>' from this payload if you want the rest of the row to succeed, then set the relation in the Notion UI.`

**Non-export is a testability constraint.** The test rewire (§ 3.3) must either (a) export the whole async function, which drags schema-fetch + cache-bust concerns into the unit test surface, or (b) extract a pure helper from the switch body and export it. The approach doc committed to Option B with Codex-Pass-A adversarial review; § 9.1 documents the Codex outcome.

### 2.3 `schemaToProperties` relation support

**Location:** `src/notion-client.ts:145-189`. Already exported. Consumed by `createDatabase` (`:516`, passes result as `initial_data_source.properties`) and by `server.ts:1314` (post-PR-2 G-4c, used to derive the truthful `properties` field on the `create_database` response).

**Relation branch:** **absent.** Handled types: `title, text, number, select, multi_select, date, checkbox, url, email, phone, status`. Default (`:183-184`) falls through `break` — silently drops. Post-PR-2 G-4c, the drop is no longer silent at the response layer (`create_database` response enumerates only what was actually created), but the underlying schema still cannot be created via MCP. § 3.5 scopes this out of PR 3 and into v0.3.x.

### 2.4 Test file structure

`tests/relation-property.test.ts`, 84 lines, 9 tests across two `describe` blocks:

| # | Describe | Test | Exercises |
|---|---|---|---|
| 1 | write path | converts array of IDs | `convertRelation(["id-1","id-2"])` |
| 2 | write path | wraps single ID | `convertRelation("single-id")` |
| 3 | write path | filters falsy values | `convertRelation(["id-1","",null,undefined,"id-2"])` |
| 4 | write path | empty array → empty relation | `convertRelation([])` |
| 5 | read path | multiple relation objects | `simplifyRelation({relation:[{id:"a"},{id:"b"}]})` |
| 6 | read path | single relation object | `simplifyRelation({relation:[{id:"a"}]})` |
| 7 | read path | empty array → `[]` | `simplifyRelation({relation:[]})` |
| 8 | read path | null relation → `[]` | `simplifyRelation({relation:null})` |
| 9 | read path | undefined relation → `[]` | `simplifyRelation({})` |

Lines 4-6 define `simplifyRelation` (copy of the expected prod branch). Lines 9-17 define `convertRelation`. Both have `// Copy of ... (<file>:<line>)` comments. The test file has no current import from `src/*` — it has zero coupling to production code.

### 2.5 Adjacent relation touches (Codex Pass A probe target)

The approach doc flagged `buildTextFilter` at `notion-client.ts:133-143` as a spot where relation might be assumed unsupported. Read finds: `buildTextFilter` is explicitly text-only (`textTypes = ["title", "rich_text", "url", "email", "phone_number"]`) and constructs `contains` filters. Relation is correctly excluded here — relation values are IDs, not free text, and Notion's filter grammar for relation is `{contains: "page-id"}` not `{contains: "substring"}`. **No change needed.** Plan documents the probe so a future audit sees it considered.

`getDatabase` at `:110-131` produces the `properties` listing consumed by `get_database`. For relation columns, it emits `{name, type: "relation"}` without the target `database_id` — a read-side disclosure gap (user discovers the column exists but not what it points at). Out of scope for PR 3 (CHANGELOG "Known limits" addendum in § 6).

No other relation-specific code paths. `update_database_entry` flows through `convertPropertyValues` at `:633`, so G-5a's fix covers it. `add_database_entries` via `createDatabaseEntry` at `server.ts:1395`, same.

---

## 3. Fix design

### 3.1 G-5a — relation write branch in `convertPropertyValues`

Replace the throw at `notion-client.ts:261-266` with:

```ts
case "relation":
  result[key] = convertPropertyValue("relation", key, value);
  break;
```

…where `convertPropertyValue` is the extracted pure helper from § 3.3. The relation branch inside `convertPropertyValue` returns:

```ts
{
  relation: (Array.isArray(value) ? value : [value])
    .filter((id) => id)
    .map((id) => ({ id: String(id) })),
}
```

Shape rationale:

- **Array | string input** — Notion's write API accepts `{relation: [{id: "..."}, ...]}`. Users rarely type the full `{id: "..."}` wrapper. The test file's copied lambda accepted both a string (single) and an array; PR 3 preserves that ergonomics.
- **Falsy filter** — protects against `["id-a", "", null]` (accidental empty array slot or cache-stale ID). Matches existing copied-lambda behavior.
- **Empty array** — produces `{relation: []}`. Semantically this unlinks all relations. Notion accepts it. Matches copied-lambda behavior.
- **`String(id)` coercion** — defensive against accidental number inputs; matches `multi_select`'s `String(item)` pattern at `:239`.

**Dual_property relations.** Notion distinguishes one-way (`single_property`) and two-way (`dual_property`) relations. The distinction lives in the SCHEMA (`database_id` + `type` of the relation), not in how values are written or read. Write payload is `{relation: [{id}]}` for both; read payload is `{relation: [{id}, ...]}` for both. No code branch needed. Prose-only flag per orchestrator directive 4.

### 3.2 G-5b — relation read branch in `simplifyProperty`

Add a case to the switch at `src/server.ts:49-83`:

```ts
case "relation":
  return prop.relation?.map((r: any) => r.id) ?? [];
```

Placement: after `case "people"` (`:74`), before `case "unique_id"` (`:75`). Preserves the "plural-array types grouped together" ordering evident in the current switch (people → relation fits).

**Return shape:** `string[]`. Matches the test file's copied lambda. Empty array for empty/null/undefined relation — matches how `multi_select` at `:60` and `people` at `:74` handle their plural defaults.

### 3.3 G-5c — test rewire (Option B: structural)

**Production changes to create seams:**

1. **Export `simplifyProperty`** from `src/server.ts`. Change `function simplifyProperty` at `:49` to `export function simplifyProperty`. Zero behavior change. Add a `/** @internal Exported for test seams; not part of the public API contract. */` JSDoc tag so programmatic embedders are warned off.

2. **Extract `convertPropertyValue(type, key, value)` pure helper** in `src/notion-client.ts`. Move the switch body from `convertPropertyValues` into a new exported function that takes the resolved `propConfig.type` plus `key` and `value`. `convertPropertyValues` keeps its async schema-fetch + cache-bust + unknown-key-detection wrapper and loops through values calling `convertPropertyValue(propConfig.type, key, value)`.

   Signature:
   ```ts
   /** @internal Exported for test seams; not part of the public API contract. */
   export function convertPropertyValue(
     type: string,
     key: string,
     value: unknown,
   ): Record<string, unknown>;
   ```

   Returns a single-key object like `{relation: [...]}` that the caller splices into the accumulator. Throws for unsupported/computed types (unchanged messaging — reuse PR 2's strings verbatim except the relation case becomes a return).

   **Codex Pass A §5 addressed export-surface concern** (package publishes `dist` without an `exports` map, deep-imports possible). Mitigation: `@internal` JSDoc + CHANGELOG-noted test-seam intent. Alternative considered and rejected for this PR: a dedicated `src/notion-properties.ts` module — adds file churn and a refactor scope this PR did not commit to. If the `@internal` tag proves insufficient (e.g., third-party deep-import observed in issue tracker), a v0.3.x refactor can relocate without a behavior change.

**Codex Pass A adversarial probe on Option B** (per orchestrator directive 1): confirm the extraction is cleanly contained. The switch body uses `propConfig.type` as the discriminator, plus `key` and `value`. It does not touch `client`, `dbId`, `ds`, `schemaCache`, `unknownKeys`, or `result`. The only cross-cutting reference is the error messages quoting `key` and `propConfig.type` — both already arguments. Extraction is clean. § 9.1 records Codex's disposition.

**Fallback (Option A, narrower):** if Codex surfaces a reason Option B leaks concerns, fall back to exporting just `convertRelationValue(value): {relation: Array<{id: string}>}` and `simplifyRelationProperty(prop: any): string[]`. Test imports two named helpers instead of two dispatchers. Loses the dispatcher-drift protection across other property types.

**Test file rewire (`tests/relation-property.test.ts`):**

Replace lines 1-17 (current imports + copied lambdas) with:

```ts
import { describe, expect, it } from "vitest";
import { simplifyProperty } from "../src/server.js";
import { convertPropertyValue } from "../src/notion-client.js";

function convertRelation(value: unknown): { relation: Array<{ id: string }> } {
  return convertPropertyValue("relation", "Ref", value) as {
    relation: Array<{ id: string }>;
  };
}

function simplifyRelation(prop: any): string[] {
  // The current test file passes bare `{ relation: [...] }` with no `type`
  // field. Real `simplifyProperty` dispatches on `prop?.type`, so the wrapper
  // must inject the type discriminator to keep the 5 read-path assertion
  // bodies (lines 47-82 of the current file) unchanged. Codex Pass B #1.
  return simplifyProperty({ ...prop, type: "relation" }) as string[];
}
```

**Codex Pass B #1 — thin-wrapper bug fix.** The naive wrapper `simplifyProperty(prop)` would fail all 5 read-path assertions because the real dispatcher hits `default: return null` on prop-without-type. The `{ ...prop, type: "relation" }` spread injects the discriminator while preserving whatever `relation` field (array, null, undefined, missing) the test passes. All 9 assertion bodies (lines 21-82) still need ZERO changes.

The rewire is about what the wrappers DO (production vs copy), not about shuffling assertion shapes. All 9 tests should pass post-G-5a/G-5b.

**Dispatcher-drift bonus.** Because `simplifyProperty` is now imported as the full dispatcher (not just a relation slice), a future change that accidentally removes the relation case would fail the read-path tests. Same for `convertPropertyValue`. This is the synthesis-C-7 goal.

### 3.4 G-5d — round-trip integration test

**New file:** `tests/relation-roundtrip.test.ts`. Separation rationale: the unit tests in `relation-property.test.ts` are lightweight pure-function assertions; the round-trip test requires `createServer + InMemoryTransport + vi.fn` Notion-client mock — the same harness as `tests/database-write-strictness.test.ts`. Co-locating would mix two harnesses in one file. New file is cleaner.

**Stateful mock contract (Codex Pass B #2 + #3).** The mock must BE THE SYSTEM — not two hardcoded one-way assertions stitched together. Concretely:

```ts
// Shared state: map of page-id → stored Notion-shape page
const pageStore = new Map<string, any>();

const notion = {
  databases: {
    retrieve: vi.fn(async () => ({ id: dbId, data_sources: [{ id: dsId }] })),
    create: vi.fn(),
  },
  dataSources: {
    retrieve: vi.fn(async () => ({ properties: { Name: { type: "title" }, Ref: { type: "relation" } } })),
    query: vi.fn(async () => ({ results: Array.from(pageStore.values()) })),
  },
  pages: {
    // pages.create: persist a page with the EXACT properties the handler wrote.
    // The stored page MUST have full raw property shape including `type` discriminator:
    //   properties.Ref = { type: "relation", relation: [{ id: "..." }] }
    // so that `simplifyProperty` hits its relation case when dataSources.query
    // returns this page back on the read path.
    create: vi.fn(async ({ properties }: any) => {
      const id = `page-${pageStore.size + 1}`;
      const stored = {
        id,
        url: `https://notion.so/${id}`,
        parent: { type: "data_source_id", database_id: dbId },
        properties: decorateWithTypes(properties), // adds `type` discriminator per prop
      };
      pageStore.set(id, stored);
      return stored;
    }),
    retrieve: vi.fn(async ({ page_id }: any) => pageStore.get(page_id)),
    update: vi.fn(async ({ page_id, properties }: any) => {
      const existing = pageStore.get(page_id);
      const merged = {
        ...existing,
        properties: { ...existing.properties, ...decorateWithTypes(properties) },
      };
      pageStore.set(page_id, merged);
      return merged;
    }),
  },
};
```

`decorateWithTypes()` is a helper in the test file that adds the `type` discriminator to each raw property value so the stored page matches Notion's on-the-wire shape (see Codex Pass B #3 — without this the read path never enters the relation branch). Because `query` returns `Array.from(pageStore.values())`, there is no way to false-green: if the write path produced the wrong properties, the query response shows the wrong properties too.

**Test shape** (one `describe`, four `it` — Codex Pass B #5 adds update test):

1. **`it("round-trips a single relation ID through add_database_entry + query_database")`** — `add_database_entry({Name:"row1", Ref:"target-id-a"})` → `query_database` → assert the simplified result for row1 contains `Ref: ["target-id-a"]`. Additionally assert `pages.create` mock was called with `relation: [{id: "target-id-a"}]` (spot-check on write shape).

2. **`it("round-trips an array of relation IDs")`** — `{Ref: ["id-a", "id-b"]}` → create → query → simplified `Ref: ["id-a", "id-b"]`. Same write spot-check.

3. **`it("round-trips an empty relation")`** — `{Ref: []}` → create → query → simplified `Ref: []`.

4. **`it("round-trips relation update via update_database_entry")`** — create row with `Ref: "id-a"`, then `update_database_entry(rowId, {Ref: "id-b"})`, then query. Assert simplified `Ref: ["id-b"]` (NOT `["id-a"]`). This exercises the distinct handler path through `pages.retrieve` parent resolution at `src/notion-client.ts:616-631` that Codex Pass B #5 flagged as missing.

Coverage decision (Codex Pass B #5): null/undefined inputs belong to unit tests (`relation-property.test.ts` R-8, R-9) not integration — those shapes are pure-function contracts. Falsy-filter (`["id", "", null]`) is already covered at unit level; not duplicated in integration.

**Why stateful vs. hardcoded query returns.** If `dataSources.query` returned hand-crafted results independent of what `pages.create` stored, the test would pass even if the production relation write produced a wrong shape (e.g., `{relation: "scalar"}` vs `{relation: [{id}]}`). The store-then-return pattern forces the test to exercise both directions through the SAME bytes, which is what "round-trip" means.

### 3.4a G-5f — migrate existing relation-throw tests in `database-write-strictness.test.ts`

**Codex Pass A #1 (missed by initial draft).** PR 2 shipped four relation-specific assertions in `tests/database-write-strictness.test.ts` that will break when PR 3 flips the relation-throw to relation-success. Each must be migrated:

- **G4b-1** (`:252-273`) — `add_database_entry` with relation expects error containing "'Ref'" + "relation" + "future release" + "remove", and `pages.create` NOT called. **PR 3 migration:** rename test to `G5a-1` (or similar), flip to assert `pages.create` WAS called with `relation: [{id: "abc"}]` in properties, and response text contains the page id (success). Preserve the `freshDbId("b1")` cache isolation.
- **G4b-7** (`:394-413`) — `update_database_entry` with relation expects error, `pages.update` NOT called. **PR 3 migration:** rename to `G5a-7`, flip to assert `pages.update` WAS called with `relation: [{id: "abc"}]`. The mock's `pages.retrieve` already returns a page with a valid `database_id` parent (makeNotion setup), so the handler path reaches `convertPropertyValues`.
- **G4b-8** (`:415-443`) — batch sandwich `[good, bad(relation), good]` expects 2 succeeded + 1 failed with relation error. **PR 3 migration:** the "loop-continues-after-throw" invariant must be preserved, but relation can no longer be the bad middle entry. **Replace with** `[good, bad(people), good]` — `people` still throws per PR 2's G-4b (unchanged in PR 3). Rename to `G4b-8-people-variant` to signal the invariant remains tested. Alternative: keep the test name and bad type as `files`. Either works; pick one and document. **Plan choice: `people`**, matching G4b-2's existing messaging test.
- **G4b-9** (`:445-466`) — mixed payload `{Name, Ref}` expects error + `pages.create` not called. **PR 3 migration:** rename to `G5a-9` (or inline into the new `relation-roundtrip.test.ts`); flip to assert success + `pages.create` called with both properties. Alternative: delete entirely since `relation-roundtrip.test.ts` already covers the positive case with better stateful-mock fidelity. **Plan choice: delete G4b-9** to avoid duplication with the new integration test.

Migration summary in one table:

| Test | Line | Action | Rationale |
|---|---|---|---|
| G4b-1 | 252 | Flip to success assertion; rename G5a-1 | Relation write now succeeds |
| G4b-7 | 394 | Flip to success assertion; rename G5a-7 | Relation update now succeeds |
| G4b-8 | 415 | Swap bad type `relation` → `people`; keep test | Preserve batch-continues invariant |
| G4b-9 | 445 | Delete (covered by new roundtrip test) | Avoid duplication |

**File list impact.** PR 3 now touches: `src/notion-client.ts`, `src/server.ts`, `tests/relation-property.test.ts`, `tests/relation-roundtrip.test.ts` (new), `tests/database-write-strictness.test.ts`, `CHANGELOG.md`, `README.md` (per § 6.3), plus runtime evidence file under `.meta/runtime-evidence/`. Seven code/doc files plus one evidence file. Builder checklist in § 8 updated.

### 3.5 G-5e — create_database relation schema (DEFERRED to v0.3.x)

Not in this PR. Per orchestrator directive 2:

**Reasoning.** Creating a relation column via `create_database` requires a new schema-input shape. Codex Pass A #3 corrected the original draft on two points:

- **Notion 2025-09-03 wire shape.** The relation schema config key is `relation.data_source_id`, NOT `relation.database_id` (`node_modules/@notionhq/client/build/src/api-endpoints.d.ts:2116, :3518`). A future-PR schema-input shape should expose `data_source_id` (or resolve `database_id → data_source_id` internally via the existing `getDataSourceId` at `src/notion-client.ts:50`).
- **`update_data_source` already provides an escape hatch.** Codex found that `update_data_source` forwards raw property payloads verbatim with no normalization or validation (`src/notion-client.ts:542`; explicitly tested at `tests/update-data-source.test.ts:58`). So users CAN add a relation column today by calling `update_data_source` with the raw Notion relation-config shape. The PR 3 deferral does NOT leave users stranded; it just declines to add a typed shortcut.

Distinct API contract decisions still needed for G-5e:

- What does the `create_database` schema parameter accept? Continuing the existing `{name, type}` shape with an added `data_source_id` (or friendlier alias) for relation entries vs. a raw pass-through like `update_data_source`.
- Cross-field validation: today `create_database` trusts the caller. Adding relation validation is scope creep.
- Internal resolution step: if the friendlier alias accepts a `database_id`, `schemaToProperties` would need to resolve it to `data_source_id` — but the schema helper is synchronous today.

Post-PR-2 G-4c, the `create_database` response already shows the drop (response lists only columns actually created), so the silent-drop path is de-silenced. Lifting the limitation from "visible drop + `update_data_source` workaround" to "typed shortcut in `create_database`" is a v0.3.x ticket of its own.

**What PR 3 does about it:** CHANGELOG "Known limits" addendum (§ 6) making the limitation explicit. No code change.

---

## 4. Test plan (TDD)

Per learning [e9dcf6], failing tests land FIRST. Plan is split into a red pass (tests fail against current tree) and a green pass (production changes make tests pass). Each is a separate commit on the PR branch.

### 4.1 Red pass — failing tests

Commit message shape: `test(pr3): relation round-trip + rewired unit tests (failing; green in next commit)`.

**Files touched:**

- `tests/relation-property.test.ts` — rewire imports per § 3.3. Replace copied lambdas with thin wrappers around `simplifyProperty` + `convertPropertyValue`.
  - Import source: `../src/server.js` for `simplifyProperty`; `../src/notion-client.js` for `convertPropertyValue`.
  - Assertions bodies unchanged (lines 21-82 in the current file).
  - **Expected failures before green:** all 4 write-path tests fail because `convertPropertyValue("relation", ...)` doesn't exist yet (compile error) OR throws per PR 2's branch. All 5 read-path tests fail because `simplifyProperty({type:"relation",...})` returns `null` (default case).

- `tests/relation-roundtrip.test.ts` — new file, three integration tests per § 3.4.
  - **Expected failures before green:** test 1 fails because `add_database_entry` throws with PR 2's message. Tests 2 and 3 never reach the read path for the same reason.

**Compile-level expectation.** If `simplifyProperty` isn't exported yet (green-pass change), the unit test file will fail at import resolution. This is acceptable; the red commit uses **in-line `// @ts-expect-error` where needed** OR stages the export-only production change in the red commit too (zero behavior change, makes the test compile). The latter is cleaner. Red-pass commit includes:

- Non-behavior-changing `export` keyword addition to `simplifyProperty` (`src/server.ts:49`) plus the `@internal` JSDoc per § 3.3.
- The full `convertPropertyValue` pure-refactor extraction in `src/notion-client.ts` — **strictly mechanical per Codex Pass B #6.** Requirements for "mechanical":
  - Switch body copied VERBATIM from `convertPropertyValues` into `convertPropertyValue`. Error message strings bit-for-bit identical. Branch order identical.
  - Accumulator pattern (`result[key] = { ... }`) converted to `return { ... }` per branch. That is the ONE mechanical transformation; everything else is unchanged.
  - `convertPropertyValues` becomes a loop that calls `convertPropertyValue(propConfig.type, key, value)` and assigns into `result[key]`. No other logic change.
  - NO "while we're here" improvements: don't add type unions, don't fold branches, don't change error message punctuation, don't rename variables, don't tidy up whitespace beyond what git naturally produces on block-move.
  - Rationale: a non-mechanical red-pass commit turns the PR diff into a "refactor + feature" mix that's harder to review, and risks introducing regressions the tests can't catch (since they aren't yet testing the real function).

**Required builder discipline:** the red-pass commit must have tests that fail because the BEHAVIOR hasn't shipped yet (PR 2's relation throw still fires; `simplifyProperty` still hits `default: null`), not tests that fail because the imports don't resolve. Prefer the "refactor-in-red, behavior-change-in-green" split, kept strictly mechanical.

### 4.2 Green pass — production changes

Commit message shape: `feat(pr3): relation write + read branches (G-5a + G-5b)`.

**Files touched:**

- `src/notion-client.ts` — in `convertPropertyValue` (the already-extracted helper from red pass), replace the relation-throw branch with the relation-write conversion per § 3.1.
- `src/server.ts` — add `case "relation"` to `simplifyProperty` per § 3.2.

**Post-change expectations:**

- `relation-property.test.ts` — all 9 tests pass.
- `relation-roundtrip.test.ts` — all 3 tests pass.
- No other test file changes behavior. Run full suite to confirm:
  - `database-write-strictness.test.ts` still passes (G-4a/G-4b for people/files unchanged).
  - `destructive-edit-descriptions.test.ts` still passes (G-3 unchanged).
  - `create-database-response.test.ts` still passes (G-4c unchanged; schemaToProperties still drops relation).
  - `roundtrip.test.ts`, `read-page` tests, etc. — relation-related assertions in them (if any) would have been against the null default; verify none silently flip.

### 4.3 Regression coverage

**Explicit test case catalog** (what must pass post-green):

Unit tests (from rewired `relation-property.test.ts`):
- [R-1] array of IDs → relation objects
- [R-2] single string ID → wrapped in relation array
- [R-3] falsy values filtered from array
- [R-4] empty array → empty relation
- [R-5] multi-relation read → string[]
- [R-6] single-relation read → string[] of length 1
- [R-7] empty relation array → `[]`
- [R-8] null relation → `[]`
- [R-9] undefined relation → `[]`

Integration tests (new `relation-roundtrip.test.ts`):
- [I-1] round-trip single ID through `add_database_entry` + `query_database`
- [I-2] round-trip ID array through same path
- [I-3] round-trip empty relation
- [I-4] round-trip update via `update_database_entry` (Codex Pass B #5 — distinct path through `pages.retrieve` parent resolution)

Migrated strictness tests (in `database-write-strictness.test.ts`):
- [M-1] G4b-1 → G5a-1: `add_database_entry` relation **succeeds**, `pages.create` called with correct relation body
- [M-2] G4b-7 → G5a-7: `update_database_entry` relation **succeeds**, `pages.update` called with correct relation body
- [M-3] G4b-8: batch sandwich with middle = `people` (not relation) preserves the loop-continues-after-throw invariant
- [M-4] G4b-9: DELETED (duplicated by I-1)
- Remaining G4b-2 through G4b-6 untouched (people, files, computed types — still throw per PR 2)

Intentionally NOT added as unit tests (covered at integration or runtime):
- null/undefined relation value WRITES → belong to unit coverage of the pure helper (R-8, R-9 on the read side prove the shape; write-side null pass is a null → Array.isArray(null) === false → `[null].filter(id => id)` = `[]` implicit-coverage; additional explicit unit test optional).
- `add_database_entries` (batch) with relation → batch-relation-succeeds assertion lives in M-3's positive-entries; runtime S-6 confirms.

### 4.4 Suites to run

- `npm test` — full vitest run. Must be green.
- `npm run typecheck` (if present; otherwise `tsc --noEmit`). Catches any signature mismatch from the `convertPropertyValue` extraction.
- `npm run lint` — if the repo has a lint step.

---

## 5. Runtime evidence plan

Per CLAUDE.md runtime-evidence rule: runtime probe against a real Notion workspace, not just unit/integration tests. Builder executes this after green-pass tests pass.

### 5.1 Containment

**Parent page:** `pr3-test-pages-2026-04-18` under `NOTION_ROOT_PAGE_ID` (per orchestrator directive 5). Every DB, row, and artifact created during the probe lives under this parent. Archived via `archive_page` at end of probe regardless of probe outcome.

**Plan evidence § header records:** parent page URL, parent page ID, start timestamp, end timestamp, archive confirmation.

### 5.2 Fixtures

Under the parent, create:

1. **`DB-target-<ts>`** — database with columns `Name` (title). Seed 2 rows:
   - `target-A` — note its page ID as `<target-A-id>`
   - `target-B` — note its page ID as `<target-B-id>`
2. **`DB-source-<ts>`** — database with columns `Name` (title) + `Ref` (relation → `DB-target-<ts>`).

### 5.3 Scenarios

Each scenario captured with pre-fix (dev tip at PR 2 merge, `82f6dd4`) vs post-fix (this PR's branch) output side by side. Pre-fix capture is optional if Codex/orchestrator agrees PR 2 merged recently and the throw behavior is well-documented in the plan — but fresh capture is the default.

**Row-naming convention (Codex Pass B #7).** Each row gets a **unique timestamped name** of the form `pr3-s<N>-<timestamp>` (e.g., `pr3-s1-20260418-142301`). The read-back assertion uses `query_database` with a `Name equals` filter and asserts `results.length === 1` — otherwise a stale row from an earlier probe run could false-green the scenario. Builder records the exact Name strings in the evidence artifact.

**Read-back via `query_database`, NOT `read_page` (Codex Pass A #2 + Pass B #4).** `read_page` returns `{id, title, url, markdown, ...}` built directly from the Notion page — it does NOT surface database-property values. Use `query_database` for all read-back assertions in this plan.

**S-1 Single-ID string write + readback.**
- `add_database_entry(DB-source, {Name: "pr3-s1-<ts>", Ref: "<target-A-id>"})`
- Pre-fix: throws `Property 'Ref' has type 'relation'. This server does not yet support...`.
- Post-fix: returns `{id, url}` success.
- `query_database(DB-source, filter: {property: "Name", title: {equals: "pr3-s1-<ts>"}})` → expect `results.length === 1`, `results[0].Ref === ["<target-A-id>"]`.

**S-2 ID-array write + readback.**
- `add_database_entry(DB-source, {Name: "pr3-s2-<ts>", Ref: ["<target-A-id>", "<target-B-id>"]})`
- Post-fix: success.
- `query_database(DB-source, filter by Name=pr3-s2-<ts>)` → exact-one row; `results[0].Ref === ["<target-A-id>", "<target-B-id>"]` (order matters — Notion preserves write order).

**S-3 Empty-array write + readback.**
- `add_database_entry(DB-source, {Name: "pr3-s3-<ts>", Ref: []})`
- Post-fix: success.
- `query_database` → exact-one row; `results[0].Ref === []`.

**S-4 Falsy-filter write + readback.**
- `add_database_entry(DB-source, {Name: "pr3-s4-<ts>", Ref: ["<target-A-id>", "", null]})`
- Post-fix: success; only valid ID linked.
- `query_database` → exact-one row; `results[0].Ref === ["<target-A-id>"]`.

**S-5 Update via `update_database_entry`.**
- Start from row1 (created by S-1) — initially `Ref: ["<target-A-id>"]`.
- `update_database_entry(row1-id, {Ref: ["<target-B-id>"]})`
- Post-fix: success; relation re-linked.
- `query_database(DB-source, filter by Name=pr3-s1-<ts>)` → exact-one row; `results[0].Ref === ["<target-B-id>"]` (NOT `"<target-A-id>"`).

**S-6 (optional) Batch via `add_database_entries` with relation column.**
- If time permits, confirm batch path also works. Low priority — same function path. Use `pr3-s6a-<ts>`, `pr3-s6b-<ts>`, `pr3-s6c-<ts>` names; each with a unique Ref. Read-back via `query_database` filtering on Name-starts-with `pr3-s6-` and asserting exactly 3 results.

**False-green defense.** Unique timestamps mean a re-run of the probe never collides with a prior run's rows. `results.length === 1` assertion means a silent-drop on write would surface as a zero-result query, not a fallback-to-stale-row match. S-5's post-update `results[0].Ref === ["<target-B-id>"]` specifically rejects the case where an update silently no-ops while returning success.

### 5.4 Evidence recording

For each scenario: tool call JSON, response JSON excerpt (trimmed), pass/fail verdict. Capture in a `pr3-runtime-evidence.md` artifact that ships with the PR description or lives under `.meta/runtime-evidence/pr3-g5-2026-04-18.md`.

### 5.5 Archive

At end of probe: `archive_page(parent-page-id)`. Include confirmation in evidence artifact.

---

## 6. Docs + CHANGELOG

### 6.1 README update (Codex Pass A #4 — blocker)

The current README at `README.md:291` contains this block below the DB-tools table:

> **As of v0.3.0, database write tools reject unknown property names and unsupported property types with a clear error instead of silently dropping them.** Call `get_database` first to confirm property names and types. Supported property types for writes: `title`, `rich_text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url`, `email`, `phone`, `status`. Other types (`relation`, `people`, `files`, `formula`, `rollup`, and computed types like `created_time` / `unique_id`) are rejected; support for `relation` / `people` / `files` is planned for future releases.

Post-PR-3 this becomes a lie — relation is now supported. Required edit:

- Move `relation` from the "other types" list into the "supported" list.
- Add a short follow-up sentence explaining the relation value shape (single page-ID string or array) so agents discover the ergonomic input. Example phrasing:

> **As of v0.3.0, database write tools reject unknown property names and unsupported property types with a clear error instead of silently dropping them.** Call `get_database` first to confirm property names and types. Supported property types for writes: `title`, `rich_text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url`, `email`, `phone`, `status`, `relation`. Other types (`people`, `files`, `formula`, `rollup`, and computed types like `created_time` / `unique_id`) are rejected; support for `people` / `files` is planned for future releases. For relation writes, pass either a single page-ID string (`"Projects": "page-id"`) or an array (`"Projects": ["id-a", "id-b"]`); an empty array clears the relation.

**Tool descriptions:** no change required in PR 3. `add_database_entry`'s description at `src/server.ts:784` already instructs the agent to "Pass properties as simple key-value pairs — the server converts using the database schema." Adding a relation example to the description string is nice-to-have but not required; the README change and the tool's own schema discovery via `get_database` cover the discovery path.

### 6.2 CHANGELOG [Unreleased] — `Fixed` entry (Codex Pass B #8)

**Framing change from initial draft.** First draft placed the relation entry under `Added`. Codex Pass B #8 pushed back: within `[Unreleased]` the CHANGELOG already documents relation writes as a throwing/broken path (PR 2 G-4b bullet at `CHANGELOG.md:62`) and relation reads as a known limit (`CHANGELOG.md:156` — the now-deprecated v0.3.1 deferral). PR 3 closes a defect within the same unreleased release train. It's a `Fixed` entry, not `Added`. Revised placement:

Under the existing `### Fixed` section (`CHANGELOG.md:115+`), add:

```markdown
- **Silent null on relation reads + throw on relation writes (G-5).**
  PR 2 shipped a forward-compat throw on relation writes with the
  message "support is planned for a future release." PR 3 lifts that
  throw: `add_database_entry`, `update_database_entry`, and the
  per-entry step of `add_database_entries` now accept relation values
  as either a single page-ID string or an array of page-ID strings.
  Falsy values in the array are filtered out; an empty array clears
  the relation. On the read side, `query_database` now extracts
  relation IDs into a `string[]` instead of returning `null` via
  `simplifyProperty`'s default case. Migration: callers who handled
  PR 2's throw path can now pass relation values directly; the throw
  was only on dev-tip between the PR 2 and PR 3 merges and never in
  a released version.
```

**Scoping note (Codex Pass A #2):** the entry says "query_database" specifically — NOT `read_page`. `read_page` never ran `simplifyProperty` on DB-row properties, so PR 3's read fix does not affect it. The initial draft incorrectly implied otherwise.

### 6.3 CHANGELOG "Known limits" amendment

The existing "Known limits (deferred to v0.3.1)" section at `CHANGELOG.md:156+` contains:

> - `schemaToProperties` still silently drops unsupported types during `create_database` schema-build; G-4c makes the drop visible in the response but does not yet throw on the request side. Planned for v0.3.1 alongside relation/people/files write support.

> - `simplifyProperty` read-side drops (`query_database` returning `null` for unhandled property types) are not yet signaled. Planned for v0.3.1, likely reusing the `warnings` schema with a per-row code.

Replace the first bullet with two bullets split by property type; update the second bullet to remove relation from the deferred list:

```markdown
- **`create_database` does not yet accept relation-type columns in
  the schema parameter.** Relation VALUES are writable on existing
  columns (G-5), but creating the column itself requires passing
  the target `data_source_id` — a shape the current schema-input
  parameter does not support. Workaround available today: create
  the database schema (without the relation column) via
  `create_database`, then call `update_data_source` with a raw
  Notion relation-config payload. Planned for v0.3.x as a typed
  shortcut.
- `schemaToProperties` still silently drops unsupported `people`
  and `files` types during `create_database` schema-build; G-4c
  (PR 2) makes the drop visible in the response but does not yet
  throw on the request side. Planned for v0.3.1 alongside
  people/files write support.
- `simplifyProperty` read-side drops (`query_database` returning
  `null` for unhandled property types OTHER than relation) are
  not yet signaled. Planned for v0.3.1, likely reusing the
  `warnings` schema with a per-row code.
```

Per orchestrator directive 2 + Codex Pass A #3, the G-5e deferral rationale is now technically correct (`data_source_id`, not `database_id`) and the `update_data_source` workaround is explicitly named as an available escape hatch today.

### 6.4 Other CHANGELOG hygiene

- The PR 2 `Breaking changes` G-4b bullet at `CHANGELOG.md:62+` mentions relation's "future-release roadmap" phrasing. **Leave that text as-is:** PR 2 shipped that behavior; future readers tracing v0.3.0 dev-tip history need the phrasing to match what was really in the build. PR 3's `Fixed` entry signals the defect closed. Do NOT retroactively edit the PR 2 text.

---

## 7. Risk and tradeoff analysis

### 7.1 Behavior change: throw → success on relation writes

**Who is affected.** Anyone on dev-tip between PR 2 merge (`82f6dd4`, 2026-04-18) and PR 3 release who wrote a catch around the relation throw. Post-PR-3 the `try` block doesn't fire the `catch`, and the relation write succeeds. This is the desired outcome — but a caller who LOGGED the throw message might suddenly stop logging.

**Smooth migration.** The response shape is unchanged: `{id, url}` before (throw was a Promise rejection) vs `{id, url}` after (success). No JSON-shape migration. Callers inspecting the throw message itself will see their `catch` branch stop running — desired because relation now works. CHANGELOG migration note covers it.

**v0.3.0 release timing.** If PR 3 ships in the same v0.3.0 cut as PR 2, the throw is present only on dev-tip (between PR 2 merge and PR 3 merge), not on any released version. Users who track `latest` on npm will see the throw-less behavior directly. Low risk.

### 7.2 Export surface expansion

Exporting `simplifyProperty` (from `src/server.ts`) and `convertPropertyValue` (from `src/notion-client.ts`) widens the library's public API. Implication:

- Programmatic embedders using the library directly can now call these helpers. If they do, future refactors of the switch bodies become breaking changes.
- The project has no documented "public API" vs "internal" split (CLAUDE.md does not define one). Current exports include `createNotionClient`, `createPage`, `queryDatabase`, etc. — all real functions. Adding `simplifyProperty` + `convertPropertyValue` is consistent with that pattern.
- TypeScript export → reexport from `index.ts`? Checked: `src/index.ts` is the stdio entry and does not re-export anything; `http.ts` is the HTTP entry, same. Library consumers import from `src/server.js` / `src/notion-client.js` directly. No additional reexport work needed.

**Codex Pass A #5** added an amplifier: `package.json` publishes `dist/` without an `exports` map (`package.json:7, :40`), so ANY file in `src/` is a deep-import target for consumers. Two new exports here are marginal on top of the ~15 existing exports.

**Mitigation shipped in this PR:** `/** @internal */` JSDoc tag on both exports (§ 3.3). Signals test-seam intent to readers, TypeScript tooling (with `stripInternal`), and API-extraction tooling. Does not enforce; a determined deep-importer can still call them. But makes a future refactor defensible.

**Alternatives considered, rejected for PR 3:**
- Dedicated `src/notion-properties.ts` module — adds scope creep (file split), doesn't ship this PR.
- Option A (narrower relation-only helpers) — per orchestrator directive 1, Option A is fallback only if Codex surfaces a concern that can't be mitigated. Codex Pass A confirmed Option B is cleanly contained; `@internal` JSDoc addresses the specific export-surface concern A-5 raised.

If `@internal` proves insufficient in practice (e.g., observed third-party deep-import in an issue), v0.3.x can split to a new module without behavior change.

### 7.3 Test-file-as-documentation drift

The current test file has `// Copy of ... (src/server.ts:77-78)` comments. The rewire replaces these copies with imports. Byproduct: future readers lose the "here's what prod looks like" comment annotation. Mitigation: the import statement itself is the reference (`import { simplifyProperty } from "../src/server.js"`), and Option B's full-dispatcher import means the test exercises the whole switch not just a slice — stronger guarantee than a comment.

### 7.4 Dual_property (two-way relations)

Orchestrator confirmed prose-only. Shape:

- Write: user passes `[{id}]` — Notion handles both sides automatically via the schema's `dual_property` config.
- Read: `prop.relation` array is identical shape to `single_property`.
- No code branching needed. **If a future test reveals a difference, file as v0.3.x bug.** Plan documents this so reviewers know it was considered.

### 7.5 Relation cache interaction (schema TTL 5-min)

`convertPropertyValues` already handles the stale-cache-unknown-key case (`:199-207`, bust-and-refetch once). Relation is not special here — if user adds a new relation column in the Notion UI, the cache-bust path (added in PR 2 G-4a) also handles relation discovery. **No additional work.**

### 7.6 Security / injection

Relation values are page IDs. User passes `["a-b-c-...-uuid"]`. The server wraps in `{id: String(value)}` and forwards to Notion. No parsing, no SQL, no shell. **No new attack surface** relative to existing select/multi_select/people which also pass values through unchanged.

### 7.7 Runtime probe side-effects

The probe creates pages under the throwaway parent. All children are archived via parent archive at end. Low risk. If probe crashes mid-run (e.g., rate limit), leftover pages under the dated parent remain until manually archived — parent page name encodes the date so cleanup is obvious.

---

## 8. Builder briefing checklist

When dispatching the builder session, the brief must include:

- [ ] **Scope.** G-5a + G-5b + G-5c + G-5d + G-5f (strictness-test migration), per this plan. G-5e explicitly out-of-scope; CHANGELOG "Known limits" addendum only.
- [ ] **TDD discipline.** Red commit lands failing tests first. Green commit makes them pass. Separate commits, both in the PR.
- [ ] **Red-pass structure.** Include the `export` keyword on `simplifyProperty` (plus `@internal` JSDoc per § 3.3) and the **strictly mechanical** pure-refactor extraction of `convertPropertyValue` (behavior-identical, including PR 2's relation throw, error strings bit-for-bit identical, branch order preserved) so tests compile and run. DO NOT ship the relation branch or read-side case in the red commit — those are green-commit.
- [ ] **Green-pass structure.** Exactly two behavior changes: (1) relation write branch in `convertPropertyValue`, (2) relation read case in `simplifyProperty`. Nothing else.
- [ ] **Option B by default** per orchestrator directive 1. Option A (narrower helpers) is the fallback only if the extraction has unexpected concerns. Codex Pass A #5 noted the export-surface concern — mitigation is `@internal` JSDoc only; do NOT split to a new module without orchestrator approval.
- [ ] **Test files.** Red commit:
  - Modify `tests/relation-property.test.ts` (imports + `type: "relation"` injection in `simplifyRelation` wrapper per § 3.3).
  - Create `tests/relation-roundtrip.test.ts` with 4 integration tests (single, array, empty, update) using the stateful-mock pattern per § 3.4.
  - Modify `tests/database-write-strictness.test.ts` per G-5f migration table in § 3.4a (flip G4b-1, G4b-7; swap G4b-8 middle entry to `people`; delete G4b-9).
- [ ] **Full test suite.** `npm test` must be green at end of green pass. No skipped tests, no warnings.
- [ ] **Typecheck.** `npm run typecheck` (or equivalent) green at end of green pass.
- [ ] **Runtime probe.** Execute § 5 against a real Notion workspace. Parent page `pr3-test-pages-2026-04-18` under `NOTION_ROOT_PAGE_ID`. **Unique timestamped row names** + exact-one-row read-back assertions per § 5.3 (Codex Pass B #7). Archive parent at end. Record evidence in `.meta/runtime-evidence/pr3-g5-2026-04-18.md` (new file).
- [ ] **CHANGELOG.** Update per § 6.2 (new **Fixed** entry — NOT Added) + § 6.3 (amended Known limits). Do not touch the PR 2 breaking-change bullets.
- [ ] **README update.** Edit `README.md:291` blockquote per § 6.1 — move `relation` from "other types" list into "supported" list; add the single/array/empty relation-write ergonomics sentence.
- [ ] **No unrelated refactors.** If the builder notices opportunities in adjacent code, file as tech-debt — do not bundle.
- [ ] **State snapshot ritual before any git push / PR open.** `pwd && git branch --show-current && git status && git log --oneline @{upstream}.. 2>/dev/null || git log --oneline origin/dev..` per CLAUDE.md. Confirm branch is `dev` or a PR-specific branch, confirm status is clean except intended files, confirm unpushed commits match the two expected ones.
- [ ] **`gh pr create` pre-check.** Before opening the PR, run `git diff --stat main...HEAD` (or the appropriate base) and confirm the file set matches exactly (Codex Pass A #1 expanded this list):
  - `src/notion-client.ts`
  - `src/server.ts`
  - `tests/relation-property.test.ts`
  - `tests/relation-roundtrip.test.ts` (new)
  - `tests/database-write-strictness.test.ts`
  - `CHANGELOG.md`
  - `README.md`
  - `.meta/runtime-evidence/pr3-g5-2026-04-18.md` (new)

  Eight files total. If other files appear, STOP and surface to orchestrator before pushing.
- [ ] **Codex review (Pattern 2)** — if the builder makes material design choices not covered by this plan (e.g., Option B → A flip, different strictness-test migration), request a Codex pass before pushing.

---

## 9. Codex review appendix

Two passes per the approach, per CLAUDE.md Pattern 2. Both delivered substantive pushback (no rubber-stamp); all blocker and major findings folded into the plan above.

### 9.1 Pass A — fix design

- **Session ID:** `019da2bb-567f-7c60-b511-4ae57d993c0d`
- **Model:** gpt-5.4, `reasoningEffort: high`
- **Prompt focus:**
  1. Attack Option B extraction — is the pure `convertPropertyValue` extraction cleanly contained, or does it leak schema-fetch/cache/ds concerns?
  2. Does the plan miss a code path where relation is assumed unsupported beyond `simplifyProperty`, `convertPropertyValues`, and `schemaToProperties`? Probe `buildTextFilter` at `notion-client.ts:133-143`, `getDatabase` at `:110-131`, and any filter-builder or query-shape code.
  3. Is the G-5e defer defensible?
  4. Dual_property relations — is the prose-only claim justified?
  5. `simplifyProperty` relation case placement + shape consistency.
  6. Export-surface expansion concerns.

- **Outcome — verdict `Revise`.** 5 revise findings + 5 accepts. NOT rubber-stamp.

| # | Finding | Disposition | Plan fold |
|---|---|---|---|
| A-1 | Plan misses 4 relation-error tests in `database-write-strictness.test.ts` (lines 252, 394, 415, 445) — file list too narrow | Revise | New § 3.4a G-5f + § 8 builder checklist file list expanded to 8 files |
| A-2 | Read-side impact misstated — `simplifyProperty` feeds `simplifyEntry` which is used ONLY by `query_database`; `read_page` does NOT use it | Revise | § 1, § 2.1, § 6.2 corrected; § 5.3 runtime uses `query_database` read-back only |
| A-3 | G-5e rationale technically sloppy — Notion 2025-09-03 uses `relation.data_source_id` not `database_id`; `update_data_source` already forwards raw payloads (explicit passthrough test at `tests/update-data-source.test.ts:58`) | Revise rationale, keep defer | § 3.5 corrected; § 6.3 Known-limits names the `update_data_source` workaround |
| A-4 | README line 291 currently says relation writes are rejected — becomes a lie after PR 3 | Revise | § 6.1 adds README edit to builder scope |
| A-5 | Export-surface expansion real concern — package publishes `dist` without `exports` map, deep-imports possible; suggests dedicated module or narrower helpers | Revise (partial) | § 3.3 adds `@internal` JSDoc on both exports; dedicated module considered and rejected for this PR scope (documented in § 3.3 and § 7.2) |
| A-accept-1 | Option B cleanly contained — switch body depends only on (type, key, value, titleRichText); does not touch client/dbId/ds/schemaCache/unknownKeys | Accept | Confirms Option B-default per orchestrator directive 1 |
| A-accept-2 | Dual_property prose-only claim correct — values are `relation: Array<{id}>` on both read and write for both single_property and dual_property variants | Accept | § 3.1 and § 7.4 stand |
| A-accept-3 | `buildTextFilter` at `notion-client.ts:133-143` is intentionally text-only; raw filter objects can already express relation filters — NOT a hidden unsupported path | Accept | § 2.5 already flagged and probed |
| A-accept-4 | `getDatabase` at `:110-131` omits relation target metadata but is not asserting unsupported — disclosure gap, not blocker | Accept (defer) | § 2.5 + § 10 item 2 |
| A-accept-5 | `simplifyProperty` relation branch shape (`string[]` from `prop.relation?.map(r => r.id) ?? []`) and placement after `people` consistent with adjacent plural cases | Accept | § 3.2 stands |

### 9.2 Pass B — test design + round-trip coverage

- **Session ID:** `019da2bb-8d8c-7dc1-997e-7be815d30863`
- **Model:** gpt-5.4, `reasoningEffort: high`
- **Prompt focus:**
  1. Does the round-trip integration test ACTUALLY test round-trip, or just handler shape?
  2. Does the rewired `relation-property.test.ts` preserve all 9 existing assertions?
  3. Are integration edge cases sufficient vs the unit-test 9-case set?
  4. Red-pass refactor-in-red split — right call or confusing?
  5. Runtime probe false-green risks?
  6. False-green paths generally?
  7. CHANGELOG `Added` vs `Fixed` framing?

- **Outcome — verdict `Not sound yet`.** 4 blockers + 2 majors + 2 moderates. NOT rubber-stamp.

| # | Finding | Severity | Plan fold |
|---|---|---|---|
| B-1 | §3.3 thin wrapper doesn't preserve 5 read-side assertions — tests pass `{relation: ...}` with no `type` field but real dispatcher hits `default: null` | Blocker | § 3.3 wrapper now injects `type: "relation"` via `{...prop, type: "relation"}` spread |
| B-2 | §3.4 round-trip not actually round-trip — mock `dataSources.query` could return hardcoded results independent of `pages.create` state | Blocker | § 3.4 now specifies stateful mock with `pageStore` Map; `pages.create`/`pages.update` persist; `dataSources.query` returns stored pages |
| B-3 | Mock fidelity underspecified — needs full raw property shape (`type: "relation"` + `relation: [{id}]`), not just `relation: [...]` | Blocker | § 3.4 now documents `decorateWithTypes()` helper + explicit stored-page shape |
| B-4 | Runtime S-2 and S-5 use `read_page` but `read_page` doesn't expose DB properties — scenarios invalid as written | Blocker | § 5.3 all scenarios use `query_database` read-back; § 2.1 + § 6.2 clarify the `simplifyEntry` consumption chain |
| B-5 | 3-scenario integration set misses the `update_database_entry` path (distinct handler path through `pages.retrieve` parent resolution) | Major | § 3.4 adds test [I-4] for update round-trip |
| B-6 | Red-pass extraction is the right split but must be STRICTLY mechanical — no "while we're here" improvements | Moderate | § 4.1 now specifies mechanical requirements: verbatim error strings, preserved branch order, no variable renames, no whitespace tidying |
| B-7 | False-green paths — non-stateful mock (addressed in B-2); runtime probe susceptible to stale-row false-green without unique row names | Major | § 5.3 now uses `pr3-s<N>-<timestamp>` row names + `results.length === 1` assertions |
| B-8 | CHANGELOG should be `Fixed` not `Added` — within `[Unreleased]`, PR 3 closes a defect already documented (PR 2 throw, relation read deferral) in the same release train | Moderate | § 6.2 moves entry under `### Fixed`; removes `### Added` placement |

### 9.3 Press-test summary

**Neither pass rubber-stamped.** Pass A unprompted pushback on test-file completeness (A-1 missed 4 existing tests), read-side scope (A-2 `read_page` vs `query_database`), G-5e rationale precision (A-3 `data_source_id` wire shape), README consistency (A-4), and export surface (A-5). Pass B delivered 4 blockers against the initial test design, including a thin-wrapper bug (B-1) that would have caused all 5 read-path assertions to silently regress to false-green.

**Plan status after revisions:** all 8 Pass B findings addressed; all 5 Pass A findings addressed (with 1 partial — A-5 export-surface mitigated via `@internal` JSDoc rather than module split). No outstanding blockers. Ready for orchestrator screen + builder dispatch.

**Re-press decision.** Not run — both passes produced concrete file-line citations that landed as specific plan revisions, not hand-wavy "consider this." A third pass would test diminishing returns against Pattern 2's iterate-to-no-blockers standard.

---

## 10. Deferred items (to v0.3.x tracklist)

Items that this plan explicitly does NOT close but that should be tracked for future PRs:

1. **G-5e — typed relation shortcut in `create_database` schema parameter.** Today users can add a relation column via `update_data_source` (explicit passthrough, tested); a typed shortcut in `create_database` is the deferred ergonomics improvement. § 3.5 rationale; § 6.3 Known-limits. Requires the Notion 2025-09-03 wire shape `relation.data_source_id` and a `database_id → data_source_id` resolution step.
2. **`get_database` relation target disclosure.** `getDatabase` at `src/notion-client.ts:110-131` emits `{name, type: "relation"}` without the target `data_source_id`. Users discover the column but not what it points at. § 2.5; § 9.1 A-accept-4.
3. **`read_page` DB-property exposure.** `read_page` at `src/server.ts:1141` does not surface DB-row properties; users must use `query_database` to see simplified relation values. If `read_page` should expose properties, that's a v0.3.x contract decision. § 2.1; § 9.1 A-2.
4. **C-7 sibling rewires.** `tests/list-databases.test.ts` and `tests/update-section.test.ts` use the same copied-helper pattern without masking an equally acute production gap. Synthesis deferred these to v0.3.x.
5. **`simplifyProperty` default-null on other unsupported types.** Read-side silent drops for types OTHER than relation (e.g., `formula`, `rollup`) still return `null`. Planned for v0.3.1 with a `warnings` schema per PR 2's § 2.
6. **`schemaToProperties` throw on unsupported types.** Symmetric with G-4b for the schema-build side; G-4c made the drop visible in the response but does not yet throw on the request side. Planned for v0.3.1 alongside people/files write support (see PR 2 § 10 item 2).

---

**End of plan.** Codex appendix § 9 to be filled in by the planner's Codex pass before handing to orchestrator for screening.

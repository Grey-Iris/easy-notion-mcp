# Plan: Long-property pagination (PR2)

**Task:** `notion-long-property-pagination` (tasuku, `high` priority, tags `bug, audit`).
**Date:** 2026-04-23.
**Phase sequence:** PR1 (property-type gap, shipped 2026-04-22 at `c5e27bc`) then PR2 (this plan) then PR3 (atomic replace + `update_block`). Decision `post-v030-phase-sequence` in tasuku.
**Audit anchor:** `.meta/audits/notion-api-gap-audit-2026-04-20.md` §1.2 finding 2, §3.2 row `pages.properties.retrieve`, §6 "PR 2".
**Prior plan (template):** `.meta/plans/notion-property-type-gap-2026-04-21.md` (PR1). This plan mirrors the section layout and severity calibration.
**Phase:** planning only. No code changes in this commit; only the plan file at `.meta/plans/pr2-long-property-pagination-2026-04-23.md`.

---

## 1. TL;DR

- Add a pagination helper that walks a Notion page object, detects truncated multi-value properties (length exactly 25 for `title`, `rich_text`, `relation`, `people`), fetches the rest via `client.pages.properties.retrieve`, and returns a rehydrated page plus warnings. New helper in `src/notion-client.ts`. Rollup-array pagination (the fifth candidate type) is deferred: see §2.2.
- Apply the helper at two change sites: `query_database` (primary silent-data-loss site, processes every page in the result set) and `read_page` (title-only path, via `getPageTitle`). Defer three secondary sites (`duplicate_page`, `update_page`, `search`) to a follow-up task to keep diff under the one-PR ceiling. The walker accepts an `onlyTypes` option so `read_page` can paginate title only, avoiding spurious pagination on unsurfaced relation / people properties.
- Cap pagination at `max_property_items` (default 75) per property. Hitting the cap is a warning, not an error. Passing `0` means unlimited (no ceiling).
- Introduce one warning code: `truncated_properties`, emitted only when the cap was hit. Detail shape: `{ code: "truncated_properties", properties: [{ name, type, returned_count, cap }] }`. Naming mirrors the existing `omitted_block_types` precedent.
- Breaking change to `query_database` response shape: wrap `Array<SimpleEntry>` in `{ results: Array<SimpleEntry>, warnings?: Warning[] }` so warnings have a surface. This closes the deferred `notion-query-read-warnings` task as a side effect (it was always going to be PR2's dependency). Bump minor version to `v0.5.0` on ship.
- No opt-in flag to preserve the bug. Warn by default, do not preserve silent truncation. Callers consuming truncated data were consuming wrong data; returning the full set up to a cap is a strict improvement.
- Risk profile: medium. Biggest risks are the `query_database` response wrap (breaking change), and the per-result API-call amplification in large query result sets.
- Effort: 3 dev-days builder estimate (~500 to 700 LOC including tests). Under the 800-line / 6-hour-wall-clock PR ceiling. One PR. Per learning `[0186bc]`, wall-clock typically runs 10 to 40 times under plan estimate when the planner has front-loaded the thinking.

---

## 2. Scope and non-goals

### 2.1 In scope

- New `paginatePageProperties(client, page, opts) -> { page, warnings }` helper in `src/notion-client.ts`.
- New `paginatePropertyValue(client, pageId, propertyId, type, opts) -> { value, truncatedAtCap }` low-level helper in the same file, called by the walker.
- Route every `query_database` result through the helper. Change `query_database` response from `Array<SimpleEntry>` to `{ results: Array<SimpleEntry>, warnings?: Warning[] }`.
- Route `read_page`'s page object through the helper (for the title field only, per current behavior). `read_page` already returns an object with optional `warnings`, so the shape addition is purely additive.
- New optional `max_property_items` parameter (number) on both `query_database` and `read_page` tool schemas. Default 75. `0` means unlimited. Negative values rejected with a validation error.
- Tool descriptions updated to document the new behavior and the warning code.
- Unit tests for the new helpers. Integration tests against an in-memory MCP with a mocked Notion client. Live e2e test against a real Notion relation with more than 25 entries.

### 2.2 Out of scope (deferred)

- Secondary title-only sites: `duplicate_page` (`src/server.ts:1310`), `update_page` (`:1356`), `search` (`:1376`). Each reads only the title through `getPageTitle`. Cheap fix in principle but multiplies the API-call surface and widens the diff. Deferred as `notion-page-title-pagination-secondary-sites`. Triggering condition: a user reports a truncated page title from any of those three tools. `findWorkspacePages` (`src/notion-client.ts:598-634`) also reads page titles in its error-path only (for the missing-parent suggestion in `create_page`); that path is not user-visible in the happy case and is out of scope for this PR.
- **Rollup-array pagination (the fifth paginated type) is deferred to a follow-up task `notion-rollup-array-pagination`.** Rationale: SDK types confirm `PropertyItemListResponse.results` is `Array<PropertyItemObjectResponse>` (`api-endpoints.d.ts:2091`) so the per-item response shape is well-defined, but the inner `array: Array<EmptyObject>` on the `property_item.rollup` discriminator (`api-endpoints.d.ts:2063, 2073-2075`) leaves the per-item rehydration shape under-specified without a live probe. PR2 ships pagination for the four well-specified types (title, rich_text, relation, people) and files the rollup follow-up with triggering condition: a user reports a rollup with `type: "array"` and more than 25 array items being silently truncated OR the live verification in a separate session produces a shape we can implement against. This keeps PR2 squarely in the "fix the bug we understand" scope and avoids the rollup.array shape risk creeping the diff.
- Surfacing properties in `read_page` output (currently `read_page` does not return properties at all). The audit does not demand this and adding it would be scope creep. Deferred as `read-page-surface-properties`. Triggering condition: a user asks for property access on non-database pages via `read_page`.
- Per-property pagination cursors returned to the caller so they can fetch more themselves. The cap + warning contract is a complete signal; a resumable cursor is over-engineered for the first iteration.
- Changes to how `simplifyProperty` decodes the four paginated types. The helper rehydrates the raw page properties back into the shapes `simplifyProperty` already handles, so that function does not change in this PR.

---

## 3. Bug anatomy and call graph

### 3.1 The bug

Notion's `GET /v1/pages/{id}` response truncates five property types when they hold more than 25 items:

- `title` (array of `RichTextItemResponse`)
- `rich_text` (array of `RichTextItemResponse`)
- `relation` (array of `{ id }`)
- `people` (array of user objects)
- `rollup` with `rollup.type: "array"` (array of nested property values)

Confirmed via `developers.notion.com/reference/retrieve-a-page-property`: "Retrieve a page will not return a complete list when the list exceeds 25 references." The truncated response does NOT include a `has_more` flag on the property, so the only detectable signal is "length is exactly 25" (false positives possible but benign, see §5.1).

The `pages.properties.retrieve` endpoint (`GET /v1/pages/{page_id}/properties/{property_id}`) is the canonical way to fetch complete values. Its response is paginated via `next_cursor` / `has_more`, with per-item objects typed as `PropertyItemObjectResponse` (SDK `api-endpoints.d.ts:2039`) and the list wrapper as `PropertyItemListResponse` (`api-endpoints.d.ts:2038-2092`). The SDK exposes it as `client.pages.properties.retrieve` (`Client.d.ts:210-215`).

### 3.2 Call graph in current code

Every site that surfaces a Notion page-property array to callers is a candidate change site. Current code state verified 2026-04-23 against `src/server.ts` at commit `c9e3966` (not `50-94` as the brief referenced from the older audit; PR1 expanded `simplifyProperty` to lines `54-143` and added decoders for formula, rollup, files, people, created_time, last_edited_time, created_by, last_edited_by, verification, place, button).

| Site | File:line | What it surfaces | Decision |
|---|---|---|---|
| `query_database` handler | `src/server.ts:1470-1487` | Every property of every result, via `simplifyEntry` at `:1486`. `simplifyEntry` (`:145-151`) iterates `page.properties` and calls `simplifyProperty` (`:54-143`). | IN SCOPE. Primary site. |
| `read_page` handler | `src/server.ts:1256-1300` | Calls `getPage` (`:1263`) then `getPageTitle(page)` (`:1279`). `getPageTitle` (`:159-165`) reads `title` rich_text array. No other properties surfaced. | IN SCOPE. Title pagination only. |
| `duplicate_page` handler | `src/server.ts:1309-1310` | Reads `sourceTitle` via `getPageTitle`. | OUT OF SCOPE (§2.2). |
| `update_page` handler | `src/server.ts:1353-1356` | Reads the updated page title via `getPageTitle`. | OUT OF SCOPE (§2.2). |
| `search` handler | `src/server.ts:1372-1380` | Iterates up to 100 results, extracts title via `getPageTitle` for page-type rows. | OUT OF SCOPE (§2.2). Applying pagination here would multiply the API-call surface. |
| `updateDatabaseEntry` | `src/notion-client.ts:903-927` | Calls `pages.retrieve` at `:908` but only reads `parent`; no property surfaced to caller. | NO CHANGE. |

Residual non-user-facing calls to `pages.retrieve`: `getPage` in `src/notion-client.ts:698-700` (used by `read_page`, `duplicate_page`, `update_page`, `share_page`). No behavior change for callers that do not surface property arrays.

### 3.3 What about `dataSources.query`?

`dataSources.query` (wrapped by `queryDatabase` in `src/notion-client.ts:839-863`) returns page objects under `response.results`. Each of those page objects has the same 25-item truncation on the five multi-value property types. This matches `pages.retrieve`. The paginated-property endpoint works against any page ID, so the fix is symmetric: for every returned page, paginate truncated properties. See §5.2 for the resulting fan-out pattern.

---

## 4. Design decisions

### 4.1 Pagination trigger (Option A vs Option B)

Options from the brief:

- **Option A.** Call `pages.properties.retrieve` for ANY property whose value returns exactly 25 items.
- **Option B.** Only for the truncatable property types (docs list title, rich_text, relation, people; rollup-with-aggregations also paginates but is deferred per §2.2).

**Decision: Option B, type-gated, with rollup deferred.**

Rationale.

- The Notion docs name exactly these as paginated-list returns. Other property types (number, checkbox, select, etc.) cannot produce arrays, so the "length === 25" check would never fire on them anyway.
- Narrowing by type avoids a class of false positives on `multi_select` (which already returns short arrays without truncation) and clarifies the helper's contract.
- Implementation detail: the type gate is `prop.type in { title, rich_text, relation, people }`. `rollup` is out of scope for this PR (§2.2).

The "exactly 25" heuristic still fires: when a type-gated property has length 25, we optimistically paginate. If Notion returns `has_more: false` on the first page (the property legitimately had exactly 25 items), the helper returns the original value unchanged. The cost of a false positive is one extra API call per such property per page; see §7 for the rate-limit risk.

No better detection signal exists. The `PageObjectResponse.properties` shape (`api-endpoints.d.ts:1763`) is `Record<string, PagePropertyValueWithIdResponse>` and the per-property shape (`:1779`) carries no `has_more` flag on `pages.retrieve` responses. `has_more` lives only on the `PropertyItemListResponse` wrapper (`:2088`) returned by `pages.properties.retrieve`. Length-gate is the only available heuristic.

### 4.2 Pagination policy and total-item cap

Options from the brief:

- **Option 1.** Unlimited pagination by default with a size warning when large.
- **Option 2.** Opt-in pagination via a parameter.
- **Option 3.** Cap at N items with truncation warning when exceeded.

**Decision: Option 3, default cap 75, `max_property_items: 0` means truly unlimited (no ceiling).**

Rationale.

- The bug the PR exists to fix is silent data loss. Opt-in pagination (Option 2) leaves the bug in place by default, which is the wrong trade against the severity. Rejected.
- Unlimited-by-default (Option 1) fixes the data loss but introduces a new failure mode: a relation with 2000 IDs produces a response large enough to wedge the LLM's context. The audit explicitly called this out. Rejected.
- Capped-by-default (Option 3) fixes the common case (relations up to cap) and surfaces the rare cap-hit case as a warning. Callers who know they need the full set can raise or disable the cap.
- Cap of 75 is generous enough that the common case (relations / people up to a few dozen entries) fits without the cap firing. Based on audit §1.2 which identified the "500-plus entries" case as the user-wedging concern, 75 is comfortably under that threshold while still covering normal-size workspaces.
- The `max_property_items: 0` escape hatch is an explicit signal from the caller that they want every item. When `0`, the helper loops until Notion returns `has_more: false`. No round-trip ceiling. Callers who pass `0` are accepting the cost and responsibility of pulling arbitrarily large properties.

Consistency with `read_page`'s existing `max_blocks`. `max_blocks` at `src/server.ts:1269` treats only `> 0` as a cap; `0` or undefined means unlimited. `max_property_items` keeps the same "0 means unlimited" semantic. It differs by rejecting negatives explicitly (better API hygiene; `max_blocks` silently treats negatives as unlimited). The difference is intentional and can be unified later if drift becomes a problem.

Parameter shape on both tools:

```
max_property_items: {
  type: "number",
  description: "Maximum number of items to fetch for multi-value properties
    (title, rich_text, relation, people). Applies per property, per row.
    Defaults to 75. Set to 0 for unlimited (warning: large relation
    properties can exceed 1000 items and may use significant context).
    Negative values are rejected. When the cap is hit, the response
    includes a `truncated_properties` warning with a `how_to_fetch_all`
    hint pointing at the override mechanism.",
}
```

### 4.3 Warning surface

Context: the existing `warnings` contract (CLAUDE.md §Key decisions, lines 132 to 136) is `Array<{code: string, ...detail}>`, omitted when empty. Existing code in use: `omitted_block_types` on `read_page` and `duplicate_page` with `blocks: OmittedBlock[]`.

**Decision: one new warning code, `truncated_properties`.**

Shape:

```
{
  code: "truncated_properties",
  properties: [
    { name: "Tasks", type: "relation", returned_count: 75, cap: 75 }
  ],
  how_to_fetch_all: "Call again with max_property_items: 0 to fetch all items, or raise the cap to a larger number."
}
```

When it fires: only when the cap was hit for at least one property. If pagination ran but all data was retrieved (no truncation), no warning is emitted. This matches the `omitted_block_types` precedent exactly: the warning exists to signal data loss, not to narrate normal operation.

Field semantics.

- `name`: property name as used by the caller. Same key the caller passed in filter / sort / key-value maps elsewhere.
- `type`: Notion property type string (`title`, `rich_text`, `relation`, `people`, `rollup`). For `rollup`, always the array variant (scalars never trigger).
- `returned_count`: number of items actually included in the response (equal to cap in the current design; kept as a field so a future change that reports under-cap truncation remains within-contract).
- `cap`: the effective cap used on the call (either the caller's `max_property_items` or the default 75).
- `how_to_fetch_all`: single string at the warning level (not per property). Always present when `truncated_properties` fires. Value is a human-readable hint explaining the override mechanism so the agent does not need to reread the tool description to discover the escape hatch. Exact wording may be refined during the builder session; the contract is "a hint string is present", not a specific phrase.

Codes are part of the wire contract once shipped (CLAUDE.md line 136). Detail fields like `how_to_fetch_all` are additive-safe: adding new detail fields does not require a version bump, only removal or rename of an existing field (including a code) does.

### 4.4 Response shape change on `query_database`

Today `query_database` returns a bare `Array<SimpleEntry>`. Warnings have nowhere to live in that shape. Options considered:

- **Wrap always**: `{ results: Array<SimpleEntry>, warnings?: Warning[] }` with `warnings` omitted when empty. Breaking change for existing callers; migration is one-line (`rows.map` becomes `rows.results.map`).
- **Wrap only when warnings exist**: `Array<SimpleEntry>` when no warnings, `{ results, warnings }` otherwise. Unstable wire contract; callers have to check the type at runtime. Rejected as bad API design.
- **Inline warnings on each result**: add a `_warnings` field on entries that had properties paginated. Mutates entry shape per result, which is worse for consumers than a single top-level warnings array. Rejected.
- **stderr only**: log warnings to `console.error`. Invisible to LLM callers. Rejected; warnings exist precisely to reach the caller.

**Decision: wrap always.** Breaking change, but unavoidable given the warnings contract. The PR1 plan explicitly deferred `notion-query-read-warnings` knowing it would be PR2's dependency (see PR1 plan §6 "Deferred task"). Closing that deferral here is the right sequencing.

Migration.

- v0.4.0 callers get `Array<SimpleEntry>` from `query_database`.
- v0.5.0 callers get `{ results: Array<SimpleEntry>, warnings?: Warning[] }`.
- CHANGELOG "Breaking changes" section documents the migration: `rows` becomes `rows.results`, new optional `warnings` field handled like `read_page`'s warnings.
- Version bump on ship: `v0.4.0` to `v0.5.0`. Still under 1.x so breaking changes in minors are the norm for this project.

### 4.5 `read_page` response shape

`read_page` already returns an object with optional `warnings` for `omitted_block_types`. Adding a new `truncated_properties` warning to the SAME warnings array is purely additive; no shape change.

Title pagination behavior: if `page.properties[<titleKey>].title.length === 25`, the helper calls `pages.properties.retrieve` for the title property and rehydrates the full array. `getPageTitle` then sees the full list without change. Behavior under cap is the same as any other paginated property.

### 4.6 Backwards compatibility on behavior

The brief explicitly asked: "Decide whether the warning suffices, or whether we need an opt-in flag to preserve the broken behavior. Lean: warn by default, don't preserve the bug. Justify."

**Decision: warn by default, do not preserve the broken behavior.**

Justification.

- The "broken" behavior is silent data loss. No caller was relying on it intentionally; they were relying on the partial data as if it were complete.
- Preserving the bug via an opt-in flag (e.g. `disable_property_pagination: true`) would be a forever-maintenance tax on a behavior nobody asked for.
- The cap parameter (§4.2) covers the one legitimate reason to limit fetched data: LLM context pressure. That is a different axis from "keep returning the broken partial set".

Migration path for v0.4.0 callers who may have been parsing the 25-item arrays directly: they keep working. Arrays up to 75 items are a superset of arrays up to 25 items. Callers who cared about "exactly 25" as a sentinel for truncation did not exist (there was no contract for that). Callers who want the old "fetch no more than 25" cap can set `max_property_items: 25` explicitly.

---

## 5. Implementation outline

Tasks described are for the builder. No code is written in this plan.

### 5.1 Helper: `paginatePropertyValue` (new, in `src/notion-client.ts`)

Signature sketch.

```
async function paginatePropertyValue(
  client: Client,
  pageId: string,
  propertyId: string,
  propertyType: "title" | "rich_text" | "relation" | "people",
  cap: number,               // 0 means unlimited
): Promise<{ values: unknown[]; truncatedAtCap: boolean }>
```

Behavior.

- Calls `client.pages.properties.retrieve({ page_id, property_id, start_cursor })` in a loop. Starts with no cursor; subsequent iterations pass `next_cursor` from the prior response.
- Accumulates `results` from each response into a single array.
- Stops when `has_more: false`, or when `cap > 0` and the accumulated count reaches `cap`. When `cap === 0`, the loop continues until Notion signals `has_more: false`.
- Returns the per-item array reshaped back into the `simplifyProperty`-expected shape (see §5.3).
- Returns `truncatedAtCap: true` when the loop stopped because of the cap AND `has_more` was still true at the stopping iteration.

Progress invariant (runaway-loop guard, different from a fixed ceiling): if two consecutive iterations return `has_more: true` but advance `next_cursor` by the same value, or return zero results, throw. This catches a malformed SDK response or API bug without capping legitimate long relations.

Error handling: propagate any API error up. Callers decide whether to treat a pagination failure as a total failure or a partial return; the recommended pattern is "abort the page's pagination, emit an error-style warning, return the original truncated array unchanged". See §8 open question 3.

### 5.2 Helper: `paginatePageProperties` (new, exported from `src/notion-client.ts`)

Signature sketch.

```
type PaginationOpts = {
  maxPropertyItems: number;                              // 0 = unlimited; default 75 applied by caller
  onlyTypes?: Array<"title" | "rich_text" | "relation" | "people">;  // if set, skip all other paginated types
};

export async function paginatePageProperties(
  client: Client,
  page: any,
  opts: PaginationOpts,
): Promise<{ page: any; warnings: TruncatedPropertyEntry[] }>
```

Behavior.

- Walks `page.properties`.
- For each property:
  - If `opts.onlyTypes` is set and the type is not in the list, skip.
  - If the type is not in the four supported paginated types (`title`, `rich_text`, `relation`, `people`), skip.
  - If the type-specific array length is NOT 25, skip.
  - Otherwise, call `paginatePropertyValue` with the property ID.
  - Replace the property on a shallow-cloned copy of the page, preserving surrounding fields (`id`, `type`, etc.). Do not mutate the input page.
  - If `truncatedAtCap`, collect a `{ name, type, returned_count, cap }` entry.
- Returns the rehydrated page plus the collected entries (one per capped property). Caller aggregates into a single `{ code: "truncated_properties", properties: [...] }` warning.
- Concurrency: within one page, paginate each property sequentially (typical page has 1 to 3 truncatable properties; parallelizing within a page adds complexity for marginal gain). Across pages in `query_database`, keep the existing per-page loop; parallelizing across pages within one `query_database` call is a follow-up optimization (`notion-query-pagination-concurrency`).

`onlyTypes` exists so `read_page` can paginate title only. Without this option, `paginatePageProperties` would paginate truncated relation / people properties on pages that `read_page` does not surface to the caller, producing extra API calls and confusing warnings on unsurfaced data.

Export surface: `paginatePageProperties` is exported by name. The low-level `paginatePropertyValue` can stay non-exported unless test-only visibility is needed (in which case, flag with `@internal` JSDoc, same pattern as `simplifyProperty`'s `@internal` export at `src/server.ts:53`).

### 5.3 Shape-reassembly detail

`client.pages.properties.retrieve` returns per-item objects (`PropertyItemObjectResponse`) whose shape differs from the `PagePropertyValueWithIdResponse` shape used by `simplifyProperty`. The helper translates back.

Per-type reassembly (source: `api-endpoints.d.ts`):

- `title` (2536-2541): each item is `{ type: "title", title: RichTextItemResponse, object: "property_item", id }`. Reassemble to `{ type: "title", title: Array<RichTextItemResponse>, id }` by collecting each item's `.title` value.
- `rich_text` (2171-2176): analogous to title. `{ type: "rich_text", rich_text: RichTextItemResponse }` per item; collect into the full array.
- `relation` (2141-2148): each item is `{ type: "relation", relation: { id: string } }`. Reassemble to `{ type: "relation", relation: Array<{id: string}> }`.
- `people` (1885-1890): each item is `{ type: "people", people: PartialUserObjectResponse | UserObjectResponse }`. Reassemble to `{ type: "people", people: Array<PartialUserObjectResponse | UserObjectResponse> }`.

Rollup shapes are NOT reassembled in PR2; see §2.2 (deferred). Adding rollup support later follows the same pattern once the per-item shape is confirmed against a live workspace.

### 5.4 Integration points

`src/notion-client.ts`.

- Add `paginatePageProperties` (EXPORTED; consumed by `src/server.ts` handlers). Add `paginatePropertyValue` as a module-private helper (or exported with `@internal` JSDoc if unit tests require direct visibility, mirroring the `simplifyProperty` pattern at `src/server.ts:53`).
- Add a thin `PaginationOpts` type (`{ maxPropertyItems: number; onlyTypes?: string[] }`) exported alongside the helper.
- Add a `TruncatedPropertyEntry` type for the warning detail shape.

`src/server.ts`.

- Import `paginatePageProperties` from `notion-client.js` (extend the import block at `:14-44`).
- `query_database` handler (`:1470-1487`): read `max_property_items` from args (default 75), map each `queryDatabase` result through `paginatePageProperties` (no `onlyTypes` restriction, walks all four types), aggregate entries into a single `{ code: "truncated_properties", properties, how_to_fetch_all }` warning if any, wrap response as `{ results, warnings? }`. `simplifyEntry` operates on the rehydrated page.
- `read_page` handler (`:1256-1300`): read `max_property_items` from args (default 75), call `paginatePageProperties` with `onlyTypes: ["title"]` so only the title is paginated. Merge any resulting `truncated_properties` warning entries with the existing `omitted_block_types` warnings array.
- Tool input schemas for `query_database` (`:763-783`) and `read_page` (`:642-656`): add `max_property_items` field.
- Tool descriptions: add a paragraph explaining default pagination behavior, the cap, and the `truncated_properties` warning code.

No change to `simplifyProperty`, `simplifyEntry`, or `getPageTitle`.

### 5.5 Phased build with TDD

All phases end with test green and a concrete runtime check. Per learning `[e9dcf6]` (TDD for all bug fixes and new endpoints) and the PR1 playbook.

**Phase P1. Low-level helper red test then green.**

- Write failing unit tests for `paginatePropertyValue` in `tests/paginate-property-value.test.ts` (new file).
- Cases (mock `pages.properties.retrieve` to return the FULL property item list, not a "remaining tail"; the endpoint always starts from the beginning of the property unless a cursor is passed):
  - Relation of 27 items: mock returns `{ results: [27 items], has_more: false }` in one call. Helper fetches once, returns 27 items. No second call.
  - Relation of 150 items with cap 75: mock returns `{ results: [75 items], next_cursor: "c1", has_more: true }` then `{ results: [75 items], has_more: false, next_cursor: null }`. Helper stops after the first call at cap 75, returns 75 items, `truncatedAtCap: true`. No second call made.
  - Relation of 150 items with `cap: 0`: helper fetches both pages, returns all 150, `truncatedAtCap: false`.
  - Title of 30 items: mock returns a single page with 30 title-item entries. Helper returns 30 items reshaped to `{ type: "title", title: [...30 rich_text] }`.
  - Rich_text of exactly 25 items: mock returns `{ results: [25 items], has_more: false }`. Helper fetches once, returns the 25-item array. No second call.
  - Cap 0 unlimited: same as above for a 150-item relation.
  - Cap negative: caller rejects before call (validation lives at the tool boundary, not in the helper).
  - Runaway-loop guard: mock returns `has_more: true` with empty `results` and no cursor advance; helper throws.
- Mock the client via a minimal stub with `pages.properties.retrieve`.
- Evidence: paste the two failing test outputs, then the green run.

**Phase P2. Walker helper red then green.**

- Write failing unit tests for `paginatePageProperties` in `tests/paginate-page-properties.test.ts` (new file).
- Cases (mocks return the full paginated property, as in P1):
  - Page with a `relation` of 27 items (length 25 in the input `pages.retrieve` stub, mock `pages.properties.retrieve` returns 27): paginates, replaces value with 27 items, no warnings.
  - Page with a `relation` of exactly 25 items and Notion legitimately has 25: `pages.properties.retrieve` returns 25 with `has_more: false`; helper returns original shape, no warnings.
  - Page with `multi_select` of 25 items: not in type gate, no pagination, no extra call.
  - Page with `people` of 200 items with default cap 75: warning entry fires with `{ name, type: "people", returned_count: 75, cap: 75 }`.
  - Page with multiple truncated properties (relation + people + title all at 25): all three paginated; warnings collect all entries that hit cap.
  - Page with `onlyTypes: ["title"]`: only title is paginated, relation / people skipped even if they are at 25.
  - Immutability: input page object is not mutated (check identity).
- Green after implementing the walker.

**Phase P3. `query_database` integration red then green.**

- Write failing integration test for `query_database` (new file `tests/query-database-pagination.test.ts`).
- Mock `dataSources.query` to return one page whose `properties.Ref` has 25 items (simulating Notion's silent truncation). Mock `pages.properties.retrieve` to return the full 30-item relation (never a "remaining 5"; the endpoint restarts from the beginning).
- Cases:
  - 30-item relation under default cap: `result.results[0].Ref.length === 30`, `result.warnings` undefined.
  - 200-item relation, default cap 75: `result.results[0].Ref.length === 75`, `result.warnings[0].code === "truncated_properties"`, `properties[0] === { name: "Ref", type: "relation", returned_count: 75, cap: 75 }`, and `result.warnings[0].how_to_fetch_all` is a non-empty string.
  - `max_property_items: 0`: 300-item relation fetches fully, no warning.
  - `max_property_items: 25`: fetches 25, emits warning with `cap: 25`.
  - Negative `max_property_items`: tool returns a validation error before any Notion call.
  - Response shape: assert wrapped `{ results, warnings? }` (breaking change assertion).
  - Existing callers migrate: update any test in `tests/e2e/live-mcp.test.ts` that destructures the result as an array (e.g. `:500`, `:626`, `:670`) to read `rows.results` instead.
- Green after modifying the `query_database` handler.

**Phase P4. `read_page` integration red then green.**

- Write failing integration test in `tests/read-page-title-pagination.test.ts` (new file).
- Cases:
  - Page with a 30-item title (mock `pages.retrieve` returns 25 truncated; mock `pages.properties.retrieve` returns 30 full items). Assert `response.title` equals the concatenated plain_text of all 30 segments.
  - Page with a 200-item title, default cap 75: assert `response.warnings` includes `truncated_properties` with `properties[0] === { name: "<titleKey>", type: "title", returned_count: 75, cap: 75 }` and a non-empty `how_to_fetch_all` hint.
  - Page with a truncated relation (not surfaced by `read_page`): assert NO extra `pages.properties.retrieve` call is made for the relation (verify via mock call count); the `onlyTypes: ["title"]` option gates it.
- Green after modifying `read_page` handler.

**Phase P5. Tool descriptions and schema.**

- Update tool descriptions for `query_database` and `read_page`. Descriptions must be action-oriented about the override so the escape hatch is discoverable at tool-list-read time, not just when the `truncated_properties` warning fires in-session. Each description must explicitly document: (1) the default cap is 75 items per multi-value property (`title`, `rich_text`, `relation`, `people`); (2) when the `truncated_properties` warning fires, callers can call the tool again with `max_property_items: 0` for unlimited or with a larger cap number to raise the ceiling; (3) a concrete example line, e.g. "If you need more, pass `max_property_items: 500`." The tone should match PR1's tool-description additions (terse, measured; see CLAUDE.md "honest positioning"), but the override guidance is non-negotiable content, not stylistic decoration.
- Update input schemas to include `max_property_items` (shape per §4.2).
- Run `npm run build` and `npm test` to confirm no regressions.

**Phase P6. Live e2e. REQUIRED per brief.**

- In `tests/e2e/live-mcp.test.ts`, add a test that:
  1. Creates two databases (source and target) under the sandbox.
  2. Creates 27 entries in source (roughly 9 to 15 seconds wall-clock at 3 requests per second).
  3. Creates one entry in target with a relation to all 27 sources.
  4. Calls `query_database` on target.
  5. Asserts the relation array returned has 27 entries (not 25). Expect to adjust response destructuring to `rows.results` for the new wrap shape.
  6. Asserts no warnings on the 27-entry case.
- Second test: scale to 85 entries in source to exercise the cap-warning path (10 over the new 75 cap, minimizing wall-clock while still exercising the overflow). Creates 85 rows (~30 to 45 seconds wall-clock). Asserts the returned array length is 75 and `warnings[0].code === "truncated_properties"` with `properties[0]` naming the relation, type `relation`, `returned_count: 75`, `cap: 75`, and `warnings[0].how_to_fetch_all` is a non-empty string.
- Set test timeout to 180 seconds per test to accommodate the row-creation wall-clock plus Notion latency.
- Teardown via existing sandbox helpers. Confirm the two created databases are archived by `ctx.createdPageIds` collection and the existing afterAll sweep.
- Per feedback memory `feedback_people_column_test_notifies`, no user-people columns in this test. Use relation-to-source, which does not notify users.

Rollup-array is NOT exercised live in P6. That type is deferred per §2.2. The follow-up task `notion-rollup-array-pagination` will own the rollup live probe.

**Phase P7. Mutation hand-checks.**

- Swap the `relation` and `people` arms in `paginatePageProperties`. Run `tests/paginate-page-properties.test.ts` and confirm type-specific cases go red. Revert, confirm green.
- Swap the `cap === 0` bypass with `cap > 0` bypass. Run cap-path tests, confirm the 0-means-unlimited test goes red. Revert, confirm green.
- Document both swaps and their outputs in the builder handoff.

---

## 6. Test plan

### 6.1 Unit tests

`tests/paginate-property-value.test.ts` (NEW).

Mocks return the complete paginated property from `pages.properties.retrieve` starting at the beginning. The endpoint does not know about the truncated 25-item view that `pages.retrieve` returned; callers must simulate the real endpoint behavior.

- Relation 27 items in one page (`has_more: false`): one call, 27 returned.
- Relation 150 items with default cap 75 (two pages of 75 each, `has_more: true` then `false`): stops after first page at cap, returns 75, `truncatedAtCap: true`.
- Relation 150 items with `cap: 0`: fetches both pages, returns 150.
- Title 30 items in one page.
- Rich_text exactly 25 items, `has_more: false` on first fetch (no extra call needed; but note the trigger that called this helper was `length === 25` in the walker; the helper itself does not care about the trigger, it just fetches).
- Cap 0 unlimited across a 300-item relation (three pages): all 300 returned.
- Runaway-loop guard: mock returns `has_more: true` with zero items and no cursor advance; helper throws.
- SDK returns malformed shape (missing `results` field): helper throws a descriptive error.

`tests/paginate-page-properties.test.ts` (NEW).

- Page with one truncated relation (length 25): paginates, shallow-clone returned, input not mutated.
- Page with relation of 10 items (below trigger): skipped, no call made.
- Page with `multi_select` of 25 items: not in type gate, no pagination, no call.
- Page with three truncated properties (relation, people, title, all at 25 in input, all 200+ in full): all three paginated; cap 75 hits on all three; warnings array has three entries.
- Page with `onlyTypes: ["title"]`: only title paginated even when relation and people are also at 25.
- Page with zero properties hitting the trigger: no warnings, no calls.
- Immutability check: input page identity preserved; output page is a distinct shallow clone.

### 6.2 In-memory MCP integration tests

`tests/query-database-pagination.test.ts` (NEW; related patterns in `tests/property-roundtrip.test.ts`).

Mocks. `dataSources.query` returns one page with `properties.Ref` as a 25-element relation array (simulating Notion's silent truncation). `pages.properties.retrieve` returns the full property from the beginning (not "the remaining" items).

- 30-item relation under default cap: `result.results[0].Ref.length === 30`, `result.warnings` undefined.
- 200-item relation, default cap 75: `result.results[0].Ref.length === 75`, `result.warnings[0].code === "truncated_properties"`, `properties[0] === { name: "Ref", type: "relation", returned_count: 75, cap: 75 }`, `result.warnings[0].how_to_fetch_all` is a non-empty string.
- `max_property_items: 0`: 300-item relation fetches fully, no warning.
- `max_property_items: 25`: fetches 25 (mock returns first 25 with `has_more: true`), emits warning with `cap: 25`.
- Negative `max_property_items`: tool returns validation error, no Notion call made.
- Response shape: assert wrapped `{ results, warnings? }` (breaking change assertion).

`tests/read-page-title-pagination.test.ts` (NEW).

- Mock `pages.retrieve` to return a title with 25 rich_text segments (truncated; `has_more` is NOT exposed on the page-retrieve shape). Mock `pages.properties.retrieve` to return a full list of 30 title-item entries. Assert `response.title` includes the concatenated `plain_text` of all 30 segments.
- Mock truncated title with 200 full items and default cap 75: assert `response.warnings` includes `{ code: "truncated_properties", properties: [{ name, type: "title", returned_count: 75, cap: 75 }], how_to_fetch_all: <non-empty string> }`.
- Mock page with title under 25 rich_text segments: no extra API call, no warnings (regression guard).
- Mock page with a truncated title AND a truncated relation: assert only ONE call to `pages.properties.retrieve` (for title); the relation is NOT paginated because `onlyTypes: ["title"]` gates it in `read_page`.

### 6.3 Live e2e tests

REQUIRED per brief: live integration test against a Notion relation with more than 25 entries. See Phase P6.

Additional optional live probes.

- A page with 30 title rich_text segments. Real-world this is rare; if the workspace lacks such a page, skip. Not blocking.

### 6.4 Regression and non-regression surface

- Today's test count at the start of PR2: verify via `npm test -- --run`. PR1 plan referenced 1172 tests across 78 files; PR1 itself added tests. Verify with `npm test` at the start of the builder session and record the baseline.
- All PR1-era property-type decoding tests (`tests/simplify-property.test.ts`, `tests/schema-to-properties.test.ts`, `tests/convert-property-value.test.ts`, `tests/property-roundtrip.test.ts`) must stay green.
- `tests/e2e/live-mcp.test.ts` existing scenarios stay green, including the post-PR1 formula / relation / rollup probes (C1 through C5).
- `tests/update-data-source.test.ts` and `tests/relation-roundtrip.test.ts` unchanged.
- Target: >= baseline + new tests. Zero red, zero skipped-that-was-green.

### 6.5 Evidence required from the builder in the handoff

Per learnings `[e9dcf6]` (TDD) and `[5b1f50]` (dogfood via MCP), the handoff must include:

1. Two paste-level red test outputs from Phases P1 and P3 before implementation.
2. Green full test run output summary after each phase.
3. Full green on `npm test` and `npm run test:e2e` post-implementation. Last 30 lines of each.
4. A live MCP probe via `mcp__easy-notion-http__query_database` against a Notion relation of more than 25 entries, created live by the builder during verification. Screenshot or JSON paste of the tool response showing the full 27 items.
5. A second live MCP probe showing `truncated_properties` warning firing with an 85-item relation at cap 75, including the `how_to_fetch_all` hint string in the captured response.
6. Mutation hand-check outputs from Phase P7.
7. Cleanup: confirm any test databases are archived or land in the sandbox subtree.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking change to `query_database` response shape surprises downstream users | medium | medium | CHANGELOG under Breaking changes, version bump to `v0.5.0`, tool description notes the wrap shape. Migration is one line for most callers. Internal: update every existing call site in `tests/e2e/live-mcp.test.ts` (at least `:500`, `:626`, `:670`) that destructures as an array; expect around 10 to 20 call sites to migrate. |
| Per-result API-call amplification on large result sets plus rate-limit exposure | medium | medium | Cap at 75 per property limits cost. 100 pages with one truncated relation each means 100 extra calls. Notion rate limit is 3 req/sec average, 9 req/sec burst. The builder should expect occasional 429 responses on large result sets and rely on the SDK's retry behavior (or add explicit backoff if the SDK does not retry). Flag `notion-query-pagination-concurrency` for parallelization if users report slowness; keep serial by default to avoid stampeding the rate limit. |
| Rollup-array deferred but may still appear in live query results with `type: "array"` | low | medium | Deferred per §2.2; walker skips rollup entirely. If a user hits this (relation truncation via a rollup array), they get the current behavior (25 items silently). The follow-up task triggers on that specific user report. |
| `has_more: false` returned on a true exactly-25 property still incurs one extra API call per page | low | low | Acceptable cost for the safety heuristic. Measure in live e2e; if cost is material, consider caching the "definitely not truncated" signal per page_id + property_id during a single `query_database` call. Follow-up if needed. |
| Test mocks model `pages.properties.retrieve` incorrectly (returning only "remaining" items instead of the full list from the beginning) | medium | high | P1-P4 test descriptions in §5.5 and §6 all mandate "mock the full property from the beginning". Codex pressure-test flagged this; it is now the canonical test pattern. Builder must resist the intuitive "append the tail" mocking approach. |
| `read_page` without `onlyTypes` would paginate unsurfaced relation / people on database entry pages, triggering spurious warnings and extra API calls | medium | medium | Handler passes `onlyTypes: ["title"]` (§5.4). Tested in P4 via "no extra call for the relation" assertion. |
| `max_property_items: 0` truly unlimited could pull a 10k-item relation and wedge context | low | high | Documented in the tool description as the caller's explicit escape hatch. Default 75 protects the unaware caller. If a user opts in to unlimited and sees context wedging, the fix is on their side (lower their cap). The runaway-loop guard in §5.1 catches malformed API responses but does not cap legitimate large relations. |
| Warning code `truncated_properties` clashes with a future code | low | low | Naming scan of existing codes (currently only `omitted_block_types`). No clash. Codes are wire contract once shipped. |
| `paginatePageProperties` mutates the page object, interfering with downstream code that assumed immutability | low | low | Helper returns a shallow-cloned page with the `properties` map updated, not an in-place mutation. Unit-tested. |
| Title pagination in `read_page` triggers on pages that happen to have exactly 25 title segments (very rare in practice) | very low | very low | One extra API call on false positive. Same as §4.1 rationale. |
| Response-shape change breaks existing in-memory MCP consumers in the test suite | low | low | Tests are in our tree; the breaking-change migration updates the test call sites along with the feature. No external consumer will ship v0.5.0 unnoticed because it is a minor bump. |
| Pagination helper is called inside `queryDatabase` and accidentally tries to re-paginate pages that came back from `dataSources.query` with a shorter-than-25 array | low | low | Type-gate and length-gate checks in `paginatePageProperties` are idempotent. No-op on non-truncated pages. |
| Live e2e flakes on the 27-entry relation setup (creating 27 rows is slow) | medium | low | Use the existing sandbox teardown pattern. 27 entries at 3 req/sec = 9 seconds. Set test timeout to 60 seconds. Not flaky in principle. |
| Tool description length conflicts with CLAUDE.md "honest positioning" / "measured tone" | low | low | Word-smith the description to CLAUDE.md standard during the builder session. Reference PR1's tool description expansions as the style precedent. |
| Notion-Version 2025-09-03 pin excludes a field used by the new endpoint | low | low | `pages.properties.retrieve` has been stable since well before 2025-09-03. Verified in docs (§3.1 citation). No version-pin impact. |

---

## 8. Open questions for James (decisions pending)

Each has a default; accept by silence, or override.

1. **One PR or split?** Default: one PR. Estimated 500-700 LOC (see §9 for the scope-leak caveat around `query_database` test migration). Split-risk is low; the breaking-change wrap and the pagination helper are naturally coupled (warnings need a surface, pagination generates warnings).
2. **Cap default 75?** Default: 75. Override to 50 (tighter for LLM context), 150 (looser for workflow coverage), or make it configurable per tool.
3. **Response-shape change scope?** Default: wrap only `query_database`. `read_page` already has an object shape, so no wrap there. Override to also wrap `search` or `list_pages` for consistency, but that bloats the PR.
4. **Version bump to `v0.5.0`?** Default: yes. Breaking change in `query_database` response warrants a minor bump under 1.x.
5. **Rollup-array pagination: defer to follow-up, or attempt live-verify in PR2?** Default: defer (§2.2). SDK types under-specify the per-item shape; live verification would need a real workspace with a paginated rollup array, which pushes P6 beyond one focused session. Override only if the builder already has a workspace with paginated rollup data and can verify shape cheaply.
6. **Pagination-failure behavior?** Default: propagate the error (the whole `query_database` or `read_page` call fails). Override to soft-fail (emit a different warning code `property_pagination_error` and return the truncated array unchanged) if we decide partial data is better than no data. Soft-fail is harder to reason about; recommend propagating.
7. **Warning detail includes `property_id` alongside `name`?** Default: no, `name` is what callers see elsewhere in the tool contract. Override if debugging aid outweighs payload size. Easy to add later, hard to remove once shipped.
8. **Tool description length?** Default: terse, about two paragraphs added to each of the two tools. Match PR1's style.

Non-questions (implementation details for the builder, not PM decisions):

- Whether to parallelize per-property pagination inside a page (default serial; a page rarely has more than 2 to 3 truncatable properties).
- Whether to parallelize per-row pagination across `query_database` results (default serial; follow-up `notion-query-pagination-concurrency` filed for when users complain).

---

## 9. Budget estimate

Builder time. Honest, not padded. Per learning `[0186bc]`, wall-clock routinely runs 10 to 40 times under this estimate when the planner has pre-thought the design. Treat these as ceilings.

| Step | Work | Time |
|---|---|---|
| P1 | Red and green for `paginatePropertyValue` helper | 0.5 day |
| P2 | Red and green for `paginatePageProperties` helper | 0.5 day |
| P3 | Red and green for `query_database` integration | 0.5 day |
| P4 | Red and green for `read_page` integration | 0.25 day |
| P5 | Tool descriptions, input schemas, type updates | 0.25 day |
| P6 | Live e2e test (relation > 25 plus relation > 85 for cap) | 0.75 day |
| P7 | Mutation hand-checks | 0.25 day |
| Migration | Update existing `tests/e2e/live-mcp.test.ts` call sites for the `query_database` response wrap (around 10 to 20 sites across `:500`, `:626`, `:670`, and peers) | 0.25 day |
| Misc | Buffer for Notion quirks, CHANGELOG | 0.25 day |
| **Total** | | **~3.5 dev-days** |

Wall-clock prediction per `[0186bc]`: 3 to 8 hours single-session. Under the 6-hour PR ceiling except at the high end. Primary risk factors for the high end: (a) live e2e P6 wall-clock from creating 112 rows total across the two tests (27 plus 85), (b) migrating a larger-than-expected number of test call sites for the response wrap. If the high end is hit, the natural split line is "ship the four simple types in one PR, defer the e2e cap-warning probe to a follow-up PR2.5" rather than splitting the feature itself.

Diff prediction: 500 to 800 LOC including tests. Breakdown (rough):

- Helpers in `notion-client.ts`: ~120 LOC production.
- `server.ts` handler changes: ~40 LOC.
- Tool descriptions and input schemas: ~30 LOC.
- New unit tests (P1, P2): ~180 LOC.
- New integration tests (P3, P4): ~150 LOC.
- Live e2e test: ~80 LOC.
- Test migration (response wrap): ~50 LOC.
- CHANGELOG: ~20 LOC.

Target under the 800-line ceiling. If the migration surfaces more sites than expected (search the repo for `rows = await callTool` patterns before committing to the estimate), re-scope during the builder session.

---

## 10. Deferred decisions (tasuku follow-ups to file BEFORE builder dispatch)

Per feedback `capture_deferred_decisions`, every out-of-scope item below becomes a backlog-priority tasuku task with a triggering condition. File at plan-approval time, not after builder dispatch.

| Deferred item | Canonical task name | Triggering condition |
|---|---|---|
| Title pagination for `duplicate_page`, `update_page`, `search` | `notion-page-title-pagination-secondary-sites` | A user reports a truncated page title from any of those three tools. |
| Surfacing properties in `read_page` output | `read-page-surface-properties` | A user asks for property access on non-database pages via `read_page`. |
| Per-row parallelization in `query_database` pagination | `notion-query-pagination-concurrency` | A user reports `query_database` slowness on a result set with many truncated properties. |
| Resumable pagination cursor exposed to caller | `notion-property-pagination-cursor` | A user asks for "give me the next 100 items from this relation" style access. |
| Rollup.array pagination if shape lands differently | `notion-rollup-array-pagination-shape-followup` | Phase P6 live verification finds the rollup-array per-item shape mismatches the planned rehydrator. |
| `notion-query-read-warnings` (previously deferred from PR1) | RESOLVED by PR2 | Closed by the `query_database` response wrap. Tasuku task should be marked done when PR2 merges. |

Existing tasuku tasks NOT re-filed; verify still present before dispatch:

- `notion-query-read-warnings` (mark as resolved on merge).
- `mcp-surface-notion-error-code` (unchanged, unrelated).
- `notion-atomic-edit-update-block` (PR3, unchanged).

---

## 11. `.meta/` screening

Per CLAUDE.md lines 15-24, run the four-item screen before committing this plan.

1. **Third parties by name or specific role?** No.
2. **Business, financial, or client information?** No.
3. **Credentials or secrets?** No.
4. **Tone you would not want cited back in six months?** No. The plan is neutral, decision-focused, and documents tradeoffs honestly.

Public-default OK. No separate `.meta/handoffs-private/` path needed.

James or the orchestrator commits after screening. The planner does not commit.

---

## 12. Codex pressure-test

Session name: `plan-review-pr2-long-property-pagination`.
Timeout: 5 minutes.
Reasoning effort: high.
Run after this draft lands, before commit. See §13 for results.

Questions for Codex.

1. Verify the five paginated property types and their per-item shapes in `node_modules/@notionhq/client/build/src/api-endpoints.d.ts`. Is the rehydration detail in §5.3 correct?
2. Is the "length exactly 25" heuristic sound? Is there a more direct signal from Notion I missed?
3. Is the cap-default of 100 reasonable given LLM context budgets? Is `max_property_items: 0` the right escape-hatch idiom?
4. Is the `query_database` response wrap the right move, or would inline warnings per result be less disruptive?
5. Is the warning code `truncated_properties` consistent with the existing `omitted_block_types` convention?
6. Is the one-PR scope defensible, or should I split off rollup.array pagination as a follow-up?
7. Risks in §7 and open questions in §8: anything missing or wrong?
8. Call graph in §3.2: is any current code path missing?

---

## 13. Codex review result

Session. An initial `plan-review-pr2-long-property-pagination` session hit the 5-minute budget and its rollout was not recoverable (same failure mode PR1 noted at its §18). The successful review ran under session `plan-review-pr2-v2` at `reasoningEffort: high` with a 15-minute budget; used around 4.5 minutes.

Summary. Codex validated the four paginated property-item shapes in §5.3 against `api-endpoints.d.ts`, flagged the rollup-array shape risk and the test-mock correctness as the highest-signal concerns, and surfaced several seam and cap-semantics inconsistencies. One critical issue, five medium issues, and two nits. All accepted and applied to this draft.

Critical issue (accepted and applied).

1. **Test mocks modeled `pages.properties.retrieve` incorrectly.** The plan's Phase P3, P4, and §6.2 tests described mocks that "return the remaining 5 items" after `pages.retrieve` truncated at 25. That is wrong: `pages.properties.retrieve` does not know about the 25-item truncation; it always starts from the beginning of the property unless a `start_cursor` is passed. Mocks must return the FULL property list from the beginning. Applied: §5.5 Phase P1, P3, P4, §6.1, §6.2 all rewritten to specify full-list mocks. Also fixed the "exactly 100 with cap 100" case (not a truncation if `has_more: false`).

Medium issues (accepted and applied).

2. **Rollup-array pagination had insufficient SDK shape evidence to ship without live-verify.** The list wrapper types the inner `rollup.array` as `Array<EmptyObject>` (`api-endpoints.d.ts:2063, 2073-2075`), leaving the per-item rehydration under-specified. P6 in the original draft did not include a rollup live probe, so the live-verify requirement had no owner. Applied: rollup-array explicitly deferred to follow-up `notion-rollup-array-pagination` (§2.2 and §8 question 5); the four well-specified types ship in PR2. Walker type gate narrowed to `{ title, rich_text, relation, people }` throughout.
3. **Cap semantics contradicted the safety ceiling.** Original draft said `max_property_items: 0` means unlimited, then imposed a 50-round-trip safety ceiling, then reported `cap: 5000` in the warning when the ceiling fired. Applied: removed the fixed ceiling entirely; `0` means genuinely unlimited (loop until Notion says `has_more: false`). Replaced the ceiling with a progress-invariant runaway guard that throws on "`has_more: true` but zero results or stalled cursor" (§5.1). Added risk row for "user opts into unlimited, pulls a 10k-item relation, wedges context" as a documented trade.
4. **`read_page` integration would paginate unsurfaced properties.** Original draft called `paginatePageProperties` from `read_page` without restriction, which would have paginated truncated relation / people properties on database entry pages and emitted warnings for data the tool never returns. Applied: added an `onlyTypes` option to the walker (§5.2), `read_page` passes `onlyTypes: ["title"]` (§5.4), P4 test asserts the relation is NOT paginated in the `read_page` path.
5. **Export surface mis-stated.** Original §5.4 said "no change to existing exports" but `src/server.ts` imports named exports from `notion-client.ts` (`:14-44`). Applied: `paginatePageProperties` and `PaginationOpts` are explicitly exported; `paginatePropertyValue` stays module-private (or `@internal`-annotated if tests need it).
6. **Scope leak on `query_database` response-wrap migration.** `tests/e2e/live-mcp.test.ts` has multiple call sites (at least `:500`, `:626`, `:670`) that destructure the response as an array. Applied: effort estimate in §9 gained a 0.25-day "Migration" line; LOC prediction band widened to 500-800; §7 risk row updated to name the migration concretely.

Nits (accepted and applied).

7. **People type precision in §5.3.** Original draft wrote `Array<User>`; SDK uses `PartialUserObjectResponse | UserObjectResponse`. Applied.
8. **Missed call graph site.** `findWorkspacePages` surfaces page titles in the missing-parent error suggestion (`src/server.ts:1067`). Not user-visible in the happy case. Applied: noted as out-of-scope in §2.2.

Codex findings not applied.

- None. Every raised issue was either applied or explicitly documented as a deferred trade-off.


---

## 14. References

- Audit: `.meta/audits/notion-api-gap-audit-2026-04-20.md` (§1.2 finding 2; §3.2 row `pages.properties.retrieve`; §6 "PR 2").
- PR1 plan (template and prior sequencing): `.meta/plans/notion-property-type-gap-2026-04-21.md`.
- SDK surface: `node_modules/@notionhq/client/build/src/Client.d.ts:210-215` (method), `api-endpoints.d.ts:2038-2092` (list response), `:2141-2148` (relation item), `:1885-1890` (people item), `:2536-2541` (title item), `:2171-2176` (rich_text item), `:2217-2240` (rollup item).
- Notion docs (WebFetch 2026-04-23): `developers.notion.com/reference/retrieve-a-page-property`. Confirmed 25-item truncation on `pages.retrieve`; list-paginated types are title, rich_text, relation, people, plus rollup with aggregations.
- CLAUDE.md key decision on `warnings` contract: lines 132-136.
- CLAUDE.md `.meta/` screening protocol: lines 15-24.
- Tasuku decision `post-v030-phase-sequence`.
- Tasuku task `notion-long-property-pagination` (high priority).
- Prior deferred task `notion-query-read-warnings` (closed by this PR's response wrap).
- Learnings cited: `[e9dcf6]` (TDD), `[5b1f50]` (dogfood via MCP), `[0186bc]` (plan estimates run 10-40x under actual), `[4eda40]` (orchestrator must dispatch, not inline-code).

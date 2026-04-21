# Test-Gap Frame 1: Silent-Failure Hunter

**Date:** 2026-04-20
**Scope:** Every code path in easy-notion-mcp that can produce silent drops, null-conversions, truncations, or "succeed with data loss."
**Method:** Structural sweep of `src/server.ts`, `src/notion-client.ts`, `src/markdown-to-blocks.ts`, `src/blocks-to-markdown.ts`, `src/file-upload.ts` + cross-reference against the gap audit and existing test suite.

---

## TL;DR

1. **`simplifyProperty` default returns `null`** (`src/server.ts:86-88`) — 10 property types silently become `null` on every read. No warning emitted; caller sees `null` and can't distinguish "empty" from "unsupported."
2. **`schemaToProperties` default:break** (`src/notion-client.ts:183-184`) — 10+ property types silently dropped on `create_database`. Response echoes the already-filtered list, reinforcing the lie.
3. **Page properties >25 items silently truncated** — `simplifyEntry` (`src/server.ts:91-97`) passes through Notion's 25-item cap without checking `has_more` or calling `pages.properties.retrieve`.
4. **`date` write drops `end` and `time_zone`** (`src/notion-client.ts:212`) — date-range entries silently become point-in-time. No error, no warning.
5. **`normalizeBlock` returns `null` for malformed images** (`src/server.ts:278-279`) — the block vanishes without appearing in `omitted_block_types` warnings (it's a "supported" type that silently fails).
6. **`blocksToMarkdown` renderBlock default returns `""`** (`src/blocks-to-markdown.ts:225-226`) — if a `NotionBlock` somehow has an unhandled type, it silently vanishes from markdown output.
7. **`queryDatabase` has no cap/warning for the 10k-row limit** (`src/notion-client.ts:549-573`) — accumulates until Notion stops returning, with no `request_status: "incomplete"` surface.
8. **`find_replace` reports `success: true` with no match count** (`src/server.ts:1142-1145`) — if the find string doesn't exist, the tool still returns success.

---

## Inventory

### S1. `simplifyProperty` default → null (property read path)

- **File:line:** `src/server.ts:86-88`
- **Failure mode:** Property types `formula`, `rollup`, `files`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `verification`, `place`, `button` all return `null`. The caller (via `query_database`, `read_page` metadata) sees `{"Formula Column": null}` and has no way to know whether the value is genuinely empty or unsupported.
- **Proposed test:** Unit test: call `simplifyProperty({ type: "formula", formula: { type: "number", number: 42 } })` and assert it returns `null` (documenting current behavior) — then, once fixed, assert it returns `42`. Same for each polymorphic formula result type (string, boolean, date) and for rollup, files, created_time, etc.
- **Existing-test gap:** `tests/relation-property.test.ts` tests `simplifyProperty` for `relation` type only. No test exercises the default branch or any of the 10 unsupported types. `tests/database-write-strictness.test.ts` tests the *write* path throws, but never the *read* path's silent null.
- **Pattern:** *Allowlist-with-silent-default* (same pattern as S2).

### S2. `schemaToProperties` default:break (schema creation path)

- **File:line:** `src/notion-client.ts:183-184`
- **Failure mode:** `formula`, `rollup`, `relation`, `people`, `files`, `unique_id`, `verification`, `place`, `button`, and any future type silently dropped. The property is absent from the API call; Notion creates the database without it; the response at `src/server.ts:1316-1321` echoes `Object.keys(schemaToProperties(schema))` — so the caller sees a properties list that *confirms* the drop as intentional.
- **Proposed test:** Unit test: `schemaToProperties([{ name: "Score", type: "formula" }])` → assert returns `{}`. Integration test: call `create_database` with schema containing a `formula` property, assert response `.properties` does NOT include it (current behavior), and that no warning is emitted — then flip the assertion once the fix lands.
- **Existing-test gap:** `tests/create-database-response.test.ts` tests G4c-1 (people dropped) and G4c-3 (unknown type dropped), but asserts this is *correct* behavior. It does not flag the absence of a warning. No test checks that the Notion API call body actually omits the property.
- **Pattern:** *Allowlist-with-silent-default* (structural analogue of S1).

### S3. Property truncation at 25 items (page property read)

- **File:line:** `src/server.ts:91-97` (simplifyEntry), feeds into `query_database` at `:1377` and `read_page` metadata
- **Failure mode:** Notion's `pages.retrieve` caps multi-value properties (title, rich_text, relation, people, rollup) at 25 items. Full values require `pages.properties.retrieve` (paginated). We never call it. A database entry with 30 relation links silently returns only 25.
- **Proposed test:** Integration test with mock: mock `pages.retrieve` to return a relation array of 30 items, assert `simplifyEntry` returns all 30. Currently it would return the first 25 (whatever Notion gives). The unit-level test would need to mock the truncated API shape and assert the response includes a warning or the full list.
- **Existing-test gap:** `tests/relation-property.test.ts` only tests with small arrays (2 items). No test exercises the boundary.
- **Pattern:** *Pagination-unaware read* (structural analogue of S7).

### S4. Date write drops `end` and `time_zone`

- **File:line:** `src/notion-client.ts:212`
- **Failure mode:** `convertPropertyValue("date", ...)` produces `{ date: { start: String(value) } }`. If the user passes a date range object `{ start: "2026-01-01", end: "2026-01-31" }`, it gets `String()`'d to `"[object Object]"`. If they pass a string, `end` and `time_zone` are never set. This is a "succeed with garbage data" path.
- **Proposed test:** Unit test: `convertPropertyValue("date", "Due", { start: "2026-01-01", end: "2026-01-31" })` — assert the output. Currently it would produce `{ date: { start: "[object Object]" } }`, which is silent corruption.
- **Existing-test gap:** No test for date property conversion exists anywhere in the test suite.
- **Pattern:** *Lossy type coercion* — `String(value)` applied blindly to a potentially-structured input.

### S5. `normalizeBlock` returns null for malformed images (supported-type silent drop)

- **File:line:** `src/server.ts:273-279`
- **Failure mode:** An image block with no URL (e.g., `{ type: "image", image: {} }`) returns `null` from `normalizeBlock`. But `image` is in `SUPPORTED_BLOCK_TYPES`, so the `fetchBlocksRecursive` check at `src/server.ts:355` (`!SUPPORTED_BLOCK_TYPES.has(raw.type)`) evaluates false — the block is not added to `ctx.omitted`. The image silently vanishes from the output with no warning.
- **Proposed test:** Integration test: provide a page with a malformed image block (`{ type: "image", image: {} }`). Assert that either (a) the block appears in warnings, or (b) the markdown includes a placeholder. Current behavior: block disappears silently.
- **Existing-test gap:** `tests/block-warnings.test.ts` G3b-8 explicitly tests this case and **documents the silent drop as correct** — the assertion is `warnings EXCLUDE the malformed image`. The test validates the bug rather than catching it.
- **Pattern:** *Supported-type-that-can-still-fail* — the SUPPORTED_BLOCK_TYPES allowlist and normalizeBlock's null return are not in sync. Same pattern applies to `file`/`audio`/`video` blocks whose URL extraction falls through to empty string (S6).

### S6. File/audio/video blocks with `file_upload` type produce empty URLs

- **File:line:** `src/server.ts:291-303` (file, audio, video cases in `normalizeBlock`)
- **Failure mode:** For `file`-type internal uploads (type `"file"` with `.file.url`), the URL is extracted correctly. But for `file_upload` type (the new upload format), none of the three ternary branches match — `url` falls through to `""`. The block is emitted with `external: { url: "" }`, which `blocksToMarkdown` renders as `[file]()` or `![]()`  — a link to nowhere.
- **Proposed test:** Unit test: call `normalizeBlock({ type: "file", file: { type: "file_upload", file_upload: { id: "up-1" } } })` — assert URL is not empty string. Currently returns `{ file: { type: "external", external: { url: "" }, name: "file" } }`.
- **Existing-test gap:** No test for `file_upload`-type blocks exists.
- **Pattern:** *Incomplete ternary dispatch* (same shape as the `image` case, but produces garbage instead of null).

### S7. `queryDatabase` doesn't surface the 10k-row cap

- **File:line:** `src/notion-client.ts:549-573`
- **Failure mode:** The pagination loop accumulates via `start_cursor` until `has_more` is false. But per Notion's ~April 2026 change, queries that exceed 10,000 rows return `request_status: "incomplete"` with `has_more: false`. Our loop would stop, and the caller would see a truncated dataset with no indicator. The audit called this out at `.meta/audits/notion-api-gap-audit-2026-04-20.md:142`.
- **Proposed test:** Integration test: mock `dataSources.query` to return `{ results: [...], has_more: false, request_status: "incomplete" }`. Assert that the tool response includes a warning or truncation indicator. Currently: no warning, results silently capped.
- **Existing-test gap:** No query pagination tests exist.
- **Pattern:** *Pagination-unaware read* (structural analogue of S3).

### S8. `find_replace` reports success even on zero matches

- **File:line:** `src/server.ts:1131-1145`
- **Failure mode:** The tool calls `pages.updateMarkdown` with `update_content`, then returns `{ success: true }`. Notion's response may indicate that no replacements occurred (or the `old_str` wasn't found), but we don't check. A caller told "success: true" would assume the edit landed.
- **Proposed test:** Integration test: mock `pages.updateMarkdown` to return a result with no matches. Assert the tool response indicates no replacements were made (e.g., a `matches: 0` field or an error).
- **Existing-test gap:** No test for `find_replace` exists in the test suite.
- **Pattern:** *Success-without-verification* — the tool trusts the API call's completion as proof of effect.

### S9. `create_database` response masks the silent drop

- **File:line:** `src/server.ts:1316-1321`
- **Failure mode:** The response builds `properties: Object.keys(schemaToProperties(schema))` — this is derived from the *filtered* schema, not from what Notion actually created. If `schemaToProperties` dropped a column, the response also drops it. The caller never sees a discrepancy. The comment at `:1309-1315` explains *why* this approach was chosen (API 2025-09-03 doesn't populate `result.properties`), but the effect is that the response *confirms* data loss instead of flagging it.
- **Proposed test:** Integration test: request a schema with `[{ name: "T", type: "title" }, { name: "F", type: "formula" }]`. Assert that the response either (a) includes a warning listing dropped properties, or (b) that `properties` includes "F" (once the fix lands). Currently: `properties: ["T"]` with no warning.
- **Existing-test gap:** `tests/create-database-response.test.ts` G4c-1 asserts `properties` does NOT contain "Owner" — validating the silent drop as correct.
- **Pattern:** *Response mirrors internal filter, not API reality*.

### S10. `attachChildren` default:break (children silently not attached)

- **File:line:** `src/server.ts:339-341`
- **Failure mode:** If a block type has `has_children: true` but isn't in the `attachChildren` switch (`paragraph`, `callout`, `quote`, `to_do`, `code`, `equation`, etc.), the recursive children are fetched but then discarded. Example: a `callout` block with nested content — children are fetched at `:361-366` but `attachChildren` silently breaks.
- **Proposed test:** Unit test: create a callout block with `has_children: true`, provide child blocks in the mock tree. Assert that the callout's rendered markdown includes the children. Currently: children are silently dropped.
- **Existing-test gap:** `tests/block-warnings.test.ts` G3b-4 tests recursion through `paragraph` (which *is* in `attachChildren` — wait, actually paragraph is NOT in the switch either). Let me verify — `attachChildren` handles: `bulleted_list_item`, `numbered_list_item`, `toggle`, `heading_1/2/3`, `table`, `column_list`, `column`. Paragraph, callout, quote, to_do, code, equation, bookmark, embed, image, file, audio, video — all silently drop children.
- **Pattern:** *Allowlist-with-silent-default* (same family as S1/S2).

### S11. `blocksToMarkdown` renderBlock default returns empty string

- **File:line:** `src/blocks-to-markdown.ts:225-226`
- **Failure mode:** If a `NotionBlock` has a type not handled by `renderBlock`, it returns `""`. Since `renderBlocks` skips empty strings (`if (!rendered) continue` at `:51-53`), the block silently vanishes from markdown output. This is technically a "can't happen" path (normalizeBlock filters first), but if the two switches drift, blocks would vanish without any signal.
- **Proposed test:** Unit test: call `blocksToMarkdown([{ type: "hypothetical_new_type" as any, hypothetical_new_type: {} }])` — assert output is empty string. This serves as a regression canary: if someone adds a type to `normalizeBlock` but forgets `renderBlock`, this test would need updating.
- **Existing-test gap:** No test for the default branch. The drift risk is partially covered by `tests/roundtrip.test.ts` but only for currently-supported types.
- **Pattern:** *Parallel-switch drift risk* — three switches (`normalizeBlock`, `attachChildren`, `renderBlock`) must stay in sync.

### S12. `searchNotion` accumulates all results with no cap

- **File:line:** `src/notion-client.ts:473-501`
- **Failure mode:** The `search` and `list_databases` tools paginate through ALL results. For a large workspace, this could return thousands of entries with no limit or warning. The MCP response becomes enormous, potentially exceeding client token limits.
- **Proposed test:** Integration test: mock `client.search` to return 3 pages of 100 results each. Assert that the result count is 300 (documenting current behavior). Optionally assert a cap or warning on large result sets.
- **Existing-test gap:** No pagination test for search exists.
- **Pattern:** *Unbounded accumulation* (structural analogue of S7).

### S13. `list_databases` maps wrong ID field

- **File:line:** `src/server.ts:1354-1359`
- **Failure mode:** `list_databases` uses `r.parent?.database_id ?? r.id`. Under API 2025-09-03, `search` with `value: "data_source"` returns data source objects, not database objects. A data source's `parent` structure may not have `database_id` in the expected location. The fallback `r.id` would return the data source ID, not the database ID — which then fails when passed to tools expecting a database ID.
- **Proposed test:** Integration test: mock `client.search` to return a data source object with the 2025-09-03 parent shape. Assert that `list_databases` returns the correct database ID. Currently: may return data source ID silently.
- **Existing-test gap:** `tests/list-databases.test.ts` exists but would need to be checked for this specific case.
- **Pattern:** *Stale API shape assumption*.

### S14. `getDatabase` only surfaces options for select/multi_select/status

- **File:line:** `src/notion-client.ts:113-123`
- **Failure mode:** `getDatabase` maps properties to `{ name, type }` tuples. For select/multi_select/status it adds `options`. For all other types (number with format, relation with target database, formula with expression, rollup with config), the type-specific configuration is silently dropped. A caller using `get_database` to understand the schema never sees formula expressions, relation targets, number formats, or rollup configurations.
- **Proposed test:** Unit test: mock a schema with `{ Calc: { type: "formula", formula: { expression: "prop(\"A\") + 1" } } }`. Assert `getDatabase` returns the expression. Currently: returns `{ name: "Calc", type: "formula" }` only.
- **Existing-test gap:** No test for `getDatabase` output shape exists.
- **Pattern:** *Selective serialization* — the function decides what's "important" without flagging what's dropped.

### S15. `buildTextFilter` silently returns `undefined` for no-text-property databases

- **File:line:** `src/notion-client.ts:140`
- **Failure mode:** If a database has no text-type properties, `buildTextFilter` returns `undefined`. In `query_database` at `src/server.ts:1370-1374`, `effectiveFilter` stays as whatever `filter` was passed (potentially `undefined`). The `text` parameter is silently ignored — the query returns all rows instead of an empty set or error.
- **Proposed test:** Integration test: call `query_database` with `text: "hello"` on a database with only checkbox/number properties. Assert behavior: currently returns all rows silently.
- **Existing-test gap:** No test for `buildTextFilter` or `text` parameter behavior.
- **Pattern:** *Silently ignored parameter*.

---

## Structural-Pattern Notes

### Pattern families identified

1. **Allowlist-with-silent-default** (S1, S2, S10, S11): A `switch` or `if` chain handles known types and silently drops/nullifies everything else. This is the most pervasive pattern — it appears in property reads (S1), property schema writes (S2), child attachment (S10), and markdown rendering (S11). **Code-review heuristic:** Every `default: break`, `default: return null`, and `default: return ""` in a type-dispatch switch should either throw, emit a warning, or be explicitly documented as intentional with a test that pins the behavior.

2. **Pagination-unaware read** (S3, S7, S12): The code calls a paginated API but doesn't check for or surface truncation indicators (`has_more` on sub-properties, `request_status` on queries, unbounded accumulation on search). **Code-review heuristic:** Every pagination loop should have a corresponding "what happens when the data exceeds our read?" test.

3. **Lossy type coercion** (S4): `String(value)` applied to potentially-structured input. Any `convertPropertyValue` branch that calls `String()` or `Number()` on its input should have a test with both primitive and object inputs.

4. **Success-without-verification** (S8, S9): Tools return `success: true` or echo derived data without verifying the API actually did what was requested. **Code-review heuristic:** Any tool response that reports success should include at least one field derived from the API response (not from the request).

5. **Parallel-switch drift risk** (S5, S6, S10, S11): Three or four switches must stay in sync (`SUPPORTED_BLOCK_TYPES`, `normalizeBlock`, `attachChildren`, `renderBlock`). Adding a type to one but not the others causes silent failures. **Code-review heuristic:** The existing G3b-11 test in `tests/block-warnings.test.ts` guards `SUPPORTED_BLOCK_TYPES` ↔ `normalizeBlock` drift. Equivalent guards are needed for `attachChildren` and `renderBlock`.

### Convergence note

S1 and S2 are the same pattern in opposite directions — S1 is the read-side allowlist, S2 is the write-side allowlist. Any fix to one should be paired with the corresponding fix to the other, or the asymmetry creates new confusion (e.g., a property type becomes readable but still can't be created).

S5 and S6 are the same pattern applied to different block types — `image` returns null (vanishes), `file`/`audio`/`video` return empty-URL blocks (corrupt). Both stem from incomplete ternary dispatch on `block.{type}.type`.

---

## Tests to Add (ranked)

### Tier 1 — High-value, low-effort unit tests

**T1. `simplifyProperty` exhaustive-type test** (addresses S1)
- Input: one fixture per unsupported property type (`formula` with all 4 result types, `rollup`, `files`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `verification`).
- Assert: current behavior returns `null` for each. Once fixed, assert correct extraction.
- Rationale: Pins the current silent-drop behavior so the fix PR has a green→green transition.

**T2. `schemaToProperties` dropped-type test** (addresses S2)
- Input: `[{ name: "T", type: "title" }, { name: "F", type: "formula" }, { name: "R", type: "relation" }]`
- Assert: output only contains `T`. `F` and `R` are absent.
- Rationale: Symmetric to T1 on the write side.

**T3. `convertPropertyValue` date-range coercion test** (addresses S4)
- Input: `convertPropertyValue("date", "Due", { start: "2026-01-01", end: "2026-01-31" })`
- Assert: current behavior produces `{ date: { start: "[object Object]" } }` (documenting the bug).
- Rationale: Makes the silent corruption visible and blocks regressions.

**T4. `normalizeBlock` file_upload-type blocks test** (addresses S6)
- Input: `{ type: "file", file: { type: "file_upload", file_upload: { id: "up-1" } } }` (same for audio, video)
- Assert: URL is not empty string; or block is explicitly flagged.
- Rationale: `file_upload` is the current upload format — every recently-uploaded file hits this path.

**T5. Malformed-image-missing-from-warnings test** (addresses S5)
- Input: page with `{ type: "image", image: {} }` as the only block.
- Assert: `omitted` list includes the block (or the response flags it). Currently: block silently vanishes.
- Rationale: The existing G3b-8 test documents this as correct; a new test should challenge that assumption.

### Tier 2 — Medium-effort integration tests

**T6. `create_database` silent-drop warning test** (addresses S2 + S9)
- Setup: call `create_database` with schema `[title, formula, people]`.
- Assert: response includes a `warnings` field listing `formula` and `people` as dropped.
- Rationale: The current response actively hides the drop. This is the #1 user-reported issue.

**T7. `find_replace` zero-match test** (addresses S8)
- Setup: mock `pages.updateMarkdown` to return a result indicating no matches.
- Assert: response distinguishes "0 replacements" from "success."
- Rationale: Silent no-ops are the hardest class of bugs for agent callers to detect.

**T8. `attachChildren` coverage-for-unsupported-parents test** (addresses S10)
- Setup: page with a `callout` block that has `has_children: true`, children are paragraph blocks.
- Assert: children appear in the markdown output (currently: they don't).
- Rationale: Callout and quote children are common in real Notion pages.

**T9. `buildTextFilter` no-text-properties test** (addresses S15)
- Setup: database with only `checkbox` and `number` properties.
- Call `query_database` with `text: "hello"`.
- Assert: the response either errors or includes a warning. Currently: text param silently ignored.
- Rationale: Prevents agents from believing their search worked when it didn't.

**T10. `getDatabase` property-config completeness test** (addresses S14)
- Setup: mock schema with formula, relation, number-with-format, rollup properties.
- Assert: `getDatabase` output includes formula expressions, relation targets, number formats.
- Rationale: This is the schema-introspection tool agents rely on for understanding databases.

### Tier 3 — Live-E2E or complex mock tests

**T11. Property truncation at 25 items** (addresses S3)
- Setup: real or mocked database entry with 30+ relation links.
- Assert: `query_database` or `read_page` returns all 30, not just 25.
- Rationale: Requires either a live workspace or careful mocking of the Notion pagination shape.

**T12. `queryDatabase` 10k-row cap detection** (addresses S7)
- Setup: mock `dataSources.query` to return `request_status: "incomplete"`.
- Assert: tool response includes a warning.
- Rationale: New Notion behavior (~April 2026); no existing test infrastructure for it.

**T13. `searchNotion` unbounded accumulation** (addresses S12)
- Setup: mock `client.search` to return many pages.
- Assert: response includes a count or cap warning above a threshold.
- Rationale: Lower priority — mostly affects large workspaces.

**T14. `list_databases` ID mapping under 2025-09-03 shapes** (addresses S13)
- Setup: mock search response with data_source parent shapes.
- Assert: returned IDs are database IDs, not data source IDs.
- Rationale: Prevents tools from receiving unusable IDs.

**T15. Parallel-switch drift guard for `attachChildren` and `renderBlock`** (addresses S11)
- Similar to the existing G3b-11 drift test for `SUPPORTED_BLOCK_TYPES ↔ normalizeBlock`.
- Assert: every type in `SUPPORTED_BLOCK_TYPES` that supports children has a corresponding `attachChildren` case. Every type in `SUPPORTED_BLOCK_TYPES` has a corresponding `renderBlock` case that produces non-empty output.
- Rationale: Extends the existing drift-detection pattern to the other two switches.

# Test-Gap Frame 5 — User-Journey Silent-Break Analysis

**Date:** 2026-04-20
**Scope:** Walk each tool as a realistic user; identify the smallest code mutation that silently breaks correctness while CI stays green.
**Tool count:** 28 tools registered in `src/server.ts:461–907` (the audit's "27" excluded `create_page_from_file` which is stdio-only; the spike's "28" included it).

---

## TL;DR

1. **`search`** — zero test coverage; response-mapping logic at `src/server.ts:1264–1271` could swap `type`/`title` fields or break the database-title path and nothing catches it.
2. **`list_pages`** — zero tests; the `child_page` filter at `src/server.ts:1278` could silently become `child_database` and return wrong results.
3. **`query_database`** — the `text` param builds a compound filter (`src/server.ts:1370–1375`); swapping `and`↔`or` would silently narrow/widen results with no test.
4. **`list_databases`** — the `r.parent?.database_id ?? r.id` fallback at `src/server.ts:1356` has a test for the mapper but no integration test; swapping the fallback order silently returns wrong IDs.
5. **`find_replace`** — zero tests; the handler constructs a raw `pages.updateMarkdown` payload (`src/server.ts:1131–1141`); changing `old_str` to `new_str` or dropping `replace_all_matches` would pass CI.
6. **`read_page`** — `max_blocks` limit logic at `src/server.ts:1160–1166` has coverage via block-warnings tests but no test asserts the `has_more` flag is correctly set or that unlimited reads return all blocks.
7. **`add_database_entries`** — batch partial-failure ordering is tested, but the `succeeded`/`failed` field swap at `src/server.ts:1411` is not asserted — swapping them would return errors in the success array.
8. **`simplifyProperty`** — the `unique_id` path at `src/server.ts:79–85` is untested; returning `number` without prefix when prefix exists would silently change IDs surfaced by `query_database`.

---

## Tool-by-Tool Inventory

### 1. `create_page` — Create a Notion page from markdown
**Handler:** `src/server.ts:990–1018`
**Existing coverage:** `parent-resolution.test.ts` (parent logic), `http-file-upload-gate.test.ts` (file:// gate), `create-page-from-file.test.ts` (transport filter)

Silent-break mutations:
- **Swap `page.id` ↔ `page.url` in response** (`:1010–1012`): returns URL as `id` field. No test asserts response shape of a successful create.
- **Drop `processFileUploads` call** (`:1005`): `file://` images silently become broken image blocks. The gate test only checks rejection in HTTP mode, not that the upload actually happens in stdio mode.
- **Return `parent_page_id` instead of `page.id`** (`:1010`): agent receives the parent ID, thinks it's the new page.

Missing tests: assert response `{id, title, url}` shape on happy-path create; assert `file://` image actually produces an uploaded block in stdio mode.

### 2. `create_page_from_file` — Create page from local .md file
**Handler:** `src/server.ts:1019–1050`
**Existing coverage:** `create-page-from-file.test.ts` (path validation, transport filter)

Silent-break mutations:
- **Skip `readMarkdownFile` and pass raw `file_path` as markdown** (`:1033`): creates a page with the file path as body text. Tests cover validation inside `readMarkdownFile` but no test asserts file *content* appears in the created page.
- **Omit `processFileUploads` (already omitted!)**: unlike `create_page`, this handler does NOT call `processFileUploads` (`:1035` uses `markdownToBlocks(markdown)` directly). If a `.md` file contains `file://` image refs, they won't upload. This may be intentional (the file is local markdown, not agent-constructed) but is undocumented.

Missing tests: assert page body matches file content; document/test the `file://` non-processing behavior.

### 3. `append_content` — Append markdown to existing page
**Handler:** `src/server.ts:1051–1056`
**Existing coverage:** `http-file-upload-gate.test.ts` (gate only — fires before handler logic)

Silent-break mutations:
- **Return `result.length` as `blocks_added: 0` (hardcode)** (`:1055`): agent sees "success, 0 blocks added" and may retry endlessly. No test checks the count.
- **Pass `page_id` to `markdownToBlocks` instead of `markdown`** (`:1054`): silently creates a paragraph block containing the page ID string.

Missing tests: happy-path assert that `blocks_added > 0` and content is retrievable via `read_page`.

### 4. `replace_content` — Delete all blocks, write new ones
**Handler:** `src/server.ts:1057–1069`
**Existing coverage:** `http-file-upload-gate.test.ts` (gate only), `destructive-edit-descriptions.test.ts` (description text only)

Silent-break mutations:
- **Skip the delete loop** (`:1061–1063`): blocks are appended but old blocks remain — page has duplicate content. Returns `deleted: 0` which looks odd but is still "success."
- **Swap `deleted` ↔ `appended` in response** (`:1066–1067`): agent sees inverted counts.

Missing tests: round-trip test — create page, replace content, read back, assert new content only.

### 5. `update_section` — Replace a heading section
**Handler:** `src/server.ts:1070–1122`
**Existing coverage:** `update-section.test.ts` (boundary logic unit test only — no MCP integration)

Silent-break mutations:
- **Change `headingLevel === 1` to `headingLevel === 3`** (`:1099`): H1 sections stop at H2/H3 instead of running to end, H3 sections swallow everything. The unit test covers `findSectionEnd` but not the integration that wires it to real block deletion.
- **Skip `afterBlockId` when `headingIndex > 0`** (`:1106`): new blocks always append at page end instead of in-place. No integration test checks block ordering after update.
- **Case-sensitive heading match** (`:1081`, remove `.toLowerCase()`): "Introduction" wouldn't match "introduction". No test sends mismatched-case headings through the handler.

Missing tests: integration test creating a page with H1+H2 sections, updating one, reading back to confirm only that section changed and ordering preserved.

### 6. `find_replace` — Native Notion find/replace
**Handler:** `src/server.ts:1123–1146`
**Existing coverage:** none

Silent-break mutations:
- **Swap `old_str`/`new_str` keys** (`:1136–1137`): replaces the *replacement* text with the *search* text — destructive inversion. Zero tests.
- **Drop `replace_all_matches`** (`:1138`): `replace_all: true` silently becomes first-only. Zero tests.
- **Hardcode `success: false`** (`:1143`): agent thinks it failed, retries, makes no change (or double-replaces if first succeeded).

Missing tests: basic find/replace correctness; `replace_all` flag behavior; response shape.

### 7. `read_page` — Read page metadata + markdown
**Handler:** `src/server.ts:1147–1191`
**Existing coverage:** `block-warnings.test.ts` (omitted-block warnings, max_blocks)

Silent-break mutations:
- **Swap `blocksToMarkdown` for a no-op** (`:1172`): returns empty markdown with metadata intact. Block-warnings tests mock blocks but may not assert markdown content.
- **Drop `wrapUntrusted`** (`:1172`): `CONTENT_NOTICE` prefix disappears. No test checks for it (trustContent=false path).
- **Return `page.id` as `title`** (`:1170`): title field shows a UUID. No test asserts title correctness.
- **Omit `has_more` when `max_blocks` truncates** (`:1175–1177`): agent doesn't know content was truncated. Block-warnings test may cover this — needs verification.
- **Drop `include_metadata` fields** (`:1183–1188`): `created_time` etc. silently missing. No test.

Missing tests: assert markdown content matches created content (round-trip); assert `CONTENT_NOTICE` prefix; assert `include_metadata` fields present; assert `has_more` on truncation.

### 8. `duplicate_page` — Copy a page
**Handler:** `src/server.ts:1192–1225`
**Existing coverage:** `block-warnings.test.ts` (omitted-block warnings only)

Silent-break mutations:
- **Use `sourceTitle` instead of `newTitle`** (`:1210`): custom title ignored, always copies source title. No test asserts custom title.
- **Skip icon copy** (`:1208–1209`): emoji icon silently dropped. No test.
- **Return `page_id` (source) instead of `newPage.id`** (`:1213`): agent gets source ID back, thinks duplicate succeeded.

Missing tests: assert custom title, icon preservation, response contains new (not source) page ID.

### 9. `update_page` — Update title/icon/cover
**Handler:** `src/server.ts:1226–1250`
**Existing coverage:** `http-file-upload-gate.test.ts` (file:// gate only)

Silent-break mutations:
- **Pass `icon` to `cover` parameter** (`:1244`): cover gets an emoji string, icon is undefined. No positive-path test.
- **Return `page_id` arg instead of `updated.id`** (`:1246`): looks correct (same value in happy path) but masks errors where Notion returns a different ID.

Missing tests: happy-path assert that title/icon/cover are actually changed (read back after update).

### 10. `archive_page` — Archive a page
**Handler:** `src/server.ts:1251–1256`
**Existing coverage:** none

Silent-break mutation: **Call `restorePage` instead of `archivePage`** (`:1254`): page is restored instead of archived, response still says `success: true, archived: page_id`.

Missing tests: basic archive + verify page is actually archived.

### 11. `search` — Search pages/databases
**Handler:** `src/server.ts:1257–1272`
**Existing coverage:** none

Silent-break mutations:
- **Use `getPageTitle` for databases** (`:1267`): database titles are accessed via `r.title?.[0]?.plain_text` but pages use `getPageTitle`. Swapping these returns `undefined` for database titles.
- **Drop `filter` parameter** (`:1263`): `filter: "databases"` silently returns pages too. No test.
- **Return `r.parent?.page_id` unconditionally** (`:1269`): database parents (which use `database_id`) would return `null`. No test.

Missing tests: search with filter="databases" returns only databases; response shape for mixed results; parent field correct for both pages and databases.

### 12. `list_pages` — List child pages
**Handler:** `src/server.ts:1273–1284`
**Existing coverage:** none

Silent-break mutations:
- **Change filter from `child_page` to `child_database`** (`:1278`): returns databases instead of pages.
- **Return `block.child_page?.title` as `id`** (`:1280–1281`): swapped fields.

Missing tests: basic list with known children; assert `child_database` blocks are excluded; response shape.

### 13. `share_page` — Get page URL
**Handler:** `src/server.ts:1285–1293`
**Existing coverage:** none

Silent-break mutation: trivial handler, low risk. Swapping `id`/`url` fields would be the break.

Missing tests: response shape assertion (low priority).

### 14. `create_database` — Create a database
**Handler:** `src/server.ts:1294–1322`
**Existing coverage:** `create-database-response.test.ts` (response shape, dropped properties)

Silent-break mutations:
- **Pass `schema` directly instead of through `schemaToProperties`** (`:1302–1307`): sends `{name, type}` tuples to Notion instead of proper property objects. The response test mocks `createDatabase` — doesn't catch this.
- **Return `result.id` as `title`** (`:1318`): title shows UUID. Response test covers property list but not title/url shape.

Missing tests: assert `title` and `url` in response; assert `is_inline` flag forwarded (covered in `update-data-source.test.ts` for the internal function).

### 15. `update_data_source` — Update database schema
**Handler:** `src/server.ts:1323–1345`
**Existing coverage:** `update-data-source.test.ts` (internal function; property forwarding, cache invalidation)

Silent-break mutations:
- **Return `title` from args instead of `result.title`** (`:1341`): already partially does this (fallback chain). Swapping the chain silently returns the arg title even when Notion rejected the rename.
- **Drop `url` from response** (`:1342`): agent can't link to the database.

Missing tests: integration test through the MCP handler (existing tests cover the `updateDataSource` function, not the handler wrapper).

### 16. `get_database` — Get database schema
**Handler:** `src/server.ts:1346–1351`
**Existing coverage:** none (indirectly via `getCachedSchema` in other tests)

Silent-break mutation: **Return raw `db` instead of the shaped result from `getDatabase`** (`:1349`): agent receives the full Notion API response instead of the simplified `{id, title, url, properties}`. No test asserts the simplified shape.

Missing tests: assert response shape; assert select/status options are flattened to name strings.

### 17. `list_databases` — List all databases
**Handler:** `src/server.ts:1352–1360`
**Existing coverage:** `list-databases.test.ts` (mapper unit test only)

Silent-break mutations:
- **Drop the `?? r.id` fallback** (`:1356`): databases without `parent.database_id` return `undefined` as ID. Unit test covers the mapper but not the integration.
- **Use `filter: "pages"` instead of `"databases"`** (`:1354`): returns pages as databases.

Missing tests: integration test asserting only databases returned; fallback ID resolution.

### 18. `query_database` — Query with filters/sorts/text
**Handler:** `src/server.ts:1361–1378`
**Existing coverage:** `relation-roundtrip.test.ts` (read-back only)

Silent-break mutations:
- **Swap `and`↔`or` in compound filter** (`:1373`): `text` + `filter` combined with wrong logic — silently returns too many or too few results. No test exercises text+filter simultaneously.
- **Skip `simplifyEntry` mapping** (`:1377`): returns raw Notion page objects instead of simplified entries. Relation roundtrip test may catch this partially.
- **Drop `sorts` forwarding** (`:1376`): results return in arbitrary order. No test asserts ordering.

Missing tests: text+filter combination; sorts applied; simplifyEntry output shape for various property types.

### 19. `add_database_entry` — Create a database row
**Handler:** `src/server.ts:1379–1387`
**Existing coverage:** `database-write-strictness.test.ts` (validation), `relation-roundtrip.test.ts`

Silent-break mutations:
- **Return `database_id` instead of `result.id`** (`:1386`): agent receives the database ID, not the new entry's page ID. Write-strictness tests mock the response — may not catch.
- **Drop `url` from response** (`:1386`): agent can't link to the new entry.

Missing tests: assert response `id` is distinct from `database_id`; assert `url` present.

### 20. `add_database_entries` — Batch create rows
**Handler:** `src/server.ts:1388–1412`
**Existing coverage:** `database-write-strictness.test.ts` (sandwich pattern for per-entry errors)

Silent-break mutations:
- **Swap `succeeded`/`failed` arrays** (`:1411`): errors appear in success, successes in errors. The test checks that partial failures don't block the batch but may not assert which array each entry lands in.
- **Push to `succeeded` inside the `catch` block** (`:1403–1404`): failed entries appear as successes.

Missing tests: assert specific entries land in `succeeded` vs `failed` by index; assert response shape.

### 21. `update_database_entry` — Update a database row
**Handler:** `src/server.ts:1413–1421`
**Existing coverage:** `database-write-strictness.test.ts`, `relation-roundtrip.test.ts`

Silent-break mutation: **Return `page_id` arg instead of `result.id`** (`:1420`): looks correct in happy path but masks Notion errors. Low risk given existing coverage.

### 22. `list_comments` — List page comments
**Handler:** `src/server.ts:1422–1432`
**Existing coverage:** none

Silent-break mutations:
- **Swap `author`/`content` fields** (`:1428–1429`): comment text shows as author name.
- **Drop `created_time`** (`:1430`): comments lose chronological ordering context.

Missing tests: basic comment listing; response shape.

### 23. `add_comment` — Add a comment to a page
**Handler:** `src/server.ts:1433–1441`
**Existing coverage:** none

Silent-break mutations:
- **Pass raw `text` string instead of `blockTextToRichText(text)`** (`:1436`): Notion API expects rich_text array, would likely error — but if Notion becomes lenient, formatting is lost.
- **Return `page_id` as `id`** (`:1438`): agent gets the page ID, not the comment ID.

Missing tests: basic add + list roundtrip; assert formatting preserved.

### 24. `move_page` — Move page to new parent
**Handler:** `src/server.ts:1442–1447`
**Existing coverage:** none

Silent-break mutation: **Swap `page_id` and `new_parent_id`** (`:1444–1445`): moves the parent under the page. Returns `success` with wrong `parent_id`.

Missing tests: basic move; assert page's parent changed.

### 25. `restore_page` — Restore archived page
**Handler:** `src/server.ts:1448–1453`
**Existing coverage:** none

Silent-break mutation: **Call `archivePage` instead of `restorePage`** (`:1451`): archives instead of restoring, response still says `restored`.

Missing tests: archive → restore roundtrip.

### 26. `delete_database_entry` — Archive a database entry
**Handler:** `src/server.ts:1454–1459`
**Existing coverage:** none

Silent-break mutation: calls `archivePage` — same as `archive_page`. Could call `restorePage` instead.

Missing tests: basic archive; assert entry no longer appears in query results.

### 27. `list_users` — List workspace users
**Handler:** `src/server.ts:1460–1469`
**Existing coverage:** none

Silent-break mutations:
- **Swap `name`/`email` fields** (`:1464–1465`): email shows as name.
- **Drop `type` field** (`:1465`): can't distinguish bot from person.

Missing tests: response shape assertion.

### 28. `get_me` — Get current bot user
**Handler:** `src/server.ts:1470–1474`
**Existing coverage:** none

Silent-break mutation: trivial handler; dropping `name` or `type` from response.

Missing tests: response shape assertion (low priority).

---

## Cross-Tool Journey Gaps

These multi-tool flows have no integration test coverage:

1. **Create → Read round-trip:** `create_page` with markdown → `read_page` → assert markdown equality. The `roundtrip.test.ts` tests the conversion functions in isolation but never goes through the MCP handlers.
2. **Create → Append → Read:** `create_page` → `append_content` → `read_page` → assert both sections present. No test.
3. **Create → Replace → Read:** `create_page` → `replace_content` → `read_page` → assert only new content. No test.
4. **Create → Update Section → Read:** `create_page` with H1/H2 sections → `update_section` on one → `read_page` → assert only target section changed. No integration test (unit test covers boundary logic only).
5. **Create DB → Add Entry → Query → Assert:** `create_database` → `add_database_entry` → `query_database` → assert entry visible with correct property values. The `relation-roundtrip.test.ts` covers this for relation properties but not for basic types.
6. **Archive → Restore → Read:** `archive_page` → `restore_page` → `read_page` → assert page accessible. No test.
7. **Search → Get Database → Query:** realistic discovery flow — zero coverage on the `search` → schema-inspect → query chain.
8. **Duplicate → Read both:** `duplicate_page` → `read_page` on both source and copy → assert content equality. No test.

---

## Prioritized Test Additions

Ranked by (user-impact × break-likelihood). Each test is a single focused assertion.

| # | Test | Tool(s) | What it catches | Risk |
|---|---|---|---|---|
| 1 | `find_replace` basic correctness | `find_replace` | `old_str`/`new_str` swap; `replace_all` flag | **Critical** — zero coverage on a write tool |
| 2 | Create→Read markdown round-trip via handlers | `create_page`, `read_page` | Response shape, `processFileUploads` wiring, `blocksToMarkdown` integration, `CONTENT_NOTICE` | **Critical** — the core user journey |
| 3 | `search` response shape + filter | `search` | Field mapping, database title path, filter forwarding | **High** — zero coverage, used for discovery |
| 4 | `query_database` text+filter compound | `query_database` | `and`↔`or` swap in `buildTextFilter` merge | **High** — subtle logic, zero specific test |
| 5 | `update_section` integration round-trip | `update_section` | Section boundary + block ordering after delete/insert | **High** — unit test covers math but not wiring |
| 6 | `list_pages` basic correctness | `list_pages` | `child_page` filter, response shape | **High** — zero coverage, frequently used |
| 7 | `replace_content` deletes old + writes new | `replace_content` | Skipped delete loop, field swap | **High** — destructive tool with zero positive-path test |
| 8 | `append_content` blocks_added count | `append_content` | Count correctness, arg wiring | **Medium** — zero positive-path test |
| 9 | `add_database_entries` succeeded/failed separation | `add_database_entries` | Array swap, wrong-bucket assignment | **Medium** — partial coverage exists |
| 10 | `simplifyProperty` unique_id with prefix | `query_database` (via `simplifyEntry`) | Prefix-number concatenation at `src/server.ts:79–85` | **Medium** — untested branch, user-visible |
| 11 | `get_database` response shape | `get_database` | Options flattening, simplified schema | **Medium** — zero direct coverage |
| 12 | `list_databases` integration | `list_databases` | Filter="databases" forwarded, fallback ID | **Medium** — unit test covers mapper only |
| 13 | `duplicate_page` custom title + icon | `duplicate_page` | Title override, icon preservation | **Medium** — block-warnings test doesn't check these |
| 14 | `read_page` include_metadata fields | `read_page` | Metadata fields present when requested | **Low** — niche feature but easy to break |
| 15 | `archive_page` / `restore_page` roundtrip | `archive_page`, `restore_page` | Accidentally swapped implementations | **Low** — trivial handlers but zero coverage |

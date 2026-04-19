# Frame 6 — The Notion Platform Drift Tracker

**Date:** 2026-04-17
**Frame thesis (generator):** easy-notion-mcp is a wrapper around a third-party API that changes, has hard limits, rate-limits callers, trashes data, and evolves its versioning. Surface lives at the seam between our assumptions and Notion's reality — what breaks when the API version advances, a page has 2000 blocks, integration access is revoked mid-request, rate-limits hit mid-batch, or a new upstream block type appears.

**Method:** PM+Codex split. 5 concern-anchored Codex passes (one per probe), each with adversarial rebuttal. 4 runtime probes against real Notion under the project's `NOTION_TOKEN` (pinned `Notion-Version: 2025-09-03`, `@notionhq/client 5.13.0`).

**Runtime parent page:** `frame-6-test-pages-2026-04-17` — id `346962c3-6c2f-811a-9ca8-db0e3aa9b589`, url `https://www.notion.so/frame-6-test-pages-2026-04-17-346962c36c2f811a9ca8db0e3aa9b589`. Archived at end of session.

**Note to orchestrator:** this file had prior content from an aborted earlier Frame-6 attempt (different runtime parent id `346be876-242f-81be-9b3a-e75a63aab24b`). I overwrote per the directive to write to this exact path. This report is from the authorized session chain below.

---

## Cross-frame double-count discipline — notes up front

During rebuttal I pushed Codex to hand back cases that are really Frame 3 (in-process logic) territory. The following were **moved out of Frame 6** after debate:

- `replace_content` / `update_section` "delete-then-append with no rollback" — the vulnerability exists whether or not Notion rate-limits; the trigger class (429, nested-array cap, transient error) is platform-adjacent but the **missing-transaction** is logic. Frame 3 owns the vulnerability; Frame 6 owns the *trigger description* (case P1.1 below).
- `processFileUploads` `Promise.all` partial-success handling — split. The fan-out of N concurrent requests is Frame 6 (self-induced rate pressure). The lack of cleanup on partial failure is Frame 3.
- Generic `normalizeBlock` default-drops — Pass 1 moved these to Frame 3; Pass 3 kept them because Notion's *evolving* block taxonomy is why unknown types appear. They live in Pass 3 below, framed as platform drift, not as a normalizer coverage bug.

---

## Probe 1 — Block / page pagination

**Anchor:** Notion paginates block children at 100 per call. Does our wrapper walk cursors, silently truncate, or round-trip lossy through read-modify-write?

**Surprising finding up front:** top-level cursor walking is actually *correct*. `listChildren`, `fetchBlocksRecursive`, `queryDatabase`, `listComments`, `listUsers`, and `searchNotion` all walk `has_more`/`next_cursor`. Runtime-confirmed on a 155-block page (`wrapper_list_children.count === 155`) and a 120-child toggle (`toggle_kid_count === 120`). The drift lives at the **mutation seam**, not the read seam.

### Cases

**P1.1 — Oversized nested-tree write payload after a paginated read or markdown parse** (umbrella, GROUNDED-NOTION)
Read cleanly walks pagination; write cannot send that tree back as one payload. `duplicate_page` (src/server.ts:1160) hands `fetchBlocksRecursive`'s result to src/notion-client.ts:263 `pages.create({children: blocks})`. `replace_content` / `append_content` / `update_section` rebuild trees from markdown via src/markdown-to-blocks.ts:545/620/634; src/notion-client.ts:318 `appendBlocks` chunks only top-level blocks, never nested child arrays. Notion caps block arrays at 100 elements including nested children ([Request limits](https://developers.notion.com/reference/request-limits), [Create a page](https://developers.notion.com/reference/post-page)).
Variants/triggers: `duplicate_page` on a source with >100 top-level blocks; a toggle with >100 kids; a column with >100 blocks; a table with >100 rows; markdown input that produces any of these.
Failure mode: `crash` for duplicate/append; `crash-after-destructive-delete` for replace/update_section (Frame 3 owns the rollback gap; Frame 6 owns the platform cap that makes the write unreachable).

**P1.2 — `find_replace` discards Notion's `truncated` + `unknown_block_ids` recovery metadata** (GROUNDED-NOTION)
src/server.ts:1090 calls `pages.updateMarkdown`. src/server.ts:1101 returns only `{success: true, truncated?}` — drops `markdown` and `unknown_block_ids`. Notion's update-page-markdown endpoint explicitly returns those fields so callers can recover omitted subtrees on large pages ([Update page markdown](https://developers.notion.com/reference/update-page-markdown)).
Failure mode: `wrong-result`. User told truncation happened, not given the IDs to recover.

**P1.3 — `query_database` on a wiki data source collapses `data_source` rows to `{id}`** (GROUNDED-NOTION)
src/server.ts:1316 `.map(simplifyEntry)`; src/server.ts:84 assumes `page.properties`. Notion's wiki data sources can contain pages *or* child data sources; by default query returns both unless `result_type` is set ([Query a data source](https://developers.notion.com/reference/query-a-data-source)).
Failure mode: `wrong-result` on the data-source rows in later cursor pages.

**P1.4 — `read_page` with `max_blocks` returns truncated markdown that feeds destructive rewrite paths** (GROUNDED-CODE)
src/server.ts:1118 `fetchBlocksWithLimit`; response adds `has_more: true` at :1133. An agent that ignores `has_more` and pipes the markdown into `replace_content` permanently truncates the page.
Failure mode: `wrong-result` (signaled), promoted to `data-loss` if caller round-trips.

### Debate block — Pagination

**Claim (Codex pass 1, initial):** 16 cases — ten of them individual variants of the oversized-nested-write pattern (duplicate_page with 250 blocks; duplicate_page with toggle>100 kids; duplicate_page with table>100 rows; column>100 kids; replace_content variants of each; update_section variants of each; append_content variant).

**Challenge (PM):** Those 10 are co-identical — same root cause (post-pagination write payload exceeds 100-element nested cap), different trigger shape. Consolidate to one umbrella case with variants listed. Also: cases describing "delete-then-append-crash-leaves-half-state" span Frame 6 (trigger) and Frame 3 (missing rollback). Where does the case belong?

**Resolution (Codex, on rebuttal):** Consolidated 10→1 umbrella (P1.1) with variants enumerated. Split-ownership acknowledged explicitly — Frame 6 owns "Notion lets us paginate-read trees that it will not accept back as one write payload"; Frame 3 owns "no transaction around delete-then-append." Also dropped `synced_block`/`child_page`/`child_database` default-drop cases as Frame-1-inappropriate (they're a normalizer coverage gap, covered instead under Pass 3 as platform-drift). Also confirmed wiki-data-source mixed result type is documented current behavior, not speculation, with doc URL cited.

Final P1 count: 4 cases.

---

## Probe 2 — Rate-limit & batch semantics

**Anchor:** Notion ~3 req/s sustained, 429 with `Retry-After`. How does our wrapper classify, pace, and recover?

**Structural findings up front:**
- `@notionhq/client` 5.13.0 has built-in retry: `maxRetries: 2`, reads `Retry-After` (`Client.js:741-805`). 429s that escape the SDK have already been retried twice.
- `APIResponseError` preserves `error.headers` accessibly (`errors.js:130-136`). Reliable access pattern: `err.headers.get('retry-after')` (Headers object) or bracket fallback.
- `add_database_entries` is **not batched internally** — despite the name, it's a sequential per-entry loop (src/server.ts:1339), no chunking, no concurrency.
- Only concurrent fan-out in the codebase: `processFileUploads` → `Promise.all` (src/file-upload.ts:78).
- No app-level retry, no pacing, no queue.

### Cases

**P2.1 — `enhanceError` discards `Retry-After` on rate-limited errors** (GROUNDED-CODE, sharpest finding)
src/server.ts:398 matches `rate_limited` code and returns a fixed string `"Notion rate limit hit. Wait a moment and retry."` It never inspects `error.headers`. The SDK preserved the server's actionable wait-hint; the wrapper throws it away. Callers can't implement backoff — they're told "wait a moment" with no duration.
Failure mode: `confusing-error`, value-destructive (actionable info exists and is dropped).

**P2.2 — `add_database_entries` misclassifies exhausted 429s as permanent failures** (GROUNDED-CODE)
src/server.ts:1343 unconditional bucketing: `failed.push({index, error})`. No distinction between retryable transients (429, 500, 503) and permanent validation errors. A caller debugging a failed bulk-insert sees "row 37 failed: rate limited" and cannot tell that row 37 was *fine* — it just got unlucky on the retry budget.
Failure mode: `incorrect-classification`.

**P2.3 — `add_database_entries` schema prewarm lives outside the success/failure loop** (GROUNDED-CODE)
src/server.ts:1334 calls `getCachedSchema` before the per-entry loop. If that fetch 429s after SDK retries, control jumps to the top-level catch at src/server.ts:1418 — caller sees a single error, not a `{succeeded: [], failed: [...]}` split. For large batches, that's a whole-batch abort without per-row visibility.
Failure mode: `crash`, mismatches the tool's documented success/failure contract.

**P2.4 — No global pacing or queue** (GROUNDED-NOTION)
Every tool path issues requests back-to-back. A batch of 50 `add_database_entries` = 50 serial requests with no inter-request delay, relying entirely on SDK internal retry to smooth rate-limit bumps. Notion's docs explicitly recommend backoff/queue behavior beyond what the SDK provides.
Failure mode: `confusing-error` — late rows marked failed for transient-overload reasons indistinguishable from data problems.

**P2.5 — `processFileUploads` fan-out creates self-induced 429 pressure** (GROUNDED-CODE)
`Promise.all(realMatches.map(uploadFile))` at src/file-upload.ts:78. Each `uploadFile` is 2 API calls (src/notion-client.ts:88, :97). A single `append_content` call with 10 `file://` attachments = 20 concurrent upload requests before any content append. (The partial-failure cleanup gap is Frame 3's; the self-induced burst is Frame 6.)
Failure mode: `confusing-error`, possible orphaned uploads.

**P2.6 — Late 429 discards whole accumulated read state** (GROUNDED-CODE)
`fetchBlocksRecursive`, `queryDatabase`, `listComments`, `listUsers`, `searchNotion` all accumulate results in memory and only return after the full walk. A 429 on cursor page N (after SDK exhausts its 2 retries) discards pages 1..N-1. For `read_page` on a large page, that means an expensive retry restart. For `query_database` against thousands of rows with `>3000` results, it's painful.
Failure mode: `confusing-error`, wasted work.

### Debate block — Rate limit

**Claim (Codex pass 2, initial):** 15 cases, several describing "multi-request fan-out → 429 mid-sequence → partial state committed → no rollback" (append_content, replace_content, update_section, upload orchestration).

**Challenge (PM):** Those partial-state cases would exist whether or not Notion rate-limits — a non-429 transient (network reset, timeout, 500) would produce the same corruption. If the vulnerability doesn't depend on rate-limit triggering specifically, it's Frame 3 logic territory, not Frame 6 platform-drift. Also: is the `enhanceError` Retry-After discard verifiable through the SDK (i.e., can a caller access `err.headers['retry-after']` before our wrapper rewrites)? And case 15 (`move_page` under rate pressure) is just case 14 applied to one tool.

**Resolution (Codex, on rebuttal):** Moved cases 4, 5, 6, 7 entirely to Frame 3 — conceded the infinite-rate-limit thought experiment shows the vulnerability is logic-not-platform. Split case 8: the `Promise.all` upload burst stayed in Frame 6 (self-induced rate pressure would disappear if Notion had infinite limits), the partial-cleanup gap moved to Frame 3. Confirmed Retry-After discard with precise access-pattern caveat: `err.headers.get('retry-after')` (Headers object), not `err.headers['retry-after']`. Dropped case 15.

Final P2 count: 6 cases.

---

## Probe 3 — API version & converter drift

**Anchor:** Pinned `Notion-Version: 2025-09-03`. Notion's versioning doc: new API versions only for *breaking* changes; additive features (new block types, new properties) ship on the version you're on ([Versioning](https://developers.notion.com/reference/versioning)). So new block types Notion has added since 2025-09-03 can land on our pinned client today — they don't wait for a version bump.

### Cases

**P3.1 — Unknown block types silently dropped by `normalizeBlock` default branch** (GROUNDED-NOTION, present-tense)
src/server.ts:122 is a switch over ~20 supported block types; src/server.ts:276 `default: return null`; src/server.ts:323 `if (!normalized) continue;` → block is **dropped entirely** before it reaches markdown conversion. src/blocks-to-markdown.ts:196 has its own `default: return ""` belt-and-braces that never gets reached because the normalizer already filtered. Silent round-trip of a read→`replace_content` permanently deletes the unknown block.
Present-tense drift under pinned 2025-09-03:
- `tab` block (added 2026-03-25, additive, ships to pinned version)
- `heading_4` (added 2026-03-30, additive)
- `transcription` block (pre-2026-03-11; renamed to `meeting_notes` in 2026-03-11 but our pinned 2025-09-03 still receives `transcription`)
- Pre-existing types never added to the switch: `synced_block`, `child_page`, `child_database`, `link_preview`, `pdf`, `template`, `breadcrumb`, `link_to_page`, plus Notion's own `type: "unsupported"` response for blocks Notion itself can't render.

Failure mode: `silent-data-loss` (read); `permanent-deletion` (read→replace_content).

**P3.2 — `richTextToMarkdown` crashes on `mention` and `equation` rich_text items** (GROUNDED-NOTION, present-tense)
src/blocks-to-markdown.ts:26 calls `applyAnnotations(item.text.content, item)` unconditionally. Notion rich_text has three types: `text`, `mention`, `equation`. For `mention` and `equation`, `item.text` is undefined → `TypeError: Cannot read properties of undefined (reading 'content')` ([Rich text](https://developers.notion.com/reference/rich-text)). Affects every renderer path that calls `richTextToMarkdown` (headings, paragraphs, toggles, list items, quotes, callouts, table cells, code).
Codex reproduced the exact JS failure locally with a minimal `{type: "mention", mention: {...}}` object.
Failure mode: `crash` on `read_page` whenever the page contains any `@mention` or inline `$equation$`.

**P3.3 — `file` / `audio` / `video` round-trip is lossy through markdown** (GROUNDED-CODE)
Read: src/blocks-to-markdown.ts:212/217/221 render these as `[name](url)`, `[audio](url)`, `[video](url)`.
Write: src/markdown-to-blocks.ts:478/485/488 only reconstruct these block types when URL scheme is `notion-upload:`. Any other URL falls through to a paragraph.
A `read_page` → edit → `replace_content` round-trip on a page with file/audio/video blocks silently degrades them to paragraph links.
Failure mode: `silent-round-trip-of-garbage`.

**P3.4 — Callout icon rotation silently degrades** (GROUNDED-NOTION, 2026-03-25 changelog)
src/blocks-to-markdown.ts:138 reads `block.callout.icon?.emoji`; anything else falls back to label `"NOTE"`. src/markdown-to-blocks.ts:197 writes emoji icons. Notion 2026-03-25 introduced structured `type: "icon"` callouts. Round-trip turns a structured-icon callout into a generic emoji callout.
Failure mode: `silent-semantic-degradation`.

**P3.5 — `verification` property silently ignored in both read and write** (GROUNDED-NOTION, 2026-03-25 changelog)
src/server.ts:79 `simplifyProperty` returns `null` for unknown types. src/notion-client.ts:243 `convertPropertyValues` silently skips unknown writes. Notion added writable `verification` on 2026-03-25.
Failure mode: `silent-wrong-property` on both read (shows `null`) and write (value ignored).

**P3.6 — Pre-existing property types already invisible in `query_database` results** (GROUNDED-NOTION)
src/server.ts:48 default `return null` for property types not in the switch. Missing: `files`, `formula`, `relation`, `rollup`, `created_by`, `created_time`, `last_edited_by`, `last_edited_time`. All documented current Notion property types ([Property object](https://developers.notion.com/reference/property-object)).
Failure mode: `silent-data-loss` (query results show `null` where Notion returned real values).

**P3.7 — `update_database_entry` reads the wrong parent field under 2025-09-03** (GROUNDED-NOTION)
src/notion-client.ts:575 checks `page.parent.type === "data_source_id"` then reads `page.parent.database_id`; Notion's 2025-09-03 parent object for data-source-parented pages may or may not alias `database_id` — if absent, throws `Page is not part of a database`. A real user, on a valid data-source-backed page, can get this error.
Failure mode: `crash` on valid input.

**P3.8 — Multi-source databases: "first source wins"** (GROUNDED-NOTION, 2025-09-03 architecture)
src/notion-client.ts:55 resolves `db.data_sources?.[0]?.id` and caches it. Notion databases can contain multiple data sources. Any target other than index 0 silently gets the wrong schema, wrong query target, wrong write target.
Failure mode: `silent-wrong-target` on any multi-source database.

**P3.9 — `createDatabase` / `update_data_source` silently drop unknown schema types** (GROUNDED-CODE)
src/notion-client.ts:183 `schemaToProperties` default `break`. Caller requested a property type we don't know how to create → no error, property not created.
Failure mode: `silent-wrong-schema`.

**P3.10 — `duplicate_page` drops structured page icons** (GROUNDED-NOTION, 2026-03-25)
src/server.ts:1161 preserves only `sourcePage.icon?.type === "emoji" ? sourcePage.icon.emoji : undefined`. Notion 2026-03-25 introduced `type: "icon"` structured icons; pages using them lose their icon on duplicate.
Failure mode: `silent-data-loss` on icon.

**P3.11 (future-maintenance, SPECULATIVE)** — `after` → `position` param change in 2026-03-11 breaks `appendBlocksAfter` after a version bump. `meeting_notes` rename from `transcription` in 2026-03-11 requires code update after bump. Both are real Notion changes but only activate on upgrade; flagged as future work, not present drift.

### Debate block — Version drift

**Claim (Codex pass 3, initial):** 17 cases. Several framed as "if Notion deprecates X" or "after version bump, Y breaks" without clear separation between present-tense drift and future-maintenance.

**Challenge (PM):** Hypotheticality filter. For each case referencing a specific Notion change, is the shape already arriving under pinned 2025-09-03, or only after a future upgrade? Specifically: `tab`, `heading_4`, `transcription` — present or post-bump? And is the rich_text-mention crash claim real? Walk the code again — does `item.text.content` really throw on a mention-type item?

**Resolution (Codex, on rebuttal):** Used Notion's versioning doc to split the list. Present-tense under pinned version: `tab`, `heading_4`, `transcription`, rich_text mention/equation crash (confirmed by reproducing the exact `TypeError` locally). Post-bump-only, downgraded to SPECULATIVE: `meeting_notes` rename, `after`→`position`. Rich-text crash scope broadened — affects every renderer path using `richTextToMarkdown`, including code blocks. Strongest version-drift finding in the pass.

Final P3 count: 10 present-tense cases + 1 consolidated post-bump speculative.

---

## Probe 4 — Archive / restore / trash lifecycle

**Anchor:** Notion has archived/trashed/restored states (2025-09-03 uses `in_trash`; `archived` is deprecated alias, removed in 2026-03-11). Does our wrapper preserve the distinction and return helpful errors?

**Runtime evidence (direct observation against real Notion):**
- `pages.retrieve` on archived page: **succeeds**, returns `{archived: true, in_trash: true, is_archived: false, ...}`.
- `blocks.children.list` on archived page: **404 `object_not_found`**, body contains `"Make sure the relevant pages and databases are shared with your integration."` — same shape as an unshared-page error.
- `blocks.children.append` on archived page: **400 `validation_error`**, body `"Can't edit block that is archived. You must unarchive the block before editing."` — helpful, passed through cleanly.
- Sub-page of an archived parent: retrieve succeeds with `archived: true, in_trash: true`. `list_children` on the sub-page returns 0 blocks with no error.
- `pages.update({page_id: DATABASE_ID, in_trash: true})`: **404 `object_not_found`** + same misleading "share with integration" body.

### Cases

**P4.1 — `archive_page` / `restore_page` use pre-`in_trash` vocabulary** (GROUNDED-CODE, RUNTIME-CONFIRMED)
Tool names, descriptions, and response payloads (`{archived: page_id}`, `{restored: page_id}`) predate Notion's 2025-09-03 move to `in_trash`. Implementation correctly sends `in_trash: true|false` (src/notion-client.ts:413) but the wrapper's external vocabulary misleads callers about what state they're setting.
Failure mode: `silent-wrong-terminology`.

**P4.2 — `read_page` on archived page → cryptic "share with integration" error** (GROUNDED-CODE + GROUNDED-NOTION, RUNTIME-CONFIRMED)
`read_page` does `getPage()` (succeeds) then `fetchBlocksRecursive()` → `listChildren` → **404**. `enhanceError` (src/server.ts:389) matches `object_not_found` and rewrites to "Make sure the page/database is shared with your Notion integration" — a permission message for what's actually an archive state. User is misdirected to "check your integration sharing" when the fix is `restore_page`.
Failure mode: `cryptic-error`.

**P4.3 — `read_page` response schema never surfaces archive state** (GROUNDED-CODE, RUNTIME-CONFIRMED)
src/server.ts:1126 serializes only `{id, title, url, markdown, ...}` — `archived` and `in_trash` are never in the response, even though `getPage()` returns them. Combined with P4.2, there is no signal to the caller that a page is archived short of fetching raw metadata.
Failure mode: `silent-wrong-result` (information hidden).

**P4.4 — `duplicate_page` of archived page → same cryptic 404** (GROUNDED-CODE, RUNTIME-CONFIRMED)
Same call chain as P4.2: `getPage` succeeds, `fetchBlocksRecursive` 404s with "share with integration" body.
Failure mode: `cryptic-error`.

**P4.5 — Sub-page of archived parent presents as empty, not archived** (GROUNDED-CODE, RUNTIME-CONFIRMED)
Runtime: `getPage` on a child of an archived parent returns `{archived: true, in_trash: true}` — Notion propagates the state. `listChildren` on the child returns **0 blocks with no error** (not a 404). So `read_page` would return `{id, title, url, markdown: ""}` — an apparently-normal empty page. No signal. No error. Silent.
Failure mode: `silent-wrong-result`.

**P4.6 — `archive_page` on a `database_id` → same cryptic 404** (GROUNDED-CODE, RUNTIME-CONFIRMED)
src/server.ts:1198 unconditionally calls `pages.update({page_id: id, in_trash: true})`. No type validation. Passing a database ID hits Notion's 404 `object_not_found` → `enhanceError` → "share with integration". No indication that the input is a database, not a page.
Failure mode: `cryptic-error`.

**P4.7 — `enhanceError` conflates trash and permission errors into one misleading message** (GROUNDED-CODE)
src/server.ts:389/398 rewrites `object_not_found` to the single string "Make sure the page/database is shared with your Notion integration." No branch for archived pages, trashed databases, wrong-object-type, or deleted. The user's mental model is derailed — they check sharing when they need to restore.
Failure mode: `cryptic-error` (meta-case: this is the mechanism behind P4.2, P4.4, P4.5, P4.6).

**P4.8 — No database archive/restore tool; `update_data_source` hides the distinction** (GROUNDED-NOTION, 2025-09-03 architecture)
There is no tool that archives/restores a *database container* (as opposed to a data source). `update_data_source(database_id, {in_trash: true})` resolves the first data source and trashes it, then returns `id: database_id` (src/server.ts:1263, src/notion-client.ts:473). Notion 2025-09-03 splits database and data-source lifecycle; our tool surface doesn't.
Failure mode: `silent-wrong-result`.

**P4.9 — `add_database_entries` against a trashed DB aborts wholesale, not per-entry** (GROUNDED-CODE)
The schema-prewarm step (src/server.ts:1334) lives outside the per-entry loop. If the DB (or its data source) is trashed, `getCachedSchema` fails. The whole batch aborts with one top-level error, not a `{succeeded: [], failed: [all]}` shape.
Failure mode: `confusing-error`, contract mismatch.

**P4.10 — Partial positive finding + remaining speculative slice**
- `append_content` on an archived page: **positive case**. Returns Notion's helpful "Can't edit block that is archived" error through the pass-through path — no special casing needed, message is actionable. Not a drift finding; called out to avoid over-counting archive-path failures.
- `list_comments` on archived page: **SPECULATIVE** (likely same 404 as listChildren, not probed).
- `replace_content` / `update_section` trashed mid-flight: **SPECULATIVE** (not probed; Frame 3 owns the rollback gap, Frame 6 would own the specific archived-mid-flight error behavior).

### Debate block — Archive lifecycle

**Claim (Codex pass 4, initial):** 13 cases, most tagged SPECULATIVE because the initial pass didn't have empirical data on what Notion actually returns for archived-page reads.

**Challenge (PM):** I ran a runtime probe against real Notion with the project's token. Here's what the API actually returns for archived-page reads (listChildren 404 + misleading "share with integration"), archived-page appends (helpful 400), sub-pages of archived parents (retrieve succeeds + child listing silently returns 0), and DB-id passed to archive_page (404 same body). Given this, please upgrade several SPECULATIVE cases to GROUNDED and add new cases this evidence exposes.

**Resolution (Codex, on rebuttal):** Removed the false "append_after_archive is cryptic" finding — it's actually a *positive* helpful-error case. Upgraded 5 cases (read_page, duplicate_page, sub-page-of-archived-parent, archive_page-on-DB-ID, and the meta `enhanceError` conflation case) from SPECULATIVE to GROUNDED-CODE with runtime citations. Added new case P4.3 — read_page response schema discards archive flags even when retrieve succeeds. Kept remaining cases (list_comments, trashed-mid-flight on replace_content / update_section) as SPECULATIVE with justification.

Final P4 count: 9 cases + 1 mixed (P4.10) — 7 runtime-confirmed GROUNDED, 2 SPECULATIVE explicitly flagged.

---

## Probe 5 — Schema cache coherence

**Anchor:** `convertPropertyValues` uses a 5-minute TTL schema cache keyed by name. UI-side schema edits (rename, retype, add, delete) do not invalidate our cache. Property IDs (which survive renames) are never exposed or used.

**Structural finding:** The deeper bug isn't the TTL — it's that writes are **name-based, not ID-based**. `get_database` returns `{name, type, options}` only; no property IDs, no option IDs (src/notion-client.ts:113-130). `convertPropertyValues` looks up `ds.properties[key]` by current-name only. Notion explicitly supports property IDs (stable across renames) for writes. The choice to expose names but not IDs makes every rename a drift trigger.

### Cases

**P5.1 — Stale-cache `get_database` returns obsolete schema** (GROUNDED-CODE)
src/notion-client.ts:68-76. User renames/retypes/deletes/adds between our fetch and next call. Within 5 min, `get_database` returns the pre-edit snapshot.
Failure mode: `silent-wrong-property`.

**P5.2 — Stale-cache old-name write → cryptic 400** (GROUNDED-CODE, RUNTIME-CONFIRMED)
Cache warmed with `Priority`. User renames `Priority`→`Urgency` in UI. Caller (or LLM agent) uses stale label: `createDatabaseEntry({Priority: "High"})`. Our cache hits, we forward `Priority` to Notion. Notion returns **400 `validation_error`: "Priority is not a property that exists."** — confusing because the caller *did* just use a name that was correct minutes ago.
Failure mode: `cryptic-400-error`.
Runtime probe output: 2026-04-18T06:39Z, request_id `3f82e0ca-dcfc-4d04-a3ef-fe99365dd9f7`.

**P5.3 — Stale-cache new-name write → SILENT DATA LOSS** (GROUNDED-CODE, RUNTIME-CONFIRMED — sharpest cache finding)
Cache still contains `Priority`. User uses new UI label: `createDatabaseEntry({Urgency: "High"})`. `convertPropertyValues` looks up `ds.properties["Urgency"]` in the *cached* schema → undefined → hits src/notion-client.ts:200 `if (!propConfig) continue;` → **silently drops the value before sending**. Notion receives only `{Name: "row3"}`. Row created with `Urgency: null`.
Failure mode: `silent-data-loss`.
Runtime probe output: row created with id `346962c3-6c2f-81f3-9ef8-d781042cb330`, property `Urgency: {type: "select", select: null}`.

**P5.4 — `update_database_entry` same stale-cache trap** (GROUNDED-CODE)
src/notion-client.ts:568-590. Same `convertPropertyValues` path. Old-name → 400. New-name → silent drop. Symmetric with P5.2/P5.3.
Failure mode: `cryptic-400-error` or `silent-data-loss`.

**P5.5 — Deleted property still resolves in cache → 400** (GROUNDED-NOTION)
User deletes `Priority` in UI. Cache still has it. Write `{Priority: "High"}` → our lookup succeeds → Notion rejects.
Failure mode: `cryptic-400-error`.

**P5.6 — Type change → stale type-specific payload** (GROUNDED-NOTION)
User changes `rich_text` → `select`. Cached type says `rich_text`, `convertPropertyValues` serializes as `{rich_text: ...}`. Notion validates against current shape → 400.
Failure mode: `cryptic-400-error`.

**P5.7 — `buildTextFilter` uses stale text-type list** (GROUNDED-NOTION)
src/notion-client.ts:133-142. User changes a text property to a non-text type, or adds a new text-searchable property. `query_database` text-filter OR construction uses cached property list — stale filter produces 400 or silently misses matches.
Failure mode: `cryptic-400-error` (type flip) or `silent-wrong-property` (new prop added).

**P5.8 — Compound cache + auto-create: resurrected select/multi_select options** (GROUNDED-NOTION)
Platform fact: Notion `select` and `multi_select` writes auto-create missing option names on write (with write-access integrations). Our code writes option values by `name` only (src/notion-client.ts:215-223), never by option ID. If the user deleted an option "Low" in the UI and our stale cache still lists it, a caller echoing that stale name back to `add_database_entry` causes Notion to **resurrect** the deleted option. Not a pure cache bug — stale metadata + caller echoing + platform auto-create = silent schema mutation.
Failure mode: `silent-wrong-schema`.

**P5.9 — `update_data_source` full-list semantics + stale cache → destructive removal** (GROUNDED-CODE)
src/notion-client.ts:492-500 forwards the raw `properties` payload with no merge. The tool description correctly warns about full-list semantics, but a caller building the payload from a stale `get_database` output will omit options added since the fetch. Notion removes the omitted options and silently reassigns rows (for status) to the default group's first option — the tool description flags this, but the drift trigger (stale cache feeding the full-list payload) remains.
Failure mode: `silent-data-loss`.

**P5.10 — `add_database_entries` batch amplifies the cache bug** (GROUNDED-CODE)
src/server.ts:1334 warms the schema once, then the whole batch reuses it. Any of P5.2/P5.3/P5.5/P5.6 hits every row in the batch before cache expiry.
Failure mode: multiplied `cryptic-400-error` or `silent-data-loss`.

**P5.11 (SPECULATIVE, reframed as future-maintenance)** — Spontaneous `data_source_id` rotation would silently route writes to the wrong data source. No documented Notion behavior for spontaneous rotation. Dropped from primary drift list.

### Debate block — Schema cache

**Claim (Codex pass 5, initial):** 17 cases. Case 13/14 framed as "stale cache resurrects options." Case 17 speculated about data_source_id rotation with no doc citation.

**Challenge (PM):** Runtime probe confirms cases 3 and 4 empirically — elevate them. But cases 13/14 overstate cache as sole cause: Notion's select auto-create-on-write is a platform fact that applies regardless of cache freshness. Reframe as compound (stale cache + caller echoes stale name + auto-create = resurrection). Case 17 (data_source rotation) is pure speculation — is there *any* documented Notion behavior that causes rotation? If not, drop it.

**Resolution (Codex, on rebuttal):** Case 3 and Case 4 elevated to RUNTIME-CONFIRMED status with empirical request_ids. Cases 13/14 rewritten as compound-condition cases (P5.8) — stale cache makes the bad value *look authoritative*; with fresh cache the same outcome is still reachable by a caller typing a stale name from memory. Case 17 dropped from primary list with explicit "future-maintenance concern, not current drift" note. Also identified the deeper root cause: the wrapper exposes names but not property IDs, so every rename is a drift trigger.

Final P5 count: 10 cases + 1 explicitly dropped.

---

## Runtime probes — session artifacts

**Parent page:** `frame-6-test-pages-2026-04-17` (id `346962c3-6c2f-811a-9ca8-db0e3aa9b589`, archived at session end).

**Probe A (archive lifecycle):** `/tmp/frame-6-probes/out-a.txt`. Key evidence:
- `listChildren` on archived page → 404 `object_not_found`, body contains "Make sure the relevant pages and databases are shared with your integration". request_id `95acd9d7-d100-429b-b9a3-bc2af1bd948d`.
- `appendBlocks` on archived page → 400 `validation_error`: "Can't edit block that is archived." request_id `5639c4df-de55-43ab-bc42-bf0b6d14b3fd`.
- Sub-page of archived parent: `pages.retrieve` returns `archived: true, in_trash: true`; `listChildren` returns 0 blocks with no error.

**Probe B (pagination):** `/tmp/frame-6-probes/out-b.txt`. Key evidence:
- Raw Notion API: 155-block page, `has_more: true`, first page size 100.
- Wrapper `listChildren`: 155. `fetchBlocksRecursive` walks all cursor pages correctly.
- Toggle with 120 children: wrapper returns 120 — nested pagination also walked.
- Callout with 1 nested paragraph: child exists at API level, but `attachChildren` (src/server.ts:238) whitelist does NOT include `callout` → child dropped before markdown conversion (code-grounded; covered under P3 unknown-block family).

**Probe C (schema cache):** `/tmp/frame-6-probes/out-c.txt`. Key evidence:
- Warm cache with property `Priority`, rename to `Urgency` via raw API (bypassing wrapper invalidation).
- `createDatabaseEntry({Priority: "High"})` → 400 `validation_error` "Priority is not a property that exists." (request_id `3f82e0ca-dcfc-4d04-a3ef-fe99365dd9f7`).
- `createDatabaseEntry({Urgency: "High"})` → succeeded with `Urgency: null`. Silent data loss.

**Probe E (single rate-limit burst):** 15 concurrent `pages.retrieve` in 1.8s. All 15 succeeded. No 429 observed — Notion smoothed the burst or SDK retried silently. Per directive, did not re-run aggressively. Establishes that casual burst usage doesn't trip rate limits; the wrapper's lack of retry/pacing only becomes visible under higher sustained load.

---

## Cross-frame acknowledgment — blind spots

Generator's note for Frame 6: *"Cannot see issues inside our process (logic bugs, concurrency, state leaks) or the human-facing setup. Frame 3 covers in-process; Frame 2 covers setup."*

Categories I consciously pushed out of Frame 6 to their proper frames:

1. **Delete-then-append missing-rollback (Frame 3).** Every `replace_content` / `update_section` / large `append_content` is a multi-request mutation without transaction semantics. Frame 6 shows that the *trigger* (nested-array cap, 429, network blip) is platform-shaped, but the *vulnerability* (no checkpoint, no resume) is logic. If Frame 3 doesn't flag this, there's a gap.

2. **`Promise.all` orphan-upload cleanup (Frame 3).** `processFileUploads` leaves partial uploads on any failure. The burst fan-out is Frame 6 (self-induced rate pressure); the cleanup is logic.

3. **`normalizeBlock` coverage gap in isolation (Frame 3 coverage of switch statements).** If Frame 3 enumerates "switch statements with unsafe defaults," it will land on `normalizeBlock`. Pass 1 moved the case there. Pass 3 kept it as present-tense version drift because Notion's evolution is *why* unknown types appear. Both framings are legitimate — the case should appear in both.

Categories Frame 6 cannot see that other frames must cover:

1. **Setup / permission / OAuth / integration-sharing discovery (Frame 2).** P4.7 notes that `enhanceError` rewrites `object_not_found` to a permission-looking message. For users whose integration is *genuinely* unshared, that message is appropriate and helpful — the first-run setup discoverability is Frame 2's territory. Frame 6 can only see the conflation.

2. **In-process concurrency (Frame 3).** The `schemaCache` Map has no race guard; two concurrent `add_database_entries` on the same DB can both miss the cache and both populate it. Not a *drift* concern (no platform mismatch); a concurrency concern.

3. **MCP transport-level concerns (wherever that lives).** HTTP vs stdio mode differences, tool visibility, OAuth session handling — invisible to Frame 6 entirely.

---

## Session chain appendix

All sessions ran in `/mnt/d/backup/projects/personal/mcp-notion` with reasoning effort `high`.

- Self (PM): Claude Opus 4.7, 1M context. Session implicit to calling conversation.
- Codex `frame-6-probe-1-pagination` — `019d9ea4-cac1-7fe2-84a9-1a0bea997dc1` (initial + rebuttal)
- Codex `frame-6-probe-2-ratelimit` — `019d9ea5-027c-7570-ab20-06cca2bf5802` (initial + rebuttal)
- Codex `frame-6-probe-3-versiondrift-v2` — `019d9f4b-2551-79c2-b1bd-42b5c9c992b4` (initial + rebuttal)
- Codex `frame-6-probe-4-archive-v2` — `019d9f4b-60a1-7e11-a54b-9e1b109a3e5e` (initial + rebuttal)
- Codex `frame-6-probe-5-schemacache-v2` — `019d9f4b-7f07-71e0-a00c-f3a2a9cb9a55` (initial + rebuttal)

Pre-existing orphan sessions from an aborted earlier Frame-6 attempt (session-name collisions caused the `-v2` suffix): `frame-6-probe-3-versiondrift`, `frame-6-probe-4-archive`, `frame-6-probe-5-schemacache` — not used for this report.

Runtime probe script: `/tmp/frame-6-probes/probe.mjs`. Raw output: `/tmp/frame-6-probes/out-a.txt`, `out-b.txt`, `out-c.txt`, `out-e.txt`.

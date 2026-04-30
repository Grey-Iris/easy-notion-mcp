# Plan: PR3 — Atomic `replace_content` + `update_block`

**Tasks:** `notion-atomic-edit-update-block` (tasuku, ready, priority 2); `native-replace` (ready, priority 2); resolves `evaluate-need-for-blocklevel-ric` (the answer is "yes — `update_block`").
**Date:** 2026-04-28.
**Phase sequence:** PR1 (property-type gap, shipped `c5e27bc` 2026-04-22) → PR2 (long-property pagination, shipped as v0.5.0 #35 on 2026-04-23) → **PR3 (this plan)**. Decision `post-v030-phase-sequence`.
**Audit anchors:** `.meta/audits/notion-api-gap-audit-2026-04-20.md` §1 finding 4, §3.2 row `blocks.update`, §4.5, §6 "PR 3".
**Strategic anchors:** `.meta/research/workflow-token-measure-2026-04-28.md` Workflow 1 (~98% reduction); `.meta/research/remote-mcp-strategy-2026-04-28.md` §1 + §5.1 ("edit-heavy session economics").
**Notion-Version:** pinned 2025-09-03 — `find_replace` already calls `pages.updateMarkdown` at this header.
**Phase:** planning only. No production code in this commit.

---

## 1. TL;DR

- **PR3 ships two things in one PR:** a new `update_block` tool wrapping `client.blocks.update`, AND an atomic-replace path for `replace_content` calling `pages.updateMarkdown` with `command: "replace_content"` instead of the current delete-children + append-children loop.
- **Atomic-replace hinges on a structural surprise James must decide on first** (Decision Point 1). Notion's `pages.updateMarkdown` parses **Notion-flavored / Enhanced Markdown** (XML-ish tags), not the GFM-with-extensions dialect this server documents and round-trips today (`+++` toggles, `::: columns`, `> [!NOTE]` callouts, `[toc]`, bare-URL bookmarks). Submitting our custom syntax through the native endpoint without translation will land it as paragraph text, not as Notion blocks. Three exits in §4: build a translator, defer atomic, or ship plain-only.
- **`update_block` is not blocked by Decision Point 1.** It uses `blocks.update` per-block on shapes our existing `markdownToBlocks` already produces. It can ship in PR3 even if atomic-replace is deferred.
- **The wedge is block-ID preservation, deep-link anchors, inline comments, and synced-block linkage.** Workflow 1 quantified the per-call cost benefit (~98%); the user-trust benefit is bigger — agents stop breaking page anchors mid-session.
- **Breaking-change verdict on `replace_content`: NOT a strict superset under any of the three Decision-Point-1 exits.** Migration story required. Footprint per exit in §11.
- **`update_block` API surface (Decision Point 2):** propose markdown-snippet input (`{ block_id, markdown, ... }`) over typed-field input — matches the project's interface contract; lets `to_do` ride on `- [x]` syntax. Trade-off: requires a `blocks.retrieve` to detect existing-block type so we can reject markdown that would change the type (the SDK forbids type changes on update). +1 API call per update; honest in the tool description.
- **Container blocks (toggle, callout, columns, table) are first-level only on day 1.** Notion's `blocks.update` has no `children` field; documented, not a bug. Editing a paragraph inside a toggle uses `update_block` against the child's ID.
- **TDD discipline baked in** per learning `[e9dcf6]`. **Codex pressure-test handoff at end** per the PR1/PR2 pattern.
- **Sequencing within the PR:** ship `update_block` first (lower-risk, narrower diff). Then atomic `replace_content` (or ship `update_block` solo if Decision Point 1 lands "defer atomic"). Bundle the warning-text removal from `replace_content` only if atomic actually lands.
- **Effort:** planner-honest **4 dev-days** for Exit A; **2.5 dev-days** for Exit B. Per learning `[0186bc]`, expected actual is **4–13 wall-clock hours** (Exit A) or **2.5–8 hours** (Exit B) — 10–40× under in practice.

---

## 2. Scope and non-goals

### 2.1 In scope

- New tool `update_block` wrapping `client.blocks.update` (`Client.d.ts:133`).
- New helper `updateBlock(client, blockId, payload)` in `src/notion-client.ts` colocated with `appendBlocks` / `deleteBlock` (file lines 770–828).
- Optional refactor of `replace_content` (`src/server.ts:1182-1194`) to call `pages.updateMarkdown` with `type: "replace_content"`. **Conditional on Decision Point 1.**
- Tool-description updates: new for `update_block`; revised for `replace_content` (atomic + breaking-change note); cross-reference from `update_section`.
- Update to `tests/destructive-edit-descriptions.test.ts` if `replace_content` ships atomic and the warning text is removed (today asserts `DESTRUCTIVE` substring at lines 26–34).
- New tests: `tests/update-block.test.ts`; `tests/update-block-roundtrip.test.ts`; two live e2e additions in `tests/e2e/live-mcp.test.ts` for block-ID preservation.
- Tasuku follow-ups for any deferred decisions (per `feedback_capture_deferred_decisions.md`, filed before builder dispatch).
- CLAUDE.md tool-registry note for `update_block`.

### 2.2 Out of scope (deferred — file as tasuku follow-ups)

- **Atomic `update_section`.** Same atomicity argument applies, but `update_section` would need Notion's `replace_content_range` command, marked deprecated in the SDK type at `api-endpoints.d.ts:3112-3118`. Defer; track as `notion-atomic-update-section`. Triggering: a user reports `update_section` partial-failure data loss OR Notion adds a non-deprecated range-replace.
- **Routing `find_replace` through `update_block` for single-block edits.** Audit §1 finding 4's implicit expansion. Track as `find-replace-route-single-block-via-update-block`.
- **`pages.retrieveMarkdown` as alt `read_page` engine.** Audit §3.3. Track as `notion-pages-retrieveMarkdown-evaluation`.
- **Exposing `blocks.retrieve` as a tool.** Used internally for `update_block` type-checking (Decision Point 2); not surfaced externally in PR3. Track as `notion-blocks-retrieve-tool` if asked.
- **Multi-block batch `update_block`.** SDK only supports single-block PATCH. No follow-up.
- **Removing destructive-warning text from `replace_content` if atomic does NOT ship.** Warning still applies to delete+append; removing it would mislead.

---

## 3. Bug anatomy and call graph

### 3.1 What `replace_content` does today (`src/server.ts:1182-1194`)

`listChildren` → loop `deleteBlock` per existing child → `markdownToBlocks` → `appendBlocks` (chunks of 100). Five facts that matter for migration:

1. **N+1 API calls** for an N-block page; Workflow 1 measured this at ~3,800 tokens for a 100-block page vs ~64 for the atomic equivalent.
2. **No transactionality.** Mid-loop failure leaves the page partial — what `tests/destructive-edit-descriptions.test.ts:26-45` documents.
3. **Block IDs are destroyed.** Every block gets a new ID; deep-link anchors (`#block-id`), inline-comment threads, and inbound synced-block links break.
4. **Block types we don't render are deleted along with the rest.** `listChildren` returns ALL children (`synced_block`, `child_page`, `child_database`, `link_to_page`, `meeting_notes`, etc.); `deleteBlock` deletes them; `markdownToBlocks` produces only the 24 types in `SUPPORTED_BLOCK_TYPES` (`server.ts:194-200`). `read_page`'s `omitted_block_types` warning already tells the agent this is going to happen.
5. **`find_replace` is the one tool already using `pages.updateMarkdown`** (`server.ts:1248-1271`), but only the `update_content` command. Native-PATCH infrastructure is in place.

### 3.2 What the native `replace_content` command does

SDK type at `api-endpoints.d.ts:3128-3134`:
```ts
{ type: "replace_content";
  replace_content: { new_str: string; allow_deleting_content?: boolean } }
```
Response `PageMarkdownResponse` (`api-endpoints.d.ts:1744-1750`): `{ object, id, markdown, truncated, unknown_block_ids }`.

Inferences from the type + strategy memo's "84 workaround calls for a 42-edit page" data point on hosted's whole-page `update-page`:

- **One PATCH** instead of N+1.
- **`unknown_block_ids` in the response** suggests Notion-side block-ID matching: where new markdown maps to existing blocks, IDs survive.
- **`truncated`** is the same flag `find_replace` already inspects.
- **`allow_deleting_content`** is Notion's safety rail. Default behavior unknown without live probe (§9.1 #1).
- **No formal contract on what markdown syntax is parsed.** This is the load-bearing unknown — see §4.

### 3.3 What `update_block` would do

SDK type `UpdateBlockParameters` at `api-endpoints.d.ts:3162-3370` is a discriminated union, one variant per block type, each accepting that type's content fields plus `in_trash` (and a deprecated `archived`). Critical traits:

- **Type cannot be changed.** Variant selected by which top-level key (`paragraph`, `heading_1`, `to_do`, …) is present. Mismatched key returns a Notion API validation error.
- **`rich_text` is full-array replacement.** No partial semantics. Mirror of how our pipeline produces it.
- **Container types are first-level only.** No `children` accepted on `blocks.update`. Toggle's `rich_text` (title), callout's `rich_text` + `icon`, table's `has_column_header`/`has_row_header`, column's `width_ratio`. Children update individually.
- **`equation`** takes `expression: string`; **`code`** takes `rich_text` + `language` + `caption`; **`divider` / `breadcrumb` / `table_of_contents`** have no useful content edit (archive-only).

---

## 4. The structural surprise — Notion's markdown dialect

### 4.1 The mismatch

This server's I/O dialect is GFM plus the conventions in CLAUDE.md "Custom markdown conventions": `+++` toggles, `::: columns`, `> [!NOTE]` callouts, `$$equation$$`, `[toc]`, `[embed](url)`, bare-URL bookmarks.

Notion's `pages.updateMarkdown` and `pages.retrieveMarkdown` (shipped 2026-02-26 per audit §3.3) speak **Notion-flavored / Enhanced Markdown**: a different dialect using XML-style tags for callouts, toggles, columns, tables, mentions, bookmarks (per `workflow-token-measure-2026-04-28.md` §1 methodology bullet 2).

`find_replace` doesn't hit this mismatch because `update_content` substitutes strings on the Notion-rendered page — it doesn't parse new structural markdown. `replace_content` would: every `+++` toggle, every `::: column`, every `> [!NOTE]` we send would land in Notion as paragraph text instead of the structural blocks the agent intended.

### 4.2 What we don't know without a live probe

- Whether `> [!NOTE]` (GFM-alerts, shipped 2024) is treated as Notion's callout or as a quote/text. Notion may have adopted it as a shorthand.
- Whether `+++` is treated as text, dropped, or recognized via a different syntax we don't know about.
- Whether `::: columns` is recognized.
- What happens to `[toc]`, `[embed](url)`, bare-URL bookmarks, `$$equation$$`.
- The block-ID preservation rate when input markdown roughly resembles existing page.
- Whether `allow_deleting_content` defaults true or false.

A small disposable probe script answers all of these before TDD starts (§9.1).

### 4.3 The exits

- **Exit A — Build a GFM→Enhanced-Markdown translator first** (the original `native-replace` task framing). Maximum-correctness path: every block type that round-trips through `markdownToBlocks` + `blocksToMarkdown` keeps round-tripping post-PR3, plus block IDs preserved, plus atomicity. Cost: ~1 dev-day for translator + property tests.
- **Exit B — Defer atomic replace_content to a follow-up.** Ship `update_block` solo. File `notion-replace-content-atomic` task; triggering condition: GFM→Enhanced translator exists OR live probe shows useful subset. Lowest-risk path; defers the wedge's most-quantifiable benefit.
- **Exit C — Ship atomic as plain-markdown-only.** Document loudly that custom block types are not supported and will land as paragraph text. Net negative: today's `replace_content` *does* render those types correctly via `markdownToBlocks`. Switching to atomic without a translator regresses on that surface. **Not recommended.**

Revisited as Decision Point 1 in §10.

### 4.4 Why no new "Custom markdown convention" row is expected

`update_block` accepts a markdown snippet and passes it through `markdownToBlocks`, which already supports all CLAUDE.md conventions. No new syntax. CLAUDE.md gets an `update_block` mention in tool-registry sense, not in conventions table.

---

## 5. `update_block` API surface

### 5.1 Tool name

Proposal: **`update_block`**. Matches SDK method name, Notion API path (`PATCH /v1/blocks/{id}`), and the existing `update_*` family (`update_section`, `update_page`, `update_data_source`, `update_database_entry`). Alternatives in Decision Point 3.

### 5.2 Parameters

```json
{
  "block_id": "string (required)",
  "markdown": "string (one-of with archived) — new content. Type must match the existing block. Container blocks update first-level fields only.",
  "checked": "boolean (optional, to_do only) — explicit check-state override; otherwise inferred from `- [x]` / `- [ ]` syntax",
  "archived": "boolean (one-of with markdown) — sends in_trash:true to move the block to trash"
}
```

Required: `block_id` plus exactly one of `markdown` or `archived`.

### 5.3 Return shape

Success: `{ id, type, updated: true }`. Type-mismatch: `{ error: "Block type mismatch: existing is paragraph; markdown parses as heading_2. Use replace_content or delete + append to change a block's type." }` — no API call made. Unsupported existing type (synced_block etc.): explicit error pointing at archive-then-recreate.

### 5.4 Day-1 type matrix (builder reference)

| Block type | Markdown update | Archive | Notes |
|---|---|---|---|
| paragraph | ✅ first paragraph in snippet | ✅ | most common |
| heading_1 / 2 / 3 | ✅ | ✅ | type lock-in: `# X` against `heading_2` returns mismatch |
| toggle | ✅ title only | ✅ | children unaffected |
| bulleted / numbered_list_item | ✅ first item | ✅ | nested items not edited |
| quote | ✅ first paragraph in `>` | ✅ | |
| callout | ✅ first line | ✅ | icon update is follow-up |
| to_do | ✅ + checked | ✅ | both content and check-state |
| code | ✅ | ✅ | language inferred from fence |
| equation | ✅ | ✅ | `$$expression$$` |
| divider | — | ✅ | archive-only |
| table_of_contents | — | ✅ | archive-only |
| bookmark / embed / image / file / audio / video | — | ✅ | archive-only in v1; URL update is follow-up `media-block-update-url` |
| table | — | ✅ | flag-only attrs not exposed; defer |
| table_row | — | ✅ | per-cell edit complex; defer |
| column_list / column | — | ✅ | structural; archive only |
| synced_block / child_page / child_database / link_to_page / template / breadcrumb / meeting_notes / pdf | — | ✅ | not in `SUPPORTED_BLOCK_TYPES`; markdown returns explicit error |

---

## 6. Atomic `replace_content` rewiring (conditional on Decision Point 1)

### 6.1 Code change

Replace `case "replace_content"` body (`server.ts:1182-1194`) with the same shape `find_replace` uses (`:1248-1271`), plus the optional translator:

```ts
case "replace_content": {
  const notion = notionClientFactory();
  const { page_id, markdown } = args as { page_id: string; markdown: string };
  const processed = await processFileUploads(notion, markdown, transport);
  const new_str = translateGfmToEnhancedMarkdown(processed); // Exit A only
  const result = await (notion as any).pages.updateMarkdown({
    page_id,
    type: "replace_content",
    replace_content: { new_str, allow_deleting_content: true /* probe-confirmed in §9.1 */ },
  }) as PageMarkdownResponse;
  return textResponse({
    success: true,
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.unknown_block_ids?.length ? { unknown_block_ids: result.unknown_block_ids } : {}),
  });
}
```

Notes: (a) `processFileUploads` runs before the translator. (b) `unknown_block_ids` is exposed in the response — departure from `find_replace` which discards it (the "KNOWN GAP" tests at `find-replace.test.ts:259-290`). PR3 is the natural moment to surface it, picked up in Decision Point 6. (c) Type cast mirrors `find_replace`'s pattern.

### 6.2 New helper

Recommended: extract `replacePageMarkdown(client, pageId, markdownStr, options?)` colocated with `appendBlocks` (`notion-client.ts:770-808`). Translator (Exit A) lives in a new `src/markdown-to-enhanced.ts` to keep GFM→Enhanced separate from `markdown-to-blocks.ts`.

### 6.3 Tool description (post-atomic)

> Replaces all page content with the provided markdown atomically. Block IDs, deep-link anchors, and inline-comment threads on matched blocks are preserved (Notion matches new markdown to existing blocks where possible; unmatched blocks are listed in the response's `unknown_block_ids`). Non-rendered blocks (synced_block, child_page, child_database, link_to_page) on the source page are NOT preserved — they're treated as content the new markdown is replacing. Supports the same markdown syntax as create_page.

The DESTRUCTIVE warning text is removed under this version. Test at `destructive-edit-descriptions.test.ts:26-34` flips its assertion or is deleted (Decision Point 5).

---

## 7. TDD plan

Per learning `[e9dcf6]` (failing test → watch fail → implement) and `[3657ca]` (per-test dynamic imports for tests written ahead of missing modules).

### 7.1 `update_block` — unit (mocked `notion`, `tests/update-block.test.ts`)

1. Forwards `{ block_id, paragraph: { rich_text: [...] } }` for a paragraph snippet against a paragraph block. (`blocks.retrieve` returns `{ type: "paragraph" }`.)
2. Same for each editable type: heading_1, heading_2, heading_3, toggle, bulleted_list_item, numbered_list_item, quote, callout, to_do, code, equation.
3. To_do `checked: true` flows through whether explicit or inferred from `- [x]`.
4. Type mismatch returns the §5.3 error *before* calling `client.blocks.update` (assert `notion.blocks.update` NOT called).
5. `archived: true` sends `{ in_trash: true }` and includes no content key.
6. Markdown parsing to multiple top-level blocks returns an error pointing at `replace_content` / `append_content`.
7. Empty markdown returns a validation error before any API call.
8. Block type not in `SUPPORTED_BLOCK_TYPES` returns the explicit "use archive then recreate" error.

### 7.2 `update_block` — round-trip (`tests/update-block-roundtrip.test.ts`)

9. For each editable type: `markdownToBlocks(snippet)` → simulate `update_block`'s payload extraction → `blocksToMarkdown` round-trips back to the same snippet (or canonical form).

### 7.3 `update_block` — live e2e (extend `tests/e2e/live-mcp.test.ts`)

10. Create page with a paragraph; capture block ID; call `update_block`; `blocks.retrieve` by SAME ID; assert content changed but ID identical.
11. Create page with a to_do; `update_block` toggles `checked: true`; assert ID identical, `checked` is now true.
12. (Codex pressure-test target) Create page with a paragraph that has an inline comment; verify the comment thread survives `update_block`.

### 7.4 Atomic `replace_content` test plan (Exit A only)

**Unit:**
13. Forwards `type:"replace_content"`, `replace_content.new_str` equal to (translated) input, `allow_deleting_content` per probe-confirmed default (§9.1 #1).
14. Returns `{success:true}` on `truncated:false, unknown_block_ids:[]`.
15. Returns `{success:true, truncated:true}` when API echoes `truncated:true` (mirrors `find_replace` pattern).
16. Returns `unknown_block_ids` in response when API populates them (departure from `find_replace`'s "KNOWN GAP").
17. Translator property test: for each block type in `SUPPORTED_BLOCK_TYPES`, sample → translate → fixture-based assertion against the documented Enhanced Markdown spec.

**Live e2e:**
18. Create page with paragraphs + headings + toggles + a callout. Call `replace_content` with the same content but with one paragraph edited. Assert (a) unedited blocks have SAME IDs, (b) the edited paragraph keeps its ID with new text (preferred) or gets a new ID (acceptable, documents the limit), (c) toggle and callout still exist as their respective types.
19. Anchor a deep-link URL with `#block-id` to a paragraph; call `replace_content` keeping that paragraph; assert the deep link still resolves.
20. (Codex pressure-test target) Page contains a `child_page`. Call `replace_content`. Per §3.1 fact 4, the child_page should be destroyed; if the new endpoint preserves it, that's a behavior we discover via this test.

### 7.5 Test-list update

If atomic ships: update or delete `G3a-1` in `tests/destructive-edit-descriptions.test.ts`. `G3a-2` for `update_section` stays.

### 7.6 Codex handoff

Standard PR1/PR2 pattern: builder ships → orchestrator hands to Codex for behavior verification + targeted mutation tests (e.g., flip `allow_deleting_content` to `false`; observe whether tests catch the regression).

---

## 8. Sequencing within the PR

1. Failing test first for `update_block` (item 1 of §7.1). Watch fail.
2. Implement `updateBlock` helper in `notion-client.ts` and tool handler in `server.ts`.
3. Rest of `update_block` unit tests (items 2–8).
4. Round-trip tests (item 9).
5. Live e2e (items 10–11).
6. CLAUDE.md tool-registry note + tool description.
7. **CHECKPOINT — if Decision Point 1 = Exit B, ship `update_block` solo and stop.**
8. (Exit A only) Build `translateGfmToEnhancedMarkdown` + property tests.
9. Failing test first for atomic `replace_content` (item 13). Watch fail.
10. Implement `replacePageMarkdown` helper and migrate the handler.
11. Rest of unit tests (items 14–17).
12. Live e2e (items 18–19).
13. Update `replace_content` tool description per §6.3.
14. Update or remove `G3a-1` test.
15. Codex pressure-test handoff.

Reasoning: `update_block` is lower-risk and unblocks even if the atomic-replace probe (§9.1) reveals a blocker.

---

## 9. Risks and unknowns

### 9.1 Live probes the builder must run BEFORE shipping atomic (Exit A)

Cannot be answered from SDK types alone. Build a small disposable script before TDD; **not** production tests:

1. **`allow_deleting_content` default and semantics.** Send `replace_content` with `new_str: "# Test"` against a page with unrelated content; with the flag omitted, with `false`, with `true`. Observe which deletes existing content.
2. **`+++` and `::: ` syntax behavior** (in case the translator misses something). Send a `+++ Toggle\nbody\n+++` snippet directly. Observe whether Notion creates a paragraph, a toggle, or rejects.
3. **`unknown_block_ids` semantics.** Replace a page with mostly-unchanged content. Observe whether unmatched blocks appear in `unknown_block_ids`. Confirm the field is what we'd surface.
4. **Block-ID preservation rate.** Replace a 10-block page with the same 10 blocks where one paragraph has a one-character edit. Observe how many of the 10 IDs survive.
5. **GFM-alerts (`> [!NOTE]`).** Send a page with `> [!NOTE]\n> body`. Observe whether Notion produces a callout, a quote, or treats it as text.

### 9.2 Behavioral risks

- **Synced blocks in source page get destroyed by atomic replace.** Same as today's behavior, but now without the destructive warning. Tool description must say so explicitly.
- **`unknown_block_ids` may signal soft partial-failure.** If the response says "10 of 12 blocks were unmatched," surface as `warnings: [{code: "unmatched_blocks", ...}]` per CLAUDE.md "Non-fatal warnings".
- **`update_block`'s pre-fetch (Decision Point 2) doubles per-update API calls.** Trade-off: better error messages vs cheaper calls. Default A; choice in §10.
- **Container-block child updates require N calls** — one per child. Consistent with API grain; documented.

### 9.3 Disconfirming tests

These would derail the plan:

- Probe #1 in §9.1 reveals `allow_deleting_content` always rejects even with `true`. Atomic-replace becomes infeasible.
- E2e #10 reveals `update_block` does NOT preserve block IDs (Notion creates a new block). Refutes the wedge claim and downgrades `update_block` to "syntactic sugar over delete + append."
- The translator (Exit A) cannot represent one block type in `SUPPORTED_BLOCK_TYPES` because Enhanced Markdown has no equivalent. Forces atomic-replace to be type-restricted (C-flavored) or deferred (B).

---

## 10. Decision points for James

### Decision Point 1 — Exit choice for atomic `replace_content`

The structural surprise from §4.

- **A: Build the GFM→Enhanced-Markdown translator in PR3.** Atomic ships; block IDs preserved; +1 dev-day for translator + property tests.
- **B: Defer atomic to a follow-up.** Ship `update_block` solo. File `notion-replace-content-atomic`. Lowest-risk; defers the wedge benefit.
- **C: Ship atomic as plain-markdown-only.** Documented regression on toggles/columns/callouts. **Not recommended.**

**Default: A.** The strategy memo identifies block-level surgical edits as the structural moat; Workflow 1 quantifies the per-call delta at ~3,721 tokens. Option B leaves that on the table; Option C publicly regresses on the convention surface this server stakes its identity on.

If James chooses B, PR3 effort drops by ~1 dev-day and Decision Point 5 is moot.

### Decision Point 2 — `update_block` type-check pre-fetch

- **A: Pre-fetch `blocks.retrieve` to validate type; return our own helpful error on mismatch.** +1 API call per update; better error messages.
- **B: Skip pre-fetch; let Notion's API surface the type-mismatch error verbatim.** No extra call; agents see Notion's raw error.
- **C: Make pre-fetch opt-out via `skip_type_check: true`.** Defaults to A.

**Default: A.** The wedge thesis is that this server's UX is friendlier to agents than the bare API. A clear "type mismatch — use replace_content instead" is part of that friendliness.

### Decision Point 3 — `update_block` tool name

- **A: `update_block`.** Matches SDK + Notion API path + `update_*` family.
- **B: `edit_block`.** Verb-distinct from `update_section` (which is destructive section-level overwrite); reduces conflation in agent reasoning.
- **C: `patch_block`.** Closest to HTTP semantics; breaks the verb family.

**Default: A.** Conflation with `update_section` is mitigated by clear tool descriptions. Option B is defensible if James thinks agents will keep mistaking which tool does what.

### Decision Point 4 — `archived` parameter on `update_block`

- **A: Expose `archived: true` on `update_block`.** SDK accepts `in_trash` on every variant; one tool, two operations.
- **B: Add a separate `delete_block` tool in PR3.** Symmetric with `archive_page` / `restore_page`; one tool per operation.
- **C: Defer block deletion entirely.**

**Default: A.** Listing-budget tax matters per `token-remeasure`; one tool description is cheaper than two. Option B is a slightly cleaner mental model at the cost of one extra registration.

### Decision Point 5 — Destructive-warning text on `replace_content` (atomic only)

Conditional on DP 1 = A.

- **A: Remove the DESTRUCTIVE warning entirely.**
- **B: Soften to a note about `unknown_block_ids` and `child_page` destruction.**
- **C: Keep until live e2e (#18) confirms preservation rate is high.**

**Default: B.** Removing entirely overclaims atomicity in one direction (subpages still go); keeping it underclaims the wedge. A precise "block IDs and deep links preserved for matched blocks; child_page / synced_block / child_database NOT preserved" note is honest.

If DP 1 = B, this is moot — keep the warning as-is.

### Decision Point 6 — Bundle `find_replace`'s `unknown_block_ids` surfacing

`tests/find-replace.test.ts:259-290` documents two "KNOWN GAP" tests where `find_replace` discards `unknown_block_ids` and `markdown` from the API response. PR3 introduces a parallel pattern (`replace_content` SHOULD surface them).

- **A: Surface `unknown_block_ids` in `find_replace` too as part of PR3.** Flips both KNOWN GAP tests; consistent across both tools.
- **B: Defer; track as `find-replace-surface-unknown-block-ids`.**

**Default: A.** It's a 5-line change once the pattern is established for `replace_content`; deferring creates parallel-design-decay risk.

---

## 11. Breaking-change verdict on `replace_content`

**Verdict: NOT a strict superset.** Migration story required. Footprint per Decision-Point-1 exit:

| Exit | Behavior change | Migration impact |
|---|---|---|
| **A (translator + atomic)** | Block IDs preserved for matched blocks; deep-link anchors and inline comments preserved; atomicity (no partial state). `child_page`, `synced_block`, `child_database`, `link_to_page`, `meeting_notes`, `pdf` are still destroyed (parser doesn't represent them — same as today). One PATCH instead of N+1. | **One regression class:** callers who relied on `replace_content`'s side effect of "delete every block including ones the renderer doesn't represent" no longer get the *atomicity* of that wipe — partial wipes are no longer possible. Today's behavior (delete all then write new) was a hammer; new behavior is a chisel. Net positive but call out in PR body and CHANGELOG. |
| **B (defer atomic)** | No change to `replace_content`. | None. `update_block` is purely additive. |
| **C (atomic, plain-only)** | Block IDs preserved; atomicity. **BUT** custom block types (`+++` toggle, `::: column`, `> [!NOTE]` callout) on input land as paragraph text. | **Two regression classes:** (1) silent semantic change on custom-syntax callers; (2) same atomic-wipe regression as A. Not recommended. |

Migration story for Exit A:
- CHANGELOG bullet under v0.6.0: "`replace_content` now uses Notion's atomic markdown-replace endpoint. Block IDs, deep-link anchors, and inline comments are preserved on matched blocks. Side effect of the previous delete-then-append: agents that relied on `replace_content` to wipe a page clean of `synced_block`, `child_page`, `child_database`, or `link_to_page` should use `delete_block` (TBD: not yet exposed) or the Notion UI for those types."
- Tool description per §6.3.
- Optional follow-up `expose-delete-block-tool` if anyone reports the wipe-side-effect regression.

Version bump on ship: minor (v0.6.0). Reason: tool API surface adds (`update_block`) plus behavioral shift on `replace_content`.

---

## 12. Effort estimate

Per learning `[0186bc]`, planner-vs-actual estimates routinely run 10–40× under in practice when the planner front-loads thinking.

| Exit | Planner-honest | Expected actual (10–40× under) |
|---|---|---|
| A — translator + atomic | 4 dev-days | 4–13 wall-clock hours |
| B — `update_block` solo | 2.5 dev-days | 2.5–8 wall-clock hours |

Breakdown:
- TDD scaffolding for `update_block` (per-test dynamic imports per `[3657ca]`): 0.5 day
- `update_block` implementation + handler: 0.5 day
- Round-trip tests across the type matrix: 0.5 day
- Live e2e tests (items 10–11): 0.5 day
- Tool descriptions + CLAUDE.md + warnings field plumbing: 0.5 day
- (Exit A only) Translator implementation + property tests: 1 day
- (Exit A only) Atomic `replace_content` migration + tests + e2e: 0.5 day
- Codex pressure-test handoff + addressing findings: 0.5 day

PR-size discipline: PR2's plan capped at 800 lines / 6-hour wall-clock. PR3 stays under both ceilings for both exits. If Exit A overruns the translator (most likely surprise candidate, since Notion's Enhanced Markdown spec isn't fully documented publicly), the natural break point is two PRs back-to-back: `update_block` + translator, then atomic replace.

---

## 13. Pre-dispatch checklist

1. **James reviews this plan and resolves Decision Points 1–6.** No builder dispatches before that — DP 1 alone changes the scope materially.
2. **File deferred decisions as tasuku tasks** per `feedback_capture_deferred_decisions.md`:
   - Always: `notion-atomic-update-section`, `notion-pages-retrieveMarkdown-evaluation`, `media-block-update-url`, `notion-blocks-retrieve-tool`, `find-replace-route-single-block-via-update-block`
   - If DP 1 = B: `notion-replace-content-atomic` (triggering: GFM→Enhanced translator exists OR live probe shows useful subset)
   - If DP 6 = B: `find-replace-surface-unknown-block-ids`
3. **Snapshot ritual** (`feedback_state_snapshot_ritual.md`): pwd, branch, status, unpushed commits before any externally-visible action.
4. **Hand to builder** with this plan as role-input. Builder follows TDD per `[e9dcf6]`. Codex pressure-test at end.
5. **Notion-Version pin** (`project_notion_version_pin.md`): no version bump in this PR. The renamed-fields helper applies if the translator (Exit A) has occasion to surface `transcription` / `meeting_notes` — route through the centralized helper if so.

---

## Sources

- **Tasuku tasks** (`.tasuku/tasks/`): `notion-atomic-edit-update-block.md`, `native-replace.md`, `evaluate-need-for-blocklevel-ric.md`
- **Tasuku decision** `post-v030-phase-sequence` (recorded 2026-04-21)
- **Audit:** `.meta/audits/notion-api-gap-audit-2026-04-20.md` (§1 finding 4, §3.2 row `blocks.update`, §4.5, §6 "PR 3")
- **Strategic context:** `.meta/research/workflow-token-measure-2026-04-28.md` (Workflow 1); `.meta/research/remote-mcp-strategy-2026-04-28.md` §1 + §5.1
- **Reference plan:** `.meta/plans/pr2-long-property-pagination-2026-04-23.md`
- **Code:**
  - `src/server.ts` — tool registry (`replace_content` 598–611, `update_section` 612–626, `find_replace` 627–640); handlers (`replace_content` 1182–1194, `update_section` 1195–1247, `find_replace` 1248–1271); `SUPPORTED_BLOCK_TYPES` 194–200; `normalizeBlock` 202–end
  - `src/notion-client.ts` — `appendBlocks` 770–783, `appendBlocksAfter` 785–808, `listChildren` 810–825, `deleteBlock` 827–829
  - `src/markdown-to-blocks.ts` — `blockTextToRichText` 123, `markdownToBlocks` 579
  - `src/blocks-to-markdown.ts`
- **SDK types** (`node_modules/@notionhq/client/build/src/`):
  - `Client.d.ts:125-148` (`blocks.update` line 133); `:185-216` (`pages.updateMarkdown` line 209)
  - `api-endpoints.d.ts:3102-3146` (`UpdatePageMarkdownParameters` incl. `replace_content` 3128–3134); `:3147-3372` (`UpdateBlockParameters`); `:1744-1750` (`PageMarkdownResponse`)
- **Test patterns:** `tests/find-replace.test.ts` (mock + InMemoryTransport; KNOWN GAP at 226–290); `tests/destructive-edit-descriptions.test.ts`; `tests/e2e/live-mcp.test.ts`
- **CLAUDE.md** — "Custom markdown conventions"; "Adding a new block type"; "Non-fatal `warnings` field"
- **Learnings:** `[e9dcf6]` (TDD), `[0186bc]` (planner-vs-actual 10–40×), `[3657ca]` (per-test dynamic imports), `[553455]` (queryDatabase wrapper — N/A, confirmed not violated)

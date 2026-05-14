---
date: 2026-05-13
ticket: fix-createpage-many-optional-containers-perf
planner: Claude (Opus 4.7, 1M)
codex_review_session: plan-rev-cp-inline-v2-2026-05-13 (session id 019e2312-108b-79c3-b9c8-7d92ac7bf1e2)
audit: .meta/audits/e2e-tier1-g2b-investigation-2026-05-13.md
codex_audit_review: .meta/audits/e2e-tier1-g2b-perf-fix-codex-review-2026-05-12.md
relates-to: v0.9.3 candidate
---

# Plan — fix create_page perf cliff for markdown-heavy optional-container pages

## Background (one paragraph)

`createPage` for a markdown page with N top-level toggles / callouts / list items / toggleable headings (where each container has only depth-2 leaf children) fans out into `1 + 1 + N` sequential live Notion calls: one `pages.create` with N empty container stubs, one `blocks.children.list` to recover created block IDs, and N sequential `blocks.children.append` calls (one per container). At G2b's N=40 with ~1.4s/call Notion latency this hits the 60s MCP-client timeout. Root cause: `prepareBlockForWrite` (`src/notion-client.ts:148-187`) strips children from every `isOptionalChildrenContainer` block unconditionally, and `needsDeferredChildWrites` (`:189-211`) returns true for all of them, regardless of whether their children are themselves depth-2 leaves that would fit in the initial create payload. The deferred-write workaround designed for column→table depth-3 cases is being paid uniformly for every optional container.

Full diagnosis: see `.meta/audits/e2e-tier1-g2b-investigation-2026-05-13.md` (audit) and `.meta/audits/e2e-tier1-g2b-perf-fix-codex-review-2026-05-12.md` (Codex adversarial review of the audit, which identified the unsafe-as-stated nature of the auditor's proposed one-line fix and the lockstep-predicate shape that is the basis for this plan).

## Goal & scope

**Goal.** Drop the call count for G2b-shape `create_page` (N optional containers each with only depth-2 leaf children, N ≤ 100) from `2 + N` to `1`. Preserve all existing correctness invariants for the cases the deferred-write workaround was originally designed for: depth-3 nesting (nested toggles, list-in-list, callout-in-toggle), >100 direct children of a single container, column→table seeding, and rollback fidelity.

**In scope.**
- Introduce a shared predicate `canInlineChildrenInOneWrite(block)`.
- Plumb a context parameter through `prepareBlockForWrite` and `needsDeferredChildWrites` so the inline branch only fires at top-of-request depth (where adding children at depth-2 is safe). Nested-context calls (column seed, table seed) keep current strip-then-defer behavior.
- Cover all five optional-container kinds: `toggle`, `callout`, `bulleted_list_item`, `numbered_list_item`, and toggleable `heading_1/2/3`.

**Out of scope.**
- Parallelizing the deferred-append loop (Option 2 in the audit). Out of scope for this ticket; a follow-up can pick it up after Notion rate-limit measurement. Filed separately if not already a backlog tasuku ticket.
- Lifting per-test `timeoutMs` in the e2e suite (Option 3 in the audit). Not needed once Option 1 lands.
- Changes to `update_toggle`, `read_toggle`, or any read path. The cliff is in the write/create path only.
- Markdown parser changes. The parser already emits `toggle.children` (`src/markdown-to-blocks.ts:625-635`) and toggleable-heading `.children` (`:595-624`) in the shape the inline path needs.

## Decision summary

1. **Shape:** shared predicate + context-parameter, used by both `prepareBlockForWrite` and `needsDeferredChildWrites`. Rejected: changing only `prepareBlockForWrite` (Codex correctly flagged this would double-write because `needsDeferredChildWrites` would still flag the same block as deferred → `pages.create` carries the inline children AND the deferred loop appends them again).
2. **Predicate conditions (exact):** see "Predicate spec" below.
3. **Context awareness:** the inline branch only fires at top-of-request depth. Sub-top-level calls (column seed, table seed, column_list children) keep stripping. Reason: a column's seed is already at request-depth-3 (`pages.create.children[].column_list.children[].column.children[]`); adding inline children to a depth-3 seed would push grandchildren to depth-4, which violates the documented "no nested write deeper than two child levels" rule (`.claude/rules/tasuku/learnings-notion-client-ts.md`).
4. **Lockstep enforcement:** the predicate is the single source of truth for the decision "inline or defer." Both helpers receive the same `atTopLevel` parameter from the caller (top-level entry points pass `true`; internal recursive calls into column/table/column_list pass `false`). The depth/topness of one call decides BOTH "what payload shape to send" AND "what deferred work is queued."
5. **Rollback semantics:** unchanged. `pages.create` failures with inlined children leave no page id and no rollback is needed (Notion's pages.create is atomic with respect to the returned id). Deferred-append failures after a successful `pages.create` continue to trigger best-effort trash + rethrow the original error (`src/notion-client.ts:1055-1062`). The existing tests at `tests/notion-client-block-chunking.test.ts:323-354` continue to cover the deferred-failure rollback path and must keep passing.
6. **Per-request inlining is the design (not page-create only).** "Top level" in `atTopLevel` means "the root of THIS API request," not "the root of the user's `createPage` call." That means every `blocks.children.append` request also gets the inline optimization. Consequence: subsequent appends in a deferred chain can collapse two requests into one when the deeper subtree fits the predicate. Reasoning: each append request stays at request-root depth-2 max (the predicate guarantees no grandchildren in inlined children), which is within Notion's "two-level nesting per request" rule. This is an additional perf win, but it changes the expected call counts in existing chunking tests — see "Regression tests" below for the explicit list of expectation updates.

## Predicate spec — `canInlineChildrenInOneWrite(block)`

Returns `true` iff **all** of the following hold:

1. `isOptionalChildrenContainer(block)` is true. (Toggle, callout, bulleted list item, numbered list item, toggleable heading 1/2/3.)
2. `getBlockChildren(block).length > 0`. (No-op for empty containers — the existing strip path is fine; no perf cost.)
3. `getBlockChildren(block).length <= NOTION_BLOCK_CHILDREN_LIMIT` (100). The current chunking path at `:293` handles >100 by splitting into multiple appends; bypassing it would violate Notion's per-request child limit.
4. **For every child**, `getBlockChildren(child).length === 0`. This is the depth-3 guard: if any child has its own children, inlining would push grandchildren into the request payload at depth-3-or-deeper from the page, which is the case the deferred-write workaround exists to handle.

Equivalent informal statement: "this optional container has between 1 and 100 leaf children, no grandchildren." If any condition fails, fall through to the existing strip-and-defer path.

### Why condition (4) is "no grandchildren," not "no deferred-eligible grandchildren"

A child being a paragraph with no children — fine, leaf. A child being a paragraph with `children: [...]` — paragraphs with children are accepted by the Notion API recursively but pushing them inline puts their content at depth-3-from-request, which violates the two-level rule. Same for a child that is itself an optional container with children, a column_list, a table, etc. Simpler to write "no `children` array on any direct child" than to enumerate which child types are safely deep-inlinable; the simpler rule never sends a request that exceeds the two-level limit.

## Context parameter

`prepareBlockForWrite(block, atTopLevel = true)`:
- When `atTopLevel && isOptionalChildrenContainer(block) && canInlineChildrenInOneWrite(block)`: build the block with `body.children = children.map(c => prepareBlockForWrite(c, false))`. (Children are now at request-depth-2; they must not themselves recurse into top-level mode.)
- All other optional-container cases: existing `withoutBlockChildren(block)` (strip).
- Existing column / column_list / table branches: recurse with `atTopLevel: false` (preserving current behavior — the seed is already at depth-3 from request root and must continue to be stripped if it's an optional container).

`needsDeferredChildWrites(block, atTopLevel = true)`:
- When `isOptionalChildrenContainer(block)`:
  - If `children.length === 0`: false.
  - If `atTopLevel && canInlineChildrenInOneWrite(block)`: false. (Inlined; no deferred work.)
  - Else: true. (Either nested context, or has >100 children / has grandchildren.)
- All other branches unchanged. Internal recursive calls (column seed check, column_list child enumeration) pass `false` for `atTopLevel`.

### Top-level entry points (where `atTopLevel = true` originates)

- `createPage` initial-blocks loop: `:1021`, `:1030`, `:1041` — all evaluate top-level blocks at request root.
- `appendPreparedBlocks`: `:297`, `:310` — evaluates the chunk at the append request root.
- `appendBlocks` (which calls `appendPreparedBlocks`): `:1107` — same.

Default the parameter to `true` so external callers don't change; pass `false` explicitly only from internal recursion points.

## TDD test plan — write these BEFORE touching `src/notion-client.ts`

All tests go in `tests/notion-client-block-chunking.test.ts` using the existing `makeNotionClient()` mock harness and helpers (`toggle`, `callout`, `bullet`, `paragraph`, `column`, `columnList`, etc.). Add helpers only as needed (`numberedListItem`, `toggleableHeading(level, content, children)`).

### Test list (12 new tests — 11 numbered + test 4a, ordered by what they pin)

**1. `inlines a toggle's depth-2 paragraph children in the initial pages.create payload`**
- Setup: `[ toggle("T", [paragraph(1), paragraph(2)]) ]`.
- Assert: `pages.create` called exactly once; `pages.create.mock.calls[0][0].children[0].toggle.children` matches the two paragraphs verbatim (after `normalizeBlockRichTextForWrite`); `blocks.children.list` NOT called; `blocks.children.append` NOT called; `pages.update` NOT called.

**2. `G2b-shape — 40 toggles each with depth-2 children resolve in one pages.create call (perf regression guard)`**
- Setup: `Array.from({ length: 40 }, (_, i) => toggle(`T${i}`, [paragraph(i)]))`.
- Assert: `pages.create` called once with 40 toggle blocks, each carrying its single paragraph inline; `blocks.children.list` and `blocks.children.append` never called. This is the explicit regression-prevention test for the audit's failure mode.

**3. `inlines callout, bulleted_list_item, numbered_list_item, and toggleable-heading depth-2 children consistently`**
- Setup: one of each: `callout("C", [paragraph(1)])`, `bullet("B", [paragraph(1)])`, `numberedListItem("N", [paragraph(1)])`, `toggleableHeading(1, "H1", [paragraph(1)])`, `toggleableHeading(2, "H2", [paragraph(1)])`, `toggleableHeading(3, "H3", [paragraph(1)])`.
- Assert: single `pages.create` call; each top-level block has its `body.children` carrying the paragraph; no deferred appends. Pins the "every optional-container kind, including all three toggleable heading levels" requirement.

**4. `still defers a toggle that contains a nested toggle (depth-3 grandchildren), but inlines the inner toggle's leaf paragraph in the deferred append`**
- Setup: `[ toggle("Outer", [paragraph(1), toggle("Inner", [paragraph(2)])]) ]`.
- Assert: `pages.create` called once with outer toggle having NO inline children (stripped, because Outer's child "Inner" has its own children → predicate condition 4 fails); one `blocks.children.list` against the page id; **exactly one** `blocks.children.append` against the outer toggle's id carrying `[paragraph(1), innerToggleWithInlineParagraph(2)]` — the inner toggle is inlined in the deferred append because the deferred append is itself a top-of-request entry point and `Inner` satisfies the predicate (1 leaf child, no grandchildren). Total: 1 create + 1 list + 1 append. (Per-request inlining is the design — see Decision 6.)

**4a. `still defers a toggle whose body is a markdown nested list (toggle containing bulleted_list_item with its own children)`**
- Setup: `[ toggle("T", [ bullet("parent", [bullet("child")]) ]) ]`. This is the shape produced by the markdown `+++ T\n- parent\n  - child\n+++` via `src/markdown-to-blocks.ts` — the most common real-world depth-3-in-toggle case.
- Assert: `pages.create` called once with the toggle's children stripped (predicate condition 4 fails on "parent" — it has its own "child"); one `blocks.children.list`; one `blocks.children.append` against the toggle id carrying `[bulletParent]` with `bulleted_list_item.children` *inlined* `[bulletChild]` (because in the deferred append, "parent" satisfies the predicate — 1 leaf child, no grandchildren). Total: 1 create + 1 list + 1 append. Pins the real markdown-list-in-toggle path that test (4) does not literally cover.

**5. `still defers a toggle whose child is a paragraph with its own children (paragraph-with-children = depth-3 risk)`**
- Setup: `[ toggle("T", [{ type: "paragraph", paragraph: { rich_text: [...], children: [paragraph(1)] } }]) ]`.
- Assert: `pages.create` called once with toggle children stripped; deferred append fires. Pins the "no grandchildren" rule independent of block type — paragraphs-with-children also fall through to defer.

**6. `chunks a toggle with 101 direct depth-2 children via the deferred path (>100 child guard)`**
- Setup: `[ toggle("T", makeBlocks(101)) ]`.
- Assert: `pages.create` called once with toggle children stripped; `blocks.children.list` called once on the page; `blocks.children.append` called twice on the toggle (chunks of 100 + 1) — i.e., the existing chunking path at `:293` is taken. The inline path must not bypass the 100-child request limit.

**7. `does not inline an optional container's children when it appears as a column seed (depth context guard)`**
- Setup: `[ columnList([ column([ bullet("Left parent", [bullet("Left child")]) ]), column([paragraph(2)]) ]) ]`.
- Assert: the `column_list` payload sent to `pages.create.children[0]` has `column_list.children[0].column.children[0].bulleted_list_item.children === undefined`. The "Left child" is appended via the existing column-deferred path (one append on the "Left parent" block id). This pins the context-parameter behavior — the seed must NOT be inlined even though `canInlineChildrenInOneWrite` would return true if evaluated outside context.

**8. `inlines top-level optional-container children when the same page also contains a nested-toggle that defers (mixed payload)`**
- Setup: `[ toggle("A", [paragraph(1)]), toggle("B", [paragraph(2)]), toggle("Nested", [toggle("Inner", [paragraph(3)])]) ]`.
- Assert: `pages.create` called once with A and B carrying inline children, and "Nested" stripped; `blocks.children.list` called once; `blocks.children.append` called only for the "Nested" subtree (2 appends — outer body + inner body). Confirms a partial payload optimization works alongside the existing deferred path on the same page.

**9. `does not call rollback when pages.create succeeds with inlined children and no deferred work remains`**
- Setup: `[ toggle("T", [paragraph(1)]) ]`.
- Assert: `pages.update` never called. Pins that we don't accidentally enter the rollback `try` block when there's no deferred work.

**10. `rethrows pages.create failure without rollback when inline payload is rejected by Notion`**
- Setup: `[ toggle("T", [paragraph(1)]) ]`; mock `pages.create` to throw.
- Assert: `createPage(...)` rejects with the original error; `pages.update` never called; `blocks.children.list` never called; `blocks.children.append` never called. Pins the "no page id → no rollback" semantics for the inline-validation-failure case. (This is the rollback-fidelity test for the new code path.)

**11. `appendBlocks chunks 200 top-level toggles at 100 per request and inlines each toggle's leaf children inside the chunk`**
- Setup: `appendBlocks(notion, "page-id", Array.from({ length: 200 }, (_, i) => toggle(`T${i}`, [paragraph(i)])))`.
- Assert: `blocks.children.append` called exactly 2 times (chunks of 100 + 100); each chunk's `children` payload has every toggle carrying `toggle.children = [paragraph]` inline; `blocks.children.list` NOT called (no deferred work after inlining). Pins the chunking ⊕ inline interaction in `appendPreparedBlocks` (`:285-322`) for the `appendBlocks` entry point — the perf win extends beyond `createPage` to any `appendBlocks`-driven write.

### Regression tests that must keep passing (existing) — with expectation updates required by per-request inlining

- `appends deeply nested list children recursively without grandchildren in the first request` (`:370-401`) — **expectation update required.** Today's expectation: 4 sequential `append` calls (page → Level 1 → Level 2 → Level 3, each with its child stripped). After this change: **3 appends.** The Level 2 → Level 3 append carries Level 3 with its `bulleted_list_item.children = [Level 4]` inlined, because the predicate sees Level 3 as a 1-leaf-child container with no grandchildren in that request root. The test's assertions on append count, target block_ids, and per-call child shape must be updated. Add an explicit assertion that the final append has Level 3 carrying inline Level 4 children (proves per-request inlining fires across the deferred chain, not just at `createPage`).
- `chunks deferred direct children at 100 while preserving order` (`:403-417`) — **expectation update may be required.** Today: 3 appends (1 with toggle stub, 100 children, 1 child). With per-request inlining: the 100-child append and 1-child append still go to the toggle id (predicate condition 3: children.length > 100 → fail). Hmm, in this test the toggle has 101 children, so the first append is the toggle stub via `appendBlocks` → `appendPreparedBlocks` at top of request → `prepareBlockForWrite(toggle, atTopLevel=true)`. The predicate fails on condition 3 (101 children > 100) → strip + defer. Then the deferred path chunks into 100 + 1 appends. Expectation: **unchanged** (3 appends), but builder should re-verify against current behavior after implementing.
- `defers nested callout children recursively without grandchildren in the first request` (`:419-437`) — **expectation update required.** Today: 3 appends (`page-id → Callout`, `Callout → Parent`, `Parent → Block 1`). After this change: **2 appends.** The `Callout → Parent` append carries `Parent` with `bulleted_list_item.children = [Block 1]` inlined (Parent's only child is the paragraph, no grandchildren). Update assertions accordingly.
- `creates column lists with required column seed children and defers deeper column content` (`:439-469`) — the column-seed depth context guard for which test (7) is the analogue at `createPage`. **Expectation update may be required.** Today: 3 appends. After this change: the "Left parent" deferred append carries its "Left child" inline (predicate satisfied: 1 leaf child, no grandchildren) → that's a single append to the "Left parent" id, not a chain. Net: **2 appends** instead of 3. Builder must re-verify and update.
- `uses a safe placeholder seed when a column starts with a table` (`:471-498`) — unaffected; the column seed is a table, table seeding logic is unchanged. Verify no behavior shift.
- `trashes the created page and rethrows when a deferred nested append fails` (`:500-520`) — rollback fidelity for the deferred path. With the inline path, this case (bullet-with-children at top level) is still deferred at `createPage` (grandchildren present). The deferred append for "Parent" may now collapse "Child" inline → 1 append instead of 2 deferred. **Mock error count may need adjustment** so the throw still fires on the right call. Builder must re-verify.
- `trashes the created page and rethrows the original error when overflow append fails` and `still rethrows the original append error if rollback fails` (`:323-354`) — paragraph overflow path; unaffected by this change. Paragraphs aren't optional containers.
- `appendBlocks chunks at 100 blocks and preserves order` (`:356-368`) and `appendBlocksAfter` tests (`:522-559`) — unaffected (paragraph payloads only).
- `splits long deferred nested code rich_text before appending child blocks` (`:253-264`) — today: 2 appends (page → toggle, toggle → code). After this change: **1 append** — the toggle's code-block child is a leaf (code has no children), satisfies the predicate, gets inlined in the page-level append request. Wait — actually this calls `appendBlocks(notion, "page-id", [toggle("Toggle", [codeBlock(content)])])`, not `createPage`. Same logic applies: `appendPreparedBlocks` is top-of-request; the toggle satisfies the predicate; inline the code block. Expected: 1 append. Update assertions on call count and verify the inline payload still preserves the split rich-text in `code.rich_text`.
- `splits long callout child rich_text through deferred child appends` (`:266-284`) — today: 1 create + 1 append. After this change: the callout has 1 paragraph leaf child → satisfies the predicate → inlined in `pages.create`. Expected: **1 create, 0 appends.** Update assertions accordingly; verify the inline `callout.children[0].paragraph.rich_text` carries the split-into-2 segments.

## Runtime premises (must be verified by test or runtime probe)

1. **Notion accepts `toggle.children` inline in `pages.create.children[]`.** Strongest evidence: the existing G2b passing-but-slow run at 43 080 ms (5/11 09:51 main) on `cbc864a`'s parent commit proves the *deferred* path works; after this fix, a green G2b run under ~5 s proves the *inline* toggle path works against live Notion. The existing per-toggle markdown emission at `src/markdown-to-blocks.ts:625-635` already produces this shape — we are just no longer stripping it.

2. **Notion accepts `callout.children`, `bulleted_list_item.children`, `numbered_list_item.children`, and `heading_{1,2,3}.children` (with `is_toggleable: true`) inline in `pages.create.children[]`.** Coverage today: only the toggle case has live coverage via G2b. Documented support for inline child blocks on these types: <https://developers.notion.com/reference/block> (block type schemas with `children` arrays) and <https://developers.notion.com/reference/patch-block-children> (nesting limits). **Builder action required:** either (a) add a targeted live-Notion smoke test in `tests/e2e/live-mcp.test.ts` that creates a page with one of each kind carrying inline depth-2 children (preferred — locks the premise in CI), or (b) explicitly accept the doc claim and rely on test (10) to surface a real-world rejection cleanly. If (a) is chosen, scope it to one block per kind — not a 40-of-each repro; the goal is shape verification, not perf.

3. **`normalizeBlockRichTextForWrite` already recurses into a block's `.children` array for every type the inline path touches.** Verified at `src/rich-text.ts:85-201` (cases for `toggle`, `bulleted_list_item`, `numbered_list_item`, `callout`, `heading_1/2/3`, and the column/column_list/table family). Implication: when `prepareBlockForWrite` normalizes the parent block, the children's rich-text is *already* split, so the inline branch's recursive `prepareBlockForWrite(c, false)` is idempotent on rich-text normalization. **Builder action:** add a child-rich-text length assertion to at least one of tests (1)–(3) that drives a > 2000-char paragraph child through the inline path — this pins the premise that rich-text normalization survives the inline route, in case `rich-text.ts` is refactored.

4. **The 100-child Notion request limit applies to a single container's `.children` array, not just to top-level `pages.create.children`.** Source: <https://developers.notion.com/reference/patch-block-children> ("Returns a 400 if the number of children exceeds 100"). Predicate condition (3) (`children.length <= NOTION_BLOCK_CHILDREN_LIMIT`) is what enforces this; test (6) pins the fallback to the chunked deferred path.

5. **The Notion "two-level nesting per request" rule allows request-root depth-2.** Source: documented behavior + existing column_list test at `tests/notion-client-block-chunking.test.ts:439-469` which already sends a request at depth-3 from page root (column_list → column → seed) and is accepted. Per-request inlining keeps each request at depth-2 max from request root (the predicate's no-grandchildren clause guarantees this). Confidence: high — matches the existing recorded learning at `.claude/rules/tasuku/learnings-notion-client-ts.md`.

## Files touched

**Product code (one file):**
- `src/notion-client.ts` — add `canInlineChildrenInOneWrite`, parameterize `prepareBlockForWrite` and `needsDeferredChildWrites`. Estimated ~30 LoC added + ~15 LoC modified. No new imports.

**Tests (one file):**
- `tests/notion-client-block-chunking.test.ts` — add 12 new tests (1–11 and 4a), update expectations on 6 existing tests (per "Regression tests" above), add 1–2 helpers (`numberedListItem`, `toggleableHeading`). Estimated ~320 LoC added + ~80 LoC modified.

**Optional e2e (recommended, for premise 2):**
- `tests/e2e/live-mcp.test.ts` — add a one-shot "create_page with one of each optional-container kind carrying inline depth-2 children" test (scoped tight, < 5 s budget). Locks premise 2 in CI. Builder may defer if scope pressure exists; if deferred, file a backlog tasuku task and surface to orchestrator before closing the build dispatch.

**No other files in scope.** No README, no CLAUDE.md, no markdown parser, no e2e fixture changes. The G2b e2e test itself is the integration verification; no edits to its body.

## Implementation order (TDD)

1. **Write the new tests first** (red): tests 1–11 plus 4a. Most will fail because the inline path doesn't exist yet. Run vitest and confirm the failure shape matches expectation — this proves the tests are testing the right thing.
2. **Update the existing-test expectations** that will shift due to per-request inlining (the regression-tests list above): `:253-264`, `:266-284`, `:370-401`, `:419-437`, `:439-469`, `:500-520`. Run vitest again — these should now fail in the *predicted* way (the test currently expects N appends, the code still does N appends, but after step 3 the code will do fewer). Leave them red for now and re-green them after step 3.
3. **Add `canInlineChildrenInOneWrite`** in `src/notion-client.ts` near the existing `isOptionalChildrenContainer` (~line 135). Same name, exact conditions per "Predicate spec."
4. **Parameterize `prepareBlockForWrite(block, atTopLevel = true)`** and add the inline branch in the optional-container path. The single internal recursion call to update is the column-seed call at the current `:182` — pass `atTopLevel: false` explicitly. The column_list children-map at `:170` (which prepares columns) and the table-rows seed at `:160` (which prepares the first row inline) also need `atTopLevel: false`. Top-level callers (`createPage:1030`, `appendPreparedBlocks:297`) use the default and need no changes.
5. **Parameterize `needsDeferredChildWrites(block, atTopLevel = true)`** with the optional-container branch from "Context parameter" above. The internal recursive call sites that MUST pass `atTopLevel: false`:
   - `:203` — `needsDeferredChildWrites(children[0])` inside the column branch (column seed is at sub-top-level).
   - `:207` — `needsDeferredChildWrites(child)` inside the column_list branch (columns are inside column_list, not at request root).
   - `:254` — `needsDeferredChildWrites(children[0])` inside `appendDeferredChildren` for the column path (re-checks the column seed during deferred replay; same context as `:203`). **This is the call site Codex's pressure-test specifically flagged — if it defaults to `true`, the column seed's children are silently dropped because the inline path would have considered them inlinable.**
   - `:267` — `needsDeferredChildWrites(column)` and `:273` — `needsDeferredChildWrites(columns[index])` inside `appendDeferredChildren` for the column_list path (each column is at sub-top-level within its column_list).
   Top-level callers (`createPage:1021`, `:1041`, `appendPreparedBlocks:310`) use the default and need no changes.
6. **Run vitest until green.** New tests (1-11, 4a) pass. Existing tests (the regression-update list) pass with their new expectations.
7. **Run typecheck + lint.** `npm run build`, `npm test`. No type changes expected — the signature change is backwards-compatible via default parameter.
8. **Optional but recommended: live-Notion smoke test.** If Notion creds are available, run a one-off scratch script (or a new tier-0 e2e) that creates a page with one of each optional-container kind carrying inline children. Confirms premise 2 above.
9. **Confirm G2b runtime drops.** Either by running the e2e suite locally with `NOTION_TOKEN`, or by pushing to a PR and watching the next scheduled e2e run. Expected: G2b ~1–2 s wall-clock vs. today's 20–60 s.

## Rollback semantics (explicit)

- **`pages.create` validation failure with inlined children (new path):** Notion returns an error before issuing a page id. No page exists, no rollback needed. Test (10) pins this.
- **`pages.create` succeeds, deferred-append fails (mixed payload — some inline, some deferred):** unchanged from today. The existing try/catch at `:1037-1062` trashes the created page and rethrows the original error. Existing tests at `:500-520` and `:323-354` cover this.
- **`pages.create` succeeds, `blocks.children.list` (deferred-id recovery) fails:** same try/catch covers it.
- **`pages.update({in_trash:true})` itself fails (rollback failure):** preserve original error per the recorded learning ("Always preserve the original append/deferred-write error when best-effort rollback fails…"). Existing test at `:341-354` pins this; unaffected.

## Open questions (none blocking — builder decides at write-time)

None. Codex's review of the audit already specified the predicate conditions, the lockstep coupling, the heading scope, and the 100-child / no-grandchildren constraints. The plan resolves all of them.

## Builder estimate

**~3–4 hours wall-clock** for the next dispatch (Codex builder). The estimate bumped from 2–3 h after the Codex pressure-test surfaced the existing-test-expectation-updates and the per-request-inlining design implications — both add real work beyond "write new tests + new predicate."

- 45–60 min: write the 12 new tests against the current (red) code and confirm they all express the intended contracts.
- 30–45 min: update the 6 existing tests' expectations to reflect per-request inlining (they will fail in the *current* code in their *new* expected shape — i.e., expect fewer appends; they will go red until the implementation lands).
- 60–75 min: implement the predicate + context parameter (5 specific call sites for `needsDeferredChildWrites`, 3 for `prepareBlockForWrite`); iterate to green.
- 30 min: run full unit suite + lint/typecheck.
- 30 min: optional one-shot live-Notion smoke for premise 2 (one of each kind carrying inline children).
- 15–30 min: optional local e2e G2b run if Notion creds available (confirms wall-clock drop from 20–60 s to ~1–2 s).

Total LoC: ~400 added, ~95 modified, single product file + single test file (+ optional one-shot e2e test).

## Codex pressure-test record

**Session:** `plan-rev-cp-inline-v2-2026-05-13` (mcp-cli, default model, sync). Two prior sessions of the same prompt failed: the first (`plan-rev-createpage-inline-perf`) returned an empty response under a `gpt-5-codex` model override, and a smoke-test of codex availability confirmed the daemon was healthy under the default model. Re-dispatching without the model override succeeded.

**Six findings, all integrated.** Codex did not approve the draft. Each finding is named below with file:line evidence, the integration into the plan, and (where relevant) why I integrated rather than overruled.

### Finding 1 — Context-parameter bug at `src/notion-client.ts:254`
`appendDeferredChildren` for the column path calls `needsDeferredChildWrites(children[0])` (the column seed). The default-true `atTopLevel` parameter would make the inline path consider the seed inlinable → return false → the seed's deeper children get silently dropped on replay. Integration: explicitly named `:254` (and the column branch at `:203`, the column_list branch at `:207`, the column_list deferred path at `:267` and `:273`) in the implementation order step 5 with the rule "pass `atTopLevel: false`." Test (7) already covers the user-visible symptom; the implementation instructions now name the call site so the builder doesn't have to re-derive.

### Finding 2 — Per-request inlining ≠ create-page-only
Codex flagged that with `atTopLevel = at-request-root`, the inline branch fires inside every `blocks.children.append` request, not just `pages.create`. That changes the existing 4-level-bullet test (which expects 4 sequential appends) to 3 appends, and the nested-toggle test (which the draft expected to fire 2 appends) to 1 append. Integration: **embraced per-request inlining as the design** (Decision 6) rather than adding an "internal append context" that would disable it. Reasoning: (a) per-request inlining is a natural perf win, not a bug; (b) each request stays at depth-2 max from request root, which is within Notion's documented limit; (c) the alternative complicates the model. The draft test (4) was updated to expect 1 append instead of 2, and 6 existing tests were marked for expectation updates with explicit predicted call counts. **This is the largest integration — the plan is now meaningfully different from the draft.**

### Finding 3 — Depth-3 test gap (markdown list inside toggle)
The draft's test (4) covered nested toggles and test (5) covered an artificial paragraph-with-children, but neither pinned the most common real shape: `+++ T\n- parent\n  - child\n+++`. Integration: added **test (4a)** with the explicit `[toggle("T", [bullet("parent", [bullet("child")])])]` fixture. Confirms that real markdown list nesting inside a toggleable container stays deferred at `createPage` and that the deferred replay then inlines the inner leaf level via per-request inlining.

### Finding 4 — `appendBlocks` 200-toggle chunking case
The draft tested `createPage`-driven inlining but not `appendBlocks`-driven inlining. Integration: added **test (11)** for 200 top-level toggles via `appendBlocks` → 2 × 100-chunk appends, each with inline children, zero `blocks.children.list`. Pins that the chunking-at-100 logic in `appendPreparedBlocks` cooperates with the inline branch.

### Finding 5 — Runtime premise 1 overclaimed e2e coverage
The draft implied G2b proves all five optional-container kinds inline. G2b only proves toggle. Integration: split premise 1 (toggle, proven by G2b) from premise 2 (callout, lists, toggleable headings — currently only doc-supported, not e2e-proven). Builder action added: either land a one-shot live-Notion smoke test for one-of-each-kind, or explicitly accept the doc claim. Doc URLs cited inline. Codex also flagged `to_do`, `paragraph`, `quote`, and toggleable `heading_4` as Notion-supported child-capable types — none of which are in our `isOptionalChildrenContainer` predicate, so they are not expanded here (out-of-scope; would be a separate ticket).

### Finding 6 — Premise 3 was factually wrong
The draft claimed `normalizeBlockRichTextForWrite` does not recurse into `.children`. Codex correctly pointed to `src/rich-text.ts:85-201` which already recurses for every type the inline path touches. Integration: rewrote premise 3 to affirm the recursion (with the file:line reference), preserve the builder action (add a long-rich-text child assertion to lock the premise in case `rich-text.ts` is refactored), and remove the incorrect rationale.

### What I rejected (none)
I did not reject any of Codex's findings. All six were grounded in file:line evidence and matched what I verified independently against `src/rich-text.ts:85-201` (finding 6) and the existing test suite (findings 2, 3, 4). The largest design choice forced by the review — embracing per-request inlining instead of suppressing it — was endorsed by Codex as one of two valid paths; I chose it for the reasons listed above.

### Re-review (deferred)
Optional but recommended: after the builder lands the code, dispatch a second Codex review (read-only) against the implemented diff to confirm no further drift. Not required — the integrated plan reflects all of Codex's substantive concerns.

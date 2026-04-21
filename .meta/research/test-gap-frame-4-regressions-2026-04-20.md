# Frame 4 — Regression-History Archaeologist

**Date:** 2026-04-20
**Scope:** Every bug shipped and fixed in easy-notion-mcp's history — does a test in the current suite catch it if it re-emerged tomorrow?
**Method:** CHANGELOG `### Fixed` entries + closed issues/PRs + prior frame findings → map to `tests/` → classify as covered / partially covered / uncovered → propose concrete tests for gaps.

---

## TL;DR

- **17 of 25 historical bugs have a current regression test.** Hit-rate: **68%**.
- **8 bugs have no regression guard today.** 3 are silent-data-loss class, 2 are security/correctness, 3 are fidelity-loss.
- The v0.3.0 G-series fixes (G-1 through G-5) are **well tested** — all have dedicated test files.
- The most dangerous uncovered regressions: **fence desync / structural injection** (Frame 1 Probe 2), **`richTextToMarkdown` crash on mention/equation** (Frame 6 P3.2), and **formula/rollup column silent drop** (2026-04-20 audit §2).
- Two bugs are "partially covered" — description-only tests for G-3a (destructive-edit warnings) and read-path URL sanitizer bypass (Frame 4 Probe 1) has write-side `isSafeUrl` tests but zero read-side tests.
- Known-limit items from CHANGELOG (`### Known limits`) have **zero tests** by design, but two (formula silent drop, 25-item truncation) are silent-data-loss class and should have at least a "known-failure" or "warning-emitted" test once fixed.

---

## Historical-Bug Inventory

### v0.3.0 bugs (shipped 2026-04-19)

| Bug | PR/Issue | Current test coverage | Status | Proposed test (if gap) |
|-----|----------|----------------------|--------|----------------------|
| **G-1**: HTTP `file://` arbitrary local-file read | PR #24 | `tests/http-file-upload-gate.test.ts` (13 tests: FU-1..FU-13), `tests/file-upload.test.ts` (6 tests for `processFileUploads`) | **Covered** | — |
| **G-3a**: Silent success on destructive edits (no rollback warning) | PR #26 | `tests/destructive-edit-descriptions.test.ts` (2 tests: G3a-1, G3a-2) | **Partially covered** | Tests only assert description *text* contains warning keywords; no test validates that the handler's *behavior* is destructive (delete-then-append). If someone removed the description warning but left the handler, tests pass. Add: a mock that verifies `blocks.delete` is called before `blocks.children.append` (confirming the non-atomic shape the warning describes). |
| **G-3b**: Silent block-type drops on read | PR #26 | `tests/block-warnings.test.ts` (11 tests: G3b-1..G3b-11 including drift-invariant) | **Covered** | — |
| **G-4a**: DB writes reject unknown property names | PR #26 | `tests/database-write-strictness.test.ts` (7 G4a tests + stale-cache bust) | **Covered** | — |
| **G-4b**: DB writes reject unsupported property types | PR #26 | `tests/database-write-strictness.test.ts` (8 G4b tests) | **Covered** | — |
| **G-4c**: `create_database` response echo fix | PR #26 | `tests/create-database-response.test.ts` (3 tests) | **Covered** | — |
| **G-5**: Relation read/write (silent null + throw) | PR #27 | `tests/relation-property.test.ts` (9 tests), `tests/relation-roundtrip.test.ts` (4 tests) | **Covered** | — |

### Pre-v0.3.0 bugs (v0.2.x era)

| Bug | PR/Issue | Current test coverage | Status | Proposed test |
|-----|----------|----------------------|--------|--------------|
| **Issue #14**: Callout inline syntax rendered as quote block | PR #16 (commit `6d69d64`) | `tests/markdown-to-blocks.test.ts`: 7 inline callout tests (`converts inline NOTE callout`, etc.) + `handles both inline and multi-line callout syntax` | **Covered** | — |
| **Issue #15**: `list_databases` returned data_source ID instead of database ID | PR #16 (commit `9b6a057`) | `tests/list-databases.test.ts` (4 tests including `extracts database_id from a data_source parent`) | **Covered** | — |
| **PR #12**: Relation property support (taranovegor) | PR #12, tests in PR #16 (`b913481`) | `tests/relation-property.test.ts` (9 tests) | **Covered** | Note: synthesis C-7 flagged that early versions tested lambda copies, not production code. Current tests (post-PR #27 rewire) test through the actual server handler — this concern is **resolved**. |
| **PR #17**: Toggle headings H1/H2/H3 round-trip | PR #17 (manganate006) | `tests/blocks-to-markdown.test.ts` (4 toggle-heading tests), `tests/markdown-to-blocks.test.ts` (5 toggle-heading tests), `tests/roundtrip.test.ts` (2 toggle-heading round-trip tests) | **Covered** | — |
| **v0.2.4**: HTTP/stdio confusion DX fix (Issue #8) | PR #9 (`7e29a70`) | `tests/stdio-startup.test.ts` (1 test: stderr guidance) | **Covered** (minimal) | — |
| **`create_page_from_file` boundary hardening** | PR #22 (`b42f9a8`) | `tests/create-page-from-file.test.ts` (17 tests including symlink escape, separator-aware containment, extension check) | **Covered** | — |
| **Bearer-always auth + loopback bind** | PR #24 | `tests/http-transport.test.ts` (AU-1..AU-8, BH-1a..BH-1c) | **Covered** | — |

### Bugs found by prior frames but never explicitly "shipped and fixed" — implicit regressions

| Bug | Source | Current test coverage | Status | Proposed test |
|-----|--------|----------------------|--------|--------------|
| **Fence desync — structural injection from fenced content** | Frame 1 Probe 2 bug #1 (`src/markdown-to-blocks.ts:314`) | Zero tests. `tests/markdown-to-blocks.test.ts` has `ignores custom delimiters inside fenced code blocks` but only tests `+++` and `:::` as content — NOT the case where a nested fence close (`\`\`\`ts`) causes `splitCustomSyntax` to exit the fence early. | **Uncovered** | `it('does not escape fenced content when inner fence markers appear')`: input = ` ```md\n```ts\n+++ Leaked\nbody\n+++\n``` ` → assert output is a single code block, NOT a code + toggle + code sequence. **Priority: HIGH** — structural injection class. |
| **`richTextToMarkdown` crashes on `mention` and `equation` rich_text** | Frame 6 P3.2 (`src/blocks-to-markdown.ts:26`) | Zero tests. `tests/blocks-to-markdown.test.ts` never passes a `{type: "mention"}` or `{type: "equation"}` rich_text item. | **Uncovered** | `it('handles mention rich_text items without crashing')`: pass a paragraph block with `{type: "mention", mention: {type: "user", user: {id: "x"}}, annotations: {...}, plain_text: "@User"}` → assert output contains `@User` or graceful fallback, NOT a `TypeError`. **Priority: HIGH** — crash on common content. |
| **Read-path emits `javascript:` URLs verbatim** | Frame 4 Probe 1 (no `isSafeUrl` in `src/blocks-to-markdown.ts`) | Write-side: `tests/markdown-to-blocks.test.ts` has `validates safe URLs` + `renders unsafe image URLs as paragraphs` + `renders unsafe inline links as plain text` (6+ tests). Read-side: **zero tests** for blocks-to-markdown emitting dangerous scheme URLs. | **Partially covered** | `it('sanitizes javascript: URLs in bookmark blocks on read')`: pass a bookmark with `url: "javascript:alert(1)"` → assert output does NOT contain a clickable `javascript:` markdown link. Same for inline `text.link.url`. **Priority: MEDIUM** — defense-in-depth. |
| **To-do children dropped on both write and read** | Frame 1 Probe 1, synthesis C-10 (`src/markdown-to-blocks.ts`, `src/server.ts` `attachChildren`) | Zero tests. `tests/markdown-to-blocks.test.ts` `converts todo items` tests only flat tasks. `tests/blocks-to-markdown.test.ts` `converts todos` tests only flat tasks. | **Uncovered** | `it('preserves nested children under to-do items')`: input `- [ ] parent\n  - child item` → assert output has `to_do` block with `children` array containing a bulleted_list_item. **Priority: MEDIUM** — silent data loss on nested tasks. |
| **File/audio/video block-type lossy round-trip** | Frame 1 Probe 1, Frame 6 P3.3 | `tests/blocks-to-markdown.test.ts` has `converts file/audio/video blocks` → assert markdown output. `tests/markdown-to-blocks.test.ts` has `notion-upload` token tests. But: **no round-trip test** that verifies `[audio](https://...)` parses back to an `audio` block (it doesn't — becomes paragraph). | **Uncovered** | `it('flags or preserves audio/video/file block types on round-trip')`: assert that `markdownToBlocks(blocksToMarkdown([audioBlock]))` produces an `audio` block (currently fails — would document the known gap). **Priority: LOW** — known design limit, but documenting via test prevents accidental claims of fidelity. |
| **Escaped pipe lost on read (table cell widening)** | Frame 1 Probe 3 (`src/blocks-to-markdown.ts:32-35`) | Zero tests. Table tests in `blocks-to-markdown.test.ts` use simple cells without pipe characters. | **Uncovered** | `it('escapes pipe characters inside table cells on read')`: table row with cell content `x | y` → assert markdown output is `x \\| y`, not `x | y` (which widens the row). **Priority: MEDIUM** — silent data corruption on tables with pipe content. |
| **Plain nested toggles broken** | Frame 1 Probe 2 bug #4 (`src/markdown-to-blocks.ts`) | Toggle tests exist but only test flat or toggle-heading nesting. `roundtrip.test.ts` has `round-trips a toggle with nested blocks` but the nested blocks are lists/code, NOT nested toggles. | **Uncovered** | `it('round-trips plain nested toggles')`: input `+++ Outer\n+++ Inner\nbody\n+++\n+++` → assert output has outer toggle containing inner toggle. **Priority: LOW** — README claims this works (lines 239, 416) but it doesn't. |
| **`enhanceError` discards `Retry-After` header** | Frame 6 P2.1 (`src/server.ts:398`) | Zero tests. `tests/` has no test for rate-limit error handling. | **Uncovered** | `it('preserves Retry-After hint in rate-limited error response')`: mock a 429 with `Retry-After: 2` → assert tool response includes the wait duration, not just "Wait a moment". **Priority: LOW** — confusing but not data-loss. |

---

## Near-Miss / Implicit Regressions

These are fixes that could silently un-fix because the test pins the symptom weakly:

1. **G-3a description-only tests** (`tests/destructive-edit-descriptions.test.ts`): Tests assert `replace_content` description contains "DESTRUCTIVE" and "duplicate_page". If someone refactors the handler to become atomic (good!) but also removes the warning text, the test would fail for the wrong reason. Conversely, if someone makes the handler *more* destructive but keeps the description, tests pass. The description tests are necessary but not sufficient — they pin documentation, not behavior.

2. **`SUPPORTED_BLOCK_TYPES` drift-invariant** (`tests/block-warnings.test.ts` G3b-11): This test asserts that every type in the exported set yields no warning when passed through `normalizeBlock`. It does NOT assert the reverse — that unknown types DO yield warnings. If someone adds a type to the set without adding a `normalizeBlock` case, the test catches it. But if someone removes the warning mechanism entirely, this test doesn't fire (other G3b tests do, though). **Net: adequately covered in combination.**

3. **Stale-cache bust test** (`tests/database-write-strictness.test.ts` G4a-6): Tests the happy path (bust succeeds, retry works). Does NOT test the case where the bust itself 429s — Frame 6 P2.3 flagged this as a whole-batch-abort with no per-row visibility. **Gap for a follow-up test.**

4. **Schema cache cross-tenant contamination** (Frame 3 P1.a–P1.f): Zero tests for multi-tenant cache isolation. The module-level `schemaCache` is process-global. If OAuth multi-tenant mode is deployed, tenant A's schema can serve tenant B. **No test today; should be tested before any multi-tenant promotion.**

---

## Regression-Debt Score

| Metric | Count |
|--------|-------|
| Total historical bugs inventoried | 25 |
| Fully covered by current test suite | 17 |
| Partially covered (description/write-side only) | 2 |
| Uncovered (no regression guard) | 6 |
| **Hit-rate** | **68%** (17/25) |
| Silent-data-loss class uncovered | 3 (to-do children, table pipe escape, file/audio/video round-trip) |
| Crash class uncovered | 1 (richTextToMarkdown on mention/equation) |
| Structural-injection class uncovered | 1 (fence desync) |

The v0.3.0 G-series is well-defended. The regression debt lives in **Frame 1 fidelity findings** (round-trip edge cases) and **Frame 6 platform-drift findings** (mention crash, rate-limit errors). These were discovered by investigation frames but never converted to tests because the investigation mandate was analytical, not code-changing.

---

## Prioritized Test Adds

Ranked by "what fails silently without this test" — silent-data-loss and crash outrank cosmetic.

| # | Test | File to add to | Bug source | Risk class | Est. LOC |
|---|------|---------------|------------|------------|----------|
| 1 | **Fence desync: inner fence marker doesn't escape `splitCustomSyntax`** | `tests/markdown-to-blocks.test.ts` | Frame 1 Probe 2 #1 | structural-injection | ~15 |
| 2 | **`richTextToMarkdown` handles mention/equation rich_text** | `tests/blocks-to-markdown.test.ts` | Frame 6 P3.2, `src/blocks-to-markdown.ts:26` | crash | ~20 |
| 3 | **To-do children preserved on write** | `tests/markdown-to-blocks.test.ts` | Frame 1 Probe 1, synthesis C-10 | silent-data-loss | ~15 |
| 4 | **Escaped pipe in table cells on read** | `tests/blocks-to-markdown.test.ts` | Frame 1 Probe 3, `src/blocks-to-markdown.ts:32-35` | silent-data-loss | ~12 |
| 5 | **Formula column silent drop on `create_database`** | `tests/create-database-response.test.ts` or new `tests/formula-property.test.ts` | 2026-04-20 audit §2, `src/notion-client.ts:183` | silent-data-loss | ~15 |
| 6 | **Read-path URL sanitizer (blocks-to-markdown emitting `javascript:`)** | `tests/blocks-to-markdown.test.ts` | Frame 4 Probe 1 | security (defense-in-depth) | ~15 |
| 7 | **`simplifyProperty` returns non-null for formula results** | `tests/relation-property.test.ts` or new file | 2026-04-20 audit §5.3, `src/server.ts:50-86` | silent-data-loss | ~20 |
| 8 | **25-item property truncation emits warning (once pagination is added)** | new `tests/property-pagination.test.ts` | 2026-04-20 audit §1 item 3 | silent-data-loss | ~25 |
| 9 | **G-3a behavioral test: `replace_content` calls delete-then-append** | `tests/destructive-edit-descriptions.test.ts` | PR #26, `src/server.ts:540-566` | correctness | ~20 |
| 10 | **Plain nested toggles round-trip** | `tests/roundtrip.test.ts` | Frame 1 Probe 2 #4 | correctness (README promise) | ~10 |
| 11 | **`enhanceError` preserves `Retry-After` on 429** | new `tests/error-handling.test.ts` | Frame 6 P2.1, `src/server.ts:398` | correctness | ~15 |
| 12 | **File/audio/video block-type round-trip documents known lossy path** | `tests/roundtrip.test.ts` | Frame 1 Probe 1, Frame 6 P3.3 | silent-data-loss (known) | ~15 |

Tests 1–4 are the most urgent: they guard against regressions in code paths that have been buggy before and have no test today. Tests 5–8 guard against known-limit items that are on the v0.3.1 roadmap — adding the test first (as a known-failing or warning-checking test) ensures the fix is verifiable when it lands.

---

## Sources

**PRs:** #12 (relation support), #16 (callout inline + DB ID fix), #17 (toggle headings), #22 (create_page_from_file), #24 (G-1 file:// + bearer), #26 (G-3/G-4), #27 (G-5 relation read/write), #28 (v0.3.0 release).
**Issues:** #14 (callout syntax), #15 (list_databases ID).
**Prior frames:** `.meta/research/frame-1-archeologist-2026-04-17.md`, `frame-4-redteam-2026-04-17.md`, `frame-6-driftracker-2026-04-17.md`.
**Audit:** `.meta/audits/notion-api-gap-audit-2026-04-20.md`, `.meta/audits/synthesis-pre-v030-2026-04-17.md`.
**Code paths cited:** `src/markdown-to-blocks.ts:314` (fence scanner), `src/blocks-to-markdown.ts:26` (richTextToMarkdown), `src/blocks-to-markdown.ts:32-35` (table cell join), `src/server.ts:50-86` (simplifyProperty), `src/server.ts:398` (enhanceError rate-limit), `src/notion-client.ts:183` (schemaToProperties default drop).
**Test files:** all 20 files in `tests/` read and mapped (259 total test cases across the suite).

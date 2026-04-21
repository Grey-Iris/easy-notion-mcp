# Test-Gap Frame-Sweep Synthesis — easy-notion-mcp v0.3.0

**Date:** 2026-04-20
**Inputs:** Six independent test-gap frames (`test-gap-frame-{1..6}-2026-04-20.md`), the 2026-04-20 Notion API gap audit, and the agent-feedback-loop spike.
**Scope:** Inform the Tier-1 E2E harness build (`build-ee-testing-suite-for-live`) and PR1 (property-type gap closure, `notion-property-type-gap`).
**Method:** Cross-reference what each frame flagged, prioritize by convergence and risk class, map to existing tasuku work.

---

## TL;DR (orchestrator's 30-second triage)

- **Regression-debt hit rate is 68%** (Frame 4): 17 of 25 historical bugs have a test; 8 don't. The uncovered 8 cluster in round-trip fidelity and API-drift.
- **Convergence confirms the audit's top two gaps:** property-type silent drop (Frames 1, 2, 4, 6) and 25-item multi-value truncation (Frames 1, 3, 6). These are PR1 and PR2 territory and need known-gap tests written *before* the fix lands.
- **`find_replace` has zero tests** (Frames 1, 5) despite being a destructive write tool — a one-char key swap ships green.
- **No handler-level Create→Read round-trip test exists** (Frames 5, 6) — the core user journey is only exercised by pure unit tests of converters.
- **Round-trip pipeline has 3 real bugs that no test catches today** (Frame 2): multi-paragraph blockquote/callout content loss (`src/markdown-to-blocks.ts:189`), nested to-do children dropped (`:154-163`), CRLF breaks toggle/column/equation closers (`:331`).
- **Tier-1 E2E must cover 8 classes** no unit test can reach: formula round-trip, pagination past 25, file upload to CDN, OAuth lifecycle, schema cache TTL bust, transport parity, destructive-edit mid-failure, and timing-safe bearer comparison.
- **Not a unit-test problem:** five of the top-15 tests require a live Notion workspace. The mock-heavy existing suite cannot pin these contracts.

---

## 1. Convergence map — gaps flagged by 2+ frames

Ordered by frame-count × severity. Each row cites the frame(s) and at least one code anchor.

| # | Gap | Frames | File:line | Severity |
|---|---|---|---|---|
| **C1** | **Property-type silent drop on create/update schema.** `schemaToProperties` default:break drops 10+ types (formula, rollup, relation, people, files, unique_id, verification, place, button, created_time, last_edited_*, created_by, last_edited_by). Response echoes the filtered list, hiding the drop. | 1 (S2, S9), 2 (inline), 4 (row 5), 6 (T6) | `src/notion-client.ts:183-184`; `src/server.ts:1316-1321` | **Silent data loss — highest** |
| **C2** | **Property-type silent null on read.** `simplifyProperty` default returns `null`; 10 types silently become null on every `query_database` / `read_page` metadata. | 1 (S1), 4 (row 7), 6 (T6) | `src/server.ts:50-88` | **Silent data loss — highest** |
| **C3** | **Multi-value properties truncated at 25 items.** `pages.retrieve` caps title/rich_text/relation/people/rollup at 25. `pages.properties.retrieve` is never called anywhere. | 1 (S3), 3 (pagination row 4), 6 (T8) | `src/server.ts:91-97`; no caller for `client.pages.properties.retrieve` | **Silent data loss — high** |
| **C4** | **10k-row query cap silently ignored.** `queryDatabase` loops on `has_more` but never checks `request_status: "incomplete"` (April-2026 cap marker). | 1 (S7), 3 (pagination row 1) | `src/notion-client.ts:549-573` | **Silent data loss — high** |
| **C5** | **Destructive delete-then-append is pseudo-atomic and untested.** `replace_content` and `update_section` delete children, then append; a mid-sequence 429 or network failure leaves an empty page/section. Description warns but no behavioral test exists. | 3 (partial-batch row 2), 5 (tool 4/5), 6 (T15) | `src/server.ts:1057-1069`; `:1070-1122` | **Destructive — high** |
| **C6** | **`find_replace` has zero tests.** Swapping `old_str` / `new_str` keys, dropping `replace_all_matches`, or hardcoding `success: true` ships green. Also: success reported even on zero matches. | 1 (S8), 5 (tool 6, priority #1) | `src/server.ts:1123-1146` | **Correctness — high** |
| **C7** | **Handler-level Create→Read round-trip is not tested.** Converter round-trip is covered by `roundtrip.test.ts`, but no test goes through `create_page` → `read_page` handlers. `CONTENT_NOTICE` prefix, `processFileUploads` wiring, and `blocksToMarkdown` integration are all unguarded at the handler boundary. | 5 (#2, cross-tool gap 1), 6 (T11) | `src/server.ts:990-1018`, `:1147-1191` | **Correctness — high** |
| **C8** | **Table cells with `\|` not escaped on read.** `richTextToMarkdown` in table cells emits raw `\|`, breaking column alignment on re-parse. No test with pipe-containing cells. | 2 (T6), 4 (row 4) | `src/blocks-to-markdown.ts:32-35` | **Silent data loss — medium** |
| **C9** | **Nested to-do items lose children.** The `item.task` branch of `listTokenToBlocks` never attaches `children`, unlike the non-task branch directly below. `attachChildren` also omits `to_do` from its switch. | 2 (T3), 4 (row 3) | `src/markdown-to-blocks.ts:154-163`; `src/server.ts:339-341` | **Silent data loss — medium** |
| **C10** | **Parallel-switch drift risk.** Four switches — `SUPPORTED_BLOCK_TYPES`, `normalizeBlock`, `attachChildren`, `renderBlock` — must stay in sync. Only `SUPPORTED_BLOCK_TYPES ↔ normalizeBlock` has a drift guard (G3b-11). | 1 (S5/S6/S10/S11, pattern note), 4 (near-miss 2) | `src/server.ts:135-141`, `:273-341`; `src/blocks-to-markdown.ts:225-226` | **Future-silent-break — medium** |
| **C11** | **`update_section` integration untested.** `tests/update-section.test.ts` covers boundary-math unit only. No test creates a multi-section page, updates one section, reads back, and asserts the other sections are untouched. | 4 (row 9 near-miss), 5 (#5), 6 (T13) | `src/server.ts:1070-1122` | **Correctness — medium** |
| **C12** | **Search / list_pages / list_databases lack handler coverage.** Response shape, filter forwarding, and parent-field extraction are all unguarded by handler-level tests. | 5 (#3, #6, #12), 1 (S13) | `src/server.ts:1257-1272`, `:1273-1284`, `:1352-1360` | **Correctness — medium** |

**What convergence reveals:** the failure modes cluster into three structural families — (a) **allowlist-with-silent-default** switches (C1, C2, C9, C10), (b) **pagination-unaware reads** (C3, C4), and (c) **handler-boundary integration gaps** (C5, C6, C7, C11, C12). Each family wants a different test shape: (a) exhaustive property/block-type tests + drift guards, (b) live pagination probes, (c) handler-level integration through the MCP surface.

---

## 2. Unique finds per frame

Each frame surfaced at least one thing no other frame saw. These matter even without convergence because they're the "fresh eyes" payoff.

### Frame 1 (silent-failure hunter) — unique

- **S4 date-range string coercion** (`src/notion-client.ts:212`): passing a `{ start, end }` object to `convertPropertyValue("date", ...)` produces `{ date: { start: "[object Object]" } }` via blind `String(value)`. Silent corruption. No date test exists at all.
- **S14 `getDatabase` selective serialization** (`src/notion-client.ts:113-123`): formula expressions, relation targets, number formats, rollup configs all dropped from the simplified schema output. Agents using `get_database` to plan their writes never see these.
- **S15 `buildTextFilter` returns `undefined` on no-text databases** (`src/notion-client.ts:140`): the `text` param is silently ignored; query returns all rows.

### Frame 2 (round-trip auditor) — unique

- **Multi-paragraph blockquote / callout content loss** (`src/markdown-to-blocks.ts:189`): `blockquoteToBlock` reads only `token.tokens?.[0]?.text`. Anything after the first paragraph vanishes. Confirmed real bug, no test.
- **CRLF breaks custom-syntax detection** (`src/markdown-to-blocks.ts:331`): `line === "+++"` fails for `"+++\r"` because `splitCustomSyntax` splits on `\n` but doesn't strip `\r`. Toggles, columns, equations all fail closed.
- **Rich text at 2000-char boundary has no client-side guard** (`src/markdown-to-blocks.ts:20-41`): produces a single rich_text entry; Notion rejects at API time with an unhelpful error.
- **Code blocks containing triple backticks break on round-trip** (`src/blocks-to-markdown.ts:188-193`): emitter always uses ` ``` `; re-parse closes the fence early.
- **Annotation render order is non-idempotent on first trip** (`src/blocks-to-markdown.ts:3-24`): `**~~x~~**` normalizes to `~~**x**~~`. Stable after first trip but not identity-preserving.

### Frame 3 (API contract auditor) — unique

- **POST retry on 429 creates duplicate database entries.** `@notionhq/client` retries 429 on all methods including POST (`node_modules/@notionhq/client/build/src/Client.js:741`). `add_database_entries` has no idempotency protection.
- **Schema cache stale-type trap.** The bust-and-retry at `src/notion-client.ts:272-283` only fires on *unknown keys*. If a user changes a property's *type* in Notion (e.g., `select` → `multi_select`), writes within the 5-min TTL silently hit a `validation_error` path.
- **`enhanceError` can't distinguish 401 vs 403** (`src/server.ts:426-452`): both fall through to generic message; re-auth prompts don't fire.
- **Appending >100 blocks via `appendBlocksAfter` ordering is unverified** at the chunk-boundary (`src/notion-client.ts:387-398`): `afterBlockId` tracking could drift silently.

### Frame 4 (regression archaeologist) — unique

- **`richTextToMarkdown` crashes on `mention` or `equation` rich_text items** (`src/blocks-to-markdown.ts:26`): no null-check, no fallback. Common content classes. Zero tests.
- **Fence desync / structural injection** (`src/markdown-to-blocks.ts:314`): nested fence markers inside a code block can cause `splitCustomSyntax` to exit the fence early, leaking body content into the block tree as toggles/columns.
- **Read-path doesn't sanitize `javascript:` URLs** — write side has `isSafeUrl`, read side has no equivalent. Defense-in-depth gap.
- **G-3a tests are description-only** — they assert the word "DESTRUCTIVE" appears in the tool description, not that the handler actually does delete-then-append. Refactoring to atomic would pass the tests for the wrong reason.
- **`enhanceError` discards `Retry-After`** (`src/server.ts:398`): agents get "Wait a moment" instead of the actual retry window.

### Frame 5 (user-journey reviewer) — unique

- **13 of 28 tools have zero handler-level tests**: `search`, `list_pages`, `share_page`, `move_page`, `restore_page`, `delete_database_entry`, `list_users`, `list_comments`, `add_comment`, `archive_page`, `get_me`, `find_replace`, `get_database`. All pass CI with trivial field swaps.
- **`add_database_entries` succeeded/failed array swap** (`src/server.ts:1411`): errors appear in `succeeded`, successes in `failed`. Existing coverage tests partial-failure sandwich pattern but not which-bucket assignment.
- **`duplicate_page` custom title + icon untested** (`src/server.ts:1192-1225`): block-warnings test only covers omitted-block warnings, not title/icon preservation.
- **`simplifyProperty` unique_id prefix concatenation untested** (`src/server.ts:79-85`): a number-only output when prefix is set would silently change IDs agents surface from `query_database`.

### Frame 6 (live-MCP E2E mapper) — unique

- **Transport parity not tested.** No test verifies stdio and HTTP return semantically identical results for the same tool call — serialization drift is invisible.
- **OAuth revoked-token → clear 401 path.** `verifyAccessToken` checks our token store, not Notion's token validity. A workspace admin revoking the integration leaves our MCP token "valid."
- **`timingSafeEqual` performance** (`src/http.ts:79`): unit-tested for correctness but no timing-safety assertion exists (within ±10ms of correct-bearer response time).
- **Sandbox-lifecycle choice is a blocker.** Dated parent vs TTL property vs archive-on-exit — the suite can't ship without one. Frame 6's recommendation: Option A (dated parent + orphan-detection search on startup).
- **Server version mismatch**: `package.json` is `0.3.0` but `serverInfo.version` reports `0.2.0` per the spike. Cosmetic but a drift indicator. `tests/server-version.test.ts` exists (1.5 KB) — may or may not pin this.

---

## 3. Prioritized test-add list — top 15

Ordered by (convergence × severity × ease). Each row: what it catches, which frames flagged it, effort, which PR/task it rides with.

| # | Test | Catches | Frames | Effort | Rides with |
|---|---|---|---|---|---|
| 1 | **`create_database` silent-drop warning** — schema with `formula`/`rollup`/etc returns `warnings: [{code: "dropped_properties", types: [...]}]` | Silent data loss on DB create (C1) | 1, 2, 4, 6 | **S** (unit + mock integration) | **PR1** `notion-property-type-gap` — write test before fix |
| 2 | **`simplifyProperty` exhaustive-type** — fixture per unsupported type; assert current null (documents bug), flip after fix | Silent null on read (C2) | 1, 4, 6 | **S** (unit) | **PR1** `notion-property-type-gap` |
| 3 | **25-item property truncation** — mock entry with 30 relations; assert `pages.properties.retrieve` called, all 30 returned (post-fix) or `truncated: true` warning (pre-fix) | Multi-value property truncation (C3) | 1, 3, 6 | **M** (mock-heavy) | **PR2** `notion-long-property-pagination` |
| 4 | **`queryDatabase` detects `request_status: "incomplete"`** — mock query response with the 2026 cap marker; assert warning emitted | 10k-row query cap (C4) | 1, 3 | **S** (mock) | **PR2** `notion-long-property-pagination` (companion) |
| 5 | **`find_replace` basic correctness + zero-match signal** — happy-path + `old_str` not found; assert response distinguishes 0 matches from success | Zero-coverage write tool (C6) | 1, 5 | **S** (unit + live E2E) | **Tier-1 E2E suite**, standalone |
| 6 | **Create→Read markdown round-trip via handlers** — golden fixture with all `SUPPORTED_BLOCK_TYPES`; assert stripped-sentinel output matches input | Handler-level integration gap (C7) | 5, 6 | **M** (live E2E) | **Tier-1 E2E suite** |
| 7 | **Multi-paragraph blockquote + callout content preservation** — `"> line 1\n>\n> line 2"` retains both paragraphs | Real bug in `blockquoteToBlock` | 2 | **S** (unit) | standalone |
| 8 | **Nested to-do children** — `"- [ ] parent\n  - [ ] child"` produces to_do with children; also covers `attachChildren` drop | Real bug in list walker + `attachChildren` | 2, 4 | **S** (unit) | standalone |
| 9 | **CRLF line endings parse identically to LF** — same input with `\r\n` produces same block tree | Custom-syntax closer detection | 2 | **S** (unit) | standalone (fits in markdown-to-blocks) |
| 10 | **`richTextToMarkdown` handles mention/equation** — pass rich_text items with `type: "mention"` and `type: "equation"`; assert no crash | Crash class, common content | 4 | **S** (unit) | standalone |
| 11 | **Fence desync — inner fence marker inside code block** — ` ```md\n```ts\n+++ x\n```\n``` ` stays one code block, no toggle leakage | Structural injection class | 4 | **S** (unit) | standalone |
| 12 | **`replace_content` / `update_section` delete-then-append behavior** — mock inject append failure; assert error surfaces empty-page state | Destructive gap window (C5) | 3, 5, 6 | **M** (mock injection) | **PR3** `notion-atomic-edit-update-block` |
| 13 | **`update_section` integration round-trip** — create page with `## A` + `## B`; update A; read back; assert B untouched and order preserved | Update-section handler wiring (C11) | 5, 6 | **M** (live E2E or high-fidelity mock) | **Tier-1 E2E suite** |
| 14 | **Table cell pipe escape on read** — `richTextToMarkdown` in table cell with `"A \| B"` emits `"A \\\| B"` | Silent data loss on round-trip (C8) | 2, 4 | **S** (unit) | standalone |
| 15 | **`convertPropertyValue` date-range full shape** — pass `{ start, end, time_zone }`; assert all three fields reach Notion payload | Silent data corruption on writes (Frame 1 S4) | 1 | **S** (unit) | standalone (or PR1 if we're already touching the property value path) |

Two explicitly-deferred candidates worth recording (not in the top 15):
- **POST retry-induced duplicate entries** (Frame 3 unique): needs SDK-level fault injection; move to scheduled contract canary, not Tier-1.
- **Transport parity test** (Frame 6 unique): depends on the Tier-1 harness supporting both stdio and HTTP in a single run; good fit for E2E v1.1.

---

## 4. Tier-1 E2E harness scope — v1 MUST cover

Synthesized from Frame 6's proposed suite + convergence signal. Eight concrete capabilities (stretch: ten). The harness target is ~2 minutes serial runtime, ~90 API calls.

1. **Transport smoke: stdio init → tools/list → `get_me`.** Builds on `scripts/e2e/mcp-spike.ts:78-104`. Validates the JSON-RPC envelope and auth roundtrip. Frame 6 T1.
2. **Transport smoke: HTTP static-bearer init → tools/list → `get_me`.** Confirms `NOTION_MCP_BEARER` enforcement, loopback bind, `timingSafeEqual` behavior. Frame 6 T2/T4/T5/T16.
3. **Golden-path Create→Read round-trip** (markdown fixture with every `SUPPORTED_BLOCK_TYPES`, sentinel stripped, assert identity). Covers C7. Frame 6 T11.
4. **Formula-column silent-drop regression gate** — `create_database` with formula in schema → `get_database` diff → assert absent (pre-fix) / present (post-fix). Covers C1. Frame 6 T6.
5. **Pagination past 25 items** — DB with >25 relation values; `read_page` or `query_database` returns all. Covers C3. Frame 6 T8.
6. **File-upload stdio round-trip** — `![img](file://<fixture.png>)` → `read_page` returns Notion-hosted URL. Proves the CDN path that all tests mock. Frame 6 T9.
7. **Destructive-edit mid-failure** — `replace_content` with oversized/malformed content; assert clean error OR valid content, never silent empty page. Covers C5. Frame 6 T15.
8. **`update_section` integration** — multi-section page, update one, assert others intact. Covers C11. Frame 6 T13.

Stretch:
9. **Schema cache TTL bust-and-retry** — raw `dataSources.update` adds a column mid-TTL, `add_database_entry` retries successfully. Frame 6 T12.
10. **`find_replace` live correctness** — sentinel replacement, zero-match signal, `replace_all_matches` behavior. Covers C6. Frame 6 T14.

**Harness infrastructure** (the surrounding code): `McpStdioClient` class from the spike, HTTP client helper, sandbox manager (**Option A: dated parent** per Frame 6's recommendation), fixture directory, `stripSentinel()` helper, token-pinning assertion, known-gap assertion pattern (flag flip), cost-accounting log. Orphan sweep on startup (search `"E2E — "` prefix, archive ages >1h).

**Pinned decisions the orchestrator must make before build:**
- Sandbox strategy: A / B / C (Frame 6 recommends A).
- Which Notion bot the suite uses: the spike found two different tokens (`.env` bot "Test" vs `~/.claude.json` bot "Iris") — pick one, document, fail loud on mismatch.
- Whether T2 (HTTP transport) runs against an in-process `createApp` or a spawned `node dist/http.js`. In-process is faster; spawned matches production better.

---

## 5. Mapping to tasuku tasks

### Existing tasks — what these findings feed into

- **`notion-property-type-gap` (PR1 — property-type closure).** Eats tests 1, 2, 15 directly. The known-gap assertion pattern (Frame 6 requirement 7) is mandatory here: tests flip from "assert gap" to "assert fix" on PR1 merge. The audit's §5.4 lists the three code touchpoints (`schemaToProperties`, `simplifyProperty`, tool description); tests should precede each code change.
- **`notion-long-property-pagination` (PR2).** Eats tests 3 and 4. C3 + C4 are strongly linked — both are pagination-unaware reads. Single PR can close both; single test file can cover both.
- **`notion-atomic-edit-update-block` (PR3).** Eats test 12. C5 is the main driver. Once atomic `pages.updateMarkdown` (command: `replace_content`) is used, the mid-failure injection test becomes a positive-assertion instead of a gap-documentation test.
- **`build-ee-testing-suite-for-live`.** Receives the full §4 Tier-1 scope + the harness infrastructure list. Tests 5, 6, 13 live here. Sandbox strategy decision is gating.

### Suggested new tasuku tasks

- **`tests-roundtrip-fidelity-gaps`** — Frame 2's unit-testable real bugs: tests 7, 8, 9, 10, 11, 14 (multi-paragraph blockquote, nested to-do, CRLF, mention/equation crash, fence desync, table pipe). All small unit tests in existing files. Estimated: one 2-3 hour PR, ~8 tests, ~100 LOC.
- **`tests-handler-integration-coverage`** — Frame 5's zero-coverage handlers: `find_replace` basics, `search` response shape, `list_pages`, `duplicate_page` title/icon, `add_database_entries` array separation. Estimated: half-day PR, 5-8 handler-level tests with mocked `notionClient`. Borderline — some of this could fold into the Tier-1 E2E suite instead.
- **`api-contract-canaries`** — Frame 3's scheduled test suite: 429 retry duplicates, 10k cap detection, schema-type drift, OAuth refresh lifecycle. Runs daily via cron rather than on every PR. Filing this prevents one-off "let's add this canary" mission-creep into the Tier-1 suite.
- **`tests-parallel-switch-drift-guard`** — Frame 1 C10: extend the existing G3b-11 drift test to `attachChildren` and `renderBlock`. Tiny PR (<50 LOC) but catches a class of future silent-break. Could fold into PR1 or the round-trip PR.

### Frames that didn't map to a task

- Frame 4's G-3a behavioral test (test 12's write-side companion): "verify `replace_content` calls `blocks.delete` before `blocks.children.append`." Gets automatically addressed by PR3 (atomic replace removes the delete-then-append shape entirely). Skip filing; absorb into PR3 acceptance.
- Frame 4's `enhanceError` preserves `Retry-After`: cosmetic correctness. Standalone 15-min fix, not a test-suite investment. File as a v0.3.1 follow-up issue, not a tasuku task.

---

## 6. Cross-frame disagreements (low count; resolved)

- **`list_databases` ID mapping.** Frame 1 S13 flagged this as an untested integration gap; Frame 4 listed Issue #15 as covered by `tests/list-databases.test.ts` (4 tests). **Resolution:** the mapper is unit-tested; the handler wrapper isn't (Frame 5 #17 confirms). Frame 1 is right about the integration gap, Frame 4 is right about the mapper unit. Test 12 in Frame 5's priority list covers the integration path.
- **Frame 2 says `marked` strips BOM per GFM spec; Frame 2 also flags this as "needs verification test."** The ambiguity is reasonable — GFM spec-compliance and `marked`'s current implementation can drift. Low priority, but the test is cheap.

No other inter-frame conflicts detected.

---

## 7. What the sweep didn't cover (honesty)

- **Performance / memory** — no frame profiled `marked.lexer` or `splitCustomSyntax` on multi-MB inputs.
- **Webhooks** — we don't implement them; no contract to test.
- **Multi-tenant cache isolation** — the schema cache is process-global. Frame 3 noted this but didn't deep-probe; Frame 4 references a prior-frame finding (Frame 3 P1.a-P1.f from 2026-04-17). Worth a separate investigation before OAuth multi-tenant is promoted.
- **`pages.updateMarkdown` error shapes** — Frame 3 flagged the endpoint is <6 months old and the error/warning shape may still be evolving. Watch for.
- **Concurrent write safety** — two MCP clients writing to the same page. Notion's conflict resolution is undocumented ("last write wins"). Out of scope.

---

## Session chain

- Overseer: this session (planning + synthesis, 6 PMs dispatched).
- Frame PMs (all background-dispatched on Claude Opus 4.6 with `role: "explorer"`, all completed cleanly; each wrote its own artifact under `.meta/research/`):
  - `test-gap-frame-1-silent-failures` — 20 turns, 4m, $1.21
  - `test-gap-frame-2-roundtrip` — 12 turns, 4m, $0.81
  - `test-gap-frame-3-api-contract` — 21 turns, 3.5m, $0.82
  - `test-gap-frame-4-regressions` — 20 turns, 6m, $1.41
  - `test-gap-frame-5-user-journeys` — 22 turns, 4.6m, $1.07
  - `test-gap-frame-6-e2e-mapper` — 16 turns, 3m, $0.65
- No Codex sessions. No research sub-agents inside any frame (each PM read the briefs + source directly).
- Total PM cost: **$5.97**, longest single PM: 6 min (Frame 4), parallel wall time: ~6 min.

---

## Appendix: frame-file index

- `.meta/research/test-gap-frame-1-silent-failures-2026-04-20.md` — 15 silent-failure sites, 5 structural patterns, 15 tests.
- `.meta/research/test-gap-frame-2-roundtrip-2026-04-20.md` — 8 high-risk round-trip gaps, 8 input-class tables, 15 tests (P0/P1/P2).
- `.meta/research/test-gap-frame-3-api-contract-2026-04-20.md` — 8 unpinned-contract risks, 3-tier canary-suite sketch, 12 tests.
- `.meta/research/test-gap-frame-4-regressions-2026-04-20.md` — 25-bug regression inventory, 68% hit-rate, 12 tests ranked by risk class.
- `.meta/research/test-gap-frame-5-user-journeys-2026-04-20.md` — 28-tool walkthrough, 13 zero-coverage tools, 8 cross-tool journeys, 15 tests.
- `.meta/research/test-gap-frame-6-e2e-mapper-2026-04-20.md` — 18-test Tier-1 spec, harness infra requirements, sandbox-strategy recommendation (Option A).

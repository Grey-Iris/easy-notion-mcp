# Testing-practices audit — easy-notion-mcp

**Date:** 2026-04-30 (per dispatch brief; session crossed into 2026-05-01).
**Audit subject:** `dev` at commit `0ea4efd` (post PR #57 merge, 28 tools → 29 with `update_block`).
**Audit PM session:** orchestrator-spawned audit-role session for `testing-practices-audit-2026-04-30`.
**Method:** PM read CLAUDE.md, prior audit memos (`pr3-audit-2026-04-28`, `bench-scripts-audit-2026-04-28`), handoffs, tasuku context, and the entirety of `tests/`, `scripts/e2e/`, `scripts/release/`, `scripts/bench/`, and CI workflows. One Codex mutation-testing pass dispatched for evidence on contracts the PM suspected of being weakly pinned. Codex evidence file: `.meta/audit-b-fixtures/codex-mutation-pass-2026-04-30.md` (51 mutations, 43 caught, 8 missed).

This audit was scoped at "comprehensive testing posture across the codebase" with weight on (1) live e2e coverage of all 29 tools, (2) regression-catching patterns, (3) the contract-vs-implementation gap that surfaced during the PR3 audit. Read-only — no source or test changes.

## Executive summary

**Top-line counts:** Critical: 0. High: 6. Medium: 7. Low: 5. Informational: 5.

**Verdict.** The test pyramid is genuinely healthy on the surfaces it covers — 461+ unit tests with strong InMemoryTransport-based handler coverage, 31 live e2e against a real Notion workspace, TDD adherence in the last 30 days is consistent (PR3, PR2, PR1, PR #55 all shipped tests in the same commit), and the PR3 audit's translator findings are now well-pinned by exact-output assertions. The contract-vs-implementation hypothesis is **partly refuted** for the surfaces hardened post-PR3 (translator color/escaping, atomic warning merge, update_block validation order, pagination caps, all warning code names) and **still load-bearing** for three other surfaces. The most consequential remaining gaps: (a) live e2e covers only 13 of 29 tools; (b) property-type *write* tests exist for `people` and `relation` only — a one-line mutation that breaks `date`, `number`, or `multi_select` writes would not break any test; (c) translator table and column tests use `toContain` instead of exact output, so row order, cell order, column order, and table header metadata can be silently dropped; (d) bench scripts are measurement instruments without any regression-catching layer, so silent drift in token cost or workflow modeling has no automated alarm. None of these is destroying data on the happy path today, but each is a real contract that's not pinned by a test, with concrete one-line mutations to demonstrate the gap. Severity calibration: H1 and H2 are the genuinely urgent ones; the rest are debt that compounds slowly.

## Coverage matrices

### 1. Per-tool live e2e coverage (29 tools)

| Tool | Live e2e? | Test markers | Failure-mode? | Notes |
|---|---|---|---|---|
| `get_me` | Yes | A1 (line 320), H3 (line 1297-1302) | No | Stdio + HTTP parity |
| `create_page` | Yes | B1, B2, F1, F2, F3-setup, F4-setup, F5-setup, F6-setup, KNOWN GAP, H4 | Yes (H4: file:// rejection) | Heavily exercised as setup |
| `read_page` | Yes | B1, B2, E1, F1, F2, F5, KNOWN GAP | No | Round-trip + content notice |
| `create_database` | Yes | C1, C2, C3, C4, C5, C6, relation-pagination | No | All as happy paths |
| `get_database` | Yes | C1, C2, C3, C4, C5, C6 | No | Schema verification |
| `add_database_entry` | Yes | C1, C2, C5, C6, relation-pagination | No | Only `Title` + a single-typed property; no broad type coverage |
| `query_database` | Yes | C1, C2, C5, C6, relation-pagination (75 cap warning) | Yes (relation cap warning) | Pagination warning pinned |
| `update_data_source` | Yes | C2 (formula expression update) | No | One scenario only |
| `list_users` | Yes | C5 | No | Read-only call |
| `update_section` | Yes | F1 | No | Happy path only |
| `replace_content` | Yes | F2 (atomic happy path), F5 (block-ID survival), F6 (deep-link anchor) | **No live failure-safety** (see H6); unit-level rejection test exists at `tests/replace-content-atomic.test.ts:106-129` |
| `update_block` | Yes | F3 (paragraph), F4 (to_do toggle) | No | No live test for type-mismatch, archived:true, or non-updatable type |
| `archive_page` | Yes | KNOWN GAP (line 1158-1193) + teardown helper | Implicit (archived-ancestor classifier) | KNOWN GAP pins non-cascading behavior |
| `create_page_from_file` | **No** | — | — | Stdio-only tool; unit tests at `tests/create-page-from-file.test.ts` |
| `append_content` | **No** | — | — | Unit tests via `tests/replace-content-atomic.test.ts` and indirectly via update_section |
| `find_replace` | **No** | — | — | Unit tests at `tests/find-replace.test.ts` (8 cases); wire shape against real Notion unverified |
| `duplicate_page` | **No** | — | — | No test file at all |
| `update_page` | **No** | — | — | No test file at all |
| `search` | **No** | — | — | No test file at all |
| `list_pages` | **No** | — | — | No test file at all |
| `share_page` | **No** | — | — | No test file at all |
| `list_databases` | **No** | — | — | Unit tests at `tests/list-databases.test.ts` only |
| `add_database_entries` | **No** | — | — | Unit tests at `tests/database-write-strictness.test.ts` (G4a-5); no live |
| `update_database_entry` | **No** | — | — | Unit tests at `tests/database-write-strictness.test.ts`; no live |
| `list_comments` | **No** | — | — | No test file at all |
| `add_comment` | **No** | — | — | No test file at all |
| `move_page` | **No** | — | — | No test file at all |
| `restore_page` | **No** | — | — | No test file at all |
| `delete_database_entry` | **No** | — | — | No test file at all |

**Tally:** 13/29 tools have live e2e (45%). 16/29 have no live e2e (55%). Of the 13 covered, only 3 (`create_page` H4, `query_database` cap warning, `replace_content` rejection at unit level) test a failure mode. The other 10 are happy-path only.

### 2. Per-convention round-trip coverage (CLAUDE.md table + 25 block types)

Round-trip = markdown → blocks → markdown produces equal output. Forward = markdown → blocks. Reverse = blocks → markdown.

| Convention / block type | Forward unit | Reverse unit | Round-trip unit | Live e2e (B1) |
|---|---|---|---|---|
| Toggle (`+++ Title / +++`) | `tests/markdown-to-blocks.test.ts` | `tests/blocks-to-markdown.test.ts:309-356` | `tests/roundtrip.test.ts:106-160` | Yes (B1 line 361) |
| Toggle heading H1 (`+++ # ...`) | `tests/markdown-to-blocks.test.ts:659-672` | yes | likely | No |
| Toggle heading H2 (`+++ ## ...`) | `tests/markdown-to-blocks.test.ts:643-657` | yes | likely | No |
| Toggle heading H3 (`+++ ### ...`) | `tests/markdown-to-blocks.test.ts:674-687` | yes | likely | No |
| Column layout (`::: columns`) | `tests/markdown-to-blocks.test.ts` | `tests/blocks-to-markdown.test.ts:358-434` | `tests/roundtrip.test.ts:162-175` | No |
| Callout NOTE | yes | `tests/blocks-to-markdown.test.ts:95` | `tests/roundtrip.test.ts:86-104` | Yes (B1 line 365) |
| Callout TIP | yes | `tests/blocks-to-markdown.test.ts:109` | likely | No |
| Callout WARNING | yes | `tests/blocks-to-markdown.test.ts:123` | likely | No |
| Callout IMPORTANT | yes | `tests/blocks-to-markdown.test.ts:137` | likely | No |
| Callout INFO | yes | `tests/blocks-to-markdown.test.ts:151` | likely | No |
| Callout SUCCESS | yes | `tests/blocks-to-markdown.test.ts:165` | likely | No |
| Callout ERROR | yes | `tests/blocks-to-markdown.test.ts:179` | likely | No |
| Equation inline `$$expr$$` | yes | `tests/blocks-to-markdown.test.ts:193-203` | `tests/roundtrip.test.ts:177-185` | Yes (B1 line 366) |
| Equation multi-line `$$\nexpr\n$$` | `tests/markdown-to-enhanced.test.ts:103-105` | yes | partial | No |
| Table of contents `[toc]` | yes | `tests/blocks-to-markdown.test.ts:450` | yes | Yes (B1 line 372) |
| Embed `[embed](url)` | yes | `tests/blocks-to-markdown.test.ts:461` | yes | Yes (B1 line 374) |
| Bookmark (bare URL) | yes | `tests/blocks-to-markdown.test.ts:439` | yes | Yes (B1 line 373) |
| Task list `- [ ]` / `- [x]` | yes | `tests/blocks-to-markdown.test.ts:222-229` | `tests/roundtrip.test.ts:34-38` | Yes (B1 line 370-371) |

Block types beyond the convention table (sample of 25):

| Block type | Forward | Reverse | Round-trip | Notes |
|---|---|---|---|---|
| `paragraph`, `heading_1/2/3` | yes | yes | yes (B1) | |
| `bulleted_list_item`, `numbered_list_item` | yes | yes | yes (B1) | |
| `to_do` | yes | yes | yes | |
| `quote` | yes | yes | partial | |
| `code` | yes | yes | yes (B1 typescript) | Language `tsx`/`jsx`/`mjs` not normalized (PR3 audit L5) |
| `divider` | yes | yes | yes (B1 line 369) | |
| `image` | yes | yes | partial | E1 e2e for file:// upload |
| `file` | yes | yes | partial | PR3 audit M7: translator emits bare URL not `<file>` XML |
| `audio` | yes | yes | partial | Same as `file` |
| `video` | yes | yes | partial | Same as `file` |
| `pdf` | partial | partial | no | |
| `child_page` | n/a | n/a | n/a | Not representable in markdown by design (PR3 M2) |
| `child_database` | n/a | n/a | n/a | Same |
| `synced_block` | n/a | n/a | n/a | Same |
| `link_to_page` | partial | partial | no | |
| `link_preview` | partial | partial | no | |
| `breadcrumb` | no | no | no | Notion-internal block |
| `template` | no | no | no | |
| `column`, `column_list` | yes | yes | yes | |
| `table`, `table_row` | yes | yes | partial | **Translator coverage is loose — see H3, H4** |
| `equation` | yes | yes | yes | |
| `callout` | yes | yes | yes | |
| `unsupported` | n/a | n/a | n/a | Notion-internal sentinel |

### 3. Per-property-type write coverage

For Notion 2025-09-03 property types. "Write" = a test where a value is written via `convertPropertyValue` (or via `add_database_entry` / `update_database_entry` flows) and the SDK call payload is inspected.

| Property type | Schema (column-def) test | Value write test | Value read test |
|---|---|---|---|
| `title` | yes | **No** (only used as Name in setup) | yes |
| `rich_text` | yes | **No** | yes |
| `number` | yes (format: dollar) | **No** (mutation MISSED — Codex C3) | yes |
| `select` | yes | **No** | yes |
| `multi_select` | yes (with color options) | **No** (mutation MISSED — Codex C4) | yes |
| `status` | yes | **No** | yes |
| `date` | partial | **No** (mutation MISSED — Codex C1) | yes |
| `people` | yes | **Yes** (`tests/convert-property-value.test.ts:6-16`, `tests/property-roundtrip.test.ts:318-362`) | yes |
| `files` | schema-only | n/a (deferred via descriptive throw) | yes |
| `checkbox` | yes | **No** | yes |
| `url` | yes | **No** | yes |
| `email` | yes | **No** | yes |
| `phone_number` | yes | **No** | yes |
| `formula` | yes (expression required) | n/a (computed) | yes |
| `relation` (single+dual) | yes | **Yes** (`tests/relation-roundtrip.test.ts:134-243`) | yes |
| `rollup` | yes | n/a (computed) | yes |
| `unique_id` (with prefix) | yes | n/a (auto-assigned) | yes |
| `created_time`, `last_edited_time` | yes | n/a (computed) | yes |
| `created_by`, `last_edited_by` | yes | n/a (computed) | yes |
| `verification` | schema-only | n/a (deferred) | yes |
| `place`, `button` | n/a | n/a (descriptive throw) | yes |

**Tally:** Of 12 user-writable property types, 10 have **no positive value-write test**. The schema definitions are tested round-trip; the value writes are not.

### 4. Per-warning-code coverage

All warning codes emitted in `src/`:

| Code | Emitted from | Pinned by name? | Test file |
|---|---|---|---|
| `omitted_block_types` | `src/server.ts:1569`, `:1621` | Yes (exact) | `tests/block-warnings.test.ts:126-153` |
| `truncated_properties` | `src/server.ts:1573`, `:1810` | Yes (exact) | `tests/read-page-title-pagination.test.ts:165-176`, `tests/query-database-pagination.test.ts:168-179` |
| `unmatched_blocks` | `src/server.ts:1365`, `:1450` | Yes (exact + objectContaining) | `tests/find-replace.test.ts:259-288`, `tests/replace-content-atomic.test.ts:152-170` |
| `bookmark_lost_on_atomic_replace` | `src/markdown-to-enhanced.ts:270` | Yes (exact + objectContaining) | `tests/markdown-to-enhanced.test.ts:195-200`, `tests/replace-content-atomic.test.ts:176-190` |
| `embed_lost_on_atomic_replace` | `src/markdown-to-enhanced.ts:275` | Yes (exact) | `tests/markdown-to-enhanced.test.ts:203-209` |
| `unrepresentable_block` | `src/markdown-to-enhanced.ts:291` | **No** (dead code; not emitted on any current parser path) | — (PR3 audit L1) |

The `how_to_fetch_all` hint string is pinned by `toContain("max_property_items")` at `tests/read-page-title-pagination.test.ts:165-176` and `tests/query-database-pagination.test.ts:168-179`. The `cap` field on `truncated_properties` is pinned by exact value (`cap: 75` at line 770).

---

## Severity-rated findings

### Critical
None.

### High

**H1. Property-type value writes have no positive test for 10 of 12 user-writable types.**
**File:line evidence.** `tests/convert-property-value.test.ts:1-48` covers `people` (positive), `files`/`verification`/`place`/`button` (negative throws), `formula`/`rollup`/`unique_id`/`created_time`/`last_edited_time`/`created_by`/`last_edited_by` (computed-throws). `tests/relation-property.test.ts:11` covers `relation`. No test pins the wire shape of `convertPropertyValue` for `title`, `rich_text`, `number`, `select`, `multi_select`, `status`, `date`, `checkbox`, `url`, `email`, `phone_number`. `tests/property-roundtrip.test.ts:400-448` exercises `add_database_entry` for these schemas but only inspects the *create_database* payload — it never sets a row value of those types.

**Concrete mutation evidence (Codex pass C1, C3, C4).**
- `convertPropertyValue("date", "Due", "2026-04-30")` returning `{ date: {} }` instead of `{ date: { start: "2026-04-30" } }` would not break any test. Real impact: every date write becomes empty, page UI shows blank dates, callers see no error.
- `convertPropertyValue("number", "Score", 42)` returning `{ number: "42" }` (string) instead of `{ number: 42 }` would not break any test. Real impact: Notion API rejects with type error at runtime; all numeric writes break.
- `convertPropertyValue("multi_select", "Tags", ["a","b","c"])` collapsing to `[{ name: "a" }]` would not break any test. Real impact: only one tag written, others silently dropped.

**What it means.** PR1 (post v0.3.0) closed the *read* gap for property types. The *write* gap was never closed. Today's tests pin the *schema definition* round-trip (a column of type X exists with format Y) but not the *value write* shape (writing value V to a column of type X produces SDK payload P).

**Fix shape.** Add positive tests to `tests/convert-property-value.test.ts` for each writable type. Each test asserts the SDK payload shape directly, like the existing `people` cases:

```ts
it("converts a date with start", () => {
  expect(convertPropertyValue("date", "Due", "2026-04-30")).toEqual({
    date: { start: "2026-04-30" }
  });
});
```

Plus the equivalent for `number`, `select`, `multi_select`, `status`, `checkbox`, `url`, `email`, `phone_number`, `title`, `rich_text`. ~12 unit tests, ~80 lines.

**Cross-reference.** No overlap with existing tasuku tasks. Distinct from `pr-audit-deferred-items-from-met` (which covers PR3-specific items).

---

**H2. 16 of 29 tools have no live e2e coverage at all.**
**File:line evidence.** `tests/e2e/live-mcp.test.ts` invokes 13 tools (see Coverage matrix 1). The 16 untested-live tools — `create_page_from_file`, `append_content`, `find_replace`, `duplicate_page`, `update_page`, `search`, `list_pages`, `share_page`, `list_databases`, `add_database_entries`, `update_database_entry`, `list_comments`, `add_comment`, `move_page`, `restore_page`, `delete_database_entry` — have only unit-level mocked-SDK coverage at best, and several (`duplicate_page`, `update_page`, `search`, `list_pages`, `share_page`, `list_comments`, `add_comment`, `move_page`, `restore_page`, `delete_database_entry`) have **no test file at all**.

**What it means.** Each unit-test mock encodes our *belief* about the SDK wire shape. When `@notionhq/client` v5.13 → v5.14 ships, or when Notion-Version 2026-03-11 lands (per `project_notion_version_pin.md`, several fields rename), there is no automated check that these tools still call Notion correctly. The class of failure is silent: "we shipped v0.7.0, and `find_replace` now sends a renamed parameter that Notion rejects." A user reports it, we patch, repeat.

**Concrete mutation evidence.** The find_replace handler at `src/server.ts:1240-1290` calls `pages.updateMarkdown` with `type: "update_content"`. A one-line mutation changing this to `type: "search_replace"` would pass `tests/find-replace.test.ts` (which only inspects mock invocation arguments, not the actual API surface) and would fail at runtime against a real Notion. No test would catch the regression at build time.

**Fix shape.** Add live e2e coverage proportional to risk. Suggested triage:
- **Tier 1 (critical wedge claims):** `find_replace`, `append_content`, `update_database_entry`, `add_database_entries`, `duplicate_page`. 5 happy-path tests (~150 lines) added to `tests/e2e/live-mcp.test.ts` as G-series.
- **Tier 2 (read-only, low-cost):** `search`, `list_pages`, `list_databases`, `list_comments`, `get_me` (already covered). 4 happy-path tests (~80 lines).
- **Tier 3 (mutating but rarely-touched):** `share_page`, `move_page`, `restore_page`, `delete_database_entry`, `update_page`, `add_comment`, `create_page_from_file`. 7 tests (~150 lines).

Worth at minimum: Tier 1 is non-optional given the Notion-Version bump approaching.

**Cross-reference.** Partially overlaps with `audit-existing-tools-for-silentf` (which targets silent-failure modes specifically). Distinct in scope: H2 is about wire-shape verification; the silent-failures audit is about behavior verification.

---

**H3. Translator table tests use `toContain` instead of exact-output: row order, cell order, and header metadata can be silently dropped.**
**File:line evidence.** `tests/markdown-to-enhanced.test.ts:144-151`:

```ts
it("table: GFM pipe-table → <table> XML with rows", () => {
  const input = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const { enhanced } = translateGfmToEnhancedMarkdown(input);
  expect(enhanced).toContain("<table");
  expect(enhanced).toContain("<tr>");
  expect(enhanced).toContain("<td>A</td>");
  expect(enhanced).toContain("<td>1</td>");
});
```

**Concrete mutation evidence (Codex pass T19, T20, T21).**
- T19: Drop `header-row="${headerRow}" header-column="${headerCol}"` from the `<table>` opening tag. `expect(enhanced).toContain("<table")` still matches. Real impact: header semantics lost; first row no longer rendered as header.
- T20: `rows.reverse()` before mapping. Only cell *presence* is asserted, not row order. Real impact: tabular data inverted vertically.
- T21: `cells.reverse()` per row. Only `<td>A</td>` and `<td>1</td>` presence are asserted. Real impact: column data scrambled.

**What it means.** Same class of issue as PR3 audit's H3 (where `table_row` coverage was claimed but the switch case fell through). The translator's "all supported types pinned" claim is overstated: structure and ordering aren't pinned.

**Fix shape.** Convert `toContain` to exact-output `toBe` for the table case, like the rest of the test file:

```ts
it("table: GFM pipe-table → <table> XML with rows", () => {
  const { enhanced } = translateGfmToEnhancedMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
  expect(enhanced).toBe(
    '<table header-row="true" header-column="false">\n' +
    '\t<tr>\n\t\t<td>A</td>\n\t\t<td>B</td>\n\t</tr>\n' +
    '\t<tr>\n\t\t<td>1</td>\n\t\t<td>2</td>\n\t</tr>\n' +
    '</table>'
  );
});
```

Add additional tests pinning row count, cell count, and `header-column="true"` cases.

**Cross-reference.** Adjacent to PR3 audit H3 (table_row coverage gap) — already filed in `pr-audit-deferred-items-from-met`. New finding: even pre-existing table tests are too loose. Recommend collapsing into a single tasuku entry "translator table+column+row exactness."

---

**H4. Translator column order can be silently reversed.**
**File:line evidence.** `tests/markdown-to-enhanced.test.ts:133-142`:

```ts
it("columns: ::: columns syntax → <columns><column>... XML", () => {
  const input = "::: columns\n::: column\nLeft.\n:::\n::: column\nRight.\n:::\n:::";
  const { enhanced } = translateGfmToEnhancedMarkdown(input);
  expect(enhanced).toContain("<columns>");
  expect(enhanced).toContain("<column>");
  expect(enhanced).toContain("Left.");
  expect(enhanced).toContain("Right.");
  expect(enhanced).toContain("</column>");
  expect(enhanced).toContain("</columns>");
});
```

**Concrete mutation evidence (Codex pass T18).** Adding `cols.reverse()` before the map at `src/markdown-to-enhanced.ts` (around line 250 in the columns case) would output `Right.` before `Left.` and pass every assertion.

**What it means.** For users who use `::: columns` for layout (sidebar-content order, table-of-contents-vs-body), column order is content. Silently reversing it is a regression.

**Fix shape.** Add an exact-output assertion that pins ordering:

```ts
expect(enhanced).toBe(
  '<columns>\n' +
  '\t<column>\n\t\tLeft.\n\t</column>\n' +
  '\t<column>\n\t\tRight.\n\t</column>\n' +
  '</columns>'
);
```

**Cross-reference.** Same finding-class as H3. Group with H3 in tasuku.

---

**H5. F2 atomic failure-safety contract is pinned only at unit level, not at live e2e level.**
**File:line evidence.** `tests/replace-content-atomic.test.ts:106-129` is a unit test with a mocked rejection. It pins:
- `notion.blocks.children.list/delete/append` are NOT called (no fallback to destructive path).
- The response has `error` populated and `success !== true`.

It does NOT pin: "the page on Notion's side is unchanged after the rejected call." The PR3 audit's H4 wanted a live e2e (or unit test with mocked rejection) for this — the unit-level path was selected, which the audit explicitly accepted as in-scope. But the live atomic guarantee — that Notion's `pages.updateMarkdown` with `type: "replace_content"` is genuinely atomic on its server — is inferred from probe 4 + the SDK contract, never tested directly.

**Concrete mutation evidence.** This finding is not about a `src/` mutation; it's about a missing test. If Notion's atomic endpoint had a partial-failure mode (rate-limit halfway through, mid-stream HTTP 502 with content already mutated), no test on our side would surface it. We'd discover it when a user reports lost data.

**What it means.** The atomicity claim in the `replace_content` tool description (`src/server.ts:738`) and CHANGELOG is load-bearing for v0.6.0 messaging. It survives only as long as Notion's server-side guarantee holds.

**Fix shape.** Add a live e2e (estimated 30 lines, ~30s wall-clock) at `tests/e2e/live-mcp.test.ts` as F7:

1. Create a sandbox page with known content (sentinel paragraph).
2. Call `replace_content` with markdown that's expected to be rejected (e.g., empty body if rejected, oversize payload, or a deliberate Notion-side error injection — the cleanest is to send an invalid markdown that the translator passes through but Notion rejects).
3. Read the page back.
4. Assert the original sentinel paragraph is intact and no replacement landed.

If no clean rejection trigger exists, alternative: use `update_block` with a known-bad block_id and verify no partial state remains.

**Cross-reference.** Builds on PR3 audit H4 (in-scope finding marked addressed). Reframes that finding as "the bar was met at unit level, but live coverage is still missing." Distinct enough to be its own follow-up.

---

**H6. unique_id e2e prefix-collision (existing tasuku, confirm still active).**
**File:line evidence.** `tests/e2e/live-mcp.test.ts:784, 798`:

```ts
{ name: "Ticket", type: "unique_id", prefix: "ENG" },
```

The prefix `"ENG"` is fixed across runs. Per the existing tasuku `diagnose-e2e-unique-id-state-leak` and per Notion's documented behavior, `unique_id` prefixes have workspace-scoped uniqueness constraints. If two e2e runs collide before teardown completes, the second run gets `"Unique ID prefix is already in use"`.

**What it means.** A real state-leak surface that has already bit the project (per the tasuku notes, observed at run 24873858896). The handoff says CI is green now (priority downgraded 2026-04-28), but the root cause — fixed prefix — is still in the source tree. A future high-cadence merge week could re-trigger.

**Fix shape.** Per-run randomization:

```ts
prefix: `E${ctx.shortSha.slice(0,3).toUpperCase()}`
```

Or: parameterize from `ctx.startedAt` ISO timestamp (3-char hash). Either keeps the prefix short (Notion has length limits) and unique per run.

**Cross-reference.** Direct match for `diagnose-e2e-unique-id-state-leak`. Recommend collapsing this finding into that task with the concrete fix shape attached. No new task needed.

---

### Medium

**M1. Bench scripts are measurement instruments without a regression-catching layer.**
**File:line evidence.** `scripts/bench/token-compare.ts` and `scripts/bench/workflow-token-compare.ts` (~1350 lines combined). The only assertion-style code is `process.exit(1)` on top-level catch (line 450, line 895). The scripts compute token counts and write `.meta/bench/runs/run-*.manifest.json` (gitignored, local-only). No test imports either script's output. No CI step runs them. No regression check on the headline numbers.

**Concrete mutation evidence.** Per the bench audit `.meta/research/bench-scripts-audit-2026-04-28.md`, the scripts reproduce numbers exactly on fresh runs. But: a one-line change to `token-compare.ts` that drops a tool from the count, a refactor to `workflow-token-compare.ts` that miscounts response tokens, or a tokenizer-version bump in `js-tiktoken` would all silently shift the headline numbers. No automated check would alarm.

**What it means.** The bench audit (C1, C2) found that the strategic narrative built on these numbers overstates what the instruments measured (worst-case 6.4× framed as settled; W1 98% win modeled against an unverified hosted path). Layered on top of un-tested instruments, that narrative compounds. The README revision (blocked on `live-oauth-capture-mcp-notion-com`) will repeat or amplify these numbers.

**Fix shape.** One of:
1. Convert the bench scripts to a vitest-runnable suite at `tests/bench/`. Pin headline numbers within tolerance bands (`expect(localTokens).toBeGreaterThan(4500).toBeLessThan(5200)`) so material drift breaks loudly.
2. Add a `--check` flag that compares current run against a committed `bench-baseline.json` and exits non-zero on >5% drift.
3. Run the bench scripts in a separate CI workflow (not on every PR — too noisy) on a weekly cron, post results to GitHub Actions summary.

Option 1 is the lightest-weight; option 2 enables PR-level guardrails.

**Cross-reference.** Bench audit C1, C2 (claim-language overclaim). Adjacent: this finding is about the *measurement layer*, the bench audit was about the *claim layer* built on top.

---

**M2. Body-text escape: braces `{}` not pinned by any test.**
**File:line evidence.** `src/markdown-to-enhanced.ts` `escapeBodyText` (around lines 49-67). `tests/markdown-to-enhanced.test.ts:153-178` covers escape for `<`, `>`, `|`, and closing tags. No test passes `{` or `}` through a callout/details/column body and asserts it's escaped.

**Concrete mutation evidence (Codex pass T11).** Removing `{}` from the escape character class would pass all current tests.

**What it means.** Notion's Enhanced Markdown attribute syntax uses `{` and `}` (e.g., `## H2 {toggle="true"}`). User content containing literal `{` or `}` inside a callout body could potentially corrupt the markup. Lower severity than `<>` because braces have rarer collision in user prose, but the contract-vs-implementation gap is identical.

**Fix shape.** Add one test:

```ts
it("escapes literal braces in callout body text", () => {
  const { enhanced } = translateGfmToEnhancedMarkdown("> [!NOTE]\n> Variable {value} reference");
  expect(enhanced).toContain('Variable \\{value\\} reference');
});
```

---

**M3. Tool-list tests count tools but no positive-name inclusion check.**
**File:line evidence.** `tests/create-page-from-file.test.ts:223-238` and `tests/http-transport.test.ts:142` use `toHaveLength(N)` only. No test asserts `expect(toolNames).toContain("update_block")` or any other tool by name.

**Concrete mutation evidence.** Renaming `update_block` → `block_update` in `src/server.ts:783` would pass the count tests (still 29). The `find_replace` to `replace_inline` rename would pass too. JSON-Schema mutual-exclusion of `markdown` vs `archived` on `update_block` is enforced at runtime only — a JSON-Schema `oneOf` would surface it at registration.

**What it means.** Same finding as PR3 audit M6. Tool-name renames are user-visible breaking changes; the tests should pin the tool surface by name, not by count.

**Fix shape.** Add to the existing tool-list test:

```ts
const expectedTools = ["create_page", "create_page_from_file", "append_content", /* ...all 29... */];
expect(toolNames.sort()).toEqual(expectedTools.sort());
```

**Cross-reference.** Direct match for `pr-audit-deferred-items-from-met` M6. Already filed.

---

**M4. Notion-Version pin is not asserted by any test.**
**File:line evidence.** `src/notion-client.ts` and `tests/e2e/live-mcp.test.ts:961` both use `notionVersion: "2025-09-03"`. The pin is duplicated in test code rather than imported. If `src/notion-client.ts` bumps to 2026-03-11 but the test file isn't updated, no assertion catches the drift. Per `project_notion_version_pin.md`, several field renames (`after`, `archived`, `transcription`) are queued for the 2026-03-11 bump.

**What it means.** When the Notion-Version bump lands (per the roadmap), the e2e test will use a different version than the server. Tests will likely still pass (Notion versions are usually backward-compatible), but the live-probe behaviors observed in tests won't reflect what users see.

**Fix shape.** Centralize the version pin in a single export and import it in both places:

```ts
// src/notion-version.ts
export const NOTION_API_VERSION = "2025-09-03";
```

And update both `src/notion-client.ts` and `tests/e2e/live-mcp.test.ts:961` to import it. Add one test:

```ts
import { NOTION_API_VERSION } from "../src/notion-version.js";
it("Notion-Version pin matches the documented value", () => {
  expect(NOTION_API_VERSION).toBe("2025-09-03");
});
```

The constant test is partly self-referential, but it forces an explicit decision when bumping the pin.

---

**M5. CI `npm test` silently skips e2e via `describe.skipIf(!env.shouldRun)` when `NOTION_TOKEN` / `E2E_ROOT_PAGE_ID` aren't set.**
**File:line evidence.** `tests/e2e/live-mcp.test.ts:276`. The CI workflow `.github/workflows/ci.yml` does NOT set those env vars; `npm test` runs and the e2e tests skip silently. Only `.github/workflows/e2e.yml` sets them and uses `E2E_ENFORCE=1` via `npm run test:e2e`.

**What it means.** This is intentional separation — running 31 live e2e tests on every PR push to main/dev would create real Notion pages on every push, which is wasteful. But the silent-skip is a single layer of defense: if someone accidentally pushes a config that drops `E2E_ENFORCE=1` from the e2e workflow, OR if `NOTION_TOKEN` rotates and isn't refreshed, the e2e suite would silently skip while CI shows green.

**Concrete mutation evidence.** Removing `E2E_ENFORCE: 1` from `.github/workflows/e2e.yml` would let the workflow run, all e2e tests skip silently, and CI report success.

**Fix shape.** Add an explicit guard in `.github/workflows/e2e.yml` before the test step:

```yaml
- name: Verify e2e env is set
  run: |
    if [ -z "$NOTION_TOKEN" ] || [ -z "$E2E_ROOT_PAGE_ID" ]; then
      echo "::error::E2E env vars missing — refusing to run silently"
      exit 1
    fi
```

Plus: rename `E2E_ENFORCE=1` to `E2E_REQUIRE_LIVE=1` for clarity. The `_ENFORCE` flag has the right semantics (fail-loud) but the name doesn't communicate that.

---

**M6. `add_database_entries` batch-error path lacks live e2e coverage.**
**File:line evidence.** `tests/database-write-strictness.test.ts:169-193` (G4a-5) tests the unit-level "loop continues past throw" behavior with mocked `pages.create`. No live test verifies the batch path against a real Notion workspace. Combined with H2 (tool not in live e2e), this is the highest-leverage missing test in the database-mutation surface.

**Fix shape.** Add a live e2e G1 that:
1. Creates a database with title + select + relation columns.
2. Calls `add_database_entries` with [valid, invalid (unknown column), valid].
3. Asserts `succeeded.length === 2`, `failed.length === 1`, both succeeded entries are queryable.

Estimated 40 lines.

---

**M7. Test isolation pattern is `freshDbId` counter — strong but doesn't cover schema-cache state across describe blocks.**
**File:line evidence.** `tests/database-write-strictness.test.ts:82-83` uses module-level `let counter = 0; const freshDbId = (tag) => ...`. `tests/property-roundtrip.test.ts:47-48` does the same. Each `it` gets a unique `dbId`, so the schema cache (5-minute TTL per CLAUDE.md) doesn't leak across tests within a single file. But the counter is module-scoped — if vitest decides to parallelize files, two test files using the same counter pattern could collide on dbId names. Currently vitest defaults to file-isolation, so this is dormant.

**Fix shape.** Make `freshDbId` use a UUID or `randomUUID()` for cross-file safety. Five-line change per file. Not blocking.

---

### Low

**L1. Bench scripts' results not committed; drift not visible across runs.** `.meta/bench/runs/run-*.manifest.json` is gitignored. The current run's numbers exist in memory; the previous run's numbers exist on someone's machine. To detect drift, you need a committed baseline. Combine with M1.

**L2. Inline-comment preservation claim untested.** Already filed in `pr-audit-deferred-items-from-met` M1.

**L3. `child_page` / `synced_block` non-preservation claim untested.** Already filed in `pr-audit-deferred-items-from-met` M2.

**L4. F5 block-ID preservation threshold relaxed to 0.7.** Already filed in `pr-audit-deferred-items-from-met` M3.

**L5. The translator's `unrepresentable_block` warning is dead code.** Already filed in `pr-audit-deferred-items-from-met` L1.

---

### Informational

**I1. Test pyramid is healthy.** 461 unit tests passing on dev (post-PR3, 543 if you include PR3 fix tests). Strong handler-level coverage via `InMemoryTransport` + `createServer` factory (the `connect` helper appears in 7+ test files with consistent shape). 31 live e2e against real Notion. Clean separation between fast unit (no network) and slow live (real workspace).

**I2. TDD adherence is consistent in the last 30 days.**
Sampled the 4 substantive feature commits since 2026-04-01:
- `0ea4efd` (PR3, feat): 60+ tests in same merge commit.
- `7a2fba6` (PR #55, fix): commit message names two test files (`tests/main-module.test.ts`, `tests/http-bin-startup.test.ts`) added in same commit, with explicit "would have caught #53" claim.
- `520fedf` (PR2 pagination, feat): 4 new test files (1100+ lines of test code) in same commit.
- `c5e27bc` (PR1 property-type gap, feat): tests in same commit.

No "test-after" pattern observed. Per learnings `[e9dcf6]` and `[4eda40]` (TDD requirement), discipline is current practice, not aspirational.

**I3. CI is genuinely fast — 18-26 seconds per Node version per `project_state.md`. Tests run on Node 18 + 20.** The cost-of-running-the-full-suite is low enough that adding e2e hooks to PR CI would be feasible if the workspace cost is acceptable.

**I4. The e2e teardown classifier (`tests/e2e/helpers/archive-errors.ts`) and standalone sweeper (`scripts/e2e/sweep-stale.ts`) are thoughtful state-leak mitigations.** The sweeper runs `if: always()` post-test in the e2e workflow (`.github/workflows/e2e.yml:56-58`), giving a second chance to clean up if the in-test teardown fails. This is a positive pattern — preserve it when refactoring.

**I5. Only one `.skipIf` in the codebase (the e2e env-gate). Zero `.skip`, `.todo`, `.only`, or other suspended tests.** No silent test-suspension debt. This is unusual and worth noting — many codebases of this size accumulate skipped tests over time.

---

## Testing assessment

**What's well-tested:**
- Markdown parser forward path (`markdown-to-blocks.ts`) — `tests/markdown-to-blocks.test.ts` is 897 lines, covers every convention in the CLAUDE.md table.
- Markdown reverse path (`blocks-to-markdown.ts`) — `tests/blocks-to-markdown.test.ts` is 570 lines.
- Round-trip — `tests/roundtrip.test.ts` (255 lines) plus `tests/relation-roundtrip.test.ts` and `tests/property-roundtrip.test.ts`.
- Translator (`markdown-to-enhanced.ts`) — `tests/markdown-to-enhanced.test.ts` was strengthened post-PR3 to use exact-output `toBe` for most cases. Callout color, XML escaping, equation delimiters, code language, TOC, divider, and to_do are all pinned.
- Handler validation paths — `update_block` retrieves before update, validates type, archives via `in_trash`, rejects empty/multi-block markdown, all pinned at unit level.
- Pagination — `paginate-page-properties.test.ts`, `paginate-property-value.test.ts`, `read-page-title-pagination.test.ts`, `query-database-pagination.test.ts` are all comprehensive. Cap=75 default, cap=0 unlimited mode, `truncated_properties` warning name, `how_to_fetch_all` hint string — all pinned by exact value or substring.
- Warning codes — every code emitted in `src/` is pinned by name in tests (except `unrepresentable_block`, dead code).
- Database write strictness — `tests/database-write-strictness.test.ts` (461 lines) covers unknown-key rejection, stale-cache bust, sandwich loop continuation, all from G-4a synthesis.

**What's under-tested:**
- Property-type *value* writes (H1) — 10 of 12 writable types have no positive write test.
- Tools without live e2e (H2) — 16 of 29 tools, including `find_replace`, `add_database_entries`, `update_database_entry`, `duplicate_page`.
- Translator table/column structure (H3, H4) — `toContain` instead of `toBe`, ordering and metadata not pinned.
- Translator body escaping for `{}` (M2) — single missing test.
- `add_database_entries` batch path against real Notion (M6).
- The atomicity contract under live failure (H5).

**Where the test strategy breaks down:**
- **Bench scripts** (M1) — they are measurement instruments without a regression-catching layer. The strategic narrative built on their numbers (see `bench-scripts-audit-2026-04-28.md`) compounds the risk. If the README revision lands citing W1's "98% smaller" without first wrapping the bench in tests, a future tokenizer-version bump or scope refactor could silently shift the public claim.
- **Live OAuth capture against `mcp.notion.com`** (existing tasuku `live-oauth-capture-mcp-notion-com`) — this is a missing surface, not a missing test. Until it lands, the bench audit's C1 (does hosted expose `update_content`?) is unsettled, and the contract-vs-implementation pattern transitively affects every claim about hosted MCP behavior.
- **Notion API version drift** (M4) — the version pin lives in source code (`src/notion-client.ts`) and test code (`tests/e2e/live-mcp.test.ts:961`) independently. Centralizing would prevent silent drift.

**Test-pass-rate posture (last 30 commits):** No skipped tests, no `.todo`, one `describe.skipIf` (intentional env-gate). CI is reportedly green (per project_state.md, runs in 18-26 seconds). The e2e suite has had one historic failure documented (`diagnose-e2e-unique-id-state-leak` from run 24873858896 on 2026-04-24); root cause unfixed in source but downgraded to normal priority because the sweeper cleanup may have masked it. No flake patterns observed in the recent commit log.

**Test isolation:** Strong. `freshDbId(tag)` counter pattern is consistently applied across the unit tests that need to bypass the schema cache. The e2e suite uses one sandbox per run (named with `shortSha`-tagged ISO timestamp), one stdio client, two HTTP clients (one in main describe, one in HTTP-parity sub-describe). State-leak surfaces are minimal: the unique_id prefix collision (H6) is the one open class. Cross-test schema-cache bleed is prevented by per-test fresh dbId. Concurrent runs are prevented by `concurrency: e2e-tier1, cancel-in-progress: true`.

---

## Positive patterns

These are working — preserve them:

1. **InMemoryTransport + createServer factory pattern** — every handler test connects an MCP client to the real server in-process. No HTTP, no stdio, no spawning subprocesses. Fast and faithful. The pattern is consistent across `tests/replace-content-atomic.test.ts`, `tests/update-block.test.ts`, `tests/find-replace.test.ts`, `tests/database-write-strictness.test.ts`, `tests/property-roundtrip.test.ts`. New handler tests should follow this template.

2. **Per-test fresh dbId + module-scoped counter** — `tests/database-write-strictness.test.ts:82-83`, `tests/property-roundtrip.test.ts:47-48`. Cleanly bypasses the 5-minute schema cache without resetting it. Test isolation is robust.

3. **Exact-output `toBe` assertions in `tests/markdown-to-enhanced.test.ts`** — the post-PR3 strengthening (per audit findings H1, H2) hardened most translator tests to exact-output. This is the right discipline for translator-style code where any character difference is a bug. The remaining `toContain` cases (table, columns) are the outliers and should follow this lead.

4. **Warning-code testing with `objectContaining`** — `tests/replace-content-atomic.test.ts:189` uses `expect.objectContaining({ code: "bookmark_lost_on_atomic_replace" })` to allow extra fields while pinning the code. This balances forward-compat with contract enforcement.

5. **E2E teardown classifier** — `tests/e2e/helpers/archive-errors.ts` distinguishes "tolerated" (already-archived ancestor, not-found) from "unexpected" cleanup failures and surfaces a summary log line. Makes flake debugging tractable.

6. **`if: always()` sweeper in e2e workflow** — `.github/workflows/e2e.yml:56-58` runs `npm run test:e2e:sweep:apply` after the test step regardless of pass/fail. Second chance to clean up if in-test teardown fails. Matches the project's "ship a sweeper alongside the tests" discipline.

7. **No skipped tests in the codebase** — exactly one `.skipIf` (the env-gate), zero `.skip` / `.todo` / `.only`. No suspended-test debt.

8. **Mutation-resistant warning code names** — every warning code in `src/` is pinned by name in at least one test, with exact equality. Renames break loudly. This is the core machinery that makes the contract-vs-implementation gap *small* on this surface.

9. **Stateful mock fixtures (`makeStatefulNotion`)** — `tests/property-roundtrip.test.ts:50-130` builds a stateful mock that stores schema + page-properties across multiple calls within one test. Lets a single test exercise the full create-database → add-entry → query-database round-trip without coordinating 7 mock returns. Preserve the pattern when adding more round-trip coverage for H1.

---

## Audit areas not covered

- **No live Notion sandbox probes during this audit.** The unit-level mutation evidence is concrete; the live-shape evidence (Notion-Version drift, real failure modes of `pages.updateMarkdown`) was not exercised.
- **The `tests/bench/` harness** (12 scenarios under `tests/bench/scenarios/`, plus `tests/bench/harness/runner.test.ts` etc.) was glanced at but not deeply audited. The bench harness has its own tests; whether those tests catch real regressions in the harness is its own audit.
- **The auth surface (`src/auth/oauth-provider.ts`, `src/auth/token-store.ts`)** has unit coverage at `tests/token-store.test.ts` (133 lines). The OAuth flow under HTTP transport with real OAuth state isn't live-tested. This is partially addressed by HTTP-parity H1/H2 tests but the full OAuth round-trip (consent screen → token exchange → refresh) is not exercised in CI.
- **Concurrent write semantics** — the schema cache, file-upload state, OAuth token refresh: none are tested under concurrency. Likely fine for stdio (single user); under HTTP OAuth mode multiple clients can call simultaneously and the schema cache is module-scoped.

---

## Cross-reference summary (overlap with existing tasuku / memos)

| Finding | Existing task / memo | Status |
|---|---|---|
| H6 unique_id prefix collision | `diagnose-e2e-unique-id-state-leak` | Direct match — collapse with concrete fix shape |
| H3, H4 translator table/column exactness | `pr-audit-deferred-items-from-met` H3 (table_row) | Adjacent, broaden the existing item |
| M3 tool-list positive-name test | `pr-audit-deferred-items-from-met` M6 | Direct match |
| L2 inline-comment preservation | `pr-audit-deferred-items-from-met` M1 | Direct match |
| L3 child_page/synced_block | `pr-audit-deferred-items-from-met` M2 | Direct match |
| L4 F5 threshold | `pr-audit-deferred-items-from-met` M3 | Direct match |
| L5 unrepresentable_block dead code | `pr-audit-deferred-items-from-met` L1 | Direct match |
| H2 silent-failures broader | `audit-existing-tools-for-silentf` | Adjacent (different framing) |
| M1 bench regression-catching | `bench-scripts-audit-2026-04-28` C1, C2 | Adjacent (claim layer was audited; instrument layer is this finding) |

Distinct (no existing task overlap): H1 (property-type write coverage), H2 (untested-live tools), H5 (live atomicity), M2 (brace escape), M4 (Notion-Version centralization), M5 (E2E_ENFORCE guard), M6 (add_database_entries live), M7 (cross-file dbId UUID), I3-I5 (informational).

Recommended task disposition (orchestrator's call, not the audit PM's):
- **Fix now (high priority):** H1, H2 (Tier 1 only), H6 (already filed; bump priority if collision recurs).
- **Fix soon (medium):** H3+H4 grouped, H5, M1 (gate the README revision on bench regression-catching), M3 (already filed).
- **Note for later:** M2, M4, M5, M6, M7, all Lows. Pull as they bite.

---

## Session chain

- **Audit PM (this file):** orchestrator-spawned audit-role session for `testing-practices-audit-2026-04-30`. Read-only.
- **Codex pass — mutation testing:** `testing-audit-mutations` (sessionId `019de250-edc5-72d2-b71c-4f192e4ed908`). Output: `.meta/audit-b-fixtures/codex-mutation-pass-2026-04-30.md`. 51 mutations analyzed, 43 caught, 8 missed. Codex did not edit `src/` and did not run live e2e.

---

## Top-line counts

- **Critical:** 0
- **High:** 6
- **Medium:** 7
- **Low:** 5
- **Informational:** 5
- **Total findings:** 23

**Cross-references:** 8 of 23 findings overlap with existing tasuku / audit memos. Net new findings: 15.

**Top 5 by severity (with cross-ref status):**
1. H1 — Property-type value writes have no positive test for 10 of 12 writable types. **NEW.**
2. H2 — 16 of 29 tools have no live e2e coverage. **NEW.**
3. H3 — Translator table tests use `toContain`; row/cell order and header metadata silently droppable. **Adjacent to PR3 H3.**
4. H4 — Translator column order silently reversible. **Same family as H3.**
5. H5 — F2 atomic failure-safety contract pinned only at unit level. **Builds on PR3 H4.**

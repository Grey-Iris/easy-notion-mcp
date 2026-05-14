---
date: 2026-05-13
scope: E2E Tier-1 reliability — G2b create_page timeout investigation
audit_pm: Claude (Opus 4.7, 1M)
codex_sessions: (none — investigation done from log archives and code reads in main session)
---

# E2E Tier-1 reliability investigation — G2b update_toggle / many-toggle create_page

## Verdict (1 paragraph)

This is **(b) a real shaping inefficiency in our code** with **(a) Notion-latency
variance as the trigger**. G2b's `create_page` payload (40 toggles, each with paragraph
children) is rendered into **~42 sequential live API calls** by
`prepareBlockForWrite` + `createPage`'s deferred-children loop. At Notion's fast latency
(~0.5 s/call) the test finishes in ~20 s; at normal latency (~1 s/call) it finishes in
~40 s; at slow latency (~1.4 s/call) it blows the 60 s MCP-client timeout. The two
consecutive failures James flagged are the same class of failure that has been
intermittent on the suite for at least four days. **It is not specific to v0.9.2 or
to the catch-up merge.** The 5/11 main scheduled run *passed* but G2b took 43 080 ms —
72 % of budget — confirming we are running near the cliff on every successful run.

## What James asked vs what the runs actually say (correction)

| Claim | Evidence | Correction |
|---|---|---|
| "Run 25767049697 (v0.9.2 5813f61) FAILED" | run conclusion = **cancelled** (auto-superseded by 25767433759 four minutes later) | Only one of the two runs James cited as failures actually failed (25767433759). v0.9.2 itself has **no executed failing run on `dev`** — its push got cancelled. |
| "Both runs had `create_page failed: RequestTimeoutError` earlier in the log" | The 23:08:57 `create_page failed` line in run 25767433759 happened in an earlier (passing) test ~90 s before G2b started; it was masked by `executeWithRetry` in the Notion SDK and that test still shows ✓ in the summary. | The early `RequestTimeoutError` is a **separate, transient slow Notion call** in an earlier test, not a precursor to the G2b failure. It is evidence of generally elevated Notion latency that day, but not part of the G2b failing call path. |

## Evidence table — last 9 push/scheduled E2E runs

(Timings in **ms**. `*` = test passed but ran slow. Listed newest → oldest.)

| Run ID | SHA | Branch | When (UTC) | Conclusion | Failing test(s) | G2b runtime |
|---|---|---|---|---|---|---|
| 25767433759 | cbc864a | dev | 5/12 23:05 | FAILURE | **G2b @ 60 037 ms** (MCP-client timeout) | 60 037 (×) |
| 25767049697 | 5813f61 v0.9.2 | dev | 5/12 22:55 | **cancelled** | n/a — superseded | n/a |
| 25762546750 | 22598ee | dev | 5/12 21:13 | FAILURE | F1 (transient cleanup race), **G4 @ 30 009 ms** (Vitest 30 s budget) | 23 437 ✓ |
| 25662679172 | 38aa85b | main (sched) | 5/11 09:45 | SUCCESS | — | **43 080** ✓\* |
| 25598276830 | f24a99d | dev | 5/9 09:58 | FAILURE | **G2b @ 60 041 ms** | 60 041 (×) |
| 25597612660 | 61eba3c v0.9.1 | dev | 5/9 09:24 | FAILURE | **V2 @ 30 033 ms** | 19 336 ✓ |
| 25596430977 | 0043b00 | dev | 5/9 08:23 | FAILURE | **relation-pagination "27 entries" @ 30 014 ms** | 23 908 ✓ |
| 25596215415 | 841295a | dev | 5/9 08:12 | FAILURE | relation "75 entries" @ 43 583 ms; **G4 @ 30 010 ms** | 22 452 ✓ |
| 25596070092 | 4741a28 | dev | 5/9 08:04 | FAILURE | C6 unique_id prefix collision (real test bug, sandbox pollution) | 28 630 ✓ |

**Pattern.** Of 8 executed runs across the window, **G2b fails 2/8** and is **slow but
passing 6/8**. In four of the runs where G2b passed, a *different* slow test still
tripped its own timeout (G4, V2, relation pagination). One run (5/9 08:04) failed for
an unrelated assertion (unique-id prefix collision, sandbox pollution). The unifying
class across 7 of 8 failures is **Notion-latency variance vs. per-test timeout budget**,
not a code regression.

The v0.9.2 change (`src/notion-client.ts` `getDataSourceId` only — `5a9b9b8`,
`793a28e`, `5813f61`) does **not touch any code path G2b exercises**. G2b's failure
on `cbc864a` (merge commit) is not caused by the merge content.

## G2b test body (citation)

`tests/e2e/live-mcp.test.ts:1449-1496` —

- Builds **40 toggles** via `Array.from({ length: 40 }, ...)` (line 1453).
- Each toggle body is either a 2-paragraph sentinel block (target toggle) or
  `Script <n> body <120-char x-padding>` (line 1461).
- Single `callTool create_page` with `markdown: toggles.join("\n\n")`, `timeoutMs: 60_000`.
- Then `update_toggle`, then `read_toggle`. Per-call timeout 60 s each, test-level
  timeout 90 000 ms.

The MCP-client default `timeoutMs` is **30 000 ms**
(`tests/e2e/helpers/mcp-stdio-client.ts:116-125`); G2b explicitly raises each call to
60 s, which is the higher of the two budgets seen tripping in the failure data.

## Where the time goes — create_page pipeline trace

For 40 toggles each with paragraph children, the path is:

1. **`prepareBlockForWrite`** (`src/notion-client.ts:148-187`). For every block whose
   type passes `isOptionalChildrenContainer` (toggle is one — line 122), it strips
   children via `withoutBlockChildren` (line 151-153). The initial `pages.create`
   therefore carries 40 *empty* toggle stubs.
2. **`createPage`** (`src/notion-client.ts:1009-1066`).
   - Line 1023 — `pages.create` with 40 empty toggles  → **1 call**.
   - Line 1021 detects `initialBlocksNeedDeferredWrites` (every toggle has body
     children).
   - Line 1039 — `listChildren(page.id)` to map indexes → block IDs  → **+1 call**.
   - Lines 1040-1049 — `for (let index = 0; index < initialBlocks.length; index += 1)`,
     and inside, `appendDeferredChildren(client, createdBlockId, initialBlocks[index])`.
     For a toggle (`isOptionalChildrenContainer`), `appendDeferredChildren`
     (line 230-235) calls `appendBlocks` which is **one append per toggle** because
     each body is well under 100 blocks.
     This is **sequential** (`await` per iteration), so **+40 calls**.

**Total ≈ 42 sequential API calls** for the single `create_page` in G2b.

The follow-up `update_toggle` + `read_toggle` cost is small (a handful of calls each).
The 60 s budget is almost entirely consumed by `create_page`.

## Latency math vs. observed runtimes

If a run's average per-call Notion latency is **L**, expected G2b runtime is roughly
`42 · L` plus fixed overhead. Plotting observed runtimes against implied L:

| Run | G2b runtime | Implied avg L | Outcome |
|---|---|---|---|
| 5/9 09:28 (61eba3c) | 19 336 ms | ~0.46 s | comfortable |
| 5/9 08:12 (841295a) | 22 452 ms | ~0.53 s | comfortable |
| 5/12 21:19 (22598ee) | 23 437 ms | ~0.55 s | comfortable |
| 5/9 09:03 (0043b00) | 23 908 ms | ~0.57 s | comfortable |
| 5/9 08:04 (4741a28) | 28 630 ms | ~0.68 s | tight |
| **5/11 09:51 main**  | **43 080 ms** | **~1.02 s** | **near cliff** |
| 5/9 09:58 (f24a99d) | 60 041 ms (×) | ≥ 1.43 s | over |
| 5/12 23:11 (cbc864a) | 60 037 ms (×) | ≥ 1.43 s | over |

G2b's failure point is ~1.4 s average per-call. Notion routinely exhibits that and
worse during peak periods, especially when Cloudflare `cf-ray` headers indicate a
slow edge (multiple `cf-bm` cookies refreshed during the run, visible in the logs of
both failed runs).

## Why the deferred-write loop is unnecessarily heavy here

The rule recorded in `learnings-notion-client-ts.md` —
*"avoid sending nested Notion write payloads deeper than two child levels"* —
allows depth-2 children. A toggle (depth 1) containing paragraphs (depth 2) is **within
budget for a single `pages.create` call**. But `prepareBlockForWrite:151-153` strips
children from every `isOptionalChildrenContainer` block uniformly, regardless of
whether the children are themselves containers. So G2b's depth-2 payload pays the cost
of a deep-nesting workaround it doesn't need.

(A deliberate-tradeoff caveat: I have not verified against the Notion API docs that
toggles specifically accept `toggle.children` inline in `pages.create`. The markdown
parser at `src/markdown-to-blocks.ts:625-635` already emits `toggle.children` in
that shape, and the column path *does* inline its first child via `prepareBlockForWrite`,
so the inline path is at least architecturally available. James / a builder should
verify before relying on this fix.)

## Other failing tests in the window — same class

- **G4 (`tests/e2e/live-mcp.test.ts:1595`, runs 25762546750 & 25596215415)** timed out
  at exactly 30 009-30 010 ms — Vitest default. G4 creates a database, adds a row,
  updates the row, then queries it. Multiple sequential live calls, no explicit
  `timeoutMs` override, no per-`it` budget set. Same shape as G2b — multiple sequential
  Notion writes, fixed budget too tight on slow days.
- **V2 (run 25597612660)** — view mutation test, 30 033 ms timeout, server log shows
  `Tool create_database failed: RequestTimeoutError: Request to Notion API has timed
  out` — the Notion SDK's own 60 s default hit before the test's 30 s.
- **Relation-pagination (runs 25596215415 & 25596430977)** — same pattern: multiple
  sequential API calls hitting per-test 30 s budget.
- **F1 (run 25762546750)** — different shape: cleanup race surfaced as
  `archived ancestor` error. Possibly distinct; only one occurrence so far.
- **C6 unique_id prefix (run 25596070092)** — *not* a timeout. Real test bug: prefix
  collision across runs because the sandbox isn't fully purged. Worth filing separately;
  out of scope here.

## Remediation options (ranked by leverage)

### Option 1 — Inline toggle/heading children in `prepareBlockForWrite` for depth-2 payloads (high leverage, our code)
- **What.** In `prepareBlockForWrite`, change `isOptionalChildrenContainer` blocks so
  that if none of their children themselves require deferred writes, the children are
  written inline as `<type>.children` in the initial create/append payload (same way
  the column path inlines its first child via `prepareBlockForWrite(seed)` at line
  179-183). Only fall back to the deferred path when a grandchild is itself a
  container.
- **Effect on G2b.** Drops the call count from ~42 → 1 for `create_page`. Test
  runtime collapses from 20-60 s to ~1-2 s.
- **Scope.** ~30-50 lines changed in `notion-client.ts`. Affects every `create_page`
  / append that uses toggle/callout/list-item/toggleable-heading containers.
- **Risk.** Medium. Need to (a) confirm Notion accepts `toggle.children` inline in
  `pages.create` (the markdown parser already emits this shape; the API may already
  accept it — verify via a focused unit test against live Notion before merging),
  (b) ensure we still defer when the toggle contains a deeper container (column,
  table, nested toggle). Existing `needsDeferredChildWrites` recursion can drive the
  decision.
- **Owner.** Us. This is a clear product fix.
- **Side benefit.** Reduces flake risk for any other markdown-heavy `create_page` in
  the suite or in real-user calls.

### Option 2 — Parallelize the deferred-append loop in `createPage` (medium leverage, our code)
- **What.** In `createPage:1040-1049`, replace the sequential `for ... await` with
  `Promise.all` (capped concurrency, e.g. 5-10). The N-toggle case becomes
  ⌈N / concurrency⌉ × latency instead of N × latency.
- **Effect on G2b.** At concurrency 8 and ~1 s/call, runtime drops to ~7-10 s.
- **Scope.** Smaller diff than Option 1. ~10 lines.
- **Risk.** Medium-low. Notion's API enforces rate limits (3 RPS soft); 8 concurrent
  appends *to the same page* may surface 429s under load. Need a small concurrency
  cap and existing `executeWithRetry` should handle bursts. Order preservation isn't
  required for deferred appends (each goes into a *different* toggle).
- **Owner.** Us.
- **Compatibility note.** Option 1 and Option 2 are not mutually exclusive. Option 1
  is the larger win; Option 2 is a cheaper insurance policy.

### Option 3 — Don't change shaping; just raise test timeouts on the affected tests (low leverage, masks the smell)
- **What.** Lift G2b's `timeoutMs` from 60 000 → 120 000 and add explicit
  `it("…", async () => {…}, 90_000)`-style budgets to G4, V2, relation-pagination.
- **Effect.** Suite stops failing intermittently. Real product code stays slow.
- **Scope.** Trivial. Test-file only.
- **Risk.** None to product. **High signal cost** — masks a runtime defect that will
  surface for real users with similar 40-block toggle markdown, and the suite gets
  slower without solving the underlying inefficiency.
- **Owner.** Us. Not recommended as the *only* action. Reasonable as a one-line
  stopgap to unblock the v0.9.2 catch-up merge while Option 1 is being built.

### Notion-side
- None of the three options change Notion's latency. **Notion latency variance is the
  trigger but not the lever.** We have no leverage on Notion; we have leverage on
  how many calls we make.

## Recommended path

1. **Now (to unblock the catch-up PR):** merge despite the failure if you accept the
   "known flake class" framing. Or take Option 3 as a one-line stopgap on G2b only.
   Do *not* disable G2b — it's catching a real performance smell.
2. **Next:** build Option 1. It's the high-leverage fix and benefits real users with
   markdown-heavy `create_page` calls, not just the test.
3. **Defer:** Option 2 as a future tightening if 429s aren't a concern.
4. **Separately track:** C6 unique-id prefix collision (sandbox pollution) and the
   F1 archived-ancestor cleanup race — each one occurrence, different shape, not part
   of this class.

## Session chain

- **This audit PM session:** opus-4.7 (1M context), foreground, single turn.
- **Codex sessions used:** none. Investigation was log-archive + targeted code reads
  in the audit session. Codex dispatch was unnecessary here because the evidence lived
  in (a) downloadable run logs, (b) ~200 lines of `notion-client.ts` and the G2b test
  body — small enough to read directly without delegating. Flagging this so reviewers
  know the audit was not "Codex-independent" as the pattern usually expects; if you
  want a second-opinion pass on the pipeline trace before acting on Option 1, dispatch
  Codex against `src/notion-client.ts:148-322` and `:1009-1066` with the question
  "does `prepareBlockForWrite` need to strip toggle children when toggle children are
  not themselves deferred-write containers?".

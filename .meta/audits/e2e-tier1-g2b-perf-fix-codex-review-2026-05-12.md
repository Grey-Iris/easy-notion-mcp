---
date: 2026-05-12
scope: Adversarial review of audit `.meta/audits/e2e-tier1-g2b-investigation-2026-05-13.md`
reviewer: Codex 5.3 (session `g2b-perf-fix-review`, id `019e1e7a-...`)
mode: read-only verification against source; no implementation
relates-to: ticket `fix-createpage-many-optional-containers-perf`
---

# Codex Review: G2b Perf Fix Audit

Verbatim Codex response from session `g2b-perf-fix-review`.

---

I'll verify the audit against the current tree, starting with the report and the exact cited code ranges. I'll keep this read-only and focus on whether the proposed fix is safe, not on implementing it. The cited ranges do show the broad shape, but I'm going to pin this to line-numbered evidence and check the surrounding helpers/test fixture before judging the fix. The safety question hinges on which containers get stripped, not just toggles.

**Verdict:** partial. The diagnosis and G2b call count are correct, but the proposed fix is underspecified and unsafe if built as "just inline depth-2 toggle children."

## Per-Claim Verification

- **Diagnosis: correct, with one wording caveat.** `prepareBlockForWrite` has no depth parameter/state and strips children from every `isOptionalChildrenContainer` via an unconditional early return at `src/notion-client.ts:148` and `src/notion-client.ts:151`. Optional containers are bullets, numbered lists, toggles, callouts, and toggleable H1/H2/H3 at `src/notion-client.ts:118`. `needsDeferredChildWrites` also marks any such block with children as deferred at `src/notion-client.ts:189`. Caveat: it does not "strip simple paragraphs" when preparing a paragraph directly; it strips the parent toggle's `children`, thereby excluding those depth-2 paragraphs from the first payload.

- **Effect: correct for G2b.** The fixture creates 40 toggles at `tests/e2e/live-mcp.test.ts:1453`, then calls `create_page` once at `tests/e2e/live-mcp.test.ts:1464`. `createPage` sends one `pages.create` at `src/notion-client.ts:1023`, lists created top-level children once at `src/notion-client.ts:1039`, then sequentially awaits each deferred block append at `src/notion-client.ts:1040` and `src/notion-client.ts:1048`. For a toggle, `appendDeferredChildren` calls `appendBlocks` once because children are under 100 blocks at `src/notion-client.ts:230`. Total for G2b create: `1 pages.create + 1 listChildren + 40 append = 42` live calls.

- **Proposed fix: not safe as stated.** Changing only `prepareBlockForWrite` would still leave `needsDeferredChildWrites` returning true for every toggle with children at `src/notion-client.ts:192`, so `createPage` would inline the children and then append them again. To get 42 → 1, the deferred predicate must change in lockstep.

## What The Auditor Missed

- The original workaround is broader than column→table. The learning says avoid nested write payloads deeper than two levels and use placeholder seeds for column/table cases (`.claude/rules/tasuku/learnings-notion-client-ts.md:11`). Tests also assert deep list/callout children are deferred to avoid grandchildren in the first request at `tests/notion-client-block-chunking.test.ts:370` and `tests/notion-client-block-chunking.test.ts:419`.

- Toggleable headings follow the same optional-container path when `is_toggleable` is true at `src/notion-client.ts:125`, and markdown emits them with children at `tests/markdown-to-blocks.test.ts:643`.

- The rollback guarantee changes. Deferred append failures after page creation trigger best-effort trash rollback at `src/notion-client.ts:1055`. Inline `pages.create` validation failures happen before a page id exists, so rollback is not available, though ideally no partial page exists.

## Edge Cases To Test Before Building

```md
+++ T
- parent
  - child
+++
```
Must not send depth-3 in the first request.

```md
+++ T
Paragraph 001

...
Paragraph 101
+++
```
Inlining 101 direct children would violate the 100-child request limit; current deferred path chunks at `src/notion-client.ts:293`.

```md
+++ ## Heading Toggle
+++ Nested
body
+++
+++
```
Toggleable heading plus nested toggle must still defer the nested container.

## Alternative Recommendation

Implement a single shared predicate, e.g. `canInlineChildrenInOneWrite(block)`, and use it from both `prepareBlockForWrite` and `needsDeferredChildWrites`. It should inline optional-container children only when child count is <= 100, no child subtree would exceed Notion's two-level nesting limit, and prepared children cannot hide deferred descendants. Add unit tests proving G2b-style 40 toggles makes one create call, nested toggles/lists still defer, and 101 children still chunk.

Parallelizing the deferred loop is viable only with measurement and a limiter. Notion documents an average 3 requests/sec limit and 429 handling via `Retry-After`, so uncapped `Promise.all` is not safe. A capped concurrency of 2-3 for independent top-level deferred blocks could be a fallback, but it is not the primary fix.

## Net

The audit found a real inefficiency, but its recommendation needs redesign before implementation. The safe task is not "inline depth-2 toggles"; it is "make write-shaping and deferred-detection agree on which optional-container children can be inlined without exceeding depth/count limits."

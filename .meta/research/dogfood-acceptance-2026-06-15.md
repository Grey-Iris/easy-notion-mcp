# Dogfood acceptance: identity-bearing receipts vs the count-only baseline → outputSchema-freeze readiness

**Date:** 2026-06-15
**Server under test:** easy-notion-mcp `dev`@`c0b7559` (Build A = discoverability tool descriptions; Build B = additive identity-bearing receipts: `success`, `block_map`, `deleted_blocks`, `text_preview`).
**Method:** 3 blind `claude-sonnet-4-6` agents re-ran the prior "build a launch hub then revise it" task against the bench server. Same task shape as the n=3 baseline. Evidence is the recorded transcript (`tool_use` + the following `tool_result`), parsed deterministically.
**Baseline compared against:** `.meta/research/dogfood-tool-contract-2026-06-14.md`.
**Independence:** trace I/O extracted deterministically by script (ground truth, not judgment); read-back classification + block_map causal chain independently re-derived by a separate Codex session before this PM's verdict. Both agree. Session chain at the bottom.

> **SUPERSEDED CORRECTION (2026-06-17).** This report's "receipt-shape gap" / verdict recommends *reconciling the `id` vs `block_id` field names before freezing `outputSchema`*. That recommendation is **wrong against prior decisions** and should not be acted on. It was written without `.meta/audits/all-42-return-shape-vocab-2026-06-14.md` in view, which already adjudicated this exact split: under the locked §H ("freeze all 42 tools as-is") + §J ("no breaking changes until 2.0") decisions, the legacy `id`/`block_id` spelling is **frozen as-is — renaming it is a forbidden breaking change.** The contract is: keep legacy keys, bind only NEW fields to `block_id` (the convention) — which the shipped `c0b7559` receipts already do. The count-vs-array "redundancy" is likewise already decided ("a count is never replaced, only supplemented by the map"). **There is no naming-reconcile work.** What this report's evidence legitimately establishes stands: the receipts are behaviorally validated, which satisfies the all-42 audit's "confirm in dogfood" gate for Group A (block-producing) + Group B (destructive section) receipts. The real remaining `outputSchema` prerequisites live in that audit (Finding 5 union live+dry-run schema; Finding 7 `text_preview` semantics) + round-trip tests + broader evidence (block types beyond paragraph/callout/toggle, error/empty paths, ideally a non-Sonnet client) — NOT field renaming.

---

## Headline

The receipts did exactly what the baseline predicted they would. **Every read-back and every `search_in_page` the baseline blamed on count-only receipts is gone.** Baseline forced an identity/blast-radius read in **3/3** runs and 2 `search_in_page` calls to recover block IDs; the new runs have **0 read-backs forced by a receipt gap** and **0 searches across all three runs**. The remaining reads are a final verification (task-invited "report what you built") and one markdown-syntax diagnostic unrelated to receipts.

The receipt **vocabulary** (which receipts to return, and that `block_map`/`deleted_blocks` are the right ones) is behaviorally validated. There is **one receipt-shape gap** worth reconciling before the irreversible `outputSchema` freeze: an identity field-name inconsistency (`id` at top level vs `block_id` inside `block_map`/`deleted_blocks`), plus count fields now redundant with their arrays. That is a small, well-scoped fix — not a redesign.

---

## Per-run trace tables (Notion tool calls only; * = read after a mutation)

Orchestrator's preliminary extraction verified call-for-call against the transcripts — **all three sequences match exactly.**

### Run 1 — `f74cc9dc` — 0 read-backs
| # | call | receipt (key fields) |
|---|---|---|
| 1 | read_page(parent) | `{id,title,url}` |
| 2 | create_page | `{success:true, block_map:[7]}` |
| 3 | replace_content | `{success:true, block_map:[9]}` |

### Run 2 — `14bc7b95` — 2 read-backs (1 OTHER, 1 VERIFY)
| # | call | receipt (key fields) |
|---|---|---|
| 1 | read_page(parent) | `{id,title,url}` |
| 2 | create_page | `{success:true, block_map:[11]}` — toggle parsed as `paragraph` |
| 3 | read_page* | diagnostic read (markdown toggle bug) |
| 4 | replace_content | `{success:true, block_map:[8]}` — toggle now `type:toggle` |
| 5 | update_section(Milestones) | `{deleted:6, appended:5, deleted_blocks:[6], block_map:[5]}` — swept callout+toggle |
| 6 | append_content | `{success:true, blocks_added:2, block_map:[2]}` — re-add from `deleted_blocks` |
| 7 | read_page* | final verify |

### Run 3 — `c7e339a3` — 1 read-back (VERIFY)
| # | call | receipt (key fields) |
|---|---|---|
| 1 | read_page(parent) | `{id,title,url}` |
| 2 | create_page | `{success:true, block_map:[8]}` |
| 3 | update_section(Milestones) | `{deleted:6, appended:5, deleted_blocks:[6], block_map:[5]}` — swept callout+toggle |
| 4 | update_block(`…8142…`) | `{id, type:paragraph, updated:true, success:true}` — **ID from create's block_map** |
| 5 | append_content | `{success:true, blocks_added:2, block_map:[2]}` — re-add from `deleted_blocks` |
| 6 | read_page* | final verify |

---

## Q1 — Did the receipts appear and were they seen? (YES, 3/3)

- **`create_page` returned `success:true` + `block_map`** in all 3 runs. Agents saw and used them. Run 1: "Page created. I have the block IDs." Run 2 diagnosed a parse failure straight off the map: "looking at the block_map, the toggle didn't render correctly — `+++ Open Questions` became a paragraph."
- **`replace_content` returned `success:true` + `block_map`** (Run 1, Run 2). Run 2 verified its fix from the map alone: "The toggle block was created successfully this time! The block_map shows … type:"toggle"" — no read-back needed.
- **`update_section` returned `deleted_blocks` + `block_map`** (Run 2, Run 3). Both agents read `deleted_blocks` to see the blast radius (see Q4).
- **`append_content` returned `success:true`, `blocks_added`, `block_map`** (Run 2, Run 3).
- **`update_block` returned `{id, type, updated:true, success:true}`** (Run 3).

## Q2 — Read-after-write classification (the crux): 0 forced by a receipt gap

| Run | read-back | class | motivating quote |
|---|---|---|---|
| 2 | after create_page | **OTHER** (markdown diagnostic, not a receipt-identity gap) | "looking at the block_map, the toggle didn't render correctly … Let me read the page to see what's there." The `block_map` already told it the toggle failed; the read was to see raw markdown and find a self-inflicted stray-`"` bug — content `read_page` exists for, not addressing the receipt should carry. |
| 2 | final | **VERIFICATION** | "Let me do a final read of the page to verify everything is in order." |
| 3 | final | **VERIFICATION** | "Now let me verify the final state of the page to make sure everything looks right." |

**Zero read-backs were forced by the receipt failing to provide identity.** (Independently re-derived by Codex — agrees.) Note the OTHER read in Run 2 was *reduced* in surprise by the receipt: the agent already knew from `block_map` the toggle had failed before it read.

## Q3 — `block_map` usage for targeted `update_block` without search (CONFIRMED)

Run 3 step 4 `update_block(block_id=380be876-[rest of sandbox block ID redacted])` targets the overview paragraph **whose ID came verbatim from `create_page`'s `block_map` (step 2)**. The only call between create and update_block is `update_section` — **no `search_in_page`, no `read_page`.** This is the direct elimination of baseline Run 3's two `search_in_page` ID-recovery calls.

Additional, sharper evidence in **Run 1**: the agent *planned* a read-back to get IDs — "Then I'll read back the page to get the block IDs" — then dropped it the instant the receipt arrived: "Page created. I have the block IDs." The `block_map` killed a read the agent had already decided to make. **`search_in_page` count across all 3 runs: 0** (baseline: 2).

## Q4 — `update_section` blast radius + `deleted_blocks` → inline self-correction (CONFIRMED, 2/2)

In both runs that used `update_section`, the H2 "Milestones" edit swept the trailing callout+toggle (same task-shaped blast as baseline). In **both**, the agent recognized the loss **from the `deleted_blocks` receipt and re-appended BEFORE any read_page**:
- Run 2: "I see that `update_section` deleted the callout and toggle too! … Now I need to re-add" → `append_content`, *then* the verify-read.
- Run 3: "I notice that the update_section deleted the callout and toggle blocks too!" → `append_content`, *then* the final read.

This is the single biggest behavioral change vs baseline, where the blast radius was invisible in a count receipt and forced a recovery `read_page` in **3/3** runs. `deleted_blocks` made it self-correcting.

## Q5 — §E @-mention degradation (CONFIRMED, 3/3 — convention still un-built)

No markdown syntax expresses a Notion inline page-mention, so all three silently degraded to a plain hyperlink:
- Run 1: `Parent workspace: [Token Tests](…)`
- Run 2: `↩ Parent: [Token Tests](…)`  (the agent's own report loosely called this "via a clickable mention" — it is a plain link, not a mention chip)
- Run 3: `↑ [Token Tests](…) (parent page)`

All three agents probed for a mention syntax (`@[page_id]` guesses in the thinking), found none in the markdown docs, and fell back to a link. **Re-justifies the §E mention-convention build** — receipts did nothing for this axis because it is an input-vocabulary gap, not a receipt gap.

## Q6 — Discoverability (Build A): no visible improvement (soft, honest negative)

3/3 runs still issued `ReadMcpResourceTool(easy-notion://docs/markdown)` to learn toggle/callout syntax, and still could not find @-mention syntax. Run 2 still tripped the toggle dialect (stray-quote + indentation discovery) exactly as the baseline's friction #5 predicted. The `ToolSearch` calls are the harness's deferred-schema mechanism, not confusion. **No attributable reduction in exploratory/confused calls** — the receipt-affirming description edits (commit `4f4e261`) did not remove the markdown-resource round trip. Don't over-claim Build A from this data; the baseline's "embed supported-syntax in `create_page` description" recommendation is still open.

---

## Baseline → now comparison

| Metric | Baseline (2026-06-14) | Now (2026-06-15) |
|---|---|---|
| Read-backs **forced by receipt gap** | **3/3 runs** (blast-radius discovery; ID recovery) | **0/3** |
| `search_in_page` (ID-recovery) calls | 2 (Run 3) | **0** |
| Blast-radius recovery method | read_page → re-append (after diagnostic read) | re-append **inline from `deleted_blocks`**, before any read |
| Targeted `update_block` ID source | mined via `read_page` + 2× `search_in_page` | **direct from `create_page` `block_map`** |
| Remaining reads | all forced | 1 markdown diagnostic + 2 final verifications (task-invited) |
| @-mention | degraded 3/3 | degraded 3/3 (unchanged — no convention) |
| Markdown-dialect onboarding read | 3/3 | 3/3 (unchanged — Build A no visible help) |

---

## Receipt-shape gap to reconcile before the freeze

`outputSchema` is irreversible: **adding** fields/array-entries later is backward-compatible, **renaming** fields is breaking. So the only freeze-blocking question is whether the current field names are the ones to live with forever. One concrete inconsistency:

1. **Identity key name is inconsistent.** The *same* block `380be876-[rest of sandbox block ID redacted]` is returned as **`id`** by `update_block` (and `read_page`/`create_page` top-level) but as **`block_id`** inside every `block_map` and `deleted_blocks` entry. Pick one (`id` or `block_id`) and use it everywhere before freezing. (Did not cause any observed failure — agents handled both — but it is exactly what `outputSchema` would lock in.)
2. **Count fields now duplicate their arrays.** `update_section` returns `deleted`/`appended` counts *and* `deleted_blocks`/`block_map` arrays; `append_content` returns `blocks_added` *and* `block_map`. Decide deliberately whether the counts stay (harmless convenience, but redundant) — don't freeze them by accident.
3. **`block_map` is top-level-only (no nested children).** Consistent with the baseline recommendation and with observed demand (no run addressed a nested block; the deepest targeted edit was a top-level paragraph). This is **not** freeze-blocking: adding nested children later is an additive, non-breaking change. Leave it top-level; defer `return=tree` to an opt-in param if a nested-edit need ever appears.

---

## Verdict: outputSchema-freeze readiness

**Validated to freeze — after one small naming reconciliation, not before.**

The receipt **vocabulary** is behaviorally proven: `block_map` and `deleted_blocks` eliminated 100% of the read-backs and searches the baseline attributed to count-only receipts, via the exact mechanisms predicted (ID-from-create reuse; inline blast-radius recovery). The agents saw the receipts, trusted them, and changed their tool sequences because of them. This is strong demand evidence, not speculative provisioning.

But "the receipts help" ≠ "these exact field names are the ones to lock forever." Before declaring `outputSchema`:
1. ~~**Reconcile `id` vs `block_id`**~~ — **WITHDRAWN (see SUPERSEDED CORRECTION at top).** The split is frozen-legacy by §H/§J; renaming is the forbidden breaking change. New fields already use `block_id`. No work here.
2. ~~**Decide the count-vs-array redundancy**~~ — **WITHDRAWN.** Already decided by the all-42 audit: counts stay beside the maps ("a count is never replaced, only supplemented").
3. Keep `block_map` top-level-only; nested support stays additive/deferred (safe to add post-freeze). *(This item stands.)*
4. **(ADDED, the real prerequisites)** Author the `outputSchema` as the union of each tool's live + dry-run success branches (all-42 audit Finding 5); pin `text_preview` semantics (Finding 7); add round-trip tests that both branches validate; broaden evidence beyond n=3 Sonnet / single task shape before declaring.

Then freeze. The fix is hours, not a sprint, and the additive fields are already shipped and working.

**Honest limits.** n=3, `claude-sonnet-4-6` only, single task shape, one throwaway integration. All three agents converged on the same edit paths (a shared-model bias); a different model might exercise nested-block addressing and surface the one deferred gap. The `update_section` blast radius is partly task-shaped (Milestones was the last heading) — its severity is amplified here, though the `deleted_blocks` win holds regardless of layout. Treat this as a strong directional acceptance signal for the receipt design, not a statistical proof, and as a clean go-ahead for the freeze *once the field-naming is reconciled*.

---

## Session chain

- Audit PM session: this turn (deterministic trace extraction via `/tmp/parse_full.py`; judgment + report).
- Independent verifier: Codex session **`audit-receipts-readback-classify`** (`019ecaf8-6633-7a32-b985-ce05271becde`) — re-derived Q1 read-back classification, Q2 block_map→update_block causal chain, Q3 Run 1 planned-read skip, Q4 deleted_blocks inline recovery, Q5 search count. All five agree with this PM's findings.
- Source transcripts: `f74cc9dc` (Run 1), `14bc7b95` (Run 2), `c7e339a3` (Run 3).
- Baseline: `.meta/research/dogfood-tool-contract-2026-06-14.md`.

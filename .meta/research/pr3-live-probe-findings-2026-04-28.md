# PR3 live-probe findings

**Date:** 2026-04-28.
**Source:** `scripts/bench/pr3-live-probes.ts` run against the test-bot Notion workspace.
**Notion-Version:** 2025-09-03 (header pinned via SDK `notionVersion` option).
**Endpoint exercised:** `pages.updateMarkdown` with `type: "replace_content"`.
**Raw output:** `.meta/research/pr3-live-probe-raw-2026-04-28.json` (kept beside this memo for the orchestrator's review; safe to delete after PR3 ships).

The probes resolve §9.1 of `.meta/plans/pr3-atomic-replace-update-block-2026-04-28.md` and item (c) of the dispatch return.

---

## Headline

The probes confirm Exit A (build a translator) is the only honest way to ship atomic `replace_content` without regressing on the convention surface this server stakes its identity on. They also confirm the wedge claim: block IDs survive replace at near-100% rate when the markdown round-trips faithfully. Circuit breaker did NOT fire — the spec is well documented (`developers.notion.com/guides/data-apis/enhanced-markdown`), the failure mode is well-defined, and we now have ground truth from live calls instead of inference from SDK types alone.

---

## Probe 1 — `allow_deleting_content` default + rejection semantics

**Question:** With the flag omitted, with `false`, with `true` — which actually deletes existing content?

**Finding:** All three calls succeeded. `replace_content` deleted the previous markdown body and wrote the new content in every case. The flag did NOT block deletion in any of the three runs against a page containing only paragraphs and headings (i.e. content that the parser fully represents). `unknown_block_ids` was empty in all three.

**Implication:** For pages whose existing content is fully representable as Enhanced Markdown, `allow_deleting_content` is effectively a no-op — Notion does not require it. But we should still send `allow_deleting_content: true` defensively because the safety rail likely engages when the page contains blocks the parser can't represent (synced_block, child_page, etc.) — and in that case, sending `true` matches our existing destructive-replace contract. **No need to default to `false`** (would be more cautious, but probe 1 shows it's not required for the common case, and probe 2's failure modes don't surface there either).

**Disconfirming-test status:** §9.3 risk #1 (atomic-replace infeasible because the flag always rejects) does NOT trigger. Atomic replace is feasible.

---

## Probe 2 — Custom GFM-extension syntax through the atomic endpoint

**Question:** What does Notion do with `+++ Toggle`, `::: columns`, `> [!NOTE]`, `$$equation$$`, `[toc]`, bare-URL bookmarks when sent through `replace_content`?

**Finding (the critical one):** **Notion's parser does not recognize ANY of our custom conventions.** Every custom syntax landed as paragraphs (or quotes for the `> [!NOTE]` case, treated purely as a Markdown blockquote). Specifically:

| Sent | Landed as |
|---|---|
| `+++ Toggle title\nbody line 1\n+++` | 3 paragraph blocks: `+++ Toggle title`, `body line 1`, `+++` |
| `::: columns\n::: column\n…\n:::` | Each line landed as a separate paragraph including the literal `:::` markers |
| `> [!NOTE]\n> Note callout body.` | Two `quote` blocks (NOT a callout): `[!NOTE]`, `Note callout body.` |
| `$$E=mc^2$$` | One paragraph containing `E=mc^2` (the `$$` markers were stripped by markdown parsing as inline math, but no equation block was created) |
| `[toc]` | One paragraph containing `[toc]` |
| `https://example.com/…` (bare URL) | One paragraph containing the URL as a link |

**Implication:** Sending unmodified GFM-with-extensions through `pages.updateMarkdown` with `type: "replace_content"` would silently regress every page that contains a toggle, column, callout, equation, ToC, or bookmark. **This rules out Exit C.** Exit B (defer atomic) and Exit A (build translator first) remain. Per the dispatch brief's spec research and the published Enhanced Markdown reference, the syntax is concrete enough to TDD against — Exit A goes ahead.

**Disconfirming-test status:** §9.3 risk #3 (translator can't represent some block type) is partially confirmed for bookmarks/embeds — the spec confirms these have no input form. PR3 will implement a "best-effort + warning" path for these two types: send the URL as a bare-URL paragraph (Notion handles auto-linking) and surface a warning so callers know the bookmark/embed semantics are lost on round-trip.

---

## Probe 3 — `unknown_block_ids` semantics

**Question:** Replace a 6-block page with mostly-unchanged content. Does `unknown_block_ids` populate?

**Finding:** `unknown_block_ids: []` (empty array) on a page where 6/6 representable blocks were replaced with near-identical markdown. **All 6 IDs survived.** Notion treats a one-paragraph edit as "edit in place, preserve ID."

**Implication:** `unknown_block_ids` does NOT signal "blocks that didn't match the new markdown." It probably signals "blocks that the input markdown could not represent" (i.e. the tool wanted to keep them but couldn't because they exist on the page in a form Enhanced Markdown can't describe — synced_block, child_database, etc., on the source page). We surface it as a warning anyway per plan §6.3 — it's still useful information for callers.

**Future note:** Because we don't have direct evidence of the `unknown_block_ids` non-empty case (the test-bot page contained no synced_blocks or other unrepresentable types), the wire shape we surface remains the SDK-typed `string[]`. Surfaced via `warnings: [{ code: "unmatched_blocks", block_ids: [...] }]` on a non-empty array.

---

## Probe 4 — Block-ID preservation rate

**Question:** Replace a 10-paragraph page with the same 10 paragraphs except one has a one-character change. How many of the 10 IDs survive?

**Finding:** **10/10 IDs preserved.** The edited paragraph (#5, "content" → "contentX") kept its block ID with the new text in place. All other 9 IDs were untouched.

**Implication:** The wedge claim from `workflow-token-measure-2026-04-28.md` Workflow 1 holds. Deep-link anchors and inline-comment threads attached to matched blocks will survive `replace_content` post-PR3. This is the primary user-visible benefit of the migration; tool description per §6.3 / DP5=B accurately describes it.

---

## Probe 5 — GFM-alerts (`> [!NOTE]`)

**Question:** Does Notion produce a callout, a quote, or treat `> [!NOTE]` as text?

**Finding:** Every alert variant (`[!NOTE]`, `[!TIP]`, `[!WARNING]`) landed as **two `quote` blocks** — one containing `[!NOTE]` (or its variant) as literal text, one containing the body. No callout was produced.

**Implication:** The translator MUST convert `> [!NOTE]` (and `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`, `[!INFO]`, `[!SUCCESS]`, `[!ERROR]`) to Notion's `<callout icon=… color=…>…</callout>` XML form before submitting. This is design work the translator owns; the spec gives us the target form, the probe gives us the required transformation. Mapping table for the translator:

| Marker | icon | color |
|---|---|---|
| `[!NOTE]` | 💡 | `default` |
| `[!TIP]` | 💡 | `green_background` |
| `[!WARNING]` | ⚠️ | `yellow_background` |
| `[!IMPORTANT]` | ⚠️ | `red_background` |
| `[!INFO]` | ℹ️ | `blue_background` |
| `[!SUCCESS]` | ✅ | `green_background` |
| `[!ERROR]` | ❌ | `red_background` |

(Default colors mirror the existing `markdown-to-blocks.ts` callout mapping — keep them in sync.)

---

## What this means for the PR3 builder

1. **Exit A is the right call.** Probes 1, 2, 3, 4, 5 all support it. Probe 2 specifically rules out shipping atomic without a translator; Probe 4 confirms the wedge benefit; Probe 1 confirms feasibility; Probes 3 and 5 inform translator + warnings design.
2. **Bookmarks and embeds are the only spec gap.** Translator emits them as bare-URL paragraphs (Notion auto-links the URL) plus a `warnings: [{ code: "bookmark_not_atomic" }]` entry. Tracked as backlog: a follow-up `notion-bookmark-embed-input-syntax-watch` task watching for Notion to add input forms.
3. **`unknown_block_ids` should still be surfaced** even though the common case is empty — it'll matter for pages with synced_blocks.
4. **Default `allow_deleting_content: true`** matches today's destructive-replace semantics; no probe-driven reason to change it.

The disposable script lives at `scripts/bench/pr3-live-probes.ts`. It cleans up after itself by archiving each scratch page; if a probe ever errors mid-run, the orchestrator can re-run safely (each run uses fresh page IDs).

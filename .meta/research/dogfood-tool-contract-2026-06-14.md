# Dogfood: tool-contract friction & the §C write-receipt decision

**Date:** 2026-06-14
**Method:** 3 blind Sonnet (`claude-sonnet-4-6`) agents, run sequentially against an isolated
bench server (`easy-notion-bench`, port 3344, throwaway integration **bench-throwaway**),
each given the same realistic "build a launch hub then revise it" task with **no** mention of
receipts, IDs, or that anything was being studied. Evidence is the server-side / transcript
tool-call trace (primary); a post-hoc interview is secondary corroboration.
**Smoke gate:** PASS — `get_me` returned `bench-throwaway`, `read_page` returned page title "Token Tests".

---

## Headline finding

All three agents created the page with a single `create_page`, then had to **read the page back
before they could finish editing it** — because the create receipt returned only `{id, title, url}`
and every mutation receipt was a bare count. The cleanest case (Run 3) issued two `search_in_page`
calls purely to recover block IDs it had no other way to obtain, then edited by `update_block`.
A **count-only receipt is demonstrably insufficient**; a compact **top-level block map** would have
removed the round-trips that actually occurred. But the single highest-impact fix the runs surfaced
is **not** the create receipt at all — it is `update_section`'s heading-to-end-of-page blast radius
plus its count-only receipt, which forced a recovery read-back in **3/3** runs.

---

## §C — write-receipt shape: decision-support table

| Shape | Pros | Cons | Who benefits & why | Cost to produce | Demand evidence from the runs |
|---|---|---|---|---|---|
| **Count only** | Smallest payload; trivial to compute | Gives zero addressing. We have in-corpus proof that count receipts cause read-backs: the `update_section` count `{deleted:6,appended:5}` hid the destruction of the callout+toggle in **3/3** runs, forcing a verify-read every time. | Only fire-and-forget creators who never edit | Trivial | **Against it.** Run 3 had to do 2× `search_in_page` + `read_page` to get IDs a count would not provide. 3/3 update_section counts triggered a verify-read. |
| **Top-level block IDs** (recommended) | Directly serves the observed targeted-edit path; light (~a dozen entries); never harmful | Doesn't address nested children (toggle's open-question items); wasted for agents that edit by heading (Runs 1 & 2) | Agents doing a targeted block edit right after create (Run 3 pattern) — eliminates the read+search needed to recover block identity | Low — create already builds these blocks; return their `id` + `type` (+ optional text preview) in creation order | **Strong.** Run 3's two `search_in_page` calls were *entirely* to recover top-level block IDs; a top-level map removes both. Interview converged on this unprompted: "even a shallow map of top-level blocks would have let me skip both search calls." |
| **Full tree** | Complete addressing incl. nested children; no follow-up read ever needed | Payload scales with page size; duplicates what `read_page` already gives on demand; bloats every create for a rarely-used need | Agents that immediately deep-edit nested content | Higher — full serialization on every create | **None.** No run edited a nested block; the deepest targeted edit (`update_block`) was on a **top-level** paragraph. The toggle's children were never addressed. |

### Recommendation

**Return a compact, ordered list of top-level blocks: `{block_id, type, text_preview}`.** This is the
honest cost/benefit winner: it removes Run 3's two-search detour at near-zero cost, and a count is
positively harmful (the `update_section` evidence shows count receipts manufacture read-backs).

Be honest about the limit: **2 of 3 runs would not have used it** — Runs 1 and 2 edited the
Milestones section by *heading* (`update_section`), never touching a block ID. So a block-ID create
receipt is not a universal win; it serves the targeted-edit minority path cleanly and is harmless to
the rest. Full tree is over-provisioned for the demand actually observed; reserve it for an opt-in
`return=tree` parameter if a nested-edit need ever shows up.

**If you make only one change, it should not be the create receipt** — it should be the
`update_section` blast radius / count receipt below, which bit 3/3.

---

## Behavioral traces (primary evidence)

Tool sequences extracted from the agents' own recorded transcripts (`tool_use` blocks, in order).
`create_page` receipt was `{id, title, url}` — no block IDs — in **all three** runs.

### Run 1 — edits by heading; blast-radius recovery via append (9 turns)
```
1 read_page(parent)            2 create_page  -> {id,title,url}
3 update_section(heading="Milestones")  -> {deleted:6, appended:5}   # swallowed callout+toggle
4 read_page(self)              # <-- read-back to discover the damage
5 append_content(self)         -> {blocks_added:2}                    # re-add callout+toggle
```
Create -> edit round-trips: **1 read-back**, caused by the count receipt hiding the blast radius.
The agent never used a block ID.

### Run 2 — identical pattern; recovery via replace_content (10 turns)
```
1 read_page(parent)   2 create_page -> {id,title,url}
3 update_section(heading="Milestones") -> {deleted:6, appended:5}     # swallowed callout+toggle
4 read_page(self)                       # <-- read-back to discover the damage
5 replace_content(self) -> {success:true}                            # rebuild body
```
Create -> edit round-trips: **1 read-back**. No block ID used. Agent's own words: "`update_section`
on the H2 Milestones heading extended to end-of-page... swallowed the callout and toggle. I caught
it on the read and recovered everything via `replace_content`."

### Run 3 — the clean "receipt lacked addresses" trace (14 turns)
```
1 create_page -> {id,title,url}
2 read_page(self)                          # <-- read-back #1, to see structure
3 search_in_page(self, "M2 — Feature freeze")   # <-- content->ID lookup to find the milestone
4 update_section(heading="Milestones") -> {deleted:6, appended:5}     # swallowed callout+toggle
5 read_page(parent)
6 search_in_page(self, "This launch hub tracks")  # <-- content->ID lookup to find the intro block
7 update_block(block_id=380be876-242f-81d3-...) -> {type:paragraph, updated:true}  # edit BY ID
8 read_page(self)                          # <-- read-back #2, verify
9 append_content(self) -> {blocks_added:2}                           # re-add callout+toggle
10 read_page(self)                         # <-- read-back #3, final verify
```
Create -> edit round-trips: **3 read-backs + 2 content-addressed searches.** This is the direct
observed proof: the bare create receipt forced `read_page` + `search_in_page` to recover the block
ID the agent then passed to `update_block`. A top-level block map on the create receipt removes
steps 2, 3, and 6.

**Pattern across 3/3:** `create_page` (no IDs) → section edit → **read-back** → recover. The
read-back is universal; only Run 3 also needed block-ID addressing, and it had to mine the ID by hand.

---

## Other tool-contract friction (feeds `tool-contract-clarity-pass`)

1. **`update_section` blast radius (highest impact — 3/3).** When the target heading is the *last*
   heading on the page, `update_section` deletes everything from that heading to end-of-page,
   including unrelated trailing blocks (here: the warning callout and the toggle). All three agents
   hit this and only discovered it by reading the page back. Two fixes, ideally both: (a) bound a
   section at the next heading of equal-or-higher level, or at minimum document the EOF behavior
   loudly in the tool description; (b) make the receipt *name what it deleted* (types/previews) so
   the blast radius is visible without a read. Caveat: severity is amplified by this task's layout
   (Milestones was the last heading); a page with a heading after it would not show the full blast.

2. **All mutation receipts are count-only / boolean.** `{deleted,appended}`, `{success:true}`,
   `{blocks_added:2}`. These carry no identity, so agents verify-read after mutating. A receipt that
   lists affected block ids+types would let agents trust a mutation without the round-trip. This is
   the same root issue as §C, generalized to every write tool — arguably the broader lesson.

3. **`search_in_page` is being used as an identity bridge.** Run 3 used it to translate "the text I
   just wrote" → "the block ID I need." Interviewee named it precisely: "a content-addressed lookup
   as a workaround for what is really an identity problem — you made the blocks, you should get their
   IDs back." Returning IDs on write removes this misuse.

4. **No prepend / insert-at-top.** The task asked for a line "near the top." `append_content` only
   appends to the end, so Run 1 baked it into the create markdown and Run 3 rewrote the existing
   intro block. A prepend or insert-at-index would have been the natural tool. Minor — all agents
   worked around it.

5. **Markdown-dialect onboarding cost.** 3/3 runs spent calls (`ToolSearch` + `ReadMcpResourceTool`)
   discovering the supported markdown extensions (toggle `+++`, callout `> [!WARNING]`) before
   writing. Embedding the supported-syntax summary directly in the `create_page` tool description
   would let agents skip the resource read.

---

## §E signal — @-mention degradation

**The requested @-mention of the parent page degraded to a plain markdown hyperlink in 3/3 runs.**
There is no markdown syntax in the contract to express a Notion inline page-mention, so it silently
becomes a navigable link (not a mention chip). It was not *fully* silent to the agents — all three
noticed and flagged it in their reports — but the capability is simply un-expressible.

Resulting blocks (verbatim from the pages):
- **Run 3:** `↑ [Token Tests]([sandbox page URL redacted])`
- **Run 2:** `Part of [Token Tests](...)`
- **Run 1:** `Parent page: [Token Tests](...)`

Run 1's agent stated it plainly: "the markdown docs don't expose a first-class `@mention` syntax for
page references — the parent link is rendered as a standard hyperlink... won't show as a Notion
inline mention chip."

---

## Post-hoc interview (secondary corroboration — not the verdict)

Run 3, asked plainly what `create_page` gave back and what it had to do to locate a block:

> "`create_page` returned exactly three things: the new page ID, the title, and the URL. No block
> IDs... So to edit anything specific, I had to go fishing. Two separate `search_in_page` calls...
> just to get block IDs I could then pass to `update_block`. Those were pure overhead; I had written
> that content seconds earlier... The most direct fix would be if `create_page` returned a block map
> alongside the page metadata — something like a list of `{block_id, type, text_preview}` in creation
> order. Even a shallow map of top-level blocks would have let me skip both search calls."

This matches the trace and lands on the **top-level block IDs** shape unprompted — I named no option
to the agent. Weighted as corroboration; the verdict rests on the behavior above.

---

## Honest caveats

- **n=3, Sonnet-only, single task shape, one throwaway integration.** Not a statistical result.
- **Shared-model bias.** All three are the same model family and converged on the same path
  (`update_section` for the section edit). A different model might chunk the edits differently and
  surface different friction.
- **The `update_section` blast radius is partly task-shaped.** Milestones being the *last* heading
  maximized the blast; a page with a trailing heading would not show it as starkly. The finding is
  real but its severity here is amplified by the layout.
- **Receipt demand is path-dependent.** Only the block-ID-editing path (Run 3, 1 of 3) clearly needed
  block IDs back. The heading-addressing path (Runs 1, 2) would not use them. Weight the §C
  recommendation as "cheap, removes a real detour for one common path, harmless to the others" — not
  "every agent was blocked without it."

---

## Sandbox pages built (left in place for eyeballing; archive after review)

- Run 1: [sandbox page URL redacted]
- Run 2: [sandbox page URL redacted]
- Run 3: [sandbox page URL redacted]

All created under **Token Tests** (`[sandbox parent ID redacted]`).

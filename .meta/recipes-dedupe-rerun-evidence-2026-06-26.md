# Recipe 1 deterministic re-run safety — live smoke evidence (2026-06-26)

Run by the builder PM against live Notion via this session's `easy-notion` stdio MCP
(bot: Iris, `320be876-242f-8131-8f63-0027e8b63e24`). Sandbox is disposable.

Supersedes the Recipe 1 boundary in `.meta/recipes-smoke-evidence-2026-06-25.md`
(which recorded Recipe 1 as single-run-safe / re-run-unsafe). Recipe 1 is now
re-run-safe / idempotent.

## The fix (doc-only, frozen-contract-safe)

Recipe 1 previously keyed dedupe on `Item Key` = an LLM-derived slug of the action
text. That is non-deterministic: a re-run that rewords an item yields a new slug
and a duplicate row.

The fix keys `Item Key` on the source line's stable Notion identity,
`<sourcePageId>:<sourceBlockId>`. The block ID is stable across reads and across
rewordings, so re-running over the same notes always produces the same key and the
existing-row dedupe query skips instead of inserting.

No public-contract change: no new tool, no new argument, no schema change. The
`Item Key` property stays `rich_text`; the dedupe filter shape is byte-identical;
only the key value and the agent's derivation procedure change. The block ID is
obtained through the existing `search_in_page` tool.

### Quirk discovered

`read_page` returns markdown with NO block IDs (they are dropped in
blocks-to-markdown conversion). The only existing read tool that surfaces per-line
stable block IDs is `search_in_page`, whose `matches[].block_id` is the stable
Notion block UUID. The recipe therefore instructs the agent to resolve each item's
source block ID via `search_in_page` on a verbatim substring of the source line.
For pasted (non-page) notes, the agent first saves them as a Notion page with
`create_page`, then resolves IDs via `search_in_page`.

## Live smoke — PROVEN idempotent

**Sandbox page:** `38bbe876-242f-8179-9c21-c9d66620eec8` (Recipes Cookbook Sandbox 2026-06-25)

**Meeting-notes source page:** `38bbe876-242f-81f1-97b7-df935d050a24`
(Q3 Planning Sync — Meeting Notes, dedupe smoke 2026-06-26), with 5 action-item
bullet lines.

**Action Items DB:** `05d2452c-202d-4483-a7f3-8772f1c4600d`
Schema unchanged: Name(title), Item Key(rich_text), Owner(rich_text), Due(date),
Status(status), Flags(multi_select), Source(rich_text).

`search_in_page` on each verbatim source line returned exactly 1 match with the
source block's stable ID (each confirmed equal to the block ID `create_page`
assigned the line). The 5 source blocks and resulting keys
(all prefixed with sourcePageId `38bbe876-242f-81f1-97b7-df935d050a24:`):

| Source line | sourceBlockId |
|---|---|
| Draft the v1.1 release notes by Friday — James | `38bbe876-242f-81c9-86c6-d9a792fc70b7` |
| Follow up with design team about onboarding flow — Priya | `38bbe876-242f-81d4-86ae-e18fbd7f8511` |
| Investigate latency spike in search endpoint — Marco | `38bbe876-242f-81bc-b9c8-c43ba21cf44b` |
| Update the pricing page | `38bbe876-242f-81aa-9480-e46685ff7632` |
| Schedule follow-up review next week | `38bbe876-242f-8197-b1fa-c4e5dc59f102` |

**Run 1** (DB empty -> all 5 dedupe queries return empty -> insert all 5):
`query_database` (no filter) afterward returned **5 rows**.

**Run 2** (same unchanged notes): for each of the 5 items the deterministic key was
re-derived and a `query_database` `Item Key` `rich_text equals` query was issued.
Every one of the 5 returned **exactly 1 existing row** -> all 5 skipped, zero
inserts. `query_database` (no filter) afterward returned **5 rows**.

**Before run 1: 0 rows. After run 1: 5 rows. After run 2: 5 rows. Zero duplicates.**

This is the determinism the old text-slug key could not provide: even if the agent
rewords an item's `Name` on the second pass, the dedupe key is the source block ID,
which is unchanged, so the row is matched and skipped.

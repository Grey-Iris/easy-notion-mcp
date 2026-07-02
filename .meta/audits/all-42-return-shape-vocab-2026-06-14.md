# Audit: all-42 tool return shapes → one coherent receipt vocabulary

**Date:** 2026-06-14
**Scope:** Return/receipt shape of every one of the 42 MCP tools in `src/server.ts`, in service of
freezing a single receipt vocabulary before identity-bearing receipts ship.
**Mode:** READ-ONLY. No `src/` edits, no server start, no commit.
**Constraints honored:** §H (42 tools frozen as-is), §J (no breaking changes to frozen surfaces
until 2.0), and red-team finding H2 (declaring `outputSchema` forces `structuredContent` on every
success path of that tool, atomic per tool, **not reversible**).

---

## Summary

The return layer is healthy in mechanism but **incoherent in vocabulary**. Every tool funnels through
one helper, `textResponse(result)` at `src/server.ts:190`, which JSON-stringifies an arbitrary object
into `content[].text`. **No tool declares `outputSchema` and nothing emits `structuredContent` today**
(verified: `grep -rn outputSchema\|structuredContent src/` → none). So today every receipt is free-form
and reshapeable. The moment we start declaring `outputSchema` we freeze whatever shape exists, per tool,
forever-until-2.0. The danger is concrete and already visible in the code: the same concept is spelled
three different ways across the 42 tools (identity is `id` vs `block_id` vs the *value* of a verb-named
key; `deleted` is a count in one tool and a page_id in another; `success` is present on most mutations
but absent on `create_page`/`update_block`/`move_page`). If we add receipts tool-by-tool we will freeze
that incoherence. This audit defines the vocabulary once so the build can declare schemas without
trapping us.

**The single highest-impact receipt fix is `update_section`, not `create_page`** — confirmed by code:
the dry-run path already computes `would_delete_block_ids` (`src/server.ts:2574`) but the **live** path
discards it and returns a bare `{deleted, appended}` count (`src/server.ts:2590-2593`). That count
hid a destructive blast radius in 3/3 dogfood runs.

---

## Findings — ordered by impact

### FIX NOW — 1. `update_section` live receipt discards identity its own dry-run already has
**What's wrong.** `update_section` live mutation returns only counts: `{deleted: <n>, appended: <n>}`
(`src/server.ts:2590-2593`; the in-place first-section path at `2555-2558` is the same shape). The
**dry-run** path immediately above it (`2561-2577`) already builds and returns
`would_delete_block_ids` (the actual IDs of every block it will delete), `target_block_id`, and
`target_block_type`. The identity exists at mutation time and is thrown away on the path that actually
mutates.

**Why it matters.** This is the §3 blast-radius problem in code. When the target heading is the last
heading on the page, the section extends to end-of-page and silently deletes unrelated trailing blocks
(the dogfood callout + toggle, 3/3 runs). A count receipt makes the destruction invisible, forcing a
verify-read every time (3/3 `read_page` round-trips in the research). The fix is nearly free because the
data is already computed for dry-run.

**What to do.** On the live path, name what was deleted and what was appended, using the shared
`block_map` element shape (below): add `deleted_blocks: Array<{block_id, type, text_preview}>` and
`appended_block_map: Array<{block_id, type, text_preview}>`. Keep the existing `deleted`/`appended`
**counts** for back-compat (§J: do not repurpose them into arrays — that is a breaking type change).
Also add `success: true` to match the other mutations. The boundary-semantics change (bound a section
at the next equal-or-higher heading instead of EOF) is a **separate decision**: it alters observable
behavior even though the I/O schema is unchanged, so it should not ride in on the receipt change. Ship
the visible-blast-radius receipt now; treat the boundary change as its own proposal and, at minimum,
document the EOF behavior loudly in the tool description.

### FIX NOW — 2. Lock the receipt vocabulary BEFORE the first `outputSchema` ships
**What's wrong.** The build is about to add (a) a top-level `block_map` to `create_page` and (b)
identity-bearing receipts to mutations. Whichever tool gets `outputSchema` first freezes its receipt
field names and element shapes irreversibly (H2). There is no canonical block-map element shape, no
canonical identity key, and no canonical ok-flag in the codebase today — so a piecemeal rollout will
freeze whichever ad-hoc shape each session happens to write.

**Why it matters.** Two tools freezing `{block_id, type, text_preview}` vs `{id, type, preview}` for the
same concept is unfixable until 2.0. See the "piecemeal inconsistency" list below — every item is a
real divergence the current code makes easy to commit.

**What to do.** Adopt the vocabulary table below as the contract. Sequence every rollout as:
**add the field to the JSON receipt (additive, reversible) → confirm in dogfood → THEN declare
`outputSchema` (irreversible).** Never bundle "new receipt field" + "first-ever `outputSchema`" on a
tool whose field shape is not yet finalized.

### FIX SOON — 3. Identity is spelled three incompatible ways across mutations
**What's wrong (all verified):**
- Primary-entity id under **`id`**: `create_page` (2370), `update_block` (live update 2917-area),
  `move_page` (3439), `share_page` (3100), `create_database` (3127), `add_database_entry` (3379),
  `update_database_entry`, `add_comment` (3430).
- Block id under **`block_id`**: `update_toggle` live (`src/server.ts:2778`), `search_in_page`
  matches (`2678` → match shape `{block_id, type, ...}`), `read_section`/`read_block`/`read_toggle`.
- Affected id as the **value of a verb-named key**: `archive_page` → `{success, archived: page_id}`
  (`3066`), `restore_page` → `{success, restored: page_id}` (`3445`), `archive_toggle` →
  `{success, archived: block_id, ...}` (`2809`), `delete_database_entry` → `{success, deleted: page_id}`
  (`3461`), and the dry-run twins `would_archive`/`would_delete`/`would_restore` carry an id too.

**Why it matters.** An agent cannot write one "read the id off the receipt" routine. `deleted` is the
worst collision: it is a **count** in `update_section` (`2591`) and `update_toggle` (`2780`) but a
**page_id** in `delete_database_entry` (`3461`). Once these are schema-frozen the collision is permanent.

**What to do.** These specific keys are already shipped and §J-frozen — do **not** rename them. Instead:
(a) freeze the legacy as-is and document it; (b) bind all **new** fields to the convention in the table:
block identity is always `block_id`, never a verb-valued key, never bare `id` for a sub-page block.
The new `block_map` already uses `block_id`, which matches `search_in_page` — extend that, not the
`archived: id` antipattern.

### FIX SOON — 4. `success` flag is present on most mutations but missing on the id-bearing ones
**What's wrong.** Count/boolean mutations carry `success: true` (`append_content` 2384,
`replace_content` 2398/2415, `archive_*`, `restore_*`, `delete_database_entry`). The id-bearing
creators do **not**: `create_page` returns `{id, title, url}` with no `success` (2370-2378),
`update_block` returns `{id, type, updated}` (no `success`), `move_page` returns `{id, url, parent_id}`,
`create_database`/`get_database` return `{id, title, url, properties}`.

**Why it matters.** Agents can't uniformly branch on a single ok-flag. If new receipts introduce `ok`
while legacy uses `success`, we freeze two flags meaning the same thing.

**What to do.** Standardize on the **existing** key `success: boolean` (do NOT invent `ok`). Adding
`success: true` to the success path of tools that lack it is additive and non-breaking under §J. Apply
it as each tool gains its receipt/schema.

### FIX SOON — 5. dry-run and live success paths return different key sets — the schema-union trap
**What's wrong.** For every tool with `dry_run`, the dry-run branch returns a much larger key set than
the live branch. Starkest: `update_section` dry-run returns 11-13 keys including `would_delete_block_ids`,
`target_block_id`, `append_after_block_id` (`2563-2577`), while live returns 2 (`2590`).
Same pattern in `replace_content` (2398 vs 2415), `find_replace` (2695 vs 2717), `update_toggle`
(2754 vs 2776), `archive_toggle` (2796 vs 2807), `delete_view`, `delete_database_entry`,
`archive_page`, `update_block`.

**Why it matters.** A single `outputSchema` per tool must validate **both** branches. If the schema is
written from only the live shape, dry-run responses fail validation (and vice-versa). This is the most
likely way the build accidentally ships an `outputSchema` that breaks one path.

**What to do.** Each tool's `outputSchema` must be the **union** of all its success branches, with every
branch-specific key marked optional (`dry_run?`, `would_*?`, `note?`, `warnings?`, `has_more?`, the
`include_metadata` keys on `read_page` at 2992, `truncated?`). Enumerate them from the catalog below;
do not author a schema from one branch.

### NOTE FOR LATER — 6. `list_views`/`get_view`/`query_view` pass through raw SDK objects
`list_views` (3256), `get_view` (3262), `query_view` (3272) return the raw `@notionhq/client` view
objects rather than a server-shaped projection (contrast `create_view`/`update_view`/`delete_view`,
which return a compact `{id, object, name?, type?, url?, data_source_id?}`). **Do not declare
`outputSchema` on these three** until the shape is server-controlled — you'd be freezing the SDK's
shape, which can drift on a Notion-Version bump and which you don't own. Low impact today (reads), but a
genuine trap for the schema rollout. If schemas are wanted here, project to a compact shape first
(additive), bake, then schema.

### NOTE FOR LATER — 7. `text_preview` semantics are undefined
There is no existing `text_preview`/preview field anywhere, so its truncation length, and whether it is
plain text or markdown, are unspecified. Define this once in the vocabulary (recommendation below)
before two tools freeze two different truncation rules.

---

## Catalog — current return shape of every tool (verified)

Mutation tools marked **[MUT]**. All shapes are the object passed to `textResponse` (`src/server.ts:190`).
Source: Codex trace session `audit-return-shapes`, independently spot-verified by the PM at the
cited lines for `update_section`, `archive_page`, `archive_toggle`, `update_toggle`, `move_page`,
`restore_page`, `delete_database_entry`, `add_database_entries`.

### Mutation tools (full detail)

| Tool | file:line | Live success shape | dry-run extra keys | Category |
|---|---|---|---|---|
| **[MUT]** create_page | 2370-2378 | `{id, title, url, note?}` (`note` only on workspace parent) | — | ID-BEARING |
| **[MUT]** create_page_from_file | 2378 (+validation 2350) | `{id, title, url, note?}` | — | ID-BEARING, ERROR-SHAPE |
| **[MUT]** append_content | 2384 | `{success, blocks_added}` | — | COUNT-ONLY, BOOLEAN-OK |
| **[MUT]** replace_content | 2415 (dry 2398) | `{success, truncated?, warnings?}` | `dry_run, operation, page_id, would_update` | BOOLEAN-OK, WARNINGS |
| **[MUT]** update_section | 2590 (in-place 2555; dry 2563) | `{deleted:count, appended:count}` | `success, dry_run, operation, page_id, heading, target_block_id, target_block_type, preserve_heading, would_delete_block_ids, append_parent_id, append_after_block_id` (+`would_update, would_update_block_id` first-section) | COUNT-ONLY, ID-BEARING (dry only), ERROR-SHAPE |
| **[MUT]** find_replace | 2717 (dry 2695) | `{success, match_count, truncated?, warnings?}` | `dry_run, operation, page_id, would_update, total_matches` | COUNT-ONLY, BOOLEAN-OK, WARNINGS |
| **[MUT]** update_toggle | 2776 (dry 2754) | `{success, block_id, type, deleted:count, appended:count}` | `dry_run, operation, page_id, title, would_delete_block_ids, append_parent_id` | COUNT-ONLY, ID-BEARING, ERROR-SHAPE |
| **[MUT]** archive_toggle | 2807 (dry 2795) | `{success, archived:block_id, title, type}` | `dry_run, operation, page_id, would_archive` | BOOLEAN-OK, ID-BEARING(verb-valued), ERROR-SHAPE |
| **[MUT]** restore_toggle | 2826 (dry 2818) | `{success, restored:block_id}` | `dry_run, operation, would_restore` | BOOLEAN-OK, ID-BEARING(verb-valued) |
| **[MUT]** update_block | 2917/2908 area (dry 2877/2886) | update: `{id, type, updated}`; archive: `{id, type, archived}` | `dry_run, operation, would_update` / `would_archive` | BOOLEAN-OK, ID-BEARING, ERROR-SHAPE |
| **[MUT]** duplicate_page | 3027 | `{id, title, url, source_page_id, note?, warnings?}` | — | ID-BEARING, WARNINGS |
| **[MUT]** update_page | 3048 (+validation) | `{id, title, url}` | — | ID-BEARING, ERROR-SHAPE |
| **[MUT]** archive_page | 3066 (dry 3057) | `{success, archived:page_id}` | `dry_run, operation, would_archive` | BOOLEAN-OK, ID-BEARING(verb-valued) |
| **[MUT]** create_database | 3127 | `{id, title, url, properties}` | — | ID-BEARING, FULL-OBJECT |
| **[MUT]** update_data_source | 3150 | `{id, title, url, properties, warnings?}` | — | ID-BEARING, FULL-OBJECT, WARNINGS |
| **[MUT]** create_view | 3320 | `{id, object, name?, type?, url?, data_source_id?}` | — | ID-BEARING, FULL-OBJECT |
| **[MUT]** update_view | 3346 | `{id, object, name?, type?, url?, data_source_id?}` | — | ID-BEARING, FULL-OBJECT |
| **[MUT]** delete_view | 3370 (dry 3358) | `{success, deleted:bool?, view:{id,object,...}}` | `dry_run, operation, would_delete` | BOOLEAN-OK, ID-BEARING, FULL-OBJECT |
| **[MUT]** add_database_entry | 3379 | `{id, url}` | — | ID-BEARING |
| **[MUT]** add_database_entries | 3404 | `{succeeded:[{id,url}], failed:[{index,error}]}` | — | ID-BEARING, ERROR-SHAPE (batch) |
| **[MUT]** update_database_entry | 3413 | `{id, url}` | — | ID-BEARING |
| **[MUT]** add_comment | 3430 | `{id, content}` | — | ID-BEARING, FULL-OBJECT |
| **[MUT]** move_page | 3439 | `{id, url, parent_id}` | — | ID-BEARING |
| **[MUT]** restore_page | 3445 | `{success, restored:page_id}` | — | BOOLEAN-OK, ID-BEARING(verb-valued) |
| **[MUT]** delete_database_entry | 3461 (dry 3450) | `{success, deleted:page_id}` | `dry_run, operation, would_delete, would_archive, note` | BOOLEAN-OK, ID-BEARING(verb-valued) |

### Read-only tools (compact)

| Tool | file:line | Shape | Category |
|---|---|---|---|
| read_section | 2615 | `{page_id, heading, block_id, type, markdown, warnings?}` / err `{error, available_headings}` | ID-BEARING, MARKDOWN, WARNINGS, ERROR |
| read_block | 2638 | `{id, type, markdown, warnings?}` / err `{error, id, type}` | ID-BEARING, MARKDOWN, WARNINGS, ERROR |
| read_toggle | 2659 | `{page_id, title, block_id, type, markdown, warnings?}` / err `{error, available_toggles}` | ID-BEARING, MARKDOWN, WARNINGS, ERROR |
| search_in_page | 2678 | `{page_id, query, scope, match_count, block_count, matches:[{block_id,type,text,snippets,match_count,toggle_context?}]}` | FULL-OBJECT, ID-BEARING, ERROR |
| read_page | 2992 | `{id, title, url, markdown, has_more?, warnings?, created_time?, last_edited_time?, created_by?, last_edited_by?}` (metadata keys only if `include_metadata`) | ID-BEARING, FULL-OBJECT, MARKDOWN, WARNINGS |
| search | 3075 | `Array<{id, type, title, url, parent, last_edited}>` | ID-BEARING, FULL-OBJECT |
| list_pages | 3094 | `Array<{id, title}>` | ID-BEARING, FULL-OBJECT |
| share_page | 3100 | `{id, url}` | ID-BEARING |
| get_database | 3162 | `{id, title, url, properties}` (rich per-prop schema) | ID-BEARING, FULL-OBJECT |
| list_databases | 3167 | `Array<{id, title, url}>` | ID-BEARING, FULL-OBJECT |
| query_database | 3229 | `{results:[{id, ...propNames}], warnings?}` | ID-BEARING, FULL-OBJECT, WARNINGS |
| list_views | 3256 | raw SDK `views.list` (pass-through) | FULL-OBJECT (unowned) |
| get_view | 3262 | raw SDK `views.retrieve` (pass-through) | FULL-OBJECT (unowned) |
| query_view | 3272 | `{query, results}` (raw SDK) | FULL-OBJECT (unowned) |
| list_comments | 3419 | `Array<{id, author, content, created_time}>` | ID-BEARING, FULL-OBJECT |
| list_users | 3466 | `Array<{id, name, type, email}>` | ID-BEARING, FULL-OBJECT |
| get_me | 3476 | `{id, name, type}` | ID-BEARING, FULL-OBJECT |

(42 total = 25 mutation + 17 read-only.)

---

## Recommended receipt vocabulary (the contract to freeze)

One vocabulary for all mutation receipts. Reuse existing key names wherever they exist; introduce new
keys only for genuinely new concepts; never propagate a legacy antipattern into a new field.

| Field | Type | Which tools carry it | Default when absent |
|---|---|---|---|
| `success` | `boolean` (always `true` on success path) | **all** mutations (add to `create_page`, `create_page_from_file`, `update_page`, `update_block`, `move_page`, `create_database`, `update_data_source`, `create_view`, `update_view`, `add_*`, `update_database_entry`, `add_comment`, `duplicate_page` — additive, non-breaking) | never omitted on success; absent today on id-bearing creators (legacy gap to close) |
| `id` | `string` (uuid) | primary-entity tools (page/db/view/comment/the block in `update_block`) — **FROZEN existing usage, do not rename** | n/a — already present |
| `block_id` | `string` (uuid) | block-scoped tools + the element key inside every `block_map`/`deleted_blocks` array | n/a |
| `block_map` | ordered `Array<{block_id, type, text_preview}>` | tools that CREATE/APPEND top-level blocks: `create_page`, `create_page_from_file`, `append_content`, `replace_content`, and the appended side of `update_section`/`update_toggle` | omit when no blocks created/appended (archive/restore/move) |
| `deleted_blocks` | `Array<{block_id, type, text_preview}>` | destructive section tools: `update_section`, `update_toggle` (the children it removed) | omit when nothing deleted |
| `text_preview` | `string` (plain text, first ~80 chars, no markdown markup) | element of `block_map`/`deleted_blocks` only | empty string for blocks with no text (e.g. divider) |
| `blocks_added` | `number` (count) | `append_content` **FROZEN**; equals `block_map.length` (kept for back-compat, now derivable) | keep; do not remove |
| `deleted` / `appended` | `number` (count) | `update_section`, `update_toggle` **FROZEN counts**; equal `deleted_blocks.length` / `block_map.length` | keep; do not repurpose to arrays |
| `warnings` | `Array<{code, ...detail}>` | the already-contracted set (`omitted_block_types`, `read_only_block_rendered`, `unmatched_blocks`, `bookmark_lost_on_atomic_replace`, `truncated_properties`); codes are contract | **omit when empty** (existing rule, CLAUDE.md) |
| `url` | `string` | page/entry/view-producing tools (existing) | n/a |
| `error` (+`available_*`/`id`/`type` context) | `string` | validation-fail branches (existing) | only on failure |

**How `create_page`'s block-map fits.** `create_page` gains `block_map: Array<{block_id, type,
text_preview}>` in top-level creation order, plus `success: true`, alongside the existing
`{id, title, url, note?}`. This is exactly the shape the dogfood research and the §C task converged on,
and the element shape `{block_id, type, ...}` already matches `search_in_page`'s match objects
(`src/server.ts:2678` region) — so it removes Run 3's two `search_in_page` detours without inventing a
new identity convention.

**How it stays consistent with `append_content.blocks_added`.** `append_content` keeps
`{success, blocks_added}` (frozen) and **adds** `block_map`. The count and the map coexist;
`blocks_added === block_map.length`. Same rule for `update_section`/`update_toggle`: the frozen
`deleted`/`appended` counts stay, and `deleted_blocks` / appended `block_map` are added beside them.
This is the consistency rule: **a count is never replaced, only supplemented by the map.**

**Tools that deviate and how (relative to this vocabulary):**
- `create_page`, `create_page_from_file`, `update_block`, `update_page`, `move_page`, `create_database`,
  `update_data_source`, `create_view`, `update_view`, `add_*`, `update_database_entry`, `add_comment`,
  `duplicate_page` — missing `success`. Add it.
- `update_section`, `update_toggle` — carry counts but no `block_map`/`deleted_blocks`. Add the maps.
- `archive_page`/`restore_page`/`archive_toggle`/`restore_toggle`/`delete_database_entry` — put the
  affected id under a **verb-named key** (`archived`/`restored`/`deleted`). Legacy, frozen; do NOT
  extend this pattern to any new tool. New single-target lifecycle tools (none planned) use
  `{success, id}`.
- `delete_database_entry` uses `deleted: page_id` while `update_section`/`update_toggle` use
  `deleted: count` — a frozen collision. Document it; never add a third meaning for `deleted`.
- `list_views`/`get_view`/`query_view` — raw SDK pass-through; outside the receipt vocabulary and not
  schema-eligible until projected.

---

## What would be inconsistent if we shipped receipts piecemeal

1. **block_map element-shape drift.** `create_page` freezes `{block_id, type, text_preview}`; a later
   session freezes `append_content` with `{id, type, preview}`. Same concept, two frozen shapes,
   unfixable until 2.0. (The code already mixes `id` and `block_id`, so this is the default outcome.)
2. **block_map field-name drift.** `block_map` vs `blocks` vs `created_blocks` vs `added` across tools.
3. **Identity-key drift made permanent.** New receipts using `id` for block identity while
   `update_toggle`/`search_in_page` use `block_id` — the existing split gets schema-frozen wider.
4. **ok-flag drift.** One new receipt adds `ok`, another keeps `success`, the id-bearing creators keep
   neither — three conventions frozen for "did it work."
5. **count-vs-map divergence.** `append_content` keeps its count and adds a map; `update_section` (done
   by a different session) drops the count and ships only a map — agents can rely on neither field
   being present across tools.
6. **`text_preview` semantics divergence.** Different truncation lengths / plain-vs-markdown per tool,
   each frozen by its own `outputSchema`.
7. **Freezing the wrong tool first.** Shipping the loud `create_page` block-map (demanded by 1/3 runs)
   with an `outputSchema` while leaving `update_section` (the 3/3 pain point) on a bare count — the
   research is explicit that if only one change ships it should be `update_section`. Piecemeal ordering
   tends to do the visible one first.
8. **dry-run/live schema mismatch.** A tool schema'd from its live branch rejects its own dry-run
   responses (Finding 5) — piecemeal authoring per-branch guarantees this on at least one tool.

---

## `outputSchema` / `structuredContent` implication and rollout order

**The irreversible mechanic (H2).** Declaring `outputSchema` on a tool forces `structuredContent` on
**every** success path of that tool, atomically, and it cannot be walked back without a breaking change
(so: not before 2.0, per §J). Today **zero** tools declare it, so today every receipt is freely
reshapeable. Each schema declaration spends that freedom permanently for one tool.

**Per-tool implication to honor:** the schema must be the **union of all success branches** of that tool
(live + dry-run + conditional keys: `note?`, `warnings?`, `has_more?`, `truncated?`, the
`include_metadata` keys on `read_page`, the `would_*` dry-run keys). Author it from the catalog above,
never from a single branch.

**Universal sequencing rule (applies to every tool):**
add field to JSON receipt (additive, reversible) → confirm shape in dogfood → **then** declare
`outputSchema` (irreversible). Never bundle "first-ever `outputSchema`" with "new receipt field whose
shape is not yet finalized."

**Recommended grouping — by receipt archetype, one archetype at a time:**

- **Group A — block-producing tools** (`create_page`, `create_page_from_file`, `append_content`,
  `replace_content`): add `success` + `block_map{block_id,type,text_preview}` (+ keep `blocks_added`),
  finalize the element shape here first because it is the most-reused shape. Schema only after the
  element shape is dogfood-confirmed. *This is where `text_preview` semantics get pinned for everyone.*
- **Group B — destructive section tools** (`update_section`, `update_toggle`): add `success` +
  `deleted_blocks` + appended `block_map` beside the frozen counts. **Do Group B with the schema in the
  same effort as the blast-radius fix** so the visible-blast-radius receipt is frozen correctly the
  first time. (This is the highest-impact group per the dogfood evidence.)
- **Group C — single-target lifecycle** (`archive_page`, `restore_page`, `archive_toggle`,
  `restore_toggle`, `delete_database_entry`, `move_page`, `update_block`, `update_page`,
  `duplicate_page`): mostly already shipped shapes; add `success` where missing, then schema the
  existing (verb-valued-id) shape as-is. Do **not** "fix" the verb-valued keys here — that would be the
  breaking change §J forbids; just freeze and document.
- **Group D — id-only entry/db/view writers** (`create_database`, `update_data_source`,
  `add_database_entry`, `add_database_entries`, `update_database_entry`, `add_comment`, `create_view`,
  `update_view`, `delete_view`): add `success`, then schema. Note `add_database_entries` batch shape
  `{succeeded, failed}` needs its own union schema.
- **DEFER — raw-SDK pass-throughs** (`list_views`, `get_view`, `query_view`) and all read tools: do not
  declare `outputSchema` until the shape is server-owned/projected. Reads are not in the receipt scope;
  schemaing a raw SDK shape freezes Notion's shape, which you don't control across version bumps.

**The trap to avoid:** declaring `outputSchema` on any tool whose receipt vocabulary is still unsettled.
Because it is irreversible, an unsettled tool must ship its receipt change first (additive), bake, then
get the schema. Finalize this vocabulary (Group A element shape especially) before the first schema lands.

---

## Testing assessment

Out of primary scope (this is a contract/return-shape audit, not a test audit), but two receipt-relevant
gaps the build should close as it ships:

- **No `outputSchema`/`structuredContent` round-trip tests exist** (there are none to test — zero tools
  declare it today). The moment Group A ships, there must be a test asserting that **both** the live and
  dry-run success paths of each schema'd tool emit `structuredContent` that validates against the
  declared `outputSchema`. Without it, the dry-run/live union mismatch (Finding 5) ships silently and is
  then frozen.
- **Receipt-shape assertions should be exact, not partial.** A test that only checks `blocks_added`
  exists would pass even if `block_map` regressed. Group A/B tests should assert the full receipt key set
  (including element shape `{block_id, type, text_preview}`) so a future session can't quietly drift it
  before the schema locks it.
- The dogfood research (`.meta/research/dogfood-tool-contract-2026-06-14.md`) is behavioral n=3 Sonnet,
  not an automated gate — treat it as evidence for the decision, not as regression coverage.

---

## Positive patterns (preserve these)

- **Single response funnel.** Every tool returns through `textResponse` (`src/server.ts:190`). This is
  exactly what makes a one-shot vocabulary migration tractable — there is one place where shapes are
  emitted, and the dispatch is one flat `switch`. Keep it.
- **`warnings` is already a well-designed, contract-stable channel.** Optional, omitted-when-empty,
  coded, documented in CLAUDE.md and the `easy-notion://docs/warnings` resource. The new receipt
  vocabulary should sit *beside* it unchanged — it is the model the rest of the vocabulary should imitate
  (additive, optional, coded, documented).
- **`dry_run` already computes the identity we need.** `update_section`'s dry-run (`2563-2577`) and the
  other dry-run branches already build `would_delete_block_ids` / `target_block_id`. The live-path fix is
  largely "return what dry-run already knows," not new computation. Reuse that code.
- **`search_in_page` match objects already use `{block_id, type, ...}`** (`2678` region) — the new
  `block_map` element shape matches an existing, shipped shape rather than inventing one. Align to it.
- **`create_view`/`update_view`/`delete_view` already project a compact server-owned view shape**
  (`{id, object, name?, type?, url?, data_source_id?}`) instead of leaking the SDK object. That is the
  model `list_views`/`get_view`/`query_view` should eventually follow before they get schemas.

---

## Session chain

- Audit PM session: `audit-return-shapes` (this audit; PM did landscape reads + independent spot-verification).
- Codex trace session: `audit-return-shapes` (Codex CLI agent, `mcp-cli run --agent codex`). Pass 1
  (trace) exhausted output budget on shell tracing without emitting synthesis — the detection signal in
  the audit-PM playbook (`outputTokens 8145`, no `response` text). Pass 2 (resumed, tool-calls
  forbidden, synthesis-only) produced the 42-tool catalog. PM independently re-verified the high-stakes
  shapes at `src/server.ts:2555-2593, 2776-2812, 3057-3066, 3437-3461, 3390-3404`.

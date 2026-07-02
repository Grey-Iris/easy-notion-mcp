# §A views-read-path probe: is Notion's view shape upstream-stable?

Date: 2026-06-14
Researcher: research agent (read + web only; no live writes performed)
Question: For roadmap §A, should `list_views` / `get_view` / `query_view` return a curated
`compactView`-style shape, or should we document raw passthrough of Notion's view objects as a
stable, intentional boundary? Deciding fact: does Notion give upstream-stability guarantees on
these view shapes, or are they part of the still-evolving data-source surface we do not control?

---

## Verdict on the deciding fact: EVOLVING (no durable cross-version shape guarantee)

The view shapes are **not labeled beta**, but they are **functionally on the active migration
frontier**, and Notion gives **no per-shape stability guarantee that survives an API-version bump**.
Concretely:

- **The full views surface is brand new.** The write/CRUD side of the views API (8 endpoints:
  create/retrieve/list/update/delete plus query) **launched in March 2026** under API version
  `2026-03-11`. Before that, views were read-only from the API. We are evaluating a surface that is
  roughly **three months old** as of this probe.
- **It is the newest layer of the in-flight data-source migration.** The 2025-09-03 redefinition
  (database = container, data source = the old "database") is what introduced `data_source_id` onto
  view objects in the first place. Views sit directly on top of the terminology/model change Notion
  is still rolling out.
- **Notion has shipped near-monthly breaking changes through 2026**: `2026-02-01` (pagination
  default cut to 50), `2026-03-01` (webhook secret validation), `2026-03-11` (views write API),
  `2026-04-01` (rate-limit header + pagination cursor format). This is not the cadence of a frozen
  surface.
- **The most decision-relevant field is explicitly type-variable.** The view object's
  `configuration` field is documented as a **"discriminated union keyed on `type`"** that varies
  significantly per view type (table/board/calendar/timeline/gallery/form/chart/map/dashboard). Even
  within one API version, this is the field most likely to grow new members as Notion ships view
  capabilities.
- **Version pinning is the *only* stability mechanism, and we deliberately move it.** Notion's
  versioning policy holds a shape stable *for a pinned version* ("no process for halting support of
  old API versions"). But our pin is `NOTION_VERSION = "2026-03-11"` in `src/notion-version.ts`, the
  very version that just reshaped views, and our own history shows we bump it regularly (e.g. commit
  `1cd58c3 chore: bump Notion API version`). **Every version bump is precisely the moment upstream
  reshaping would leak into our contract** if reads are raw passthrough. So the stability guarantee
  that exists (per-version) does not protect a frozen 1.0 MCP contract that intends to track Notion
  versions over time.

**Single strongest piece of evidence:** the full views API landed only in **March 2026
(`2026-03-11`)** as the newest endpoint family of the still-rolling data-source migration, with
`configuration` documented as a per-type discriminated union. A three-month-old surface on an
actively-migrating model, with monthly breaking changes elsewhere in 2026, is not a shape you
document as a stable boundary.

What would have flipped this to "stable": an explicit GA/stability or "this shape will not change
within a version" guarantee, or a long track record. Neither exists. The docs simply omit a beta
label, which is weaker than a stability promise.

---

## §A recommendation: CURATE (return a `compactView`-style shape from reads)

Curate `list_views` / `get_view` / `query_view` outputs through the existing `compactView` helper
(or a small extension of it), rather than documenting raw passthrough.

Reasoning, following from the verdict:

1. **Insulation is the whole point.** A frozen 1.0 MCP contract should not re-export a three-month-old,
   actively-migrating upstream shape verbatim. Curating to a stable subset (`id`, `object`, `name`,
   `type`, `url`, `data_source_id`) means a future Notion view-object reshape is absorbed in one
   helper instead of breaking our published tool contract.
2. **The cost is near zero and the helper already exists.** `compactView` is already implemented and
   already used by the write path (`createView`, `updateView`, `deleteView`). Curating reads is a
   consistency fix, not new design work.
3. **It removes an existing inconsistency** (see delta below): today writes are curated and reads are
   raw, which is the worst of both worlds — callers see different shapes for the same entity depending
   on whether they created it or read it.
4. **The volatile `configuration` is opt-in, not contract.** If a caller needs the full
   filter/sorts/quick_filters/configuration payload, expose it behind an explicit `raw: true` /
   `include_config` flag rather than as the default shape. That keeps power-user access without
   pinning our default contract to the most volatile field.

Caveat on `query_view`: its *result rows* are ordinary page objects (the same shape `query_database`
returns), which are far more stable than view metadata. The curation argument is strongest for
`list_views` and `get_view` (view metadata). For `query_view`, the curation win is mostly in
**not exposing the transient internal query object** (`{ query, results }` where `query` is a
throwaway query handle we create-then-delete) rather than in reshaping the page rows.

Confidence in the recommendation is higher than confidence in the underlying "evolving" verdict,
because curate is also the correct **safe default under uncertainty**: if the shape turns out stable,
curation costs us almost nothing; if it turns out volatile, raw passthrough costs us a 1.0 contract
break. Asymmetric downside favors curate.

---

## What our reads return today (the delta James needs)

Source: `src/notion-client.ts` lines ~1402-1523, `src/server.ts` lines ~3231-3271.

| Tool | Function | Returns today |
|------|----------|---------------|
| `list_views` | `listViews` -> `client.views.list(params)` | **RAW** SDK response, uncurated |
| `get_view` | `getView` -> `client.views.retrieve(...)` | **RAW** SDK response, uncurated |
| `query_view` | `queryView` | **RAW** `{ query, results }` — includes the transient internal query handle |
| `create_view` | `createView` | **CURATED** via `compactView` |
| `update_view` | `updateView` | **CURATED** via `compactView` |
| `delete_view` | `deleteView` | **CURATED** `{ success, deleted, view: compactView(...) }` |

So the current state is **asymmetric**: the write path is already curated to `compactView`
(`id`, `object`, optional `name`/`type`/`url`/`data_source_id`), while all three read tools return
raw upstream objects. Adopting the §A "curate" recommendation means applying the existing helper to
the read path and deciding how to expose (or gate) the raw `filter`/`sorts`/`quick_filters`/
`configuration` payload — bringing reads into line with writes rather than introducing a new shape.

Corroborating live finding already on record (handoff `2026-05-08-views-api-core-handoff.md`,
learning `f4397e`): a live `list_views` probe on a new database returned a view ref with
`object`/`id` but **no `type`**, while `get_view` on the same id returned `type=table`. This matches
the docs: `list-views` returns the minimal `dataSourceViewReferenceResponse` (`object` + `id` only),
and `retrieve-a-view` returns the fuller object. Our raw `list_views` therefore already leaks Notion's
partial-vs-full shape distinction onto callers — another reason curation (a single predictable shape)
helps.

Existing decision context: tasuku `views-core-scope-raw-config-boundary` (2026-05-08) chose to ship
core views tools with **raw configuration pass-through** and defer a typed helper/DSL. That decision
was about the *write/config input* boundary, not about whether *read outputs* should be curated; §A
is the open question that decision explicitly left for later ("a typed helper DSL needs separate
characterization to avoid locking in an unproven API shape" — the same logic now applies to read
outputs).

---

## Confidence

- **Deciding fact (evolving):** Medium-high. Strong on recency and migration-frontier evidence; the
  one softening factor is that Notion does not *explicitly* label views beta, and its version-pinning
  policy does provide per-version stability. The "evolving" call rests on (a) three-month-old surface,
  (b) per-type discriminated-union `configuration`, (c) our practice of bumping the pinned version.
- **§A recommendation (curate):** High. It is both what the verdict implies and the correct safe
  default under residual uncertainty, and it merely extends an existing, already-used helper while
  fixing a live read/write asymmetry.

---

## Sources

- [Working with views - Notion Docs](https://developers.notion.com/guides/data-apis/working-with-views)
- [Retrieve a view - Notion Docs](https://developers.notion.com/reference/retrieve-a-view)
- [List views - Notion Docs](https://developers.notion.com/reference/list-views)
- [Upgrade guide 2025-09-03 - Notion Docs](https://developers.notion.com/docs/upgrade-guide-2025-09-03)
- [Upgrade FAQs 2025-09-03 (versioning policy) - Notion Docs](https://developers.notion.com/docs/upgrade-faqs-2025-09-03)
- [Notion API Updates 2026: Every Major Change So Far - Fazm Blog](https://fazm.ai/blog/notion-api-updates-2026)
- [Notion Updates 2026 April: Full Changelog - Fazm Blog](https://fazm.ai/blog/notion-updates-2026-april)
- Repo: `src/notion-version.ts`, `src/notion-client.ts` (~L1402-1523), `src/server.ts` (~L3231-3271),
  `.meta/handoffs/2026-05-08-views-api-core-handoff.md`, `.claude/rules/tasuku/decisions.md`
  (`views-core-scope-raw-config-boundary`)

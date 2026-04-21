# Reddit feasibility scan — 7 capability buckets

**Date:** 2026-04-21
**Latest `Notion-Version`:** `2026-03-11` ([changelog](https://developers.notion.com/page/changelog), accessed 2026-04-21)
**Our pinned version:** `2025-09-03` via `@notionhq/client` v5.13.x
**Staleness:** One version behind. `2026-03-11` introduced three breaking changes:
- `after` parameter → `position` object for append block children
- `archived` field → `in_trash` across all endpoints
- `transcription` block type → `meeting_notes`

Upgrading is required to access any feature shipped after 2025-09-03, including the Views API (March 19, 2026), heading_4 blocks, tab blocks, relative date filters, "me" filters, comment update/delete, and multi-value filter conditions.

---

## 1. Database automations — manage/CRUD

**Verdict: Not exposed**

The Notion API has no endpoints to list, create, update, or delete database automation rules. Automations (triggers like "page added" / "property edited" / recurring schedules, and actions like "edit property" / "send webhook" / "send Slack notification") are entirely configured through the Notion UI.

The changelog from August 2025 through April 2026 ([changelog](https://developers.notion.com/page/changelog), accessed 2026-04-21) contains no mention of automation CRUD endpoints. The [Database automations help page](https://www.notion.com/help/database-automations) (accessed 2026-04-21) is purely UI-focused with no API references.

**What MCP could expose today:** Nothing — there is no API surface.

**What would unlock if Notion ships automation CRUD:** List/create/update/delete automation tools, enabling agents to wire up "when property changes → send webhook" or "when page added → set property" flows programmatically.

---

## 2. Formula editor UI state beyond the expression string

**Verdict: Not exposed**

The formula property schema exposes exactly one field: `expression` (string). No parsed AST, editor errors, suggested completions, column type hints, or validation state is available via API. ([Property object reference — formula](https://developers.notion.com/reference/property-object#formula), accessed 2026-04-21.)

When reading formula *values* on a page, the API returns the computed result with a `type` discriminator (`boolean`, `date`, `number`, `string`) and the value itself. No expression metadata accompanies the value. ([Property value object — formula](https://developers.notion.com/reference/property-value-object#formula), accessed 2026-04-21.)

**What MCP could expose today:** The expression string (already implicitly available via `get_database` schema) and computed values per row (already available via `query_database`). No additional formula metadata exists to surface.

**What would unlock if Notion ships richer formula objects:** Formula validation/linting tools, expression builder assistants, type-aware formula editing.

---

## 3. View filter state beyond what the current API returns

**Verdict: Supported (as of 2026-03-11+)**

The Views API (launched [March 19, 2026](https://developers.notion.com/page/changelog)) returns a `filter` field on view objects supporting:
- Property filters by type (text, number, select, date, etc.)
- Compound filters with AND/OR logic, up to 2 levels of nesting
- `"me"` filter for person properties (launched [March 30, 2026](https://developers.notion.com/page/changelog))
- Relative date filter values: `"today"`, `"tomorrow"`, `"yesterday"`, `"one_week_ago"`, `"one_week_from_now"`, `"one_month_ago"`, `"one_month_from_now"` (launched [March 30, 2026](https://developers.notion.com/page/changelog))
- Multi-value filter conditions for select/status/multi_select (launched [April 17, 2026](https://developers.notion.com/page/changelog))

The [Working with views guide](https://developers.notion.com/guides/data-apis/working-with-views) (accessed 2026-04-21) confirms filters are readable and writable.

**Gap:** The `additionalProperties: true` schema means the docs don't exhaustively enumerate every condition variant. User-scoped filter persistence (whether a "me" filter is per-user or global) is not documented.

**What MCP could expose today:** Nothing — we have zero view tools and are pinned to `2025-09-03` (pre-Views-API). After upgrading the SDK and adding view tools: full CRUD on view filters including relative dates and "me" filters.

---

## 4. Automation triggers / observation (webhooks)

**Verdict: Partial**

Two distinct webhook systems exist:

### Integration webhooks (observe)
Created in the Notion integration settings UI (no API for webhook management). Deliver HTTP POST to your endpoint with HMAC-SHA256 signatures. Events include:

| Event | Aggregated |
|---|---|
| `page.created`, `.content_updated`, `.properties_updated`, `.moved`, `.deleted`, `.undeleted` | Yes |
| `page.locked`, `.unlocked` | No |
| `data_source.created`, `.content_updated`, `.schema_updated`, `.moved`, `.deleted`, `.undeleted` | Yes |
| `comment.created`, `.updated`, `.deleted` | No |

Delivery within ~1 minute (aggregated) or seconds (non-aggregated). ([Event types & delivery](https://developers.notion.com/reference/webhooks-events-delivery), accessed 2026-04-21.)

**No automation-fired event exists.** You cannot observe when a Notion automation runs.

### Webhook actions (trigger outbound)
Database automations and page buttons can include a "Send webhook" action that fires an HTTP POST to an external URL. This is configured in the Notion UI, not via API. ([Webhook actions help](https://www.notion.com/help/webhook-actions), accessed 2026-04-21.)

**An integration cannot programmatically trigger a Notion automation.** The only way to cause an automation to fire is to perform the triggering action (e.g., create a page, change a property) which the automation is configured to watch.

**What MCP could expose today:** Nothing directly — webhook registration is UI-only. Indirectly, an MCP tool that creates a page or updates a property will trigger any automation watching that event, but this is a side effect, not a deliberate trigger.

**What would unlock if Notion ships webhook management API:** Programmatic webhook CRUD, letting agents subscribe to page/database change streams without manual UI setup.

---

## 5. Synced block relationships

**Verdict: Partial**

The `synced_block` block type ([Block reference — synced_block](https://developers.notion.com/reference/block#synced-block), accessed 2026-04-21) exposes:

- **Original (source) block:** `synced_from: null`, `children: [...]`
- **Duplicate (reference) block:** `synced_from: { type: "block_id", block_id: "<source-id>" }`

| Capability | Supported |
|---|---|
| Read whether a block is original vs. duplicate | Yes |
| Read the source block ID from a duplicate | Yes |
| Read the children of the original | Yes |
| Enumerate all duplicates referencing a given source | **No** — no reverse lookup |
| Create a new duplicate referencing an existing source | **Yes** — set `synced_from.block_id` |
| Detach a duplicate (convert to independent content) | **No** — "The API does not support updating synced block content" |
| Update content of the original (propagates to duplicates) | **No** — synced block content is not writable via API |

**What MCP could expose today:** Read source/duplicate relationships; create new duplicate references to existing sources. Cannot enumerate the full reference graph (source → all duplicates) or detach.

**What would unlock if Notion ships reverse lookup + detach:** Full synced-block management tools — "show me everywhere this block is synced" and "detach this copy."

---

## 6. Template gallery upload

**Verdict: Impossible via API**

Template gallery submission is entirely human-driven. The process: share a page publicly with "Allow duplicate as template" enabled, then submit via [notion.com/templates](https://www.notion.com/templates) "Submit a template" button. Notion's team reviews submissions manually. ([Template guide](https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates), [Gallery guidelines](https://www.notion.com/help/template-gallery-guidelines-and-terms), accessed 2026-04-21.)

No API endpoint, no programmatic submission flow, no mention of one in the changelog or developer docs.

**What MCP could expose today:** Nothing.

**What would unlock if Notion ships a submission API:** Automated template publishing pipelines. Unlikely — the manual review step is a deliberate quality gate.

---

## 7. View-config surface beyond current MCP tools

**Verdict: Supported (via Notion API) / Not implemented (in easy-notion-mcp)**

### Current MCP surface

easy-notion-mcp has **zero view tools**. The 26 tools in `server.ts` cover pages, databases, comments, and search. `update_data_source` is a database schema tool, not a view tool. No view create/read/update/delete/list capabilities exist.

### What Notion's Views API supports (March 19, 2026+)

Eight endpoints: create, retrieve, update, delete, list, duplicate, reorder, set-default. ([Changelog — March 19, 2026](https://developers.notion.com/page/changelog); [Working with views](https://developers.notion.com/guides/data-apis/working-with-views), accessed 2026-04-21.)

Per-view-type configuration coverage:

| Sub-capability | Table | Board | Calendar | Timeline | Gallery | List | Map | Form | Chart | Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|
| Layout type selection | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Property visibility | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Filters (read/write) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Sorts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Group by | ✅ | ✅ (req) | — | — | — | — | — | — | — | — |
| Sub-group by | — | ✅ | — | — | — | — | — | — | — | — |
| Cover image source | — | ✅ | — | — | ✅ | — | — | — | — | — |
| Cover size | — | ✅ | — | — | ✅ | — | — | — | — | — |
| Cover aspect ratio | — | ✅ | — | — | ✅ | — | — | — | — | — |
| Card layout | — | ✅ | — | — | ✅ | — | — | — | — | — |
| Calendar date property | — | — | ✅ (req) | — | — | — | — | — | — | — |
| Calendar view range | — | — | ✅ | — | — | — | — | — | — | — |
| Show weekends | — | — | ✅ | — | — | — | — | — | — | — |
| Timeline date properties | — | — | — | ✅ (req) | — | — | — | — | — | — |
| Timeline scale/preference | — | — | — | ✅ | — | — | — | — | — | — |
| Dependency arrows | — | — | — | ✅ | — | — | — | — | — | — |
| Color by | — | — | — | ✅ | — | — | — | — | — | — |
| Show table alongside | — | — | — | ✅ | — | — | — | — | — | — |
| Map location property | — | — | — | — | — | — | ✅ (req) | — | — | — |
| Map height | — | — | — | — | — | — | ✅ | — | — | — |
| Form open/closed | — | — | — | — | — | — | — | ✅ | — | — |
| Anonymous submissions | — | — | — | — | — | — | — | ✅ | — | — |
| Chart type | — | — | — | — | — | — | — | — | ✅ (req) | — |
| Chart axes/aggregation | — | — | — | — | — | — | — | — | ✅ | — |
| Chart styling (legend, labels, etc.) | — | — | — | — | — | — | — | — | ✅ | — |
| Dashboard rows/widgets | — | — | — | — | — | — | — | — | — | read-only |
| Table wrap cells | ✅ | — | — | — | — | — | — | — | — | — |
| Table frozen columns | ✅ | — | — | — | — | — | — | — | — | — |
| Subtasks display | ✅ | — | — | — | — | — | — | — | — | — |

Configuration updates use shallow merge — only included fields change; omitted fields are preserved.

**What MCP could expose today:** Everything in the table above, after upgrading `@notionhq/client` to ≥5.14+ (or whichever version adds view support) and implementing view tools. The API surface is comprehensive — nearly every UI-configurable view option has an API equivalent.

**Gap:** Dashboard layout is read-only for configuration; widget positioning uses separate widget-view creation calls rather than configuration updates.

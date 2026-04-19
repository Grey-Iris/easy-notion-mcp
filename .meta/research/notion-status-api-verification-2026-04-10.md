# Notion Status Property API — Verification Fact Sheet

**Date:** 2026-04-10
**Purpose:** Verify claims about Notion's status-property API support before planning a new `update_data_source` MCP tool.
**Method:** Fact-check against primary sources only (Notion changelog, Notion docs, GitHub issue). Researcher was instructed not to read any wishlist or plan documents.
**Session:** `verify-notion-status-api-2026-04-10`

---

## Q1 — Changelog verification

**Verdict:** Confirmed.

**Quote:** "You can now [create and update status properties](/reference/property-object#status) through the Notion API and [Notion MCP](/guides/mcp/mcp)."

**Source:** https://developers.notion.com/page/changelog (entry dated **March 19, 2026**)

**Conclusion:** Notion officially announced API support for creating and updating status properties on March 19, 2026.

---

## Q2 — Docs page status

**Verdict:** Contradicted (docs are stale).

**Quote (update-a-database):** "The following database properties cannot be updated via the API: `formula`, `select`, `status`"
**Source:** https://developers.notion.com/reference/update-a-database

**Quote (update-property-schema-object):** Page only documents `select` / `multi_select` option updates; contains no `status` section.
**Source:** https://developers.notion.com/reference/update-property-schema-object

**Conclusion:** Both legacy reference pages still say status cannot be updated via API — they disagree with the March 19, 2026 changelog entry and appear not yet updated. Callers should trust the changelog and the new data-source endpoints, not these pages. **Tool description should link the changelog, not the stale reference pages.**

---

## Q3 — Full-list vs partial update behavior

**Verdict:** Partially confirmed with caveat. The "omitted = removed" rule is explicit for `select`; for `status` it is implied by parallel wording on the new data-source reference but could not be double-verified with a single unambiguous verbatim sentence naming `status` specifically.

**Quote (select, update-property-schema-object):** "If an existing option is omitted, it will be removed from the database property. New options will be added to the database property."
**Source:** https://developers.notion.com/reference/update-property-schema-object

**Quote (data-source update, via update-data-source-properties reference):** "Settings for status properties. If an existing option is omitted, it will be removed from the data source property."
**Source:** https://developers.notion.com/reference/update-data-source-properties

**Caveat:** The status-specific quote was surfaced via WebFetch summarization and could not be independently re-verified by a second method. High confidence by pattern-parity with `select`, but **a live API probe before release is required** to confirm status behaves identically.

**Conclusion:** Callers must send the full desired options list. Omitting an existing option deletes it. **Runtime evidence required at build time.**

---

## Q4 — Status property groups

**Verdict:** Confirmed (groups are immutable via API).

**Quote:** "When creating a status property without specifying options, defaults (\"Not started\", \"In progress\", \"Done\") with groups (\"To-do\", \"In progress\", \"Complete\") are created. **To reconfigure groups after creation, use the Notion UI.**"

**Source:** https://developers.notion.com/reference/property-object (status section)

**Conclusion:** Only options within existing groups can be added/updated via API. Group structure itself cannot be reconfigured — UI only. New status options added via API are assigned to the default group.

---

## Q5 — Related open bug (notion-mcp-server#232)

**Verdict:** Confirmed — describes a Notion-API-side schema-staleness behavior that would also affect easy-notion-mcp; it is not isolated to makenotion's product.

**Title:** "Bug Report: Notion MCP — Status Property 'in_progress' Group Options Not Recognized via API"

**Quote (body):** "The MCP schema query returns the in_progress group as an empty array, despite options being assigned to it in the Notion UI ... The MCP schema is out of sync with the actual Notion database state. The API enforces validation based on the (incorrect) schema it receives, blocking all `in_progress`-group values."

**State:** open. API Version cited: `2025-09-03`.

**Source:** https://github.com/makenotion/notion-mcp-server/issues/232

**Conclusion:** The reporter attributes the bug to the Notion API returning a stale schema where options assigned to `in_progress` are missing from the group array, causing `validation_error` on writes. Any Notion-API wrapper (including easy-notion-mcp) would inherit this upstream behavior. **Worth a known-issues note in the tool description or README.**

---

## Q6 — Draft tool description

> Updates a data source's properties, title, description, or trash state. **When modifying `select` or `status` property options, you must send the FULL desired list of options — any existing option you omit will be permanently removed from the data source.** To add a new status option without losing existing ones, first read the current options (via retrieve data source), then send the full list back with your additions appended. **Status property GROUPS (To-do / In progress / Complete) cannot be reconfigured via the API; per Notion's docs, group structure changes must be done in the Notion UI.** New status options added via API are assigned to the default group and cannot be reassigned programmatically. This tool cannot update row data — use page/row update tools for that.

**Planner note:** This draft is a starting point, not final. The planner should refine based on the actual tool shape decided during planning. Key requirements:
- Must warn about full-options-list behavior
- Must warn about status groups being immutable
- Should link the March 19 changelog entry directly (not the stale reference pages)
- Should mention the known upstream bug (notion-mcp-server#232) if the tool description format allows

---

## Orchestrator flags

- **Stale docs risk:** Two reference pages still claim status is non-updatable. If a future user reads those instead of the changelog, they'll think the tool is broken. Link the changelog entry directly in the tool description.
- **Verbatim-quote caveat (Q3):** The "omitted = removed" rule for `status` specifically needs a runtime probe before release. Cheap insurance — the builder should execute an actual `dataSources.update()` call against a throwaway database and capture the result.
- **Upstream bug (Q5):** Issue #232 is an open Notion-side schema staleness bug affecting `in_progress` group options. easy-notion-mcp will inherit it. Consider a known-issues note.

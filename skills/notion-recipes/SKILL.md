---
name: notion-recipes
description: Use this skill when a user wants to turn meeting notes into a tracked Action Items database in Notion, or to bulk-edit, find-replace, normalize, or repair Notion database rows or page text at a scale past Notion's native find-and-replace limits. Uses easy-notion's MCP tools.
---

# Notion Recipes

Use these recipes with easy-notion's MCP tools, or through the claude.ai connector when the equivalent tools are enabled. Recipe 2 (repair and find-replace) also works through the `easy-notion` CLI skill in `skills/easy-notion-cli/`. Recipe 1 does not: it needs `create_database`, source-block lookup with `search_in_page`, and structured database filters, and the current CLI surface does not expose that full workflow.

## Recipe 1: Meeting Notes To Action Items

Turn a meeting-notes page or pasted notes into deduplicated rows in an Action Items database.

Safety boundary: Recipe 1 is re-run-safe and idempotent because `Item Key` stores the source line's stable Notion identity (`<pageId>:<blockId>`), not the action wording.

1. Create the Action Items database once with `create_database` under the user-selected parent page:

```json
{
  "parent_page_id": "<parent page ID>",
  "title": "Action Items",
  "schema": [
    { "name": "Name", "type": "title" },
    { "name": "Item Key", "type": "rich_text" },
    { "name": "Owner", "type": "rich_text" },
    { "name": "Due", "type": "date" },
    { "name": "Status", "type": "status" },
    { "name": "Flags", "type": "multi_select" },
    { "name": "Source", "type": "rich_text" }
  ]
}
```

2. Read or receive the meeting notes. Extract only discrete action items.
3. For each item, derive these properties:
   - `Name`: the action text.
   - `Owner`: the named assignee, or blank.
   - `Due`: the stated date as ISO `YYYY-MM-DD`, or blank.
   - `Item Key`: the source line's stable identity, formatted as `<sourcePageId>:<sourceBlockId>`.
   - `Source`: the meeting title plus date. Do not stash flags here.
   - `Status`: `Not started`.
   - `Flags`: add `needs-owner` if no owner, and `needs-due` if no due date. These are `multi_select` values, not text in `Source`.
4. Resolve `sourceBlockId` with `search_in_page`. `read_page` returns markdown without block IDs. For a Notion-page source, call `read_page` to extract items, then for each item call `search_in_page` with a verbatim, distinctive substring of that item's original source line. Use the `matches[].block_id` whose text is that source line. If several blocks match, use a longer verbatim substring to isolate one block. For pasted notes, first save them as a Notion page with `create_page`, then proceed through `search_in_page`; do not rely on block IDs from `create_page`, which returns only `{id,title,url}`. If one source line contains multiple distinct actions, append a stable ordinal suffix in source order, such as `:1` or `:2`, to keep keys unique.
5. Dedupe before insert. For each item, call `query_database` with this exact filter shape:

```json
{
  "filter": {
    "property": "Item Key",
    "rich_text": {
      "equals": "<that item's key>"
    }
  }
}
```

If `results` is empty, insert the item. Otherwise skip it. Do not dedupe with free-text `query_database text=...`; text search also scans `Source` and can produce false matches for every row from the same meeting.

6. Insert new rows with `add_database_entry`, or batch them with `add_database_entries`, using simple key-value properties such as:

```json
{
  "Name": "Draft the v1.1 release notes",
  "Item Key": "38bbe876-242f-81f1-97b7-df935d050a24:38bbe876-242f-81c9-86c6-d9a792fc70b7",
  "Owner": "James",
  "Due": "2026-06-26",
  "Status": "Not started",
  "Flags": [],
  "Source": "Q3 Planning Sync 2026-06-25"
}
```

7. Verify by querying the database. The live smoke test produced 5 rows, with missing owners and dates represented in `Flags`; running twice over the same notes left the count unchanged. An Item Key `rich_text equals` query on a `<pageId>:<blockId>` key returned exactly 1 matching row.

## Recipe 2: Bulk Edit, Find-Replace, And Repair

Use these procedures when Notion's built-in find-and-replace or bulk property edits hit native row caps. Iterate through the API results to continue past the native limit.

### 2A. Repair Inconsistent Database Property Values

1. Call `get_database` to see property names. For select or status properties created on the fly, `get_database` may return `options: []`; read live values from `query_database` instead.
2. Call `query_database` to fetch rows. For large databases, page through all results in a loop.
3. Build a normalization map, for example:

```json
{
  "Eng": "Engineering",
  "engineering": "Engineering"
}
```

4. For each row whose value needs fixing, call `update_database_entry` with the row page ID and a simple key-value map:

```json
{
  "Team": "Engineering"
}
```

5. Re-query to verify. The live smoke test normalized 4 rows with mixed `Eng` and `engineering` values to one consistent option, while unrelated rows stayed unchanged.

Caveat: select and status option matching is case-insensitive, and writes snap to the earliest-existing option's casing. If a lowercase variant already exists, writing a capitalized version reuses the existing lowercase option. To force a specific casing, rename the option in Notion's UI rather than writing the new casing.

### 2B. Find-Replace Text Across A Page Body

1. Call `find_replace` with `dry_run: true` and `replace_all: true` to preview `match_count` without mutating.
2. Call `find_replace` with `replace_all: true` to apply the replacement.
3. Call `read_page` to verify. The live smoke test replaced 4 occurrences across paragraphs and a heading body.

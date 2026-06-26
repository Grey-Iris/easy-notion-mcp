---
name: notion-recipes
description: Use this skill when a user wants to turn meeting notes into a tracked Action Items database in Notion, or to bulk-edit, find-replace, normalize, or repair Notion database rows or page text at a scale past Notion's native find-and-replace limits. Uses easy-notion's MCP tools.
---

# Notion Recipes

Use these recipes with easy-notion's MCP tools, or through the claude.ai connector when the equivalent tools are enabled. Recipe 2 (repair and find-replace) also works through the `easy-notion` CLI skill in `skills/easy-notion-cli/`. Recipe 1 does not: the CLI does not expose `create_database`, and its `database query` surface is free-text only, which this recipe's dedupe step explicitly avoids.

## Recipe 1: Meeting Notes To Action Items

Turn a meeting-notes page or pasted notes into deduplicated rows in an Action Items database.

Safety boundary: Recipe 1 is single-run-safe but re-run-unsafe today. The Item Key equals filter blocks re-inserting an item whose key matches exactly, but the key is derived by the agent from the action wording. Re-running over the same notes with reworded items produces new keys and therefore duplicate rows. Run it once per set of notes. Deterministic re-run safety is tracked for a future `block-id-dedupe-helper`, keying off the source block ID.

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
   - `Item Key`: a stable slug of the action text, lowercase and hyphenated, for example `draft-v1-1-release-notes`.
   - `Source`: the meeting title plus date. Do not stash flags here.
   - `Status`: `Not started`.
   - `Flags`: add `needs-owner` if no owner, and `needs-due` if no due date. These are `multi_select` values, not text in `Source`.
4. Dedupe before insert. For each item, call `query_database` with this exact filter shape:

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

5. Insert new rows with `add_database_entry`, or batch them with `add_database_entries`, using simple key-value properties such as:

```json
{
  "Name": "Draft the v1.1 release notes",
  "Item Key": "draft-v1-1-release-notes",
  "Owner": "James",
  "Due": "2026-06-26",
  "Status": "Not started",
  "Flags": [],
  "Source": "Q3 Planning Sync 2026-06-25"
}
```

6. Verify by querying the database. The live smoke test produced 5 rows, with missing owners and dates represented in `Flags`, and an Item Key `rich_text equals` query returned exactly 1 matching row.

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

# Token Efficiency: easy-notion-mcp vs Raw Notion API

## Page Read — 93% reduction (4,302 → 292 tokens)

**Raw Notion API response**

```json
{
  "page": {
    "object": "page",
    "id": "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a1001",
    "created_time": "2025-01-15T10:30:00.000Z",
    "last_edited_time": "2025-01-15T11:02:00.000Z",
    "created_by": { "object": "user", "id": "0f8fad5b-d9cb-469f-a165-70867728950e" },
    "last_edited_by": { "object": "user", "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
    "cover": {
      "type": "external",
      "external": {
        "url": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4"
      }
    },
    "icon": { "type": "emoji", "emoji": "📝" },
    "parent": { "type": "page_id", "page_id": "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a0001" },
    "archived": false,
    "in_trash": false,
    "properties": {
      "title": {
        "id": "title",
        "type": "title",
        "title": [{
          "type": "text",
          "text": { "content": "Meeting Notes", "link": null },
          "annotations": { "bold": false, "italic": false, "strikethrough": false, "underline": false, "code": false, "color": "default" },
          "plain_text": "Meeting Notes",
          "href": null
        }]
      }
    },
    "url": "https://www.notion.so/Meeting-Notes-b1f6c8d05c2e4f1b8e4e5d3f7c9a1001"
  },
  "block_children": {
    "object": "list",
    "results": [
      {
        "object": "block",
        "id": "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2001",
        "type": "heading_2",
        "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "Decisions & Action Items", "link": null }, "annotations": { ... } }], "color": "default", "is_toggleable": false }
      },
      ...
    ]
  },
  "child_block_children": {
    "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a2009": {
      "object": "list",
      "results": [
        { "object": "block", "type": "table_row", "table_row": { "cells": [[{ "type": "text", "text": { "content": "Owner", "link": null }, "annotations": { "bold": true, ... } }], ...] } },
        ...
      ]
    }
  }
}
```

**easy-notion-mcp response**

```json
{
  "id": "b1f6c8d0-5c2e-4f1b-8e4e-5d3f7c9a1001",
  "title": "Meeting Notes",
  "url": "https://www.notion.so/Meeting-Notes-b1f6c8d05c2e4f1b8e4e5d3f7c9a1001",
  "markdown": "## Decisions & Action Items\n\nWe aligned on shipping the benchmark script this week so we can quantify token savings against the raw Notion API output.\n\nAction items are captured below for the backend and DX follow-ups so we can share the benchmark results with a single command.\n\n- Confirm the fixture shapes match Notion block responses\n- Add token counting with js-tiktoken\n- Share the benchmark summary in the README once the numbers look stable\n\n> [!NOTE]\n> Use the same content in both fixtures so the comparison reflects format overhead rather than wording differences.\n\n```ts\nconst enc = encodingForModel(\"gpt-4\");\nconst tokens = enc.encode(JSON.stringify(payload)).length;\n```\n\n| Owner | Decision | Due |\n| --- | --- | --- |\n| Alice | Finalize fixture data | 2025-01-16 |\n| Ben | Review output formatting | 2025-01-17 |"
}
```

## Database Query — 87% reduction (2,534 → 319 tokens)

**Raw Notion API response**

```json
{
  "object": "list",
  "results": [
    {
      "object": "page",
      "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5001",
      "created_time": "2025-01-10T09:00:00.000Z",
      "last_edited_time": "2025-01-12T14:15:00.000Z",
      "created_by": { "object": "user", "id": "0f8fad5b-d9cb-469f-a165-70867728950e" },
      "last_edited_by": { "object": "user", "id": "550e8400-e29b-41d4-a716-446655440000" },
      "cover": null,
      "icon": { "type": "emoji", "emoji": "🚧" },
      "parent": { "type": "database_id", "database_id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d4000" },
      "archived": false,
      "in_trash": false,
      "properties": {
        "Title": { "id": "title", "type": "title", "title": [{ "type": "text", "text": { "content": "Ship benchmark script", "link": null }, "annotations": { ... }, "plain_text": "Ship benchmark script", "href": null }] },
        "Status": { "id": "P%3AKY", "type": "select", "select": { "id": "sel-status-1", "name": "In Progress", "color": "yellow" } },
        "Priority": { "id": "Yc%3AN", "type": "select", "select": { "id": "sel-priority-1", "name": "High", "color": "red" } },
        "Due Date": { "id": "QyRn", "type": "date", "date": { "start": "2025-01-15", "end": null, "time_zone": null } },
        "Assignee": { "id": "f%5D%7BV", "type": "rich_text", "rich_text": [{ "type": "text", "text": { "content": "Alice", "link": null }, "annotations": { ... }, "plain_text": "Alice", "href": null }] }
      },
      "url": "https://www.notion.so/Ship-benchmark-script-8f14e45fea6e4a7fb8f31a2b3c4d5001",
      "public_url": null
    },
    {
      "object": "page",
      "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5002",
      "properties": {
        "Title": { "type": "title", "title": [{ "text": { "content": "Review fixture accuracy", "link": null }, "annotations": { ... } }] },
        "Status": { "type": "select", "select": { "name": "Not Started", "color": "default" } },
        "Priority": { "type": "select", "select": { "name": "Medium", "color": "yellow" } },
        "Due Date": { "type": "date", "date": { "start": "2025-01-16", "end": null, "time_zone": null } },
        "Assignee": { "type": "rich_text", "rich_text": [{ "text": { "content": "Ben", "link": null }, "annotations": { ... } }] }
      },
      "url": "https://www.notion.so/Review-fixture-accuracy-8f14e45fea6e4a7fb8f31a2b3c4d5002"
    },
    ...
  ],
  "next_cursor": null,
  "has_more": false,
  "type": "page_or_database",
  "page_or_database": {}
}
```

**easy-notion-mcp response**

```json
[
  {
    "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5001",
    "Title": "Ship benchmark script",
    "Status": "In Progress",
    "Priority": "High",
    "Due Date": "2025-01-15",
    "Assignee": "Alice"
  },
  {
    "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5002",
    "Title": "Review fixture accuracy",
    "Status": "Not Started",
    "Priority": "Medium",
    "Due Date": "2025-01-16",
    "Assignee": "Ben"
  },
  {
    "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5003",
    "Title": "Document benchmark results",
    "Status": "Blocked",
    "Priority": "Low",
    "Due Date": "2025-01-18",
    "Assignee": "Cara"
  },
  {
    "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5004",
    "Title": "Backfill README examples",
    "Status": "Done",
    "Priority": "Medium",
    "Due Date": "2025-01-14",
    "Assignee": "Alice"
  },
  {
    "id": "8f14e45f-ea6e-4a7f-b8f3-1a2b3c4d5005",
    "Title": "Share benchmark in team update",
    "Status": "Done",
    "Priority": "High",
    "Due Date": "2025-01-20",
    "Assignee": "Ben"
  }
]
```

## Search — 76% reduction (1,582 → 374 tokens)

**Raw Notion API response**

```json
{
  "object": "list",
  "results": [
    {
      "object": "page",
      "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6001",
      "created_time": "2025-01-05T08:20:00.000Z",
      "last_edited_time": "2025-01-09T16:45:00.000Z",
      "created_by": { "object": "user", "id": "550e8400-e29b-41d4-a716-446655440000" },
      "last_edited_by": { "object": "user", "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
      "cover": null,
      "icon": { "type": "emoji", "emoji": "📓" },
      "parent": { "type": "page_id", "page_id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
      "archived": false,
      "in_trash": false,
      "properties": {
        "title": {
          "id": "title",
          "type": "title",
          "title": [{
            "type": "text",
            "text": { "content": "Engineering Weekly Notes", "link": null },
            "annotations": { "bold": false, "italic": false, "strikethrough": false, "underline": false, "code": false, "color": "default" },
            "plain_text": "Engineering Weekly Notes",
            "href": null
          }]
        }
      },
      "url": "https://www.notion.so/Engineering-Weekly-Notes-9d5ed678fe574cca8d101a2b3c4d6001",
      "public_url": null
    },
    {
      "object": "page",
      "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6002",
      "icon": { "type": "emoji", "emoji": "🗺️" },
      "parent": { "type": "page_id", "page_id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6000" },
      "properties": {
        "title": {
          "type": "title",
          "title": [{
            "type": "text",
            "text": { "content": "Benchmark Rollout Plan", "link": null },
            "annotations": { ... },
            "plain_text": "Benchmark Rollout Plan",
            "href": null
          }]
        }
      },
      "url": "https://www.notion.so/Benchmark-Rollout-Plan-9d5ed678fe574cca8d101a2b3c4d6002"
    },
    ...
  ],
  "next_cursor": null,
  "has_more": false,
  "type": "page_or_database",
  "page_or_database": {}
}
```

**easy-notion-mcp response**

```json
[
  {
    "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6001",
    "type": "page",
    "title": "Engineering Weekly Notes",
    "url": "https://www.notion.so/Engineering-Weekly-Notes-9d5ed678fe574cca8d101a2b3c4d6001"
  },
  {
    "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6002",
    "type": "page",
    "title": "Benchmark Rollout Plan",
    "url": "https://www.notion.so/Benchmark-Rollout-Plan-9d5ed678fe574cca8d101a2b3c4d6002"
  },
  {
    "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6003",
    "type": "page",
    "title": "SDK Migration Checklist",
    "url": "https://www.notion.so/SDK-Migration-Checklist-9d5ed678fe574cca8d101a2b3c4d6003"
  },
  {
    "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6004",
    "type": "page",
    "title": "API Payload Comparison",
    "url": "https://www.notion.so/API-Payload-Comparison-9d5ed678fe574cca8d101a2b3c4d6004"
  },
  {
    "id": "9d5ed678-fe57-4cca-8d10-1a2b3c4d6005",
    "type": "page",
    "title": "Search Result Audit",
    "url": "https://www.notion.so/Search-Result-Audit-9d5ed678fe574cca8d101a2b3c4d6005"
  }
]
```

---
*Token counts measured with tiktoken cl100k_base encoding on equivalent operations.*

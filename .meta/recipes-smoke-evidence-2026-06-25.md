# Cookbook recipes — live smoke-test evidence (2026-06-25)

Run by the builder PM against live Notion via this session's `easy-notion` stdio MCP
(bot: Iris, `320be876-242f-8131-8f63-0027e8b63e24`). Sandbox is disposable.

**Sandbox page:** `38bbe876-242f-8179-9c21-c9d66620eec8`
(Recipes Cookbook Sandbox 2026-06-25)

## Recipe #1 — meeting-notes → action-items  ✅ PROVEN

**DB:** `441639cd-0e7e-4169-a31e-e36c17f049f8` (Action Items, cookbook smoke test)
Schema: Name(title), Item Key(rich_text), Owner(rich_text), Due(date),
Status(status), **Flags(multi_select)**, Source(rich_text).

Both template fixes validated:

1. **Flags live in a dedicated multi_select**, not smuggled into Source.
   Resulting rows (query_database, no filter):
   - Draft the v1.1 release notes | Owner James | Due 2026-06-26 | Flags [] | Source "Q3 Planning Sync 2026-06-25"
   - Follow up with design team about onboarding flow | Owner Priya | Flags ["needs-due"]
   - Investigate latency spike in search endpoint | Owner Marco | Flags ["needs-due"]
   - Update the pricing page | Owner "" | Flags ["needs-owner","needs-due"]
   - Schedule follow-up review next week | Owner "" | Flags ["needs-owner","needs-due"]

2. **Dedupe uses `rich_text equals` on Item Key — precise.**
   `filter {"property":"Item Key","rich_text":{"equals":"draft-v1-1-release-notes"}}`
   → returns exactly 1 row.

   **False-match the fix avoids:** free-text `query_database text="Q3 Planning Sync"`
   → returns ALL 5 rows (it scans Source). Dedupe via free text would treat every
   new item as already-present. This is why the recipe specifies the equals filter.

**Boundary:** single-run-safe / re-run-unsafe. The equals filter blocks re-inserting
an item whose Item Key matches exactly, but the key is LLM-derived from the action
text — a re-run that rewords an item yields a new key and a duplicate row. Re-run
safety waits on the `block-id-dedupe-helper` (deterministic source-block keying).

## Recipe #2 — bulk-edit / find-replace / repair  ✅ PROVEN (two surfaces)

### 2A. Database property repair (beats Notion's native ~1000-row cap by iterating)

**DB:** `df9de701-f679-4975-85bf-366a27531475` (Tasks, cookbook bulk-repair smoke test)

Before (query_database): Team values were "Eng" (x3), "engineering" (x1),
"Design" (x1), "Support" (x1). Loop: for each row whose Team ∈ {Eng, engineering},
`update_database_entry(page_id, {"Team":"Engineering"})`. 4 rows updated.

After (query_database): "Fix login bug", "QA release", "Refactor parser",
"Write API docs" → all Team "engineering" (one consistent option); "Design dashboard"
and "Customer email" untouched. Goal (consistency) achieved.

**Caveat proven live:** Notion select/status option matching is **case-insensitive**,
and writes **snap to the earliest-existing option's casing**. Seeding "eng"/"ENG"
collapsed to the existing "Eng"; writing "Engineering" snapped to the existing
"engineering". To force a specific casing when a variant already exists, rename the
option in Notion's UI rather than writing the new casing. Also: `get_database`
returned `options: []` for dynamically-created select properties — read live values
from `query_database`, not from the schema's option list.

### 2B. Page-body find-replace (surgical text edits)

**Page:** `38bbe876-242f-8192-bdf9-ee5d7c5ed7d3` (Find-Replace smoke test)
- `find_replace dry_run:true replace_all:true` find "Acme" → `match_count: 4` (preview, no mutation)
- `find_replace replace_all:true` find "Acme" replace "Globex" → `match_count: 4`
- `read_page` after: all 4 "Acme" → "Globex" across paragraphs and heading body. Clean.
</content>
</invoke>

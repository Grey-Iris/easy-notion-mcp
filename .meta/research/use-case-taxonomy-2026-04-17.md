# Use-Case Taxonomy for easy-notion-mcp

**Date:** 2026-04-17
**Purpose:** Enumerate the full surface of plausible use cases — user personas, content shapes, tool operations, input edges, multi-step workflows, failure modes, integration shapes, and weird-but-real scenarios — so James can decide which the product must handle well.
**Method:** Static analysis of `src/server.ts`, `src/markdown-to-blocks.ts`, `src/blocks-to-markdown.ts`, `src/notion-client.ts`, `src/file-upload.ts`, `src/read-markdown-file.ts`, `src/auth/oauth-provider.ts`, `src/http.ts`, `src/types.ts`, `tests/roundtrip.test.ts`, and all 13 test files. No runtime testing performed.

---

## Lens 1: User Persona × Workflow

### 1.1 Software Engineer — Notes / PRDs / Runbooks

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Draft a PRD from an outline → publish to Notion | `create_page` | Supported | Likely works for typical PRD length (<50 blocks). Large PRDs with many tables/callouts untested at scale. | Every eng team with Notion. Daily. |
| Update a section of a living runbook by heading | `read_page` → `update_section` | Supported | Heading match is case-insensitive (`server.ts:1038`). Duplicate heading names → first match wins; no disambiguation. | Ops/SRE teams. Weekly. |
| Append standup notes to a daily page | `append_content` | Supported | Likely works. No dedup — appending twice duplicates content. | Daily standups. Very common. |
| Bulk-import markdown docs from a repo into Notion | `create_page_from_file` (stdio only) | Supported (stdio) | 1 MB file cap (`read-markdown-file.ts:4`). Agent would need to call per-file in a loop. No batch-file tool. HTTP mode has no equivalent. | Migration scenarios. Occasional. |
| Search across workspace for a specific error message | `search` | Partially supported | Notion search is eventually-consistent and title-biased; full-text body search is unreliable per Notion's own docs. | Debugging. Ad-hoc. |
| Move a page from personal to team space | `move_page` | Supported | Works for page-to-page moves. Cannot move to a database or workspace root. | Org restructuring. Occasional. |
| Archive old sprint pages | `archive_page` | Supported | Likely works. No bulk-archive tool — must call per-page. | Sprint cadence. Bi-weekly. |
| Track code review tasks in a Notion database | `create_database` → `add_database_entry` / `query_database` | Supported | Schema supports title, text, select, multi_select, status, number, date, checkbox, url, email, phone. Missing: relation, rollup, formula, people, files, created_time, last_edited_time property types for creation. | Eng teams using Notion for task tracking. Common. |

### 1.2 Product Manager — Specs / Meetings / Roadmaps

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Create a meeting notes template, duplicate per meeting | `create_page` → `duplicate_page` | Supported | `duplicate_page` reads all blocks and recreates them (`server.ts:1154-1175`). Doesn't copy database views, relations, or linked databases within the page. | PMs. Weekly. |
| Maintain a roadmap database with status tracking | `create_database` + `add_database_entry` + `update_database_entry` | Supported | Status property works. But `create_database` can't set initial status options/groups — those get Notion defaults. Groups can't be changed via API (`server.ts:679`). | PMs. Ongoing. |
| Query "all items due this week" from a project tracker | `query_database` with date filter | Supported | Date filters use Notion syntax: `{ "property": "Due", "date": { "on_or_after": "2026-04-14", "on_or_before": "2026-04-20" } }`. Agent needs to construct the right filter shape. | PMs. Daily. |
| Generate a weekly status report from database entries | `query_database` → agent synthesizes → `create_page` | Supported (multi-step) | Works if the agent can handle the query results and compose markdown. No built-in "generate report" tool — the agent does the synthesis. | PMs. Weekly. |
| Review and triage feedback in a database | `query_database` + `update_database_entry` | Supported | Agents can filter by status, update status. Can't assign to users via `people` property (not in `convertPropertyValues` — `notion-client.ts:191-248`). | PMs. Daily. |

### 1.3 Researcher / Academic — Literature Review / Lab Notes

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Build a bibliography database with 500+ entries | `create_database` + `add_database_entries` | Partially supported | Batch tool exists but processes sequentially (`server.ts:1339-1349`). 500 entries = 500 API calls. Rate limits kick in at ~3 req/sec for Notion. No built-in throttling — relies on Notion SDK's retry. | Researchers. Migration scenario. |
| Store paper notes with LaTeX equations | `create_page` with `$$..$$` syntax | Supported | Both inline `$$E=mc^2$$` and multi-line `$$\n...\n$$` work (`markdown-to-blocks.ts:405-419`). Round-trips to single-line form. | STEM researchers. Regular. |
| Cross-reference entries across databases | N/A | **Not supported** | No relation property support in `create_database` or `convertPropertyValues`. Can't create, read, or write relation/rollup properties. | Researchers with linked databases. Common need. |
| Attach PDFs to research entries | `create_page` with `[name](file:///path.pdf)` | Supported (stdio only) | 20 MB file cap (`notion-client.ts:16`). File uploads work for PDFs. HTTP mode can't upload files (no filesystem access). | Researchers. Regular. |

### 1.4 Writer / Blogger — Drafts / Publishing

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Draft a blog post with rich formatting | `create_page` | Supported | Headings, bold/italic/strikethrough, code blocks, images, callouts, toggles, tables, dividers all work. | Writers. Regular. |
| Edit a specific section of a long article | `update_section` | Supported | Section boundary logic (`server.ts:1052-1061`): H1 → extends to next heading of any level; H2/H3 → extends to same-or-higher level. Correctly scoped. | Writers. Regular. |
| Find-replace a term throughout an article | `find_replace` | Supported | Uses Notion's native `pages.updateMarkdown` API (`server.ts:1090-1101`). Preserves uploaded files. `replace_all` flag available. | Writers. Ad-hoc. |
| Add a cover image and icon to a published page | `update_page` with `icon` + `cover` | Supported | Cover accepts URL or `file://` path (uploads via `uploadFile`; `server.ts:1185-1188`). Icon is emoji only — no custom icon URLs. | Writers/bloggers. Per-post. |
| Publish from local markdown files | `create_page_from_file` | Supported (stdio) | 1 MB cap, `.md`/`.markdown` extensions only, UTF-8 required. No frontmatter parsing — title must be passed separately. | Static-site-to-Notion migration. Occasional. |

### 1.5 Marketer — Editorial Calendar / Campaign Tracking

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Maintain an editorial calendar database | `create_database` + CRUD tools | Supported | Date, select, multi_select, status properties cover typical editorial fields. | Marketing teams. Ongoing. |
| Bulk-add content ideas from a spreadsheet | `add_database_entries` | Supported | Sequential processing. Large batches (100+) will be slow and rate-limit-sensitive. | Quarterly planning. Occasional. |
| Update campaign status across multiple entries | `update_database_entry` (per entry) | Partially supported | No bulk-update tool. Agent must loop. | Campaign management. Regular. |
| Filter content by publish date and status | `query_database` with compound filter | Supported | `{ "and": [...] }` compound filters work. | Weekly review. Regular. |

### 1.6 Consultant — Client Wikis / Deliverables

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Create a client workspace with structured pages | `create_page` (nested) + `list_pages` | Supported | Creating nested page hierarchies works. `list_pages` returns direct children only. | Client onboarding. Per-engagement. |
| Share a page URL with a client | `share_page` | Supported | Returns the Notion URL (`server.ts:1233-1239`). Doesn't control sharing permissions — that's Notion UI only. | Per-deliverable. Regular. |
| Clone a template workspace for a new client | `duplicate_page` (per page) | Partially supported | No recursive duplicate — only duplicates one page's blocks, not its child pages. A multi-page template requires multiple `duplicate_page` calls. | Client onboarding. Occasional. |

### 1.7 Student

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Take lecture notes with math equations | `create_page` with `$$..$$` | Supported | Works for block equations. No inline equation support (Notion supports inline equations but our markdown convention doesn't). | Students. Daily during term. |
| Organize notes into a course hierarchy | `create_page` (nested) + `move_page` + `list_pages` | Supported | Page tree operations work. No "create page under page X's child Y" shortcut. | Students. Per-semester. |
| Create a flashcard database | `create_database` + `add_database_entries` | Supported | Simple key-value format works well for Q/A pairs. | Students. Per-course. |

### 1.8 Indie Hacker / Solo Founder

| Workflow | Tools Used | Coverage | Risk | Who / How Often |
|---|---|---|---|---|
| Log daily standups to a running page | `append_content` | Supported | Appends to end of page. No "insert at position" or "prepend" — newest entries go to bottom. | Solo founders. Daily. |
| Manage a personal CRM database | `create_database` + CRUD | Partially supported | No `people` or `relation` property support. Phone and email properties work. | Solo founders. Ongoing. |
| Track feature requests with priority and status | `create_database` + `query_database` + `update_database_entry` | Supported | Select/multi_select/status/checkbox/date all supported. | Solo founders. Ongoing. |

---

## Lens 2: Content Shape

### 2.1 Supported Block Types (25 in `types.ts`)

| Block Type | Markdown Syntax | Write Support | Read Support | Round-Trip | Notes |
|---|---|---|---|---|---|
| `heading_1` | `# Title` | Yes | Yes | Yes | |
| `heading_2` | `## Title` | Yes | Yes | Yes | |
| `heading_3` | `### Title` | Yes | Yes | Yes | |
| `paragraph` | Plain text | Yes | Yes | Yes | |
| `toggle` | `+++ Title\n...\n+++` | Yes | Yes | Yes | Supports nesting |
| `heading_1` (toggleable) | `+++ # Title\n...\n+++` | Yes | Yes | Yes | |
| `heading_2` (toggleable) | `+++ ## Title\n...\n+++` | Yes | Yes | Yes | |
| `heading_3` (toggleable) | `+++ ### Title\n...\n+++` | Yes | Yes | Yes | |
| `bulleted_list_item` | `- item` | Yes | Yes | Yes | Nested children supported |
| `numbered_list_item` | `1. item` | Yes | Yes | Yes | Nested children supported |
| `to_do` | `- [ ] / - [x]` | Yes | Yes | Yes | |
| `quote` | `> text` | Yes | Yes | Yes | |
| `callout` | `> [!NOTE]\n> text` | Yes | Yes | Yes | 7 types: NOTE, TIP, WARNING, IMPORTANT, INFO, SUCCESS, ERROR |
| `code` | `` ```lang `` | Yes | Yes | Yes | Language tag preserved |
| `table` | Pipe tables | Yes | Yes | Yes | |
| `table_row` | (internal) | Yes | Yes | Yes | |
| `divider` | `---` | Yes | Yes | Yes | |
| `equation` | `$$expr$$` | Yes | Yes | Yes | Multi-line normalizes to single-line on output |
| `column_list` / `column` | `::: columns` | Yes | Yes | Yes | |
| `table_of_contents` | `[toc]` | Yes | Yes | Yes | |
| `bookmark` | Bare URL | Yes | Yes | Yes | |
| `embed` | `[embed](url)` | Yes | Yes | Yes | |
| `image` | `![alt](url)` | Yes | Yes | Partial | Alt text lost on read (`blocks-to-markdown.ts:207`: always outputs `![]()`) |
| `file` | `[name](url)` | Yes | Yes | Partial | File URLs from Notion-hosted files are temporary (expire) |
| `audio` | `[audio](url)` | Yes | Yes | Partial | Same temporary URL issue as files |
| `video` | `[video](url)` | Yes | Yes | Partial | Same temporary URL issue as files |

### 2.2 Notion Block Types NOT Supported

| Block Type | Impact | Who Hits This |
|---|---|---|
| `child_database` | Can't create inline databases via markdown content. `create_database` tool exists but creates a standalone database, not embedded in page flow. | Users who embed databases inside pages. Common. |
| `child_page` | Can't create child pages inline in markdown. Must use `create_page` with `parent_page_id`. | Not a significant gap — `create_page` covers this. |
| `synced_block` | No read or write support. Synced blocks are Notion-specific cross-page references. | Teams using synced blocks for shared content. Moderate. |
| `template` | No support for Notion's template blocks (deprecated by Notion anyway). | Legacy users. Rare. |
| `link_to_page` | No markdown syntax to create a link-to-page block (different from a hyperlink to a page URL). | Users creating navigation structures. Occasional. |
| `link_preview` | No support. Similar to bookmark but with richer preview for supported services. | Rare. |
| `breadcrumb` | No support. Rarely used standalone. | Very rare. |
| `pdf` | No dedicated block type. PDFs uploaded via `[name](file:///path.pdf)` become `file` blocks. | Researchers, legal. Moderate. |
| `sub_header` / `sub_sub_header` | These are Notion's internal names for H2/H3 — they're already handled as `heading_2`/`heading_3`. Not a gap. | N/A |
| `table_of_contents` (custom styling) | Block is supported but style options (color) are not configurable. | Minor. |

### 2.3 Content Shapes That Combine Block Types

| Shape | Description | Coverage | Risk |
|---|---|---|---|
| Toggle with nested toggles | Toggle blocks containing more toggle blocks | Supported | `markdownToBlocks` is recursive (`markdown-to-blocks.ts:580-628`). Tested in `roundtrip.test.ts:131-148`. |
| Columns with mixed content | Columns containing lists, code, blockquotes | Supported | Column content is recursively parsed. Tested in `roundtrip.test.ts:150-163`. |
| Table inside a toggle | Pipe table within `+++` fences | Supported | Custom syntax splitter correctly identifies table inside toggle content. |
| Callout inside a blockquote | `> > [!NOTE]` | **Not supported** | Nested blockquotes aren't parsed — `blockquoteToBlock` only processes the first token (`markdown-to-blocks.ts:188-223`). Callout inside blockquote likely renders as plain quote. |
| Code block inside toggle | `` ```lang `` inside `+++` fences | Supported | Fence tracking in `splitCustomSyntax` prevents premature `+++` closure (`markdown-to-blocks.ts:313-327`). |
| Database as inline table | Page with an embedded database view | **Not supported** | `create_database` creates a standalone database. `is_inline` parameter exists but creates the database as a child of the parent page, not embedded in page content flow. |
| Wiki-style page tree | Nested pages forming a tree | Supported (manual) | Must create each page individually with `parent_page_id`. No "create tree" tool. `list_pages` only shows direct children. |

### 2.4 Property Types in Databases

| Property Type | Create DB | Write Entry | Read Entry | Notes |
|---|---|---|---|---|
| `title` | Yes | Yes | Yes | |
| `rich_text` | Yes (`text`) | Yes | Yes | |
| `number` | Yes | Yes | Yes | |
| `select` | Yes | Yes | Yes | Options auto-created on first use |
| `multi_select` | Yes | Yes | Yes | |
| `date` | Yes | Yes | Yes | Only `start` date exposed; `end` date and `time_zone` not surfaced |
| `checkbox` | Yes | Yes | Yes | |
| `url` | Yes | Yes | Yes | |
| `email` | Yes | Yes | Yes | |
| `phone_number` | Yes (`phone`) | Yes | Yes | |
| `status` | Yes | Yes | Yes | Groups not configurable via API |
| `relation` | **No** | **No** | **No** | `convertPropertyValues` has no case for `relation` (`notion-client.ts:191-248`). `simplifyProperty` has no case for `relation` (`server.ts:48-82`). |
| `rollup` | **No** | **No** | **No** | Computed property — can't write. Read returns `null` from `simplifyProperty`. |
| `formula` | **No** | **No** | **No** | Computed property — can't write. Read returns `null`. |
| `people` | **No** | **No** | Yes (read only) | `simplifyProperty` reads people (`server.ts:70`), but `convertPropertyValues` can't write them. |
| `files` | **No** | **No** | **No** | `simplifyProperty` returns `null` for files. |
| `created_time` | **No** | N/A (auto) | **No** | Auto-set by Notion. `simplifyProperty` returns `null`. |
| `last_edited_time` | **No** | N/A (auto) | **No** | Auto-set by Notion. `simplifyProperty` returns `null`. |
| `created_by` | **No** | N/A (auto) | **No** | `simplifyProperty` returns `null`. |
| `last_edited_by` | **No** | N/A (auto) | **No** | `simplifyProperty` returns `null`. |
| `unique_id` | **No** | N/A (auto) | Yes | `simplifyProperty` reads unique_id with prefix support (`server.ts:73-77`). |

---

## Lens 3: Operation × Tool

### 3.1 Page Tools (11)

#### `create_page` (`server.ts:427-459`, handler: `949-977`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Create with markdown | Converts markdown → blocks, creates page | Markdown with `file://` URLs triggers `processFileUploads` — parallel file uploads before block creation |
| Parent resolution | Explicit `parent_page_id` > `NOTION_ROOT_PAGE_ID` > sticky parent > workspace (OAuth) > error (stdio) | Sticky parent (`stickyParentPageId`, `server.ts:889`) persists across calls in same session — could be surprising if agent switches context |
| Icon/cover | Emoji icon, URL cover | Icon only accepts emoji strings — no custom icon images. Cover only accepts URLs, not `file://` (unlike `update_page`). Wait — actually `create_page` doesn't process `file://` covers, only `update_page` does (`server.ts:1185-1188`). Gap. |
| Content notice | Not added to create response | N/A |
| Block limit | Notion API allows max 100 children per append call | `appendBlocks` chunks at 100 (`notion-client.ts:318`). Pages with >100 top-level blocks handled correctly. |
| Error handling | `enhanceError` provides actionable messages for `object_not_found`, `rate_limited`, `restricted_resource`, `validation_error` | Good UX. Agent can self-correct. |

#### `create_page_from_file` (`server.ts:461-492`, handler: `978-1009`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Read local file → create page | Reads file, validates, creates page | Stdio-only (transport-gated). HTTP mode returns error message. |
| Path traversal protection | Symlink resolution + containment check against `workspaceRoot` (`read-markdown-file.ts:38-48`) | Strong. Resolves symlinks before checking. |
| File validation | Extension check (`.md`/`.markdown`), size check (≤1 MB), UTF-8 check (strict `TextDecoder` with `fatal: true`) | Good. Non-UTF-8 files rejected cleanly. |
| No file upload processing | Does NOT call `processFileUploads` — `file://` URLs in the markdown file content are not uploaded (`server.ts:998`). | **Gap**: if a local markdown file contains `![](file:///path/to/image.png)`, those references will fail silently or create broken image blocks. `create_page` does process them; `create_page_from_file` doesn't. |

#### `read_page` (`server.ts:546-562`, handler: `1106-1145`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Full page read | Recursive block fetch → markdown conversion | Deep pages with many nested blocks → many sequential API calls (one per parent with children). Could be slow for pages with hundreds of nested blocks. |
| `max_blocks` parameter | Returns top N blocks + `has_more` flag | `fetchBlocksWithLimit` counts top-level blocks only — children of those blocks are fetched recursively regardless of limit (`server.ts:363-370`). A page with 5 top-level blocks each containing 100 children would fetch all 505 blocks with `max_blocks: 5`. |
| `include_metadata` | Returns created/edited times and user IDs | Metadata is page-level only, not per-block. |
| Content notice | Prepends `CONTENT_NOTICE` unless `NOTION_TRUST_CONTENT=true` | Defense against prompt injection from page content. |
| Unsupported blocks | `normalizeBlock` returns `null` for unknown types (`server.ts:277`) | **Silent data loss on read**: any Notion block type not in the 25 supported types is silently dropped. No warning to the agent. Affected types: synced_block, link_to_page, breadcrumb, child_database, child_page (as inline reference). |
| Notion-hosted file URLs | Images/files hosted by Notion have temporary signed URLs | URLs expire after ~1 hour. Agent reading a page and using those URLs later may get 403s. No warning. |

#### `append_content` (`server.ts:495-504`, handler: `1010-1014`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Append markdown to end of page | Converts and appends | Appends after all existing blocks. No "insert at position" or "prepend" capability. |
| Duplicate content | No dedup — appending same content twice creates duplicate blocks | Agent error, but could be surprising in retry scenarios. |
| File uploads | `processFileUploads` is called — `file://` URLs in appended markdown work | Good. |

#### `replace_content` (`server.ts:506-517`, handler: `1015-1025`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Full page rewrite | Deletes all existing blocks, appends new ones | **Non-atomic**: delete-then-append is two phases. If the append fails (rate limit, network error), the page is left empty. No rollback. |
| Sequential block deletion | Deletes blocks one by one (`server.ts:1020`) | For a page with 200 blocks, that's 200 sequential DELETE calls before the append phase. Slow and rate-limit-sensitive. |
| File uploads | `processFileUploads` is called | Good. |

#### `update_section` (`server.ts:519-529`, handler: `1029-1081`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Replace section by heading | Finds heading, deletes to next section boundary, inserts new blocks | Section boundary for H1: next heading of any level. For H2/H3: next heading of same or higher level. |
| Case-insensitive heading match | `heading.trim().toLowerCase()` comparison (`server.ts:1038-1041`) | Good. |
| Heading not found | Returns available headings in error message | Good UX — agent can self-correct. |
| Duplicate headings | First match wins (`findIndex`). No way to target the second "Introduction" on a page. | Could be a problem for pages with repeated section names (e.g., multiple "Notes" sections in different contexts). |
| Ordering preservation | Uses `appendBlocksAfter` with `afterBlockId` from the block before the section (`server.ts:1065, 1071-1076`) | Correctly inserts at the right position. First-section edge case (no prior block) handled: `afterBlockId` is `undefined`, which appends at the start. |
| Non-atomic | Delete-then-insert. Same partial-failure risk as `replace_content`. | |

#### `find_replace` (`server.ts:531-543`, handler: `1082-1105`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Surgical text replacement | Uses Notion's native `pages.updateMarkdown` API | Different code path from all other tools — doesn't use our GFM pipeline. |
| `replace_all` flag | Replaces all occurrences when true, first only when false/omitted | Good. |
| File preservation | Doesn't touch blocks that aren't modified | Key advantage over `replace_content` for pages with uploaded files. |
| Cross-block matches | Unknown — depends on Notion's `updateMarkdown` behavior. If the find string spans two paragraphs, does it match? | **Needs investigation.** Likely doesn't match across block boundaries. |
| Rich text matches | Unknown — does `find` match against the plain text of rich text, or the formatted text? If a word is **bold**, does finding the plain word match? | **Needs investigation.** |

#### `duplicate_page` (`server.ts:565-578`, handler: `1146-1175`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Copy page content to new page | Reads all blocks, creates new page with same blocks | Doesn't copy child pages, databases, relations, comments, or page properties (other than title). Only copies block content. |
| Icon | Copies emoji icon if present | Good. |
| Cover | **Not copied** — `duplicate_page` doesn't pass `cover` to `createPage` (`server.ts:1163`). | Gap. |
| Deep content | Recursively fetches all nested blocks | Works for toggles, columns, nested lists. |

#### `update_page` (`server.ts:580-592`, handler: `1176-1197`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Update title | Sets page title | |
| Update icon | Sets emoji icon | Emoji only — no custom icon images supported by our wrapper (Notion API supports external URLs for icons). |
| Update cover | Accepts URL or `file://` path | `file://` cover triggers `uploadFile` and uses `file_upload` type (`server.ts:1185-1188`). Good. |
| No-op call | If no fields provided, Notion API called with empty payload | Probably harmless but wasteful. Not rejected client-side. |

#### `archive_page` / `restore_page` (`server.ts:594-604`, handlers: `1198-1212`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Trash / restore | Sets `in_trash` flag | Archive is reversible. "Delete" in the UI is permanent — we don't expose permanent delete. |
| Database entries | `delete_database_entry` is just `archivePage` by another name (`server.ts:1397-1401`) | Consistent, but confusing naming? Agent might think `delete_database_entry` is permanent. |

#### `move_page` (`server.ts:816-828`, handler: `1382-1388`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Move to new parent | Uses `client.pages.move` | Only accepts `page_id` as new parent. Can't move to database or workspace root. |
| Cross-workspace | Unknown — Notion may reject cross-workspace moves. No specific error handling. | **Needs investigation.** |

### 3.2 Navigation Tools (3)

#### `search` (`server.ts:606-619`, handler: `1205-1219`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Search pages/databases | Workspace-wide search | Notion's search API is eventually consistent — recently created pages may not appear immediately. |
| Filter by type | `pages` or `databases` | Database filter uses `data_source` as the value (`notion-client.ts:445`) — Notion API v2025-09-03 change. |
| Result format | Returns id, type, title, url, parent, last_edited | Simplified. No content preview. |
| Pagination | Fetches all results (loops until no more) (`notion-client.ts:448-455`) | For large workspaces, this could return hundreds of results and be slow. No page_size limit exposed to agent. |

#### `list_pages` (`server.ts:621-630`, handler: `1220-1231`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| List child pages | Returns pages under a parent | Filters `listChildren` for `child_page` type only (`server.ts:1225`). Misses inline databases, embeds, and other child objects. |
| Not recursive | Direct children only | Agent needs multiple calls for deep hierarchies. |

#### `share_page` (`server.ts:632-641`, handler: `1233-1239`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Get page URL | Returns page URL | Doesn't control sharing permissions. URL may not be accessible to the recipient without Notion workspace access. |

### 3.3 Database Tools (8)

#### `create_database` (`server.ts:643-666`, handler: `1241-1262`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Create with schema | Creates database under parent page with typed properties | Supported types: title, text, number, select, multi_select, date, checkbox, url, email, phone, status. |
| Missing types | Can't create: relation, rollup, formula, people, files, created_time, last_edited_time | Significant gap for complex databases. |
| `is_inline` | Creates inline database when true | Can't toggle inline status on existing databases. |
| Initial select/status options | Not supported in `create_database` schema | Options are auto-created when first entry uses them. Default status groups (To-do, In progress, Complete) are Notion's defaults. |

#### `update_data_source` (`server.ts:667-699`, handler: `1263-1285`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Rename property | `{ "Old Name": { "name": "New Name" } }` | Works. |
| Update select/status options | Full-list semantics — omitted options are permanently deleted | **Critical footgun** documented in tool description. Silent row reassignment for status properties (`server.ts:669-670`). |
| Delete property | `{ "Prop": null }` permanently deletes property and all data | Destructive. No confirmation. |
| Cache invalidation | `schemaCache.delete(databaseId)` after update (`notion-client.ts:500`) | Good — prevents stale cache reads after schema change. |
| Empty update | Rejected with error message (`notion-client.ts:486-489`) | Good validation. |

#### `get_database` (`server.ts:701-710`, handler: `1287-1292`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Fetch schema | Returns properties with names, types, and options | Select/multi_select/status options surfaced. Other property types return name + type only. |
| Relation properties | Returns name and type but no target database info | Agent can see a relation exists but can't use it. |
| Schema caching | 5-minute TTL (`notion-client.ts:44`) | Good for batch operations. Could serve stale data if another client modifies the schema. |

#### `list_databases` (`server.ts:712-719`, handler: `1293-1300`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| List all databases | Uses `searchNotion` with empty query, filter `databases` | Returns `parent.database_id ?? id` — uses `database_id` from parent if available, falls back to `id` (`server.ts:1297`). |
| Large workspaces | Fetches all results (no pagination limit exposed) | Could be slow for workspaces with many databases. |

#### `query_database` (`server.ts:721-748`, handler: `1302-1318`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Filter + sort | Passes Notion filter/sort syntax directly | Agent must know Notion filter syntax. Tool description gives examples. |
| Text search | `buildTextFilter` creates `or` filter across all text-type properties (`notion-client.ts:133-143`) | Good UX — simple keyword search works. |
| Combined text + filter | Text filter AND'ed with explicit filter (`server.ts:1313`) | Correct composition. |
| Result format | `simplifyEntry` returns id + simplified property values | Relations, rollups, formulas, files, timestamps return `null`. |
| Pagination | Fetches all matching results | For large result sets (1000+ rows), this could be very slow and return a massive response. No limit parameter exposed. |

#### `add_database_entry` / `add_database_entries` (`server.ts:749-777`, handlers: `1319-1352`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Simple key-value creation | `convertPropertyValues` maps to Notion format | Agent passes `{ "Status": "Done" }`, server converts to `{ status: { name: "Done" } }`. |
| Unknown properties | Silently ignored (`notion-client.ts:202-203`: `if (!propConfig) continue`) | **Silent data loss**: if agent misspells a property name, the value is silently dropped. No error, no warning. |
| Batch entries | Sequential processing with per-entry error handling | Partial failures don't block the batch. Failed entries reported separately. |
| Schema caching | Batch tool pre-warms cache (`server.ts:1334`) | Good — avoids N schema fetches for N entries. |

#### `update_database_entry` (`server.ts:779-793`, handler: `1353-1362`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Update specific properties | Only changed properties sent | Omitted properties left unchanged. |
| Parent detection | Retrieves page to find parent database ID (`notion-client.ts:573-579`) | Handles both old `database_id` and new `data_source_id` parent types. |
| Non-database page | Throws "Page is not part of a database" | Good error handling. |

#### `delete_database_entry` (`server.ts:843-851`, handler: `1397-1401`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Archive entry | Uses `archivePage` — identical to `archive_page` | Entry can be restored with `restore_page`. Not truly deleted. |
| Naming | Tool name says "delete" but behavior is "archive" | Potentially confusing. Tool description says "Delete (archive)". |

### 3.4 Comment Tools (2)

#### `list_comments` (`server.ts:795-804`, handler: `1364-1375`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| List page comments | Returns id, author name, content, timestamp | Plain text only — rich text formatting in comments stripped. |
| Discussion threads | Flat list — no threading/nesting structure | Notion supports threaded discussions but they're returned flat. |
| Pagination | Fetches all comments | Could be large for heavily-commented pages. |

#### `add_comment` (`server.ts:806-815`, handler: `1376-1381`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| Add comment | Supports markdown inline formatting via `blockTextToRichText` | Bold, italic, strikethrough, code, links work in comments. |
| Discussion context | Creates a new top-level comment — can't reply to existing threads | Notion API limitation for non-discussion-thread comments. |

### 3.5 User Tools (2)

#### `list_users` / `get_me` (`server.ts:853-866`, handlers: `1402-1415`)

| Operation | Happy Path | Edge Cases |
|---|---|---|
| List workspace users | Returns id, name, type, email | Email only available for `person` type users, not bots. |
| Rate limits | Single call, unlikely to hit limits | Low risk. |
| Permission | Requires `read user information` capability on the integration | If not granted, returns empty or errors. |

---

## Lens 4: Input Edges

### 4.1 Size Limits

| Dimension | Limit | Source | Risk |
|---|---|---|---|
| Rich text per block | 2000 characters per rich_text array entry (Notion API limit) | Notion API docs; not enforced client-side | **No client-side validation.** A paragraph with >2000 characters of continuous text will pass through `markdownToBlocks` and fail at the Notion API. Error message may not be helpful. |
| Blocks per page | No explicit limit in our code. Notion API allows up to ~10,000 blocks per page. | Notion docs | `appendBlocks` chunks at 100 (`notion-client.ts:318`). Large pages work but are slow — 100 blocks = 1 API call, 1000 blocks = 10 API calls. |
| Blocks per append call | 100 (Notion API limit) | Enforced by `appendBlocks` chunking | Correctly handled. |
| Page depth (nesting) | No limit in our code. Notion limits to ~5 levels of block nesting. | Notion API | `fetchBlocksRecursive` has no depth guard (`server.ts:315-339`). Infinite recursion theoretically possible if Notion returns circular `has_children` (unlikely but unvalidated). |
| File upload size | 20 MB (`notion-client.ts:16`) | Enforced in `uploadFile` | Good. Clear error message. |
| File-from-disk size | 1 MB (`read-markdown-file.ts:4`) | Enforced in `readMarkdownFile` | Good. Separate limit from file upload. |
| Table size | No explicit limit | Notion API | Tables with hundreds of rows → hundreds of `table_row` blocks. Each row is a block, each cell contains rich text arrays. Large tables will be slow and token-heavy. |
| Database query results | All results fetched (no limit) | `queryDatabase` loops until `has_more` is false | A database with 10,000 entries returns all 10,000. Response will be massive. **No pagination parameter exposed to agents.** |
| Search results | All results fetched (no limit) | `searchNotion` loops until `has_more` is false | Same issue. Large workspaces → huge responses. |
| Batch entry count | No limit on `entries` array size | `add_database_entries` processes all | 1000 entries = 1000 sequential API calls. Slow and rate-limit-sensitive. |

### 4.2 Character / Encoding Edges

| Input | Coverage | Risk |
|---|---|---|
| ASCII text | Supported | Works. |
| Unicode (CJK, Cyrillic, Arabic) | Supported | `marked` handles Unicode. `TextDecoder` with `fatal: true` validates UTF-8. Notion stores Unicode natively. |
| Emoji in page titles, content, icons | Supported | Icons must be emoji. Content emoji pass through as text. |
| RTL text (Arabic, Hebrew) | **Unknown** | `marked` likely handles RTL text, but Notion's rendering of RTL in blocks depends on the block type. No tests. |
| Zero-width characters (ZWJ, ZWNJ, ZWS) | **Unknown** | May affect `find_replace` matching. Could cause invisible differences between find string and page content. |
| Newlines in rich text | Handled via `br` token → `\n` in rich text content | `inlineTokensToRichText` handles `br` tokens (`markdown-to-blocks.ts:109-110`). |
| Pipe characters in table cells | **Problematic** | `marked` uses `|` as column delimiter. Escaped pipes `\|` behavior depends on `marked` version. Could break table parsing. |
| Backtick-heavy content | Handled | Code ranges tracked to prevent misinterpreting content inside code blocks (`file-upload.ts:6-57`). `splitCustomSyntax` tracks fences too. |
| Markdown in headings | Supported | `inlineTokensToRichText` processes heading tokens for bold/italic/links. |
| Very long lines (10k+ chars) | **Unknown** | `marked` lexer behavior on extremely long lines not tested. Notion's 2000-char rich text limit would be hit. |
| HTML in markdown | **Unknown** | `marked` parses HTML tags in markdown by default. Our code doesn't handle `html` token type — it falls through to `default` in `tokenToBlocks` which returns `[]`. HTML in markdown is silently dropped. |

### 4.3 Markdown Syntax Edges

| Input | Expected | Actual | Risk |
|---|---|---|---|
| Unclosed toggle (`+++ Title` with no closing `+++`) | Error or fallback | Falls back to markdown: unclosed toggle lines pushed to `markdownLines` (`markdown-to-blocks.ts:423-425`) | **Graceful degradation** — content rendered as paragraphs. No error signal. |
| Unclosed column block (`::: columns` with no closing `:::`) | Error or fallback | Falls back to markdown (`markdown-to-blocks.ts:428-430`) | Same graceful degradation. |
| Unclosed equation (`$$` with no closing `$$`) | Error or fallback | Falls back to markdown (`markdown-to-blocks.ts:432-434`) | Same graceful degradation. |
| Nested toggles | `+++ Outer\n+++ Inner\n...\n+++\n+++` | `splitCustomSyntax` doesn't support nesting — inner `+++` closes the outer toggle | **Bug**: nested toggle syntax in raw markdown doesn't work. But `markdownToBlocks` can produce nested toggles if the inner content is already a toggle block. Round-trip from Notion works because Notion nests toggles as children, not via syntax. |
| `[toc]` as a link | `[toc]` exactly matches the table-of-contents pattern | Any paragraph containing exactly the text `[toc]` becomes a table of contents block (`markdown-to-blocks.ts:514-519`) | **Potential false positive**: a literal link or reference to "toc" would be consumed. Edge case. |
| `---` in context | Divider vs YAML frontmatter separator | `marked` parses `---` as an `hr` token. Frontmatter `---` at the top of a file also becomes a divider. | Not typically a problem for Notion pages, but `create_page_from_file` with frontmatter-containing markdown files would create divider blocks instead. |
| `> [!CUSTOM]` callout | Unknown callout type | `calloutMatch` regex only matches NOTE, TIP, WARNING, IMPORTANT, INFO, SUCCESS, ERROR (`markdown-to-blocks.ts:190-192`). Other types render as plain blockquotes. | Graceful degradation. |
| Empty markdown | `markdownToBlocks` called with `""` | Returns `[]` early (`markdown-to-blocks.ts:573-575`) | Correct. |
| Markdown with only whitespace | `markdownToBlocks` called with `"   \n\n  "` | `trim()` returns empty → returns `[]` | Correct. |

### 4.4 URL Edges

| Input | Handling | Risk |
|---|---|---|
| `https://` URLs | Allowed | Works. |
| `http://` URLs | Allowed | Works. |
| `mailto:` URLs | Allowed | Works. |
| `javascript:` URLs | Blocked → rendered as plain text (`markdown-to-blocks.ts:11-17`) | **Good security.** Prevents XSS via bookmark/link injection. |
| `data:` URLs | Blocked | Good. |
| `file://` URLs in markdown content | Processed for upload if in image/link syntax | Only processed by `processFileUploads`, which is called by `create_page`, `append_content`, `replace_content`, `update_section` — but NOT `create_page_from_file` or `find_replace`. |
| `ftp://` URLs | Blocked (not in safe list) | Rendered as plain text. Minor — few users need FTP links. |
| Relative URLs | Treated as relative — `isSafeUrl` fails because `new URL(relative)` throws | Rendered as plain text. Could be confusing for `[link](./other-page)` in markdown files. |
| Very long URLs (>2000 chars) | No validation | Could hit Notion API limits on URL-type properties. |

---

## Lens 5: Multi-Step Workflows

### 5.1 Create → Edit Cycles

| Workflow | Tools | Coverage | Risk |
|---|---|---|---|
| Create page → read it back → verify round-trip | `create_page` → `read_page` | Supported | Core design guarantee. Tested in `roundtrip.test.ts` for all 25 block types. |
| Create page → edit section → read back | `create_page` → `update_section` → `read_page` | Supported | Section replacement works. Tested in `update-section.test.ts`. |
| Create page → find-replace → read back | `create_page` → `find_replace` → `read_page` | Supported | `find_replace` uses different API path than create (Notion native markdown vs our GFM pipeline). Round-trip after find-replace should work but exercises a cross-API-path interaction. |
| Create page → append → append → read | `create_page` → `append_content` × 2 → `read_page` | Supported | Content accumulates. Order preserved. |

### 5.2 Template Workflows

| Workflow | Tools | Coverage | Risk |
|---|---|---|---|
| Create template page → duplicate per instance | `create_page` → `duplicate_page` × N | Partially supported | Duplicates content but not child pages, databases, comments, or cover image. |
| Create database → add template entries | `create_database` → `add_database_entries` | Supported | Works for pre-populating databases. |

### 5.3 Bulk Operations

| Workflow | Tools | Coverage | Risk |
|---|---|---|---|
| Import N markdown files | `create_page_from_file` × N | Supported (stdio) | Agent must loop. No batch-file-import tool. Slow for large N. |
| Populate database from CSV | Agent parses CSV → `add_database_entries` | Supported (agent-side) | Agent must parse CSV. Server handles batch creation. Sequential API calls. |
| Export all pages under a parent | `list_pages` → `read_page` × N | Supported | Agent must traverse tree manually. No bulk export. |
| Update a field across all database entries | `query_database` → `update_database_entry` × N | Supported (agent-side) | No bulk update tool. Agent must loop through results. |

### 5.4 Cross-Page Operations

| Workflow | Tools | Coverage | Risk |
|---|---|---|---|
| Move content from page A to page B | `read_page(A)` → `append_content(B, content)` → `replace_content(A, "")` | Supported (agent-orchestrated) | Non-atomic. If append to B succeeds but replace on A fails, content is duplicated. |
| Merge two pages | `read_page(A)` + `read_page(B)` → `create_page(merged)` | Supported (agent-orchestrated) | Agent must merge markdown strings. No merge tool. |
| Reorganize page hierarchy | `list_pages` → `move_page` × N | Supported | Works for flat restructuring. No recursive move. |

### 5.5 Retry / Idempotency

| Scenario | Behavior | Risk |
|---|---|---|
| `create_page` retried after timeout | Creates duplicate page | No idempotency key. Agent may not realize the first attempt succeeded. |
| `append_content` retried | Appends duplicate content | Same issue. |
| `add_database_entry` retried | Creates duplicate entry | Same issue. |
| `find_replace` retried | Replaces already-replaced text | If find string was already replaced, second call finds nothing — effectively idempotent. Good. |
| `update_database_entry` retried | Sets same values again | Idempotent. Good. |
| `archive_page` retried | Archives already-archived page | Idempotent. Good. |
| `delete_database_entry` retried | Archives already-archived entry | Idempotent. Good. |

---

## Lens 6: Failure Modes

### 6.1 Silent Data Loss

| Scenario | Mechanism | Severity |
|---|---|---|
| Unsupported block types on read | `normalizeBlock` returns `null` → block skipped silently (`server.ts:324-326`) | **High**. Reading a page with synced blocks, link_to_page blocks, or child_database blocks silently drops them. Agent doesn't know content was lost. If it then does `replace_content`, the dropped blocks are permanently gone. |
| Unknown property names on write | `convertPropertyValues` skips properties not in schema (`notion-client.ts:202-203`) | **Medium**. Agent misspells "Priorty" → value silently dropped. Entry created without the intended property. No warning. |
| Status option removal silent reassignment | Removing a status option via `update_data_source` silently reassigns rows to default group's first option | **High**. Documented extensively in tool description. PR #21 finding. |
| Image alt text loss | `blocks-to-markdown.ts:207` always outputs `![]()` regardless of alt text | **Low**. Cosmetic data loss — alt text isn't critical for most Notion use cases. |
| Cover image not duplicated | `duplicate_page` doesn't copy cover | **Low**. Cover is metadata, not content. |
| HTML in markdown silently dropped | HTML tokens in `tokenToBlocks` default case return `[]` | **Medium**. Users importing markdown with `<details>`, `<summary>`, `<div>` tags lose that content. |

### 6.2 Partial Failure Without Rollback

| Scenario | Mechanism | Severity |
|---|---|---|
| `replace_content` fails mid-way | Deletes all blocks, then append fails (rate limit, network error) → page left empty | **High**. Data loss with no recovery. |
| `update_section` fails mid-way | Section blocks deleted, new blocks fail to insert → section missing from page | **High**. Same pattern. |
| `add_database_entries` partial failure | Some entries created, some failed | **Low** — by design. Failed entries reported separately. Succeeded entries not rolled back (correct behavior). |
| `create_page` with file uploads — one upload fails | `processFileUploads` uses `Promise.all` (`file-upload.ts:78`) — one failure rejects all | **Medium**. All uploads fail if any single file upload fails. The page is never created. |

### 6.3 Stale Data

| Scenario | Mechanism | Severity |
|---|---|---|
| Schema cache serves stale data | 5-minute TTL. Another client modifies schema during the window. | **Low**. Uncommon in single-user scenarios. More relevant in multi-user OAuth mode. |
| Concurrent page edits | Agent reads page, user edits page, agent writes back → user's changes overwritten | **Medium**. No optimistic locking or conflict detection. Standard for block-level APIs, but `replace_content` makes this particularly risky. |
| Search results lagging | Notion search is eventually consistent — new pages may not appear for seconds to minutes | **Low**. Expected behavior. |
| Data source ID cache | 5-minute TTL (`notion-client.ts:44`). If a database is recreated with same ID (rare), cached data source ID would be wrong. | **Very low**. |

### 6.4 Error Messages and Self-Correction

| Error Type | Message Quality | Self-Correctable? |
|---|---|---|
| `object_not_found` | "Make sure the page/database is shared with your Notion integration." | Yes — agent can ask user to share the page. |
| `rate_limited` | "Notion rate limit hit. Wait a moment and retry." | Yes — agent can wait and retry. |
| `restricted_resource` | "This page hasn't been shared with the integration. In Notion, open the page → ··· menu → Connections → add your integration." | Yes — step-by-step instructions. |
| `validation_error` | "Check property names and types with get_database." | Yes — agent can call `get_database` and retry. |
| Heading not found in `update_section` | "Heading not found: 'X'. Available headings: [...]" | Yes — agent can pick from the list. |
| No parent page available | "parent_page_id is required. Available top-level pages: ..." | Yes — agent can pick from suggestions. |
| File too large | "File too large (Xmb). Max 20MB" | Yes — agent can skip or inform user. |
| Generic error | Raw error message from Notion SDK or Node.js | Maybe — depends on the message. |

### 6.5 Rate Limiting Behavior

| Pattern | Mechanism | Risk |
|---|---|---|
| Notion API rate limit | ~3 requests/second per integration token | `@notionhq/client` SDK has built-in retry with exponential backoff. Our code doesn't add additional retry logic. |
| `replace_content` on large page | 200 block deletions + 200 block appends = 400+ API calls | Will hit rate limits. SDK retry should handle it but the operation will be very slow (minutes). |
| `add_database_entries` with 500 entries | 500+ sequential API calls (schema fetch + create per entry) | Will hit rate limits. SDK retry helps but total time could be 10+ minutes. |
| Bulk `read_page` operations | Each `fetchBlocksRecursive` call makes one API call per parent block with children | A page with 50 toggle blocks, each with 10 children, makes 51 API calls for one `read_page`. |

### 6.6 Permission Boundary Errors

| Scenario | Behavior | Risk |
|---|---|---|
| Integration not connected to page | `restricted_resource` error with helpful message | Good. |
| Integration has read-only access | Write operations fail with permission error | Notion integrations are either full-access or read-only per page. Error message may not clearly say "read-only". |
| OAuth token expired | MCP token has 1-hour expiry (`oauth-provider.ts:17`). Refresh token flow exists. | If Notion refresh also fails, agent gets "Invalid or expired token". Not very actionable. |
| Bot trying to access user-only pages | `object_not_found` (Notion doesn't distinguish "exists but no access" from "doesn't exist") | Security-correct but confusing — agent can't tell if it needs access or if the ID is wrong. |

---

## Lens 7: Integration Shapes

### 7.1 Stdio Transport (API Token Mode)

| Aspect | Status | Notes |
|---|---|---|
| Single-user operation | Supported | One `NOTION_TOKEN`, one Notion client instance. |
| `NOTION_ROOT_PAGE_ID` | Optional | Default parent for `create_page`. |
| `NOTION_TRUST_CONTENT` | Optional | Disables content notice prefix on `read_page`. |
| `NOTION_MCP_WORKSPACE_ROOT` | Optional (stdio only) | Bounds `create_page_from_file` file paths. Defaults to `process.cwd()`. |
| All 27 tools available | Yes | Including `create_page_from_file`. |
| MCP client: Claude Desktop | Supported | JSON config in `claude_desktop_config.json`. |
| MCP client: Claude Code | Supported | `claude mcp add` command. |
| MCP client: Cursor | Supported | `.cursor/mcp.json`. |
| MCP client: VS Code Copilot | Supported | `.vscode/mcp.json` (`servers` key). |
| MCP client: Windsurf | Supported | `~/.windsurf/mcp.json`. |
| MCP client: OpenClaw | Supported | `openclaw config set` commands. |

### 7.2 HTTP Transport (OAuth Mode)

| Aspect | Status | Notes |
|---|---|---|
| Multi-user operation | Supported | Per-user Notion tokens via OAuth relay. |
| OAuth flow | Full flow: `.well-known/oauth-authorization-server` → `/authorize` → Notion consent → `/callback` → `/token` exchange | PKCE enforced by MCP SDK. |
| Dynamic client registration | Supported | In-memory client store (`oauth-provider.ts:57-70`). Clients re-register on server restart. |
| Token storage | AES-256-GCM encrypted file-based (`token-store.ts`) | Persists across server restarts. |
| Token expiry | 1 hour for access tokens, no expiry for refresh tokens | Refresh token reuse — same refresh token returned on refresh (`oauth-provider.ts:409`). |
| Session management | Per-session MCP server + Notion client | Sessions tracked in `transports` Map (`http.ts:35`). |
| 26 tools available | Yes | `create_page_from_file` excluded (transport-gated). |
| Health check | `GET /` returns JSON status | |

### 7.3 HTTP Transport (Static Token Mode)

| Aspect | Status | Notes |
|---|---|---|
| Single-user over HTTP | Supported | `NOTION_TOKEN` without OAuth credentials. |
| No auth middleware | No bearer auth on `/mcp` endpoint | Anyone who can reach the port can use the server. No authentication in this mode. |
| Use case | Local development, Docker-based platforms that need HTTP but not multi-user | Dify, n8n, FlowiseAI via `host.docker.internal`. |

### 7.4 Platform-Specific Integration

| Platform | Transport | Notes | Coverage |
|---|---|---|---|
| Dify | HTTP | `host.docker.internal:3333/mcp` from Docker container | Documented in README. |
| n8n | HTTP | Same Docker bridge pattern | Documented in README. |
| FlowiseAI | HTTP | Same pattern | Documented in README. |
| Custom orchestrator | Either | Can import `createServer` or `createApp` directly as a library | Not documented but works — `createApp` is exported (`http.ts:31`). |
| Behind a reverse proxy | HTTP | Standard Express app — works behind nginx/traefik | Not tested but should work. OAuth redirect URIs need to match the public URL. |

### 7.5 Library Usage

| Aspect | Status | Notes |
|---|---|---|
| Import `createServer` directly | Possible | `server.ts` exports `createServer`. Could be used to embed the MCP server in another application. |
| Import `createApp` directly | Possible | `http.ts` exports `createApp`. Integration tests already use this pattern (`http-transport.test.ts`). |
| Import conversion functions | Possible | `markdownToBlocks` and `blocksToMarkdown` are exported. Could be used as a standalone markdown↔Notion conversion library. |
| npm package entry points | `bin` field in `package.json` | `easy-notion-mcp` for stdio, `easy-notion-mcp-http` for HTTP. Library imports need to target specific files. |

---

## Lens 8: Weird-but-Real Scenarios

### 8.1 Migration Scenarios

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Evernote → Notion via exported HTML | **Not supported** | HTML content in markdown is silently dropped by `tokenToBlocks`. Agent would need to convert HTML to markdown first. | Evernote refugees. Non-trivial user base. |
| Confluence → Notion | **Not supported** | Confluence exports as HTML or proprietary XML. Same HTML-dropping issue. | Enterprise teams switching to Notion. |
| GitHub wiki → Notion | Partially supported | GitHub wiki pages are markdown. `create_page_from_file` works if files are local. But GitHub wiki markdown may use features we don't handle (e.g., `:emoji:` shortcodes, `[[wiki links]]`). | Open-source teams. |
| Obsidian vault → Notion | Partially supported | Obsidian markdown is standard-ish but uses `[[wikilinks]]`, `![[embeds]]`, `$$` for LaTeX (which we support), and YAML frontmatter (which becomes divider blocks). | PKM users. Growing. |
| Bear notes → Notion | Partially supported | Bear uses markdown with some extensions. Basic markdown works. | Bear users. Moderate. |
| Notion → Notion (workspace migration) | Partially supported | `read_page` + `create_page` per page. Loses relations, comments, page properties, permissions, sharing settings, views. | Enterprise workspace consolidation. |

### 8.2 Notion as CMS

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Blog engine reads Notion pages as content source | `read_page` returns markdown | Supported. Round-trip fidelity means the markdown output is directly usable. Notion-hosted image URLs expire (~1 hour) — CMS must cache/re-upload images. | Indie devs using Notion as CMS (Super.so, Potion, etc.). Growing pattern. |
| Agent updates published content | `update_section` or `find_replace` | Supported. Good for surgical edits to live content. | Content teams. |
| Database as content collection | `query_database` to list posts, `read_page` per entry for content | Supported. But database entries (pages in databases) return property values from `query_database` and block content from `read_page` — two calls per entry. | Blog/docs sites powered by Notion databases. |
| Scheduled content publishing | Agent triggered on schedule, queries "Ready" items, updates status to "Published" | Supported (agent-orchestrated). No built-in scheduling — agent or external scheduler triggers. | Marketing teams. |

### 8.3 Research Lab with 10k-Entry Bibliography

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Bulk-loading 10k entries | `add_database_entries` | **Will be extremely slow.** 10,000 sequential API calls at ~3/sec = ~55 minutes, assuming no rate limit backoff. Realistically 2+ hours with retries. | Academic labs. Rare but real. |
| Querying the full bibliography | `query_database` (no filter) | **Returns all 10,000 entries in one response.** Massive JSON response. Will consume significant agent context/tokens. No pagination exposed. | Same. |
| Querying with filters | `query_database` with filter | Supported. If the filter narrows results to <100, response is manageable. | Same. |
| Cross-referencing with relation properties | Not supported | **Major gap** for bibliography databases that link papers to authors, topics, projects via relations. | Same. |

### 8.4 Agent Reading a 200-Page Wiki

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Crawling a page tree | `list_pages` → `read_page` recursively | Supported but slow. Each page requires multiple API calls (page metadata + recursive block fetch). 200 pages with average 50 blocks each = ~10,000+ API calls. | Research agents, documentation auditors. |
| `max_blocks` for skimming | `read_page` with `max_blocks: 10` | Supported. Returns first 10 top-level blocks + `has_more` flag. But children of those 10 blocks are fully fetched regardless. | Agents that need headlines/summaries without full content. |
| Summarizing across pages | Agent reads multiple pages, synthesizes | Agent-orchestrated. Server provides the data. | Common agent workflow. |

### 8.5 Agent Generating a Full PRD from Voice Note

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Create structured PRD with headings, tables, callouts | `create_page` with rich markdown | Supported. All the formatting tools are available. | PM workflows. Common. |
| Add icon and cover | `create_page` (icon) + `update_page` (cover) | Supported. `create_page` supports icon + cover URL. | Same. |
| Iterate on specific sections | `update_section` | Supported. | Same. |
| Publish to team space | `create_page` with `parent_page_id` or `move_page` | Supported. | Same. |

### 8.6 Workspace with 5 Cross-Referenced Databases

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Read database schemas | `get_database` × 5 | Supported. Shows relation property exists but no target info. | Project management setups. Common in teams. |
| Query with relation filters | `query_database` with relation filter | **Unknown.** Our `query_database` passes filters to Notion API directly. Relation filters exist in Notion but we don't construct them, and `buildTextFilter` doesn't include relation-type properties. Agent would need to construct raw Notion filter syntax. | Same. |
| Create entries with relation values | `add_database_entry` | **Not supported.** `convertPropertyValues` has no case for relation type. Value silently dropped. | Same. |
| Navigate via relations | Read entry → get related page ID → read that page | Relation property values return `null` from `simplifyEntry` (`server.ts:80`). **Can't navigate relations.** | Same. |
| Create cross-database rollups | Not supported | Rollup properties are read-only and not surfaced in `simplifyEntry`. | Same. |

### 8.7 Additional Weird-but-Real

| Scenario | Coverage | Risk | Who |
|---|---|---|---|
| Page with 50+ embedded images (external URLs) | `create_page` | Supported. Each `![](url)` becomes an image block. No upload needed for external URLs. | Documentation pages with screenshots. |
| Page with 50+ file uploads | `create_page` with `file://` URLs | `processFileUploads` uploads all in parallel (`file-upload.ts:78`). 50 concurrent uploads may overwhelm Notion's upload API. | Batch documentation with local assets. |
| Agent trying to create a page in a database (not as a child page) | `create_page` with database as `parent_page_id` | Will fail — `create_page` uses `page_id` parent type. Creating database entries requires `add_database_entry`. Error message may be confusing. | New agents exploring the tools. |
| Agent sending Notion page URLs as IDs | All tools take `page_id` / `database_id` as strings | No URL-to-ID extraction. Agent must provide the UUID, not a Notion URL. | Common agent mistake. |
| Notion workspace at API rate limit from other integrations | All tools | SDK retry handles it, but operations may be very slow. No way to detect if rate limits are from our integration or others sharing the token. | Teams with many Notion integrations. |
| Page with a database view/linked database block | `read_page` | View blocks are not in our `normalizeBlock` types. **Silently dropped on read.** If agent does `replace_content`, the embedded database view is lost permanently. | Common in project management pages. |
| Agent calling tools with stale page IDs after page was deleted | Various tools | `object_not_found` error with helpful message. | Long-running agent sessions. |
| Unicode emoji as database select options | `add_database_entry` with `{ "Type": "🎨" }` | Should work — option names are strings. Notion supports emoji in option names. | Design teams. |
| Very deeply nested list (10+ levels) | `create_page` | Notion limits nesting to ~3 levels for list items. Deeper nesting likely flattened or rejected by Notion API. Our code produces arbitrarily deep `children` arrays. | Outline-heavy users. |
| Creating a page with 0 blocks (empty content) | `create_page` with `markdown: ""` | `markdownToBlocks` returns `[]`. Notion API accepts a page with no children. | Edge case. |
| `find_replace` on a page with no matching text | All | Notion's `pages.updateMarkdown` behavior unclear — may return success with no changes or may error. | Common. |

---

## Blind Spots Summary

### High-Confidence Gaps

1. **Relation properties are completely unsupported** — can't create, read, write, or filter by relation properties. This is probably the single biggest functional gap for users with interconnected databases. `simplifyProperty` returns `null` for relations (`server.ts:80`), `convertPropertyValues` has no relation case (`notion-client.ts:191-248`), and `schemaToProperties` can't create relation columns (`notion-client.ts:145-189`).

2. **Silent block-type dropping on read** — `normalizeBlock` returns `null` for any block type not in the 25 supported types (`server.ts:122-278`). No warning to agent. Combined with `replace_content`, this creates a permanent data loss path: read (lossy) → replace (destructive). Affected real types: `synced_block`, `child_database`, `link_to_page`, `breadcrumb`, `link_preview`.

3. **No pagination for query results** — `queryDatabase` and `searchNotion` fetch all results (`notion-client.ts:504-527`, `428-456`). For large databases or workspaces, responses will be massive. No `limit` or `page_size` parameter exposed to agents.

4. **Non-atomic multi-phase operations** — `replace_content` and `update_section` both delete-then-insert. Network failure between phases leaves the page in a partially-destroyed state with no rollback mechanism.

5. **`create_page_from_file` doesn't process file uploads** — `file://` URLs in the file's markdown content are not uploaded (`server.ts:998`). Unlike `create_page`, which calls `processFileUploads`. This is probably a bug, not a design choice.

### Questions I Couldn't Answer from Code Alone

1. **`find_replace` cross-block behavior**: Does Notion's `pages.updateMarkdown` match text across block boundaries? If a user's find string spans two paragraphs, does it work? Would need runtime testing.

2. **`find_replace` rich text behavior**: If text is bold/italic, does the plain-text `find` string match? Or must the formatting be specified? Runtime testing needed.

3. **Rate limit behavior under heavy batch operations**: Does `@notionhq/client` v5.13's built-in retry handle the patterns our tools create (hundreds of sequential calls for `replace_content` or `add_database_entries`)? Or does it give up after N retries?

4. **Notion API behavior for pages.move across workspaces**: Can `move_page` move a page to a parent in a different workspace? What error is returned?

5. **OAuth token refresh reliability**: If the Notion refresh token itself expires (Notion docs suggest access tokens last indefinitely for internal integrations, but OAuth tokens may behave differently), what happens? The code swallows refresh failures and continues with the old token (`oauth-provider.ts:383-386`).

6. **Inline equation support**: Notion supports inline equations (within paragraph text). Our markdown convention only supports block equations (`$$..$$`). Is there demand for inline equations? Would require a new inline syntax convention.

7. **Maximum number of concurrent OAuth sessions**: The HTTP server creates a new MCP server instance per session (`http.ts:79`). Under heavy multi-user load, is there a memory concern? Each session holds a full `Server` instance and a `StreamableHTTPServerTransport`.

8. **`update_data_source` in-progress group bug**: Tool description warns about `makenotion/notion-mcp-server#232` — Notion API returning stale schemas where `in_progress` group options appear as empty array. Is this still an active bug? Would need runtime verification.

9. **Heading depth >3**: Markdown supports `####` (H4) through `######` (H6). Our `tokenToBlocks` sends H4-H6 to `heading_3` (`markdown-to-blocks.ts:452`). Correct for Notion (which only supports H1-H3), but the truncation is silent. Is this documented anywhere for users?

10. **Database entry content**: Database entries (pages in databases) can have block content in addition to properties. Our `add_database_entry` only sets properties — no way to set content on database entry pages. The entry's page content must be set separately via `append_content`.

---

## Appendix: Tool Registry Summary

| # | Tool | Category | Transport | Key Dependency |
|---|---|---|---|---|
| 1 | `create_page` | Pages | All | `markdownToBlocks`, `processFileUploads` |
| 2 | `create_page_from_file` | Pages | Stdio only | `readMarkdownFile`, `markdownToBlocks` |
| 3 | `append_content` | Pages | All | `markdownToBlocks`, `processFileUploads` |
| 4 | `replace_content` | Pages | All | `markdownToBlocks`, `processFileUploads`, `deleteBlock` |
| 5 | `update_section` | Pages | All | `markdownToBlocks`, `processFileUploads`, `deleteBlock`, `appendBlocksAfter` |
| 6 | `find_replace` | Pages | All | `pages.updateMarkdown` (Notion native) |
| 7 | `read_page` | Pages | All | `fetchBlocksRecursive`/`WithLimit`, `blocksToMarkdown` |
| 8 | `duplicate_page` | Pages | All | `fetchBlocksRecursive`, `createPage` |
| 9 | `update_page` | Pages | All | `updatePage`, `uploadFile` (for file:// covers) |
| 10 | `archive_page` | Pages | All | `archivePage` |
| 11 | `restore_page` | Pages | All | `restorePage` |
| 12 | `search` | Navigation | All | `searchNotion` |
| 13 | `list_pages` | Navigation | All | `listChildren` (filtered for child_page) |
| 14 | `share_page` | Navigation | All | `getPage` |
| 15 | `create_database` | Databases | All | `schemaToProperties` |
| 16 | `update_data_source` | Databases | All | `getDataSourceId`, `dataSources.update` |
| 17 | `get_database` | Databases | All | `getCachedSchema` |
| 18 | `list_databases` | Databases | All | `searchNotion` |
| 19 | `query_database` | Databases | All | `getDataSourceId`, `dataSources.query`, `buildTextFilter` |
| 20 | `add_database_entry` | Databases | All | `convertPropertyValues`, `getCachedSchema` |
| 21 | `add_database_entries` | Databases | All | Same as above, sequential loop |
| 22 | `update_database_entry` | Databases | All | `convertPropertyValues` |
| 23 | `delete_database_entry` | Databases | All | `archivePage` |
| 24 | `list_comments` | Comments | All | `comments.list` |
| 25 | `add_comment` | Comments | All | `comments.create`, `blockTextToRichText` |
| 26 | `list_users` | Users | All | `users.list` |
| 27 | `get_me` | Users | All | `users.me` |

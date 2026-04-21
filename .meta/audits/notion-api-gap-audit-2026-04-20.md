# Notion API Gap Audit — easy-notion-mcp v0.3.0

**Date:** 2026-04-20
**Scope:** Compare what `easy-notion-mcp` exposes (27 tools, `@notionhq/client` v5.13.0, Notion-Version `2025-09-03`) against what Notion's REST API currently offers.
**Author:** Research/audit pass — no code changes, inventory only.

---

## 1. TL;DR — highest-impact gaps

1. **Formulas cannot be created or updated.** `schemaToProperties` (`src/notion-client.ts:145-189`) silently drops every type it doesn't recognise — formula, rollup, people, files, relation, unique_id, verification, place all fall into `default: break`. `create_database` and `update_data_source` therefore return "success" with the formula column missing from Notion. Formula create is a single-field API (`{ formula: { expression: "..." } }`) — a trivial fix that unblocks a large category of workflow users.
2. **Relation columns can be read/written as values but cannot be created by `create_database` / `update_data_source` from our simple schema shape.** Relations need `{ relation: { data_source_id, type: "single_property"|"dual_property" } }` under 2025-09-03, which our `{name, type}` tuple can't express. Value-level reads and writes exist (`convertPropertyValue` handles `case "relation"` at `src/notion-client.ts:224-229`; `simplifyProperty` handles it at `src/server.ts:76-77`), but schema creation is blocked.
3. **Page properties > 25 references are silently truncated.** `pages.retrieve` caps multi-value properties (title, rich_text, relation, people, rollup) at 25 items. We never call `GET /v1/pages/{page_id}/properties/{property_id}`, the paginated property endpoint (`client.pages.properties.retrieve` is in v5.13 — see `node_modules/@notionhq/client/build/src/Client.d.ts:210-215`). `simplifyEntry` in `src/server.ts:88-94` and `read_page` both surface the truncated values without warning. This is a silent-data-loss gap for any database with long relations/people.
4. **No block-update tool.** Every edit we do is delete-and-append (`replace_content`, `update_section`). Notion exposes `PATCH /v1/blocks/{block_id}` (in SDK as `client.blocks.update`, `Client.d.ts:133`), which edits a block in place, preserving block ID, inline comments, and ordering. Adding a single `update_block` tool (or letting `find_replace` use it) eliminates the destructive-warning path on `replace_content` and `update_section` (`src/server.ts:540-566`).
5. **Writable `status` and `verification` are exposed at the schema level but not the value level.** `update_data_source` forwards raw property payloads (good — `src/server.ts:706-738`) so schema writes for status work. But `convertPropertyValue` (`src/notion-client.ts:244-248`) still throws "This type is computed by Notion" for `verification`, and the status value path is fine. Per Notion's 2026-03-25 changelog, `verification` became writable on wiki pages — we reject it.
6. **File uploads are limited to single-part, 20 MB.** `uploadFile` (`src/notion-client.ts:79-108`) hard-codes `mode: "single_part"` and errors on files > 20 MB. Notion supports `mode: "multi_part"` (>20 MB, SDK method `client.fileUploads.complete` at `Client.d.ts:273-276`) and `mode: "external_url"` (server-side import of an already-hosted URL, no binary transfer). `external_url` is especially cheap to add — it's one alternate branch in `uploadFile` — and unblocks HTTP-transport callers who can't pass `file://`.
7. **`find_replace` uses only one of three `pages.updateMarkdown` commands.** We wrap `update_content` (the find/replace path, `src/server.ts:1128-1138`) but not `replace_content` (replace the whole page atomically in one PATCH — which would eliminate the partial-failure window in our `replace_content` tool) or the block-boundary-aware variants.
8. **`update_page` can't update arbitrary page properties.** It handles title/icon/cover only (`src/notion-client.ts:425-456`). Verification on wiki pages, page-level properties on non-database pages (2026-03-25), and structured `icon: { type: "icon" }` introduced in 2026-03-25 are not reachable.
9. **Database-level updates are split across two endpoints and we only wrap one.** `update_data_source` updates the *data source* (properties, title, trash). It does not touch database-level fields — `is_locked`, `is_inline` toggle, `description`, database icon/cover, database move. Those live on `PATCH /v1/databases/{database_id}` (`client.databases.update`, `Client.d.ts:158-161`), which we never call.
10. **Views, templates, and custom emojis have zero coverage.** Eight views endpoints shipped 2026-03-19, template listing at `GET /v1/data_sources/{id}/templates` (`client.dataSources.listTemplates`, `Client.d.ts:180-183`) is in the SDK, and `GET /v1/custom_emojis` rounds out the gaps. All three are low-priority individually but together represent the entire "administer/configure a database" surface we don't expose.

---

## 2. Property type matrix

Legend: ✅ supported, ❌ not supported, ⚠️ partial. Citations point at the code path that does (or silently fails to do) the work.

### 2.1 What our code handles

| Notion property type | Create-schema (`create_database`) | Update-schema (`update_data_source`) | Write value (`add_database_entry` / `update_database_entry`) | Read value (`query_database` / `read_page`) | Source URL |
|---|---|---|---|---|---|
| `title` | ✅ `src/notion-client.ts:150-152` | ✅ raw pass-through `src/server.ts:706-738` | ✅ `src/notion-client.ts:198-200` | ✅ `src/server.ts:52-53` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `rich_text` | ✅ (mapped from `"text"`) `src/notion-client.ts:153-155` | ✅ raw | ✅ `src/notion-client.ts:200-201` | ✅ `src/server.ts:54-55` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `number` | ✅ `:156-158` — **no format** (no cents/percent/dollar/etc.) | ✅ raw | ✅ `:202-203` | ✅ `:56-57` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `select` | ✅ `:159-161` — **no `options` array** (created empty) | ✅ raw | ✅ `:204-205` | ✅ `:58-59` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `multi_select` | ✅ `:162-164` — no options | ✅ raw | ✅ `:206-211` | ✅ `:60-61` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `date` | ✅ `:165-167` | ✅ raw | ✅ `:212-213` (only `start`; no `end`, no `time_zone`) | ✅ `:62-63` (returns `start` only) | [ref](https://developers.notion.com/reference/page-property-values) |
| `checkbox` | ✅ `:168-170` | ✅ raw | ✅ `:214-215` | ✅ `:64-65` | [ref](https://developers.notion.com/reference/page-property-values) |
| `url` | ✅ `:171-173` | ✅ raw | ✅ `:216-217` | ✅ `:66-67` | [ref](https://developers.notion.com/reference/page-property-values) |
| `email` | ✅ `:174-176` | ✅ raw | ✅ `:218-219` | ✅ `:68-69` | [ref](https://developers.notion.com/reference/page-property-values) |
| `phone` → `phone_number` | ✅ `:177-179` (note: schema key is `phone`, API type is `phone_number`) | ✅ raw | ✅ `:220-221` | ✅ `:70-71` | [ref](https://developers.notion.com/reference/page-property-values) |
| `status` | ✅ `:180-182` — no options; ⚠️ status groups can't be created via API (groups-UI-only per `src/server.ts:717-718`) | ✅ raw (confirmed writable per 2026-03-19 changelog) | ✅ `:222-223` | ✅ `:72-73` | [changelog 2026-03-19](https://developers.notion.com/page/changelog) |
| `people` | ❌ silently dropped, `:183-184 default: break` | ❌ unless user sends raw (update_data_source is pass-through) | ❌ explicit throw `:230-236` | ✅ `src/server.ts:74-75` (read only) | [ref](https://developers.notion.com/reference/page-property-values) |
| `files` | ❌ silently dropped `:183-184` | ❌ unless raw | ❌ explicit throw `:230-236` (only `external` URLs would be writable anyway) | ❌ `simplifyProperty default → null` (`src/server.ts:83-84`) | [ref](https://developers.notion.com/reference/page-property-values) |
| `relation` | ❌ silently dropped `:183-184` (would need `{relation: {data_source_id, type}}`) | ❌ unless raw | ✅ `:224-229` (write-value path works) | ✅ `src/server.ts:76-77` — ⚠️ capped at 25, no pagination call to `pages.properties.retrieve` | [ref](https://developers.notion.com/reference/property-schema-object); [upgrade](https://developers.notion.com/docs/upgrade-guide-2025-09-03) |
| `formula` | ❌ **silently dropped** `:183-184` — the primary gap that triggered this audit | ❌ unless raw | N/A (read-only) | ❌ `simplifyProperty default → null` | [ref](https://developers.notion.com/reference/property-schema-object) |
| `rollup` | ❌ silently dropped `:183-184` | ❌ unless raw | N/A (read-only) | ❌ `simplifyProperty default → null` | [ref](https://developers.notion.com/reference/page-property-values) |
| `created_time` | ❌ silently dropped `:183-184` (schema-add would be `{ created_time: {} }`) | ❌ unless raw | N/A (server-generated; we do throw on writes `:237-249`) | ❌ `simplifyProperty default → null` | [ref](https://developers.notion.com/reference/page-property-values) |
| `last_edited_time` | ❌ silently dropped | ❌ unless raw | N/A | ❌ | [ref](https://developers.notion.com/reference/page-property-values) |
| `created_by` | ❌ silently dropped | ❌ unless raw | N/A | ❌ | [ref](https://developers.notion.com/reference/page-property-values) |
| `last_edited_by` | ❌ silently dropped | ❌ unless raw | N/A | ❌ | [ref](https://developers.notion.com/reference/page-property-values) |
| `unique_id` | ❌ silently dropped `:183-184` (schema needs `{ unique_id: { prefix } }`) | ❌ unless raw | N/A (server-increment; we throw `:237-249`) | ✅ `src/server.ts:78-82` (read supported, with prefix) | [ref](https://developers.notion.com/reference/property-object) |
| `verification` | ❌ silently dropped | ❌ unless raw | ❌ we throw on write (`:244-249`) — **now incorrect** post-2026-03-25 changelog (verification writable on wiki pages) | ❌ `simplifyProperty default → null` | [changelog 2026-03-25](https://developers.notion.com/page/changelog); [page-properties](https://developers.notion.com/reference/page-property-values) |
| `place` / location | ❌ silently dropped | ❌ unless raw | ⚠️ unclear — Notion docs state "not fully supported" | ❌ `simplifyProperty default → null` | [ref](https://developers.notion.com/reference/property-object) |
| `button` | ❌ silently dropped | ❌ unless raw | N/A (trigger-only; no write value) | ❌ | [ref](https://developers.notion.com/reference/property-object) |

### 2.2 Summary numbers

- Schema creatable via our simple `{name, type}`: **11 of ~20** property types (the 11 in `schemaToProperties` at `src/notion-client.ts:149-185`).
- Writable at the value level via our simple key-value map: **11** (same 11, plus `relation` which is only value-writable — 12 total) — `src/notion-client.ts:197-230`.
- Readable in a query/page output: **13** (the 11 value-writable types + `relation` + `unique_id` — `src/server.ts:50-86`).
- Completely invisible on both read and write: `files`, `formula`, `rollup`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `verification`, `place`, `button` — **10 types**.

The existing frame-6 drift audit called this out at `.meta/research/frame-6-driftracker-2026-04-17.md:145-147` (P3.6: silent data loss in query_database reads) and `:157-159` (P3.9: silent wrong schema in createDatabase). The gap that triggered *this* audit (formulas not creatable) is case P3.9.

### 2.3 Additional quirks to surface

- **Schema writes are pass-through in `update_data_source` but not in `create_database`.** `update_data_source` (`src/server.ts:706-738`, `notion-client.ts:518-547`) accepts raw Notion property shapes — so a sufficiently savvy caller *can* add a formula column via `properties: { "My Formula": { formula: { expression: "..." } } }`. `create_database` always goes through `schemaToProperties` which drops unknown types. **The UX asymmetry is itself a gap**: users learn they can add-formula via update but not via create.
- **`simplifyEntry` in query results fully replaces the Notion payload** (`src/server.ts:88-94`). Callers never see raw property data — so when `simplifyProperty` returns `null`, there is no "fall-through" to give the caller at least the raw shape. Every unsupported type becomes `null`.
- **Schema cache doesn't track newly-added property types.** `getCachedSchema` 5-minute TTL (`src/notion-client.ts:44`) means a user who just added a formula in the UI gets a stale "unknown property" error for up to 5 minutes. The one-shot bust-and-retry at `:272-283` helps on writes but does not surface types differently.

---

## 3. Endpoint gaps

### 3.1 Endpoints we wrap (baseline; no action needed)

From `node_modules/@notionhq/client/build/src/Client.d.ts` and our `src/notion-client.ts`:

| SDK call | REST endpoint | Our tool(s) |
|---|---|---|
| `pages.create` | `POST /v1/pages` | `create_page`, `create_page_from_file`, `add_database_entry`, `add_database_entries`, `duplicate_page` |
| `pages.retrieve` | `GET /v1/pages/{id}` | `read_page`, `share_page`, `duplicate_page`, `update_database_entry` (internal) |
| `pages.update` | `PATCH /v1/pages/{id}` | `update_page` (title/icon/cover), `archive_page`, `restore_page`, `update_database_entry`, `delete_database_entry` |
| `pages.move` | `POST /v1/pages/{id}/move` | `move_page` |
| `pages.updateMarkdown` | `PATCH /v1/pages/{id}/markdown` | `find_replace` (only the `update_content` command) |
| `databases.create` | `POST /v1/databases` | `create_database` |
| `databases.retrieve` | `GET /v1/databases/{id}` | `get_database`, internal resolution in `getDataSourceId` |
| `dataSources.retrieve` | `GET /v1/data_sources/{id}` | `get_database` (via `getCachedSchema`) |
| `dataSources.update` | `PATCH /v1/data_sources/{id}` | `update_data_source` |
| `dataSources.query` | `POST /v1/data_sources/{id}/query` | `query_database` |
| `blocks.children.list` | `GET /v1/blocks/{id}/children` | `list_pages`, `read_page`, `replace_content`, `update_section`, internal |
| `blocks.children.append` | `PATCH /v1/blocks/{id}/children` | `append_content`, `replace_content`, `update_section` |
| `blocks.delete` | `DELETE /v1/blocks/{id}` | `replace_content`, `update_section` (teardown step) |
| `search` | `POST /v1/search` | `search`, `list_databases`, `findWorkspacePages` (internal) |
| `comments.list` | `GET /v1/comments` | `list_comments` |
| `comments.create` | `POST /v1/comments` | `add_comment` |
| `users.list` | `GET /v1/users` | `list_users` |
| `users.me` | `GET /v1/users/me` | `get_me` |
| `fileUploads.create` | `POST /v1/file_uploads` (mode=single_part only) | `uploadFile` (internal, stdio-only via `file://`) |
| `fileUploads.send` | `POST /v1/file_uploads/{id}/send` | `uploadFile` |

### 3.2 Endpoints present in SDK v5.13 that we don't wrap

Each row: user-pain on a 3-step scale (high / med / low), SDK presence confirmed from `Client.d.ts`.

| Endpoint | SDK method | User-pain | Why it matters | Source |
|---|---|---|---|---|
| `GET /v1/blocks/{id}` | `blocks.retrieve` (`Client.d.ts:129`) | low | Inspect a single block by ID (e.g. debug a synced_block). | [ref](https://developers.notion.com/reference/retrieve-a-block) |
| `PATCH /v1/blocks/{id}` | `blocks.update` (`Client.d.ts:133`) | **high** | Only way to edit a block *in place*. Our `replace_content` / `update_section` are delete+append, which loses block IDs and inline comments. Single biggest write-path improvement. | [ref](https://developers.notion.com/reference/update-a-block) |
| `GET /v1/pages/{id}/properties/{prop_id}` | `pages.properties.retrieve` (`Client.d.ts:210-215`) | **high** | Paginated read of a single property — required when a title/rich_text/relation/people/rollup has >25 items. Without it we return truncated arrays silently. | [ref](https://developers.notion.com/reference/retrieve-a-page-property) |
| `GET /v1/pages/{id}/markdown` | `pages.retrieveMarkdown` (`Client.d.ts:205`) | med | Server-side block→markdown renderer. Handles block types our `blocksToMarkdown` omits (synced_block, child_database, link_to_page, meeting_notes). Alternative, possibly better, implementation of `read_page` for large or complex pages. | [changelog 2026-02-26](https://developers.notion.com/page/changelog) |
| `POST /v1/data_sources` | `dataSources.create` (`Client.d.ts:174`) | low | Add a second data source to an existing multi-source database. Niche. | [ref](https://developers.notion.com/reference/create-a-data-source) |
| `GET /v1/data_sources/{id}/templates` | `dataSources.listTemplates` (`Client.d.ts:180-183`) | med | List page templates on a database — required to resolve template-name→ID before creating a page-from-template. Without it, `pages.create`'s `template` param is unreachable. | [ref](https://developers.notion.com/reference/list-data-source-templates) |
| `PATCH /v1/databases/{id}` | `databases.update` (`Client.d.ts:158-161`) | med | Database-level fields we can't touch today: `title`, `description`, `icon`, `cover`, `is_inline` toggle, `is_locked`, move to new parent. Our `update_data_source` only updates data-source-level fields. | [ref](https://developers.notion.com/reference/update-a-database) |
| `GET /v1/users/{user_id}` | `users.retrieve` (`Client.d.ts:221`) | low | Resolve a single user ID (e.g. `created_by.id`) to name/email without listing every user. | [ref](https://developers.notion.com/reference/get-user) |
| `GET /v1/file_uploads/{id}` | `fileUploads.retrieve` (`Client.d.ts:253`) | low | Poll status of an in-flight file upload. | [ref](https://developers.notion.com/reference/retrieve-a-file-upload) |
| `GET /v1/file_uploads` | `fileUploads.list` (`Client.d.ts:257`) | low | List/prune stale/expired uploads. | [ref](https://developers.notion.com/reference/list-file-uploads) |
| `POST /v1/file_uploads/{id}/complete` | `fileUploads.complete` (`Client.d.ts:276`) | med | Finalize a multi-part upload. Blocks the whole "file > 20 MB" use case today (`uploadFile` at `src/notion-client.ts:86` hard-errors). | [ref](https://developers.notion.com/reference/complete-a-file-upload) |
| `GET /v1/comments/{id}` | `comments.retrieve` (`Client.d.ts:243`) | low | Fetch a single comment by ID. | [ref](https://developers.notion.com/reference/retrieve-a-comment) |
| `POST /v1/oauth/token` | `oauth.token` (`Client.d.ts:286`) | n/a — already used inside `auth/oauth-provider.ts`, not exposed as a tool (correct). | — | [ref](https://developers.notion.com/reference/create-a-token) |
| `POST /v1/oauth/introspect` | `oauth.introspect` (`Client.d.ts:293`) | low | Validate a token's scope/expiry. Used by OAuth-aware clients. | [ref](https://developers.notion.com/reference/introspect-token) |
| `POST /v1/oauth/revoke` | `oauth.revoke` (`Client.d.ts:300`) | low | Log out / revoke a stored access token. Reasonable to expose from our token store. | [ref](https://developers.notion.com/reference/revoke-token) |

### 3.3 Endpoints that shipped in Notion 2026 but SDK v5.13 coverage needs verification

| Endpoint family | What it does | User-pain | Notes |
|---|---|---|---|
| **Views API** — `GET /v1/views`, `GET /v1/views/{id}`, `POST /v1/views`, `PATCH /v1/views/{id}`, `DELETE /v1/views/{id}`, `POST /v1/views/{id}/query`, `GET /v1/views/{id}/queries/{query_id}` | Eight endpoints shipped 2026-03-19 for programmatic view management (board, calendar, gallery, timeline, etc.) — create, read, update, delete views; cache-query against a saved view's filter/sort. | low individually, **medium** collectively — unlocks "agent operates within a user's saved view" workflows. | SDK v5.13 has **no `views` namespace** in `Client.d.ts`. Needs raw `request()` or an SDK bump. [changelog](https://developers.notion.com/page/changelog) |
| **Custom emojis** — `GET /v1/custom_emojis` (list + name-filter) | Resolve workspace custom emoji name → ID for setting page icons. | low | Relevant only to workspaces with custom emojis. SDK presence: not in Client.d.ts. |
| **Enhanced markdown endpoints** — `GET /v1/pages/{id}/markdown`, `PATCH /v1/pages/{id}/markdown`, `POST /v1/pages` with markdown body | Three endpoints shipped 2026-02-26. We wrap `updateMarkdown` partially (see §4) and `retrieveMarkdown` not at all. | med | The `pages.retrieveMarkdown` SDK call exists in v5.13 (`Client.d.ts:205`). The third ("create page from markdown") may be the existing `pages.create` with a new body shape — needs verification. |

### 3.4 Deprecated / version-gated surface — informational only

| Item | Status | Our exposure |
|---|---|---|
| `POST /v1/databases/{id}/query` | Deprecated by 2025-09-03; replaced by `POST /v1/data_sources/{id}/query` | We already use the new endpoint. No action. |
| `archived` field → `in_trash` | Changed in 2025-09-03 | We use `in_trash` throughout. No action. |
| `after` on `blocks.children.append` → `position` object | Deprecated 2026-03-11 | `appendBlocksAfter` at `src/notion-client.ts:375-398` still passes `after`. OK under pinned 2025-09-03; breaks on API-version bump. Flag for the next SDK/version bump. |
| `transcription` block → `meeting_notes` | Renamed 2026-03-11 | Neither is supported (both fall through `normalizeBlock`'s `default`, `src/server.ts:302-304`). Post-rename, `meeting_notes` should be the name if we ever add it. |
| `webhook: database.schema_updated` → `data_source.schema_updated` | Changed 2025-09-03 | We don't implement webhooks. No action. |
| Query 10,000-row cap with `request_status: "incomplete"` | Added ~April 2026 | `queryDatabase` (`src/notion-client.ts:549-573`) accumulates via `start_cursor` — will silently stop at cap without surfacing the `incomplete` marker. Worth a warnings-field follow-up. |

---

## 4. Partial-coverage gaps within existing tools

### 4.1 `create_database` — schema shortcut drops everything non-trivial

`schemaToProperties` at `src/notion-client.ts:145-189` is an allowlist of 11 types. It silently drops:

- `formula` → should be `{ formula: { expression } }` with `expression` required.
- `rollup` → `{ rollup: { relation_property_name | relation_property_id, rollup_property_name | rollup_property_id, function } }`.
- `relation` → `{ relation: { data_source_id, type: "single_property" | "dual_property" } }` with a `dual_property: {}` or `single_property: {}` sub-object; under 2025-09-03 must use `data_source_id` not `database_id`.
- `unique_id` → `{ unique_id: { prefix?: string | null } }`.
- `people`, `files` → `{ people: {} }`, `{ files: {} }` (just shell configs).
- `number` format (`dollar`, `percent`, `ruble`, etc.) → takes `{ number: { format } }`; we send `{ number: {} }` always.
- `select` / `multi_select` / `status` options → we send an empty config so callers have to round-trip through `update_data_source` to add options.
- `verification`, `place`, `button` — silently dropped.

The response reinforces the silent failure: at `src/server.ts:1313-1318`, `create_database` returns `properties: Object.keys(schemaToProperties(schema))`, which — by construction — only lists types our shortcut recognises. The caller never sees which columns Notion actually created.

User-pain: **high**. This is the function that the triggering user complaint surfaced.

### 4.2 `query_database` — filter/sort are raw pass-through but `text` helper is narrow

Filter and sort pass through raw (`src/server.ts:1358-1374`, `notion-client.ts:549-573`), so users who know Notion's filter JSON can express everything Notion supports — including the surprisingly rich set confirmed against the docs:

- text filters (title/rich_text/url/email/phone_number): `contains`, `does_not_contain`, `equals`, `does_not_equal`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`.
- number: `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to`, `is_empty`, `is_not_empty`.
- date: `equals`, `before`, `after`, `on_or_before`, `on_or_after`, `this_week`, `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`, `is_empty`, `is_not_empty`.
- select / status: `equals`, `does_not_equal`, `is_empty`, `is_not_empty`.
- multi_select / relation / people / rollup-array: `contains`, `does_not_contain`, `is_empty`, `is_not_empty`.
- files: `is_empty`, `is_not_empty`.
- checkbox: `equals`, `does_not_equal`.
- formula: nested `checkbox | date | number | string`, each with the operators for that result type.
- rollup: `any | every | none` (nested), or scalar `number | date`.
- unique_id: `equals`, `does_not_equal`, `greater_than`, etc. (number operators).
- verification: `status: "verified" | "expired" | "none"` (new, per 2026-03-25).
- compound: `and` / `or`, **nested up to two levels deep** (per the docs).
- timestamp-only variant (no property name): `created_time`, `last_edited_time` as a `timestamp` field.

Source: [post-database-query-filter](https://developers.notion.com/reference/post-database-query-filter).

What we *miss*:

- **Tool description** (`src/server.ts:759-783`) documents only a handful of operators. Agents relying on the description won't know formula/rollup/verification/unique_id filters exist. Not a code gap, but a documentation-is-contract gap.
- **`buildTextFilter` text-helper** (`src/notion-client.ts:133-143`) only searches `title | rich_text | url | email | phone_number`. Misses `unique_id` (prefix-based search), `formula` of result-type string, `rollup` of result-type string, `status.name`. Most important: searching by `unique_id` prefix would be a natural "find by ticket ID" UX.
- **Sort shape is not documented or validated.** The `sorts` param is typed `unknown[]` (`src/server.ts:763`, `:1358-1374`). Sorts can be property-based `{ property, direction }`, timestamp-based `{ timestamp, direction }`, or combinations. Worth documenting.

User-pain: low-medium. The underlying capability is there — it's undercommunicated.

### 4.3 `search` — no sort, one fixed filter

`search` (`src/server.ts:643-657`, `notion-client.ts:473-501`) accepts only the object-type filter (`pages` | `databases`). The API also accepts a `sort: { direction, timestamp: "last_edited_time" }` parameter (source: [post-search](https://developers.notion.com/reference/post-search)). We hardcode ascending-by-default behavior from the API but don't give the caller a sort toggle, and we don't expose the raw `query` pagination size.

User-pain: low.

### 4.4 `update_page` — title/icon/cover only

`updatePage` (`src/notion-client.ts:425-456`) constructs a `payload` that branches on `props.title`, `props.icon`, `props.cover`. It does not accept:

- Arbitrary page properties (the `properties` map on `PATCH /v1/pages/{id}`). Wiki-page verification (writable per 2026-03-25) is unreachable.
- `is_locked` (lock a page from UI editing).
- `template` application to an existing page.
- Structured `icon: { type: "icon", icon: {...} }` format introduced with Notion's custom-icon picker (2026-03-25). Today our branch at `src/notion-client.ts:441` hardcodes `{ type: "emoji", emoji }`, dropping custom icons on round-trip.

User-pain: low for most callers; **medium** for wiki users.

### 4.5 `find_replace` — one of four commands

`find_replace` uses only `update_content` (`src/server.ts:1128-1138`). `PATCH /v1/pages/{id}/markdown` also accepts:

- `replace_content` — replaces the entire page's markdown atomically in a single call. **This is a direct fix for the destructive-warning path on our `replace_content` tool** (`src/server.ts:540-551`): instead of delete-children + append-children (which can fail mid-flight and leave an empty page), a single PATCH with `replace_content` is atomic from the API's perspective.
- `insert_content` / `replace_content_range` — legacy, use `after` ellipsis selectors. Deprecated per the docs; skip.

The SDK type `UpdatePageMarkdownParameters` (in `api-endpoints.d.ts`, imported at `Client.d.ts:3`) has all these variants. Our tool just never exposes them.

User-pain: **medium** — atomic replace removes the data-loss risk from our most destructive tool.

### 4.6 `appendBlocks` / `appendBlocksAfter` — deprecated `after`

`appendBlocksAfter` (`src/notion-client.ts:375-398`) passes the flat `after: string` param. The API now prefers a `position` object (`{ type: "end" | "start" | "after_block", after_block: { id } }`) — deprecated in 2026-03-11 but still functional under our pinned 2025-09-03 header. No user-pain today; flagged as a future upgrade item.

### 4.7 `list_comments` / `add_comment` — page-scoped, no block or thread

- `list_comments` (`src/server.ts:832-841`, `notion-client.ts:575-590`) hardcodes `block_id = pageId`. The API also accepts a block ID to fetch comments on a specific block.
- `add_comment` (`src/server.ts:843-853`, `notion-client.ts:592-597`) always posts with `parent: { page_id }`. The API also accepts `parent: { block_id }` (comment on a specific block) and `discussion_id` (reply to an existing discussion). Source: [create-a-comment](https://developers.notion.com/reference/create-a-comment).

User-pain: **medium** for any agent doing "annotate this specific paragraph" or "reply to the thread that was opened on this block."

### 4.8 `uploadFile` — single_part only

`uploadFile` (`src/notion-client.ts:79-108`) hardcodes `mode: "single_part"` and errors above 20 MB. The create-file-upload endpoint supports:

- `mode: "multi_part"` — file split into ≥5 MB parts, completed with `fileUploads.complete`. Unlocks files >20 MB.
- `mode: "external_url"` — pass a public HTTPS URL; Notion imports server-side with no client-side binary transfer. This is particularly useful in HTTP transport where `file://` is rejected — external URLs become the primary upload path.

Source: [create-a-file-upload](https://developers.notion.com/reference/create-a-file-upload).

User-pain: **high for `external_url`**, **medium for `multi_part`**.

### 4.9 Block-type coverage in `read_page` and `markdownToBlocks`

Supported block types are explicit at `src/server.ts:135-141` (`SUPPORTED_BLOCK_TYPES`). The `fetchBlocksRecursive` path emits `omitted_block_types` warnings for anything else (`src/server.ts:341-358`), so this is the *least* silent of our gaps — but still a gap.

Omitted (known, per `frame-6-driftracker-2026-04-17.md:122`):

- `synced_block`, `child_page`, `child_database`, `link_preview`, `pdf`, `template`, `breadcrumb`, `link_to_page`, `unsupported` (Notion's own), plus more recent types: `meeting_notes` (renamed from `transcription` in 2026-03-11), `tab`, `heading_4`, `column` inside nested layouts.

On the write side, `markdownToBlocks` (`src/markdown-to-blocks.ts`) produces the same set as `SUPPORTED_BLOCK_TYPES`. No mention-type or equation-in-inline-rich-text support on write (a mention requires `{ type: "mention", mention: { type, ... } }` inside a rich_text array, which our pipeline never constructs).

User-pain: medium — `synced_block` and `child_database` are common in team workspaces; the frame-6 audit already called for an allowlist expansion pass.

---

## 5. Formula 2.0 deep dive

### 5.1 What Notion accepts

Confirmed via [property-schema-object](https://developers.notion.com/reference/property-schema-object) direct fetch:

```json
{
  "properties": {
    "My Calc": {
      "formula": {
        "expression": "prop(\"Price\") * prop(\"Quantity\")"
      }
    }
  }
}
```

`expression` is the only field; it's required. Notion's formula engine parses it server-side on write.

Read shape on a page property is **polymorphic by result type**:

```json
{
  "type": "formula",
  "formula": {
    "type": "number" | "string" | "boolean" | "date",
    "number"?: 42,
    "string"?: "Hello",
    "boolean"?: true,
    "date"?: { "start": "...", "end": "...", "time_zone": "..." }
  }
}
```

### 5.2 Changelog history

Searching the Notion changelog directly (WebFetch, 2026-04-20):

- **September 6–7, 2023**: "The formatting of `formula.expression`, which is returned when retrieving a database with a Formula property, has changed." This is the Formula 2.0 formatting shift — the read shape changed from a flat `formula_text` string to the polymorphic `{ type, [type]: value }` shape above. **No separate "Formula 2.0" entry exists in 2024–2026.** The formula API has been stable since that 2023 formatting change.
- No recent changelog entries mention formulas at all, which means: (a) our gap is purely self-inflicted — Notion's side is stable, (b) there is no Formula 3.0 / deprecation on the horizon that we'd be building on quicksand.

### 5.3 Write-vs-read format migration considerations

- The deprecated `formula_text` field (Formula 1.0 legacy) is **gone** from current responses. No wrapper should rely on it.
- The *expression syntax itself* evolved in the UI (Formula 2.0 is a full functional language with typed pipelines) but the API's surface is simply "string in, typed result out." Any valid formula expression the Notion UI accepts works as a string in `expression`.
- Reads need a polymorphic decoder (dispatch on `formula.type`, then pull the matching sub-field). Our current `simplifyProperty` has no formula case, so it returns `null` for every formula result. The minimal fix:
  ```js
  case "formula":
    const f = prop.formula;
    if (!f) return null;
    return f[f.type] ?? null;
  ```

### 5.4 Implementation scope

Adding first-class formula support is ~3 touch points:

1. `schemaToProperties` (`src/notion-client.ts:149-185`) — add `case "formula": props[name] = { formula: { expression: config.expression } }; break;` and update the `create_database` tool to accept an optional `expression` field per schema entry.
2. `simplifyProperty` (`src/server.ts:50-86`) — add the formula case above, plus `rollup` while we're there (similar polymorphic shape).
3. Tool description text in `create_database` (`src/server.ts:682`) — advertise `formula` as a supported type with an example.

Estimated scope: **one small PR, <100 LOC including tests**. Tests should cover the 4 result types (number, string, boolean, date) on read and the one write shape. There's a roundtrip test pattern already established at `tests/roundtrip.test.ts` that can be extended.

---

## 6. Recommended sequencing — 3 PRs over 2 weeks

The selection criteria: (a) user-request frequency — whoever asked about formulas tomorrow will ask about rollups and relations the day after, (b) API stability — don't build on views or enhanced markdown (<6 months old), (c) implementation cost — small wins first.

### PR 1 (high-value, small) — "Complete the property type surface"

Close the formula / rollup / relation-schema / unique_id / people / files gap in one pass.

- `schemaToProperties` expands to cover: `formula`, `rollup`, `relation` (as `{ data_source_id, type: "single_property" }`; dual variant behind a flag), `unique_id` (with optional `prefix`), `people`, `files`, `verification`, `button`, and accepts an optional-format field on `number`.
- `simplifyProperty` gets cases for: `formula`, `rollup`, `files`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `verification`.
- `convertPropertyValue` stops throwing for `people` (we already have relation as the template — array of `{id}`). Leaves `files` and `verification` as write-supported per the 2026-03-25 changelog; leaves computed types (`formula`, `rollup`, `unique_id`, `created_*`, `last_edited_*`) as explicit-throws.
- Tool descriptions in `create_database`, `add_database_entry`, `update_database_entry` updated to list the new types.

**Why first:** the triggering complaint, plus the frame-6 audit already pointed at this (cases P3.5, P3.6, P3.9). All Notion-side shapes are stable — we're not betting on new surface.
**Estimated scope:** 1 dev-week, ~400 LOC + tests. Can be broken into 2 PRs (schema vs value) if review is heavy.
**Risk:** medium — `convertPropertyValues`'s unknown-key cache-bust at `src/notion-client.ts:272-283` needs to not regress; the explicit-throws need to stay informative.

### PR 2 (silent-data-loss fix) — "Paginate page properties past 25"

- Add `pages.properties.retrieve` call to the property-value path for the multi-value types (`title`, `rich_text`, `relation`, `people`, `rollup-array`) any time we see `has_more: true` in a property payload.
- Touch points: `simplifyEntry` in `src/server.ts:88-94` and the `read_page` flow in `src/server.ts:1144-1188`.
- Surface a `truncated: true` warning in the response when pagination occurs, matching our existing warnings pattern (`CLAUDE.md:136`).

**Why second:** silent-data-loss on any database with long relations. Frame-6 called this out implicitly. Low-complexity, high-user-trust payoff.
**Estimated scope:** 2–3 days, <200 LOC.
**Risk:** low — the API is stable and there's an SDK method for it.

### PR 3 (atomic replace + block-level edit) — "Block-precision editing without destructive gaps"

Two related changes that together remove every destructive warning we currently ship:

1. Refactor `replace_content` to use `pages.updateMarkdown` with `command: "replace_content"` instead of the delete-children + append-children choreography (`src/server.ts:1054-1066`). This is a single atomic PATCH; on failure, Notion rejects the whole thing rather than leaving an empty page.
2. Add a new `update_block` tool wrapping `blocks.update`, for the "fix a typo in this specific paragraph" / "check this specific to-do" use case. Let `find_replace` use it internally when the edit is scoped to a single block's rich_text, to preserve block IDs and inline comments.

**Why third:** (a) it depends on more non-trivial test surface (atomicity claims need integration tests against a real workspace), (b) PRs 1+2 are higher-volume user asks, (c) the destructive warnings have been shipping for a while — no regression risk to rushing them out.
**Estimated scope:** 1 dev-week, ~300 LOC including a new tool and its tests.
**Risk:** medium — test harness for atomicity claims needs thought. Also: `pages.updateMarkdown` with `replace_content` is less than 6 months old (shipped 2026-02-26), so this is the one PR that's near-frontier on API stability.

### Not recommended for the 2-week window

- **Views API** (shipped 2026-03-19) — too new, SDK support unclear, low immediate user pain.
- **File uploads: external_url + multi_part** — high value, low complexity, but a fourth PR; can slot in after the top 3.
- **Block-type coverage expansion** (`synced_block`, `child_database`, `link_to_page`, `meeting_notes`, `heading_4`, `tab`) — ongoing chisel-work, not a single PR shape. Frame-6 already carries this ticket.
- **Database-level vs data-source-level update split** (`databases.update` for `is_locked` / `is_inline` / `description`) — medium pain, can wait.
- **Comments on blocks / thread replies** — medium pain; deferrable.

---

## Appendix: sources and artifacts

**Notion docs cited** (all `developers.notion.com`):
- `/reference/property-schema-object`
- `/reference/update-property-schema-object`
- `/reference/property-object`
- `/reference/page-property-values`
- `/reference/post-database-query-filter`
- `/reference/retrieve-a-page-property`
- `/reference/update-a-block`
- `/reference/post-search`
- `/reference/create-a-comment`
- `/reference/create-a-file-upload`
- `/reference/complete-a-file-upload`
- `/reference/update-page-markdown`
- `/reference/update-a-database`
- `/reference/list-data-source-templates`
- `/page/changelog` (2023-09-06–07 formula, 2026-02-26 markdown endpoints, 2026-03-11 block renames, 2026-03-19 status + views, 2026-03-25 verification + custom icons)
- `/docs/upgrade-guide-2025-09-03`

**Our code** (every `file:line` in this doc is in `/mnt/d/backup/projects/personal/mcp-notion/`):
- `src/server.ts` — tool registry, handler switch, `simplifyProperty`, `simplifyEntry`, `SUPPORTED_BLOCK_TYPES`, `normalizeBlock`
- `src/notion-client.ts` — SDK wrappers, `schemaToProperties`, `convertPropertyValue`, `uploadFile`, `buildTextFilter`
- `src/markdown-to-blocks.ts` + `src/blocks-to-markdown.ts` — block/markdown coverage
- `node_modules/@notionhq/client/build/src/Client.d.ts` — authoritative SDK surface for v5.13.0

**Existing meta files referenced** (not re-derived):
- `.meta/research/frame-6-driftracker-2026-04-17.md` — drift cases P3.5 (`verification`), P3.6 (silent property read gap), P3.9 (silent schema drop), P3.10 (structured icons). This audit adds the formula/rollup/pagination/block-update/external-url dimensions they didn't cover.
- `.meta/research/compare-awkoy-notion-mcp.md` — confirms awkoy covers none of these gaps either (they're on SDK v2; we're on v5.13, so we have *more* surface available than they do to wrap).
- `.meta/audits/synthesis-pre-v030-2026-04-17.md` — case C-3 notes the silent-property-drop, but treats relation as the flagship; this audit extends the list to 10 invisible types.

**Out of scope for this audit** (future research if asked):
- Webhooks (`database.*` events, `data_source.schema_updated`) — we ship none.
- OAuth scopes / permissions model — beyond the token-relay we already have.
- Anything about per-workspace rate limits or the April 2026 10,000-row query cap — policy, not endpoint coverage.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Dry-run destructive operations.** MCP destructive tools accept `dry_run:
  true`, and the CLI accepts `--dry-run` on destructive content, page,
  database-entry, and block commands to preview validation and planned effects
  without mutating Notion.
- **Toggle archiving.** `archive_toggle` and `content archive-toggle` archive
  one toggle or toggleable heading by title without deleting or rewriting its
  children.
- **Find-replace match counts.** `find_replace` and `content find-replace`
  successful responses now include `match_count`, counted from a preflight
  Notion markdown read before the atomic update.
- **Heading-preserving section updates.** `update_section` now accepts
  `preserve_heading`, and `content update-section` accepts
  `--preserve-heading`, to keep the matched heading block while destructively
  replacing only its body.
- **Page-content search.** `search_in_page` and `content search-in-page`
  perform read-only, case-insensitive raw block text search across a page or
  one toggle scope, with snippets and toggle context for matches.

## [0.8.0] - 2026-05-08

### Added

- **Targeted read tools.** Agents can read individual sections, blocks, and
  toggles without fetching an entire page.
- **Saved view tools.** Agents can list, read, query, create, update, and
  delete Notion database views using the SDK-supported Views API surface.
- **Toggle body updates.** `update_toggle` replaces one toggle or toggleable
  heading body by title while preserving the container block ID, giving long
  script-toggle workflows a targeted alternative to page-wide `find_replace`.
- **MCP documentation resources.** Tool descriptions can point to shared
  markdown syntax, warnings, property pagination, and data-source examples
  instead of repeating long reference text inline.

### Fixed

- **`meeting_notes` blocks are explicitly reported as omitted on reads.**
  Notion's renamed transcription block type remains read-only in this
  markdown dialect; read responses surface it through `omitted_block_types`
  warnings instead of silently dropping it.
- **Warning documentation resource matches runtime contracts.** The warnings
  resource documents the emitted `truncated_properties`,
  `bookmark_lost_on_atomic_replace`, and `embed_lost_on_atomic_replace` shapes.
- **CLI accepts option-like markdown and text values.** Values such as `---`,
  `--new`, and `--profile` are treated as command values when provided in value
  positions.
- **Callout child writes are shaped safely.** Nested callout children are
  normalized, deferred, and split consistently with other child containers.

## [0.7.0] - 2026-05-07

### Added

- **Profile-aware `easy-notion` CLI.** The package now exposes an
  `easy-notion` binary for low-context Notion access without registering
  another MCP server. CLI profiles support separate token environment
  variables, readonly/readwrite modes, optional root page defaults, and
  commands for users, search, pages, content edits, blocks, comments, and
  database entries.
- **Lightweight `easy-notion-cli` skill.** The repository and npm package now
  include `skills/easy-notion-cli/`, which teaches agents to use the CLI for
  multi-profile Notion workflows instead of loading multiple MCP tool
  surfaces.
- **Expanded live E2E coverage.** The live MCP suite now covers
  `append_content`, `find_replace`, `duplicate_page`,
  `update_database_entry`, and `add_database_entries` against real Notion.

### Fixed

- **Large markdown writes are more reliable.** Page creation and append paths
  chunk more than 100 top-level blocks, defer nested block children that Notion
  cannot accept inline, and split outgoing rich-text segments at Notion's
  2,000-character request limit.
- **`update_section` preserves first-section ordering.** Replacing a section
  at the start of a page now updates the existing heading in place as the
  insertion anchor instead of appending replacement content at the end.
- **README HTTP startup examples now use the installable package name.**
  Fresh `npx` users should run
  `npx -p easy-notion-mcp easy-notion-mcp-http`; the HTTP binary is a
  secondary bin inside `easy-notion-mcp`, not a standalone package.
- **Vitest ignores agent worktrees.** Test discovery now excludes
  `.mcp-agents/` worktrees so stale copied tests do not inflate local runs.

### Security

- **`file://` uploads are contained to `NOTION_MCP_WORKSPACE_ROOT`.** Stdio
  file uploads now resolve real paths, reject symlink/prefix escapes, reject
  non-files and over-20MB files before Notion side effects, and default the
  allowed root to the current working directory.

## [0.6.0] - 2026-05-01

### Breaking changes

- **`replace_content` now uses Notion's atomic `pages.updateMarkdown` endpoint
  (`type: "replace_content"`) instead of the previous delete-children +
  append-children loop.** Block IDs, deep-link anchors, and inline-comment
  threads on matched blocks are now preserved across `replace_content`. Side
  effect of the previous delete-then-append: callers that relied on
  `replace_content` to wipe a page clean of block types the parser doesn't
  represent (`synced_block`, `child_page`, `child_database`, `link_to_page`)
  no longer get the *atomic* wipe of those types — they are simply not
  present in the new content. Use the Notion UI for those types or
  duplicate_page to preserve them.
- **Response shape on `replace_content` changed.** Previously
  `{ deleted: number, appended: number }`; now
  `{ success: true, truncated?: true, warnings?: Array<{code, ...}> }`. The
  warnings array surfaces `unmatched_blocks` (when Notion's
  `unknown_block_ids` is non-empty) and `bookmark_lost_on_atomic_replace` /
  `embed_lost_on_atomic_replace` (Enhanced Markdown has no input form for
  bookmarks/embeds; we emit bare URLs and warn).
- **`replace_content` description softened.** Previously labeled
  DESTRUCTIVE with no rollback; now describes block-ID preservation honestly
  and names the block types that don't survive (child_page, synced_block,
  child_database, link_to_page).

### Added

- **New tool `update_block`.** Surgical single-block edits via markdown,
  preserving the block's identity (deep-link anchors and inline-comment
  threads survive). Updatable block types: paragraph, heading_1/2/3,
  bulleted_list_item, numbered_list_item, toggle, quote, callout, to_do,
  code, equation. Pre-fetches `blocks.retrieve` to validate the existing
  block type and return a friendly error on type mismatch instead of
  forwarding the raw Notion API error. Supports `archived: true` to delete
  any block.
- **GFM-with-extensions → Notion Enhanced Markdown translator**
  (`src/markdown-to-enhanced.ts`). Translates this server's input dialect
  (`+++` toggles, `::: columns`, `> [!NOTE]` callouts, `[toc]`,
  `$$equation$$`, bare-URL bookmarks) to the Enhanced Markdown XML form
  Notion's atomic endpoints actually parse. Ground truth from the published
  spec at `developers.notion.com/guides/data-apis/enhanced-markdown` plus
  the live probes documented in
  `.meta/research/pr3-live-probe-findings-2026-04-28.md`.
- **`find_replace` now surfaces `unknown_block_ids`** from the API response
  as a `warnings: [{ code: "unmatched_blocks", block_ids: [...] }]` entry
  instead of discarding the field. Aligns with the parallel surfacing on
  `replace_content`.

## [0.5.1] - 2026-04-30

### Fixed

- **`easy-notion-mcp-http` exited silently when launched via `npx`, `bunx`, or
  any `node_modules/.bin/` shim path.** The HTTP entry's main-module guard
  compared `process.argv[1]` (shim path) directly with `import.meta.url`
  (resolved file); under bin-shim invocation those don't match, so
  `startServer()` never ran and the process exited 0 with no error. The
  predicate is now extracted to `src/main-module.ts`, realpath-resolves
  `argv[1]` before comparing, and absorbs realpath errors as false. Filed as
  [#53](https://github.com/Grey-Iris/easy-notion-mcp/issues/53), shipped via
  [#55](https://github.com/Grey-Iris/easy-notion-mcp/pull/55). The stdio entry
  (`src/index.ts`) has no main-module guard and is intentionally unaffected by
  this bug class.

### Notes

- Retroactive entry — the v0.5.1 release commit (`e8a9e21`) bumped package
  versions but did not update CHANGELOG. Added during v0.6.0 release prep.

### Breaking changes

- **`replace_content` now uses Notion's atomic `pages.updateMarkdown` endpoint
  (`type: "replace_content"`) instead of the previous delete-children +
  append-children loop.** Block IDs, deep-link anchors, and inline-comment
  threads on matched blocks are now preserved across `replace_content`. Side
  effect of the previous delete-then-append: callers that relied on
  `replace_content` to wipe a page clean of block types the parser doesn't
  represent (`synced_block`, `child_page`, `child_database`, `link_to_page`)
  no longer get the *atomic* wipe of those types — they are simply not
  present in the new content. Use the Notion UI for those types or
  duplicate_page to preserve them.
- **Response shape on `replace_content` changed.** Previously
  `{ deleted: number, appended: number }`; now
  `{ success: true, truncated?: true, warnings?: Array<{code, ...}> }`. The
  warnings array surfaces `unmatched_blocks` (when Notion's
  `unknown_block_ids` is non-empty) and `bookmark_lost_on_atomic_replace` /
  `embed_lost_on_atomic_replace` (Enhanced Markdown has no input form for
  bookmarks/embeds; we emit bare URLs and warn).
- **`replace_content` description softened.** Previously labeled
  DESTRUCTIVE with no rollback; now describes block-ID preservation honestly
  and names the block types that don't survive (child_page, synced_block,
  child_database, link_to_page).

### Added

- **New tool `update_block`.** Surgical single-block edits via markdown,
  preserving the block's identity (deep-link anchors and inline-comment
  threads survive). Updatable block types: paragraph, heading_1/2/3,
  bulleted_list_item, numbered_list_item, toggle, quote, callout, to_do,
  code, equation. Pre-fetches `blocks.retrieve` to validate the existing
  block type and return a friendly error on type mismatch instead of
  forwarding the raw Notion API error. Supports `archived: true` to delete
  any block.
- **GFM-with-extensions → Notion Enhanced Markdown translator**
  (`src/markdown-to-enhanced.ts`). Translates this server's input dialect
  (`+++` toggles, `::: columns`, `> [!NOTE]` callouts, `[toc]`,
  `$$equation$$`, bare-URL bookmarks) to the Enhanced Markdown XML form
  Notion's atomic endpoints actually parse. Ground truth from the published
  spec at `developers.notion.com/guides/data-apis/enhanced-markdown` plus
  the live probes documented in
  `.meta/research/pr3-live-probe-findings-2026-04-28.md`.
- **`find_replace` now surfaces `unknown_block_ids`** from the API response
  as a `warnings: [{ code: "unmatched_blocks", block_ids: [...] }]` entry
  instead of discarding the field. Aligns with the parallel surfacing on
  `replace_content`.

## [0.5.0] - 2026-04-23

### Breaking changes

- **`query_database` response shape changed from `Array<entry>` to
  `{ results: Array<entry>, warnings?: Array<warning> }`.** The
  `results` key is always present; `warnings` is included only when a
  warning fires. Migration: change `rows` to `rows.results`. Existing
  test call sites in the repo were migrated in the same change.

### Added

- **Long-property pagination for `query_database` and `read_page`.**
  When Notion's `pages.retrieve` truncates multi-value properties at
  25 items (`title`, `rich_text`, `relation`, `people`), the server
  now calls `pages.properties.retrieve` to fetch up to
  `max_property_items` (default 75, 0 means unlimited). When the cap
  is hit, the response surfaces a `truncated_properties` warning with
  a `how_to_fetch_all` hint pointing at the override.

- **New input param `max_property_items` on both `query_database` and
  `read_page`.** Negative values are rejected with a validation error
  before any Notion API call.

- **New warning code `truncated_properties`.** Detail shape:
  `{ code, properties: [{ name, type, returned_count, cap }],
  how_to_fetch_all }`.

### Notes

- **`read_page` paginates titles only.** Relation and people properties
  on the page object are not paginated because `read_page` does not
  surface them.

- **Rollup-array pagination is deferred to a follow-up.** See the plan
  at `.meta/plans/pr2-long-property-pagination-2026-04-23.md`,
  section 2.2, for rationale.

## [0.4.0] - 2026-04-22

### Added

- **Schema creation covers every Notion property type (2025-09-03).**
  `create_database` and `update_data_source` now accept schema specs for
  `formula` (required `expression`), `rollup` (required `function`,
  `relation_property`, `rollup_property`), `relation` (single_property
  default; optional `dual_property` with `synced_property_name`; accepts
  either `data_source_id` or `database_id`, resolved internally),
  `unique_id` (optional `prefix`), `people`, `files`, `verification`,
  `place`, `location`, `button`, `created_time`, `last_edited_time`,
  `created_by`, `last_edited_by`. `select` / `multi_select` / `status`
  accept an `options` array; `number` accepts a `format` string.

- **Read decoders (`simplifyProperty`) cover the expanded type set.**
  `formula` decodes polymorphically (number, string, boolean, date);
  `rollup` decodes polymorphically (number, date, array with recursive
  decode, unsupported, incomplete). New decoders for `files`,
  `verification`, `place`, `button`, `created_time`, `last_edited_time`,
  `created_by`, `last_edited_by`. `query_database` rows now return
  structured values for these types instead of `null`.

- **`get_database` response surfaces per-type extras.** `expression`,
  `function`, `relation_property`, `rollup_property`, `data_source_id`,
  `relation_type`, `prefix`, `format` are included where relevant, so
  callers can introspect schema details without a second round-trip.

- **`update_data_source` accepts the schema-helper shape in addition to
  raw Notion payloads.** If every property entry has a top-level `type`
  string from the supported set and no reserved raw keys, the payload
  is routed through `schemaToProperties` for validation. Otherwise the
  raw pass-through is preserved. Routing is all-or-nothing per call;
  mixed payloads stay raw. Existing raw patterns (rename,
  delete-via-null, raw-formula) continue to work unchanged.

- **Post-publish smoke script (`npm run release:smoke`).** Resolves
  `easy-notion-mcp@latest` from npm, installs to a throwaway tmp dir,
  spawns the tarball's stdio entry point, and runs `initialize` plus
  `tools/call get_me` to confirm the published artifact boots and
  authenticates. Distinct exit codes for precondition, install,
  handshake, and shape-validation failures. Manual post-publish step;
  not wired into CI.

- **E2E stale-sandbox sweeper (`npm run test:e2e:sweep` and
  `npm run test:e2e:sweep:apply`).** Standalone script for cleaning up
  leftover sandbox pages when test teardown is interrupted. Dry-run by
  default. Refuses to archive anything outside the configured
  `NOTION_ROOT_PAGE_ID`. Scoped to `child_page` descendants; search
  results outside the known candidate set are logged SKIP-only. Exit
  codes: 2 for local preconditions, 3 for root-boundary refusal, 4 for
  `--apply` runs that hit unexpected archive errors.

- **E2E teardown error classifier.** Three-class classifier
  (`already_archived`, `archived_ancestor`, `not_found`) with an
  `unexpected` fallthrough, plus an unconditional
  `[e2e][teardown] cleanup summary: archived=... already_archived=...
  archived_ancestor=... not_found=... unexpected=...` line per run.
  Internal testing infrastructure; no user-facing API change.

### Changed

- **`add_database_entry` / `update_database_entry` now write `people`
  values.** Pass a single user ID string or an array of user IDs.
  v0.3.0 threw under the G-4b strictness path with "this server does
  not support"; the throw is lifted and the value is written through.

- **`create_database` / `update_data_source` reject unknown property
  types with a validation error.** Previously silently dropped during
  `schemaToProperties`, called out as a known limit in the v0.3.0
  changelog. The error surfaces the offending property name, the
  rejected type string, and the list of supported types. Migration:
  remove or rename unsupported entries in the payload.

- **E2E teardown no longer treats tolerated Notion archive outcomes as
  failures.** `archivePageIds`'s return shape changed: `failed` is
  renamed to `unexpected`, with new `tolerated` and `summary` fields.
  Affects only callers inside `tests/e2e/`; no impact on the server
  API or the published tarball.

### Security

- **Refreshed `package-lock.json` to pin `hono@4.12.14`**, closing
  [GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375)
  (moderate XSS in `hono/jsx` SSR) on our own CI and audit posture.
  End-user impact is nil: the npm tarball does not ship
  `package-lock.json`, and `@modelcontextprotocol/sdk`'s caret range
  already resolves fresh installs to the patched version. The
  vulnerable code path (`hono/jsx` SSR) is not reachable from this
  server's `src/`; no symbols from `hono` or `@hono/node-server` are
  imported directly. Patched anyway per the "patch rather than
  whitelist" rule in CLAUDE.md. Filed upstream at
  [modelcontextprotocol/typescript-sdk#1941](https://github.com/modelcontextprotocol/typescript-sdk/issues/1941).

## [0.3.1] - 2026-04-20

### Fixed

- **Multi-paragraph blockquotes and callouts no longer lose content.**
  `create_page`, `append_content`, `replace_content`, and
  `update_section` previously read only the first paragraph token of
  a blockquote, silently dropping every paragraph after it on
  markdown-to-blocks conversion. A blockquote or callout body spanning
  multiple paragraphs now preserves all of them on the round-trip.
- **MCP handshake advertises the correct server version.** `serverInfo.version`
  at the MCP protocol layer was hardcoded to `0.2.0` and never updated
  during the 0.3.0 bump. Clients branching on version were getting the
  wrong answer. Version is now read from `package.json` so future
  bumps track automatically.

## [0.3.0] - 2026-04-19

### Breaking changes

- **Static-token HTTP mode now requires `NOTION_MCP_BEARER`.** Starting
  `npx -p easy-notion-mcp easy-notion-mcp-http` (or `node dist/http.js`) with only
  `NOTION_TOKEN` set refuses to boot. Set a shared-secret bearer and
  configure every MCP client to send it on the `Authorization` header:

  ```bash
  export NOTION_MCP_BEARER=$(openssl rand -hex 32)
  ```

  Reason: the pre-0.3.0 HTTP transport mounted `/mcp` without auth,
  which combined with the default all-interfaces bind exposed the
  server to any network-reachable caller. OAuth mode is unaffected —
  it already enforces its own per-user bearer.

- **HTTP server now binds `127.0.0.1` by default.** Prior versions
  bound `0.0.0.0` implicitly via Express's default. To restore
  network-reachable bind, set `NOTION_MCP_BIND_HOST=0.0.0.0` or
  pin a specific interface such as `192.168.1.5`. Bearer is still
  required regardless of bind in static-token mode.

- **Docker-host workflows (Dify / n8n / FlowiseAI reaching the host
  via `host.docker.internal`) must set both** `NOTION_MCP_BIND_HOST=0.0.0.0`
  **on the host and** `Authorization: Bearer <secret>` **on every
  client request.** See the README "Dify / n8n / FlowiseAI" section
  for the updated command. OAuth mode is the recommended alternative
  for shared Docker deployments.

- **`file://` URLs in markdown content are rejected in HTTP transport.**
  The `create_page`, `append_content`, `replace_content`,
  `update_section`, and `update_page.cover` tools refuse `file://`
  URLs when the server is running over HTTP. Error message points
  to using an HTTPS URL or switching to stdio transport. stdio
  behavior is unchanged — `file://` uploads still work there.

- **`createApp` (for programmatic embedders):** `CreateAppOptions`
  gains a required-when-static `bearer?: string` option. Calls that
  previously passed `{ notionToken }` alone now throw at construction
  with an actionable error.

- **Database writes reject unknown property names (G-4a).**
  `add_database_entry`, `update_database_entry`, and the per-entry
  step of `add_database_entries` now throw with the rejected key
  names and the full valid-key list when a property name is not in
  the database schema — previously silently dropped. When the cache
  is the culprit (user added a property in the Notion UI within
  the 5-minute TTL), the schema is busted and refetched once before
  the error fires, so newly-added properties work on the next call
  without waiting for TTL expiry. Migration: call `get_database`
  first to confirm property names.

- **Database writes reject unsupported property types (G-4b).**
  The same write surface now throws instead of silently dropping
  when a property in the payload has a type the server can't write.
  Error messaging is split: `relation` names the future-release
  roadmap; `people` and `files` state "this server does not support"
  without a future-release promise; computed types (`formula`,
  `rollup`, `created_time`, `last_edited_time`, `created_by`,
  `last_edited_by`, `unique_id`, `verification`) are tagged as
  "computed by Notion and cannot be set via API." Migration: remove
  the unsupported key from the payload, or edit in the Notion UI.

- **`create_database` response reports what Notion actually created
  (G-4c).** The `properties` field in the response is now derived
  from the property payload the server sent to Notion (after
  `schemaToProperties` filtering), rather than echoing the
  requested schema. If the server silently dropped an unsupported
  type during schema-build, the response now makes the mismatch
  visible instead of echoing back the request. Migration: treat
  `response.properties` as a subset-of check against the request.

### Added

- `NOTION_MCP_BEARER` env var — shared-secret bearer required in
  static-token HTTP mode. Clients send it as `Authorization: Bearer
  <secret>` on every `/mcp` request. Verified with
  `crypto.timingSafeEqual`.
- `NOTION_MCP_BIND_HOST` env var — bind address for the HTTP server.
  Default `127.0.0.1`. Accepts `0.0.0.0`, specific interface IPs.
- Exported `getBindHost(env)` helper from `src/http.ts` for
  programmatic consumers and tests.
- New README section: **HTTP mode security posture** — documents
  the bearer-always rule, default-loopback bind, v0.3.0 deferrals
  (DNS rebinding, CORS on OAuth endpoints), and when to pick OAuth
  over static-token.
- Tool-description caveats on `create_page` and `update_page` that
  call out the `file://` form as stdio-only, so HTTP clients reading
  `tools/list` don't advertise-then-fail.

- Optional `warnings: Array<{code, ...detail}>` field on tool
  responses, omitted when empty. Used by `read_page` and
  `duplicate_page` to signal non-fatal data-fidelity concerns.
  PR 2 ships one code: `omitted_block_types` with
  `blocks: Array<{id, type}>`, emitted when the source page
  contains block types the server does not yet represent
  (e.g., `synced_block`, `child_page`, `child_database`,
  `link_to_page`). Codes are part of the contract once shipped.

- Exported `SUPPORTED_BLOCK_TYPES` set from `src/server.ts` as a
  test-facing invariant consumer. Documents which types
  `normalizeBlock` is expected to handle; a drift test guards
  against additions to the set that aren't backed by a case in
  the switch.

### Fixed

- **Remote arbitrary local-file-read in HTTP transport (G-1).** An
  unauthenticated caller could POST markdown containing `[x](file:///etc/passwd)`
  and the server would `stat` and upload the file to the operator's
  workspace. Closed by two changes landed together: (a) bearer-always
  authentication on `/mcp` in static-token mode and loopback-default
  bind, (b) a transport-aware gate inside `processFileUploads` plus
  the `update_page.cover` path that rejects `file://` in HTTP mode.

- **Silent block-type drops on read (G-3b).** `read_page` and
  `duplicate_page` previously dropped unsupported block types
  (`synced_block`, `child_page`, `child_database`, `link_to_page`,
  etc.) with no signal. Combined with `replace_content`, this
  created a permanent data-loss path: read (lossy) → edit →
  replace (destructive). The new `warnings` field surfaces each
  omitted block's id and type so agents know not to round-trip
  the markdown, and can use `duplicate_page` first as a restore
  point when editing pages with unsupported blocks.

- **Silent success on destructive edits (G-3a).** `replace_content`
  and `update_section` tool descriptions now open with a
  **DESTRUCTIVE — no rollback** callout naming the specific
  failure modes (invalid markdown, rate limit, network, per-block
  Notion rejection) and directing agents to `duplicate_page` as a
  recovery pattern. The handlers' behavior is unchanged — Notion
  has no transactional primitive, so atomic replace is not
  implementable. The fix is user-visible mitigation through clear
  descriptions.

- **Silent success on DB write value drops (G-4a, G-4b).** Both
  failure modes previously returned `{id, url}` success while
  skipping the offending property. The `Fixed` entries for these
  G-4 items are captured under `Breaking changes` above because
  they change the tool's success/failure contract.

- **`create_database` response echoed the requested schema (G-4c).**
  `properties` in the response now reflects what Notion actually
  created. If schema-build silently dropped an unsupported type,
  the response makes the mismatch visible to the agent.

- **Silent null on relation reads + throw on relation writes (G-5).**
  PR 2 shipped a forward-compat throw on relation writes with the
  message "support is planned for a future release." PR 3 lifts that
  throw: `add_database_entry`, `update_database_entry`, and the
  per-entry step of `add_database_entries` now accept relation values
  as either a single page-ID string or an array of page-ID strings.
  Falsy values in the array are filtered out; an empty array clears
  the relation. The shape is the same for one-way (`single_property`)
  and two-way (`dual_property`) relations — Notion manages the
  back-link via the schema, not the value payload. On the read side,
  `query_database` now extracts relation IDs into a `string[]` instead
  of returning `null` via `simplifyProperty`'s default case (`read_page`
  does not surface DB-row properties and is unaffected). Migration:
  callers who handled PR 2's throw path can now pass relation values
  directly; the throw was only on dev-tip between the PR 2 and PR 3
  merges and never in a released version.

### Known limits (deferred to v0.3.1)

- DNS-rebinding protection is not wired on the MCP endpoint. Bearer
  is the v0.3.0 trust boundary; keep it set even on loopback.
- CORS on the OAuth endpoints (`/register`, `/token`, `/revoke`) is
  permissive.
- OAuth orphan refresh records are not cleaned up.
- **`create_database` does not yet accept relation-type columns in
  the schema parameter.** Relation VALUES are writable on existing
  columns (G-5), but creating the column itself requires passing
  the target `data_source_id` — a shape the current schema-input
  parameter does not support. Workaround available today: create
  the database schema (without the relation column) via
  `create_database`, then call `update_data_source` with a raw
  Notion relation-config payload. Planned for v0.3.x as a typed
  shortcut.
- `schemaToProperties` still silently drops unsupported `people`
  and `files` types during `create_database` schema-build; G-4c
  (PR 2) makes the drop visible in the response but does not yet
  throw on the request side. Planned for v0.3.1 alongside
  people/files write support.
- `simplifyProperty` read-side drops (`query_database` returning
  `null` for unhandled property types OTHER than relation) are
  not yet signaled. Planned for v0.3.1, likely reusing the
  `warnings` schema with a per-row code.
- `update_section` is not heading-preserving. If the replacement
  markdown omits the leading heading, the anchor disappears and a
  retry fails with "heading not found." Planned for v0.3.1.
- `duplicate_page` is not deep: nested `child_page` subpages are
  not duplicated. G-3b surfaces the drop via `warnings`; full
  deep-copy is not committed to a specific release.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  `npx easy-notion-mcp-http` (or `node dist/http.js`) with only
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

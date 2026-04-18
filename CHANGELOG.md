# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

- **Remote arbitrary local-file-read in HTTP transport (G-1).** An
  unauthenticated caller could POST markdown containing `[x](file:///etc/passwd)`
  and the server would `stat` and upload the file to the operator's
  workspace. Closed by two changes landed together: (a) bearer-always
  authentication on `/mcp` in static-token mode and loopback-default
  bind, (b) a transport-aware gate inside `processFileUploads` plus
  the `update_page.cover` path that rejects `file://` in HTTP mode.

### Known limits (deferred to v0.3.1)

- DNS-rebinding protection is not wired on the MCP endpoint. Bearer
  is the v0.3.0 trust boundary; keep it set even on loopback.
- CORS on the OAuth endpoints (`/register`, `/token`, `/revoke`) is
  permissive.
- OAuth orphan refresh records are not cleaned up.

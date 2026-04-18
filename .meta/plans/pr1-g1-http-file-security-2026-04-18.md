# PR 1 — G-1 file:// gate + static-token HTTP auth + G-2 README note

**Date:** 2026-04-18
**Author:** planner (PM session, Claude Opus 4.7 1M)
**Branch:** `dev` (currently at `7904243`)
**Inputs:** synthesis `.meta/audits/synthesis-pre-v030-2026-04-17.md` § 6 (G-1, G-2) + § 1 C-5; audit B `.meta/audits/pre-v030-audit-b-2026-04-17.md` F-1 + F-4; frame 4 `.meta/research/frame-4-redteam-2026-04-17.md` Probe 4 #1+#4, Probe 5; frame 3 `.meta/research/frame-3-multitenant-2026-04-17.md` P4.c.
**Status after Codex review:** see appendix § 9 — both passes ran, all blockers dispositioned, plan revised inline.

This plan covers PR 1 of the v0.3.0 gate work. Scope: **G-1 (file:// gate + static-token HTTP auth) + G-2 README note only.** Other gates (G-3, G-4, G-5) and adjacent security findings (C-21 OAuth orphan refresh, F4 CORS, etc.) are explicitly out of scope.

---

## 1. Problem statement

The HTTP transport in `dev` exposes two compounded security risks that converge on a remote arbitrary local-file-read primitive (synthesis § 1 C-5; audit B F-1 + F-4):

1. **`file://` URLs in markdown are processed regardless of transport.** `processFileUploads` (`src/file-upload.ts:59-92`) is called from four content-mutating tools — `create_page` (`src/server.ts:964`), `append_content` (`:1013`), `replace_content` (`:1023`), `update_section` (`:1074`) — and reads any `file://` URL via `uploadFile` (`src/notion-client.ts:79-108`), which calls `fileURLToPath` → `stat` → `readFile` against the server's local filesystem. A separate code path at `src/server.ts:1184-1187` (`update_page.cover`) bypasses `processFileUploads` and calls `uploadFile` directly on a `file://` cover string. Stdio gating exists for the related `create_page_from_file` tool (PR #22 pattern at `:491`, `:940-945`) but was never applied to the `file://` content paths.

2. **Static-token HTTP mode mounts `/mcp` without authentication.** `src/http.ts:188-195` registers `app.post("/mcp", createSessionHandler(...))` with no middleware when `useOAuth` is false. The OAuth branch at `:173-185` correctly applies `requireBearerAuth`, but the static-token branch does not. Combined with `app.listen(PORT)` at `:220` (which omits the host argument and defaults to Express's `0.0.0.0`), any network-reachable caller can submit tool calls.

The compound: an unauthenticated network-reachable POST `/mcp` → `tools/call create_page { markdown: "[loot](file:///etc/passwd)" }` reads the file, uploads it to the operator's Notion workspace, and returns a `pages.create` URL. Any agent that can convince an LLM to pass file paths in markdown — or any direct attacker — gets host-FS confidentiality crossed into the HTTP trust boundary. This is the most serious finding in the pre-v0.3.0 audit body, converged across audit B (F-1 + F-4), frame 3 P4.c, frame 4 Probe 4 #1+#4 / Probe 5, and pass 5 BV-1+BV-2.

The runtime evidence in § 5 demonstrates the pre-fix exploit is live on `dev` today.

---

## 2. Attack surface enumeration

### 2.1 `file://` paths in the server

Verified by reading `src/file-upload.ts`, `src/server.ts`, `src/notion-client.ts`:

| # | Surface | Location | Reaches FS via |
|---|---|---|---|
| F1 | `create_page` markdown | `src/server.ts:964` | `processFileUploads` → `uploadFile` |
| F2 | `append_content` markdown | `src/server.ts:1013` | same |
| F3 | `replace_content` markdown | `src/server.ts:1023` | same |
| F4 | `update_section` markdown | `src/server.ts:1074` | same |
| F5 | `update_page.cover` string | `src/server.ts:1184-1187` | direct `uploadFile(notion, cover)` — bypasses `processFileUploads` |

Out-of-scope verifications (no additional file:// surface found):
- `create_page_from_file` (`:978`) is already stdio-gated at registration (`:491`) and does **not** call `processFileUploads` on its own file content (`:997`); it only reads the `.md` file via `readMarkdownFile` which has its own workspace-root containment. No additional gate needed.
- `find_replace` (`:1082`) bypasses the block pipeline and uses Notion's `pages.updateMarkdown` directly; no `processFileUploads` call. Out of scope.
- `duplicate_page` (`:1146`) reads source blocks from Notion and forwards to `createPage` without `processFileUploads`. Out of scope.
- `update_page.icon` is asymmetric with `cover` (audit A M3) — it does **not** accept `file://`. No fix needed for icon.

### 2.2 HTTP auth gaps

| # | Surface | Location | Risk |
|---|---|---|---|
| H1 | `/mcp` POST in static-token mode | `src/http.ts:193` | No auth middleware; any network caller |
| H2 | `/mcp` GET in static-token mode | `src/http.ts:194` | Same |
| H3 | `/mcp` DELETE in static-token mode | `src/http.ts:195` | Same |
| H4 | Listen bind | `src/http.ts:220` (`app.listen(PORT)`) | Defaults to `0.0.0.0` — confirmed at runtime in § 5 (TCP6 `::` bind) |

Out-of-scope auth surfaces (deferred per fence-offs):
- DNS rebinding via `enableDnsRebindingProtection: false` default (frame 4 Probe 5; G-2 full fix). README note only here.
- CORS open on `/register`, `/token`, `/revoke` (frame 4 #8). v0.3.1.
- OAuth orphan refresh records (synthesis C-21). v0.3.1.

---

## 3. Fix design

### 3.1 G-1a — gate `file://` behind `transport === "stdio"`

**Approach:** thread `transport` through `processFileUploads` and check inline in the `update_page.cover` branch. Reject in HTTP mode with a structured error.

**Edits:**

1. **`src/file-upload.ts`** — change signature to `processFileUploads(client, markdown, transport: "stdio" | "http")`. After detecting `realMatches.length > 0` and before the upload loop, if `transport !== "stdio"` throw `new Error(<gate-message>)`. The throw bubbles through the `try/catch` in `src/server.ts:947` and is converted to a `textResponse({ error: ... })` by `enhanceError`.

2. **`src/server.ts`** — pass `transport` (already in scope from `createServer`'s destructuring at `:886`) into all four `processFileUploads` call sites: `:964`, `:1013`, `:1023`, `:1074`.

3. **`src/server.ts:1184-1187`** (`update_page.cover` branch) — before the `if (cover?.startsWith("file://"))` branch, add:
   ```ts
   if (cover?.startsWith("file://") && transport !== "stdio") {
     return textResponse({ error: <gate-message> });
   }
   ```
   Then proceed with the existing branch when transport is stdio.

**Gate error message** (per orchestrator directive 1 + Codex Pass A — drop OAuth mention, frame on transport not auth):
> `file:// URLs are only supported in stdio transport, where the server runs on your machine. In HTTP mode, host the file at an HTTPS URL and use that instead.`

The builder may tune wording but must keep the transport-explicit framing and end with an actionable recovery clause.

**Why this shape over alternatives:**
- *Strip silently from markdown* — rejected. Silent drops are exactly the silent-failure pattern audit B and frame 5 flag elsewhere; failing loudly is correct.
- *Gate the four tool handlers individually* — rejected. Five sites would duplicate the check and miss the next tool that calls `processFileUploads`. Threading the transport through the function keeps the gate at the chokepoint.
- *Make `processFileUploads` always-strip in HTTP mode and only error if non-strip-safe content surfaces* — rejected. Silent strip changes content semantics; reject-and-explain is the user-friendlier path.

### 3.2 G-1b — static-token HTTP auth + bind (revised after Codex Pass A)

**Bearer-always shape** (revised from hybrid after Codex Pass A; rationale in § 3.3):

1. **Default bind:** `127.0.0.1`. Bind host configurable via `NOTION_MCP_BIND_HOST` env (e.g., `0.0.0.0` for all interfaces, `192.168.1.5` for one-interface pinning). In `src/http.ts:220`:
   ```ts
   const bindHost = process.env.NOTION_MCP_BIND_HOST ?? "127.0.0.1";
   app.listen(PORT, bindHost, () => {
     console.error(`easy-notion-mcp HTTP server listening on ${bindHost}:${PORT}`);
   });
   ```
2. **Bearer required in static-token mode regardless of bind:** at `createApp` startup, if `useOAuth === false` (static-token mode), require `process.env.NOTION_MCP_BEARER` to be a non-empty string. If missing, throw at construction time with a clear error mentioning `NOTION_MCP_BEARER` and pointing at the README HTTP-security section.
3. **Bearer middleware in static-token mode:** mount a small middleware on `/mcp` POST/GET/DELETE that compares the `Authorization: Bearer <token>` header against the env value via `crypto.timingSafeEqual`. Length-mismatch path returns 401 without timing-side-channel. Returns 401 with `{ error: "invalid_token", error_description: "Missing or invalid bearer" }` on failure. Always mounted in static-token mode.
4. **OAuth mode unchanged.** OAuth's `requireBearerAuth` middleware path at `:173-185` is untouched. Bearer-always requirement does NOT apply to OAuth mode (which has its own bearer enforcement). OAuth users do not need to set `NOTION_MCP_BEARER`.
5. **`createApp` API surface:** add optional `bindHost: string | undefined` and required-when-static `bearer: string | undefined` to `CreateAppOptions`. `startServer` reads them from env and passes through. Tests construct `createApp({ notionToken, bearer: "secret" })` for the basic static-token path, `createApp({ notionToken })` (no bearer) to assert the construction-time throw.

**Failure-mode matrix after the fix** (static-token HTTP mode):

| Env | Bind | Bearer required? | `/mcp` reachable |
|---|---|---|---|
| `NOTION_TOKEN` only, no bearer | — | — | refuses to start |
| `NOTION_TOKEN` + `BEARER=x` | `127.0.0.1` (default) | yes | localhost callers with valid bearer |
| `NOTION_TOKEN` + `BEARER=x` + `BIND_HOST=0.0.0.0` | `0.0.0.0` | yes | network callers with valid bearer |
| `NOTION_TOKEN` + `BEARER=x` + `BIND_HOST=192.168.1.5` | one interface | yes | network callers on that interface with valid bearer |

OAuth mode: bind also defaults to `127.0.0.1`; users can set `BIND_HOST=0.0.0.0` for remote OAuth. No `BEARER` env required (OAuth supplies its own).

### 3.3 Auth shape rationale (revised after Codex Pass A)

**Bearer-always (chosen):** require `NOTION_MCP_BEARER` in any static-token HTTP mode regardless of bind.

**Why this overrides the originally-proposed hybrid (default loopback + opt-in bearer):**

The hybrid relied on loopback bind being a sufficient security boundary for the no-bearer case. Codex Pass A surfaced the load-bearing counterargument: **loopback is not a hard boundary in v0.3.0** because the DNS-rebinding fix (synthesis G-2 full fix) is explicitly deferred to v0.3.1. Until host-header validation is wired (`enableDnsRebindingProtection` is false by default in `@modelcontextprotocol/sdk@1.29.0` per frame 4 Probe 5, and our custom Express app doesn't apply the SDK's `localhostHostValidation()` middleware), a malicious website the user visits in their browser can rebind a controlled DNS name to `127.0.0.1` and POST to `/mcp` with a `Host: attacker.example` header. Loopback bind doesn't stop this attack. Bearer-always does.

Plus the multi-user-localhost case (other local user / sudo helpdesk / sandboxed-but-escaped malware → `curl localhost:3333/mcp`) is real even after G-2 lands. Bearer-always defends both classes for the cost of one env var in the docs.

The ergonomic argument for hybrid (one env vs two for the localhost happy-path) is genuine but small. The fix specifically addresses a security-critical gate in v0.3.0 where ergonomics shouldn't trump security. Postgres, Redis with `requirepass`, Jupyter notebook tokens, and JupyterLab's `--token=` random all default to requiring auth even on localhost, for the same reasons. easy-notion-mcp's static-token HTTP mode joins them.

OAuth mode keeps its existing `requireBearerAuth` enforcement and does NOT require an additional `NOTION_MCP_BEARER` env (per Codex Pass A; OAuth's bearer comes from the OAuth code-exchange flow).

### 3.4 Flag-name pick (resolved by Codex Pass A)

`NOTION_MCP_BIND_HOST` chosen. Per Codex Pass A: describes the actual mechanism instead of smuggling policy into a boolean; scales to interface pinning (`192.168.1.5`) instead of forcing a binary choice between `127.0.0.1` and `0.0.0.0`. Now that bearer is decoupled from bind (bearer-always in static-token mode), the original `ALLOW_REMOTE` framing baked in a security story that no longer fits — `BIND_HOST` is policy-neutral and lets the security boundary live in the bearer requirement instead.

### 3.5 Tool-description updates (added after Codex Pass A)

After the file:// gate, two tool descriptions in `src/server.ts` become misleading in HTTP mode and must be updated. HTTP clients discover capability via `tools/list`; if the descriptions advertise `file://` upload, agents in HTTP mode will try it and hit the new gate error.

| Location | Current text fragment | Update |
|---|---|---|
| `src/server.ts:443` (`create_page` description) | mentions `file:///path` upload as a capability | append explicit "stdio transport only" caveat for the `file://` capability; HTTP callers should use HTTPS URLs |
| `src/server.ts:581` (`update_page.cover` argument description) | accepts `file://` cover | same "stdio transport only" caveat for the `file://` form |

Builder may either (a) hard-code the caveat in the description string, or (b) make the description transport-aware by branching on the `transport` config in the tool registration loop. (a) is simpler and ships the same information to both transports without a runtime branch — preferred unless the builder identifies a strong reason for (b). Either way, the description must accurately convey "file:// works only over stdio" to any client that reads `tools/list`.

---

## 4. Test plan

TDD per project learning [e9dcf6]: write failing tests, observe failure, then implement. Tests assert observable behavior, not internal config state.

### 4.1 New test file: `tests/http-file-upload-gate.test.ts`

Pattern after `tests/create-page-from-file.test.ts` — uses `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js` to drive the MCP server in-process. Mocks `uploadFile` from `src/notion-client.ts` to confirm it is NOT called when the gate fires.

| # | Test | Pre-fix expected | Post-fix expected |
|---|---|---|---|
| FU-1 | HTTP `create_page` with `[x](file:///tmp/x.png)` | `uploadFile` called → fails on Notion or stat | error response containing gate phrase ("only supported in stdio transport"); `uploadFile` mock not called |
| FU-2 | HTTP `append_content` with `[x](file:///tmp/x.png)` | same | same |
| FU-3 | HTTP `replace_content` with `[x](file:///tmp/x.png)` | same | same |
| FU-4 | HTTP `update_section` with `[x](file:///tmp/x.png)` | same | same |
| FU-5 | HTTP `update_page` with `cover: "file:///tmp/cover.png"` | `uploadFile` called | error response containing gate phrase; `uploadFile` mock not called |
| FU-6 | HTTP `create_page` with `[x](https://example.com/img.png)` | success | success unchanged (https URLs untouched by the gate) |
| FU-7 | HTTP `create_page` with `[x](file:///tmp/x.png)` inside ` ``` ` fence | filtered by `getCodeRanges` → no upload, no gate fire | unchanged: filtered, success (gate only fires on real matches outside code) |
| FU-8 | Stdio `create_page` with `[x](file:///tmp/x.png)` | upload attempted | upload still attempted (gate only fires for HTTP transport) |
| FU-9 | Stdio `update_page.cover` with `file://...` | upload attempted | upload still attempted |
| FU-10 | HTTP `create_page` with multiple file:// (`[a](file:///p1.png)\n[b](file:///p2.png)`) | first upload attempted | gate fires once; `uploadFile` mock called zero times (no partial uploads) |
| FU-11 | HTTP `create_page` with plain-text `file://` outside markdown link syntax (`# Heading\n\nfile:///tmp/x.png is not a link`) | regex doesn't match → no upload, no gate fire | unchanged: success (regex semantics preserved) |
| FU-12 | HTTP tool description for `create_page` | mentions file:// without caveat | description text contains stdio-only caveat (per § 3.5) |
| FU-13 | HTTP tool description for `update_page.cover` argument | mentions file:// without caveat | description text contains stdio-only caveat |

FU-1 through FU-5 + FU-10 are the failing tests that turn green only after the fix. FU-12 + FU-13 (per Codex Pass A) lock in the description-accuracy fix. FU-6 + FU-7 + FU-8 + FU-9 + FU-11 are regression-guards.

**Behavioral assertions only.** Tests check `parseToolText(result)` includes the gate phrase or `tools[i].description` contains the caveat. The `uploadFile` not-called assertion is a side-effect guard that supplements (not replaces) the response/description assertion (per Codex Pass B — keep it, but as secondary). Tests do NOT assert internal flags or the `transport` argument's value.

### 4.2 Additions to `tests/http-transport.test.ts`

Restructured per Codex Pass A (bearer-always, no `allowRemote` framing) + Pass B (add GET/DELETE auth coverage):

| # | Test | Pre-fix expected | Post-fix expected |
|---|---|---|---|
| AU-1 | `createApp({ notionToken: "x" })` (no bearer) in static-token mode | succeeds | throws at construction with error mentioning `NOTION_MCP_BEARER` |
| AU-2 | `createApp({ notionToken: "x", bearer: "secret" })` then POST `/mcp` no Authorization header | 200 | 401 with body `{ error: "invalid_token", ... }` |
| AU-3 | Same app, POST `/mcp` with `Authorization: Bearer wrong` | 200 | 401 |
| AU-4 | Same app, POST `/mcp` with `Authorization: Bearer secret` | 200 | 200 (initialize succeeds) |
| AU-5 | Same app, **GET** `/mcp` no Authorization | 400 (no session) | 401 (auth checked before session lookup) |
| AU-6 | Same app, **DELETE** `/mcp` no Authorization | 400 (no session) | 401 (auth checked before session lookup) |
| AU-7 | OAuth-mode `createApp({ oauthClientId, oauthClientSecret })` — no `bearer` env required | constructs OK | constructs OK (bearer-always rule does NOT apply to OAuth) |
| AU-8 | OAuth-mode existing test at `tests/http-transport.test.ts:209-226` ("POST /mcp without auth returns 401") | 401 | 401 (regression guard) |

**Bind-host test (BH-1) — Shape B chosen** (per Codex Pass B):

Spawn a server with `app.listen(0, bindHost)` (port 0 lets OS pick a free port; avoids collisions in CI), then assert `server.address().address` equals `"127.0.0.1"` (default) or `"0.0.0.0"` (when `NOTION_MCP_BIND_HOST=0.0.0.0` set in the env passed to `startServer` or to the helper that resolves bind config).

**Reasoning:** the bug class is "we resolved the right host string but forgot to thread it into `listen()`." Shape A (test a pure helper that returns the host string) would not catch that. Shape B verifies the actual `listen()` invocation. Codex Pass B confirmed Node returns the requested host accurately for `127.0.0.1` and `0.0.0.0`.

**Implementation note:** to make this testable, extract a small helper from `startServer` — e.g., `getBindHost(env: NodeJS.ProcessEnv): string` — exported from `src/http.ts`. The helper is the source of truth for the resolved value; the test calls `app.listen(0, getBindHost(testEnv))` then asserts `server.address().address`. Don't test the helper alone (Pass A's option); test the helper + listen integration in one go (Shape B).

| # | Test | Assertion |
|---|---|---|
| BH-1a | Default env (no `NOTION_MCP_BIND_HOST` set) | `server.address().address` is `"127.0.0.1"` |
| BH-1b | `NOTION_MCP_BIND_HOST=0.0.0.0` | `server.address().address` is `"0.0.0.0"` |
| BH-1c | `NOTION_MCP_BIND_HOST=127.0.0.1` (explicit loopback) | `server.address().address` is `"127.0.0.1"` |

### 4.3 Tests confirmed unchanged or requiring mechanical updates

- **`tests/http-transport.test.ts:36-181` (existing Static Token Mode block):** these tests construct `createApp({ notionToken: "ntn_fake_token_for_testing" })` without a bearer. Under bearer-always, that construction now throws. **The tests require update**: pass `bearer: "test-bearer"` and add `Authorization: Bearer test-bearer` to every `/mcp` request. This is mechanical; the assertions (27 tools, init succeeds, GET/DELETE no-session 400s) are preserved. Builder must update these in lockstep with the implementation.
- **`tests/create-page-from-file.test.ts` — entirely unaffected** (different gate at registration time, different tool).
- **`tests/file-upload.test.ts` — mechanical signature update.** Current tests call `processFileUploads(client, markdown)`. The fix adds a third `transport: "stdio" | "http"` arg. Existing tests must pass `transport: "stdio"` to preserve their stdio-semantics contract. Confirmed by Codex Pass B as the right shape (no need to split the file — the new HTTP-rejected behavior lives in the new `tests/http-file-upload-gate.test.ts`).

---

## 5. Runtime evidence (pre-fix, captured 2026-04-18)

Goal per orchestrator directive 2: prove the exploit is live on current `dev` (`7904243`) today.

### 5.1 Probe environment

- Branch: `dev` at `7904243`
- Build: `npm run build` (clean, no output)
- Server: `node dist/http.js` started in static-token mode with `NOTION_TOKEN` from `.env`, no OAuth env vars (forced via `env -i`)
- Port: 3334 (to avoid collision with any running dev instance)
- Run cwd: `/tmp` (to bypass `dotenv/config` autoload of repo `.env` which would otherwise pull in OAuth client id/secret and force OAuth mode)

### 5.2 Bind address

```
$ awk 'NR>1 {laddr=$2; split(laddr,a,":"); port=strtonum("0x" a[2]); if (port==3334) print "v6 local="a[1]" port="port" state="$4}' /proc/net/tcp6
v6 local=00000000000000000000000000000000 port=3334 state=0A
```

Bind address is `::` (IPv6 wildcard, dual-stack covers IPv4) — confirms F4 Probe 4 #1 (`app.listen(PORT)` defaults to all interfaces). State `0A` = LISTEN.

Server boot log:
```
Static token mode (NOTION_TOKEN)
easy-notion-mcp HTTP server listening on port 3334
```

### 5.3 Unauth `/mcp` initialize succeeds

```
$ curl -s -i -X POST http://127.0.0.1:3334/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'

HTTP/1.1 200 OK
mcp-session-id: 49311f28-29f3-470d-9413-25c6eec13d39
content-type: text/event-stream

event: message
data: {"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"easy-notion-mcp","version":"0.2.0"}},"jsonrpc":"2.0","id":1}
```

200 with no `Authorization` header. Session id allocated. No bearer challenge. Confirms F-4: static-token mode mounts `/mcp` without auth.

### 5.4 Unauth caller reaches host filesystem (file:// → stat)

After `notifications/initialized` (HTTP/1.1 202 Accepted), called `tools/call` with a non-existent path so the failure mode is unambiguously filesystem-side:

```
$ curl -s -X POST http://127.0.0.1:3334/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: 49311f28-29f3-470d-9413-25c6eec13d39" \
    -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_page","arguments":{"title":"x","markdown":"[x](file:///tmp/nope-does-not-exist-2026-04-18.png)"}}}'

event: message
data: {"result":{"content":[{"type":"text","text":"{\"error\":\"ENOENT: no such file or directory, stat '/tmp/nope-does-not-exist-2026-04-18.png'\"}"}]},"jsonrpc":"2.0","id":4}
```

`ENOENT … stat '/tmp/nope-does-not-exist-2026-04-18.png'` — that error string originates from `await stat(filePath)` at `src/notion-client.ts:84`, which is inside `uploadFile`, which was called from `processFileUploads` after the path was extracted from `[x](file://...)`. The unauthenticated network caller reached the server's local `stat()` syscall. Smoking gun for fs reach via the markdown content path.

If the file existed and had a recognized extension (e.g., `.txt`, `.md`, `.png`), `uploadFile` would proceed to `readFile` (`:94`) and forward the bytes to Notion's `fileUploads.send` (`:97`). PROBE 4 with `file:///etc/hostname` showed Notion rejecting on extension (`Provided 'filename' has an extension that is not supported for the File Upload API`) — that error came from Notion's API, which means the local file path was processed and an upload was attempted server-side.

### 5.5 Same ENOENT via `update_page.cover` (separate code path)

```
$ curl -s -X POST http://127.0.0.1:3334/mcp ... -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"update_page","arguments":{"page_id":"00000000-0000-0000-0000-000000000000","cover":"file:///tmp/nope-does-not-exist-cover-2026-04-18.png"}}}'

event: message
data: {"result":{"content":[{"type":"text","text":"{\"error\":\"ENOENT: no such file or directory, stat '/tmp/nope-does-not-exist-cover-2026-04-18.png'\"}"}]},"jsonrpc":"2.0","id":6}
```

Confirms the second code path (F5 in § 2.1) — `update_page.cover` — also reaches `stat()` server-side. The `cover` branch at `src/server.ts:1184-1187` calls `uploadFile(notion, cover)` directly without going through `processFileUploads`, so it needs its own gate (covered in § 3.1 step 3).

### 5.6 Cleanup

- Server killed (`pkill -f 'dist/http.js'`).
- Probe fixture files removed (`/tmp/fake-host-secret.txt`, `/tmp/secret-fake.md`).
- No Notion pages created (PROBE 4 errored at file-upload extension check before page creation; PROBE 5 with valid extension errored at parent-page authorization 403; PROBE 7 with bad page_id errored at "Invalid request URL"). No Notion-side cleanup needed.

### 5.7 Post-fix expected behavior (to be re-run after the builder lands the fix)

| Probe | Pre-fix | Post-fix expected |
|---|---|---|
| GET / | 200 | 200 (unchanged) |
| Bind addr default | `::` (all interfaces) | `127.0.0.1` (loopback only by default) |
| Bind addr with `NOTION_MCP_BIND_HOST=0.0.0.0` | n/a | `::` or `0.0.0.0` (network-reachable) |
| `node dist/http.js` with `NOTION_TOKEN` only (no bearer) | starts on `0.0.0.0` | refuses to start; error mentions `NOTION_MCP_BEARER` required |
| `NOTION_TOKEN + NOTION_MCP_BEARER=s` POST `/mcp` no Authorization | 200 | 401 with `{ error: "invalid_token", ... }` |
| Same, POST `/mcp` with `Authorization: Bearer s` (correct) | 200 | 200; initialize succeeds |
| Same, GET `/mcp` no Authorization | 400 (no session) | 401 (auth checked first) |
| Same, DELETE `/mcp` no Authorization | 400 (no session) | 401 (auth checked first) |
| `create_page` with `file:///tmp/...` (after auth) | reaches `stat()` | error containing `only supported in stdio transport` and `HTTPS URL`; `stat()` not reached |
| `update_page.cover` with `file://` (after auth) | reaches `stat()` | same gate error |
| OAuth mode `node dist/http.js` (no `NOTION_MCP_BEARER` set) | starts; `/mcp` requires OAuth bearer | starts; bearer-always rule does NOT apply to OAuth (regression guard) |

### 5.8 Reproducer script for the orchestrator

Save as `.meta/plans/pr1-probe.sh` (uncommitted, planner provides it for orchestrator). Hardened per Codex Pass B (trap cleanup, readiness polling, dynamic port, env validation):

```bash
#!/usr/bin/env bash
set -euo pipefail

# Repo root
REPO=$(git rev-parse --show-toplevel)
cd "$REPO"

# Validate env
if [[ ! -f .env ]] || ! grep -q '^NOTION_TOKEN=' .env; then
  echo "ERROR: .env missing or NOTION_TOKEN not set in .env" >&2
  exit 2
fi
NOTION_TOKEN_VAL=$(grep '^NOTION_TOKEN=' .env | cut -d= -f2-)
ABS=$(realpath dist/http.js)

# Pick a free port (avoid 3333/3334 collisions with running dev servers)
PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')
echo "Using ephemeral PORT=$PORT"

# Build
npm run build > /dev/null
echo "Build OK"

# Launch server in /tmp (bypass dotenv autoload of repo .env that would force OAuth mode)
LOGFILE=$(mktemp /tmp/probe.log.XXXXXX)
PIDFILE=$(mktemp /tmp/probe.pid.XXXXXX)
( cd /tmp && env -i HOME="$HOME" PATH="$PATH" PORT="$PORT" NOTION_TOKEN="$NOTION_TOKEN_VAL" node "$ABS" > "$LOGFILE" 2>&1 ) &
SERVER_PID=$!
echo "$SERVER_PID" > "$PIDFILE"

# Cleanup trap: kill server + remove temp files on any exit (success, error, ctrl-c)
cleanup() {
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  rm -f "$LOGFILE"
}
trap cleanup EXIT INT TERM

# Readiness poll (don't sleep blindly — wait until /  responds 200)
for i in {1..20}; do
  if curl -fsS "http://127.0.0.1:$PORT/" > /dev/null 2>&1; then
    echo "Server ready on port $PORT"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo "ERROR: server failed to come up. Log:" >&2
    cat "$LOGFILE" >&2
    exit 3
  fi
  sleep 0.5
done

echo "--- bind ---"
awk 'NR>1 {laddr=$2; split(laddr,a,":"); port=strtonum("0x" a[2]); if (port=='"$PORT"') print laddr" state="$4}' /proc/net/tcp /proc/net/tcp6 2>/dev/null

echo "--- initialize (no Authorization) ---"
INIT=$(curl -fsS -i -X POST "http://127.0.0.1:$PORT/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' || true)
echo "$INIT"
SESSION=$(echo "$INIT" | tr -d '\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}' | head -1)

if [[ -n "$SESSION" ]]; then
  curl -fsS -X POST "http://127.0.0.1:$PORT/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SESSION" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null
  echo "--- file:// reach via processFileUploads (expect ENOENT pre-fix, gate phrase post-fix) ---"
  curl -sS -X POST "http://127.0.0.1:$PORT/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SESSION" \
    -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_page","arguments":{"title":"probe","markdown":"[x](file:///tmp/nope-does-not-exist-probe.png)"}}}'
  echo
  echo "--- file:// reach via update_page.cover (separate code path) ---"
  curl -sS -X POST "http://127.0.0.1:$PORT/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SESSION" \
    -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"update_page","arguments":{"page_id":"00000000-0000-0000-0000-000000000000","cover":"file:///tmp/nope-does-not-exist-cover.png"}}}'
  echo
else
  echo "(initialize did not return a session id — probably post-fix bearer-required path)"
  echo "--- retry initialize with bearer ---"
  if [[ -n "${NOTION_MCP_BEARER:-}" ]]; then
    curl -fsS -i -X POST "http://127.0.0.1:$PORT/mcp" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -H "Authorization: Bearer $NOTION_MCP_BEARER" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
  else
    echo "(set NOTION_MCP_BEARER to retry post-fix probe)"
  fi
fi

# trap handles cleanup
```

Reproducible by orchestrator in <5 minutes against any branch (dev for pre-fix, builder branch for post-fix). Requires `NOTION_TOKEN` in `.env` (not used for any successful Notion operation in the probe — only for server boot). For post-fix re-run, set `NOTION_MCP_BEARER` in the calling shell to verify the bearer path; the script auto-detects which mode it's running against by whether initialize gives a session id.

---

## 6. README note (G-2 placeholder)

**Placement:** insert a new section `### HTTP mode security posture` **after** the existing `### OAuth / HTTP transport` section in `README.md` (currently ends around line 388, before `## What about security and prompt injection?` at line 390). This keeps the security posture next to the env-var docs that govern it.

**Builder must draft, not planner. Required content (specify, don't write):**

1. **Static-token HTTP mode requires a bearer.** State that `node dist/http.js` / `npx easy-notion-mcp-http` with only `NOTION_TOKEN` set will refuse to start in v0.3.0; users must also set `NOTION_MCP_BEARER=<secret>` and configure their MCP client to send `Authorization: Bearer <secret>` on every `/mcp` request. Reasoning: localhost is not assumed to be a sufficient trust boundary in v0.3.0 (DNS-rebinding fix lands in v0.3.1).
2. **Default bind is `127.0.0.1`.** Document that the server binds loopback by default and that `NOTION_MCP_BIND_HOST=0.0.0.0` (or a specific interface like `192.168.1.5`) opens up remote reachability. Bearer is required regardless of bind in static-token mode.
3. **HTTP mode is designed for trusted networks.** Even with bearer set, this is not hardened for hostile-internet exposure. Specifically call out that **DNS-rebinding protection is not yet wired up** (synthesis G-2 full fix lands in v0.3.1) and CORS policy is permissive on OAuth endpoints. Recommend running behind a reverse proxy with TLS for any remote exposure.
4. **OAuth mode is the recommended posture for multi-user / remote deployments.** OAuth has its own bearer enforcement; the `NOTION_MCP_BEARER` env is not required for OAuth mode. Static-token + bearer is intended for single-operator self-hosting; OAuth's per-user identity model is the right shape for shared deployments.
5. **`file://` uploads are stdio-only.** Mention that markdown content with `file://` URLs is rejected over HTTP and direct users to stdio mode for local-file workflows. Cross-link to `create_page_from_file` (also stdio-only).

Add new env vars to the table in `### OAuth / HTTP transport` (lines 379-384):

| `NOTION_MCP_BIND_HOST` | No | `127.0.0.1` | Bind address. Default is loopback; set `0.0.0.0` for network-reachable, or a specific interface like `192.168.1.5`. |
| `NOTION_MCP_BEARER` | Yes (static-token) | — | Bearer token required by clients in static-token HTTP mode. Server refuses to start without it. Not required in OAuth mode. |

Update tone to match the existing measured prose; no marketing.

---

## 7. Risk + tradeoff analysis

### 7.1 Behavior changes for current users

| User flow | Before PR 1 | After PR 1 (bearer-always) |
|---|---|---|
| Stdio `create_page` with `file:///path/to/img.png` in markdown | Works | Works (no change) |
| HTTP `create_page` with `file:///path/to/img.png` in markdown | Reads + uploads | Errors with gate message |
| HTTP `update_page` with `cover: "file:///..."` | Reads + uploads | Errors with gate message |
| `npx easy-notion-mcp-http` with only `NOTION_TOKEN` set (static-token, no bearer) | Boots; binds `0.0.0.0`; `/mcp` open to network | **Refuses to start** with error mentioning `NOTION_MCP_BEARER` |
| Same with `NOTION_MCP_BEARER=secret` set | n/a | Boots; binds `127.0.0.1`; `/mcp` requires `Authorization: Bearer secret` |
| Same with `NOTION_MCP_BEARER=secret` + `NOTION_MCP_BIND_HOST=0.0.0.0` | n/a | Boots; binds all interfaces; `/mcp` requires bearer |
| Dify/n8n/FlowiseAI in Docker with `host.docker.internal` (README:177-189) | Works without auth | Breaks — host needs `BEARER + BIND_HOST=0.0.0.0`; client needs to send `Authorization` header |
| OAuth-mode `npx easy-notion-mcp-http` with OAuth client id/secret | Works | Works (no change; bearer-always rule does NOT apply to OAuth) |

The Dify/Docker case is the most visible current-user-facing break. README:189 currently says "Why not localhost? These platforms typically run in Docker. `localhost` inside a container refers to the container itself, not your host machine." That section needs an update.

### 7.2 Migration notes for the README

The Docker section (README:177-189) needs a paragraph after the existing block explaining that as of v0.3.0:

1. The host machine running `npx easy-notion-mcp-http` in static-token mode needs:
   - `NOTION_MCP_BIND_HOST=0.0.0.0` so `host.docker.internal` can reach the bridge IP, AND
   - `NOTION_MCP_BEARER=<secret>` for the new bearer requirement.
2. The MCP client (Dify/n8n/etc.) must be configured to send `Authorization: Bearer <secret>` on every request — most platforms expose this via a "headers" or "auth" config block.
3. OAuth mode (no bearer env needed; bearer is OAuth-issued per request) is the recommended alternative for shared deployments.

### 7.3 Backward-compat

- `processFileUploads`'s signature change is internal to the package; not part of any public export per `package.json` "exports" (verify in builder pre-flight). No downstream consumer breakage.
- `createApp` gains optional `bindHost` and effectively-required-for-static `bearer` options. **Existing test calls `createApp({ notionToken: ... })` will throw at construction post-fix.** Tests must be updated to pass `bearer: "..."`. This is mechanical (per § 4.3) but is a real test-file change.
- `CreateAppOptions` interface gains two new fields. TypeScript consumers of `createApp` (third-party embedders) get a compile-time signal of the new requirement via the changed runtime contract; no type-level breakage but a runtime surprise if they don't read the changelog. Document prominently in `CHANGELOG.md` if the project adopts one in this PR (out of scope here; recommended for builder).
- **The `npx easy-notion-mcp-http` no-arg static-token boot path is a behavior break**, not a bug. This is the change CHANGELOG must call out as the headline migration step.

### 7.4 What this does NOT fix (deferred to v0.3.1 or later, per fence-offs)

- DNS rebinding (frame 4 Probe 5) — README note only here, full wire-up in G-2.
- CORS-open OAuth endpoints (frame 4 #8) — v0.3.1.
- OAuth orphan refresh records (synthesis C-21) — v0.3.1.
- `http://` redirect_uris on `/register` (frame 4 #3) — v0.3.1.
- Token store concurrency / atomic writes (synthesis C-8) — v0.3.x.
- Read-path URL sanitizer bypass (frame 4 Probe 1) — v0.3.x.

---

## 8. Builder briefing checklist

When the orchestrator dispatches the builder, the brief must include:

1. This plan as primary input.
2. **TDD requirement** (per learning [e9dcf6]): write failing tests first per § 4, observe failure with output captured to the PR description, then implement.
3. **Pre-flight verifications:** check `package.json` "exports" to confirm `processFileUploads` is not a public export; check that no other code in `src/` or `tests/` calls `processFileUploads` with the old signature beyond the four sites listed in § 3.1.
4. **Probe re-run:** after implementation, run `.meta/plans/pr1-probe.sh` against the builder's branch and capture output to PR description showing post-fix behavior matches § 5.7.
5. **README draft** per § 6 specifications.
6. **Scope discipline:** PR 1 is G-1 + G-2 README note only. Do not bundle other gates or adjacent fixes.
7. **No bypass of failing tests / no `--no-verify`** per CLAUDE.md commit safety.
8. **Notion test cleanup:** if any runtime probes create pages, archive them to a containment parent and report the parent ID.
9. **Self-servable error text:** every user-facing error introduced by this PR must contain enough information for an agent (or human) hitting it to recover without reading source code. Specifically:
   - The **bearer-missing startup error** must include (a) the env var name `NOTION_MCP_BEARER`, (b) a one-line example of setting it (e.g., `export NOTION_MCP_BEARER=$(openssl rand -hex 32)`), and (c) a reference to the README section for full context.
   - The **file:// gate error** (already specified in § 3.1) must keep its actionable-recovery clause ("Use stdio transport for local files, or reference the file via HTTPS URL").
   - The **bind-host/bearer combination errors** (static-token without bearer, OAuth+BEARER conflict) must name which env vars are involved and what the correct combination is.

Principle: an agent reading the error in `stderr` should not need to open a browser or read source to understand what to set. Errors are the primary doc for agents.

---

## 9. Codex review appendix

### 9.1 Pass A — fix design adversarial review

- **Session name:** `pr1-codex-pass-a-fix-design`
- **Session ID:** `019d9f83-a761-7c43-af93-9897a4f98c57`
- **Model:** codex-5.3, reasoningEffort: high
- **Prompt summary:** asked Codex to (a) attack the fix design for missed file:// surfaces and bypass paths, (b) defend the hybrid bind+bearer shape against the steelmanned bearer-always alternative I provided, (c) bikeshed the env var name, (d) flag any other load-bearing items.
- **Outcome:** Codex found no missed file:// surfaces (confirmed plan's enumeration of 5 sites). On the auth shape, Codex flipped to bearer-always with a sharp DNS-rebinding-deferral argument that I had not made strongly enough in my own steelman. On the bikeshed, Codex picked `NOTION_MCP_BIND_HOST` for mechanism-over-policy reasons. Codex also surfaced a load-bearing item the plan had missed: tool descriptions in `src/server.ts:443` and `:581` advertise `file://` upload and would lie to HTTP clients post-fix.

### 9.2 Pass B — test plan + probe review

- **Session name:** `pr1-codex-pass-b-tests-probe`
- **Session ID:** `019d9f88-2c4a-71a0-83a1-90872d544181`
- **Model:** codex-5.3, reasoningEffort: high
- **Prompt summary:** asked Codex to (a) judge whether tests assert behavior vs implementation shape, (b) pick between bind-host test Shape A (refactor + assert) and Shape B (live integration), (c) verify the probe script and identify missed edge cases, (d) confirm the existing `tests/file-upload.test.ts` mechanical update is right, (e) flag other load-bearing test items.
- **Outcome:** Codex confirmed tests are behavior-asserting (mock-based "uploadFile not called" is acceptable as secondary side-effect guard). Picked Shape B for BH-1 because the bug class is "we forgot to thread bind into listen()" — a pure helper test wouldn't catch that. Confirmed PROBE 6/8 inferences (ENOENT can only be from `stat` in `uploadFile`). Flagged missing tests: multiple-file:// payload, plain-text file:// negative, GET/DELETE auth coverage. Flagged probe script sharp edges: hardcoded port, blind sleep, no trap, no readiness poll. Confirmed `tests/file-upload.test.ts` mechanical update is correct (no need to split).

### 9.3 Iteration log — feedback disposition

| # | Pass | Item | Disposition | Plan section affected |
|---|---|---|---|---|
| 1 | A | No missed file:// surfaces in repo; library `createServer(transport)` is host-trust but no in-repo bypass | accepted as confirmation | § 2.1 (no change needed) |
| 2 | A | URL-encoded `file%3A%2F%2F` not matched by regex; not a bypass | accepted | added FU-11 (plain-text negative) and Pass B's regex-no-match acknowledgment in § 4.1 |
| 3 | A | **Flip to bearer-always** for static-token HTTP — DNS rebinding deferred to G-2 v0.3.1 makes loopback insufficient | **accepted** | § 3.2, § 3.3 fully rewritten; failure-mode matrix updated; § 4.2 restructured (AU-1..AU-8); § 5.7 + § 6 + § 7 updated |
| 4 | A | Pick `NOTION_MCP_BIND_HOST` over `ALLOW_REMOTE` (mechanism over policy; allows interface pinning) | **accepted** | § 3.4 |
| 5 | A | Tool descriptions at `src/server.ts:443` (`create_page`) and `:581` (`update_page.cover`) advertise file:// — must update | **accepted** | new § 3.5 added; FU-12 + FU-13 added to § 4.1 |
| 6 | A | Gate error message — drop OAuth mention; transport-explicit framing | **accepted** | § 3.1 message revised |
| 7 | A | Bind-host test: cleaner refactor is exported pure helper + unit test (Shape A variant) | **rejected in favor of Pass B's Shape B** | see disposition #9 |
| 8 | A | OAuth fail-fast on missing bearer should NOT apply (OAuth has its own auth) | **accepted** | § 3.2 step 2 + AU-7 explicit regression guard |
| 9 | B | Bind-host test: pick Shape B (live `app.listen(0, bindHost)` + `server.address()`) — bug class is "forgot to pass to listen()", helper-only test misses it | **accepted** (overrides Pass A's #7) | § 4.2 BH-1a/b/c |
| 10 | B | Tests are mostly behavior-asserting; mock-based negative side-effect guards are OK as secondary | accepted as confirmation | § 4.1 prose updated |
| 11 | B | Add multiple-file:// test (proves "reject once, no partial uploads") | **accepted** | FU-10 |
| 12 | B | Add plain-text file:// no-fire test (regex negative) | **accepted** | FU-11 |
| 13 | B | Add GET + DELETE auth tests in static-token mode | **accepted** | AU-5, AU-6 |
| 14 | B | `tests/file-upload.test.ts` mechanical update is correct (no need to split) | accepted as confirmation | § 4.3 |
| 15 | B | Probe script needs: trap cleanup, readiness polling, dynamic port, env validation | **accepted** | § 5.8 fully rewritten |
| 16 | B | PROBE 6/8 ENOENT inference is correct (stat in uploadFile is the only source) | accepted as confirmation | § 5.4 + § 5.5 (no change needed) |
| 17 | B | URL-encoded variants: not in regex today, not a bypass; worth a test (not a runtime probe) | **accepted** (covered by FU-11) | § 4.1 |
| 18 | B | `replace_content` and `update_section` runtime probes deferred to test suite (FU-3, FU-4 cover them) | accepted as scope | § 5 |

**No outstanding blockers from Codex.** Both passes pushed back substantively (Pass A flipped the auth shape; Pass B reshaped tests + hardened the probe script). All blockers resolved per the table above. The plan is ready for orchestrator screen + builder dispatch.

**Press-test:** the orchestrator directed me to press hard if Codex agreed without pushback. Pass A disagreed in the OPPOSITE direction from my steelman (I steelmanned bearer-always, expecting Codex to defend hybrid; Codex flipped to bearer-always). I considered re-pressing in defense of hybrid, but Codex's argument (DNS rebinding deferred → loopback is not a hard boundary in v0.3.0) is load-bearing and grounded in our own deferral decision. Pressing further would be defending the original choice for the sake of defending it, not for substantive reasons. The plan adopts Codex's recommendation.

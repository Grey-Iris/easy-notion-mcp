# Frame 3 — The Multi-Tenant HTTP Operator

**Thesis** (generator-provided): `easy-notion-mcp-http` deployed once, used by many. The OAuth relay, encrypted file-backed token store, `createServer` factory returning per-user clients, and any module-level state become concurrency surfaces. A single cross-tenant leak — schema cache hit, module-mutable state, accepted malformed bearer — is catastrophic and silent.

**Scoping** (confirmed via codebase read): OAuth HTTP mode IS explicitly multi-tenant by design — README describes one server handling OAuth-authenticated MCP clients picking their own workspace pages (`README.md:58-59`, `README.md:83-85`, `README.md:377-388`). Static-token HTTP mode is single-user remote-access (one `NOTION_TOKEN` for all callers). Stdio mode has no bearer path. All findings below are scoped to OAuth HTTP mode unless noted.

---

## P1 — Schema cache keying & concurrent fill

### P1.1 Cache shape (code-established facts)
- `schemaCache = new Map<string, { schema, expires }>()` at `src/notion-client.ts:42`, TTL `5 * 60 * 1000` at `src/notion-client.ts:44`.
- `dataSourceIdCache = new Map<string, { dsId, expires }>()` at `src/notion-client.ts:43`.
- Both keyed on `dbId` alone. No token hash, no `user_id`, no `workspaceId` in the key (`src/notion-client.ts:50-60`, `src/notion-client.ts:68-76`).
- Scope is module-level / process-wide. Both maps persist across sessions, users, and request lifecycles.
- No singleflight, no promise memoization, no lock; on simultaneous miss both requests fetch independently; `Map.set` is unconditional, last writer wins (`src/notion-client.ts:60`, `src/notion-client.ts:75`).

### P1.2 Enumerated cases

**Case P1.a — Schema-cache read inside authorization-checked path** (post-debate: narrow, real).
Tool `get_database(X)` performs live `client.databases.retrieve({ database_id: X })` FIRST with B's token, then reads `getCachedSchema(X)` (`src/notion-client.ts:110-130`). B cannot bypass the existence/access check via the cache alone. But if tenant A's cached `data_source.properties` differs from what B's token would fetch (see P1.b), B passes the outer authorization check and then receives A's cached schema in the response body.

**Case P1.b — Permission-shaped schema divergence** (survives debate).
Notion's `Retrieve a data source` response is documented as adhering to the integration's parent-database permissions, and specifically notes that relation-based properties may be omitted if the related database is not shared with the integration (Notion API docs: [Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source)). This is the mechanism by which A's cached schema can legitimately differ from B's would-be schema. Impact via P1.a: B can see A-visible relation property names via `get_database`.

**Case P1.c — Property-value conversion contamination** (correctness, not passive leak).
`add_database_entry`, `add_database_entries`, `update_database_entry` read `getCachedSchema(X)` to convert user-supplied property values before calling `pages.create` / `pages.update` with B's token (`src/notion-client.ts:554-590`, `src/server.ts:1319-1351`). If A's schema contained a relation property B cannot see, B supplying that property name would have it converted rather than ignored. Not passive exfiltration; requires B to already know the hidden property name.

**Case P1.d — `query_database` text-filter construction** (weak).
`buildTextFilter()` inspects cached schema for `title`, `rich_text`, `url`, `email`, `phone_number` only (`src/notion-client.ts:135-142`). Relation-only permission divergence does not manifest through this path in practice. Shared staleness, not a leak.

**Case P1.e — Concurrent-miss "last writer wins"** (survives debate only under P1.b conditions).
Under ordinary identical-schema conditions, simultaneous misses from A and B both complete and overwrite the same logical value — wasted work, not a leak. Under P1.b conditions (fetches return permission-shaped different schemas), whichever fetch finishes last becomes the process-global value for the next reader, including subsequent reads within the other tenant's request.

**Case P1.f — Same-request cache-fill race** (survives).
Within one of B's tool calls there can be an `await` gap between `getDataSourceId()` and `convertPropertyValues()` / between `databases.retrieve()` and `getCachedSchema()`. Another tenant's fill can land in the gap. Example: `createDatabaseEntry()` `src/notion-client.ts:554-560` → `convertPropertyValues()` `src/notion-client.ts:191-196` → `getCachedSchema()` `src/notion-client.ts:68-76`. Example: `get_database()` `src/notion-client.ts:110-130`.

**Case P1.g — `dataSourceIdCache` as existence oracle** (dropped to open question).
`queryDatabase()` / `createDatabaseEntry()` use cached `dbId → dsId` without re-checking `databases.retrieve` (`src/notion-client.ts:504-527`, `src/notion-client.ts:554-565`). Whether this produces observable tenant-B-vs-B'-no-access differential behavior at the Notion API depends on whether `dataSources.query` / `pages.create` return distinct "unknown dsId" vs "forbidden" errors. Notion docs for `Query a data source` collapse these to 404 ([docs](https://developers.notion.com/reference/query-a-data-source)), so the oracle likely does not exist for query. Not verified for create. **Open question; not enumerated as a concrete case.** Also requires out-of-band knowledge of a candidate `database_id`.

### P1 Debate block

**Claim** (initial): Cross-tenant schema leaks via shared cache across 6+ distinct tool paths (`get_database`, `query_database`, `add_database_entry`, `add_database_entries`, `update_database_entry`, existence oracle via dsId cache).

**Challenge**: Most of those paths consume the cache only for value-conversion or filter-construction *before* calling Notion with B's own token. B has to have Notion-side access for the downstream call to succeed. If B has access, B would have fetched the same schema anyway. So what's actually leaked?

**Resolution**: Cases P1.c/P1.d downgraded to "correctness contamination" / "shared staleness." Case P1.a survives narrowly — the `get_database` tool returns the cached schema in its response body, and Notion's documented permission-shaped-schema behavior (P1.b) gives a concrete mechanism for A's schema to differ from B's. Concurrent-miss (P1.e) survives only under P1.b conditions. Existence-oracle case (P1.g) dropped to open question pending Notion API behavior verification. Codex conceded on all downgrades.

---

## P2 — Module-level mutable state

### P2.1 Inventory (post-debate)

| Symbol | Location | Initial class | Post-debate class | Notes |
|---|---|---|---|---|
| `tools` const | `src/server.ts:424-866` | ✅ SAFE | ✅ SAFE | Read-only registry |
| `stickyParentPageId` | `src/server.ts:889,909` | ⚠️ | Per-session UX state | Not module-level; lives in `createServer` closure. Only observable cross-tenant if session boundary already breached. |
| `schemaCache` / `dataSourceIdCache` | `src/notion-client.ts:42-43` | ⚠️ | Consolidated into P1 | See P1 |
| `transports` Map | `src/http.ts:35` | ⚠️ | Necessary registry; risky routing | Map itself is needed for resumable MCP sessions. Real issue: P2.a below. |
| `InMemoryClientsStore.clients` | `src/auth/oauth-provider.ts:57-69` | ❓ | Baseline OAuth state | No codebase-specific cross-tenant angle |
| `NotionOAuthProvider.authSessions` | `src/auth/oauth-provider.ts:79,108-150,458-461` | ❓ | Baseline OAuth state | Transient per-auth-flow |
| `NotionOAuthProvider.pendingCodes` | `src/auth/oauth-provider.ts:85,231-287` | ⚠️ | Baseline OAuth transient | Downgraded: requires OAuth code interception, same threat surface as any OAuth impl. Bound to `clientId` before exchange at `src/auth/oauth-provider.ts:282-283`. |
| `TokenStore` (tokens.json) | `src/auth/token-store.ts:62-109` | ❓ | Moved to P3 | Durability/consistency, not tenant-isolation per se |
| `cleanupInterval` | `src/http.ts:149-152` | ❓ | Safe | Calls cleanup, `.unref()` applied |

### P2.2 Enumerated cases

**Case P2.a — Session-binding gap on resumed requests** (survives; primary P2 finding).
First `POST /mcp` for a session creates `const notion = createNotionClient(notionToken)` and `const server = createServer(() => notion, ...)` bound via closure (`src/http.ts:72-86`, `src/http.ts:78-79`). Subsequent POST/GET/DELETE requests with the same `mcp-session-id` look up the existing transport by session ID and reuse that pre-bound closure (`src/http.ts:48-49`, `src/http.ts:95-115`). OAuth bearer auth DOES re-run on every `/mcp` request (`src/http.ts:183-185`, correcting the initial pass) — but there is no check that the re-authenticated principal matches the principal that originally created the stored transport/server/client. Design-level: stored session should be keyed/verified against its original Notion-token identity.

**Case P2.b — `stickyParentPageId` intra-session bleed** (downgraded; downstream of P2.a).
Within one captured `Server` instance, a tool call with explicit `parent_page_id` sets `stickyParentPageId`; subsequent calls omitting the arg fall back to it (`src/server.ts:896-924`). Cross-tenant impact only arises if a session ID crosses principal boundaries (i.e. P2.a is exploited). Standalone single-user UX behavior, not an independent leak vector.

### P2 Debate block

**Claim** (initial): 5+ ⚠️ items representing per-request-should-be state held at module level: `stickyParentPageId`, `transports`, `schemaCache`/`dsIdCache`, `pendingCodes`, `tokens.json` RMW.

**Challenge**: Several of these aren't module-level or aren't tenant-isolation concerns. `stickyParentPageId` lives in a per-session closure. `transports` is necessary bookkeeping; the leak (if any) is in its *usage semantics*, not its existence. `pendingCodes` is standard OAuth transient state. `tokens.json` RMW is durability, not isolation. And the schema caches duplicate P1.

**Resolution**: Codex conceded all five downgrades. The finding that survives is the session-binding gap (P2.a): after a session's transport/server/client is created, the bound Notion client is not re-verified against the currently-authenticating bearer's principal on subsequent requests. This is a session-management design flaw, not a "module-level mutable state" flaw per se, and the frame should name it correctly.

---

## P3 — Encrypted token store durability

### P3.1 Storage facts
- Path: `~/.easy-notion-mcp/tokens.json` with key at `~/.easy-notion-mcp/server.key` (`src/auth/token-store.ts:18-29`, `src/http.ts:140-141`).
- Format: AES-256-GCM, fresh 12-byte IV per save, on-disk blob is `base64(iv):base64(tag):base64(ciphertext)` of `JSON.stringify(records)` (`src/auth/token-store.ts:17,43-49,72-75`).
- Key: raw 32 bytes from `server.key`, or `randomBytes(32)` generated and written at init if missing/invalid-length. No KDF, no env-var override, no rotation API (`src/auth/token-store.ts:32-40`).
- Writes: direct `writeFile(path, blob, { mode: 0o600 })`. No tmp-file, no rename, no fsync (`src/auth/token-store.ts:72-75`).
- Reads: `load()` catches all read/decrypt/parse errors and returns `[]` (`src/auth/token-store.ts:62-69`).
- Used in HTTP OAuth mode only; gated by `useOAuth = !!(oauthClientId && oauthClientSecret)` (`src/http.ts:37,129-141`). Stdio and static-token HTTP modes do not construct it.
- Not keyed by user; stores `TokenRecord[]` with fields `{mcpToken, notionToken, refreshToken?, workspaceId?, clientId, scopes, timestamps}` (`src/auth/token-store.ts:6-15`).

### P3.2 Enumerated cases

**Case P3.a — Concurrent read-modify-write clobber** (survives under public-shared deployment).
Every write does `load()` → mutate array → whole-file `save()` with no lock/mutex/serialization (`src/auth/token-store.ts:62-109`). `exchangeAuthorizationCode()` does TWO back-to-back `storeToken()` calls per auth (`src/auth/oauth-provider.ts:271-320`), doubling race windows. Two OAuth completions finishing in the same event-loop tick can clobber each other; revocation racing auth can undo a just-persisted record. Realistic only under public-shared-instance launch-wave conditions; near-zero under personal/small-team deployment. Enumerated, deployment-conditional.

**Case P3.b — Non-atomic write on abrupt termination** (real, low operational likelihood).
Direct `writeFile` with no tmp+rename means a crash/kill/power-loss during the kernel write window can leave `tokens.json` truncated or partial. On next `load()`, the file is uninterpretable and collapses to `[]` — effective "all users must re-auth." Blast radius is re-auth, not partial-record corruption (because the whole array is one blob). Survives as "implementation property" / "fail-closed and lossy on crash"; does not survive as "common operational bug."

**Case P3.c — Revocation leaves orphan refresh record that can still mint access tokens** (survives; reframed from durability to lifecycle security).
`revokeToken()` calls `deleteToken(request.token)` which deletes only the exact-match record (`src/auth/oauth-provider.ts:444-448`, `src/auth/token-store.ts:100-103`). OAuth exchange stored TWO records during auth — access and refresh — under different `mcpToken` values (`src/auth/oauth-provider.ts:297-320`). Revoking the access token does NOT remove the paired refresh entry. The refresh record remains usable via `exchangeRefreshToken()` (`src/auth/oauth-provider.ts:333-345`, `src/auth/oauth-provider.ts:388-410`), which can mint a new access token without any `expiresAt` requirement. This is a security finding — revocation is incomplete, not just maintenance cruft.

**Case P3.d — `server.key` loss silently orphans existing ciphertext** (distinct from general corruption).
If `server.key` is missing or invalid-length at init, `init()` generates a new random 32-byte key and overwrites it (`src/auth/token-store.ts:35-40`). The pre-existing `tokens.json` then fails decrypt, `load()` returns `[]` (`src/auth/token-store.ts:52-69`). Trigger is code-distinct from `tokens.json` corruption (key-file delete vs data-file corruption) and recovery path is the same (re-auth). Narrow but valid separate failure mode.

**Case P3.e — Whole-blob corruption semantics** (enumerated).
Because the entire record array is encrypted as one AES-GCM blob with one auth tag, corruption is never entry-contained. Any tag/decrypt/JSON failure makes the whole store unreadable on that load — no partial recovery path in code (`src/auth/token-store.ts:43-49,52-69`). All users re-auth simultaneously on any tampering/corruption.

**Case P3.f — Key rotation as supported scenario** (dropped).
No rotation API, no env-var override. Rotation is not a designed scenario; no case to enumerate beyond P3.d.

### P3 Debate block

**Claim** (initial): 5 distinct durability/concurrency concerns — key rotation, concurrent OAuth race, 50+10+crash sequence, missing tmp-rename atomicity, 500-vs-401 on decrypt failure.

**Challenge**: Key rotation isn't a supported scenario. OAuth concurrent completions are rare under personal-deployment conditions. The "90 records not 80" observation on the 50+10 sequence is garbage-collection cruft, not durability. Missing tmp-rename is real but operationally rare. The 500-vs-401 error propagation belongs in Pass D, not Pass C.

**Resolution**: Key rotation dropped; key-loss (P3.d) survives as a distinct trigger. Concurrent-OAuth race (P3.a) made deployment-conditional — survives for public-shared, downgrades for personal. 50+10 reframed: the surviving finding is P3.c (orphan refresh record remains usable post-revoke) and this is a *security* finding, not durability cruft — Codex corrected upward here, noting `exchangeRefreshToken()` has no expiresAt requirement and can still mint access. Tmp-rename finding (P3.b) kept as implementation property, downgraded operationally. 500-vs-401 moved to P4.

---

## P4 — Bearer token authentication pathways

### P4.1 Entry facts
- OAuth HTTP mounts `authMiddleware` on `/mcp` for POST/GET/DELETE at `src/http.ts:173,183,185`.
- Middleware: parses `req.headers.authorization`, `split(' ')`, scheme lowercased, empty token → 401 (`node_modules/@modelcontextprotocol/sdk/.../bearerAuth.js:16-24`). Verifier call at line 24; failures caught, classified by error type — `InvalidTokenError` → 401, other `Error` → synthesized `ServerError` → 500 (`bearerAuth.js:68-69`, `errors.js:16,92`).
- `NotionOAuthProvider.verifyAccessToken()` throws **generic** `Error` for unknown/revoked/expired tokens (`src/auth/oauth-provider.ts:418,420,423,425`), NOT `InvalidTokenError`. Consequence: these resolve as 500, not 401.
- On success, middleware writes `req.auth`; `getNotionTokenFromAuth()` pulls `req.auth.extra.notionToken` at session-create only (`src/http.ts:178`). The token→user-context flow is per-request auth, but the Notion client binding is per-session closure (see P2.a).
- Static-token HTTP mode mounts `/mcp` **without** auth middleware (`src/http.ts:190,193`). All methods accept unauthenticated requests.

### P4.2 Enumerated cases

**Case P4.a — Session-ID reuse with valid bearer as cross-tenant vehicle** (survives as defense-in-depth, not standalone bypass).
If tenant B presents a valid-B bearer AND knows tenant A's `mcp-session-id`, B's POST/GET/DELETE passes bearer auth and then selects A's existing transport/server/client via session-ID routing (`src/http.ts:48-49,51,95,107`). Tool calls execute against A's captured Notion client: 200 with A's data. Exploitability requires prior session-ID disclosure (side channel, shared proxy, MITM on non-TLS, or social engineering). Not an external-attacker bypass in an honest HTTPS deployment; it is a defense-in-depth gap (once session-ID leaks, catastrophic). This is the same surviving finding as P2.a viewed from the auth angle.

**Case P4.b — Unknown/revoked/expired token returns 500 instead of 401** (survives as operability/correctness, not data leak).
Generic `Error` from verifier maps to `ServerError('Internal Server Error')` synthesized by SDK middleware (`bearerAuth.js:68-69`). Response body is `{"error":"server_error","error_description":"Internal Server Error"}` — body is identical across cases and does NOT disclose which sub-case occurred. So: not an oracle/information leak. But the 500 status triggers:
- log-noise / oncall paging where 401 wouldn't
- aggressive retry in some clients (5xx often retried, 4xx not)
- breaks client logic that inspects for 401-to-reauth signaling
Enumerated as operability/semantics bug; not data exposure.

**Case P4.c — Static-token HTTP mode: unauthenticated `/mcp`** (separate design-shape finding, not OAuth-path).
`createApp()` in static-token mode mounts POST/GET/DELETE handlers on `/mcp` without `authMiddleware` (`src/http.ts:188-195`). Anyone who can reach the HTTP port can submit tool calls that execute with the server's single `NOTION_TOKEN`. This is consistent with "static-token = single-user remote access" framing per README, but it is worth enumerating because the deployment shape is easy to misdeploy (expose to network without front-door auth). Scope-note, not a bearer-auth-pass bug.

**Case P4.d — Stale Notion client after token refresh** (reframed to session lifecycle).
After `exchangeRefreshToken()` updates stored Notion token data (`src/auth/oauth-provider.ts:376,380`), existing sessions keep the old captured `notion` client from session-create time (`src/http.ts:78-79`). Old client's Notion token eventually becomes invalid upstream; user sees failures until session is re-established. Functional/lifecycle issue, not cross-tenant confusion. Enumerated for completeness; not a bearer-auth-pass finding per se.

**Case P4.e — Malformed/edge token inputs** (drops).
- Missing / empty / wrong-scheme / whitespace-before-scheme → 401 via header-format parsing (`bearerAuth.js:17,20,54`).
- Case-different header name → handled by Express lowercase; scheme case handled by `toLowerCase()` (`bearerAuth.js:16,21`).
- Trailing whitespace after token → destructured away by `split(' ')`; core token still authenticates if valid. Not a vulnerability (attacker needs a valid token already).
- Refresh token presented at `/mcp` → 401 "Token has no expiration time" because refresh entries lack `expiresAt` (`bearerAuth.js:32-34`; refresh write at `src/auth/oauth-provider.ts:310`). SDK enforcing access-vs-refresh distinction — working as designed.
- Token for Notion-side deauthorized user → bearer accepts, session binds with stale Notion token, later tool calls catch errors at `src/server.ts:92,1418` and return `{"error":...}` text payloads at 200. 200-with-error-payload, not 200-with-wrong-user-data, not 401/404.

All dropped or reframed as not-a-finding.

### P4 Debate block

**Claim** (initial): 11+ enumerated input cases plus session-ID-reuse wrong-user-data path; 500-vs-401 across unknown/revoked/expired; refresh token at `/mcp` as bug; trailing whitespace as parsing quirk; stale Notion client as auth issue.

**Challenge**: Session-ID reuse requires prior session-ID disclosure — what's the realistic external-attacker threat model? 500-vs-401 — does the response body leak which sub-case? If not, this is just status-code hygiene. Refresh-at-/mcp — SDK working as designed. Trailing whitespace — a valid-token holder adding a space doesn't gain privilege. Stale Notion client — same user, not cross-tenant.

**Resolution**: Session-ID-reuse reframes to "defense-in-depth gap, requires session-ID disclosure + valid auth — not standalone external bypass." Codex confirmed GET/DELETE in OAuth mode ARE authenticated (correcting initial pass which suggested otherwise). 500-vs-401 survives as operability; response body verified to NOT leak which case (same `server_error / Internal Server Error` string for all three). Refresh-at-/mcp dropped. Trailing whitespace dropped. Stale client reframed to session lifecycle, not auth. New finding surfaced during rebuttal: static-token HTTP mode has no auth middleware on `/mcp` — enumerated as P4.c scope-note.

---

## Cross-frame acknowledgment

This frame cannot see (per generator-note blind spot):

- **Content-layer correctness** — whether the properties returned via the Notion client are rendered correctly, whether block-tree conversion preserves content, whether pagination/truncation is honest. A tenant could receive their own pages back correctly isolated but with mangled markdown or silent truncation, and this frame would call it fine. Deferred to Frame 1 (archeologist) and Frame 5 (agent).

- **Agent ergonomics and tool-call surface** — whether tool names/params are unambiguous, whether errors are legible, whether the tool set guides correct agent behavior. Isolation is necessary but not sufficient for usefulness. Deferred to Frame 5.

Additionally, this frame likely **under-weights**:

- Operational/hosting concerns beyond code shape: TLS termination assumption, reverse-proxy header parsing (X-Forwarded-*), rate-limit and DoS at the transport layer, log-level PII exposure. These intersect with multi-tenant deployment but are outside the code surface this pass examined.

---

## Session chain appendix

**Orchestrator session**: frame-3-multitenant-explorer (Claude Opus 4.7, 1M context) — current session, running in `/mnt/d/backup/projects/personal/mcp-notion` on branch `dev`. Session ID not captured by tooling at this level.

**Codex passes dispatched** (all `codex-5.3`, `reasoningEffort: high`):

| Session name | Session ID | Rounds |
|---|---|---|
| frame3-pass-a-schema-cache | `019d9e9c-82c3-7113-babc-3f69fcf94461` | initial + rebuttal |
| frame3-pass-b-module-state | `019d9e9c-bb98-74d1-bfe3-7d46537f11a5` | initial + rebuttal |
| frame3-pass-c-token-store | `019d9e9c-fe85-7502-bfb7-128c5b689cf1` | initial + rebuttal |
| frame3-pass-d-bearer-auth | `019d9e9d-4982-7813-8652-9521b45b121b` | initial + rebuttal |

Each Codex session was dispatched concern-first (one pass per probe-cluster), received one adversarial rebuttal via `continue_agent`, and was spot-checkable by the orchestrator via `mcp__agents__list_agent_sessions` / `get_agent_result`.

**Session-chain anomaly**: orchestrator process was killed by its own runtime after ~90min idle between initial passes completing and rebuttal dispatch collection. Resumed via foreground `get_agent_result` calls; all 4 rebuttal outputs retrieved successfully from Codex session memory. No findings lost.

**Runtime probes**: none executed. OAuth live flow not required per frame directive; HTTP server boot not attempted because code-read evidence was sufficient for all probe categories. No Notion writes, no throwaway pages created.

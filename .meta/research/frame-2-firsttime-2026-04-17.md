# Frame 2 — The Frustrated First-Timer (Time-to-First-Successful-Call)

**Date:** 2026-04-17
**Frame thesis (from generator):** Most would-be adoption dies in the 15 minutes between "I want Notion in my agent" and the first successful `read_page`. The friction surface is npm install, OAuth setup, MCP client config syntax variations, shell rcfile semantics, Docker networking, and the specific error the user sees when any one of those is misaligned. The README is part of this surface and its accuracy is load-bearing.

**Bucket legend (directive from orchestrator):**
- `D-wrong`: Docs are factually wrong regardless of code.
- `docs-gap`: Docs are silent / misleading on a case that users hit; code is acting reasonably.
- `C-bug`: Code produces unhelpful output / does the wrong thing even when docs are right.

**Severity legend (opacity vs loudness):**
- `loud-actionable`: user sees an error that tells them what to fix.
- `loud-opaque`: error fires but text doesn't help (generic 500 / raw stack / misleading message).
- `silent-wrong`: no error, proceeds as if working; tool-level failure later.
- `hang`: stdio/http stays open, client sees "connecting…".

---

## Probe 1 — Documented setup path walkthrough

### Case 1.1 — `create_page_from_file` missing from README tool table
- **Observed:** README tool table (`README.md:243-298`) omits `create_page_from_file` and `update_data_source`. Stdio registers 28 tools (`src/server.ts:462-492`, `tests/create-page-from-file.test.ts:213-225`); HTTP registers 27 because `create_page_from_file` is transport-filtered out (`src/server.ts:491`, `src/server.ts:926-944`).
- **Bucket:** `D-wrong` (tool documented-as-absent while registered) + `opacity` (transport split unmentioned near setup blocks).
- **First-timer angle:** if the user arrived because they wanted "drop a Markdown file into a Notion page," they won't find the tool in the docs table even though stdio exposes it. Not felt if they're after a common tool (`read_page`, `list_databases`).

### Case 1.2 — `NOTION_ROOT_PAGE_ID` accepts "page-id-or-url" (docs-wrong)
- **Observed:** README says `NOTION_ROOT_PAGE_ID=<page-id-or-url>` (`README.md:99`). Stdio entry forwards raw env string (`src/index.ts:17-20`), server surfaces it unchanged (`src/server.ts:905-906`), Notion client passes it to the API as `page_id` (`src/notion-client.ts:251-264`). No URL-normalization helper exists anywhere in `src/`. Notion's own API docs describe `page_id` as the 32-char UUID, not a URL.
- **Bucket:** `D-wrong`. Severity: `loud-opaque` (Notion will return `validation_error` about page_id format; the user doesn't know the docs lied).
- **First-timer angle:** a frustrated first-timer pastes the Notion page URL they already have open — the docs told them they could.

### Case 1.3 — OAuth metadata serviceDocumentationUrl points to wrong repo
- **Observed:** `src/http.ts:159-164` advertises `https://github.com/jwigg/easy-notion-mcp` in OAuth protected-resource metadata; `package.json:22-25` points to `https://github.com/Grey-Iris/easy-notion-mcp`.
- **Bucket:** `C-bug`. Severity: `silent-wrong` for user-facing flow; only visible to clients that follow docs URL in error UIs.
- **First-timer angle:** if an MCP client surfaces that URL as a "learn more" link on auth failure, the user lands on a 404 or wrong-owner repo.

### Case 1.4 — `.env.example` scaffolding is token-only
- **Observed:** `.env.example:1-2` only has token-mode vars; README's HTTP/OAuth config section (`README.md:379-385`) requires `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, `PORT`, `OAUTH_REDIRECT_URI`, none of which are scaffolded.
- **Bucket:** `docs-gap` (the scaffold is silent on OAuth-mode vars). Severity: user either copies an incomplete template or tries without one.

### Case 1.5 — VS Code Copilot `servers` key verified correct
- **Observed:** README (`README.md:134-148`) correctly uses `servers`, not `mcpServers`, for VS Code Copilot. Verified no drift.
- **Bucket:** not a case; recorded as a checked non-issue.

### Case 1.6 — Claude Code env blocks accurate
- **Observed:** `claude mcp add -e NOTION_TOKEN=... -e NOTION_ROOT_PAGE_ID=...` (`README.md:94-99`) passes through to code that reads those exact names (`src/index.ts:7-20`).
- **Bucket:** not a case except Case 1.2 above inheriting into this path.

---

## Probe 2 — Missing / misconfigured env surface

### Case 2.1 — `NOTION_TOKEN` unset → loud-actionable
- **Observed (runtime probe + source):** clean cwd, no token. Stderr: exact string `"NOTION_TOKEN is required"` from `src/index.ts:8` (also present in `dist/index.js:7`). Exit code 1, stdout empty. MCP client sees stdio close mid-handshake; SDK client throws `MCP error -32000: Connection closed`.
- **Bucket:** `C-bug` (adequate), `loud-actionable`.
- **First-timer angle:** this is the best error in the whole startup surface. Caveat: message doesn't mention the HTTP/OAuth alternative (`easy-notion-mcp-http`), so a user who knows they want OAuth is pushed toward fixing the "wrong" problem.

### Case 2.2 — `NOTION_TOKEN=""` (empty string) → same as 2.1
- **Observed:** `if (!NOTION_TOKEN)` falsy check at `src/index.ts:7-10` treats empty string identically. Exact same output as 2.1.
- **Bucket:** `loud-actionable`. No issue.

### Case 2.3 — `NOTION_TOKEN="   "` (whitespace)
- **Observed:** whitespace is truthy, so falsy check at `src/index.ts:7` passes. MCP handshake succeeds. Banner prints. First tool call returns normal content `{"error":"API token is invalid."}` (Notion 401 surface via `APIResponseError`), with raw stack trace to stderr.
- **Bucket:** `C-bug`, `silent-wrong` (appears to work, fails at first tool call).
- **Realism qualifier (from rebuttal):** `dotenv` trims unquoted whitespace at `node_modules/dotenv/lib/main.js:65`, so `.env`-set users rarely hit this. Most realistic trigger: quoted value like `NOTION_TOKEN="ntn_xxx   "` in `.env`, OR shell-set via `export NOTION_TOKEN="   "`. Narrower population than initially claimed but real for copy-paste-with-quotes.

### Case 2.4 — Garbage / expired / revoked `NOTION_TOKEN`
- **Observed:** MCP handshake succeeds. First tool call (e.g. `get_me`) returns `content[0].text == "{\"error\":\"API token is invalid.\"}"` via `src/server.ts:1418-1421`. Not marked `isError: true` — `textResponse()` at `src/server.ts:92-96` always serializes to `content` only. Stderr dumps Notion stack trace.
- **Bucket:** `C-bug`, `silent-wrong` (protocol-wise) + `loud-actionable` (text-wise, for a human reading chat).
- **First-timer angle (from rebuttal):** human first-timers see the "API token is invalid" text and can self-recover. The missing `isError` flag is felt by the **agent loop** (model may not classify the tool call as failed) — Anthropic's own Claude Code changelog notes a past fix in this area. Keep as first-timer case because the agent-loop behavior is what the user experiences via their assistant; mark as secondary for pure-human first-timers.

### Case 2.5 — OAuth vars partial / wrong-named
- **Observed:** Stdio ignores OAuth env entirely (`src/index.ts:7-20`); the user still gets `NOTION_TOKEN is required`. HTTP exits with `"Either NOTION_TOKEN or (NOTION_OAUTH_CLIENT_ID + NOTION_OAUTH_CLIENT_SECRET) is required"` from `src/http.ts:204-208` if either OAuth var is missing or if the user used the frame-generator's non-canonical names `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` (code reads `NOTION_OAUTH_*`).
- **Bucket:** `loud-actionable` for HTTP — the message names both variables correctly. `docs-gap` for stdio — a user trying OAuth via stdio gets a misleading "need NOTION_TOKEN" error that doesn't clue them into "wrong transport."

### Case 2.6 — Both `NOTION_TOKEN` and OAuth vars set; precedence undocumented
- **Observed:** stdio: NOTION_TOKEN wins by exclusivity (`src/index.ts:7-20` never reads OAuth env). HTTP: OAuth wins — `oauthEnabled` is `!!(NOTION_OAUTH_CLIENT_ID && NOTION_OAUTH_CLIENT_SECRET)` at `src/http.ts:16`, and `createApp()` takes the OAuth branch unconditionally when truthy (`src/http.ts:129-197`). README is silent on precedence (verified — not contradiction, just absence).
- **Bucket:** `docs-gap`. Severity: `silent-wrong` if the "losing" var is what the user expected to use and the "winning" var is broken.

### Case 2.7 — `.env` autoload docs claim is too categorical
- **Observed:** README line 373: "It is **not** loaded when the package is invoked via `npx easy-notion-mcp` or a global install from an arbitrary directory…". Reality: `dist/index.js:2` and `dist/http.js:2` both call `dotenv/config`, and the published bundle loads `.env` from `process.cwd()` regardless of `npx` vs global install. Verified by running from a scrubbed temp cwd with only `.env` → connection succeeded.
- **Bucket:** `D-wrong` on the "not loaded" claim. `docs-gap` on cwd semantics — README doesn't explain that GUI/editor-launched MCP clients may have a cwd the user doesn't expect, which is the actually-load-bearing caveat.
- **First-timer angle:** user who trusts the README puts env in client config instead of `.env`. Not catastrophic but misleading.

### Case 2.8 — Shell rcfile non-inheritance
- **Observed:** `export NOTION_TOKEN=...` in `.zshrc` works for clients launched from a login shell (e.g. `claude mcp add` from terminal). For GUI-launched clients (Claude Desktop, Cursor.app on macOS), the spawned child doesn't see shell rc. SDK stdio spawn at `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js:65-74` uses `shell: false` and inherits only parent process env. Outcome: server prints `NOTION_TOKEN is required`, client surfaces as "failed to connect" or similar.
- **Bucket:** `docs-gap` (this repo cannot fix how clients spawn; README already prefers explicit `env` blocks in setup snippets but doesn't explicitly warn about the GUI-launched trap).
- **First-timer angle:** very common pain point for macOS users who followed a "set it in your shell rc" suggestion elsewhere.

### Case 2.9 — `NOTION_ROOT_PAGE_ID` unshared / unreachable to the token
- **Observed:** `rootPageId` is only consulted by `resolveParent()` (`src/server.ts:896-923`), called from create-ish tools (`create_page`, `create_page_from_file`, `duplicate_page`). `read_page` doesn't consult it — it uses the explicit `page_id` arg (`src/server.ts:1106-1124`). `list_databases` is workspace search (`src/server.ts:1292-1299`), also unrelated.
- **Bucket:** `docs-gap`, `silent-wrong` for user mental model — first-timers often think setting `NOTION_ROOT_PAGE_ID` "grants access" to that page for reads, when it only parents creations.
- **First-timer angle:** user sets root page, is confused when `read_page` still errors on page-not-shared — because the token actually needs sharing via Notion's Connections UI, not via env.

### Case 2.10 — Tool failures never set `isError: true`
- **Observed (cross-cutting):** `textResponse()` at `src/server.ts:92` always emits content only, no `isError`. Catch at `src/server.ts:1418-1421` also omits `isError`. MCP spec expects tool execution failures to surface as `isError: true` in the result.
- **Bucket:** `C-bug`. Severity: `silent-wrong` at protocol level; visible-but-misclassified at agent-loop level. (See Case 2.4 for first-timer framing.)

---

## Probe 3 — OAuth / HTTP first-run

### Case 3.1 — Kickoff reality vs user mental model
- **Observed:** No `authorize` subcommand. The OAuth flow is: `easy-notion-mcp-http` starts, MCP client POSTs `/mcp`, 401 fires, client hits `/authorize`, then user's browser (opened by the client, not the server) lands on Notion's consent page. README:85 says "Your browser will open to Notion's authorization page" in a connector-flow context — that's describing client behavior, not server behavior. Valid as written.
- **Bucket:** not a case per se. But the **first-timer mental model gap** is real: users expect `easy-notion-mcp-http authorize` as a CLI. None exists.
- **Severity:** `docs-gap` at most; in practice clients handle this.

### Case 3.2 — `/callback` correlation errors are raw JSON in the browser
- **Observed:** `src/auth/oauth-provider.ts:138` emits `"Missing state parameter"`; `src/auth/oauth-provider.ts:143` emits `"Invalid or expired session"`. The 10-minute session TTL at `src/auth/oauth-provider.ts:454` expires silently. If the user leaves the Notion consent tab open too long, or hits the callback directly, they get raw JSON with no "restart auth" hint.
- **Bucket:** `C-bug`. Severity: `loud-opaque` (error fires, text is technical, no recovery guidance).
- **First-timer angle:** a user who got distracted mid-flow sees browser JSON and has no idea what to do.

### Case 3.3 — `OAUTH_REDIRECT_URI` drift vs Notion-registered URI
- **Observed:** `src/auth/oauth-provider.ts:123` sends the configured redirect URI to Notion at authorize time; `src/auth/oauth-provider.ts:185` reuses it at token exchange. README:384 describes default as `http://localhost:{PORT}/callback`, but README:386 example hardcodes `http://localhost:3333/callback`. If the user changed PORT, the docs still show the default callback. If Notion rejects the redirect at the authorize step, the user sees Notion's hosted error page — no local error text. At the token exchange step, stderr logs `"Notion token exchange failed:"` (`src/auth/oauth-provider.ts:191`) but the user-facing redirect only says `"Failed to exchange authorization code with Notion"` (`src/auth/oauth-provider.ts:194`) — no hint about redirect-URI mismatch specifically.
- **Bucket:** `D-wrong` on the PORT-vs-callback mismatch in docs, `C-bug` on the generic error shape at exchange. Severity: `loud-opaque`.

### Case 3.4 — Token storage directory unwritable
- **Observed:** tokens at `~/.easy-notion-mcp/tokens.json`, key at `~/.easy-notion-mcp/server.key` (`src/auth/token-store.ts:18`, `:28`). Startup failure surfaces as `"Fatal:"` prefix (`src/http.ts:232`) plus raw fs error. If `tokens.json` is later unreadable or key is rotated/corrupted, `load()` swallows the error and returns `[]` at `src/auth/token-store.ts:62` — silent token loss, user redoes OAuth without knowing why.
- **Bucket:** `C-bug`. Severity: `silent-wrong` for the load path; `loud-opaque` for the startup path.
- **First-timer angle:** first-run rarely hits this unless home directory is read-only (Docker with non-writable volume). Second-run after key rotation is more realistic but not strictly first-run.

### Case 3.5 — OAuth "success" without page-read probe
- **Observed:** Token exchange stores the token (`src/auth/oauth-provider.ts:214, :298-327`) without a smoke-test call against Notion. First symptom lands at `read_page`, where `enhanceError()` rewrites the Notion error: for `restricted_resource`, `src/server.ts:402` emits `"This page hasn't been shared with the integration. In Notion, open the page → ··· menu → Connections → add your integration."`; for `object_not_found`, `src/server.ts:394` appends `"Make sure the page/database is shared with your Notion integration."`.
- **Bucket:** `docs-gap` — README:85 says "Pick the pages to share, click Allow, done" which hints at the flow but doesn't explain the common failure where the user clicks Allow too fast, doesn't add the target page, then confused when `read_page` fails.
- **Severity:** `loud-actionable` — the server's own error text is actually good here, which is a bright spot.
- **First-timer angle:** classic Notion-integration trap, and the server handles it better than most. Keep as a case because the OAuth success signal is misleading even if the follow-up error is helpful.

### Case 3.6 — OAuth issuer hardcoded to `localhost`
- **Observed:** `src/http.ts:155` hardcodes `issuerUrl = http://localhost:${port}`. The MCP SDK client uses the discovered issuer URL for follow-up token/authorize requests (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js:667, :679, :692, :754`). A Docker-hosted client reaching the server via `host.docker.internal:3333/mcp` would receive discovery metadata pointing to `localhost:3333`, which is unreachable from inside its container.
- **Bucket:** `C-bug`. Severity: `loud-opaque` — client hits `ECONNREFUSED 127.0.0.1:3333` from inside its container, error text doesn't indicate the root cause.
- **First-timer angle (refined):** the README's documented Docker path (README:177) is static-token mode, not OAuth. So first-timers running Dify/n8n via the documented path don't hit this. It becomes a first-timer bug **only** if a user tries OAuth over Docker, which the README doesn't guide toward. Real C-bug, but outside the documented 15-minute Docker path.

### Cases demoted on rebuttal (kept here for traceability, not scored as first-timer-felt)
- **Port 3333 EADDRINUSE** — no handler at `src/http.ts:220`, would surface as raw Node listen error. Demoted: 3333 is an uncommon default-occupied port in 2026.
- **Bearer-auth 401 missing `resource_metadata`** — MCP spec allows well-known-URI discovery fallback, major clients handle it, so not first-timer-felt.
- **Token-expiry → bearer-auth 500** — plain `Error` at `src/auth/oauth-provider.ts:418, :424` degrades to `server_error` in SDK. But access tokens live 1h (`src/auth/oauth-provider.ts:16-17`); first-timer doesn't expire in 15 min.
- **Swallowed Notion refresh failures** at `src/auth/oauth-provider.ts:384` — steady-state, not first-run.

---

## Probe 4 — `.env` in invocation directory (believed vs reality)

Covered by Case 2.7 above. Summary:
- Bundle DOES load `.env` from cwd (contradicts README:373's "not loaded" claim).
- Real trap is cwd semantics for GUI-launched clients — the user who puts `.env` in their home directory and launches Claude Desktop finds their `.env` silently ignored because Claude Desktop's cwd is its bundle directory, not `$HOME`.
- No loud error — user "believes" it loaded and sees `NOTION_TOKEN is required` or similar.

---

## Probe 5 — Docker / cross-platform first-run

### Case 5.1 — Flowise on Linux + `host.docker.internal`
- **Observed:** README:175-189 groups Dify / n8n / FlowiseAI together and tells everyone to use `host.docker.internal` (README:183). Flowise's own docs explicitly tell Linux users `host.docker.internal` is not available and to use the default docker gateway instead (per Flowise docs on integrations). Dify and n8n's own compose files handle `host-gateway` automatically on modern Docker; Flowise doesn't bundle that flag consistently.
- **Bucket:** `docs-gap`. Severity: `loud-opaque` — `getaddrinfo ENOTFOUND host.docker.internal` in the Flowise container, user blames easy-notion-mcp.
- **First-timer angle (refined):** narrower than originally claimed. Keep only as Flowise-on-Linux.

### Case 5.2 — PowerShell / cmd.exe shell syntax
- **Observed:** README:179 fence is explicitly ```bash; README:180 instruction is `NOTION_TOKEN=... npx easy-notion-mcp-http`. Not wrong per se — it's labeled bash. But the README is silent on the Windows-native equivalents. Windows Docker Desktop first-timer who runs the host-side command from PowerShell gets `"The term 'NOTION_TOKEN=...' is not recognized"`.
- **Bucket:** `docs-gap` (not `D-wrong` given the `bash` fence). Severity: `loud-actionable` at shell level (PowerShell syntax error is clear), but the user doesn't know the WSL/bash equivalent.

### Case 5.3 — Bare `npx` in JSON config examples
- **Observed:** `"command": "npx"` in README:122, :140, :160. Works only if the MCP client's child-process spawn can resolve `npx` on its own PATH. GUI-launched clients on macOS (Claude Desktop.app), Linux (`nvm`/`mise`-managed Node), or Windows (WSL-only Node) frequently can't. Symptom: `spawn npx ENOENT` or "failed to connect."
- **Bucket:** `docs-gap`. An MCP-ecosystem pattern, not easy-notion-mcp-specific, but this README could carry a warning + absolute-path fallback (`which npx` / `where.exe npx`).
- **First-timer angle:** very common. Not a repo-specific bug.

### Case 5.4 — PORT hardcoded in every URL example
- **Observed:** README:71, :78, :83, :186, :383, :386 all hardcode `3333`. README:384 documents the default callback as `http://localhost:{PORT}/callback` but :386 shows the concrete `http://localhost:3333/callback`. If the user changes PORT (because of a conflict or personal preference), every other doc example becomes wrong.
- **Bucket:** `docs-gap`. Severity: `loud-opaque` — OAuth redirect mismatches surface as Notion-hosted error pages or generic exchange failures.
- **First-timer angle:** the redirect-URI mismatch overlaps Case 3.3.

### Case 5.5 — `.env.example` absent OAuth vars
- Duplicate of Case 1.4; noted here because Docker-based platforms specifically lean on `.env` scaffolding.

### Cases checked and demoted
- **.env CRLF handling** — `dotenv` normalizes `\r\n` to `\n` at `node_modules/dotenv/lib/main.js:55-56`. Not an issue.
- **macOS Gatekeeper** — pure Node scripts via `npx`, no native binaries to notarize.
- **OpenClaw missing `-y` on `npx`** — npm docs say `npx` assumes `--yes` when stdin is not a TTY. Without OpenClaw TTY-behavior evidence, speculative.

---

## Debate blocks

### Debate — Tool-count discrepancy (Probe 1)

**Claim (Pass A):** 26 vs 27 vs 28 tool mismatch is an "opacity" case on every setup path; every client config inherits it.

**Challenge:** A first-timer doesn't count tools. Unless the missing tool is the one they came for, this is audit debt, not first-timer pain.

**Resolution:** `refine`. Dropped the bare count mismatch as first-timer-felt; kept only Case 1.1 (specific tool, `create_page_from_file`, plausibly sought by a newcomer, missing from docs + absent over HTTP). Version-string mismatch (`0.2.0` vs `0.2.4`) fully conceded — audit-only.

### Debate — Whitespace token realism (Probe 2, Case 2.3)

**Claim (Pass B):** `NOTION_TOKEN="   "` is silent-wrong / C-bug — passes falsy check, handshake succeeds, fails at first tool call.

**Challenge:** Who actually sets their token to whitespace? If `dotenv` trims it, this is hypothetical.

**Resolution:** `refine`. `dotenv` trims unquoted whitespace (`node_modules/dotenv/lib/main.js:65`), so `.env`-unquoted users don't hit it. Real trigger is quoted values `NOTION_TOKEN="ntn_xxx   "` in `.env` (dotenv preserves whitespace in quoted values) or shell-set values. Population narrower than first claimed, case retained as secondary.

### Debate — Missing `isError` is first-timer-felt? (Probe 2, Case 2.10)

**Claim (Pass B):** Tool failures missing `isError: true` is "the sharpest C-bug in this first-timer path."

**Challenge:** A human first-timer sees `{"error":"API token is invalid."}` in their chat UI and can self-recover. Is this actually human-first-timer-felt, or is it agent-loop-felt (the model proceeds thinking the call succeeded)?

**Resolution:** `refine`. Downgraded from "sharpest" for human first-timers. Primary harm is agent-loop classification (Anthropic's Claude Code changelog confirmed relevance). For first-timer frame: keep as a case but note dual-population (human-visible, agent-misclassified) — the agent-loop failure reaches the human via "the assistant confidently gave me nonsense" even when the raw tool output was actionable.

### Debate — README's "browser will open" = D-wrong? (Probe 3, Case 3.1)

**Claim (Pass C, original):** README frames OAuth as browser-launching by the server; repo has no browser-launch code → D-wrong.

**Challenge:** Reread README:85 in context. Is this describing server behavior, or client behavior? MCP OAuth browser launch is typically client-mediated.

**Resolution:** `concede`. README:85 sits under Claude Desktop connector setup — it's describing client-mediated UX, not making a false claim about the server. Dropped case from first-timer list. The related "no CLI `authorize` subcommand" concern remains as a docs-gap (Case 3.1) but not D-wrong.

### Debate — Docker/Linux `host.docker.internal` warning (Probe 5, Case 5.1)

**Claim (Pass D):** README's blanket `host.docker.internal` advice fails on all Linux Docker Engine setups, needs `--add-host=host.docker.internal:host-gateway`.

**Challenge:** Modern Docker ships `host-gateway` support; Dify and n8n's own compose likely handle this. Is this actually first-timer-blocking across all three platforms?

**Resolution:** `refine`. Narrowed to Flowise-on-Linux (Flowise docs explicitly say `host.docker.internal` isn't available on Linux). Dify and n8n's compose paths weren't verified to auto-configure, but the claim isn't as strong for them. Held only for the Flowise case.

### Debate — OAuth issuer localhost is first-run-felt? (Probe 5, Case 3.6)

**Claim (Pass C/D):** Hardcoded `issuerUrl = http://localhost:${port}` (`src/http.ts:155`) breaks Docker-based OAuth clients because MCP SDK uses the discovered issuer URL for follow-up auth requests.

**Challenge:** The documented Docker path is static-token mode, not OAuth. Does a first-timer following the docs hit this?

**Resolution:** `refine`. Real `C-bug` verified via SDK source. But outside the strict 15-minute Docker first-timer path as documented. Kept as a first-timer case only for users who diverge from docs (try OAuth in a Docker-bridged setup). Important to note because a user who assumes "OAuth is better than static tokens, I'll just do OAuth over Docker" hits a wall with no explanation.

### Debate — Shell rc non-inheritance is a code issue? (Probe 2, Case 2.8)

**Claim (Pass B, original):** `shell: false` spawn in SDK means `.zshrc` env isn't inherited → C-bug.

**Challenge:** That's the MCP client's spawn behavior, not this package's. This repo can't fix how Claude Desktop / Cursor spawn child processes.

**Resolution:** `concede`. Reframed as `docs-gap` only — README already prefers explicit `env` blocks but doesn't warn that GUI-launched clients ignore shell rc. Not this repo's bug, but this repo's docs could surface the trap.

### Debate — Port 3333 conflicts (Probe 3)

**Claim (Pass C):** No EADDRINUSE handler → loud-opaque failure on port conflict.

**Challenge:** 3333 is a rare port. How often do first-timers actually hit this?

**Resolution:** `refine` / demote. Real C-bug (no error handler at `src/http.ts:220`), but low-frequency trigger in 2026. Mentioned only as a secondary case tied to double-start/restart TIME_WAIT.

---

## Cross-frame acknowledgment

The blind-spot note said this frame "stops caring" once the first call succeeds. Categories I deliberately did NOT enumerate, that other frames must cover:

1. **Steady-state reliability beyond the first call** — token expiry/refresh durability (Cases demoted in Probe 3), rate limiting, session-management bugs, long-lived connection stability. Frame 3 or 4 territory.

2. **Multi-workspace, team, and adversarial use** — I did not look at concurrent token storage, multiple-integration scenarios, abuse patterns, or hardening of the callback endpoint against CSRF/replay. Red-team frame should cover.

3. **Tool surface semantics** — I treated `read_page` as the north-star target and didn't audit what `create_page`, `update_page`, `query_database` etc. return, how they handle malformed input, or whether their schemas match Notion's evolving API. A "daily-driver" or "power-user" frame would enumerate these.

4. **Agent-loop behavior at scale** — Case 2.10 (`isError` missing) touches this, but I scoped it narrowly to the first-timer human. A frame focused on agentic workflows should enumerate how the missing flag compounds across multi-tool workflows.

---

## Session chain appendix

My own session: this conversation (claude-opus-4-7[1m], frame-2 explorer dispatch).

Codex sessions (one rebuttal round each):

| Session name | sessionId | Rounds |
|---|---|---|
| `frame2-pass-a-docs-walkthrough` | `019d9e99-ed31-7870-8b4b-8ba9c0a09eb8` | initial + rebuttal |
| `frame2-pass-b-env-surface` | `019d9ea1-4563-70d1-99ce-83b0e69a3be4` | initial + rebuttal |
| `frame2-pass-c-oauth-firstrun` | `019d9eae-3355-7980-9eb5-6dcefe509c84` | initial + rebuttal |
| `frame2-pass-d-docker-crossplat` | `019d9eb3-f0af-7530-ad89-e10894e29f88` | initial + rebuttal |

All dispatches used `agent: codex`, `codex.reasoningEffort: high`. All rebuttals used `mcp__agents__continue_agent` on the same session.

**Fence-offs honored:** did not read `.meta/audits/`, did not read `.meta/research/frame-*-2026-04-17.md`, did not read `use-case-taxonomy-2026-04-17.md` or `compare-awkoy-notion-mcp.md`. No git adds, no commits, no Notion writes.

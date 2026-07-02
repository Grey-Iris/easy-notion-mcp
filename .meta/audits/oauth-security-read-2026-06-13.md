# Bounded OAuth/HTTP security read (2026-06-13)

**Target:** HTTP/OAuth posture of easy-notion-mcp — re-verification of finding **H3** from
`.meta/audits/roadmap-redteam-2026-06-12.md`.
**Method:** Direct adversarial line-level read of `src/http.ts`, `src/auth/oauth-provider.ts`,
`src/auth/token-store.ts` (branch `dev`). READ-ONLY — no edits, no commits, no server start, nothing
on :3333/:8081. No fresh Codex pass: the prior roadmap red-team already had an independent Codex read
(`redteam-roadmap-2026-06-12`) converge on H3; these two claims are unambiguous from the code, and the
brief warns against sprawl.
**Scope:** Exactly the three questions in the brief. Nothing else investigated.

---

## Q1 — Confirm or refute the two claims (file:line evidence)

### Claim A: "Scopes are captured but never enforced." — **CONFIRMED**

Scopes are threaded through the entire OAuth flow and then never consulted to gate anything:
- Captured from the MCP client's `/authorize` request: `oauth-provider.ts:113` (`scopes: params.scopes ?? []`).
- Carried into the pending code: `oauth-provider.ts:239`.
- Persisted on both the access-token and refresh-token records: `oauth-provider.ts:305`, `:316`, `:399`.
- Echoed back to the client in the token response: `oauth-provider.ts:326`, `:409`.
- Returned in `AuthInfo.scopes`: `oauth-provider.ts:431`.

But the enforcement side is empty:
- The SDK bearer middleware is constructed with **no `requiredScopes`**: `http.ts:239-241`
  (`requireBearerAuth({ verifier: oauthProvider })`).
- The session handler pulls **only** `extra.notionToken` from auth and builds the **full** tool
  server — `http.ts:243-246` (`getNotionTokenFromAuth`) feeding `createSessionHandler(..., true)` at
  `http.ts:248`. No record's `scopes` array is ever read to restrict the tool surface.

So the captured scopes are decorative. One valid bearer ⇒ the entire tool surface, regardless of the
scope string requested or granted. (Worth noting the threat-model nuance below: Notion's own OAuth
does not issue granular per-tool scopes anyway — these are MCP-client-requested scope strings, not
Notion permission scopes — so there is no real privilege boundary being dropped today.)

### Claim B: "Refresh tokens never expire and aren't rotated." — **CONFIRMED** (and worse than stated)

- **Never expire:** the refresh-token record is stored with no `expiresAt` by design —
  `oauth-provider.ts:316-319` (the explicit comment: *"No expiresAt for refresh tokens — they last
  until revoked"*).
- **Not rotated:** on refresh exchange the same refresh token string is handed back —
  `oauth-provider.ts:408` (`refresh_token: refreshToken, // Reuse same refresh token`). A new access
  token is minted (`:389-402`) but the refresh token is never rolled.

**Sharpening (confirmed from code, not in the original H3):** the refresh token is not merely a
credential that can *mint* access tokens at `/token` — it is **directly accepted as an access bearer
at `POST /mcp`.** The refresh token is persisted into the *same* record store as access tokens, keyed
by its own value (`oauth-provider.ts:310-319`, `mcpToken: mcpRefreshToken`). `verifyAccessToken`
(`oauth-provider.ts:417-439`) resolves any token via `getByMcpToken` (`token-store.ts:90-93`), and the
expiry guard at `oauth-provider.ts:424` is `if (record.expiresAt && ...)` — skipped entirely when
`expiresAt` is undefined. So `Authorization: Bearer <refreshToken>` against `/mcp` passes auth and
returns full Notion workspace access, with no expiry, forever. The "permanent workspace-token bearer"
in H3 is more immediate than it read: no token-endpoint round-trip required.

Revocation is also per-string only: `revokeToken` deletes exactly `request.token`
(`oauth-provider.ts:448`), and access vs. refresh are stored as two unlinked records — revoking the
access token does not revoke its sibling refresh token, and vice versa. (`deleteByRefreshToken` at
`token-store.ts:106` keys off the *Notion* refresh token field, not the MCP refresh token, so it does
not help here.)

---

## Q2 — Real exposure for the typical self-hosted user

**The typical deployment runs static-token mode, and the entire OAuth surface above is dead code there.**
The OAuth provider, token store, and scope/refresh machinery are loaded **only** behind
`if (useOAuth)` via dynamic import (`http.ts:194-203`); `useOAuth` requires both
`NOTION_OAUTH_CLIENT_ID` and `NOTION_OAUTH_CLIENT_SECRET` (`http.ts:93`). A static-token operator
(`NOTION_TOKEN` + `NOTION_MCP_BEARER`) never instantiates any of it — auth is the constant-time bearer
compare at `http.ts:50-86`, default bind is loopback `127.0.0.1` (`http.ts:46-48`).

| Item | Static-token single-tenant (the typical user) | OAuth-mode, loopback, single operator | OAuth-mode, publicly exposed |
|---|---|---|---|
| Scopes unenforced | **N/A** — code path not loaded | **Near-zero** — operator owns the one token; no privilege boundary to drop, and Notion grants no granular scopes anyway | **Latent** — only bites if someone builds restricted multi-tenant delegation expecting scope strings to mean something |
| Refresh non-expiry / non-rotation / usable-as-access-bearer | **N/A** — code path not loaded | **Latent** — tokens.json is AES-256-GCM encrypted at rest under a 0600 key (`token-store.ts:39`, `:43-50`); refresh token only transits the local `/token`/`/mcp` endpoints on loopback | **Real but bounded** — a refresh token leaked (logs, proxy, backup of tokens.json + key) is a permanent, non-revocable-by-rotation workspace bearer until manual file deletion or key rotation |

**Honest bottom line:** for the user the brief describes — self-hosted, single-tenant, static-token,
loopback — the real exposure of **both** items is **near-zero / not-applicable**. The risk is entirely
latent and only materializes for an OAuth-mode deployment, and becomes *material* only when that OAuth
deployment is publicly exposed and/or aspires to multi-tenant. The more material of the two is the
refresh-token weakness (non-expiry + directly usable as an access bearer), not scope enforcement.

---

## Q3 — Minimal tightening, breaking vs. non-breaking

| Item | Smallest change that closes it | Breaking to existing HTTP/OAuth consumers? | Sequencing |
|---|---|---|---|
| Scopes unenforced | If documenting the boundary suffices for 1.0: one sentence in the OAuth docs stating "a valid bearer grants the full tool surface; requested scopes are not enforced." If enforcing: gate tools on `record.scopes`, defaulting to full access when no narrow scope was requested. | **Non-breaking** — today everyone has full access; default-full + restrict-only-when-explicitly-narrowed preserves every current client. | Post-1.0 (or doc-only at 1.0) |
| Refresh usable as access bearer | Tag records `kind: "access" | "refresh"` and reject refresh-kind records in `verifyAccessToken` (refresh tokens are only valid at `/token`). | **Non-breaking** — compliant clients present access tokens at `/mcp` and refresh tokens only at `/token`. | Recommended soon; not freeze-blocking |
| Refresh never expires | Set an `expiresAt` on refresh records (e.g. 30–90 days). | **Non-breaking at the protocol level** — clients already must handle refresh failure by re-authorizing; only a long-idle client is forced to re-consent. | Post-1.0 |
| Refresh not rotated | On `exchangeRefreshToken`, mint a new `mcpRefreshToken`, delete the old record, return the new one (`oauth-provider.ts:404-410`). | **Non-breaking** — OAuth clients are required to adopt the returned `refresh_token`; rotation is standard. | Post-1.0 |

None of these tightenings change the token-response *shape* or any discovery document in a way that
breaks a compliant consumer. They are **security-gated, not freeze-gated** — confirming the roadmap's
H3 calibration. The one I would not leave indefinitely is the refresh-token-as-access-bearer behavior,
since it makes a leaked refresh token a turnkey permanent credential.

---

## Out-of-scope, noted for later (not investigated)

Spotted while reading, deliberately left alone per the brief's bounds: the OAuth `issuerUrl` is
hard-coded to `http://localhost:${port}` (`http.ts:220`) and the provider's default `redirectUri`
likewise (`oauth-provider.ts` / `http.ts:211`), which constrains non-localhost OAuth deployments;
`InMemoryClientsStore` accepts any Dynamic Client Registration with no policy (`oauth-provider.ts:57-70`);
and pending auth-session/code TTL cleanup is a 5-min interval sweep against a 10-min max-age rather
than checked at use (`oauth-provider.ts:454-469`, `http.ts:215`). Flagging only — not assessed.

---

## Summary (freeze decision + one line per item)

1. **Claim A (scopes unenforced): CONFIRMED.** `http.ts:239-246` reads only `notionToken`; `record.scopes`
   is captured/echoed but never gates tools. → *Doc the boundary at 1.0; enforcement is non-breaking, post-1.0.*
2. **Claim B (refresh never expires / not rotated): CONFIRMED, and worse** — the refresh token is
   directly accepted as a non-expiring access bearer at `/mcp` (`oauth-provider.ts:310-319,424`). →
   *Non-breaking to fix; do the access-bearer rejection soon, expiry+rotation post-1.0.*
3. **Real exposure for the typical user (static-token, single-tenant, loopback): near-zero / N/A** —
   the whole OAuth surface is dynamic-imported only under `useOAuth` (`http.ts:194-203`) and never
   loads. Risk is latent, materializing only for publicly-exposed OAuth-mode deployments.
4. **Freeze-blocking? NO.** Every tightening is non-breaking to compliant consumers, so all four are
   security-gated, not freeze-gated — matching the roadmap's H3 calibration. The 1.0 doc's only
   obligation is to *name* both as accepted boundaries; the fixes can land after the freeze.
5. **Highest-value single fix (non-breaking, do regardless of 1.0):** reject refresh-kind records in
   `verifyAccessToken` so a refresh token cannot be replayed as a permanent `/mcp` access bearer.

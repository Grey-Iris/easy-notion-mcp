# Hono supply-chain exposure and fix-path analysis

**Date:** 2026-04-09
**Scope:** Transitive `hono` / `@hono/node-server` advisories blocking PR #18 CI
**Posture:** Neutral — this report de-risks the three fix options. It does not pick one.

## Executive summary

1. **The "not exploitable" claim is supportable on the code-path evidence.** The MCP SDK's production code imports exactly one symbol from the hono tree — `getRequestListener` from `@hono/node-server` — and touches none of the vulnerable APIs (`serveStatic`, `getCookie`/`setCookie`, `ipRestriction`, `toSSG`). Our own `src/` does not import hono at all. (high confidence)
2. **Option B as currently scoped does NOT protect end users.** npm's `overrides` field is only honored when it lives in the *root* `package.json`. When a consumer runs `npx easy-notion-mcp` or `npm install easy-notion-mcp`, their `package.json` is the root — ours is not — so any overrides we add are ignored by their resolver. Option B helps our CI only. (high confidence, docs + empirical)
3. **End users installing fresh today *already* get the patched versions.** The SDK's caret ranges (`hono: ^4.11.4`, `@hono/node-server: ^1.19.9`) already permit `4.12.12` / `1.19.13`, and a clean install resolves to them. The only place still carrying vulnerable versions is our committed `package-lock.json`. A lockfile refresh (`npm update hono @hono/node-server`) fixes CI without any `package.json` change. (high confidence, empirical)
4. **Upstream signal is mixed.** The SDK maintainer closed a prior bump PR (#1709) on the incorrect premise that hono is a peer dep — it is a regular dep in every published version including `1.29.0`. A v2-alpha architecture split (`@modelcontextprotocol/hono`, `@modelcontextprotocol/node`) is in progress but not shipped. (medium confidence)

---

## Q1 — SDK hono usage

**Question:** What vulnerable hono code paths does the installed SDK exercise?

**Method:** Grepped `node_modules/@modelcontextprotocol/sdk/dist/` for every `hono` / `@hono/*` import and for each vulnerable symbol name.

**Findings:**

- **Only one production hono import in the shipped SDK:**
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js:9` —
  `import { getRequestListener } from '@hono/node-server';`
  (CJS mirror: `dist/cjs/server/streamableHttp.js:12`.)
  Used at `streamableHttp.js:57` to build a request listener that adapts Node HTTP into a Web-standard handler and delegates to `WebStandardStreamableHTTPServerTransport`. No other hono functions are invoked on that path.
- **Zero imports from the `hono` core package** in non-example SDK code. The only `hono`/`hono/cors` imports are in `dist/{esm,cjs}/examples/server/honoWebStandardStreamableHttp.*` — example files that are never loaded unless an SDK user explicitly imports that example entrypoint. Our code does not.
- **Vulnerable-symbol grep came back clean** across the entire SDK `dist/`:
  - `serveStatic` — 0 matches
  - `getCookie` / `setCookie` — 0 matches
  - `ipRestriction` — 0 matches
  - `toSSG` — 0 matches
- **`serveStatic` is code-split inside `@hono/node-server`.** It lives in its own entry file (`node_modules/@hono/node-server/dist/serve-static.{js,mjs}`); `dist/index.js` and `dist/listener.js` (where `getRequestListener` lives) contain no reference to `serveStatic` or `serve-static`. So importing `getRequestListener` does not transitively load the vulnerable module on startup.
- **Our own repo does not use hono directly.** `grep -r hono src/` returns nothing; `src/http.ts:4` imports `StreamableHTTPServerTransport` from the SDK and never reaches into hono itself.

**Per-advisory mapping:**

| Advisory | Vulnerable API | Imported anywhere on our path? |
|---|---|---|
| GHSA-92pp-h63x-v22m | `@hono/node-server` `serveStatic` | No |
| GHSA-wmmm-f939-6g9c | `hono` `serveStatic` | No |
| GHSA-26pp-8wgv-hjvm, GHSA-r5rp-j6wh-rvv4 | `hono` cookie helpers | No |
| GHSA-xpcf-pg52-r92g | `hono` `ipRestriction()` | No |
| GHSA-xf4j-xp2r-rqqx | `hono` `toSSG()` | No |

**Confidence: high.** The grep is exhaustive over `dist/`, the only remaining risk is that the SDK's transport classes lazily instantiate something we didn't statically catch — unlikely given how thin `streamableHttp.js` is (it's a 1-symbol wrapper). If the orchestrator wants stronger assurance, the next step would be dynamic: run `node -e` requiring the transport and inspect the module graph with `require.cache`.

---

## Q2 — Do npm `overrides` reach end users?

**Question:** If we add `"overrides": { "hono": "^4.12.12", "@hono/node-server": "^1.19.13" }` to our `package.json`, does it protect users running `npx easy-notion-mcp`?

### Docs evidence

Verbatim quote from `https://docs.npmjs.com/cli/v11/configuring-npm/package-json/`, "overrides" section:

> "Overrides are only considered in the root `package.json` file for a project. Overrides in installed dependencies (including workspaces) are not considered in dependency tree resolution."

This is unambiguous: when we are installed as a dependency, our overrides do not participate in the consumer's dependency-tree resolution. This has been the documented behavior since overrides shipped (see also `npm/cli#4517` requesting clearer docs on exactly this point).

### Empirical confirmation

Scratch reproduction in `/tmp/` (outside the repo, no repo state touched):

**Case A — consumer with overrides declared at *their* root (`/tmp/override-test`):**

```json
{ "dependencies": { "easy-notion-mcp": "0.2.4" },
  "overrides": { "hono": "4.12.12", "@hono/node-server": "1.19.13" } }
```

```
$ npm ls hono @hono/node-server
override-test@1.0.0 /tmp/override-test
└─┬ easy-notion-mcp@0.2.4
  └─┬ @modelcontextprotocol/sdk@1.29.0
    ├─┬ @hono/node-server@1.19.13 overridden
    │ └── hono@4.12.12 deduped
    └── hono@4.12.12 overridden
```

The `overridden` marker and patched versions prove the override took effect — **because the override sits in the consumer's root**.

**Case B — consumer with no overrides (`/tmp/no-override-test`):**

```json
{ "dependencies": { "easy-notion-mcp": "0.2.4" } }
```

```
$ npm ls hono @hono/node-server
no-override-test@1.0.0 /tmp/no-override-test
└─┬ easy-notion-mcp@0.2.4
  └─┬ @modelcontextprotocol/sdk@1.29.0
    ├─┬ @hono/node-server@1.19.13
    │ └── hono@4.12.12 deduped
    └── hono@4.12.12
```

**A fresh consumer install already lands on the patched versions even without any overrides**, because the SDK's caret ranges permit them and npm picks the latest matching on a greenfield install. Two consequential findings fall out of this:

1. **Option B (overrides in our `package.json`) is effectively CI-only.** It cannot protect an `npx` user — `npx easy-notion-mcp` generates an ephemeral root `package.json` that depends on us, and our overrides are not "root". It patches our own CI because in our repo our `package.json` *is* root.
2. **Option B is also redundant for end users.** They already get patched versions from a clean install today. The vulnerable versions are only pinned inside *our committed `package-lock.json`* — which never reaches end users (we don't ship a lockfile to `npm publish`, and `.npmignore`/`files` doesn't include it). A simple `npm update hono @hono/node-server` in our repo would refresh the lockfile to `4.12.12` / `1.19.13` and unblock `npm audit` with no `package.json` change at all.

**Confidence: high.** Docs + empirical, both cases reproduced. I did not separately reproduce the `npx` cache path — the docs text covers it (the temp root generated by `npx` is not our `package.json`).

---

## Q3 — Upstream MCP SDK status

**Issues/PRs mentioning hono or audits:**

- **PR `modelcontextprotocol/typescript-sdk#1709`** — "chore(deps): bump hono from 4.11.4 to 4.12.7" (Mar 27, 2026). **Closed, not merged.** Maintainer comment (`felixweinberger`):
  > "Thanks for flagging the CVEs. Hono is a peer dependency though, so consumers bring their own version and `npm audit` / dependabot will flag these on their end. We keep peer dep minimums loose unless the SDK itself needs a newer API. Closing."

  **This rationale does not match current reality.** `npm view @modelcontextprotocol/sdk@latest peerDependencies` returns `{ '@cfworker/json-schema': '^4.1.1', zod: '^3.25 || ^4.0' }` — hono is **not** a peer dep. It is listed under `dependencies` in every published version including `1.29.0` (`npm view @modelcontextprotocol/sdk@latest dependencies` shows `hono: ^4.11.4`, `@hono/node-server: ^1.19.9`). A polite correction on the closed PR is warranted.
- **PR #1480** — older dependabot bump from `4.11.3 → 4.11.4`, merged.
- **PR #1493** — "hono: add maxBodyBytes guard for JSON parsing" — open, scope unrelated to these advisories.
- **v2-alpha packages are live on npm** (`@modelcontextprotocol/hono@2.0.0-alpha.2`, `@modelcontextprotocol/node@2.0.0-alpha.2`, published 2026-04-01). This confirms a transport split is in progress — in v2, hono may genuinely become optional/peer — but it is not the shipping v1 architecture today.
- **Latest stable release:** `v1.29.0` published 2026-03-30. Release cadence is roughly weekly based on the tag timeline (1.27.x → 1.29.0 over March).
- **`SECURITY.md` exists** and points to the GitHub private-advisory reporting path. No public email contact.

**No open upstream issue specifically tracking GHSA-26pp / GHSA-wmmm / GHSA-92pp / GHSA-xpcf / GHSA-xf4j.** PR #1709 was the closest and it was closed on incorrect rationale.

**Draft issue to file upstream (NOT posted):**

> **Title:** `deps: raise hono / @hono/node-server minimums above GHSA-26pp, GHSA-wmmm, GHSA-92pp (hono is not a peer dependency)`
>
> **Body:**
> The SDK's `dependencies` (not `peerDependencies`) still pin `hono: ^4.11.4` and `@hono/node-server: ^1.19.9`. Downstream servers (`easy-notion-mcp` is one; `@modelcontextprotocol/server-filesystem` and similar are transitively affected too) fail `npm audit` on PR #18-era advisories because lockfile resolution inside the SDK picks versions below `4.12.12` / `1.19.13`.
>
> `#1709` was closed as "hono is a peer dep", but `npm view @modelcontextprotocol/sdk@1.29.0 peerDependencies` returns only `@cfworker/json-schema` and `zod` — hono is a hard runtime dependency. Consumers cannot "bring their own" without adding an `overrides` entry at their own root (which doesn't help their users either, since overrides don't propagate).
>
> Proposed fix: bump the caret floors to `hono: ^4.12.12` and `@hono/node-server: ^1.19.13`. This is a patch-range bump with no API surface change per the hono 4.12.x changelog. Affected advisories: GHSA-26pp-8wgv-hjvm, GHSA-wmmm-f939-6g9c, GHSA-92pp-h63x-v22m, GHSA-r5rp-j6wh-rvv4, GHSA-xpcf-pg52-r92g, GHSA-xf4j-xp2r-rqqx.

**Confidence: medium.** The peer-dep contradiction is solid, but I am inferring maintainer intent from a single comment. They may reopen on correction or may stand firm for architectural reasons I can't see.

---

## Q4 — Newer SDK already fixes this?

**Method:** `npm cache clean --force && npm view @modelcontextprotocol/sdk versions --json` (the cached view initially reported stale data — see "flagged" below).

**Findings:**

- Latest published: **`@modelcontextprotocol/sdk@1.29.0`** (2026-03-30).
- Our pin `^1.26.0` already resolves to `1.29.0` on a fresh install (confirmed in the `/tmp/no-override-test` npm ls output).
- `1.29.0` direct dependencies (`npm view @modelcontextprotocol/sdk@1.29.0 dependencies`):
  - `hono: ^4.11.4`
  - `@hono/node-server: ^1.19.9`
- Latest published `hono` on registry: **`4.12.12`**. Latest `@hono/node-server`: **`1.19.13`**. Both are within the SDK's caret ranges and resolve on a greenfield install — confirmed empirically in Q2.
- **No SDK version currently hard-pins hono ≥ 4.12.12.** Every 1.x version still uses `^4.11.4`. Bumping the SDK pin alone buys nothing beyond what `npm update` already does.

**The practical implication for Option C:**

- "Bump SDK" does not help, because the SDK doesn't raise its hono floor.
- "Refresh lockfile" *does* help, because `^4.11.4` already allows `4.12.12`. A one-line CI job — `npm update hono @hono/node-server` — updates `package-lock.json` in place, no `package.json` diff, no `overrides` block.

**Confidence: high.**

---

## Q5 — Ecosystem signal

Spot-checked three published MCP servers plus the official servers monorepo:

| Package | Latest | SDK pin | Repo overrides? | Repo audit in CI? |
|---|---|---|---|---|
| `@modelcontextprotocol/server-filesystem` | `2026.1.14` | `^1.25.2` (monorepo src/filesystem/package.json pins `^1.26.0`) | No | No audit step |
| `@modelcontextprotocol/server-everything` | `2026.1.26` | `^1.25.2` | No | No audit step |
| `@modelcontextprotocol/server-github` | `2025.4.8` | `1.0.1` (pinned old) | Unknown (repo not checked) | — |

Evidence:

- `gh api repos/modelcontextprotocol/servers/contents/src/filesystem/package.json` — no `overrides` field in the decoded JSON.
- `gh search code --repo modelcontextprotocol/servers "overrides"` — zero hits anywhere in the monorepo.
- `.github/workflows/typescript.yml` in the servers monorepo runs `npm ci`, `npm test`, `npm run build`. **There is no `npm audit` or `dependency-review-action` step.** So the monorepo does not block PRs on transitive advisories at all — it is not "handling" these advisories, it is not looking.
- `server-github` is pinned to `@modelcontextprotocol/sdk@1.0.1`, which predates the streamable-HTTP transport entirely and may not pull hono at all. Not a useful comparison.

**Interpretation:** the rest of the ecosystem is silent on these advisories because they do not gate CI on them. Our current allowlist pattern (commit `8c20a1b`) is ahead of the ecosystem, not behind. "Everyone else is ignoring it" is data, but, per the task brief, not a justification — especially given the open-source posture in `CLAUDE.md:9` ("theoretically safe is not the bar").

**Confidence: medium** — three servers is a narrow sample; I didn't check community servers with higher weekly downloads (didn't find good candidates in the time I was willing to spend on npm search).

---

## Decision matrix

Each option, with newly surfaced pros/cons. No recommendation.

### Option A — extend CI allowlist to the new GHSAs

| | |
|---|---|
| Pros | Zero code/dependency change. Matches the existing `path-to-regexp` pattern and `CLAUDE.md:9`'s "file:line evidence" bar because Q1 *does* supply that evidence. |
| Cons | Adds entries to a public allowlist that encodes a security claim. Each entry needs an accompanying comment saying what was checked and when. Does nothing for end users who run their own `npm audit` against our installed tree; they will still see the advisories. |
| New signal | Q1 gives us the evidence to defend "not exploitable" honestly. Q2 shows end users are already safe via clean install, independent of what CI does. |

### Option B — `overrides` in `package.json`

| | |
|---|---|
| Pros | Fixes our CI. Declarative, visible in the diff. |
| Cons | **Does not propagate to downstream consumers** (Q2, high confidence, docs + empirical). It is CI theater with respect to end-user protection. Also, as a direct dependency of neither us nor the SDK, the override spec must be a raw version range — we can't use the `$name` shorthand. |
| New signal | A simple lockfile refresh (`npm update hono @hono/node-server`) achieves the same CI effect without touching `package.json`. The overrides block is superfluous. |

### Option C — bump MCP SDK

| | |
|---|---|
| Pros | Upstream-first path per `CLAUDE.md:10`. |
| Cons | **No 1.x SDK version pins hono ≥ 4.12.12.** Bumping from `1.27.1 → 1.29.0` produces zero audit change because both pin `hono: ^4.11.4`. The actual fix is a lockfile refresh (`npm update`), which works without any SDK pin bump. |
| New signal | Option C as described ("bump the SDK") is a non-op. The path that delivers its intent is "refresh lockfile + file upstream issue correcting the peer-dep claim on #1709". Those are two actions, and only the upstream issue is actually Option C. |

**A fourth path the task brief didn't list:** `npm update hono @hono/node-server` → refreshes `package-lock.json` only → CI passes → end users already get patched versions on clean install → zero `package.json` churn → can ship alongside the draft upstream issue from Q3. Flagging because Q2 + Q4 combined change the shape of the problem.

---

## Unverified / flagged

- **Dynamic hono loading.** My Q1 evidence is static (grep across SDK `dist/`). I did not run the SDK and dump `require.cache` to prove no lazy hono import happens at request time. Static evidence is strong because `streamableHttp.js` is small and does no dynamic `require`, but confirm with a dynamic pass if the orchestrator wants maximal assurance.
- **npm cache staleness.** My first run of `npm view hono version` returned `4.12.9`. After `npm cache clean --force` it returned `4.12.12`. Every version-related claim in this report is from the post-clean run. The orchestrator should be aware that any builder dispatched later may need to clear the npm cache before trusting `npm view` output.
- **`.npmignore` / `files` check not performed.** I claim in Q2 that `package-lock.json` does not reach end users. I did not actually inspect `package.json`'s `files` field or `.npmignore` to confirm. Worth a 30-second double-check before relying on that claim in a commit message.
- **Community server sample.** Q5 only covered first-party `@modelcontextprotocol/server-*` packages; I did not identify or check community servers with >1k weekly downloads. If ecosystem signal is load-bearing for the decision, broaden the sample.
- **`npx` cache path not separately reproduced.** Q2's empirical tests use `npm install` into a scratch dir, not `npx -p easy-notion-mcp -c '...'`. The npm docs quote covers it definitively, but an orchestrator who wants belt-and-braces could `npx -p easy-notion-mcp@0.2.4 -c 'npm ls hono'` and confirm the same result.
- **Maintainer intent on #1709.** I'm interpreting one maintainer comment. A polite issue/PR that corrects the peer-dep misunderstanding may or may not succeed — confidence on "upstream will accept a bump" is low.

---

## Session chain

- Audit PM session: this report (no named session handle; ran in the orchestrator's spawned subagent).
- Codex sessions dispatched: **none.** This audit was narrowly scoped to five factual questions with clear evidence requirements (file greps, npm registry queries, one empirical install, GitHub API queries, npm docs quotes). Codex was not dispatched because every question resolved to a bounded lookup rather than a codebase-wide scan — dispatching Codex would have added latency without adding independence on questions whose answers are a single grep or a single curl. Flagging this explicitly so the orchestrator can judge whether that was the right call; if Codex independence matters for the "not exploitable" claim specifically, a Codex pass over the SDK `dist/` for Q1 would be the highest-value single dispatch.

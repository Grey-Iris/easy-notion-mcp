# Plan: One-command bootstrap for easy-notion-mcp

- **Status:** Draft for human review (Plan → review → build)
- **Date:** 2026-06-26
- **Branch:** `plan/one-command-bootstrap`
- **Ratifies:** decision `invest-in-one-command-bootstrap` (2026-06-25) — a one-command bootstrap is the highest *adoption* lever post-1.0.
- **Scope:** Plan/spec only. No implementation in this branch.

---

## 1. The problem, stated honestly

Setup today is two separable chores, and only one of them is automatable:

1. **Client registration** — getting an `easy-notion-mcp` entry into the MCP client's config. Today this is a hand-copied `claude mcp add ...` incantation, or hand-edited JSON for Cursor/Windsurf/Claude Desktop/VS Code, each with a different file path and (for VS Code) a different top-level key. **Automatable.**
2. **Credential acquisition** — creating a Notion integration at notion.so/my-integrations, copying the token, and *sharing pages with the integration*. **Not automatable** for the API-token path: those clicks happen inside Notion's UI on Notion's domain. OAuth could remove the copy-paste, but only by standing up a public HTTP server with a registered public integration — heavyweight, and on the *experimental* (unfrozen) auth surface.

So "one command" cannot mean "zero human steps." It means: **collapse the read-docs → create-integration → guess-the-incantation → edit-JSON → share-pages → test loop into a single guided wizard that does every step it legitimately can, validates the result live, and hands the user the exact remaining manual step when it hits one it can't.**

That reframing is the core of this plan. A bootstrap that *claims* to be one-command but silently leaves the user with a valid token and zero shared pages (the #1 silent-failure mode) is worse than the current honest README.

## 2. What "one command" sets up (the command surface)

**Primary documented command:**

```bash
npx easy-notion-mcp@latest init
```

`@latest` is deliberate — `npx` will otherwise happily run a stale cached copy.

**Implementation note (additive, load-bearing):** the `easy-notion-mcp` bin → `dist/index.js`, which today reads `NOTION_TOKEN` and **constructs the server at module top level**, exiting immediately if the token is unset (`src/index.ts:7-11`). Two things follow (both from Codex review):

- The top-level work must be refactored into a `main()` so the `init` branch can run *before* the token check and server construction.
- The branch should be a **lazy dynamic import**: `if (argv[2] === "init") { await import("./cli/init.js"); return; }` placed first. This keeps no-arg stdio startup from pulling the wizard/prompt stack into the hot path, and isolates the `init` code from the server-boot code.

The branch triggers **only** on an explicit `init`/`setup` first arg. The stdio invariant is stated precisely in §5 (not "byte-for-byte" — see there).

**Wizard does NOT route through `runCli`'s return path.** The `easy-notion` CLI (`src/cli/run.ts:2041`) always JSON-serializes command results to stdout (`writeJson`). That is correct for machine-consumed CLI commands and *wrong* for an interactive human wizard. The wizard is its own module (`src/cli/init.ts`) with its own human-facing I/O; it is reachable as `easy-notion init` via a dispatch case, but that case calls the wizard directly and must not let the JSON result wrapper leak into the UX. One implementation, two entrypoints (`npx easy-notion-mcp init` documented; `easy-notion init` as the CLI-bin alias).

**What the wizard does, in order:**

1. **Detect installed clients.** Probe for `claude` and `code` on PATH (with fallbacks — see footguns), and for known config-file locations of Cursor/Windsurf/Claude Desktop. Present the detected set; let the user pick which to configure (default: all detected).
2. **Acquire a token (API-token path, the default).** Open the browser to https://www.notion.so/my-integrations, instruct the user to create an internal integration and paste the token. **Validate it live with `get_me`** before writing it anywhere. Reject a token that doesn't authenticate.
3. **Sane defaults.** Optionally capture a `NOTION_ROOT_PAGE_ID` (prompt, or skip). Optionally set up a CLI profile (`profiles.json`) — deferred to Phase 3.
4. **Register into each chosen client** (mechanism per §4).
5. **Verify end-to-end.** Run a live `get_me` to confirm the token authenticates. Then check for the *no-pages-shared* state. **Empty `search` is a warning, not proof** (Codex: database-only sharing and search-index quirks can yield an empty result for a correctly-shared workspace). So: if `search` is empty, surface "your token is valid but I couldn't see any shared pages — open a page → ••• → Connections → add your integration" as a *warning*, and offer the stronger check — ask the user to paste one page URL and retrieve it directly, which proves sharing deterministically.
6. **Cookbook skill (optional, opt-in).** Offer to install the `notion-recipes` / `easy-notion-cli` skills into `~/.claude/skills/` for Claude Code users; for other clients, print the path and a docs pointer (see §6).
7. **Report.** Print exactly what was configured, what was skipped, and any remaining manual step.

**Non-interactive form (Phase 3):** `easy-notion init --client claude --token-env NOTION_TOKEN --yes` for scripted installs. Phase 1 is interactive-only.

## 3. Target clients

| Client | Mechanism available | v1 tier | Notes |
|---|---|---|---|
| **Claude Code** | `claude mcp add` / `get` / `list` CLI | **Phase 1** | Primary audience; the only client with idempotency primitives (`get`/`list`). |
| **VS Code (Copilot)** | `code --add-mcp '{...}'` CLI | **Phase 2** | True shell-out CLI. Uses top-level `servers`, **not** `mcpServers`. |
| **Cursor** | JSON deep-merge (`~/.cursor/mcp.json`) | **Phase 2** | No general CLI. Deep-link is README-button-only (needs a UI click). |
| **Windsurf** | JSON deep-merge (`~/.codeium/windsurf/mcp_config.json`) | **Phase 2** | No CLI. |
| **Claude Desktop** | JSON deep-merge (`claude_desktop_config.json`) | **Phase 2** | No CLI; Windows MSIX path bug; requires app restart. |
| **claude.ai web connectors** | **None — architecturally impossible** | **Out of scope** | claude.ai connects from Anthropic's cloud to a *public HTTPS* endpoint with OAuth. A local stdio npm package can never be a claude.ai connector. Document this explicitly so it isn't mistaken for an oversight. |

**v1 client decision:** Phase 1 ships **Claude Code only** (the project's primary audience, and the safest mechanism — delegate to a CLI that owns its own config format and gives us idempotency for free). Phase 2 adds the other four local clients. claude.ai is permanently out for a local-npx bootstrap.

**Two corrections flagged by Codex review:**
- **Existing-server name is `notion`, not `easy-notion-mcp`.** The current README registers Claude Code (`claude mcp add notion ...`, README:60) and the JSON examples (README:87, README:199) under the server key `notion` in some places and `easy-notion-mcp` in others. Idempotency detection therefore cannot key on a single fixed name — see §8.
- **Windsurf config path is wrong in the current README.** Plan uses `~/.codeium/windsurf/mcp_config.json` (matches current Windsurf docs); README:98 still says `~/.windsurf/mcp.json`. The README needs correcting when Phase 2 lands (track as a Phase 2 doc task).

## 4. Design space and recommendation

Three mechanisms for getting the registration in place:

### Approach A — Shell-out only
Delegate to each client's own CLI where one exists (`claude mcp add`, `code --add-mcp`); print copy-paste blocks for the rest.
- **Pro:** Never touches a user-owned JSON file → smallest footgun surface; idempotency and format-correctness are the client's problem.
- **Con:** Only Claude Code and VS Code have CLIs. "One command" degrades to "one command for two clients, manual for Cursor/Windsurf/Desktop." Thin coverage.

### Approach B — Direct JSON config writer
Detect each client's config file and deep-merge an `easy-notion-mcp` entry.
- **Pro:** Uniform coverage of every local client.
- **Con:** Merging into hand-edited user files is the whole footgun catalogue — backups, atomic writes, not clobbering sibling servers, idempotent re-runs, the `servers` vs `mcpServers` divergence, cross-OS paths, the Claude Desktop MSIX path bug, restart prompts. Every one of these is a way to corrupt a user's working config.

### Approach C — Hybrid *(recommended)*
**Prefer the client's own CLI where one exists; fall back to guarded JSON deep-merge where it doesn't.** Claude Code → `claude mcp add`. VS Code → `code --add-mcp`. Cursor/Windsurf/Claude Desktop → JSON deep-merge with backup + atomic write + idempotency check + explicit pre-write confirmation showing the user the diff. **The shown diff must redact `env.NOTION_TOKEN`** (Codex caught the conflict with "never print the token" in §8) — show `NOTION_TOKEN: ntn_••••` not the value.
- **Pro:** Broadest *real* coverage while using the safest available mechanism per client. The dangerous JSON-merge path is confined to the three clients that genuinely have no alternative, and is gated behind a shown-diff confirmation.
- **Con:** Two code paths to maintain. Acceptable — they split cleanly along "has a CLI / doesn't."

**Recommendation: Approach C, delivered in phases** — Phase 1 is purely the shell-out path for Claude Code (Approach A restricted to one client, zero JSON-file risk), which de-risks the wizard core. Phase 2 adds the JSON-merge path (the genuinely hard, footgun-heavy part) once the wizard skeleton is proven.

**Tradeoff for human sign-off:** Phase 1 ships value to the primary audience (Claude Code) with essentially no risk of corrupting user config. The cost is that Cursor/Windsurf/Desktop users get nothing better than today's README until Phase 2. If broad-client coverage on day one matters more than shipping-safe-and-early, Phase 1 and 2 could merge — but that front-loads all the JSON-merge risk. **Recommend shipping Phase 1 first.**

## 5. Contract impact

This ships **fully additive**; nothing here touches the frozen 1.0 contract.

- **MCP tool contract (frozen, additive-only):** untouched. No new tools, no schema changes, no return-shape changes, no markdown-convention or warning-code changes. The bootstrap is a CLI/entrypoint concern, not an MCP-surface concern. ✅
- **`easy-notion` CLI:** explicitly **pre-1.0 and outside the freeze** (README "Stability and versioning"). A new `init` subcommand is doubly safe. ✅
- **`npx easy-notion-mcp` (no args) hero command:** must keep working as a stdio server. "Byte-for-byte unchanged" was too strong (Codex). The **realistic, testable invariant** is: no-arg invocation (a) emits nothing on **stdout** except JSON-RPC, (b) reaches `server.connect`, (c) keeps current **stderr** behavior, and (d) requires no new env vars. The existing `tests/stdio-startup.test.ts` covers the baseline; Phase 1 adds (i) a no-arg protocol-handshake assertion and (ii) an `init`-without-`NOTION_TOKEN`-succeeds test (proving the branch runs before the token-required exit). **This is the single contract-adjacent risk.** ✅
- **`profiles.json` schema:** Phase 3 may write it; the format is already established and any additions are additive. ✅
- **New env vars:** none required. Reuse `EASY_NOTION_CONFIG_DIR`, `NOTION_TOKEN`, `NOTION_ROOT_PAGE_ID`.

**Nothing in this plan requires a breaking change.** If a future iteration wanted to change the *default* behavior of `npx easy-notion-mcp` (no args) to run the wizard instead of the server, *that* would be breaking and is explicitly rejected here.

## 6. Cookbook skill integration

The npm tarball already ships `skills/` (`package.json` `files` includes `"skills"`), so `notion-recipes` and `easy-notion-cli` are present on disk wherever the package is installed. Bootstrap's role is to *surface* them, opt-in:

- **Claude Code (Phase 1, pointer only):** after registration, print the on-disk skill path and how to use it; offer (y/N) to copy `skills/notion-recipes` and `skills/easy-notion-cli` into `~/.claude/skills/`.
- **Actually copy into `~/.claude/skills/` (Phase 2):** with idempotency (don't overwrite a user-modified copy without asking).
- **Other clients:** skills are a Claude-Code concept; just print a docs pointer.

Keep this strictly optional. The bootstrap's headline job is registration + credential validation; the skill is a value-add, not a gate.

## 7. Runtime premises

This plan rests on external runtime behavior that training data can drift on. **Correction from Codex review:** these are **runtime** probes the wizard performs on the user's machine, *not* build-time/CI probes — CI machines have no authenticated `claude`/`code`/Cursor/Windsurf and no Notion token. The build's job is to **unit-test the probe-and-fallback logic with fakes**; genuine live probes belong in an opt-in integration harness (like the existing e2e harness), never in default CI.

1. **`claude mcp add --scope user --transport stdio <name> -e KEY=VAL -- npx -y easy-notion-mcp` is the correct registration form.** Verified against current Claude Code docs (2026). *Runtime:* wizard runs `claude --version`/`claude mcp list` and degrades to a copy-paste block if the surface differs. *Build:* unit-test the command-construction + fallback with a fake exec.
2. **`claude mcp get <name>` returns non-zero / empty on not-found.** Research notes this is the *expected* convention but **not formally documented**; idempotency depends on it. *Runtime:* the wizard tolerates both signals and falls back to parsing `claude mcp list`. *Live harness:* capture `claude mcp get nonexistent-xyz; echo $?` once to confirm; do not gate CI on it.
3. **`code --add-mcp '{...}'` exists and accepts `{"name","command","args","env"}` (VS Code ≥1.102).** Verified via research. *Runtime:* probe `code --version` ≥ 1.102 before use; else JSON-merge `.vscode/mcp.json`.
4. **Client config paths and the `servers` (VS Code) vs `mcpServers` (all others) key divergence are as tabled in §3.** Verified via research. *Build:* per-client path+key table in code with a unit test asserting VS Code uses `servers`; prefer shell-out so we lean on paths as little as possible.
5. **`npx easy-notion-mcp` with no args still satisfies the stdio invariant (§5).** *Build:* extend `tests/stdio-startup.test.ts` with the handshake + `init`-without-token tests described in §5.
6. **`get_me` proves the token; empty `search` does NOT prove no-pages-shared.** *Corrected per Codex:* `get_me` is a sufficient liveness check, but a valid-token-but-no-shared-pages state is only *suggested* by an empty `search`, not proven (database-only sharing, index lag). The deterministic check is retrieving a user-supplied page URL. *Live harness:* capture a probe (valid token, zero shared pages → `get_me` OK, `search` empty, direct page retrieve fails with the share hint) to confirm the warning + paste-URL flow fires correctly. Still the highest-value probe — no-pages-shared is the most common real-world dead-end.
7. **`claude` / `code` binaries are NOT reliably on PATH in the non-interactive shell `npx` spawns.** Verified via research (documented gotcha incl. Windows installer PATH bug). *Runtime:* probe `which` + known install locations (`~/.local/bin/claude`, etc.); on miss, graceful skip + copy-paste, never a hard error.
8. **`npx`/Node is reachable, a browser opener exists, and stdin is a TTY.** *(Added per Codex.)* GUI-launched MCP clients may run with a `PATH`/env that lacks Node; `open`/`xdg-open`/`start` may be absent; `npx easy-notion-mcp init` may be piped (no TTY). *Runtime:* detect TTY (fall back to printing instructions + URLs if absent), detect a browser opener (print the URL if none), and verify Node/npx is invocable for the *generated config* (warn if the registered `npx` won't resolve in the client's launch env).
9. **First `npx easy-notion-mcp` cold-start can show a transient "failed to connect" while npm installs the package.** *(Added per Codex.)* The wizard's final "now restart your client" message must pre-empt this: tell the user the first connection may lag while the package downloads.
10. **`NOTION_ROOT_PAGE_ID`, if provided, is a real page the integration can access.** *(Added per Codex.)* Don't accept it blindly — live-retrieve it and confirm access, else warn.
11. **Generated-config package reference policy is a deliberate choice, not an accident.** *(Added per Codex; see open question §10.5.)* `easy-notion-mcp` (floating, always-fresh), `easy-notion-mcp@latest` (explicit fresh), or a pinned `easy-notion-mcp@X.Y.Z` (reproducible, but stale until re-run) behave differently. Pick one and document the trade.

No premise here is "assumed from training data" — each maps to a runtime probe (with unit-tested fallback) or a captured live-harness probe.

## 8. Risks and footguns

- **Credential handling.** Never write the raw token to a shell rcfile or stdout/logs. Claude Code path: pass via `claude mcp add -e` (lives in Claude's own scoped config). JSON-merge path: the token *must* land in the client config file (that's where that client reads it from) — when we *create* the file, write mode `0600`; when merging into an existing file, preserve its perms and warn. **The shown diff/backup/temp files must all redact or protect the token** (Codex: the §4 "show the diff" and "never print the token" rules conflict — redact `NOTION_TOKEN` in the diff, and chmod backups/temp the same as the target). Validate via `get_me`, never by echoing.
- **Token entry has no built-in no-echo (Codex).** `node:readline/promises` does not mask input by default, so a pasted token would be visible on screen and in scrollback. Mitigation: implement masked input manually (raw-mode stdin, suppress echo) — a real, non-trivial Phase 1 cost — or accept a prompt dependency that provides it. This sharpens open question §10.1.
- **Idempotent re-run (Codex: cannot key on a single name).** Existing installs may have registered the server as `notion` *or* `easy-notion-mcp` (both appear in the current README). Detect by **server-key match OR (`command`/`args` pointing at the `easy-notion-mcp` package)**, then offer update/skip/replace. Claude Code: use `claude mcp get`/`list`. JSON-merge: update the matched entry in place; **never clobber sibling servers, and preserve unknown fields on our own entry** (client-specific keys like `type`, `enabled`, timeouts, headers, sandbox flags — merge only the fields we own: `command`, `args`, selected `env`).
- **Atomic write needs more than temp+rename (Codex).** Write the temp file *adjacent* to the target (same filesystem, for atomic rename); `chmod` it before writing secret content; protect the `.bak` the same way; on POSIX `fsync` the file and best-effort the directory; on Windows handle the lock/`EPERM` case where a running GUI app holds the file open (retry/clear-message rather than corrupt).
- **Restart semantics are per-client, not generic (Codex).** Surface the exact post-write action per client: Claude Code picks up config on a *new session*; VS Code may require starting/restarting the MCP server and accepting a *trust prompt*; Windsurf docs say *refresh* after adding; Claude Desktop must be *fully quit and relaunched*. Don't print a generic "restart your client."
- **Partial-setup recovery.** Wizard is staged and each step reports independently; on any failure, print what succeeded and the exact manual command to finish the rest. No all-or-nothing rollback that could undo a good prior step.
- **Cross-platform.** PATH detection per premise 7. Windows native: emit `cmd /c npx -y easy-notion-mcp` in generated configs (documented "Connection closed" workaround). Claude Desktop MSIX path lands under `%LOCALAPPDATA%\Packages\...` not `%APPDATA%` — handle both. WSL: home paths resolve fine, but a Windows-side `claude`/`code` may not be reachable from WSL and vice-versa; detect and say so rather than writing to the wrong side.
- **The no-shared-pages dead-end.** Covered in §2 step 5 (and corrected: empty `search` is a *warning*, the paste-a-URL retrieve is the deterministic proof). The single most important UX guard.
- **JSONC reality (Codex).** Real Cursor/VS Code configs may contain comments or trailing commas. A naive `JSON.parse`→`JSON.stringify` round-trip would silently delete them. Either use a comment-preserving JSONC editor, or **detect JSONC and refuse the auto-merge with precise manual instructions** rather than corrupt the file. (My research said "none use JSONC in practice"; Codex is right that this is too optimistic for VS Code — design for the safe failure.)
- **npx staleness.** Document `@latest`; the wizard prints its own version so a stale run is visible. See also the generated-config package-ref policy (premise 11 / §10.5).
- **Dependency tolerance.** The repo is deliberately dependency-lean (`marked`, `@notionhq/client`, `express`, `dotenv`). An interactive wizard wants a prompt library. **Recommendation: built-in `node:readline/promises`** to avoid a runtime dep — but note the no-echo cost above, which is the strongest argument for a small dep. → **Open question for human (§10.1).**

## 9. Phasing and size

- **Phase 1 — Wizard core + Claude Code (first buildable slice). Size: M (~2–4 days).** *Trimmed per Codex: the skill copy/pointer moves out of the core slice; manual-config-block generation (zero JSON-file risk) moves in to widen reach.*
  - `init` entrypoint: lazy dynamic-import branch in `src/index.ts` (refactored into `main()`, before the token check) + `easy-notion init` dispatch case that calls the wizard directly (not through `runCli`'s JSON-write path).
  - Interactive flow via `node:readline/promises` (with masked token entry): browser-open to integrations page, token entry, live `get_me` validation, optional **and validated** root-page-id.
  - Claude Code registration via `claude mcp add` with name-or-package idempotency (`get`/`list`, handling the legacy `notion` name).
  - End-to-end verify: `get_me` + the no-shared-pages warning + paste-a-URL deterministic check.
  - **Breadth without risk:** for any *other* detected client, print a ready-to-paste config block (token redacted in any echoed/log copy) — no file writes. This gives Cursor/Windsurf/Desktop/VS Code users a real improvement in Phase 1 without the JSON-merge footguns.
  - Tests: stdio invariant (handshake + `init`-without-token, §5); unit-test the probe/fallback and command-construction logic with fakes (§7).
  - **Test focus:** the no-arg/`init` branch boundary (premise 5) and the live token-validation + no-shared-pages path (premise 6) — these cross the entrypoint and the Notion API boundary.

- **Phase 2 — Multi-client JSON-merge + VS Code. Size: M–L (~4–6 days, mostly tests).**
  - Guarded JSON deep-merge writer (backup, atomic write, idempotent, shown-diff confirmation) for Cursor/Windsurf/Claude Desktop.
  - `code --add-mcp` for VS Code (with `servers`-key correctness).
  - Client auto-detection across the OS path matrix.
  - Cookbook skill: copy `notion-recipes`/`easy-notion-cli` into `~/.claude/skills/` (opt-in, idempotent) — moved here from Phase 1 per Codex trim.
  - README correction: Windsurf path `~/.windsurf/mcp.json` → `~/.codeium/windsurf/mcp_config.json`.
  - **Test focus:** the JSON-merge path against fixture configs (existing siblings to preserve, unknown fields to keep, missing file, **JSONC with comments/trailing commas → refuse-and-instruct**, re-run idempotency, token redaction in diffs) across macOS/Linux/Windows path shapes. This is where corruption bugs live.

- **Phase 3 — Profiles, OAuth, non-interactive. Size: M (~2–3 days).**
  - `init --profile` writing `profiles.json`.
  - Guided OAuth/HTTP setup (on the experimental auth surface — keep clearly labeled experimental).
  - `--yes` / fully-flagged non-interactive mode for scripted installs.

## 10. Open questions (need human input)

1. **Dependency tolerance for the prompt UX.** Built-in `node:readline/promises` (zero new deps, plainer UX, but **no built-in masked token entry** — we'd hand-roll raw-mode no-echo) vs a small prompt lib like `@clack/prompts` (nicer UX + masked input for free, but one more dependency on a package that handles a workspace token). *Recommendation: built-in + hand-rolled masking* — but the no-echo cost (Codex) is a legitimate reason to accept a vetted dep. — **human call (taste + supply-chain vs. implementation cost).**
2. **Phase 1 client scope.** Ship Phase 1 Claude-Code-only (safe, primary audience) vs fold Phase 2 in for broad day-one coverage (front-loads JSON-merge risk). *Recommendation: Claude-Code-only first.* — **human call (reach vs risk).**
3. **OAuth in scope at all?** OAuth would remove token copy-paste but needs a public HTTP deployment and sits on the experimental auth surface. *Recommendation: Phase 3, clearly labeled experimental; not a v1 goal.* — **human call (is OAuth onboarding a priority?).**
4. **Skill auto-install default.** Should copying skills into `~/.claude/skills/` be opt-in (y/N default N) or opt-out? *Recommendation: opt-in.* — minor; human may override.
5. **Generated-config package reference** *(added from Codex/premise 11).* Should registered configs invoke `easy-notion-mcp` (floating), `easy-notion-mcp@latest` (explicit fresh), or a pinned `easy-notion-mcp@X.Y.Z` (reproducible but stale until re-run)? *Recommendation: unpinned `easy-notion-mcp` in the config (clients re-resolve), `@latest` only for the one-shot `init` invocation itself.* — **human call (freshness vs reproducibility).**

## 11. Cost

**None.** No new paid infrastructure. The Notion API is free for the user's own integration token; registering a public OAuth integration (Phase 3) is also free. The only cost-adjacent note is the existing cookbook caveat that some database-query patterns assume the user's Notion plan limits — unchanged by this work. No pricing cliffs.

---

## Codex review

Pressure-tested by Codex (high reasoning effort) via sync `mcp-cli run --agent codex`, session **`plan-review-one-command-bootstrap`** (Codex session id `019f0582-af5e-70f0-afe1-26fbc3c53ac7`). Codex independently re-read `src/index.ts`, `package.json`, `src/cli/run.ts`, `README.md` and re-checked current Claude Code / VS Code / Windsurf MCP docs. The review changed the plan materially — summary of what was adopted:

| # | Codex finding | Disposition |
|---|---|---|
| 1 | "Show the diff" (§4) conflicts with "never print the token" (§8) | **Adopted** — diff/backups/temp now redact + protect the token (§4, §8). |
| 2 | JSON-merge under-specified; real configs may be JSONC; naive parse/stringify corrupts | **Adopted** — detect JSONC and refuse-with-instructions rather than corrupt (§8, Phase 2 tests). |
| 3 | Idempotency can't key only on `easy-notion-mcp`; README uses `notion` too | **Adopted** — detect by name *or* package in `command`/`args` (§3, §8). |
| 4 | Must preserve unknown sibling/own fields on merge | **Adopted** — merge only fields we own (§8). |
| 5 | Atomic write needs adjacent temp, chmod-first, protected `.bak`, fsync, Windows lock path | **Adopted** (§8). |
| 6 | Restart semantics are per-client | **Adopted** — per-client post-write actions (§8). |
| 7 | README Windsurf path wrong vs plan | **Adopted** — flagged + Phase 2 doc-fix task (§3, §9). |
| 8 | `index.ts` builds server at top level; needs `main()` refactor + lazy `import` for `init`; don't route wizard through `runCli` JSON path | **Adopted** — rewrote the §2 entrypoint note. |
| 9 | Several "build-time probes" must be **runtime** probes (CI has no creds) | **Adopted** — rewrote §7: runtime probes + unit-tested fakes + opt-in live harness. |
| 10 | Missing premises: npx/Node-in-GUI-env, browser opener + TTY, cold-start transient failure, root-page-id live-validate, package-ref policy | **Adopted** — added premises 8–11 (§7) and open question §10.5. |
| 11 | `readline/promises` has no masked input; visible token paste is a wart | **Adopted** — surfaced as a real Phase 1 cost; strengthened §10.1. |
| 12 | Empty `search` is not proof of no-shared-pages | **Adopted** — downgraded to a warning; added paste-a-URL deterministic check (§2, §7). |
| 13 | "Byte-for-byte unchanged" stdio claim too strong | **Adopted** — replaced with a precise, testable invariant citing `tests/stdio-startup.test.ts` (§5). |
| — | MCP tool-contract additivity claim | **Confirmed true by Codex** (no tool schemas/return shapes change). |

**Nothing was overruled.** Every Codex finding was either a correctness fix or a sharpening that aligned with the plan's goals (safe, honest, additive). The two judgment calls Codex left open — prompt dependency and Phase-1 scope — remain human decisions in §10, with the plan's recommendations unchanged but now better-argued (the no-echo cost on one side, the no-risk manual-config-block breadth play on the other).

### Research provenance
- Claude Code `claude mcp` CLI surface (add/get/list/remove, scopes, transports, PATH gotchas): general-purpose research agent, session `a1b3d92a04daad52a`.
- Multi-client config landscape (Cursor/Windsurf/VS Code/Claude Desktop paths + keys; claude.ai-connector infeasibility): general-purpose research agent, session `a50229bbb19b0594b`.
- Plan pressure-test: Codex, session `plan-review-one-command-bootstrap`.

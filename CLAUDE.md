# easy-notion-mcp

Markdown-first Notion MCP server. Agents write markdown, the server converts it to Notion's block API. Agents never touch Notion block objects directly.

## Open source context

**This is open source software** (MIT-licensed, published to npm as `easy-notion-mcp` and on GitHub as `Grey-Iris/easy-notion-mcp`). Commits, PR bodies, issue responses, and diffs become part of the public record — they are cited back at the project, not just read. That should shape how you work on this repo:

- **Security claims are load-bearing.** If CI allowlists a CVE as "not exploitable" or a commit claims "we don't use the vulnerable code path," that claim needs to be grounded in actual file:line evidence from the code paths involved, not in reasoning from what we import. When in doubt, patch rather than whitelist — users install this server and hand it their Notion workspace token, so "theoretically safe" is not the bar.
- **Upstream-first for transitive fixes.** If a root cause lives in a dependency (e.g. `@modelcontextprotocol/sdk` pulling a vulnerable `hono`), file an issue or PR upstream alongside any local patch. Local overrides are a short-term workaround; upstream fixes help the whole ecosystem and reduce our long-term exception list.
- **Downstream consumers exist.** People install via `npx easy-notion-mcp`, wrap us in other MCP clients, or depend on us as a library. Consider how changes to `package.json`, `exports`, `bin`, default behavior, and tool schemas affect them — not just our own CI.
- **PR scope discipline.** Keep PRs narrowly scoped so reviewers and future auditors can tell what changed and why. Don't bundle unrelated fixes into a docs PR, don't let chores leak into feature branches. Semantic titles, focused diffs.
- **Honest positioning.** Avoid marketing superlatives in README/docs. Soften unverifiable comparisons, cite real numbers, and match the existing measured tone.

### `.meta/` publication policy (hybrid, 2026-07-02)

Two classes of `.meta/` content, two defaults:

- **Audits, plans, and research are public by default.** They explain the code, and transparency is a feature. Before committing one, run the 30-second screen below.
- **Session exhaust is private.** Handoffs, explorations, and session-state files are gitignored here and archived in the private promo repo under `ops/`. They never need screening because they never publish. (Handoffs committed before this policy remain tracked; that's deliberate — removing them from HEAD wouldn't unpublish history.)

The screen, for the public class:

1. **Third parties by name or specific role?** ("James's co-founder", "client X asked for Y", "$VENDOR's support said Z"). If yes: generalize to a role-less description, get consent, or keep the file private.
2. **Business, financial, or client information?** Deal terms, pricing, customer lists, revenue, internal roadmap items not yet announced.
3. **Credentials or secrets, even partially redacted.** Never commit them, even with `[REDACTED]`.
4. **Tone you wouldn't want cited back in six months.** Self-deprecation is fine and often valuable; gratuitous snark about a maintainer or project isn't.
5. **Plane mismatch?** Distribution/marketing-strategy content belongs in the private promo repo, not here, regardless of sensitivity.

If any item fails the screen, stop and ask the user before committing. The default for the public class is still public — screening is a filter, not a rejection.

Decided boundaries are stated in this file as facts. Direction, planning, and
anything in-flux lives in the private sibling repo
(`../easy-notion-mcp-promo/PROJECT-MAP.md` — planes, gates, task homes,
roadmap). Dev machines have it checked out; sessions without it: ask James.
If it's written here, it's true today.

## Standing priorities

- **Top product priority: tool-surface token reduction.** The v1.0.1 HTTP `tools/list` measures 7,102 cl100k tokens (41 tools). Goal: substantially reduce the always-loaded tool-listing cost via tiered/minimal descriptions and/or dynamic toolsets, without breaking the 1.0 additive-only contract. Success = a remeasured surface benchmark. Evidence and benchmark method: `../easy-notion-mcp-promo/benchmarks/token-count/` (private planning repo — see pointer at the top of this file).
- **Docs rule — token setup URL.** All setup instructions must point users to the classic integrations page (https://www.notion.so/profile/integrations) for creating the integration token — never app.notion.com/developers. Reason (per Notion's own changelog): Developer-portal personal access tokens default to an expiration (up to 1 year); classic integration secrets do not expire. A token with a silent 12-month fuse breaks unattended deployments.
- **Claims discipline.** Before changing README or any public-facing copy that makes comparative or numeric claims (token efficiency, tool counts, comparisons to other servers), read `../easy-notion-mcp-promo/claims.md` and `../easy-notion-mcp-promo/PROJECT-MAP.md` first (private planning repo). Public claims must match verified rows there.

## Commands

```bash
npm run build       # tsc → dist/
npm test            # vitest
npm run dev         # tsc --watch
node dist/index.js  # stdio server (needs NOTION_TOKEN)
node dist/http.js   # HTTP server (needs OAuth creds or NOTION_TOKEN)
npm run start:http  # same as above
```

CI runs on every PR and push to `main`/`dev` (GitHub Actions: build, typecheck, test on Node 20 + 22). The package requires Node >=20 (`engines`).

## Releasing

CI Trusted Publishing is the primary path. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs build/typecheck/test, publishes to npm via OIDC (no `NPM_TOKEN` required), and creates the GitHub release. Total runtime is under a minute when green.

1. Bump `version` in **all three** of `package.json`, `package-lock.json` (top-level `version` field AND `packages."".version`), and `server.json` (the MCP Registry manifest; bump BOTH its top-level `version` field AND `packages[0].version`) in the same commit (a CI drift-guard test, `tests/server-version.test.ts`, fails the build if `server.json` and `package.json` versions diverge, so all three files must move together)
2. Commit: `git commit -am "chore: bump to vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push public dev && git push public --tags`
5. Watch the Release workflow run (`gh run watch` or the Actions tab). It should succeed end-to-end: `npm publish --provenance` via Trusted Publishing, then `gh release create` from inside the workflow.
6. Verify npm picked up the new version: `curl -s https://registry.npmjs.org/easy-notion-mcp/latest | jq -r .version` (avoid `npm view`, which can return stale local-cached data for several minutes).
7. Merge `main` ← release PR, then `dev` ← `main` catch-up merge.

### Manual fallback

Use the manual path when CI is unavailable, the npm registry is rejecting OIDC, or you deliberately want to publish from local state. Steps 1-4 above are unchanged; replace step 5 with:

1. `npm login --auth-type=web` (if the session is expired)
2. `npm publish --access public` from the tagged commit
3. `npm run release:smoke` (post-publish verification)
4. `gh release create vX.Y.Z --generate-notes`

The Release workflow previously failed because it ran on Node 20 (npm 10), but Trusted Publishing requires npm ≥ 11.5.1 (Node 22.14+ or 24). Commit `e06e2ee` bumped the workflow to Node 24; v0.9.1 was the first release published end-to-end via Trusted Publishing.

## Architecture

```
src/
├── index.ts              # Stdio transport entry point
├── http.ts               # HTTP transport entry point (Express + OAuth)
├── server.ts             # Shared MCP server setup (tool definitions, handlers)
├── auth/
│   ├── oauth-provider.ts # MCP OAuth provider → relays to Notion OAuth
│   └── token-store.ts    # Encrypted file-based token persistence
├── notion-client.ts      # @notionhq/client SDK wrappers
├── markdown-to-blocks.ts # Markdown → Notion blocks
├── blocks-to-markdown.ts # Notion blocks → Markdown
├── file-upload.ts        # file:// URL processing, uploads to Notion
└── types.ts              # Shared types
```

- `server.ts` exports `createServer(notionClientFactory, config)` — a factory that builds an MCP Server with the tool definitions registered from `src/server.ts`
<!-- Maintainer: canonical tool list lives in the tool definitions array in src/server.ts. Avoid hardcoding counts here. -->
- `index.ts` is a thin stdio entry point: creates one Notion client, passes it to `createServer`, connects via `StdioServerTransport`
- `http.ts` exports `createApp(options)` — builds an Express app with MCP endpoints; supports two modes:
  - **Static token mode**: uses a fixed `NOTION_TOKEN`, no auth middleware
  - **OAuth mode**: mounts `mcpAuthRouter` for `.well-known/*`, `/authorize`, `/token`, `/register`; protects `/mcp` with bearer auth; relays OAuth to Notion
- `createApp` is imported directly by integration tests (no server startup needed)
- `GET /` on the HTTP server returns a health check JSON (`{"status":"ok","server":"easy-notion-mcp","transport":"streamable-http","endpoint":"/mcp"}`)
- `find_replace` and `replace_content` use Notion's native markdown API via `pages.updateMarkdown`, rather than the GFM-to-blocks pipeline used by the other page content tools
- All logging goes to `console.error` (stdout is reserved for MCP protocol in stdio mode)

## Environment

### Stdio mode (default)
- `NOTION_TOKEN` (required) — Notion internal integration token
- `NOTION_ROOT_PAGE_ID` (optional) — default parent page
- `NOTION_TRUST_CONTENT` (optional) — skip content notice prefix
- `NOTION_MCP_WORKSPACE_ROOT` (optional, stdio only) — absolute path that bounds file_path inputs for the `create_page_from_file` tool. Defaults to the server's process.cwd(). Has no effect in HTTP mode.

### HTTP mode
- `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET` — enables OAuth mode
- `NOTION_TOKEN` — fallback for static token mode (no OAuth)
- `PORT` (default: 3333) — HTTP server port
- `OAUTH_REDIRECT_URI` (default: http://localhost:{PORT}/callback)

### Bench mode
- `BENCH_ROOT_PAGE_ID` (optional) -- parent page for bench scenario sandboxes. Falls back to `E2E_ROOT_PAGE_ID` if not set.

## Custom markdown conventions

Notion has block types with no standard markdown equivalent. We use these conventions:

| Notion block | Markdown syntax |
|---|---|
| Toggle (collapsible) | `+++ Title\ncontent\n+++` |
| Toggle heading H1 (collapsible) | `+++ # Title\ncontent\n+++` |
| Toggle heading H2 (collapsible) | `+++ ## Title\ncontent\n+++` |
| Toggle heading H3 (collapsible) | `+++ ### Title\ncontent\n+++` |
| Column layout | `::: columns\n::: column\ncontent\n:::\n:::` |
| Callout (note) | `> [!NOTE]\n> text` |
| Callout (tip) | `> [!TIP]\n> text` |
| Callout (warning) | `> [!WARNING]\n> text` |
| Callout (important) | `> [!IMPORTANT]\n> text` |
| Callout (info) | `> [!INFO]\n> text` |
| Callout (success) | `> [!SUCCESS]\n> text` |
| Callout (error) | `> [!ERROR]\n> text` |
| Equation | `$$expression$$` or multi-line `$$\nexpression\n$$` |
| Table of contents | `[toc]` |
| Embed | `[embed](url)` |
| Bookmark (rich preview) | Bare URL on its own line |
| Page mention | `@[Title](url)` |
| Task list | `- [ ] unchecked` / `- [x] checked` |

These round-trip cleanly: `read_page` outputs the same conventions that `create_page` accepts.

## Adding a new block type

1. **markdown-to-blocks.ts** — Add a case in the token walker to recognize the new syntax and produce the Notion block object
2. **blocks-to-markdown.ts** — Add a case to convert the Notion block type back to markdown
3. **tests/** — Add tests for both directions (markdown → blocks and blocks → markdown)
4. **server.ts** — Update the `create_page` tool description to document the new syntax
5. **CLAUDE.md** — Add a row to the "Custom markdown conventions" table above so future contributors and agents know the syntax exists. This is the one exception to CONTRIBUTING.md rule #4's "do not modify CLAUDE.md without pre-approval" — block-type additions are pre-approved by this checklist.

## Key decisions

- **`marked`** for markdown parsing (nested token tree, bundled TS types, simpler than remark/unified)
- **`@notionhq/client` v5.20.x** — matches Notion-Version: 2026-03-11
- **Markdown as the interface** — agents never construct Notion block objects. This keeps tool usage simple and lets the conversion logic evolve independently
- **Database entry conversion** — fetches database schema at runtime to correctly map simple key-value pairs to Notion property format
- **Schema caching** — database schemas are cached in-memory with a 5-minute TTL to avoid redundant API calls during batch operations
- **`createServer` factory pattern** — decouples server setup from transport; in stdio mode the factory always returns the same client; in HTTP OAuth mode it returns a per-user client based on auth token
- **OAuth relay** — the server acts as an MCP OAuth Authorization Server, redirects to Notion's OAuth consent screen, exchanges codes, and issues its own bearer tokens backed by encrypted file-based storage (AES-256-GCM)
- **Transport-conditional tools** — tools can declare a `transports: ['stdio' | 'http']` list to restrict where they appear. Tools without the field are available in all transports. File-reading tools (e.g. `create_page_from_file`) are stdio-only because HTTP-mode callers don't share the server's filesystem.
- **Non-fatal `warnings` field on tool responses** — tools may return an optional `warnings: Array<{code: string, ...detail}>` for non-fatal data-fidelity concerns (e.g., `omitted_block_types` on `read_page`). Omitted when empty. Codes are part of the contract once shipped — new tools should reuse existing codes or add specific descriptive names.
- **Recipes ship as docs/skills only — PERMANENT boundary (decided 2026-07-04)** — no scheduler or runtime automation code lands in this repo, ever. The converter stays thin and pure (holds only the user's Notion token). Automation, if it is ever built, will live outside this repo; whether and how is undecided — that discussion lives in the private planning repo.

## `.meta/research/` lifecycle

Research notes under `.meta/research/` have a 90-day shelf life. If a research note has not been referenced by a merged plan, an active doc, or a tasuku task within 90 days of its creation, delete it. Check creation date via `git log --diff-filter=A --format=%ai -- <file>`. This rule is forward-looking only — do not retroactively purge existing notes when this rule is added.


## Learnings

- Workflow-construction standard for this repo (2026-06-12, James): (1) MODEL — Opus by default for all workflow agent() calls; use model:'sonnet' ONLY where measuring discoverability/legibility-to-a-typical-user (Sonnet is an instrument there, not a cost-saver). (2) CODEX — Workflow agent() spawns Claude subagents only; Codex enters via a workflow agent dispatching sync 'mcp-cli run --agent codex' (the builder.md pattern, = the through-a-PM governance rule). Strong fit: code-read/contract-audit + cross-model verify. Poor fit: live-MCP empirical streams (a Codex mcp-cli sub-session lacks this session's easy-notion MCP). (3) ROLES — reuse ../workflow-v2 roles (builder/audit/red-team/planner) via Codex sub-dispatch --role <name> (registry confirmed reachable) + role guidance inlined in the managing Claude agent's prompt; verify whether agent() agentType can natively load them before wiring. Apply this fully on the 1.0 EXECUTION-phase workflow, not by re-running completed recon.
- CI branch-protection required status checks that encode a matrix value (e.g. 'ci (20)'/'ci (18)') become phantom 'Expected - waiting for status' checks that hang PRs forever when the Node matrix changes but the protection list is not updated in lockstep. Fix: add a version-stable aggregator job (ci-required: needs [ci], if: always(), fails unless needs.ci.result==success) and require ONLY that context, so matrix bumps never touch branch protection. Bit us 2026-06-27: protection still required 'ci (18)' after the matrix moved to [20,22]; PR #72 hung until fixed. Sequencing: the aggregator must report at least once BEFORE you require it (else you recreate the hang), and don't flip a branch to require it until every open PR's branch contains the job.
- [RULE] GitHub Actions rerun reuses the ORIGINAL merge-ref snapshot: re-running a PR's failed CI after fixing the base branch still tests the OLD merge commit (2/2 identical failures post-fix, PRs 75/76, 2026-07-27). Use gh pr update-branch to force a new head and fresh merge ref instead of rerun.
- [RULE] 'Closes #N' in a PR body only auto-closes issues when merging to the DEFAULT branch. This repo merges to dev first, so close issues manually at dev-merge time (issue 69 stayed open after PR 75 merged, 2026-07-27).

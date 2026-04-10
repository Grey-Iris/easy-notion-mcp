# easy-notion-mcp

Markdown-first Notion MCP server. Agents write markdown, the server converts it to Notion's block API. Agents never touch Notion block objects directly.

## Open source context

**This is open source software** (MIT-licensed, published to npm as `easy-notion-mcp` and on GitHub as `Grey-Iris/easy-notion-mcp`). Commits, PR bodies, issue responses, and diffs become part of the public record — they are cited back at the project, not just read. That should shape how you work on this repo:

- **Security claims are load-bearing.** If CI allowlists a CVE as "not exploitable" or a commit claims "we don't use the vulnerable code path," that claim needs to be grounded in actual file:line evidence from the code paths involved, not in reasoning from what we import. When in doubt, patch rather than whitelist — users install this server and hand it their Notion workspace token, so "theoretically safe" is not the bar.
- **Upstream-first for transitive fixes.** If a root cause lives in a dependency (e.g. `@modelcontextprotocol/sdk` pulling a vulnerable `hono`), file an issue or PR upstream alongside any local patch. Local overrides are a short-term workaround; upstream fixes help the whole ecosystem and reduce our long-term exception list.
- **Downstream consumers exist.** People install via `npx easy-notion-mcp`, wrap us in other MCP clients, or depend on us as a library. Consider how changes to `package.json`, `exports`, `bin`, default behavior, and tool schemas affect them — not just our own CI.
- **PR scope discipline.** Keep PRs narrowly scoped so reviewers and future auditors can tell what changed and why. Don't bundle unrelated fixes into a docs PR, don't let chores leak into feature branches. Semantic titles, focused diffs.
- **Honest positioning.** Avoid marketing superlatives in README/docs. Soften unverifiable comparisons, cite real numbers, and match the existing measured tone.

### Screening `.meta/` files before commit

Handoffs, audits, and plans under `.meta/` are public by default. That's the right default — transparency is a feature, and agent portability requires these files to travel with the repo rather than living local-only. But before committing any `.meta/handoffs/*.md` or `.meta/audits/*.md` file, run a 30-second screen:

1. **Third parties by name or specific role?** ("James's co-founder", "client X asked for Y", "$VENDOR's support said Z"). If yes: generalize to a role-less description, get consent, or move that specific file to a gitignored `.meta/handoffs-private/` path.
2. **Business, financial, or client information?** Deal terms, pricing, customer lists, revenue, internal roadmap items not yet announced.
3. **Credentials or secrets, even partially redacted.** Never commit them, even with `[REDACTED]`.
4. **Tone you wouldn't want cited back in six months.** Self-deprecation is fine and often valuable; gratuitous snark about a maintainer or project isn't.

If any item fails the screen, stop and ask the user before committing. The default is still public — screening is a filter, not a rejection. The goal is to keep the honest writing that makes handoffs valuable while catching the rare detail that shouldn't go out.

## Commands

```bash
npm run build       # tsc → dist/
npm test            # vitest
npm run dev         # tsc --watch
node dist/index.js  # stdio server (needs NOTION_TOKEN)
node dist/http.js   # HTTP server (needs OAuth creds or NOTION_TOKEN)
npm run start:http  # same as above
```

CI runs on every PR and push to `main`/`dev` (GitHub Actions: build, typecheck, test on Node 18 + 20).

## Releasing

Tag-triggered via GitHub Actions. To publish a new version:

1. Bump version in `package.json`
2. Commit: `git commit -am "Bump to vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push && git push --tags`
5. CI runs tests → publishes to npm → creates GitHub release

Requires `NPM_TOKEN` secret in repo settings.

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

- `server.ts` exports `createServer(notionClientFactory, config)` — a factory that builds an MCP Server with all 26 tools registered
- `index.ts` is a thin stdio entry point: creates one Notion client, passes it to `createServer`, connects via `StdioServerTransport`
- `http.ts` exports `createApp(options)` — builds an Express app with MCP endpoints; supports two modes:
  - **Static token mode**: uses a fixed `NOTION_TOKEN`, no auth middleware
  - **OAuth mode**: mounts `mcpAuthRouter` for `.well-known/*`, `/authorize`, `/token`, `/register`; protects `/mcp` with bearer auth; relays OAuth to Notion
- `createApp` is imported directly by integration tests (no server startup needed)
- `GET /` on the HTTP server returns a health check JSON (`{"status":"ok","server":"easy-notion-mcp","transport":"streamable-http","endpoint":"/mcp"}`)
- `find_replace` is the one editing tool that uses Notion's native markdown API via `pages.updateMarkdown`, rather than the GFM-to-blocks pipeline used by the other page content tools
- All logging goes to `console.error` (stdout is reserved for MCP protocol in stdio mode)

## Environment

### Stdio mode (default)
- `NOTION_TOKEN` (required) — Notion internal integration token
- `NOTION_ROOT_PAGE_ID` (optional) — default parent page
- `NOTION_TRUST_CONTENT` (optional) — skip content notice prefix

### HTTP mode
- `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET` — enables OAuth mode
- `NOTION_TOKEN` — fallback for static token mode (no OAuth)
- `PORT` (default: 3333) — HTTP server port
- `OAUTH_REDIRECT_URI` (default: http://localhost:{PORT}/callback)

## Custom markdown conventions

Notion has block types with no standard markdown equivalent. We use these conventions:

| Notion block | Markdown syntax |
|---|---|
| Toggle (collapsible) | `+++ Title\ncontent\n+++` |
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
| Task list | `- [ ] unchecked` / `- [x] checked` |

These round-trip cleanly: `read_page` outputs the same conventions that `create_page` accepts.

## Adding a new block type

1. **markdown-to-blocks.ts** — Add a case in the token walker to recognize the new syntax and produce the Notion block object
2. **blocks-to-markdown.ts** — Add a case to convert the Notion block type back to markdown
3. **tests/** — Add tests for both directions (markdown → blocks and blocks → markdown)
4. **server.ts** — Update the `create_page` tool description to document the new syntax

## Key decisions

- **`marked`** for markdown parsing (nested token tree, bundled TS types, simpler than remark/unified)
- **`@notionhq/client` v5.13.x** — matches Notion-Version: 2025-09-03
- **Markdown as the interface** — agents never construct Notion block objects. This keeps tool usage simple and lets the conversion logic evolve independently
- **Database entry conversion** — fetches database schema at runtime to correctly map simple key-value pairs to Notion property format
- **Schema caching** — database schemas are cached in-memory with a 5-minute TTL to avoid redundant API calls during batch operations
- **`createServer` factory pattern** — decouples server setup from transport; in stdio mode the factory always returns the same client; in HTTP OAuth mode it returns a per-user client based on auth token
- **OAuth relay** — the server acts as an MCP OAuth Authorization Server, redirects to Notion's OAuth consent screen, exchanges codes, and issues its own bearer tokens backed by encrypted file-based storage (AES-256-GCM)

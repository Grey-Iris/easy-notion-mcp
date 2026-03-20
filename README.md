<div align="center">

# Easy Notion MCP

**Markdown-first MCP server that connects AI agents to Notion.**<br>
Agents write markdown — easy-notion-mcp converts it to Notion's block API and back again.

26 tools · 25 block types · 92% fewer tokens vs official Notion MCP · Full round-trip fidelity

[![npm](https://img.shields.io/npm/v/easy-notion-mcp)](https://www.npmjs.com/package/easy-notion-mcp)
[![license](https://img.shields.io/npm/l/easy-notion-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/easy-notion-mcp)](package.json)
[![Glama](https://glama.ai/mcp/servers/Grey-Iris/easy-notion-mcp/badges/card.svg)](https://glama.ai/mcp/servers/Grey-Iris/easy-notion-mcp)

```bash
npx easy-notion-mcp
```

**[See it in action →](https://www.notion.so/easy-notion-mcp-327be876242f817f9129ff1a5a624814)** Live Notion page created and managed entirely through easy-notion-mcp.

</div>

![Raw JSON chaos vs clean markdown](assets/readme-banner.png)

---

**Contents:** [Comparison](#how-does-easy-notion-mcp-compare-to-other-notion-mcp-servers) · [Setup](#how-do-i-set-up-easy-notion-mcp) · [Why markdown](#why-markdown-first) · [How it works](#how-does-easy-notion-mcp-work) · [Tools](#what-tools-does-easy-notion-mcp-provide) · [Block types](#what-block-types-does-easy-notion-mcp-support) · [Round-trip](#can-i-read-and-rewrite-pages-without-losing-formatting) · [Databases](#how-does-easy-notion-mcp-handle-databases) · [Config](#configuration) · [Security](#what-about-security-and-prompt-injection) · [FAQ](#frequently-asked-questions)

## How does easy-notion-mcp compare to other Notion MCP servers?

| Feature | easy-notion-mcp | Official Notion MCP (npm) | better-notion-mcp |
|---|---|---|---|
| **Content format** | ✅ Standard GFM markdown | ❌ Raw Notion API JSON | ⚠️ Markdown (limited block types) |
| **Block types** | ✅ 25 (toggles, columns, callouts, equations, embeds, tables, file uploads, task lists) | ⚠️ All (as raw JSON) | ⚠️ ~7 (headings, paragraphs, lists, code, quotes, dividers) |
| **Round-trip fidelity** | ✅ Full — read markdown, modify, write back | ❌ Raw JSON requires block reconstruction | ⚠️ Unsupported blocks silently dropped |
| **Tools** | 26 individually-named tools | 18 auto-generated from OpenAPI | 9 composite tools (39 actions) |
| **File uploads** | ✅ `file:///path` in markdown | ❌ [Open feature request](https://github.com/makenotion/notion-mcp-server/issues/191) | ✅ 5-step lifecycle |
| **Prompt injection defense** | ✅ Content notice prefix + URL sanitization | ❌ | ❌ |
| **Database entry format** | Simple `{"Status": "Done"}` key-value pairs | Simplified key-value pairs | Simplified key-value pairs |
| **Auth options** | API token or OAuth | API token or OAuth | API token or OAuth |

### How many tokens does easy-notion-mcp save?

| Operation | easy-notion-mcp | better-notion-mcp | Official Notion MCP | Savings vs Official |
|---|---|---|---|---|
| Page read | **291 tokens** | ⚠️ 236 tokens | 6,536 tokens | **95.5%** |
| DB query (5 rows) | **347 tokens** | 704 tokens | 2,983 tokens | **88.4%** |
| Search (3 results) | **298 tokens** | 347 tokens | 1,824 tokens | **83.7%** |

⚠️ better-notion-mcp page reads appear smaller because they silently drop 11 block types (callouts, toggles, tables, task lists, equations, bookmarks, embeds). On equal content coverage, easy-notion-mcp is more efficient.

*Measured by running all three MCP servers against the same Notion content and counting tokens with tiktoken cl100k_base. Raw responses saved for verification.*

## How do I set up easy-notion-mcp?

### With OAuth (recommended)

Run the HTTP server, then connect with any MCP client. OAuth handles authentication — no token to copy-paste.

**Start the server:**

```bash
npx easy-notion-mcp-http
```

Requires `NOTION_OAUTH_CLIENT_ID` and `NOTION_OAUTH_CLIENT_SECRET` env vars. See [OAuth setup](#oauth--http-transport) below.

**Claude Code:**

```bash
claude mcp add notion --transport http http://localhost:3333/mcp
```

**OpenClaw:**

```bash
openclaw config set mcpServers.notion.transport "http"
openclaw config set mcpServers.notion.url "http://localhost:3333/mcp"
```

**Claude Desktop:**

Go to Settings → Connectors → Add custom connector, enter `http://localhost:3333/mcp`.

Your browser will open to Notion's authorization page. Pick the pages to share, click Allow, done.

### With API token

Create a [Notion integration](https://www.notion.so/my-integrations), copy the token, share your pages with it.

**Claude Code:**

```bash
claude mcp add notion -- npx -y easy-notion-mcp
```

Set the env var: `export NOTION_TOKEN=ntn_your_integration_token`

**OpenClaw:**

```bash
openclaw config set mcpServers.notion.command "npx"
openclaw config set mcpServers.notion.args '["easy-notion-mcp"]'
```

Set the env var: `export NOTION_TOKEN=ntn_your_integration_token`

**Claude Desktop / Cursor / Windsurf** — add to your MCP config file:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "easy-notion-mcp"],
      "env": {
        "NOTION_TOKEN": "ntn_your_integration_token"
      }
    }
  }
}
```

Config file locations: Claude Desktop → `claude_desktop_config.json` · Cursor → `.cursor/mcp.json` · Windsurf → `~/.windsurf/mcp.json`

<details><summary><strong>VS Code Copilot</strong> — add to <code>.vscode/mcp.json</code> (uses <code>servers</code> not <code>mcpServers</code>)</summary>

```json
{
  "servers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "easy-notion-mcp"],
      "env": {
        "NOTION_TOKEN": "ntn_your_integration_token"
      }
    }
  }
}
```

</details>

easy-notion-mcp works with any MCP-compatible client. The server runs via stdio (API token mode) or HTTP (OAuth mode).

![](assets/papercraft-divider.png)

## Why markdown-first?

The official Notion MCP npm package returns raw API JSON — deeply nested block objects with ~120 tokens of metadata per block. Other servers convert to markdown but support only a handful of block types, silently dropping callouts, toggles, tables, equations, and more.

easy-notion-mcp uses standard GFM markdown that agents already know. There's nothing new to learn, no custom tag syntax, no block objects to construct. The agent writes markdown, easy-notion-mcp handles the conversion to Notion's block API — and back again, with 25 block types preserved.

This means agents can **edit existing content**. Read a page, get markdown back, modify the string, write it back. Nothing is lost. Agents edit Notion pages the same way they edit code — as text.

## How does easy-notion-mcp work?

**Pages** — write and read markdown:

```javascript
create_page({
  title: "Sprint Review",
  markdown: "## Decisions\n\n- Ship v2 by Friday\n- [ ] Update deploy scripts\n\n> [!WARNING]\n> Deploy window is Saturday 2–4am only"
})
```

Read it back — same markdown comes out:

```javascript
read_page({ page_id: "..." })
```

```json
{ "markdown": "## Decisions\n\n- Ship v2 by Friday\n- [ ] Update deploy scripts\n\n> [!WARNING]\n> Deploy window is Saturday 2–4am only" }
```

Modify the string, call `replace_content`, done. Or target a single section by heading name with `update_section`. Or do a surgical `find_replace` without touching the rest of the page. Pages can also have emoji icons and cover images set via `create_page` or `update_page`.

**Databases** — write simple key-value pairs:

```javascript
add_database_entry({
  database_id: "...",
  properties: { "Status": "Done", "Priority": "High", "Due": "2025-03-20", "Tags": ["v2", "launch"] }
})
```

No property type objects, no nested `{ select: { name: "Done" } }` wrappers. easy-notion-mcp fetches the database schema at runtime and converts automatically. Agents pass `{ "Status": "Done" }`, easy-notion-mcp does the rest.

**Errors tell you how to fix them.** A wrong heading name returns the available headings. A missing page suggests sharing it with the integration. A bad filter tells you to call `get_database` first. Agents can self-correct without asking the user for help.

**Complex content works.** Nested toggles inside toggles, columns with mixed content types (lists + code blocks + blockquotes), deep list nesting, and full unicode (Japanese, Chinese, Arabic, emoji) all round-trip cleanly. `update_section` heading search is case-insensitive and returns available headings on miss. `add_database_entries` handles partial failures — succeeded and failed entries are returned separately so agents can retry just the failures.

![](assets/papercraft-divider.png)

## What tools does easy-notion-mcp provide?

easy-notion-mcp includes 26 individually-named tools across 5 categories. Each tool is self-documenting with complete usage examples — agents know exactly how to use every tool from the first message, with no extra round-trips needed.

### Pages (11 tools)

| Tool | Description |
|---|---|
| `create_page` | Create a page from markdown |
| `read_page` | Read a page as markdown |
| `append_content` | Append markdown to a page |
| `replace_content` | Replace all content on a page |
| `update_section` | Update a section by heading name |
| `find_replace` | Find and replace text, preserving files |
| `update_page` | Update title, icon, or cover |
| `duplicate_page` | Copy a page and its content |
| `archive_page` | Move a page to trash |
| `move_page` | Move a page to a new parent |
| `restore_page` | Restore an archived page |

### Navigation (3 tools)

| Tool | Description |
|---|---|
| `list_pages` | List child pages under a parent |
| `search` | Search pages and databases |
| `share_page` | Get the shareable URL |

### Databases (8 tools)

| Tool | Description |
|---|---|
| `create_database` | Create a database with typed schema |
| `get_database` | Get database schema, property names, and options |
| `list_databases` | List all databases the integration can access |
| `query_database` | Query with filters, sorts, or text search |
| `add_database_entry` | Add a row using simple key-value pairs |
| `add_database_entries` | Add multiple rows in one call |
| `update_database_entry` | Update a row using simple key-value pairs |
| `delete_database_entry` | Delete (archive) a database entry |

easy-notion-mcp fetches the database schema, maps values to Notion's property format, and handles type conversion automatically when agents pass simple key-value pairs like `{ "Status": "Done" }`. Schema is cached for 5 minutes to avoid redundant API calls during batch operations.

### Comments (2 tools)

| Tool | Description |
|---|---|
| `list_comments` | List comments on a page |
| `add_comment` | Add a comment to a page |

### Users (2 tools)

| Tool | Description |
|---|---|
| `list_users` | List workspace users |
| `get_me` | Get the current bot user |

## What block types does easy-notion-mcp support?

easy-notion-mcp supports 25 block types using standard markdown syntax extended with conventions for Notion-specific blocks like toggles, columns, and callouts. Agents write familiar markdown — easy-notion-mcp handles the conversion to and from Notion's block format.

### Standard markdown

| Syntax | Markdown |
|---|---|
| Headings | `# H1` `## H2` `### H3` |
| Bold, italic, strikethrough | `**bold**` `*italic*` `~~strike~~` |
| Inline code | `` `code` `` |
| Links | `[text](url)` |
| Images | `![alt](url)` |
| Bullet list | `- item` |
| Numbered list | `1. item` |
| Task list | `- [ ] todo` / `- [x] done` |
| Blockquote | `> text` |
| Code block | `` ```language `` |
| Table | Standard pipe table syntax |
| Divider | `---` |

### Notion-specific syntax

| Block | Syntax |
|---|---|
| Toggle | `+++ Title` ... `+++` |
| Columns | `::: columns` / `::: column` ... `:::` |
| Callout (note) | `> [!NOTE]` |
| Callout (tip) | `> [!TIP]` |
| Callout (warning) | `> [!WARNING]` |
| Callout (important) | `> [!IMPORTANT]` |
| Callout (info) | `> [!INFO]` |
| Callout (success) | `> [!SUCCESS]` |
| Callout (error) | `> [!ERROR]` |
| Equation | `$$expression$$` |
| Table of contents | `[toc]` |
| Embed | `[embed](url)` |
| Bookmark | Bare URL on its own line |
| File upload (image) | `![alt](file:///path/to/image.png)` |
| File upload (file) | `[name](file:///path/to/file.pdf)` |

## Can I read and rewrite pages without losing formatting?

Yes. Round-trip fidelity is a core design guarantee of easy-notion-mcp, not a side effect.

What you write is what you read back. `read_page` returns the exact same markdown syntax that `create_page` accepts — headings, lists, tables, callouts, toggles, columns, equations, all of it.

easy-notion-mcp enables agents to read a page, modify the markdown string, and write it back without losing formatting, structure, or content. No format translation. No block reconstruction. Agents edit Notion pages the same way they edit code — as text.

### What's the difference between find_replace and replace_content?

easy-notion-mcp provides three editing strategies for different use cases:

- **`replace_content`** — Replaces all content on a page with new markdown. Best for full rewrites.
- **`update_section`** — Replaces a single section identified by heading name. Best for updating one part of a page.
- **`find_replace`** — Finds and replaces specific text anywhere on the page, preserving all other content and attached files. Best for surgical edits.

## How does easy-notion-mcp handle databases?

easy-notion-mcp provides 8 database tools that abstract away Notion's complex property format. Agents pass simple key-value pairs like `{ "Status": "Done", "Priority": "High" }` — easy-notion-mcp fetches the database schema at runtime and converts to Notion's property format automatically.

easy-notion-mcp supports creating databases with typed schemas, querying with filters and sorts, and bulk operations via `add_database_entries` (multiple rows in one call). Schema is cached for 5 minutes to avoid redundant API calls during batch operations.

## Configuration

### Stdio mode (API token)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NOTION_TOKEN` | Yes | — | Notion API integration token |
| `NOTION_ROOT_PAGE_ID` | No | — | Default parent page ID |
| `NOTION_TRUST_CONTENT` | No | `false` | Skip content notice on `read_page` responses |

### OAuth / HTTP transport

Run `npx easy-notion-mcp-http` to start the HTTP server with OAuth support.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NOTION_OAUTH_CLIENT_ID` | Yes | — | Notion public integration OAuth client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | Yes | — | Notion public integration OAuth client secret |
| `PORT` | No | `3333` | HTTP server port |
| `OAUTH_REDIRECT_URI` | No | `http://localhost:{PORT}/callback` | OAuth callback URL |

To get OAuth credentials, create a **public integration** at [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and configure `http://localhost:3333/callback` as the redirect URI.

In OAuth mode, `create_page` works without `NOTION_ROOT_PAGE_ID` — pages are created in the user's private workspace section by default.

## What about security and prompt injection?

easy-notion-mcp includes two layers of security for production deployments:

**Prompt injection defense:** `read_page` responses include a content notice prefix instructing the agent to treat Notion data as content, not instructions. This prevents page content from hijacking agent behavior. Set `NOTION_TRUST_CONTENT=true` to disable this if you control the workspace.

**URL sanitization:** `javascript:`, `data:`, and other unsafe URL protocols are stripped and rendered as plain text. Only `http:`, `https:`, and `mailto:` are allowed.

![](assets/papercraft-divider.png)

## Frequently Asked Questions

### How is easy-notion-mcp different from the official Notion MCP server?

The official Notion MCP npm package (`@notionhq/notion-mcp-server`) is a raw API proxy — it returns unmodified Notion JSON, costing ~90% more tokens per operation. easy-notion-mcp converts everything to standard GFM markdown that agents already know, supports 25 block types with round-trip fidelity, and includes prompt injection defense. Notion also offers a separate hosted remote MCP server (OAuth-based) that uses a custom HTML-tag-based markdown format — easy-notion-mcp uses standard markdown syntax instead.

### What MCP clients does easy-notion-mcp work with?

easy-notion-mcp works with any MCP-compatible client, including Claude Desktop, Claude Code, Cursor, VS Code Copilot, Windsurf, and OpenClaw. It supports both stdio transport (API token) and HTTP transport (OAuth). See the [setup instructions](#how-do-i-set-up-easy-notion-mcp) for copy-pasteable configs for each client.

### Does easy-notion-mcp support file uploads?

Yes. easy-notion-mcp supports file uploads using the `file:///` protocol in markdown syntax. Upload images with `![alt](file:///path/to/image.png)` and files with `[name](file:///path/to/file.pdf)`.

### Does easy-notion-mcp handle nested and complex content?

Yes. Nested toggles inside toggles, columns with mixed content types (lists, blockquotes, and code blocks in different columns), nested bullet and numbered lists, and full unicode support including Japanese, Chinese, Russian, Arabic, and emoji — all round-tripping cleanly.

### Does easy-notion-mcp handle partial failures in batch operations?

Yes. `add_database_entries` returns separate `succeeded` and `failed` arrays. If one entry fails validation, the others still get created. Agents can retry just the failures without re-sending the whole batch.

## Contributing

Issues and PRs welcome on [GitHub](https://github.com/Grey-Iris/easy-notion-mcp).

## License

MIT

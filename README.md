# easy-notion-mcp

**easy-notion-mcp is a markdown-first MCP server that connects AI agents to Notion.** It provides 26 tools for reading, writing, searching, and managing Notion pages and databases using standard markdown instead of raw JSON. easy-notion-mcp saves 87% of tokens on every operation and supports 20+ block types with full round-trip fidelity — agents read markdown out and write markdown back with zero format loss.

[![npm](https://img.shields.io/npm/v/easy-notion-mcp)](https://www.npmjs.com/package/easy-notion-mcp)
[![license](https://img.shields.io/npm/l/easy-notion-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/easy-notion-mcp)](package.json)

![Raw JSON chaos vs clean markdown](assets/readme-banner.png)

**[See the demo page](https://www.notion.so/easy-notion-mcp-327be876242f817f9129ff1a5a624814)** — a live Notion page created and managed entirely through easy-notion-mcp.

## How does easy-notion-mcp compare to other Notion MCP servers?

Most Notion MCP servers pass raw Notion API JSON to agents — deeply nested block objects, rich text annotation arrays, and property schemas with redundant metadata. Agents burn thousands of tokens parsing structure instead of doing work. easy-notion-mcp is designed for agents that need to read and write rich Notion content with minimal token usage.

| Feature | easy-notion-mcp | Typical Notion MCP servers |
|---|---|---|
| **Content format** | Standard markdown | Raw Notion API JSON |
| **Token efficiency** | 87% reduction (measured) | Baseline — full JSON payloads |
| **Tools** | 26 individually-named tools | Auto-generated or composite tools |
| **Block types** | 20+ (toggles, columns, callouts, equations, embeds, tables, file uploads) | 2–5 basic types, or raw JSON for everything |
| **Round-trip fidelity** | Yes — read markdown, modify, write back | No — format lost on round-trip |
| **File uploads** | Yes (`file:///path`) | Rarely supported |
| **Comments** | Yes (list + add) | Varies |
| **Prompt injection defense** | Yes (content notice prefix + URL sanitization) | Rarely implemented |
| **Database entry format** | Simple `{"Status": "Done"}` key-value pairs | Nested `{ select: { name: "Done" } }` objects |
| **Auth options** | API token or OAuth | Varies |

### How many tokens does easy-notion-mcp save?

| Operation | Typical Notion MCP servers | easy-notion-mcp | Savings |
|---|---|---|---|
| Page read | ~4,300 tokens | ~290 tokens | **93%** |
| Database query | ~2,500 tokens | ~320 tokens | **87%** |
| Search | ~1,580 tokens | ~370 tokens | **76%** |

*Token counts measured with tiktoken cl100k_base encoding on equivalent operations. "Typical Notion MCP servers" refers to servers that return raw Notion API JSON.*

## How do I set up easy-notion-mcp?

### With OAuth (recommended)

Run the HTTP server, then connect with any MCP client. OAuth handles authentication — no token to copy-paste.

**Start the server:**

```bash
npx easy-notion-mcp-http
```

Requires `NOTION_OAUTH_CLIENT_ID` and `NOTION_OAUTH_CLIENT_SECRET` env vars. See [OAuth setup](#oauth--http-transport) below.

**Connect from Claude Code:**

```bash
claude mcp add notion --transport http http://localhost:3333/mcp
```

**Connect from Claude Desktop:**

Go to Settings > Connectors > Add custom connector, enter `http://localhost:3333/mcp`.

Your browser will open to Notion's authorization page. Pick the pages to share, click Allow, done.

### With API token

Create a [Notion integration](https://www.notion.so/my-integrations), copy the token, share your pages with it.

**Claude Code:**

```bash
claude mcp add notion -- npx -y easy-notion-mcp
```

Set the env var: `export NOTION_TOKEN=ntn_your_integration_token`

**Claude Desktop** — add to `claude_desktop_config.json`:

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

**Cursor** — add to `.cursor/mcp.json`:

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

**VS Code Copilot** — add to `.vscode/mcp.json`:

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

**Windsurf** — add to `~/.windsurf/mcp.json`:

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

**OpenClaw** — add to `openclaw.json`:

```bash
openclaw config set mcpServers.notion.command "npx"
openclaw config set mcpServers.notion.args '["easy-notion-mcp"]'
```

Set the env var: `export NOTION_TOKEN=ntn_your_integration_token`

easy-notion-mcp works with any MCP-compatible client. The server runs via stdio (API token mode) or HTTP (OAuth mode).

## Why markdown-first?

Other Notion MCP servers pass raw Notion API JSON to agents — deeply nested block objects, rich text annotation arrays, property schemas with redundant metadata. Agents burn tokens parsing structure instead of doing work.

easy-notion-mcp speaks markdown. Agents already know markdown. There's nothing new to learn, no format to translate, no block objects to construct. The agent writes markdown, easy-notion-mcp handles the conversion to Notion's block API.

easy-notion-mcp also means agents can **edit existing content**. Read a page, get markdown back, modify the string, write it back. With JSON-based servers, agents have to reconstruct block objects from scratch or manipulate deeply nested arrays — most give up and just overwrite.

## How does easy-notion-mcp work?

**Pages** — write and read markdown:

```
create_page({
  title: "Sprint Review",
  markdown: "## Decisions\n\n- Ship v2 by Friday\n- [ ] Update deploy scripts\n\n> [!WARNING]\n> Deploy window is Saturday 2–4am only"
})
```

Read it back — same markdown comes out:

```
read_page({ page_id: "..." })
→ { markdown: "## Decisions\n\n- Ship v2 by Friday\n- [ ] Update deploy scripts\n\n> [!WARNING]\n> Deploy window is Saturday 2–4am only" }
```

Modify the string, call `replace_content`, done. Or target a single section by heading name with `update_section`. Or do a surgical `find_replace` without touching the rest of the page.

**Databases** — write simple key-value pairs:

```
add_database_entry({
  database_id: "...",
  properties: { "Status": "Done", "Priority": "High", "Due": "2025-03-20", "Tags": ["v2", "launch"] }
})
```

No property type objects, no nested `{ select: { name: "Done" } }` wrappers. easy-notion-mcp fetches the database schema at runtime and converts automatically. Agents pass `{ "Status": "Done" }`, easy-notion-mcp does the rest.

**Errors tell you how to fix them.** A wrong heading name returns the available headings. A missing page suggests sharing it with the integration. A bad filter tells you to call `get_database` first. Agents can self-correct without asking the user for help.

**Complex content works.** Nested toggles inside toggles, columns with mixed content types (lists + code blocks + blockquotes), deep list nesting, and full unicode (Japanese, Chinese, Arabic, emoji) all round-trip cleanly. `update_section` heading search is case-insensitive and returns available headings on miss. `add_database_entries` handles partial failures — succeeded and failed entries are returned separately so agents can retry just the failures.

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

easy-notion-mcp supports 20+ block types using standard markdown syntax extended with conventions for Notion-specific blocks like toggles, columns, and callouts. Agents write familiar markdown — easy-notion-mcp handles the conversion to and from Notion's block format.

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

## Frequently Asked Questions

### How is easy-notion-mcp different from the official Notion MCP server?

easy-notion-mcp uses standard markdown as its content format. The official Notion MCP server passes raw Notion API JSON — deeply nested block objects that burn thousands of tokens and force agents to construct complex data structures. easy-notion-mcp saves 87% of tokens, supports 20+ block types (including toggles, columns, and callouts that the official server marks as unsupported), and guarantees round-trip fidelity so agents can read, modify, and rewrite pages without format loss.

### Does easy-notion-mcp work with Claude Desktop?

Yes. Add the easy-notion-mcp configuration to `claude_desktop_config.json` with your Notion API token. easy-notion-mcp works with Claude Desktop in both stdio mode (API token) and HTTP mode (OAuth). See the [setup instructions](#how-do-i-set-up-easy-notion-mcp) for the copy-pasteable config.

### Does easy-notion-mcp work with Cursor?

Yes. Add the easy-notion-mcp configuration to `.cursor/mcp.json`. easy-notion-mcp's 26 individually-named tools are fully compatible with Cursor's MCP integration. See the [setup instructions](#how-do-i-set-up-easy-notion-mcp) for the copy-pasteable config.

### Does easy-notion-mcp work with OpenClaw?

Yes. easy-notion-mcp works with OpenClaw's native MCP server support. Add it to `openclaw.json` using `openclaw config set` commands. easy-notion-mcp's markdown-first approach is especially valuable for OpenClaw agents, which commonly struggle to construct raw Notion block JSON. See the [setup instructions](#how-do-i-set-up-easy-notion-mcp) for the copy-pasteable config.

### Does easy-notion-mcp work with Windsurf?

Yes. Add the easy-notion-mcp configuration to `~/.windsurf/mcp.json`. See the [setup instructions](#how-do-i-set-up-easy-notion-mcp) for the copy-pasteable config.

### Does easy-notion-mcp support file uploads?

Yes. easy-notion-mcp supports file uploads using the `file:///` protocol in markdown syntax. Upload images with `![alt](file:///path/to/image.png)` and files with `[name](file:///path/to/file.pdf)`.

### Does easy-notion-mcp handle nested and complex content?

Yes. Nested toggles inside toggles, columns with mixed content types (lists, blockquotes, and code blocks in different columns), nested bullet and numbered lists, and full unicode support including Japanese, Chinese, Russian, Arabic, and emoji — all round-tripping cleanly.

### Does easy-notion-mcp handle partial failures in batch operations?

Yes. `add_database_entries` returns separate `succeeded` and `failed` arrays. If one entry fails validation, the others still get created. Agents can retry just the failures without re-sending the whole batch.

## License

MIT

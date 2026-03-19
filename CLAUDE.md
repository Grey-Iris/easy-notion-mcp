# easy-notion-mcp

Markdown-first Notion MCP server. Agents write markdown, the server converts it to Notion's block API. Agents never touch Notion block objects directly.

## Commands

```bash
npm run build    # tsc → dist/
npm test         # vitest
npm run dev      # tsc --watch
node dist/index.js  # start server (needs NOTION_TOKEN env var)
```

## Architecture

```
src/
├── index.ts              # MCP server, tool definitions, tool handlers (switch statement)
├── markdown-to-blocks.ts # Markdown → Notion blocks (uses `marked` parser)
├── blocks-to-markdown.ts # Notion blocks → Markdown (reverse conversion)
├── file-upload.ts        # file:// URL processing, uploads to Notion (max 20 MB)
├── notion-client.ts      # @notionhq/client SDK wrappers, batching, pagination
└── types.ts              # Shared types (NotionBlock, RichText)
```

- `index.ts` registers tools via `ListToolsRequestSchema` and handles calls via `CallToolRequestSchema`
- `find_replace` is the one editing tool that uses Notion's native markdown API via `pages.updateMarkdown`, rather than the GFM-to-blocks pipeline used by the other page content tools
- All logging goes to `console.error` (stdout is reserved for MCP protocol)

## Environment

- `NOTION_TOKEN` (required)
- `NOTION_ROOT_PAGE_ID` (optional default parent)
- `NOTION_TRUST_CONTENT` (optional, default false) — when true, skips the content notice prefix on `read_page` responses

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
4. **index.ts** — Update the `create_page` tool description to document the new syntax

## Key decisions

- **`marked`** for markdown parsing (nested token tree, bundled TS types, simpler than remark/unified)
- **`@notionhq/client` v5.13.x** — matches Notion-Version: 2025-09-03
- **Markdown as the interface** — agents never construct Notion block objects. This keeps tool usage simple and lets the conversion logic evolve independently
- **Database entry conversion** — fetches database schema at runtime to correctly map simple key-value pairs to Notion property format
- **Schema caching** — database schemas are cached in-memory with a 5-minute TTL to avoid redundant API calls during batch operations

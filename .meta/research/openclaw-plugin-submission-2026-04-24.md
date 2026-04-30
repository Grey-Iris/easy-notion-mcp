---
title: OpenClaw Plugin submission flow for easy-notion-mcp
date: 2026-04-24
status: research complete
---

# OpenClaw Plugin submission flow

## What is a Plugin?

A **Plugin** is a native code extension that runs in-process inside the OpenClaw Gateway daemon. Unlike a **Skill** (a text-based instruction bundle defined by a `SKILL.md` file that the agent reads), a Plugin is a Node/TypeScript module that registers runtime capabilities via a typed SDK API. Plugins execute at the gateway level -- they can register tools, HTTP routes, background services, lifecycle hooks, CLI commands, and more.

The key architectural distinction: a Skill tells the agent *what to do*; a Plugin tells the gateway *what it can do*. Skills are agent-facing instructions. Plugins are gateway-facing code.

**Sources:**
- https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md
- https://docs.openclaw.ai/tools/plugin
- https://docs.openclaw.ai/plugins/building-plugins

## Submission flow

Plugin publishing uses a **different CLI surface** from Skills:

| Aspect | Skill | Plugin (code-plugin) |
|--------|-------|---------------------|
| CLI command | `clawhub skill publish <path>` | `clawhub package publish <source>` |
| Source formats | Local folder only | Local folder, `owner/repo`, `owner/repo@ref`, GitHub URL |
| Metadata source | `SKILL.md` YAML frontmatter | `package.json` `openclaw.*` fields + `openclaw.plugin.json` |
| Version source | `--version` flag (manual) | `package.json` `version` field (auto-detected) |
| Web UI | N/A | https://clawhub.ai/publish-plugin (drag-and-drop + form) |
| CI integration | None documented | Reusable workflow at `.github/workflows/package-publish.yml` |

**Account requirements** are the same: GitHub OAuth, account > 1 week old.

**Publishing commands:**

```bash
npm i -g @clawhub/cli
clawhub login                                          # GitHub OAuth

# Dry run first
clawhub package publish ./path-to-plugin --dry-run

# Publish
clawhub package publish ./path-to-plugin

# Or publish from GitHub directly
clawhub package publish Grey-Iris/easy-notion-mcp
```

Additional flags: `--json` (CI output), `--owner <handle>` (publish under org), `--family`/`--name`/`--version` (override auto-detection).

New releases stay private until automated security checks finish. This is a gated flow, unlike Skills which appear immediately.

**Sources:**
- https://github.com/openclaw/clawhub/blob/main/docs/cli.md
- https://clawhub.ai/publish-plugin

## Manifest format

A Plugin requires **two** manifest files:

### 1. `openclaw.plugin.json` (plugin manifest)

Required fields: `id`, `configSchema` (JSON Schema, even if empty).
Optional fields: `name`, `description`, `version`, `enabledByDefault`, `kind`, `channels`, `providers`, `skills`, `contracts`, `modelSupport`, `activation`, `setup`, `uiHints`, `channelConfigs`, `providerAuthEnvVars`, `commandAliases`, `qaRunners`, and more.

Parsed with JSON5 (comments and trailing commas allowed).

```jsonc
{
  "id": "easy-notion-mcp",
  "name": "Easy Notion MCP",
  "description": "Full-featured Notion MCP server: pages, databases, blocks, comments, search, and people/relation properties.",
  "version": "0.5.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "notionApiKey": {
        "type": "string",
        "description": "Notion internal integration token"
      }
    },
    "required": ["notionApiKey"]
  },
  "contracts": {
    "tools": [
      "notion_search",
      "notion_list_pages",
      "notion_read_page",
      "notion_create_page",
      "notion_update_page",
      "notion_archive_page",
      "notion_restore_page",
      "notion_duplicate_page",
      "notion_move_page",
      "notion_share_page",
      "notion_append_content",
      "notion_replace_content",
      "notion_update_section",
      "notion_find_replace",
      "notion_list_databases",
      "notion_get_database",
      "notion_query_database",
      "notion_create_database",
      "notion_add_database_entry",
      "notion_add_database_entries",
      "notion_update_database_entry",
      "notion_delete_database_entry",
      "notion_list_comments",
      "notion_add_comment",
      "notion_list_users",
      "notion_get_me",
      "notion_create_page_from_file",
      "notion_update_data_source"
    ]
  },
  "uiHints": {
    "notionApiKey": {
      "label": "Notion API Key",
      "sensitive": true,
      "placeholder": "ntn_..."
    }
  }
}
```

### 2. `package.json` `openclaw.*` fields

```json
{
  "name": "easy-notion-mcp",
  "version": "0.5.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./src/plugin-entry.ts"],
    "runtimeExtensions": ["./dist/plugin-entry.js"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2"
    }
  }
}
```

Required `openclaw.*` fields:
- `openclaw.extensions` -- TypeScript entrypoints (dev)
- `openclaw.compat.pluginApi` -- semver range for API compatibility
- `openclaw.build.openclawVersion` -- OpenClaw version the plugin was built against

Optional but recommended:
- `openclaw.runtimeExtensions` -- pre-built JS entrypoints (production)
- `openclaw.compat.minGatewayVersion` -- minimum gateway version
- `openclaw.install.npmSpec` -- npm install spec

Validation: `pluginApi` and `minGatewayVersion` are checked at install time. Incompatible hosts fail closed.

### 3. Plugin entry point (`src/plugin-entry.ts`)

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

export default definePluginEntry({
  id: "easy-notion-mcp",
  name: "Easy Notion MCP",
  register(api) {
    // Register each tool via api.registerTool({ ... })
    // Or bridge the existing MCP server via an MCP client
  },
});
```

**Sources:**
- https://docs.openclaw.ai/plugins/manifest (full schema reference)
- https://docs.openclaw.ai/plugins/building-plugins

## "Beyond MCP" -- what the Plugin model offers

This is the core value of going Plugin over Skill. A Skill just wraps the MCP server as a black box the agent invokes. A Plugin integrates at the gateway level with these extension points:

### Integration points available via `api.register*()`

| Method | What it does | Notion use case |
|--------|-------------|-----------------|
| `registerTool()` | Agent-callable tool | Primary: register all 28+ Notion tools directly, skip MCP protocol overhead |
| `registerService()` | Background service with `start()`/`stop()` lifecycle | Persistent SSE/polling listener for Notion webhook events, page-change watchers |
| `registerHttpRoute()` | HTTP endpoint on the gateway | Receive Notion webhooks directly at the gateway (no external relay needed) |
| `registerHook()` / `on()` | Lifecycle hooks (`before_tool_call`, `message_sending`, etc.) | Pre-validate Notion API key before tool calls; inject Notion context into messages |
| `registerCommand()` | Slash commands | `/notion search <query>`, `/notion status` |
| `registerCli()` | CLI subcommands | `openclaw notion setup` for guided API key configuration |
| `registerWebFetchProvider()` | Web fetch provider | Resolve `notion.so` URLs to page content via the API instead of scraping |
| `registerContextEngine()` | Context engine | Index Notion pages into the agent's context/memory system |
| `registerProvider()` | Model/LLM provider | Not applicable |
| `registerChannel()` | Chat channel | Not applicable |

### Gateway-level webhook flow

OpenClaw's webhook system operates at gateway config level (`hooks.enabled`, `hooks.mappings`). A Plugin can register HTTP routes via `registerHttpRoute()` that receive external POSTs. Combined with `registerService()` for a persistent listener, this enables:

1. Notion sends webhook to `gateway:18789/hooks/notion-update`
2. Plugin's registered HTTP route receives the payload
3. Plugin enqueues a system event via `/hooks/wake` or processes inline
4. Agent receives notification: "Page X was updated"

This is architecturally impossible with a Skill, which is passive text.

### Cron/scheduled tasks

OpenClaw has built-in cron support (`openclaw cron add`). A Plugin's `registerService()` can also implement its own polling loop. Either mechanism enables periodic Notion workspace syncing without user intervention.

### Tool registration: direct vs. MCP bridge

Two patterns exist in the wild:

1. **Direct registration** -- each tool registered individually via `api.registerTool()`. Used by the Chorus plugin (40 tools). Lower overhead, tighter integration, but requires maintaining tool definitions in two places (MCP server + plugin).

2. **MCP bridge** -- the `@aiwerk/openclaw-mcp-bridge` plugin connects to MCP servers and bridges their tools into OpenClaw. Two modes:
   - *Direct mode*: each MCP tool becomes a separate OpenClaw tool
   - *Router mode*: all tools funnel through a single `mcp` meta-tool (saves ~99% tool-token overhead for 3+ servers)

For easy-notion-mcp, either path works. The bridge approach means zero plugin-side tool definitions but adds the MCP protocol layer. Direct registration is tighter but duplicates schemas.

**Sources:**
- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/automation/webhook
- https://chorus-ai.dev/blog/building-openclaw-plugin-for-chorus/
- https://github.com/AIWerk/openclaw-mcp-bridge

## Examples in the wild

### 1. Chorus OpenClaw Plugin (`@chorus-aidlc/chorus-openclaw-plugin`)

MCP-wrapping plugin. 40 tools across PM, dev, and admin categories. Uses `registerService()` for a persistent SSE connection, `registerTool()` for each tool (bridges to MCP client internally), and `registerCommand()` for slash commands.

Directory layout:
```
packages/openclaw-plugin/
  openclaw.plugin.json
  package.json
  src/
    index.ts           # definePluginEntry + register()
    config.ts           # Zod config schema
    mcp-client.ts       # MCP connection
    sse-listener.ts     # SSE with backoff
    tools/
      pm-tools.ts
      dev-tools.ts
      common-tools.ts
```

Source: https://chorus-ai.dev/blog/building-openclaw-plugin-for-chorus/

### 2. OpenClaw MCP Bridge (`@aiwerk/openclaw-mcp-bridge`)

Generic MCP-to-OpenClaw bridge. Supports stdio and SSE transports. Router mode for multi-server setups. Has a built-in catalog of MCP servers (including Notion). 198 commits, 12 stars.

Source: https://github.com/AIWerk/openclaw-mcp-bridge

### 3. Opik OpenClaw Plugin (`@opik/opik-openclaw`)

Observability plugin that exports agent traces. Uses `openclaw.extensions` + `openclaw.runtimeExtensions` pattern. Published on ClawHub via `clawhub package publish`. Simpler structure (no tools, just hooks).

Source: https://github.com/comet-ml/opik-openclaw

### 4. SecureClaw

Dual-stack security plugin and skill for OpenClaw. Published as both a Skill and a Plugin, demonstrating that the two can coexist for the same product.

Source: https://www.helpnetsecurity.com/2026/02/18/secureclaw-open-source-security-plugin-skill-openclaw/

## Quality bar

### License

Skills are forced to MIT-0 on ClawHub. **For code plugins, the docs do not explicitly state the same MIT-0 forcing.** The ClawHub changelog mentions MIT-0 enforcement in the context of "published skills" specifically. Code plugins published via `clawhub package publish` may retain their source license. This is a gap -- verify before publishing.

### Security analysis

- Same GitHub account age gate (> 1 week, some sources say > 14 days -- discrepancy exists)
- New plugin releases stay **private until automated security checks finish** (unlike Skills which appear immediately)
- The `env-declared-must-match-env-referenced` static analysis likely applies (it's a registry-wide check), but this is extrapolated from the Skill docs; not explicitly confirmed for code plugins
- VirusTotal scanning (if enabled server-side)
- Structured moderation verdicts: `clean | suspicious | malicious`
- Static malware detection for obfuscated payloads (auto-hides + flags uploader)
- Auto-hide after 4 unique reports

### Compatibility validation

- `openclaw.compat.pluginApi` and `minGatewayVersion` checked at install time
- Missing or invalid `openclaw.plugin.json` blocks config validation entirely
- `configSchema` validated at config read/write time (not runtime)

## Gaps and uncertainties

1. **License ambiguity for code plugins.** The MIT-0 forcing is documented for Skills. Whether it applies to code plugins published via `clawhub package publish` is not confirmed. The existing easy-notion-mcp repo uses MIT. This needs verification before publishing -- if MIT-0 is forced, we lose attribution rights on the ClawHub copy.

2. **GitHub account age gate: 7 days or 14 days?** The Skill-focused research says > 1 week. The security doc says >= 14 days. These may refer to different checks (Skills vs. code plugins), or the threshold may have changed. Verify at publish time.

3. **Plugin API version to target.** The examples use `>=2026.3.24-beta.2` for `pluginApi`. The current OpenClaw release is `v2026.4.22`. Need to check which stable pluginApi version to declare for broadest compat.

4. **Existing Notion plugins on ClawHub.** The MCP Bridge plugin already has Notion in its built-in server catalog. No standalone Notion plugin was found, but the bridge's catalog entry may reduce the "first mover" impact vs. the Skill-side empty search.

5. **`registerHttpRoute()` async registration bug.** As of v2026.4.10, async `register()` functions cause HTTP routes to silently fail (issues #64937, #67891). If easy-notion-mcp's plugin uses async registration (likely, since it connects to external APIs), webhook routes may not work until this bug is fixed. Workaround: register routes synchronously, defer async work to `registerService()`.

6. **Direct registration vs. MCP bridge -- build cost.** Direct tool registration means maintaining JSON Schema definitions in two places (MCP server `inputSchema` and plugin `parameters`). The bridge approach avoids this but adds runtime overhead. No clear community consensus on which is preferred for large tool surfaces (28+ tools).

7. **Security review latency.** Plugins stay private until automated checks finish. No SLA documented. Could be minutes or days.

8. **Dual-stack feasibility.** SecureClaw publishes as both Skill and Plugin. Easy-notion-mcp could do the same -- Skill for discoverability (immediate listing, searchable), Plugin for power users who want gateway integration. The Skill would point users to the Plugin. This is a strategic option, not a technical constraint.

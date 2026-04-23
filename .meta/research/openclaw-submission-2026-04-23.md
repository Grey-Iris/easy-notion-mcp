---
title: OpenClaw / ClawHub submission flow for easy-notion-mcp
date: 2026-04-23
status: research complete
---

# OpenClaw submission flow

## What it is

**OpenClaw** (github.com/openclaw/openclaw, ~362k stars) is a self-hosted personal AI assistant ("The lobster way 🦞"). Its public registry is **ClawHub** at https://clawhub.ai (repo github.com/openclaw/clawhub, MIT, ~8k stars). ClawHub hosts two catalog kinds: **Skills** (agent skill bundles, `SKILL.md` + supporting text files) and **Plugins** (Gateway plugins). About 65% of active OpenClaw skills wrap an underlying MCP server; that is the standard mechanism for surfacing an MCP server to OpenClaw users.

**No Notion skill exists yet.** A search of `clawhub.ai/skills?q=notion` returns 0 results (grep of archived skills shows a `byungkyu/notion-mcp` SKILL.md in the mirror, but it is not discoverable in the live UI). Clear land-grab.

## How to submit

**Not a GitHub PR.** ClawHub publishes via its CLI against the Convex-backed HTTP API. There is no submission form, no review queue — you authenticate with GitHub OAuth and publish directly. Skills appear immediately (soft-moderation, not gated review). Account must be > 1 week old.

```bash
npm i -g @clawhub/cli          # or: bun install -g clawhub
clawhub login                  # GitHub OAuth
clawhub publish ./path-to-skill
```

The archive mirror `github.com/openclaw/skills` (populated automatically) is read-only; do not PR there.

Slug rules: lowercase, URL-safe `^[a-z0-9][a-z0-9-]*$`. Each publish is a new semver version. Bundle limit 50 MB. License is forced to MIT-0 (no per-skill override).

Docs:
- https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md
- https://github.com/openclaw/clawhub/blob/main/docs/quickstart.md
- https://github.com/openclaw/clawhub/blob/main/CONTRIBUTING.md

## SKILL.md template (for easy-notion-mcp)

Based on `skills/byungkyu/notion-mcp/SKILL.md` in the archive:

```yaml
---
name: easy-notion-mcp
description: |
  Full-featured Notion MCP server — pages, databases, blocks, comments,
  search, and people/relation properties. Use when a user wants to read
  or write Notion workspaces from their agent.
version: 0.4.0
metadata:
  openclaw:
    emoji: "📝"
    homepage: https://github.com/Grey-Iris/easy-notion-mcp
    primaryEnv: NOTION_API_KEY
    requires:
      env:
        - NOTION_API_KEY
    install:
      - kind: node
        package: easy-notion-mcp
        bins: [easy-notion-mcp]
---

# Easy Notion MCP

<then: markdown body the agent reads — when to invoke, tool overview, examples>
```

Key fields the registry extracts: `name`, `description` (the search/UI summary), `version`, `metadata.openclaw.homepage` (links GitHub), `primaryEnv`, `requires.env` (must match what the server actually references — security analysis flags mismatches and can soft-reject), `install.kind: node` + `package: easy-notion-mcp` (so `clawhub install easy-notion-mcp` wires npm).

## Quality bar

- No star/age minimum on the repo. GitHub account must be > 1 week old.
- MIT-0 license on the published skill (repo can stay MIT).
- Automated security analysis: env declared in frontmatter must match env referenced in code/body. Mismatch = flagged.
- Optional VirusTotal scanning (if enabled server-side).
- Telemetry on installs auto-counts — no action needed.
- Time-to-listed: immediate on publish.

## Adjacent MCP directories worth cross-submitting

- **Anthropic official** — github.com/modelcontextprotocol/servers (community list in README); PR to add.
- **Smithery** — smithery.ai; claim via GitHub OAuth, auto-indexes repos with `smithery.yaml`.
- **PulseMCP** — pulsemcp.com; form-based listing, editorial curation.
- **Glama** — glama.ai/mcp/servers; auto-scans GitHub for `mcp` topic + server manifest.
- **mcp.so** — largest passive aggregator; listings auto-scraped from GitHub topic `mcp-server`.
- **LobeHub MCP** — lobehub.com/mcp; PR to lobehub/mcp-marketplace.
- **mcp-get** — github.com/michaellatman/mcp-get; npm-first CLI registry, PR to add.
- **Composio** — composio.dev/mcp; partner-style, requires outreach.

## Gaps / uncertainties

- CLI distribution channel not 100% confirmed — `clawhub` CLI is in `packages/clawhub/` of the monorepo; the npm name may be `@clawhub/cli`, `clawhub`, or both (README mentions `clawhub` and `clawdhub` as bin aliases). Verify when installing.
- Live `clawhub.ai` skill search fetched via WebFetch returns the SSR shell ("0 results"); the archive GitHub mirror is the authoritative source for confirming whether a slug exists. The empty-search result for "notion" on the live site may therefore be a hydration artifact — worth a manual browser check before claiming first-mover status in a public post.

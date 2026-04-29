# Wave 1 — Distribution & Discoverability: easy-notion-mcp vs. Notion-hosted MCP

**Date:** 2026-04-28
**Researcher:** Strategy Wave 1 delegate
**Question:** Where do users actually discover and choose Notion MCP servers, and how visible is third-party `easy-notion-mcp` next to Notion's first-party hosted option in those discovery surfaces?

---

## TL;DR — the structural picture

Notion did not just publish a hosted endpoint. Between July 2025 and Q1 2026 they shipped **branded, one-click "plugin" installers** for the two most-trafficked MCP-using apps (Cursor and Claude Code), got listed in the **Claude Connectors Directory** that ships to all Claude plans including Free, and blanketed every public registry as the default Notion result. easy-notion-mcp is *present* on most registries but ranked behind the official server by ~165× weekly visitors on PulseMCP and ~280× by GitHub stars. The discovery layer is not contested — it has been won.

---

## 1. Per-surface comparison

| Surface | How `mcp.notion.com` (hosted) appears | How `easy-notion-mcp` appears | UX differential | Favors first-party? |
|---|---|---|---|---|
| **Claude Desktop — Connectors Directory** | Pre-listed under Productivity → "Notion." Settings → Connectors → Browse → search "Notion" → click `+` → OAuth. Available on Claude Free, Pro, Max, Team, Enterprise (Connectors directory shipped to all plans Feb 2026). Listed at `claude.com/connectors/notion`. ([1](https://claude.com/connectors/notion), [2](https://support.claude.com/en/articles/11724452-use-the-connectors-directory-to-extend-claude-s-capabilities)) | Not in directory. Path is "Add Connector → enter custom URL" (for HTTP transport) or `claude_desktop_config.json` edit (stdio). No featured placement, no OAuth button — user must already know the npm package name and have a Notion integration token. | ~3 clicks vs. text-editor-and-API-token setup. For non-technical users on Free plan, it's effectively only the hosted option that's reachable. | **Yes, decisively.** |
| **Claude Code (CLI)** | Two paths: (a) `claude mcp add --transport http notion https://mcp.notion.com/mcp` — single one-liner with auto-OAuth ([3](https://code.claude.com/docs/en/mcp)); (b) Official plugin: `/plugin marketplace add makenotion/claude-code-notion-plugin` then `/plugin install notion-workspace-plugin@notion-plugin-marketplace` — bundles **MCP server + 4 Skills + slash commands** in one package ([4](https://github.com/makenotion/claude-code-notion-plugin)). Plugin has ~296–340 GitHub stars (Feb 2026). | Documented as `claude mcp add notion -s user -e NOTION_TOKEN=... -- npx -y easy-notion-mcp`. One-liner shape parity, BUT user must first create a Notion internal integration to get the token (Notion settings → Connections → Develop or manage integrations → New). Not packaged as a `/plugin marketplace` entry. | Hosted: zero pre-flight (OAuth handles auth). easy-notion-mcp: ~5-minute integration-token setup BEFORE the one-liner runs. Plugin path adds a Skills/slash-commands surface easy-notion-mcp doesn't have at all. | **Yes, but narrower gap on the raw `claude mcp add` flow.** |
| **Cursor** | Pre-listed in Cursor Marketplace at `cursor.com/marketplace/notion` ("Productivity" category). Official `makenotion/cursor-notion-plugin` packages **Notion Skills + Notion MCP server**. Install: `/add-plugin notion-workspace` or click "Add to Cursor." Notion's blog notes they "worked closely with Cursor's engineering team to prioritize a delightful OAuth connection experience using streamable HTTP." ([5](https://cursor.com/marketplace/notion), [6](https://github.com/makenotion/cursor-notion-plugin), [7](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)) | Not in Cursor's first-party Marketplace. Listed on third-party `cursor.directory/mcp/notion-6` aggregator (which is community-curated, not the official Cursor UI). User would discover it only by searching outside Cursor and pasting JSON into `mcp.json`. | Hosted: 1 click in the Cursor UI's own Marketplace tab + OAuth. easy-notion-mcp: out-of-band. | **Yes, decisively.** Notion is a *featured launch partner* of Cursor's Feb 2026 marketplace. |
| **VS Code (GitHub Copilot Chat MCP)** | Notion documented as a supported client. VS Code has built-in MCP gallery (Extensions view → `@mcp` prefix). Notion's own docs page enumerates VS Code with one-click OAuth via the hosted endpoint. ([8](https://developers.notion.com/docs/common-mcp-clients)) | Not in VS Code's `@mcp` gallery. Manual `mcp.json` config required. | Same UX delta as Cursor. | **Yes.** |
| **Anthropic `modelcontextprotocol/servers` GitHub** | Not listed (this repo only contains the 7 *reference* servers: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time). Several others archived. Anthropic split community servers into a separate "MCP Registry." ([9](https://github.com/modelcontextprotocol/servers)) | Same — not listed. | Neutral surface; no advantage either way. | **No** (neither is featured here). |
| **PulseMCP** (`pulsemcp.com/servers?q=notion`) | "Official Notion MCP Server" ranks **#1** with **65,400 estimated weekly visitors**. Self-hosted instance (npx `@notionhq/notion-mcp-server`) also listed. ([10](https://www.pulsemcp.com/servers/notion), [11](https://www.pulsemcp.com/servers?q=notion)) | "Easy Notion" by Grey Iris listed at **rank ~7 (page 1)** with **395 estimated weekly visitors**. Tagged "Community." Description present: "Markdown-first Notion integration with 92% fewer tokens than the official Notion MCP server." Release date Mar 20, 2026. | **165× weekly-visitor gap.** Visible but heavily ranked-down. | **Yes, structurally.** |
| **Glama** (`glama.ai/mcp/servers`) | Multiple Notion servers listed; official is featured prominently. ~22k servers in registry. | Listed at `glama.ai/mcp/servers/Grey-Iris/easy-notion-mcp` with badge link in the project's README. Sits among ~10+ "Notion" community servers (Sjotie, Wayy-Research, awkoy, danhilse, AyanoT1, pbohannon, seonglae, acckkiie, ccabanillas, Mingxiao300, etc.). | One of many. No featured placement. | **Yes** (Notion default appears at top of Notion category). |
| **mcp.so** | Features `notion-mcp` (official) prominently. mcp.so positions itself as "the largest collection of MCP Servers." ([12](https://mcp.so/server/notion-mcp)) | Listing endpoint blocked (403 from WebFetch — could not verify). Likely indexed but rank/visibility unverified. | Unknown rank, but no featured placement evidence. | **Yes** (verified for hosted; unverified for easy-notion-mcp). |
| **LobeHub** (`lobehub.com/mcp`) | `lobehub.com/mcp/makenotion-notion-mcp-server` is the canonical first-party listing; "Top 100 Notion MCP Servers" page exists. ([13](https://lobehub.com/mcp?q=notion)) | Listed at `lobehub.com/mcp/grey-iris-easy-notion-mcp`. Listing exists; not featured. | One of 100. | **Yes** (default placement). |
| **mcpservers.org** ("Awesome MCP Servers") | `mcpservers.org/servers/makenotion/notion-mcp-server` listed. ([14](https://mcpservers.org/servers/makenotion/notion-mcp-server)) | Listed at `mcpservers.org/servers/grey-iris/easy-notion-mcp` with detailed comparison-table positioning easy-notion-mcp as more feature-rich (95.5% token savings, 25 block types, GFM round-trip). This is one of the few surfaces where easy-notion-mcp *outshines* the official server in description quality. | Editorial favors easy-notion-mcp on this page; traffic still favors the official. | **Mixed** — content-level is the third-party's most favorable surface. |
| **remote-mcp.com** | `remote-mcp.com/servers/notion` lists `https://mcp.notion.com/sse` with "13 comprehensive tools." ([15](https://www.remote-mcp.com/servers/notion)) | Not surfaced in searches. Registry is hosted-only by design (easy-notion-mcp would need to deploy a hosted instance to qualify). | N/A — wrong category for stdio-first server. | **Yes** (this surface is structurally hosted-only). |
| **Composio** (`composio.dev`) | `mcp.composio.dev/notion` is a fully-featured proprietary toolkit wrapper around Notion MCP. Composio publishes per-framework integration guides for Codex, Claude Code, OpenClaw, AutoGen, LangChain, Claude Agent SDK, Google ADK. ([16](https://mcp.composio.dev/notion)) | Not listed. Composio integrates the official server, not third-party alternatives. | Composio essentially re-distributes the official server with auth wrappers. | **Yes**, structurally — Composio's commercial angle is wrapping the *official* APIs. |
| **mcp.directory blog** ("Best Notion MCP Servers: Top 8 AI Integrations 2026") | Article exists; could not fetch (403). Blog title implies enumerated ranking. | Inclusion unverified. | Unknown. | Likely yes (typical "best of" blogs lead with first-party). |
| **OpenClaw / ClawHub** (`docs.openclaw.ai/cli/mcp`, ClawHub registry) | Composio publishes `composio.dev/toolkits/notion/framework/openclaw`. ClawHub itself is the "OpenClaw skill registry" with 13.7k+ skills as of late Feb 2026 ([17](https://skywork.ai/skypage/en/clawhub-openclaw-skill-registry/2048594472833511425)). | Per project's own audit (2026-04-23), ClawHub returned **zero results** for "notion." Recent submission via [openclaw-submission-2026-04-23.md] in this repo is in flight. ([18](.meta/research/openclaw-submission-2026-04-23.md)) | ClawHub is currently a *blank slate* for Notion — first-mover opportunity exists but small audience. | **No** — this is the one registry where the gap is open. |
| **mcp-get** | No first-party Notion listing surfaced. Project not actively visible in 2026 results. | Not surfaced. | N/A — registry is dormant or low-signal. | **No / N/A**. |
| **Smithery** (`smithery.ai`) | `smithery.ai/server/@makenotion/notion-mcp-server/api` exists; "Notion - MCP" featured under `@smithery/notion`. Multiple community Notion servers also listed (awkoy, Mingxiao300, suekou variants). ([19](https://smithery.ai/server/@makenotion/notion-mcp-server/api)) | Smithery search blocked (403); listing presence unverified. | Unknown. | **Yes** for verified surface. |

### GitHub-star ranking (signal of organic discovery, not curation)

| Repo | Stars (Feb–Apr 2026) |
|---|---|
| `makenotion/notion-mcp-server` (local server, partly deprecated) | ~3,900–4,270 |
| `makenotion/claude-code-notion-plugin` | ~296–340 |
| `awkoy/notion-mcp-server` (community) | 149 |
| `suekou/mcp-notion-server` (community) | (mid-hundreds, exact not retrieved) |
| **`Grey-Iris/easy-notion-mcp`** | **14** |

The third-party leader (`awkoy`) has ~10× easy-notion-mcp's stars and still trails the official server by ~28×.

---

## 2. Search behavior — Google, Reddit, HN

**Google "notion mcp" / "notion mcp server" (Apr 2026):**
1. `developers.notion.com/guides/mcp/mcp` — first-party docs
2. `github.com/makenotion/notion-mcp-server` — first-party GitHub
3. `notion.com/help/notion-mcp` — first-party help
4. `claude.com/connectors/notion` — Anthropic-curated first-party listing
5. Aggregator content (Composio, Skywork, ChatForest, mcp.directory blog)
6. Practitioner blog posts ("How I Connected Claude to Notion") — universally walk users to `mcp.notion.com`

**`easy-notion-mcp` does not appear on the first page of `notion mcp` searches.** It only surfaces when users search the literal string `easy-notion-mcp` or "markdown notion mcp" (specific intent).

**Reddit / HN:** No high-engagement Reddit thread surfaces for "notion mcp server." Hacker News has scattered show-HN posts ([HN 46274686](https://news.ycombinator.com/item?id=46274686), HN 47866860 on ChatGPT workspace agents, HN 46482268 Jan 2026 "What are you working on") but no consensus thread comparing options. Discussion volume is **low and scattered** — there is no "the comparison thread everyone reads," which means new entrants cannot ride existing conversation; they have to seed their own.

**Practitioner blogs:** Approximately 100% of "How to set up Notion + Claude/Cursor" blog posts in 2026 walk readers through `mcp.notion.com`. Token-efficiency alternatives are mentioned occasionally but never as the recommended path.

---

## 3. Self-hosted as a discoverable category

**Search query: "self-hosted notion mcp" / "local notion mcp"**

What users actually find:
1. Notion's own docs page `developers.notion.com/docs/hosting-open-source-mcp` — actively recommends users **stop self-hosting** and switch to the hosted server. Notion's blog explicitly states "Notion is prioritizing, and only providing active support for, Notion MCP (remote)" and "may sunset this local MCP server repository in the future."
2. The `makenotion/notion-mcp-server` GitHub README — same deprecation messaging at the top.
3. Confusion with "self-hosted Notion **alternatives**" (AppFlowy, AFFiNE, Outline, Logseq) — the dominant interpretation of "self-hosted Notion" is "I'm replacing Notion," not "I'm self-hosting an MCP for Notion." This intent collision **buries** the actual self-hosted MCP category.
4. Stacklok ToolHive guide ([20](https://docs.stacklok.com/toolhive/guides-mcp/notion-remote)) — covers operational deployment.
5. MCP Manager / gateway products (mcpmanager.ai) — enterprise gateway angle, not consumer discovery.

**There is no recognizable category page for "self-hosted/third-party Notion MCP."** The category is fragmented across:
- Privacy/enterprise enterprise-gateway content (Portkey, MCP Manager, Stacklok)
- Token-efficiency alternative content (StackOne blog, awkoy README, easy-notion-mcp README)
- "Best of" aggregator listicles (mcp.directory blog, Skywork guides)

A privacy-sensitive user looking for "I want to keep my Notion data away from Notion's hosted infra" lands on Notion's *own* deprecation notice for the local server — and then has no clear next step. **This is the discovery gap easy-notion-mcp could fill if it had the SEO and content presence to claim it. It currently doesn't.**

---

## 4. The "branded plugin" pattern — surprise finding

The most strategically significant finding is that **Notion didn't just publish an endpoint — they published two dedicated, branded plugin packages** for the two highest-leverage MCP-using apps:

1. `makenotion/claude-code-notion-plugin` — bundles MCP server + Notion Skills (knowledge-capture, spec-to-implementation, meeting-prep, research-report) + slash commands. Installs as a Claude Code "marketplace plugin" via two slash commands. ([4](https://github.com/makenotion/claude-code-notion-plugin))
2. `makenotion/cursor-notion-plugin` — analogous bundle for Cursor's Feb 2026 marketplace. 14 skills including database creation, page finding, task creation. ([6](https://github.com/makenotion/cursor-notion-plugin))

This is meaningfully different from "we have a hosted URL." It means:
- **The plugin is the install surface, not the URL.** Users in Claude Code or Cursor never see `mcp.notion.com` — they click "install" and the OAuth + tooling appears in one bundle.
- **Plugins compose Skills with the MCP server.** Notion is shipping *prompt content* (Skills) that ride alongside the MCP tools. easy-notion-mcp competes only on the MCP layer.
- **The marketplace ranking algorithm** (whatever it is for Claude Code marketplaces and Cursor's marketplace) will surface official Notion plugins via partnership relationships, not just raw popularity.

This pattern — first-party app vendor + first-party tool publisher + bundled Skills/commands — is the **new MCP distribution unit**. Building a competing standalone MCP server without an equivalent plugin is competing on yesterday's primitive.

---

## 5. Where the gap is least bridgeable, and where it isn't

### Least bridgeable — Claude Desktop Connectors Directory
- **Anthropic-curated** with a hard partnership requirement.
- Free-plan availability means it ships to the largest possible audience.
- One-click OAuth vs. text-file editing (and editing is increasingly Pro+ only).
- No third-party "add a custom directory entry" mechanism for a community project to ride on.
- **Verdict:** Building a hosted easy-notion-mcp.com remote will not get into this directory without a partnership Notion will not give us.

### Least disadvantaged — `mcpservers.org` editorial + per-developer listings
- Already has a comparison-table page where easy-notion-mcp is positioned as **more feature-rich** than official.
- Hosting a token-efficiency narrative ("92% fewer tokens, 25 block types, GFM round-trip") works in this surface's editorial format.
- Per-developer registry pages (PulseMCP, Glama, LobeHub) all *list* easy-notion-mcp; the gap is traffic/ranking, not presence.
- This is the surface where dedicated content investment moves the needle most for the lowest cost.

### Open-but-low-leverage — ClawHub
- Currently 0 Notion entries (per repo's own April 2026 audit).
- Submission already in flight (`openclaw-submission-2026-04-23.md`).
- First-mover advantage exists but the audience is small relative to Cursor/Claude Code.

---

## 6. Constraints / things future planners should not investigate further

- **`makenotion/notion-mcp-server` (local server) is being sunset.** Per Notion's own README and blog, "issues and pull requests are not actively monitored" and "may sunset this local MCP server repository in the future." Counting on the local server being a stable comparison baseline is risky — Notion is centralizing on the hosted endpoint.
- **Anthropic's `modelcontextprotocol/servers` GitHub repo is not a useful distribution target.** It only contains 7 reference implementations and doesn't accept third-party app integrations. The "MCP Registry" they reference is a separate property.
- **mcp-get appears dormant.** Not worth distribution effort.
- **Composio, Portkey, Stacklok, mcpmanager.ai** are *commercial* gateway/wrapper products. They wrap the official Notion MCP and are not a distribution channel for third-party MCP servers — they're competitive with the entire "self-host your MCP" category.
- **`remote-mcp.com` is hosted-only by design.** Listing easy-notion-mcp there requires running a hosted instance, which is a strategic choice (not just a content choice).

---

## 7. Things I could not verify

- **mcp.so** server pages returned 403 from WebFetch; cannot confirm easy-notion-mcp's specific listing rank there.
- **Smithery** server pages also returned 403; cannot enumerate Notion category listings precisely beyond search-result snippets.
- **mcp.directory blog "Top 8 Notion MCP Servers 2026"** returned 403; cannot confirm whether easy-notion-mcp is in the Top 8 or where it ranks.
- **Claude Desktop's stdio support on Free plan** — sources are mixed on whether non-Enterprise users can still add stdio servers via `claude_desktop_config.json` post-Connectors-Directory rollout. Worth verifying empirically before claiming "Free plan users cannot install easy-notion-mcp at all."
- **Cursor.directory listing of easy-notion-mcp** — fetch returned 429. Per project's own notes, easy-notion-mcp is documented as Cursor-compatible but submission status to cursor.directory specifically is unverified.

---

## Sources

- [1] [Notion | Claude Connectors Directory](https://claude.com/connectors/notion)
- [2] [Use the Connectors Directory to extend Claude's capabilities — Claude Help Center](https://support.claude.com/en/articles/11724452-use-the-connectors-directory-to-extend-claude-s-capabilities)
- [3] [Connect Claude Code to tools via MCP — Claude Code Docs](https://code.claude.com/docs/en/mcp)
- [4] [makenotion/claude-code-notion-plugin — GitHub](https://github.com/makenotion/claude-code-notion-plugin)
- [5] [Notion | Cursor Plugins](https://cursor.com/marketplace/notion)
- [6] [makenotion/cursor-notion-plugin — GitHub](https://github.com/makenotion/cursor-notion-plugin)
- [7] [Notion's hosted MCP server: an inside look — Notion Blog](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [8] [Common Notion MCP clients — Notion Developers](https://developers.notion.com/docs/common-mcp-clients)
- [9] [modelcontextprotocol/servers — GitHub](https://github.com/modelcontextprotocol/servers)
- [10] [Official Notion MCP Server — PulseMCP](https://www.pulsemcp.com/servers/notion)
- [11] [PulseMCP — search "notion"](https://www.pulsemcp.com/servers?q=notion)
- [12] [notion-mcp — mcp.so](https://mcp.so/server/notion-mcp)
- [13] [Top 100 Notion MCP Servers — LobeHub](https://lobehub.com/mcp?q=notion)
- [14] [Notion MCP Server — mcpservers.org](https://mcpservers.org/servers/makenotion/notion-mcp-server)
- [15] [Notion — Remote MCP](https://www.remote-mcp.com/servers/notion)
- [16] [Notion MCP Integration for AI Agents — Composio](https://mcp.composio.dev/notion)
- [17] [The Ultimate Guide to the ClawHub OpenClaw Skill Registry in 2026 — Skywork](https://skywork.ai/skypage/en/clawhub-openclaw-skill-registry/2048594472833511425)
- [18] `.meta/research/openclaw-submission-2026-04-23.md` (in-repo)
- [19] [Notion MCP Server (makenotion) — Smithery](https://smithery.ai/server/@makenotion/notion-mcp-server/api)
- [20] [Notion MCP server guide — Stacklok ToolHive](https://docs.stacklok.com/toolhive/guides-mcp/notion-remote)
- [21] [Easy Notion MCP — mcpservers.org](https://mcpservers.org/servers/grey-iris/easy-notion-mcp)
- [22] [Easy Notion MCP — Glama](https://glama.ai/mcp/servers/Grey-Iris/easy-notion-mcp)
- [23] [Easy Notion MCP — LobeHub](https://lobehub.com/mcp/grey-iris-easy-notion-mcp)
- [24] [Hosting a local MCP server — Notion Developers](https://developers.notion.com/docs/hosting-open-source-mcp)
- [25] [Best Notion MCP Servers: Top 8 AI Integrations (2026) — mcp.directory](https://mcp.directory/blog/best-notion-mcp-servers) (referenced; couldn't fetch)

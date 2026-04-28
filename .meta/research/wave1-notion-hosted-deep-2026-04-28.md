# Wave 1 — Notion-Hosted MCP Deep Surface Map

Date: 2026-04-28
Researcher: Wave 1 deep-dive on `mcp.notion.com`
Question: What does Notion's hosted remote MCP do well, do poorly, and what gaps would a power-user / agent-orchestration workflow hit?

---

## 1. Tool surface — canonical list (18 tools, not 13)

The brief said "reportedly 13 tools." That was likely true at the July 2025 launch, but the surface has grown. The current canonical list — confirmed against `developers.notion.com/guides/mcp/mcp-supported-tools` and the StackOne deep-dive — is **18 tools** across 7 functional categories.

### General

| Tool | Purpose | Notes / gating |
|------|---------|-----|
| `notion-search` | Search workspace; with Notion AI also searches connected sources (Slack, Drive, Jira) | **30 req/min** rate limit (lower than the 180/min general limit). Connected-source search requires Notion AI subscription. |
| `notion-fetch` | Retrieve page/database/data-source content by URL or ID; returns page schema and templates | Page-level only; no per-block fetch. |

### Page authoring

| Tool | Purpose | Notes |
|------|---------|-----|
| `notion-create-pages` | Create one or more pages with properties, content, icon, cover; supports templates | "One or more" — there is some batching, but agents report it's brittle (issue #121 silently drops `date` properties; issue #244 marks `parent` as required incorrectly). |
| `notion-update-page` | Modify page properties, content, icon, cover; supports template application | **Page-level replace, not block-level patch.** Issue #258: silently ignores `in_trash`, so pages cannot be archived/deleted via this tool. Issue #239: both `properties` and `content_updates` incorrectly marked required. |
| `notion-move-pages` | Relocate pages or databases to a new parent | |
| `notion-duplicate-page` | Async copy of a page within workspace | |

### Database & view

| Tool | Purpose | Notes |
|------|---------|-----|
| `notion-create-database` | Create a database with initial data source, view, and properties | |
| `notion-update-data-source` | Modify data-source name/description/properties | Note: `notion-create-data-source` is **NOT** in the hosted MCP — issue #218 explicitly flags missing `POST /v1/databases` tool. |
| `notion-create-view` | Create a view (table/board/list/calendar/timeline/gallery/form/chart/map/dashboard) | Added 2026-03-11 per changelog. |
| `notion-update-view` | Modify view name/filters/sorts/grouping; supports clearing | Added 2026-03-11 per changelog. |

### Querying (paid-plan gated)

| Tool | Purpose | Plan gating |
|------|---------|-------------|
| `notion-query-data-sources` | Cross-data-source query with structured summaries, grouping, filters | **Enterprise + Notion AI add-on** |
| `notion-query-database-view` | Query using a saved view's filters/sorts | **Business + Notion AI add-on**, fallback when `query-data-sources` unavailable |

### Comments

| Tool | Purpose | Notes |
|------|---------|-----|
| `notion-create-comment` | Page-level, block-level, or reply | |
| `notion-get-comments` | List all comments and threads on a page; includes resolved | **No `get-by-id`**. No update or delete of comments via MCP (the underlying API got `update` and `delete` endpoints in early 2026 per Notion's changelog, but they're not exposed as MCP tools yet). |

### Users

| Tool | Purpose |
|------|---------|
| `notion-get-self` | Bot user + workspace metadata |
| `notion-get-user` | Single user by ID |
| `notion-get-users` | List all workspace users |
| `notion-get-teams` | List teamspaces and membership |

**Confidence:** High — this list is double-sourced from Notion's own supported-tools doc and StackOne's deep dive, and the per-tool issue threads on `makenotion/notion-mcp-server` confirm the names map 1:1 to the npm package's exposed surface.

---

## 2. Gaps table — what is NOT supported

This is the load-bearing section. I evaluated each item in the brief plus a few more.

| Capability | Hosted MCP support? | Evidence |
|---|---|---|
| **Block-level edit** (update one block in place) | **No.** Only `update-page` which replaces page content. | StackOne: "Cannot get, update, delete, or append individual blocks." Notion's blog inside-look explicitly says block-level edits are out of scope: *"block-level modifications are more complex, carry a higher risk of unintended changes, and require careful handling in collaborative environments."* Issue #271: even on the npm side, `API-update-a-block` is unusable because of a vendored OpenAPI bug. |
| **Append-after-anchor** (insert content after a specific block) | **No** as a discrete tool. Possible only by reconstructing the whole page via `update-page`. | Same source as above. Issue #271 commenter reported converting 42 in-place rich-text edits into 84 destructive reconstruction calls. |
| **Find / replace across blocks** | **No.** Not a tool. Agents have to fetch → diff → rewrite the page. | Not present in the supported-tools doc; no GitHub issue mentions a built-in find/replace. |
| **Delete one block** | **No.** Same page-replace pattern only. | StackOne. |
| **File upload** (image / PDF / video native upload) | **No.** Roadmap, but explicitly "not currently supported." | `developers.notion.com/docs/get-started-with-mcp` FAQ: *"Image and file uploads are not currently supported in Notion MCP, but this is on our roadmap."* Notion advises the standalone file-upload REST API as an interim. |
| **Batch ops — multi-page in one call** | **Partial.** `notion-create-pages` accepts a list. `update-page` is single-target. No multi-page-update tool. No transactional/atomic guarantees. | Supported-tools doc; agent issues #121, #239 show the batch path is fragile. |
| **Database creation (full DDL)** | **Partial.** `notion-create-database` exists, but `create-data-source` is missing — issue #218 flags this directly. |
| **Comments — get-by-id, update, delete** | **No.** Only create + list. | StackOne. Notion's underlying REST API gained update/delete in Q1 2026 but they aren't exposed as MCP tools. |
| **Page archive / restore (in_trash)** | **Broken.** `update-page` silently drops the `in_trash` parameter. | Issue #258 (open). No `archive-page` / `restore-page` tool exists. |
| **User listing** | **Yes.** `notion-get-users` works. | Supported-tools doc. |
| **Synced block CREATION via Enhanced Markdown** | **Unverified — likely preserve-only.** The Notion blog and changelog mention `<synced_block>` and `<synced_block_reference>` tags exist in Enhanced Markdown, but no source I read confirms an agent can author a *new* synced block from scratch via these tags. Issue #233 ("Creating linked database views via `<database data-source-url=...>` always fails") suggests other XML-like Enhanced-Markdown constructs work in round-trip but break on first-time creation. | This is a **flag for the strategist** — easy-notion-mcp's positioning around synced-block authoring may or may not be a real gap. Worth a 30-minute hands-on test before betting on it. |
| **Page move** | **Yes.** `notion-move-pages` exists. | Supported-tools doc. |
| **Bookmark blocks (inline URL → bookmark)** | **No** in Enhanced Markdown spec. | Issue #220, open since Feb 2026. The bookmark-block gap is on Notion's tracker without a fix; the easy-notion-mcp maintainer has self-identified this as a wedge in that issue's comments (maintainer self-attestation, not third-party endorsement). |
| **Granular OAuth scope (page picker)** | **Yes** — the OAuth flow includes a page picker, similar to internal integrations. So it's NOT all-or-nothing in theory. | `developers.notion.com/docs/authorization` and Stacklok docs. **However**: the Help Center page says *"MCP tools act with your full Notion permissions—they can access everything you can access."* This is a contradiction I couldn't fully resolve — possibly the page picker exists but defaults to "all accessible pages" and many users don't narrow it. |
| **Find-replace across full workspace** | **No tool.** | |
| **Content-level diff / merge** | **No tool.** Page replace is whole-page; no semantic merge. | |

---

## 3. Failure modes — what users actually complain about

GitHub issues on `makenotion/notion-mcp-server` (Apr 2026 snapshot, sample of 60 most recent):

1. **Issue #225 (Mar 10, open) — OAuth re-auth treadmill.** Token expires every few days. The easy-notion-mcp maintainer has self-identified this gap as a competitive wedge in the issue's comments (maintainer perspective, not independent endorsement). **Independent signal:** Andrew Nguyen (Mar 13): *"As of today, it seems to require reauth on the order of 30-90 minutes."* Multiple users requesting org-level configurable session length. The Nguyen TTL report and the "+1" pattern are the third-party evidence the gap is real beyond maintainer framing.

2. **Issue #269 (Apr 16, open) — OAuth callback Internal Server Error on Claude.ai connect.** 15+ "+1" comments through Apr 25. Hosted MCP, currently broken for many users.

3. **Issue #277 (Apr 24, open) — Notion MCP server does not work with Claude Code.** "Missing redirect_uri in OAuth request" — was working Apr 23, broke Apr 24. Multiple confirmations.

4. **Issue #271 (Apr 16, open) — `API-update-a-block` unusable.** Detailed reproduction by `dgilperez` and `PrimaryFeather` on Apr 20 — a 42-edit page required 84 destructive workaround calls. Quote: *"All block IDs changed along the way — destructive for any page that has anchor links, comments, or external deep-links."*

5. **Issue #266 (Apr 12, open) — Multi-row `<table>` silently collapses to single row in Enhanced Markdown converter.** Direct bug in the Enhanced-Markdown layer that Notion centers their value prop on.

6. **Issue #258 (Apr 7, open) — `update-page` silently ignores `in_trash`.** Pages cannot be deleted via MCP.

7. **Issue #260 — Formula and rollup property values not resolved in fetch responses.** Big deal for analytics workflows.

8. **Issue #245 — Fetch tool should expose `public_url`.** Agents can't get a shareable link without a side trip.

9. **Issue #259 — Fetch returns long S3 URLs that bloat context.** Power-user feature request for a "text only" mode.

10. **Issue #233 (Mar 17, open) — Creating linked database views via `<database data-source-url=...>` always fails.** Enhanced-Markdown round-trip works for reading but not authoring this construct.

11. **Issue #227 — Guest users completely locked out of Notion MCP.** Freelancers/contractors who are Notion guests can't connect.

12. **Issue #238 — Prompt injection security concern.** Hidden toggle blocks containing instructions execute with victim's permissions when summarized. Confused-deputy class issue.

13. **Issue #256 (Apr 6, open) — `query_data_sources` tool simply not available.** Multiple users seeing the tool missing from their advertised toolset; same problem on Codex (comment Apr 27).

### HN commentary on context bloat (`news.ycombinator.com/item?id=47158526`)

Direct quote about Notion specifically: *"the notion MCP the search tool description is basically a mini tutorial. This is going right into the context window."* Generic MCP complaint that hits Notion harder because Notion ships 18 tools each with rich descriptions: every agent invocation pays for 18 tool descriptions plus rich return payloads. StackOne's optimization marketing claims they free *up to 96% of agent context* on Notion calls — directional, not verifiable, but the gap is real enough that vendors are building businesses on it.

### Pattern across complaints

- **OAuth fragility** — token TTL, state corruption across devices, callback errors on platform launches.
- **Enhanced Markdown brittleness** — collapses tables, won't author bookmarks or linked DB views.
- **Page-replace destructiveness** — block-level state (IDs, comments, deep-links) gets nuked on round-trip.
- **Plan gating quietly hides tools** — `query-data-sources` simply doesn't appear if you don't have the right SKU; agents fail confusingly rather than getting a clean error.

---

## 4. Rate limits & quotas

- **Standard:** 180 req/min average per integration, mirroring Notion's general API rate limit.
- **Search-specific:** 30 req/min — six times stricter. Power-user agents that fan out searches will hit this fast.
- **No published per-plan quota differential** for the MCP itself. Plan tiering shows up via *which tools are available* (querying tools) and *governance* (Enterprise admin controls), not via raw request budget.
- **Free plan can use it** — the supported-tools doc and Help Center don't gate the MCP itself behind paid plans, only specific tools.

**Confidence:** Medium. The 180/min and 30/min figures are sourced from StackOne and a handful of secondary write-ups; I did not find a primary Notion document stating these exact numbers. The general 180/min is consistent with Notion's published REST API rate limit of an average of 3 req/sec.

---

## 5. Auth flow specifics

- **OAuth 2.0 only.** No bearer / API-token / internal-integration support. Notion blog: *"requires user-based OAuth authentication."*
- **Client ID Metadata Document (CIMD)** support added per MCP spec 2025-11-25 — relevant for clients implementing MCP auth correctly, lowers friction for Claude.ai-style hosted-client connection.
- **Streamable HTTP** is the recommended transport; SSE also supported at `/sse`.
- **OAuth flow includes a page picker**, so users *can* narrow scope to specific pages/databases — same UI as internal-integration page selection. **But** the Notion Help Center page says MCP tokens "access everything you can access," which suggests the default flow grants broad access and only sophisticated users narrow it. There's a tension in Notion's own documentation here that I couldn't resolve cleanly.
- **Token storage is server-side** at Notion. Users disconnect via Notion Settings → Connections → Notion MCP, or workspace admins can hit "Disconnect All Users" (Enterprise feature).
- **Token expiration is short** and not user-configurable — issue #225 documents 3+ re-auths per week, with reports of 30–90-minute expiration windows in March 2026. Multiple users requesting org-level configuration; Notion has not committed to it publicly.
- **No headless / cloud-agent path.** Notion explicitly says MCP is *"not designed for cloud-based coding agents that run without human interaction."*
- **Guest accounts blocked** (issue #227).

---

## 6. Roadmap signals

What Notion has actually said publicly:

- **File uploads:** *"on our roadmap"* — explicit, dated, present in the official FAQ. Strong signal they will close this gap. **Within 6 months: probable.**
- **Block-level edits:** *"out of scope by design"* per blog. **Not** described as a roadmap item. The phrasing implies a deliberate architectural choice, not a deferred one.
- **Batch operations:** No public commitment. The April 17, 2026 changelog focused on reliability fixes (Slack DM search, `is_archived` in fetch, `<br>` in inline code) — not new bulk-operation tools.
- **Comment update / delete:** Underlying API got these endpoints in Q1 2026 but no MCP tool exposed. Likely to be added since the API work is done — moderate probability within 6 months.
- **Synced-block authoring:** Silent in changelog. Enhanced Markdown spec has the tags. Unclear if this is a deferred feature or a "works for power users who know the syntax" thing.
- **Better OAuth ergonomics (longer tokens, SSO):** No public commitment. Issue #225 has been open since March without a Notion response.
- **Admin governance:** Active investment area — `audit`, `approved tools` are Enterprise features per April 2026 release notes. Notion's roadmap energy is going to *enterprise control plane*, not power-user authoring depth.

### Surprising negative signal

Notion's April 2026 changelog/release-notes are explicitly framed as *"AI tools now able to do more in Notion, reliably, across comments, meeting transcripts, and Notion Sites, with faster responses and new admin controls like auditing and approved tools."* That's a reliability + governance narrative, not a power-feature narrative. **Notion is not racing to close the agent-power-user gap.** They're racing to make the existing surface reliable enough for big-co rollouts.

---

## 7. What I'm confident about

- **18 tools, not 13.** Brief was outdated.
- **Page-level operations only** for content edits. Block-level is intentionally not on the table.
- **OAuth-only, no headless path.** Hard rule; Notion has stated this multiple times.
- **File uploads are a known gap with public roadmap commitment** — this is the gap most likely to close on Notion's side.
- **Enterprise + Notion AI gating** for the cross-data-source query tools is real and meaningful — the most useful query tools are paid-plan-locked.
- **Token TTL is the loudest user complaint** and is *already* the gap easy-notion-mcp's author is using as a wedge in the wild (issue #225 comment).
- **Notion's near-term investment is reliability + admin governance**, not authoring depth or batching.

## 8. What I'm uncertain about

- **The OAuth scope contradiction.** Help Center says "everything you can access"; developer docs imply a page picker. I lean toward "page picker exists but defaults to broad access, and most users don't narrow it" — but this is inference, not verification. **A 5-minute hands-on OAuth flow capture would settle this.**
- **Synced-block authoring through Enhanced Markdown.** The tags exist. Whether agents can actually create new synced blocks via `<synced_block>` syntax (vs. only preserving them on round-trip) is unverified. This is a flag because easy-notion-mcp's positioning may or may not exploit a real gap here.
- **Whether the 30 req/min search limit is per-user or per-integration.** I didn't find clear documentation. It matters for multi-user agent platforms.
- **`notion-create-pages` true batch capacity.** "One or more" is documented; the practical upper bound and atomicity guarantees are not.

## 9. What I couldn't verify

- **Primary Notion source for the 180 req/min hosted-MCP rate limit.** Multiple secondary sources cite this; no Notion-owned doc I fetched stated it explicitly for the MCP server.
- **Whether paid Notion plans get higher rate limits.** Speculation in some blogs; no Notion confirmation.
- **Live tool-list dump from a connected client.** Would take 2 minutes of hands-on testing and would close several uncertainties (synced blocks, exact tool descriptions, hidden plan-gated tools).

---

## Strategist takeaways (one-liners)

- **Strongest durable gap easy-notion-mcp can lean into:** *Block-level surgical edits and append-after-anchor*. Notion has publicly classified this as out of scope by design, not as a deferred feature. The page-replace-only model is destructive (issue #271 evidence is brutal — block IDs change, deep-links break) and unlikely to change in 6 months without Notion reversing a stated architectural stance. Bookmark blocks, find/replace, and synced-block authoring fit under this umbrella. This is the structural moat.

- **Strongest gap Notion is most likely to close before easy-notion can capitalize:** *File uploads.* Notion has publicly committed it's on the roadmap. Any easy-notion positioning that leans on "we support file uploads, they don't" has a 6-month half-life at best. Build it if it's table stakes, but don't make it the headline differentiator.

- **Bonus durable gap worth flagging:** *OAuth token TTL / API-token-as-fallback for headless agents.* easy-notion's author already knows this — they self-promoted on issue #225. Notion has been silent on this for 7+ weeks and the architecture (centrally hosted OAuth) makes it expensive for them to fix. Cloud-agent / CI / scheduled-job use cases are completely unserved by hosted Notion MCP and will stay that way.

- **The framing trap to avoid:** "Notion-hosted has 18 tools, we have N tools" — that's a feature-count race Notion will win. The real story is *what kind of operations* easy-notion supports (block-level, surgical, append-after-anchor, file upload, headless) versus what Notion supports (page-level replace + read-heavy retrieval).

---

## Constraints / facts the strategist should persist

- Notion has explicitly classified block-level edits as "out of scope by design" — not a deferred feature.
- Hosted MCP is OAuth-only with no API-token fallback and no commitment to add one.
- Token TTL appears to be ~hours to a few days; not user-configurable; no public roadmap commitment to extend.
- File upload is publicly on Notion's MCP roadmap.
- `notion-query-data-sources` requires Enterprise + Notion AI; `notion-query-database-view` requires Business + Notion AI. Free/Plus users get a degraded surface.
- Notion-flavored Markdown's table converter has a confirmed bug (issue #266) and bookmark blocks aren't supported (issue #220).
- The npm `@notionhq/notion-mcp-server` package shares the Enhanced-Markdown surface with the hosted MCP, so issues filed there are valid evidence for hosted-MCP behavior — but the OAuth/transport layer differs.

## Sources

- [Connecting to Notion MCP — Notion Docs](https://developers.notion.com/docs/get-started-with-mcp)
- [Supported tools — Notion Docs](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Notion's hosted MCP server: an inside look — Notion Blog](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [Notion MCP — Notion Help Center](https://www.notion.com/help/notion-mcp)
- [Notion MCP Server: Capabilities, Limitations, and Alternatives — StackOne](https://www.stackone.com/blog/notion-mcp-deep-dive/)
- [Developer changelog — developers.notion.com](https://developers.notion.com/page/changelog)
- [HN: MCP context bloat discussion](https://news.ycombinator.com/item?id=47158526)
- [GitHub issues — makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server/issues) (cited specific issues throughout: #121, #218, #220, #225, #227, #233, #238, #239, #244, #245, #256, #258, #259, #260, #266, #269, #271, #277)
- [Notion MCP Integration Setup & Limitations — Pactify](https://pactify.io/blog/notion-mcp-integration-setup-limitations) *(treated skeptically — some claims appear to conflate internal-integration behavior with hosted MCP)*

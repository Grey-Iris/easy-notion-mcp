# Wave 1 — Comparable Plays: Third-Party MCP Survival After First-Party Launches

**Date:** 2026-04-28
**Question:** When a SaaS vendor ships their own first-party hosted MCP, what happens to third-party MCPs in the same vertical? Do any survive on a niche, and if so, what niche?
**Why this matters:** Strategist needs to know whether "play in the niche first-party doesn't serve" is a real strategy that has worked, or a comforting story. Specifically applied to easy-notion-mcp's decision about whether to build a hosted remote competitor to mcp.notion.com.

---

## TL;DR

- **Third-party MCPs survive when they own a STRUCTURAL niche the first-party can't serve.** The clearest example: sooperset/mcp-atlassian (4.8–5.1k stars, 3.91M PyPI downloads, latest release 2026-04-10) is still ACCELERATING growth 11+ months after Atlassian's official Cloud-only Remote MCP launched, because Atlassian's official explicitly does not support Server/Data Center.
- **Third-party MCPs that lacked a structural niche died fast.** jerhadf/linear-mcp-server (Linear's most-popular community MCP, 344 stars) was DEPRECATED by its own maintainer within weeks of Linear's May 1, 2025 launch — its README now says "use the official." suekou/mcp-notion-server (884 stars) made its final meaningful commit on May 14, 2025, eight days before Notion's hosted launch (May 22, 2025), and has been stagnant since.
- **The niches that worked are STRUCTURAL or IDEOLOGICAL, not "we have better tools."** Server/DC support (Atlassian), self-hosted Sentry support (Sentry), no-admin-approval/stealth-mode (Slack/korotovsky). "Better token efficiency" and "better tool design" did not produce surviving examples.
- **GitHub never had a third-party competition to begin with** — they shipped first-party from public preview (April 4, 2025), so there was no community fork war to lose. Same pattern at Stripe and Sentry, which both shipped hosted + local stdio simultaneously.
- **The direct Notion comparable is gloomy.** suekou/mcp-notion-server is the closest analog to easy-notion-mcp's position, and it stagnated almost exactly when Notion's hosted MCP shipped. Markdown-first positioning is not a structural moat — Notion's own hosted MCP uses Notion-flavored markdown as its core abstraction.

---

## Per-vendor case studies

### Linear (hosted MCP launched 2025-05-01)

- **Official:** `https://mcp.linear.app/mcp` — OAuth 2.1 with dynamic client registration, Cloudflare-hosted, Anthropic partnership. ([Linear changelog](https://linear.app/changelog/2025-05-01-mcp))
- **Top third-party before launch:** `jerhadf/linear-mcp-server` — 344 stars, 54 forks. Maintainer was Linear-affiliated.
- **What happened:** **Deprecated by its own author.** Repository README now reads: *"This MCP Server is now deprecated and is no longer being maintained. I recommend you use the official Linear remote MCP server here."* ([repo](https://github.com/jerhadf/linear-mcp-server))
- **Surviving alternative:** `tacticlaunch/mcp-linear` — 133 stars, 30 forks. README does NOT acknowledge the official MCP. No clear positioning shift. Smaller, lower-visibility, no obvious strategic differentiation.
- **Star history pattern:** jerhadf flat / abandoned. tacticlaunch slow growth without inflection.
- **Outcome:** First-party absorbed the #1 third-party (as the maintainer worked at Linear, this was effectively a planned hand-off). The remaining #2 third-party persists at low volume without meaningful niche differentiation.

### GitHub (public preview 2025-04-04, remote GA 2025-09-04)

- **Official:** `github/github-mcp-server` (29.3k stars, 4.1k forks). Co-developed with Anthropic, rewritten in Go from the reference server. Both local docker stdio AND remote `https://api.githubcopilot.com/mcp/`. ([GitHub blog GA announcement](https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/))
- **Third-party landscape:** Effectively none of substance. The "best of MCP" registries surface complementary tools (per-repo MCPs like `gitmcp.io`) but no community fork competing on tool coverage or quality with the official server.
- **Why no competition:** GitHub shipped first-party from public preview onward. There was no 3-month window where a community alternative could establish dominance.
- **Outcome:** When the first-party is fast and credible from day one, the third-party ecosystem doesn't form. This is the "preempt" pattern.

### Atlassian (hosted Remote MCP launched 2025-05-01, beta; Cloud-only)

- **Official:** Atlassian Remote MCP Server, hosted on Cloudflare, OAuth-authenticated, for **Jira and Confluence Cloud customers only — no Server/Data Center support**. ([Atlassian announcement](https://www.atlassian.com/blog/announcements/remote-mcp-server))
- **Top third-party:** `sooperset/mcp-atlassian` — 4.8–5.1k stars, ~1.1k forks, 560+ commits, 100+ open PRs (active community), 179 open issues. ([repo](https://github.com/sooperset/mcp-atlassian))
- **Distribution metrics:** 3.91M total PyPI downloads. Project released on 2024-12-03. Latest release **v0.21.1 on 2026-04-10** — fully active 11+ months after Atlassian's official launch.
- **Most recent feature additions (post-official-launch):** v0.21.0 (March 2026) added 4 new tools — sprint management, page moves, page diffs, comment replies — plus OAuth proxy support and markdown table rendering. They are STILL ADDING TOOLS in late phase.
- **Explicit positioning:** Compatibility table lists Confluence Server/DC v6.0+ and Jira Server/DC v8.14+. Disclaimer: "Not an official Atlassian product." Personal Access Token auth path documented for self-hosted environments.
- **Star history pattern:** **Accelerating throughout 2025-2026** — steepest growth slope of any third-party reviewed. No plateau visible.
- **Niche fork:** `omkar9854/mcp-atlassian-onpremdc` — fork explicitly for "self-hosted Atlassian Data Center/Server installations" using Personal Access Tokens. Demonstrates the niche is large enough to have its own internal segmentation.
- **Outcome:** **The strongest "third-party survives on a niche" case found.** The niche is structural (Atlassian Cloud != Atlassian Server/DC) and reflects a real customer base — Atlassian still has a massive on-prem footprint that the official Cloud-only Remote MCP cannot serve.

### Cloudflare (remote MCP infra launched 2025-03, own MCP launched 2025-04)

- **Cloudflare's role is structurally unique:** they are the **infrastructure layer**, not just a competitor. They host Atlassian's official MCP, provide the `workers-oauth-provider` library, the `McpAgent` class in the Cloudflare Agents SDK, the `mcp-remote` adapter for stdio clients, and the AI Playground. ([Cloudflare press](https://www.cloudflare.com/en-in/press/press-releases/2025/cloudflare-accelerates-ai-agent-development-remote-mcp/))
- **Their own first-party:** `https://mcp.cloudflare.com/mcp` plus 13 dedicated MCP servers (Workers observability, DNS analytics, container envs, etc.). They use a `search()` + `execute()` Codemode pattern over their 2,500+ API endpoints.
- **Implication for easy-notion-mcp:** If you ship hosted, you'd likely run on Cloudflare Workers. Atlassian did. Several launches mention partnering with Cloudflare. The build-vs-buy economics for hosted MCP are favorable because Cloudflare has commoditized the infra.

### Slack (announced Dreamforce 2025-10, GA 2026-02-17)

- **Official:** Slack MCP server with OAuth, 50+ enterprise partners (Anthropic, Google, OpenAI, Perplexity), 25× growth in MCP tool calls + Real-Time Search since launch. ([Slack docs changelog](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/))
- **Top third-party:** `korotovsky/slack-mcp-server` — 1.6k stars, 303 forks, 30 releases, latest **v1.2.3 on 2026-03-03** (one month after Slack's official GA). 10k+ monthly visitors, 2k+ active users (per repo claims).
- **Explicit positioning:** *"The most powerful MCP Slack Server with no permission requirements, Apps support, GovSlack, DMs, Group DMs and smart history fetch logic."* Stealth-mode deployment "with no permissions and scopes in Workspace" — no Slack admin approval needed.
- **Star history pattern:** Gradual steady acceleration, even after official launch.
- **Outcome:** **Niche survival, ANTI-ENTERPRISE niche.** The official MCP requires standard OAuth/admin approval flows. korotovsky's project intentionally avoids those. By design, the official cannot serve users who don't have or don't want admin approval — that's a structural niche.

### Notion (open source 2025-04-08, hosted 2025-05-22)

- **Official:** `mcp.notion.com/sse`, 13 tools, OAuth 2.1, Streamable HTTP + SSE fallback. Notion-flavored Markdown is the core abstraction — *"Notion came back to Markdown to introduce feature parity with Notion blocks, trialing this approach exclusively in their remote MCP server."* ([Notion engineering blog](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look))
- **Top community third-party:** `suekou/mcp-notion-server` — 884 stars, 171 forks, 82 commits.
- **What happened:** **Final meaningful commit on 2025-05-14**, eight days before Notion's hosted launch on 2025-05-22. Latest release v1.2.4 (May 14, 2025). **No further development since.**
- **Star history:** Moderate early growth, FLATTENED after mid-2025. Curve consistent with abandonment by users gradually moving to the hosted official.
- **Other third-parties:** `n24q02m/better-notion-mcp` — markdown-first, 9 composite tools replacing 28+ endpoint calls, dual transport (stdio + remote HTTP with OAuth 2.1, no token needed). Active. Direct overlap with easy-notion-mcp's positioning.
- **Outcome:** **The closest direct analog to easy-notion-mcp, and the news is bad.** suekou's third-party stagnated almost the moment Notion's hosted launched. The "we use markdown" positioning isn't a moat because Notion's own hosted MCP made markdown a first-class abstraction.

### Sentry (mcp.sentry.dev hosted + npx local stdio)

- **Official strategy: dual-mode from day one.** `https://mcp.sentry.dev/mcp` for cloud Sentry, `npx @sentry/mcp-server` for local stdio mode — *"required for self-hosted Sentry."* ([Sentry docs](https://docs.sentry.io/product/sentry-mcp/))
- **Notable:** Sentry preempted the on-prem niche by shipping the local stdio mode themselves. Same play Atlassian could have made and didn't.
- **Third-party landscape:** A few minor variants (e.g., `ddfourtwo/sentry-selfhosted-mcp`) but they don't show signs of community traction comparable to sooperset/mcp-atlassian.

### Stripe (mcp.stripe.com hosted + @stripe/mcp local)

- **Official:** dual-mode, 25 tools, hosted + npx, OAuth + API keys. Lives in the `stripe/ai` monorepo with `@stripe/agent-toolkit`. AWS Marketplace listing. ([Stripe MCP docs](https://docs.stripe.com/mcp))
- **Outcome:** Same preempt-both-lanes pattern as Sentry. No meaningful community competition.

### Asana (beta May 2025, GA 2026-02-04)

- Official `https://mcp.asana.com/v2/mcp`. Beta-to-GA timeline (~9 months) similar to Linear. Beta server scheduled for shutdown 2026-05-11.
- Community: `cristip73/mcp-server-asana` exists but no evidence of niche-driven growth comparable to mcp-atlassian.

---

## Cross-vendor synthesis

### The single strongest pattern: structural niches survive, "we're better" niches don't

| Third-party | Niche | Survived? | Why |
|---|---|---|---|
| sooperset/mcp-atlassian | Server/Data Center support | **Yes — accelerating** | Official is Cloud-only by design |
| korotovsky/slack-mcp-server | No admin approval / stealth / GovSlack | **Yes — growing** | Official requires admin approval |
| jerhadf/linear-mcp-server | None (parity with API) | **No — deprecated** | Maintainer recommended switching to official |
| suekou/mcp-notion-server | None (parity with API + token efficiency) | **No — stagnant** | Final commit 8 days before official hosted launch |
| tacticlaunch/mcp-linear | None obvious | **Lingering** | Low traffic, no positioning shift |
| github community | N/A | **N/A** | First-party preempted, no third-party formed |

**The pattern is brutal and consistent:** if your third-party niche is "we have better tools" or "we're more efficient" or "we use markdown," you don't survive a hosted first-party launch. If your niche is "the official structurally CANNOT serve our users" (on-prem, no-admin-approval, self-hosted, govt-cloud), you do — and you can keep growing for a year+ after the official ships.

### Time-from-launch decay curve

- **Day 0 to ~30:** First-party launches, captures press cycle, ships to Cursor/Claude/etc. as one-click integration.
- **Day ~30 to ~90:** Third-parties without structural niches see commit cadence drop sharply. jerhadf deprecated within this window. suekou's last meaningful commit was 8 days *before* Notion's hosted GA — the maintainer apparently anticipated obsolescence.
- **Day ~90 to ~180:** Star growth flattens for un-niched third-parties. New users don't bother installing the npm package when one-click OAuth at vendor URL exists.
- **Day ~180+:** Third-parties with a structural niche (sooperset, korotovsky) are ADDING features and growing. Without a niche, dormancy.

### The npm-vs-hosted-remote dynamic

- **Total npm SDK ecosystem:** ~97M monthly downloads across Python and TypeScript SDKs (Zylos research, March 2026).
- **Bridge package signal:** `mcp-remote` (the npm adapter Cursor uses to talk to remote MCPs over stdio) had 437k+ downloads by July 2025. This is the bridge layer between stdio-only clients and remote URLs — large but not the same as direct OAuth-connected hosted-remote installs.
- **Most servers in the wild are still stdio:** Industry consensus (Zylos, Madrona) is that the majority of MCP servers are installed locally via stdio. But the *growth* is in hosted remote.
- **User population overlap is real but offset:** stdio installs skew dev-tooling/power-user. OAuth hosted-remote skews enterprise/SaaS-buyer/non-technical. Same person *can* use both, but the typical install profile differs. Cursor users with `mcp-remote` are the bridge population.

### The OSS-loses-on-distribution comparable

- **Gitea / Forgejo (vs GitHub):** Gitea ranks 2nd in self-hosted Git managers, but GitLab dominates self-hosted enterprise (66% of self-managed Git market). GitHub still has 100M+ developers. Self-hosted Git is a niche, not a leader. The Forgejo fork (late 2024) was driven by ideological / governance concerns, not feature gaps.
- **Postgres / Supabase / Neon / RDS:** Self-hosted Postgres is shrinking as a primary deployment for new projects (Neon claims 80%+ of databases on its platform are AI-agent-provisioned, suggesting fully managed is the new default). Self-host persists for cost-conscious + control-conscious users.
- **General pattern:** "Self-host the open-source thing" works as a **niche category** (compliance, sovereignty, ideology, cost) — not as a leadership position. Most users default to managed when managed is one click.

### What surprised me

- **jerhadf was Linear-affiliated.** The "deprecation" of Linear's most popular community MCP wasn't a community fight — the maintainer apparently led the official product internally, and the deprecation was a planned hand-off. This is actually the *cleanest* version of "first-party absorbs third-party."
- **sooperset/mcp-atlassian's growth is steeper *after* Atlassian's official launch than before.** This is counter-intuitive and the strongest evidence that real structural niches expand the third-party's audience (because the official's existence raises awareness of the category and drives users toward "but for my Server install" searches).
- **Notion's hosted MCP USES NOTION-FLAVORED MARKDOWN.** Notion's engineering blog explicitly calls this out. easy-notion-mcp's "markdown-first" positioning is not differentiation — it's parity with what Notion themselves now ship. This was the most concerning find for the strategist's hypothesis.
- **suekou/mcp-notion-server's last commit was 8 days BEFORE Notion's hosted launch.** The maintainer appears to have known this was coming and disengaged before the official hit.
- **Sentry and Stripe shipped both lanes simultaneously.** Sentry's npx stdio path is explicitly billed as the on-prem solution. They preempted the structural niche that survived for Atlassian. If a vendor ships dual-mode from day one, the niche-survival path is closed.

---

## What this implies for easy-notion-mcp

### The bad news

1. **The direct analog (suekou/mcp-notion-server) stagnated in May 2025.** It didn't try to find a niche. It didn't have one. easy-notion-mcp is in roughly the same position the day Notion's hosted launches, only with a head-of-cycle 11 months later than suekou.

2. **"Markdown-first" is no longer a moat.** Notion's hosted MCP made Notion-flavored markdown its core abstraction. The 92%-fewer-tokens claim only differentiates if Notion's own server is worse — which is plausible but not a structural advantage. Quality-based niches don't survive hosted launches.

3. **No structural Server/DC equivalent for Notion.** Notion is a SaaS-only product. There is no "Notion Server" or "Notion DC" install base looking for an on-prem MCP. The niche that saved sooperset doesn't exist for Notion.

4. **Dual-mode preempts you.** If Notion ships an npx local stdio path alongside their hosted (the Sentry/Stripe pattern), even the "I want local" niche closes. Notion has already shipped a downloadable open-source notion-mcp-server (April 2025), so they're already in this lane.

### The possible niches (ranked by historical evidence)

1. **Anti-admin / no-OAuth / power-user-controlled** (the korotovsky pattern). Some users want token-based local access without going through Notion's OAuth integration permissions. Real but small.
2. **Composite/batch operations the official won't expose** (the better-notion-mcp pattern). Real differentiation if Notion's tool design stays HTTP-call-shaped, but Notion explicitly designed against that ("optimized for AI agents — not HTTP calls to the API"). Likely shrinks over time.
3. **Self-hosted on user's own Worker / VPS for data-residency / compliance.** Plausible but small Notion segment — Notion users overwhelmingly chose Notion *because* they wanted hosted SaaS.
4. **Local-first, never-ping-Notion-hosted-MCP.** Privacy/audit-conscious users. Tiny niche but exists.

None of these match the size or growth slope of sooperset's Server/DC niche.

### What the comparable cases say about timing

- **Window for niche pivoting:** suekou had ~6 weeks of warning between Notion's open-source release (early April 2025) and hosted (May 22, 2025) and didn't pivot. easy-notion-mcp has been operating for 11 months *post-hosted-launch* and is still alive — that's already a positive signal that engaged power-users find it useful.
- **The "build a hosted competitor" play:** Not found in any of the 9 vendor surveys above. No third-party MCP responded to a first-party hosted launch by shipping their own hosted competitor. The infra is available (Cloudflare Workers + workers-oauth-provider), but no one has tried it. This is either (a) an open opportunity, or (b) a tacit signal that the audience for "third-party hosted" is empty (users who want hosted go to mcp.notion.com; users who want self-controlled stay on stdio).

### Most similar comparable case and its outcome

**Most similar to easy-notion-mcp's situation: suekou/mcp-notion-server.** Same vendor (Notion). Similar repo profile (mid-three-digit stars). Markdown-leaning positioning. Third-party prior to Notion's hosted launch.

**Outcome:** Stagnation almost exactly at hosted launch. No pivot to a niche. No surviving distinguishing feature.

The single piece of good news is that easy-notion-mcp is still active 11 months later with a clear differentiated product (TDD, 26 tools, round-trip fidelity, claimed 92% token reduction) — meaning some power-user audience found a reason to stay. The strategist needs to test whether that audience is large enough to sustain the project as a *niche-survivor*, or whether it's the long tail of an obsoleted package.

---

## Sources

- [Linear changelog (2025-05-01)](https://linear.app/changelog/2025-05-01-mcp)
- [jerhadf/linear-mcp-server](https://github.com/jerhadf/linear-mcp-server)
- [tacticlaunch/mcp-linear](https://github.com/tacticlaunch/mcp-linear)
- [GitHub blog — github-mcp-server public preview (2025-04-04)](https://github.blog/changelog/2025-04-04-github-mcp-server-public-preview/)
- [GitHub blog — remote GitHub MCP GA (2025-09-04)](https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/)
- [github/github-mcp-server](https://github.com/github/github-mcp-server)
- [Atlassian announcement — Remote MCP Server](https://www.atlassian.com/blog/announcements/remote-mcp-server)
- [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian)
- [omkar9854/mcp-atlassian-onpremdc](https://github.com/omkar9854/mcp-atlassian-onpremdc) — niche-fork for on-prem
- [Cloudflare press — remote MCP server](https://www.cloudflare.com/en-in/press/press-releases/2025/cloudflare-accelerates-ai-agent-development-remote-mcp/)
- [Cloudflare blog — building remote MCP](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Cloudflare's own MCP servers docs](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- [Slack docs — MCP server announcement (2026-02-17)](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/)
- [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server)
- [Notion engineering — hosted MCP inside look](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server)
- [suekou/mcp-notion-server](https://github.com/suekou/mcp-notion-server)
- [n24q02m/better-notion-mcp](https://github.com/n24q02m/better-notion-mcp)
- [Sentry MCP docs](https://docs.sentry.io/product/sentry-mcp/)
- [Stripe MCP docs](https://docs.stripe.com/mcp)
- [Asana MCP V2 GA (2026-02-04)](https://forum.asana.com/t/new-v2-mcp-server-now-generally-available/1122647)
- [Zylos research — MCP remote evolution (2026-03-08)](https://zylos.ai/research/2026-03-08-mcp-remote-evolution-streamable-http-enterprise-adoption)
- [Madrona — tale of two MCP ecosystems](https://www.madrona.com/what-mcps-rise-really-shows-a-tale-of-two-ecosystems/)
- [pypi.org/project/mcp-atlassian](https://pypi.org/project/mcp-atlassian/) — 3.91M downloads, latest v0.21.1 (2026-04-10)
- [serverspan — 2026 self-hosted Git guide](https://www.serverspan.com/en/blog/the-2026-guide-to-self-hosted-git-gitea-forgejo-and-the-future-of-code-hosting)

## Constraints / rejected approaches captured for future researchers

- **npmjs.com directly blocks WebFetch (HTTP 403).** Use pepy.tech for PyPI download stats; for npm, use npm-stat.com or unpkg routes. Direct npmjs.com package pages are not retrievable via this agent's tooling.
- **Star-history.com static SVG endpoint (`api.star-history.com/svg?...`) returns rendered chart imagery describable by the model.** Useful when historical data points needed for trajectory inference. Direct CSV/JSON endpoint not found in this session.
- **No comparable case was found of a third-party MCP shipping its own hosted-remote competitor after a first-party hosted launch.** Either an open opportunity or a tacit empty-market signal — strategist needs to decide which.
- **The "open source but losing on distribution" comparables (Postgres, Git/Gitea) confirm niche survival is possible but specifically as a *niche category*, not as a leader.** The leader position goes to whoever ships hosted first.

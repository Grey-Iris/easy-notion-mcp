# Wave 1 — Segment evidence: who is actually choosing easy-notion-mcp post-hosted?

**Date:** 2026-04-28
**Question:** Is there a real, identifiable user segment that would still choose easy-notion-mcp (third-party, npm-published, self-hosted) over Notion's hosted MCP at mcp.notion.com? What evidence exists that the segment is real and durable, vs. a comfort hypothesis?

---

## Topline

**A self-hosted Notion-MCP segment exists and is large in absolute terms — Notion's officially-soft-deprecated self-host npm package still pulls 273k downloads/month nine months after the hosted launch. Within that segment, there is real, evidenced demand for token-efficient, block-level, agent-oriented servers; that is the only hypothesis with strong third-party signal. The privacy/compliance hypothesis collapses on inspection. The customization/forks hypothesis is near-empty. The cost-gating hypothesis is real but narrow.**

---

## Baseline facts (verified)

- **Notion-hosted launch:** 2025-07-15 (Ivan Zhao announcement tweet, 998 likes — confirmed v2 OAuth-only hosted MCP). [Source](https://x.com/ivanhzhao/status/1945167473617293429)
- **Hosted MCP shape:** 18 tools, page-level only, no block-level edits, no file uploads, OAuth-only, single Notion-hosted integration. Two power tools (`notion-query-data-sources`, `notion-query-database-view`) are gated behind Enterprise + Notion AI and Business + Notion AI respectively. Rate limit: 180 req/min average; search 30 req/min. [StackOne deep dive](https://www.stackone.com/blog/notion-mcp-deep-dive/) and [Notion-hosted supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools).
- **Official self-host status:** `@notionhq/notion-mcp-server` is **soft-deprecated**. Notion has stated they are "prioritizing, and only providing active support for, Notion MCP (remote)" and "may sunset the local repository." Issues/PRs not actively monitored. [Hosting a local MCP server](https://developers.notion.com/docs/hosting-open-source-mcp).
- **Soft-deprecation has not killed self-host adoption.** npm download volume (last 30 days, fetched 2026-04-28):

  | Package | 30-day downloads | Median daily | Notes |
  |---|---|---|---|
  | `@notionhq/notion-mcp-server` (official self-host, soft-deprecated) | **273,247** | 9,645 | Still the dominant install. The "self-host" segment is enormous. |
  | `notion-mcp-server` (legacy package name) | 15,548 | 487 | Likely cached configs; unclear maintainership. |
  | `@suekou/mcp-notion-server` (third-party, 884★ / 171 forks) | 3,870 | 78 | Pre-existed hosted launch (created 2024-11), still growing. |
  | `easy-notion-mcp` (Grey-Iris, 14★ / 6 forks) | 2,157 | 52 | Created 2026-03-19 — post-hosted-launch by 8 months. |
  | `better-notion-mcp` (n24q02m, 26★ / 10 forks) | not on npm | — | Markdown-first positioning, created 2025-12-06. |

- **Note on "did downloads change after hosted launch?":** Cannot be answered for easy-notion-mcp because it was created in March 2026, eight months *after* the hosted MCP launched. The fact that it exists at all and pulled 933 downloads last week is itself evidence that builders are still entering the space post-hosted-launch.

---

## H1 — Privacy / compliance-sensitive teams: **WEAK / DOES NOT HOLD UP**

### Positive findings
- A "Show HN: Privacy-First MCP Servers for Claude – Linear, Postgres, Notion, GitHub" post from January 2026 explicitly pitched local-only MCP servers for privacy. [HN thread](https://news.ycombinator.com/item?id=46491772). **It got 2 points and zero visible discussion.** That is a near-flat signal.
- MintMCP exists as an enterprise-tier MCP gateway selling "SOC 2 compliance, OAuth 2.0/SSO, fine-grained access controls, audit trails, GDPR right-to-erasure" specifically to Notion users. [MintMCP Notion guide](https://www.mintmcp.com/blog/connect-notion-to-mcp). This is real demand, but it is a *gateway* play (enterprise governance over hosted MCPs), not a self-hosted-third-party play.

### Counter-evidence
- **The privacy logic doesn't actually work.** Notion's hosted MCP is just an internal Notion service holding the user's OAuth token and calling Notion's own API. Self-hosting a third-party server does not isolate the user from Notion — your data still flows through Notion's API on every call. The only thing self-hosting buys you is "no third-party (Notion) middleware between you and Notion's API," which is identity to "no middleware at all" since it's the same vendor.
- The compliance argument that *would* hold — "we don't want our agent's prompts going through a vendor-hosted relay" — is solved by self-hosting *any* MCP, including the official `@notionhq/notion-mcp-server`. It is not specific to easy-notion-mcp or any third-party.
- Zero search results found in r/Notion, r/ClaudeAI, or HN for users explicitly saying "we cannot OAuth to Notion-hosted because of compliance, so we use a third-party self-hosted server." Multiple search angles tried.

### Verdict
H1 is a **comfort hypothesis with no evidence**. The privacy/compliance pitch *sounds* right but doesn't survive the question "what threat does the third-party self-host actually mitigate that the official self-host doesn't?" The answer is: nothing. If a privacy/compliance segment exists, it's choosing the *official* `@notionhq/notion-mcp-server` (273k downloads/month), and the third-party niche within it is not where the privacy argument carries.

---

## H2 — Power users running agent workflows that hit token / context walls: **STRONG, BEST-EVIDENCED**

### Positive findings — independent third-party voices on X complaining about Notion MCP token bloat

- **@miradu, 2026-01-16:** "the notion mcp server is bad. agents get overwhelmed with responses that have way too many tokens and they have to navigate block by block. What I observe is an agent basically has to recreate in markdown the notion file in some tmp directory and only then can they query it." [Tweet](https://x.com/miradu/status/2012209708598284555). This is a verbatim description of the problem easy-notion-mcp's markdown-first design solves.
- **@curious_queue, 2026-01-06:** "the @NotionHQ plugin for claude code has MCP tools that take up 31.3k tokens (15.7% of 200k) of the context window. it has become quite a hassle to enable/disable the MCP tools to save on the context. is there a good skill-only setup for notion<>claude code that is more easy on the context use? would love to have an official setup for this." [Tweet](https://x.com/curious_queue/status/2008612572992315850). Direct, dated, named user with the exact pain.
- **@992rodney, 2025-12-10:** "If you want to interact with notion, you are adding 11 tools to your agent. An extra 20k in tokens every tool call." [Tweet](https://x.com/992rodney/status/1998810117517766698). 17 likes — minor virality.
- **@ryan_castner, 2025-08-26:** "It would be amazing if we could configure MCP server tools to only be injected into Claude Code subagents, that way you could isolate context for heavy mcp servers (10k+ tokens of context) like Playwright or Notion into a subagent and not pollute the main context window." [Tweet](https://x.com/ryan_castner/status/1960391400685461801).
- **@chaseadams, 2025-11-05, 260 likes:** "loading all the definitions upfront burns tokens fast. ... MCP creates context rot." [Tweet](https://x.com/chaseadams/status/1986048303507833254). Generalises beyond Notion but is exactly the failure mode easy-notion-mcp's "92% fewer tokens" pitch addresses.

### Notion's own data corroborates
- StackOne deep dive: "Raw database queries return 55,000+ characters of nested JSON" per call. Their own optimization layer achieves "96% reduction (~500 tokens vs ~13,750 tokens baseline)." [StackOne](https://www.stackone.com/blog/notion-mcp-deep-dive/). This is third-party paid product; the existence of it confirms the pain is monetisable.

### easy-notion-mcp's own users name the same pain
- **@ivalsaraj (Valsaraj R), issue #49 (2026-04-27):** "Currently the MCP adds more weight to the context. if i want to add multiple notion integrations--like read-only access, read and write access, and maybe personal read-only access with multiple API keys--it would be better to have a skill handle for that." [Issue](https://github.com/Grey-Iris/easy-notion-mcp/issues/49). This is exactly @curious_queue's complaint, on easy-notion-mcp's own tracker.
- **@4luap, issues #50/#51/#52 (2026-04-28):** Names a specific use case ("Kit's TikTok scriptwriting workflow ... toggles on a single Scripts page as the primary script container"). Hits the 63KB find_replace timeout on long pages, asks for toggle-as-first-class tools, dry-run mode, match-count returns. **This is a power user with a concrete agent workflow that the hosted page-replace model would not handle at all** (you cannot edit a single toggle on a 63KB page via Notion-hosted's page-level rewrite). [Issue #50](https://github.com/Grey-Iris/easy-notion-mcp/issues/50).

### Notion-hosted explicitly admits this gap
- StackOne quotes: hosted version unsuitable for "agents that run without a user present," "production pipelines needing autonomous workflows," "workflows involving file attachments or data source management." Hosted suits "Claude Desktop, Cursor Agent, personal productivity" — i.e., interactive sessions, not autonomous agent workflows.

### Counter-evidence
- Notion's own "Notion-flavored Markdown / Enhanced Markdown" was explicitly designed to close the token gap (Ivan Zhao's launch tweet). It is plausible that for *page-level* operations the gap has narrowed. We did not find direct token measurements comparing hosted's Enhanced Markdown to easy-notion-mcp on the same page; this is an unverified gap.
- A previous internal token measurement (sourced from project records, March 2026) showed official 6,536 tokens vs. easy-notion-mcp 291 tokens on the same page. Likely against `@notionhq/notion-mcp-server`'s raw JSON, not against hosted's Enhanced Markdown — making the hosted comparison still open.

### Verdict
H2 is the **strongest-evidenced segment**. Multiple independent X users (not associated with easy-notion-mcp) name token bloat as a top-of-mind agent-workflow pain. easy-notion-mcp's own issue tracker shows real users (4luap, ivalsaraj) with workflows the hosted version structurally cannot handle (toggle-anchored edits on long pages, multi-key access for read-only vs read-write personas). The hosted MCP's vendor (StackOne) confirms the gap and sells the same fix.

---

## H3 — Local-first / file-upload power users: **MODERATE, NARROWER THAN H2**

### Positive findings
- **Issue #191 on the official notion-mcp-server**, "Feature Request: Support local file upload for images and files," opened 2026-01-28. Open and unresolved. [Issue](https://github.com/makenotion/notion-mcp-server/issues/191). This is direct evidence that file upload is a wanted feature on the official side too.
- **@tamas__szuromi, 2026-03-16:** "running into a limitation with the Notion MCP. When migrating content between internal pages, screenshots can't be copied because images are only referenced by URL, and the internal S3 URLs are temporary signed links that expire after ~1 hour. Any way to get persistent image URLs or support copying images between pages? This is blocking my agent." [Tweet](https://x.com/tamas__szuromi/status/2033585683370045615). Specific, dated, named user with a blocked agent workflow.
- StackOne deep dive: "There are no file uploads—you can't attach images or files through the MCP server, though Notion says it's on the roadmap."
- shillem (Shillem Volpato), easy-notion-mcp issue #53: actively running in Docker (`oven/bun:latest` container) with HTTP transport. [Issue](https://github.com/Grey-Iris/easy-notion-mcp/issues/53). Local/containerised deployment is being used.
- brettgoodrich, easy-notion-mcp issue #8: trying to connect from **Dify** (alternative LLM platform). Hosted MCP is positioned around Claude/Cursor/ChatGPT; alternative-platform users may need self-host as a default. [Issue](https://github.com/Grey-Iris/easy-notion-mcp/issues/8).

### Counter-evidence
- File-upload is on Notion's hosted roadmap. Once shipped, this hypothesis loses most of its differentiation.
- @tamas__szuromi's specific complaint is about *image migration between pages* — that's not strictly a "local file upload" use case; it's a Notion-API-level limitation (signed S3 URLs) that affects all MCPs equally, third-party included.
- The "stdio + file://" use case is real but the population that drag-drops folders of PDFs into Notion via an agent is small. None of the X searches surfaced viral discussion of this need.

### Verdict
H3 is **real but narrow**. File-upload is wanted (issue #191, tamas__szuromi); local-first deployment is happening (shillem, brettgoodrich). The segment is smaller than H2 and is on a clock — Notion has roadmapped file-upload for the hosted MCP. The *durable* slice within H3 is "users on alternative LLM platforms (Dify, MaxClaw, Open WebUI, custom agents) where Claude/Cursor/ChatGPT-centric hosted-MCP isn't an option."

---

## H4 — Customisation / fork-and-extend users: **NEAR-ZERO EVIDENCE**

### Findings
- All 6 forks of `Grey-Iris/easy-notion-mcp` are **0 commits ahead of main**. None have customised the code. Five are 91-111 commits *behind*. Forks-as-bookmarks, not forks-as-modifications.

  | Fork owner | Ahead | Behind |
  |---|---|---|
  | Commster-AI | 0 | 91 |
  | iflow-mcp | 0 | 91 |
  | party798 | 0 | 111 |
  | manganate006 | 0 | 111 |
  | ivalsaraj | 0 | 111 |
  | taranovegor | 0 | 91 |

- **ivalsaraj forked AND opened issue #49** asking for CLI + skill upstream rather than implementing the customization in their fork. This is the dominant pattern: "ask upstream, don't fork."
- The most-starred third-party server, suekou/mcp-notion-server, has 171 forks and 884 stars. Spot-checked sample of suekou's forks via `gh search` did not surface signs of meaningful divergence either, but full survey not done.

### Counter-evidence
None — there is no positive evidence in either direction beyond "people fork to bookmark."

### Verdict
H4 is **a comfort hypothesis with no evidence**. Open source isn't being used as a customization surface here; it's being used as a trust signal ("I can read the code") and an audit/control surface ("I run my own process"). The actual customisation requests show up as upstream feature requests (issue #49: multi-key auth via CLI+skill), not forks. This means open source matters for the *option* of customisation more than the *exercise* of it — a meaningful but different positioning.

---

## H5 — Cost-sensitive / no-paid-Notion-plan users: **MODERATE; REAL BUT NARROW**

### Positive findings
- **Confirmed plan gating** via Notion docs and StackOne: `notion-query-database-view` requires Business + Notion AI; `notion-query-data-sources` requires Enterprise + Notion AI. Free/Plus users **cannot access these via the hosted MCP at all**. [Notion-hosted supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools).
- **Plan economics shifted against free users:** "The Notion AI add-on, formerly a separate charge on any plan, is now bundled exclusively into Business and Enterprise tiers, with Free and Plus users who did not already have the add-on no longer able to purchase it." [Notion pricing 2026](https://get-alfred.ai/blog/notion-pricing). Business is $24/user/month minimum.
- **Rate-limit asymmetry implied:** mcp.directory blog: "MCP has 3 requests per second per user/connection with caps more likely for Free/Plus, while Notion AI is positioned as unlimited for subscribers." If true, free-plan agent users will hit caps.
- **Self-hosted with an integration token bypasses all of this** — you get the full Notion API on whatever plan you have, including data-source queries Notion's hosted MCP gates behind Enterprise.

### Counter-evidence
- The basic page-CRUD path on Notion-hosted works on free plans. Most users hit Notion-hosted with simple "find this page, edit this page" workflows where the Business/Enterprise-gated tools are irrelevant. The gating affects the power-tier query operations specifically.
- A user who needs `query-data-sources` is by definition someone with serious database structure in Notion — likely already a paid customer. The "free user with complex DBs" segment is small.
- Did not surface a viral X/Reddit thread of "Notion locked their best MCP tools behind Enterprise, I'm self-hosting in protest" — the gating exists but isn't yet a community grievance.

### Verdict
H5 is **real but narrow and overlapping with H2**. Cost-gating is documented. The users it actually liberates are: (a) paid-plan-but-not-Business users who want the data-source-query power, and (b) free/Plus users with any agent at all. The evidence base is policy documentation rather than user voices, which makes it more theoretical than H2's lived complaints.

---

## What segment is real and how big

**The viable segment for easy-notion-mcp is: power users running agent workflows where token-cost-per-call dominates, who need block-level operations or non-Claude/Cursor/ChatGPT clients, and who treat open source as a trust signal.** Concretely, the people in this segment look like:

1. **Multi-page agentic workflows in Claude Code / Codex / Cursor** where MCP tool definitions and response payloads burn 15-30% of the context window before the agent does any work. Real users: @curious_queue, @miradu, @ryan_castner, @chaseadams, @992rodney. (H2)

2. **Workflows that anchor on sub-page units** — a single toggle, a single section, a heading-bounded block range — that the hosted MCP's page-replace model cannot edit without rewriting the entire page. Real user: @4luap (Kit's TikTok scriptwriting). (H2)

3. **Alternative-platform users** — Dify, MaxClaw, Open WebUI, custom agents — where the hosted MCP's Claude/Cursor/ChatGPT-centric OAuth flow is not the path. Real users: brettgoodrich (Dify), shillem (Docker container). (H3)

4. **Multi-tenant / multi-key auth users** — read-only key for one workspace, write key for another, personal vs. work — which Notion's single-OAuth-per-workspace hosted model handles awkwardly. Real user: ivalsaraj (issue #49). (Implied H1, but mechanically rather than for compliance reasons.)

**Sizing:** This segment is tiny in absolute terms today. easy-notion-mcp at 933 weekly downloads is ~1.5% of `@notionhq/notion-mcp-server`'s 64k weekly downloads. suekou at ~1k weekly is similar. Even if you assume third-party Notion MCPs collectively capture ~3% of the self-host segment, that's a few hundred active install bases. **The ceiling is bounded by the size of the self-host segment overall (currently 273k/month and tied to a soft-deprecated package).**

**Durability:** The self-host segment is on a clock — Notion has signaled they may sunset the official self-hosted repo. When that happens, the 273k/month migrates somewhere. The two destinations are: (a) Notion-hosted (for users whose workflows fit the page-level model), or (b) a third-party self-hosted alternative (for users with the H2/H3 needs above). suekou is the incumbent third-party (884★, 4-year history); easy-notion-mcp is a young entrant differentiated by markdown-first / token-efficient positioning, in the same lane as better-notion-mcp. The third-party niche is structurally permanent because the H2/H3 needs are structural; the *brand* contesting it is open.

---

## What was a comfort hypothesis

- **H1 (privacy/compliance):** The argument that "enterprises won't OAuth to Notion-hosted, so they self-host" doesn't cohere. Notion-hosted *is* Notion holding the token. Self-hosting a third-party doesn't isolate from Notion's data plane. The privacy story collapses on inspection. If a compliance segment exists, it's solved by the *official* self-host (or by enterprise gateways like MintMCP), not by a third-party server.
- **H4 (forks/customization):** Open source is being used as a trust signal, not a fork surface. All 6 easy-notion-mcp forks are 0 commits ahead. Customisation requests come in as upstream issues. This means the "people will fork it" pitch is not what makes open source matter here; "people can read it and run it" is.

---

## Surprises

1. **Notion has soft-deprecated `@notionhq/notion-mcp-server` but it still pulls 273k downloads/month nine months in.** This is the strongest single piece of evidence that the self-host segment is durable. Self-hosting habit > Notion's own messaging telling people to migrate.

2. **easy-notion-mcp was created in March 2026 — eight months *after* Notion-hosted launched.** This is the inverse of the framing in the brief, which assumed easy-notion-mcp pre-existed and we're testing whether it survives hosted. The actual question is whether a *new entrant* into the third-party self-host niche makes sense in a post-hosted world. Multiple builders have answered "yes" with their actions: better-notion-mcp (Dec 2025), notion-mcp-fast (Apr 2026), nyosegawa/notion-cli (Apr 2026, 370-like tweet from gyakuse). Builders are still entering.

3. **The strongest user voices for the H2 (token-efficiency) pain are X engineers complaining publicly about Notion MCP, not easy-notion-mcp users telling acquisition stories.** The market is screaming about the problem; easy-notion-mcp has not yet been heard as the answer. The acquisition path "user complains on X about Notion MCP token cost → finds easy-notion-mcp" is theoretically open but unverified.

4. **Notion-hosted is page-level *by design* and will probably stay that way.** From StackOne: "Content editing is out of scope by design, as block-level modifications are more complex, carry a higher risk of unintended changes, and require careful handling in collaborative environments." This is not a feature gap that's about to close. The H2 segment is structurally permanent for as long as Notion holds this design stance.

---

## What I couldn't verify

- **Direct token-cost comparison: easy-notion-mcp vs. Notion-hosted's Enhanced Markdown.** The internal March 2026 measurement (6,536 → 291 tokens) almost certainly compares against `@notionhq/notion-mcp-server`'s raw-JSON output, not against the hosted version's Enhanced Markdown. The hosted version's token efficiency on the *same operation* is unknown to me. This is the single most important measurement that's missing; without it, the H2 differentiation pitch could be against the wrong baseline.
- **Reddit r/Notion and r/ClaudeAI user voices.** Reddit's API is blocked from WebFetch. Search-engine-indexed Reddit results returned nothing on the specific queries. The Reddit channel — which is where most "I switched to X because Y" stories live — was unreachable.
- **Discord / private community sentiment.** No access.
- **HN launch-thread reception of Notion-hosted MCP itself.** Searched for the canonical thread; couldn't locate it. The "Show HN: Open-Source Notion MCP Server (TypeScript, SSE, Apify)" from Dec 2025 and "Show HN: Privacy-First MCP Servers" from Jan 2026 were findable but minor (2 points each).
- **Whether suekou/mcp-notion-server's 171 forks contain meaningful divergence.** Sample-checked, did not full-survey. Likely the same "forks-as-bookmarks" pattern but unverified.
- **What % of the 273k/month `@notionhq/notion-mcp-server` downloads are CI bots vs. human installs.** npm download counts are noisy. The shape of the segment is real but the actual install base is some fraction of the headline number.

---

## Constraints / rejected approaches worth persisting

- **"Privacy" as easy-notion-mcp positioning** does not survive scrutiny. Don't lead with it. If the strategist is considering a privacy/compliance pitch, redirect to "you control the process" rather than "your data is safer" — the latter is false.
- **"Fork it and customise" as easy-notion-mcp positioning** is contradicted by the fork data. Don't lead with "open source so you can extend" — lead with "open source so you can audit and run it."
- **The Notion-hosted MCP is page-level by design and unlikely to change.** Don't plan around the assumption that hosted will close the block-level gap. It won't, per StackOne's quote of Notion's design stance.
- **Notion's Enhanced Markdown closes some of the token gap.** Don't claim "92% fewer tokens" against the hosted MCP without a measurement against Enhanced Markdown specifically. The claim is true against `@notionhq/notion-mcp-server`'s raw JSON; against hosted, it's unverified.

---

## Sources (selected)

- [Notion's hosted MCP: an inside look (Notion blog, 2025-07-15)](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [Ivan Zhao launch tweet (2025-07-15)](https://x.com/ivanhzhao/status/1945167473617293429)
- [StackOne: Notion MCP Server — Capabilities, Limitations, and Alternatives](https://www.stackone.com/blog/notion-mcp-deep-dive/)
- [Notion-hosted supported tools (developers.notion.com)](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Hosting a local MCP server — soft-deprecation language](https://developers.notion.com/docs/hosting-open-source-mcp)
- [Pactify: Notion MCP setup limitations](https://pactify.io/blog/notion-mcp-integration-setup-limitations)
- [makenotion/notion-mcp-server issue #191 — file upload feature request](https://github.com/makenotion/notion-mcp-server/issues/191)
- [makenotion/notion-mcp-server issue #277 — Claude Code OAuth bug](https://github.com/makenotion/notion-mcp-server/issues/277)
- [Grey-Iris/easy-notion-mcp issue #49 — multi-key auth via CLI + skill (ivalsaraj)](https://github.com/Grey-Iris/easy-notion-mcp/issues/49)
- [Grey-Iris/easy-notion-mcp issue #50 — toggle-as-first-class (4luap, Kit's scriptwriting)](https://github.com/Grey-Iris/easy-notion-mcp/issues/50)
- [Grey-Iris/easy-notion-mcp issue #51 — find_replace timeout on 63KB pages](https://github.com/Grey-Iris/easy-notion-mcp/issues/51)
- [Grey-Iris/easy-notion-mcp issue #53 — Docker stdio (shillem)](https://github.com/Grey-Iris/easy-notion-mcp/issues/53)
- [Grey-Iris/easy-notion-mcp issue #8 — Dify integration (brettgoodrich)](https://github.com/Grey-Iris/easy-notion-mcp/issues/8)
- [@miradu on Notion MCP token bloat (2026-01-16)](https://x.com/miradu/status/2012209708598284555)
- [@curious_queue on 31.3k token MCP cost in Claude Code (2026-01-06)](https://x.com/curious_queue/status/2008612572992315850)
- [@992rodney on MCP context bloat (2025-12-10)](https://x.com/992rodney/status/1998810117517766698)
- [@chaseadams on MCP context rot (2025-11-05)](https://x.com/chaseadams/status/1986048303507833254)
- [@ryan_castner on heavy MCP servers polluting context (2025-08-26)](https://x.com/ryan_castner/status/1960391400685461801)
- [@tamas__szuromi on signed-S3-URL image migration block (2026-03-16)](https://x.com/tamas__szuromi/status/2033585683370045615)
- [@gyakuse / nyosegawa: notion-cli wrapper, 370 likes (2026-03-19)](https://x.com/gyakuse/status/2034499204115243341)
- [npm download API: easy-notion-mcp last-month](https://api.npmjs.org/downloads/point/last-month/easy-notion-mcp)
- [npm download API: @notionhq/notion-mcp-server last-month](https://api.npmjs.org/downloads/point/last-month/@notionhq/notion-mcp-server)

# Remote MCP Strategy: Should easy-notion-mcp build a hosted remote server?

**Date:** 2026-04-28
**Author:** Strategy overseer dispatch (orchestrated investigation)
**Question:** Notion's hosted remote MCP at `mcp.notion.com` is established. Should easy-notion-mcp build its own hosted remote to compete, or is there a narrower move that captures most of the upside?
**Status:** Recommendation grounded in wave-1 research + Codex frame and red-team passes. Source notes in `.meta/research/wave1-*-2026-04-28.md`.

## TL;DR

**Don't build a hosted remote.** Distribution doesn't unlock for a third-party hosted Notion MCP (Claude's Connectors Directory is partnership-gated and unbridgeable; the closest comparable, `suekou/mcp-notion-server`, stagnated 8 days *before* Notion's hosted launch).

Instead, **before scoping v0.5, resolve a token re-measurement gate**: re-measure easy-notion-mcp vs `mcp.notion.com`'s Enhanced Markdown on equivalent workflows. The 92% headline number was measured against the npm package being sunset and may not survive against Enhanced Markdown. The result determines whether the v0.5 differentiation story can still lead with context efficiency or must lead with a different structural advantage.

Then ship **one focused v0.5 launch artifact**: a Claude Code plugin / skills bundle for easy-notion-mcp. This addresses the strongest-evidenced user pain (tool-context bloat in agent workflows) on a distribution surface that is *not* Connectors-Directory-locked, and matches the vehicle form-factor Notion themselves chose for `makenotion/claude-code-notion-plugin`. Two cheap supporting moves: a workflow benchmark vs. hosted on context-cost + block-surgical workflows, and sync_block parity post version-bump. Cloud-deploy templates and full README reframe are v0.5.1+, not v0.5. If qualified inbound demand materialises in 3-6 months, revisit hosted. If not, shift to maintain-and-narrow.

## Frame correction

The original framing — "Notion just launched a hosted remote, should we compete" — slightly overstates the news. Notion's hosted MCP launched **2025-07-15** (engineering blog: "Notion's hosted MCP server: an inside look"). What changed in April 2026 was a feature expansion: `notion-create-view` and `notion-update-view` added 2026-03-11, and CIMD support per MCP spec 2025-11-25. The hosted MCP is a ~10-month-old, actively-invested-in product, not a fresh launch.

This matters strategically: **we already have ~10 months of empirical data on what happened to third-party Notion MCPs in the post-hosted landscape.** easy-notion-mcp's current position (14 GitHub stars, ~933 weekly npm downloads, ~1.5% the volume of `@notionhq/notion-mcp-server`) is the post-launch baseline, not a prediction.

## The landscape model

Wave-1 research across 9 vendor verticals (Linear, GitHub, Atlassian, Slack, Stripe, Asana, Cloudflare, Sentry, Notion) produces a clear typology of third-party MCP outcomes after first-party hosted launches. Codex's frame critique sharpened it from a structural-vs-quality binary to four gap types ordered by durability:

| Gap type | Durability | Examples (general) | easy-notion-mcp's overlap |
|---|---|---|---|
| **Topology** (deployment locus the official cannot reach) | Hardest. 12+ months and growing. | `sooperset/mcp-atlassian` on Server/DC; `korotovsky/slack-mcp-server` on no-admin-approval/GovSlack | Limited. Notion has no Server/DC equivalent. |
| **Product-policy** (the official chose not to expose this surface) | Medium. 6-12 month operating thesis. Can reverse if Notion changes architecture. | Block-level edits, batch ops, headless/non-interactive auth | Strong. Page-level-only is *explicitly architectural* per Notion's blog ("higher risk in collaborative environments"); OAuth-only with 30-90min TTL leaves headless agents unserved. |
| **Vehicle / form-factor** (the official ships an MCP URL but not a context-aware install bundle for this surface) | Medium. The plugin/skills format is itself a wedge: it lets a third-party ship lazy-loaded tools, scenario-specific slash commands, and pre-baked prompts that the bare MCP URL can't deliver. Notion shipped `makenotion/claude-code-notion-plugin` here — the same surface is open to us. | Skills/slash-commands bundles, mode-specific tool subsets, lazy tool loading | **Underexploited.** This was the missing fourth niche-type the first draft missed. Strong fit with the most-evidenced user complaint (tool-context bloat). |
| **Quality** (we're faster / more efficient / more complete) | Weak. Dies in 30-90 days. Comparable cases: `jerhadf/linear-mcp-server` deprecated within weeks; `suekou/mcp-notion-server` stagnated 8 days *before* Notion's hosted launch. | Token efficiency, "more block types," GFM markdown vs. Enhanced Markdown | This is easy-notion-mcp's *current* positioning. The headline. |
| **Distribution** (the official isn't in this surface) | Variable. Largely closed for Notion: Claude Connectors Directory is partnership-gated. | None of practical relevance to easy-notion-mcp. | None we can move. |

The model says: **quality-only positioning is the suekou track.** Survival requires occupying a topology, product-policy, or vehicle gap that won't close in the v0.5 → v0.6 window. easy-notion-mcp has product-policy gaps available and a vehicle/form-factor gap available; it does not have Atlassian-Server/DC-grade topology gaps.

Important honesty: product-policy gaps are **a 6-12 month operating thesis, not a permanent category law.** Notion can reverse "page-level only" if pressured. The vehicle gap is the most actionable in v0.5 timeframe because it produces a shippable artifact rather than a positioning shift.

## 1. Concrete tool-use comparison (not feature-list parity)

Workflow-level differences that matter to agents, not marketing-table differences:

**Where Notion-hosted is materially better:**
- **Out-of-the-box for human-in-the-loop interactive use.** One-click OAuth from Claude Desktop's Connectors Directory (Free plan included), Cursor's Notion plugin, Claude Code's `/plugin marketplace`. Zero install friction.
- **Surface ownership.** Notion will move first on new API surfaces (views API tools shipped 2026-03-11 — they had it before we did).
- **Trust signal.** "Use the Notion option" is the path of least resistance for ~90% of users.

**Where easy-notion-mcp is materially better today:**
- **Block-level surgical edits.** `find_replace` preserves the rest of the page; `update_section` targets one heading; planned `update_block` is in-place. Notion-hosted's `update-page` is whole-page-replace and breaks block IDs / deep-links / anchor comments (issue #271 documented 84 workaround calls for a 42-edit page).
- **Headless / non-interactive auth.** API-token mode means CI, cron, scheduled jobs, Docker-deployed agents, and runners with no human at the keyboard work cleanly. Notion-hosted's OAuth-only with ~30-90min token TTL is structurally hostile to these workflows (issue #225 has been open since March 2026, still unresolved). One commenter on that issue self-promoted easy-notion-mcp; James, this is direct market validation that the wedge exists.
- **Batch ops.** `add_database_entries` (multiple rows in one call) and `partial_failure` returns. Notion-hosted is single-row.
- **File uploads from local filesystem.** stdio + `file://` works today. Notion-hosted has it on the roadmap.
- **Free Notion plan, full DB query power.** Notion-hosted's `query-data-sources` and `query-database-view` require Business + Notion AI add-on (and Notion AI is no longer purchasable on Free/Plus per Wave-1 segment research). Self-host bypasses this entirely.
- **Alternative-platform deployments.** Dify, n8n, Open WebUI, Docker — Notion-hosted's OAuth-with-Notion-issued-bearer doesn't compose cleanly with these platforms' MCP-client conventions; easy-notion-mcp HTTP+bearer does (confirmed by issues #8 and #53).

**Where the gap is closing or unclear:**
- **Token efficiency.** Wren measured easy-notion-mcp at ~936 tokens vs official npm at ~11,343 (~92% reduction). **That measurement is against `@notionhq/notion-mcp-server`'s raw JSON, which Notion is sunsetting.** It is *not* against `mcp.notion.com`'s Enhanced Markdown surface. The headline differentiator in our README has a measurement validity problem and needs re-measurement against the hosted surface before it can be claimed as the load-bearing advantage. Honest expectation: easy-notion still wins on tokens (Notion-flavored Markdown carries XML-ish overhead and they ship a lot of tool descriptions), but the margin is likely far smaller than 92%.
- **Block-type breadth (25 vs 16+).** Notion is iterating Enhanced Markdown; expect this to converge.
- **Markdown-first as differentiation.** Notion's hosted now uses Notion-flavored Markdown. "Markdown-first" describes the entire category now, not us specifically.

## 2. Cost of building our own hosted remote

Even though I'm recommending against, naming the cost makes the recommendation honest:

- **Multi-tenant token storage at scale.** Today's `~/.easy-notion-mcp/tokens.json` (AES-256-GCM, single-server file) is fine for self-host; for hosted SaaS, that becomes Postgres+KMS, encryption-at-rest with rotation, audit logs, deletion-on-disconnect SLA.
- **Operations.** Uptime SLO, oncall for OAuth-flow breakage, abuse rate limiting, status page, multi-region or accept latency.
- **Security incident response.** A workspace token leak is a customer's whole company. We need disclosure plan, key rotation, customer notification. Open-source review is good; OSS-with-hosted-SaaS expands the threat surface dramatically.
- **Distribution.** A second OAuth client (`easy-notion-mcp.com`'s Notion OAuth client ID) shares Notion's per-app rate limits. We'd need to negotiate higher limits — and Notion has every incentive *not* to grant them, since it would hurt their hosted offering. Single-tenant rate limiting per workspace might bite hard during agent-orchestration peaks.
- **Maintenance treadmill.** Every Notion API change, every MCP spec change, every OAuth-flow update across MCP clients (Claude Desktop, Cursor, Claude Code, Windsurf, etc.) is now a customer-facing incident, not a release-day chore.

Order of magnitude: a maintainable hosted SaaS isn't 1 weekend. It's the kind of thing that quietly absorbs the project's entire surplus capacity for 3-6 months and then keeps consuming a steady tax. With one part-time maintainer + AI-orchestrated builders, this is the wrong allocation.

## 3. What does building hosted remote actually buy us?

Walk the distribution chain honestly:

- **Claude Desktop Connectors Directory.** Building a hosted URL doesn't get us in. The directory is Anthropic-curated, partnership-gated, no third-party submission path. Free-plan users will continue to see one Notion option (Notion's). **This is the single biggest reason "build hosted" doesn't have a viable distribution story.**
- **Claude Code `/plugin marketplace`.** Notion ships a branded plugin (`makenotion/claude-code-notion-plugin`) that bundles the MCP URL with skills and slash commands. Even if we shipped a hosted URL, we'd be competing as "third-party Notion option" against Notion's own plugin in Notion's own vertical.
- **Cursor MCP marketplace.** Notion engineered the OAuth flow with Cursor specifically. Same dynamic.
- **Public registries (PulseMCP, mcp.so, Glama, mcpservers.org).** Hosted vs. self-host doesn't change registry visibility. Wave-1 distribution research showed ~165× weekly visitor gap on PulseMCP between Notion-official and easy-notion-mcp; a hosted URL doesn't move that ratio.
- **Direct discovery (Reddit, HN, X/Twitter).** A hosted URL might marginally improve "click and try" friction, but research found **zero recent X/HN posts mentioning easy-notion-mcp as the answer** to the token-bloat / hosted-frustration complaints. The acquisition story breaks before the install step.

**Verdict: building hosted remote unlocks roughly 0% of the distribution surfaces it would need to unlock.** We'd be competing on infra cost in someone else's gravity well.

## 4. Narrower moves — evaluated

| Move | Cost | Wedge type | Verdict |
|---|---|---|---|
| **(GATE) Re-measure token claim against Enhanced Markdown** | Low (~1 builder dispatch using existing bench infra) | Trust + accuracy + scoping input | **Required before v0.5 scoping.** README's headline differentiator may have a baseline-validity problem. Margin determines whether v0.5 leads on context efficiency or pivots to a different structural advantage. |
| **(PRIMARY) Ship a Claude Code plugin / skills bundle for easy-notion-mcp** | Medium (~1-2 builder dispatches; format documented by Notion's plugin) | Vehicle / form-factor | **The v0.5 launch artifact.** Addresses the strongest-evidenced segment pain (tool-context bloat — see segment-evidence findings on @curious_queue, ivalsaraj/4luap issues #49-#52) on a distribution surface (Claude Code `/plugin marketplace`) that is *not* Connectors-Directory-locked. Lazy-loadable tools, scenario-specific slash commands, pre-baked prompts. Same vehicle Notion picked, applied to our structural-niche workflows. |
| **(SUPPORTING) Workflow benchmark vs. hosted on context-cost + block-surgical workflows** | Medium (extends Bench A infra; ~1-2 builder dispatches) | Quality + content/distribution | **Yes, paired with PRIMARY.** Provides the evidence the plugin's positioning rests on. Replaces "92% tokens" with measured workflow-success differentials on workflows hosted structurally struggles with. |
| **(SUPPORTING) Ship sync_block via Enhanced Markdown** (after `notion-version-bump-2026-03-11`) | Low (1 builder dispatch post version bump) | Quality (parity) | **Yes, cheap.** Removes a discoverability/comparison gap. Already downstream of a v0.5 must-ship (version bump). |
| **(d) Partner with one cloud for one-click deploy** | Medium (1 partnership conversation, deploy template) | Distribution (narrow) | **v0.5.1+, not v0.5.** Capacity discipline. Memo-self-acknowledged the marginal distribution effect is uncertain. |
| **(a) Trivially self-hostable HTTP server templates** (Railway/Fly/Cloudflare/Docker Compose) | Low (~1 PR for templates + docs) | Distribution + product-policy | **v0.5.1, not v0.5.** Useful but secondary to the plugin/skills artifact. Already filed as `clouddeployable-http-server-make`. |
| **(c) "Lean into the niche we already win" as a README rewrite** | Free | Positioning | **Partial.** Update README header copy minimally during v0.5; don't do the full structural reframe in v0.5. The plugin + benchmark are the artifacts that *demonstrate* the reframe; bigger doc rework is v0.5.1. |
| **(f) Honest "when to use which" doc** | Free (1 README section + blog post) | Trust | **Yes, paired with the v0.5 launch.** One short section, low cost. |
| **(h) Build hosted remote SaaS** | High (months of capacity + ongoing tax) | Tries to compete in distribution; doesn't unlock surfaces; quality wedge dies | **No.** No surviving comparable. Distribution moat is Notion's. Suekou's fate is the warning. |

## 5. Recommendation

**Run a focused structural-wedge bet for v0.5.0, with one primary launch artifact, narrowed primary segment, and three explicit possible outcomes.**

Three outcomes the wedge can produce:

1. **Growth.** The plugin + benchmark drive qualified inbound from agent-orchestration users blocked by hosted's context-cost / block-surgery limits. Continue investing.
2. **Useful niche.** Steady but small adoption from a defined power-user segment. Maintain focused.
3. **No real wedge.** Shift to maintain-and-narrow: keep the package working, stop chasing parity, accept that easy-notion-mcp serves a small group of power users.

Primary segment for v0.5: **agent-orchestration users blocked by tool-context bloat and the inability to do block-surgical edits without breaking pages.** This is the strongest-evidenced segment in wave-1 research (named X engineers complaining about tool context, easy-notion-mcp's own issues #49-#52, hosted's `update-page` documented as destructive). Headless / CI / alt-platform users are *secondary proof points* the plugin can mention — not co-equal segments. Capacity discipline matters.

Concrete v0.5.0 actions, in strict order:

1. **(GATE) Re-measure tokens against `mcp.notion.com` Enhanced Markdown.** Same workflows, same agent prompts. Result determines two things: whether the v0.5 narrative can lead with context efficiency, and how the README's existing 92% claim should be updated (soften, replace, or keep-with-footnote). **Do this before scoping the rest of v0.5.**
2. **Ship the Claude Code plugin / skills bundle.** Lazy-loaded tool subsets (page-mode, db-mode, search-mode), 3-5 useful slash commands (e.g., `/notion-find-replace`, `/notion-sprint-status`, `/notion-batch-import`), pre-baked prompts that route through easy-notion-mcp. The bundle is the v0.5 launch artifact. Notion's plugin is the format reference.
3. **Pair the launch with a workflow benchmark vs. hosted** on context-cost + block-surgical workflows. This is the evidence the plugin's positioning rests on. Use Bench A infra when ready.
4. **Ship sync_block parity via Enhanced Markdown** post `notion-version-bump-2026-03-11`. Cheap, downstream of an existing v0.5 must-ship.
5. **Add a short "when to use Notion-hosted vs. easy-notion-mcp" section to README.** One paragraph. Honest. Routes people who don't need the structural advantages to the official, and clarifies who benefits from us.
6. **Don't pursue Connectors Directory inclusion.** Anthropic won't fragment categories. Don't burn cycles.
7. **Don't build hosted SaaS.**
8. **Defer to v0.5.1+:** cloud-deploy templates (Railway/Cloudflare/Fly/Docker Compose), full README structural rewrite, broader docs reorganization. These are useful but not v0.5 launch-critical, and v0.5 is already carrying PR2 + PR3 + version bump + Bench A + Tier-1 E2E into CI + docs hygiene per the existing roadmap.

## 5.1 Segment-language refinement (post-workflow-measurement)

A workflow-level token measurement subsequent to this memo (`.meta/research/workflow-token-measure-2026-04-28.md`, committed `0c9617e` on a sibling worktree) sharpened the primary-segment articulation. The "tool-context bloat" framing in section 5 doesn't survive empirical scrutiny: on listing budget alone, easy-notion-mcp's tool descriptions are ~6.4× larger than hosted's. What does survive — and is in fact stronger than the original framing claimed — is **edit-heavy session economics**. Break-even sits at 1.1–1.5 workflows; block-surgical edits cost ~98% fewer tokens than hosted's fetch-and-rewrite pattern, batch imports ~82% fewer, multi-page navigation ~17% fewer. We win 3 of 4 measured workflows, and the loss (cold-start listing) flips after the first edit.

Refined segment language for v0.5 messaging:

> Agent users running long, edit-heavy sessions where Notion's page-replace-only model forces destructive fetch-rewrite cycles for every change.

The structural moat is unchanged and durable: Notion's own engineering blog states block-level edits are out of scope by design (collaborative-environment risk). The marketing reframe is small: lead with edit-heavy session economics rather than tool-context bloat. The wedge is the same; the sentence describing who it serves is sharper, and the supporting numbers now point in the right direction rather than against it.

## 6. Strongest counter-argument to my recommendation

**"The plugin/skills bundle is just another quality bet dressed in a vehicle wrapper. Notion ships their own plugin in the same Claude Code marketplace; users who want the official Notion experience get the official plugin. Even if our plugin is technically better at context-aware tool loading or surfaces block-surgical commands hosted can't, we're competing on quality terrain we've already shown loses to first-party — same as the suekou track, just one step deeper into the stack. The honest answer might be 'maintain and narrow now,' skipping the v0.5 wedge bet entirely. Suekou's stagnation is the comparable, and the user signal so far (14 stars, 933 weekly downloads, zero X mentions of easy-notion-mcp as the answer to the token-bloat complaint) is consistent with that fate."**

This is plausible. The defence: the plugin form-factor isn't pure quality competition because Notion's plugin is a thin wrapper around their hosted MCP URL — it inherits hosted's structural limits (page-level only, no block surgery, OAuth-only). A plugin around easy-notion-mcp can offer slash commands and skills that are *impossible* to ship over the hosted MCP, not just better-feeling. That's the structural advantage being expressed in the vehicle, not pure quality.

But the counter is real, and that's why outcome #3 is in the recommendation: maintain-and-narrow is the honest baseline if the wedge bet doesn't produce qualified demand. The 3-6 month disconfirming-test window is short enough to bound the cost.

## 7. Disconfirming test

The single observable that should make me update toward "build hosted remote":

**After v0.5.0 ships with structural-niche positioning and one-click self-host paths, in 3-6 months we receive 10+ qualified inbound from users (3+ from teams/orgs, not hobby curiosity) who:**
- name a real workflow blocked by Notion-hosted's structural gaps,
- cannot use Notion-hosted for that workflow,
- cannot or will not self-host (DevOps gap, organizational policy, etc.),
- would adopt or sponsor only if a hosted easy-notion-mcp URL exists,
- show some willingness to pay or sponsor.

Without that, hosted remote remains a supply-side idea.

A second disconfirming event: **a major MCP distribution surface (Claude Connectors, Cursor Marketplace, Anthropic's `modelcontextprotocol/servers`) opens third-party submissions but requires a hosted-remote OAuth endpoint as a condition of inclusion.** That changes the distribution math meaningfully and is worth re-running this analysis on.

## 8. Confidence and what I'm uncertain about

**Solid (multi-source, primary):**
- Notion-hosted's surface limits (page-level by design, OAuth-only, 18 tools, paid-plan gating on query tools)
- Notion deprioritizing the npm package
- Connectors Directory unbridgeability
- `suekou/mcp-notion-server`'s stagnation arc
- `sooperset/mcp-atlassian` accelerating on a structural niche

**Medium (single-source or inferred):**
- The exact size of the headless / CI / block-surgical user segment in the wild. Issue #225 self-promotion is a strong signal but not proof. Codex's note: don't overweight one issue.
- Notion's roadmap cadence: April 2026 changelog signals reliability + governance investment, not authoring-depth investment, but Notion can pivot.
- The token-efficiency margin against Enhanced Markdown specifically. Wren measured against npm, not hosted. Re-measurement is required before the claim can be load-bearing in v0.5 comms.

**Speculative:**
- Whether a structural-wedge bet's user signal arrives in 3-6 months or 12+ months. Open-source word-of-mouth has long latencies.
- Whether one-click cloud deploy templates would meaningfully expand the headless niche or just make existing self-hosters' lives easier (negligible for distribution).

## 9. Open questions for James

1. **Token re-measurement is the gate. When do we run it?** Options: (a) before any v0.5 scoping decisions (cleanest, ~1 builder dispatch using existing bench infra); (b) in parallel with v0.5 prep with the option to revise the launch narrative if results land badly; (c) skip and just soften the README claim to "substantial token reduction vs. raw-JSON Notion MCPs" with a re-measured-pending footnote. The recommendation assumes (a). If capacity is tight, (b) is workable; (c) leaves a known-fragile claim in the README.

2. **Plugin/skills bundle as the v0.5 launch artifact — confirm the bet.** The recommendation puts a Claude Code plugin / skills bundle as the v0.5 primary launch artifact. This is a new commitment, not a deferred backlog item. It depends on you having ~1-2 builder dispatches of headroom in v0.5 alongside the existing PR2/PR3/version-bump/Bench A scope. If that's not available, the secondary candidate is the workflow benchmark alone (less compelling without the bundle).

3. **Primary segment narrowing.** The recommendation narrows the primary v0.5 segment to "agent-orchestration users blocked by tool-context bloat and block-surgery limits." Headless / CI / alt-platform users become secondary proof points, not co-equal. Confirm you're OK with this narrowing. If you want all three as primary, capacity discipline will be hard.

4. **Maintain-and-narrow as escape hatch.** If 3-6 months post-v0.5 the qualified-demand signal isn't there, are you OK explicitly downgrading easy-notion-mcp's ambition? The recommendation assumes yes. If you'd want to re-evaluate at that point with fresh criteria rather than auto-shift, name the re-evaluation trigger now.

5. **README rewrite scope.** Recommendation says minimal v0.5 README updates (one short "when to use which" section + softening the token claim) with the bigger structural reframe deferred to v0.5.1. If you'd rather do the full reframe in v0.5 to align with the launch, that's defensible but adds capacity load. Your call.

## Source notes

- `.meta/research/wave1-notion-hosted-deep-2026-04-28.md` — tool surface, gaps, rate limits, roadmap signals
- `.meta/research/wave1-distribution-2026-04-28.md` — discovery surfaces and traffic gaps
- `.meta/research/wave1-comparable-plays-2026-04-28.md` — 9-vendor case study
- `.meta/research/wave1-segment-evidence-2026-04-28.md` — H1-H5 hypothesis testing

## Session chain

- Strategy overseer (this session)
- Codex frame consult: `strategy-frame-remote-mcp-2026-04-28` (sessionId `019dd5c2-e213-7590-9162-68c93a10631f`) — frame challenge + post-research synthesis stress-test
- Researchers (parallel, Claude Opus, role: researcher):
  - `wave1-notion-hosted-deep-2026-04-28`
  - `wave1-distribution-2026-04-28`
  - `wave1-comparable-plays-2026-04-28`
  - `wave1-segment-evidence-2026-04-28`
- Red team: `strategy-redteam-remote-mcp-2026-04-28` (Codex, fresh session, sessionId `019dd5d8-b930-7d73-89f7-5bc4573ff535`). Scored **conditional**, surfaced 3 sharp issues. Memo revised in response (see appendix).

## Appendix: Revisions from red team

Red team scored the first draft **conditional** with three sharp issues. All three were material; the memo was revised rather than defended:

1. **Token re-measurement was buried as one of several actions.** The strongest-evidenced segment (token/tool-context bloat) directly depends on whether easy-notion-mcp materially beats Enhanced Markdown, and that measurement doesn't exist. Resolution: token re-measurement is now the explicit gate before v0.5 scoping, not action #1 in a flat list.
2. **The plugin / skills bundle pattern was underweighted.** Distribution research found "the plugin is the install surface, not the URL," and Notion themselves shipped `makenotion/claude-code-notion-plugin` as exactly this. Resolution: added a fourth niche-type ("vehicle / form-factor") to the typology, and made the plugin/skills bundle the v0.5 primary launch artifact. This directly addresses the most-evidenced user complaint (tool-context bloat per @curious_queue, ivalsaraj/4luap issues #49-#52) on a distribution surface that is *not* Connectors-Directory-locked.
3. **v0.5 scope was too broad (5+ strategic items).** Capacity discipline matters with one part-time maintainer + AI-orchestrated builders, and v0.5 already carries PR2 + PR3 + version bump + Bench A + Tier-1 E2E into CI + docs hygiene. Resolution: narrowed v0.5 strategic adds to one primary (plugin / skills bundle), two cheap supporting (workflow benchmark, sync_block parity), and one short README section. Cloud-deploy templates and full README structural reframe explicitly moved to v0.5.1+.

Counter-argument was also revised. The original (combining three niches dilutes effort) became weaker once the recommendation narrowed to one primary segment. The revised counter (the plugin is just quality competition in a vehicle wrapper) is the strongest one I can construct against the revised recommendation, and the defence rests on the plugin's structural-not-quality nature: a plugin around easy-notion-mcp can ship slash commands and skills that hosted MCP cannot deliver because hosted lacks the underlying tools (block-surgery, batch ops, headless mode), not just because we styled them better.

# Remote MCP Strategy: surface architecture after live hosted capture

**Date:** 2026-05-06
**Author:** Strategy overseer dispatch
**Supersedes:** `.meta/research/remote-mcp-strategy-2026-04-28.md`
**Question:** After the 2026-05-01 live capture of `mcp.notion.com` and ivalsaraj's CLI + skill request, should easy-notion-mcp build a hosted remote server, a plugin/skill bundle, a CLI surface, or some narrower combination?
**Status:** Strategy memo only. No code changes.

## TL;DR

**Do not build a hosted remote server.** The evidence still says a third-party hosted Notion MCP would inherit the hardest parts of SaaS operations without unlocking the distribution surfaces that matter. Claude and Notion already own the first-party hosted path; a second hosted URL does not get us into the same trust, OAuth, or marketplace position.

The old strategy memo's token-cost wedge is falsified. Delete it from strategic framing:

- No "92% smaller `find_replace`" claim against hosted. Live capture showed hosted has the same `update_content` primitive inside `notion-update-page`.
- No "6.4x listing-budget" claim. The apples-to-apples measurement is 5,442 local tokens vs. 4,375 hosted tokens, so local is about 1.24x hosted, not 6.4x.
- No "hosted is page-replace-only" claim. Hosted supports update-in-place by substring and full replace. The remaining gap is narrower: hosted lacks our focused ID/heading/local-file/self-host/control surfaces.

The surviving wedge is **surface architecture**, not raw token economy:

- **Full MCP** when the user wants rich, always-available Notion tools in the agent's normal tool list.
- **CLI + lightweight skill** when the user wants low context, explicit invocation, and multiple Notion profiles or integrations without loading a heavy MCP surface.

ivalsaraj's issue #49 is direct market validation of that split. They wrote that the "MCP adds more weight to the context" and that exposing the "`CLI` plus a lightweight skill would work wonders." The important signal is not "please add one feature." It is that a real user wants a different invocation surface because multiple Notion integrations and API keys make one always-on MCP context too heavy.

Recommendation: **keep easy-notion-mcp's core as the full MCP server; open a separate tool-shape / CLI design investigation for the low-context multi-profile surface; defer any detailed CLI design until that investigation.** A Claude Code plugin/skills bundle may still be useful, but not as "lazy-loaded MCP tools." The plugin format lazy-loads skill bodies, not MCP tool descriptions. The CLI + skill path is the cleaner answer to the ivalsaraj problem.

## What changed since 2026-04-28

The 2026-04-28 memo was directionally right to reject hosted remote and to look at plugin/skills as a vehicle. It was wrong about two facts that carried too much strategic weight.

### 1. Hosted has the same content-update primitive

The live hosted capture found `notion-update-page` with command enum values:

- `update_properties`
- `update_content`
- `replace_content`
- `apply_template`
- `update_verification`

`update_content` accepts `content_updates` with `old_str`, `new_str`, and `replace_all_matches?`. That is materially the same search-and-replace primitive our `find_replace` wraps. `replace_content` is also equivalent at the primitive level.

Implication: our `find_replace` can still be a more focused tool, but it is not a moat. Any memo, README, benchmark, or launch copy that compares our `find_replace` to hosted full-page rewrite is invalid.

### 2. Listing cost is comparable, not a big hosted advantage

The tool-description audit retokenized both surfaces with compact JSON:

| Surface | Tools | Listing tokens | Read |
|---|---:|---:|---|
| easy-notion-mcp local | 29 | 5,442 | Larger because it exposes about 2x the tool count |
| `mcp.notion.com` hosted | 14 | 4,375 | More compact overall, but not dramatically |

Local is about **1.24x** hosted on listing budget. That is a normal design tradeoff, not a strategic crisis and not a wedge either direction. The earlier 6.4x framing came from comparing local schemas against a hosted description-only lower bound. It should not be reused.

### 3. Plugin feasibility sharpened the vehicle claim

The April memo leaned on a plugin/skills bundle partly because of context loading. The follow-up plugin feasibility memo corrected that:

- Claude Code skills can lazy-load bodies and supporting files.
- A plugin that enables an MCP server still loads all MCP tool descriptions into the main tool listing.
- Subagents can restrict runtime tools, but they do not erase the initial MCP listing cost.

So a plugin wrapping the full MCP server is not the direct answer to "MCP context is too heavy." It may be useful for workflow packaging, commands, and setup, but the lower-context answer is a separate non-MCP surface: CLI commands described by a lightweight skill.

### 4. ivalsaraj turned the segment into a surface-architecture problem

Issue #49, opened 2026-04-27 by ivalsaraj, says the current MCP is too heavy when the user wants multiple Notion integrations such as read-only access, read/write access, and personal read-only access with multiple API keys. The proposed solution is to expose the CLI plus a lightweight skill.

This matters because the requested shape is not "make the MCP smaller." It is "let me choose a lower-context invocation surface for profile-heavy workflows." That is a different architecture:

- Full MCP is good when all Notion tools should be ambient and model-discoverable.
- CLI + skill is good when the agent should read a small command contract and call explicit commands only when needed.
- Multi-profile auth belongs naturally in a CLI/config surface, where profile names and env vars can be explicit, rather than in a single always-on MCP tool surface.

## Updated landscape model

The durable question is not "hosted vs. local." It is **which surface should carry which job**.

| Surface | Best for | Strength | Weakness | Strategic role |
|---|---|---|---|---|
| Notion hosted remote MCP | Mainstream interactive users in Claude/Cursor/first-party clients | Official OAuth, trust, one-click-ish setup, active API coverage | Not user-controlled, HTTP/OAuth only, official product-policy limits | Default recommendation for users who just want Notion connected |
| easy-notion full MCP | Power users who want rich local/stdout/HTTP Notion tooling always available | Granular tools, stdio + HTTP, API-token mode, filesystem access, OSS audit/control | More tools in context, install/auth friction, not official | Core product and power-user surface |
| easy-notion CLI + lightweight skill | Multi-profile, low-context, explicit Notion workflows | Tiny skill context, profile names, scriptable commands, good for multiple API keys | Requires designing a CLI contract; less model-discoverable than MCP | New investigation target; likely the cleanest response to issue #49 |
| easy-notion hosted remote | Users who want our semantics without self-hosting | Lower install friction if we operated it well | High ops/security burden, no first-party distribution, weak trust vs. Notion | Do not build unless disconfirming evidence appears |

The old "quality gap" taxonomy still helps, but the emphasis changes:

- **Topology/control gap:** stdio, local filesystem, API-token mode, Docker, alternative clients, and self-hosted execution remain real.
- **Product-policy gap:** hosted lacks our focused `update_block`, `update_section`, and `append_content` surfaces, plus local `file://` handling. This is a real but narrower gap than the April memo claimed.
- **Vehicle/surface gap:** strongest current wedge. Full MCP and CLI + skill solve different context and profile problems.
- **Quality/token gap:** no longer load-bearing. Use benchmarks only for narrow, current, live-validated claims.
- **Distribution gap:** still mostly closed. Hosted remote does not make us first-party.

## Honest comparison: hosted strengths and our strengths

### Hosted MCP is genuinely strong at

- **Official distribution and trust.** Most users will choose "the Notion one" when it works.
- **OAuth setup for interactive clients.** Users do not need to create an internal integration token.
- **New Notion surface coverage.** Hosted already has view creation/update, richer search, team tools, form/chart/view DSL capabilities, and MCP resources for specs.
- **Large consolidated tools.** Their 14-tool surface is compact for its breadth. `notion-update-page` packs several commands into one tool.
- **Workspace search beyond Notion pages.** Hosted `notion-search` can reach connected sources such as Slack, Google Drive, GitHub, Jira, Teams, SharePoint, OneDrive, and Linear.
- **Plugin precedent.** Notion's Claude Code plugin is a serious workflow artifact with commands, skills, references, examples, and evaluations.

### easy-notion-mcp is genuinely strong at

- **Focused authoring tools.** `update_block`, `update_section`, `append_content`, and `find_replace` are explicit tools with focused schemas. Hosted can do some equivalent operations, but not all with the same target shape.
- **Block-ID and heading-targeted workflows.** `update_block` by ID and `update_section` by heading remain meaningful ergonomics for agents that should not search for unique substrings.
- **Local filesystem access.** `create_page_from_file` and `file://` handling are transport-dependent strengths hosted does not have.
- **Stdio and HTTP dual transport.** Hosted is HTTP-only. Local stdio remains the normal MCP path for many developer-agent setups.
- **API-token and self-hosted control.** Users can run with internal integrations, containers, CI, cron, custom clients, and alternative agent platforms.
- **Granular surface as a design asset.** 29 tools cost more than 14, but the distribution is healthy: many small utility tools, no 1,000-token local outlier, and several focused authoring tools that are easier for agents to route to.

### easy-notion-mcp is weak at

- **First-install friction.** Creating a Notion integration and copying a token loses to official OAuth for mainstream users.
- **First-party API breadth.** Hosted has views, connected search, teams, form/chart configuration, and SQL-like schema operations that we do not.
- **Always-on context for multi-profile setups.** Enabling several MCP configs for read-only, read/write, and personal profiles scales poorly.
- **Marketplace gravity.** A hosted URL from us would not become the official Notion option in Claude, Cursor, or Notion-controlled channels.

## Strategic recommendation

### 1. Keep rejecting hosted remote

The recommendation against hosted remote still holds, and the new evidence makes it cleaner:

- Hosted's product is better than the April memo assumed.
- The token-cost case for "we can beat hosted by being smaller" is gone.
- The distribution case is still bad: building a hosted URL does not unlock Claude Connectors, Cursor trust, or Notion's official plugin position.
- The cost remains high: OAuth app operations, token storage, KMS, deletion guarantees, abuse controls, rate-limit management, uptime, incident response, and user support.

Hosted remote should remain off the roadmap unless a disconfirming event changes the distribution or demand math.

### 2. Treat CLI + skill as a new surface investigation, not a quick feature graft

Open a dedicated investigation for **tool shape / CLI design**. It should answer:

- What minimal CLI command set covers the low-context jobs without reimplementing the whole MCP server?
- How should profiles work for read-only, read/write, personal, team, and CI contexts?
- Which operations should be command-shaped, and which should remain MCP-only?
- What should the skill body expose so an agent can use the CLI safely without loading the full MCP tool list?
- Can the CLI reuse existing server internals cleanly without turning into a second product with divergent behavior?
- What tests are needed so CLI, MCP, and docs do not drift?

Do not embed detailed CLI design in this strategy memo. The strategic decision is to investigate the surface because the market signal is real. The implementation shape needs its own design work.

### 3. Reframe the plugin/skills idea

A Claude Code plugin may still be worth building, but not under the old premise that it lazy-loads MCP tools. Its valid roles are:

- setup packaging for the MCP server,
- slash commands for common workflows,
- skills that teach safe Notion authoring patterns,
- subagents that restrict runtime tool access,
- references/examples/evaluations that help Claude use the tools well.

If the target problem is "too much MCP context, especially with multiple Notion integrations," the plugin wrapper is secondary. CLI + skill is the direct fit.

### 4. Keep the full MCP focused on rich agent workflows

The full MCP remains the core product. The right optimization is not to contort it into every surface. Keep improving it where full MCP is the correct shape:

- correctness and silent-data-loss fixes,
- focused editing helpers,
- file/local workflow support,
- resource extraction and description tightening,
- view/tool coverage gaps where user demand and Notion API support justify it,
- tests for behavior that public claims depend on.

## v0.7-ish strategic sequence

This is not an implementation plan, but it gives ordering discipline:

1. **Public narrative cleanup:** remove falsified token claims from downstream copy and replace with surface-architecture language.
2. **Tool-description tightening:** pursue targeted compression and MCP Resources if James accepts the audit recommendation. This is design hygiene, not the strategic wedge.
3. **Tool-shape / CLI design investigation:** scope the CLI + skill surface from issue #49 and related segment evidence.
4. **Decide plugin role after CLI investigation:** plugin may package the full MCP, the CLI skill, or both, but should not be the default answer before the lower-context surface is understood.
5. **Continue core MCP correctness and coverage:** especially where hosted's strengths expose real gaps, such as views and richer database UX.

## Disconfirming tests

The strongest event that would make hosted remote worth revisiting is unchanged:

In the next 3-6 months, after the project offers clear self-host and low-context options, we receive 10+ qualified inbound requests, including 3+ teams or organizations, from users who:

- have workflows blocked by Notion hosted,
- cannot or will not run local/self-hosted/CLI options,
- specifically need a third-party hosted easy-notion URL,
- show willingness to pay, sponsor, or adopt at team scale.

A second disconfirming event: a major MCP distribution surface opens third-party submissions but requires a hosted OAuth endpoint for inclusion. That would change the distribution math and deserves a fresh strategy pass.

Without those events, hosted remote remains a supply-side idea.

## Strongest counterargument

The CLI + skill path could become a distraction. It risks splitting attention across MCP, CLI, plugin, docs, and tests before the full MCP has finished the correctness and coverage work already on the roadmap. It also lacks the discoverability of MCP tools: a model cannot call a CLI command it does not know exists, and a skill body has to be authored carefully enough that command usage is safe.

That counterargument is real. The answer is not to build the CLI immediately. The answer is to run a bounded design investigation, because issue #49 is a precise signal about surface mismatch. If the investigation finds the CLI would duplicate too much logic or create too much drift, the project can instead pursue a smaller profile flag or documentation pattern. But the question should be asked at the surface-architecture level, not buried as a one-off "add a CLI" feature.

## Confidence

**High confidence:**

- The old token-cost wedge is falsified and should not be reused.
- Hosted remote is still the wrong allocation for this project.
- Hosted has real product strengths that should be acknowledged rather than minimized.
- The plugin format alone does not solve always-on MCP context cost.

**Medium confidence:**

- CLI + skill is the right next surface to investigate for multi-profile, low-context workflows.
- `update_block`, `update_section`, `append_content`, local files, stdio, and self-host control are enough to sustain a power-user niche.
- Tool-description resources and tightening can improve design quality without becoming a strategic moat.

**Lower confidence:**

- How large the CLI + skill user segment is beyond ivalsaraj and adjacent public context-bloat complaints.
- Whether Claude Code plugin marketplace dynamics will reward a third-party Notion plugin next to Notion's official plugin.
- Whether a small CLI can stay aligned with MCP behavior without meaningful maintenance drag.

## Open questions for James

1. Should `refresh-strategy-memo-post-2026-05-01-findings` spawn a separate task for "tool-shape / CLI design investigation," or should it be folded into an existing plugin/skills task?
2. Is the desired CLI surface primarily for Claude Code skills, for human terminal use, or both? The answer changes command design and output contracts.
3. Should multi-profile support be a CLI-first concept, an MCP profile flag, or a shared config layer used by both?
4. How much roadmap capacity can this take before it threatens correctness/test work already queued?

## Sources

- `.meta/handoffs/2026-05-01-close.md`
- `.meta/research/remote-mcp-strategy-2026-04-28.md`
- `.meta/research/hosted-mcp-live-capture-2026-05-01.md`
- `.meta/audits/tool-descriptions-audit-2026-05-01.md`
- `.meta/research/claude-code-plugin-feasibility-2026-04-28.md`
- `.meta/research/wave1-segment-evidence-2026-04-28.md`
- `.meta/roadmap-2026-04-23.md`
- Tasuku decision `strategic-narrative-rebuild-post-falsified-claims`
- GitHub issue #49, ivalsaraj, "Add cli + skill to avoid context bloat of mcp": `https://github.com/Grey-Iris/easy-notion-mcp/issues/49`

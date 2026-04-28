# Claude Code plugin feasibility for easy-notion-mcp

**Date:** 2026-04-28
**Status:** Read-only research. Pattern-7 exploration of unfamiliar territory.
**Question:** Can we ship a credible Claude Code plugin / skills bundle as the v0.5 primary launch artifact? What's it cost, and what's the realistic shape?

## TL;DR

Yes, the plugin format fits us. The strategy memo's structural intuition is right: Claude Code plugins let a third party bundle MCP server + skills + slash commands + subagents, the format is documented and stable, and Notion themselves shipped one in this exact shape (`makenotion/claude-code-notion-plugin`). One important correction to the memo's framing: **the plugin format does not natively support per-skill lazy-loading of MCP tool descriptions.** The "page-mode subset / db-mode subset / search-mode subset" framing is achievable via subagents-with-tool-restrictions (real lazy loading at task execution), but the main session still pays the listing cost for all 28 tools when the plugin is enabled. To genuinely cut the listing budget, easy-notion-mcp itself needs an opt-in profile flag.

The memo's "1-2 builder dispatches" effort estimate is too low. Notion's plugin ships ~70 files of skill content (4 SKILLs, each with reference/, examples/, evaluations/). Matching that quality bar is **3-5 dispatches** for a credible v0.5 launch artifact, depending on skill depth and whether we add a server-side profile flag.

## 1. Plugin structure, established by docs

A Claude Code plugin is a directory tree, the manifest at `.claude-plugin/plugin.json`, and components at the plugin root:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json              # required: name, optional version/description/author/...
├── skills/<name>/SKILL.md       # YAML frontmatter + markdown body
├── commands/*.md                # flat-file slash commands (legacy form of skills)
├── agents/<name>.md             # subagents with tool restrictions
├── hooks/hooks.json             # event handlers
├── .mcp.json                    # MCP server configs (stdio, HTTP, or SSE)
├── monitors/monitors.json       # background watchers
├── bin/                         # executables added to Bash $PATH
└── settings.json                # default settings on enable
```

**Manifest** is just metadata + optional component-path overrides. Only `name` is required:

```json
{
  "name": "easy-notion",
  "version": "0.5.0",
  "description": "Block-surgical Notion editing for agent workflows",
  "author": { "name": "James Wigg" },
  "repository": "https://github.com/Grey-Iris/easy-notion-mcp",
  "license": "MIT"
}
```

**Skill frontmatter** supports: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation` (turns model-auto-invoke off; user-only slash command), `user-invocable` (hides from `/` menu), `allowed-tools` (skip permission prompts for listed tools), `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths` (glob-restrict when skill activates), `shell`. Description budget is 1,536 chars per skill, total skill listing 1% of context window or 8,000 chars fallback.

**Lazy-loading semantics, important and subtle:**
- Skill *descriptions* are always in the model's context (truncated to 1,536 chars each).
- Skill *body* loads only when the skill is invoked, then stays for the rest of the session.
- Supporting files (reference.md, examples.md) load only when Claude reads them per the skill's instructions.
- **MCP tools listed in `.mcp.json` start when the plugin is enabled and ALL their tool descriptions are added to Claude's tool listing.** There is no per-skill or per-context filter that hides MCP tools from the listing.

**Subagents** (`agents/<name>.md`) support `tools` and `disallowedTools` fields. A skill with `context: fork, agent: page-editor` runs in a forked subagent context with that subagent's tool restrictions applied. This *is* lazy in the runtime sense (the subagent's tools only matter when it's spawned), but doesn't reduce main-thread listing.

**Install flow from a user's perspective:**
1. `/plugin marketplace add Grey-Iris/easy-notion-mcp` (or whatever repo hosts the marketplace.json)
2. `/plugin install easy-notion@<marketplace-name>`
3. If the plugin defines `userConfig`, Claude Code prompts at enable time (ours would prompt for `notion_token` with `sensitive: true`, optionally `notion_root_page_id`).
4. Restart Claude Code so the MCP server starts.

CLI alternative: `claude plugin install ...`. Local dev: `claude --plugin-dir ./easy-notion-plugin`.

**Marketplace submission:** docs say submit via [claude.ai/settings/plugins/submit](https://claude.ai/settings/plugins/submit) or [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit). Beyond that, **the docs don't say** what the approval gate is, what reviewers check, or the SLA. We can't claim "any plugin can list" until we test the form.

## 2. What `makenotion/claude-code-notion-plugin` actually ships

I read the repo. Verbatim contents:

**Marketplace** (`.claude-plugin/marketplace.json`): one entry, `notion-workspace-plugin`, source = github repo, owner = "Notion Labs, Inc.", description = "One-click install for Notion Skills + Notion MCP server."

**Manifest** (`.claude-plugin/plugin.json`):
```json
{ "name": "Notion", "version": "0.1.0",
  "description": "Notion Skills + Notion MCP server packaged as a Claude Code plugin.",
  "author": { "name": "Notion Labs", "url": "https://www.notion.so" },
  "repository": "https://github.com/makenotion/claude-code-notion-plugin",
  "license": "MIT" }
```

**MCP config** (`.mcp.json`):
```json
{ "mcpServers": { "notion": { "type": "http", "url": "https://mcp.notion.com/mcp" } } }
```
That's it. The plugin is a thin wrapper: HTTP transport pointing at their hosted MCP. No server bundled, no auth handling beyond what hosted MCP provides (OAuth via Claude Code's MCP client).

**Slash commands** (10 total):
- `/Notion:search` — workspace search; ~20 lines, instructs Claude to use search + return scannable summary.
- `/Notion:find` — title-fuzzy search.
- `/Notion:create-page` — create page under a parent.
- `/Notion:create-database-row` — insert row.
- `/Notion:create-task` — opinionated task creation; resolves a "Tasks-style database" by name.
- `/Notion:database-query` — query by name + filters; rejects raw-JSON dumps.
- `/Notion:tasks:setup` — set up a Notion task board.
- `/Notion:tasks:build <url>` — build code from a Notion task page.
- `/Notion:tasks:plan <url>` — plan a task; sophisticated agent-orchestration loop with status updates and user comment polling.
- `/Notion:tasks:explain-diff` — generate a Notion doc explaining code changes.

The `tasks:*` commands are the most ambitious. `tasks:plan` is ~50 lines of carefully-designed prompt engineering: status-field updates as the agent works, a "Communication Protocol" using Notion comments for back-and-forth, polling pattern via subagent. This is real workflow design, not toy demos.

**Skills** (4): `notion-knowledge-capture`, `notion-meeting-intelligence`, `notion-research-documentation`, `notion-spec-to-implementation`. Each is a directory with:
- `SKILL.md` (~150-300 lines)
- `examples/` (3-4 example markdown files, each 50-150 lines)
- `reference/` (5-10 reference markdown files defining database schemas, templates, format guides)
- `evaluations/` (JSON files defining test scenarios — Notion is running their own eval suite against these skills)

So the quality bar is high: 60-90 files of carefully-curated content across the 4 skills. This isn't "ship a 100-line SKILL.md and call it a day."

**What the plugin adds beyond a bare hosted MCP URL:**
- Slash commands give users named verbs (faster than typing "search Notion for X")
- Skills give Claude opinionated playbooks for workspace-conscious behaviors (where to file knowledge, how to capture meetings, how to structure research)
- Pre-baked prompts for agent-orchestration flows (status updates via comments, polling)
- Templates and database schema references that Claude can lazy-load from `reference/`

What it does NOT add:
- Tool subsets / lazy-loading of MCP tools (impossible by format)
- Auth handling beyond what hosted MCP provides
- Custom agents (`agents/` dir is empty)
- Hooks (no `hooks/` dir)

## 3. What an easy-notion-mcp Claude Code plugin should look like

### `.mcp.json` — bundled stdio server

```json
{
  "mcpServers": {
    "easy-notion": {
      "command": "npx",
      "args": ["-y", "easy-notion-mcp@^0.5"],
      "env": {
        "NOTION_TOKEN": "${user_config.notion_token}",
        "NOTION_ROOT_PAGE_ID": "${user_config.notion_root_page_id}"
      }
    }
  }
}
```

`userConfig` in `plugin.json` prompts the user at install time for `notion_token` (with `sensitive: true`, stored in keychain) and optional `notion_root_page_id`. This is the structural difference vs. Notion's plugin: ours uses stdio + npx (works offline-after-cache, doesn't depend on us hosting anything), and uses Notion integration tokens (works in CI/cron/headless — the wedge segment).

### Recommended slash commands (final list, 4)

Naming convention: `/easy-notion:<verb>`. Plugin name "easy-notion" gives a clean, short namespace.

1. **`/easy-notion:find-replace`** — direct invocation of the `find_replace` MCP tool. Demonstrates block-surgical edits. *Rationale:* this is the structural advantage hosted's `update-page` cannot match (issue #271 documents 84 hosted calls for 42 edits; ours is one call per edit, preserving block IDs and deep-links). Args: `<page-url-or-id> "<find>" "<replace>" [--all]`.

2. **`/easy-notion:update-section`** — direct invocation of `update_section`. *Rationale:* the second block-surgical advantage. Hosted forces whole-page replace; we target one heading. Args: `<page-url> "<heading>" <markdown>`.

3. **`/easy-notion:batch-import`** — uses `add_database_entries` with partial-failure tolerance. *Rationale:* the batch-ops differentiator. Demonstrates importing CSV/JSON into a Notion database without one-by-one round trips and without aborting on the first bad row. Args: `<db-name-or-id> <source-file>` plus optional column-mapping.

4. **`/easy-notion:sprint-status`** — agent-orchestration demo. Queries a sprint database, reads task pages, generates a status summary, updates a "Sprint Status" page using `update_section` instead of overwriting. *Rationale:* this is the v0.5 primary segment hero workflow — agent that uses block-surgical edits + db ops + DOES NOT BREAK existing block IDs in the status page. Args: `<sprint-db-url-or-name>`.

(Considered and dropped: `/easy-notion:headless-setup` — better as a skill, not a slash command. `/easy-notion:pr-to-doc` — feels like a stretch demo without a real validated user flow behind it.)

### Recommended skills (final list, 3)

1. **`block-surgical-editing`** (model-invokable, default behavior)
   - When to use `find_replace` vs. `update_section` vs. `append_content` vs. `replace_content`
   - Failure modes: `replace_content` and `update_section` are destructive with no rollback; recommend `duplicate_page` first for irreplaceable content
   - The `read_page` warnings contract (e.g., omitted_block_types — don't round-trip through `replace_content` if warnings are present)
   - Body + reference/ files for each editing pattern. Examples/ showing before/after diff thinking.

2. **`headless-and-scheduled`** (`disable-model-invocation: true`, user-only)
   - Walkthrough for getting a Notion integration token (link + 60-second steps)
   - Docker / CI / cron usage patterns
   - Token-rotation strategy
   - Contrast with Notion-hosted's 30-90min OAuth TTL (not a swipe — useful framing for the user choosing an option)
   - This is the secondary-proof-point skill the memo identifies; not the v0.5 hero, but cheap to ship and disambiguates "which Notion plugin is this for?"

3. **`agent-orchestration-with-notion`** (model-invokable)
   - Patterns for long-running agent flows that use Notion as a status + artifact destination
   - "Update the Status section instead of replacing the whole page" (uses `update_section`)
   - "Log batches of activity with `add_database_entries`, not one row at a time"
   - "Use comments for human-in-the-loop checkpoints" (uses `add_comment`, `list_comments`, polling pattern from Notion's `tasks:plan` reference)
   - Reference files for each pattern. Examples for two end-to-end flows: long migration (lots of DB ops + status updates) and code-review-to-doc (PR → page).

These three map to the strongest evidence in wave-1 segment research: block-surgical edits for the primary segment, headless for the secondary proof point, and agent orchestration as the framing that ties them together.

### Context-aware tool loading: the honest answer

The strategy memo's "page-mode subset, db-mode subset, search-mode subset" cannot be done in pure plugin format. Two routes to approximate it, neither free:

**Route A: subagents with tool restrictions** (no server change). Ship 3-4 plugin agents:
```yaml
# agents/page-editor.md
---
name: page-editor
description: Edit Notion page content surgically
model: sonnet
tools: easy-notion:read_page, easy-notion:append_content, easy-notion:update_section, easy-notion:find_replace, easy-notion:replace_content, easy-notion:duplicate_page
---
You are an expert at editing Notion pages without breaking block IDs...
```
Skills with `context: fork, agent: page-editor` run in a forked subagent that only has those 6 tools. Reduces *runtime* tool budget paid by the editing task. But: main session still loads all 28 tool descriptions when the plugin is enabled.

**Route B: server-side profile flag**. Add `NOTION_MCP_PROFILE=full|page-edit|db-only|search-only` env var to easy-notion-mcp. Filter `tools` array at startup based on profile. Plugin's `userConfig` lets the user choose at install. ~50-100 lines of server code + tests. Cleanly reduces baseline tool listing budget. Cost: ships a new server feature, slightly couples plugin design to server release cadence.

**Recommendation:** Ship A in v0.5 (zero server change, demonstrates the pattern), defer B to v0.5.1 unless the actual measured tool-listing budget is the bottleneck against Enhanced Markdown. The memo's gate (re-measure tokens vs. mcp.notion.com) determines this — if the listing budget difference between us and them is small, B is overkill; if it's big, B becomes load-bearing.

## 4. What's required to ship

Files in the plugin bundle:
- `.claude-plugin/plugin.json` — manifest with userConfig for token + root_page_id
- `.claude-plugin/marketplace.json` — marketplace entry pointing at the same repo (we host marketplace + plugin in `Grey-Iris/easy-notion-mcp` itself, in a `claude-code-plugin/` subdirectory)
- `.mcp.json` — single mcpServers entry with `npx easy-notion-mcp@^0.5`
- `commands/find-replace.md`, `commands/update-section.md`, `commands/batch-import.md`, `commands/sprint-status.md`
- `skills/block-surgical-editing/` — SKILL.md + reference/ + examples/
- `skills/headless-and-scheduled/` — SKILL.md + setup checklist
- `skills/agent-orchestration-with-notion/` — SKILL.md + reference/ + examples/
- `agents/page-editor.md`, `agents/db-manager.md`, `agents/search-explorer.md` (route A)
- `README.md` — install + quick-start + token-getting walkthrough
- `LICENSE`

Hosting: the npm package already exists. Plugin references `npx easy-notion-mcp@^0.5`. No new infrastructure. Marketplace lives in the same git repo. Users discover via `/plugin marketplace add Grey-Iris/easy-notion-mcp`.

Approval: docs don't disclose the approval gate. Risk: form might require disclosures we haven't planned for, or there might be a queue. Mitigation: file early, marketplace-add-by-URL works regardless of the official directory.

Version pinning: pin the npx invocation to `^0.5` so plugin updates don't accidentally pull in breaking changes. Tag the plugin's `version` field manually so users only get plugin updates when we cut them (avoids commit-SHA-as-version churn).

## 5. Realistic effort estimate

**The memo's "1-2 builder dispatches" is too low.** Grading the parts:

| Part | Estimated work |
|---|---|
| Plugin scaffold (manifest, marketplace, .mcp.json, README, install walkthrough) | 1 dispatch |
| 4 slash commands (~50-150 lines each, prompt-engineered) | 1 dispatch |
| 3 skills, each w/ SKILL.md + 3-5 reference/ files + 2-3 examples/ files (Notion's bar) | 2-3 dispatches |
| 3-4 plugin subagents (tool-subset restrictions, prompt design) | 0.5 dispatch |
| Testing on actual Claude Code in user mode (install, enable, exercise commands) | 0.5 dispatch |
| Marketplace submission + form responses + waiting | 0.25 dispatch |
| Optional: NOTION_MCP_PROFILE feature in server | +1 dispatch (deferred to v0.5.1) |

**Realistic total for v0.5 primary launch artifact: 4-7 dispatches.** Closer to 4 if we ship thin skills (one SKILL.md each, no reference/examples — but that's *visibly thinner* than Notion's plugin sitting next to ours in the marketplace, and the comparison matters). Closer to 7 if we hit the Notion quality bar including evaluations.

Cheapest credible MVP path: 4 dispatches (scaffold + commands + 1 hero skill at full quality + 2 lighter skills + subagents bundled with skills). This produces a launch artifact that is clearly *less ambitious* than Notion's but defensible because it ships structural workflows hosted can't (the four slash commands).

Honest expansion path: 5-7 dispatches gets us to parity-or-better skill quality, with the agent-orchestration skill as the standout differentiator since that's where our wedge is sharpest.

## 6. Misterwigglesworth correction

**Confirmed.** The wave-1 note at `.meta/research/wave1-notion-hosted-deep-2026-04-28.md` (in the `remote-mcp-strategy-2026-04-28` worktree) cites `misterwigglesworth` as third-party validation in two places:

- Line 83 (table row): "The user (`misterwigglesworth`) commented on this issue self-promoting easy-notion-mcp specifically because Notion-flavored Markdown doesn't support bookmark blocks."
- Line 94 (issue #225 entry): "**This is the issue where `misterwigglesworth` openly self-promoted easy-notion-mcp** as a workaround. **Strong signal for the strategist** — the easy-notion author has *already* identified this as a competitive wedge."

`misterwigglesworth` is the maintainer (James) himself. A maintainer self-promoting their own project on a competitor's issues is *not* third-party validation, even when the underlying gap is real. Recommend: soften both citations to "the easy-notion-mcp maintainer self-identified this gap by commenting on issue #225/#220" — keeps the *gap* as evidence, removes the implied independent endorsement. Andrew Nguyen's 30-90min reauth comment on issue #225 still stands as third-party signal.

(Note: dispatch prompt cited `wave1-segment-evidence-2026-04-28.md` line 94, but the misterwigglesworth references actually live in `wave1-notion-hosted-deep-2026-04-28.md`. Same factual content, slightly different file.)

The strategy memo itself (`remote-mcp-strategy-2026-04-28.md`) has a softer version on line 49: "One commenter on that issue self-promoted easy-notion-mcp; James, this is direct market validation that the wedge exists." — that one names James and is honest about who the commenter is, so it doesn't need the same correction.

## 7. Structural-misfit findings

Three findings that should shape the v0.5 plan:

1. **Plugin format ≠ lazy-loaded MCP tool subsets.** The memo's framing implies a feature plugins don't natively have. Real "context-aware tool loading" requires either subagents-with-tool-restrictions (runtime savings only) or a server-side profile flag (listing-budget savings, requires server feature). Reframe v0.5 messaging from "lazy-loaded tool subsets" to "scoped subagents that route work to the right tools" until/unless the server profile flag ships.

2. **Install friction asymmetry.** Notion's plugin = 1-click OAuth (zero per-user setup). Ours = "create a Notion integration, copy a token, paste at enable time." This is a real UX speedbump that disadvantages us on first-install conversion. Mitigation: a 60-second video or annotated screenshot in the README + inside the headless-and-scheduled skill. Doesn't close the gap, but cuts the abandon rate.

3. **Marketplace approval is a black box.** Docs don't disclose the gate. We should file the plugin to the official marketplace early to surface any blockers, but ship via marketplace-add-by-URL regardless. Don't make v0.5 launch contingent on the official directory listing.

None of these are blocking. All three should be acknowledged in the v0.5 plan so we don't get blindsided.

## 8. Source notes

- [Claude Code plugin docs](https://code.claude.com/docs/en/plugins) — fetched 2026-04-28
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — manifest schema, `.mcp.json` format, lazy-loading semantics, subagent tool restrictions
- [Skills reference](https://code.claude.com/docs/en/skills) — frontmatter fields, progressive-disclosure model, `context: fork` and `agent` fields
- [`makenotion/claude-code-notion-plugin`](https://github.com/makenotion/claude-code-notion-plugin) — verbatim file tree, manifest, `.mcp.json`, sample slash commands, sample SKILL.md

## 9. What I did not verify

- Marketplace submission approval gate (docs silent; would need to actually file)
- Exact tool-listing budget cost in real Claude Code sessions (would need to run a session and count)
- Whether plugin's `userConfig` keychain storage works on Linux/WSL the same as macOS (docs say keychain or `.credentials.json` fallback; not tested)
- Whether `npx easy-notion-mcp@^0.5` is fast enough at first launch to not feel broken (likely OK after npm cache warm; not tested)
- How `paths` glob restriction interacts with non-code workspaces (if a user opens Claude Code in a docs repo, will Notion-related skills auto-trigger correctly?)

These are testable in a 1-2 hour first-builder-dispatch spike before committing to the full plan.

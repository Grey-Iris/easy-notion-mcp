---
title: ClawHub SKILL.md craft-reference (5 top performers, body-level)
date: 2026-04-24
status: research brief — craft reference only; not positioning, not a SKILL.md draft
inputs:
  - .meta/strategy/openclaw-positioning-2026-04-24.md (angle picked: markdown round-trip)
  - .meta/research/skills-claw.md (install/star counts as of 2026-04-23)
sources_fetched_via: openclaw/skills GitHub mirror (raw.githubusercontent.com); no SSR fallback needed
artifacts_studied:
  - skills/steipete/notion/SKILL.md (79.2k / 234)
  - skills/dimagious/notion-skill/SKILL.md (11.6k / 15)
  - skills/byungkyu/notion-api-skill/SKILL.md (8.8k / 8) — display name "Notion"
  - skills/willykinfoussia/notion-cli/SKILL.md (5.2k / 7) — display name "Notion Manager"
  - skills/timenotspace/notion-api/SKILL.md (4.8k / 5) — display name "Notion API Tools"
  - skills/byungkyu/notion-mcp/SKILL.md (408 / 0) — same author, MCP variant (corroborator)
---

# 1. Executive summary — transferable craft lessons

Five takeaways the future SKILL.md authoring PM should lean on, ordered by load-bearing-ness:

1. **Open the body with a single declarative sentence that names the verbs and the noun-surface, nothing more.** All five top performers do this in 12-25 words. None opens with marketing, story, or "When the user wants…" coaching. (Quotes in §3.) Whatever differentiation lives in the description field; the body opens by *getting on with it*.
2. **Make every operation a copy-pasteable code block, not a description of an operation.** Across all five, the dominant body unit is `## Operation name` → one fenced code block (curl, CLI, or HTTP). Only byungkyu adds prose around it. Examples are not agent-invocation patterns ("ask Claude to…") and are not JTBD stories — they are command-shaped surface area the agent reads as a callable contract.
3. **Frontmatter the env var prerequisite via `metadata.{openclaw|clawdbot}.requires.env`, and ship `description: |` as a multi-line block scalar when the description carries cross-links or two-sentence positioning.** The single-line `description:` works for boilerplate; the block-scalar form is what byungkyu uses to fit a "use this when… for X use Y skill instead" cross-link in the same field. Worth knowing before authoring our own.
4. **Lift one section out of the API surface into pedagogical "what-changed-recently" framing.** steipete's "Key Differences in 2025-09-03" section (databases→data sources rename, the two-IDs problem) is the single highest-density craft signal in any of the five bodies. Buyers who land on a Notion skill in 2026 are confused about the rename; the body that explicitly resolves the confusion earns trust the description field cannot. We have the material to do the same for our own version-pin choices.
5. **Skip explicit "when to invoke" coaching in the body.** None of the five top performers writes agent-coaching prose ("When the user asks about Notion, do X"). The two that do "when to use" guidance put it in the *description* field, not the body (byungkyu's "Use this skill when users want to interact with Notion workspaces…"). Body voice is reference-card, not orchestrator-prompt. This contradicts some Anthropic-published Skill best-practice templates and should be a deliberate decision, not a default.

A negative finding worth naming: **shape doesn't decide install rank.** Body word counts span 163 (timenotspace, 4.8k installs) to 1,636 (byungkyu/notion-mcp, 408 installs). The top 5 by installs do not share a skeleton — see §4.

---

# 2. The steipete verdict

**The body is competently crafted but modest. It is not boilerplate, but it is not a structural moat either. The 79.2k installs are not explained by the body's craft alone.**

One-phrase evidence: steipete's body is 560 words structured around 8 fully-formed curl examples plus a deliberate "Key Differences in 2025-09-03" pedagogy section explaining the database→data_source rename — a real craft choice, not boilerplate, but reproducible by any competent author in an afternoon.

Specifically, what the body does well:
- The Setup section is a 4-step numbered list that an agent can act on without ambiguity, including the literal `mkdir -p ~/.config/notion && echo "ntn_..." > ~/.config/notion/api_key` ritual.
- Notion-Version is called out in a deliberate blockquote: *"**Note:** The `Notion-Version` header is required. This skill uses `2025-09-03` (latest). In this version, databases are called 'data sources' in the API."* — that block does double duty: declares the version pin, and primes the reader for the rename-confusion that gets resolved in §"Key Differences."
- The "Key Differences in 2025-09-03" section (5 bullets) is the standout: it explicitly separates `database_id` (used when creating pages) from `data_source_id` (used when querying), and tells the reader *how to find* the data_source_id. This is genuine pedagogy and is the body's best craft moment.

What the body does *not* do:
- No error-handling section, no rate-limit-recovery guidance beyond a single note ("Rate limit: ~3 requests/second average").
- No invocation guidance (no "when to use this skill" cue).
- No mention of toggles, callouts, columns, equations, or any block type beyond `paragraph` in the append example.
- No tests, no benchmark, no honest-positioning bar.
- Description field is the verbatim boilerplate sentence ("Notion API for creating and managing pages, databases, and blocks.") — same string as 7 other listings.

**Implication for our positioning frame.** The 79.2k installs are partly a body that *doesn't actively repel* (a non-trivial floor), but they are mostly author brand + first-search-result + the seed-set effect of having shipped early. The "Key Differences" section is the only thing in the body that competitors couldn't trivially match. So:
- The "positioning matters" frame from the strategy brief survives, because steipete's body is *good but not differentiated*. There is room above it.
- The "writing problem vs. distribution problem" question doesn't get fully resolved by reading this body alone — see §6 uncertainty 1.
- The craft floor is real (incoherent garbage would not have ridden brand to 79.2k), but the craft *ceiling* in this catalog is lower than I assumed before reading the file.

---

# 3. Per-skill cards

## 3.1 @steipete/Notion — 79.2k / 234

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/steipete/notion/SKILL.md
- **Frontmatter**: 4 fields. `name: notion`, `description: Notion API for creating and managing pages, databases, and blocks.` (verbatim boilerplate, single line), `homepage: https://developers.notion.com`, `metadata: {"clawdbot":{"emoji":"📝"}}` (inline JSON, no nested YAML). **No env var declared in frontmatter.** No `install.kind` declaration — the skill is self-contained instructions, not a Node-installable package.
- **Body word count**: 560.
- **Outline**: `# notion` → `## Setup` → `## API Basics` → `## Common Operations` → `## Property Types` → `## Key Differences in 2025-09-03` → `## Notes`.
- **Opening (verbatim)**: *"Use the Notion API to create/read/update pages, data sources (databases), and blocks."* (16 words, 1 sentence — the entire opening before the H2.)
- **Examples**: 8 concrete curl invocations: search, get-page, get-blocks, create-page-in-data-source, query-data-source, create-data-source, update-page, append-blocks. **Shape: copy-pasteable curl with full headers, not agent-invocation patterns and not JTBD stories.** One quoted in full:
  ```bash
  curl -X POST "https://api.notion.com/v1/data_sources/{data_source_id}/query" \
    -H "Authorization: Bearer $NOTION_KEY" \
    -H "Notion-Version: 2025-09-03" \
    -H "Content-Type: application/json" \
    -d '{
      "filter": {"property": "Status", "select": {"equals": "Active"}},
      "sorts": [{"property": "Date", "direction": "descending"}]
    }'
  ```
- **Edge case handling**: Inline only. "Notes" section has 4 lines: UUID format, "API cannot set database view filters — that's UI-only," rate limit ~3/sec, `is_inline: true` for embedded data sources. **No Error Handling section, no troubleshooting subsections.**
- **Voice / tone**: Reference-card formal. Sentence-fragment headings. Tone-illustrative line: *"All requests need:"* (followed immediately by a fenced block). The body assumes the reader is an agent with shell access who needs the surface, not a coaching narrative.
- **"When to invoke" guidance**: None in body. None in description either. The skill leans on the agent already knowing it wants Notion.
- **Surprising**: (a) The "Key Differences in 2025-09-03" section is more pedagogical than I expected from a body whose description is boilerplate — that section is the body's craft peak. (b) The frontmatter is the simplest of any I read, declaring no env var and no install kind. The skill is essentially self-documenting curl, no installable artifact.

## 3.2 @dimagious/Notion — 11.6k / 15

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/dimagious/notion-skill/SKILL.md
- **Frontmatter**: Structured YAML (not inline JSON). `metadata.clawdbot.emoji`, `metadata.clawdbot.requires.env: [NOTION_API_KEY]` (env var declared!), and `metadata.clawdbot.install: [{id: node, kind: note, label: "Requires notion-cli (Node.js) or notion-cli-py (Python). See docs below."}]` — **`install.kind: note` is a declarative-instructions install, not auto-install.** Important pattern for us: a way to declare an external prerequisite in frontmatter without claiming the registry will install it.
- **Body word count**: 251 (the smallest of the top three by installs).
- **Outline**: `# Notion` → `## Authentication` → `## Profiles (personal / work)` → `## Pages` → `## Databases` → `## Schema changes (advanced)` → `## Safety notes`.
- **Opening (verbatim)**: *"This skill lets the agent work with **Notion pages and databases** using the official Notion API. The skill is declarative: it documents **safe, recommended operations** and assumes a local CLI (`notion-cli`) that actually performs API calls."* (38 words. Two sentences.) Notice: it explicitly tells the reader *what kind of artifact* this is (declarative documentation, not executable code).
- **Examples**: 7 `notion-cli` shell commands (page get/create, block append, db get/query, page create/update via `--props <json>`), plus a separate "Schema changes (advanced)" pair (`db schema diff`, `db schema apply`). All copy-pasteable, all wrapper-CLI calls. One quoted in full:
  ```bash
  notion-cli block append <page_id> --markdown "..."
  ```
  Followed immediately by: *"Prefer appending over rewriting content."* — opinion-bearing safety guidance attached to the example, not deferred to a separate section.
- **Edge case handling**: A dedicated "Safety notes" section (3 bullets: rate limits, prefer append/update, IDs are opaque). Plus the standalone "Schema changes (advanced)" section gates destructive ops behind explicit warnings: *"Always inspect diffs before applying schema changes. Never modify database schema without explicit confirmation."*
- **Voice / tone**: Considered-colleague. Includes opinion-bearing safety lines inline with examples (*"Prefer appending over rewriting content."*) and uses framings like "advanced" and "Recommended flow." Most distinctive of the five.
- **"When to invoke" guidance**: Implicit ("This skill lets the agent work with…"), no explicit trigger phrases.
- **Surprising**: This is the only top-tier body that **explicitly declares its own genre** in the opening ("declarative: it documents safe, recommended operations and assumes a local CLI") — a meta-honesty move. It also frontmatter-declares the external CLI dependency via `install.kind: note`, which is the cleanest pattern I've seen for "this isn't auto-installable; here's what you need."

## 3.3 @byungkyu/Notion — 8.8k / 8 (slug: `notion-api-skill`, display name "Notion")

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/byungkyu/notion-api-skill/SKILL.md
- **Frontmatter**: `description: |` block scalar carrying a 4-sentence positioning + cross-link statement. Has a unique top-level `compatibility:` field (*"Requires network access and valid Maton API key"*). `metadata.author: maton`, `metadata.version: "1.0"`, `metadata.clawdbot.emoji`, `metadata.clawdbot.homepage`, `metadata.clawdbot.requires.env: [MATON_API_KEY]`. The skill is a thin facade for Maton's hosted gateway; that ownership is declared in metadata.
- **Body word count**: 1,103 (4× steipete, the heaviest of the five-non-MCP).
- **Outline** (compressed): `# Notion` → `## Quick Start` → `## Base URL` → `## Required Headers` → `## Authentication` (+`Getting Your API Key` H3) → `## Connection Management` (5 H3s: List/Create/Get/Delete/Specifying) → `## Key Concept: Databases vs Data Sources` → `## API Reference` (5 H3s: Search/Data Sources/Databases/Pages/Blocks/Users) → `## Filter Operators` → `## Block Types` → `## Code Examples` (JS, Python H3s) → `## Notes` → `## Error Handling` (+ 2 troubleshooting H3s) → `## Resources`.
- **Opening (verbatim)**: *"Access the Notion API with managed OAuth authentication. Query databases, create pages, manage blocks, and search your workspace."* (19 words.) Then immediately into a Quick Start fenced code block.
- **Examples**: Many. The body alternates between (a) HTTP request format (`POST /notion/v1/...` followed by JSON body inline in the code fence) and (b) Python `urllib.request` invocations for the OAuth/connection-management flows. Plus a JS and Python "Code Examples" section at the end. One Search example quoted in full:
  ```bash
  POST /notion/v1/search
  Content-Type: application/json
  Notion-Version: 2025-09-03

  {
    "query": "meeting notes",
    "filter": {"property": "object", "value": "page"}
  }
  ```
- **Edge case handling**: Most thorough of the five. Has an Error Handling table (4 status codes mapped to meanings), plus two named troubleshooting subsections ("Troubleshooting: API Key Issues" with a verification snippet; "Troubleshooting: Invalid App Name" with correct/incorrect URL examples). Also includes 2 "IMPORTANT:" inline notes inside the Notes section about `curl -g` and `$MATON_API_KEY` shell-piping issues.
- **Voice / tone**: Vendor-documentation. Tables. Sub-sectioned. Resource-link footer. Tone-illustrative line: *"In API version 2025-09-03, databases and data sources are separate:"* (followed by a 2-row Markdown table). The body reads like maton.ai's docs site re-pasted as a SKILL.md.
- **"When to invoke" guidance**: In the *description* field (multi-line `|` block): *"Use this skill when users want to interact with Notion workspaces, databases, or pages. For other third party apps, use the api-gateway skill (https://clawhub.ai/byungkyu/api-gateway)."* — this is the only one of the five whose description does explicit when-to-use coaching AND a cross-skill referral. **None of that work happens in the body.**
- **Surprising**: (a) The body is 4× longer than steipete's but has no version-aware pedagogy comparable to steipete's "Key Differences" section — the depth is in API enumeration, not concept-explanation. (b) The cross-link in the description ("For other third party apps, use the api-gateway skill") is a craft pattern none of the others use; it positions the skill within a *family* of skills the same author owns. Worth flagging as a deliberate craft option, even if we don't have a sibling skill to point at yet. (c) The opening sentence does the same syntactic move as steipete's: declarative verb + noun-surface, no narrative.

## 3.4 @willykinfoussia/Notion Manager — 5.2k / 7 (slug: `notion-cli`)

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/willykinfoussia/notion-cli/SKILL.md
- **Frontmatter**: 4 fields. `description: Notion CLI for creating and managing pages, databases, and blocks.` (boilerplate-variant, the word "API" replaced with "CLI"). `homepage: https://github.com/litencatt/notion-cli` (points at the upstream CLI). `metadata: {"openclaw":{"emoji":"📓","requires":{"env":["NOTION_TOKEN"]},"primaryEnv":"NOTION_TOKEN"}}`. **Only file of the five using the `metadata.openclaw.*` namespace** (the others use `metadata.clawdbot.*`). Also the only file declaring `primaryEnv` — a hint about which env var to surface in install UI.
- **Body word count**: 508.
- **Outline**: `# notion` → `## Setup` → `## Usage` → `## Common Operations` → `## Property Types` → `## Examples` → `## Key Features` → `## Notes` → `## References`.
- **Opening (verbatim)**: *"Use *notion-cli* to create/read/update pages, data sources (databases), and blocks."* (12 words. Same syntactic shape as steipete's opener, with `notion-cli` substituted for "the Notion API". Almost certainly modeled on steipete.)
- **Examples**: 6 `notion-cli` commands (search, page retrieve, page retrieve `-r` for blocks, db query, db retrieve) AND 2 raw curl examples (create-page, update-page properties). The mix is unusual: it tells the agent to use the wrapper CLI for read-side ops but falls back to curl for write-side ops, with no explanation of why. Realistic French content in examples ("Nouvelle idée", "Description mise à jour"). Quoted example:
  ```bash
  notion-cli db query 2faf172c094981d3bbcbe0f115457cda \
    -a '{
      "property": "Status",
      "status": { "equals": "Backlog" }
    }'
  ```
- **Edge case handling**: "Notes" section has 4 lines (UUIDs, CLI handles auth, rate limits managed by CLI, use `notion-cli help`). "Key Features" section calls out interactive mode, multiple output formats, raw JSON flag, filter syntax. **No error section, no troubleshooting.**
- **Voice / tone**: Reference-card-with-bullets. Slightly more list-heavy than steipete (Setup is a bullet list; Operations are bullets with embedded code). Tone-illustrative line: *"All commands require the *NOTION_TOKEN* environment variable to be set:"* — terse, declarative.
- **"When to invoke" guidance**: None in body. Description doesn't do it either.
- **Surprising**: (a) Uses the `metadata.openclaw.*` frontmatter namespace while the older listings use `metadata.clawdbot.*` — suggests `openclaw` is the newer convention. We should default to `openclaw`. (b) Mixes wrapper-CLI calls and raw curl in the same body without explaining the split — a craft inconsistency at 5.2k installs, evidence that bodies don't have to be perfect to perform. (c) The skill is essentially a thin instruction wrapper around someone else's npm package (`@iansinnott/notion-cli`); the homepage points at the upstream, not the author's own work. The author's contribution is the *packaging into a Skill*, not new code.

## 3.5 @timenotspace/Notion API Tools — 4.8k / 5 (slug: `notion-api`)

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/timenotspace/notion-api/SKILL.md
- **Frontmatter**: **2 fields total.** `name: notion-api`, `description: Generic Notion API CLI (Node) for search, querying data sources (databases), and creating pages. Configure with NOTION_KEY (or ~/.config/notion/api_key).` That's it. No `metadata`, no env-var declaration, no homepage. The description carries the env-var info that the other 4 put in frontmatter `metadata`. (Of note: the directory listing shows a `scripts/` subdirectory holding the Node CLI, so the skill *does* ship code; the frontmatter just doesn't declare it.)
- **Body word count**: 163. **Smallest of the five by a factor of ~3.**
- **Outline**: `# notion-api (generic)` → `## Auth` → `## Commands (CLI)` → `### Search` / `### Query a data source (database query)` / `### Create a page in a database` → `## Output` → `## Notes`.
- **Opening (verbatim)**: *"This skill provides a small Node-based CLI for the Notion API. It's designed to be shareable: **no hard-coded database IDs and no secrets in the repo**."* (28 words. Two sentences. Voice is "OSS author's README" — explains the design intent and the genre.)
- **Examples**: Three `node scripts/notion-api.mjs <command>` invocations (search, query, create-page). One quoted in full:
  ```bash
  node scripts/notion-api.mjs query --data-source-id <ID> --body '{"filter": {...}, "sorts": [...], "page_size": 10}'
  ```
- **Edge case handling**: One "Notes" section with 2 lines: API version env override (`NOTION_VERSION`), and *"Rate limits apply; prefer page_size and minimal calls."* Nothing else.
- **Voice / tone**: OSS-author README. Tone-illustrative line: *"It's designed to be shareable: **no hard-coded database IDs and no secrets in the repo**."* — frames the skill as a designed-for-others artifact rather than a personal config.
- **"When to invoke" guidance**: None. The description carries no when-cue either.
- **Surprising**: (a) Bare-bones frontmatter and bare-bones body — yet 4.8k installs. This is the strongest single piece of evidence in the five that craft does not strictly determine install rank. (b) The "designed to be shareable / no hard-coded IDs / no secrets" framing is unique among the five and the *only* place I see explicit OSS-author intent declared in a Skill body. (c) The skill ships actual Node code in `scripts/` but doesn't declare `install.kind: node` in frontmatter — relying on the `node scripts/notion-api.mjs` invocation pattern instead. Counter-pattern to what dimagious does.

## 3.6 @byungkyu/Notion MCP — 408 / 0 (corroborator only)

- **URL** (mirror): https://raw.githubusercontent.com/openclaw/skills/main/skills/byungkyu/notion-mcp/SKILL.md
- **Body word count**: 1,636 (heaviest of any I read). Same vendor-docs voice as the sibling. Reference-manual structure with a 12-row MCP tools table and per-tool POST examples plus response JSON.
- **Difference from sibling that matters for our question**: The MCP variant's body is *longer and more thorough* than the 8.8k REST sibling (1,636 vs 1,103 words; 12 documented tools with response shapes vs prose-and-table mix). Yet it has 21× fewer installs (408 vs 8.8k). **This is the cleanest single signal in the dataset that body craft is not driving installs at the high end** — the same author's *better-organized, more reference-complete body* underperforms their less-thorough sibling 21:1. The differentiator is in the description ("Notion API integration" vs "Notion MCP integration") and the install-path / search-result environment, not the body.
- **One unique craft pattern worth noting**: byungkyu's MCP body cross-links to the sibling skill in the *description* field (*"For REST API, use the notion skill (https://clawhub.ai/byungkyu/notion-api-skill)"*), AND embeds response-shape JSON inside the body for every tool. Embedding response shapes is a craft pattern none of the other five use; it teaches the agent both input and what to expect. We could adopt this cleanly.

---

# 4. Shared structural skeleton (or its absence)

**There is no shared skeleton across the top 5.** Word counts span 163 → 1,103 (a 6.7× range). Section counts span 6 → 17. The dominant cluster pattern that *does* recur is loose:

```
H1: skill name (often lowercase, often the slug, not the display name)
[opening sentence: declarative verb + noun-surface, 12-38 words, no narrative]
## Setup OR ## Auth OR ## Authentication (1 of these 3 always appears)
## (operations) — section name varies: "Common Operations", "Pages"+"Databases", "API Reference", "Commands (CLI)"
   [each operation = H2 or H3, content = single fenced code block, optionally with 1 sentence of guidance]
## Property Types (4/5 — only timenotspace skips it)
## Notes (5/5 — universal terminal section, contains rate-limit + UUID guidance)
```

That is the *weak* skeleton. Rigid enough to inform our outline, weak enough that variation is normal. byungkyu adds Error Handling + Troubleshooting + Resources after Notes; dimagious replaces "Notes" with "Safety notes" and adds a gated "Schema changes (advanced)" before it; steipete inserts "Key Differences in 2025-09-03" between Property Types and Notes.

**What this implies for our angle**: there is no template-conformance prize. We can structure the body around our differentiator (markdown round-trip) without violating reader expectations, *provided* we still deliver Setup → Operations → Notes in some recognizable order. The freedom is real.

---

# 5. Fit to the recommended angle (markdown round-trip as buyer outcome)

Per the positioning brief, the angle is markdown round-trip. Mapping each craft pattern from §1-4 against that angle:

**Patterns that transfer cleanly:**
- **Single-sentence declarative opening (§1.1).** We have the material: "Notion MCP server: agents write Markdown — toggles, callouts, columns, equations, TOC — and read the same conventions back." Same syntactic shape as steipete/willykinfoussia openings, ~25 words.
- **Operation = code block (§1.2).** Our 28-tool surface naturally fits this. Each tool gets an H3, each H3 gets a fenced example. Body length will land closer to byungkyu's 1,103 than steipete's 560 just from tool count, which is fine.
- **`metadata.openclaw.requires.env` declaration (§1.3).** Use `openclaw` namespace (per willykinfoussia, the newest of the five), not `clawdbot`. Declare `NOTION_TOKEN` (or whichever env our HTTP entry expects).
- **Pedagogical "what-changed" section (§1.4).** Direct lift: an H2 explaining the markdown convention table from CLAUDE.md:102-126. This is *exactly* the structural slot steipete uses for "Key Differences in 2025-09-03" — the body slot where pedagogy compounds. We'd put markdown round-trip pedagogy there. Strongest single transfer.
- **Notes section closing the body with rate-limits + UUID conventions (§4).** Universal across the five. Keep it.

**Patterns that transfer with care:**
- **byungkyu's `description: |` block scalar with cross-link.** Cross-link option is real — we could point at a future Plugin-track listing once it exists, or at the markdown convention reference in our README. Don't introduce a phantom cross-link with no target.
- **byungkyu's response-shape JSON inline with each tool.** Strong pedagogy, but adds substantial length. Probably defer — our 28 tools at byungkyu's verbosity would push past 2,500 words and risk losing reader attention. Worth considering for a select few high-confusion tools (e.g., long-property pagination shape).
- **dimagious's opinion-bearing safety lines attached to examples.** Fits our identity (we already have safety opinions: prefer markdown over block JSON, prefer append over destructive rewrites). Adopt selectively, not everywhere.

**Patterns that don't transfer or actively conflict:**
- **steipete's "no env var declared" minimalism.** We have a real env var (NOTION_TOKEN); declare it.
- **timenotspace's bare-bones approach.** 163 words is below the threshold where we can convey the markdown round-trip differentiator. The angle requires demonstration, not just claim.
- **Skipping "when to invoke" entirely (§1.5).** This *would* transfer per the catalog norm, but: our angle (markdown round-trip) is differentiated enough that an agent reading two Notion skills side-by-side benefits from a "use this when you want the agent to write/read in markdown rather than block JSON" cue. Recommend putting that cue in the *description*, not the body — same pattern as byungkyu, who is the only one of the five doing explicit when-to-use cueing.

**Pattern unique to our project that has no precedent in the five:** none of these bodies cite tests, benches, version-pin rationale, or audit history. The angle B "proof-of-care paragraph" the strategy brief earmarks for the body would be a genuinely uncrowded craft move. Risk: it could read as engineer-voiced and slow the body down. Recommend a single tight paragraph near the end, not a section.

---

# 6. Uncertainties

1. **Does body craft actually move installs in this catalog, or is the install distribution dominated by author brand + first-result-of-search + when the skill was registered?** Reading the bodies alone cannot resolve this. The within-author comparison (byungkyu's REST 8.8k vs MCP 408, with the MCP body being objectively more thorough) suggests *body quality is not the lever* at the high end. But across-author comparison is confounded by author reputation and seed-set timing. To resolve this rigorously you'd need data the strategy PM doesn't have access to: ClawHub's search-result ranking weights, install-velocity over time, and click-through-rate by description vs. body. Practical implication: don't bet the craft strategy on out-crafting steipete; bet it on filling the markdown-round-trip quadrant (per positioning brief §3.4) with a body that meets the catalog's craft floor. The five bodies show that floor is real but not high.

2. (Secondary) **Whether "when to invoke" coaching belongs in our body.** Catalog norm is to skip it; our differentiator argues for including it. I lean "in the description, not the body" per byungkyu's pattern, but reasonable people could disagree. Worth the SKILL.md authoring PM revisiting.

3. (Tertiary) **Frontmatter namespace drift: `clawdbot.*` vs `openclaw.*`.** Only willykinfoussia uses `openclaw`. The others use `clawdbot`. willykinfoussia is the most recent metadata schema I saw. I'm assuming `openclaw` is the new canonical namespace (matches the registry rename and the GitHub mirror name), but I haven't confirmed via OpenClaw docs in this dispatch.

---

# 7. Source-fetch log

All 6 artifacts fetched cleanly from the openclaw/skills GitHub mirror. **No SSR fallback to clawhub.ai was needed.** Mirror-vs-SSR provenance was per the dispatch's preference for the GitHub mirror (it sidesteps the SSR hydration-artifact issue from the prior research cycle).

| Artifact | URL | Source |
|---|---|---|
| @steipete/Notion | https://raw.githubusercontent.com/openclaw/skills/main/skills/steipete/notion/SKILL.md | mirror ✓ |
| @dimagious/Notion | https://raw.githubusercontent.com/openclaw/skills/main/skills/dimagious/notion-skill/SKILL.md | mirror ✓ |
| @byungkyu/Notion | https://raw.githubusercontent.com/openclaw/skills/main/skills/byungkyu/notion-api-skill/SKILL.md | mirror ✓ |
| @willykinfoussia/Notion Manager | https://raw.githubusercontent.com/openclaw/skills/main/skills/willykinfoussia/notion-cli/SKILL.md | mirror ✓ |
| @timenotspace/Notion API Tools | https://raw.githubusercontent.com/openclaw/skills/main/skills/timenotspace/notion-api/SKILL.md | mirror ✓ |
| @byungkyu/Notion MCP (corroborator) | https://raw.githubusercontent.com/openclaw/skills/main/skills/byungkyu/notion-mcp/SKILL.md | mirror ✓ |

Slug→display-name mapping verified via each skill's `_meta.json` in the mirror (e.g., `byungkyu/notion-api-skill` → displayName "Notion"; `byungkyu/notion-mcp` → displayName "Notion MCP"; `willykinfoussia/notion-cli` → displayName "Notion Manager").

---
title: ClawHub positioning strategy for easy-notion-mcp
date: 2026-04-24
status: strategy brief (positioning only; SKILL.md authoring is a separate future step)
inputs:
  - .meta/research/skills-claw.md (landscape scrape, ~65 Notion-tagged entries, 2026-04-23)
  - .meta/research/openclaw-submission-2026-04-23.md (SKILL.md fields)
  - .meta/research/openclaw-plugin-submission-2026-04-24.md (Plugin track — out of scope here)
  - CLAUDE.md (honest-positioning bar, markdown-first identity)
  - Live fetches: clawhub.ai/dimagious/notion-skill, clawhub.ai/steipete/notion, clawhub.ai/maweis1981/notion-md
redteam: codex session `strategy-redteam-openclaw-positioning` — conditional accept, 3 conditions integrated
---

# Executive summary

ClawHub already lists ~65 Notion-tagged skills. The install distribution is long-tailed: two entries dominate (@steipete 79.2k, @dimagious 11.6k), then a mid-tier of auth-brokers and sync tools in the low thousands, then a long tail of vertical-workflow skills. The 6 most-installed entries I spot-checked ship no visible tests, no bench evidence, and no documented markdown round-trip model; their descriptions use the generic boilerplate "Notion API for creating and managing pages, databases, and blocks" — 8 entries use that exact sentence.

**Recommended angle: markdown round-trip as a buyer outcome.** Position easy-notion-mcp as the Notion MCP server where agents write readable markdown — including toggles, callouts, columns, equations, and TOC — and read it back in the same conventions, instead of constructing Notion block JSON. Back the claim with the full-surface tool count, version pin, and bench + test numbers as proof-of-care, not as the lead. The defensible gap this fills is narrow but real: no *broad* Notion skill in the scrape positions around markdown as the primary interface with documented round-trip fidelity. The two explicit markdown skills (@maweis1981 561 installs, @fental 71) are both write-only and narrowly scoped.

**Alternative angles considered**: (B) production-hygiene / bench-tested primary — rejected as too inside-baseball for the description field; kept as secondary proof. (C) "MCP server, not instructions" — rejected as defined-in-opposition; some of that distinction lives naturally inside angle A anyway.

**Key uncertainty**: whether ClawHub buyers filter on interface paradigm at all. Install mass sits with entries whose descriptions don't mention any interface abstraction. The angle may resonate with sophisticated agent-platform builders and be invisible to the "I typed notion into the search box" majority. Section 7 details this and the disconfirming test.

---

# 1. Landscape map

## 1.1 Input caveat

Install counts below are taken from the `.meta/research/skills-claw.md` scrape (2026-04-23). I treat the larger number as installs and the smaller as stars, per the task brief — a spot-check against the live dimagious page confirms that pairing (11.6k downloads / 15 stars matches the scrape). Entries are sorted within each archetype by install count.

## 1.2 Archetypes

I read each of the ~65 entries and clustered them by declared positioning (what the description says they do, not what they may actually do under the hood — I only spot-fetched three listings). Clusters are not mutually exclusive; I've placed each entry in its dominant frame.

### Archetype 1 — Generic full-API (the boilerplate-description cluster)

**Defining trait**: the description is a generic statement about "Notion API for creating and managing pages, databases, and blocks" or a close paraphrase. Eight entries use that sentence verbatim or near-verbatim.

**Representatives**:
- @steipete/Notion — **79.2k installs, 234 stars** (outlier — sole reason this cluster owns most of the install mass)
- @dimagious/Notion — **11.6k installs, 15 stars**
- @7revor/Notion 1.0.0 — 565 / 0
- @mohdalhashemi98-hue/MH notion — 505 / 0
- @nidhov01/Notion — 240 / 0
- @qfish/notion-test — 258 / 0
- @xuyangmiemie-beep/Notion — 66 / 0
- @nhuanlaptrinh/hocnhanh_n8n — 131 / 0

**Mass**: ~92k installs combined — **dominant by install count, but lopsided** (steipete + dimagious account for ~99% of it). Below those two, the cluster is long-tail low-signal.

**Signal**: The description field is not doing the discrimination work. Something else (personal brand, SEO, "first I saw," install-path convenience) is driving installs. Worth noting because it means the cluster's install count should not be read as evidence the boilerplate description "works."

### Archetype 2 — CLI-wrapper skills

**Defining trait**: description explicitly says the skill wraps a local CLI (notioncli, notion-cli, notion-cli-py, custom Python scripts via exec).

**Representatives**:
- @willykinfoussia/Notion Manager — 5.2k / 7
- @timenotspace/Notion API Tools — 4.8k / 5 (Node CLI, NOTION_KEY env)
- @tristanmanchester/Notion API — 3.2k / 6 (JSON-first CLI)
- @froemic/Notion CLI — 2.9k / 2
- @baixiaodev/Notion Skill Publish — 116 / 0 (Python CLI with auto-pagination)
- @jordancoin/Notion — 907 / 0 (notioncli wrapper)
- @0xarkstar/Clawhub — 85 / 0 (Rust CLI + MCP hybrid, notion-cli 2025-09-03+)
- @xiangtaoxiao/Eisenhower Matrix — 150 / 1 (exec Python)
- @kaising-openclaw1/Cli Notion — 74 / 0

**Mass**: ~17k installs combined. Mid-weight.

**Signal**: Active, credible pattern — agents invoke shell, which is common in ClawHub's model. But distribution depends on users having the CLI available (see dimagious — its listing doesn't ship the CLI; the user sources `notion-cli` separately).

### Archetype 3 — Auth-brokering / managed-auth

**Defining trait**: description explicitly emphasizes OAuth or managed authentication as the positioning.

**Representatives**:
- @byungkyu/Notion — **8.8k / 8** ("managed OAuth")
- @byungkyu/Notion MCP — 408 / 0 (same author's MCP variant, far fewer installs)
- @otman-ai/Notion — 76 / 0 (OAuth for search, CRUD)

**Mass**: ~9.3k combined, effectively all in the byungkyu flagship.

**Signal**: Managed-OAuth is a real positioning peg, and the 8.8k install count at a `8 stars` repo suggests the *positioning* is doing work (not just the author's profile). But the `byungkyu/Notion MCP` variant at 408 installs suggests that "MCP" in the name is not a draw — possibly a negative relative to the non-MCP flagship. Counter-signal to angle C below.

### Archetype 4 — Sync / bidirectional / cross-tool mirror

**Defining trait**: description positions around moving content between Notion and another system (Notion↔Obsidian, IM→Notion, WeChat→Notion, Get笔记→Notion).

**Representatives**:
- @robansuini/Notion Sync — **3.8k / 6** (bi-directional Notion↔)
- @hawkvan/Notion Sync Obsidian — 385 / 1
- @molaters/obsidian to notion — 98 / 0
- @phoenixyy/Getnote Daily Sync — 448 / 0
- @70asunflower/Notion IM Helper — 254 / 1
- @gevtolev/WeChat to Notion — 299 / 0
- @opoojkk/Wechat Mp To Notion — 90 / 0
- @nick-tsyen/GitHub Stars Export — 171 / 0
- @smilelight/memory-to-notion — 360 / 0
- @laurobrcwb/Notion co-worker — 176 / 0 (Gmail-triggered agent)

**Mass**: ~6.1k combined. robansuini's 3.8k is the standout — "Bi-directional sync and management" is a sharp outcome claim.

**Signal**: Codex red-team noted this archetype is underweighted in my first read. Users reward job-to-be-done clarity even when the underlying tech is modest. Relevant context for angle selection.

### Archetype 5 — Vertical workflow / task-shaped

**Defining trait**: description names a specific workflow or job (morning briefing, web clipper, task list, calendar, expense tracker, knowledge capture, diary, summarization, business-specific CRM).

**Representatives**:
- @lucas-riverbi/Morning Briefing — **3.6k / 0** (personalized morning report)
- @ivangdavila/Notes — **3.3k / 3** (multi-backend notes: local, Apple, Bear, Obsidian, Notion, Evernote)
- @moikapy/Notion Enhanced — 2.6k / 4 (knowledge bases, CRMs, calendars)
- @nextaltair/Soul In Sapphire — 1.6k / 0 (long-term memory)
- @neptunear/Knowledge Capture — 1.6k / 0
- @ewingyangs/notion-clipper-skill — 950 / 1 (HTML→Notion web clipper)
- @luciorenovato/Notion Mvp — 640 / 0 (daily tasks)
- @luciorenovato/Notion Tasks Blocks — 537 / 0 (to-do block management)
- @dongkukim/Notion API 2026 01 15 — 1.3k / 0 (templates, locks)
- @codeblackhole1024/Expense Tracker v2 — 375 / 0
- @ivangdavila/Notion Calendar — 364 / 0
- @xinyuqinfeng/B站 videos → Notion — 287 / 1
- @zurbrick/Notion Brain — 133 / 0 (quality-gated routing)
- @breeze-r/Notion Diary — 124 / 0
- @terrycarter1985/Session Log Analyzer — 70 / 0
- @nissan/Insight Engine — not-counted (truncated row in scrape)
- @martc03/Synergy Salon — 325 / 0 (salon CRM)
- @martc03/Soil Rich Ops — 316 / 0 (farm ops)
- @kfuras/notipo — 232 / 0 (WordPress publish via Notion)
- @lucas-riverbi/Morning Briefing — 3.6k (listed above)

**Mass**: ~17k combined. Distributed across many narrow jobs.

**Signal**: This is where Codex's observation lands — job-shaped workflows meaningfully compete with generic-API skills on install count. Users pick the skill whose description sounds like their job.

### Archetype 6 — Markdown-focused / format-conversion

**Defining trait**: description leads with markdown as the interface.

**Representatives**:
- @maweis1981/Notion Md — **561 / 0** ("Convert Markdown to Notion blocks with full format support." Write-only. Live fetch confirmed: no read/export, no round-trip.)
- @fental/notion-enhanced-markdown-integration — 71 / 1

**Adjacent hybrids that touch markdown but don't lead with it** (per Codex's review — relevant competition to surface honestly):
- @vincentdchan/solid-notion — 265 / 0 ("Manage Notion pages locally as Markdown: pull, edit with JSON patches, write changes, submit edits with rollback")
- @ewingyangs/notion-clipper — 950 / 1 ("HTML to Markdown, then to Notion blocks")
- @molaters/obsidian to notion — 98 / 0 ("preserving rich text, tables, lists, code blocks, callouts")

**Mass of explicit-markdown positioning**: ~630 installs (narrow). **Mass including adjacent markdown-touching**: ~2k installs.

**Signal**: The narrow cluster is small and weak. But "markdown-first as primary interface AND round-trip fidelity" is not currently claimed by any *broad* Notion skill. That's the real gap.

### Archetype 7 — Version-aware API pin (cross-cutting)

Worth calling out as a cross-cutting flag, not a standalone archetype:
- @kai-tw/Notion 2025 API Skill — 297 / 0 (explicit 2025-09-03 pin)
- @dongkukim/Notion API 2026 01 15 — 1.3k / 0 (2026-01-15 pin)
- @steipete (body text mentions 2025-09-03 "data sources" terminology)

We pin 2025-09-03 per `CLAUDE.md:139`. Not a unique claim; not a hook; a table-stakes signal for sophisticated buyers.

## 1.3 Mass summary

| Archetype | Combined installs | Representative strong entry |
|---|---:|---|
| Generic full-API (boilerplate) | ~92k | @steipete (79.2k, outlier) |
| Vertical workflow | ~17k | @lucas-riverbi Morning Briefing (3.6k) |
| CLI-wrapper | ~17k | @willykinfoussia Notion Manager (5.2k) |
| Auth-brokering | ~9.3k | @byungkyu (8.8k, managed OAuth) |
| Sync / cross-tool mirror | ~6.1k | @robansuini Notion Sync (3.8k) |
| Markdown-focused (narrow) | ~0.6k | @maweis1981 Notion Md (561) |

Install mass is concentrated in generic-boilerplate (driven almost entirely by one outlier) and distributed across vertical-workflow/CLI-wrapper/auth-brokering in the thousands-per-entry range.

---

# 2. Top-performer analysis

## 2.1 @dimagious/Notion (anchor) — 11.6k installs, 15 stars

- URL: https://clawhub.ai/dimagious/notion-skill
- **Positioning sentence**: "Work with Notion pages and databases via the official Notion API." (shortest possible version of the boilerplate.)
- **Differentiator in practice** (from live fetch): **instruction-only skill wrapping an external CLI (`notion-cli`/`notion-cli-py`)** that the user must source separately. The skill is a prompt bundle, not code. Features called out in the body: profile support via `NOTION_PROFILE` env (personal/work contexts), markdown append preference over destructive rewrites, schema diff-then-apply workflow, rate-limit awareness.
- **Likely install driver**: being the first Notion result many users see + profile support is a practical pain-point fix. 15 stars vs. 11.6k installs suggests low friction-to-install rather than strong signal-seeking. The anchor quality James pointed at is real: this is the benchmark, not the ceiling.

## 2.2 @steipete/Notion (outlier) — 79.2k installs, 234 stars

- URL: https://clawhub.ai/steipete/notion
- **Positioning sentence**: "Notion API for creating and managing pages, databases, and blocks." (exact boilerplate.)
- **Differentiator in practice** (from live fetch): **instruction-only, curl-based**. Users store API key at `~/.config/notion/api_key` in plaintext and the skill teaches agents to construct raw HTTP calls. Addresses the 2025-09-03 "data sources" rename. No SDK, no MCP server, no tests. Security scan flagged plaintext key storage as risky.
- **Likely install driver**: **Author reputation** (steipete is a well-known OSS maintainer). Not the description, not the body content. 234 stars is the tell — two orders of magnitude higher than dimagious, because the install count here is partly brand-following. If you remove steipete from the archetype-1 totals, the "generic full-API" cluster's install mass collapses to ~13k, distributed across dimagious and a long tail of low-signal entries.

## 2.3 @maweis1981/Notion Md (adjacency benchmark) — 561 installs, 0 stars

- URL: https://clawhub.ai/maweis1981/notion-md
- **Positioning sentence**: "Convert Markdown to Notion blocks with full format support. Handles bold, italic, strikethrough, inline code, headings, lists, tables, callouts, and more."
- **Differentiator in practice** (from live fetch): **write-only, one-directional** (markdown → Notion). No read, no export, no round-trip. Operations: create, list-pages, append. Security scan noted "inconsistencies between docs and actual implementation." No columns, no equations.
- **Why this entry matters for us**: It's the only skill in the scrape that leads its description with "markdown," and it's a narrow tool. Its 561 installs + 0 stars tell us the explicit-markdown position has real search traffic but is weakly served. A broad Notion MCP that leads with markdown round-trip operates in uncrowded adjacent space. **We're not competing with this skill; we're competing with the generic boilerplate for the same search intent while offering a materially different interface.**

## 2.4 What I did not fetch, and why

I attempted a WebFetch on @byungkyu/notion but the response appeared to return cached steipete content (identical install numbers; contradicted the scrape's "managed OAuth" description). Rather than burn cycles re-fetching, I trusted the scrape description for the landscape map. Byungkyu's role in the grid (auth-brokering, 8.8k installs) is robust to that gap because the scrape description itself is the positioning signal.

---

# 3. Positioning grid

## 3.1 Axes (chosen + justified)

**X-axis: Interface abstraction.** *Agent constructs low-level payloads (block JSON, curl, shell)* ← → *Server/skill absorbs Notion's block model; agent works in a higher-level representation (markdown, structured objects).*

**Y-axis: Scope.** *Narrow JTBD (one workflow, one mirror direction, one job)* ← → *Broad Notion API surface (pages, databases, blocks, comments, properties, files).*

**Why these axes**: Codex flagged that install mass rewards JTBD clarity, not just breadth (archetype 5 evidence). But easy-notion-mcp is unambiguously a broad-scope tool — so plotting against scope shows whose search intent we compete for. Interface abstraction is the axis where our markdown-first identity is load-bearing, per `CLAUDE.md:3`. These two axes together reveal the quadrant structure of the field.

## 3.2 Plot

```
                     NARROW JTBD (top-left, top-right)
                              ^
                              |
   (low abstraction × narrow) | (high abstraction × narrow)
   - @lucas-riverbi Briefing  | - @maweis1981 Notion Md (write-only)
   - @ewingyangs clipper      | - @vincentdchan solid-notion (md local)
   - @luciorenovato Tasks     |
   - @martc03 Salon/Soil      |
                              |
LOW ABSTRACTION <-------------+-------------> HIGH ABSTRACTION
(raw curl / block JSON /      |             (markdown / structured obj)
 CLI-wrapper / JSON-first)    |
                              |
   (low abstraction × broad)  | (high abstraction × broad)
   - @steipete (curl, 79.2k)  | ← UNCROWDED quadrant
   - @dimagious (notion-cli)  |   (no entry I read positions here)
   - @willykinfoussia CLI     |   easy-notion-mcp's natural home
   - @timenotspace CLI        |
   - @byungkyu (OAuth bearer) |
   - @robansuini Sync         |
                              v
                       BROAD API SURFACE (bottom)
```

## 3.3 Where easy-notion-mcp plots, by differentiator leaned into

- **Lean into markdown round-trip + full surface** → **bottom-right**. Uncrowded. The 28 tools make it broad-scope; the markdown round-trip (`CLAUDE.md:102-126`, `src/blocks-to-markdown.ts`) puts it high-abstraction. **No competitor in the scrape currently occupies this quadrant.**
- **Lean into bench/tests/production-hygiene** → lands in **bottom-left** (low-abstraction broad API). Competes directly with steipete on install-mass-intent. Quality signal is real but sits in the same quadrant as the incumbents, who can't disprove the claim but also haven't ceded the ground.
- **Lean into OAuth / HTTP transport** → lands near **@byungkyu** (also bottom-left but auth-differentiated). byungkyu is a credible incumbent with 8.8k installs in this exact sub-niche; we'd compete head-on.
- **Lean into MCP-native / "not instructions"** → same bottom-left quadrant, reframed. Note: @byungkyu/Notion MCP (408 installs) shows the "MCP" keyword in the name *underperforms* the same author's non-MCP flagship (8.8k). That's a signal against leaning on the "MCP server" distinction as a buyer hook.

## 3.4 Uncrowded quadrant summary

**Bottom-right (high-abstraction × broad API)**: empty in the scrape. The narrow-markdown skills (@maweis1981 561) sit top-right. The broad-API skills (@steipete, @dimagious, @byungkyu) sit bottom-left. Easy-notion-mcp is the only candidate I see that structurally belongs in bottom-right — not because competitors can't follow, but because the scrape shows nobody currently leads with that combination.

---

# 4. Angle candidates

Per the brief: three defensible angles. Each checked against the honest-positioning bar in `CLAUDE.md:13`. I name at least one specific competitor per angle, not hand-wave.

## Angle A — Markdown round-trip as the interface

### Positioning claim (draft; not a final SKILL.md description)

> "Notion MCP server: agents write markdown (toggles, callouts, columns, equations, TOC) and read it back in the same conventions — no Notion block JSON. Full surface: 28 tools across pages, databases, blocks, comments, search, people/relation properties, file uploads. Notion-Version 2025-09-03."

Per Codex's feedback: the final SKILL.md description should lead with the **outcome** ("agents write readable markdown and read back the same conventions") rather than the feature keyword "markdown-first." The draft above does that.

### Defensible proofs

- Markdown-first is not a retrofit: `CLAUDE.md:3` opens the document with it as identity — "Markdown-first Notion MCP server. Agents write markdown, the server converts it to Notion's block API. Agents never touch Notion block objects directly."
- Round-trip is a design claim with explicit evidence: `CLAUDE.md:126` — "These round-trip cleanly: `read_page` outputs the same conventions that `create_page` accepts."
- Custom block-type conventions documented: `CLAUDE.md:102-126` (12 rows in the table: toggles, toggle-headings at 3 depths, columns, 8 callout flavors, equations, TOC, embed, bookmark, task-list). Plus the "Adding a new block type" maintenance checklist at `CLAUDE.md:128-134`.
- Implementation files exist and are shipping code: `src/markdown-to-blocks.ts`, `src/blocks-to-markdown.ts`. Round-trip is tested in the 417-test vitest suite (per CLAUDE.md and CI status).
- The one explicit-markdown competitor (@maweis1981/Notion Md, 561 installs) is write-only per live fetch. Confirmed.

### Who's NOT in this niche today

From the scrape:
- No entry in the 10 most-installed skills positions around markdown-as-interface. @steipete (79.2k, curl), @dimagious (11.6k, external CLI), @byungkyu (8.8k, OAuth bearer), @willykinfoussia (5.2k, Node CLI), @timenotspace (4.8k, Node CLI), @robansuini (3.8k, sync), @lucas-riverbi (3.6k, workflow), @ivangdavila Notes (3.3k, multi-backend), @tristanmanchester (3.2k, JSON-first CLI), @froemic (2.9k, CLI).
- The two explicit-markdown entries (@maweis1981 561, @fental 71) are narrow and write-oriented.
- Adjacent-markdown hybrids (@vincentdchan solid-notion 265, @ewingyangs clipper 950, @molaters 98) are workflow-shaped, not broad-API.

### Risks / weaknesses

1. **"Markdown-first" may read as a feature, not a position.** A buyer scanning ClawHub is likely searching "Notion" and skimming one-liners. If the one-liner doesn't finish the sentence about what the buyer *gets*, the differentiator may not land. The draft claim above tries to solve this by leading with "agents write markdown and read it back" instead of the label. The SKILL.md authoring step needs to sustain this discipline.
2. **Narrow-markdown precedent is weak**: 561 installs at zero stars. You could read that as "nobody wants this" rather than "this is an uncrowded opportunity." Counter-reading: @maweis1981 is write-only with scan-flagged inconsistencies; its weakness may be execution, not demand.
3. **Install mass rewards brand + boilerplate** (see steipete analysis). Positioning differentiation may have a ceiling in this catalog no matter what angle we pick.

### Fit with SKILL.md `description` field

Good-to-strong, with care. The description field is the primary search/UI summary (`openclaw-submission-2026-04-23.md:65`). The final description should:
- Start with the outcome ("agents write readable Markdown / read back the same conventions")
- Name the scope breadth in the same sentence ("full Notion API: pages, databases, blocks, comments...")
- Include keywords a user would search — "Notion," "MCP," "markdown"

One tight version to test: *"Notion MCP server — agents write Markdown (toggles, callouts, columns, equations, TOC), read the same conventions back. Full surface: pages, databases, blocks, comments, search, people/relation properties, file uploads. Notion-Version 2025-09-03."* (~330 characters; fits most summary surfaces.)

## Angle B — Production-hygiene / bench-tested Notion MCP

### Positioning claim (draft)

> "Notion MCP server with a measured agent benchmark (13 scenarios in `.meta/bench/`), 417 unit tests, 31 live E2E tests, Notion-Version 2025-09-03 pin, silent-data-loss audit trail (v0.5.0 long-property pagination fix). Full 28-tool surface."

### Defensible proofs

- Bench: `.meta/bench/` directory exists with scenario definitions; CI runs bench assertions (recent commits 0c94f02 "fix(bench): use queryDatabase wrapper in scenario 10 assert" confirm active maintenance).
- Test count: `CLAUDE.md` documents vitest as the test runner; CI workflow runs build + typecheck + test on Node 18 + 20.
- Version pin: `CLAUDE.md:139` explicit: "@notionhq/client v5.13.x — matches Notion-Version: 2025-09-03."
- v0.5.0 long-property pagination fix: referenced in `feedback_state` memory + audit docs (trackable in git history).

### Who's NOT in this niche today

- **No listing in the top 10 installs I reviewed mentions tests, bench, or CI in its description.**
- The phrase "production-ready" appears in @tomas-mikula/Notion Manager (316 installs, 0 stars) as an unsourced claim. No benchmark, no tests mentioned in body.
- This is a *quality-signaling vacuum* in the catalog (Codex's phrase). Validated.

### Risks / weaknesses

1. **Inside-baseball positioning.** A user picking a Notion skill likely does not filter on test count or bench scenarios. Sophisticated buyers (agent platform teams, enterprise users) might. That's a much smaller audience than the catalog's install distribution rewards.
2. **Dry description.** "417 tests" in the one-liner reads as engineer-speak. It fits the honest-positioning bar precisely *because* it cites real numbers, but it doesn't fit the "buyer scans and clicks" discovery path.
3. **Claim needs maintenance.** Test counts drift; committing to specific numbers in the description makes the listing stale. The body can carry the details; the one-liner can't.
4. **The honest-positioning bar cuts both ways.** Saying "production-ready" without proof violates the bar. Saying "tested, bench-validated" with proof is honest but wordy.

### Fit with SKILL.md `description` field

Weak as primary hook. Strong as **proof paragraph in the body**. That's where I recommend this angle live.

## Angle C — "MCP server, not an instruction bundle"

### Positioning claim (draft)

> "Proper MCP server (npm: easy-notion-mcp; stdio + HTTP+OAuth transports) for Notion — not a prompt bundle that teaches the agent how to call the API. 28 tools, encrypted multi-tenant token storage, v0.5.0."

### Defensible proofs

- Really is an MCP server: npm package, `dist/index.js` stdio entry, `dist/http.js` HTTP entry (`CLAUDE.md:60-71`).
- OAuth relay: `src/auth/oauth-provider.ts`, token-store with AES-256-GCM encryption (`CLAUDE.md:67, 144`).
- `@byungkyu/Notion` (8.8k) is text-instructions-with-manual-auth per the scrape description; `@steipete` (79.2k) is instruction-only per live fetch; `@dimagious` (11.6k) is instruction + external CLI per live fetch.

### Who's NOT in this niche today

- The scrape has MCP in the name for only a few entries. `@byungkyu/Notion MCP` exists with 408 installs, vs. the same author's non-MCP flagship at 8.8k — suggesting the "MCP" keyword itself is *not* doing discovery work.
- `@0xarkstar/Clawhub` (85 installs) markets itself as "Rust CLI + MCP server" but install count is weak.
- We'd likely be the most prominent entry foregrounding MCP-native identity.

### Risks / weaknesses

1. **Defined in opposition.** The phrase "not an instruction bundle" takes shots at the incumbents by construction. CLAUDE.md's honest-positioning bar says "soften unverifiable comparisons." This one is *verifiable* (the competitors really are instruction bundles) but still reads as oppositional — not the measured tone `CLAUDE.md:13` asks for.
2. **Countersignal from the data.** The byungkyu "MCP" variant underperforms the non-MCP variant 20:1 on installs. Whatever the buyer actually filters on, "MCP" in the description is not obviously helping.
3. **Some of this is strictly better expressed inside Angle A.** Once Angle A says "Notion MCP server — agents write Markdown," the MCP-native identity is already asserted; leaning harder on the "not instructions" frame adds combativeness without adding clarity.

### Fit with SKILL.md `description` field

Moderate. Works as a sentence in the body. Not recommended as the primary hook.

---

# 5. Recommendation

**Lead with Angle A (markdown round-trip as buyer outcome). Use Angle B (bench + tests + version pin) as proof-of-care evidence in the body. Let Angle C's MCP-native framing surface implicitly through Angle A's wording, not as a standalone claim.**

## Why A leads

1. **It's the only angle that puts easy-notion-mcp in an uncrowded grid quadrant** (high-abstraction × broad-API, empty in the scrape).
2. **It's grounded in the project's load-bearing identity** — `CLAUDE.md:3` opens with it. That means positioning and code evolve together; no retrofit risk.
3. **It survives the honest-positioning bar** — the round-trip claim is citable in `CLAUDE.md:102-126` and in `src/blocks-to-markdown.ts`; the full-surface claim is citable in the 28-tool list.
4. **The adjacent-markdown precedent (@maweis1981 write-only, 561 installs) confirms buyer intent exists but is weakly served**, rather than showing demand is absent.

## Why B is secondary, not primary

Codex called it right: the catalog shows a quality-signaling vacuum, and that vacuum is worth filling. But filling it with the description field risks sounding dry and engineer-voiced. The body paragraph is where bench/tests earn their keep — reinforcing the primary Angle A claim with concrete proof.

## Why C should not lead

Two signals point away from C as primary: (i) @byungkyu's MCP variant (408) underperforms their non-MCP flagship (8.8k), weak evidence that "MCP" in the description drives installs; (ii) the framing is defined-in-opposition and strains the measured-tone bar. The MCP-native reality of easy-notion-mcp still comes through Angle A's wording.

## Explicit tradeoffs

- **A over B**: Gives up the cleanest attack on the quality-signaling vacuum in exchange for a structurally-uncrowded position. If buyers reward quality signals more than interface paradigm, B wins. I judge buyers reward neither cleanly (install mass goes to @steipete via author brand) but A's quadrant is more defensible long-term.
- **A over a JTBD workflow angle**: Codex flagged the underweighted workflow cluster. A JTBD-primary angle ("Notion storage for your agent's output," "Pair-writing with agents in Notion") could plausibly work — but easy-notion-mcp is genuinely broad-surface, and positioning it narrowly mis-sells what shipped.
- **Lead outcome wording, not "markdown-first" label**: Per Codex condition (3), the final SKILL.md description must foreground the *buyer payoff* ("write readable Markdown, read back the same conventions") rather than the *label* ("markdown-first"). The label is fine in the body as identity; the description field has to finish the sentence for a scanning reader.

## What I'm uncertain about (see also §7)

- Whether the interface-abstraction axis actually moves ClawHub installs. Install distribution evidence is ambiguous (@steipete's 79.2k suggests brand + boilerplate, not description discrimination).
- Whether we should consider a *dual listing* later (Skill = markdown-first positioning, Plugin = gateway-native) per the plugin track research. Out of scope for this brief; flagged for the next strategy cycle.

---

# 6. Honest-positioning compliance check

Per `CLAUDE.md:13`:

- **No marketing superlatives.** ✅ Recommended description draft uses no "best," "only," "leading," etc.
- **Soften unverifiable comparisons.** ✅ The comparison to the narrow-markdown cluster cites specific competitors by handle + install count; the comparison to the top-10 cites specific entries.
- **Cite real numbers.** ✅ Tool count (28 per `CLAUDE.md:74`), version pin (2025-09-03 per `CLAUDE.md:139`), test count (documented in CI workflow), bench scenarios (13 per `.meta/bench/`). The one-liner deliberately doesn't bake volatile numbers like test counts into the description field — those go in the body.
- **Match measured tone.** ✅ No opposition-defined framing in the recommended wording.

---

# 7. What wasn't investigated, and why

- **Actual SKILL.md body content for all ~65 entries.** I live-fetched 3 listings. The remaining 62 I read only at the scrape description level. Some entries may have richer body content that changes their cluster placement. Risk to the brief: archetype counts may shift if a reader does deeper fetches. Low risk: the clusters are defined by description-level positioning, which is what the buyer sees first anyway.
- **Star-to-install ratio analysis across the full field.** The steipete vs. dimagious gap (234/79.2k vs. 15/11.6k) shows ratio signal; I didn't systematize it. Next strategy cycle could use this to separate "author brand drives installs" from "description drives installs."
- **Live search-result ranking on clawhub.ai/skills?q=notion.** I trusted the scrape's ordering. If ClawHub's in-product ranking weights recency or install velocity, the listing visibility might differ from raw install totals.
- **Plugin track strategy.** `.meta/research/openclaw-plugin-submission-2026-04-24.md` covers this; explicitly out of scope for this brief per task boundary. Dual-listing (Skill + Plugin) is a strategic option flagged there.
- **Outside-ClawHub cross-posting.** The submission research (`openclaw-submission-2026-04-23.md:76-85`) lists 8 other MCP directories (Smithery, PulseMCP, Glama, mcp.so, LobeHub, mcp-get, Composio, Anthropic's list). Positioning for those may differ. Out of scope here.

---

# 8. One uncertainty I couldn't resolve

**Does the ClawHub buyer actually filter on interface abstraction, or does install mass reflect author brand + search-box + install-path convenience?**

The evidence is ambiguous:
- @steipete's 79.2k installs at 234 stars suggest author reputation is a first-order driver. If that's the dominant force, angle A's differentiation ceiling is low — we won't out-@steipete @steipete.
- But @byungkyu's 8.8k at 8 stars suggests positioning (managed OAuth) can break through without big author brand. That's evidence a well-pitched differentiator *can* compound.
- And @lucas-riverbi's 3.6k at 0 stars (Morning Briefing) suggests job-specificity sells even without reputation.

I can't tell from the scrape whether "markdown round-trip as interface" compounds in the byungkyu/lucas-riverbi pattern or stays stuck in the @maweis1981/@fental pattern. The disconfirming test below would resolve this.

---

# 9. Disconfirming test

**If, six months after listing with angle A, easy-notion-mcp has fewer than 500 installs AND @maweis1981/Notion Md is still under 1k installs, the interface-abstraction axis does not move ClawHub installs — and the next strategy cycle should pivot to either (a) a workflow-shaped sub-listing, or (b) focus on outside-ClawHub directories (Smithery, PulseMCP) where buyer profile may differ.**

Specific, observable, and would materially change the recommended angle. If the broader Notion-MCP listing grows above 500 but stays below, say, 2k, that's ambiguous and doesn't invalidate. If it grows past a mid-tier entry like @willykinfoussia (5.2k) on positioning alone, the angle is working.

---

# 10. Session chain

- This brief: drafted by strategy overseer (Claude Opus 4.7, 1M context) in one session.
- Red team: codex session `strategy-redteam-openclaw-positioning` (codex-5.3, reasoning=high) — conditional accept; three conditions integrated (see §1.1 calibration, §3.1 axis justification, §4 Angle A SKILL.md wording discipline).
- Live fetches: clawhub.ai/dimagious/notion-skill, clawhub.ai/steipete/notion, clawhub.ai/maweis1981/notion-md. One attempted fetch (clawhub.ai/byungkyu/notion) returned apparently cached/wrong content; not used as evidence.
- No researcher delegates dispatched (scope was focused enough for a single strategist with local inputs + 3 fetches + 1 red team).

---

# 11. Next step (out of scope for this brief)

Author the SKILL.md for easy-notion-mcp per `.meta/research/openclaw-submission-2026-04-23.md`'s template, using the Angle A wording discipline from §4. Specifically:
- `description` field: outcome-forward ("agents write Markdown, read back the same conventions"), full-surface scope in-sentence, version pin, under ~350 chars.
- Body: lead with the markdown convention table (CLAUDE.md's custom-blocks table, adapted for the agent-reader), follow with the 28-tool surface overview, close with the proof-of-care paragraph (bench + tests + version pin + silent-data-loss audit).
- Do not commit the SKILL.md in the same action as publication; test-publish to ClawHub first with the `clawhub publish --dry-run` path if available (submission research is ambiguous on this; verify at publish time).

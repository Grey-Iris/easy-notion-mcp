# Plan: Add Discord invite to README

**Date:** 2026-04-26
**Initiative:** Add Discord invite (`https://discord.gg/S8cghJSVBU`) to README and adjacent contributor docs.
**Constraint:** Public OSS repo (MIT, npm `easy-notion-mcp`). Match the existing measured tone — no marketing superlatives, honest framing about what the Discord actually is.
**Status:** Plan only. No file edits made.

## Current state summary

`README.md` is a single, well-structured file with a centered header block (lines 1-21) followed by a TOC nav, content sections, and a thin footer. Tone is measured throughout: every comparison cites a method ("Measured by running all three MCP servers..."), security caveats are explicit, and the only existing community-adjacent surface is a 1-line "Contributing" section at the bottom that points to GitHub. There is no Community / Support / Get help section, and no Discord, chat, or community keyword appears anywhere in the repo (verified via grep across `README.md`, `CONTRIBUTING.md`, `package.json`, `docs/`, `.github/`).

Candidate insertion points already in the file:

- **Badge row** — `README.md:10-13` (npm, license, node, Glama). Natural slot for a Discord shields.io badge.
- **Header tagline area** — `README.md:8` (stat line) and `README.md:19` ("See it in action"). High visibility but already dense.
- **Contents nav** — `README.md:27`. Would need a new anchor if a new section is added.
- **FAQ section** — `README.md:432-453`. Could host a "Where can I ask questions?" Q&A.
- **Contributing section** — `README.md:454-456`. Currently one sentence; trivial to expand or precede with a Community section.
- **Footer slot** — between Contributing (`README.md:454`) and License (`README.md:458`). Natural for a small Community block.

CONTRIBUTING.md (`CONTRIBUTING.md:1-50`) currently routes everything to GitHub issues. Issue templates (`bug_report.md`, `feature_request.md`) and `PULL_REQUEST_TEMPLATE.md` make no mention of Discord. `package.json` has no `community`/`discord` field; npm has no standard for one.

## Options

### Option A — Badge-only in the existing header row

Add one Discord badge to the badge row at `README.md:10-13`, between Glama and the `npx` quick-start.

**Exact snippet** (insert as a new line after line 13):

```markdown
[![Discord](https://img.shields.io/badge/discord-join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/S8cghJSVBU)
```

Note: the static-badge form is recommended over the dynamic `https://img.shields.io/discord/<server-id>` form because the dynamic badge requires the Discord server ID (not the invite code) and exposes live member count, which can look thin when the server is new.

**Tradeoff:** Maximum visibility for skimmers, near-zero word count, no risk of pushy copy. But there's nowhere to set honest framing ("mainly for easy-notion-mcp, but it's our company server"), so people might arrive expecting a dedicated 1k-member project Discord.

### Option B — "Community" section near the footer, no badge

Add a new section above Contributing (`README.md:454`), and add an entry to the Contents nav (`README.md:27`).

**Exact snippet** (insert before `## Contributing` at `README.md:454`):

```markdown
## Community

There's a Discord for easy-notion-mcp users and contributors: **[discord.gg/S8cghJSVBU](https://discord.gg/S8cghJSVBU)**. It's the Grey-Iris company server, with easy-notion-mcp as the main topic — a good place for setup questions, design discussions, or sharing how you're using it. For bugs and concrete feature requests, [GitHub issues](https://github.com/Grey-Iris/easy-notion-mcp/issues) are still the canonical channel.

```

And update the Contents nav at `README.md:27` to append `· [Community](#community)` before `· [FAQ](#frequently-asked-questions)`. (Or place after FAQ, which keeps the nav reading task-first then community-last; see Recommendation.)

**Tradeoff:** Lower visibility (footer-zone), but the section can carry honest framing about what the Discord is and which channel handles which kind of request. Matches the measured tone: it doesn't push, it informs.

### Option C — Hybrid: small badge + short Community section (recommended)

Both surfaces. Badge in the header (Option A snippet) provides discovery for skimmers; the Community section (Option B snippet) provides framing for people who actually want to engage. This is the pattern Tailwind, tRPC, Astro, and Continue.dev use.

**Exact additions:**

1. Badge in header — same as Option A, inserted after `README.md:13`.
2. Community section — same as Option B, inserted before `README.md:454` `## Contributing`.
3. Contents nav update at `README.md:27`:
   - Current end: `· [Security](#what-about-security-and-prompt-injection) · [FAQ](#frequently-asked-questions)`
   - Updated end: `· [Security](#what-about-security-and-prompt-injection) · [FAQ](#frequently-asked-questions) · [Community](#community)`

**Tradeoff:** Two surfaces means two risks — badge could look spammy in an otherwise restrained header, and section adds ~60 words to the file. Mitigation: the static-badge style is visually quiet (single color, no animated count), and the section is short and honest. Net: best balance of visibility and tone-fit.

## Recommendation

**Option C (hybrid).** The badge serves the discovery audience (people who scan headers for "is this project alive, where do I get help"), and the Community section serves the engagement audience (people who decide to click through and want to know what they're joining). Together they match well-run OSS conventions without overselling — and the honest framing ("Grey-Iris company server, with easy-notion-mcp as the main topic") avoids the disappointment vector of arriving at a quiet server expecting a bustling one. If James prefers a single surface, fall back to Option B over Option A: framing matters more than visibility for a server that's deliberately scoped.

## Cross-reference list

Keep the PR scoped. Recommended additional touches:

- **`CONTRIBUTING.md`** — add a one-line entry under "Before you start" pointing open-ended questions to Discord. Reason: today the file routes everything to issues, which is fine for bugs but heavy for "what's the right way to model X" questions. One line, no restructuring.
  - Suggested copy (insert as item 3, renumbering current items 3→4):
    `3. For open-ended questions or design discussions, ask in [Discord](https://discord.gg/S8cghJSVBU) before opening an issue`

Recommended **not** to touch in this PR:

- **Issue templates** (`.github/ISSUE_TEMPLATE/*.md`) — issues should remain the canonical bug/feature path. Routing bug reporters to Discord first creates friction and loses the public, searchable record. Skip.
- **`PULL_REQUEST_TEMPLATE.md`** — no obvious Discord touchpoint in the PR flow. Skip.
- **`package.json`** — npm has no standard `community`/`discord`/`chat` field. The `homepage` field already points to the GitHub repo. Adding Discord here would require a `package.json` deps-rule waiver per `CONTRIBUTING.md:24-29` for marginal gain. Skip.
- **`docs/token-benchmark-results.md`** — scope-irrelevant. Skip.

## Open questions for James

1. **Vanity URL or invite code?** Current link is the raw invite code `discord.gg/S8cghJSVBU`. Vanity URLs (`discord.gg/grey-iris` or `/easy-notion-mcp`) are more memorable and survive invite regeneration, but require Discord server boost level 3 (14 boosts). Worth doing now or stay on the invite code?
2. **Is the invite permanent + unlimited uses?** Default Discord invites expire after 7 days and have a 100-use cap. The README link should point to a "Never expire / no max uses" invite. Confirm or regenerate before merge.
3. **Channel structure inside the server.** The recommended copy says the Discord has "easy-notion-mcp as the main topic." If there's a dedicated `#easy-notion-mcp` channel vs. a general space, the framing could be sharper ("Join the `#easy-notion-mcp` channel in our company Discord"). What exists today?
4. **Badge yes/no?** Option C assumes yes. If the static badge feels off-tone in the existing measured header, fall back to Option B (Community section only). Aesthetic call.
5. **CONTRIBUTING.md change yes/no?** Adding "ask in Discord before opening an issue" for open-ended questions is a soft routing change — it shifts the default first-contact for design discussions away from issues. Want that, or keep issues as the single canonical entry point?
6. **Server name in copy.** Recommended copy says "Grey-Iris company server." If you'd prefer a different framing ("the Grey-Iris Discord" / "our Discord" / "the Discord we run"), flag it — easy to swap during build.

---

## Notes for the orchestrator

- **Codex pressure-test skipped.** Per planner-PM defaults, a Codex plan review is load-bearing. For this scope (3 lines of markdown placement, 1 line of CONTRIBUTING.md, 1 nav entry), the architectural risk is effectively zero and a Codex consult would be ceremonial. Flagging the skip explicitly so this is a visible choice, not a silent omission. Override and request Codex review if you want one.
- **No external doc verification required.** Discord invite link semantics, shields.io badge URL format, and npm `package.json` schema were all answered from in-context knowledge; nothing in the recommendation depends on a moving API surface.
- **PR scope estimate.** Recommended scope = 1 README block edit + 1 nav entry + 1 CONTRIBUTING.md line. Single small PR, single reviewer pass. No tests required.

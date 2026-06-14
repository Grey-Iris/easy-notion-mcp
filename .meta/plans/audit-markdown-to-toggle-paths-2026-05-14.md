# Audit brief: how do agents write markdown into a Notion toggle?

## Role

You are the **audit** role for this task. Read `.claude/agents/audit.md` (or the workflow-v2 audit role prompt) before starting. The canonical audit workflow includes a Codex pressure-test on your findings — run it. Don't skip it; the orchestrator wants the independent review.

You are **not** changing product code in this audit. The deliverable is an audit document with findings and recommendations. A follow-up build dispatch may act on those recommendations later; this audit is the input to that decision.

## Concrete user report

A teammate used their Claude session to write three markdown files into three Notion toggles in the same page (one markdown file per toggle). The intent was: the markdown should render as proper Notion blocks inside each toggle — headings as headings, bullets as bullets, paragraphs as paragraphs, etc.

Two failure modes were observed on consecutive attempts:

1. **First attempt: content rendered as a code block.** The whole markdown body landed inside a single `code` block in Notion (verbatim text with monospace styling), instead of being parsed into structured blocks.
2. **Second attempt: content rendered as non-parsed plaintext.** The markdown body landed as plain text/paragraph(s), with the markdown syntax characters (`#`, `-`, `**`) visible literally, not rendered.

Neither was what she wanted. The desired outcome is **markdown parsed into Notion blocks**, the same way `create_page` handles the `content` parameter.

We do not currently know which specific MCP tool their Claude called for each attempt. The audit should enumerate the candidate paths and identify which two (or more) most plausibly produced these two failure modes.

## What to investigate

### 1. Enumerate the candidate paths

For each MCP tool an agent could plausibly reach for to "write markdown content into an existing Notion toggle," document:

- Tool name (`update_toggle`, `append_content`, `replace_content`, `find_replace`, `update_block`, `update_section`, etc. — be thorough; check `src/server.ts` for the full tool surface)
- The parameter that accepts the user's content
- Type and contract: what does the parameter expect — markdown string, plain text, blocks, something else?
- The internal conversion pipeline the content goes through (e.g., markdown-to-blocks via `marked` and `markdown-to-blocks.ts`, native `pages.updateMarkdown` Enhanced Markdown via `markdown-to-enhanced.ts`, raw string substitution, etc.)
- The end-state in Notion (structured blocks vs single code block vs paragraph text)

Reference CLAUDE.md "Architecture" and the markdown conventions table for the two distinct conversion dialects (our GFM-with-extensions vs Notion native Enhanced Markdown). The `learnings.md` rule `6f7d4e` is load-bearing here.

### 2. Pinpoint the failure modes

For each observed failure mode, identify the most plausible tool/parameter combo that produced it:

- **Code-block rendering:** which tool, when fed a markdown string, would land it as a single Notion `code` block? Two plausible mechanisms: (a) the agent literally wrapped the markdown in triple-backticks before calling the tool, treating it as code; (b) the tool's internal pipeline has a bug or contract mismatch that turns markdown into a code block.
- **Plaintext (markdown not parsed):** which tool, when fed a markdown string, would land it as paragraph text with `#`/`-`/`**` literal? Plausible mechanisms: (a) the tool's parameter is documented as plain text, not markdown, but the agent passed markdown anyway; (b) the tool routes through native `pages.updateMarkdown` (Enhanced Markdown dialect) and GFM extensions don't parse, leaving them as text — but standard markdown (`#`, `-`, `**`) should still parse via the native API, so this would be a partial-parse failure not a full plaintext failure; (c) some other contract mismatch.

For each, write the audit theory: "Tool X, parameter Y, called with content Z, produces failure mode F because of pipeline step P." Cite file:line evidence in `src/`.

### 3. Reproduce with runtime evidence

Build-time analysis is necessary but not sufficient. For your top-2 most-plausible-culprit paths for each failure mode, actually call the tool against a live Notion toggle and inspect what shows up.

Setup:
- The `easy-notion-http` server is running at `http://127.0.0.1:3333` (port 3333, bearer token in `.env.http`). Use the `easy-notion-http` MCP tools the dispatched session has available.
- Use the `E2E_ROOT_PAGE_ID` from `.env` (source it explicitly per RULE 9929ab: `set -a && . ./.env && set +a`) as the parent for any test pages you create.
- Create one test page with three toggles. Write a small markdown snippet into each via different tools/paths. Read back to verify.
- Markdown snippet to use (covers the common cases):
  ```
  ## Heading 2

  Some paragraph text with **bold** and *italic* and `inline code`.

  - Bullet one
  - Bullet two
    - Nested bullet

  1. Numbered one
  2. Numbered two

  > A blockquote.

  ```
  fenced code block
  ```
  ```
- For each path, capture: tool called, parameters passed, response, then `read_toggle` to see what landed in Notion. Note whether it rendered as proper blocks, code block, or plaintext.
- Clean up test pages on success (archive them).

This will likely surface the actual tool the co-founder's Claude used, even without her logs.

### 4. Recommend ergonomic improvements

The framing James gave: "I want to make sure the paths here are as easy and simple as possible." Recommendations should target this. Examples of the shape:

- **Tool description fixes** — if a tool's description doesn't make the markdown-vs-plaintext contract obvious, propose a tighter description.
- **Parameter naming** — `content` vs `markdown` vs `text` matters for agent intuition.
- **The "happy path"** — what's the canonical tool an agent should reach for to write markdown into a toggle? Is it currently obvious? If not, what makes it obvious (description, alias, README example, etc.)?
- **Footguns to flag** — paths that look right but produce wrong output (e.g., `find_replace` with markdown content hits the native Enhanced Markdown dialect, not our GFM).
- **Missing convenience** — is there a tool gap? Should `update_toggle(toggle_id, markdown)` exist as a first-class operation if it doesn't already? Or does an existing tool cover this but with a non-obvious name?

Each recommendation should be: concrete, file-locatable (which file would change), and tied to whichever failure mode evidence it addresses.

## Deliverable

Write the audit to `.meta/audits/markdown-to-toggle-paths-audit-2026-05-14.md`. Commit on `dev` with a focused message (e.g., `docs: audit markdown-to-toggle paths after user report`). One commit, one file (or two if you write a separate plan).

The audit document should have these sections:

1. **Summary** — 2-3 sentences: what we found, top recommendation.
2. **The failure report** — recap, with any nuance you uncover during investigation.
3. **Enumerated paths** — the full surface of tools that could write markdown into a toggle, with conversion-pipeline details.
4. **Failure mode pinpointing** — which path produced each observed failure, with file:line evidence and runtime confirmation.
5. **Recommendations** — concrete, ordered by leverage. Each recommendation cites which file(s) would change and which failure mode it addresses.
6. **Out of scope** — what this audit did NOT cover, so a future agent knows.

## Codex pressure-test

Run the canonical audit Codex review on your findings before committing. The Codex review should specifically:

- Stress-test your failure-mode theories: are there alternative explanations you missed?
- Check whether your runtime evidence actually proves what you think it does (e.g., did your code-block reproduction case actually depend on the tool's pipeline, or was your agent wrapping markdown in fences before calling?).
- Validate that each recommendation is grounded in evidence, not just intuition.
- Surface anything you got wrong.

Reflect Codex's findings into the final audit. If Codex disagrees substantively, surface that disagreement in the audit (e.g., in a "Codex pressure-test notes" subsection) rather than silently overriding.

## Evidence to return

1. Commit SHA of the audit doc.
2. Bullet-summary of findings (so the orchestrator doesn't have to read the whole audit to know the headline).
3. The Codex session ID so the orchestrator can verify the pressure-test happened.
4. List of any test pages you created that you couldn't clean up (so the orchestrator can sweep them).

## Constraints

- **Read-only audit.** No changes to product code. You may write the audit doc, the plan doc, and commit those.
- **Live Notion calls are okay** but must use the `E2E_ROOT_PAGE_ID` sandbox parent. Do not create pages outside the sandbox. Clean up on success.
- **Source `.env` explicitly** before any live calls — `set -a && . ./.env && set +a` (per RULE 9929ab). Don't assume your shell has the env.
- **Tasuku CLI quirks:** if you file tasks for follow-up build work, use `tk task add <description>` (positional, not `--description`); `tk decision add` uses `--id --chose --over --because`.
- **No em dashes if quoting James** in the audit prose; otherwise em dashes are fine (audit's own voice).

## Context files

- `/mnt/d/backup/projects/personal/mcp-notion/CLAUDE.md` — architecture, markdown conventions, key decisions, learnings location.
- `/mnt/d/backup/projects/personal/mcp-notion/src/server.ts` — tool surface and descriptions.
- `/mnt/d/backup/projects/personal/mcp-notion/src/markdown-to-blocks.ts` — our GFM-with-extensions conversion.
- `/mnt/d/backup/projects/personal/mcp-notion/src/markdown-to-enhanced.ts` — GFM-to-Enhanced-Markdown translator (for native API path).
- `/mnt/d/backup/projects/personal/mcp-notion/src/notion-client.ts` — SDK wrappers.
- `.claude/rules/tasuku/learnings.md` — especially RULE `6f7d4e` (the two markdown dialects).

Anti-patterns:

- Don't speculate without runtime evidence. If you can't reproduce the failure mode against a real Notion toggle, mark that failure mode as "theory only, unverified."
- Don't recommend changes that would break existing contracts (e.g., renaming a public tool parameter) without explicitly flagging the breaking-change cost.
- Don't expand scope. "Write markdown into a toggle" is the case. Don't audit "write markdown into pages generally" unless directly relevant.

# Exploration brief: right-to-left language support in easy-notion-mcp

## Role

You are the **explorer** role. Read `.claude/agents/explorer.md` (or the workflow-v2 explorer role prompt) before starting.

The job is to **map the landscape**, not to ship a fix. The deliverable is a research note answering "where do we stand on RTL today, what would full support look like, and approximately how big is the change?" Direction is unclear; output is a map plus a change-size estimate.

The canonical explorer workflow includes a Codex pressure-test on your findings — run it. The PM manages Codex internally for the pressure-test step. Do not skip it; the orchestrator wants the independent review.

## Question James asked

> "Does our MCP work with right-to-left languages at all? Ascertain approximately how big of a change this would be."

Interpret broadly. RTL languages = Arabic, Hebrew, Persian, Urdu (Aljamiado-class scripts plus Mizrahi/Sephardic Hebrew variants), plus Syriac, N'Ko, Thaana, etc. The dominant practical cases are Arabic and Hebrew. "Work with" spans: do the tools accept RTL input intact, does Notion render it correctly, are there edge cases that break (rich-text splitting, find/replace, BiDi controls, combining marks), and what's missing that a serious RTL user would want.

## Scope

### In scope

1. **Current behavior assessment.** What actually happens today when an agent writes RTL content through our tools? Land RTL strings via the canonical tools and read back. Use Arabic, Hebrew, and at least one mixed LTR/RTL paragraph.
2. **Codebase grep for risk classes.** Every place we do text manipulation that could be charset-, grapheme-, or direction-sensitive:
   - Rich-text length splitting (RULE 940c04 — does the splitter respect grapheme boundaries, or could it cut between an Arabic letter and a joining mark, between a Hebrew letter and a niqqud point, between a base codepoint and combining accents?)
   - `find_replace` string substitution (does it work for RTL? Are there gotchas with LRM/RLM/embedding marks or with grapheme clusters?)
   - Any substring/slicing operations in `markdown-to-blocks.ts`, `blocks-to-markdown.ts`, `markdown-to-enhanced.ts`, `notion-client.ts`
   - Anywhere we count characters for limits (Notion has a 2000-char rich-text segment limit; check whether we're counting code units, codepoints, or graphemes)
3. **Notion API surface for RTL.** Does Notion's API expose direction-related fields at block, rich_text, or page level? What does Notion's own UI use? Read the SDK types and any relevant Notion API docs you can find. Identify whether there's a `direction` or `lang` field we should be passing through but aren't.
4. **The `find_replace` BiDi edge case.** RTL text often contains explicit BiDi control characters (LRM U+200E, RLM U+200F, LRE U+202A, RLE U+202B, PDF U+202C, etc.) or implicit ones from text editors. Does our `find_replace` match correctly across these?
5. **Change-size estimate per recommended fix.** Bucket each recommendation into:
   - **XS** — description/docs change only, ~1 hour
   - **S** — single tool's pipeline, <1 day
   - **M** — cross-cutting helper + tests, 1-3 days
   - **L** — architectural or multi-tool reshape, 1-2 weeks
   - **XL** — broad rework with API contract implications, multi-week

   For each bucket assignment, justify with rough file/line surface area.

### Out of scope

- Don't change product code. Recommendations only.
- Don't audit CI/release/infrastructure for RTL.
- Don't try to support every minority RTL script. Arabic and Hebrew cover the practical cases.
- Don't recommend changes to Notion's own behavior — we can only change what's on our side.

## Runtime evidence requirement

Build-time analysis is necessary but not sufficient per CLAUDE.md's runtime-evidence rule.

For at least the following cases, actually call the tools against a live Notion test page and read back:

1. **Pure Arabic content** through `create_page` (markdown body containing headings, bullets, a paragraph with bold and italic, a code block) — does it land and read back correctly?
2. **Pure Hebrew content** through the same canonical path.
3. **Mixed LTR/RTL content** (one sentence in English, one in Arabic, in the same paragraph). Does Notion's BiDi rendering look right when you read the page in the UI? Check whether `read_page` returns the text in logical order or visual order.
4. **A long RTL paragraph that crosses the 2000-character rich-text segment limit.** Construct one (concatenate a Hebrew or Arabic snippet repeatedly until over 2000 chars), write via `update_toggle` or `append_content`, read back, and inspect whether characters at the split boundary are mangled. This is the highest-risk test.
5. **`find_replace` against RTL text** — write some Hebrew, then run `find_replace` to swap a substring inside it. Does it match correctly? Test with text that contains LRM/RLM marks if your editor inserts them automatically.

Setup:
- Server `easy-notion-http` is running at `http://127.0.0.1:3333` (bearer in `.env.http`).
- Source `.env` explicitly per RULE 9929ab: `set -a && . ./.env && set +a`.
- Use `E2E_ROOT_PAGE_ID` as the sandbox parent for any test pages.
- Archive test pages on success.

## Deliverable

Write to `.meta/research/rtl-language-support-2026-05-20.md`. Commit on `dev` with a focused message (e.g., `docs: explore RTL language support and change-size estimate`). The `.meta/research/` directory has a 90-day shelf life per CLAUDE.md — if this note is going to drive build work, link it from a tasuku task so it survives.

Sections:

1. **TL;DR** — 3 sentences. Does it work today? What's broken? Total ballpark to make it solid (sum of bucket sizes).
2. **Current state** — concrete: what works runtime-verified, what's untested but likely works, what's broken.
3. **Risk inventory** — each identified risk (text splitting, BiDi controls, find_replace, direction fields, etc.), with severity (P0/P1/P2) and concrete reproduction notes.
4. **Recommended changes** — ordered by leverage, each with: file(s) that would change, bucket size estimate, justification, and whether it's a prerequisite for other items.
5. **Open questions** — what you couldn't determine without product/contributor decisions or external research.
6. **Codex pressure-test notes** — Codex session ID + summary of where it pushed back and how the document changed.

## Constraints

- **Read-only.** No changes to product code.
- **Live Notion calls okay** but use `E2E_ROOT_PAGE_ID` sandbox; clean up.
- **No em dashes if quoting James** in the research prose; otherwise the document's own voice is fine.
- **Don't expand scope.** If you uncover a non-RTL bug, file a tasuku task with `tk task add <description>` (positional arg, not `--description`); don't fold it into this exploration.

## Context files

- `/mnt/d/backup/projects/personal/mcp-notion/CLAUDE.md` — architecture, markdown conventions, the runtime-evidence rule, the research lifecycle rule.
- `/mnt/d/backup/projects/personal/mcp-notion/src/notion-client.ts` — SDK wrappers, likely site of rich-text length handling.
- `/mnt/d/backup/projects/personal/mcp-notion/src/markdown-to-blocks.ts` and `markdown-to-enhanced.ts` — text conversion pipelines.
- `.claude/rules/tasuku/learnings.md` — RULE 940c04 on rich-text sanitization, RULE 5ae0ce on nesting, RULE 9929ab on `.env` sourcing.

## Evidence to return

1. Commit SHA of the research doc.
2. TL;DR pasted in the return message so the orchestrator doesn't have to read the whole doc to know the headline.
3. Codex session ID.
4. List of test pages created and whether they were archived.

## Anti-patterns

- Don't theorize without runtime evidence for high-risk claims (especially the rich-text splitter and find_replace cases).
- Don't recommend "ship full RTL support" without bucketing the work — James asked for change-size; vague answers don't help him plan.
- Don't conflate "works in our pipeline" with "renders correctly in Notion's UI." Verify the latter for any visual-correctness claim, or mark it as "needs UI verification."
- Don't overclaim "RTL is fully supported" if you only tested Arabic and Hebrew — other RTL scripts have their own quirks (e.g., N'Ko, Thaana). Bound your claims to what you actually tested.

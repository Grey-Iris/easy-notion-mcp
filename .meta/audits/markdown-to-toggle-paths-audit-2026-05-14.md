# Audit: markdown-to-toggle paths

Date: 2026-05-16
Server version: easy-notion-mcp v0.9.3 (HEAD `9d758a3`)
Audit role: audit-PM (subprocess) + Codex pressure-test
Codex session: `audit-md-toggle-2026-05-16` (id `019e3323-ead1-7950-a3ed-bc729c0f6eed`)
Test page (archived after audit): `362be876-242f-81af-a14b-eff1ffec7028`

## 1. Summary

For writing markdown into an existing Notion toggle on v0.9.3, the canonical
path is `update_toggle(page_id, title, markdown)`. It parses through our
GFM-with-extensions pipeline and lands as structured Notion blocks. The two
failure modes a user reported (markdown landing as a single code block, or as
plaintext with markdown syntax visible) map most cleanly to (Mode 1) the
agent's markdown body parsing as a Markdown `code` block — either because it
was triple-backtick-fenced or four-space-indented before reaching
`markdownToBlocks` — and (Mode 2) `find_replace` being used to insert
markdown whose **custom GFM extensions** (`+++`, `:::`, `> [!NOTE]`, `[toc]`,
`$$…$$`, bare-URL bookmarks) bypass our GFM parser and land literally because
the underlying `pages.updateMarkdown` endpoint uses Notion's Enhanced
Markdown dialect, which does not recognize them. Top recommendation: keep
`update_toggle` as the named happy path and tighten the descriptions of
`update_toggle`, `find_replace`, and the `markdown` parameter so the
"please send raw markdown, do not wrap in fences" contract is unmissable.

## 2. The failure report (recap, with audit nuance)

The reported observations:

- **Mode 1:** the markdown body landed inside a single Notion `code` block
  (verbatim text, monospace styling).
- **Mode 2:** the markdown body landed as paragraph/plain text with `#`, `-`,
  and `**` visible literally.

Three nuances we surfaced during the audit:

1. We do not have the actual tool-call transcript (no MCP logs from the
   teammate's session), so the "which tool produced which mode" answer is
   inferred from reproduction, not direct evidence.
2. The Mode 2 description (`#`, `-`, `**` literal) is harder to reproduce in
   this server than Mode 1. In our tests, `find_replace` with **standard**
   markdown (heading/bullet/bold) actually rendered as proper structured
   blocks via Notion's native API; only our **custom GFM extensions**
   reliably landed as literal text. If the teammate's source files had a mix
   of standard markdown and extensions, the broken-looking extension lines
   are the most likely thing she described as "markdown not parsed." A
   wholly-standard-markdown Mode 2 against this server is not currently
   reproducible — see §6 Out of scope.
3. The teammate may have been on an older easy-notion-mcp version, or on a
   different Notion MCP server entirely (e.g. the official mcp.notion.com).
   We cannot audit either path from here; both stay in §6.

## 3. Enumerated paths

The full tool surface that an agent could plausibly use to "write markdown
into a Notion toggle" on v0.9.3. Every entry below was traced from
`src/server.ts` to its conversion pipeline.

### 3.1 `update_toggle(page_id, title, markdown)` — canonical happy path

- Parameter accepting content: `markdown` (string, GFM-with-extensions).
- Pipeline: `src/server.ts:2717-2774` → `markdownToBlocks(inputMarkdown)`
  (our `marked`-based GFM parser, `src/markdown-to-blocks.ts`) →
  `replacementToggleBodyBlocks` (drops a wrapper `+++` toggle if it matches
  the target title) → `deleteBlock` each existing child → `appendBlocks(notion,
  toggle.id, replacement)`.
- End state in Notion: structured blocks as children of the matched toggle.
- Failure modes possible from this path:
  - **Mode 1** if the markdown body is parseable as a Markdown code block
    (triple-backtick fenced *or* four-space-indented). `marked` returns a
    single `code` token, the converter writes a single `code` block, and the
    toggle body becomes that one code block.

### 3.2 `update_block(block_id, markdown)` — single-block surgical edit

- Parameter: `markdown` (must parse to **exactly one** block of the same type
  as the existing block).
- Pipeline: `src/server.ts:2822-…` → `markdownToBlocks` →
  `buildUpdateBlockPayload(parsed, existingType)` (`src/server.ts:613-723`).
  Multi-block input rejected with a clear error
  (`src/server.ts:621-626`); type-mismatch input rejected
  (`src/server.ts:629-633`).
- End state if the agent calls this on a toggle's `block_id` with a multi-block
  markdown body: error returned, nothing written.
- Failure modes possible from this path: none silent. Either it succeeds for a
  single same-type block (which would not match Mode 1 or Mode 2 shapes) or
  it errors.

### 3.3 `append_content(page_id, markdown)` — append to a parent

- Parameter: `markdown` (GFM-with-extensions).
- Pipeline: `src/server.ts:2371-2376` → `markdownToBlocks` → `appendBlocks(notion,
  page_id, ...)`. Implementation passes `page_id` straight to
  `notion.blocks.children.append({ block_id: page_id, … })`, which Notion
  accepts for any block ID, not only page IDs.
- End state if `page_id` is actually a toggle block's ID: the markdown is
  parsed and appended as children of that toggle. Functionally a valid
  "write into a toggle" path, just under a non-obvious name.
- Failure modes from this path:
  - **Mode 1** under the same conditions as `update_toggle` — if the body is
    fenced/indented as code, it appends one code block.
  - No append vs replace nuance for empty toggles, but for non-empty toggles
    this *appends* rather than replacing, so the deletion/replacement
    semantics the user observed do not fit `append_content`.

### 3.4 `replace_content(page_id, markdown)` — atomic whole-page replace

- Parameter: `markdown` (GFM-with-extensions; translated to Enhanced
  Markdown before send).
- Pipeline: `src/server.ts:2377-2411` → `translateGfmToEnhancedMarkdown(...)`
  (`src/markdown-to-enhanced.ts`) → `pages.updateMarkdown({ type: "replace",
  …})` via the Notion SDK.
- End state if `page_id` is actually a toggle block's ID: Notion returns
  `"Provided ID is a block, not a page."` (verified live). Clear error.
- Failure modes: none for the toggle use case — replace_content does not
  target toggles, and giving it one errors out.

### 3.5 `update_section(page_id, heading, markdown)` — heading-bounded replace

- Parameter: `markdown` (GFM-with-extensions). Operates on a **heading**, not
  a toggle, unless the heading itself is toggleable (`heading_n.is_toggleable
  = true`).
- Pipeline: `src/server.ts:2412-…` → `markdownToBlocks` → destructive
  delete-then-append within the heading-bounded range. For toggleable
  headings, the new body is appended as children of the heading block.
- Failure modes possible from this path:
  - **Mode 1** under the same code-block-parses rule as `update_toggle` and
    `append_content`. Same root cause: `markdownToBlocks`'s output.

### 3.6 `find_replace(page_id, find, replace)` — text substitution

- Parameters: `find` and `replace` are **strings**, not markdown. The tool
  description says "Find and replace text on a page."
- Pipeline: `src/server.ts:2671-2716` → `pages.updateMarkdown({ type:
  "update_content", update_content: { content_updates: [{ old_str, new_str }]}})`
  via the Notion SDK. No call to `translateGfmToEnhancedMarkdown`. The
  underlying endpoint is the same Enhanced Markdown endpoint, but
  substitution happens against the *rendered* page, not against authoring
  syntax (see `.claude/rules/tasuku/learnings.md` Rule 12).
- End state if the agent passes a markdown body as `replace`:
  - Standard markdown elements (`#`, `-`, `**`, blockquote, fenced code)
    parse correctly via the native Enhanced Markdown parser. Verified live
    on this audit's test page.
  - **This server's custom GFM extensions** (`+++ Toggle`, `::: columns`,
    `> [!NOTE]`, `[toc]`, `$$…$$`, bare-URL bookmarks) land as literal
    paragraph text. Verified live: `:::columns`, `:::column`, `:::`, and
    `> [!NOTE]` all appeared as visible text in Notion.
- Failure modes possible from this path:
  - **Mode 2** when the replacement body contains any of our GFM extensions
    listed above. The lines containing extension syntax render literally.

### 3.7 Other tools considered and ruled out for the toggle use case

- `create_page` and `create_page_from_file` — create a new page, not write
  into an existing toggle. Same Mode 1 fenced/indented-code class applies to
  the body, but the user's case explicitly involved existing toggles.
- `add_comment` — produces a comment, not toggle body content. Uses inline
  rich-text conversion (`blockTextToRichText`, no block parsing). Possible
  source of literal-text confusion if the teammate's content showed up as a
  comment thread, but the report says "inside each toggle."
- `update_page`, `update_database_entry` — properties, not body.
- `update_data_source` — database schema, not page body.

## 4. Failure-mode pinpointing (with runtime evidence)

All reproductions were run live against test page
`362be876-242f-81af-a14b-eff1ffec7028` under `E2E_ROOT_PAGE_ID`. The page is
archived at end of audit.

### Mode 1 — single code block

**Most plausible culprit:** any call into the GFM pipeline
(`update_toggle`, `update_section`, `append_content`, `create_page`) where
the markdown body is parseable as a Markdown code block.

Two concrete sub-mechanisms, both verified:

1. **Triple-backtick wrap.** Agent treats "I am sending a markdown document"
   as "I should wrap it in a fence."
   - Call: `update_toggle(..., markdown="\`\`\`markdown\n## H2\n\n- bullet\n…\n\`\`\`")`.
   - Server response: `appended:1`.
   - Toggle body in Notion: one `code` block, language `markdown`, verbatim
     content. Matches Mode 1 exactly.
   - Code path: `src/server.ts:2742` → `markdownToBlocks` → `marked` parses
     the outer ``` fence as `code` → one `code` block.
2. **Four-space indentation.** Agent emits a markdown body that happens to be
   indented (heredoc with leading whitespace, copy/paste from a table cell,
   `prettier`-style indented block).
   - Call: `update_toggle(..., markdown="    ## Heading 2\n\n    - Bullet one\n…")`.
   - Server response: `appended:1`.
   - Toggle body in Notion: one `code` block, no language tag, verbatim
     content. Matches Mode 1.

There is **no** internal fallback path in `markdownToBlocks` that converts
"unparseable markdown" into a code block — unknown tokens are dropped, normal
text becomes paragraphs (Codex pressure-test confirmed). So Mode 1 always
traces back to the input itself being valid Markdown code syntax by the time
`marked` sees it.

### Mode 2 — literal markdown syntax

**Most plausible culprit:** `find_replace(page_id, find, replace)` where the
`replace` body contains this server's custom GFM extensions.

Verified live:

- Call: `find_replace(..., find="SENTINEL", replace=<body containing `:::
  columns`, `:::column`, `> [!NOTE]`, plus standard markdown>)`.
- Server response: `match_count:1`.
- Toggle body in Notion: standard markdown (`## Heading 2`, bullets) parsed
  correctly; `:::columns`, `:::column`, `:::`, and `> [!NOTE]` lines landed
  as literal paragraph text. Round-trip read shows the extension syntax as
  text.

**Limit of the evidence.** The user described `#`, `-`, `**` as the
literally-visible characters. Those are standard markdown that **does** parse
via the Enhanced Markdown endpoint in our tests, so `find_replace` alone does
not explain a wholly-standard-markdown Mode 2. The most likely combinations,
in order:

1. The teammate's source files contained at least some custom-extension
   syntax (our `+++`, `:::`, `> [!NOTE]` are documented as the project's
   markdown conventions and would naturally appear in dogfooded files). The
   extensions stood out as "broken" and got described in shorthand as
   "markdown not parsed."
2. The teammate was on a **different MCP server** (mcp.notion.com or
   similar) whose tool surface produces different failure modes that look
   superficially like ours.
3. The teammate was on an **older easy-notion-mcp** that predated
   `update_toggle` (added in ~v0.8.0) and her Claude reached for a path that
   does not exist on current main.

`update_block` on a paragraph block can preserve literal characters in
narrow cases (escaped `\#`, malformed input), but it cannot silently turn a
full markdown document into literal text — multi-block input is rejected
(`src/server.ts:621-626`).

## 5. Recommendations (ordered by leverage)

Each recommendation cites the file(s) that would change and the failure mode
it addresses. None require touching product code outside descriptions and
docs unless explicitly noted.

### R1. Tighten `update_toggle`'s description so "do not wrap in fences" is unmissable

**Addresses:** Mode 1.
**File:** `src/server.ts:1666-1668` (the `update_toggle` description string).
**Shape:** Add a sentence to the description: *"Pass raw markdown for the
toggle body. Do NOT wrap the body in triple-backtick fences or indent every
line by four spaces — both make the body parse as a single code block."*
This is a docstring change, no behavior change, no contract break.

### R2. Make `find_replace`'s "this is plain text, not markdown" contract explicit, and warn about GFM extensions

**Addresses:** Mode 2.
**File:** `src/server.ts:1602-1614` (the `find_replace` description and
parameter descriptions).
**Shape:** Tighten the tool description: *"For typo fixes, URL updates,
single-word renames. Both `find` and `replace` are plain strings, NOT
markdown. Inserting this server's custom syntax (`+++`, `:::`, `> [!NOTE]`,
`[toc]`, `$$…$$`) via `replace` will land as literal text — use
`update_toggle`, `update_section`, or `replace_content` to author those."*
Tighten the `replace` parameter description from `"Replacement text"` to
`"Replacement text (plain string, not markdown)"`. No behavior change.

### R3. Surface `update_toggle` as the obvious answer to "write into a toggle"

**Addresses:** Mode 1 indirectly (by reducing reach for the wrong tool).
**Files:** `README.md` and/or `src/server.ts:223-265` (the `markdown-conventions`
resource description).
**Shape:** Add a small "How do I…" section to the README with one line per
common operation:

> - **Write into an existing toggle** → `update_toggle(page_id, title, markdown)`
> - **Append to an existing page** → `append_content(page_id, markdown)`
> - **Replace whole page** → `replace_content(page_id, markdown)`
> - **Edit one block in place** → `update_block(block_id, markdown)`
> - **Text-substitute (typo fix)** → `find_replace(page_id, find, replace)`

Cross-links per use case are cheaper for agents than reading 40 tool
descriptions.

### R4. Consider returning a non-fatal `warnings` entry from `update_toggle` when the resulting body is one code block

**Addresses:** Mode 1 detection (not prevention).
**File:** `src/server.ts:2717-2774`.
**Shape:** After `markdownToBlocks` returns, if `replacementBlocks.length === 1`
and `replacementBlocks[0].type === "code"` and the original `markdown`
parameter starts with `\`\`\`` or contains a 4-space indent on the first
non-blank line, emit a warning like
`{ code: "body_parsed_as_code_block", hint: "Markdown body was parsed as a
single code block. If that was not intended, remove the outer triple-backtick
fence or de-indent the body." }`. This is a non-breaking addition (we already
return optional `warnings` arrays per CLAUDE.md). The agent gets a visible
hint instead of a silent miss.

### R5. (Lower-priority) audit other GFM-pipeline tools (`append_content`, `update_section`, `create_page`) for the same Mode 1 hint

**Addresses:** Mode 1 across all `markdownToBlocks` callers, not only
`update_toggle`.
**Files:** `src/server.ts:2371-2410`, `src/server.ts:2412-2670`,
`src/server.ts:2210-2370` for `create_page`.
**Shape:** Same heuristic as R4, factored into a shared helper. Decide
whether the warning is worth the noise per tool. Lower priority because
those tools are less likely to be reached for the "write into a toggle"
intent and a code-block-bodied page is sometimes intentional.

### R6. (Optional) consider a future tool gap: per-block `append_to_toggle(page_id, title, markdown)` if `append_content`'s overloaded behavior is too magical

**Addresses:** ergonomics, not a current failure.
**Trade-off:** adds tool-surface area for a niche use. Current
`append_content(toggle_block_id, markdown)` already works because Notion
accepts block IDs as parent IDs. The only argument for a new tool is
discoverability. **Recommend deferring** unless the build-side tasuku
backlog has signal that agents are confused. Mark as a backlog candidate
only.

### Recommendations the audit does NOT make

- Do **not** recommend renaming the `markdown` parameter on any tool — it is
  a public contract, breaking-change cost is high, and the parameter name is
  already accurate.
- Do **not** recommend removing `find_replace`. It is the right tool for its
  narrow job and explicitly documented as such.
- Do **not** recommend reworking `markdownToBlocks` to "detect and unwrap"
  fenced markdown. That would silently rewrite user intent; sometimes a user
  legitimately wants a code block.
- Do **not** claim that `update_toggle` is broken. The evidence points to
  input shape, not the implementation.

## 6. Out of scope

This audit deliberately did not cover:

- **The teammate's actual session.** Without the MCP tool-call transcript
  (tool name, exact arguments, server identity/version), the
  failure-mode-to-tool mapping is inferred from reproduction, not from
  direct evidence. If the orchestrator can recover that transcript, a
  follow-up dispatch should pin the exact tool.
- **Other Notion MCP servers** (mcp.notion.com, third-party Notion MCPs).
  These have different tool surfaces and conversion pipelines. If the
  teammate's session was using one of those, our recommendations may not
  apply at all.
- **Older versions of easy-notion-mcp.** `update_toggle` was added in ~v0.8.0
  per project memory. If the teammate's environment was pinned to an earlier
  version, her Claude reached for a different tool and the conclusions
  change.
- **Markdown extensions beyond toggle bodies.** "Write markdown into a
  toggle" was the scoped case; "write markdown into pages generally" via
  `create_page` or `append_content` was not separately audited, though the
  same Mode 1 fenced/indented-code class applies.
- **Whether to ship R4 (a code-block-shaped warning) and R5 (extend across
  GFM-pipeline tools).** Those are build-time tradeoff decisions for a
  follow-up planner.

## Codex pressure-test notes

Codex independently reviewed this audit's hypotheses against the same files.
Summary of where it pushed back, all reflected above:

1. **Mode 1 scope was too narrow.** Codex flagged that the failure mode is
   not specific to triple-backtick fences — *any* markdown that parses as a
   Markdown code block triggers it, including four-space-indented bodies. I
   re-ran the live test with indented input and confirmed (toggle body
   became one un-tagged `code` block). The audit's Mode 1 description now
   covers both.
2. **Mode 2 evidence was thin for standard markdown.** Codex pushed back on
   claiming `find_replace` produces literal `#`, `-`, `**`. My own runtime
   tests already showed that those parse correctly via the native API; only
   our custom GFM extensions reliably land as text. The audit now states
   that the standard-markdown variant of Mode 2 is **not reproducible** on
   this server and lists the three most plausible alternative explanations
   (mixed-content sources, different MCP server, older version).
3. **Confirmed no internal "wrap as code" fallback.** Codex searched
   `markdownToBlocks` for any path that emits a code block from unparseable
   input. None exists. Unknown tokens are dropped, plain text becomes
   paragraphs. So the Mode 1 root cause is always input shape.
4. **Recommendations Codex agreed should not be made.** I have not made
   them — see "Recommendations the audit does NOT make" above.

No substantive disagreement between this audit's published conclusions and
Codex's review.

## Evidence appendix

- HEAD at audit: `9d758a3` (dev branch, easy-notion-mcp v0.9.3).
- Live test page: `362be876-242f-81af-a14b-eff1ffec7028` (archived after
  audit).
- Codex session id: `019e3323-ead1-7950-a3ed-bc729c0f6eed` (session name
  `audit-md-toggle-2026-05-16`).
- Codex pressure-test brief: `.meta/audit-md-toggle-codex-prompt.md` (kept
  local; not committed by default).
- Audit-PM session chain: this orchestrator-dispatched subprocess +
  one Codex pressure-test session above.

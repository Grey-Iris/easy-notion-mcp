Parent page: https://www.notion.so/frame-1-test-pages-2026-04-17-346be876242f8124977ff5db35fc9f1d — id `346be876-242f-8124-977f-f5db35fc9f1d` — **archived at session end**.

# Frame 1 — Markdown Archeologist

**Thesis (generator-provided):** The product's core value is lossless round-tripping between markdown and Notion blocks. Every block type × every combinator × every unicode/whitespace edge is a potential silent-drop or mangling site — if a nested callout inside a column inside a toggle loses its icon, the headline "full round-trip fidelity" claim breaks.

**Session chain summary:** 5 Codex passes (each one `initial + 1 rebuttal`) + 5 runtime probes against a real Notion page. All passes used `reasoningEffort: high`. Full chain in appendix.

**Fidelity taxonomy used (from PM rebuttal, Pass 1):** Cases are separated into:
- **[POSITIVE]** — normalization is the feature. The canonical form is part of the product promise. Not a bug.
- **[FIDELITY-LOSS]** — an author-authored distinction is silently erased. Against the README claim.
- **[API-BOUND]** — the field is only visible to Notion's UI, not the public API. Not fixable at the MCP layer. Not counted as a bug.

---

## Probe 1 — Block-type fidelity matrix

### Enumerated cases

Authoritative block-type count: **22** (not the README's claim of "25"). The overstated 3 are not a distinct taxonomy — they are counting artifacts around toggleable headings (same `heading_{1,2,3}` type with `is_toggleable:true`, not new block types).

**Symmetric / canonical round-trip:** headings (H1/H2/H3, toggleable variants), paragraph (annotation-subset), bulleted list, numbered list, quote, divider, toggle, columns, equation (single-line), TOC, bookmark, embed — modulo the positive/fidelity-loss items below.

**Materially asymmetric blocks (fidelity breaks the README claim):**

| Block | Break | Class |
|---|---|---|
| To-do | `children` dropped on **both** write and read. Nested content under a task silently disappears. Proven locally (`markdownToBlocks(...)` trace) and end-to-end (probe 5: 2 nested children + 1 sibling written → only 2 top-level tasks read back). | FIDELITY-LOSS |
| Image | Alt text dropped immediately on write (`![alt](url)` → output is `![](url)`). `file:///...` upload syntax comes back as a hosted `https://...` URL. | FIDELITY-LOSS |
| File | Written as `file` block via `[name](file:///...)`. Read emits `[name](https://...)` — a plain link. Replay through `replace_content` reparses as a paragraph link, **not** a file block. Round-trip downgrades the block type. | FIDELITY-LOSS |
| Audio | Same shape as file. Read emits `[audio](url)`, which write reparses as a paragraph link. | FIDELITY-LOSS |
| Video | Same shape. Read emits `[video](url)` → paragraph link on reparse. | FIDELITY-LOSS |
| Callout | Custom emoji / file / external icons collapse to one of 7 labels on read; unknown icons default to NOTE. Inline `> [!TIP] body` is rewritten to two-line form. Callout `color` is dropped. | FIDELITY-LOSS (icon+inline) + API-BOUND (color arguably UI-only) |
| Table | `has_column_header` / `has_row_header` ignored on read; renderer always treats first row as header. Alignment markers (`:---`, `---:`, `:---:`) dropped. | FIDELITY-LOSS |
| Numbered list | `2.`, `7.`, roman, alphabetic markers all erased to `1.` numeric output. API-visible `list_start_index` is never round-tripped. | FIDELITY-LOSS |
| Equation | Multiline `$$\nexpr\n$$` collapses to single-line `$$expr$$`. | FIDELITY-LOSS (minor) |
| Paragraph / Quote | Their `children` are dropped on read — `attachChildren` switch has no `paragraph` or `quote` case. | FIDELITY-LOSS |

**Positive normalizations (feature, not bug):**

- Bulleted-list marker canonicalized to `-` (even if author used `*` or `+`).
- Nested-list indentation canonicalized to 2 spaces.
- Empty toggle canonicalized to two-line form.
- To-do checkbox casing canonicalized (`[X]` → `[x]`).
- Table separator row canonicalized to plain `---` when alignment is absent.

**API-bound (not fixable at MCP layer):**

- `underline` text annotation. Notion's public API can return but not create underline; subset of users will see mismatches.
- Block-level `color` on paragraph/heading/list — arguably UI-first in practice.
- Embed preview/metadata — not part of the block surface.

**Promise gaps the README cannot cash:**

- README (lines 345, 349, 416) says `read_page` returns "the exact same markdown syntax that `create_page` accepts" and that content "round-trips cleanly." **False** for at least the 10 asymmetric cases above.
- README (line 302) claims "25 block types." Authoritative count is **22**.
- README (lines 239, 416) claims "Nested toggles inside toggles round-trip cleanly." **False for plain `+++ toggle +++` nesting** — see Pass 2. Only `+++ # Heading +++` toggle-heading nesting is tested.

### Debate block

**Claim** (Codex pass 1): 9/22 block types are materially asymmetric; README's "25" is a counting artifact; "What you write is what you read back" is false for uploaded media, image alt text, inline callouts, multiline equations, numbered-list styles, and headerless/row-header tables.

**Challenge**: (a) Is ordered-list canonicalization-to-`1.` in the same category as inline-callout normalization-to-two-line, or different? (b) Prove the to-do children claim with a runnable fixture, not just inference. (c) Give me a real 22-vs-25 answer — is the README number an error, or are there 3 legitimate blocks I'm missing? (d) Separate API-bound losses from fixable drops. (e) Is the content-notice banner a real fidelity break, or ergonomic?

**Resolution**: Codex re-segmented into Positive / Fidelity-loss / API-bound. Locally ran `markdownToBlocks(` - [ ] parent\n  - child`)` → output is a single `to_do` with no `children`. Confirmed the `- [x] sibling` read-back end-to-end (Probe 5: children dropped post-Notion round-trip). README's 25 is an error; no third taxonomy. Content-notice banner is trivially strippable out-of-band — classified as ergonomic, removed from bug list. Embed-caption-metadata claim was **retracted** — not API-visible. Final refined matrix above.

---

## Probe 2 — Parser escape / boundary attacks

### Enumerated cases

Parser precedence (established at [src/markdown-to-blocks.ts:313-418](../../src/markdown-to-blocks.ts), [572-656](../../src/markdown-to-blocks.ts)): hand-rolled `splitCustomSyntax()` runs first, tracks code fences, splits out toggles / columns / equations. Plain segments then go through `normalizeOrderedListIndentation()` and `marked.lexer()`. Callouts are recognized post-`marked` via regex over blockquote text. Toggle/column bodies are reparsed recursively.

**Bugs (confirmed by literal `JSON.stringify(markdownToBlocks(input))` traces):**

1. **Fence desync — structural injection from fenced content.** A line starting with backticks inside a fence (e.g. ` ```ts` inside a ` ```md ` fence) is treated as a fence **close** by the custom scanner at [src/markdown-to-blocks.ts:314](../../src/markdown-to-blocks.ts), even though `marked` keeps it as code content. Subsequent `+++` / `:::` / `$$` / `[!NOTE]` / etc. escape the fence and become real structural blocks. Confirmed end-to-end in Probe 4b: input intended one fenced block showing sample markdown → output in Notion contains (1) a truncated code block, (2) a **real toggle block** titled "Leaked Toggle", (3) a trailing empty code block. Exact minimum repro:
   ```
   ```md
   ```ts
   +++ Leaked
   body
   +++
   ```
   ```
   Output JSON (verbatim): `[{code, lang:md, content:"```ts"}, {toggle, title:"Leaked", children:[{paragraph:"body"}]}, {code, lang:"plain text", content:""}]`.

2. **Same desync bug doubled** — `normalizeOrderedListIndentation()` at [src/markdown-to-blocks.ts:247-280](../../src/markdown-to-blocks.ts) has its own copy of the fence tracker. So after a faux fence close, ordered-list-looking lines inside the intended code block get **indentation-mutated** — user code content is literally rewritten.

3. **Greedy toggle close.** `+++ Title / ... / +++` closes on the first bare `+++` inside the body. Authors cannot include literal `+++` as toggle content. Confirmed.

4. **Plain nested toggles don't work.** `+++ Outer / +++ Inner / body / +++ / +++` — outer scanner matches the first `+++` as its close. Inner becomes stray text. README explicitly claims "Nested toggles inside toggles round-trip cleanly" (lines 239, 416) — **broken promise** against documented contract. Tests cover only nested toggle-**headings**, not plain toggles.

5. **`[embed](url)` overload is a footgun.** Any link whose text is exactly `embed` becomes an embed block ([src/markdown-to-blocks.ts:495](../../src/markdown-to-blocks.ts)). A user legitimately writing `[embed](https://notion.so/page-named-embed)` as a link will get an embed block. Name-squatting — documented, but ergonomically fragile.

6. **Notion code-language whitelist clash.** Fence desync in Probe 4 attempt A created a block with `language: "md"`. Notion's API rejects `"md"` (only `"markdown"` is valid; ~90 fixed languages). The MCP passes raw strings through with no translation. **Any markdown with a non-whitelist lang tag (`md`, `text`, `pseudo`, `cpp` etc.) fails to write.** Not just cosmetic — entire `create_page` call fails.

**Confirmed safe / by-design / untested-but-working:**

- Code fence info string `+++` itself: fine (test 1 in Pass 2 catalog).
- `:::` as literal content inside a fenced code block that's inside a column: fine.
- Callout body containing `[!TIP]`: stays as literal content (callout regex fires only on the first quote paragraph).
- Math `$$` containing `\text{$$}`: fine (multiline math only closes on standalone `$$` line).
- Pipe table cell containing `\|`, `$$`, `+++`, `::: column`, `<script>`: literal text preserved (write side).
- Bare URL with trailing punctuation (`https://example.com.`): correctly stays as paragraph, not bookmark.
- `[toc](url)` is a standalone sentinel — does NOT trigger TOC (unlike `[embed]`).

### Debate block

**Claim** (Codex pass 2): Fence desync allows structural blocks to escape a code fence. Plain nested toggles broken. `[embed]` overload is ergonomic fragility. No safe-URL bypass observed.

**Challenge**: (a) Fence desync — give a literal JSON diff and quantify the real-world blast radius. Is this just a rendering bug or is it an actual structural-injection security finding? (b) Are plain nested toggles a documented feature or an implicit feature? If the README doesn't claim them, they're not a bug. (c) Prove `[embed]` is documented, not accidental, and check whether `[toc]` has the same footgun shape.

**Resolution**: (a) Literal JSON diff produced. Attacker controlling only fenced-code *content* can cause unintended structural blocks to appear in Notion. Blast radius is "any block type this MCP supports" — toggles, callouts, embeds, bookmarks, columns, equations, headings — not arbitrary Notion block types. Scenario: LLM summarizes a user's raw README or issue thread; malicious pasted snippet turns part of "code" into a real callout / bookmark in the destination page. **Kept as structural-injection class, scoped.** (b) README lines 239 and 416 explicitly claim nested toggles round-trip cleanly. Tests only cover toggle-heading nesting. Documented contract, broken implementation — **real bug, not missing feature**. (c) `[embed]` documented at README:336 and server.ts:442 — intentional but ergonomically fragile. `[toc]` is narrower: only triggers when the whole paragraph is the literal text `[toc]`; `[toc](url)` stays a normal link. No footgun on `[toc]`.

---

## Probe 3 — Tables and inline edges

### Enumerated cases

**Actual bugs (confirmed via node script against `dist/`):**

- **Escaped pipe lost on read.** Input `| x \| y | z |` parses correctly (cell content = `x | y`) but `tableRowToMarkdown()` at [src/blocks-to-markdown.ts:32-35](../../src/blocks-to-markdown.ts) joins with ` | ` and does no escaping. Output: `| x | y | z |` — row widens to 3 cells, silently. One-line fix available (escape `|` in cell text before join). **FIDELITY-LOSS**, serializer-side.
- **Inline code containing backticks corrupted.** Input `` ``a ` b`` `` parses correctly (`content: "a ` b"`, `code: true`). [src/blocks-to-markdown.ts:7-9](../../src/blocks-to-markdown.ts) always wraps with single-backtick: output `` `a ` b` `` — invalid code span (inner backtick prematurely closes). Missing standard rule: "use double-backtick when content contains single backtick." **FIDELITY-LOSS**, serializer-side.
- **Rich-text length limit (2000 chars) is unguarded.** No chunking or truncation anywhere in the pipeline. Overlong paragraph → API error at write time (not silent data loss, but agent-visible breakage). Block-level batching exists (100 blocks per call) at [src/notion-client.ts:315-352](../../src/notion-client.ts) but not rich-text chunking. **Product-ergonomics gap.**
- **Unicode normalization: absent.** No `.normalize()` calls anywhere. NFC vs NFD forms round-trip as distinct strings. ZWJ / ZWNJ / variation selectors preserved verbatim. Generally a **POSITIVE** (authors control their text) but means applications that normalize elsewhere may see drift.

**Canonicalizations (POSITIVE — feature, not bug):**

- Alignment markers dropped (`:---` → `---`): Notion has no alignment field; loss is API-bound + rendering is canonical.
- Empty cells render with single space preserved.
- Table row width padded when short rows seen.

**User-gotchas (label changed from "bug" during rebuttal):**

- Literal `\n` in a pipe-table cell splits into a second row. This is **invalid GFM input** — the user owes `<br>` or out-of-table content. The parser is doing what GFM says. But no warning is surfaced.
- `<script>` / raw HTML in cells is preserved literally, unsanitized. Only matters if Notion itself sanitizes downstream.
- `$E=mc^2$` (single-dollar inline math) has **no handler**. Stays as literal text. Gap or deliberate scope-limit — worth a README note.

**Preserved correctly (test-coverage gap even though it works):**

- ZWJ family emoji (`👨‍👩‍👧‍👦`), skin-tone modifiers, surrogate pairs, RTL text mixed with LTR, combining diacritics.
- Link URL containing `(`, `)`, backticks, `[`, `]`.
- All-annotations-on-one-run case (`[~~***`code`***~~](url)`).
- Heading with inline annotations + link (`# **Bold** [link](url)`).
- Inline code inside table cell, link inside callout header.

### Debate block

**Claim** (Codex pass 3): Escaped pipes silently widen tables. Inline code with backticks corrupts. Literal `\n` in table cells mangles. No rich-text length guard.

**Challenge**: (a) Locate exactly which side of each table bug is at fault (parser vs serializer). (b) Is literal `\n` in a cell a bug or user error? (c) What actually happens at 2000-char limit — silent truncate or loud failure?

**Resolution**: (a) Both pipe and backtick bugs are serializer-side at [src/blocks-to-markdown.ts](../../src/blocks-to-markdown.ts) — single-line fixes available for each. (b) Demoted `\n`-in-cell from bug to user-gotcha / invalid-GFM — the parser is correct; the UX problem is no warning. (c) Loud failure — Notion SDK throws `APIResponseError` with `code:"validation_error"`, mapped at [src/server.ts:406-408](../../src/server.ts). Not silent data loss; annoying but safe.

---

## Probe 4 — UI-only blocks / open-world gap

### Enumerated cases

**Gap matrix (read-side silent-drop + replace_content destruction):**

`normalizeBlock` at [src/server.ts:276](../../src/server.ts) returns `null` for any block type outside its whitelist; `fetchBlocksRecursive` at [src/server.ts:323,328](../../src/server.ts) skips before recursion. `replace_content` at [src/server.ts:1019-1023](../../src/server.ts) is **delete-all-then-append**, not diff-based.

| Block | Read | Observable to agent? | `replace_content` destroys? |
|---|---|---|---|
| `synced_block` (ref + original) | silent drop | no | **yes** |
| `child_page` | silent drop | only via separate `list_pages` | **yes** (existence, not content) |
| `child_database` | silent drop | no | **yes** |
| `link_to_page` | silent drop | no | **yes** |
| `pdf` | silent drop | no | **yes** |
| `unsupported` | silent drop | no | **yes** |
| `breadcrumb` | silent drop | no | **yes** |
| `template` | silent drop | no | **yes** |
| `ai_block` / newer layout / button | silent drop | no | **yes** |
| `audio`, `video` | emits `[audio](url)` / `[video](url)` | yes but misleading | yes on round-trip reparse (downgrades to paragraph link) |
| `table_of_contents` | emits `[toc]` | yes | survives |
| Block-level comments | not fetched | no | any parent-block delete drops the comment too |

**Real-world ranking of drop-severity (by estimated usage frequency):**

1. `child_database` — inline databases are a core Notion pattern (tasks, projects, CRM). **Highest-impact drop.**
2. `link_to_page` — common on home/index/hub pages.
3. `synced_block` — common on templates, headers, footers.
4. `child_page` — partially salvaged by `list_pages` escape hatch.
5. Others: niche.

**Highest-consequence finding (survived all rebuttals):** The `read_page → edit markdown → replace_content` workflow is a **data-loss path**. Scenario: user has a page with meeting notes + an inline database at the bottom. Agent calls `read_page` (database silently absent from markdown). Agent edits a paragraph. Agent calls `replace_content` with the edited markdown. **Delete-loop destroys the database.** User loses structured data they never knew the agent couldn't see.

- Fault split: MCP bears primary — `read_page` description at [src/server.ts:545](../../src/server.ts) claims markdown "round-trips cleanly"; unsupported blocks are silent; replace is delete-all. Agent has secondary responsibility only if it opts into full-page replace when a targeted tool exists, but the MCP provides no warning.
- Severity: moderate on arbitrary pages, **high on dashboard/index pages**.

**PDF specifically (write+read asymmetry compounds):** Write-side downgrades `.pdf` upload to generic `file` block ([src/notion-client.ts:25,102](../../src/notion-client.ts)). Read-side drops UI-authored `pdf` blocks silently. If user reads, edits, replaces — UI-authored PDFs disappear; tool-authored PDFs degrade to paragraph links on the next round-trip. Two-stage loss.

### Debate block

**Claim** (Codex pass 4): `replace_content` destroys unsupported blocks. Top 3 at-risk: child_database, link_to_page, synced_block.

**Challenge**: (a) Who's at fault — LLM or MCP? (b) Which 3 block types are realistically common? Niche ones shouldn't dominate the severity claim. (c) PDF path — does write-side downgrade compound with read-side drop?

**Resolution**: (a) MCP bears primary fault — the tool description claims round-trip cleanness while silently dropping blocks. LLM cannot be expected to infer hidden state. (b) Ranked: `child_database` (very common, very dangerous), `link_to_page` (very common), `synced_block` (common in templates). (c) PDF compounds: UI-authored `pdf` is dropped on read and destroyed on replace; tool-authored `pdf` becomes `file` at write time, reads back as `[name](url)`, replays as paragraph link. Net: `pdf` is the worst-case fidelity block.

---

## Probe 5 — `find_replace` two-pipeline seam

### Enumerated cases

**Implementation:** `find_replace` is a thin pass-through to Notion's native `pages.updateMarkdown` at [src/server.ts:1082-1104](../../src/server.ts). Does **not** walk blocks, mutate rich_text, or use the custom GFM pipeline. Repo confirms in [CLAUDE.md:75](../../CLAUDE.md).

**Seam anchors verified end-to-end (runtime probes 1-3):**

- **Probe 1 — Untouched-block preservation**: Create `Alpha target` paragraph + bookmark + `Omega`. `find_replace("Alpha target paragraph.", "Alpha changed paragraph.")`. Read back: bookmark **preserved**, Omega preserved, Alpha changed. **Tool description claim holds — for bookmarks.** But response included `truncated: true` — Notion's API signaled that its markdown view is incomplete (because the bookmark renders as `<unknown .../>` in the markdown view). MCP correctly passes `truncated` through. **Agents ignoring `truncated` may still make wrong decisions — flagging worth documenting.**
- **Probe 2 — Annotation preservation**: Create `This is **bold text** here.` `find_replace("bold", "italic")`. Read back: `This is **italic text** here.` **Bold annotation preserved on the new word.** ✅
- **Probe 3 — Cross-block match**: Create `alpha\n\nbeta`. `find_replace("alpha\n\nbeta", "joined")`. Read back: `joined`. **Two paragraphs collapsed to one.** Behavior is `markdown-global`, not block-local. Powerful, but also a footgun — a `find` containing `\n\n` deletes block boundaries.

**Other seam risks (not runtime-probed, worth flagging):**

- Server throws away `unknown_block_ids` from Notion's response at [src/server.ts:1101-1104](../../src/server.ts). If Notion's API tells us *which* blocks couldn't be represented in the markdown view, the MCP opaques that. **Fixable — pass through.**
- Numbered-list marker canonicalization still applies on subsequent `read_page` — find_replace doesn't change that.
- Callout with **custom icon**: find_replace likely preserves the Notion-side icon, but `read_page` then collapses it to `> [!NOTE]` because unknown emojis default to NOTE. So the icon survives in Notion but not in the round-trip markdown the agent sees.
- Code-block content: find_replace operates on markdown string, so `const foo = 1;` in a code block **is** replaceable. May be a misfeature when users don't expect it.

**Net take on the tool-description claim "Preserves uploaded files and blocks that aren't touched":** Confirmed for bookmarks in Probe 1, likely true for other supported block types (Notion's markdown API is block-preserving by design). **Stronger than `replace_content` for fidelity.** But the claim should be qualified: (a) `truncated` flag can fire on Notion's side, (b) cross-block find-patterns can delete block structure, (c) subsequent `read_page` still normalizes per the main pipeline's rules.

### Debate block

**Claim** (Codex pass 5): `find_replace` delegates to Notion's native markdown updater. The "preserves untouched blocks" claim is not proven by the repo alone; Notion's API docs show a `truncated`/`unknown_block_ids` response that the MCP discards.

**Challenge**: Prioritize top 3 runtime probes so the claim can actually be tested. Which one should I run first?

**Resolution**: Codex prioritized: unsupported-block preservation (Probe 1), annotation preservation (Probe 2), cross-block match (Probe 3). **All three run, all three reported.** The "preserves untouched blocks" claim **holds for bookmarks** end-to-end. `truncated:true` was observed in the response — the MCP passes it through but does NOT document what it means. Agents calling find_replace and getting back `{"success":true,"truncated":true}` have no guidance on what to do.

---

## Cross-frame acknowledgment

My frame's blind spots (listed by the frame generator + my own gaps):

1. **Tool-selection / ergonomic failures.** Frame 5 or 6's territory. I can prove the fence-desync bug, prove `replace_content` destroys databases, prove find_replace preserves annotations — but I cannot assess whether a real agent would **choose the right tool** in the first place. If the README doesn't make the `find_replace` vs `replace_content` safety distinction obvious, the fidelity of each tool is moot.

2. **Database operations.** I skipped `query_database`, `add_database_entry`, `update_database_entry`, `get_database`, `create_database`. These have their own fidelity question (property types, rollup/formula preservation, rich-text-in-property cells). Likely another frame's territory. My matrix treats inline databases as opaque blocks (Probe 4); I did not probe their internal round-trip.

3. **Performance / scale.** Behavior on pages with 500+ blocks, 10,000-word paragraphs, 50-column tables. Probe 3 tested 50 cols briefly (fine) but I did not stress the pagination / 100-block batching boundary at [src/notion-client.ts:315](../../src/notion-client.ts).

4. **Auth / permissions / multi-user.** Shared-page access, workspace-vs-private page resolution, integration-token scope failures. Entirely outside my frame.

5. **Real-time / concurrent edits.** Two agents mid-replace; last-writer-wins; cross-session lock semantics.

---

## Session chain appendix

**My session (Frame 1 PM):** inherited from orchestrator — no discrete sessionId (running as main conversation thread).

**Codex sessions (all agentic coding, `reasoningEffort: high`):**

| Pass | Session name | sessionId | Rounds |
|---|---|---|---|
| 1 | frame1-pass1-block-fidelity | `019d9e98-058f-74b0-8c6f-c1fe774c7062` | initial + 1 rebuttal |
| 2 | frame1-pass2-parser-escape | `019d9ea3-cc3f-7f30-8f78-76109117857a` | initial + 1 rebuttal |
| 3 | frame1-pass3-tables-inline | `019d9eaf-99a1-7053-9989-11bbcaa12ca8` | initial + 1 rebuttal |
| 4 | frame1-pass4-ui-only-blocks | `019d9eb4-2093-72a2-a642-900239e9df3b` | initial + 1 rebuttal |
| 5 | frame1-pass5-find-replace-seam | `019d9eb7-d83f-77d1-8e72-f7c114b78e72` | initial + 1 rebuttal |

**Runtime probes (against real Notion page `346be876-242f-8124-977f-f5db35fc9f1d`):**

- Probe 1 (`find_replace` bookmark preservation): pass — bookmark survived.
- Probe 2 (`find_replace` annotation preservation): pass — `**bold**` → `**italic**` preserved.
- Probe 3 (`find_replace` cross-block match): pass — cross-paragraph match collapses blocks.
- Probe 4 (fence desync): attempt A failed with Notion `validation_error` (lang `"md"` not whitelisted — secondary finding). Attempt B (4b, language `markdown`) succeeded and **confirmed end-to-end** that fence desync produces unintended structural blocks in Notion (toggle titled "Leaked Toggle" was created from what user wrote as fenced content).
- Probe 5 (to-do children e2e): pass — input `- [ ] parent / 2 nested children / - [x] sibling` round-tripped to just `- [ ] parent / - [x] sibling`. Children silently destroyed.

Parent page archived at session end.

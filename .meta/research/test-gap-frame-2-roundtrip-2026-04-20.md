# Frame 2 — Round-trip Auditor: Idempotency & Fuzz-style Edge Cases

**Date:** 2026-04-20
**Scope:** `markdown-to-blocks.ts` (659 lines) + `blocks-to-markdown.ts` (232 lines) round-trip fidelity.
**Existing coverage baseline:** `tests/roundtrip.test.ts` (30 cases), `tests/markdown-to-blocks.test.ts` (48 cases), `tests/blocks-to-markdown.test.ts` (33 cases).

---

## TL;DR — highest-risk round-trip gaps

1. **Multi-paragraph blockquotes lose everything after the first paragraph.** `blockquoteToBlock` reads only `token.tokens?.[0]?.text` (`src/markdown-to-blocks.ts:189`). Second paragraph onward is silently dropped. Real bug.
2. **Nested to-do items lose children.** `listTokenToBlocks` (`src/markdown-to-blocks.ts:154-163`) creates `to_do` blocks without attaching `children`. Nested items under a task are silently discarded. Real bug.
3. **Annotation rendering order is non-idempotent.** `applyAnnotations` (`src/blocks-to-markdown.ts:3-24`) wraps code→bold→italic→strike→link. Input `**~~text~~**` normalizes to `~~**text**~~` on first trip. Stable after first trip, but not identity-preserving.
4. **CRLF line endings break custom syntax detection.** `splitCustomSyntax` (`src/markdown-to-blocks.ts:296`) splits on `\n`; lines retain `\r`, so `line === "+++"` fails for `"+++\r"`. Toggle/column/equation closers never fire.
5. **Rich text >2000 chars hits Notion API limit with no client-side guard.** `createRichText` (`src/markdown-to-blocks.ts:20-41`) doesn't split. A single long paragraph produces one rich_text entry; Notion rejects it at API call time with an unhelpful error.
6. **Code blocks containing triple backticks break on round-trip.** `renderBlock` for `code` (`src/blocks-to-markdown.ts:188-193`) always emits exactly ` ``` `. If the code body contains ` ``` `, re-parsing closes the fence early.
7. **Multi-paragraph callouts lose body paragraphs.** Same root cause as #1 — `blockquoteToBlock` only reads the first child token's text. `> [!NOTE]\n> line 1\n>\n> line 2` drops "line 2".
8. **HTML blocks silently vanish.** `tokenToBlocks` has no `html` case; `default: return []` (`src/markdown-to-blocks.ts:567-568`). `<details>`, `<br>`, raw `<div>` blocks disappear on first conversion.

---

## Class-by-class inventory

### 1. Nested structures

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Nested to-do with children | `- [ ] parent\n  - [ ] child` | `src/markdown-to-blocks.ts:154-163` — `item.task` branch creates `to_do` without `children` | Child list items are silently dropped. **Real bug.** Non-task items at `:165-183` do attach children. |
| Code fence inside callout | `> [!NOTE]\n> \`\`\`js\n> code\n> \`\`\`` | `src/markdown-to-blocks.ts:189` — reads only first token text | Code fence content becomes part of raw text or is dropped. Notion callouts don't support child blocks via API anyway — **lossy-but-acceptable.** |
| Toggle inside list item | `- item\n  +++ Toggle\n  content\n  +++` | `splitCustomSyntax` runs before `marked.lexer`; toggle detection at `:388` requires `line.startsWith("+++ ")` — indented `  +++ ` won't match | Toggle syntax consumed as literal text in list item. **Lossy-but-acceptable** — Notion doesn't support toggle as list child. |
| Nested columns (`::: columns` inside `::: column`) | `::: columns\n::: column\n::: columns\n::: column\nInner\n:::\n:::\n:::\n:::` | `splitCustomSyntax` at `:396` only enters column mode once; inner `::: columns` treated as text inside the column | Inner column layout rendered as literal text. **Lossy-but-acceptable** — Notion doesn't support nested column_list. |
| Quote inside callout | `> [!NOTE]\n> > nested quote` | `blockquoteToBlock` at `:189` — callout regex matches; inner `> ` is part of content text | Inner quote markers become literal `> ` in callout text. Loses quote semantics. **Lossy-but-acceptable.** |

### 2. Mixed inline formatting

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Bold wrapping strikethrough | `**~~text~~**` | Parse: `inlineTokensToRichText` `:50-121` correctly merges `{bold, strikethrough}`. Render: `applyAnnotations` `:3-24` outputs `~~**text**~~` | **Non-idempotent on first trip** (normalizes to strike-outside-bold). Stable after first trip. |
| Code inside link | `` [`code`](https://x.com) `` | Parse: `link` case at `:91-101` recurses into `codespan`. Render: `applyAnnotations` wraps code first → `` `code` ``, then link → `` [`code`](url) `` | Should round-trip cleanly. **Untested.** |
| Bold+italic+code | `` ***`x`*** `` | Parse: strong→em→codespan. Render: code→bold→italic → `` *`**x**`* ``. Wait — code wraps first making `` `x` ``, bold wraps → `` **`x`** ``, italic → `` ***`x`*** ``. Actually no: `applyAnnotations` applies code(innermost), then bold, then italic. | Produces `*` `**` `` `x` `` `**` `*` = `` ***`x`*** ``. **Should round-trip.** Untested though. |
| Link with formatted text | `[**bold link**](https://x.com)` | Parse: link case recurses into strong. Render: bold wraps first → `**bold link**`, then link → `[**bold link**](url)` | Should round-trip. **Untested.** |

### 3. Edge lengths

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Paragraph >2000 chars | `"a".repeat(2500)` | `createRichText` at `:20-41` — no length check | Single rich_text entry with 2500-char content. Notion API rejects with 400. **Real gap** — should split into multiple rich_text entries or warn. |
| Heading >2000 chars | `# ${"a".repeat(2500)}` | Same — `blockTextToRichText` → `inlineTokensToRichText` → `createRichText` | Same API rejection. |
| 100+ blocks | 101 paragraphs | `markdownToBlocks` returns flat array; batching happens in `appendBlocks` (`src/notion-client.ts:351-373`). The 100-block batch split is at `:359`. | Round-trip itself is fine; the API batching is handled. But `blocks.children.append` limit of 100 blocks per call is a concern for very large documents. **Not a round-trip bug, but untested at scale.** |
| Empty string | `""` | `markdownToBlocks` at `:573` returns `[]`. `blocksToMarkdown([])` returns `""`. | Already tested. |
| Trailing newlines | `"Hello\n\n\n"` | `marked.lexer` strips trailing whitespace. Produces one paragraph. | Round-trips to `"Hello"` — trailing newlines lost. **Non-idempotent but expected.** Untested. |

### 4. Unicode and control characters

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| CRLF line endings | `"+++ Title\r\ncontent\r\n+++"` | `splitCustomSyntax` `:299` splits on `\n`; lines keep `\r`. `line === "+++"` at `:331` fails for `"+++\r"`. | Toggle never closes. Falls through to `:424-426` which pushes raw lines as markdown. **Real bug.** |
| BOM prefix | `"﻿# Title"` | BOM becomes part of first line. `marked.lexer` may handle it (marked does strip BOM per GFM spec). | Likely handled by marked. **Needs verification test.** |
| Emoji in toggle title | `"+++ 🎉 Party\ncontent\n+++"` | `splitCustomSyntax` `:388` — `line.slice(4)` may split a multi-byte emoji. But `slice(4)` is after `"+++ "` (4 chars), so title starts at the emoji. | JS string slicing is UTF-16 safe here. Title = `"🎉 Party"`. **Should work.** Untested. |
| Zero-width joiner | `"Hello‍world"` | Passes through as content in `createRichText`. `marked` treats as text. | Round-trips cleanly (invisible char preserved). Notion may or may not strip it server-side. **Not a local round-trip bug.** |
| Tab indentation | `"\t- item"` | `marked` interprets tabs as 4 spaces for list indentation. | Normalizes tab to space-based indentation on output. **Non-idempotent but expected.** |

### 5. Custom syntax corners

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Callout case normalization | `> [!note]\n> text` | Regex at `src/markdown-to-blocks.ts:191` has `/i` flag — matches. `calloutType = "note".toUpperCase()` → `"NOTE"`. `blocksToMarkdown` always emits uppercase. | Input `[!note]` → output `[!NOTE]`. **Non-idempotent first trip, stable after.** Untested. |
| Empty callout body | `> [!NOTE]` | Regex captures group 2 as `undefined`. `(undefined ?? "").trim()` → `""`. `blockTextToRichText("")` → `[]`. Render: `> [!NOTE]\n> ` | Re-parse of `> [!NOTE]\n> ` — regex gets `\n` then empty match. Converges but **whitespace may drift.** Untested. |
| `+++ ` with only spaces as title | `+++  \ncontent\n+++` | Title = `" "`. `blockTextToRichText(" ")` → rich_text with space. Render: `+++  \ncontent\n+++`. | Should be idempotent. **Untested edge.** |
| `[embed]()` empty URL | `[embed]()` | `tokenToBlocks` `:495-500` — `isSafeUrl("")` returns `false` (empty string). Falls through to paragraph. | Becomes paragraph with text "embed". On re-parse, stays paragraph. **Idempotent but lossy** — embed intent lost. Untested. |
| `$$` with surrounding text | `text $$E=mc^2$$ more` | `splitCustomSyntax` `:412` checks `line.startsWith("$$")` — fails. Whole line goes to markdown. `marked` doesn't know `$$`. | Becomes paragraph with literal `$$E=mc^2$$` as text. **Not a bug** — inline equations aren't supported (block-level only). But undocumented. |
| `[toc]` inside list | `- [toc]` | `listItemToRichText` at `:127-143` extracts inline tokens. Text `[toc]` is literal. | Becomes `bulleted_list_item` with text `[toc]`. **Correct** — toc is block-level. Untested. |
| Unclosed toggle (no closing `+++`) | `+++ Title\ncontent but no close` | `splitCustomSyntax` `:424-426` — raw lines pushed to markdown lines as fallback | Becomes paragraph with `+++ Title` as text and `content...` as separate paragraph. **Graceful degradation.** Untested. |
| Columns with missing `::: column` | `::: columns\nbare text\n:::` | `:349` checks `line === "::: column"` — bare text doesn't match. `columnLines` stays null. `:367-369` pushes to null. | Likely throws or silently drops. **Untested crash risk.** |

### 6. HTML / escape

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Raw HTML block | `<div>content</div>` | `marked` emits `html` token. `tokenToBlocks` `:567-568` → `default: return []`. | **Silently dropped.** Lossy-but-acceptable (Notion has no HTML block type). Untested. |
| `<br>` tag | `line 1<br>line 2` | `marked` inline lexer emits `br` token. `inlineTokensToRichText` `:109-110` handles `br` → `\n`. | Converts to newline in rich_text. On output, `\n` in paragraph text. **Should round-trip.** Untested. |
| HTML entities | `&amp; &lt; &gt;` | `marked` decodes to `& < >`. `createRichText` stores decoded. Output: `& < >`. | **Non-idempotent** — entities decoded on first trip. Stable after. Expected behavior. |
| `<` not a tag | `5 < 10` | `marked` treats as text. | Round-trips cleanly. |

### 7. GFM specifics

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Autolink | `<https://example.com>` | `marked` emits a link token with autolink flag. `inlineTokensToRichText` `:91-101` handles normally. Render: `[https://example.com](https://example.com)`. | **Non-idempotent** — autolink syntax `<url>` → named link `[url](url)`. |
| Table cell with pipe | `\| Name \| Notes \|\n\| --- \| --- \|\n\| A \| has \\\| pipe \|` | `marked` handles `\|` escaping. `richTextToMarkdown` at `src/blocks-to-markdown.ts:26-30` doesn't escape `\|` in output. | Cell content with literal `\|` breaks table structure on re-render. **Real bug in output path.** |
| Footnote syntax | `Text[^1]\n\n[^1]: Note` | `marked` with GFM doesn't support footnotes by default. | Likely rendered as literal text. Not a round-trip bug — just unsupported syntax. |

### 8. Injection sentinel

| Input class | Smallest reproducing input | Handler | Suspected behavior |
|---|---|---|---|
| Sentinel in round-trip | Read page → write back → read again | `wrapUntrusted` at `src/server.ts:48-49` prepends `CONTENT_NOTICE` on every `read_page` | Double-prefixed: `[Content...]\n\n[Content...]\n\nactual content`. **Known issue** per spike notes (`.meta/research/agent-feedback-loop-spike-2026-04-20.md:221`). Not a markdown-to-blocks bug — it's a server-level concern. |

---

## Proposed property-based test scaffolding

A `fast-check` (or `@fast-check/vitest`) setup would be most valuable for these generators:

1. **Arbitrary rich_text annotations generator**: Random subset of `{bold, italic, strikethrough, code}` × random link presence × random text content. Assert: `blocksToMarkdown([para(richText)]) |> markdownToBlocks |> blocksToMarkdown` is stable (second trip = first trip output).

2. **Arbitrary block-tree generator**: Weighted choice of block types (paragraph, heading 1-3, list items, toggle, callout, code, table, divider, equation, toc, embed, bookmark). For containers (toggle, list items), recurse with depth limit. Assert: `blocksToMarkdown(tree) |> markdownToBlocks |> blocksToMarkdown` is a fixpoint.

3. **Arbitrary markdown string generator with custom syntax**: Generate strings containing `+++`, `:::`, `$$`, `> [!TYPE]`, `` ``` ``, interspersed with normal markdown. Assert: after two round-trips, output stabilizes.

4. **Rich-text length boundary generator**: Strings of length 1990-2010 chars. Assert: `markdownToBlocks` either splits into multiple rich_text entries or raises a clear error (currently does neither).

5. **Line-ending generator**: Same markdown content with `\n` vs `\r\n` vs mixed. Assert: `markdownToBlocks` produces identical block structures regardless of line ending.

---

## Prioritized test adds (15 tests)

Tests ordered by severity (real bugs first, then normalization gaps, then edge documentation).

### P0 — Real bugs

**T1. Multi-paragraph blockquote content loss**
```
Input:    "> line 1\n>\n> line 2"
Expected: quote block with rich_text containing "line 1\nline 2" (or two paragraphs)
Actual:   quote block with rich_text containing only "line 1"
File:     tests/markdown-to-blocks.test.ts
Type:     unit (markdownToBlocks)
Handler:  src/markdown-to-blocks.ts:189
```

**T2. Multi-paragraph callout content loss**
```
Input:    "> [!NOTE]\n> paragraph 1\n>\n> paragraph 2"
Expected: callout with rich_text containing both paragraphs
Actual:   callout with only "paragraph 1"
File:     tests/markdown-to-blocks.test.ts
Type:     unit (markdownToBlocks)
Handler:  src/markdown-to-blocks.ts:189-196
```

**T3. Nested to-do items lose children**
```
Input:    "- [ ] parent\n  - [ ] child"
Expected: to_do block with children containing child to_do
Actual:   to_do block with no children; child silently dropped
File:     tests/markdown-to-blocks.test.ts
Type:     unit (markdownToBlocks)
Handler:  src/markdown-to-blocks.ts:154-163
```

**T4. CRLF breaks toggle closing**
```
Input:    "+++ Title\r\ncontent\r\n+++\r\n"
Expected: same blocks as LF version
Actual:   toggle never closes; raw text falls through as paragraphs
File:     tests/markdown-to-blocks.test.ts
Type:     unit (markdownToBlocks)
Handler:  src/markdown-to-blocks.ts:331 (line === "+++")
```

**T5. Code block containing triple backticks**
```
Input blocks: code block with body "console.log(`\`\`\``)"
Expected:     output uses ```` ```` ```` fencing or escaping
Actual:       output uses ``` which re-parse closes early
File:         tests/roundtrip.test.ts
Type:         round-trip
Handler:      src/blocks-to-markdown.ts:190
```

**T6. Table cell with pipe character**
```
Input blocks: table with cell text "A | B"
Expected:     output escapes pipe as "A \| B"
Actual:       output "| A | B |" which misaligns columns
File:         tests/blocks-to-markdown.test.ts
Type:         unit (blocksToMarkdown)
Handler:      src/blocks-to-markdown.ts:33 (richTextToMarkdown in cells)
```

### P1 — Normalization / idempotency gaps (stable after first trip)

**T7. Annotation order normalization**
```
Input:    "**~~text~~**"
Expected: round-trips to "~~**text**~~" and stabilizes
File:     tests/roundtrip.test.ts
Type:     round-trip (assert second trip == first trip output)
Handler:  src/blocks-to-markdown.ts:3-24
```

**T8. Callout label case normalization**
```
Input:    "> [!note]\n> lowercase callout"
Expected: round-trips to "> [!NOTE]\n> lowercase callout" and stabilizes
File:     tests/roundtrip.test.ts
Type:     round-trip
Handler:  src/markdown-to-blocks.ts:195
```

**T9. Autolink normalization**
```
Input:    "<https://example.com>"
Expected: round-trips to "[https://example.com](https://example.com)" or "https://example.com"
File:     tests/roundtrip.test.ts
Type:     round-trip (document which normal form we produce)
```

**T10. Heading depth >3 normalization**
```
Input:    "#### Deep heading"
Expected: round-trips to "### Deep heading" (h4 → h3, lossy)
File:     tests/roundtrip.test.ts
Type:     round-trip
Handler:  src/markdown-to-blocks.ts:451-452
```

### P2 — Edge documentation tests

**T11. Empty callout body**
```
Input:    "> [!WARNING]"
Expected: callout block with empty rich_text, round-trip stable
File:     tests/roundtrip.test.ts
Type:     round-trip
```

**T12. HTML block silently dropped**
```
Input:    "<div>hello</div>"
Expected: markdownToBlocks returns [] (document the data loss)
File:     tests/markdown-to-blocks.test.ts
Type:     unit
Handler:  src/markdown-to-blocks.ts:567-568
```

**T13. Rich text at 2000-char boundary**
```
Input:    "a".repeat(2000) — exactly at limit
          "a".repeat(2001) — one over limit
Expected: document current behavior (no splitting, single rich_text entry)
File:     tests/markdown-to-blocks.test.ts
Type:     unit (characterization test)
Handler:  src/markdown-to-blocks.ts:20-41
```

**T14. Unclosed toggle graceful degradation**
```
Input:    "+++ Title\ncontent with no closing"
Expected: falls back to paragraphs (no crash, no hang)
File:     tests/markdown-to-blocks.test.ts
Type:     unit
Handler:  src/markdown-to-blocks.ts:424-426
```

**T15. Columns with bare text (no ::: column marker)**
```
Input:    "::: columns\njust text\n:::"
Expected: no crash; either drops content or falls back to paragraphs
File:     tests/markdown-to-blocks.test.ts
Type:     unit (defensive)
Handler:  src/markdown-to-blocks.ts:349-370
```

---

## What I didn't explore

- **Notion API server-side normalization**: The API may silently modify rich_text (e.g., stripping trailing whitespace, normalizing Unicode). This audit covers only the local `markdownToBlocks` ↔ `blocksToMarkdown` round-trip, not the full create→read cycle through Notion's servers.
- **`find_replace` / `pages.updateMarkdown` path**: This uses Notion's native markdown parser, which may handle edge cases differently from our `marked`-based pipeline. A separate audit comparing the two paths' behavior on the same inputs would be valuable.
- **Performance / memory on large inputs**: Didn't profile `marked.lexer` or `splitCustomSyntax` on megabyte-scale inputs.
- **`normalizeOrderedListIndentation` edge cases** (`src/markdown-to-blocks.ts:247-285`): This function doubles indentation for ordered sub-lists. Deeply nested ordered lists (4+ levels) may produce unexpected indentation. Didn't enumerate all depth combinations.

# RTL language support — exploration

**Date:** 2026-05-20
**Explorer:** Claude (Opus 4.7 [1M]) under explorer role
**Question (from James):** "Does our MCP work with right-to-left languages at all? Ascertain approximately how big of a change this would be."
**Codex pressure-test session:** `explore-rtl-pressure-v3-2026-05-20` (session id `019e4804-7a18-7b00-aa28-74a2268e6023`); two earlier sessions (`explore-rtl-pressure-test-2026-05-20`, `explore-rtl-pressure-v2-2026-05-20`) exhausted context on file-reading without producing a synthesis response.

## 1. TL;DR

Arabic and Hebrew **work in practice today** for the common case: create / append / read / find_replace all round-trip byte-clean for paragraphs, headings, lists, code blocks, bold/italic, niqqud, and tanwin. Two real gaps: (a) a grapheme-cluster-unaware rich-text splitter at `src/rich-text.ts:15-32` that can cut between a base letter and its combining mark on text runs over 2000 code units — currently masked by Notion's same-annotation segment merge, but unmasked the moment annotations differ across the boundary; and (b) `find_replace` does exact-byte substring matching, so invisible BiDi controls in stored content silently break otherwise-correct find strings. **Total ballpark to make it solid: ~M+S+XS ≈ 2-4 days of focused work**, dominated by the splitter fix and tests.

## 2. Current state

### What works (runtime-verified today against E2E sandbox)

| Scenario | Tool | Result |
|---|---|---|
| Arabic markdown (heading, bold, italic, bullets, code block, tanwin on `ثانٍ`) | `create_page` → `read_page` | Byte-clean round-trip |
| Hebrew with full niqqud (`הַשָּׁלוֹם עֲלֵיכֶם`) | `create_page` → `read_page` | Byte-clean round-trip; combining marks intact |
| Mixed LTR/RTL paragraph (English + Arabic + Hebrew in one sentence, with embedded number `2026` and version `0.9.3`) | `create_page` → `read_page` | Byte-identical; logical order preserved on read |
| `find_replace` Hebrew (`שלום` → `שָׁלוֹם`, replace_all) | `find_replace` | match_count 2, both replaced cleanly |
| `find_replace` Arabic (`مرحبا` → `أَهْلاً`, replace_all) | `find_replace` | match_count 2 |
| `find_replace` find string containing explicit LRM+RLM (`prefix‎mid‏suffix`) | `find_replace` | match_count 1, matched and replaced |
| Long Hebrew paragraph (3001 codepoints, `X` + 1500 × `הַ`) engineered to cut between base `ה` (U+05D4) and `ַ` (U+05B7) at code-unit 2000 | `append_content` → `read_section` → raw blocks API | `blocks_added: 2`; markdown round-trip byte-clean; raw block API showed Notion returned ONE 3405-codeunit segment, so server-side merged the chunks we sent |

### What's confirmed broken

1. **`find_replace` silent miss on invisible BiDi marks.** With stored content `pre‎fix` (LRM U+200E between `pre` and `fix`), the call `find_replace(find="prefix")` returns `total_matches: 0`. Same for `foo‏bar` with RLM. Real-world impact: text editors and copy-paste from RTL UIs frequently inject invisible directional marks; the user reads `prefix`, asks the agent to swap it, the call silently no-ops.

2. **Grapheme-cluster-unaware rich-text splitter.** `src/rich-text.ts:15-32` iterates by Unicode code point but accumulates by UTF-16 code units up to 2000. For any base letter + combining mark pair (Hebrew letter + niqqud, Arabic letter + harakat, ZWJ-joined emoji, devanagari matras, combining accents), the splitter can place the base letter at position 1999 of chunk N and the combining mark at position 0 of chunk N+1. This is **not RTL-specific** — RTL just surfaces it heavily because Hebrew and Arabic use combining marks idiomatically.

### What's untested (and would need live coverage before claiming "fully supported")

Per Codex pressure-test (A): I confirmed segment merging only on **plain paragraph** rich_text. I did NOT verify whether Notion server-side merges adjacent same-annotation segments for these payload types:
- Database property writes: `convertPropertyValue` for `title` and `rich_text` columns routes through `titleRichText` → `splitLongRichText` (`notion-client.ts:96-98, 907-910`).
- Page titles via `createPage` and `updatePage` (`notion-client.ts:1047-1048, 1207`).
- Comments via `addComment` (`notion-client.ts:1505-1509`).
- `table_row.cells` (`rich-text.ts:171`).
- Code block rich_text (likely behaves like paragraph, but unverified).

Any of these could store our chunks verbatim instead of merging, in which case the grapheme split would surface as visible mangling without needing the annotation-difference trigger.

### What's structurally fine

- **Notion API has no RTL/direction/lang/writing-mode field on rich_text or blocks.** Verified by reading `@notionhq/client` type defs: `AnnotationResponse = {bold, italic, strikethrough, underline, code, color}`; `RichTextItemResponseCommon = {plain_text, href, annotations}`. The only `direction` in the SDK is sort direction (`ascending`/`descending`). RTL rendering is entirely Notion's UI responsibility based on text content auto-detection. **There is nothing for us to pass through.**
- All the conversion pipelines (markdown-to-blocks, blocks-to-markdown, the toggle/column/equation custom syntax handling in `splitCustomSyntax`) operate on lines and full strings; nothing slices by character offset into RTL content in a way that would corrupt graphemes. The one place that does fixed-offset slicing is `line.slice(4)` after a `+++ ` prefix for toggle titles (`markdown-to-blocks.ts:397`) — but that operates on the syntax marker `+++ `, which is ASCII, not on the RTL content itself.

## 3. Risk inventory

| # | Risk | Severity | Reproduction |
|---|---|---|---|
| R1 | `find_replace` silent miss when stored content has BiDi controls absent from find string | **P1** | Runtime-confirmed today: stored `pre‎fix` (LRM after `pre`), `find="prefix"` returns `total_matches: 0` with `success: true` |
| R2 | Splitter cuts between base letter and combining mark on text runs > 2000 code units when annotations differ across the boundary | **P2** | Not directly reproduced (would need a stylized payload our markdown pipeline doesn't naturally produce). Static analysis of `splitTextContent`; pressure-test agreed mangling would surface in this case |
| R3 | Splitter behavior on database properties, page titles, comments, table_row.cells, code blocks — Notion-side merge unverified for these paths | **P2** | Not tested. Codex pressure-test (A) flagged these as needing separate live verification |
| R4 | `find_replace` preflight count divergence from Notion server-side replace count under NFC/NFD normalization | **P2** | Not reproduced. Plausible: `countOccurrences` is exact-byte JS substring count on the markdown we retrieve; Notion's server may normalize differently before substitution |
| R5 | `search_in_page` and section-heading matching use locale-insensitive `toLowerCase()` (`server.ts:80-81, 480, 503, 1131, 1248`) — Turkish-i / Greek-sigma / Azerbaijani-ı disagreements | **P3** | Not RTL-specific. Acknowledged by Codex as a possible-in-principle divergence from user expectations; low practical impact in Arabic/Hebrew text since those scripts don't have a Latin-style case fold |
| R6 | `line.slice(4)` toggle-title extraction (`markdown-to-blocks.ts:397`) with BiDi controls embedded in the title after `+++ ` | **P3** | Not reproduced. Plausible: BiDi controls in toggle titles could cause `findToggleRecursive`'s case-insensitive trim+lowercase match to miss the toggle |
| R7 | Page-level direction hint (e.g., setting whole page to RTL) | **N/A** | Notion API doesn't expose this; not our problem to solve |

## 4. Recommended changes — ordered by leverage

### XS · Document `find_replace` exact-byte semantics (R1)

**Files:** `src/server.ts` (the `find_replace` tool description around line 1603), plus a short note in `CLAUDE.md`'s tool conventions if appropriate.

**Justification:** Per Codex pressure-test (D): silent normalization in our preflight wouldn't help because Notion's `pages.updateMarkdown` does its own literal substring substitution server-side. Stripping Cf chars our-side would create a false promise — preflight would say "yes match" while the server-side replace still misses. Honest fix is to document the failure mode so agents know to either: (a) include any BiDi controls in their find string, or (b) use `read_section`/`search_in_page` first to inspect the actual stored bytes.

**Bucket: XS (~1 hour)**, one-paragraph doc update + maybe one example in the tool description string.

### M · Grapheme-cluster-aware `splitTextContent` (R2 + R3)

**Files:** `src/rich-text.ts` (rewrite `splitTextContent` to use `Intl.Segmenter('und', {granularity: 'grapheme'})`). Add tests at `tests/rich-text-write.test.ts` covering:
- Hebrew base letter + niqqud at the 2000-codeunit boundary
- Arabic base letter + harakat (fatha, kasra, damma, sukun, shadda) at the boundary
- Devanagari base + matra
- Combining accent on Latin (e.g., `é` as `e` + U+0301)
- ZWJ-joined emoji sequence (`👨‍👩‍👧`) at the boundary
- Non-BMP supplementary plane characters (already covered, retain)

**Justification:** This is the only structural change that closes the actual risk. Notion's server-side same-annotation merge masks the bug for plain paragraphs (verified live), but: (a) verified only one path; (b) any annotation difference across the boundary unmasks it; (c) Codex flagged that page titles, database properties, comments, and table cells may not merge at all. Fix the root cause once, all paths benefit because they all route through `splitLongRichText`.

**Node 18 caveat (per Codex pressure-test C):** `Intl.Segmenter` is available on Node ≥16 with full-ICU builds, which is the standard configuration. `package.json` declares `engines: { node: ">=18" }`. Minimal-ICU Node builds (rare in practice, but `node-slim` exists) would have `Intl.Segmenter` return undefined or operate in non-standard ways. The fix should include a `typeof Intl.Segmenter === "function"` guard with a fallback path that preserves today's behavior (codepoint-aware, grapheme-naive) and logs a one-time `console.error` warning so the failure mode is at least visible.

**Annotation propagation:** Already handled — `sanitizeTextRichText` (`rich-text.ts:34-51`) copies `annotations` and `text.link` to every output chunk, so a bold split run stays bold across chunks. No additional work here.

**Bucket: M (1-3 days).** Surface area:
- `src/rich-text.ts:15-32` — rewrite (10-15 lines)
- `src/rich-text.ts` — add Intl.Segmenter guard and fallback (10 lines)
- `tests/rich-text-write.test.ts` — 5-8 new test cases (~80-120 lines)
- Optional but recommended: a live e2e test against Notion's actual API to verify the fix holds for page title + database property + table cell paths Codex flagged as untested

### XS-S · Verify the untested paths from Codex challenge A (R3)

**Files:** No product changes. Live verification only.

**Action:** Run live E2E tests writing > 2000-codeunit Hebrew strings (with niqqud landing at the split boundary) to:
- A page title via `create_page` title
- A `title` and `rich_text` database column via `add_database_entry`
- A comment via `add_comment`
- A `table_row.cells` payload

For each, fetch the raw block/page/comment via the Notion API and inspect whether the rich_text array is one merged segment or multiple chunks. If any show multiple chunks with an orphaned combining mark, those paths need the M-bucket fix urgently.

**Bucket: XS if all merge (just record the finding); S if one or more don't merge** (then it becomes a prerequisite for the M fix's test coverage, not a separate code change).

### NOT RECOMMENDED · Explicit `direction` field plumbing

Notion's API has no such field. Adding our own would be invisible — no consumer would see it. Skip.

### NOT RECOMMENDED · BiDi-strip normalization in `find_replace` preflight

Already covered above. Codex pressure-test D agrees: docs-only is the honest fix because the server-side replace is also literal. Don't silently normalize where the server doesn't.

## 5. Open questions

1. **Page title splitter behavior.** Codex flagged this as needing verification. A title at 2000+ code units with niqqud at the boundary may or may not merge. Worth a 30-minute live check before the M fix lands.
2. **`table_row.cells` and database `rich_text` properties merge behavior.** Same as above.
3. **`updateMarkdown` server-side replace under NFC vs NFD.** Does Notion normalize stored markdown before applying a replace? If yes, agent-supplied find strings in one form could match content stored in the other form; if no, our preflight count is honest and there's nothing to fix. Untested.
4. **Less-common RTL scripts.** I tested Arabic and Hebrew. Other RTL scripts have their own combining quirks: Syriac vocalization, N'Ko, Thaana, Mende Kikakui. The Intl.Segmenter fix should handle them by construction (it's grapheme-aware for all scripts), but explicit test coverage is worth considering at the edges.
5. **Notion UI rendering of mixed LTR/RTL.** Our `read_page` returns logical order; Notion's UI applies BiDi reordering for display. I did not open the test pages in Notion's UI to verify rendering matches expectations (needs human eyes on the test sandbox). Marked as **needs UI verification** in the test scenarios above.

## 6. Codex pressure-test notes

- Session: `explore-rtl-pressure-v3-2026-05-20` (id `019e4804-7a18-7b00-aa28-74a2268e6023`). Two earlier attempts (`explore-rtl-pressure-test-2026-05-20`, `explore-rtl-pressure-v2-2026-05-20`) exhausted Codex's 400K context window on file exploration without producing a synthesis response; v3 supplied verbatim file-cited facts up front and asked for short prose answers, which succeeded.
- **Where Codex pushed back:** It refused to extend my "Notion merges adjacent same-annotation segments" finding to page titles, comments, database properties, and table cells — flagged these as needing independent live verification. This narrowed my "untested" caveat from "edge cases" to a concrete list of paths to verify. R3 was added to the inventory after this push-back.
- **NFC/NFD divergence (B-ii):** Codex flagged this as a real risk for `find_replace` preflight vs server-side replace; I had not considered Unicode normalization at all in my initial analysis. R4 was added.
- **Toggle-title `line.slice(4)` (B-iii):** Codex flagged this as plausibly affecting detection if BiDi controls appear inside the toggle title prefix. R6 was added.
- **Where Codex agreed:** M-bucket sizing for the splitter fix held up (1-3 days reasonable, with the Node 18 minimal-ICU guard added); XS docs-only for the `find_replace` BiDi mismatch held up.
- **Where Codex de-emphasized:** R5 (Turkish-i / locale-insensitive `toLowerCase`) — acknowledged as a real edge case but not RTL-specific and low practical impact for Arabic/Hebrew since those scripts lack a Latin-style case fold. Kept at P3.

## 7. Test pages created

All under E2E sandbox `349be876-242f-8027-917d-f17aa85bab5c`. Archived on completion (see commit chain).

| Title | Page ID | Purpose |
|---|---|---|
| RTL Explore — Arabic 2026-05-20 | `367be876-242f-8155-b94c-d095a70fe0c2` | Pure Arabic round-trip |
| RTL Explore — Hebrew 2026-05-20 | `367be876-242f-8165-99ab-d2f5450bfa1e` | Pure Hebrew with niqqud + long-paragraph split-boundary test |
| RTL Explore — Mixed LTR/RTL 2026-05-20 | `367be876-242f-819e-8bbc-c5f12023c26a` | LTR/RTL mixing in one paragraph |
| RTL Explore — find_replace BiDi 2026-05-20 | `367be876-242f-819a-834b-e8715355b536` | find_replace with RTL + BiDi controls |
| RTL Explore — invisible BiDi 2026-05-20 | `367be876-242f-8104-a620-f75451eab38e` | find_replace miss when LRM hidden in stored content |

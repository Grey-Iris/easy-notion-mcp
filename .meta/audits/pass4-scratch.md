# Pass 4: Round-Trip Fidelity Probe

Scope: code-read audit of `src/markdown-to-blocks.ts` and `src/blocks-to-markdown.ts`, with explicit round-trip test lookup in `tests/roundtrip.test.ts` and related tests.

Claim under audit from `CLAUDE.md:116`: "These round-trip cleanly: `read_page` outputs the same conventions that `create_page` accepts."

## Summary

| Construct | Forward | Reverse | Round-trip | Test? |
|---|---|---|---|---|
| Headings | `src/markdown-to-blocks.ts:440-453` | `src/blocks-to-markdown.ts:77-115` | LOSSY | Simple-only: `tests/roundtrip.test.ts:9-13` |
| Inline formatting (`**`, `*`, `~~`, `` ` ``) | `src/markdown-to-blocks.ts:50-125` | `src/blocks-to-markdown.ts:3-30` | LOSSLESS for the supported subset | Yes: `tests/roundtrip.test.ts:15-20` |
| Links | `src/markdown-to-blocks.ts:50-125,454-529` | `src/blocks-to-markdown.ts:3-30,116-117` | LOSSY | Partial: `tests/roundtrip.test.ts:15-20,205-209` |
| Images | `src/markdown-to-blocks.ts:455-476` | `src/blocks-to-markdown.ts:206-211` | LOSSY | Partial: `tests/roundtrip.test.ts:187-191` |
| Bulleted lists | `src/markdown-to-blocks.ts:146-185` | `src/blocks-to-markdown.ts:124-127` | LOSSLESS for ordinary nested bullets | Yes: `tests/roundtrip.test.ts:22-26` |
| Numbered lists | `src/markdown-to-blocks.ts:146-185,247-285,656-657` | `src/blocks-to-markdown.ts:128-131` | LOSSY | Partial: `tests/roundtrip.test.ts:28-32` |
| Task lists | `src/markdown-to-blocks.ts:146-163` | `src/blocks-to-markdown.ts:196-199` | LOSSY | Partial: `tests/roundtrip.test.ts:34-38` |
| Tables | `src/markdown-to-blocks.ts:225-229,535-553` | `src/blocks-to-markdown.ts:32-35,157-169` | LOSSY | Partial: `tests/roundtrip.test.ts:63-72` |
| Code blocks | `src/markdown-to-blocks.ts:555-564` | `src/blocks-to-markdown.ts:188-193` | LOSSLESS for ordinary fenced blocks | Yes: `tests/roundtrip.test.ts:40-61` |
| Blockquotes | `src/markdown-to-blocks.ts:188-223,533-534` | `src/blocks-to-markdown.ts:132-136` | LOSSY | Simple-only: `tests/roundtrip.test.ts:74-78` |
| Divider | `src/markdown-to-blocks.ts:565-566` | `src/blocks-to-markdown.ts:194-195` | LOSSY on formatting | Partial: `tests/roundtrip.test.ts:175-179` |
| Toggle | `src/markdown-to-blocks.ts:296-438,579-628` | `src/blocks-to-markdown.ts:118-123` | LOSSLESS for the supported form | Yes: `tests/roundtrip.test.ts:94-115,211-215` |
| Toggle heading H1 | `src/markdown-to-blocks.ts:579-617` | `src/blocks-to-markdown.ts:77-89` | NOT TESTED | No explicit round-trip assertion |
| Toggle heading H2 | `src/markdown-to-blocks.ts:579-617` | `src/blocks-to-markdown.ts:90-102` | LOSSLESS for the supported form | Yes: `tests/roundtrip.test.ts:117-125` |
| Toggle heading H3 | `src/markdown-to-blocks.ts:579-617` | `src/blocks-to-markdown.ts:103-115` | LOSSLESS in the nested case | Yes, indirectly: `tests/roundtrip.test.ts:128-148` |
| Columns | `src/markdown-to-blocks.ts:296-438,631-645` | `src/blocks-to-markdown.ts:172-185` | LOSSLESS for the supported form | Yes: `tests/roundtrip.test.ts:150-163` |
| Callouts | `src/markdown-to-blocks.ts:188-215,533-534` | `src/blocks-to-markdown.ts:137-154` | LOSSY outside the narrow mapped-label case | Partial: `tests/roundtrip.test.ts:80-92` |
| Equation | `src/markdown-to-blocks.ts:296-438,647-653` | `src/blocks-to-markdown.ts:155-156` | LOSSY | Partial: `tests/roundtrip.test.ts:165-173` |
| Table of contents | `src/markdown-to-blocks.ts:514-520` | `src/blocks-to-markdown.ts:200-201` | LOSSLESS | Yes: `tests/roundtrip.test.ts:199-203` |
| Embed | `src/markdown-to-blocks.ts:495-500` | `src/blocks-to-markdown.ts:204-205` | LOSSLESS for the supported form | Yes: `tests/roundtrip.test.ts:193-197` |
| Bookmark | `src/markdown-to-blocks.ts:232-241,502-511` | `src/blocks-to-markdown.ts:202-203` | LOSSLESS for the supported form | Yes: `tests/roundtrip.test.ts:181-185` |

## Findings

### RT-1: Headings
**Claim under test:** "Headings round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:440-453`
**Reverse path:** `src/blocks-to-markdown.ts:77-115`
**Round-trip status:** LOSSY. Plain headings with `children` render as a heading followed by ordinary markdown blocks, but the forward parser never reattaches those blocks as heading children.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy.
**Evidence:**
- Forward only maps markdown heading tokens to standalone blocks:
  - `if (token.depth === 1) return [{ type: "heading_1", heading_1: { rich_text: richText } }];`
  - same for H2/H3 in `src/markdown-to-blocks.ts:445-452`
- Reverse has a special case for heading children:
  - `if (h1Children.length > 0) return \`${h1Text}\n\n${renderBlocks(h1Children, indent)}\`;`
  - same pattern for H2/H3 in `src/blocks-to-markdown.ts:85-86,98-99,111-112`
- The round-trip test covers only childless headings: `tests/roundtrip.test.ts:9-13`.
**Test coverage:** `tests/roundtrip.test.ts:9-13` only covers simple H1/H2/H3. No round-trip test for heading children or headings with inline code.
**Severity if lossy:** high
**Counter-argument:** If headings are only ever created from markdown, they will not have `children`, so the common path is fine. This breaks when `read_page` sees existing Notion heading children or if future code emits them.

### RT-2: Inline Formatting (`**`, `*`, `~~`, `` ` ``)
**Claim under test:** "Bold / italic / strikethrough / inline code round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:50-125`
**Reverse path:** `src/blocks-to-markdown.ts:3-30`
**Round-trip status:** LOSSLESS for the supported subset.
**If lossy, is it lossy on meaning or just formatting?** N/A for the supported subset.
**Evidence:**
- Forward maps `strong`, `em`, `del`, and `codespan` into annotations in `src/markdown-to-blocks.ts:58-89`.
- Reverse reapplies `code`, `bold`, `italic`, and `strikethrough` wrappers in `src/blocks-to-markdown.ts:7-18`.
- Explicit round-trip test: `tests/roundtrip.test.ts:15-20`.
**Test coverage:** `tests/roundtrip.test.ts:15-20`
**Severity if lossy:** low
**Counter-argument:** This is the cleanest part of the claim. The caveat is that reverse ignores Notion `underline` and `color` annotations even though `RichText` allows them (`src/types.ts:4-10`), but those are outside the advertised markdown subset.

### RT-3: Links
**Claim under test:** "Links round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:50-125,454-529`
**Reverse path:** `src/blocks-to-markdown.ts:19-21,26-30,116-117`
**Round-trip status:** LOSSY. Link titles are dropped, and inline bare URLs normalize to `[url](url)` rather than the original autolink/raw syntax.
**If lossy, is it lossy on meaning or just formatting?** Mostly formatting-lossy for raw autolinks; title loss is metadata loss.
**Evidence:**
- Forward only preserves URL and linked text:
  - `richText.text.link = { url: link };` in `src/markdown-to-blocks.ts:32-34`
  - link handling passes `token.href` but never stores `token.title` in `src/markdown-to-blocks.ts:91-100`
- Reverse always emits standard link syntax:
  - `result = \`[${result}](${richText.text.link.url})\`;` in `src/blocks-to-markdown.ts:19-21`
- Explicit round-trip tests cover a named link in a paragraph and a named-link paragraph vs bookmark distinction:
  - `tests/roundtrip.test.ts:15-20`
  - `tests/roundtrip.test.ts:205-209`
**Test coverage:** Named links only. No round-trip test for link titles or inline raw URLs.
**Severity if lossy:** medium
**Counter-argument:** `create_page` accepts the serializer’s canonical `[text](url)` form, so the interface remains usable. The claim is still too strong if "same conventions" includes title attributes or raw autolink spelling.

### RT-4: Images
**Claim under test:** "Images round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:455-476`
**Reverse path:** `src/blocks-to-markdown.ts:206-211`
**Round-trip status:** LOSSY. Alt text and image title are discarded; reverse always emits `![](...)`.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy if alt text carries content or accessibility intent.
**Evidence:**
- Forward recognizes a standalone image token but only reads `href`:
  - `const href = token.tokens[0].href ?? "";` in `src/markdown-to-blocks.ts:456`
  - no use of alt/title anywhere in `src/markdown-to-blocks.ts:455-476`
- Reverse emits URL only:
  - `return \`${prefix}![](${url})\`;` in `src/blocks-to-markdown.ts:206-211`
- The round-trip suite only tests empty-alt syntax: `tests/roundtrip.test.ts:187-191`.
**Test coverage:** `tests/roundtrip.test.ts:187-191` only covers `![](url)`.
**Severity if lossy:** medium
**Counter-argument:** Notion image blocks do not naturally map to markdown alt/title metadata, so some loss is hard to avoid. The defense is "we only promise URL-only image syntax," but that is narrower than "standard markdown images."

### RT-5: Bulleted Lists
**Claim under test:** "Bulleted lists round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:146-185`
**Reverse path:** `src/blocks-to-markdown.ts:124-127`
**Round-trip status:** LOSSLESS for ordinary nested bullet lists.
**If lossy, is it lossy on meaning or just formatting?** N/A for the covered case.
**Evidence:**
- Forward converts unordered list items to `bulleted_list_item` and recurses into child lists in `src/markdown-to-blocks.ts:149-185`.
- Reverse emits `- ` plus recursively rendered children in `src/blocks-to-markdown.ts:124-127` and `65-71`.
- Explicit round-trip test: `tests/roundtrip.test.ts:22-26`.
**Test coverage:** `tests/roundtrip.test.ts:22-26`
**Severity if lossy:** low
**Counter-argument:** This looks fine for ordinary bullet nesting. Mixed bullet/numbered nesting is not explicitly round-trip tested, but the recursive structure suggests it should work.

### RT-6: Numbered Lists
**Claim under test:** "Numbered lists round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:146-185,247-285,656-657`
**Reverse path:** `src/blocks-to-markdown.ts:128-131`
**Round-trip status:** LOSSY. Original start numbers are discarded and reverse always emits `1.`.
**If lossy, is it lossy on meaning or just formatting?** Potentially meaning-lossy when the starting number matters.
**Evidence:**
- Forward stores only list item content and ordered-ness:
  - `token.ordered ? { type: "numbered_list_item", ... }` in `src/markdown-to-blocks.ts:165-180`
  - there is no field for list start/index
- Reverse hardcodes `1.`:
  - `return \`${prefix}1. ${richTextToMarkdown(...)}...\`;` in `src/blocks-to-markdown.ts:128-131`
- `normalizeOrderedListIndentation` in `src/markdown-to-blocks.ts:247-285` adjusts indentation for parsing, but does not preserve original numbering.
- Round-trip test only uses lists that already start at `1`: `tests/roundtrip.test.ts:28-32`.
**Test coverage:** `tests/roundtrip.test.ts:28-32` only covers `1.`-started lists.
**Severity if lossy:** medium
**Counter-argument:** Many markdown renderers treat `1.` as a canonical ordered-list marker, so the visual result is often fine. It is still not a clean round trip if someone intentionally wrote `3.`, `7.`, or a restart point.

### RT-7: Task Lists
**Claim under test:** "Task lists round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:146-163`
**Reverse path:** `src/blocks-to-markdown.ts:196-199`
**Round-trip status:** LOSSY. Flat task lists work, but nested content under a task item is dropped by the forward converter and cannot be re-emitted.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy.
**Evidence:**
- Forward computes child lists for all items, but in the task branch it throws them away:
  - `const children = ...` in `src/markdown-to-blocks.ts:149-152`
  - `if (item.task) { blocks.push({ type: "to_do", ... }); continue; }` in `src/markdown-to-blocks.ts:154-163`
- `to_do` in `src/types.ts:69` has no `children`.
- Reverse can only emit a flat item:
  - `return \`${prefix}- [${block.to_do.checked ? "x" : " "}] ${...}\`;` in `src/blocks-to-markdown.ts:196-199`
- The round-trip test is flat-only: `tests/roundtrip.test.ts:34-38`.
**Test coverage:** `tests/roundtrip.test.ts:34-38` only covers two flat items. No round-trip test for nested tasks or rich formatting inside tasks.
**Severity if lossy:** high
**Counter-argument:** If the interface only intends flat checkbox lists, the common case is okay. The claim is too broad as written because nested markdown task lists are a standard thing users will try.

### RT-8: Tables
**Claim under test:** "Tables round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:225-229,535-553`
**Reverse path:** `src/blocks-to-markdown.ts:32-35,157-169`
**Round-trip status:** LOSSY. Reverse always serializes the first row as a markdown header row and ignores `has_column_header` / `has_row_header`; complex cells with pipes/newlines are also unsafe.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy for header semantics; formatting/parse-lossy for complex cells.
**Evidence:**
- Forward always creates markdown-originated tables as `has_column_header: true` and `has_row_header: false`:
  - `table: { table_width: ..., has_column_header: true, has_row_header: false, children: ... }` in `src/markdown-to-blocks.ts:545-551`
- Reverse never reads those flags:
  - it blindly does `const [headerRow, ...bodyRows] = rows;`
  - then emits `| --- | ... |` from that first row in `src/blocks-to-markdown.ts:165-168`
- Row rendering is raw string join with no escaping:
  - `return \`| ${cells.join(" | ")} |\`;` in `src/blocks-to-markdown.ts:32-35`
- Round-trip test only covers a standard markdown table with a header row: `tests/roundtrip.test.ts:63-72`.
**Test coverage:** `tests/roundtrip.test.ts:63-72` only covers ordinary headered tables. One-way tests cover bold text in cells (`tests/markdown-to-blocks.test.ts:552-575`, `tests/blocks-to-markdown.test.ts:283-307`), but not table round-trip with links/code/pipes/newlines or non-header tables.
**Severity if lossy:** critical
**Counter-argument:** If the only source of tables is markdown input, the serializer’s headered-table convention is consistent. The claim breaks for `read_page` on existing Notion tables with different header flags, which is exactly the risky direction.

### RT-9: Code Blocks
**Claim under test:** "Code blocks round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:555-564`
**Reverse path:** `src/blocks-to-markdown.ts:188-193`
**Round-trip status:** LOSSLESS for ordinary fenced code blocks.
**If lossy, is it lossy on meaning or just formatting?** Minor formatting normalization only if the original used tildes instead of backticks.
**Evidence:**
- Forward stores code content as plain text and keeps `token.lang || "plain text"` in `src/markdown-to-blocks.ts:555-563`.
- Reverse emits fenced code with the stored language, except `"plain text"` becomes a bare fence in `src/blocks-to-markdown.ts:188-193`.
- Explicit round-trip tests cover both with and without language: `tests/roundtrip.test.ts:40-61`.
**Test coverage:** `tests/roundtrip.test.ts:40-61`
**Severity if lossy:** low
**Counter-argument:** This is fine for the normal case. The only nit is canonicalization to backticks, which is not a structural problem.

### RT-10: Blockquotes
**Claim under test:** "Blockquotes round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:188-223,533-534`
**Reverse path:** `src/blocks-to-markdown.ts:132-136`
**Round-trip status:** LOSSY. The forward converter only inspects the first blockquote child token/paragraph, so multi-paragraph or nested-content blockquotes are not preserved.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy.
**Evidence:**
- Forward extracts one string:
  - `const paragraphText = token.tokens?.[0]?.text ?? token.text ?? "";` in `src/markdown-to-blocks.ts:189`
  - that single string becomes either a callout or a quote in `src/markdown-to-blocks.ts:194-223`
- Reverse simply prefixes each line with `> ` in `src/blocks-to-markdown.ts:132-136`.
- The round-trip test is a single-line quote only: `tests/roundtrip.test.ts:74-78`.
**Test coverage:** `tests/roundtrip.test.ts:74-78` only covers the trivial single-paragraph case.
**Severity if lossy:** high
**Counter-argument:** If users only use simple single-paragraph quotes, this behaves well. The implementation is not robust enough to justify a blanket round-trip claim for general markdown blockquotes.

### RT-11: Divider
**Claim under test:** "Dividers round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:565-566`
**Reverse path:** `src/blocks-to-markdown.ts:194-195`
**Round-trip status:** LOSSY. Horizontal-rule variants normalize to `---`.
**If lossy, is it lossy on meaning or just formatting?** Formatting-only.
**Evidence:**
- Forward turns any markdown `hr` token into `{ type: "divider" }` in `src/markdown-to-blocks.ts:565-566`.
- Reverse always emits `---` in `src/blocks-to-markdown.ts:194-195`.
- Round-trip test only checks `---`: `tests/roundtrip.test.ts:175-179`.
**Test coverage:** `tests/roundtrip.test.ts:175-179`
**Severity if lossy:** low
**Counter-argument:** This is acceptable canonicalization unless the project means byte-for-byte markdown preservation.

### RT-12: Toggle
**Claim under test:** "Plain toggles round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:296-438,579-628`
**Reverse path:** `src/blocks-to-markdown.ts:118-123`
**Round-trip status:** LOSSLESS for the supported `+++ Title ... +++` form.
**If lossy, is it lossy on meaning or just formatting?** N/A for the supported form.
**Evidence:**
- `splitCustomSyntax` recognizes `+++ ` and captures nested markdown until a closing `+++` in `src/markdown-to-blocks.ts:329-343,388-394,424-437`.
- The final toggle conversion is:
  - `type: "toggle", toggle: { rich_text: blockTextToRichText(segment.title), ...(segment.content.trim() ? { children: markdownToBlocks(segment.content) } : {}) }` in `src/markdown-to-blocks.ts:618-627`
- Reverse uses the same delimiter family:
  - `return \`${prefix}+++ ${title}${childContent}\n${prefix}+++\`;` in `src/blocks-to-markdown.ts:118-123`
- Explicit round-trip tests cover content, nested blocks, and empty toggles:
  - `tests/roundtrip.test.ts:94-115`
  - `tests/roundtrip.test.ts:211-215`
**Test coverage:** `tests/roundtrip.test.ts:94-115,211-215`
**Severity if lossy:** low
**Counter-argument:** This part of the custom syntax is well-supported. Plain nested toggles are not explicitly round-trip tested, but the recursive design looks sound.

### RT-13: Toggle Heading H1
**Claim under test:** "`+++ # Title` round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:579-617`
**Reverse path:** `src/blocks-to-markdown.ts:77-89`
**Round-trip status:** NOT TESTED
**If lossy, is it lossy on meaning or just formatting?** N/A by code reading; likely lossless for simple cases.
**Evidence:**
- Forward detects `segment.title.match(/^(#{1,3})\s+(.*)$/)` and emits `heading_1` with `is_toggleable: true` in `src/markdown-to-blocks.ts:581-597`.
- Reverse emits `+++ # ${h1Title}` when `heading_1.is_toggleable` is true in `src/blocks-to-markdown.ts:80-83`.
- There are one-way tests in:
  - `tests/markdown-to-blocks.test.ts:659-672`
  - `tests/blocks-to-markdown.test.ts:527-542`
- There is no explicit H1 toggle-heading round-trip assertion in `tests/roundtrip.test.ts`.
**Test coverage:** none
**Severity if lossy:** low
**Counter-argument:** The code paths are symmetric enough that this is probably fine. The missing round-trip test is still worth flagging because the project explicitly claims this guarantee.

### RT-14: Toggle Heading H2
**Claim under test:** "`+++ ## Title` round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:579-617`
**Reverse path:** `src/blocks-to-markdown.ts:90-102`
**Round-trip status:** LOSSLESS for the supported form.
**If lossy, is it lossy on meaning or just formatting?** N/A for the covered case.
**Evidence:**
- Forward emits `heading_2` with `is_toggleable: true` in `src/markdown-to-blocks.ts:599-607`.
- Reverse emits `+++ ## ${h2Title}` when toggleable in `src/blocks-to-markdown.ts:93-96`.
- Explicit round-trip test: `tests/roundtrip.test.ts:117-125`.
**Test coverage:** `tests/roundtrip.test.ts:117-125`
**Severity if lossy:** low
**Counter-argument:** This is one of the stronger custom-convention paths.

### RT-15: Toggle Heading H3
**Claim under test:** "`+++ ### Title` round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:579-617`
**Reverse path:** `src/blocks-to-markdown.ts:103-115`
**Round-trip status:** LOSSLESS in the nested case that is actually tested.
**If lossy, is it lossy on meaning or just formatting?** N/A for the covered case.
**Evidence:**
- Forward emits `heading_3` with `is_toggleable: true` in `src/markdown-to-blocks.ts:609-616`.
- Reverse emits `+++ ### ${h3Title}` when toggleable in `src/blocks-to-markdown.ts:106-109`.
- Explicit round-trip coverage exists inside the nested H2/H3 test:
  - `tests/roundtrip.test.ts:128-148`
- One-way tests also exist:
  - `tests/markdown-to-blocks.test.ts:674-687`
  - `tests/blocks-to-markdown.test.ts:544-559`
**Test coverage:** `tests/roundtrip.test.ts:128-148` indirectly covers H3.
**Severity if lossy:** low
**Counter-argument:** Isolated H3 round-trip coverage would still be cleaner, but the nested test does exercise the syntax.

### RT-16: Columns
**Claim under test:** "Column layouts round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:296-438,631-645`
**Reverse path:** `src/blocks-to-markdown.ts:172-185`
**Round-trip status:** LOSSLESS for the supported `::: columns / ::: column / :::` form.
**If lossy, is it lossy on meaning or just formatting?** N/A for the covered case.
**Evidence:**
- `splitCustomSyntax` collects column bodies between `::: columns`, `::: column`, and `:::` in `src/markdown-to-blocks.ts:346-370,396-402,428-437`.
- Forward creates a `column_list` whose `column.children` are recursively parsed markdown in `src/markdown-to-blocks.ts:631-644`.
- Reverse uses the same delimiters:
  - `return \`${prefix}::: columns\n${rendered}\n${prefix}:::\`;` in `src/blocks-to-markdown.ts:172-185`
- Explicit round-trip test: `tests/roundtrip.test.ts:150-163`.
**Test coverage:** `tests/roundtrip.test.ts:150-163`
**Severity if lossy:** low
**Counter-argument:** Columns look solid for the happy path. Toggles inside columns are not explicitly round-trip tested, but recursion suggests they should work.

### RT-17: Callouts
**Claim under test:** "`> [!NOTE]` / `TIP` / `WARNING` / `IMPORTANT` / `INFO` / `SUCCESS` / `ERROR` round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:188-215,533-534`
**Reverse path:** `src/blocks-to-markdown.ts:137-154`
**Round-trip status:** LOSSY outside the narrow mapped-label case. The advertised labels round-trip, but arbitrary callout icons collapse to one of seven labels or default to `NOTE`, and multi-paragraph bodies are not represented.
**If lossy, is it lossy on meaning or just formatting?** Meaning-lossy.
**Evidence:**
- Forward recognizes only seven labels via regex:
  - `/^\[!(NOTE|TIP|WARNING|IMPORTANT|INFO|SUCCESS|ERROR)\]...$/i` in `src/markdown-to-blocks.ts:190-191`
  - it then maps them to a fixed emoji set in `src/markdown-to-blocks.ts:197-206`
- Reverse infers label from emoji and defaults unknown icons to `NOTE`:
  - `const emojiToLabel = { ... }` in `src/blocks-to-markdown.ts:139-147`
  - `const label = emojiToLabel[emoji ?? ""] ?? "NOTE";` in `src/blocks-to-markdown.ts:148`
- Because `blockquoteToBlock` starts from `token.tokens?.[0]?.text`, multi-paragraph callout content is not structurally preserved either (`src/markdown-to-blocks.ts:189`).
- The round-trip suite covers simple mapped labels only: `tests/roundtrip.test.ts:80-92`.
**Test coverage:** `tests/roundtrip.test.ts:80-92` only covers one-paragraph callouts using the seven supported labels.
**Severity if lossy:** medium
**Counter-argument:** If the project only wants exactly those seven labels and plain paragraph bodies, the claim is defensible for that subset. It is not defensible for arbitrary existing Notion callouts coming back through `read_page`.

### RT-18: Equation
**Claim under test:** "Equations round-trip cleanly"
**Forward path:** `src/markdown-to-blocks.ts:296-438,647-653`
**Reverse path:** `src/blocks-to-markdown.ts:155-156`
**Round-trip status:** LOSSY. Multi-line wrapper syntax is normalized to single-line output, and a true expression containing embedded newlines would serialize to a form the forward splitter does not recognize.
**If lossy, is it lossy on meaning or just formatting?** Formatting-lossy for wrapper normalization; potentially meaning-lossy for newline-containing expressions.
**Evidence:**
- Forward accepts both:
  - block form starting with a line exactly equal to `$$` in `src/markdown-to-blocks.ts:373-385,405-409`
  - single-line form `$$expr$$` in `src/markdown-to-blocks.ts:412-418`
- Reverse always emits `$$${block.equation.expression}$$` in `src/blocks-to-markdown.ts:155-156`.
- The explicit round-trip suite already documents normalization:
  - `tests/roundtrip.test.ts:171-173` expects `$$\nE=mc^2\n$$` to come back as `$$E=mc^2$$`
- There is no validation of Notion's supported LaTeX subset; the converters treat the equation body as opaque text.
**Test coverage:** `tests/roundtrip.test.ts:165-173`
**Severity if lossy:** high
**Counter-argument:** If all equations are single-line expressions, this is workable. The multi-line syntax in `CLAUDE.md` overstates the fidelity because serializer output is not symmetric with the parser’s full accepted form.

### RT-19: Table of Contents
**Claim under test:** "`[toc]` round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:514-520`
**Reverse path:** `src/blocks-to-markdown.ts:200-201`
**Round-trip status:** LOSSLESS
**If lossy, is it lossy on meaning or just formatting?** N/A
**Evidence:**
- Forward special-cases a paragraph whose only text token is `[toc]` in `src/markdown-to-blocks.ts:514-520`.
- Reverse emits `[toc]` in `src/blocks-to-markdown.ts:200-201`.
- Explicit round-trip test: `tests/roundtrip.test.ts:199-203`.
**Test coverage:** `tests/roundtrip.test.ts:199-203`
**Severity if lossy:** low
**Counter-argument:** None needed; this path is straightforward.

### RT-20: Embed
**Claim under test:** "`[embed](url)` round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:495-500`
**Reverse path:** `src/blocks-to-markdown.ts:204-205`
**Round-trip status:** LOSSLESS for the supported form.
**If lossy, is it lossy on meaning or just formatting?** N/A for the supported form.
**Evidence:**
- Forward recognizes a paragraph consisting of one link whose text is exactly `embed` in `src/markdown-to-blocks.ts:495-500`.
- Reverse emits `[embed](url)` in `src/blocks-to-markdown.ts:204-205`.
- Explicit round-trip test: `tests/roundtrip.test.ts:193-197`.
**Test coverage:** `tests/roundtrip.test.ts:193-197`
**Severity if lossy:** low
**Counter-argument:** This is clean as long as the exact custom syntax is used.

### RT-21: Bookmark
**Claim under test:** "Bare URL on its own line round-trips cleanly"
**Forward path:** `src/markdown-to-blocks.ts:232-241,502-511`
**Reverse path:** `src/blocks-to-markdown.ts:202-203`
**Round-trip status:** LOSSLESS for the supported form.
**If lossy, is it lossy on meaning or just formatting?** N/A for the supported form.
**Evidence:**
- Forward only upgrades a paragraph to a bookmark if it is a single link token and the link text equals the href in `src/markdown-to-blocks.ts:232-241,502-511`.
- Reverse emits the bare URL in `src/blocks-to-markdown.ts:202-203`.
- Explicit round-trip test: `tests/roundtrip.test.ts:181-185`.
**Test coverage:** `tests/roundtrip.test.ts:181-185`
**Severity if lossy:** low
**Counter-argument:** This works for the advertised bookmark syntax. Named links correctly stay paragraph links instead of becoming bookmarks.

## Edge Cases Requested

### Empty content
- Empty toggle is explicitly round-trip tested: `tests/roundtrip.test.ts:211-215`.
- Empty callout, empty column, empty table, and empty bookmark/embed cases are not explicitly round-trip tested.

### Nested toggles
- Nested toggle headings are explicitly round-trip tested in `tests/roundtrip.test.ts:128-148`.
- Plain toggle-inside-toggle is not explicitly round-trip tested, though the recursive parser likely supports it.

### Toggles inside columns
- No explicit round-trip test.
- Code path is recursive through `markdownToBlocks(column)` at `src/markdown-to-blocks.ts:636-640` and `renderBlocks(column.column.children ?? [], indent)` at `src/blocks-to-markdown.ts:176-181`, so it likely works.

### Callout with embedded link
- No explicit round-trip test.
- Likely supported for simple one-paragraph bodies because callout content is re-parsed through `blockTextToRichText(content)` at `src/markdown-to-blocks.ts:208-213`, and reverse uses `richTextToMarkdown(...)` at `src/blocks-to-markdown.ts:149-153`.
- Still exposed to the broader callout limitations above.

### Equation with LaTeX Notion supports vs doesn't
- No validation layer exists in either converter. Unsupported LaTeX is neither rejected nor normalized; runtime acceptance depends on Notion.
- Separate from that, newline handling is asymmetric as noted in RT-18.

### Tables with complex formatting
- One-way tests cover bold in cells:
  - `tests/markdown-to-blocks.test.ts:552-575`
  - `tests/blocks-to-markdown.test.ts:283-307`
- No explicit round-trip tests for links, code spans, pipes, or line breaks inside cells.
- Raw `|` joining in `src/blocks-to-markdown.ts:32-35` is the biggest red flag.

### Numbered list starting at non-1
- No explicit round-trip test.
- Definitely lossy because reverse always emits `1.` (`src/blocks-to-markdown.ts:128-131`).

### Task list with rich-text formatting inside
- No explicit round-trip test.
- Likely supported for inline formatting because task items use `listItemToRichText(...)` at `src/markdown-to-blocks.ts:127-143` and `richTextToMarkdown(...)` at `src/blocks-to-markdown.ts:197-199`.
- Nested children under tasks are still lost.

### Nested lists mixing bullet and numbered
- No explicit round-trip test.
- The recursive list converter in `src/markdown-to-blocks.ts:146-185` and recursive renderer in `src/blocks-to-markdown.ts:65-71,124-131` suggest this should work, subject to numbered-list canonicalization to `1.`.

### Rich text inside callouts
- No explicit round-trip test.
- Same inline rich-text path as ordinary paragraphs is used, but only for the first blockquote paragraph token.

### Rich text inside table cells
- No explicit round-trip round-trip test.
- Same inline conversion helpers are used (`src/markdown-to-blocks.ts:537-540`, `src/blocks-to-markdown.ts:32-35`), so simple formatting should survive; escaping/line-break issues remain.

### Headings with inline code
- No explicit round-trip test.
- Likely supported because heading titles use `inlineTokensToRichText(...)` on the way in and `richTextToMarkdown(...)` on the way out (`src/markdown-to-blocks.ts:445`, `src/blocks-to-markdown.ts:78,91,104`).

### Images with title attribute
- No explicit round-trip test.
- Title is not stored anywhere in the converter; it is lost.

### Links with title attribute
- No explicit round-trip test.
- Title is not stored anywhere in the converter; it is lost.

## Bottom Line

The claim in `CLAUDE.md:116` is too strong as written.

What is genuinely clean:
- ordinary paragraphs with supported inline formatting
- simple headings without children
- plain toggles
- toggle heading H2/H3 in the tested cases
- columns in the tested form
- bookmarks, embeds, `[toc]`
- simple fenced code blocks

What is not clean, or not proved clean:
- headings with children
- numbered lists that do not start at `1`
- task items with nested children
- tables, especially existing Notion tables with non-default header flags
- blockquotes/callouts with more than one paragraph or non-mapped callout icons
- images and links with title/alt metadata
- equations beyond the single-line canonical form

If the project wants to keep the current wording, it should narrow the claim to "the supported canonical markdown subset round-trips cleanly." As written, "read_page outputs the same conventions that create_page accepts" overpromises on several load-bearing cases.

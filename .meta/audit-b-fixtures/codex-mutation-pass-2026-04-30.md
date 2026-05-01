# Codex mutation pass - 2026-04-30

Read-only analysis of `src/` at `dev` commit `0ea4efd`. I did not edit source files or run live Notion e2e. Verdicts below are based on the concrete mutation diff and the current unit-test assertions in `tests/**/*.test.ts`.

## Summary

- Total mutations tried: 51
- Total CAUGHT: 43
- Total MISSED: 8

Worst missed contracts:

1. `markdown-to-enhanced` table metadata can be dropped (`header-row` / `header-column`) without a unit failure; tests only look for `<table`, `<tr>`, and sample cells.
2. `markdown-to-enhanced` table row order can be inverted without a unit failure; tests do not assert full table XML or ordering.
3. `markdown-to-enhanced` table cell order can be inverted without a unit failure; tests only assert cell presence.
4. `markdown-to-enhanced` column order can be reversed without a unit failure; tests only assert wrapper/content presence.
5. `escapeBodyText` can stop escaping `{}` without a unit failure; current XML-safety tests cover `<`, `>`, `|`, and closing tags, not braces.
6. `convertPropertyValue("date")` can emit `{ date: {} }` instead of `{ date: { start } }` without a listed unit failure.
7. `convertPropertyValue("number")` can send a string number without a listed unit failure.
8. `convertPropertyValue("multi_select")` can collapse an array to one option without a listed unit failure.

## 1. Translator: `src/markdown-to-enhanced.ts`

### T1 paragraph text
- **Mutation**: `return indent(richTextToEnhanced(b.paragraph.rich_text, options), depth);` -> `return indent("BROKEN " + richTextToEnhanced(b.paragraph.rich_text, options), depth);`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:19-33`.
- **Verdict**: CAUGHT. `expect(enhanced).toBe("Hello world.")` and inline/link exact assertions break.
- **Severity if missed**: High; top-level text corruption.

### T2 heading_1 marker
- **Mutation**: `` `# ${text}${toggle}` `` -> `` `## ${text}${toggle}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:35-37`.
- **Verdict**: CAUGHT by `expect(...).toBe("# H1")`.
- **Severity if missed**: High; document structure changes.

### T3 heading_2 marker
- **Mutation**: `` `## ${text}${toggle}` `` -> `` `# ${text}${toggle}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:39-41`.
- **Verdict**: CAUGHT by `expect(...).toBe("## H2")`.
- **Severity if missed**: High.

### T4 heading_3 marker
- **Mutation**: `` `### ${text}${toggle}` `` -> `` `## ${text}${toggle}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:43-45`.
- **Verdict**: CAUGHT by `expect(...).toBe("### H3")`.
- **Severity if missed**: Medium-high.

### T5 bulleted list marker
- **Mutation**: `` `- ${text}` `` -> `` `* ${text}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:62-64`.
- **Verdict**: CAUGHT by exact `"- bullet body"`.
- **Severity if missed**: Medium; probably still Markdown but contract drift.

### T6 numbered list marker
- **Mutation**: `` `1. ${text}` `` -> `` `2. ${text}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:66-68`.
- **Verdict**: CAUGHT by exact `"1. numbered body"`.
- **Severity if missed**: Medium.

### T7 to_do checked state
- **Mutation**: `const checked = b.to_do.checked ? "x" : " ";` -> `const checked = b.to_do.checked ? " " : "x";`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:115-121`.
- **Verdict**: CAUGHT by checked and unchecked exact assertions.
- **Severity if missed**: High; task state corruption.

### T8 quote marker
- **Mutation**: `` `> ${richTextToEnhanced(...)}` `` -> `` `${richTextToEnhanced(...)}` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:70-72`.
- **Verdict**: CAUGHT by exact `"> quote body"`.
- **Severity if missed**: Medium.

### T9 callout color mapping
- **Mutation**: `TIP: { icon: "💡", color: "green_background" }` -> `TIP: { icon: "💡", color: "red_background" }`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:74-95`.
- **Verdict**: CAUGHT by the `it.each` exact icon/color assertion for `TIP`.
- **Severity if missed**: High; this is one of the PR3 failure modes.

### T10 callout XML escaping for `<`
- **Mutation**: `return value.replace(/[\\*~` + "`" + `$\\[\\]<>{}|^]/g, ...)` -> remove `<` from the character class.
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:153-166`.
- **Verdict**: CAUGHT by exact `Use \\<tag\\> here` and details summary/body assertions.
- **Severity if missed**: High; user text can close or create Enhanced Markdown XML.

### T11 body escaping for braces
- **Mutation**: `return value.replace(/[\\*~` + "`" + `$\\[\\]<>{}|^]/g, ...)` -> remove `{}` from the character class.
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:153-178`.
- **Verdict**: MISSED. Existing escape tests cover closing XML tags, generic `<tag>`, details XML-like text, pipe characters, and inline-code exemption. None uses `{` or `}` in an escaped context.
- **Severity if missed**: Medium; braces can be meaningful in Enhanced Markdown attributes/toggle syntax.

### T12 toggle child indentation
- **Mutation**: `indent(serializeBlocks(children, 0, warnings, bodyOptions), 1)` -> `serializeBlocks(children, 0, warnings, bodyOptions)`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:47-60`.
- **Verdict**: CAUGHT by exact `<details>` output requiring `\tbody content`; toggle heading children exact output also pins indentation.
- **Severity if missed**: High; Enhanced Markdown nesting changes.

### T13 code language
- **Mutation**: `const fence = ` + "```" + `${lang}\n${text}\n` + "```" + `;` -> `const fence = ` + "```" + `\n${text}\n` + "```" + `;`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:123-131`.
- **Verdict**: CAUGHT by exact `"```ts..."` and `"```plain text..."` assertions.
- **Severity if missed**: Medium-high; syntax highlighting/language contract lost.

### T14 equation delimiters
- **Mutation**: `` `$$\n${b.equation.expression}\n$$` `` -> `` `$${b.equation.expression}$` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:97-105`.
- **Verdict**: CAUGHT by exact block-level equation assertions.
- **Severity if missed**: High; block equation becomes inline/invalid.

### T15 table of contents tag
- **Mutation**: `` `<table_of_contents/>` `` -> `` `[toc]` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:107-109`.
- **Verdict**: CAUGHT by exact `<table_of_contents/>`.
- **Severity if missed**: Medium-high; atomic Enhanced Markdown would not create ToC.

### T16 columns wrapper dropped
- **Mutation**: `` const block = `<columns>\n${indent(inner, 1)}\n</columns>`; `` -> `` const block = `${indent(inner, 1)}`; ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:133-142`.
- **Verdict**: CAUGHT by `expect(enhanced).toContain("<columns>")` and `"</columns>"`.
- **Severity if missed**: High; columns would become ordinary content.

### T17 column body indentation
- **Mutation**: `` const block = `<column>\n${indent(inner, 1)}\n</column>`; `` -> `` const block = `<column>\n${inner}\n</column>`; ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:174-178`.
- **Verdict**: CAUGHT by `expect(enhanced).toContain("\t\tLiteral \\</column\\> text")`.
- **Severity if missed**: High; nested XML body can parse incorrectly.

### T18 column order
- **Mutation**: `const inner = cols.map((col) => serializeBlock(...)).join("\n");` -> `const inner = cols.reverse().map((col) => serializeBlock(...)).join("\n");`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:133-142`.
- **Verdict**: MISSED. The test only asserts `<columns>`, `<column>`, `Left.`, `Right.`, closing tags are present; it does not assert `Left.` precedes `Right.`.
- **Severity if missed**: High for callers using columns for layout/order.

### T19 table header metadata
- **Mutation**: `` `<table header-row="${headerRow}" header-column="${headerCol}">\n...` `` -> `` `<table>\n...` ``
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:144-151`.
- **Verdict**: MISSED. `expect(enhanced).toContain("<table")` still passes, as do `<tr>`, `<td>A</td>`, and `<td>1</td>`.
- **Severity if missed**: High; header semantics are part of the Enhanced Markdown contract.

### T20 table row order
- **Mutation**: `const rows = (b.table.children ?? []) as any[];` -> `const rows = [...((b.table.children ?? []) as any[])].reverse();`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:144-151`.
- **Verdict**: MISSED. The test checks cell presence, not full XML or ordering.
- **Severity if missed**: High; tabular data order corruption.

### T21 table cell order
- **Mutation**: `const cells = row.table_row.cells as RichText[][];` -> `const cells = [...row.table_row.cells].reverse() as RichText[][];`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:144-151`.
- **Verdict**: MISSED. Presence checks still see `A` and `1`; no assertion pins `A` before `B` or `1` before `2`.
- **Severity if missed**: High; column data corruption.

### T22 table pipe escaping
- **Mutation**: remove `|` from `escapeBodyText` character class.
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:168-172`.
- **Verdict**: CAUGHT by `expect(enhanced).toContain("<td>a \\| b</td>")`.
- **Severity if missed**: Medium-high; table cell parsing can split.

## 2. Handler Atomicity: `src/server.ts`

### H1 replace_content allow deletion flag
- **Mutation**: `allowDeletingContent: true` -> `allowDeletingContent: false`
- **Tests touching this code**: `tests/replace-content-atomic.test.ts:61-86`.
- **Verdict**: CAUGHT by `expect(payload.replace_content.allow_deleting_content).toBe(true)`.
- **Severity if missed**: High; replace may not delete omitted old content.

### H2 replace_content translator warnings swallowed
- **Mutation**: `const warnings = [...translatorWarnings];` -> `const warnings = [];`
- **Tests touching this code**: `tests/replace-content-atomic.test.ts:176-224`.
- **Verdict**: CAUGHT by `toContainEqual(expect.objectContaining({ code: "bookmark_lost_on_atomic_replace" }))`.
- **Severity if missed**: High; caller loses lossy-translation signal.

### H3 replace_content unknown_block_ids warning dropped
- **Mutation**: delete the `if (unmatched.length > 0) warnings.push({ code: "unmatched_blocks", ... })` block.
- **Tests touching this code**: `tests/replace-content-atomic.test.ts:152-170`, `197-224`.
- **Verdict**: CAUGHT by exact `warnings` equality and merge assertion.
- **Severity if missed**: High; caller loses atomic mismatch signal.

### H4 find_replace unmatched warning dropped
- **Mutation**: `...(unmatched.length > 0 ? { warnings: [...] } : {})` -> `{}`.
- **Tests touching this code**: `tests/find-replace.test.ts:259-288`.
- **Verdict**: CAUGHT by exact response equality containing `code: "unmatched_blocks"`.
- **Severity if missed**: High.

### H5 update_block type mismatch disabled
- **Mutation**: `if (block.type !== existingType) { ... }` -> `if (false && block.type !== existingType) { ... }`
- **Tests touching this code**: `tests/update-block.test.ts:225-243`.
- **Verdict**: CAUGHT. Existing paragraph + heading markdown would call `blocks.update`; test requires no call and a mismatch error.
- **Severity if missed**: Critical; Notion update cannot change block type safely.

### H6 update_block apply before validation
- **Mutation**: move `await updateBlock(notion, block_id, built.payload);` before `if (!built.ok) return error`.
- **Tests touching this code**: `tests/update-block.test.ts:225-243`, `266-284`.
- **Verdict**: CAUGHT by `expect(notion.blocks.update).not.toHaveBeenCalled()` for mismatch and multi-block markdown.
- **Severity if missed**: Critical; partial write before validation.

### H7 update_block unsupported type accepted
- **Mutation**: remove `if (!UPDATABLE_BLOCK_TYPES.has(existingType))` and call `buildUpdateBlockPayload(parsed, parsed[0].type, { checked })`.
- **Tests touching this code**: `tests/update-block.test.ts:337-352`.
- **Verdict**: CAUGHT. `synced_block` would now update with paragraph payload; test requires no update and an error mentioning `synced_block`.
- **Severity if missed**: High; unsupported blocks silently rewritten.

### H8 update_block archived payload
- **Mutation**: `await updateBlock(notion, block_id, { in_trash: true });` -> `await updateBlock(notion, block_id, { archived: true });`
- **Tests touching this code**: `tests/update-block.test.ts:245-264`.
- **Verdict**: CAUGHT by `expect(payload.in_trash).toBe(true)` and `expect(payload.archived).toBeUndefined()`.
- **Severity if missed**: High; API field mismatch for deletion.

## 3. Pagination Cap And Fetch-All Hint

### P1 read_page default cap
- **Mutation**: `const cap = max_property_items === undefined ? 75 : max_property_items;` -> `...? 25 : ...` in `read_page`.
- **Tests touching this code**: `tests/read-page-title-pagination.test.ts:115-176`.
- **Verdict**: CAUGHT. A 30-item title would truncate/warn instead of rehydrating without warnings; 200-item title would report `cap: 25`.
- **Severity if missed**: High; public default contract changes.

### P2 query_database default cap
- **Mutation**: same default `75 -> 25` in `query_database`.
- **Tests touching this code**: `tests/query-database-pagination.test.ts:117-183`.
- **Verdict**: CAUGHT by 30-item no-warning case and 200-item `returned_count/cap` assertions.
- **Severity if missed**: High.

### P3 how_to_fetch_all hint removed
- **Mutation**: delete `how_to_fetch_all: "Call again with max_property_items: 0 ..."` in read/query warning.
- **Tests touching this code**: `tests/read-page-title-pagination.test.ts:165-176`, `316-333`; `tests/query-database-pagination.test.ts:168-179`.
- **Verdict**: CAUGHT by `expect.stringContaining("max_property_items")` / `.toContain("max_property_items")`.
- **Severity if missed**: Medium-high; caller loses remediation guidance.

### P4 warning code renamed
- **Mutation**: `code: "truncated_properties"` -> `code: "properties_truncated"`.
- **Tests touching this code**: `tests/read-page-title-pagination.test.ts:165-176`, `316-325`; `tests/query-database-pagination.test.ts:168-171`.
- **Verdict**: CAUGHT by exact code equality.
- **Severity if missed**: High; machine-readable warning contract broken.

### P5 warning skipped when cap hit
- **Mutation**: `if (paginated.truncatedAtCap) warnings.push(...)` -> `if (false && paginated.truncatedAtCap) warnings.push(...)`.
- **Tests touching this code**: `tests/paginate-page-properties.test.ts:122-180`; server wrapping tests above.
- **Verdict**: CAUGHT by direct `result.warnings` assertions and server warning assertions.
- **Severity if missed**: High; silent truncation.

### P6 cap=0 still slices
- **Mutation**: `if (cap > 0 && values.length >= cap)` -> `if (values.length >= (cap || 75))`.
- **Tests touching this code**: `tests/paginate-property-value.test.ts:81-94`, `130-143`; `tests/read-page-title-pagination.test.ts:232-263`; `tests/query-database-pagination.test.ts:185-216`.
- **Verdict**: CAUGHT by cap-zero tests expecting 150/300 items and no warning.
- **Severity if missed**: High; advertised unlimited mode broken.

## 4. Warning Codes Contract

### W1 omitted_block_types renamed
- **Mutation**: `code: "omitted_block_types"` -> `code: "dropped_block_types"`.
- **Tests touching this code**: `tests/block-warnings.test.ts:126-153`, `179-190`; `tests/read-page-title-pagination.test.ts:294-325`.
- **Verdict**: CAUGHT by exact `toEqual` / `warning.code` assertions.
- **Severity if missed**: High.

### W2 unmatched_blocks renamed
- **Mutation**: `code: "unmatched_blocks"` -> `code: "unmatched_block_ids"`.
- **Tests touching this code**: `tests/find-replace.test.ts:259-288`; `tests/replace-content-atomic.test.ts:152-170`, `197-220`.
- **Verdict**: CAUGHT by exact and `objectContaining` assertions.
- **Severity if missed**: High.

### W3 truncated_properties renamed
- **Mutation**: `code: "truncated_properties"` -> `code: "properties_truncated"`.
- **Tests touching this code**: `tests/read-page-title-pagination.test.ts:137-176`, `294-333`; `tests/query-database-pagination.test.ts:141-179`.
- **Verdict**: CAUGHT by exact code assertions.
- **Severity if missed**: High.

### W4 bookmark_lost_on_atomic_replace renamed
- **Mutation**: `code: "bookmark_lost_on_atomic_replace"` -> `code: "bookmark_dropped"`.
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:195-200`; `tests/replace-content-atomic.test.ts:176-190`.
- **Verdict**: CAUGHT by exact translator warning and server `objectContaining` code assertion.
- **Severity if missed**: High.

### W5 warning code field dropped
- **Mutation**: `warnings.push({ code: "bookmark_lost_on_atomic_replace", url });` -> `warnings.push({ url } as any);`
- **Tests touching this code**: `tests/markdown-to-enhanced.test.ts:195-209`; `tests/replace-content-atomic.test.ts:176-220`.
- **Verdict**: CAUGHT. Translator tests use exact `toEqual`; server tests require `objectContaining({ code: ... })`.
- **Severity if missed**: High; machine-readable warnings unusable.

## 5. Reverse Path: `src/blocks-to-markdown.ts`

### B1 callout marker removed
- **Mutation**: `` return `${prefix}> [!${label}]\n${content}`; `` -> `` return content; ``
- **Tests touching this code**: `tests/blocks-to-markdown.test.ts:92-188`; `tests/roundtrip.test.ts:86-104`.
- **Verdict**: CAUGHT by exact callout outputs and round-trip exact assertions.
- **Severity if missed**: High; callout semantics lost on read.

### B2 toggle delimiter changed
- **Mutation**: `` `${prefix}+++ ${title}...${prefix}+++` `` -> `` `${prefix}--- ${title}...${prefix}---` ``
- **Tests touching this code**: `tests/blocks-to-markdown.test.ts:309-356`; `tests/roundtrip.test.ts:106-160`, `223-226`.
- **Verdict**: CAUGHT by exact toggle outputs and round-trip assertions.
- **Severity if missed**: High.

### B3 equation wrappers dropped
- **Mutation**: `` return `${prefix}$$${block.equation.expression}$$`; `` -> `` return `${prefix}${block.equation.expression}`; ``
- **Tests touching this code**: `tests/blocks-to-markdown.test.ts:190-203`; `tests/roundtrip.test.ts:177-185`.
- **Verdict**: CAUGHT by exact equation assertions.
- **Severity if missed**: High.

### B4 to_do checked branch swapped
- **Mutation**: `block.to_do.checked ? "x" : " "` -> `block.to_do.checked ? " " : "x"`
- **Tests touching this code**: `tests/blocks-to-markdown.test.ts:222-229`; `tests/roundtrip.test.ts:34-38`.
- **Verdict**: CAUGHT by exact checked/unchecked task list output.
- **Severity if missed**: High.

### B5 column wrapper dropped
- **Mutation**: `` return `${prefix}::: columns\n${rendered}\n${prefix}:::`; `` -> `return rendered;`
- **Tests touching this code**: `tests/blocks-to-markdown.test.ts:358-434`; `tests/roundtrip.test.ts:162-175`.
- **Verdict**: CAUGHT by exact column layout assertions.
- **Severity if missed**: High.

## 6. Property-Type Writes: `src/notion-client.ts`

### C1 date start dropped
- **Mutation**: `return { date: { start: String(value) } };` -> `return { date: {} };`
- **Tests touching this code**: listed files do not exercise date writes. `tests/simplify-property.test.ts` covers date reads only.
- **Verdict**: MISSED. No `convertPropertyValue("date", ...)` or add/update database-entry test with a date schema/value exists.
- **Severity if missed**: High; external date writes silently become empty/invalid.

### C2 relation array shape
- **Mutation**: `return { relation: [...].map((id) => ({ id: String(id) })) };` -> `return { relation: Array.isArray(value) ? value : [value] };`
- **Tests touching this code**: `tests/relation-roundtrip.test.ts:134-243`; `tests/database-write-strictness.test.ts:252-270`, `413-430`.
- **Verdict**: CAUGHT by exact `expect(...).toEqual({ relation: [{ id: ... }] })`.
- **Severity if missed**: High.

### C3 number coerced to string
- **Mutation**: `return { number: Number(value) };` -> `return { number: String(value) };`
- **Tests touching this code**: no listed write-value test for number. `tests/property-roundtrip.test.ts:400-448` covers number schema only, not number value writes.
- **Verdict**: MISSED.
- **Severity if missed**: High; Notion number writes get wrong JSON type.

### C4 multi_select collapsed to first element
- **Mutation**: `multi_select: (Array.isArray(value) ? value : [value]).map(...)` -> `multi_select: [{ name: String((Array.isArray(value) ? value : [value])[0]) }]`
- **Tests touching this code**: no listed write-value test for multi_select. `tests/property-roundtrip.test.ts:400-448` covers schema/options only.
- **Verdict**: MISSED.
- **Severity if missed**: Medium-high; multi-value writes lose data.

### C5 people single object instead of array
- **Mutation**: `return { people: [...].map((id) => ({ id: String(id) })) };` -> `return { people: { id: String(Array.isArray(value) ? value[0] : value) } };`
- **Tests touching this code**: `tests/convert-property-value.test.ts:6-16`; `tests/property-roundtrip.test.ts:318-359`; `tests/database-write-strictness.test.ts:274-294`.
- **Verdict**: CAUGHT by exact `{ people: [{ id: ... }] }` assertions.
- **Severity if missed**: High.

## Bottom Line

The hypothesis is partly refuted for the PR3-critical translator and handler warnings: current tests now pin many external contracts with exact output, especially callout colors, XML escaping for `<`/`>`, translator warnings, atomic replacement warning merges, and update-block failure safety.

The hypothesis still holds for table/column ordering and property-value writes. The biggest remaining contract-vs-implementation gaps are loose translator assertions for table/column structure/order and missing write-value tests for date, number, and multi_select.

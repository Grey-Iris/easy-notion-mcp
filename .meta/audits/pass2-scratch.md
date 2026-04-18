### SF-1: Nested task items are silently dropped
**Severity hypothesis:** high | Nested checklist structure is accepted on input and present in Notion on read, but child tasks disappear with no signal.
**Path:** `src/markdown-to-blocks.ts:149-162`, `src/server.ts:281-312`, `src/server.ts:315-338`, `src/blocks-to-markdown.ts:196-199`
**What the user supplies:** markdown like `- [ ] Parent\n  - child`, or a Notion page containing a `to_do` block with children.
**What happens:** On write, `listTokenToBlocks()` computes `children` from nested list tokens, but the `item.task` branch pushes a `to_do` block without attaching those children and `continue`s. On read, `fetchBlocksRecursive()` does recurse into child blocks, but `attachChildren()` has no `to_do` case, so fetched descendants are discarded before `blocksToMarkdown()` renders the parent task as a flat `- [ ] ...` line.
**Why it's silent:** No error, warning, or dropped-child count is surfaced. `append_content`, `create_page`, `replace_content`, and `update_section` return success based on API completion, and `read_page` returns markdown that looks complete.
**Evidence:** `src/markdown-to-blocks.ts:150-152` computes nested `children`; `src/markdown-to-blocks.ts:154-162` returns `{ type: "to_do", ... }` without `children`. `src/server.ts:328-332` fetches children for `raw.has_children`, but `src/server.ts:281-312` omits any `case "to_do"`. `src/blocks-to-markdown.ts:196-199` renders `to_do` without recursing.
**Counter-argument / steelman:** The current feature set may intend task lists to be flat only, and the tests only cover flat checklist items. But the parser already accepts nested non-task lists, and Notion to-do blocks support children, so silently flattening only task hierarchies is hard to defend.
**Confidence:** high | A nested task markdown repro against `markdownToBlocks()` already produces a parent task with no child blocks.
**Test coverage:** `tests/markdown-to-blocks.test.ts:160-165` and `tests/roundtrip.test.ts:34-38` cover only flat task lists. No test exercises nested task children.

### SF-2: Rich list-item content is flattened into plain text
**Severity hypothesis:** high | Multi-paragraph or code-bearing list items are structurally corrupted rather than rejected.
**Path:** `src/markdown-to-blocks.ts:127-143`, `src/markdown-to-blocks.ts:149-152`, `src/blocks-to-markdown.ts:26-29`, `src/blocks-to-markdown.ts:124-131`
**What the user supplies:** markdown like `- item\n\n  second para` or `- item\n\n  ```js\n  console.log(1)\n  ````.
**What happens:** `listItemToRichText()` flattens any nested token array into one inline stream unless the token is an image. Only nested `list` tokens become child blocks. A second paragraph or nested code block therefore becomes adjacent rich-text segments inside the list item rather than a child block, and `richTextToMarkdown()` joins those segments with `""`, removing separators and block structure.
**Why it's silent:** The conversion succeeds and downstream page-edit tools return success. The user gets fewer blocks than they authored, with no validation error saying “complex list items unsupported.”
**Evidence:** `src/markdown-to-blocks.ts:135-137` pushes `...token.tokens` for any token with nested tokens; `src/markdown-to-blocks.ts:150-152` only preserves nested `list` tokens as child blocks. `src/blocks-to-markdown.ts:26-29` joins rich-text segments with `""`, and `src/blocks-to-markdown.ts:124-131` emits a single `- ...` / `1. ...` line for the whole item.
**Counter-argument / steelman:** The tool documentation only advertises simple markdown constructs, not CommonMark-complete list-item bodies. But silently concatenating block children into a single line is worse than explicitly rejecting unsupported list-item shapes.
**Confidence:** high | Local execution of `markdownToBlocks()` and `blocksToMarkdown()` reproduces `- itemsecond para` / `- itemconsole.log(1)`.
**Test coverage:** `tests/markdown-to-blocks.test.ts:117-158` and `tests/roundtrip.test.ts:22-32` cover simple and nested lists only. No test covers loose list items, multiple paragraphs in one item, or nested code blocks inside list items.

### SF-3: Raw HTML blocks and reference definitions are discarded
**Severity hypothesis:** medium | Unsupported markdown block tokens are dropped entirely instead of being preserved as text or rejected.
**Path:** `src/markdown-to-blocks.ts:440-568`
**What the user supplies:** markdown containing a raw HTML block like `<div>hi</div>` or a reference definition like `[ref]: https://example.com`.
**What happens:** `tokenToBlocks()` only handles `space`, `heading`, `paragraph`, `list`, `blockquote`, `table`, `code`, and `hr`. Marked emits `html` and `def` tokens for those inputs, which fall into the default branch and become `[]`, so the content vanishes from the outgoing block list.
**Why it's silent:** `markdownToBlocks()` flat-maps the empty arrays and returns a shorter block list with no unsupported-token warning. Page creation/update still reports success if the remaining blocks are valid.
**Evidence:** `src/markdown-to-blocks.ts:440-567` enumerates handled token types; `src/markdown-to-blocks.ts:567-568` is `default: return [];`.
**Counter-argument / steelman:** Raw HTML and reference definitions are outside the documented supported syntax. But the current behavior silently erases user text instead of surfacing “unsupported markdown token: html/def.”
**Confidence:** high | Marked emits `html` / `def` for those examples, and `markdownToBlocks()` returns `[]` for them.
**Test coverage:** `tests/markdown-to-blocks.test.ts:31-897` exercises only supported syntax. There is no HTML-block or reference-definition test.

### SF-4: Unsupported Notion block types disappear from `read_page` and `duplicate_page`
**Severity hypothesis:** critical | Reading or duplicating a mixed-content page can silently omit whole blocks while the tool claims success.
**Path:** `src/server.ts:122-279`, `src/server.ts:315-338`, `src/server.ts:1123-1130`, `src/server.ts:1160-1163`, `src/blocks-to-markdown.ts:225-226`
**What the user supplies:** a Notion page containing any block type not covered by `normalizeBlock()` or `renderBlock()`; e.g. newer/unsupported blocks such as synced blocks or child-page/database blocks.
**What happens:** `normalizeBlock()` returns `null` for unknown raw block types, and `fetchBlocksRecursive()` filters those out before `read_page` builds markdown or `duplicate_page` clones content. Even if an unknown block were normalized somehow, `blocksToMarkdown()` also returns `""` for unhandled block types.
**Why it's silent:** `read_page` returns markdown with missing content and no warning banner about omitted block types. `duplicate_page` creates a new page from the filtered block list and returns the new page ID/URL as if the copy were complete.
**Evidence:** `src/server.ts:276-277` is `default: return null;` in `normalizeBlock()`. `src/server.ts:323-325` drops `null` normalized blocks. `src/server.ts:1123-1130` feeds filtered blocks into `blocksToMarkdown()`. `src/server.ts:1160-1163` duplicates from `sourceBlocks` returned by that same recursive fetch. `src/blocks-to-markdown.ts:225-226` is `default: return "";`.
**Counter-argument / steelman:** The project intentionally supports only a subset of Notion blocks. But `read_page` claims the markdown “round-trips cleanly,” and `duplicate_page` claims to create “the same content,” which is inaccurate when unsupported blocks are silently filtered.
**Confidence:** high | The filter/drop path is explicit in code.
**Test coverage:** `tests/blocks-to-markdown.test.ts:30-559` and `tests/roundtrip.test.ts:8-242` cover only the supported block subset. There is no `read_page` or `duplicate_page` test for unsupported blocks.

### SF-5: Relation and other non-whitelisted database properties are omitted on write and nulled on read
**Severity hypothesis:** high | Database content outside the narrow property whitelist is silently hidden or ignored even when the schema exposes it.
**Path:** `src/server.ts:48-80`, `src/server.ts:84-89`, `src/server.ts:1316-1317`, `src/notion-client.ts:199-245`, `src/notion-client.ts:554-565`, `src/notion-client.ts:568-590`
**What the user supplies:** a relation property in `query_database` results, or `add_database_entry` / `update_database_entry` input containing a schema property whose type is not one of title/rich_text/number/select/multi_select/date/checkbox/url/email/phone_number/status.
**What happens:** On read, `simplifyProperty()` has no branch for `relation`, `formula`, `rollup`, `files`, etc., so it returns `null` for them. On write, `convertPropertyValues()` silently skips unhandled property types via its default branch, so those keys never reach Notion.
**Why it's silent:** `query_database` still returns a normal row object, just with `null` in place of real property data. `add_database_entry` / `update_database_entry` still return page IDs if other properties are valid.
**Evidence:** `src/server.ts:48-79` only handles a subset of property types; `src/server.ts:79-80` is `default: return null;`. `src/notion-client.ts:205-242` only converts a subset; `src/notion-client.ts:243-244` is `default: break;`. `src/server.ts:1316-1317` returns `results.map(simplifyEntry)`, and `src/notion-client.ts:562-565` / `587-590` submit only `convertedProperties`.
**Counter-argument / steelman:** The tool descriptions for schema creation and entry writes advertise a limited set of property types. But `get_database` exposes the full schema, `query_database` hides unsupported data without warning, and write-time omission is silent even when the user is targeting an existing property shown in the schema.
**Confidence:** high | The production read/write paths explicitly omit these types.
**Test coverage:** `tests/relation-property.test.ts:3-17` defines local helper copies instead of importing the real production functions, so it would not catch the current omission in `src/server.ts` / `src/notion-client.ts`.

### SF-6: Typos and schema-cache staleness silently drop database-entry keys
**Severity hypothesis:** high | A user can provide a valid current property name and still have it omitted for up to five minutes after a schema change.
**Path:** `src/notion-client.ts:42-45`, `src/notion-client.ts:68-76`, `src/notion-client.ts:199-203`, `src/notion-client.ts:554-565`, `src/notion-client.ts:568-590`
**What the user supplies:** `add_database_entry` / `update_database_entry` properties containing a typo, a just-renamed property, or a newly added property before the 5-minute schema cache expires.
**What happens:** `getCachedSchema()` serves cached schema objects for `SCHEMA_CACHE_TTL = 5 * 60 * 1000`. `convertPropertyValues()` does `const propConfig = ds.properties[key]; if (!propConfig) { continue; }`, so any key absent from the cached schema is silently dropped from the outgoing payload.
**Why it's silent:** There is no “unknown properties” list in the response, no cache-bypass path, and no warning that the write used a stale schema. If at least one other property is valid, the operation can still return success.
**Evidence:** `src/notion-client.ts:42-45` defines the cache and 5-minute TTL. `src/notion-client.ts:68-76` returns cached schema until expiry. `src/notion-client.ts:199-203` silently `continue`s when `propConfig` is missing. `src/notion-client.ts:562-565` / `587-590` send only the filtered `convertedProperties`.
**Counter-argument / steelman:** Callers are told to use `get_database` before writes, and caching reduces API chatter. But the server itself maintains the stale cache and never informs the caller when requested keys were ignored because the cache no longer matches the live schema.
**Confidence:** high | The stale-schema + silent-continue interaction is explicit.
**Test coverage:** `tests/update-data-source.test.ts:160-205` only verifies cache invalidation after a successful schema update and retention after a failed update. No test exercises a write against a stale cached schema.

### SF-7: Checkbox properties use JavaScript truthiness, so `"false"` becomes checked
**Severity hypothesis:** high | Common string inputs are silently coerced to the opposite boolean value the caller likely intended.
**Path:** `src/notion-client.ts:228-229`
**What the user supplies:** `add_database_entry` / `update_database_entry` input like `{ "Done": "false" }`, `{ "Done": "0" }`, or `{ "Done": "no" }` for a checkbox property.
**What happens:** The converter does `Boolean(value)`, which yields `true` for any non-empty string. Notion receives `{ checkbox: true }`, so the entry is marked checked even though the caller supplied a false-like string.
**Why it's silent:** No validation enforces JSON booleans, and there is no response echo of the converted value. The write succeeds as a normal checkbox update.
**Evidence:** `src/notion-client.ts:228-229` is exactly `result[key] = { checkbox: Boolean(value) };`.
**Counter-argument / steelman:** Strict callers should send real booleans, not strings. But the tool advertises “simple key-value pairs,” and the server chooses an unsafe coercion instead of rejecting ambiguous input.
**Confidence:** high | JavaScript truthiness is deterministic here.
**Test coverage:** No test imports or exercises `convertPropertyValues()` for checkbox inputs. The closest property-conversion test file, `tests/relation-property.test.ts:8-17`, only uses copied helper code for relation handling.

### SF-8: Underline and color annotations are silently stripped from `read_page` markdown
**Severity hypothesis:** medium | Rich-text styling is lost on read/round-trip even though the type model knows about it.
**Path:** `src/types.ts:4-10`, `src/blocks-to-markdown.ts:3-24`, `src/blocks-to-markdown.ts:26-29`
**What the user supplies:** a Notion paragraph whose rich text includes `underline`, foreground color, or background color annotations.
**What happens:** `RichText` includes `underline` and `color` fields, but `applyAnnotations()` only serializes code, bold, italic, strikethrough, and links. `richTextToMarkdown()` then concatenates the plain text content, so underline/color information vanishes from `read_page` output.
**Why it's silent:** `read_page` does not warn that the markdown is lossy, and the advertised round-trip workflow encourages feeding that markdown back into `replace_content`.
**Evidence:** `src/types.ts:4-10` includes `underline?: boolean` and `color?: string`. `src/blocks-to-markdown.ts:7-20` handles only `code`, `bold`, `italic`, `strikethrough`, and `link`. `src/blocks-to-markdown.ts:26-29` simply joins the serialized text.
**Counter-argument / steelman:** Standard markdown has no native underline/color syntax, so some lossiness is inevitable. But the current implementation does not disclose that loss, despite the `read_page` description promising clean round-trips.
**Confidence:** high | A local `blocksToMarkdown()` repro with `underline` + `red_background` emits plain `u`.
**Test coverage:** `tests/blocks-to-markdown.test.ts:41-60` covers bold/italic/code/link only. There is no underline/color serialization test.

### SF-9: Media captions are dropped from `read_page` / `duplicate_page`
**Severity hypothesis:** medium | User-authored captions on images/files/audio/video can vanish even when the asset itself survives.
**Path:** `src/server.ts:244-275`, `src/blocks-to-markdown.ts:206-224`
**What the user supplies:** a Notion image/file/audio/video block with a caption.
**What happens:** `normalizeBlock()` keeps only the media URL (and file name for files) for image/file/audio/video blocks; it never copies caption data into the normalized block. `blocksToMarkdown()` then renders bare `![](...)`, `[name](...)`, `[audio](...)`, or `[video](...)` syntax with no caption representation.
**Why it's silent:** `read_page` returns plausible markdown that looks complete, and `duplicate_page` clones from the captionless normalized blocks.
**Evidence:** `src/server.ts:244-258` normalizes images with only `url`; `src/server.ts:261-275` does the same for file/audio/video. `src/blocks-to-markdown.ts:206-224` renders those block types without any caption field.
**Counter-argument / steelman:** Markdown does not have a universally accepted caption syntax for all media blocks. But silently dropping captions still means page content is lost without warning.
**Confidence:** high | The caption field is absent end-to-end in the implemented media normalization/rendering path.
**Test coverage:** `tests/blocks-to-markdown.test.ts:231-240` and `tests/blocks-to-markdown.test.ts:469-497` cover media URL rendering only. No caption-bearing media case is tested.

### SF-10: `find_replace` may report success on a no-op or partial update
**Severity hypothesis:** medium | The handler does not verify how many replacements were applied, so a no-op can look identical to success.
**Path:** `src/server.ts:1082-1104`
**What the user supplies:** `find_replace` input whose `find` string is absent, crosses block boundaries, or targets content the upstream `pages.updateMarkdown` API does not rewrite.
**What happens:** The handler forwards a single `old_str`/`new_str` update and then always returns `{ success: true }`, optionally adding `truncated: true` if the upstream response exposes that flag. It does not inspect a replacement count, unchanged marker, or post-read diff.
**Why it's silent:** If the upstream API treats an unmatched or partially applicable replacement as a successful no-op, the MCP response still says `success: true`.
**Evidence:** `src/server.ts:1090-1100` sends the update request; `src/server.ts:1101-1104` unconditionally returns `success: true` and exposes only `truncated`.
**Counter-argument / steelman:** The upstream Notion API may already error on unmatched or unsupported replacements, in which case this handler would propagate that error rather than silently succeeding.
**Confidence:** low | This is a CANDIDATE, not confirmed. Live API behavior or official `pages.updateMarkdown` docs would be needed to prove whether absent/cross-block matches return 200 no-op versus error.
**Test coverage:** No test mentions `find_replace` or `pages.updateMarkdown`.

### Also considered but deprioritized
`replace_content` and `update_section` delete first, then append converted markdown (`src/server.ts:1019-1027`, `src/server.ts:1067-1080`). I did not list them as separate findings because they amplify SF-1/SF-2/SF-3 rather than introducing a new silent-drop mechanism on their own.

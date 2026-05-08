# Tool descriptions audit — token economy + design

**Date:** 2026-05-01
**Subject:** All 29 tools registered in `src/server.ts` on `dev` (HEAD `94053ff`, post PR #57 merge with `update_block`).
**Scope:** Read-only measurement and design review. No code changes, no tasuku transitions, no commits.
**Method:** Audit PM (this file) measured per-tool tokens via cl100k_base (parity with `scripts/bench/token-compare.ts`). One Codex pass for independent duplication audit, top-10 correctness-preservation analysis, and MCP `$ref`/`$defs` portability check (output: `/tmp/codex-tool-desc-pass-dup.md`, sessionId `019de2cc-02dc-7781-a978-923e006ded03`).
**Triggering context:** The 2026-05-01 live OAuth capture against `mcp.notion.com` falsified two load-bearing strategic claims (`.meta/research/hosted-mcp-live-capture-2026-05-01.md`):
- "92% smaller for `find_replace`" — collapsed (hosted has the same primitive).
- "6.4× cheaper on listing budget" — collapsed (5,336 vs 4,969 ≈ 1.07×).

The differentiation narrative now rests on tool ergonomics, not size advantage. So the question becomes design-internal: does our 29-tool surface carry weight that doesn't earn its keep?

## 1. Executive summary

**Top-line numbers (cl100k_base, compact JSON, parity with bench scripts):**

- Local total (29 tools, dev HEAD `94053ff`): **5,442 tokens** / 24,562 bytes
- Hosted total (14 tools, captured fixture): **4,375 tokens** / 17,612 bytes (re-tokenized for apples-to-apples; the 5,336 in the live-capture memo used a different-shape input)
- Local/hosted ratio: **1.24×** (local is ~24% larger on listing budget for ~2× the tool count)

The bench scripts' 4,969 number was a 28-tool snapshot before `update_block` shipped. `update_block` added 385 tokens; another ~88 tokens of small drift across tools; total drift is real and traceable.

**Top 5 biggest tools (76.7% of total budget when including #6-10):**

1. `update_data_source` — 803 tokens (14.8%)
2. `create_page` — 539 tokens (9.9%)
3. `query_database` — 450 tokens (8.3%)
4. `update_block` — 385 tokens (7.1%)
5. `read_page` — 360 tokens (6.6%)

**Headline finding:** the surface is not bloated — but it has real, identifiable duplication. The per-tool distribution is healthy (median ~85 tokens, 9 tools under 50 tokens) and the description content is mostly correctness-critical, not marketing prose. The compression upside is **~700-1,100 tokens** (13-20% of total) if all moderate-risk recommendations are applied. That brings local to ~4,300-4,700 tokens — equal to or slightly under hosted.

**Headline recommendation: pursue a targeted tightening pass.** Reject the original "tiered descriptions loaded on demand" framing as MCP-protocol-incompatible (no such primitive exists; the LLM only sees what's in `tools/list` once). Pursue the underlying intent — compress what's compressible, surface depth via MCP Resources — with two concrete moves:

1. **Move shared markdown conventions and warning shapes to MCP Resources** (`notion://docs/markdown-conventions`, `notion://docs/warnings`, `notion://docs/property-pagination`). Hosted does this with `notion://docs/enhanced-markdown-spec`. Estimated savings: ~400-600 tokens. Engineering cost: medium (requires adding `resources` capability and handlers to `src/server.ts`; the server currently advertises only `{ tools: {} }`).
2. **Tighten in-place** on the top 10 tools using the per-tool guidance in §5. Most savings are duplicate pagination prose, repeated property-write contracts, and verbose status-property changelog notes. Estimated savings: ~300-500 tokens. Engineering cost: low (description rewrites with no behavior change).

The case is design-driven, not competitive. Listing budgets are roughly even with hosted; this is "should our surface be tight" rather than "are we losing the listing-budget battle." Two adjacent risks raise the bar on aggressive compression: (a) the testing-practices audit (`.meta/audits/testing-practices-audit-2026-04-30.md` H1) flagged that 10 of 12 user-writable property types lack positive value-write tests, which makes the description text a contract surface, not just explanatory prose; (b) the PR3 audit (`.meta/research/pr3-audit-2026-04-28.md`) noted block-ID/inline-comment preservation claims are wedge-positioning and partly untested, so destructive-warning text is load-bearing.

## 2. Methodology

**Tokenizer.** `js-tiktoken` `encodingForModel("gpt-4")` → cl100k_base, identical to `scripts/bench/token-compare.ts` (line 35). Verified on 2026-04-28 to match Python tiktoken within 1.2% (`.meta/research/token-remeasure-2026-04-28.md` L1).

**Capture.** Spawned built `dist/index.js` over stdio with a fake `NOTION_TOKEN`, sent JSON-RPC `initialize` then `tools/list`, captured the response. This is the same path bench scripts use; tools array matches `src/server.ts` registrations 1:1.

**Per-tool measurement.** For each tool: `JSON.stringify(tool)` then `enc.encode(...).length`. Description tokens and schema tokens measured separately by tokenizing the `description` string and `JSON.stringify(inputSchema)` independently.

**Hosted measurement.** Re-tokenized `/tmp/notion-hosted-tools-list-2026-05-01.json` with the same compact-JSON methodology to enable per-tool comparison. The 5,336 token number cited in the live-capture memo used a different shape (file-as-read, with whitespace); the apples-to-apples compact number is 4,375.

**Reproduction.** Per-tool numbers in `/tmp/local-per-tool-tokens.json` (gitignored — orchestrator can recompute via `dist/index.js` + `js-tiktoken`).

## 3. Per-tool size table

Sorted descending by total tokens. `total` includes name, description, inputSchema, and JSON envelope; `desc` is description-only; `schema` is `JSON.stringify(inputSchema)`-only. Schema + desc + ~10-token envelope ≈ total.

| Rank | Tool | Total | Desc | Schema | Bytes |
|---:|---|---:|---:|---:|---:|
| 1 | `update_data_source` | 803 | 696 | 70 | 3,607 |
| 2 | `create_page` | 539 | 386 | 126 | 2,056 |
| 3 | `query_database` | 450 | 277 | 154 | 1,972 |
| 4 | `update_block` | 385 | 234 | 134 | 1,642 |
| 5 | `read_page` | 360 | 201 | 146 | 1,668 |
| 6 | `create_database` | 334 | 197 | 108 | 1,414 |
| 7 | `create_page_from_file` | 323 | 214 | 86 | 1,390 |
| 8 | `replace_content` | 269 | 215 | 39 | 1,236 |
| 9 | `add_database_entry` | 268 | 201 | 46 | 1,134 |
| 10 | `update_database_entry` | 245 | 175 | 51 | 1,104 |
| 11 | `update_section` | 233 | 159 | 61 | 1,129 |
| 12 | `duplicate_page` | 182 | 83 | 88 | 845 |
| 13 | `find_replace` | 126 | 40 | 75 | 607 |
| 14 | `update_page` | 123 | 50 | 62 | 563 |
| 15 | `add_database_entries` | 102 | 37 | 53 | 514 |
| 16 | `append_content` | 85 | 34 | 39 | 397 |
| 17 | `search` | 79 | 27 | 42 | 374 |
| 18 | `get_database` | 71 | 35 | 25 | 356 |
| 19 | `move_page` | 66 | 9 | 46 | 285 |
| 20 | `add_comment` | 62 | 7 | 44 | 284 |
| 21 | `share_page` | 48 | 12 | 25 | 211 |
| 22 | `list_pages` | 47 | 8 | 28 | 218 |
| 23 | `delete_database_entry` | 47 | 8 | 27 | 220 |
| 24 | `list_databases` | 45 | 25 | 9 | 221 |
| 25 | `archive_page` | 43 | 7 | 25 | 187 |
| 26 | `list_comments` | 42 | 6 | 25 | 187 |
| 27 | `restore_page` | 41 | 5 | 25 | 187 |
| 28 | `get_me` | 25 | 6 | 9 | 107 |
| 29 | `list_users` | 23 | 4 | 9 | 107 |

**Sum of per-tool tokens = 5,466**; **compact array tokenization = 5,442**. The 24-token gap is JSON envelope overhead (`{"tools":[...]}` brackets and commas) that disappears when tokens are summed in isolation.

## 4. Distribution

Bucket histogram (29 tools):

| Range | Count |
|---|---:|
| 0-50 tokens | 9 |
| 50-100 | 5 |
| 100-200 | 4 |
| 200-500 | 9 |
| 500-1000 | 2 |
| 1000+ | 0 |

**Median:** ~85 tokens. **Mean:** 188 tokens. The shape is bimodal: small-and-utility tools cluster under 100 tokens (read-only listings, simple operations); content-and-database tools cluster in 200-500 with two outliers (`update_data_source` 803, `create_page` 539). No tool exceeds 1,000 tokens.

**Hosted distribution (14 tools, for comparison):**

| Range | Count |
|---|---:|
| 0-50 | 0 |
| 50-100 | 2 |
| 100-200 | 6 |
| 200-500 | 4 |
| 500-1000 | 1 |
| 1000+ | 1 |

Hosted has fewer, larger tools (`notion-create-comment` 1,479; `notion-update-page` 882). The largest single hosted tool is **1.84× larger than our largest** (`update_data_source` 803). Their distribution shape is wider — they pack more into bigger sub-commands. Ours is more granular with smaller tools — design choice that aligns with the surviving differentiator narrative ("focused tools like `update_block`, `update_section`").

## 5. Duplication map

Eleven recurring content categories identified across the 29 tools (Codex pass cross-referenced each line). Estimated tokens are calibrated against the per-tool desc_tokens; treat as order-of-magnitude.

### 5.1 Markdown convention pointers

`create_page` (line 659-677) restates the full supported syntax inline (~298 tokens for body conventions + 77 tokens for file-upload subsection). `create_page_from_file` (707), `append_content` (727), `replace_content` (743) all defer with "Same/supports the same markdown syntax as create_page" (~27 tokens each). `read_page` (814) restates output conventions (~33 tokens). The `create_page` source duplicates much of `CLAUDE.md:102-126` verbatim.

**Canonical move:** extract to MCP resource `notion://docs/markdown-conventions`. Replace inline restatements with one sentence each.

### 5.2 Block-type non-preservation lists

`replace_content` (741), `read_page` (814), `duplicate_page` (840) all enumerate `child_page` / `synced_block` / `child_database` / `link_to_page`. Total: ~197 tokens across 3 tools.

**Canonical move:** keep destructive-warning visible in `replace_content` (PR3 audit cautions this is wedge-positioning); shorten the others. Could move to `notion://docs/unrepresentable-blocks`.

### 5.3 Warning array shape and warning code names

`replace_content` (739, 743), `read_page` (814, 816, 832), `duplicate_page` (840), `query_database` (1025, 1043) all reference `warnings` array shape and code names (`unmatched_blocks`, `truncated_properties`, `bookmark_lost_on_atomic_replace`). Total: ~290 tokens across 4 tools, 8 distinct prose occurrences. **Notable absence:** the implementation emits `omitted_block_types` (server.ts:1569, :1621) but no description names it — only "listed in `warnings`."

**Canonical move:** `notion://docs/warnings` with the full code table and field shape; one-sentence reference per tool.

### 5.4 `max_property_items` pagination guidance

Appears in 4 places: `read_page` description (816, ~75 tokens), `read_page.max_property_items` field (832, ~36 tokens), `query_database` description (1025, ~115 tokens), `query_database.max_property_items` field (1043, ~36 tokens). Total: ~262 tokens. The same "Default 75 / 0 unlimited / negatives rejected / how_to_fetch_all hint" prose is duplicated.

**Canonical move:** keep the field-level sentence once per tool (it's where it's most useful at call time); extract the longer explanation to `notion://docs/property-pagination`.

### 5.5 `Call get_database first` reminders

Appears 8 times: `search` (881), `update_data_source` (960, 964), `get_database` (998), `list_databases` (1009), `query_database` (1023), `add_database_entry` (1069), `update_database_entry` (1117). Total: ~119 tokens.

**Codex judgment (which I agree with):** keep most of these. They're short and serve correctness — they teach the discovery flow. Only the duplicate `update_data_source` references at 960 and 964 should be merged.

### 5.6 Writable / not-writable property type lists

`add_database_entry` (1053-1066) and `update_database_entry` (1102-1115) carry **near-identical** property-type contracts: ~136 tokens each, repeated almost verbatim. Total ~272 tokens.

**Compression risk is real here.** Testing-practices audit H1: 10 of 12 user-writable types have no positive value-write test. The description text serves as the contract surface. If the model picks `update_database_entry` without ever reading `add_database_entry`, removing the list to a shared resource means the model writes against an unfamiliar contract.

**Canonical move:** keep the list in `add_database_entry`; in `update_database_entry`, use "Same property value contract as `add_database_entry`" + link. Saves ~80-120 tokens at moderate risk.

### 5.7 `file://` upload + HTTP-mode rejection language

3 tools, 5 prose occurrences: `create_page` (675-677), `create_page_from_file` (697, 699-705), `update_page` (856). Total: ~268 tokens.

**Canonical move:** one shared policy sentence. The `create_page_from_file` constraints (path absolute, workspace root, ≤1MB, UTF-8, symlink resolution) should stay in the schema field — they're called-when-needed, not just explanatory.

### 5.8 Property type listings as schema enums or examples

`create_database` (921-933) full type list (~175 tokens). `update_data_source` (966-980) raw-vs-helper modes + status notes + example payloads (~267 tokens). `query_database` (1018-1022) filter examples (~70 tokens).

**Canonical move:** keep one-line summaries; move full type/example tables to `notion://docs/database-schema-properties`, `notion://docs/update-data-source-examples`, `notion://docs/query-filters`.

### 5.9 Block-ID preservation language

`replace_content` (739) and `update_block` (784): both claim preservation of block ID, deep-link anchors, inline-comment threads. Total: ~71 tokens.

**Codex judgment:** keep both. PR3 audit identified this as a wedge claim. Cross-tool consistency is a feature.

### 5.10 "More efficient than X" cross-references

`update_section` (757) → "More efficient than replace_content for editing one section." `find_replace` (770) → "More efficient than replace_content for targeted text changes."

**Codex judgment:** keep. Useful routing guidance.

### 5.11 Other recurring content

- **Parent resolution** in `create_page` (685, ~43 tokens), `create_page_from_file` (718, ~9 tokens), `duplicate_page` (848, ~16 tokens). Could move to `notion://docs/parent-resolution`.
- **Page ID / database ID schema field descriptions** repeat throughout — schema boilerplate, not desc prose. No portable compression (see §7).
- **Destructive / backup advice** in `replace_content` (741) and `update_section` (755): "use duplicate_page first." Keep.
- **Batch format delegation** in `add_database_entries` (1084, 1091): "same format as add_database_entry." OK as-is.

## 6. Top 10 compression analysis

For each top-10 tool, what's correctness-critical vs. compressible. Risk class is on the LLM-correctness axis: **Conservative** = no measurable risk; **Moderate** = risk that a model without the resource fetched might call incorrectly; **Aggressive** = risk to specific contract surfaces flagged elsewhere (testing-practices H1, PR3 audit).

### 6.1 `update_data_source` — 803 tokens

**Must keep:** full-list semantics warning (line 960; data-loss-by-omission); raw-vs-helper routing (966-970); row/page boundary (982); non-empty requirement (984).

**Compressible:** status-property changelog/upstream-issue notes (972-975, ~120 tokens) → `notion://docs/notion-status-properties`; raw payload examples (977-980, ~55 tokens) → `notion://docs/update-data-source-examples`; merge duplicate `get_database` reminder (964 + 960) → ~20 tokens.

**Estimated savings:** 170-230 tokens. **Risk: Moderate.** The full-list warning must stay visible.

### 6.2 `create_page` — 539 tokens

**Must keep:** purpose; supported-syntax outline enough for common formatting; file-upload transport rule (75 tokens are load-bearing — file:// stdio-only / 20 MB / HTTP rejection); parent resolution rule.

**Compressible:** full markdown syntax list (660-674, ~298 tokens duplicates `CLAUDE.md:102-126`) → `notion://docs/markdown-conventions`. Keep a 40-60 token summary inline.

**Estimated savings:** 240-310 tokens. **Risk: Moderate.** Markdown conventions are highly behavior-shaping; resource must be discoverable.

### 6.3 `query_database` — 450 tokens

**Must keep:** modes summary; `get_database` reminder; pagination cap behavior at the field level; one filter example; response-shape pointer.

**Compressible:** reduce 5 filter examples to 2 (~35 token savings); remove duplicate pagination prose between description (1025) and field (1043) (~80 token savings).

**Estimated savings:** 80-130 tokens. **Risk: Conservative-Moderate.**

### 6.4 `update_block` — 385 tokens

**Must keep:** in-place / single-block scope; multi-block routing; type lock-in (cannot change type); updatable-types list; delete semantics + mutual exclusion; field-level note about single-block parse.

**Compressible:** shorten the surgical-edit examples in line 784. The updatable-types list could move to a resource, but **risk is real**: it's the contract for which calls are valid.

**Estimated savings:** 30-60 tokens. **Risk: Conservative.** Most of this description is load-bearing.

### 6.5 `read_page` — 360 tokens

**Must keep:** "Do NOT round-trip" destructive warning (prevents accidental deletion via `replace_content`); pagination behavior at field level.

**Compressible:** output-convention examples (`+++ blocks`, `::: blocks` etc.) → `notion://docs/markdown-conventions`. Pagination prose duplicated between desc (816) and field (832) — collapse to field.

**Estimated savings:** 60-90 tokens. **Risk: Moderate.** Keep the destructive warning verbatim.

### 6.6 `create_database` — 334 tokens

**Must keep:** purpose; required extras for formula/rollup/relation (these are the high-risk types); "no silent drops" contract.

**Compressible:** full property-type list (921-933, ~175 tokens) → `notion://docs/database-schema-properties`. Keep one-sentence summary + the high-risk-extras list.

**Estimated savings:** 80-130 tokens (partial extraction); 150+ (aggressive). **Risk: Moderate.** Schema creation has live coverage but property-type descriptions still serve as contract.

### 6.7 `create_page_from_file` — 323 tokens

**Must keep:** purpose; STDIO-only + rationale; path/extension/size/UTF-8/symlink restrictions (these prevent invalid calls); markdown semantics pointer.

**Compressible:** markdown pointer → shared resource (~10 tokens). Restrictions prose can tighten by ~20 tokens but should not disappear.

**Estimated savings:** 30-50 tokens. **Risk: Conservative.**

### 6.8 `replace_content` — 269 tokens

**Must keep:** atomic semantics (PR3 audit: under-tested core contract); block-ID / deep-link / comment preservation + `unmatched_blocks` warning; non-preserved block types (PR3 audit: claim is important); markdown syntax pointer; bookmark warning.

**Compressible:** markdown pointer → resource ref; bookmark/embed warning → exact code in `notion://docs/warnings`.

**Estimated savings:** 35-55 tokens. **Risk: Conservative.** Destructive enough that warning text should stay visible.

### 6.9 `add_database_entry` — 268 tokens

**Must keep:** writable value contract (testing-practices H1: under-tested, so this is the contract surface); non-writable types; `get_database` reminder.

**Compressible:** example object (line 1068) → `notion://docs/database-property-values`.

**Estimated savings:** 25-45 tokens conservatively; ~100+ only with risky resource extraction. **Risk: Conservative.**

### 6.10 `update_database_entry` — 245 tokens

**Must keep:** partial-update semantics (omitted unchanged); `get_database` reminder.

**Compressible:** the writable/not-writable list duplicates `add_database_entry` almost verbatim. Replace with "Same property value contract as `add_database_entry`" + resource link.

**Estimated savings:** 80-120 tokens (remove duplicate); 20-30 (tighten only). **Risk: Moderate.** Models that pick `update_database_entry` without reading `add_database_entry` would write against an unfamiliar contract; testing-practices H1 raises the bar.

**Top-10 total compression range:** 830-1,200 tokens (15-22% of total budget).

## 7. Abstraction opportunities

### 7.1 Schema-level (`$defs` / `$ref`)

**Verdict: not portable; do not pursue.**

Codex Part C investigated. The MCP TypeScript SDK's `ToolSchema` requires root `type: "object"` plus optional `properties`/`required`, with `.catchall(z.unknown())` — `$defs` and `$ref` aren't stripped by validation (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1229-1246`). This repo uses the low-level `Server` and returns the tools list mapping `{ name, description, inputSchema }` directly (`src/server.ts:1263-1271`), so a `$ref`-using schema would survive transmission.

**But downstream support is uneven:**
- OpenAI Agents SDK passes `inputSchema` through as `params_json_schema` without dereferencing.
- **Gemini fails on `$defs`/`$ref`** in MCP schemas (google-gemini/gemini-cli#13326, opened 2025-11-18). This is documented and known.
- Claude frontends are uncertain — no official guarantee they dereference.

A schema-level abstraction here would optimize for one client at the cost of another. For a published open-source server, that's the wrong tradeoff. The portable compression strategy is **prose-level** (descriptions and resources), not schema-level.

### 7.2 Prose-level via MCP Resources

**Verdict: pursue.**

The hosted server uses this pattern (`notion://docs/enhanced-markdown-spec`). It's protocol-portable: any MCP client can call `resources/list` and `resources/read`. The LLM can choose to fetch a resource before calling a tool.

**Engineering required (this repo currently advertises only `{ tools: {} }` capability — no resources scaffolding):**

1. Add `resources` capability to `createServer`'s capability declaration (`src/server.ts:1230`).
2. Register handlers for `ListResourcesRequestSchema` and `ReadResourceRequestSchema`.
3. Author the resource content (markdown files in `src/resources/` or inlined string constants).
4. Update the relevant tool descriptions to reference resources by URI.
5. Add unit tests for the resource handlers.
6. Add live-e2e or integration tests that the resources are reachable via the MCP protocol (resources are part of the wire contract; bench scripts and listing budget should cover them too).

Estimated engineering: 1-2 days for a focused builder PM dispatch. Rough scope: comparable to the v0.5.1 bin-shim fix (PR #55) in size.

**Resources to author (in priority order):**

| URI | Replaces | Tokens saved |
|---|---|---:|
| `notion://docs/markdown-conventions` | Markdown syntax in `create_page` (660-674) + restatements in 4 other tools | 280-340 |
| `notion://docs/warnings` | Warning code shapes across 4 tools | 100-180 |
| `notion://docs/property-pagination` | `max_property_items` longer prose | 80-120 |
| `notion://docs/database-property-values` | Writable/not-writable list (mainly the `update_database_entry` duplicate) | 80-120 |
| `notion://docs/database-schema-properties` | Property type list in `create_database` | 80-130 |
| `notion://docs/update-data-source-examples` | Status notes + raw payload examples | 100-170 |

**Total resource-extraction upside: ~720-1,060 tokens.** With in-place tightening, total savings: 800-1,200 tokens.

### 7.3 Schema field reuse

`page_id` / `database_id` / `block_id` schema field descriptions repeat across most tools. This is not compressible at the description level. It's compressible only via `$defs`/`$ref`, which §7.1 rules out for portability.

The boilerplate cost is real but small per-tool (~25 tokens each for the simple ID-only tools). For tools 21-29 (the 9 small tools), the schema is most of their cost — compressing further has limited upside.

## 8. Tiered-descriptions architectural feasibility

**Existing tasuku task:** `tiered-tool-descriptions-load-co` (high priority, created 2026-03-19) — "Tiered tool descriptions: load compressed descriptions by default, full docs on demand to reduce system prompt tokens."

**Verdict: reject the original framing as MCP-protocol-incompatible. Pursue the underlying intent via MCP Resources (§7.2).**

**Why the original framing fails:**

The MCP spec defines `tools/list` and `tools/call`. There is no protocol primitive for "give me the longer description for this tool." The agent receives `tools/list` once at session init; once `inputSchema` and `description` are passed to the LLM, that's the surface the model sees. There's no late-binding path.

Theoretical alternatives that don't actually work:

1. **Server-side description switching by config flag** — would require the MCP client to advertise a preference, which the protocol doesn't model. Could be done as a server env var (`EASY_NOTION_VERBOSE_DOCS=1`) but that's static at startup, not "on demand."
2. **Two-tier tool registration** — register a `tools/list` with short descriptions, then have a meta-tool `get_full_description(tool_name)`. This works mechanically but degrades the agent UX: the model has to call a tool to learn how to call other tools, which adds latency and token cost (each meta-call costs more than the saved description).
3. **Sub-tools that load on demand** — same problem; no MCP primitive.

**What does work — MCP Resources (the hosted pattern):**

Resources are first-class in the protocol. A tool description can reference a resource URI; the LLM can fetch it via `resources/read` before calling the tool. The hosted server uses this. The savings are real, the cost is protocol-aligned, and it's portable across clients.

This isn't "tiered descriptions" — it's "compress and surface via resources." The naming distinction matters because the original framing (load on demand) implies a primitive that doesn't exist.

**Recommended task disposition:** rewrite `tiered-tool-descriptions-load-co` as `extract-shared-docs-to-mcp-resources` with the resource list from §7.2 and the engineering scope above. Keep the priority high; the savings are real (~700-1,100 tokens, 13-20% of budget) and the architectural move is the right one for an open-source server competing on tool ergonomics.

## 9. Hosted comparison

Per-tool ranking, hosted side (compact JSON tokenization):

| Rank | Tool | Total | Desc | Schema |
|---:|---|---:|---:|---:|
| 1 | `notion-create-comment` | 1,479 | 237 | 1,200 |
| 2 | `notion-update-page` | 882 | 474 | 372 |
| 3 | `notion-search` | 306 | 105 | 190 |
| 4 | `notion-create-pages` | 261 | 89 | 160 |
| 5 | `notion-create-view` | 242 | 100 | 130 |
| 6 | `notion-create-database` | 236 | 146 | 77 |
| 7 | `notion-update-data-source` | 185 | 76 | 95 |
| 8 | `notion-get-users` | 153 | 40 | 101 |
| 9 | `notion-fetch` | 118 | 53 | 54 |
| 10 | `notion-get-comments` | 116 | 40 | 64 |
| 11 | `notion-update-view` | 107 | 41 | 54 |
| 12 | `notion-move-pages` | 105 | 14 | 79 |
| 13 | `notion-get-teams` | 92 | 49 | 30 |
| 14 | `notion-duplicate-page` | 91 | 40 | 38 |

**Where hosted is more compact than ours (informative, not directive):**

- `notion-update-data-source` = 185 tokens vs our `update_data_source` = 803 tokens. **4.3× difference.** Hosted uses a SQL DDL string and a single resource pointer (`notion://docs/...`). We carry the full status-property changelog and raw-payload examples inline. **Borrowable pattern:** the prose-to-resource extraction works for status-property notes specifically.
- `notion-update-view` = 107 tokens with a "same DSL as create_view" + "Use CLEAR" pattern. **Borrowable pattern:** delta-only descriptions for parallel tools. Applies to our `update_database_entry` ↔ `add_database_entry` pair.
- `notion-fetch` = 118 tokens (vs our `read_page` = 360). Hosted has shorter pagination prose. **Borrowable pattern:** field-level pagination, not description-level.

**Where hosted is bigger than ours:**

- `notion-create-comment` schema is 1,200 tokens — they inline the entire rich-text object structure. Our `add_comment` is 62 tokens with a one-line description and a `text: string`. **Real ergonomic edge for us** — one of the surviving differentiators per the live-capture memo.
- `notion-update-page` is 882 tokens because it carries 5 sub-commands (`update_properties`, `update_content`, `replace_content`, `apply_template`, `update_verification`). Our equivalents (`update_database_entry`, `replace_content`, etc.) are separate focused tools. **Confirms** the "focused tools" differentiator.
- `notion-search` is 306 tokens vs our `search` 79 tokens, but theirs covers semantic/AI search across connected sources. Different scope.

**Distribution shape:** hosted skews larger per-tool (median ~135 vs our ~85). They have fewer, bigger tools; we have more, smaller tools. Both totals are within 25% of each other.

## 10. Correctness preservation check

For each compression recommendation, what could break and the risk class:

| Recommendation | Risk class | Failure mode |
|---|---|---|
| Move markdown conventions to resource (§5.1, §6.2) | Moderate | LLM doesn't fetch resource → unfamiliar with `+++`, `:::`, `> [!NOTE]` syntax → calls `create_page` with malformed markdown. Mitigation: keep one-line summary inline. |
| Move warning shapes to resource (§5.3) | Conservative | LLM may not realize warnings are something to handle. Mitigation: keep "see `warnings`" mention in each tool's response-shape line. |
| Compress `update_data_source` status notes (§5.8, §6.1) | Moderate | LLM tries to reconfigure status groups via API; gets opaque error. Mitigation: keep one-sentence "options updatable via API; groups are UI-only." |
| Replace `update_database_entry` writable list with reference (§5.6, §6.10) | Aggressive | Per testing-practices H1, property-write contracts are under-tested. Removing the in-tool list to a resource means models that pick this tool without reading `add_database_entry` write against an unfamiliar contract. **Recommend: defer this specific extraction until H1 is closed; tighten in place only.** |
| Move database property types to resource (§6.6) | Moderate | LLM creates database with unknown type expecting silent drop; gets explicit error (which is the existing behavior). Mitigation: keep "no silent drops" sentence inline. |
| Tighten duplicate pagination prose (§5.4, §6.3, §6.5) | Conservative | None — same information at field level is sufficient. |
| Merge `update_data_source` duplicate `get_database` reminder | Conservative | None. |
| Tighten `read_page` output convention examples (§6.5) | Moderate | LLM doesn't recognize `+++` / `:::` / `> [!NOTE]` in output as machine-parseable. Mitigation: resource is the right home; one-sentence summary inline. |

**Specific finding cross-references that raise compression risk:**

- **Testing-practices H1** (10/12 writable property types lack positive write tests) — affects §5.6 and §6.9, §6.10. Don't extract `add_database_entry`'s writable list aggressively.
- **PR3 audit** (block-ID/inline-comment preservation under-tested; atomic-replace failure-safety pinned only at unit level) — affects §6.5, §6.8. Keep destructive-warning text verbatim in `replace_content` and `update_section`.
- **PR3 audit M2** (child_page / synced_block claim is empirically under-tested) — affects §5.2. Keep the warning visible in `replace_content`.

## 11. Headline recommendation

**Pursue a targeted tightening pass.** Reject the original "tiered descriptions" framing as MCP-protocol-incompatible. Pursue the underlying intent via two concrete, sequenceable moves.

### Move 1 (low engineering): in-place tightening

Apply the per-tool tightenings in §6 that don't require new infrastructure:

- `update_data_source`: merge duplicate `get_database` reminder (saves ~20 tokens).
- `query_database`: collapse pagination prose into the field; reduce filter examples from 5 to 2 (saves ~80 tokens).
- `read_page`: collapse pagination prose into the field (saves ~40 tokens).
- `update_database_entry`: tighten the writable list (don't extract — see §10), but trim verbose phrasing (saves ~20 tokens).
- General: kill the "(headings, tables, callouts, toggles, columns, bookmarks, etc.)" parentheticals in `create_page_from_file`, `append_content`, `replace_content` — the cross-reference is enough (saves ~50 tokens).
- `update_data_source`: tighten status-property changelog + upstream-issue prose to two short sentences (saves ~80 tokens).

**Estimated savings: 300-400 tokens.** Engineering: half a day. No new architecture.

### Move 2 (medium engineering): MCP Resources

Add `resources` capability to `createServer` and author the priority resources:

1. `notion://docs/markdown-conventions` — the convention table from `CLAUDE.md:102-126` plus standard markdown.
2. `notion://docs/warnings` — full warning-code table including the implementation-emitted-but-undocumented `omitted_block_types`.
3. `notion://docs/property-pagination` — `max_property_items` semantics in detail.
4. `notion://docs/update-data-source-examples` — the raw-payload examples + status notes.

Update `create_page`, `read_page`, `replace_content`, `query_database`, `update_data_source` descriptions to reference the resources.

**Estimated savings: 400-700 tokens.** Engineering: 1-2 days, comparable in scope to the bin-shim fix (PR #55).

### Move 3 (deferred): writable-property-types extraction

Hold off on §6.10's full extraction until testing-practices H1 closes (positive write tests for all 12 writable property types). Once tests pin the contract, the description text can shrink to a reference without regressing the contract surface.

### Total estimated savings if Moves 1 + 2 applied

**~700-1,100 tokens** (13-20% of total). Local goes from 5,442 → ~4,300-4,700 tokens. That brings us **equal to or slightly under hosted's 4,375**.

**But the case is design-driven, not competitive.** Listing budgets are roughly even. The reason to do this is internal: tighter descriptions, less duplication, an MCP-resource pattern that pays off again next time someone wants to add cross-tool documentation. The README revision narrative no longer needs this work to land — `bench-scripts-audit-2026-04-28.md` and `hosted-mcp-live-capture-2026-05-01.md` already pivoted the framing to focused-tool ergonomics, which this work *supports* but doesn't depend on.

## 12. Positive patterns

What's working in the current tool-description surface, worth preserving:

1. **Cross-tool consistency on the wedge claims.** Both `replace_content` (line 739) and `update_block` (line 784) describe block-ID / deep-link / inline-comment preservation in matching language. PR3 identified this as wedge positioning; the current language reflects that.
2. **Field-level pagination prose where it's actionable.** `max_property_items` field descriptions on `read_page` and `query_database` carry the "Default 75 / 0 unlimited / negative rejected / how_to_fetch_all hint" where the model would see it at parameter time.
3. **Destructive-warning prominence.** `update_section` opens with "DESTRUCTIVE — no rollback" (line 755). `replace_content` opens with the atomicity guarantee + explicit non-preservation list. Good for both the LLM and human reviewers.
4. **Routing guidance via short cross-references.** `update_section` and `find_replace` both end with "More efficient than replace_content for X." Cheap, helpful, kept.
5. **`get_database` discovery flow.** 8 tools mention this, but most are short and serve correctness — they teach the multi-step workflow without being long.
6. **Schema fields are tight.** Of the 5,442 token total, 1,832 (33.7%) is schemas — most of which is unavoidable boilerplate (page_id, database_id descriptions). The 5 largest schemas (`query_database` 154, `read_page` 146, `update_block` 134, `create_page` 126, `create_database` 108) all earn their tokens with parameter-shaping prose.
7. **No 1000+ token tools.** The hosted distribution has two; ours has zero. The largest single tool (`update_data_source` 803) is still well under hosted's biggest.
8. **Median ~85 tokens.** 23 of 29 tools are under 200 tokens. The bloat is concentrated in a small head, which makes it tractable to address.

## 13. Audit areas not covered

- **No live MCP behavior testing of resources.** This audit recommends adding MCP Resources but doesn't prove that downstream clients (Claude Code, Claude Desktop, OpenAI Agents, Gemini CLI) actually fetch and pass them to the LLM. The hosted server uses this pattern, which is suggestive but not conclusive for our installs. **Suggested follow-up:** before authoring resources, dispatch a 30-minute test against a single resource on a stub MCP server to confirm Claude Code at least consumes it.
- **No audit of bench fixture descriptions** (`/tmp/notion-hosted-tools-list-2026-05-01.json` is a reconstruction, may differ from wire response by ~10% per the live-capture memo). The hosted comparison is approximate.
- **No assessment of which tools are actually called in practice.** A token-cost optimization that targets rarely-called tools is lower value than one that targets daily-driver tools. We'd need session telemetry, which we don't have. Mitigation: the top-10 size list overlaps heavily with the daily-driver list (`create_page`, `read_page`, `query_database`, `update_block`).
- **No audit of `resources/list` budget cost itself.** Adding 5-6 resources would itself add to the listing surface. Probably small (resource entries are name + URI + description), but unmeasured.
- **No assessment of LLM behavior under compressed descriptions.** This audit reasons from "what guidance is correctness-critical" but doesn't test "does Claude actually call `create_page` correctly with a 60-token markdown summary instead of 386 tokens." Suggested before any aggressive compression lands: a probe set of 5-10 tool calls under both versions and a comparison.

## 14. Session chain

- **Audit PM (this file):** orchestrator-spawned audit-role session for `tool-descriptions-audit-2026-05-01`. Read-only.
- **Codex pass — duplication audit + correctness preservation + MCP `$ref` feasibility:** sessionId `019de2cc-02dc-7781-a978-923e006ded03`, sessionName `audit-tool-descriptions-dup`. Output: `/tmp/codex-tool-desc-pass-dup.md` (gitignored — orchestrator can recover from the session if needed).

Codex did not edit any source. Its findings were judged independently against the project's prior audits (PR3, testing-practices), the live-capture memo, and `CLAUDE.md` conventions. The most consequential judgment call: keep the writable-property-types list in `update_database_entry` until testing-practices H1 closes — this pushes back on Codex's ~80-120 token savings estimate but avoids regressing a known contract surface gap.

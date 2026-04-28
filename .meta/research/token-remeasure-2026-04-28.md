# Token re-measurement — tool-description listing budget

**Date:** 2026-04-28
**Scope:** `tools/list` cost only (the static budget an MCP client pays at turn-0 to mount the server). Response-payload cost is out of scope for this dispatch.
**Tokenizer:** `js-tiktoken` cl100k_base (same encoding used by `benchmarks/token-count.ts`). Independent cross-check via Python tiktoken at parity within 1.2 %.
**Script:** `scripts/bench/token-compare.ts`. Raw artifacts at `.meta/bench/token-remeasure/{local,npm,hosted}-tools.json`, `results.json`, `summary.md`.

## Why this measurement exists

The README's "92 % fewer tokens" claim was measured against `@notionhq/notion-mcp-server`'s **response payloads** (`docs/token-benchmark-results.md`, 2026-03-20). User pain — @curious_queue's 2026-01-06 "31.3k tokens / 15.7 % of context window" tweet — is on a different surface: **tool-description listing budget**, paid once per session. And the competitor users actually choose between today is `mcp.notion.com`, not the npm package being sunset. This dispatch re-measures listing-budget cost across all three surfaces with one tokenizer.

## Surfaces measured

| Surface | Source | Capture method |
|---|---|---|
| **easy-notion-mcp (local)** | `src/server.ts` HEAD on this worktree | Built `dist/index.js`, spawned over stdio, real JSON-RPC `initialize`+`tools/list` capture. 28 tools. |
| **`@notionhq/notion-mcp-server` (npm)** | `npm i @notionhq/notion-mcp-server@latest` (v2.3.0) into a temp prefix | Spawned its `bin/cli.mjs` over stdio, real JSON-RPC capture. 22 tools — OpenAPI proxy generated from `notion-openapi.json`. |
| **`mcp.notion.com` (hosted)** | `developers.notion.com/guides/mcp/mcp-supported-tools` — verbatim descriptions only, empty `inputSchema` | Static fixture at `.meta/bench/token-remeasure/hosted-tools-fixture.json`. **OAuth-only — live tools/list was not captured.** 18 tools. |

The hosted surface cannot be authoritatively measured without an OAuth round-trip; the fixture is therefore a **lower bound**. A typical MCP `inputSchema` adds 200–500 cl100k tokens per tool when fully spec'd, so the real hosted listing budget is plausibly 2–4× the floor here. This caveat is load-bearing for one of the three ratios.

## Headline numbers

| Surface | Tools | Total tokens | Total bytes | Avg tokens/tool |
|---|---:|---:|---:|---:|
| easy-notion-mcp (local) | 28 | **4,969** | 22,234 | 177 |
| `@notionhq/notion-mcp-server` (npm) | 22 | **15,206** | 68,253 | 691 |
| `mcp.notion.com` (hosted, **lower bound**) | 18 | **≥ 772** | ≥ 3,607 | ≥ 43 |

Local 4,969 is +1,150 above the frame-5 capture of 3,819 at HEAD `d66eb47` (2026-04-17). The drift is real and traceable: `update_data_source`, `read_page`, and `query_database` descriptions all expanded since then to add upstream-bug references and pagination-warning contracts. Cross-check holds.

## The three ratios

### easy-notion-mcp vs npm baseline — **67.3 % savings**
Method: `(npm − local) / npm` on the full `tools` array stringified compactly. Both captured live from real `tools/list` responses, same tokenizer.

```
local  4,969 tokens
npm   15,206 tokens
ratio  0.33  →  67.3 % fewer tokens
```

This **does not reproduce the 92 %** because the methodologies measure different things. The 92 % is response-payload weighted average (page read + DB query + search). Listing-budget gives 67 %. Both real, both honest, different surfaces of the same design choice. A README that distinguished *"~92 % fewer response tokens, ~67 % fewer tool-listing tokens, vs the OpenAPI npm package"* would be defensible.

### easy-notion-mcp vs hosted (`mcp.notion.com`) — **−544 % "savings" (we cost ≥ 6.4× more)**
Method: `(hosted − local) / hosted` against the description-only fixture. Hosted total is a lower bound; ratio direction is settled, magnitude is upper-bound.

```
local   4,969 tokens
hosted    772 tokens (lower bound)
ratio   6.44  →  we cost at least 6.4× the hosted tool-listing budget
```

**Listing-budget alone, easy-notion-mcp is more expensive than hosted, not less.** Even if hosted's real `tools/list` is 4× the floor (~3,000 tokens), local is still ~1.6× hosted. Closing this gap on tool-list alone would mean trimming descriptions to hosted's 50–100-tokens-per-tool register — a real authoring cost, and one that fights the description-as-documentation pattern (the destructive-semantics warnings on `update_data_source` and `replace_content` are load-bearing for safety, not marketing copy).

### npm baseline vs hosted — **−1,870 % (npm ≈ 19.7× hosted)**
Method: `(hosted − npm) / hosted` against the same fixture.

```
npm    15,206 tokens
hosted    772 tokens (lower bound)
ratio  19.70
```

**Most of the original npm-baseline gap was Notion's own work, not ours.** When Notion built the Enhanced-Markdown hosted server, they replaced an OpenAPI proxy averaging 691 tokens/tool with hand-authored tools at ≤ 43 tokens/tool (lower bound). The npm-vs-hosted spread is ~5× larger than the local-vs-hosted spread. The biggest framing risk: an unscoped "92 %" claim implies our design produces those savings, when in fact the bulk of the npm baseline's bloat is OpenAPI-proxy overhead that any non-OpenAPI implementation would shed.

## Per-tool top-5 cost contributors

### Local
| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | `update_data_source` | 803 | 3,607 |
| 2 | `create_page` | 539 | 2,056 |
| 3 | `query_database` | 450 | 1,972 |
| 4 | `read_page` | 360 | 1,668 |
| 5 | `create_database` | 334 | 1,414 |

These five account for 2,486 tokens (50 %) of local listing budget. `update_data_source` alone is 16 %. The cost is description text, not schema — the tool documents full-list semantics, the 2026-03-19 status-update changelog, an upstream bug reference, and three payload examples. Trimming any of it is a content-correctness call, not a token-budget call.

### npm
| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | `API-post-search` | 1,078 | 4,842 |
| 2 | `API-patch-page` | 857 | 3,899 |
| 3 | `API-post-page` | 782 | 3,527 |
| 4 | `API-query-data-source` | 721 | 3,232 |
| 5 | `API-update-a-block` | 716 | 3,175 |

The npm distribution is flat: 21 of 22 tools fall in the 595–857 range. The cost driver is the per-operation OpenAPI request schema inlined as JSON Schema — every tool re-pays the cost of `RichText`, `Annotations`, `Parent`, etc. because the converter inlines rather than referencing.

### Hosted (lower bound)
| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | `notion-create-view` | 59 | 249 |
| 2 | `notion-fetch` | 49 | 222 |
| 3 | `notion-update-view` | 48 | 216 |
| 4 | `notion-create-comment` | 47 | 220 |
| 5 | `notion-update-page` | 45 | 205 |

Distribution is flat at 32–59 tokens because the fixture has short marketing descriptions only. With real `inputSchema` data, expect `notion-create-pages`, `notion-update-page`, `notion-update-data-source`, and the two query tools at the top — they carry the most parameter complexity.

## Verdict on the existing "92 % fewer tokens" claim

**Soften, do not retract.** The 92 % number is honest *for the surface it measures* (response-payload weighted average vs `@notionhq/notion-mcp-server`). Three problems with the claim as it stands:

1. The competitor named is being sunset. As of 2026-04-28, the npm package is no longer the relevant baseline for users choosing what to install in Claude Code.
2. It conflates two surfaces — listing budget and response payload — into a single ratio. Listing-budget alone is 67 %, not 92 %.
3. Most of the npm-baseline savings came from Notion's architecture move (OpenAPI proxy → Enhanced Markdown), not our markdown-first design. The npm-vs-hosted ratio (19.7×) dwarfs our local-vs-hosted ratio (6.4×).

A measurement-grounded README claim would split surfaces and name the surviving baseline. Specific phrasing is downstream of this dispatch.

## Methodology caveats

- **Hosted floor.** The 772-token hosted total is description-only. Real `tools/list` from `mcp.notion.com` would include `inputSchema` blocks that aren't publicly documented. Plausible real range: 1,500–4,000 tokens. Live capture requires OAuth — listed as an unfilled gap by `.meta/research/wave1-notion-hosted-deep-2026-04-28.md` §9. ~30 min of work to close.
- **Tokenizer drift.** js-tiktoken vs Python tiktoken disagreed on local total by 1.2 %; npm and hosted match exactly. Within documented tokenizer variance. Numbers here use js-tiktoken; ratios stable across both.
- **Local listing-budget drift.** Local total drifted +30 % over ~11 days since the frame-5 capture (3,819 → 4,969). Worth a per-tool budget guardrail if listing-budget becomes a competitive metric.
- **Wire format choice.** Measured the MCP wire-format `tools` array. Anthropic and OpenAI re-serialize this into their own formats; frame-5 found Shape A (MCP) and Shape B (Anthropic) within 1 token. Re-serialization applies to all three surfaces, so MCP-wire is the right comparable.
- **npm version.** Captured v2.3.0 (latest as of 2026-04-28). Package is being sunset; the OpenAPI inflation pattern is unlikely to change before that happens.

## Recommendation on follow-on workflow-level measurement

**Needed.** Result is decisive against npm (67 %, clear win) but inconclusive against hosted: we cost more on listing budget alone, and listing budget is only one dimension of session context. A workflow-level capture of a multi-call session (search → read → update_section → append_content) tokenizing the full context (tool list × 1 + each request + each response) is the only way to settle local-vs-hosted, because hosted's response-payload behaviour is the unknown that flips the headline. The OAuth setup that closes the hosted-fixture gap also captures real response payloads — both unknowns settle from one setup cost. The break-even question (if local costs ~3K more on listing budget but saves ~1K per response, "we win at 4+ tool calls/session") is the interesting strategy-memo number, not either dimension in isolation. Recommend pairing this dispatch with a 60–90-min OAuth + workflow-capture follow-on before any README rewrite.

## Files

- Script: `scripts/bench/token-compare.ts`
- Hosted fixture: `.meta/bench/token-remeasure/hosted-tools-fixture.json`
- Captured tools (raw): `.meta/bench/token-remeasure/{local,npm,hosted}-tools.json`
- Structured results: `.meta/bench/token-remeasure/results.json`
- Auto-generated summary: `.meta/bench/token-remeasure/summary.md`
- Cross-check baseline: `.meta/research/frame-5-agent-2026-04-17.md` §1 (3,819 tokens at HEAD `d66eb47`)
- Existing response-payload measurement: `docs/token-benchmark-results.md` (2026-03-20)

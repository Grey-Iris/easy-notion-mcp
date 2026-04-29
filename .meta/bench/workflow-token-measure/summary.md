# Workflow Token Comparison

- Timestamp: 2026-04-28T23:48:24.567Z
- Tokenizer: cl100k_base (js-tiktoken encodingForModel('gpt-4'))
- Listing budget (per session, paid once): ours 4969 / hosted floor 772 / hosted plausible midpoint 3000.

## Per-workflow per-call totals

| Workflow | Ours calls | Ours req | Ours resp | Ours total | Hosted calls | Hosted req | Hosted resp | Hosted total | Δ (hosted − ours) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1. block-surgical-edit | 1 | 59 | 5 | 64 | 2 | 1954 | 1831 | 3785 | +3721 |
| 2. batch-import-10-entries | 1 | 337 | 244 | 581 | 1 | 917 | 2399 | 3316 | +2735 |
| 3. read-and-summarize | 1 | 41 | 1861 | 1902 | 1 | 52 | 1736 | 1788 | -114 |
| 4. multi-page-navigation | 5 | 169 | 2945 | 3114 | 5 | 942 | 2825 | 3767 | +653 |

## Break-even (floor vs midpoint listing deficit)

- Listing deficit (ours minus hosted floor): **4197 tokens**
- Listing deficit (ours minus plausible midpoint): **1969 tokens**
- Average per-call delta across winning workflows: **2331.7 tokens**

| Workflow | Workflows-to-break-even (vs floor) | Workflows-to-break-even (vs midpoint) |
|---|---:|---:|
| 1. block-surgical-edit | 1.1 | 0.5 |
| 2. batch-import-10-entries | 1.5 | 0.7 |
| 3. read-and-summarize | never | never |
| 4. multi-page-navigation | 6.4 | 3.0 |

A "workflow" here means one full execution of that workflow's call chain
(roughly one agent task). At the floor reading of hosted listing budget, a
session needs to run that many copies of the workflow before our larger
listing budget is paid back by per-call response savings.

## Live cross-check

Live cross-check skipped: NOTION_TOKEN or WORKFLOW_BENCH_PAGE_ID/NOTION_ROOT_PAGE_ID not set

## Caveats

- Hosted listing budget reuses the description-only floor (772) from .meta/research/token-remeasure-2026-04-28.md. Real hosted tools/list with full inputSchemas is plausibly 1.5K-4K tokens; midpoint shown for break-even sensitivity.
- Hosted response payload is approximated by a hand-rolled blocksToEnhancedMarkdown converter following developers.notion.com/guides/data-apis/enhanced-markdown. Color attributes are dropped; the spec ranks them as block-level extensions that almost always increase hosted cost — so this UNDER-estimates hosted response payload.
- notion-fetch's response wrapper is not publicly documented. We model a YAML-style metadata frontmatter; if hosted ships a richer wrapper (block IDs, parent breadcrumb, related-page schema), hosted costs rise further.
- notion-create-pages is assumed to accept a 10-row batch in one call (best case). Per-row retries from issues #121/#244 would shift Workflow 2 against hosted further.
- Workflow 4 assumes the agent's update target was already fetched in the search-and-read phase, so no extra fetch is needed before notion-update-page. If not, hosted needs one more notion-fetch call.
- All requests use compact JSON.stringify() — same convention as the prior listing-budget remeasure.

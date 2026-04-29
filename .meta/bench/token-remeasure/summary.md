# MCP tools/list Token Comparison

- Timestamp: 2026-04-28T23:13:44.471Z
- Tokenizer: cl100k_base
- Hosted surface caveat: fixture-based lower bound; OAuth-gated live tools/list was not captured.

## Totals

| Surface | Label | Tools | Total tokens | Total bytes | Avg tokens/tool |
|---|---|---:|---:|---:|---:|
| local | easy-notion-mcp (HEAD) | 28 | 4969 | 22234 | 177.46 |
| npm | @notionhq/notion-mcp-server (latest npm) | 22 | 15206 | 68253 | 691.18 |
| hosted | mcp.notion.com Enhanced Markdown fixture (lower bound) | 18 | 772 | 3607 | 42.89 |

## Ratios

| Comparison | Ratio | Pct savings |
|---|---:|---:|
| local_vs_npm | 0.33 | 67.3% |
| local_vs_hosted | 6.44 | -543.7% |
| npm_vs_hosted | 19.70 | -1869.7% |

## Top 5: local

| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | update_data_source | 803 | 3607 |
| 2 | create_page | 539 | 2056 |
| 3 | query_database | 450 | 1972 |
| 4 | read_page | 360 | 1668 |
| 5 | create_database | 334 | 1414 |

## Top 5: npm

| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | API-post-search | 1078 | 4842 |
| 2 | API-patch-page | 857 | 3899 |
| 3 | API-post-page | 782 | 3527 |
| 4 | API-query-data-source | 721 | 3232 |
| 5 | API-update-a-block | 716 | 3175 |

## Top 5: hosted

| Rank | Tool | Tokens | Bytes |
|---:|---|---:|---:|
| 1 | notion-create-view | 59 | 249 |
| 2 | notion-fetch | 49 | 222 |
| 3 | notion-update-view | 48 | 216 |
| 4 | notion-create-comment | 47 | 220 |
| 5 | notion-update-page | 45 | 205 |

## Caveats

- Hosted mcp.notion.com tools were measured from .meta/bench/token-remeasure/hosted-tools-fixture.json because live capture requires OAuth.
- Hosted fixture includes verbatim published descriptions but empty inputSchemas, so hosted totals are a lower bound and likely undercount the real tools/list budget.
- All three surfaces were tokenized with js-tiktoken encodingForModel("gpt-4"), which maps to cl100k_base.
- Per-tool and total measurements use compact JSON.stringify output and include any extra fields returned by a server, such as annotations.

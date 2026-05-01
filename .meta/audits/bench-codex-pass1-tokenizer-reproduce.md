# Bench Script Audit Pass 1 - Tokenizer Methodology and Reproducibility

## Claim 1.1 - Single tokenizer applied consistently

VERDICT: confirmed for tokenizer/stringify mechanics; softened for surface comparability.

EVIDENCE:
- `scripts/bench/token-compare.ts:6` imports `encodingForModel` from `js-tiktoken`; `scripts/bench/token-compare.ts:35` sets `const enc = encodingForModel("gpt-4")`.
- `scripts/bench/workflow-token-compare.ts:34` imports `encodingForModel`; `scripts/bench/workflow-token-compare.ts:48` sets `const enc = encodingForModel("gpt-4")`.
- Listing total tokenization is one shared code path: `scripts/bench/token-compare.ts:355-369` builds `const compactTools = JSON.stringify(tools)` and uses `enc.encode(compactTools).length`. This is compact JSON, not pretty-printed.
- Per-tool rows use the same compact convention: `scripts/bench/token-compare.ts:357-362` uses `JSON.stringify(tool)` and `enc.encode(compact).length`.
- Surface feeds into that same tokenization call:
  - local: captured from stdio `result.tools` at `scripts/bench/token-compare.ts:68-73`, then measured at `scripts/bench/token-compare.ts:89`, which reaches `enc.encode(compactTools)` at `scripts/bench/token-compare.ts:369`.
  - npm: captured from stdio `result.tools` at `scripts/bench/token-compare.ts:75-79`, after installing `@notionhq/notion-mcp-server@latest` at `scripts/bench/token-compare.ts:121-150`, then measured at `scripts/bench/token-compare.ts:90`, same `scripts/bench/token-compare.ts:369`.
  - hosted: read from `.meta/bench/token-remeasure/hosted-tools-fixture.json` at `scripts/bench/token-compare.ts:338-344`, then measured at `scripts/bench/token-compare.ts:91`, same `scripts/bench/token-compare.ts:369`.
- Pretty artifact writes are not measurement inputs: `scripts/bench/token-compare.ts:347-350` writes `${JSON.stringify(tools, null, 2)}\n` after capture, but `metrics()` measures the in-memory arrays via compact `JSON.stringify`.
- Workflow script uses the same encoder and compact JSON convention for non-string request/response payloads: `scripts/bench/workflow-token-compare.ts:48-50` defines `T(value)` as `enc.encode(typeof value === "string" ? value : JSON.stringify(value)).length`; `scripts/bench/workflow-token-compare.ts:718-723` applies it to request and response for every call.

Methodological concern:
- No tokenizer inconsistency by surface was found. The inconsistency is content/source, not encoding: local and npm are live `tools/list` captures with full `inputSchema`; hosted is a fixture with stub schemas (`type`, empty `properties`, empty `required`). Fresh counts: local `28` tools, `4969` tokens; npm `22`, `15206`; hosted `18`, `772`.
- Quantified schema-shape bias in current artifacts, using the same js-tiktoken compact method:
  - local full `4969`; without `inputSchema` property `3367`; schema-property delta `1602` tokens (`57.21` per tool).
  - npm full `15206`; without `inputSchema` property `889`; schema-property delta `14317` tokens (`650.77` per tool).
  - hosted fixture full `772`; without `inputSchema` property `519`; stub-schema delta `253` tokens (`14.06` per tool).
- The hosted fixture therefore supports only a lower bound. The unobserved real hosted schemas cannot be exactly quantified from these artifacts.

## Claim 1.2 - js-tiktoken vs Python tiktoken cross-check (<=1.2% variance)

VERDICT: softened.

EVIDENCE:
- The listing script has no Python tiktoken invocation or comparison path. `rg -n "python|tiktoken|cross-check|crossCheck|spawn\\(|exec\\(|python3|child_process" scripts/bench/token-compare.ts scripts/bench/workflow-token-compare.ts` found only:
  - `scripts/bench/token-compare.ts:1` imports `spawn` for server/npm commands.
  - `scripts/bench/token-compare.ts:6,106` mention js-tiktoken only.
  - `scripts/bench/workflow-token-compare.ts:19,25,29,34,651,665,809,810,839,873` mention js-tiktoken or the workflow 3 live Notion REST cross-check, not Python tokenizer parity.
- The report assertion is therefore not verified by either bench script.
- Python tiktoken is available: `python3 -c "import tiktoken; print(tiktoken.get_encoding('cl100k_base').name)"` printed `cl100k_base`.
- Independent one-shot Python check on `.meta/bench/token-remeasure/local-tools.json` against fresh script total:
  - JS-equivalent compact JSON (`json.dumps(..., separators=(',', ':'), ensure_ascii=False)`): Python `4969`, script `4969`, delta `0`, variance `0.0%`.
  - Python default compact JSON (`ensure_ascii=True`): Python `5030`, script `4969`, delta `61`, variance `1.227611%`.

Methodological concern:
- The cross-check is an external/manual claim, not a reproducible script step.
- Python parity depends on matching JS `JSON.stringify` Unicode behavior. Python's default ASCII escaping changes the byte string and token count.

## Claim 1.3 - Headline numbers reproduce on a fresh run

VERDICT: confirmed.

EVIDENCE:
- `npm run build` completed successfully (`tsc`, exit 0).
- `./node_modules/.bin/tsx scripts/bench/token-compare.ts` fresh stdout timestamp: `2026-04-29T06:00:45.253Z`.
- Fresh listing totals from stdout/results:
  - local: `4969` tokens, `28` tools, `22234` bytes. Recorded headline `4969`: exact.
  - npm: `15206` tokens, `22` tools, `68253` bytes. Recorded headline `15206`: exact.
  - hosted: `772` tokens, `18` tools, `3607` bytes. Recorded headline `>=772`: exact floor.
- Current npm latest version check: `npm view @notionhq/notion-mcp-server version` returned `2.2.1`. No npm-token drift observed, so no version-difference explanation is needed.
- Current `src/server.ts` last commit: `520fedfe85cd337fe03763a2fab0a4cef8ac3f44 2026-04-23T01:50:11-07:00 feat(pagination): long-property pagination for PR2`. No local-token drift observed.
- `./node_modules/.bin/tsx scripts/bench/workflow-token-compare.ts` fresh stdout timestamp: `2026-04-29T06:00:50.554Z`.
- Fresh workflow per-call totals:
  - Workflow 1: ours `64`, hosted `3785`: exact vs headline `64 / 3785`.
  - Workflow 2: ours `581`, hosted `3316`: exact vs headline `581 / 3316`.
  - Workflow 3: ours `1902`, hosted `1788`: exact vs headline `1902 / 1788`.
  - Workflow 4: ours `3114`, hosted `3767`: exact vs headline `3114 / 3767`.
- Workflow live cross-check was skipped in this environment: stdout reported `NOTION_TOKEN or WORKFLOW_BENCH_PAGE_ID/NOTION_ROOT_PAGE_ID not set`.

Methodological concern:
- The workflow script hardcodes listing budgets at `scripts/bench/workflow-token-compare.ts:52-60` (`ours: 4969`, `hosted_floor: 772`, midpoint `3000`) rather than reading the fresh listing benchmark output. This did not affect the reproduced per-call headline totals, but it is a coupling risk if listing totals drift.

## Claim 1.4 - Listing budget vs what an MCP client actually sees

VERDICT: confirmed for `result.tools` array; softened for full result-object framing.

EVIDENCE:
- Existing test harness pattern uses real MCP SDK `Client` plus `InMemoryTransport`: `tests/destructive-edit-descriptions.test.ts:1-21`, especially `client.listTools()` at line `19`. Another harness builds connected clients at `tests/create-page-from-file.test.ts:49-71`.
- Server implementation confirms list response shape: `src/server.ts:1092-1100` handles `ListToolsRequestSchema`, maps visible tools to `{ name, description, inputSchema }`, and returns `{ tools: visible }`.
- Preferred cross-check performed with `InMemoryTransport` against `src/server.ts`, same `encodingForModel("gpt-4")`.
- Cross-check output:
  - `tool_count`: `28`
  - SDK result keys: `["tools"]`
  - `JSON.stringify(result.tools)` tokens: `4969`
  - `JSON.stringify(result)` tokens: `4970`
  - wrapper extra tokens: `1`
  - script local total: `4969`
  - delta vs script for tools array: `0` (`0%`)
  - full result-object delta vs script: `1` token (`0.020125%`)

Methodological concern:
- The script tokenizes the `tools` array only, not the `{"tools":[...]}` result wrapper and not full JSON-RPC wire framing. For the local SDK client shape, the result wrapper adds only `1` token, so the listing-budget number is within +/-1% of what the client receives either way.

## End-of-pass report sanity reference

- After the independent checks, the reports of record were used only as a sanity reference. `.meta/research/token-remeasure-2026-04-28.md:5` asserts the Python tiktoken cross-check; `.meta/research/token-remeasure-2026-04-28.md:115` says js-tiktoken vs Python tiktoken disagreed on the local total by `1.2%`, with npm and hosted exact. The scripts do not encode that check.
- `.meta/research/workflow-token-measure-2026-04-28.md:39-49` matches the fresh workflow totals reproduced above.

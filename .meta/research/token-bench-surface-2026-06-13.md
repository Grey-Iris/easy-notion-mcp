# Token Benchmark Surface Axis - 2026-06-13

Axis A is tool-surface only, so it earns no public or masthead claim. This axis records the no-call tools/list context cost for the servers that provisioned; any blocked server is listed under Provisioning findings. easy-notion is larger than the consolidated awkoy/better-notion surfaces and smaller than makenotion, and no "92%" claim lives here.

| Server | Tools | Total cl100k tokens | Total bytes | Avg tokens/tool | pkg version | Notion-Version | resolved SHA | Anthropic count |
|---|---:|---:|---:|---:|---|---|---|---|
| easy-notion-mcp (ours) | 42 | 6612 | 31489 | 157.43 | 0.9.3 | 2026-03-11 | 5581dd24f0b120ef5629fdbc78f5d80daab3c0fe | available:false |
| makenotion/notion-mcp-server | 22 | 15469 | 69281 | 703.14 | 2.3.1 | 2025-09-03 | e79f35fd64cc5db726fbba1beebaa84c80760c17 | available:false |
| awkoy/notion-mcp-server | 2 | 502 | 2226 | 251 | 2.5.1 | 2025-09-03 | f5f1bdaf2456093a583722dab8422cf7b972636c | available:false |

## Provisioning findings

- **better-notion-mcp (@n24q02m)** (better-notion): FAILED — better-notion npm install --ignore-scripts --legacy-peer-deps failed (code=1, signal=null).
stdout:


stderr:
npm error code ETARGET
npm error notarget No matching version found for @notionhq/client@^5.22.0.
npm error notarget In most cases you or one of your dependencies are requesting
npm error notarget a package version that doesn't exist.
npm error A complete log of this run can be found in: /home/jwigg/.npm/_logs/2026-06-13T21_57_38_972Z-debug-0.log


Tokenizer: cl100k_base via js-tiktoken gpt-4; Anthropic primary deferred (no ANTHROPIC_API_KEY) - wired hook reports available:false.

Reproducibility: re-running countCl100k over the committed `.meta/bench/surface-axis/*-tools.json` reproduces these exact token numbers.

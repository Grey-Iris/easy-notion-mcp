# Pass 3 Workflow Representativeness Audit

Scope: methodology audit for `scripts/bench/workflow-token-compare.ts`. I did not modify the bench script. Scratch measurements were run from `/tmp/adversarial-workflows.ts` with `cl100k_base` via `js-tiktoken`, reusing the same fixture/converter style and importing the repo's `blocksToMarkdown`.

External docs checked:

- Notion MCP supported tools: `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`, and `notion-create-comment` are documented in the hosted MCP tool list. Source: https://developers.notion.com/guides/mcp/mcp-supported-tools
- Enhanced Markdown / markdown content docs: the current Data API docs define enhanced markdown, supported block mappings, markdown read responses, and `update_content` search-and-replace. Source: https://developers.notion.com/guides/data-apis/working-with-markdown-content

## Claim 3.1 - Workflow Choice Bias

VERDICT: Partly valid, with important bias. The four workflows are plausible agent tasks, but W1 is deliberately a local best case, W2 and W4 are mutation-heavy, and only W3 is a clean read-only comparison. The headline should say "ours wins strongly on surgical/batch mutation workflows; hosted can win read-heavy workflows."

EVIDENCE:

- W1 construction is at `scripts/bench/workflow-token-compare.ts:397`. It builds a 100-block page, then local uses one `find_replace` call at `scripts/bench/workflow-token-compare.ts:412`, while hosted uses `notion-fetch` plus `notion-update-page` with full page content at `scripts/bench/workflow-token-compare.ts:419`.
- The fixture places the find string 5 times by design: `scripts/bench/workflow-token-compare.ts:111` and `scripts/bench/workflow-token-compare.ts:119`.
- W1 is biased toward ours because it assumes the agent already knows the exact string and can skip reading. Retally with local `read_page` prefix:

| W1 variant | Ours total | Hosted total | Delta hosted - ours | Interpretation |
|---|---:|---:|---:|---|
| Original W1 | 64 | 3,785 | +3,721 | Ours wins 98% of hosted per-call total |
| W1 + local `read_page` prefix | 1,966 | 3,785 | +1,819 | Ours still wins, but advantage drops to 48% of hosted per-call total |

- With the floor listing deficit of 4,197 tokens, original W1 breaks even at 1.1 workflows; W1 with read prefix breaks even at 2.3 workflows.
- W2 construction is at `scripts/bench/workflow-token-compare.ts:439`. It is representative for batch entry creation and intentionally gives hosted the best-case single batch call: `scripts/bench/workflow-token-compare.ts:456` and `scripts/bench/workflow-token-compare.ts:516`.
- W3 construction is at `scripts/bench/workflow-token-compare.ts:523`. It is representative for read/summarize and is the cleanest direct response-format comparison.
- W4 construction is at `scripts/bench/workflow-token-compare.ts:556`. It is representative of navigation-plus-edit agent behavior, but it still includes a final edit where local has `update_section` and hosted rewrites the whole page. The script gives hosted a favorable no-extra-fetch path because the edit target was already read: `scripts/bench/workflow-token-compare.ts:600` and `scripts/bench/workflow-token-compare.ts:642`.

CONCERNS:

- W1's "no read first" path is realistic only when the prompt already supplies the exact target string. Many real agent edits require a read first.
- Current Notion Data API docs document markdown `update_content` search-and-replace with `old_str`, `new_str`, and `replace_all_matches` semantics. If hosted MCP `notion-update-page` exposes that capability, W1's hosted full-body rewrite model is not the most charitable hosted path. The hosted tool docs say `notion-update-page` updates page content/properties, but do not expose the full schema in the public page.

## Claim 3.2 - Adversarial Alternative Workflows

VERDICT: Read-heavy alternatives do change the verdict. Archival/comment/discovery remain small local wins in my model, but the search-heavy lookup workflow flips strongly to hosted. That does not invalidate the mutation narrative, but it does invalidate a broad "ours amortizes after ~1 workflow" claim for read-heavy sessions.

EVIDENCE:

- Local `archive_page` exists in the tool schema at `src/server.ts:698` and returns `{ success, archived }` at `src/server.ts:1404`.
- Local `add_comment` exists at `src/server.ts:971` and returns `{ id, content }` at `src/server.ts:1626`.
- Local search/list responses are compact metadata at `src/server.ts:1410` and `src/server.ts:1426`.
- Hosted tools checked against the Notion MCP docs: `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`, and `notion-create-comment` are documented in the supported-tools page.

Scratch workflow results:

| Alternative workflow | Ours total | Hosted total | Delta hosted - ours | Verdict |
|---|---:|---:|---:|---|
| A. Page archival, 5 pages | 210 | 350 | +140 | Small local win |
| B. Comment posting | 57 | 73 | +16 | Near tie, small local win |
| C. Search-heavy lookup, 20 results + read 10 pages | 8,509 | 7,326 | -1,183 | Hosted wins materially |
| D. Discovery/list, 20 page metadata results | 503 | 693 | +190 | Small local win in this model |

CONCERNS:

- Page archival on hosted was modeled as `notion-update-page` with an archive/trash flag because the public MCP tool list does not show a dedicated archive/delete tool. If hosted has an undisclosed archive-specific tool with a compact response, A becomes closer to a tie.
- C is the strategic counterexample: one C workflow is already cheaper hosted before listing budget. Including listing floor, one C session is about 13,478 local tokens vs 8,098 hosted-floor tokens, so local does not amortize the listing deficit on this workload.

## Claim 3.3 - Sensitivity Analysis On Workflow Size

VERDICT: W1's local win is durable across page sizes, but the "about one workflow" break-even is only true around 100 blocks or larger. W3's hosted read-only advantage grows in absolute tokens with page size and stays around 6% proportionally.

EVIDENCE:

For 100 blocks, the scratch script uses the exact fixture shape. For other sizes, it generates similarly mixed pages with 5 replace occurrences and the same converter/tokenizer.

| Blocks | W1 ours | W1 hosted | W1 delta | W1 break-even vs floor | W3 ours | W3 hosted | W3 delta | W3 hosted edge |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 64 | 687 | +623 | 6.7 workflows | 361 | 339 | -22 | 6.1% |
| 50 | 64 | 2,385 | +2,321 | 1.8 workflows | 1,218 | 1,144 | -74 | 6.1% |
| 100 | 64 | 3,785 | +3,721 | 1.1 workflows | 1,902 | 1,788 | -114 | 6.0% |
| 500 | 64 | 21,229 | +21,165 | 0.2 workflows | 10,773 | 10,077 | -696 | 6.5% |
| 1000 | 64 | 42,147 | +42,083 | 0.1 workflows | 21,385 | 19,994 | -1,391 | 6.5% |

CONCERNS:

- Small pages change the amortization story. A 10-block surgical edit still favors local per-call, but it needs about 6.7 repeated workflows to pay back the hosted listing floor.
- Read-only deficit does not shrink away with larger pages. It becomes larger in raw tokens because local carries its response wrapper/content-notice and markdown-shape overhead through every read.

## Claim 3.4 - Hosted-Side Estimation Methodology

VERDICT: The Enhanced Markdown converter is directionally reasonable for the specific fixtures, but it is not a live hosted capture and it has several undercount risks for hosted. The biggest methodological risk is not the converter; it is whether hosted `notion-update-page` should be modeled only as full-body rewrite.

EVIDENCE:

- The converter is declared as hand-rolled and tied to the Enhanced Markdown spec at `scripts/bench/workflow-token-compare.ts:174`.
- Rich text formatting is handled at `scripts/bench/workflow-token-compare.ts:186`.
- Block conversion covers headings, paragraphs, bullets, numbered lists, todos, quotes, callouts, toggles, code, equation, divider, table, columns, table of contents, bookmark/embed/media at `scripts/bench/workflow-token-compare.ts:219`.
- `blocksToEnhancedMarkdown` is the converter entrypoint at `scripts/bench/workflow-token-compare.ts:345`.
- The hosted fetch wrapper is a YAML-style model, not public hosted output, at `scripts/bench/workflow-token-compare.ts:350` and `scripts/bench/workflow-token-compare.ts:364`.
- The Notion docs say enhanced markdown supports XML-like tags and attributes for callouts, toggles, columns, mentions, and colors; the markdown content docs also show the REST markdown response wrapper as JSON with `object`, `id`, `markdown`, `truncated`, and `unknown_block_ids`.

Modeling choices that favor either side:

- Likely under-count hosted for rich pages: the converter drops colors, underline spans, captions, unknown-block tags, child page/database tags, synced blocks, breadcrumbs, bookmark/link-preview unknown tags, some children on callouts/quotes/todos, and escaping overhead. These omissions usually make hosted cheaper than a faithful Enhanced Markdown rendering.
- Likely over-count hosted for W1 if hosted MCP exposes the current Data API `update_content` command. The docs now describe targeted markdown search-and-replace; a known-string hosted edit would not need a full-body request. If hosted returns full updated markdown after the operation, the known-string hosted W1 would still be far cheaper than the modeled full-body request, though local still wins without a read prefix.
- Hosted response wrapper is uncertain. The script's YAML frontmatter is plausible as a compact text envelope, but not documented. If hosted returns a richer schema/template envelope, hosted is under-counted; if it returns a bare markdown string, hosted is over-counted.
- Hosted request modeling is charitable in W2 and W4: W2 uses a single 10-page batch at `scripts/bench/workflow-token-compare.ts:456`; W4 reuses the already fetched target and avoids an extra hosted fetch at `scripts/bench/workflow-token-compare.ts:600`.

W3 wrapper robustness:

- Baseline W3 is local 1,902 vs hosted 1,788, delta = -114.
- If hosted's wrapper is modeled as 80 tokens instead of roughly 42, the scratch retally is local 1,902 vs hosted 1,827, delta = -75. W3 does not flip.
- W3 flips only if hosted wrapper overhead increases by about 115 tokens over baseline, i.e. roughly a 156-token wrapper under the "42-token wrapper" framing.

CONCERNS:

- The current Notion markdown docs materially weaken any assertion that hosted can only do whole-page rewrites. The audit should distinguish "hosted model used by this script" from "best possible hosted API path."
- For read-only W3, small wrapper changes do not flip the verdict; converter/content-shape choices would need to add more than about 114 hosted tokens to reverse it.

## Claim 3.5 - Live Cross-Check (W3) Defensibility

VERDICT: The live cross-check is useful as a smoke test, but not a live end-to-end comparison of the two MCP surfaces.

EVIDENCE:

- The optional cross-check is implemented at `scripts/bench/workflow-token-compare.ts:654`.
- It retrieves a real page and top-level block children through the Notion REST client at `scripts/bench/workflow-token-compare.ts:661` and `scripts/bench/workflow-token-compare.ts:669`.
- It uses the same `blocksToEnhancedMarkdown` converter for the hosted estimate at `scripts/bench/workflow-token-compare.ts:680`.
- It does not call the local MCP server's actual `read_page`; it simulates the local response shape with `blocksToMarkdown`, `ourReadMarkdown`, and `{ id, title, url, markdown }` at `scripts/bench/workflow-token-compare.ts:679` and `scripts/bench/workflow-token-compare.ts:681`.
- It tokenizes those simulated response objects at `scripts/bench/workflow-token-compare.ts:687`.

CONCERNS:

- The comment says "Recursive block fetch (one level deep)", but the code only paginates top-level `blocks.children.list` results; it does not recurse into nested children. A page with important nested toggles/lists/tables could be mismeasured.
- The cross-check can be fooled by favorable page selection. A mostly plain-text page with no callouts, tables, columns, toggles, mentions, colors, synced blocks, unknown blocks, or media underestimates Enhanced Markdown machinery and may make hosted look cleaner than it would on richer pages.
- Because both sides are simulated from the same REST blocks, the cross-check validates converter/tokenization behavior more than it validates actual local-vs-hosted MCP payloads.

## Strategic Flag

At least one reasonable alternative flips the verdict: search-heavy lookup (1 search, 20 results, read 10 pages, no edits) is 1,183 tokens cheaper on hosted before listing budget. The strategy memo's "ours wins on edit/batch, ties on reads" framing is defensible only if "ties on reads" is softened: hosted can win read-heavy workflows by enough that local's larger listing budget never amortizes in those sessions.

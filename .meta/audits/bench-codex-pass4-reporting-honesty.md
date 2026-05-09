# Pass 4 Reporting Honesty Audit

Scope: `.meta/research/token-remeasure-2026-04-28.md`, `.meta/research/workflow-token-measure-2026-04-28.md`, `scripts/bench/token-compare.ts`, `scripts/bench/workflow-token-compare.ts`, and the recommended README Option A language. I did not modify the benchmark scripts or push. This audit file is the only intended edit.

External docs checked:

- Notion MCP supported tools: https://developers.notion.com/guides/mcp/mcp-supported-tools
- Notion markdown content API: https://developers.notion.com/guides/data-apis/working-with-markdown-content
- Notion Enhanced Markdown spec: https://developers.notion.com/guides/data-apis/enhanced-markdown
- Notion changelog: https://developers.notion.com/page/changelog
- Third-party indexed hosted MCP schema mirror for `notion-update-page`: https://support.optimizely.com/hc/en-us/articles/45146001276813-Notion-remote-MCP-connector

## Claim 5.1 - Caveats are sufficiently prominent

VERDICT:

- Listing-budget report: caveats prominent.
- Workflow-level report: caveats present-but-buried.

EVIDENCE:

- The listing report puts the hosted limitation in the surfaces table: `.meta/research/token-remeasure-2026-04-28.md:18` says hosted was a static fixture and "OAuth-only -- live tools/list was not captured." The next paragraph makes the lower-bound caveat load-bearing at `.meta/research/token-remeasure-2026-04-28.md:20`.
- The headline listing table labels hosted as "lower bound" at `.meta/research/token-remeasure-2026-04-28.md:28`, and the local-vs-hosted ratio heading says "we cost >= 6.4x more" at `.meta/research/token-remeasure-2026-04-28.md:45`. The ratio method immediately says the hosted total is a lower bound and the magnitude is an upper bound at `.meta/research/token-remeasure-2026-04-28.md:46`.
- A table-skimmer would probably retain "ours costs more than hosted on listing." They would also see "lower bound" in the headline table, but they might miss the OAuth reason unless they read the surfaces table. This is still close enough to the ratios to count as prominent.
- The workflow report is weaker. It names hosted as estimated in the title and methodology at `.meta/research/workflow-token-measure-2026-04-28.md:1` and `.meta/research/workflow-token-measure-2026-04-28.md:13`, but the per-workflow table at `.meta/research/workflow-token-measure-2026-04-28.md:37` presents hosted totals without "estimated" in the table itself.
- The workflow caveat that all hosted shapes are estimated appears later in section 5 at `.meta/research/workflow-token-measure-2026-04-28.md:142-145`, after the per-workflow table, break-even analysis, and recommended README claim. A reader skimming the table and Option A could miss it.

WHAT SHOULD CHANGE:

- Listing report: keep the current caveat placement. Add "description-only lower bound" directly to the local-vs-hosted ratio code block label if the report is reused in README copy.
- Workflow report: put "(hosted estimated, not captured)" in the per-workflow table caption or hosted column header. Add a one-line warning directly before Option A: "Hosted numbers below are modeled from docs, not live OAuth captures."

## Claim 5.2 - Pressure-test recommended README claim language

VERDICT: Option A is not currently defensible as README headline copy. The `64 vs ~3,800` number is a valid measurement of the script's modeled path, but the language overclaims what hosted Notion MCP requires.

Option A under audit:

> Surgical edits cost ~98% fewer tokens than the equivalent fetch-and-rewrite pattern. A `find_replace` on a 100-block page is one 64-token call, vs ~3,800 tokens for the fetch + full-page rewrite that page-replace-only servers require.

### 5.2(a) "page-replace-only servers"

VERDICT: Overclaims a category.

EVIDENCE:

- The workflow benchmark models one hosted comparator: `mcp.notion.com`. W1 constructs hosted as `notion-fetch` plus `notion-update-page` at `scripts/bench/workflow-token-compare.ts:419-429`.
- The listing benchmark includes the npm package, but the README Option A number is not measured against npm; it is the workflow report's hosted model. The npm surface has `API-patch-page` and `API-update-a-block` in `.meta/bench/token-remeasure/results.json:197-213`, so "page-replace-only" is not a clean description of the npm server either.
- The official hosted MCP docs list `notion-update-page` as able to update page content, properties, icon, or cover (Notion supported tools lines 125-130 in the fetched page). They do not publish the full input schema there.
- Web search found third-party mirrors of Notion's hosted MCP schema, not independent "page-replace-only servers" as a category.

WHAT SHOULD CHANGE:

- Replace plural category language with the exact benchmarked model: "the modeled hosted fetch-and-rewrite path" or "a hosted full-page rewrite path." Do not say "servers" unless multiple servers are actually measured.

### 5.2(b) "fetch + full-page rewrite ... require"

VERDICT: Critical finding. The requirement is likely false or at least unproven.

EVIDENCE:

- The official Notion markdown content docs say `PATCH /v1/pages/:page_id/markdown` can "insert or replace content using markdown" and recommends `update_content` plus `replace_content` for new integrations (Notion markdown content docs lines 288-290).
- The same docs define `update_content` search-and-replace with `old_str` and `new_str`, and allow `replace_all_matches` for multiple matches (lines 295-321). That competes directly with our `find_replace`.
- The update response docs say all variants return the full page content after update (lines 414-423). That means hosted's response may still be page-sized, but the request need not be a full-page rewrite.
- The Notion changelog says the Update page markdown endpoint added `update_content` for targeted search-and-replace on March 11, 2026 (Notion changelog lines 208-214). The same changelog also has MCP-specific `notion-update-page` references, including an April entry about guidance for writing via `update_page` (lines 88-93) and a February entry about `notion-update-page` bug fixes and flattened parameters (search result text for the changelog).
- This repo's own `find_replace` is implemented by calling Notion's native `pages.updateMarkdown` with `type: "update_content"` at `src/server.ts:1256-1265`. That is the same underlying API family the hosted MCP could expose.
- A third-party indexed connector page for Notion remote MCP says the connector is managed by Notion (Optimizely lines 17-21), then lists `notion-update-page` as supporting find-and-replace, a `command` option of `update_content`, and `content_updates` with `old_str`, `new_str`, and optional `replace_all_matches` (lines 229-243).

WHAT SHOULD CHANGE:

- Remove "require" from README and the workflow report until a live OAuth `tools/list` capture proves hosted `notion-update-page` lacks `update_content`.
- Add a critical caveat to the workflow report: "Current Notion docs expose `update_content` search-and-replace in the markdown update API, and indexed hosted MCP schemas suggest `notion-update-page` supports it. W1's hosted fetch-and-full-rewrite path may not be the best hosted path."
- Re-run W1 with a hosted `update_content` model. A rough request+compact-response model is about 115 tokens; if hosted returns full post-update markdown per the REST docs, W1 is closer to a one-call page-sized response, not a full-page request plus fetch.

### 5.2(c) "one 64-token call"

VERDICT: Accurate only for compact request-args plus compact response-body payload, not for a full MCP or LLM-visible tool event.

EVIDENCE:

- W1 local request is `{ page_id, find, replace, replace_all }` and response is `{ success: true }` at `scripts/bench/workflow-token-compare.ts:412-417`.
- The measurement function tokenizes `JSON.stringify(c.request)` and `JSON.stringify(c.response)`, then sums request and response at `scripts/bench/workflow-token-compare.ts:718-729`.
- The generated results confirm W1 is 59 request tokens plus 5 response tokens, total 64, at `.meta/bench/workflow-token-measure/results.json:15-17`.
- Listing budget is separate and paid once per session. The workflow report says it sums per-call payloads and adds static tools/list once per session at `.meta/research/workflow-token-measure-2026-04-28.md:10`; the script's listing constants are at `scripts/bench/workflow-token-compare.ts:52-60`.
- The 64-token figure omits JSON-RPC framing. A direct check with the same tokenizer gives:
  - args plus response body: 64 tokens.
  - full MCP `tools/call` request plus MCP result envelope: about 119 tokens.
  - Anthropic-style `tool_use` plus `tool_result` JSON approximation: about 103 tokens.

WHAT SHOULD CHANGE:

- README should say "64 request+response payload tokens" or "about 100 tokens including typical tool-call framing." Do not call it a full "64-token call" without defining the measured surface.

### 5.2(d) "~3,800 tokens"

VERDICT: Valid as a 100-block modeled-path figure, not as a representative average-page claim.

EVIDENCE:

- W1 is explicitly the 100-block fixture at `.meta/research/workflow-token-measure-2026-04-28.md:28` and the Option A sentence says "100-block page" at `.meta/research/workflow-token-measure-2026-04-28.md:102`.
- W1 hosted total is 3,785 tokens in `.meta/bench/workflow-token-measure/results.json:26-30`, with the hosted request dominated by a 1,902-token full edited body at `.meta/bench/workflow-token-measure/results.json:38-40`.
- The fixture is generated in-script, not from a committed page export. It is constructed by `buildHundredBlockPage()` at `scripts/bench/workflow-token-compare.ts:111-171`.
- I found no authoritative public evidence for average Notion page block count. Search results were mostly tutorials, limits, and anecdotal posts, not a dataset.

WHAT SHOULD CHANGE:

- Keep "100-block page" in any claim. Avoid implying it is typical. Use "in this 100-block benchmark fixture" in technical docs.
- Add a sensitivity table or link to the pass-3 sensitivity result: small pages materially reduce break-even even though local still wins under the script's full-rewrite hosted model.

## Claim 5.3 - "What we don't know" treated honestly

VERDICT:

- Listing-budget report: acknowledged honestly.
- Workflow-level report: partially acknowledged, with one critical unacknowledged risk.

EVIDENCE:

- The listing report acknowledges that hosted's 772-token total is description-only and real `inputSchema` could put hosted around 1,500-4,000 tokens at `.meta/research/token-remeasure-2026-04-28.md:114`. It also explicitly says even 4x the floor would make local about 1.6x hosted at `.meta/research/token-remeasure-2026-04-28.md:54`. That is honest and close to the ratio.
- The workflow report acknowledges estimated hosted request/response shapes at `.meta/research/workflow-token-measure-2026-04-28.md:142-145` and lists uncertainty around hosted listing, fetch wrappers, retries, colors, search response shape, and W4's lucky read path at `.meta/research/workflow-token-measure-2026-04-28.md:147-156`.
- The workflow report does acknowledge pure reads can favor hosted: W3 shows hosted winning by 114 tokens at `.meta/research/workflow-token-measure-2026-04-28.md:41`, and break-even says read-only sessions never break even at `.meta/research/workflow-token-measure-2026-04-28.md:67`.
- It does not acknowledge the stronger pass-3 counterexample: search-heavy lookup can flip materially against local by about 1,183 tokens before listing budget (`.meta/audits/bench-codex-pass3-workflows.md:48-53`).
- It does not acknowledge hosted `update_content` as a direct competitor to `find_replace`. That omission is critical given the Notion docs cited above.
- It does not caveat W1's best case: local `find_replace` assumes the agent already knows the exact strings. Pass 3 retallied W1 with a local `read_page` prefix and the advantage dropped from 3,721 tokens to 1,819 tokens (`.meta/audits/bench-codex-pass3-workflows.md:18-25`).

WHAT SHOULD CHANGE:

- Add three caveats to workflow section 5:
  1. "Search-heavy read workflows can favor hosted enough that local never amortizes its listing deficit."
  2. "Hosted may expose `update_content` search-and-replace through `notion-update-page`; live schema capture is required before claiming hosted requires full-page rewrite."
  3. "W1 assumes the agent already has the exact target string; if it must read first, the advantage is smaller."
- Move those caveats above the README recommendation, not after it.

## Claim 5.4 - Third-party reproducibility

VERDICT: Partially reproducible from the worktree, not hermetic enough for a third-party published benchmark.

EVIDENCE:

- Tokenizer dependency is pinned in `package-lock.json` to `js-tiktoken` 1.0.21, while `package.json` uses a caret range at `package.json:60`. Reproducibility depends on using `npm ci`, not a fresh unconstrained install.
- The npm comparator is not pinned in the script. `scripts/bench/token-compare.ts:125-128` installs `@notionhq/notion-mcp-server@latest`, though the report records v2.3.0 at `.meta/research/token-remeasure-2026-04-28.md:17` and `.meta/research/token-remeasure-2026-04-28.md:118`.
- The local server is described as HEAD at `.meta/research/token-remeasure-2026-04-28.md:16`, but the report does not record the commit SHA. Current worktree HEAD during this audit is `4ef55ba6ea74ab3665f9eaff9dfba858ddb72e67`; `src/server.ts` last changed in commit `520fedf` per local git output.
- The hosted fixture exists at `.meta/bench/token-remeasure/hosted-tools-fixture.json` and has explicit lower-bound metadata at lines 1-4. `git ls-files` shows the token fixtures and workflow artifacts are tracked in the index. However, `git status --short` shows these benchmark files are staged as new or modified, not committed in HEAD in this worktree. A third party cloning only the last committed SHA may not receive them unless this branch/index state is published.
- The workflow fixture is generated in-script by `buildHundredBlockPage()` at `scripts/bench/workflow-token-compare.ts:111-171`, not committed as a standalone fixture. That is reproducible as long as the script is the same.
- `scripts/bench/workflow-token-compare.ts` can run without `NOTION_TOKEN`; live cross-check is optional and skipped if env is absent at `scripts/bench/workflow-token-compare.ts:654-659`. The latest generated `results.json` shows the live cross-check was skipped at `.meta/bench/workflow-token-measure/results.json:228-230`.

Undocumented setup steps for a fresh reviewer:

- Use Node >=18 (`package.json:41-43`).
- Run `npm ci` to get the exact tokenizer/tooling versions from `package-lock.json`.
- Use `npm exec tsx -- scripts/bench/workflow-token-compare.ts` or otherwise put `node_modules/.bin` on PATH before running the documented bare `tsx ...` command.
- For `token-compare.ts`, have network access because the script installs the npm comparator dynamically.
- Expect scripts to overwrite `.meta/bench/.../results.json` and `summary.md`.
- Ensure `.meta/bench/token-remeasure/hosted-tools-fixture.json` is present.
- Optional: set `NOTION_TOKEN` and `WORKFLOW_BENCH_PAGE_ID`/`NOTION_ROOT_PAGE_ID` for the live W3 cross-check.

WHAT SHOULD CHANGE:

- Pin `@notionhq/notion-mcp-server@2.3.0` in the script or make the version a required argument recorded in results.
- Record `git rev-parse HEAD`, `src/server.ts` blob SHA, Node version, npm version, and lockfile hash in both `results.json` files.
- Document `npm ci` and `npm exec tsx -- ...` commands in the reports.
- Commit or publish the fixture artifacts before asking third parties to reproduce.

## Claim 5.5 - Strategy-memo segment-language refinement defensibility

VERDICT: The refinement is directionally grounded in the numbers, but still too broad after pass 3 and the `update_content` finding.

EVIDENCE:

- Section 6 admits the old "tool-context bloat" framing fails on listing budget: `.meta/research/workflow-token-measure-2026-04-28.md:163` says local costs 6.4x the hosted floor and loses that dimension.
- Section 6 then narrows the target to "agent users running long, edit-heavy sessions" at `.meta/research/workflow-token-measure-2026-04-28.md:166`. That is not pure spin; it follows from W1, W2, and W4 per-call deltas in `.meta/research/workflow-token-measure-2026-04-28.md:39-42`.
- But section 6 also says local "wins on every mutation surface and ties on reads" at `.meta/research/workflow-token-measure-2026-04-28.md:164`. The report's own W3 has hosted winning reads by about 6% at `.meta/research/workflow-token-measure-2026-04-28.md:48`, and pass 3 found a search-heavy lookup where hosted wins by 1,183 tokens before listing (`.meta/audits/bench-codex-pass3-workflows.md:48-53`).
- If hosted exposes `update_content`, then "edit-heavy" is also too broad: known-string find/replace may not be a local-only moat. The stronger local angle becomes compact local tool ergonomics and any operations hosted cannot do compactly, such as schema-backed batch writes, section updates if hosted cannot target headings equivalently, and future block-level tools.

WHAT SHOULD CHANGE:

- Refine the segment language further: "agent users running long sessions where targeted mutations and batch writes materially outnumber pure search/read calls."
- If the README wants maximum defensibility after the hosted `update_content` risk, use an even narrower version: "long sessions dominated by local compact mutation primitives, not pure Notion search/fetch."
- Remove "ties on reads"; say "hosted can be cheaper on pure read and search-heavy sessions."

## Bottom-line README recommendation

Do not ship Option A verbatim.

Safer replacement:

> For the modeled hosted fetch-and-rewrite path, a known-string `find_replace` on our 100-block benchmark page costs 64 request+response payload tokens, versus ~3,800 tokens for fetching and rewriting the full page. Hosted Notion MCP may expose `update_content` search-and-replace; live OAuth schema capture is required before making this a hosted-vs-local headline.

Better README headline until live capture:

> Optimized for long, edit-heavy Notion sessions: compact tools for targeted edits and batch writes reduce per-operation payloads, while hosted Notion can be cheaper for pure search/read workflows.

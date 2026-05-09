# Bench scripts audit — token-compare.ts and workflow-token-compare.ts

**Date:** 2026-04-28
**Scope:** Methodology audit of the two bench scripts committed to `dev` earlier today and the strategic claims they back. The scripts were authored by Claude builders before the `audit` role-loading fix landed; their numbers drove README revision (retiring the "92% fewer tokens" claim), strategy-memo segment-language refinement, and PR3's destructive-warning text choice.
**Method:** Audit PM (this file) speccing four focused contracts; Codex executing each via independent re-runs, web checks, and adversarial constructions. PM read scripts and reports only at synthesis time; verification was Codex-led.
**Audit memo:** this file. Per-pass evidence files at `.meta/audits/bench-codex-pass{1..4}-*.md`. Session chain at the footer.

## 1. Summary

The headline numbers **reproduce exactly** on fresh runs: local 4,969 / npm 15,206 / hosted ≥772 listing tokens; per-workflow deltas at 64 vs 3,785 (W1), 581 vs 3,316 (W2), 1,902 vs 1,788 (W3), 3,114 vs 3,767 (W4). The tokenizer methodology is consistent across surfaces, the local fixture matches a real MCP SDK `client.listTools()` to within 1 token, and the local-vs-frame-5 drift (+30%) is traceable to actual description growth in `src/server.ts`.

**But two methodological gaps undercut the strategic narrative.** First: the W1 "98% find_replace win" is modeled against a hosted path (fetch + full-page rewrite) that hosted may not actually require — Notion docs and a third-party indexed schema indicate `notion-update-page` likely exposes `update_content` search-and-replace, the same primitive `src/server.ts:1256` uses for our `find_replace`. If true, the 98% advantage shrinks to a small framing-only edge. Second: the "we cost 6.4× hosted listing" framing is the worst-case ratio against a description-only floor — projecting realistic schemas from this repo's own conventions puts hosted at ~2.0–2.2K tokens, making the real ratio closer to 2.3×, not 6.4×.

**Verdict:** the scripts are sound as instruments; the **reports overclaim what the instruments measured**. The recommended README "Option A" claim should not ship as written. The strategy memo's segment-language refinement makes numerical sense as a *direction* but needs further tightening on reads and a flag for the `update_content` risk before any externally-visible copy is locked.

## 2. Findings

### Critical

**C1. Hosted may already expose `update_content` search-and-replace.** The W1 win depends on hosted requiring fetch + full-page rewrite for known-string edits. Codex pass 4 found:
- Notion's markdown-content docs explicitly document `update_content` with `old_str`, `new_str`, `replace_all_matches` semantics on `PATCH /v1/pages/:page_id/markdown` (`https://developers.notion.com/guides/data-apis/working-with-markdown-content`, lines 295–321).
- A March 11 2026 changelog entry adds `update_content` for targeted search-and-replace.
- A third-party indexed connector page (Optimizely's hosted MCP doc, lines 229–243) lists `notion-update-page` with `command: update_content` and `content_updates: { old_str, new_str, replace_all_matches }`.
- This repo's own `find_replace` calls `pages.updateMarkdown` with `type: "update_content"` (`src/server.ts:1256-1265`) — same underlying API family hosted MCP would expose.

**Impact:** if hosted exposes this, W1 becomes a request roughly equivalent to ours (~115 tokens) plus a hosted response that may still return full post-update markdown (per REST docs). The "98% smaller" claim collapses to a small framing-only win, not a structural moat. The "page-replace-only servers" framing in the recommended README claim is provably overclaiming a category.

**Recommended fix:** do not ship Option A. Either capture hosted `tools/list` live via OAuth and confirm or refute `update_content`, or rewrite the claim around capabilities that *are* measured (compact tool ergonomics overall, batch DB writes with property-strict semantics, `update_section`'s heading-targeted edit) rather than a single 98% number. **Strategic narrative needs revision** until a live OAuth capture settles this.

**C2. The "6.4× hosted listing budget" framing inverts a lower bound into a worst-case ratio.** The token-remeasure report says "we cost at least 6.4× more" (`.meta/research/token-remeasure-2026-04-28.md:51`) and the per-workflow analysis uses a 3,000-token "midpoint." Codex pass 2 projected hosted's realistic listing total by mapping each of the 18 hosted tools to its closest local analog and summing schema tokens with the same tokenizer:
- Per-tool analogs sum: 1,409 schema tokens.
- Adjusted total: 772 − 216 (empty stubs) + 1,409 = **1,965 tokens**.
- A docs-prose-rich projection lands at ~2,176 tokens.
- The report's 1,500–4,000 plausible range is correct but broad; ~2,000 is the more grounded center.

**Impact:** at 2,000 hosted tokens, local is ~2.5× hosted. At 3,000, ~1.7×. Only at 4,000 does local approach 1.2×. The 6.4× framing reads as a settled disadvantage when it's the floor-ratio under hosted's most-charitable-to-hosted modeling. Strategy-memo language built on "we lose listing budget by ~6×" is leaning on the worst plausible value of an unmeasured number.

**Recommended fix:** rewrite the local-vs-hosted ratio block (`.meta/research/token-remeasure-2026-04-28.md:45-54`) so the headline phrase is "ours costs more than hosted on listing budget alone — under a docs-projection of hosted's real schemas, ~2.5× more, with worst-case 6.4× against the description-only floor." **Strategic narrative needs softening** in any externally-visible copy.

### High

**H1. Search-heavy read workflows flip the verdict against ours.** Codex pass 3 modeled a realistic alternative — 1× search returning 20 results, then 10× page reads — using the same tokenizer and converter. Result: ours 8,509 vs hosted 7,326, **hosted wins by 1,183 tokens before listing budget**. The strategy memo's claim that ours "wins on every mutation surface and ties on reads" (`.meta/research/workflow-token-measure-2026-04-28.md:164`) is true for the four chosen workflows but does not generalize — read-heavy sessions can favor hosted by enough that ours never amortizes its larger listing deficit.

**Impact:** strategic claim "agent users running long, edit-heavy sessions" is directionally OK but "ties on reads" must be replaced with "hosted can win read-heavy workflows by enough that local listing-deficit never amortizes."

**Recommended fix:** add a fifth workflow (read-heavy lookup) to the script and to §2 of the workflow report. Soften §6 to remove "ties on reads."

**H2. NPM version mis-recorded.** Codex pass 2 confirmed `@notionhq/notion-mcp-server@latest` is **v2.2.1**, not v2.3.0 as recorded in the report (`.meta/research/token-remeasure-2026-04-28.md:17, 118`). Headline 15,206 reproduced exactly because the script captures whatever `latest` is at runtime, but the version pin in the report is wrong.

**Impact:** small alone; combined with the lack of any commit SHA pin (see L2 below), reproducibility evidence is weaker than claimed.

**Recommended fix:** update the report; pin the version explicitly in the script (`@notionhq/notion-mcp-server@2.2.1`) or record the resolved version in `results.json`.

**H3. W1 best case assumes the agent already knows the find string.** Codex pass 3 retallied W1 with a realistic local `read_page` prefix:
- Original W1: 64 vs 3,785, +3,721 (98% smaller) → break-even 1.1 workflows.
- W1 + read prefix: 1,966 vs 3,785, +1,819 (48% smaller) → break-even 2.3 workflows.

**Impact:** the "98% smaller" headline number is only valid for the prompt-supplied-string case. Many real-world `find_replace` calls follow a read. The advantage is durable but smaller.

**Recommended fix:** add a parenthetical in the W1 row of the per-workflow table (and any README copy) — "assumes agent already has target string; with a read prefix the per-call delta is +1,819 not +3,721."

### Medium

**M1. Recommended README "Option A" language has multiple specific defects.** Codex pass 4 walked the claim line-by-line:
- "**page-replace-only servers**" (plural) — only one hosted comparator was modeled; npm baseline isn't cleanly described as page-replace-only either (`API-update-a-block` exists). Overclaims a category.
- "**require**" — unproven against `update_content` (see C1).
- "**one 64-token call**" — the 64 is request-args + response-body. Full MCP envelope is ~119 tokens; Anthropic-style `tool_use` + `tool_result` is ~103. Honest as "64 payload tokens"; misleading as a full call cost.
- "**~3,800 tokens**" — valid for 100-block fixtures only. At 10 blocks, hosted is 687, not 3,785; W1 break-even shifts from 1.1 to 6.7 workflows.

**Recommended fix:** the safer rewrite Codex offered:

> For the modeled hosted fetch-and-rewrite path, a known-string `find_replace` on our 100-block benchmark page costs 64 request+response payload tokens, versus ~3,800 tokens for fetching and rewriting the full page. Hosted Notion MCP may expose `update_content` search-and-replace; live OAuth schema capture is required before this becomes a hosted-vs-local headline.

That removes the overclaim and keeps the measurement.

**M2. Workflow-report caveats are buried.** Codex pass 4 found:
- The per-workflow table at line 37 doesn't say "(estimated)" in the column headers or caption.
- The §5 caveats sit *after* the per-workflow table, the break-even analysis, *and* the recommended README claim language.
- A reader skimming the headline table and Option A would miss them.

**Recommended fix:** add "(hosted estimated, not captured live)" to the per-workflow table caption. Move the §5 caveats above the §4 README recommendation, or add a one-line warning directly before §4.

**M3. W1 sensitivity to page size.** Codex pass 3 varied the page size from 10 to 1,000 blocks. The 100-block headline is strongly favorable to ours, but at 10 blocks, break-even is 6.7 workflows (vs 1.1 at 100 blocks). The W1 win is durable across sizes; the *amortization narrative* isn't durable below ~50 blocks.

**Recommended fix:** add a sensitivity note to §3 of the workflow report. Avoid implying 100 blocks is typical.

**M4. Live cross-check (W3) doesn't validate what its name implies.** Codex pass 3 found:
- The cross-check labels itself "Recursive block fetch (one level deep)" but only paginates top-level blocks; nested toggles/lists/tables aren't recursed (`scripts/bench/workflow-token-compare.ts:654-687`).
- It doesn't call our local MCP server's actual `read_page`; it simulates the local response from the same REST blocks the hosted estimate uses (line 679, 681).
- So the cross-check validates the converter and tokenization, not actual local-vs-hosted MCP payloads.

**Recommended fix:** rename the comment to be honest ("converter-shape smoke test on real Notion data, both sides simulated"). For real cross-validation, call `read_page` via `InMemoryTransport` against our server with a real workspace page and compare to the converter output.

**M5. Hosted fixture descriptions are docs-derived, not verbatim.** Codex pass 2 spot-checked 4 tools; descriptions are editorially compressed (e.g., `notion-fetch`: docs say "by its URL or ID"; fixture says "by URL/ID"). Multiple inputSchema-relevant prose elements (template handling, default-private-page parent behavior, view DSL, comment threading) are dropped. The auto-generated `summary.md` says "Hosted fixture includes verbatim published descriptions" — that overclaims fidelity.

**Recommended fix:** describe the fixture as "docs-derived, description-only, editorially compressed, lower-bound" in the summary template.

### Low

**L1. Python tiktoken cross-check is asserted, not coded.** The token-remeasure report (`:5`) claims js-tiktoken vs Python tiktoken parity within 1.2%. The scripts contain no Python invocation. Codex pass 1 reproduced the variance independently:
- Python with `ensure_ascii=False` and JS-equivalent compact serialization: 4,969 (exact match).
- Python with default `ensure_ascii=True`: 5,030 (1.227% variance — matches the claim).

The claim is true under specific Python settings, but it's an out-of-band check, not a script-enforced contract. If a future change drifts the comparison, nothing will catch it.

**Recommended fix:** either add a `--cross-check` flag to the script that shells out to Python tiktoken, or remove the parity claim from the report.

**L2. Reproducibility hermeticity is partial.** Codex pass 4:
- `js-tiktoken` is `^1.0.21` in `package.json:60` (only pinned by lockfile — `npm ci` required, not documented).
- `@notionhq/notion-mcp-server@latest` is unpinned in the script.
- No git SHA, Node version, or lockfile hash is recorded in `results.json`.
- Bare `tsx scripts/bench/...` invocation in the report's Usage block requires `node_modules/.bin` on PATH; should be `npm exec tsx -- ...` or `./node_modules/.bin/tsx ...`.

**Recommended fix:** record `git rev-parse HEAD`, resolved npm version, Node version, lockfile hash in both `results.json` files. Document `npm ci` and the canonical invocation.

**L3. Hosted modeling has multiple under-counts.** Codex pass 3 enumerated converter omissions: colors (block + inline `<span color>`), underline spans, captions, unknown-block tags, child blocks on callouts/quotes/todos, synced-block placeholders, breadcrumbs, bookmark/link-preview unknown tags, escape characters. These bias hosted *cheaper* than a faithful Enhanced Markdown rendering. Direction-of-finding (W1, W2, W4: ours wins) is unaffected; magnitudes for hosted are floors.

**Recommended fix:** keep current modeling but add a §5 caveat: "all hosted body costs are floors — colors, captions, unknown blocks, and similar attributes are dropped by the converter and would push hosted cost up in real responses."

**L4. Workflow script hardcodes listing budgets.** `scripts/bench/workflow-token-compare.ts:52-60` constants (4969/772/3000) are not recomputed from the listing benchmark output. If listing drifts, the workflow break-even is silently stale.

**Recommended fix:** read the listing-benchmark `results.json` if present, fall back to constants if not.

### Informational

**I1. Headline numbers are bit-exact reproducible** on fresh runs. Tokenizer mechanics, compact JSON-stringify, and the encoder choice are consistent across all surfaces and both scripts.

**I2. Local-tools.json matches `client.listTools()` to within 1 token.** Codex pass 1 ran a real MCP SDK `InMemoryTransport` against the built `dist/index.js`: tools-array tokens 4,969 (exact match); full `{tools: [...]}` wrapper 4,970. The script's "listing budget" measurement is a faithful proxy for what an MCP client receives.

**I3. Local +30% drift from frame-5 is real.** Codex pass 2 traced specific description and schema expansions in `src/server.ts` since `d66eb47`: `replace_content` destructive warnings, `read_page` pagination contracts, `create_database` property-type expansions, `query_database` truncation guidance, `add_database_entry`/`update_database_entry` writable-type lists. Not a measurement bug.

**I4. Local fixture matches a fresh stdio capture from built HEAD exactly** (Codex pass 2, jq-S diff yielded zero changes). Tool count matches `src/server.ts` registrations (28).

**I5. NPM fixture matches `@notionhq/notion-mcp-server@latest` (v2.2.1) exactly** (Codex pass 2, jq-S diff yielded zero changes).

## 3. Headline-number verdicts

| Number | Source | Verdict | Reasoning |
|---|---|---|---|
| Local listing 4,969 | token-compare.ts | **Confirmed** | Reproduces exactly; matches MCP SDK `listTools()` to ±1 token; drift from frame-5 traced to real changes. |
| NPM listing 15,206 | token-compare.ts | **Confirmed** | Reproduces exactly against v2.2.1 (current `latest`). Report's v2.3.0 pin is wrong but doesn't move the number. |
| Hosted listing ≥772 | token-compare.ts (fixture) | **Confirmed as floor; softened** | The 772 is a description-only lower bound. Realistic hosted total projects to ~2.0–2.2K under this repo's schema conventions. The "we cost 6.4× hosted" framing is the worst-case ratio against a floor, not a settled comparison. |
| W1 64 vs 3,785 (98% smaller) | workflow-token-compare.ts | **Softened** | Reproduces against the modeled hosted path. But hosted may expose `update_content` (per Notion docs + indexed third-party schema), in which case the modeled fetch+rewrite isn't required. With a realistic local `read_page` prefix, the win drops to 48%. |
| W2 581 vs 3,316 (82% smaller) | workflow-token-compare.ts | **Confirmed (modeled)** | Charitable hosted single-batch path. Property-wrapper bloat on hosted side is real and well-modeled. |
| W3 1,902 vs 1,788 (6% larger, hosted wins) | workflow-token-compare.ts | **Confirmed** | Robust to small wrapper-modeling variations (hosted wrapper would need to grow ~115 tokens before W3 flips). |
| W4 3,114 vs 3,767 (17% smaller) | workflow-token-compare.ts | **Confirmed (modeled, charitable)** | Script gives hosted the lucky no-extra-fetch path; without that, hosted loses by ~1.5K. |
| Break-even 1.1–1.5 workflows | workflow-token-compare.ts | **Softened** | Only valid at ~100 blocks for surgical edits. At 10 blocks, break-even is 6.7. Read-heavy sessions never break even. |

## 4. Testing assessment

These bench scripts *are* the measurement. There is no separate test suite that asserts their correctness. What they verify and what they don't:

**Verified well:**
- Single tokenizer applied uniformly across surfaces.
- Compact JSON-stringify (no pretty-print) is the consistent input shape.
- Local capture is a real stdio JSON-RPC `tools/list` against a built server.
- NPM capture installs and spawns the published package; same protocol.
- Reports are reproducible (every headline matched to ±0 tokens on fresh runs).

**Under-tested or missing:**
- **No assertion that the workflow script's listing-budget constants match the listing benchmark's output.** They could silently drift apart.
- **No live OAuth capture against `mcp.notion.com`.** This is the single piece that would settle C1 (`update_content`) and C2 (real hosted listing budget). Estimated ~30–60 minutes of OAuth setup; would also enable a real W3 cross-check.
- **No regression test on tokenizer parity.** The 1.2% js-tiktoken/Python claim is asserted in prose, not enforced.
- **No fixture for the workflow script's 100-block page.** Generated in-script. Reproducible but not visible to a third-party reviewer.
- **No commit SHA / Node version / lockfile hash in results.** Reproducibility relies on cloning the right branch state.
- **No smoke test that fails loudly if hosted-fixture description fidelity slips.** A future fixture rewrite could silently drop content.

The biggest gap is the live OAuth capture. Everything else is real but estimated; the OAuth capture would convert most of the "modeled" disclaimers into measurements and would settle whether the surgical-edit narrative survives `update_content`.

## 5. Positive patterns

What's working that should be preserved:

- **Single tokenizer, uniformly applied.** No surface gets a different encoder, different stringification, or different pre-processing. This is the foundational thing the audit exists to verify, and it holds.
- **Live JSON-RPC capture via real stdio for two of three surfaces.** Not a mock-and-hope. The local fixture matches a real MCP SDK `client.listTools()` to ±1 token.
- **Hosted-side caveats present and load-bearing.** Even where caveats are buried (M2), they're not absent. The token-remeasure report's lower-bound disclaimer (`:18-20`) is appropriately prominent. The workflow report's §5 lists the right uncertainties.
- **The reports correctly retire the 92% README claim** and note it conflated response-payload and listing-budget surfaces. That self-correction is honest and load-bearing for v0.5 positioning.
- **The "soften, don't retract" stance on the original 92% number** is calibrated correctly — the prior measurement was honest for its surface, just measured the wrong thing for current users.
- **Compact JSON-stringify (no pretty-print)** matches what an LLM actually sees on the wire — a real call would not have whitespace inflating the count.
- **Workflow §6 explicitly admits a strategic refinement is needed.** The framing of "agent-orchestration users blocked by tool-context bloat → agent users running long, edit-heavy sessions" is exactly the kind of self-corrective move audits exist to encourage. The direction is right; just needs further tightening (see H1, C1).

## 6. Does the recommended README claim language survive?

**No.** Option A as written must not ship. Specific failures: "page-replace-only servers" (plural, only 1 modeled, possibly false even singular), "require" (unproven against `update_content`), "one 64-token call" (omits framing), "~3,800 tokens" (only at 100 blocks).

**Two paths forward:**

1. **Live OAuth capture first.** Spend the 30–60 min, capture hosted `tools/list` and a real `notion-update-page` schema. If `update_content` is exposed, the W1 narrative collapses and the README claim must be rewritten around something else (compact tool ergonomics overall, batch DB writes, `update_section`). If `update_content` is *not* exposed, Option A becomes defensible after the wording fixes in M1.

2. **Ship a narrower, defensible claim now without a hosted-vs-X framing.** The Codex-suggested rewrite captures what's actually been measured:

   > For the modeled hosted fetch-and-rewrite path, a known-string `find_replace` on our 100-block benchmark page costs 64 request+response payload tokens, versus ~3,800 tokens for fetching and rewriting the full page. Hosted Notion MCP may expose `update_content` search-and-replace; live OAuth schema capture is required before this becomes a hosted-vs-local headline.

   That's not headline-friendly but it's defensible. Path 1 is preferable.

## 7. Does the strategy memo's segment-language refinement still make numerical sense?

**Directionally yes, with two required tightenings.**

The refinement from "agent-orchestration users blocked by tool-context bloat" to "agent users running long, edit-heavy sessions" follows from W1, W2, and W4 — the numbers really do support per-call savings on mutation workflows that amortize the listing deficit after 1–2 edit-heavy operations.

**Tighten 1:** drop "ties on reads." H1's adversarial workflow (search-heavy lookup: 1 search + 10 reads) flips by 1,183 tokens before listing budget. The right phrasing is "hosted can be cheaper on read- and search-heavy sessions; local amortizes only when mutations dominate."

**Tighten 2:** flag the `update_content` risk. If hosted exposes it, "edit-heavy sessions" stops being a moat for known-string finds — local's structural edge shrinks to compact tool ergonomics broadly (28 well-shaped tools, batch DB writes with property-strict semantics, `update_section`'s heading-targeted edit, possible future block-level tools), not surgical-edit specifically.

After both tightenings, the segment language defensibly becomes something like: "agent users running long sessions where targeted mutations and batch writes outnumber pure search/read calls, and where the local ergonomic surface (28 compact tools, property-strict batch writes, section-targeted edits) materially compresses per-call payloads versus the modeled hosted equivalent." Less crisp; more defensible.

## 8. Audit areas not covered

- **Live OAuth capture against `mcp.notion.com`.** Out of scope for this audit (no OAuth credentials, no time to set them up). This is the single piece that would settle C1, C2, the real hosted listing-budget upper bound, the actual hosted `tools/call` response shape, and whether `update_content` really exists on `notion-update-page`. ~30–60 min of setup. Strongly recommended as the next dispatch.
- **Real-world Notion page-size distribution.** Codex pass 4 searched and found no authoritative dataset on average block count. The "100-block page" benchmark is treated as if it were typical; it might be larger than typical. A small qualitative survey (look at a sample of pages in real workspaces) would calibrate this.
- **Tokenizer parity under real LLM frontends.** The reports note Anthropic and OpenAI re-serialize MCP tools. Frame-5 found ~1-token parity for the listing case, but no audit was done at the *workflow* level — Anthropic's `tool_use` event encoding for a `find_replace` call could differ from the script's per-call payload sum. Probably small but unmeasured.
- **`@notionhq/notion-mcp-server` v2.x → v3.x transition.** Notion is sunsetting the npm package; the audit didn't dig into whether any v3 exists or what its surface looks like. Probably not relevant to this dispatch's strategic claims.

## Session chain

- Audit PM (this file): orchestrator-spawned audit-role session for `bench-scripts-audit-2026-04-28`.
- Codex pass 1 — tokenizer methodology + headline reproducibility: `bench-audit-codex-tokenizer-reproduce` (sessionId `019dd7d2-1efd-7fe3-96eb-548dcece3bc4`). Output: `.meta/audits/bench-codex-pass1-tokenizer-reproduce.md`.
- Codex pass 2 — fixture completeness + provenance: `bench-audit-codex-fixtures` (sessionId `019dd7d7-fbf0-7fd1-8923-9ce4cd36016a`). Output: `.meta/audits/bench-codex-pass2-fixtures.md`.
- Codex pass 3 — workflow representativeness + sensitivity: `bench-audit-codex-workflows` (sessionId `019dd7df-2ae1-7cb0-b178-a9e4da50dd4f`). Output: `.meta/audits/bench-codex-pass3-workflows.md`.
- Codex pass 4 — reporting honesty + README claim: `bench-audit-codex-reporting-honesty` (sessionId `019dd7e6-4f38-7561-abc5-c5808ad5a9bd`). Output: `.meta/audits/bench-codex-pass4-reporting-honesty.md`.

Each Codex pass executed independently with no priming from the reports under audit (reports were referenced only for sanity-check at end of each pass). All four sessions produced exact-match reproduction of headline numbers on fresh re-runs.

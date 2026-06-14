# Token-cost benchmark — results (Phase 2: live read + DB axes)

**Date:** 2026-06-13 · **Status:** executed. Headline numbers use the **Anthropic token-counting API**
(`claude-opus-4-8`) as primary; cl100k_base (`js-tiktoken` gpt-4) committed as the keyless cross-check.
**Method/pre-registration:** `.meta/plans/token-benchmark-methodology-2026-06-13.md` +
`.meta/bench/preregistration-2026-06-13.md` (committed before measurement; git history shows method
preceded results). **Reproducibility artifacts:** `.meta/bench/read-axis/` and `.meta/bench/db-axis/`
(verbatim per-server outputs + `results.json`); re-running `--reuse-raw` over them reproduces every
number exactly.

This is **not** a public README artifact. It is the measured evidence the masthead claim must be built
from. The honesty bar: it must survive a skeptical competitor reading the repo.

---

## 0. Headline (Axis B — page read, ours vs the official makenotion server)

Across a controlled corpus of 8 page-shape classes (favorable → adversarial), reading a page's full
content costs fewer response tokens **ours vs makenotion (the official Notion MCP server, which returns
raw block JSON)**. The size of the win depends on how much of the page's content our markdown preserves,
so the headline is **stratified by content-completeness** rather than collapsed into one factor over a
hand-picked class list. The exclusion is a **visible completeness threshold**, not a chosen set:

| Completeness tier | Classes | Geomean (lead) | Median | Range |
|---|---|---|---|---|
| **Lossless** (content-completeness = 1.0) | R2, R3, R4, R6 (k=4) | **5.04×** | 5.33× | 2.8×–9.5× |
| **High-completeness** (≥ 0.94) | + R1 (k=5) | **6.24×** | 7.36× | 2.8×–14.7× |

Anthropic-primary. Aggregates are over **classes** (k); the per-class factor is the median of the 5
per-fixture ratios, and the within-class fixture spread is kept as a stability footnote (§3), not as the
unit of the headline. We **lead with the geometric mean** (the right average for ratios); the median is
the robustness check. Classes below the ≥0.94 threshold — R5 (completeness 0.054), R8 (0.25), R7 (0.716)
— are reported separately in §4, because on those shapes part of the token gap is content our markdown
drops, not serialization. The full per-class numbers (all 8 classes, all three token bases) are in §3;
`scripts/bench/lib/recompute-tiers.ts` regenerates this table from `results.json`.

**At equal information the two formats cost about the same.** Normalize both outputs to the same
intermediate representation before counting (the **common-IR** factor) and the win nearly vanishes on the
clean classes: **R6 1.01×, R4 1.03×, R3 1.06×, R1 0.95×** (R2 1.32× is the one mild outlier). So the
page-read saving is **not** encoding efficiency — it is the per-block metadata raw Notion JSON carries
(block UUIDs, timestamps, author objects, annotation wrappers) that a content read does not need. Strip
that metadata and the formats converge.

**Call count is a clean second metric, with no completeness caveat.** Reading a page is **1 tool call for
ours** vs makenotion's page-retrieve + recursive `get-block-children`: **2 calls on a typical page**, and
**98 calls on the deep-nesting R7 page** (1 retrieve + 97 block-children) against our 1. Fewer
round-trips regardless of how tokens are counted.

This win is **vs raw-JSON**. It does **not** hold against other markdown converters (awkoy/better-notion;
§3), where we are roughly at parity. The defensible public claim is a **range scoped to the response axis
vs the official server, at a stated completeness threshold**, never a bare "Nx".

---

## 1. Servers under test — pins (authoritative) + better-notion amendment

| Server | Pinned SHA | pkg | Notion-Version sent | Nature |
|---|---|---|---|---|
| **easy-notion (ours)** | worktree HEAD under test | 0.9.3 | **2026-03-11** | markdown converter |
| **makenotion/notion-mcp-server** | `e79f35fd64cc5db726fbba1beebaa84c80760c17` | 2.3.1 | 2025-09-03 | thin OpenAPI proxy (raw REST JSON) |
| **awkoy/notion-mcp-server** | `f5f1bdaf2456093a583722dab8422cf7b972636c` | 2.5.1 | 2025-09-03 | markdown + `notion_execute` dispatcher |
| **better-notion-mcp (@n24q02m)** | `923387f27cb0d7c4be327dc4e7beaa896fe49c7c` | **2.33.0** | 2025-09-03 | markdown "mega/composite" tools |

### Pre-registration amendment — better-notion re-pin
The pre-registered better-notion SHA (`7c56493…`, v2.34.8-beta.3) is **uninstallable**: it requires the
unpublished `@notionhq/client@^5.22.0` (npm max at run time: 5.21.0). The constraint was bumped from
`^5.20.0` to `^5.22.0` at commit `15d8fb6` (2026-05-22). The **newest installable** commit is its parent
**`923387f` (v2.33.0, 2026-05-22)**, which `npm ci --ignore-scripts` resolves to `@notionhq/client@5.21.0`,
builds, and runs over stdio with `NOTION_TOKEN` (11 tools, matching the pre-reg expectation). All
better-notion numbers below use this re-pinned SHA. This restores the 4th server that was blocked at the
Phase-1 surface axis (which reported 3/4).

**Supply-chain:** awkoy and better-notion are low-star; both inspected (package.json scripts/bin) and all
installs use `--ignore-scripts`.

### Anthropic primary tokenizer — confirmed LIVE
The Phase-1 Anthropic hook is now live (not the deferred `available:false` stub). `results.json`
records `tokenizer.anthropic = {model:"claude-opus-4-8", version:"2023-06-01", available:true}`. Every
counted string is wrapped identically in a single-message `messages` payload (wrapper-invariant across
servers). Raw token counts are committed in `results.json`.

---

## 2. Methodology note — provisioning via the raw Notion API (deviation, flagged)

The corpus pages were created in Notion via the **raw Notion REST API**, not via our `create_page`. This
deviates from the literal Phase-2 brief ("provision via our server") and is a deliberate methodological
choice, because our markdown expresses color only at callout block-level, **not per-span** — provisioning
R5 (annotation-pathological) through our converter would strip the colors *before they reached Notion*,
fabricating away the exact information-drop R5 exists to measure. Raw-API provisioning preserves full
fidelity (per-span colors, deep nesting) and avoids biasing the corpus toward content our converter can
represent. **Provisioning method does not affect cross-server fairness** — every server reads the same
page afterward. Reviewers should scrutinize this choice; it makes the corpus *harder* on us, not easier.

At Notion-Version 2025-09-03 the provisioner had to use the data-source model: `POST /v1/databases` with
properties under `initial_data_source.properties` (top-level `properties` are silently dropped), and rows
created with a `data_source_id` parent. (Discovered live; see §5.)

---

## 3. Axis B — page read (ours vs each competitor)

Counted unit = concatenated `result.content[*].text` of every `tools/call` an agent makes to read the
page's full content (ours: `read_page`; makenotion: `retrieve-a-page` + recursive `get-block-children`;
awkoy: `notion_execute get_page_markdown`; better-notion: `pages` action=get). n = 5/class, median (range).
`ours/comp` < 1 means ours is cheaper; "factor" = comp/ours.

### Anthropic primary

| Class | Shape | vs makenotion | vs awkoy | vs better-notion |
|---|---|---|---|---|
| R1 | favorable-rich | **0.068 (14.7×)** | 0.97 (1.0×) | 0.655 (1.5×) |
| R2 | typical-prose | **0.105 (9.5×)** | 1.312 (0.8× — awkoy leaner) | 0.662 (1.5×) |
| R3 | content-light stub | **0.136 (7.4×)** | 2.437 (0.4× — awkoy leaner) | 0.474 (2.1×) |
| R4 | plain-text-heavy | **0.303 (3.3×)** | 1.107 (0.9×) | 0.842 (1.2×) |
| R5 | annotation-pathological ⚠ | 0.056 (17.8×) | 0.555 (1.8×) | 0.651 (1.5×) |
| R6 | code-dominant | **0.358 (2.8×)** | 1.078 (0.9×) | 0.862 (1.2×) |
| R7 | deep-nesting | **0.038 (26.2×)** | 0.623 (1.6×) | 0.679 (1.5×) |
| R8 | media-heavy ⚠ | **0.097 (10.3×)** | 1.035 (1.0×) | 0.586 (1.7×) |

**Per-class aggregate (vs makenotion), stratified by completeness — see §0 for the tier table.**
Lossless tier (R2/R3/R4/R6): geomean **5.04×**, median 5.33×, range 2.8×–9.5×. High-completeness tier
(+R1, ≥0.94): geomean **6.24×**, median 7.36×, range 2.8×–14.7×. Aggregates are over k classes (the
per-class factor is the median of 5 per-fixture ratios). The single pooled-fixture median over n=35 used
in earlier drafts (~9.5×, excl-R5) is superseded: it mixed completeness tiers into one number and was
inconsistent with R7's 0.716 completeness sitting inside the "94–100%" band it implied.

### cl100k cross-check (ours/competitor ratios)
Agrees with Anthropic within ~10% on every cell. cl100k **slightly overstates** the makenotion win
(e.g. R1 0.064 vs 0.068; R2 0.096 vs 0.105) and slightly understates awkoy (R2 1.371 vs 1.312). The
tokenizer choice moves the ratio materially enough that the headline must use the Anthropic number.
Full per-class cl100k values are in `results.json`.

### Ours vs makenotion — per-class, all token bases + structural metrics

Per-class factor = median of the 5 per-fixture ratios (makenotion ÷ ours). `common-IR` = both outputs
normalized to the same intermediate representation before counting; `calls` = tool calls to read the page
(ours always 1). Regenerated by `scripts/bench/lib/recompute-tiers.ts`.

| Class | Shape | content-completeness | as-consumed× (anth) | cl100k× | common-IR× | calls (ours→makenotion) |
|---|---|---|---|---|---|---|
| R1 | favorable-rich | 0.941 | 14.69× | 15.74× | 0.95× | 1 → 4 |
| R2 | typical-prose | 1.000 | 9.49× | 10.40× | 1.32× | 1 → 2 |
| R3 | content-light stub | 1.000 | 7.36× | 8.45× | 1.06× | 1 → 2 |
| R4 | plain-text-heavy | 1.000 | 3.30× | 3.54× | 1.03× | 1 → 2 |
| R5 | annotation-pathological ⚠ | 0.054 | 17.77× | 17.27× | 3.17× | 1 → 2 |
| R6 | code-dominant | 1.000 | 2.79× | 2.82× | 1.01× | 1 → 2 |
| R7 | deep-nesting | 0.717 | 26.22× | 24.74× | 2.05× | 1 → 98 |
| R8 | media-heavy ⚠ | 0.250 | 10.28× | 11.36× | 1.48× | 1 → 2 |

The **common-IR column is the honesty control**: on the clean classes it sits at ~1.0× (R6 1.01, R4 1.03,
R3 1.06, R1 0.95), so the as-consumed win is metadata omission, not denser encoding. The common-IR factor
climbs only where our markdown drops content (R5 3.17×, R8 1.48×) or flattens deep structure (R7 2.05×) —
the same shapes the completeness scores flag. The **call-count column** is a structural metric independent
of tokenization: deep nesting (R7) forces makenotion into ~one `get-block-children` call per parent block
(98 total) where our `read_page` is a single call.

### Reading of Axis B
- **The large win is vs raw-JSON (makenotion), and it is real and consistent** (2.8×–26×). R7 deep-nesting
  is the biggest (26×): raw JSON pays full per-block metadata × 121 blocks; markdown collapses it.
- **vs other markdown converters (awkoy/better-notion) we are NOT consistently leaner.** awkoy is *more*
  compact than us on R2/R3/R4/R6/R8 (ratios > 1) because its `get_page_markdown` uses Notion's native
  server-side renderer and our `read_page` adds a JSON envelope + a safety prefix. This must not be
  hidden: markdown-vs-markdown is roughly a wash and is **not** a headline.
- R3 awkoy has a wide range (0.4×–…); R3 stubs are near-empty so tiny denominators make ratios noisy.

---

## 4. Information-equivalence — completeness (the honesty guardrail)

Three numbers per response (spec §3): as-consumed (above), common-IR (in `results.json`), and
**completeness** vs the raw Notion block JSON superset (makenotion = 1.0 by definition). Content =
text/kind/nesting/lang/checked/url/caption/link/bold/italic + **color-as-content**; full adds universal
metadata (block UUIDs, timestamps, authors). Median content / full:

| Class | ours | makenotion | awkoy | better-notion |
|---|---|---|---|---|
| R1 favorable-rich | **0.941 / 0.193** | 1.0 / 1.0 | 0.706 / 0.145 | 0.941 / 0.193 |
| R5 annotation ⚠ | **0.054 / 0.044** | 1.0 / 1.0 | 0.429 / 0.353 | 0.25 / 0.206 |
| R7 deep-nesting | **0.716 / 0.227** | 1.0 / 1.0 | 0.08 / 0.025 | 0.645 / 0.205 |
| R8 media-heavy ⚠ | **0.25 / 0.077** | 1.0 / 1.0 | 0.25 / 0.077 | 0.25 / 0.077 |

### The R5 finding — stated prominently (do NOT bury)
On **R5 (annotation-pathological)**, ours shows a **17.8× token "win"** vs makenotion — but our
**content-completeness collapses to 0.054**: we drop ~30 per-span colors per page that the raw JSON
preserves (color is *content* on this shape). **The R5 token win is overwhelmingly an information-drop
artifact, not serialization efficiency.** This is exactly why R5 is **excluded from the headline median**
and why the headline is scoped "content-read." A skeptic who reads only the token number on R5 would be
misled; the completeness number is the disclosure that pre-empts them.

### The R8 caveat
**R8 (media-heavy):** ours content-completeness 0.25 — all markdown servers (ours, awkoy, better-notion)
drop the same asset metadata (file URLs/captions/previews); makenotion keeps it (1.0). So the 10.3× R8
win is *also partly* information-drop. R8 stays in the corpus band but carries this caveat; it is not a
clean serialization win like R1–R3.

### Where the win is clean
**R1/R2/R3 (typical content pages):** ours content-completeness ≈ 0.94 — we preserve essentially all the
content an agent reading for content needs, while costing 7–15× fewer tokens than raw JSON. **This is the
defensible, bulletproof headline subset:** a large token win at high completeness. R7 (0.716 content) is
mostly clean too (some deep-nesting structure flattens). The honest full caveat — markdown drops block
UUIDs/timestamps/authors (full-completeness ~0.19) — matters only for read-to-edit, not read-for-content.

---

## 5. Axis E — database read (ours vs each competitor) + version sensitivity

Query a fixed database; counted unit = concatenated `content[*].text`. ours: `query_database`;
makenotion: `retrieve-a-database` (resolve `data_sources[0].id`) → `query-data-source` (2 calls);
awkoy: `notion_execute query_database`; better-notion: `databases` action=query. 0 failures, 3/3
databases archived.

### Anthropic primary — ours/competitor (factor = comp/ours)

| Fixture | vs makenotion | vs awkoy | vs better-notion |
|---|---|---|---|
| D1-wide-005 (5 rows, 11 props) | **0.132 (7.6×)** | 0.686 (1.5×) | 0.535 (1.9×) |
| D1-wide-100 (100 rows) | **0.142 (7.0×)** | 0.753 (1.3×) | 0.610 (1.6×) |
| D2-structured-020 (20 rows, body-light) | **0.130 (7.7×)** | 0.682 (1.5×) | 0.549 (1.8×) |

cl100k agrees within ~10% (e.g. D1-005 makenotion 0.121 vs 0.132 Anthropic).

### Completeness — this is a CLEAN win
**Ours content-completeness = 1.0** on every DB fixture (we return every property name→value the task
uses); **full-completeness ≈ 0.31** (we flatten away the raw wrappers: row UUIDs, property ids,
select-option id+color, timestamps, authors). makenotion = 1.0/1.0 (raw superset). Per spec §3.1,
flattening is **fair** because the same rows and the same property values are returned — verified: ours
`lossy: []`, no property value dropped (no mirror-sin). **So the ~7× DB-query win vs the official server
is a genuine serialization win at full content-completeness**, not an information-drop artifact.

> **Scorer caveat:** awkoy and better-notion show DB completeness 0 — this is a *scorer artifact* (the DB
> completeness comparator does not parse their flattened markdown-table output back into typed rows), NOT
> a real finding that they drop all content. Their token *ratios* are unaffected (those count verbatim
> output). Do not cite their DB completeness; the headline DB comparison (ours vs makenotion) is sound.

### Version sensitivity (MANDATORY for DB, pre-reg §1.3) — the version delta is negligible
makenotion re-driven at its default **2025-09-03** vs forced **2026-03-11** (Anthropic tokens):

| Fixture | 2025-09-03 | 2026-03-11 | Δ | rowSet differs? |
|---|---:|---:|---:|---|
| D1-wide-005 | 5,781 | 5,742 | −0.67% | no |
| D1-wide-100 | 106,195 | 105,586 | −0.57% | no |
| D2-structured-020 | 17,692 | 17,568 | −0.70% | no |

The 2025-09-03 → 2026-03-11 difference on the DB-query path is **~0.6–0.7% of tokens with an identical
row set** (`rowSetDiffers:false`; minor `shapeDiffers:true`). **The ~7× DB win is not a version
confound** — the data-source reshape the methodology flagged does not move the headline. This is the
mandatory E-axis sensitivity result the pre-reg required *shown, not asserted*.

---

## 6. Failures, transients, and known limitations

- **Read axis:** final dataset = 40 pages × 4 servers, **0 failures** (after recovering transient Notion
  fetch blips on R2-01/R4-04 and re-running R7). R7 first failed because our `read_page` exceeded the
  harness's 30s default on a 121-block depth-5 page; at a 120s timeout it succeeds — a harness limit, not
  a product failure, though our recursive read IS notably slow on deep pages (worth a perf note).
- **callCount** is reconstructed as 0 in `--reuse-raw` mode (not stored per call); the makenotion
  multi-call read chain is captured in the live-run raw files (multiple block-children responses per page).
- **Corpus** is a controlled benchmark corpus with adversarial controls — **not** a statistically
  representative sample of real Notion pages. Public wording must say so.
- **Not measured here:** hosted mcp.notion.com (OAuth-only; modeled-estimate only, never a measured
  headline); write axes C/D/F. Surface axis A is in `.meta/research/token-bench-surface-2026-06-13.md`
  (we are competitive, not leanest — no masthead claim).

---

## 7. What the cross-model fairness reviewer should scrutinize

1. **Raw-API provisioning** (§2) — is creating the corpus outside our own converter fair? (We argue yes,
   and it's *harder* on us.) Does it faithfully reproduce realistic Notion pages?
2. **The counted unit** — is concatenated `content[*].text` the right "tokens in context" unit? We exclude
   the JSON-RPC envelope and stderr.
3. **awkoy ratios > 1** — we surface that we're not leanest vs markdown converters; is the framing honest
   enough, or does the makenotion-only headline still over-imply a general win?
4. **R5/R8 completeness** — is reporting content-completeness alongside the token ratio sufficient
   disclosure of the information-drop, or should R8 also be excluded from the headline band like R5?
5. **Completeness scorer** — content matching is by normalized-text (not exact/positional); awkoy's
   HTML-ish `<callout>`/`<table>` dialect scores 0.706 on R1 (lower than ours/better-notion at 0.941) —
   is that a real fidelity gap or a parser artifact penalizing awkoy's dialect?
6. **Tokenizer divergence** — Anthropic vs cl100k differ by up to ~10% and in a consistent direction;
   confirm the headline's Anthropic-primary choice is the conservative one.
7. **DB axis data-source version handling** (§5) and the mandatory 2025-09-03 ↔ 2026-03-11 sensitivity run.

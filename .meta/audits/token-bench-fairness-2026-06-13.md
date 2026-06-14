# Cross-model fairness audit — Phase-2 token benchmark

**Date:** 2026-06-13 · **Role:** red-team PM (adversarial fairness pass) · **Mode:** READ-ONLY (no results/code/commits touched).
**Models:** Claude (Opus 4.8, this PM — independent computation from `results.json` + raw spot-checks) and **Codex** (independent re-computation, session `redteam-token-bench-audit`).
**Codex smoke (sync-dispatch proof, per `.meta/ops/codex-dispatch-contract.md`):**
```
$ mcp-cli run --agent codex --session redteam-token-bench --dir <worktree> "Reply with exactly: CODEX_SMOKE_OK"
CODEX_SMOKE_OK
```
**Artifacts audited:** `.meta/research/token-bench-results-2026-06-13.md`, `.meta/bench/read-axis/results.json` (160 entries = 8 classes × 5 instances × 4 servers) + `raw/`, `.meta/bench/db-axis/` + `raw/`, `.meta/plans/token-benchmark-methodology-2026-06-13.md`, `.meta/bench/preregistration-2026-06-13.md`.
**Both models computed every number below independently and agree to the digit.** That convergence is itself signal.

---

## Bottom line

**Verdict: PUBLISHABLE-WITH-NAMED-CAVEATS.**

The headline win versus the official raw-JSON server (makenotion) is **real, large, and conservatively stated** on the two axes that matter most. The R5 exclusion — the single biggest manipulation-risk the brief flagged — turns out to be the *opposite* of cherry-picking: it **lowers** the reported factor, and it is justified on documented information-drop grounds. The tokenizer choice is the conservative one. Read-equivalence is fair, not a strawman. The DB win is clean.

**One genuine fairness hole, raised by Codex and confirmed:** the headline excludes R5 (completeness 0.054) but **keeps R8** (completeness 0.25) — a second adversarial information-drop class — and keeping it **inflates** the factor from 8.45× to 9.49×. By the methodology's own exclusion rule this is the one place the rule was applied asymmetrically in the flattering direction. This is a wording/scoping fix, not a withhold.

**WITH-R5 vs WITHOUT-R5 (pooled median ours/makenotion, Anthropic, asConsumed):**
- WITHOUT R5 (the headline): **0.1053 → 9.49×**, n=35
- WITH R5: **0.1022 → 9.79×**, n=40 (i.e. R5 makes the win *bigger* — excluding it is conservative)
- WITHOUT R5 **and** R8: **0.1183 → 8.45×**, n=30 (the more defensible "content" headline)
- content-completeness = 1.0 classes only (R2/R3/R4/R6): **0.2197 → 4.55×**, n=20 (the bulletproof floor)

---

## Per-issue verdicts

### 1. The R5 exclusion — JUSTIFIED AND CONSERVATIVE *(raised by both; settled by direct computation)*
The attack hypothesis was "excluding the adversarial class inflates the headline." **It does the reverse.** R5's per-class median ratio is 0.056 (17.8×) — *more* favorable than the corpus median — so dropping it **pulls the headline factor down** from 9.79× to 9.49×. The doc could have quietly kept R5 to claim a bigger number; it didn't.

The exclusion is independently justified on information-drop grounds, not arithmetic: easy-notion's R5 content-completeness median is **0.054** with `color` recorded `lossy` on all 5 instances. Spot-check confirms it: `raw/R5/R5-01--makenotion.txt` carries **27 non-default colored spans** (blue/red/green/brown/gray/orange/pink/purple/yellow × 3); `raw/R5/R5-01--easy-notion.txt` keeps bold/italic markdown markers but **has no color channel at all**. The R5 "win" is overwhelmingly dropped color, exactly as §4 states. The exclusion is stated loudly (§0, §4 "do NOT bury"), not buried. **Verdict: fair. No change needed.**

### 2. Completeness confound — REPORTED, but the headline scoping is inconsistent on R8 *(Codex's sharpest find)*
Content-completeness exists for **every** entry in `results.json` (not just the 4 classes the doc tabulates). Per-class (easy-notion content-completeness / factor):

| Class | content-compl | factor | clean win? |
|---|---|---|---|
| R1 favorable-rich | 0.941 | 14.7× | mostly (minor block-kind) |
| R2 typical-prose | **1.000** | 9.5× | **clean** |
| R3 content-light | **1.000** | 7.4× | **clean** |
| R4 plain-text | **1.000** | 3.3× | **clean** |
| R5 annotation ⚠ | 0.054 | 17.8× | NO — excluded (correct) |
| R6 code-dominant | **1.000** | 2.8× | **clean** |
| R7 deep-nesting | 0.716 | 26.2× | partial (structure flattens) |
| R8 media-heavy ⚠ | **0.250** | 10.3× | **NO — but kept in headline** |

The clean classes (R2/R3/R4/R6, completeness 1.0) carry the defensible story. **The hole:** the methodology (§4.2, line 165) says "*R5 and any class with a low completeness score* is excluded from the headline median unless the headline is explicitly scoped 'content-read only'." R8 at **0.25** is unambiguously "a class with a low completeness score," yet it stays in the headline band where it raises the factor from 8.45× to 9.49×. R8's dropped content (file URLs, captions, asset metadata) is plausibly content a media-reading agent needs — so "content-read" scoping does not fully rescue it the way it rescues block-UUID/timestamp drops. The doc *does* caveat R8 (§4 "R8 caveat") but a single public number that says "full content" while including R8 is too strong. **Verdict: caveat required — either exclude R8 (headline → ~8.5×) or make R8's drop as loud in the headline scope as R5's, and never pair R8's inclusion with the words "full content."**

### 3. Read equivalence — FAIR, not a strawman *(both)*
makenotion's "full read" = `retrieve-a-page` + recursive `get-block-children`, counted as the concatenated `content[*].text` of every call an agent makes. Spot-check R2-01: makenotion is exactly **2 responses** (page object at `raw/R2/R2-01--makenotion.txt:1`, one 7-block child list at `:2`) — same heading/prose/3 bullets as `R2-01--easy-notion.txt`, plus raw per-block metadata. No nested-children over-fetch, no pagination padding. R7-01 (deep nesting): **~97 child-list calls / 121 blocks, 96 with children** — that is the *genuine* recursive cost of reading a depth-5 tree through a raw block API, which is precisely why raw JSON balloons to 26×. The inflation is real API overhead an agent actually pays, not a manufactured baseline. **Verdict: fair.**

### 4. Tokenizer — Anthropic-primary IS the conservative choice *(both, computed)*
Pooled median ours/makenotion, excl R5:
- **Anthropic: 0.1053 (9.49×)**
- cl100k: 0.0962 (10.40×)

cl100k shows the **bigger** win on every cell; leading with Anthropic gives up ~1× of advantage. The doc's claim (§ headline, §0) that Anthropic is the conservative, smaller-advantage tokenizer is verified from the committed dual counts. Minor: the doc says the two agree "within ~10%"; Codex measured a max per-fixture delta of **~13% at R3-02**. Directionally fine; tighten the wording to "within ~13%." **Verdict: fair; one-word wording fix.**

### 5. Scope honesty — CORRECT *(Claude)*
The doc repeatedly and explicitly confines the headline to the **response axis vs the official raw-JSON server**, and states plainly that the win does **not** hold vs other markdown converters (§0, §3: awkoy is *leaner* than ours on R2/R3/R4/R6/R8, ratios > 1; "markdown-vs-markdown is roughly a wash and is **not** a headline"). Surface axis (A) is held out as "competitive, not leanest." Hosted mcp.notion.com is explicitly never a measured headline. **Verdict: honest. This is the doc's strongest section.**

### 6. Sampling — adequate for stability, OVERSTATES diversity *(both, independently)*
n=5/class is **not** 5 independent samples — the 5 instances are near-identical template replicas. Within-class ranges are vanishingly tight (R2: 0.1048–0.1058; R1: 0.0675–0.0696). `diff R2-01 R2-02 easy-notion` shows only the ID, a "1"→"2" index, and a rotation of the same 120-word bank (Codex: sequence similarity 0.70–0.95, multiset Jaccard 0.935–0.951, all 120 words). So "n=5/class, n=35 pooled" measures **run reproducibility, not shape variance** — the real diversity is **8 page-shape templates, not 40 pages**. The reported range is a between-*class* range, which is the meaningful one, so the headline range (2.8×–26×) is sound; but the doc must not let "n=5/class" imply statistical representativeness. It already says "controlled corpus, not representative" (§6, prereg §5) — keep that wording and add that within-class instances are near-replicas. **Verdict: acceptable with the existing "not representative" disclaimer; do not upgrade the language.**

### 7. better-notion re-pin + DB version-sensitivity — LEGITIMATE *(Claude)*
- **Re-pin:** the prereg SHA `7c56493` (v2.34.8-beta.3) requires `@notionhq/client@^5.22.0` (unpublished; npm max 5.21.0 at run time). The re-pin to its parent **`923387f` (v2.33.0)** is the newest installable commit, documented as a pre-reg amendment (§1). better-notion is a *secondary* baseline that never feeds the headline, so the re-pin cannot move the masthead claim regardless. `db-axis/results.json` confirms the live pin: `resolvedSha: 923387f…`, `pkgVersion: 2.33.0`. **Legitimate, disclosed, headline-irrelevant.**
- **DB version sensitivity (mandatory per prereg §4):** makenotion default 2025-09-03 vs forced 2026-03-11 → **−0.57% to −0.70%** tokens, `rowSetDiffers:false` on all three fixtures. The ~7× DB win is not a version confound. **Legitimate; the mandatory run was actually executed and shown, not asserted.**
- **DB win cleanliness:** ours content-completeness **1.0**, `lossy:[]` on all DB fixtures — every property value returned, only raw wrappers flattened. Spot-check `db-axis/raw/D1-wide-005--easy-notion.txt` returns Estimate/Due/Priority/Summary/Link/Status/Contact/Done/Phone/Tags/Name for every row. The ~7× DB win is a genuine serialization win at full content-completeness, unlike the page R5/R8 cases. **Verdict: fair; the DB axis is cleaner than the page-read headline.**

---

## Claude-vs-Codex disagreement

**None on any computed value** — both models independently recomputed the WITH/WITHOUT-R5 medians, the tokenizer comparison, and the per-class completeness/factors and matched to the digit (excl-R5 0.10533/9.49×; incl-R5 0.10218/9.79×; cl100k 10.40×). Codex contributed the two sharpest *additional* points (the R8/R5 asymmetry in §2, and the 13% tokenizer delta in §4); Claude contributed the scope-honesty (§5) and DB/re-pin (§7) confirmations. The independence held — neither just ratified the other — and the conclusions converged.

---

## The single defensible headline + scope to put in the README

Lead with the **range scoped to the official server and to content-completeness**, not a bare factor. Recommended wording:

> **Reading a page's content costs roughly 3×–26× fewer response tokens than the official Notion MCP server** (makenotion, which returns raw block JSON) — median **~8.5×** across six controlled page-shape classes, at 94–100% content-completeness. Measured with Claude's tokenizer (the conservative choice); range is 2.8× on code-dominant pages to 26× on deep-nested outlines. This is a comparison **against the raw-JSON official server only** — not against other markdown converters, where we are roughly at parity. Two adversarial classes where our markdown drops color (R5) or asset metadata (R8) are reported separately, not in this number. Controlled benchmark corpus (8 shape templates), not a representative sample of real Notion pages.

If James prefers to keep the **9.5× / excl-R5-only** number, it is defensible **only** if (a) the headline word is "content-read," not "full content," and (b) R8's 0.25 completeness is stated in the same breath as the number, not in a downstream footnote. The cleaner choice is the ~8.5× (excl R5+R8) figure with the range.

**Sessions:** red-team PM (this) · Codex `redteam-token-bench` (smoke), `redteam-token-bench-audit` (fairness pass).

---

## Summary (≤20 lines)

- **Verdict: PUBLISHABLE-WITH-NAMED-CAVEATS.** The makenotion (raw-JSON) win is real, large, and conservatively stated. One real fairness hole: R5/R8 exclusion asymmetry.
- **WITH-R5 median: 0.1022 (9.79×, n=40). WITHOUT-R5 (headline): 0.1053 (9.49×, n=35).** Excluding R5 *deflates* the factor — the exclusion is conservative, not cherry-picking, and is justified by R5 content-completeness 0.054 (drops 27 colored spans/page, verified in raw).
- **The hole (Codex):** R8 (completeness 0.25, an info-drop class like R5) is kept in the headline, where it *inflates* the factor. Excl R5+R8 → **0.1183 (8.45×)**. By the method's own rule R8 should be excluded too, or the number must never be called "full content."
- **Tokenizer:** Anthropic-primary is the conservative choice (9.49× vs cl100k 10.40×) — verified. (Doc says agreement "~10%"; actual max delta 13% at R3-02 — minor wording fix.)
- **Read-equivalence:** fair — makenotion full read is genuine page + recursive block fetch (R7: 121 blocks / 96 recursions), not an over-fetch strawman.
- **Sampling:** n=5/class is near-identical replicas → ~8 shape templates, not 40 samples; measures stability not diversity. The existing "not representative" disclaimer covers it; the between-class range (2.8×–26×) is sound.
- **DB axis:** cleaner than the page headline — content-completeness 1.0, `lossy:[]`, version delta −0.6%. better-notion re-pin is legitimate and headline-irrelevant.
- **Recommended README headline:** a 3×–26× *range*, median ~8.5×, scoped "vs the official raw-JSON server" + content-completeness + "not vs markdown converters" + "controlled corpus, not representative."
- **Claude vs Codex:** no disagreement on any number (matched to the digit); Codex added the R8-asymmetry and 13% tokenizer points. Convergent independent computation.

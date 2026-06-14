# Token-cost benchmark methodology spec

**Date:** 2026-06-13 · **Author:** planner PM · **Status:** Codex-reviewed (corrections folded in — see end); pending James's §1–§7 decisions before execution.
**Type:** methodology spec only. No measurements were run, no public files changed.

> **POST-EXECUTION RECONCILIATION (2026-06-14).** This spec was written pre-execution. The run has
> since completed; the canonical results are `.meta/research/token-bench-results-2026-06-13.md`. Two
> framings below are superseded by that doc and should be read through it: (1) the pilot's pooled
> "median ~12x (≈92%)" headline (§0.3) is replaced by a **completeness-stratified, per-class** figure
> (geomean ~6.24× / median ~7.36× on the high-completeness tier ≥0.94; lossless tier ~5.04×); and
> (2) the §3 "normalized win must be material" gate is satisfied as a **metadata-omission** saving,
> NOT as a normalized-serialization win — at equal information the formats are at rough parity
> (common-IR ~1.0–1.06× on the lossless classes, R2 1.32×). The big as-consumed win is the per-block
> metadata raw JSON carries, not denser encoding. The methodology and bias controls below stand as
> written; only these two interpretive framings are updated.
**Supersedes-intent:** when executed, the resulting artifact replaces both `.meta/research/token-cost-comparison-2026-06-13.md` (the pilot) and the stale `docs/token-benchmark-results.md` as the single canonical source.

**Purpose.** Spec a token-cost measurement that survives a skeptical competitor reading our open-source repo: fair, version-matched, reproducible from committed artifacts, and complete across the axes that matter. The output of a future execution run must be a defensible number that can become part of the permanent public record (this is open source; claims get cited back).

---

## 0. What the pilot already tells us (do not relitigate)

These are settled inputs. The execution run inherits them; the methodology below only *hardens and extends* them.

1. **There are two distinct axes and they must never be merged into one headline.** Tool-surface (cost of loading tool definitions) and response (cost of a tool result). They move in opposite directions for us.
2. **Surface axis: we are not the leanest.** Ours ≈ 6,612 tokens (42 tools, minified) vs makenotion 15,469 (2.3x smaller than the official self-hosted server) but *larger* than the deliberately-consolidated awkoy (502, dispatcher-hidden) and better-notion (3,127). There is no "92%" story on this axis, and awkoy's 502 is not real leanness — it defers per-op schema cost to call time. **The honest surface verdict is "competitive, not leanest."**
3. **Response axis vs makenotion: a real, large gap exists** — median ~12x (≈92%) across 3 page shapes, range 87–94%. The cross-model fairness pass returned *fair-with-caveats*: the numbers are sound, the risk is in presentation/scope.
4. **The current README masthead ("92% fewer tokens vs official Notion MCP", README.md:8) is the same unqualified overclaim that was falsified once.** It blends axes and baselines and uses a bare "92%". It must be re-scoped to the response axis as a range, or dropped.
5. **The pilot's own flagged limitations (the work this spec exists to close):** n=3 and all 3 shapes favor markdown; no adversarial controls; only 2 of N axes measured; only makenotion on the response axis; cl100k_base ≠ Claude's tokenizer; a Notion-API-version mismatch; and **no committed fixtures** (the `/tmp` artifacts were deleted, so the response claim is currently unreproducible from the repo).

The methodology's job is items in #5, not re-deriving #1–#4.

---

## 1. Servers, versions, and the comparability problem

### 1.1 Pinned identifiers (captured read-only 2026-06-13 from fresh shallow clones)

| Server | Pin (use the SHA as authoritative) | pkg version | Tools | Nature | Notion-Version it actually sends |
|---|---|---|---|---|---|
| **easy-notion-mcp (ours)** | repo `dev`, build `dist/` from the tagged commit under test | 0.9.3 | 42 | **markdown converter** (blocks↔markdown) | **2026-03-11** (`src/notion-version.ts`) |
| **makenotion/notion-mcp-server** | `e79f35fd64cc5db726fbba1beebaa84c80760c17` (2026-05-27) | 2.3.1 | 22 | **thin OpenAPI proxy** — returns raw Notion REST JSON, zero transformation (no markdown in `src/`) | **2025-09-03** (proxy data path: `proxy.ts:226` + OpenAPI default `notion-openapi.json:30`) |
| **awkoy/notion-mcp-server** | `f5f1bdaf2456093a583722dab8422cf7b972636c` (2026-06-05) | 2.5.1 (runtime banner mismatches at v1.4.0) | 2 | **markdown converter + dispatcher** (`src/markdown/parse.ts`, remark-gfm); 37 ops behind a `notion_execute` dispatcher with lazy schemas | **2025-09-03** (`src/services/notion.ts:12`) |
| **better-notion-mcp (@n24q02m)** | `7c56493eb60af7d8c2e9d0306b649e96ddcabcc7` (2026-06-12) | 2.34.8-beta.3 (npm `latest` is 2.34.7; cloned tip is a beta ahead) | 11 | **markdown "mega/composite" tools** (`src/tools/composite/*`, `helpers/markdown.ts`) | **2025-09-03** (`src/main.ts:116`) |

**Correction to the pilot (important):** the pilot measured makenotion's response axis via hand-rolled `curl` at **Notion-Version 2022-06-28**. At the pinned SHA, makenotion's *data path* defaults to **2025-09-03**; the only place 2022-06-28 appears is the `/users/me` integration-link helper (`start-server.ts:213`), which is not on the read path. So the pilot's makenotion baseline was mis-versioned. The execution run must drive makenotion at its real default (2025-09-03) — or at a matched version — not 2022-06-28.

### 1.2 The "what is a fair comparison" classification

A fair comparison means different things depending on what the other server *is*:

- **vs makenotion (thin raw-JSON proxy):** this is the markdown-vs-raw-block-JSON comparison. It is where the large, real, defensible win lives. The official npm server is the baseline most developers actually use. **This is the primary baseline.**
- **vs awkoy / better-notion (other markdown converters):** this is markdown-vs-markdown. Gaps here are small and are about serialization (compact vs pretty JSON), wrapper overhead, and **content completeness** (do they silently drop block types? the stale doc claims better-notion drops ~10 block types — re-verify at the pinned SHA, do not assume the 2026-03 finding still holds). A "we're more efficient" claim here is weak and must be normalized for dropped content or it is dishonest. **Secondary baselines; strengthen the story but cannot carry a headline.**
- **vs hosted mcp.notion.com (Enhanced-Markdown, OAuth-only):** cannot be run locally. Any number is a modeled lower bound (the existing `workflow-token-compare.ts` hand-rolls an Enhanced-Markdown converter). **Report as an explicit estimate with its assumptions, never as a measured headline.** The roadmap already forbids resurrecting the token-cost-vs-hosted framing (falsified 2026-05-01).

### 1.3 Version-matching policy — **Decision §1 (James)**

The cleanest fairness posture: **run each server at its shipped default Notion-Version, document each explicitly, and add a sensitivity run** that forces makenotion to 2026-03-11 (or forces ours, if feasible, to 2025-09-03) to show the residual version effect. Rationale: forcing every server to one version misrepresents what a user actually gets from each install; documenting + a sensitivity check is both honest and bounded. For block-content reads the 2025-09-03 → 2026-03-11 delta is minor (the big 2025-09-03 change was databases→data-sources, which lands on the DB axis, not the page-read axis), so the residual is expected to be small there — but it must be *shown*, not asserted.

**Asymmetric rigor by axis (Codex correction).** The default-version-plus-sensitivity posture is sufficient for the **page-read axis** (B), where the version delta is genuinely off-path. It is **not** sufficient for the **database axes** (E/F): the 2025-09-03 databases→data-sources reshape directly changes DB request/response shapes, so a version mismatch there is a confound, not a footnote. For E/F the sensitivity run is **mandatory, not optional**, and the artifact must either force a common version across servers for the DB axis or report both versions side-by-side with the delta called out explicitly.

---

## 2. Axes — definition, operation, and what each can/cannot claim

Each axis is measured as a **real MCP tool call** (see §5: drive every server as a JSON-RPC client; capture verbatim `tools/call` results). Do **not** hand-roll the competitor's output with our own converter — modeling the competitor instead of running it is the single biggest fairness vulnerability and the first thing a skeptic attacks.

### 2.0 Canonical counting unit and four-column accounting (close the "what exactly is counted" hole)

A ratio is gameable until the counted unit is pinned. **The canonical unit is the concatenation of the `result.content[*].text` payload(s) of every `tools/call` an agent must make to complete the axis task, minified, with a single `\n` separator between multi-call results.** Rationale: `result.content[*].text` is exactly what lands in the agent's context window; the JSON-RPC envelope (`jsonrpc`/`id`/method framing) and any server stderr/log lines do *not* enter context and are excluded. Tool-call *arguments* are counted separately as the request column, never folded into the response number. Errors that abort a task void that instance (re-run); they are not counted as "cheap responses."

**Every response axis reports four columns, never one blended total**, so call-count efficiency and serialization efficiency are never conflated (a skeptic must not be able to say "you penalized a thin proxy for lacking a composite read tool" without the data to separate it):

| Column | Definition |
|---|---|
| **request tokens** | sum of `tools/call` argument payloads across the task's call chain |
| **response tokens** | sum of `result.content[*].text` across the chain (the canonical unit above) |
| **call count** | number of `tools/call` round-trips the task required |
| **total workflow tokens** | request + response across the chain |

The headline page-read claim is a **response-tokens** statement at **equal call-count where possible**; where call-count differs (our single `read_page` vs makenotion's `retrieve-a-page` + recursive `get-block-children`), report both the per-call response delta *and* the full-workflow total, and state which the claim uses. The full-page-read workflow total is the honest agent-cost number; the per-call figure isolates serialization.

| # | Axis | Representative operation | What a win here CAN claim | What it CANNOT claim |
|---|---|---|---|---|
| A | **Tool-surface** | `tools/list`, minified `result.tools` | "loading our tool set costs N tokens vs M" | nothing about per-call efficiency; ours is *larger* than consolidated competitors |
| B | **Page read** | read one page's full content (ours: `read_page`; makenotion: `retrieve-a-page` + recursive `get-block-children`; others: their read tool) | "reading a typical page returns ~X% fewer response tokens than the official server's raw block JSON" — **the headline axis** | not "representative" until corpus ≥ §4 sizing; not vs hosted; not a blanket server property |
| C | **Page create/write** | create a page from a fixed markdown/content spec (ours: `create_page`; makenotion: `post-page` + `patch-block-children`; others: their create tool) | request-side: "fewer input tokens to author the same page" | response-side is small/noisy; create is a request-axis story, not a response-axis one |
| D | **Page edit** | a surgical edit: replace one section / find-replace / update one block (ours: `update_section`/`find_replace`/`update_block`; makenotion: fetch-all + patch; others: composite edit) | "a scoped edit costs fewer total tokens because we don't refetch+rewrite the whole page" — a *workflow* (multi-call) claim | a single-call response comparison; this axis is inherently about call-chain shape |
| E | **Database read/query** | query N rows of a fixed DB (ours: `query_database`; makenotion: `query-data-source`; others: their query tool) | "querying a DB returns ~X% fewer tokens because property values are flattened" — likely a strong second headline | only valid if both sides return the same rows/properties (see §3 normalization) |
| F | **Database write / entry-add** | add M rows from a fixed spec (ours: `add_database_entries`; makenotion: per-row `post-page`; others: composite) | request-side authoring cost; and call-count (we batch, proxy may not) | response-side is small; beware modeling batch behavior we didn't observe |
| G | **Listing** | `list_pages` / `list_databases` | response-shape efficiency on enumeration | low-traffic; minor |
| H | **Search** | `search` for a fixed query against a fixed corpus | response-shape efficiency on search results | results must be the same items across servers or it's not comparable |

**Axis gating (which axes may feed the public claim) — Decision §4.** Recommended tiering:
- **Must-have for a 1.0-grade headline:** Axis B (page read) — the only axis with a large, real, defensible gap vs the baseline most users run.
- **Strong supporting, report in artifact, eligible for a secondary line:** Axis E (DB read/query).
- **Report honestly but never in the masthead:** Axis A (surface — we are *not* leanest; this must be stated, not hidden).
- **Nice-to-have / workflow-level color:** C, D, F, G, H — measure if cheap, but they are call-chain stories better told as worked examples than as a headline percentage.

---

## 3. Comparable operations & the content-equivalent vs information-equivalent problem (the #1 fairness risk)

Heterogeneous servers return different *information*, not just different *formatting*. Counting raw bytes an agent consumes is the right "what does it cost in context" measure, but it silently bundles two effects: (a) **serialization efficiency** (compact markdown vs verbose JSON of the *same* information) and (b) **information drop** (we collapse block UUIDs, created/edited timestamps, created_by/last_edited_by, parent pointers, archived/in_trash flags, per-span annotation objects). A skeptic's strongest attack is "your win is mostly (b) — you're cheaper because you return less, and an agent sometimes needs what you dropped."

**Resolution: report three numbers per response axis, every time** (sharpened from two on Codex review — inferring the information-drop effect from a raw-vs-normalized *divergence* is weaker than measuring it directly):

1. **As-consumed:** the verbatim canonical-unit tokens (§2.0) an agent ingests to complete the task, counted as-is. The honest "tokens in your context" number; the one the headline uses — *because the markdown genuinely is what the agent consumes.*
2. **Common-IR cost:** project *both* servers' outputs into the same canonical intermediate representation (the schema below) and count that. This isolates pure serialization efficiency on identical information.
3. **Completeness score:** fields/block-attributes each server's output preserves relative to the Notion raw block JSON (the information superset), as a fraction. Markdown that drops color/UUIDs scores < 1.0; raw JSON scores 1.0 by definition. This makes the information-drop *explicit and quantified* instead of inferred.

The "we drop information" effect is now (2)-vs-(1) read against (3): a large as-consumed win with a high completeness score is bulletproof; a large win with a low completeness score is partly an information-drop artifact and must be stated as content-read-only.

### 3.1 The normalized IR schema (must be implementable, not argued case-by-case)

"Page title + ordered block content" is not a schema. Define an explicit canonical IR with exact retained fields per block type, committed as part of the harness. The IR is the **lowest common denominator a content-reading agent needs**; everything outside it is what completeness (3) scores. Draft IR (finalize in pre-registration):

| Block type | Retained in IR | Scored-as-dropped if absent (counts against completeness) |
|---|---|---|
| paragraph / heading_1–3 | text, heading level | — |
| rich-text spans | text, bold, italic, strikethrough, code, link URL | **color**, underline, mention refs, per-span IDs |
| bulleted/numbered list | text, nesting depth | — |
| to_do | text, checked state, nesting depth | — |
| code | text, language | caption |
| quote / callout | text; callout icon | callout color |
| table | cell text, row/col headers flags | column widths, cell color |
| toggle | summary text, children | — |
| equation | expression | — |
| divider / toc | marker presence | — |
| bookmark / embed / image / file / video | URL | caption, file metadata, expiry |
| (all blocks) | — | block UUID, created/edited time, created_by/edited_by, parent, archived/in_trash |

Both servers' outputs are parsed into this IR, the IR is serialized identically (one canonical compact form), and *that* is counted for (2). A reader can audit every retain/drop decision against this table — there is no room for "you normalized in your favor."

**Per-axis floor + fairness call (be concrete):**

| Axis | Information floor (what the task needs) | Is dropping the extra fair? |
|---|---|---|
| B page-read-for-content | page title + ordered block content + structural nesting | **Fair.** An agent reading for content does not need block UUIDs/timestamps/per-span annotation objects. Counting them against the raw-JSON server is legitimate. |
| B page-read-**to-edit** | the above **+ block IDs** | **Not automatically fair.** Raw-JSON servers hand the agent block IDs it could use for surgical edits; our markdown drops them. We round-trip via server-side re-derivation (`update_block`/`update_section`), so the *capability* is preserved — but state explicitly that on the read-to-edit path the raw server returns addressable handles we don't, and our edit tools compensate server-side. Do not claim a read-to-edit token win without this note. |
| E DB query | row identity + the property *values* the task uses | **Fair to flatten** `{"Category":"A"}` vs the raw `{id,type,select:{id,name,color}}` wrapper — *provided* we return the same rows and the same properties. **Unfair if** we silently drop property types the other server returns (the stale doc accuses better-notion of dropping status/date; we must not commit the mirror sin). Normalize to the same property set. |
| C/F writes | the input needed to produce the same created object | Request-side comparison is fair if both author the *same resulting page/rows*. Verify by reading back and diffing the created content, not by trusting the request. |
| H search | enough to identify+navigate to each hit (id, title, url) | Fair to return minimal fields **if** both sides return the same hit set; pin the query + corpus so hit sets match. |

**Rule:** any axis where the raw win and the normalized win diverge by more than a small margin must report both numbers in the artifact, and the README may only cite an axis whose *normalized* win is still material (so the public number is a serialization win we can defend, not an information-drop artifact). **[Reconciled 2026-06-14 — see the banner at the top: in execution the headline win is a defensible *metadata-omission* saving at high completeness (common-IR ~1.0–1.06× on lossless classes, R2 1.32×), not a normalized-serialization win. The "normalized win must be material" gate is therefore reframed: an axis qualifies when its as-consumed win holds at a stated completeness threshold AND the common-IR ratio confirms the saving is metadata omission rather than information drop. Axis B page-read and Axis E DB-query both clear this; see the results doc.]**

---

## 4. Corpus — representative shapes + deliberate adversarial controls

The pilot's fatal scoping weakness: n=3, all three favoring markdown. The fix needs (a) breadth of shape and (b) shapes that are *hostile* to markdown, sampled by rule rather than hand-picked.

**Honesty on the word "representative" (Codex correction).** n≥5/class over 8 classes is a **controlled benchmark corpus with adversarial controls** — it is *not* a statistically representative sample of the population of real Notion pages (that would need sampling actual workspaces, which we can't and shouldn't do). The public artifact must say "controlled corpus spanning favorable to adversarial shapes," never "representative of Notion pages." This wording discipline is itself a defense: claiming representativeness we didn't earn is the exact failure that got us here.

### 4.1 Generation discipline (anti-cherry-pick)
- Corpus is **generated by a committed rule / fixture script**, not hand-selected. Either procedurally generated to fixed specs, or sourced from a fixed, citable public corpus (e.g. a snapshot of a public Notion template) so the selection is auditable.
- Each shape *class* gets **n ≥ 5 distinct instances**; report **median + full range**, never a single number. The corpus must span ≥ 8 classes across the favorable→hostile spectrum (§4.2).
- Fixtures committed verbatim so any reader regenerates identical inputs.

### 4.2 Shape classes for the page-read axis (Axis B)

| Class | Shape | Expected direction | Why it's in the corpus |
|---|---|---|---|
| **R1 favorable-rich** | headings, prose, nested lists, code, callouts, tables (the pilot's medium/large shapes) | large markdown win | the realistic "typical doc"; max raw-JSON per-block metadata overhead |
| **R2 typical-prose** | H1 + several paragraphs + one list (the pilot's small-prose) | moderate win | the common lightweight page |
| **R3 adversarial content-light/metadata-heavy** | a page that is mostly empty / a stub with little body | win shrinks | tests the floor: little content means metadata dominates differently |
| **R4 adversarial plain-text-heavy** | one or few very large *unannotated* plain paragraphs (a pasted essay) | **win shrinks toward ~1–2x** | the canonical anti-markdown shape: minimal per-block metadata, markdown ≈ raw text |
| **R5 adversarial annotation-pathological** | rich text where nearly every span carries distinct annotations/colors | **two-sided**: raw JSON annotation objects balloon (helps us) *but* we **drop color information** (we can't represent it) | exposes the information-drop honestly; report normalized number here especially |
| **R6 adversarial code-dominant** | a page that is mostly one large code block | win shrinks | code survives ~verbatim on both sides; isolates non-metadata content |
| **R7 deep-nesting / many-small-blocks** | an outline or task doc: hundreds of short blocks nested 3–5 deep (toggles in toggles, nested lists) | **two-sided** — raw JSON pays full per-block metadata × many blocks (helps us), but markdown indentation + structural markers also grow | the common Notion outline shape the pilot missed entirely; stresses recursion, pagination, and structural-marker overhead |
| **R8 media/embed/file-heavy** | a page dominated by images, embeds, files, link previews, bookmarks | **win may invert or shrink** — markdown simplifies/drops external-asset metadata (file URLs expire, captions, previews) | exposes where our simplification *loses* asset metadata an agent might need; pairs with the completeness score |

Report Axis B as: **median + range across R1–R8**, plus a clearly-labeled "favorable subset (R1–R2)" and "full corpus incl. adversarial" band so the honest sensitivity range is visible. The headline cites the **full-corpus** figure; if R4/R6 pull the low end down to ~2x, the claim becomes "ranges from ~2x on plain-text pages to ~15x on rich pages; median ~Nx" — which is *more* credible, not less.

**R5 (and any class with a low completeness score) is excluded from the headline median** unless the headline is explicitly scoped "content-read only." R5 deliberately balloons the raw-JSON side while we silently drop color — including it in a blended median would *flatter* us via an information-drop we don't disclose in the headline. Report R5 with its completeness score in the artifact body; keep it out of the lead number.

### 4.3 Database corpus (Axis E/F)
- **D1** wide DB: 10–15 properties of mixed types (title, select, status, multi-select, date, number, checkbox, people, relation, formula), ~5 and ~100 rows (test scale effect).
- **D2 adversarial structured-data-heavy:** rows that are almost all typed properties with near-zero page body — the shape where raw property metadata is the whole payload (still likely favors us, but is the honest stress shape).
- **People-column caveat (from project memory):** live e2e writes to people-type columns notify the real user on every run. Either exclude people columns from write-axis fixtures, or accept the notifications knowingly — flag to James before the write run.

---

## 5. Tokenizer — **Decision §2 (James)**

**Recommendation: lead with Anthropic's actual token-counting API; keep cl100k_base as a committed secondary cross-check.**

- The claim is explicitly "tokens in a Claude context." cl100k_base is GPT-4's encoding and is only *approximate* for Claude — which is why the pilot had to attach a permanent "≠ Claude's real tokenizer" disclaimer to every number. Using Anthropic's token-counting endpoint (the `count_tokens` API / messages token-counting) **removes that disclaimer** and makes the number mean what the claim says.
- Tokenizer choice is not cosmetic on this content: JSON with heavy punctuation, UUIDs, and repeated keys can tokenize differently across encoders; the divergence is usually <10% but can be larger exactly on the verbose-JSON side, which is the side we're comparing against — so the encoder choice can move the ratio.
- **Reproducibility trade-off (state it):** the Anthropic numbers require an API key and send fixture content to Anthropic (acceptable — fixtures are synthetic, no secrets, no real workspace data). A reader *without* a key can still reproduce the committed cl100k_base numbers. So commit **both**: lead with Anthropic, report cl100k as the keyless-reproducible cross-check, and show they agree within X%.
- **Pin the Anthropic count exactly (Codex correction — "Anthropic primary" alone is not reproducible).** The pre-reg must fix: (a) the exact model id whose tokenizer is used (e.g. `claude-opus-4-8`); (b) the count endpoint and its API version header (`anthropic-version`); (c) the exact request shape — specifically whether the counted text is wrapped in a `messages` array (it is: the count API counts a message payload, which adds a small fixed wrapper cost that must be applied identically to both servers and disclosed) or counted bare; (d) **commit the raw API count responses** alongside the cl100k counts, because model-specific tokenizers can change or a model can be retired — a committed response is the only durable record. Apply the identical wrapper/request shape to every server and every fixture so the ratio is wrapper-invariant.

---

## 6. Reproducibility — what gets committed

A skeptical competitor must be able to clone the repo and reproduce every number. The pilot failed exactly here (artifacts deleted).

**Two distinct reproducibility guarantees (Codex correction — do not conflate them).** Live Notion re-runs will *not* reproduce byte-identical raw JSON: Notion injects page/block/user IDs, timestamps, URLs, and pagination cursors that change per page and over time. So the spec promises two separable things:
1. **Exact replay (byte-for-byte):** anyone re-running the committed *tokenizer* over the committed *raw outputs* gets the published numbers exactly. This is the load-bearing guarantee and must hold to the token.
2. **Live re-run (within tolerance):** anyone re-creating the corpus in their own sandbox and re-driving the servers gets numbers within a stated tolerance band (IDs/timestamps shift a few tokens per block). State the tolerance; do not claim live re-runs are byte-exact.

Commit, under a versioned bench directory (extend the existing `.meta/bench/` convention):

1. **Harness script** (extend `scripts/bench/token-compare.ts`, don't replace it): the same JSON-RPC stdio client, generalized from `tools/list` to also `tools/call` each server with the per-axis operations. One script, all servers, both axes.
2. **Server pins:** the four SHAs from §1.1, plus the exact install commands (`npm ci --ignore-scripts` from clean clones outside our repo; supply-chain notes per server).
3. **Notion-Version headers** actually sent by each server (from §1.1), and the version-matching/sensitivity config used (§1.3).
4. **Corpus fixtures:** the generator script + the generated page/DB fixtures verbatim, plus the page IDs used in the sandbox workspace.
5. **Raw outputs:** every verbatim `tools/call` result string from every server (not summaries) — the actual bytes counted.
6. **Tokenizer:** both the cl100k script and the Anthropic-API counting script; the model/endpoint version used for the Anthropic counts.
7. **The numbers:** raw + information-normalized, per axis, per shape, with median+range; plus the computed ratios.
8. **The pre-registration doc** (§7) committed *before* the measurement commit, so the git history shows method preceded results.

Then: supersede `docs/token-benchmark-results.md` (point it at the new artifact) so there is exactly one canonical, current source — the conflicting 95.5%/291-vs-6,536 numbers must stop existing as a live claim.

---

## 7. Bias controls

1. **Pre-registration.** Before any measurement: commit a short pre-reg stating the corpus generation rules, the exact operations per axis, the tokenizer, the version policy, **and a predicted direction per shape class** (e.g. "R4 plain-text expected to shrink the win to ~2x"). Measuring against a prediction you wrote down first is the cheapest defense against motivated analysis.
2. **Rule-generated corpus** (§4.1) — no hand-picking instances that flatter us.
3. **Cross-model red-team of the methodology before execution.** Per the project's established pattern (roadmap red-team was Claude+Codex converged): have at least two independent models attack *this spec* — corpus balance, the normalization definition, the version policy, the axis-gating — before a single number is produced. The pilot's fairness pass was *post-hoc* on results; this one is *pre-hoc* on method, which is stronger.
4. **Report ranges, not point estimates**, on every response axis; lead the public claim with the full-corpus (adversarial-included) band.
5. **Both tokenizers committed** so no one can claim encoder-shopping.
6. **Run the competitors, don't model them** (§2/§5): the one place the pilot modeled (hand-rolled curl recursion + hand-rolled Enhanced-Markdown) is the one place a skeptic says "you faked our output." Drive real servers for everything runnable; clearly label the one un-runnable surface (hosted) as an estimate.

---

## 8. Execution plan (sequenced; for the future run — not executed here)

**Phase 0 — lock method.** Finalize this spec with James's §1–§5 decisions → write + commit the pre-registration (§7.1) → cross-model red-team the spec (§7.3) → fold corrections. *Gate: no measurement until the pre-reg is committed.*

**Phase 1 — harness.** Extend `scripts/bench/token-compare.ts` to drive `tools/call` for all four servers over stdio (it already does `initialize`→`tools/list` with a dummy token). Add the per-axis operation table from §2. Add the Anthropic-API token counter alongside the existing cl100k counter.

**Phase 2 — surface axis (cheap, no Notion needed).** Re-capture Axis A with a dummy token (the pilot's method already works); confirms/refreshes the 6,612-vs-15,469 figures at the pinned SHAs. *No sandbox required.*

**Phase 3 — sandbox provisioning.** A **scoped throwaway Notion integration** on a dedicated test workspace/page tree (the established safe pattern). Generate the §4 corpus into it via the fixture script. Never touch real user pages; avoid people-columns unless James opts in (notification caveat). Do not touch ports 3333/8081.

**Phase 4 — response axes, in priority order.** B (page read, full R1–R6 corpus) first — it gates the headline. Then E (DB read/query). Then, if cheap, C/D/F/G/H as workflow color. For each: capture verbatim `tools/call` outputs from every runnable server at the agreed version(s); compute raw + normalized; both tokenizers.

**Phase 5 — synthesize + publish.** Compute medians+ranges; write the canonical artifact; supersede `docs/token-benchmark-results.md`; propose the re-scoped README masthead (response-axis, range, "vs official server" baseline, tokenizer note). **Claim gate:** the masthead may cite only an axis whose full-corpus *normalized* win is still material — i.e. Axis B, as a range with scope, never a bare "92%".

**What gates a publishable claim:** Axis B measured across R1–R8 with n≥5/class (R5 excluded from the headline median per §4.2), both tokenizers agreeing within tolerance, common-IR win still material and completeness scores reported, all fixtures+outputs committed, pre-reg in history. Anything short of that ships as "preliminary," not as the masthead.

### 8.1 Execution-environment checklist (Codex correction — these were undercalled)

Pin and record in the pre-reg, because each is a silent confound or a reproducibility gap:
- **Toolchain versions:** Node (and Bun, if any competitor needs it), package-manager version, and each server's lockfile state — record exact versions; a different Node can change JSON serialization edge cases.
- **Per-server env:** the exact env vars each server needs (`NOTION_TOKEN` vs `OPENAPI_MCP_HEADERS` vs `INTERNAL_INTEGRATION_TOKEN`), captured in the harness, not passed ad hoc.
- **Timeout/retry policy:** a fixed timeout and a fixed no-retry-or-N-retry rule, identical across servers; a retried call must not double-count tokens.
- **Notion rate-limit handling:** Notion throttles (~3 req/s); the harness must back off deterministically and the back-off must not alter counted payloads.
- **Pagination + page-size policy:** fixed `page_size` (100, the max) and a fixed pagination-order assumption; record whether any server returns blocks in a non-deterministic order (would break byte-replay).
- **Capture hygiene:** exclude stderr/log lines from the counted unit (they never enter agent context); capture them separately for debugging.
- **Per-server call-shape preflight (do this before measuring):** dry-call each axis operation on each server and record the *actual* tool name, argument shape, and return shape. awkoy's `notion_execute` dispatcher and better-notion's composite "mega tools" may take different arguments or return summaries/partial content rather than the axis table's assumed shape — discovering that mid-run invalidates the batch. The §2 axis table is a hypothesis until preflight confirms it.
- **Sandbox cleanup:** archive/delete the corpus pages after the run, or keep a dedicated disposable workspace; record which.

---

## Runtime premises this plan rests on

Every nontrivial external-behavior assumption, with how to verify it in the run (per planner.md):

1. **`tools/list` needs no valid token on all four servers** (dummy token suffices). *Verified by the pilot for surface capture; the harness already does this. Re-confirm on first run — a server that validates the token at list time fails loudly.*
2. **makenotion's data path sends Notion-Version 2025-09-03 at the pinned SHA.** *Verified by code read (`proxy.ts:226`, `notion-openapi.json:30`) 2026-06-13. The run must confirm by capturing the actual outbound header (or by observing 2025-09-03 response shapes), not trust the read.*
3. **The 2025-09-03 → 2026-03-11 version delta is small on the page-read axis.** *Asserted, not measured. The §1.3 sensitivity run (makenotion forced to 2026-03-11, or ours probed at 2025-09-03) is the test that fails if this premise is false.*
4. **Each runnable server can complete each axis operation against the sandbox** (i.e. our axis mapping in §2 is correct for their actual tool surface). *Must be verified per server during Phase 1 by a dry call; awkoy's dispatcher and better-notion's composite tools especially need their real call shapes confirmed, not assumed.*
5. **Anthropic's token-counting API and cl100k_base agree within a stated tolerance on this content.** *Tested directly in Phase 1 on a sample fixture; if they diverge widely, that itself is a finding and the headline must use the Anthropic number.*
6. **better-notion still drops block/property types** (the stale doc's 2026-03 accusation). *Must be re-verified at the pinned SHA by reading back created content and diffing — do not inherit the old claim; it may be fixed.*
7. **A scoped throwaway integration can create/read the full corpus** without hitting Notion rate limits or workspace restrictions. *Probe in Phase 3 with one fixture before generating all of them.*

No premise here is load-bearing for the *headline* without a corresponding Phase-4 measurement; the surface and read axes rest on captured tool outputs, not on modeled behavior.

---

## Decisions for James

- **§1 — Version-matching policy.** Recommended: each server at its shipped default + document each + one sensitivity run (makenotion at 2026-03-11). Alternative: force all to a single common version (cleaner table, less representative of what users actually install). *Recommend the first.*
- **§2 — Tokenizer.** Recommended: Anthropic token-counting API as primary, cl100k_base committed as keyless-reproducible cross-check. Alternative: stay cl100k-only (cheaper, no API key, but keeps the permanent "≠ Claude's tokenizer" disclaimer on every number). *Recommend Anthropic-primary.*
- **§3 — Adversarial aggressiveness.** How hard to push the anti-markdown corpus. Recommended floor: include R4 (plain-text-heavy) and R5 (annotation-pathological, where we provably drop color info) and report the widened range. Question for you: include R5's information-drop prominently in the public artifact (maximally honest, slightly deflating), or footnote it? *Recommend prominent — it pre-empts the skeptic.*
- **§4 — Which axes gate a 1.0-grade claim.** Recommended: Axis B (page read) must-have and headline-eligible; Axis E (DB query) strong supporting; Axis A (surface) reported honestly as "not leanest"; C/D/F/G/H as workflow color only. Confirm you don't want a surface-axis claim in the masthead (we'd lose that comparison).
- **§5 — Hosted (mcp.notion.com).** Keep it as an explicitly-labeled modeled estimate only, or drop it from the artifact entirely? The roadmap forbids a token-cost-vs-hosted headline; recommend "estimate, clearly fenced, not in masthead."
- **§6 — People-columns in the DB write corpus.** Exclude (no notifications, slightly less realistic) or include (realistic, but notifies you on every run)? *Recommend exclude unless you want the realism.*
- **§7 — Scope of the first run.** Minimum publishable = Axis B only (closes the README honesty gap fastest), or full B+E+surface before touching the masthead? *Recommend B+surface first (surface is nearly free and the masthead must not imply a surface win), E close behind.*

---

## Codex review

Pressure-tested by Codex (session `plan-review-token-benchmark`, high-effort, full-spec read). Verdict: "much stronger than the pilot, but still too loose in three places a skeptic will attack: normalization, live-Notion reproducibility, and operation accounting." All of Codex's substantive points were accepted and folded into the spec above — they sharpen rather than contradict. Changes made in response:

- **Counting unit was undefined → §2.0 added.** Codex flagged that "raw `tools/call` result string" was ambiguous (full JSON-RPC? `result.content[*].text` only? args included?) and therefore gameable. Pinned the canonical unit to concatenated `result.content[*].text`, envelope/stderr excluded, and added the **four-column accounting** (request / response / call-count / total) so call-count and serialization are never conflated. This was Codex's #1 change.
- **"Information floor" was not implementable → §3 rewritten.** Codex called the floor prose unimplementable and argued for a concrete IR schema + a completeness score, and for **three numbers, not two** (measure information-drop directly rather than inferring it from divergence). Added the per-block-type **normalized IR table** and the **completeness score**. Codex's #2.
- **"Representative" overclaim → §4 reworded + shapes added.** Codex: n≥5/class is a "controlled benchmark corpus," not statistically representative; and the corpus was missing **deep-nesting/many-small-block (R7)** and **media/embed-heavy (R8)** shapes. Added both, downgraded the wording, and **excluded R5 from the headline median** (Codex flagged R5 flatters us via undisclosed information-drop). Codex's #3, #6, #7.
- **DB-axis version policy too weak → §1.3.** Codex: default-version-plus-sensitivity is fine for page reads but the 2025-09-03 data-source reshape is a real confound for DB axes. Made the sensitivity run **mandatory for E/F**.
- **Tokenizer underspecified → §5.** Codex: "Anthropic primary" alone isn't reproducible; pin model id, API version, request/wrapper shape, and commit raw count responses. Added.
- **Reproducibility conflated live vs replay → §6.** Codex: live Notion re-runs can't be byte-exact (injected IDs/timestamps). Split into **byte-for-byte replay of committed outputs** (load-bearing) vs **live re-run within tolerance**.
- **Execution deps undercalled → §8.1 added.** Codex listed toolchain versions, per-server env, timeout/retry, rate-limit, pagination order, stderr exclusion, **per-server call-shape preflight**, and sandbox cleanup. Added as a checklist; the preflight point is important because awkoy's dispatcher and better-notion's composite tools may not match the §2 axis hypotheses.

Nothing in the review was overruled. The one place I'd note a *judgment* rather than a pure accept: Codex's completeness score could be over-engineered into a full per-field audit; the spec keeps it lightweight (a retain/drop fraction against the committed IR table) so it informs the headline gate without becoming its own research project.

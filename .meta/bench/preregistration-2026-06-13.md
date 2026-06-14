# Token-cost benchmark — pre-registration

**Date:** 2026-06-13 · **Status:** committed BEFORE any measurement (git history must show method preceded results).
**Authority:** distilled from the James-approved, Codex-reviewed methodology spec
`.meta/plans/token-benchmark-methodology-2026-06-13.md`. Where this doc and the spec disagree, the spec wins;
this doc only *pins the exact executable procedure* so results cannot be retrofitted.

This pre-registration is **load-bearing**: it fixes the corpus generation rules, the counting unit, the tokenizer,
the version policy, and a **predicted direction per shape class**, all written down before a single number exists.
Measuring against a prediction you committed first is the cheapest defense against motivated analysis (spec §7.1).

---

## 0. Phase scope (this commit)

This benchmark executes in phases. **This pre-registration covers the whole method; Phase 1 (this run) executes only
the token-free parts.** What Phase 1 does and does not do:

- **DOES:** build the reproducible MCP-client harness; provision all 4 servers at pinned SHAs; run **Axis A
  (tool-surface)** for all 4 with a dummy token; count with cl100k; generate (not read) the corpus fixtures.
- **DOES NOT:** any live Notion read/write (Axes B–H need a provisioned token — later phase); exercise the
  3-number information-equivalence scheme (read-axis concern; structure defined in code, not run); touch
  README/masthead or the stale `docs/token-benchmark-results.md`.

Axis A is the honest **no-headline** axis: we are competitive but **not the leanest** (smaller than makenotion,
larger than the consolidated awkoy/better-notion). Phase 1 reports that truth; it earns no public claim.

---

## 1. Servers under test — pinned identifiers

Each server is driven **as a real MCP client over stdio** (initialize → tools/list → tools/call). We **run the
servers, we do not model them** (spec §2, §7.6). Each competitor is cloned from a clean checkout, pinned to an
**exact commit SHA**, installed with `--ignore-scripts`, and built. The resolved SHA is captured at run time and
recorded in the results, not trusted from this table.

| Server | Repo | Pinned SHA (authoritative) | pkg version | Tools (expected) | Nature | Notion-Version sent |
|---|---|---|---|---|---|---|
| **easy-notion-mcp (ours)** | this repo (`dist/` built from the worktree commit) | the worktree HEAD under test | 0.9.3 | 42 | markdown converter | 2026-03-11 |
| **makenotion/notion-mcp-server** | github.com/makenotion/notion-mcp-server | `e79f35fd64cc5db726fbba1beebaa84c80760c17` | 2.3.1 | 22 | thin OpenAPI proxy (raw REST JSON) | 2025-09-03 |
| **awkoy/notion-mcp-server** | github.com/awkoy/notion-mcp-server | `f5f1bdaf2456093a583722dab8422cf7b972636c` | 2.5.1 (banner mismatches v1.4.0) | 2 | markdown converter + `notion_execute` dispatcher (lazy schemas) | 2025-09-03 |
| **better-notion-mcp (@n24q02m)** | github.com/n24q02m/better-notion-mcp | `7c56493eb60af7d8c2e9d0306b649e96ddcabcc7` | 2.34.8-beta.3 | 11 | markdown "mega/composite" tools | 2025-09-03 |

Tool counts are **expectations from the spec**, not assertions; the run records the actual count. awkoy reporting
2 tools (a dispatcher hiding ~37 ops behind `notion_execute`) is the honest reason its surface number is not
comparable leanness — it defers per-op schema cost to call time. This is stated, not hidden.

**Supply-chain note:** awkoy and better-notion are low-star packages. Both are inspected (package.json scripts +
bin entries scanned for postinstall/suspicious behavior) before execution, and all installs use `--ignore-scripts`.
Servers are run with a **dummy/empty token** for tools/list — no real secret is needed for Axis A.

---

## 2. Axis A — tool-surface (the only axis this phase measures)

- **Operation:** a single `tools/list` JSON-RPC call after `initialize`, with a dummy token. No tool is called.
- **Counted unit:** the **minified (compact `JSON.stringify`) `result.tools` array** — the full tool-definition
  payload (name + description + inputSchema + any extra fields a server returns). This is exactly what loads into
  an agent's context when the tool set is presented. The JSON-RPC envelope (`jsonrpc`/`id`/method) is **excluded**;
  server stderr/log lines are **excluded** (captured separately for debugging only).
- **Reported per server:** tool count, total cl100k tokens, total bytes, avg tokens/tool, and the captured SHA.
- **Premise to confirm at run time:** `tools/list` requires no valid token on all four servers (dummy suffices).
  A server that validates the token at list time fails loudly — that is a finding, not a silent skip.

Axis A makes **no per-call efficiency claim** and is **never** masthead-eligible (spec §2 table, §8.5 claim gate).

---

## 3. Tokenizer policy

- **Primary (designed-for, deferred this phase):** Anthropic's token-counting API. The claim is "tokens in a Claude
  context," so the durable number must use Claude's tokenizer. The harness **wires the integration point** and pins:
  model id `claude-opus-4-8`, the `anthropic-version` header, and the request shape (text wrapped in a single-message
  `messages` payload, the same wrapper applied identically to every server so the ratio is wrapper-invariant). Raw
  API count responses are committed when produced.
- **This phase:** **no `ANTHROPIC_API_KEY` is present in-env**, so the Anthropic path is a **cleanly-marked,
  non-faked hook** that reports `available: false` and is skipped. Phase 1 reports **cl100k only**. This is honest
  for the surface axis: surface-axis *ratios* are tokenizer-insensitive enough for a first pass, and Axis A earns no
  public claim regardless. **Wiring + exercising the Anthropic primary count is a Phase-2 prerequisite** before any
  number reaches the public record.
- **Cross-check (keyless, reproducible):** cl100k_base via `js-tiktoken` `encodingForModel("gpt-4")`. A reader
  without an API key reproduces these exact numbers. The same encoding is exposed by the `tokens` MCP, used for
  independent verification of the harness's counts.

---

## 4. Version policy

Each server runs at its **shipped-default Notion-Version** (table §1), each documented explicitly. A **sensitivity
run** (makenotion forced to 2026-03-11, or ours probed at 2025-09-03) is **mandatory for the database axes (E/F)**
and optional-but-recommended for page-read (B), per spec §1.3. **Axis A is version-independent** (tool definitions
do not vary by Notion-Version), so no version control applies this phase.

---

## 5. Corpus — generated this phase, read in a later phase

The corpus is **generated by a committed, deterministic rule script** (no hand-picking, no `Date.now`/`Math.random`),
so any reader regenerates byte-identical inputs. Phase 1 **generates and commits** the fixtures; it does **not** read
them against live Notion. n ≥ 5 distinct instances per class; report median + full range when read.

This is a **controlled benchmark corpus with adversarial controls**, **not** a statistically representative sample
of real Notion pages. The public artifact must use that wording (spec §4 honesty discipline).

### 5.1 Page-read classes (Axis B) and predicted direction

| Class | Shape | **Predicted direction (committed)** |
|---|---|---|
| R1 favorable-rich | headings, prose, nested lists, code, callouts, tables | large markdown win (~10–15x) |
| R2 typical-prose | H1 + several paragraphs + one list | moderate win |
| R3 adversarial content-light/metadata-heavy | near-empty stub | win shrinks |
| R4 adversarial plain-text-heavy | few very large unannotated paragraphs | **win shrinks toward ~1–2x** |
| R5 adversarial annotation-pathological | nearly every span distinctly annotated/colored | **two-sided**: raw JSON balloons (helps us) but we drop color (hurts completeness). **Excluded from headline median** |
| R6 adversarial code-dominant | one large code block | win shrinks (code ~verbatim both sides) |
| R7 deep-nesting / many-small-blocks | hundreds of short blocks nested 3–5 deep | **two-sided**: raw per-block metadata × N helps us; markdown structural markers also grow |
| R8 media/embed/file-heavy | images, embeds, files, bookmarks | **win may invert or shrink**; pairs with completeness score |

### 5.2 Database classes (Axis E/F)

- **D1** wide DB: 10–15 mixed-type properties, ~5 and ~100 rows (scale effect).
- **D2** adversarial structured-data-heavy: rows nearly all typed properties, near-zero body.
- **People-column caveat:** live writes to people-type columns notify the real user every run. Fixtures **exclude
  people columns** unless James opts in before the write run.

---

## 6. Information-equivalence (structure defined, not exercised this phase)

The read axes report **three numbers** per response (spec §3): (1) as-consumed verbatim tokens, (2) common-IR cost
(both servers projected into one canonical intermediate representation, §3.1 table), (3) completeness score
(fields/attributes preserved vs raw Notion block JSON). Phase 1 defines the IR schema and the 3-number structure in
code; it does **not** run them (no live reads). The headline may cite only an axis whose **normalized** win is still
material (spec §8.5 claim gate).

---

## 7. Reproducibility guarantees

1. **Exact replay (byte-for-byte, load-bearing):** re-running the committed tokenizer over the committed raw outputs
   reproduces the published numbers exactly. Axis A's captured `result.tools` payloads are committed for this.
2. **Live re-run (within tolerance):** re-driving servers in a fresh sandbox yields numbers within a stated tolerance
   (live Notion injects IDs/timestamps; not byte-exact). Applies to read axes in later phases.

Committed this phase: this pre-reg; the corpus generator + generated fixtures; the harness (driver, counter, server
registry, runner); the captured Axis-A `result.tools` payloads per server; the Axis-A results doc; the recorded SHAs
and `--ignore-scripts` install commands. The competitor source clones are **not** committed (only their pins are).

---

## 8. Execution environment (recorded)

- Node `v22.19.0`, npm `10.9.3`; package manager per-server lockfile state recorded at provision time.
- Per-server env captured in the harness (dummy `NOTION_TOKEN` / `OPENAPI_MCP_HEADERS` / `INTERNAL_INTEGRATION_TOKEN`),
  not passed ad hoc.
- Fixed 30s per-call timeout, **no retry** (a retried call must never double-count tokens).
- stderr/log excluded from the counted unit; captured separately.
- Do not touch ports 3333 / 8081.

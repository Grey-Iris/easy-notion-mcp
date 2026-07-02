# Roadmap red-team — cross-model adversarial pass (2026-06-12)

**Target:** `.meta/plans/roadmap-recon-2026-06-12.md` (DRAFT phased roadmap → 1.0).
**Method:** Independent Claude-side code read + an independent **Codex** read of the same code
(session `redteam-roadmap-2026-06-12`, sessionId `019ebfc7-2bc1-77d3-88af-ac673b94e752`), folded
together. The roadmap was produced by an all-Claude workflow; this is the missing non-Claude pass.
**Scope:** Attacks the roadmap's *analysis and recommendations*, not James's pending §A–§J
decisions. READ-ONLY — no edits to roadmap or code, no commits, no GitHub/Notion writes. Codex
was instructed read-only.
**Verdict (one line):** **act-on-with-named-caveats.** The roadmap's bucket structure and most
recommendations are sound, but it carries **two factual errors that mis-scope freeze-gated work**
(§1F warning list, §2A nested-to_do scope), **one overstated central thesis** (additive≠always
non-breaking), and **one under-scoped security surface** (OAuth freeze is treated as shape-only).

The two models **converged** — no substantive Claude-vs-Codex disagreement. Calibration notes are
flagged inline. Each finding tags which model raised it.

---

## HIGH

### H1 — §1F warning-code inventory is factually wrong; the freeze gate starts from a stale list
**Raised by: Codex (verified independently by Claude).** Targets §1F, §1 (organizing principle
#5), and Appendix A.

The roadmap says the "currently shipped" warning codes are exactly three —
`omitted_block_types`, `read_only_block_rendered`, `truncated_properties` (§1F line 99) — and
builds the "warnings v1" freeze gate on locking that list plus Phase-2 additions.

The code already ships **at least seven**: the three named, plus `unmatched_blocks`
(`server.ts:2402/2707`, emitted on `replace_content`/`find_replace`), `bookmark_lost_on_atomic_replace`,
`embed_lost_on_atomic_replace`, and `unrepresentable_block` (`markdown-to-enhanced.ts:29-31/270/275/291`;
CLI mirrors in `cli/run.ts:632/636/951/1302/1678/1894`). There is already a committed
`easy-notion://docs/warnings` resource enumerating most of them (`server.ts:267-367`).

Why it matters: §1F is freeze-gated *because* "codes are part of the contract once shipped." A
freeze artifact that starts from a 3-code list silently under-freezes 4 already-public codes, and
the doc's claim that warnings are a small recently-built surface is wrong — the vocabulary is
already moderately mature and lives on write-tool responses today.
**Adjustment:** §1F must inventory all currently-emitted codes from `markdown-to-enhanced.ts`,
`cli/run.ts`, and `server.ts` *first* (and reconcile the `easy-notion://docs/warnings` resource as
the de-facto v1 list), then add Phase-2 codes. Correct the "currently shipped: [3]" line in §1F
and Appendix A.

### H2 — "additive = not freeze-gated" is overstated; `outputSchema` is the clean counterexample
**Raised by: both (Codex with SDK evidence; Claude concurs).** Targets the central thesis
(Exec summary, organizing principle) and §2E.

The thesis is a good *heuristic* but the roadmap applies it as a near-law. The strongest
counterexample is its own §2E recommendation to "Add `outputSchema` + `structuredContent` to
mutating tools (additive)." Per the installed SDK, once a tool declares `outputSchema`, a non-error
result **must** carry `structuredContent` or the *client* throws
(`node_modules/@modelcontextprotocol/sdk/.../client/index.js:499`, cited by Codex). Today every
result is a JSON-in-text block (`server.ts:190`) and `tools/list` exposes only
name/description/inputSchema (`server.ts:2272`). So `outputSchema` is "additive" only if it ships
atomically with a `structuredContent` payload for every success path of that tool **and** the text
envelope is preserved for back-compat. It is not a free post-hoc add.

Secondary, weaker cases (note, not block): (a) a `warnings[]` field first appearing on
`create_page` changes branching for a compliant client that treats warnings as "require caller
attention" (`server.ts:263`) — *Claude calibration: this is largely the intended effect and a weak
breaking case, MED at most*; (b) tool annotations carry meaningful defaults — `destructiveHint`
defaults **true** when absent (`spec.types.d.ts:1098`) — so adding `readOnlyHint:true` is a real
host-behavior change (the desired one), confirming annotations are not behaviorally inert.
**Adjustment:** State the caveat explicitly in the organizing principle: *additive at the JSON
level is not always additive at the host-behavior level; `outputSchema` is atomic-per-tool, not
deferrable.* Re-label §2E's `outputSchema` item "additive **if shipped atomically with
structuredContent + text back-compat**," not "pure-win."

### H3 — OAuth freeze (§F/§G, limit #8) is under-scoped as a security decision, not just a shape
**Raised by: both (independently).** Targets §1G, §1I (limit #8), Decision §F, Known limit #8.

The roadmap frames the HTTP/OAuth freeze as "inventory the token-response and discovery shapes;
declare frozen or experimental," and records "one valid bearer = full tool surface" as an
*intentional boundary to write down*. The stronger adversarial reading: freezing this at 1.0 locks
in security properties for a server that **holds users' Notion workspace tokens**, and the doc
never names them:
- **Scopes are captured but never enforced.** OAuth stores `scopes` on the session and token
  record and echoes them back (`oauth-provider.ts:107/297/321/428`), but HTTP session setup pulls
  only `extra.notionToken` and builds a full tool server with **no scope policy**
  (`http.ts:243/143`, cited by Codex). So the captured scopes are decorative — a latent
  inconsistency the roadmap presents as "intentional."
- **Refresh tokens never expire and are not rotated.** No `expiresAt` for refresh tokens by design
  (`oauth-provider.ts:309/318`) and the same refresh token is reused on exchange
  (`oauth-provider.ts:404/408`). A leaked refresh token is a permanent workspace-token bearer until
  manual revoke.

**Adjustment:** §F should be a *security* decision, not a shape inventory. At minimum the 1.0 doc
must name (a) no MCP-layer scope enforcement and (b) non-expiring, non-rotated refresh tokens as
explicit, accepted boundaries.
**Claude calibration:** these are real and worth a decision, but tightening them later (adding
expiry/rotation/scope-gating) is *not breaking* for callers — so they are security-gated, not
strictly freeze-gated. The roadmap's error is omission, not mis-sequencing.

---

## MED

### M1 — §2A nested-`to_do` fix scope is understated ("conversion gap" is right; "just attach children" is not)
**Raised by: both (Claude found the parser drop; Codex found the downstream scope).** Targets §2A
nested-task-list row + Appendix A.

The diagnosis is **correct**: nested `- [ ]` children are computed
(`markdown-to-blocks.ts:149-152`) then dropped because the `item.task` branch pushes the `to_do`
and `continue`s without attaching children (`:154-162`), while bulleted/numbered branches *do*
attach them (`:165-180`). And it is genuinely not a Notion limit — Notion's block API supports
`to_do.children` (confirmed against Notion's official block docs).

But "prefer implementing nested `to_do`; warning-only is the weaker fallback" understates the work.
A real fix touches at least four sites: the parser (attach children), the `NotionBlock` type which
models `to_do` as a **leaf** with no `children` field (`types.ts:69`, unlike bulleted/numbered at
`:28/:32`), the write container allow-list `isOptionalChildrenContainer` which **excludes** `to_do`
(`notion-client.ts`), and both serializers which render `to_do` as a leaf
(`blocks-to-markdown.ts:196`, `markdown-to-enhanced.ts:197`). Feasible, but a multi-file change with
its own round-trip test surface — not a one-line parser patch.
**Adjustment:** Keep "prefer implementing," but size it as a 4-touchpoint change with a round-trip
fixture, and keep the `warnings[]` fallback as the cheap guaranteed-for-1.0 option if the full fix
slips.

### M2 — the silent-drop "shared failure mechanism" (§2A edge matrix) is misattributed
**Raised by: both.** Targets §2A nested-block edge-matrix row.

§2A says "the leaf-detection in `notion-client.ts:141/143` plus parser child handling is the shared
failure mechanism" for the silent-drop class. The leaf-detection is `canInlineChildrenInOneWrite`
— it does **not drop** children; when children can't be inlined it routes them through
`needsDeferredChildWrites`/`appendDeferredChildren` (`notion-client.ts:204/248`), which the prior
verification audit confirmed preserves ordering and content. The actual drop site is purely the
**parser** (`to_do` branch discarding children, and any other parser branch that `continue`s without
re-attaching). Conflating a correct write-path optimization with the bug risks the edge-matrix probe
looking in the wrong place.
**Adjustment:** Re-aim the edge-matrix premise at parser branches that build a block and skip child
re-attachment; treat the deferred-write path as the *control* that works, not a suspect.

### M3 — §2B blast-radius framing ignores the existing documentation guard
**Raised by: both.** Targets §2B (`update_data_source`) + Decision framing.

§2B elevates `update_data_source` as a "silent destructive full-replace ... sequencing it behind
positioning work is wrong," and lists as acceptance "the destructive semantics are in the schema
text." That acceptance is **already satisfied**: the schema description carries an extensive
"CRITICAL: full-list semantics ... permanently removed ... silently reassigned ... No signal is
raised" warning (`server.ts:1892`), backed by a dedicated resource guide (`server.ts:372-386`). The
real, *un*satisfied gap is purely runtime: `updateDataSource` forwards properties to
`client.dataSources.update` with no option-diff and no emitted warning (`notion-client.ts:1291+`).
**Adjustment:** Re-scope §2B to "runtime guard only (merge mode or emit-on-drop warning); schema
text already done." The elevation over the nested-task drop is defensible on blast radius, but the
framing should credit that the median agent reading the schema is *already* warned — which lowers
the "silent" severity for schema-reading agents and keeps the urgency on the no-runtime-signal hole.

### M4 — de-scoping #51 to "document-don't-resolve" may ship a known-weak core promise
**Raised by: Codex (Claude concurs on the steelman).** Targets Phase 3 + Decision §D.

The roadmap cuts the Tasks primitive (reasonable — over-built for an unreproduced edge) and
defaults to "document the boundary + steer to `append_content`." Steelman against: the timeout
class is **not** narrowly 2-user. Both `replace_content` and `find_replace` hand a single markdown
string to `pages.updateMarkdown` (`notion-client.ts:1166/1172`, `server.ts:2696`), and the CLI uses
the same path — so *every* large-page atomic edit is single-payload, synchronous, and opaque.
"Large-page markdown editing" is a core markdown-first promise; documenting a limit there is a
visible 1.0 gap, not a corner case.
**Adjustment:** Keep Tasks deferred, but pair "document-don't-resolve" with either a measured
boundary (one synthetic probe) **or** a non-atomic large-edit fallback path before 1.0, rather than
documentation alone. (Agrees with the roadmap's own "default (b), upgrade on a probe," but raises
the priority of actually running that probe.)

---

## LOW

### L1 — §1A all-42 input audit is phase-sized; the return-shape audit (§1C) is the hidden big one
**Raised by: Codex (Claude concurs).** Input schemas are centralized in one `tools` array
(`server.ts:1504+`), so §1A is realistic for a phase. The larger, under-sized task is §1C return
shapes: handlers are spread across a long `switch` (`server.ts:2308+`) mixing raw Notion objects,
curated objects, and JSON-in-text envelopes — and `query_view` really does leak the temp `query`
object (`notion-client.ts:1465/1482`, confirmed). **Adjustment:** flag §1C, not §1A, as the
larger freeze-audit effort.

### L2 — Phase-0 "appends the hint unconditionally" is imprecise
**Raised by: both.** Appendix A and Phase 0 say `server.ts:1486` appends the `get_database` hint
"unconditionally." It is gated on `code === "validation_error"` or a message containing "Could not
find property" (`server.ts:1486`). The accurate criticism is narrower and still valid: *all*
Notion `validation_error`s get a DB-property hint even when unrelated (e.g. a bad-UUID validation
error). **Adjustment:** reword the claim; the fix itself is correctly targeted.

### L3 — correlated blind spot: the roadmap over-trusts its own "current state" inventory
**Raised by: both.** The all-Claude room's recurring miss is treating the doc's own inventory as
ground truth: the stale warning list (H1), the "unconditional" hint (L2), and the already-present
`update_data_source` schema guard (M3) are all cases where *the code already contradicts the
roadmap's stated baseline*. The second blind spot is modeling host compatibility as "JSON shape
only," when MCP hosts react to schemas, annotations, warnings, and structured output (H2).
**Adjustment:** before the 1.0 tag, re-derive each "currently shipped / currently does X" claim
from code, not from the draft.

---

## Claude-vs-Codex disagreement
None substantive — the two reads converged on every finding. Calibration deltas only: Claude rates
the warnings-branching sub-case of H2 as MED (intended behavior, weak breaking case) where Codex
bundled it into HIGH; and Claude notes the H3 OAuth items are security-gated but not strictly
*freeze*-gated (tightening later is non-breaking), where the roadmap and the brief treat §F as a
freeze decision.

## Session chain
- PM red-team (this audit): orchestrator-spawned, branch `dev`.
- Codex: `redteam-roadmap-2026-06-12` (sessionId `019ebfc7-2bc1-77d3-88af-ac673b94e752`) —
  independent adversarial code read, ~12.6KB findings, read-only.

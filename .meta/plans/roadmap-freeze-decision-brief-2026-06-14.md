# 1.0 freeze decisions — decision brief (§A–§J)

**Date:** 2026-06-14 · **For:** James · **Source:** `.meta/plans/roadmap-recon-2026-06-12.md` (canonical 1.0 roadmap, cross-model red-teamed 2026-06-13)
**Purpose:** Resolve the ten §A–§J freeze decisions so freeze-gated execution can resume. This brief does not make the calls or plan implementation; it compresses the 41KB roadmap into the ten questions, each with options, a recommendation, the stakes, and what it unblocks.

**How to read stakes:** **HIGH** = freezes a public contract (tool schema, OAuth behavior, CLI surface, response shape) that is expensive to walk back for downstream `npx`/library consumers once 1.0 ships. **LOW** = iterable post-1.0 because the fix is additive (new optional field/param/code) and breaks no compliant consumer.

---

## DECISIONS LOCKED — 2026-06-14 (James, via orchestrator session)

Eight of ten resolved this session. James locked Bucket A, delegated Bucket B and §A ratification to the
orchestrator's recommendations ("your instincts are fine on the choices").

- **§A — CURATE.** Views reads run through `compactView`, volatile `filter`/`sorts`/`configuration` gated
  behind a `raw`/`include_config` flag. Grounded by the views-stability probe (surface is EVOLVING: launched
  3/2026 under our pinned `2026-03-11`, version-pinning holds shape only per-version, we bump regularly).
  Aligns reads with the already-curated write path. Evidence: `.meta/research/views-stability-probe-2026-06-14.md`.
- **§B — strict additive-only.** No breaking-cleanup window.
- **§D — document #51** boundary for 1.0; build the Tasks primitive later only on a repro.
- **§F — EXPERIMENTAL** OAuth label (low-regret given few consumer promises). Security hardening proceeds
  regardless of label; 1.0 docs must still name the accepted boundaries.
- **§G — exclude the CLI** from the 1.0 freeze (explicitly pre-1.0).
- **§H — freeze all 42 tools as-is.**
- **§I — weight broad-ecosystem signal** over the two power users.
- **§J — "no breaking changes to frozen surfaces until 2.0"**; **no formal 0.9.x support window** (best-effort).

**§C and §E — now RESOLVED by the dogfood run** (`.meta/research/dogfood-tool-contract-2026-06-14.md`):
- **§C — top-level block map** `{block_id, type, text_preview}` for `create_page`'s receipt (not bare count,
  not full tree). Evidence: agents read the page back to recover block IDs (3/3 runs). Caveat: only 1/3 runs
  needed IDs (2/3 edited by heading), so it's the softest of the ten; the more robust finding is that
  count-only mutation receipts + `update_section` blast radius forced the read-backs.
- **§E — add `@[Title](url)` convention if cheap, else reject/warn.** The @-mention degraded to a plain
  hyperlink in 3/3 runs. One implementation fork remains (URL→page-id cheap or not), not yet checked in code.

> NOTE: the per-section §C/§E entries lower in this brief are the PRE-dogfood analysis; the lines above are
> the resolved post-dogfood decisions. Canonical record of §C/§E closure = the tasuku decision
> `freeze-decisions-1.0-resolved` + the 2026-06-14-2 handoff, not the older per-section bodies below.

> Filed in tasuku as decision `freeze-decisions-1.0-resolved` (all ten, one record).

---

## Recommended decision order

Most of these are cheap once you decide the two that frame everything. Suggested sequence:

1. **§J (semver/support promise)** — *decide first.* It is the contract *around* the contract and sets whether breaking changes are even on the table. Everything else inherits from it.
2. **§B (one breaking-cleanup window?)** — *depends on §J.* Once §J says "no breaks until 2.0," §B answers itself (strict additive-only). If §J leaves a crack, §B is where you'd spend it.
3. **§F (OAuth: frozen or experimental?) and §G (CLI: in or out of freeze?)** — *scope-the-surface decisions.* These two say which surfaces 1.0 even covers. Deciding them early bounds how much audit/hardening work actually applies. Independent of each other.
4. **§A (views read-path: curate or document?)** — biggest regret risk; needs one external fact (is Notion's view shape upstream-stable?). Sequence after the scope decisions, before execution.
5. **§C (write-receipt shape)** — gates the `outputSchema`/write-receipt work in `tool-contract-clarity-pass`; design now because it freezes once shipped.
6. **§E (`@page` mention convention?)** — must land before the conventions-v1 freeze (1E) if you choose to add it; otherwise it freezes as "unsupported." Decide it before the warnings-v1 vocabulary (1F) finalizes too: the reject/warn fallback adds a warning code, and 1F can only lock once every new code is named (1F itself finalizes after Phase 2 names its codes).
7. **§H (freeze all 42 tools?)** — quick; recommendation is freeze-as-is. Decision is independent, but note it does fix the working set for the all-42 schema/return audit (1A/1C), so make it before that audit starts.

**Truly independent (decide whenever):** **§D** (issue #51 resolve-vs-document — gated on a repro, not on the others), **§I** (signal-concentration stance — a prioritization posture, not a frozen surface). **§H** is decision-independent of the others but should precede the 1A/1C audit (above). **§J → §B** is the only hard dependency chain. §A depends on an external fact, not on another decision; §E and §C feed the conventions/warnings/`outputSchema` freezes, so decide them before those lock.

---

## Coupling map — pending next-dispatch items ↔ freeze sections

| Pending item (tasuku / PR) | Freeze section(s) it touches | What the decision unblocks |
|---|---|---|
| `auth-hardening-cluster` (scope-enforcement, refresh rotation) | **§F** | Decides whether OAuth behavior is frozen/experimental → unblocks the non-replay parts of the cluster. *(The small refresh-replay fix is independent — ship anytime.)* |
| `tool-contract-clarity-pass` (schema text + write receipt) | **§C, §E** (and 1E conventions, 1F warnings) | Locks the write-receipt shape (§C) and whether `@[Title](url)` becomes a convention (§E) before the schema text freezes. |
| `pr11-docker-merge-decision` (PR #11) | **§G** | Decides if the CLI/docker surface is in the 1.0 freeze and the docker-on-`v*`-tag question, before rebase+merge. |

---

## §A — Views read-path shape

1. **Decision:** Do `list_views`/`get_view`/`query_view` return a curated `compactView`-style shape (matching the write path), or do we consciously document "views reads return raw Notion view objects" as intentional?
2. **Options:**
   - Curate to `compactView` now, matching the curated write path.
   - Document raw passthrough as an intentional, stable boundary.
   - Label the views read-path experimental / out-of-freeze.
3. **Recommendation (conditional — needs one fact first):** Lean **curate**, *if* Notion's `views.list/retrieve` shapes are still part of the evolving 2026-03-11 data-source surface. Raw passthrough binds our frozen 1.0 contract to an upstream shape we do not control, and the curate-vs-document fork is breaking to reverse. **The deciding fact** is the §A sub-question: does Notion give upstream-stability guarantees on these shapes? If yes, document-raw is defensible and cheaper; if no/unknown, curate. A live probe of the current shape + a check of Notion's changelog resolves this in one dispatch.
4. **Stakes / reversibility:** **HIGH.** Highest regret risk in the roadmap — the read-shape freezes by silence at 1.0, and reversing raw↔curated is breaking.
5. **Unblocks:** Views read-path freeze (roadmap 1D); part of the all-42 return-shape audit (1C).

---

## §B — One breaking-cleanup window?

1. **Decision:** Allow a single deliberate breaking change at 1.0 (response-envelope key renames, `update_section.preserve_heading` default flip), or hold a strict additive-only line?
2. **Options:**
   - Strict additive-only — every cleanup ships as an alias/new field, nothing breaks.
   - Take one breaking-cleanup window for the highest-value rename/default-flip.
3. **Recommendation:** **Strict additive-only.** Every cleanup the roadmap surfaced has a non-breaking form (aliases for param drift, additive receipt fields). The one genuinely-tempting break — the `preserve_heading` default flip — is a *silent* behavior change (same call, different block-identity outcome, invisible in a diff), which is exactly the kind of break that burns downstream consumers without warning. Inherits directly from §J: if back-compat with published v0.9.x is a hard constraint, this is settled.
4. **Stakes / reversibility:** **HIGH** if you take the window (a deliberate break is the most expensive thing to get wrong); LOW if additive-only (the default).
5. **Unblocks:** `move_page` alias (1B) and the return-shape audit (1C) proceed as additive work; clears the framing for every "can we just rename this" question in the schema passes.

---

## §C — `create_page` write-receipt shape

1. **Decision:** What does the write receipt return once `outputSchema`/`structuredContent` ships — a bare count, top-level IDs, or the full tree?
2. **Options:**
   - `blocks_created` count only (cheapest; mirrors `append_content`'s `blocks_added`).
   - Top-level block IDs (enables addressable follow-up edits).
   - Full block tree.
3. **Recommendation:** **Top-level block IDs.** The count alone is cheapest and consistent (it mirrors `append_content`), but the receipt freezes the moment `outputSchema` declares it (red-team H2: declaring `outputSchema` forces `structuredContent` on every success path — atomic per tool, *not* reversible after declaration), and "I just created this, now edit block N" is the obvious next agent move that a bare count cannot serve. Full tree is over-shape for the cost. Since the freeze cost is paid once regardless of which we pick, IDs buy the most for it (a superset of the count's information). **This is the most genuinely-open of my recommendations:** the roadmap deliberately leaves count/IDs/tree unscored, and the count is a legitimate cheaper call if simplicity and `append_content` parity matter more to you than addressable follow-up. A product-intent tradeoff, not a correctness one — I lean IDs but would not over-rule a count preference.
4. **Stakes / reversibility:** **HIGH.** Freezes once `outputSchema` ships; widening a count to IDs later means re-shaping `structuredContent`, which is breaking for clients that bound to the declared schema.
5. **Unblocks:** `tool-contract-clarity-pass` write-receipt + `outputSchema` work (roadmap 2A/2E); feeds the warning-channel design (1F).

---

## §D — Issue #51: resolve or document?

1. **Decision:** For the large-page `updateMarkdown` timeout, do we document the boundary and steer agents to `append_content` (cheap), or build the Tasks primitive to convert it into a pollable async task (resolve)?
2. **Options:**
   - Document the boundary qualitatively + steer to `create_page`/`append_content`.
   - Build the experimental MCP Tasks primitive (async pollable task).
   - Investigate-on-repro only (document now, build later if a repro lands).
3. **Recommendation:** **Document for 1.0; investigate Tasks post-1.0 only on a repro.** Calibration note (per the roadmap red-team correction): the timeout is *broader* than two users — every large atomic `updateMarkdown` edit across both tools and the CLI hits it; what's narrow is the repro evidence (two power-user pages, Kit/4luap), and the "~63KB" threshold is unmeasured. So the case for *documenting* is strong (the boundary is real and affects any large edit), but the case for *building* the Tasks subsystem now is weak (no repro to design against). Do the cheap, honest thing: document the boundary on `replace_content`'s schema qualitatively (today it lives only on `find_replace`), steer agents to `create_page`/`append_content` for large fresh content, and drop the unverified number unless a probe measures one. The minimum documentation action is not optional.
4. **Stakes / reversibility:** **LOW.** Documentation is non-breaking; the Tasks primitive and a future `read_page` byte-budget param are both additive and post-1.0-safe.
5. **Unblocks:** Phase 3 reliability close-out; gated on whether Kit/4luap supplies a repro page or redacted payload.

---

## §E — `@page` mention (#67) convention

1. **Decision:** Before the conventions-v1 freeze, do we add an `@[Title](url)` markdown convention that maps to a page-mention block, or explicitly reject/warn on `@`-mention input?
2. **Options:**
   - Add `@[Title](url)` → page-mention block (a new conventions-v1 entry; must land before 1E freezes).
   - Reject/warn on `@`-mention input so agents learn it is unsupported.
   - Leave the current silent text-degradation behavior (not acceptable for 1.0).
3. **Recommendation:** **Add `@[Title](url)`** if the implementation is confirmed cheap; otherwise **reject/warn**. The non-negotiable is that silent degradation must not survive to 1.0 — it trains agents to believe a mention landed when it became plain text. `@[Title](url)` is the cleanest non-colliding syntax (bare-URL already maps to bookmark). **Open fact:** does Notion's mention block require a page-id or a URL? Needs a live probe; if it needs an id we can't get from a URL cheaply, fall back to reject/warn for 1.0 and add the convention later (additive).
4. **Stakes / reversibility:** **HIGH if you add the convention** (conventions-v1 spellings freeze at 1.0 and are breaking to change); **LOW if you reject/warn** (a warning code is additive; the convention can be added later without breaking anything).
5. **Unblocks:** conventions-v1 freeze (1E) and the warnings-v1 vocabulary (1F); `mention-page-blocks-67` tasuku item.

---

## §F — HTTP / OAuth contract: frozen or experimental?

1. **Decision:** Is the HTTP OAuth contract (token-response shape, `.well-known` discovery metadata, bearer format) frozen at 1.0, or explicitly labeled experimental?
2. **Options:**
   - Freeze it — 1.0 commits HTTP consumers to a stable OAuth contract.
   - Label it experimental — reserve the right to change OAuth shapes post-1.0.
3. **Recommendation:** **Label experimental for 1.0** (genuinely product-intent — flagged, see below). Note the roadmap's red-team is explicit that this is a **security** decision, not a shape-only one: the audit (`oauth-security-read-2026-06-13`) confirms scopes are captured-but-unenforced and refresh tokens never expire / aren't rotated / are directly replayable as permanent `/mcp` access bearers — on a server that holds users' workspace tokens. The *freeze-shape* question (frozen vs experimental) is positioning, but it sits on top of a live security posture that must be addressed regardless of which label you pick. None of the *fixes* are breaking to compliant consumers, so freezing wouldn't trap us on the shape; experimental simply buys room to land scope-enforcement and refresh-rotation without a 2.0, while the posture matures and the typical static-token user (for whom the whole OAuth path is dead code) is unaffected. Counter-case James owns: if a registered MCP host has already bound to our OAuth and we want to signal "production-stable transport" at 1.0, freeze it and commit to the (non-breaking) hardening on the frozen shape.
4. **Stakes / reversibility:** **HIGH** if frozen (OAuth/transport behavior is a public contract for HTTP hosts). **LOW for API-reversibility** if experimental (the audit shows the concrete fixes are non-breaking) — but read LOW narrowly: the underlying security posture is high-impact operationally and is not made low-priority by the experimental label.
5. **Unblocks:** `auth-hardening-cluster` scope-enforcement + refresh-rotation work (the small refresh-replay fix is independent and shippable now — it's the highest-value single non-breaking fix per the audit); the 1.0 OAuth-contract statement (roadmap 1G). **Either label, the 1.0 docs must name the accepted boundaries explicitly:** unenforced requested-scopes, refresh-token non-expiry/non-rotation/replay-as-access-bearer behavior, and — if frozen — an inventory of the token-response and `.well-known` discovery shapes.

---

## §G — CLI scope: in or out of the freeze?

1. **Decision:** Does 1.0 freeze the `easy-notion` CLI flag/output contract, or is the CLI explicitly pre-1.0/experimental and excluded?
2. **Options:**
   - Freeze the CLI surface (flags, profile names, output shapes) at 1.0.
   - Exclude the CLI as explicitly pre-1.0/experimental.
3. **Recommendation:** **Exclude — explicitly pre-1.0/experimental.** The CLI is only partially built per the logged `pause-cli-parity-after-section-block-slice` decision; its flags and output shapes are in flux. Freezing an in-flux surface is exactly the "freeze by accident" failure the roadmap warns against. Excluding it lets CLI parity and the plugin-packaging work (Phase 4) continue without 2.0-level constraints, while the MCP tool surface — the thing downstream consumers actually bind to — freezes cleanly.
4. **Stakes / reversibility:** **HIGH if frozen** (a half-built CLI surface locked is costly to walk back); **LOW if excluded** (you can freeze the CLI at a later minor once parity lands).
5. **Unblocks:** `pr11-docker-merge-decision` (the docker/CLI scope + docker-on-`v*`-tag question); the 1.0 scope statement (roadmap 1H); Phase 4 plugin packaging.

---

## §H — Tool-count surface at 1.0

1. **Decision:** Freeze all 42 tools as-is, or consolidate / profile-gate some first?
2. **Options:**
   - Freeze 42 as-is.
   - Consolidate or remove redundant tools before freezing.
3. **Recommendation:** **Freeze 42 as-is.** Adding tools post-1.0 is non-breaking; removing/renaming is breaking, so removal is the only freeze-gated half — and there's no evidence any of the 42 is redundant enough to justify a pre-freeze break. Pursue context-reduction via the profile-aware CLI, which is additive (and lives in the CLI surface, §G).
4. **Stakes / reversibility:** **HIGH for removals only** (renaming/removing a shipped tool is breaking); freezing the current set as-is is the low-risk default.
5. **Unblocks:** All-42 input-schema audit (1A) proceeds against a fixed set; clears the tool-count honesty work in Phase 0.

---

## §I — Signal-concentration stance

1. **Decision:** How much weight do we give the deep-but-narrow power-user signal (two users, ~half the feature requests) versus broad-ecosystem signal when prioritizing 1.0 work?
2. **Options:**
   - Weight broad-ecosystem signals (auth/token-bloat themes in makenotion's tracker) over the two power users.
   - Prioritize the power-user workflows that generated the richest issue stream.
3. **Recommendation:** **Weight broad-ecosystem signals** over the two power users. The richest signal traces to two power users (4luap/Kit, MasterAlexWest) against ~12 total issues; deep but narrow. Their input is valuable for edge-discovery (it found the #51 timeout and the nested-task drop) but should not set 1.0 priorities by volume alone.
4. **Stakes / reversibility:** **LOW.** This is a prioritization posture, not a frozen surface — re-weightable anytime as signal accumulates.
5. **Unblocks:** Nothing freeze-gated; it informs how §D and the Phase 4 positioning work get prioritized.

---

## §J — Semver / support-window promise

1. **Decision:** What does 1.0 commit to — "no breaking changes to the frozen surfaces until 2.0" — and how long is 0.9.x supported?
2. **Options:**
   - Commit "no breaking changes until 2.0" + a stated 0.9.x support window (e.g. security-fixes-only for N months).
   - Looser language (best-effort stability, no firm window).
3. **Recommendation:** **Commit "no breaking changes to the frozen surfaces until 2.0,"** and state a 0.9.x support window — but **the window length is James's business call** (it's a maintenance-commitment decision, not one the roadmap can derive). A standard, low-burden choice is "0.9.x gets security fixes for ~3 months post-1.0, no new features." The firm no-break promise is what makes the whole freeze meaningful; without it, the §A–§I work is just internal tidiness with no external guarantee.
4. **Stakes / reversibility:** **HIGH (reputational/contractual).** This is the promise downstream consumers plan against; weakening it after 1.0 erodes trust even though it's "just docs." Cheap to state, expensive to renege.
5. **Unblocks:** Directly settles §B (a firm no-break promise ⇒ strict additive-only) and frames every rename/reshape question across 1A–1C; it's the keystone, which is why it's first in the decision order.

---

## Sections where I deferred to James rather than guessing

- **§F (OAuth frozen vs experimental)** — I recommend experimental, but it's a positioning call about what "1.0" promises for the transport half, which only James holds. The audit removes the *correctness* pressure (fixes are non-breaking either way), leaving a pure intent decision.
- **§J support-window length** — the no-break-until-2.0 promise I recommend outright; the *duration* of 0.9.x support is a maintenance-commitment James owns.
- **§A and §E carry an external-fact dependency** — both recommendations are conditional on a one-dispatch live probe (Notion view-shape stability for §A; mention-block id-vs-URL requirement for §E). I've stated the fork each way so the decision is ready the moment the probe returns.

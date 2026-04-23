# E2E Agent-Benchmark Exploration — easy-notion-mcp

**Date:** 2026-04-23
**Author:** Explorer PM (single subprocess session)
**Status:** Exploration, not a plan. Divergent by design — presents options rather than converging on one.
**Scope:** Design shape for two artifacts that sit alongside the tier-1 E2E suite at `tests/e2e/live-mcp.test.ts`:
  - **Artifact A:** CI jungle gym (10–15 verifiable agent scenarios, PR / nightly gate).
  - **Artifact B:** Release-gate benchmark (30–50 scenarios, free-form markdown report primary).

**Out of scope:** Replacing tier-1. Tier-1 catches code regressions (round-trip fidelity, schema drops, transport parity). A/B catch *product* regressions — how well Claude actually wields our tools against realistic tasks.

**Related reading grounded in this session:**
- `tests/e2e/live-mcp.test.ts:1-984` — 29 tests across stdio + HTTP parity, one dated sandbox per run.
- `tests/e2e/helpers/{sandbox,mcp-stdio-client,call-tool,env-gate}.ts` — reusable harness primitives.
- `scripts/e2e/sweep-stale.ts` — dry-run-by-default, title-prefix-matched, manual mop.
- `src/server.ts:517-1009` — the 28 registered tool names (brief says 27; spike and tier-1 assertion both show 28).
- `.meta/research/agent-feedback-loop-spike-2026-04-20.md` — the HTTP-server infra trap and what killed the earlier attempt.
- `.meta/audits/notion-api-gap-audit-2026-04-20.md` — silent-drop and read-truncation classes still live in v0.4.0.
- `.meta/research/use-case-taxonomy-2026-04-17.md` — the 8-persona × workflow matrix this corpus can be drawn from.
- `.meta/plans/tier1-e2e-harness-2026-04-20.md` §2.2 — helper module boundaries we can reuse.

---

## 1. The problem (as I understand it)

Today, tier-1 asks: *"Given a tool call with known inputs, does the tool return the right result?"* It is deterministic and machine-authored. It cannot catch the failure mode where a tool description is confusing, an error message is unhelpful, or two tools are split when one would have been obvious — because tier-1 tests never read the tool description and never make a choice.

The missing feedback loop: *"Given a realistic task and the tool catalog, does Claude use the right tools, in the right order, and finish without floundering?"* That loop tells the maintainer whether **the product** (the tool surface, the descriptions, the error messages, the schemas) is actually usable. It produces two kinds of signal:

1. **Binary capability signal** (Artifact A): did the agent reach the correct end-state? This is a regression gate — flip red when a refactor breaks agent behavior even though the tool still responds correctly.
2. **Qualitative friction signal** (Artifact B): what did the agent struggle with? This is a product-feedback channel — a self-report from the most important customer (Claude), diffable release-over-release, feeding tool-description and schema improvements.

Both consume the same corpus. A is a strict subset of B. B adds open-ended / underspecified tasks where "success" isn't a single end-state.

**Restate to catch misunderstanding:** I don't read this as "replace tier-1." I read it as "tier-1 guards the code, A/B guard the DX." If you're actually asking for something closer to "property-based test over agent rollouts" or "a reliability SLO on agent task success," flag it — that's a different design.

---

## 2. Lenses applied

Before generating options I checked whether the space was genuinely multi-dimensional or whether all viable approaches collapse onto a single template. It does split. Useful angles:

- **User-experience lens** — Claude is the user. "Is this a good tool catalog?" Open-ended tasks are where friction actually shows; closed-end tasks gate regressions.
- **Technical lens** — where does ground truth live? (Notion state? Transcript? SDK probe?) Who's allowed to see it? How isolated is each scenario?
- **Simplicity lens** — the minimum viable: 10 scenarios, a single LLM-as-judge pass over the transcript, a markdown report stapled on. Ships this week.
- **Contrarian lens** — do we actually need A? Tier-1 + a bi-weekly B might already cover the failure modes, and A's maintenance cost is non-trivial. Worth naming as a real option.
- **Ambitious lens** — if constraints were loose: full agent-vs-agent user simulation (τ-bench style), Inspect-compatible transcripts (so Bloom/Petri tooling works), a public leaderboard.

These lenses drive the divergent options below.

---

## 3. Options landscape

### 3.1 Scenario format — three distinct options

**Format A — "Declarative scenario with code escape hatch" (JSON/YAML + optional `.assert.ts`)**

Each scenario is a single file under `tests/bench/scenarios/`:

```
tests/bench/scenarios/
  01-meeting-notes-kickoff/
    scenario.yaml        # metadata + prompt + declarative end-state
    assert.ts            # optional: for anything declarative can't express
    fixtures/            # optional: seed content, file uploads, etc.
```

`scenario.yaml`:
```yaml
id: meeting-notes-kickoff
tier: [A, B]                # A = ships in CI gate, B only = release-gate
prompt: |
  Create a meeting notes page titled "Weekly eng — {{date}}" ... (user prompt)
ground_truth:
  parent: ${SANDBOX_ID}
  pages:
    - title_matches: "Weekly eng"
      must_contain_blocks:
        - type: heading_2
          text: "Action items"
        - type: to_do
          count_min: 3
      must_round_trip_clean: true   # read_page -> equal markdown (minus content-notice)
  tools_must_be_called: [create_page, update_section]
  tools_must_not_be_called: [replace_content]
budget:
  max_turns: 12
  max_tokens: 20000
```

**Trade-off:** Readable, greppable, diff-reviewable, LLM-editable. The declarative grammar covers 80% of cases; `assert.ts` is the escape hatch for "compute column X, assert the formula evaluated to 2*count." Forces us to design the grammar once and grow it.

**Format B — "Prompt + assertion module" (pure TypeScript)**

Each scenario is a TS file:
```ts
export const scenario: Scenario = {
  id: "meeting-notes-kickoff",
  tier: ["A", "B"],
  prompt: (ctx) => `Create a meeting notes page titled "Weekly eng — ${ctx.date}"...`,
  assert: async (ctx, rollout) => {
    const pages = await ctx.notion.listPages(ctx.sandboxId);
    const page = pages.find((p) => p.title.startsWith("Weekly eng"));
    assert(page, "no page created");
    const md = await ctx.notion.readPage(page.id);
    assert(md.includes("Action items"));
    return { passed: true, toolsCalled: rollout.toolsCalled };
  },
};
```

**Trade-off:** Maximum expressive power, no grammar to grow. Cost: every scenario is a mini-program, harder to skim 50 of them, harder for a non-engineer contributor (or LLM) to author, and review load is code-review-load.

**Format C — "Prompt + golden-transcript" (snapshot style)**

Each scenario stores a canonical transcript. The eval runs the agent, diffs the tool-call sequence against the golden. Like Jest snapshots for agent rollouts.

**Trade-off:** Catches regressions *in agent behavior* with zero custom assertion code. Fails catastrophically under model-update noise and normal Claude non-determinism. Useful diagnostic — not a gate.

**Lean (not recommendation):** Format A. The declarative grammar is the load-bearing constraint; it forces explicit thinking about what "done" means, which is exactly the design debt this project currently carries. Format B lives as the escape hatch, invoked maybe 20% of the time. Format C isn't a primary format but is a strong candidate for an opt-in debugging lane (§6).

### 3.2 Verification — where ground truth lives

**V1 — Dogfood verification (use our own MCP).** Run the agent, then spawn a verifier tool client that calls our own `read_page` / `query_database` / `get_database` / `list_pages` to check the end state. Matches tier-1's pattern.

**Pro:** Zero extra surface. Verifier code is re-usable helpers. If our tools can't surface the truth, that's itself a finding.
**Con:** Silent drops (formula columns per the April gap audit) won't be detected — the property the agent was supposed to create won't appear in our own read either, so the test passes wrongly. The whole reason Artifact A exists is to catch DX regressions; dogfood verification has a blind spot precisely where we're weakest.

**V2 — Direct SDK verification (`@notionhq/client` bypass).** The verifier uses `notion.pages.retrieve` / `dataSources.retrieve` / `blocks.children.list` directly. Ground truth is Notion's response, not our wrapper's.

**Pro:** Catches silent drops. Catches rich-text/people truncation at 25 items. Is what tier-1 *should* also do for coverage of gap-class bugs.
**Con:** Duplicates the surface we're testing. More code to maintain. Verifier has to re-implement "did the page round-trip cleanly" logic.

**V3 — Hybrid.** Default to SDK ground truth; use dogfood reads as a sanity check with an explicit `_notion_state_vs_tool_state_diverges` diagnostic line in the report when they disagree. The divergence *is* a finding.

**Lean:** V3. It is the only option that keeps Artifact A honest *and* produces a continuous signal on tool-vs-truth drift (directly improving Artifact B's qualitative report). Costs one extra library call per assertion; negligible at 15 scenarios.

### 3.3 Self-report for Artifact B — three shapes

**R1 — "Post-task interview"** appended to the rollout. After the agent finishes each scenario, a meta-prompt asks: *"Reflect on the tools you used. What was confusing? What schema field felt wrong? What error message didn't help? Was there a tool you wanted and couldn't find?"* Free-form markdown response.

**R2 — "Structured friction frame"** — Claude writes a small YAML block per scenario:
```yaml
friction:
  - tool: create_database
    severity: high
    observation: "The schema parameter accepts formula type but it silently vanishes on retrieve. I assumed I'd set it wrong and tried three times."
    suggestion: "Either add validation or emit warnings.unsupported_property_type in create_database response."
  - tool: query_database
    severity: low
    observation: "Filter shape is Notion's raw API shape; I had to look up the exact 'date': { 'on_or_before': ... } nesting."
rubric:
  task_clarity: 5          # 1-5 how clear was the task
  tool_discoverability: 4
  schema_ergonomics: 3
  error_message_quality: 2
```

**R3 — "Post-hoc transcript analysis by a second model."** Primary agent runs the task. A second agent (cheaper model, e.g. Haiku) post-processes every transcript in aggregate, producing the friction report. The agent-under-test only does the work; it never self-reports.

**Trade-off matrix:**
- R1: warm, discursive, great qualitative signal, fundamentally un-diffable release-over-release.
- R2: diffable (see "schema_ergonomics: 3 → 4" across releases), limits exploration.
- R3: decouples observation from execution (fair — the agent-under-test doesn't get to grade itself), adds cost and a second failure mode.

**Lean:** R2 + R3 together. Each scenario produces a small structured block *and* the transcript is archived. After the full run, a post-hoc Haiku pass produces aggregate themes across scenarios. R1 is redundant once R2 is present.

### 3.4 How the same corpus supports A and B

Critical design question. Two viable approaches:

**S1 — Subset-and-tag.** Every scenario has `tier: [A, B]` or `tier: [B]`. The A runner loads `tier ∋ "A"` scenarios, skips any with `ground_truth.open_ended: true`, uses strict assertions. The B runner loads all of them and in A-tagged ones runs both the strict gate *and* the friction interview.

**S2 — Two assertion layers.** Every scenario has both strict assertions and a fuzzy success predicate. A runs the strict. B runs the fuzzy (LLM-as-judge on a rubric) and captures both outcomes for longitudinal tracking.

**Lean:** S1 with a small nuance — an A-tagged scenario in a B run writes its strict pass/fail *into* the report ("A1 meeting-notes-kickoff: PASS / FAIL") alongside the friction notes. One artifact class, two consumers, shared provenance.

### 3.5 Harness shape — how `ask_agent` is invoked

**H1 — One `ask_agent` per scenario** (strict isolation). Fresh Claude session, fresh conversation context, fresh transcript. Highest signal quality, highest cost.

**H2 — Batched within one session.** Orchestrator gives Claude a numbered task list and collects answers. Cheap but scenarios contaminate each other (learned behavior, memory of error messages carries over).

**H3 — One per scenario, shared sandbox.** All scenarios target the same dated parent page, but each runs in its own agent session. Cleanest trade-off: no context contamination, shared teardown, realistic "workspace is messy" signal.

**Lean:** H3. Matches how tier-1 already works. Enables cheap teardown via the existing sweeper. Keeps Claude's behavior honest per-scenario without needing to recreate the sandbox 15 times.

---

## 4. Concrete corpus — 13 scenarios for Artifact A

Designed to cover all 28 tools via realistic workflows. Each scenario exercises 4-7 tools in combination; no "one task per tool" design. Named so they're memorable in failure mode triage.

| # | Scenario | Tools exercised | End-state claim (sketch) |
|---|---|---|---|
| 1 | **Meeting-Notes Kickoff** | `create_page`, `append_content`, `update_section`, `read_page`, `find_replace` | Page exists under sandbox with 3 H2 sections (Attendees / Discussion / Action Items); "Action Items" contains ≥3 `to_do` blocks; one placeholder string was replaced correctly. |
| 2 | **Runbook Refresh** | `read_page` (seeded fixture), `update_section`, `find_replace`, `append_content` | Only the "Rollback" section changed; sibling sections (Overview, Detection, Response) are byte-equal to seed. New "Last updated" line appended. |
| 3 | **Bug-Tracker Bootstrap** | `create_database` (with `formula` + `relation` + `people` + `unique_id`), `add_database_entries`, `query_database`, `update_database_entry`, `get_database` | Database has all 4 advanced columns preserved in `get_database`. Query returns ≥3 rows. Row 1's status flipped "Open → In Progress". Formula column evaluates non-null. **Deliberately exercises the silent-drop class.** |
| 4 | **Sprint Retro Synthesis** | `search`, `list_pages`, `read_page`, `create_page` | Synthesis page exists with links to ≥2 source pages discovered via search+list. |
| 5 | **Knowledge-Base Migration** (stdio-only) | `create_page_from_file`, `duplicate_page`, `move_page`, `list_pages` | Three pages created from seed files; one duplicated and moved to a child parent; tree via `list_pages` matches expected shape. |
| 6 | **Bibliography Database** | `create_database`, `add_database_entries` (10+ rows), `query_database` with filter, `update_data_source` | DB schema created with `rich_text`/`multi_select`/`url`/`date`; filter returns correct subset; `update_data_source` added a column and the new column appears on subsequent query. |
| 7 | **Editorial Calendar** | `create_database` (status), `add_database_entry`, `query_database` with compound filter, `update_database_entry` | Compound `{ "and": [status, date] }` filter returns correct rows; status workflow transition observed. |
| 8 | **Onboarding Checklist with Collaborators** | `create_page`, `add_comment`, `list_comments`, `list_users`, `share_page` | Page created; ≥2 comments added; `list_comments` returns them in order; `share_page` returns a valid URL. **People-column write intentionally deferred to tier-1; see §5 hazard.** |
| 9 | **Archive Old Sprints** | `list_pages`, `archive_page`, `restore_page`, `delete_database_entry` | Two pages archived, one restored, one DB entry hard-deleted. Post-state: `list_pages` shows expected survivors. |
| 10 | **Project Portfolio with Rollup** | `create_database` (relation), `create_database` (rollup), `add_database_entry` (cross-linked), `query_database` | Rollup column evaluates to expected count on the portfolio side after 3 linked entries added. |
| 11 | **Weekly Status Report** | `list_databases`, `query_database`, `read_page`, `create_page`, `append_content` | Report page assembled from queried data; contains bullet-list citations (one per source row). |
| 12 | **Blog-Post Polish** | `create_page`, `replace_content`, `update_page` (cover+icon), `read_page` | Final page has specified emoji icon, external URL cover, and content fully replaced (no vestige of initial draft). |
| 13 | **Identity Smoke** | `get_me`, `list_users`, `list_databases` | Bot identity returns canonical shape; user list contains ≥1 entry; database list is a list (may be empty). Cheapest scenario — runs first as auth gate. |

**Tool coverage check (28 tools):** all accounted for. `create_page_from_file` is stdio-only and lives in Scenario 5; in HTTP-mode B runs, scenario 5 is skipped and logged as N/A, not failed. `share_page`, `add_comment`, `list_comments`, `list_users`, `get_me` are all exercised in 8 + 13. `delete_database_entry` lives in 9. `restore_page` in 9.

**Artifact B's additional 17-37 scenarios** (sketched only, not fully specified):
- Open-ended write tasks with no canonical end-state ("write a 500-word explainer for our new feature" — judged on "did it use appropriate headings, add a TOC, split into readable sections").
- Adversarial / ambiguous prompts ("update the Roadmap page" — no such page exists; success = agent asks or reports not-found, failure = agent fabricates or creates a wrong page).
- Recovery-from-error ("this markdown will trip the 2000-char rich_text limit — how does the agent recover?").
- Long-horizon workflows (12+ tool calls, forced pagination, rate-limit-sensitive).
- Cross-transport consistency (same task run on stdio and HTTP, diff the transcripts).

---

## 5. Scoring mechanics

### Artifact A — automatic pass/fail

**Per-scenario flow:**
1. Harness creates dated sandbox (reuse `createSandbox` from `tests/e2e/helpers/sandbox.ts`).
2. Scenario's `prompt` is templated with `${SANDBOX_ID}`, `${DATE}`, etc.
3. `ask_agent` dispatched with `agent: claude`, easy-notion MCP attached, prompt, turn/token budget.
4. Transcript captured; tool-call log extracted (the agent harness already records these).
5. **Assertion phase.** Verifier module walks the declarative `ground_truth` block: for each `pages` / `databases` / `blocks` / `properties` claim, run the appropriate read via SDK (primary) and via MCP (secondary). Dogfood/SDK divergence is logged as a warning.
6. `assert.ts` if present runs last.
7. Scenario emits `{ id, passed, durationMs, tokenUsage, toolsCalled, assertionFailures, dogfoodDivergence }`.

**False-positive profile (fails when it shouldn't):**
- Notion's eventual consistency — a just-created page may not appear in a list call within milliseconds. Mitigation: each read step has a 3-attempt, 2-second-backoff retry, same as tier-1 C1/C2.
- Claude chose a valid alternative the schema didn't foresee (used `append_content` instead of `update_section` on a single-section page). Mitigation: `tools_must_be_called` is a small, near-optional list; prefer end-state claims over tool-sequence claims.

**False-negative profile (passes when it shouldn't):**
- Claude fabricated a plausible-looking end state that satisfies loose assertions. Mitigation: at least one `must_contain` that requires a non-trivial semantic element (heading text, specific sentinel in a to-do). Same discipline as tier-1 B1's `ROUND-TRIP-SENTINEL-B1`.
- Silent-drop class (formula column) — mitigated by V3 hybrid verification.

**CI output on failure:** scenario name, first failing assertion with expected/actual, link to sandbox page (still exists at this point — teardown is separate step), abbreviated tool-call log (first 15 calls), full transcript path.

### Artifact B — self-report structure

Primary output: one markdown file per run at `.meta/bench/run-{YYYY-MM-DD}-{shortSha}.md`, archived indefinitely.

```markdown
# Benchmark run — 2026-04-23 — v0.4.1-rc1

## Summary
- Scenarios run: 42 / 42
- Artifact-A gate: 37 / 38 passed (scenario-3 bug-tracker-bootstrap failed: formula column missing in get_database)
- Total tokens: 320k, wall-clock 14 min
- Diff vs prior run (v0.4.0): +1 regression (-0.26 pass rate), +3 friction observations on `update_data_source`

## Per-scenario results
### 3. Bug-Tracker Bootstrap — FAIL
... (assertion-level detail)
### friction (structured)
```yaml
friction:
  - tool: create_database
    severity: high
    observation: "..."
...
```

## Aggregate friction (post-hoc Haiku pass)
Top 3 themes across all scenarios:
1. Filter syntax — Claude had to trial-and-error Notion's raw filter shape in 4/12 scenarios.
2. `update_data_source` schema: not obvious from the description that it does add-or-update per property key.
3. Silent no-op when formula column is requested: 3 scenarios affected, each cost 2-3 extra tool calls.

## Rubric (mean across scenarios, 1-5)
| Axis | This run | v0.4.0 | Δ |
|---|---|---|---|
| task_clarity | 4.2 | 4.1 | +0.1 |
| tool_discoverability | 3.8 | 3.8 | 0 |
| schema_ergonomics | 2.9 | 3.2 | -0.3  ⚠
| error_message_quality | 3.5 | 3.1 | +0.4 ✓

## Transcripts archived
`.meta/bench/transcripts/2026-04-23-{shortSha}/scenario-{N}.md`


**Key diffability property:** the report is plain markdown, rubric is a table with a stable schema, friction is YAML. `git diff` on two reports shows the delta directly — no custom tool needed for release-over-release tracking.

**Prompt templates Claude needs** (lives in `tests/bench/prompts/`):
- System-prefix: standard "use the provided MCP tools, ..."
- Task prefix: scenario's `prompt` field.
- Post-task reflection (R2): structured YAML femit, with the schema above as few-shot.

### Optional rubric axes (for B)

Suggest starting with four and growing cautiously: `task_clarity`, `tool_discoverability`, `schema_ergonomics`, `error_message_quality`. Mark the rubric schema *versioned* in the report (`rubric_version: 1`); when a new axis is added, prior reports' axis is treated as N/A in diffs.

---

## 6. Runtime and cost

Rough numbers, to be validated with a pilot run:

**Artifact A (13 scenarios):**
- Per scenario: ~8k-20k tokens (input + output combined across all turns), ~30-90 s wall-clock.
- Total: ~200k tokens, ~8-12 min wall-clock.
- Claude-4-Sonnet cost at current list: roughly $1-3 per full run. Opus: $3-10.
- **CI-affordable?** Yes for nightly and for release-branch PRs. **Not** for every PR — at $1-3 × several PRs/day, this becomes noticeable. Recommend: PR on opt-in label (`bench-a`), nightly on main, pre-release-tag hard gate.

**Artifact B (42 scenarios):**
- Per scenario: ~15k-50k tokens (open-ended ones trend higher, more turns).
- Total: ~1-2M tokens, ~30-60 min wall-clock.
- Cost: ~$5-20 per run on Sonnet, $20-80 on Opus.
- **Cadence:** every 2-4 weeks pre-release, as the brief specifies. Budget-wise this is trivial.

**Infrastructure costs beyond tokens:**
- Notion rate limits (~3 req/sec). With H3 (one agent per scenario, sequential), we stay under. Parallel scenarios would blow the limit; don't parallelize without a rate-limit middleware.
- Sandbox cleanup uses the existing sweeper. No incremental cost.

---

## 7. Infrastructure

### 7.1 The HTTP-server-at-3333 trap

This is the infrastructure dependency that killed the earlier attempt (commit f6a7fca). Grounded in `agent-feedback-loop-spike-2026-04-20.md:28-63`: the project-scope `~/.claude.json` override names `easy-notion-http` pointing at `localhost:3333/mcp`, and that override *shadows* the user-level stdio entry. Net effect: a dispatched Claude PM from this working directory sees zero Notion tools unless the HTTP server is running.

**Three distinct approaches to this dependency:**

**I1 — Harness-starts-server.** A `beforeAll` in the bench runner spawns `node dist/http.js` on an ephemeral bearer + ephemeral port, patches the dispatched agent's MCP config (or writes a per-run `.mcp.json`) to point there, and shuts it down in `afterAll`. Reuses the `spawnHttpServer` helper at `tests/e2e/helpers/http-server.ts:75-79` from tier-1.

**I2 — Require server running, fail loud.** Preflight checks `curl localhost:3333/` and fails with a clear "run `npm run start:http` first" message if absent. Matches what the spike retry proved works.

**I3 — Bypass MCP entirely, speak JSON-RPC stdio directly.** Don't dispatch Claude via `ask_agent` with MCP-surface attachment — instead, spawn a Claude client harness that speaks tool-calling directly and proxies tool calls to our stdio server via `scripts/e2e/mcp-spike.ts`-pattern. Same pattern Codex would use. No HTTP, no config override, no shadowing.

**Lean:** I1 for local dev and CI (honest to how agents in this repo actually work), I3 as a fallback lane for running the same corpus from external harnesses or Codex. I2 is the band-aid that kept the spike alive but shouldn't be the long-term answer.

### 7.2 Isolation between scenarios

- **One dated sandbox parent** per bench run (reuse `createSandbox`). Matches tier-1.
- **One child-of-sandbox page per scenario.** Each scenario's `prompt` includes `${SCENARIO_PARENT}` pointing at the child. Avoids cross-scenario bleed when a later scenario's `search` or `list_pages` would otherwise catch artifacts from an earlier one.
- **Teardown.** The existing sweeper (`scripts/e2e/sweep-stale.ts`) already matches on `E2E:` title prefix; bench runs should use a `BENCH:` prefix so they're distinguishable from tier-1 leakage. Sweeper walks up to 500 pages and tolerates the expected archive-error classes — extend once if `BENCH:` prefix needs to coexist with `E2E:` matching.

### 7.3 Agent harness shape

Per §3.5, lean toward H3 (one `ask_agent` per scenario, shared sandbox parent, sequential). Pseudocode for the runner:

```
for scenario in selected_scenarios:
  scenario_parent = await createPage(sandbox, title=f"BENCH: {scenario.id}")
  prompt = render(scenario.prompt, { sandbox_id, scenario_parent, date })
  rollout = await ask_agent({
    agent: "claude",
    mcp: { "easy-notion-http": { url: localHttpUrl, bearer } },
    prompt,
    max_turns: scenario.budget.max_turns,
  })
  result = verify(scenario.ground_truth, scenario_parent, rollout)
  results.push(result)
writeReport(results)
```

### 7.4 State reset between scenarios

None needed with H3. Each scenario has its own scenario_parent; cross-scenario bleed is bounded to workspace-level reads (`search`, `list_users`, `list_databases`). For those, either (a) accept the noise (realistic), (b) scope searches to a tag the prompt instructs the agent to use, or (c) skip those tools in scenarios where noise would hide the signal. I'd default to (a); the report's friction section is exactly the right place for Claude to note "search returned 40 irrelevant results."

---

## 8. Failure triage

### When Artifact A fails in CI

A maintainer needs, in order:
1. **Which scenario failed and which assertion.** First line of output: `bench-a FAIL: 03 bug-tracker-bootstrap — expected property "Score" (formula) in get_database response, got []`.
2. **Link to the live sandbox page.** The failure output prints the Notion URL and bench runs don't archive on failure (only on success), giving the maintainer up to ~24h before nightly-sweep to open it and see what the agent actually produced.
3. **Abbreviated tool-call log.** First 15 tool calls with args truncated to 200 chars. Full log in a separate artifact.
4. **Full transcript.** Saved as a CI artifact, one file per scenario. Same format as tier-1 failures for muscle-memory.
5. **Dogfood-divergence warnings.** If the V3 hybrid verifier saw SDK-says-exists but our-tool-says-not, surface that as a distinct line — it's the most interesting class of failure and hardest to otherwise notice.

### When Artifact B report shows friction

The feedback path:
1. Maintainer reads the post-hoc aggregate friction section (§5) — 3-5 top themes already clustered.
2. For each theme, opens the transcripts tagged with it, skims 2-3.
3. Decides: is this a tool-description improvement (cheap, ship in next release), a schema change (expensive, design pass needed), or a new tool (bigger, goes to planning).
4. Filed as tasuku tasks with priority mapped to rubric delta magnitude.

**Non-goal:** automated tool-description regeneration from friction notes. Tempting but premature. Keep it human-mediated at least through v0.6.

---

## 9. Prior-art survey

Grounded via web search this session:

**Anthropic — "Demystifying evals for AI agents" (anthropic.com).** Task → trial → transcript → outcome hierarchy. Three grader types: code-based (deterministic, fast), model-based (rubric-scored, handles nuance), human-based (gold-standard). "Start with 20-50 simple tasks drawn from real failures." Capability evals climb, regression evals stay at ~100%. **Directly applicable:** corpus size, dual-tier gating, per-dimension LLM judge. Adopt the hierarchy verbatim — don't invent new terms.

**Anthropic Bloom (safety-research/bloom).** Open-source framework for behavioral evaluations; Inspect-compatible transcript format; W&B integration. **Applicable:** exporting transcripts in Inspect format is nearly free and unlocks external tooling. Worth flagging for v2 even if we don't adopt.

**MCP-Bench (Accenture, ICLR 2026).** 28 servers, 250 tools, o4-mini as LLM judge. Task files in JSON format. **Applicable:** LLM-as-judge for the completion axis of Artifact B. Their rubric dimensions (schema understanding, tool usage, planning effectiveness) map cleanly to our four proposed axes. Their format is opaque in the README — don't adopt directly, but the rubric structure is reusable.

**Scale MCP-Atlas.** 1000 human-authored tasks, 36 servers, 220 tools, public leaderboard subset of 500. April 2026 update improved scoring judge and added retry handling for transient tool errors. **Applicable:** the retry-on-transient pattern solves the eventual-consistency class we'll hit. Their "human-authored" discipline matches our instinct to author the corpus from real workflows, not LLM-generate it.

**τ-bench (Sierra Research).** User-simulator-talks-to-agent pattern; end-state verification by comparing final DB state to annotated goal. `pass^k` metric (probability all k trials succeed). Retail and airline domains. **Directly applicable:** the end-state-diff approach. We don't need the user simulator (our tasks are single-shot prompts, not multi-turn conversations), but the "check the database state, not just the transcript" discipline is exactly V3 hybrid verification.

**SWE-bench Verified.** Docker-reproducible, human-validated 500-problem subset, minimal bash-only harness. **Applicable:** the "Verified" filter is a lesson — start with a larger set and subset to clean ones with human review. For our scale (13 scenarios), everything is "verified" by the author at authoring time, but the principle applies: any scenario that fails flakily gets promoted to a known-flake list, not fixed-by-retry.

**What's worth borrowing vs building:**

| Idea | Borrow or build | Rationale |
|---|---|---|
| Task / trial / transcript / outcome terminology | Borrow (Anthropic) | Shared vocab with the ecosystem. |
| Inspect-compatible transcript export | Build (small) | Unlocks Bloom/Petri later at ~50 lines of code. |
| LLM-as-judge per rubric axis | Borrow (MCP-Bench, Anthropic) | With "give the judge a way out" (Unknown). |
| Multi-turn user simulator | Skip | τ-bench-class complexity, not our bottleneck. |
| End-state DB diff | Borrow (τ-bench) | This is V3 hybrid verification. |
| Retry on transient tool errors | Borrow (Scale Atlas) | Tier-1 already does this; extend to bench runner. |
| Docker-per-eval | Skip | Overkill for a stateful external service like Notion. |
| Public leaderboard | Skip for now | Project is pre-v1, not the right time. |

---

## 10. Open questions for James

These are decisions I don't have the context to make alone:

1. **Artifact-A gate strictness.** Should a failing A block the *release tag* workflow, or just the PR that introduced the regression, or neither (warn-only)? Lean toward "block release-tag workflow, warn on PR." Open.
2. **Artifact-A in every-PR CI?** At $1-3 / run, a busy day is $5-15. Acceptable? Or opt-in label only? The HTTP-server infra dependency means CI needs to spawn it — one more moving piece. Need a dollar-budget before committing.
3. **People-column writes in A.** Scenario 8 is designed to skip `people`-property writes because the feedback memory says those notify the real user on every run. Is that the right call for the bench or should A use a dedicated service-account Notion workspace so notifications are scoped?
4. **Transcript storage.** Archiving 42 transcripts × 24 releases/year × ~5k tokens each = ~5M tokens of text in the repo. Safe to commit? Or `.meta/bench/transcripts/` gitignored and stored elsewhere? Leaning gitignored with a signed manifest committed.
5. **Which Notion parent and bot.** Tier-1 uses `NOTION_ROOT_PAGE_ID` / `E2E_ROOT_PAGE_ID`. Bench should probably have its own (`BENCH_ROOT_PAGE_ID`) so tier-1 sweeps never tangle with bench artifacts. Separate bot, too? Spike found two bots in play already (Iris, Test); a third for bench would clarify provenance but adds setup cost.
6. **Claude model in the loop.** Sonnet for A, Opus for B? Both on same model? Pinned version or "latest"? A pinned model gives diffable signal; "latest" gives a faster-moving signal. Lean: Sonnet for A (cheap, fast), Opus for B (want the friction from our best customer). Pin version in the run metadata either way.
7. **Who writes the scenarios.** 13 for A is authoring-manageable for one person in an afternoon. 42 for B is a week of careful work. Is the expectation that this agent (or another) proposes the full corpus in a follow-up, or does James author? Scenario quality trumps quantity (Anthropic's "two domain experts would reach the same verdict"), so the authoring mode matters.
8. **Scope of "infrastructure dependency this design needs to address."** I1 (harness-starts-server) vs I3 (bypass MCP, speak stdio) — is speaking stdio from inside `ask_agent` actually possible, or does the agents MCP require the http-attached-server pattern? If the latter, I1 is forced and I2 falls out as a pilot-only option.

---

## 11. Divergence check and what I didn't explore

**Divergence check.** The three main design axes (scenario format §3.1, verification §3.2, self-report §3.3) each have three genuinely distinct options. One scenario format is declarative grammar; one is raw code; one is snapshot. One verification is dogfood; one is SDK; one is hybrid. These aren't different libraries of the same approach — they pick different properties to optimize for. The corpus sketch in §4 is also itself contested: I deliberately mixed workflow-driven scenarios with at least one ("Bug-Tracker Bootstrap") designed to exercise a known silent-drop class — different philosophy from a pure workflow-coverage corpus.

**What I didn't explore:**
- **A user simulator** (τ-bench's approach). Could be valuable for multi-turn scenarios; currently our `ask_agent` dispatches are single-prompt. If James wants conversational scenarios, this is the next round.
- **Live model-vs-model regression.** Run Sonnet and Opus on the same corpus; flag scenarios where they diverge. Useful signal, budget-heavy; defer.
- **External benchmarks measuring us.** Could we submit easy-notion-mcp to MCP-Bench or MCP-Atlas? Interesting long-game — gets external third-party signal, but relinquishes control. Out of scope for this exploration.
- **CI-parallelism strategies.** I assumed sequential per the rate-limit math. Running 3 scenarios in parallel with a shared-token-bucket middleware would cut wall-clock by 3×; deferred on complexity grounds.
- **Negative scenarios — adversarial prompts.** The corpus sketch leans productive-use. Artifact B should grow a "red-team lane" (agent is given a malicious-looking prompt; success = agent refuses or asks clarification, not compliance). Flagged for B's 17-37 open-ended bucket, not spec'd.
- **Longitudinal metric design.** Listed four rubric axes in §3.3 without formally defining them. The Rubric-v1 schema needs a pass before first run or early rubric values won't be comparable across releases.

---

## 12. Session chain

No sub-agents dispatched (per brief constraint: "Do not dispatch sub-agents.").
No Codex feasibility checks (same constraint; also this is design-only per the brief).
Web research: 4 `WebSearch` queries + 2 `WebFetch` calls, all in-session, results inline in §9.
Verification against repo: read `tests/e2e/live-mcp.test.ts`, `tests/e2e/helpers/{sandbox,mcp-stdio-client}.ts`, `scripts/e2e/sweep-stale.ts`, `src/server.ts:517-1009`, `.meta/research/agent-feedback-loop-spike-2026-04-20.md`, `.meta/audits/notion-api-gap-audit-2026-04-20.md` (partial), `.meta/research/use-case-taxonomy-2026-04-17.md` (partial), `.meta/plans/tier1-e2e-harness-2026-04-20.md` (partial), `CLAUDE.md`.
Tool count cross-check: brief says 27, grep of `src/server.ts` shows 28, tier-1 asserts `≥ 27`, spike saw 28. Flagged for James — not a blocker but suggests a counting inconsistency in project docs.

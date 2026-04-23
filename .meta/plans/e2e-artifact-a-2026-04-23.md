---
name: e2e-artifact-a
description: Local jungle gym (Artifact A) for easy-notion-mcp - 13 deterministic agent scenarios in a local-first harness.
type: plan
date: 2026-04-23
author: Planner PM
status: draft (pre-review)
pr_split: proposed (PR-A0 skeleton + scenario 13, PR-A1 mature framework + remaining 12 scenarios)
---

# Artifact A: Local Jungle Gym - Implementation Plan

## 0. Framing

This plan specifies **Artifact A** from the E2E agent-benchmark exploration at `.meta/research/e2e-agent-benchmark-2026-04-23.md`: a deterministic, automatic agent-behavior regression gate with 13 scenarios covering all 28 registered tools. It is the strict-subset sibling of Artifact B (release-gate benchmark with open-ended scenarios), which this plan does **not** cover.

All decisions enumerated in the dispatching brief are treated as fixed. Where a constraint forced a non-obvious design choice, it is flagged in §11 "Risks and open questions."

Decisions map to the research doc as: format §3.1-A, verification §3.2-V3, self-report §3.3-R2 (R3 deferred), corpus integration §3.4-S1, harness §3.5-H3, infra §7.1-I1 (I3 deferred). Corpus is the 13-scenario table in §4 with one modification to scenario 8 and one safety rail (`list_users` bot-only filter before any `people`-column write).

---

## 1. Scope and non-goals

### In scope (ships across PR-A0 + PR-A1)

- Framework at `tests/bench/` (loader, runner, verifier, reporter, manifest writer, CLI entry).
- 13 scenarios authored as YAML (+ 2 `assert.ts` escape hatches for scenarios 8 and 10), matching research doc §4 IDs and end-state sketches.
- Self-report capture (R2 structured friction YAML + 4-axis 1-5 rubric) appended to each transcript.
- Two-axis verification: V3 hybrid (SDK primary, dogfood-MCP secondary, read-path divergence logged as diagnostic) plus schema-drop detection (requested-vs-persisted schema diff, fails the scenario). The second axis is the corrected plan for the create-path silent-drop class; see §4 and §14.
- Dispatch via `claude -p --mcp-config <ephemeral> --strict-mcp-config --model claude-sonnet-4-6`, one process per scenario, sequential.
- Ephemeral HTTP server (reusing `tests/e2e/helpers/http-server.ts`) on an ephemeral port with a fresh bearer per run.
- Transcript storage: gitignored; manifest with SHA256 committed alongside summary report at `.meta/bench/runs/`.
- Teardown: extend `scripts/e2e/sweep-stale.ts` to match `BENCH:` prefix alongside `E2E:`.
- New env var `BENCH_ROOT_PAGE_ID`, documented in `CLAUDE.md` Environment section.

### Explicitly out of scope (deferred; see §11)

- Artifact B runner, 17-37 additional open-ended scenarios, LLM-as-judge grader.
- R3 post-hoc Haiku transcript aggregation.
- I3 stdio-bypass feasibility spike.
- Sister-repo exploration, Inspect transcript export.
- Tool-count documentation reconciliation (CLAUDE.md says 26, `src/server.ts` registers 28).
- Tool-description auto-regeneration from friction notes.
- Parallel scenario execution.
- Opus runs (Artifact B concern).

---

## 2. Proposed PR split

This body of work exceeds one reviewable PR. Framework surface alone is ~1000 LOC; 13 scenario YAMLs add ~1200-1500 more lines. With the local-first pivot, the right split is a **two-PR sequence**:

- **PR-A0 - dispatch + verifier skeleton + scenario 13 only.** Ships the minimum surface that proves the dispatch path works end-to-end: loader, dispatch wrapper, verifier for a very small claim set, manifest writer, and scenario 13 (Identity Smoke - three tool calls, cheapest possible scenario). No sweeper change. No report aggregator beyond a single-scenario summary. Goal: land the `claude -p --mcp-config --strict-mcp-config` composition and the ephemeral-port HTTP server pattern behind a single passing test. ~600-800 LOC.
- **PR-A1 - mature framework + remaining 12 scenarios.** Expands the verifier to the full declarative claim grammar (see §4), adds the report aggregator, ships scenarios 1 through 12, extends the sweeper for `BENCH:` prefix, and adds the CLAUDE.md env doc plus `tests/bench/README.md`. Scenario 3 (Bug-Tracker Bootstrap) remains the deliberate silent-drop probe with a dedicated schema-drop claim kind. ~1800-2300 LOC, mostly scenario YAML plus verifier coverage.

The plan below is written as a single logical build with **phases** that map across PRs as follows:

- **PR-A0:** Phases 0, 1, 2, plus slim slices of Phases 3 (verifier - only the claim kinds scenario 13 actually uses: `users.must_include_bot`, `tools_must_be_called`), 4 (manifest - only, no report aggregator), and 5 (runner - single-scenario path, no cross-scenario teardown-robustness).
- **PR-A1:** Phases 3-8 completed at full scope (all claim kinds, report aggregator, scenarios 1-12, sweeper extension, docs).

Phase boundaries are the natural acceptance checkpoints within a single PR; the two-PR split still slices the verifier and runner vertically so the first PR is genuinely small.

---

## 3. File layout

```
tests/bench/
├── scenarios/
│   ├── 01-meeting-notes-kickoff/
│   │   ├── scenario.yaml
│   │   └── fixtures/            (optional, for seeded pages)
│   ├── 02-runbook-refresh/
│   │   ├── scenario.yaml
│   │   └── fixtures/runbook-seed.md
│   ├── 03-bug-tracker-bootstrap/
│   │   ├── scenario.yaml
│   │   └── assert.ts            (formula-column silent-drop probe)
│   ├── 04-sprint-retro-synthesis/scenario.yaml
│   ├── 05-knowledge-base-migration/
│   │   ├── scenario.yaml
│   │   └── fixtures/{a,b,c}-seed.md
│   ├── 06-bibliography-database/scenario.yaml
│   ├── 07-editorial-calendar/scenario.yaml
│   ├── 08-onboarding-checklist/
│   │   ├── scenario.yaml
│   │   └── assert.ts            (bot-only filter on list_users)
│   ├── 09-archive-old-sprints/scenario.yaml
│   ├── 10-project-portfolio-rollup/scenario.yaml
│   ├── 11-weekly-status-report/scenario.yaml
│   ├── 12-blog-post-polish/scenario.yaml
│   └── 13-identity-smoke/scenario.yaml
├── harness/
│   ├── loader.ts                (YAML parse + schema validation)
│   ├── dispatch.ts              (claude -p subprocess wrapper, MCP config write, stream-json parse)
│   ├── verifier.ts              (V3 hybrid: SDK + MCP, diff + diagnostic)
│   ├── reporter.ts              (markdown summary + per-scenario sections)
│   ├── manifest.ts              (SHA256 manifest write)
│   ├── runner.ts                (orchestrates scenario loop, sandbox/parent setup, teardown)
│   └── types.ts                 (Scenario, GroundTruth, RolloutResult, FrictionReport)
├── prompts/
│   ├── system-prefix.md         (standard "use the provided MCP tools" preamble)
│   └── reflection-template.md   (R2 structured YAML friction schema, few-shot)
├── cli.ts                       (npx tsx tests/bench/cli.ts [--scenarios <ids>] [--bail])
└── README.md                    (short: how to run locally, where reports land, how to triage failures)

.meta/bench/runs/                 (committed: summary reports + manifests)
.meta/bench/transcripts/          (gitignored: raw transcripts per run)
```

Naming conventions:
- Scenario directory prefix is the zero-padded canonical number (01..13) so on-disk order matches the research doc table.
- Child-page title prefix is `BENCH: {scenario.id}` so the extended sweeper matches cleanly.
- Report at `.meta/bench/runs/run-{YYYY-MM-DD}-{shortSha}.md`.
- Manifest at `.meta/bench/runs/run-{YYYY-MM-DD}-{shortSha}.manifest.json` - filename + SHA256 per transcript, plus model/bot/run-config metadata.
- Transcripts at `.meta/bench/transcripts/{YYYY-MM-DD}-{shortSha}/scenario-{id}.ndjson`.

---

## 4. Scenario YAML schema

Minimal, declarative, authored by hand. The schema is the load-bearing artifact; getting it right now prevents churn later. The initial draft had a thinner grammar; Codex pressure-test (§14) identified six scenarios that would have forced `assert.ts` escape hatches for what are actually common result-set and schema-drop assertions. Grammar expanded to bring that number down to two.

```yaml
id: string                        # kebab-case, matches directory
tier: [A, B] | [B]                # A subset is what Artifact A runs
prompt: string                    # templated with ${SANDBOX_ID}, ${SCENARIO_PARENT}, ${DATE}, ${BOT_ID}
budget:
  max_turns: integer              # soft cap in system prefix
  max_tokens: integer             # post-hoc budget check
  max_usd: number                 # passed to claude -p via --max-budget-usd
transport: stdio | http | any     # scenario 5 declares stdio
ground_truth:
  pages:
    - parent: ${SCENARIO_PARENT}
      title_matches: string
      must_contain_blocks: [ { type, text?, count_min?, count_max? } ]
      must_round_trip_clean: bool
      only_section_changed: string        # "Rollback" - sibling sections must be byte-equal to seed
      icon: { type, emoji? | external? }  # metadata-level page assertions
      cover: { type, external? }
  databases:
    - parent: ${SCENARIO_PARENT}
      title_matches: string
      must_have_properties: [ { name, type } ]
      requested_schema: [ { name, type } ]   # for schema-drop detection: explicit requested schema diffed against persisted
      schema_drop_policy: fail | warn | ignore   # default fail when requested_schema is declared
  rows:                           # database-row assertions
    - database_title_matches: string
      must_exist: [ { match: { column: value }, expect: { column: value } } ]   # "status: Open" row must exist AND have "priority: High"
      must_not_exist: [ { match: { column: value } } ]
      size_min: integer
      size_max: integer
  query:                          # query_database-with-filter assertions
    - database_title_matches: string
      filter: object              # Notion filter shape
      result_must_include_titles: [string]
      result_must_not_include_titles: [string]
      result_size_min: integer
      result_size_max: integer
  pages_under_parent:             # list_pages assertions for survivor/archive semantics
    - parent: ${SCENARIO_PARENT}
      must_include_titles: [string]
      must_not_include_titles: [string]
  comments:
    - page_title_matches: string
      must_include_ordered: [ { author_is_bot: bool, body_contains: string } ]
      size_min: integer
  users:
    - must_include_bot: bool      # list_users returns at least one bot (true for scenario 13)
      size_min: integer
  tools_must_be_called: [string]  # soft; logged on miss
  tools_must_not_be_called: [string]  # hard fail
  schema_drop_detection:          # top-level silent-drop assertion, distinct from hybrid-read divergence
    - database_title_matches: string
      must_not_have_missing_properties: true
```

Scenarios that still need an `assert.ts` escape hatch:

- **Scenario 8 (Onboarding Checklist).** The `list_users` filter that screens for bot-typed users before any `people`-column write is a pre-write safety check, not a post-state assertion - expressing that declaratively would require a pre-execution hook in the grammar, which the plan does not add. Keeping it in `assert.ts` is correct.
- **Scenario 10 (Project Portfolio with Rollup).** Rollup column evaluates to a computed count based on relation-entry count. Expressing computed-value semantics declaratively would require the grammar to mirror Notion's rollup formula language. Out of scope; `assert.ts` is the right home.

All other scenarios (3, 6, 7, 9 and the metadata-heavy 2, 12) are expressible in the expanded grammar. The `requested_schema` + `schema_drop_detection` pair is the plan's reconciliation with the silent-drop class - see §5 Phase 3 for the verifier semantics.

A scenario's `assert.ts` has signature:

```
export async function assert(ctx: AssertContext, rollout: RolloutResult): Promise<AssertResult>
```

`AssertContext` provides both the SDK client (`notion: Client`) and the dogfood MCP handle (`mcp: HttpHandle`) so the assert body can run hybrid checks itself. `assert.ts` runs after the declarative verifier, not instead of it.

### Verifier strategy: V3 hybrid plus schema-drop (corrected)

The original plan claimed V3 hybrid verification catches the silent-drop class via SDK-vs-MCP divergence. Codex pressure-test (§14) falsified this for scenario 3's specific case: Notion's `databases.create` itself silently drops unsupported property types (like `formula`) at create-time, so the property never persists. Both the SDK's `databases.retrieve` and our MCP's `get_database` agree the property doesn't exist - because in Notion, it doesn't. No divergence. V3 misses it.

The corrected strategy is two independent verifier axes:

1. **Hybrid divergence (V3).** SDK and MCP read the same object. Divergence is a diagnostic (not a failure) for the *read-path* silent-drop class - where Notion has the property but our tool drops it on read. Keeps the plan's original promise for that class.
2. **Schema-drop detection.** Scenario declares `requested_schema` (the schema the agent was instructed to ask for); the verifier diffs it against the SDK-retrieved persisted schema. Missing properties fail the scenario (under `schema_drop_policy: fail`). This is the *create-path* silent-drop detection the hybrid check can't produce.

Scenario 3 depends on axis 2, not axis 1. The scenario's `requested_schema` explicitly lists the four advanced columns (`formula`, `relation`, `people`, `unique_id`); the verifier reports which ones were dropped. Concrete, actionable, doesn't rely on MCP/SDK disagreement.

---

## 5. Build phases

Each phase ends with two pieces of evidence: build-time (tests passing) and runtime (the thing actually running against Notion). Evidence-has-two-flavors rule per project convention.

### Phase 0 - Dispatch feasibility spike (first 30 minutes of build time)

**Goal.** Confirm the `claude -p --mcp-config <file> --strict-mcp-config --model claude-sonnet-4-6 --output-format stream-json --permission-mode bypassPermissions --max-budget-usd 0.50` composition works end-to-end. This is the brief's flagged high-risk unverified path.

**Steps.**
1. Start a dev HTTP server locally (`npm run start:http`).
2. Hand-write a throwaway `.bench-mcp-spike.json` pointing at `http://127.0.0.1:3333/mcp` with a header-based bearer.
3. Run `claude -p` with the flags above and a trivial prompt: "Call `get_me` and report the bot id."
4. Observe: does the subprocess actually call the tool? Does `stream-json` include `tool_use` events with `mcp__easy-notion__get_me`? Does the bearer flow through?

**Acceptance (pass to proceed).**
- `stream-json` output contains at least one `tool_use` event with `name: "mcp__easy-notion__get_me"` and a tool-result containing a bot id.
- Exit code 0.
- Total wall-clock under 30 seconds.
- The MCP config from `~/.claude.json` does **not** interfere (verified by the fact `--strict-mcp-config` was used; cross-checked by sniffing the tool_use prefix).

**If this fails.** Stop the build. Surface a precise failure class: (a) `--mcp-config` can't load HTTP transports; (b) `--strict-mcp-config` is not actually strict under subprocess; (c) bearer header format is wrong; (d) model flag is rejected. Each class has a different mitigation; none should be papered over.

**Evidence to capture.** A throwaway file at `.meta/runtime-evidence/bench-dispatch-spike-{date}.md` with the flags used, the stream-json tool_use line, the final result text, and timings. Not committed unless the whole phase was blocked and reviewers need the receipt.

### Phase 1 - Framework skeleton (loader + types + CLI stub)

**Build.** `tests/bench/harness/types.ts`, `loader.ts`, `cli.ts`. Loader reads YAML from `tests/bench/scenarios/*/scenario.yaml`, validates with a hand-written schema check (no extra dep; write a `validateScenario(data): Scenario | ValidationError` helper). CLI accepts `--scenarios <ids...>` and `--bail`.

**Tests first.**
- `tests/bench/harness/loader.test.ts` - happy path, unknown keys, missing required fields, malformed YAML, bad tier values. Uses Vitest. Pure unit tests; no Notion access.
- `tests/bench/harness/cli.test.ts` - arg parsing (selected scenarios, bail mode, help text).

**Acceptance.** `npm test` green. `npx tsx tests/bench/cli.ts --help` prints usage.

**Runtime evidence.** None; no network calls yet.

**Dependency.** Add `yaml` to devDependencies (~~js-yaml~~ avoided because it has looser type output; pick the package with the tightest TS types at build time). Version pin and lockfile update go in this PR.

### Phase 2 - Dispatch wrapper

**Build.** `tests/bench/harness/dispatch.ts`. Spawns `claude -p` subprocess per scenario with: ephemeral MCP config file written to OS tmpdir; `--strict-mcp-config`; model pinned via `--model claude-sonnet-4-6`; budget via `--max-budget-usd`; permission via `--permission-mode bypassPermissions`; output format `stream-json`. Streams NDJSON from stdout into a scenario transcript; extracts `tool_use`, `tool_result`, final `result`. Handles timeout (scenario budget + 60s safety margin). Surfaces non-zero exit with stderr captured.

**Tests first.**
- Unit test for `buildMcpConfig(handle, bearer)` - correct shape, header format.
- Unit test for `parseStreamJson(chunks)` - extracts tool_use + tool_result + final result; tolerant of partial chunks.
- Unit test for the dispatch timeout path (mock child_process).

**Acceptance.** Unit tests green. A live smoke test (env-gated, same pattern as `live-mcp.test.ts`) dispatches one `get_me` prompt and confirms the tool was called and the result parsed.

**Runtime evidence.** The env-gated smoke returns a bot id end-to-end. Log preserved in the scenario transcript format the rest of the framework will consume.

### Phase 3 - Verifier (V3 hybrid + schema-drop detection)

**Build.** `tests/bench/harness/verifier.ts`. Implements the two independent axes described in §4:

Axis 1 - **Hybrid divergence (V3).** For each `ground_truth` read-oriented claim, fetch via `@notionhq/client` (SDK, primary source of truth) and via MCP (dogfood, secondary). Record divergence as `result.dogfoodDivergence` entries; surface in the report but do not fail the scenario (per decision 2).

Axis 2 - **Schema-drop detection.** When a `databases[].requested_schema` is declared, diff it against the SDK-retrieved `databases.retrieve` persisted schema. Properties missing from the persisted schema fail the scenario under `schema_drop_policy: fail`. This is the detection path for create-time silent drops (formula, relation, people, unique_id classes) that hybrid divergence cannot produce.

Claim kinds to implement: all those enumerated in §4's expanded grammar (`pages.title_matches`, `pages.must_contain_blocks`, `pages.must_round_trip_clean`, `pages.only_section_changed`, `pages.icon`, `pages.cover`, `databases.must_have_properties`, `databases.requested_schema`, `rows.must_exist`, `rows.must_not_exist`, `rows.size_min/max`, `query.filter + result_must_include_titles`, `pages_under_parent.must_include/must_not_include`, `comments.must_include_ordered`, `users.must_include_bot`, `tools_must_be_called`, `tools_must_not_be_called`, `schema_drop_detection`).

Retry envelope: 3 attempts, 2s backoff (matches tier-1 C1/C2). Reuse `stripContentNotice` from `tests/e2e/helpers/content-notice.ts`.

**Tests first.**
- Unit test for each claim kind with a stubbed SDK client (fixtures captured from a live run in Phase 2).
- Unit test for schema-drop detection specifically: given a `requested_schema` containing formula/relation/people/unique_id and a persisted schema dropping them, the verifier flags each drop with the column name and declared type.
- Unit test for divergence detection (SDK says property present, MCP says absent - the read-path variant of the silent-drop class).
- Unit test for retry/backoff behavior (mock clock).

**Acceptance.** Unit tests green, all claim kinds covered. Schema-drop tests cover each of the four known-dropped property types per `.meta/audits/notion-api-gap-audit-2026-04-20.md`.

**Runtime evidence.** Run the verifier against a live Notion sandbox state seeded with two databases: one with formula-column schema-drop (fires the schema-drop assertion), one with read-path divergence simulated by disabling a specific MCP tool code path (fires the hybrid divergence diagnostic). Both are the canaries for their respective detection axes.

### Phase 4 - Report + manifest writer

**Build.** `tests/bench/harness/reporter.ts` (markdown summary with summary table, per-scenario sections, rubric aggregate, dogfood-divergence section); `tests/bench/harness/manifest.ts` (SHA256 per transcript file, plus run metadata: model, bot id, git SHA, start/end timestamps, total tokens, total USD, Node version).

**Tests first.**
- Unit test: given fixture `RolloutResult[]`, reporter emits expected markdown (stable golden-output test).
- Unit test: manifest JSON validates against a hand-written schema; SHA256 is deterministic.

**Acceptance.** Unit tests green. Report is plain markdown, diff-friendly, rubric table stable schema.

**Runtime evidence.** Write a complete fake run's report + manifest to a tmpdir; read back; SHA256s match; `git diff` between two fake-runs shows only the intended deltas.

### Phase 5 - Runner + Scenario 13 (Identity Smoke) end-to-end

**Build.** `tests/bench/harness/runner.ts` - the full sequence from research doc §5:
1. Check env (`BENCH_ROOT_PAGE_ID`, `NOTION_TOKEN`).
2. `npm run build` precondition (same pattern as tier-1).
3. `beforeAll`: mint bearer, pick ephemeral port, spawn HTTP server, create dated sandbox parent via SDK (not MCP - the sandbox parent is framework infrastructure, V3 ground-truth path), write MCP config file.
4. Per scenario: create `BENCH: {scenario.id}` child page via SDK; render prompt with `${SANDBOX_ID}`, `${SCENARIO_PARENT}`, `${DATE}`, `${BOT_ID}`; dispatch; verify; collect friction block from final assistant message; append to `RolloutResult[]`.
5. `afterAll`: write report + manifest + per-scenario transcripts; sigterm the HTTP server; optionally sigkill after grace (`tests/e2e/helpers/http-server.ts` already implements this pattern). Leave the sandbox parent intact (sweeper handles it later).
6. Exit code: 0 if all A-tagged scenarios passed; 1 if any failed; 2 if framework error.

Also ship scenario 13 YAML (Identity Smoke) - the cheapest scenario, runs first, doubles as the auth smoke.

**Tests first.**
- Unit test: runner lifecycle on mocked dispatch (happy path, dispatch failure, verifier failure, teardown after crash).
- Unit test: on-crash cleanup actually sends SIGTERM to the HTTP child (same pattern as tier-1 `afterAll`).
- Scenario 13 itself is the test - a passing scenario 13 is the green signal.

**Acceptance.** Unit tests green. One full runner invocation against live Notion produces: passing scenario 13 report, manifest with SHA256, NDJSON transcript with `get_me` tool_use, HTTP server shut down cleanly.

**Runtime evidence.** The `.meta/bench/runs/run-{date}-{sha}.md` file produced by the live run, pasted into the PR description.

### Phase 6 - Scenarios 1 + 3

**Build.** Scenario 1 YAML (Meeting-Notes Kickoff) and scenario 3 YAML (Bug-Tracker Bootstrap - the deliberate silent-drop probe). Scenario 3 stays declarative: the regression signal comes from `requested_schema` plus `schema_drop_detection`, not from harness-side special casing or an extra execution mode.

**Tests first.** `npx tsx tests/bench/cli.ts --validate-only --scenarios 01 03` to confirm the authored YAMLs load against the full grammar before live runs.

**Acceptance.** A local run with scenarios 1 and 3 completes end-to-end, with scenario 1 exercising the representative write/read/edit path and scenario 3 proving the schema-drop detector reports missing properties precisely.

**Runtime evidence.** Local run report + manifest linked in the PR description.

### Phase 7 - Sweeper extension + CLAUDE.md + README

**Build.**
- Extend `scripts/e2e/sweep-stale.ts` to match both `E2E:` and `BENCH:` prefixes on the listing step. Zero breaking behavior for existing tier-1 runs; add `sweep-stale.test.ts` cases.
- Add `BENCH_ROOT_PAGE_ID` to CLAUDE.md Environment section.
- Write `tests/bench/README.md`: how to run locally (`BENCH_ROOT_PAGE_ID=... ANTHROPIC_API_KEY=... npx tsx tests/bench/cli.ts`), how the three-layer config works, where reports/manifests/transcripts land, how to triage a failure.

**Tests first.** Extend `scripts/e2e/sweep-stale.test.ts` to assert both prefixes match.

**Acceptance.** Tests green. Dry-run sweeper lists `BENCH:` pages alongside `E2E:`. CLAUDE.md diff is confined to the Environment section.

**Runtime evidence.** `npm run test:e2e:sweep` dry-run against a live workspace that has both `E2E:` and `BENCH:` pages lists both.

### Phase 8 - Remaining 10 scenarios

**Build.** Scenarios 2, 4, 5, 6, 7, 8, 9, 10, 11, 12 YAMLs. Scenario 5 carries `transport: stdio` (create_page_from_file is stdio-only); the runner reports it as `skipped (transport: stdio)` when the harness dispatch is HTTP-only, and as `ran` when a future stdio-dispatch variant exists. Scenario 8 uses its `assert.ts` to call `list_users` with a filter that only selects bot-typed users before writing to the people column.

**Tests first.** For each scenario, the scenario itself is the test; it is written by authoring the declarative ground-truth sketch from research doc §4, then tightening it against one live passing run.

**Acceptance.** Scenario 5 is reported as skipped in HTTP-mode (expected); the remaining authored scenarios are green under the local runner.

**Runtime evidence.** Local run report + manifest linked from the PR description once the full scenario set lands.

---

## 6. Runtime wiring in detail

### Dispatch per scenario

Sequential. One `claude -p` subprocess per scenario. Shell out from `dispatch.ts`:

```
claude -p
  --model claude-sonnet-4-6
  --mcp-config <ephemeral-path>
  --strict-mcp-config
  --permission-mode bypassPermissions
  --output-format stream-json
  --max-budget-usd <scenario.budget.max_usd>
  --append-system-prompt-file tests/bench/prompts/system-prefix.md
  --bare                          # skip CLAUDE.md auto-discovery, auto-memory, plugin sync; isolation
  "<rendered scenario prompt>"
```

Rationale for `--bare`: the bench subprocess should not inherit the parent's memory or CLAUDE.md context - that contaminates the signal. Reflection prompt is appended by the runner after the main task, in a second turn (see below).

Reflection (R2 capture): after the scenario prompt finishes, the runner issues a follow-up turn via `stream-json` input mode with the reflection template. The assistant returns the structured YAML friction block plus the 1-5 rubric. Persisted into the transcript and parsed for the reporter.

### HTTP server lifecycle

`beforeAll`: `pickEphemeralPort()` → `mintBearer()` → `spawnHttpServer({ notionToken: process.env.NOTION_TOKEN, port, bearer })`. Wait for the "listening on 127.0.0.1:{port}" line (already implemented). Store the handle. Record the child PID and the port to a sentinel file at `.meta/bench/.runner-pids/{run-id}.json` so a later reap step can find orphans.

`afterAll`: `handle.kill()` (SIGTERM; awaits child exit). Delete the sentinel on clean shutdown. Attach `process.on('uncaughtException')`, `process.on('SIGINT')`, and `process.on('SIGTERM')` handlers that trigger the same teardown for the bench-runner process itself.

**Hard-kill guardrail (Codex finding, §14).** The original draft claimed "ephemeral port evaporates with the process tree" - too strong. Under SIGKILL or OOM the parent Node process dies before its `afterAll` fires, and the `node dist/http.js` child can survive long enough to hold the port or confuse the next run. Mitigation:

1. **Pre-start reap.** Before `spawnHttpServer`, read any stale sentinel files from previous runs and attempt to SIGTERM their PIDs. If a PID is still alive, wait 2 seconds then SIGKILL. If a PID is unknown (process table doesn't know it), delete the sentinel and continue. Any failure to reap logs a warning but does not block startup; the ephemeral port is per-run so reaping is belt-and-suspenders, not critical-path.

Adding `spawn` option `detached: false` (the default, called out explicitly) so the child is in the parent's process group - that makes `SIGTERM` to the parent's group hit the child when the runner cleanly signals. Does not help with SIGKILL (which bypasses signal handlers), which is why the out-of-process reap exists.

### Per-scenario child page

Before each scenario the runner creates a `BENCH: {scenario.id}` child page under the dated sandbox parent via the SDK (bypasses the dogfood path so framework setup is never the thing-being-tested). The page id is substituted into `${SCENARIO_PARENT}` when rendering the prompt.

### Manifest record

```json
{
  "run_id": "run-2026-04-23-a1b2c3d",
  "git_sha": "a1b2c3d4e5f6...",
  "git_branch": "bench-a/pilot",
  "started_at": "2026-04-23T13:04:00Z",
  "finished_at": "2026-04-23T13:17:42Z",
  "model": "claude-sonnet-4-6",
  "bot_id": "342962c3-6c2f-817b-bc25-0027b72f3c6b",
  "bot_name": "Test",
  "node_version": "v20.x.x",
  "scenarios": [
    {
      "id": "01-meeting-notes-kickoff",
      "passed": true,
      "duration_ms": 54210,
      "tokens_in": 4210,
      "tokens_out": 1188,
      "cost_usd": 0.029,
      "transcript_path": ".meta/bench/transcripts/2026-04-23-a1b2c3d/scenario-01-meeting-notes-kickoff.ndjson",
      "transcript_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  ],
  "totals": { "scenarios_run": 3, "passed": 3, "failed": 0, "tokens_in": 12530, "tokens_out": 3400, "cost_usd": 0.082 }
}
```

Transcripts are NDJSON (one stream-json event per line), gitignored. Manifest + summary markdown committed.

### Model pinning

Single source of truth: `BENCH_MODEL` env var, defaulted to `claude-sonnet-4-6` in `tests/bench/harness/dispatch.ts`. The exact string is recorded in the manifest regardless of source. Changing the model is a PR that updates the default and records the rationale.

---

## 8. Migration of f6a7fca spike artifacts

Proposal: **integrate, do not delete**.

- `scripts/e2e/mcp-spike.ts` stays in place. It is the living reference for the stdio-bypass pattern that backs the deferred I3 followup (§11). The bench harness does not depend on it, but a future I3 implementation will read it for the wire-level pattern. Add a one-line header comment pointing at `tests/bench/harness/dispatch.ts` as the "Tier 1, dispatched-Claude-via-HTTP-MCP" sibling path.
- `.meta/research/agent-feedback-loop-spike-2026-04-20.md` stays in place. It is the historical grounding of the HTTP-server-shadowing trap (decision 6 rationale). The bench README links to it explicitly so future maintainers understand why the harness uses `--strict-mcp-config` rather than relying on `~/.claude.json` inheritance.

Justification: both artifacts are already committed to public record; neither is stale in a way that would mislead readers. The mcp-spike's Codex-agent-script pattern is genuinely load-bearing for I3 if/when that work is picked up. Deleting either would erase provenance for design decisions made in this plan.

---

## 9. Rollout plan

**PR-A0 - scenario 13 only.**
- **13 Identity Smoke** - cheapest, ~5 seconds, 3 tool calls. Doubles as auth probe. Lands the dispatch + minimal verifier + manifest end-to-end at the smallest possible diff.

**PR-A1 - scenarios 1 through 12.**
- **1 Meeting-Notes Kickoff** - representative write/read/edit path. Exercises 5 core tools (`create_page`, `append_content`, `update_section`, `read_page`, `find_replace`). Most of the 13 scenarios are structurally similar.
- **3 Bug-Tracker Bootstrap** - deliberate silent-drop probe. Validates the **schema-drop detection** axis (§4, §5 Phase 3). The scenario's `ground_truth.databases[0].requested_schema` explicitly declares the four known-drop columns (`formula`, `relation`, `people`, `unique_id`); the verifier diffs this against the persisted schema and fails per-property. This replaces the original draft's now-known-wrong "V3 hybrid catches it" claim.

Two scenarios, both meaningful to review: a representative happy path and the adversarial probe. The framework's correctness stands or falls on scenario 3 specifically.

Within PR-A1, author the remaining scenarios in this order to parallelize reviewer attention:
1. Scenario 6 (Bibliography Database) and 7 (Editorial Calendar) - database-heavy, similar shape, co-review efficient.
2. Scenario 2 (Runbook Refresh) and 12 (Blog-Post Polish) - content-editing shape, similar verifier claims.
3. Scenario 4 (Sprint Retro Synthesis) and 11 (Weekly Status Report) - discover + assemble shape.
4. Scenario 9 (Archive Old Sprints) and 10 (Project Portfolio) - lifecycle + rollup, isolated.
5. Scenario 8 (Onboarding Checklist) - people-column write, needs the bot-only filter in `assert.ts`; author with special care.
6. Scenario 5 (Knowledge-Base Migration) - stdio-only, the framework's skipped-when-HTTP path; authored last so we know the skip mechanism works when it's exercised.

---

## 10. Budget estimate

### Per full 13-scenario run

Based on research doc §6 prior-art numbers, refined:
- Tokens: ~200k input + output combined across all 13 scenarios. Most scenarios are 8-20k; scenario 13 is ~3k; scenarios 3 and 6 (database-heavy) trend toward the upper bound.
- Cost on Sonnet (`claude-sonnet-4-6`): roughly $1.00-$3.00 per run at current list pricing ($3/MT input, $15/MT output).
- Wall-clock: 10-15 min sequential. Ephemeral port setup/teardown ~5s; per-scenario dispatch averaged ~50-60s with some variance.
- Notion rate limits (~3 req/sec): comfortable under the ceiling at sequential execution. Verifier adds a handful of SDK + MCP calls per scenario; still bounded.

### Builder wall-clock

Honest estimate for PR-A0 (dispatch skeleton + scenario 13): **3-5 hours**. Per learning `[0186bc]`, actual is likely to be 1-2 hours (10-40x under-run factor). PR-A1 (mature framework + remaining 12 scenarios): **9-16 hours** estimated, likely 3-6 hours actual.

The Phase 0 spike is the biggest unknown. If `claude -p --mcp-config + --strict-mcp-config` with HTTP transport + bearer turns out to have undocumented limitations, Phase 0 could sink 2-4 extra hours of investigation. That risk is called out below.

---

## 11. Risks and open questions

### High-risk (needs live validation before Phase 1)

1. **`claude -p --mcp-config --strict-mcp-config + HTTP + bearer composition.** The exact composition hasn't been run end-to-end in this repo. Phase 0 is the spike; the plan halts if it fails. Recovery path per failure class: see Phase 0. **No design change unblocks this - it must be verified in the first 30 min of build time.**

### Medium-risk

2. **Notion eventual consistency under sequential 13-scenario run.** Verifier retries mitigate most cases, but scenario 9 (archive + restore) and scenario 10 (rollup column) are known to have multi-second settle times. Mitigation: per-scenario retry envelope in the verifier; if a scenario is flaky 2 reruns out of 5, it gets promoted to a known-flake list rather than fixed-by-retry. Aligns with SWE-bench-Verified discipline.

2a. **V3 hybrid verification does not catch create-time silent drops.** The original draft claimed it did; Codex pressure-test falsified this (§14). The create_database case specifically persists nothing for unsupported types, so SDK and MCP both agree the property doesn't exist and divergence never fires. The **schema-drop detection** axis (§4, §5 Phase 3) is the real detection path for that class. V3 still catches read-path drops (SDK-says-exists but MCP-says-absent); the report labels the two diagnostics distinctly so a reader doesn't conflate them.

3. **Token/cost overrun.** A Claude that loops on a confusing tool can burn the scenario budget in one scenario. Mitigation: `--max-budget-usd` per scenario (framework-level hard cap); `max_turns` soft cap in the system prefix; runner aborts a scenario that exceeds 2x its budget even if `claude -p` hasn't stopped itself. Aggregate run budget check at the end: if total_usd > 2 * expected, flag as budget-anomaly in the report.

4. **HTTP server startup race.** Ephemeral port + startup-line detection should handle this (already does in tier-1), but local environments can still deliver unexpected IPv6-localhost vs IPv4-localhost resolution. Mitigation: the helper already forces `NOTION_MCP_BIND_HOST: "127.0.0.1"`; verify this is still honored by the HTTP server after any recent changes. Fallback: fail loud and skip.

4a. **HTTP server orphan under SIGKILL.** Codex finding (§14): the draft's "port evaporates with the process tree" claim was too strong; SIGKILL on the parent can leave `node dist/http.js` running. Mitigation (implemented per §6 "Hard-kill guardrail"): PID/port sentinel file per run and pre-start reap of stale sentinels. Ephemeral port avoids actual collision; reaping prevents accumulated zombies across local reruns.

### Low-risk

6. **Report schema drift across releases.** Mitigation: explicit `rubric_version: 1` and `report_format_version: 1` in the manifest; downgrade gracefully when reading old reports.

7. **`people`-column notification noise in scenario 8.** James approved this; the bot-only filter on `list_users` in `assert.ts` keeps it bounded to automation-only writes. Document the tradeoff in the scenario YAML comments so future contributors understand why the filter exists.

### Open questions needing human input before builder dispatch

- **Q1.** Is there any restriction on which Notion workspace the bench bot can write into? Decision 11 says same Test bot as `.env`, but the bench root page needs to exist and be shared with the bot. Confirm `BENCH_ROOT_PAGE_ID` is provisioned before Phase 5 runs.
- **Q2.** The research doc flagged a tool-count discrepancy (CLAUDE.md says 26, `src/server.ts` registers 28). Per the brief this is a deferred doc reconciliation task, not a plan blocker, but confirm it stays deferred rather than sneaking into this PR.

### Open questions the PM resolves (surfacing for visibility, not blocking)

- Ephemeral port binding to 127.0.0.1 (not `0.0.0.0`): chosen for loopback-only security isolation; the project already uses this. No change proposed.
- YAML parser choice: `yaml` package (not `js-yaml`) for tighter TypeScript types. Pinned at build time.
- `--bare` flag on `claude -p`: chosen so the subprocess does not inherit parent CLAUDE.md or memory; isolation matters for signal quality. If a builder discovers `--bare` breaks some assumption, revert to explicit `--settings <empty-settings.json>`.

---

## 12. Deferred decisions and followup tasks

Per the `feedback_capture_deferred_decisions` memory, every decision explicitly deferred out of this PR becomes a backlog-priority tasuku task with a triggering condition. Names are kebab-case to match the tasuku convention.

| Task name | Triggering condition | Scope |
|---|---|---|
| `bench-r3-haiku-aggregation` | After 4 weekly Artifact B runs land, when rubric signal is still noisy and per-scenario friction blocks need clustering. | Second-model post-hoc transcript analysis (Haiku). Produces the "top themes" section of the B report. |
| `bench-i3-stdio-bypass-spike` | When a contributor or CI runner lacks network egress for an HTTP dispatch, or when Codex (not Claude) needs to run the same corpus. | Prove a stdio-direct dispatch pattern equivalent to the mcp-spike.ts shape. ~2 hour spike. |
| `bench-b-open-ended-scenarios` | After Artifact A is stable for 3 consecutive releases and James wants release-gate friction signal. | 17-37 additional scenarios per research doc §4 B-only list: open-ended writes, adversarial/ambiguous prompts, recovery-from-error, long-horizon, cross-transport consistency. |
| `bench-sister-repo-exploration` | When easy-notion-mcp's bench framework is proven stable, and another MCP server in the author's portfolio wants to reuse the harness. | Extract bench framework to a shareable pattern (npm package, monorepo, or vendored template). |
| `bench-tool-count-docs-reconciliation` | Before the next published release with tool-count-sensitive docs changes. | CLAUDE.md and any README files say 26; `src/server.ts` registers 28; tier-1 asserts ">= 27". Pick one source of truth and update all three. |
| `bench-to-tool-description-automation` | After Artifact B has produced friction signal on the same tool across 3+ releases without a human-made fix. | Explore: automated tool-description regeneration from aggregated friction notes. Premature today; parked per research doc §8 "non-goal through v0.6". |
| `bench-cost-dashboard` | After 30 days of bench runs. | A sanity-check cost aggregator that reads all manifests and plots $/run and $/month. Lands as a `npm run bench:costs` script or a simple CI summary step. |
| `bench-inspect-transcript-export` | When a Bloom or Petri integration becomes concretely useful. | Export NDJSON transcripts in Inspect-compatible format. ~50 LOC per research doc §9. |
| `bench-parallel-scenarios` | When wall-clock becomes a CI bottleneck (probably at Artifact B scale, not Artifact A). | Rate-limit middleware + parallel scenario execution. Deferred on complexity grounds. |

These are intended as file-right-after-plan-approval tasuku entries; they are not blockers for this PR but belong in the ledger so they aren't re-derived in a future planning round.

---

## 13. Per-PR acceptance checklists

### PR-A0 (framework skeleton + scenario 13)

- [ ] Phase 0 dispatch spike evidence attached to PR description (flags used, tool_use event, timing).
- [ ] `tests/bench/harness/{types,loader,dispatch,verifier,manifest,runner}.ts` present with unit tests; `npm test` green. Verifier carries only the claim kinds scenario 13 uses.
- [ ] Scenario 13 YAML validates and runs end-to-end live.
- [ ] Live run report + manifest at `.meta/bench/runs/run-{date}-{sha}.{md,manifest.json}` committed.
- [ ] `.meta/bench/transcripts/` and `.meta/bench/.runner-pids/` added to `.gitignore`.
- [ ] PID/port sentinel + pre-start reap implemented; unit-tested against a pre-planted stale sentinel.
- [ ] No em dashes in user-voice prose; `.meta/` screening complete.

### PR-A1 (mature framework + remaining 12 scenarios)

- [ ] Verifier grammar expanded to the full claim kind set (§4); unit tests cover each kind, including `schema_drop_detection` against each of the four known-dropped property types.
- [ ] Scenario 3 uses `requested_schema` + `schema_drop_policy: fail` rather than relying on V3 hybrid divergence.
- [ ] Report aggregator emits stable markdown; round-tripping two fake runs shows only intended deltas.
- [ ] Scenarios 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 YAMLs present and validating.
- [ ] Scenario 8's `assert.ts` implements bot-only filter on `list_users` before any people-column write.
- [ ] Scenario 10's `assert.ts` verifies rollup column computed value.
- [ ] Scenario 5 is reported as skipped when dispatch is HTTP-only (transport marker honored).
- [ ] `scripts/e2e/sweep-stale.ts` matches both `E2E:` and `BENCH:` prefixes; `sweep-stale.test.ts` updated.
- [ ] CLAUDE.md Environment section lists `BENCH_ROOT_PAGE_ID`.
- [ ] `tests/bench/README.md` covers the three-config-layer story and the two-axis verifier.
- [ ] No em dashes in user-voice prose; `.meta/` screening complete.

---

## 14. Codex pressure-test record

Review session: `plan-review-artifact-a-v2` (first attempt `plan-review-artifact-a` timed out at 5 min; resumed fresh with a tighter prompt at medium reasoning effort). Codex read the draft plan, `tests/e2e/helpers/http-server.ts`, and the spike doc lines 115-230. Verdict: "Ship with fixes."

### Findings and dispositions

1. **`claude -p --mcp-config` shape.** Codex verified the draft's assumed JSON shape (`{ mcpServers: { name: { type: "http", url, headers: { Authorization: "Bearer ..." } } } }`) against current Claude Code docs and local `claude` v2.1.116; shape matches. **Disposition: accepted, no change.**

2. **HTTP server lifecycle under SIGKILL.** The draft claimed "ephemeral port evaporates with the process tree" - too strong. Under parent SIGKILL or OOM, the `node dist/http.js` child can orphan. **Disposition: accepted. §6 now specifies a PID/port sentinel file and pre-start reap of stale sentinels. §11 risk 4a added.**

3. **V3 verifier on silent-drop class.** The draft's central claim for scenario 3 was wrong. The formula-column drop is a *create-time* drop - Notion itself persists nothing - so SDK and MCP both agree the property doesn't exist, and divergence never fires. The spike doc at lines 143-181 verifies this: `create_database` returned only `["Task", "Count"]` and `get_database` returned only `Task` + `Count`; no Score. **Disposition: accepted with a concrete fix. §4 now adds `requested_schema` + `schema_drop_policy` + `schema_drop_detection` grammar; §5 Phase 3 now implements schema-drop detection as an independent verifier axis distinct from V3 hybrid. V3 is retained for the read-path variant of the silent-drop class but no longer overclaimed. Scenario 3's YAML is now declarative rather than relying on `assert.ts`. §9 rollout plan updated accordingly.**

4. **YAML grammar sufficiency.** Codex counted 6-8 of 13 scenarios that would need `assert.ts` escape hatches under the original thinner grammar: 3 (schema-drop), 6 (filter-returns-subset), 7 (compound filter), 8 (bot-only pre-write), 9 (survivor set), 10 (rollup computed value), plus 2 (only-section-changed) and 12 (icon/cover metadata) at the edge. **Disposition: accepted. §4 grammar expanded with `rows.must_exist / must_not_exist / size_min`, `query.filter + result_must_include_titles`, `pages_under_parent.must_include/must_not_include`, `pages.only_section_changed`, `pages.icon`, `pages.cover`, `requested_schema`, `schema_drop_detection`, `users.must_include_bot`, `comments.must_include_ordered`. Remaining `assert.ts` scope narrows to 2 of 13 (scenarios 8 and 10) and is justified explicitly in §4.**

5. **PR-split boundary.** Codex flagged the earlier draft's large framework PR as too big for one review. The follow-on roadmap decision after the local-first pivot collapsed delivery to two PRs: PR-A0 dispatch/verifier skeleton + scenario 13, PR-A1 mature framework + remaining 12 scenarios. **Disposition: superseded by the roadmap edit. §2 rewritten; §5 phase-to-PR mapping updated; §13 now has per-PR acceptance checklists.**

6. **Three gotchas ranked by severity.** Codex's top three: (a) the silent-drop detection premise; (b) the hard-kill lifecycle story; (c) grammar thinness. All three are addressed above. Codex did not find additional issues beyond these.

### Where Codex pushed back but the plan overruled

None. Every finding was accepted. The follow-on local-first pivot reduced delivery back to two PRs without changing the benchmark design, so there was still no case for rejecting any of the underlying technical findings.

### What Codex did not look at

Codex's scope was the six keyed areas above. It did not evaluate: prompt-template quality for the reflection/rubric capture (R2), cost estimate accuracy, the open-source-context implications of public transcripts leaking workspace content, or whether the `--bare` flag on `claude -p` has any undocumented interaction with `--mcp-config` beyond what the help text claims. These are builder-time discoveries flagged in §11.

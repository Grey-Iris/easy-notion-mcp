# Proposal: End-to-End Testing Infrastructure for easy-notion-mcp

**Date:** 2026-04-15
**Status:** Proto-plan — captures thinking, not ready to execute
**Related:** `audit-existing-tools-for-silentf` tasuku task; PR #21 (`update_data_source`) runtime findings in `.meta/plans/update-data-source-tool-2026-04-10.md` §12
**Author context:** Written after PR #21 shipped, when the human asked whether any such infrastructure existed. It did not. This document captures the shape of what to build so the thinking isn't lost to the next session.

---

## 1. Summary

We have no reusable end-to-end testing infrastructure for the live MCP server. Every runtime probe against the real Notion API is written bespoke for the specific PR that needs it, executed once, and thrown away. This proposal captures the shape of a real E2E testing suite — why it matters, what tiers of ambition are available, and how to sequence the work.

**Recommendation:** build **Tier 1** (a single standalone smoke-test script, runnable via `npm run test:e2e`, gated on env-var credentials) as the next infrastructure investment after `create_page_from_file` / PR B lands. Defer **Tier 2** (protocol-level testing via a real MCP client) and **Tier 3** (Claude-agent-driven acceptance testing) as sequenced follow-ups. Each tier is valuable on its own; stopping at Tier 1 still puts the project miles ahead of today.

---

## 2. Current state

### 2.1 What we have

**Unit/integration tests in `tests/*.test.ts`** — 12 files, 203 tests as of PR #21. All use mocked Notion clients (hand-rolled `vi.fn()` mocks for `client.dataSources.update`, `client.databases.retrieve`, etc.). Run via `npm test`, executed in CI on every push and PR. These catch: wrapper correctness, serialization shape, parameter forwarding, empty-update rejection, schema cache behavior. They do not catch anything that requires a real Notion API response to verify.

**Transport-layer tests** — `tests/http-transport.test.ts` (27-tools-registered assertion, OAuth route presence) and `tests/stdio-startup.test.ts` (server launches without crashing). These exercise the MCP plumbing but not the tool handlers themselves against real APIs.

**CI gating** — GitHub Actions runs build + tests on Node 18 + 20 + dependency review. All of that is build-time evidence.

### 2.2 What we do NOT have

- No directory named `tests/e2e/`, `scripts/e2e/`, or similar.
- No npm script for live-API testing (`npm run test:e2e`, `npm run smoke`, etc.).
- No standing test script that exercises the 27 MCP tools against a real Notion workspace.
- No MCP client harness that would exercise tools via the actual stdio/HTTP protocol rather than by direct function import.
- No agent-driven acceptance harness.
- No catalog of known silent-failure modes. One was discovered in PR #21 (the row-reassignment behavior on removed status options) and lives only in that PR's plan file §12.

### 2.3 How we've been coping

Each PR that needs runtime evidence ends up with the builder writing a bespoke `node --env-file=.env` probe script, executing it against the human's sandbox workspace, capturing request/response bodies into the PR body or plan file, and deleting the script afterwards. This works per-PR — the 2026-04-13 `update_data_source` session is proof it *can* catch real bugs — but the cost is that every builder re-invents the probe pattern from scratch, the coverage is narrow to the PR's immediate concerns, and nothing accumulates into reusable verification infrastructure.

---

## 3. Why this matters now

Three things have converged that justify building this next, not "sometime":

### 3.1 We just discovered a silent-failure mode by luck

The `update_data_source` runtime probe in PR #21 discovered that Notion silently reassigns rows to the default group's first option when a referenced status option is removed — no error, no warning, no signal of any kind. This was not anticipated by the plan (which enumerated three outcomes; the actual observed outcome was a fourth). We caught it because Codex pushed for a row-reference test during plan review. **That was luck.** The project has 27 state-mutating tools, most of which have never been runtime-probed at all. There is no reason to believe this is the only footgun.

### 3.2 The silent-failure-modes audit needs infrastructure to run against

`audit-existing-tools-for-silentf` is a tracked tasuku task for a Pattern 6 audit pass to systematically discover silent-failure modes across the remaining 26 wrappers. Running that audit with ad-hoc throwaway scripts per wrapper is infeasible — it would mean inventing 26 different probe patterns and losing the results to session deletion. A standing E2E framework is the natural home for those audit probes and for the documented findings that emerge from them.

### 3.3 The "runtime evidence required" rule is load-bearing for this project

The orchestrator briefing in `workflow-v2/orchestrator.md` is explicit: *"for any project whose value lives in interaction with external systems, runtime evidence is required."* This project's entire value is in that interaction. The rule is load-bearing. Satisfying it with ad-hoc throwaway work is technically compliant but strategically wasteful — the requirement repeats on every PR, so infrastructure that makes the requirement cheaper pays for itself within 2-3 PRs. We're somewhere around the 4-5 PR mark already; we should have built this before PR #21, not after.

---

## 4. Tier 1 — Smoke-test script (MVP)

> **Before planning Tier 1, check the `sdk-tool-tests` tasuku task.** Its description (*"Add tests for SDK wrapper tools (comments, users…)"*) sounds adjacent to Tier 1's wrapper-coverage scope. It's possible the two tasks overlap significantly or that one partially supersedes the other. **The Tier 1 planner's first action should be to read `tk task show sdk-tool-tests` in full, decide the relationship (merge / supersede / keep both distinct), and document the decision in the Tier 1 plan's "Out of scope" or "Supersedes" section before writing any scenarios.** Don't let the two tasks drift into duplicating each other or both waiting on the other to ship.

**Shape:** A single standalone node script at `scripts/e2e/smoke.ts` (or similar), runnable via `npm run test:e2e`, gated on `NOTION_TOKEN` + `NOTION_ROOT_PAGE_ID` environment variables. Exits with a clear error (not silent pass) if either is missing.

**Why outside `tests/`:** vitest auto-discovers `tests/**/*.test.ts` and would try to run E2E against real APIs in CI, where credentials aren't (and shouldn't be) available. Keeping E2E scripts in `scripts/e2e/` with a different entry point avoids that entirely. No vitest config juggling needed.

### 4.1 Execution flow

```
1. Load .env via --env-file or dotenv
2. Assert NOTION_TOKEN and NOTION_ROOT_PAGE_ID are set; exit 1 if not
3. Instantiate @notionhq/client with the token
4. Verify credentials: client.users.me() → capture bot id, log it
5. Create a timestamped parent page under NOTION_ROOT_PAGE_ID, titled
   "e2e-run-<ISO8601>" — this is the isolation boundary
6. Run each test scenario in sequence, wrapping each in try/catch:
   - Log pass/fail and response highlights per scenario
   - On failure, capture the error object, continue to the next scenario
   - Track cumulative pass/fail counts
7. finally: trash the parent page (dogfooding update_data_source or archive_page)
8. Print summary table to stdout + write JSON dump to stdout (or a configurable path)
9. Exit code: 0 if all scenarios passed, 1 if any failed
```

### 4.2 Test scenarios for Tier 1

The MVP covers the core read-write-delete cycle for both pages and databases, plus the newly-shipped update surface. Roughly 12-15 scenarios, not all 27 tools — the long tail is deferred to the audit sweep.

**Page lifecycle:**
- `create_page` — write a page with mixed markdown (headings, list, code block, callout, toggle, task list). Exercises the markdown-to-blocks converter on realistic input.
- `read_page` — read it back; assert the markdown round-trips cleanly. Catches round-trip regressions that `tests/roundtrip.test.ts` can't (it uses fixtures, not live responses).
- `update_section` — edit a section of the page via our GFM syntax.
- `find_replace` — exercise the Notion-native-markdown editing path (distinct from update_section).
- `archive_page` → `restore_page` → `archive_page` — trash/restore round trip.

**Database lifecycle:**
- `create_database` — with schema including title, rich_text, select, multi_select, status, number, date, url, checkbox. Broad property-type coverage in one shot.
- `add_database_entry` — add three rows with realistic property values across types.
- `query_database` — query by filter, verify expected rows return.
- `update_data_source` (the new tool from PR #21) — rename a property; update status options (add one, then omit it); assert the cache-invalidation path works (subsequent `get_database` returns fresh schema).
- `archive_page` on the database.

**Integrity checks:**
- After each mutation: read back the state, assert the mutation landed.
- After status option removal: query the database, observe what happened to rows referencing the removed option. **This is the standing regression check for the PR #21 silent-reassignment footgun.** If Notion ever changes this behavior (or if our tool description warning is ever invalidated), Tier 1 will surface it.

**Cleanup:**
- At end of run (pass or fail): trash the timestamped parent page.
- On script crash mid-run: the timestamped parent page remains. A subsequent run can be told to sweep any `e2e-run-*` children under `NOTION_ROOT_PAGE_ID` older than N minutes — optional safety net, revisit in Tier 1+.

### 4.3 Output contract

The script emits:

1. **Console summary table** — one line per scenario, pass/fail + duration + key response field (e.g. page id, database id).
2. **JSON dump to stdout or a configurable path** — machine-readable, suitable for pasting into a PR body as runtime evidence or aggregating across runs.
3. **Non-zero exit code on any failure** — so `npm run test:e2e` integrates with shell-based automation even though real CI won't run it.

### 4.4 What Tier 1 does NOT cover

- **Does not exercise the MCP protocol layer.** Tool description rendering, tool schema validation, and handler dispatch are bypassed. Bugs that only manifest at that layer will not be caught. That's Tier 2.
- **Does not cover every tool.** 27 tools exist; Tier 1 covers perhaps 12-15 core ones. The long tail (`list_users`, `share_page`, `move_page`, comment tools, etc.) is deferred to Tier 2 or to the silent-failure-modes audit as it sweeps through each tool individually.
- **Does not test HTTP/OAuth mode.** Stdio only for Tier 1. HTTP-mode E2E testing is substantially harder (OAuth flow, auth tokens, bearer middleware) and deferred.
- **Does not probe rate limits, throttling, or retry behavior.** Not interesting at current volume.
- **Does not fuzz agent-likely misuse patterns.** That's Tier 3 territory.
- **Does not run in CI.** By design — real API calls in CI require secret management, and credentials for a test workspace would either be fragile or expensive. Tier 1 is a developer-local tool, runnable on demand.

### 4.5 Effort estimate

One builder session (1-2 hours of dispatch), probably Pattern 2 (Plan → Review → Build) because the test scenarios benefit from human review before a builder writes them all. The plan work is small; the scenario authorship is the interesting part.

---

## 5. Tier 2 — Protocol-level testing

**Shape:** Same execution structure as Tier 1, but instead of importing wrapper functions from `src/notion-client.ts` directly and calling them, the test harness launches the actual MCP server (stdio transport) as a child process, connects via a minimal MCP client, and issues tool calls via the protocol.

### 5.1 Why Tier 2 is meaningfully different

Tier 1 tests the wrappers. Tier 2 tests **the whole stack**:

- Tool registration in `src/server.ts`'s `tools` array
- Input schema validation (JSON Schema → runtime argument parsing)
- Handler dispatch via the switch statement in the `CallToolRequestSchema` handler
- Response serialization back to MCP protocol messages
- Error formatting when tools throw

These are real code paths with real failure modes. A wrapper function can work correctly in isolation while the tool schema is malformed, the description is wrong, or the handler forgets to forward a parameter. Tier 1 cannot catch any of that. Tier 2 can.

**Concrete example of a Tier 2-only bug:** if a builder adds a new optional parameter to a wrapper but forgets to declare it in the tool's `inputSchema`, Tier 1's direct wrapper call will work fine. Tier 2's protocol-level call will either reject the argument or silently drop it, matching what a real agent would experience.

### 5.2 What Tier 2 needs that Tier 1 doesn't

- A minimal MCP client — probably via the `@modelcontextprotocol/sdk` package's client API, which this project already depends on (look at `http-transport.test.ts` for an existing client pattern, though that test uses HTTP; stdio client is a new shape).
- Child process management for spawning the stdio server as a subprocess.
- JSON-RPC message formatting and response parsing (the SDK handles this, but error paths can be tricky).
- Timeout handling for tool calls.

Not enormous effort, but non-trivial. 2-3 builder sessions, probably.

### 5.3 Open question for Tier 2

Should Tier 2 *replace* Tier 1, or run alongside it? Replacement is cleaner long-term (one harness, one set of scenarios) but Tier 1 has value as a faster-feedback loop during development. Probably keep both for a while; consolidate later if duplication hurts. Revisit during Tier 2 planning.

---

## 6. Tier 3 — Claude-driven acceptance testing (the killer version)

**Shape:** Tier 2 plus a Claude agent harness that actually drives the MCP through tool-use calls. The agent sees the tools the same way a real downstream agent would — via the protocol, with tool descriptions as its only guidance.

### 6.1 The premise

Hand-written tests (Tier 1 and Tier 2) exercise exactly the tool-call sequences the test author imagined. Real agents don't do that. Real agents misread tool descriptions, construct ambiguous argument shapes, try combinations nobody documented, retry failed calls with slightly different inputs. **The only way to find out whether your tool descriptions actually work for agents is to have an agent try them.**

Tier 3 spawns a Claude agent (via `mcp-agents` or directly via the Anthropic SDK), connects it to a running instance of easy-notion-mcp, and gives it **natural-language tasks** like:

- *"Create a database called 'Tasks' with a Status property, then add three tasks to it."*
- *"Take the database you just created and rename the Status property to WorkflowState."*
- *"Add a new Blocked option to the WorkflowState property without removing any existing options."*
- *"Remove the Blocked option from WorkflowState. What happens to tasks that had that status?"*

The harness watches the agent's tool calls, the MCP server's responses, and the final workspace state. It asserts on:

1. Did the agent complete the task or get stuck?
2. If stuck, what tool description wording was the blocker? (Lookup: the agent's last-attempted tool call vs. what the description said)
3. Did the final workspace state match the task's intent?
4. Did the agent notice the row-reassignment footgun on the "remove Blocked option" task — or silently lose data and call it done?

### 6.2 Why Tier 3 is the killer version

- **Catches UX bugs in tool descriptions that hand-written tests miss.** If an agent can't figure out how to call a tool from the description alone, the description is broken. We would never know from Tier 1 or Tier 2.
- **Discovers silent-failure modes organically.** An agent-driven test of "remove an option that rows reference" would have caught the PR #21 footgun without anyone needing to write a specific probe for it. The agent would have tried it, the workspace state would have drifted, the harness's end-state assertions would have flagged it.
- **Tests the full loop.** The MCP server's entire purpose is to be used by agents. The most faithful test is one that uses it exactly that way.
- **Regression-resilient under description changes.** When we update a tool description (e.g. adding the row-reassignment warning we just added in PR #21), Tier 3 can re-run the same task and check whether the new wording prevents the footgun in practice. That's an impossible-to-fake correctness signal — either the new warning works on a real agent or it doesn't.
- **Surfaces description quality over time.** Which tools does the agent always succeed at? Which does it consistently get stuck on? That's direct feedback on description quality and can drive future edits.

### 6.3 Why Tier 3 is hard

- **Claude agents are non-deterministic.** The same task run twice may produce different tool-call sequences. Tests must assert on end-state and intent, not exact trajectories. Writing good end-state assertions is a skill.
- **Each run costs real tokens and real Notion API calls.** Not cheap to run frequently. Probably a "run on demand before shipping big changes" tool, not a pre-commit check.
- **Flakiness risk is higher:** transient API failures, rate limits, agent hallucinations, ambiguous language, agents getting confused by their own previous tool calls.
- **Authoring tasks is editorial, not mechanical.** Bad tasks produce uninformative tests. "Create a database" is too broad; "create a database with this exact schema" is too narrow. The right fidelity depends on what we're trying to catch.
- **Handling "agent tried and failed" vs. "agent completed correctly" correctly.** A failure to complete a task is sometimes a tool bug, sometimes an agent bug, sometimes a task-specification bug. Triage takes judgment.

### 6.4 Effort estimate

3-4 builder sessions minimum, plus ongoing curation of the task set. Probably an Overseer-led initiative (Pattern 5) because it's multi-phase: task authorship → harness build → initial run → triage findings → iterate. Don't build this in one shot.

---

## 7. Recommended sequencing

1. **PR B (`create_page_from_file` + `transport` flag)** — already queued, land first. Unrelated in content but blocks nothing else.
2. **Tier 1 E2E smoke-test script** — land second. Natural follow-up to PR B because the new file-based create tool is an obvious thing to smoke-test, and Tier 1 makes that trivial rather than ad-hoc.
3. **`audit-existing-tools-for-silentf`** — the silent-failure-modes audit. Runs against Tier 1 infrastructure (fills in scenarios for each audited tool) and outputs new warnings that land as subsequent tool-description PRs.
4. **Tier 2 protocol-level harness** — land after the audit, informed by what the audit discovered about which failure modes need protocol-level vs. wrapper-level coverage.
5. **Tier 3 Claude-driven acceptance** — the ambitious version. Land when the project is stable enough that agent-driven fuzz-testing won't just surface known-shipped issues.

### 7.1 Why this sequencing

- **Tier 1 before the audit** because the audit needs somewhere to live. Running an audit against ad-hoc throwaway scripts defeats the purpose.
- **Tier 2 after the audit** because we don't yet know which protocol-layer bugs matter most, and the audit will teach us. Building Tier 2 before we know what to test with it is speculative.
- **Tier 3 last** because it's the most expensive, the most fragile, and benefits from everything before it. Running agent-driven tests against a server with known unpatched silent-failure modes is a waste of tokens.
- **Each tier is valuable on its own.** If we stop at Tier 1, the project is still far ahead of today. If we never build Tier 3, Tiers 1 and 2 still catch most real bugs. This is deliberate — the work is composable, not all-or-nothing.

---

## 8. Open questions

Things that aren't settled and should be decided during Tier 1 planning:

- **Where does Tier 1 live in the repo?** `scripts/e2e/`, `tests/e2e/` (with vitest exclusion), or a top-level `e2e/`? Each has tradeoffs; no strong preference yet.
- **Should Tier 1's scenarios be a single script or a set of smaller files?** Single script is simpler to start; multi-file is easier to maintain as scenarios accumulate. Probably start single and split when it hurts.
- **What's the cleanup safety net strategy?** The "sweep any `e2e-run-*` children older than N minutes at the start of every run" idea is appealing but adds complexity. Alternative: just trust the `finally` block and deal with leaks manually. Revisit after Tier 1 ships and we've seen it in practice.
- **Should Tier 1 run against a dedicated test workspace, or the same sandbox page the human uses for ad-hoc probes?** Dedicated workspace is cleaner but requires another Notion workspace setup. Sandbox page is lower-friction. Default to sandbox page unless we find a reason.
- **Should Tier 1 also double as a CI smoke test against a test Notion workspace with a test token?** That would be amazing but requires secret management and tolerates the brittleness of real-API CI. Probably defer indefinitely — developer-local is the right default.
- **How do we handle OAuth/HTTP-mode testing eventually?** Not a Tier 1 concern, but worth noting that the deferred work is non-trivial because OAuth flows are hard to script.

---

## 9. What this proto-plan is NOT committing to

- Not committing to specific scenario count or coverage percentage
- Not committing to Tier 2 or Tier 3 actually happening — only recommending them
- Not committing to a specific directory structure or file naming
- Not committing to effort estimates being accurate under 20% error
- Not committing to not revising this proposal substantially once Tier 1 is in flight

This is a proto-plan, not a plan. When we're ready to build Tier 1, a real plan will get written (Pattern 2) that revises, specifies, and grounds this in concrete file changes.

---

## 10. Related work

- **`sdk-tool-tests`** — tracked tasuku task, pre-existing before this proposal: *"Add tests for SDK wrapper tools (comments, users…)"*. Adjacent scope to Tier 1. Relationship between the two is unresolved — could overlap, could be complementary, could partially supersede. **Deconflict at Tier 1 plan time, not at build time.** See the callout at the top of §4.
- **`audit-existing-tools-for-silentf`** — tracked tasuku task; depends on Tier 1 being in place for efficient execution.
- **PR #21 (`update_data_source`)** — the runtime finding that motivated this proposal is documented in `.meta/plans/update-data-source-tool-2026-04-10.md` §12 (the row-reassignment outcome).
- **Orchestrator briefing** (`workflow-v2/orchestrator.md`) — the "runtime evidence required" rule this proposal operationalizes.
- **PR B** (`create_page_from_file` + `transport` flag, queued) — lands before Tier 1 per §7 sequencing.
- **Session handoff 2026-04-10** — the stale-worktree `npm test` pollution gotcha is indirectly relevant: a standing E2E suite needs its own worktree discipline to avoid similar pollution at the integration-test level.

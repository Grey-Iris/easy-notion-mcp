# Bench A Followups Build Report

**Branch:** `feat/bench-a-followups-2026-04-24`
**Base:** `dev` at `873618d`
**Date:** 2026-04-24

## Changes

### 1. Verification-level EC retry (runner.ts)

Added `verifyWithRetry()` -- a retry loop around the entire verification phase
(ground truth + assert.ts). When the agent succeeds but verification fails,
the runner waits and retries up to `VERIFY_RETRY_ATTEMPTS` (5) times with
`VERIFY_RETRY_BACKOFF_MS` (3000ms) backoff.

**Why 5x3s = 15s:** The existing SDK-level retries in `verifier.ts` (3x2s)
only fire on thrown exceptions (API errors), not on stale data from eventual
consistency. A verification-level retry catches the EC case: all API calls
succeed but return data that hasn't propagated yet. 5 attempts at 3s gives a
15-second window, which comfortably covers Notion's typical propagation delay
for cross-database references (relations, rollups).

The function is exported and independently testable. It's wired into
`runScenario` only for the success path -- timeout and process-exit failures
skip retries since they can't be helped by waiting.

### 2. Per-claim manifest logging (types.ts, manifest.ts)

Added `ManifestClaim` type and `claims` array to each scenario entry in
`RunManifest`. Each claim records: `kind` (e.g., "databases[0]", "rows[1]",
"assert.ts"), `index`, `status` ("pass"/"fail"), and `reason` (message on
failure, omitted on pass).

This means every future bench run produces a manifest that immediately shows
which specific claim failed and why, without needing a re-run with extra
logging.

### 3. Scenario 10 re-run results

**Result: FAIL** -- but NOT from eventual consistency.

Run manifest: `.meta/bench/runs/run-2026-04-24-873618d.manifest.json`

Per-claim breakdown:
| Claim | Status | Reason |
|---|---|---|
| databases[0] | pass | |
| databases[1] | pass | |
| rows[0] | pass | |
| rows[1] | pass | |
| tools_must_be_called | pass | |
| assert.ts | **fail** | `ctx.notion.databases.query is not a function` |

**All 5 ground truth claims pass on the first attempt.** No EC retries
needed. The sole failure is in `assert.ts` (scenario 10's custom assertion)
which calls `ctx.notion.databases.query()` -- a method that does not exist
on the `@notionhq/client` Client object in this project's version.

**Diagnosis:** The PR-A1 scenario 10 failure was caused by a code bug in
`assert.ts`, not by eventual consistency, substring collision, or verifier
edge cases. The assert.ts file calls `ctx.notion.databases.query()`
directly but needs to use the project's `queryDatabase` wrapper from
`notion-client.ts`, or the raw Notion SDK method may not be exposed at the
`databases.query` path in this version.

**Tasuku update:** `bench-scenario-10-verification-debug` should remain
open with the new root cause identified. The fix is straightforward (update
assert.ts to use the correct API) but is a separate change per task scope.

## Evidence

### npm run build
```
> easy-notion-mcp@0.5.0 build
> tsc
```

### Harness tests (37/37 pass)
```
 tests/bench/harness/dispatch.test.ts    (4 tests)   25ms
 tests/bench/harness/verifier.test.ts    (15 tests)  63ms
 tests/bench/harness/manifest.test.ts    (7 tests)   17ms
 tests/bench/harness/runner.test.ts      (5 tests)   331ms
 tests/bench/harness/loader.test.ts      (6 tests)   669ms

 Test Files  5 passed (5)
      Tests  37 passed (37)
```

### Full test suite (39/40 pass)
```
 Test Files  1 failed | 39 passed (40)
```
The 1 failure is pre-existing: `tests/e2e/live-mcp.test.ts > C6: unique_id
schema with prefix` -- unrelated to this change.

### Scenario 10 re-run
```
Scenario                  Status  Duration  Cost
------------------------------------------------
project-portfolio-rollup  FAIL    118.2s    $0.234
------------------------------------------------
Passed 0, failed 1, skipped 0, total cost $0.234
Manifest: .meta/bench/runs/run-2026-04-24-873618d.manifest.json
```

### git diff --stat dev..HEAD
```
 tests/bench/harness/manifest.test.ts | 136 +++++++++++++++++++++++++++++-
 tests/bench/harness/manifest.ts      |   8 ++-
 tests/bench/harness/runner.test.ts   | 139 ++++++++++++++++++++++++++++++++
 tests/bench/harness/runner.ts        | 114 +++++++++++++++------------
 tests/bench/harness/types.ts         |   8 +++
 5 files changed, 360 insertions(+), 45 deletions(-)
```

## Codex session
Session name: `bench-followups-tdd`

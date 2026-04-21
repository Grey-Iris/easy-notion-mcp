# E2E teardown robustness + standalone sweeper

Plan ID: `e2e-teardown-robustness`
Author: planner session (2026-04-21)
Status: pre-build — awaiting James review + builder dispatch
Tasuku ref: `tk task show e2e-teardown-robustness`
Design context: `.meta/plans/tier1-e2e-harness-2026-04-20.md` §8 (Teardown robustness)

---

## 1. TL;DR

- `tests/e2e/helpers/sandbox.ts:54-84` (`archivePageIds`) currently logs *every* non-200 archive as "unexpected" — three Notion archive-model edge cases pollute the log with false worry. Fix: pure-function classifier + per-class counted logging.
- New file `tests/e2e/helpers/archive-errors.ts` — substring classifier over the enhanced Notion error message, three tolerated classes (`already_archived`, `archived_ancestor`, `not_found`) and one fallthrough (`unexpected`).
- New file `scripts/e2e/sweep-stale.ts` — standalone dry-run-default sweeper that spawns `dist/index.js`, uses `search` + `list_pages` to find stale E2E sandboxes outside a live test run, archives depth-first, shares the same classifier.
- New `package.json` scripts: `test:e2e:sweep` (dry-run) and `test:e2e:sweep -- --apply`.
- TDD-first: unit tests for the classifier red→green first, then the integration test for `sandbox.ts`, then the sweeper shape test. Live sweeper probe is optional and gated behind the E2E env guard.
- **Risk:** The three tolerance strings are empirical (from James's prior live run). If Notion rewords them even slightly we silently demote a real bug to "tolerated." Mitigated by the always-on teardown summary line that makes class-count regressions visible in CI logs.
- **Effort:** ~2–3 focused hours for a builder (classifier 30m + sandbox wiring 20m + sweeper 60m + TDD 40m + CI verification 20m). Add a 1h buffer for Notion-side surprises. See §10.

**Scope note from Codex review:** the sweeper as originally drafted assumed it could traverse descendants of arbitrary block types and verify root archival state via MCP. Those tools don't expose enough (`list_pages` returns only `child_page` blocks; `search` returns only the immediate parent id; `read_page` does not surface `in_trash`). Scope is therefore narrowed: the sweeper walks `child_page` descendants of direct children of `E2E_ROOT_PAGE_ID` only, warns on out-of-root `search` hits without acting on them, and does not attempt to detect an archived root (operators must restore/recreate manually if that happens). See §4.2, §4.3, §11.

---

## 2. Error classification scheme

### 2.1 The three tolerated classes

| Class | Notion error substring (within the enhanced message) | Notion `code` | Why it happens during teardown |
|---|---|---|---|
| `already_archived` | `Can't edit block that is archived` | `validation_error` | A test archived a page explicitly mid-run (e.g. `live-mcp.test.ts:625-660` archives `scratchParent`), then teardown tries to archive the same id again. |
| `archived_ancestor` | `Can't edit page on block with an archived ancestor` | `validation_error` | The reverse-order archive in `archivePageIds` trashes a parent first; its still-live descendants (e.g. the `scratchChild` from the KNOWN GAP test, whose parent was archived mid-test) then reject cleanup. |
| `not_found` | `Could not find page with ID` | `object_not_found` | A page we think we created is no longer retrievable — either Notion has already hard-deleted a long-trashed page or a manual/parallel sweep beat us to it. |

**String source:** empirical — James observed these three verbatim during the aborted inline attempt that produced learning `[4eda40]`. The `validation_error` + "Can't edit block that is archived" pairing is also independently documented in `.meta/research/frame-6-driftracker-2026-04-17.md:186` and `:315`. The `object_not_found` + "Could not find page with ID" pairing is documented in `.meta/audits/url-as-id-errors-2026-04-09.md:25` and `:60-61`. The `archived_ancestor` string is taken directly from the tasuku task spec; we are not inventing it. A builder TODO is to confirm it live once on a constructed fixture (parent archived → child archive attempted) and file a follow-up if Notion's wording has shifted.

### 2.2 Why substring match and not exact match

The error string surfaced to `archivePageIds` has been post-processed by `src/server.ts:426-452` (`enhanceError`):
- `validation_error` ⇒ appends ` Check property names and types with get_database.`
- `object_not_found` ⇒ appends ` Make sure the page/database is shared with your Notion integration.`

The classifier therefore searches for the Notion substring, not the whole enhanced string. That hint text is misleading for teardown errors (it's aimed at property-name mistakes and integration-sharing misconfigurations), but *rewriting* `enhanceError` is out of scope for this PR — see §8.

### 2.3 Public API of `archive-errors.ts`

```ts
// tests/e2e/helpers/archive-errors.ts
export type ArchiveErrorClass =
  | "already_archived"
  | "archived_ancestor"
  | "not_found"
  | "unexpected";

export interface ClassifiedArchiveError {
  class: ArchiveErrorClass;
  raw: string;          // the exact error string we received
  id: string;           // page id this error relates to (for logging)
}

export function classifyArchiveError(
  id: string,
  rawError: string,
): ClassifiedArchiveError;

/**
 * Whether a class counts as a tolerated teardown outcome (no loud log,
 * no failure signal). "unexpected" is the only false return.
 */
export function isToleratedArchiveClass(cls: ArchiveErrorClass): boolean;
```

The file is pure — no imports from vitest, no process state, no global side effects. That keeps it reusable from the sweeper script.

**Precedence of matches.** The ordering inside `classifyArchiveError` must be:

1. `archived_ancestor` — tested first because the `Can't edit page on block with an archived ancestor` substring is the narrower phrase and must not be shadowed by a broader match.
2. `already_archived` — `Can't edit block that is archived`.
3. `not_found` — `Could not find page with ID`.
4. Fallthrough → `unexpected`.

Matching is case-sensitive (Notion's messages are consistent-case) and uses `String.prototype.includes`. No regex — defense against inadvertent metacharacters in future Notion wording bumps.

### 2.4 Log shape (teardown path)

Current output (one line per failure, same log line whether benign or real):

```
[e2e] archive_page failed for <id>: <message>
```

Replace with:

- **No per-id lines for success or tolerated outcomes.** Their counts appear in the summary line. This keeps teardown output O(1) regardless of how many pages a test run creates.
- **Per unexpected failure: keep the loud line** — `[e2e][teardown] UNEXPECTED archive_page failure for ${id}: ${message}` using `console.error`. Reserve `UNEXPECTED` as a grep-friendly sentinel.
- At the end of `archivePageIds`, append a single summary line via `console.warn` (non-error stream because most runs will have `unexpected=0`):
  ```
  [e2e][teardown] cleanup summary: archived=N already_archived=A archived_ancestor=B not_found=C unexpected=D
  ```
  Always emitted, including when all counts are zero (makes the test run auditable).

The returned shape must change to carry the counts so tests can assert on it:

```ts
export async function archivePageIds(
  client: McpStdioClient,
  ids: string[],
): Promise<{
  archived: string[];
  tolerated: ClassifiedArchiveError[];   // flat list across all tolerated classes
  unexpected: ClassifiedArchiveError[];  // formerly "failed" — now narrower
  summary: {
    archived: number;
    already_archived: number;
    archived_ancestor: number;
    not_found: number;
    unexpected: number;
  };
}>;
```

This is a breaking return-shape change. `tests/e2e/live-mcp.test.ts:283-289` reads `cleanup.failed` and must be updated in the same PR to read `cleanup.unexpected` (same semantics — the list of things that actually concern us).

---

## 3. `sandbox.ts` changes

### 3.1 Call sites touched

Only `archivePageIds` (lines 54-84) and its implicit consumer `afterAll` in `tests/e2e/live-mcp.test.ts:280-293`. `createSandbox` (lines 10-35) and `archiveSandbox` (lines 37-52) are untouched — they are single-target, throw-on-error, and not part of the noisy-teardown path.

### 3.2 Diff shape (illustrative — builder writes final)

```ts
import { classifyArchiveError, isToleratedArchiveClass } from "./archive-errors.js";

export async function archivePageIds(
  client: McpStdioClient,
  ids: string[],
): Promise<ArchivePageIdsResult> {
  const archived: string[] = [];
  const tolerated: ClassifiedArchiveError[] = [];
  const unexpected: ClassifiedArchiveError[] = [];

  for (const id of [...ids].reverse()) {
    let rawError: string | null = null;
    try {
      const response = await callTool<Record<string, unknown> | ToolError>(
        client,
        "archive_page",
        { page_id: id },
      );
      if (isToolError(response)) {
        rawError = response.error;
      } else {
        archived.push(id);
      }
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }

    if (rawError === null) continue;

    const classified = classifyArchiveError(id, rawError);
    if (isToleratedArchiveClass(classified.class)) {
      tolerated.push(classified);
      // No per-id log: the count appears in the summary line below.
    } else {
      unexpected.push(classified);
      console.error(`[e2e][teardown] UNEXPECTED archive_page failure for ${id}: ${rawError}`);
    }
  }

  const summary = buildSummary(archived, tolerated, unexpected);
  console.warn(
    `[e2e][teardown] cleanup summary: ` +
      `archived=${summary.archived} ` +
      `already_archived=${summary.already_archived} ` +
      `archived_ancestor=${summary.archived_ancestor} ` +
      `not_found=${summary.not_found} ` +
      `unexpected=${summary.unexpected}`,
  );

  return { archived, tolerated, unexpected, summary };
}
```

Note the **unconditional summary line** — even on fully-green runs, the summary prints `archived=N ... unexpected=0`. This makes the teardown behavior visible in CI logs and gives us a single grep target to detect regressions.

### 3.3 `live-mcp.test.ts` change

Replace `cleanup.failed` with `cleanup.unexpected` at lines 284-288. The log wording stays loud for the unexpected-only case:

```ts
const cleanup = await archivePageIds(client, ctx.createdPageIds);
if (cleanup.unexpected.length > 0) {
  console.error(
    `[e2e] cleanup UNEXPECTED failures: ${JSON.stringify(cleanup.unexpected)}`,
  );
}
```

No test expectations change — `afterAll` in this suite is purely side-effectful (it never `expect()`s cleanup results).

### 3.4 What does NOT change

- `createSandbox`, `archiveSandbox`, the `createdPageIds` tracking pattern, the reverse-order iteration — all untouched.
- `src/server.ts` `archive_page` tool handler — no server-side changes.
- `src/notion-client.ts` `archivePage` — no client-side changes.
- `enhanceError` — keeps appending its hint strings (§8 scope).
- Notion-Version pin — stays at `2025-09-03`. `pages.update({in_trash: true})` uses the already-migrated `in_trash` field (per `project_notion_version_pin.md`); no version interaction here.

---

## 4. `scripts/e2e/sweep-stale.ts` design

### 4.1 Purpose & steady-state role

The tasuku task note: *"search automatically hides pages with archived ancestors, so sweeper is mostly a safety net."* That's accurate — in normal operation the in-test `archivePageIds` + Notion's auto-hide of descendants of archived ancestors means the workspace tree stays clean on its own. The sweeper earns its keep in three specific scenarios:

1. **Hard kill** — vitest killed by SIGKILL / OS OOM / CI cancel before `afterAll` ran. Sandbox parent and all descendants remain live, hidden from nothing.
2. **Teardown unexpected** — a genuine `unexpected` error in `archivePageIds` stopped the loop before it reached the sandbox parent.
3. **Partial orphan** — a test created a sub-sandbox, archived its parent mid-run (like the KNOWN GAP test at `live-mcp.test.ts:625-660`), but teardown hit an unexpected error before sweeping the descendants. `search` hides descendants of archived ancestors so they *look* gone in UI, but they're still live and counted against workspace quotas until the ancestor is permanently deleted.

The sweeper exists for scenarios 1 and 2 primarily. Scenario 3 is best-effort; see §4.6.

### 4.1.1 Scope cap — what the sweeper can and cannot do (post-Codex-review)

The current MCP tool surface (`list_pages`, `search`, `read_page`) does not expose enough metadata to run a fully recursive, ancestry-verified sweep:

- [src/server.ts:1273](../../src/server.ts) `list_pages` returns only blocks whose type is `child_page`. It omits `child_database`, `link_to_page`, `synced_block`, and similar. **The sweeper only archives child pages under E2E sandboxes. Orphaned child databases and similar non-page descendants are out of scope for this PR.** In practice E2E tests rarely create databases inside sandboxes (one KNOWN GAP test does: see `live-mcp.test.ts:381-476`), so the miss is small. Follow-up task: expand `list_pages` or add a new tool that lists child databases; file as `e2e-sweep-stale-child-databases` when the miss is observed.
- [src/server.ts:1263](../../src/server.ts) `search` flattens result parents to a single id string. It cannot prove ancestry beyond that single hop. **The sweeper therefore treats `search` as a diagnostic only: if it finds an `E2E:`-titled page outside `E2E_ROOT_PAGE_ID`'s direct children, it logs a SKIP warning and takes no action.** The authoritative source of candidates is `list_pages(E2E_ROOT_PAGE_ID)`.
- [src/server.ts:1147](../../src/server.ts) `read_page` does not return `in_trash` or the parent metadata. **The sweeper cannot detect an archived E2E_ROOT via MCP.** We rely on the fact that archiving the root intentionally would be a highly visible act by an operator; if it happens by accident, `list_pages(E2E_ROOT_PAGE_ID)` will itself fail with `object_not_found` or similar, which we can surface as an explicit exit code.

### 4.2 Search strategy: spawn `dist/index.js`, not in-repo import

Pick: **spawn a fresh `node dist/index.js` subprocess via `McpStdioClient`**, identical to `tests/e2e/live-mcp.test.ts`. Rationale:

- Dogfood via the MCP surface (`feedback_editing.md`, learning `[5b1f50]`). Using the same tool surface that agents use catches protocol-level bugs the sweeper wouldn't see via direct SDK imports.
- Consistency with the test harness — one shape, one failure mode. A dual-path sweeper ("sometimes in-process, sometimes via MCP") would drift.
- Reuses `classifyArchiveError` transparently — the MCP `archive_page` tool emits the `enhanceError`-processed message, which is what the classifier is tuned for. Importing the SDK directly would give us the *raw* Notion messages, which would mean a second classification path.
- No impact on the in-repo server — the subprocess boots read-only over stdio, same as any client.

The sweeper imports `McpStdioClient` and `callTool` from `tests/e2e/helpers/` — a scripts-to-tests import direction is unusual but acceptable here because the helpers are pure and already exported as modules. No change to `tsconfig.json` (both directories resolve under the root `ts` config; `tsx` handles loading).

**Alternative considered and rejected:** using `@notionhq/client` directly from within the sweeper. Faster startup, no subprocess — but it would require a parallel classifier tuned to raw Notion messages, and it would bypass the very code path (`enhanceError`, the MCP tool routing) we want evidence for.

### 4.3 Discovery algorithm (scoped to the constraints in §4.1.1)

```
inputs: NOTION_TOKEN, E2E_ROOT_PAGE_ID, --apply flag
1. Spawn dist/index.js via McpStdioClient (same helper as tests).
2. Probe the root with list_pages(E2E_ROOT_PAGE_ID).
   - If list_pages succeeds: proceed.
   - If list_pages throws / returns an error that classifies as `not_found` or
     matches the `restricted_resource` phrasing → exit 3, loud message telling the
     operator to verify E2E_ROOT_PAGE_ID is correct, not archived, and shared
     with the bot. Do NOT attempt any sweeping.
   - Any other error → exit 4, log the raw message.
   (We cannot verify `in_trash` state on the root via MCP — see §4.1.1. If the
    operator archived it, list_pages will fail with not_found for its children,
    which is caught above.)
3. candidates = []
   a. For each direct child returned by list_pages where the child's title
      matches /^E2E: /, candidates.push(child.id, child.title).
   b. Diagnostic-only: call search(query="E2E:", filter="pages"). For each hit
      whose id is NOT in the candidates set, log:
        "[sweep] SKIP (unverified ancestry): <id> <title>"
      No archive action — `search` exposes only one parent hop and cannot prove
      the hit is actually a stale E2E artifact (§4.1.1).
4. For each candidate, walk child-page descendants depth-first via list_pages:
     stack = [candidate]
     order = []   // deepest-first order
     visited = Set()
     while stack not empty:
       page = stack.pop()
       if page.id in visited: continue
       visited.add(page.id)
       order.unshift(page)         // prepend so parents archive last
       children = list_pages(page.id)
       for each child: stack.push(child)
       depth guard: refuse to recurse past depth 10, log an error and break out
   archiveOrder = concatenation of per-candidate orders (dedup by id across the
   final list).
5. Print the archive plan (tree + total count). In dry-run (default), stop. Exit 0.
6. With --apply:
   - Per-id archive via callTool, classify errors with the shared helper.
   - Only log per-id lines for UNEXPECTED classifications:
       [sweep] UNEXPECTED <id>: <message>
   - Do NOT log per-id lines for successes or tolerated outcomes — the counts
     appear in the summary. (Avoids O(n) log noise on large sweeps; Codex
     review feedback.)
   - Always print a final summary line:
       [sweep] summary: archived=N already_archived=A archived_ancestor=B not_found=C unexpected=D skipped_unverified=S
7. Exit code: 0 if unexpected == 0, 4 otherwise.
```

**`rate_limited` note:** if Notion throttles us mid-sweep, the MCP error flows as `"Notion rate limit hit. Wait a moment and retry."` per `enhanceError`. The classifier falls through to `unexpected` for this string (it contains none of the three tolerated substrings). That's deliberate: rate-limit hits are transient-but-loud, the operator sees the `UNEXPECTED` count and reruns after the limit window. The sweeper does not auto-retry. Document this in the script's header comment so the reader isn't surprised.

### 4.4 CLI shape

```
npx tsx scripts/e2e/sweep-stale.ts          # dry-run, prints plan
npx tsx scripts/e2e/sweep-stale.ts --apply   # execute the plan
```

**Flag set (minimal — resist growth):**

- `--apply` — default false. When false, discovery + plan-print + exit 0.
- `--help` / `-h` — prints usage and exits 0. Any other unknown flag prints usage and exits 2 (strict).
- (No other flags in MVP. No `--root`, no `--match`, no `--older-than` — simpler is better; these can be added in a follow-up if the sweeper grows real usage.)

**Env:** `NOTION_TOKEN` + `E2E_ROOT_PAGE_ID` both required. Missing either → exit 2 with an actionable message. The script loads `dotenv/config` at the top (matches `scripts/e2e/mcp-spike.ts` and `scripts/test-live.ts`).

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Dry-run success, or apply-run with zero unexpected errors, or `--help` |
| 2 | Local precondition failure: missing `NOTION_TOKEN`, missing `E2E_ROOT_PAGE_ID`, missing `dist/index.js`, or unknown CLI flag |
| 3 | Remote root-boundary refusal: `list_pages(E2E_ROOT_PAGE_ID)` returned `not_found` / `restricted_resource` / any error implying the root is unreachable or unshared. Sweeper refuses to proceed. |
| 4 | Apply-run completed (or root probe hit an unclassified error) and at least one `unexpected` archive error was counted |

Codes 2 and 3 are intentionally disjoint: 2 = something the operator can fix locally in their shell; 3 = something the operator must fix in the Notion UI.

### 4.5 Shared classifier

Import from `../../tests/e2e/helpers/archive-errors.js`. One file. One source of truth. Updating the classifier updates both callers. No duplicated string literals.

### 4.6 Descendant depth limits + pagination

- `list_pages` calls `listChildren` which in turn calls `blocks.children.list`. `src/notion-client.ts` already paginates that (`hasMore` loop) — the MCP tool returns a complete list in one response. Good.
- **Cap recursion depth at 10** with a loud error if exceeded. E2E sandboxes are shallow by design (root / sandbox / test-created pages / occasionally one nested child). Depth 10 is a defensive ceiling against a pathological cycle (not known to occur in Notion but cheap to guard).
- **Cap total pages visited at 500 per sweep.** If we exceed, log and refuse to `--apply` — the sweeper is a mop, not a hammer; a 500-page sweep means something else is wrong. (Human threshold, not a test threshold — visible number, not load-bearing.)

### 4.7 No rename-on-failure

Consistent with the tier-1 plan §8.5: the sweeper does not rename pages with a `leaked:` prefix. It archives them or it doesn't — no intermediate renaming that adds API calls which can also fail.

---

## 5. `package.json` script entry

Add two thin wrappers under `scripts`:

```json
"test:e2e:sweep": "tsx scripts/e2e/sweep-stale.ts",
"test:e2e:sweep:apply": "tsx scripts/e2e/sweep-stale.ts --apply"
```

Rationale for the second key rather than relying on `npm run test:e2e:sweep -- --apply`: npm's `--` parsing is surprising to some users and documenting the apply form as its own key makes "am I about to archive?" unambiguous in shell history. Both are documented in the script's own `--help` output (which the builder should add).

**New devDependency:** `tsx` (pinned to the version already resolving in `package-lock.json` as a transitive dep — ~`^4.8.1`). Promoting it to a direct `devDependencies` entry locks the invocation contract and avoids "works on my machine because a parent dep happens to pull tsx 4.x."

---

## 6. Test approach (TDD — learning `[e9dcf6]`)

**Order matters:** tests first, failing, then implementation. The builder must paste the failing-test output into the PR before the implementation diff.

### 6.1 Classifier unit tests — `tests/e2e/helpers/archive-errors.test.ts` (new)

Six fixtures, one per case:

| # | Input `rawError` | Expected class |
|---|---|---|
| 1 | `Can't edit block that is archived. You must unarchive the block before editing. Check property names and types with get_database.` | `already_archived` |
| 2 | `Can't edit page on block with an archived ancestor. Check property names and types with get_database.` | `archived_ancestor` |
| 3 | `Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.` | `not_found` |
| 4 | `MCP request timeout: archive_page` | `unexpected` |
| 5 | Empty string `""` | `unexpected` |
| 6 | `body failed validation: rich_text[0].text.content.length should be ≤ 2000` | `unexpected` |

Plus one precedence test: an input containing BOTH `archived ancestor` and `archived` must classify as `archived_ancestor` (§2.3 precedence rule).

Mutation-test equivalents the builder must verify by hand (paste output as evidence):

- Swap the `archived_ancestor` → `already_archived` ordering in the classifier → at least one test must flip red. (Validates §2.3 precedence.)
- Remove the `unexpected` fallthrough → at least one test must flip red. (Validates completeness.)
- Change `includes` to `===` → most tests flip red. (Validates we're not matching exactly.)

These mutation checks don't need to live as automated mutation tests — paste-output in the PR description is sufficient for an MVP. If the builder wants to add `stryker-mutator` as a proper mutation-testing harness, that's a separate PR; not in scope.

### 6.2 `sandbox.ts` integration test — `tests/e2e/helpers/sandbox.test.ts` (new)

Uses vitest's native mocking against a stub `McpStdioClient`. This is a **unit** test (no real Notion) — it runs inside `npm test`, NOT `npm run test:e2e`.

Cases:

| Scenario | Mocked `archive_page` response | Asserted return |
|---|---|---|
| All clean | `{archived: id}` for every id | `unexpected.length === 0`, `tolerated.length === 0`, `archived.length === ids.length`, single summary log line |
| Mix of tolerated | 1 success + 1 `already_archived` + 1 `archived_ancestor` + 1 `not_found` | `archived.length === 1`, `tolerated.length === 3` (one per class), `unexpected.length === 0`, summary line counts correct, NO per-id log lines emitted for the tolerated entries (assert via spy on `console.warn`/`console.error` — only the one summary line should appear) |
| Real failure | 1 success + 1 genuine validation error (e.g. rate_limited) | `unexpected.length === 1`, loud-log fired with `UNEXPECTED` marker |
| Thrown (not returned) error | `callTool` throws an `Error("network down")` | `unexpected.length === 1` (throw path also classified) |

Stub surface: fake `McpStdioClient` whose `request` returns the scripted sequence. Or — simpler — mock the `callTool` import via `vi.mock("./call-tool.js")` and hand it a mock implementation. Builder picks whichever reads cleanest; `vi.mock` is the shorter path.

### 6.3 Sweeper tests — `scripts/e2e/sweep-stale.test.ts` (new, unit only)

**Full live-Notion integration is intentionally NOT a requirement.** Rationale: a live sweep requires a real token with a known-dirty state, which means flaky CI setup for a script that's already a safety net. Better to keep the sweeper's tests fast and deterministic.

Cases (all mock the MCP client):

| Scenario | Assertion |
|---|---|
| No stale candidates | `archived=0, tolerated=0, unexpected=0`, exit 0 on both dry-run and apply |
| 3 stale top-level candidates, no descendants, apply=false | Plan printed, nothing archived, exit 0 |
| 3 stale top-level candidates, 2 with 1-level descendants, apply=true | 3 + 2 archive calls in depth-first order (deepest first), exit 0 |
| 1 candidate whose archive returns `archived_ancestor` | Classified as tolerated, exit 0 |
| 1 candidate whose archive returns a genuine unexpected error | Classified as unexpected, exit 4 |
| `E2E_ROOT_PAGE_ID` itself archived | Exit 3 before any sweep work |
| `E2E_ROOT_PAGE_ID` returns `object_not_found` | Exit 2 or 3 — builder picks, document in exit-code table; I suggest 3 |
| Extra non-root E2E pages returned by `search` | Logged as SKIP, not archived |

**Optional live probe (deferred, not required for the PR):** a single vitest case that runs under the E2E env gate, creates a deliberate throwaway sandbox, archives its parent manually to produce `archived_ancestor`, then invokes the sweeper in dry-run mode and asserts the plan includes the orphaned descendant. This is nice-to-have; if the builder is over budget, skip it and file a follow-up task.

### 6.4 Guard: `npm run test:e2e` still green after changes

The full E2E suite must still pass unmodified — the only intentional surface-level change is the `cleanup.failed` → `cleanup.unexpected` rename at `live-mcp.test.ts:284-288`. Builder must paste `npm run test:e2e` green output into the PR (sandboxed against the existing E2E creds James uses).

---

## 7. Evidence the builder owes back

In the PR description, include (copy/paste, not summarized):

1. **Failing classifier tests first** — output of `npm test -- tests/e2e/helpers/archive-errors.test.ts` **before** any implementation exists, showing 7 failing tests.
2. **Green after implementation** — same command, 7 passing.
3. **Mutation hand-check** — paste the output showing each of the three mutations (§6.1) turns at least one test red.
4. **Sandbox integration test** — `npm test -- tests/e2e/helpers/sandbox.test.ts`, green.
5. **Sweeper unit test** — `npm test -- scripts/e2e/sweep-stale.test.ts`, green.
6. **Full unit suite green** — `npm test`, green.
7. **Typecheck** — `npm run typecheck`, zero errors. Note: `tsconfig.json` includes only `src/**/*`, so `typecheck` does NOT cover the new files under `tests/e2e/helpers/` or `scripts/e2e/`. Those get their type coverage from vitest's own loader (tests) and from `tsx` at runtime (sweeper). The builder should acknowledge this gap in the PR description rather than imply broader coverage. A follow-up task `e2e-expand-typecheck-scope` can be filed if James wants CI-level typecheck for the helpers — the cleanest route is a `tsconfig.test.json` extending the root and including `tests/**` + `scripts/**`. Not in this PR.
8. **E2E regression** — `npm run test:e2e` output showing:
   - All tests green.
   - The new summary line present in logs (`[e2e][teardown] cleanup summary: ...`).
   - The `UNEXPECTED` marker NOT present in logs for a clean run.
9. **Manual sweeper smoke** — one dry-run against James's workspace, one apply-run if there's observable leakage to clean up. Paste the log of each. (Best-effort; if the workspace happens to be clean, paste "nothing to sweep — dry-run produced empty plan").

If any evidence item cannot be produced (e.g. there's nothing for the sweeper to sweep), state that explicitly in the PR body rather than skipping.

---

## 8. Scope boundaries — NOT in this PR

- **No changes to the `archive_page` tool itself.** The tool already returns the right thing; the problem is how teardown classifies it.
- **No changes to `enhanceError`.** Its append-the-hint behavior makes the teardown message noisy but that's an API-surface decision owned by the broader error-message story (see `.meta/research/frame-6-driftracker-2026-04-17.md` §5). If we rewrote it for teardown we'd break every test that asserts on error messages. Classifier handles it downstream.
- **No new tolerated classes beyond the three.** If Notion emits a fourth recurrent "benign" string in a future test run, file a follow-up with reproduction steps; do not preemptively expand the classifier.
- **No behavior change on unknown errors.** Unknown still logs loud (`UNEXPECTED` marker), still goes into the return `.unexpected` array, still affects sweeper exit code.
- **No retry logic.** The sweeper does not retry failed archives. If Notion rate-limits us, log and move on — James re-runs.
- **No cron / automation.** The sweeper is manually invoked. No CI integration, no GitHub Action. (Matches the tier-1 plan §8 intent.)
- **No `leaked:` rename of stale sandboxes.** Consistent with §8.5 of the tier-1 plan.
- **No cascading-archive behavior change.** The KNOWN GAP test at `live-mcp.test.ts:625-660` documents that Notion does not cascade archives. That is pinned; this PR doesn't touch it.
- **No Notion-Version bump.** We stay at `2025-09-03` (`project_notion_version_pin.md`).

---

## 9. Risks

### 9.1 False-negative classification (over-tolerance)

**Risk:** a real bug emits a Notion message containing one of our three substrings and gets silently swallowed.

**Likelihood:** low. `Can't edit block that is archived` and `Can't edit page on block with an archived ancestor` are narrow phrases tied to specific Notion error paths; `Could not find page with ID` is broad but in practice appears only on `object_not_found`.

**Mitigation:**
- The summary line always prints. A regression that demotes real failures to tolerated will show up as a spike in `already_archived=N` / `not_found=N` counts in CI logs, greppable and auditable.
- The classifier API takes `rawError: string` only — we do not currently have the Notion `code` field at the point of classification, because `src/server.ts:1478-1482` catches errors and returns `{error: message}` *without* the code. Cross-matching against `code` would require a server-side change to surface it in the MCP tool response. **That is out of scope for this PR.** Leave the API string-only; revisit if the risk materializes.

### 9.2 False-positive classification (under-tolerance)

**Risk:** Notion rewords the strings in a minor way (e.g. `"Can't edit block that is archived"` → `"Cannot edit block that is archived"`) and every teardown starts logging `UNEXPECTED`.

**Likelihood:** low. Notion is pinned at 2025-09-03 and these messages have been stable for months (frame-6 research from 2026-04-17 already documented the same wording).

**Mitigation:** the `UNEXPECTED` marker fails loudly, not silently. A Notion-side wording bump is easy to detect and patch. Also: cheap to add more substrings to the classifier without touching the sandbox integration (the classifier is a single pure function).

### 9.3 Sweeper flakiness

**Risk:** live sweeper acts on an unshared / just-archived / race-condition page and either surfaces confusing errors or no-ops.

**Likelihood:** medium. The sweeper reads, then writes, with time in between.

**Mitigation:** the classifier already absorbs the three race outcomes (`not_found`, `already_archived`, `archived_ancestor`). Genuine surprises — including `rate_limited` during large sweeps — are logged loud with the `UNEXPECTED` marker and counted in exit code 4. No auto-retry; the operator reruns after the rate-limit window. Dry-run default means the first interaction is read-only.

### 9.4 Scope creep via the sweeper

**Risk:** the sweeper grows feature flags (`--match`, `--root-override`, `--older-than`, `--json-output`, …) and becomes its own thing.

**Mitigation:** §4.4 explicitly caps the flag set at `--apply`. If we later feel the need, add one more flag in its own small PR with test coverage.

### 9.5 Hidden state: symlinks / worktrees / moved repo

**Risk:** `dist/index.js` path resolution — `scripts/e2e/mcp-spike.ts` uses `resolve(process.cwd(), "dist/index.js")` which assumes the invocation happens from the repo root. If the sweeper is run from elsewhere (unlikely but possible), it misses.

**Mitigation:** the sweeper reuses `McpStdioClient` which already has a clear error ("run `npm run build` first") at `tests/e2e/helpers/mcp-stdio-client.ts:37-39`. No new risk.

### 9.6 Dependency: adding `tsx` as a direct devDependency

**Risk:** a tiny supply-chain surface area increase. `tsx` is already pulled transitively, so this is mostly cosmetic — but downgrading it to direct means James's `package.json` carries one more name.

**Mitigation:** the upside (locked invocation contract, clear ownership) outweighs the cost. Alternative: keep `tsx` transitive and document the dependency in the script's header comment. Builder picks; I lean toward promoting it.

---

## 10. Effort estimate

| Task | Estimate |
|---|---|
| Classifier + unit tests (TDD) | 30m |
| `sandbox.ts` wiring + integration test | 40m |
| Sweeper script + unit tests | 60m |
| `package.json` scripts + tsx devDep bump | 10m |
| Full `npm run test:e2e` regression verification | 30m |
| Manual sweeper smoke (dry-run + optional apply) | 15m |
| PR description + evidence paste | 15m |
| **Subtotal** | **~3h 20m** |
| 1h contingency buffer (Notion behavior surprises, SDK quirks, classifier precedence tweaks) | 60m |
| **Total budget** | **~4h 20m** |

**Confidence:** medium-high for classifier + sandbox (30-40m each, stable design). Medium for sweeper (60m, depth-first logic + mocked tests are modest complexity, live-probe is the unknown). If the builder is stuck on any one task past 1.5× its estimate, they should checkpoint and surface rather than burn hours.

**Single-turn vs multi-turn for the builder:** this is 3-4 hours of focused work. A single long builder session works if James trusts the builder; otherwise split into two dispatches:

1. **Dispatch A:** classifier + `sandbox.ts` + `live-mcp.test.ts` wiring + unit tests. End at passing `npm test`.
2. **Dispatch B:** sweeper script + its tests + `package.json` scripts. Pre-reads Dispatch A's changes.

A two-dispatch split adds ~30m of context re-read but preserves independent review per learning `[4eda40]`. James's call.

---

## 11. Open questions — Decisions pending

None of these block the builder from starting. Each defaults to a sensible answer; James overrides if he disagrees.

| # | Question | Default answer |
|---|---|---|
| 1 | Is the exact string `"Can't edit page on block with an archived ancestor"` the live Notion wording? | Use as documented in task spec; builder confirms with a one-shot probe (create parent → archive parent → attempt archive child → capture message) in the same session; if different, pin the actual string in the classifier and note in the PR. |
| 2 | Two-dispatch split vs one? | One dispatch — the work is bounded enough that the independent-review value James cares about is preserved by the pre-PR Codex review + James's own PR review. |
| 3 | Promote `tsx` to a direct devDependency? | Yes. Cleaner contract; cost is negligible. |
| 4 | Optional live sweeper probe test? | Defer to a follow-up. Not blocking. |
| 5 | Surface Notion error `code` in MCP tool response so classifier can match on code + substring? | Out of scope for this PR (§9.1). File a follow-up if the real-world miss rate indicates we need it. |
| 6 | Add `[sweep]` / `[e2e][teardown]` log prefixes to an eventual machine-readable line format (JSON lines)? | Not now. Human-readable strings are fine for a manual sweeper. Can revisit when we add any automation around it. |
| 7 | Sweeper misses orphaned child databases because `list_pages` only returns `child_page` blocks. | Accept the miss for now. If it bites, file `e2e-sweep-stale-child-databases` follow-up task that either expands `list_pages` or adds a new tool surface for listing child databases. |
| 8 | Should we add `tsconfig.test.json` in this PR so `npm run typecheck` covers the new helper files? | No — out of scope. Typecheck gap noted in §7 and PR description. File a separate `e2e-expand-typecheck-scope` task if James wants CI coverage. |

---

## 12. Final sanity check against CLAUDE.md handoff screen

Before commit:

1. **Third parties by name or specific role:** none. The plan names only James, the tasuku task ID, and public Notion API surface.
2. **Business, financial, or client information:** none.
3. **Credentials or secrets:** none — explicit references are env-var names, never values.
4. **Tone:** measured, no snark, no self-deprecation beyond the `[4eda40]` learning reference which is neutral and already public in the tasuku log.

Plan passes screen.

---

## 13. Codex review summary

**Session:** `plan-review-e2e-teardown-robustness` (codex, reasoningEffort high, ~3m, 32 tool calls).

Codex pressure-read the plan against the actual MCP tool shapes and surfaced three critical items plus four important ones:

- **Critical 1 — sweeper discovery surface insufficient.** `list_pages` omits non-`child_page` descendants; `search` exposes only one parent hop; `read_page` doesn't expose `in_trash`. → Plan narrowed (§4.1.1) to child-page descendants only, `search` demoted to diagnostic-only, archived-root detection dropped.
- **Critical 2 — root-boundary exit codes inconsistent and partly impossible.** → §4.3 and §4.4 rewritten; exit 2 and 3 are now disjoint (local vs. remote precondition failure), archived-root detection removed.
- **Critical 3 — code+substring mitigation was promised but unsupported by the string-only API.** → §9.1 corrected to note the classifier API is string-only, and surfacing the Notion `code` would require a separate server change outside this PR.
- **Important** — ancestry-unsafe `search` branch tightened to SKIP-with-warn only; typecheck scope honestly reduced to `src/**` coverage in §7; log volume reduced (no per-success line, summary-only); rate-limit classification explicitly documented as `unexpected`/exit 4.
- **Minor** — tolerated-teardown lines moved from `console.error` to `console.warn`; `--help`/unknown-arg parser behavior specified in §4.4.

Codex agreed with: pagination claim, classifier precedence, return-shape change scope (one caller), and the `vi.mock` test approach.

The plan as committed reflects these adjustments.

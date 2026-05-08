# Handoff: late close of 2026-05-07

Written by Codex orchestrator on 2026-05-07. This session picked up from
`.meta/handoffs/2026-05-07-close.md`, completed the remaining runtime reliability
cluster, ran live Notion evidence, and fixed the Vitest worktree discovery issue.

## Headline state

- **`dev` is synced to `public/dev`.** Latest pushed product checkpoint is
  `9c34e83 test: exclude agent worktrees from vitest`. If this handoff is
  committed afterward, the only newer commit should be the handoff doc.
- **Runtime markdown-write cluster is live-verified.** The recent fixes for
  100-block writes, deferred nested children, long rich text, and
  `update_section` ordering all have focused tests and live Notion evidence.
- **Full live E2E passed.** A compact probe set passed first, then the full
  `tests/e2e/` suite passed with `.mcp-agents` excluded.
- **Vitest no longer discovers stale agent worktree tests.** `vitest.config.ts`
  extends `configDefaults.exclude` with `**/.mcp-agents/**`.
- **Next recommended implementation slice is security hardening:**
  `harden-uploadfile-workspace-root`.

## Commits landed and pushed

Newest first:

- `9c34e83 test: exclude agent worktrees from vitest`
- `b80a6c4 fix(notion): preserve update section ordering`
- `090e6ec fix(notion): split rich text write segments`
- `072f681 docs(handoff): close of 2026-05-07`

Earlier runtime reliability commits from the prior close remain relevant:

- `8c0ddea fix(notion): defer nested block children`
- `fffbc79 fix(notion): chunk page creation blocks`

Pushes to `public/dev` succeeded. GitHub repeated the expected branch-rule
bypass/status-check message and existing two moderate Dependabot notices.

## Tasks completed

Tasuku tasks marked done this session:

- `handle-notion-char-rich-text-lim`
- `fix-updatesection-block-ordering`
- `run-runtime-cluster-live-probes`
- `vitest-exclude-mcp-agents-worktrees`

New Tasuku task created:

- `promote-runtime-cluster-live-probes`
  - Promote the temporary compact runtime probes into durable E2E coverage or a
    checked-in probe script.
  - Do not make every local test run expensive; decide whether this belongs in
    `tests/e2e/live-mcp.test.ts` or as a standalone npm script.

## Rich text write limit slice

Commit: `090e6ec fix(notion): split rich text write segments`

Files changed:

- `src/rich-text.ts`
- `src/notion-client.ts`
- `tests/notion-client-block-chunking.test.ts`
- `tests/rich-text-write.test.ts`
- `tests/update-block.test.ts`

Behavior:

- Outgoing Notion rich text is normalized through a shared helper.
- Text rich-text items are split so no `text.content` segment exceeds Notion's
  2000-character request limit.
- Valid non-text rich-text items, such as mentions/equations, are preserved.
- Response-only fields such as `plain_text` and `href` are stripped from write
  payloads.
- Coverage applies to block create/append/update paths, page/database titles,
  database title/rich_text property writes, and comments.

Review pattern:

- Worker implemented.
- Independent reviewer found two real issues: response-only `href` preservation
  and missing coverage for title/property/comment writers.
- Worker patched.
- Reviewer found a second blocking issue: non-text rich text was being dropped.
- Worker patched preservation of non-text items.
- Final reviewer re-check found no blocking issues.

Validation:

- `npm test -- tests/notion-client-block-chunking.test.ts tests/update-block.test.ts tests/rich-text-write.test.ts tests/convert-property-value.test.ts` — passed, 59 tests
- `npm run typecheck` — passed
- `npm run build` — passed
- `git diff --check` — passed

## update_section ordering slice

Commit: `b80a6c4 fix(notion): preserve update section ordering`

Files changed:

- `src/server.ts`
- `src/cli/run.ts`
- `tests/update-section.test.ts`
- `tests/cli-profile.test.ts`

Behavior:

- MCP `update_section` and CLI `content update-section` now preserve ordering
  when replacing a section that starts at the first top-level block.
- For first-block sections, the existing heading is updated in place as the
  insertion anchor instead of deleting it and appending replacement content at
  page end.
- First-block replacement markdown must start with the same heading type as the
  existing heading; wrong-type replacements fail before destructive mutations.
- Heading `is_toggleable` is explicitly reconciled so toggle heading to plain
  heading does not accidentally preserve stale toggle state.
- Old heading children and old body blocks are deleted before replacement
  children/siblings are appended.
- MCP tool description now notes the first-block same-heading-type requirement.

Review pattern:

- Worker implemented MCP and CLI paths plus regression tests.
- Independent reviewer found a real toggleable-heading drift issue and requested
  negative tests/docs for the new validation.
- Worker patched toggleability, mutation ordering, negative tests, and the MCP
  description.
- Final reviewer re-check found no blocking issues.

Validation:

- `npm test -- tests/update-section.test.ts tests/cli-profile.test.ts` — passed,
  60 tests at the time, including duplicate stale worktree discovery before the
  Vitest exclusion landed
- `npm run typecheck` — passed
- `npm run build` — passed
- `git diff --check` — passed

## Live E2E evidence

Environment:

- Current shell did **not** have live vars.
- Repo `.env` exists and, when sourced, supplied:
  - `NOTION_TOKEN`
  - `E2E_ROOT_PAGE_ID`
  - `NOTION_ROOT_PAGE_ID`
- Local live commands should source `.env` explicitly.

Initial live smoke:

- Command:
  `set -a; . ./.env; set +a; E2E_ENFORCE=1 npx vitest run tests/e2e/live-mcp.test.ts -t "A1: auth / transport smoke"`
- Passed.
- Before the Vitest exclusion fix, this also discovered a stale
  `.mcp-agents/worktrees/...` copy and created two sandboxes.

Compact runtime probe set:

- Ran via a temporary `.meta/runtime-cluster-live-probe.ts` script, then deleted
  the script afterward.
- Covered:
  - `create_page` with more than 100 top-level blocks
  - `append_content` with more than 100 top-level blocks
  - deep nested column/table/toggle/list write
  - long rich-text paragraph and long comment
  - first-section `update_section` ordering
- Result: all probes passed.
- Cleanup summary: `archived=6`, `unexpected=0`.

Full live E2E:

- Command:
  `set -a; . ./.env; set +a; E2E_ENFORCE=1 npx vitest run tests/e2e/ --exclude '.mcp-agents/**'`
- Result: 4 files passed, 35 tests passed.
- Duration: about 299 seconds.
- Cleanup summary:
  - `archived=128`
  - `already_archived=1`
  - `archived_ancestor=1`
  - `not_found=12`
  - `unexpected=0`
- The stderr output includes Notion API stack traces during teardown for
  tolerated cleanup classes. This is known noise, tracked separately by
  `ee-teardown-stderr-quieting-arch`.

## Vitest worktree exclusion

Commit: `9c34e83 test: exclude agent worktrees from vitest`

File changed:

- `vitest.config.ts`

Behavior:

- Vitest now extends `configDefaults.exclude` and adds `**/.mcp-agents/**`.
- This avoids replacing Vitest's built-in default excludes.

Reproduction:

- Before:
  `npm test -- tests/update-section.test.ts --reporter verbose` ran both
  `.mcp-agents/worktrees/dashboard-builder-badges/tests/update-section.test.ts`
  and main `tests/update-section.test.ts` — 2 files, 19 tests.
- After:
  the same command ran only main `tests/update-section.test.ts` — 1 file,
  11 tests.

Validation:

- `npm test -- tests/update-section.test.ts --reporter verbose` — passed, 1 file / 11 tests
- `npm run typecheck` — passed
- `npm run build` — passed
- `git diff --check` — passed

## Decisions recorded

Created this session:

- `runtime-cluster-live-verified-next-upload-hardening`
  - Treat the runtime markdown-write reliability cluster as live-verified.
  - Move next to `harden-uploadfile-workspace-root` after the Vitest worktree
    exclusion checkpoint.
  - Rationale: focused mock tests, compact live probes, and broader live E2E all
    passed; remaining runtime probe hardening is now durable-coverage work, not
    a blocker for the next security slice.

Earlier decision now satisfied:

- `defer-live-e2e-until-runtime-cluster`
  - The cluster reached the intended point and live E2E was run.

Still active:

- `public-dev-push-gate`
  - Continue pushing only known-good public checkpoints.
- `pause-cli-parity-after-section-block-slice`
  - Broad CLI parity remains paused unless James explicitly reprioritizes it.

## Learnings recorded

Important new learnings:

- `940c04` — Always sanitize outgoing Notion rich_text payloads before writes:
  split text content, preserve valid non-text items, and drop response-only
  fields.
- `2f7bff` — First-block `update_section` replacements need separate anchor
  handling, wrong-heading validation, and explicit heading toggleability
  reconciliation.
- `7ab5b5` — Keep CLI `content update-section` aligned with MCP
  `update_section`.
- `9929ab` — Source repo `.env` explicitly for local live E2E commands.
- `7b3c2d` — Exclude `.mcp-agents/**` when running local E2E commands until the
  config fix is present. The config fix is now present.
- `e5c216` — Extend `configDefaults.exclude` when adding Vitest excludes.
- `f05aea` — Duplicate live/focused test runs were caused by stale
  `.mcp-agents/worktrees/**` test copies.

Note: `ce8909` also exists for the top-of-page `update_section` root cause.

## Working tree

Tracked tree is clean and `dev...public/dev` is synchronized at the latest
product checkpoint before this handoff doc.

Known untracked leftovers remain and were not touched:

- `.claude/`
- `.meta/audit-b-fixtures/valid.md`
- `.meta/audits/promotional-content-audit-2026-04-27-followup.md`
- `.meta/audits/promotional-content-audit-2026-04-27.md`
- `.meta/bench/runs/run-2026-04-24-0c94f02.manifest.json`
- `.meta/bench/runs/run-2026-04-24-800cd7f.manifest.json`
- `.meta/symlink-pointing-outside.md`
- `scripts/bench/hosted-mcp-live-capture.ts`

Do not sweep these blindly.

## Recommended next sequence

1. **Start `harden-uploadfile-workspace-root`.**
   - This is the next high-priority security-hardening slice.
   - Keep implementation shared so MCP and CLI file-upload paths benefit.
   - Use worker implementation plus independent review.

2. **Then consider `promote-runtime-cluster-live-probes`.**
   - Today’s temporary probe had good signal.
   - Decide whether to promote it into `tests/e2e/live-mcp.test.ts` or a
     standalone script.
   - Keep runtime cost bounded; the full live E2E already takes about five
     minutes locally.

3. **Then choose between strategic tracks:**
   - `notion-version-bump-2026-03-11`, likely after centralizing version-gated
     field names.
   - `tiered-tool-descriptions-load-co` / MCP Resources.
   - `add-tier1-live-e2e-for-untested-tools` if live coverage remains the
     priority.

4. **Cleanup/hygiene later:**
   - `clean-stale-agent-worktrees` is still ready, but the Vitest config now
     prevents duplicate test discovery even if stale worktrees remain.
   - `ee-teardown-stderr-quieting-arch` remains useful if teardown stderr noise
     becomes a CI readability problem.

## Collaboration posture

The orchestration pattern continued to work well:

- Orchestrator scopes and sequences.
- Worker owns tight implementation.
- Independent reviewer catches drift/edge cases.
- Orchestrator verifies locally, commits, and pushes known-good checkpoints.

Keep direct coding minimal. The only direct implementation in this session was
the tiny Vitest config change; larger runtime slices used worker/reviewer
delegation.

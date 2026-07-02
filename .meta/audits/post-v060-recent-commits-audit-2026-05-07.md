# Post-v0.6.0 Recent Commits Audit

Date: 2026-05-07
Scope: `git log v0.6.0..HEAD` on `/mnt/d/backup/projects/personal/mcp-notion`
Head audited: `a25e448 fix: preserve read page warning contract`

## Summary

The post-`v0.6.0` work is generally coherent: the CLI/profile expansion, runtime write-shaping fixes, targeted reads, MCP resources, and v0.7.0 release are backed by focused tests and mostly follow the project's orchestrator/reviewer discipline. The main problems are not broad architectural rot; they are contract drift at new surfaces and a couple of edge paths where recent reliability claims do not fully hold.

No product files were edited during this audit. I wrote only this report.

## Findings

### Fix Soon: CLI flag parsing rejects valid markdown and replacement values

Severity: Medium

What's wrong: The new `easy-notion` CLI scans the entire argv for global options and treats any value beginning with `--` as a missing argument. That means valid command values such as markdown `---` (divider/frontmatter), replacement text `--new`, or content that happens to equal `--profile`, `--format`, or `--quiet` can be rejected or stolen by global parsing.

Why it matters: The CLI is the accepted low-context multi-profile surface. Agents will naturally pass arbitrary markdown and text through `--markdown`, `--find`, and `--replace`; this bug makes the CLI unreliable for normal markdown and text values unless callers switch to `--stdin` or `--markdown-file`.

Evidence:
- [src/cli/run.ts](/mnt/d/backup/projects/personal/mcp-notion/src/cli/run.ts:241) scans all argv for global flags instead of stopping after the command.
- [src/cli/run.ts](/mnt/d/backup/projects/personal/mcp-notion/src/cli/run.ts:265) rejects any required value that starts with `--`.
- Repro command:
  `./node_modules/.bin/tsx -e "... runCli(['content','append','page-1','--markdown','---']) ..."`
  Result: `{"code":1,"output":"{\"ok\":false,\"error\":{\"code\":\"missing_argument\",\"message\":\"--markdown requires a value.\"}}\n"}`
- Repro command:
  `./node_modules/.bin/tsx -e "... runCli(['content','find-replace','page-1','--find','old','--replace','--new']) ..."`
  Result: `{"code":1,"output":"{\"ok\":false,\"error\":{\"code\":\"missing_argument\",\"message\":\"--replace requires a value.\"}}\n"}`

What to do: Parse global options only before the command, support a `--` sentinel, and allow arbitrary string values for content flags. Add regression tests for `--markdown "---"`, `--replace "--new"`, and a markdown value equal to a global-looking flag.

### Fix Soon: MCP warning resource documents shapes/codes that do not match runtime

Severity: Medium

What's wrong: The new `easy-notion://docs/warnings` resource is now a contract surface, but it documents a `truncated_properties` shape with `property`, `returned`, and `has_more`. Runtime warnings and existing tests use `name`, `returned_count`, and `cap`. The same resource also omits `embed_lost_on_atomic_replace`, while runtime emits it for embeds.

Why it matters: The resources feature deliberately moved reference material out of tool descriptions. If the on-demand resource is wrong, agents and client code learn the wrong warning contract and may fail to handle truncation or embed-loss warnings correctly.

Evidence:
- Resource text at [src/server.ts](/mnt/d/backup/projects/personal/mcp-notion/src/server.ts:230) documents `truncated_properties` with the wrong fields.
- Runtime warning type is [src/notion-client.ts](/mnt/d/backup/projects/personal/mcp-notion/src/notion-client.ts:315): `name`, `type`, `returned_count`, `cap`.
- Runtime wraps those entries at [src/server.ts](/mnt/d/backup/projects/personal/mcp-notion/src/server.ts:2035) for `read_page` and [src/server.ts](/mnt/d/backup/projects/personal/mcp-notion/src/server.ts:2274) for `query_database`.
- `embed_lost_on_atomic_replace` is emitted at [src/markdown-to-enhanced.ts](/mnt/d/backup/projects/personal/mcp-notion/src/markdown-to-enhanced.ts:275), but the warnings resource only names `bookmark_lost_on_atomic_replace`.
- Existing contract tests assert `returned_count` and `cap` in [tests/read-page-title-pagination.test.ts](/mnt/d/backup/projects/personal/mcp-notion/tests/read-page-title-pagination.test.ts:167) and [tests/query-database-pagination.test.ts](/mnt/d/backup/projects/personal/mcp-notion/tests/query-database-pagination.test.ts:170).

What to do: Update `easy-notion://docs/warnings` to match emitted warning objects exactly, include `embed_lost_on_atomic_replace`, and add a resource test that compares documented warning names/field examples against the existing runtime contract tests or a small canonical table.

### Fix Soon: Callout child writes bypass the new rich-text/deferred-child safety path

Severity: Medium

What's wrong: Recent runtime fixes split long rich text and defer unsafe nested children, but callout children are not covered. `normalizeBlockRichTextForWrite` does not recurse into callout children, `isOptionalChildrenContainer` does not include callouts, and there is no callout branch in deferred child appends. A callout with a child paragraph over 2,000 characters is still sent inline as one unsplit rich-text segment.

Why it matters: This undercuts the post-`v0.6.0` runtime reliability cluster for read-derived/write-derived block trees. The project can create such trees through `duplicate_page` and targeted-read/read-block paths that preserve callout children internally. Users duplicating or rewriting pages with callouts containing long child content can still hit Notion validation errors.

Evidence:
- Callout children are attached on reads at [src/server.ts](/mnt/d/backup/projects/personal/mcp-notion/src/server.ts:751) and specially rendered by targeted reads at [src/server.ts](/mnt/d/backup/projects/personal/mcp-notion/src/server.ts:913).
- The write normalizer handles list/toggle/heading/table/column children recursively, but callout only normalizes the root rich text at [src/rich-text.ts](/mnt/d/backup/projects/personal/mcp-notion/src/rich-text.ts:151).
- Deferred-child routing excludes callouts at [src/notion-client.ts](/mnt/d/backup/projects/personal/mcp-notion/src/notion-client.ts:110) and [src/notion-client.ts](/mnt/d/backup/projects/personal/mcp-notion/src/notion-client.ts:218).
- Repro command:
  `./node_modules/.bin/tsx -e "... appendBlocks(callout with child paragraph length 2001) ..."`
  Result: `{"calls":1,"childSegments":1,"childLength":2001}`

What to do: Decide whether callout children are supported. If yes, add callouts to the child-container normalization/deferred-append logic and test long child rich text plus nested child deferral. If no, omit or warn consistently instead of preserving them in read-targeted output.

### Note For Later: Project context and release notes drifted after post-tag features

Severity: Low

What's wrong: Current `dev` has 32 tools, targeted reads, and MCP resources, but `CLAUDE.md` still tells agents there are 29 tools. The `0.7.0` changelog entry stops at the tagged release and has no `Unreleased` section for the later targeted-read/resource commits.

Why it matters: This repo uses `CLAUDE.md` and handoffs as operating context for future agents. Stale tool counts and missing unreleased notes make it harder for an orchestrator/reviewer to tell what is shipped, what is merely on `dev`, and what should go into the next release.

Evidence:
- [CLAUDE.md](/mnt/d/backup/projects/personal/mcp-notion/CLAUDE.md:74) says `createServer` registers all 29 tools.
- [README.md](/mnt/d/backup/projects/personal/mcp-notion/README.md:340) says 32 tools.
- [CHANGELOG.md](/mnt/d/backup/projects/personal/mcp-notion/CHANGELOG.md:8) has `0.7.0` as the top section; targeted reads (`8ef58f7`) and MCP resources (`9740d31`) landed after tag `v0.7.0`.

What to do: Update `CLAUDE.md`'s tool count or replace the literal with a less stale-prone pointer. Add an `Unreleased` section before the next publish, or cut the next patch release before merging post-tag docs to a public default branch.

### Note For Later: Historical diff check over the audit range is not clean

Severity: Low

What's wrong: `git diff --check v0.6.0..HEAD` reports trailing whitespace in `.meta/research/tool-shape-design-2026-05-06.md`.

Why it matters: This is not product behavior, and the current worktree diff is clean, but it weakens "diff check passed" evidence when auditing the whole post-release range.

Evidence:
- Command: `git diff --check v0.6.0..HEAD`
- Result:
  - `.meta/research/tool-shape-design-2026-05-06.md:3: trailing whitespace.`
  - `.meta/research/tool-shape-design-2026-05-06.md:4: trailing whitespace.`
- Command: `git diff --check`
- Result: passed with no output.

What to do: Either remove the trailing hard-break spaces in that memo or document that `.meta/research` Markdown hard breaks are exempt from range-level whitespace gates.

## Testing Assessment

What is well tested:
- Targeted reads have focused InMemoryTransport coverage for section boundaries, recursive toggles, unsupported block warnings, and CLI structured errors.
- MCP resources have protocol-level list/read tests.
- Runtime write-shaping has focused tests for 100-block chunking, deferred nested lists/columns/tables, rollback on partial page create, and rich-text splitting across common write paths.
- CLI parity tests are broad and cover readonly guards, validation ordering, targeted reads, page/content/block/database/comment command routing, and file-upload preprocessing.

Gaps and risks:
- CLI parser tests do not cover arbitrary text values beginning with `--` or markdown starting with `---`.
- Resource tests verify that resources exist and contain key strings, but not that documented warning shapes/codes match emitted runtime contracts.
- Callout child write paths are not covered by the runtime reliability tests.
- Targeted reads have no live Notion coverage yet. That is a deliberate cost/safety tradeoff from the handoff, but should be considered before the next release if these are advertised as a major context-efficiency feature.
- I did not run `npm run build` because it writes `dist/`, and the audit write scope was limited. I used `npm run typecheck` plus focused tests instead.

Live evidence note:
- I unintentionally ran `npm test -- tests/e2e/live-mcp.test.ts`; the test helper loaded repo-local live credentials even though the shell env check reported `NOTION_TOKEN`/`E2E_ROOT_PAGE_ID` absent. I let it complete cleanup rather than interrupting mid-sandbox.
- Result: 27 passed, 1 failed. Failure was `F2: replace_content (atomic) returns success:true and replaces page content`, timed out at 30s after a Notion request timeout. Cleanup summary reported `unexpected=0`.
- I am not treating this as a product bug from one run, but it is live evidence that the full suite was not green at audit time and that local env gating is easy to misread.

## Positive Patterns

- The post-`v0.6.0` commits usually preserve the worker/reviewer/orchestrator shape recorded in handoffs, especially for risky CLI parity and runtime write-shaping work.
- Runtime fixes are conservative and request-shape focused: chunking and deferred writes are centralized in `notion-client.ts`, not spread across MCP and CLI handlers.
- Targeted reads reuse the same section-boundary logic as `update_section`, which reduces behavior drift.
- CLI errors for new targeted reads include structured fields (`available_headings`, `available_toggles`, unsupported block `id`/`type`) instead of forcing agents to parse prose.
- The MCP Resources implementation keeps safety-critical `update_data_source` warnings inline while moving longer reference text out of tool descriptions.

## Commands Run

- `sed -n '1,240p' ../workflow-v2/audit.md` — read audit PM operating instructions.
- `sed -n '1,240p' CLAUDE.md` and `sed -n '241,520p' CLAUDE.md` — read project context.
- `sed -n ... .tasuku/context/decisions.md`, `.tasuku/context/learnings.md`, and recent `.meta/handoffs/*` — read decisions, learnings, and handoffs.
- `git status --short --branch` — confirmed `dev...public/dev` and known unrelated untracked files.
- `git log --oneline --decorate v0.6.0..HEAD` — mapped recent commits.
- `git diff --stat v0.6.0..HEAD` and `git diff --name-status v0.6.0..HEAD` — mapped changed files.
- Focused source reads with `nl -ba`/`rg` across `src/server.ts`, `src/cli/run.ts`, `src/cli/profile-config.ts`, `src/notion-client.ts`, `src/rich-text.ts`, tests, README, CHANGELOG, and package files.
- `npm test -- tests/read-tools.test.ts tests/resources.test.ts tests/cli-profile.test.ts tests/notion-client-block-chunking.test.ts tests/rich-text-write.test.ts tests/update-section.test.ts` — passed, 6 files / 86 tests.
- `npm run typecheck` — passed.
- `node -e "..."` env presence check — shell env reported `NOTION_TOKEN=absent`, `E2E_ROOT_PAGE_ID=absent`, `E2E_ENFORCE=absent`.
- `./node_modules/.bin/tsx src/cli.ts --help` — passed; returned JSON help.
- `npm test -- tests/e2e/live-mcp.test.ts` — unintentionally live; failed 1/28 on F2 timeout, cleanup `unexpected=0`.
- `./node_modules/.bin/tsx -e "... runCli --markdown '---' ..."` — reproduced CLI parser failure.
- `./node_modules/.bin/tsx -e "... runCli --replace '--new' ..."` — reproduced CLI parser failure.
- `./node_modules/.bin/tsx -e "... appendBlocks(callout child rich_text 2001) ..."` — reproduced unsplit callout child rich text.
- `git diff --check v0.6.0..HEAD` — failed on trailing whitespace in `.meta/research/tool-shape-design-2026-05-06.md`.
- `git diff --check` — passed for the current worktree.

## Session Chain

- Audit PM session: current Codex API session.
- Separate Codex subagent sessions used during this audit: none available in this tool surface. I followed the audit prompt by doing focused concern passes directly and recorded the limitation here.

## Deliberate Tradeoffs / Not Findings

- No live targeted-read run was done intentionally; the handoff already framed this as a cost/safety tradeoff. The accidental broad live run is recorded under Testing Assessment.
- I did not flag the post-tag `package.json` version remaining `0.7.0` by itself. A dev branch can carry unreleased features without an immediate version bump; the actionable issue is the lack of clear `Unreleased`/context notes.
- I did not flag the column placeholder seed used for unsafe column children. That appears to be a deliberate Notion API compatibility tradeoff, not an accidental regression.

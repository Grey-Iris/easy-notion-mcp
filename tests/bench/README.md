# Bench Harness

Run the bench harness with:

```bash
NOTION_TOKEN=... npx tsx tests/bench/cli.ts [--scenarios id1 id2 ...]
```

Environment:

- `NOTION_TOKEN` is required.
- `BENCH_ROOT_PAGE_ID` is optional and falls back to `E2E_ROOT_PAGE_ID`.
- `ANTHROPIC_API_KEY` is optional because the Claude CLI may use keychain auth.

Scenarios:

| # | ID | Notes |
|---|---|---|
| 01 | `meeting-notes-kickoff` | Page creation, append, find/replace |
| 02 | `runbook-refresh` | Read/update section/append flow |
| 03 | `bug-tracker-bootstrap` | Relation-heavy database bootstrap |
| 04 | `sprint-retro-synthesis` | Search plus synthesis page |
| 05 | `knowledge-base-migration` | `stdio`-only, skipped in HTTP bench runs |
| 06 | `bibliography-database` | Database schema update and filtered query |
| 07 | `editorial-calendar` | Status/date filtering and row update |
| 08 | `onboarding-checklist` | Checklist, comments, sharing, list_users assert |
| 09 | `archive-old-sprints` | Archive/restore/delete plus parent listing |
| 10 | `project-portfolio-rollup` | Relation validation with custom assert |
| 11 | `weekly-status-report` | Database query to reporting page |
| 12 | `blog-post-polish` | Replace content plus icon/cover update |
| 13 | `identity-smoke` | Basic `get_me` smoke check |

Reports:

- Manifests are written to `.meta/bench/runs/run-YYYY-MM-DD-<sha>.manifest.json`.
- Transcripts are written to `.meta/bench/transcripts/run-YYYY-MM-DD-<sha>/scenario-<id>.ndjson`.

Failure triage:

1. Open the scenario transcript and inspect tool calls, tool results, and final process exit details.
2. Re-run a single scenario with `--scenarios <id>` to confirm whether the failure is stable.
3. Check the Notion workspace sandbox pages under the current `BENCH:` parent to inspect the persisted state directly.

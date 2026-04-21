# OSS Dev Dashboard — Exploration

**Date:** 2026-04-21
**Scope:** Feature inventory, architecture options, and MVP scope for a local-hosted dev dashboard across the Grey-Iris OSS portfolio.

---

## 1. Full Feature Inventory

### 1.1 Notion API Coverage Matrix

- **Endpoint coverage grid**: every Notion REST endpoint vs. easy-notion-mcp tool that wraps it (implemented / partial / not implemented / impossible). Source: `.meta/audits/notion-api-gap-audit-2026-04-20.md` §3.1–3.2.
- **Property type matrix**: 20 Notion property types × 4 operations (schema-create, schema-update, value-write, value-read). Source: gap audit §2.1.
- **Block type coverage**: 25+ Notion block types vs. what `markdown-to-blocks.ts` and `blocks-to-markdown.ts` handle.
- **Transport parity view**: which tools are stdio-only vs. both transports (currently only `create_page_from_file` is stdio-only).
- **Competitor comparison column**: same matrix for awkoy/notion-mcp-server, side-by-side. Source: `.meta/research/compare-awkoy-notion-mcp.md`.
- **"Next to implement" ranker**: sort uncovered endpoints by user-pain (from gap audit) × implementation cost.
- **Changelog diff view**: what the pinned version (2025-09-03) misses vs. latest (2026-03-11). Source: `reddit-feasibility-scan.md` §Version context.
- **Views API surface**: 8 endpoints, zero coverage. Per-view-type breakdown (Table/Board/Calendar/Timeline/Gallery/List/Map/Form/Chart).

### 1.2 Notion-Version Currency

- **Current pin display**: `2025-09-03` with link to Notion changelog.
- **Latest version display**: `2026-03-11` (fetched or hand-updated).
- **Drift indicator**: days/versions behind, color-coded.
- **Breaking changes list**: the 3 known renames (`after→position`, `archived→in_trash`, `transcription→meeting_notes`) and their codebase status.
- **New capabilities unlocked by upgrade**: Views API, verification writes on wiki pages, structured icon type, page-level properties on non-DB pages.
- **Migration readiness score**: how many breaking changes are already handled (1 of 3 — `archived→in_trash` migrated, other two pending).

### 1.3 Tokens-Saved Benchmark

- **Comparative task matrix**: 10–20 canonical Notion tasks (create page, query DB, update properties, etc.) run against easy-notion-mcp vs. awkoy vs. raw Notion API blocks.
- **Per-task metrics**: input tokens, output tokens, wall time, success/failure, retries.
- **Aggregate scorecard**: % token reduction vs. raw blocks, % token reduction vs. competitors.
- **Historical trend**: re-run weekly or per-release, show regression/improvement over time.
- **Methodology transparency page**: exact prompts, model, temperature, run count.

### 1.4 GitHub Traffic / Stars / Forks

- **Repo selector**: dropdown or tabs per Grey-Iris repo.
- **Traffic time series**: clones and views (unique + total) over 30/90/all-time windows. Already built in github-analytics.
- **Stars/forks trend**: cumulative line chart with daily deltas. Already built.
- **Referrer breakdown**: top referrers table + referrer trend over time. Already built.
- **Popular paths**: top content paths by views. Already built.
- **New-this-week strip**: new referrers/paths in last 7 days. Already built.
- **Release-timeline overlay**: git tags on the traffic chart, so you can see which release caused which bump.
- **Referrer spike alerts**: highlight days where referrer traffic jumps >2σ from rolling average.
- **First-time contributor arrivals**: new contributors per week overlaid on traffic.
- **Cross-repo comparison**: side-by-side traffic for easy-notion-mcp vs. other Grey-Iris repos.

### 1.5 Package / Repo Health

- **npm download trend**: weekly downloads over time (npm API or npm-stat).
- **Latest published version + publish recency**: version badge, "3 days ago" / "2 weeks ago".
- **Bundle size trend**: per-release, track minified + gzipped size (bundlephobia API or local build).
- **Dependency freshness matrix**: for each dep, current version vs. latest, weeks behind, color-coded.
- **`npm audit` state**: current vulnerability count by severity, with allowlisted-CVE tracking and re-verification dates.
- **Dependabot alert count**: open alerts by severity.
- **TypeScript strictness**: `any` count across codebase (grep-derived), trend over time.
- **Dead code / unused exports**: count of unused exports (ts-prune or knip output).
- **Docs freshness**: for each doc file, compare last-edit date vs. neighboring code last-edit. Stale docs highlighted.
- **License compliance**: deps license scan (all MIT/Apache? any GPL contamination?).

### 1.6 CI Health

- **Pass rate (30 days)**: % of CI runs that passed on first attempt, per workflow.
- **Flake rate**: runs that failed then passed on re-run without code changes.
- **Time-to-green**: p50/p95 wall-clock from push to green check, per workflow.
- **Failing-on-main streak**: consecutive failing commits on main (should be 0).
- **Per-workflow breakdown**: separate cards for test, lint, build, release workflows.
- **Slowest test identification**: which test files take the longest (from CI logs or local run).

### 1.7 Project Management (Tasuku)

- **Task throughput**: tasks completed per week, rolling 4-week average.
- **Time-in-status distribution**: how long tasks sit in each status (ready → in-progress → done).
- **Blocked-chain depth**: visualization of blocked→blocks-another chains.
- **Tag/epic progress bars**: % complete per tag or epic grouping.
- **"What should I do next" ranker**: ready tasks sorted by priority × age × blocking-chain impact.
- **Decisions log timeline**: entries from `.tasuku/context/decisions.md` on a timeline.
- **Learnings feed**: entries from `.tasuku/context/learnings.md`, searchable.
- **Task creation rate vs. completion rate**: are we accumulating debt?

### 1.8 PRs and Issues

- **Open PR count**: per repo, with age indicators.
- **Stale PR detection**: PRs with no activity >7 days.
- **Unresponded issues**: issues with no maintainer response.
- **Average response time**: median time to first maintainer response on issues.
- **Label breakdown**: issue/PR count by label.
- **External contributor queue**: PRs/issues from non-org members needing attention.
- **PR size distribution**: lines changed per PR, flagging outlier PRs.
- **Review turnaround**: time from PR open to first review.

### 1.9 Release Timeline

- **Tag timeline**: every git tag on a visual timeline with changelog excerpts.
- **Downloads per release**: npm download count attributed to each version.
- **Rollout velocity**: time between releases, trend.
- **Breaking change markers**: which releases had breaking changes.
- **Changelog rendering**: parsed from CHANGELOG.md or git tag annotations.

### 1.10 Security Posture

- **CVE allowlist table**: each allowlisted CVE with description, justification, and "last re-verified" date.
- **Outstanding Dependabot alerts**: count + severity breakdown.
- **Secret scanning state**: enabled/disabled, any findings.
- **GitHub security advisories on deps**: advisories affecting our dependency tree.
- **`npm audit` history**: trend of vulnerability count over time.
- **Supply chain audit trail**: pointer to `.meta/audits/hono-supply-chain-2026-04-09.md` and similar.

### 1.11 Community Signals

- **Stars velocity**: stars/week trend, compared to similar projects.
- **Reddit/HN/Twitter mentions**: keyword monitoring for "easy-notion-mcp" (manual or via API if available).
- **First-time contributors**: new contributor count per month.
- **Issue engagement**: comments per issue trend, community vs. maintainer ratio.
- **npm dependent count**: how many packages depend on easy-notion-mcp.

### 1.12 Handoff / Audit Queue

- **Unprocessed handoffs**: `.meta/handoffs/*.md` files not yet reviewed, with age.
- **Unprocessed audits**: `.meta/audits/*.md` files not yet actioned.
- **Cross-repo aggregation**: scan all portfolio repos for `.meta/handoffs/` and `.meta/audits/`.
- **Staleness indicator**: days since last handoff/audit was processed.

### 1.13 Additional Categories

- **MCP ecosystem positioning**: tool count, transport count, auth modes vs. other Notion MCPs (awkoy, plus any new entrants). Periodic re-scan.
- **Test health**: test count, coverage %, test-to-code ratio trend, slowest tests.
- **Documentation coverage**: README sections vs. feature surface, API doc completeness.
- **Workspace root page health** (Notion-side): page count, DB count, orphaned pages, storage usage if API exposes it.

---

## 2. Per-Feature Value × Cost × Data Source

| # | Feature | Value | Cost | Data Source |
|---|---|---|---|---|
| **1.1 Coverage Matrix** | | | | |
| Endpoint coverage grid | High | M | Easy — gap audit already exists as markdown; parse or maintain YAML |
| Property type matrix | High | S | Easy — gap audit §2.1 |
| Block type coverage | Med | M | Moderate — requires walking `markdown-to-blocks.ts` |
| Transport parity view | Low | S | Easy — grep `transports:` in server.ts |
| Competitor comparison column | High | M | Moderate — awkoy comparison exists; needs periodic re-check |
| "Next to implement" ranker | High | S | Easy — derived from coverage + user-pain scores |
| Changelog diff view | Med | M | Moderate — Notion changelog is HTML, no structured API |
| Views API surface | Med | S | Easy — reddit-feasibility-scan.md has the data |
| **1.2 Version Currency** | | | | |
| Current pin display | Med | S | Easy — grep codebase |
| Latest version display | Med | S | Moderate — scrape Notion changelog or hardcode |
| Drift indicator | Med | S | Easy — derived |
| Breaking changes list | High | S | Easy — already documented |
| New capabilities unlocked | High | M | Moderate — requires reading changelog per version |
| Migration readiness score | Med | S | Easy — derived from codebase grep |
| **1.3 Benchmark** | | | | |
| Comparative task matrix | High | XL | Hard — needs separate test harness, MCP client, multiple servers |
| Per-task metrics | High | L | Hard — instrumented test runner |
| Aggregate scorecard | High | S | Easy — derived from task matrix |
| Historical trend | Med | M | Moderate — CI or cron job to re-run |
| Methodology page | Med | S | Easy — static doc |
| **1.4 GitHub Traffic** | | | | |
| Traffic time series | High | S | Easy — github-analytics already built |
| Stars/forks trend | High | S | Easy — already built |
| Referrer breakdown | Med | S | Easy — already built |
| Popular paths | Med | S | Easy — already built |
| New-this-week strip | Med | S | Easy — already built |
| Release-timeline overlay | High | M | Moderate — join git tags with traffic dates |
| Referrer spike alerts | Med | M | Moderate — statistical detection |
| First-time contributor arrivals | Med | M | Moderate — GH API contributor list, diff over time |
| Cross-repo comparison | Med | S | Easy — data already collected per-repo |
| **1.5 Package Health** | | | | |
| npm download trend | Med | M | Moderate — npm API or npm-stat, needs collection job |
| Published version + recency | Med | S | Easy — npm registry API |
| Bundle size trend | Med | L | Moderate — needs build + measure per release |
| Dependency freshness matrix | High | M | Moderate — `npm outdated` output, needs parsing |
| npm audit state | High | S | Easy — `npm audit --json` |
| Dependabot alert count | Med | M | Moderate — GH API, needs PAT with security scope |
| TypeScript strictness (`any` count) | Low | S | Easy — `grep -c "any"` |
| Dead code / unused exports | Low | M | Moderate — ts-prune or knip setup |
| Docs freshness | Low | M | Moderate — git log comparison |
| License compliance | Low | S | Easy — `license-checker` npm package |
| **1.6 CI Health** | | | | |
| Pass rate (30d) | Med | M | Moderate — GH Actions API, needs aggregation |
| Flake rate | Med | L | Hard — needs re-run detection logic |
| Time-to-green | Med | M | Moderate — GH Actions API timing data |
| Failing-on-main streak | High | S | Easy — GH Actions API latest runs |
| Per-workflow breakdown | Med | M | Moderate — one query per workflow |
| Slowest test identification | Low | M | Moderate — parse CI logs or run locally |
| **1.7 Tasuku** | | | | |
| Task throughput | Med | M | Moderate — parse task files for status changes (no timestamps in current format) |
| Time-in-status | Med | L | Hard — tasuku files don't track status transitions with timestamps |
| Blocked-chain depth | Med | M | Moderate — parse `blocked_by` fields |
| Tag/epic progress bars | Med | M | Moderate — parse tags from task files |
| "What next" ranker | High | M | Moderate — combine priority, age, blocking info |
| Decisions timeline | Med | S | Easy — parse `decisions.md` |
| Learnings feed | Med | S | Easy — parse `learnings.md` |
| Creation vs. completion rate | Med | M | Moderate — needs git history of `.tasuku/tasks/` |
| **1.8 PRs and Issues** | | | | |
| Open PR count | Med | S | Easy — `gh pr list` |
| Stale PR detection | Med | S | Easy — filter by `updatedAt` |
| Unresponded issues | High | M | Moderate — need to check for maintainer comments |
| Average response time | Med | M | Moderate — GH API issue timeline |
| Label breakdown | Low | S | Easy — `gh issue list` with labels |
| External contributor queue | High | M | Moderate — filter by author association |
| PR size distribution | Low | M | Moderate — GH API PR stats |
| Review turnaround | Med | M | Moderate — GH API review timeline |
| **1.9 Release Timeline** | | | | |
| Tag timeline | Med | M | Moderate — git tags + UI rendering |
| Downloads per release | Med | M | Moderate — npm API per-version |
| Rollout velocity | Med | S | Easy — derived from tag dates |
| Breaking change markers | Med | S | Easy — semver major detection |
| Changelog rendering | Med | M | Moderate — parse CHANGELOG.md |
| **1.10 Security** | | | | |
| CVE allowlist table | High | M | Moderate — need structured allowlist file |
| Dependabot alerts | Med | M | Moderate — GH API security scope |
| Secret scanning state | Low | S | Easy — GH API |
| Security advisories on deps | Med | M | Moderate — GH Advisory API |
| npm audit history | Med | M | Moderate — needs periodic collection |
| Supply chain audit trail | Med | S | Easy — link to `.meta/audits/` |
| **1.11 Community** | | | | |
| Stars velocity | Med | S | Easy — derived from existing star data |
| Social mentions | Low | XL | Hard — Reddit/HN APIs are limited; Twitter requires paid API |
| First-time contributors | Med | M | Moderate — GH API |
| Issue engagement | Low | M | Moderate — comment count aggregation |
| npm dependent count | Low | S | Easy — npm API |
| **1.12 Handoff/Audit Queue** | | | | |
| Unprocessed handoffs | High | S | Easy — glob `.meta/handoffs/*.md` |
| Unprocessed audits | Med | S | Easy — glob `.meta/audits/*.md` |
| Cross-repo aggregation | Med | M | Moderate — needs multi-repo file scanning |
| Staleness indicator | Med | S | Easy — file mtime |
| **1.13 Additional** | | | | |
| MCP ecosystem positioning | Med | L | Hard — periodic manual or automated competitor scan |
| Test health | Med | S | Easy — vitest output |
| Documentation coverage | Low | M | Moderate — heuristic comparison |

---

## 3. Architecture Options

### Option A: Extend github-analytics → `oss-dashboard`

**What it is.** Rename `github-analytics` to `oss-dashboard`. Keep the existing Vite+React+Recharts SPA, nginx serving, Docker deployment, and GH Actions collection. Add new data collectors alongside `scripts/collect.ts`. Add new React components alongside existing ones. The aggregated `data.json` grows to include all new data sources.

**Upfront cost:** Small. Existing infra works. Add collectors incrementally. First panel ships in hours.

**Long-term flexibility:** Limited. The "one big `data.json`" model gets unwieldy as data sources multiply. The 60-second git-poll refresh loop is clever for traffic data (daily collection, minutes-stale is fine) but wrong for tasuku tasks or handoff queues (local filesystem, should be live). Adding non-GitHub data sources (npm, Notion changelog, local `.tasuku/`) to a GH Actions collection job is awkward — some data is local-only.

**Operational complexity:** Low. One container, one repo, one build. But the container needs access to local filesystems (tasuku, .meta/) which breaks the current "GitHub-hosted collector → git push → container polls git" model.

**Scope creep risk:** High. The existing codebase has strong conventions (Docker, nginx, GH Actions push-to-git-as-storage) that don't fit non-GitHub data. You'll fight the architecture or duplicate patterns.

**Verdict:** Good for the GitHub-centric panels (traffic, PRs, CI, releases). Bad for local-data panels (tasuku, handoffs, coverage matrix).

### Option B: Clean-slate multi-project dashboard

**What it is.** New repo (`oss-dashboard`). Vite+React+Recharts (same stack for consistency). One unified backend that collects from multiple sources: GitHub API, npm API, local filesystem (tasuku, .meta/), static YAML (coverage matrix). github-analytics' collection logic is absorbed — its React components may be portable, its data format becomes one of several inputs.

**Upfront cost:** Medium. Need to scaffold the project, but the stack is familiar. Can copy github-analytics React components and collection logic. The real work is the multi-source data layer.

**Long-term flexibility:** High. Each data source is a collector module with its own cadence. The dashboard is a consumer, not coupled to any one collection method. New repos or data sources plug in without rearchitecting.

**Operational complexity:** Medium. One repo, one process, but internally it has N collector modules. Each needs its own error handling, cadence, and caching. A thin backend (Express or Hono) serves the SPA and provides API routes. Alternatively, collectors write JSON files and the SPA reads them statically (like github-analytics does today).

**Scope creep risk:** Medium. Clean-slate invites over-engineering. Mitigated by copying the github-analytics pattern (static JSON, no database) rather than building a "real" backend.

**Verdict:** Best balance of flexibility and simplicity. Absorb github-analytics' working patterns without inheriting its constraints.

### Option C: Federation — micro-services + thin dashboard

**What it is.** Multiple backend services, each owning one data domain:
- `github-collector` — traffic, stars, PRs, CI (evolved from github-analytics)
- `benchmark-runner` — token-savings benchmark (already agreed to be separate)
- `tasuku-exporter` — reads `.tasuku/` and exposes JSON
- `notion-api-watcher` — tracks Notion changelog, API version drift
- `coverage-builder` — generates coverage matrix from codebase analysis

A thin dashboard SPA reads from all services via HTTP. Each service has its own repo, container, cadence.

**Upfront cost:** Large. N repos, N Docker configs, N deployment configs. Coordination overhead before any panel ships.

**Long-term flexibility:** Highest in theory. Each service evolves independently. But for a one-person portfolio this is organizational overhead without organizational benefit.

**Operational complexity:** High. Multiple containers, multiple health checks, multiple failure modes. Debugging "why is the dashboard stale?" means checking N services.

**Scope creep risk:** Low per service, but the meta-system (service discovery, deployment orchestration, shared types) becomes its own project.

**Verdict:** Over-engineered for a solo-maintainer portfolio. The federation tax only pays off with multiple contributors or services that genuinely need independent scaling.

### Recommendation

**Option B** — clean-slate with absorbed github-analytics patterns. Rationale:

1. github-analytics' React components and collection logic are portable; its architectural constraints (git-as-storage, GH Actions-only collection) are not.
2. The dashboard needs local filesystem access (tasuku, .meta/, coverage YAML) that doesn't fit github-analytics' remote-collection model.
3. A single repo with collector modules keeps operational complexity low while allowing per-source cadence.
4. The benchmark pipeline stays separate (its own repo) — the dashboard just reads its output.

The migration path: start the new repo, copy github-analytics' `scripts/collect.ts` and React components, add local-data collectors. github-analytics continues running during migration. Once the new dashboard serves all existing github-analytics panels, archive the old repo.

---

## 4. MVP Scope (First Build Session, ~1 Day)

**Target:** A locally-served dashboard that's valuable from the first load. Focus on data that already exists or is trivial to collect.

### MVP Panels

1. **Notion API Coverage Matrix** — render the gap audit data as an interactive grid. Source: hand-curated YAML file seeded from `.meta/audits/notion-api-gap-audit-2026-04-20.md`. Endpoint rows × status columns. Filterable by status (implemented/partial/missing/impossible). This is the single highest-value panel — it answers "what should I build next?" at a glance.

2. **Notion-Version Currency** — static card showing pinned version, latest version, drift days, and the 3 breaking changes with migration status. Source: YAML config file, manually updated when Notion publishes.

3. **GitHub Traffic** — port github-analytics' existing components wholesale. Traffic, stars, referrers, popular paths. Source: copy `data/*.json` or point at github-analytics' `public/data.json`.

4. **Handoff / Audit Queue** — list unprocessed `.meta/handoffs/*.md` and `.meta/audits/*.md` with file age. Source: filesystem glob at build/serve time.

5. **Tasuku Overview** — task count by status, "what should I do next" (ready tasks sorted by priority). Source: parse `.tasuku/tasks/*.md` at serve time.

6. **Package Quick Stats** — latest npm version, days since publish, npm weekly downloads, current `npm audit` count. Source: npm registry API (single fetch on load).

### Explicitly Excluded from MVP

- Benchmark pipeline (separate sub-project, not a dashboard feature)
- CI health (needs GH Actions API collection job — add in v2)
- PR/issue analytics (needs GH API collection — add in v2)
- Release timeline (needs tag-to-npm join logic — add in v2)
- Community signals (low value-to-effort ratio for MVP)
- Social mention monitoring (Hard data source, low priority)

### Tech Stack for MVP

- **Vite + React + TypeScript** (same as github-analytics — familiar, fast)
- **Recharts** for charts (already used in github-analytics)
- **Tailwind CSS** for layout (fast to style, responsive for eventual mobile)
- **Express or Hono** thin backend — serves the SPA, provides `/api/` routes for local-data panels (tasuku, handoffs, coverage YAML). GitHub traffic data loaded from static JSON files (ported from github-analytics).
- **No database.** JSON files for collected data, YAML for curated data (coverage matrix, version info). Same pattern as github-analytics.

---

## 5. v2 and v3 Scopes

### v2 — Collection Infrastructure (~1–2 weeks after MVP)

- **GitHub API collection job**: absorb github-analytics' `scripts/collect.ts`, add PR/issue collection, CI run history. Run via cron or GH Actions (same pattern as today).
- **CI health panels**: pass rate, time-to-green, flake detection.
- **PR/issue panels**: open count, stale detection, external contributor queue, response times.
- **Release timeline**: git tags × npm downloads × changelog excerpts.
- **Dependency freshness matrix**: `npm outdated` output, auto-collected.
- **Security posture panels**: npm audit history, Dependabot alerts (GH API).
- **npm download trend**: periodic collection from npm API.

### v3 — Benchmark + Polish (~1 month+)

- **Benchmark sub-project integration**: the dashboard displays results from the separate benchmark-runner repo. Benchmark-runner writes JSON results to a known location; dashboard reads them.
- **Mobile access via Tailscale**: the dashboard is already a web app — mobile access is a network/deployment concern, not a code concern. Set up Tailscale on the host, expose the dashboard port. May need responsive CSS pass.
- **MCP ecosystem comparison**: periodic competitor re-scan, displayed alongside coverage matrix.
- **TypeScript strictness / dead code trends**: collected per-commit or per-release.
- **Docs freshness**: git-log comparison heuristic.
- **Community signals**: stars velocity chart, npm dependent count. Skip social monitoring unless a low-effort API surfaces.

### Public-facing polish

Probably never, or v4+ at earliest. The dashboard is a dev tool for a solo maintainer. If easy-notion-mcp grows to the point where public project health visibility matters (e.g., for contributor onboarding), the coverage matrix and release timeline could be extracted to a GitHub Pages site. But that's a different project with different constraints (static generation, no local data, public-safe content only).

---

## 6. Open Decisions

### Must resolve before planning

1. **Coverage matrix authoring**: Hand-curated YAML (updated manually when implementing features) or agent-refreshed (a script parses `server.ts` and `notion-client.ts` to auto-detect coverage)? The gap audit already exists as prose — converting it to structured YAML is a one-time task. Keeping it current is the question. **Recommendation:** Start with hand-curated YAML, seeded from the gap audit. Add an agent-refresh script in v2 that detects obvious coverage changes (new tool registered, new property type in `schemaToProperties`). The YAML remains the source of truth; the script flags drift.

2. **Tasuku data export format**: The dashboard needs to read `.tasuku/tasks/*.md`. Options: (a) parse the markdown files directly at serve time, (b) add a `tasuku export --json` command that dumps structured data, (c) the dashboard's backend parses them into JSON on startup and re-scans on filesystem change. **Key constraint:** tasuku task files currently have no timestamps for status transitions — only current status. Time-in-status and throughput metrics require either adding timestamps to the format or inferring from git history.

3. **Data collection cadence per source**:
   - GitHub traffic: daily (API retains 14 days) — keep existing GH Actions schedule
   - npm downloads: daily or weekly — low-volume, weekly is fine for MVP
   - CI health: daily aggregation of GH Actions API
   - Tasuku / handoffs / coverage: live (filesystem read on each dashboard load or via fswatch)
   - Notion version: manual update or weekly scrape
   - Security (npm audit, Dependabot): daily

4. **github-analytics migration timing**: absorb immediately (copy code into new repo on day one) or run in parallel until the new dashboard has feature parity? **Recommendation:** Run in parallel. Copy the collection logic and React components on day one, but don't decommission github-analytics until the new dashboard serves all its current panels reliably.

5. **Benchmark sub-project scope**: What exactly does it measure? Needs: a standardized task list, an MCP client harness that can target different servers, token counting instrumentation, and a results format the dashboard can consume. This is probably a 2–3 day build on its own. **Key question:** Does it run against live Notion (real API calls, real latency) or a mock? Live gives realistic token counts but is slow and rate-limited. Mock is fast but may miss real-world edge cases.

6. **Repo name and location**: `oss-dashboard`? `dev-dashboard`? `grey-iris-dashboard`? Where does it live — `/mnt/d/backup/projects/personal/oss-dashboard`? Public or private repo?

### Nice to resolve but not blocking

7. **Dashboard refresh model**: full page reload, polling (like github-analytics' 60s git-SHA poll), or WebSocket push from the backend? For MVP, polling every 60s or manual refresh is fine.

8. **Multi-repo support from day one or single-repo first?** The coverage matrix and tasuku panels are easy-notion-mcp-specific. GitHub traffic is already multi-repo. Design the data model for multi-repo from the start, but only populate easy-notion-mcp initially.

9. **Theming**: github-analytics has no theming. Does the new dashboard get dark mode? Tailwind makes this cheap. Probably yes — you'll use it at night.

---

## 7. Reference: Existing Assets

| Asset | Path | Relevance |
|---|---|---|
| Notion API gap audit | `.meta/audits/notion-api-gap-audit-2026-04-20.md` | Seeds the coverage matrix YAML. Endpoint list (§3.1–3.2), property matrix (§2.1), and user-pain ratings. |
| Reddit feasibility scan | `.meta/research/reddit-feasibility-scan.md` | 7 capability buckets with API feasibility verdicts. Version drift data. Views API surface detail. |
| Awkoy comparison | `.meta/research/compare-awkoy-notion-mcp.md` | Side-by-side competitor analysis. Tool count, content model, transport, auth, tests. Feeds competitor column in coverage matrix. |
| github-analytics | `/mnt/d/backup/projects/personal/github-analytics` | Working Vite+React+Recharts dashboard with Docker/nginx serving. Collection scripts (`scripts/collect.ts`, `scripts/aggregate.ts`). Data format in `data/*.json`. React components in `src/components/`. GH Actions workflows. Entire codebase is portable. |
| agent-listener | `/mnt/d/backup/projects/personal/agent-listener` | PR-bot pattern: `github-poller.ts` polls `gh pr list`, dispatches one-shot Claude Code jobs. Relevant model for any "collect data from GitHub API on a schedule" pattern. Also demonstrates Discord notification integration that could inform dashboard alerts. |
| Tasuku tasks | `.tasuku/tasks/` (65+ files) | Task inventory for easy-notion-mcp. Dashboard needs to parse these. |
| Tasuku decisions | `.tasuku/context/decisions.md` | Architectural decisions log — dashboard can render this as a timeline. |
| Tasuku learnings | `.tasuku/context/learnings.md` | Accumulated learnings — dashboard can render as searchable feed. |
| Version pin memory | Memory: `project_notion_version_pin.md` | Documents pinned version (2025-09-03), breaking changes, migration status. Seeds version currency panel. |
| Handoffs | `.meta/handoffs/*.md` (3 files) | Example handoff files for the handoff queue panel. |
| Audits | `.meta/audits/*.md` (10 files) | Example audit files for the audit queue panel. |
| server.ts tool registry | `src/server.ts:461–907` | 28 tool definitions. Source of truth for "what's implemented" side of coverage matrix. |
| notion-client.ts | `src/notion-client.ts` | SDK wrapper layer. `schemaToProperties` (line 145–189) and `convertPropertyValue` (line 197–250) define property type support boundaries. |

---

## What I Didn't Explore

- **Alternative frontend frameworks** (Svelte, Solid, Vue). Stuck with React because github-analytics uses it and components are portable. If starting truly clean, Svelte would be lighter, but the migration benefit dominates.
- **Database-backed storage** (SQLite, Postgres). The "JSON files on disk" model from github-analytics works for the scale of a solo-maintainer portfolio. If data volume grows (years of CI history, thousands of benchmark runs), SQLite would be the natural upgrade. Not worth the complexity now.
- **Hosted alternatives** (Grafana, Datadog, Linear). These solve subsets of the problem but not the Notion-specific panels (coverage matrix, version currency) or the tasuku integration. The value is in the bespoke combination, not any single metric.
- **Public dashboard services** (shields.io, codecov, bundlephobia embeds). These could supplement the dashboard but not replace it. Worth embedding as iframes or API sources in v2.
- **AI-assisted "what should I do next" ranking**. The tasuku ranker in the feature list is rules-based (priority × age × blocking). An LLM-based ranker that considers project context is interesting but out of scope for a dashboard.

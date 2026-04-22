# OSS Dashboard MVP Plan (Four-Surface System)

**Date:** 2026-04-21
**Status:** Plan complete, pending human review
**Build order:** README badges (half day) > Discord digest bot (half day) > Web dashboard (one day)

---

## Section 1: Repo Layout for `oss-dashboard`

Target path: `/mnt/d/backup/projects/personal/oss-dashboard/`

```
oss-dashboard/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  components.json            # shadcn/ui config
  index.html
  .gitignore
  CLAUDE.md

  public/
    data/                    # collected JSON (gitignored, generated)
      github-traffic.json    # aggregated GitHub traffic (same schema as github-analytics)
      npm-stats.json         # npm version, downloads, audit
      coverage-matrix.json   # auto-derived + hand-curated merged
      notion-version.json    # currency data
      tasuku-overview.json   # task summary across projects
      handoff-queue.json     # pending handoffs/audits
    shields/                 # custom shields.io endpoint JSON
      notion-version.json    # { schemaVersion: 1, label, message, color }
      mcp-tool-count.json    # { schemaVersion: 1, label, message, color }

  data/                      # raw collected data (gitignored)
    Grey-Iris--easy-notion-mcp.json   # copied from github-analytics
    Grey-Iris--trellis.json           # copied from github-analytics

  src/
    main.tsx
    App.tsx
    index.css                # Tailwind base

    components/
      ui/                    # shadcn/ui primitives (installed via CLI)
      layout/
        Dashboard.tsx        # grid shell, dark mode toggle, refresh button
        PanelCard.tsx        # shared card wrapper with "as of" timestamp
      panels/
        CoverageMatrix.tsx   # interactive grid with filters
        NotionVersion.tsx    # currency card
        GitHubTraffic.tsx    # ported from github-analytics
        TaskuOverview.tsx    # task counts + "what next" list
        HandoffQueue.tsx     # pending handoffs/audits table
        PackageStats.tsx     # npm version, downloads, dep freshness

    hooks/
      useData.ts             # fetch JSON from public/data/, return with staleness info
      useDarkMode.ts         # localStorage-persisted dark mode

    lib/
      types.ts               # shared TypeScript interfaces (all panel data shapes)
      freshness.ts           # "as of" age formatting, stale threshold detection

  scripts/
    collect-all.ts           # orchestrator: runs all collectors, writes public/data/
    collect-github.ts        # GitHub traffic (ported from github-analytics collect.ts)
    collect-npm.ts           # npm registry + npm outdated
    collect-coverage.ts      # auto-derive from easy-notion-mcp server.ts + notion-client.ts
    collect-notion-version.ts # fetch latest version from developers.notion.com
    collect-tasuku.ts        # tk task list -f json across project dirs
    collect-handoffs.ts      # glob .meta/handoffs/ and .meta/audits/ across projects
    aggregate.ts             # merge raw data/ into public/data/ (ported from github-analytics)
    generate-shields.ts      # write public/shields/*.json

  coverage/
    notion-api.yaml          # hand-curated "Notion side" of coverage matrix
    overrides.yaml           # manual corrections to auto-derived data
```

### Dependencies (package.json)

```json
{
  "name": "oss-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npm run collect && vite",
    "build": "npm run collect && vite build",
    "collect": "tsx scripts/collect-all.ts",
    "collect:github": "tsx scripts/collect-github.ts",
    "shields": "tsx scripts/generate-shields.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@octokit/rest": "^21.1.1",
    "@radix-ui/react-icons": "^1.3.2",
    "@tanstack/react-table": "^8.21.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "js-yaml": "^4.1.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "recharts": "^3.8.1",
    "tailwind-merge": "^3.0.2"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.4",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.13.14",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.7.0",
    "tailwindcss": "^4.1.4",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vite": "^6.4.1",
    "vitest": "^3.1.1"
  }
}
```

Notes on version choices:
- React 19, Vite 6, Tailwind v4 (matches github-analytics' React 19 / Vite 6 pins).
- TanStack Table v8 for the coverage matrix (sortable, filterable columns).
- Recharts 3 (same as github-analytics; components port directly).
- `js-yaml` for parsing the hand-curated coverage YAML.
- shadcn/ui components installed via `npx shadcn@latest init` + individual component adds (Card, Table, Badge, Button, Tabs, DropdownMenu, Switch). Not listed as a dep because shadcn copies component source into `src/components/ui/`.

### Config files

**vite.config.ts:** Same as github-analytics but output to `dist/`.

**tailwind.config.ts:** Tailwind v4 uses CSS-first config. The `tailwind.config.ts` file is only needed for the `darkMode: "class"` setting and content paths. shadcn/ui's `components.json` handles the rest.

**tsconfig.json:** `strict: true`, `module: "ESNext"`, `moduleResolution: "bundler"`, path alias `@/*` to `src/*`.

---

## Section 2: Build Steps in Order

### Surface 1: README Badges (half day)

**Context:** Add 5 shields.io pills to easy-notion-mcp's README. Three are standard shields; two are custom (backed by JSON endpoints served from oss-dashboard).

#### Steps

1. **Write tests for `generate-shields.ts`** in `oss-dashboard/scripts/__tests__/generate-shields.test.ts`. Test that the output conforms to shields.io's endpoint schema (`{ schemaVersion: 1, label: string, message: string, color: string }`). Test the Notion-Version currency logic (fresh/stale/behind). Test the tool count extraction.
   - Acceptance: tests exist and fail (no implementation yet).

2. **Implement `generate-shields.ts`** in oss-dashboard. Two functions:
   - `generateNotionVersionShield(pinnedVersion, latestVersion)`: returns `{ schemaVersion: 1, label: "Notion API", message: "2025-09-03 (1 behind)", color: "yellow" }`. Color logic: green if pinned === latest, yellow if 1 behind, red if 2+ behind.
   - `generateToolCountShield(toolCount)`: returns `{ schemaVersion: 1, label: "MCP tools", message: "28 tools", color: "informational" }`.
   - Writes to `public/shields/notion-version.json` and `public/shields/mcp-tool-count.json`.
   - Acceptance: tests pass.

3. **Write test for tool count extraction** in `scripts/__tests__/collect-coverage.test.ts`. Test that parsing `server.ts` yields the correct tool count (currently 28 based on the `name:` grep).
   - Acceptance: test exists and fails.

4. **Implement tool count extractor** in `scripts/collect-coverage.ts` (partial; the full coverage deriver is built later for the dashboard). Exports `extractToolCount(serverTsPath: string): number`. Counts lines matching `name: "` within the tools array.
   - Acceptance: test passes.

5. **Wire `generate-shields.ts` into `collect-all.ts`** (stub collect-all for now; full implementation in dashboard phase).
   - Acceptance: `npm run shields` produces valid JSON in `public/shields/`.

6. **Scaffold the oss-dashboard repo.** `npm init`, install deps, create config files, `npx shadcn@latest init`. Verify `npm run dev` shows a blank Vite page.
   - Acceptance: `vite dev` serves on localhost.

7. **Configure Vite to serve `public/shields/` with CORS headers.** The shields.io endpoint fetcher needs `Access-Control-Allow-Origin: *`. Add a Vite plugin or middleware in `vite.config.ts`.
   - Acceptance: `curl -I http://localhost:5173/shields/notion-version.json` shows CORS header.

8. **Add the 5 badge lines to easy-notion-mcp's README.md.** Format:
   ```markdown
   [![npm version](https://img.shields.io/npm/v/easy-notion-mcp)](https://www.npmjs.com/package/easy-notion-mcp)
   [![npm downloads](https://img.shields.io/npm/dw/easy-notion-mcp)](https://www.npmjs.com/package/easy-notion-mcp)
   [![CI](https://github.com/Grey-Iris/easy-notion-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Grey-Iris/easy-notion-mcp/actions)
   [![Notion API](https://img.shields.io/endpoint?url=<SHIELDS_ENDPOINT_URL>&cacheSeconds=86400)](link-tbd)
   [![MCP tools](https://img.shields.io/endpoint?url=<SHIELDS_ENDPOINT_URL>&cacheSeconds=86400)](link-tbd)
   ```
   - The custom shield URLs depend on where the JSON is hosted. See Section 5 for the endpoint decision.
   - Acceptance: standard badges render on GitHub. Custom badges render once the endpoint is live.

9. **Add a daily cron script** (or document the manual command) that runs `npm run shields` in oss-dashboard and copies output to wherever the endpoint is hosted.
   - Acceptance: documented in oss-dashboard's CLAUDE.md.

10. **Verify on GitHub.** Push the README change, confirm the 3 standard badges render. Custom badges will show "invalid" until the endpoint is live; that's expected.
    - Acceptance: 3 of 5 badges render; 2 show placeholder.

### Surface 2: Discord Digest Bot (half day)

**Context:** Weekly Monday digest posted to Discord channel `1496306249329803408`. Runs inside agent-listener's Docker Compose as a new service.

#### Steps

1. **Read agent-listener's architecture.** Verify understanding of: `claude-oneshot.ts` (spawns Claude CLI), `job-runner.ts` (dedup + queue), `github-poller.ts` (timer loop + state file + deliver function). The digest bot mirrors this pattern but is simpler (weekly cadence, single job, no dedup complexity).
   - Acceptance: architecture understood (already done in this planning pass).

2. **Write tests for `digest-collector.ts`** in `agent-listener/src/__tests__/digest-collector.test.ts`. Test that it assembles a data payload from mock sources (GitHub stats, npm stats, tasuku summary, handoff count, Notion version status).
   - Acceptance: tests exist and fail.

3. **Implement `digest-collector.ts`** in `agent-listener/src/`. Exports `collectDigestData(config: DigestConfig): Promise<DigestPayload>`. Calls:
   - `gh api repos/Grey-Iris/easy-notion-mcp` for stars/forks/open issues
   - npm registry API for latest version + weekly downloads
   - `tk task list -f json` for task counts (subprocess)
   - Glob for `.meta/handoffs/*.md` and `.meta/audits/*.md` counts
   - Reads `notion-version.yaml` (or the shields JSON) for currency
   - Returns a structured `DigestPayload` object.
   - Acceptance: tests pass.

4. **Write tests for `digest-prompt.ts`** in `agent-listener/src/__tests__/digest-prompt.test.ts`. Test that it formats a `DigestPayload` into a Claude prompt that asks for a 4-sentence synthesis.
   - Acceptance: tests exist and fail.

5. **Implement `digest-prompt.ts`** in `agent-listener/src/`. Exports `buildDigestPrompt(data: DigestPayload): string`. The prompt:
   - Provides the raw data as structured context
   - Asks for a 4-sentence weekly digest: (1) headline metric or event, (2) what shipped, (3) what's next, (4) any attention items
   - Instructs Claude to end with a link to the local dashboard URL
   - Acceptance: tests pass.

6. **Write tests for `digest-poller.ts`** in `agent-listener/src/__tests__/digest-poller.test.ts`. Test the timer logic: fires on Monday, skips other days, reads/writes state file correctly.
   - Acceptance: tests exist and fail.

7. **Implement `digest-poller.ts`** in `agent-listener/src/`. Pattern mirrors `github-poller.ts` but simpler:
   - `createDigestPoller(options: DigestPollerOptions): DigestPoller`
   - Checks every hour whether it's Monday and the digest hasn't been sent this week (state file: `{ lastSentWeek: "2026-W17" }`)
   - When triggered: calls `collectDigestData`, builds prompt via `buildDigestPrompt`, spawns a one-shot Claude session via existing `runOneShot`
   - Delivery: **Discord webhook** (see Section 8 risk discussion; MCP tool not available in job context)
   - State file path: `/app/data/digest-state.json` (inside the Docker volume)
   - Acceptance: tests pass.

8. **Create `config/digest.json`** in agent-listener. Contains:
   ```json
   {
     "discordWebhookUrl": "<env reference>",
     "dashboardUrl": "http://localhost:5173",
     "projectPaths": ["/opt/mcp/mcp-notion"],
     "enabled": true
   }
   ```
   - Acceptance: config file exists.

9. **Create `.env.digest-bot`** (or add to existing `.env.pr-bot` if sharing a service). Needs:
   - `DISCORD_DIGEST_WEBHOOK_URL` (webhook for channel `1496306249329803408`)
   - `GH_TOKEN` (for GitHub API calls)
   - Acceptance: env file documented.

10. **Add `digest-bot` service to `docker-compose.yml`.** Mirrors `pr-bot` service structure:
    - Same build context (agent-listener)
    - Volumes: `digest-data:/app/data`, `digest-claude:/home/agent/.claude`, host claude dir, mcp-notion read-only mount (for tasuku/handoff access)
    - Environment: digest-specific vars
    - Entry point: new `src/digest-entry.ts` (or a mode flag on existing index.ts)
    - Acceptance: `docker compose config` validates.

11. **Implement `digest-entry.ts`** in agent-listener. Minimal entry point:
    - Loads config
    - Creates digest poller
    - Starts it
    - Exposes health endpoint
    - Acceptance: service starts in Docker, health check passes.

12. **End-to-end test.** Force-trigger the digest (bypass day-of-week check), verify Discord message appears in channel.
    - Acceptance: message posted, contains 4-sentence synthesis + dashboard link.

### Surface 3: Web Dashboard MVP (one day)

**Context:** 6-panel dashboard at oss-dashboard. Repo already scaffolded from badge phase.

#### Steps

1. **Write tests for `collect-github.ts`** (port of github-analytics collect.ts). Test merge logic for traffic entries (can reuse github-analytics' existing tests).
   - Acceptance: tests exist and fail.

2. **Port `collect.ts` and `aggregate.ts` from github-analytics.** Copy, adapt paths. Key changes:
   - Data dir: `oss-dashboard/data/` instead of `github-analytics/data/`
   - Config: inline or `config.json` in oss-dashboard root
   - Remove Discord notification (that's the digest bot's job now)
   - Export merge functions for testing
   - Acceptance: `npm run collect:github` produces `data/Grey-Iris--easy-notion-mcp.json`.

3. **Write tests for `collect-npm.ts`.** Test npm registry response parsing, `npm outdated` JSON parsing.
   - Acceptance: tests exist and fail.

4. **Implement `collect-npm.ts`.** Fetches:
   - `https://registry.npmjs.org/easy-notion-mcp` for version, publish date
   - `https://api.npmjs.org/downloads/point/last-week/easy-notion-mcp` for weekly downloads
   - `npm audit --json` via subprocess for vulnerability count
   - `npm outdated --json` via subprocess for dep freshness
   - Writes `public/data/npm-stats.json`
   - Acceptance: tests pass.

5. **Write tests for `collect-coverage.ts`** (the full auto-deriver). Test that it parses the tool array from server.ts and the `schemaToProperties` switch from notion-client.ts. Test YAML loading for the Notion-side data.
   - Acceptance: tests exist and fail.

6. **Implement `collect-coverage.ts`.** Two-layer approach:
   - **Our side (auto-derived):** Parse `server.ts` for tool names (grep `name: "`). Parse `notion-client.ts:schemaToProperties` switch cases for schema-creatable types. Parse `convertPropertyValue` switch for value-writable types. Parse `simplifyProperty` for readable types. Output: `{ tools: string[], propertyTypes: { type, schemaCreate, valueWrite, valueRead }[], endpoints: { method, path, wrapped }[] }`.
   - **Notion side (YAML):** Load `coverage/notion-api.yaml`. Schema: `{ endpoints: [{ method, path, description, userPain }], propertyTypes: [{ type, schemaCreate, valueWrite, valueRead }] }`.
   - **Matrix computation:** Diff the two sides. Each endpoint/property gets a status: `implemented | partial | missing | impossible`.
   - Writes `public/data/coverage-matrix.json`
   - Acceptance: tests pass.

7. **Seed `coverage/notion-api.yaml`** from the gap audit. Convert sections 3.1, 3.2, and 2.1 of `notion-api-gap-audit-2026-04-20.md` into structured YAML. One-time manual conversion.
   - Acceptance: YAML parses and contains all endpoints from the audit.

8. **Write tests for `collect-notion-version.ts`.** Test that it produces correct currency status from pinned vs latest version strings.
   - Acceptance: tests exist and fail.

9. **Implement `collect-notion-version.ts`.** Reads:
   - Pinned version from easy-notion-mcp's `package.json` (`@notionhq/client` version) or hardcoded in a config
   - Latest version: hardcoded in `coverage/notion-api.yaml` header (manual update; scraping developers.notion.com is fragile and not worth automating for MVP)
   - Breaking changes: hardcoded list with migration status
   - Writes `public/data/notion-version.json`
   - Acceptance: tests pass.

10. **Write tests for `collect-tasuku.ts`.** Test parsing of `tk task list -f json` output.
    - Acceptance: tests exist and fail.

11. **Implement `collect-tasuku.ts`.** Runs `tk task list -f json` in each configured project directory. Aggregates:
    - Task count by status (ready, in-progress, blocked, done)
    - Top 5 ready tasks by priority (the "what next" list)
    - Blocked chain count
    - Writes `public/data/tasuku-overview.json`
    - Acceptance: tests pass.

12. **Write tests for `collect-handoffs.ts`.** Test glob + mtime extraction.
    - Acceptance: tests exist and fail.

13. **Implement `collect-handoffs.ts`.** Globs `<project>/.meta/handoffs/*.md` and `<project>/.meta/audits/*.md`. For each file: extract filename, first `# ` heading, mtime, age in days. Writes `public/data/handoff-queue.json`.
    - Acceptance: tests pass.

14. **Wire `collect-all.ts`.** Calls each collector in sequence (or parallel where independent). Also calls `aggregate.ts` and `generate-shields.ts`.
    - Acceptance: `npm run collect` populates all `public/data/` and `public/shields/` files.

15. **Build the dashboard shell.** `Dashboard.tsx`: CSS grid layout (2-column on desktop), dark mode toggle (Tailwind `dark:` classes with `class` strategy), manual refresh button, project title.
    - Acceptance: shell renders with placeholder cards.

16. **Build `PanelCard.tsx`.** Shared wrapper: title, "as of" timestamp (from data's `collectedAt` field), optional "stale" warning badge (>24h for daily data, >7d for weekly data).
    - Acceptance: card renders with mock data showing fresh and stale states.

17. **Port GitHub Traffic panel.** Copy/adapt github-analytics components: `TrafficChart.tsx`, `StarForkTrend.tsx`, `ReferrersTable.tsx`, `PopularPaths.tsx`. Wrap in `PanelCard`. Data source: `public/data/github-traffic.json`.
    - Acceptance: traffic charts render with real data from collected JSON.

18. **Build Coverage Matrix panel.** Uses TanStack Table. Columns: endpoint/property name, our status, Notion API status, user-pain rating, competitor (awkoy) status. Row status colors: green (implemented), yellow (partial), red (missing), gray (impossible). Filters: by status, by category (endpoint vs property vs block). Click a row to expand details.
    - Acceptance: matrix renders with data from coverage-matrix.json, filters work.

19. **Build Notion-Version Currency panel.** Card layout: pinned version (large), latest version, drift indicator (days/versions behind, color-coded), 3 breaking changes with checkmark/X for migration status. "Next action" recommendation: if behind, states what the upgrade would unlock.
    - Acceptance: card renders with correct data, shows recommendation.

20. **Build Tasuku Overview panel.** Status counts as color-coded badges. "What should I do next" section: top 5 ready tasks sorted by priority, each with title and tags. "Next action" recommendation: the single highest-priority ready task.
    - Acceptance: panel renders with real tasuku data.

21. **Build Handoff/Audit Queue panel.** Simple table: filename, title, age, source repo. Sorted by age descending (oldest first). "Next action" recommendation: if any item is >7 days old, flags it.
    - Acceptance: panel renders with real handoff/audit data.

22. **Build Package Stats panel.** Cards for: npm version + publish recency, weekly downloads, dep freshness summary (X of Y up-to-date), audit vulnerability count. "Next action" recommendation: if audit has high-severity findings, or if a dep is >2 major versions behind.
    - Acceptance: panel renders with real npm data.

23. **Integration test.** Full `npm run collect && npm run dev`, verify all 6 panels render with real data, dark mode works, "as of" timestamps are correct, stale detection works for any panel with old data.
    - Acceptance: all panels functional, no console errors.

---

## Section 3: Shared Data Pipeline

### Data flow

```
[External APIs]        [Local filesystem]        [Static config]
  GitHub API              .tasuku/tasks/            coverage/notion-api.yaml
  npm registry            .meta/handoffs/           coverage/overrides.yaml
                          .meta/audits/
                          src/server.ts
                          src/notion-client.ts
        |                       |                         |
        v                       v                         v
   scripts/collect-*.ts  (one per source, writes to public/data/)
        |
        v
   public/data/*.json   <-- dashboard reads these via fetch()
        |
        v
   scripts/generate-shields.ts  --> public/shields/*.json
```

### Shared TypeScript interfaces (`src/lib/types.ts`)

```typescript
// Common metadata on every collected dataset
interface CollectionMeta {
  collectedAt: string;  // ISO 8601
  source: string;       // human-readable data source name
  staleAfterMs: number; // threshold for "stale" warning
}

// Coverage matrix
interface CoverageEntry {
  category: "endpoint" | "property" | "block";
  name: string;
  description: string;
  ourStatus: "implemented" | "partial" | "missing" | "not-applicable";
  notionStatus: "available" | "not-available" | "deprecated";
  competitorStatus?: "implemented" | "partial" | "missing" | "unknown";
  userPain: "high" | "medium" | "low";
  notes?: string;
}

interface CoverageMatrixData extends CollectionMeta {
  entries: CoverageEntry[];
  summary: {
    total: number;
    implemented: number;
    partial: number;
    missing: number;
    notApplicable: number;
  };
  toolCount: number;
}

// Notion version currency
interface NotionVersionData extends CollectionMeta {
  pinnedVersion: string;
  latestVersion: string;
  versionsBehind: number;
  breakingChanges: Array<{
    description: string;
    migrated: boolean;
    details: string;
  }>;
  recommendation: string | null;
}

// GitHub traffic (matches github-analytics schema for portability)
interface GitHubTrafficData extends CollectionMeta {
  repos: string[];
  data: Record<string, {
    traffic: Array<{
      date: string;
      clones: number | null;
      clones_unique: number | null;
      views: number | null;
      views_unique: number | null;
    }>;
    snapshots: Array<{
      date: string;
      stars: number;
      forks: number;
    }>;
    referrers: Array<{
      snapshot_date: string;
      referrer: string;
      count: number;
      uniques: number;
    }>;
    paths: Array<{
      snapshot_date: string;
      path: string;
      title: string;
      count: number;
      uniques: number;
    }>;
  }>;
}

// Tasuku overview
interface TaskuOverviewData extends CollectionMeta {
  projects: Array<{
    name: string;
    path: string;
  }>;
  statusCounts: Record<string, number>;
  topReady: Array<{
    title: string;
    priority: number;
    tags: string[];
    project: string;
    file: string;
  }>;
  blockedCount: number;
  recommendation: string | null;
}

// Handoff/audit queue
interface HandoffQueueData extends CollectionMeta {
  items: Array<{
    type: "handoff" | "audit";
    filename: string;
    title: string;
    project: string;
    ageDays: number;
    mtime: string;
  }>;
  recommendation: string | null;
}

// Package stats
interface PackageStatsData extends CollectionMeta {
  name: string;
  version: string;
  publishedAt: string;
  weeklyDownloads: number;
  auditSummary: {
    total: number;
    high: number;
    moderate: number;
    low: number;
  };
  depFreshness: {
    total: number;
    upToDate: number;
    outdated: Array<{
      name: string;
      current: string;
      latest: string;
      type: "dependencies" | "devDependencies";
    }>;
  };
  recommendation: string | null;
}

// shields.io endpoint schema
interface ShieldsEndpoint {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds?: number;
}
```

### Collection cadence

| Source | Cadence | Reason |
|---|---|---|
| GitHub traffic | Daily (cron) | GitHub retains only 14 days of traffic data |
| npm stats | Daily (cron) | Low-volume, daily is sufficient |
| Coverage matrix | On-demand (manual `npm run collect`) | Changes only when we ship features |
| Notion version | On-demand | Changes only when Notion publishes (check weekly) |
| Tasuku | On-demand | Changes when tasks are worked; stale quickly but not critical |
| Handoffs/audits | On-demand | Changes rarely |

The daily cron runs `collect-github.ts` and `collect-npm.ts`. Everything else runs when `npm run collect` or `npm run dev` is invoked.

### JSON file paths (canonical)

All consumers (dashboard panels, shields generator, digest bot) read from these paths:

| File | Producer | Consumers |
|---|---|---|
| `public/data/github-traffic.json` | `collect-github.ts` + `aggregate.ts` | GitHubTraffic panel, digest bot |
| `public/data/npm-stats.json` | `collect-npm.ts` | PackageStats panel, digest bot |
| `public/data/coverage-matrix.json` | `collect-coverage.ts` | CoverageMatrix panel, shields generator |
| `public/data/notion-version.json` | `collect-notion-version.ts` | NotionVersion panel, shields generator |
| `public/data/tasuku-overview.json` | `collect-tasuku.ts` | TaskuOverview panel, digest bot |
| `public/data/handoff-queue.json` | `collect-handoffs.ts` | HandoffQueue panel, digest bot |
| `public/shields/notion-version.json` | `generate-shields.ts` | shields.io (external fetch) |
| `public/shields/mcp-tool-count.json` | `generate-shields.ts` | shields.io (external fetch) |

---

## Section 4: Discord Digest Bot Architecture Inside agent-listener

### How pr-bot works (reference pattern)

The pr-bot is a separate Docker Compose service that:
1. Uses the same Docker image as the main agent (same `build: .`)
2. Has its own data volume (`pr-bot-data`) and Claude state volume (`pr-bot-claude`)
3. Runs `github-poller.ts` on a timer (polls `gh pr list` every 60 min)
4. When a new/updated PR is found, submits a job to `job-runner.ts`
5. Job runner spawns `claude-oneshot.ts` (Claude CLI one-shot session)
6. Claude produces review text
7. `deliver` function POSTs to a Discord webhook URL

### Digest bot: what's reused vs new

| Component | Status | Notes |
|---|---|---|
| `claude-oneshot.ts` | **Reused as-is** | Same one-shot Claude CLI spawn |
| `job-runner.ts` | **Reused as-is** | Same dedup + queue; digest bot submits one job per week |
| `github-poller.ts` | **Not reused** | PR-specific; digest bot has its own poller |
| `log.ts` | **Reused** | Same logging |
| Docker image | **Reused** | Same build context |

### New files in agent-listener

```
src/
  digest-collector.ts    # assembles data from GitHub API, npm, tasuku, handoffs
  digest-prompt.ts       # formats data into Claude prompt
  digest-poller.ts       # weekly timer + state file + job submission
  digest-entry.ts        # entry point for digest-bot service

  __tests__/
    digest-collector.test.ts
    digest-prompt.test.ts
    digest-poller.test.ts

config/
  digest.json            # digest bot configuration
  digest-mcp.json        # MCP config for digest one-shot sessions (minimal)
```

### `digest-poller.ts` design

```typescript
interface DigestPollerOptions {
  config: DigestConfig;
  jobRunner: JobRunner;
  pollIntervalMs: number;     // check every hour (3_600_000)
  stateFilePath: string;      // /app/data/digest-state.json
  model?: string;             // default: claude-sonnet-4-6
  mcpConfigPath?: string;
  webhookUrl: string;         // Discord webhook for channel 1496306249329803408
}

interface DigestState {
  lastSentWeek: string | null;  // ISO week: "2026-W17"
}
```

Timer fires hourly. On each tick:
1. Check if today is Monday (configurable day)
2. Load state; check if `lastSentWeek` matches current ISO week
3. If already sent this week, skip
4. Call `collectDigestData(config)` to gather all metrics
5. Call `buildDigestPrompt(data)` to create the Claude prompt
6. Submit job to `jobRunner` with:
   - `id: "weekly-digest-2026-W17"`
   - `dedupeKey: "digest@2026-W17"`
   - `deliver`: POST to Discord webhook (same pattern as pr-bot's `buildDeliver`)
   - `model: "claude-sonnet-4-6"` (synthesis is simple; Sonnet is sufficient)
7. Update state: `lastSentWeek = "2026-W17"`

### Docker Compose service entry

```yaml
digest-bot:
  build: .
  user: "1000:1000"
  init: true

  volumes:
    - digest-data:/app/data
    - digest-claude:/home/agent/.claude
    - ${CLAUDE_HOST_DIR}:/mnt/host-claude:ro
    - ../mcp-notion:/opt/mcp/mcp-notion:ro          # for tasuku + handoff access
    - ./config/digest.json:/app/config/digest.json:ro
    - ./config/digest-mcp.json:/app/config/digest-mcp.json:ro

  environment:
    - AGENT_WORKING_DIR=/app
    - DISCORD_DIGEST_WEBHOOK_URL=${DISCORD_DIGEST_WEBHOOK_URL}
    - GH_TOKEN=${DIGEST_GITHUB_TOKEN}
    - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}
    - DISABLE_AUTO_COMPACT=1
    - HEALTH_PORT=3202
    - TZ=America/Los_Angeles

  env_file:
    - /home/jwigg/config/agent-listener/.env.digest-bot

  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL

  deploy:
    resources:
      limits:
        memory: 1G
        cpus: "0.5"
      reservations:
        memory: 256M
        cpus: "0.1"

  healthcheck:
    test: ["CMD", "curl", "-sf", "http://localhost:3202/health"]
    interval: 60s
    timeout: 5s
    start_period: 30s
    retries: 3

  restart: unless-stopped
```

New volumes to add:
```yaml
volumes:
  # ... existing
  digest-data:
  digest-claude:
```

### Why webhook, not Discord MCP tool

The task description preferred `mcp__discord__send_notification` for "cleaner integration since Claude is already in the loop." However, the Discord MCP server (`mcp-discord-agent`) is:
- Mounted in the main `agent` service: `../mcp-discord-agent:/opt/mcp/mcp-discord-agent:ro`
- **Not** mounted in `pr-bot`
- **Not** referenced in `config/job-mcp.json` (which only has `mcp-agents`)

For the one-shot Claude session spawned by the digest bot to access `mcp__discord__send_notification`, we would need to:
1. Mount `mcp-discord-agent` into the digest-bot container
2. Add it to `digest-mcp.json`
3. Provide `MCP_DISCORD_BOT_TOKEN` env var to the container
4. Accept the ~25s MCP server cold-start overhead on every one-shot session

The simpler path: Claude generates the text, returns it as plain text, and the `deliver` function POSTs it to a Discord webhook. This is identical to how pr-bot works, adds zero MCP complexity, and avoids the cold-start penalty. The Claude one-shot still does the synthesis; it just doesn't do the posting.

**Recommendation:** Use webhook for MVP. If the human strongly prefers MCP tool delivery, add mcp-discord-agent to the digest-bot's config in a follow-up. The switchover is a config change, not an architecture change.

---

## Section 5: Custom Shields Endpoint

### shields.io endpoint schema

shields.io's [endpoint badge](https://shields.io/badges/endpoint-badge) fetches JSON from a URL and renders it as a badge. Required response shape:

```json
{
  "schemaVersion": 1,
  "label": "string",
  "message": "string",
  "color": "string"
}
```

### Two custom endpoints

**1. Notion-Version currency**

Path: `public/shields/notion-version.json`
Generated by: `scripts/generate-shields.ts`

```json
{
  "schemaVersion": 1,
  "label": "Notion API",
  "message": "2025-09-03 (1 behind)",
  "color": "yellow"
}
```

Color logic:
- `"brightgreen"`: pinned === latest
- `"yellow"`: 1 version behind
- `"red"`: 2+ versions behind

**2. MCP tool count**

Path: `public/shields/mcp-tool-count.json`
Generated by: `scripts/generate-shields.ts`

```json
{
  "schemaVersion": 1,
  "label": "MCP tools",
  "message": "28 tools",
  "color": "informational"
}
```

Color: always `"informational"` (blue). The count itself is the information; no good/bad threshold.

### Hosting decision

shields.io needs a publicly-accessible URL to fetch the JSON. Options:

**Option A: GitHub raw URL.** Commit the JSON files to the oss-dashboard repo, push to GitHub. shields.io fetches from `https://raw.githubusercontent.com/Grey-Iris/oss-dashboard/main/public/shields/notion-version.json`. Pros: zero infra. Cons: requires pushing generated files to git; 5-minute CDN cache can be stale; repo must be public (or use a GitHub Pages deployment).

**Option B: GitHub Gist.** Write the JSON to a gist. shields.io fetches from gist raw URL. Pros: decoupled from repo visibility. Cons: requires gist management in the collect script.

**Option C: Local-only, badges show "endpoint" placeholder until public hosting is set up.** The 3 standard badges work immediately. The 2 custom badges wait for a hosting decision.

**Recommendation:** Option A (GitHub raw URL) if oss-dashboard is public. Option C (defer) if private. This is an open decision for the human (Section 7, item 1).

### Generation trigger

`generate-shields.ts` runs as part of `npm run collect`. On the daily cron, after collection finishes, it regenerates the shield JSON files. If using Option A, the cron also commits and pushes the updated files.

---

## Section 6: github-analytics Migration Path

### Current state of github-analytics

Located at `/mnt/d/backup/projects/personal/github-analytics/`. Contains:
- `scripts/collect.ts` (536 lines): Octokit-based collector for traffic, stars, referrers, paths. Org discovery, merge logic, Discord notifications, PAT expiry check.
- `scripts/aggregate.ts` (117 lines): Merges per-repo JSON into single `public/data.json`.
- `data/` (2 repo JSON files): `Grey-Iris--easy-notion-mcp.json`, `Grey-Iris--trellis.json`.
- `src/components/` (9 React components): TrafficChart, StarForkTrend, ReferrersTable, PopularPaths, NewThisWeekStrip, RepoStats, InteractiveLegend, TrendChart, ReferrerTrend.
- `src/App.tsx`, `src/main.tsx`, `src/types.ts`, `src/hooks/`, `src/lib/`.
- Docker/nginx deployment: `Dockerfile`, `docker-compose.yml`, `nginx.conf`.
- Vite config, package.json (React 19, Vite 6, Recharts 3).

### Migration plan

#### Phase 1: Copy (during dashboard build)

| github-analytics file | oss-dashboard destination | Changes needed |
|---|---|---|
| `scripts/collect.ts` | `scripts/collect-github.ts` | Remove Discord notification (digest bot handles this). Remove `main()` entrypoint (called by collect-all.ts). Export `fetchRepoTraffic`, `mergeTraffic`, `mergeSnapshots`, `replaceForDate`, `discoverRepos`. Update data dir path. |
| `scripts/aggregate.ts` | `scripts/aggregate.ts` | Update input/output paths. Add `CollectionMeta` wrapper to output. |
| `data/*.json` | `data/*.json` | Direct copy (same schema). |
| `src/components/TrafficChart.tsx` | `src/components/panels/github/TrafficChart.tsx` | Adapt imports. Wrap in PanelCard. Adjust styling to Tailwind. |
| `src/components/StarForkTrend.tsx` | `src/components/panels/github/StarForkTrend.tsx` | Same adaptations. |
| `src/components/ReferrersTable.tsx` | `src/components/panels/github/ReferrersTable.tsx` | Same. |
| `src/components/PopularPaths.tsx` | `src/components/panels/github/PopularPaths.tsx` | Same. |
| `src/components/NewThisWeekStrip.tsx` | `src/components/panels/github/NewThisWeekStrip.tsx` | Same. |
| `src/components/RepoStats.tsx` | Not ported | Replaced by PackageStats panel. |
| `src/components/InteractiveLegend.tsx` | `src/components/panels/github/InteractiveLegend.tsx` | Utility; port if TrafficChart uses it. |
| `src/components/TrendChart.tsx` | `src/components/panels/github/TrendChart.tsx` | Same. |
| `src/components/ReferrerTrend.tsx` | `src/components/panels/github/ReferrerTrend.tsx` | Same. |
| `src/types.ts` | Merged into `src/lib/types.ts` | Deduplicate with shared types. |
| `src/hooks/` | `src/hooks/` | Adapt if hooks are useful. |
| `config.json` | Inline in collect-github.ts or oss-dashboard `config.json` | |
| `Dockerfile`, `docker-compose.yml`, `nginx.conf` | Not ported | oss-dashboard is local dev server only for MVP. |
| `scripts/__tests__/` | `scripts/__tests__/` | Port and adapt. |

#### Phase 2: Parallel run

After porting:
- github-analytics continues running its daily GH Actions collection job (writes to its own `data/` via git push)
- oss-dashboard runs its own `collect-github.ts` locally
- Both produce the same data; oss-dashboard's copy is authoritative for the dashboard

Parallel period: until the oss-dashboard's GitHub traffic panel is verified to display all data github-analytics shows today. Expected: 1 to 2 weeks.

#### Phase 3: Archive github-analytics

When feature parity is confirmed:
1. Update github-analytics README: "Archived. Traffic data collection and visualization have moved to oss-dashboard."
2. Archive the repo on GitHub (Settings > Archive)
3. Copy any remaining data files from github-analytics that oss-dashboard doesn't have
4. Delete the GH Actions workflow (or let archival disable it)
5. Keep the Docker container stopped (don't delete; forensic value)

**Do not archive until:** the oss-dashboard daily cron has run successfully for at least 7 consecutive days and all github-analytics React components have been ported and visually verified.

---

## Section 7: Open Decisions for the Builder

### Ranked by unblocking impact

**1. Is oss-dashboard a public or private repo?**
This decides: (a) whether custom shields badges work via GitHub raw URLs or need alternative hosting; (b) whether the coverage matrix data is publicly visible; (c) whether `.meta/plans/` content in oss-dashboard is public.
- If public: shields work for free, coverage matrix is a transparency signal.
- If private: need alternative badge hosting (gist, GitHub Pages on easy-notion-mcp, or a static file server).
- **Why this unblocks:** Badge step 8 depends on this. The builder can scaffold the repo and write all code either way, but the badge URLs in easy-notion-mcp's README differ.

**2. Exact URL for the custom shields JSON endpoints.**
Depends on decision 1. Candidate patterns:
- Public oss-dashboard: `https://raw.githubusercontent.com/Grey-Iris/oss-dashboard/main/public/shields/notion-version.json`
- GitHub Pages on easy-notion-mcp: `https://grey-iris.github.io/easy-notion-mcp/shields/notion-version.json`
- Gist: `https://gist.githubusercontent.com/jwigg/<gist-id>/raw/notion-version.json`
- **Why this unblocks:** The exact URL goes into easy-notion-mcp's README badge markup.

**3. Discord webhook URL for channel `1496306249329803408`.**
The builder needs this to configure the digest bot. It must be created in Discord server settings (Server Settings > Integrations > Webhooks > New Webhook, select the target channel).
- **Why this unblocks:** Digest bot step 9 (`.env.digest-bot`) depends on this.

**4. tsconfig strictness level for oss-dashboard.**
Recommendation: `strict: true` (matches easy-notion-mcp). But the builder may need to relax if ported github-analytics components have implicit-any patterns.
- **Why this unblocks:** Low impact; builder can start strict and relax if needed.

**5. Which shadcn/ui components to install by default.**
Recommendation: Card, Table, Badge, Button, Tabs, DropdownMenu, Switch, Tooltip. Install more as panels need them.
- **Why this unblocks:** Low impact; `npx shadcn add <component>` is a 5-second command.

**6. How to organize the "next action" recommendations layer.**
Each panel has a `recommendation` field in its data. Options:
- **Precomputed by collector scripts** (rule-based): "CI has 2 high-severity audit findings; run `npm audit fix`." Cheap, deterministic, but limited to rules the script author writes.
- **LLM-generated on each collect** (Claude one-shot): richer synthesis but adds cost and latency to every collection run. Overkill for MVP.
- **Recommendation:** Precomputed rule-based for MVP. Each collector script has a `computeRecommendation(data)` function that returns a string or null. The digest bot is the only surface that uses LLM synthesis.

**7. Coverage matrix auto-deriver: regex parsing vs AST parsing of server.ts.**
The auto-deriver needs to extract tool names and property type support from TypeScript source. Options:
- **Regex** (grep for `name: "` lines, grep for `case "` in switch blocks): fragile if code formatting changes, but simple and sufficient for the current code shape.
- **AST** (use `typescript` compiler API or `ts-morph`): robust, handles refactors, but adds a heavy dependency and build complexity.
- **Recommendation:** Regex for MVP. The code shape is stable (hasn't changed in months). Add a smoke test that verifies the parsed tool count matches a known value; if the regex breaks, the test catches it. Migrate to AST in v2 if regex becomes maintenance pain.

**8. Daily cron implementation.**
The dashboard needs a daily cron to run `collect-github.ts` and `collect-npm.ts`. Options:
- **System cron** (crontab on WSL): simplest, already how github-analytics' GH Actions job is triggered.
- **GH Actions workflow** in oss-dashboard: runs `collect-github.ts`, commits data, pushes. Same pattern as github-analytics today.
- **Node-based timer** in a long-running process: unnecessary complexity.
- **Recommendation:** System cron for local data; GH Actions for anything that needs to be committed (like shields JSON if using Option A hosting). Builder's call.

---

## Section 8: Risks and Mitigations

### 1. Coverage matrix auto-deriver breaks on tool registry format change

**Risk:** The regex-based parser in `collect-coverage.ts` parses `server.ts` for `name: "..."` patterns and `notion-client.ts` for `case "..."` patterns. If the tool registration format changes (e.g., moving to a declarative registry object, renaming the variable, extracting to a separate file), the parser silently produces wrong data.

**Mitigation:** Add an assertion to the deriver: "parsed tool count must be >= 25 and <= 40" (current count is 28). If the assertion fails, the script errors loudly rather than writing bad data. The collector writes a `parserConfidence: "high" | "degraded"` field to the output JSON; the panel shows a warning badge if degraded. Additionally, the deriver's test suite hardcodes the expected tool names; a failing test is the first signal that the code shape changed.

### 2. agent-listener Docker Compose: adding a new service

**Risk:** The digest-bot is a third container (after agent + pr-bot) sharing the Docker image. Operational ripple effects:
- Build time: unchanged (same image, cached layers)
- Memory: +1G limit, +256M reservation. The host needs ~1.25G additional headroom.
- Port conflict: digest-bot uses 3202 (agent uses 3200, pr-bot uses 3201)
- Credential management: one more `.env` file, one more `CLAUDE_CODE_OAUTH_TOKEN` consumer
- Restart cascades: `docker compose restart` restarts all services; the digest-bot is stateless enough that unexpected restarts are harmless (state file persists in volume)

**Mitigation:** Resource limits are conservative (0.5 CPU, 1G memory) since the bot is almost always idle (one job per week). Health check ensures the bot is responsive. If the host runs tight on memory, the digest-bot is the first service to scale down (lower limits) or disable (remove from compose file).

### 3. Discord MCP tool availability in digest bot context

**Risk:** The task description preferred `mcp__discord__send_notification` for message delivery. As discovered during planning: the Discord MCP server is NOT available in the one-shot Claude sessions spawned by the job runner. It requires:
- Volume mount for mcp-discord-agent
- MCP config entry
- Discord bot token env var
- ~25s cold-start per one-shot session

**Mitigation:** Use Discord webhook for MVP (same as pr-bot). Document the switch path: if the human wants MCP tool delivery later, add mcp-discord-agent to digest-bot's volumes and digest-mcp.json. The `deliver` function in `digest-poller.ts` is a single-function swap point; no architectural change needed.

### 4. github-analytics data continuity during migration

**Risk:** github-analytics collects via GH Actions and git-pushes to its own repo. If we stop that job before oss-dashboard's local cron is reliably running, we lose traffic data (GitHub only retains 14 days).

**Mitigation:** The parallel-run period (Section 6, Phase 2) ensures both collectors run simultaneously. Only archive github-analytics after 7+ consecutive successful local collection days. The existing `data/*.json` files are copied to oss-dashboard on day one as seed data.

### 5. shields.io rate limits and caching

**Risk:** shields.io caches endpoint badge results. The `cacheSeconds` parameter in the badge URL controls this. If set too low, shields.io may rate-limit fetches to the endpoint URL. If set too high, badge updates are delayed.

**Mitigation:** Set `cacheSeconds=86400` (24 hours) in the badge URL. The underlying data changes at most daily. This keeps shields.io happy and avoids stale-but-not-stale badge states.

### 6. Tasuku CLI availability

**Risk:** `collect-tasuku.ts` depends on `tk task list -f json` being available in PATH. Inside Docker (for the digest bot) and on the dev machine (for the dashboard collector), tk must be installed.

**Mitigation:** The collector falls back to raw file parsing (`readdir + YAML frontmatter parse`) if `tk` is not available. The file format is simple (YAML frontmatter with `status`, `priority`, `tags` fields). Test both paths.

### 7. npm API reliability

**Risk:** The npm download count API (`api.npmjs.org`) occasionally returns 0 or errors for valid packages. The registry API is more reliable but doesn't include download counts.

**Mitigation:** If the download API returns 0 or errors, the collector retains the last known value from the previous JSON file (read-before-write pattern). The "as of" timestamp reflects when the data was actually fresh, not when the collector last ran.

### 8. Coverage YAML staleness

**Risk:** The hand-curated `coverage/notion-api.yaml` (Notion-side data) falls behind when Notion ships new API features. The auto-deriver only covers "our side"; the Notion side requires manual updates.

**Mitigation:** The Notion-Version currency panel is the canary: if the pinned version falls behind, the YAML likely needs updating too. The plan defers automated YAML refresh to v2 (the queued `notion-api-alert-bot` will propose updates). For MVP, the YAML is seeded once from the gap audit and updated manually when the human reviews the Notion changelog (which they already do).

---

## Appendix: Architectural Decisions

These should be recorded in oss-dashboard's CLAUDE.md once the repo is created.

1. **No backend server.** The dashboard is a pure Vite SPA reading static JSON from `public/data/`. No Express, no Hono, no API routes. Collector scripts write JSON; Vite serves it. This eliminates an entire failure surface.

2. **JSON-on-disk, no database.** Historical data accumulates in the per-repo JSON files (same as github-analytics). The trade-off: temporal queries ("when did CI start flaking?") are hard. Accepted for MVP; SQLite is the natural upgrade path if history queries become important.

3. **Collectors as standalone scripts, not a monolithic runner.** Each `collect-*.ts` can run independently. `collect-all.ts` orchestrates them but is not required. This lets the daily cron run only the time-sensitive collectors (github, npm) while others run on-demand.

4. **Regex-based auto-deriver, not AST.** See Section 7, item 7 for rationale. Assertion-guarded.

5. **Webhook delivery for digest bot, not MCP tool.** See Section 4 risk discussion. Swap path documented.

6. **Coverage matrix: two-layer (auto-derived + hand-curated YAML).** Auto-derivation covers "what we implement." Hand-curated YAML covers "what Notion exposes." The matrix is their diff, computed at render time. Neither layer is the single source of truth; both are needed.

7. **github-analytics absorbed, not extended.** Clean repo avoids inheriting github-analytics' Docker/nginx/GH-Actions constraints that don't fit local-data panels.

---
name: claude-code-in-gh-actions-2026-04-23
description: Is running `claude -p` on GitHub-hosted Actions a real, widely-used pattern? Auth options, gotchas, and a CI-vs-local recommendation for the easy-notion-mcp agent benchmark.
type: research
date: 2026-04-23
author: Researcher (single-session web survey)
status: complete
---

# Claude Code on GitHub Actions: pattern survey and recommendation for the easy-notion-mcp bench

## 1. Executive summary

Running the Claude Code CLI on GitHub-hosted Actions is **emerging, not standard**. Anthropic ships two first-party GitHub Actions (`claude-code-action` at v1 with 7.2k stars; `claude-code-base-action` still `@beta` at ~800 stars), and both are almost exclusively positioned for `@claude`-mention PR/issue automation — not multi-scenario benchmark suites. No public open-source MCP project was found running a 10+ scenario `claude -p` bench in GitHub Actions. The `CLAUDE_CODE_OAUTH_TOKEN` path for Max subscribers works mechanically but sits in an unstable zone: March-April 2026 had a widespread, still-unresolved usage-limit-drain incident; quota is **pooled organization-wide** so CI runs eat James's interactive quota; and the 1-year token has known rotation flakiness. The `ANTHROPIC_API_KEY` path is stable and bounded but bills separately from Max (~$60-180/mo for the planned nightly cadence). **Recommendation: run locally as the default, keep CI as opt-in with API key only, and do not wire the Max OAuth token into CI.**

## 2. Pattern survey — what's actually shipping

### 2.1 First-party Anthropic actions

| Action | Purpose | Stars | Maturity | Auth options | Fit for our bench |
|---|---|---|---|---|---|
| [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) | PR/issue automation, `@claude` mentions, code review | 7.2k | `@v1` (Aug 26, 2025 GA; 335 open issues) | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, Bedrock, Vertex AI, Foundry | **Poor**. One session per action invocation; not designed for 13 sequential scenario dispatches. |
| [`anthropics/claude-code-base-action`](https://github.com/anthropics/claude-code-base-action) | Low-level wrapper for custom workflows; pass-through to `claude -p` | ~800 | `@beta` (798 stars, 63 releases, actively maintained but not v1) | Same as above | **Plausible**. Explicitly positioned as "foundation for building automated workflows" where the full action is too opinionated. |

Anthropic's own [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) action — their flagship example of "Claude running on GitHub Actions at scale" — does **not** use `claude -p` subprocess. It calls the Claude API directly via Python (`claude_api_client.py`). Even Anthropic, with an obvious incentive to showcase `claude -p` in CI, chose the direct-API path for a multi-scenario evaluator.

Reference: [Claude Code GitHub Actions docs](https://code.claude.com/docs/en/github-actions) — the Anthropic landing page lists only PR-review / daily-report / @claude-mention use cases. No eval-suite or benchmark example exists in the official [examples directory](https://github.com/anthropics/claude-code-action/tree/main/examples).

### 2.2 Community wrappers

- [`grll/claude-code-login`](https://github.com/grll/claude-code-login) — OAuth 2.0 + PKCE flow for GH Actions. **92 stars.** Addresses the same short-lived-token problem that issue [#727](https://github.com/anthropics/claude-code-action/issues/727) describes. Modest adoption.
- [`marketplace/actions/claude-code-oauth-login`](https://github.com/marketplace/actions/claude-code-oauth-login), [`claude-code-action-access-control`](https://github.com/marketplace/actions/claude-code-action-access-control), `step-security/claude-code-action` — a small aftermarket ecosystem exists to patch around authentication and permission gaps. None is a household name.

### 2.3 Real agent-benchmark-in-CI examples

**None found for MCP servers specifically.** Agent-eval infrastructure that does exist:

- [Harbor](https://grafana.com/blog/o11y-bench-open-benchmark-for-observability-agents/) (Laude Institute, creators of Terminal-Bench 2.0) — containerized, **defaults to local Docker execution**. Example: `harbor run --dataset compilebench --agent terminus-2 --model openai/gpt-5.2`. CI is possible but not the primary mode.
- [Promptfoo Claude Agent SDK provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) — explicitly documents local and CI paths; guidance leans toward local for consistency ("only team-shared skills", `setting_sources: ['project']`, `maxConcurrency: 1` for side-effecting tests).
- [`r-huijts/mcp-server-tester`](https://github.com/r-huijts/mcp-server-tester) — uses API directly (not CLI subprocess). 10 stars. WIP alpha.
- [Grafana `o11y-bench`](https://grafana.com/blog/o11y-bench-open-benchmark-for-observability-agents/) — observability agent benchmark. Run locally, upload results.

Bottom line: **every agent-benchmark framework I could find defaults to local execution with optional CI.** No one is running `claude -p` subprocess benchmarks on GitHub-hosted runners as a matter of course.

## 3. Gotchas matrix

| Class | Concrete issue | Source | Severity for our bench |
|---|---|---|---|
| **Quota pooling** | Rate-limit quota is pooled per `organizationUuid`, not per account. Accounts in the same org show identical utilization and reset times. | [claude-code #41886](https://github.com/anthropics/claude-code/issues/41886) (open) | **HIGH.** James's Max 20x quota is shared across his interactive CC sessions, agent-listener Docker containers (Wren, Kit, Hanabi), and any bench runs on CI. Nightly bench inflation can starve his interactive work. |
| **Usage-drain incident (Mar 2026)** | Multi-vector regression affecting all paid tiers since 2026-03-23: cache-invalidation bugs inflating token cost 10-20×, session-resume bug causing 652k-token full-context reprocessing, peak-hour throttling. Still unresolved as of 2026-04-01. Anthropic has issued no blog post, email, or status-page entry. | [claude-code #41930](https://github.com/anthropics/claude-code/issues/41930) | **HIGH.** A 200k-token bench run could burn 2-4M equivalent tokens under these bugs, draining Max 20x in a single nightly. Incident is ongoing at time of this research. |
| **OAuth token rotation flakiness** | Users report the "1-year" token from `claude setup-token` being invalidated 3 times in under a year. Anthropic does not publicly document when/why this happens. | [AnswerOverflow discussion](https://www.answeroverflow.com/m/1470716228757753906) (403 to bot but cited by multiple secondary sources) | MEDIUM. Annual calendar reminder insufficient; need monitoring. |
| **OAuth token cleared between action phases** | `CLAUDE_CODE_OAUTH_TOKEN` set in secrets appears during `prepare` phase but is empty during `execute` phase of `claude-code-action`. Labeled p1 (Showstopper). | [claude-code-action #676](https://github.com/anthropics/claude-code-action/issues/676) (open since 2025-11-12) | MEDIUM. Bypass if using `claude-code-base-action` or raw shell invocation, but still signals the OAuth path is less-maintained than API-key. |
| **Refresh-token unsupported** | Max subscribers can't use refresh tokens in the action; must regenerate via `claude setup-token` manually. Tokens from `/install-github-app` expire in ~1 hour without auto-refresh. Closed as "not planned." | [claude-code-action #727](https://github.com/anthropics/claude-code-action/issues/727) (open since 2025-12-08), [claude-code #11016](https://github.com/anthropics/claude-code/issues/11016) (closed not-planned) | MEDIUM. |
| **Prompt injection ("Comment and Control")** | Prompt injection via PR titles, issue bodies, and HTML comments hijacks Claude Code in GH Actions to leak `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` back into the repo through comments. Demonstrated April 2026. Anthropic's blocklist mitigation (blocking `ps`) is incomplete (`cat /proc/*/environ` achieves the same). Still exploitable. | [oddguan.com](https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/), [SecurityWeek coverage](https://www.securityweek.com/claude-code-gemini-cli-github-copilot-agents-vulnerable-to-prompt-injection-via-comments/) | LOW-MEDIUM for our bench specifically (label-gated, prompts hardcoded in YAML, no comment-driven trigger) but becomes HIGH if nightly cron + dev branch allows a malicious commit to rewrite scenario YAML before Anthropic's rate-limit protections catch it. |
| **Secret leakage in public logs** | `show_full_output: true` on `claude-code-action` prints tool outputs and API responses — including any token-adjacent content — to publicly visible GH Actions logs. Disabled by default for a reason. | [claude-code-action security docs](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) | MEDIUM. easy-notion-mcp is open-source; any CI verbosity accidentally exposes bot-token-adjacent material. |
| **Mixing OAuth + API-key billing** | If `ANTHROPIC_API_KEY` is set in the env alongside `CLAUDE_CODE_OAUTH_TOKEN`, the API key wins (per documented auth precedence). Users have been accidentally billed $1,800+ in 2 days from this. | [claude-code #37686](https://github.com/anthropics/claude-code/issues/37686), [Claude Code credential research](/mnt/d/backup/projects/personal/agent-listener/.meta/research/claude-code-credential-system.md) | HIGH if misconfigured, LOW with careful workflow design. |
| **ToS gray zone for OAuth tokens** | Anthropic has issued legal requests against third-party tools that use OAuth tokens from Max subscriptions (OpenCode/OpenClaw case). First-party `claude-code-action` and `claude-code-base-action` are safe; bespoke shell-step `claude -p` invocations with `CLAUDE_CODE_OAUTH_TOKEN` are **not explicitly covered either way**. | [daveswift.com](https://daveswift.com/claude-oauth-update/), [OpenClaw cost analysis](https://www.shareuhack.com/en/posts/openclaw-claude-code-oauth-cost) | LOW but unresolved. Enforcement has targeted wrappers that re-sell or redistribute access, not self-hosted CI runs. Still worth a flag. |
| **Anthropic operational maturity** | Anthropic accidentally shipped 2,000 internal files and 500k lines of Claude Code source as an npm source-map in March 2026. Threat actors built credential-stealing malware disguised as "leaked Claude Code" within 24 hours. | [Zscaler ThreatLabz analysis](https://www.zscaler.com/blogs/security-research/anthropic-claude-code-leak), [Trend Micro analysis](https://www.trendmicro.com/en_us/research/26/d/weaponizing-trust-claude-code-lures-and-github-release-payloads.html) | Contextual: Anthropic is not yet operationally hardened. Treat CI integration as still-evolving infrastructure, not a load-bearing CI primitive. |

### 3.1 `claude -p` + `--mcp-config` + `--strict-mcp-config` specifically

The plan's Phase 0 spike composition is not a widely-documented pattern. No blog post or example in the Anthropic examples directory demonstrates it. The Codex pressure-test in the plan already flagged this correctly as "needs live validation before Phase 1." That concern is reinforced by this survey — we are doing something uncommon enough that a failure would need to be debugged from first principles.

## 4. Local-only alternative

### 4.1 The shape

```
.env.bench      (BENCH_NOTION_TOKEN, BENCH_ROOT_PAGE_ID, runs on James's laptop)
npm run bench   (invokes tests/bench/cli.ts — no change from the plan)

.meta/bench/runs/run-{date}-{sha}.md          (committed, hand-triggered)
.meta/bench/runs/run-{date}-{sha}.manifest.json  (committed)
.meta/bench/transcripts/...                    (gitignored)
```

The workflow is "run locally when you want signal; commit the summary report if the run is interesting." No GitHub workflow file. No secrets in CI. No quota-pooling risk. No `CLAUDE_CODE_OAUTH_TOKEN` in CI secrets.

**Release-gate variant:** checklist item in the release runbook: "run `npm run bench` against main at the release tag; commit the report; proceed with publish only if pass rate is 11/13 or better."

### 4.2 Projects doing this

- **agent-listener's own architecture is the closest in-house analogue.** `CLAUDE_CODE_OAUTH_TOKEN` in a locally-running Docker compose stack. No CI integration. Proven pattern for James, year+ of stable ops.
- **Harbor** defaults to `harbor run` locally in Docker ([migration blog](https://quesma.com/blog/compilebench-in-harbor/)). CI is a secondary mode via `harbor run` inside a workflow, but the primary distribution is "researchers run locally and share results."
- **Anthropic's own [claude-code-security-review](https://github.com/anthropics/claude-code-security-review) evals directory** — the `claudecode/evals/` tooling targets local execution against arbitrary PRs. CI runs the production security scanner but the evaluation framework is for local development.
- [Cline-bench](https://cline.bot/blog/cline-bench-initiative) — curated agentic-coding benchmark; runs as a dataset that humans pull and run locally, not a CI-gated workflow.

### 4.3 Ergonomic cost

What local-only loses:
- **No automatic regression detection on PRs.** Reviewer or author must remember to run it. Mitigation: pre-commit hook for bench-sensitive file patterns (e.g., anything under `src/tools/`).
- **No tamper-evident run record.** A maintainer could edit the committed report. Mitigation: the manifest already has SHA256 per transcript; a tampered report without matching transcripts is caught by a simple diff check.
- **No public "we ran the bench" signal** for downstream users of easy-notion-mcp. Mitigation: commit the run summary to `.meta/bench/runs/` with the release tag; linking it from the changelog is as visible as a CI green tick.

What local-only gains:
- **No shared quota** with interactive Claude Code work.
- **No secrets in the public repo.** Bot token and API credentials stay on James's machine.
- **No prompt-injection attack surface.** The scenarios can't be abused via labels, comments, or fork PRs.
- **Reproducibility.** James's laptop and the Docker stack both use the same `CLAUDE_CODE_OAUTH_TOKEN`; no Anthropic-Ops-maintained path between token issuance and run.
- **Simplicity.** No workflow YAML, no CI secrets config, no debugging GH Actions runner IPv6 quirks.

## 5. Recommendation for easy-notion-mcp

### 5.1 Lean: **local-first, CI as opt-in API-key-only, drop the Max OAuth path entirely**

Rationale, in priority order:

1. **The quota-pooling + March 2026 drain incident is the decisive factor.** Wiring James's Max 20x OAuth token into CI right now risks a single bench run draining his daily interactive quota. The incident is ongoing and Anthropic has not communicated a timeline. If it resolves, revisit. Until then, this is not a reasonable production choice.

2. **The benchmark's primary value is agent-ergonomics signal, not release-time gating.** The plan calls it "agent-ergonomics signal as primary value prop, release-gate use case." Ergonomics signal is a thing James consumes — he reads the friction notes and decides what to improve. That's a local-and-iterative activity, not a CI artifact. The release-gate use case is real but manual is fine: a release runbook item takes 12 minutes of clock time to execute and zero minutes of infrastructure to maintain.

3. **Benchmark-in-CI is not a common MCP-ecosystem pattern yet.** No project surveyed runs `claude -p` subprocesses against MCP server scenarios in GitHub Actions. Going first into that pattern costs paying the debugging bill (`claude -p --mcp-config --strict-mcp-config + HTTP + bearer` composition hasn't been stress-tested in public). The cost is justified only if CI gives us something local can't.

4. **The security surface of CI invocations is material for an open-source project.** "Comment and Control" is a named, publicly-documented, still-exploitable class of attack. easy-notion-mcp's bench has a label gate (maintainer-only) but nightly cron on `dev` + `main` means any maintainer-approved malicious YAML edit has ~24h to run with full secret access. Local-only eliminates this attack surface.

5. **The plan's $300/month aggregate ceiling is real money for an open-source single-maintainer project.** That ceiling lands on James's `ANTHROPIC_API_KEY` or shares quota with his Max tier. Local-only puts 100% of bench cost inside James's already-paid Max tier, running off-peak when quota is otherwise idle.

### 5.2 Concrete shape

| Layer | Choice |
|---|---|
| **Default execution** | Local. `npm run bench` against `BENCH_NOTION_TOKEN` + `BENCH_ROOT_PAGE_ID` + `CLAUDE_CODE_OAUTH_TOKEN` in `.env.bench` (same mechanism as agent-listener). |
| **Release gate** | Manual runbook step: run local bench against `main` at the release tag; commit the report into the release PR; proceed only if the suite is green (documented threshold, e.g., 11/13). |
| **PR-on-label bench** | Optional, opt-in, deferred. When added: API-key only (`ANTHROPIC_API_KEY` in a dedicated CI secret, billable to a prepaid or capped Anthropic workspace separate from James's personal account). Skip nightly cron until the March 2026 quota incident is resolved AND the label-triggered path has been green for ~5 runs. |
| **Max OAuth in CI** | **Don't.** Revisit once (a) the quota-pooling bug is fixed so CI quota doesn't starve interactive work, (b) the drain incident is formally resolved, (c) `claude-code-base-action` reaches `@v1`, (d) `CLAUDE_CODE_OAUTH_TOKEN` issue #676 is resolved. All four conditions. |

### 5.3 Mapping to the existing plan

The plan is already structured to accommodate this:
- The three-PR split lets us drop PR-A1's `.github/workflows/bench-a.yml` and PR-A2's nightly/release-gate sections without touching the framework work.
- Phases 0-5 (dispatch feasibility, framework, runner) are **identical** in either path — they are the local execution path.
- The `BENCH_ANTHROPIC_API_KEY` secret the plan already identifies (§11 open question Q2) becomes the CI knob, unused by default.

Estimated savings vs the three-PR plan: roughly half of PR-A2's scope (the nightly cron + release-tag gate + break-glass override) and a third of PR-A1's scope (the workflow file, the CI-specific cleanup steps). Maybe 300-500 LOC deferred.

## 6. Open questions

These remain unresolved from this research pass. Each is worth confirming before committing to a path.

1. **Is the quota-pooling bug [#41886](https://github.com/anthropics/claude-code/issues/41886) fixed?** If Anthropic has patched it since my research window, the "CI runs share James's interactive quota" objection weakens considerably. Check the issue for recent comments or a closing event before final decision. The issue was still open with no assignees at time of research.

2. **Is the March 2026 usage-drain incident [#41930](https://github.com/anthropics/claude-code/issues/41930) resolved?** Same check. If yes, the risk profile shifts.

3. **Does running `claude -p` in a bespoke GH Actions shell step (not via the official `claude-code-base-action`) with `CLAUDE_CODE_OAUTH_TOKEN` violate ToS?** I could not find an authoritative answer. The action wraps the same CLI, so functionally identical, but Anthropic's enforcement pattern against third-party tools creates genuine uncertainty. If James wants to use the OAuth path in CI despite §5.1's advice, asking Anthropic support for explicit sanction is the conservative move.

4. **Is there a public example of a 10+ scenario agent benchmark running `claude -p` in GH Actions?** I did not find one. If one exists, it would materially change this survey's maturity read. Worth asking on the Claude Code Discord or the github.com/anthropics/claude-code discussions.

5. **Does `claude-code-base-action` @beta support ephemeral MCP config files with HTTP transport + bearer headers?** Documented as "pass-through via `claude_args`," but unverified end-to-end for the HTTP transport case. Phase 0 spike would answer this if the CI path is ever pursued.

## 7. Constraints worth persisting beyond this investigation

For the memory system (optional — flag to orchestrator):

- **Claude Max OAuth quota is pooled organization-wide.** CI runs under James's `CLAUDE_CODE_OAUTH_TOKEN` share quota with his interactive Claude Code, agent-listener containers, and any other use of the same `organizationUuid`. This is a product decision by Anthropic ([claude-code #41886](https://github.com/anthropics/claude-code/issues/41886)), not a misconfiguration.
- **Anthropic's own `claude-code-security-review` GH Action uses the raw API, not `claude -p` subprocess.** Signals that subprocess-in-CI is not the path Anthropic itself reaches for when building multi-scenario Claude evaluators.
- **"Comment and Control" (2026) is a live prompt-injection attack class against Claude Code in GH Actions.** Mitigation is allowlist tools, not blocklist. Relevant any time an AI agent runs in a workflow that can be triggered by untrusted content (comments, fork PRs, `pull_request_target`).

## Sources

- [Claude Code GitHub Actions docs](https://code.claude.com/docs/en/github-actions) — official landing page
- [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) — v1 action
- [`anthropics/claude-code-base-action`](https://github.com/anthropics/claude-code-base-action) — @beta low-level action
- [`anthropics/claude-code-security-review`](https://github.com/anthropics/claude-code-security-review) — Anthropic's own eval-in-CI example (API, not CLI)
- [`claude-code-action` setup.md](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md) — auth options
- [`claude-code-action` security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [Issue #727 — refresh tokens unsupported for Max subscribers](https://github.com/anthropics/claude-code-action/issues/727)
- [Issue #676 — OAuth token cleared between prepare/execute](https://github.com/anthropics/claude-code-action/issues/676)
- [claude-code #11016 — /install-github-app generates broken OAuth workflow](https://github.com/anthropics/claude-code/issues/11016) (closed not-planned)
- [claude-code #41886 — quota shared per organizationUuid](https://github.com/anthropics/claude-code/issues/41886)
- [claude-code #41930 — widespread usage-limit drain since 2026-03-23](https://github.com/anthropics/claude-code/issues/41930)
- [claude-code #37686 — $1,800+ accidental API billing when mixing API key and Max subscription](https://github.com/anthropics/claude-code/issues/37686)
- [Comment and Control — prompt injection to credential theft](https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/)
- [SecurityWeek — Claude Code, Gemini CLI, GitHub Copilot Agents Vulnerable to Prompt Injection via Comments](https://www.securityweek.com/claude-code-gemini-cli-github-copilot-agents-vulnerable-to-prompt-injection-via-comments/)
- [Claude Code source-map leak (Trend Micro)](https://www.trendmicro.com/en_us/research/26/d/weaponizing-trust-claude-code-lures-and-github-release-payloads.html)
- [Claude Code source-map leak (Zscaler ThreatLabz)](https://www.zscaler.com/blogs/security-research/anthropic-claude-code-leak)
- [Dave Swift — Claude Max OAuth enforcement analysis](https://daveswift.com/claude-oauth-update/)
- [Answer Overflow — "My 1-year OAuth token had to be rotated 3 times"](https://www.answeroverflow.com/m/1470716228757753906) (not directly accessible to research bot; cited secondhand)
- [`grll/claude-code-login`](https://github.com/grll/claude-code-login) — community OAuth helper (92 stars)
- [Promptfoo Claude Agent SDK provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) — local-or-CI eval framework
- [`r-huijts/mcp-server-tester`](https://github.com/r-huijts/mcp-server-tester) — early-stage MCP test tool
- [Grafana o11y-bench launch](https://grafana.com/blog/o11y-bench-open-benchmark-for-observability-agents/)
- [Cline-bench initiative](https://cline.bot/blog/cline-bench-initiative)
- [Harbor via CompileBench migration](https://quesma.com/blog/compilebench-in-harbor/)
- Prior art: `/mnt/d/backup/projects/personal/agent-listener/.meta/research/claude-code-credential-system.md` (local deep-dive on `claude setup-token`, rate limits, auth precedence)
- Prior art: `/mnt/d/backup/projects/personal/agent-listener/CLAUDE.md` (agent-listener's `CLAUDE_CODE_OAUTH_TOKEN`-in-Docker architecture as the in-house analogue of "local default")

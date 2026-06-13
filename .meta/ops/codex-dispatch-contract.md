# Codex dispatch contract — for any PM/builder that manages Codex

Read and follow this before dispatching Codex. It exists because a builder once orphaned a
Codex run (backgrounded it + set a monitor), then its own subprocess turn ended mid-work with
nothing able to wake it — leaving Codex running detached with no PM to receive its result,
sequence commits, or run the next turn. (2026-06-13.)

## The rule (non-negotiable)

1. **Dispatch Codex ONLY via synchronous, blocking `Bash mcp-cli run --agent codex …`.** It runs
   in-process and returns its result inline before your turn closes. That is the only shape that
   works for a subprocess PM.
2. **NEVER** run `codex exec` directly. **NEVER** background a Codex call (`&`, `setsid`, `nohup`,
   `run_in_background: true`). **NEVER** use a Monitor / ScheduleWakeup / `ask_agent`-async to
   "wait" for Codex. A subprocess PM is **never woken** — you will end mid-work and orphan it.
3. **If a Codex turn would exceed your turn budget:** split it into smaller *synchronous* Codex
   calls, or finish honestly and report exactly what remains for the next dispatch. Do NOT
   background it to "manage" the long turn — that is the precise trap that caused the incident.
4. **You (the PM) own commits.** Tell Codex not to commit; you sequence commits after verifying.

## Preflight smoke — run this FIRST, before any real Codex work

Prove Codex is reachable in the correct (sync, inline-return) shape:

```bash
mcp-cli run --agent codex --dir <repo-abs-path> "Reply with exactly: CODEX_SMOKE_OK"
```

- Returns `CODEX_SMOKE_OK` inline within your turn → sync dispatch works; proceed, and use this
  exact shape (no flags that detach) for all real Codex calls.
- Hangs, errors, or does not return inline → **STOP.** Report `Codex sync dispatch unavailable:
  <detail>` and do NOT fall back to `codex exec` / background. Let the orchestrator decide.

Paste the smoke result in your report so the orchestrator can confirm you exercised the right shape.

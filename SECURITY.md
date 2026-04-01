# Security Policy

## Reporting vulnerabilities

Email security issues to james@greyiris.ai — do NOT open a public issue.

## Supported versions

Only the latest published version receives security fixes.

## Scope

This project handles Notion API tokens and OAuth credentials.
Security-relevant areas:
- `src/auth/` — OAuth flow and token storage
- `src/notion-client.ts` — API credential handling
- Environment variable handling in entry points

## Dependency policy

- No new dependencies without maintainer approval via issue discussion
- All dependencies are audited in CI (`npm audit`)
- Lockfile integrity is verified on every PR

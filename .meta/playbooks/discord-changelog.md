# Discord changelog playbook

For future orchestrators posting a release announcement to the easy-notion-mcp Discord. The tool is `mcp__discord__send_changelog` with `project: easy-notion-mcp`.

## When to post

Test: would a user behave differently after reading this? If no, GitHub release notes carry it alone.

- **Post:** features, bug fixes that touch user-visible behavior, perf wins users will notice.
- **Skip:** docs-only, CI-only, dependency-bump, internal-tooling releases.

## Routing verification

This is why the playbook exists. The v0.9.2 and v0.9.3 announcements went to the wrong Discord server entirely because of a routing bug in `discord-mcp`. The bug is fixed. Assume the default destination could be wrong again.

Before calling `send_changelog`, do one of:

1. Read the tool's destination preview (server + channel) back to James and wait for confirmation, or
2. Send a `send_notification` to the orchestrator-status channel first as a routing canary. If it lands where you expect, fire `send_changelog`. If not, stop and surface.

Do not fire blind. This step is not optional.

## The loose template

- **First line:** `📦 easy-notion-mcp vX.Y.Z`
- **Second line:** one-sentence headline that answers "do I care?" in user-facing terms, not implementation terms.
- **`Changes:` bullets, 2 to 4 of them**, ordered: user-visible effect → scope / affected tools → optional implementation note → optional background. For larger audiences, drop the implementation bullet (let release notes carry it).
- **Optional final line:** measured evidence — numbers from a real test, not adjectives. v0.9.3 anchored this with "43 to 60 seconds down to under 4 seconds against live Notion."

Anchor example (v0.9.2, the shape to match):

```
📦 easy-notion-mcp v0.9.2

Fixes a misleading error when you pass a data_source ID where a database container ID is expected, a common confusion under Notion's multi-source database refactor.

Changes:
• If you've seen 'Make sure the page/database is shared with your Notion integration' on a database that IS shared, the real problem was probably a wrong-layer ID. The server now detects this and returns an explicit message pointing at list_databases, including the parent database ID when it can extract it.
• Affects every database-side tool: get_database, query_database, add_database_entry, add_database_entries, update_data_source, relation schema resolution, create_view.
• Implementation: getDataSourceId now probes dataSources.retrieve once on object_not_found from databases.retrieve, throws a layer-mismatch error on success, and rethrows the original error identity-preserved otherwise (so genuine not-found cases keep their existing hint).
• Background: Notion's 2026-03-11 API version split the database container from its inner data sources. The old error path assumed a permissions problem; the real fix is the right ID.
```

## Bundle vs split

Bundle when the changelog story is coherent (a "bug-fix cluster"). Split when fixes target different audiences or different concerns.

The v0.9.2/v0.9.3 split was situational — PR #64 was unstable and forced separate releases. Under normal cadence, bundle coherent clusters. (Anchors: tasuku decision `separate-patch-releases-per-fix`; cadence preference confirmed 2026-05-14.)

## Tone constraints

- Concrete over abstract. Measured numbers over superlatives. No marketing copy. CLAUDE.md's "honest positioning" rule applies.
- If the post is signed or attributed to James, no em dashes — that's his rule for his own voice. The playbook itself can use them; an unsigned project announcement can too. Only avoid them when the post is in James's voice.

## What stays out

Internal process notes, meta-notes about dispatch slips, role-pattern lessons, orchestrator misadventures. Those live in `.meta/handoffs/`, never in a public Discord post.

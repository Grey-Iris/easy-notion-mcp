# Brief: write `.meta/playbooks/discord-changelog.md`

## Role

You are the **builder**. Read `.claude/agents/builder.md` (or the workflow-v2 builder role prompt) before starting.

This is a doc-only task. There is no code, no TDD, no Codex pressure-test step. Skip the canonical "manage Codex for implementation" workflow — write the doc yourself, then commit.

## Context

`easy-notion-mcp` is an open-source MIT-licensed Notion MCP server (npm: `easy-notion-mcp`, GitHub: `Grey-Iris/easy-notion-mcp`). Maintainer is James.

Releases ship via CI Trusted Publishing (see `CLAUDE.md` "Releasing"). After each release, the orchestrator posts a changelog announcement to the project's Discord announcements channel via the `mcp__discord__send_changelog` MCP tool (project field = `easy-notion-mcp`).

**The failure mode that triggered this playbook:** the v0.9.2 and v0.9.3 announcements went to the **wrong Discord server entirely** because of a routing bug in `discord-mcp`. The bug has been fixed. Going forward, we want a playbook future orchestrators can read so we (a) verify destination before sending, and (b) keep the post shape consistent.

The audience is small now (a few people, mostly devs, plus the project's Discord server) but may grow. Write the playbook for the engaged-devs case; it stays correct as the audience widens.

## Existing posts to use as anchors

Both posts went to the wrong server. Content is good; treat them as the shape we want to keep.

### v0.9.2

```
📦 easy-notion-mcp v0.9.2

Fixes a misleading error when you pass a data_source ID where a database container ID is expected, a common confusion under Notion's multi-source database refactor.

Changes:
• If you've seen 'Make sure the page/database is shared with your Notion integration' on a database that IS shared, the real problem was probably a wrong-layer ID. The server now detects this and returns an explicit message pointing at list_databases, including the parent database ID when it can extract it.
• Affects every database-side tool: get_database, query_database, add_database_entry, add_database_entries, update_data_source, relation schema resolution, create_view.
• Implementation: getDataSourceId now probes dataSources.retrieve once on object_not_found from databases.retrieve, throws a layer-mismatch error on success, and rethrows the original error identity-preserved otherwise (so genuine not-found cases keep their existing hint).
• Background: Notion's 2026-03-11 API version split the database container from its inner data sources. The old error path assumed a permissions problem; the real fix is the right ID.
```

### v0.9.3

```
📦 easy-notion-mcp v0.9.3

create_page is now about 10x faster on markdown-heavy pages with many toggles, callouts, or list items. A 40-toggle test page went from 43 to 60 seconds down to under 4 seconds against live Notion.

Changes:
• Optional containers (toggle, callout, bulleted/numbered list item, toggleable headings 1/2/3) with 1 to 100 leaf children and no grandchildren now ship their children inline in the same Notion request, instead of being deferred to one follow-up appendBlocks call per container.
• New shared canInlineChildrenInOneWrite predicate keeps prepareBlockForWrite (payload shape) and needsDeferredChildWrites (deferred queue) in lockstep. Internal recursion sites pass atTopLevel: false so depth-3 contexts (column seeds, column-deferred replay) still defer correctly per Notion's two-level nesting rule.
• The optimization cascades through appendPreparedBlocks, so the win extends past create_page into every appendBlocks request.
• Measured win on the E2E G2b test (40 toggles, each with a depth-2 paragraph child) was 43-60 seconds pre-fix to 3.6 seconds post-fix, live against Notion.
```

## What the playbook should cover

Distill from this conversation. Tight; aim for ~300-500 words total in the final doc. The playbook is for future orchestrators (and James), so write it in second person ("you") and the matter-of-fact tone CLAUDE.md uses.

Required sections:

1. **When to post.** Skip-the-post floor: docs-only, CI-only, dependency-bump, internal-tooling releases don't get a changelog post. The test is "would a user behave differently after reading this?" If no, GitHub release notes carry it alone. Feature and bug-fix releases that touch user-visible behavior do get a post.

2. **Routing verification (load-bearing — this is why the playbook exists).** Before calling `send_changelog`, confirm the destination server and channel by reading the tool's destination preview back to the human, OR by sending a `send_notification` to the orchestrator-status channel first as a routing canary. Do not fire blind. The default destination has been wrong before; assume it could be wrong again. This step is not optional.

3. **The loose template.** Format we already use:
   - First line: `📦 easy-notion-mcp vX.Y.Z`
   - Second line: one-sentence headline that answers "do I care?" in user-facing terms (not implementation terms)
   - `Changes:` bullets — 2 to 4 of them, ordered from user-visible → scope/affected tools → optional implementation note → optional background. For larger audiences, drop the implementation bullet (let release notes carry it).
   - Optional final line: measured evidence (numbers from a real test), not adjectives.

4. **Bundle vs split.** Bundle when the changelog story is coherent — e.g., a "bug-fix cluster" patch. Split when fixes target different audiences or different concerns. The v0.9.2/v0.9.3 split was situational (PR #64 was unstable, forcing separate releases); under normal cadence, bundle coherent clusters. (Source: tasuku decision `separate-patch-releases-per-fix` and James's anchored cadence preference 2026-05-14.)

5. **Tone constraints.** Concrete over abstract. Measured numbers over superlatives. No marketing copy. CLAUDE.md "honest positioning" rule applies. James-as-author has a "no em dashes in his voice" rule — this matters if the post is signed/attributed to him. The playbook itself can use em dashes (it's not in James's voice).

6. **What stays out.** Internal process notes, meta-notes about dispatch slips, role-pattern lessons. Those live in handoffs, never in a public Discord post.

## Deliverable

- Create `.meta/playbooks/` directory (new convention).
- Write `.meta/playbooks/discord-changelog.md`.
- Commit on `dev` with a focused message (e.g., `docs: add discord changelog playbook`). One commit, one file.
- Push is NOT required — leave that to the orchestrator.

## Evidence to return

1. Final commit SHA (`git log -1 --oneline`).
2. Full contents of `.meta/playbooks/discord-changelog.md` pasted in your return message so the orchestrator can review before considering it done.
3. If you propose a different file path or structure than what's specified above, surface that as a flag in your return — don't silently relocate.

## Anti-patterns to avoid

- Bullet sprawl. Tight, scannable, one-screen.
- Generic "best practices" framing. Be specific to this project's actual posts and actual failure mode.
- Inventing rules not grounded in the conversation distilled above. If the brief doesn't anchor a rule, don't add it.
- Reformatting the v0.9.2/v0.9.3 examples beyond what's needed. They're the shape we already use; quote them as-is.

## Context files you may read

- `/mnt/d/backup/projects/personal/mcp-notion/CLAUDE.md` — for tone calibration and "honest positioning" rule.
- `/mnt/d/backup/projects/personal/mcp-notion/.meta/handoffs/2026-05-14.md` — recent context if needed; the v0.9.4 cluster anchor and the cadence preference live here.

Do not read source code. This is a doc task.

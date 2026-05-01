# Hosted MCP live capture — `mcp.notion.com`

**Date:** 2026-05-01
**Captured by:** main orchestrator session (after the dispatched-harness path failed; switched to in-session capture via Claude Code's native MCP client)
**Capture method:** `claude mcp add --transport http notion-hosted https://mcp.notion.com/mcp`, OAuth consent through the in-IDE flow, schemas inspected via Claude Code's deferred-tools listing + `ToolSearch` schema loading. Token count via `mcp__tokens__count_file_tokens` (cl100k_base, parity with bench scripts).
**Subject:** `https://mcp.notion.com/mcp`, authorized 2026-05-01.

This memo settles the two open findings from `.meta/research/bench-scripts-audit-2026-04-28.md`: C1 (does hosted expose `update_content`?) and C2 (real upper bound on hosted's `tools/list` token cost). Both turned out the opposite direction the strategy narrative anticipated.

## Verdict on C1: YES, hosted exposes `update_content`

**Direct evidence.** `notion-update-page` accepts a `command` parameter with the enum:

```
"command": ["update_properties", "update_content", "replace_content", "apply_template", "update_verification"]
```

The `update_content` command takes `content_updates: Array<{old_str, new_str, replace_all_matches?}>` — identical search-and-replace semantics to our `find_replace` tool's wire-level call to `pages.updateMarkdown` with `type: "update_content"` (per learning `[6f7d4e]`). The `replace_content` command similarly mirrors our atomic `replace_content`.

**Implication.** The strategy memo's W1 win ("our `find_replace` ≈64 tokens vs hosted's full-page-rewrite ≈3,800 tokens; 98% smaller") **collapses entirely.** Hosted has the same primitive. The advantage is at most a framing edge: our `find_replace` is a top-level tool with a focused schema; hosted's equivalent is a sub-command of a larger `notion-update-page` tool. That's a small ergonomics difference, not a structural moat.

Per the bench audit's own pass 4 finding ("recommended fix: do not ship Option A"), this confirms the audit was right to halt the README revision pending live capture.

## Verdict on C2: hosted tools/list ≈ 5,336 tokens

**Direct measurement.** All 14 hosted tool schemas concatenated as a `tools/list` JSON dump and tokenized with `cl100k_base`:

- **Total: 5,336 tokens** (21,544 chars) for 14 tools.
- Source: `/tmp/notion-hosted-tools-list-2026-05-01.json` (reconstruction, may differ from actual wire response by ±10% due to schema-shape simplification on my end).

**Comparison to prior numbers.**

| Source | Hosted tools/list | Notes |
|---|---|---|
| Bench script measurement (2026-04-28) | ≥772 tokens | Lower bound; description-only, no schemas |
| Audit's projection (pass 2, 2026-04-28) | 2,000-2,200 tokens | Projected by mapping per-tool schemas to local analogs |
| **Live measurement (this capture)** | **~5,336 tokens** | Reconstructed from live schema dump |
| Local mcp-notion (per bench) | 4,969 tokens | For comparison |

**Implication.** The strategic narrative's "we cost at least 6.4× more than hosted on listing budget" framing was a wild overestimate of hosted's economy. **Hosted is comparable to local in listing-budget cost, not 6.4× cheaper.** Ratio: 5,336 / 4,969 ≈ 1.07x. Within rounding error of "the same."

Both prior numbers were materially wrong:
- The bench's 772 lower bound (description-only) was technically a lower bound but was used in framing as if it were close to the real number.
- The audit's 2-2.2K projection was 2-3× lower than the live measurement.

**The "tiered tool descriptions" / "listing budget moat" arguments built on the 772 number do not survive.** Listing budget is roughly a wash between local and hosted.

## Tool inventory: 14 hosted tools

The bench audit projected "18 hosted tools." The live count is **14 tools**:

1. `notion-fetch` — read pages/databases/data sources
2. `notion-create-pages` — create pages (batch up to 100)
3. `notion-create-database` — create database via SQL DDL
4. `notion-update-page` — update page; commands: `update_properties`, `update_content`, `replace_content`, `apply_template`, `update_verification`
5. `notion-update-data-source` — update database schema via SQL DDL
6. `notion-create-view` — create database view (table, board, list, calendar, timeline, gallery, form, chart, map, dashboard)
7. `notion-update-view` — update view configuration
8. `notion-duplicate-page` — duplicate (async)
9. `notion-move-pages` — move pages/databases to new parent
10. `notion-search` — semantic search (workspace + connected sources: Slack, GDrive, GitHub, Jira, Teams, Sharepoint, OneDrive, Linear); also user search
11. `notion-create-comment` — page-level, content-targeted via ellipsis snippet, or discussion reply
12. `notion-get-comments` — discussions on page or specific block
13. `notion-get-users` — workspace user list with pagination
14. `notion-get-teams` — teamspaces with membership info

Plus 2 generic MCP utilities Claude Code surfaces alongside any MCP server: `ListMcpResourcesTool`, `ReadMcpResourceTool`. Hosted exposes `notion://docs/enhanced-markdown-spec` and a view-DSL spec as MCP resources.

## What we have that hosted doesn't (the real differentiators)

Comparing tool names:

- **`update_block`** — just shipped in v0.6.0. Hosted has no surgical-single-block-edit-by-ID tool. Editing a specific block by ID requires the user to tell `update_content` what to find via `old_str`, which is a different ergonomic shape. **Genuine differentiator.**
- **`update_section`** — heading-targeted edit (replace content under a heading). Hosted doesn't have this; closest is `update_content` with the user finding the heading text. **Differentiator.**
- **`append_content`** — append markdown after specific content. Hosted's `update_page` with `update_content` could do this with `old_str` = end-of-content sentinel, but it's awkward. **Differentiator.**
- **`create_page_from_file`** (stdio only) — read a local file and create a page. Hosted has no filesystem access. **Differentiator (transport-conditional).**
- **`find_replace`** vs `notion-update-page` with `command: update_content` — equivalent. **NOT a differentiator.**
- **`replace_content`** vs `notion-update-page` with `command: replace_content` — equivalent. **NOT a differentiator.**
- **`add_database_entries`** (batch) — hosted's `create-pages` accepts a batch of up to 100, so this is roughly equivalent. **Slight ergonomic edge for our batch error semantics, not a category difference.**
- **`update_database_entry`** vs `notion-update-page` (which works on database pages too) — equivalent.
- **File uploads via `file://` URLs** — our `create_page_from_file`, `create_page` content with image references, etc. Hosted has no file-upload primitive. **Differentiator.**

## What hosted has that we don't

- **`notion-create-view` / `notion-update-view`** — full database view creation (table, board, list, calendar, timeline, gallery, form, chart, map, dashboard) with a DSL for filters/sorts/grouping. We have no equivalent.
- **`notion-search` AI mode** — semantic search over connected sources (Slack, Google Drive, GitHub, Jira, Linear, etc.). Our `search` is workspace-only.
- **`notion-get-teams`** — teamspace membership info. We have no teamspace tool.
- **SQL DDL for schema management** — `CREATE TABLE`, `ADD COLUMN`, `ALTER COLUMN`, etc. We use a property-shape JSON convention. Different ergonomic; arguably hosted's is more developer-friendly for technical users, ours is more accessible for natural-language agents.
- **Form management** — close/open submissions, anonymous toggle, permissions. We have no form tools.
- **Chart configuration** — column/bar/line/donut/number with aggregation, color, height, sort, stack-by. We have no chart tools.

## Strategic narrative — what survives

After this capture, the surviving claims for v0.6.0+ public framing are roughly:

1. **Surgical block edits.** `update_block` shipped in v0.6.0 is genuinely missing from hosted. Users who want to edit one block without scanning page content for a unique substring have a real differentiator.
2. **Heading-targeted edits.** `update_section` is missing from hosted.
3. **File-upload pipeline** including `create_page_from_file` (stdio) and inline `file://` URL handling. Hosted has no filesystem access.
4. **Self-hosted control.** Our server runs locally with the user's API token; hosted is OAuth-only and runs on Notion's infra. Different trust/privacy posture.
5. **Stdio + HTTP dual transport.** Users who want stdio (the default for most Claude Desktop / Claude Code MCP setups) get it; hosted is HTTP-only.

**Does NOT survive:**

- "92% smaller for find_replace edits" — collapsed; hosted has the same primitive.
- "6.4× cheaper on listing budget" — collapsed; listing budgets are roughly equal.
- "page-replace-only servers" framing for the marketplace category — provably wrong.
- "Compact tool ergonomics overall" as a structural claim — partially survives. We have shorter individual tool descriptions and focused tool surfaces (e.g., `find_replace` standalone vs `notion-update-page` with sub-commands), which is a real ergonomic edge for LLM agents reading tool lists. But it's a polish edge, not a category moat.

## Recomputed numbers for downstream artifacts

For `readme-claim-language-revision-v0.5` and `bench-scripts-audit-2026-04-28.md` follow-ups:

- **W1 ("find_replace" win):** delete entirely. Both surfaces have equivalent primitives.
- **W2-W4 (other workflow comparisons):** need re-modeling against hosted's actual `update_content` / `replace_content` paths, not against full-page-rewrite. Conservative read: most of the W2-W4 gaps narrow significantly or invert.
- **Listing budget claim:** delete the "6.4× more" framing entirely. If a comparison is needed at all, the right framing is "comparable to hosted at ~5K tokens for both." Or skip the listing-budget angle in public copy.
- **Workflow win story:** rebuild from the real differentiators above (update_block, update_section, append_content, file uploads, transport flexibility). Cite specifics, not aggregate "smaller is better" framing.

## Recommendations on tasuku state

- **`readme-claim-language-revision-v0.5`:** the OAuth-capture blocker is now cleared. Still blocked on `wrap-bench-scripts-in-regression-tests` (filed 2026-05-01 from the testing audit). When the bench tests land, this is unblocked and the revision should rebuild claim language from the differentiators above, NOT from the workflow-token numbers.
- **`pr-audit-deferred-items-from-met` (composite):** add a note that C1 and C2 are now settled; bench audit's residual items can collapse.
- New task suggested: **`investigate-tool-coverage-gap-views`** (normal). Hosted's view creation/management is genuinely missing from our surface and is a real user need (database UX is incomplete without view configuration). Worth scoping as a v0.7+ feature even if not user-requested yet.

## Audit areas not covered

- **No sample `tools/call` against hosted captured.** The brief asked for this (verify wire shape). Skipped because the C1 question was answered definitively from schema alone (`update_content` is in the enum), and a sample call wouldn't change the answer. If a future audit wants wire-shape verification (e.g., "does hosted's update_content actually accept the same payload shape it advertises?"), that's a separate dispatch.
- **Token count is a reconstruction.** I built the JSON from schemas in my session; the live wire response could differ by ±10% due to formatting (whitespace, JSON envelope wrappers, response metadata). The order of magnitude is right; the exact number is approximate.
- **Tool count discrepancy with bench audit.** Bench audit said "18 hosted tools"; live count is 14. Either hosted shrank, the bench projection was wrong, or I'm missing tools that didn't surface in Claude Code's deferred-tools listing. Worth a 5-min cross-check at some future point but doesn't affect C1/C2 conclusions.

## Session details

- Capture session: this orchestrator session, 2026-05-01 ~01:00 PDT
- Notion OAuth client registered: `easy-notion-mcp live-capture (audit)` (revocable under Notion Settings → Connections)
- MCP server scope: project (`/home/jwigg/.claude.json`, project: `/mnt/d/backup/projects/personal/mcp-notion`)
- Auth status verified via `/mcp` dialog → "Authentication successful. Connected to notion-hosted."
- Tool count: 14 (plus 2 generic MCP utilities)
- Token count: 5,336 (cl100k_base, file `/tmp/notion-hosted-tools-list-2026-05-01.json`)

The earlier dispatched-harness attempt (session `live-oauth-capture-mcp-notion-com-2026-05-01`, ID `bd43278b-ac38-462a-b0bb-06e2e0c2225c`) is captured separately. The harness died on dispatch return and lost the auth code; switched to in-IDE capture for this run.

# Search robustness — design capture (2026-07-04)

Status: design note backing the `search-robustness` tasuku task. No commitment until
the task is picked up. Public-safe: engineering design only.

## Problem

Notion's REST `/v1/search` matches **titles only**. Agents therefore have a retrieval
hierarchy with one weak level:

1. Structured lookups → `query_database` filters (strong: deterministic, complete).
2. Known location → tree navigation (`list_pages`, `list_databases`, reads).
3. Known title → `search` + the agent's own synonym expansion across variants.
4. **Known content, unknown page → weak today.** Requires guessing a candidate set,
   then `search_in_page` per candidate: N tool calls, N reads.
5. Vague meaning → agent brute-force reading (rare but real).

Design principle: agents are iterating retrievers. They expand queries, triage, and
loop. The right primitives are deterministic and cheap-per-iteration (the grep model
that coding agents converged on), not one-shot ranked magic. Level 4 is fixable; the
fix also shrinks level 5, because free iteration + BM25 + agent-side query expansion
covers most "vague meaning" lookups.

## Phase 1 — cheap wins (no new infrastructure)

- **Snippets in `search` results**: include a short content/context preview per hit
  so the agent can triage without a `read_page` per candidate.
- **Recency lever**: expose/emphasize the API's last-edited-time sort in `search`;
  "recently touched" is one of the strongest priors an agent has.
- **Workspace outline tool**: one call returning the compact tree (titles, ids,
  last-edited, token-lean formatting). Turns "guess the candidate set" into "read
  the map." Additive tool, contract-safe.
- **Search-strategy skill**: document the loop (title-variant search → outline scan →
  scoped in-page search → database queries). Ships as docs/skill.

## Phase 2 — local full-text index (the centerpiece)

A `search_text` tool backed by a local SQLite FTS5 (BM25) index of page text.

**Build (first use):**
- Enumerate all shared pages/databases via `/v1/search` (empty query, paginated,
  last-edited sort). Database rows are pages; render property values as text too.
- Fetch blocks per page, convert via the existing markdown converter (reuse, not new
  conversion code), store per-section rows: page id, title, breadcrumb path, block
  anchor, section text, `last_edited_time`.
- Rate limits (~3 req/s, 1-3 calls/page) → roughly 10-20 min per 1,000 pages, once.
  Progressive availability during build (report coverage). A few MB per 1,000 pages,
  e.g. `~/.easy-notion-mcp/index.db`.

**Freshness — lazy revalidation, deliberately NO daemon:**
- At `search_text` call time: one API call enumerating pages by last-edited desc;
  walk until timestamps drop below the stored high-water mark → that prefix is the
  complete changed-set. Re-index just those pages, then answer from SQLite.
- Nothing changed → 1 API call + ~1ms local query.
- Deletions/un-shares: occasional lazy full re-enumeration sweep.
- Documented caveat: edits made seconds before a search may miss it once.
- Rationale for lazy-only: the repo boundary is converter-only, no scheduler/runtime.
  A query-time-revalidated cache is a cache; a background crawler is a daemon. Keep
  the former, never the latter.

**Result shape (token-lean):** ranked hits with title, breadcrumb, highlighted
snippet, page/block id, last-edited. FTS5 gives phrase/prefix/AND/OR/NEAR; local
queries cost zero API calls, so agent query-expansion iteration is free.

**Constraints:**
- **Opt-in only**, with a plainly documented trust-story amendment: the server holds
  the Notion token and, optionally, a local cache of page text (user's machine,
  wipeable with one command). Never silent.
- **stdio-only initially** via the existing `transports` mechanism: in HTTP
  multi-user mode the host would hold other users' content caches — a different
  trust proposition, out of scope until designed.
- Big-workspace mitigation: optional subtree scoping for the index.
- Non-goal for now: local embeddings/vector search. Heavy dependency, marginal gain
  over FTS + agent expansion, and it breaks "no AI in the server." Re-evaluate only
  if FTS demonstrably falls short.

**Alternative if the index feels heavy — scoped subtree grep (no index at all):**
a tool like `search_in_pages(parent_id, query)` that fans out over a parent's
descendants server-side (live block reads, existing converter) and returns matched
snippets only. No storage, no staleness, no trust-story change; the costs are
per-query latency and rate-limit budget (it re-reads the subtree each call). Viable
as a Phase 2a stepping stone or as the permanent answer for users who decline the
opt-in index. Decision between "index" and "live subtree grep" (or both) belongs to
whoever picks up the task, after Phase 1 data on real usage.

## Sequencing

After `tool-surface-token-reduction` — both touch tool descriptions and the surface
budget, and Phase 1's new tools should be born with lean descriptions rather than
retrofitted.

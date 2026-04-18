# Frame 5 — The Autonomous Agent on an Ambiguous Task

**Generator-provided thesis:** The product's users are AI agents, not humans. Surface: how the ~28 tool descriptions read to an agent at turn-0, which tool an agent actually picks for ambiguous tasks, how much context the tool list burns, and whether failed calls produce self-correcting errors or induce call loops.

**Runtime test parent page:** `frame-5-test-pages-2026-04-17` — `346be876-242f-8163-89b8-c65c93ddf7e7` — https://www.notion.so/frame-5-test-pages-2026-04-17-346be876242f816389b8c65c93ddf7e7 (archived at end of session).

**Session chain:** see appendix.

**Methodology deviation from shared doc:** per frame-specific override, this frame uses Gemini-cold / Gemini-skeptical / Codex-verify as a 3-way signal instead of PM+Codex debate blocks.

---

## 1. Token cost baseline

Captured from a stdio `tools/list` handshake against `dist/index.js` (HEAD=`d66eb47`). All 28 tools present; HTTP mode would strip `create_page_from_file` to 27.

| Shape | Description | Tokens (cl100k) | Bytes |
|---|---|---:|---:|
| A | Full `tools/list` result (MCP wire format) | **3,819** | 17,175 |
| B | Anthropic tool-schema array (`{name, description, input_schema}`) | **3,818** | 17,193 |
| C | Name + description only, no schema | **2,345** | 10,187 |

**Interpretation.** The turn-0 fixed cost for an agent that mounts this server is ~3.8K tokens. That's on the upper end of a "medium catalog." Of that, ~1.5K is `input_schema` boilerplate and ~2.3K is the human-readable description surface. Two tools are token-outliers: `create_page` (extensive markdown-syntax enumeration in the description) and `update_data_source` (full-list semantics + changelog pointer + payload examples). Together they account for an estimated ~1.1K of the 3.8K total.

**Competitor comparison — deliberately unbounded.** The frame brief asked for a compare vs a 9-tool `better-notion-mcp` and the 18-tool official server. The file where their descriptions are catalogued (`compare-awkoy-notion-mcp.md`) is fenced for this frame. Per orchestrator directive #2, I do not synthesize a comparison I cannot ground. Tool-count ratios are the only comparison available: this catalog is ~3.1× the tool count of the 9-tool alternative and ~1.6× the official server's. Token cost ratios are likely similar or higher if our descriptions are verbose (as `update_data_source` suggests).

---

## 2. The 8 tasks

Each task is a realistic, single-utterance user ask where multiple tools have a plausible claim. Three Gemini passes (all cold relative to source/README; differ only in skepticism priming) plus Codex verify (code access) plus runtime probes where the question had a ground-truthable answer.

| # | Gist |
|---|---|
| T1 | Replace the "Risks" section of a page; user authorized full-section overwrite |
| T2 | Add a DB entry without having inspected the schema |
| T3 | Same as T1 but the heading's real spelling is "Risk / Open Items" (case+whitespace drift) |
| T4 | Summarize "my Notion home" with no page IDs in hand |
| T5 | Append today's standup notes under today's date heading (heading may not exist) |
| T6 | Rename "staging" → "pre-prod" on a runbook page but NOT inside code blocks |
| T7 | Create this week's weekly-review from last week's template page |
| T8 | Move Inbox pages >7 days old to Archive; "Inbox" type unknown |

### T1 — Replace the 'Risks' section

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `read_page` | low |
| Gemini skeptical (moderate) | `read_page` | low |
| Gemini skeptical (sharp) | **`update_section`** | low |
| Codex verdict | Gemini cold **over-cautious**; description accurate. `update_section` at `src/server.ts:1029` is purely destructive-replace — it deletes heading + section blocks and appends the provided markdown. `read_page` is only required if the user wants to preserve existing bullets, and that wasn't the task. |
| Runtime | n/a (behavior confirmed by the T3 success-path probe and source trace) |

**Signal.** The default agent routes to `read_page` first even though the target tool matches perfectly. Only under strong skeptical priming ("do you REALLY need read_page first?") does the agent land on `update_section`. That's a discoverability problem: the description doesn't explicitly license the single-call path.

### T2 — Add a DB entry, schema uninspected

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `search` (filter=databases) | low |
| Gemini skeptical (moderate) | `search` | low |
| Gemini skeptical (sharp) | **`list_databases`** | low |
| Codex verdict | `search` for name→ID is fine; the **downstream hazard** is `add_database_entry`. `convertPropertyValues()` at `src/notion-client.ts:199` iterates agent-supplied keys and skips (`continue`) any key that's not in `ds.properties`. `createDatabaseEntry()` at `src/notion-client.ts:554` then posts the surviving (possibly empty) map. Result: **silent-success with empty row**. Description "server converts using the database schema" reads as validation; actual behavior is soft-lookup-with-silent-drop. |
| Runtime | Confirmed. Created DB with schema `{Title:title, Severity:select, State:status}`. Called `add_database_entry` with `{Name, priority, status}` (all wrong names). Server returned `{id, url}` success. `read_page` on the new entry returned `title: ""` and no properties. Second probe with `{Name, Priority, Status}` (docstring casing) produced same empty row — the DB didn't have `Name/Priority/Status`, so everything was dropped. |

**Signal.** This is a **silent data-loss path**. The agent sees success, has no recovery signal, and moves on. No discoverable error, no warning. The description compounds the issue by illustrating with a property set (`{Name, Status, Priority}`) that won't match most user DBs.

### T3 — update_section miss on case+whitespace drift

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `read_page` | low |
| Gemini skeptical (moderate) | `read_page` | low |
| Gemini skeptical (sharp) | `read_page` | medium |
| Codex verdict | Gemini **over-cautious**; description accurate. On a miss, `update_section` at `src/server.ts:1043` builds an `availableHeadings` list by walking top-level blocks through `getBlockHeadingText()` (`src/server.ts:106`) and includes it in the error payload. `read_page` to discover the real heading is unnecessary — a single retry on the returned list is enough. |
| Runtime | Three probes on the same page: (a) `heading:"Risks"` on a page whose heading is "Risk / Open Items" → `{"error":"Heading not found: 'Risks'. Available headings: [\"Project doc\",\"Overview\",\"Risk / Open Items\",\"Timeline\",\"Decisions\"]"}`. (b) Case-drift (`"risk / open items"`) → SUCCESS (`{"deleted":3,"appended":7}`). (c) Whitespace-drift (`"Risk/Open Items"` — removed spaces around slash) → same error-with-headings payload. Recovery is one turn. |

**Signal.** The tool has **excellent self-correcting error recovery**, but it's **undersold in the description**. Even sharply-primed Gemini doesn't discover it and routes to `read_page` defensively. Pure description gap.

### T4 — Summarize Notion home, no page IDs

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `search` (query="home") | medium |
| Gemini skeptical (moderate) | `search` (query="") | medium |
| Gemini skeptical (sharp) | `search` (query="") | low |
| Codex verdict | Gemini **under-cautious** on feasibility; no dependable primitive exists. `list_pages` at `src/server.ts:621` strictly requires `parent_page_id` and doesn't fall back. `search` at `src/notion-client.ts:428` forwards the query verbatim to Notion search (heuristic, recency-biased). |

**Signal.** **Capability gap**: no `list_top_level_pages` / `list_workspace_roots` / `get_home`. Every variant agent defaults to `search`, which may return a plausible-looking list but is not a specified contract for "home." This is a silent-failure path for read-only home summary tasks.

### T5 — Append standup notes under today's date heading

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `search` (to locate page first) | low |
| Gemini skeptical (moderate) | `search` | medium |
| Gemini skeptical (sharp) | `read_page` | medium |
| Codex verdict | All Gemini passes reasonable but for **the reason Gemini didn't fully articulate**: `update_section` does NOT create a missing heading. On heading miss it errors with `availableHeadings`. Safe routing is `read_page` → inspect → branch to `update_section` (heading present) or `append_content` (heading absent). |

**Signal.** **Routing ambiguity / missing primitive**: no single tool for "update-or-create section under heading." Every path requires a branch. Agents get to the right answer via read-first, but the path is >1 turn.

### T6 — Rename 'staging' to 'pre-prod' but NOT in code blocks

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `read_page` | low |
| Gemini skeptical (moderate) | `read_page` | low |
| Gemini skeptical (sharp) | `read_page` | low |
| Codex verdict | Gemini **correct**; description accurate. `find_replace` at `src/server.ts:531` has no block-type filter; it forwards `old_str`/`new_str` to Notion. The description doesn't promise code-block exemption. |
| Runtime | Created a page with `staging` in paragraphs AND inside a ```bash``` code block (`kubectl config use-context staging` + `./staging-overlay`). Called `find_replace(find="staging", replace="pre-prod", replace_all=true)` → `{"success":true}`. Read back: every `staging` was replaced, **including inside the code block**. Confirmed no filtering. |

**Signal.** Positive pattern: **description is appropriately scoped** — it doesn't over-promise code-block smarts, so even weakly-primed agents correctly route to read-then-local-edit-then-replace. This is the one probe where agent uncertainty and tool capability line up.

### T7 — Duplicate the weekly-review template

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `duplicate_page` | low |
| Gemini skeptical (moderate) | `duplicate_page` | low |
| Gemini skeptical (sharp) | `duplicate_page` | low |
| Codex verdict | Gemini **under-cautious**; description **misleading**. `normalizeBlock()` at `src/server.ts:122` has NO `child_page` case; unknown block types fall through `default: return null` and are filtered out. So nested blocks of supported types copy, but **actual child pages do not deep-copy**. Description says "creates a new page with the same content" — this is materially wrong when the template has subpages. |
| Runtime | Created a template page with a markdown checklist AND a real child page ("Child of template") under it. Called `duplicate_page` → success. Read back the duplicate: has the `# Template root` heading and checklist; **the "Child of template" subpage is absent**. No warning, no error, silent data loss. |

**Signal.** **Silent data loss on template instantiation** — the exact use case the tool exists for. Every agent pass (including sharp-skeptical) picked this tool confidently. Templates commonly have subpages; this is a high-incidence failure mode.

### T8 — Move Inbox pages >7 days old to Archive

| Pass | Pick | Uncertainty |
|---|---|---|
| Gemini cold | `search` (query="Inbox") | low |
| Gemini skeptical (moderate) | `search` | high |
| Gemini skeptical (sharp) | `search` | high |
| Codex verdict | Gemini **under-cautious**. `search` at `src/server.ts:605` forwards `query` + optional filter to Notion; Notion search matches on title/metadata, not body content. If "Inbox" is only a heading inside a dashboard page, `search` will return no hit and the agent has no next move. |

**Signal.** **Silent-empty return on a common pattern.** Users say "Inbox" ambiguously; Notion workspaces often have it as a heading inside a dashboard page, not a top-level entity. The tool has no way to search within page bodies for headings/sections.

---

## 3. Enumerated cases

### 3.1 Misleading descriptions (description implies X; code does Y)

- **add_database_entry** — "server converts using the database schema" reads as validation. Actual behavior: unknown property names are silently dropped; the pages.create call proceeds with whatever survives, including the empty-object case. Runtime-confirmed: success response with a completely empty row. Code: `src/notion-client.ts:199` (the `continue` on missing key), `src/notion-client.ts:554`.
- **duplicate_page** — "creates a new page with the same content." Nested child_page blocks are dropped because `normalizeBlock()` has no case for them. Runtime-confirmed. Code: `src/server.ts:122`.

### 3.2 Fragile descriptions (agent picks diverge under priming)

- **update_section (T1)** — cold and moderately-skeptical Gemini both default to `read_page` first, even though the task explicitly authorizes a full overwrite. Only strong priming ("challenge the read-first default") routes to `update_section`. The description doesn't explicitly license the one-call path for authorized overwrites. Consequence: agents burn an extra turn + ~1-4K tokens of page content for no reason in the common case.
- **list_databases vs search (T2)** — cold and moderately-skeptical Gemini pick `search`. Sharp-skeptical picks `list_databases`. `search` with a filter works, but `list_databases` is strictly cheaper (no query string, deterministic) when you only have the DB name. The catalog's own `search` description explicitly points at `search` as the discovery path ("Use filter: 'databases' to find databases by name"), which biases against `list_databases`.

### 3.3 Accurate-positive patterns (description, code, and agent behavior aligned)

- **update_section miss recovery (T3)** — the tool's error payload includes `availableHeadings`, which is a strong single-turn recovery affordance. The description doesn't advertise it, but the code delivers. Low-risk to document this in the description and likely to collapse a turn for agents that currently read-then-retry.
- **find_replace (T6)** — description claims "targeted text changes" and is silent on block-type awareness. Code matches: no filter. Agents correctly distrust it for the code-block carve-out and route through read+local-edit+replace.
- **duplicate_page for simple pages (T7)** — for templates without subpages, picks and behavior align. The silent data loss only appears when subpages exist.

### 3.4 Recovery gaps (agent given insufficient signal to self-correct in one turn)

- **add_database_entry silent success** — no error, no warning, no "these property names were unknown" field in the response. An agent has no in-band signal that the write was a no-op.
- **duplicate_page silent child-page drop** — no warning field, no "X nested pages were not duplicated" in the response.
- **update_section on missing date heading (T5)** — errors with available headings, but doesn't offer an "auto-create heading" branch. Agent is forced into the read-then-branch pattern.
- **search for content-inside-page matches (T8)** — returns empty with no hint that body/heading content isn't indexed by this tool. Agent thinks the entity doesn't exist.
- **no list-roots primitive (T4)** — `list_pages` requires a parent; `search` with an empty query is heuristic; no `get_home` or `list_top_level`. Agents route to `search` by elimination, not by affordance.

### 3.5 Capability gaps (the frame surfaced missing tools, not broken ones)

- `list_top_level_pages` / `list_my_pages` / `get_home` — no way to enumerate workspace roots without either knowing a parent ID or falling back to heuristic search.
- `search_within_page` / heading-level finder — no way to locate a named section across the workspace if the section isn't a top-level entity.
- `add_database_entry_strict` — either a `strict: true` flag that rejects unknown properties, or a default-on server-side validation with a non-silent fallback.
- `duplicate_page(deep: true)` — or, at minimum, a response field listing child pages that were skipped.

---

## 4. Cross-frame acknowledgment (blind spots)

The frame-generator's blind-spot note flagged that this frame can't see code-layer correctness — an agent can pick tools perfectly and still be wrong because the converter mangled the payload. That's borne out: T2 and T7 are Frame-5-visible as agent-facing failures (silent-success / silent-data-loss), but the **conditions** that produce them (the `continue` on unknown key in `convertPropertyValues`, the missing `child_page` case in `normalizeBlock`) are code-layer findings that Frame 1 would own. Frame 5 surfaces the behavioral contour; Frame 1 surfaces the fix.

Additional likely blind spots this frame missed:
- **Markdown roundtrip fidelity**: Frame 5 didn't probe whether `read_page` → edit → `replace_content` preserves all block types. If `normalizeBlock`'s `default: return null` affects other block types (columns, callouts, embeds) beyond child_page, the entire "read, edit, replace" pattern silently drops content. Frame 1 or Frame 2 (if one exists for converter correctness) owns this.
- **Concurrency / idempotency**: Frame 5 only probed single-turn routing. Multi-agent or retry scenarios (e.g. T2 retried after a silent empty row) weren't explored.
- **Auth / transport edge cases**: `create_page_from_file` is stdio-gated; this frame didn't test what error an HTTP-mode agent sees when it tries to call it (the stub in `src/server.ts:941-943` exists but wasn't probed).

---

## 5. Session chain

| Role | Agent | Session name | Session ID | Status |
|---|---|---|---|---|
| Frame-5 orchestrator | Claude (me) | (this conversation) | — | — |
| Gemini cold (agentic attempt) | gemini | `frame-5-gemini-cold` | — | **failed** (fetch error turn 3) |
| Gemini cold (inline catalog) | gemini | `frame-5-gemini-cold-v2` | — | completed |
| Gemini skeptical (agentic attempt) | gemini | `frame-5-gemini-skeptical` | — | **failed** (fetch error turn 2) |
| Gemini skeptical (moderate prime) | gemini | `frame-5-gemini-skeptical-v2` | — | completed |
| Gemini skeptical (sharp prime, attempt 1) | gemini | `frame-5-gemini-skeptical-v3` | — | **failed** (fetch error); continue_agent returned hallucinated non-Notion tools |
| Gemini skeptical (sharp prime, attempt 2) | gemini | `frame-5-gemini-skeptical-v4` | — | **failed** (fetch error) |
| Gemini skeptical (sharp prime, completed) | gemini | `frame-5-gemini-skeptical-v5` | — | completed |
| Codex verify (consolidated) | codex | `frame-5-codex-verify` | — | completed |

Session IDs are tracked server-side by `mcp__agents__list_agent_sessions`; the orchestrator can retrieve them from there if needed. Three Gemini sessions failed transiently (network) and were retried under fresh names to avoid contaminated state. No session was reused post-failure via `continue_agent` for load-bearing output.

## 6. Runtime test pages (archived at end of session)

- **Parent** `frame-5-test-pages-2026-04-17` — id `346be876-242f-8163-89b8-c65c93ddf7e7` — archived
- T3 probe: `T3 Section Miss Probe` — id `346be876-242f-813c-a0c7-c08241115fb5`
- T2 probe DB: `T2 Bug Tracker Probe` — id `500a7251-81dd-4778-9105-8c55d8199092` (+ 2 silent-empty rows)
- T6 probe: `T6 find_replace code-block probe` — id `346be876-242f-8123-93f9-eb4b2dcbd976`
- T7 probe template: `T7 duplicate_page template probe` — id `346be876-242f-81f9-a5f8-ef84e4895a69`
- T7 probe child: `Child of template` — id `346be876-242f-81d9-a4cb-cdfa7aad9604`
- T7 probe duplicate output: `T7 duplicate output` — id `346be876-242f-817f-b1d9-f81f022b339a`

All child pages are inside the parent, which is archived as the last action of this session.

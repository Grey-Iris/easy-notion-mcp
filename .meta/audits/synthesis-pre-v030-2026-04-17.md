# Synthesis — pre-v0.3.0 investigation

**Date:** 2026-04-17
**Inputs:** 1 taxonomy, 2 primary audits (A, B) + 5 Codex pass-scratches, 6 frame explorations (archeologist / first-timer / multi-tenant / red-team / agent / drift-tracker), 2 older 2026-04-10 artifacts.
**Method:** surface-first inventory (taxonomy), then audits in opposite-order skim + deep read, then frames, then scratch + older artifacts. Findings normalized to `(surface, failure-mode)` tuples and grouped by convergence.
**Role:** synthesis PM, no new discovery. I did not read source code.

---

## Executive summary

The combined body of work is mature enough to make a ship decision. Audits A and B converge on the same code-level risks through different instruments (Codex-led vs direct-read), and the six frames add breadth (security, ergonomics, platform drift) that both audits compress. The shape of the evidence is: **no finding is structurally broken, but the tool surface has three classes of "succeeds with data loss" that aren't a single bug to fix** — destructive-edit non-atomicity, silent write-side schema drift (unknown property names/types), and silent read-side block drop. Two security findings on the HTTP path (file:// as host-FS read, DNS-rebinding reachability) harden a surface most users will never touch but embarrass the project if a Docker/Dify user hits them. First-timer and agent-ergonomic frames consistently flag that the README and tool descriptions **overstate capabilities**; this is cheap to fix and would collapse a class of agent failures. No source found a reason to delay the tag indefinitely; 3–5 concrete fixes shift v0.3.0 from "defensible" to "load-bearing."

---

## §0 Source inventory

| # | Source | Method | Scope (one line) |
|---|---|---|---|
| T | `.meta/research/use-case-taxonomy-2026-04-17.md` | Direct code read, 8 lenses | Surface census — tools, blocks, properties, workflows, failure modes |
| A | `.meta/audits/pre-v030-2026-04-17.md` | Direct read + 2 Explore agents + runtime smoke, no Codex | Code-level audit w/ C1-C3, H1-H8, M1-M8, L1-L6 |
| B | `.meta/audits/pre-v030-audit-b-2026-04-17.md` | PM + Codex × 6 passes + 3 debate rounds + runtime probes | Concern-based audit w/ F-1..F-22, debate-hardened |
| F1 | Frame 1 (Archeologist) | PM + Codex × 5 + 5 runtime probes | Markdown ↔ blocks round-trip fidelity |
| F2 | Frame 2 (First-timer) | PM + Codex × 4 | 15-min setup friction, docs accuracy, OAuth first-run |
| F3 | Frame 3 (Multi-tenant) | PM + Codex × 4, no runtime | OAuth / concurrency / cache / session isolation |
| F4 | Frame 4 (Red team) | PM + Codex × 5, scratch runtime | URL sanitizer / workspace root / prompt injection / OAuth relay / supply chain |
| F5 | Frame 5 (Agent) | Gemini-cold + Codex-verify + runtime probes on Notion | Turn-0 tool cost, routing ambiguity, recovery gaps |
| F6 | Frame 6 (Drift) | PM + Codex × 5 (pass 3 no rebuttal — context limit) + runtime probes | Notion platform seam — pagination, rate limits, version drift, archive lifecycle, schema cache |
| P2 | `pass2-scratch.md` | Audit B pass 2 raw Codex | Silent-failure sweep (SF-1..SF-10) |
| P5 | `pass5-scratch.md` | Audit B pass 5 raw Codex | Boundary validation (BV-1..BV-6) |
| H1 | `easy-notion-mcp-codebase-state-2026-04-10.md` | Direct read, pre-PR | Superseded — pre-PR #21 / #22 planning context; test-file layout confirmed |
| H2 | `notion-status-api-verification-2026-04-10.md` | Notion docs fact-check | Background for `update_data_source` tool description |

---

## §1 Convergence map

Each row is one `(surface, failure-mode)` atom. Sources column lists every distinct source that described the same atom. Severity column shows the spread; where the final severity in §6 differs, see the notes.

### Tier A — data-loss / security, ≥3 sources

| # | Finding | Sources | Severity spread | Notes |
|---|---|---|---|---|
| C-1 | `replace_content` / `update_section` delete-then-append is non-atomic; mid-call failure leaves page destroyed | A C1; B F-3; F1 Probe 4; F6 §1.2–§1.3; T §6.2 | A=CRITICAL → B=HIGH (debated down) → F6=GROUNDED-NOTION | All five sources agree Notion has no transaction primitive; B has a concrete fix for `update_section` that preserves the heading anchor (AT-2 path) |
| C-2 | Silent drop of **unknown property names** on db writes (`convertPropertyValues` `continue` on missing key) | A H1; B F-9; F5 T2 (runtime-confirmed); F6 §3 case 10 (runtime-confirmed); P2 SF-6; T §6.1 | All HIGH | Runtime-verified twice. `add_database_entry({Name,priority,status})` returns `{id,url}` success with empty row. The single cleanest "silent-success" path |
| C-3 | Silent drop of **unsupported property TYPES** — relation, people, files, formula, rollup (`convertPropertyValues` default branch; `simplifyProperty` default null) | A H2; B F-8; F6 §3 cases 11+12; T §2.4, §1.3, §8.6; P2 SF-5 | All HIGH | Relation is the flagship gap. `tests/relation-property.test.ts` exists but tests a copied helper, not production code (see §1 C-7) — so the suite doesn't catch this |
| C-4 | Unsupported Notion block types silently dropped from `read_page` / `duplicate_page`; compounds with C-1 into data-destruction path | A H7; B F-5; F1 Probe 4; F5 T7 (runtime-confirmed); F6 §3 case 15; T §6.1; P2 SF-4 | A=HIGH; B=MEDIUM (debated down — filter is defensible, lack of warning is the bug); F1=HIGHEST-CONSEQUENCE; F5=silent-data-loss; F6=GROUNDED-CODE | `child_database`, `link_to_page`, `synced_block` are the top-3 at-risk types per F1. F5 runtime-confirmed `duplicate_page` silently drops `child_page` (a template-use-case killer). B's fix adds `warnings: [{omitted_block_types}]` to the response |
| C-5 | HTTP mode `file://` uploads → host-FS read primitive (critical when compounded with static-token no-auth on `/mcp`) | B F-1 + F-4; F3 P4.c; F4 Probe 4 #1+#4; P5 BV-1+BV-2 | B=CRITICAL (compound), HIGH (OAuth alone); F3/F4 agree | `POST /mcp` with `markdown:"[loot](file:///etc/passwd)"` in static-token mode = remote arbitrary local read, unauthenticated. Fix: gate `file://` behind `transport === "stdio"` |
| C-6 | `add_database_entries` / write path rejects 429s as permanent `failed` + discards `Retry-After` | F6 §2 cases 1,2,5 | F6=GROUNDED-CODE | Agent can't retry correctly. A+B didn't explore rate-limit semantics in depth |

### Tier B — reliability / operability, 2–3 sources

| # | Finding | Sources | Severity spread | Notes |
|---|---|---|---|---|
| C-7 | Three test files (`relation-property`, `list-databases`, `update-section`) define local lambda copies of production helpers and test the copies | B F-2; A surprise #1 | B=CRITICAL (relation case), HIGH otherwise; A=Surprise (worth a 5-min check) | For relation specifically, the test is green while production is structurally broken — the suite's coverage is misleading |
| C-8 | Token store is not concurrency-safe; corruption silently returns `[]` → all users re-auth; no atomic rename, no mutex | A L1; B F-12; F2 Case 3.4; F3 P3.a, P3.b, P3.d, P3.e; P5 BV-5+BV-6 | B=MEDIUM; F3=public-shared-conditional | Secondary but frequent finding in multi-tenant deployment |
| C-9 | README + CLAUDE.md "round-trips cleanly" is materially overstated | B F-10 (runtime-verified table); F1 Probe 1 (22 not 25; 10+ asymmetric blocks); A H7 (column_list untested); T §2.1 | All MEDIUM | Spans: image alt, numbered-list `1.` canonicalization, multi-line `$$` collapse, file/audio/video block-type downgrade on round-trip, nested-to-do children, paragraph/quote children, table alignment markers, underline/color, media captions, callout custom icons |
| C-10 | Silent drop of nested `to_do` children both directions | B F-6; F1 Probe 1 + Probe 5 (runtime-confirmed); P2 SF-1 | B=HIGH; F1=FIDELITY-LOSS; P2=HIGH | `- [ ] parent\n  - child` creates flat task. Isolated fix; `to_do` just missing from `attachChildren` |
| C-11 | `NOTION_MCP_WORKSPACE_ROOT` unset/empty falls back to `process.cwd()`; if server started from `/` or `$HOME`, boundary is effectively the whole disk | B F-18; F4 Probe 2 resolution; P5 BV-4 | B=LOW; F4=primary real finding (no attacker caps required) | Fix: require explicit non-root value; reject `/` fallbacks |
| C-12 | TOCTOU in `create_page_from_file` between validate and re-open | B F-13; F4 Probe 2; P5 BV-3 | All MEDIUM | Stdio-only, narrow threat model (requires concurrent attacker write inside workspace). Fix: `open(O_NOFOLLOW)` + `fstat` |
| C-13 | OAuth metadata `service_documentation` URL points to `github.com/jwigg/easy-notion-mcp`; real repo is `Grey-Iris/easy-notion-mcp` | B F-16 (runtime-confirmed); F2 Case 1.3 | Both trivial | Trivial fix |
| C-14 | Tool count mismatch: CLAUDE.md says 26; stdio registers 28, HTTP registers 27 (only `create_page_from_file` gated) | B F-17; F2 Case 1.1 (README tool table also missing `create_page_from_file` + `update_data_source`) | Both trivial | Trivial |
| C-15 | Code-block language passed verbatim to Notion (no alias map); `ts`, `md`, `kotlin-script` fail Notion's closed-enum validation | A H6; F1 Probe 2 #6 | A=HIGH; F1=real bug | A notes this was discovered during PR #22 and never fixed. One-line LANGUAGE_ALIASES map |
| C-16 | Rich-text 2000-char limit unguarded — no client-side chunk/split | A H4; F1 Probe 3; T §4.1 | All MEDIUM | Combined with C-1, a long paragraph → delete existing → API-reject insert → blank page |
| C-17 | HTTP per-session Notion client binds once; never refreshed after OAuth token rotation | A L3; F3 P4.d | Both LOW | Session lifecycle bug, not cross-tenant |
| C-18 | `find_replace` returns bare `{success:true}` with no count; `enhanceError` appends misleading "Check property names and types with `get_database`" to every `validation_error` (fires on no-match AND trashed-page AND everything else) | B F-11 (runtime-confirmed); F1 Probe 5 (discards `unknown_block_ids`); F6 §1 case 5 + §4 cases 5,6,8 (runtime-confirmed on trashed pages) | All MEDIUM | Composite: (a) no-count response is unverifiable; (b) misleading hint propagates to unrelated error classes; (c) Notion's `unknown_block_ids` truncation-recovery metadata is discarded |
| C-19 | `archive_page` / `restore_page` / `delete_database_entry` all map to `in_trash` operations; naming suggests distinct semantics they don't have | F6 §4 cases 1–3; T §3.1 `delete_database_entry` note | F6=GROUNDED-NOTION | Documentation / description issue. Confusing especially for agents — F5 T7's duplicate-page confusion shares a flavor |
| C-20 | HTML in markdown + reference-def tokens silently become `[]` | B F-20; F1 Probe 3 noted adjacent; T §4.2; P2 SF-3 | All LOW–MEDIUM | Migration scenarios (Evernote / Confluence HTML exports) affected |
| C-21 | OAuth revocation leaves orphan refresh token record that can still mint access tokens | F3 P3.c; F4 Probe 4 #7 | F3=security; F4=LOW-MEDIUM | `revokeToken` deletes exact match only; paired refresh entry persists |
| C-22 | `NOTION_ROOT_PAGE_ID` docs say "page-id-or-url" but code passes raw string to Notion API (which expects UUID); URL paste fails loudly-opaquely | A M8 (URL-as-ID unaddressed since 2026-04-09); F2 Case 1.2 | A=MEDIUM; F2=D-wrong | Every tool taking an ID has this trap. No `normalizePageId` helper |
| C-23 | `searchNotion` / `list_databases` surface trashed objects as live (no `in_trash` filter) | A M5 (runtime-observed, 5 leftover `runtime-probe-*` dbs visible); F6 §4 case 9 (NEEDS-PROBE) | A=MEDIUM runtime; F6=NEEDS-PROBE | See §3 contradiction #2 for apparent-but-not-real contradiction with F6's retired `query_database` claim |
| C-24 | Notion-hosted media URLs expire ~1hr; round-trip downgrades `image`/`file`/`audio`/`video` to `type: external`, so links permanently break | F6 §3 case 6; T §2.1 (partial round-trip on media); F1 Probe 1 (file/audio/video blocks downgrade to paragraph links on reparse) | F1=FIDELITY-LOSS; F6=GROUNDED-NOTION | Two distinct flavors: the URL-expiry angle (F6) and the block-type-downgrade angle (F1). Compounding loss for any read→replace workflow on media pages |

### Tier C — polish / hardening, 2 sources

| # | Finding | Sources |
|---|---|---|
| C-25 | Image alt text dropped both ways | A M1; B F-10; F1 Probe 1 |
| C-26 | OAuth refresh tokens never expire; reused on refresh | A L2; F4 Probe 4 #6 |

---

## §2 Blind-spot singletons

Singletons are findings that appeared in exactly one source. For each, I classify why it's a singleton: **(a)** other sources didn't look at that surface, **(b)** other sources looked and implicitly/explicitly disagreed, or **(c)** weak/speculative — only one source reached for it.

### High-value singletons — other sources didn't look (class a)

| Finding | Source | Why this slipped through |
|---|---|---|
| **DNS-rebinding protection disabled (CVE-2025-66414 reachable in SDK 1.29.0)** | F4 Probe 5 | Supply-chain angle; A didn't do a CVE sweep; B ran `npm audit` territory out of scope. Confirmed via SDK source read. Real finding, high severity |
| **HTTP server binds `0.0.0.0`, not `localhost`** (`app.listen(PORT)` omits host arg) | F4 Probe 4 #1 | A+B tested HTTP on localhost and didn't check bind address; F3 is on session isolation not network exposure. Composes with DNS-rebinding and CORS-open |
| **Unauthenticated dynamic client registration** `/register` on open CORS | F4 Probe 4 #2 + #8 | A+B treated OAuth as "correct on security-relevant points"; F3 concluded pendingCodes baseline. Real finding under the 0.0.0.0 bind |
| **Session-binding gap on resumed HTTP requests** — bearer re-auths per request, but session's pre-bound Notion client never re-verified | F3 P2.a + P4.a | A+B focused on per-request correctness, not cross-request session-ID-reuse. Defense-in-depth gap; bad once session-ID leaks |
| **Fence desync — structural injection from fenced code content** (`normalizeOrderedListIndentation` and `splitCustomSyntax` both have their own fence trackers that desync on inner triple-backtick) | F1 Probe 2 | A+B didn't probe markdown escape boundaries with adversarial inputs; F4 probed write-path URL sanitizer but not fence tracker. Runtime-confirmed end-to-end |
| **`duplicate_page` silently drops nested `child_page` subpages** (missing `child_page` case in `normalizeBlock`) | F5 T7 runtime-confirmed; F1 Probe 4 noted the block type | A flagged unsupported-block-drop generally (H7); B rolled it into F-5. F5's runtime demo makes it concrete: template workflow is the exact use case the tool claims |
| **Multi-source databases collapsed to first `data_sources[0]`** — wrong-data writes/reads on wiki-backed dbs | F6 §3 cases 3, 4, 5 + §5 case 8 | A+B noted data-source ID handling but didn't flag multi-source. Real and consequential for wiki deployments |
| **Rich text `mention` / `equation` objects crash `blocksToMarkdown`** — `applyAnnotations(item.text.content, item)` with no `text.content` | F6 §3 case 7 | F1 probed rich-text round-trip but on annotations, not rich-text kinds. Any page with inline page-mentions or inline math will crash read_page |
| **`get_database` → `update_data_source` sequence is not freshness-safe under 5-min schema cache; destructive full-list semantics can silently delete select/status options** | F6 §5 case 9 | The wrapper's own prescribed safe-write flow defeats itself under cache. A+B noted `update_data_source` warning text but didn't catch the cache interaction |
| **Static-text prompt-injection prefix covers ONLY `read_page.markdown`** — titles, comments, query results, db property names/options all unwrapped | F4 Probe 3 | A+B accepted the prefix as hardening without auditing coverage. Severity depends on host rendering; ranked: `list_comments.content` > `read_page.markdown` > db row text values |
| **Read-path URL sanitizer bypass** — `javascript:` URLs on Notion inbound content emit verbatim on read; `isSafeUrl` runs on write only | F4 Probe 1 | A+B considered sanitizer present. Conditional on downstream renderer reexecuting markdown as HTML |
| **`create_database` response lies about which properties were created** — returns requested schema, not actual result | A H3 | B didn't probe create_database output shape. F5 T2 tested add path only |
| **No batching in `createPage` for >100 children** — `pages.create` rejects >100, append paths chunk but create doesn't | A H5 | F6 §1.1 covers the related variant (nested arrays). Asymmetric with `appendBlocks` chunking |
| **Tool failures never set `isError: true`** — every failure is 200 with error text in content | F2 Case 2.10 + 2.4 | Protocol-level issue most visible to agent loops, not humans. A+B saw error messages look helpful in text, didn't check the MCP-spec flag |
| **Token cost at turn-0: ~3,819 tokens** (~3.1× a 9-tool alternative) — `create_page` and `update_data_source` descriptions ~1.1K of the 3.8K | F5 §1 | Nobody else measured. Real tradeoff against agent context budget |
| **No `list_top_level_pages` / `get_home` / `search_within_page` primitives** — agents can't summarize "my Notion home" or find section headings across workspace | F5 §3.5 | Capability gap, surfaced by multiple agent tasks (T4, T5, T8) |
| **Notion API 2026-03-11 breaking changes**: `transcription` → `meeting_notes` rename; Append Block Children `after` → `position` | F6 §3 cases 1–2 | Drift-specific angle. A+B didn't look at Notion changelog |

### Medium-value singletons — plausibly other sources could have looked (class a/b mix)

| Finding | Source | Class |
|---|---|---|
| `read_page` on trashed page returns misdiagnostic "share with integration" error | F6 §4 case 4 runtime | a — A+B didn't probe trashed-page error paths |
| `Boolean("false")` → `true` checkbox coercion | B F-7 | a — others didn't test value coercion, only property names |
| `find_replace` cross-block `\n\n` match collapses block boundaries | F1 Probe 5 runtime | a |
| Inline code with backticks corrupted on read (`blocksToMarkdown` uses single-backtick always) | F1 Probe 3 | a |
| Escaped `\|` in tables lost on read (serializer widens rows) | F1 Probe 3 | a |
| `[embed](url)` overload: any link with text exactly `embed` becomes an embed block | F1 Probe 2 #5 | a |
| `buildTextFilter` hard-codes text-bearing property types; misses `unique_id` and future types | F6 §3 case 13 | a |
| `get_database` discards rich schema details (relation targets, rollup config, formula expression) | F6 §3 case 14 | a |
| `add_database_entries` prefetch-stage 429 bypasses per-item `failed` structure | F6 §2 case 1 | a |
| `enhanceError` discards 429 `Retry-After` header | F6 §2 case 5 | a |
| 500-vs-401 on unknown/revoked/expired bearer (verifier throws generic `Error`) | F3 P4.b | a |
| `update_page` cannot clear icon or cover (truthy check, no unset path) | A M7 | a |
| Server version drift (`0.2.0` hardcoded in server.ts vs `0.2.4` package.json) | A M4 | a |
| `updateDatabaseEntry` parent-resolution comment misleading + possibly wrong on `data_source_id` parents | A M6 | a |
| `add_comment` response strips formatting from the written comment body | A M2 | a |
| `.env.example` scaffold omits OAuth vars | F2 Case 1.4 | a |
| `NOTION_TOKEN="   "` whitespace passes falsy check, fails at first tool call | F2 Case 2.3 | a |
| OAuth issuer hardcoded `http://localhost:${port}` breaks Docker-routed OAuth clients | F2 Case 3.6 | a |
| `/callback` correlation errors emit raw JSON in browser with no recovery guidance | F2 Case 3.2 | a |
| `OAUTH_REDIRECT_URI` drift vs `PORT`: README hardcodes `:3333` while saying default is `{PORT}` | F2 Case 3.3; F4 #9 | partial convergence |
| `processFileUploads` `Promise.all` bursts (N files → 2N concurrent requests) | F6 §2 case 4 | partial convergence w/ A C2 (different failure mode: A=one fails → all fail; F6=concentration spike) |
| README: "`.env` not loaded via `npx`" claim is wrong (dist/index.js calls dotenv/config) | F2 Case 2.7 | a |
| Shell rc non-inheritance in GUI-launched clients (macOS Claude Desktop etc.) | F2 Case 2.8 | a docs-gap |

### Low-value / speculative (class c)

| Finding | Source | Why weak |
|---|---|---|
| Hard-link aliasing inside WSROOT | F4 Probe 2 | Requires attacker write inside WSROOT — doesn't fit stdio threat model |
| Symlinked WSROOT itself | F4 Probe 2 | Operator footgun with no attacker path |
| `NOTION_MCP_WORKSPACE_ROOT` trailing whitespace not trimmed | F4 Probe 2 | Misconfiguration risk only |
| `move_page` / `add_comment` / `update_page` on trashed pages | F6 §4 cases 10–13 | NEEDS-PROBE; tagged speculative |
| `page.parent.database_id` convenience-field deprecation | F6 §3 speculative | Explicitly flagged SPECULATIVE in source |
| Callback error oracle / Notion error reflection | F4 Probe 4 #11 | Low-signal attack |

---

## §3 Contradictions

### Contradiction 1: Is `find_replace` safe or dangerous?

**Audit A C1** bundles `replace_content` and `update_section` as the non-atomic ship-blocker; doesn't explicitly flag `find_replace`. But A's H-series is silent on `find_replace` positively and `find_replace` is not named in A's "fix now" list — implicit "this one's OK."

**Audit B F-11** flags `find_replace` for (a) returning bare `{success:true}` with no count, (b) the misleading `enhanceError` tail hint. Neither is a safety-in-the-C1-sense concern.

**Frame 1 Probe 5** (runtime-verified): `find_replace` uses Notion's native `pages.updateMarkdown` — block-preserving by design. Bookmark survived, annotation (bold on replacement word) preserved. "**Stronger than `replace_content` for fidelity.**"

**Frame 5 T6** (runtime-verified): `find_replace` correctly replaces inside code blocks too — no block-type carve-out. Description is honest (doesn't promise carve-out), but this is a footgun for agents that assume code-block immunity.

**Frame 6 §1 case 5**: `find_replace` discards `unknown_block_ids` from Notion's truncation response — recovery-impossible.

**Resolution** (per directive #3 — explicit about the conditions under which each framing holds):

- **`find_replace` is SAFER for round-trip fidelity** than `replace_content`/`update_section` in the typical case. It uses Notion's native markdown-update endpoint, which preserves untouched blocks (including uploaded files, bookmarks, unsupported-to-us block types like `synced_block`, `child_database`, `link_to_page`). This is Frame 1's ground and it is correct. Agents should prefer `find_replace` when the intent is "change a phrase" or "surgical edit."
- **`find_replace` is MORE COMPLEX to reason about** than a text-find-replace helper would suggest. It (a) operates on the whole-page markdown view so `\n\n` in `find` can delete block structure, (b) does not respect code-block boundaries — replaces inside fences, (c) cannot return a replacement count, (d) discards Notion's `unknown_block_ids` recovery metadata, (e) misleading `enhanceError` hint fires on no-match AND trashed-page errors, pointing at the unrelated `get_database` tool.

**Operative conditions:**
- Prefer `find_replace` when: target string is unique, single-block, not inside a code example, page has uploaded files / unsupported blocks to preserve.
- Prefer `replace_content`/`update_section` when: you're rewriting a whole section, care about atomicity properties equally across all edit tools (they're all non-atomic), and don't have attached files to preserve.
- Avoid `find_replace` when: the target string spans `\n\n`, appears inside code blocks that must be preserved literally, or the caller needs a precise count of how many replacements occurred.

Neither framing "wins." They describe different axes (fidelity-preservation vs behavioral-predictability). Both belong in the v0.3.0 documentation.

### Contradiction 2: Are trashed items surfaced as live?

**Audit A M5** (runtime-observed): `list_databases` returned 5 leftover `runtime-probe-*` and `cache-probe` databases that PR #21's plan claimed were trashed. Either the trash op didn't work, or `searchNotion` returns trashed items by default. A concluded production tool is showing trashed dbs as live.

**Frame 6 §4 retired claim**: Codex pass 4 initially claimed `query_database` surfaces trashed rows. Runtime probe contradicted — archived row was *absent* from result set. Claim dropped.

**Apparent contradiction, real resolution:** These are different surfaces. A looked at `list_databases` / `searchNotion` (workspace-level search). F6 looked at `query_database` (data-source-level rows). They don't contradict. Notion's `dataSources.query` excludes trashed rows by default (pinned version 2025-09-03); Notion's `client.search` does NOT filter by default. Both observations are correct; they describe different Notion API behaviors. The finding that survives is **A's**: list-level `search` / `list_databases` surfaces trashed workspace objects. F6 §4 case 9 remains NEEDS-PROBE for the same claim and should adopt A's runtime evidence.

### Contradiction 3: Severity of silent block-type drop on read

**Audit A H7** = HIGH. **Audit B F-5** = MEDIUM (downgraded via Codex debate — "Notion ships new block types multiple times per year; filtering silently is defensive"). **Frame 1 Probe 4** = HIGHEST-CONSEQUENCE (survived all rebuttals). **Frame 5 T7** = silent data loss on template instantiation, high incidence. **Frame 6** = moved to Frame 3 as coverage gap.

**Resolution**: The severity spread is real and reflects different use cases:

- **As a pure read** (agent reads page, inspects, moves on): filtering is defensible — B's debate ground is correct.
- **As part of read → edit → `replace_content`**: data destruction. F1/F5's ground is correct.
- **For `duplicate_page`** specifically: F5's runtime shows nested `child_page` drops silently — template workflow killer.

The compound failure is what makes this a gating concern. The fix (surface `warnings: [{omitted_block_types}]` in the `read_page`/`duplicate_page` response) addresses all three use cases with one change.

---

## §4 Gap analysis

Demonstrable surfaces no source covered (keeping this short — speculative gaps aren't useful):

1. **Real-world markdown corpora from migration sources** — no source ran a real Evernote HTML export, Confluence export, or Obsidian vault through the pipeline. Taxonomy §8.1 enumerates these as use cases; no one tested them. HTML silent-drop (C-20) plus fence desync (F1 singleton) plus `::emoji::` shortcode behavior plus `[[wikilinks]]` behavior are all unexplored.
2. **Docker Compose / Kubernetes deployment shapes** — F2 touched `host.docker.internal` for Dify/n8n/FlowiseAI but no source audited an actual compose file, env-file interaction, or container networking beyond the bridge. F4 Probe 4 #1 found 0.0.0.0 bind; no source explored how the server behaves under a reverse proxy (X-Forwarded-* headers, TLS termination assumption).
3. **Agent framework coverage beyond Gemini + Codex** — F5 used Gemini-cold/skeptical + Codex-verify. LangChain / DSPy / LlamaIndex / OpenAI Agents SDK tool-calling behavior against this schema is untested. These agents may differ meaningfully on `isError:true` handling (F2 Case 2.10) and on context-budget tolerance (F5 §1).
4. **Long-running session / days-scale stability** — no source ran a session past token-refresh boundaries. F3 P4.d (stale bound Notion client after token refresh) is code-read only.
5. **Observability** — no source looked for structured logging, metrics endpoints, tracing. The server has `console.error` calls, nothing more.
6. **Backward compat with older Notion API versions** — SDK is pinned `@notionhq/client ^5.13.0` but no source verified the minimum version the code would work against, or how the pinned version interacts with Notion's eol policy.
7. **Math-heavy pages corpus** — F6 §3 case 7 (`mention`/`equation` rich_text crashes `blocksToMarkdown`) is code-read only; no actual page with inline mentions + inline equations was round-tripped. STEM user population (taxonomy §1.3) is exactly who'd hit this.

---

## §5 Methodology critique

Known holes in the combined body of work. Anything in this list means "we don't know yet," not "we looked and it's fine":

1. **No live OAuth browser redirect dance.** Audit B explicitly deferred. Frame 2 Probe 3 traced it in code only. Frame 3 P3 / Frame 4 Probe 4 ran static. A full auth flow — user clicks Allow in Notion, Notion redirects back, state validated, token exchanged, first `/mcp` call — has not been exercised end-to-end in any source.
2. **No live multi-client concurrency test against HTTP transport.** Frame 3 found the session-binding gap (P2.a) by code read. The race between two concurrent `/token` exchanges (token-store clobber, C-8) has not been demonstrated. Two agents mid-`replace_content` on the same page — same.
3. **No runtime fuzzing of OAuth `state` param.** Frame 4 Probe 4 #5 notes `state` is random and single-use; no source fuzzed it for collision, replay, or boundary-length inputs.
4. **Frame 6 Probe 3 (version drift) has no Codex rebuttal** — Codex session hit 100% context before rebuttal could be dispatched. PM filtered without dialogue. Cases 3, 4, 5, 14 in Frame 6 §3 are flagged as "least-hardened; recommend follow-up Codex cross-check if driving workstreams."
5. **Frame 5 Gemini passes were flaky** — 3 of 8 Gemini sessions failed transiently. Results are from the completed runs only; selection bias possible.
6. **Frame 3 P1.g (dsId-cache as existence oracle) open question** — not verified against Notion API behavior.
7. **`find_replace` cross-block behavior partially probed** — F1 Probe 5 confirmed `\n\n` matches collapse; edge cases with `unknown_block_ids`+`replace_all`, with mention/equation rich-text, with code-block boundaries are not exhaustive.
8. **No load / performance measurement** — audit A explicitly called out "Performance — no pathology observed in my paths, but I did not measure." Frame 6 §2 identifies rate-limit patterns but no source measured them.
9. **Frame 4 Probe 1 (URL sanitizer) downstream-renderer plantability not verified** — whether Notion's own API rejects `bookmark.url = "javascript:..."` at insert time is unknown. The finding survives unconditionally only for plain-text fields (titles, comments, db cells).
10. **Test-file delta between audits and reality** — C-7 says three test files test copied logic. No source re-ran those tests against the actual production imports. A single 15-minute confirmation pass would either harden or dissolve this finding.

---

## §6 Recommended v0.3.0 gating list

Five gates. If I could only pick three, it would be #1, #3, #5. I deliberated including `duplicate_page` silent child-page drop (F5 T7) and `Boolean("false")` checkbox coercion (B F-7) as gates and demoted them — see §7 for justification.

### G-1 — Gate `file://` behind `transport === "stdio"`; require auth on static-token `/mcp`

**Why a gate:** C-5 is a remote arbitrary local-file-read primitive in static-token HTTP mode, trivially exploitable by any network-reachable caller; it's the product's single most serious security finding, converged across 3 sources and 2 pass-scratches.
**Minimum fix:** Apply the same `transport === "stdio"` gate used for `create_page_from_file` (`src/server.ts:491,940-945`) to every `file://` path in `processFileUploads` and `update_page.cover`. Require a `NOTION_MCP_BEARER` env var in static-token HTTP mode, or refuse non-loopback bind unless `NOTION_MCP_ALLOW_REMOTE=1`.

### G-2 — Harden HTTP transport: wire `hostHeaderValidation`; default bind to `localhost`

**Why a gate:** F4 Probe 5 / Probe 4 #1+#4 make a CVE-2025-66414 reachable via our custom Express integration; compounds with 0.0.0.0 default bind and CORS-open endpoints. A user running the HTTP transport while visiting a malicious website in their browser has a non-trivial attack path.
**Minimum fix:** Instantiate `StreamableHTTPServerTransport` with `enableDnsRebindingProtection: true` OR manually wire the SDK's exported `hostHeaderValidation()` middleware in `http.ts:52`. Change `app.listen(PORT)` to `app.listen(PORT, "127.0.0.1")` unless an explicit override is set.

### G-3 — Document non-atomicity of destructive edits; surface omitted-block warnings on read

**Why a gate:** C-1 plus C-4 combine into a data-loss path (read lossy → edit → replace destructive) that five sources independently surfaced and Frame 5 runtime-confirmed. The compound is what makes both items gate-worthy.
**Minimum fix:** Two items landed together: (a) prominent "destructive; no rollback" warnings in `replace_content` and `update_section` tool descriptions AND README, matching the tone of the existing `update_data_source` warning (which is the in-repo model per audit B §positive-patterns); (b) surface `warnings: [{code:"omitted_block_types", blocks:[{id,type},...]}]` in `read_page` and `duplicate_page` responses at the existing `normalizeBlock`-returns-null site. Ship #3 with update_section's AT-2 fix (keep the heading block, delete `slice(1)`, append after heading-id) if feasible.

### G-4 — Reject unknown property names and unsupported property types on database writes

**Why a gate:** C-2 + C-3 are two flavors of the same pattern (`convertPropertyValues` silently drops unknowns); runtime-confirmed twice in independent sources; the single cleanest "silent-success" failure in the tool surface.
**Minimum fix:** In `src/notion-client.ts:191-245`, (a) collect the list of dropped keys and surface them in an error or `warnings` field; (b) replace the `default: break` in the type switch with a thrown error naming the property and its type, so relation / people / files / formula / rollup get an explicit "this server does not yet support writing <type> properties" message. Derive `create_database`'s response `properties` field from `result.properties` (the actual API response), not the requested schema (A H3).

### G-5 — Test-infrastructure hygiene: rewire `relation-property.test.ts` to exercise production code OR add a production integration test

**Why a gate:** C-7 means the test suite is green while the `convertPropertyValues` switch has no relation case. Any relation work in future PRs flows through a test that can't catch a regression. G-4 removes the acute data-loss risk (writes will error loudly), but without G-5 the next maintainer discovers the coverage gap the hard way.
**Minimum fix:** Rewrite `tests/relation-property.test.ts` to import and exercise `simplifyProperty` and `convertPropertyValues` from their actual source files; add one round-trip test that creates a relation column, writes an entry with a relation value, reads it back, asserts. The other two copied-logic files (`list-databases.test.ts`, `update-section.test.ts`) can slide to v0.3.x — relation is the acute case.

**What I considered and did not gate:**

- `duplicate_page` silently drops child pages (F5 T7 runtime) — tempting because template workflow is the tool's stated use case, but one source. Deferred to §7 UX bucket as an obvious v0.3.x follow-up.
- `Boolean("false")` checkbox coercion (B F-7) — one source, high-severity, but trivial to fix in a follow-up. Not worth holding the tag for.
- OAuth 0.0.0.0 bind (F4 Probe 4 #1) — folded into G-2 as a sub-fix. Doesn't need its own gate.
- Rich-text 2000-char limit (C-16) — medium severity, punts to v0.3.x. A prominent tool-description warning that "long paragraphs may fail validation" is sufficient for now.

---

## §7 Deferred tracklist (v0.3.x / follow-up)

Organized by category, not priority. These are real findings but don't block v0.3.0 once the five gates land.

### Product UX / tool semantics
- `duplicate_page` silently drops nested `child_page` subpages (F5 T7 runtime, F1 Probe 4) — users of template workflows will hit this
- `Boolean("false") === true` on checkbox properties (B F-7) — agents forwarding user JSON strings hit this
- `add_comment` response strips formatting (A M2)
- `update_page` cannot clear icon or cover (A M7)
- `archive_page` / `restore_page` / `delete_database_entry` naming vs trash semantics (C-19)
- Cover accepts `file://` but icon does not — asymmetry (A M3)
- Missing capability tools: `list_top_level_pages`, `search_within_page`, deep `duplicate_page`, strict `add_database_entry` (F5 §3.5)
- `update_section` description doesn't license single-call path for authorized overwrites; `availableHeadings` recovery affordance undersold in description (F5 T1 + T3)
- `create_page_from_file` doesn't process `file://` uploads in its own content (T §3.1)
- `find_replace` misleading `enhanceError` hint + bare `{success:true}` + discarded `unknown_block_ids` (C-18)
- No batch-file-import tool (T §8.1)

### Security hardening
- Unauthenticated dynamic client registration (F4 Probe 4 #2)
- OAuth revocation leaves orphan refresh record (C-21)
- OAuth refresh tokens never expire (C-26)
- `http://` redirect_uris accepted by `/register` (F4 Probe 4 #3)
- Token/register/revoke endpoints CORS-open by default (F4 Probe 4 #8)
- Read-path URL sanitizer bypass — `javascript:` URLs emitted verbatim (F4 Probe 1)
- Prompt-injection prefix covers only `read_page.markdown`; `list_comments.content` is the highest-risk unwrapped surface (F4 Probe 3)
- `NOTION_MCP_WORKSPACE_ROOT` unset → cwd fallback (C-11)
- `create_page_from_file` TOCTOU (C-12)
- Token store not concurrency-safe; corruption silently `[]` (C-8)
- 500-vs-401 on invalid/expired bearer (F3 P4.b)
- Session-binding gap on resumed HTTP requests (F3 P2.a / P4.a)
- Schema cache leaks across OAuth tenants via `get_database` response (F3 P1.a + P1.b)

### Test coverage
- Rewire `list-databases.test.ts` and `update-section.test.ts` to production code (C-7)
- No `read_page` / `replace_content` / `duplicate_page` / `find_replace` / `query_database` / `add_database_entry` handler-level tests (A §testing-assessment: 22 of 28 tools have zero handler-level coverage)
- No error-path tests for destructive operations (A §testing-assessment)
- No tool-level round-trip test (`create_page` → `read_page` asserts-equal)
- No test for `create_page_from_file` with unset `NOTION_MCP_WORKSPACE_ROOT` (P5 BV-4)
- No test for token-store corruption (P5 BV-6)
- No test for rate-limit classification (F6 §2 case 2)

### Documentation / first-timer
- README tool table missing `create_page_from_file` and `update_data_source` (F2 Case 1.1)
- `NOTION_ROOT_PAGE_ID` docs say "page-id-or-url"; URL paste fails (C-22)
- OAuth metadata URL wrong repo (C-13)
- Tool count mismatch (C-14)
- Server version drift (A M4)
- README ".env not loaded via npx" is wrong (F2 Case 2.7)
- `.env.example` missing OAuth vars (F2 Case 1.4)
- `PORT` / `OAUTH_REDIRECT_URI` not format-validated (B F-21)
- CLAUDE.md:116 "round-trips cleanly" overstated — need explicit yes/no matrix (C-9, F1 Probe 1, B F-10)
- Tool failures never set `isError:true` — protocol-level (F2 Case 2.10)
- OAuth issuer hardcoded `localhost` breaks Docker OAuth (F2 Case 3.6)
- `/callback` raw-JSON error pages (F2 Case 3.2)
- README hardcodes `:3333` while claiming `{PORT}` is the default (F2 Case 3.3)
- `NOTION_ROOT_PAGE_ID` vs sharing mental model (F2 Case 2.9)
- Shell rc non-inheritance in GUI-launched clients — docs-gap (F2 Case 2.8)
- Bare `npx` in JSON config examples — spawn ENOENT on nvm / GUI-launched clients (F2 Case 5.3)

### Platform drift (Notion API)
- Notion API 2026-03-11 breaking changes: `transcription` → `meeting_notes`, `after` → `position` on Append Block Children (F6 §3 cases 1–2)
- Multi-source databases collapsed to first `data_sources[0]` (F6 §3 cases 3–5)
- Notion hosted-media URLs expire ~1hr; round-trip downgrades to external URLs (C-24)
- Rich text `mention` / `equation` crashes `blocksToMarkdown` (F6 §3 case 7)
- `buildTextFilter` hard-codes text-bearing property types (F6 §3 case 13)
- `get_database` discards rich schema details — relation targets, rollup config, formula expressions (F6 §3 case 14)
- `searchNotion` / `list_databases` surface trashed objects as live (C-23, A M5)
- `read_page` on trashed page returns misdiagnostic error (F6 §4 case 4)
- `find_replace` on trashed page mixed-signal error (F6 §4 case 5–6)
- 429 classified as permanent `failed`; `Retry-After` discarded (C-6)
- `processFileUploads` `Promise.all` bursts (F6 §2 case 4)
- `add_database_entries` prefetch 429 bypasses per-item failure structure (F6 §2 case 1)
- `duplicate_page` / `replace_content` / `update_section` / `append_content` oversized nested array crashes (F6 §1 cases 1–4)
- `query_database` returns non-page entries on wiki-backed data sources (F6 §1 case 6)
- `read_page` `max_blocks` truncation + round-trip loss (F6 §1 case 7)
- `get_database` → `update_data_source` not freshness-safe under 5-min cache; destructive full-list semantics can silently delete options (F6 §5 case 9)
- No stale-cache recovery path after `validation_error` (F6 §5 case 10)
- HTML in markdown + markdown reference-defs silently dropped (C-20)
- Fence desync structural injection (F1 Probe 2)
- Code-block language aliases (C-15)
- Rich-text 2000-char limit unguarded (C-16)
- No batching in `createPage` for >100 children (A H5)
- No depth limit on `fetchBlocksRecursive` (A C3) — note: audit A graded this CRITICAL; B+F1+F6 did not re-surface it. Under-corroborated but low-cost fix
- Image alt text / numbered-list markers / multi-line equation / table alignment / underline+color / media captions / paragraph+quote children / callout custom icons — full round-trip fidelity matrix (C-9, F1 Probe 1)

---

## §8 How to use this document

- **§6 is the ship decision input.** If all five gates land, v0.3.0 has a defensible surface. If any gate slips, it's an explicit known-issue for a `v0.3.0-rc1` tag with README disclosure.
- **§3 is the inherited-opinion input** for tool description writers — the `find_replace` framing specifically needs to land in both tool description and README.
- **§7 is the tasuku feed.** Each row is a downstream issue/PR candidate.
- **§5 is the "what's next in the audit program" input** — items 1, 2, 4, 10 are high-leverage follow-ups (live OAuth probe, live concurrency probe, F6 pass-3 Codex cross-check, C-7 test reality check).

The convergence in §1 Tier A should be treated as highest-confidence. Singletons in §2 are not proven less real — they are proven less corroborated. Class-(a) singletons (other sources didn't look) are where discovery work has the highest marginal return; class-(c) singletons (weak) are the first to demote if the gate list needs further tightening.

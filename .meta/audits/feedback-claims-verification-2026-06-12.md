# Feedback-claims verification pass — 2026-06-12

**Scope:** Read-only verification of feedback claims flagged by orchestrator triage as possibly stale or misattributed. No fixes, no writes.
**Branch:** `dev` (HEAD `473c8eb`). Latest published: `v0.9.3` (2026-05-13).
**Method:** Codex conducted the systematic code read (checks 1 & 2); PM gathered git/GitHub/schema evidence and judged all findings. See Session chain.

---

## Summary

The two from-memory agent claims — manual chunking (a) and markdown-vs-flat-text ambiguity (b) — are **stale against current code**. Server-side 100-block batching, 2000-char rich-text splitting, and deferred-nesting all landed 2026-05-06/07 and first shipped in **v0.7.0** (2026-05-07); they are present on `dev` and `v0.9.3`. The one-shot tree-create path (c) **exists and works** (single `create_page`); the agent's belief it didn't is a discoverability gap, not a capability gap. Two claims are **genuinely accurate and not stale**: no file-ingest into an existing container (d), and `create_page` returns no block-level receipt (e — though `append_content` does). PR #11 is **substantively merge-ready but two months stale** (BEHIND main; green checks date to 2026-04-14). Issue #25 is **misfiled** against the hosted Notion MCP, not our server.

---

## Check 1 — Auto-chunking / limit-handling coverage

**Verdict: Handled server-side on all block-pipeline write paths. Claim (a) is STALE. Confidence: high.**

Per-path coverage (evidence via Codex trace, PM-verified against the cited lines):

| Write path | 100-block batch | 2000-char split | Deep nesting |
|---|---|---|---|
| `create_page` | ✅ `notion-client.ts:1041` (first 100) + `:1056/:1073` append overflow → `appendPreparedBlocks` chunk loop `:314` | ✅ `prepareBlockForWrite` `:1051/:158` → `splitLongRichText` `rich-text.ts:58/72` (limit `=2000` `:3`) | ✅ deferred-children: `needsDeferredChildWrites` `:204`, `appendDeferredChildren` `:248` |
| `append_content` | ✅ `server.ts:2374` → `appendBlocks` `:1128` → chunk `:314` | ✅ same append path `:318/:158` | ✅ `:330/:338` |
| `update_toggle` | ✅ `server.ts:2763` → `appendBlocks` → `:314` | ✅ `:318` → `rich-text.ts:58/72` | ✅ `:330/:338` |
| `update_section` | ✅ all branches: `appendBlocks`/`appendBlocksAfter` `server.ts:2476/2536/2575` → `:314` | ✅ append branches + heading via `updateBlock` `:2529`/`notion-client.ts:1187` | ✅ `:330/:338` |
| `create_page_from_file` | ✅ same `createPage` path `server.ts:2352/2354` → `:1041/:1073` | ✅ `:1051/:158` | ✅ `:1042/:1060/:1069` |
| `update_block` | N/A — single block by design (`buildUpdateBlockPayload` rejects multiple top-level blocks `server.ts:621`) | ✅ `normalizeBlockUpdatePayloadRichTextForWrite` `notion-client.ts:1189` → `rich-text.ts:215` | N/A — first-level only, documented |
| `replace_content` | **Different pipeline** — see note | **Notion-side** — see note | **Notion-side** |

**`replace_content` note (the one real nuance):** it does *not* use our block-chunking pipeline. It translates to Enhanced Markdown (`server.ts:2386`) and hands a single markdown string to Notion's native `pages.updateMarkdown` (`replacePageMarkdown`, `notion-client.ts:1172`). So the 100-block / 2000-char limits are enforced **by Notion's server**, not ours — not a gap, but it inherits the **large-page timeout** that issue #51 documents on the sibling `find_replace` path (same `updateMarkdown` API; multi-paragraph swaps on >63KB pages time out). An agent handing `replace_content` 50KB of markdown onto an already-large page could hit that timeout rather than a manual-chunk requirement. (Aside: CLAUDE.md says `find_replace` is "the one editing tool" using `updateMarkdown` — slightly stale; `replace_content` uses it too. Doc nit, out of scope.)

**Git history:** batching landed `fffbc79` (2026-05-06 "chunk page creation blocks", introduced `NOTION_BLOCK_CHILDREN_LIMIT`), rich-text splitting `090e6ec` (2026-05-07 "split rich text write segments"), deferred nesting `8c0ddea` (2026-05-06) + depth-2 inlining `a17bb43` (2026-05-13). The cluster first shipped in **v0.7.0** (tag 2026-05-07). Pre-v0.7.0 versions (≤ v0.6.0) lacked it.

**Conclusion:** On current `dev` AND `v0.9.3`, an agent handing 50KB of markdown to `create_page` / `append_content` would **not** need to chunk manually. Claim (a) would only have been true on a pre-v0.7.0 (≤ v0.6.0, ≤ 2026-05-01) install. The agent flagged (a) as from-memory; the memory predates the fix.

---

## Check 2 — One-shot tree-create

**Verdict: CONFIRMED — a single `create_page` call produces the full native tree. Claim (c) is FALSE (path exists). Confidence: high.**

The described shape (callout + 2× H1 + 19 `+++` toggles with multi-paragraph bodies, code fences, lists) = **22 top-level blocks ≤ 100**, so it goes out in **one `pages.create` request** (`notion-client.ts:1041` takes first 100; `:1056` only appends if overflow exists — here none). Markdown → native blocks mapping confirmed: H1→`heading_1` (`markdown-to-blocks.ts:451`), callout (`:197`), toggle subtree (`:625`), code fence (`:562`), list items (`:146`).

**Real caveats (do not change the "one tool call" answer):**
1. Toggle bodies inline only when direct children are ≤100 and are themselves leaves (`notion-client.ts:141/143`). Multi-paragraph bodies, code fences, and **flat** lists are all leaves → inline fine.
2. A **nested** list (sub-bullets), a **nested toggle**, or a body with **>100 direct children** triggers deferred appends for that subtree (`needsDeferredChildWrites :204`, `appendDeferredChildren :248`) — still within the single `create_page` tool call, just multiple Notion API calls under the hood; ordering preserved by advancing `afterBlockId` (`:326`).
3. No explicit server nesting-depth cap; recursion drives deferred writes (`:248/:253/:277`). Notion's own API depth limits still apply.
4. >100 **top-level** blocks would split into create + append (not the case at 22).

**Tests exercising the shape:** `tests/notion-client-block-chunking.test.ts:342` (40 toggles, depth-2 children, resolves in one `pages.create`, zero append/list calls), `:453` (toggle with 101 children → two deferred appends), `:403` (nested-list toggle bodies deferred), `:381` (nested toggles deferred). Parser side: `tests/markdown-to-blocks.test.ts:612/643/659` (toggles + toggleable headings with children).

---

## Check 3 — PR #11 (Docker publishing) merge-readiness

**Verdict: Substantively merge-ready, but STALE — update onto current main and re-run CI before merge. Confidence: high.**

Confirmed good:
- **CI green** on current head `f76af4c`: `ci (18)` pass, `ci (20)` pass, `dependency-review` pass (`gh pr checks 11`).
- **Trigger is `v*` tags only** — `on: push: tags: ['v*']`, **no `branches: [main]`**. Safe. (PR body prose says "branch pushes and version tags" — inaccurate description, but the actual workflow does not trigger on branches.)
- **Dockerfile** has `USER node`, `EXPOSE 3333`, `HEALTHCHECK` (wget `/`), multi-stage Node 20 Alpine. ✅
- **Docs** (`docs/docker.md`) include GHCR pull (`docker pull ghcr.io/grey-iris/easy-notion-mcp:latest`), API-token + OAuth env vars (`NOTION_TOKEN`, `NOTION_OAUTH_CLIENT_ID/SECRET`, `OAUTH_REDIRECT_URI`) and an env-var table. README links to it. ✅
- **`mergeable: MERGEABLE`** — no merge conflicts.

The blocker to a clean merge:
- **`mergeStateStatus: BEHIND`** — the branch is behind `main`. The green checks ran on head `f76af4c` (a `main`→branch merge dated **2026-04-14**), now ~2 months and many releases (through v0.9.3) stale. The checks are green *for that old head*, not for the result of merging into today's `main`.

**Minor (non-blocking) notes:** builder stage uses `npm install` (not `npm ci`) so it can drift from the lockfile; the docker workflow runs no test gate (relies on `npm run build` failing inside the image build). Neither blocks merge.

**Recommendation:** update the branch onto current `main`, re-run CI, confirm green, then merge. No code changes to the PR's actual content are required.

---

## Check 4 — Issue #25 attribution

**Verdict: MISFILED against the hosted Notion MCP, not our server. Confidence: high.**

- Issue #25 (opened **2026-04-18**) names tools **`update-a-block`** and **`patch-block-children`** with error `body.type should be not present`. These are the hosted Notion MCP / OpenAPI-generated tool names and that API's validation-error style. Our surface uses `update_block` and `append_content` (snake_case), and our `update_block` takes `markdown`/`archived`, never a raw `body.type`.
- **Our server had no block-update tool on 2026-04-18.** `update_block` first shipped via PR #57 (merged 2026-04-30T23:03:32Z) in **v0.6.0** (`git show v0.6.0:src/server.ts` contains `update_block`; first tag containing it). The issue predates our tool by ~12 days. We could not have produced its error.
- Today, `update_block` (`server.ts:1706`) covers exactly the reporter's want: update a paragraph's rich text in one call by ID, type-locked, identity-preserving.

**Draft response (NOT posted — James's voice, no em dashes):**

> Thanks for the detailed report. I think this one was filed against the wrong project. The tool names here (`update-a-block`, `patch-block-children`) and the `body.type should be not present` error are from the official hosted Notion MCP / its OpenAPI tools, not easy-notion-mcp. Our tools are snake_case (`update_block`, `append_content`) and never take a raw `body.type`, and on the date you filed this we did not yet ship a block-update tool at all.
>
> The good news: easy-notion-mcp now has `update_block`, which does exactly what you were after. You pass the block ID plus markdown, and it updates a paragraph's rich text in a single call while preserving the block's identity (deep links and comment threads survive). No delete-and-recreate needed. If you were actually trying to use our server and hit this, let me know your version (`npx easy-notion-mcp --version`) and the exact call and I will dig in. Otherwise this is probably best reported on the hosted Notion MCP repo.

---

## Check 5 — Tool-description contract audit (brief, feeds a later docs pass)

Read `create_page` (`server.ts:1507`), `append_content` (`:1557`), `update_toggle` (`:1666`), `replace_content` (`:1569`). Gaps an agent reading **only the schemas** would hit — these directly explain claims (a)/(b)/(c)/(e):

1. **No path states limits are handled server-side.** None of the four mention 100-block / 2000-char / nesting are auto-handled. An agent reading the schema has no signal it can dump 50KB in one call, so it defends by pre-chunking → claim (a)/(c). *Highest-value fix.*
2. **No affirmative "parsed to native blocks" statement.** `create_page` says "Create a Notion page from markdown. Supports GFM plus Notion extensions for callouts, toggles…" — suggestive but never states markdown is converted to native Notion blocks rather than stored as flat text → claim (b). `append_content` ("same syntax as create_page") inherits the ambiguity.
3. **Conventions table is resource-only.** It lives in `easy-notion://docs/markdown` (each schema points there) but is not inline in any schema. An agent that reads only schemas sees a pointer and must make a second fetch to learn `+++` toggles / callout syntax exist. Reasonable design; still the friction an agent hits.
4. **No mention of return receipts.** Descriptions don't note what comes back. `create_page` returns only `{id, title, url}` (`server.ts:2328`) — **no block count or per-block IDs**, so no cheap fidelity check that 19 toggles landed → claim (e) accurate for `create_page`. `append_content` *does* return `{success, blocks_added: count}` (`:2375`) → claim (e) is wrong for `append_content`. Worth surfacing both in docs.

Keep this for a docs/schema pass, not a fix-now.

---

## Per-claim disposition (agent feedback)

| Claim | Verdict |
|---|---|
| (a) manual chunking around 2000-char/100-block | **STALE** — server handles it since v0.7.0 (2026-05-07). True only on ≤ v0.6.0. |
| (b) unclear if markdown → native blocks or flat text | **Capability fine, docs gap** — it parses to native blocks; no schema affirms it (check 5 #2). |
| (c) no one-shot tree path, ~20 sequential calls | **FALSE** — single `create_page` builds the full 19-toggle tree (check 2). Discoverability gap. |
| (d) no file ingest into existing container | **ACCURATE / real gap** — only `create_page_from_file` takes `file_path`; `append_content`/`update_toggle`/`update_section`/`replace_content` take markdown strings only. Legitimate feature request. |
| (e) no cheap write receipt | **MIXED** — accurate for `create_page` (id/url only); inaccurate for `append_content` (returns `blocks_added`). |

---

## Session chain

- PM (this audit): orchestrator-spawned verification session, branch `dev`.
- Codex: `audit-feedback-claims-coderead` (sessionId `019ebe28-0a2a-7272-afbd-737791ab7bf9`) — checks 1 & 2 systematic code read, 7387 output tokens, single-concern bullet evidence.

All checks read-only. No commits, pushes, GitHub comments, or Notion writes were made. Issue #25 response is a DRAFT only.

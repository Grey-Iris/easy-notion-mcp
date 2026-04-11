# Plan: `update_data_source` tool + `is_inline` on `create_database`

**Date:** 2026-04-10
**Target branch:** `dev` (from `ca9f1c6`)
**Pattern:** 2 (Plan → Human Review → Build)
**Fact sheets:**
- `.meta/research/notion-status-api-verification-2026-04-10.md`
- `.meta/research/easy-notion-mcp-codebase-state-2026-04-10.md`

---

## 1. Summary

Add a new `update_data_source` MCP tool that wraps `client.dataSources.update()` for database schema mutation (status option updates, property renames, title changes, trash toggle), and extend the existing `createDatabase` wrapper to accept `is_inline` on creation. One coherent PR: "extend database mutation surface." No new dependencies, no `package.json` changes, no refactor of the tool registration pattern.

**Note:** This plan was revised after Codex review. See §11 for the key changes. The tool accepts `database_id` (not `data_source_id`) and resolves to the data source internally, to match the vocabulary the rest of the server already teaches agents; it invalidates the schema cache on success; and it rejects empty updates with a clear error.

---

## 2. Scope — in / out

**In (this PR):**
- New `updateDataSource` wrapper in `src/notion-client.ts`. Takes `databaseId` (not `dataSourceId`); resolves via the existing `getDataSourceId` helper at `src/notion-client.ts:47-59`. On success, invalidates the schema cache entry for that `databaseId` (`schemaCache.delete(databaseId)` — see `:39`, `:72`) so the next `get_database` call returns fresh data.
- New `update_data_source` MCP tool registration + handler in `src/server.ts`. Tool accepts `database_id` at the MCP layer, consistent with every other tool in this server.
- New unit test file `tests/update-data-source.test.ts`.
- Extend `createDatabase` wrapper to accept `is_inline` via an optional `options` arg.
- Extend `create_database` tool schema + handler to accept and forward `is_inline`.

No CLAUDE.md edit in this PR. (Earlier draft proposed a one-line "Key decisions" addition; Codex flagged it as feature-inventory churn rather than an architectural decision. Feature docs, if any, can land in a follow-up README PR.)

**Out (explicitly excluded, bias toward exclusion):**
- ❌ **Toggling `is_inline` on existing databases.** The SDK's `dataSources.update()` body params are `archived, title, icon, properties, in_trash, parent` (`api-endpoints.d.ts:3612`). `is_inline` is a *database*-level field and is only reachable via `databases.update()` (`api-endpoints.d.ts:3753`), which this PR does not introduce. Resolved as Option A in §8 (human decision 2026-04-11); committed as a future `update_database` PR (§9).
- ❌ A new `update_database` wrapper / `update_database` tool. **Committed as a separate future PR** (§9), not hypothetical.
- ❌ `create_page_from_file` tool / file-path infrastructure.
- ❌ Refactor of `CreateServerConfig` or the tool registration array.
- ❌ Mode-conditional tool registration (does not exist yet per fact sheet §4; orthogonal concern).
- ❌ Any `package.json` / version / `exports` / `bin` changes. No dependency bumps.
- ❌ A structured/typed helper for building status-option update payloads. The wrapper takes a raw `properties` map. Building a higher-level abstraction is a follow-up once we see how agents actually use it.
- ❌ `icon` and `parent` fields on update. SDK supports them; this PR forwards only `title`, `properties`, `in_trash`. Additional fields are trivially addable later if demand appears.
- ❌ Batch/multi-database operations.
- ❌ Retries / backoff / rate-limit handling beyond whatever the SDK already does.
- ❌ Unrelated fixes noticed in passing (tracked in §9).

---

## 3. Files to modify

| File | Change |
|---|---|
| `src/notion-client.ts` | Add `updateDataSource` export (resolves `databaseId → dataSourceId` via existing `getDataSourceId` at `:47-59`, dispatches `client.dataSources.update()`, on success calls `schemaCache.delete(databaseId)` to invalidate the 5-min schema cache at `:39`). Modify `createDatabase` at `:455-466` to accept optional `options.is_inline`. |
| `src/server.ts` | Add `update_data_source` tool schema to the `tools` array (near the existing `create_database` entry at `:601-624`). Add `update_data_source` handler case in the switch (near `:1109-1123`). Modify the `create_database` tool schema to include `is_inline` in `inputSchema.properties`, and the handler to destructure and forward it. |
| `tests/update-data-source.test.ts` | New file. Unit tests for `updateDataSource` and the extended `createDatabase`, using a mocked client (pattern mirror from `tests/list-databases.test.ts`). |

No changes to `src/index.ts`, `src/http.ts`, `src/markdown-to-blocks.ts`, `src/blocks-to-markdown.ts`, `src/auth/*`, `CLAUDE.md`, or `package.json`.

---

## 4. Proposed TypeScript signatures

### `updateDataSource` (new, in `src/notion-client.ts`)

```ts
import type { UpdateDataSourceParameters } from "@notionhq/client/build/src/api-endpoints";

type PropertiesUpdate = UpdateDataSourceParameters["properties"];

export async function updateDataSource(
  client: Client,
  databaseId: string,
  updates: {
    title?: string;
    properties?: PropertiesUpdate;
    in_trash?: boolean;
  },
) {
  if (
    updates.title === undefined &&
    updates.properties === undefined &&
    updates.in_trash === undefined
  ) {
    throw new Error(
      "updateDataSource: at least one of `title`, `properties`, or `in_trash` must be provided",
    );
  }

  const dataSourceId = await getDataSourceId(client, databaseId);

  const body: Record<string, unknown> = { data_source_id: dataSourceId };
  if (updates.title !== undefined) body.title = titleRichText(updates.title);
  if (updates.properties !== undefined) body.properties = updates.properties;
  if (updates.in_trash !== undefined) body.in_trash = updates.in_trash;

  const result = await client.dataSources.update(body as any);

  // Invalidate the cached schema for this database so the next get_database /
  // buildTextFilter / etc. call sees the updated properties. dataSourceIdCache
  // does NOT need invalidation — the DB → DS mapping itself is unchanged.
  schemaCache.delete(databaseId);

  return result;
}
```

**Design notes:**
- **Takes `databaseId`, not `dataSourceId`.** Every other tool in this server speaks `database_id`, and `get_database` does not expose any data-source ID in its output (`src/notion-client.ts:107-128`). Accepting `dataSourceId` at the tool layer would mean agents cannot actually satisfy the contract after calling `get_database`. Resolving internally via the existing `getDataSourceId` helper (`:47-59`) aligns the tool with the rest of the surface at zero cost.
- **Thin pass-through on `properties`.** Agents supply the raw Notion property-update map keyed by current property name or ID. This shape covers status-option edits, select-option edits, property renames, and deletes (`null`) without a helper layer overfitting.
- **Type source.** `PropertiesUpdate` is derived from the SDK's `UpdateDataSourceParameters["properties"]` rather than `Record<string, unknown>`, so rename, delete-via-null, and typed option shapes are statically checkable.
- `title` takes a plain string for ergonomic parity with `createDatabase`; the wrapper converts via `titleRichText` (already defined at `src/notion-client.ts:35`).
- `in_trash` (not `archived`) — the SDK marks `archived` as `@deprecated` (`api-endpoints.d.ts:3599`).
- `icon`, `parent`, `description` deliberately omitted from the wrapper surface for now (see §2 Out).
- **Empty-update rejection.** If all three fields are `undefined`, throw a clear error *before* issuing the API call. Poor agent ergonomics otherwise (silent no-op the agent then has to debug).
- **Schema cache invalidation on success.** Without this, the 5-minute TTL on `schemaCache` at `:39` will serve stale schemas to `get_database` and `buildTextFilter` for up to five minutes after a successful mutation — making updates look broken.

### `createDatabase` (modified, `src/notion-client.ts:455-466`)

```ts
export async function createDatabase(
  client: Client,
  parentId: string,
  title: string,
  schema: Array<{ name: string; type: string }>,
  options?: { is_inline?: boolean },
) {
  return client.databases.create({
    parent: { type: "page_id", page_id: parentId },
    title: titleRichText(title),
    initial_data_source: { properties: schemaToProperties(schema) },
    ...(options?.is_inline !== undefined ? { is_inline: options.is_inline } : {}),
  } as any);
}
```

**Design notes:**
- `options` is optional; the single existing call site (`src/server.ts:1116`) remains valid unchanged — no backwards-compat shim needed. The handler will be updated to pass `{ is_inline }` through when provided.
- Spreading conditionally on `is_inline !== undefined` avoids sending `undefined` over the wire.
- No separate `createDatabaseWithOptions` overload. Per codebase rule: no backwards-compat hacks.

---

## 5. Tool description — final draft for `update_data_source`

```
CRITICAL — full-list semantics: when you update a select or status property's `options` array, you MUST send the FULL desired list. ANY existing option you omit will be permanently removed from the database, along with any relationship to rows currently using it. To ADD one option, first call get_database, then resend the full current list with your addition appended.

Cannot toggle `is_inline` on existing databases — `is_inline` is a database-level field, not a data-source field. A separate `update_database` tool will be added in a future PR.

Updates a database's schema: rename existing properties, add/update/remove select or status options, change the database title, or move it to/from trash. Use this AFTER get_database tells you the current schema. Pass the same `database_id` you passed to get_database — the server resolves the underlying data source internally.

The `properties` field uses the raw Notion API shape. The server does NO merging, normalization, or validation of property payloads — whatever you send is forwarded as-is. In particular: sending `null` as a property value permanently DELETES that property (and any row data in it).

Status property notes:
- As of Notion's 2026-03-19 changelog, status properties are updatable via API (https://developers.notion.com/page/changelog). The legacy `update-a-database` and `update-property-schema-object` reference pages still claim status is non-updatable — ignore those; the changelog is authoritative.
- Status property GROUPS (default: "To-do" / "In progress" / "Complete") CANNOT be reconfigured via API. Group structure must be edited in the Notion UI. New status options added via API are assigned to the default group and cannot be reassigned programmatically.
- Known upstream issue: Notion's API may return a stale schema where options assigned to the `in_progress` group appear as an empty array, causing validation errors on writes (makenotion/notion-mcp-server#232). If writes to in_progress-group options fail unexpectedly, this is the likely cause.

Property payload examples (raw Notion shape):
- Rename a property:         { "Old Name": { "name": "New Name" } }
- Replace status options:    { "Status": { "status": { "options": [{ "name": "Backlog" }, { "name": "Doing" }, { "name": "Done" }] } } }
- Permanently delete a property and its data: { "Unused": null }

This tool CANNOT update row/page data — use page update tools for that.

At least one of `title`, `properties`, or `in_trash` must be provided; empty updates are rejected.
```

**`inputSchema`:**
- `database_id` (string, required) — same ID accepted by `get_database` / `query_database`. Internally resolved to the primary data source.
- `title` (string, optional) — new database title (plain text).
- `properties` (object, optional) — raw Notion property update map, see examples above.
- `in_trash` (boolean, optional) — true to trash, false to restore.

The handler rejects `{ database_id: "..." }` with no other field set, matching the wrapper's server-side validation. This is a soft guardrail (the MCP client could still construct such a call), so the wrapper enforces it as the source of truth.

---

## 6. Test behavior requirements (folded into implementation requirements)

The implementation must make the following behaviors true. These are not a separate "testing" section — they ARE the requirements. TDD: write the failing test first, watch it fail, implement.

Unit-testable (via mocked client, no network):

1. **`updateDataSource` forwards a raw `properties` map unchanged.** Given a mock client and `updates = { properties: { Status: { status: { options: [{ name: "A" }, { name: "B" }] } } } }`, the wrapper passes the exact `properties` object by reference (or deep-equal) to `client.dataSources.update()`. No mutation, no wrapping, no merging.
2. **`updateDataSource` resolves `databaseId` to `dataSourceId` via `getDataSourceId`.** Given a mock `databases.retrieve` that returns `{ data_sources: [{ id: "ds-123" }] }`, the dispatched body has `data_source_id: "ds-123"` even though the caller passed `databaseId: "db-456"`.
3. **Title is wrapped via `titleRichText` before sending.** Given `updates = { title: "New name" }`, the dispatched body's `title` matches `titleRichText("New name")` — an array of rich-text segments, not a plain string.
4. **`in_trash: true` is forwarded literally; `archived` is never aliased.** The wrapper never sets the deprecated field.
5. **Empty `updates` object throws before any network call.** Calling `updateDataSource(mock, "db-1", {})` throws and `mock.dataSources.update` is NOT invoked. (Codex push-back: previous draft had this as a silent no-op; rejecting is better agent ergonomics.)
6. **Property-delete via `null` is preserved.** `{ properties: { Legacy: null } }` reaches the client with `Legacy: null` intact (not stripped by `undefined`-vs-`null` filtering).
7. **Property-rename via `{ name }` passes through untouched.** `{ properties: { Old: { name: "New" } } }` forwarded verbatim.
8. **Schema cache invalidation on success.** After a successful `updateDataSource(mock, "db-1", ...)` call, a subsequent `getCachedSchema(mock, "db-1")` call triggers a fresh `client.dataSources.retrieve` (verified via mock call count), not a cache hit. Conversely, after a *failed* update (mock rejects), the cache is NOT cleared. Covers the cache-correctness fix from Codex review.
9. **`createDatabase` without `options` still works exactly as before.** Regression: existing call shape `createDatabase(mock, parentId, title, schema)` dispatches a body *without* `is_inline` present (key absent, not `undefined`).
10. **`createDatabase` with `options: { is_inline: true }` forwards the flag.** Body contains `is_inline: true`.
11. **`createDatabase` with `options: { is_inline: false }` forwards the flag.** Body contains `is_inline: false` (explicit `false` not dropped by any truthy check).

Not unit-testable, deferred to §7 runtime evidence:

- **"Omit = remove" semantics for status property options.** This is a Notion-API behavior, not wrapper behavior. Unit tests can only prove we pass the data through faithfully. §7 payload 1 verifies the actual API response.
- **Status group immutability.** Same reason — API-enforced. §7 payload 4 (optional) covers it.

All unit tests use a hand-rolled mock `client` with `dataSources.update`, `dataSources.retrieve`, `databases.retrieve`, and `databases.create` as vitest mock functions, following the pattern in `tests/list-databases.test.ts`. No network calls in unit tests. Note: some tests will need to clear `schemaCache` / `dataSourceIdCache` between runs since they are module-level state — either via an exported `__resetCaches` test-only helper in `notion-client.ts` or by using unique `databaseId` values per test (preferred; no production code added for test scaffolding).

---

## 7. Runtime evidence plan

**Why required:** fact sheet Q3 notes that the "omitted option = removed" rule was only partially verified from docs for status specifically (the verbatim quote was surfaced via WebFetch summarization and could not be double-verified). The builder must probe the real API before the PR is considered complete.

**Pre-reqs:** the test database is created under `NOTION_ROOT_PAGE_ID` (the env var the stdio entry point already reads at `src/index.ts:14-20`; see CLAUDE.md → Environment). Human has authorized this as the sandbox for runtime evidence. The builder uses the existing `NOTION_TOKEN` from `.env` — the same config the server already runs under — no dedicated test token or separate workspace needed. The test database is created fresh for this session via `create_database` and trashed at the end (see cleanup discipline below).

**Cleanup discipline (invariant — runs pass or fail):** Whatever shape the builder uses (shell `trap`, try/finally in a script, explicit "run cleanup first on failure detection"), the invariant is: **the test database is always trashed via `updateDataSource(db, { in_trash: true })` before the session reports back**, whether every payload succeeded or one of them failed mid-run. If payload 1 succeeds and payload 2 fails, cleanup still runs. A leaked test DB under `NOTION_ROOT_PAGE_ID` is noise for the human and breaks idempotency for re-runs. Using the new tool for cleanup is nice dogfooding — it also constitutes implicit evidence that `in_trash: true` forwarding works.

**Evidence payload 1 — status option add + verify omit=remove, preserving IDs and colors:**

Codex flagged that a name-only probe is insufficient: Notion assigns each option an `id` and a `color`. If we send name-only options, we may be testing accidental recreation/reset behavior rather than the omission semantics we care about. Preserve full option metadata from the live response.

1. Create a throwaway database with a `Status` property containing default options. Call `get_database` (or `retrieve` the data source directly) and capture the **full** current status.options array, including every option's `id`, `name`, and `color`.
2. Call `updateDataSource` with the full current options list (preserving `id` + `color` for each) PLUS one new option `{ "name": "Blocked" }`:
   ```json
   {
     "database_id": "<test-db-id>",
     "properties": {
       "Status": {
         "status": {
           "options": [
             { "id": "<existing-id-1>", "name": "Not started", "color": "<color>" },
             { "id": "<existing-id-2>", "name": "In progress", "color": "<color>" },
             { "id": "<existing-id-3>", "name": "Done",        "color": "<color>" },
             { "name": "Blocked" }
           ]
         }
       }
     }
   }
   ```
   Capture the full response body and record the new `id` assigned to `Blocked`.
3. **Add a test row** to the database via `add_database_entry` (or raw API) with `Status: "Blocked"`, so we have a row referencing the option we're about to omit. This tests whether removal succeeds, errors, or silently remaps — Codex specifically flagged this as the real footgun.
4. Call `updateDataSource` a second time with only the three original options (omit `Blocked`, preserving the same `id` + `color` for the three kept options):
   ```json
   {
     "database_id": "<test-db-id>",
     "properties": {
       "Status": {
         "status": {
           "options": [
             { "id": "<existing-id-1>", "name": "Not started", "color": "<color>" },
             { "id": "<existing-id-2>", "name": "In progress", "color": "<color>" },
             { "id": "<existing-id-3>", "name": "Done",        "color": "<color>" }
           ]
         }
       }
     }
   }
   ```
   Capture the full response body AND the state of the test row afterwards (via `read_page` or raw page retrieve).
5. **Expected evidence — three questions to answer, not one:**
   - (a) Does the response in step 4 show three options with `Blocked` absent? → Confirms omit=remove for status, parity with select.
   - (b) What happens to the row that referenced `Blocked`? Does the API reject the update, clear the row's status, or leave a dangling reference? Capture verbatim.
   - (c) Do the IDs and colors of the three kept options remain stable across the second update (vs. being reassigned)? If they change, the tool description needs an additional warning about ID instability.
6. **If any of (a)–(c) contradicts the tool description, stop and revise before merge.** Update the description based on what the API actually does, not what we expected.
7. Cache-invalidation sanity check: immediately after step 4, call `get_database` via the running server (not a direct SDK call) and confirm the returned `properties.Status.options` reflects the post-update state, not the pre-update cached state. Verifies the `schemaCache.delete` call actually works end-to-end.

**Evidence payload 2 — property rename:**

1. Same test database. Call `updateDataSource` with:
   ```json
   { "properties": { "Name": { "name": "Task" } } }
   ```
2. **Expected:** response shows the title property keyed as `Task`.

**Evidence payload 3 — `is_inline: true` on create:**

1. Call `createDatabase` (via the `create_database` tool) with `is_inline: true` under a test parent page.
2. **Expected:** response shows `is_inline: true` and the database renders inline in the parent page when viewed in the UI.
3. Also test with `is_inline: false` and with the flag omitted (should default to whatever Notion's default is — capture both for completeness).

**Evidence payload 4 — group-reconfiguration rejection (optional):**

This one is fuzzy because the update endpoint doesn't accept a `groups` field at all — there's no obvious "invent a group name" payload that maps cleanly to what agents might attempt. Skip unless a natural test case arises. The tool description already warns agents that group reconfiguration is UI-only; runtime verification of that prohibition is lower-value than payloads 1–3.

**What the builder captures in the PR evidence:**
- Raw request body and response body for each step, pasted as a code block in the build session transcript.
- A one-sentence confirmation per payload: "omit=remove confirmed (and row-reference behavior observed: <describe>)" / "rename confirmed" / "is_inline:true confirmed" / "cache invalidation confirmed via get_database post-update".
- The test database is trashed (`in_trash: true` via this new tool, nice dogfooding bonus) after evidence collection.

**Runtime evidence is a gating requirement, not optional.** Per orchestrator policy: "for any project whose value lives in interaction with external systems, runtime evidence is required." Builder should not report completion without payloads 1–3 captured.

---

## 8. Risks and open questions

### Open Question #1 — `is_inline` on existing databases (RESOLVED: Option A, human decision 2026-04-11)

**Resolution:** Option A. Drop `is_inline` toggle on existing databases from this PR; `is_inline` on create stays in. A dedicated `update_database` tool is deferred to a future PR and is now a committed follow-up (see §9), not a hypothetical. Options list below is retained for the future-PR context.

**Background:** The task brief listed "Toggling `is_inline` on existing databases" as a motivator for `update_data_source`, but this is technically infeasible under the proposed design. `is_inline` is a database-level field, reachable only via `client.databases.update()` (`api-endpoints.d.ts:3724-3743`). `client.dataSources.update()`'s body params are `archived, title, icon, properties, in_trash, parent` (`api-endpoints.d.ts:3612`) — no `is_inline`.

Three options, ranked:

**A. (Recommended, reflected above)** Drop "toggle is_inline on existing DB" from this PR. Keep `is_inline` on create only. Flag explicitly in the tool description that `update_data_source` cannot toggle it. Follow up with a small dedicated `update_database` tool in a separate PR if demand appears.

**B.** Bundle an `updateDatabase` wrapper + `update_database` tool alongside `update_data_source` in this PR. Fits "extend database mutation surface" thematically. Costs: +1 tool, +1 wrapper, +1 test file, expanded PR surface. If the human thinks the "one coherent idea" covers both, this is fine — mechanically straightforward.

**C.** Hide the database-level update behind the `update_data_source` tool (take a `data_source_id`, secretly resolve to `database_id`, dispatch to `databases.update` for some fields). **Do not recommend** — conflates two endpoints, confuses agents, and introduces a resolution step that can fail.

**Planner recommendation: A.** Smaller diff, cleaner idea per PR, no surprise semantics. **Adopted.** Future `update_database` PR will add an `updateDatabase(client, databaseId, { is_inline?, title?, ... })` wrapper in the same style and a parallel `update_database` tool; the shape of that PR will mirror this one but against `databases.update()`.

### Open Question #2 — Parameter shape: raw pass-through (resolved)

The `updates.properties` field is a raw pass-through typed as `UpdateDataSourceParameters["properties"]` (the SDK's own type). Agents construct the Notion-shaped update map themselves, guided by the tool description. An earlier draft used `Record<string, unknown>`; Codex recommended using the SDK type instead, which is strictly better — rename, delete-via-null, and typed option shapes are statically checkable without adding a helper layer.

**Resolution:** raw pass-through with the SDK type. A structured helper (`renames`, `deletes`, `statusOptions`, ...) was considered and rejected — it would overfit the common cases, hide colors/IDs/descriptions, and need extending every time we discover a new property type. Revisit if usage data shows agents consistently reinventing the same payload shapes.

### Risk — stale Notion docs confuse agents

The `update-a-database` and `update-property-schema-object` reference pages still say status is non-updatable (fact sheet Q2). Agents that read those pages mid-task will think our tool is broken. Mitigation: the tool description links the changelog directly and explicitly disavows the stale pages. Long-term: consider a README entry pointing at the same thing.

### Risk — upstream `in_progress` group schema bug (notion-mcp-server#232)

Notion's API may return a stale schema for the `in_progress` group, causing writes to fail. easy-notion-mcp will inherit the bug. Mitigation: tool description calls it out as a known issue so agents know where to look when writes fail inexplicably. We do not attempt a workaround — it's upstream.

### Risk — the "omit = remove" rule is destructive and irreversible

An agent that updates a single option without reading the full current list first will delete every other option. The tool description is our only guard. The description must open with this warning and the word "CRITICAL" is earned here.

### Risk — row data referencing a removed status option

Codex flagged: if an agent removes a status option that existing rows reference, what happens? The Notion API will either (a) reject the update, (b) clear the affected cells, or (c) leave dangling references. We don't know which without runtime evidence — hence the row-reference step in §7 payload 1. Whatever the answer is, the tool description may need an additional warning. Blocking question for the builder: capture this behavior and update the description accordingly.

### Builder note — property rename verification could be tightened (optional)

§7 payload 2 verifies a rename by checking the response body shows the new property key. A sharper verification, if naturally available during the run: after renaming (say) `Status → WorkflowState`, call `query_database` with a filter targeting the old name and confirm it errors or returns empty, then query with the new name and confirm it works. **Not a requirement** — the minimal response-body check is sufficient for this PR. Flag this as "tighten if natural" during evidence collection; if it falls out cheaply, capture it; otherwise ship with the simpler check.

### Builder note — status option `description` field edge case (untested)

Notion status options can carry an optional `description` string. When the agent issues a partial-update with `{ id, name, color }` but no `description`, it is unclear whether Notion preserves the existing description or nulls it out. §7 runtime evidence does not currently test for this. **Not a blocker**: during payload 1 step 1 (when capturing the current options), if the builder notices any existing option has a `description` set, extend the probe to observe whether it survives the round trip. If none of the default options have descriptions, skip — not worth synthesizing a test case. This is a "capture if you see it" flag, not a new required step.

### Risk — option ID stability on partial updates

Codex also flagged: if we don't send `id` fields on kept options, the API may reassign IDs. That would silently break anything downstream that caches option IDs (including our own schema cache if it stored them). §7 payload 1 step 5(c) explicitly verifies ID stability when IDs ARE preserved in the payload. If they're unstable even with IDs preserved, the tool description needs a warning and the runbook for option add becomes "always preserve id + color".

### Risk — `titleRichText` covers only plain text

`titleRichText` (defined in `src/notion-client.ts`, already used by `createDatabase`) produces a single plain-text rich-text segment. Agents that want styled/linked titles cannot express that through this tool. Acceptable — mirrors existing `createDatabase` limitation.

---

## 9. Out of scope / follow-ups

Things noticed in passing, explicitly excluded from this PR, captured for future consideration:

- **`update_database` tool (committed future PR, not hypothetical).** Resolves Open Q #1's deferred surface area: wraps `client.databases.update()` so agents can toggle `is_inline` on existing databases (and later, `is_locked`, `description`, `icon`, `cover`). Same shape as this PR — thin wrapper in `notion-client.ts`, tool registration in `server.ts`, sibling test file, runtime evidence against a throwaway DB under `NOTION_ROOT_PAGE_ID`. Not bundled here to keep "one coherent idea per PR."
- **`icon` / `cover` / `parent` / `description` on update** — the SDK supports them on both `dataSources.update` and `databases.update`. Trivial to add when demand appears.
- **Structured helper for common update shapes** — see Open Q #2. Wait for usage data.
- **Content prefix / markdown abstraction for DB title changes** — not needed; title is plain text.
- **README section documenting database schema mutation** — CLAUDE.md touch-up is sufficient for this PR; README entry can follow in a docs PR.
- **Schema cache invalidation on update** — CLAUDE.md mentions a 5-minute schema cache (`src/notion-client.ts`). After `update_data_source` mutates a schema, cached entries will be stale for up to 5 min. Not critical (agents can re-read) but worth noting. Consider a cache-invalidation call inside `updateDataSource` in a follow-up.
- **Any unrelated fixes noticed** — none spotted during planning.

---

## 10. PR body draft

**Title:** `feat: add update_data_source tool and is_inline on create_database`

**Body:**
```markdown
## Summary

- Adds `update_data_source` MCP tool, wrapping `client.dataSources.update()` for database schema mutation: rename properties, update select/status options, change title, trash a data source.
- Extends `create_database` to accept `is_inline` on creation (newly exposed on the existing `createDatabase` wrapper as an optional `options` arg).
- One coherent idea: extending the database mutation surface. No unrelated changes, no dependency bumps, no version bump.

## Why

- Notion officially added API support for creating and updating status properties on 2026-03-19 ([changelog](https://developers.notion.com/page/changelog)). Until now, agents using this server couldn't evolve a database's status options programmatically.
- Property rename and option add/remove are the natural next step once `create_database` exists — without them, schemas are effectively write-once.
- `is_inline` on create is a long-standing gap; adding it alongside is cheap and thematically aligned.

## Notes on status-property semantics

- The tool description carries explicit warnings about the "omitted option = removed" rule for select/status and the immutability of status groups via API.
- The description links the March 19 changelog directly and notes that two legacy reference pages (`update-a-database`, `update-property-schema-object`) still incorrectly claim status is non-updatable.
- Known upstream issue `makenotion/notion-mcp-server#232` (stale `in_progress` group schema) is called out as a known cause of unexplained validation failures.

## Scope explicitly excluded

- No `update_database` tool (toggling `is_inline` on existing databases would require `client.databases.update()`, a separate endpoint — deferred).
- No refactor of tool registration / `CreateServerConfig`.
- No new dependencies, no `package.json` changes.

## Test plan

- [ ] `npm run build` passes (tsc clean)
- [ ] `npm test` passes — new `tests/update-data-source.test.ts` covers: pass-through of raw `properties` map, title wrapping, `in_trash` forwarding, property-delete via `null`, property-rename via `{ name }`, `createDatabase` without `options` unchanged, `createDatabase` with `is_inline: true` / `false` forwarded
- [ ] Runtime evidence against a throwaway Notion test database:
  - [ ] Add a status option, then omit it on a second call — confirmed removed (verifies the warning in the tool description)
  - [ ] Rename a property — confirmed
  - [ ] Create a database with `is_inline: true` — confirmed
- [ ] CI green on Node 18 + 20
```

---

## 11. Codex review notes

**Review session:** `plan-review-update-data-source-2026-04-10` (codex, reasoningEffort: high)

Codex's review was sharp and I accepted essentially all of it — nothing was overruled. The plan now diverges substantially from the first draft. Key changes:

1. **Identifier contract fixed (Codex: HIGH).** First draft had the tool accepting `data_source_id` at the MCP layer with a note telling agents to "call `get_database` first". Codex pointed out that `get_database` does NOT expose any data-source ID in its output (`src/notion-client.ts:107-128` only returns `id`, `title`, `url`, simplified `properties`), so agents literally cannot satisfy the contract as originally written. **Fix:** tool accepts `database_id`; the wrapper resolves internally via the existing `getDataSourceId` helper at `:47-59`. Now consistent with every other tool in the server.

2. **Schema cache invalidation moved from follow-up → required (Codex: HIGH).** First draft listed cache invalidation under "Out of scope / follow-ups" with a note that the 5-min TTL was "not critical." Codex correctly flagged this as a correctness issue, not a nicety: without invalidation, a successful update followed by `get_database` returns stale data for up to 5 minutes, making the update *look broken*. **Fix:** `updateDataSource` now calls `schemaCache.delete(databaseId)` on success (and only on success). Added as a unit-test requirement (§6.8) and runtime evidence check (§7.7).

3. **Empty-update rejection instead of silent no-op (Codex: MEDIUM-HIGH).** First draft documented that `{ data_source_id }` with no other fields would dispatch as a no-op "surfacing API behavior." Codex pointed out this is just bad ergonomics. **Fix:** wrapper throws a clear error before issuing any call. Unit test requirement updated.

4. **Runtime evidence hardened for IDs, colors, and row references (Codex: MEDIUM-HIGH).** First draft used name-only payloads, which Codex correctly flagged as not proving the actual agent path — could have been testing recreation rather than omission. **Fix:** §7 payload 1 now (a) captures existing option ids + colors before the first update, (b) preserves them across both updates, (c) adds a test row referencing the option slated for removal to observe the real footgun behavior, and (d) asks three distinct questions (omit=remove, row behavior, ID stability) rather than one.

5. **Unit test requirements cleaned up (Codex: MEDIUM).** Old requirement 2 ("omitting a key means untouched") was testing Notion API semantics via unit tests, which is not possible. Old requirement 11 ("group reconfiguration rejection") was vague because there's no clean payload to test. **Fix:** pass-through/no-merge kept as unit; API-semantics tests moved explicitly to §7 runtime evidence.

6. **Tool description reordered (Codex: MEDIUM).** First draft buried the CRITICAL warning in paragraph two. **Fix:** CRITICAL warning is now sentence one. Added explicit "server does no merging/normalization/validation" and a `null`-delete warning. Deletion example is now clearly labeled "permanently deletes."

7. **Wrapper type uses SDK shape (Codex: MEDIUM).** First draft used `Record<string, unknown>`. **Fix:** `PropertiesUpdate = UpdateDataSourceParameters["properties"]` from `@notionhq/client`, so rename/delete/option shapes are statically checkable.

8. **CLAUDE.md edit dropped (Codex: LOW).** First draft added a "Key decisions" line item. Codex pointed out this is feature inventory, not architecture. **Fix:** CLAUDE.md removed from the file list.

**Agreements without disagreement:**
- Raw pass-through on `properties` (not a structured helper). Codex agreed.
- Open Question #1: drop `is_inline` toggle on existing DBs from this PR; do NOT bundle an `update_database` tool. Codex agreed with option A, explicitly citing that "one coherent idea" is not a good enough reason to mix database-level and data-source-level mutations when the rest of the server speaks `database_id`.

**No overrules.** I considered pushing back on nothing — Codex's review was grounded in actual file reads and the points stood on their own. The plan is materially stronger as a result.

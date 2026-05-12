---
plan: datasource-id-error-message
date: 2026-05-12
ticket: fix-database-tools-data-source-id-error
scope: TDD-first bug fix plan only
---

# Data Source ID Error Message Plan

## Goal

Fix the misleading database-tool error when a user passes a Notion `data_source` ID where this server expects a database container ID. The current `getDataSourceId` chokepoint calls `client.databases.retrieve({ database_id })`; if the ID is actually a `data_source`, Notion returns `object_not_found`, and `enhanceError` tells the user to share the database with the integration. That hint is wrong for the layer-mismatch case.

This plan implements the audit's required shape without changing tool contracts and without silently accepting the wrong ID.

## Context Read

- `CLAUDE.md`: project is markdown-first, Notion SDK is `@notionhq/client` v5.20.x, schema/data-source ID caching is an explicit local pattern.
- Tasuku ticket `fix-database-tools-data-source-id-error`: ready, tagged `bug`, `dx`, `notion-api`; matches the audit recommendation.
- Audit `.meta/audits/user-reported-readme-and-datasource-2026-05-12.md`: Q2 is the load-bearing reference; all database-side tools funnel through `getDataSourceId`.
- Installed SDK type check:
  - `node_modules/@notionhq/client/build/src/api-endpoints/data-sources.d.ts` defines `GetDataSourceResponse = PartialDataSourceObjectResponse | DataSourceObjectResponse`.
  - A full `DataSourceObjectResponse` has `parent: ParentOfDataSourceResponse`.
  - `ParentOfDataSourceResponse` is either `DatabaseParentResponse` or `DataSourceParentResponse`.
  - `DatabaseParentResponse` is `{ type: "database_id"; database_id: IdResponse }`.
  - `DataSourceParentResponse` is `{ type: "data_source_id"; data_source_id: IdResponse; database_id: IdResponse }`.
  - Therefore `response.parent?.database_id` is extractable on full responses, but implementation should tolerate partial responses and omit the parent ID if unavailable.

## Decision

Implement the fix in `src/notion-client.ts` inside private `getDataSourceId`.

Chosen behavior:

1. Preserve the happy path: database container ID resolves to the first `db.data_sources[0].id` and caches that mapping.
2. On `object_not_found` from `client.databases.retrieve`, probe `client.dataSources.retrieve({ data_source_id: dbId })` exactly once.
3. If the probe succeeds, throw a plain layer-mismatch `Error` whose message includes:
   - the word `data_source`,
   - a pointer to `list_databases`,
   - the parent database ID when `probe.parent?.database_id` is a string.
4. If the probe also fails, rethrow the original `object_not_found` from `databases.retrieve` unchanged so `enhanceError` keeps adding the existing shared-with-integration hint.
5. Do not auto-resolve a data-source ID to its parent database ID.
6. Do not cache failures or layer-mismatch errors.

Rejected approaches:

- Do not patch `enhanceError` with a generic data-source hint. That would make every genuine not-found database error vaguer and still would not distinguish the real layer mismatch.
- Do not silently accept a `data_source` ID. The tools document `database_id`, `list_databases` returns database container IDs, and auto-resolution would hide an important 2026-03-11 API distinction.
- Do not export `getDataSourceId` just for tests. Test through `getCachedSchema`, which is exported and already exercises the private chokepoint.

No new Tasuku architectural decision is required; this is a narrow bug fix implementing an existing audit recommendation rather than establishing a new product or architecture direction.

## TDD Plan

Add a focused test file first:

- `tests/notion-client-data-source-id-error.test.ts`

Use `getCachedSchema(client as any, id)` to exercise `getDataSourceId` without exporting the private helper. Use unique IDs per test to avoid the module-scope `schemaCache` and `dataSourceIdCache` crossing test boundaries.

Write these tests before implementation:

1. `getCachedSchema resolves normally for a database container ID`
   - Mock `client.databases.retrieve` to resolve `{ id: "db-happy", data_sources: [{ id: "ds-happy" }] }`.
   - Mock `client.dataSources.retrieve` to resolve `{ id: "ds-happy", properties: { Name: { type: "title" } } }`.
   - Assert returned schema is the data-source response.
   - Assert `databases.retrieve` receives `{ database_id: "db-happy" }`.
   - Assert `dataSources.retrieve` receives `{ data_source_id: "ds-happy" }`.
   - Assert no fallback probe of the caller-provided database ID occurs.

2. `getCachedSchema rejects a data_source ID with layer-mismatch guidance and parent database ID`
   - Mock `client.databases.retrieve` to reject with an `object_not_found` error object carrying both `code` and `body.code`.
   - Mock fallback `client.dataSources.retrieve` to resolve `{ object: "data_source", id: "ds-wrong", parent: { type: "database_id", database_id: "db-parent" }, properties: {} }`.
   - Assert rejection message contains `data_source`, `list_databases`, and `db-parent`.
   - Assert the message does not contain `Make sure the page/database is shared with your Notion integration`, because this is not the downstream enhanced not-found path.

3. `getCachedSchema preserves original object_not_found when neither database nor data source exists`
   - Create a specific original error object for `databases.retrieve`, for example `original.code = "object_not_found"; original.body = { code: "object_not_found", message: "Could not find database" }`.
   - Mock `client.databases.retrieve` to reject with `original`.
   - Mock fallback `client.dataSources.retrieve` to reject with a different `object_not_found` error.
   - Assert `await expect(...).rejects.toBe(original)` so the original error identity survives unchanged.
   - This preserves the `enhanceError` path in `src/server.ts`.

4. `getCachedSchema does not cache layer-mismatch failures and allows a later successful resolution`
   - First call with `"ds-cache-mismatch"`:
     - `databases.retrieve` rejects `object_not_found`.
     - fallback `dataSources.retrieve` resolves as a data source with parent `"db-cache-parent"`.
     - assert layer-mismatch rejection.
   - Then call with `"db-cache-parent"` on the same mock client:
     - `databases.retrieve` resolves `{ id: "db-cache-parent", data_sources: [{ id: "ds-cache-good" }] }`.
     - `dataSources.retrieve` resolves schema for `"ds-cache-good"`.
     - assert success.
   - Also assert no cached bad mapping was used: `dataSources.retrieve` should be called once for the mismatch probe with `{ data_source_id: "ds-cache-mismatch" }` and once for schema retrieval with `{ data_source_id: "ds-cache-good" }`.

Test fixture check:

- Existing tests do not module-mock `client.databases.retrieve` globally in a way that conflicts with this focused file.
- Existing Notion mock factories often define `dataSources.retrieve`; `tests/views-tools.test.ts` does not, but its current `create_view` tests keep `databases.retrieve` on the happy path, so the new fallback will not run there.
- If a future server-level test intentionally forces `databases.retrieve` to `object_not_found` through a database-side tool, its mock must include `dataSources.retrieve`; no current fixture update is required for this bug fix.

Expected first run:

- Run `npx vitest run tests/notion-client-data-source-id-error.test.ts`.
- The new file should fail before implementation on tests 2 and 3 because no fallback/probe branch exists. Depending on exact helper code, test 4 may also fail by surfacing the old object-not-found.

## Implementation Plan

Touch only:

- `src/notion-client.ts`
- `tests/notion-client-data-source-id-error.test.ts`

Do not change `src/server.ts`; the correct preservation behavior is to let plain layer-mismatch errors bypass the `object_not_found` enhancement, and to let genuine not-found errors continue into the existing `enhanceError` branch.

Suggested implementation details:

- Add a tiny local predicate near `getDataSourceId`:
  - `const code = (error as any)?.body?.code ?? (error as any)?.code`
  - return `code === "object_not_found"`.
- Wrap only the `client.databases.retrieve({ database_id: dbId })` call in `try/catch`.
- In the catch:
  - if not `object_not_found`, rethrow immediately.
  - save the original error.
  - attempt `client.dataSources.retrieve({ data_source_id: dbId })`.
  - if that succeeds, inspect `(probe as any).parent?.database_id`.
  - throw a new plain `Error` with wording similar to:
    - `ID ${dbId} is a data_source ID, not a database container ID. Pass the parent database ID${parentId ? ` (${parentId})` : ""}; use list_databases to find database container IDs.`
  - if the probe fails, rethrow the original error, not the probe error.
- Keep the existing cache write exactly after a successful database-container resolution. Do not cache anything in the catch branch.

## Verification

After implementation:

1. `npx vitest run tests/notion-client-data-source-id-error.test.ts`
2. `npx vitest run tests/update-data-source.test.ts tests/views-tools.test.ts tests/query-database-pagination.test.ts`
3. `npm run build`
4. Prefer `npm test` if builder time allows, because `getDataSourceId` is a shared chokepoint for database reads, writes, and view creation.

No live Notion E2E is required for this patch. The behavior is deterministic SDK error routing and the SDK response parent shape is covered by local installed types plus the mock contract.

## Runtime Premises

1. `client.databases.retrieve({ database_id: dataSourceId })` returns/rejects with `object_not_found` when a data-source ID is passed.
   - Build test: the data-source mismatch test mocks this exact SDK failure shape and fails if the implementation does not branch only on `object_not_found`.

2. `client.dataSources.retrieve({ data_source_id })` succeeds for a valid data-source ID and, on full responses, exposes `parent.database_id`.
   - Evidence: installed `@notionhq/client` v5.20.0 types show `DataSourceObjectResponse.parent` includes `DatabaseParentResponse | DataSourceParentResponse`; both include `database_id`.
   - Build test: the mismatch test asserts the extracted parent database ID appears in the thrown message.

3. Partial data-source retrieve responses may not include `parent`.
   - Mitigation: implementation treats parent extraction as optional and still throws a useful `data_source` / `list_databases` error without the ID.
   - Optional builder add-on if desired: one extra assertion inside test 2 or a fifth tiny test for missing parent, but not required by the ticket.

4. Existing downstream `enhanceError` behavior depends on preserving the original `object_not_found` code for genuinely missing IDs.
   - Build test: original-error identity assertion in test 3.

## Risk Register

1. Over-broad probe masks non-not-found database errors.
   - Mitigation: only probe on `body.code` or `code` equal to `object_not_found`; rethrow validation, rate limit, auth, and restricted-resource errors unchanged.

2. Mocked SDK shape drifts from live SDK behavior.
   - Mitigation: ground the test fixture in installed `@notionhq/client` v5.20.0 types and keep parent ID extraction optional.

3. Failure result accidentally enters `dataSourceIdCache` or `schemaCache`.
   - Mitigation: cache only after a successful database-container retrieval and add the explicit cache failure test.

4. Probe error replaces the original not-found error for totally unknown IDs.
   - Mitigation: save the original `databases.retrieve` error and assert `rejects.toBe(original)`.

5. Error message is technically correct but still unclear to users.
   - Mitigation: require concrete words in tests: `data_source`, `list_databases`, and parent database ID when available.

## Cost And Complexity

- Paid services: none.
- Added Notion API traffic: one `dataSources.retrieve` call only on the failure path where `databases.retrieve` returned `object_not_found`.
- Builder estimate: 45-60 minutes including tests-first failure, implementation, focused regression tests, and build.
- Blast radius: low, but the helper is shared by `get_database`, `query_database`, `add_database_entry`, `add_database_entries`, `update_data_source`, relation schema resolution, and `create_view`.

## Open Questions

None requiring human input.

Implementation detail left to the builder: exact helper names and exact final wording, provided the tests enforce the required user-facing anchors.

## Review Note

Codex pressure-test session: skipped by instruction because this planning session is already Codex and the task explicitly disallows self-dispatch. This plan substitutes the risk register above.

Research agent sessions: none. Research was local and direct against `CLAUDE.md`, the Tasuku ticket, the audit, source files, tests, and installed SDK type files.

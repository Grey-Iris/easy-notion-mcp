# Pass 3 Scratch

Scope: independent pre-v0.3.0 audit of non-atomic mutation sequences in `easy-notion-mcp`.

Primary candidates with grounded paths:

- `replace_content`
  - `src/server.ts:1016-1027`
  - Lists children, deletes each block one-by-one, then appends new blocks.
  - New blocks may also depend on prior file uploads via `processFileUploads`.
  - `appendBlocks` is chunked in 100-block requests: `src/notion-client.ts:315-327`.

- `update_section`
  - `src/server.ts:1029-1080`
  - Lists children, computes section bounds, deletes targeted blocks one-by-one, then appends replacement blocks after the previous sibling.
  - Append is chunked and can partially succeed: `src/notion-client.ts:330-352`.

- `append_content`
  - `src/server.ts:1010-1015`
  - No delete-before-append, but uploads happen before append and append is chunked.
  - Partial append possible on later chunk failure.

- `file://` uploads
  - `src/file-upload.ts:59-91`
  - Uploads all referenced files first with `Promise.all`.
  - `uploadFile` itself is two network calls: create upload, then send bytes: `src/notion-client.ts:79-108`.
  - Later page/block write can fail, leaving orphaned uploads.
  - `update_page` cover upload path: `src/server.ts:1176-1192`.

- `add_database_entries`
  - `src/server.ts:1328-1351`
  - Explicit best-effort loop, returns `succeeded` and `failed`.
  - Each entry write is a separate `pages.create`: `src/notion-client.ts:554-566`.

- Database single-call updates checked
  - `update_database_entry`: `src/server.ts:1353-1360`, `src/notion-client.ts:568-591`
  - `update_data_source`: `src/server.ts:1263-1285`, `src/notion-client.ts:473-502`
  - No local clear-then-set sequence; one Notion update request after reads/conversion.

- Multi-page ops checked
  - `move_page`: single `pages.move` call, `src/notion-client.ts:421-426`
  - `duplicate_page`: read source + create new page, `src/server.ts:1146-1174`
  - No destructive mutation to source page in code.

- OAuth token issuance / refresh
  - Auth code exchange stores access token record, then refresh token record separately:
    `src/auth/oauth-provider.ts:271-328`
  - Refresh flow may rewrite refresh-token record, then write new access-token record:
    `src/auth/oauth-provider.ts:333-410`
  - Token store load-modify-save rewrites whole encrypted file in place:
    `src/auth/token-store.ts:62-88`
  - `save()` uses direct `writeFile`; `load()` swallows decrypt/parse errors and returns `[]`.

- Cache invalidation / schema consistency checked
  - `getCachedSchema`: sets cache only after successful retrieve, `src/notion-client.ts:68-76`
  - `updateDataSource`: invalidates cache only after successful update, `src/notion-client.ts:499-500`
  - Did not find a half-populated schema write path in this pass.

Failure-oriented test coverage observed:

- `tests/update-section.test.ts` covers section boundary math only, not deletion/append failure paths.
- `tests/update-data-source.test.ts:160-206` covers cache invalidation on success/failure.
- `tests/file-upload.test.ts` covers URL detection/rewrite only, not block-write failure after upload.
- `tests/token-store.test.ts` covers happy-path persistence only, not interrupted/corrupt writes.

# Audit: URL-as-ID error behavior

Date: 2026-04-09
Scope: empirical reproduction of errors emitted when Notion URLs (or other non-UUID strings) are passed where the SDK expects a page/database/block ID.
Entry points tested: (a) raw `@notionhq/client` `pages.retrieve`, (b) `notion-client.ts` `getPage` wrapper. The MCP tool layer (`mcp__easy-notion__read_page`) was not invocable in this session (no `mcp__easy-notion__*` tool registered), but `read_page` is a verbatim passthrough to `getPage` — `src/server.ts:972` calls `await getPage(notion, page_id)` with no validation or translation, and `src/notion-client.ts:374` is literally `return client.pages.retrieve({ page_id: pageId });`. The tool layer therefore emits whatever the raw SDK emits; the audit table reflects both wrapper and tool layer.

Happy-path baseline page: `327be876242f817f9129ff1a5a624814` ("✨ easy-notion-mcp", resolved via `search`).

## Summary

All four URL variants (slug, no-slug, `?v=` query, workspace-prefixed) produce a completely opaque `invalid_request_url` / HTTP 400 / `"Invalid request URL."` — the error does **not** mention `page_id`, does **not** hint that a URL was supplied, and does **not** name the offending parameter. An LLM agent receiving this response has no signal to correct itself. The wrapper is a pure passthrough: errors on column (b) are byte-identical to column (a) modulo `request_id`. The garbage-string variant gets a *better* error than any URL variant, because it reaches path validation instead of failing earlier at URL routing.

## Evidence table

| # | Input variant | Raw SDK (a) | `notion-client.ts` wrapper (b) |
|---|---|---|---|
| 1 | `327be876242f817f9129ff1a5a624814` (bare hex, happy) | **OK** | **OK** |
| 2 | `327be876-242f-817f-9129-ff1a5a624814` (dashed UUID) | **OK** | **OK** |
| 3 | `https://www.notion.so/easy-notion-mcp-327be876242f817f9129ff1a5a624814` (URL+slug) | 400 `invalid_request_url` / `"Invalid request URL."` | 400 `invalid_request_url` / `"Invalid request URL."` |
| 4 | `https://www.notion.so/327be876242f817f9129ff1a5a624814` (URL no slug) | 400 `invalid_request_url` / `"Invalid request URL."` | 400 `invalid_request_url` / `"Invalid request URL."` |
| 5 | `https://www.notion.so/DatabaseName-327be876242f817f9129ff1a5a624814?v=2a89…` (URL + view query) | 400 `invalid_request_url` / `"Invalid request URL."` | 400 `invalid_request_url` / `"Invalid request URL."` |
| 6 | `https://www.notion.so/myworkspace/327be876242f817f9129ff1a5a624814` (workspace URL) | 400 `invalid_request_url` / `"Invalid request URL."` | 400 `invalid_request_url` / `"Invalid request URL."` |
| 7 | `not-a-real-id` (garbage) | 400 `validation_error` / `"path failed validation: path.page_id should be a valid uuid, instead was \"not-a-real-id\"."` | same as (a) |
| 8 | `""` (empty string) | 400 `invalid_request_url` / `"Invalid request URL."` | same as (a) |
| 9 | `deadbeefdeadbeefdeadbeefdeadbeef` (valid shape, unknown) | 404 `object_not_found` / `"Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration \"Iris\"."` | same as (a) |

## Full raw errors (one per error class)

**Class A — `invalid_request_url` (variants 3–6, 8):**

```json
{
  "object": "error",
  "status": 400,
  "code": "invalid_request_url",
  "message": "Invalid request URL.",
  "request_id": "293af7cc-f666-474d-bfc3-f1f8cf6ae5e6"
}
```
Thrown as `APIResponseError { name: "APIResponseError", code: "invalid_request_url", status: 400, message: "Invalid request URL." }`. No `additional_data`, no parameter name.

**Class B — `validation_error` (variant 7, `"not-a-real-id"`):**

```json
{
  "object": "error",
  "status": 400,
  "code": "validation_error",
  "message": "path failed validation: path.page_id should be a valid uuid, instead was `\"not-a-real-id\"`.",
  "request_id": "2757be85-0342-4314-9a84-69b53e98e4c2"
}
```

**Class C — `object_not_found` (variant 9, fresh random UUID):**

```json
{
  "object": "error",
  "status": 404,
  "code": "object_not_found",
  "message": "Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration \"Iris\".",
  "additional_data": { "integration_id": "320be876-242f-8131-8f63-0027e8b63e24" },
  "request_id": "d12d8d64-075a-4904-bee0-092a82e05702"
}
```

Side note: the SDK auto-dashes `deadbeef…` to `deadbeef-dead-beef-dead-beefdeadbeef` before sending, which is why variant 9 reaches the 404 path rather than failing validation. This confirms the SDK will accept a 32-char hex happy path and UUIDs with or without dashes — but will not accept anything containing `/`, `:`, or query strings.

## The three questions

**1. Which variants produce clean, actionable errors?**

- **Clean/actionable:** variant 7 (`not-a-real-id`) — names the parameter (`path.page_id`), quotes the bad value, and says what was expected (`valid uuid`). Variant 9 (valid-shape unknown UUID) — names the ID and gives a plausible hypothesis (not shared). A human or LLM can act on both.
- **Opaque:** every URL variant (3–6) and the empty-string variant (8). `"Invalid request URL."` is the transport-layer error thrown by the SDK's HTTP router because characters like `/` in `page_id` corrupt the request path (`/v1/pages/https://...`). The error does not mention `page_id`, does not quote the input, does not say "URL detected" or "expected UUID." An LLM caller will not be able to self-correct — it looks like a bug in the SDK, not a user-input problem.

**2. Does the error change between raw SDK and MCP layer?**

No. The wrapper and tool layer are byte-identical passthroughs:
- `src/notion-client.ts:374` — `getPage` is one line: `return client.pages.retrieve({ page_id: pageId });`
- `src/server.ts:972` — the `read_page` tool handler calls `await getPage(notion, page_id)` with no validation, no try/catch, no error translation. Whatever the SDK throws surfaces to the MCP caller verbatim.

This means the project currently has **zero URL normalization and zero error translation** at any layer. Adding either at the MCP boundary (a thin `normalizePageId()` helper applied in each tool handler, or higher up in argument parsing) is a clean, contained change — there is no existing translation logic to reconcile with.

**3. Catastrophically misleading errors?**

Yes — variants 3–6 (every URL shape). The SDK returns `invalid_request_url` with message `"Invalid request URL."`, which reads as "the SDK failed to construct a valid HTTP request" (an internal/network problem) rather than "you pasted a URL where an ID was expected." A caller's natural recovery path is to retry, check network, or file a bug — not to reformat the input. The README's `.env.example` prompts users to fill in `NOTION_ROOT_PAGE_ID=your_default_parent_page_id_here`; the path from the browser URL bar (which is all most users ever see) to this opaque 400 is a failure mode waiting to happen.

Variant 9 is **mildly** misleading in the opposite direction: a correctly-shaped-but-wrong UUID returns `object_not_found` with a suggestion to share the page with the integration. If the user's UUID is actually wrong (typo, wrong page), they'll waste time in the Notion sharing UI before realizing the ID itself is at fault. This is a pre-existing Notion API behavior, not fixable at our layer, but worth noting: the error message encourages sharing-checks over ID-checks.

## Recommendation direction (not a spec)

- **Normalize at the MCP boundary.** Accept any of: bare 32-char hex, dashed UUID, or `notion.so` URL (any variant). Extract the last 32-hex-char run from the path segment, ignore `?v=...`, ignore slug prefix, ignore workspace prefix. Apply this to every tool argument that becomes a `page_id` / `database_id` / `block_id` / `parent_page_id`, and also to `NOTION_ROOT_PAGE_ID` at startup.
- **Translate the residual errors.** After normalization, anything that still fails is either: malformed (translate to "expected a Notion page ID or URL, got X"), not found (pass through — the SDK message is good), or unauthorized (pass through). The `"Invalid request URL."` class should become unreachable from tool arguments once normalization lands.
- **Test the boundary.** Unit tests on `normalizePageId()` covering all 9 variants in this audit + a few malicious inputs (path traversal, very long strings, non-ASCII).

## Session chain

- Audit PM session: `audit-url-as-id-errors`
- Codex sessions: **none** — Codex was not available in this environment. The audit was empirical (script execution + error capture), not code-reading, so the PM-vs-Codex separation did not apply. Code-reading portions (confirming the wrapper is a passthrough) were done by direct `Read`/`Grep` on `src/notion-client.ts` and `src/server.ts`.

## Artifacts (not committed)

- `/tmp/audit-url-as-id.mjs` — the audit script
- `/tmp/audit-url-as-id.out` — full raw output including request IDs

The worktree's `dist/` directory was populated by `npx tsc` to allow importing the compiled wrapper; this is gitignored and not a repo change.

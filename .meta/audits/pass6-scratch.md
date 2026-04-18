# Pass 6: Test Proportionality Audit

Scope: `src/` vs `tests/` in the current workspace. Counts are approximate. "Test count" means tests that directly import the module or exercise it through a nearby integration path; I call out when that coverage is indirect. I did not count `tests/list-databases.test.ts`, `tests/relation-property.test.ts`, or `tests/update-section.test.ts` as real source coverage for the corresponding production modules because they test local copies of logic instead of the source.

## 1. Module-by-module coverage table

| File | LOC | Exports | Test file(s) | Test count | Edge ratio | Blast radius | Coverage verdict |
| --- | ---: | ---: | --- | ---: | --- | --- | --- |
| `src/auth/oauth-provider.ts` | 470 | 1 class / ~7 public auth methods | `tests/http-transport.test.ts` (indirect via `createApp`) | ~5 | ~4:1 happy | High | Thin. Endpoint presence is covered; token lifecycle, refresh, revoke, expiry, and callback failure paths are not. |
| `src/auth/token-store.ts` | 111 | 1 class / 6 methods | `tests/token-store.test.ts` | 9 | ~2:1 happy | Medium | Reasonable for size. CRUD and persistence are covered, but corruption/permission/concurrency paths are missing. |
| `src/blocks-to-markdown.ts` | 232 | 1 | `tests/blocks-to-markdown.test.ts` (direct), `tests/roundtrip.test.ts` (indirect), `tests/markdown-to-blocks.test.ts` (small indirect round-trip use) | ~65 | ~5:1 happy | Medium | Strong. Coverage is heavy and core shapes are exercised. |
| `src/file-upload.ts` | 92 | 2 | `tests/file-upload.test.ts` | 8 | ~1:1 | Medium | Strong for the size. Real file URL replacement vs code-span skipping is covered well. |
| `src/http.ts` | 236 | 1 export / ~4 route families | `tests/http-transport.test.ts` (direct integration) | 10 | ~3:2 happy | High | Moderate on the happy path, thin on session lifecycle and authenticated OAuth request flow. |
| `src/index.ts` | 35 | 0 runtime exports / 1 startup path | `tests/stdio-startup.test.ts` | 1 | happy only | Low | Adequate. Tiny shim, one meaningful smoke test. |
| `src/markdown-to-blocks.ts` | 659 | 3 | `tests/markdown-to-blocks.test.ts` (direct), `tests/roundtrip.test.ts` (indirect), `tests/blocks-to-markdown.test.ts` (indirect normalization) | ~94 | ~3:1 happy | High | Strong and proportional. This is where the suite is densest, and the density matches the write-path blast radius. |
| `src/notion-client.ts` | 611 | 22 | `tests/update-data-source.test.ts` (direct), `tests/create-page-from-file.test.ts` + `tests/parent-resolution.test.ts` (indirect wiring around mocked exports only) | ~16 nominal, ~11 real | ~4:1 happy | High | Thin relative to surface area. Most read/write/pagination helpers have no direct runtime tests. |
| `src/read-markdown-file.ts` | 80 | 1 | `tests/create-page-from-file.test.ts` (direct) | 10 | ~1:4 edge-heavy | Medium | Strong and proportional. Security boundary is well covered. |
| `src/server.ts` | 1426 | 1 export / 28 tool handlers | `tests/create-page-from-file.test.ts`, `tests/parent-resolution.test.ts`, `tests/http-transport.test.ts` (indirect through `createApp`) | ~25 nominal, concentrated on ~3 handlers | ~5:1 happy | High | Thin and misaligned. Destructive handlers and many read/write tools are effectively untested. |
| `src/types.ts` | 106 | 2 type exports | imported in parser tests as fixtures only | 0 runtime | n/a | Low | Fine. Type-only module; runtime coverage is not relevant. |

## 2. Coverage gaps

### TC-1: `src/server.ts`
**Blast radius:** This is the top-level tool router. If it breaks, users can lose page content, overwrite the wrong section, or get misleading responses while the underlying write already happened.

**What's tested:** Coverage is concentrated around parent resolution and `create_page_from_file` rather than the dangerous handlers. The real source is exercised in `tests/parent-resolution.test.ts:66-195`, `tests/create-page-from-file.test.ts:213-415`, and indirectly through HTTP listing/initialize in `tests/http-transport.test.ts:45-145`. The file also has adjacent "coverage-shaped" tests for `update_section` and `list_databases`, but those are copies, not source coverage: `tests/update-section.test.ts:3-105` and `tests/list-databases.test.ts:3-58`.

**What's NOT tested:**
- `replace_content` when block deletion succeeds and the subsequent append fails. That is the clearest blank-the-page failure mode in the file.
- `update_section` against the real handler when the target heading is the first block, so `afterBlockId` is `undefined`.
- `update_section` against the real handler when duplicate headings exist and only the first matching section should be replaced.
- `update_section` when an `H2` section contains `H3` children and the replacement boundary must stop at the next `H1` or `H2`, not inside the subsection.
- `read_page` with `max_blocks`, `has_more`, and `include_metadata`, including the `trustContent=false` notice injection path.
- `duplicate_page` when the source page has no page parent, or when icon copying / fallback title logic is used.
- `add_database_entries` partial-success aggregation, where some entries fail and others succeed.

**Test to add:** Add a small in-memory MCP integration matrix around the destructive handlers, using `createServer` plus a fake Notion client that records delete/append/read calls. The first tranche should exercise `replace_content`, `update_section`, and `read_page` because they combine routing logic with data-shaping and destructive ordering.

**Priority:** ship-blocker

**Why priority:** this file decides whether user content is deleted, rewritten, or exposed correctly; open-source users will point it at live workspace pages, not a demo dataset.

### TC-2: `src/notion-client.ts`
**Blast radius:** This module constructs the actual Notion API payloads. Regressions here are the fastest route to silent property corruption, truncated writes, or bad pagination that hides data.

**What's tested:** Direct runtime coverage is mostly `tests/update-data-source.test.ts:44-248`, which does a good job on `updateDataSource`, `createDatabase` `is_inline`, and schema-cache invalidation. `tests/create-page-from-file.test.ts:345-379` and `tests/parent-resolution.test.ts:66-195` touch mocked `createPage` / `findWorkspacePages` only, so they validate server wiring, not `notion-client.ts` behavior. `tests/relation-property.test.ts:3-83` is not real coverage; it tests local helper copies.

**What's NOT tested:**
- `uploadFile` for the actual file-system and Notion upload flow, including the `>20 MB` rejection path and MIME-type-to-`blockType` mapping.
- `appendBlocks` and `appendBlocksAfter` when more than 100 blocks are supplied and chunking/order must stay correct across multiple API calls.
- `buildTextFilter` when the schema has zero text-like properties, one text-like property, or several mixed text-like properties.
- `createDatabaseEntry` and `updateDatabaseEntry` end-to-end property conversion for real schema types, including the "page is not part of a database" error path.
- `queryDatabase`, `listChildren`, `listComments`, `listUsers`, `searchNotion`, and `findWorkspacePages` across `has_more` pagination.
- Runtime relation-property behavior. The suite has a copied relation test file, but the actual `convertPropertyValues` / `simplifyProperty` runtime paths are not exercised.

**Test to add:** Add direct unit tests around the exported Notion helpers with thin fake clients, especially for chunking, pagination, upload failure/size handling, and property-conversion correctness in `createDatabaseEntry` / `updateDatabaseEntry`.

**Priority:** ship-blocker

**Why priority:** this is where incorrect payload shape turns into silent database corruption, and users will hand the package real workspace tokens and real schemas.

### TC-3: `src/auth/oauth-provider.ts`
**Blast radius:** This module issues, refreshes, validates, and revokes bearer tokens that unlock a user's Notion workspace. Failures here are security bugs or total auth lockouts.

**What's tested:** Only the route-visible surface is touched, indirectly, through `tests/http-transport.test.ts:194-257`, which checks metadata, registration, and the `/authorize` redirect. There are no direct provider tests for callback handling, token exchange, refresh, verification, or cleanup.

**What's NOT tested:**
- `/callback` handling when `state` is missing, invalid, or expired.
- `/callback` redirect behavior when Notion sends `error` or omits `code`.
- Notion token exchange non-200 responses and network failures.
- `challengeForAuthorizationCode` / `exchangeAuthorizationCode` one-time-use semantics and client mismatch rejection.
- `exchangeRefreshToken` when the refresh token belongs to a different client, when Notion refresh succeeds, and when Notion refresh fails but the old token is reused.
- `verifyAccessToken` expiry handling and `extra.notionToken` propagation.
- `revokeToken` and `cleanup`.

**Test to add:** Add direct provider tests with a fake `TokenStore` and mocked `fetch`, covering the full auth-code to MCP-token lifecycle, then refresh, verify, revoke, and cleanup.

**Priority:** ship-blocker

**Why priority:** OAuth regressions are not cosmetic; they decide whether the package securely hands out access to a real Notion workspace.

### TC-4: `src/http.ts`
**Blast radius:** This is the public transport and session boundary. Bugs here can leak session state, break auth, or make the server appear healthy while request routing is wrong.

**What's tested:** `tests/http-transport.test.ts:24-257` covers the health route, one static-token initialize flow, a few 400/401 cases, and the OAuth metadata/register/authorize happy path.

**What's NOT tested:**
- `GET /mcp` and `DELETE /mcp` with a real active session, not just the "no session" error path.
- Whether `DELETE /mcp` actually invalidates a session so later requests fail.
- Multiple live sessions and whether their state stays isolated.
- Reusing the same `mcp-session-id` across several POSTs beyond a single initialize/list-tools flow.
- OAuth-authenticated `/mcp` happy-path requests where bearer auth succeeds and the resulting session gets `allowWorkspaceParent=true`.
- Cleanup behavior when the transport closes itself and `transports` should be purged.

**Test to add:** Add end-to-end `supertest` cases that create one or two sessions, reuse them, delete them, and prove that OAuth-authenticated `/mcp` requests reach a usable MCP server with session isolation.

**Priority:** before-v0.3.0

**Why priority:** HTTP mode is stateful and public-facing; if session handling is wrong, users get confusing auth bugs or cross-session leakage instead of a clean failure.

## 3. Over-tested areas

- The parser/renderer cluster is the center of gravity: `tests/markdown-to-blocks.test.ts` (68 tests), `tests/blocks-to-markdown.test.ts` (39 tests), and `tests/roundtrip.test.ts` (25 tests) together account for roughly 130 tests. That is mostly justified because markdown conversion is a core write-path concern, but the suite now spends more effort on callout-label permutations and layout variants than on destructive server handlers.
- Callouts in particular are covered from three directions: direct parse (`tests/markdown-to-blocks.test.ts:213-381`), direct render (`tests/blocks-to-markdown.test.ts:92-176`), and round-trip (`tests/roundtrip.test.ts:80-92`). Good confidence, but this is a lot of budget on one mapping table.
- `readMarkdownFile` gets 10 focused tests in `tests/create-page-from-file.test.ts:114-209` for an 80-LOC module. That investment is good because it is a local-file security boundary. It is also notably denser than coverage for `replace_content`, `read_page`, `update_page`, or the OAuth token lifecycle.
- The copied-helper files consume ~21 tests without increasing real runtime coverage: `tests/list-databases.test.ts`, `tests/relation-property.test.ts`, and `tests/update-section.test.ts`. This is the clearest displaced effort in the suite.

## 4. Tests that are testing the wrong thing

- `tests/list-databases.test.ts:3-10`
  Concern: the test defines its own `mapDataSource` copy from the `list_databases` handler instead of calling the real handler through `createServer`. The production lambda can change or break and this file will still stay green.

- `tests/relation-property.test.ts:3-17`
  Concern: both the read-path and write-path logic are local copies. This does not exercise `src/server.ts` or `src/notion-client.ts` at all.

- `tests/relation-property.test.ts:8-17`
  Concern: this one is actively misleading. The comment says it is copying a `convertPropertyValues` relation branch from `src/notion-client.ts`, but the current runtime switch in `src/notion-client.ts` is not being exercised here. The test can pass even if relation support is absent or has drifted.

- `tests/update-section.test.ts:3-23`
  Concern: this file proves a local `findSectionEnd` loop, not the real `update_section` tool. It misses actual heading lookup, deletion/appending order, `afterBlockId` handling, and MCP response shape.

## Bottom line

The suite is not small; it is just uneven. `markdown-to-blocks` / `blocks-to-markdown` / round-trip coverage is strong and mostly proportional to blast radius. The major mismatch is that the highest-risk orchestration and auth surfaces, `src/server.ts`, `src/notion-client.ts`, `src/auth/oauth-provider.ts`, and `src/http.ts`, have far less edge-path coverage than their user impact warrants. Three of the existing test files also inflate perceived coverage by testing copied logic instead of the actual source.

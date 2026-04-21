# Test-Gap Frame 3: API Contract Auditor

**Date:** 2026-04-20
**Scope:** What Notion API behaviors does easy-notion-mcp *depend on* that no test actually verifies against a live API?
**Inputs:** `src/notion-client.ts`, `src/server.ts`, `src/auth/oauth-provider.ts`, `src/auth/token-store.ts`, `tests/`, `node_modules/@notionhq/client/build/src/Client.{js,d.ts}`, gap audit at `.meta/audits/notion-api-gap-audit-2026-04-20.md`.

---

## TL;DR — highest-risk unpinned contract assumptions

1. **Rate-limit retry on POST creates duplicates.** SDK retries 429 on *all* methods including POST (`Client.js:741`). A retried `pages.create` inside `add_database_entries` (`src/server.ts:1399-1409`) can create a duplicate entry if the first call succeeded but the response was lost. No test covers this.
2. **10,000-row query cap is invisible.** `queryDatabase` (`src/notion-client.ts:559-570`) loops on `has_more`/`start_cursor` but never checks `request_status: "incomplete"` — the April-2026 cap marker. A query that hits the cap silently returns a truncated result set with no warning.
3. **Schema cache serves stale data for 5 minutes after property renames/deletes.** The TTL at `src/notion-client.ts:44` means `convertPropertyValues` can map values against a schema whose property names, types, or select-option IDs have changed. The one-shot bust at `:272-283` only fires for *unknown keys*, not for type-mismatches on known keys.
4. **Pagination of multi-value page properties is absent.** `simplifyProperty` (`src/server.ts:53-88`) reads `prop.title`, `prop.rich_text`, `prop.relation`, `prop.people` directly from `pages.retrieve`, which caps each at 25 items. No call to `pages.properties.retrieve` exists anywhere. Silent truncation.
5. **Error codes are coarsened — 401 vs 403 vs 404 distinction is lost.** `enhanceError` (`src/server.ts:426-452`) maps `object_not_found`, `rate_limited`, `restricted_resource`, and `validation_error` to human strings but does not distinguish 401 (bad token) from 403 (scope/workspace) — both fall through to the generic message path.
6. **`replace_content` and `update_section` have a destructive gap window.** Delete-then-append at `src/server.ts:1057-1068` and `:1070-1121` means a 429/network error *after* deletes but *before* appends leaves an empty page or section. No test simulates this.
7. **File upload at exactly 20 MB is untested.** `uploadFile` (`src/notion-client.ts:86`) errors on `> MAX_FILE_SIZE` with strict `>`, so exactly 20 MB should pass — but no test confirms Notion's server-side limit matches our client-side check.
8. **OAuth token refresh failure is silently swallowed.** `exchangeRefreshToken` (`src/auth/oauth-provider.ts:351-386`) catches Notion refresh failures and continues with the old (possibly expired) token. No test verifies behavior when both the refresh and the stale token are invalid.

---

## Inventory by category

### Rate limits and retry

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| SDK handles 429 with `Retry-After` | Implicit — we pass default retry config (`Client.js:540`, maxRetries=2) | If Notion changes `Retry-After` to a non-numeric format or drops the header, SDK falls back to exponential backoff (`Client.js:757-763`) — functional but slower | **Canary:** live test that triggers 429 (rapid-fire reads) and asserts completion within 2× `Retry-After` value |
| POST retries on 429 are safe | `createDatabaseEntry` via `pages.create` (`src/notion-client.ts:607`), `appendBlocks` via `blocks.children.append` (`:365`) | SDK retries 429 on POST (`Client.js:741` — rate limits "always retryable"). If the first POST succeeded server-side but the 429 response was for a *subsequent* internal step, retry creates a duplicate. `add_database_entries` (`:1399-1409`) loops sequentially so each entry is a separate POST — a duplicate entry appears as a silent extra row | **Contract canary:** create entry, inject synthetic 429 on first response, assert exactly 1 entry exists. Also: add idempotency-key header if Notion ever supports it |
| `appendBlocks` chunks at 100 are independently retried | `src/notion-client.ts:363-372` loops in 100-block chunks; each chunk is a separate POST | If chunk 2 of 3 gets a 429 that exhausts retries, chunks 1's blocks are already committed. Caller sees an error but page has partial content | **Live test:** append 250 blocks to a page, verify all 250 exist; separately, verify that a mid-batch failure leaves a coherent partial state |

### Pagination cursors

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| `has_more: false` means all results returned | Every paginated loop: `queryDatabase` (`:569`), `listChildren` (`:411`), `searchNotion` (`:497`), `listComments` (`:586`), `listUsers` (`:648`) | Notion's April-2026 10k-row cap returns `has_more: false` + `request_status: "incomplete"` — our loop exits, caller gets ≤10k rows with no warning. [Ref: changelog](https://developers.notion.com/page/changelog) | **Contract canary:** query a database with >100 rows, assert `request_status` field is checked. Priority: add `request_status` detection to `queryDatabase` |
| `start_cursor` is stable across pages | Same loops | If Notion invalidates a cursor mid-pagination (e.g., concurrent write shifts results), behavior is undefined. SDK would throw an API error | **Live test:** paginate a 200-row database, insert a row mid-pagination, verify no crash and result count ≥ original |
| `blocks.children.list` returns all blocks for a page | `listChildren` (`:400-415`), used by `replace_content`, `update_section`, `read_page` | If a page has >10k blocks (extreme but possible with automated content), same cap issue applies | Low priority — document the limit |

### Schema drift (5-minute TTL cache)

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| Property names are stable within the TTL window | `convertPropertyValues` (`:264-294`) looks up `ds.properties[key]` | User renames "Status" → "State" in Notion UI; within 5 min, writes to "State" get `Unknown property name` even though it exists. The bust-and-retry at `:272` fixes this for *new* keys — but a rename is simultaneously a delete+add, so the old key vanishes and the new key appears on refetch. **This works correctly.** | Low priority — existing behavior is sound |
| Property *type* is stable within TTL | `convertPropertyValue` (`:192-256`) dispatches on `propConfig.type` | User changes a property from `select` to `multi_select` in Notion UI; cached schema says `select`, so we send `{ select: { name: "X" } }` — Notion rejects with `validation_error`. Bust-and-retry doesn't fire because the *key* still exists | **Live test:** change property type, attempt write within TTL, verify error message mentions the type mismatch |
| Select option IDs/names are stable | `convertPropertyValue` case `select` (`:204-205`) sends `{ name: String(value) }` | If a select option is renamed or deleted, Notion auto-creates a new option with the sent name. Not a crash, but potentially unexpected behavior. For `status` properties, the 2026-03-19 changelog notes group reassignment when options are removed — we don't detect or warn about this | **Contract canary:** create a status property with custom groups, delete an option, verify the group reassignment behavior matches our assumptions |

### Error discrimination

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| `object_not_found` covers both "doesn't exist" and "not shared" | `enhanceError` (`:431-432`) | Correct per current API — Notion returns 404 with `object_not_found` for both. But 403 `restricted_resource` is a *different* case (page exists, integration has workspace access but page isn't shared). Our handler at `:439-441` covers this. **Gap:** we don't distinguish 401 (bad/expired token) at all — it falls through to generic message | **Unit test** (mock): verify `enhanceError` produces distinct messages for 401, 403/restricted_resource, 404/object_not_found. **Live canary:** call with revoked token, assert error message mentions token |
| Notion error `body.code` field is always present | `enhanceError` (`:429`) uses `body?.code ?? (error as any)?.code` | SDK wraps API errors as `APIResponseError` with a `code` field. If SDK changes the error shape, our code-specific branches silently stop matching and the error falls through to the generic path — functional but less helpful | Low priority — SDK contract is stable |

### Partial batch failures

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| `pages.create` is atomic — it fully succeeds or fully fails | `createDatabaseEntry` (`:599-611`), `add_database_entries` (`:1388-1411`) | Notion's `pages.create` is atomic per the API docs. But `add_database_entries` loops over entries sequentially; if entry 3 of 5 fails, entries 1-2 are committed and 3-5 are reported as failed. This is *documented behavior* (we return `{ succeeded, failed }`). **Untested path:** what happens when the failure is a 429 that the SDK retries and eventually succeeds? The entry appears in both `succeeded` and the SDK's retry log but only once in Notion | **Live test:** create 5 entries, assert `succeeded.length === 5` and `failed.length === 0`; separately, test with one invalid entry and verify partial success reporting |
| Delete-then-append in `replace_content` is pseudo-atomic | `src/server.ts:1057-1068` | If `appendBlocks` fails after `deleteBlock` completes for all blocks, page is empty. The tool description warns about this (`:544`) but no test verifies the failure mode or recovery | **Integration test** (mock): inject error on `appendBlocks`, verify the error message includes the destructive-state warning |

### File upload boundaries

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| Notion accepts exactly 20 MB single-part uploads | `uploadFile` (`:86`) checks `fileStat.size > MAX_FILE_SIZE` (strict greater-than) | If Notion's server-side limit is 20,971,520 bytes (20 MiB) but we check against `20 * 1024 * 1024` (same value), we're aligned. But if Notion uses MB (20,000,000), files between 19.07 MiB and 20 MiB would pass our check but fail server-side | **Live canary:** upload a file at exactly `20 * 1024 * 1024` bytes, assert success |
| 0-byte files are accepted | Same path — `fileStat.size > MAX_FILE_SIZE` passes for 0 bytes | Notion may reject 0-byte uploads with a validation error. We'd surface it as a generic error | **Live test:** upload 0-byte file, verify error is clear |
| `content_type` mapping covers Notion's accepted types | `getMimeType` (`:31-33`) falls back to `application/octet-stream` | If Notion rejects `application/octet-stream` for the `file` block type, unknown extensions would fail | Low priority — Notion likely accepts any MIME type for generic file blocks |

### OAuth flow

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| Notion refresh tokens are long-lived | `exchangeRefreshToken` (`:351-386`) calls Notion's `/v1/oauth/token` with `grant_type: refresh_token` | If Notion expires refresh tokens (no documented TTL), the refresh fails, we fall back to the old access token (`:382`), and the user gets a stale-token error on the next API call with no clear "please re-authorize" message | **Contract canary:** exchange a refresh token, verify new access token works; separately, test with an invalid refresh token and verify error propagation |
| `access_token` from Notion OAuth is the same format as internal integration tokens | `createNotionClient` (`:13`) passes it as `auth` | Both are `ntn_*` or `secret_*` prefixed strings. This works today. No version-gating concern | Low priority |
| Revoked tokens produce a clear error path | `verifyAccessToken` (`:417-439`) checks our token store, not Notion's token validity | If a Notion workspace admin revokes the integration's access, our MCP token is still "valid" in our store — but the underlying Notion token is dead. The user gets a Notion API error, not an auth error | **Live test:** revoke integration access, call any tool, verify error message suggests re-authorization |

### Notion-Version header drift

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| `2025-09-03` is still supported | `createNotionClient` (`:13`) pins `notionVersion: "2025-09-03"` | Notion's [deprecation policy](https://developers.notion.com/page/changelog) gives ~2 years notice. We're safe until ~2027. But response shapes may evolve even within a pinned version (additive fields) | **Contract canary:** `GET /v1/users/me` with our pinned version, assert 200 and expected shape |
| SDK v5.13.0 matches our pinned version | SDK defaults to its own Notion-Version but we override | Our explicit `notionVersion` override takes precedence (`Client.js:537`). If we bumped SDK without bumping our pin, the SDK's *type definitions* might not match the response shapes we actually get | Low priority — version pin is explicit |
| `after` param on `blocks.children.append` still works | `appendBlocksAfter` (`:387-389`) passes `after: afterBlockId` | Deprecated 2026-03-11 in favor of `position` object. Still works under `2025-09-03`. Breaks on version bump. [Ref: gap audit §4.6](https://developers.notion.com/page/changelog) | **Pre-upgrade test:** when bumping Notion-Version, verify `position` object works |

### Response-shape assumptions

| Assumption | Where relied on | How it breaks | Proposed test |
|---|---|---|---|
| `prop.title` / `prop.rich_text` are always arrays (possibly empty) | `simplifyProperty` (`:55-58`) calls `.map()` with `??` fallback | Safe — null-coalescing to empty string. No crash risk | N/A |
| `page.url` is always present | Every tool response: `(page as any).url` at `:1044`, `:1171`, `:1215`, etc. | Always present for pages. Could be undefined for deleted pages — but we'd already have errored on retrieve | Low priority |
| `results` is always an array | Every paginated loop pushes `...response.results` | SDK types guarantee this. No crash risk unless SDK breaks its own contract | N/A |
| `db.title?.[0]?.plain_text` safely handles empty titles | `getDatabase` (`:127`), search results (`:1267`, `:1357`) | Safe — optional chaining. Falls back to `""` | N/A |
| `response.results.length > 0` in `appendBlocksAfter` (`:392`) | Used to track `afterBlockId` for subsequent chunks | If Notion returns an empty `results` array for a non-empty `children` input, `afterBlockId` stays as the previous value and subsequent chunks append in the wrong position | **Live test:** append 200+ blocks via `appendBlocksAfter`, verify order is correct |

---

## Contract-pinning test harness sketch

Three tiers of tests to catch API drift:

### Tier 1: CI-gated live-API smoke tests (run on every PR, ~30s)
- Requires a dedicated Notion workspace + integration token in CI secrets
- Tests: create page → read page → append content → query → delete
- Validates: auth works, basic CRUD shapes haven't changed, pagination returns expected fields
- Gate: if any fail, PR is blocked

### Tier 2: Scheduled contract canaries (run daily via cron, ~2min)
- Same workspace, broader coverage
- Tests: rate-limit behavior, 10k-row cap detection, file upload boundaries, OAuth refresh, schema cache coherence, multi-value property pagination
- Reporting: failures create a GitHub issue tagged `api-contract-drift`

### Tier 3: Version-bump validation suite (run manually before bumping `notionVersion`)
- Tests every deprecated-but-still-working behavior: `after` param, `archived` vs `in_trash`, any response shape that changed between versions
- Compares responses under old and new version headers

---

## Priority list

| # | Test | API behavior it pins | Effort | Tier |
|---|---|---|---|---|
| 1 | Detect `request_status: "incomplete"` in `queryDatabase` | 10k-row query cap (April 2026) | S — add field check + warning | Tier 1 E2E |
| 2 | `replace_content` mid-failure leaves page empty | Delete-then-append atomicity gap | S — mock-based, no live API needed | Unit |
| 3 | `add_database_entries` partial success reporting | Sequential POST with mixed success/failure | M — needs live workspace with a schema that rejects some entries | Tier 2 canary |
| 4 | POST retry on 429 creates duplicate entries | SDK retry policy on non-idempotent methods | M — hard to trigger deterministically; may need SDK-level mock | Tier 2 canary |
| 5 | Multi-value property truncation at 25 items | `pages.retrieve` property cap | M — needs a relation property with >25 linked pages | Tier 2 canary |
| 6 | Schema cache type-mismatch after property type change | 5-min TTL stale type | M — needs property type change + immediate write | Tier 2 canary |
| 7 | Revoked-token error message clarity | 401/403 error path distinction | S — mock + one live test with invalid token | Unit + Tier 1 |
| 8 | File upload at exactly 20 MB | Server-side size limit alignment | S — needs a 20 MB test file | Tier 2 canary |
| 9 | OAuth refresh with expired Notion refresh token | Refresh fallback path in `exchangeRefreshToken` | M — needs OAuth setup in CI | Tier 2 canary |
| 10 | `appendBlocksAfter` block ordering across chunks | Multi-chunk append with `after` param | S — live test, 200+ blocks | Tier 1 E2E |
| 11 | Status-group reassignment on option delete | 2026-03-19 status group behavior | M — needs status property with custom groups | Tier 2 canary |
| 12 | `Retry-After` header parsing under rate pressure | SDK retry-after compliance | L — requires triggering real rate limits | Tier 2 canary |

Effort: S = <2h, M = 2-4h, L = 4-8h.

---

## What I didn't explore

- **Webhook contract drift** — we don't implement webhooks, so no contract to pin.
- **Cross-workspace token behavior** — what `pages.retrieve` returns when called with a token that has access to workspace A but the page is in workspace B. Relevant for OAuth multi-workspace scenarios but low frequency.
- **Concurrent write safety** — what happens when two MCP clients write to the same page simultaneously via our server. Notion's conflict resolution is undocumented beyond "last write wins."
- **Notion's internal rate limit tiers** — per-integration vs per-workspace vs per-endpoint. We treat all 429s the same because the SDK does, but the retry strategy might need to differ.
- **`pages.updateMarkdown` error shapes** — `find_replace` (`src/server.ts:1131-1141`) casts the result to `any` and checks `result.truncated`. The full error/warning shape of this endpoint (shipped 2026-02-26) is <6 months old and may still be evolving.

# Plan: Notion property type gap closure (PR1)

**Task:** `notion-property-type-gap` (tasuku, `high` priority, `feature,audit,bug` tags).
**Date:** 2026-04-21.
**Audit anchor:** `.meta/audits/notion-api-gap-audit-2026-04-20.md` §1 (gaps 1, 2), §2 (full matrix), §4.1 (`create_database` silent drop), §5 (formula deep dive), §6 (PR1 sequencing).
**Drift anchor:** `.meta/research/frame-6-driftracker-2026-04-17.md` cases P3.5 (verification), P3.6 (silent property read gap), P3.9 (silent schema drop).
**Phase:** planning. No code changes in this commit; only the plan file.

---

## 1. TL;DR

- Replace `schemaToProperties` (`src/notion-client.ts:145-189`) with a typed helper that handles every Notion property type `@notionhq/client` v5.13 exposes under 2025-09-03. Route `create_database` AND `update_data_source` through the same helper so the two endpoints stop drifting.
- Extend `simplifyProperty` (`src/server.ts:50-86`) to decode every property type the schema helper can emit (formula result-type polymorphic, rollup result-type polymorphic, files, people, timestamps, verification, place).
- Unblock `people` value writes (currently throws in `convertPropertyValue` at `src/notion-client.ts:230-236`). Keep computed types (formula, rollup, unique_id, created_*, last_edited_*) as explicit throws. Defer `files` and `verification` value writes to follow-up tasks.
- Flip today's silent drop to a loud validation error: unknown property types in `create_database` / `update_data_source` throw before any API call, listing valid types.
- Backward compat preserved: the existing `schema: [{name, type}]` shape still type-checks. New fields are optional per-type (`expression`, `prefix`, `data_source_id`, `relation_type`, `function`, `relation_property`, `rollup_property`, `format`, `options`).
- Risk: medium. Primary risks are (a) changing the create_database response contract (today the response's `properties` list derives from `Object.keys(schemaToProperties(schema))`, which is about to change meaning) and (b) test fixtures that depended on silent drop.
- Effort: 4 to 6 dev-days single-dispatch. PR size: roughly 500 to 650 LOC including tests. Recommend one PR, not split (see §8).

---

## 2. Property type matrix, post-PR

Legend: ✅ supported. ❌ not supported. ⚠️ supported with caveat.

| Notion property type | Create-schema | Update-schema | Write value | Read value | Roundtrip test |
|---|---|---|---|---|---|
| `title` | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `rich_text` (alias: `text`) | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `number` (with optional `format`) | ✅ now with `format` | ✅ | ✅ | ✅ | ✅ new (format) |
| `select` (with optional `options`) | ✅ now with `options` | ✅ | ✅ | ✅ | ✅ new (options) |
| `multi_select` (with optional `options`) | ✅ now with `options` | ✅ | ✅ | ✅ | ✅ new (options) |
| `status` (with optional `options`) | ⚠️ now with `options`; ⚠️ groups UI-only; SDK v5.13 TS type is EmptyObject so builder must widen the call at the boundary | ✅ | ✅ | ✅ | ✅ new |
| `date` | ✅ | ✅ | ✅ (start only, per existing behavior) | ✅ | ✅ existing |
| `checkbox` | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `url` | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `email` | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `phone` (mapped to `phone_number`) | ✅ | ✅ | ✅ | ✅ | ✅ existing |
| `formula` (with required `expression`) | ✅ NEW | ✅ NEW | N/A (computed, explicit throw) | ✅ NEW (polymorphic by result type) | ✅ NEW |
| `rollup` (with `function` + relation/rollup property names) | ✅ NEW | ✅ NEW | N/A (computed, explicit throw) | ✅ NEW (polymorphic by result type) | ✅ NEW |
| `relation` (with `data_source_id` + `relation_type`) | ✅ NEW (single_property); dual_property via optional field | ✅ NEW | ✅ existing | ✅ existing | ✅ NEW (schema roundtrip) |
| `unique_id` (with optional `prefix`) | ✅ NEW | ✅ NEW | N/A (computed, explicit throw) | ✅ existing | ✅ NEW (schema roundtrip) |
| `people` | ✅ NEW | ✅ NEW | ✅ NEW (array of user IDs) | ✅ existing | ✅ NEW |
| `files` | ✅ NEW (schema only) | ✅ NEW | ⚠️ still throws; value write deferred (external URL only) | ✅ NEW (array of `{type, url, name}`) | ⚠️ schema roundtrip only |
| `verification` | ✅ NEW (schema only) | ✅ NEW | ⚠️ still throws; value write (wiki pages only) deferred | ✅ NEW (decode `{state, verified_by, date}`) | ⚠️ schema + read only |
| `created_time` | ✅ NEW | ✅ NEW | N/A (computed, explicit throw) | ✅ NEW (ISO timestamp) | ✅ NEW read |
| `last_edited_time` | ✅ NEW | ✅ NEW | N/A | ✅ NEW (ISO timestamp) | ✅ NEW read |
| `created_by` | ✅ NEW | ✅ NEW | N/A | ✅ NEW (user id, mirroring people) | ✅ NEW read |
| `last_edited_by` | ✅ NEW | ✅ NEW | N/A | ✅ NEW (user id) | ✅ NEW read |
| `place` | ✅ NEW (schema only) | ✅ NEW | N/A | ✅ NEW (decode `{lat, lon, name, address}`) | ✅ NEW read |
| `button` | ✅ NEW (schema only) | ✅ NEW | N/A (trigger-only) | ✅ NEW (decode as `null`, present) | ✅ NEW schema only |
| Any unrecognized type | ❌ validation error | ❌ validation error | ❌ existing error path | `null` (unchanged) | negative test |

Notes.

- `location` is a separate SDK schema variant alongside `place` (`api-endpoints.d.ts:1505-1507` and `:1915-1918`). At the SCHEMA layer we accept either type string (they both emit EmptyObject). At the READ layer Notion returns page-property values under `place` only (see §4 for the SDK reference); `location` does not appear in `PagePropertyValueWithIdResponse`, so the decoder reads `place` and ignores `location` at read time.
- `last_visited_time`: out of scope for this PR. It appears in the SDK schema request union (`api-endpoints.d.ts:1446`) but is undocumented on the public docs site and has no page-value decode path. Defer to a backlog task `notion-last-visited-time-support` (add to §13). Do NOT include in the plan's supported matrix, test matrix, or TS union. Builder MUST reject it on the schema write path (or pass through raw if the update_data_source heuristic treats it as raw).

---

## 3. Schema-shape spec per new type

Each entry gives: (a) the Notion API shape we emit, (b) the caller-facing `{name, type, ...extra}` shape, (c) the mapping description (not code), (d) the client-side validation applied before the API call.

### 3.1 Formula

API shape: `{ formula: { expression: "<string>" } }`. Confirmed at `api-endpoints.d.ts:1262-1267` and audit §5.1.

Caller input: `{ name: "Score", type: "formula", expression: "prop(\"Count\") * 2" }`.

Mapping: emit `{ formula: { expression: config.expression } }`.

Validation: `expression` is required; must be a non-empty string. If missing, throw with a message pointing at the formula property by name.

### 3.2 Rollup

API shape: `{ rollup: { function, relation_property_name|id, rollup_property_name|id } }`. Confirmed at `api-endpoints.d.ts:2188-2205`.

Caller input: `{ name: "TotalHours", type: "rollup", function: "sum", relation_property: "Tasks", rollup_property: "Hours" }`.

Mapping: emit `{ rollup: { function, relation_property_name: config.relation_property, rollup_property_name: config.rollup_property } }` (prefer `_name` variants; callers can pass an ID string prefixed with `id:` if they want `_id` variants, or we expose `relation_property_id` + `rollup_property_id` as mutually-exclusive alternatives to `relation_property` + `rollup_property`).

Validation: `function` required and one of the SDK's `RollupFunction` union (`sum`, `average`, `count`, etc. per `api-endpoints.d.ts:2187`). Client-side enum check with a small allowlist; if Notion adds new functions, the error message tells the caller to report the mismatch. `relation_property` and `rollup_property` both required.

### 3.3 Relation

API shape: `{ relation: { data_source_id, type: "single_property", single_property: {} } }` or `{ relation: { data_source_id, type: "dual_property", dual_property: { synced_property_name? } } }`. Confirmed at `api-endpoints.d.ts:2121-2135`.

Caller input: `{ name: "Tasks", type: "relation", data_source_id: "<ds-id>", relation_type?: "single_property" | "dual_property", synced_property_name?: "Back-ref" }`. Default `relation_type` is `"single_property"`.

Mapping: emit `{ relation: { data_source_id, type: "single_property", single_property: {} } }` when `relation_type` is unset or `"single_property"`. Emit the dual variant with a nested `dual_property: { synced_property_name }` object when explicitly requested.

Validation: `data_source_id` required. If the caller passes a database ID (UUID with a zero-length `data_sources` list), proactively resolve via `getDataSourceId` so callers don't have to know the 2025-09-03 DS split. `relation_type` optional and validated against `"single_property" | "dual_property"`.

### 3.4 Unique ID

API shape: `{ unique_id: { prefix?: string | null } }`. Confirmed at `api-endpoints.d.ts:2603-2608`.

Caller input: `{ name: "Ticket", type: "unique_id", prefix?: "ENG" }`.

Mapping: emit `{ unique_id: config.prefix !== undefined ? { prefix: config.prefix } : {} }`.

Validation: `prefix`, if provided, must be a string. Null is explicitly allowed to clear a prefix via update.

### 3.5 People, Files, Verification, Place, Button, Location, Created/Last-edited time/by

All ten type variants take `{ <typeName>: {} }` as their API shape (EmptyObject). Confirmed across `api-endpoints.d.ts:596-598, 819, 833-835, 1242-1244, 1505-1507, 1876-1878, 1915-1917, 2684-2686`.

Caller input: `{ name: "Owner", type: "people" }` (no extra field).

Mapping: emit `{ <typeName>: {} }` with the normalized type key (e.g. `people`, `files`, `verification`, `place` or `location`, `button`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`).

Validation: no extras required. Reject `prefix`, `expression`, etc. as extraneous on these types (warn via error, since we advertise the contract).

### 3.6 Select / Multi-select / Status options (non-new types, options added)

API shape: `{ select: { options: [{ name, color? }] } }`, `{ multi_select: { options: [...] } }`. Confirmed for select/multi_select in the Update body at `api-endpoints.d.ts:3487-3513`.

**Status options caveat.** Notion's 2026-03-19 changelog made `status` updatable, and our existing `update_data_source` tool description (`src/server.ts:723-729`) documents sending `{ "Status": { "status": { "options": [...] } } }` raw. But SDK v5.13 types `StatusPropertyConfigurationRequest` as `{ status: EmptyObject }` (`api-endpoints.d.ts:2324-2327`) and models the Update body's status arm the same way (`:3515-3516`). The runtime API accepts options; the TypeScript definition doesn't. The builder must widen the type at the helper call site (e.g. `as PropertyConfigurationRequest | Record<string, unknown>` at the boundary, or a tiny local augmentation). This is an SDK lag, not a runtime capability gap.

Caller input: `{ name: "Status", type: "status", options: ["Todo", "Doing", "Done"] }` OR `{ ..., options: [{ name: "Todo", color: "red" }] }`.

Mapping: normalize plain strings to `{ name }`; pass structured `{ name, color, description }` through.

Validation: `options` if provided must be array; each option must be a string OR `{ name: string, color?: string, description?: string }`. Status groups (`To-do` / `In progress` / `Complete`) cannot be reconfigured via API; new status options land in the default group. Documented in the tool description already.

### 3.7 Number format

API shape: `{ number: { format: "<NumberFormat>" } }` where `NumberFormat` is a string literal (SDK widens to `string` at `api-endpoints.d.ts:1674`).

Caller input: `{ name: "Price", type: "number", format?: "dollar" }`.

Mapping: emit `{ number: config.format !== undefined ? { format: config.format } : {} }`.

Validation: if `format` provided, must be a string. Do not hardcode the enum; Notion adds new formats frequently.

---

## 4. Read-shape spec per type (`simplifyProperty`)

For each type `simplifyProperty` newly handles or continues to handle, the output a caller sees from `query_database` or `read_page`.

| Type | Output shape | Notes |
|---|---|---|
| `formula` | `prop.formula[prop.formula.type]` (i.e. `number`, `string`, `boolean`, or `{start, end?, time_zone?}` for date) or `null`. | Matches audit §5.3 minimal decoder. |
| `rollup` | `prop.rollup.type === "number"` returns the number; `"date"` returns a `{start, end?}` object; `"array"` recursively maps its items through `simplifyProperty` (the `array` elements are typed as `SimpleOrArrayPropertyValueResponse` under `PagePropertyValueWithIdResponse`, so recursion is well-founded for the `query_database` / `read_page` paths we care about); `"unsupported"` / `"incomplete"` return `null`. | Polymorphic dispatch, per `api-endpoints.d.ts:2217-2240` for the property-item shape and the page-value shape at `:25-28, 1779`. The property-item endpoint (unused in this PR) returns `Array<EmptyObject>` inside rollup arrays, so this decoder would NOT be sufficient there; call that out if we later wrap `pages.properties.retrieve`. |
| `files` | `prop.files?.map(f => ({ type: f.type, url: f.type === "external" ? f.external.url : f.file.url, name: f.name }))` or `[]`. | No attempt to refresh expiring `file.url` values (Notion's internal URLs expire); document that consumers should treat internal URLs as short-lived. |
| `people` | `prop.people?.map(p => p.name ?? p.id) ?? []`. | Existing behavior preserved. |
| `created_time` | `prop.created_time` (ISO string). | |
| `last_edited_time` | `prop.last_edited_time` (ISO string). | |
| `created_by` | `prop.created_by?.name ?? prop.created_by?.id ?? null`. | Mirrors `people` shape (name or id). |
| `last_edited_by` | `prop.last_edited_by?.name ?? prop.last_edited_by?.id ?? null`. | |
| `verification` | `{ state: prop.verification?.state ?? "unverified", verified_by: <name-or-id-or-null>, date: prop.verification?.date ?? null }`. | Preserves the three-field shape from `api-endpoints.d.ts:2694-2707`. |
| `place` | `prop.place ?? null`. Pass through the structured `{ lat, lon, name?, address?, aws_place_id?, google_place_id? }` object unchanged. | `location` is NOT in the `PagePropertyValueWithIdResponse` union in SDK v5.13 (see `api-endpoints.d.ts:1779` for the page-value types). `location` is only a valid SCHEMA type (`LocationPropertyConfigurationRequest`, `:1505`); at read time Notion returns the value under `place`. So the read path reads `place` only. Schema path accepts either `type: "place"` or `type: "location"` as an alias. |
| `button` | `null` (buttons carry no value; presence is indicated by the schema, not by a page value). | |
| `unique_id` | Existing: `prop.unique_id.prefix ? \`${prefix}-${number}\` : String(number)`. | Unchanged. |
| `relation` | Existing: `prop.relation.map(r => r.id)`. | Unchanged. |

Residual fallback: `default: return null`. Kept for genuinely unknown types (e.g. a hypothetical new Notion type that lands between this PR and the next version bump). No warning is raised on read in this PR; see §6 for the policy rationale.

---

## 5. Write-shape spec (`convertPropertyValue`)

Today throws for `people`, `files`, `formula`, `rollup`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `unique_id`, `verification`.

Post-PR:

| Type | Behavior |
|---|---|
| `people` | Accept `string` or `string[]` of user IDs. Emit `{ people: ids.map(id => ({ id })) }`. Mirrors the existing `relation` write shape. |
| `files` | Continue to throw, now with a pointer to the deferred task (`notion-files-value-write`). The only writable file value is `external` URLs (internal uploads require our file-upload pipeline plus a create_file_upload API call). |
| `verification` | Continue to throw, with a pointer to the deferred task (`notion-verification-value-write`). Writable only on wiki pages per 2026-03-25 changelog. |
| `formula`, `rollup`, `unique_id`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by` | Continue to throw as "computed by Notion". Error message unchanged in shape. |
| `place` / `location` | Throw as "computed by Notion or not yet supported". The docs label place as "not fully supported". We keep it out. |
| `button` | Throw as "trigger-only; buttons have no write value". |
| Any type we did not handle above | Continue to throw the existing unrecognized-type error with the repo issue pointer. |

---

## 6. Unknown-type policy

Two different code paths; different answers for each.

**Write path (`schemaToProperties`):** FAIL LOUDLY.

- Rationale: the user is actively constructing a schema. A silent drop or warning here leaves them with a database that doesn't match their intent, which is the exact bug the audit surfaced. The tasuku task literally says "fail loudly on unknown types, no silent drops." The `database-write-strictness.test.ts` tests already enforce this posture for unknown property NAMES on entry writes; unknown property TYPES on schema writes are consistent.
- Shape: throw a single descriptive error before any API call. Message pattern: ``Property "${name}" has type "${type}", which is not a valid Notion property type. Valid types: <list>. See <link to Notion property object reference>.``
- Plumbing: `schemaToProperties` should return `{ properties, errors }` internally (or throw immediately on first bad type). Throw at the helper boundary so both `create_database` and `update_data_source` behave the same.

**Read path (`simplifyProperty`):** KEEP NULL FALLBACK.

- Rationale: changing the read path requires a shape change to `query_database`'s response (today an array of flat objects; adding warnings forces a `{ results, warnings }` wrap). That's a breaking change we should not bundle here.
- After this PR every currently-documented Notion property type has an explicit case in `simplifyProperty`. The residual `default: return null` only catches genuinely novel types (e.g. `ai_autofill` if Notion ships it tomorrow). That's an acceptable posture; it matches the existing "unknown block type" fallback only as far as not-crashing, but unlike blocks we don't emit a warning yet.
- Deferred task: `notion-query-read-warnings` (see §13). The trigger would be: a user reports a `null` property they expected to read. Until that lands, the `default: return null` arm is the canonical place to fix.

**Precedent consistency with `omitted_block_types`:** the block-level precedent emits `warnings: [{ code: "omitted_block_types", blocks: [...] }]` on `read_page` / `duplicate_page`. The parallel on the schema-write side would be `warnings: [{ code: "dropped_properties", properties: [...] }]` in `create_database`'s response. We DELIBERATELY do NOT take that path because writes have stricter error semantics than reads. The `database-write-strictness.test.ts` pattern supports this.

---

## 7. Tool description updates

Three tools update their `description` text. The wording below is a sketch; the builder may word-smith within CLAUDE.md's "honest positioning" bar.

**`create_database`** (`src/server.ts:684-707`):

```
Create a database under a parent page.

Supported property types (pass extra fields per type):
- title, rich_text (alias: text)
- number (optional: format, e.g. "dollar", "percent", "number_with_commas")
- select, multi_select, status (optional: options array of "Name" or {name, color, description})
- date, checkbox, url, email, phone
- formula (required: expression, e.g. "prop(\"Count\") * 2")
- rollup (required: function, relation_property, rollup_property)
- relation (required: data_source_id; optional: relation_type "single_property" | "dual_property")
- unique_id (optional: prefix, e.g. "ENG")
- people, files
- created_time, last_edited_time, created_by, last_edited_by
- verification, place, button

Unknown property types fail with an explicit error (no silent drops).
```

**`add_database_entry`** (`src/server.ts:789-801`):

```
Create a new entry in a database.

Writable properties accept simple values:
- title / rich_text: string
- number: number
- select / status: option name string
- multi_select: array of option name strings
- date: ISO date string (start only)
- checkbox: boolean
- url / email / phone: string
- relation: string or array of page IDs
- people: string or array of user IDs

Properties NOT writable from this tool:
- formula, rollup, unique_id, created_time, last_edited_time, created_by, last_edited_by (all computed by Notion)
- files, verification, place, button (not yet supported; tracked as follow-up)
```

**`update_database_entry`** (`src/server.ts:820-832`): same writable-properties list as above.

Tool description changes are NOT a semver-breaking change but ARE part of the tool contract once shipped. The builder should keep the wording close to CLAUDE.md's measured tone.

---

## 8. PR boundary

**Recommendation: ONE PR, not split.**

Rationale.

- Schema coverage and read coverage are coupled: if a user creates a formula column and then queries the database, a null read is worse than a missing create. Shipping schema-only first leaves the codebase in a worse state than pre-PR.
- Test matrix is naturally unified: one roundtrip per type covers schema + read in a single test. Splitting would double the test fixture work.
- ~500 to 650 LOC is reviewable. The changes are mechanical (type-by-type additions with clear contract per type).

Alternative: SPLIT into `schema` + `reads`. Cost of each side:

- `schema` PR: ~200 LOC + ~200 LOC tests. Ships `schemaToProperties` rewrite, unknown-type validation, tool descriptions, `update_data_source` symmetric helper. Leaves every newly-schemable type returning `null` on read (no change from today).
- `reads` PR: ~150 LOC + ~150 LOC tests. Ships `simplifyProperty` expansions plus the `people` value write. Independently mergeable IF the `schema` PR is already in, but useless alone (no way to create the types it reads).

The split fails the "each PR independently mergeable without leaving the code worse" criterion. Ship one PR.

Mergeability check: does landing this one PR leave the repo in a better state than today? Yes. Every schemable type gets a corresponding read path. The only known gaps after merge are `files` value write, `verification` value write, and the read-path warning system (tracked as backlog tasks per §13).

---

## 9. Test approach (TDD)

Cite: project learning `[e9dcf6]` on TDD. Build failing tests first, verify red, implement to green.

### 9.1 New unit test files

**`tests/schema-to-properties.test.ts`** (NEW): per-type unit tests for the pure function. Assert the mapped shape against the SDK's `PropertyConfigurationRequest` union. Cases:

- `formula` with `expression` → `{ formula: { expression } }`
- `formula` with no `expression` → throws (missing required field).
- `rollup` with `function` + `relation_property` + `rollup_property` → `{ rollup: { function, relation_property_name, rollup_property_name } }`.
- `rollup` missing any required field → throws.
- `relation` with `data_source_id` default type → `{ relation: { data_source_id, type: "single_property", single_property: {} } }`.
- `relation` with `relation_type: "dual_property"` → dual_property variant.
- `unique_id` with and without `prefix`.
- `number` with and without `format`.
- `select` / `multi_select` / `status` with options array of strings and objects.
- `people` / `files` / `created_time` / `last_edited_time` / `created_by` / `last_edited_by` / `verification` / `place` / `button` / `location` → EmptyObject shapes.
- Unknown type → throws with the valid-types list in the error message.

**`tests/simplify-property.test.ts`** (NEW or extend an existing unit): per-type `simplifyProperty` decode tests. Cases:

- `formula` with `type: "number"` → the number.
- `formula` with `type: "string"` → the string.
- `formula` with `type: "boolean"` → the boolean.
- `formula` with `type: "date"` → the date object.
- `rollup` with `type: "number"`, `"date"`, `"array"`, `"unsupported"`, `"incomplete"`.
- `files` with external URL, with internal file, with both mixed → array of `{type, url, name}`.
- `unique_id` with prefix → `"ENG-42"`; without prefix → `"42"`; missing payload → `null`. (Existing code path is intact; test is a regression guard we were missing.)
- `created_time` / `last_edited_time` → ISO string through.
- `created_by` / `last_edited_by` → `name ?? id`.
- `verification` with `state: "verified"`, `"expired"`, `"unverified"` → three-field shape.
- `place` / `location` → structured `{lat, lon, ...}` through.
- `button` → null.
- Unknown type → null (regression guard for the residual fallback).

**`tests/convert-property-value.test.ts`** (extend existing if present; else new): cases:

- `people: "user-id-a"` → `{ people: [{ id: "user-id-a" }] }`.
- `people: ["a", "b"]` → `{ people: [{ id: "a" }, { id: "b" }] }`.
- `files`, `verification`, `place`, `button`, `formula`, `rollup`, `unique_id`, `created_*`, `last_edited_*` → throws with the canonical computed-or-unsupported message.

### 9.2 Integration (in-memory MCP) tests

**`tests/property-roundtrip.test.ts`** (NEW, based on `relation-roundtrip.test.ts` pattern):

- Formula: `create_database` with `schema: [{name, type: "title"}, {name, type: "formula", expression: "..."}]` → mock Notion receives correct create body → `get_database` returns the formula in properties list.
- Rollup schema roundtrip.
- Relation schema roundtrip (extends the existing file with schema-level coverage; today it only covers value roundtrip).
- Unique_id schema roundtrip with prefix.
- People schema + value roundtrip: create database with `type: "people"`, add an entry with `{Owner: "user-id"}`, query, read back.
- Files schema roundtrip (no value write yet).
- Verification schema roundtrip (no value write yet).
- Number with format roundtrip.
- Select with options, multi_select with options, status with options roundtrip.
- Unknown type → `create_database` throws before any SDK call.

**Update `tests/create-database-response.test.ts`** (EXISTING):

- `G4c-1` currently asserts `people` is silently dropped. Replace with a test that asserts unknown type (use `type: "this_is_not_a_real_type"`) throws a validation error. The `people` path now succeeds; update the fixture.
- `G4c-2` regression guard: leave intact, ensure all-supported schema still mirrors `result.properties` keys.

### 9.3 Live e2e tests

**`tests/e2e/live-mcp.test.ts:381` and `:418`** (EXISTING `KNOWN GAP` tests):

- Rename `"KNOWN GAP: create_database silently drops formula-type columns"` → `"create_database creates formula columns"`. Flip assertions: `created.properties` INCLUDES `"Score"`; `get_database` shows `{name: "Score", type: "formula"}`. Add a row-read step that verifies the formula EVALUATES for a test row (formula depends on `Count`; evaluated value reads back non-null).
- Rename `"KNOWN GAP: unsupported property types return null without warning"` → `"formula property values read back non-null"`. The test already constructs the scenario; flip the null assertion to expect the evaluated formula result.
- Add live probes for: relation schema create, rollup schema create, people schema + value write, unique_id schema with prefix.

### 9.4 Mutation hand-checks

Once green, swap implementations to prove dispatch matters:

- In `schemaToProperties`, swap the `formula` arm with the `rollup` arm. Run `tests/schema-to-properties.test.ts`. Expect `formula` and `rollup` cases to flip red with useful failure messages.
- In `simplifyProperty`, swap the `formula` case with the `rollup` case. Expect corresponding tests to flip red.

Document both mutations and the red output in the builder's handoff.

### 9.5 Non-regression count

Today's unit suite is **1172 passing tests across 78 files** (verified 2026-04-21 via `npm test --run`). Memory `project_state.md` says 313, which is stale from 2026-03-27.

Target: ≥ 1172 passing (≥ 1172 + new tests added). No red, no skipped-that-was-green.

---

## 10. Backward compat

**TypeScript shape.** Today:

```ts
Array<{ name: string; type: string }>
```

The public signature on `createDatabase` (`src/notion-client.ts:503-508`) and the `create_database` tool's runtime shape already widen `type` to `string`. A discriminated union whose arms only accept literal `type` strings would BREAK existing callers: a caller holding a value typed `{name: string, type: string}` is not assignable to a union whose first arm narrows `type` to a literal union.

After:

```ts
// Public / exported signature; stays wide. Runtime validation in schemaToProperties
// rejects unknown types loudly and rejects missing required extras per-type.
type SchemaEntryPublic = { name: string; type: string; [extra: string]: unknown };
export type SchemaEntry = SchemaEntryPublic;

// Internal helper type (not exported) used inside schemaToProperties once the type
// string has been narrowed by a runtime switch. Provides per-arm ergonomics for
// the builder without constraining the public API.
type SchemaEntryNarrowed =
  | { name: string; type: "title" | "rich_text" | "text" | "date" | "checkbox" | "url" | "email" | "phone" | "people" | "files" | "created_time" | "last_edited_time" | "created_by" | "last_edited_by" | "verification" | "place" | "location" | "button" }
  | { name: string; type: "number"; format?: string }
  | { name: string; type: "select" | "multi_select"; options?: Array<string | { name: string; color?: string; description?: string }> }
  | { name: string; type: "status"; options?: Array<string | { name: string; color?: string; description?: string }> }
  | { name: string; type: "formula"; expression: string }
  | { name: string; type: "rollup"; function: string; relation_property: string; rollup_property: string }
  | { name: string; type: "relation"; data_source_id: string; relation_type?: "single_property" | "dual_property"; synced_property_name?: string }
  | { name: string; type: "unique_id"; prefix?: string | null };
```

Existing callers passing `[{ name, type }]` continue to type-check because the exported type stays wide. Runtime validation replaces compile-time narrowing: the helper throws on unknown `type` and on missing required extras per-type.

**`create_database` handler behavior.** Today the response's `properties` key is `Object.keys(schemaToProperties(schema))`, which silently shrinks when unknown types are dropped. After this PR, unknown types throw, so the caller never sees a partial-success response. For successful requests, the response shape is unchanged. The G-4c-1 test needs updating (see §9.2).

**`update_data_source`.** Today it's pure pass-through (`properties` is forwarded raw). After this PR, we route through the same `schemaToProperties` helper IF and ONLY IF every property value in the payload meets BOTH of:

- Has a top-level `type` string matching our schema type union (e.g. `"formula"`, `"relation"`, `"status"`).
- Has NO reserved Notion raw-shape keys at top level (i.e. no `formula`, `rollup`, `relation`, `number`, `select`, `multi_select`, `status`, `date`, `title`, `rich_text`, `checkbox`, `url`, `email`, `phone_number`, `people`, `files`, `unique_id`, `verification`, `place`, `button`, `location`, `created_time`, `last_edited_time`, `created_by`, `last_edited_by`, `name` that look like rename shape, or a bare `null` for delete).

Counterexample that WOULD be misclassified without the second clause: `{ Score: { type: "formula", formula: { expression: "1" } } }` is a legitimate raw Notion payload (an agent following the existing `update_data_source` tool description at `src/server.ts:723-729` might construct it). The second clause keeps it on the raw path.

If any property in the payload fails either clause, the whole payload is treated as raw pass-through (current behavior). The helper is all-or-nothing per call to avoid mixed-shape payloads.

Risk: the detection heuristic could still misclassify exotic shapes. Mitigation: document the detection rule explicitly in the tool description; add a negative test for the counterexample above; keep the existing raw-shape tests (`update-data-source.test.ts`) green.

**Tool-level contract.** `create_database` / `add_database_entry` / `update_database_entry` have new optional fields in their input schemas. MCP tool descriptions are user-facing but not versioned; expanding a tool's input shape is additive. Downstream consumers relying on the old description will continue to work.

---

## 11. Non-regression surface

- Today's 1172 tests (verified live) must stay green.
- The 11 currently-supported schema types (title, rich_text/text, number, select, multi_select, date, checkbox, url, email, phone, status) must not shift behavior. Tests in `tests/create-database-response.test.ts`, `tests/database-write-strictness.test.ts`, `tests/update-data-source.test.ts`, `tests/relation-roundtrip.test.ts`, and `tests/relation-property.test.ts` are the guards.
- `tests/e2e/live-mcp.test.ts` live test count today includes two `KNOWN GAP:` tests; both will be renamed and flipped (assertions inverted), not deleted. No net loss of live coverage.
- Notion-Version pin stays at `2025-09-03`. This PR does NOT touch the three renamed fields from `project_notion_version_pin.md` (`after`, `archived`, `transcription`), so version-pin impact is nil. Flag this explicitly in the commit/PR body.

---

## 12. Evidence the builder owes back

Paste-level, per step. The handoff from the builder must include:

1. **TDD evidence: failing tests first.** For each new type: show the test added to `tests/schema-to-properties.test.ts`, `tests/simplify-property.test.ts`, or `tests/property-roundtrip.test.ts` BEFORE the implementation in `src/notion-client.ts` / `src/server.ts` changes. Paste at least two failing test outputs (one schema-side, one read-side). Learning: `[e9dcf6]`.
2. **Greens after.** Paste `npm test -- --run` output summary lines showing the flipped count (≥ 1172 + new tests).
3. **Full unit + e2e green.** Run:
   - `npm test` (unit, 78+ files, 1172+ tests).
   - `npm run test:e2e` (live against the Main Test sandbox page).
   Paste the last ~30 lines of each.
4. **Live create-database probe.** Via MCP (`mcp__easy-notion-http__create_database` or `mcp__easy-notion-http__add_database_entry`, whichever surface the builder is using), create a database under the Main Test page with a `formula` column (e.g. `Score = prop("Count") * 2`). Add an entry with `Count = 5`. Call `mcp__easy-notion-http__get_database` and show `formula` is in the property list. Call `mcp__easy-notion-http__query_database` and show `Score` reads back as `10` (or whatever the evaluated value is). Learning: `[5b1f50]` on dogfooding via MCP.
5. **Mutation hand-checks.** Paste the before/after of swapping the `formula` and `rollup` arms; show the test output going red, then back to green after reverting.
6. **Cleanup probe.** After the live probe, confirm the test database was either archived or lives at a documented sandbox location. Do not leave test detritus in the workspace root.

---

## 13. Scope boundaries (explicitly NOT in this PR)

These become backlog-priority tasuku tasks per feedback `capture_deferred_decisions`. File all before dispatching the builder.

| Deferred item | Canonical task name | Trigger for bumping priority |
|---|---|---|
| Pagination past 25 for multi-value properties | `notion-long-property-pagination` | Any user reports a relation/people/rollup-array truncated. |
| Atomic replace + `update_block` | `notion-atomic-edit-update-block` | User reports lost inline comments or block IDs from `replace_content`. |
| Views API, templates, custom emojis | `notion-views-templates-emojis` | A user asks to operate within a saved view, or to create-from-template. |
| File uploads multi-part + `external_url` | `notion-file-upload-modes` | A user hits the 20 MB limit or the HTTP-transport `file://` rejection. |
| Block-type coverage expansion (`synced_block`, `child_database`, `link_to_page`, `meeting_notes`, `heading_4`, `tab`) | `notion-block-type-coverage` | A user reports `omitted_block_types` on a real page. |
| Database-level vs data-source-level split (`is_locked`, `is_inline`, `databases.update`) | `notion-database-level-update` | A user needs to toggle `is_inline` or lock a database. |
| Error code surfacing | `mcp-surface-notion-error-code` (already tracked) | N/A: already on backlog. |
| `files` value write (external URL only) | `notion-files-value-write` | A user wants to set a `files` property value. |
| `verification` value write (wiki pages only) | `notion-verification-value-write` | A user with a wiki page wants to set verification state. |
| `query_database` read-path warnings | `notion-query-read-warnings` | A user reports a `null` property they expected. Requires `query_database` response shape change. |
| `formula` expression validation | `notion-formula-expression-lint` | Users report confusing Notion error messages for malformed expressions. Requires building a formula parser, deferred. |
| Multi-source database data-source disambiguation | `notion-multi-source-disambiguation` | User operates on a database whose intended target is not `data_sources[0]` and hits wrong-schema or wrong-target behavior. Frame-6 P3.8. |
| Schema-cache stale-TYPE drift | `notion-schema-cache-type-drift` | User changes a property's type in the Notion UI and hits wrong-shape write errors until TTL expiry. |
| `last_visited_time` schema support | `notion-last-visited-time-support` | A user asks for `last_visited_time` columns. Currently undocumented on public docs site. |

`tk task add` commands for each are to be run at plan-approval time, not after dispatch.

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Silent behavior change on the 11 currently-supported types | low | high | Existing 1172 tests guard; add explicit assertions for each in `tests/schema-to-properties.test.ts`. |
| Type-narrowing on existing `{name, type}` callers (TypeScript compile error) | low | medium | Keep the discriminated-union first-arm permissive (plain `{name, type}` still types). Verify via `npm run build`. |
| Relation's `data_source_id` confusion with database ID | medium | medium | Either (a) accept both and resolve via `getDataSourceId` internally, or (b) document "must be a data source ID, call `get_database` first". Plan recommends (a) as the UX-friendly default. |
| Rollup's `function` enum drift from Notion's server-side set | low | low | Don't hardcode the allowlist; pass through string, let Notion reject. Documentation says: see SDK `RollupFunction` type. |
| Verification on wiki pages changed behavior (2026-03-25) | n/a | n/a | Out of scope (value write deferred). |
| `place` vs `location` ambiguity | medium | low | Accept both type strings; emit EmptyObject; document that Notion has not stabilized write. |
| Breaking change to `update_data_source` raw pass-through (heuristic detection) | medium | medium | Detection rule: routed through helper ONLY when every property has a top-level `type` string in the union AND no reserved Notion keys at top level. Document and unit-test the detection. |
| Existing `KNOWN GAP:` live tests now flip green, which implies the Notion sandbox must accept formula writes | low | low | Existing tests already successfully exercise `update_data_source`'s raw-shape formula path. Flipping the assertion only changes what we expect; the API call already works. |
| Partial-success response shape change on `create_database` | low | medium | Response shape is unchanged for success; unknown-type request now throws, so no partial response. Tests update `G4c-1` fixture. |
| Multi-source database: `getDataSourceId` always returns `data_sources[0]` | medium | medium | Existing known drift (frame-6 P3.8). For this PR's relation creation path, the `data_source_id` is provided BY the caller, so the ambiguity doesn't bite schema writes. But flag for follow-up: the existing `getDataSourceId` fallback on "pass a database ID, we resolve to DS" uses `[0]` and will silently pick the wrong source in a multi-source DB. Acceptable for this PR since the issue predates it; tracked under backlog `notion-multi-source-disambiguation` (file as deferred). |
| Schema-cache retry handles unknown property NAMES, not stale TYPES | medium | low | `convertPropertyValues` (`src/notion-client.ts:267-283`) busts the cache once if any property key is unknown, then retries. If a user changes a property's TYPE in the Notion UI, our cached schema still has the old type and we'll build the wrong write shape until TTL expiry (5 min). Not a new issue; flag for follow-up `notion-schema-cache-type-drift` rather than expand scope here. |

---

## 15. Effort estimate

Task breakdown (builder-level). Time is dev-time, not wall-clock.

| Step | Work | Time |
|---|---|---|
| 1 | Write failing unit tests for `schemaToProperties` new cases | 0.5 day |
| 2 | Rewrite `schemaToProperties` with per-type branches + validation | 1 day |
| 3 | Route `update_data_source` through the same helper with raw-shape detection heuristic | 0.5 day |
| 4 | Write failing unit tests for `simplifyProperty` new cases | 0.5 day |
| 5 | Extend `simplifyProperty` with new cases | 0.5 day |
| 6 | Write failing unit test for `convertPropertyValue` people case | 0.25 day |
| 7 | Add `people` to `convertPropertyValue` | 0.25 day |
| 8 | Tool description updates + input-schema JSON updates | 0.5 day |
| 9 | Integration tests (`tests/property-roundtrip.test.ts`) | 0.75 day |
| 10 | Update `tests/create-database-response.test.ts` G4c-1 fixture | 0.25 day |
| 11 | Live e2e: rename and flip `KNOWN GAP:` tests; add probes | 0.5 day |
| 12 | Mutation hand-checks | 0.25 day |
| 13 | Buffer for Notion quirks + review | 0.5 day |
| **Total** | | **~6 dev-days** |

Single-dispatch feasibility: YES. 6 dev-days maps to one focused builder session (with checkpoints). Two-dispatch only makes sense if mid-work the builder finds a blocker (e.g. Notion rejecting rollup configs in an unexpected way); in that case, pause and re-plan.

---

## 16. Open questions for James (decisions pending)

Each has a default. Accept the default by silence, or override.

1. **One PR or split?** Default: **one PR**. See §8. Override only if you want a much smaller first PR and accept that it leaves the repo in a temporarily-worse state.
2. **Include `files` value write (external URL)?** Default: **defer** to `notion-files-value-write`. Rationale: writes only support external URLs in Notion's API; the internal-upload path is complex. Override only if you want to push external-URL-only files writes into this PR (~half a day more).
3. **Include `verification` value write (wiki pages only)?** Default: **defer** to `notion-verification-value-write`. Rationale: per 2026-03-25 changelog, writable only on wiki pages, requires per-page capability detection. Override if you want to add wiki-only support and a guard.
4. **`relation_type: "dual_property"`?** Default: **include** in this PR. The SDK supports it; cost is small (~50 LOC + one test). Override to defer if review is tight.
5. **Relation `data_source_id` accepts database IDs (with internal resolution)?** Default: **yes, accept both**. Resolve via existing `getDataSourceId` helper. Override to require explicit data-source IDs (forces the caller to do the 2025-09-03 split).
6. **Rollup function enum validation?** Default: **no client-side enum**; let Notion reject. Override to add a hardcoded allowlist (adds maintenance burden on Notion's side evolving).
7. **Extra-field naming for rollup:** Default: **`relation_property`, `rollup_property`** (drop `_name` suffix since we're the UX wrapper). Override to use the API's exact names (`relation_property_name`, `rollup_property_name`) for one-to-one docs parity.
8. **`place` vs `location`:** Default: **accept both**, pass through to the matching API key. Override to reject one or the other.
9. **Tool description word count:** §7 sketches are fairly long. Default: **keep long**, they're reference documentation for agents. Override to shorten.

---

## 17. Codex pressure review

To be run after this plan file is drafted and before commit. Session name: `plan-review-notion-property-type-gap`.

Questions for Codex:

1. Check the schema shapes in §3 against `node_modules/@notionhq/client/build/src/api-endpoints.d.ts`. Any shape I got wrong?
2. Check the read shapes in §4 against the SDK. Are the polymorphic formula/rollup decoders correct?
3. Is the unknown-type policy (§6: fail on write, null on read) consistent with CLAUDE.md's `warnings` contract and the `omitted_block_types` precedent?
4. Is the backward-compat TypeScript union in §10 ergonomic? Will existing `{name, type}` callers still type-check?
5. Is the single-PR decision in §8 defensible, or should it split?
6. Is the test matrix in §9 complete? Any type I added a schema for but no read test, or vice versa?
7. Risks in §14: anything missed?

Codex's response + my iteration are captured in §18.

---

## 18. Codex review result

Session: `plan-review-ntpg-v2` (an earlier `plan-review-notion-property-type-gap` session timed out at 5 min with its rollout lost; the v2 session ran on `reasoningEffort: high` with a 15-min budget and used about 4.5 min).

**Summary.** Codex validated the formula/rollup/relation/unique_id/people/files/created_*/last_edited_*/verification/place/button/location/number-format shapes in §3 against `node_modules/@notionhq/client/build/src/api-endpoints.d.ts` and the single-PR boundary in §8. It flagged three critical issues and several medium issues; all were accepted and applied to this draft.

**Critical issues accepted and applied.**

1. **Status options (§3.6)**: SDK v5.13 types `StatusPropertyConfigurationRequest` and the Update body's status arm as `{ status: EmptyObject }` (`api-endpoints.d.ts:2324-2327, 3515-3516`), even though the Notion API accepts options per the 2026-03-19 changelog and our existing `update_data_source` tool description documents the raw shape. Applied: §3.6 now calls out the SDK lag explicitly and notes the builder must widen the type at the call boundary.
2. **TS union backward-compat (§10)**: the proposed discriminated union's first arm narrowed `type` to a literal union, which would break existing callers typed as `{name: string, type: string}` (our public `createDatabase` signature at `src/notion-client.ts:503-508` already uses the wide shape). Applied: §10 now keeps the exported/public signature wide (`SchemaEntryPublic` with `[extra: string]: unknown`) and scopes the narrowed union to an internal builder-only type.
3. **`update_data_source` heuristic (§10)**: "top-level `type` => schema-shape" was too loose. A legitimate raw payload like `{ Score: { type: "formula", formula: { expression: "1" } } }` has a top-level `type` AND a raw `formula` key. Applied: §10 now requires BOTH a top-level `type` string AND no reserved raw-shape keys at top level, with the counterexample explicitly called out and an all-or-nothing per-call rule to avoid mixed-shape payloads.

**Medium issues accepted and applied.**

- `location` read path: removed from the read shape table in §4. SDK v5.13's `PagePropertyValueWithIdResponse` has `place` only (`api-endpoints.d.ts:1779`); schema-level `location` remains as an input alias only.
- Rollup array decoder rationale: §4 now cites `api-endpoints.d.ts:25-28, 1779, 2217-2229` and explains the array-element typing only holds for the `query_database` / `read_page` path, not for a future `pages.properties.retrieve` call.
- Multi-source `data_sources[0]` risk (§14): documented as deferred (frame-6 P3.8), noting this PR's relation creation path is not sensitive because the caller supplies `data_source_id` directly.
- Schema-cache type drift (§14): documented as deferred.
- `unique_id` read test: added to §9.1 test matrix.

**Nits accepted and applied.**

- §3.5: fixed "nine" to "ten" (ten EmptyObject variants once `location` is included).
- `last_visited_time`: removed from the supported matrix, TS union, and tests; deferred as `notion-last-visited-time-support` in §13. Rationale: undocumented on the public docs site, no page-value decode path, insufficient to ship confidently.

**Plan quality per Codex.** Schema shapes in §3 correct. Formula decoder in §4 correct. Unknown-type policy in §6 coherent with CLAUDE.md's warnings contract and the `omitted_block_types` precedent. Single-PR boundary in §8 defensible.

**Open items from the review NOT addressed in this draft.** None. All raised issues were either applied or (for multi-source / cache-drift) deferred with a rationale.

---

## 19. References

- Audit: `.meta/audits/notion-api-gap-audit-2026-04-20.md` (especially §1, §2, §4.1, §5, §6).
- Drift research: `.meta/research/frame-6-driftracker-2026-04-17.md` (P3.5, P3.6, P3.9, P3.10).
- Synthesis: `.meta/audits/synthesis-pre-v030-2026-04-17.md` (case C-3).
- SDK types: `node_modules/@notionhq/client/build/src/api-endpoints.d.ts` lines cited inline.
- CLAUDE.md: `warnings` field contract (lines 132 to 136), `.meta/` screening (lines 15 to 24).
- Tasuku task: `notion-property-type-gap` (high priority; tags: feature, audit, bug).
- Notion docs: `/reference/property-schema-object`, `/reference/page-property-values`, `/reference/property-object`, `/docs/upgrade-guide-2025-09-03`.

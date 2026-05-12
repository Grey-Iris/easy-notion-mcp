---
audit: user-reported issues (README 404 + data_source/database_id confusion)
date: 2026-05-12
scope: README http-bin invocation; database tool data_source handling
author: audit PM (single-turn)
---

# Summary

Two issues, two states. **Q1 (README) is shipped and covered** — `npx easy-notion-mcp-http` was replaced everywhere user-facing on 2026-05-07 by `npx -p easy-notion-mcp easy-notion-mcp-http`. Recommend closing the first thread as resolved. **Q2 (data_source vs database_id) is real and currently produces a misleading error** — the database-tool chokepoint that resolves IDs has no special case for the 2026-03-11 layer confusion the user hit, and the error path actively points users in the wrong direction ("share with integration"). Recommend a single small fix at the chokepoint; do not ship a silent fallback.

---

# Q1: README state

**Fixed.** Commit `f47a46f` (James, 2026-05-07, "docs: fix http npx invocation") replaced 5 README instances of the 404-producing `npx easy-notion-mcp-http` with `npx -p easy-notion-mcp easy-notion-mcp-http`. Current `README.md` (tip-of-`dev`, HEAD `22598ee`) confirmed clean — every grep hit (lines 173, 229, 261, 280, 284) uses the `-p` form.

Diff excerpt (`f47a46f`):

```diff
-npx easy-notion-mcp-http
+npx -p easy-notion-mcp easy-notion-mcp-http
```

Why the fix works: `easy-notion-mcp-http` is a secondary `bin` inside the `easy-notion-mcp` package (`package.json:8-12`), not a published package. `npx <name>` resolves `<name>` against the registry, so the bare form 404s. `-p easy-notion-mcp` explicitly resolves the package.

- Tasuku: `readmehttpbininvocation` marked `done`, closed by this commit. Notes confirm "5 README instances and 1 runnable CHANGELOG instance" patched; remaining stale strings are in `.meta/plans`/`.meta/research` (intentional history, not user-facing).
- `github-8-dify-http-stdio-confusion` is **distinct**: Dify user pointed at `http://localhost:3333/mcp` while only stdio was running (connection refused → Dify 503). Different class from the reporter's "package doesn't exist."

**Recommendation:** Close the README class as user-resolved. No work needed.

---

# Q2: data_source vs database_id under 2026-03-11 API

## Current data path

`get_database` → `getDatabase(client, dbId)` (`src/server.ts:3148`, `src/notion-client.ts:587-633`):

```ts
const db = await client.databases.retrieve({ database_id: dbId }) as any;  // 588
const ds = await getCachedSchema(client, dbId) as any;                      // 589
```

`getCachedSchema` (`notion-client.ts:549-558`) calls `getDataSourceId` which is the single chokepoint:

```ts
async function getDataSourceId(client, dbId) {                              // 531
  ...
  const db = await client.databases.retrieve({ database_id: dbId }) as any; // 536
  const dsId = db.data_sources?.[0]?.id;
  if (!dsId) throw new Error(`Database ${dbId} has no data sources`);
  ...
}
```

`queryDatabase` wrapper (`notion-client.ts:1290-1314`) — yes, this is learning 553455's wrapper. It takes `dbId`, resolves via `getDataSourceId`, then calls `client.dataSources.query`. **Routes through the same chokepoint as `get_database`.**

## Other DB tools — all funnel through `getDataSourceId(dbId)`

- `query_database` → `queryDatabase` → `getDataSourceId` ✓
- `add_database_entry` → `createDatabaseEntry` (`notion-client.ts:1473`) → `getDataSourceId` ✓
- `add_database_entries` → `getCachedSchema` + `createDatabaseEntry` ✓
- `update_data_source` → `getDataSourceId` (`notion-client.ts:1266`) ✓
- `get_database`, `getCachedSchema` ✓

Different cases (not subject to this confusion):
- `update_database_entry`, `delete_database_entry` — take `page_id`; `updateDatabaseEntry` already handles `data_source_id` parents (`notion-client.ts:1489-1493`).
- `create_database` — takes a `parent_page_id`.
- `list_databases` — fixed in `70e9ef1` to return `parent?.database_id ?? r.id`.
- `list_views` / `get_view` / `create_view` — already accept `database_id` OR `data_source_id`.

## Current failure mode

When the user passes a data_source ID as `database_id`, `client.databases.retrieve` fails with `object_not_found` (UUID is well-formed but no database container matches). Error flows through `enhanceError` (`src/server.ts:1469-1495`):

```ts
if (code === "object_not_found") {
  return `${message} Make sure the page/database is shared with your Notion integration.`;
}
```

The user gets a **wrong-direction hint** — the reporter's symptom. The integration *is* shared; the ID is wrong-layer. No branch in `enhanceError` recognizes this case. No fixture exists for the exact response body, but the SDK surface guarantees the code is one of `object_not_found` or `validation_error`.

## Recommendations (ranked)

1. **Add a layer-mismatch fallback to `getDataSourceId`** (`notion-client.ts:531`). On `object_not_found` from `client.databases.retrieve`, try `client.dataSources.retrieve({ data_source_id: dbId })`. If it succeeds, throw a tailored error: `"ID ${dbId} is a data_source, not a database container. Pass the parent database ID (try list_databases) or the data_source ID's parent. See https://developers.notion.com/docs/upgrade-guide-2025-09-03."` Single chokepoint, single extra round-trip on the failure path only, no silent magic. **Best leverage.**

2. **Auto-resolve in `getDataSourceId`** — same probe, but on success quietly substitute and proceed. Tempting; do not ship. Hides user error and breaks symmetry with view/data_source tools that intentionally distinguish.

3. **`enhanceError` text-only patch** — add a hint to the `object_not_found` branch on DB tools mentioning the data_source possibility. Cheap, no extra network call, but vague. Use only if #1 is deferred.

## Net answer

Ship recommendation #1. Single-file change in `getDataSourceId`, scoped to one error code, adds one fallback request on the failure path. The reporter succeeded but called their setup "wacky" — the next user without Claude Desktop's troubleshooting bandwidth won't. Q1 already closed; Q2 is a small, high-leverage docs+UX win, not a project.

---

# Session chain

- audit PM session: this single-turn dispatch (no name set in spawn).
- No Codex sub-sessions used — scope was narrow (2 questions, ~6 files), direct reads were faster than a Codex pass and findings are file:line-grounded against `dev` @ `22598ee`.

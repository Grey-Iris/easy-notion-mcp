# Bench token remeasure fixture audit - Codex pass 2

Scope: audit methodology/provenance for `scripts/bench/token-compare.ts` fixtures only. I did not edit the script, push, or commit.

## Claim 2.1 - Hosted fixture matches the spec

VERDICT: Partially true. The hosted fixture has the right 18 tool names in the same order as the published Notion supported-tools page, but the fixture is editorially compressed and uses empty `inputSchema` objects. It is honest as a description-only lower-bound fixture; it is not a full representation of the published hosted surface.

EVIDENCE:

- Web source: Notion supported-tools docs at `https://developers.notion.com/guides/mcp/mcp-supported-tools`, fetched during this audit. The page lists hosted MCP tools from `notion-search` through `notion-get-self` in the MCP tools section (web fetch lines 99-238).
- Fixture source: `.meta/bench/token-remeasure/hosted-tools-fixture.json`.
- Tool-list diff:

```text
docs count 18 fixture count 18
missing_in_fixture []
extra_in_fixture []
same_order true
```

Docs/fixture spot checks:

| Tool | Docs excerpt | Fixture excerpt | Assessment |
|---|---|---|---|
| `notion-search` | "Search across your Notion workspace" | "Search across your Notion workspace" | Verbatim opening sentence. |
| `notion-fetch` | "by its URL or ID" | "by URL/ID" | Near-verbatim, compressed. |
| `notion-create-pages` | "specified properties and content" | "specified properties and content" | Near-verbatim, but fixture omits extra docs prose. |
| `notion-create-view` | "table, board, list, calendar" | "table, board, list, calendar" | Near-verbatim opening capability list, but fixture drops config details. |

InputSchema-relevant docs prose omitted by the fixture:

- `notion-fetch`: docs mention URL/ID, data source IDs from `collection://...`, schemas/properties, and database templates. Fixture schema is empty.
- `notion-create-pages`: docs mention specified properties/content, database templates, optional icon, optional cover, and default private-page parent behavior. Fixture schema is empty and its description keeps only the first two concepts.
- `notion-update-page`: docs mention properties, content, icon, cover, and applying templates. Fixture schema is empty.
- `notion-move-pages`: docs mention a new parent. Fixture schema is empty.
- `notion-create-database`: docs mention specified properties. Fixture schema is empty.
- `notion-update-data-source`: docs mention properties, name, description, and other attributes. Fixture schema is empty.
- `notion-create-view`: docs mention view type plus optional configuration DSL for filters, sorts, grouping, and display options. Fixture omits the DSL clause and has empty schema.
- `notion-update-view`: docs mention name, filters, sorts, display configuration, and clearing configuration. Fixture keeps only the first sentence and has empty schema.
- `notion-query-data-sources`: docs mention structured summaries, grouping, filters, counts, and rollups. Fixture omits the counts/rollups clause and has empty schema.
- `notion-create-comment` / `notion-get-comments`: docs mention page-level, block-level/inline, replies, discussions, resolved threads, and full comment content. Fixture compresses these.
- `notion-get-user`: docs imply a user ID parameter. Fixture schema is empty.
- `notion-get-teams`: example prompts imply search-by-name and membership status filtering/return data. Fixture schema is empty.

CONCERN:

The generated summary says "Hosted fixture includes verbatim published descriptions." That is too strong. Some descriptions are verbatim first sentences, but several are shortened or normalized. The fixture should be described as "docs-derived, description-only, editorially compressed" rather than "verbatim".

## Claim 2.2 - "Lower bound" framing is honest

VERDICT: The lower-bound framing is directionally honest, but the 6.4x hosted headline is an upper-bound ratio against a floor, not a stable estimate. A realistic hosted listing total projected from local schemas lands around 2.0K-2.2K tokens using this repo's schema style; 1.5K-4.0K is plausible but broad.

EVIDENCE:

Current hosted fixture:

```text
hosted total = 772 tokens
hosted empty inputSchema tokens = 216 total = 12/tool
```

Local inputSchema-only token counts, using `js-tiktoken` `encodingForModel("gpt-4")` and `JSON.stringify(tool.inputSchema)`:

```text
create_page            126
query_database         154
find_replace            75
search                  42
add_database_entries    53
```

Those five comparable tools average 90 schema tokens/tool. Multiplying by 18 hosted tools gives about 1,620 schema tokens. Since the hosted fixture already includes 216 empty-schema tokens, the projected total is:

```text
772 - 216 + 1620 = 2176 tokens
```

An all-tool hosted mapping to local analogs is similar:

```text
notion-search              -> search              42
notion-fetch               -> read_page          146
notion-create-pages        -> create_page        126
notion-update-page         -> update_page         62
notion-move-pages          -> move_page           46
notion-duplicate-page      -> duplicate_page      88
notion-create-database     -> create_database    108
notion-update-data-source  -> update_data_source  70
notion-create-view         -> query_database     154
notion-update-view         -> query_database     154
notion-query-data-sources  -> query_database     154
notion-query-database-view -> query_database     154
notion-create-comment      -> add_comment         44
notion-get-comments        -> list_comments       25
notion-get-teams           -> list_databases       9
notion-get-users           -> list_users           9
notion-get-user            -> get_me               9
notion-get-self            -> get_me               9
mapped schema sum = 1409
projected total = 772 - 216 + 1409 = 1965 tokens
```

Cross-check against npm package schemas:

```text
npm inputSchema count 22
npm inputSchema sum 14251
npm inputSchema avg 647.8
npm inputSchema min 552
npm inputSchema max 1037
```

Interpretation:

- A local-style hosted schema estimate is about 2.0K-2.2K total tokens.
- The report's 1.5K-4.0K range is plausible. The lower end is tight if the hosted schemas are richer than this repo's compact schemas. The 4K upper bound requires about 191 real schema tokens/tool after replacing empty schemas, which is above this repo's max local schema count (154) but far below the npm OpenAPI-proxy average (648).
- If hosted is 2,000 tokens, local is about 2.5x hosted, not 6.4x. If hosted is 3,000 tokens, local is about 1.7x. If hosted is 4,000 tokens, local is about 1.2x.

Prominence check:

- `.meta/research/token-remeasure-2026-04-28.md:45-54` prominently says listing-budget alone is worse than hosted and includes the 6.44 ratio.
- `.meta/research/token-remeasure-2026-04-28.md:114` gives the 1,500-4,000 token plausible hosted range.
- `.meta/research/workflow-token-measure-2026-04-28.md:21` uses a 3,000-token plausible midpoint, and lines 147-149 flag live hosted listing budget as a top uncertainty.
- `.meta/bench/token-remeasure/summary.md` includes the lower-bound caveat but does not quantify the 1.5K-4K range.

CONCERN:

The report text at `.meta/research/token-remeasure-2026-04-28.md:51` says "we cost at least 6.4x." That wording is backwards for a denominator lower bound. 6.4x is the ratio against the 772-token floor and should be framed as an upper-bound ratio / worst-looking comparison until live hosted schemas are captured.

## Claim 2.3 - Local fixture matches a fresh tools/list at HEAD

VERDICT: Verified. The local fixture exactly matches a fresh `tools/list` capture from built HEAD, and its 28 tools match the `src/server.ts` registrations. The token drift from the `d66eb47` baseline is real description/schema growth, not just a measurement bug.

EVIDENCE:

Build and fresh capture:

```text
npm run build
> easy-notion-mcp@0.5.0 build
> tsc

fresh dist/index.js tools/list count = 28
local fixture exact match after jq -S
```

Source-vs-fixture comparison:

```text
source count 28 fixture count 28
missing_in_fixture []
extra_in_fixture []
same_order true
```

Tool registrations in `src/server.ts`:

```text
src/server.ts:519  create_page
src/server.ts:555  create_page_from_file
src/server.ts:587  append_content
src/server.ts:599  replace_content
src/server.ts:613  update_section
src/server.ts:628  find_replace
src/server.ts:642  read_page
src/server.ts:668  duplicate_page
src/server.ts:684  update_page
src/server.ts:698  archive_page
src/server.ts:709  search
src/server.ts:725  list_pages
src/server.ts:736  share_page
src/server.ts:747  create_database
src/server.ts:788  update_data_source
src/server.ts:826  get_database
src/server.ts:837  list_databases
src/server.ts:845  query_database
src/server.ts:879  add_database_entry
src/server.ts:912  add_database_entries
src/server.ts:928  update_database_entry
src/server.ts:960  list_comments
src/server.ts:971  add_comment
src/server.ts:983  move_page
src/server.ts:995  restore_page
src/server.ts:1006 delete_database_entry
src/server.ts:1017 list_users
src/server.ts:1025 get_me
```

Requested history command:

```text
git log --oneline d66eb47..HEAD -- src/server.ts
520fedf feat(pagination): long-property pagination for PR2
0ef92a2 feat(properties): close Notion property-type gap
f6a7099 fix(server): read MCP serverInfo version from package.json
73dc617 feat(pr3): G-5 relation read + write support and test rewire (#27)
82f6dd4 feat(pr2): close silent-success paths (G-3 destructive warnings + G-4 DB write strictness) (#26)
8bc209b feat(security): close HTTP file:// read + add bearer-always auth (PR 1, G-1) (#24)
```

Description/schema expansions from `git diff d66eb47..HEAD -- src/server.ts`:

- `replace_content`: old `d66eb47` had a one-line destructive description at `src/server.ts` old line 507. HEAD expands it at `src/server.ts:599-602` with no-rollback failure-mode warnings and safer alternatives.
- `read_page`: old `d66eb47` said markdown round-trips cleanly at old line 546. HEAD `src/server.ts:642-645` adds omitted-block warnings and long-title pagination guidance; HEAD `src/server.ts:658-662` also adds `max_property_items`.
- `create_database`: old `d66eb47` listed a short set of property types at old line 644. HEAD `src/server.ts:747-764` expands that into supported property types/extras including formula, rollup, relation, unique_id, people/files, audit fields, verification, place/location/button, and explicit unknown-type failure.
- `query_database`: HEAD `src/server.ts:845-854` adds response-shape and `truncated_properties` guidance, and HEAD `src/server.ts:869-872` adds `max_property_items`.
- `add_database_entry` and `update_database_entry`: old descriptions were one-line summaries at old lines 749 and 780. HEAD `src/server.ts:879-898` and `src/server.ts:928-946` add writable and non-writable property-type lists.

CONCERN:

No methodology concern on the local fixture. The drift from 3,819 to 4,969 tokens is explained by real tool-description and schema growth after `d66eb47`.

## Claim 2.4 - NPM fixture matches the published package

VERDICT: The `npm-tools.json` fixture exactly matches a fresh `tools/list` capture from the published `@notionhq/notion-mcp-server@latest` package. The pinned latest version is `2.2.1`, not `2.3.0`.

EVIDENCE:

The benchmark script's `.meta/bench/token-remeasure/npm-pkg/` prefix is no longer on disk, consistent with `scripts/bench/token-compare.ts` removing it after capture:

```text
npm-pkg prefix absent
```

Fresh registry and install check:

```text
npm view @notionhq/notion-mcp-server@latest version
2.2.1

npm view @notionhq/notion-mcp-server dist-tags version versions --json
{
  "dist-tags": { "latest": "2.2.1" },
  "version": "2.2.1",
  "versions": [
    "1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0",
    "1.6.0", "1.7.0", "1.8.0", "1.8.1", "1.9.0", "1.9.1",
    "2.0.0", "2.1.0", "2.2.0", "2.2.1"
  ]
}
```

Installed package metadata from `/tmp/npm-mcp-check/node_modules/@notionhq/notion-mcp-server/package.json`:

```text
version: 2.2.1
bin: notion-mcp-server -> bin/cli.mjs
```

Fresh `node bin/cli.mjs` tools/list:

```text
count 22
API-get-user
API-get-users
API-get-self
API-post-search
API-get-block-children
API-patch-block-children
API-retrieve-a-block
API-update-a-block
API-delete-a-block
API-retrieve-a-page
API-patch-page
API-post-page
API-retrieve-a-page-property
API-retrieve-a-comment
API-create-a-comment
API-query-data-source
API-retrieve-a-data-source
API-update-a-data-source
API-create-a-data-source
API-list-data-source-templates
API-retrieve-a-database
API-move-page
```

Fixture comparison:

```text
diff -u <(jq -S . .meta/bench/token-remeasure/npm-tools.json) <(jq -S . /tmp/npm-mcp-check-tools.json)
npm fixture exact match after jq -S
```

CONCERN:

If any report text says the npm capture is `v2.3.0 as of 2026-04-28`, that is not supported by the registry state observed in this audit. The fixture itself matches current `latest` (`2.2.1`) exactly.

# easy-notion-mcp Codebase State — Verification Fact Sheet

**Date:** 2026-04-10
**HEAD SHA at verification:** `ca9f1c675edbddbf1aece96d69da429fd08c4e1a` (dev branch)
**Purpose:** Verify current state of relevant code for planning PR A (updateDataSource + is_inline on createDatabase) and PR B (create_page_from_file + transport flag).
**Method:** Read source files, `node_modules/@notionhq/client`, `package.json`, `package-lock.json` directly. Researcher was instructed not to read any wishlist or plan documents.
**Session:** `verify-easy-notion-mcp-codebase-state`

---

## 1. SDK version and `dataSources.update()` — Confirmed

- **Pinned** in `package.json`: `"@notionhq/client": "^5.13.0"`
- **Installed** (`node_modules/@notionhq/client/package.json:3`): `"version": "5.13.0"`
- **Method exists** — `node_modules/@notionhq/client/build/src/Client.d.ts:179`:
  ```ts
  update: (args: WithAuth<UpdateDataSourceParameters>) => Promise<UpdateDataSourceResponse>;
  ```
- Request type exported at `node_modules/@notionhq/client/build/src/api-endpoints.d.ts:3603`:
  ```ts
  export type UpdateDataSourceParameters = UpdateDataSourcePathParameters & UpdateDataSourceBodyParameters;
  ```

**Conclusion:** `client.dataSources.update()` is available on v5.13.0.

---

## 2. `createDatabase` current shape + `is_inline` support — Confirmed

`src/notion-client.ts:455-466`:
```ts
export async function createDatabase(
  client: Client,
  parentId: string,
  title: string,
  schema: Array<{ name: string; type: string }>,
) {
  return client.databases.create({
    parent: { type: "page_id", page_id: parentId },
    title: titleRichText(title),
    initial_data_source: { properties: schemaToProperties(schema) },
  } as any);
}
```

No options parameter currently. The SDK type natively supports `is_inline` — `api-endpoints.d.ts:3768`:
```ts
is_inline?: boolean;
```
(within `CreateDatabaseBodyParameters`, lines 3756–3772).

**Conclusion:** Function takes no options; SDK accepts `is_inline` on create. Adding `is_inline` to `createDatabase` is a clean extension.

---

## 3. Tool registration pattern — Confirmed

Representative — `create_database` registration, `src/server.ts:601-624`:
```ts
{
  name: "create_database",
  description: "Create a database under a parent page. Supported property types: title, text, number, select, multi_select, date, checkbox, url, email, phone, status.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Database title" },
      parent_page_id: { type: "string", description: "Parent page ID" },
      schema: {
        type: "array",
        description: "Array of {name, type} property definitions",
        items: {
          type: "object",
          properties: { name: { type: "string" }, type: { type: "string" } },
          required: ["name", "type"],
        },
      },
    },
    required: ["title", "parent_page_id", "schema"],
  },
},
```

Handler — `src/server.ts:1109-1123`:
```ts
case "create_database": {
  const notion = notionClientFactory();
  const { title, parent_page_id, schema } = args as {
    title: string; parent_page_id: string; schema: Array<{ name: string; type: string }>;
  };
  const result = await createDatabase(notion, parent_page_id, title, schema) as any;
  return textResponse({ id: result.id, title, url: result.url, properties: schema.map(s => s.name) });
}
```

Tools live in a top-level `const tools = [...] as const` array (ends `src/server.ts:790`), returned wholesale by the `ListToolsRequestSchema` handler at `src/server.ts:840-842`:
```ts
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [...tools] };
});
```

**Conclusion:** Straightforward pattern to mirror for `update_data_source`.

---

## 4. Mode-conditional tool registration — NOT APPLICABLE (pattern does not exist)

**No mode-conditional tool registration pattern exists in `src/server.ts`, `src/index.ts`, or `src/http.ts` as of HEAD SHA `ca9f1c675edbddbf1aece96d69da429fd08c4e1a`.**

Evidence:
- `CreateServerConfig` (`src/server.ts:792-796`) has no transport/mode field:
  ```ts
  export interface CreateServerConfig {
    rootPageId?: string;
    trustContent?: boolean;
    allowWorkspaceParent?: boolean;
  }
  ```
- `ListToolsRequestSchema` handler always returns the entire `tools` array unconditionally (`src/server.ts:840-842`, quoted above).
- `src/index.ts:14-20` (stdio) passes only `rootPageId` + `trustContent`; `src/http.ts:79-83` passes `rootPageId` + `trustContent` + `allowWorkspaceParent`. Neither passes a mode/transport flag.
- Grep for `stdio|transport|mode` in `src/server.ts` returns only SDK imports and one description string at `src/server.ts:444` (a human-readable hint to callers, not a code branch).

**Conclusion:** Introducing stdio-only tool registration requires a new pattern — likely a `transport: 'stdio' | 'http'` field on `CreateServerConfig`, threaded through both entry points, with the tools handler filtering by it. **This is PR B's infrastructure work, not PR A's concern.**

---

## 5. Test file layout — Confirmed

`tests/roundtrip.test.ts` exists. Full `tests/` listing:
```
tests/blocks-to-markdown.test.ts
tests/file-upload.test.ts
tests/http-transport.test.ts
tests/list-databases.test.ts
tests/markdown-to-blocks.test.ts
tests/parent-resolution.test.ts
tests/relation-property.test.ts
tests/roundtrip.test.ts
tests/stdio-startup.test.ts
tests/token-store.test.ts
tests/update-section.test.ts
```

Unit tests for `notion-client.ts` functions live as siblings in `tests/` (e.g. `tests/list-databases.test.ts` targets a `notion-client` function directly). No `tests/unit/` or nested subdir.

**Conclusion:** New tests for `updateDataSource` should live at `tests/update-data-source.test.ts` (or similar), matching the sibling convention.

---

## 6. HTTP filesystem boundary — Confirmed (writes already exist)

`src/auth/token-store.ts:18`:
```ts
const DEFAULT_DIR = join(homedir(), ".easy-notion-mcp");
```

Writes at `src/auth/token-store.ts:39` and `:75`:
```ts
await writeFile(this.keyPath, this.key, { mode: 0o600 });
...
await writeFile(this.tokensPath, blob, { mode: 0o600 });
```

Directory created at `:33`: `await mkdir(this.dir, { recursive: true });`

**Conclusion:** HTTP mode already performs filesystem writes to `~/.easy-notion-mcp/` with `0o600` perms (key + encrypted tokens). Precedent exists for server-controlled filesystem paths — but NOT for caller-specified paths. **Relevant for PR B design, not PR A.**

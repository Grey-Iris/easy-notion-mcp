# Plan: `create_page_from_file` tool + transport-conditional tool registration

**Date:** 2026-04-15
**Target branch:** `dev` (from `ef0102d`)
**Pattern:** 2 (Plan → Human Review → Build)
**Fact sheet:** `.meta/research/easy-notion-mcp-codebase-state-2026-04-10.md`
**Reference plan (structure/density):** `.meta/plans/update-data-source-tool-2026-04-10.md`

---

## 1. Summary

Introduce a new mode-conditional tool registration pattern and the first tool that uses it: `create_page_from_file`, a stdio-only variant of `create_page` that takes a local file path instead of inline markdown content. The server reads the file, validates it against security restrictions, and dispatches through the existing `createPage` wrapper's markdown-to-blocks pipeline.

**Why it's one coherent PR:** the infrastructure (per-tool `transports` declaration + `ListTools`/`CallTool` filter) and the feature (`create_page_from_file`) are co-motivated. The feature *has* to be stdio-only for security (see §2), and shipping the filter without a consumer is YAGNI. Reviewing them together makes the motivation legible.

**Why the feature exists:** measured, not hypothetical. An earlier session burned ~90–150K tokens of agent context transferring markdown files into Notion via `Read` + `create_page(content=...)`. The content passed through agent context twice for purely mechanical work. With a file-based variant, the agent sends three short strings (parent id, title, file path) and the content never enters its context.

---

## 2. Scope — in / out

**In (this PR):**
- New `transport: 'stdio' | 'http'` field on `CreateServerConfig` (`src/server.ts:828-832`), threaded through both entry points.
- New `workspaceRoot?: string` field on `CreateServerConfig`, resolved once at server construction (see §4 for why — Codex review §7/§3 pushed this from handler-call time to construction time).
- New optional `transports?: readonly ('stdio' | 'http')[]` field on each tool entry in the `tools` array. Absent = available in all transports (zero-touch for the 27 existing tools).
- `ListToolsRequestSchema` handler filters `tools` by the configured transport before returning, **and projects each entry to a public Tool object** (stripping the internal `transports` field so it never leaks over the wire).
- `CallToolRequestSchema` handler rejects calls to tools whose declared `transports` don't include the current transport, returning a clean error (defense in depth — not redundant with ListTools filter; enforces against stale/buggy/malicious clients that call unlisted tools).
- New small file-validation helper exported from a dedicated module (`src/read-markdown-file.ts` — see §4 for the rationale; keeps filesystem concerns out of `notion-client.ts`, which is strictly a Notion-SDK wrapper surface).
- New `create_page_from_file` MCP tool registration + handler in `src/server.ts`, declared with `transports: ['stdio']`. The handler validates + reads the file via the helper, then dispatches through the same `markdownToBlocks(...)` → `createPage(...)` path the existing `create_page` handler uses.
- Updates to `src/index.ts` to pass `transport: 'stdio'` and `workspaceRoot` (resolved from `NOTION_MCP_WORKSPACE_ROOT` or default).
- Updates to `src/http.ts` to pass `transport: 'http'`. HTTP mode does NOT read or thread `workspaceRoot` — the file-reading tool is filtered out anyway, so the field is unused in HTTP mode.
- New `tests/create-page-from-file.test.ts` covering the security/filtering path.
- New unit coverage for transport filtering (co-located in the new test file or as a sibling — builder's call).
- Minimal ripple to `tests/http-transport.test.ts`: tool count stays 27 (stdio-only tool is filtered out of HTTP), but add a `not.toContain("create_page_from_file")` assertion to lock the filter behavior in.
- Targeted CLAUDE.md edit (see §9 open question).

**Out (explicitly excluded, bias toward exclusion):**
- ❌ `create_database_from_file`, `append_content_from_file`, `update_section_from_file`, or any other `_from_file` siblings. One coherent idea per PR.
- ❌ Batch / multi-file import.
- ❌ Refactor of `markdown-to-blocks.ts` or `createPage` wrapper internals.
- ❌ Any `package.json` / `package-lock.json` / version / dependency changes.
- ❌ Backwards-compat shim for tools without a `transports` field — they just don't declare it and get the default (all transports) behavior.
- ❌ `icon` / `cover` parameters on the new tool. `create_page` supports them; add later if demand appears.
- ❌ Glob-based or directory-based input.
- ❌ Per-user / per-session allowed-root overrides beyond the one env var.
- ❌ A feature-inventory CLAUDE.md edit — only architectural additions (see §9 Q5).
- ❌ Any mention of the file-based variant in the existing `create_page` tool description (see §9 Q6).
- ❌ Unrelated fixes noticed in passing (none spotted; log in §9 if any appear during build).

---

## 3. Files to modify

| File | Change |
|---|---|
| `src/server.ts` | Add `transport` + `workspaceRoot` fields to `CreateServerConfig` (`:828-832`). Declare a local `ToolDefinition` type with optional `transports?: readonly ServerTransport[]`. Declare `create_page_from_file` tool with `transports: ['stdio']` near the `create_page` block (`:418-451`). Add handler case near the `create_page` handler (`:885-913`). Modify `ListToolsRequestSchema` handler (`:876-878`) to filter by current transport AND project internal entries to public Tool objects (strip `transports`). Modify `CallToolRequestSchema` handler (`:880-884`) to reject calls to tools whose `transports` don't include the current one. |
| `src/read-markdown-file.ts` | **New** (small module, ~60 lines). Exports `readMarkdownFile(filePath, workspaceRoot)` → `Promise<string>`. Does path validation, `stat` + `isFile` check, `fs.realpath`, separator-aware containment check, size cap, extension check on the **resolved** real path, strict UTF-8 decode via `TextDecoder("utf-8", { fatal: true })`. Returns the decoded markdown string. Filesystem concerns live here, not in `notion-client.ts` (which is a Notion-SDK wrapper surface). |
| `src/notion-client.ts` | **No changes.** Earlier draft proposed adding `createPageFromFile` here; Codex review §7 pointed out that markdown parsing and `processFileUploads` live in `server.ts`, not `notion-client.ts`, and moving them would muddy a clean boundary. Handler path in `server.ts` dispatches through the existing `markdownToBlocks(...)` + `createPage(...)` pattern used by `create_page` — no new wrapper in `notion-client.ts`. |
| `src/index.ts` | Pass `transport: 'stdio'` and `workspaceRoot: process.env.NOTION_MCP_WORKSPACE_ROOT \|\| process.cwd()` in the `createServer` config (`:14-20`). Note: `\|\|` not `??`, so an empty-string env var behaves as unset. |
| `src/http.ts` | Pass `transport: 'http'` in the `createServer` config (`:79-83`). No `workspaceRoot` passed. |
| `tests/create-page-from-file.test.ts` | New. Uses the `McpClient + InMemoryTransport` pattern from `tests/parent-resolution.test.ts` to drive the server from the outside. Covers the security surface (mocked `notion-client.createPage` + real tmpdir fixtures) and the transport filter behavior end-to-end. |
| `tests/http-transport.test.ts` | Add one-line negative assertion: `expect(toolNames).not.toContain("create_page_from_file")` alongside `:141-144`. Tool count stays 27 — do NOT bump. |
| `CLAUDE.md` | Two targeted additions — see §9 Q5 for exact lines. |

No changes to `src/markdown-to-blocks.ts`, `src/blocks-to-markdown.ts`, `src/auth/*`, `src/file-upload.ts`, `package.json`, or `package-lock.json`.

---

## 4. Proposed TypeScript signatures and shapes

### `CreateServerConfig` (extended, `src/server.ts:828-832`)

```ts
export type ServerTransport = "stdio" | "http";

export interface CreateServerConfig {
  rootPageId?: string;
  trustContent?: boolean;
  allowWorkspaceParent?: boolean;
  /**
   * Which transport this server instance is being built for. Used by the
   * tool registration layer to filter tools whose `transports` declaration
   * does not include the current transport. Defaults to 'stdio'.
   */
  transport?: ServerTransport;
  /**
   * Absolute path bounding the file_path input for file-reading tools
   * (e.g. create_page_from_file). Resolved ONCE at server construction by
   * the entry point; the server treats this as immutable for its lifetime,
   * matching the existing convention for `rootPageId`. Only consulted by
   * stdio-mode tools; HTTP mode does not thread this field.
   */
  workspaceRoot?: string;
}
```

**Why `workspaceRoot` lives on config, not read per-call from the env:** Codex review §3/§7. The rest of this server's process config (`NOTION_ROOT_PAGE_ID`, `NOTION_TRUST_CONTENT`) is read at entry-point startup (`src/index.ts:14-20`, `src/http.ts:79-83`) and passed through `CreateServerConfig`. Reading `NOTION_MCP_WORKSPACE_ROOT` ad hoc inside the handler would diverge from that boundary and add a per-call surprise (env var mutation mid-session would silently change the security boundary). Resolving once at startup matches the existing pattern and makes the security boundary a stable identity of the server instance.

**Design notes:**
- Name: `transport` (not `mode`, `transportKind`, `transportMode`). Rationale: the MCP SDK itself already names the concept this way — `StdioServerTransport` (`src/index.ts:3`), `StreamableHTTPServerTransport` in `http.ts`. Using `transport` stays consistent with what agents and maintainers already see in imports. `mode` is ambiguous (could mean auth mode, trust mode, debug mode); `transportKind` is a word nobody uses in the SDK.
- Default: `'stdio'` (not undefined/unset). Rationale: the stdio entry point is the historical default and the one that breaks first if someone writes an in-process test that builds `createServer({})` without a transport. Defaulting preserves that ergonomics. HTTP callers explicitly opt in.
- Optionality: kept optional to preserve backwards compatibility with any third-party code that constructs `createServer` directly (this is a published npm package).

### Tool entry type (extended)

Each tool in the top-level `tools` array (`src/server.ts:… :826`) gains an optional `transports` field. The current array uses `as const` and the tool objects are inferred structurally — the cleanest extension is to declare an explicit `ToolDefinition` type next to `CreateServerConfig`:

```ts
// A non-empty tuple type forbids the footgun `transports: []`
// (tool declared but never available anywhere). TypeScript catches it
// at registration time instead of producing a tool that disappears
// from both transports.
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Which transports this tool is available in. Absent = available in all
   * transports. Present = filtered by the configured transport.
   */
  transports?: readonly [ServerTransport, ...ServerTransport[]];
};

const tools = [
  /* existing 27 entries, unchanged */
] as const satisfies readonly ToolDefinition[];
```

**Design notes:**
- Type is `readonly ServerTransport[]`, not `Set<ServerTransport>`. A `Set` would be slightly more future-proof but adds runtime cost on every `ListTools` call and is harder to declare inline in the array literal. For a 27-entry tool list and an array of length ≤2, a linear `.includes()` check is fine and stays `as const`-compatible.
- Absent = all transports. This preserves zero-touch compatibility for every existing registration — we don't have to edit 27 tools to add a field they'd all set the same way.
- Position in the tool definition: directly after `inputSchema`, before the end-of-object brace. Consistent anchor for readers.

### `ListToolsRequestSchema` handler (modified, `src/server.ts:876-878`)

```ts
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const visible = tools
    .filter((tool) => !tool.transports || tool.transports.includes(transport))
    // Project to public Tool objects — strip the internal `transports`
    // field so it never leaks over the wire. Codex review §9: do not
    // rely on Zod output filtering for this.
    .map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  return { tools: visible };
});
```

Where `transport` is the destructured value from `config` at the top of `createServer`, with a `'stdio'` default.

### `CallToolRequestSchema` handler (modified, `src/server.ts:880-884`)

Defense-in-depth gate, inserted BEFORE the existing `switch (name)`:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const toolDef = tools.find((tool) => tool.name === name);
  if (toolDef?.transports && !toolDef.transports.includes(transport)) {
    return textResponse({
      error: `Tool '${name}' is not available in '${transport}' transport mode.`,
    });
  }

  try {
    switch (name) { /* existing cases */ }
  }
});
```

**Design notes:**
- Returns an error response (via `textResponse` — already used throughout `server.ts`), not a thrown exception. Consistent with how the file treats other user-facing errors (see the heading-not-found pattern at `:948-954`).
- Placed at the top of the handler, before the `try`. A protocol-compliant MCP client shouldn't invoke an unlisted tool — this branch exists to catch a buggy or malicious client that does.
- Unknown-tool calls fall through to the existing default case in the switch, unchanged.

### `readMarkdownFile` helper (new, in `src/read-markdown-file.ts`)

```ts
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve as pathResolve, sep, extname } from "node:path";

const MAX_FILE_BYTES = 1_048_576; // 1 MB
const ALLOWED_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Validates and reads a markdown file from disk for create_page_from_file.
 *
 * Enforces: absolute path, regular file, resolved real path contained in
 * workspaceRoot (separator-aware), size ≤ 1 MB, extension ∈ {.md, .markdown}
 * checked on the RESOLVED path, strict UTF-8 decoding.
 *
 * TOCTOU caveat: there is a race window between realpath (step 3) and the
 * read of the file contents (step 6). On a single-user stdio host the attack
 * model is weak; closing the race would require fd-based read+fstat, which
 * this module does not implement. See plan §8.
 *
 * Windows caveat: symlink resolution, junctions, and 8.3 short names may
 * produce surprising containment results. This project's CI runs on Ubuntu
 * only; Windows is not formally supported.
 */
export async function readMarkdownFile(
  filePath: string,
  workspaceRoot: string,
): Promise<string> {
  // 1. Absolute path check (cheapest bounce).
  if (!isAbsolute(filePath)) {
    throw new Error(
      `create_page_from_file: file_path must be an absolute path, got '${filePath}'`,
    );
  }

  // 2. Resolve symlinks BEFORE any further check. realpath throws ENOENT
  //    if the file does not exist — surface that as a clean error.
  let realFilePath: string;
  let realWorkspaceRoot: string;
  try {
    realFilePath = await realpath(pathResolve(filePath));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`create_page_from_file: file not found: '${filePath}'`);
    }
    throw err;
  }
  try {
    realWorkspaceRoot = await realpath(pathResolve(workspaceRoot));
  } catch (err: any) {
    throw new Error(
      `create_page_from_file: configured workspace root does not resolve: '${workspaceRoot}'`,
    );
  }

  // 3. Allowed-root containment check. Separator-aware so
  //    '/tmp/foo' is NOT accepted when the root is '/tmp/foobar'.
  const rootWithSep = realWorkspaceRoot.endsWith(sep)
    ? realWorkspaceRoot
    : realWorkspaceRoot + sep;
  if (
    realFilePath !== realWorkspaceRoot &&
    !realFilePath.startsWith(rootWithSep)
  ) {
    throw new Error(
      `create_page_from_file: file_path '${filePath}' resolves outside the allowed workspace root`,
    );
  }

  // 4. Extension check on the RESOLVED real path, not the user-supplied
  //    path. Codex review §2: symlink named 'foo.md' → '/etc/passwd' would
  //    pass a pre-realpath extension check.
  const realExt = extname(realFilePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(realExt)) {
    throw new Error(
      `create_page_from_file: file must have .md or .markdown extension (resolved path: '${realFilePath}')`,
    );
  }

  // 5. Regular-file check + size cap. isFile() rejects directories, named
  //    pipes, devices, sockets. Mirrors the pattern at
  //    src/notion-client.ts:85 for file uploads.
  const stats = await stat(realFilePath);
  if (!stats.isFile()) {
    throw new Error(
      `create_page_from_file: not a regular file: '${filePath}'`,
    );
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(
      `create_page_from_file: file size ${stats.size} exceeds ${MAX_FILE_BYTES}-byte cap`,
    );
  }

  // 6. Strict UTF-8 decode. Codex review §1: readFile(path, "utf8") does
  //    NOT reject invalid UTF-8 — it silently replaces bad bytes with
  //    U+FFFD. Use TextDecoder with fatal:true on a Buffer so binary
  //    files are actually rejected.
  const buf = await readFile(realFilePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (err: any) {
    throw new Error(
      `create_page_from_file: file is not valid UTF-8: '${filePath}'`,
    );
  }
}
```

**Design notes:**
- **Lives in its own module**, not `notion-client.ts`. Codex review §7: markdown parsing and upload processing live in `server.ts`; `notion-client.ts` is a Notion-SDK wrapper surface. Putting filesystem concerns there blurs the boundary. New module is small, focused, and testable in isolation.
- **Extension check AFTER `realpath`**: defends against a symlink named `foo.md` pointing at a non-markdown target (Codex §2).
- **`stat().isFile()` check**: rejects directories, pipes, devices, sockets. Mirrors the existing file-upload pattern at `src/notion-client.ts:85`.
- **Strict UTF-8** via `TextDecoder({ fatal: true })` on a Buffer, not `readFile(..., "utf-8")`. Codex §1 caught this: the string-encoding overload silently replaces invalid bytes with U+FFFD, so the security restriction "binary files rejected" would be false with the naive approach.
- **TOCTOU acknowledged, not fixed** — documented in JSDoc and plan §8.
- **Null bytes in path**: Node's `fs.realpath` / `fs.readFile` reject paths containing a null byte with `ERR_INVALID_ARG_VALUE`. We defer to Node.
- **File uploads inside the markdown** (`file://` URLs): NOT processed for file-sourced markdown. See §9 Q2.

### `create_page_from_file` MCP tool registration

```ts
{
  name: "create_page_from_file",
  description: `Create a Notion page from a local markdown file. The server reads the file, validates it, and creates the page — identical result to calling create_page, without shipping the file's content through the agent's context window.

STDIO MODE ONLY. This tool is not available when the server runs over HTTP, because in HTTP mode the server's filesystem belongs to the server host, not the caller.

Restrictions:
- file_path must be an ABSOLUTE path (no relative paths, no ~ expansion)
- File must be inside the configured workspace root (defaults to the server's process.cwd(); override via the NOTION_MCP_WORKSPACE_ROOT env var)
- File extension must be .md or .markdown
- File size must be ≤ 1 MB (1,048,576 bytes)
- File must be valid UTF-8
- Symlinks are resolved and the resolved path must still be inside the workspace root

Same markdown syntax as create_page (headings, tables, callouts, toggles, columns, bookmarks, task lists, etc.).`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Page title" },
      file_path: {
        type: "string",
        description: "Absolute path to a local .md or .markdown file (≤ 1 MB, UTF-8, inside the configured workspace root)",
      },
      parent_page_id: {
        type: "string",
        description: "Parent page ID. Same resolution rules as create_page.",
      },
    },
    required: ["title", "file_path"],
  },
  transports: ["stdio"],
},
```

### Handler case in `CallToolRequestSchema`

```ts
case "create_page_from_file": {
  if (!workspaceRoot) {
    return textResponse({
      error: "create_page_from_file requires workspaceRoot to be configured on the server. This tool is stdio-only.",
    });
  }
  const notion = notionClientFactory();
  const { title, file_path, parent_page_id } = args as {
    title: string;
    file_path: string;
    parent_page_id?: string;
  };

  const parent = await resolveParent(notion, parent_page_id);
  const markdown = await readMarkdownFile(file_path, workspaceRoot);
  const page = await createPage(
    notion,
    parent,
    title,
    markdownToBlocks(markdown),
  ) as any;

  const response: Record<string, unknown> = {
    id: page.id,
    title,
    url: page.url,
  };
  if (parent.type === "workspace") {
    response.note = "Created as a private workspace page. Use move_page to relocate.";
  }
  return textResponse(response);
}
```

Where `workspaceRoot` is the destructured value from `config` at the top of `createServer`.

**Design notes:**
- **`workspaceRoot` is resolved once at server construction**, not per call. See `CreateServerConfig` note above and §9 Q3. `src/index.ts` reads `process.env.NOTION_MCP_WORKSPACE_ROOT || process.cwd()` (empty-string-as-unset) and passes it through. `src/http.ts` does not pass it.
- **Missing `workspaceRoot` fallback**: defensive — if some third-party caller constructs `createServer({ transport: 'stdio' })` without `workspaceRoot`, the handler returns a clean error instead of silently using a random cwd. Not reachable via `src/index.ts` because that entry point always passes one, but this is a published npm package and the tool registration is exposed.
- **Does NOT run `processFileUploads`** on the markdown. Codex review §10 confirmed this is the right v1 call. See §9 Q2.
- **No icon/cover parameters** in v1 — §2.

---

## 5. Test behavior requirements (folded into implementation requirements)

The implementation must make these behaviors true. Not a separate "testing" section — these ARE the requirements. TDD: write the failing test first.

### Security / file-reading path (unit-testable via mocked client + tmpdir)

1. **Happy path — reads a valid `.md` file inside the allowed root, creates a page.** Given a tmpdir as allowed root, a file `{tmpdir}/fixture.md` with arbitrary markdown, and a mock client, the wrapper dispatches `client.pages.create` with `children` equal to `markdownToBlocks(fileContents)` and a `parent.page_id` matching the provided parent. Returns the mock response.
2. **Rejects relative paths.** `createPageFromFile(client, parent, title, { filePath: "./foo.md", allowedRoot })` throws a clean error mentioning "absolute path". `client.pages.create` not called.
3. **Rejects paths outside the allowed root.** Given allowedRoot = tmpdirA and filePath = tmpdirB + "/file.md" (both real .md files), the wrapper throws. Covers the "/etc/passwd when root is tmpdir" case.
4. **Rejects non-existent files with a clean ENOENT-surfaced error.** Not a raw node stack trace.
5. **Rejects files over the size cap; exactly-at-cap is accepted.** Two sibling tests: a 1,048,577-byte file rejects, a 1,048,576-byte file accepts. Assert the wrapper dispatches `client.pages.create` in the at-cap case (proves the accept path actually runs).
6. **Rejects binary files (UTF-8 decode failure surfaces as a clean error).** Write a fixture with 0xFF 0xFE 0x00 bytes; the wrapper rejects without a raw stack trace leak.
7. **Rejects symlinks inside the allowed root that resolve outside it.** Create `{tmpdir}/link.md` → `/etc/passwd` (or another tmpdir, to avoid root-privilege differences in CI). Wrapper rejects. `client.pages.create` not called.
8. **Workspace root is enforced by the configured value.** Construct a server with `workspaceRoot: tmpdirA`; drive via `McpClient + InMemoryTransport`. A fixture in `tmpdirA` is accepted; a fixture in an unrelated `tmpdirB` is rejected. This tests the value threaded through config, which is the boundary that matters — the env var reading happens in `src/index.ts`, not in the server, so it's tested at the entry-point level (see test 9).
9. **Entry-point env var wiring.** Separate test in the same file: import `src/index.ts` side-effect-free is non-trivial; the cleanest strategy is an inline assertion that exercises only the `process.env.NOTION_MCP_WORKSPACE_ROOT || process.cwd()` expression — either by extracting that resolution into a tiny exported helper (`resolveWorkspaceRoot()`) in `src/index.ts` and unit-testing the helper, or by documenting this as a "tested via runtime evidence §6 payload 2" case. **Builder's call.** The plan recommends the extracted helper — it's three lines of code and closes a real coverage gap.
10. **Rejects disallowed extensions.** `.txt`, `.json`, no extension at all → all throw with the extension-list error.
11. **Symlink prefix-match defense.** Given allowedRoot = `/tmp/root` and a fixture at `/tmp/rootbar/file.md`, the containment check must reject (not accept via naive string prefix). Covers the separator-aware check in the wrapper.

### Transport filtering (unit-testable via `McpClient + InMemoryTransport`)

Use the pattern from `tests/parent-resolution.test.ts:1-50` — construct `createServer`, connect it to a linked-pair `InMemoryTransport`, and drive it through a real `@modelcontextprotocol/sdk/client` `McpClient`. Codex review §5: do NOT invoke the registered handlers directly; that's poking SDK internals and bypasses the same Zod projection / protocol shape the real client sees.

12. **Stdio mode lists `create_page_from_file`.** Connect an `McpClient` to `createServer({ transport: 'stdio', workspaceRoot: '/tmp' })`, call `client.listTools()`, assert the returned list includes a tool named `create_page_from_file`.
13. **HTTP mode does NOT list `create_page_from_file`.** Same pattern with `transport: 'http'`, assert the tool is absent.
14. **Strengthened parity check (Codex §6).** With both servers connected, assert `httpSet == stdioSet - {"create_page_from_file"}` as a set equality, AND assert a fixed count: `stdio.length === http.length + 1`, AND spot-check a sampled handful of existing tools (`create_page`, `read_page`, `search`, `update_data_source`) appear in BOTH lists. This defeats the tautology risk (the naive "computed from the `tools` array at test time" version would pass even if the filter were broken, because it would compare the filter's output against itself).
15. **Default transport is `'stdio'`.** `createServer({ workspaceRoot: '/tmp' })` → `listTools()` includes `create_page_from_file`. Locks the default.
16. **HTTP-mode CallTool on `create_page_from_file` returns an error.** Connect to HTTP-mode server, call `client.callTool({ name: 'create_page_from_file', arguments: { title: 'x', file_path: '/tmp/whatever.md' } })`, assert the returned result contains the "not available in 'http' transport mode" error text AND the mocked `notion-client.createPage` was never called AND `readMarkdownFile` was not invoked (mock it via `vi.mock`).
17. **`transports` field never leaks to the wire.** Assert that every entry in the `client.listTools()` response has exactly the public fields (`name`, `description`, `inputSchema`) and does NOT have a `transports` property. Locks in the projection from §4 ListTools handler.
18. **`create_database` still has `is_inline`, unchanged.** Regression guard from PR #21. Parse `inputSchema.properties` on the registered tool and assert `is_inline` is present with the expected type.

### HTTP integration ripple (`tests/http-transport.test.ts`)

18. **Tool count stays 27 in HTTP mode.** `tests/http-transport.test.ts:137` is NOT bumped. The stdio-only tool is filtered out before the HTTP handler returns the list.
19. **Negative assertion added.** One new line: `expect(toolNames).not.toContain("create_page_from_file")`. This locks the filter behavior at the HTTP layer end-to-end, not just at the unit level.

### Regression guards

20. **Existing `create_page` tool unchanged.** Registration description string unchanged, handler path unchanged. Spot-check via a snapshot-style assertion or a length/field check against the `tools` array.

All unit tests use a hand-rolled mock `client` with `pages.create` as a vitest mock function, plus real filesystem operations via `fs.mkdtemp` and `fs.writeFile` in `os.tmpdir()`. No network calls. Temp dirs cleaned up in `afterEach`. Pattern mirrors the existing sibling tests in `tests/`.

---

## 6. Runtime evidence plan

The builder runs this against `NOTION_ROOT_PAGE_ID` sandbox using `NOTION_TOKEN` from `.env`. Cleanup invariant (try/finally) is non-negotiable.

### Payload 1 — happy path with realistic markdown

1. Write `/tmp/test-fixture-<timestamp>.md` with mixed content (~40–60 lines, not toy-sized): H1/H2/H3 headings, paragraph, bullet list, ordered list, code block (```ts ... ```), a callout (`> [!NOTE]`), a toggle (`+++ Summary\ncontent\n+++`), a task list with both checked and unchecked items, a table.
2. Call `create_page_from_file({ parent_page_id: '<sandbox>', title: 'E2E test for create_page_from_file', file_path: '/tmp/test-fixture-<timestamp>.md' })`.
3. Capture the new page id + URL from the response.
4. Call `read_page(page_id)` and capture the returned markdown.
5. **Assert semantically** (not byte-exactly) that the returned markdown contains all the block types from the source file. Same bar as `tests/roundtrip.test.ts`. Acceptance: every block type in the source appears in the read-back markdown.
6. Cleanup (try/finally): archive the Notion page via `archive_page`, delete the `/tmp` file.

### Payload 2 — security restrictions

For each restriction, construct the failing input, call the tool, assert an error is returned AND the Notion sandbox is unchanged (no new page under the sandbox). Specific cases:

1. **Path outside the allowed root.** Create `/tmp/outside.md` while the allowed root is set (via `NOTION_MCP_WORKSPACE_ROOT`) to a different tmpdir. Expect rejection.
2. **Relative path.** `file_path: "fixture.md"` or `"./fixture.md"`. Expect rejection.
3. **Non-existent path.** `file_path: "/tmp/does-not-exist-<timestamp>.md"`. Expect a clean "file not found" error, not a raw stack trace.
4. **Oversize file.** Generate a fixture with 1,048,577 bytes (e.g. `'A'.repeat(1_048_577)`). Expect rejection. Delete after.
5. **Binary file.** Write a small PNG (or any binary) to `/tmp/binary-<timestamp>.md`. Expect UTF-8 decode rejection.
6. **Disallowed extension.** Write `/tmp/fixture.txt` with valid markdown. Expect rejection.

Cleanup (try/finally): delete every `/tmp` fixture, whether or not its call failed. Verify no sandbox pages were created during this payload (list children of sandbox, assert count unchanged from pre-payload snapshot).

### Payload 3 — transport filtering smoke test

1. Instantiate `createServer(() => mockNotion, { transport: 'stdio' })`, invoke the `ListTools` handler, assert `create_page_from_file` is in the returned list. Capture the total count and confirm it's 28 (27 existing + new).
2. Instantiate `createServer(() => mockNotion, { transport: 'http' })`, invoke `ListTools`, assert `create_page_from_file` is NOT in the list. Confirm count is 27.
3. In the HTTP-mode server, invoke `CallTool` with name = `create_page_from_file` and assert the returned response contains an error mentioning "not available in 'http' transport mode" (or equivalent). Confirm no network calls to the mock Notion client were made.

Payload 3 is mechanical and can run via the existing test infrastructure — builder's call whether to add it as a new integration test file or fold into `tests/create-page-from-file.test.ts`.

**Runtime evidence is a gating requirement.** Per orchestrator policy: "for any project whose value lives in interaction with external systems, runtime evidence is required." Builder must capture payloads 1–3 before reporting completion.

---

## 7. Tool description — final draft

See §4 — the description block inside the `create_page_from_file` tool registration. Key properties:

- **First sentence names the purpose** (create a Notion page from a local markdown file) and the benefit (no content through the agent's context window).
- **Second paragraph names the transport constraint** (STDIO MODE ONLY) and why, in one sentence.
- **Bulleted restriction list** covers every security rule enforced by the wrapper, so agents can predict failures without round-tripping through the server.
- **Last sentence points back at `create_page`** for markdown-syntax parity, so we don't duplicate the full syntax list.

Intentionally **does not** mention:
- `icon`/`cover` (not in this PR, §2)
- `file://` uploads within the markdown (not processed for this tool, §5 Q2)
- Exact byte count math beyond "≤ 1 MB (1,048,576 bytes)"

---

## 8. Risks and open questions

### Risk — UTF-8 decoding must be strict

Node's `fs.readFile(path, "utf-8")` does NOT reject invalid UTF-8 sequences — it silently replaces them with the Unicode replacement character U+FFFD. This means the naive "just use the string overload" approach would quietly corrupt binary files instead of rejecting them, and the §5 test 6 assertion would be false. The wrapper must read the file as a `Buffer` and decode via `new TextDecoder("utf-8", { fatal: true })`, which throws on invalid sequences. Caught by Codex review §1; reflected in §4 and §5 test 6.

### Risk — TOCTOU between `realpath` and `readFile`

Between step 3 (`realpath`) and step 6 (`readFile`) in the wrapper, an attacker with write access to the filesystem could swap a validated symlink for a new one pointing outside the allowed root. On a single-user stdio host this requires the attacker to already be the user, so they can trivially invoke the tool with an absolute path anyway. On a multi-user host running the MCP server as a shared service, this would matter — but the whole point of the stdio-only gating is that we're not in that mode. Documented in JSDoc, not mitigated.

### Risk — `process.cwd()` as default allowed root

If the server is launched from `/` or `/tmp` or from the user's home directory, the default allowed root becomes very permissive. This is not a mitigation failure — it's the agent's filesystem boundary, and we're explicitly not trying to sandbox it — but it's worth documenting in the tool description and in CLAUDE.md. Agents and humans who care about a tighter boundary set `NOTION_MCP_WORKSPACE_ROOT` explicitly.

### Risk — new pattern fragmentation

Introducing the `transports` field creates two "kinds" of tool registration (declared vs. undeclared). Future contributors must remember to reason about transport gating when adding tools. Mitigation: a single documented pattern in CLAUDE.md (§9 Q5), and the default-to-all-transports semantics means the right answer for "unsure" tools is also the default — no footgun.

### Risk — symlink check bypass on Windows

`fs.realpath` normalizes case and resolves symlinks on Windows, but Windows also has junctions, 8.3 short names, and case-insensitivity quirks that could theoretically produce surprising containment checks. This project doesn't currently claim Windows support (`node dist/index.js` in CLAUDE.md Commands, CI runs Ubuntu). Document as a known limitation in JSDoc; if Windows support is ever formally promised, revisit.

### Risk — future growth of the `transports` field

If more tools are added with different transport constraints, the filter logic stays O(n) on tool count but the data model remains simple. If someone wants per-transport *handler variants*, the current shape does not support that — they'd need to restructure. Not a concern for this PR; worth flagging so a future reviewer doesn't over-index on this pattern.

### Risk — the existing `create_page` description already lists 15+ bullets

Agents may still reach for `create_page` by default and never learn about the new tool. Counter: this PR deliberately does NOT mention `create_page_from_file` in the `create_page` description (§9 Q6). A follow-up README/docs PR can surface the motivation properly without bloating every tool string.

### Risk — agent mental model: "markdown is fast, files are slow"

The user benefit (no content through context) is invisible to agents. Agents will pick based on the description text. The description's first sentence emphasizes "without shipping the file's content through the agent's context window" precisely so future agents reading it can map the tool to their own cost model. Whether this lands behaviorally is an empirical question — flag for a post-ship check.

---

## 9. Open questions (decisions this plan makes; flagged for human override)

### Q1 — Single PR vs. two PRs?

**Decision: single PR.** Reasoning:
- The infrastructure is *motivated* by a specific feature. Reviewing it in isolation forces the reviewer to guess at the use case.
- The `transports` field with default = all-transports is zero-touch for existing tools, so the infrastructure risk is low.
- Splitting creates a PR ordering dependency + a rebase cost for no real clarity benefit — the two commits inside one PR give reviewers the exact same visual separation.

Alternative considered: two PRs, infrastructure first (10 LoC, trivial), feature second. Rejected — YAGNI on infrastructure without a consumer.

### Q2 — Run `processFileUploads` on file-sourced markdown?

**Decision: no.** The existing `create_page` handler runs `processFileUploads(notion, markdown)` to resolve `file://` URLs to Notion file uploads. For the first revision of `create_page_from_file`, we skip this step. Reasons:
- It compounds the security surface: `processFileUploads` reads files from the filesystem, and every `file://` URL embedded in the markdown becomes a second file-read that must be validated against the allowed root. The security story doubles in complexity for a feature we haven't confirmed agents want.
- Agents that need embedded uploads can continue to use the existing `create_page` tool and pay the context cost deliberately.
- Trivial to add in a follow-up PR once there's demand evidence.

Flag for follow-up: if usage data shows agents consistently wanting embedded uploads, revisit. The wrapper has a clean seam at the `markdownToBlocks(markdown)` line where `processFileUploads` could slot in.

### Q3 — Env var name: `NOTION_MCP_WORKSPACE_ROOT`

**Decision: `NOTION_MCP_WORKSPACE_ROOT`.** Reasoning:
- Every existing env var in CLAUDE.md's Environment section starts with `NOTION_`. Breaking the prefix would surprise maintainers.
- The `_MCP_` infix signals "this is MCP-server config, not Notion API config" — similar to how `NOTION_TRUST_CONTENT` is server-behavior config, not API auth.
- `WORKSPACE_ROOT` communicates "bounds a local filesystem area" more clearly than `FILE_ROOT` (which sounds like a specific file) or `FILE_BASE_PATH` (which sounds Notion-API-related).

Rejected: `EASY_NOTION_MCP_WORKSPACE_ROOT` (too long, diverges from the `NOTION_*` prefix), `NOTION_MCP_FILE_ROOT` (less clear about intent).

**Also decided (revised after Codex review §3/§7):** env var is read **at server construction time** in `src/index.ts` and threaded through `CreateServerConfig.workspaceRoot`, not read per call. First draft had it at handler-call time; Codex pointed out this diverges from how every other process config value is handled in this server (`NOTION_ROOT_PAGE_ID`, `NOTION_TRUST_CONTENT`) and introduces a per-call surprise (env var mutation mid-session would silently change the security boundary). Resolution at startup matches the existing pattern and makes the boundary a stable identity of the server instance. Accepted without overrule.

### Q4 — Extension check

**Decision: `.md` and `.markdown` only.** Reasoning:
- This server's entire purpose is markdown → Notion blocks. Other formats don't have a meaningful conversion path; accepting them would just produce a confusing failure downstream.
- An allowlist is easier to reason about than a denylist or a "sniff content" approach.
- Clean error message points agents at the exact fix.

Rejected: (b) accept any extension — invites silent corruption when an agent passes a `.txt` file containing non-markdown. (c) configurable allowlist — premature configuration knob; revisit if demand appears.

### Q5 — CLAUDE.md update?

**Decision: yes, two targeted additions. Both architectural, not feature-inventory.**

The previous plan dropped a CLAUDE.md edit on Codex's push-back because it was feature churn. The rule that applies: CLAUDE.md edits should reflect *architectural decisions or environment variables agents/maintainers need to know about*, not tool inventory.

Two proposed additions:

**Addition 1 — Environment > Stdio mode section, new line after `NOTION_TRUST_CONTENT`:**

```
- `NOTION_MCP_WORKSPACE_ROOT` (optional, stdio only) — absolute path that bounds file_path inputs for the `create_page_from_file` tool. Defaults to the server's process.cwd(). Has no effect in HTTP mode.
```

**Addition 2 — Key decisions section, new bullet:**

```
- **Transport-conditional tools** — tools can declare a `transports: ['stdio' | 'http']` list to restrict where they appear. Tools without the field are available in all transports. File-reading tools (e.g. `create_page_from_file`) are stdio-only because HTTP-mode callers don't share the server's filesystem.
```

Rationale: the env var IS user-facing config that agents and operators will set — belongs next to the other env vars. The transport-gating pattern IS an architectural decision with a reusable shape — belongs in Key decisions alongside `createServer` factory pattern and the markdown-as-interface decision. Neither addition is "here's a new tool we added."

**Defer to human if they see this as churn.** Precedent from the `update_data_source` plan says to err toward not touching CLAUDE.md. These two additions are defensible under the exception but reasonable people might draw the line differently.

### Q6 — Mention the file-based variant in `create_page` description?

**Decision: no.** Reasoning:
- The `create_page` description is already ~15 bullets of markdown syntax. Adding a cross-reference bloats a tool description that's already near the limit of what agents parse attentively.
- In HTTP mode, such a mention would point at a tool the client can't actually use — actively misleading.
- Tool listings are flat; agents see `create_page_from_file` right next to `create_page` in `list_tools`. Cross-referencing is redundant.

Counter-argument (rejected): agents might not notice the file-based variant exists. Empirical question — worth checking post-ship, but not worth preemptively bloating the description.

### Q7 — Tool description language

Locked in §4 and §7. Short, explicit about stdio-only, explicit about absolute paths + size cap + UTF-8. No CRITICAL warnings (nothing destructive about this tool — it only ever creates, never deletes or overwrites).

---

## 10. Out of scope / follow-ups

- **`append_content_from_file`, `update_section_from_file`, `replace_content_from_file`** — the same `_from_file` shape applies to these tools. Each is its own small PR, same security wrapper, same transport gating. Not bundled here — one coherent idea per PR.
- **`create_database_from_file`** — same shape, different target. Defer.
- **Batch / directory import.** A `create_pages_from_directory` would let agents transfer a whole folder of markdown with one call. Non-trivial: needs per-file error reporting, partial-failure semantics, and possibly rate-limit pacing. Defer.
- **`file://` uploads inside file-sourced markdown.** See §9 Q2. Clean seam in the wrapper where it could slot in; revisit with usage data.
- **Per-user workspace root in HTTP mode.** If we ever decide to ship a file-reading tool in HTTP mode with a per-session allowed root, this is where the design discussion starts. The current PR does not open that door.
- **Windows path quirks.** If Windows support is formally promised, revisit the `realpath` + prefix-match approach.
- **README section for the file-based variant and its motivation.** Docs PR, not this one.
- **`icon` / `cover` parameters on the new tool.** Trivial add; wait for demand.

---

## 11. PR body draft

**Title:** `feat: add create_page_from_file (stdio-only) + transport-conditional tool registration`

**Body:**

```markdown
## Summary

- Introduces a new `create_page_from_file` MCP tool: a stdio-only variant of `create_page` that takes a local file path. The server reads the file, validates it against security restrictions (absolute path, workspace-root containment, ≤ 1 MB, UTF-8, `.md`/`.markdown` only), and dispatches through the existing `createPage` markdown-to-blocks pipeline. Saves the agent ~90–150K tokens of context on large-document transfers.
- Introduces a `transports` field on tool registrations (`transports?: ['stdio' | 'http']`, absent = all transports) and filters `list_tools` + `call_tool` at the server layer. Existing 27 tools are untouched — they remain available in both transports.
- New `transport` field on `CreateServerConfig`, set to `'stdio'` by `src/index.ts` and `'http'` by `src/http.ts`.

## Why

- Earlier session burned ~90–150K tokens transferring large markdown files into Notion via `Read` + `create_page(content=...)`. The content passed through agent context twice for purely mechanical work. A file-based variant eliminates that entirely — the agent sends three short strings and the content stays in the server process.
- The security story only works for stdio mode (shared filesystem between caller and server). HTTP/OAuth mode runs the server elsewhere, so a caller-specified `file_path` would let a remote caller read arbitrary files from the server host. Hence the transport gating.

## Security restrictions on the file-reading path

- `file_path` must be absolute (relative paths rejected)
- Resolved real path (after `fs.realpath`, which defeats symlink escape) must be inside the configured workspace root
- Workspace root defaults to `process.cwd()`; override via `NOTION_MCP_WORKSPACE_ROOT`
- File size ≤ 1 MB (1,048,576 bytes)
- UTF-8 only (binary files rejected by Node's decode path)
- Extension ∈ {`.md`, `.markdown`}

TOCTOU race between `realpath` and `readFile` is documented and not mitigated — on a single-user stdio host, the attacker is already the user. See wrapper JSDoc + `.meta/plans/create-page-from-file-2026-04-15.md` §8.

## Scope explicitly excluded

- No `append_content_from_file` / other `_from_file` siblings
- No `file://` upload processing inside file-sourced markdown (clean follow-up seam)
- No batch / directory import
- No refactor of `markdownToBlocks` or `createPage`
- No dependency bumps, no `package.json` / version changes

## Test plan

- [ ] `npm run build` passes (tsc clean)
- [ ] `npm test` passes — new `tests/create-page-from-file.test.ts` covers: happy path, absolute-path enforcement, workspace-root containment, ENOENT, size cap (under / exactly / over), binary UTF-8 rejection, symlink escape, extension allowlist, `NOTION_MCP_WORKSPACE_ROOT` override, `process.cwd()` default, and transport filtering (stdio includes / http excludes / http call returns error response)
- [ ] `tests/http-transport.test.ts` tool count stays 27, with new negative assertion on `create_page_from_file`
- [ ] Runtime evidence against `NOTION_ROOT_PAGE_ID` sandbox:
  - [ ] Happy path: create a page from a ~40–60-line fixture, round-trip via `read_page`, semantically verify all block types
  - [ ] Security payloads: path outside root / relative / non-existent / oversize / binary / wrong extension — all rejected, no sandbox side effects
  - [ ] Transport smoke: stdio sees 28 tools, http sees 27, http call on `create_page_from_file` returns an error response
- [ ] Cleanup invariant held (try/finally): all `/tmp` fixtures deleted, all test pages archived
- [ ] CI green on Node 18 + 20
```

---

## 12. Codex review notes

**Review sessions:**
- `plan-review-create-page-from-file-2026-04-15` (first attempt, timed out at 5 min)
- `plan-review-cpff-2026-04-15-v2` (fresh dispatch, completed — codex, reasoningEffort: high)

Codex's review was dense and largely accepted. Nothing was overruled on substance; one framing was adjusted. Summary of changes folded into the plan, roughly in severity order:

1. **HIGH — UTF-8 decoding was wrong as drafted.** First draft used `fs.readFile(path, "utf-8")` and asserted that binary files would be rejected. Codex §1 pointed out that the string-encoding overload silently replaces invalid bytes with U+FFFD — it does not throw. The "reject binary files" security restriction would have been false. **Fix:** the helper now reads the file as a `Buffer` and decodes via `new TextDecoder("utf-8", { fatal: true })`. §4 `readMarkdownFile` updated, §5 test 6 unchanged in intent but now actually testable, §8 new risk section added.

2. **MEDIUM — Security list had two gaps.** Codex §2: (a) no regular-file check (directories, pipes, devices would pass), (b) extension check applied BEFORE `realpath`, so a symlink named `foo.md` pointing at `/etc/passwd` would pass the gate. **Fix:** §4 now runs `stat().isFile()` (mirrors the existing pattern at `src/notion-client.ts:85`) and runs the extension check on the **resolved real path** after `realpath`, not on the user-supplied path.

3. **MEDIUM — `workspaceRoot` read boundary was wrong.** Codex §3: first draft read `process.env.NOTION_MCP_WORKSPACE_ROOT` inside the handler at call time. Every other piece of process config in this server is read at entry-point startup and threaded through `CreateServerConfig`. Reading per-call diverges from that convention and makes the security boundary silently mutable (env var change mid-session). **Fix:** new `workspaceRoot?: string` field on `CreateServerConfig`, resolved once in `src/index.ts` as `process.env.NOTION_MCP_WORKSPACE_ROOT || process.cwd()` and threaded through. `src/http.ts` does not pass it. §4 `CreateServerConfig` + handler snippet updated, §9 Q3 decision flipped.

4. **MEDIUM — Empty-string env var edge case.** Codex §4: `process.env.FOO ?? fallback` treats an empty string as "set", so `FOO=""` would become an empty workspace root that fails downstream. **Fix:** entry point uses `||`, not `??`. Moot for the handler since the handler no longer reads the env var, but called out in §3 file table so the builder uses the right operator.

5. **MEDIUM — Wrapper placement was wrong.** Codex §7: first draft put `createPageFromFile` in `src/notion-client.ts`, but the markdown-to-blocks pipeline actually lives in `server.ts`, not `notion-client.ts`. Moving it into the SDK wrapper module would blur a clean boundary (notion-client = Notion SDK surface; server = protocol + pipeline). **Fix:** new `src/read-markdown-file.ts` module owns filesystem validation + strict UTF-8 decode. The server handler dispatches through the existing `markdownToBlocks(...) → createPage(...)` path used by `create_page`. `notion-client.ts` is NOT touched in this PR. §3 file table and §4 sections rewritten.

6. **MEDIUM — Test strategy was poking internals.** Codex §5: first draft said "invoke the registered handler directly." Better path is `McpClient + InMemoryTransport` from `tests/parent-resolution.test.ts:1-50`, which drives the server through the real SDK protocol path. **Fix:** §5 tests 12–17 rewritten to use the linked-pair pattern; test 17 added to assert the internal `transports` field never leaks to the wire.

7. **MEDIUM — Parity check was tautological.** Codex §6: "computed from the tools array at test time" would pass even if the filter were broken. **Fix:** §5 test 14 strengthened to assert `httpSet == stdioSet - {"create_page_from_file"}` AND a fixed count delta AND spot-checks on a sampled handful of existing tool names.

8. **LOW — `transports` field may leak over the wire.** Codex §9: don't rely on Zod output filtering; project each internal tool entry to the public `{ name, description, inputSchema }` shape before returning from the ListTools handler. **Fix:** §4 ListTools handler now projects explicitly, and §5 test 17 locks it.

9. **LOW — Empty `transports: []` is a footgun.** Codex §8: a tool declared with `transports: []` would silently disappear from every transport. **Fix:** field type narrowed to `readonly [ServerTransport, ...ServerTransport[]]` (non-empty tuple), so TypeScript rejects the empty-array case at registration.

10. **LOW — `satisfies` vs cast.** Codex §8: prefer `as const satisfies readonly ToolDefinition[]` over a type annotation on the array, so the existing `as const` inference is preserved. **Fix:** §4 tool entry type snippet updated.

11. **LOW — `file://` upload subset disclosure.** Codex §10: note explicitly in the tool description that file-sourced markdown does NOT process `file://` upload URLs (the existing `create_page` tool does). **Fix:** added to §7 tool description draft, noted in §9 Q2.

**Agreements without disagreement:**
- Single PR with two commits (§9 Q1). Codex §12 confirmed this is defensible because the transport filter exists only to support this tool.
- `.md` / `.markdown` extension gate (§9 Q4). Codex §11 concurred.
- CLAUDE.md additions (§9 Q5). Codex §13 said the env-var line is warranted; the transport-gating note is acceptable if phrased as a generic architectural rule, not feature prose. **Accepted as drafted** — both lines are at the pattern level, not tool-inventory.
- Defense-in-depth CallTool gate (not redundant with ListTools filter). Codex §14 confirmed.
- `process.cwd()` default is an acceptable trade-off. Codex did not push back.
- Deferring `processFileUploads` from v1. Codex §10 confirmed.

**No overrules.** Every concern Codex raised was grounded in actual file reads (Codex traced the tool-array structure, the SDK version, the existing InMemoryTransport test pattern, and the file-upload module) and the plan is materially stronger as a result. This plan is the second-pass plan after a full revision cycle.

**Final verdict from Codex:** `minor-revision`. All minor revisions folded in; this plan should read as ready for the builder.

---

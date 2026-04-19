# Boundary Validation Sweep (Pass 5)

## Checked, no finding

### `create_page_from_file` validation points present in code

- Absolute path required: [src/read-markdown-file.ts:12](../../src/read-markdown-file.ts#L12)-[16](../../src/read-markdown-file.ts#L16)
- Symlinks resolved before containment check: [src/read-markdown-file.ts:18](../../src/read-markdown-file.ts#L18)-[35](../../src/read-markdown-file.ts#L35)
- Resolved path must stay inside resolved workspace root: [src/read-markdown-file.ts:37](../../src/read-markdown-file.ts#L37)-[48](../../src/read-markdown-file.ts#L48)
- Extension restricted to `.md` / `.markdown` on the resolved path: [src/read-markdown-file.ts:50](../../src/read-markdown-file.ts#L50)-[56](../../src/read-markdown-file.ts#L56)
- Regular-file and `<= 1 MB` size check before read: [src/read-markdown-file.ts:58](../../src/read-markdown-file.ts#L58)-[69](../../src/read-markdown-file.ts#L69)
- UTF-8 decode uses `TextDecoder(..., { fatal: true })`: [src/read-markdown-file.ts:71](../../src/read-markdown-file.ts#L71)-[79](../../src/read-markdown-file.ts#L79)
- Tool advertised as stdio-only: [src/server.ts:462](../../src/server.ts#L462)-[492](../../src/server.ts#L492)
- Tool hidden from HTTP `tools/list`: [src/server.ts:926](../../src/server.ts#L926)-[935](../../src/server.ts#L935)
- Tool call rejected in HTTP transport even if invoked directly: [src/server.ts:940](../../src/server.ts#L940)-[945](../../src/server.ts#L945)
- HTTP server creates the MCP server with `transport: "http"`: [src/http.ts:79](../../src/http.ts#L79)-[84](../../src/http.ts#L84)

### On-paper break attempts that do not obviously bypass the current checks

- `..` traversal after normalization: blocked by `pathResolve()` + `realpath()` before containment ([src/read-markdown-file.ts:22](../../src/read-markdown-file.ts#L22), [30](../../src/read-markdown-file.ts#L30), [41](../../src/read-markdown-file.ts#L41)-[44](../../src/read-markdown-file.ts#L44))
- Static symlink escape: blocked because target is resolved before the inside-root check ([src/read-markdown-file.ts:22](../../src/read-markdown-file.ts#L22)-[23](../../src/read-markdown-file.ts#L23), [41](../../src/read-markdown-file.ts#L41)-[46](../../src/read-markdown-file.ts#L46))
- Double-slash / trailing-slash normalization: handled by `pathResolve()` / `realpath()` and separator-aware prefixing ([src/read-markdown-file.ts:22](../../src/read-markdown-file.ts#L22), [30](../../src/read-markdown-file.ts#L30), [38](../../src/read-markdown-file.ts#L38)-[43](../../src/read-markdown-file.ts#L43))
- Extension check vs actual content: intentionally extension-based, then UTF-8-validated; no content sniffing, but no direct bypass shown ([src/read-markdown-file.ts:50](../../src/read-markdown-file.ts#L50)-[56](../../src/read-markdown-file.ts#L56), [71](../../src/read-markdown-file.ts#L71)-[79](../../src/read-markdown-file.ts#L79))
- UTF-8 BOM: accepted as valid UTF-8 and preserved in content; this is behavior, not a bypass ([src/read-markdown-file.ts:74](../../src/read-markdown-file.ts#L74))
- Windows path handling: uses platform `node:path` helpers (`isAbsolute`, `resolve`, `sep`, `extname`), so no obvious path-separator bug from code inspection ([src/read-markdown-file.ts:2](../../src/read-markdown-file.ts#L2), [12](../../src/read-markdown-file.ts#L12), [22](../../src/read-markdown-file.ts#L22), [38](../../src/read-markdown-file.ts#L38), [51](../../src/read-markdown-file.ts#L51))

## Findings

### BV-1: HTTP `file://` handling permits server-host file exfiltration
**Category:** url
**Severity hypothesis:** critical
**Attack or failure scenario:** "An HTTP caller can make the server read arbitrary host files and upload them into Notion because HTTP-exposed tools still honor `file://` paths with no transport gate or workspace-root bound."
**Validation gap:** `create_page`, `append_content`, `replace_content`, and `update_section` all call `processFileUploads(...)` in HTTP mode at [src/server.ts:964](../../src/server.ts#L964), [1013](../../src/server.ts#L1013), [1023](../../src/server.ts#L1023), and [1074](../../src/server.ts#L1074). `update_page` also accepts `cover` values starting with `file://` at [src/server.ts:1185](../../src/server.ts#L1185)-[1187](../../src/server.ts#L1187). `processFileUploads()` extracts `file://` URLs and forwards them to `uploadFile()` at [src/file-upload.ts:63](../../src/file-upload.ts#L63)-[80](../../src/file-upload.ts#L80). `uploadFile()` converts the URL to a local path and reads it directly with no root check at [src/notion-client.ts:79](../../src/notion-client.ts#L79)-[100](../../src/notion-client.ts#L100).
**Bypass:** `create_page({ title: "x", markdown: "[loot](file:///etc/passwd)" })` or `update_page({ page_id: "...", cover: "file:///home/app/.ssh/id_rsa" })` over `/mcp`.
**Fix sketch:** Disable `file://` handling in HTTP transport, or gate it behind the same stdio-only + workspace-root enforcement used for `create_page_from_file`.
**Steelman:** In stdio mode, `file://` is a legitimate local convenience feature because the caller and server share a filesystem.
**Confidence:** high
**Test coverage:** [tests/file-upload.test.ts:60](../../tests/file-upload.test.ts#L60)-[101](../../tests/file-upload.test.ts#L101) covers parsing/replacement only; there is no transport-boundary test here.

### BV-2: Static-token HTTP mode exposes `/mcp` with no caller authentication
**Category:** http-auth
**Severity hypothesis:** high
**Attack or failure scenario:** "An HTTP caller can operate the server with the configured Notion integration token because static-token mode mounts `/mcp` without bearer auth."
**Validation gap:** OAuth mode protects `/mcp` with `requireBearerAuth(...)` at [src/http.ts:173](../../src/http.ts#L173)-[185](../../src/http.ts#L185), but static-token mode mounts the same routes without any auth middleware at [src/http.ts:189](../../src/http.ts#L189)-[195](../../src/http.ts#L195).
**Bypass:** `POST /mcp` with an `initialize` request and no `Authorization` header, then call tools normally.
**Fix sketch:** Require an inbound auth layer in static-token mode too, or refuse to start unless bound to localhost / behind a trusted proxy.
**Steelman:** This may be an intentional localhost-only mode for desktop clients or a reverse-proxy deployment that adds auth out of band.
**Confidence:** high
**Test coverage:** [tests/http-transport.test.ts:45](../../tests/http-transport.test.ts#L45)-[146](../../tests/http-transport.test.ts#L146) explicitly exercises unauthenticated `/mcp` access in static-token mode.

### BV-3: `create_page_from_file` has a TOCTOU gap between validation and read
**Category:** path
**Severity hypothesis:** medium
**Attack or failure scenario:** "A local attacker who can modify files in the allowed workspace can swap the checked file after `realpath()` / `stat()` but before `readFile()`, bypassing the size/root decision made earlier."
**Validation gap:** The code resolves and validates the path first at [src/read-markdown-file.ts:22](../../src/read-markdown-file.ts#L22)-[56](../../src/read-markdown-file.ts#L56), stats it at [59](../../src/read-markdown-file.ts#L59)-[69](../../src/read-markdown-file.ts#L69), then reopens by pathname for the actual read at [72](../../src/read-markdown-file.ts#L72)-[74](../../src/read-markdown-file.ts#L74). No file descriptor is held across validation and read.
**Bypass:** Start with `workspaceRoot/note.md` as a small regular file. After `stat()` returns but before `readFile()` runs, replace `note.md` with a symlink to `/etc/passwd` or with a much larger file.
**Fix sketch:** Open the file once with nofollow semantics, validate via `fstat()`, and read from that same descriptor; alternatively re-`realpath` / re-`stat` and compare inode/device immediately before reading.
**Steelman:** The tool is stdio-only, so exploitation requires local filesystem write access and tight timing.
**Confidence:** high
**Test coverage:** [tests/create-page-from-file.test.ts:114](../../tests/create-page-from-file.test.ts#L114)-[209](../../tests/create-page-from-file.test.ts#L209) covers static symlink escape and size checks, but not a race.

### BV-4: Workspace-root fallback can degenerate to the whole filesystem
**Category:** path
**Severity hypothesis:** low
**Attack or failure scenario:** "A stdio caller can read any absolute markdown file on the host if `NOTION_MCP_WORKSPACE_ROOT` is unset/empty and the process starts with `/` (or a drive root) as `cwd`, because the fallback root becomes effectively unbounded."
**Validation gap:** Stdio startup sets `workspaceRoot` from `process.env.NOTION_MCP_WORKSPACE_ROOT || process.cwd()` at [src/index.ts:20](../../src/index.ts#L20). An empty env var therefore falls through to `cwd`. The containment check then accepts any resolved file under that root at [src/read-markdown-file.ts:41](../../src/read-markdown-file.ts#L41)-[46](../../src/read-markdown-file.ts#L46).
**Bypass:** Launch the server from `/` with `NOTION_MCP_WORKSPACE_ROOT=""`, then call `create_page_from_file` with `file_path="/etc/notes.md"`.
**Fix sketch:** Require an explicit non-root workspace root for this tool, or reject `/` / drive-root fallbacks.
**Steelman:** The README and tool description explicitly document the `cwd` fallback, and the tool is not exposed over HTTP.
**Confidence:** high
**Test coverage:** [tests/create-page-from-file.test.ts:213](../../tests/create-page-from-file.test.ts#L213)-[341](../../tests/create-page-from-file.test.ts#L341) covers transport filtering, but there is no test for empty env or root-directory fallback.

### BV-5: Token-store writes are not concurrency-safe
**Category:** token-store
**Severity hypothesis:** medium
**Attack or failure scenario:** "Two concurrent token issuances or refreshes can clobber each other because each request loads the whole file, mutates an in-memory array, and overwrites the file with no lock."
**Validation gap:** `storeToken()` and the delete methods use a load-modify-save cycle at [src/auth/token-store.ts:78](../../src/auth/token-store.ts#L78)-[88](../../src/auth/token-store.ts#L88) and [100](../../src/auth/token-store.ts#L100)-[109](../../src/auth/token-store.ts#L109) with no mutex, append-only log, or atomic merge. The OAuth provider performs back-to-back writes during auth-code exchange and refresh at [src/auth/oauth-provider.ts:298](../../src/auth/oauth-provider.ts#L298)-[319](../../src/auth/oauth-provider.ts#L319) and [393](../../src/auth/oauth-provider.ts#L393)-[402](../../src/auth/oauth-provider.ts#L402).
**Bypass:** Send two `/token` exchanges or refreshes at nearly the same time; whichever save runs last wins, and the other record can disappear.
**Fix sketch:** Serialize token-store mutations with a process-local mutex and atomic temp-file rename, or move persistence to SQLite.
**Steelman:** Many self-hosted deployments are effectively single-user and will rarely hit concurrent token writes.
**Confidence:** high
**Test coverage:** [tests/token-store.test.ts:36](../../tests/token-store.test.ts#L36)-[127](../../tests/token-store.test.ts#L127) covers sequential persistence only.

### BV-6: Token-store corruption is treated as an empty database
**Category:** token-store
**Severity hypothesis:** low
**Attack or failure scenario:** "A corrupted or partially written token file silently becomes `[]`, and the next successful write overwrites the store, invalidating all previously issued bearer/refresh tokens."
**Validation gap:** `load()` catches every read/decrypt/parse error and returns an empty array at [src/auth/token-store.ts:62](../../src/auth/token-store.ts#L62)-[69](../../src/auth/token-store.ts#L69).
**Bypass:** Truncate or corrupt `tokens.json`, or crash during a write, then let the next token mutation run.
**Fix sketch:** Fail closed on corruption, preserve the bad file for recovery, and use atomic writes plus fsync.
**Steelman:** Returning `[]` keeps the server from crashing on startup and may be acceptable for a disposable local auth cache.
**Confidence:** high
**Test coverage:** [tests/token-store.test.ts:129](../../tests/token-store.test.ts#L129)-[132](../../tests/token-store.test.ts#L132) covers an empty store, not a corrupted encrypted store.

## Notes on other hunt-list items

- `/mcp` auth in OAuth mode is present and correct: [src/http.ts:173](../../src/http.ts#L173)-[185](../../src/http.ts#L185), [node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/middleware/bearerAuth.js:10](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/middleware/bearerAuth.js#L10)-[37](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/middleware/bearerAuth.js#L37)
- `/register`, `/token`, and metadata endpoints are public because the SDK router mounts them publicly by design at [node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/router.js:61](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/router.js#L61)-[83](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/router.js#L83)
- The SDK auth endpoints do have built-in rate limiting and permissive CORS:
  - `/register`: [node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/register.js:15](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/register.js#L15)-[28](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/register.js#L28)
  - `/token`: [node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.js:26](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.js#L26)-[39](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.js#L39)
  - metadata: [node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/metadata.js:7](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/metadata.js#L7)-[12](../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/metadata.js#L12)
- `/mcp` itself has no explicit rate limiting or body-size override in app code: [src/http.ts:33](../../src/http.ts#L33), [43](../../src/http.ts#L43)-[117](../../src/http.ts#L117), [183](../../src/http.ts#L183)-[195](../../src/http.ts#L195)
- `NOTION_TOKEN` empty and unset are treated the same on stdio startup (`!NOTION_TOKEN`): [src/index.ts:7](../../src/index.ts#L7)-[10](../../src/index.ts#L10). HTTP startup also only checks truthiness: [src/http.ts:204](../../src/http.ts#L204)-[209](../../src/http.ts#L209)
- `NOTION_ROOT_PAGE_ID`, `PORT`, and `OAUTH_REDIRECT_URI` are not format-validated in app code; from inspection this looks more like fail-late configuration hygiene than a security boundary break:
  - root page ID passed through: [src/index.ts:17](../../src/index.ts#L17), [src/http.ts:216](../../src/http.ts#L216), [src/server.ts:905](../../src/server.ts#L905)-[906](../../src/server.ts#L906)
  - `PORT` uses `parseInt(...)` with no `NaN` / range check: [src/http.ts:9](../../src/http.ts#L9), [154](../../src/http.ts#L154), [220](../../src/http.ts#L220)
  - `OAUTH_REDIRECT_URI` passed through with no validation: [src/http.ts:13](../../src/http.ts#L13)-[14](../../src/http.ts#L14), [143](../../src/http.ts#L143)-[147](../../src/http.ts#L147)
- External `http(s)` image/embed/bookmark URLs are not fetched server-side; they are only passed through if `isSafeUrl(...)` allows them:
  - safe URL check: [src/markdown-to-blocks.ts:11](../../src/markdown-to-blocks.ts#L11)-[18](../../src/markdown-to-blocks.ts#L18)
  - image external pass-through: [src/markdown-to-blocks.ts:455](../../src/markdown-to-blocks.ts#L455)-[475](../../src/markdown-to-blocks.ts#L475)
  - embed pass-through: [src/markdown-to-blocks.ts:495](../../src/markdown-to-blocks.ts#L495)-[499](../../src/markdown-to-blocks.ts#L499)
  - bookmark pass-through: [src/markdown-to-blocks.ts:502](../../src/markdown-to-blocks.ts#L502)-[510](../../src/markdown-to-blocks.ts#L510)
- I did not find direct logging of `NOTION_TOKEN`, `NOTION_OAUTH_CLIENT_SECRET`, or bearer headers. The main residual logging concern is broad `console.error(..., error)` on tool failures at [src/server.ts:1418](../../src/server.ts#L1418)-[1421](../../src/server.ts#L1421), which can log raw error objects but does not obviously include auth headers from the Notion SDK.

## Verification

- Targeted tests passed: `tests/create-page-from-file.test.ts`, `tests/http-transport.test.ts`, `tests/token-store.test.ts`

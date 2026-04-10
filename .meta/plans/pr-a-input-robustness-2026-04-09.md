# PR A — Input Robustness & `--check` Doctor Command

**Target repo:** `easy-notion-mcp` (v0.2.0)
**Branch suggestion:** `pr-a-input-robustness`
**Author of plan:** Planner PM
**Audit reference:** `.meta/audits/url-as-id-errors-2026-04-09.md`
**Build discipline:** TDD. Every src file is preceded by a failing test.

---

## 0. Important correction to the brief

The task prompt states "the project uses Zod schemas in tool definitions." **It does not.** Tool `inputSchema` objects in `src/server.ts` are plain JSON Schema literals (`{ type: "string", description: "..." }`). There is no Zod parse step; `args` is cast with `as` inside each handler. Consequences:

1. The "Zod transform on every ID field" option in the brief is **not available** without introducing a new dependency (ruled out by constraints) or rewriting all 26 tool schemas as Zod.
2. The architectural choice narrows to: *(i)* normalize in the central `CallToolRequestSchema` dispatcher before the `switch`, *(ii)* normalize inside each handler (26 sites), or *(iii)* normalize inside every `notion-client.ts` wrapper.

**Recommendation:** *(i)* — single-site normalization in the dispatcher. Rationale in §B.

---

## A. Location of `normalizeNotionId()`

**Pick:** Option 1 — new file `src/notion-id.ts`.

**Reasoning.** It is imported by three different entry points (`index.ts`, `http.ts`, `server.ts`) and is also a candidate public export (see §G). Putting it in `notion-client.ts` couples pure string logic to the SDK wrapper module; putting it in `server.ts` makes it awkward to import from the startup files. A 60-line standalone module with zero runtime deps is the cleanest home.

**File:** `src/notion-id.ts`

**Exports:**

```ts
export class NormalizationError extends Error {
  readonly input: string;
  constructor(input: string, reason: string) {
    super(
      `Could not parse Notion ID from input ${JSON.stringify(input)}: ${reason}. ` +
      `Expected a 32-character hex ID, a dashed UUID, or a notion.so URL ` +
      `(e.g. "https://www.notion.so/Page-Title-327be876242f817f9129ff1a5a624814").`
    );
    this.name = "NormalizationError";
    this.input = input;
  }
}

/**
 * Normalize any Notion ID-ish input to a 32-char lowercase hex string.
 * Accepts: bare 32-hex, dashed UUID (8-4-4-4-12), notion.so URLs (any variant).
 * Throws NormalizationError on failure.
 */
export function normalizeNotionId(input: unknown): string;
```

**Regex constants (module-private):**

```ts
const HEX32 = /[0-9a-fA-F]{32}/g;                  // anywhere in a string
const BARE_HEX32 = /^[0-9a-fA-F]{32}$/;              // whole string
const DASHED_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
```

**Algorithm (in this exact order):**

1. If `input` is not a string → `throw new NormalizationError(String(input), "not a string")`.
2. `const trimmed = input.trim()`.
3. If `trimmed === ""` → `throw new NormalizationError(input, "empty string")`.
4. If `BARE_HEX32.test(trimmed)` → `return trimmed.toLowerCase()`.
5. If `DASHED_UUID.test(trimmed)` → `return trimmed.replace(/-/g, "").toLowerCase()`.
6. If `trimmed` contains `notion.so` (case-insensitive) or starts with `http://`/`https://`:
   a. Try `new URL(trimmed)`; if it throws, fall through to step 7.
   b. Concatenate `url.pathname` (ignore query and hash — drops `?v=...`).
   c. Run `HEX32.exec` on the pathname. Collect **all** matches.
   d. If exactly one match → return it lowercased.
   e. If multiple matches → return the **last** match (view/collection URLs put the page ID last after `-`). Lowercased.
   f. If zero matches → `throw new NormalizationError(input, "URL contained no 32-character hex ID")`.
7. Fallback: run `HEX32.exec` on `trimmed`. If exactly one match → return it lowercased. Otherwise → `throw new NormalizationError(input, "no 32-character hex ID found")`.

**Edge-case matrix (explicit):**

| Case | Handling |
|---|---|
| Empty string `""` | throws (step 3) |
| Whitespace only `"   "` | throws (empty after trim) |
| Leading/trailing whitespace around valid hex | trimmed, accepted |
| Mixed case hex `327BE876…` | accepted, lowercased |
| Dashed UUID with correct dash positions (Notion-style 8-4-4-4-12) | accepted |
| Dashed UUID with wrong dash positions (e.g. `327b-e876…`) | falls through to step 7 (fallback hex scan); if exactly one 32-hex run emerges after dash-stripping, **reject** — do not silently correct malformed UUIDs. Implementation: step 5 regex is strict; step 7 operates on raw `trimmed`, not dash-stripped. Wrong-dash UUIDs will fail step 7 (dashes break the 32-run) and throw. This is intentional — garbage in, clear error out. |
| Multiple 32-hex runs in URL path (e.g. database view URL `.../ws/DB-abcd…32hex/page-efgh…32hex`) | step 6e returns the **last** match |
| Non-ASCII `"페이지-327be…"` | URL/hex regex still finds the hex run; accepted |
| Very long string (>10 KB) | accepted if it contains exactly one hex run; otherwise throws. No length limit — not a DoS surface (JS regex on this pattern is linear). |
| Path-traversal `"../../etc/passwd"` | no hex match → throws |
| URL with fragment `#block-id` (which is itself a hex ID) | pathname-only extraction ignores fragment, avoiding ambiguity |
| UUID with uppercase dashes e.g. `327BE876-242F-817F-9129-FF1A5A624814` | accepted (step 5, case-insensitive regex) |

**Error message (literal):** see constructor above. Includes the stringified input, the specific reason, and an example. This is the wording that ships; §G flags it as a decision point the maintainer may want to tweak.

---

## B. Wiring normalization into tool dispatch

**Pick:** Central normalization in the `CallToolRequestSchema` handler, before the `switch (name)`. **Not** Zod transforms (not available; see §0), **not** per-wrapper normalization in `notion-client.ts` (26 wrappers × 1 change each = noise; and internal wrappers already receive normalized IDs from the dispatcher, so double-normalizing is wasteful).

**Change site:** `src/server.ts`, top of the `CallToolRequestSchema` handler (currently line 835–836).

**The code:**

```ts
// At module top of server.ts
import { normalizeNotionId, NormalizationError } from "./notion-id.js";

const ID_FIELDS = new Set([
  "page_id",
  "parent_page_id",
  "database_id",
  "new_parent_id",
  "block_id", // defensive — not currently a tool input but future-proof
]);

function normalizeIdArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const key of Object.keys(out)) {
    if (ID_FIELDS.has(key) && typeof out[key] === "string") {
      out[key] = normalizeNotionId(out[key]);
    }
  }
  return out;
}
```

At the top of the handler:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;
  let args: Record<string, unknown>;
  try {
    args = normalizeIdArgs(rawArgs as Record<string, unknown>);
  } catch (err) {
    if (err instanceof NormalizationError) {
      return textResponse({ error: err.message });
    }
    throw err;
  }
  try {
    switch (name) {
      /* existing cases unchanged */
    }
  } catch (error) { /* unchanged */ }
});
```

**Why this is strictly better than per-handler normalization:** one code site, one test coverage surface, no risk of forgetting to normalize when adding a new tool. The existing handlers destructure `args` (`const { page_id } = args as { page_id: string }`) — they continue to work unchanged because `args` is the same shape, just with normalized string values.

**Tool fields normalized (exhaustive grep of `src/server.ts` inputSchema blocks):**

| Tool | Field |
|---|---|
| `create_page` | `parent_page_id` |
| `append_content` | `page_id` |
| `replace_content` | `page_id` |
| `update_section` | `page_id` |
| `find_replace` | `page_id` |
| `read_page` | `page_id` |
| `duplicate_page` | `page_id`, `parent_page_id` |
| `update_page` | `page_id` |
| `archive_page` | `page_id` |
| `list_pages` | `parent_page_id` |
| `share_page` | `page_id` |
| `create_database` | `parent_page_id` |
| `get_database` | `database_id` |
| `query_database` | `database_id` |
| `add_database_entry` | `database_id` |
| `add_database_entries` | `database_id` |
| `update_database_entry` | `page_id` |
| `list_comments` | `page_id` |
| `add_comment` | `page_id` |
| `move_page` | `page_id`, `new_parent_id` |
| `restore_page` | `page_id` |
| `delete_database_entry` | `page_id` |

**Total: 24 ID fields across 22 tools.** (`search`, `list_databases`, `list_users`, `get_me` take no ID args.)

---

## C. Startup normalization (`NOTION_ROOT_PAGE_ID`)

Two call sites read the env var; both need the same treatment.

**`src/index.ts`** (currently line 17):

```ts
import { normalizeNotionId, NormalizationError } from "./notion-id.js";

let rootPageId: string | undefined;
if (process.env.NOTION_ROOT_PAGE_ID) {
  try {
    rootPageId = normalizeNotionId(process.env.NOTION_ROOT_PAGE_ID);
  } catch (err) {
    if (err instanceof NormalizationError) {
      console.error(`NOTION_ROOT_PAGE_ID is invalid: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const server = createServer(() => notion, {
  rootPageId,
  trustContent: process.env.NOTION_TRUST_CONTENT === "true",
});
```

**`src/http.ts`** (currently line 215): identical treatment, exiting the process on parse failure. HTTP mode has the same blast-radius argument — a silently-dropped root page ID would cause confusing "parent_page_id is required" errors later.

**Unparseable behavior decision:** **fail-fast, exit 1 with a clear error.** Rationale: the variable is *explicitly set* by the user. Silently clearing it would mask the user's intent and produce a later, less-actionable error ("parent_page_id is required" instead of "NOTION_ROOT_PAGE_ID is invalid"). The startup error is loud, immediate, and tells the user exactly what to fix. This also matches the existing pattern at `src/index.ts:8` where a missing `NOTION_TOKEN` aborts startup.

---

## D. Error translation after normalization

**Decision: no new error translation logic needed in wrappers.**

Reasoning — the post-normalization error classes are:

1. `NormalizationError` — actionable, contains input and example. Emitted *before* any SDK call.
2. `validation_error` — actionable per audit variant 7, already enhanced at `server.ts:395` (`enhanceError`).
3. `object_not_found` — actionable per audit variant 9, already enhanced at `server.ts:383`.
4. `unauthorized` / `restricted_resource` — already enhanced at `server.ts:391`.
5. `rate_limited` — already enhanced at `server.ts:387`.

The only catastrophically opaque error class in the audit (`invalid_request_url`) was *caused by* URLs reaching the SDK. Normalization at the dispatcher makes that class unreachable from tool arguments. The only surface that could still produce it is if the SDK itself emits one for a different reason (unlikely for `pages.retrieve` once `page_id` is a clean 32-hex string). `enhanceError` does not need to know about `invalid_request_url` at all — and if we added a branch for it, we'd be papering over a case that should never fire.

**One small addition** to `enhanceError`: include `NormalizationError` in the catch path so the existing try/catch at line 1247 doesn't re-wrap it. But since we already catch it *before* the switch (see §B), the existing `enhanceError` path never sees it. No change needed.

---

## E. The `--check` doctor command

### E.1 CLI surface

**Invocation:** `node dist/index.js --check` is the canonical form. Because `package.json` declares a `bin` entry that maps `easy-notion-mcp` to `dist/index.js`, `easy-notion-mcp --check` works automatically — no separate bin entry needed.

**Flag parsing location:** top of `src/index.ts`, before the normal stdio bootstrap. **Hand-rolled — no new dep.** Five lines:

```ts
const args = process.argv.slice(2);
if (args.includes("--check") || args.includes("-c")) {
  const { runDoctor } = await import("./check.js");
  process.exit(await runDoctor());
}
```

(Top-level `await` is fine — `src/index.ts` is already an ESM module.)

**HTTP/OAuth mode:** **not supported.** `--check` is stdio-only. The HTTP entry point (`http.ts`) does not add a flag parser. Rationale: OAuth mode has no fixed token — there is nothing to "check" until a user completes the OAuth flow per-request. Static-token HTTP mode is covered by running `--check` on the stdio binary with the same `NOTION_TOKEN` in the environment; the underlying checks are identical.

**New file:** `src/check.ts` — exports `async function runDoctor(): Promise<number>`. Returns the process exit code.

### E.2 Checks, in order

Fail-fast semantics for Check 1 (no token = nothing else works). Checks 2–5 run even if earlier ones fail, collecting results, so the user sees the full picture (this addresses the fail-fast-vs-comprehensive question in §G — my call is *mostly comprehensive with one fail-fast gate*).

| # | Check | Calls | Success output | Failure modes |
|---|---|---|---|---|
| 1 | `NOTION_TOKEN` present and well-formed | `process.env.NOTION_TOKEN`; regex `/^(secret_|ntn_)[A-Za-z0-9]{40,}$/` | `✓ NOTION_TOKEN is set` | *missing* → `✗ NOTION_TOKEN is not set. Create an internal integration at https://www.notion.so/my-integrations and export the secret.` **Fail-fast — abort remaining checks.** *malformed* → `✗ NOTION_TOKEN does not look like a Notion token (expected secret_... or ntn_... prefix). Continuing anyway.` |
| 2 | API reachable + integration metadata | `notion.users.me({})` | `✓ Notion API reachable. Integration: "<name>" (<bot_id>)` | network error → `✗ Could not reach Notion API: <err>. Check your internet connection.` / 401 → `✗ Notion rejected the token (401 unauthorized). Regenerate at https://www.notion.so/my-integrations.` |
| 3 | `NOTION_ROOT_PAGE_ID` parses (if set) | `normalizeNotionId(env)` | `✓ NOTION_ROOT_PAGE_ID parses to <32-hex>` or `— NOTION_ROOT_PAGE_ID not set (optional)` | `✗ NOTION_ROOT_PAGE_ID is invalid: <NormalizationError message>` |
| 4 | `NOTION_ROOT_PAGE_ID` resolves to an accessible page (if set and parsed) | `notion.pages.retrieve({ page_id })` | `✓ NOTION_ROOT_PAGE_ID resolves to page "<title>"` | `object_not_found` → `✗ Root page not found or not shared with this integration. Open the page in Notion → ⋯ → Connections → add your integration.` / other → `✗ Could not retrieve root page: <err>` |
| 5 | Content capabilities (read granted) | `notion.search({ query: "", page_size: 1 })` | `✓ Integration can search/read content (<N> accessible item(s))` | zero results → `— Integration reads OK but no pages are shared with it yet. Share at least one page in Notion.` (warning, not failure) / error → `✗ Search failed: <err>` |

Five checks total. Writing content is **not** checked — it would require creating a test page, which has side effects and requires `NOTION_ROOT_PAGE_ID` to be set.

### E.3 Output format

**Plain text, no color.** `console.error` output (keeps stdout pristine, consistent with existing conventions per `CLAUDE.md`). `✓` / `✗` / `—` prefixes. No emoji beyond those three. Each check is one or two lines.

**Full success transcript (literal):**

```
easy-notion-mcp doctor
──────────────────────
✓ NOTION_TOKEN is set
✓ Notion API reachable. Integration: "Iris" (320be876-242f-8131-8f63-0027e8b63e24)
✓ NOTION_ROOT_PAGE_ID parses to 327be876242f817f9129ff1a5a624814
✓ NOTION_ROOT_PAGE_ID resolves to page "✨ easy-notion-mcp"
✓ Integration can search/read content (14 accessible item(s))

All checks passed.
```

**Mixed-result transcript (literal):**

```
easy-notion-mcp doctor
──────────────────────
✓ NOTION_TOKEN is set
✓ Notion API reachable. Integration: "Iris" (320be876-242f-8131-8f63-0027e8b63e24)
✗ NOTION_ROOT_PAGE_ID is invalid: Could not parse Notion ID from input "https://notion.so/oops": URL contained no 32-character hex ID. Expected a 32-character hex ID, a dashed UUID, or a notion.so URL (e.g. "https://www.notion.so/Page-Title-327be876242f817f9129ff1a5a624814").
— NOTION_ROOT_PAGE_ID resolution skipped (did not parse)
✓ Integration can search/read content (14 accessible item(s))

1 check failed.
```

### E.4 Exit code

- `0` if every check is `✓` or `—` (informational skip / warning).
- `1` if any check is `✗`.
- No per-check exit codes — one boolean failure signal for shell/CI ergonomics.

### E.5 HTTP mode

Not supported. Documented in the command output if invoked without `NOTION_TOKEN`: the error message already says "NOTION_TOKEN is not set" which is the right guidance regardless of transport.

---

## F. Test plan

All test files use `vitest` (existing). SDK mocked via `vi.mock("@notionhq/client")` — follow the pattern in `tests/list-databases.test.ts` and `tests/stdio-startup.test.ts`.

### F.1 `tests/notion-id.test.ts` (new — write first, TDD)

Pure unit tests. No mocking needed.

```ts
describe("normalizeNotionId", () => {
  // Audit variants 1-9
  it("accepts a bare 32-char hex ID");                                      // #1
  it("accepts a dashed UUID and strips dashes");                             // #2
  it("extracts ID from notion.so URL with slug prefix");                    // #3
  it("extracts ID from notion.so URL without slug");                         // #4
  it("extracts ID from URL with ?v= view query, ignoring query string");   // #5
  it("extracts ID from workspace-prefixed URL");                             // #6
  it("throws NormalizationError on garbage 'not-a-real-id'");               // #7
  it("throws NormalizationError on empty string");                          // #8
  it("accepts a valid-shape UUID that does not exist on Notion");           // #9 (normalization doesn't hit the API)

  // Adversarial
  it("throws on path traversal input '../../etc/passwd'");
  it("accepts very long strings containing exactly one 32-hex run");
  it("throws on very long strings with zero hex runs");
  it("normalizes mixed-case hex to lowercase");
  it("trims leading and trailing whitespace before parsing");
  it("rejects dashed UUIDs with wrong dash positions");
  it("handles non-ASCII characters in URL path segments");
  it("picks the last hex run when a URL contains multiple");
  it("throws on non-string inputs (number, null, undefined, object)");
  it("error message quotes the input and names the reason");
});

describe("NormalizationError", () => {
  it("exposes the original input via .input");
  it("instanceof Error and instanceof NormalizationError");
});
```

### F.2 `tests/server-id-normalization.test.ts` (new)

Integration test that the dispatcher normalizes ID args before calling wrappers. Mock `notion-client.ts` at the module level.

```ts
describe("server tool-dispatch ID normalization", () => {
  it("normalizes page_id from a notion.so URL before calling read_page");
  it("normalizes parent_page_id from a URL on create_page");
  it("normalizes database_id from a URL on query_database");
  it("normalizes new_parent_id on move_page");
  it("normalizes both page_id and parent_page_id on duplicate_page");
  it("passes through bare 32-hex IDs unchanged");
  it("returns a clear error (no SDK call) on unparseable page_id");
  it("does not mutate non-ID string args (e.g. markdown body)");
  it("does not normalize a field whose name happens to be page_id inside a nested object");
});
```

### F.3 `tests/check-command.test.ts` (new)

Mock `@notionhq/client`. Capture `console.error` output. Capture the return value from `runDoctor()`.

```ts
describe("runDoctor (--check)", () => {
  it("returns 0 and prints all ✓ when token, API, root page, and search all succeed");
  it("returns 1 and aborts early when NOTION_TOKEN is missing");
  it("returns 1 with a warning when NOTION_TOKEN is set but has unexpected prefix");
  it("returns 1 when Notion API rejects the token with 401");
  it("returns 1 when users.me throws a network error");
  it("skips root-page checks with '— not set' when NOTION_ROOT_PAGE_ID is absent");
  it("returns 1 when NOTION_ROOT_PAGE_ID cannot be normalized");
  it("returns 1 when NOTION_ROOT_PAGE_ID resolves to object_not_found");
  it("returns 0 with a '—' warning when search returns zero results");
  it("prints checks in the documented order even when later ones would fail");
  it("output is written to console.error, not console.log");
});
```

### F.4 `tests/stdio-startup.test.ts` (modify existing)

Add cases for the env-var normalization at startup:

```ts
it("normalizes NOTION_ROOT_PAGE_ID if it is a notion.so URL");
it("exits with a clear error if NOTION_ROOT_PAGE_ID is unparseable");
```

### F.5 End-to-end contract test

One test in `tests/server-id-normalization.test.ts`: a full `callTool` round-trip for `read_page` where the argument is a URL and the mocked SDK asserts it receives a bare 32-hex string. This is the one "contract test" the brief asked for.

---

## G. Decision points for the maintainer

Ranked top-to-bottom by how much they will affect ship quality:

1. **`src/server.ts` uses plain JSON Schema, not Zod.** The task brief was wrong about this. This plan normalizes at the dispatcher layer, not via per-field transforms. Confirm this is acceptable, or decide whether a broader migration to Zod schemas is in scope (strongly recommend deferring; out of scope for PR A).
2. **Public export of `normalizeNotionId`?** The brief mentions exporting it "as a public utility so users writing scripts on top of `easy-notion-mcp` can normalize too." If yes: add a re-export from `src/index.ts` or create `src/public.ts` and point `package.json` `"exports"` at it. Affects the semver surface. Recommend: **yes, export** — near-zero cost, real external value, matches the brief's intent.
3. **Exact wording of the `NormalizationError` message.** The message in §A is my draft; it is the user-facing API of this change. Two specific sub-questions: (a) include the example URL, or keep it terser? (b) use straight quotes vs backticks around the input?
4. **`NOTION_ROOT_PAGE_ID` unparseable behavior.** I chose fail-fast (exit 1). An alternative is warn-and-continue (log, unset the var, keep running). Fail-fast is louder; warn-and-continue is more forgiving. Confirm fail-fast.
5. **`--check` in README placement.** Quick-start section (prominent, users see it when setting up) or Troubleshooting section (hidden, only discovered when something breaks)? The doctor is most valuable *before* the first opaque error, which argues for Quick-start. Recommend: one line in Quick-start, full section under Troubleshooting.
6. **`--check` fail-fast vs comprehensive.** I chose "comprehensive with one fail-fast gate" (Check 1 aborts; 2–5 always run). Confirm.
7. **`--check` write-capability test.** I left it out (requires side effects and `NOTION_ROOT_PAGE_ID`). If the maintainer wants write verification, we can add an optional Check 6 that creates and immediately archives a test page under the root — flag this explicitly in output and require a `--check --write` opt-in.
8. **Bin entry for `--check`.** I reuse the existing `easy-notion-mcp` bin. Alternative: add a dedicated `easy-notion-mcp-doctor` bin. Recommend reusing — fewer published artifacts.

---

## H. Build sequence (TDD-ordered, one step = one commit)

1. **Write `tests/notion-id.test.ts`** with all 20-ish cases from §F.1. Run — every test fails because the module doesn't exist. Commit: `test(notion-id): add failing normalization tests`.
2. **Implement `src/notion-id.ts`** per §A until all tests in step 1 pass. Commit: `feat(notion-id): add normalizeNotionId helper`.
3. **Write `tests/server-id-normalization.test.ts`** (§F.2). Run — tests fail because dispatcher does not normalize. Commit: `test(server): add failing ID-normalization dispatch tests`.
4. **Wire `normalizeIdArgs` into `server.ts` dispatcher** per §B. Step 3 tests now pass. Commit: `feat(server): normalize ID args at tool dispatch`.
5. **Modify `tests/stdio-startup.test.ts`** to add the two env-var cases from §F.4. Tests fail. Commit: `test(startup): add failing NOTION_ROOT_PAGE_ID normalization tests`.
6. **Modify `src/index.ts` and `src/http.ts`** per §C. Step 5 tests pass. Commit: `feat(startup): normalize NOTION_ROOT_PAGE_ID and fail-fast on invalid value`.
7. **Write `tests/check-command.test.ts`** (§F.3). Tests fail because `src/check.ts` doesn't exist. Commit: `test(check): add failing doctor-command tests`.
8. **Implement `src/check.ts`** (`runDoctor`) per §E.2–E.4. Step 7 tests pass. Commit: `feat(check): implement --check doctor command`.
9. **Wire `--check` flag into `src/index.ts`** per §E.1 (five-line `process.argv` handler + dynamic import). Manual smoke test: `node dist/index.js --check` with a real token. Commit: `feat(cli): wire --check flag in stdio entry point`.
10. **(Optional) public export** of `normalizeNotionId` if maintainer says yes in §G.2. Commit: `feat(notion-id): export normalizeNotionId from package entry`.
11. **README update** — document `--check` in both Quick-start (one line) and Troubleshooting (full section). Document accepted ID input formats in the tool descriptions (or one shared note at the top of the tools section). Commit: `docs: document --check doctor command and URL-as-ID support`.
12. **Run the full audit script from `.meta/audits/url-as-id-errors-2026-04-09.md`** against the built binary. Confirm every URL variant now either succeeds or returns a clear `NormalizationError` — no more `invalid_request_url`. Capture the new output table in a short follow-up audit doc under `.meta/audits/` to close the loop. Commit: `docs(audits): confirm URL-as-ID errors resolved in PR A`.

Each step is small enough to ship independently if the PR is broken up. Steps 1–4 alone already fix the original co-founder incident; steps 5–6 harden startup; steps 7–9 add the doctor; steps 10–12 are polish.

---

## Appendix: Codex review

**Not performed.** The `mcp__agents__ask_agent` tool was not available in this environment, so the plan did not go through the Codex pressure-test step prescribed by the Planner PM workflow. The maintainer should weigh this accordingly — specifically, the claims most in need of a second pair of eyes are:

- The dispatcher-level normalization approach (§B) — does it break any existing test in `tests/` that passes a URL-shaped argument expecting it *not* to be normalized? (I scanned existing tests and saw none, but a builder should re-verify.)
- The "last hex match wins" rule for URLs with multiple 32-hex runs (§A step 6e) — is there a real Notion URL shape where this picks the wrong one?
- The decision to skip `invalid_request_url` translation in `enhanceError` (§D) — is there any non-ID-argument code path in `notion-client.ts` that could still emit it?

These are my top-three residual uncertainties.

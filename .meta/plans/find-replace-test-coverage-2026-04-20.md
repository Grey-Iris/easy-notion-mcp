# Plan — `find_replace` handler-level test coverage

**Date:** 2026-04-20
**Branch:** `dev` (currently `d144665`)
**Scope:** Single PR adding handler-level tests for the `find_replace` MCP tool.
**Driver:** Frame-sweep synthesis (`.meta/research/test-gap-synthesis-2026-04-20.md`) C6 — `find_replace` is the only zero-coverage destructive-write tool that ships today; flagged independently by Frame 1 (S8) and Frame 5 (priority #1).
**Inputs:** `.meta/research/test-gap-frame-1-silent-failures-2026-04-20.md`, `.meta/research/test-gap-frame-5-user-journeys-2026-04-20.md`, `.meta/research/test-gap-synthesis-2026-04-20.md`, `tests/create-database-response.test.ts` (pattern), `node_modules/@notionhq/client/build/src/api-endpoints.d.ts:3102-3148, 1744-1750` (API contract).

---

## 1. Current state

### 1.1 What `find_replace` does today

**Tool definition:** `src/server.ts:572-584`. Schema accepts `page_id` (string, required), `find` (string, required), `replace` (string, required), `replace_all` (boolean, optional, default `first only`). Description: "Find and replace text on a page. Preserves uploaded files and blocks that aren't touched. More efficient than replace_content for targeted text changes like fixing typos, updating URLs, or renaming terms."

**Handler:** `src/server.ts:1123-1146`. Body:

```ts
case "find_replace": {
  const notion = notionClientFactory();
  const { page_id, find, replace, replace_all } = args as { ... };
  const result = await (notion as any).pages.updateMarkdown({
    page_id,
    type: "update_content",
    update_content: {
      content_updates: [{
        old_str: find,
        new_str: replace,
        ...(replace_all ? { replace_all_matches: true } : {}),
      }],
    },
  }) as any;
  return textResponse({
    success: true,
    ...(result.truncated ? { truncated: true } : {}),
  });
}
```

Notes from this handler shape:
- It calls `(notion as any).pages.updateMarkdown` directly — there is **no wrapper in `src/notion-client.ts`** (verified via `Grep updateMarkdown` returning only this single hit + node_modules). The handler escapes the typed wrapper layer.
- Per CLAUDE.md "Key decisions" (line 75) and the API contract this tool deliberately uses Notion's native `pages.updateMarkdown` (server-side find/replace), bypassing the markdown-to-blocks pipeline that every other write tool uses. This means tests can mock `pages.updateMarkdown` directly without touching block conversion.
- The orchestrator's brief refers to `old_str`/`new_str` as the tool-surface argument names, but those are the **internal Notion-API key names** that the handler maps to. The MCP-surface argument names are `find`/`replace`. The Frame 5 entry calling out the "swap `old_str` ↔ `new_str`" mutation is talking about the swap *inside the handler's payload construction* (`src/server.ts:1136-1137`), not the MCP-surface schema. That distinction matters for test naming and assertions.

**API contract (verified against `@notionhq/client@5.13.x` types in `node_modules/@notionhq/client/build/src/api-endpoints.d.ts:3102-3148, 1744-1750`):**

Request body for `type: "update_content"`:
```ts
{
  type: "update_content",
  update_content: {
    content_updates: Array<{
      old_str: string;
      new_str: string;
      replace_all_matches?: boolean;
    }>;
    allow_deleting_content?: boolean;  // not set by handler
  }
}
```

Response (`PageMarkdownResponse`):
```ts
{
  object: "page_markdown";
  id: IdResponse;
  markdown: string;             // discarded by handler
  truncated: boolean;           // surfaced if truthy
  unknown_block_ids: Array<IdResponse>;  // discarded by handler
}
```

**Critical:** the API does not return a match count or "0 occurrences" indicator (verified against `api-endpoints.d.ts:1744-1750` — `PageMarkdownResponse` is `{object, id, markdown, truncated, unknown_block_ids}` only). Whether the find string was found is observable only by diffing the returned `markdown` against prior content, or via Notion throwing on certain error shapes. The handler discards `markdown` and `unknown_block_ids` entirely.

**Correction on `unknown_block_ids` semantics (per Codex review of this plan):** the type contract proves the field exists on `PageMarkdownResponse` but does **not** document the rules for what gets included in it (e.g., whether matches inside such blocks are skipped vs. attempted vs. errored). This plan does not make claims about what Notion does with finds against unknown blocks — it only pins that we discard the field. Verifying the runtime semantics is a live-E2E concern, deferred to the Tier-1 harness.

### 1.2 What tests exist for `find_replace`

`grep -r "find_replace\|updateMarkdown" tests/` → **no matches.** Confirmed zero handler-level coverage. The only mention of `find_replace` in the test directory is *absent*. The tool is referenced in:
- `tests/destructive-edit-descriptions.test.ts` — only tests `replace_content` and `update_section` description text (G-3a). Does not touch `find_replace`.
- `src/server.ts:544` — `replace_content`'s description mentions `find_replace` as a non-destructive alternative, but no test exercises that link.

The handler has **no unit, integration, or E2E coverage**.

---

## 2. The gap being closed — what bugs would a well-designed test catch?

Each item below maps to a specific 1-line mutation in `src/server.ts:1123-1146` that ships green today.

| # | Mutation | Line | What breaks for the user | Caught by test |
|---|---|---|---|---|
| **G1** | Swap `old_str` and `new_str` in the payload | 1136-1137 | Every `find_replace` call replaces the *replacement* text with the *search* text — destructive inversion. A user fixing a typo creates the typo. | T1 |
| **G2** | Drop the `replace_all_matches` ternary | 1138 | `replace_all: true` silently behaves as first-only. User renames "Foo" to "Bar" expecting all occurrences; only the first one moves. | T2 |
| **G3** | Mutation flips `success: true` → `success: false` (or any other static value) | 1142-1145 | Agent receives wrong success signal. The current code unconditionally returns `success: true` — so the *concern* this row pins isn't a one-line bug, it's "don't let a refactor drop or invert the field." | T3 (response-shape pin) |
| **G4** | Drop the `replace_all` arg destructuring (typo to `replaceAll`) | 1125-1129 | `replace_all` is silently always `undefined` → first-only. Same blast radius as G2. | T2 (covers both) |
| **G5** | Pass `find` to `replace` slot in the destructured args | 1136-1137 (alt) | Variant of G1; the destructured `find` lands in `new_str`. | T1 |
| **G6** | Wrong handler dispatch (paste-error: this case calls `replace_content`) | 1123 | Page wiped or wrong API called. | T1 — `pages.updateMarkdown` would not be called; the call-count assertion fails. (The outer `try/catch` at `src/server.ts:978-1481` converts thrown errors into an error envelope rather than crashing — so the right detection signal is "API never called," not "test crashes.") |
| **G7** | Add `allow_deleting_content: true` inside `update_content` | 1134 | Notion's `update_content` body accepts an optional `allow_deleting_content` field (`api-endpoints.d.ts:3126`); setting it `true` on a find/replace lets the operation drop blocks. Currently the handler does not set this field. A mutation adding it changes find_replace from "preserves uploaded files and blocks that aren't touched" (per the tool description) to a destructive operation. | T1 (strengthened — see §4.2) |
| **G8** | Emit a second entry in `content_updates` (e.g., a stray duplicate during refactor) | 1135-1140 | Second find/replace pass runs against the result of the first — surprising semantics, possible double-replacement. | T1 (strengthened — see §4.2) |

### 2.1 Behaviors worth pinning even though not literally a 1-line mutation

These are properties of the current contract that should have a documenting test so future refactors don't regress them silently:

- **No match-related signal in the response (Frame 1 S8 framing, narrowed):** the handler always returns `{success: true}` regardless of what came back. Per the API contract (§1.1), Notion's response does not include a match count, so we *cannot today* surface one — the handler genuinely has no signal to inspect. What we *can* pin is: "the response carries no match-related field." That's a known-gap canary: the moment we add a match count or warnings field (most likely sourced from a markdown-diff against the returned `markdown`), the assertion goes red and the fix-PR flips it. The Frame 1 synthesis calls this pattern "success-without-verification."
- **Response metadata fields are discarded:** the handler ignores `markdown` and `unknown_block_ids` from the API response. It surfaces `truncated` only when truthy. Pinning "discarded by the response shape" is documenting current behavior, not making a semantic claim about *why* `unknown_block_ids` is populated (the type contract proves the field exists; it does not document the population rules — see §1.1's correction). When a future PR adds warnings for response metadata, these assertions flip.
- **`truncated: true` passthrough:** the handler does pass `truncated` when truthy. There is no test asserting the field reaches the response. Add one — cheap and pins the "we surface what little signal Notion gives us" guarantee. (Note: `truncated` here is Notion's signal on the `PageMarkdownResponse` envelope. The API type doc — `api-endpoints.d.ts:1748` — declares it as a boolean on `PageMarkdownResponse` but does not specify in-line what it semantically means; we treat it as opaque metadata to surface.)
- **`replace_all` omitted from payload when falsy:** the handler uses spread `...(replace_all ? { replace_all_matches: true } : {})` so `false` and `undefined` both produce no key. Pin this so a refactor to `replace_all_matches: !!replace_all` (which would change Notion's payload shape and could conceivably trip API validation in a future Notion version) doesn't slip in unnoticed.

### 2.2 Cases the orchestrator's brief listed but I'm explicitly NOT testing here, with rationale

- **Unicode / special-char handling in the needle.** `pages.updateMarkdown` is a server-side string match — the matching semantics live entirely in Notion's API. We mock the API in handler-level tests, so testing unicode here only proves that we forward strings unchanged (which is true by construction — no string manipulation in the handler). The real risk (does Notion's matcher behave with combining characters, RTL marks, ZWJ sequences?) is a **live-E2E concern**, not a handler concern. Defer to Tier-1 E2E (synthesis §4 stretch test 10).
- **Empty `old_str` — API error or full-page replace?** Same reason: this is a server-side semantic question. The handler forwards `find: ""` to `old_str: ""`. What Notion does with that is **a Notion contract question**, not a handler-correctness question. Worth testing live, not in mocks. (An earlier draft included a "T6 empty-find pin" handler test; Codex review removed it as bloat — see §10.)
- **Long strings near Notion's 2000-char rich-text limit.** Notion's 2000-char cap applies to `rich_text` field segments inside *block objects*; `pages.updateMarkdown` operates on serialized markdown strings, so the cap may not apply the same way (and Notion's behavior here is undocumented). This is a live-E2E question, defer.
- **Rate-limit / 409 conflict during concurrent edits.** General concern across all write tools, not `find_replace`-specific. The synthesis lists C5 (destructive delete-then-append window) as the destructive-edit concurrency item; `find_replace` is *not* in that family because it's a single atomic API call, not a multi-step delete-then-append. So 429/409 here is "test the SDK's retry behavior + our error envelope" — a broader contract test that belongs in `api-contract-canaries` (synthesis §5 suggested task), not this PR.

These exclusions are not "we don't care" — they're "wrong test layer for this PR." Stating them keeps the PR narrow.

---

## 3. Test architecture decision

**Decision: handler-level tests only, using `InMemoryTransport` + `createServer` factory + a mock Notion client. No live-E2E in this PR.**

### Confirming the orchestrator's call

The brief proposed exactly this; I confirm and reinforce.

**Why handler-level is the right layer for the acute fix:**

1. **The bugs we're catching live in 24 lines of handler code.** Every G1-G8 mutation (§2's table) is in the JS we wrote, not in Notion's behavior. Mocking `pages.updateMarkdown` is sufficient to assert: did we destructure args correctly? did we build the payload with the right keys? did we pass through the `replace_all` flag? did we accidentally add `allow_deleting_content`? did we surface the response's `truncated` field? Live-E2E adds Notion-side latency and quota cost without catching any of these.

2. **The pattern is already proven in the codebase.** `tests/create-database-response.test.ts` is the canonical example: `InMemoryTransport.createLinkedPair()`, `createServer(() => mockNotion, {})`, MCP client calls the tool, parse the JSON-text response, assert. The mock factory shape (`makeNotion`) is reusable — we extend it with `pages.updateMarkdown`. Builder copies the file, modifies ~30%, ships.

3. **The Notion-side semantics ARE worth testing live, but later.** Synthesis §4 stretch test 10 already places `find_replace` live correctness in the Tier-1 E2E suite. Once that harness ships (`build-ee-testing-suite-for-live` task), live tests for unicode/empty-needle/concurrent-edit ride that infrastructure. Doing it now would mean either (a) building partial sandbox infra ahead of the Tier-1 PR, or (b) hitting a real Notion workspace from CI without the sandbox lifecycle, which is exactly what Frame 6's harness work is designed to solve.

4. **Cost discipline.** The orchestrator's brief frames this as "jumps ahead of Tier-1 E2E and the property-type gap fix because it's cheaper and addresses acute user exposure." Keeping the test layer mock-only is what makes it cheap. Adding live-E2E here would compound with the Tier-1 sandbox-decision blocker (Frame 6's recommendation: Option A = dated parent + orphan sweep). That decision is upstream of any live test — defer.

### What we are explicitly giving up by deferring live-E2E

- We don't catch a Notion-side regression where `pages.updateMarkdown` changes its `update_content` payload shape (e.g., renames `old_str`). A handler test against a mock would still pass even though production breaks. **Mitigation:** the mock setup uses the SDK's actual TypeScript types (`UpdatePageMarkdownParameters`) in T1 (mandatory, per §4.1) to detect shape drift at typecheck time.
- We don't catch Notion's actual zero-match behavior. **Mitigation:** the no-match-signal test (T4) pins our handler's response shape regardless of what Notion does; if Notion adds a `matches: 0` field tomorrow, our test still passes (we assert what we surface, not what Notion sends). The *fix* to surface zero-match to the caller is out of scope — when it lands, T4's assertion flips.

These tradeoffs are acceptable for an acute-fix PR.

---

## 4. Proposed test cases

File: `tests/find-replace.test.ts` (new). Suite name: `describe("find_replace handler (synthesis C6)")` — referencing the convergence ID from `.meta/research/test-gap-synthesis-2026-04-20.md` so reviewers can trace the test back to the gap. (This is the synthesis's "C6" — distinct from the §2 mutations table's "G1-G8" naming for the per-mutation tests in this file.)

### 4.1 Mock setup (shared)

Extend the `makeNotion` factory pattern from `tests/create-database-response.test.ts:13-27` with:

```ts
function makeNotion(updateMarkdownResult: any = { object: "page_markdown", id: "page-1", markdown: "...", truncated: false, unknown_block_ids: [] }) {
  return {
    databases: { retrieve: vi.fn(), create: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(async () => updateMarkdownResult),
    },
    blocks: { children: { list: vi.fn(), append: vi.fn() }, delete: vi.fn() },
    users: { list: vi.fn(), me: vi.fn() },
    search: vi.fn(),
    comments: { list: vi.fn(), create: vi.fn() },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}
```

Then `connect()` is identical to the create-database-response file's helper. `parseToolText()` reused verbatim.

**Mandatory type-safety guard (per Codex review):** import `UpdatePageMarkdownParameters` from `@notionhq/client/build/src/api-endpoints.js` and type-assert the captured payload in T1 against it. Required (not optional) because this handler bypasses the typed wrapper layer in `notion-client.ts` (`(notion as any).pages.updateMarkdown`) — the test file is the only typecheck-time guard against SDK-shape drift. T2-T5 don't need their own type assertions because T1 covers it; one mandatory check on the canonical payload shape is enough.

### 4.2 The tests, ordered by acute-bug value

#### **T1 — Exact payload-shape assertion** *(catches G1, G5, G6, G7, G8)*

```ts
it("forwards a payload with exactly the expected shape (no swaps, no extra fields, single content update)", async () => { ... });
```

**Setup:** default mock; call the tool with `find: "typo"`, `replace: "fixed"`, `page_id: "page-1"`.

**Assert:**
- `notion.pages.updateMarkdown` was called exactly once (`expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce()`).
- The captured argument **deep-equals** the expected payload (using `toEqual`, not `toMatchObject` — exact-shape assertion is what catches G7/G8):

```ts
const expectedPayload: UpdatePageMarkdownParameters = {
  page_id: "page-1",
  type: "update_content",
  update_content: {
    content_updates: [
      { old_str: "typo", new_str: "fixed" },
    ],
  },
};
expect(notion.pages.updateMarkdown).toHaveBeenCalledWith(expectedPayload);
```

(The `UpdatePageMarkdownParameters` type annotation is the mandatory type-safety guard from §4.1 — refusing to compile if the SDK shape drifts.)

**Why deep-equal vs `toMatchObject`:** `toMatchObject` allows extra properties, so `allow_deleting_content: true` (G7) or a duplicated `content_updates[1]` (G8) would silently pass. `toEqual` requires exact shape — extra fields fail the test.

**Why this catches:**
- **G1, G5** — key swap or wrong destructure: payload `old_str`/`new_str` mismatch fails the `toEqual`.
- **G6** — wrong dispatch: `pages.updateMarkdown` is never called; `toHaveBeenCalledOnce()` fails. (The outer `try/catch` at `src/server.ts:978-1481` would convert any thrown error into an MCP error envelope rather than crashing the test process.)
- **G7** — `allow_deleting_content: true` added: payload has an extra field; `toEqual` fails.
- **G8** — duplicate `content_updates` entry: array length differs; `toEqual` fails.

**Failure-message hint:** vitest's `toEqual` diff renders the structural difference clearly; combined with the descriptive `it` name the reader knows the bug class instantly.

---

#### **T2 — `replace_all` flag forwarded as `replace_all_matches`** *(catches G2, G4)*

Two `it` blocks. Use exact-shape `toEqual` assertions (same reasoning as T1 — block extra-field mutations).

```ts
it("includes replace_all_matches:true when replace_all=true", async () => { ... });
it("omits replace_all_matches when replace_all is false or unset", async () => { ... });
```

**Setup A (replace_all=true):** call the tool with `replace_all: true`. Assert the captured argument deep-equals:
```ts
{
  page_id: "page-1",
  type: "update_content",
  update_content: {
    content_updates: [{ old_str: "x", new_str: "y", replace_all_matches: true }],
  },
}
```

**Setup B (replace_all unset and replace_all=false, in the same `it` or split):** call once without `replace_all`, call once with `replace_all: false`. For each, assert the captured argument deep-equals the same expected payload as T1 (no `replace_all_matches` key on `content_updates[0]`). The `toEqual` ensures the key is genuinely absent — `toHaveProperty` would also work but `toEqual` keeps the assertion style consistent across T1/T2.

**Why this catches G2/G4:** dropping the ternary means the key is never added (Setup A's `toEqual` fails); renaming the destructured arg to `replaceAll` means JavaScript sees `replace_all === undefined` always (Setup A's `toEqual` fails the same way). Setup B catches the inverse mutation: a refactor to `replace_all_matches: !!replace_all` that always emits the key would fail Setup B because the key would be present with value `false`.

---

#### **T3 — `truncated` passthrough is conditional** *(pins response shape; partial coverage of G3)*

Two `it` blocks:

```ts
it("returns {success:true} with no truncated field when Notion's response has truncated:false", async () => { ... });
it("returns {success:true, truncated:true} when Notion's response sets truncated:true", async () => { ... });
```

**Setup A:** mock `updateMarkdown` to return `{object:"page_markdown", id:"page-1", markdown:"...", truncated:false, unknown_block_ids:[]}`. Call tool. Parse the JSON text from the MCP response.

**Assert (use `toEqual` for exact shape, not `toMatchObject`):**
```ts
expect(parsed).toEqual({ success: true });
```

**Setup B:** same as Setup A but mock returns `truncated: true`.

**Assert:**
```ts
expect(parsed).toEqual({ success: true, truncated: true });
```

**Scope clarification (per Codex review):** T3 does **not** catch G3 from §2's table directly. The current handler unconditionally writes `success: true`, so the only "G3 mutation" T3 actually catches is one that flips the literal value or removes the field. T3's real value is pinning the conditional-truncated-spread pattern: a refactor that always-includes `truncated` (e.g., `truncated: result.truncated ?? false`) would change the response shape, fail Setup A, and force the change to be reviewed. Don't oversell T3 as a "G3 catcher" — frame it as "response-shape pin including the truncated edge."

---

#### **T4 — Response carries no match-related signal** *(known-gap pin for Frame 1 S8 / synthesis C6)*

```ts
it("KNOWN GAP: response carries no match count or zero-match indicator (handler does not inspect returned markdown)", async () => { ... });
```

**Honest framing (per Codex review):** the handler at `src/server.ts:1142-1145` never reads `result.markdown`, so this test is **not** asserting anything about Notion's match semantics. It's asserting that *our handler shape* contains no match-related field, regardless of what Notion sent. The mock can return any markdown — what matters is what we surface.

**Setup:** mock `updateMarkdown` to return a successful response (any shape — e.g., `{object:"page_markdown", id:"page-1", markdown:"any string", truncated:false, unknown_block_ids:[]}`). Call the tool with normal args.

**Assert:**
- `notion.pages.updateMarkdown` was called exactly once. *(Per Codex must-fix #4 — without this, a regression that returns `{success:true}` without ever calling the API would silently pass.)*
- `parsed` deep-equals `{ success: true }` (`toEqual`, not `toMatchObject` — same exact-shape discipline as T1/T3).

**Add a comment in the test:**
```ts
// KNOWN GAP — Frame 1 S8 / synthesis C6.
// The handler never inspects the returned `markdown` field, so it has no way
// to tell the caller whether the find string was actually found. Notion's API
// (PageMarkdownResponse, api-endpoints.d.ts:1744) does not include a match
// count. When we add markdown-diffing or a warnings field for zero-match, this
// test flips: assert the new field is present and meaningful for the no-op case.
```

---

#### **T5 — Handler discards `unknown_block_ids` and `markdown` from the API response** *(known-gap pin; planner-observed)*

```ts
it("KNOWN GAP: discards unknown_block_ids and markdown fields from the API response shape", async () => { ... });
```

**Honest framing (per Codex review):** the type contract proves these fields exist on `PageMarkdownResponse` (`api-endpoints.d.ts:1744-1750`). The contract does not document the rules for *what* gets included in `unknown_block_ids`. So this test pins **what we discard**, not **what discarding means semantically for the user**. If a future runtime investigation establishes that find/replace inside unknown blocks is skipped, the warning fix-PR should add user-facing surface for it; until then, the test simply ensures we don't drift on which fields we surface.

**Setup:** mock `updateMarkdown` to return `{object:"page_markdown", id:"page-1", markdown:"any string", truncated:false, unknown_block_ids:["block-aaa", "block-bbb"]}`. Call the tool normally.

**Assert:**
- `notion.pages.updateMarkdown` was called exactly once. *(Per Codex must-fix #4.)*
- `parsed` deep-equals `{ success: true }` — the populated `unknown_block_ids` array and the returned `markdown` are absent from our response shape.

**Comment in the test:**
```ts
// KNOWN GAP (planner-observed 2026-04-20, not flagged by frame sweep).
// Notion's pages.updateMarkdown response includes `unknown_block_ids` and the
// resulting `markdown`. The handler discards both. The Notion type contract
// (api-endpoints.d.ts:1744-1750) does NOT specify what populates
// unknown_block_ids — that's a runtime semantics question deferred to the
// Tier-1 E2E harness. This test pins "we drop both fields"; flip when a
// warnings-field fix-PR surfaces them, following the convention in
// .meta/plans/pr2-g3-g4-silent-success-2026-04-18.md §2.
```

**Why this matters:** the synthesis §C6 was scoped only to the Frame-flagged mutations. The planner added this one during reading. Documenting it as a known gap now means a future warnings refactor has a clear test to flip — without overstating what we currently know about the field's semantics.

---

### 4.3 Test count summary

- **Required:** T1, T2 (two `it` blocks — Setup A and Setup B), T3 (two `it` blocks), T4, T5 → **7 `it` blocks total.**

Order in file: T1, T2 (×2), T3 (×2), T4, T5 — matches descending acute-bug value.

**T6 from the prior draft (empty-find pin) was removed per Codex review:** the plan itself argues empty-needle behavior is a Notion-side semantics question better suited to live E2E (§2.2). Keeping a handler-mock test for it weakens the scope discipline the rest of the plan argues for.

---

## 5. Potential findings — tests we expect to flip red before the first fix

**None.** This is a pin-current-behavior test PR. All 7 assertion sets above are constructed to match the handler's actual current output as it stands at `src/server.ts:1123-1146`.

The KNOWN GAP tests (T4, T5) are *intentionally* asserting the current-buggy behavior. They will go red the moment a fix lands — and that's the signal for the fix-PR to flip the assertion. This is the value: the test PR itself ships green and protects against silent regression; the next behavior change forces an explicit assertion update rather than slipping silently into the suite.

**One thing to verify when running the suite the first time:** the `(notion as any).pages.updateMarkdown` cast in the handler. If for any reason the mock's `pages.updateMarkdown` isn't called (e.g., if some future SDK wrapping intercepts it), every test fails on `expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce()`. That would be a code-discovery moment, not a planning gap.

If the builder spots any test going red that wasn't predicted here, **stop and report** rather than auto-fix. A surprise red is either (a) a real bug we didn't predict, or (b) a misread of the handler in this plan — both want orchestrator review before code lands.

---

## 6. Scope boundaries — explicitly NOT in this PR

- **No changes to `src/`.** Test-only PR. The handler stays as-is at `src/server.ts:1123-1146`.
- **No live E2E.** `find_replace` live tests ride with the Tier-1 harness (synthesis §4 stretch test 10, `build-ee-testing-suite-for-live` task).
- **No fix for the zero-match silent success.** T4 documents the gap. The fix (surface a match count or response-markdown-diff or warnings field) belongs in a follow-up that touches the handler. Same for T5's `unknown_block_ids` discard.
- **No tests for other zero-coverage tools.** Frame 5 listed 13 tools with zero handler-level coverage (`search`, `list_pages`, `share_page`, `move_page`, `restore_page`, `delete_database_entry`, `list_users`, `list_comments`, `add_comment`, `archive_page`, `get_me`, `find_replace`, `get_database`). Synthesis §5 suggested folding these into a `tests-handler-integration-coverage` task. This PR is `find_replace` only — closes the destructive-write tool first, leaves the read/list tools for the broader follow-up.
- **No refactor to add a `notion-client.ts` wrapper for `updateMarkdown`.** The handler currently calls `(notion as any).pages.updateMarkdown` directly, escaping our typed wrapper layer. Adding a wrapper would be a structural improvement (matches every other Notion SDK call we make — see `notion-client.ts:417-499` for the wrapping pattern) but it's a separate concern. File a follow-up task for `notion-client-add-update-markdown-wrapper`.
- **No changes to the tool description.** The current description doesn't mention zero-match or unknown-block behavior. Updating it would be helpful but it's a description-text change with separate review concerns (audit B's G-3a covers description warnings for destructive tools).
- **No changes to the warnings field contract.** The PR-2 plan (`.meta/plans/pr2-g3-g4-silent-success-2026-04-18.md` §2) defines the `warnings: [{code, ...}]` shape. Adding `find_replace` to that contract is a future fix-PR concern.
- **No pagination/quota tests.** `find_replace` is a single API call; no pagination concerns.

---

## 7. Rough time estimate for the builder

**~2-3 hours total** (Codex pushed back on the prior 1.5-2h estimate as too optimistic given the mutation-check acceptance criterion and comment-quality bar). Broken down:

| Step | Time | Notes |
|---|---|---|
| Read the planning doc + the 24-line handler + the create-database-response test + the API contract types | 20 min | All required reading; the API types are short but matter for T1 type assertion |
| Set up `tests/find-replace.test.ts` boilerplate (imports, `makeNotion`, `connect`, `parseToolText`) | 15 min | ~60% copy from create-database-response.test.ts; add `pages.updateMarkdown` to the mock factory |
| Write T1 (exact-payload assertion + mandatory `UpdatePageMarkdownParameters` type guard) | 20 min | Most-cited gap; deserves clean diffable assertion; type import path needs verification |
| Write T2 (replace_all flag, two `it` blocks) | 20 min | Two cases; exact-shape `toEqual` |
| Write T3 (truncated passthrough, two `it` blocks) | 15 min | Mirror T2 shape |
| Write T4 (no-match-signal KNOWN GAP, with documenting comment) | 15 min | Comment is the slow part — get it right |
| Write T5 (discarded-fields KNOWN GAP, with documenting comment) | 15 min | Mirror T4 shape |
| Run suite locally; verify green | 10 min | First green run |
| **Mutation check (G1-G8 from §2):** for each, apply the mutation in `src/server.ts`, run the suite, confirm at least one test fails, revert. Document in PR body. | 30 min | This is what makes the test PR credible — Codex flagged it as the slow step the prior estimate underweighted. 8 mutations × ~3-4 min each (edit, test, revert, note). |
| Self-review for naming/comment quality before opening PR; write PR body with mutation-check evidence | 20 min | |

**Time-box discipline:** if mutation-check time runs long, document only G1, G2, G7 (the destructive ones) in the PR body and note the others were verified locally. Don't drop the mutation check itself — it's the test PR's deliverable as much as the test code.

---

## 8. Acceptance criteria for the PR

The PR is shippable when:
1. New file `tests/find-replace.test.ts` exists.
2. `npm test` passes locally on Node 18 + Node 20 (CI matrix per CLAUDE.md line 37).
3. Test count: 7 `it` blocks (T1, T2 ×2, T3 ×2, T4, T5).
4. T1's payload assertion uses `toEqual` (not `toMatchObject`) and the captured argument is annotated with `UpdatePageMarkdownParameters` from `@notionhq/client/build/src/api-endpoints.js` — this is the typecheck-time guard against SDK shape drift.
5. Each test's name is self-explanatory enough to read without code context.
6. T4 and T5 both contain the documenting comment block (per §4.2) explaining they pin a known gap and what would flip them.
7. No changes to `src/` or other tests.
8. **Mutation check (in PR description):** the builder ran each of the G1-G8 mutations from §2 against their working tree and confirmed at least one test goes red for each. The PR body lists each mutation with the test name that caught it. (Codex's review flagged G7 — `allow_deleting_content: true` — as a destructive mutation the prior plan would have missed; it MUST be in the mutation-check list.)

---

## 9. Codex review notes

This plan was reviewed by Codex (session: `plan-review-find-replace-tests-2026-04-20`). Codex's verdict was **revise** (not ship as-drafted); five must-fix items were identified, all accepted and applied to the plan. Full review record at §10 below.

---

## 10. Codex review record

**Session:** `plan-review-find-replace-tests-2026-04-20` (codex-5.3, reasoningEffort: high, ran 3m 25s, $1.21).

**Verdict:** Revise. Core direction confirmed (mock-only handler coverage is the right acute fix; live-E2E correctly deferred); five must-fix items in the original draft.

**Material adjustments accepted and applied:**

1. **§2 G3 row reframed.** Codex: "T3 only tests `truncated` passthrough; it does not kill G3, and G3 is not really a one-line mutation here." Rewrote the G3 row to acknowledge the current behavior is already `success: true` unconditional and the concern is preventing accidental refactor away from that. T3's coverage scope clarified at §4.2.

2. **§2 added G7 (`allow_deleting_content: true`) and G8 (duplicate `content_updates` entry).** Codex: "A one-line mutation adding `allow_deleting_content: true` would materially change behavior and still pass T1-T6 as written." This is a real destructive-mutation gap the original plan missed. T1 strengthened from spread-style assertions to exact-shape `toEqual` to catch G7/G8. Also propagated to T2's assertion style.

3. **§1.1 corrected `unknown_block_ids` semantic claim.** Codex: "the type file does not establish the planner's stronger semantic claim that `unknown_block_ids` means 'blocks it could not render to markdown.'" Added an explicit correction note distinguishing what the type contract proves vs. inferred runtime semantics; reframed §2.1's bullet on `unknown_block_ids` accordingly.

4. **T4 reframed.** Codex: "the handler never inspects `markdown` at all. So this is not testing zero-match handling in any real sense." Honest framing: T4 pins "the handler shape contains no match-related field, regardless of what Notion sent" — not "Notion's zero-match behavior."

5. **T4 and T5 added `expect(notion.pages.updateMarkdown).toHaveBeenCalledOnce()`.** Codex: "If the handler stopped calling `pages.updateMarkdown` and just returned `{success:true}`, T5 would still pass." Without the call assertion, regression to a stub-only handler would slip through. Added to both.

6. **§2 G6 rationale corrected.** Codex: "the outer `try/catch` would catch a thrown error, so the tool would return an error envelope, not crash. T1 still catches that class of bug because `updateMarkdown` would not be called, but the current rationale is sloppy." Reworded T1's G6 catch to point at the `toHaveBeenCalledOnce()` failure rather than a (nonexistent) crash.

7. **T6 dropped.** Codex: "T6 is bloat for this PR. The plan itself says empty-string behavior is a Notion-side semantics question better suited to live E2E." Accepted; removed.

8. **§7 estimate bumped 1.5-2h → 2-3h.** Codex: "the mutation-proof step is not [quick]. I'd budget 2-3 hours for a careful builder." Adjusted; mutation check broken out as its own line item with realistic per-mutation time.

9. **§4.1 type guard upgraded from optional to mandatory.** Codex: "I would tighten making the `UpdatePageMarkdownParameters` type check mandatory, not optional, because this path bypasses the normal typed wrapper layer noted in CLAUDE.md." Accepted; mandatory in T1 (the canonical payload-shape test); other tests don't need their own.

**Nothing overruled.** Every Codex must-fix and nice-to-have was accepted. The architecture decision in §3 was confirmed by Codex independently — that's the section the plan author was most prepared to defend, and didn't need to.

**One thing Codex did not flag that the planner is keeping despite the small risk of dead-code feeling:** T5 (the discarded-fields known-gap pin). Codex didn't push back on it, but it's worth recording: this test exists primarily as a canary for a future warnings-field PR, not because the current behavior is provably wrong. If a reviewer asks "what is this protecting?", the answer is "a known-gap pin so a future PM doesn't ship a behavior change without flipping the assertion." That justification is in the test comment itself.

---

## 11. Session chain

- **Planner PM:** this session.
- **Codex reviewer:** `plan-review-find-replace-tests-2026-04-20` (foreground; per memory `feedback_agent_foreground.md`).
- **No research agents:** all research was direct file reads — the convergence work was already done by the frame sweep at commit `d144665`. Re-spawning research would have been duplicative.

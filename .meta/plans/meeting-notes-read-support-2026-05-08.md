# Plan: In-house Notion AI meeting-notes / transcription read support

**Date:** 2026-05-08 (revised 2026-05-09 after Codex review)
**Initiative:** GitHub issue #60, replacing PR #61 with maintainer-hardened implementation
**Gating decision:** `pr61-require-live-meeting-notes-shape-before-merge` (decisions.md:58)
**Evidence basis:** `tmp/nick.json` (live happy-path capture, 2026-05-08); PR #61 diff (structural reference)
**Notion-Version:** validated against the version pinned in this repo (currently 2025-09-03 per `project_notion_version_pin`); if the live meeting-notes shape changes under a future bump, the captured fixture and probe must be re-run before shipping.
**Codex review:** session `plan-review-meeting-notes-2026-05-08` (full critique kept locally at `.meta/handoffs-private/2026-05-09-codex-plan-review-meeting-notes.md`; not in the public record). Findings integrated below; CLI scope and one structured-access framing surfaced as open questions in §7.

---

## 1. Architectural fork and recommendation

**Fork:** Render `meeting_notes` / `transcription` as a synthetic toggle inside the existing `read_page` / `read_block` / `read_section` / `read_toggle` pipeline (PR #61's shape), **vs.** add a dedicated `read_meeting_notes` tool returning structured fields (title / status / recording / sections).

**Recommendation: render-as-toggle only.** Reasons:

- The whole read surface is markdown-first. A structured-fields tool breaks the consistency callers have built around — every other read tool returns markdown plus warnings.
- Issue #60 frames the ask as "present this block type as a read-only block." Inline rendering matches that exactly; a follow-up `read_block(section_pointer_id)` already exists for callers who want a single section.
- A structured tool is deferred for scope and API-surface consistency, not because demand is absent. PR #61's body explicitly cites "agent workflows" as the motivator and the live block exposes `recording.start_time` / `recording.end_time` (`tmp/nick.json:399-402`). When a second caller asks for programmatic access to those fields, revisit a dedicated `read_meeting_notes` tool that returns structured fields. (Backlog trigger captured in §6.)
- PR #61 already adds the flag `include_transcript` to `read_page`. Keep it there only. **Do not** thread it onto `read_block` / `read_section` / `read_toggle` in this slice — none of those tools currently page-aware, and the transcript opt-in only makes sense at page granularity.

**Other forks worth naming:**

- **`recording` rendering:** as an INFO callout child (`> [!INFO]\nRecorded 2026-05-08T14:54:00Z – 2026-05-08T14:58:00Z`) inside the synthetic toggle. Visible, round-trip-safe, only emitted when both `start_time` and `end_time` are present.
- **`status` rendering:** suppress when value is `notes_ready` (the happy state — would otherwise be noise on every meeting). Render literal `Status: <value>` for any other string (covers unobserved values without guessing semantics).
- **`max_blocks` and section content:** PR #61 fetches section descendants via `fetchBlocksRecursive` (unbounded), not `fetchBlocksWithLimit`. This is consistent with existing behavior — `fetchBlocksWithLimit` already calls `fetchBlocksRecursive` for normal-block children at server.ts:1275. Document the unboundedness in the tool description; do not introduce a budget-threading change in this slice.

---

## 2. Risk → defense map

| Risk | Defense |
|---|---|
| Malformed rich_text title (mention nodes — confirmed in capture, lines 372-391) | Use existing `richTextPlainText` helper (server.ts:433) for the title — already harvests `plain_text` for any rich_text variant. Do **not** add PR #61's duplicate `plainText` helper (naming clash, weaker semantics). |
| Mentions inside section descendants (Codex finding — confirmed user-mention in capture, lines 917-942) | The synthetic toggle's children are normal blocks rendered through `blocksToMarkdown`, whose `richTextToMarkdown` (`src/blocks-to-markdown.ts:26-29`) dereferences `item.text.content` and returns empty string for mentions. Fix at the boundary, not the renderer: in `normalizeBlock`, normalize every rich_text array through a small helper that flattens non-text variants (mention, equation) into `{ type: "text", text: { content: item.plain_text ?? "" } }` carrying any `href` and `annotations`. Keeps `RichText` type narrow (no `types.ts` widening) and makes downstream renderers correct by construction. |
| Missing or stale section pointer (decision-named risk; PR #61 unguarded) | Wrap the **entire per-section fetch** (root retrieve + descendant listing) in try/catch and only mutate `children` after the fetch resolves. PR #61 (`src/server.ts:+894-898`) pushes the section heading before awaiting body, which would leave a dangling heading if the descendant fetch fails. On failure: append no heading, no body, and record one `sections_unreadable` entry; continue rendering other sections. |
| Unknown block types in section descendants | Already handled — `ctx.omitted` flows through `fetchBlocksRecursive` (server.ts:884). Ensure the call from `hydrateMeetingNotesBlock` passes the same `ctx`. |
| `status` other than `notes_ready` (unobserved) | Render literal string. Do not enumerate enum values; treat as opaque. |
| Section content via `has_children` instead of pointers (unobserved) | Fallback: when no pointers present and `raw.has_children`, fetch direct children via `fetchBlocksRecursive` regardless of `include_transcript`. PR #61 gates the fallback on `include_transcript` — wrong: an entire meeting block would render empty for non-transcript callers. |
| `recording` field absent or partial (unobserved) | Only emit the recording callout when `recording?.start_time` and `recording?.end_time` are both non-empty strings. No partial render. |
| Deprecated `transcription` variant (no live sample) | Share one hydrate function, branch on type at the discriminator only. Add a one-line code comment that shape parity is per Notion deprecation note — not live-verified. |
| `hasVisibleContent` missing default branch (PR #61 bug) | Don't introduce it. The existing pipeline already handles "block normalizes to nothing" via the `null` return path of `normalizeBlock`; PR #61's helper duplicates poorly. Synthetic toggles always have a title, so they always pass the visibility check; no new helper needed. |
| Targeted read tools (`read_block` / `read_section` / `read_toggle`) ignore `renderedReadOnly` | Allocate ctx with `renderedReadOnly: []` in those handlers (server.ts:2416, 2435, 2464) and emit the new warning when non-empty. PR #61 missed this — meeting notes called via targeted reads would render but silently drop the round-trip warning. |

---

## 3. File-level changes

- **`src/server.ts`**
  - Extend `FetchContext` (server.ts:521) with `renderedReadOnly?: ReadOnlyRenderedBlock[]` and `includeTranscript?: boolean`.
  - Add `transcription`, `meeting_notes` to `SUPPORTED_BLOCK_TYPES` (server.ts:529).
  - Add a small `normalizeRichText(items: any[])` helper (or fold into `normalizeBlock`) that maps every rich_text item to a `RichText`-shaped text node, using `item.plain_text ?? item.text?.content ?? ""` and preserving `annotations` and `text.link.url` (from `item.href` for mentions). Apply it to every rich_text array `normalizeBlock` currently passes through as `any` (server.ts:689-710 and the rest of the switch).
  - Add `meeting_notes` / `transcription` cases in `normalizeBlock` (server.ts:672) returning a synthetic `toggle` whose title comes from `richTextPlainText(payload.title)` prefixed `"AI Meeting Notes: "` (or just `"AI Meeting Notes"` when title is empty).
  - Add `hydrateMeetingNotesBlock` — defensive variant of PR #61's, with the changes named in §2 (per-section try/catch wrapping retrieve + descendant fetch; mutate `children` only after success).
  - Call `hydrateMeetingNotesBlock` from `fetchBlocksRecursive` (server.ts:873), `fetchBlocksWithLimit` (server.ts:1242), `fetchBlockRecursive` (server.ts:903), and `fetchRawBlocksRecursive` (server.ts:924). PR #61 wires only the first two — confirmed via diff hunks at `src/server.ts:+1023` and `src/server.ts:+1198`.
  - Promote `omittedBlockWarnings` (server.ts:1202) to `readWarnings(ctx)` returning both `omitted_block_types` and `read_only_block_rendered` entries from one `ctx`. Update its 5 callers.
  - Add `READ_ONLY_BLOCK_RENDERED_MESSAGE` constant (single source of truth for the warning text).
  - `read_page` handler (server.ts:2755): accept `include_transcript`, pass through ctx.
  - `duplicate_page` handler (server.ts:2814): emit the same warning shape.
  - Update tool descriptions for `read_page` and `duplicate_page`; remove `meeting_notes` from `duplicate_page`'s "omitted types" example list.
  - **Update warnings doc resource at server.ts:258 (blocking, not polish):** the existing `omitted_block_types` section is the documented "do not round-trip" signal (server.ts:267-279, 1563-1565). Adding `read_only_block_rendered` extends the round-trip-loss contract — callers must know to check both codes. Add the new section listing the shape and per-block `transcript_omitted` / `sections_unreadable` subfields, and update the round-trip caveat in the doc to name both codes.

- **`src/types.ts`** — no changes. The `RichText` type stays narrow (text-only); the new `normalizeRichText` helper above flattens mention/equation variants at the boundary so renderers and types stay aligned. (Deferred alternative: widen `RichText` to a discriminated union if a future write path needs to round-trip mentions structurally — not in this slice.)

- **`src/blocks-to-markdown.ts`** — no changes. The renderer's `richTextToMarkdown` (lines 26-29) keeps using `item.text.content`; correctness comes from `normalizeRichText` upstream.

- **`README.md`** — line 497 currently lists `meeting_notes` among omitted block types and warns only about `omitted_block_types`. Update both: remove `meeting_notes` from the omission list, add a sentence on `read_only_block_rendered`.

- **`tests/block-warnings.test.ts`** — replace the single `meeting_notes` case (line 145) with the assertions in §4. Promote `meetingNotes()` builder to accept full payload.

- **`tests/meeting-notes-read.test.ts`** (new) — focused fixtures matching `nick.json` shape; keeps `block-warnings.test.ts` from sprawling.

- **`CHANGELOG.md`** — entry under unreleased / v0.9.1.

- **CLI (`src/cli/run.ts`)** — see open question Q1 in §7 for whether parity ships in this slice. If yes: add `--include-transcript` to `page read` and `page duplicate`, and surface `read_only_block_rendered` warning in CLI output for `page read`, `page duplicate`, `section read`, `toggle read`, and `block read` (current omission-only contexts at `src/cli/run.ts:933`, `src/cli/run.ts:1032`, `src/cli/run.ts:1170`, `src/cli/run.ts:1209`, `src/cli/run.ts:1689`).

**Warning code names introduced (public surface — name deliberately):**

- `read_only_block_rendered` (warning code; kept from PR #61). Documented as a round-trip-loss warning alongside `omitted_block_types`.
- `transcript_omitted: true` (per-block subfield, present only when transcript existed but was suppressed by `include_transcript: false`).
- `sections_unreadable: [{ key: "summary_block_id" | "notes_block_id" | "transcript_block_id" | <future>, block_id: string, code?: string }]` (per-block subfield, object array — not bare strings — so future Notion section keys don't require a breaking warning-shape change). Per-block, present only when one or more `blocks.retrieve` calls failed.

---

## 4. Test plan (TDD-first)

All fixtures written before implementation. Group by file.

**`tests/meeting-notes-read.test.ts` (new)**

- **Happy path mirroring `nick.json`:** top-level `meeting_notes` block with `title` containing two text nodes plus `mention.date`, `status: "notes_ready"`, all three section pointers, `recording: { start_time, end_time }`. Section pointers retrieve to empty paragraphs with `has_children: true`; descendants are heading_3 / to_do / bulleted_list_item, one bullet containing `mention.user`. Assert:
  - Markdown contains synthetic toggle `+++ AI Meeting Notes: <plain_text>` (title harvested via `richTextPlainText`, including the date mention's `plain_text`).
  - Markdown contains an INFO callout with both ISO timestamps.
  - Markdown contains `## Summary` and `## Notes` headings with descendants rendered.
  - Markdown does **NOT** contain `## Transcript` or transcript descendants when `include_transcript` is omitted/`false`.
  - `warnings` has one `read_only_block_rendered` entry with `transcript_omitted: true`.
  - **Mock-call assertion:** assert the transcript-pointer block ID does **not** appear in any `blocks.retrieve` mock call's arguments when `include_transcript: false`. Do **not** assert exact call ordering or total retrieve count — those are implementation details. The behavior under test is "do not fetch transcript content," which is observable as the absence of the transcript ID in retrieve args.
  - With `include_transcript: true`, `## Transcript` is present, `transcript_omitted` is absent, and the transcript pointer ID **does** appear in `blocks.retrieve` mock args.

- **Title mention-of-type-date:** as above (covered by happy path).

- **Title mention-of-type-user inside a section descendant:** assert the bullet renders the mention's `plain_text` without throwing.

- **Stale section pointer:** transcript pointer resolves to `blocks.retrieve` rejection with `object_not_found`. Assert: summary + notes still render, no exception thrown, warning entry has `sections_unreadable: [{ key: "transcript_block_id", block_id: <id>, code: "object_not_found" }]`, transcript section heading absent (atomicity — no dangling heading without body).

- **All section pointers absent + `has_children: true` (fallback path) — pre-implementation failure guard:** `meeting_notes.children` is `{}`. Call `read_page` with **default** args (no `include_transcript`). Assert: descendants of the meeting_notes block ID itself are fetched and rendered inside the toggle. This is the test that fails on PR #61's `if (raw.has_children && includeTranscript)` gate — must fail before the fix lands.

- **Unknown `status` value:** `status: "processing_failed"`. Assert markdown contains literal `Status: processing_failed`.

- **Status `notes_ready` is suppressed:** assert markdown does **not** contain `Status:` line.

- **Deprecated `transcription` variant:** identical payload under `type: "transcription"`. Assert renders the same as `meeting_notes`.

- **Unknown block type inside a section's descendants:** insert a `synced_block` under the summary pointer's children. Assert: warnings contain both `omitted_block_types` (with the synced_block) **and** `read_only_block_rendered` (with the meeting_notes block) — proves both accumulators flow.

- **Empty `recording` field:** `recording: null`. Assert no INFO callout rendered, no exception.

- **Partial `recording`:** only `start_time` present. Assert no INFO callout (no half-rendered output).

**`tests/block-warnings.test.ts`**

- Replace the existing `meeting_notes` omission test (line 145) with the warning-shape assertion: `code: "read_only_block_rendered"`, `blocks: [{ id, type, transcript_omitted: true }]`, `message: <constant>`.
- Add an assertion that `SUPPORTED_BLOCK_TYPES` contains `meeting_notes` and `transcription` (drift guard — same pattern as existing tests).

**Targeted-read coverage:**

- `read_block` against a `meeting_notes` block ID renders the synthetic toggle and emits the `read_only_block_rendered` warning. **This test fails on PR #61** because PR #61 patched only `fetchBlocksRecursive` and `fetchBlocksWithLimit`, not `fetchBlockRecursive` (which `read_block` uses at server.ts:2435-2436). Required acceptance test, not optional.
- `read_section` containing a `meeting_notes` block in its range emits the warning.
- `read_toggle` does not match a synthetic meeting-notes toggle by title. Note: this assertion is about **raw-block discovery** (the underlying type is still `meeting_notes`, and `getToggleTitle` at server.ts:441-451 runs against raw children before normalization). It is a behavior-of-discovery assertion, not a user-visible "synthetic toggles aren't lookupable" guarantee. If a future change moves discovery post-normalization, the assertion intent must be revisited.

---

## 5. Tool surface and schema changes

**`read_page`** — add one parameter:

```json
"include_transcript": {
  "type": "boolean",
  "description": "Include Notion AI meeting-notes transcript sections. Default false. Summary and Notes sections are always included when present."
}
```

Description delta (additions in `read_page` description):

> Notion AI meeting notes are rendered as a synthetic toggle containing the title, an optional recording timestamp callout, and `## Summary` / `## Notes` heading sections. Transcript sections are included only with `include_transcript: true`. A `read_only_block_rendered` warning is emitted whenever such a block is rendered, indicating that round-tripping the markdown through `replace_content` will replace the native meeting-notes block with ordinary blocks. **Note on `max_blocks`:** the cap counts top-level page blocks only; section descendants of meeting-notes blocks are fetched in full regardless of the cap, consistent with how nested children of normal blocks are fetched.

**`duplicate_page`** — description delta: remove `meeting_notes` from the "omitted types" example list (it is now duplicated as ordinary blocks); add a sentence noting `read_only_block_rendered` warning identifies meeting-notes blocks whose native identity was not preserved. Default `include_transcript: false` — same conservative default as read_page.

**`read_block` / `read_section` / `read_toggle`** — no schema change. Description gains one sentence: "Notion AI meeting-notes blocks encountered in the result are rendered as a synthetic toggle and produce a `read_only_block_rendered` warning. Transcripts are not included from these tools."

**Warnings doc resource (`easy-notion://docs/warnings`)** — append section documenting `read_only_block_rendered` shape with `transcript_omitted` and `sections_unreadable` subfields.

---

## 6. Scope estimate and subtasks

**Estimate:** ~6-10 dev-hours **without** CLI parity, ~8-12 dev-hours **with** CLI parity (open question Q1 in §7). Single coherent slice; no dependencies blocked. Includes Codex review of the build PR.

**Subtasks (serial):**

1. Write all tests in `tests/meeting-notes-read.test.ts` and update `tests/block-warnings.test.ts`. Run; expect failures (including the targeted-read `read_block(meeting_notes_id)` test and the pointerless-fallback test, both of which would fail on PR #61).
2. Extend `FetchContext`, add types, add `transcription`/`meeting_notes` to `SUPPORTED_BLOCK_TYPES`, add `normalizeRichText` boundary helper, add `normalizeBlock` cases. Run subset; expect partial green.
3. Implement `hydrateMeetingNotesBlock` with all defensive branches from §2 (per-section atomic try/catch).
4. Wire `ctx.renderedReadOnly` allocation through the four read handlers and `duplicate_page`. Promote `omittedBlockWarnings` → `readWarnings`.
5. Update tool descriptions, `easy-notion://docs/warnings` resource, and `README.md` line 497. Run full suite.
6. CHANGELOG entry, version bump.
7. **(conditional on Q1)** CLI parity: `--include-transcript` flag and `read_only_block_rendered` warning surfacing in CLI commands.

**Must-ship for v0.9.1 (additive patch):** subtasks 1-6, plus 7 if Q1 is "include CLI."

**Could ship later (v0.10.0 or beyond), filed as backlog tasuku tasks with triggers:**

- `include_transcript` on targeted-read tools — trigger: "user asks to fetch transcript via `read_block` or `read_section`."
- A dedicated `read_meeting_notes` tool returning structured fields (`title`, `status`, `recording`, section IDs) — trigger: "second caller asks for programmatic access to `recording.start_time` or section pointers." Render-as-toggle ships first to satisfy issue #60 and stay markdown-consistent; structured access is deferred for scope, not because demand is theoretical.
- Threading the `max_blocks` budget into section descendants — trigger: "user reports a page where meeting-notes section content blew the cap."
- Live e2e probe that re-captures the meeting-notes shape under the configured Notion-Version — trigger: "Notion-Version bump ships, or contributor reports shape mismatch." Existing live-mcp infra at `tests/e2e/live-mcp.test.ts` (NOTION_VERSION-aware around lines 1183, 1254) is the right home.

---

## 7. Open questions for James

The original three plus two surfaced by Codex review.

1. **CLI parity — ship in v0.9.1 or defer?** (Codex Required #4.) The decision `cli-skill-surface-profile-aware-cli` (decisions.md:18) commits to CLI parity for read-surface work, and the targeted-reads patch (decision `targeted-read-tools-scope`, decisions.md:43) set the precedent of "CLI parity ships in the same patch." But it adds 2-4 hours and touches 5 CLI handler sites (`src/cli/run.ts:933, 1032, 1170, 1209, 1689`). **Recommend include CLI parity in v0.9.1** to honor the established pattern; "no, defer it" would need a reason to break the pattern just for this slice. Pick: include or defer.

2. **`recording` rendering — INFO callout vs italic paragraph?** Recommend INFO callout (`> [!INFO]\nRecorded …`) — visible, callout-shape signals "out-of-band metadata," and round-trips cleanly. Italic paragraph would inline awkwardly. Confirm or pick alternative.

3. **`status: "notes_ready"` — suppress on render, or always show?** Recommend suppress (it's the happy path; rendering on every meeting block is noise). Trade-off: callers can no longer distinguish "happy path" from "field absent." Confirm suppress, or prefer always-show. (Both `notes_ready` suppression and unknown-status rendering remain required acceptance tests either way, per Codex Required #9.)

4. **Version target — v0.9.1 patch, or hold for v0.10.0 bundled with other work?** Recommend v0.9.1 patch: the change is purely additive (no behavior change for non-meeting pages, new optional flag, new warning code). Holding for v0.10.0 only makes sense if you want it bundled with views or something that's already in flight. Confirm patch, or name the v0.10.0 bundle.

---

**Pressure-test session:** Codex `plan-review-meeting-notes-2026-05-08` (full critique kept locally at `.meta/handoffs-private/2026-05-09-codex-plan-review-meeting-notes.md`; not in the public record). Nine Required findings integrated into §1-§6; two surfaced as new open questions Q1 (CLI scope) above. All Suggested findings integrated. The build dispatcher should reference the Codex session ID when handing this to the builder.

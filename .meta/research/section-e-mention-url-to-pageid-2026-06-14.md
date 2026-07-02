# §E probe — building a Notion page-mention block from a URL

**Date:** 2026-06-14
**Mode:** READ-ONLY investigation (no `src/` edits, no commits)
**Question:** For the 1.0 conventions-v1 freeze, can `@[Title](url)` → page-mention block be built
*cheaply* (no API round-trip, reliable), or must 1.0 ship reject-or-warn?

---

## Verdict (TL;DR)

**CHEAP.** A page-mention rich-text item needs only a **page id string** — no URL, no round-trip.
The id is embedded verbatim in every Notion page URL as a trailing 32-hex run, and extracting it is
pure string parsing (one regex). Constructing the mention is therefore free.

**Recommendation: ADD the convention** for 1.0, with one honest caveat about *runtime* reliability
(see "The one real risk" below) that argues for a **warn-on-failure fallback**, not a pre-flight check.

So the shape I'd ship: **add `@[Title](url)` → page-mention, and if Notion rejects the id at
append time, fall back to a plain hyperlink + emit a warning** (mirrors the existing
`bookmark_lost_on_atomic_replace` warning pattern). This keeps construction cheap *and* never hard-fails
a whole page write because one mention target was inaccessible.

---

## 1. What a page-mention request actually requires (SDK citation)

`node_modules/@notionhq/client/build/src/api-endpoints/common.d.ts`

```ts
// line 1531
type MentionRichTextItemRequest = {
    type?: "mention";
    mention: {
        ...
    } | {
        type?: "page";
        page: {
            id: IdRequest;     // line 1542
        };
    } | ...
};
```

And `IdRequest` is just a string:

```ts
// line 387
export type IdRequest = string;
```

**Conclusion:** the page-mention *request* shape is `{type:'mention', mention:{type:'page', page:{id: <string>}}}`.
It takes an **id**, never a URL. There is no URL-accepting variant. (The *response* shape,
`MentionRichTextItemResponse` at line 451, is symmetric — `page: { id: IdResponse }` at line 466-468.)

The id string is passed straight to the Notion REST API. The API accepts the 32-hex form and the
dashed-UUID form interchangeably, so no canonicalization is strictly required (canonicalizing to dashed
UUID is a safe nicety, not a necessity).

---

## 2. Can we cheaply derive a page-id from a Notion URL? (codebase evidence)

### 2a. Notion URLs embed the id — extraction is pure string work

Every Notion page URL carries the page id as a trailing 32-hex run on the last path segment, e.g.:

- `https://www.notion.so/Some-Page-Title-1a2b3c4d5e6f7081920a1b2c3d4e5f60`
- `https://www.notion.so/1a2b3c4d5e6f7081920a1b2c3d4e5f60`
- `https://www.notion.so/workspace/Title-<32hex>?pvs=4` (trailing query is dropped)
- `https://www.notion.so/<dbid>?v=<viewid>&p=<32hex>` (a *peeked* page — id lives in the `p=` query param)

A robust-yet-cheap extractor: check the `p=` query param first, else strip query/hash and pull the
trailing 32-hex (or 36-char dashed UUID) off the last path segment. One regex, no network. This is the
same class of work the codebase already does for `notion-upload:` sentinel links
(`src/markdown-to-blocks.ts:488-489`, splitting a synthetic link href on `:`).

### 2b. We have NO existing URL→id helper — and that's fine, because nothing needs one yet

`resolveParent` (`src/server.ts:2251-2279`) takes `explicitParentId` and passes it **straight through**
to the API as `page_id` (line 2257) with zero parsing — it assumes callers already hand it a bare id, not
a URL. So there is no prior art to reuse, but also no conflicting behavior to break.

### 2c. Where id-extraction + mention construction would live

The `@[Title](url)` inline syntax flows through the inline tokenizer:

- Inline link tokens are handled at `src/markdown-to-blocks.ts:91-101` (`case "link"`), which today turns
  any `[text](href)` into a hyperlinked `text.link` rich-text item via `createRichText`
  (`src/markdown-to-blocks.ts:32-33`). **This is exactly the "silently degrades to a plain hyperlink"
  path the dogfood research flagged.** With marked, `@[Title](url)` lexes as a literal `@` text token
  immediately followed by a normal `link` token — the `@` is inert text, the link is an ordinary
  hyperlink. That's the degradation, confirmed mechanically.
- The natural home for the new convention: detect the `@`-prefixed link in `inlineTokensToRichText`
  (around line 50-114), and when the href is a Notion URL, emit a `mention` rich-text item instead of a
  `text.link` item. A small `notionUrlToPageId(url): string | null` helper would sit next to `isSafeUrl`
  (`src/markdown-to-blocks.ts:11-16`) — same file, same "URL utility" neighborhood.
- Sanitization already preserves non-text rich-text items on the write path (see the scoped learning:
  "preserve valid non-text rich text items … so read-derived write paths do not … lose mentions").
  `src/rich-text.ts:42-54` only special-cases `text.link` and strips response-only fields; a `mention`
  item passes through intact. So the outbound sanitizer needs **no** change to carry a mention.

**Net:** construction is a localized change in one file (`markdown-to-blocks.ts`), no new infra, no
round-trip, and the existing rich-text sanitizer already tolerates mention items.

---

## 3. The one real risk (why I recommend warn-on-failure, not just "add")

Parsing the id is cheap and reliable. The *runtime* uncertainty is entirely on Notion's side:

**The mention's target page must be shared with the integration.** Notion validates `mention.page.id`
at append time — the page must exist and be accessible to the integration token. If `@[Title](url)`
points to a page the integration can't see, the API rejects the **entire block append**, not just that
one rich-text item. A naive "always emit a mention" would let one inaccessible link hard-fail a whole
page write.

This is *not* a reason to do a pre-flight `retrieve` round-trip (that would make it "not cheap" and
still races against permission changes). It's a reason to **construct the mention cheaply, and on API
rejection fall back to a plain hyperlink + warning** — the codebase already has this exact pattern for
bookmarks lost on atomic replace (`src/server.ts:1582`, `bookmark_lost_on_atomic_replace`).

A secondary, smaller reliability note: the `?p=<id>` peek-URL form and dashed-vs-undashed UUID form
both need to be handled in the extractor or some valid URLs will silently miss. Cheap to cover, but
must be covered or it becomes a flaky-by-input convention.

---

## 4. Cost / reliability comparison

| Option | Construction cost | Reliability | What 1.0 user sees |
|---|---|---|---|
| **Add (cheap construct + warn-on-failure)** | Pure string parse, 0 round-trips; ~1 helper + 1 inline branch in `markdown-to-blocks.ts` | High for parse; runtime depends on integration share — handled by fallback | `@[Title](url)` becomes a real page mention; if target unshared → hyperlink + warning |
| Add (pre-flight verify via retrieve) | 1 API round-trip **per mention** | Higher upfront certainty but slower, rate-limit exposure, still races perms | Same, but slow on mention-heavy pages |
| **Reject/warn only (defer convention)** | ~0 | N/A | `@[Title](url)` rejected or warned; mention support arrives post-1.0 (additive, non-breaking) |

The pre-flight-verify row is dominated: it costs a round-trip and *still* needs the same failure
fallback, so it buys nothing the cheap+warn path doesn't.

---

## 5. Recommendation

**ADD the `@[Title](url)` → page-mention convention for 1.0**, built the cheap way:

1. `notionUrlToPageId(url)` helper next to `isSafeUrl` in `markdown-to-blocks.ts` — extract trailing
   32-hex / dashed-UUID from the path, with `p=` query-param fallback; return `null` if no id found.
2. In the inline tokenizer, when an `@`-prefixed link resolves to a Notion URL with an extractable id,
   emit `{type:'mention', mention:{type:'page', page:{id}}}` instead of a `text.link`. If
   `notionUrlToPageId` returns `null` (non-Notion URL, or unparseable), fall back to today's hyperlink
   behavior (optionally with a warning).
3. On API rejection at append time (target page not shared with the integration), fall back to a plain
   hyperlink and emit a warning in the existing warnings channel (mirror
   `bookmark_lost_on_atomic_replace`).

This is cheap, localized, non-breaking, and the sanitizer already carries mention items. The only thing
that makes it *not* trivially safe is the integration-share runtime failure, and that's fully addressed
by warn-on-failure rather than a round-trip.

If the team wants the absolute-minimum-surface 1.0, **reject/warn is a legitimate fallback** — the
convention is purely additive, so shipping it later breaks nothing. But the evidence does not support
"it's too expensive/unreliable to add" — construction is genuinely cheap.

---

## Evidence index

- **SDK page-mention shape:** `node_modules/@notionhq/client/build/src/api-endpoints/common.d.ts:1531-1559`
  (request, `page.id: IdRequest` at line 1542), `:387` (`IdRequest = string`), `:451-469` (response).
- **Current "degrades to hyperlink" path:** `src/markdown-to-blocks.ts:91-101` (`case "link"`),
  `:32-33` (`createRichText` link assignment).
- **Where the helper would live:** next to `isSafeUrl`, `src/markdown-to-blocks.ts:11-16`.
- **No existing URL→id parsing; parent id passed through raw:** `src/server.ts:2251-2279` (`resolveParent`).
- **Sanitizer already preserves non-text (mention) items:** `src/rich-text.ts:42-54`; scoped learning
  `.claude/rules/tasuku/learnings-scoped.md`.
- **Existing warn-on-degradation precedent:** `src/server.ts:1582` (`bookmark_lost_on_atomic_replace`).

## Session chain

No sub-agents or Codex sessions spawned — SDK type defs + direct codebase reads were conclusive and
sufficient (per the brief, this is the deliverable). Live MCP confirmation not run; not needed.

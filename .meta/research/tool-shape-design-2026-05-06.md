# easy-notion CLI + lightweight skill tool-shape design

**Date:** 2026-05-06  
**Owner/scope:** CLI, lightweight skill, and MCP tool-shape design memo only. No implementation changes.  
**Trigger:** ivalsaraj enhancement request: expose a CLI plus a lightweight skill because multiple Notion integrations, such as read-only, read-write, and personal read-only keys, multiply MCP tool context across 29-tool server registrations.

## Recommendation

If James accepts this design, the next build should create one primary surface: a profile-aware `easy-notion` CLI, plus a standalone lightweight skill that teaches agents to call that CLI. This is a conditional design recommendation, not build approval. Do not make the first skill a Claude Code plugin that enables the MCP server, and do not rely on MCP tool consolidation as the main context-saving move.

The CLI should be a new npm bin, separate from the existing server bins:

- `easy-notion-mcp`: unchanged stdio MCP server.
- `easy-notion-mcp-http`: unchanged HTTP MCP server.
- `easy-notion`: new human/agent CLI.

Agents should call it through npm without a global install:

```bash
npx -y --package easy-notion-mcp easy-notion --profile work-ro page read PAGE_ID --format json
```

Humans can install globally or use the same `npx --package` form. The CLI should be JSON-first, with optional human formatting:

```bash
easy-notion --profile work-ro search "roadmap" --format table
easy-notion --profile work-rw page section PAGE_ID --heading "Status" --markdown-file status.md
easy-notion --profile personal-ro db query DB_ID --filter-file filter.json --format json
```

The lightweight skill should not register MCP tools. Its job is to keep only a small command reference and routing guide in the agent context. The skill body should say: use `easy-notion` for Notion work, choose a profile explicitly, use JSON output for machine reads, use file/stdin flags for large markdown or batch payloads, and treat destructive commands with the same safety rules as the MCP tools.

This directly addresses the market signal. A user with three Notion integrations should not need three MCP servers and roughly three copies of the 29-tool list in context. They should have one lightweight skill plus three CLI profiles.

## CLI Shape

The CLI should mirror the MCP primitives by capability, not by exposing a flat list of 29 command names. Use noun groups and stable command names that map cleanly to the existing server behavior:

```text
easy-notion [global options] <group> <command>

Global:
  --profile <name>
  --format json|pretty-json|table|markdown
  --quiet
  --no-trust-content

Profiles:
  profile list
  profile show <name>
  profile add <name> --token-env NOTION_WORK_RO --mode readonly --root-page-id ...
  profile check <name>

Pages/content:
  search <query> [--filter pages|databases]
  page read <page> [--include-metadata] [--max-blocks n] [--max-property-items n]
  page create --title <title> [--parent <page>] (--markdown <text>|--markdown-file <path>|--stdin)
  page update <page> [--title ...] [--icon ...] [--cover ...]
  page duplicate <page> [--title ...] [--parent ...]
  page move <page> --parent <page>
  page archive <page>
  page restore <page>
  content append <page> (--markdown ...|--markdown-file ...|--stdin)
  content replace <page> (--markdown ...|--markdown-file ...|--stdin)
  content section <page> --heading <text> (--markdown ...|--markdown-file ...|--stdin)
  content find-replace <page> --find <text> --replace <text> [--all]
  block update <block> (--markdown ...|--markdown-file ...|--archive) [--checked true|false]

Databases:
  db list
  db get <database>
  db query <database> [--text ...] [--filter-file ...] [--sorts-file ...]
  db create --title <title> --parent <page> --schema-file schema.json [--inline]
  db update <database> [--title ...] [--properties-file ...] [--trash|--restore]
  db row add <database> (--properties-json ...|--properties-file ...)
  db rows add <database> (--entries-file entries.json|--jsonl entries.jsonl)
  db row update <page> (--properties-json ...|--properties-file ...)
  db row delete <page>

Comments/users:
  comment list <page>
  comment add <page> --text <text>
  user list
  user me
```

That is "both" mirror and workflow, but with a clear center of gravity: the CLI is a resource-oriented wrapper over existing primitives. Workflow support should be thin and compositional, mostly aliases around safer file/stdin IO. Avoid a separate automation framework in the first pass.

The command list above is the target vocabulary, not Phase 1 scope. Broad command coverage and parity belong in later phases. Database row/property writes, specifically `db row add`, `db rows add`, and `db row update`, should not be implemented until `add-property-type-value-write-tests` is complete. Read-only database commands can proceed earlier.

The first CLI should share implementation paths with the MCP handlers or the lower-level `notion-client.ts`/markdown conversion functions. It should not become a second Notion wrapper with independent behavior.

## Profile and API-Key Selection

Profiles are the central design feature. They replace "register multiple MCP servers, one per token."

Recommended profile model:

```json
{
  "default": "work-ro",
  "profiles": {
    "work-ro": {
      "token_env": "NOTION_WORK_RO_TOKEN",
      "mode": "readonly",
      "root_page_id": "..."
    },
    "work-rw": {
      "token_env": "NOTION_WORK_RW_TOKEN",
      "mode": "readwrite",
      "root_page_id": "..."
    },
    "personal-ro": {
      "token_env": "NOTION_PERSONAL_RO_TOKEN",
      "mode": "readonly"
    }
  }
}
```

Store profile metadata in `~/.config/easy-notion-mcp/profiles.json`. Do not store raw API tokens there in the first implementation. Profiles should reference env var names. Later, add OS keychain support if users ask for it.

Selection precedence:

1. `--profile <name>`
2. `EASY_NOTION_PROFILE`
3. default profile from config
4. fallback to `NOTION_TOKEN` only when no profile config exists

`mode: readonly` should be a local guard. In v1, it should block mutating commands before any Notion call. Writes require selecting a `readwrite` profile. The actual Notion integration permissions remain the real authority; the local mode is a safety rail and a routing signal for agents. A future human-only override could be considered later, but it should stay out of v1 and out of skill examples.

`profile check` should call `user me`, verify the token env var is present, show mode/root settings, and run a harmless read-side capability probe. It must never print the token.

## Skill Shape

The proposed first lightweight skill is `easy-notion-cli`, after James accepts the CLI+skill direction.

It should contain:

- A short description: use this when working with Notion through the `easy-notion` CLI instead of loading MCP tools.
- The npm invocation pattern: `npx -y --package easy-notion-mcp easy-notion ...`.
- Profile rules: always pass `--profile` when the user names a workspace, account, or permission mode.
- A routing table from common intents to CLI commands.
- Safety rules for destructive operations:
  - Prefer `content find-replace`, `block update`, and `content section` for surgical edits.
  - Use `content replace` only when replacing the whole page is intended.
  - Do not round-trip `page read` markdown through `content replace` when warnings include omitted block types.
  - Use `page duplicate` before destructive edits on irreplaceable content.
- File/stdin patterns for large markdown and database batches.
- Database write/batch examples only after `add-property-type-value-write-tests` lands.
- A compact response contract: parse JSON from stdout, treat stderr as diagnostics, report command failures with the command and JSON error.

It should not contain:

- A `.mcp.json` entry.
- A complete restatement of all 29 MCP tool descriptions.
- Long Notion API documentation.
- Project-specific workflows such as sprint management in the first release.

The skill can be around 150-250 lines. If examples grow beyond that, move them to a small reference file, but keep the first version deliberately light. The point is to replace a large MCP tool list with a command card, not to recreate a plugin bundle.

## MCP Tool Shape

Keep the MCP surface mostly granular. The current distribution is healthy: the median tool is small, agents route well to focused names, and the largest token savings are in shared prose, not in collapsing tiny utility tools.

Tools that should stay granular:

- `update_block`, `update_section`, `find_replace`, `append_content`, `replace_content`: these are distinct editing strategies with different safety and routing behavior.
- `read_page`: its warning contract is important enough to keep visible.
- `create_page` and `create_page_from_file`: different transport and context economics.
- `get_database`, `query_database`, `add_database_entry`, `add_database_entries`, `update_database_entry`: agents benefit from separate read, single-write, batch-write, and update routes.
- `update_data_source`: keep separate because schema changes have full-list destructive semantics.
- `search`, `list_databases`, `list_pages`: cheap and route clearly.
- `add_comment` and `list_comments`: cheap, and useful for agent-orchestration workflows.

Consolidation recommendations:

| Candidate | Recommendation | Reason |
|---|---|---|
| Fold `move_page` into `update_page` | Reject for the full MCP surface; expose both as CLI `page move` and `page update`. | Saves little and mixes metadata update with parent relocation. Distinct tool names are safer and easier to route. |
| Merge `add_database_entry` into `add_database_entries` | Defer for MCP; make CLI `db rows add` accept one or many entries. | Single-row creation is a common agent action. Removing it saves tokens but risks routing friction, and property-write contracts are under-tested. Revisit after positive write tests and benchmark evidence. |
| Drop `share_page` | Pursue as compact-profile omission or deprecation, not immediate full removal. | It is mostly redundant because many responses include URLs, but tool removal is a compatibility break. Hide it first in any future compact MCP profile. |
| Merge `archive_page` and `restore_page` | Reject for now. | Token savings are tiny, and separate verbs reduce the chance of choosing the wrong destructive direction. |
| Tighten top tool descriptions | Pursue. | The audit found low-risk savings in repeated prose. |
| Extract shared docs to MCP Resources | Pursue for MCP users. | Protocol-aligned replacement for the invalid tiered-description idea. |
| `$defs`/`$ref` schema sharing | Reject. | Not portable across MCP clients. |
| Extract writable property-value contracts from `update_database_entry` | Defer. | Testing audit H1 means the prose is still a contract surface until value-write tests land. |

If a future "compact MCP profile" is built, it should be explicit and startup-selected, for example `EASY_NOTION_MCP_PROFILE=full|readonly|page-edit|database`. That is a separate MCP-server feature. It should not block the CLI+skill work, because the CLI already solves the multiple-token context problem more directly.

## MCP Resources and the Invalid Tiered Task

The prior `tiered-tool-descriptions-load-co` task should not remain as written. MCP does not support "load full tool descriptions on demand." The correct protocol-aligned server work is:

- Add MCP Resources for shared documentation.
- Tighten in-place descriptions where safe.
- Keep critical safety prose inline.

That work still matters for users who use the MCP server directly. It does not solve ivalsaraj's multi-integration complaint by itself. A 20% smaller `tools/list` is useful; avoiding two or three extra `tools/list` registrations is the bigger win.

Recommended disposition: rewrite `tiered-tool-descriptions-load-co` to `extract-shared-docs-to-mcp-resources-and-tighten-tool-descriptions`, or close it as superseded after filing that replacement. Do not leave the impossible "full docs on demand" wording in the ready queue.

## Proposed Phases and Acceptance Criteria

### Phase 1: CLI foundation and smallest useful slice

After James accepts this design, build the `easy-notion` bin, profile config/resolution, read-only guard, and the smallest useful command slice.

Acceptance criteria:

- `npx -y --package easy-notion-mcp easy-notion --help` works without starting the MCP server.
- Profile config and resolution work: `profile add/list/show`, `--profile`, `EASY_NOTION_PROFILE`, default profile, and `NOTION_TOKEN` fallback resolve in the documented order.
- `profile check` works, calls the same underlying path as `user me` where practical, verifies token env presence, shows mode/root settings, runs a harmless read-side probe, and never persists or prints raw tokens.
- `user me` works.
- `readonly` profiles block mutating commands locally.
- JSON output is stable and parseable for all implemented commands.
- Implement only `search`, `page read`, and at most one safe representative content write, preferably `content append` or `content section`. Do not include broad command coverage in this phase.
- CLI command behavior is covered by focused tests using mocks or an MCP-handler parity layer; no live Notion test is required for every command in the first PR.

### Phase 2: Read-only breadth and human formatting

Add non-mutating high-value commands without changing MCP behavior.

Acceptance criteria:

- Read-only database commands can proceed here: `db list`, `db get`, and `db query`.
- Other read-only commands can proceed here, including `comment list` and `user list`.
- `--format table` or `--format markdown` exists for the main human read commands.
- Error output is consistent: JSON error on stdout when `--format json`, diagnostics on stderr, nonzero process exit on failure.

### Phase 3: Write expansion, with database writes blocked on tests

Add remaining page/content/comment write commands in small increments. Keep database row/property writes blocked until `add-property-type-value-write-tests` is complete.

Acceptance criteria:

- Large payload write commands support `--file` or `--stdin`.
- Non-database writes have focused tests and preserve the MCP handlers' safety behavior.
- `db row add`, `db rows add`, and `db row update` are not implemented until `add-property-type-value-write-tests` lands.
- Once unblocked, database row/property writes reuse the tested property-value contracts instead of introducing a second parser or schema.

### Phase 4: Complete CLI parity for existing high-value tools

Fill in remaining command groups without changing MCP behavior.

Acceptance criteria:

- All current non-HTTP-only MCP capabilities have a CLI equivalent or a documented reason for omission.
- Broad command coverage and parity are treated as post-foundation work, not Phase 1 scope.
- Error behavior remains consistent across read and write commands.

### Phase 5: Lightweight skill

Author and test the `easy-notion-cli` skill.

Acceptance criteria:

- The skill does not enable or require MCP tools.
- It documents the `npx --package easy-notion-mcp easy-notion` invocation.
- It includes a profile-selection rule and a concise routing table.
- It includes destructive-edit and read-warning safety guidance.
- It demonstrates copy-pasteable command patterns for search, read, section update, find/replace, and database query. Add batch row import only after `add-property-type-value-write-tests` has landed and the database write CLI exists.
- A Claude Code or OpenClaw dry run can use the skill to complete one read-only and one write workflow with no `mcp__easy-notion__*` tools loaded.

### Phase 6: MCP Resources and description tightening

Implement the tool-description audit's server-side recommendations for direct MCP users.

Acceptance criteria:

- Server advertises `resources` capability.
- Resources exist for markdown conventions, warnings, property pagination, and update-data-source examples.
- Tool descriptions reference those resources while keeping safety-critical warnings inline.
- `tools/list` token count decreases by the target range from the audit, after accounting for `resources/list`.
- Tests cover `resources/list` and `resources/read`.

### Phase 7: Optional compact MCP profiles and consolidation cleanup

Only after the CLI and skill are usable, evaluate startup-selected MCP profiles and the `share_page` deprecation path.

Acceptance criteria:

- A compact profile is selected at server startup, not dynamically during a session.
- Profile membership is documented and tested.
- `share_page` is omitted from compact profiles before any full-surface removal.
- Any removal or merge has benchmark or issue evidence that routing did not regress.

## Boundaries: Do Not Build First

- Do not build a hosted remote server.
- Do not build a full Claude Code plugin that auto-registers the MCP server as the first answer to this issue.
- Do not implement broad MCP tool consolidation before the CLI exists.
- Do not store raw API tokens in profile config in the first implementation.
- Do not add an OS keychain dependency until the env-var profile flow proves insufficient.
- Do not create high-level workflow automation such as sprint-status, PR-to-doc, or task-board orchestration in the first skill.
- Do not expose a raw Notion API proxy mode. The CLI should preserve the project's markdown-first and simple-property-value contract.
- Do not remove public MCP tools immediately for small token wins.

## Risks and Open Questions

- CLI/MCP drift: a second surface can diverge unless it shares lower-level functions or handler logic. The implementation plan should force shared paths and parity tests.
- Read-only profile semantics: local guards help, but Notion token capabilities are still the real permission boundary. Documentation must avoid implying stronger isolation than Notion grants.
- `npx --package` latency: first run may be slower than a globally installed CLI. The skill should use `npx --package` for portability, but docs can recommend global install for frequent human use.
- Windows and shell quoting: JSON flags and markdown stdin need examples that work across common shells, or the skill will become brittle.
- Token leakage: profile checks and errors must never echo tokens. Skill examples should use env var names, not literal secrets.
- MCP Resources behavior: hosted uses resources, but clients vary in how visible resource references are to the model. Keep critical safety text inline.
- Compatibility: MCP tool removal is a public API change for downstream users. Treat removals as deprecations or profile omissions first.

Open questions:

- Should the CLI config path use `~/.config/easy-notion-mcp/` or reuse `~/.easy-notion-mcp/` for all local state? I recommend `~/.config/easy-notion-mcp/profiles.json` for metadata and keeping token material out of it.
- Which skill marketplace is first: Claude Code, OpenClaw, or a repo-local skill only? I recommend repo-local first, then package for the ecosystem that ivalsaraj uses if they clarify.
- Is a read-only Notion integration enough for the target users, or do they also want profile-level allowlists by page/database? Start with one profile per API key; page/database allowlists are not first-pass scope.

## Tasuku Recommendations

- Mark `design-cli-skill-tool-shape` done once this memo is accepted.
- Rewrite or close `tiered-tool-descriptions-load-co`. Preferred rewrite: `extract-shared-docs-to-mcp-resources-and-tighten-tool-descriptions`, with the tool-description audit's resource list and the constraint that "full docs on demand" is not an MCP primitive.
- Do not add high-priority CLI build tasks until James accepts this revised design.
- If James accepts it, add `build-easy-notion-cli-profile-surface` with the narrowed Phase 1 scope: new bin, profile config/resolution, read-only guard, JSON output, `profile check`, `user me`, `search`, `page read`, and at most one safe representative content write.
- If James accepts it, add `author-lightweight-easy-notion-cli-skill` after the CLI foundation: standalone skill, no MCP registration, profile/routing/safety command card.
- If James accepts it, add `complete-easy-notion-cli-parity` after the foundation: fill remaining current tool equivalents and human formatting.
- Keep `add-property-type-value-write-tests` ahead of `db row add`, `db rows add`, and `db row update` CLI implementation.
- Keep `add-property-type-value-write-tests` ahead of any aggressive `add_database_entry`/`update_database_entry` description consolidation.
- If desired, add a low-priority `deprecate-share-page-in-compact-surfaces` task after CLI launch; do not block the main work on it.

## Red-team adjustment

This revision makes the CLI+skill design conditional on James's acceptance, narrows Phase 1 to profile resolution/config, `profile check`, `user me`, `search`, `page read`, and at most one safe representative content write, blocks database row/property writes on `add-property-type-value-write-tests`, removes `--allow-write-on-readonly-profile` from v1, and changes Tasuku guidance so high-priority CLI build tasks are not added before design acceptance.

## Source Context

- `.meta/handoffs/2026-05-01-close.md`
- `.meta/audits/tool-descriptions-audit-2026-05-01.md`
- `.meta/research/hosted-mcp-live-capture-2026-05-01.md`
- `.meta/research/remote-mcp-strategy-2026-04-28.md` as stale baseline only
- `.meta/research/claude-code-plugin-feasibility-2026-04-28.md`
- `.meta/roadmap-2026-04-23.md`
- `CLAUDE.md`
- `src/server.ts`
- tasuku context for `tiered-tool-descriptions-load-co` and `design-cli-skill-tool-shape`

No builds or tests were run; source inspection only.

# Contributing to easy-notion-mcp

## Before you start

1. Read `CLAUDE.md` for architecture, commands, and conventions
2. Check existing issues before starting work
3. For non-trivial changes, open an issue first to discuss the approach
4. For open-ended questions and design discussion, ask in [Discord](https://discord.gg/S8cghJSVBU); bugs and concrete requests still belong on [GitHub issues](https://github.com/Grey-Iris/easy-notion-mcp/issues)

## Development setup

```bash
git clone https://github.com/Grey-Iris/easy-notion-mcp.git
cd easy-notion-mcp
npm ci          # Use npm ci, NOT npm install
npm run build
npm test        # All tests must pass before you start
```

## Rules (all PRs must follow these)

1. **Target the `dev` branch**, not `main`
2. **Include tests** for any new functionality or bug fix
3. **All checks must pass**: `npm run build && npm run typecheck && npm test`
4. **Do not modify these files** without maintainer pre-approval:
   - `.github/workflows/*` (CI/CD pipelines)
   - `package.json` dependencies (adding/removing/changing versions)
   - `tsconfig.json`
   - `.gitignore`
   - `CLAUDE.md`, `CONTRIBUTING.md`
5. **Do not add new dependencies.** If your change requires a new package, open an issue to discuss it first.
6. **Do not modify existing test fixtures** unless your change intentionally alters behavior
7. **Keep PRs focused.** One logical change per PR. Don't bundle unrelated fixes.

## Code conventions

- All logging to `console.error` (stdout is MCP protocol in stdio mode)
- Markdown is the agent-facing interface — never expose Notion block objects
- Follow existing patterns in `server.ts` for new tools
- Use vitest for all tests

## Adding a new MCP tool

1. Add the tool definition and handler in `server.ts`
2. Add tests in `tests/`
3. Update the tool description in `server.ts` to document usage
4. Run the full test suite

## Adding a new block type

See CLAUDE.md § "Adding a new block type"

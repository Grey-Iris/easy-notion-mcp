import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "../src/cli/run.js";
import {
  CliError,
  resolveProfileFromConfig,
  saveProfileConfig,
  type ProfileConfig,
} from "../src/cli/profile-config.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "easy-notion-cli-"));
  tempDirs.push(dir);
  return dir;
}

function jsonFrom(output: string) {
  return JSON.parse(output) as any;
}

function createIo(env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      env,
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
      stdin: Readable.from([]) as NodeJS.ReadStream,
      cwd: process.cwd(),
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function createOps(overrides: CliDeps["ops"] = {}): CliDeps["ops"] {
  const richText = [{ text: { content: "Hello", link: null }, annotations: {} }];
  return {
    createClient: vi.fn((token: string) => ({ token }) as any),
    getMe: vi.fn(async () => ({ id: "user-1", name: "Ada", type: "person" })),
    listUsers: vi.fn(async () => [
      { id: "user-1", name: "Ada", type: "person", person: { email: "ada@example.com" } },
      { id: "bot-1", name: "Integration", type: "bot" },
    ]),
    search: vi.fn(async () => []),
    getDatabase: vi.fn(async (_client, databaseId) => ({
      id: databaseId,
      title: "Tasks",
      url: `https://notion.so/${databaseId}`,
      properties: [{ name: "Name", type: "title" }],
    })),
    validateDatabaseEntriesTarget: vi.fn(async () => ({ id: "db-1" })),
    buildTextFilter: vi.fn(async (_client, _databaseId, text) => ({
      property: "Name",
      title: { contains: text },
    })),
    queryDatabase: vi.fn(async () => [{
      id: "page-1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Task One" }] },
        Status: { type: "status", status: { name: "Todo" } },
      },
    }]),
    createDatabaseEntry: vi.fn(async (_client, _databaseId, properties) => ({
      id: `entry-${String(properties.Name ?? "created").toLowerCase()}`,
      url: "https://notion.so/entry-created",
    })),
    updateDatabaseEntry: vi.fn(async (_client, pageId) => ({
      id: pageId,
      url: `https://notion.so/${pageId}`,
    })),
    createPage: vi.fn(async (_client, _parent, title) => ({
      id: `created-${String(title).toLowerCase().replaceAll(" ", "-")}`,
      url: "https://notion.so/created-page",
      properties: {
        title: { type: "title", title: [{ plain_text: title }] },
      },
    })),
    archivePage: vi.fn(async (_client, pageId) => ({ id: pageId })),
    restorePage: vi.fn(async (_client, pageId) => ({ id: pageId })),
    movePage: vi.fn(async (_client, pageId) => ({
      id: pageId,
      url: `https://notion.so/${pageId}`,
    })),
    getPage: vi.fn(async () => ({
      id: "page-1",
      url: "https://notion.so/page-1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Page One" }] },
      },
    })),
    updatePage: vi.fn(async (_client, pageId, props) => ({
      id: pageId,
      url: `https://notion.so/${pageId}`,
      properties: {
        title: { type: "title", title: [{ plain_text: props.title ?? "Page One" }] },
      },
    })),
    listChildren: vi.fn(async () => [
      { id: "child-1", type: "child_page", child_page: { title: "Child One" } },
      { id: "block-1", type: "paragraph" },
    ]),
    listComments: vi.fn(async () => [{
      id: "comment-1",
      created_by: { name: "Ada" },
      rich_text: [{ plain_text: "Looks good" }],
      created_time: "2026-05-06T12:00:00.000Z",
    }]),
    addComment: vi.fn(async (_client, _pageId, richText) => ({
      id: "comment-2",
      rich_text: richText.map((text: any) => ({ plain_text: text.text.content })),
    })),
    uploadFile: vi.fn(async () => ({ id: "upload-1", blockType: "image" })),
    paginatePageProperties: vi.fn(async (_client, page) => ({ page, warnings: [] })),
    fetchBlocksRecursive: vi.fn(async () => [{
      type: "paragraph",
      paragraph: { rich_text: richText },
    }]),
    fetchBlocksWithLimit: vi.fn(async () => ({
      blocks: [{ type: "paragraph", paragraph: { rich_text: richText } }],
      hasMore: true,
    })),
    processFileUploads: vi.fn(async (_client, markdown) => markdown),
    appendBlocks: vi.fn(async (_client, _pageId, blocks) => blocks.map((_, index) => ({ id: `block-${index}` }))),
    appendBlocksAfter: vi.fn(async (_client, _pageId, blocks) => blocks.map((_, index) => ({ id: `after-block-${index}` }))),
    deleteBlock: vi.fn(async (_client, blockId) => ({ id: blockId })),
    retrieveBlock: vi.fn(async (_client, blockId) => ({
      id: blockId,
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: "Old" }] },
    })),
    updateBlock: vi.fn(async (_client, blockId, payload) => ({ id: blockId, ...payload })),
    replacePageMarkdown: vi.fn(async () => ({ truncated: false })),
    retrieveMarkdown: vi.fn(async () => ({ markdown: "Hello" })),
    updateMarkdown: vi.fn(async () => ({ truncated: false })),
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("profile resolution", () => {
  const config: ProfileConfig = {
    default: "default",
    profiles: {
      explicit: { token_env: "EXPLICIT_TOKEN", mode: "readwrite" },
      env: { token_env: "ENV_TOKEN", mode: "readonly" },
      default: { token_env: "DEFAULT_TOKEN", mode: "readonly" },
    },
  };

  it("uses --profile before EASY_NOTION_PROFILE and default", () => {
    const resolved = resolveProfileFromConfig(config, {
      requestedProfile: "explicit",
      env: {
        EASY_NOTION_PROFILE: "env",
        EXPLICIT_TOKEN: "explicit-secret",
        ENV_TOKEN: "env-secret",
        DEFAULT_TOKEN: "default-secret",
      },
      configFileExists: true,
    });

    expect(resolved.kind).toBe("profile");
    expect(resolved.name).toBe("explicit");
    expect(resolved.token).toBe("explicit-secret");
  });

  it("uses EASY_NOTION_PROFILE before the config default", () => {
    const resolved = resolveProfileFromConfig(config, {
      env: {
        EASY_NOTION_PROFILE: "env",
        ENV_TOKEN: "env-secret",
        DEFAULT_TOKEN: "default-secret",
      },
      configFileExists: true,
    });

    expect(resolved.name).toBe("env");
    expect(resolved.token).toBe("env-secret");
  });

  it("uses the config default before NOTION_TOKEN", () => {
    const resolved = resolveProfileFromConfig(config, {
      env: {
        DEFAULT_TOKEN: "default-secret",
        NOTION_TOKEN: "fallback-secret",
      },
      configFileExists: true,
    });

    expect(resolved.name).toBe("default");
    expect(resolved.token).toBe("default-secret");
  });

  it("falls back to NOTION_TOKEN only when no profile config exists", () => {
    const resolved = resolveProfileFromConfig({ profiles: {} }, {
      env: { NOTION_TOKEN: "fallback-secret" },
      configFileExists: false,
    });

    expect(resolved.kind).toBe("env");
    expect(resolved.token).toBe("fallback-secret");

    expect(() => resolveProfileFromConfig({ profiles: {} }, {
      env: { NOTION_TOKEN: "fallback-secret" },
      configFileExists: true,
    })).toThrow(CliError);
  });
});

describe("easy-notion CLI", () => {
  it("help lists --dry-run on destructive commands", async () => {
    const io = createIo({});

    expect(await runCli(["--help"], io.io, { configDir: await makeTempDir(), ops: createOps() })).toBe(0);
    const help = jsonFrom(io.stdout).result.help;

    expect(help).toContain("content replace <page_id> [--dry-run]");
    expect(help).toContain("content update-section <page_id> --heading <heading> [--preserve-heading] [--dry-run]");
    expect(help).toContain("content update-toggle <page_id> --title <title> [--dry-run]");
    expect(help).toContain("content archive-toggle <page_id> --title <title> [--dry-run]");
    expect(help).toContain("content find-replace <page_id> --find <text> --replace <text> [--all] [--dry-run]");
    expect(help).toContain("page archive <page_id> [--dry-run]");
    expect(help).toContain("database entry delete <page_id> [--dry-run]");
    expect(help).toContain("block update <block_id> [--dry-run]");
  });

  it("adds, lists, shows, and checks profiles without leaking token values", async () => {
    const configDir = await makeTempDir();
    const env = { WORK_TOKEN: "secret-token-value" };
    const ops = createOps();
    const addIo = createIo(env);

    await expect(runCli([
      "profile", "add", "work-ro",
      "--token-env", "WORK_TOKEN",
      "--mode", "readonly",
      "--root-page-id", "root-1",
    ], addIo.io, { configDir, ops })).resolves.toBe(0);

    const addPayload = jsonFrom(addIo.stdout);
    expect(addPayload.ok).toBe(true);
    expect(addIo.stdout).not.toContain("secret-token-value");

    for (const argv of [
      ["profile", "list"],
      ["profile", "show", "work-ro"],
    ]) {
      const io = createIo(env);
      const code = await runCli(argv, io.io, { configDir, ops });
      expect(code).toBe(0);
      const payload = jsonFrom(io.stdout);
      expect(payload.ok).toBe(true);
      expect(io.stdout).not.toContain("secret-token-value");
      expect(io.stdout).toContain("WORK_TOKEN");
    }

    const checkIo = createIo(env);
    const checkCode = await runCli(["profile", "check", "work-ro"], checkIo.io, { configDir, ops });
    expect(checkCode).toBe(0);
    const checkPayload = jsonFrom(checkIo.stdout);
    expect(checkPayload.ok).toBe(true);
    expect(checkPayload.result.read_probe).toEqual({
      ok: true,
      type: "root_page",
      page: {
        id: "page-1",
        title: "Page One",
        url: "https://notion.so/page-1",
      },
    });
    expect(checkIo.stdout).not.toContain("secret-token-value");
    expect(checkIo.stdout).toContain("WORK_TOKEN");
    expect(ops?.getMe).toHaveBeenCalledTimes(1);
    expect(ops?.getPage).toHaveBeenCalledWith(expect.anything(), "root-1");
    expect(ops?.search).not.toHaveBeenCalled();
  });

  it("profile check skips the read probe when no root_page_id exists and does not search", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli(["profile", "check", "work-ro"], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout).result.read_probe).toEqual({
      ok: true,
      skipped: "no_root_page_id",
    });
    expect(ops?.getMe).toHaveBeenCalledTimes(1);
    expect(ops?.getPage).not.toHaveBeenCalled();
    expect(ops?.search).not.toHaveBeenCalled();
  });

  it("blocks readonly writes before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "append", "page-1", "--markdown", "Hello",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "readonly_profile",
        message: "Profile 'work-ro' is readonly and cannot run mutating command 'content append'.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
    expect(io.stdout).not.toContain("secret-token-value");
  });

  it("routes user me, search, page read, and content append as JSON commands", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      search: vi.fn(async () => [{
        id: "result-1",
        object: "page",
        url: "https://notion.so/result-1",
        parent: { type: "page_id", page_id: "parent-1" },
        last_edited_time: "2026-05-06T12:00:00.000Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Roadmap" }] },
        },
      }]),
    });
    const env = { WORK_TOKEN: "secret-token-value" };

    const userIo = createIo(env);
    expect(await runCli(["user", "me"], userIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(userIo.stdout).result).toEqual({ id: "user-1", name: "Ada", type: "person" });

    const searchIo = createIo(env);
    expect(await runCli(["search", "roadmap", "--filter", "pages"], searchIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(searchIo.stdout).result).toEqual([{
      id: "result-1",
      type: "page",
      title: "Roadmap",
      url: "https://notion.so/result-1",
      parent: "parent-1",
      last_edited: "2026-05-06",
    }]);

    const pageIo = createIo(env);
    expect(await runCli(["page", "read", "page-1", "--max-blocks", "1"], pageIo.io, { configDir, ops })).toBe(0);
    const page = jsonFrom(pageIo.stdout).result;
    expect(page.id).toBe("page-1");
    expect(page.markdown).toContain("Content retrieved from Notion");
    expect(page.has_more).toBe(true);

    const appendIo = createIo(env);
    expect(await runCli(["content", "append", "page-1", "--markdown", "Hello"], appendIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(appendIo.stdout).result).toEqual({ success: true, blocks_added: 1 });
  });

  it("accepts content flag values that look like options", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
        explicit: { token_env: "EXPLICIT_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveMarkdown: vi.fn(async () => ({ markdown: "old appears once" })),
      updateMarkdown: vi.fn(async () => ({ truncated: false })),
    });
    const env = { WORK_TOKEN: "secret-token-value", EXPLICIT_TOKEN: "explicit-secret" };

    const explicitProfileIo = createIo(env);
    expect(await runCli([
      "--profile", "explicit", "content", "append", "page-1", "--markdown", "Body",
    ], explicitProfileIo.io, { configDir, ops })).toBe(0);
    expect(ops?.createClient).toHaveBeenLastCalledWith("explicit-secret");

    const dividerIo = createIo(env);
    expect(await runCli([
      "content", "append", "page-1", "--markdown", "---",
    ], dividerIo.io, { configDir, ops })).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "---");
    expect(ops?.appendBlocks).toHaveBeenLastCalledWith(
      expect.anything(),
      "page-1",
      [{ type: "divider", divider: {} }],
    );

    const globalLookingIo = createIo(env);
    expect(await runCli([
      "content", "append", "page-1", "--markdown", "--profile",
    ], globalLookingIo.io, { configDir, ops })).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "--profile");

    const sentinelIo = createIo(env);
    expect(await runCli([
      "--", "content", "append", "page-1", "--markdown", "--format",
    ], sentinelIo.io, { configDir, ops })).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "--format");

    const replaceIo = createIo(env);
    expect(await runCli([
      "content", "find-replace", "page-1",
      "--find", "old",
      "--replace", "--new",
    ], replaceIo.io, { configDir, ops })).toBe(0);
    expect(ops?.retrieveMarkdown).toHaveBeenLastCalledWith(expect.anything(), "page-1");
    expect(ops?.updateMarkdown).toHaveBeenLastCalledWith(expect.anything(), {
      page_id: "page-1",
      type: "update_content",
      update_content: {
        content_updates: [{
          old_str: "old",
          new_str: "--new",
        }],
      },
    });
  });

  it("routes database get, list, query, add, add-many, and update as JSON commands", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      search: vi.fn(async () => [{
        id: "ds-1",
        object: "data_source",
        url: "https://notion.so/db-1",
        title: [{ plain_text: "Tasks" }],
        parent: { type: "database_id", database_id: "db-1" },
      }]),
    });
    const env = { WORK_TOKEN: "secret-token-value" };

    const getIo = createIo(env);
    expect(await runCli(["database", "get", "db-1"], getIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(getIo.stdout).result).toEqual({
      id: "db-1",
      title: "Tasks",
      url: "https://notion.so/db-1",
      properties: [{ name: "Name", type: "title" }],
    });
    expect(ops?.getDatabase).toHaveBeenCalledWith(expect.anything(), "db-1");

    const listIo = createIo(env);
    expect(await runCli(["database", "list"], listIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(listIo.stdout).result).toEqual([{
      id: "db-1",
      title: "Tasks",
      url: "https://notion.so/db-1",
    }]);
    expect(ops?.search).toHaveBeenCalledWith(expect.anything(), "", "databases");

    const queryIo = createIo(env);
    expect(await runCli([
      "database", "query", "db-1",
      "--filter-json", "{\"property\":\"Status\",\"status\":{\"equals\":\"Todo\"}}",
      "--sorts-json", "[{\"property\":\"Name\",\"direction\":\"ascending\"}]",
      "--text", "Task",
    ], queryIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(queryIo.stdout).result).toEqual({
      results: [{ id: "page-1", Name: "Task One", Status: "Todo" }],
    });
    expect(ops?.queryDatabase).toHaveBeenCalledWith(
      expect.anything(),
      "db-1",
      {
        and: [
          { property: "Name", title: { contains: "Task" } },
          { property: "Status", status: { equals: "Todo" } },
        ],
      },
      [{ property: "Name", direction: "ascending" }],
    );

    const addIo = createIo(env);
    expect(await runCli([
      "database", "entry", "add", "db-1", "--properties-json", "{\"Name\":\"Task One\"}",
    ], addIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(addIo.stdout).result).toEqual({
      id: "entry-task one",
      url: "https://notion.so/entry-created",
    });

    const addManyIo = createIo(env);
    expect(await runCli([
      "database", "entry", "add-many", "db-1",
      "--entries-json", "[{\"Name\":\"One\"},{\"Name\":\"Two\"}]",
    ], addManyIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(addManyIo.stdout).result).toEqual({
      succeeded: [
        { id: "entry-one", url: "https://notion.so/entry-created" },
        { id: "entry-two", url: "https://notion.so/entry-created" },
      ],
      failed: [],
    });
    expect(ops?.validateDatabaseEntriesTarget).toHaveBeenCalledWith(expect.anything(), "db-1");

    const updateIo = createIo(env);
    expect(await runCli([
      "database", "entry", "update", "page-1", "--properties-json", "{\"Status\":\"Done\"}",
    ], updateIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(updateIo.stdout).result).toEqual({
      id: "page-1",
      url: "https://notion.so/page-1",
    });
    expect(ops?.updateDatabaseEntry).toHaveBeenCalledWith(expect.anything(), "page-1", { Status: "Done" });
  });

  it("routes read/admin CLI parity commands as JSON commands", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const env = { WORK_TOKEN: "secret-token-value" };

    const usersIo = createIo(env);
    expect(await runCli(["user", "list"], usersIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(usersIo.stdout).result).toEqual([
      { id: "user-1", name: "Ada", type: "person", email: "ada@example.com" },
      { id: "bot-1", name: "Integration", type: "bot", email: null },
    ]);

    const commentsIo = createIo(env);
    expect(await runCli(["comment", "list", "page-1"], commentsIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(commentsIo.stdout).result).toEqual([{
      id: "comment-1",
      author: "Ada",
      content: "Looks good",
      created_time: "2026-05-06T12:00:00.000Z",
    }]);

    const addCommentIo = createIo(env);
    expect(await runCli(["comment", "add", "page-1", "--text", "Ship it"], addCommentIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(addCommentIo.stdout).result).toEqual({
      id: "comment-2",
      content: "Ship it",
    });
    expect(ops?.addComment).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      [expect.objectContaining({ type: "text", text: { content: "Ship it" } })],
    );

    const shareIo = createIo(env);
    expect(await runCli(["page", "share", "page-1"], shareIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(shareIo.stdout).result).toEqual({
      id: "page-1",
      url: "https://notion.so/page-1",
    });

    const childrenIo = createIo(env);
    expect(await runCli(["page", "list-children", "parent-1"], childrenIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(childrenIo.stdout).result).toEqual([
      { id: "child-1", title: "Child One" },
    ]);
    expect(ops?.listChildren).toHaveBeenCalledWith(expect.anything(), "parent-1");

    const updateIo = createIo(env);
    expect(await runCli(["page", "update", "page-1", "--title", "Renamed", "--icon", "*"], updateIo.io, {
      configDir,
      ops,
    })).toBe(0);
    expect(jsonFrom(updateIo.stdout).result).toEqual({
      id: "page-1",
      title: "Renamed",
      url: "https://notion.so/page-1",
    });
    expect(ops?.updatePage).toHaveBeenCalledWith(expect.anything(), "page-1", {
      title: "Renamed",
      icon: "*",
      cover: undefined,
    });

    const archiveIo = createIo(env);
    expect(await runCli(["page", "archive", "page-1"], archiveIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(archiveIo.stdout).result).toEqual({ success: true, archived: "page-1" });

    const restoreIo = createIo(env);
    expect(await runCli(["page", "restore", "page-1"], restoreIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(restoreIo.stdout).result).toEqual({ success: true, restored: "page-1" });

    const moveIo = createIo(env);
    expect(await runCli(["page", "move", "page-1", "--parent", "new-parent"], moveIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(moveIo.stdout).result).toEqual({
      id: "page-1",
      url: "https://notion.so/page-1",
      parent_id: "new-parent",
    });
    expect(ops?.movePage).toHaveBeenCalledWith(expect.anything(), "page-1", "new-parent");

    const deleteIo = createIo(env);
    expect(await runCli(["database", "entry", "delete", "page-1"], deleteIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(deleteIo.stdout).result).toEqual({ success: true, deleted: "page-1" });
    expect(ops?.archivePage).toHaveBeenLastCalledWith(expect.anything(), "page-1");
  });

  it("routes file covers through uploadFile for page update", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli(["page", "update", "page-1", "--cover", "file:///tmp/cover.png"], io.io, {
      configDir,
      ops,
    })).toBe(0);

    expect(ops?.uploadFile).toHaveBeenCalledWith(expect.anything(), "file:///tmp/cover.png");
    expect(ops?.updatePage).toHaveBeenCalledWith(expect.anything(), "page-1", {
      title: undefined,
      icon: undefined,
      cover: { type: "file_upload", file_upload: { id: "upload-1" } },
    });
  });

  it("validates add-many target before creating entries", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const calls: string[] = [];
    const ops = createOps({
      validateDatabaseEntriesTarget: vi.fn(async () => {
        calls.push("validate");
        return { id: "db-1" };
      }),
      createDatabaseEntry: vi.fn(async (_client, _databaseId, properties) => {
        calls.push(`create:${String(properties.Name)}`);
        return {
          id: `entry-${String(properties.Name).toLowerCase()}`,
          url: "https://notion.so/entry-created",
        };
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "database", "entry", "add-many", "db-1",
      "--entries-json", "[{\"Name\":\"One\"},{\"Name\":\"Two\"}]",
    ], io.io, { configDir, ops })).toBe(0);

    expect(calls).toEqual(["validate", "create:One", "create:Two"]);
    expect(jsonFrom(io.stdout).result).toEqual({
      succeeded: [
        { id: "entry-one", url: "https://notion.so/entry-created" },
        { id: "entry-two", url: "https://notion.so/entry-created" },
      ],
      failed: [],
    });
  });

  it("validates add-many target for empty entries", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "database", "entry", "add-many", "db-1", "--entries-json", "[]",
    ], io.io, { configDir, ops })).toBe(0);

    expect(jsonFrom(io.stdout).result).toEqual({ succeeded: [], failed: [] });
    expect(ops?.validateDatabaseEntriesTarget).toHaveBeenCalledWith(expect.anything(), "db-1");
    expect(ops?.createDatabaseEntry).not.toHaveBeenCalled();
  });

  it("returns a stable JSON error when add-many upfront validation fails", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      validateDatabaseEntriesTarget: vi.fn(async () => {
        throw new Error("Could not find database db-missing");
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "database", "entry", "add-many", "db-missing",
      "--entries-json", "[{\"Name\":\"Blocked\"}]",
    ], io.io, { configDir, ops })).toBe(1);

    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "unexpected_error",
        message: "Could not find database db-missing",
      },
    });
    expect(ops?.validateDatabaseEntriesTarget).toHaveBeenCalledWith(expect.anything(), "db-missing");
    expect(ops?.createDatabaseEntry).not.toHaveBeenCalled();
  });

  it("blocks readonly database entry writes before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });

    for (const [argv, command, op] of [
      [
        ["database", "entry", "add", "db-1", "--properties-json", "{\"Name\":\"Blocked\"}"],
        "database entry add",
        "createDatabaseEntry",
      ],
      [
        ["database", "entry", "add-many", "db-1", "--entries-json", "[{\"Name\":\"Blocked\"}]"],
        "database entry add-many",
        "createDatabaseEntry",
      ],
      [
        ["database", "entry", "update", "page-1", "--properties-json", "{\"Name\":\"Blocked\"}"],
        "database entry update",
        "updateDatabaseEntry",
      ],
    ] as const) {
      const ops = createOps();
      const io = createIo({ WORK_TOKEN: "secret-token-value" });

      const code = await runCli(argv, io.io, { configDir, ops });

      expect(code).toBe(1);
      expect(jsonFrom(io.stdout)).toEqual({
        ok: false,
        error: {
          code: "readonly_profile",
          message: `Profile 'work-ro' is readonly and cannot run mutating command '${command}'.`,
        },
      });
      expect(ops?.createClient).not.toHaveBeenCalled();
      expect((ops as Record<string, any>)[op]).not.toHaveBeenCalled();
      expect(ops?.validateDatabaseEntriesTarget).not.toHaveBeenCalled();
    }
  });

  it("blocks readonly second-slice writes before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });

    for (const [argv, command, op] of [
      [["comment", "add", "page-1", "--text", "Blocked"], "comment add", "addComment"],
      [["page", "update", "page-1", "--title", "Blocked"], "page update", "updatePage"],
      [["page", "archive", "page-1"], "page archive", "archivePage"],
      [["page", "restore", "page-1"], "page restore", "restorePage"],
      [["page", "move", "page-1", "--parent", "new-parent"], "page move", "movePage"],
      [["database", "entry", "delete", "page-1"], "database entry delete", "archivePage"],
    ] as const) {
      const ops = createOps();
      const io = createIo({ WORK_TOKEN: "secret-token-value" });

      const code = await runCli(argv, io.io, { configDir, ops });

      expect(code).toBe(1);
      expect(jsonFrom(io.stdout)).toEqual({
        ok: false,
        error: {
          code: "readonly_profile",
          message: `Profile 'work-ro' is readonly and cannot run mutating command '${command}'.`,
        },
      });
      expect(ops?.createClient).not.toHaveBeenCalled();
      expect((ops as Record<string, any>)[op]).not.toHaveBeenCalled();
    }
  });

  it("returns a stable JSON error when page update has no update flags", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli(["page", "update", "page-1"], io.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "no_update_flags",
        message: "page update requires at least one of --title, --icon, or --cover.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.updatePage).not.toHaveBeenCalled();
  });

  it("returns stable JSON errors for invalid database JSON flags", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();

    const invalidSyntaxIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli([
      "database", "query", "db-1", "--filter-json", "{property:'Name'}",
    ], invalidSyntaxIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(invalidSyntaxIo.stdout)).toEqual({
      ok: false,
      error: {
        code: "invalid_json",
        message: "--filter-json must be valid JSON.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();

    const wrongShapeIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli([
      "database", "entry", "add-many", "db-1", "--entries-json", "{\"Name\":\"Task\"}",
    ], wrongShapeIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(wrongShapeIo.stdout)).toEqual({
      ok: false,
      error: {
        code: "invalid_json_shape",
        message: "--entries-json must be a JSON array.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
  });

  it("returns query warnings when database properties are truncated", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      paginatePageProperties: vi.fn(async (_client, page) => ({
        page,
        warnings: [{ name: "Tags", type: "relation", returned_count: 1, cap: 1 }],
      })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "database", "query", "db-1", "--max-property-items", "1",
    ], io.io, { configDir, ops })).toBe(0);

    expect(jsonFrom(io.stdout).result.warnings).toEqual([{
      code: "truncated_properties",
      properties: [{ name: "Tags", type: "relation", returned_count: 1, cap: 1 }],
      how_to_fetch_all: "Call again with --max-property-items 0 to fetch all items, or raise the cap.",
    }]);
  });

  it("always includes the content notice and rejects --trust-content", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const env = { WORK_TOKEN: "secret-token-value" };

    const readIo = createIo(env);
    expect(await runCli(["page", "read", "page-1", "--trust-content"], readIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(readIo.stdout)).toEqual({
      ok: false,
      error: {
        code: "unknown_option",
        message: "--trust-content is not supported.",
      },
    });

    const noTrustIo = createIo(env);
    expect(await runCli(["page", "read", "page-1", "--no-trust-content"], noTrustIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(noTrustIo.stdout).result.markdown).toContain("Content retrieved from Notion");
  });

  it("routes content read-section through readonly profiles", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "h2-a", type: "heading_2", heading_2: { rich_text: richText("Target") } },
        { id: "body-a", type: "paragraph", paragraph: { rich_text: richText("Readonly body") } },
        { id: "h2-b", type: "heading_2", heading_2: { rich_text: richText("Next") } },
      ]),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "read-section", "page-1", "--heading", "target",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout).result).toMatchObject({
      page_id: "page-1",
      heading: "Target",
      block_id: "h2-a",
      type: "heading_2",
    });
    expect(jsonFrom(io.stdout).result.markdown).toContain("Readonly body");
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocksAfter).not.toHaveBeenCalled();
  });

  it("routes content read-toggle through readonly profiles", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-1") {
          return [{ id: "parent", type: "paragraph", paragraph: { rich_text: richText("Parent") }, has_children: true }];
        }
        if (blockId === "parent") {
          return [{ id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") }, has_children: true }];
        }
        if (blockId === "toggle-1") {
          return [{ id: "child", type: "paragraph", paragraph: { rich_text: richText("Hidden body") } }];
        }
        return [];
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "read-toggle", "page-1", "--title", "details",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout).result).toMatchObject({
      page_id: "page-1",
      title: "Details",
      block_id: "toggle-1",
      type: "toggle",
    });
    expect(jsonFrom(io.stdout).result.markdown).toContain("Hidden body");
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
  });

  it("routes content update-toggle through readwrite profiles for a plain toggle", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const order: string[] = [];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-1") {
          return [{ id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") }, has_children: true }];
        }
        if (blockId === "toggle-1") {
          return [
            { id: "old-1", type: "paragraph", paragraph: { rich_text: richText("Old one") } },
            { id: "old-2", type: "paragraph", paragraph: { rich_text: richText("Old two") } },
          ];
        }
        return [];
      }),
      processFileUploads: vi.fn(async () => "Processed body\n\n- item"),
      deleteBlock: vi.fn(async (_client, blockId) => {
        order.push(`delete:${blockId}`);
        return { id: blockId };
      }),
      appendBlocks: vi.fn(async (_client, blockId, blocks) => {
        order.push(`append:${blockId}`);
        return blocks.map((_, index) => ({ id: `new-${index}` }));
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-toggle", "page-1", "--title", " details ", "--markdown", "New body",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: true,
      result: {
        success: true,
        block_id: "toggle-1",
        type: "toggle",
        deleted: 2,
        appended: 2,
      },
    });
    expect(order).toEqual(["delete:old-1", "delete:old-2", "append:toggle-1"]);
    expect(ops?.processFileUploads).toHaveBeenCalledWith(expect.anything(), "New body");
    expect(ops?.appendBlocks).toHaveBeenCalledWith(
      expect.anything(),
      "toggle-1",
      expect.arrayContaining([
        expect.objectContaining({
          type: "paragraph",
          paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Processed body" } })]) },
        }),
      ]),
    );
  });

  it("blocks content update-toggle readonly profiles before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-toggle", "page-1", "--title", "Details", "--markdown", "New",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "readonly_profile",
        message: "Profile 'work-ro' is readonly and cannot run mutating command 'content update-toggle'.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.listChildren).not.toHaveBeenCalled();
  });

  it("returns available toggles when content update-toggle cannot find a title", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") } },
        {
          id: "heading-toggle",
          type: "heading_3",
          heading_3: { rich_text: richText("Heading Toggle"), is_toggleable: true },
        },
      ]),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-toggle", "page-1", "--title", "Missing", "--markdown", "Replacement",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "toggle_not_found",
        message: `Toggle not found: 'Missing'. Available toggles: ["Details","Heading Toggle"]`,
        available_toggles: ["Details", "Heading Toggle"],
      },
    });
    expect(ops?.processFileUploads).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
  });

  it("routes content archive-toggle through readwrite profiles for a plain toggle", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-1") {
          return [
            { id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") }, has_children: true },
          ];
        }
        if (blockId === "toggle-1") {
          return [
            { id: "child-1", type: "paragraph", paragraph: { rich_text: richText("Keep child") } },
          ];
        }
        return [];
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "archive-toggle", "page-1", "--title", " details ",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: true,
      result: {
        success: true,
        archived: "toggle-1",
        title: "Details",
        type: "toggle",
      },
    });
    expect(ops?.updateBlock).toHaveBeenCalledWith(expect.anything(), "toggle-1", { in_trash: true });
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
  });

  it("routes content archive-toggle through readwrite profiles for a toggleable heading", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-1") {
          return [
            { id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") } },
            {
              id: "heading-toggle",
              type: "heading_2",
              heading_2: { rich_text: richText("Heading Toggle"), is_toggleable: true },
              has_children: true,
            },
          ];
        }
        if (blockId === "heading-toggle") {
          return [
            { id: "child-1", type: "paragraph", paragraph: { rich_text: richText("Keep child") } },
          ];
        }
        return [];
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "archive-toggle", "page-1", "--title", " heading toggle ",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: true,
      result: {
        success: true,
        archived: "heading-toggle",
        title: "Heading Toggle",
        type: "heading_2",
      },
    });
    expect(ops?.updateBlock).toHaveBeenCalledWith(expect.anything(), "heading-toggle", { in_trash: true });
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
  });

  it("returns available toggles when content archive-toggle cannot find a title", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") } },
        {
          id: "heading-toggle",
          type: "heading_3",
          heading_3: { rich_text: richText("Heading Toggle"), is_toggleable: true },
        },
      ]),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "archive-toggle", "page-1", "--title", "Missing",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "toggle_not_found",
        message: `Toggle not found: 'Missing'. Available toggles: ["Details","Heading Toggle"]`,
        available_toggles: ["Details", "Heading Toggle"],
      },
    });
    expect(ops?.updateBlock).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
  });

  it("treats a matching update-toggle wrapper as optional", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-1") {
          return [{ id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") }, has_children: true }];
        }
        if (blockId === "toggle-1") {
          return [{ id: "old-child", type: "paragraph", paragraph: { rich_text: richText("Old child") } }];
        }
        return [];
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-toggle", "page-1", "--title", "Details", "--markdown", "+++ Details\nWrapped replacement\n+++",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout).result).toMatchObject({
      success: true,
      block_id: "toggle-1",
      type: "toggle",
      deleted: 1,
      appended: 1,
    });
    expect(ops?.appendBlocks).toHaveBeenCalledWith(
      expect.anything(),
      "toggle-1",
      [expect.objectContaining({
        type: "paragraph",
        paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Wrapped replacement" } })]) },
      })],
    );
  });

  it("routes block read through readonly profiles", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      retrieveBlock: vi.fn(async () => ({
        id: "toggle-1",
        type: "toggle",
        toggle: { rich_text: richText("Block toggle") },
        has_children: true,
      })),
      listChildren: vi.fn(async () => [
        { id: "child", type: "paragraph", paragraph: { rich_text: richText("Block child") } },
      ]),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli(["block", "read", "toggle-1"], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout).result).toMatchObject({
      id: "toggle-1",
      type: "toggle",
    });
    expect(jsonFrom(io.stdout).result.markdown).toContain("Block child");
    expect(ops?.updateBlock).not.toHaveBeenCalled();
  });

  it("returns structured targeted-read error details", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const richText = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "h2-a", type: "heading_2", heading_2: { rich_text: richText("Overview") } },
        { id: "toggle-1", type: "toggle", toggle: { rich_text: richText("Details") } },
      ]),
      retrieveBlock: vi.fn(async () => ({ id: "db-1", type: "child_database", child_database: { title: "DB" } })),
    });

    const sectionIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli([
      "content", "read-section", "page-1", "--heading", "Missing",
    ], sectionIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(sectionIo.stdout).error).toEqual({
      code: "heading_not_found",
      message: `Heading not found: 'Missing'. Available headings: ["Overview"]`,
      available_headings: ["Overview"],
    });

    const toggleIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli([
      "content", "read-toggle", "page-1", "--title", "Missing",
    ], toggleIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(toggleIo.stdout).error).toEqual({
      code: "toggle_not_found",
      message: `Toggle not found: 'Missing'. Available toggles: ["Details"]`,
      available_toggles: ["Details"],
    });

    const blockIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli(["block", "read", "db-1"], blockIo.io, { configDir, ops })).toBe(1);
    expect(jsonFrom(blockIo.stdout).error).toEqual({
      code: "unsupported_block_type",
      message: "read_block: block type 'child_database' is not supported for markdown rendering.",
      id: "db-1",
      type: "child_database",
    });
  });

  it("processes file uploads before content append", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      processFileUploads: vi.fn(async () => "Processed"),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });
    const markdown = "![diagram](file:///tmp/diagram.png)";

    const code = await runCli(["content", "append", "page-1", "--markdown", markdown], io.io, {
      configDir,
      ops,
    });

    expect(code).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenCalledWith(expect.anything(), markdown);
    expect(ops?.appendBlocks).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      expect.arrayContaining([
        expect.objectContaining({ type: "paragraph" }),
      ]),
    );
  });

  it("creates pages from markdown with explicit and profile fallback parents", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite", root_page_id: "root-1" },
      },
    });
    const ops = createOps();
    const env = { WORK_TOKEN: "secret-token-value" };

    const explicitIo = createIo(env);
    expect(await runCli([
      "page", "create",
      "--title", "New Page",
      "--parent", "parent-1",
      "--icon", "\uD83D\uDCCC",
      "--cover", "https://example.com/cover.png",
      "--markdown", "# Hello",
    ], explicitIo.io, { configDir, ops })).toBe(0);

    expect(jsonFrom(explicitIo.stdout).result).toEqual({
      id: "created-new-page",
      title: "New Page",
      url: "https://notion.so/created-page",
    });
    expect(ops?.createPage).toHaveBeenLastCalledWith(
      expect.anything(),
      { type: "page_id", page_id: "parent-1" },
      "New Page",
      expect.arrayContaining([expect.objectContaining({ type: "heading_1" })]),
      "\uD83D\uDCCC",
      "https://example.com/cover.png",
    );

    const fallbackIo = createIo(env);
    expect(await runCli([
      "page", "create", "--title", "Fallback Parent", "--markdown", "Body",
    ], fallbackIo.io, { configDir, ops })).toBe(0);
    expect(ops?.createPage).toHaveBeenLastCalledWith(
      expect.anything(),
      { type: "page_id", page_id: "root-1" },
      "Fallback Parent",
      expect.any(Array),
      undefined,
      undefined,
    );
  });

  it("creates pages from exact file paths and stdin", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const filePath = join(configDir, "note.md");
    await writeFile(filePath, "File body", "utf8");
    const ops = createOps();
    const env = { WORK_TOKEN: "secret-token-value" };

    const fileIo = createIo(env);
    expect(await runCli([
      "page", "create-from-file",
      "--title", "From File",
      "--file", filePath,
      "--parent", "parent-1",
    ], fileIo.io, { configDir, ops })).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "File body");
    expect(ops?.createPage).toHaveBeenLastCalledWith(
      expect.anything(),
      { type: "page_id", page_id: "parent-1" },
      "From File",
      expect.arrayContaining([expect.objectContaining({ type: "paragraph" })]),
    );

    const stdinIo = createIo(env);
    stdinIo.io.stdin = Readable.from(["# From stdin"]) as NodeJS.ReadStream;
    expect(await runCli([
      "page", "create",
      "--title", "From Stdin",
      "--parent", "parent-1",
      "--stdin",
    ], stdinIo.io, { configDir, ops })).toBe(0);
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "# From stdin");
  });

  it("blocks new mutating commands before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly", root_page_id: "root-1" },
      },
    });

    for (const [argv, command, op] of [
      [
        ["page", "create", "--title", "Nope", "--markdown", "Body"],
        "page create",
        "createPage",
      ],
      [
        ["page", "create-from-file", "--title", "Nope", "--file", "missing.md"],
        "page create-from-file",
        "createPage",
      ],
      [
        ["page", "duplicate", "page-1"],
        "page duplicate",
        "createPage",
      ],
      [
        ["content", "replace", "page-1", "--markdown", "Body"],
        "content replace",
        "replacePageMarkdown",
      ],
      [
        ["content", "find-replace", "page-1", "--find", "old", "--replace", "new"],
        "content find-replace",
        "updateMarkdown",
      ],
    ] as const) {
      const ops = createOps();
      const io = createIo({ WORK_TOKEN: "secret-token-value" });

      const code = await runCli(argv, io.io, { configDir, ops });

      expect(code).toBe(1);
      expect(jsonFrom(io.stdout)).toEqual({
        ok: false,
        error: {
          code: "readonly_profile",
          message: `Profile 'work-ro' is readonly and cannot run mutating command '${command}'.`,
        },
      });
      expect(ops?.createClient).not.toHaveBeenCalled();
      expect((ops as Record<string, any>)[op]).not.toHaveBeenCalled();
      expect(ops?.processFileUploads).not.toHaveBeenCalled();
    }
  });

  it("duplicates pages with source parent fallback and omitted block warnings", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      getPage: vi.fn(async () => ({
        id: "source-1",
        url: "https://notion.so/source-1",
        parent: { type: "page_id", page_id: "source-parent-1" },
        icon: { type: "emoji", emoji: "\uD83E\uDDED" },
        properties: {
          Name: { type: "title", title: [{ plain_text: "Source Page" }] },
        },
      })),
      fetchBlocksRecursive: vi.fn(async (_client, _pageId, ctx) => {
        ctx.omitted.push({ id: "child-db-1", type: "child_database" });
        return [{ type: "paragraph", paragraph: { rich_text: [] } }];
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "page", "duplicate", "source-1",
    ], io.io, { configDir, ops })).toBe(0);

    expect(ops?.createPage).toHaveBeenCalledWith(
      expect.anything(),
      { type: "page_id", page_id: "source-parent-1" },
      "Source Page (Copy)",
      [{ type: "paragraph", paragraph: { rich_text: [] } }],
      "\uD83E\uDDED",
    );
    expect(jsonFrom(io.stdout).result.warnings).toEqual([{
      code: "omitted_block_types",
      blocks: [{ id: "child-db-1", type: "child_database" }],
    }]);
  });

  it("replaces content with enhanced markdown and returns translator/unmatched warnings", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      replacePageMarkdown: vi.fn(async () => ({
        truncated: true,
        unknown_block_ids: ["block-missing"],
      })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "replace", "page-1", "--markdown", "[embed](https://example.com/embed)",
    ], io.io, { configDir, ops })).toBe(0);

    expect(ops?.replacePageMarkdown).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      "https://example.com/embed",
      { allowDeletingContent: true },
    );
    expect(jsonFrom(io.stdout).result).toEqual({
      success: true,
      truncated: true,
      warnings: [
        { code: "embed_lost_on_atomic_replace", url: "https://example.com/embed" },
        { code: "unmatched_blocks", block_ids: ["block-missing"] },
      ],
    });
  });

  it("routes find-replace through pages.updateMarkdown payload shape", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveMarkdown: vi.fn(async () => ({ markdown: "old then old again" })),
      updateMarkdown: vi.fn(async () => ({ truncated: true, unknown_block_ids: ["unknown-1"] })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "find-replace", "page-1",
      "--find", "old",
      "--replace", "new",
      "--all",
    ], io.io, { configDir, ops })).toBe(0);

    expect(ops?.retrieveMarkdown).toHaveBeenCalledWith(expect.anything(), "page-1");
    expect(ops?.updateMarkdown).toHaveBeenCalledWith(expect.anything(), {
      page_id: "page-1",
      type: "update_content",
      update_content: {
        content_updates: [{
          old_str: "old",
          new_str: "new",
          replace_all_matches: true,
        }],
      },
    });
    expect(jsonFrom(io.stdout).result).toEqual({
      success: true,
      match_count: 2,
      truncated: true,
      warnings: [{ code: "unmatched_blocks", block_ids: ["unknown-1"] }],
    });
  });

  it("reports first-only find-replace match_count from preflight markdown", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveMarkdown: vi.fn(async () => ({ markdown: "old then old again" })),
      updateMarkdown: vi.fn(async () => ({ truncated: false })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "find-replace", "page-1",
      "--find", "old",
      "--replace", "new",
    ], io.io, { configDir, ops })).toBe(0);

    expect(ops?.retrieveMarkdown).toHaveBeenCalledWith(expect.anything(), "page-1");
    expect(jsonFrom(io.stdout).result).toEqual({
      success: true,
      match_count: 1,
    });
  });

  it("does not convert a zero preflight find-replace count plus updateMarkdown rejection into success", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveMarkdown: vi.fn(async () => ({ markdown: "no matching text" })),
      updateMarkdown: vi.fn(async () => {
        throw new Error("validation_error: could not find old_str");
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "find-replace", "page-1",
      "--find", "missing",
      "--replace", "replacement",
    ], io.io, { configDir, ops })).toBe(1);

    expect(ops?.retrieveMarkdown).toHaveBeenCalledWith(expect.anything(), "page-1");
    expect(ops?.updateMarkdown).toHaveBeenCalledOnce();
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "unexpected_error",
        message: "validation_error: could not find old_str",
      },
    });
  });

  it("returns stable JSON errors for markdown input mode conflicts", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "replace", "page-1", "--markdown", "A", "--stdin",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "invalid_markdown_input",
        message: "Provide exactly one of --markdown, --markdown-file, or --stdin.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.replacePageMarkdown).not.toHaveBeenCalled();
  });

  it("returns a stable JSON error when page create has no parent fallback", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });

    for (const [argv, message] of [
      [
        ["page", "create", "--title", "No Parent", "--markdown", "Body"],
        "page create requires --parent or a profile root_page_id.",
      ],
      [
        ["page", "create", "--title", "No Parent", "--markdown-file", join(configDir, "missing.md")],
        "page create requires --parent or a profile root_page_id.",
      ],
      [
        ["page", "create-from-file", "--title", "No Parent", "--file", join(configDir, "missing.md")],
        "page create-from-file requires --parent or a profile root_page_id.",
      ],
    ] as const) {
      const ops = createOps();
      const io = createIo({ WORK_TOKEN: "secret-token-value" });

      const code = await runCli(argv, io.io, { configDir, ops });

      expect(code).toBe(1);
      expect(jsonFrom(io.stdout)).toEqual({
        ok: false,
        error: {
          code: "missing_parent",
          message,
        },
      });
      expect(ops?.createClient).not.toHaveBeenCalled();
      expect(ops?.createPage).not.toHaveBeenCalled();
      expect(ops?.processFileUploads).not.toHaveBeenCalled();
    }
  });

  it("updates a content section by heading and appends replacement markdown after the previous block", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const blocks = [
      { id: "intro", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Intro" }] } },
      { id: "h2-a", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Target" }] } },
      { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
      { id: "h3-a", type: "heading_3", heading_3: { rich_text: [{ plain_text: "Nested" }] } },
      { id: "body-b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Nested body" }] } },
      { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
    ];
    const ops = createOps({
      listChildren: vi.fn(async () => blocks),
      processFileUploads: vi.fn(async () => "Processed body"),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", " target ", "--markdown", "New body",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({ ok: true, result: { deleted: 4, appended: 1 } });
    expect(ops?.deleteBlock).toHaveBeenCalledTimes(4);
    expect(ops?.deleteBlock).toHaveBeenNthCalledWith(1, expect.anything(), "h2-a");
    expect(ops?.deleteBlock).toHaveBeenNthCalledWith(4, expect.anything(), "body-b");
    expect(ops?.processFileUploads).toHaveBeenCalledWith(expect.anything(), "New body");
    expect(ops?.appendBlocksAfter).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      expect.arrayContaining([expect.objectContaining({
        type: "paragraph",
        paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Processed body" } })]) },
      })]),
      "intro",
    );
  });

  it("updates a top content section in place so the next sibling heading stays after the replacement", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const blocks = [
      { id: "h2-a", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Target" }] } },
      { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
      { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
    ];
    const ops = createOps({
      listChildren: vi.fn(async () => blocks),
      processFileUploads: vi.fn(async () => "## Target\nReplacement body"),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--markdown", "## Target\nReplacement body",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({ ok: true, result: { deleted: 1, appended: 1 } });
    expect(ops?.updateBlock).toHaveBeenCalledWith(
      expect.anything(),
      "h2-a",
      expect.objectContaining({
        heading_2: expect.objectContaining({
          rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Target" } })]),
          is_toggleable: false,
        }),
      }),
    );
    expect(ops?.deleteBlock).toHaveBeenCalledOnce();
    expect(ops?.deleteBlock).toHaveBeenCalledWith(expect.anything(), "body-a");
    expect(ops?.appendBlocksAfter).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      expect.arrayContaining([expect.objectContaining({
        type: "paragraph",
        paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Replacement body" } })]) },
      })]),
      "h2-a",
    );
  });

  it("preserves a first content section heading with --preserve-heading and body-only markdown", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const blocks = [
      { id: "h2-a", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Target" }] } },
      { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
      { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
    ];
    const ops = createOps({
      listChildren: vi.fn(async () => blocks),
      processFileUploads: vi.fn(async () => "Replacement body"),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--preserve-heading", "--markdown", "Replacement body",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({ ok: true, result: { deleted: 1, appended: 1 } });
    expect(ops?.updateBlock).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).toHaveBeenCalledWith(expect.anything(), "body-a");
    expect(ops?.appendBlocksAfter).toHaveBeenCalledWith(
      expect.anything(),
      "page-1",
      expect.arrayContaining([expect.objectContaining({
        type: "paragraph",
        paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Replacement body" } })]) },
      })]),
      "h2-a",
    );
  });

  it("preserves a toggleable heading with --preserve-heading and replaces children", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const blocks = [
      {
        id: "h2-a",
        type: "heading_2",
        has_children: true,
        heading_2: { rich_text: [{ plain_text: "Target" }], is_toggleable: true },
      },
      { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
      { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
    ];
    const order: string[] = [];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => blockId === "page-1"
        ? blocks
        : [{ id: "old-child", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old child" }] } }]),
      processFileUploads: vi.fn(async () => "Replacement child"),
      deleteBlock: vi.fn(async (_client, blockId) => {
        order.push(`delete:${blockId}`);
        return { id: blockId };
      }),
      appendBlocks: vi.fn(async (_client, blockId, replacementBlocks) => {
        order.push(`append:${blockId}`);
        return replacementBlocks.map((_, index) => ({ id: `child-${index}` }));
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--preserve-heading", "--markdown", "Replacement child",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({ ok: true, result: { deleted: 2, appended: 1 } });
    expect(ops?.updateBlock).not.toHaveBeenCalled();
    expect(order).toEqual([
      "delete:old-child",
      "delete:body-a",
      "append:h2-a",
    ]);
    expect(ops?.appendBlocksAfter).not.toHaveBeenCalled();
  });

  it("reconciles a top content section toggle heading to plain and deletes old body before append", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const blocks = [
      {
        id: "h2-a",
        type: "heading_2",
        has_children: true,
        heading_2: { rich_text: [{ plain_text: "Target" }], is_toggleable: true },
      },
      { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
      { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
    ];
    const order: string[] = [];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => blockId === "page-1"
        ? blocks
        : [{ id: "old-child", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old child" }] } }]),
      processFileUploads: vi.fn(async () => "## Target\nReplacement body"),
      updateBlock: vi.fn(async (_client, blockId, payload) => {
        order.push(`update:${blockId}`);
        return { id: blockId, ...payload };
      }),
      deleteBlock: vi.fn(async (_client, blockId) => {
        order.push(`delete:${blockId}`);
        return { id: blockId };
      }),
      appendBlocksAfter: vi.fn(async (_client, _pageId, replacementBlocks, afterBlockId) => {
        order.push(`appendAfter:${afterBlockId}`);
        return replacementBlocks.map((_, index) => ({ id: `after-block-${index}` }));
      }),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--markdown", "## Target\nReplacement body",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(jsonFrom(io.stdout)).toEqual({ ok: true, result: { deleted: 2, appended: 1 } });
    expect(ops?.updateBlock).toHaveBeenCalledWith(
      expect.anything(),
      "h2-a",
      expect.objectContaining({
        heading_2: expect.objectContaining({ is_toggleable: false }),
      }),
    );
    expect(order).toEqual([
      "update:h2-a",
      "delete:old-child",
      "delete:body-a",
      "appendAfter:h2-a",
    ]);
  });

  it("rejects a top content section replacement with the wrong heading type before destructive mutation", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "h2-a", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Target" }] } },
        { id: "body-a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Old" }] } },
        { id: "h2-b", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Next" }] } },
      ]),
      processFileUploads: vi.fn(async () => "# Target\nReplacement body"),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--markdown", "# Target\nReplacement body",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "invalid_update_section_markdown",
        message: "update_section: when replacing the first section, markdown must start with a heading_2 block so following sections can stay in place.",
      },
    });
    expect(ops?.updateBlock).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
    expect(ops?.appendBlocksAfter).not.toHaveBeenCalled();
  });

  it("returns available headings when content update-section cannot find a heading", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      listChildren: vi.fn(async () => [
        { id: "h1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Overview" }] } },
        { id: "h2", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Details" }] } },
      ]),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Missing", "--markdown-file", join(configDir, "missing.md"),
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "heading_not_found",
        message: `Heading not found: 'Missing'. Available headings: ["Overview","Details"]`,
      },
    });
    expect(ops?.listChildren).toHaveBeenCalledWith(expect.anything(), "page-1");
    expect(ops?.processFileUploads).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocksAfter).not.toHaveBeenCalled();
  });

  it("blocks content update-section readonly profiles before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "content", "update-section", "page-1", "--heading", "Target", "--markdown", "New",
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "readonly_profile",
        message: "Profile 'work-ro' is readonly and cannot run mutating command 'content update-section'.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.listChildren).not.toHaveBeenCalled();
  });

  it("updates blocks through archived and markdown paths", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      processFileUploads: vi.fn(async () => "Processed replacement"),
    });
    const archivedIo = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli(["block", "update", "block-1", "--archived"], archivedIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(archivedIo.stdout)).toEqual({
      ok: true,
      result: { id: "block-1", type: "paragraph", archived: true },
    });
    expect(ops?.retrieveBlock).toHaveBeenCalledWith(expect.anything(), "block-1");
    expect(ops?.updateBlock).toHaveBeenLastCalledWith(expect.anything(), "block-1", { in_trash: true });
    expect(ops?.processFileUploads).not.toHaveBeenCalled();

    const markdownIo = createIo({ WORK_TOKEN: "secret-token-value" });
    expect(await runCli(["block", "update", "block-1", "--markdown", "Replacement"], markdownIo.io, { configDir, ops })).toBe(0);
    expect(jsonFrom(markdownIo.stdout)).toEqual({
      ok: true,
      result: { id: "block-1", type: "paragraph", updated: true },
    });
    expect(ops?.processFileUploads).toHaveBeenLastCalledWith(expect.anything(), "Replacement");
    expect(ops?.updateBlock).toHaveBeenLastCalledWith(
      expect.anything(),
      "block-1",
      { paragraph: { rich_text: expect.arrayContaining([expect.objectContaining({ text: { content: "Processed replacement" } })]) } },
    );
    expect((ops?.retrieveBlock as any).mock.invocationCallOrder[1]).toBeLessThan(
      (ops?.processFileUploads as any).mock.invocationCallOrder[0],
    );
  });

  it("preserves block update checked false override for to_do blocks", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveBlock: vi.fn(async () => ({ id: "todo-1", type: "to_do", to_do: { checked: true } })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "block", "update", "todo-1", "--markdown", "- [x] Done", "--checked", "false",
    ], io.io, { configDir, ops });

    expect(code).toBe(0);
    expect(ops?.updateBlock).toHaveBeenCalledWith(
      expect.anything(),
      "todo-1",
      { to_do: { rich_text: expect.any(Array), checked: false } },
    );
  });

  it("rejects invalid block update inputs before Notion mutations", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });

    for (const [argv, codeName] of [
      [["block", "update", "block-1", "--markdown", "Text", "--archived"], "invalid_argument"],
      [["block", "update", "block-1", "--markdown", "   "], "empty_markdown"],
    ] as const) {
      const ops = createOps();
      const io = createIo({ WORK_TOKEN: "secret-token-value" });

      const code = await runCli(argv, io.io, { configDir, ops });

      expect(code).toBe(1);
      expect(jsonFrom(io.stdout).error.code).toBe(codeName);
      if (codeName === "invalid_argument") {
        expect(ops?.createClient).not.toHaveBeenCalled();
      }
      expect(ops?.retrieveBlock).not.toHaveBeenCalled();
      expect(ops?.updateBlock).not.toHaveBeenCalled();
    }
  });

  it("rejects markdown updates for non-updatable existing block types", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveBlock: vi.fn(async () => ({ id: "table-1", type: "table" })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli([
      "block", "update", "table-1", "--markdown-file", join(configDir, "missing.md"),
    ], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout).error).toEqual({
      code: "non_updatable_block_type",
      message: "update_block: existing block type 'table' has no markdown content edit. Use --archived to delete it, or use content replace to rewrite the surrounding section.",
    });
    expect(ops?.retrieveBlock).toHaveBeenCalledWith(expect.anything(), "table-1");
    expect(ops?.processFileUploads).not.toHaveBeenCalled();
    expect(ops?.updateBlock).not.toHaveBeenCalled();
  });

  it("blocks block update readonly profiles before creating a Notion client", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    const code = await runCli(["block", "update", "block-1", "--archived"], io.io, { configDir, ops });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "readonly_profile",
        message: "Profile 'work-ro' is readonly and cannot run mutating command 'block update'.",
      },
    });
    expect(ops?.createClient).not.toHaveBeenCalled();
    expect(ops?.retrieveBlock).not.toHaveBeenCalled();
  });

  it("dry-run destructive commands work with readonly profiles and skip mutation ops", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-ro",
      profiles: {
        "work-ro": { token_env: "WORK_TOKEN", mode: "readonly" },
      },
    });
    const rt = (text: string) => [{ plain_text: text, text: { content: text, link: null }, annotations: {} }];
    const ops = createOps({
      listChildren: vi.fn(async (_client, blockId) => {
        if (blockId === "page-section") {
          return [
            { id: "intro", type: "paragraph", paragraph: { rich_text: rt("Intro") } },
            { id: "h2-target", type: "heading_2", heading_2: { rich_text: rt("Target") } },
            { id: "old-body", type: "paragraph", paragraph: { rich_text: rt("Old") } },
            { id: "h2-next", type: "heading_2", heading_2: { rich_text: rt("Next") } },
          ];
        }
        if (blockId === "page-toggle") {
          return [{ id: "toggle-1", type: "toggle", toggle: { rich_text: rt("Details") }, has_children: true }];
        }
        if (blockId === "toggle-1") {
          return [{ id: "old-child", type: "paragraph", paragraph: { rich_text: rt("Old child") } }];
        }
        return [];
      }),
      retrieveMarkdown: vi.fn(async () => ({ markdown: "old then old again" })),
    });

    const run = async (argv: string[]) => {
      const io = createIo({ WORK_TOKEN: "secret-token-value" });
      const code = await runCli(argv, io.io, { configDir, ops });
      expect(code).toBe(0);
      return jsonFrom(io.stdout).result;
    };

    await expect(run([
      "content", "replace", "page-1", "--markdown", "New body", "--dry-run",
    ])).resolves.toMatchObject({
      dry_run: true,
      operation: "replace_content",
      page_id: "page-1",
      would_update: true,
    });
    await expect(run([
      "content", "update-section", "page-section", "--heading", "Target", "--markdown", "Replacement", "--dry-run",
    ])).resolves.toMatchObject({
      dry_run: true,
      operation: "update_section",
      page_id: "page-section",
      deleted: 2,
      appended: 1,
      would_delete_block_ids: ["h2-target", "old-body"],
    });
    await expect(run([
      "content", "update-toggle", "page-toggle", "--title", "Details", "--markdown", "Replacement", "--dry-run",
    ])).resolves.toMatchObject({
      dry_run: true,
      operation: "update_toggle",
      block_id: "toggle-1",
      deleted: 1,
      appended: 1,
      would_delete_block_ids: ["old-child"],
    });
    await expect(run([
      "content", "archive-toggle", "page-toggle", "--title", "Details", "--dry-run",
    ])).resolves.toMatchObject({
      dry_run: true,
      operation: "archive_toggle",
      would_archive: "toggle-1",
    });
    await expect(run([
      "content", "find-replace", "page-1", "--find", "old", "--replace", "new", "--all", "--dry-run",
    ])).resolves.toMatchObject({
      dry_run: true,
      operation: "find_replace",
      match_count: 2,
      total_matches: 2,
    });
    await expect(run(["page", "archive", "page-1", "--dry-run"])).resolves.toMatchObject({
      dry_run: true,
      operation: "archive_page",
      would_archive: "page-1",
    });
    await expect(run(["database", "entry", "delete", "entry-page-1", "--dry-run"])).resolves.toMatchObject({
      dry_run: true,
      operation: "delete_database_entry",
      would_delete: "entry-page-1",
      would_archive: "entry-page-1",
    });
    await expect(run(["block", "update", "block-1", "--markdown", "Replacement", "--dry-run"])).resolves.toMatchObject({
      dry_run: true,
      operation: "update_block",
      would_update: true,
    });

    expect(ops?.processFileUploads).not.toHaveBeenCalled();
    expect(ops?.replacePageMarkdown).not.toHaveBeenCalled();
    expect(ops?.updateMarkdown).not.toHaveBeenCalled();
    expect(ops?.archivePage).not.toHaveBeenCalled();
    expect(ops?.deleteBlock).not.toHaveBeenCalled();
    expect(ops?.appendBlocks).not.toHaveBeenCalled();
    expect(ops?.appendBlocksAfter).not.toHaveBeenCalled();
    expect(ops?.updateBlock).not.toHaveBeenCalled();
  });

  it("content find-replace --all --dry-run reports all matches and skips update", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps({
      retrieveMarkdown: vi.fn(async () => ({ markdown: "old old old" })),
    });
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "find-replace", "page-1",
      "--find", "old",
      "--replace", "new",
      "--all",
      "--dry-run",
    ], io.io, { configDir, ops })).toBe(0);

    expect(jsonFrom(io.stdout).result).toMatchObject({
      dry_run: true,
      operation: "find_replace",
      match_count: 3,
      total_matches: 3,
    });
    expect(ops?.retrieveMarkdown).toHaveBeenCalledWith(expect.anything(), "page-1");
    expect(ops?.updateMarkdown).not.toHaveBeenCalled();
  });

  it("CLI dry-run rejects file upload markdown before processing uploads", async () => {
    const configDir = await makeTempDir();
    await saveProfileConfig(configDir, {
      default: "work-rw",
      profiles: {
        "work-rw": { token_env: "WORK_TOKEN", mode: "readwrite" },
      },
    });
    const ops = createOps();
    const io = createIo({ WORK_TOKEN: "secret-token-value" });

    expect(await runCli([
      "content", "replace", "page-1", "--markdown", "![photo](file:///tmp/photo.png)", "--dry-run",
    ], io.io, { configDir, ops })).toBe(1);

    expect(jsonFrom(io.stdout).error).toEqual({
      code: "dry_run_file_upload",
      message: "dry-run cannot validate file uploads without creating Notion uploads. Use HTTPS URLs or run without dry-run.",
    });
    expect(ops?.processFileUploads).not.toHaveBeenCalled();
    expect(ops?.replacePageMarkdown).not.toHaveBeenCalled();
  });

  it("returns stable JSON errors for argument failures", async () => {
    const io = createIo({});

    const code = await runCli(["search"], io.io, {
      configDir: await makeTempDir(),
      ops: createOps(),
    });

    expect(code).toBe(1);
    expect(jsonFrom(io.stdout)).toEqual({
      ok: false,
      error: {
        code: "missing_argument",
        message: "search requires a query.",
      },
    });
  });
});

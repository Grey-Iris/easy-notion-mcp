import { mkdtemp, rm } from "node:fs/promises";
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

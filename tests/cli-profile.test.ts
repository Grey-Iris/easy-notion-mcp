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
    search: vi.fn(async () => []),
    getPage: vi.fn(async () => ({
      id: "page-1",
      url: "https://notion.so/page-1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Page One" }] },
      },
    })),
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

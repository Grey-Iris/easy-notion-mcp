import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notionUrlToPageId } from "../src/markdown-to-blocks.js";

type ExecCall = {
  cmd: string;
  args: string[];
};

type NotionProbe = {
  getMe: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  getPage: ReturnType<typeof vi.fn>;
};

type InitFs = {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<any[]>;
  readFile(path: string): Promise<Buffer | string>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
};

type InitDeps = {
  io: {
    stdout: { write(str: string): unknown };
    stderr: { write(str: string): unknown };
  };
  prompt(question: string, opts?: { mask?: boolean }): Promise<string>;
  confirm(question: string, defaultNo: boolean): Promise<boolean>;
  which(bin: string): Promise<string | null>;
  exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  openBrowser(url: string): Promise<void>;
  createClient(token: string): NotionProbe;
  fs: InitFs;
  skillsSourceDir: string;
  skillsTargetDir: string;
  isTTY: boolean;
  env: Record<string, string>;
};

type InitOverrides = Partial<Omit<InitDeps, "io" | "createClient">> & {
  notion?: Partial<NotionProbe>;
  answers?: Record<string, string>;
  confirms?: Record<string, boolean>;
  createClient?: InitDeps["createClient"];
};

const tempDirs: string[] = [];

async function loadRunInit() {
  const mod = await import("../src/cli/init.js");
  return mod.runInit as (args: string[], deps?: InitDeps) => Promise<number>;
}

async function makeTempDir(prefix = "easy-notion-init-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeSkillSourceDir() {
  const root = await makeTempDir("easy-notion-skills-src-");
  await mkdir(join(root, "notion-recipes"), { recursive: true });
  await mkdir(join(root, "easy-notion-cli"), { recursive: true });
  await writeFile(join(root, "notion-recipes", "SKILL.md"), "# Notion recipes\n");
  await writeFile(join(root, "easy-notion-cli", "SKILL.md"), "# Easy Notion CLI\n");
  return root;
}

function createIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get output() {
      return `${stdout}\n${stderr}`;
    },
  };
}

function createFs(overrides: Partial<InitFs> = {}): InitFs {
  return {
    exists: vi.fn(async (path: string) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    }),
    mkdir: vi.fn(async (path: string, opts?: { recursive?: boolean }) => {
      await mkdir(path, opts);
    }),
    readdir: vi.fn(async (path: string, opts?: { withFileTypes?: boolean }) => readdir(path, opts as any)),
    readFile: vi.fn(async (path: string) => readFile(path)),
    writeFile: vi.fn(async (path: string, data: string | Buffer) => {
      await writeFile(path, data);
    }),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      await import("node:fs/promises").then((fs) => fs.rename(oldPath, newPath));
    }),
    rm: vi.fn(async (path: string, opts?: { recursive?: boolean; force?: boolean }) => {
      await rm(path, opts);
    }),
    stat: vi.fn(async (path: string) => stat(path)),
    ...overrides,
  };
}

async function createDeps(overrides: InitOverrides = {}) {
  const {
    answers: answerOverrides,
    confirms: confirmOverrides,
    createClient: createClientOverride,
    exec: execOverride,
    notion: notionOverrides,
    ...depOverrides
  } = overrides;
  const io = createIo();
  const promptCalls: Array<{ question: string; opts?: { mask?: boolean } }> = [];
  const confirmCalls: Array<{ question: string; defaultNo: boolean }> = [];
  const execCalls: ExecCall[] = [];
  const openBrowserCalls: string[] = [];
  const skillsSourceDir = overrides.skillsSourceDir ?? await makeSkillSourceDir();
  const skillsTargetDir = overrides.skillsTargetDir ?? await makeTempDir("easy-notion-skills-target-");
  const notion: NotionProbe = {
    getMe: vi.fn(async () => ({ id: "bot-1", type: "bot", name: "Easy Notion" })),
    search: vi.fn(async () => [{ id: "page-1", object: "page" }]),
    getPage: vi.fn(async (id: string) => ({ id, object: "page" })),
    ...notionOverrides,
  };
  const answers = {
    token: "secret_notion_token",
    root: "",
    url: "",
    ...answerOverrides,
  };
  const confirms = {
    skill: false,
    manual: true,
    overwrite: false,
    existing: false,
    ...confirmOverrides,
  };
  const deps: InitDeps = {
    io: io.io,
    prompt: vi.fn(async (question: string, opts?: { mask?: boolean }) => {
      promptCalls.push({ question, opts });
      if (/token/i.test(question)) return answers.token;
      if (/root/i.test(question)) return answers.root;
      if (/url|paste|page/i.test(question)) return answers.url;
      return "";
    }),
    confirm: vi.fn(async (question: string, defaultNo: boolean) => {
      confirmCalls.push({ question, defaultNo });
      if (/skill/i.test(question)) return confirms.skill;
      if (/registration|registered/i.test(question) && /existing|replace/i.test(question)) return confirms.existing;
      if (/overwrite|replace|already exists/i.test(question)) return confirms.overwrite;
      if (/already registered|existing|update|replace|skip/i.test(question)) return confirms.existing;
      if (/manual|other client|cursor|windsurf|desktop|vs code/i.test(question)) return confirms.manual;
      return false;
    }),
    which: vi.fn(async () => "/path/claude"),
    exec: vi.fn(async (cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
      if (execOverride) {
        return execOverride(cmd, args);
      }
      if (cmd === "claude" && args.join(" ") === "mcp list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }),
    openBrowser: vi.fn(async (url: string) => {
      openBrowserCalls.push(url);
    }),
    createClient: createClientOverride ?? vi.fn(() => notion),
    fs: createFs(),
    skillsSourceDir,
    skillsTargetDir,
    isTTY: true,
    env: {},
    ...depOverrides,
  };
  deps.io = io.io;
  return { deps, io, notion, promptCalls, confirmCalls, execCalls, openBrowserCalls };
}

function addCalls(calls: ExecCall[]) {
  return calls.filter((call) => call.cmd === "claude" && call.args[0] === "mcp" && call.args[1] === "add");
}

function clientSection(output: string, label: string) {
  const labels = ["Cursor", "Windsurf", "Claude Desktop", "VS Code"];
  const start = output.search(new RegExp(label, "i"));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = labels
    .filter((candidate) => candidate !== label)
    .map((candidate) => output.slice(start + label.length).search(new RegExp(candidate, "i")))
    .filter((index) => index >= 0)
    .map((index) => start + label.length + index)
    .sort((a, b) => a - b)[0] ?? output.length;
  return output.slice(start, end);
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

describe("init wizard", () => {
  it("detects Claude Code from PATH, known locations, or reports not detected without throwing", async () => {
    const runInit = await loadRunInit();

    const pathHit = await createDeps({
      which: vi.fn(async () => "/path/claude"),
    });
    await expect(runInit([], pathHit.deps)).resolves.toBe(0);
    expect(pathHit.io.output).toMatch(/Claude Code detected/i);

    const knownLocationHit = await createDeps({
      which: vi.fn(async () => null),
      fs: createFs({
        exists: vi.fn(async (path: string) => path.toLowerCase().includes("claude")),
      }),
    });
    await expect(runInit([], knownLocationHit.deps)).resolves.toBe(0);
    expect(knownLocationHit.io.output).toMatch(/Claude Code detected/i);

    const miss = await createDeps({
      which: vi.fn(async () => null),
      fs: createFs({ exists: vi.fn(async () => false) }),
    });
    await expect(runInit([], miss.deps)).resolves.toBe(0);
    expect(miss.io.output).toMatch(/Claude Code.*not detected/i);
  });

  it("accepts a token after live getMe validation succeeds", async () => {
    const runInit = await loadRunInit();
    const { deps, io, notion } = await createDeps();

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(deps.createClient).toHaveBeenCalledWith("secret_notion_token");
    expect(notion.getMe).toHaveBeenCalledOnce();
    expect(io.output).toMatch(/token.*valid/i);
  });

  it("rejects a token when live getMe validation fails and does not register the server", async () => {
    const runInit = await loadRunInit();
    const { deps, io, notion, execCalls } = await createDeps({
      notion: {
        getMe: vi.fn(async () => {
          throw new Error("unauthorized");
        }),
      },
    });

    await expect(runInit([], deps)).resolves.not.toBe(0);

    expect(notion.getMe).toHaveBeenCalled();
    expect(addCalls(execCalls)).toHaveLength(0);
    expect(io.output).toMatch(/invalid|auth|token/i);
  });

  it("detects a legacy notion registration that points at this package and does not add a duplicate", async () => {
    const runInit = await loadRunInit();
    const { deps, confirmCalls, execCalls } = await createDeps({
      exec: vi.fn(async (cmd: string, args: string[]) => {
        if (cmd === "claude" && args.join(" ") === "mcp list") {
          return {
            code: 0,
            stdout: "notion: npx -y easy-notion-mcp\n",
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(confirmCalls.some((call) => /already registered|existing|update|replace|skip/i.test(call.question))).toBe(true);
    expect(addCalls(execCalls)).toHaveLength(0);
  });

  it("replaces a confirmed legacy notion registration before adding the new easy-notion-mcp server", async () => {
    const runInit = await loadRunInit();
    const { deps, execCalls } = await createDeps({
      confirms: { existing: true },
      exec: vi.fn(async (cmd: string, args: string[]) => {
        if (cmd === "claude" && args.join(" ") === "mcp list") {
          return {
            code: 0,
            stdout: "notion: npx -y easy-notion-mcp\n",
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(execCalls).toContainEqual({
      cmd: "claude",
      args: ["mcp", "remove", "notion", "-s", "user"],
    });
    expect(addCalls(execCalls)).toHaveLength(1);
    expect(addCalls(execCalls)[0].args).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "stdio",
      "easy-notion-mcp",
      "-e",
      "NOTION_TOKEN=secret_notion_token",
      "--",
      "npx",
      "-y",
      "easy-notion-mcp",
    ]);
    expect(execCalls.findIndex((call) => call.args.join(" ") === "mcp remove notion -s user"))
      .toBeLessThan(execCalls.findIndex((call) => call.args[0] === "mcp" && call.args[1] === "add"));
  });

  it("detects an easy-notion-mcp registration and does not clobber or duplicate it", async () => {
    const runInit = await loadRunInit();
    const { deps, confirmCalls, execCalls } = await createDeps({
      exec: vi.fn(async (cmd: string, args: string[]) => {
        if (cmd === "claude" && args.join(" ") === "mcp list") {
          return {
            code: 0,
            stdout: "easy-notion-mcp: npx -y easy-notion-mcp\n",
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(confirmCalls.some((call) => /already registered|existing|update|replace|skip/i.test(call.question))).toBe(true);
    expect(addCalls(execCalls)).toHaveLength(0);
  });

  it("registers a fresh Claude Code install with unpinned npx stdio config and token env", async () => {
    const runInit = await loadRunInit();
    const { deps, execCalls } = await createDeps();

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(addCalls(execCalls)).toEqual([{
      cmd: "claude",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "stdio",
        "easy-notion-mcp",
        "-e",
        "NOTION_TOKEN=secret_notion_token",
        "--",
        "npx",
        "-y",
        "easy-notion-mcp",
      ],
    }]);
    expect(addCalls(execCalls)[0].args.at(-1)).toBe("easy-notion-mcp");
    expect(addCalls(execCalls)[0].args.join(" ")).not.toMatch(/easy-notion-mcp@/);
  });

  it("prints manual config blocks with the right top-level keys and never writes them to disk", async () => {
    const runInit = await loadRunInit();
    const writeFileSpy = vi.fn(async () => undefined);
    const renameSpy = vi.fn(async () => undefined);
    const { deps, io } = await createDeps({
      which: vi.fn(async () => null),
      fs: createFs({
        exists: vi.fn(async () => false),
        writeFile: writeFileSpy,
        rename: renameSpy,
      }),
    });

    await expect(runInit([], deps)).resolves.toBe(0);

    expect(io.output).toContain("<paste-your-notion-token-here>");
    expect(io.output).toMatch(/replace .*with your actual notion token/i);
    expect(io.output).not.toContain("secret_notion_token");
    expect(clientSection(io.output, "Cursor")).toContain('"mcpServers"');
    expect(clientSection(io.output, "Windsurf")).toContain('"mcpServers"');
    expect(clientSection(io.output, "Claude Desktop")).toContain('"mcpServers"');
    expect(clientSection(io.output, "VS Code")).toContain('"servers"');
    expect(clientSection(io.output, "VS Code")).not.toContain('"mcpServers"');
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("warns on no shared pages, confirms sharing from a pasted Notion URL, and reports inaccessible pages", async () => {
    const runInit = await loadRunInit();
    const url = "https://www.notion.so/Shared-Page-1a2b3c4d5e6f7081920a1b2c3d4e5f60";
    const pageId = notionUrlToPageId(url);
    const confirmed = await createDeps({
      answers: { url },
      notion: {
        search: vi.fn(async () => []),
      },
    });

    await expect(runInit([], confirmed.deps)).resolves.toBe(0);

    expect(confirmed.io.output).toMatch(/warning/i);
    expect(confirmed.io.output).toMatch(/share.*pages/i);
    expect(confirmed.notion.getPage).toHaveBeenCalledWith(pageId);
    expect(confirmed.io.output).toMatch(/sharing confirmed/i);

    const rejected = await createDeps({
      answers: { url },
      notion: {
        search: vi.fn(async () => []),
        getPage: vi.fn(async () => {
          throw new Error("object_not_found");
        }),
      },
    });

    await expect(runInit([], rejected.deps)).resolves.toBe(0);
    expect(rejected.io.output).toMatch(/share.*integration/i);
  });

  it("requests masked token entry in TTY mode and falls back gracefully without a TTY", async () => {
    const runInit = await loadRunInit();
    const tty = await createDeps({ isTTY: true });

    await expect(runInit([], tty.deps)).resolves.toBe(0);

    const tokenPrompt = tty.promptCalls.find((call) => /token/i.test(call.question));
    expect(tokenPrompt?.opts).toMatchObject({ mask: true });

    const nonTty = await createDeps({ isTTY: false });
    await expect(runInit([], nonTty.deps)).resolves.toBe(0);
    expect(nonTty.io.output).not.toMatch(/crash|fatal/i);
  });

  it("validates an optional root page id and warns without aborting when it is inaccessible", async () => {
    const runInit = await loadRunInit();
    const rootPageId = "1a2b3c4d5e6f7081920a1b2c3d4e5f60";
    const { deps, io, notion } = await createDeps({
      answers: { root: rootPageId },
      notion: {
        getPage: vi.fn(async (id: string) => {
          if (id === rootPageId) {
            throw new Error("object_not_found");
          }
          return { id, object: "page" };
        }),
      },
    });

    await expect(runInit(["--root-page-id", rootPageId], deps)).resolves.toBe(0);

    expect(notion.getPage).toHaveBeenCalledWith(rootPageId);
    expect(io.output).toMatch(/warning/i);
    expect(io.output).toMatch(/root page/i);
  });

  it("installs bundled skills only on opt-in, atomically, and asks before replacing existing copies", async () => {
    const runInit = await loadRunInit();
    const skipped = await createDeps({
      confirms: { skill: false },
    });

    await expect(runInit([], skipped.deps)).resolves.toBe(0);

    expect(await skipped.deps.fs.exists(join(skipped.deps.skillsTargetDir, "notion-recipes"))).toBe(false);
    expect(await skipped.deps.fs.exists(join(skipped.deps.skillsTargetDir, "easy-notion-cli"))).toBe(false);

    const installed = await createDeps({
      confirms: { skill: true },
    });
    await expect(runInit([], installed.deps)).resolves.toBe(0);

    expect(await readFile(join(installed.deps.skillsTargetDir, "notion-recipes", "SKILL.md"), "utf8"))
      .toContain("Notion recipes");
    expect(await readFile(join(installed.deps.skillsTargetDir, "easy-notion-cli", "SKILL.md"), "utf8"))
      .toContain("Easy Notion CLI");

    const renameCalls = vi.mocked(installed.deps.fs.rename).mock.calls;
    expect(renameCalls.length).toBeGreaterThanOrEqual(2);
    for (const [oldPath, newPath] of renameCalls) {
      expect(dirname(oldPath)).toBe(dirname(newPath));
      expect(basename(oldPath)).toMatch(/tmp|temp/i);
    }

    await writeFile(join(installed.deps.skillsTargetDir, "notion-recipes", "SKILL.md"), "user copy\n");
    const rerun = await createDeps({
      skillsSourceDir: installed.deps.skillsSourceDir,
      skillsTargetDir: installed.deps.skillsTargetDir,
      confirms: { skill: true, overwrite: false },
    });
    await expect(runInit([], rerun.deps)).resolves.toBe(0);

    expect(rerun.confirmCalls.some((call) => /overwrite|replace|already exists/i.test(call.question))).toBe(true);
    expect(await readFile(join(installed.deps.skillsTargetDir, "notion-recipes", "SKILL.md"), "utf8")).toBe("user copy\n");
  });
});

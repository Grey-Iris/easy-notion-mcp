import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as fsPromises from "node:fs/promises";
import { createNotionClient, getMe, getPage, searchNotion } from "../notion-client.js";
import { notionUrlToPageId } from "../markdown-to-blocks.js";

export type NotionProbe = {
  getMe(): Promise<unknown>;
  search(query: string, filter?: "pages" | "databases"): Promise<unknown[]>;
  getPage(id: string): Promise<unknown>;
};

export type InitFs = {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<any[]>;
  readFile(path: string): Promise<Buffer | string>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
};

export type InitDeps = {
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

const SERVER_NAME = "easy-notion-mcp";
const TOKEN_PLACEHOLDER = "<paste-your-notion-token-here>";
const TOKEN_URL = "https://www.notion.so/my-integrations";
const SKILL_NAMES = ["notion-recipes", "easy-notion-cli"] as const;

function defaultSkillsSourceDir() {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

function defaultSkillsTargetDir() {
  return join(homedir(), ".claude", "skills");
}

function defaultFs(): InitFs {
  return {
    exists: async (path) => {
      try {
        await fsPromises.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path, opts) => {
      await fsPromises.mkdir(path, opts);
    },
    readdir: (path, opts) => fsPromises.readdir(path, opts as any) as Promise<any[]>,
    readFile: (path) => fsPromises.readFile(path),
    writeFile: (path, data) => fsPromises.writeFile(path, data),
    rename: (oldPath, newPath) => fsPromises.rename(oldPath, newPath),
    rm: (path, opts) => fsPromises.rm(path, opts),
    stat: (path) => fsPromises.stat(path),
  };
}

function execFile(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function which(bin: string) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = await execFile(command, [bin]);
  if (result.code !== 0) {
    return null;
  }
  return result.stdout.split(/\r?\n/).find(Boolean) ?? null;
}

async function openBrowser(url: string) {
  const cmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await execFile(cmd, args);
}

async function plainPrompt(question: string) {
  if (!processStdin.isTTY) {
    processStdout.write(question);
    return "";
  }
  const rl = createInterface({ input: processStdin, output: processStdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function maskedPrompt(question: string) {
  if (!processStdin.isTTY || typeof processStdin.setRawMode !== "function") {
    return plainPrompt(question);
  }

  processStdout.write(question);
  processStdin.setRawMode(true);
  processStdin.resume();
  processStdin.setEncoding("utf8");

  return await new Promise<string>((resolve) => {
    let value = "";
    const cleanup = () => {
      processStdin.setRawMode(false);
      processStdin.pause();
      processStdin.off("data", onData);
      processStdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          resolve("");
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    processStdin.on("data", onData);
  });
}

async function defaultPrompt(question: string, opts?: { mask?: boolean }) {
  return opts?.mask ? maskedPrompt(question) : plainPrompt(question);
}

async function defaultConfirm(question: string, defaultNo: boolean) {
  const suffix = defaultNo ? " [y/N] " : " [Y/n] ";
  const answer = (await plainPrompt(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) {
    return !defaultNo;
  }
  return answer === "y" || answer === "yes";
}

function defaultCreateClient(token: string): NotionProbe {
  const client = createNotionClient(token);
  return {
    getMe: () => getMe(client),
    search: (query, filter) => searchNotion(client, query, filter),
    getPage: (id) => getPage(client, id),
  };
}

function createDefaultDeps(partial: Partial<InitDeps> = {}): InitDeps {
  return {
    io: {
      stdout: process.stdout,
      stderr: process.stderr,
    },
    prompt: defaultPrompt,
    confirm: defaultConfirm,
    which,
    exec: execFile,
    openBrowser,
    createClient: defaultCreateClient,
    fs: defaultFs(),
    skillsSourceDir: defaultSkillsSourceDir(),
    skillsTargetDir: defaultSkillsTargetDir(),
    isTTY: Boolean(process.stdin.isTTY),
    env: process.env as Record<string, string>,
    ...partial,
  };
}

function parseArgs(args: string[]) {
  let rootPageId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root-page-id") {
      rootPageId = args[index + 1];
      index += 1;
    }
  }
  return { rootPageId };
}

function writeLine(deps: InitDeps, message = "") {
  deps.io.stdout.write(`${message}\n`);
}

function knownClaudePaths(env: Record<string, string>) {
  const localAppData = env.LOCALAPPDATA;
  return [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    ...(localAppData
      ? [
          join(localAppData, "Programs", "Claude", "claude.exe"),
          join(localAppData, "AnthropicClaude", "claude.exe"),
        ]
      : []),
  ];
}

async function detectClaude(deps: InitDeps) {
  const fromPath = await deps.which("claude");
  if (fromPath) {
    writeLine(deps, "Claude Code detected");
    return true;
  }

  for (const path of knownClaudePaths(deps.env)) {
    try {
      if (await deps.fs.exists(path)) {
        writeLine(deps, "Claude Code detected");
        return true;
      }
    } catch {
      // Ignore probe failures. Detection is best effort.
    }
  }

  writeLine(deps, "Claude Code was not detected");
  return false;
}

async function promptForToken(deps: InitDeps) {
  try {
    if (deps.isTTY) {
      await deps.openBrowser(TOKEN_URL);
    }
  } catch {
    // Browser opening is best effort. The printed prompt still gives the URL.
  }
  writeLine(deps, `Create or open your Notion integration token: ${TOKEN_URL}`);
  return (await deps.prompt("Enter your Notion token: ", { mask: deps.isTTY })).trim();
}

async function validateToken(deps: InitDeps, token: string) {
  const client = deps.createClient(token);
  try {
    await client.getMe();
    writeLine(deps, "Notion token is valid");
    return { ok: true as const, client };
  } catch {
    writeLine(deps, "Invalid Notion token or authentication failed");
    return { ok: false as const, client };
  }
}

async function resolveRootPageId(deps: InitDeps, client: NotionProbe, cliRootPageId?: string) {
  const prompted = cliRootPageId ? "" : (await deps.prompt("Optional root page id: ")).trim();
  const rootPageId = cliRootPageId ?? prompted;
  if (!rootPageId) {
    return undefined;
  }

  try {
    await client.getPage(rootPageId);
    writeLine(deps, "Root page access confirmed");
    return rootPageId;
  } catch {
    writeLine(deps, "WARNING: root page could not be accessed. Continuing without a root page.");
    return undefined;
  }
}

function parseOurRegistration(line: string) {
  const [rawName, ...rest] = line.split(":");
  const name = rawName.trim();
  const command = rest.join(":");
  if (name === SERVER_NAME || name === "notion" || command.includes(SERVER_NAME)) {
    return name;
  }
  return null;
}

function claudeAddArgs(token: string, rootPageId?: string) {
  return [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "stdio",
    SERVER_NAME,
    "-e",
    `NOTION_TOKEN=${token}`,
    ...(rootPageId ? ["-e", `NOTION_ROOT_PAGE_ID=${rootPageId}`] : []),
    "--",
    "npx",
    "-y",
    "easy-notion-mcp",
  ];
}

async function registerClaude(deps: InitDeps, token: string, rootPageId?: string) {
  const list = await deps.exec("claude", ["mcp", "list"]);
  const existing = list.stdout
    .split(/\r?\n/)
    .map((line) => line.trim() ? parseOurRegistration(line) : null)
    .find((name): name is string => Boolean(name));
  if (existing) {
    const replace = await deps.confirm(`An existing easy-notion-mcp registration was found (${existing}). Replace it?`, true);
    if (!replace) {
      writeLine(deps, "Existing Claude Code registration found. Skipping duplicate add.");
      return;
    }

    await deps.exec("claude", ["mcp", "remove", existing, "-s", "user"]);
    await deps.exec("claude", claudeAddArgs(token, rootPageId));
    writeLine(deps, "Replaced existing Claude Code registration");
    return;
  }

  await deps.exec("claude", claudeAddArgs(token, rootPageId));
  writeLine(deps, "Claude Code registration complete");
}

async function checkSharedPages(deps: InitDeps, client: NotionProbe) {
  const results = await client.search("");
  if (results.length > 0) {
    return;
  }

  writeLine(deps, "WARNING: no shared pages found. Share pages with your Notion integration.");
  const url = (await deps.prompt("Paste a Notion page URL to check sharing, or press enter to skip: ")).trim();
  if (!url) {
    return;
  }

  const pageId = notionUrlToPageId(url);
  if (!pageId) {
    writeLine(deps, "Share the page with your integration, then rerun this check.");
    return;
  }

  try {
    await client.getPage(pageId);
    writeLine(deps, "sharing confirmed");
  } catch {
    writeLine(deps, "Share the page with your integration, then rerun this check.");
  }
}

function manualConfig(command: string, rootPageId?: string) {
  const env: Record<string, string> = { NOTION_TOKEN: TOKEN_PLACEHOLDER };
  if (rootPageId) {
    env.NOTION_ROOT_PAGE_ID = rootPageId;
  }
  return {
    command,
    args: ["-y", "easy-notion-mcp"],
    env,
  };
}

function printManualBlocks(deps: InitDeps, rootPageId?: string) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const mcpServers = {
    [SERVER_NAME]: manualConfig(npxCommand, rootPageId),
  };
  const servers = {
    [SERVER_NAME]: manualConfig(npxCommand, rootPageId),
  };

  writeLine(deps, `Replace ${TOKEN_PLACEHOLDER} with your actual Notion token in the blocks below.`);
  writeLine(deps, "Treat your Notion token as a secret and do not commit these blocks to source control.");
  writeLine(deps, "Cursor");
  writeLine(deps, JSON.stringify({ mcpServers }, null, 2));
  writeLine(deps, "Windsurf");
  writeLine(deps, JSON.stringify({ mcpServers }, null, 2));
  writeLine(deps, "Claude Desktop");
  writeLine(deps, JSON.stringify({ mcpServers }, null, 2));
  writeLine(deps, "VS Code");
  writeLine(deps, JSON.stringify({ servers }, null, 2));
}

async function copyDirAtomic(deps: InitDeps, source: string, target: string) {
  const parent = dirname(target);
  const temp = join(parent, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  await deps.fs.rm(temp, { recursive: true, force: true });
  await deps.fs.mkdir(temp, { recursive: true });

  async function copyInto(src: string, dest: string) {
    await deps.fs.mkdir(dest, { recursive: true });
    const entries = await deps.fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const name = typeof entry.name === "string" ? entry.name : String(entry);
      const srcPath = join(src, name);
      const destPath = join(dest, name);
      const isDirectory = typeof entry.isDirectory === "function"
        ? entry.isDirectory()
        : (await deps.fs.stat(srcPath)).isDirectory();
      if (isDirectory) {
        await copyInto(srcPath, destPath);
      } else {
        const data = await deps.fs.readFile(srcPath);
        await deps.fs.writeFile(destPath, data);
      }
    }
  }

  try {
    await copyInto(source, temp);
    await deps.fs.rm(target, { recursive: true, force: true });
    await deps.fs.rename(temp, target);
  } catch (error) {
    await deps.fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

async function installSkills(deps: InitDeps) {
  const shouldInstall = await deps.confirm("Install bundled Notion skills?", true);
  if (!shouldInstall) {
    return;
  }

  await deps.fs.mkdir(deps.skillsTargetDir, { recursive: true });
  for (const skill of SKILL_NAMES) {
    const source = join(deps.skillsSourceDir, skill);
    const target = join(deps.skillsTargetDir, skill);
    if (await deps.fs.exists(target)) {
      const overwrite = await deps.confirm(`${skill} already exists. Overwrite or replace it?`, true);
      if (!overwrite) {
        continue;
      }
    }
    await copyDirAtomic(deps, source, target);
    writeLine(deps, `Installed skill ${skill}`);
  }
}

export async function runInit(args: string[], partialDeps?: Partial<InitDeps>): Promise<number> {
  const deps = createDefaultDeps(partialDeps);
  const { rootPageId: cliRootPageId } = parseArgs(args);

  writeLine(deps, "easy-notion init wizard");

  const claudeDetected = await detectClaude(deps);
  const token = await promptForToken(deps);
  if (!token) {
    writeLine(deps, "Invalid Notion token or authentication failed");
    return 1;
  }
  const validation = await validateToken(deps, token);
  if (!validation.ok) {
    return 1;
  }

  const rootPageId = await resolveRootPageId(deps, validation.client, cliRootPageId);

  if (claudeDetected) {
    await registerClaude(deps, token, rootPageId);
  }

  await checkSharedPages(deps, validation.client);
  printManualBlocks(deps, rootPageId);
  await installSkills(deps);

  writeLine(deps, "Restart Claude Code or start a new session to pick up the user-scope MCP config.");
  writeLine(deps, "First run may be slower while npx downloads the package.");
  return 0;
}

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpLaunchSpec } from "./mcp-client.js";
import type { ServerDef, ServerId } from "./servers.js";

export interface ProvisionResult {
  id: ServerId;
  resolvedSha: string;
  pkgVersion: string;
  launch: McpLaunchSpec;
  scriptsBlock: Record<string, string>;
  binEntry: string;
  cacheDir: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const serversCacheRoot = path.join(repoRoot, ".meta/bench/.servers-cache");

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
  main?: string;
};

export async function provision(def: ServerDef): Promise<ProvisionResult> {
  if (def.kind === "local") {
    return provisionLocal(def);
  }
  return provisionGit(def);
}

async function provisionLocal(def: ServerDef): Promise<ProvisionResult> {
  const indexPath = path.join(repoRoot, "dist/index.js");
  if (!existsSync(indexPath)) {
    await run("npm", ["run", "build"], repoRoot, "local build");
  }

  const packageJson = await readPackageJson(repoRoot);
  const resolvedSha = (await run("git", ["-C", repoRoot, "rev-parse", "HEAD"], repoRoot, "local rev-parse"))
    .trim();

  return {
    id: def.id,
    resolvedSha,
    pkgVersion: packageJson.version ?? "",
    launch: { command: "node", args: [indexPath], cwd: repoRoot },
    scriptsBlock: packageJson.scripts ?? {},
    binEntry: "dist/index.js",
    cacheDir: repoRoot,
  };
}

async function provisionGit(def: ServerDef): Promise<ProvisionResult> {
  if (!def.repo || !def.pinnedSha) {
    throw new Error(`${def.id} is missing repo or pinnedSha`);
  }

  const cacheDir = path.join(serversCacheRoot, def.id);
  await mkdir(serversCacheRoot, { recursive: true });

  if (!existsSync(path.join(cacheDir, ".git"))) {
    await run("git", ["clone", def.repo, cacheDir], repoRoot, `${def.id} clone`);
  } else {
    await run("git", ["-C", cacheDir, "fetch", "--all", "--tags"], repoRoot, `${def.id} fetch`);
  }

  await run("git", ["-C", cacheDir, "checkout", def.pinnedSha], repoRoot, `${def.id} checkout`);
  const resolvedSha = (await run("git", ["-C", cacheDir, "rev-parse", "HEAD"], repoRoot, `${def.id} rev-parse`))
    .trim();
  if (resolvedSha !== def.pinnedSha) {
    throw new Error(`${def.id} resolved ${resolvedSha}, expected ${def.pinnedSha}`);
  }

  const packageJson = await readPackageJson(cacheDir);
  const scriptsBlock = packageJson.scripts ?? {};
  const binEntry = resolveBinEntry(packageJson);

  if (existsSync(path.join(cacheDir, "package-lock.json"))) {
    await run("npm", ["ci", "--ignore-scripts"], cacheDir, `${def.id} npm ci --ignore-scripts`);
  } else {
    // No lockfile means full resolution can hit upstream dev-dep peer conflicts; legacy peers keeps install reproducible while ignore-scripts still blocks lifecycle hooks.
    await run(
      "npm",
      ["install", "--ignore-scripts", "--legacy-peer-deps"],
      cacheDir,
      `${def.id} npm install --ignore-scripts --legacy-peer-deps`,
    );
  }

  if (scriptsBlock.build) {
    await run("npm", ["run", "build"], cacheDir, `${def.id} build`);
  }

  return {
    id: def.id,
    resolvedSha,
    pkgVersion: packageJson.version ?? "",
    launch: { command: "node", args: [path.resolve(cacheDir, binEntry)], cwd: cacheDir },
    scriptsBlock,
    binEntry,
    cacheDir,
  };
}

async function readPackageJson(cwd: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as PackageJson;
}

function resolveBinEntry(packageJson: PackageJson): string {
  if (typeof packageJson.bin === "string") {
    return packageJson.bin;
  }

  if (packageJson.bin) {
    const entries = Object.entries(packageJson.bin);
    const notionEntry = entries.find(([name]) => name.toLowerCase().includes("notion"));
    return notionEntry?.[1] ?? entries[0]?.[1] ?? packageJson.main ?? "dist/index.js";
  }

  return packageJson.main ?? "dist/index.js";
}

async function run(command: string, args: string[], cwd: string, label: string): Promise<string> {
  console.error(`[bench provision] ${label}: ${command} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `${label} failed to spawn: ${formatError(error)}\n` +
            `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
        ),
      );
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `${label} failed (code=${code}, signal=${signal}).\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

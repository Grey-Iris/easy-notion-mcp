import { execSync } from "node:child_process";

export interface RunContext {
  shortSha: string;
  startedAt: Date;
  sandboxId?: string;
  sandboxName?: string;
  createdPageIds: string[];
}

export async function buildRunContext(): Promise<RunContext> {
  return {
    shortSha: getShortSha(),
    startedAt: new Date(),
    createdPageIds: [],
  };
}

function getShortSha(): string {
  try {
    const output = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || "unknown";
  } catch {
    return "unknown";
  }
}

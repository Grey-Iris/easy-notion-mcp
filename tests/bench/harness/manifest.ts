import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { RunManifest, ScenarioResult } from "./types.ts";

export interface RunResultInput {
  runId: string;
  gitSha: string;
  gitBranch: string;
  startedAt: string;
  finishedAt: string;
  model: string;
  nodeVersion: string;
  scenarios: ScenarioResult[];
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildManifest(runResult: RunResultInput): RunManifest {
  const scenarios = runResult.scenarios.map((scenario) => ({
    id: scenario.id,
    passed: scenario.passed,
    duration_ms: scenario.durationMs,
    cost_usd: scenario.costUsd,
    transcript_path: scenario.transcriptPath ?? "",
    transcript_sha256: scenario.transcriptSha256 ?? "",
  }));

  const passed = scenarios.filter((scenario) => scenario.passed).length;
  const failed = scenarios.length - passed;
  const totalCost = scenarios.reduce((sum, scenario) => sum + scenario.cost_usd, 0);

  return {
    run_id: runResult.runId,
    git_sha: runResult.gitSha,
    git_branch: runResult.gitBranch,
    started_at: runResult.startedAt,
    finished_at: runResult.finishedAt,
    model: runResult.model,
    node_version: runResult.nodeVersion,
    scenarios,
    totals: {
      scenarios_run: scenarios.length,
      passed,
      failed,
      cost_usd: totalCost,
    },
  };
}

export async function writeManifest(path: string, manifest: RunManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

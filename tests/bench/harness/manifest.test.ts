import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenarioResult, TranscriptData, VerifyResult } from "./types.ts";

async function importManifest() {
  return import("./manifest.ts");
}

function makeTranscript(): TranscriptData {
  return {
    toolUses: [],
    toolResults: [],
    result: { text: "The bot id is 349be876.", costUsd: 0.028 },
    model: "claude-sonnet-4-6",
    events: [],
  };
}

function makeVerification(): VerifyResult {
  return {
    passed: true,
    claims: [],
    warnings: [],
  };
}

function makeScenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: "13-identity-smoke",
    passed: true,
    durationMs: 54210,
    costUsd: 0.028,
    transcript: makeTranscript(),
    verification: makeVerification(),
    transcriptPath:
      ".meta/bench/transcripts/2026-04-23-a1b2c3d/scenario-13-identity-smoke.ndjson",
    transcriptSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ...overrides,
  };
}

function makeRunResult() {
  return {
    runId: "run-2026-04-23-a1b2c3d",
    gitSha: "a1b2c3d4e5f6",
    gitBranch: "bench-a/pilot",
    startedAt: "2026-04-23T13:04:00Z",
    finishedAt: "2026-04-23T13:17:42Z",
    model: "claude-sonnet-4-6",
    nodeVersion: "v20.11.1",
    scenarios: [makeScenarioResult()],
  };
}

describe("bench harness manifest", () => {
  it("produces a deterministic SHA256 for the same content", async () => {
    const { sha256Hex } = await importManifest();

    const hashA = sha256Hex("same transcript content");
    const hashB = sha256Hex("same transcript content");

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds manifest JSON with the required schema fields", async () => {
    const { buildManifest } = await importManifest();

    const manifest = buildManifest(makeRunResult());

    expect(manifest).toEqual(
      expect.objectContaining({
        run_id: "run-2026-04-23-a1b2c3d",
        git_sha: "a1b2c3d4e5f6",
        started_at: "2026-04-23T13:04:00Z",
        finished_at: "2026-04-23T13:17:42Z",
        model: "claude-sonnet-4-6",
        scenarios: [
          expect.objectContaining({
            id: "13-identity-smoke",
            passed: true,
            duration_ms: 54210,
            transcript_sha256:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          }),
        ],
      }),
    );
  });

  it("writes manifest JSON to the requested path", async () => {
    const { buildManifest, writeManifest } = await importManifest();
    const outDir = await mkdtemp(join(tmpdir(), "bench-manifest-"));
    const manifestPath = join(outDir, "run.manifest.json");
    const manifest = buildManifest(makeRunResult());

    try {
      await writeManifest(manifestPath, manifest);

      const written = JSON.parse(await readFile(manifestPath, "utf8"));

      expect(written).toEqual(manifest);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

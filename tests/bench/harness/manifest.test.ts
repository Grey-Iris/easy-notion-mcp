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
    status: "pass",
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

function makeRunResult(
  overrides: Partial<{
    runId: string;
    gitSha: string;
    gitBranch: string;
    startedAt: string;
    finishedAt: string;
    model: string;
    nodeVersion: string;
    scenarios: ScenarioResult[];
  }> = {},
) {
  return {
    runId: "run-2026-04-23-a1b2c3d",
    gitSha: "a1b2c3d4e5f6",
    gitBranch: "bench-a/pilot",
    startedAt: "2026-04-23T13:04:00Z",
    finishedAt: "2026-04-23T13:17:42Z",
    model: "claude-sonnet-4-6",
    nodeVersion: "v20.11.1",
    scenarios: [makeScenarioResult()],
    ...overrides,
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
            status: "pass",
            duration_ms: 54210,
            transcript_sha256:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          }),
        ],
        totals: expect.objectContaining({
          passed: 1,
          failed: 0,
          skipped: 0,
        }),
      }),
    );
  });

  it("buildManifest includes per-claim data in scenario entries", async () => {
    const { buildManifest } = await importManifest();
    const manifest = buildManifest(
      makeRunResult({
        scenarios: [
          makeScenarioResult({
            verification: {
              passed: false,
              warnings: [],
              claims: [
                { claim: "databases[0]", passed: true },
                { claim: "rows[1]", passed: false, message: "row not found" },
              ],
            },
          }),
        ],
      }),
    );
    const scenario = manifest.scenarios[0] as (typeof manifest.scenarios)[number] & {
      claims?: Array<{ kind: string; index: number; status: "pass" | "fail"; reason?: string }>;
    };

    expect(scenario.claims).toEqual([
      { kind: "databases[0]", index: 0, status: "pass" },
      { kind: "rows[1]", index: 1, status: "fail", reason: "row not found" },
    ]);
  });

  it("buildManifest omits reason on passing claims", async () => {
    const { buildManifest } = await importManifest();
    const manifest = buildManifest(
      makeRunResult({
        scenarios: [
          makeScenarioResult({
            verification: {
              passed: true,
              warnings: [],
              claims: [{ claim: "pages[0]", passed: true }],
            },
          }),
        ],
      }),
    );
    const scenario = manifest.scenarios[0] as (typeof manifest.scenarios)[number] & {
      claims?: Array<{ kind: string; index: number; status: "pass" | "fail"; reason?: string }>;
    };

    expect(scenario.claims).toHaveLength(1);
    expect(scenario.claims?.[0]).toEqual({
      kind: "pages[0]",
      index: 0,
      status: "pass",
    });
    expect(scenario.claims?.[0]).not.toHaveProperty("reason");
  });

  it("buildManifest handles scenario with empty claims array", async () => {
    const { buildManifest } = await importManifest();
    const manifest = buildManifest(
      makeRunResult({
        scenarios: [
          makeScenarioResult({
            verification: {
              passed: true,
              warnings: [],
              claims: [],
            },
          }),
        ],
      }),
    );
    const scenario = manifest.scenarios[0] as (typeof manifest.scenarios)[number] & {
      claims?: Array<{ kind: string; index: number; status: "pass" | "fail"; reason?: string }>;
    };

    expect(scenario.claims).toEqual([]);
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

  it("writeManifest persists per-claim data to disk", async () => {
    const { buildManifest, writeManifest } = await importManifest();
    const outDir = await mkdtemp(join(tmpdir(), "bench-manifest-"));
    const manifestPath = join(outDir, "run.manifest.json");
    const manifest = buildManifest(
      makeRunResult({
        scenarios: [
          makeScenarioResult({
            verification: {
              passed: false,
              warnings: [],
              claims: [
                { claim: "databases[0]", passed: true },
                { claim: "rows[1]", passed: false, message: "row not found" },
              ],
            },
          }),
        ],
      }),
    );

    try {
      await writeManifest(manifestPath, manifest);

      const written = JSON.parse(await readFile(manifestPath, "utf8")) as {
        scenarios: Array<{
          claims?: Array<{
            kind: string;
            index: number;
            status: "pass" | "fail";
            reason?: string;
          }>;
        }>;
      };

      expect(written.scenarios[0]?.claims).toEqual([
        { kind: "databases[0]", index: 0, status: "pass" },
        { kind: "rows[1]", index: 1, status: "fail", reason: "row not found" },
      ]);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

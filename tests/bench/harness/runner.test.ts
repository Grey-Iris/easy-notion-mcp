import { describe, expect, it, vi } from "vitest";
import type { ClaimResult, VerifyResult } from "./types.ts";

async function importRunner() {
  return import("./runner.ts");
}

type VerifyWithRetryResult = {
  result: VerifyResult;
  attempts: number;
};

type RunnerModuleUnderTest = Awaited<ReturnType<typeof importRunner>> & {
  verifyWithRetry?: (
    verify: () => Promise<VerifyResult>,
    maxAttempts: number,
    backoffMs: number,
  ) => Promise<VerifyWithRetryResult>;
  VERIFY_RETRY_ATTEMPTS?: number;
  VERIFY_RETRY_BACKOFF_MS?: number;
};

function makeClaim(overrides: Partial<ClaimResult> = {}): ClaimResult {
  return {
    passed: true,
    claim: "pages[0]",
    ...overrides,
  };
}

function makeVerifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    passed: true,
    claims: [],
    warnings: [],
    ...overrides,
  };
}

describe("bench harness runner", () => {
  it("returns on first attempt when verification passes", async () => {
    const { verifyWithRetry } = await importRunner() as RunnerModuleUnderTest;
    const verify = vi.fn().mockResolvedValue(
      makeVerifyResult({
        passed: true,
        claims: [makeClaim({ claim: "pages[0]", passed: true })],
      }),
    );

    expect(verifyWithRetry).toBeTypeOf("function");

    const outcome = await verifyWithRetry!(verify, 5, 10);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.result.passed).toBe(true);
  });

  it("retries up to maxAttempts when verification consistently fails", async () => {
    const { verifyWithRetry } = await importRunner() as RunnerModuleUnderTest;
    const verify = vi.fn().mockResolvedValue(
      makeVerifyResult({
        passed: false,
        claims: [makeClaim({ claim: "databases[0]", passed: false, message: "still missing" })],
      }),
    );

    expect(verifyWithRetry).toBeTypeOf("function");

    const outcome = await verifyWithRetry!(verify, 3, 10);

    expect(verify).toHaveBeenCalledTimes(3);
    expect(outcome.attempts).toBe(3);
    expect(outcome.result.passed).toBe(false);
  });

  it("stops retrying once verification passes", async () => {
    const { verifyWithRetry } = await importRunner() as RunnerModuleUnderTest;
    const verify = vi
      .fn()
      .mockResolvedValueOnce(
        makeVerifyResult({
          passed: false,
          claims: [makeClaim({ claim: "rows[0]", passed: false, message: "not yet visible" })],
        }),
      )
      .mockResolvedValueOnce(
        makeVerifyResult({
          passed: false,
          claims: [makeClaim({ claim: "rows[0]", passed: false, message: "still not visible" })],
        }),
      )
      .mockResolvedValueOnce(
        makeVerifyResult({
          passed: true,
          claims: [makeClaim({ claim: "rows[0]", passed: true })],
        }),
      );

    expect(verifyWithRetry).toBeTypeOf("function");

    const outcome = await verifyWithRetry!(verify, 5, 10);

    expect(verify).toHaveBeenCalledTimes(3);
    expect(outcome.attempts).toBe(3);
    expect(outcome.result.passed).toBe(true);
  });

  it("returns last result with all claims on exhaustion", async () => {
    const { verifyWithRetry } = await importRunner() as RunnerModuleUnderTest;
    const finalClaims: ClaimResult[] = [
      makeClaim({ claim: "databases[0]", passed: false, message: "database missing" }),
      makeClaim({ claim: "rows[1]", passed: false, message: "row missing" }),
    ];
    const verify = vi
      .fn()
      .mockResolvedValue(makeVerifyResult({ passed: false, claims: finalClaims }));

    expect(verifyWithRetry).toBeTypeOf("function");

    const outcome = await verifyWithRetry!(verify, 3, 10);

    expect(outcome.attempts).toBe(3);
    expect(outcome.result).toEqual(
      expect.objectContaining({
        passed: false,
        claims: finalClaims,
      }),
    );
  });

  it("exports VERIFY_RETRY_ATTEMPTS as 5 and VERIFY_RETRY_BACKOFF_MS as 3000", async () => {
    const runner = await importRunner() as RunnerModuleUnderTest;

    expect(runner.VERIFY_RETRY_ATTEMPTS).toBe(5);
    expect(runner.VERIFY_RETRY_BACKOFF_MS).toBe(3_000);
  });
});

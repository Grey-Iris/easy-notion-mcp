import type { ClaimResult, GroundTruth, VerifyResult } from "./types.ts";
import type { TranscriptData } from "./types.ts";

export interface SdkContext {
  listUsers: () => Promise<Array<{ id: string; type: string; name?: string }>>;
}

function buildUsersClaimResult(
  claimIndex: number,
  failures: string[],
): ClaimResult {
  return {
    passed: failures.length === 0,
    claim: `users[${claimIndex}]`,
    ...(failures.length > 0 ? { message: failures.join("; ") } : {}),
  };
}

export async function verifyGroundTruth(
  groundTruth: GroundTruth,
  transcript: TranscriptData,
  sdkContext: SdkContext,
): Promise<VerifyResult> {
  const claims: ClaimResult[] = [];
  const warnings: string[] = [];

  if (groundTruth.users && groundTruth.users.length > 0) {
    const users = await sdkContext.listUsers();

    groundTruth.users.forEach((claim, index) => {
      const failures: string[] = [];

      if (claim.must_include_bot && !users.some((user) => user.type === "bot")) {
        failures.push("Expected user list to include a bot user");
      }

      if (typeof claim.size_min === "number" && users.length < claim.size_min) {
        failures.push(
          `Expected user list size to be at least ${claim.size_min}, got ${users.length}`,
        );
      }

      claims.push(buildUsersClaimResult(index, failures));
    });
  }

  if (groundTruth.tools_must_be_called && groundTruth.tools_must_be_called.length > 0) {
    const claimWarnings = groundTruth.tools_must_be_called
      .filter((requiredTool) => !transcript.toolUses.some((toolUse) => toolUse.name.endsWith(requiredTool)))
      .map((requiredTool) => `Expected tool to be called: ${requiredTool}`);

    warnings.push(...claimWarnings);
    claims.push({
      passed: true,
      claim: "tools_must_be_called",
      ...(claimWarnings.length > 0 ? { warnings: claimWarnings } : {}),
    });
  }

  return {
    passed: claims.every((claim) => claim.passed),
    claims,
    warnings,
  };
}

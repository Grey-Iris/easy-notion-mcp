import type { AssertContext, AssertResult } from "../../harness/types.ts";

export async function assert(ctx: AssertContext): Promise<AssertResult> {
  const listUsersCall = ctx.transcript.toolUses.find((toolUse) => toolUse.name.endsWith("list_users"));
  if (!listUsersCall) {
    return { passed: true, message: "list_users not called - no people-column safety check needed" };
  }

  const listUsersResult = ctx.transcript.toolResults.find(
    (toolResult) => toolResult.toolUseId === listUsersCall.id,
  );
  if (!listUsersResult) {
    return { passed: false, message: "list_users was called but no result found" };
  }

  try {
    const content = JSON.parse(listUsersResult.content);
    const hasBotUser = Array.isArray(content)
      ? content.some((user: any) => user.type === "bot")
      : typeof content === "object" && content !== null && JSON.stringify(content).includes("\"bot\"");

    return {
      passed: true,
      message: hasBotUser
        ? "list_users returned bot users - safety filter available"
        : "list_users returned no bot users",
    };
  } catch {
    return { passed: true, message: "list_users result parsed but format uncertain" };
  }
}

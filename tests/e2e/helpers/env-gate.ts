export function checkE2eEnv(): {
  shouldRun: boolean;
  reason?: string;
  token?: string;
  rootId?: string;
} {
  const token = process.env.NOTION_TOKEN;
  const rootId = process.env.E2E_ROOT_PAGE_ID;
  const enforce = process.env.E2E_ENFORCE === "1";

  if (!token) {
    const reason = "NOTION_TOKEN not set";
    if (enforce) {
      throw new Error(reason);
    }
    return { shouldRun: false, reason };
  }

  if (!rootId) {
    const reason = "E2E_ROOT_PAGE_ID not set";
    if (enforce) {
      throw new Error(reason);
    }
    return { shouldRun: false, reason };
  }

  return {
    shouldRun: true,
    token,
    rootId,
  };
}

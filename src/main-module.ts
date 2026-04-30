import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(argv1: string | undefined, importMetaUrl: string): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}

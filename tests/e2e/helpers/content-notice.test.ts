import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_NOTICE } from "./content-notice.js";

describe("content notice drift guard", () => {
  it("matches the CONTENT_NOTICE literal in src/server.ts", () => {
    const serverPath = resolve(process.cwd(), "src/server.ts");
    const source = readFileSync(serverPath, "utf8");
    const match = source.match(/const CONTENT_NOTICE = "([^"]+)";/);

    if (!match) {
      throw new Error("Could not find CONTENT_NOTICE literal in src/server.ts");
    }

    const sourceValue = JSON.parse(`"${match[1]}"`) as string;
    expect(sourceValue).toBe(CONTENT_NOTICE);
  });
});

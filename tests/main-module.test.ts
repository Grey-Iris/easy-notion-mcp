import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMainModule } from "../src/main-module.js";

describe("isMainModule", () => {
  let tempDir: string;
  let realEntrypoint: string;
  let otherEntrypoint: string;
  let binShim: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "easy-notion-main-module-"));
    realEntrypoint = join(tempDir, "http.js");
    otherEntrypoint = join(tempDir, "index.js");
    binShim = join(tempDir, "easy-notion-mcp-http");

    await writeFile(realEntrypoint, "");
    await writeFile(otherEntrypoint, "");
    await symlink(realEntrypoint, binShim);
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns true for direct invocation when paths match", () => {
    expect(isMainModule(realEntrypoint, pathToFileURL(realEntrypoint).href)).toBe(true);
  });

  it("returns true when argv1 is a bin shim symlink to the loaded module", () => {
    expect(isMainModule(binShim, pathToFileURL(realEntrypoint).href)).toBe(true);
  });

  it("returns false for genuinely different real files", () => {
    expect(isMainModule(otherEntrypoint, pathToFileURL(realEntrypoint).href)).toBe(false);
  });

  it("returns false when argv1 is undefined", () => {
    expect(isMainModule(undefined, pathToFileURL(realEntrypoint).href)).toBe(false);
  });

  it("returns false when argv1 does not exist", () => {
    expect(
      isMainModule("/nonexistent/path/that/does/not/exist", pathToFileURL(realEntrypoint).href),
    ).toBe(false);
  });
});

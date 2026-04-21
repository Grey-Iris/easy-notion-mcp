import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BotShapeError,
  InstallFailedError,
  McpError,
  NpmNotFoundError,
  runSmoke,
  usageText,
  type SmokeDeps,
} from "./postpublish-smoke.js";

function makeFakeDeps(): SmokeDeps {
  return {
    mkTmpDir: vi.fn().mockResolvedValue("/tmp/fake-smoke-xyz"),
    rmTmpDir: vi.fn().mockResolvedValue(undefined),
    installTarball: vi.fn().mockResolvedValue(undefined),
    runMcpHandshake: vi.fn().mockResolvedValue({
      id: "abc",
      name: "Test",
      type: "bot",
    }),
  };
}

describe("runSmoke", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 0 on the happy path and performs install, handshake, and cleanup", async () => {
    const deps = makeFakeDeps();

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, deps)).resolves.toBe(0);

    expect(deps.mkTmpDir).toHaveBeenCalledTimes(1);
    expect(deps.installTarball).toHaveBeenCalledTimes(1);
    expect(deps.installTarball).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
    expect(deps.runMcpHandshake).toHaveBeenCalledTimes(1);
    expect(deps.runMcpHandshake).toHaveBeenCalledWith({
      tmpDir: "/tmp/fake-smoke-xyz",
      token: "t",
    });
    expect(deps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(deps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
  });

  it("returns 2 when NOTION_TOKEN is missing and does not start work", async () => {
    const deps = makeFakeDeps();

    await expect(runSmoke([], {}, deps)).resolves.toBe(2);

    expect(deps.mkTmpDir).not.toHaveBeenCalled();
    expect(deps.installTarball).not.toHaveBeenCalled();
    expect(deps.runMcpHandshake).not.toHaveBeenCalled();
    expect(deps.rmTmpDir).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("NOTION_TOKEN"));
  });

  it("returns 3 when npm install fails and still cleans up the temp dir", async () => {
    const deps = makeFakeDeps();
    deps.installTarball = vi.fn().mockRejectedValue(new InstallFailedError("tarball unreachable"));

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, deps)).resolves.toBe(3);

    expect(deps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(deps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/install/i));
  });

  it("returns 4 when the JSON-RPC handshake fails and still cleans up the temp dir", async () => {
    const deps = makeFakeDeps();
    deps.runMcpHandshake = vi.fn().mockRejectedValue(new McpError("server exited with code 1"));

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, deps)).resolves.toBe(4);

    expect(deps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(deps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("handshake"));
  });

  it("returns 5 when the returned user is not a bot or when bot shape validation throws", async () => {
    const wrongShapeDeps = makeFakeDeps();
    wrongShapeDeps.runMcpHandshake = vi.fn().mockResolvedValue({
      id: "abc",
      name: "Someone",
      type: "person",
    });

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, wrongShapeDeps)).resolves.toBe(5);

    expect(wrongShapeDeps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(wrongShapeDeps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/not a bot/i));

    errorSpy.mockClear();

    const strictShapeDeps = makeFakeDeps();
    strictShapeDeps.runMcpHandshake = vi.fn().mockRejectedValue(new BotShapeError("returned user is not a bot"));

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, strictShapeDeps)).resolves.toBe(5);

    expect(strictShapeDeps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(strictShapeDeps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/not a bot/i));
  });

  it("returns 0 for --help and only prints usage", async () => {
    const deps = makeFakeDeps();

    await expect(runSmoke(["--help"], { NOTION_TOKEN: "t" }, deps)).resolves.toBe(0);

    expect(deps.mkTmpDir).not.toHaveBeenCalled();
    expect(deps.installTarball).not.toHaveBeenCalled();
    expect(deps.runMcpHandshake).not.toHaveBeenCalled();
    expect(deps.rmTmpDir).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("returns 2 when npm is not on PATH and still cleans up the temp dir", async () => {
    const deps = makeFakeDeps();
    deps.installTarball = vi.fn().mockRejectedValue(new NpmNotFoundError("npm not found"));

    await expect(runSmoke([], { NOTION_TOKEN: "t" }, deps)).resolves.toBe(2);

    expect(deps.rmTmpDir).toHaveBeenCalledTimes(1);
    expect(deps.rmTmpDir).toHaveBeenCalledWith("/tmp/fake-smoke-xyz");
  });
});

describe("usageText", () => {
  it("returns text that mentions postpublish-smoke and --help", () => {
    expect(usageText()).toContain("postpublish-smoke");
    expect(usageText()).toContain("--help");
  });
});

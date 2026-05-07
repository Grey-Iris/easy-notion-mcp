import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processFileUploads } from "../src/file-upload.js";

async function makeTempDir(prefix: string, cleanupDirs: string[]) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

describe("processFileUploads workspace root containment", () => {
  const originalWorkspaceRoot = process.env.NOTION_MCP_WORKSPACE_ROOT;
  let cleanupDirs: string[] = [];

  beforeEach(() => {
    cleanupDirs = [];
  });

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.NOTION_MCP_WORKSPACE_ROOT;
    } else {
      process.env.NOTION_MCP_WORKSPACE_ROOT = originalWorkspaceRoot;
    }
    await Promise.all(cleanupDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  });

  function makeClient() {
    return {
      fileUploads: {
        create: vi.fn(async () => ({ id: "upload-123" })),
        send: vi.fn(async () => undefined),
      },
    };
  }

  it("rejects markdown file URLs outside NOTION_MCP_WORKSPACE_ROOT before creating an upload", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const outsideRoot = await makeTempDir("upload-root-outside-", cleanupDirs);
    const outsideFile = join(outsideRoot, "secret.txt");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(outsideFile, "do not upload");

    await expect(
      processFileUploads(client as any, `![secret](${pathToFileURL(outsideFile).href})`, "stdio"),
    ).rejects.toThrow(/outside the allowed workspace root/i);
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });

  it("uploads markdown file URLs inside NOTION_MCP_WORKSPACE_ROOT", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const insideFile = join(allowedRoot, "report.txt");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(insideFile, "allowed upload");

    await expect(
      processFileUploads(client as any, `[report](${pathToFileURL(insideFile).href})`, "stdio"),
    ).resolves.toBe("[report](notion-upload:upload-123:file)");
    expect(client.fileUploads.create).toHaveBeenCalledWith({
      mode: "single_part",
      filename: "report.txt",
      content_type: "text/plain",
    });
    expect(client.fileUploads.send).toHaveBeenCalledTimes(1);
  });

  it("rejects symlinks inside the workspace root that resolve outside it", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const outsideRoot = await makeTempDir("upload-root-outside-", cleanupDirs);
    const outsideFile = join(outsideRoot, "secret.txt");
    const symlinkPath = join(allowedRoot, "link.txt");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(outsideFile, "do not upload");
    await symlink(outsideFile, symlinkPath);

    await expect(
      processFileUploads(client as any, `![secret](${pathToFileURL(symlinkPath).href})`, "stdio"),
    ).rejects.toThrow(/outside the allowed workspace root/i);
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });

  it("rejects mixed inside-root and outside-root markdown without uploading the valid file", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const outsideRoot = await makeTempDir("upload-root-outside-", cleanupDirs);
    const insideFile = join(allowedRoot, "allowed.txt");
    const outsideFile = join(outsideRoot, "secret.txt");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(insideFile, "allowed upload");
    await writeFile(outsideFile, "do not upload");

    const markdown = [
      `![allowed](${pathToFileURL(insideFile).href})`,
      `![secret](${pathToFileURL(outsideFile).href})`,
    ].join("\n");

    await expect(processFileUploads(client as any, markdown, "stdio")).rejects.toThrow(
      /outside the allowed workspace root/i,
    );
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });

  it("rejects mixed valid file and inside-root directory without uploading the valid file", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const insideFile = join(allowedRoot, "allowed.txt");
    const directoryPath = join(allowedRoot, "directory-input");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(insideFile, "allowed upload");
    await mkdir(directoryPath);

    const markdown = [
      `![allowed](${pathToFileURL(insideFile).href})`,
      `![directory](${pathToFileURL(directoryPath).href})`,
    ].join("\n");

    await expect(processFileUploads(client as any, markdown, "stdio")).rejects.toThrow(
      /not a regular file/i,
    );
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });

  it("rejects mixed valid file and oversized file without uploading the valid file", async () => {
    const allowedRoot = await makeTempDir("upload-root-allowed-", cleanupDirs);
    const insideFile = join(allowedRoot, "allowed.txt");
    const oversizedFile = join(allowedRoot, "oversized.bin");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await writeFile(insideFile, "allowed upload");
    await writeFile(oversizedFile, Buffer.alloc(20 * 1024 * 1024 + 1));

    const markdown = [
      `![allowed](${pathToFileURL(insideFile).href})`,
      `![oversized](${pathToFileURL(oversizedFile).href})`,
    ].join("\n");

    await expect(processFileUploads(client as any, markdown, "stdio")).rejects.toThrow(
      /file too large|max 20mb/i,
    );
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });

  it("uses separator-aware containment instead of allowing prefix sibling roots", async () => {
    const parentDir = await makeTempDir("upload-root-parent-", cleanupDirs);
    const allowedRoot = join(parentDir, "root");
    const siblingRoot = join(parentDir, "root-sibling");
    const siblingFile = join(siblingRoot, "secret.txt");
    const client = makeClient();

    process.env.NOTION_MCP_WORKSPACE_ROOT = allowedRoot;
    await mkdir(allowedRoot);
    await mkdir(siblingRoot);
    await writeFile(siblingFile, "do not upload");

    await expect(
      processFileUploads(client as any, `![secret](${pathToFileURL(siblingFile).href})`, "stdio"),
    ).rejects.toThrow(/outside the allowed workspace root/i);
    expect(client.fileUploads.create).not.toHaveBeenCalled();
    expect(client.fileUploads.send).not.toHaveBeenCalled();
  });
});

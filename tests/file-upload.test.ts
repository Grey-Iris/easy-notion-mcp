import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCodeRanges, processFileUploads } from "../src/file-upload.js";
import { uploadFile } from "../src/notion-client.js";

vi.mock("../src/notion-client.js", () => ({
  uploadFile: vi.fn(),
}));

describe("getCodeRanges", () => {
  it("returns an empty array when markdown has no code", () => {
    expect(getCodeRanges("plain markdown")).toEqual([]);
  });

  it("finds an inline code span range", () => {
    const code = "`code here`";
    const markdown = `before ${code} after`;

    expect(getCodeRanges(markdown)).toEqual([
      {
        start: markdown.indexOf(code),
        end: markdown.indexOf(code) + code.length,
      },
    ]);
  });

  it("finds a fenced code block range", () => {
    const markdown = "```ts\nconst x = 1;\n```";

    expect(getCodeRanges(markdown)).toEqual([
      {
        start: 0,
        end: markdown.length,
      },
    ]);
  });

  it("finds multiple inline and fenced code ranges", () => {
    const inlineOne = "`code`";
    const fenced = "```ts\nconst x = 1;\n```";
    const inlineTwo = "`more`";
    const markdown = `prefix ${inlineOne} mid\n${fenced}\nsuffix ${inlineTwo}`;

    expect(getCodeRanges(markdown)).toEqual([
      {
        start: markdown.indexOf(inlineOne),
        end: markdown.indexOf(inlineOne) + inlineOne.length,
      },
      {
        start: markdown.indexOf(fenced),
        end: markdown.indexOf(fenced) + fenced.length + 1,
      },
      {
        start: markdown.indexOf(inlineTwo),
        end: markdown.indexOf(inlineTwo) + inlineTwo.length,
      },
    ]);
  });
});

describe("processFileUploads", () => {
  const mockedUploadFile = vi.mocked(uploadFile);

  beforeEach(() => {
    mockedUploadFile.mockReset();
  });

  it("skips file URLs inside inline code spans", async () => {
    const markdown = "`![](file:///tmp/test.png)`";

    await expect(processFileUploads({} as any, markdown)).resolves.toBe(markdown);
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });

  it("skips file URLs inside fenced code blocks", async () => {
    const markdown = "```md\n![](file:///tmp/test.png)\n```";

    await expect(processFileUploads({} as any, markdown)).resolves.toBe(markdown);
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });

  it("processes a normal file URL image", async () => {
    mockedUploadFile.mockResolvedValue({ id: "upload-123", blockType: "image" });
    const markdown = "![photo](file:///tmp/real.png)";

    await expect(processFileUploads({} as any, markdown)).resolves.toBe(
      "![photo](notion-upload:upload-123:image)",
    );
    expect(mockedUploadFile).toHaveBeenCalledTimes(1);
    expect(mockedUploadFile).toHaveBeenCalledWith({} as any, "file:///tmp/real.png");
  });

  it("processes real file URLs and skips example URLs in code spans", async () => {
    mockedUploadFile.mockResolvedValue({ id: "upload-123", blockType: "image" });
    const markdown = "![photo](file:///tmp/real.png) and `![](file:///tmp/example.png)`";

    await expect(processFileUploads({} as any, markdown)).resolves.toBe(
      "![photo](notion-upload:upload-123:image) and `![](file:///tmp/example.png)`",
    );
    expect(mockedUploadFile).toHaveBeenCalledTimes(1);
    expect(mockedUploadFile).toHaveBeenCalledWith({} as any, "file:///tmp/real.png");
  });
});

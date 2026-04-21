import { beforeEach, describe, expect, it, vi } from "vitest";

import { callTool } from "./call-tool.js";
import type { McpStdioClient } from "./mcp-stdio-client.js";
import { archivePageIds } from "./sandbox.js";

vi.mock("./call-tool.js", () => ({
  callTool: vi.fn(),
}));

describe("archivePageIds", () => {
  const client = {} as McpStdioClient;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns archived ids and emits only the summary line when every archive succeeds", async () => {
    vi.mocked(callTool)
      .mockResolvedValueOnce({ archived: "page-2" })
      .mockResolvedValueOnce({ archived: "page-1" });

    await expect(archivePageIds(client, ["page-1", "page-2"])).resolves.toEqual({
      archived: ["page-2", "page-1"],
      tolerated: [],
      unexpected: [],
      summary: {
        archived: 2,
        already_archived: 0,
        archived_ancestor: 0,
        not_found: 0,
        unexpected: 0,
      },
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[e2e][teardown] cleanup summary: archived=2 already_archived=0 archived_ancestor=0 not_found=0 unexpected=0",
    );
  });

  it("classifies tolerated outcomes without per-id logs and reports them in the summary", async () => {
    vi.mocked(callTool)
      .mockResolvedValueOnce({ archived: "success" })
      .mockResolvedValueOnce({
        error:
          "Can't edit block that is archived. You must unarchive the block before editing. Check property names and types with get_database.",
      })
      .mockResolvedValueOnce({
        error:
          "Can't edit page on block with an archived ancestor. Check property names and types with get_database.",
      })
      .mockResolvedValueOnce({
        error:
          'Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.',
      });

    await expect(
      archivePageIds(client, ["not-found", "archived-ancestor", "already-archived", "success"]),
    ).resolves.toEqual({
      archived: ["success"],
      tolerated: [
        {
          class: "already_archived",
          id: "already-archived",
          raw:
            "Can't edit block that is archived. You must unarchive the block before editing. Check property names and types with get_database.",
        },
        {
          class: "archived_ancestor",
          id: "archived-ancestor",
          raw:
            "Can't edit page on block with an archived ancestor. Check property names and types with get_database.",
        },
        {
          class: "not_found",
          id: "not-found",
          raw:
            'Could not find page with ID: deadbeef-dead-beef-dead-beefdeadbeef. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.',
        },
      ],
      unexpected: [],
      summary: {
        archived: 1,
        already_archived: 1,
        archived_ancestor: 1,
        not_found: 1,
        unexpected: 0,
      },
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[e2e][teardown] cleanup summary: archived=1 already_archived=1 archived_ancestor=1 not_found=1 unexpected=0",
    );
  });

  it("logs unexpected tool errors with the UNEXPECTED marker and returns them separately", async () => {
    vi.mocked(callTool)
      .mockResolvedValueOnce({ archived: "ok" })
      .mockResolvedValueOnce({
        error: "Notion rate limit hit. Wait a moment and retry.",
      });

    await expect(archivePageIds(client, ["rate-limited", "ok"])).resolves.toEqual({
      archived: ["ok"],
      tolerated: [],
      unexpected: [
        {
          class: "unexpected",
          id: "rate-limited",
          raw: "Notion rate limit hit. Wait a moment and retry.",
        },
      ],
      summary: {
        archived: 1,
        already_archived: 0,
        archived_ancestor: 0,
        not_found: 0,
        unexpected: 1,
      },
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[e2e][teardown] UNEXPECTED archive_page failure for rate-limited: Notion rate limit hit. Wait a moment and retry.",
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[e2e][teardown] cleanup summary: archived=1 already_archived=0 archived_ancestor=0 not_found=0 unexpected=1",
    );
  });

  it("classifies thrown errors as unexpected and still emits the summary", async () => {
    vi.mocked(callTool).mockRejectedValueOnce(new Error("network down"));

    await expect(archivePageIds(client, ["thrown-id"])).resolves.toEqual({
      archived: [],
      tolerated: [],
      unexpected: [
        {
          class: "unexpected",
          id: "thrown-id",
          raw: "network down",
        },
      ],
      summary: {
        archived: 0,
        already_archived: 0,
        archived_ancestor: 0,
        not_found: 0,
        unexpected: 1,
      },
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[e2e][teardown] UNEXPECTED archive_page failure for thrown-id: network down",
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[e2e][teardown] cleanup summary: archived=0 already_archived=0 archived_ancestor=0 not_found=0 unexpected=1",
    );
  });
});

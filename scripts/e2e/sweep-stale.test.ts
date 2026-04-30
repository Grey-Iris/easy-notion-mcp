import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExistsSync,
  mockInitialize,
  mockClose,
  mockRequest,
  MockMcpStdioClient,
} = vi.hoisted(() => {
  const mockExistsSync = vi.fn(() => true);
  const mockInitialize = vi.fn(async () => {});
  const mockClose = vi.fn(async () => {});
  const mockRequest = vi.fn();

  const MockMcpStdioClient = vi.fn(function MockMcpStdioClient() {
    return {
      initialize: mockInitialize,
      close: mockClose,
      request: mockRequest,
    };
  });

  return {
    mockExistsSync,
    mockInitialize,
    mockClose,
    mockRequest,
    MockMcpStdioClient,
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

vi.mock("../../tests/e2e/helpers/mcp-stdio-client.js", () => ({
  McpStdioClient: MockMcpStdioClient,
}));

import { runSweep } from "./sweep-stale.js";

type ToolResultMap = Record<string, unknown[]>;

function jsonRpcToolResult(value: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    result: {
      content: [{ text: JSON.stringify(value) }],
    },
  };
}

function setToolResults(results: ToolResultMap) {
  const queues = new Map(
    Object.entries(results).map(([tool, values]) => [tool, [...values]]),
  );

  mockRequest.mockImplementation(async (method: string, params: unknown) => {
    if (method !== "tools/call") {
      throw new Error(`Unexpected method ${method}`);
    }

    const name = (params as { name: string }).name;
    const queue = queues.get(name);
    if (!queue || queue.length === 0) {
      throw new Error(`No mocked response left for ${name}`);
    }

    return jsonRpcToolResult(queue.shift());
  });
}

describe("runSweep", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns exit 0 when there is nothing to sweep in dry-run and apply mode", async () => {
    setToolResults({
      list_pages: [[], []],
      search: [[], [], [], []],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    await expect(
      runSweep(["--apply"], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    expect(mockInitialize).toHaveBeenCalledTimes(2);
    expect(mockClose).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith("[sweep] nothing to sweep");
    expect(logSpy).toHaveBeenCalledWith(
      "[sweep] summary: archived=0 already_archived=0 archived_ancestor=0 not_found=0 unexpected=0 skipped_unverified=0",
    );
  });

  it("prints a dry-run plan for direct E2E children and does not archive", async () => {
    setToolResults({
      list_pages: [
        [
          { id: "sandbox-1", title: "E2E: one" },
          { id: "ignore-me", title: "scratch" },
          { id: "sandbox-2", title: "E2E: two" },
          { id: "sandbox-3", title: "E2E: three" },
        ],
        [],
        [],
        [],
      ],
      search: [[], []],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    expect(mockRequest).toHaveBeenCalledTimes(6);
    expect(logSpy).toHaveBeenCalledWith("[sweep] archive plan (3 pages):");
    expect(logSpy).toHaveBeenCalledWith("- sandbox-1 E2E: one");
    expect(logSpy).toHaveBeenCalledWith("- sandbox-2 E2E: two");
    expect(logSpy).toHaveBeenCalledWith("- sandbox-3 E2E: three");
  });

  it("archives descendants before parents on apply", async () => {
    setToolResults({
      list_pages: [
        [
          { id: "sandbox-1", title: "E2E: one" },
          { id: "sandbox-2", title: "E2E: two" },
          { id: "sandbox-3", title: "E2E: three" },
        ],
        [{ id: "child-1", title: "child 1" }],
        [],
        [{ id: "child-2", title: "child 2" }],
        [],
        [],
      ],
      search: [[], []],
      archive_page: [
        { archived: "child-1" },
        { archived: "sandbox-1" },
        { archived: "child-2" },
        { archived: "sandbox-2" },
        { archived: "sandbox-3" },
      ],
    });

    await expect(
      runSweep(["--apply"], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    const archiveCalls = mockRequest.mock.calls
      .filter(([method, params]) => method === "tools/call" && (params as { name: string }).name === "archive_page")
      .map(([, params]) => (params as { arguments: { page_id: string } }).arguments.page_id);

    expect(archiveCalls).toEqual([
      "child-1",
      "sandbox-1",
      "child-2",
      "sandbox-2",
      "sandbox-3",
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      "[sweep] summary: archived=5 already_archived=0 archived_ancestor=0 not_found=0 unexpected=0 skipped_unverified=0",
    );
  });

  it("tolerates archived_ancestor outcomes and still exits 0", async () => {
    setToolResults({
      list_pages: [[{ id: "sandbox-1", title: "E2E: one" }], []],
      search: [[], []],
      archive_page: [
        {
          error:
            "Can't edit page on block with an archived ancestor. You must unarchive the ancestor before editing page. Check property names and types with get_database.",
        },
      ],
    });

    await expect(
      runSweep(["--apply"], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[sweep] UNEXPECTED"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "[sweep] summary: archived=0 already_archived=0 archived_ancestor=1 not_found=0 unexpected=0 skipped_unverified=0",
    );
  });

  it("returns exit 4 when an unexpected archive error occurs", async () => {
    setToolResults({
      list_pages: [[{ id: "sandbox-1", title: "E2E: one" }], []],
      search: [[], []],
      archive_page: [{ error: "Notion rate limit hit. Wait a moment and retry." }],
    });

    await expect(
      runSweep(["--apply"], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(4);

    expect(errorSpy).toHaveBeenCalledWith(
      "[sweep] UNEXPECTED sandbox-1: Notion rate limit hit. Wait a moment and retry.",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "[sweep] summary: archived=0 already_archived=0 archived_ancestor=0 not_found=0 unexpected=1 skipped_unverified=0",
    );
  });

  it("includes BENCH-prefixed pages in the sweep plan", async () => {
    setToolResults({
      list_pages: [
        [
          { id: "bench-1", title: "BENCH: one" },
          { id: "e2e-1", title: "E2E: one" },
          { id: "ignore-me", title: "scratch" },
        ],
        [],
        [],
      ],
      search: [[], []],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    expect(logSpy).toHaveBeenCalledWith("[sweep] archive plan (2 pages):");
    expect(logSpy).toHaveBeenCalledWith("- bench-1 BENCH: one");
    expect(logSpy).toHaveBeenCalledWith("- e2e-1 E2E: one");
  });

  it("returns exit 3 when the root is unshared", async () => {
    setToolResults({
      list_pages: [
        {
          error:
            "This page hasn't been shared with the integration. In Notion, open the page → ··· menu → Connections → add your integration.",
        },
      ],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(3);

    expect(errorSpy).toHaveBeenCalledWith(
      "[sweep] root unreachable or unshared: This page hasn't been shared with the integration. In Notion, open the page → ··· menu → Connections → add your integration.",
    );
  });

  it("returns exit 3 when the root probe reports object_not_found", async () => {
    setToolResults({
      list_pages: [
        {
          error:
            'Could not find page with ID: root-page. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.',
        },
      ],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(3);

    expect(errorSpy).toHaveBeenCalledWith(
      '[sweep] root unreachable or unshared: Could not find page with ID: root-page. Make sure the relevant pages and databases are shared with your integration "Iris". Make sure the page/database is shared with your Notion integration.',
    );
  });

  it("logs unverified search hits as SKIP and does not archive them", async () => {
    setToolResults({
      list_pages: [[{ id: "sandbox-1", title: "E2E: one" }], []],
      search: [[
        { id: "sandbox-1", title: "E2E: one" },
        { id: "foreign-1", title: "E2E: elsewhere" },
      ], []],
    });

    await expect(
      runSweep([], {
        E2E_ROOT_PAGE_ID: "root-page",
        NOTION_TOKEN: "token",
      }),
    ).resolves.toBe(0);

    expect(logSpy).toHaveBeenCalledWith("[sweep] SKIP (unverified ancestry): foreign-1 E2E: elsewhere");
    const archiveCalls = mockRequest.mock.calls.filter(
      ([method, params]) => method === "tools/call" && (params as { name: string }).name === "archive_page",
    );
    expect(archiveCalls).toHaveLength(0);
  });
});

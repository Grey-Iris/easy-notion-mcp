import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, type CreateServerConfig } from "../src/server.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "get-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function callGetConfig(config: CreateServerConfig = {}) {
  const server = createServer(() => ({}) as any, config);
  const client = new McpClient({ name: "get-config-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = (await client.callTool({ name: "get_config", arguments: {} })) as any;
    const raw = result.content[0].text as string;
    return { parsed: JSON.parse(raw) as Record<string, unknown>, raw };
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
}

const EXPECTED_FIELDS = [
  "version",
  "transport",
  "workspace_root_configured",
  "workspace_root_resolved",
  "workspace_root_status",
  "workspace_root_source",
  "markdown_docs",
  "visible_tools_count",
];

describe("get_config", () => {
  it("is listed on both transports", async () => {
    for (const transport of ["stdio", "http"] as const) {
      const server = createServer(() => ({}) as any, { transport });
      const client = new McpClient({ name: "list", version: "1.0.0" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name)).toContain("get_config");
      } finally {
        await Promise.all([clientTransport.close(), serverTransport.close()]);
      }
    }
  });

  it("always returns every documented field, so the shape is stable", async () => {
    const { parsed } = await callGetConfig({ transport: "stdio" });

    expect(Object.keys(parsed).sort()).toEqual([...EXPECTED_FIELDS].sort());
    for (const field of EXPECTED_FIELDS) {
      expect(parsed, `${field} must be present even when null`).toHaveProperty(field);
    }
  });

  describe("stdio", () => {
    it("reports an env-sourced root as configured, resolved, and ok", async () => {
      const root = await makeTempDir();
      const { parsed } = await callGetConfig({
        transport: "stdio",
        workspaceRoot: root,
        workspaceRootSource: "env",
      });

      expect(parsed.transport).toBe("stdio");
      expect(parsed.workspace_root_configured).toBe(root);
      expect(parsed.workspace_root_resolved).toBe(await realpath(root));
      expect(parsed.workspace_root_status).toBe("ok");
      expect(parsed.workspace_root_source).toBe("env");
      expect(parsed.markdown_docs).toBe("easy-notion://docs/markdown");
      expect(typeof parsed.version).toBe("string");
    });

    it("reports the cwd default as cwd_default, not env", async () => {
      const root = await makeTempDir();
      const { parsed } = await callGetConfig({
        transport: "stdio",
        workspaceRoot: root,
        workspaceRootSource: "cwd_default",
      });

      expect(parsed.workspace_root_source).toBe("cwd_default");
      expect(parsed.workspace_root_status).toBe("ok");
    });

    it("reports a programmatic caller that gives no source as config", async () => {
      const root = await makeTempDir();
      const { parsed } = await callGetConfig({ transport: "stdio", workspaceRoot: root });

      expect(parsed.workspace_root_source).toBe("config");
      expect(parsed.workspace_root_status).toBe("ok");
    });

    it("reports an unset root as unset with null paths", async () => {
      const { parsed } = await callGetConfig({ transport: "stdio" });

      expect(parsed.workspace_root_configured).toBeNull();
      expect(parsed.workspace_root_resolved).toBeNull();
      expect(parsed.workspace_root_status).toBe("unset");
      expect(parsed.workspace_root_source).toBe("unset");
    });

    it("forces source to unset when a caller supplies a source but no root", async () => {
      // A source without a root is contradictory input. The answer must not
      // repeat it back: with no root there is no provenance to report.
      const { parsed } = await callGetConfig({
        transport: "stdio",
        workspaceRootSource: "env",
      });

      expect(parsed.workspace_root_status).toBe("unset");
      expect(parsed.workspace_root_source).toBe("unset");
      expect(parsed.workspace_root_configured).toBeNull();
      expect(parsed.workspace_root_resolved).toBeNull();
    });

    it("answers with status invalid instead of throwing when the root does not resolve", async () => {
      const missing = join(await makeTempDir(), "does-not-exist");

      const { parsed } = await callGetConfig({
        transport: "stdio",
        workspaceRoot: missing,
        workspaceRootSource: "env",
      });

      // A broken root is exactly the case an agent needs reported.
      expect(parsed.workspace_root_configured).toBe(missing);
      expect(parsed.workspace_root_resolved).toBeNull();
      expect(parsed.workspace_root_status).toBe("invalid");
      expect(parsed.workspace_root_source).toBe("env");
    });

    it("counts the tools visible on stdio", async () => {
      const server = createServer(() => ({}) as any, { transport: "stdio" });
      const client = new McpClient({ name: "count", version: "1.0.0" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        const listed = (await client.listTools()).tools.length;
        const result = (await client.callTool({ name: "get_config", arguments: {} })) as any;
        const parsed = JSON.parse(result.content[0].text);

        // Must track tools/list itself, not a hardcoded number.
        expect(parsed.visible_tools_count).toBe(listed);
      } finally {
        await Promise.all([clientTransport.close(), serverTransport.close()]);
      }
    });
  });

  describe("http", () => {
    it("exposes no host path and marks the root not applicable", async () => {
      const root = await makeTempDir();

      // Even if a caller wrongly passes a root in http mode, no path escapes.
      const { parsed, raw } = await callGetConfig({
        transport: "http",
        workspaceRoot: root,
        workspaceRootSource: "env",
      });

      expect(parsed.transport).toBe("http");
      expect(parsed.workspace_root_configured).toBeNull();
      expect(parsed.workspace_root_resolved).toBeNull();
      expect(parsed.workspace_root_status).toBe("not_applicable");
      expect(parsed.workspace_root_source).toBe("not_applicable");
      expect(raw).not.toContain(root);
    });

    it("counts the tools visible on http, which is one fewer than stdio", async () => {
      const httpServer = createServer(() => ({}) as any, { transport: "http" });
      const client = new McpClient({ name: "count-http", version: "1.0.0" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([httpServer.connect(serverTransport), client.connect(clientTransport)]);
      try {
        const listed = (await client.listTools()).tools.length;
        const result = (await client.callTool({ name: "get_config", arguments: {} })) as any;
        const parsed = JSON.parse(result.content[0].text);

        expect(parsed.visible_tools_count).toBe(listed);

        const stdio = await callGetConfig({ transport: "stdio" });
        expect(parsed.visible_tools_count).toBe(
          (stdio.parsed.visible_tools_count as number) - 1,
        );
      } finally {
        await Promise.all([clientTransport.close(), serverTransport.close()]);
      }
    });
  });

  describe("secrets", () => {
    const ORIGINAL_TOKEN = process.env.NOTION_TOKEN;

    afterEach(() => {
      if (ORIGINAL_TOKEN === undefined) {
        delete process.env.NOTION_TOKEN;
      } else {
        process.env.NOTION_TOKEN = ORIGINAL_TOKEN;
      }
    });

    it("leaks neither the token value nor a token prefix", async () => {
      const secret = "ntn_supersecrettokenvalue123456";
      process.env.NOTION_TOKEN = secret;

      for (const transport of ["stdio", "http"] as const) {
        const { raw } = await callGetConfig({
          transport,
          workspaceRoot: await makeTempDir(),
          workspaceRootSource: "env",
        });

        expect(raw).not.toContain(secret);
        expect(raw).not.toContain("ntn_");
      }
    });
  });

  it("makes no Notion API call", async () => {
    // The factory throws: any attempt to reach Notion would surface here.
    const server = createServer(
      () => {
        throw new Error("get_config must not construct a Notion client");
      },
      { transport: "stdio" },
    );
    const client = new McpClient({ name: "no-api", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = (await client.callTool({ name: "get_config", arguments: {} })) as any;
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.workspace_root_status).toBe("unset");
      expect(parsed.error).toBeUndefined();
    } finally {
      await Promise.all([clientTransport.close(), serverTransport.close()]);
    }
  });
});

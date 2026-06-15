import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TokenStore } from "../src/auth/token-store.js";
import type { TokenRecord } from "../src/auth/token-store.js";

describe("TokenStore", () => {
  let tmpDir: string;
  let store: TokenStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "token-store-test-"));
    store = new TokenStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeRecord(overrides: Partial<TokenRecord> = {}): TokenRecord {
    return {
      mcpToken: "mcp-token-abc",
      kind: "access",
      notionToken: "ntn_secret_xyz",
      refreshToken: "refresh-123",
      workspaceId: "ws-456",
      clientId: "client-789",
      scopes: ["read", "write"],
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
      ...overrides,
    };
  }

  it("stores and retrieves a token by mcpToken", async () => {
    const record = makeRecord();
    await store.storeToken(record);

    const retrieved = await store.getByMcpToken("mcp-token-abc");
    expect(retrieved).toBeDefined();
    expect(retrieved!.mcpToken).toBe("mcp-token-abc");
    expect(retrieved!.notionToken).toBe("ntn_secret_xyz");
    expect(retrieved!.refreshToken).toBe("refresh-123");
    expect(retrieved!.workspaceId).toBe("ws-456");
    expect(retrieved!.clientId).toBe("client-789");
    expect(retrieved!.scopes).toEqual(["read", "write"]);
  });

  it("stores and retrieves a token by notionToken", async () => {
    const record = makeRecord();
    await store.storeToken(record);

    const retrieved = await store.getByNotionToken("ntn_secret_xyz");
    expect(retrieved).toBeDefined();
    expect(retrieved!.mcpToken).toBe("mcp-token-abc");
  });

  it("returns undefined for non-existent token", async () => {
    const result = await store.getByMcpToken("does-not-exist");
    expect(result).toBeUndefined();
  });

  it("deletes a token", async () => {
    const record = makeRecord();
    await store.storeToken(record);

    // Confirm it exists
    expect(await store.getByMcpToken("mcp-token-abc")).toBeDefined();

    // Delete it
    await store.deleteToken("mcp-token-abc");

    // Confirm it's gone
    expect(await store.getByMcpToken("mcp-token-abc")).toBeUndefined();
  });

  it("updates an existing record with same mcpToken", async () => {
    const record = makeRecord();
    await store.storeToken(record);

    // Update with new notion token
    const updated = makeRecord({ notionToken: "ntn_updated_token" });
    await store.storeToken(updated);

    const retrieved = await store.getByMcpToken("mcp-token-abc");
    expect(retrieved!.notionToken).toBe("ntn_updated_token");
  });

  it("handles multiple tokens", async () => {
    await store.storeToken(makeRecord({ mcpToken: "token-1", notionToken: "notion-1" }));
    await store.storeToken(makeRecord({ mcpToken: "token-2", notionToken: "notion-2" }));
    await store.storeToken(makeRecord({ mcpToken: "token-3", notionToken: "notion-3" }));

    expect(await store.getByMcpToken("token-1")).toBeDefined();
    expect(await store.getByMcpToken("token-2")).toBeDefined();
    expect(await store.getByMcpToken("token-3")).toBeDefined();

    await store.deleteToken("token-2");
    expect(await store.getByMcpToken("token-1")).toBeDefined();
    expect(await store.getByMcpToken("token-2")).toBeUndefined();
    expect(await store.getByMcpToken("token-3")).toBeDefined();
  });

  it("deletes by refresh token", async () => {
    await store.storeToken(makeRecord({ mcpToken: "t1", refreshToken: "r1" }));
    await store.storeToken(makeRecord({ mcpToken: "t2", refreshToken: "r2" }));

    await store.deleteByRefreshToken("r1");

    expect(await store.getByMcpToken("t1")).toBeUndefined();
    expect(await store.getByMcpToken("t2")).toBeDefined();
  });

  it("persists across TokenStore instances (encryption round-trip)", async () => {
    // Store with instance 1
    await store.storeToken(makeRecord());

    // Create a new instance pointing at the same directory
    const store2 = new TokenStore(tmpDir);
    await store2.init();

    // Should read the same data (decrypting with the same key file)
    const retrieved = await store2.getByMcpToken("mcp-token-abc");
    expect(retrieved).toBeDefined();
    expect(retrieved!.notionToken).toBe("ntn_secret_xyz");
  });

  it("handles empty store gracefully", async () => {
    const result = await store.getByMcpToken("anything");
    expect(result).toBeUndefined();
  });
});

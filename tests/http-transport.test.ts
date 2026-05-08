import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp, getBindHost } from "../src/http.js";
import type express from "express";
import type { AddressInfo } from "net";

/**
 * Integration tests for the HTTP transport layer.
 *
 * These tests do NOT make real Notion API calls. They verify that:
 * - The MCP protocol works over HTTP (static token mode)
 * - OAuth endpoints respond correctly
 * - Session management works
 * - Static-token mode requires NOTION_MCP_BEARER (bearer-always, G-1b)
 * - Bind host defaults to 127.0.0.1, configurable via NOTION_MCP_BIND_HOST (G-1b)
 */

const BEARER = "test-bearer-secret";
const AUTH_HEADER = `Bearer ${BEARER}`;

describe("HTTP Transport — Health Check", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp({
      notionToken: "ntn_fake_token_for_testing",
      bearer: BEARER,
    });
  });

  it("GET / returns server status and transport info", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      server: "easy-notion-mcp",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
  });
});

describe("HTTP Transport — Static Token Mode", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp({
      notionToken: "ntn_fake_token_for_testing",
      bearer: BEARER,
    });
  });

  it("accepts MCP initialize and returns server info", async () => {
    const initRequest = {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
      id: 1,
    };

    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", AUTH_HEADER)
      .send(initRequest);

    expect(res.status).toBe(200);

    let body: any;
    if (res.headers["content-type"]?.includes("text/event-stream")) {
      const lines = res.text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          body = JSON.parse(line.slice(6));
          break;
        }
      }
    } else {
      body = res.body;
    }

    expect(body).toBeDefined();
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo.name).toBe("easy-notion-mcp");
    expect(body.result.protocolVersion).toBe("2025-03-26");

    const sessionId = res.headers["mcp-session-id"];
    expect(sessionId).toBeDefined();

    const initializedNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };

    await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", AUTH_HEADER)
      .set("mcp-session-id", sessionId)
      .send(initializedNotification);

    const listToolsRequest = {
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: 2,
    };

    const toolsRes = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", AUTH_HEADER)
      .set("mcp-session-id", sessionId)
      .send(listToolsRequest);

    expect(toolsRes.status).toBe(200);

    let toolsBody: any;
    if (toolsRes.headers["content-type"]?.includes("text/event-stream")) {
      const lines = toolsRes.text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          toolsBody = JSON.parse(line.slice(6));
          break;
        }
      }
    } else {
      toolsBody = toolsRes.body;
    }

    expect(toolsBody).toBeDefined();
    expect(toolsBody.result).toBeDefined();
    expect(toolsBody.result.tools).toBeDefined();
    expect(Array.isArray(toolsBody.result.tools)).toBe(true);
    expect(toolsBody.result.tools.length).toBe(40);

    const toolNames = toolsBody.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("create_page");
    expect(toolNames).toContain("read_page");
    expect(toolNames).toContain("search");
    expect(toolNames).toContain("update_data_source");
    expect(toolNames).not.toContain("create_page_from_file");
  });

  it("returns 400 for authed GET /mcp without a session", async () => {
    const res = await request(app).get("/mcp").set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No active session");
  });

  it("returns 400 for authed DELETE /mcp without a session", async () => {
    const res = await request(app).delete("/mcp").set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No active session");
  });

  it("rejects POST /mcp when no static Notion token is configured", async () => {
    const noTokenApp = await createApp({ bearer: BEARER });

    const res = await request(noTokenApp)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", AUTH_HEADER)
      .send({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test" },
        },
        id: 1,
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("No Notion token available");
  });
});

describe("HTTP Transport — Static Token Mode bearer enforcement (AU-1..AU-6)", () => {
  it("AU-1: createApp in static-token mode without bearer throws at construction", async () => {
    await expect(
      createApp({ notionToken: "ntn_fake_token_for_testing" }),
    ).rejects.toThrow(/NOTION_MCP_BEARER/);
  });

  it("AU-1 (error shape): bearer-missing error includes example + README pointer", async () => {
    try {
      await createApp({ notionToken: "ntn_fake_token_for_testing" });
      throw new Error("expected createApp to reject");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/NOTION_MCP_BEARER/);
      expect(message).toMatch(/openssl rand/);
      expect(message).toMatch(/README|docs/i);
    }
  });

  describe("with bearer configured", () => {
    let app: express.Express;

    beforeAll(async () => {
      app = await createApp({
        notionToken: "ntn_fake_token_for_testing",
        bearer: BEARER,
      });
    });

    const initBody = {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
      id: 1,
    };

    it("AU-2: POST /mcp with no Authorization header returns 401", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .send(initBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("invalid_token");
    });

    it("AU-3: POST /mcp with wrong bearer returns 401", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer WRONG-TOKEN")
        .send(initBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("invalid_token");
    });

    it("AU-4: POST /mcp with correct bearer returns 200", async () => {
      const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", AUTH_HEADER)
        .send(initBody);

      expect(res.status).toBe(200);
    });

    it("AU-5: GET /mcp without Authorization returns 401 (auth checked before session lookup)", async () => {
      const res = await request(app).get("/mcp");
      expect(res.status).toBe(401);
    });

    it("AU-6: DELETE /mcp without Authorization returns 401 (auth checked before session lookup)", async () => {
      const res = await request(app).delete("/mcp");
      expect(res.status).toBe(401);
    });
  });
});

describe("HTTP Transport — OAuth Mode Endpoints", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp({
      oauthClientId: "fake-client-id",
      oauthClientSecret: "fake-client-secret",
      oauthRedirectUri: "http://localhost:3333/callback",
    });
  });

  it("AU-7: OAuth-mode createApp constructs without NOTION_MCP_BEARER", async () => {
    await expect(
      createApp({
        oauthClientId: "fake-client-id",
        oauthClientSecret: "fake-client-secret",
        oauthRedirectUri: "http://localhost:3333/callback",
      }),
    ).resolves.toBeDefined();
  });

  it("GET /.well-known/oauth-authorization-server returns metadata", async () => {
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBeDefined();
    expect(res.body.authorization_endpoint).toBeDefined();
    expect(res.body.token_endpoint).toBeDefined();
    expect(res.body.registration_endpoint).toBeDefined();
  });

  it("GET /.well-known/oauth-protected-resource returns resource metadata", async () => {
    const res = await request(app).get("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.body.resource).toBeDefined();
  });

  it("AU-8: POST /mcp without auth returns 401 (OAuth-mode regression guard)", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test" },
        },
        id: 1,
      });

    expect(res.status).toBe(401);
  });

  it("POST /register returns a client_id", async () => {
    const res = await request(app)
      .post("/register")
      .set("Content-Type", "application/json")
      .send({
        client_name: "test-client",
        redirect_uris: ["http://localhost:9999/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });

    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeDefined();
    expect(typeof res.body.client_id).toBe("string");
  });

  it("GET /authorize with required params redirects to Notion", async () => {
    const regRes = await request(app)
      .post("/register")
      .set("Content-Type", "application/json")
      .send({
        client_name: "test-client",
        redirect_uris: ["http://localhost:9999/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });

    const clientId = regRes.body.client_id;

    const res = await request(app)
      .get("/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "http://localhost:9999/callback",
        code_challenge: "test-challenge-value",
        code_challenge_method: "S256",
        state: "test-state-123",
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("api.notion.com/v1/oauth/authorize");
    expect(res.headers.location).toContain("client_id=fake-client-id");
  });
});

describe("HTTP Transport — bind host (BH-1)", () => {
  async function startOnHost(host: string) {
    const app = await createApp({
      notionToken: "ntn_fake_token_for_testing",
      bearer: BEARER,
    });
    return await new Promise<{ address: string; close: () => Promise<void> }>((resolve, reject) => {
      const server = app.listen(0, host, () => {
        const info = server.address();
        if (info && typeof info !== "string") {
          resolve({
            address: (info as AddressInfo).address,
            close: () =>
              new Promise<void>((r) => {
                server.close(() => r());
              }),
          });
        } else {
          server.close();
          reject(new Error("listen returned unexpected address shape"));
        }
      });
      server.on("error", reject);
    });
  }

  it("BH-1a: default env (no NOTION_MCP_BIND_HOST) resolves to 127.0.0.1 and listen() binds it", async () => {
    expect(getBindHost({})).toBe("127.0.0.1");
    const { address, close } = await startOnHost(getBindHost({}));
    try {
      expect(address).toBe("127.0.0.1");
    } finally {
      await close();
    }
  });

  it("BH-1b: NOTION_MCP_BIND_HOST=0.0.0.0 binds all interfaces", async () => {
    const env = { NOTION_MCP_BIND_HOST: "0.0.0.0" };
    expect(getBindHost(env)).toBe("0.0.0.0");
    const { address, close } = await startOnHost(getBindHost(env));
    try {
      expect(address).toBe("0.0.0.0");
    } finally {
      await close();
    }
  });

  it("BH-1c: NOTION_MCP_BIND_HOST=127.0.0.1 explicitly binds loopback", async () => {
    const env = { NOTION_MCP_BIND_HOST: "127.0.0.1" };
    expect(getBindHost(env)).toBe("127.0.0.1");
    const { address, close } = await startOnHost(getBindHost(env));
    try {
      expect(address).toBe("127.0.0.1");
    } finally {
      await close();
    }
  });
});

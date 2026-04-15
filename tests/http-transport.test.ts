import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/http.js";
import type express from "express";

/**
 * Integration tests for the HTTP transport layer.
 *
 * These tests do NOT make real Notion API calls. They verify that:
 * - The MCP protocol works over HTTP (static token mode)
 * - OAuth endpoints respond correctly
 * - Session management works
 */

describe("HTTP Transport — Health Check", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp({
      notionToken: "ntn_fake_token_for_testing",
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
      .send(initRequest);

    expect(res.status).toBe(200);

    // Response may be JSON or SSE — parse accordingly
    let body: any;
    if (res.headers["content-type"]?.includes("text/event-stream")) {
      // Parse SSE: find lines starting with "data: "
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

    // Extract session ID for follow-up requests
    const sessionId = res.headers["mcp-session-id"];
    expect(sessionId).toBeDefined();

    // Now send initialized notification + tools/list in same session
    const initializedNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };

    await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("mcp-session-id", sessionId)
      .send(initializedNotification);

    // List tools
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
    // We should have 27 tools
    expect(toolsBody.result.tools.length).toBe(27);

    // Verify a few expected tool names
    const toolNames = toolsBody.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("create_page");
    expect(toolNames).toContain("read_page");
    expect(toolNames).toContain("search");
    expect(toolNames).toContain("update_data_source");
  });

  it("returns 400 for GET /mcp without a session", async () => {
    const res = await request(app).get("/mcp");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No active session");
  });

  it("returns 400 for DELETE /mcp without a session", async () => {
    const res = await request(app).delete("/mcp");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No active session");
  });

  it("rejects POST /mcp without notionToken when no static token configured", async () => {
    const noTokenApp = await createApp({});

    const res = await request(noTokenApp)
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
    expect(res.body.error).toBe("No Notion token available");
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

  it("POST /mcp without auth returns 401", async () => {
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
    // First register a client
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

    // Should redirect (302) to Notion OAuth
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("api.notion.com/v1/oauth/authorize");
    expect(res.headers.location).toContain("client_id=fake-client-id");
  });
});

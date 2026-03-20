#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createNotionClient } from "./notion-client.js";
import { createServer } from "./server.js";
import { randomUUID } from "crypto";

const PORT = parseInt(process.env.PORT ?? "3333", 10);
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_OAUTH_CLIENT_ID = process.env.NOTION_OAUTH_CLIENT_ID;
const NOTION_OAUTH_CLIENT_SECRET = process.env.NOTION_OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/callback`;

const oauthEnabled = !!(NOTION_OAUTH_CLIENT_ID && NOTION_OAUTH_CLIENT_SECRET);

export interface CreateAppOptions {
  notionToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUri?: string;
  rootPageId?: string;
  trustContent?: boolean;
}

/**
 * Create the Express app with MCP endpoints.
 * Exported so integration tests can use it without starting a real server.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const useOAuth = !!(options.oauthClientId && options.oauthClientSecret);

  /**
   * Create a session handler for the POST /mcp endpoint.
   * The `getNotionToken` function extracts the Notion token from the request.
   */
  function createSessionHandler(
    getNotionToken: (req: express.Request) => string | undefined,
    allowWorkspaceParent: boolean = false,
  ) {
    return async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
            console.error(`Session started: ${id}`);
          },
          onsessionclosed: (id) => {
            transports.delete(id);
            console.error(`Session closed: ${id}`);
          },
        });

        transport.onclose = () => {
          const id = transport!.sessionId;
          if (id) {
            transports.delete(id);
            console.error(`Transport closed, session removed: ${id}`);
          }
        };

        const notionToken = getNotionToken(req);
        if (!notionToken) {
          res.status(401).json({ error: "No Notion token available" });
          return;
        }

        const notion = createNotionClient(notionToken);
        const server = createServer(() => notion, {
          rootPageId: options.rootPageId,
          trustContent: options.trustContent ?? false,
          allowWorkspaceParent,
        });

        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    };
  }

  function createGetHandler() {
    return async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.status(400).json({ error: "No active session" });
        return;
      }
      await transport.handleRequest(req, res);
    };
  }

  function createDeleteHandler() {
    return async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.status(400).json({ error: "No active session" });
        return;
      }
      await transport.handleRequest(req, res);
      transports.delete(sessionId!);
      console.error(`Session closed: ${sessionId}`);
    };
  }

  if (useOAuth) {
    // Dynamic imports to avoid loading auth modules when not needed
    const { mcpAuthRouter } = await import(
      "@modelcontextprotocol/sdk/server/auth/router.js"
    );
    const { requireBearerAuth } = await import(
      "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js"
    );
    const { NotionOAuthProvider } = await import("./auth/oauth-provider.js");
    const { TokenStore } = await import("./auth/token-store.js");

    const tokenStore = new TokenStore();
    await tokenStore.init();

    const oauthProvider = new NotionOAuthProvider(tokenStore, {
      clientId: options.oauthClientId!,
      clientSecret: options.oauthClientSecret!,
      redirectUri: options.oauthRedirectUri ?? `http://localhost:3333/callback`,
    });

    // Clean up expired sessions every 5 minutes
    const cleanupInterval = setInterval(() => oauthProvider.cleanup(), 5 * 60 * 1000);
    // Allow the process to exit without waiting for the interval
    cleanupInterval.unref();

    const port = parseInt(process.env.PORT ?? "3333", 10);
    const issuerUrl = new URL(`http://localhost:${port}`);

    // Mount OAuth AS endpoints (/.well-known/*, /authorize, /token, /register)
    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl,
        serviceDocumentationUrl: new URL(
          "https://github.com/jwigg/easy-notion-mcp",
        ),
      }),
    );

    // Notion OAuth callback (NOT part of mcpAuthRouter)
    app.get("/callback", async (req, res) => {
      await oauthProvider.handleNotionCallback(req, res);
    });

    // Bearer auth middleware for MCP endpoints
    const authMiddleware = requireBearerAuth({
      verifier: oauthProvider,
    });

    const getNotionTokenFromAuth = (req: express.Request): string | undefined => {
      const authInfo = (req as any).auth as { extra?: Record<string, unknown> };
      return authInfo?.extra?.notionToken as string | undefined;
    };

    app.post("/mcp", authMiddleware, createSessionHandler(getNotionTokenFromAuth, true));
    app.get("/mcp", authMiddleware, createGetHandler());
    app.delete("/mcp", authMiddleware, createDeleteHandler());

    console.error("OAuth mode enabled");
  } else {
    // Static token mode
    const staticToken = options.notionToken;
    const getStaticToken = () => staticToken;

    app.post("/mcp", createSessionHandler(getStaticToken, false));
    app.get("/mcp", createGetHandler());
    app.delete("/mcp", createDeleteHandler());

    console.error("Static token mode (NOTION_TOKEN)");
  }

  return app;
}

async function startServer() {
  if (!oauthEnabled && !NOTION_TOKEN) {
    console.error(
      "Either NOTION_TOKEN or (NOTION_OAUTH_CLIENT_ID + NOTION_OAUTH_CLIENT_SECRET) is required",
    );
    process.exit(1);
  }

  const app = await createApp({
    notionToken: NOTION_TOKEN,
    oauthClientId: NOTION_OAUTH_CLIENT_ID,
    oauthClientSecret: NOTION_OAUTH_CLIENT_SECRET,
    oauthRedirectUri: OAUTH_REDIRECT_URI,
    rootPageId: process.env.NOTION_ROOT_PAGE_ID,
    trustContent: process.env.NOTION_TRUST_CONTENT === "true",
  });

  app.listen(PORT, () => {
    console.error(`easy-notion-mcp HTTP server listening on port ${PORT}`);
  });
}

// Only auto-start when run directly (not when imported by tests)
const isMainModule =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === `file://${process.argv[1].replace(/\.ts$/, ".js")}`);

if (isMainModule) {
  startServer().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}

#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createNotionClient } from "./notion-client.js";
import { createServer } from "./server.js";
import { randomUUID, timingSafeEqual } from "crypto";

const PORT = parseInt(process.env.PORT ?? "3333", 10);
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_OAUTH_CLIENT_ID = process.env.NOTION_OAUTH_CLIENT_ID;
const NOTION_OAUTH_CLIENT_SECRET = process.env.NOTION_OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/callback`;

const oauthEnabled = !!(NOTION_OAUTH_CLIENT_ID && NOTION_OAUTH_CLIENT_SECRET);

const BEARER_MISSING_ERROR =
  "NOTION_MCP_BEARER is required to start easy-notion-mcp in static-token HTTP mode (since v0.3.0). " +
  "Generate a secret and set it in the server's environment, for example:\n" +
  "  export NOTION_MCP_BEARER=$(openssl rand -hex 32)\n" +
  "Then configure your MCP client to send `Authorization: Bearer <token>` on every /mcp request. " +
  "See the \"HTTP mode security posture\" section in README.md for the full setup.";

export interface CreateAppOptions {
  notionToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUri?: string;
  rootPageId?: string;
  trustContent?: boolean;
  /**
   * Shared-secret bearer required on every /mcp request in static-token HTTP mode.
   * Required when neither oauthClientId nor oauthClientSecret is set.
   * Not used in OAuth mode (OAuth issues its own bearers).
   */
  bearer?: string;
}

/**
 * Resolve the bind host for the HTTP server.
 * Default is `127.0.0.1` (loopback only); set `NOTION_MCP_BIND_HOST` to change it
 * (e.g. `0.0.0.0` for all interfaces, or a specific interface IP).
 */
export function getBindHost(env: NodeJS.ProcessEnv): string {
  return env.NOTION_MCP_BIND_HOST ?? "127.0.0.1";
}

function bearerAuthMiddleware(expectedBearer: string): express.RequestHandler {
  const expectedBuf = Buffer.from(expectedBearer, "utf8");
  const challenge = `Bearer realm="easy-notion-mcp"`;
  const reject = (
    res: express.Response,
    description: string,
  ) => {
    res.set(
      "WWW-Authenticate",
      `${challenge}, error="invalid_token", error_description="${description}"`,
    );
    res.status(401).json({ error: "invalid_token", error_description: description });
  };

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reject(res, "Missing Authorization header");
      return;
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
      reject(res, "Invalid Authorization header format, expected 'Bearer <token>'");
      return;
    }
    const providedBuf = Buffer.from(parts[1], "utf8");
    if (providedBuf.length !== expectedBuf.length) {
      reject(res, "Invalid bearer token");
      return;
    }
    if (!timingSafeEqual(providedBuf, expectedBuf)) {
      reject(res, "Invalid bearer token");
      return;
    }
    next();
  };
}

/**
 * Create the Express app with MCP endpoints.
 * Exported so integration tests can use it without starting a real server.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<express.Express> {
  const useOAuth = !!(options.oauthClientId && options.oauthClientSecret);

  if (!useOAuth && !options.bearer) {
    throw new Error(BEARER_MISSING_ERROR);
  }

  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

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
          transport: "http",
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

  // Health check — helps verify the HTTP server is running and reachable
  app.get("/", (_req: express.Request, res: express.Response) => {
    res.json({
      status: "ok",
      server: "easy-notion-mcp",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
  });

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
    const authMiddleware = bearerAuthMiddleware(options.bearer!);

    app.post("/mcp", authMiddleware, createSessionHandler(getStaticToken, false));
    app.get("/mcp", authMiddleware, createGetHandler());
    app.delete("/mcp", authMiddleware, createDeleteHandler());

    console.error("Static token mode (NOTION_TOKEN + NOTION_MCP_BEARER)");
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

  const bindHost = getBindHost(process.env);

  const app = await createApp({
    notionToken: NOTION_TOKEN,
    oauthClientId: NOTION_OAUTH_CLIENT_ID,
    oauthClientSecret: NOTION_OAUTH_CLIENT_SECRET,
    oauthRedirectUri: OAUTH_REDIRECT_URI,
    rootPageId: process.env.NOTION_ROOT_PAGE_ID,
    trustContent: process.env.NOTION_TRUST_CONTENT === "true",
    bearer: process.env.NOTION_MCP_BEARER,
  });

  app.listen(PORT, bindHost, () => {
    console.error(`easy-notion-mcp HTTP server listening on ${bindHost}:${PORT}`);
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

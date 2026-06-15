import { randomUUID } from "crypto";
import type { Response, Request } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { TokenStore } from "./token-store.js";

// How long MCP bearer tokens are valid (1 hour)
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string; // Our callback URL, e.g. http://localhost:3333/callback
}

/**
 * Pending authorization session — stored between /authorize and /callback.
 */
interface AuthSession {
  clientId: string;
  state?: string;
  codeChallenge: string;
  redirectUri: string; // MCP client's redirect URI
  scopes: string[];
  resource?: URL;
  createdAt: number;
}

/**
 * Pending authorization code — stored between /callback and /token exchange.
 */
interface PendingCode {
  notionToken: string;
  notionRefreshToken?: string;
  workspaceId?: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: URL;
  createdAt: number;
}

/**
 * In-memory client store with Dynamic Client Registration support.
 * Clients are ephemeral — they re-register on server restart.
 */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(
    client: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    return client;
  }
}

export class NotionOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  /**
   * Pending auth sessions: sessionId -> AuthSession
   * (between /authorize redirect to Notion and /callback return)
   */
  private authSessions = new Map<string, AuthSession>();

  /**
   * Pending authorization codes: our auth code -> PendingCode
   * (between /callback and token exchange)
   */
  private pendingCodes = new Map<string, PendingCode>();

  private tokenStore: TokenStore;
  private config: NotionOAuthConfig;

  constructor(tokenStore: TokenStore, config: NotionOAuthConfig) {
    this.tokenStore = tokenStore;
    this.config = config;
    this.clientsStore = new InMemoryClientsStore();
  }

  /**
   * Redirect user to Notion OAuth consent screen.
   * The `res` is an Express Response object.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const sessionId = randomUUID();

    // Store session for correlation when Notion calls back
    this.authSessions.set(sessionId, {
      clientId: client.client_id,
      state: params.state,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes ?? [],
      resource: params.resource,
      createdAt: Date.now(),
    });

    // Build Notion OAuth URL
    const notionAuthUrl = new URL("https://api.notion.com/v1/oauth/authorize");
    notionAuthUrl.searchParams.set("client_id", this.config.clientId);
    notionAuthUrl.searchParams.set("response_type", "code");
    notionAuthUrl.searchParams.set("owner", "user");
    notionAuthUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    notionAuthUrl.searchParams.set("state", sessionId); // Our session ID as state

    res.redirect(notionAuthUrl.toString());
  }

  /**
   * Handle Notion's OAuth callback.
   * This is mounted as a separate Express route (NOT part of mcpAuthRouter).
   */
  async handleNotionCallback(req: Request, res: Response): Promise<void> {
    const code = req.query.code as string | undefined;
    const sessionId = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (!sessionId) {
      res.status(400).json({ error: "Missing state parameter" });
      return;
    }

    const session = this.authSessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: "Invalid or expired session" });
      return;
    }

    // Clean up the session
    this.authSessions.delete(sessionId);

    if (error || !code) {
      // Notion returned an error — relay it to the MCP client
      const targetUrl = new URL(session.redirectUri);
      targetUrl.searchParams.set("error", error ?? "access_denied");
      targetUrl.searchParams.set(
        "error_description",
        (req.query.error_description as string) ?? "Notion authorization was denied",
      );
      if (session.state) {
        targetUrl.searchParams.set("state", session.state);
      }
      res.redirect(targetUrl.toString());
      return;
    }

    // Exchange the Notion auth code for a Notion access token
    let notionToken: string;
    let notionRefreshToken: string | undefined;
    let workspaceId: string | undefined;
    try {
      const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
              "base64",
            ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error("Notion token exchange failed:", tokenResponse.status, errBody);
        const targetUrl = new URL(session.redirectUri);
        targetUrl.searchParams.set("error", "server_error");
        targetUrl.searchParams.set(
          "error_description",
          "Failed to exchange authorization code with Notion",
        );
        if (session.state) {
          targetUrl.searchParams.set("state", session.state);
        }
        res.redirect(targetUrl.toString());
        return;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        workspace_id?: string;
        token_type: string;
        bot_id?: string;
        owner?: unknown;
      };

      notionToken = tokenData.access_token;
      notionRefreshToken = tokenData.refresh_token;
      workspaceId = tokenData.workspace_id;
    } catch (err) {
      console.error("Notion token exchange error:", err);
      const targetUrl = new URL(session.redirectUri);
      targetUrl.searchParams.set("error", "server_error");
      targetUrl.searchParams.set("error_description", "Notion token exchange failed");
      if (session.state) {
        targetUrl.searchParams.set("state", session.state);
      }
      res.redirect(targetUrl.toString());
      return;
    }

    // Generate our own authorization code for the MCP client
    const ourAuthCode = randomUUID();
    this.pendingCodes.set(ourAuthCode, {
      notionToken,
      notionRefreshToken,
      workspaceId,
      clientId: session.clientId,
      codeChallenge: session.codeChallenge,
      redirectUri: session.redirectUri,
      scopes: session.scopes,
      resource: session.resource,
      createdAt: Date.now(),
    });

    // Redirect back to MCP client with our auth code
    const targetUrl = new URL(session.redirectUri);
    targetUrl.searchParams.set("code", ourAuthCode);
    if (session.state) {
      targetUrl.searchParams.set("state", session.state);
    }
    res.redirect(targetUrl.toString());
  }

  /**
   * Return the PKCE code_challenge for this authorization code.
   * Called by the SDK's token handler for local PKCE validation.
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const pending = this.pendingCodes.get(authorizationCode);
    if (!pending) {
      throw new Error("Invalid authorization code");
    }
    return pending.codeChallenge;
  }

  /**
   * Exchange our auth code for MCP bearer tokens.
   * The SDK has already validated PKCE by this point.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const pending = this.pendingCodes.get(authorizationCode);
    if (!pending) {
      throw new Error("Invalid authorization code");
    }
    if (pending.clientId !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    // Consume the code (one-time use)
    this.pendingCodes.delete(authorizationCode);

    // Generate MCP bearer token
    const mcpToken = randomUUID();
    const now = Date.now();
    const expiresAt = now + TOKEN_EXPIRY_MS;

    // Generate refresh token for MCP client
    const mcpRefreshToken = randomUUID();

    // Persist the mapping
    await this.tokenStore.storeToken({
      mcpToken,
      kind: "access",
      notionToken: pending.notionToken,
      refreshToken: pending.notionRefreshToken,
      workspaceId: pending.workspaceId,
      clientId: client.client_id,
      scopes: pending.scopes,
      createdAt: now,
      expiresAt,
    });

    // Also store the refresh token mapping (using mcpRefreshToken as key)
    await this.tokenStore.storeToken({
      mcpToken: mcpRefreshToken,
      kind: "refresh",
      notionToken: pending.notionToken,
      refreshToken: pending.notionRefreshToken,
      workspaceId: pending.workspaceId,
      clientId: client.client_id,
      scopes: pending.scopes,
      createdAt: now,
      // No expiresAt for refresh tokens — they last until revoked
    });

    return {
      access_token: mcpToken,
      token_type: "bearer",
      expires_in: TOKEN_EXPIRY_MS / 1000,
      refresh_token: mcpRefreshToken,
      scope: pending.scopes.join(" "),
    };
  }

  /**
   * Exchange an MCP refresh token for a new MCP access token.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    // Look up the refresh token record
    const record = await this.tokenStore.getByMcpToken(refreshToken);
    if (!record) {
      throw new Error("Invalid refresh token");
    }
    if (record.clientId !== client.client_id) {
      throw new Error("Refresh token was not issued to this client");
    }

    let notionToken = record.notionToken;

    // If we have a Notion refresh token, proactively refresh with Notion
    if (record.refreshToken) {
      try {
        const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                `${this.config.clientId}:${this.config.clientSecret}`,
              ).toString("base64"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: record.refreshToken,
          }),
        });

        if (tokenResponse.ok) {
          const tokenData = (await tokenResponse.json()) as {
            access_token: string;
            refresh_token?: string;
          };
          notionToken = tokenData.access_token;
          // Update the refresh token record with new Notion token
          record.notionToken = notionToken;
          if (tokenData.refresh_token) {
            record.refreshToken = tokenData.refresh_token;
          }
          await this.tokenStore.storeToken(record);
        }
        // If refresh fails, continue with existing token — it may still be valid
      } catch (err) {
        console.error("Notion token refresh failed:", err);
      }
    }

    // Issue new MCP access token
    const newMcpToken = randomUUID();
    const now = Date.now();
    const expiresAt = now + TOKEN_EXPIRY_MS;

    await this.tokenStore.storeToken({
      mcpToken: newMcpToken,
      kind: "access",
      notionToken,
      refreshToken: record.refreshToken,
      workspaceId: record.workspaceId,
      clientId: client.client_id,
      scopes: record.scopes,
      createdAt: now,
      expiresAt,
    });

    return {
      access_token: newMcpToken,
      token_type: "bearer",
      expires_in: TOKEN_EXPIRY_MS / 1000,
      refresh_token: refreshToken, // Reuse same refresh token
      scope: record.scopes.join(" "),
    };
  }

  /**
   * Verify an MCP bearer token and return AuthInfo.
   * Attaches the Notion token in `extra.notionToken` for the HTTP handler.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.tokenStore.getByMcpToken(token);
    if (!record) {
      throw new Error("Invalid or expired token");
    }
    if (record.kind !== "access") {
      throw new Error("Invalid or expired token");
    }

    // Check expiry (if set)
    if (record.expiresAt && record.expiresAt < Date.now()) {
      throw new Error("Token has expired");
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      // expiresAt must be seconds since epoch for the SDK middleware
      expiresAt: record.expiresAt ? Math.floor(record.expiresAt / 1000) : undefined,
      extra: {
        notionToken: record.notionToken,
        workspaceId: record.workspaceId,
      },
    };
  }

  /**
   * Revoke an MCP token.
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.tokenStore.deleteToken(request.token);
  }

  /**
   * Clean up expired auth sessions and pending codes (call periodically).
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [id, session] of this.authSessions) {
      if (now - session.createdAt > maxAge) {
        this.authSessions.delete(id);
      }
    }

    for (const [code, pending] of this.pendingCodes) {
      if (now - pending.createdAt > maxAge) {
        this.pendingCodes.delete(code);
      }
    }
  }
}

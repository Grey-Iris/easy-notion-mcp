import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Request, Response } from "express";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { NotionOAuthProvider } from "../src/auth/oauth-provider.js";
import { TokenStore } from "../src/auth/token-store.js";

/**
 * Refresh-token replay regression.
 *
 * The refresh-token assertion is expected to fail until verifyAccessToken
 * rejects MCP refresh tokens presented on the access-bearer path.
 */

describe("OAuth refresh-token replay", () => {
  let tmpDir: string;
  let store: TokenStore;
  let provider: NotionOAuthProvider;

  const client = {
    client_id: "client-1",
    client_name: "test-client",
    redirect_uris: ["http://localhost:9999/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  } as unknown as OAuthClientInformationFull;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "oauth-refresh-replay-"));
    store = new TokenStore(tmpDir);
    await store.init();
    provider = new NotionOAuthProvider(store, {
      clientId: "notion-client-id",
      clientSecret: "notion-client-secret",
      redirectUri: "http://localhost:3333/callback",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "ntn_fake",
          refresh_token: "ntn_refresh_fake",
          workspace_id: "ws1",
          token_type: "bearer",
        }),
        text: async () => "",
      })),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeRedirectResponse(): {
    res: Response;
    redirectUrl: () => string;
  } {
    let capturedRedirect: string | undefined;
    const res = {} as Response;

    res.redirect = vi.fn((url: string) => {
      capturedRedirect = url;
      return res;
    }) as unknown as Response["redirect"];
    res.status = vi.fn(() => res) as unknown as Response["status"];
    res.json = vi.fn(() => res) as unknown as Response["json"];

    return {
      res,
      redirectUrl: () => {
        if (!capturedRedirect) {
          throw new Error("Expected response to redirect");
        }
        return capturedRedirect;
      },
    };
  }

  async function issueMcpTokens() {
    const authorizeRes = makeRedirectResponse();
    const params = {
      codeChallenge: "pkce-challenge",
      redirectUri: "http://localhost:9999/callback",
      scopes: ["read", "write"],
      state: "client-state",
    } as AuthorizationParams;

    await provider.authorize(client, params, authorizeRes.res);

    const notionAuthorizeUrl = new URL(authorizeRes.redirectUrl());
    const sessionId = notionAuthorizeUrl.searchParams.get("state");
    expect(sessionId).toBeTruthy();

    const callbackRes = makeRedirectResponse();
    const req = {
      query: {
        code: "notion-auth-code",
        state: sessionId,
      },
    } as unknown as Request;

    await provider.handleNotionCallback(req, callbackRes.res);

    const clientRedirectUrl = new URL(callbackRes.redirectUrl());
    const authCode = clientRedirectUrl.searchParams.get("code");
    expect(authCode).toBeTruthy();

    return provider.exchangeAuthorizationCode(client, authCode!);
  }

  it("rejects a genuinely issued MCP refresh token on the access-token verifier", async () => {
    const tokens = await issueMcpTokens();

    const accessAuthInfoPromise = provider.verifyAccessToken(tokens.access_token);
    await expect(accessAuthInfoPromise).resolves.toBeDefined();
    const authInfo = await accessAuthInfoPromise;
    expect(authInfo.extra?.notionToken).toBe("ntn_fake");

    await expect(provider.verifyAccessToken(tokens.refresh_token!)).rejects.toThrow();
  });
});

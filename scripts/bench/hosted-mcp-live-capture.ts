/**
 * Live OAuth + tools/list + sample tools/call capture against mcp.notion.com.
 *
 * Settles bench-audit findings C1 (does hosted expose update_content?) and C2
 * (real upper bound on hosted tools/list listing budget). See
 * .meta/research/bench-scripts-audit-2026-04-28.md.
 *
 * READ-ONLY against the hosted server. The only tools/call invoked here is
 * `notion-get-self` (returns bot/workspace identity, no writes).
 *
 * OAuth state (DCR client credentials + access/refresh tokens + PKCE verifier)
 * is persisted to ~/.cache/easy-notion-mcp/hosted-capture/ so it never lands in
 * the repo.
 *
 * Captured artifacts (committable evidence) go to
 * .meta/bench/hosted-mcp-live-capture/.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { encodingForModel } from "js-tiktoken";

const SERVER_URL = "https://mcp.notion.com/mcp";
const CALLBACK_PORT = 8765;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const CLIENT_NAME = "easy-notion-mcp live-capture (audit)";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const captureDir = path.join(repoRoot, ".meta/bench/hosted-mcp-live-capture");
const oauthDir = path.join(os.homedir(), ".cache/easy-notion-mcp/hosted-capture");

const enc = encodingForModel("gpt-4");

// --- File-backed OAuth client provider ---------------------------------------

type PersistedOAuth = {
  client?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
};

async function readPersisted(): Promise<PersistedOAuth> {
  try {
    const raw = await readFile(path.join(oauthDir, "oauth.json"), "utf8");
    return JSON.parse(raw) as PersistedOAuth;
  } catch {
    return {};
  }
}

async function writePersisted(state: PersistedOAuth): Promise<void> {
  await mkdir(oauthDir, { recursive: true });
  await writeFile(path.join(oauthDir, "oauth.json"), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}

class FileBackedOAuthProvider implements OAuthClientProvider {
  private cached: PersistedOAuth | undefined;

  get redirectUrl(): string {
    return REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const state = await this.load();
    return state.client;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    const state = await this.load();
    state.client = info;
    await this.save(state);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await this.load();
    return state.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state = await this.load();
    state.tokens = tokens;
    await this.save(state);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const state = await this.load();
    state.codeVerifier = codeVerifier;
    await this.save(state);
  }

  async codeVerifier(): Promise<string> {
    const state = await this.load();
    if (!state.codeVerifier) throw new Error("No code verifier persisted");
    return state.codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Write the URL to a known path so the orchestrator can surface it
    // synchronously while this process keeps the callback listener open.
    await mkdir(oauthDir, { recursive: true });
    await writeFile(path.join(oauthDir, "auth-url.txt"), authorizationUrl.toString() + "\n");
    console.error("");
    console.error("==================================================================");
    console.error("OAuth consent required. Open this URL in your browser:");
    console.error("");
    console.error(authorizationUrl.toString());
    console.error("");
    console.error("Click 'Allow' and the browser will redirect to localhost:" + CALLBACK_PORT);
    console.error("This script is listening for the callback. ~30 seconds.");
    console.error("==================================================================");
    console.error("");
  }

  private async load(): Promise<PersistedOAuth> {
    if (!this.cached) this.cached = await readPersisted();
    return this.cached;
  }

  private async save(state: PersistedOAuth): Promise<void> {
    this.cached = state;
    await writePersisted(state);
  }
}

// --- Local callback server ---------------------------------------------------

type CodeWaiter = {
  promise: Promise<string>;
  close: () => void;
};

function startCallbackServer(): Promise<CodeWaiter> {
  return new Promise((started, startFailed) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end("Missing URL");
        return;
      }
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(
          `OAuth error: ${error} — ${url.searchParams.get("error_description") ?? ""}`,
        );
        rejectCode(new Error(`OAuth error: ${error}`));
        server.close();
        return;
      }
      if (!code) {
        res.writeHead(400).end("Missing code");
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(
          "<html><body><h1>Authorized.</h1><p>You can close this window. Capture script will continue in the terminal.</p></body></html>",
        );
      resolveCode(code);
      server.close();
    });
    server.on("error", (err) => {
      rejectCode(err);
      startFailed(err);
    });
    server.listen(CALLBACK_PORT, () => {
      console.error(`[capture] Callback server listening on ${REDIRECT_URI}`);
      started({
        promise: codePromise,
        close: () => server.close(),
      });
    });
  });
}

// --- Token counting ----------------------------------------------------------

function countTokens(value: unknown): number {
  return enc.encode(JSON.stringify(value)).length;
}

function countBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(captureDir, { recursive: true });

  const provider = new FileBackedOAuthProvider();

  // Start the callback listener BEFORE connecting so there is no race window
  // when James clicks consent.
  const waiter = await startCallbackServer();

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    authProvider: provider,
  });

  const client = new Client(
    { name: "hosted-mcp-live-capture", version: "0.0.1" },
    { capabilities: {} },
  );

  // First connect attempt — triggers OAuth if no tokens.
  try {
    await client.connect(transport);
    console.error("[capture] Connected with persisted token.");
    waiter.close();
    return await capture(client);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      console.error("[capture] Unexpected connect error:", err);
      waiter.close();
      throw err;
    }
    console.error("[capture] No valid token. Beginning OAuth flow…");
    const code = await waiter.promise;
    console.error("[capture] Got authorization code; exchanging…");
    await transport.finishAuth(code);
    const transport2 = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      authProvider: provider,
    });
    const client2 = new Client(
      { name: "hosted-mcp-live-capture", version: "0.0.1" },
      { capabilities: {} },
    );
    await client2.connect(transport2);
    console.error("[capture] Connected after OAuth.");
    return await capture(client2);
  }
}

async function capture(client: Client): Promise<void> {
  const captureDate = new Date().toISOString();

  // ---- tools/list capture ----
  console.error("[capture] Calling tools/list…");
  const toolsResult = await client.listTools();
  const toolsArray = toolsResult.tools;
  const toolsListWrapped = { tools: toolsArray };

  await writeFile(
    path.join(captureDir, "tools-list.json"),
    JSON.stringify(toolsListWrapped, null, 2),
    "utf8",
  );

  const arrayTokens = countTokens(toolsArray);
  const wrappedTokens = countTokens(toolsListWrapped);
  const arrayBytes = countBytes(toolsArray);

  const perTool = toolsArray.map((tool) => ({
    name: tool.name,
    description_present: typeof tool.description === "string" && tool.description.length > 0,
    description_tokens: tool.description ? enc.encode(tool.description).length : 0,
    schema_tokens: tool.inputSchema ? countTokens(tool.inputSchema) : 0,
    total_tokens: countTokens(tool),
    bytes: countBytes(tool),
  }));
  perTool.sort((a, b) => b.total_tokens - a.total_tokens);

  const tokenSummary = {
    capture_date: captureDate,
    server: SERVER_URL,
    tokenizer: "cl100k_base (js-tiktoken encodingForModel('gpt-4'))",
    tool_count: toolsArray.length,
    array_tokens: arrayTokens,
    wrapped_tokens: wrappedTokens,
    array_bytes: arrayBytes,
    per_tool_top: perTool.slice(0, 10),
    per_tool_all: perTool,
  };
  await writeFile(
    path.join(captureDir, "tools-list-tokens.json"),
    JSON.stringify(tokenSummary, null, 2),
    "utf8",
  );

  // ---- update tool schema extraction ----
  const updateLikeNames = [
    "notion-update-page",
    "notion_update_page",
    "update_page",
    "update_content",
    "find_replace",
  ];
  const updateLike = toolsArray.filter((t) =>
    updateLikeNames.some((n) => t.name === n) ||
    /update.*page|update.*content|find.*replace/i.test(t.name),
  );
  await writeFile(
    path.join(captureDir, "update-tool-schemas.json"),
    JSON.stringify({ matched: updateLike.map((t) => t.name), tools: updateLike }, null, 2),
    "utf8",
  );

  // ---- update_content semantic search across all tool schemas ----
  const haystack = JSON.stringify(toolsArray);
  const c1Evidence = {
    update_content_appears: haystack.includes("update_content"),
    old_str_appears: haystack.includes("old_str"),
    new_str_appears: haystack.includes("new_str"),
    replace_all_matches_appears: haystack.includes("replace_all_matches"),
    replace_content_range_appears: haystack.includes("replace_content_range"),
    update_properties_appears: haystack.includes("update_properties"),
    selection_with_ellipsis_appears: haystack.includes("selection_with_ellipsis"),
  };
  await writeFile(
    path.join(captureDir, "c1-evidence.json"),
    JSON.stringify(c1Evidence, null, 2),
    "utf8",
  );

  // ---- sample tools/call: notion-get-self (read-only) ----
  console.error("[capture] Calling notion-get-self (read-only sample)…");
  let sampleResult: unknown = null;
  let sampleError: unknown = null;
  try {
    sampleResult = await client.callTool({ name: "notion-get-self", arguments: {} });
  } catch (err) {
    sampleError = err instanceof Error ? { name: err.name, message: err.message } : err;
  }
  await writeFile(
    path.join(captureDir, "sample-call.json"),
    JSON.stringify(
      {
        request: { name: "notion-get-self", arguments: {} },
        response: sampleResult,
        error: sampleError,
      },
      null,
      2,
    ),
    "utf8",
  );

  // ---- tool-name diff against this repo (informational) ----
  const ourTools = [
    "create_page", "create_page_from_file", "duplicate_page", "move_page",
    "archive_page", "restore_page", "share_page", "list_pages",
    "read_page", "append_content", "replace_content", "update_section",
    "update_block", "find_replace",
    "create_database", "list_databases", "get_database", "query_database",
    "add_database_entry", "add_database_entries", "update_database_entry",
    "delete_database_entry", "update_data_source",
    "search",
    "add_comment", "list_comments",
    "list_users", "get_me",
  ];
  const hostedNames = toolsArray.map((t) => t.name);
  const diff = {
    hosted_only: hostedNames.filter((n) => !ourTools.includes(n.replace(/^notion-/, "").replace(/-/g, "_"))),
    ours_only: ourTools.filter(
      (n) => !hostedNames.includes(n) && !hostedNames.includes(`notion-${n.replace(/_/g, "-")}`),
    ),
  };
  await writeFile(
    path.join(captureDir, "tool-name-diff.json"),
    JSON.stringify(diff, null, 2),
    "utf8",
  );

  console.error("");
  console.error("===== Capture complete =====");
  console.error(`Tool count:      ${toolsArray.length}`);
  console.error(`Array tokens:    ${arrayTokens}  (cl100k_base, compact JSON)`);
  console.error(`Wrapped tokens:  ${wrappedTokens}`);
  console.error(`Array bytes:     ${arrayBytes}`);
  console.error("");
  console.error("C1 indicator hits:");
  for (const [k, v] of Object.entries(c1Evidence)) {
    console.error(`  ${k.padEnd(36)}: ${v}`);
  }
  console.error("");
  console.error(`Artifacts written to ${path.relative(repoRoot, captureDir)}/`);
  console.error(`OAuth state at ${path.relative(os.homedir(), oauthDir)} (under ~)`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

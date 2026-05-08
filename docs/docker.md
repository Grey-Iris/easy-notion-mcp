# Running easy-notion-mcp with Docker

## Quick Start

Pull the latest image from GitHub Container Registry and run with an API token:

```bash
docker pull ghcr.io/grey-iris/easy-notion-mcp:latest
docker run -p 3333:3333 \
  -e NOTION_TOKEN=ntn_your_token_here \
  ghcr.io/grey-iris/easy-notion-mcp:latest
```

Access the MCP server at `http://localhost:3333/mcp`

## Build Locally

```bash
docker build -t notion-mcp:latest .
docker run -p 3333:3333 \
  -e NOTION_TOKEN=ntn_your_token_here \
  notion-mcp:latest
```

## HTTP Server Modes

### Static Token (API Token)

```bash
docker run -p 3333:3333 \
  -e NOTION_TOKEN=ntn_your_token_here \
  ghcr.io/grey-iris/easy-notion-mcp:latest
```

### OAuth

```bash
docker run -p 3333:3333 \
  -e NOTION_OAUTH_CLIENT_ID=your_client_id \
  -e NOTION_OAUTH_CLIENT_SECRET=your_client_secret \
  -e OAUTH_REDIRECT_URI=https://your-domain.com/callback \
  ghcr.io/grey-iris/easy-notion-mcp:latest
```

Visit `http://localhost:3333` to authorize.

> **Note:** `OAUTH_REDIRECT_URI` defaults to `http://localhost:3333/callback`. Override it
> when deploying behind a reverse proxy or to a public URL.

## Stdio Mode

For MCP clients that communicate over stdin/stdout (e.g. Claude Desktop):

```bash
docker run -i \
  -e NOTION_TOKEN=ntn_your_token_here \
  ghcr.io/grey-iris/easy-notion-mcp:latest \
  node dist/index.js
```

> **Note:** Stdio mode does not start an HTTP server — no `-p` flag is needed.

## Using Environment Files

Create a `.env` file:

```env
NOTION_TOKEN=ntn_your_token_here
PORT=3333
# NOTION_ROOT_PAGE_ID=your_page_id
# NOTION_TRUST_CONTENT=true
```

Then pass it to the container:

```bash
docker run -p 3333:3333 \
  --env-file .env \
  ghcr.io/grey-iris/easy-notion-mcp:latest
```

## Environment Variables

See [Configuration](../README.md#configuration) in the README for the full reference.

### Required (choose one auth method)

| Variable                                               | Mode                   | Description                           |
|--------------------------------------------------------|------------------------|---------------------------------------|
| `NOTION_TOKEN`                                         | HTTP (static) or Stdio | Notion internal integration token     |
| `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` | HTTP (OAuth)           | OAuth credentials for user-level auth |

### Optional

| Variable               | Default                            | Description                                         |
|------------------------|------------------------------------|-----------------------------------------------------|
| `PORT`                 | `3333`                             | HTTP server port                                    |
| `NOTION_ROOT_PAGE_ID`  | ~                                  | Default parent page for new pages                   |
| `NOTION_TRUST_CONTENT` | ~                                  | Skip content notice prefix on `read_page` responses |
| `OAUTH_REDIRECT_URI`   | `http://localhost:{PORT}/callback` | OAuth callback URL                                  |

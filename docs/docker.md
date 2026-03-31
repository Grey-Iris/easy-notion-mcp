# Running easy-notion-mcp with Docker

## Build the image

```bash
docker build -t notion-mcp:latest .
```

## API Token Mode (HTTP Server)

```bash
docker run -p 3333:3333 \
  -e NOTION_TOKEN=ntn_your_token_here \
  -e PORT=3333 \
  notion-mcp:latest
```

Access the server at `http://localhost:3333/mcp`

## OAuth Mode (HTTP Server)

```bash
docker run -p 3333:3333 \
  -e NOTION_OAUTH_CLIENT_ID=your_client_id \
  -e NOTION_OAUTH_CLIENT_SECRET=your_client_secret \
  -e PORT=3333 \
  -e OAUTH_REDIRECT_URI=http://localhost:3333/callback \
  notion-mcp:latest
```

Visit `http://localhost:3333` to authorize.

## Stdio Mode (API Token)

```bash
docker run -i \
  -e NOTION_TOKEN=ntn_your_token_here \
  notion-mcp:latest \
  node dist/index.js
```

Useful for stdio transport in MCP clients. Receives input via stdin, sends MCP protocol responses via stdout.

## With .env file

```bash
docker run -p 3333:3333 \
  --env-file .env \
  notion-mcp:latest
```

Create a `.env` file in your project with the required variables.

## Environment Variables

See [Configuration](../README.md#configuration) in the README for details.

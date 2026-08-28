# syntax=docker/dockerfile:1

# easy-notion-mcp: containerized stdio MCP server.
# The MCP client speaks JSON-RPC over the container's stdin/stdout, so this
# image is meant to be run with `docker run -i --rm`, not as a daemon.

# ---------- build stage ----------
FROM node:22-alpine AS build

WORKDIR /app

# Install the full dependency set (dev included) so tsc is available.
# --ignore-scripts skips the "prepare": "tsc" lifecycle hook, which would
# otherwise run before the sources are copied in.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="easy-notion-mcp"
LABEL org.opencontainers.image.description="Token-efficient, markdown-first Notion MCP server"
LABEL org.opencontainers.image.source="https://github.com/Grey-Iris/easy-notion-mcp"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production

WORKDIR /app

# Production dependencies only. --ignore-scripts again skips "prepare": "tsc";
# there is no TypeScript compiler in this stage and none is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiled output plus the bundled skills that `easy-notion-mcp init` copies.
COPY --from=build /app/dist ./dist
COPY skills ./skills

# Application files stay root-owned and the process runs unprivileged, so the
# server cannot rewrite its own code.
USER node

# No credentials are baked into the image. NOTION_TOKEN is required at run
# time; NOTION_ROOT_PAGE_ID, NOTION_TRUST_CONTENT and NOTION_MCP_WORKSPACE_ROOT
# are optional. Pass them with `docker run -i --rm -e NOTION_TOKEN=... <image>`.
ENTRYPOINT ["node", "dist/index.js"]

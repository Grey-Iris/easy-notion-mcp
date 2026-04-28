FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src/ ./src/

RUN --mount=type=cache,target=/root/.npm npm install
RUN npm run build

FROM node:20-alpine AS release

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

ENV NODE_ENV=production

RUN npm ci --ignore-scripts --omit-dev

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3333/ || exit 1

CMD ["node", "dist/http.js"]

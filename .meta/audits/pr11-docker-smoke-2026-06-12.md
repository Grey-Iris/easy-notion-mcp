# PR #11 Docker pipeline — runtime smoke + workflow review

- **Date:** 2026-06-12
- **PR:** #11 "add docker image publishing pipeline" (branch `docker-publish`, Grey-Iris/easy-notion-mcp)
- **Method:** local merge of `origin/main` into PR head in a throwaway worktree, Docker build + runtime smoke, read-only workflow review. No pushes, no GitHub mutations, no commits to the working tree.
- **Verdict: NOT safe to merge as-is — 3 runtime blockers.** All are consequences of the branch being **197 commits behind main**; the Docker image is non-functional via its own documentation after the merge.

---

## 1. Merge result

- `git fetch public pull/11/head:pr11-smoke`; worktree from it; `git merge public/main`.
- **Merge is CLEAN — no conflicts.** (Good: not a blocker.)
- Branch distance: **197 commits behind** main, **2 ahead** (one feature commit `91b4e25` + one merge commit). The PR was authored against a very old main. This staleness is the root cause of every runtime defect below — the requirements it violates (bearer token, loopback-default bind) landed in main *after* the PR was written.
- PR touches 5 files only: `.dockerignore`, `.github/workflows/docker-publish.yml`, `Dockerfile`, `README.md` (+4 lines), `docs/docker.md`.

## 2. Docker build

- `docker build -t easy-notion-mcp:pr11-smoke .` → **SUCCESS** (fresh, uncached).
- **Image size: 235 MB** (node:20-alpine base, multi-stage).
- Builder stage `npm install` → "added 177 packages". Release stage `npm ci --ignore-scripts --omit-dev` → "added 94 packages, audited 95". No npm warnings/errors.
- **Lockfile: HONORED.** The runtime stage uses `npm ci` (line 22), which hard-fails on package.json/lockfile drift, so production deps are reproducible. The builder's `npm install` (line 9) only affects build-time devDeps (typescript) and cannot drift the shipped image. **Drift risk: LOW / non-blocking** — matches the brief's prior assessment.

## 3. Runtime smoke (HTTP static-token, dummy token, host :13333 → container :3333)

| Check | Result |
|---|---|
| Container runs as non-root | **PASS** — `uid=1000(node) gid=1000(node)` |
| Stdio entry (`node dist/index.js`) | **PASS** — prints banner "easy-notion-mcp running on stdio…", exits on EOF. dist/index.js present. Docs accurate. |
| `curl http://127.0.0.1:13333/` (default env) | **FAIL** (curl exit 56) — see Blocker B |
| Container starts with docs' Quick Start env | **FAIL** — see Blocker A |
| HEALTHCHECK → healthy | **FAIL** — settles to **`unhealthy`** — see Blocker C |
| `curl` with `NOTION_MCP_BIND_HOST=0.0.0.0` | **PASS** — returns `{"status":"ok","server":"easy-notion-mcp","transport":"streamable-http","endpoint":"/mcp"}` |

### Blocker A — container won't start with the documented command (missing `NOTION_MCP_BEARER`)
`docs/docker.md` Quick Start is `docker run -p 3333:3333 -e NOTION_TOKEN=… <image>`. The merged server requires `NOTION_MCP_BEARER` in static-token HTTP mode (since v0.3.0) and **fatally exits** otherwise:
```
Fatal: Error: NOTION_MCP_BEARER is required to start easy-notion-mcp in static-token HTTP mode (since v0.3.0).
    at createApp (file:///app/dist/http.js:65:15)
```
The docs never mention `NOTION_MCP_BEARER`. A user copy-pasting Quick Start gets a container that dies on boot. **Severity: HIGH (blocker).**

### Blocker B — published port unreachable by default (loopback-only bind)
The server defaults to binding `127.0.0.1` (`src/http.ts:47`, `getBindHost` → `NOTION_MCP_BIND_HOST ?? "127.0.0.1"`). Inside a container that means the published port can't be reached from the host (`curl 127.0.0.1:13333` → exit 56; container log: `listening on 127.0.0.1:3333`). The documented `docker run -p 3333:3333` therefore yields an **unreachable MCP server**. Setting `-e NOTION_MCP_BIND_HOST=0.0.0.0` fixes it (verified: host curl returns health JSON), but neither the Dockerfile nor `docs/docker.md` sets or mentions it. **Severity: HIGH (blocker) for the documented happy path.**

### Blocker C — HEALTHCHECK never goes healthy (IPv4/IPv6 mismatch)
`HEALTHCHECK CMD wget -qO- http://localhost:3333/`. In the alpine image `/etc/hosts` maps `localhost` to **both** `127.0.0.1` and `::1`; busybox wget tries `::1` (IPv6) first, but the Node server binds IPv4 only → `Connection refused` on every probe. Confirmed: with `NOTION_MCP_BIND_HOST=0.0.0.0` (host curl working), the probe **still fails** and the container settles to **`unhealthy`**:
```
$ docker exec … wget -qO- http://localhost:3333/   → Connection refused
$ docker exec … wget -qO- http://127.0.0.1:3333/   → {"status":"ok",...}
health=unhealthy   (every probe exit=1)
```
This is independent of Blocker B. Orchestrators (compose `condition: service_healthy`, k8s, swarm) will treat the container as never-ready / restart it. The HEALTHCHECK is a headline feature of this PR and it is broken. **Fix is one line: probe `http://127.0.0.1:3333/` instead of `localhost`. Severity: HIGH (blocker).**

## 4. Workflow review (`.github/workflows/docker-publish.yml`)

- **GHCR permissions: PRESENT and correct.** Both `build` and `merge` jobs declare `permissions: { contents: read, packages: write }`. ✓
- **Independence from `release.yml` (npm): CONFIRMED.** Both fire on `push: tags: ['v*']`, but they are separate workflow files → separate runs, and **neither defines a `concurrency` group**. A docker-publish failure does **not** block or fail the npm release; the next release's npm publish is clean regardless of the Docker job. ✓
- **Multi-arch matrix + manifest merge: correct standard pattern.** amd64 (ubuntu-24.04) and arm64 (ubuntu-24.04-arm) each build `push-by-digest=true` and upload a `digests-<arch>` artifact; the `merge` job downloads all digests and runs `docker buildx imagetools create` over them with semver+`latest` tags derived from the git tag. The tags-only trigger is what makes the `type=semver` meta and `latest`-enable guard work. No wiring gap. ✓
- **`npm install` vs `npm ci` in builder: LOW / non-blocking** (see §2 — runtime stage uses `npm ci`, lockfile honored).
- **Note:** the workflow only triggers on `v*` tags, so **CI has never built this image** — the next release tag is its first real execution. The defects in §3 would surface there. The local smoke in this audit is currently the only evidence the image builds/runs at all.

## 5. Cleanup

Smoke containers removed, temp worktree removed, `pr11-smoke` branch deleted, `easy-notion-mcp:pr11-smoke` image removed. Main working tree untouched (on `dev`). Host ports 3333/8081 never touched; only host 13333 used.

---

## Summary for orchestrator

**Verdict: NOT safe to merge as-is — 3 runtime blockers, all small fixes, all caused by the PR being 197 commits behind main.**

1. Merge into current main is **clean** (no conflicts). Build **succeeds**, image **235 MB**, lockfile **honored** (`npm ci` in release stage), runs **non-root** (`node`), **stdio mode works** as documented.
2. **Blocker A:** docs' Quick Start command dies on boot — server now requires `NOTION_MCP_BEARER` (since v0.3.0); `docs/docker.md` never mentions it.
3. **Blocker B:** server defaults to binding `127.0.0.1`, so the documented `docker run -p 3333:3333` is **unreachable from the host**. Needs `NOTION_MCP_BIND_HOST=0.0.0.0` (undocumented). Verified: setting it makes host curl return the health JSON.
4. **Blocker C:** HEALTHCHECK probes `localhost` → resolves to IPv6 `::1`, server is IPv4-only → container is **permanently `unhealthy`** even when serving correctly. One-line fix: probe `127.0.0.1`.
5. **Workflow is sound:** `packages: write` present; docker-publish and npm `release.yml` are **independent** (no shared concurrency; a Docker failure won't break the npm release); multi-arch matrix + `imagetools` merge wired correctly. But it fires only on `v*` tags, so **CI has never built this image** — first real run is the next release, where A/B/C would bite.

Recommend: fix HEALTHCHECK to use `127.0.0.1`, and update Dockerfile/docs to set `NOTION_MCP_BIND_HOST=0.0.0.0` and document `NOTION_MCP_BEARER`, then re-smoke. Conflict-free merge and clean workflow design mean these are quick fixes, not a redesign.

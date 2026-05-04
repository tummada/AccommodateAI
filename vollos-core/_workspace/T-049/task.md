---
id: T-049
title: Add /api/v1/health endpoint (K2 convention)
assigned_to: vollos-backend
priority: low
status: in_progress
spawn_started_at: 2026-04-20T11:25+07:00
security_checkpoint: false
owned_files:
  - apps/api/src/index.ts
  - apps/api/test/**
dependencies: []
---

## Context

Per CLAUDE.md rule K2: "API ใหม่ทุกตัวอยู่ใต้ `/api/v1/`". Currently `apps/api/src/index.ts:28` registers only `/health`. T-048 smoke test revealed `https://vollos.ai/api/v1/health` returns 404. `/health` works (Caddy proxies) but isn't under the `/api/v1/` prefix.

Also note: auth-service has the same pattern (`/health` on `auth.vollos.ai` works at 200). Scope of this task: **API service only**.

## Goal

Add `/api/v1/health` route that returns the same JSON payload as the existing `/health` (do NOT remove `/health` — used by local Docker healthcheck + monitor.sh; keep both as aliases).

## Scope

1. Find the existing `/health` handler in `apps/api/src/index.ts` — reuse the same handler function
2. Mount it on both paths (`/health` and `/api/v1/health`) — Hono supports `app.get('/path', handler)` x2 or a shared helper
3. Add/update test ensuring both endpoints return 200 + `{status: "ok"}` (or whatever existing shape is)
4. `pnpm typecheck && pnpm lint && pnpm test` → all green

## Workflow

1. `git fetch origin && git checkout -b feat/api-v1-health origin/main`
2. Implement
3. Commit: `feat(api): add /api/v1/health endpoint (K2 convention)`
4. Push + open MR

## Acceptance Criteria

1. [ ] Both `/health` and `/api/v1/health` return same payload
2. [ ] Test added covering both paths
3. [ ] `pnpm typecheck && pnpm lint && pnpm test` all green — paste output in output.md
4. [ ] Branch pushed + MR opened; URL returned
5. [ ] Commit message uses conventional format
6. [ ] `self_review` complete — every AC has `result` + `evidence: file:line`

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-049/output.md`

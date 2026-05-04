---
id: T-005
title: RS-013 Deploy Prep — Fix env_port_conflict (T-004 finding)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T17:59:48+07:00
dependencies:
  - T-004 (runtime test passed 10/10 but surfaced 3 findings)
security_checkpoint: false  # infra config only, no auth/secret change
domain_consultation: null
blocks:
  - Phase 2B VPS apply (env_port_conflict is MEDIUM runtime blocker)
---

## Context

T-004 local integration test surfaced **runtime issue** that syntax validation (T-002/T-003) could not catch:

**env_port_conflict (MEDIUM):**
- Both `vollos-api` and `auth-service` have `env_file: .env` in `docker-compose.yml`
- `.env` has single `PORT=` variable
- Both services read same `process.env.PORT` → listen on same port number inside container
- auth-service should listen on container port 3004 but listens on 3001 (same as vollos-api) due to shared `PORT=` env
- Host binding `3004:3004` routes to auth-service container:3004 where nothing is listening → healthcheck unhealthy (depending on what PORT was in .env)

**Related LOW finding — dockerfile_compose_port_disagree:**
- `apps/api/Dockerfile:L51` sets `ENV PORT=3000`
- `docker-compose.yml` binds `3001:3001` + healthcheck probes :3001
- Without explicit `PORT=3001` override, api container listens on 3000 → compose routes fail

Both findings share the same fix pattern: **make PORT explicit per-service in compose `environment:` overriding any default**.

## Acceptance Criteria

1. **Fix env_port_conflict:**
   - `docker-compose.yml` → vollos-api service has `environment: PORT: 3001` (compose list syntax or map syntax — DevOps choose)
   - `docker-compose.yml` → auth-service service has `environment: PORT: 3004`
   - `env_file: .env` still present (other env vars still shared from .env) — DO NOT remove
   - `docker-compose.prod.yml` → verify whether any port override needed (likely no — prod strips `ports:` not `environment:`)

2. **Fix dockerfile_port_disagree:**
   - `apps/api/Dockerfile:L51` — change `ENV PORT=3000` to `ENV PORT=3001` (match architecture rule E1/E3: 30=vollos-core, 01=api)
   - Verify auth-service Dockerfile — `apps/auth-service/Dockerfile` — what PORT does it set? If also hardcoded, change to 3004.

3. **Remove conflicting PORT from `.env` (if needed):**
   - If `.env.example` has `PORT=` at the top-level (not per-service) → remove it + add comment pointing to `docker-compose.yml environment:` as source of truth
   - Rationale: PORT is service-specific, should not be a .env top-level (.env is for shared vars like DATABASE_URL, secrets)

4. **Verify no regression via runtime test (REQUIRED per owner rule `feedback_local_integration_test`):**
   - `docker compose up -d --build` with local test .env
   - Wait up to 120s for all 3 containers healthy
   - `curl http://localhost:3001/health` → 200 ok
   - `curl http://localhost:3004/health` → 200 ok
   - `curl http://localhost:3004/.well-known/jwks.json` → valid JWKS
   - Both services listening on CORRECT ports (verify via `docker compose exec <svc> sh -c "netstat -tlnp | grep LISTEN"` or `ss -tlnp`)
   - Teardown: `docker compose down -v`
   - Document in output.md `runtime_verification:` section

5. **Branch + MR:**
   - Feature branch: `fix/rs013-env-port-conflict`
   - Conventional commits
   - MR to main
   - No push to main

6. **Self-review accurate** — every field result: true + file:line evidence; timing claims verifiable

7. **Grep clean** — no placeholders introduced

## Owned Files

- `docker-compose.yml` (primary fix)
- `docker-compose.prod.yml` (verify only, likely no change)
- `apps/api/Dockerfile` (line 51 — ENV PORT)
- `apps/auth-service/Dockerfile` (verify PORT if hardcoded)
- `.env.example` (possibly remove top-level PORT)

## Forbidden

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md`
- `apps/*/src/**`, `packages/*/src/**` (application code)
- Migration files
- No SSH to VPS

## Expected Output

```yaml
task_id: T-005
status: passed | failed | blocked
branch: fix/rs013-env-port-conflict
commit_sha: <sha>
mr_url: <url>
fix_env_port_conflict:
  approach: "compose environment: per service overrides .env_file"
  vollos_api_port: 3001 (via docker-compose.yml:L??)
  auth_service_port: 3004 (via docker-compose.yml:L??)
fix_dockerfile_port:
  api_dockerfile_before: "ENV PORT=3000"
  api_dockerfile_after: "ENV PORT=3001"
  auth_dockerfile_status: "already 3004 | changed to 3004 | N/A"
env_example_cleanup:
  top_level_port_removed: true|false
  rationale: "..."
runtime_verification:
  docker_up_success: true
  healthcheck_all_healthy_within_sec: N
  curl_3001_health: "200 ok"
  curl_3004_health: "200 ok"
  jwks_valid: true
  netstat_vollos_api: "listening on :3001"
  netstat_auth_service: "listening on :3004"
  teardown_clean: true
self_review:
  ...
```

## Rules
- Read `_workspace/T-004/output.md` — detailed reproduction steps
- Read `CLAUDE.md` § E (port numbering — 30=vollos-core, 01=api, 04=auth)
- Runtime verify is MANDATORY per `feedback_local_integration_test` memory — do NOT skip
- Conventional commit: `fix(infra): explicit per-service PORT to avoid env_file collision`

Begin.

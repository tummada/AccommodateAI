---
id: T-012
title: RS-013 Hot-fix — vollos.ai Caddy route /api/v1/* → vollos-core-api (F-T011-1)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T20:34:16+07:00
security_checkpoint: false  # pure routing fix, no auth/secret change
domain_consultation: null
dependencies:
  - T-011 E2E surfaced F-T011-1
blocks:
  - Phase 2C Track 2 (owner manual smoke test — form submit will crash without this fix)
---

## Context

T-011 Phase 2C Track 1 E2E tests on production surfaced **HIGH finding F-T011-1**:

**Symptom:**
- `GET https://vollos.ai/api/v1/csrf` returns HTML (landing page) instead of JSON (CSRF token)
- Browser's `JSON.parse(HTML)` throws → form submit crashes → **lead capture form on production is non-functional**

**Root cause:**
- `infra/Caddyfile` `vollos.ai` block has only `file_server` + `try_files` fallback
- No `reverse_proxy` for `/api/v1/*` → lead capture API (`vollos-core-api:3001`)

**Scope:**
- Pre-existing bug (may predate RS-013 deploy) — not a regression from RS-013
- But now visible because T-011 probed it
- Must fix before Track 2 (owner manual smoke test)

## Scope

### Change — `infra/Caddyfile`

Add to `vollos.ai { ... }` block (and `www.vollos.ai { ... }` if it exists post-F-4 DNS):

```caddy
# Reverse proxy /api/v1/* to lead-capture API (host-header preserved, trusted_proxies already set globally)
handle /api/v1/* {
    reverse_proxy vollos-core-api:3001 {
        header_up X-Real-IP {http.request.header.CF-Connecting-IP}
    }
}

# Existing file_server block becomes fallback (everything else = static landing)
handle {
    root * /srv/landing
    file_server
    try_files {path} /index.html
}
```

**Order matters in Caddy** — `handle /api/v1/*` must come BEFORE the catch-all `handle` block.

### Verification (local first, then on VPS)

Local:
- `caddy validate` passes
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet` passes

VPS (after merge + pull):
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy` (no-deps to avoid cascading)
- `curl -I https://vollos.ai/api/v1/csrf` → should get JSON response (200 or 403 with JSON body), NOT HTML
- `curl -I https://vollos.ai/` → still 200 HTML landing (not broken)

## Acceptance Criteria

1. `infra/Caddyfile` has `handle /api/v1/* { reverse_proxy vollos-core-api:3001 }` in `vollos.ai` block (+ www if applicable)
2. Order correct — `handle /api/v1/*` BEFORE catch-all
3. Existing behavior preserved — landing still renders, security headers still applied
4. `caddy validate` passes
5. `docker compose config --quiet` passes (both dev + merged prod)
6. Commit to branch `fix/rs013-vollos-api-route`
7. Conventional commit
8. MR to main
9. Pipeline green
10. Self-review evidence-based (file:line)
11. Placeholder grep clean

## Deploy plan (after merge — T-012 itself stops at MR, doesn't SSH VPS)

Post-merge, DevOps (separate step or manual) SSH VPS:
```bash
cd ~/vollos-core
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
# verify
curl -fsS https://vollos.ai/api/v1/csrf
```

## Owned Files

- `infra/Caddyfile` (primary)

## Forbidden

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md`
- `apps/*/src/**`, `packages/*/src/**`
- Push to main
- Commit secret
- SSH to VPS (defer to post-merge)

## Expected Output

```yaml
task_id: T-012
status: passed | failed | blocked
branch: fix/rs013-vollos-api-route
commit_sha: <sha>
mr_iid: <N>

caddyfile_changes:
  vollos_ai_handle_api_v1_added_line: N
  vollos_ai_catch_all_block_line: N
  order_correct: true  # api handle BEFORE catch-all
  www_vollos_ai_block_present: true|false  # if yes, also has handle /api/v1/*

validation:
  caddy_validate: "Valid configuration exit 0"
  compose_config_merged: "exit 0"

post_merge_deploy_runbook: |
  cd ~/vollos-core
  git pull origin main
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
  curl -fsS https://vollos.ai/api/v1/csrf  # should return JSON, not HTML

self_review:
  ...
```

## Rules

- Read `CLAUDE.md` § D (Docker)
- Read `_workspace/T-011/output.md` F-T011-1 reasoning + recommendation
- Read `infra/Caddyfile` — know current structure before editing
- Conventional commit: `fix(infra): reverse-proxy /api/v1/* on vollos.ai for lead capture form`
- Small, focused change — should take ≤15 min

Begin.

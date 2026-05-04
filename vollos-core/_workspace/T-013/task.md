---
id: T-013
title: RS-013 Post-merge deploy — apply MR !14 Caddy routing fix on VPS + verify /api/v1/*
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T20:43:12+07:00
security_checkpoint: false
domain_consultation: null
dependencies:
  - T-012 merged (MR !14 at commit e52d6eed on main)
blocks:
  - Phase 2C Track 2 (owner Google login smoke test — form submit needs this)
---

## Context

MR !14 (T-012) merged to main. Adds `handle /api/v1/* { reverse_proxy vollos-core-api:3001 }` in Caddyfile `vollos.ai` block. Now apply on VPS + verify lead capture form works.

## 4-step plan

### 1. SSH VPS + pull + reload Caddy
```bash
ssh -i /home/ipon/.ssh/vollos_deploy_v3 [email protected]
cd ~/vollos-core
git fetch origin main
git log HEAD..origin/main --oneline  # see what's incoming (should include e52d6eed T-012)
git pull origin main
# reload Caddy ONLY (don't touch postgres/api/auth)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
# wait ~10s for new Caddy container to boot + healthcheck
sleep 15
docker compose ps caddy
```

Expected: caddy container `healthy` within 15s.

### 2. Verify /api/v1/* now reverse_proxies
**Critical test — this is the whole point of T-012:**
```bash
curl -fsS -I https://vollos.ai/api/v1/csrf 2>&1 | head -5
# Expected: Content-Type: application/json (NOT text/html)

curl -fsS https://vollos.ai/api/v1/csrf
# Expected: JSON body with CSRF token (likely {"token":"..."} or similar)
# NOT expected: HTML page content
```

If still returns HTML → routing fix didn't apply → rollback (see below).

### 3. Verify no regression
```bash
# Landing still serves
curl -fsS -I https://vollos.ai/ | head -3  # HTTP/2 200 Content-Type: text/html

# Auth service unchanged
curl -fsS https://auth.vollos.ai/health  # {"status":"ok"}
curl -fsS https://auth.vollos.ai/.well-known/jwks.json | jq '.keys[0].kid'  # "vollos-access-v1"

# No error in Caddy logs
docker compose logs --tail=30 caddy | grep -iE "error|fatal|panic" | head -5
# Expected: empty or only benign QUIC UDP buffer info

# Access log file writable (permission fix from T-009 chown still applies)
ls -la logs/caddy/access.log  # owner uid 1000
```

### 4. Cleanup + report
- No temp files to clean
- `bash history -c && history -w` (clear SSH session history just in case)

## Acceptance Criteria

1. `git pull` succeeded — local VPS HEAD matches origin/main at `e52d6eed`
2. Caddy container reloaded (new container ID vs pre-T-013) + `healthy`
3. **`curl https://vollos.ai/api/v1/csrf` returns JSON** (critical fix verified)
4. `curl https://vollos.ai/` still returns HTML 200 (no regression on landing)
5. `curl https://auth.vollos.ai/health` still returns 200 ok (auth unchanged)
6. JWKS fingerprint still matches `f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c` (RSA key untouched)
7. Caddy logs have no errors
8. postgres + vollos-api + auth-service containers NOT restarted (only caddy)
9. Access log still writable (no permission regression)

## Rollback plan (if step 2 fails)

```bash
# If new caddy container crashes or routing broken:
cd ~/vollos-core
git log --oneline -3
# find commit BEFORE e52d6eed (should be 637df7e1 — pre-T-013 main)
git checkout 637df7e1 -- infra/Caddyfile  # revert ONLY Caddyfile
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
# verify landing still serves
```

Then report failure to Lead for investigation.

## Expected Output

```yaml
task_id: T-013
status: passed | failed | rolled_back
deploy_started_at: <iso>
deploy_completed_at: <iso>

pre_deploy:
  vps_head_before: <sha>
  caddy_container_id_before: <id>

deploy:
  git_pull: "e52d6eed pulled"
  caddy_recreated: true
  caddy_container_id_after: <new_id>
  time_to_healthy_sec: N

verification:
  api_v1_csrf:
    before_hint: "was HTML 200 (T-011 F-T011-1)"
    after_response_content_type: "application/json"
    after_body_snippet: "{"token":"***"}" (redact value)
    fix_confirmed: true|false
  landing_preserved:
    url: https://vollos.ai/
    status: 200
    content_type: text/html
  auth_preserved:
    health: 200 ok
    jwks_fingerprint_matches: f345929551ef... → true
  caddy_logs_errors: 0
  other_services_untouched:
    postgres_restarted: false
    vollos_api_restarted: false
    auth_service_restarted: false
  access_log_writable: true

rollback_applied: false  # true if step 2 failed

self_review: ...
```

## Rules

- **Read `CLAUDE.md` § I (Production Safety)** — backup ก่อน migration (T-013 ไม่แตะ DB, skip)
- Read `_workspace/T-012/output.md` for changes summary + post-deploy runbook
- Read `_workspace/T-011/output.md` F-T011-1 for before-state hint
- **Never display secrets** — API responses may contain tokens (redact values, show `***`)
- Focus: **narrow fix** — only caddy container reload, not full stack restart
- Estimated AI-elapsed: ~10-15 min

Begin.

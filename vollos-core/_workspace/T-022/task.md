---
id: T-022
title: Batch deploy T-020 + T-021 (CCPA delete + rate limit) to VPS
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T23:08:35+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - MR !17 merged (CCPA)
  - MR !18 merged (rate limit)
---

## Context

MR !17 (CCPA delete fix) + MR !18 (auth rate limit) merged to main. Apply on VPS + verify.

## 4 steps

### 1. Pull + recreate api + auth (zero-downtime — --no-deps)

```bash
ssh -i /home/ipon/.ssh/vollos_deploy_v3 [email protected]
cd ~/vollos-core
git fetch origin main
git log HEAD..origin/main --oneline  # should show 2 merges
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml \
  up -d --no-deps --force-recreate vollos-api auth-service
sleep 20
docker compose ps
```

Expected: postgres + caddy untouched. api + auth recreated + healthy.

### 2. Verify T-020 CCPA — code present

```bash
grep -A 5 "CCPA" ~/vollos-core/apps/api/src/routes/deletion.ts | head -15
```
Expected: see `ipAddress: null` + `userAgent: null` in UPDATE payload.

Skip runtime delete test — needs a real lead to be created first; owner already verified during Track 2.

### 3. Verify T-021 rate limit — runtime test

```bash
# From Lead workstation (external) — hit /auth/refresh 32 times fast
for i in $(seq 1 32); do
  echo -n "$i: "
  curl -s -o /dev/null -w "%{http_code}" https://auth.vollos.ai/auth/refresh \
    -X POST -H "Content-Type: application/json" -d '{}'
  echo ""
done
```

Expected:
- First ~30 requests: 401 (no token) or 400 (bad body) — legitimate response
- After 30: **429 Too Many Requests** — rate limit kicks in
- Check `Retry-After` header on 429 response

**IMPORTANT:** this will trigger fail2ban potentially. Coordinate by:
- Run from Lead workstation (Hostinger VPS trust)
- If IP gets banned → `ssh VPS sudo fail2ban-client unban <LEAD_IP>` to recover
- Better: use X-Forwarded-For header simulating test IP (but Caddy may filter this)

### 4. Smoke tests (regression)

```bash
curl -fsS https://auth.vollos.ai/health  # 200 ok
curl -fsS https://auth.vollos.ai/.well-known/jwks.json | jq '.keys[0].kid'  # vollos-access-v1
curl -fsS https://vollos.ai/api/v1/csrf  # 200 JSON
curl -fsS https://vollos.ai/  # 200 HTML
```

All must still work (no regression).

## Acceptance Criteria

1. git pull succeeded — local VPS HEAD matches origin/main
2. api + auth recreated + healthy within 60s
3. postgres + caddy NOT restarted (zero-downtime)
4. T-020 CCPA code present on VPS (grep confirms)
5. T-021 rate limit kicks in after 30 requests — verified with curl loop + 429 response
6. Retry-After header present on 429
7. /health on auth still 200
8. JWKS fingerprint unchanged `fb83ce8ffc3d...` (RSA key untouched)
9. /api/v1/csrf still returns JSON (T-013 fix preserved)
10. No errors in container logs post-restart

## Security

- **SECRET HANDLING protocol** — never `docker compose config`, never `cat .env`, never echo secret values
- Read `feedback_secret_handling_protocol.md`
- Post-run: clear bash history on Lead workstation + VPS
- **If Lead IP gets fail2ban-banned during rate limit test** — SSH in with owner's key still works (different IP or via VPS console fallback)

## Expected Output

```yaml
task_id: T-022
status: passed | partial | failed
deploy:
  vps_head_before: <sha>
  vps_head_after: 49eb642768...
  containers_recreated: [vollos-api, auth-service]
  postgres_untouched: true (uptime X hours)
  caddy_untouched: true (uptime X hours)

t020_verification:
  ccpa_code_present: true
  grep_evidence: "apps/api/src/routes/deletion.ts:L126 — ipAddress: null, userAgent: null"

t021_verification:
  rate_limit_test_run: true
  requests_to_429: 31  # first N succeeded with 401/400, request #31 or #32 returned 429
  retry_after_header: "Retry-After: <seconds>"

smoke_regression:
  auth_health: "200 ok"
  jwks_fingerprint: fb83ce8ffc3d...
  csrf_endpoint: "200 JSON"
  landing: "200 HTML"

container_logs_errors: 0

self_review: ...
```

Begin.

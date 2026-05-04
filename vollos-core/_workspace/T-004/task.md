---
id: T-004
title: RS-013 Deploy Prep — Local Integration Test (pre-VPS runtime validation)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T17:39:28+07:00
dependencies:
  - T-003 (merged — MR !10 at commit 197b9089)
security_checkpoint: true
domain_consultation: null
blocks:
  - Phase 2B VPS apply (must pass local runtime before SSH)
---

## Context

Owner Rule (memory: `feedback_local_integration_test`):
> ทุกงานที่แตะ code / infra / docker-compose / Caddyfile / env vars — ต้องมี local integration test runtime ก่อน SSH apply บน VPS
> "ผ่าน" = ต้องได้ทั้ง 3 อย่างขั้นต่ำ: (1) docker compose up สำเร็จ + ทุก container healthy (2) curl endpoint จริง (ไม่ใช่ /health อย่างเดียว — ต้องยิง business endpoint) (3) log ไม่มี error

T-002 + T-003 delivered code + infra changes. Syntax validation passed. But **no runtime test yet**. T-004 fills this gap before VPS apply.

## Preconditions (verify before starting)

- Local repo on `main` branch at commit `197b9089` (post-T-003 merge) — if not, `git checkout main && git pull origin main`
- Docker daemon running (confirmed: Docker v29.4.0, Docker Compose v5.1.2)
- RSA test keys at `/tmp/auth-rsa-keys-20260418-165740/private.pem` + `public.pem` (still present — owner not yet uploaded to GitLab)
- Port 3001, 3004, 5432 not already in use on localhost (check `ss -tlnp` — kill conflicts first)

## Test Scope

**This is a SERVICE-level integration test** — tests postgres + vollos-api + auth-service together using the dev docker-compose (ports exposed for curl). Caddy is NOT tested here (deferred to Phase 2B on VPS with real TLS + Cloudflare).

## Test Plan (9 steps)

### Step 1 — Prepare local test .env (outside git)
- File: `/tmp/t004-test-env-<timestamp>/.env`
- Populate with:
  - `POSTGRES_USER=vollos_admin`, `POSTGRES_PASSWORD=<generate random 32 chars>`, `POSTGRES_DB=vollos_prod`
  - `AUTH_USER_PASSWORD=<random 32>`, `VOLLOS_USER_PASSWORD=<random 32>`, `ACMD_USER_PASSWORD=<random 32>`
  - `DATABASE_URL=postgres://vollos_user:<vollos_pw>@postgres:5432/vollos_prod`
  - `AUTH_DATABASE_URL=postgres://auth_user:<auth_pw>@postgres:5432/vollos_prod`
  - `AUTH_RSA_PRIVATE_KEY=<PEM content with \n escaped for single-line env var>` — read from /tmp/auth-rsa-keys-20260418-165740/private.pem, use `awk 'NF {sub(/\r/,""); printf "%s\\n",$0}'` or equivalent
  - `AUTH_RSA_PUBLIC_KEY=<PEM content with \n escaped>`
  - `AUTH_CORS_ORIGINS=http://localhost:3003`
  - `VOLLOS_AUTH_URL=http://localhost:3004`
  - `NODE_ENV=production` (test prod behavior)
  - `PORT=3001`
  - Any other env vars required by code (grep `process.env[` on auth-service + vollos-api to verify completeness)
- Permissions: 0600
- **Never display .env content** in output.md — only list key names + `***` for values

### Step 2 — Build images + start stack
- `cd /home/ipon/workspace/vollos-ai/vollos-core`
- `docker compose --env-file /tmp/t004-test-env-<ts>/.env up -d --build`
- Log build output to `/tmp/t004-test-env-<ts>/build.log`
- If build fails → `status: blocked`, copy failure snippet, stop

### Step 3 — Wait for health
- Wait up to 120 seconds, poll every 5s: `docker compose ps --format json`
- All 3 containers must show `health: healthy`
- If any container shows `unhealthy` or timeout:
  - Capture `docker compose logs <container>` last 50 lines
  - `docker compose down` (cleanup)
  - `status: failed`, report

### Step 4 — API health probes
```
curl -fsS http://localhost:3001/health | jq .
curl -fsS http://localhost:3004/health | jq .
```
Both must return `{"status":"ok"}` (or similar success). Non-200 → fail.

### Step 5 — Business endpoint probes (JWKS + unauthorized access)
```
# JWKS must serve public key
curl -fsS http://localhost:3004/.well-known/jwks.json | jq '.keys[0].kty'
# expect: "RSA"

# Public key in JWKS must match the private key we loaded
curl -fsS http://localhost:3004/.well-known/jwks.json | jq -r '.keys[0].n' | head -c 40
# compute expected from private.pem modulus — verify match (report YES/NO with fingerprint, not raw values)

# Protected endpoint without token must return 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3004/me
# expect: 401

# Endpoint with bad token must return 401 or 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer invalid.token.here" http://localhost:3004/me
# expect: 401
```

### Step 6 — Postgres users + schema verification
```
docker compose exec -T postgres psql -U vollos_admin -d vollos_prod -c "\du" | tee /tmp/t004-test-env-<ts>/users.out
```
Must list: `auth_user`, `vollos_user`, `acmd_user` (created by init-db.sh from env vars) + `vollos_admin` (superuser from POSTGRES_USER).
```
docker compose exec -T postgres psql -U vollos_admin -d vollos_prod -c "\dn"
```
Must list schemas: `auth`, `vollos`, `acmd`, `public`, etc.
```
docker compose exec -T postgres psql -U auth_user -d vollos_prod -c "\dt auth.*"
```
Login as `auth_user` must succeed (validates password + grants) and list auth tables (may be empty until migrations run).
**Verify fail-closed:** try login with old hardcoded password — must be rejected:
```
docker compose exec -T postgres psql -U auth_user -d vollos_prod -c "\q" 2>&1 << 'EOF'
devpassword123
EOF
```
Non-zero exit expected (auth failure). Report actual exit code.

### Step 7 — JWT sign + verify round-trip (optional but recommended)
If auth-service exposes an endpoint that issues a test JWT (e.g., `/auth/dev/token` in dev mode), call it and verify:
- Token header alg = `RS256`
- Token verifiable with JWKS public key (use `jwt` CLI or node one-liner)
If no such endpoint → skip this step, note in output

### Step 8 — Container log scan (error hunt)
```
docker compose logs --since 5m > /tmp/t004-test-env-<ts>/all.log
grep -iE "error|fatal|panic|unhandled|uncaught|stack trace" /tmp/t004-test-env-<ts>/all.log | grep -v "^# " | tee /tmp/t004-test-env-<ts>/errors.out
```
Must be empty OR only contain benign warnings (e.g., known deprecation notices). Explicitly list each non-empty line in output.md + classify benign vs real.

### Step 9 — Validate prod override config (merged) + cleanup
```
# Separate validation — prod config merge must strip all ports
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file /tmp/t004-test-env-<ts>/.env config > /tmp/t004-test-env-<ts>/prod-merged.yml 2>&1
grep -c "published:" /tmp/t004-test-env-<ts>/prod-merged.yml
# expect: 0

# Teardown
docker compose down -v
rm -rf /tmp/t004-test-env-<ts>/
```

## Acceptance Criteria (ALL must pass)

1. ✅ All 3 containers reach `healthy` within 120s
2. ✅ Both /health endpoints return 200 with ok status
3. ✅ JWKS serves RSA public key matching the private key used (fingerprint match)
4. ✅ Unauthorized access returns 401 (not 500 or 200)
5. ✅ All 4 DB users exist (vollos_admin, auth_user, vollos_user, acmd_user)
6. ✅ auth_user can login with test password (not `devpassword123`)
7. ✅ Old hardcoded `devpassword123` is REJECTED (proves env-driven fix is live)
8. ✅ No ERROR / FATAL / PANIC / stack traces in container logs
9. ✅ Prod config merge produces 0 published ports
10. ✅ Clean teardown — no orphan containers or volumes

## Forbidden

- Do NOT commit any test .env or build log to git
- Do NOT push anything — this task makes NO git commits
- Do NOT modify any source file
- Do NOT SSH to VPS
- Do NOT display PEM / password / env values

## Expected Output (`_workspace/T-004/output.md`)

```yaml
task_id: T-004
status: passed | failed | blocked
compose_version_used: "docker compose v5.1.2"
commit_tested: 197b9089
env_file_location: /tmp/t004-test-env-<ts>/.env (cleaned up at end)

preconditions_check:
  repo_branch_main: true|false
  repo_commit: 197b9089
  docker_running: true
  ports_free: "3001|3004|5432 all free"
  rsa_keys_present: true

step_1_env_prep:
  file_created: true
  permissions: 0600
  keys_set: [POSTGRES_USER, POSTGRES_PASSWORD, ..., AUTH_RSA_PRIVATE_KEY, AUTH_RSA_PUBLIC_KEY, ...]
  secret_values_displayed: false  # must be false

step_2_build_and_up:
  build_duration_sec: N
  images_built: [vollos-core-api, vollos-core-auth]
  up_exit_code: 0
  containers_started: [postgres, vollos-api, auth-service]

step_3_health:
  time_to_all_healthy_sec: N
  postgres_healthy: true
  vollos_api_healthy: true
  auth_service_healthy: true
  failures: []

step_4_health_endpoints:
  vollos_api_health: "200 / {status:ok}"
  auth_health: "200 / {status:ok}"

step_5_business_endpoints:
  jwks_kty: "RSA"
  jwks_public_key_matches_private: true
  public_key_fingerprint: f345929551...
  me_without_token_status: 401
  me_with_bad_token_status: 401

step_6_postgres:
  users_present: [vollos_admin, auth_user, vollos_user, acmd_user]
  schemas_present: [auth, vollos, acmd, public, ...]
  auth_user_login_with_test_password: success
  auth_user_login_with_devpassword123: rejected (exit code N)

step_7_jwt_roundtrip:
  performed: true|false (skipped if no /auth/dev/token)
  alg: RS256
  verified: true

step_8_log_scan:
  error_lines_total: N
  benign_warnings: [...]
  real_errors: [...]

step_9_prod_config_validation:
  prod_merged_config_valid: true
  published_ports_in_prod: 0

cleanup:
  containers_removed: true
  volumes_removed: true
  env_file_deleted: true
  tmp_folder_deleted: true

self_review:
  all_10_acceptance_criteria_passed:
    result: true|false
    evidence: "step-by-step pass/fail list above"
  no_secrets_displayed:
    result: true
    evidence: "no PEM, no passwords, no env values in this output.md or bash log"
  teardown_complete:
    result: true
    evidence: "docker ps -a → no orphan from this test"

ready_for_phase_2b: true|false
```

## Rules

- **Read `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` §§ D, J** before starting
- **Read `_workspace/T-002/output.md` + `_workspace/T-003/output.md`** for context
- **If step 2 build fails** → `status: blocked`, save `/tmp/t004-test-env-<ts>/build.log` path in output, stop
- **If any acceptance criterion fails** → `status: failed`, complete remaining diagnostics steps, capture container logs, then teardown
- **Always teardown** (docker compose down -v) before final status report — even on failure
- **Never display secret values** — use `***` or fingerprints / counts
- **Timestamp every step** in output.md (start_at + end_at) — Auditor may verify timing claims

Begin now. Read CLAUDE.md + context, then execute 9 steps.

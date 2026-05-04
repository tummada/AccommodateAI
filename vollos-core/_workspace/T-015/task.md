---
id: T-015
title: RS-013 Phase 2C — Deploy MR !15 (Caddy) + Run DB migrations (fix 4 owner smoke errors)
assigned_to: vollos-devops
priority: critical
status: in_progress
spawn_started_at: 2026-04-18T21:14:19+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - MR !15 merged (5e3c731e) — Caddy CSP + COOP fix
  - T-014 diagnosis: empty DB is root cause of 500 errors
blocks:
  - RS-013 DONE (owner smoke test)
---

## Context

T-014 diagnosed 4 owner smoke-test errors:

| Error | Root cause | Resolved by |
|-------|-----------|-------------|
| CSP block Google stylesheet | Caddyfile missing `accounts.google.com` in style-src | **MR !15 merged** — deploy needed |
| COOP block postMessage | Caddyfile missing explicit COOP header | **MR !15 merged** — deploy needed |
| Form 500 "Something went wrong" | `vollos.leads` table does not exist | **T-015 — run migration** |
| Google One Tap 500 | Same empty DB | **T-015 — run migration** |

Lead missed "run migrations" step in T-007 (fresh start only ran init-db.sh = schemas+users, not tables). New rule saved in memory `feedback_migrations_in_deploy.md`. This task fixes the gap.

## 3 sequential phases

### Phase A — Deploy MR !15 (Caddy reload)

```bash
ssh -i /home/ipon/.ssh/vollos_deploy_v3 [email protected]
cd ~/vollos-core
git fetch origin main
git log HEAD..origin/main --oneline  # confirm 5e3c731e incoming
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --no-deps caddy
# wait ~15s for caddy healthy
sleep 15
```

**Verify CSP + COOP applied (from Lead workstation, not VPS):**
```bash
curl -sI https://vollos.ai/ | grep -iE "content-security|cross-origin-opener"
# Expected:
# content-security-policy: ... style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com ...
# cross-origin-opener-policy: same-origin-allow-popups
```

### Phase B — Backup DB BEFORE migration (rule I1)

```bash
# On VPS, in ~/vollos-core
BACKUP_FILE="/home/ipon/backups/pre-T015-migration_$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p /home/ipon/backups
docker exec vollos-core-postgres pg_dumpall -U vollos_admin | gzip > "$BACKUP_FILE"
ls -la "$BACKUP_FILE"  # confirm > 0 bytes
```

Backup is safety net — if migrations go wrong, can restore. Keep at least 24 hours.

### Phase C — Run Drizzle migrations

**Migration files to apply:**
1. `packages/db/drizzle/0000_dashing_james_howlett.sql` — creates `vollos.leads` + audit_logs tables
2. `packages/auth-db/migrations/0000_nasty_shinko_yamashiro.sql` — auth.users + related
3. `packages/auth-db/migrations/0001_user_products.sql` — auth.user_products

**Method — DevOps choose cleanest:**

**Option A: Direct psql (simpler, uses superuser):**
```bash
# Apply vollos schema migration
cat ~/vollos-core/packages/db/drizzle/0000_dashing_james_howlett.sql \
  | docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod

# Apply auth schema migrations (order matters 0000 then 0001)
cat ~/vollos-core/packages/auth-db/migrations/0000_*.sql \
  | docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod
cat ~/vollos-core/packages/auth-db/migrations/0001_*.sql \
  | docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod
```

**Option B: Drizzle-kit inside container (proper migration tracking):**
```bash
# If pnpm + drizzle-kit available in prod image (may not be — prod images typically strip devDeps)
docker exec vollos-core-api sh -c "cd /app/packages/db && pnpm drizzle-kit migrate"
```

**Recommend Option A** — direct psql, straightforward, no devDep concerns. May need to manually INSERT into `__drizzle_migrations` table afterward so drizzle-kit thinks it's applied.

### Phase D — Verify + restart

```bash
# Verify tables exist
docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod -c "\dt vollos.*"
# Expected: leads, audit_logs (or similar — based on migration file)

docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod -c "\dt auth.*"
# Expected: users, refresh_tokens, user_products

# Restart api + auth to refresh connection pool (zero-downtime — --no-deps)
cd ~/vollos-core
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --no-deps vollos-api auth-service
sleep 20
docker compose ps  # all 4 containers healthy

# Smoke test from Lead workstation
curl -fsS https://auth.vollos.ai/health  # 200 ok
curl -fsS https://vollos.ai/api/v1/csrf  # 200 JSON
# DO NOT submit real lead form here (owner does Track 2 retest)
```

## Acceptance Criteria (ALL must pass)

1. ✅ Phase A — MR !15 deployed; curl confirms CSP has `accounts.google.com` in style-src-elem AND `cross-origin-opener-policy: same-origin-allow-popups` in response headers
2. ✅ Phase B — DB backup created, size > 0 bytes, gzip'd, located at `/home/ipon/backups/pre-T015-migration_<ts>.sql.gz`
3. ✅ Phase C — All 3 migration SQL files applied successfully (no psql errors)
4. ✅ Phase D — `\dt vollos.*` shows leads + audit_logs; `\dt auth.*` shows users + refresh_tokens + user_products
5. ✅ api + auth containers recreated (zero-downtime — no postgres/caddy restart)
6. ✅ `curl /api/v1/csrf` still returns JSON + new cookie (unchanged behavior — no regression)
7. ✅ JWKS fingerprint unchanged (`f345929551ef...`)
8. ✅ No errors in api + auth logs post-restart
9. ✅ Backup file preserved for ≥ 24 hours (delete reminder set)

## Rollback

If any phase fails:
```bash
# If migration fails mid-way → DB in inconsistent state
gunzip -c /home/ipon/backups/pre-T015-migration_<ts>.sql.gz | \
  docker exec -i vollos-core-postgres psql -U vollos_admin -d postgres
# Then restart services
```

Keep backup safe before running migrations.

## Expected Output

```yaml
task_id: T-015
status: passed | failed | rolled_back
phases_completed: [A, B, C, D]

phase_a_caddy_deploy:
  git_pulled_sha: 5e3c731e
  caddy_container_recreated: true
  csp_verified: "style-src-elem now includes accounts.google.com"
  coop_verified: "same-origin-allow-popups present"

phase_b_backup:
  file: /home/ipon/backups/pre-T015-migration_<ts>.sql.gz
  size_bytes: N
  created_at: <iso>
  retention_reminder: "delete after 24h"

phase_c_migrations:
  vollos_db_migration: "packages/db/drizzle/0000_*.sql — applied exit 0"
  auth_db_migration_0: "packages/auth-db/migrations/0000_*.sql — applied"
  auth_db_migration_1: "packages/auth-db/migrations/0001_*.sql — applied"
  drizzle_tracking_table: "manually inserted | auto-managed | skipped (document)"

phase_d_verify:
  vollos_tables: [leads, audit_logs, ...]
  auth_tables: [users, refresh_tokens, user_products]
  api_restart: success
  auth_restart: success
  postgres_untouched: true
  caddy_untouched: true
  smoke_csrf: "200 JSON"
  smoke_health_auth: "200 ok"
  jwks_fingerprint_match: true

self_review: ...
```

## Rules

- **Read `CLAUDE.md` §§ C (DB rules — schemas, migrations tracking), I (Production Safety — backup), J (Secrets), K (Code Quality)**
- **Read memory `feedback_migrations_in_deploy.md`** (the rule being learned from this incident)
- **Backup BEFORE migration** — non-negotiable
- **Never display DB content** — if smoke test outputs row data, redact
- **Zero-downtime for postgres + caddy** — only api + auth allowed to restart (via --no-deps)
- **Plain Thai summary** at end of output.md for owner — what changed, what works, what's next

Begin with Phase A.

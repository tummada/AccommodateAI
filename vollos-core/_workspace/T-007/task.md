---
id: T-007
title: RS-013 Phase 2B — VPS apply (fresh start + backup cron + smoke)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T18:38:32+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-005 merged (env_port fix)
  - T-006 done (19 CI/CD Variables in GitLab)
  - Owner uploaded AUTH_RSA keys (verified DER fingerprint matches T-002)
blocks:
  - Phase 2C (E2E test)
  - T-008 namespace migration (post-deploy)
---

## Context

All pre-work done. Code merged on main (commit `197b9089` before MR !11 merge; check latest). GitLab has 19 CI/CD Variables ready. Owner chose **fresh start** (Option B) — no data migration from old stack. Old stack `~/vollos/` on VPS will be stopped; new `~/vollos-core/` deployed fresh.

Owner's claim (verify during audit): "backup ทุกคืนอยู่แล้ว" — old monorepo cron may still be running. Check + report; do not assume.

## 3 Sub-phases

### 2B-1 — Audit + Plan (do NOT change anything yet)

SSH to VPS `187.124.244.96` with `/home/ipon/.ssh/vollos_deploy_v3`. Inspect (read-only):

- `docker ps -a` — what containers running now?
- `docker network ls` — which networks exist?
- `crontab -l` — any backup cron active?
- `ls -la ~/vollos/` — old monorepo state
- `ls -la ~/vollos-core/` — does new path exist? If yes, what's in it?
- `sudo cat /etc/caddy/Caddyfile` (or equivalent) — current Caddy config
- `systemctl status caddy` (or which Caddy runs: system / container?)
- `sudo ls /var/spool/cron/crontabs/ipon` — raw crontab
- `which caddy` — binary location
- **Check R2 for recent backups:** if R2 creds in old `~/vollos/.env` → `aws s3 ls s3://<bucket>/ --endpoint-url=<r2_endpoint>` to list recent backup files. Verify last backup timestamp < 48h ago.
- UFW rules: `sudo ufw status numbered`
- Disk free: `df -h /home`

**Output audit_summary in output.md** with all findings BEFORE making changes. Lead will review if unusual.

### 2B-2 — Deploy (fresh start)

**Step order (strict sequence):**

1. **Stop old stack gracefully:**
   - `cd ~/vollos && docker compose down` (NOT `-v` — keep data volume as safety snapshot on disk; we accept fresh in new DB)
   - Verify: `docker compose ps` returns 0 running
   - Note: DO NOT delete `~/vollos/` folder yet — owner may want to reference later

2. **Clone/pull vollos-core to `~/vollos-core/`:**
   - If folder not exists: `git clone git@gitlab.com:vollos-ai/vollos-core.git ~/vollos-core`
   - If exists: `cd ~/vollos-core && git fetch && git checkout main && git pull`
   - Verify at latest main commit (`git rev-parse HEAD`)

3. **Generate `.env` from GitLab CI/CD Variables (via API):**
   - Fetch 19 vars via `curl -H "PRIVATE-TOKEN: $VOLLOS_CLI" .../projects/81395879/variables?per_page=50`
   - **Write each to `~/vollos-core/.env`** as `KEY=VALUE` lines
   - chmod 0600 immediately after write
   - **NEVER display any value in stdout or output.md** — only list keys written
   - Also add static vars not in GitLab: `NODE_ENV=production`, `POSTGRES_USER=vollos_admin`, `POSTGRES_DB=vollos_prod`, `DATABASE_URL=postgres://vollos_user:$VOLLOS_USER_PASSWORD@postgres:5432/vollos_prod`, `AUTH_DATABASE_URL=postgres://auth_user:$AUTH_USER_PASSWORD@postgres:5432/vollos_prod`, `AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai`, `VOLLOS_AUTH_URL=https://auth.vollos.ai`
   - **Validate:** `grep -c "^[A-Z]" ~/vollos-core/.env` → ≥ 25 keys
   - **Never log the file contents**

4. **Resolve Caddy architecture decision:**
   - Read current VPS Caddyfile
   - Decide strategy:
     - **Strategy X (recommended for fresh start):** Add Caddy as docker compose service in a new `docker-compose.caddy.yml` overlay (or as part of existing prod override). Caddy joins `vollos-network`. Move system Caddy aside (stop + disable service). Use `infra/Caddyfile` directly from repo.
     - **Strategy Y (compromise):** Keep system Caddy. Revert F-1 port exposure for production — bind `127.0.0.1:3001`, `127.0.0.1:3004` (not removed). System Caddy proxies `localhost:3001/3004`. This REINTRODUCES Auditor F-1 concern but mitigates via localhost-only binding.
     - **Document chosen strategy + rationale in output.md** before execution.
   - If Strategy X: `sudo systemctl stop caddy && sudo systemctl disable caddy`. Add Caddy service to compose (image `caddy:2-alpine`, mount `infra/Caddyfile:/etc/caddy/Caddyfile:ro`, volume for `/data` + `/config`, publish `80:80` + `443:443`, join `vollos-network`).
   - If Strategy Y: add `localhost-only ports` override file; update system `/etc/caddy/Caddyfile` from `infra/Caddyfile` (copy + reload).

5. **Start new stack:**
   - `cd ~/vollos-core && docker compose -f docker-compose.yml -f docker-compose.prod.yml [-f docker-compose.caddy.yml if strategy X] up -d --build`
   - Wait up to 180s for all containers healthy (`docker compose ps`)
   - If any unhealthy → capture `docker compose logs` last 100 lines per unhealthy service → report → abort → rollback plan (start old stack)

6. **Verify on VPS (internal):**
   - `curl -fsS http://localhost:3001/health` (via host if ports bound) OR `docker exec vollos-core-api node -e "require('http').get('http://localhost:3001/health', r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))})"`
   - `curl -fsS http://localhost:3004/health`
   - `curl -fsS http://localhost:3004/.well-known/jwks.json | jq '.keys[0].kid'` → expect some kid
   - `docker compose exec -T postgres psql -U vollos_admin -d vollos_prod -c "\du"` → verify 4 users + auth schema

7. **Verify from public (external HTTPS):**
   - From Lead's workstation (not VPS): `curl -fsS https://auth.vollos.ai/health` → 200 ok
   - `curl -fsS https://auth.vollos.ai/.well-known/jwks.json | jq '.keys[0].kty'` → "RSA"
   - `curl -fsS -o /dev/null -w "%{http_code}\n" https://auth.vollos.ai/` → some status (not connection error)
   - `curl -fsS -I https://vollos.ai/` → 200 (landing still served)
   - If cloudflare/caddy mismatch → debug before proceeding

### 2B-3 — Backup cron setup + test run

1. **Copy scripts to VPS if not already:**
   - `infra/backup.sh` + `infra/monitor.sh` + `infra/setup-cron.sh` are in `~/vollos-core/infra/` already (cloned with repo)
   - Ensure executable: `chmod +x ~/vollos-core/infra/*.sh`

2. **Verify backup.sh uses new path:**
   - Check script's internal paths point to `~/vollos-core/` (not `~/vollos/`)
   - If hardcoded old path → fix in output.md `script_path_fixes` section, but do NOT commit changes in this task (scope limit)

3. **Install cron:**
   - `bash ~/vollos-core/infra/setup-cron.sh` (or equivalent)
   - `crontab -l` → verify entry: `0 8 * * * /home/ipon/vollos-core/infra/backup.sh`
   - If old cron (from ~/vollos/) still present → remove it (prevent duplicate backups)

4. **Run ONE manual backup test:**
   - `bash ~/vollos-core/infra/backup.sh` — watch output
   - Verify: local `.sql.gz` file created at `~/vollos-core/infra/backups/`
   - Verify: file uploaded to R2 (list bucket, check new timestamp)
   - Verify: Telegram message received (ask owner OR check bot API: `getUpdates`)
   - If any step fails → capture error → do NOT mark complete

### Acceptance Criteria (ALL must pass)

1. Audit summary written in output.md BEFORE any change
2. Owner's "backup ทุกคืน" claim verified or refuted (with evidence: cron entries + R2 last-mtime)
3. Old stack stopped cleanly (`docker compose ps` = 0)
4. New stack healthy (all 3+ containers = healthy within 180s)
5. `.env` on VPS chmod 0600, contains ≥ 25 keys, no values leaked in logs
6. Caddy strategy chosen + documented + working (https://auth.vollos.ai resolves through Caddy → auth-service)
7. JWKS endpoint serves RSA public key matching T-002 fingerprint (`f345929551ef...`)
8. DB has 4 users (`vollos_admin`, `auth_user`, `vollos_user`, `acmd_user`) + schemas (`auth`, `vollos`, `acmd`)
9. Old `devpassword123` rejected on new DB (proves T-003 fix live on production)
10. Backup cron installed; 1 manual test run succeeded; R2 has new file; Telegram received
11. Clean teardown of any temp files; no secrets in `docker logs` or shell history

## Safety / Rollback

- **Before step 2B-2.1 (stop old stack):** document exactly what was running + how to restart
- **If ANY step in 2B-2 fails:** stop, do NOT continue, restart old stack via `cd ~/vollos && docker compose up -d`
- **Old `~/vollos/` folder stays in place** — can be used for rollback
- **Old postgres volume stays in place** — not deleted, just unused

## Forbidden

- Do NOT delete `~/vollos/` folder
- Do NOT delete old postgres data volume
- Do NOT commit or push during this task (task is operational, not code change — exception: if script path fix needed, flag + create separate follow-up)
- Do NOT display secrets in logs/output
- Do NOT skip audit step — Lead wants audit first

## Expected Output (`_workspace/T-007/output.md`)

```yaml
task_id: T-007
status: passed | failed | rolled_back | blocked
phase_2b_started_at: <iso>
phase_2b_completed_at: <iso>

audit_summary:
  containers_running_before:
    - name: xxx
      image: xxx
      status: xxx
  networks_existing: [...]
  crontab_entries: [...]
  backup_cron_status: running|not_running|unknown
  r2_last_backup_age_hours: N
  caddy_type: system|container|none
  caddy_current_config_path: /etc/caddy/Caddyfile
  caddy_current_routes: [vollos.ai, ...]
  vollos_core_path_exists: true|false
  ufw_open_ports: [22, 80, 443, ...]
  disk_free_home_gb: N
  owner_backup_claim_verified: true|false
  backup_claim_evidence: "crontab has entry '0 8 * * *' + R2 last file 2026-04-17 08:00 UTC (21h ago)"

deployment:
  old_stack_stopped_at: <iso>
  new_repo_cloned_at: /home/ipon/vollos-core
  new_repo_commit: <sha>
  env_file_path: /home/ipon/vollos-core/.env
  env_file_permissions: "0600"
  env_file_keys_count: N
  env_file_values_displayed: false
  caddy_strategy: X | Y
  caddy_strategy_rationale: "..."
  new_stack_up_at: <iso>
  all_healthy_at: <iso>
  time_to_healthy_sec: N
  containers_started: [postgres, vollos-core-api, vollos-core-auth, caddy (if X)]

verification:
  internal:
    localhost_3001_health: "200 ok"
    localhost_3004_health: "200 ok"
    jwks_kid: <value>
    jwks_kty: "RSA"
    db_users: [vollos_admin, auth_user, vollos_user, acmd_user]
    db_schemas: [auth, vollos, acmd]
    devpassword_rejected: true
  external:
    auth_vollos_ai_health: "200 ok"
    auth_vollos_ai_jwks_fingerprint: f345929551ef...  # match T-002
    vollos_ai_landing_status: "200"

backup_setup:
  cron_installed: true
  cron_entry: "0 8 * * * /home/ipon/vollos-core/infra/backup.sh"
  old_cron_removed: true|false (if old stack had one)
  manual_test_run_exit_code: 0
  local_backup_file_created: /path/to/file.sql.gz
  local_backup_size_mb: N
  r2_upload_verified: true
  r2_new_file_key: s3://<bucket>/vollos-core_YYYYMMDD_HHMMSS.sql.gz
  telegram_notification_sent: true

rollback_state:
  old_vollos_folder_preserved: true
  old_postgres_volume_preserved: true
  rollback_command: "cd ~/vollos && docker compose up -d"

issues_encountered: [...]
deviations_from_plan: [...]

self_review:
  ...
```

## Rules

- Read `CLAUDE.md` (§ D Docker, § I Production Safety, § J Secrets) + memory feedback_no_smoke_test (MUST test business endpoint not just /health)
- Audit step is MANDATORY — do NOT skip
- Caddy strategy MUST be documented before execution
- Runtime verification MUST include external HTTPS probe (not just localhost)
- Plain Thai summary at end of output.md for owner: what changed, what works, any concerns

Begin.

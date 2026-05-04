---
id: T-010
title: RS-013 Post-Deploy — Rotate 4 DB passwords (URL-safe hex) + apply on VPS
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T19:58:24+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-007 deploy live (production running)
blocks:
  - Phase 2C E2E test (should run on clean password state)
---

## Context

T-007 deploy success BUT Auditor F-2/F-3 findings:
- **F-3 HIGH:** `auth_user` + `vollos_user` DB passwords appeared in container stderr during first-deploy crash. Logs truncated + containers recreated — passwords no longer visible — but zero-tolerance best practice says **rotate**.
- **F-2 HIGH (resolved via URL-encoding):** passwords contain `/` because generated via `openssl rand -base64 32`. Root cause: charset. Rotating with URL-safe hex generator prevents recurrence.

Owner chose Option A: rotate + fix root cause.

Saved memory: `feedback_password_url_safe.md` — all future password generation uses `openssl rand -hex 32`.

## Scope

### Step 1 — Generate 4 new passwords (URL-safe)
Use `openssl rand -hex 32` (64 hex chars = 256-bit entropy, URL-safe):
- POSTGRES_PASSWORD (superuser vollos_admin) — rotate for consistency even though not leaked
- AUTH_USER_PASSWORD (leaked — must rotate)
- VOLLOS_USER_PASSWORD (leaked — must rotate)
- ACMD_USER_PASSWORD (not leaked, not yet used, but rotate for consistency)

Save in temp file `/tmp/t010-rotation-<ts>/passwords.env` chmod 0600. Never display values in stdout or output.md — only sha256 first-8 fingerprints.

### Step 2 — Update GitLab CI/CD Variables via API
For each password: PUT to `https://gitlab.com/api/v4/projects/81395879/variables/<KEY>` with new value, `masked: true`, `protected: true`. If API rejects masked (hex 64-char should always pass) → report + retry without mask (unlikely for pure hex).

Verify via GET after update — each var should show:
- `masked: true`
- `protected: true`
- Value length 64 (hex)

### Step 3 — Apply on VPS (SSH)
**zero-downtime approach:**
1. SSH VPS `187.124.244.96` with `/home/ipon/.ssh/vollos_deploy_v3`
2. Fetch updated .env from GitLab (same method as T-007 original):
   ```bash
   cd ~/vollos-core
   # Back up old .env just in case
   cp .env .env.backup-$(date -Iseconds)
   chmod 0600 .env.backup-*
   # Regenerate .env from GitLab CI/CD Variables
   # (script same as T-007 — use VOLLOS_CLI PAT + API)
   ```
3. **ALTER USER** on postgres (zero-downtime — running connections stay):
   ```bash
   # Use OLD POSTGRES_PASSWORD (from .env.backup) to connect, then ALTER all users
   docker exec -i vollos-core-postgres psql -U vollos_admin -d vollos_prod <<EOF
   ALTER USER auth_user WITH PASSWORD '$NEW_AUTH_USER_PASSWORD';
   ALTER USER vollos_user WITH PASSWORD '$NEW_VOLLOS_USER_PASSWORD';
   ALTER USER acmd_user WITH PASSWORD '$NEW_ACMD_USER_PASSWORD';
   ALTER USER vollos_admin WITH PASSWORD '$NEW_POSTGRES_PASSWORD';
   EOF
   ```
   **NEVER display new passwords in echo/output** — use shell variables expanded inline only.
4. Restart auth-service + vollos-api (they cache DATABASE_URL):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate auth-service vollos-api
   ```
5. **DO NOT restart postgres** — already running with new passwords (ALTER USER is live). Restart would unnecessarily drop connections.

### Step 4 — Verify
- `curl http://localhost:3001/health` (on VPS) → 200 OK
- `curl http://localhost:3004/health` → 200 OK
- Check logs: `docker compose logs --tail=30 auth-service vollos-api` → no ECONNREFUSED, no auth errors
- **Critical verify:** login to DB as auth_user with OLD password → must fail (proves ALTER took effect):
  ```bash
  docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c "\q" 2>&1 <<<'<OLD_AUTH_USER_PASSWORD>'
  # expect exit code non-zero (password auth failed)
  ```
- External probe: `curl https://auth.vollos.ai/.well-known/jwks.json` from Lead workstation → still 200 OK with same fingerprint `f345929551ef...`

### Step 5 — Cleanup
- Delete `/tmp/t010-rotation-<ts>/`
- Delete VPS `.env.backup-*` (security — contains old passwords) OR move to encrypted archive
  - **Recommendation:** keep backup 24h for rollback safety, then delete
- Shell history on VPS: `history -c && history -w` (clears current session — bash history)

## Acceptance Criteria

1. 4 new passwords generated via `openssl rand -hex 32` (64 hex chars each)
2. GitLab CI/CD Variables updated (all 4) via API — verified via GET
3. No passwords displayed in stdout, output.md, or bash history visible to owner
4. VPS `.env` regenerated — new values; old `.env.backup-*` chmod 0600
5. `ALTER USER` executed on all 4 DB users (verified via password auth test: old password fails, new password works)
6. auth-service + vollos-api recreated + healthy + no login errors in logs
7. postgres NOT restarted (zero-downtime)
8. External HTTPS probe still works (production didn't break)
9. Temp files cleaned up
10. No secrets in output.md (fingerprints only)

## Security Hard Rules

- **NEVER display password values** — PEM, plain text, environment file contents. Use `***` or sha256 first-8 fingerprints.
- **Use shell variable expansion inline** — avoid `echo $NEW_PASSWORD` or `cat passwords.env`
- **psql heredoc** must use shell var expansion, not echo the literal password
- **Bash history cleared** at end
- **Do NOT commit anything** to git — this is operational, not code change
- **Rollback plan:** if ANY step fails mid-way:
  - Restore `.env.backup-*` → old state
  - Revert GitLab Variables (old values still accessible if DevOps kept temp backup — or re-generate)
  - **Important:** if passwords in GitLab changed but ALTER USER not yet done → services use old DATABASE_URL (stale cache) until restart, but fresh connections will fail. Brief downtime window.

## Expected Output

```yaml
task_id: T-010
status: passed | failed | rolled_back | blocked
rotation_method: "openssl rand -hex 32 (64 hex chars, URL-safe)"
passwords_rotated:
  - name: POSTGRES_PASSWORD
    old_fingerprint_sha256_first8: <hex>
    new_fingerprint_sha256_first8: <hex>
    gitlab_updated: true
    db_alter_user_applied: true
  - name: AUTH_USER_PASSWORD
    ...
  (4 total)

gitlab_api:
  method: PUT
  variables_updated: 4
  all_masked: true
  all_protected: true

vps_changes:
  env_file_regenerated: true
  env_backup_created: "/home/ipon/vollos-core/.env.backup-<iso>"
  alter_user_executed: 4
  services_recreated: [auth-service, vollos-api]
  postgres_restarted: false

verification:
  old_password_rejected: true  # security proof
  new_password_accepted: true
  containers_healthy_after_restart: true
  external_https_still_works: true
  jwks_fingerprint_unchanged: f345929551ef...

cleanup:
  tmp_folder_deleted: true
  env_backup_disposition: "kept 24h / deleted now"
  bash_history_cleared: true

self_review: ...
```

## Rules

- Read `CLAUDE.md` §§ J (Secrets), I (Production Safety)
- Read `~/.claude/CLAUDE.md` § SECURITY (never display secrets)
- Read `_workspace/T-007/output.md` (F-2 + F-3 findings context)
- Read memory `feedback_password_url_safe.md` for hex convention
- **Zero-downtime** is a goal — postgres runs throughout, only auth-service + vollos-api recreated
- **Double-check** old password rejection at step 4 — this proves rotation actually took effect (not just changed in file)

Begin.

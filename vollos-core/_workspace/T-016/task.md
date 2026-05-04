---
id: T-016
title: RS-013 Post-incident — Rotate internal secrets (RSA + 4 DB + UNSUBSCRIBE) after I-T015-1 exposure
assigned_to: vollos-devops
priority: critical
status: in_progress
spawn_started_at: 2026-04-18T21:42:54+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-015 done (migrations applied, production stable)
  - I-T015-1 finding — secrets exposed in agent stdout/transcript via `docker compose config caddy`
blocks:
  - T-017 (apply rotated external values after owner finishes Google/Telegram/R2 rotation)
---

## Context

T-015 Phase A incident I-T015-1: `docker compose config caddy` resolved env vars → displayed 8 secrets in agent stdout + transcript. Owner chose Option A (rotate ALL). This task rotates the 6 internal secrets that AI can handle. Owner rotates 4 external secrets (Google client secret, Google refresh token, Telegram bot token, R2 keys) in parallel via web UIs.

## Scope — 6 internal secrets

| # | Variable | Method |
|---|----------|--------|
| 1 | AUTH_RSA_PRIVATE_KEY | `openssl genpkey` RSA 4096 — write to `/tmp/t016-rsa-<ts>/private.pem` (0600) |
| 2 | AUTH_RSA_PUBLIC_KEY | derived from private → `/tmp/t016-rsa-<ts>/public.pem` (0644) |
| 3 | POSTGRES_PASSWORD | `openssl rand -hex 32` (URL-safe — per `feedback_password_url_safe.md`) |
| 4 | AUTH_USER_PASSWORD | `openssl rand -hex 32` |
| 5 | VOLLOS_USER_PASSWORD | `openssl rand -hex 32` |
| 6 | ACMD_USER_PASSWORD | `openssl rand -hex 32` |
| 7 | UNSUBSCRIBE_SECRET | `openssl rand -hex 32` |

## 3 Phases

### Phase A — Generate + Upload to GitLab

1. Generate 4 passwords + UNSUBSCRIBE_SECRET (hex 32 bytes = 64 chars, URL-safe)
2. Generate RSA 4096 key pair → save `/tmp/t016-rsa-<ts>/` (0600/0644)
3. Upload via GitLab API PUT to existing variables:
   - POST/PUT `/projects/81395879/variables/<KEY>`
   - masked=true, protected=true for passwords + UNSUBSCRIBE_SECRET
   - masked=false, protected=true for AUTH_RSA_* (PEM multi-line — can't mask)
4. Verify via GET — all values updated (sha256 fingerprint should differ from pre-rotation)

**⚠️ AUTH_RSA_PRIVATE_KEY upload via API:**
- Task T-002 said "owner uploads RSA manually" because of multi-line PEM + masking issue
- But this is rotation → time-sensitive, AI can upload with `masked: false, protected: true`
- Accept the mask-none risk (locally contained) — same policy as before

### Phase B — Apply on VPS (zero-downtime)

**Critical: use `--no-deps` this time (lesson from T-010 blip)**

1. SSH VPS, pull new .env from GitLab CI/CD Variables
2. Update VPS `/home/ipon/vollos-core/.env` (chmod 0600, backup previous as `.env.backup-<iso>`)
3. ALTER USER on running postgres (all 4 passwords):
   ```sql
   ALTER USER vollos_admin WITH PASSWORD '$NEW_POSTGRES';
   ALTER USER auth_user WITH PASSWORD '$NEW_AUTH_USER';
   ALTER USER vollos_user WITH PASSWORD '$NEW_VOLLOS_USER';
   ALTER USER acmd_user WITH PASSWORD '$NEW_ACMD_USER';
   ```
4. **Key insight:** POSTGRES_PASSWORD env var change triggers postgres recreate in compose — AVOID by using `--no-deps`:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml \
     up -d --no-deps --force-recreate auth-service vollos-api
   ```
   This will restart auth + api (picks up new DATABASE_URL + AUTH_RSA_*) but NOT postgres.

### Phase C — Verify + Cleanup

1. **Service health:**
   - `curl https://auth.vollos.ai/health` → 200 OK
   - `curl https://auth.vollos.ai/.well-known/jwks.json | jq '.keys[0].kid'` → has kid (value may differ — that's expected)
   - **Record new JWKS DER-SPKI fingerprint** (sha256) — replaces `f345929551ef...` as new baseline
2. **Password rotation proof:**
   - Attempt login with OLD auth_user password → must FAIL
   - Login with NEW password → must SUCCEED
3. **Logs:** no errors post-restart in auth-service + vollos-api
4. **Cleanup:**
   - Delete `/tmp/t016-rsa-<ts>/` after owner instruction (if OK to rotate away the pub key upload staging files)
   - Actually: keep locally for Phase C verification, then delete at task end
   - Delete VPS `/tmp/t016-*` temp files if created
   - Clear bash history: `history -c && history -w`
5. **Delete old transcript** that leaked secrets:
   - `/tmp/claude-1000/-home-ipon-workspace-vollos-ai-vollos-core/96b79b4c-992c-44b1-a7b0-ac8daac5eb71/tasks/a83977b05ab9ae290.output` (T-015 transcript)
   - `/tmp/claude-1000/-home-ipon-workspace-vollos-ai-vollos-core/96b79b4c-992c-44b1-a7b0-ac8daac5eb71/tasks/a21c064785b46c842.output` (T-014 transcript — may contain SSH output with secrets)
6. **Backup old passwords file** — delete `.env.backup-*` on VPS after 24h

## Acceptance Criteria (10)

1. 7 secrets rotated (2 RSA + 4 DB passwords + 1 unsubscribe), all in GitLab, verified via GET
2. VPS .env updated (chmod 0600, new values, no secrets in stdout/logs)
3. ALTER USER executed on all 4 DB users (live postgres, no restart)
4. auth-service + vollos-api recreated via `--no-deps` (postgres + caddy NOT restarted)
5. Old DB password rejected (security proof); new password accepted
6. JWKS serves RSA key with NEW fingerprint (recorded in output.md); old fingerprint `f345929551ef...` no longer served
7. /health endpoints still 200 OK
8. No errors in container logs post-restart
9. Transcript files from T-014 + T-015 deleted from /tmp
10. No secret values displayed in output.md (fingerprints only)

## Security Hard Rules

- Never `docker compose config` (use raw YAML reads or `--no-interpolate`) — feedback rule active
- Never `echo` / `cat` env values
- psql use stdin + `--set :'VAR'` for password substitution (not cmdline)
- `--no-deps` MANDATORY — lesson T-010
- Bash history clear at end on both Lead workstation + VPS

## Expected Output

```yaml
task_id: T-016
status: passed | failed | rolled_back
rotation_summary:
  total_secrets_rotated: 7
  names: [AUTH_RSA_PRIVATE_KEY, AUTH_RSA_PUBLIC_KEY, POSTGRES_PASSWORD, AUTH_USER_PASSWORD, VOLLOS_USER_PASSWORD, ACMD_USER_PASSWORD, UNSUBSCRIBE_SECRET]
  fingerprints:
    # sha256 first-8 only, never display values
    AUTH_RSA_PUBLIC_KEY_old: f345929551ef (baseline from T-002)
    AUTH_RSA_PUBLIC_KEY_new: <new>
    (others: show old_fp vs new_fp for audit trail)

gitlab_upload:
  method: "PUT /projects/81395879/variables/<KEY>"
  all_201_or_200: true
  masked_count: 5  # passwords + unsubscribe
  unmasked_count: 2  # RSA PEM (multi-line)
  all_protected: true

vps_apply:
  env_file_updated: true
  alter_user_executed: 4
  services_recreated: [auth-service, vollos-api]
  postgres_untouched: true
  caddy_untouched: true

verification:
  old_password_rejected: true
  new_password_accepted: true
  jwks_fingerprint_new: <sha256>
  jwks_kid_still_present: "vollos-access-v1" (or similar)
  health_auth: "200 ok"
  health_api: "200 ok"
  container_logs_clean: true

cleanup:
  tmp_rsa_deleted: true
  tmp_t015_transcript_deleted: true
  tmp_t014_transcript_deleted: true
  vps_env_backup_created: /home/ipon/vollos-core/.env.backup-<iso>
  bash_history_cleared: true

self_review:
  ...
```

## Rules

- Read `CLAUDE.md` §§ I (Production Safety), J (Secrets)
- Read memory `feedback_password_url_safe.md`, `feedback_docker_compose_config_secrets.md`, `feedback_migrations_in_deploy.md`
- Owner will rotate 4 EXTERNAL secrets (Google client secret, Google refresh token, Telegram bot token, R2 keys) in parallel via web UIs — not this task's scope
- After T-016 + owner external rotation → T-017 will apply new external values
- Estimated AI-elapsed: 30-45 min

Begin.

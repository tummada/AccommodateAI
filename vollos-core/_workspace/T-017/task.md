---
id: T-017
title: RS-013 Post-rotation — Apply 5 external secrets on VPS + verify ALL services working
assigned_to: vollos-devops
priority: critical
status: in_progress
spawn_started_at: 2026-04-18T22:12:19+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-016 done (7 internal secrets rotated, applied on VPS)
  - Owner rotated 5 external secrets in GitLab (GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, TELEGRAM_BOT_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
blocks:
  - RS-013 DONE (owner Track 2 re-test)
---

## Context

Owner completed external rotation. All 5 external secrets updated in GitLab CI/CD Variables. Now apply on VPS + **thorough end-to-end verification** so owner retest can proceed confidently.

## 3 phases

### Phase A — Regenerate VPS .env from GitLab

1. SSH VPS
2. Backup current `.env` → `.env.backup-T017-<iso>` (chmod 0600)
3. Fetch ALL 19 variables from GitLab API (may need 20+ with aux vars)
4. Write new `.env` (chmod 0600, atomic write)
5. Verify new `.env` contains 5 updated external values (via sha256 fingerprint comparison against expected new values — fingerprints from T-016 output for internal, fresh fetch for external)
6. **DO NOT** display values in stdout or output.md

### Phase B — Restart services with new secrets

```bash
cd ~/vollos-core
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml \
  up -d --no-deps --force-recreate auth-service vollos-api
sleep 20
docker compose ps
```

All 4 containers must stay healthy. postgres + caddy NOT restart.

### Phase C — Verify ALL services end-to-end

**C-1 — HTTPS + health:**
- `curl -fsS https://auth.vollos.ai/health` → 200 ok
- `curl -fsS https://vollos.ai/api/v1/csrf` → 200 JSON
- `curl -fsS https://vollos.ai/` → 200 HTML

**C-2 — JWKS new baseline match (post-T-016 rotation):**
- Fetch `https://auth.vollos.ai/.well-known/jwks.json`
- Compute DER-SPKI SHA256 of public key
- Expected: `fb83ce8ffc3d8218d981c25d88118c282f08c3d27ff70ea5bb29bc9a588169f8` (new baseline from T-016)
- MUST match (validates RSA rotation took effect)

**C-3 — Lead capture form (test Turnstile + DB + Email):**
- POST `https://vollos.ai/api/v1/leads` with a test payload:
  ```json
  {
    "name": "T-017 Test",
    "email": "[email protected]",
    "company": "T-017 Verification"
  }
  ```
  (With CSRF token + cookie chain — see apps/landing for actual submit flow)
- Expected: 200 with success response
- **But CSRF + Turnstile will block direct curl** — this might not be verifiable via pure curl
- **Alternative:** check auth-service logs after first real submission, see no 500 error
- **Safer:** just probe the endpoint responds (400 or similar is OK, not 500)
- If 500 → rotation issue → FLAG

**C-4 — Google OAuth flow (test CLIENT_SECRET + REFRESH_TOKEN):**
- Check auth-service logs during startup — Google OAuth client init should succeed (no error about invalid client_secret)
- Check vollos-api logs — Gmail transport (Nodemailer OAuth2) should succeed init
- Look for log line like "Gmail transport ready" or similar
- If "401 invalid_client" or "invalid_grant" → REFRESH_TOKEN or CLIENT_SECRET issue

**C-5 — Telegram — Send test notification:**
```bash
# On VPS, using new TELEGRAM_BOT_TOKEN from .env
source .env
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=T-017 verification: Telegram token rotation working. $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  | jq '.ok'
# Expected: true
```

**C-6 — R2 backup — Manual backup.sh run:**
```bash
bash ~/vollos-core/infra/backup.sh
# Expected outputs:
# - Local backup file created at ~/vollos-core/infra/backups/
# - "Uploading to R2..." → success (new credentials work)
# - "Telegram notified..." → success
# Check R2 bucket (via CLI or output): new file timestamp
```

**C-7 — Old RSA JWT rejection (proof of rotation):**
- Attempt to curl a protected endpoint with a dummy JWT signed by OLD RSA private key (if we have it cached from T-002 — we don't, it's shredded)
- Alternative: just verify current JWKS cert fingerprint matches NEW baseline (done in C-2)
- Skip if no old JWT available → C-2 already proves rotation

## Acceptance Criteria (ALL must pass for `status: passed`)

1. Phase A — .env updated, chmod 0600, backup created
2. Phase B — auth + api recreated, all 4 containers healthy, postgres + caddy NOT restarted
3. C-1 — all 3 external HTTPS endpoints healthy
4. C-2 — JWKS fingerprint matches NEW baseline `fb83ce8ffc3d...`
5. C-3 — lead capture endpoint responds (200 success OR 400 validation, NOT 500)
6. C-4 — no Google OAuth auth errors in logs post-restart
7. C-5 — Telegram notification sent successfully (`ok: true` in API response)
8. C-6 — Backup script run success, new R2 file uploaded, Telegram notification received
9. No secrets displayed in output.md (fingerprints only)
10. Clean output — no errors in any container logs post-restart

## Security Hard Rules

- Never `docker compose config` without `--no-interpolate` (feedback_docker_compose_config_secrets.md)
- Never `cat .env` or `echo $VAR` that resolves secret
- Use `sed 's/=.*/=***/'` for displaying env var names
- psql heredoc with shell expansion
- `--no-deps` MANDATORY
- Bash history cleared at end

## Expected Output

```yaml
task_id: T-017
status: passed | partial | failed

phase_a_env_update:
  backup_file: /home/ipon/vollos-core/.env.backup-T017-<iso>
  env_chmod: 0600
  external_fingerprints_updated:
    GOOGLE_CLIENT_SECRET: <new sha256 first-8>
    GOOGLE_REFRESH_TOKEN: <new>
    TELEGRAM_BOT_TOKEN: <new>
    R2_ACCESS_KEY_ID: <new>
    R2_SECRET_ACCESS_KEY: <new>

phase_b_restart:
  auth_api_recreated: true
  postgres_untouched: true (uptime: X hours)
  caddy_untouched: true

phase_c_verify:
  c1_https_health: passed
  c2_jwks_fingerprint_match: true  # matches fb83ce8ffc3d...
  c3_lead_endpoint_response: <status code, not 500>
  c4_google_oauth_no_errors: true
  c5_telegram_test: "ok: true, message_id: <N>"
  c6_backup_test:
    exit_code: 0
    r2_file_new: true (timestamp after T-017 start)
    telegram_notification_received: true
  c7_old_rsa_jwt_rejected: n/a (no old JWT available)

container_logs_summary:
  auth_service_errors: 0
  vollos_api_errors: 0

cleanup:
  bash_history_cleared: true
  backup_retention: "delete after 24h"

ready_for_owner_track2_retest: true | false
plain_thai_summary_for_owner: "..."

self_review: ...
```

## Rules
- Read CLAUDE.md §§ I, J, K
- Read T-016 output.md (internal rotation context + fingerprints)
- This is THE verification step — owner test next, must be trustworthy
- If ANY verification step fails → status: partial or failed + clear description of what's broken

Begin.

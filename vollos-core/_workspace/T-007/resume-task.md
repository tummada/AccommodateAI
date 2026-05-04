---
id: T-007 (resume)
title: RS-013 Phase 2B RESUME — VPS deploy fresh start + backup cron + external smoke
assigned_to: vollos-devops
priority: high
status: in_progress
resumed_at: 2026-04-18T19:37:00+07:00
dependencies:
  - T-008 merged (MR !12) — CF Origin Cert + Caddy service
  - T-009 merged (MR !13) — hardening + resource limits + log mount
  - T-007 audit (pre-work) — all findings resolved
blocks:
  - Phase 2C E2E test
---

## Context

T-007 was paused at Phase 2B-1 audit (done). Blocker (TLS mode + 4 hardening findings) now resolved via MR !12 + MR !13 (both merged to main).

Main at commit `637df7e1` (post-MR!13 merge).

**Owner chose Option B:** fresh start — no data migration. Old `~/vollos/` stack stopped; new `~/vollos-core/` deployed fresh.

## Resume from Phase 2B-2 + 2B-3

Full 2B-2 + 2B-3 steps + acceptance criteria remain in original `_workspace/T-007/task.md`. This resume spec adds deploy-time additions from Auditor + DevOps feedback.

## Critical additions from T-008/T-009 audits

### Before `docker compose up -d` on VPS:

1. **Caddy runs as UID 1000** (hardening T-009) — cert files + log dir must be owned 1000:1000:
   ```bash
   # On VPS, AFTER copying certs from ~/vollos/infra/certs/ to ~/vollos-core/infra/certs/
   cd ~/vollos-core
   sudo chown 1000:1000 infra/certs/cloudflare.pem infra/certs/cloudflare.key
   sudo chown 1000:1000 logs/caddy/
   chmod 0600 infra/certs/cloudflare.key
   chmod 0644 infra/certs/cloudflare.pem
   ```

2. **Copy cert files from old monorepo location:**
   ```bash
   cp ~/vollos/infra/certs/cloudflare.pem ~/vollos-core/infra/certs/
   cp ~/vollos/infra/certs/cloudflare.key ~/vollos-core/infra/certs/
   ```

3. **fail2ban integration (after first Caddy boot generates access.log):**
   - Update `/etc/fail2ban/jail.local` `caddy-auth` jail `logpath` to:
     `/home/ipon/vollos-core/logs/caddy/access.log`
   - `sudo systemctl reload fail2ban`
   - Document in output.md

### 2B-2 Deploy command (updated for merged compose overlays):

```bash
cd ~/vollos-core
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Expected services after boot: postgres, vollos-core-api, vollos-core-auth, vollos-core-caddy (4 containers)

### 2B-3 Backup cron (already cover in original task.md):

- Remove old `~/vollos/infra/backup.sh` cron entry (if present) to prevent duplicate backups
- Install new cron pointing to `~/vollos-core/infra/backup.sh`
- Run 1 manual test → verify R2 has NEW file (ไม่ทับของเดิม, timestamp ใหม่) + Telegram ได้ข้อความ

## Audit has ALREADY BEEN DONE

2B-1 audit is complete. Findings in `_workspace/T-007/output.md`. SKIP re-audit — proceed to 2B-2 execution.

## All other acceptance criteria

Remain as in `_workspace/T-007/task.md` § Acceptance Criteria (11 items).

## Expected additional output fields

Append to existing `_workspace/T-007/output.md` (or write new sections):

```yaml
phase_2b_2_resumed_at: <iso>
cert_copy_from_to: "~/vollos/infra/certs/ → ~/vollos-core/infra/certs/"
chown_applied:
  - "infra/certs/cloudflare.pem 1000:1000"
  - "infra/certs/cloudflare.key 1000:1000 0600"
  - "logs/caddy/ 1000:1000"
fail2ban_jail_updated: true|false
fail2ban_jail_logpath_new: "/home/ipon/vollos-core/logs/caddy/access.log"
```

## Rules
- Follow Owner rule `feedback_no_smoke_test` — external HTTPS probe + JWKS fingerprint match MANDATORY
- Follow Owner rule `feedback_done_means_actually_works` — deploy "done" = browser can actually reach `https://auth.vollos.ai/.well-known/jwks.json` from external
- Never display secrets — .env on VPS must be chmod 0600 without echoing contents
- Backup cron test must verify R2 has NEW file (not pre-existing) + Telegram actually fired (check via bot API `getUpdates`)
- Rollback plan ready: `cd ~/vollos && docker compose up -d` if anything fails

Begin. Read original task.md + this resume-task.md + T-008/T-009 output.md context.

---
id: T-006
title: RS-013 Deploy Prep — Transfer R2+Telegram creds + Generate passwords → GitLab CI/CD Variables
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T18:19:49+07:00
dependencies:
  - T-005 merged (MR !11)
security_checkpoint: true  # handling secrets (passwords, API keys, tokens)
domain_consultation: null
blocks:
  - Phase 2B VPS apply (needs all secrets in GitLab CI/CD before pipeline deploys can use them)
---

## Context

Before Phase 2B can deploy to VPS:
1. GitLab CI/CD Variables (vollos-core project) must contain all secrets that pipeline injects into VPS .env
2. Owner approved path A: SSH old VPS `~/vollos/.env` to extract existing R2 + Telegram creds (no re-create needed)
3. Lead must generate 5 passwords via cryptographic random (openssl)
4. Upload all to GitLab via API using `VOLLOS_CLI` PAT (scope=api, active, expires 2027-04-17)

## Access Resources

- **VPS:** IP `187.124.244.96`, user `ipon`, key `/home/ipon/.ssh/vollos_deploy_v3` (confirmed per memory `project_vps_access`)
- **GitLab PAT:** `VOLLOS_CLI` in `/home/ipon/workspace/vollos/.env` (scope=api, verified)
- **GitLab project:** vollos-core, id `81395879`, namespace `vollos-ai`
- **Old VPS .env location:** `/home/ipon/vollos/.env` (absolute path on VPS)

## Secrets to Handle

### Group A — Extract from old VPS `~/vollos/.env` (DO NOT re-generate — owner already has them)
Names required by `infra/backup.sh` + `infra/monitor.sh`:
1. `R2_ACCESS_KEY_ID`
2. `R2_SECRET_ACCESS_KEY`
3. `R2_BUCKET_NAME`
4. `R2_ENDPOINT`
5. `TELEGRAM_BOT_TOKEN`
6. `TELEGRAM_CHAT_ID`

Also check + transfer if present:
7. `GOOGLE_CLIENT_ID` (auth-service OAuth)
8. `GOOGLE_CLIENT_SECRET`
9. `GOOGLE_REFRESH_TOKEN`
10. `GMAIL_USER` (SMTP sender)
11. `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile)
12. `SMTP_*` (if any — check file)

If old .env missing any of #1-6 → `status: failed` on that var + report to Lead for owner decision (do we create new?)
If old .env missing #7-12 → note as `absent_in_old_env` (may be OK — feature not yet used)

### Group B — Generate new via `openssl rand -base64 32` (32 chars cryptographic random)
13. `POSTGRES_PASSWORD` — superuser password used by init-db.sh on first-run
14. `AUTH_USER_PASSWORD` — DB user for auth-service
15. `VOLLOS_USER_PASSWORD` — DB user for vollos-api
16. `ACMD_USER_PASSWORD` — DB user for future acmd deploy
17. `UNSUBSCRIBE_SECRET` — HMAC signing secret for email unsubscribe tokens

### Group C — Owner uploads manually (NOT in scope of T-006)
- `AUTH_RSA_PRIVATE_KEY` — multi-line PEM, can't mask via API (owner uploads via web UI)
- `AUTH_RSA_PUBLIC_KEY` — same

## Acceptance Criteria

1. **SSH extract** — read `/home/ipon/vollos/.env` on VPS, parse key-value pairs, identify which Group A keys exist
2. **Password gen** — 5 Group B passwords generated via `openssl rand -base64 32`, each stored in `/tmp/t006-creds-<ts>/passwords.env` (chmod 0600)
3. **Upload via API** — POST to `https://gitlab.com/api/v4/projects/81395879/variables` for each variable:
   - `key` = variable name
   - `value` = the secret
   - `masked` = true
   - `protected` = true
   - `environment_scope` = `*` (all environments)
   - `variable_type` = `env_var`
4. **Verify** — GET `/variables` list after all POSTs → must contain all 17 keys (or all that existed; missing flagged separately)
5. **Masking check** — for each uploaded var, attempt `masked: true`. If API rejects (value fails mask regex) → retry with `masked: false, protected: true` + flag in output
6. **Cleanup** — delete `/tmp/t006-creds-<ts>/` after verification
7. **Gap report** — explicit list of any Group A keys MISSING from old VPS .env
8. **No values displayed** — output.md must show only: var names, SHA256 fingerprint first 8 chars, masked/protected flags, and upload status. Never full values.

## Security Hard Rules

- **SSH read-only** — only `cat`, `grep` on `/home/ipon/vollos/.env`. NO writes, NO destructive commands
- **Never print PEM / password / token values** in stdout or output.md (use `***` + sha256 prefix)
- **Never `cat` or `read` `.env` file on local (this workstation)** — .env may have different secrets; not your territory
- **Temp files** at `/tmp/t006-creds-<ts>/` chmod 0600, owned by current user, cleaned up at end
- **If API upload fails** mid-way → capture which vars uploaded and which did not; do NOT retry blindly (may create duplicates). Report incomplete list to Lead.
- **Do NOT commit anything** to git — this task makes no commits, no MR
- **Do NOT modify any source file**

## Forbidden Files

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md`
- `apps/*/src/**`, `packages/*/src/**`
- Any file on VPS other than reading `/home/ipon/vollos/.env`
- `.env` on this workstation (don't read)

## Expected Output (`_workspace/T-006/output.md`)

```yaml
task_id: T-006
status: passed | partial | failed | blocked

ssh_extraction:
  host: 187.124.244.96
  user: ipon
  file_read: /home/ipon/vollos/.env
  total_keys_in_file: N
  keys_found:
    - name: R2_ACCESS_KEY_ID
      present: true
      value_sha256_prefix: abc12345
    - name: R2_SECRET_ACCESS_KEY
      ...
  keys_missing:
    - GOOGLE_CLIENT_ID (example — if not in old .env)

password_generation:
  method: "openssl rand -base64 32"
  passwords_generated: 5
  names: [POSTGRES_PASSWORD, AUTH_USER_PASSWORD, VOLLOS_USER_PASSWORD, ACMD_USER_PASSWORD, UNSUBSCRIBE_SECRET]
  # NEVER list values — only count + fingerprints
  fingerprints:
    POSTGRES_PASSWORD: "sha256:def45678"
    ...

gitlab_upload:
  project_id: 81395879
  project_path: vollos-ai/vollos-core
  variables_uploaded:
    - key: R2_ACCESS_KEY_ID
      masked: true
      protected: true
      status: "201 Created"
      source: "old_vps"
    - key: POSTGRES_PASSWORD
      masked: true
      protected: true
      status: "201 Created"
      source: "generated"
    - ...
  variables_failed: []  # if any 409/4xx/5xx
  variables_masked_false: []  # if API rejected masking (e.g. special chars)

verification:
  api_list_count: 17  # or whatever total
  cross_check_uploaded_vs_intended: match | mismatch (with detail)

gap_report:
  critical_missing:  # must fix before Phase 2B
    - key: NAME
      reason: "not in old VPS .env, required by backup.sh"
      recommendation: "owner must create + upload via web UI"
  non_critical_missing:  # feature not yet in use
    - key: GOOGLE_CLIENT_ID
      reason: "not in old VPS .env, OAuth feature not used in old deploy"

cleanup:
  tmp_folder_deleted: true
  final_state: "no secret files on local workstation"

self_review:
  all_acceptance_criteria_met:
    result: true|false
    evidence: "..."
  no_secrets_leaked_in_output:
    result: true
    evidence: "grep output.md for any value looking like random 32-char base64 string → 0 matches beyond intentional sha256 prefixes"
  cleanup_complete:
    result: true
    evidence: "ls /tmp/t006-creds-* → no results"
```

## Rules

- **Read first:**
  1. `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` § J (Secret Management J1-J3)
  2. Global `~/.claude/CLAUDE.md` § SECURITY (never display secrets rule)
  3. `/home/ipon/workspace/vollos-ai/vollos-core/infra/backup.sh` (to confirm which env vars it actually reads)
  4. `/home/ipon/workspace/vollos-ai/vollos-core/infra/monitor.sh`
- **Plain Thai** for gap_report recommendations (owner will act on these)
- **Estimated AI-elapsed:** 15-20 minutes

Begin.

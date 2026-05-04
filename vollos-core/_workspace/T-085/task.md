---
task_id: T-085
title: Rewrite MR !27 — switch to flat subdomain pattern (1-level) + reuse existing cloudflare.pem + revert docker-compose+CI cert sync changes
agent: vollos-devops
spawn_started_at: 2026-04-28T16:31:14Z
priority: high
mode: 1
status: in_progress
parent_task: T-084
parent_request: cross-repo handshake from Lead@acmd (M3-001 Beta launch)
---

## Context (decision change 2026-04-28)

Owner consulted mentor3 + acmd Lead — switched from 2-level subdomain pattern to FLAT 1-level pattern to avoid Cloudflare ACM paywall (Universal SSL covers 1 level free).

**Old pattern (T-084 implementation — must be reverted):**
- `accommodate.vollos.ai` → acmd-landing:80
- `app.accommodate.vollos.ai` → acmd-web:80    ← 2-level (paid ACM needed)
- `api.accommodate.vollos.ai` → acmd-api:3101  ← 2-level (paid ACM needed)

**New pattern (this task — must be implemented):**
- `accommodate.vollos.ai` → acmd-landing:80     (1-level, covered by `*.vollos.ai`)
- `accommodate-app.vollos.ai` → acmd-web:80     (1-level, covered by `*.vollos.ai`)
- `accommodate-api.vollos.ai` → acmd-api:3101   (1-level, covered by `*.vollos.ai`)

**DNS already updated by owner (verified by Lead 2026-04-28T16:30 ICT):**
- `accommodate.vollos.ai` → 172.67.132.48 / 104.21.12.157 (CF proxy ON)
- `accommodate-app.vollos.ai` → 172.67.132.48 / 104.21.12.157 (CF proxy ON)
- `accommodate-api.vollos.ai` → 172.67.132.48 / 104.21.12.157 (CF proxy ON)
- old 2-level subdomains: no DNS records (cleaned up by owner)

**Cert change:**
- Existing `cloudflare.pem` already covers `*.vollos.ai` — works for all 3 NEW subdomains (each 1-level deep)
- The new cert `cloudflare-acmd.pem` (generated for `accommodate.vollos.ai` + `*.accommodate.vollos.ai`) is NO LONGER NEEDED
- GitLab vars `CF_ORIGIN_CERT_ACMD` + `CF_ORIGIN_KEY_ACMD` — leave in GitLab (no harm, may be useful later); do NOT delete

## Task

Update MR !27 (branch `feat/acmd-caddy-routes`) with revised implementation. Push new commit to existing branch — do NOT close MR or open new one.

### Step 1 — Pull current branch state
```
git fetch origin
git checkout feat/acmd-caddy-routes
git pull --rebase origin feat/acmd-caddy-routes
```

### Step 2 — Update infra/Caddyfile (rewrite the 3 added blocks)

Replace the 3 site blocks added by T-084 (currently using `cloudflare-acmd.pem`) with this version:

```caddy
# =========================================================================
# accommodate.vollos.ai → acmd-landing:80 (M3-001 Beta — added 2026-04-28)
# Covered by existing *.vollos.ai cert (cloudflare.pem) since flat 1-level
# subdomain pattern was chosen over 2-level (avoid CF ACM paywall).
# acmd containers join vollos-network external per A1+D2.
# =========================================================================
accommodate.vollos.ai {
    tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-landing:80 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}

# =========================================================================
# accommodate-app.vollos.ai → acmd-web:80
# =========================================================================
accommodate-app.vollos.ai {
    tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-web:80 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}

# =========================================================================
# accommodate-api.vollos.ai → acmd-api:3101
# =========================================================================
accommodate-api.vollos.ai {
    tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-api:3101 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}
```

Verify:
- 3 existing blocks UNTOUCHED (vollos.ai L156-183 / www.vollos.ai L188-195 / auth.vollos.ai L125-142)
- Cert path = existing `cloudflare.pem` + `cloudflare.key` (NOT cloudflare-acmd.*)
- Run `caddy adapt --config infra/Caddyfile` locally to validate syntax

### Step 3 — Revert docker-compose.prod.yml changes

The cert mount additions from T-084 (around L111-122) for `cloudflare-acmd.pem` + `cloudflare-acmd.key` are no longer needed. Restore to pre-T-084 state for that section. Existing `./infra/certs:/etc/caddy/certs:ro` directory mount stays (always was there).

### Step 4 — Revert .gitlab-ci.yml changes

Remove cert sync steps added by T-084 (~L57-79 + L83-86). The new vars `CF_ORIGIN_CERT_ACMD` + `CF_ORIGIN_KEY_ACMD` no longer need to be written to VPS (cert not used). Restore CI to pre-T-084 state for those sections.

### Step 5 — Commit + push

Commit message (Conventional Commits):
```
refactor: switch acmd routes to flat 1-level subdomain pattern

Switched accommodate.vollos.ai routing from 2-level (api./app./*) to flat
1-level (accommodate-api./accommodate-app./*) to leverage Cloudflare's free
Universal SSL (covers *.vollos.ai). Avoids ACM paywall + complexity.

Reverted unused changes:
- docker-compose.prod.yml: removed cloudflare-acmd cert mount
- .gitlab-ci.yml: removed cert sync steps
- Caddyfile: 3 acmd blocks now reuse existing cloudflare.pem

GitLab vars CF_ORIGIN_CERT_ACMD + CF_ORIGIN_KEY_ACMD remain (unused but
preserved — may be useful for future 2-level expansion if ACM purchased).

DNS records already updated by owner — verified via dig:
- accommodate.vollos.ai → CF proxy IPs
- accommodate-app.vollos.ai → CF proxy IPs
- accommodate-api.vollos.ai → CF proxy IPs

Coordinated with: Lead@acmd (mentor3 D12 — pattern change approved)
```

Push to existing branch `feat/acmd-caddy-routes`. MR !27 will auto-update.

### Step 6 — Update MR description

Update MR !27 description via GitLab API to reflect new flat pattern (use `VOLLOS_CLI_v2` from `/home/ipon/workspace/vollos-ai/vollos-core/.env`):

```bash
set -a; source /home/ipon/workspace/vollos-ai/vollos-core/.env; set +a
curl -X PUT "https://gitlab.com/api/v4/projects/tummadajingjing%2Fvollos-core/merge_requests/27" \
  -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
  -d "description=<NEW DESCRIPTION>"
```

New description must mention: 3 flat subdomains, reuse cloudflare.pem, no new cert needed.

### Step 7 — Wait for pipeline + verify smoke test

After push:
- Pipeline should auto-trigger on the MR
- `caddy validate` step in CI must pass
- Pipeline completes test stage (build+deploy gated to main per existing config)

After pipeline pass:
- `dig +short accommodate.vollos.ai` → confirm CF IPs
- `openssl s_client -connect accommodate.vollos.ai:443 -servername accommodate.vollos.ai </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
- (Backend may 502 if acmd containers not deployed yet on VPS — that's OK; we test Caddy edge layer + cert)

NOTE: Final deploy + smoke happens AFTER MR merge (build+deploy stages run on main only). Owner will merge after Auditor pass.

## Acceptance Criteria

1. ✅ `infra/Caddyfile` has 3 blocks with NEW subdomain names + reuses `cloudflare.pem`
2. ✅ `infra/Caddyfile` existing 3 blocks UNTOUCHED (auth/vollos.ai/www) — diff shows 0 changes
3. ✅ `docker-compose.prod.yml` reverted to pre-T-084 state for cert section
4. ✅ `.gitlab-ci.yml` reverted to pre-T-084 state for cert sync section
5. ✅ `caddy adapt` syntax check passes locally
6. ✅ Commit pushed to `feat/acmd-caddy-routes` (NOT new branch)
7. ✅ MR !27 description updated to reflect flat pattern
8. ✅ Pipeline runs + test stage passes
9. ✅ DNS verification (dig) confirms all 3 new subdomains proxy through CF
10. ✅ self_review field complete with file:line evidence per AC

## Owned Files

- `_workspace/T-085/output.md` (create)
- `infra/Caddyfile` (modify — rewrite 3 added blocks)
- `docker-compose.prod.yml` (modify — revert T-084 changes)
- `.gitlab-ci.yml` (modify — revert T-084 changes)

## Constraints

- **Pipeline-only deploy** — เหมือนเดิม
- **Token:** `VOLLOS_CLI_v2` from `/home/ipon/workspace/vollos-ai/vollos-core/.env` (NOT old VOLLOS_CLI)
- **No private key contents in chat/log** — sha256 first-8 only
- **Forbid list (CLAUDE.md):** no `cat .env`, `echo $SECRET`, `docker compose config` (without --no-interpolate), `docker inspect`, `printenv`
- **9-pattern secret scan** before commit on `_workspace/`
- **Placeholder Audit grep** on modified files
- **Conventional Commits** message
- **NEVER --no-verify**
- **NEVER force-push to main** (push to feat/acmd-caddy-routes branch only)

## Output Format

```yaml
task_id: T-085
agent: vollos-devops
completed_at: <ISO>
status: completed | blocked
files_changed:
  - infra/Caddyfile (rewrite L<X>-<Y>)
  - docker-compose.prod.yml (revert L<X>-<Y>)
  - .gitlab-ci.yml (revert L<X>-<Y>)
caddy_validate: passed
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/27
mr_description_updated: true
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/<N>
pipeline_status: passed | failed
dns_verification:
  accommodate.vollos.ai: ["172.67.132.48", "104.21.12.157"]
  accommodate-app.vollos.ai: [...]
  accommodate-api.vollos.ai: [...]
secret_handling: "9-pattern scan run pre-push, 0 matches"
placeholders_remaining: "none — grep clean" | "list with file:line"
self_review:
  ac1_caddy_3_new_blocks: { result: true, evidence: "Caddyfile:L<X>-<Y>" }
  ac2_existing_blocks_untouched: { result: true, evidence: "git diff origin/main -- infra/Caddyfile shows 0 changes in L125-195" }
  ac3_compose_reverted: { result: true, evidence: "git diff origin/main -- docker-compose.prod.yml" }
  ac4_ci_reverted: { result: true, evidence: "git diff origin/main -- .gitlab-ci.yml" }
  ac5_caddy_validate: { result: true, evidence: "caddy adapt output" }
  ac6_pushed_to_branch: { result: true, evidence: "git push output + commit SHA" }
  ac7_mr_desc_updated: { result: true, evidence: "GitLab API response" }
  ac8_pipeline_passed: { result: true, evidence: "pipeline URL + status" }
  ac9_dns_verified: { result: true, evidence: "dig output above" }
```

## Lead Notes

- งานนี้ revert + reapply — ระวัง git rebase conflict (pull --rebase ก่อน)
- ของเก่า cert ใหม่ที่ generate (CF_ORIGIN_CERT_ACMD) — leave in GitLab (no delete)
- หลัง T-085 done → spawn Auditor ตรวจ MR !27 (security review บังคับ — แตะ TLS routing)
- Auditor pass → owner merge → final smoke test ที่ T-086 (separate task)

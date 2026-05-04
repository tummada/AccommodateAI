---
task_id: T-084
title: Verify GitLab CI/CD vars CF_ORIGIN_CERT_ACMD + CF_ORIGIN_KEY_ACMD + add 3 Caddy routes for accommodate subdomains + DNS records + deploy via pipeline
agent: vollos-devops
spawn_started_at: 2026-04-28T15:52:02Z
priority: high
mode: 1
status: in_progress
parent_request: cross-repo handshake from Lead@acmd (M3-001 Beta launch)
dependencies: [T-083]
---

## Context

T-083 confirmed: cert ปัจจุบัน (`cloudflare.pem`) ครอบแค่ `*.vollos.ai` + `vollos.ai` — ไม่ครอบ `*.accommodate.vollos.ai` (multi-level subdomain ต้องใช้ wildcard ของระดับเดียวกัน)

Owner generated new Cloudflare Origin Cert (15-year ECC) covering:
- `accommodate.vollos.ai`
- `*.accommodate.vollos.ai`

Owner stored in GitLab CI/CD Variables:
- `CF_ORIGIN_CERT_ACMD` (Type: File, Protected)
- `CF_ORIGIN_KEY_ACMD` (Type: File, Protected)

Owner approved SEPARATE cert pattern (best practice) — keep `cloudflare.pem` untouched, add new file pair `cloudflare-acmd.pem` + `cloudflare-acmd.key`

acmd Lead confirmed container names + ports (verified from acmd repo):
- `acmd-api:3101` → `api.accommodate.vollos.ai`
- `acmd-web:80` → `app.accommodate.vollos.ai`
- `acmd-landing:80` → `accommodate.vollos.ai`

All 3 containers will join `vollos-network` (external) per A1 + D2.

## Task

Multi-step deploy enabling acmd subdomain routing:

### Step 1 — Verify GitLab CI/CD Variables exist
- Use GitLab API + token from `/home/ipon/workspace/vollos-ai/vollos-core/.env` — variable name is `VOLLOS_CLI_v2` (NOT the old `VOLLOS_CLI` in `/home/ipon/workspace/vollos/.env` which is revoked)
- Source command: `set -a; source /home/ipon/workspace/vollos-ai/vollos-core/.env; set +a`
- Header: `-H "PRIVATE-TOKEN: $VOLLOS_CLI_v2"`
- Verify both vars exist + Type=File + Protected=true
- Verify cert SAN coverage by parsing variable value (sha256 fingerprint only — never display content)
- If missing or wrong type → STOP + report to Lead

### Step 2 — Update docker-compose.prod.yml
- Add bind mount for new cert pair: `${CF_ORIGIN_CERT_ACMD}:/etc/caddy/certs/cloudflare-acmd.pem:ro`
- Add bind mount for new key: `${CF_ORIGIN_KEY_ACMD}:/etc/caddy/certs/cloudflare-acmd.key:ro`
- Note: GitLab File-type vars expose value as a file path in CI runner — pipeline must copy file content to VPS path before mounting
- Alternative: pipeline writes content to `infra/certs/cloudflare-acmd.pem` + `cloudflare-acmd.key` on VPS during deploy (matches existing pattern in T-008)

### Step 3 — Update infra/Caddyfile (add 3 site blocks)
Pattern: copy from `auth.vollos.ai` block (Caddyfile L125-142), modify per route:

```caddy
# accommodate.vollos.ai → acmd-landing:80 (static SPA)
accommodate.vollos.ai {
    tls /etc/caddy/certs/cloudflare-acmd.pem /etc/caddy/certs/cloudflare-acmd.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-landing:80 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}

# app.accommodate.vollos.ai → acmd-web:80 (nginx SPA serve)
app.accommodate.vollos.ai {
    tls /etc/caddy/certs/cloudflare-acmd.pem /etc/caddy/certs/cloudflare-acmd.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-web:80 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}

# api.accommodate.vollos.ai → acmd-api:3101 (Hono/Express API)
api.accommodate.vollos.ai {
    tls /etc/caddy/certs/cloudflare-acmd.pem /etc/caddy/certs/cloudflare-acmd.key
    import security_headers
    encode gzip zstd
    reverse_proxy acmd-api:3101 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
    }
}
```

### Step 4 — Update .gitlab-ci.yml deploy stage
- Add step: write `$CF_ORIGIN_CERT_ACMD` content → VPS `/home/ipon/vollos-core/infra/certs/cloudflare-acmd.pem` (perm 644)
- Add step: write `$CF_ORIGIN_KEY_ACMD` content → VPS `/home/ipon/vollos-core/infra/certs/cloudflare-acmd.key` (perm 600)
- Use existing SSH deploy mechanism (do not invent new channel)
- Verify with `caddy validate --config /etc/caddy/Caddyfile` BEFORE reload (fail-fast on syntax error)

### Step 5 — DNS records via Cloudflare API
- Add 3 A records pointing to VPS IP `187.124.244.96`:
  - `accommodate.vollos.ai` (proxy ON)
  - `app.accommodate.vollos.ai` (proxy ON)
  - `api.accommodate.vollos.ai` (proxy ON)
- Use `CLOUDFLARE_API_TOKEN` from GitLab CI/CD Variables (existing — verified at T-029)
- TTL: Auto

### Step 6 — Open MR + wait for pipeline
- Branch: `feat/acmd-caddy-routes`
- Conventional commit: `feat: add Caddy routes for accommodate.vollos.ai + 3 subdomains`
- Open MR via `gh` or GitLab API + VOLLOS_CLI token
- Wait pipeline pass (test + build + deploy stages)
- DO NOT bypass pipeline (กฎ Best Practices + ห้าม push ตรง main)

### Step 7 — Smoke test post-deploy
- `curl -I https://accommodate.vollos.ai` → expect 200/301 (depends on acmd-landing being up)
- `curl -I https://app.accommodate.vollos.ai` → expect 200/301 or 502 (acceptable: acmd containers may not be running yet on VPS)
- `curl -I https://api.accommodate.vollos.ai/health` → expect 200 or 502 (same)
- Verify Caddy actually responds with new cert (TLS handshake) — even 502 backend is OK because we're testing Caddy edge layer
- Use `openssl s_client -connect <subdomain>:443 -servername <subdomain> </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName` to confirm new cert served

## Acceptance Criteria

1. ✅ GitLab vars `CF_ORIGIN_CERT_ACMD` + `CF_ORIGIN_KEY_ACMD` verified exist + Type=File + Protected=true
2. ✅ `infra/Caddyfile` adds 3 site blocks (accommodate / app.accommodate / api.accommodate) using new cert path
3. ✅ `infra/Caddyfile` existing 3 blocks (vollos.ai / www / auth) UNTOUCHED — verify with diff
4. ✅ `docker-compose.prod.yml` mounts new cert pair into Caddy container
5. ✅ `.gitlab-ci.yml` writes cert+key content to VPS during deploy (perms 644/600)
6. ✅ 3 DNS A records added in Cloudflare (proxy ON, TTL auto)
7. ✅ MR opened on branch `feat/acmd-caddy-routes` with conventional commit
8. ✅ Pipeline passes ALL stages (test + build + deploy)
9. ✅ Post-deploy smoke test: openssl s_client confirms new cert served on all 3 subdomains
10. ✅ self_review field complete with file:line evidence per acceptance criterion

## Owned Files

- `_workspace/T-084/output.md` (create)
- `infra/Caddyfile` (modify — add 3 blocks at end)
- `docker-compose.prod.yml` (modify — add 2 bind mounts)
- `.gitlab-ci.yml` (modify — add cert write steps)

## Constraints

- **Pipeline-only deploy** — ห้าม scp ตรง / manual ssh deploy (กฎ MR Workflow + Best Practices)
- **Secret handling 9-pattern scan** before push (กฎ Mandatory Secret Scan ใน CLAUDE.md):
  ```bash
  cd /home/ipon/workspace/vollos-ai/vollos-core
  grep -rE "glpat-[0-9a-zA-Z_-]{20,}" _workspace/
  grep -rE "ghp_[0-9a-zA-Z]{36}" _workspace/
  grep -rE "AKIA[0-9A-Z]{16}" _workspace/
  grep -rE "-----BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY-----" _workspace/
  grep -rE "NODEMAILER_OAUTH2_REFRESH_TOKEN=1//" _workspace/
  grep -rE "TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}" _workspace/
  grep -rE "CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}" _workspace/
  grep -rE "\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}" _workspace/
  grep -rE "password\s*[=:]\s*['\"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}" _workspace/
  ```
  Must show 0 matches before commit.
- **No private key in chat/log** — output.md may show sha256 fingerprint of cert/key (first-8 hex), never raw content
- **Caddy validate** before reload — fail-fast on syntax error
- **Cloudflare API token** — use existing `CLOUDFLARE_API_TOKEN` GitLab var (do not paste into shell — use protected env var)
- **Pre-commit grep** for `alert(`, `coming soon`, `TODO`, `mock`, `not implemented`, `Phase [0-9]` in modified files (Placeholder Audit per CLAUDE.md)

## Output Format

```yaml
task_id: T-084
agent: vollos-devops
completed_at: <ISO>
status: completed | blocked
gitlab_vars:
  CF_ORIGIN_CERT_ACMD:
    exists: true
    type: file
    protected: true
    sha256_first8: "<8 hex chars>"
    san_verified: ["accommodate.vollos.ai", "*.accommodate.vollos.ai"]
  CF_ORIGIN_KEY_ACMD:
    exists: true
    type: file
    protected: true
    sha256_first8: "<8 hex chars>"
files_changed:
  - infra/Caddyfile (added 3 site blocks at L196+)
  - docker-compose.prod.yml (added 2 cert mounts)
  - .gitlab-ci.yml (added cert write steps)
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/<N>
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/<N>
pipeline_status: passed | failed
dns_records:
  - {name: accommodate.vollos.ai, type: A, content: 187.124.244.96, proxied: true, status: created}
  - {name: app.accommodate.vollos.ai, type: A, content: 187.124.244.96, proxied: true, status: created}
  - {name: api.accommodate.vollos.ai, type: A, content: 187.124.244.96, proxied: true, status: created}
smoke_test:
  accommodate.vollos.ai: {http_status: <N>, cert_subject: "...", cert_san: [...]}
  app.accommodate.vollos.ai: {...}
  api.accommodate.vollos.ai: {...}
secret_handling: "9-pattern scan run pre-push, 0 matches"
placeholders_remaining: "none — grep clean" | "list with file:line"
self_review:
  ac1_gitlab_vars: { result: true, evidence: "..." }
  ac2_caddyfile_3_blocks: { result: true, evidence: "Caddyfile:L<X>-<Y>" }
  ac3_existing_blocks_untouched: { result: true, evidence: "git diff shows 0 changes in L125-195" }
  ac4_compose_mounts: { result: true, evidence: "docker-compose.prod.yml:L<X>-<Y>" }
  ac5_ci_writes_cert: { result: true, evidence: ".gitlab-ci.yml:L<X>-<Y>" }
  ac6_dns_records: { result: true, evidence: "Cloudflare API response" }
  ac7_mr_opened: { result: true, evidence: "MR URL above" }
  ac8_pipeline_passed: { result: true, evidence: "pipeline URL + status" }
  ac9_smoke_test_passed: { result: true, evidence: "openssl s_client output" }
```

## Lead Notes

- งานนี้แตะ TLS + DNS + Caddy = security-critical → Auditor review บังคับหลัง output.md
- ใช้ pattern เดิมจาก T-008 (Caddy + CF Origin Cert) — ไม่ invent new pattern
- acmd containers อาจยังไม่ run บน VPS → smoke test รับ 502 backend ได้ (ตรวจ Caddy edge layer + cert OK)
- ถ้าติดที่ Step ใด → STOP + report Lead ก่อน proceed (ห้ามตัดสินใจเอง)

---
id: T-008
title: RS-013 Deploy Prep — Caddyfile + Caddy service for CF Origin Cert (Option A)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T19:01:05+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-007 audit completed (cert paths identified)
blocks:
  - T-007 2B-2 deploy resume (Caddy in docker + CF origin cert required before)
---

## Context

T-007 audit revealed TLS mismatch: `infra/Caddyfile` uses ACME auto-HTTPS, but Cloudflare proxy (orange cloud) intercepts HTTP-01 challenge → breaks HTTPS.

**Owner chose Option A:** reuse existing Cloudflare Origin Certificate (bind-mount static cert).

From T-007 audit:
- Current cert on VPS at `/home/ipon/vollos/infra/certs/cloudflare.pem` + `.key` (1143 + 241 bytes)
- CF Origin CA self-signed, valid to **2041-03-22** (15 years — no renewal for a long time)
- Old Caddy container mounts at `/etc/caddy/certs/` path
- Old Caddyfile uses: `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key`

## Scope

### Change 1 — `infra/Caddyfile`

Replace ACME auto-HTTPS config with static cert reference for all 3 virtual hosts:
- `auth.vollos.ai`
- `vollos.ai`
- `www.vollos.ai`

Inside each `{...}` block add: `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key`

Remove `email admin@vollos.ai` (only needed for ACME) or leave as comment.

Preserve existing:
- `admin off`
- trusted_proxies (CF IP ranges)
- `(security_headers)` snippet (HSTS, CSP, etc.)
- All routes/reverse_proxy config

### Change 2 — Add Caddy service

**Decision:** add to `docker-compose.prod.yml` (not a new file) — fewer files, clear dev/prod split. Dev still uses localhost:3001/3004 direct curl.

Add service block:
```yaml
caddy:
  image: caddy:2-alpine
  container_name: vollos-core-caddy
  restart: unless-stopped
  volumes:
    - ./infra/Caddyfile:/etc/caddy/Caddyfile:ro
    - ./infra/certs:/etc/caddy/certs:ro
    - caddy_data:/data
    - caddy_config:/config
  ports:
    - "80:80"
    - "443:443"
    - "443:443/udp"  # HTTP/3
  networks:
    - vollos-network
    - internal
  depends_on:
    vollos-api:
      condition: service_healthy
    auth-service:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "wget", "-q", "--spider", "http://localhost:2019/config/"]
    interval: 30s
    timeout: 5s
    retries: 3

volumes:
  caddy_data:
  caddy_config:
```

### Change 3 — Verify `.gitignore` blocks cert files

Grep current `.gitignore`:
- Must have at least one of: `*.pem`, `infra/certs/*.pem`, `infra/certs/` blanket
- Must have at least one of: `*.key`, `infra/certs/*.key`
- If missing → add

### Change 4 — vollos-api must join vollos-network

Auditor T-003 flagged: `vollos-api` only on `internal` network, NOT `vollos-network`. Caddy reaches it by name via `vollos-network`. Add to `docker-compose.yml`:
```yaml
vollos-api:
  networks:
    - internal
    - vollos-network
```

## Acceptance Criteria

1. ✅ `infra/Caddyfile` uses static cert (`tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key`) in all 3 virtual hosts
2. ✅ No ACME / auto-HTTPS references remain (grep clean)
3. ✅ `docker-compose.prod.yml` has Caddy service joining `vollos-network`
4. ✅ `vollos-api` service in `docker-compose.yml` joins both `internal` + `vollos-network`
5. ✅ `.gitignore` blocks `*.pem` + `*.key` (grep verify)
6. ✅ `caddy validate` passes on updated Caddyfile (via docker run)
7. ✅ `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet` exit 0
8. ✅ Commit to feature branch `fix/rs013-caddy-cf-origin-cert` + MR to main + conventional commits
9. ✅ Self-review evidence-based (file:line)
10. ✅ Placeholder grep clean

## Out of Scope (do NOT do in this task)

- NO SSH to VPS — that's T-007 resume
- NO runtime test (local dev doesn't have cert files — runtime happens in T-007 on VPS)
- NO cert rotation strategy (valid to 2041 — follow-up when closer to expiry)
- NO portability hardening (storing cert in GitLab Variables as base64 — follow-up task)
- NO changing dev compose port bindings (dev = localhost direct, prod = Caddy-only)

## Owned Files

- `infra/Caddyfile` (primary)
- `docker-compose.prod.yml` (add Caddy service)
- `docker-compose.yml` (vollos-api network join)
- `.gitignore` (verify)

## Forbidden

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md`
- `apps/*/src/**`, `packages/*/src/**`
- Push to main
- Commit cert files
- SSH to VPS

## Expected Output

```yaml
task_id: T-008
status: passed | failed | blocked
branch: fix/rs013-caddy-cf-origin-cert
commit_sha: <sha>
mr_iid: <N>
mr_url: <URL>

caddyfile_changes:
  tls_lines_added: 3  # one per vhost
  acme_references_removed: N
  preserved_security_headers: true
  preserved_trusted_proxies: true

compose_changes:
  caddy_service_added_file: docker-compose.prod.yml
  caddy_image: caddy:2-alpine
  caddy_networks: [vollos-network, internal]
  caddy_ports: [80, 443, 443/udp]
  caddy_volumes: [caddy_data, caddy_config, ./infra/Caddyfile:ro, ./infra/certs:ro]
  vollos_api_networks_updated: true
  vollos_api_networks_now: [internal, vollos-network]

gitignore_patterns:
  pem_blocked: true
  key_blocked: true

validation:
  caddy_validate: "Valid configuration exit 0"
  compose_config_merged: "exit 0"

self_review:
  ...
```

## Rules

- Read `CLAUDE.md` §§ D (Docker), E (Port numbering — Caddy doesn't have product prefix, it's infra)
- Read `_workspace/T-007/output.md` for cert paths (already in task)
- Conventional commit: `fix(infra): reuse Cloudflare Origin Cert + Caddy service in docker compose`
- DO NOT attempt to test Caddy locally without cert files — task scope is config change only
- Trust T-007 audit about cert paths — validate again during T-007 resume

Begin.

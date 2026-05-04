---
task_id: T-008-AUDIT
audit_target: MR !12 (Caddy CF Origin Cert + Caddy service in compose)
reviewer: vollos-auditor
mr: "!12"
branch: fix/rs013-caddy-cf-origin-cert
commit: 075a123
security_checkpoint: true
---

## Scope

Security review of MR !12. Triggers: TLS config + Docker network + reverse proxy — ALL mandatory audit per CLAUDE.md Mandatory QA/Auditor Gate.

## Files Changed

- `infra/Caddyfile` — ACME removed, static cert `tls /etc/caddy/certs/cloudflare.pem .key` × 3 vhosts
- `docker-compose.prod.yml` — added `caddy` service (caddy:2-alpine, ports 80/443/443-udp, networks [vollos-network, internal], bind-mount Caddyfile + infra/certs/ read-only, volumes caddy_data + caddy_config, depends_on healthy)
- `docker-compose.yml` — vollos-api joins vollos-network (dual-network)
- `.gitignore` — added `*.key`, `keys/*.key`, `infra/certs/`

## Audit Focus (7 checkpoints)

### 1. TLS/Cert Handling
- Verify `.gitignore` blocks `*.pem` + `*.key` + `infra/certs/` BEFORE any cert could be committed
- Verify no cert content in git history (`git log -S "BEGIN CERTIFICATE"` → 0)
- Verify Caddyfile uses `tls <path> <path>` correctly (path inside container `/etc/caddy/certs/`)
- Verify no `ACME` / `email admin@` / auto-HTTPS leftover

### 2. Caddy Container Hardening (HIGH priority)
- **No `user:` directive** — runs as root — FLAG as HIGH severity finding
- **No `cap_drop: [ALL]`** — excessive capabilities
- **No `read_only: true`** — writable filesystem (attack surface)
- **No `security_opt: [no-new-privileges]`** — missing hardening
- Compare to industry standard (e.g., Bitnami, Linuxserver.io containers, OWASP Docker Top 10)

### 3. Access Log Bind-Mount (HIGH priority — fail2ban integration)
- Caddyfile writes access log to `/var/log/caddy/access.log` (or wherever)
- Compose has NO bind-mount for `/var/log/caddy` → logs stay in container → fail2ban on VPS host CANNOT read them
- VPS is expected to have fail2ban per architecture → integration broken
- FLAG as HIGH severity

### 4. Docker Network
- Verify vollos-api now has `vollos-network` (dual with internal) — rule D4 compliance
- Verify Caddy joins both networks
- Verify postgres still on dual network (unchanged)
- Verify no services accidentally switched

### 5. Port Exposure
- Verify prod compose strips vollos-api/auth ports (via `!reset []`)
- Verify Caddy publishes 80/443 only
- Verify no other ports accidentally published

### 6. Healthcheck Validity
- Caddy healthcheck uses `nc -z 127.0.0.1 443` — is this sufficient?
- Admin API port 2019 is disabled (`admin off`) — alternative check OK
- depends_on conditions correct (wait for api/auth healthy)

### 7. Commit + MR Process
- Conventional commits
- No push to main
- Pipeline green
- No out-of-scope files touched

## Verdict Format

Write `_workspace/T-008/review-auditor.md`:

```yaml
task_id: T-008
reviewer: vollos-auditor
mr: "!12"
verdict: pass | fail | conditional_pass
commit_gate: GO | NO-GO
critical_findings: []
high_findings:
  - id: F-1 (example — caddy root)
    severity: high
    file: docker-compose.prod.yml:L??
    description: "..."
    recommendation: "..."
    reference: "CIS Docker Benchmark / OWASP Docker Top 10"
medium_findings: []
note_findings: []
checks_performed: [...]
rationale: "plain Thai"
```

## Rules
- **Re-run all verification commands yourself** — do not trust DevOps self-review
- **Never display certs/passwords/env values**
- **Read-only** — only write to review-auditor.md
- **Plain Thai rationale**

Begin now.

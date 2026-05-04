---
id: T-009
title: RS-013 Deploy Prep — Container hardening (4 Auditor findings from MR !12)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T19:17:28+07:00
security_checkpoint: true
domain_consultation: null
dependencies:
  - T-008 merged (MR !12 at commit 075a123 → main)
  - T-008 Auditor review completed (4 findings)
blocks:
  - T-007 Phase 2B VPS deploy (owner chose: fix hardening BEFORE deploy)
---

## Context

T-008 MR !12 (Caddy CF Origin Cert) merged. Auditor review: `conditional_pass` with 4 findings. Owner chose Option A = fix ALL 4 before T-007 resume (Phase 2B deploy). This task bundles all 4 fixes into single MR.

Audit source: `_workspace/T-008/review-auditor.md` (SEC-001 through SEC-004)

## 4 Fixes to deliver

### SEC-001 (HIGH) — Caddy non-root + capability drop
**File:** `docker-compose.prod.yml` caddy service

Add:
```yaml
caddy:
  # ... existing config ...
  user: "caddy:caddy"  # or explicit UID/GID like "1000:1000" — caddy:2-alpine has `caddy` user
  cap_drop:
    - ALL
  cap_add:
    - NET_BIND_SERVICE   # required for binding 80/443 as non-root
  security_opt:
    - no-new-privileges:true
  read_only: true
  tmpfs:
    - /tmp
    - /run
```

**Notes for DevOps:**
- caddy:2-alpine image ships with `caddy` user (UID 1000) — verify with `docker run --rm caddy:2-alpine id caddy`
- Named volumes `caddy_data` and `caddy_config` are writable despite `read_only: true` (mount points exempt from read-only rootfs)
- If `read_only: true` breaks boot → add `/tmp` + `/run` as `tmpfs:` (most containers need this)
- Must test `caddy validate` + `docker compose config --quiet` + (if possible) `docker compose up` the caddy service alone to verify boot

### SEC-002 (HIGH) — Access log bind-mount
**File:** `docker-compose.prod.yml` caddy service + new host path

Add to caddy service:
```yaml
volumes:
  - ./infra/Caddyfile:/etc/caddy/Caddyfile:ro
  - ./infra/certs:/etc/caddy/certs:ro
  - ./logs/caddy:/var/log/caddy   # NEW — fail2ban integration
  - caddy_data:/data
  - caddy_config:/config
```

**Host path setup:**
- DevOps creates `logs/caddy/` directory in repo (empty dir keeper: `.gitkeep`)
- Add to `.gitignore`: `logs/caddy/*.log` + `logs/caddy/*.log.*` (rotated logs)
- Keep `.gitkeep` tracked so directory exists after git clone

**Caddy log directive (verify):**
- `infra/Caddyfile:L40` already writes to `/var/log/caddy/access.log` per Auditor
- Confirm — no change needed if path matches
- Ensure log format is JSON (fail2ban compatible)

### SEC-003 (MEDIUM) — Image digest pinning
**Files:** `docker-compose.yml` + `docker-compose.prod.yml`

Pin both:
- `caddy:2-alpine` → `caddy:2-alpine@sha256:<digest>`
- `postgres:17-alpine` → `postgres:17-alpine@sha256:<digest>`
- (auth-service + vollos-api use custom-built Dockerfile — they're already "pinned" to their source)

**Method:**
```bash
docker pull caddy:2-alpine
docker inspect caddy:2-alpine --format='{{index .RepoDigests 0}}'
# output: caddy@sha256:abc123...
# use: caddy:2-alpine@sha256:abc123...
```

Document digests in output.md. If images update later → CI can detect drift (separate follow-up).

### SEC-004 (MEDIUM) — Resource limits
**File:** `docker-compose.prod.yml` (add to each service)

Proposed limits (VPS has 2 CPU / 8 GB RAM):
```yaml
postgres:
  mem_limit: 1g
  cpus: 1.0
vollos-api:
  mem_limit: 512m
  cpus: 0.5
auth-service:
  mem_limit: 512m
  cpus: 0.5
caddy:
  mem_limit: 256m
  cpus: 0.3
```

Total: ~2.3 GB RAM / ~2.3 CPU (slight overcommit on CPU is fine — Docker throttles gracefully).

DevOps may adjust based on expected traffic load — but must include limits on ALL services.

## Acceptance Criteria

1. ✅ **SEC-001 resolved** — all 5 hardening directives added to caddy (user, cap_drop, cap_add, security_opt, read_only + tmpfs)
2. ✅ **SEC-002 resolved** — log bind-mount present; `logs/caddy/.gitkeep` created; `.gitignore` rule added for `logs/caddy/*.log*`
3. ✅ **SEC-003 resolved** — both `caddy:2-alpine` + `postgres:17-alpine` pinned to `@sha256:<digest>`; digests documented in output.md
4. ✅ **SEC-004 resolved** — `mem_limit` + `cpus` on all 4 services (postgres, vollos-api, auth-service, caddy)
5. ✅ `caddy validate` passes
6. ✅ `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet` exit 0
7. ✅ **Local runtime verification** (per owner rule `feedback_local_integration_test`): `docker compose up -d caddy postgres` at minimum — verify caddy boots with all hardening directives applied + doesn't crash from read_only filesystem
8. ✅ Commit to feature branch `fix/rs013-caddy-hardening`
9. ✅ Conventional commits (can be 1-4 commits, one per SEC-## is fine, or bundle)
10. ✅ MR to main opened
11. ✅ Pipeline green
12. ✅ Self-review evidence-based (file:line, timing claims verifiable)
13. ✅ No secrets displayed; grep clean for placeholders

## Runtime test requirement

Not full stack (cert files don't exist locally) — but DevOps MUST verify caddy boots standalone:
```bash
# create dummy cert for local test
mkdir -p /tmp/t009-test-certs
openssl req -x509 -newkey rsa:2048 -keyout /tmp/t009-test-certs/cloudflare.key \
    -out /tmp/t009-test-certs/cloudflare.pem -days 1 -nodes \
    -subj "/CN=test.local"

# mount dummy certs for smoke
# test via modified compose OR copy certs to infra/certs/ temporarily (DO NOT commit)

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d caddy
# wait 10s
docker compose ps caddy  # must show healthy
docker compose logs caddy | grep -iE "error|panic|permission denied"  # must be empty
docker compose down
rm -rf /tmp/t009-test-certs
```

If caddy fails to boot with hardening → iterate until it works. Common issues:
- `read_only` → add `/tmp`, `/run` as tmpfs
- `user: caddy` → check if cert files readable by caddy UID
- `cap_drop: ALL` → verify NET_BIND_SERVICE alone is enough (it is for caddy 80/443)

## Owned Files

- `docker-compose.yml` (add digest pin for postgres)
- `docker-compose.prod.yml` (hardening, log mount, resource limits, digest pin caddy)
- `.gitignore` (add `logs/caddy/*.log*`)
- `logs/caddy/.gitkeep` (new, empty file to keep directory)

## Forbidden

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md`
- `apps/*/src/**`, `packages/*/src/**`
- Push to main
- Commit real cert files or log content
- SSH to VPS

## Expected Output

```yaml
task_id: T-009
status: passed | failed | blocked
branch: fix/rs013-caddy-hardening
commit_sha: <sha>
mr_iid: <N>

sec_001_caddy_hardening:
  user: "caddy:caddy" (or uid:gid)
  cap_drop: [ALL]
  cap_add: [NET_BIND_SERVICE]
  security_opt: [no-new-privileges:true]
  read_only: true
  tmpfs_added: [/tmp, /run]
  file: docker-compose.prod.yml:L??

sec_002_log_mount:
  bind_mount_added: "./logs/caddy:/var/log/caddy"
  gitkeep_created: logs/caddy/.gitkeep
  gitignore_updated: true
  gitignore_lines_added: [...]

sec_003_digest_pinning:
  caddy_digest: "caddy:2-alpine@sha256:abc..."
  postgres_digest: "postgres:17-alpine@sha256:def..."
  digest_fetched_via: "docker inspect --format"

sec_004_resource_limits:
  postgres: {mem_limit: 1g, cpus: 1.0}
  vollos_api: {mem_limit: 512m, cpus: 0.5}
  auth_service: {mem_limit: 512m, cpus: 0.5}
  caddy: {mem_limit: 256m, cpus: 0.3}

runtime_verification:
  caddy_boot_with_hardening_success: true
  iterations_needed: N  # how many times you had to fix boot issues
  errors_in_logs: []
  healthcheck_passed: true

validation:
  caddy_validate: "Valid configuration exit 0"
  compose_config_merged: "exit 0"

self_review:
  ...
```

## Rules

- Read `_workspace/T-008/review-auditor.md` for Auditor reasoning (L??-L??)
- Read `CLAUDE.md` §§ D (Docker), J (Secrets), K (Code Quality)
- Runtime verification is MANDATORY — owner rule `feedback_local_integration_test` + T-005 lesson (syntax ≠ working)
- Plain Thai recommendations in output.md summary for owner

Begin.

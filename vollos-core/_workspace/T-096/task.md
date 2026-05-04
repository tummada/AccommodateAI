---
task_id: T-096
title: Plan B — Enable Caddy admin Unix socket + switch to directory bind mount (root-cause fix for inode-pin)
agent: vollos-devops
spawn_started_at: 2026-04-29T16:05+07:00
mode: MODE_1 (config change — production safe via MR + future deploy)
priority: medium (root-cause hardening — prevents future T-094/T-095 incidents)
estimated_time: 30-45 min
dependencies: [T-095 (Plan A done — Caddy now serves new config)]
parent_context: "T-094/T-095 incident: pipeline auto-deploy didn't pickup new Caddyfile because (1) `admin off` blocked `caddy reload`, AND (2) single-file bind mount (./infra/Caddyfile:/etc/caddy/Caddyfile:ro) pinned inode at container start so git reset --hard host file replacement didn't propagate. Plan B fixes both root causes so future MR merges that change Caddyfile auto-reload without container recreate."
---

## Goal

Two coordinated changes — must ship together as one MR (don't split):

1. **Caddyfile change:** Replace `admin off` with `admin unix//config/admin.sock` — admin API still unreachable from network (Unix socket inside container only) but `caddy reload` works again
2. **docker-compose.prod.yml change:** Switch Caddyfile mount from single-file bind to directory bind — host file inode replacement propagates into container

3. **Update CI/CD pipeline:** add post-deploy `caddy reload` step (so future Caddyfile changes auto-apply without container restart)

4. **Document operational runbook** in `infra/README-caddy-reload.md` — how to reload + what to do if reload fails

## Owned Files

- **MODIFIED:** `infra/Caddyfile` (admin directive only — L21-25 area; ~3 lines)
- **MODIFIED:** `docker-compose.prod.yml` (caddy volumes section — L27-28 area; ~2 lines)
- **MODIFIED:** `.gitlab-ci.yml` (deploy stage — add post-deploy caddy reload; ~5 lines)
- **NEW:** `infra/README-caddy-reload.md` (~40 lines — operational doc)

## Branch Strategy

- Sync main first
- Branch: `feat/caddy-admin-unix-socket-and-dir-mount`
- Open MR + spawn Auditor security review
- DO NOT auto-merge — Lead coordinates with owner before merge

## Implementation Spec

### Change 1 — Caddyfile admin directive

**File:** `infra/Caddyfile`
**Location:** Inside global block `{ ... }` near top (current `admin off` directive around L21-25)

**Before:**
```caddy
{
	# Hide admin API (must never be reachable from the internet —
	# `admin off` disables it completely). No `email` directive is
	# required because ACME is disabled; TLS uses static cert files.
	admin off
	# Cloudflare Real-IP trust ...
```

**After:**
```caddy
{
	# Admin API on Unix socket inside container (never reachable from
	# network). `admin off` was previously used but blocks `caddy reload`,
	# forcing container recreate to apply Caddyfile changes (T-094/T-095
	# incident). Unix socket keeps the API hidden from any TCP listener
	# while restoring graceful reload.
	admin unix//config/admin.sock
	# Cloudflare Real-IP trust ...
```

**Why Unix socket NOT TCP:**
- TCP `localhost:2019` would still be reachable from any process inside the container — including potentially compromised app processes if Caddy were ever co-located
- Unix socket at `/config/admin.sock` only accessible by user 1000 (Caddy's runtime user) inside the container — same trust boundary as Caddy itself
- `caddy reload` auto-discovers Unix socket via `--address` flag if needed

### Change 2 — docker-compose.prod.yml volume mount

**File:** `docker-compose.prod.yml`
**Location:** Caddy service `volumes:` section (around L26-31)

**Before:**
```yaml
    volumes:
      # Caddyfile (tracked in git) — read-only in container.
      - ./infra/Caddyfile:/etc/caddy/Caddyfile:ro
```

**After:**
```yaml
    volumes:
      # Caddyfile mounted via PARENT DIRECTORY (not single-file) so host
      # inode replacement (e.g. git reset --hard) propagates into the
      # container. Single-file bind mount pinned inode at container start
      # and caused T-094/T-095 incident where new Caddyfile (266 lines)
      # was on disk but container kept reading orphan inode (189 lines).
      # Container reads /etc/caddy/Caddyfile inside this directory.
      - ./infra/caddy:/etc/caddy:ro
```

**Required directory restructure (DevOps must do):**
```
infra/
├── caddy/                    ← NEW directory (was just files in infra/)
│   ├── Caddyfile             ← moved from infra/Caddyfile
│   └── certs/                ← moved from infra/certs/
│       ├── cloudflare.pem    ← gitignored, synced via deploy
│       └── cloudflare.key    ← gitignored, synced via deploy
└── ... (other infra files unchanged)
```

⚠️ **IMPORTANT — preserve git history:** Use `git mv` not `mv` so blame/history follows the file:
```bash
git mv infra/Caddyfile infra/caddy/Caddyfile
git mv infra/certs infra/caddy/certs
```

⚠️ **Update Caddyfile cert path:** L83-84 area `tls /etc/caddy/certs/cloudflare.pem ...` — paths inside container DO NOT change (still `/etc/caddy/certs/cloudflare.pem`) because we mount entire `./infra/caddy` to `/etc/caddy`. Verify this works.

### Change 3 — .gitlab-ci.yml post-deploy reload

**File:** `.gitlab-ci.yml`
**Location:** deploy stage script section

After current deploy commands (`git fetch + reset --hard + docker compose up -d`), add:

```yaml
    # Post-deploy: graceful Caddy reload to pickup any Caddyfile changes
    # without container recreate (avoids the inode-pin issue + downtime).
    # Only reloads if Caddyfile actually changed in this deploy.
    - |
      if git diff HEAD~1 HEAD --name-only | grep -q "^infra/caddy/Caddyfile$"; then
        echo "Caddyfile changed — reloading Caddy gracefully"
        ssh ipon@$VPS_HOST "cd ~/vollos-core && docker exec vollos-core-caddy caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock"
      else
        echo "Caddyfile unchanged — no reload needed"
      fi
```

⚠️ **Verify:** ssh path on VPS = `~/vollos-core` (per T-095 finding) NOT `~/vollos`

### Change 4 — Operational runbook

**File:** `infra/README-caddy-reload.md` (new)

Should cover:
- How to reload manually (graceful path via Unix socket)
- How to verify reload succeeded (check log + smoke test)
- Fallback if reload fails (force-recreate path used in T-095)
- Troubleshooting: what each error message means
- Reference to T-094/T-095 incident as historical context

Keep <50 lines, plain Thai-English mix per project style.

## Pre-Merge Verification Checklist

Before opening MR, DevOps must:

1. ✅ `caddy adapt --config infra/caddy/Caddyfile` exits 0
2. ✅ `docker compose -f docker-compose.prod.yml config --no-interpolate` exits 0 (NO `--no-interpolate` would leak secrets per T-015 lesson)
3. ✅ `git ls-files infra/caddy/` shows Caddyfile is tracked (after git mv)
4. ✅ Local test: `docker compose -f docker-compose.prod.yml up caddy` (in isolated test) — container starts + admin socket created at /config/admin.sock
5. ✅ Inside container: `caddy reload --address unix//config/admin.sock` works (test the new admin path)
6. ✅ shellcheck on .gitlab-ci.yml deploy section snippet (if testable)
7. ✅ All 6 acmd+vollos subdomain references in MR description so reviewer can spot-check

## Acceptance Criteria

1. ✅ 4 file changes per spec (Caddyfile admin directive, docker-compose mount, .gitlab-ci.yml reload step, new README)
2. ✅ Git mv preserves history (`git log --follow infra/caddy/Caddyfile` shows pre-move commits)
3. ✅ Caddy adapt + compose config validate locally
4. ✅ Local container test confirms admin socket accessible inside, NOT outside
5. ✅ Branch pushed + MR opened with full description
6. ✅ Auditor sub-spawn confirms: no security regression (admin still unreachable from network), no secret leak in CI changes
7. ✅ MR description includes deploy plan + rollback plan
8. ✅ MR set `merge_when_pipeline_succeeds=false` — Lead coordinates merge timing with owner

## Self-Review Required

```yaml
self_review:
  - field: "caddyfile_admin_unix_socket"
    result: true/false
    evidence: "infra/caddy/Caddyfile:LN — 'admin unix//config/admin.sock' present, 'admin off' removed"
  - field: "compose_directory_mount"
    result: true/false
    evidence: "docker-compose.prod.yml:LN — './infra/caddy:/etc/caddy:ro' replaces single-file mount"
  - field: "git_mv_history_preserved"
    result: true/false
    evidence: "git log --follow infra/caddy/Caddyfile shows >1 commit (pre-move history follows)"
  - field: "ci_post_deploy_reload_added"
    result: true/false
    evidence: ".gitlab-ci.yml:LN — conditional caddy reload after compose up, with --address unix//config/admin.sock"
  - field: "vps_path_corrected_to_vollos_core"
    result: true/false
    evidence: ".gitlab-ci.yml ssh command uses ~/vollos-core (NOT ~/vollos) per T-095 discovery"
  - field: "runbook_created"
    result: true/false
    evidence: "infra/README-caddy-reload.md exists, < 50 lines, covers reload + fallback + troubleshooting"
  - field: "local_caddy_validate_passed"
    result: true/false
    evidence: "caddy adapt --config infra/caddy/Caddyfile exit 0"
  - field: "auditor_no_security_regression"
    result: true/false
    evidence: "_workspace/T-096/audit.md verdict: pass — admin socket inside-only, no network exposure, no secret leak"
  - field: "branch_pushed_mr_opened_no_automerge"
    result: true/false
    evidence: "MR URL https://gitlab.com/.../merge_requests/N (state: opened, merge_when_pipeline_succeeds=false)"
```

## Applicable Rules

- **Best Practices > Git** — MR required, no direct main push, conventional commits
- **feedback_check_pipeline_before_push_main** — push main = auto-deploy; coordinate timing
- **feedback_secret_handling_protocol** — `docker compose config` → use `--no-interpolate` only, never raw
- **D14 (board commit policy)** — board not touched in this task → no board commit needed (Plan B doesn't touch _board.md)
- **Architecture Rule D1+D4** — vollos-network + cert mounts unchanged

## Forbidden

- Use raw `docker compose config` (must add --no-interpolate per protocol)
- Touch any service in compose besides caddy
- Skip git mv (use mv would lose history)
- Auto-merge MR
- Modify Caddy security_headers / TLS config (out of scope)

## Cleanup

- bash history clear
- Remove any /tmp test container artifacts post local test

## Domain Consultation

ไม่ต้อง — pure infra reconfig

## Deploy Plan (for MR description)

After Lead coordinates merge:
1. Merge MR → pipeline auto-deploys
2. Pipeline (a) git fetch+reset on VPS, (b) docker compose up -d, (c) NEW: detects Caddyfile change → caddy reload
3. Smoke test 6 subdomains (3 acmd + 3 vollos) immediately post-deploy
4. If any subdomain regresses → rollback (revert MR + force-recreate)

## Rollback Plan

If MR breaks anything:
- Revert MR via GitLab UI → next pipeline run reverts file changes
- If Caddy refuses to start: SSH VPS, `git checkout HEAD~1 -- docker-compose.prod.yml infra/`, `docker compose up -d --force-recreate caddy`
- Backup: container inspect output saved to /tmp/caddy-pre-T-096-*.json before deploy

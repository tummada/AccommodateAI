---
task_id: T-009-AUDIT
audit_target: MR !13 (hardening for 4 Auditor findings SEC-001..SEC-004)
reviewer: vollos-auditor
mr: "!13"
branch: fix/rs013-caddy-hardening
commit: 3d79c95
scope: narrow (verify 4 specific findings resolved; catch any new issue introduced)
---

## Context

T-009 is the hardening hot-fix for 4 findings from T-008 Auditor review:
- **SEC-001** (HIGH) — Caddy non-root + capability drop + read_only
- **SEC-002** (HIGH) — access log bind-mount for fail2ban
- **SEC-003** (MEDIUM) — pin Caddy + postgres image digests
- **SEC-004** (MEDIUM) — resource limits on all 4 services

DevOps claims runtime test passed on first attempt (0 iterations). Your job: verify independently + confirm nothing NEW is broken.

## Your 5 checkpoints

### A — SEC-001 resolved?
- `user: "1000:1000"` present on caddy service
- `cap_drop: [ALL]` + `cap_add: [NET_BIND_SERVICE]` (verify nothing else in cap_add — extra caps = weaker)
- `security_opt: [no-new-privileges:true]`
- `read_only: true`
- `tmpfs: [/tmp]` (or similar — verify sufficient for Caddy runtime needs)

### B — SEC-002 resolved?
- `./logs/caddy:/var/log/caddy` bind-mount on caddy service
- `logs/caddy/.gitkeep` exists in repo (directory preservation)
- `.gitignore` blocks `logs/caddy/*.log*` (verify — `grep -E "logs/caddy"` on .gitignore)
- Caddyfile:L40 (or wherever) still writes to `/var/log/caddy/access.log` — path alignment

### C — SEC-003 resolved?
- `caddy:2-alpine@sha256:<digest>` — verify digest format correct (64-char hex after sha256:)
- `postgres:17-alpine@sha256:<digest>` — same
- Pull the images by digest yourself + compare — actually NO, just format check is enough (pulling wastes time)

### D — SEC-004 resolved?
- Every service has BOTH `mem_limit` + `cpus`: postgres, vollos-api, auth-service, caddy
- Values reasonable for 2 CPU / 8 GB VPS — sum of cpus ≤ 2.5 acceptable (Docker throttles), sum of mem_limit ≤ 7 GB
- If any service missing → FLAG

### E — No new issues introduced?
- `docker compose config --quiet` merged config valid
- `caddy validate` passes (via docker)
- No other services accidentally broken (postgres/api/auth networks still correct, env_file still present, healthchecks still intact)
- DevOps claim: "docker compose up -d --no-deps caddy produced healthy container" — spot-check by re-reading compose file for any contradiction
- Check: does `user: "1000:1000"` match the caddy:alpine image's actual caddy user (ID 1000)? If not → bind-mount permission issues. Verify via `docker run --rm caddy:2-alpine id caddy`

## Verdict Format

Write `_workspace/T-009/review-auditor.md`:

```yaml
task_id: T-009
reviewer: vollos-auditor
mr: "!13"
previous_findings_status:
  SEC-001: resolved | partial | unresolved
  SEC-002: resolved | partial | unresolved
  SEC-003: resolved | partial | unresolved
  SEC-004: resolved | partial | unresolved
verdict: pass | conditional_pass | fail
commit_gate: GO | NO-GO
phase_2b_readiness: ready | blocked
new_findings: []
checks_performed: [A, B, C, D, E each with pass/fail + evidence]
rationale: "plain Thai"
```

## Rules

- **Re-run commands independently** (git diff, grep, docker compose config)
- **Quick review** — scope is narrow, should take ≤10 minutes
- Read `_workspace/T-008/review-auditor.md` for previous findings context
- **Never display secrets** (cert content, passwords, etc.)
- **Read-only** — only write `_workspace/T-009/review-auditor.md`

If all 4 findings resolved cleanly → `verdict: pass` + `phase_2b_readiness: ready`. No need to conditional_pass unless something new found.

Begin.

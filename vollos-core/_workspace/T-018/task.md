---
id: T-018
title: Fix monitor.sh — container names + cover all 4 services (T-007 oversight)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T22:31:54+07:00
security_checkpoint: false
domain_consultation: null
---

## Context

Owner received Telegram alert:
```
VOLLOS Alert (srv1275409):
- API container: not_found
```

Cause: `infra/monitor.sh:L41` checks container named `infra-api-1` (old monorepo name). New stack uses `vollos-core-api`. False alert firing every 5 min via cron.

**Production is actually healthy** — `curl https://vollos.ai/` returns 200, container `vollos-core-api` is running + healthy. Only the script check is wrong.

Lead oversight in T-007 — should have verified monitor.sh container name matches new compose.

## Scope

### Fix 1 — Correct container name + expand coverage

Current `infra/monitor.sh` only checks ONE container (`infra-api-1`). Should check all 4:
- `vollos-core-postgres`
- `vollos-core-api`
- `vollos-core-auth`
- `vollos-core-caddy`

Refactor to loop over 4 services with same running/healthy check logic.

### Fix 2 — Update fail path in site check

Keep current /vollos.ai HTTP 200 check (still valid).

### Acceptance Criteria

1. `infra/monitor.sh` checks 4 containers: postgres, api, auth, caddy
2. Each container: running status + healthcheck status (if defined)
3. HTTP site check unchanged (vollos.ai 200)
4. Disk + memory checks unchanged
5. Bash syntax valid: `bash -n infra/monitor.sh` → exit 0
6. Local manual test on VPS: `bash infra/monitor.sh` → exit 0 + "[OK] All checks passed" (no false alerts)
7. Feature branch `fix/rs013-monitor-container-names`
8. Conventional commit + MR to main
9. Pipeline green
10. Post-merge: SSH VPS → `git pull` → next cron tick (5 min) uses new script — no restart needed

## Forbidden

- Don't use `docker compose config` (memory `feedback_docker_compose_config_secrets.md`)
- No secrets in output.md (fingerprints only if any)
- No push to main

## Expected Output

```yaml
task_id: T-018
status: passed | failed
branch: fix/rs013-monitor-container-names
commit_sha: <sha>
mr_iid: <N>

fix:
  containers_checked: [vollos-core-postgres, vollos-core-api, vollos-core-auth, vollos-core-caddy]
  previous_single_container: infra-api-1
  loop_refactor: true|false

validation:
  bash_n: "exit 0"
  local_test_vps: "exit 0 + [OK] All checks passed"

post_merge_deploy:
  ssh_pull_done: true
  next_cron_expected_at: <iso>
  false_alerts_expected_to_stop: true

self_review: ...
```

## Rules

- Read CLAUDE.md §§ D, J, K
- Read memory `feedback_secret_handling_protocol.md` (even though this task doesn't handle secrets directly, monitor.sh reads .env for TELEGRAM vars — be careful)
- Post-merge: SSH + `git pull` → no container restart needed (monitor.sh runs via host cron, picks up new script next tick)

Begin.

---
task_id: T-034
agent: vollos-devops
status: done
completed_at: 2026-04-19T19:15+07:00
verdict: NOT_DEPLOYED
---

# T-034 Output — acmd VPS Deployment Diagnostic

## Verdict

**`NOT_DEPLOYED`** — acmd has **zero footprint** on VPS `187.124.244.96`.

Conclusion: acmd Lead can safely skip deploy phases entirely — there is nothing to update, migrate, or restart on the VPS. First deploy will be a greenfield bring-up.

## Evidence (raw SSH output)

### 1. Home directory — no acmd folder

```
ipon@vps:~$ ls ~/
backups
vollos
vollos-core
```

- `~/acmd/` → **does NOT exist**
- `~/vollos-acmd/` → **does NOT exist**
- Only `vollos/` (monorepo legacy) + `vollos-core/` (current core) + `backups/` present.
- Git log / remote check → **skipped** (no folder to check).

### 2. Running containers — no acmd-* container

```
NAMES                  STATUS                    IMAGE
vollos-core-auth       Up 31 minutes (healthy)   vollos-core-auth-service
vollos-core-api        Up 31 minutes (healthy)   vollos-core-vollos-api
vollos-core-postgres   Up 31 minutes (healthy)   postgres:17-alpine
vollos-core-caddy      Up 20 hours (healthy)     caddy:2-alpine
```

- 4 running containers total — **all are `vollos-core-*`**.
- `docker ps -a` (includes stopped) → same 4, **no acmd-* ever recorded**.
- Zero containers with `acmd` in name (running or stopped).

### 3. Docker network `vollos-network` — no acmd service attached

```
"Name": "vollos-network",
        "Name": "vollos-core-caddy",
        "Name": "vollos-core-api",
        "Name": "vollos-core-postgres",
        "Name": "vollos-core-auth",
```

- Only the 4 `vollos-core-*` containers are attached.
- **No acmd service joined the shared network.**

### 4. systemd units — none

```
ls /etc/systemd/system/ | grep -i acmd
(empty output)
```

- No `acmd*.service`, `acmd*.timer`, or anything acmd-related.

### 5. Cron jobs — none

```
crontab -l | grep -i acmd
(empty output)
```

- User crontab: no acmd entries.
- `/etc/cron.d/` system crons: no acmd entries.

## Summary Table

| Check                     | Result     | Notes                                       |
|---------------------------|------------|---------------------------------------------|
| `~/acmd/` folder          | ABSENT     | Also `~/vollos-acmd/` absent                |
| git repo cloned           | N/A        | No folder to check                          |
| Running containers        | 0 acmd     | Only 4 vollos-core-* containers             |
| Stopped containers        | 0 acmd     | No historical deploys either                |
| `vollos-network` members  | 0 acmd     | Only vollos-core-* services                 |
| systemd unit              | ABSENT     | No service / timer file                     |
| Cron job                  | ABSENT     | Neither user nor system cron                |

## Implications for acmd Lead

1. **Pipeline deploy stage never ran** — confirmed by VPS state (matches "0 CI variables" finding).
2. **No rollback needed** — nothing to roll back.
3. **No running process to stop** — first deploy is purely additive.
4. **No migration drift risk** — `acmd.*` schema in DB may or may not exist, but no service has been touching it from VPS.
5. **First deploy checklist** needs to cover: clone repo → create `~/.env` with secrets → set CI/CD variables → trigger pipeline (or manual `docker compose up -d`) → join `vollos-network` → smoke test.

## Constraints honored

- READ-ONLY — zero state change on VPS (only `ls`, `docker ps`, `docker network inspect`, `grep` commands run).
- No key/secret printed — none were read; only container names, folder names, and empty grep outputs shown.
- SSH key used: `~/.ssh/vollos_deploy_v3` — not displayed.

## self_review

- folder_check: result: true — evidence: SSH `ls ~/` returned only `backups vollos vollos-core`; explicit absence check for both `~/acmd` and `~/vollos-acmd` returned "does NOT exist"
- container_check: result: true — evidence: `docker ps` and `docker ps -a` both show exactly 4 `vollos-core-*` containers, zero acmd-*
- network_check: result: true — evidence: `docker network inspect vollos-network` Containers list contains only vollos-core-caddy/api/postgres/auth
- systemd_check: result: true — evidence: `ls /etc/systemd/system/ | grep -i acmd` returned empty
- cron_check: result: true — evidence: `crontab -l | grep -i acmd` returned empty; `/etc/cron.d/` grep returned empty
- verdict_clarity: result: true — evidence: verdict header at top = `NOT_DEPLOYED`, task.md acceptance criterion 5 satisfied
- read_only_honored: result: true — evidence: all commands used were `ls`, `docker ps`, `docker network inspect`, `grep`, `crontab -l`; no `docker run/stop/rm`, no file edits, no systemd mutations
- secret_safety: result: true — evidence: no `.env` read, no key print, no credential in output

## placeholders_remaining

none — grep clean (diagnostic report, no code placeholders)

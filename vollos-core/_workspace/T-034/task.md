---
id: T-034
title: Verify acmd deployment state on VPS (read-only diagnostic for acmd Lead)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-19T19:10+07:00
security_checkpoint: true
owned_files: []
dependencies: []
---

## Context

acmd Lead's Phase 1 prep found: 0 CI variables (project + group), pipeline deploy stage never triggered. acmd Lead asks whether acmd has ANY services running on VPS, because this determines whether to skip deploy phases entirely.

## Scope (READ-ONLY)

SSH to VPS and report:

1. `ls ~/` → does folder `acmd/` or `vollos-acmd/` exist?
2. If `~/acmd/` exists → `ls ~/acmd/` + `cd ~/acmd && git log -1 --oneline && git remote -v`
3. `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'` → any container with `acmd` in name?
4. `docker network inspect vollos-network 2>/dev/null | grep -i 'acmd\|Name' | head -20` → any acmd service on network?
5. `ls /etc/systemd/system/ | grep -i acmd` → any systemd unit?
6. `crontab -l 2>/dev/null | grep -i acmd` → any cron job?

## Secret Handling
- Use `~/.ssh/vollos_deploy_v3` — no key print
- Read-only commands only

## Acceptance Criteria

1. [ ] Folder state report (exists/not, git ref if exists)
2. [ ] Running container check (yes/no + names if yes)
3. [ ] Network participation check
4. [ ] systemd / cron check
5. [ ] Clear verdict: `NOT DEPLOYED` / `DEPLOYED via [method]` / `FOLDER EXISTS BUT NOTHING RUNNING`

## Deliverable
`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-034/output.md`

Quick task — should finish in 1-2 min.

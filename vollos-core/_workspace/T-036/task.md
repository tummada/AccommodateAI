---
id: T-036
title: Tag 2 past deploys + push tags + clear bash history (local + VPS)
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T08:25+07:00
security_checkpoint: true
owned_files: []
dependencies: []
---

## Context

Two production deploys never got rollback tags. Also bash history may contain sensitive tokens/passwords typed during T-022/T-029 secret operations. Both need cleanup.

Memory reference: `project_rs013_state.md`, `feedback_secret_handling_protocol.md`

## Goal (Two independent sub-goals)

### Part 1 — Tag 2 past deploys
- Tag `49eb642` → `deploy-20260418-1625` (T-022 — CCPA + rate limit deploy on 2026-04-18 16:25 UTC)
- Tag `a65660d` → `deploy-20260419` (T-032 — migration Phase 1 E2E verification deploy on 2026-04-19)
- Push tags to origin

### Part 2 — Clear bash history
- Clear local workstation `~/.bash_history` (user `ipon`, host `mx-linux`)
- Clear VPS `~/.bash_history` (user `ipon`, IP `187.124.244.96`)
- Do NOT print any line of history before clearing

## Scope

### Part 1 — Tags

```
cd /home/ipon/workspace/vollos-ai/vollos-core
git fetch origin --tags
git tag --list | grep deploy  # baseline — probably empty

# Verify both SHAs exist on main
git cat-file -e 49eb642 && echo "49eb642 exists"
git cat-file -e a65660d && echo "a65660d exists"

# Create annotated tags
git tag -a deploy-20260418-1625 49eb642 -m "Production deploy 2026-04-18 16:25 UTC — T-022 CCPA + rate limit"
git tag -a deploy-20260419 a65660d -m "Production deploy 2026-04-19 — T-032 namespace migration Phase 1 E2E verification"

# Push tags
git push origin deploy-20260418-1625 deploy-20260419

# Verify on origin
git ls-remote --tags origin | grep deploy
```

### Part 2 — Bash history cleanup

**IMPORTANT:** Clear without viewing content (owner's Secret Handling Protocol).

**Local:**
```
# Do NOT cat ~/.bash_history
history -c           # clear current session buffer
> ~/.bash_history    # truncate file
history -w           # write empty buffer to file
wc -l ~/.bash_history  # should show 0
```

**VPS (SSH via key `~/.ssh/vollos_deploy_v3`):**
```
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 '
  history -c
  > ~/.bash_history
  history -w
  wc -l ~/.bash_history
'
```

## Secret Handling (MANDATORY)

- ห้าม cat `~/.bash_history` ทั้งบน local และ VPS
- ห้าม grep หาคำใน history (grep อาจพิมพ์ secret ออกมาถ้า match)
- ห้าม copy content ไปแสดง
- ถ้าต้องการ verify → ใช้แค่ `wc -l` หรือ `ls -la` ไม่เปิดไฟล์

## Acceptance Criteria

1. [ ] `deploy-20260418-1625` tag created locally (evidence: `git tag --list` output)
2. [ ] `deploy-20260419` tag created locally (evidence: `git tag --list` output)
3. [ ] Both tags pushed to origin (evidence: `git ls-remote --tags origin` output)
4. [ ] Local `~/.bash_history` cleared (evidence: `wc -l` = 0)
5. [ ] VPS `~/.bash_history` cleared (evidence: `wc -l` = 0)
6. [ ] No bash history content viewed or leaked in output.md

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: "command → snippet"`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-036/output.md`

## Notes

- If tag already exists on origin (e.g. someone tagged manually before) → report to Lead, skip re-tag
- If SSH to VPS fails → report error, mark Part 2 VPS step as failed, do not retry blindly

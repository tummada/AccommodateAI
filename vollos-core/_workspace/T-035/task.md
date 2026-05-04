---
id: T-035
title: Verify VPS HEAD + push feat/auth-rate-limit branch + open MR
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-20T08:25+07:00
security_checkpoint: false
owned_files: []
dependencies: []
---

## Context

Branch `feat/auth-rate-limit` has 1 commit ahead of main (`d9714e5` — rate limit refresh/me/onboarding/google/logout endpoints). Memory snapshot says VPS was deployed on 2026-04-19 (commit `a65660d` per T-032 — migration E2E test commit) and earlier on 2026-04-18 (commit `49eb642` — T-022 CCPA + rate limit).

Lead is unclear whether current VPS state already contains the rate-limit code (`d9714e5`) or not. DevOps must verify and report.

## Goal

1. Fetch latest from origin + confirm actual state of local `main` vs `origin/main` vs VPS HEAD
2. Determine whether `feat/auth-rate-limit` (HEAD `d9714e5`) is already on VPS or needs to be merged
3. If not yet deployed → push branch + open MR to main
4. If already deployed via hotfix path → report discrepancy to Lead, do not open MR

## Scope

### Step 1 — Local git state verification (read-only)
```
cd /home/ipon/workspace/vollos-ai/vollos-core
git fetch origin --prune
git log origin/main -1 --oneline
git log main -1 --oneline
git log feat/auth-rate-limit -1 --oneline
git log origin/main..feat/auth-rate-limit --oneline
```

### Step 2 — VPS git state verification (read-only)
SSH to VPS (IP 187.124.244.96, user ipon, key `~/.ssh/vollos_deploy_v3`):
```
cd ~/vollos-core && git log -1 --oneline && git branch --show-current
```

### Step 3 — Compare and decide

- **Case A:** VPS HEAD = `d9714e5` (already deployed via direct hotfix push) → STOP. Report to Lead with full evidence. Do NOT open MR.
- **Case B:** VPS HEAD = earlier commit (e.g. `a65660d` or `e5168bf`) and `feat/auth-rate-limit` NOT on origin → push branch + open MR.
- **Case C:** branch already on origin but no MR → skip push, verify + open MR.

### Step 4 — If Case B or C: push + open MR

```
git push -u origin feat/auth-rate-limit
```

Use `glab` CLI or curl GitLab API (PAT in `/home/ipon/workspace/vollos/.env` as `VOLLOS_CLI`) to open MR:
- source: `feat/auth-rate-limit`
- target: `main`
- title: `feat(auth): rate limit refresh/me/onboarding/google/logout endpoints`
- description: brief — "Adds rate limiting to 5 auth endpoints (commit d9714e5). Verified via T-035."
- remove_source_branch: true
- squash: false (keep commit as-is, it already uses conventional commits)

### Step 5 — Verify MR opened
Return MR URL + state (`opened`).

## Secret Handling (MANDATORY)

- ห้าม cat `/home/ipon/workspace/vollos/.env` — use `source` then `glab` with env vars
- ห้าม echo $VOLLOS_CLI หรือ key ใดๆ ใน output
- ถ้าใช้ curl: use `-H "PRIVATE-TOKEN: $VOLLOS_CLI"` — redact ใน log

## Acceptance Criteria

1. [ ] Local git state documented (origin/main, main, feat/auth-rate-limit HEAD SHAs)
2. [ ] VPS HEAD SHA documented
3. [ ] Verdict clearly stated: Case A / Case B / Case C
4. [ ] If Case B or C: MR URL + state returned
5. [ ] Pipeline URL returned (pipeline should auto-run on branch push)
6. [ ] No secret values leaked in output.md

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: "file:line or command → snippet"`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-035/output.md`

## Notes

- Conventional commits gate — branch HEAD `d9714e5` already uses `feat(auth):` prefix ✅
- Local uncommitted changes: `_board.md` has Lead's Session Anchor Log edit — DO NOT stage or commit it
- If MR opens successfully → Lead will report URL to owner for human review + merge

---
id: T-045
title: Local cleanup — sync main + delete merged branches
assigned_to: vollos-devops
priority: low
status: in_progress
spawn_started_at: 2026-04-20T10:30+07:00
security_checkpoint: false
owned_files: []
dependencies: []
---

## Context

After merging 4 MRs (!3, !4, !5, !6) to main, local repo has stale branches + stale main. Need cleanup.

Currently checked out on: `fix/backup-gpg-encrypt` (left over from parallel agent work).

Local branches to delete (all merged to main):
- `chore/workspace-audit-trail` (merged via !3)
- `fix/unsubscribe-link-expiry` (merged via !4)
- `fix/landing-sri` (merged via !5)
- `fix/backup-gpg-encrypt` (merged via !6)
- `feat/auth-rate-limit` (merged via !18 historically — Case A from T-035)
- `test/e2e-deploy-verify` (merged via !2 historically — from T-032)

## Scope (READ-WRITE — only git plumbing)

1. `git -C /home/ipon/workspace/vollos-ai/vollos-core status` — confirm no uncommitted changes on current branch (should be clean)
2. `git checkout main`
3. `git pull origin main --ff-only` — advance from e5168bf → 2d23284 (17 commits)
4. For each of the 6 branches: `git branch -d <branch>` (use `-d` not `-D` — safer; if it refuses because not fully merged locally, STOP and report)
5. `git branch` — verify only `main` remains
6. `git remote prune origin` (cleanup stale remote refs)
7. Do NOT touch `_board.md` — that's Lead territory

## Acceptance Criteria

1. [ ] Working tree clean before branch switching (no uncommitted changes)
2. [ ] On main, fully synced with `origin/main` (HEAD should be `2d23284`)
3. [ ] All 6 branches deleted cleanly via `git branch -d` (NOT `-D`)
4. [ ] `git branch` output shows only `* main`
5. [ ] `git remote prune origin` ran
6. [ ] No commits lost — reflog still accessible

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: command → snippet`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-045/output.md`

## Notes

- If any `git branch -d` fails with "not fully merged" → STOP. Do NOT use `-D`. Report to Lead so owner can investigate.
- Lead is about to ask owner about switching deploy to auto. This task is unrelated — just git housekeeping.

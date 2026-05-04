---
id: T-078
title: Local workspace cleanup — sync main + prune merged branches
assigned_to: vollos-devops
priority: low
spawn_started_at: 2026-04-20T18:25+07:00
dependencies: []
owned_files: []   # local-only operations, no file content changes
---

## Context

Owner workflow ต้องการ local workspace สะอาด หลังวันนี้ merge เยอะ (Phase A + policies)

**Current state (from Lead pre-check via `git status --short`):**
- Current branch: `fix/ci-smoke-timing-harden`
- Local `main`: **38 commits behind** `origin/main`
- **14+ local branches** (merged to main แต่ยังค้าง local)
- Working tree:
  - `M _board.md` (Lead session edits)
  - `M _workspace/T-075/output.md` (post-commit URL update from T-075 agent — not staged)
  - `?? _workspace/T-076/` (new session work, untracked)
  - `?? _workspace/T-077/` (new session work, untracked)
  - `?? .claude/scheduled_tasks.lock` (Claude Code state file — should stay local)

## Task (pure local ops — no push, no commit, no remote change)

1. `git stash push -u -m "session-20260420-cleanup-preserve"` — save ALL working tree + untracked (including T-076/T-077 + lock file)
2. `git checkout main`
3. `git pull origin main` — sync 38 commits
4. Delete merged branches (preserve `main` + currently-active if any):
   ```bash
   git branch --merged main | grep -vE "^\*|^\s*main\s*$" | xargs -r -n1 git branch -d
   ```
5. `git stash pop` — restore changes (2 M files + T-076/T-077 + lock)
6. Verify final state: `git branch` (should be short list), `git status --short` (should show same M + ?? as before stash)

## Acceptance Criteria

1. Local `main` synced to `origin/main` (0 commits behind)
2. All merged branches deleted (exception: `main` + branch currently checked-out if any was active)
3. Working tree M files restored (`_board.md` + `_workspace/T-075/output.md`)
4. Untracked preserved (`_workspace/T-076/`, `_workspace/T-077/`, `.claude/scheduled_tasks.lock`)
5. **No remote push** — not even `git push origin --delete` for remote branches (local-only)
6. **No commit** created by this task
7. No files modified in content (git ref ops only)

## ข้อห้าม

- ห้าม `git push` ใด
- ห้าม `git commit`
- ห้าม `git branch -D` (force delete) — ใช้ `-d` เท่านั้น (safe delete only — ถ้า merged)
- ห้ามลบ `main` หรือ current branch
- ห้ามแตะ `_workspace/T-076/`, `_workspace/T-077/`, `.claude/scheduled_tasks.lock` content
- ถ้า `git stash pop` conflict → หยุด + รายงาน (ห้าม `git stash drop`)
- ห้าม `git reset --hard` ใดๆ

## Output (output.md)

- `self_review`: 7 AC + evidence (command output snippets)
- `branches_deleted`: list (ชื่อ + SHA)
- `branches_kept`: list (ชื่อ + เหตุผล)
- `commits_synced_to_local_main`: count + range (from X to Y)
- `working_tree_final_state`: `git status --short` output post-pop
- `blocker`: null/details

## Definition of Done

- [ ] output.md เขียนเสร็จ
- [ ] Local main = origin/main
- [ ] Merged branches ลบหมด
- [ ] 2 M files กลับมา (stash pop successful)
- [ ] ไม่มี push / commit / remote change
- [ ] ไม่มี stash หลงเหลือ (`git stash list` empty)

## Skip Auditor (rationale)

Pure local cleanup, no remote/production/VPS impact — Auditor review optional. Lead spot-check sufficient.

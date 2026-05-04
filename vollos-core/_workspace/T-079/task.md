---
id: T-079
title: Drop 2 old stashes (Lead-verified safe — both only _board.md diffs)
assigned_to: vollos-devops
priority: low
spawn_started_at: 2026-04-20T18:50+07:00
dependencies: [T-078]
owned_files: []
---

## Context

Owner confirmed drop ของ 2 stashes ค้างจาก T-078:
- `stash@{0}` — `wip-audit-trail-chore` 2026-04-20 13:51 (_board.md diff — session #006 anchor ที่ linter revert)
- `stash@{1}` — `WIP on feat/rs013-deploy-prep` 2026-04-18 16:57 (_board.md diff — stale 2 days)

Lead pre-verified: ทั้ง 2 stashes แก้แค่ `_board.md` ไม่มี code/secret

## Scope (pure local, 3 commands)

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
git stash drop stash@{1}    # drop oldest first (index shifts)
git stash drop stash@{0}    # drop the remaining one (was {1}, now {0})
# or: git stash drop stash@{0}; git stash drop stash@{0}  (both patterns work)
# Verify: git stash list  # should be empty
```

**สำคัญ:** drop order matters — drop stash@{1} ก่อน เพราะเมื่อ drop stash@{0} ก่อน index shift ทำให้ stash@{1} กลายเป็น stash@{0} confused

หรือใช้ `git stash clear` (drop all stashes) — 1 command เด็ดขาดกว่า

## Acceptance Criteria

1. `git stash list` output = empty after operation
2. ไม่มี commit / push / branch change (pure local ref-level op)
3. ไม่มีไฟล์ใน working tree เปลี่ยน (stash ที่ drop ไม่แตะ working tree)
4. Working tree state เดิม (M _board.md + M T-075/output.md + ?? T-076..T-079/ + ??  scheduled_tasks.lock)

## ข้อห้าม

- ห้าม `git stash pop` (จะคืนเนื้อหา stash ลง working tree — conflict risk)
- ห้าม `git stash apply` (same reason)
- ห้าม push / commit / branch change
- ห้ามแก้ content ไฟล์ใด

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-079/output.md`:
- `self_review`: 4 AC + evidence
- `stashes_dropped`: list (ref + name + original timestamp)
- `stash_list_post`: output ของ `git stash list` (should be empty string)
- `working_tree_unchanged`: verify via `git status --short` (list same as pre-task)
- `blocker`: null/details

## Definition of Done

- [ ] Both stashes dropped (`git stash list` empty)
- [ ] Working tree unchanged
- [ ] No commit/push/branch change
- [ ] output.md complete

Report concise — detail ใน output.md

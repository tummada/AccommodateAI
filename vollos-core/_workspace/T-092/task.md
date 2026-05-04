---
task_id: T-092
title: Drop obsolete stash T-088-pre-checkout (content already restored via T-089)
agent: vollos-devops
spawn_started_at: 2026-04-29T10:50+07:00
mode: MODE_1
priority: low (housekeeping)
estimated_time: 2 min
dependencies: [T-089 (board restored — stash content preserved in main)]
parent_context: "Owner approved drop of stash@{0} 'On feat/acmd-caddy-routes: T-088-pre-checkout'. Stash content (_board.md +90/-, _workspace/T-075/output.md +6/-) was already restored to main via T-089. Stash is now obsolete duplicate."
---

## Goal

ลบ stash@{0} ที่ obsolete หลัง T-089 กู้ของในนั้นเข้า main แล้ว

## Owned Files

ไม่มี — git stash operation only (no file changes)

## Pre-Drop Verification (mandatory before drop)

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core

# Step 1: Confirm stash exists and contains expected files
git stash list
# Expected exactly 1 line: stash@{0}: On feat/acmd-caddy-routes: T-088-pre-checkout

git stash show stash@{0} --stat
# Expected: _board.md changed + _workspace/T-075/output.md changed

# Step 2: Confirm equivalent content already in main (T-089 restoration)
git log --oneline origin/main | head -5
# Expected: 78d45af chore(board): restore session #006-#009... visible

# Verify board has session #006-#009 + Done T-083..T-088 (sample-check)
grep -cE "^\| #00[6789]" _board.md  # expect 4
grep -cE "^\| T-08[5-8] " _board.md  # expect at least 4
```

If verification fails → STOP, do NOT drop, escalate to Lead.

## Implementation

```bash
# Drop the stash (stash entries remain in reflog ~30 days for emergency recovery)
git stash drop stash@{0}

# Verify gone
git stash list
# Expected: empty output (no stashes)
```

## Acceptance Criteria

1. ✅ Pre-drop verification: stash content matches expected (board + T-075 output)
2. ✅ Pre-drop verification: equivalent content present on main (T-089 restoration confirmed)
3. ✅ `git stash drop stash@{0}` succeeds
4. ✅ `git stash list` returns empty
5. ✅ Reflog still has the stash for emergency recovery (verify `git fsck --unreachable | grep -i commit | head -3`)

## Self-Review Required

```yaml
self_review:
  - field: "stash_content_verified_before_drop"
    result: true/false
    evidence: "git stash show stash@{0} --stat output confirmed _board.md + _workspace/T-075/output.md"
  - field: "main_has_restored_content"
    result: true/false
    evidence: "_board.md grep #006-#009 = 4, T-08[5-8] = 4+ rows present (T-089 restoration intact)"
  - field: "stash_dropped"
    result: true/false
    evidence: "git stash drop output 'Dropped stash@{0}...' + git stash list empty"
  - field: "reflog_recovery_available"
    result: true/false
    evidence: "git fsck --unreachable shows the stash commit SHA still in reflog (recovery possible up to ~30 days)"
```

## Forbidden

- `git stash clear` (would drop all stashes blindly — use `drop` for specific stash)
- Skip pre-drop verification
- Drop multiple stashes in one command

## Cleanup

ไม่ต้อง — git operation only

## Domain Consultation

ไม่ต้อง — pure git housekeeping

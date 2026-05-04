---
id: T-024
title: Update L3 rule in vollos-core/CLAUDE.md — point to vollos-skill-team repo (follow-up from T-023)
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-19T13:59:04+07:00
security_checkpoint: false
domain_consultation: null
dependencies:
  - T-023 (vollos-skill-team repo created + symlinks working)
---

## Context

T-023 สร้าง `vollos-skill-team` repo สำเร็จ (private, `git@gitlab.com:tummadajingjing/vollos-skill-team.git`) + symlink 7 skills verified working. ตอนนี้ **L3 rule ใน `vollos-core/CLAUDE.md` ยังชี้ path เก่าที่ผิด** (`vollos-core/.claude/skills/vollos-*` — ที่นั่นไม่มี global workers เลย).

งานนี้: update L3 rule ให้ชี้ไป source of truth ใหม่ + symlink command.

**Scope:** แก้แค่ไฟล์เดียว = `vollos-core/CLAUDE.md`. ไม่แตะ code / config อื่น.

## Branch strategy

`feat/auth-rate-limit` (current local branch) merged เข้า main แล้วตาม T-022.
**Create new branch from origin/main:** `docs/update-l3-rule`.

**⚠️ IMPORTANT — _board.md handling:**
ขณะนี้ working tree มี `_board.md` modified (Lead's edits for T-023/T-024 tracking — NOT for this MR).
ใช้ selective stash:
```bash
git stash push -m "lead-board-temp" -- _board.md
git fetch origin main
git checkout -b docs/update-l3-rule origin/main
# ... do L3 edit + commit ...
git push -u origin docs/update-l3-rule
git checkout feat/auth-rate-limit   # return to original branch
git stash pop                         # restore _board.md
```

## Current L3 rule (to replace)

**File:** `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md`
**Line:** 185

Current text (single line):
```markdown
- **L3.** **คนใหม่ต้อง copy global skills ก่อนใช้งาน:** `cp -r vollos-core/.claude/skills/vollos-* ~/.claude/skills/`
```

Problem: `vollos-core/.claude/skills/` ไม่มี global workers — มีแค่ `vollos-support` (domain expert). Rule จึงชี้ source ที่ไม่มี.

## Replacement L3 rule (new text)

Replace **line 185** with this multi-line block:

```markdown
- **L3.** คนใหม่ / เครื่องใหม่ — bootstrap VOLLOS team skills:

  ```bash
  git clone git@gitlab.com:tummadajingjing/vollos-skill-team.git \
    ~/workspace/vollos-ai/vollos-skill-team
  for skill in vollos-lead vollos-backend vollos-frontend \
               vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
    ln -s ~/workspace/vollos-ai/vollos-skill-team/$skill \
          ~/.claude/skills/$skill
  done
  ```

  Source of truth: https://gitlab.com/tummadajingjing/vollos-skill-team (private)
  Global workers ที่ VOLLOS ต้องใช้: vollos-{lead, backend, frontend, qa, auditor, devops, e2e-tester}
  (Claude Code อ่าน skill ผ่าน symlink ได้ — verified on owner machine 2026-04-19 ผ่าน T-023)
```

**สำคัญ:** nested code block ใน markdown list — ใช้ 4-space indent สำหรับ triple-backtick inner block (หรือ 3-tick outer + 4-tick inner). ตรวจ rendered output ด้วย `glow` หรือ preview ก่อน commit ถ้าไม่แน่ใจ.

## Steps

### 1. Prepare working tree

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
git status --short  # expect: M _board.md + untracked _workspace/T-* folders + security-check-output/
git stash push -m "lead-board-temp-T024" -- _board.md
git status --short  # _board.md should no longer show M
```

### 2. Create branch from origin/main

```bash
git fetch origin main
git checkout -b docs/update-l3-rule origin/main
```

### 3. Edit CLAUDE.md L3 rule

Edit line 185 — replace single-line L3 with multi-line block shown in "Replacement L3 rule" section above. Use Edit tool (exact string match) OR sed if confident about escaping.

**Verify:**
```bash
grep -n "^- \*\*L[0-9]" CLAUDE.md
# Should show L1, L2, L3 (now spanning multiple lines), L4, L5
grep -A 10 "^- \*\*L3" CLAUDE.md
# Should show new block with git clone + symlink loop
```

### 4. Commit + push

```bash
git add CLAUDE.md
git -c commit.gpgsign=false commit -m "docs: update L3 rule — point to vollos-skill-team repo

L3 previously pointed to vollos-core/.claude/skills/vollos-* as source
of truth for 7 team global skills, but those skills were never present
at that path (only vollos-support domain expert lives there).

Actual source of truth is now the new private repo
git@gitlab.com:tummadajingjing/vollos-skill-team.git — bootstrapped
via T-023 on 2026-04-19. Symlink pattern verified working on owner
machine (Claude Code reads SKILL.md through symlinks).

Follow-up from T-023."
git push -u origin docs/update-l3-rule
```

### 5. Create MR

```bash
source /home/ipon/workspace/vollos/.env
# VOLLOS_CLI loaded — DO NOT echo
glab mr create \
  --source-branch docs/update-l3-rule \
  --target-branch main \
  --title "docs: update L3 rule — point to vollos-skill-team repo" \
  --description "Follow-up from T-023. L3 previously pointed to a source path that never had the 7 team skills (they were untracked local). New path: https://gitlab.com/tummadajingjing/vollos-skill-team (private)." \
  --remove-source-branch \
  --squash-before-merge
```

Capture MR URL from glab output.

### 6. Restore _board.md

```bash
git checkout feat/auth-rate-limit
git stash pop
git status --short  # should show M _board.md again + untracked dirs (back to original state)
```

## Acceptance Criteria

1. Branch `docs/update-l3-rule` pushed to origin with 1 commit
2. CLAUDE.md L3 rule replaced — new text contains `git@gitlab.com:tummadajingjing/vollos-skill-team.git` + symlink loop
3. L1, L2, L4, L5 rules unchanged (only L3 modified)
4. Other sections of CLAUDE.md unchanged (grep line count +/- expected delta for L3 multi-line expansion)
5. MR created with title `docs: update L3 rule...` targeting main
6. `_board.md` restored via stash pop — still has Lead's modifications
7. Working tree ends on `feat/auth-rate-limit` (original branch) with same state as start

## Security

- VOLLOS_CLI token (GitLab PAT) ต้องไม่ echo, ไม่ log, ไม่อยู่ใน output.md
- ใช้ `source .env && glab ...` pattern
- ไม่มี secrets ใน commit content (รูปแบบ ssh URL เป็น public info — ไม่ต้อง mask)

## Rollback

ถ้า MR มีปัญหา / content ผิด:
```bash
git checkout feat/auth-rate-limit
git branch -D docs/update-l3-rule  # delete local branch
git push origin --delete docs/update-l3-rule  # delete remote branch (if pushed)
glab mr close <MR_NUMBER>
```

## Expected Output

```yaml
task_id: T-024
status: passed | partial | failed

branch:
  created: docs/update-l3-rule
  from: origin/main (SHA)
  pushed: true

commit:
  sha: <SHA>
  message_first_line: "docs: update L3 rule — point to vollos-skill-team repo"

file_changes:
  CLAUDE.md:
    before_line: 185 (single-line L3)
    after_lines: 185-~198 (multi-line L3 block)
    lines_added: ~13
    lines_removed: 1

grep_verification:
  l_rules_count: 5  # L1-L5
  l3_contains_repo_url: true
  l3_contains_symlink_loop: true

mr:
  url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/<N>
  state: opened
  target_branch: main

working_tree_restored:
  back_on_branch: feat/auth-rate-limit
  board_md_restored_via_stash: true
  uncommitted_state_matches_start: true

self_review:
  only_l3_changed:
    result: true
    evidence: "git diff origin/main -- CLAUDE.md shows only L3 block changed"
  rendered_markdown_valid:
    result: true
    evidence: "nested code block uses valid 4-space or 3+4 tick pattern (verified via render)"
  no_secret_leaked:
    result: true
    evidence: "grep -i 'glpat\\|VOLLOS_CLI' output.md → 0 matches"
  board_restored:
    result: true
    evidence: "git status shows M _board.md back on feat/auth-rate-limit"
  placeholders_remaining: "none — grep for TODO/TBD/placeholder in L3 block = 0"
```

Begin. สำคัญ: ห้ามแตะไฟล์อื่นใน repo ยกเว้น `CLAUDE.md` + ยกเว้น git/branch/MR operations.

---
id: T-023
title: Bootstrap vollos-skill-team repo — migrate 7 global team skills to new GitLab repo + symlink
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-19T13:46:32+07:00
security_checkpoint: false
domain_consultation: null
dependencies: []
---

## Context

ปัจจุบัน 7 global workers (vollos-lead/backend/frontend/qa/auditor/devops/e2e-tester) อยู่ที่ `~/.claude/skills/` บนเครื่องเจ้านาย — **ไม่ได้ commit เข้า git ที่ไหนเลย** (ตรวจแล้ว: `git ls-files` ใน `~/.claude/skills` = 0 files สำหรับ 7 ตัวนี้).

ความเสี่ยง: ถ้าเครื่องพัง → ข้อมูล skill หายหมด ไม่มีทางกู้. Backup เดียวคือ `~/workspace/vollos/.claude.archived-20260418/skills/` ซึ่งอยู่ใน backlog ว่าจะลบหลัง deploy เสร็จ.

**Solution:** สร้าง GitLab repo ใหม่ `tummadajingjing/vollos-skill-team` (private) เก็บ 7 skill นี้โดยเฉพาะ + ใช้ symlink จาก `~/.claude/skills/` ไปชี้ที่ repo นั้น.

ตำแหน่งต่างๆ:
- GitLab URL: `git@gitlab.com:tummadajingjing/vollos-skill-team.git` (private, personal account — เจ้านายจะย้าย group เอง future)
- Local dev folder: `~/workspace/vollos-ai/vollos-skill-team/`
- Symlink source: `~/.claude/skills/vollos-<name>` → `~/workspace/vollos-ai/vollos-skill-team/vollos-<name>`

## 7 skills scope

```
vollos-lead          (180K)
vollos-backend       (92K)
vollos-frontend      (64K)
vollos-qa            (84K)
vollos-auditor       (84K)
vollos-devops        (104K)
vollos-e2e-tester    (28K)
```

Total ~650K — small, no concern about git size.

## Steps

### 1. Create GitLab repo (private)

```bash
source /home/ipon/workspace/vollos/.env
# VOLLOS_CLI token already loaded — do NOT echo it
glab auth status 2>/dev/null || glab auth login --token "$VOLLOS_CLI" --hostname gitlab.com
glab repo create tummadajingjing/vollos-skill-team --private --description "VOLLOS team global skills (vollos-lead/backend/frontend/qa/auditor/devops/e2e-tester)" --defaultBranch main
```

**Secret handling:** ห้าม `echo $VOLLOS_CLI` / ห้าม log token / ห้าม copy-paste ลงที่ไหน. ใช้ `source .env && glab ...` flow เท่านั้น.

### 2. Create local dev folder + copy 7 skills

```bash
mkdir -p ~/workspace/vollos-ai/vollos-skill-team
cd ~/workspace/vollos-ai/vollos-skill-team
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  cp -r ~/.claude/skills/$skill ./
done
ls -la  # verify 7 folders exist
```

**IMPORTANT:** ใช้ `cp -r` (copy, not move) — original ยังอยู่ที่ `~/.claude/skills/` ขั้นตอนนี้. จะ rename ทีหลังใน step 5.

### 3. Init git + commit + push

```bash
cd ~/workspace/vollos-ai/vollos-skill-team
git init
git branch -M main
git remote add origin git@gitlab.com:tummadajingjing/vollos-skill-team.git

# Add .gitignore (minimal — node_modules / .DS_Store / tmp)
cat > .gitignore <<'EOF'
node_modules/
.DS_Store
*.tmp
*.bak
__pycache__/
.pytest_cache/
EOF

# Add README
cat > README.md <<'EOF'
# vollos-skill-team

VOLLOS team global skills — Claude Code skill collection ที่ใช้กับ VOLLOS monorepo multi-repo setup.

## 7 skills in this repo

- **vollos-lead** — Tech Lead / Orchestrator (spawn + coordinate team)
- **vollos-backend** — API + DB + business logic
- **vollos-frontend** — UI/UX implementation
- **vollos-qa** — Functional testing + edge cases
- **vollos-auditor** — Security + compliance audit
- **vollos-devops** — Docker Compose + Caddy + VPS + CI/CD
- **vollos-e2e-tester** — Playwright E2E testing

## Install (new machine)

```bash
git clone git@gitlab.com:tummadajingjing/vollos-skill-team.git ~/workspace/vollos-ai/vollos-skill-team
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  ln -s ~/workspace/vollos-ai/vollos-skill-team/$skill ~/.claude/skills/$skill
done
```

## Source of truth

Single source = this repo. แก้ SKILL.md ที่ `~/workspace/vollos-ai/vollos-skill-team/` เท่านั้น → commit → push. Symlink ที่ `~/.claude/skills/` จะชี้มาที่ไฟล์เดียวกัน Claude Code จะเห็นทันที.
EOF

git add -A
git -c commit.gpgsign=false commit -m "feat: bootstrap 7 VOLLOS team global skills

Migrate vollos-{lead,backend,frontend,qa,auditor,devops,e2e-tester}
from ~/.claude/skills/ (untracked local) to this git repo as single
source of truth. Prevents skill loss on machine failure.

Skills total size ~650K — 7 SKILL.md + references/ folders each."
git push -u origin main
```

### 4. Verify push

```bash
# Verify remote has the commit
git ls-remote origin main  # should show commit SHA
glab repo view tummadajingjing/vollos-skill-team  # should show repo exists
```

### 5. Rename originals to .bak + create symlinks

```bash
BAKDATE=20260419
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  # Safety: only proceed if original exists AND new copy exists AND backup doesn't already exist
  if [ -d ~/.claude/skills/$skill ] && [ ! -L ~/.claude/skills/$skill ] \
     && [ -d ~/workspace/vollos-ai/vollos-skill-team/$skill ] \
     && [ ! -e ~/.claude/skills/$skill.bak-$BAKDATE ]; then
    mv ~/.claude/skills/$skill ~/.claude/skills/$skill.bak-$BAKDATE
    ln -s ~/workspace/vollos-ai/vollos-skill-team/$skill ~/.claude/skills/$skill
    echo "✅ $skill → symlinked"
  else
    echo "❌ $skill — skipped (pre-condition failed)"
  fi
done
```

### 6. Verify symlinks + content integrity

```bash
# All 7 should be symlinks
ls -la ~/.claude/skills/ | grep "^l" | grep "vollos-" | awk '{print $9, "→", $11}'

# readlink output for each
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  echo "$skill → $(readlink ~/.claude/skills/$skill)"
done

# Diff new location vs backup (should be 0 diff)
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  diff_count=$(diff -rq ~/workspace/vollos-ai/vollos-skill-team/$skill ~/.claude/skills/$skill.bak-20260419 2>/dev/null | wc -l)
  echo "$skill: diff=$diff_count (expect 0)"
done

# Claude Code should still see the skill via symlink — read through symlink
head -5 ~/.claude/skills/vollos-lead/SKILL.md  # should show "# Tech Lead — VOLLOS"
```

## Acceptance Criteria

1. GitLab repo `tummadajingjing/vollos-skill-team` exists + private + default branch main
2. Local folder `~/workspace/vollos-ai/vollos-skill-team/` exists with 7 skill folders + .gitignore + README.md
3. Git committed + pushed to `origin/main` — `git ls-remote origin main` returns SHA
4. 7 original folders renamed to `~/.claude/skills/vollos-<name>.bak-20260419`
5. 7 symlinks exist at `~/.claude/skills/vollos-<name>` → pointing to new location
6. `readlink` on all 7 returns absolute path ending in `~/workspace/vollos-ai/vollos-skill-team/vollos-<name>`
7. `diff -rq` new folder vs .bak folder = 0 differences (no content drift)
8. Read through symlink works — `head ~/.claude/skills/vollos-lead/SKILL.md` shows expected content

## Security

- **SECRET HANDLING protocol** — `VOLLOS_CLI` token ห้าม echo, ห้าม log, ห้าม copy paste
- ใช้ `source /home/ipon/workspace/vollos/.env && glab ...` pattern
- Post-task: clear bash history if any command contained secrets (`history -c && history -w`)
- `.gitignore` ต้องมี `*.bak` เผื่อไฟล์สำรองหลงเข้ามา
- ตรวจว่า `.env` ไม่ได้อยู่ใน 7 skill folders (`find ~/workspace/vollos-ai/vollos-skill-team -name ".env"` → expect 0)

## Rollback Plan

ถ้า step 5 fail ครึ่งทาง หรือ verify step 6 ไม่ผ่าน:

```bash
# Remove any partial symlinks + restore originals
for skill in vollos-lead vollos-backend vollos-frontend vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
  if [ -L ~/.claude/skills/$skill ]; then
    rm ~/.claude/skills/$skill
  fi
  if [ -d ~/.claude/skills/$skill.bak-20260419 ]; then
    mv ~/.claude/skills/$skill.bak-20260419 ~/.claude/skills/$skill
  fi
done
```

## Post-Task (Owner manual — NOT DevOps responsibility)

เจ้านายทำเองหลัง DevOps เสร็จ:
1. ปิด Claude Code session ปัจจุบัน
2. เปิด terminal ใหม่ → `cd /home/ipon/workspace/vollos-ai/vollos-core && claude`
3. พิมพ์ `/vollos-lead` → ควรโหลดปกติ (จาก symlink)
4. ถ้า OK → ลบ backup: `rm -rf ~/.claude/skills/vollos-*.bak-20260419`
5. ถ้าไม่ OK → รัน rollback plan ด้านบน

## Expected Output

```yaml
task_id: T-023
status: passed | partial | failed

gitlab_repo:
  url: https://gitlab.com/tummadajingjing/vollos-skill-team
  visibility: private
  default_branch: main
  created: true

local_folder:
  path: ~/workspace/vollos-ai/vollos-skill-team
  skills_copied: 7
  readme: true
  gitignore: true

git_state:
  initial_commit_sha: <sha>
  pushed_to_origin_main: true
  ls_remote_verified: <sha same as initial>

symlinks_created:
  - "~/.claude/skills/vollos-lead → ~/workspace/vollos-ai/vollos-skill-team/vollos-lead"
  - ... (7 entries)

content_integrity:
  diff_per_skill:
    vollos-lead: 0
    vollos-backend: 0
    # ... 7 entries, all 0

read_through_symlink:
  vollos_lead_skill_md_first_line: "# Tech Lead — VOLLOS"

backups_created:
  - "~/.claude/skills/vollos-lead.bak-20260419"
  - ... (7 entries)

self_review:
  repo_created:
    result: true
    evidence: "glab repo view output / ls-remote SHA match"
  symlinks_functional:
    result: true
    evidence: "readlink + head through symlink both succeed"
  no_content_drift:
    result: true
    evidence: "diff -rq 7 pairs = 0 differences"
  secret_handling_ok:
    result: true
    evidence: "VOLLOS_CLI never echoed / git history clean of tokens"
  rollback_available:
    result: true
    evidence: ".bak folders exist — can be restored"
  placeholders_remaining: "N/A — no code edit"

issues: []
```

Begin. ห้ามแก้ไฟล์ใน repo อื่น (vollos-core / acmd) — task นี้อยู่นอก vollos-core ทั้งหมด (ทำบน ~/.claude/skills/ + ~/workspace/vollos-ai/vollos-skill-team/).

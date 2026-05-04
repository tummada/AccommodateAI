---
id: T-075
title: Commit untracked _workspace/ folders per new D14 policy (T-062/output.md + T-063..T-074)
assigned_to: vollos-devops
priority: medium
spawn_started_at: 2026-04-20T17:30+07:00
dependencies: [T-073, T-074]
owned_files: []    # only commits workspace files — no code changes
---

## Context

T-073 policy merged (main HEAD `498630f`) — `_workspace/` commit as audit trail + mandatory 9-pattern secret scan **required now**

Current untracked folders (verified via `git status --short`):
- `T-062/output.md` (existing folder, 1 untracked file from session tail)
- `T-063/` (A-1 smoke test — DevOps + Auditor)
- `T-064/` (A-1 audit)
- `T-065/` (A-2 rollback + Telegram + simulation)
- `T-066/` (A-2 audit)
- `T-067/` (A-3 Part 1 MEDIUM fixes)
- `T-068/` (A-3 Part 1 audit)
- `T-069/` (broken commit for rollback test)
- `T-070/` (revert broken)
- `T-071/` (A-3 Part 3 flip to on_success)
- `T-072/` (A-3 Part 3 audit)
- `T-073/` (workspace policy)
- `T-074/` (policy audit)
- `T-075/` (this task — task.md will be added in this commit too)

Also untracked:
- `security-check-output/` — now in `.gitignore` per T-073, should NOT stage

## Scope (commit only — no code/config changes)

**Step 1: Mandatory 9-pattern secret scan** (per T-073 policy + T-062 precedent):

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
# run each pattern on all T-062..T-075 folders
grep -rE "glpat-[0-9a-zA-Z_-]{20,}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "ghp_[0-9a-zA-Z]{36}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "AKIA[0-9A-Z]{16}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "-----BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY-----" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "NODEMAILER_OAUTH2_REFRESH_TOKEN=1//" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
grep -rE "password\s*[=:]\s*['\"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}" _workspace/T-06[2-9] _workspace/T-07[0-5] 2>/dev/null
```

**Expected:** 0 matches (agents were instructed secret-handling protocol — verified by Lead spot-check throughout session)

**ถ้าเจอ match:**
1. redact ด้วย `sed -i 's/<exact_secret>/***REDACTED***/g' <path>` ก่อน commit
2. re-scan → 0 matches required before proceeding
3. ระบุใน output.md `redactions_applied:` list

**Step 2: Commit via git add per-folder** (ห้ามใช้ `git add .` — ป้องกันเผลอ stage ไฟล์อื่น):

```bash
git checkout -b chore/workspace-audit-trail-session-20260420-part2 origin/main
git add _workspace/T-062/output.md
git add _workspace/T-063/ _workspace/T-064/ _workspace/T-065/ _workspace/T-066/
git add _workspace/T-067/ _workspace/T-068/ _workspace/T-069/ _workspace/T-070/
git add _workspace/T-071/ _workspace/T-072/ _workspace/T-073/ _workspace/T-074/
git add _workspace/T-075/   # this task.md + output.md being written
```

**ห้าม stage:**
- `_board.md` (working tree modified — separate concern)
- `security-check-output/` (already in .gitignore but double-check not staged)
- Any file outside `_workspace/T-062..T-075/`

**Step 3: Commit + push + MR**

```bash
git commit -m "chore: sync workspace audit trail — session 2026-04-20 Phase A (T-062..T-075)"
git push -u origin chore/workspace-audit-trail-session-20260420-part2
glab mr create --title "chore: sync workspace audit trail — session 2026-04-20 Phase A (T-062..T-075)" \
  --target-branch main \
  --description "Commits 14 workspace folders (Phase A auto-deploy work + policy + revert cycle). Secret scan run per D14 policy (CLAUDE.md L98-128) — 0 matches across 9 patterns. See T-075/output.md for scan details."
```

## Acceptance Criteria

1. 9-pattern secret scan run บน T-062..T-075 — **0 matches** (ถ้าเจอ → redact + re-scan + document in output.md)
2. Branch `chore/workspace-audit-trail-session-20260420-part2` from `origin/main` (HEAD=`498630f`)
3. **เฉพาะ** `_workspace/T-062..T-075/` staged — ห้าม stage `_board.md`, `security-check-output/`, หรือไฟล์อื่น
4. Conventional commit message ระบุ scope ชัดเจน (Phase A range)
5. MR opened — **NOT merged**
6. Pipeline test + build green on MR; deploy auto-triggered (per on_success policy, will run post-merge)
7. Output.md มี paste ของ 9-pattern scan command outputs (เต็ม — ไม่มี match ก็ชัดว่ารันจริง)

## Branch + MR discipline

- ห้าม push main ตรง
- ห้าม merge MR
- ห้ามแตะไฟล์อื่นนอก workspace folders
- `_board.md` **ห้ามแตะ** ใน commit นี้ (separate concern)

## Output (output.md)

- `self_review`: 7 AC + evidence
- `secret_handling`: `"9-pattern scan run pre-push, 0 matches"` (per D14 policy requirement)
- `scan_outputs`: full paste ของ 9 grep commands + outputs
- `files_staged`: list ของ path ที่ staged (verify ไม่มี out-of-scope)
- `files_NOT_staged`: `_board.md`, `security-check-output/` — confirm excluded
- `mr_url`, `commit_sha`, `pipeline_url`
- `redactions_applied`: list (ถ้ามี) หรือ `none — scan clean`
- `blocker`: null/details

## Definition of Done

- [ ] MR opened, not merged
- [ ] Pipeline green
- [ ] Secret scan 0 matches (or redactions documented + re-scan clean)
- [ ] Only workspace files staged (diff scope verified)
- [ ] output.md complete

## After this task

1. Lead spot-check diff + scan outputs
2. Skip formal Auditor (docs/audit-trail commit, no code — similar to T-062 precedent)
3. Owner merges → auto-deploy runs (docs + audit files, no real infra change)
4. Session #006 complete — Phase A history fully committed to git

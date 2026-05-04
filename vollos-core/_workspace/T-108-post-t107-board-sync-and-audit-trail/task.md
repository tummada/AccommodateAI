# T-108 — Post-T-107 board sync + audit trail commit (6 workspace folders)

## Summary
After T-107 merged to main (`aa8ee4f`), restore Lead's stashed session #012 board edits, mark T-107 done in `_board.md`, and commit the 6 untracked `_workspace/` folders (T-102/T-103/T-104/T-105/T-106/T-107) per D14 + `_workspace/` Git Policy. Single MR.

## Why this needs DevOps (not Lead direct)
- Lead Technical Boundary: Lead cannot run `git stash pop` / `git switch` / `git commit` / `git push` (write-state git commands)
- Lead `_board.md` edit can be done via Edit tool, but the rebase/stash mechanics + commit + MR require DevOps
- Precedent T-105 used DevOps + pipeline-small for the same kind of post-merge board sync (caught a stale-base near-miss — see _board.md session #011 closing entry)

## Pipeline routing
- **task_type:** Mixed (board content edit + git mechanics + audit trail) — closest match: DevOps/Infra
- **pipeline:** `pipeline-small` (rubric 0 YES — single MR, no design spec, no production risk, no security implication)
- **rubric_yes_count:** 0
- **reviewer_scope:**
  - **Auditor:** Security Hardening — verify (a) 9-pattern secret scan on all 6 workspace folders pre-push, 0 matches; (b) no secrets/tokens introduced into _board.md; (c) git operations don't expose stashed content via reflog leak
  - **QA:** Infra Correctness — verify (a) board edits are surgical (T-107 entry moved Active→Done with full evidence row, session #012 anchor present, spawn counter updated, T-103 closed entry preserved); (b) all 6 audit-trail folders committed (no missing files); (c) conventional commit; (d) MR opens against main; (e) base is fresh `origin/main` HEAD = `aa8ee4f` (post-T-107)

## Mandatory QA/Auditor Gate check
- ✅ NOT triggering Mandatory Override (no auth/JWT/email/payment/public endpoint/PII/CORS/TLS/deploy)
- → pipeline-small appropriate

## owned_files
- `_board.md` (Lead writable — but DevOps will produce final state via git mechanics)
- `_workspace/T-102-commit-board-and-workspace-audit-trail/` (already exists, untracked)
- `_workspace/T-103-delete-best-practice-section-2-5/` (already exists, untracked)
- `_workspace/T-104-cleanup-claude-and-best-practice/` (already exists, untracked)
- `_workspace/T-105-board-sync-after-t104/` (already exists, untracked)
- `_workspace/T-106-session-011-close/` (already exists, untracked)
- `_workspace/T-107-grant-references-acmd-default-privs/` (already exists, untracked — created during T-107 work)
- `_workspace/T-108-post-t107-board-sync-and-audit-trail/` (this task's own folder, untracked)

**FORBIDDEN:** any other file in the repo (no code/config/CI/CD/Docker changes)

## Background — what's in the stash
`git stash list` shows:
- `stash@{0}: On chore/board-session-011-close: T-107-stash-before-branch` — created by T-107 DevOps before branching from fresh main. Contains:
  - `_board.md` modifications: session #012 anchor row, T-103 closure (moved Active→Done), T-107 active entry, spawn counter update (`spawn_count: 1`, `last_re_read_at: 2026-04-30T11:10+07:00`)
  - Possibly the 5 untracked folders T-102..T-106 (untracked-files were stashed via `--include-untracked` — verify with `git stash show -u stash@{0}`)
- `stash@{1}: On chore/best-practice-delete-section-2-5: T-105 board working tree` — older, NOT TOUCH (leftover from T-105 — already restored at that time, this is a residue; verify it has no unmerged content before deciding fate, but default = leave alone)

**Risk:** popping stash@{0} on top of fresh main may cause conflict in `_board.md` because main now has session #011 closing entry that the stashed working-tree version did NOT have. DevOps must handle conflict cleanly.

## acceptance_criteria
1. **Switch to fresh main:**
   - `git fetch origin main` (verify HEAD = `aa8ee4f` post-T-107 merge)
   - `git switch main && git pull --ff-only origin main`
   - Confirm `git log --oneline -2` shows `aa8ee4f` and `0841ecc`
2. **Create new branch from fresh main:**
   - `git switch -c chore/board-sync-after-t107 origin/main`
3. **Restore stash@{0} content into branch — but DO NOT pop blindly. Strategy:**
   - First: `git stash show -u stash@{0}` to inspect what's in it (board diff + untracked files)
   - Try: `git stash apply stash@{0}` (apply not pop — keep stash as backup)
   - If conflict on `_board.md`: resolve manually by re-applying only these surgical edits on top of CURRENT main's `_board.md`:
     - Add session #012 anchor row to Session Anchor Log table (after `#011 closing` row): timestamp `2026-04-30 10:56 ICT`, content per the stashed version (DevOps may need to read stashed `_board.md` via `git show stash@{0}:_board.md` to see what Lead wrote)
     - Move T-103 from Active Tasks → Done table (T-103 entry: closed by owner confirmation 2026-04-30 11:00 ICT)
     - Add T-107 active entry → then **immediately move T-107 to Done** (since T-107 is now merged, single transition is fine)
     - Update Spawn Counter section: `spawn_count: 4 (session #012 — T-107 [Writer+Auditor+QA] + T-108 [in-progress])`, `last_re_read_at: 2026-04-30T11:10+07:00` (or update to current time on board edit)
   - If no conflict: review `git diff` and confirm the auto-applied content matches expectation, then **add the T-107 Done row manually** (T-107 wasn't in stash since it was merged after stashing)
4. **Add T-107 Done row** in `_board.md` Done — เมษายน 2026 table after T-104 row:
   ```
   | T-107 | Add REFERENCES to ALTER DEFAULT PRIVILEGES for acmd schema (init-db.sh template) — pipeline-small | 2026-04-30T11:26+07:00 | ✅ Pipeline-small: DevOps Writer (Opus) + Auditor + QA fresh-eye, 1 round, 0 CRITICAL/HIGH/MEDIUM/LOW (Auditor 7 confirmation Notes, QA 8 confirmation Notes incl. postgres docs cross-check). DevOps end-to-end runtime test on throwaway postgres:16-alpine: \dp acmd.users showed acmd_user=arwdx/vollos (x=REFERENCES); has_table_privilege t; auth control f. Lead spot-check: shellcheck 0, 9-pattern secret scan 0, diff +2/-1 single file (acmd block only, auth+vollos byte-identical), conventional commit, MR !43 pipeline 2490688047 success 59s. Cross-team request from Lead@acmd (T-118 FIX local migrations) — Lead pushed back on owner's literal request to avoid init-db.sh crash + proposed ALTER DEFAULT PRIVILEGES instead, owner approved. | `0841ecc` → MR !43 merged `aa8ee4f` |
   ```
5. **Stage all 7 workspace folders + _board.md:**
   - `git add _board.md _workspace/T-102-* _workspace/T-103-* _workspace/T-104-* _workspace/T-105-* _workspace/T-106-* _workspace/T-107-* _workspace/T-108-*`
6. **Run 9-pattern secret scan** on all 7 staged folders before commit (per CLAUDE.md "Mandatory Secret Scan ก่อน push _workspace"):
   ```bash
   grep -rE "glpat-[0-9a-zA-Z_-]{20,}" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "ghp_[0-9a-zA-Z]{36}" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "AKIA[0-9A-Z]{16}" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "-----BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY-----" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "NODEMAILER_OAUTH2_REFRESH_TOKEN=1//" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}" _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' _workspace/T-{102,103,104,105,106,107,108}-*
   grep -rE "password\s*[=:]\s*['\"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}" _workspace/T-{102,103,104,105,106,107,108}-*
   ```
   Expect 0 matches. If any match: redact via `sed -i 's/<secret>/***REDACTED***/g'` + re-scan.
7. **Single commit** (conventional commit):
   `chore(board): sync session #012 — T-107 done + audit trail T-102..T-108 (D14)`
8. **Push** to `chore/board-sync-after-t107` branch + open MR via `glab mr create --target-branch main --title "chore(board): sync session #012 — T-107 done + audit trail T-102..T-108 (D14)" --description "..."`
9. **Drop stash@{0}** AFTER successful push (only if apply was clean and content verified) — `git stash drop stash@{0}`. If unsure or conflict happened, leave stash alone and note in output.md.
10. **Leave stash@{1}** alone (don't drop — it's older context, owner can decide later)
11. `_workspace/T-108-post-t107-board-sync-and-audit-trail/output.md` complete with self_review (every field result: true + evidence file:line per CLAUDE.md "Agent Self-Review")

## domain_consultation
- N/A (board sync + git mechanics, no domain logic)

## spawn_started_at
2026-04-30T11:30+07:00

## Worker briefing

You are the **DevOps Worker** for T-108 in vollos-core. Read this entire task.md first.

This is a follow-up to T-107 (just merged as MR !43, main HEAD = `aa8ee4f`). Your job: restore Lead's stashed session #012 work onto fresh main, mark T-107 done in `_board.md`, and commit 7 audit-trail workspace folders (T-102..T-108) in a single MR per D14.

**Be careful with the stash:** stash@{0} was made on a stale base before T-107 merged. The `_board.md` in that stash does NOT have the T-104/T-105 session #011 closing entry that's now on main. Use `git stash apply` (NOT pop) to keep stash as backup until the apply is verified clean. If conflict on `_board.md`, resolve by re-applying only the surgical edits described in acceptance_criteria #3 — DO NOT discard main's content.

**Stash inspection commands:**
- `git stash show stash@{0}` — see file list
- `git stash show -u stash@{0}` — see file list including untracked
- `git show stash@{0}:_board.md` — see the stashed _board.md content (to know what Lead wrote)
- `git stash show -p stash@{0} -- _board.md` — see the diff

**Critical constraints:**
- ❌ NO touching code/config (only `_board.md` + audit-trail folders)
- ❌ NO `git push --force`, NO bypassing pipeline
- ❌ NO `git stash drop` until commit pushed and verified clean
- ❌ NO `--no-verify`, NO secret scan skip
- ✅ Branch from FRESH `origin/main` (`aa8ee4f`)
- ✅ Conventional commit format
- ✅ Self-review with file:line evidence

**Output:** ≤200-word summary back to Lead with MR URL, conflict resolution outcome (clean apply / manual resolve), stash drop status (dropped / left intact + reason).

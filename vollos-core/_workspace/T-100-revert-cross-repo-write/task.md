---
task_id: T-100
title: REVERT cross-repo write — close skill-team MR !3, delete branch + file, move review into vollos-core repo, update vollos-core MR !36
spawn_started_at: 2026-04-29T20:25:00+07:00
agent_role: devops
priority: HIGH (cleanup of governance violation from T-099)
---

# Task T-100 — Revert Cross-Repo Write

## Background (read before acting)

**Owner directive (verbatim):** "ทำไมต้องไปแก้ไฟล์ของคนอื่นครับ จะทำไรก็ทำ อย่าไปยุ่งกับคนอื่น แย่มาก"

T-099 (the previous task) instructed you to write a review file into `vollos-skill-team` repo and open MR !3 there. **That was wrong.** vollos-skill-team is a separate repo with its own scope; vollos-core Lead must NOT push files into it, even though owner is the same person. Reviews/decisions of vollos-core Lead must live INSIDE vollos-core repo.

This task reverts the cross-repo violation cleanly and keeps the legitimate vollos-core CLAUDE.md change.

## What stays (do NOT revert)

- **vollos-core MR !36** (`feat/file-based-revision-tier-b`) — the CLAUDE.md policy block — KEEPS, but with a small update to fix the broken reference path (see Deliverable 2 below).
- **vollos-core `_board.md`** — D14, D15, D16 entries already in working tree — leave alone for now (separate board commit will follow).

## What MUST be undone

### Deliverable 1 — Tear down vollos-skill-team contribution

Working dir for this section: `/home/ipon/workspace/vollos-ai/vollos-skill-team`

1. Close MR !3 on `vollos-skill-team` (state: closed, NOT merged)
   - Use `glab mr close 3` or equivalent. Add a closing comment: "Closed per owner directive — review will live in vollos-core repo instead. Apologies for the cross-repo write."
2. Delete the remote branch: `git push origin --delete docs/vollos-core-review-multi-iter-pattern`
3. Delete the local branch: `git branch -D docs/vollos-core-review-multi-iter-pattern`
4. Delete the local file: `rm -f multi-iter-revision-pattern-REVIEW-vollos-core.md` (it was on the working tree; ensure it's gone)
5. Verify clean: `git status` on skill-team should NOT mention the review file. `git log origin/main --oneline -5` should NOT include commit `0e1d231` after refresh (it was on the deleted branch only — never reached main, so refresh confirms it's orphaned).
6. **Do NOT touch any other file in vollos-skill-team.** Specifically: leave the untracked `multi-iter-revision-pattern.md` DRAFT alone — it's not ours.

### Deliverable 2 — Move review into vollos-core repo + fix CLAUDE.md reference path

Working dir for this section: `/home/ipon/workspace/vollos-ai/vollos-core`

1. **Switch to branch `feat/file-based-revision-tier-b`** (the existing MR !36 branch). DO NOT create a new branch.
2. **Create file** `_workspace/T-099-adopt-file-based-tier-b/review-of-skill-team-draft.md` with EXACTLY the same content as the deleted `multi-iter-revision-pattern-REVIEW-vollos-core.md`. (You wrote that content in T-099 — recreate it here verbatim from the same task.md spec at `_workspace/T-099-adopt-file-based-tier-b/task.md` lines 31-90.)
3. **Edit CLAUDE.md** — find the "Review:" line in the new "File-Based Revision Pattern" section and update the path:
   - OLD: `**Review:** \`~/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern-REVIEW-vollos-core.md\``
   - NEW: `**Review:** \`_workspace/T-099-adopt-file-based-tier-b/review-of-skill-team-draft.md\` (vollos-core internal)`
   - The "Source doc:" line stays unchanged (`~/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern.md`) — that's a READ reference to someone else's doc, not a write.
4. **Commit + push** to the same branch `feat/file-based-revision-tier-b`:
   - Commit message: `fix: move review into vollos-core repo (revert cross-repo write)`
   - This adds 1 new file in `_workspace/` + 1-line edit in CLAUDE.md → second commit on the existing MR !36.
5. **Do NOT close or reopen MR !36** — just push the new commit; GitLab will auto-update the MR with the additional commit.
6. **Add MR !36 comment**: "Added second commit to move review into vollos-core repo per owner directive (cross-repo write was reverted in T-100). Skill-team MR !3 has been closed without merge."

## Acceptance Criteria

- [ ] AC1: skill-team MR !3 has `state: closed` (not merged) — verify via `glab mr view 3 --output json | grep state`
- [ ] AC2: skill-team remote branch `docs/vollos-core-review-multi-iter-pattern` is gone — verify via `git ls-remote --heads origin docs/vollos-core-review-multi-iter-pattern` returns empty
- [ ] AC3: skill-team local branch deleted — verify via `git branch | grep docs/vollos-core-review-multi-iter-pattern` returns empty
- [ ] AC4: skill-team file `multi-iter-revision-pattern-REVIEW-vollos-core.md` does NOT exist on local filesystem — verify via `ls multi-iter-revision-pattern-REVIEW-vollos-core.md` returns "No such file"
- [ ] AC5: skill-team `git status` is clean (or only contains the pre-existing untracked DRAFT) — verify via `git status --short`
- [ ] AC6: vollos-core file `_workspace/T-099-adopt-file-based-tier-b/review-of-skill-team-draft.md` exists with verbatim content from task.md:31-90 (the review block from T-099)
- [ ] AC7: vollos-core CLAUDE.md "Review:" line updated to point to internal path — verify via `grep "Review:" CLAUDE.md` shows new path
- [ ] AC8: vollos-core MR !36 has 2 commits (original `f51fd6d` + new revert/move commit) — verify via `glab mr view 36 --output json | grep -E "(sha|web_url)"` and `git log feat/file-based-revision-tier-b ^origin/main --oneline`
- [ ] AC9: vollos-core MR !36 still `state: opened` and `detailed_merge_status: mergeable` — verify via `glab mr view 36`
- [ ] AC10: 9-pattern secret scan: 0 new matches on the new review file
- [ ] AC11: self_review field included in output.md per CLAUDE.md "Agent Self-Review" rule

## Owned Files

- `/home/ipon/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern-REVIEW-vollos-core.md` (DELETE)
- `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-099-adopt-file-based-tier-b/review-of-skill-team-draft.md` (CREATE)
- `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` (EDIT — 1 line only)

## Out of Scope (do NOT touch)

- Do NOT touch `multi-iter-revision-pattern.md` DRAFT in skill-team — not ours.
- Do NOT touch any other file in skill-team beyond closing MR + deleting branch.
- Do NOT touch vollos-core `_board.md` (already modified by Lead in working tree, separate commit will follow).
- Do NOT modify the vollos-core CLAUDE.md "## File-Based Revision Pattern" section beyond the single "Review:" line update.

## Reporting

Write `_workspace/T-100-revert-cross-repo-write/output.md` per the same schema as T-099 (status, deliverables, acceptance_criteria, self_review, secret_handling, placeholders_remaining, files_changed, notes).

## Inject reminders (verbatim from CLAUDE.md / lesson learned)

- **Cross-repo writes are forbidden** — this task is a cleanup of that exact violation. Do NOT introduce new cross-repo writes while fixing the existing one.
- Conventional commit (`fix:`).
- 9-pattern secret scan before push.
- No `--no-verify`.
- Self-review mandatory.

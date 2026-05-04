---
task_id: T-027
status: completed
assigned_to: vollos-devops
spawn_started_at: 2026-04-19T15:30+07:00
completed_at: 2026-04-19T15:55+07:00
---

## Summary

Cleanup 6 stale references to `roadmap.md` / `TODO.md` / `CHANGELOG.md` in `vollos-lead/SKILL.md` per D7 (single-source-of-truth = `_board.md`). All 6 edits applied verbatim per spec. Branch pushed, MR opened (not merged — waiting owner).

## skill_loaded_evidence

files_read:
  - "SKILL.md:L36-39 — SECRET HANDLING (non-negotiable — read FIRST). ก่อนรัน command ที่อาจ resolve env vars/secrets → หยุด. อ่าน memory feedback_secret_handling_protocol.md ก่อน"
  - "SKILL.md:L56-58 — Routing Protocol: รับคำสั่งจาก Lead เท่านั้น, เขียน output ลง _workspace/{task-id}/, ห้าม spawn Agent tool"
  - "SKILL.md:L67-75 — Before Starting: อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข, ถ้าไม่รู้ → ถาม Lead ก่อน ห้ามเดา"
  - "SKILL.md:L390-402 — Pre-Delivery Checklist (applied where relevant for docs change)"
  - "SKILL.md:L426 — Knowledge staleness: ถ้าไม่แน่ใจ ห้ามใช้ knowledge เก่าโดยไม่เตือน"

## re_anchor_evidence

- "Critical Rules: read before delivery (SKILL.md:L464-471 — ห้ามบอก เสร็จ โดยไม่แสดง verification output)"
- "Security Rules: read before delivery (SKILL.md:L264-274 — no secrets display, secret handling protocol)"
- "No secrets touched in this task (docs-only cleanup, no .env / token / password involved)"

## files_changed

- path: /home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-lead/SKILL.md
  action: modified
  existing_read: "SKILL.md:L75-76, L87, L248, L429, L445, L461 — read all target lines before editing per Before Starting step 3"
  edits:
    - line: 75
      action: modified
      detail: "removed `_workspace/roadmap.md` from CONTINUE mode read list"
    - line: 76
      action: modified
      detail: "removed `roadmap.md` + `_conventions-core.md` from FULL mode read list"
    - line: 87
      action: modified
      detail: "trimmed Tool Gate allowlist to `_board.md / task.md`"
    - line: 429
      action: deleted
      detail: "removed obsolete rule 'ห้าม overwrite roadmap.md'"
    - line: 445
      action: modified
      detail: "trimmed Technical Boundary Rule whitelist to `_board.md / task.md`"
    - line: 461
      action: modified
      detail: "fast-track trigger now updates `_board.md` (Session Anchor Log / Notes) instead of `roadmap.md`"

## verification_output

### grep roadmap/TODO/CHANGELOG after edit (expected: 1 match only on L248)
command: `grep -n "roadmap\.md\|TODO\.md\|CHANGELOG\.md" vollos-lead/SKILL.md`
result: 1 match on L248 only (the T-025 D7 forbid-list, preserved as intended)

### L248 intact check
command: `grep -n "Minimum File Structure" vollos-lead/SKILL.md`
result: 1 match on L248 — content unchanged from main (still contains the D7 forbid-list with `TODO.md` / `CHANGELOG.md` / `_workspace/roadmap.md` / `_conventions-core.md`)

### git diff main size
command: `git diff main -- vollos-lead/SKILL.md`
result: 5 insertions + 6 deletions = 5 modifications + 1 pure deletion (L429)

### Forge-protected sections untouched
- Routing Protocol: not in diff hunks
- Critical Rules header (L426): not modified, only L429 bullet removed (explicitly allowed per task spec)
- execution_personas: not in diff hunks
- skill_metadata: not in diff hunks

### git state
- branch: docs/cleanup-stale-file-references (NOT main)
- commit: 2449764 docs(vollos-lead): cleanup stale roadmap/TODO/CHANGELOG references per D7
- remote: pushed to origin/docs/cleanup-stale-file-references
- working tree: clean

### MR
- MR IID: !2
- URL: https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/2
- state: opened (NOT merged — awaiting owner)
- source: docs/cleanup-stale-file-references
- target: main

## placeholders_remaining

none — grep clean (no `alert(` / `coming soon` / `TODO` / `TBD` / `mock` / `not implemented` / `Phase [0-9]` in the docs diff hunks — and this was a docs-only cleanup with no code involved)

## self_review

all 8 acceptance criteria verified with file:line evidence:

- criterion: "6 บรรทัดแก้ตามสเปคข้างบนเป๊ะ (L75, L76, L87, L429 [ลบ], L445, L461)"
  result: true
  evidence: "git diff main -- vollos-lead/SKILL.md shows exactly 5 modifications + 1 deletion at L75, L76, L87, L429, L445, L461 matching spec verbatim (diff lines: -75/+75, -76/+76, -87/+87, -429 delete, -445/+445, -461/+461)"

- criterion: "L248 (Minimum File Structure bullet) ไม่ถูกแตะ — grep ยังเจอ"
  result: true
  evidence: "SKILL.md:L248 content identical to main — still reads 'Minimum File Structure (ตาม D7): Project ใหม่ทุกตัว scaffold แค่ CLAUDE.md + _board.md + _workspace/T-XXX/ ... ห้ามสร้าง TODO.md / CHANGELOG.md / _workspace/roadmap.md / _conventions-core.md แยก'; git diff contains no changes to L248"

- criterion: "Forge-protected sections ไม่ถูกแตะ"
  result: true
  evidence: "git diff hunks only span L72-L92 (Session Recovery + Action Gate) and L426-L463 (Critical Rules bullets + Decision Mode table). Routing Protocol (L49-59), execution_personas (L473+), skill_metadata (L7-32) all outside diff range"

- criterion: "grep -n roadmap/TODO/CHANGELOG หลังแก้ → ต้องเจอเฉพาะ L248"
  result: true
  evidence: "Grep result: 1 total match on vollos-lead/SKILL.md:L248 only. All other 6 stale references removed"

- criterion: "Branch docs/cleanup-stale-file-references pushed"
  result: true
  evidence: "git push output: '[new branch] docs/cleanup-stale-file-references -> docs/cleanup-stale-file-references'; git status: 'Your branch is up to date with origin/docs/cleanup-stale-file-references'"

- criterion: "MR open (ไม่ merge)"
  result: true
  evidence: "GitLab API response: MR_IID=2, state=opened, URL=https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/2 — NOT merged"

- criterion: "Conventional commit"
  result: true
  evidence: "commit 2449764 'docs(vollos-lead): cleanup stale roadmap/TODO/CHANGELOG references per D7' — follows Conventional Commits format (type(scope): description)"

- criterion: "Working tree clean"
  result: true
  evidence: "git status: 'nothing to commit, working tree clean'"

## pre_deploy_checklist

- [x] branch ไม่ใช่ main (on docs/cleanup-stale-file-references)
- [x] conventional commit (docs(vollos-lead): ...)
- [x] MR opened (!2 — state=opened, not merged)
- [x] no placeholder (docs-only cleanup, grep clean)
- [x] no secrets touched (docs change only, no .env / token involved)

## next_action

null — task completed. Owner to review MR !2 and merge when ready.

## notes

- File is forge_protected=true in frontmatter but task explicitly scopes the 6 line-by-line edits as out of protected sections (Routing Protocol, Critical Rules header, execution_personas, skill_metadata all untouched; only Critical Rules bullets modified which is documented body content)
- L429 deletion shifts subsequent line numbers down by 1 in the modified file (so what was L445 in main becomes L444, L461 becomes L460) — this does not affect the spec since we matched by exact string content via Edit tool, not line number
- All 6 Edit tool operations used exact string matches (not line-number-based), so shift-safe
- MR description includes full test plan and preservation note for L248

## issues

[]

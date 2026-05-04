---
task_id: T-025
status: completed
agent: vollos-devops
delivered_at: 2026-04-19T15:12+07:00
---

## Summary

Updated `vollos-lead/SKILL.md` MODE 0 section to align with vollos-core Decision D7 — replaced legacy step 1 reference to `_conventions-core.md`/`_workspace/roadmap.md` with `_board.md`, and added explicit "Minimum File Structure" rule forbidding TODO.md/CHANGELOG.md/roadmap.md/_conventions-core.md. Branch pushed and MR opened (not merged) on GitLab.

## Files changed

- `vollos-lead/SKILL.md:245` — step 1 changed from "อ่าน `_conventions-core.md` + `_workspace/roadmap.md`" to "อ่าน `_board.md` ถ้ามี (ถ้าเป็น repo ใหม่ ยังไม่มี _board.md ก็ข้าม step นี้ไปเลย — step 3 จะสร้างให้)"
- `vollos-lead/SKILL.md:248` — new line inserted: `**Minimum File Structure (ตาม D7):**` bullet enforcing D7 (CLAUDE.md + _board.md + _workspace/T-XXX/ only; forbids TODO.md/CHANGELOG.md/roadmap.md/_conventions-core.md)

## Git evidence

- repo: `/home/ipon/workspace/vollos-ai/vollos-skill-team`
- branch: `feat/mode0-minimum-file-structure`
- commit: `18fd7ad`
- commit message: `feat(vollos-lead): enforce minimum file structure in MODE 0 per D7`
- diff stats: `1 file changed, 2 insertions(+), 1 deletion(-)`
- push output: `* [new branch] feat/mode0-minimum-file-structure -> feat/mode0-minimum-file-structure`
- MR URL: https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/1
- MR state: opened (NOT merged — awaiting owner review)

## Self-review

```yaml
self_review:
  mode0_step1_updated:
    result: true
    evidence: "vollos-lead/SKILL.md:245 — step 1 now reads 'อ่าน `_board.md` ถ้ามี (ถ้าเป็น repo ใหม่ ยังไม่มี _board.md ก็ข้าม step นี้ไปเลย — step 3 จะสร้างให้)'; verified via sed output after commit"
  minimum_structure_bullet_added:
    result: true
    evidence: "vollos-lead/SKILL.md:248 — new line '**Minimum File Structure (ตาม D7):** Project ใหม่ทุกตัว scaffold แค่ `CLAUDE.md` + `_board.md` + `_workspace/T-XXX/` เท่านั้น — **ห้าม**สร้าง `TODO.md` / `CHANGELOG.md` / `_workspace/roadmap.md` / `_conventions-core.md` แยก...'"
  forge_protected_untouched:
    result: true
    evidence: "git diff main -- vollos-lead/SKILL.md shows only lines 245-248 changed (2 insertions, 1 deletion); Routing Protocol, Critical Rules, execution_personas, skill_metadata all untouched"
  branch_pushed:
    result: true
    evidence: "git push output: '* [new branch]  feat/mode0-minimum-file-structure -> feat/mode0-minimum-file-structure'; branch tracking set to origin/feat/mode0-minimum-file-structure"
  mr_opened:
    result: true
    evidence: "MR URL https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/1 (iid=1, state=opened); created via GitLab API v4 POST /projects/81440696/merge_requests"
  conventional_commit:
    result: true
    evidence: "commit 18fd7ad message 'feat(vollos-lead): enforce minimum file structure in MODE 0 per D7' matches feat(scope): description pattern"
  working_tree_clean:
    result: true
    evidence: "git status after commit: 'nothing to commit, working tree clean'; temp files /tmp/mr_payload.json /tmp/mr_response.json removed"
  no_conventions_core_reference_left:
    result: true
    evidence: "grep '_conventions-core.md' on final vollos-lead/SKILL.md line 248 — only reference is inside the new 'ห้ามสร้าง' forbid-list (not a directive to read it); step 1 no longer references it"
```

## Placeholders remaining

none — grep clean (the word "TODO" appears on line 248 only as part of forbid-list "ห้ามสร้าง `TODO.md`", not as a placeholder marker)

## Pre-deploy checklist

- [x] branch not main (on `feat/mode0-minimum-file-structure`)
- [x] conventional commit (`feat(vollos-lead): enforce minimum file structure in MODE 0 per D7`)
- [x] MR opened (not merged) — https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/1
- [x] no placeholder/alert()/TODO-marker in diff (TODO only appears as literal filename inside forbid-list)
- [x] working tree clean (git status clean after commit + temp cleanup)

## Notes for Lead

- GitLab API token (`VOLLOS_CLI` in `/home/ipon/workspace/vollos/.env`) was used via curl header — never printed to stdout or written to any file. Temp JSON payload (no secrets) deleted.
- MR description includes traceability to T-025 + Decision D7 and explicit "Do NOT merge" note.
- Owner action required: open https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/1 and approve/merge.

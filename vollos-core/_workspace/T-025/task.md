---
id: T-025
title: Update vollos-lead SKILL.md MODE 0 — enforce minimum file structure (D7)
assigned_to: vollos-devops
priority: normal
status: in_progress
spawn_started_at: 2026-04-19T14:59+07:00
security_checkpoint: false
owned_files:
  - /home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-lead/SKILL.md
dependencies: []
---

## Context

vollos-core Decision D7 (session #001, 2026-04-18) ตัดสินใจไว้:
> Minimum file structure = CLAUDE.md + _board.md + _workspace/T-XXX/ เท่านั้น
> ไม่สร้าง TODO.md / CHANGELOG.md / roadmap.md / _conventions-core.md แยก
> เหตุผล: ลด overlap — single source of truth ใน _board.md

แต่ปัจจุบัน `vollos-lead/SKILL.md` MODE 0 (line 245) ยังสั่งให้ Lead อ่าน `_conventions-core.md` + `_workspace/roadmap.md` ซึ่งเป็นไฟล์ที่ D7 ห้ามสร้าง → มี conflict

ผลกระทบ: project ใหม่ทุกตัวที่ใช้ `/vollos-lead` จะไม่ได้ default ตาม D7 → ต้องมาเถียงกันทุกรอบ (เช่น acmd Lead เพิ่งแนะนำ owner สร้าง 4 ไฟล์เมื่อวันนี้)

วิธีแก้: ฝัง D7 เป็น default ไว้ใน MODE 0 ของ `vollos-lead` SKILL.md เลย → project ใหม่ทุกตัวจะทำตามอัตโนมัติ

## Scope — Minimal change

เป้าหมาย: แก้เฉพาะ MODE 0 section ใน SKILL.md (ห้ามแตะ section อื่น)

1. เปิด file `/home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-lead/SKILL.md`
2. ไปที่ MODE 0 section (ประมาณ line 242-248)
3. แก้ไข 2 จุด:
   - **แทนบรรทัด 245** `"1. อ่าน \`_conventions-core.md\` + \`_workspace/roadmap.md\`"` เป็น:
     `"1. อ่าน \`_board.md\` ถ้ามี (ถ้าเป็น repo ใหม่ ยังไม่มี _board.md ก็ข้าม step นี้ไปเลย — step 3 จะสร้างให้)"`
   - **เพิ่มบรรทัดใหม่หลังบรรทัด 247** (หลัง "สร้าง task แรก → spawn DevOps (monorepo scaffold)"):
     ```
     **Minimum File Structure (ตาม D7):** Project ใหม่ทุกตัว scaffold แค่ `CLAUDE.md` + `_board.md` + `_workspace/T-XXX/` เท่านั้น — **ห้าม**สร้าง `TODO.md` / `CHANGELOG.md` / `_workspace/roadmap.md` / `_conventions-core.md` แยก (single source of truth in `_board.md`: Active Tasks, Pending, Backlog, Post-MVP, Done, Session Anchor Log, Decisions Log ทั้งหมดอยู่ใน `_board.md` ไฟล์เดียว). ถ้า Lead repo อื่นเห็นว่าต้อง deviate → ต้องคุยกับ owner ก่อน + update CLAUDE.md ให้ sync ทั้ง 2 repo ห้ามแยกกฎ
     ```
4. ห้ามแตะ section อื่น (Routing Protocol, Critical Rules, execution_personas, skill_metadata = forge_protected)
5. ห้ามลบหรือแก้ allowlist ใน Action Gate

## Git Workflow (MR Workflow mandatory)

- repo path: `/home/ipon/workspace/vollos-ai/vollos-skill-team`
- branch: `feat/mode0-minimum-file-structure` (ห้าม push main)
- commit message: `feat(vollos-lead): enforce minimum file structure in MODE 0 per D7`
- push branch → open MR ที่ `git@gitlab.com:tummadajingjing/vollos-skill-team.git` → **ห้าม merge เอง รอ owner review**

## Acceptance Criteria

1. [ ] MODE 0 step 1 ไม่อ้างถึง `_conventions-core.md` / `_workspace/roadmap.md` แล้ว (grep clean)
2. [ ] MODE 0 มี bullet "Minimum File Structure" ใหม่ ที่ระบุ D7 ชัดเจน
3. [ ] Forge-protected sections ไม่ถูกแตะ (Routing Protocol, Critical Rules, execution_personas, skill_metadata)
4. [ ] Branch `feat/mode0-minimum-file-structure` pushed ไป origin
5. [ ] MR open บน GitLab (ไม่ merge)
6. [ ] Commit message ตาม conventional commits
7. [ ] Working tree clean หลังจบงาน (ไม่ทิ้งไฟล์ค้าง)

## Self-Review Protocol (บังคับ — ตาม CLAUDE.md Agent Self-Review rule)

output.md ต้องมี `self_review` field — ทุก criteria มี `result: true/false` + `evidence: "file:line — description"`

ตัวอย่าง:
```yaml
self_review:
  mode0_step1_updated:
    result: true
    evidence: "vollos-lead/SKILL.md:245 — step 1 เปลี่ยนเป็น 'อ่าน _board.md ถ้ามี'"
  minimum_structure_bullet_added:
    result: true
    evidence: "vollos-lead/SKILL.md:249 — มี bullet 'Minimum File Structure (ตาม D7)'"
  forge_protected_untouched:
    result: true
    evidence: "git diff แสดงเฉพาะ MODE 0 section line 242-250 เท่านั้น"
  branch_pushed:
    result: true
    evidence: "git push output: 'feat/mode0-minimum-file-structure -> feat/mode0-minimum-file-structure'"
  mr_opened:
    result: true
    evidence: "MR URL: https://gitlab.com/tummadajingjing/vollos-skill-team/-/merge_requests/N"
```

## Pre-Deploy Checklist (จาก CLAUDE.md)

- [ ] ไม่มี placeholder/alert()/TODO หลงเหลือใน diff
- [ ] commit message conventional commits
- [ ] branch ไม่ใช่ main
- [ ] MR opened (ไม่ merge)

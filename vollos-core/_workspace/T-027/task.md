---
id: T-027
title: Cleanup stale roadmap.md/TODO.md/CHANGELOG.md references in vollos-lead SKILL.md (D7 sync)
assigned_to: vollos-devops
priority: normal
status: in_progress
spawn_started_at: 2026-04-19T15:30+07:00
security_checkpoint: false
owned_files:
  - /home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-lead/SKILL.md
dependencies: []
---

## Context

หลัง T-025 merge แล้ว (MODE 0 enforce D7) ยังมี stale references อีก 6 บรรทัดใน SKILL.md ที่ขัดกับ D7 — ต้องเก็บกวาดให้ครบ ไม่งั้น Lead session หน้าอ่านแล้วงง

## Scope — แก้ 6 บรรทัดเฉพาะจุด

File: `/home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-lead/SKILL.md`

**การแก้ไขแต่ละบรรทัด (ใช้ sed/edit ตรงจุด — ห้ามแตะส่วนอื่น):**

1. **L75 (Session Recovery CONTINUE mode)** — เปลี่ยน:
   ```
   | CONTINUE | "ทำต่อ" | `_workspace/roadmap.md` + `_board.md` + Critical Rules (โดยเฉพาะ User Drive Spawn + Technical Boundary) | MODE 1 (งานที่ค้างอยู่) |
   ```
   เป็น:
   ```
   | CONTINUE | "ทำต่อ" | `_board.md` + Critical Rules (โดยเฉพาะ User Drive Spawn + Technical Boundary) | MODE 1 (งานที่ค้างอยู่) |
   ```

2. **L76 (Session Recovery FULL mode)** — เปลี่ยน:
   ```
   | FULL | เปลี่ยน scope | `roadmap.md` + `_board.md` + `_conventions-core.md` + Critical Rules (โดยเฉพาะ User Drive Spawn + Technical Boundary) | MODE 0 ถ้ายังไม่มี board; MODE 1 ถ้ามีแล้ว |
   ```
   เป็น:
   ```
   | FULL | เปลี่ยน scope | `_board.md` + Critical Rules (โดยเฉพาะ User Drive Spawn + Technical Boundary) | MODE 0 ถ้ายังไม่มี board; MODE 1 ถ้ามีแล้ว |
   ```

3. **L87 (Tool Gate allowlist)** — เปลี่ยน:
   ```
   **Tool Gate:** ถ้ากำลังจะใช้ Edit/Write tool กับไฟล์ที่ไม่ใช่ _board.md / task.md / roadmap.md / TODO.md / CHANGELOG.md → หยุดทันที → spawn agent แทน
   ```
   เป็น:
   ```
   **Tool Gate:** ถ้ากำลังจะใช้ Edit/Write tool กับไฟล์ที่ไม่ใช่ _board.md / task.md → หยุดทันที → spawn agent แทน
   ```

4. **L429 (ห้าม overwrite roadmap.md)** — **ลบทั้งบรรทัด** (rule นี้ obsolete เพราะ roadmap.md ไม่ควรมีอยู่แล้ว):
   ```
   - **ห้าม overwrite roadmap.md** ถ้ามีอยู่แล้ว → ถาม user ก่อน
   ```

5. **L445 (Technical Boundary whitelist)** — เปลี่ยน:
   ```
   - **Technical Boundary Rule:** Lead ห้ามแตะ code/config/VPS/Docker เอง — ต้อง spawn agent เสมอ (ดู Action Gate ด้านบน) ถ้า Lead เขียน/แก้ไฟล์นอก whitelist (_board.md / task.md / roadmap.md / TODO.md / CHANGELOG.md) → งานนั้น invalid ต้อง revert + spawn agent ทำใหม่
   ```
   เป็น (ลบ roadmap.md/TODO.md/CHANGELOG.md ออกจาก whitelist):
   ```
   - **Technical Boundary Rule:** Lead ห้ามแตะ code/config/VPS/Docker เอง — ต้อง spawn agent เสมอ (ดู Action Gate ด้านบน) ถ้า Lead เขียน/แก้ไฟล์นอก whitelist (_board.md / task.md) → งานนั้น invalid ต้อง revert + spawn agent ทำใหม่
   ```

6. **L461 (fast-track mode update roadmap.md)** — เปลี่ยน:
   ```
   User พิมพ์ `เปลี่ยนเป็น fast-track` หรือ `ตัดสินใจเร็ว` → Lead อัพเดท roadmap.md + ปรับทันที
   ```
   เป็น (update `_board.md` แทน):
   ```
   User พิมพ์ `เปลี่ยนเป็น fast-track` หรือ `ตัดสินใจเร็ว` → Lead อัพเดท decision_mode ใน `_board.md` (Session Anchor Log หรือ Notes) + ปรับทันที
   ```

## Constraints

- ห้ามแตะ forge-protected sections: Routing Protocol, Critical Rules, execution_personas, skill_metadata
- ห้ามแตะ L248 (Minimum File Structure bullet ที่ T-025 เพิ่ม — ต้องเก็บไว้)
- sync local main ก่อนเริ่ม (`git pull origin main`) — Lead สั่ง pull แล้ว HEAD=161756b
- branch ออกจาก main commit 161756b

## Git Workflow

- repo path: `/home/ipon/workspace/vollos-ai/vollos-skill-team`
- branch: `docs/cleanup-stale-file-references`
- commit message: `docs(vollos-lead): cleanup stale roadmap/TODO/CHANGELOG references per D7`
- push + open MR → **ห้าม merge รอ owner**

## Acceptance Criteria

1. [ ] 6 บรรทัดแก้ตามสเปคข้างบนเป๊ะ (L75, L76, L87, L429 [ลบ], L445, L461)
2. [ ] L248 (Minimum File Structure bullet) ไม่ถูกแตะ — grep ยังเจอ
3. [ ] Forge-protected sections ไม่ถูกแตะ
4. [ ] `grep -n "roadmap\.md\|TODO\.md\|CHANGELOG\.md" SKILL.md` หลังแก้ → ต้องเจอเฉพาะ L248 (D7 forbid-list) เท่านั้น
5. [ ] Branch `docs/cleanup-stale-file-references` pushed
6. [ ] MR open (ไม่ merge)
7. [ ] Conventional commit
8. [ ] Working tree clean

## Self-Review Protocol

output.md ต้องมี `self_review` field — ทุก criteria มี `result: true/false` + `evidence: "file:line"`

## Pre-Deploy Checklist

- [ ] branch ไม่ใช่ main
- [ ] conventional commit
- [ ] MR opened (ไม่ merge)
- [ ] no placeholder

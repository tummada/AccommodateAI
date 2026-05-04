---
id: T-026
title: Remove TODO.md / CHANGELOG.md / roadmap.md from vollos-core/CLAUDE.md allowlist (D7 sync)
assigned_to: vollos-devops
priority: normal
status: in_progress
spawn_started_at: 2026-04-19T15:30+07:00
security_checkpoint: false
owned_files:
  - /home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md
dependencies: []
---

## Context

Decision D7 ห้าม scaffold `TODO.md` / `CHANGELOG.md` / `_workspace/roadmap.md` / `_conventions-core.md` แต่ `vollos-core/CLAUDE.md` ยังมี 3 ไฟล์นี้อยู่ใน Lead allowlist (L10-12) → สับสน (เขียนได้ ≠ ต้องสร้าง)

acmd Lead เสนอให้ลบออก owner เห็นชอบ — ทำให้ CLAUDE.md sync กับ D7

## Scope — Minimal change

เป้าหมาย: แก้เฉพาะ allowlist block ใน CLAUDE.md (Lead Tool Gate section)

1. เปิด `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md`
2. หา section "Allowlist (Lead เขียนได้)" ประมาณ L7-12
3. ลบ 3 บรรทัด (เหลือแค่ `_board.md` + `_workspace/*/task.md`):
   - `- \`_workspace/roadmap.md\`` (L10)
   - `- \`TODO.md\`` (L11)
   - `- \`CHANGELOG.md\`` (L12)
4. ห้ามแตะ section อื่น

## Git Workflow

- repo path: `/home/ipon/workspace/vollos-ai/vollos-core`
- branch: `docs/cleanup-allowlist-d7` (ห้าม push main)
- commit message: `docs(claude): remove TODO/CHANGELOG/roadmap from Lead allowlist per D7`
- push + open MR → **ห้าม merge รอ owner**

## Acceptance Criteria

1. [ ] CLAUDE.md L10-12 ลบออก (grep `"roadmap\.md\|TODO\.md\|CHANGELOG\.md"` บน CLAUDE.md = 0 match)
2. [ ] Section อื่นของ CLAUDE.md ไม่ถูกแตะ (diff ≤ 3 deletions, 0 insertions)
3. [ ] Branch `docs/cleanup-allowlist-d7` pushed
4. [ ] MR open บน GitLab (ไม่ merge)
5. [ ] Conventional commit message
6. [ ] Working tree clean

## Self-Review Protocol

output.md ต้องมี `self_review` field — ทุก criteria มี `result: true/false` + `evidence: "file:line"`

## Pre-Deploy Checklist

- [ ] branch ไม่ใช่ main
- [ ] conventional commit
- [ ] MR opened (ไม่ merge)
- [ ] no placeholder

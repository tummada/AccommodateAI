---
id: T-028
title: GitLab namespace migration Phase 1 — vollos-core (group → personal)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-19T16:20+07:00
security_checkpoint: true
owned_files:
  - /home/ipon/workspace/vollos-ai/vollos-core/.gitlab-ci.yml
  - /home/ipon/workspace/vollos-ai/vollos-core/_board.md (references only)
dependencies: []
---

## Context

Owner transferred GitLab project from `vollos-ai/vollos-core` → `tummadajingjing/vollos-core` via GitLab UI (confirmed 2026-04-19 ~16:15). Reason: GitLab compute credits ผูกกับ personal namespace — group ใช้เครดิตไม่ได้

**ยืนยันแล้ว:** new URL `git@gitlab.com:tummadajingjing/vollos-core.git` reachable (SSH auth OK); old URL auto-redirects (GitLab behavior ~1 year)

## Scope

### Critical — ทำก่อน (ถ้าไม่ทำ CI จะ push image พัง)

1. **Fix `.gitlab-ci.yml`** (L31, L32, L34, L35): เปลี่ยน hardcoded registry URL ให้ใช้ `$CI_REGISTRY_IMAGE` (GitLab auto variable — dynamic, future-proof):
   - `registry.gitlab.com/vollos-ai/vollos-core/api` → `$CI_REGISTRY_IMAGE/api`
   - `registry.gitlab.com/vollos-ai/vollos-core/auth-service` → `$CI_REGISTRY_IMAGE/auth-service`

### Local repo

2. `cd /home/ipon/workspace/vollos-ai/vollos-core && git remote set-url origin git@gitlab.com:tummadajingjing/vollos-core.git`
3. Verify: `git remote -v` แสดง new URL
4. Verify: `git fetch origin` succeed (no auth error)

### GitLab settings (verify via API หรือ instruct owner เช็ค UI)

5. **CI/CD Variables ยังอยู่?** — ตรวจผ่าน GitLab API: `GET /projects/:id/variables` ใช้ VOLLOS_CLI token
   - ถ้าหาย → list ให้ owner set ใหม่ (DO NOT print values — print keys only)
   - ตัวแปรที่คาดว่ามี: secrets สำหรับ deploy, database URL, etc. (ห้าม echo values)
6. **Branch Protection บน main** — ตรวจผ่าน API: `GET /projects/:id/protected_branches/main`
   - Expected: No one can push, Maintainers can merge, No force push
   - ถ้าหาย → set ใหม่ผ่าน API

### Documentation updates

7. **Update references ใน `_board.md`:**
   - L53: `gitlab.com:vollos-ai/vollos-core.git` → `gitlab.com:tummadajingjing/vollos-core.git`
   - หมายเหตุ: L67 + L110 references ทิ้งไว้ได้ (เป็นคำอธิบายของ task เก่า/ต่อไป)
8. **Update memory:** `/home/ipon/.claude/projects/-home-ipon-workspace-vollos-ai-vollos-core/memory/project_rs013_state.md` L73 + L79 — อัพเดท namespace
9. ตรวจ README.md, CLAUDE.md, docs/ ว่ามี hardcoded URL ไหม — ถ้ามี update

### Pipeline verification

10. หลัง MR merge (owner manual) — trigger CI pipeline ทดสอบ (push dummy commit หรือใช้ existing MR)
    - ต้อง pass ทุก stage: test, build, push-to-registry
    - ถ้า build pass แต่ push fail → CI Variables ไม่มี → owner ต้อง set

## Git Workflow

- repo path: `/home/ipon/workspace/vollos-ai/vollos-core`
- branch: `chore/migrate-namespace-phase1`
- commit message: `chore(ci): migrate to personal namespace — use $CI_REGISTRY_IMAGE variable`
- push + open MR → **ห้าม merge รอ owner**

## Secret Handling Protocol (บังคับ — อ้าง feedback_secret_handling_protocol)

- `VOLLOS_CLI` token อยู่ `/home/ipon/workspace/vollos/.env` — **source + use via curl header** ห้ามพิมพ์ออกหน้าจอ ห้ามเขียนลงไฟล์
- CI Variables ที่ตรวจเจอ — **print key name เท่านั้น** ห้าม print value
- Branch Protection API response — ไม่มี secret ค่าพอประมาณ print ได้
- หลังเสร็จ: `history -c` + ลบ temp files

## Acceptance Criteria

1. [ ] `.gitlab-ci.yml` L31-35 ใช้ `$CI_REGISTRY_IMAGE` (grep `registry.gitlab.com/vollos-ai` = 0 matches)
2. [ ] `git remote -v` แสดง `tummadajingjing/vollos-core.git` เท่านั้น
3. [ ] `git fetch origin` ไม่มี error
4. [ ] CI/CD Variables: report จำนวน + key names ที่พบ (keys only ห้าม values)
5. [ ] Branch Protection บน main: verified active (allowed_to_push=No one, allowed_to_merge=Maintainers, allow_force_push=false)
6. [ ] `_board.md` L53 URL updated
7. [ ] `project_rs013_state.md` memory updated
8. [ ] README.md / CLAUDE.md / docs/ grep `vollos-ai/vollos-core` = 0 matches (หรือ report เจอที่ไหน)
9. [ ] Branch `chore/migrate-namespace-phase1` pushed to new URL
10. [ ] MR open ที่ new URL `tummadajingjing/vollos-core` (ไม่ merge)
11. [ ] Conventional commit
12. [ ] Working tree restored to `feat/auth-rate-limit` (owner's branch)

## Self-Review Protocol

output.md ต้องมี `self_review` field — ทุก 12 criteria มี `result: true/false` + `evidence: file:line หรือ command output`

## Pre-Deploy Checklist

- [ ] branch ไม่ใช่ main
- [ ] conventional commit
- [ ] MR opened (ไม่ merge)
- [ ] no placeholder
- [ ] secret ไม่โผล่ใน log/output ใดๆ

## Notes for DevOps

- Project ID: ใช้ API `GET /projects/tummadajingjing%2Fvollos-core` หาค่า (URL-encoded namespace/path)
- Cross-reference: skill-team repo ใช้ `$CI_REGISTRY_IMAGE` pattern (ดูตัวอย่าง)
- VPS: ไม่ต้องแก้ปัจจุบัน (deploy ยังไม่ trigger อัตโนมัติ — `when: manual`) แต่ถ้าพบ reference URL ใน deploy script ให้ flag

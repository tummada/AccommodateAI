---
id: T-063
title: Phase A-1 — Post-deploy smoke test in GitLab CI
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T13:25+07:00
dependencies: []
owned_files:
  - .gitlab-ci.yml
---

## Context

Owner วาง Phase A (3 steps) สำหรับเปลี่ยน deploy pipeline จาก `when: manual` → `when: on_success` (auto-deploy). **นี่คือ step แรก (A-1)** — เพิ่ม smoke test หลัง deploy เพื่อเป็นฐานให้ A-2 (rollback) + A-3 (switch to on_success)

**Current state (.gitlab-ci.yml:40-55):**
- deploy stage ใช้ ssh ยิง `git pull && docker compose up -d --build` แล้วจบ
- ไม่มี verification step — ถ้า container up แต่ endpoint 500 = pipeline ยัง green (false positive)

**Target state (A-1):** หลัง ssh deploy command สำเร็จ → pipeline ต้อง curl health endpoints + fail ถ้า non-200

## Acceptance Criteria

1. `.gitlab-ci.yml` deploy stage เพิ่ม smoke test **หลัง** ssh deploy command (step ใหม่ในเดียว job หรือแยก stage ก็ได้ — DevOps ตัดสินใจ เหตุผลใน output.md)
2. Smoke test curl 2 URLs + ตรวจ HTTP 200 ทั้งคู่:
   - `https://vollos.ai/api/v1/health`
   - `https://auth.vollos.ai/health`
3. Retry logic รองรับ container startup delay: **3 attempts × 10 วินาที** (ใช้ `curl -sS -o /dev/null -w "%{http_code}"`; แต่ละ attempt ต้อง both URLs เป็น 200 ถึงนับว่า pass)
4. Smoke fail → pipeline stage fail (non-zero exit) — ห้ามเงียบ
5. `when: manual` **ยังเหลือ** (A-3 ค่อยเปลี่ยน) — A-1 แค่เพิ่ม smoke test layer

## Constraints (inject from CLAUDE.md + memory)

- **MR workflow บังคับ:** branch จาก `origin/main` (ไม่ใช่ branch ปัจจุบัน `chore/workspace-audit-trail-session-20260420`) ชื่อ `feat/ci-smoke-test`
- **Conventional commit:** `feat(ci): add post-deploy smoke test for health endpoints`
- **ห้ามแตะ:** build stage, test stage, docker compose, VPS config, secret vars
- **ห้ามเปลี่ยน** `when: manual` (A-3 งาน)
- **ห้าม** push ตรง main — เปิด MR แล้วรายงาน URL
- **Pipeline ต้อง green บน MR ก่อน Lead spot-check:** test + build ต้องผ่าน; deploy job จะเป็น manual-pending (normal) — Lead จะตรวจ diff + ไม่ trigger deploy จริงใน A-1
- **ห้าม trigger deploy จริง** ใน MR นี้ — rollback logic ยังไม่มี (A-2) ถ้า smoke fail = pipeline stuck แล้วไม่มีทาง recover ชั้นเดียว
- **Secret handling:** งานนี้ไม่ควรแตะ secret ใดๆ — ถ้าต้องอ่าน CI vars → stop + report เหตุผล

## Implementation hints (not prescriptive)

ตัวอย่าง pattern (DevOps ปรับได้):
```yaml
# หลัง ssh deploy command
- |
  for i in 1 2 3; do
    api=$(curl -sS -o /dev/null -w "%{http_code}" https://vollos.ai/api/v1/health || echo "000")
    auth=$(curl -sS -o /dev/null -w "%{http_code}" https://auth.vollos.ai/health || echo "000")
    if [ "$api" = "200" ] && [ "$auth" = "200" ]; then
      echo "Smoke PASS attempt=$i api=$api auth=$auth"; exit 0
    fi
    echo "Smoke retry attempt=$i api=$api auth=$auth"
    [ $i -lt 3 ] && sleep 10
  done
  echo "Smoke FAILED after 3 attempts"; exit 1
```
ต้องมี `apk add --no-cache curl` ถ้าใช้ alpine image

## Expected Output (output.md format)

- `self_review`: ทุก AC มี `result: true` + `evidence: file:line` (evidence ต้องอ้าง `.gitlab-ci.yml:N`)
- `placeholders_remaining`: ต้องเป็น `none — grep clean` (grep `TODO|TBD|placeholder|coming soon`)
- `files_changed`: list path + บรรทัดที่แก้
- `mr_url`: GitLab MR URL (ready for Auditor review)
- `commit_sha`: commit SHA บน branch
- `pipeline_url`: GitLab pipeline URL + สถานะ test/build/deploy job (deploy = manual-pending ok)

## Definition of Done

- [ ] MR เปิดบน `feat/ci-smoke-test` (branched from origin/main)
- [ ] Pipeline test + build green; deploy job = manual-pending (ไม่ trigger)
- [ ] `.gitlab-ci.yml` diff ≤ 25 บรรทัดเพิ่ม (ถ้าเกิน — justify in output.md)
- [ ] output.md มี self_review ครบ + placeholders_remaining check ผ่าน
- [ ] ไม่มี secret leak ใน output.md / MR description

## After this task (Lead จะทำ — อย่าข้าม)

1. Lead spot-check diff + output.md
2. Lead spawn vollos-auditor ตรวจ security (CI config surface)
3. ถ้า pass → Lead ให้ owner decide merge
4. ถ้า merge → Lead spawn T-064 (A-2 — rollback + Telegram alert + local simulation test)

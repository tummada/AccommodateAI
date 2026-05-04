---
id: T-064
title: Security audit — T-063 post-deploy smoke test
assigned_to: vollos-auditor
priority: high
spawn_started_at: 2026-04-20T13:50+07:00
dependencies: [T-063]
owned_files: []   # read-only review
---

## Context

T-063 เพิ่ม post-deploy smoke test ใน `.gitlab-ci.yml` (deploy stage) — branch `feat/ci-smoke-test` MR !17 Lead spot-check ผ่านแล้ว ตอนนี้ส่ง Auditor รีวิวก่อน owner merge

## Scope ของการรีวิว

**เฉพาะ diff ที่ T-063 แตะ:**
- `git diff origin/main origin/feat/ci-smoke-test -- .gitlab-ci.yml` (+13/-1)
- เพิ่ม `curl` ใน `apk add` line
- เพิ่ม 12-line smoke-test bash block ใน `script:` หลัง ssh deploy command

**ห้ามออกนอก scope:** อย่ารีวิว build stage, test stage, หรือ deploy ssh command เดิม (ไม่ใช่งาน T-063)

## Review checklist (บังคับ)

1. **Command/shell injection** — URLs เป็น static hardcoded ✓ แต่ตรวจว่าไม่มีทางให้ผู้ร้ายแทรก command ผ่าน curl argument / for loop / bash arithmetic ได้
2. **Retry logic correctness** — 3 × 10s หยุดถูก, `sleep 10` แค่ระหว่าง attempt ไม่ใช่หลังจบ (ป้องกัน waste 10s แถมท้าย), `exit 0` / `exit 1` mapping ถูก
3. **Fail-silent risk** — `|| echo "000"` fallback กัน curl crash — ตรวจว่า `"000"` ไม่ match `200` comparison (ต้อง fail ถ้า curl error)
4. **Secret leak** — MR description / commit message / CI log มี token/VPS_SSH_KEY/CI vars value ใดหลุดไหม (ตรวจ `git show 5168377` + MR body)
5. **Manual gate bypass** — `when: manual` ยังอยู่หรือเปล่า (AC #5 ของ T-063 — smoke test ต้อง **ไม่**ปลด manual gate)
6. **Attack surface ใหม่** — การเพิ่ม `curl` ใน deploy image เปิด risk อะไรใหม่บ้าง (SSRF จาก pipeline? DNS exfiltration? outbound-only? ฯลฯ)
7. **False positive/negative** — smoke test จะ pass เมื่อไรที่ไม่ควร pass? fail เมื่อไรที่ไม่ควร fail? (เช่น endpoint return 200 แต่ body ว่าง — ตรงตาม spec หรือควร strict กว่านี้?)
8. **Dependency chain safety** — build → deploy dependency + `only: main` ไม่แตก (ตรวจ diff ว่าไม่เผลอเปลี่ยน `needs`/`only`/`environment`)

## Compliance verdict (ต้องมี)

- ไม่แตะ user data / PII → compliance_verdict: not_applicable
- แต่ verdict หลัก (`verdict: pass | fail | conditional_pass`) ต้องมี

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-064/review-auditor.md` (ตาม format ปกติของ vollos-auditor)

**ต้องมี field:**
- `verdict: pass | fail | conditional_pass`
- `findings`: list ตามระดับ (CRITICAL / HIGH / MEDIUM / LOW / INFO) + location (file:line) + recommendation
- `compliance_verdict` (not_applicable ได้ แต่ต้องระบุ)
- `ok_to_merge`: true/false + reasoning

## Done criteria

- review-auditor.md เขียนเสร็จ + verdict ชัด
- ทุก finding อ้าง file:line (ไม่ใช่ generic)
- ถ้า CRITICAL/HIGH เจอ → ระบุ fix path (แก้อะไร ตรงไหน)

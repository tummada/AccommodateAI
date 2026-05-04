---
id: T-077
title: Security audit — T-076 smoke timing harden (SEC-MED-004 fix)
assigned_to: vollos-auditor
priority: high
spawn_started_at: 2026-04-20T18:10+07:00
dependencies: [T-076]
owned_files: []
---

## Context

T-076 extend smoke timing (15s warmup + 5×15s retries = ~85s budget, from 3×10s = ~36s) เพื่อแก้ SEC-MED-004 (auth-service cold start race ที่ trigger false rollback)

Branch `fix/ci-smoke-timing-harden`, MR !25, diff: `.gitlab-ci.yml` +7/-4, `infra/test-rollback-simulation.sh` +17/-15

## Scope

รีวิว **เฉพาะ diff T-076** (ไม่รีวิว smoke test structure ทั้งหมดที่ผ่าน T-064/T-068/T-072 แล้ว)

## Review checklist

### Timing change correctness
1. **Warmup sleep 15s** — ตำแหน่งถูก (ก่อน for loop, หลัง function definitions)? ไม่ใช่ bypass ของ guard?
2. **Retry count 3→5** — loop variable range + sleep guard `[ $i -lt 5 ]` ถูก?
3. **Total budget calc** — 15s warmup + 5 attempts + 4 sleeps×15s = ~95s — acceptable trade-off vs rollback false-positive rate?
4. **Happy-path impact** — ถ้า smoke pass attempt 1 — ยังเร็วอยู่ไหม (warmup 15s + ~2s curl = 17s min) acceptable?

### Security/safety implications
5. **Attack surface** — warmup sleep + extended retry ทำให้ window เวลาที่ VPS serve broken code นานขึ้น (~85s vs ~36s) — acceptable เพราะ rollback ยังทำงาน?
6. **`when: on_success` unchanged** — verify diff ไม่แตะ L97
7. **Safeguards** — LAST_GOOD guard, rollback ssh, Telegram alert, resource_group, only:main, needs:build, environment — ทั้งหมด intact (file:line evidence)

### Simulation fidelity
8. **SIM pattern arrays** — new "000" × 10 + "200" × 2 = 12 codes สำหรับ Scenario A, 12 × "000" Scenario B — match new smoke_check call count หลังแก้?
9. **Assertion strings** — `"Smoke FAILED after 5 attempts"` string match ใหม่ตรง CI output?
10. **Scenario C (happy path)** — pattern "200,200" unchanged — still valid because smoke_check at attempt 1 exits early
11. **Scenario D + E** — guard fires ก่อน smoke loop — pattern unchanged, valid
12. **No regression** — run output: `Summary: 38 passed / 0 failed` — แต่ละ assertion ยังคงตรวจสิ่งเดิม?

### Diff hygiene
13. **Diff scope** — 2 files only (no scope creep)
14. **No secrets** — scan matches (token/password patterns) in diff?
15. **Conventional commit** — message format?

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-077/review-auditor.md`:

- `verdict: pass | fail | conditional_pass`
- `findings` (CRITICAL/HIGH/MEDIUM/LOW/INFO + file:line + recommendation)
- `compliance_verdict: not_applicable`
- `ok_to_merge: true|false` + reasoning (ควรรวม: does this actually close SEC-MED-004 without opening new risk?)
- `checklist_verification`: 15 items + evidence
- `closes_previous_findings`: SEC-MED-004 closed? (was raised in Lead T-075 session note, not formal Auditor finding — treat as Lead-flagged)
- `files_read`, `commands_used`

## ข้อห้าม

- ห้ามแก้ไฟล์
- ห้าม echo secret values
- CRITICAL/HIGH → fail + fix path
- MEDIUM → conditional_pass + pre-merge condition

## Done criteria

- review-auditor.md + verdict ชัด
- 15 items + evidence
- ok_to_merge ชัด
- SEC-MED-004 disposition explicit

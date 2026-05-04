---
id: T-068
title: Security audit — T-067 MEDIUM fixes (LAST_GOOD guard + resource_group + sim scenarios D+E)
assigned_to: vollos-auditor
priority: high
spawn_started_at: 2026-04-20T15:30+07:00
dependencies: [T-067]
owned_files: []   # read-only review
---

## Context

T-067 แก้ 2 MEDIUMs จาก T-066 + อัพเดท simulation — branch `fix/ci-rollback-guards` MR !19
Lead spot-check independent: simulation 38/38 pass, guard + resource_group ครบ, when:manual preserved

## Scope

รีวิว **เฉพาะ diff T-067** เท่านั้น:
- `git diff origin/main origin/fix/ci-rollback-guards` (`.gitlab-ci.yml` +7/-0 + `infra/test-rollback-simulation.sh` +64/-0)
- output.md T-067: `_workspace/T-067/output.md`
- ห้าม re-audit T-065/T-063 (ผ่านแล้ว)

## Review checklist

### Fix 1 — LAST_GOOD guard (SEC-MED-001 closed?)
1. **Guard placement** — อยู่หลัง LAST_GOOD capture และก่อน git pull จริงไหม?
2. **Guard condition correctness** — `[ -z ] || [ ${#LAST_GOOD} -ne 40 ]` cover edge cases ครบ? (empty, short, long, non-hex?)
3. **Fail-fast** — `exit 1` ทำงานทันที ไม่มี bypass? output ไม่ leak ssh stderr/stdout ที่อาจมี sensitive info?
4. **Guard bypass risk** — attacker/race ทำให้ข้าม guard ได้ไหม (เช่น echo injection)

### Fix 2 — resource_group (SEC-MED-002 closed?)
5. **YAML syntax** — `resource_group: production_deploy` ถูก GitLab spec + ตำแหน่งใน job key ถูก?
6. **Scope correctness** — `production_deploy` name เหมาะกับ prod-only lock ไหม? (ไม่ควรใช้ชื่อที่ชน staging/test ในอนาคต)
7. **Concurrency behavior** — verify Per GitLab docs ว่า resource_group จะ serialize jobs ข้าม pipelines หรือเฉพาะใน pipeline เดียว

### Fix 3 — Simulation D + E
8. **Scenario D fidelity** — mock ssh empty stdout → mirror real ssh failure behavior?
9. **Scenario E fidelity** — mock ssh "fatal: not a git repository" → realistic error pattern?
10. **Assertion strictness** — scenario D/E assertions ใช้ substring match จริงจังไหม? false-pass risk?
11. **No regression on A/B/C** — existing 23 assertions ยัง pass + new 15 = 38 total (confirmed by Lead)
12. **Hygiene mirror** — guard ใน simulation mirror real `.gitlab-ci.yml` guard (bit-for-bit เหมือนกัน)?

### Diff hygiene
13. **Diff budget** — `.gitlab-ci.yml` +7 (≤15 ✓) + simulation +64 (≤80 ✓)
14. **`when: manual` preserved** — confirm untouched
15. **No scope creep** — ไม่แตะ test/build stages / ssh_key / known_hosts / environment lines

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-068/review-auditor.md`:

- `verdict: pass | fail | conditional_pass`
- `findings`: CRITICAL/HIGH/MEDIUM/LOW/INFO + file:line + recommendation
- `compliance_verdict: not_applicable`
- `ok_to_merge: true/false` + reasoning
- `checklist_verification`: ครบ 15 ข้อ + evidence
- `closes_previous_findings`: ระบุ SEC-MED-001 + SEC-MED-002 ว่า resolved ไหม

## ข้อห้าม

- ห้ามแก้ไฟล์ (review-only)
- ห้าม echo secret
- MEDIUM+ → conditional_pass หรือ fail

## Done criteria

- review-auditor.md เขียนเสร็จ + verdict ชัด
- 15 checklist items + evidence
- Prior findings closure explicit
- ok_to_merge ชัดเจน

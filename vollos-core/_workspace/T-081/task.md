---
id: T-081
title: Security audit — T-080 LAST_GOOD hex check (SEC-INFO-001 closure)
assigned_to: vollos-auditor
priority: medium
spawn_started_at: 2026-04-20T19:15+07:00
dependencies: [T-080]
owned_files: []
---

## Context

T-080 add hex char check to LAST_GOOD guard — branch `fix/ci-guard-hex-check`, MR !26 (`.gitlab-ci.yml` +2/-2 + `infra/test-rollback-simulation.sh` +31/-2 = 2 files, 33 insertions, 4 deletions)

SEC-INFO-001 was raised in T-068 + T-072 as advisory only

## Scope

รีวิว diff T-080 — **focused audit, ไม่รีวิวทุก smoke/rollback logic ซ้ำ** (audited ใน T-064/T-066/T-068/T-072/T-077)

## Review checklist

### Guard correctness
1. **Hex char class regex** — `^[0-9a-f]{40}$` cover git SHA-1 format ถูก? (lowercase only — git ไม่ใช้ uppercase SHA เว้นแต่ force)
2. **Portability** — `grep -qE` works on alpine 3.19 `/bin/sh` (ash) — ไม่พึ่ง bash `[[ =~ ]]`?
3. **Order of conditions** — `-z` check → `-ne 40` → regex — short-circuit ถูก (empty ไม่ต้อง regex match)?
4. **False positives/negatives** — 40-char hex that's not a real commit SHA passes — acceptable (git reset will fail if ref doesn't exist)?

### Scenario F (simulation)
5. **40 Z-chars test** — length OK, non-hex → guard fires? Assertion realistic?
6. **Other scenarios unchanged** — A/B/C/D/E still passing (no regression)?
7. **Simulation count** — 48 assertions (38 + 10 new) — matches claim?

### Safeguards unchanged
8. Verify `when: on_success` / `resource_group` / `environment` / smoke / rollback / Telegram / warmup sleep — ทั้งหมด file:line untouched

### Diff hygiene
9. Scope: 2 files only, no scope creep
10. Conventional commit format
11. No secret / echo / set -x leak

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-081/review-auditor.md`:
- `verdict: pass | fail | conditional_pass`
- `findings`
- `compliance_verdict: not_applicable`
- `ok_to_merge: true|false` + reasoning
- `checklist_verification`: 11 items + evidence
- `closes_previous_findings`: SEC-INFO-001 closed?

## ข้อห้าม

- ห้ามแก้ไฟล์
- ห้าม echo secret
- CRITICAL/HIGH → fail
- MEDIUM → conditional_pass

Report concise
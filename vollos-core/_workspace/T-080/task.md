---
id: T-080
title: SEC-INFO-001 — LAST_GOOD guard hex character check (strengthen from length-only)
assigned_to: vollos-devops
priority: medium
spawn_started_at: 2026-04-20T18:55+07:00
dependencies: [T-076]
owned_files:
  - .gitlab-ci.yml
  - infra/test-rollback-simulation.sh
---

## Context

T-072 finding SEC-INFO-001 (carried from T-068): LAST_GOOD guard ตอนนี้เช็คแค่ length=40 ไม่เช็คว่าเป็น hex chars หรือเปล่า

**ความเสี่ยง (theoretical):** ถ้า SSH output pollution (เช่น shell alias injection, terminal color codes) ทำให้ LAST_GOOD มี 40 chars แต่ไม่ใช่ SHA valid → `git reset --hard $LAST_GOOD` อาจ fail silent หรือ ambiguous ref

**Practical risk:** ≈ 0 เพราะ precondition = VPS root compromise. แต่ defense-in-depth ควรปิด gap นี้

## Scope (minimal — 2 files)

### `.gitlab-ci.yml` current guard (L55-58):
```yaml
if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then
  echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"
  exit 1
fi
```

### Change to (add hex-only char class check):
```yaml
if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ] || ! echo "$LAST_GOOD" | grep -qE '^[0-9a-f]{40}$'; then
  echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}, non-hex or malformed) — abort deploy before git pull"
  exit 1
fi
```

**ทำไม `grep -qE` แทน bash `[[ =~ ]]`:** CI runs on `alpine:3.19` with `/bin/sh` (ash) not bash — `[[ ]]` not portable. `grep -qE` universal.

### `infra/test-rollback-simulation.sh` — mirror guard + add test scenario:

1. Update simulation's `guard()` function (mirror ของ CI guard) ให้มี hex check เหมือนกัน
2. Add **Scenario F:** LAST_GOOD มี 40 chars แต่มี non-hex (เช่น SSH output = `ZZZZZZ...` 40 chars Z) → guard must fire → exit 1 + no smoke/rollback/TG
3. Assert: simulation runs `SIMULATION PASS` with ≥40 assertions passing (เดิม 38 + ~3 ใหม่จาก F)

## Acceptance Criteria

1. `.gitlab-ci.yml:55` — guard condition expanded ให้มี hex check (grep -qE pattern)
2. `.gitlab-ci.yml` diff ≤ 4 บรรทัด (condition + error message)
3. `infra/test-rollback-simulation.sh` — guard function updated + Scenario F added
4. Simulation run → `SIMULATION PASS` + Summary ≥40 passed / 0 failed
5. No regression in Scenarios A/B/C/D/E (existing 38 assertions still pass)
6. `when: on_success` + all other safeguards untouched (verify file:line)
7. Branch `fix/ci-guard-hex-check` from `origin/main` (HEAD=`14c2245`)
8. Conventional commit: `fix(ci): strengthen LAST_GOOD guard with hex char check`
9. MR opened — NOT merged (owner merges)
10. Pipeline test + build green on MR

## Branch + MR discipline

- ห้าม push main ตรง
- ห้าม merge MR
- ห้าม trigger deploy (on_success — merge = deploy ทันที, owner controls)
- ห้ามแตะไฟล์อื่น

## Secret handling

- ห้าม echo secret
- ห้าม curl -v / set -x
- Simulation fake token literal

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-080/output.md`:
- `self_review`: 10 AC + evidence file:line
- `placeholders_remaining`: grep clean
- `files_changed`: 2 files + diff stat
- `mr_url`, `commit_sha`, `pipeline_url`
- `simulation_output`: full paste (Summary ≥40/0 + SIMULATION PASS)
- `safeguards_intact`: list file:line
- `blocker`: null/details

## After this task

1. Lead spot-check
2. Spawn vollos-auditor (T-081)
3. Owner merge → auto-deploy (smoke ต้อง pass + guard ต้องไม่ fire เพราะ LAST_GOOD จริงๆ = 40-char hex)
4. SEC-INFO-001 ปิด

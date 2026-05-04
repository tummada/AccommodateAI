---
id: T-076
title: SEC-MED-004 — Harden smoke test timing to accommodate auth-service cold start (≥36s)
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T17:50+07:00
dependencies: [T-075]
owned_files:
  - .gitlab-ci.yml
  - infra/test-rollback-simulation.sh
---

## Context

**Real production incident today:** MR !23 (docs-only change) auto-deploy **false-triggered rollback** เพราะ smoke timing ไม่พอ

**Evidence จาก pipeline 2464928145 deploy log:**
```
Smoke retry attempt=1  api=502  auth=503
Smoke retry attempt=2  api=200  auth=503   ← api ฟื้น, auth ยัง init
Smoke retry attempt=3  api=200  auth=503   ← auth ยัง 503 หลัง 36s
→ Rollback trigger (false positive)
```

**Root cause:** `auth-service` warm-up ต้อง >36s บางครั้ง (JWKS + RSA key load + Postgres pool) — current smoke budget 3×10s = ~36s **ไม่พอ**

**Impact:**
- MR !24 auto-deploy ผ่าน (fluke — fast cold start) แต่ rollback มาอีกรอบอาจเกิดเมื่อไหร่ก็ได้
- Pre-customer OK, แต่ถ้ามีลูกค้าจริง = downtime 1-2 นาที/deploy ที่ไม่จำเป็น

## Fix spec

### `.gitlab-ci.yml` smoke block changes

**Current (around L60-82):**
```yaml
# Post-deploy smoke test — 3 attempts x 10s; both endpoints must return 200
- |
  smoke_check() {...}
  tg_alert() {...}
  for i in 1 2 3; do
    if smoke_check; then ...; exit 0; fi
    echo "Smoke retry attempt=$i api=$api auth=$auth"
    [ $i -lt 3 ] && sleep 10
  done
  echo "Smoke FAILED after 3 attempts — initiating auto-rollback ..."
```

**Change to:**
```yaml
# Post-deploy smoke test — 15s warmup + 5 attempts x 15s; both endpoints must return 200
# Rationale: auth-service cold start (JWKS+RSA+pg pool) can exceed 36s — see T-076
- |
  smoke_check() {...}
  tg_alert() {...}
  echo "Smoke warmup sleep 15s for container boot..."
  sleep 15
  for i in 1 2 3 4 5; do
    if smoke_check; then ...; exit 0; fi
    echo "Smoke retry attempt=$i api=$api auth=$auth"
    [ $i -lt 5 ] && sleep 15
  done
  echo "Smoke FAILED after 5 attempts — initiating auto-rollback ..."
```

**Total smoke budget:** 15s warmup + 5×(~2s curl + 15s sleep, last no sleep) = **~85s** (was ~36s)

### `infra/test-rollback-simulation.sh` changes

อัพเดท SIM_SMOKE_PATTERN ให้ match new retry count (5 แทน 3):

- **Scenario A** (smoke fail → rollback ok): SIM_SMOKE_PATTERN ต้องมี 5×2=10 failing codes + 2 success codes (post-rollback) = `"000,000,000,000,000,000,000,000,000,000,200,200"` (หรือ adjust ตาม real smoke_check pattern in sim)
- **Scenario B** (smoke fail → rollback fail): 5×2=10 failing codes + 2 failing (post-rollback fail) = `"000,000,...,000"` (12 codes)
- **Scenario C** (happy path): `"200,200"` — unchanged (smoke pass attempt 1, exit before retry)
- **Scenario D** (LAST_GOOD empty): unchanged — guard fires before smoke loop
- **Scenario E** (LAST_GOOD malformed): unchanged

**New assertion in A and B:** "Smoke FAILED after 5 attempts" (not "3 attempts")

รัน `bash infra/test-rollback-simulation.sh` ต้องได้ `SIMULATION PASS` + Summary ≥35 passed / 0 failed (เดิม 38 — expected ~38-42 after update depending on assert changes)

## Acceptance Criteria

1. `.gitlab-ci.yml` smoke block: add `sleep 15` warmup + change loop to `1 2 3 4 5` + change `$i -lt 3` → `$i -lt 5` + update echo message to "5 attempts"
2. `.gitlab-ci.yml` diff ≤ 10 บรรทัด (คง function body + ssh rollback block ไว้เดิม)
3. `infra/test-rollback-simulation.sh` updated — SIM_SMOKE_PATTERN arrays + assertion strings reflect 5 retries; rerun outputs `SIMULATION PASS` ≥35/0
4. `when: manual` / `when: on_success` — **ไม่แตะ** (ยังคง `when: on_success`)
5. `resource_group: production_deploy`, LAST_GOOD guard, rollback ssh, Telegram alert — **ทั้งหมดคงเดิม** (verify file:line)
6. Branch `fix/ci-smoke-timing-harden` from `origin/main` (HEAD=`25db7546`)
7. Conventional commit: `fix(ci): extend smoke warmup + retry budget for auth-service cold start`
8. MR opened — **NOT merged** — owner will merge (auto-deploy จะยิงทันทีจาก merge — docs-like change, smoke ต้อง pass ง่ายๆ ด้วย timing ใหม่)

## Branch + MR discipline

- ห้าม push main
- ห้าม merge MR
- ห้าม trigger deploy
- ห้ามแตะไฟล์อื่นนอก 2 ไฟล์ที่ระบุ
- ห้ามเปลี่ยน rollback logic / Telegram / guard / resource_group

## Secret handling (inject)

- ห้าม echo token
- ห้าม `docker compose config` / `cat .env`
- ห้าม `set -x` / `curl -v`
- Simulation ต้องใช้ fake token literal เหมือนเดิม

## Output (output.md)

- `self_review`: 8 AC + evidence file:line
- `placeholders_remaining`: grep clean
- `files_changed`: 2 files + diff stat
- `mr_url`, `commit_sha`, `pipeline_url`
- `simulation_output`: paste full output (Summary N passed/0 failed, N≥35)
- `safeguards_intact`: list rollback/Telegram/guard/resource_group file:line
- `blocker`: null/details

## Definition of Done

- [ ] MR opened on `fix/ci-smoke-timing-harden`
- [ ] Pipeline test + build green บน MR
- [ ] Simulation pass ≥35 assertions + SIMULATION PASS
- [ ] `when: on_success` + all safeguards intact (verify file:line)
- [ ] Not merged, not deployed

## After this task

1. Lead spot-check diff + simulation output
2. Spawn vollos-auditor (T-077) — verify timing change doesn't weaken security, rollback logic intact
3. Owner merges → auto-deploy ยิง (timing ใหม่ — ควร pass attempt 1 ด้วย 15s warmup)

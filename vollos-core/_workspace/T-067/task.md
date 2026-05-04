---
id: T-067
title: Phase A-3 part 1 — Fix 2 MEDIUMs from T-066 (LAST_GOOD guard + resource_group)
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T15:10+07:00
dependencies: [T-065, T-066]
owned_files:
  - .gitlab-ci.yml
  - infra/test-rollback-simulation.sh
---

## Context

**Phase A-3 (flip `when: manual` → `when: on_success`) แบ่งเป็น 3 ส่วน:**
- **Part 1 (this task T-067)** — DevOps แก้ 2 MEDIUMs จาก T-066 + อัพเดท simulation
- **Part 2** — Owner ทดสอบ production 2 ชุด (normal deploy + fake broken deploy) หลัง T-067 merge
- **Part 3** — DevOps flip `when: manual` → `when: on_success` + MR + Auditor (หลัง Part 2 pass)

A-2 merged แล้ว (main HEAD `540b07f`) ตอนนี้ `when: manual` ยัง preserved ที่ `.gitlab-ci.yml:88`

## Fixes required (จาก T-066 review-auditor.md)

### Fix 1 — SEC-MED-001: Guard empty/malformed `$LAST_GOOD`

**Current state (.gitlab-ci.yml:51):**
```yaml
- LAST_GOOD=$(ssh -o StrictHostKeyChecking=yes ... "cd ~/vollos-core && git rev-parse HEAD")
```

**ปัญหา:** ถ้า SSH fail → `$LAST_GOOD` เป็น empty string → subsequent `git reset --hard $LAST_GOOD` = no-op (git resets to HEAD instead of rolling back) — rollback silent-fail

**Fix ที่ต้องทำ (.gitlab-ci.yml ประมาณ L52 ระหว่าง LAST_GOOD assignment และ git pull):**
```yaml
- |
  if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then
    echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"
    exit 1
  fi
```

เหตุผล: git SHA-1 = 40 hex chars เสมอ — ถ้าไม่ใช่ = ssh output พัง → fail-fast ก่อน pull

### Fix 2 — SEC-MED-002: Add `resource_group` for concurrent-deploy lock

**Current state (.gitlab-ci.yml:85-89):**
```yaml
  only:
    - main
  needs: [build]
  when: manual
  environment: production
```

**ปัญหา:** ไม่มี concurrency lock — ถ้า operator กด "Run" ติดกัน หรือ A-3 flip auto แล้ว 2 commits merge ใกล้กัน → 2 deploy jobs ทับกัน → rollback target stale + docker race

**Fix ที่ต้องทำ (.gitlab-ci.yml เพิ่มหนึ่งบรรทัดก่อนหรือหลัง `environment: production`):**
```yaml
  resource_group: production_deploy
```

เหตุผล: GitLab built-in concurrency lock — jobs ใน group เดียวกัน serialize อัตโนมัติ (docs: https://docs.gitlab.com/ee/ci/yaml/#resource_group)

### Fix 3 — Update simulation to cover LAST_GOOD edge case

**เพิ่ม Scenario D ใน `infra/test-rollback-simulation.sh`:**
- SSH returns empty stdout (simulate network fail) → LAST_GOOD empty → guard triggers → exit 1 "FATAL LAST_GOOD invalid" + **ไม่มี** git pull, rollback, Telegram alert
- Assert: exit code = 1, stderr/stdout contains "FATAL LAST_GOOD", no "auto-rollback" trace, no Telegram call

**เพิ่ม Scenario E:**
- SSH returns malformed SHA (e.g. "fatal: not a git repository") → LAST_GOOD length != 40 → guard triggers → exit 1

ให้ updated simulation run 25/25 pass (3 old scenarios × 6-8 assertions + 2 new × 3-4 + 4 hygiene)

## Acceptance Criteria

1. `.gitlab-ci.yml`: Fix 1 guard block added after LAST_GOOD capture + Fix 2 `resource_group: production_deploy` added to deploy job
2. `when: manual` **ยังคงอยู่** (Part 3 งาน ไม่ใช่ task นี้)
3. `infra/test-rollback-simulation.sh`: Scenario D (empty LAST_GOOD) + Scenario E (malformed LAST_GOOD) added; updated run outputs `SIMULATION PASS` with ≥25 assertions passing
4. All existing scenarios (A/B/C + hygiene) ยังคง pass (no regression)
5. Diff `.gitlab-ci.yml` ≤ 15 บรรทัดเพิ่ม; diff simulation script ≤ 80 บรรทัดเพิ่ม

## Branch + MR discipline

- เริ่มจาก `origin/main` ล่าสุด (HEAD=`540b07f`): `git fetch origin main && git checkout -b fix/ci-rollback-guards origin/main`
- Conventional commit: `fix(ci): guard empty LAST_GOOD + add resource_group lock`
- Push + open MR
- ห้าม trigger deploy

## Secret Handling (repeat from T-065 — inject)

- ห้าม `cat .env` / Read .env / `docker compose config` ไม่มี `--no-interpolate`
- ห้าม echo `$TELEGRAM_BOT_TOKEN`, `$VPS_SSH_KEY`, `$VOLLOS_CLI` value
- ห้าม `curl -v` ห้าม `set -x` ใน block ที่แตะ token
- Simulation ต้องใช้ fake token literal (ไม่ inherit real env)

## Expected Output (output.md)

- `self_review`: 5 AC + evidence file:line (อ้าง `.gitlab-ci.yml:N` + `infra/test-rollback-simulation.sh:N`)
- `placeholders_remaining`: grep clean
- `files_changed`: diff stat + lines changed
- `mr_url`, `commit_sha`, `pipeline_url`
- `simulation_output`: paste full output (ต้องมี "SIMULATION PASS" + ≥25 assertions)
- `secret_handling_compliance`: 5-item checklist (เหมือน T-065)
- `blocker`: null/details

## Definition of Done

- [ ] MR เปิดบน `fix/ci-rollback-guards` (branched from origin/main 540b07f)
- [ ] Pipeline test + build green บน MR; deploy = manual-pending
- [ ] Simulation ≥25/25 assertions pass + SIMULATION PASS
- [ ] `when: manual` ยังอยู่ (verify diff ไม่แตะ `.gitlab-ci.yml:88`)
- [ ] ไม่มี placeholder/alert/TODO ใน 2 ไฟล์
- [ ] 5 Secret Handling items ผ่านครบ

## After this task (Lead จะทำ)

1. Lead spot-check diff + simulation output + secret audit
2. Lead spawn vollos-auditor (T-068) — เน้น: guard correctness, resource_group syntax, edge case scenario fidelity
3. ถ้า Auditor pass → owner merge MR
4. **หลัง merge** — owner ทดสอบ production (Part 2):
   - (a) กด "Run" deploy manual 1 ครั้ง → smoke ต้อง pass, ไม่ rollback
   - (b) ช่วงดึก ~02:00 ICT — ทดสอบ fake broken deploy → verify rollback + Telegram
5. หลัง Part 2 pass → Lead spawn T-069 Phase A-3 Part 3 (flip `when: manual` → `when: on_success`) + Auditor

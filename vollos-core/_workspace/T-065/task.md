---
id: T-065
title: Phase A-2 — Auto-rollback on smoke fail + Telegram alert + local simulation test
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T14:20+07:00
dependencies: [T-063, T-064]
owned_files:
  - .gitlab-ci.yml
  - infra/test-rollback-simulation.sh   # new
---

## Context

**Phase A-2 of 3** — หลัง A-1 (smoke test) เสร็จ + merged (main HEAD=`0a271db`) ต้องเพิ่ม safety net ก่อน A-3 (auto-deploy) จะเปิดใช้งาน **ยังคง `when: manual` ไว้** — A-3 ค่อยเปลี่ยน

**Owner chose hybrid approach:** local simulation ก่อน, ไม่ test บน production ตอนนี้ (เหตุผล: build discipline ตั้งแต่ pre-customer)

**Current state (origin/main:.gitlab-ci.yml, L50-67):**
- ssh deploy command + smoke test block (retry 3×10s) + `when: manual`
- ไม่มี tag pre-deploy, ไม่มี rollback path, ไม่มี alert
- curl ไม่มี `--max-time` (T-064 finding SEC-001 LOW)

## Requirements (implementation outline — DevOps ปรับได้ แต่ต้อง cover ทุกข้อ)

1. **Record LAST_GOOD ก่อน deploy** — ก่อน `git pull` บน VPS record current HEAD SHA (อ่านด้วย `git rev-parse HEAD` ภายใน ssh)
2. **Fix T-064 SEC-001:** curl ใช้ `--max-time 10 --connect-timeout 5` ทั้ง 2 endpoints
3. **Smoke fail หลัง 3 retries → auto-rollback:**
   - ssh กลับไป: `git reset --hard $LAST_GOOD && docker compose up -d --build`
   - รอ rollback finish (sleep 5-10s container restart)
   - Re-verify smoke หลัง rollback (ขั้นต่ำ 1 ครั้ง) — ถ้า rollback smoke fail ด้วย → alert พิเศษ (double failure)
4. **Telegram alert** ส่งทั้ง 2 case:
   - Single failure (new deploy fail, rollback ok) — alert message รวม: commit SHA ที่พยายาม deploy, rollback SHA, pipeline URL
   - Double failure (rollback ก็ fail) — alert message ระบุชัดว่า VPS need manual attention
   - ใช้ `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (GitLab CI vars — verified exist)
5. **Local simulation script** `infra/test-rollback-simulation.sh`:
   - รันได้ offline ไม่ต้อง SSH หรือ network (จำลอง smoke fail + rollback path)
   - Assert: (a) rollback SSH command ถูก construct ถูกต้อง (b) Telegram payload structure ถูก (c) Exit code ≈ 1 เมื่อ smoke fail ไม่กู้
   - Output: `SIMULATION PASS` หรือ `SIMULATION FAIL` + detail
   - ห้ามต้อง token จริง (ใช้ fake `TELEGRAM_BOT_TOKEN=FAKE_TOKEN` สำหรับ simulation)
6. **`when: manual` ยังอยู่** (A-3 งาน)

## Secret Handling Protocol (MASTER — inject จาก memory `feedback_secret_handling_protocol`)

**FORBID list:**
- ห้าม `cat .env`, `Read .env`, หรือ `docker compose config` ที่ resolve secret
- ห้าม echo / log `$TELEGRAM_BOT_TOKEN`, `$VPS_SSH_KEY`, `$CI_REGISTRY_PASSWORD`, หรือ CI var value ใดๆ
- ห้ามรัน curl ด้วย `-v` (verbose — อาจ log full URL รวม token)
- ห้าม `set -x` ก่อนยิง curl Telegram API (bash xtrace leak URL)

**Checklist:**
- [ ] Telegram API URL ใช้ `-sS` (silent + show error) เท่านั้น — ห้าม `-v`
- [ ] CI job script ไม่มี `set -x` ใน block ที่แตะ token
- [ ] output.md / MR description ไม่มี token plaintext (แสดงได้แค่ sha256 first-8 fingerprint ถ้าจำเป็น)
- [ ] Local simulation script **ไม่**ใช้ real token — ตั้ง `TELEGRAM_BOT_TOKEN=FAKE_TOKEN` ใน script
- [ ] ถ้าต้อง display CI vars — ใช้ `sed 's/=.*/=***/'` หรือชื่อ key อย่างเดียว

**Cleanup:**
- หลังทำงาน: ไม่มีไฟล์ temp, log, history ที่เก็บ token
- `history -c` (ถ้าใช้ shell interactive) — owner rule ห้าม echo ใน terminal history

**Spot-check (Lead จะทำ):**
- grep MR description + commit message + diff สำหรับ suspicious token pattern
- ตรวจ local simulation script ว่า hardcode fake token + ไม่อ่าน env จริง

## Acceptance Criteria

1. `.gitlab-ci.yml` deploy stage: record LAST_GOOD ก่อน pull + auto-rollback path + Telegram alert (single + double failure) + `--max-time 10 --connect-timeout 5`
2. `infra/test-rollback-simulation.sh` รันได้ offline + output `SIMULATION PASS` บน happy path + `SIMULATION FAIL` detectable
3. Simulation script cover ≥ 3 scenarios: (a) smoke fail → rollback succeeds (b) smoke fail → rollback also fails (c) happy path smoke passes (ไม่ trigger rollback)
4. Smoke/rollback/alert blocks ไม่มี secret leak (no `-v`, no `set -x` in sensitive blocks, fake token in simulation)
5. `when: manual` คงไว้; diff ไม่แตะ build/test stage หรือ ssh_key/known_hosts config

## Branch + MR discipline

- Branch จาก `origin/main` (HEAD ตอนนี้ `0a271db`): `git fetch && git checkout -b feat/ci-auto-rollback origin/main`
- Conventional commit: `feat(ci): add auto-rollback on smoke fail with Telegram alert`
- Push + open MR (`glab mr create` หรือ GitLab API — token `VOLLOS_CLI` ใน `/home/ipon/workspace/vollos/.env`)
- ห้าม push ตรง main
- ห้าม trigger deploy job จริง

## Expected Output (output.md)

- `self_review`: ทุก AC มี `result: true` + evidence `file:line`
- `placeholders_remaining`: `none — grep clean` (grep `TODO|TBD|placeholder|FIXME|alert\\(|coming soon`)
- `files_changed`: list + diff stat + reason
- `mr_url`, `commit_sha`, `pipeline_url`
- `simulation_output`: paste output ของ `bash infra/test-rollback-simulation.sh` — ต้อง end `SIMULATION PASS`
- `secret_handling_compliance`:
  - ยืนยัน 5 item ใน Secret Checklist ด้านบน (ระบุ evidence ละ item)
  - ระบุว่า fake token value ที่ใช้ใน simulation คืออะไร (string literal แสดงได้ เพราะ fake)
- `blocker`: null ถ้าไม่มี, ถ้ามี — หยุดแล้วรายงาน

## Definition of Done

- [ ] MR เปิดบน `feat/ci-auto-rollback`
- [ ] Pipeline test + build green บน MR
- [ ] deploy job = manual-pending (ไม่ trigger)
- [ ] `infra/test-rollback-simulation.sh` รันจบด้วย `SIMULATION PASS` (paste output ใน output.md)
- [ ] 5 Secret Handling Checklist ผ่านครบ
- [ ] `.gitlab-ci.yml` diff ≤ 60 บรรทัดเพิ่ม (justify ถ้าเกิน)
- [ ] ไม่มี `alert()`, `TODO`, `TBD`, `placeholder`, `coming soon` ใน 2 ไฟล์

## After this task (Lead จะทำ)

1. Lead spot-check: diff + simulation output + secret audit (grep token pattern in commit/MR)
2. Lead spawn vollos-auditor (T-066) — เน้น: rollback logic correctness, Telegram token leak, simulation coverage, double-failure handling
3. ถ้า Auditor pass → owner decide merge
4. **หลัง merge A-2** — owner กำหนดเวลาช่วงดึก (~02:00 ICT) → spawn T-067 Phase A-3 + production verification test (ดึก = traffic น้อย; production test เท่านั้น หลัง local simulation pass)

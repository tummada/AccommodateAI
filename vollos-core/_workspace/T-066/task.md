---
id: T-066
title: Security audit — T-065 auto-rollback + Telegram alert + local simulation
assigned_to: vollos-auditor
priority: high
spawn_started_at: 2026-04-20T14:55+07:00
dependencies: [T-065]
owned_files: []   # read-only review
---

## Context

T-065 เพิ่ม auto-rollback logic + Telegram alert + local simulation ใน `.gitlab-ci.yml` + `infra/test-rollback-simulation.sh` + รวม fix T-064 SEC-001 (`--max-time 10 --connect-timeout 5`) — branch `feat/ci-auto-rollback` MR !18 Lead spot-check ผ่านแล้ว (diff +26/-4 + 305-line sim, secret scan clean, self_review ครบ 11 fields, simulation 23/23 pass)

## Scope

รีวิวเฉพาะ **diff ของ T-065** เท่านั้น:
- `git diff origin/main origin/feat/ci-auto-rollback` (`.gitlab-ci.yml` +26/-4 และ `infra/test-rollback-simulation.sh` +305/-0)
- output.md ของ T-065: `_workspace/T-065/output.md`

**ห้ามออกนอก scope:** อย่ารีวิว test/build stage เดิม, ssh_key config, หรือ smoke test block เดิม (T-063 — ผ่านไปแล้วใน T-064)

## Review checklist (บังคับ)

### Rollback correctness
1. **LAST_GOOD capture timing** — บันทึกก่อน `git pull` จริงไหม? ถ้ามี race condition หรือ multiple concurrent deploy, LAST_GOOD จะ stale ไหม?
2. **Rollback SSH command** — `git reset --hard $LAST_GOOD && docker compose up -d --build` มี injection risk จาก `$LAST_GOOD` (source = `git rev-parse HEAD` ผ่าน ssh output — untrusted ใน theory) ไหม? ระบุ defense
3. **Re-verify smoke after rollback** — มีจริงหรือเปล่า? ถ้าไม่ pass (double failure) แล้วยังยิง `exit 1` + alert ถูกต้อง?
4. **Rollback idempotency** — ถ้า rollback ล้ม rerun pipeline manual จะ safe ไหม? (LAST_GOOD อาจ stale แล้วถ้า head VPS เปลี่ยน)

### Secret & log hygiene
5. **Telegram token leak in CI log** — curl `-sS` + `--data-urlencode` + no `set -x` + no `-v` → พอป้องกันไหม? GitLab runner log จะ capture token ที่ไหนได้บ้าง (URL query string, headers, error output, stderr)?
6. **Error path leak** — ถ้า Telegram curl fail → error message จะ echo full URL (รวม token) ไหม? `-sS` suppress progress แต่ show error — error message format เป็นยังไง?
7. **Simulation fake token** — hardcoded literal (`FAKE_TOKEN_FOR_SIMULATION`) ถูกต้อง, แต่ verify ว่า simulation script ไม่ accidentally import real env (เช่น sourcing .env, reading `$TELEGRAM_BOT_TOKEN` ที่ shell มีอยู่)

### Simulation rigor
8. **Coverage completeness** — 3 scenarios (rollback OK, double fail, happy path) + secret hygiene (4 assert) = 23 assertions — มี edge case ที่ขาดไหม (เช่น: rollback SSH fail network error, partial smoke — api 200 auth 000, Telegram API 5xx, LAST_GOOD empty/malformed)?
9. **Simulation fidelity** — mock functions สะท้อน production behavior จริงไหม? เช่น `ssh` mock return exit code ที่ตรงกับ real ssh? `curl` mock return status codes ที่ production จะเห็น?
10. **Assertion strictness** — assertions ใช้ `grep -q` หรือ exact match? มี false pass ไหม (เช่น substring match ทำให้ ROLLBACK OK match string ที่ไม่ใช่ ROLLBACK OK เต็ม)?

### Deploy pipeline safety
11. **`when: manual` preserved** — verify diff ไม่แตะ `when:` / `only:` / `needs:` / `environment:`
12. **No accidental auto-trigger** — MR !18 pipeline ที่ run แล้ว (2464577470) ไม่ trigger deploy จริงใช่ไหม? ยืนยันว่า `only: - main` + MR event → deploy ไม่ run
13. **`tg_alert` graceful degrade** — ถ้า CI var TELEGRAM_BOT_TOKEN/CHAT_ID ไม่ตั้ง → pipeline ยังทำงานได้ไหม หรือ fail silently?

### Compliance
14. **User data / PII** — task นี้แตะไหม? (คาดว่าไม่แตะ — compliance_verdict: not_applicable)
15. **Audit trail** — commit message + MR body มี info เพียงพอสำหรับ future forensics ไหม?

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-066/review-auditor.md` format เดิมของ vollos-auditor:

- `verdict: pass | fail | conditional_pass`
- `findings`: แยก CRITICAL / HIGH / MEDIUM / LOW / INFO — ทุก finding มี `location: file:line` + `recommendation` (อ้าง file:line ไม่ generic)
- `compliance_verdict`: not_applicable OK
- `ok_to_merge`: true/false + reasoning
- `files_read`, `commands_used`
- `checklist_verification`: ครบทั้ง 15 ข้อข้างบน (แต่ละข้อ PASS/FAIL + evidence)

## ข้อห้าม

- ห้ามแก้ไฟล์ (review-only)
- ห้าม echo secret value (TELEGRAM_BOT_TOKEN, VPS_SSH_KEY, VOLLOS_CLI) — ใช้ key name หรือ `***`
- ถ้า CRITICAL / HIGH → verdict = fail หรือ conditional_pass + fix path ชัด
- ถ้า MEDIUM → conditional_pass + ระบุว่าเงื่อนไขอะไรต้องทำก่อน merge
- ถ้า LOW / INFO → pass OK, flag ไว้ future

## Done criteria

- review-auditor.md เขียนเสร็จ + verdict ชัด
- ครบ 15 ข้อ checklist พร้อม evidence
- ทุก finding อ้าง file:line
- ระบุ ok_to_merge ชัดเจน

---
id: T-069
title: Phase A-3 Part 2(b) prep — broken /health commit for rollback verification test
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T15:45+07:00
dependencies: [T-067, T-068]
owned_files:
  - apps/api/src/index.ts
---

## Context

**Phase A-3 Part 2 (b)** — เจ้านายจะทดสอบ rollback + Telegram alert ในวันนี้ (ไม่รอดึก — pre-customer no traffic risk)

**A-3 Part 1 merged** แล้ว (main HEAD=`ea9a548`), VPS deployed + smoke passed (Part 2a)

**เป้าหมาย T-069:** สร้าง "broken commit" บน branch แยกพร้อม MR — เจ้านาย merge + trigger deploy manual → smoke fail → rollback logic ต้อง kick in + Telegram ต้องมา

## What to change (minimal scope — 1 file เท่านั้น)

**File:** `apps/api/src/index.ts`
**Current healthHandler** (approx L24-L34):
```ts
// ─── Health handler (shared by /health and /api/v1/health) ───────────────────
// /health is kept for Docker HEALTHCHECK + infra/monitor.sh (backwards compat).
// /api/v1/health added per CLAUDE.md K2 — all new APIs live under /api/v1/.
const healthHandler = (c) => c.json({ status: 'ok' });
```

**Change to:**
```ts
// ─── Health handler (shared by /health and /api/v1/health) ───────────────────
// INTENTIONALLY BROKEN FOR ROLLBACK VERIFICATION TEST (T-069 Phase A-3 Part 2b)
// This commit MUST be reverted after rollback test passes — see task T-069 revert plan.
const healthHandler = (c) => c.json({ status: 'broken_for_rollback_test' }, 500);
```

**ห้ามแตะไฟล์อื่น** — scope จำกัด 1 ไฟล์เพื่อให้ revert ง่าย

## Expected deploy behavior (สำหรับ test โดยเจ้านาย)

1. Owner merges MR
2. Owner triggers deploy manual in GitLab UI
3. CI job:
   - LAST_GOOD = ea9a548 (current VPS HEAD from Part 2a deploy)
   - Guard passes (40-char SHA)
   - git pull → VPS HEAD = broken commit
   - docker compose up -d --build → container rebuilds with broken code
   - Smoke attempt 1: `/api/v1/health` = 500 → retry
   - Smoke attempt 2: `/api/v1/health` = 500 → retry
   - Smoke attempt 3: `/api/v1/health` = 500 → FAIL
   - **Auto-rollback:** ssh `git reset --hard ea9a548 && docker compose up -d --build`
   - Re-verify smoke: should PASS (back to good code)
   - Telegram alert sent: "ROLLBACK OK — deploy <broken_sha> failed smoke, rolled back to ea9a548..."
   - Pipeline exit 1 (deploy job = failed, per design)
4. VPS endpoints back to 200 (from rollback code)
5. Expected downtime: ~3-5 min (build + smoke retries + rollback build)

## Acceptance Criteria

1. Branch `test/break-health-for-rollback-verify` created from `origin/main` (HEAD=`ea9a548`)
2. **เฉพาะ** `apps/api/src/index.ts` healthHandler แก้ — return status 500 + descriptive body
3. Comment ในโค้ดระบุชัด: "INTENTIONALLY BROKEN" + task ID + revert instruction
4. MR opened — title: `test: intentionally break /health for rollback verification — REVERT AFTER`
5. MR description ชัด: purpose + revert plan (reference to T-069)
6. **ห้ามแก้:** `apps/auth-service/*`, `.gitlab-ci.yml`, docker files, schema, หรือไฟล์อื่นใด
7. Pipeline test + build green บน MR (build ต้องผ่านเพราะ TypeScript valid, แค่ runtime return 500)

## Branch + MR discipline

- Branch: `test/break-health-for-rollback-verify` from origin/main
- Conventional commit: `test: intentionally break /api/v1/health for A-3 rollback verification`
- ห้าม push main ตรง
- ห้าม trigger deploy (owner จะ trigger เอง)
- ห้าม merge MR เอง (owner merges)

## Output (output.md)

- `self_review`: 7 AC + evidence file:line
- `placeholders_remaining`: grep clean
- `files_changed`: apps/api/src/index.ts (diff stat + lines)
- `mr_url`, `commit_sha`, `pipeline_url` — pipeline ต้อง green (test+build, no deploy yet)
- `revert_plan`: ระบุ commit SHA + ไฟล์ที่ต้อง revert พร้อม procedure (DevOps ครั้งถัดไปจะ spawn ทำตาม plan นี้)
- `test_runbook_for_owner`: ขั้นตอนเจ้านายต้องทำเรียงลำดับ (merge → trigger → observe → verify Telegram → confirm rollback) + expected log messages
- `monitoring_tips`: URL ที่ต้องดู + สิ่งที่ต้องจด (timestamps, smoke attempt values, rollback SHA match)

## Skip Auditor rationale (inject)

Part 2(b) เป็น **test commit ของระบบ rollback** (ephemeral by design) — Lead จะ skip formal Auditor review เพราะ:
1. เป็น 1-line change ที่ออกแบบให้ fail
2. Commit จะ revert ทันทีหลัง test
3. ไม่เพิ่ม attack surface ใหม่ (endpoint เดิม แค่ status code เปลี่ยน)
4. Rollback logic ที่ถูก test = ผ่าน Auditor แล้วใน T-064 + T-066 + T-068

**Mandatory Auditor Gate exception documented — Lead approval (session #006).**

## Critical constraints

- **ห้าม** แตะไฟล์นอก `apps/api/src/index.ts`
- **ห้าม** เพิ่ม console.error หรือ log ที่ dump sensitive info (ให้ 500 เฉยๆ พอ)
- **ห้าม** trigger deploy — owner action only
- **ห้าม** push main — branch + MR only
- ถ้า TypeScript compile fail (เช่น type ของ status code 500 ไม่ match) → adjust syntax ให้ผ่าน แต่ยังคง runtime return 500

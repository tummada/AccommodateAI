---
id: T-070
title: Revert broken /health commit — restore production after A-3 Part 2b rollback test
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T15:55+07:00
dependencies: [T-069]
owned_files:
  - apps/api/src/index.ts
  - apps/api/src/health.test.ts
---

## Context

**Phase A-3 Part 2(b) rollback test PASSED** ✅
- MR !20 merged → deploy triggered → smoke failed 3x → auto-rollback kicked in → Telegram alert sent → VPS back to `ea9a548`
- main HEAD ตอนนี้ = `6d5de79` (merge commit ของ broken code) — repo state ยัง "broken" แต่ VPS rolled back แล้ว
- Live: vollos.ai/api/v1/health = 200 (from rolled-back container), main branch code = 500 (mismatch)

**This task:** restore main branch code to match VPS state — revert broken commit ออก

## Revert procedure (from T-069 output.md § revert_plan)

**Preferred: git revert merge commit**
```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
git fetch origin main
git checkout -b revert/break-health-for-rollback-verify origin/main
git revert -m 1 6d5de79 --no-edit
# edit commit message to conventional format (see below)
```

**Expected files restored:**
1. `apps/api/src/index.ts` — `healthHandler` = `c.json({ status: 'healthy', service: 'vollos-api' })` (no status code = default 200) + original 3-line comment (no "INTENTIONALLY BROKEN" block)
2. `apps/api/src/health.test.ts` — assertions back to 200 + `{ status: 'healthy', service: 'vollos-api' }` + remove 4-line intentional-break comment

**Fallback if revert conflicts:** manual restore
```bash
git checkout ea9a548 -- apps/api/src/index.ts apps/api/src/health.test.ts
git commit -m "..."
```

## Pre-push verification (MANDATORY)

```bash
pnpm --filter @vollos/api typecheck     # expected: 0 errors
pnpm --filter @vollos/api test -- --run # expected: 63+ tests pass
```

**ห้าม push ถ้าตกอันใดอันหนึ่ง**

## Acceptance Criteria

1. Branch `revert/break-health-for-rollback-verify` from `origin/main` (HEAD=`6d5de79`)
2. 2 files revert ตามกำหนด (index.ts + health.test.ts) — ไม่แตะไฟล์อื่น
3. Conventional commit: `revert: restore /health handler after rollback verification (T-069 follow-up)`
4. Local typecheck + test = pass ทั้งคู่ก่อน push
5. MR opened — **NOT merged** (owner merges)
6. Pipeline test + build green on MR
7. **ห้าม trigger deploy** (owner triggers after merge)

## Branch + MR discipline

- ห้าม push main ตรง
- ห้าม merge MR เอง
- ห้าม trigger deploy
- MR description: ระบุว่า reverts broken commit จาก T-069 + restore /health → 200

## Output (output.md)

- `self_review`: 7 AC + evidence file:line (อ้าง commit SHA + test output)
- `placeholders_remaining`: grep clean
- `files_changed`: 2 files + diff stat
- `mr_url`, `commit_sha`, `pipeline_url`
- `local_verification_output`: paste typecheck + test output summary
- `blocker`: null/details

## Definition of Done

- [ ] MR เปิดบน `revert/break-health-for-rollback-verify`
- [ ] Pipeline test + build green
- [ ] Local typecheck 0 errors
- [ ] Local test suite pass (63 tests)
- [ ] ไฟล์แก้แค่ 2 ไฟล์ (diff --stat)
- [ ] ไม่มี placeholder

## After this task

1. Lead spot-check diff + test output
2. Skip formal Auditor (revert ของ test commit — reference T-068/T-066/T-064 already covers /health handler)
3. Owner merge MR
4. Owner trigger deploy manual → smoke pass attempt 1 → no rollback → VPS HEAD moves to revert commit
5. Lead confirm vollos.ai/api/v1/health = 200 "healthy"
6. **Ready for Part 3** — spawn DevOps flip `when: manual` → `when: on_success` + Auditor review

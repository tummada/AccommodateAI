---
id: T-072
title: Security audit — T-071 flip `when: manual` → `when: on_success`
assigned_to: vollos-auditor
priority: high
spawn_started_at: 2026-04-20T16:30+07:00
dependencies: [T-071]
owned_files: []
---

## Context

T-071 เปลี่ยน `.gitlab-ci.yml:94` จาก `when: manual` → `when: on_success` → **เปิด auto-deploy** หลัง merge main

Branch `feat/ci-auto-deploy-on-success`, MR !22, diff 1 line (`+1/-1`)

## Scope

รีวิว **เฉพาะ 1-line diff** ของ T-071 + ตรวจว่าหลัง flip — **safety net ยัง complete**
- Lead spot-check: all safeguards intact (file:line listed in output.md `safeguards_intact`)
- Auditor focus: **security implication ของการลบ human approve gate**

## Review checklist (security-focused)

### Auto-deploy trigger model
1. **Trigger surface change** — หลัง flip: ใครก็ตามที่ push/merge เข้า main = trigger production deploy ทันที. Branch protection + MR review + 2-person approval (ถ้ามี) เพียงพอไหม?
2. **Bypass paths** — มีวิธี push main โดยไม่ผ่าน MR ไหม? (direct push by maintainer, force-push, admin override) — ตรวจ GitLab branch protection settings
3. **Malicious commit detection** — ถ้า attacker compromise account → commit + MR + auto-merge → auto-deploy? Smoke test จะ catch เฉพาะ health endpoint — ไม่ catch supply-chain attack ที่ endpoint ยัง return 200

### Concurrent-deploy race
4. **resource_group efficacy** — `production_deploy` (T-067) เพียงพอป้องกัน concurrent auto-deploys จาก 2 merges ใกล้กันไหม? edge case: merge A ระหว่าง deploy A กำลังรัน → Pipeline B queued serially?
5. **Pipeline queue depth** — ถ้ามี merges 5 commits rapid-fire → 5 pipelines queued → OK หรือ risky?

### Smoke + rollback + Telegram coverage
6. **Safeguards verified intact** — Lead claim ใน output.md ถูกต้องไหม (re-verify file:line):
   - smoke test block (3 retries, curl --max-time, both endpoints)
   - LAST_GOOD guard (40-char check, exit 1)
   - Rollback ssh (git reset --hard + docker compose up)
   - Telegram alert (ROLLBACK OK + DOUBLE FAILURE paths)
   - resource_group lock
7. **First auto-deploy timing** — Lead/DevOps claim "first auto-deploy runs on the merge commit of MR !22 itself" — ถูกต้องไหม ตาม GitLab YAML semantics?

### Operational readiness
8. **Rollback tested in production** — T-069/T-070 verified rollback cycle on real VPS (Telegram received + VPS restored) → evidence ว่า safeguards ทำงานจริง ไม่ใช่ theoretical
9. **Monitoring gap** — หลัง flip, มี visibility gap ไหม (เช่น ไม่มี Slack/email backup นอกจาก Telegram)? Telegram channel ใครเห็น?
10. **Rollback on Telegram failure** — ถ้า TELEGRAM_BOT_TOKEN unset → `tg_alert()` graceful degrade (return 0). Rollback ยังทำงาน แค่ไม่มี alert — acceptable?

### Compliance
11. **User data / PII** — flip ไม่แตะ data path. compliance_verdict = not_applicable
12. **Audit trail** — commit message + MR description มี context เพียงพอสำหรับ future forensics?

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-072/review-auditor.md`:

- `verdict: pass | fail | conditional_pass`
- `findings`: CRITICAL/HIGH/MEDIUM/LOW/INFO + file:line + recommendation
- `compliance_verdict: not_applicable`
- `ok_to_merge: true|false` + reasoning (short paragraph explaining whether auto-deploy is safe to enable **given existing safeguards + production-tested rollback**)
- `checklist_verification`: 12 items + evidence
- `pre_merge_conditions`: list (if any — must complete before merge)
- `post_merge_monitoring`: recommendations ที่ Lead/owner ต้องทำหลัง first auto-deploy (เช่น watch Telegram, verify endpoint health, etc.)

## ข้อห้าม

- ห้ามแก้ไฟล์ (review-only)
- ห้าม echo secret values
- CRITICAL/HIGH → fail + fix path
- MEDIUM → conditional_pass + pre-merge condition
- LOW/INFO → pass OK

## Done criteria

- review-auditor.md เขียนเสร็จ + verdict ชัด
- ทุก finding อ้าง file:line
- ok_to_merge ชัด + reasoning
- post_merge_monitoring block ระบุสิ่งที่ต้องทำหลัง merge (สำคัญเพราะ first auto-deploy จะเริ่มทันที)

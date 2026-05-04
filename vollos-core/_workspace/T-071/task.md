---
id: T-071
title: Phase A-3 Part 3 — flip deploy `when: manual` → `when: on_success` (enable auto-deploy)
assigned_to: vollos-devops
priority: high
spawn_started_at: 2026-04-20T16:15+07:00
dependencies: [T-067, T-068, T-069, T-070]
owned_files:
  - .gitlab-ci.yml
---

## Context

**Phase A complete prerequisite stack (all merged + production-tested):**
- A-1 ✅ smoke test (T-063, MR !17)
- A-2 ✅ rollback + Telegram (T-065, MR !18)
- A-3 Part 1 ✅ LAST_GOOD guard + resource_group (T-067, MR !19)
- A-3 Part 2 ✅ production verification (normal + broken deploy, rollback **verified on real VPS**)
- Revert ✅ MR !21 (T-070) → main HEAD=`b45db24`

**This task:** ขั้นสุดท้ายของ Phase A — **เปิด auto-deploy** โดยเปลี่ยน `when: manual` → `when: on_success` ใน `.gitlab-ci.yml` deploy stage

**หลัง merge ของ task นี้:** ทุก merge เข้า `main` จะ trigger deploy อัตโนมัติ (ไม่ต้องกด ▶ อีก) ถ้า smoke fail → auto-rollback + Telegram alert ทำงานเหมือนเดิม

## Scope (minimal — 1 line change)

**Current state (from T-067, `.gitlab-ci.yml:94`):**
```yaml
when: manual
```

**Change to:**
```yaml
when: on_success
```

**ห้ามแตะ:**
- `resource_group: production_deploy` (L96) — ยังต้องอยู่ป้องกัน concurrent deploys
- `environment: production` — ต้องอยู่
- `only: - main` / `needs: [build]` — ต้องอยู่
- Smoke test block / rollback block / Telegram alert — ต้องอยู่
- ไฟล์อื่นทั้งหมด

## Acceptance Criteria

1. Branch `feat/ci-auto-deploy-on-success` from `origin/main` (HEAD=`b45db24`)
2. `.gitlab-ci.yml:94` = `when: on_success` (exactly)
3. Diff `.gitlab-ci.yml` = **1 line change** (`-when: manual` / `+when: on_success`) — หรือ ≤ 3 บรรทัดถ้ามี indent/comment adjustment ที่ justify ได้
4. `resource_group`, `environment`, `only`, `needs`, smoke test block, rollback block — ทั้งหมด**ยังอยู่**
5. Conventional commit: `feat(ci): enable auto-deploy on main (flip manual → on_success)`
6. MR opened (state=opened, target=main, **NOT merged**)
7. Pipeline test + build green on MR; deploy not-run on MR event (`only: - main`)

## Security implications (Auditor will review in T-072)

- Human approve gate removed — any merge to `main` will trigger production deploy within seconds
- Safeguards **still active:** smoke test (3 retries) + LAST_GOOD guard + auto-rollback + Telegram alert + resource_group lock
- First real auto-deploy = next merge to main after T-071 merges (including T-071's own merge will NOT auto-deploy because the flip only takes effect from NEXT pipeline, but technically pipeline after MR merge WILL run with `on_success` — acknowledge this in MR description)

## Branch + MR discipline

- ห้าม push main ตรง
- ห้าม merge MR เอง (owner merges)
- ห้าม trigger deploy จริง
- MR description ต้องระบุชัด: (a) what changes (b) first auto-deploy trigger timing (c) pre-existing safeguards that remain active

## Output (output.md)

- `self_review`: 7 AC + evidence file:line
- `placeholders_remaining`: grep clean
- `files_changed`: 1 file + diff stat
- `mr_url`, `commit_sha`, `pipeline_url`
- `safeguards_intact`: verify and list (smoke test L53-82, rollback L80-90, Telegram L63-77, LAST_GOOD guard L55-58, resource_group L96, needs/only/environment) — ต้องอ้าง file:line
- `first_auto_deploy_note`: อธิบาย timing ของ first real auto-deploy หลัง merge
- `blocker`: null/details

## Definition of Done

- [ ] MR opened on `feat/ci-auto-deploy-on-success` branched from `origin/main` (b45db24)
- [ ] Pipeline test + build green on MR
- [ ] Diff = 1 line change (or ≤3 with justification)
- [ ] All safeguards explicitly verified intact (file:line evidence)
- [ ] Not merged, not deployed

## After this task

1. Lead spot-check diff (should be trivially small)
2. **Lead spawn vollos-auditor (T-072)** — mandatory because deploy trigger security model changes
3. If Auditor pass → owner merges
4. **First auto-deploy happens on the merge commit of T-071 itself** (pipeline runs test+build+deploy automatically on main)
5. Watch first auto-deploy go through normal smoke → production update
6. Phase A complete 🎉

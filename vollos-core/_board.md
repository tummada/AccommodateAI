# vollos-core — Project Board

> **Single source of truth for project STATE only.**
> Rules go in `CLAUDE.md`, not here. This file tracks live status (timestamps, task IDs, decisions).
>
> **Rule for Lead:** ก่อนเขียนอะไรลงนี่ ถามตัวเอง: "สิ่งนี้มี timestamp / task ID / status ที่จะเปลี่ยนไหม?"
> - **ใช่** → ใส่ที่นี่ได้ (สถานะวันนี้)
> - **ไม่** (กฎ / มาตรฐาน / นโยบาย) → ไปที่ `CLAUDE.md`
>
> **Archive rule:** end-of-month OR Done > 20 entries → ย้ายส่วน Done ไป `_archive/_board_YYYY_MM.md`

---

## Session Anchor Log

| Session | Timestamp (ICT) | Constraints summary |
|---------|-----------------|---------------------|
| #001 | 2026-04-18 09:30 | Initial setup. decision_mode=detailed (default — owner ยังไม่เลือก). 3-layer enforcement: CLAUDE.md → Lead inject กฎเข้า task.md → Lead+QA+Auditor verify. Lead allowlist: `_board.md`, `_workspace/*/task.md`, `_workspace/roadmap.md`, `TODO.md`, `CHANGELOG.md` (CANNOT edit `CLAUDE.md` / code / config — must spawn agent). Domain experts ใน repo: vollos-support. |
| #002 handover | 2026-04-18 14:45 | **Handover จาก monorepo เก่า** (`/home/ipon/workspace/vollos`) session มาที่นี่. `.claude/` ที่ monorepo archived แล้ว (`.claude.archived-20260418`). RS-013 Phase 1+2+3 ทำเสร็จที่ monorepo เก่า merge main ทั้ง 2 repo + CI fix ด้วย. Code พร้อม deploy แต่ **VPS ยังไม่พร้อม** (ขาด 4 ข้อ). Memory copy จาก monorepo เก่าครบชุดแล้ว — ดู MEMORY.md ใหม่. Session หน้า continue deploy prep. |
| #003 | 2026-04-19 10:00 | Resume session. decision_mode=detailed. Lead allowlist/Technical Boundary เหมือนเดิม. Status discovered: T-001..T-022 เสร็จแล้ว (T-022 = deploy T-020 CCPA + T-021 rate limit ขึ้น VPS สำเร็จ 2026-04-18 ~16:25 UTC, 10/10 ACs pass, VPS HEAD=49eb642). Landing + auth.vollos.ai + api live. branch `feat/auth-rate-limit` merged to main แล้ว. _board.md ยังไม่ sync T-002..T-022 — ให้ owner ตัดสินใจว่าจะ sync board หรือเริ่มงานถัดไปก่อน. |
| #004 | 2026-04-19 13:54 | Resume session. decision_mode=detailed. Lead allowlist/Technical Boundary เหมือนเดิม. Domain experts: vollos-support. Branch ปัจจุบัน `feat/auth-rate-limit`. Pending: T-024 (L3 rule update), VPS deploy prep 4 ข้อ, board sync T-002..T-022. รอ owner สั่งงาน. |
| #005 | 2026-04-20 08:12 | Resume session (Monday morning). decision_mode=detailed. Lead allowlist/Technical Boundary เหมือนเดิม. Domain experts: vollos-support. Branch `feat/auth-rate-limit` (ยังไม่ merge main). _board.md มี local changes (M). RS-013 deployed สำเร็จแล้วตั้งแต่ 2026-04-18 (VPS HEAD ล่าสุด `a65660d`). Pending follow-ups: tag deploy-20260418, clear bash history, board sync T-002..T-022, GitLab namespace Phase 2 (acmd). รอ owner สั่งงาน. |
| #006 | 2026-04-20 | Resume session. decision_mode=detailed. Domain experts ทดสอบสำเร็จ (acmd: 4 experts visible / vollos-core: vollos-support visible — owner confirmed). Branch state varies session-to-session. _workspace/ git policy still pending. |
| #007 | 2026-04-23 22:33 | Resume session (Thursday night ICT). decision_mode=detailed. Branch `fix/ci-guard-hex-check` (HEAD `90c7d4a fix(ci): strengthen LAST_GOOD guard with hex char check`) — cosmetic CI fix, never merged. T-076..T-082 untracked at this point. (further session details unrecoverable, see git log range `90c7d4a..69620bb`) |
| #008 | 2026-04-28 22:19 | Resume session (Tuesday night ICT). **acmd Lead handshake (M3-001 Beta launch):** [1] Caddy routes 3 acmd subdomains DONE via T-083..T-086 + MR !27 merged 2026-04-28T16:51 ICT (3 flat 1-level subdomains: accommodate / accommodate-app / accommodate-api .vollos.ai → reuse cloudflare.pem). [2] Gmail Nodemailer secrets — pending owner generation from Google Console at that time. **Lessons:** memory updated for VOLLOS_CLI_v2 token location + new feedback rule "search current project root first". |
| #009 | 2026-04-29 08:40 | Resume session (Wednesday morning ICT). decision_mode=detailed. **Major events:** (a) acmd handshake [2] Gmail secrets COMPLETE via T-087 (4 vars copied vollos-core→vollos-acmd via API, sha256 match, masked+protected) — acmd Lead confirmed receipt + dispatched T-070 to wire pipeline. (b) T-088 built `scripts/sync-secrets.sh` (multi-repo CI/CD var distribution script) — MR !28 merged by owner. (c) **Discovery:** _board.md from session #006-#009 was lost during T-088 git checkout — root cause: board edits never committed. (d) **New policy (D14):** _board.md committed via MR EVERY time it's modified — no longer waiting on _workspace/ git policy. |
| #009 closing | 2026-04-29 18:00 | Session marathon complete. Major events: (a) acmd handshake [2/3/5] all CLOSED — Gmail secrets sync, Caddy port retarget, Caddy reload via force-recreate (T-087/T-090/T-095). (b) sync-secrets.sh script built + LOW-1 hardened (T-088/T-091, MR !28+!31). (c) Board lost during T-088 git checkout, restored via T-089 + adopted D14 commit-board-on-modify (MR !29). (d) Caddy admin-socket + dir-mount root-cause fix (T-096, MR !33). (e) ACMD-01 CORS allowlist — first pipeline001 (T2) execution: Writer-Opus + 2 Reviewer-Sonnet fresh-eye + Runner — caught 3 critical bugs single-agent would miss. acmd login on accommodate-app.vollos.ai now LIVE (MR !34 merged). (f) D15: pipeline001 tier system adopted as VOLLOS Lead standard (best-practice.md doc shareable across teams). Owner closing session to restart for SendMessage tool enable (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 added to settings.json). |
| #010 | 2026-04-29 18:15 | Resume session post-restart (Wednesday evening ICT) — SendMessage tool enabled via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. decision_mode=detailed. Lead allowlist/Technical Boundary เหมือนเดิม. Domain experts: vollos-support. Branch `chore/board-session-009-close` (HEAD `9c4b95f`) ยังไม่ merge main + มี untracked `_workspace/T-098-session-009-close/output.md`. รอ owner สั่งงาน. |
| #011 | 2026-04-30 09:17 ICT | Resume session (Thursday morning ICT). decision_mode=detailed (default). Lead allowlist + Technical Boundary unchanged. Domain experts in repo: vollos-support. Branch `chore/best-practice-delete-section-2-5` (HEAD `7f9bf7f` delete § 2.5). _board.md uncommitted (M). Untracked task folders: `_workspace/T-102-commit-board-and-workspace-audit-trail/` + `_workspace/T-103-delete-best-practice-section-2-5/`. Pending follow-up active: vollos-core cleanup waiting for owner trigger "skill vollos-lead แก้เสร็จแล้ว". รอ owner สั่งงาน. |
| #011 closing | 2026-04-30 10:30 ICT | Session complete (Thursday morning, ~75 min). **Major events:** (a) **T-104 cleanup** — deleted CLAUDE.md "File-Based Revision Pattern" section (46 lines) + best-practice.md §2-§6 (200 lines) — rules now canonical in `vollos-lead` skill. Pipeline-small: DevOps Writer + Auditor + QA fresh-eye, 1 round, 0 CRITICAL/HIGH/MEDIUM. MR !40 merged → main `2346f13`. (b) **T-105 board sync** (D14 enforcement) — committed Lead's session #011 board edits via separate MR. **Near-miss caught by DevOps:** Lead's working-tree was on stale base `7f9bf7f` (missing 2 merges with T-099/T-100/T-101/T-102/T-103/D16/session #010) — DevOps stash + branch-from-fresh-main + re-apply 4 surgical edits. MR !41 merged → main `d2f5d7e`. Pipeline-small 0 findings. (c) **New memory rule:** `feedback_fetch_before_edit_board.md` — Lead must `git fetch origin main` + verify merge-base before any `_board.md` edit in long sessions. (d) Local main now sync HEAD `d2f5d7e` (15 commits fast-forwarded). 6 agent spawns this session (3 per task: Writer + Auditor + QA). Owner closing session. |
| #012 | 2026-04-30 10:56 ICT | Resume session (Thursday late-morning ICT). decision_mode=detailed (default). Lead allowlist + Technical Boundary unchanged. Domain experts in repo: vollos-support. Branch `chore/board-session-011-close` (HEAD `e324e72` — already merged into main; local + origin/main fully sync'd, merge-base = HEAD). 5 untracked task folders pending audit-trail commit per D14 + `_workspace/` Git Policy: T-102/T-103/T-104/T-105/T-106. Pending decisions: T-103 § 2.5 SoT relocation (awaiting owner). spawn_count reset = 0. รอ owner สั่งงาน. |

---

## Phases (Roadmap)

_(ยังไม่มี phase งานจริง — รอ owner สั่งงานแรก)_

**Setup phase (in progress):** workspace bootstrap + apply rules from plan01.md

---

## Active Tasks

| ID | Title | Status | Spawned at | Notes |
|----|-------|--------|------------|-------|
| T-102 | Commit _board.md (D14) + 4 _workspace folders (T-098/099/100/101) audit trail | 🟡 in-progress | 2026-04-29T22:01+07:00 | Single MR bundling D14 board state + audit trail per `_workspace/` Git Policy. After merge, working tree clean for new session. |

## Pending — Follow-up

- [x] ~~**🟡 vollos-core cleanup AFTER owner finishes editing `vollos-lead` skill**~~ — done T-104 2026-04-30 09:38 ICT (MR !40 merged 2026-04-30 10:10 ICT, commit `2346f13`)
- [x] ~~**MR !19** merged 2026-04-19 — vollos-core L3 update~~
- [ ] **MR acmd** — L3 + A-M rules บน `docs/add-architecture-rules` branch (commit `2627ff9`) — รอ acmd Lead เปิด MR หลัง owner paste code-fence format → owner review + merge
- [x] ~~**Tag deploy** — `deploy-20260418-1625-49eb642` สำหรับ rollback reference (task T-022 follow-up)~~ — done T-036 2026-04-20 (tag `deploy-20260418-1625` pushed)
- [x] ~~**Clear bash history** — Lead workstation + VPS (T-022 secret handling cleanup)~~ — done T-036 2026-04-20
- [x] ~~**Board sync T-002..T-022** — เพิ่มประวัติ 21 task ย้อนหลังลง Done table~~ — done T-037 Lead 2026-04-20
- [x] ~~**Sync local main + delete merged branch** — `git pull origin main` + `git branch -d feat/auth-rate-limit`~~ — done T-078 (local cleanup; `wip-audit-trail-chore` stash NOT dropped — left for owner review)
- [x] ~~**Decide `_workspace/` git policy**~~ — resolved: commit as audit trail (per CLAUDE.md "_workspace/ Git Policy" section + D14 superset for `_board.md`)
- [x] ~~Owner manual: restart Claude Code + verify symlink + delete .bak — confirmed done 2026-04-19 via system-reminder showing no .bak in skill list~~

---

## ~~Pending — GitLab Namespace Migration (group → personal)~~ ✅ DONE

**Status:** ทั้ง Phase 1 + Phase 2 เสร็จแล้ว
- Phase 1 (vollos-core) — done T-028 2026-04-19 (`gitlab.com:tummadajingjing/vollos-core.git` E2E verified via T-032)
- Phase 2 (acmd) — done silently (owner transferred to `tummadajingjing/vollos-acmd.git` pre-2026-04-29; verified via T-087 API call which used new URL)
- skill-team — already personal `gitlab.com:tummadajingjing/vollos-skill-team.git` ✅

(section retained as audit trail — ห้ามรายงานเป็นงานค้างอีก)

---

## ~~Pending — RS-013 Deploy Prep~~ ✅ DONE 2026-04-18

RS-013 deploy สำเร็จแล้ว session #003 note:
- T-022 = deploy T-020 CCPA + T-021 rate limit — 10/10 ACs pass
- VPS HEAD=`49eb642`, deploy time 2026-04-18 ~16:25 UTC
- Landing + auth.vollos.ai + api live

(section นี้เก็บไว้เป็น audit trail — ห้ามเอา 4 ข้อข้างล่างไปรายงานเป็นงานค้างอีก)

~~1. docker-compose.yml — vollos-core-auth service + port 3004~~ ✅
~~2. env vars — AUTH_RSA_PRIVATE_KEY, AUTH_RSA_PUBLIC_KEY, VOLLOS_AUTH_URL~~ ✅
~~3. DB schema — auth.users, auth.refresh_tokens, auth.user_products~~ ✅
~~4. Caddy — route auth.vollos.ai → port 3004~~ ✅

---

## Pending — งานเล็กทำก่อนก็ได้

- [x] ~~ทดสอบ global Lead ใน `vollos-ai/acmd` — `/vollos-lead` ต้องเห็น domain experts (acmd-legal, acmd-hr-expert, acmd-ui, acmd-ux)~~ — owner confirmed 2026-04-20 (4 experts visible)
- [x] ~~ทดสอบ global Lead ใน `vollos-ai/vollos-core` — `/vollos-lead` ต้องเห็น `vollos-support`~~ — owner confirmed 2026-04-20 (visible)

---

## Post-MVP Backlog (not urgent)

- CCPA Right-to-Delete endpoint (**MUST ก่อนเปิด US จริง**)
- Cross-subdomain cookie config (Domain=.vollos.ai + SameSite=None + Secure)
- Soft-deleted user explicit test
- `db-reset.ts` NODE_ENV guard (defense-in-depth)
- Magic Link + Microsoft login
- PostgreSQL RLS defense-in-depth
- JWT key rotation strategy
- ~~delete `.claude.archived-*` ใน monorepo เก่า หลัง deploy สำเร็จ~~ — done 2026-04-20

---

## Backlog (inherited from T-001)

| ID | Title | Notes |
|----|-------|-------|
| (cleared) | ~~Commit `_workspace/T-001/output.md`~~ | superseded by 2026-04-20 owner question on `_workspace/` git policy (see Pending follow-up) |

---

## Done — เมษายน 2026

| ID | Title | Completed | Spot-checked | Commit |
|----|-------|-----------|--------------|--------|
| T-001 | Setup workspace + apply architecture rules to CLAUDE.md + archive plan01 | 2026-04-18T10:57+07:00 | ✅ verified by Lead (66 rules grep clean, branch=feat/rs-013-core, working tree clean) | `3af176d` |
| T-002 | RS-013 Deploy Prep Phase 2A — RSA keys + Caddyfile + .env.example sync | 2026-04-18T17:00+07:00 | 📜 historical sync (session #005) — from output.md archive | `d940847` |
| T-003 | RS-013 Deploy Prep — Hot-fix 3 HIGH findings from T-002 Auditor | 2026-04-18T17:05+07:00 | 📜 historical sync (session #005) — from output.md archive | `07fc133` |
| T-004 | RS-013 Deploy Prep — Local Integration Test (pre-VPS runtime validation) | 2026-04-18T17:50+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — test only) |
| T-005 | RS-013 Deploy Prep — Fix env_port_conflict (T-004 finding) | 2026-04-18T18:05+07:00 | 📜 historical sync (session #005) — from output.md archive | `0ce7da1` |
| T-006 | RS-013 Deploy Prep — Transfer R2+Telegram creds + Generate passwords → GitLab CI/CD Variables | 2026-04-18T18:30+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — ops only) |
| T-007 | RS-013 Phase 2B — VPS apply (fresh start + backup cron + smoke) | 2026-04-18T19:55+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — deploy only) |
| T-008 | RS-013 Deploy Prep — Caddyfile + Caddy service for CF Origin Cert (Option A) | 2026-04-18T19:25+07:00 | 📜 historical sync (session #005) — from output.md archive | `075a123` |
| T-009 | RS-013 Deploy Prep — Container hardening (4 Auditor findings from MR !12) | 2026-04-18T19:25+07:00 | 📜 historical sync (session #005) — from output.md archive | `3d79c95` |
| T-010 | RS-013 Post-Deploy — Rotate 4 DB passwords (URL-safe hex) + apply on VPS | 2026-04-18T20:08+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — secret rotate) |
| T-011 | RS-013 Phase 2C Track 1 — E2E test on production (AI browser automation) | 2026-04-18T20:24+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — test only) |
| T-012 | RS-013 Hot-fix — vollos.ai Caddy route /api/v1/* → vollos-core-api | 2026-04-18T20:39+07:00 | 📜 historical sync (session #005) — from output.md archive | `e33b9f1` |
| T-013 | RS-013 Post-merge deploy — apply MR !14 Caddy routing fix on VPS | 2026-04-18T20:52+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — deploy only) |
| T-014 | RS-013 Phase 2C — Fix Google One Tap login (3 owner-reported errors) | 2026-04-18T21:09+07:00 | 📜 historical sync (session #005) — from output.md archive | `529bc97` |
| T-015 | RS-013 Phase 2C — Deploy MR !15 (Caddy) + Run DB migrations | 2026-04-18T21:20+07:00 | 📜 historical sync (session #005) — from output.md archive | `5e3c731` |
| T-016 | RS-013 Post-incident — Rotate internal secrets (RSA + 4 DB + UNSUBSCRIBE) after I-T015-1 | 2026-04-18T21:52+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — secret rotate) |
| T-017 | RS-013 Post-rotation — Apply 5 external secrets on VPS + verify all services | 2026-04-18T22:22+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — deploy only) |
| T-018 | Fix monitor.sh — container names + cover all 4 services (T-007 oversight) | 2026-04-18T22:40+07:00 | 📜 historical sync (session #005) — from output.md archive | `21f5d13` |
| T-019 | Track 2 post-test DB verification — confirm 2 leads + unsubscribe + delete worked | 2026-04-18T23:05+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — verify only) |
| T-020 | CCPA Delete compliance — clear IP + user_agent on delete (T-019 finding) | 2026-04-18T23:05+07:00 | 📜 historical sync (session #005) — from output.md archive | `e09dae3` |
| T-021 | Rate limit /onboarding + /me + /auth/* endpoints (auth-service) | 2026-04-18T23:06+07:00 | 📜 historical sync (session #005) — from output.md archive | `d9714e5` |
| T-022 | Batch deploy T-020 + T-021 (CCPA delete + rate limit) to VPS | 2026-04-18T23:22+07:00 | 📜 historical sync (session #005) — from output.md archive | (no commit — deploy only) |
| T-023 | Bootstrap vollos-skill-team repo (7 skills + symlinks + bak) | 2026-04-19T13:51+07:00 | ✅ Lead spot-check: 7/7 symlinks readable, git remote OK, commit `d1cc99e` pushed, 7 .bak preserved | `d1cc99e` (in new repo) |
| T-024 | Update L3 rule — point to vollos-skill-team repo | 2026-04-19T14:05+07:00 | ✅ Lead spot-check: branch `docs/update-l3-rule` pushed, MR !19 open, CLAUDE.md L3 block rendered OK, L1/L2/L4/L5 untouched, working tree restored | `834a394` (on branch, pending MR !19 merge) |
| T-025 | Update vollos-lead SKILL.md MODE 0 — enforce minimum file structure (D7) | 2026-04-19T15:12+07:00 | ✅ Lead spot-check: diff 2+/1- localized ใน MODE 0 (line 245+248), forge-protected untouched, MR !1 open, conventional commit OK | `18fd7ad` merged into main `161756b` 2026-04-19 |
| T-026 | Remove TODO/CHANGELOG/roadmap from vollos-core CLAUDE.md allowlist (D7 sync) | 2026-04-19T15:40+07:00 | ✅ Lead spot-check: diff vs origin/main = 3 deletions only, allowlist block แก้ถูก, MR !20 open HTTP 302, working branch `feat/auth-rate-limit` restored, conventional commit OK | `db3ad92` (on branch, pending MR !20 merge) |
| T-027 | Cleanup 6 stale references in vollos-lead SKILL.md (D7 sync) | 2026-04-19T15:40+07:00 | ✅ Lead spot-check: diff 5+/6- ตาม spec, L248 intact, MR !2 merged → main `774cd5c` | `2449764` → merged |
| T-028 | GitLab namespace migration Phase 1 — vollos-core (group → personal) | 2026-04-19T16:25+07:00 | ✅ Lead spot-check: `.gitlab-ci.yml` ใช้ `$CI_REGISTRY_IMAGE`, remote→new URL, MR !1 merged `74d660d`, pipeline ผ่าน (test+build+push success), branch protection active. Discovery: owner ไม่ได้ "transfer" แต่สร้างใหม่ — old project `vollos-ai/vollos-core` ยังอยู่ (owner เลือก keep 2-3 วัน) | `49c8737` → merged to new repo main |
| T-029 | Recover CI/CD Variables from old project → new | 2026-04-19T16:55+07:00 | ✅ Lead spot-check: 19 variables copied via API (sha256 checksum verified), 0 value leaked to logs, temp files cleaned | (API-only, no commit) |
| T-030 | Delete 18 local-only stale branches (post-migration cleanup) | 2026-04-19T17:15+07:00 | ✅ Lead spot-check: final `git branch` = 2 entries (main + feat/auth-rate-limit), 14 safe + 4 force deletes, remote prune clean, all SHAs in reflog ~90d | (local-only, no commit) |
| T-031 | Verify deploy secrets on new project | 2026-04-19T17:35+07:00 | ✅ Lead spot-check: 19 keys listed, VPS_SSH_KEY/USER/HOST = ❌ not present → discovered owner's workflow is "Lead spawn DevOps SSH" not CI deploy; those 3 vars not needed | (API-only) |
| T-032 | Real E2E deploy test — verify migration Phase 1 100% | 2026-04-19T18:15+07:00 | ✅ Lead spot-check: 3 URLs=200 live, `migration-test 2026-04-19` comment visible in production HTML, VPS HEAD=`a65660d`, MR !2 merged | `7ca8b82` → MR !2 → `a65660d` merged |
| T-033 | Delete old project vollos-ai/vollos-core | 2026-04-19T18:40+07:00 | ✅ Lead spot-check: HTTP 302 redirect (soft-delete grace 7 days), 3 URLs still 200 post-delete, old project marked_for_deletion | (API-only) |
| T-035 | Verify VPS HEAD vs feat/auth-rate-limit — found Case A: already merged via MR !18 | 2026-04-20T08:40+07:00 | ✅ Lead spot-check: git merge-base confirms d9714e5 ancestor of origin/main; local main stale (e5168bf); no MR needed | (read-only diagnostic) |
| T-036 | Tag 2 past deploys + push + clear bash history local+VPS | 2026-04-20T08:35+07:00 | ✅ Lead spot-check: `git ls-remote --tags origin` shows both tags (49eb642 + a65660d dereferenced); local `wc -l ~/.bash_history` = 0 | (tags only) |
| T-083 | Diagnostic: cert ปัจจุบัน SAN coverage (read-only) | 2026-04-28T15:55Z | ✅ Lead spot-check: openssl x509 confirmed `*.vollos.ai + vollos.ai` SAN, NOT covering 2-level; git status clean post-task | (read-only) |
| T-084 | Caddy routes for acmd 3 subdomains — initial 2-level pattern | 2026-04-28T16:25Z | ⚠️ superseded by T-085 (owner switched to flat pattern). Original MR !27 created. | `4be7b3a` (replaced) |
| T-085 | Rewrite to flat 1-level subdomain pattern (reuse cloudflare.pem) | 2026-04-28T16:40Z | ✅ Lead spot-check: 3 blocks at L228/243/256, existing 3 untouched (L125/156/188), all `cloudflare.pem` (no -acmd) | `c0d7ac1` |
| T-086 | Auditor security review of MR !27 (verdict: pass + 1 MEDIUM SEC-001 fixed in same MR) | 2026-04-28T16:50Z | ✅ verdict pass; SEC-001 (CSP connect-src missing accommodate-api) fixed via 1-line patch `7efa83d2`; pipeline 2486099662 success post-merge | `7efa83d2` (CSP fix) → merged via MR !27 (`4f5fd04` merge commit) |
| T-087 | Copy 4 Gmail/Google OAuth secrets vollos-core → vollos-acmd via GitLab API (acmd handshake [2]) | 2026-04-29T09:00+07:00 | ✅ Lead spot-check (independent re-run): 4/4 sha256 MATCH (170eefb5/ab8cb5cb/c29311d4/cdd35c43), all target masked+protected+env_var, output.md leak grep 0 matches, /tmp cleaned | (API-only — no commit) |
| T-088 | Build `scripts/sync-secrets.sh` — multi-repo CI/CD var distribution + dry-run/apply modes | 2026-04-29T09:55+07:00 | ✅ DevOps test: shellcheck clean, dry-run 4/4 in sync, apply test PASSED with throwaway TEST_SYNC_KEY (created/updated/deleted both ends), 0 secret leak. Owner merged MR !28 directly (post-merge Auditor review in T-089). | `64afad9` → MR !28 merged `b8580fa` |
| T-089 | Restore _board.md (session #006-#009 anchor + Done T-083..T-088) + adopt D14 board-commit policy + post-merge audit MR !28 | 2026-04-29T10:00+07:00 | ✅ Lead spot-check: 4 anchor rows + 6 Done rows present, D14 in Decisions Log, MR !29 merged, Auditor pass on MR !28 | `78d45af` → MR !29 merged |
| T-090 | Caddy upstream retarget acmd port 80 → 8080 (handshake [3]) | 2026-04-29T10:35+07:00 | ✅ Lead spot-check: 4-line diff (2 reverse_proxy + 2 comments), acmd-api:3101 untouched, vollos subdomains 200 | `e96d9de` → MR !30 merged |
| T-091 | Fix LOW-1 sync-secrets.sh curl argv leak (--form value=<file syntax) | 2026-04-29T10:25+07:00 | ✅ Lead spot-check: argv leak verified closed via /proc/<pid>/cmdline 64 samples, dry-run 4/4 in sync, Auditor pass | `b0a159a2` → MR !31 merged |
| T-092 | Drop obsolete stash T-088-pre-checkout (content already restored via T-089) | 2026-04-29T10:50+07:00 | ✅ Lead spot-check: pre-drop verification confirmed equivalent content on main, git stash list empty post-drop, reflog recovery available 30d | (git op only) |
| T-093 | Caddyfile L203-204 cosmetic fix (header docs port :80 → :8080 alignment) | 2026-04-29T11:05+07:00 | ✅ Lead spot-check: 2-line diff in header comments only, runtime reverse_proxy untouched, caddy adapt exit 0 | `5db371a` → MR !32 merged |
| T-094 | Diagnostic: Caddy on-disk vs running config diff (acmd handshake [5]) | 2026-04-29T15:55+07:00 | ✅ Confirmed acmd's claim: bind-mount inode pin + admin off blocks reload. No state change in this task. | (read-only) |
| T-095 | Force-recreate Caddy on VPS (Plan A — pickup new Caddyfile, 2s downtime) | 2026-04-29T15:55+07:00 | ✅ Lead spot-check: recreate exit 0 + healthy 7s, 266 lines + 12 accommodate matches loaded, vollos 3/3 200, accommodate 502→Caddy reverseproxy.statusError (good signal) | (deploy only) |
| T-096 | Plan B: Caddy admin Unix socket + dir bind-mount + post-deploy reload (root-cause fix) | 2026-04-29T16:05+07:00 | ✅ Lead spot-check: git mv preserved 12-commit history, local container test admin socket inside-only, no TCP exposure, Auditor pass (0 CRITICAL/HIGH/MEDIUM) | `c8d5d22` → MR !33 merged |
| T-097 | Pre-merge VPS cert migration (infra/certs/* → infra/caddy/certs/, no Caddy restart) | 2026-04-29T16:25+07:00 | ✅ Lead spot-check: 6/6 subdomains 200 same as pre-task, Caddy StartedAt unchanged (nanosecond match), perms 644/600, owner 1000:1000 | (FS op only) |
| ACMD-01 | CORS allowlist update auth-service for accommodate.vollos.ai + accommodate-app.vollos.ai (cross-repo handshake from acmd) — FIRST PIPELINE001 RUN | 2026-04-29T17:55+07:00 | ✅ Pipeline001: Writer(Opus)+2Reviewer(Sonnet)+Runner. Caught 3 critical: rollback endpoint wrong, literal `<timestamp>` placeholder, execution-order gap. Lead spot-check: ACAO header echoes correctly for 3 origins, evil.example.com fail-closed, 0 vollos regression | `43d519f` + `a334a48` → MR !34 merged |
| T-099 | Adopt file-based revision pattern (Option B / tier-based) — formal review + CLAUDE.md policy block | 2026-04-29T20:05+07:00 | ⚠️ INITIAL DELIVERY VIOLATED multi-repo separation (wrote review file into vollos-skill-team repo). Reverted by T-100. CLAUDE.md policy block KEPT. Review file MOVED into vollos-core internal `_workspace/T-099/`. Lesson: feedback_no_cross_repo_writes.md (🔴🔴 critical) | MR !36 merged 2026-04-29T14:57:16Z (`7678ac3`) |
| T-100 | REVERT cross-repo write from T-099 — close skill-team MR !3, delete branch+file, move review into vollos-core | 2026-04-29T20:30+07:00 | ✅ skill-team MR !3 closed (not merged), remote branch+local file deleted, vollos-core review file moved to `_workspace/T-099/review-of-skill-team-draft.md`, CLAUDE.md L76 path updated. 11/11 ACs `result: true` | shipped via MR !36 2nd commit `0705921` — merged with the rest of MR !36 |
| T-101 | Add § 2.5 "P4 Mode Toggle (in-session vs file-based)" to best-practice.md (resolve cross-team P4-vs-multi-iter conflict raised by Lead@acmd) | 2026-04-29T21:00+07:00 | ✅ +40/-0 lines, section order 2.1→2.5 (new at L90 right after 2.4), content verbatim, single-repo discipline (no acmd/skill-team touched). 10/10 ACs `result: true` | MR !37 merged 2026-04-29T14:57:55Z (`1efd67f`) |
| T-104 | Cleanup CLAUDE.md + best-practice.md (post-skill-canonicalization) — pipeline-small (Writer + 2 fresh-eye reviewers, 1 round) | 2026-04-30T09:38+07:00 | ✅ Pipeline-small: DevOps Writer + Auditor + QA both pass 0 CRITICAL/HIGH/MEDIUM. Lead spot-check (post-merge pending owner approval): MR !40 single commit `90e4541`, pipeline 2490141909 success 62s, `git diff origin/main --stat` = 2 files only (CLAUDE.md -46, best-practice.md -200, 0 added), 9-pattern secret scan 0 matches, T-099 audit trail untouched, D14/D15/D16 untouched, KEEP §1/§7/§8/§9 byte-identical. Auditor S5 cross-check: every deleted enforcement rule has canonical home in `vollos-lead/SKILL.md` L437-535 or `pipeline-{small,medium,big}.md` (only §5 Trade-offs cost table is informational, not canonicalized — no rule gap). | `90e4541` → MR !40 merged |
| T-107 | Add REFERENCES to ALTER DEFAULT PRIVILEGES for acmd schema (init-db.sh template) — pipeline-small | 2026-04-30T11:26+07:00 | ✅ Pipeline-small: DevOps Writer (Opus) + Auditor + QA fresh-eye, 1 round, 0 CRITICAL/HIGH/MEDIUM/LOW (Auditor 7 confirmation Notes, QA 8 confirmation Notes incl. postgres docs cross-check). DevOps end-to-end runtime test on throwaway postgres:16-alpine: \dp acmd.users showed acmd_user=arwdx/vollos (x=REFERENCES); has_table_privilege t; auth control f. Lead spot-check: shellcheck 0, 9-pattern secret scan 0, diff +2/-1 single file (acmd block only, auth+vollos byte-identical), conventional commit, MR !43 pipeline 2490688047 success 59s. Cross-team request from Lead@acmd (T-118 FIX local migrations) — Lead pushed back on owner's literal request to avoid init-db.sh crash + proposed ALTER DEFAULT PRIVILEGES instead, owner approved. | `0841ecc` → MR !43 merged `aa8ee4f` |
| T-103 | acmd handover T-108 message — § 2.5 SoT relocation question | 2026-04-30T11:00+07:00 | ✅ Closed by owner confirmation 2026-04-30 11:00 ICT — owner verified § 2.5 (P4 Mode Toggle) already relocated to vollos-skill-team. No vollos-core action needed. (acmd handover reconciled.) | (no commit — discussion-only) |

---

## Decisions Log

| # | Date | Decision | Rationale | Source |
|---|------|----------|-----------|--------|
| D1 | 2026-04-18 | crypto package: copy เข้า acmd repo (ห้ามอยู่ vollos-core) | latency hit ทุก request ถ้าทำเป็น API + ลด attack surface ที่ vollos-core | docs/plan01.md §8, §15.12 |
| D2 | 2026-04-18 | Phase A (vollos-core) ทำก่อน Phase B (acmd) | vollos-core ต้องพร้อมก่อน product จะ join Docker network ได้ | docs/plan01.md §8 |
| D3 | 2026-04-18 | monorepo เดิม: tag `archive/pre-split` ก่อนลบ ไม่ลบทันที | กันงานหายระหว่าง migration + มี backup สำหรับ rollback | docs/plan01.md §8 |
| D4 | 2026-04-18 | Sessions เดิม: ยอมรับ force logout (ACMD ยังไม่มี user จริง) | ไม่กระทบลูกค้า เพราะยังไม่ launch | docs/plan01.md §15.9 |
| D5 | 2026-04-18 | decision_mode = detailed (default — owner ยังไม่เลือก) | owner ใหม่กับทีม AI — โหมดอธิบายทุกขั้นตอนปลอดภัยที่สุด | session #001 |
| D6 | 2026-04-18 | 3-layer enforcement (CLAUDE.md → task.md inject → verify) แทนยัดกฎใน SKILL.md | SKILL.md ใหญ่อยู่แล้ว ใส่ไปก็ไม่อ่าน | session #001 (owner feedback) |
| D7 | 2026-04-18 | Minimum file structure: CLAUDE.md + _board.md + _workspace/T-XXX/ — ไม่สร้าง _conventions-core.md / TODO.md / CHANGELOG.md / roadmap.md แยก | ลด overlap — single source of truth | session #001 (owner feedback) |
| D8 | 2026-04-18 | _board.md archive policy: end-of-month OR Done > 20 → _archive/_board_YYYY_MM.md | กัน _board.md ยาวเกินอ่านยาก | session #001 (owner feedback) |
| D9 | 2026-04-18 | plan01.md ย้ายเข้า docs/ (เป็น archive — restructure plan สำเร็จแล้ว) | จัดเก็บแยก root ให้ clean + อ้างอิง section ใน Decisions Log | session #001 |
| D10 | 2026-04-18 | Future Rules (O1-O3 staging/monitoring/versioning) ใส่ใน CLAUDE.md เป็น section "ยังไม่เปิดใช้" | กันลืมตอน launch product จริง | session #001 (owner เลือก option A) |
| D11 | 2026-04-18 | Migration cleanup (N1-N3) ไม่ทำใน vollos-core repo (เป็นงานของ acmd repo) | vollos-core split ออกมาแล้ว ไม่มี acmd-* code เหลือใน repo นี้ | session #001 (owner confirmed) |
| D12 | 2026-04-18 | **Correction:** Architecture rules ที่เพิ่มจริง = 63 ข้อ (A-M) + 3 Future (O) = 66 ข้อ ไม่ใช่ 58 ตามที่ Lead พูดในการสนทนา | Lead พลาดบวกเลขใน session ก่อน — DevOps ทำตาม spec ของ plan01.md verbatim ซึ่งมี 63 ข้อ. commit message พูดผิดว่า "58" — ห้าม amend (กฎ Best Practices) จึงต้อง flag ไว้แทน | T-001 spot-check |
| D13 | 2026-04-18 | plan01.md ที่ commit แรก ไม่ใช่ git rename (เพราะเดิมไม่เคย track) | end-state correct (อยู่ docs/plan01.md ครบ 29299 bytes) แต่ git log --follow ไม่เห็น history เก่า เพราะไม่มี | T-001 spot-check |
| D14 | 2026-04-29 | _board.md commit ขึ้น git ทุกครั้งที่แก้ — ผ่าน MR (เลิกรอตัดสิน _workspace/ policy) | session #009 board loss incident — board ที่เขียนแต่ไม่ commit ก็เท่ากับไม่มี เมื่อ checkout branch หาย → ของหายตามไป | session #009 (owner approved 2026-04-29) |
| D15 | 2026-04-29 | Pipeline001 tier system (T0-T4) adopted as VOLLOS Lead orchestration standard | First execution on ACMD-01 caught 3 critical bugs single-agent would miss (rollback endpoint, literal placeholder, execution-order gap). Cost ~3.7x but 0 production regression. Best-practice.md created as standalone team-shareable doc. | session #009 (ACMD-01 trial run + best-practice.md) |
| D16 | 2026-04-29 | Adopt file-based revision pattern (Option B — tier-based trigger) for cross-session safety on high-risk tasks | Solves SendMessage cross-session limitation (agent context expires on session restart). Cost +3-5x token vs SendMessage but session-independent + audit trail via revision-history.md. Tier-based to avoid blanket cost. Triggers: auth/JWT/session, deploy production (MODE 3), CCPA/PDPA delete/opt-out, payment/billing, encryption/secrets management — OR Lead estimates > 1 revision round likely. Default for other tasks: pipeline001 in-session SendMessage. | session #010 (Pon approved option B 2026-04-29 19:45) — ref: ~/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern.md |

---

## Spawn Counter

```
spawn_count: 4 (session #012 — T-107 [Writer+Auditor+QA] + T-108 [in-progress])
last_re_read_at: 2026-04-30T11:30+07:00 (session #012 — T-108 spawn)
```

---

## Notes

- **Owner:** pon@vollos.ai — business owner ไม่ใช่ programmer
- **Disclosure (P1-128):** ทีมนี้เป็น AI ทุกตัว — QA/Auditor ตรวจเป็น AI opinion ต้องมี human review ก่อน production จริง
- **Repo state:** vollos-core split ออกมาจาก monorepo เดิมเรียบร้อย — apps/{api, auth-service, landing} + packages/{auth, auth-db, crypto, db}

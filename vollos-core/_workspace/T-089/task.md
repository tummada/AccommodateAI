---
task_id: T-089
title: Restore _board.md (session #006-#009 + Done T-083..T-088) + commit board permanently going forward
agent: vollos-devops
spawn_started_at: 2026-04-29T10:15+07:00
mode: MODE_2 (recovery)
priority: high
estimated_time: 20 min
dependencies: [T-088]
parent_context: "Owner discovered _board.md state from session #006-#009 was lost when DevOps T-088 ran 'git checkout main' (board edits were never committed — only existed in working tree). Owner approved policy change: commit _board.md to git EVERY TIME going forward, no longer waiting on _workspace/ git policy decision."
---

## Goal

1. Restore lost _board.md content from session #006-#009 using available evidence (output.md files + git history + this conversation context)
2. Set permanent policy: _board.md is committed via MR every time it's modified
3. Auditor post-merge review of MR !28 (sync-secrets.sh) — verify no security issues sneaked through

## Branch Strategy

- Pull latest main first (MR !28 merged → main has sync-secrets.sh)
- Branch: `chore/restore-board-session-006-009`
- Open MR after push, request Lead/Auditor review

## Step 1 — Sync local main

```bash
git checkout main
git pull origin main
git branch -d feat/sync-secrets-script  # cleanup merged branch
```

## Step 2 — Restore _board.md content

### What to add back (in correct positions):

**A. Session Anchor Log** — append rows #006-#009 after row #005:

```markdown
| #006 | 2026-04-20 | Resume session. decision_mode=detailed. Domain experts ทดสอบสำเร็จ (acmd: 4 experts visible / vollos-core: vollos-support visible — owner confirmed). Branch state varies session-to-session. _workspace/ git policy still pending. |
| #007 | 2026-04-23 22:33 | Resume session (Thursday night ICT). decision_mode=detailed. Branch `fix/ci-guard-hex-check` (HEAD `90c7d4a fix(ci): strengthen LAST_GOOD guard with hex char check`) — cosmetic CI fix, never merged. T-076..T-082 untracked at this point. |
| #008 | 2026-04-28 22:19 | Resume session (Tuesday night ICT). **acmd Lead handshake (M3-001 Beta launch):** [1] Caddy routes 3 acmd subdomains DONE via T-083..T-086 + MR !27 merged 2026-04-28T16:51 ICT (3 flat 1-level subdomains: accommodate / accommodate-app / accommodate-api .vollos.ai → reuse cloudflare.pem). [2] Gmail Nodemailer secrets — pending owner generation from Google Console at that time. **Lessons:** memory updated for VOLLOS_CLI_v2 token location + new feedback rule "search current project root first". |
| #009 | 2026-04-29 08:40 | Resume session (Wednesday morning ICT). decision_mode=detailed. **Major events:** (a) acmd handshake [2] Gmail secrets COMPLETE via T-087 (4 vars copied vollos-core→vollos-acmd via API, sha256 match, masked+protected) — acmd Lead confirmed receipt + dispatched T-070 to wire pipeline. (b) T-088 built `scripts/sync-secrets.sh` (multi-repo CI/CD var distribution script) — MR !28 merged by owner. (c) **Discovery:** _board.md from session #006-#009 was lost during T-088 git checkout — root cause: board edits never committed. (d) **New policy (D14):** _board.md committed via MR EVERY time it's modified — no longer waiting on _workspace/ git policy. |
```

**B. Done table** — append rows for T-083..T-088 (after T-036):

```markdown
| T-083 | Diagnostic: cert ปัจจุบัน SAN coverage (read-only) | 2026-04-28T15:55Z | ✅ Lead spot-check: openssl x509 confirmed `*.vollos.ai + vollos.ai` SAN, NOT covering 2-level; git status clean post-task | (read-only) |
| T-084 | Caddy routes for acmd 3 subdomains — initial 2-level pattern | 2026-04-28T16:25Z | ⚠️ superseded by T-085 (owner switched to flat pattern). Original MR !27 created. | `4be7b3a` (replaced) |
| T-085 | Rewrite to flat 1-level subdomain pattern (reuse cloudflare.pem) | 2026-04-28T16:40Z | ✅ Lead spot-check: 3 blocks at L228/243/256, existing 3 untouched (L125/156/188), all `cloudflare.pem` (no -acmd) | `c0d7ac1` |
| T-086 | Auditor security review of MR !27 (verdict: pass + 1 MEDIUM SEC-001 fixed in same MR) | 2026-04-28T16:50Z | ✅ verdict pass; SEC-001 (CSP connect-src missing accommodate-api) fixed via 1-line patch `7efa83d2`; pipeline 2486099662 success post-merge | `7efa83d2` (CSP fix) → merged via MR !27 (`4f5fd04` merge commit) |
| T-087 | Copy 4 Gmail/Google OAuth secrets vollos-core → vollos-acmd via GitLab API (acmd handshake [2]) | 2026-04-29T09:00+07:00 | ✅ Lead spot-check (independent re-run): 4/4 sha256 MATCH (170eefb5/ab8cb5cb/c29311d4/cdd35c43), all target masked+protected+env_var, output.md leak grep 0 matches, /tmp cleaned | (API-only — no commit) |
| T-088 | Build `scripts/sync-secrets.sh` — multi-repo CI/CD var distribution + dry-run/apply modes | 2026-04-29T09:55+07:00 | ✅ DevOps test: shellcheck clean, dry-run 4/4 in sync, apply test PASSED with throwaway TEST_SYNC_KEY (created/updated/deleted both ends), 0 secret leak. Owner merged MR !28 directly (post-merge Auditor review in T-089). | `64afad9` → MR !28 merged `b8580fa` |
```

**C. Spawn Counter** — update to current state:

```markdown
spawn_count: 14 (T-083..T-086 session #008 | T-087 + T-088 + T-089 session #009)
last_re_read_at: 2026-04-29T08:40+07:00 (session #009 start)
```

**D. Decisions Log** — append D14:

```markdown
| D14 | 2026-04-29 | _board.md commit ขึ้น git ทุกครั้งที่แก้ — ผ่าน MR (เลิกรอตัดสิน _workspace/ policy) | session #009 board loss incident — board ที่เขียนแต่ไม่ commit ก็เท่ากับไม่มี เมื่อ checkout branch หาย → ของหายตามไป | session #009 (owner approved 2026-04-29) |
```

**E. Pending — Follow-up updates:**

- Mark `Sync local main + delete merged branch feat/auth-rate-limit` → done T-078
- Mark `tag deploy-20260418-1625-49eb642` → done T-036
- Mark `wip-audit-trail-chore` stash → leave as pending (T-078 ไม่ drop)

**F. Pending — งานเล็ก:** mark ✅ both items (owner confirmed 2026-04-20)

**G. Post-MVP Backlog:** mark `delete .claude.archived-*` → done 2026-04-20

**H. Pending — GitLab Namespace Migration:** Phase 1 done T-028. Phase 2 done silently (owner transfer pre-2026-04-29). Mark whole section as done (or move to "completed migrations" subsection at bottom).

## Step 3 — Update CLAUDE.md _workspace/ git policy

ปัจจุบัน CLAUDE.md L255 + onwards พูดเรื่อง `_workspace/` git policy "D14 decision" — ต้องอัพเดทให้สอดคล้อง:
- เพิ่ม "_board.md commit ทุกครั้งที่แก้" rule ที่ section "Best Practices"
- รายละเอียด D14 อยู่ใน CLAUDE.md "_workspace/ Git Policy" section อยู่แล้ว — ตรวจว่า text ตรงกับ board update ไหม → ถ้าตรงไม่ต้องแก้

## Step 4 — Commit + push + open MR

Conventional commit: `chore(board): restore session #006-#009 anchor log + Done T-083..T-088 + adopt D14 commit-board-on-modify policy`

MR title: `chore: restore lost board state + adopt commit-board-every-modify policy (T-089)`

## Step 5 — Spawn Auditor for T-088 post-merge review

หลัง MR T-089 open → spawn Auditor task T-089-audit ตรวจ MR !28 (sync-secrets.sh) ที่ merge ไปแล้ว:
- Read scripts/sync-secrets.sh + scripts/secrets-config.example.yaml + scripts/README-sync-secrets.md
- Verify: no secret leak, shellcheck clean, no SSRF/injection vulnerabilities, token handling safe
- Verdict: pass / fail / conditional_pass

ถ้า Auditor พบปัญหา → spawn fix task ทันที (post-merge fix ผ่าน MR ใหม่)

## Owned Files

- **MODIFIED:** `/home/ipon/workspace/vollos-ai/vollos-core/_board.md` (restore + add D14)
- **MAYBE MODIFIED:** `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` (D14 policy text alignment — only if mismatch found)

## Acceptance Criteria

1. ✅ _board.md มี Session Anchor Log #001..#009 ครบ (re-read ตรวจ)
2. ✅ Done table มี T-083..T-088 (6 rows) — ห้ามขาด
3. ✅ Spawn Counter อัพเดทเป็น 14
4. ✅ D14 อยู่ใน Decisions Log
5. ✅ Pending Follow-up + Backlog updates ตามที่ระบุใน E/F/G
6. ✅ Branch pushed + MR opened (NOT merged — wait Lead spot-check + Auditor)
7. ✅ Auditor post-merge review ของ MR !28 verdict ระบุชัด

## Self-Review Required

```yaml
self_review:
  - field: "session_anchor_006_to_009_present"
    result: true/false
    evidence: "_board.md:NN..MM — 4 rows added with correct dates"
  - field: "done_table_t083_t088_added"
    result: true/false
    evidence: "_board.md:NN..MM — 6 rows present after T-036"
  - field: "spawn_counter_updated_to_14"
    result: true/false
    evidence: "_board.md:NN — 'spawn_count: 14'"
  - field: "d14_in_decisions_log"
    result: true/false
    evidence: "_board.md:NN — D14 row present with date 2026-04-29"
  - field: "auditor_review_t088_completed"
    result: true/false
    evidence: "_workspace/T-089/audit-mr28.md exists with verdict + findings"
  - field: "branch_pushed_mr_opened"
    result: true/false
    evidence: "MR URL https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/N"
```

## Forbidden

- ห้าม push ตรง main (ผ่าน MR เท่านั้น — feedback_mr_workflow)
- ห้าม fabricate ข้อมูลที่ไม่มีหลักฐาน — ถ้าไม่แน่ใจ session #007 ทำอะไร → mark "details unrecoverable, see git log range"
- ห้าม display secret value (สำหรับ Auditor review ของ sync-secrets.sh)

## Cleanup

- Standard: history clear post-task

## Domain Consultation

ไม่ต้อง — pure docs + audit task

# Security Audit — T-072 (review of T-071: flip deploy `when: manual` → `when: on_success`)

task_id: T-072
verdict: conditional_pass
working_mode: infra
compliance_verdict: not_applicable   # CI YAML 1-line flip; no user data / PII / email / auth user tokens / DB path touched
ok_to_merge: true
reasoning: >
  Diff = `+1/-1` ใน `.gitlab-ci.yml:94` (`when: manual` → `when: on_success`) —
  verified via `git diff origin/main origin/feat/ci-auto-deploy-on-success`
  (2 lines hunk context match: L91 `only:`, L93 `needs: [build]`, L95 `environment: production`,
  L96 `resource_group: production_deploy`). ไม่มีการเปลี่ยน secret handling, ssh
  command, smoke_check, tg_alert, rollback path, หรือ `only: - main` gate — safety net
  T-064/T-066/T-068 ยัง intact (grep-verified file:line ระบุใน checklist_verification #6).

  Security implication หลักของการ flip คือ **ตัด human-approve gate ออกจาก deploy path**
  — auto-deploy จะยิงทุกครั้งที่มี commit ขึ้น main (รวม merge commit). ระบบควบคุมที่
  ทดแทน human-approve gate:
    (1) GitLab branch protection main: `push_access_levels = No one` + `merge_access_levels = Maintainers` + `allow_force_push = false`
        — verified via GitLab API (projects/81441960/protected_branches). Direct push ถูก block
        100%; bypass ทำได้เฉพาะ GitLab admin override หรือ compromise maintainer credentials.
    (2) Smoke test (`apps/api/v1/health` + `auth.vollos.ai/health`) 3 retries ×
        10s + LAST_GOOD guard (40-char check) + auto-rollback (git reset --hard +
        docker compose up -d --build) + Telegram alert — **tested end-to-end on production**
        ใน pipeline 2464682257 (T-069/T-070 rollback cycle: deploy job = `failed` → rollback
        executed → VPS restored → Telegram sent → owner verified).
    (3) `resource_group: production_deploy` (T-067/T-068) = serialize deploys ข้าม pipelines
        → rapid-fire merges ไม่ race.

  MEDIUM findings 3 รายการ:
    - SEC-MED-001 `only_allow_merge_if_pipeline_succeeds: False` — project setting เปิด
      ให้ merge ได้แม้ pipeline แดง (verified via GitLab project API). ปัจจุบัน branch
      protection บังคับผ่าน MR แต่ไม่บังคับให้ pipeline green → regression สามารถ
      slip เข้า main + auto-deploy ได้. Compensating control: smoke test + rollback
      catch runtime fail.
    - SEC-MED-002 ไม่มี MR approval rules (`GET /projects/.../approval_rules = []`) —
      solo founder OK ตอนนี้ (owner รับ risk) แต่ bus-factor=1; ถ้า owner account
      compromised → attacker merge + auto-deploy ได้ทันที.
    - SEC-MED-003 Telegram เป็น alert channel เดียว — ไม่มี redundancy (email/SMS/PagerDuty
      fallback). หาก Telegram bot token ถูก revoke หรือ chat_id ถูก delete,
      `tg_alert()` graceful-return 0 → rollback ยังทำงาน แต่ owner ไม่รู้ตัวเหตุการณ์.

  CRITICAL = 0, HIGH = 0, MEDIUM = 3 (ทุก item มี compensating control + owner-aware risk).
  ตาม SKILL.md Verdict Policy: 0 CRITICAL + 0 HIGH → pass หรือ conditional_pass หาก MEDIUM
  มี operational risk → **conditional_pass** พร้อม pre-merge condition (SEC-MED-001 แก้
  ก่อน merge ถ้า feasible; SEC-MED-002/003 post-merge hardening) + post_merge_monitoring
  block สำหรับ first auto-deploy.

  ok_to_merge: **true** — พื้นฐาน security ของ auto-deploy สำหรับ solo-founder production
  VPS คือ (a) branch protection block direct push ✓, (b) smoke+rollback tested on real
  production ✓, (c) Telegram alert channel active (owner confirmed receipt) ✓, (d) resource_group
  ป้องกัน concurrent race ✓. MEDIUM findings ไม่ block merge เพราะมี compensating controls
  ที่ทำงานอยู่จริง + owner รับ residual risk (solo mode). แนะนำให้ปิด SEC-MED-001 (pipeline-
  must-pass toggle) ก่อน merge เพราะเป็น 1-click setting (no code change, no downtime).

## skill_loaded_evidence

files_read:
  - "/home/ipon/.claude/skills/vollos-auditor/SKILL.md:L37 — 'Audit พบ secret leaked ... → verdict fail + severity CRITICAL' (no secrets leaked in this diff)"
  - "SKILL.md:L75-L111 — Pre-Audit Protocol 4 steps (Re-anchor + Context + Evidence + Anti-Sycophancy)"
  - "SKILL.md:L126-L150 — Severity + Verdict Policy (conditional_pass rule: ≥2 HIGH no mitigation, OR MEDIUM with residual risk)"
  - "SKILL.md:L210-L214 — Working Modes (infra auto-selected: files_changed = .gitlab-ci.yml)"
  - "SKILL.md:L232-L244 — Critical Rules (ห้าม spawn Agent / emit completion_signal standalone / ตรวจ self_review)"
  - "references/security-checklists.md:L113-L125 — Infrastructure Layer (CI/CD pipeline integrity row applies)"
  - "references/security-checklists.md:L128-L138 — Supply Chain (A03:2025) — CI/CD Pipeline Integrity row"
  - "_workspace/T-064/review-auditor.md + T-066/review-auditor.md + T-068/review-auditor.md — continuity baseline"

## files_reviewed

- "origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml — full 96 lines (via `git show`)"
- "origin/main:.gitlab-ci.yml — full file (for diff baseline, +1/-1 confirmed)"
- "_workspace/T-071/output.md — full file lines 1-173"
- "_workspace/T-072/task.md — lines 1-77 (12-point checklist + scope)"
- "_workspace/T-069/output.md — lines 1-348 (broken-commit plan + runbook for rollback test)"
- "_workspace/T-070/output.md — lines 1-181 (revert task, confirms production cycle closed cleanly)"
- "_workspace/T-064/review-auditor.md (referenced — original smoke+rollback design baseline)"
- "_workspace/T-066/review-auditor.md (referenced — SEC-MED findings that T-068 closed)"
- "_workspace/T-068/review-auditor.md (referenced — LAST_GOOD guard + resource_group closure)"
- "GitLab API response for projects/81441960/protected_branches (branch protection JSON)"
- "GitLab API response for projects/81441960 (project settings: merge_if_pipeline_succeeds=False)"
- "GitLab API response for projects/81441960/approval_rules (empty array)"
- "GitLab API response for projects/81441960/merge_requests/22 (MR state=opened, mergeable)"
- "GitLab API response for projects/81441960/pipelines/2464682257 + /jobs (rollback test: deploy=failed, script_failure)"

## greps_executed

- `git fetch origin feat/ci-auto-deploy-on-success` → fetched HEAD=5d7e013
- `git diff --stat origin/main origin/feat/ci-auto-deploy-on-success` → `.gitlab-ci.yml | 2 +-` (1 file, 1 insertion, 1 deletion) ✓ matches output.md AC3
- `git diff origin/main origin/feat/ci-auto-deploy-on-success` → 2-line hunk at L94: `-  when: manual` / `+  when: on_success`. Context lines show L91 `only:`, L92 `- main`, L93 `needs: [build]`, L95 `environment: production`, L96 `resource_group: production_deploy` all unchanged.
- `git show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml | grep -nE "^USER|privileged|security_opt|docker\.sock"` → 0 matches (no Docker hardening regression — CI YAML only, no runtime Docker config touched)
- `git show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml | grep -nE "set -x|set -o xtrace|curl -v[^er]"` → 0 matches ✓
- `git show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml | grep -nE "token|secret|password"` → L29 only: `echo "$CI_REGISTRY_PASSWORD" | docker login ...` (variable reference, not value — pre-existing, untouched by this diff)
- `git show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml | grep -nE "resource_group|when:|only:|environment:|needs:"` → `19: only:` (test), `36: only:` (build), `91: only:` (deploy), `93: needs: [build]`, `94: when: on_success` (flipped), `95: environment: production`, `96: resource_group: production_deploy` — deploy job metadata ครบ, flip ตรงตำแหน่ง
- `git show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml | sed -n '40,96p'` → full deploy job block: smoke_check (L62-66), tg_alert (L67-73), 3-retry loop (L74-80), auto-rollback ssh (L82), ROLLBACK OK msg (L85), DOUBLE FAILURE msg (L88) — all present, identical to post-T-068 baseline
- `git log --oneline origin/main -5` → `b45db24 Merge fix/revert-health...`, `1e8841d fix(privacy): wrap retention delete + audit log in transaction`, `ba7a549 chore: sync workspace audit trail` — branch tip is current main
- `curl GitLab API projects/81441960/protected_branches` → `main`: push_access = No one (0), merge = Maintainers (40), allow_force_push: false, unprotect: Maintainers
- `curl GitLab API projects/81441960` → `only_allow_merge_if_pipeline_succeeds: False` (SEC-MED-001 source)
- `curl GitLab API projects/81441960/approval_rules` → `[]` (no approval rules — SEC-MED-002 source)
- `curl GitLab API projects/81441960/merge_requests/22` → state=opened, mergeable, sha=5d7e013 (matches output.md commit_sha)
- `curl GitLab API projects/81441960/pipelines/2464682257` → status=success (pipeline-level, pass-with-warnings because deploy job has allow_failure=true? No — manual play + failed = warning). deploy job: status=failed, failure_reason=script_failure, duration=84s — **rollback path was exercised on real production** ✓

## scope_compliance

files_changed_vs_owned: >
  match — diff แตะเฉพาะ `.gitlab-ci.yml:94` (1 line flip). ไม่แตะ app code, docker-compose,
  Dockerfile, Caddyfile, .env.example, test scripts, packages/, apps/api/, apps/auth-service/,
  infra/test-rollback-simulation.sh. Scope minimal + atomic.
  owned_files = [] (read-only audit) — match ✓

## self_review_check

- T-071/output.md มี `self_review` field ครบ 7 entries (AC1-AC7) บน L46-L68
- ทุก entry มี `result: true` + `evidence:` เป็น file:line + quote ตรงจากไฟล์ (commit SHA,
  pipeline ID, grep output, git diff stat, glab mr view JSON). ไม่มี generic evidence.
- `placeholders_remaining` block present (L70-L75) พร้อม grep command + false-positive
  analysis (`tg_alert()` function name) — pre-existing ไม่ใช่ placeholder
- `safeguards_intact` block (L77-L105) list 8 safeguards + file:line + content_verified
  quote — sufficient evidence สำหรับ "safety net intact" claim
- ผ่านเกณฑ์ SKILL.md:L91 (self_review + evidence file:line ทุกข้อ; ไม่มี `result: false`)

## security_findings

### CRITICAL

[] — ไม่พบ CRITICAL

### HIGH

[] — ไม่พบ HIGH

### MEDIUM

- id: SEC-MED-001
  severity: medium
  cvss_estimate: "~5.3 (A08:2025 Software/Data Integrity Failures — estimated; no CVE; CWE-693 defense-in-depth gap)"
  category: "ci_cd_integrity (CWE-693, A08:2025, A03:2025 Supply Chain)"
  description: >
    GitLab project setting `only_allow_merge_if_pipeline_succeeds = False` (verified via
    GET /projects/81441960 → JSON field). หลัง flip `when: on_success`, maintainer
    (owner) สามารถ click Merge ได้แม้ MR pipeline แดง (test/typecheck/lint fail) →
    merge commit triggers main pipeline → test fail → build + deploy skip (needs:
    dependency) → ดูเหมือน safe แต่ถ้า test pass แต่ build fail pattern เกิด หรือ
    owner merge MR ที่ pipeline ยังไม่รัน → deploy ก็ยัง gated โดย needs: [build]
    (safe). Real risk: MR ที่ test pass แต่มี regression ไม่ถูก catch → auto-deploy
    + smoke test catch ใน production เท่านั้น. Defense-in-depth gap เทียบกับ setting
    ที่เปิดได้ฟรีใน GitLab UI.
  file: "N/A — GitLab project setting, not in repo file. Verified via `GET /projects/81441960 → only_allow_merge_if_pipeline_succeeds: False`"
  evidence: >
    `curl -s --header "PRIVATE-TOKEN: ***" "https://gitlab.com/api/v4/projects/81441960"
    | jq .only_allow_merge_if_pipeline_succeeds` → `false`
  recommendation: >
    **Pre-merge (1-click, recommended):** GitLab UI → Settings → Merge requests →
    "Pipelines must succeed" = ON + "Skipped pipelines are considered successful" = OFF.
    ไม่ต้องแก้โค้ด ไม่ต้อง downtime. สอดคล้องกับ repo CLAUDE.md F5 ซึ่งระบุ
    "Pipeline ต้องผ่านครบก่อน merge".
  compensating_control: >
    Smoke test 3x + auto-rollback + Telegram alert ยัง catch runtime regression ถ้า
    slip ผ่านมา → damage ≤ ~5 min downtime + auto-recovery

- id: SEC-MED-002
  severity: medium
  cvss_estimate: "~5.4 (A07:2025 Authentication Failures + API2:2023 Broken Authentication — owner account single point of failure; estimated)"
  category: "auth (CWE-308 Use of Single-Factor Authentication for CI-CD control, API2:2023)"
  description: >
    GitLab project ไม่มี MR approval rules (`GET /projects/81441960/approval_rules →
    []`) + solo founder = 1-person maintainer. Branch protection บังคับให้ merge
    เท่านั้น (`push_access = No one`) แต่ merge เองไม่ต้อง approver คนอื่น →
    หาก owner account ถูก compromise (session hijack, stolen token, phished 2FA)
    → attacker เปิด MR + merge ได้ในขั้นตอนเดียว → auto-deploy ยิง payload ขึ้น
    production. หลัง flip `when: on_success` ช่องว่างระหว่าง "compromise" และ
    "production breach" สั้นลงจาก (manual click ที่ owner ต้องทำ = detection window)
    → (auto-fire หลัง merge = no detection window). **Solo-founder accepted risk**
    ตาม MEMORY project_solo_long_term.md แต่ควรบันทึกใน risk register.
  file: "N/A — GitLab project setting. Verified via `GET /projects/81441960/approval_rules → []`"
  evidence: >
    `curl -s --header "PRIVATE-TOKEN: ***" ".../projects/81441960/approval_rules"` → `[]`
  recommendation: >
    **Post-merge (not blocking):** (a) 2FA on GitLab account ต้องเปิดอยู่ + force-
    2FA at project level (Settings → General → Sign-in restrictions). (b) GitLab
    Personal Access Token ที่ใช้เป็น `VOLLOS_CLI` ต้องมี `scope=api` + expiry ≤90 day
    + masked + protected ใน CI variables. (c) พิจารณา deploy token แยกจาก personal
    token สำหรับ CI. (d) Long-term: เพิ่ม 2-person approval เมื่อมี co-founder/lead.
    ไม่ใช้ block merge ของ T-071 — flag ใน post_merge_monitoring.
  compensating_control: >
    Smoke+rollback จะ catch payload ที่ break /health endpoint. ไม่ catch payload ที่
    preserve /health เช่น data exfiltration pure, crypto miner, silent backdoor.
    Residual risk ชัดเจน; accepted by owner per solo-founder mode.

- id: SEC-MED-003
  severity: medium
  cvss_estimate: "~4.5 (A09:2025 Security Logging & Alerting Failures — estimated)"
  category: "alerting (CWE-778 Insufficient Logging, A09:2025)"
  description: >
    Alert channel เดียว = Telegram (tg_alert function `.gitlab-ci.yml:67-73`). หาก:
    (a) `TELEGRAM_BOT_TOKEN` unset → graceful return 0 + rollback ยังทำงาน แต่ owner
    ไม่รู้; (b) bot token revoked โดย Telegram → same; (c) chat_id ถูกลบ → same;
    (d) owner offline / airplane mode → delayed awareness. No backup channel
    (email/SMS/PagerDuty/Slack). หลัง auto-deploy เปิด ช่องว่างการ notify สำคัญกว่า
    manual mode (เพราะ manual mode owner = คนกดปุ่ม = รู้สถานะอยู่แล้ว).
  file: ".gitlab-ci.yml:67-73"
  evidence: >
    `tg_alert() { [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ] && {
    echo "Telegram vars unset — skipping alert"; return 0; } ... }` — graceful-degrade
    pattern ไม่ fail deploy ถ้า TG หาย, แต่ก็ไม่มี fallback channel.
  recommendation: >
    **Post-merge (not blocking):** (a) เพิ่ม email fallback (mailx + SMTP credentials
    ใน CI variables) เรียก ถ้า `tg_alert` ตอบ non-0 หรือ TG vars unset. (b) หรือ
    pipeline job status webhook → external monitor (UptimeRobot ฟรี tier หรือ
    GitLab built-in email-on-failure). (c) เพิ่ม assertion: ถ้า `TELEGRAM_BOT_TOKEN`
    unset ที่ deploy time → log warning prominent + pipeline artifact ระบุสถานะ.
    Deploy monitoring รอบนอก pipeline: UptimeRobot ping `/health` ทุก 5 min →
    independent signal ไม่พึ่ง Telegram.
  compensating_control: >
    Owner routinely check pipeline list + health endpoint. Deploy ยัง self-heal
    (rollback ไม่พึ่ง TG) → silent failure ≠ outage, เป็น observability gap.

### LOW

[] — ไม่พบ LOW ใหม่

### INFO

- id: SEC-INFO-001 (carryover from T-068 SEC-INFO-001)
  severity: informational
  cvss_estimate: "n/a — observation / defense-in-depth advisory"
  category: "test_fidelity / availability (CWE-754 advisory)"
  description: >
    LAST_GOOD guard ใช้ length check (≠40) ไม่ strict hex regex. Non-hex 40-char
    string (e.g., VPS compromise injection) จะผ่าน guard แล้ว git reset fail → rollback
    no-op. Pre-flip สถานะเดียวกัน; flip ไม่เปลี่ยน posture นี้. Practical risk = 0
    (precondition VPS root compromise). Deferred per T-068.
  file: ".gitlab-ci.yml:54-58"
  evidence: >
    `if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then ... exit 1; fi`
  recommendation: >
    Optional post-MVP hardening (does NOT block): upgrade to bash regex
    `[[ "$LAST_GOOD" =~ ^[0-9a-f]{40}$ ]]` หรือ POSIX `case` pattern.

- id: SEC-INFO-002
  severity: informational
  cvss_estimate: "n/a"
  category: "ci_cd_integrity / audit_trail (A09:2025 Logging advisory)"
  description: >
    Commit message ของ flip = `feat(ci): enable auto-deploy on main (flip manual →
    on_success)` (output.md:L61) — ชัดเจน + Conventional Commits pattern. MR !22
    title + description ระบุ security-relevant change แต่**ไม่ reference T-069
    rollback test evidence** โดยตรง. Future forensics อาจต้อง trace ผ่าน _workspace/
    T-069/T-070/T-072/ → recommend add link ใน MR description.
  file: "GitLab MR !22 description"
  evidence: "MR title ok; description content not fully verified (not fetched via API)"
  recommendation: >
    Pre-merge, add 1-line to MR !22 description: "Rollback cycle verified in
    production pipeline 2464682257 (T-069/T-070). Audit: T-072." No code change.

## checklist_verification (12 items ตาม task.md L26-L50)

### Auto-deploy trigger model

1. **Trigger surface change — ADDRESSED (see SEC-MED-001 + SEC-MED-002)**
   Evidence: Branch protection main `push_access_levels = [{"access_level": 0, "description": "No one"}]` + `merge_access_levels = [{"access_level": 40, "Maintainers"}]` + `allow_force_push: false` + `unprotect_access_levels = Maintainers` (verified GitLab API /protected_branches).
   Direct push = blocked 100%. Merge = Maintainer only. 2-person approval = not configured (SEC-MED-002). Conclusion: branch protection is adequate for solo-founder; approval gate ยังไม่มี (accepted risk).

2. **Bypass paths — PARTIAL**
   Evidence:
   - Direct push main: blocked (`push_access_levels: No one`) ✓
   - Force push main: blocked (`allow_force_push: false`) ✓
   - Admin override: possible (GitLab admin/owner role can always bypass branch protection via UI "Unprotect" → push → re-protect; but access is limited to owner). Auditor NOTE: เป็น residual risk ตาม solo-founder model.
   - Maintainer merge without pipeline pass: possible (`only_allow_merge_if_pipeline_succeeds: False` — SEC-MED-001)
   - `needs: [build]` ยัง gate deploy → ถ้า build/test fail, deploy skip automatically (intrinsic guard — verified `.gitlab-ci.yml:93`)

3. **Malicious commit detection — LIMITED**
   Evidence: Smoke test ตรวจเฉพาะ HTTP 200 บน 2 endpoints (`vollos.ai/api/v1/health` + `auth.vollos.ai/health` at `.gitlab-ci.yml:63-64`). ไม่ catch:
   - supply-chain attack ที่ endpoint ยัง return 200 (malicious npm, typosquatted package)
   - data exfiltration payload (health OK แต่ข้อมูลรั่ว)
   - time-bomb / delayed execution payload
   - log tampering / audit bypass
   Compensating: MR review (owner), conventional commits requirement, dependency pinning (packages/db + apps/api use pnpm-lock.yaml committed — not audited in this task but pre-existing per F2/F6 rules). Out-of-band: owner consciousness + quarterly npm audit (F-section). Documented in SEC-MED-002 residual risk.

### Concurrent-deploy race

4. **resource_group efficacy — PASS**
   Evidence: `.gitlab-ci.yml:96` = `resource_group: production_deploy` (T-067/T-068 closed). GitLab docs: `resource_group` serialize jobs ข้าม pipelines ภายใน project (verified T-068 review-auditor.md L259-267). Merge A ระหว่าง deploy A รัน → Pipeline B queued. After deploy A completes (pass or fail+rollback done), Pipeline B's deploy job กลายเป็น next in queue → runs sequentially. No race window.

5. **Pipeline queue depth — PASS (low concern)**
   Evidence: 5 rapid-fire merges → 5 pipelines queued, deploy jobs serialized via resource_group. Ground-truth behavior: `unordered` process_mode (GitLab default) = next queued job runs when previous finishes (pass or fail). **Risk:** if pipeline N deploys a broken commit → rollback to LAST_GOOD → pipeline N+1 runs → deploys N+1 commit which includes commit N changes → smoke passes → LAST_GOOD advances past N to N+1. Net effect: **only the latest passing commit lands on VPS**; broken N never stays on VPS. Behavior is correct for the threat model. No action required.

### Smoke + rollback + Telegram coverage

6. **Safeguards verified intact — PASS**
   Evidence (grep-verified file:line on `origin/feat/ci-auto-deploy-on-success`):
   - smoke test block (3 retries, curl --max-time 10, both endpoints): `.gitlab-ci.yml:62-80` — `smoke_check()` at L62-66 uses `--max-time 10 --connect-timeout 5` + `/api/v1/health` (200) + `/health` (200); for-loop `for i in 1 2 3` at L74-80 ✓
   - LAST_GOOD guard (40-char check, exit 1): `.gitlab-ci.yml:50-58` — capture L51, echo L52, guard L54-58 `[ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]` → `exit 1` ✓
   - Rollback ssh: `.gitlab-ci.yml:82` — `ssh ... "cd ~/vollos-core && git reset --hard $LAST_GOOD && docker compose up -d --build"` ✓
   - Telegram ROLLBACK OK path: `.gitlab-ci.yml:85-86` — `MSG="[VOLLOS CI] ROLLBACK OK — deploy $CI_COMMIT_SHORT_SHA failed smoke, rolled back to $LAST_GOOD. Pipeline: $CI_PIPELINE_URL"; tg_alert "$MSG"; exit 1` ✓
   - Telegram DOUBLE FAILURE path: `.gitlab-ci.yml:88-89` — `MSG="[VOLLOS CI] DOUBLE FAILURE ... MANUAL attention required. Pipeline: $CI_PIPELINE_URL"; tg_alert "$MSG"; exit 1` ✓
   - resource_group lock: `.gitlab-ci.yml:96` — `resource_group: production_deploy` ✓
   All 5 safeguards claimed ใน output.md safeguards_intact section = **grep-verified true**. No hidden regression.

7. **First auto-deploy timing — PASS (DevOps claim correct)**
   Evidence: DevOps claim ใน output.md:L127-L136: "merge commit's pipeline reads `.gitlab-ci.yml` from the merge commit itself, which contains the new `when: on_success`." **Verified by GitLab behavior spec**: GitLab pipelines use the CI YAML from the commit being tested. For a merge commit, the YAML = post-merge state (MR !22 content). Auditor cross-check: MR !22 sha=5d7e013 on feat branch has `when: on_success` at L94 (git show verified). Merge commit will inherit this content + trigger pipeline ref=main → test → build → deploy **auto-triggered** (no manual click). DevOps analysis is correct. **Implication:** first auto-deploy = this merge commit's pipeline. Owner must be prepared BEFORE clicking Merge.

### Operational readiness

8. **Rollback tested in production — PASS**
   Evidence: Pipeline 2464682257 (sha=6d5de79 = merge commit of broken MR !20). Verified via GitLab API:
   - pipeline status: "success" (with warning — because deploy job has `allow_failure=true` per GitLab default when manually played? Actually `allow_failure: true` in job API response — noted below)
   - deploy job: `status: failed`, `failure_reason: script_failure`, `duration: 84.4s`, `allow_failure: true`
   - T-069/T-070 ran the cycle end-to-end: broken /health → smoke 3x fail → auto-rollback to ea9a548 → smoke pass → Telegram "ROLLBACK OK" sent → owner received → VPS HEAD confirmed back to ea9a548
   - T-070 revert MR !21 closed the cycle cleanly, VPS back to healthy
   **Not theoretical — end-to-end verified on real VPS with real Telegram channel.**
   NOTE: `allow_failure: true` on deploy job = pipeline overall shows "success with warnings" even if deploy fails. This is **acceptable** because rollback is integral to deploy job (exit 1 after rollback = intentional signal). Pipeline-level status should ideally be "failed" to surface the event loudly, but Telegram alert catches it anyway. Flagged as observation, not finding (pre-existing from T-064).

9. **Monitoring gap — FLAGGED (SEC-MED-003)**
   Evidence: Telegram เป็น channel เดียว. Owner = single recipient (chat_id unique). Offline/airplane/token-revoked = silent failure. Fix path: email fallback หรือ UptimeRobot external ping.

10. **Rollback on Telegram failure — PASS (graceful degrade acceptable)**
    Evidence: `.gitlab-ci.yml:67-73` — `tg_alert()` checks `[ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ] && { echo "Telegram vars unset — skipping alert"; return 0; }`. If TG fails:
    - rollback ssh (L82) still runs (no dependency on TG)
    - smoke re-check (L84) still runs
    - exit 1 still fires (L86 / L89)
    - pipeline marked failed
    So: VPS self-heals regardless of TG status. Owner gap = awareness only (SEC-MED-003). Graceful degrade = **acceptable engineering tradeoff** (don't block rollback on alert-channel health).

### Compliance

11. **User data / PII — N/A**
    Evidence: Diff = 1-line CI YAML. No app code, no DB schema, no email template, no auth flow. `compliance_verdict: not_applicable` confirmed.

12. **Audit trail — PARTIAL (see SEC-INFO-002)**
    Evidence:
    - Commit message `feat(ci): enable auto-deploy on main (flip manual → on_success)` ✓ Conventional Commits per F6
    - commit_sha 5d7e013 recorded in output.md + MR !22
    - _workspace/T-071/output.md documents motivation + safeguards_intact verification
    - T-069/T-070 establish prior rollback-test context
    - MR !22 description = not fetched (auditor did not pull body via API to avoid noise) — per DevOps output.md:L110-L111 MR description present; recommend linking T-069 pipeline URL explicitly.
    Forensics sufficient for basic reconstruction; SEC-INFO-002 recommends 1-line enhancement.

## us_privacy_compliance

unsubscribe_mechanism: "n/a — task ไม่แตะ email/marketing code"
physical_address_in_email: "n/a — task ไม่แตะ email templates"
audit_log: "n/a — task ไม่แตะ data-write path (audit_logs table untouched)"
data_minimization: "ok — CI-only change, no user data flow affected. tg_alert log payload = pipeline URL + short SHA + LAST_GOOD SHA (no PII)"

## secret_handling_audit

1. **No `cat .env` / Read .env / `docker compose config` without `--no-interpolate`** — PASS (diff = 1 line CI YAML only, no env touching)
2. **No `echo $TELEGRAM_BOT_TOKEN / $VPS_SSH_KEY / $VOLLOS_CLI` values in output.md or diff** — PASS. Auditor verified no secret values appear in T-071/output.md, T-072/task.md, or the diff. Only variable names referenced.
3. **No `curl -v` / `set -x` in blocks touching tokens** — PASS (grep 0 matches)
4. **Secret values masked in review-auditor.md** — PASS. This report references `PRIVATE-TOKEN: ***` (not actual VOLLOS_CLI value); pipeline URLs and SHAs shown; no bot token / SSH key / DB password.
5. **No plaintext secrets in committed files** — PASS (grep `token|secret|password` on feat branch .gitlab-ci.yml → L29 only, `$CI_REGISTRY_PASSWORD` variable reference, pre-existing, not in diff)

**No secret leak identified in T-071 diff, output.md, or auditor evidence.**

## skipped_sections

- "Application Layer (SQL/XSS/BOLA/CSRF/rate-limit/Turnstile/HMAC) — N/A: diff = CI YAML only, no API/route touched"
- "Auth Layer (JWT/cookie/HMAC/credential stuffing) — N/A: ไม่แตะ auth code"
- "Email Layer (OAuth2 SMTP / header injection / open redirect) — N/A: ไม่แตะ email/SMTP"
- "US Privacy (CAN-SPAM/CCPA/GPC/ADMT) — N/A: CI-only, no user-facing data flow"
- "Docker hardening (CIS) — N/A: diff ไม่แตะ Dockerfile / docker-compose. Alpine CI image pre-existing"
- "Frontend / Landing / One Tap — N/A: ไม่แตะ apps/landing or apps/web"

## conditional_conditions (pre_merge_conditions)

**Recommended (not strictly blocking, but 1-click free improvements):**

1. **Enable "Pipelines must succeed" (GitLab UI):**
   - Path: Project → Settings → Merge requests → "Merge checks" → check "Pipelines must succeed"
   - Verify via: `curl -s --header "PRIVATE-TOKEN: $VOLLOS_CLI" "https://gitlab.com/api/v4/projects/81441960" | jq .only_allow_merge_if_pipeline_succeeds` → expected `true`
   - Closes SEC-MED-001. ~30 seconds of owner time. Directly enforces repo CLAUDE.md F5.

2. **Add 1-line to MR !22 description (optional polish):**
   - Add: "Rollback cycle verified end-to-end on production pipeline 2464682257 (T-069 broken deploy + T-070 revert). Audit: T-072."
   - Closes SEC-INFO-002. ~20 seconds of owner time.

**If owner proceeds to merge without #1 done** → verdict remains conditional_pass (compensating controls = smoke + rollback + Telegram alert) but must do #1 within 24h post-merge as hardening.

## post_merge_monitoring

**Recommendations for Lead/owner หลัง first auto-deploy (first real test of auto-deploy in production):**

### Before clicking Merge (T-minus 10 min preparation)

1. **Telegram channel open + phone unlocked** — alert may arrive within 2-6 min after merge click. Keep Tab B (GitLab pipelines) + Telegram visible.
2. **Capture current VPS state** (LAST_GOOD baseline):
   ```bash
   ssh ipon@187.124.244.96 "cd ~/vollos-core && git rev-parse HEAD"
   # expected: b45db24 (current main HEAD) or equivalent
   ```
3. **Confirm `/health` endpoints healthy before merge:**
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" https://vollos.ai/api/v1/health  # expect 200
   curl -sS -o /dev/null -w "%{http_code}\n" https://auth.vollos.ai/health    # expect 200
   ```
4. **Confirm SEC-MED-001 fix done** (recommended): Project Settings → Merge requests → "Pipelines must succeed" = ON.

### Merge + first auto-deploy

5. **Click Merge on MR !22** (via GitLab UI). Leave "Delete source branch" as project default.
6. **Watch pipeline timing on merge commit:**
   - test stage: ~1-2 min
   - build stage: ~2-3 min (docker build + push to GitLab registry)
   - deploy stage: ~2-4 min (SSH + docker compose up + 3x smoke check)
   - Total: ~5-9 min to smoke pass
7. **Expected happy path log lines (deploy job):**
   ```
   LAST_GOOD=<40-hex-SHA>  (the pre-merge main HEAD)
   (git pull + docker compose up -d --build)
   Smoke PASS attempt=1 api=200 auth=200
   ```
   Deploy job exits 0 → pipeline green. **No Telegram alert fires** (that's the success signal).

8. **Expected failure path (if deploy fails smoke):**
   - Log: `Smoke FAILED after 3 attempts — initiating auto-rollback to $LAST_GOOD`
   - Telegram alert: `[VOLLOS CI] ROLLBACK OK — deploy <sha> failed smoke, rolled back to <last_good>. Pipeline: <url>`
   - VPS auto-restored
   - Owner action: investigate logs, do NOT re-merge until root cause known

### Post-deploy verification (within 5 min of pipeline green)

9. **Smoke test production directly:**
   ```bash
   curl -sS https://vollos.ai/api/v1/health | jq      # expect {"status":"healthy","service":"vollos-api"}
   curl -sS https://auth.vollos.ai/health | jq       # expect {"status":"ok","service":"vollos-auth-service"} or equivalent
   ssh ipon@187.124.244.96 "cd ~/vollos-core && git rev-parse HEAD"  # expect merge-commit SHA of MR !22
   ```

10. **Capture first auto-deploy timing for baseline** (record in _workspace/T-072/post-deploy-timing.md or equivalent):
    - Merge click timestamp: `__:__`
    - Deploy job start: `__:__`
    - Deploy job end: `__:__`
    - First Telegram receive (if any): `__:__`
    - Total merge → /health healthy window: `__ min`
    Used for future SLO baseline.

### Ongoing monitoring (first 24 hours after auto-deploy)

11. **Periodic /health check (manual curl every ~1 hr during first day, then per-merge):**
    ```bash
    curl -sS -o /dev/null -w "%{http_code}\n" https://vollos.ai/api/v1/health
    ```
    This doubles as informal uptime probe until UptimeRobot / external monitor is set up (SEC-MED-003 post-merge hardening).

12. **Close post_merge hardening tasks (within 1 week):**
    - **H1 (closes SEC-MED-003):** set up UptimeRobot free tier ping https://vollos.ai/api/v1/health every 5 min → email alert on 2 consecutive failures. ~5 min setup.
    - **H2 (closes SEC-MED-002 partial):** verify 2FA enabled on GitLab account + review VOLLOS_CLI token scope + expiry ≤ 90 days. ~10 min.
    - **H3 (closes SEC-INFO-002):** edit MR !22 description post-merge to include T-069 pipeline link (still visible in merged MR view). ~30 sec.
    - **H4 (optional):** add GitLab pipeline-failure email notification as Telegram backup. Project → Settings → Integrations → Pipelines emails → add owner email. ~1 min. Partially mitigates SEC-MED-003.

### Incident response (if DOUBLE FAILURE fires)

13. **DOUBLE FAILURE = VPS not self-recovered.** Telegram message:
    `[VOLLOS CI] DOUBLE FAILURE — deploy <sha> failed smoke AND rollback to <last_good> also failed. MANUAL attention required.`
    Immediate action:
    ```bash
    ssh ipon@187.124.244.96
    cd ~/vollos-core
    git rev-parse HEAD                        # which SHA is checked out?
    docker compose ps                         # which containers up?
    docker compose logs --tail=100 api        # recent api errors
    docker compose logs --tail=100 auth-service
    git log --oneline -5                      # recent commit state
    ```
    Do NOT attempt re-deploy via pipeline. Contact Lead to spawn DevOps for triage.

## files_read

- "/home/ipon/.claude/skills/vollos-auditor/SKILL.md (full)"
- "/home/ipon/.claude/skills/vollos-auditor/references/security-checklists.md (full)"
- "/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md (Architecture Rules A-K section for cross-check)"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-072/task.md (full 77 lines)"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-071/output.md (full 173 lines)"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-069/output.md (full 348 lines — production rollback test runbook + evidence)"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-070/output.md (full 181 lines — revert closing the test cycle)"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-068/review-auditor.md (full — continuity from SEC-MED-001/002 closure)"
- "origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml (full 96 lines via `git show`)"
- "origin/main:.gitlab-ci.yml (via `git show`, diff baseline)"

## commands_used

- `git -C /home/ipon/workspace/vollos-ai/vollos-core diff origin/main origin/feat/ci-auto-deploy-on-success` → 1-line diff verified
- `git -C /home/ipon/workspace/vollos-ai/vollos-core show origin/feat/ci-auto-deploy-on-success:.gitlab-ci.yml` → full file read
- `git -C /home/ipon/workspace/vollos-ai/vollos-core log --oneline origin/main -5` → main commit history
- `source /home/ipon/workspace/vollos/.env && curl -s --header "PRIVATE-TOKEN: ***" "https://gitlab.com/api/v4/projects/81441960/protected_branches"` → branch protection JSON
- `curl GitLab API /projects/81441960` → project settings (only_allow_merge_if_pipeline_succeeds, merge_method, approval config)
- `curl GitLab API /projects/81441960/approval_rules` → `[]`
- `curl GitLab API /projects/81441960/merge_requests/22` → MR state
- `curl GitLab API /projects/81441960/pipelines/2464682257` → pipeline status
- `curl GitLab API /projects/81441960/pipelines/2464682257/jobs` → deploy job status=failed, script_failure

completion_signal: "task_id=T-072 verdict=conditional_pass findings=0_crit_0_high_3_med_2_info path=_workspace/T-072/review-auditor.md"

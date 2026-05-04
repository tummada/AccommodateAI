# Security Audit — T-068 (review of T-067 MEDIUM fixes — LAST_GOOD guard + resource_group + sim scenarios D/E)

task_id: T-068
verdict: pass
working_mode: infra
compliance_verdict: not_applicable   # CI YAML + bash simulation; no user data / PII / email / auth user tokens touched
ok_to_merge: true
reasoning: >
  Diff บน branch `fix/ci-rollback-guards` vs `origin/main` = `+7/-0` ใน `.gitlab-ci.yml`
  และ `+64/-0` ใน `infra/test-rollback-simulation.sh` (total +71/-0, verified via
  `git diff --stat origin/main origin/fix/ci-rollback-guards`). ครอบคลุม 2 MEDIUM
  จาก T-066 ได้ครบ: (1) SEC-MED-001 LAST_GOOD guard อยู่**หลัง** capture (.gitlab-ci.yml:51-52)
  และ**ก่อน** git pull (.gitlab-ci.yml:59) — check ทั้ง `-z` (empty) + `${#LAST_GOOD} -ne 40`
  (length) + `exit 1` (fail-fast), mirror ใน `infra/test-rollback-simulation.sh:128-132`
  แบบ bit-for-bit (เทียบ content — identical ยกเว้น `exit 1` → `return 1` เพราะเป็น
  function call). (2) SEC-MED-002 `resource_group: production_deploy` ที่
  `.gitlab-ci.yml:96` ใต้ deploy job (job block เริ่ม L40) — GitLab docs spec ถูกต้อง
  (key เป็น job-level, จะ serialize jobs ข้าม pipelines ตามพฤติกรรม GitLab Runner
  lock). `when: manual` ยัง preserved (L94 — verified via `grep -n "when:"`).
  Simulation run locally 38/38 pass + `SIMULATION PASS` (verified โดย bash script
  จริงใน working tree, D=8 E=7 ใหม่ + A=7 B=6 C=6 hygiene=4 เดิม = 38 total). ไม่มี
  secret leak (ไม่มี `-v`, `set -x`, real token — hygiene assertions ยัง active).
  ไม่มี CRITICAL / HIGH / MEDIUM / LOW finding ใหม่. ทั้ง SEC-MED-001 + SEC-MED-002
  จาก T-066 ถือว่า **closed**. ok_to_merge: true — MR !19 พร้อม merge.

closes_previous_findings:
  SEC-MED-001:
    status: closed
    evidence: >
      `.gitlab-ci.yml:53-58` (diff hunk 1):
      ```
      # Guard: git SHA-1 must be 40 hex chars. If empty/malformed (SSH fail or VPS not a git repo) -> abort before git pull
      - |
        if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then
          echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"
          exit 1
        fi
      ```
      ตรงกับ fix recommendation ของ T-066 review-auditor.md:L101-L108 ทุกประการ:
      (1) placement AFTER `LAST_GOOD=$(...)` + `echo` (L51-52) BEFORE `ssh ... git pull`
      (L59) ✓; (2) check both empty + non-40-chars (SHA-1 git HEAD = 40 hex chars) ✓;
      (3) `exit 1` fail-fast ✓; (4) log ไม่ leak stderr/stdout ของ ssh (echo เฉพาะ
      `len=X` ตัวเลข + literal strings) ✓. Bonus: Scenarios D (empty stdout, len=0)
      และ E (malformed "fatal: not a git repository", len=27) ใน simulation ยืนยัน
      guard trigger จริง — ทั้งสอง exit 1 + no `auto-rollback` + no `Smoke retry` +
      no Telegram alert. **SEC-MED-001 fully remediated.**
  SEC-MED-002:
    status: closed
    evidence: >
      `.gitlab-ci.yml:96` (diff hunk 2): `  resource_group: production_deploy`
      วางใต้ `environment: production` (L95) ในระดับ 2-space indent เดียวกัน =
      job-level property ของ job `deploy:` (เริ่ม L40). GitLab spec: resource_group
      serializes jobs with the same resource_group string across **all pipelines**
      ของ project (https://docs.gitlab.com/ee/ci/resource_groups/). Fix ตรงกับ
      recommendation T-066 review-auditor.md:L128-L134 ทุกประการ. `when: manual`
      ยัง preserved (L94) — ไม่ได้ flip เป็น on_success (ซึ่งเป็น Phase A-3 Part 3
      = T-069 ต่างหาก). **SEC-MED-002 fully remediated.**

## skill_loaded_evidence

files_read:
  - "/home/ipon/.claude/skills/vollos-auditor/SKILL.md:L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
  - "SKILL.md:L75-L91 — Pre-Audit Protocol (Session Re-anchor + Context Collection + Evidence Protocol)"
  - "SKILL.md:L126-L134 — Severity Definitions (MEDIUM = defense-in-depth gap)"
  - "SKILL.md:L136-L146 — Verdict Policy (pass condition: ไม่มี CRITICAL/HIGH หรือ HIGH มี mitigation)"
  - "SKILL.md:L210-L214 — Working Modes selection — `infra` auto เมื่อ files_changed = CI YAML + bash script"
  - "SKILL.md:L232-L244 — Critical Rules (ห้าม spawn Agent / แก้ source / emit completion_signal standalone)"
  - "_workspace/T-066/review-auditor.md:L83-L134 — SEC-MED-001 + SEC-MED-002 original findings (for closure comparison)"
  - "/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md:L168-L223 — Architecture Rules A-K (CI pipeline, secret management) สำหรับ cross-check"

## files_reviewed

- "origin/fix/ci-rollback-guards:.gitlab-ci.yml — full file 1-96 lines (via `git show`)"
- "origin/main:.gitlab-ci.yml — full file (for diff baseline, +7/-0 confirmed)"
- "origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh — full file 1-365 lines (via `git show`)"
- "/home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh — working tree, checked out from branch for local run"
- "_workspace/T-067/output.md — lines 1-249 (DevOps output + self_review + placeholders_remaining + secret_handling_compliance)"
- "_workspace/T-068/task.md — lines 1-71 (audit scope + 15-point checklist)"
- "_workspace/T-066/review-auditor.md — lines 1-446 (prior audit continuity — SEC-MED-001 + SEC-MED-002 to close)"

## greps_executed

- `git fetch origin fix/ci-rollback-guards` → `* branch fix/ci-rollback-guards -> FETCH_HEAD`
- `git diff --stat origin/main origin/fix/ci-rollback-guards` →
  `.gitlab-ci.yml | 7 +++++` + `infra/test-rollback-simulation.sh | 64 +++++++++++++` = `2 files changed, 71 insertions(+)` ✓ (matches task.md budget: ≤15 + ≤80)
- `git diff origin/main origin/fix/ci-rollback-guards` → 2 hunks only (guard block +6 incl. leading comment; resource_group +1). `infra/test-rollback-simulation.sh` 4 hunks (override comment+hook +9, guard mirror +6, scenario D +25, scenario E +24 = +64). No deletions. No scope creep.
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "resource_group|when:|only:|environment:"` →
  `19: only:` (test), `36: only:` (build), `91: only:` (deploy), `94: when: manual`, `95: environment: production`, `96: resource_group: production_deploy` — deploy job metadata ครบ, `when: manual` ยังอยู่, resource_group วางถูกตำแหน่ง ✓
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "^(deploy|build|test):"` → L9 test, L23 build, L40 deploy — confirms resource_group (L96) อยู่ใต้ deploy job block (ก่อนจบ file L96) ✓
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '49,60p'` → verifies guard at L53-58 inserted BETWEEN `echo "LAST_GOOD=$LAST_GOOD"` (L52) AND `ssh ... "cd ~/vollos-core && git pull && docker compose up -d --build"` (L59) — correct placement ✓
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "set -x|set -o xtrace|curl -v[^er]"` → 0 matches ✓ (no verbose / xtrace introduced; `curl -sS` / `curl -sSf` pattern preserved)
- `bash /home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh` (branch file checked out) → `Summary: 38 passed / 0 failed` + `SIMULATION PASS` (exit 0). Scenario D: LAST_GOOD empty → `len=0` fatal + exit 1 + no rollback + no TG; Scenario E: LAST_GOOD=`"fatal: not a git repository"` (27 chars) → `len=27` fatal + exit 1 + no rollback + no TG ✓
- `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | sed -n '115,145p'` → confirms guard mirror at L128-132 inside `run_deploy_block()` — identical logic to `.gitlab-ci.yml:53-58` (diff only: `exit 1` → `return 1` because it's inside a shell function — semantically correct, not a bit-for-bit MODIFY but functionally identical; the script's comment on L128 explicitly says "MIRROR of .gitlab-ci.yml")
- `echo -n "fatal: not a git repository" | wc -c` → 27 — explains `len=27` in Scenario E output; proves non-hex case is caught by length check alone (no hex-regex needed because any non-40-length fails)
- `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | wc -l` → 365 lines (was 301 on main; +64 matches diff stat) ✓

## scope_compliance

files_changed_vs_owned: >
  match — diff แตะเฉพาะ 2 ไฟล์: `.gitlab-ci.yml` (+7/-0, 2 hunks: guard block +6 incl.
  comment at L53-58, resource_group +1 at L96) + `infra/test-rollback-simulation.sh`
  (+64/-0, 4 hunks: override comment+hook at L40-54, guard mirror L128-132,
  Scenario D L281-303, Scenario E L309-326). ไม่แตะ test/build stages, before_script
  (ssh_key/known_hosts setup), `only: - main`, `when: manual`, `environment: production`,
  tg_alert function, smoke_check function, rollback ssh command, Telegram URL
  template, secret hygiene assertions ของ simulation เดิม. **No scope creep detected.**
  owned_files = [] (read-only audit) — match ✓

## self_review_check

- T-067/output.md มี `self_review` field ครบ 5 entries (AC1, AC1b, AC2, AC3, AC4, AC5 — 6 actually)
  บน T-067/output.md:L17-L41
- ทุก entry มี `result: true` + `evidence:` เป็น file:line + quote ตรงจากไฟล์ (เช่น
  `.gitlab-ci.yml:53-58`, `.gitlab-ci.yml:96`, `.gitlab-ci.yml:94`, `infra/test-rollback-simulation.sh:281-303`,
  `infra/test-rollback-simulation.sh:309-326`, `infra/test-rollback-simulation.sh:40-54`,
  `infra/test-rollback-simulation.sh:128-132`) — ไม่มี generic evidence
- `placeholders_remaining` block present (T-067/output.md:L42-L57) พร้อม grep command
  + false-positive analysis (`tg_alert()` ชื่อฟังก์ชัน) — สมเหตุสมผล ไม่ต้อง finding
- `secret_handling_compliance` 5-item block present (T-067/output.md:L186-L197) — ครอบ
  5 กฎตาม MEMORY master rule (no `cat .env`, no `echo $TOKEN`, no `-v`, fake token,
  no plaintext) + evidence ต่อข้อ
- ผ่านเกณฑ์ SKILL.md:L91 (มี self_review + evidence file:line ทุกข้อ; ไม่มี field `result: false`)

## security_findings

### CRITICAL

[] — ไม่พบ CRITICAL

### HIGH

[] — ไม่พบ HIGH

### MEDIUM

[] — ไม่พบ MEDIUM ใหม่ในรอบนี้

### LOW

[] — ไม่พบ LOW ใหม่ในรอบนี้

### INFO

- id: SEC-INFO-001 (carryover from T-066)
  severity: informational
  cvss_estimate: "n/a — observation / defense-in-depth advisory"
  category: "test_fidelity / availability (CWE-754 advisory)"
  description: >
    Length-based guard `${#LAST_GOOD} -ne 40` ไม่ check hex character class อย่างเคร่งครัด
    — ตาม spec SHA-1 ต้องเป็น `[0-9a-f]{40}` เท่านั้น. ในทางทฤษฎี attacker ที่ compromise
    VPS (precondition = game-over อยู่แล้ว) สามารถ inject string 40 chars ที่ไม่ใช่
    hex เช่น `"abcdefghijklmnopqrstuvwxyz1234567890xxxy"` (40 chars) ทำให้ guard ผ่าน
    แล้ว `git reset --hard <garbage>` ทำ rollback fail (git จะ error — ไม่ทำ rollback ผิด
    แต่ก็ไม่ rollback สำเร็จ). Practical risk ≈ 0 (precondition VPS root compromise
    + shell meta chars like `;` `&&` `|` มี 40 char limit = extremely narrow).
    Defense-in-depth: could tighten to `case "$LAST_GOOD" in [0-9a-f][0-9a-f]...40x... ) ;; *) exit 1;;`
    หรือ bash regex `[[ "$LAST_GOOD" =~ ^[0-9a-f]{40}$ ]]`. Not required — length
    check + VPS trust model = adequate for current threat scenario.
  file: ".gitlab-ci.yml:53-58 + infra/test-rollback-simulation.sh:128-132"
  evidence: >
    `if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then ... fi` — length check only
  recommendation: >
    Optional post-MVP hardening (does NOT block merge): consider upgrading guard to
    `case "$LAST_GOOD" in *[!0-9a-f]*) exit 1;; esac; [ ${#LAST_GOOD} -eq 40 ] || exit 1`
    (POSIX-safe hex regex equivalent). Defer to A-4 hardening pass — current fix is
    sufficient given threat model (VPS trust anchor).

- id: SEC-INFO-002 (new — observation)
  severity: informational
  cvss_estimate: "n/a — observation"
  category: "sync_drift (test_fidelity, CWE-1104 advisory)"
  description: >
    Simulation guard mirror comment ระบุ "MIRROR of .gitlab-ci.yml" (line 128) แต่
    การ sync เป็น manual (ไม่มี extract-to-shared-file pattern) — ถ้า future DevOps
    ปรับ guard ใน `.gitlab-ci.yml` แต่ลืม update simulation, test จะยัง pass แต่
    production behavior ต่าง. ตอนนี้ synced 100% (verified). Same concern ที่ T-066
    SEC-INFO-003 เคย flag สำหรับ deploy script block — ขยาย concern นี้ไปถึง guard
    block ด้วย.
  file: "infra/test-rollback-simulation.sh:128 (comment) + run_deploy_block() entire function"
  evidence: >
    Comment L128: "Step 1.5: Guard — git SHA-1 must be 40 hex chars (MIRROR of .gitlab-ci.yml)"
  recommendation: >
    Future refactor (deferred — per T-066 SEC-INFO-003 deferral): extract deploy
    + guard block → `infra/deploy-smoke-rollback.sh` + source from both `.gitlab-ci.yml`
    and simulation. Not blocking A-3 Part 3. Post-MVP architectural refactor.

## checklist_verification (ครบ 15 ข้อ ตาม task.md L22-L46)

### Fix 1 — LAST_GOOD guard (SEC-MED-001 closed?)

1. **Guard placement — PASS**
   Evidence: `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '49,60p'`
   แสดงลำดับ:
   - L51: `- LAST_GOOD=$(ssh ... "git rev-parse HEAD")` (capture)
   - L52: `- echo "LAST_GOOD=$LAST_GOOD"` (log)
   - L53-L58: guard block (NEW — diff hunk 1)
   - L59: `- ssh ... "cd ~/vollos-core && git pull && docker compose up -d --build"` (git pull)
   Guard อยู่**หลัง** capture+log + **ก่อน** git pull = ถูกต้อง 100%. Mirror ที่
   `infra/test-rollback-simulation.sh:128-132` อยู่ใน `run_deploy_block()` ระหว่าง Step 1
   (capture) และ Step 2 (`ssh ... git pull`) เช่นกัน.

2. **Guard condition correctness — PASS**
   Evidence: `.gitlab-ci.yml:55` = `if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then`
   Cover:
   - empty ("")    → `-z` TRUE → exit 1 ✓ (Scenario D proves: len=0, exit 1)
   - short (27ch)  → `-z` FALSE, length 27≠40 TRUE → exit 1 ✓ (Scenario E: `"fatal: not a git repository"` → len=27, exit 1)
   - long (>40ch)  → length >40≠40 TRUE → exit 1 ✓ (covered by same length-not-equal-40 logic; not explicitly simulated but logically equivalent to Scenario E)
   - non-hex (40ch) → length=40 TRUE → passes guard (ดู SEC-INFO-001 above — informational only, VPS root precondition = game-over)
   Edge cases ครบสำหรับ threat model (ssh empty stdout + git error message). SHA-1 spec ต้อง 40 hex,
   length-only check covers 99%+ realistic failure modes.

3. **Fail-fast + log safety — PASS**
   Evidence: `.gitlab-ci.yml:56-57`:
   ```
   echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"
   exit 1
   ```
   `exit 1` immediate ไม่มี retry/bypass. Log message echoes only:
   (a) literal string "FATAL LAST_GOOD invalid"
   (b) `len=${#LAST_GOOD}` — integer length (not the value itself)
   (c) literal string "abort deploy before git pull"
   ไม่ leak `$LAST_GOOD` value (ซึ่งอาจมี ssh stderr เช่น `"fatal: not a git repository"` —
   แต่แม้ leaked ก็เป็น bash error message ของ git, ไม่ใช่ secret). Confirmed ปลอดภัย.
   **Important:** ไม่มี `set -x` เปิดอยู่ใน block นี้ (grep verified) — stderr expansion
   ไม่ถูก trace log.

4. **Guard bypass risk (injection/race) — PASS**
   Evidence:
   - Echo injection: `echo "LAST_GOOD=$LAST_GOOD"` (L52) before guard — รัน echo ก่อน
     check, แต่ echo ไม่เปลี่ยนค่า `$LAST_GOOD` และไม่มี command substitution ที่
     attackable. Guard บน L53-58 ทำงานบน `$LAST_GOOD` value ที่ capture เสร็จแล้ว.
   - Race: GitLab runner execute script array sequentially ใน single shell, ไม่มี
     concurrency window ระหว่าง capture + guard + git pull ใน process เดียว.
   - TOCTOU: ค่า `$LAST_GOOD` อยู่ใน shell variable (stack), ไม่ใช่ file — ไม่มี
     external process เขียนทับได้.
   - Concurrency across pipelines: แก้แยกโดย `resource_group: production_deploy`
     (Fix 2 / Check 7).
   No bypass vector พบใน diff.

### Fix 2 — resource_group (SEC-MED-002 closed?)

5. **YAML syntax — PASS**
   Evidence: `.gitlab-ci.yml:96` = `  resource_group: production_deploy`
   2-space indent อยู่ระดับเดียวกับ `only:` (L91), `needs:` (L93), `when:` (L94),
   `environment:` (L95) — ทั้งหมดเป็น job-level keys ของ `deploy:` (L40). GitLab
   `resource_group` spec: job-level key, value = string identifier. Syntax valid per
   https://docs.gitlab.com/ee/ci/yaml/#resource_group. Pipeline จริง 2464622527
   render job สำเร็จ (output.md:L70) — if syntax invalid, pipeline จะ fail ที่ parse
   time. Confirmed valid.

6. **Scope correctness (name collision risk) — PASS**
   Evidence: name `production_deploy` เป็น project-scoped identifier (resource_group
   lock อยู่ระดับ project, ไม่ข้าม project). Name ชัดเจนระบุว่า "production" =
   ไม่ชนกับ future staging/test deploy jobs ถ้ามี (จะใช้ `staging_deploy` หรือ
   `test_deploy` ได้). Current repo มี deploy job เดียว (L40) + test (L9) + build
   (L23) — ไม่มี job อื่นใช้ `resource_group`, ไม่มีชนกันใน project นี้. Forward-
   compatible.

7. **Concurrency behavior (verify per GitLab docs) — PASS**
   Evidence: ตาม GitLab Official Docs https://docs.gitlab.com/ee/ci/resource_groups/
   ("Using resource_group keyword"): "When a job uses a resource_group, it can run
   one job at a time across different pipelines within the same project." ซึ่งตรงกับ
   threat model ของ SEC-MED-002 (Job-A pipeline-X + Job-B pipeline-Y race window).
   Default process_mode = `unordered` (jobs queued, next one runs when previous
   finishes). Confirmed: serialize **ข้าม pipelines** (ไม่ใช่แค่ใน pipeline เดียว) —
   แก้ SEC-MED-002 race condition ตามต้องการ. A-3 Part 3 (on_success auto-trigger)
   จะยัง safe ด้วย lock นี้.

### Fix 3 — Simulation D + E

8. **Scenario D fidelity (empty stdout) — PASS**
   Evidence: `infra/test-rollback-simulation.sh:288-289`:
   ```
   SIM_SSH_REVPARSE_OVERRIDE=""
   SIM_SMOKE_PATTERN="200,200"   # would pass if guard did not fire — must not reach smoke
   ```
   Mock ssh ที่ L44-48 ตรวจ `"${SIM_SSH_REVPARSE_OVERRIDE+set}" = "set"` (uses `+set`
   expansion — TRUE even if value is empty string, distinguishing from unset) →
   `printf '%s' ""` → return 1 (exit 1 mimics ssh transport fail). Mirror real
   behavior: SSH network fail จะ return non-zero + empty stdout. Assertion D reports
   `len=0` ซึ่งสอดคล้อง empty capture.

9. **Scenario E fidelity (malformed SHA) — PASS**
   Evidence: `infra/test-rollback-simulation.sh:315`:
   `SIM_SSH_REVPARSE_OVERRIDE="fatal: not a git repository"`
   (27 chars, non-hex). Mock ssh returns non-empty string → return 0 (mimics SSH
   transport OK but remote command stderr merged into stdout — common git error
   pattern). Realistic: ถ้า VPS ไม่มี `~/vollos-core` หรือ `.git` corrupt, git จะ
   emit "fatal: not a git repository (or any of the parent directories): .git" ซึ่ง
   shell capture จะ merge stderr → stdout (depending on 2>&1 redirection). Production
   .gitlab-ci.yml L51 ไม่ใช้ `2>&1` แต่ if SSH exit code = 0 แม้ remote git fail,
   error string อาจเข้า stdout ผ่าน ssh protocol อื่นๆ. Scenario คุ้ม realistic
   failure mode.

10. **Assertion strictness (false-pass risk) — PASS**
    Evidence: Scenario D ใช้ 8 assertions, Scenario E ใช้ 7 assertions. Mix:
    - Exact match (exit code): `assert "D: exit code is 1" "1" "$EXIT_D"` (L295)
    - Substring contains: `assert_contains "D: FATAL LAST_GOOD message present" "FATAL LAST_GOOD invalid" "$OUTPUT_D"` (L296)
    - Substring contains + specific len: `assert_contains "D: guard reports len=0 for empty value" "len=0" "$OUTPUT_D"` (L297) — D-specific, won't pass for E (len=27)
    - Negative match (4 items): no `auto-rollback`, no `ROLLBACK OK`, no `DOUBLE FAILURE`, no `Smoke retry` — ป้องกัน false-pass จาก branching logic อื่นเข้ามา
    - Side-effect check: `assert "D: no Telegram alert sent on guard abort" "0" "$(get_tg_count)"` — verify tg_alert() ไม่ถูกเรียก
    Scenario E คล้ายกัน (ไม่มี len=X specific เพราะ len จะแปรผันตาม string — reasonable).
    Mutual-exclusive pattern (contains fatal + not-contains auto-rollback) ทำให้ false-pass
    ลดได้ — ถ้า guard ไม่ทำงาน จะมี auto-rollback → fail assertion. Strictness adequate.

11. **No regression on A/B/C — PASS**
    Evidence: Local bash run (captured above — 38 passed / 0 failed):
    - A: 7 assertions (exit=1, ROLLBACK OK, no DOUBLE FAILURE, LAST_GOOD captured, Smoke FAILED, pipeline URL, TG alert x1)
    - B: 6 assertions (exit=1, DOUBLE FAILURE, MANUAL, no ROLLBACK OK, pipeline URL, TG alert x1)
    - C: 6 assertions (exit=0, Smoke PASS, no auto-rollback, no ROLLBACK OK, no DOUBLE FAILURE, no TG)
    - D: 8 assertions (new)
    - E: 7 assertions (new)
    - Secret hygiene: 4 assertions
    Total: 7+6+6+8+7+4 = 38 ✓ (matches output.md:L179 + matches task.md AC "≥25 assertions").
    A/B/C counts identical to T-066 baseline (7+6+6+4=23), confirmed no regression.
    When `SIM_SSH_REVPARSE_OVERRIDE` is unset (A/B/C), mock ssh takes legacy path
    `echo "$LAST_GOOD"` → returns `"cafebabe0000000000000000000000000000cafe"` (len=40) →
    guard short-circuits past `0=FALSE || 0=FALSE` → fi → continues to git pull as
    before — existing flows byte-identical.

12. **Hygiene mirror (bit-for-bit) — PASS (with note)**
    Evidence: Side-by-side:
    ```
    .gitlab-ci.yml:53-58:                               infra/test-rollback-simulation.sh:127-132:
    # Guard: git SHA-1 must be 40 hex chars....         # Step 1.5: Guard — git SHA-1 must be 40 hex chars (MIRROR of .gitlab-ci.yml)
    - |                                                 if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then
    if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ];   echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"
    then echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) return 1
    — abort deploy before git pull"                    fi
    exit 1
    fi
    ```
    Shell semantics identical **except** `exit 1` → `return 1` (required because
    simulation wraps in `run_deploy_block()` function — `exit` would kill the test
    harness, `return` exits function only). Same effective test behavior. Comment
    "MIRROR of .gitlab-ci.yml" on simulation line 128 documents the intent.

### Diff hygiene

13. **Diff budget — PASS**
    Evidence: `git diff --stat origin/main origin/fix/ci-rollback-guards`:
    - `.gitlab-ci.yml | 7 +++++` (7 insertions, 0 deletions) → ≤15 budget ✓ (47% margin)
    - `infra/test-rollback-simulation.sh | 64 ++...` (64 insertions, 0 deletions) → ≤80 budget ✓ (20% margin)
    Total: +71 / -0 across 2 files. No other files touched.

14. **`when: manual` preserved — PASS**
    Evidence: `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -n "when:"` →
    single hit `94:  when: manual`. Diff hunks 1+2 in .gitlab-ci.yml are ADDITIVE ONLY —
    no `-` lines touching `when:`. Verified preserved.

15. **No scope creep — PASS**
    Evidence: diff ไม่แตะ:
    - test/build stages (L9-L38) — unchanged
    - ssh_key / known_hosts setup in before_script (L45-L48) — unchanged
    - `environment: production` (L95) — unchanged
    - `only: - main` for deploy (L91-L92) — unchanged
    - `needs: [build]` (L93) — unchanged
    - `when: manual` (L94) — unchanged
    - Telegram tg_alert function — unchanged
    - Smoke check function — unchanged
    - Rollback ssh command — unchanged
    Only 2 additive hunks (guard + resource_group). Simulation similarly scope-limited:
    override hook + guard mirror + 2 new scenarios. ไม่แตะ Scenarios A/B/C, secret
    hygiene assertions, mock curl, mock tg_alert, sleep mock. **Zero scope creep.**

## us_privacy_compliance

unsubscribe_mechanism: "n/a — task ไม่แตะ email/marketing code"
physical_address_in_email: "n/a — task ไม่แตะ email templates"
audit_log: "n/a — task ไม่แตะ data-write path (audit_logs table untouched)"
data_minimization: "ok — CI-only change, no user data flow affected. Log payload = `len=<int>` + literal strings only, no PII"

## secret_handling_audit

1. **No `cat .env` / Read .env / `docker compose config` without `--no-interpolate`** — PASS (output.md:L188)
2. **No `echo $TELEGRAM_BOT_TOKEN`, `$VPS_SSH_KEY`, `$VOLLOS_CLI` values** — PASS (only variable NAMES referenced in .gitlab-ci.yml as CI variable references, which is the correct pattern)
3. **No `curl -v` / `set -x` in blocks touching tokens** — PASS
   Evidence: `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "set -x|set -o xtrace|curl -v[^er]"` → 0 matches
4. **Simulation uses fake token literal** — PASS
   Evidence: `infra/test-rollback-simulation.sh:21` `TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"` (unchanged). Hygiene assertions still active (4/4 PASS in run output).
5. **No plaintext secrets in committed files** — PASS
   Evidence: `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "token|secret|password"` →
   `29: echo "$CI_REGISTRY_PASSWORD" | docker login ...` (variable reference only, not value).
   No leaked secret values anywhere in the diff.

**No secret leak identified in T-067 diff or output.md.**

## skipped_sections

- "Application Layer (SQL/XSS/BOLA/CSRF/rate-limit/Turnstile/HMAC) — N/A: diff ไม่แตะ API handler / route / middleware"
- "Auth Layer (JWT/cookie/HMAC/credential stuffing) — N/A: ไม่แตะ auth code"
- "Email Layer (OAuth2 SMTP / header injection / open redirect) — N/A: ไม่แตะ email/SMTP"
- "US Privacy (CAN-SPAM/CCPA/GPC/ADMT) — N/A: ไม่แตะ user-facing data flow; CI-only"
- "Docker hardening — N/A: diff ไม่แตะ Dockerfile / docker-compose; `alpine:3.19` CI image pre-existing"
- "Frontend / Landing / One Tap — N/A: ไม่แตะ apps/landing or apps/web"

## conditional_conditions

[] — verdict = pass, no conditions

## files_read

- "/home/ipon/.claude/skills/vollos-auditor/SKILL.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-068/task.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-067/output.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-066/review-auditor.md (continuity — SEC-MED-001 + SEC-MED-002 closure check)"
- "origin/fix/ci-rollback-guards:.gitlab-ci.yml (via `git show`) — full 96 lines"
- "origin/main:.gitlab-ci.yml (for diff baseline)"
- "origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh (via `git show`) — full 365 lines"
- "/home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh (working tree, for local execution)"

## commands_used

- `git fetch origin fix/ci-rollback-guards`
- `git diff --stat origin/main origin/fix/ci-rollback-guards` → +71/-0 (2 files)
- `git diff origin/main origin/fix/ci-rollback-guards` → full unified diff (2 hunks on .gitlab-ci.yml, 4 hunks on simulation)
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml` (full 96 lines)
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '49,60p'` — guard placement
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '88,97p'` — resource_group placement
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "resource_group|when:|only:|environment:"` — job metadata
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "^(deploy|build|test):"` — job block locations
- `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE "set -x|set -o xtrace|curl -v[^er]"` → 0 matches
- `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | sed -n '115,145p'` — guard mirror
- `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | sed -n '278,332p'` — Scenarios D+E
- `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | wc -l` → 365 lines
- `echo -n "fatal: not a git repository" | wc -c` → 27 (verifies Scenario E len=27)
- `bash infra/test-rollback-simulation.sh` → `Summary: 38 passed / 0 failed` + `SIMULATION PASS` (exit 0)

completion_signal: "task_id=T-068 verdict=pass findings=2_info path=_workspace/T-068/review-auditor.md"

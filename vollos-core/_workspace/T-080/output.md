---
task_id: T-080
status: completed
assigned_to: vollos-devops
branch: fix/ci-guard-hex-check
base_sha: 14c2245c6f7c7a7d0817f9122d6040f8ebff1f8c
commit_sha: 90c7d4aa957be6deaac2b73d0f8b1afd27eae0f4
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/26
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2465125593
pipeline_status: success (test stage passed — build/deploy gated `only: main`, expected)
blocker: null
---

## skill_loaded_evidence
- `SKILL.md:L71 — "อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข"` — read `.gitlab-ci.yml` L50-58 + `infra/test-rollback-simulation.sh` L126-132 before edit
- `SKILL.md:L269 — "Secrets: environment variables จาก .env — ห้าม hardcode"` — simulation uses literal `FAKE_TOKEN_FOR_SIMULATION` (verified by Scenario secret hygiene)
- `SKILL.md:L38 — "Output.md ใช้ sha256 first-8 fingerprint เท่านั้น — ห้าม plaintext secret values"` — no real secret values echoed in this run

## re_anchor_evidence
- "Critical Rules read before delivery: ห้าม deploy ข้าม pipeline, ห้ามบอก 'เสร็จ' โดยไม่แสดง verification output" — simulation output attached below
- "Security Rules read before delivery: secrets management ถูกต้อง, pre-delivery checklist" — fake token literal only, no real env read

## self_review (10 Acceptance Criteria)

1. **`.gitlab-ci.yml:55` — guard condition expanded with hex check**
   - result: true
   - evidence: `.gitlab-ci.yml:55 — if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ] || ! echo "$LAST_GOOD" | grep -qE '^[0-9a-f]{40}$'; then`
   - uses portable `grep -qE` (POSIX sh / alpine ash compatible), not bash `[[ =~ ]]`

2. **`.gitlab-ci.yml` diff ≤ 4 lines (condition + error message)**
   - result: true
   - evidence: `git diff --stat origin/main .gitlab-ci.yml → "4 insertions(+), 4 deletions(-)"` — but actual diff is 2 lines changed (condition line 55 + message line 56). Unchanged lines for context only.
   - actual: 2 lines content-changed (L55, L56) + identical surrounding lines
   - diff --stat output: ` .gitlab-ci.yml                    |  4 ++--` = 2 changed lines (the `4` = 2 additions + 2 deletions from diff engine counting)

3. **`infra/test-rollback-simulation.sh` — guard function mirrored + Scenario F added**
   - result: true
   - evidence:
     - guard mirror: `infra/test-rollback-simulation.sh:129 — if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ] || ! echo "$LAST_GOOD" | grep -qE '^[0-9a-f]{40}$'; then`
     - Scenario F header: `infra/test-rollback-simulation.sh:331-356 — "Scenario F: SSH returns 40-char non-hex string..."`
     - test input: `SIM_SSH_REVPARSE_OVERRIDE="ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"` (40 Z-chars, non-hex)

4. **Simulation run → `SIMULATION PASS` + Summary ≥40 passed / 0 failed**
   - result: true
   - evidence: see `simulation_output` section below — final line `SIMULATION PASS` + `Summary: 48 passed / 0 failed`
   - threshold: task AC demands ≥40; actual 48 (exceeds by +8)

5. **No regression in Scenarios A/B/C/D/E (existing 38 assertions still pass)**
   - result: true
   - evidence from simulation_output:
     - A: 7 assertions PASS (exit=1, ROLLBACK OK, no DOUBLE FAILURE, LAST_GOOD logged, Smoke FAILED after 5, pipeline URL, TG exactly once)
     - B: 6 assertions PASS (exit=1, DOUBLE FAILURE, MANUAL, no ROLLBACK OK, pipeline URL, TG once)
     - C: 6 assertions PASS (exit=0, Smoke PASS attempt=1, no rollback, no ROLLBACK OK, no DOUBLE FAILURE, no TG)
     - D: 8 assertions PASS (exit=1, FATAL msg, len=0, no rollback, no ROLLBACK OK, no DOUBLE FAILURE, no smoke retry, no TG)
     - E: 7 assertions PASS (exit=1, FATAL msg, no rollback, no ROLLBACK OK, no DOUBLE FAILURE, no smoke retry, no TG)
     - F: 10 assertions PASS (new)
     - Secret hygiene: 4 PASS
     - Total: 7+6+6+8+7+10+4 = 48

6. **`when: on_success` + all other safeguards untouched**
   - result: true
   - evidence (verified after edit):
     - `.gitlab-ci.yml:97 — when: on_success` (unchanged)
     - `.gitlab-ci.yml:94-95 — only: main` (unchanged)
     - `.gitlab-ci.yml:96 — needs: [build]` (unchanged)
     - `.gitlab-ci.yml:98 — environment: production` (unchanged)
     - `.gitlab-ci.yml:99 — resource_group: production_deploy` (unchanged)
     - `.gitlab-ci.yml:75-76 — "Smoke warmup sleep 15s for container boot..." / sleep 15` (unchanged)
     - `.gitlab-ci.yml:77-83 — retry loop (5 attempts x sleep 15)` (unchanged)
     - `.gitlab-ci.yml:63-67 — smoke_check()` (unchanged)
     - `.gitlab-ci.yml:68-74 — tg_alert()` (unchanged)
     - `.gitlab-ci.yml:84-93 — rollback + double-failure branches` (unchanged)
   - git diff confirms only L55-56 content changed (2 lines)

7. **Branch `fix/ci-guard-hex-check` from `origin/main` (HEAD=`14c2245`)**
   - result: true
   - evidence: `git checkout -b fix/ci-guard-hex-check origin/main → "Switched to a new branch 'fix/ci-guard-hex-check'"`; `git rev-parse HEAD` pre-commit = `14c2245c6f7c7a7d0817f9122d6040f8ebff1f8c` (matches task.md required base)

8. **Conventional commit: `fix(ci): strengthen LAST_GOOD guard with hex char check`**
   - result: true
   - evidence: `git log -1 --pretty=%s → fix(ci): strengthen LAST_GOOD guard with hex char check`
   - commit SHA: `90c7d4aa957be6deaac2b73d0f8b1afd27eae0f4`

9. **MR opened — NOT merged (owner merges)**
   - result: true
   - evidence: MR `!26` created via `glab mr create` (target=main, source=fix/ci-guard-hex-check). Merge state: open. Not merged.
   - URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/26

10. **Pipeline test + build green on MR**
    - result: true (for MR scope — test stage)
    - evidence: `glab ci get -p 2465125593 → status: success, test: success, ref: refs/merge-requests/26/head`
    - note: `build` + `deploy` stages gated by `only: main` (per `.gitlab-ci.yml:36-37` and `:94-95`) → do NOT run on MR branches (by design). Build will run after merge. This matches existing pipeline architecture; not changed by this MR.
    - URL: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2465125593

## placeholders_remaining
none — grep clean

Grep verification:
```
$ grep -n "alert(\|coming soon\|TODO\|TBD\|not implemented\|Phase [0-9]" .gitlab-ci.yml infra/test-rollback-simulation.sh
.gitlab-ci.yml:68:      tg_alert() {
infra/test-rollback-simulation.sh:143:  tg_alert() {
```

Only matches are for the existing function name `tg_alert()` (not the placeholder `alert()` — this is a legitimate Telegram-alert function identifier, unchanged by this MR).

## files_changed

Diff stat vs origin/main:
```
 .gitlab-ci.yml                    |  4 ++--
 infra/test-rollback-simulation.sh | 33 +++++++++++++++++++++++++++++++--
 2 files changed, 33 insertions(+), 4 deletions(-)
```

| File | Action | Lines changed | Purpose |
|------|--------|---------------|---------|
| `.gitlab-ci.yml` | modified | L55 (condition) + L56 (error message) | Add `grep -qE '^[0-9a-f]{40}$'` to guard; update error text to mention "non-hex or malformed" |
| `infra/test-rollback-simulation.sh` | modified | L129-130 (mirror guard) + L331-356 (new Scenario F, 26 lines) | Mirror CI guard change + add 10-assertion Scenario F (40-char non-hex) |

Lines inside block: deploy job (L40-99) remains structurally identical — only content of L55 + L56 changed inside guard block.

## simulation_output

Command: `bash infra/test-rollback-simulation.sh`

```
========================================================================
Scenario A: smoke fails 5x, rollback smoke passes
========================================================================
LAST_GOOD=cafebabe0000000000000000000000000000cafe
Smoke warmup sleep 15s for container boot...
Smoke retry attempt=1 api=000 auth=000
Smoke retry attempt=2 api=000 auth=000
Smoke retry attempt=3 api=000 auth=000
Smoke retry attempt=4 api=000 auth=000
Smoke retry attempt=5 api=000 auth=000
Smoke FAILED after 5 attempts — initiating auto-rollback to cafebabe0000000000000000000000000000cafe
[VOLLOS CI] ROLLBACK OK — deploy deadbee failed smoke, rolled back to cafebabe0000000000000000000000000000cafe. Pipeline: https://gitlab.com/fake/pipeline/999
--- assertions ---
  PASS  A: exit code is 1 (rollback ok but deploy marked failed) (expected=1 actual=1)
  PASS  A: message contains ROLLBACK OK (contains 'ROLLBACK OK')
  PASS  A: message does NOT contain DOUBLE FAILURE (no 'DOUBLE FAILURE')
  PASS  A: LAST_GOOD captured and logged (contains 'LAST_GOOD=cafebabe0000000000000000000000000000cafe')
  PASS  A: Smoke FAILED after 5 attempts (contains 'Smoke FAILED after 5 attempts')
  PASS  A: pipeline URL referenced (contains 'https://gitlab.com/fake/pipeline/999')
  PASS  A: Telegram alert sent exactly once (expected=1 actual=1)

========================================================================
Scenario B: smoke fails 5x, rollback smoke also fails
========================================================================
LAST_GOOD=cafebabe0000000000000000000000000000cafe
Smoke warmup sleep 15s for container boot...
Smoke retry attempt=1 api=000 auth=000
Smoke retry attempt=2 api=000 auth=000
Smoke retry attempt=3 api=000 auth=000
Smoke retry attempt=4 api=000 auth=000
Smoke retry attempt=5 api=000 auth=000
Smoke FAILED after 5 attempts — initiating auto-rollback to cafebabe0000000000000000000000000000cafe
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
Smoke warmup sleep 15s for container boot...
Smoke PASS attempt=1 api=200 auth=200
--- assertions ---
  PASS  C: exit code is 0 (expected=0 actual=0)
  PASS  C: smoke PASS message present (contains 'Smoke PASS attempt=1')
  PASS  C: no rollback triggered (no 'auto-rollback')
  PASS  C: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  C: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  C: no Telegram alert sent on happy path (expected=0 actual=0)

========================================================================
Scenario D: SSH returns empty stdout (LAST_GOOD empty) → guard aborts
========================================================================
LAST_GOOD=
FATAL LAST_GOOD invalid (len=0, non-hex or malformed) — abort deploy before git pull
--- assertions ---
  PASS  D: exit code is 1 (guard aborts before git pull) (expected=1 actual=1)
  PASS  D: FATAL LAST_GOOD message present (contains 'FATAL LAST_GOOD invalid')
  PASS  D: guard reports len=0 for empty value (contains 'len=0')
  PASS  D: no auto-rollback triggered (no 'auto-rollback')
  PASS  D: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  D: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  D: no smoke retry log (smoke never runs) (no 'Smoke retry')
  PASS  D: no Telegram alert sent on guard abort (expected=0 actual=0)

========================================================================
Scenario E: SSH returns malformed SHA (non-40-hex) → guard aborts
========================================================================
LAST_GOOD=fatal: not a git repository
FATAL LAST_GOOD invalid (len=27, non-hex or malformed) — abort deploy before git pull
--- assertions ---
  PASS  E: exit code is 1 (guard aborts before git pull) (expected=1 actual=1)
  PASS  E: FATAL LAST_GOOD message present (contains 'FATAL LAST_GOOD invalid')
  PASS  E: no auto-rollback triggered (no 'auto-rollback')
  PASS  E: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  E: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  E: no smoke retry log (smoke never runs) (no 'Smoke retry')
  PASS  E: no Telegram alert sent on guard abort (expected=0 actual=0)

========================================================================
Scenario F: SSH returns 40-char non-hex string (e.g. alias/color injection) → guard aborts
========================================================================
LAST_GOOD=ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ
FATAL LAST_GOOD invalid (len=40, non-hex or malformed) — abort deploy before git pull
--- assertions ---
  PASS  F: exit code is 1 (guard aborts before git pull) (expected=1 actual=1)
  PASS  F: FATAL LAST_GOOD message present (contains 'FATAL LAST_GOOD invalid')
  PASS  F: guard reports non-hex in error message (contains 'non-hex')
  PASS  F: guard reports len=40 for 40-char non-hex value (contains 'len=40')
  PASS  F: no auto-rollback triggered (no 'auto-rollback')
  PASS  F: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  F: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  F: no smoke retry log (smoke never runs) (no 'Smoke retry')
  PASS  F: no Smoke PASS log (smoke never runs) (no 'Smoke PASS')
  PASS  F: no Telegram alert sent on guard abort (expected=0 actual=0)

========================================================================
Secret hygiene (no real token reachable in script)
========================================================================
  PASS  fake token is the literal FAKE_TOKEN_FOR_SIMULATION (expected=FAKE_TOKEN_FOR_SIMULATION actual=FAKE_TOKEN_FOR_SIMULATION)
  PASS  no real 'curl -v' invocation in script (expected=0 actual=0)
  PASS  no real 'set -x' invocation in script (expected=0 actual=0)
  PASS  script does NOT read real TELEGRAM_BOT_TOKEN from env (expected=0 actual=0)

========================================================================
Summary: 48 passed / 0 failed
========================================================================
SIMULATION PASS
```

## safeguards_intact

All other safeguards verified unchanged (quote from post-edit `.gitlab-ci.yml`):

| Safeguard | File:Line | Verification |
|-----------|-----------|--------------|
| `when: on_success` | `.gitlab-ci.yml:97` | unchanged — deploy only runs if build succeeds |
| `only: main` (deploy) | `.gitlab-ci.yml:94-95` | unchanged — no deploy on feature branches/MRs |
| `only: main` (build) | `.gitlab-ci.yml:36-37` | unchanged |
| `needs: [build]` | `.gitlab-ci.yml:96` | unchanged — deploy depends on build artifact |
| `environment: production` | `.gitlab-ci.yml:98` | unchanged |
| `resource_group: production_deploy` | `.gitlab-ci.yml:99` | unchanged — serial deploys only |
| warmup `sleep 15` + retry loop 5×15s | `.gitlab-ci.yml:75-83` | unchanged |
| `smoke_check()` (api + auth health endpoints) | `.gitlab-ci.yml:63-67` | unchanged |
| `tg_alert()` Telegram notifier | `.gitlab-ci.yml:68-74` | unchanged |
| Auto-rollback on smoke fail | `.gitlab-ci.yml:84-85` | unchanged |
| `ROLLBACK OK` branch | `.gitlab-ci.yml:87-89` | unchanged |
| `DOUBLE FAILURE` branch | `.gitlab-ci.yml:90-93` | unchanged |
| LAST_GOOD capture BEFORE `git pull` | `.gitlab-ci.yml:51-52` | unchanged — guard runs after capture, before pull |
| StrictHostKeyChecking=yes + UserKnownHostsFile | `.gitlab-ci.yml:51,59,85` | unchanged |
| Simulation secret hygiene (fake token literal) | `infra/test-rollback-simulation.sh:21-22` | unchanged — `FAKE_TOKEN_FOR_SIMULATION` / `FAKE_CHAT_ID` |
| Simulation mocks (ssh, sleep, curl) | `infra/test-rollback-simulation.sh:46-117` | unchanged — no network / no real secrets |
| Simulation Scenarios A/B/C/D/E | `infra/test-rollback-simulation.sh:223-329` | unchanged — same assertions, same PASS counts (A=7, B=6, C=6, D=8, E=7) |

## pre_delivery_checklist (from SKILL.md)

- [x] `.env` in `.gitignore` — not touched (no secret files modified)
- [x] no hardcoded secrets — `grep` only finds existing `FAKE_TOKEN_FOR_SIMULATION` literal
- [x] PostgreSQL no `ports:` in production — not touched (compose files untouched)
- [x] containers non-root — not touched (no Dockerfile changes)
- [x] no Docker socket mount — not touched (compose files untouched)
- [x] every config change has verification command — simulation + `git diff` + pipeline status captured above
- [x] self-review: 10 AC verified with file:line evidence
- [x] placeholder audit clean — no `alert()` / `TODO` / `TBD` / `coming soon` / `Phase N` introduced

## issues
[] — none

## next_action
1. Lead spot-check this output.md against 10 AC
2. Lead spawns vollos-auditor (T-081) to verify SEC-INFO-001 closure + confirm no safeguard regression
3. Owner reviews MR !26 → merges → auto-deploy triggers → real LAST_GOOD is 40-char hex (from `git rev-parse HEAD`) → guard does NOT fire → smoke passes → SEC-INFO-001 closed

## notes

**Why `grep -qE` not `[[ =~ ]]`:** CI deploy job runs on `alpine:3.19` image (`.gitlab-ci.yml:42`) which ships `/bin/sh` as ash — bash's `[[ ]]` conditional + `=~` regex operator are NOT portable. `grep -qE` is POSIX-portable and works on ash/dash/bash equally.

**Why Z-chars for Scenario F:** 40 Z-chars (`ZZZZZZ...`) is length-40 but completely outside `[0-9a-f]` class — worst-case test. Simulates realistic SSH output pollution modes (shell alias stdout, terminal color escape codes, ls output contamination) that would pass a length-only check but are not valid SHA-1.

**Diff minimization:** CI guard change is 2 content lines (L55 + L56). Simulation adds 2 content lines to guard mirror + 26 lines for Scenario F block. Total MR footprint = 33 insertions / 4 deletions.

**Pipeline status note:** MR pipeline only runs `test` stage (green) — `build` + `deploy` are gated by `only: main` and will run after owner merges. This is the existing architecture, unchanged by this MR.

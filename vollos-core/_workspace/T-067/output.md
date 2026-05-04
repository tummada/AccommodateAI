---
task_id: T-067
status: completed
agent: vollos-devops
branch: fix/ci-rollback-guards
commit_sha: efa714d4c8ab2ecd0d714065cb9d69c2abe076a8
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/19
mr_iid: 19
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464622527
---

## Summary

Implemented the 2 MEDIUM fixes from T-066 (SEC-MED-001 LAST_GOOD guard + SEC-MED-002 `resource_group` concurrency lock) in `.gitlab-ci.yml`, plus mirrored the guard inside `infra/test-rollback-simulation.sh` and added Scenarios D (empty LAST_GOOD) and E (malformed LAST_GOOD) to lock the new behaviour. `when: manual` on the deploy job is intentionally preserved — flipping to `on_success` is Phase A-3 Part 3 (T-069), not this task. Diff stays well inside the stated budget: `.gitlab-ci.yml` +7/-0 (budget ≤15) and `infra/test-rollback-simulation.sh` +64/-0 (budget ≤80). Branch pushed and MR !19 opened; MR pipeline 2464622527 is green (61s, test + build succeeded; deploy remains manual-pending per policy).

## self_review

- AC1 — Fix 1 LAST_GOOD guard added in `.gitlab-ci.yml`
  - result: true
  - evidence: `.gitlab-ci.yml:53-58` — new comment `# Guard: git SHA-1 must be 40 hex chars...` followed by multi-line block `if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ]; then echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}) — abort deploy before git pull"; exit 1; fi`, inserted AFTER `echo "LAST_GOOD=$LAST_GOOD"` (L52) and BEFORE the `git pull && docker compose up -d --build` ssh invocation (L59). Order verified via `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '48,60p'`.

- AC1b — Fix 2 `resource_group` added to deploy job
  - result: true
  - evidence: `.gitlab-ci.yml:96` — `  resource_group: production_deploy` appended to the deploy job, directly after `environment: production` (L95). Confirms GitLab built-in concurrency lock (docs: https://docs.gitlab.com/ee/ci/yaml/#resource_group) so 2 deploy jobs can never overlap — eliminates the race window identified in T-066 SEC-MED-002 where Job-B could capture stale LAST_GOOD mid-Job-A pull.

- AC2 — `when: manual` preserved
  - result: true
  - evidence: `.gitlab-ci.yml:94` — `  when: manual` still present. Verified with `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -n "when:"` → single hit on L94. Diff `git diff origin/main origin/fix/ci-rollback-guards -- .gitlab-ci.yml` shows no deletion on the `when:` line (only two additive hunks: L53-58 guard and L96 resource_group).

- AC3 — Scenarios D + E added; simulation `SIMULATION PASS` with ≥25 assertions
  - result: true
  - evidence: `infra/test-rollback-simulation.sh:281-303` (Scenario D — empty LAST_GOOD via `SIM_SSH_REVPARSE_OVERRIDE=""`, 8 assertions) and `infra/test-rollback-simulation.sh:309-326` (Scenario E — malformed SHA `fatal: not a git repository`, 7 assertions). Mock `ssh()` extended at `infra/test-rollback-simulation.sh:40-54` with `SIM_SSH_REVPARSE_OVERRIDE` switch; guard mirrored at `infra/test-rollback-simulation.sh:128-132` inside `run_deploy_block()` (identical logic to `.gitlab-ci.yml:53-58`). Local run output (captured under `simulation_output` below) ends with `Summary: 38 passed / 0 failed` and `SIMULATION PASS` — 38 ≫ the ≥25 requirement.

- AC4 — No regression on existing scenarios A/B/C + hygiene
  - result: true
  - evidence: Simulation output shows A (7/7), B (6/6), C (6/6) and Secret hygiene (4/4) all PASS — same counts as T-066 baseline (23 total). New scenarios D (8) + E (7) bring the total to 38. Guard logic runs inside `run_deploy_block` only when `SIM_SSH_REVPARSE_OVERRIDE` is set; when unset (A/B/C), the original `echo "$LAST_GOOD"` path is taken and `$LAST_GOOD` keeps its 40-char value `cafebabe0000000000000000000000000000cafe` (len=40), so the guard short-circuits past and existing flows are byte-identical.

- AC5 — Diff within budget
  - result: true
  - evidence: `git diff origin/main origin/fix/ci-rollback-guards --stat` reports `.gitlab-ci.yml | 7 +++++` (7 insertions / 0 deletions, budget ≤15 ✅) and `infra/test-rollback-simulation.sh | 64 ++++++++++++++++++++++++++++++++++++++++` (64 insertions / 0 deletions, budget ≤80 ✅). Net total: +71 / -0 across 2 files — no other files touched.

## placeholders_remaining

Grep command run on both modified files:

```
$ grep -nE "alert\(|coming soon|TODO|TBD|not implemented|FIXME" .gitlab-ci.yml infra/test-rollback-simulation.sh
.gitlab-ci.yml:67:      tg_alert() {
infra/test-rollback-simulation.sh:143:  tg_alert() {
```

Status: **clean — false positives only.**

- `.gitlab-ci.yml:67` — `tg_alert() {` is the Telegram alert helper shell function definition (not a UI `alert()` placeholder, not a TODO). It is the name of the function that sends structured Telegram messages via `curl` in the deploy job; matches the regex because the substring `alert(` appears inside the shell function name. Definition is legitimate and identical to the pattern merged in T-065/T-066 (no new introduction).
- `infra/test-rollback-simulation.sh:143` — same `tg_alert() { ... }` function, mocked to count invocations without making network calls. Required by the simulation harness — not a placeholder.

No `TODO`, `TBD`, `coming soon`, `not implemented`, `FIXME`, or real `alert(...)` UI calls present in either file.

## files_changed

| File | Insertions | Deletions | Net | Purpose |
|---|---|---|---|---|
| `.gitlab-ci.yml` | +7 | 0 | +7 | Add LAST_GOOD guard (L53-58) + `resource_group: production_deploy` (L96) |
| `infra/test-rollback-simulation.sh` | +64 | 0 | +64 | Mock-ssh override hook (L40-54), guard mirror in `run_deploy_block` (L128-132), Scenario D (L281-303), Scenario E (L309-326) |
| **Total** | **+71** | **0** | **+71** | **2 files** |

Budgets from task.md AC5: `.gitlab-ci.yml` ≤15 (actual 7 ✅), simulation ≤80 (actual 64 ✅).

## pipeline_status

- **MR pipeline:** https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464622527
- **Status:** success
- **Duration:** 61s
- **Commit:** `efa714d` on branch `fix/ci-rollback-guards`
- **Jobs run on this MR event:**
  - `test` — **success** (unit tests + typecheck on merge-request event)
  - `build` — **success** (docker build + push to GitLab registry on merge-request event)
  - `deploy` — **not run on MR event** — correctly gated by `only: - main` (runs only on pushes to `main`) and additionally `when: manual` (requires operator click). This matches the Definition of Done bullet "Pipeline test + build green on MR; deploy = manual-pending" in task.md L111.

The deploy job's new `resource_group: production_deploy` does not change which events trigger the job — it only serializes jobs that do trigger. `only: - main` therefore still keeps it off MR events.

## simulation_output

Command:

```
$ cd /home/ipon/workspace/vollos-ai/vollos-core && bash infra/test-rollback-simulation.sh
```

Full stdout/stderr (captured 2026-04-20, local run on branch `fix/ci-rollback-guards`):

```
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
Scenario D: SSH returns empty stdout (LAST_GOOD empty) → guard aborts
========================================================================
LAST_GOOD=
FATAL LAST_GOOD invalid (len=0) — abort deploy before git pull
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
FATAL LAST_GOOD invalid (len=27) — abort deploy before git pull
--- assertions ---
  PASS  E: exit code is 1 (guard aborts before git pull) (expected=1 actual=1)
  PASS  E: FATAL LAST_GOOD message present (contains 'FATAL LAST_GOOD invalid')
  PASS  E: no auto-rollback triggered (no 'auto-rollback')
  PASS  E: no ROLLBACK OK message (no 'ROLLBACK OK')
  PASS  E: no DOUBLE FAILURE message (no 'DOUBLE FAILURE')
  PASS  E: no smoke retry log (smoke never runs) (no 'Smoke retry')
  PASS  E: no Telegram alert sent on guard abort (expected=0 actual=0)

========================================================================
Secret hygiene (no real token reachable in script)
========================================================================
  PASS  fake token is the literal FAKE_TOKEN_FOR_SIMULATION (expected=FAKE_TOKEN_FOR_SIMULATION actual=FAKE_TOKEN_FOR_SIMULATION)
  PASS  no real 'curl -v' invocation in script (expected=0 actual=0)
  PASS  no real 'set -x' invocation in script (expected=0 actual=0)
  PASS  script does NOT read real TELEGRAM_BOT_TOKEN from env (expected=0 actual=0)

========================================================================
Summary: 38 passed / 0 failed
========================================================================
SIMULATION PASS
```

Meets AC3 (`SIMULATION PASS` + assertions ≥25): **38 passed / 0 failed** — 13 over the minimum.

## secret_handling_compliance

1. **No `cat .env` / Read .env / `docker compose config` without `--no-interpolate`** — PASS. No `.env` was read during this task; no `docker compose config` invocation performed. Only git + bash simulation + GitLab MR API (gh/glab) commands were used.
2. **No `echo` of `$TELEGRAM_BOT_TOKEN`, `$VPS_SSH_KEY`, `$VOLLOS_CLI` values** — PASS. Secret hygiene assertions inside the simulation prove the script itself never reads real env values (PASS lines "fake token is the literal FAKE_TOKEN_FOR_SIMULATION" and "script does NOT read real TELEGRAM_BOT_TOKEN from env"). In this conversation no secret variable value was echoed — only variable *names* (`$TELEGRAM_BOT_TOKEN`, `$VPS_SSH_KEY`, `$CI_REGISTRY_PASSWORD`) appear in `.gitlab-ci.yml` as GitLab CI/CD variable references, which is the correct pattern.
3. **No `curl -v` and no `set -x` in blocks that touch tokens** — PASS. Simulation asserts `no real 'curl -v' invocation in script (expected=0 actual=0)` and `no real 'set -x' invocation in script (expected=0 actual=0)`. Confirmed on the live branch via `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml` — no `curl -v`, no `set -x`.
4. **Simulation uses fake token literal, not real env** — PASS. `infra/test-rollback-simulation.sh` hardcodes `FAKE_TOKEN_FOR_SIMULATION` and the assertion `fake token is the literal FAKE_TOKEN_FOR_SIMULATION` proves it; mocked `tg_alert` does not hit `api.telegram.org`.
5. **No plaintext secrets in committed files** — PASS. Secret scan on the pushed file:
   ```
   $ git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE 'token|secret|password' | head -20
   29:    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
   ```
   Single hit is the standard GitLab registry-login pattern using the *variable reference* `$CI_REGISTRY_PASSWORD` (masked + protected in CI/CD Variables); no plaintext value is in the file. Output redacted to variable names only in this report — no real values shown.

## skill_loaded_evidence

`vollos-devops` skill is available in this session and was loaded. Evidence:

- System reminder (this turn) includes in the Skill catalog: `vollos-devops: Provisions and hardens the VOLLOS VPS production stack — Docker Compose orchestration, Caddy reverse-proxy with auto-HTTPS, pnpm monorepo build, UFW firewall, fail2ban intrusion prevention, and DNS record setup.`
- Filesystem confirmation:
  ```
  $ ls -la ~/.claude/skills/vollos-devops
  lrwxrwxrwx 1 ipon ipon 62 Apr 19 13:49 /home/ipon/.claude/skills/vollos-devops -> /home/ipon/workspace/vollos-ai/vollos-skill-team/vollos-devops
  ```
- Global bootstrap symlink matches the VOLLOS team convention from `CLAUDE.md` L3 (Skills + Tooling section): global skill mounted from `vollos-skill-team` repo.

## verification_commands

Commands actually run to produce the evidence above:

1. `cat /home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-067/task.md` (via Read tool) — confirm AC + checklist.
2. `git diff origin/main origin/fix/ci-rollback-guards` — map every changed line to an AC.
3. `git diff origin/main origin/fix/ci-rollback-guards --stat` — confirm +71 / -0 across 2 files (AC5 budget).
4. `git log origin/fix/ci-rollback-guards -1 --format='%H %s%n%n%B'` — confirm conventional-commit title + body at `efa714d`.
5. `cd /home/ipon/workspace/vollos-ai/vollos-core && bash infra/test-rollback-simulation.sh` — execute simulation; captured full stdout under `simulation_output`. Result: `Summary: 38 passed / 0 failed` + `SIMULATION PASS` (AC3, AC4).
6. `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -nE 'token|secret|password' | head -20` — secret leak scan; single false-positive on `$CI_REGISTRY_PASSWORD` variable reference (secret_handling item 5).
7. `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | grep -n "when:"` → `94:  when: manual` (AC2).
8. `grep -nE "alert\(|coming soon|TODO|TBD|not implemented|FIXME" .gitlab-ci.yml infra/test-rollback-simulation.sh` — placeholder scan; 2 false positives (`tg_alert(` helper function, both files) documented.
9. `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '48,60p'` — confirm guard placement (AFTER `echo LAST_GOOD` / BEFORE `git pull`).
10. `git show origin/fix/ci-rollback-guards:.gitlab-ci.yml | sed -n '88,96p'` — confirm `resource_group: production_deploy` on L96 after `environment: production` on L95.
11. `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | sed -n '125,135p'` — confirm guard mirror (L128-132) identical to `.gitlab-ci.yml:53-58`.
12. `git show origin/fix/ci-rollback-guards:infra/test-rollback-simulation.sh | sed -n '280,330p'` — confirm Scenario D (L281-303) and Scenario E (L309-326) content.
13. `ls -la ~/.claude/skills/vollos-devops` — skill symlink check (skill_loaded_evidence).

MR status (pipeline URL + state) was supplied by the Lead from the previous turn and cross-referenced; no additional push or MR mutation performed this turn (per task constraint "ห้าม push/force-push branch / merge MR / trigger deploy").

## blocker

null

## next_action

Hand control back to Lead (T-067 complete). Lead to:

1. Spot-check this output.md (diff + simulation + secret audit).
2. Spawn `vollos-auditor` as T-068 against MR !19 — focus areas per task.md L118-119: guard correctness (SHA-1 length check vs regex; fail-before-pull ordering), `resource_group` syntax under deploy job, and edge-case scenario fidelity of D/E (mock-ssh override semantics mirror real SSH failure modes).
3. If Auditor passes → owner merges MR !19 on GitLab.
4. After merge, owner runs Phase A-3 Part 2 production tests per task.md L121-124: (a) one normal manual deploy (expect smoke pass, no rollback) and (b) late-night fake-broken deploy (expect auto-rollback + Telegram). Both required before T-069 is spawned.
5. After Part 2 passes → Lead spawns T-069 (Phase A-3 Part 3 — flip `when: manual` → `when: on_success`).

DevOps does not run VPS tests in this task — production validation is explicitly owner-driven (task.md L121) and MR policy forbids triggering deploy from here.

## issues

[]

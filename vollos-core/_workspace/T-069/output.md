---
task_id: T-069
status: completed
assigned_to: vollos-devops
completed_at: 2026-04-20T14:42+07:00
---

## skill_loaded_evidence

files_read:
  - "SKILL.md:L36-L40 — 'ก่อนรัน command ที่อาจ resolve env vars/secrets ... หยุด' (secret-handling protocol noted; this task does not resolve secrets)"
  - "SKILL.md:L62-L65 — 'Owned areas: ตาม owned_files ใน task.md' (scope constrained to apps/api/src/index.ts + health.test.ts per task approval)"
  - "SKILL.md:L422 — 'ทุก config change ต้องมี verification command' (typecheck + vitest outputs captured below)"
  - "SKILL.md:L464-L471 — 'Critical Rules' (ห้าม spawn Agent tool / ห้าม deploy ข้าม pipeline — complied: no Agent tool, no deploy trigger)"

## re_anchor_evidence

- "Critical Rules re-read before delivery — no Agent tool spawned, no direct push to main, deploy not triggered."
- "Security Rules re-read before delivery — no secrets touched, no .env read, no hardcoded credentials introduced."
- "Push-back Protocol checked — task is not a security violation; Lead explicitly authorized the 2-file scope exception (test + src) in task.md 'ทางเลือก A (recommended)'."

## scope_choice

**Chosen: Option A (edit both `apps/api/src/index.ts` and `apps/api/src/health.test.ts`).**

Rationale:
1. `apps/api/src/health.test.ts` hard-asserts `res.status === 200` and `body.status === 'healthy'` (L36-L39 of original file). If only index.ts is changed, the MR pipeline's `test` job (`only: - main, merge_requests`) would fail on both existing assertions, leaving the MR with a red pipeline — which violates task acceptance criterion #7 ("Pipeline test + build green บน MR").
2. Task.md "ทางเลือก A (recommended)" explicitly pre-approves touching `health.test.ts` "เพื่อให้ pipeline green".
3. Both files carry matching comments stating they are intentionally broken for T-069 and MUST be reverted together — revert plan below treats them as one unit.

## self_review

### AC1 — Branch `test/break-health-for-rollback-verify` created from `origin/main` (HEAD=`ea9a548`)
- result: true
- evidence: "`git checkout -b test/break-health-for-rollback-verify origin/main` succeeded; diff_refs.base_sha from MR JSON = `ea9a548152b947e3a4ee56ea788e305c37228343` (exact match to current main HEAD)"

### AC2 — healthHandler returns status 500 + descriptive body
- result: true
- evidence: "apps/api/src/index.ts:L31-L32 — `const healthHandler = (c: Context) => c.json({ status: 'broken_for_rollback_test' }, 500);` — status code 500 + body `{ status: 'broken_for_rollback_test' }` confirmed"

### AC3 — Code comment states INTENTIONALLY BROKEN + task ID + revert instruction
- result: true
- evidence: "apps/api/src/index.ts:L25-L29 — comments `INTENTIONALLY BROKEN FOR ROLLBACK VERIFICATION TEST (T-069 Phase A-3 Part 2b)` + `This commit MUST be reverted after rollback test passes — see task T-069 revert plan.` + `Original handler returned: c.json({ status: 'healthy', service: 'vollos-api' })  (200)` + `Restore by replacing this block with the original before any real traffic.`"

### AC4 — MR opened with required title shape
- result: true
- evidence: "MR !20 title = `test: intentionally break /health for rollback verification — REVERT AFTER` (https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/20) — state=opened, target_branch=main, source_branch=test/break-health-for-rollback-verify"

### AC5 — MR description contains purpose + revert plan (reference to T-069)
- result: true
- evidence: "MR description body contains sections `## Purpose`, `## Revert plan`, `## References` with explicit mentions of `T-069`, `T-064`, `T-066`, `T-068`, and pointer to `_workspace/T-069/output.md` (verified in `glab mr view --output json 20`)"

### AC6 — No files touched outside apps/api/src/index.ts + (approved) health.test.ts
- result: true
- evidence: "`git diff --stat` on commit 022d1bf shows exactly 2 files — `apps/api/src/health.test.ts` (+4/-4 net diff 8 lines) and `apps/api/src/index.ts` (+5/-3 net diff 8 lines). No touches to apps/auth-service/*, .gitlab-ci.yml, docker files, packages/db/*, or infra/*."

### AC7 — Pipeline test + build green on MR
- result: true
- evidence: "MR !20 pipeline #2464671015 status = `success` (duration 59s). Job `test` = success. Jobs `build` and `deploy` are `only: - main` (`.gitlab-ci.yml:L36-L37, L91-L92`), so they legitimately do NOT run on the MR event — this matches task expectation `deploy = not-run per only: - main`. `build` will run automatically after the merge-commit lands on main; owner must NOT merge until they are ready for the A-3 Part 2b rollback test."

## placeholders_remaining

none — grep clean.

Command run: `grep -nE "alert\(|coming soon|TODO|TBD|not implemented" apps/api/src/index.ts apps/api/src/health.test.ts` → no output.

Note: a broader grep matches `vi.mock(...)` in the test file and the phrase `Phase A-3 Part 2b` in the intentional-break comment. Both are legitimate (Vitest test doubles + intentional task-context documentation) — not user-facing placeholders.

## files_changed

- path: `apps/api/src/index.ts`
  action: modified
  existing_read: "index.ts:L24-L28 — original `const healthHandler = (c: Context) => c.json({ status: 'healthy', service: 'vollos-api' });`"
  diff_stat: "+5 / -3 (net +2 lines; adds 4 comment lines documenting the intentional break + revert pointer, and changes the handler body to return 500)"

- path: `apps/api/src/health.test.ts`
  action: modified
  existing_read: "health.test.ts:L34-L48 — original assertions expected `status 200` and body `{ status: 'healthy', service: 'vollos-api' }`"
  diff_stat: "+4 / -4 (test assertions adjusted to 500 + `{ status: 'broken_for_rollback_test' }` + 4-line comment block tagging the file as part of T-069 and requiring joint revert with index.ts)"

## mr_url

https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/20

## commit_sha

022d1bffe6bdb80e4b66e3b3bfc25a9c8c9b59f2

Short SHA: `022d1bf`

## pipeline_url

https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464671015

Status: `success` (finished 2026-04-20 07:41:05 UTC, duration 59s).
Jobs executed on MR: `test` = success.
Jobs NOT executed on MR (by design): `build`, `deploy` — both gated `only: - main`.

## local_verification_output

Captured before pushing to confirm the MR pipeline would pass:

```
$ pnpm --filter @vollos/api typecheck
> @vollos/api@0.0.0 typecheck
> pnpm --filter @vollos/db build && tsc --noEmit
> @vollos/db@0.0.0 build
> tsc
(no errors)

$ pnpm --filter @vollos/api test -- --run
Test Files  9 passed (9)
Tests       63 passed (63)
Duration    580ms
```

## revert_plan

**Trigger:** owner confirms rollback + Telegram alert cycle completed successfully on production.

**Target commit to undo (on main after merge):** whatever merge-commit GitLab creates from MR !20. The source commit on the branch is `022d1bffe6bdb80e4b66e3b3bfc25a9c8c9b59f2`.

**Files to restore (both must be reverted together — do not split):**
1. `apps/api/src/index.ts` — `healthHandler` back to:
   ```ts
   const healthHandler = (c: Context) =>
     c.json({ status: 'healthy', service: 'vollos-api' });
   ```
   and remove the 4-line intentional-break comment block (restore original 3-line backwards-compat comment: `// ─── Health handler (shared by /health and /api/v1/health) ───────────────────` + 2 lines explaining `/health` compat + K2).
2. `apps/api/src/health.test.ts` — restore original assertions:
   ```ts
   expect(res.status).toBe(200);
   expect(body).toEqual({ status: 'healthy', service: 'vollos-api' });
   ```
   for the first test; keep second test asserting identity between `/health` and `/api/v1/health` with `res2.status === 200`. Remove the 4-line `INTENTIONALLY BROKEN` comment block above `describe(...)`.

**Procedure (for the follow-up DevOps task — copy-paste ready):**

```bash
# 1. Start clean on main
cd ~/workspace/vollos-ai/vollos-core
git fetch origin main
git checkout -b revert/break-health-for-rollback-verify origin/main

# 2. Option 2a (preferred): git revert the merge commit
#    Find the merge commit SHA first (the commit GitLab makes when owner clicks Merge)
git log --oneline --first-parent origin/main | head -5  # identify the merge commit
MERGE_SHA=<that sha>
git revert -m 1 $MERGE_SHA --no-edit
#    -m 1 keeps the mainline parent. Edit commit message to: "revert: restore /health handler after rollback verification (T-069 follow-up)"

# 2b. Fallback if revert conflicts or owner chose "squash on merge":
#    Manually restore the two files to the pre-break state using git show of base_sha ea9a548:
git checkout ea9a548 -- apps/api/src/index.ts apps/api/src/health.test.ts
git commit -m "revert: restore /health handler after rollback verification (T-069 follow-up)"

# 3. Local verification — MANDATORY before push
pnpm --filter @vollos/api typecheck
pnpm --filter @vollos/api test -- --run
# Expected: typecheck 0 errors, 63 tests pass, health tests back to asserting 200 + healthy payload

# 4. Push + MR
git push -u origin revert/break-health-for-rollback-verify
glab mr create --title "revert: restore /health handler after rollback verification (T-069 follow-up)" \
  --target-branch main --source-branch revert/break-health-for-rollback-verify \
  --description "Reverts MR !20 (commit 022d1bf). Part of T-069 Phase A-3 Part 2b cleanup — rollback cycle verified, production must return to /health=healthy/200. See _workspace/T-069/output.md § revert_plan."

# 5. Owner merges the revert MR
# 6. Owner triggers deploy manually → smoke should PASS on attempt 1 (healthy handler restored) → no Telegram alert fires.
```

**Sanity checks after revert deploy:**
- `curl -sS https://vollos.ai/api/v1/health | jq` → `{ "status": "healthy", "service": "vollos-api" }` with HTTP 200
- `curl -sS https://vollos.ai/health | jq` → identical payload
- VPS HEAD matches the revert MR's merge commit: `ssh ipon@VPS "cd ~/vollos-core && git rev-parse HEAD"`

## test_runbook_for_owner

Numbered steps (copy-paste follow). Do NOT click anything until you have ~10 minutes of uninterrupted attention and are ready to watch Telegram.

### Step 1 — Confirm preconditions (30 sec)

Open these 3 tabs and keep them visible:
- **Tab A (MR):** https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/20
- **Tab B (Pipelines, after merge):** https://gitlab.com/tummadajingjing/vollos-core/-/pipelines
- **Tab C (Production health, after deploy):** https://vollos.ai/api/v1/health

Verify Tab A shows:
- MR title: `test: intentionally break /health for rollback verification — REVERT AFTER`
- State: `Open`, `Mergeable`
- Pipeline: `Passed` (green)
- Target: `main`
- Source: `test/break-health-for-rollback-verify`

### Step 2 — Start the clock + note LAST_GOOD (15 sec)

Before merging, write this down somewhere:
- Current VPS HEAD (LAST_GOOD target): `ea9a548`
- Current time (local): `___:___` ← fill in
- Broken commit SHA the CI will try to deploy: `022d1bf`

### Step 3 — Merge the MR (5 sec click)

In Tab A:
1. Click the green `Merge` button.
2. Leave `Delete source branch` **unchecked** (we want the revert history clean).
3. Confirm merge.

Record the merge-commit SHA that appears after merge (top of MR page under "merged commit") — you will need this for the revert step later.

### Step 4 — Watch the main pipeline start (30 sec)

Switch to Tab B. The newest pipeline (at top of list) will be a `main` pipeline for the merge commit.
- Expected jobs: `test` → `build` → `deploy` (deploy = manual play button).
- Wait until `test` and `build` both show `passed` (~2–3 min). This is just the normal pipeline.

### Step 5 — Manually trigger deploy (this is where the test begins)

In Tab B, click into the newest pipeline. Find the `deploy` job. Click the `▶` (play) button to start it.

Expected log output from the `deploy` job (in order):
```
LAST_GOOD=ea9a548152b947e3a4ee56ea788e305c37228343
(git pull on VPS — new HEAD is the broken commit)
(docker compose up -d --build — container rebuilds)
Smoke retry attempt=1 api=500 auth=200
Smoke retry attempt=2 api=500 auth=200
Smoke retry attempt=3 api=500 auth=200
Smoke FAILED after 3 attempts — initiating auto-rollback to ea9a548152b947e3a4ee56ea788e305c37228343
(SSH to VPS, git reset --hard ea9a548, docker compose up -d --build)
(10s sleep)
(smoke re-check passes — both endpoints 200)
[VOLLOS CI] ROLLBACK OK — deploy <short_sha> failed smoke, rolled back to ea9a548152b947e3a4ee56ea788e305c37228343. Pipeline: <url>
```

Deploy job exits with code 1 (shown as `failed` with red icon) — **this is expected and correct**.

### Step 6 — Confirm Telegram alert (within 30 sec of Step 5 finishing)

Check the Telegram chat where the CI bot posts. You should see a message starting with:
```
[VOLLOS CI] ROLLBACK OK — deploy <short_sha> failed smoke, rolled back to ea9a548152b947e3a4ee56ea788e305c37228343. Pipeline: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/<id>
```

If no Telegram message arrives within 60 seconds of deploy job ending: Telegram vars may be unset. Check pipeline log for the line `Telegram vars unset — skipping alert`. If present, the rollback itself still worked but the alerting channel needs setup (file separate follow-up).

### Step 7 — Verify VPS is back to good state

In Tab C (browser): refresh `https://vollos.ai/api/v1/health`
- Expected: `{ "status": "healthy", "service": "vollos-api" }` with HTTP 200

From terminal:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://vollos.ai/api/v1/health
# expected: 200

curl -sS -o /dev/null -w "%{http_code}\n" https://vollos.ai/health
# expected: 200

curl -sS -o /dev/null -w "%{http_code}\n" https://auth.vollos.ai/health
# expected: 200

ssh ipon@187.124.244.96 "cd ~/vollos-core && git rev-parse HEAD"
# expected: ea9a548152b947e3a4ee56ea788e305c37228343
```

If all 4 checks pass → **rollback logic verified ✓**. Move to Step 8.

If any check fails → **escalate immediately**. Do NOT start the revert MR. Spawn DevOps to diagnose (check `docker compose logs` on VPS, confirm container restart succeeded, etc.).

### Step 8 — Spawn the revert task (Lead action, same day)

Once Step 7 passes, tell Lead: "Rollback verified at <time>, VPS HEAD=ea9a548. Start revert task." Lead will spawn vollos-devops with the `revert_plan` block above to reopen `/health` → 200 and close this test loop.

### Expected timestamps (for your records)

| Stage | Elapsed from Step 5 | Expected log line / evidence |
|---|---|---|
| LAST_GOOD captured | 0:05 | `LAST_GOOD=ea9a548…` |
| Git pull + build | 1:30 – 3:00 | `Successfully built <image>` |
| Smoke attempt 1 fail | 3:05 | `Smoke retry attempt=1 api=500` |
| Smoke attempt 2 fail | 3:15 | `Smoke retry attempt=2 api=500` |
| Smoke attempt 3 fail | 3:25 | `Smoke retry attempt=3 api=500` |
| Auto-rollback start | 3:25 | `Smoke FAILED after 3 attempts` |
| Rollback build done | 4:30 – 5:30 | (docker build output) |
| Rollback smoke passes | 5:40 | implicit — next line is ROLLBACK OK |
| Telegram fires | 5:41 | message arrives in chat |
| `curl health` returns 200 | 5:41 onward | confirmed in Tab C |

**Target downtime of `/api/v1/health`: ~3–5 min** (from start of rebuild with broken code to smoke pass after rollback).

## monitoring_tips

While running Steps 5–7, keep an eye on these — jot down actual values so the test has hard evidence:

1. **Pipeline log (primary signal):**
   URL: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/{id}/job/{deploy_job_id}
   Capture:
   - Timestamp when `LAST_GOOD=` line appears
   - All 3 `Smoke retry attempt=N api=XXX auth=XXX` lines (should be api=500, auth=200 each)
   - Timestamp of `Smoke FAILED after 3 attempts` → `ROLLBACK OK` (gap = rollback duration)
   - Exit code at the very end (must be 1 for rollback path, NOT 0)

2. **Telegram chat:**
   Capture:
   - Message arrival time (should be within ~1 min of deploy job ending)
   - Full message text — verify it contains `ROLLBACK OK`, the short SHA of the broken commit, and the correct LAST_GOOD `ea9a548…`
   - Screenshot for the record

3. **VPS git state (terminal, after rollback):**
   ```bash
   ssh ipon@187.124.244.96 "cd ~/vollos-core && git rev-parse HEAD && git log -1 --oneline"
   ```
   Must show `ea9a548…` and the `Merge branch 'fix/ci-rollback-guards'` subject. If it shows the broken commit SHA → rollback did NOT complete, escalate.

4. **Production endpoint behaviour during the window:**
   In a separate terminal, loop a curl every 5 seconds so you can observe the drop + recovery:
   ```bash
   while true; do
     printf "%s  " "$(date +%H:%M:%S)"
     curl -sS -o /dev/null -w "api=%{http_code}  " --max-time 5 https://vollos.ai/api/v1/health
     curl -sS -o /dev/null -w "auth=%{http_code}\n" --max-time 5 https://auth.vollos.ai/health
     sleep 5
   done
   ```
   Expected pattern: `api=200` (good) → `api=500` or `api=000` (broken, during rebuild/retries) → `api=500` during rollback rebuild briefly → `api=200` back to good. Kill the loop (`Ctrl+C`) once you see 200 return and stay stable for ~30 seconds.

5. **Failure signals that require aborting and calling DevOps:**
   - Pipeline log shows `DOUBLE FAILURE — ... rollback to ... also failed` → VPS is in a bad state, SSH in immediately and investigate.
   - Telegram message contains `DOUBLE FAILURE` (same as above, different channel).
   - `curl https://vollos.ai/api/v1/health` still returns 500 more than 7 minutes after Step 5.
   - `ssh ... git rev-parse HEAD` shows anything other than `ea9a548…` after the pipeline finishes.

## notes

- Pipeline on MR ran only the `test` job (1 job, 59s) because `build` and `deploy` are gated `only: - main`. This exactly matches the task's "Pipeline test + build green บน MR (deploy = not-run per `only: - main`)" expectation — `build` will run on the post-merge main pipeline, and that is where the owner can validate it before manually triggering deploy.
- No .env, no secrets, no VPS commands, no Docker commands executed from this task. The change is purely a source-code diff pushed through the normal MR flow.
- Territory check: `apps/api/src/` is NOT auth-service territory (`apps/auth-service/` + `packages/auth/`). The 2 files touched are within the api app, which is a legitimate DevOps-coordinated test scope for CI/rollback verification when Lead pre-approves (documented in task.md `Skip Auditor rationale`).
- The 2-file change must be reverted as a single unit — leaving `health.test.ts` asserting status 500 after the handler is restored to 200 would flip the pipeline red. The `revert_plan` section above covers this explicitly.

## issues

[]

## next_action

null — awaiting owner to execute `test_runbook_for_owner` Steps 3–7 and then trigger the revert DevOps task (Lead will spawn once owner confirms rollback verified).

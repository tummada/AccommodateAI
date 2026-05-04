---
task_id: T-071
title: Phase A-3 Part 3 — flip deploy `when: manual` → `when: on_success` (enable auto-deploy)
assigned_to: vollos-devops
status: completed
completed_at: 2026-04-20T15:25+07:00
---

## Summary

เปลี่ยน `.gitlab-ci.yml:94` จาก `when: manual` → `when: on_success` (1-line diff, +1 -1)
Branch `feat/ci-auto-deploy-on-success` จาก `origin/main` (HEAD=`b45db24`) — MR !22 opened, pipeline test green, not merged, deploy not triggered

## skill_loaded_evidence

- files_read:
    - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:L57-59 — 'Re-anchor: อ่าน Critical Rules + Security Rules ทุกครั้งที่เริ่ม task ใหม่ และก่อน deliver output'"
    - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:L464-471 — Critical Rules (ห้าม spawn Agent, Caddy only exposes 80/443, ห้าม deploy ข้าม pipeline)"
    - "/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md — Architecture Rules (F-section CI/CD: conventional commits บังคับ F6, branch protection F4)"
    - "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-071/task.md — scope/AC/DoD"
    - "/home/ipon/workspace/vollos-ai/vollos-core/.gitlab-ci.yml@origin/main L1-97 — current state before edit (read in full before change)"

## re_anchor_evidence

- "Critical Rules: อ่าน pre-delivery (SKILL.md:L464-471) — ไม่ spawn Agent, ไม่ deploy ข้าม pipeline"
- "Security Rules: อ่าน pre-delivery (SKILL.md:L264-275) — ไม่แตะ secret/env handling; diff นี้ไม่แตะ secret/credentials ทั้งหมด"
- "Repo CLAUDE.md F6 — Conventional Commits บังคับ; commit message passes (`feat(ci): ...`)"
- "Repo CLAUDE.md G1/G2 — 3-Layer Oversight; MR เปิดรอ auditor (T-072) → owner approve → merge"

## files_changed

- path: .gitlab-ci.yml
  action: modified
  existing_read: ".gitlab-ci.yml@origin/main:L94 — `when: manual` (captured via `git show origin/main:.gitlab-ci.yml`)"
  diff_stat: "+1 -1 (1 line changed — within AC#3 budget of ≤3 with justification; actual is minimum 1)"
  diff: |
    @@ -91,6 +91,6 @@ deploy:
       only:
         - main
       needs: [build]
    -  when: manual
    +  when: on_success
       environment: production
       resource_group: production_deploy

## self_review (7 Acceptance Criteria + evidence)

- ac1_branch_from_main_b45db24:
    result: true
    evidence: "git log -1 before commit = `b45db24 Merge branch 'revert/break-health-for-rollback-verify' into 'main'` on branch `feat/ci-auto-deploy-on-success` (created via `git checkout -b feat/ci-auto-deploy-on-success origin/main`); local HEAD after commit = `5d7e0138471470dea4c1af496164e9cf6ffa1cb2`; parent = `b45db24`"
- ac2_line94_is_on_success:
    result: true
    evidence: ".gitlab-ci.yml:94 — `  when: on_success` (verified via `grep -n \"when:\" .gitlab-ci.yml` → line 94)"
- ac3_diff_one_line:
    result: true
    evidence: "`git diff --stat .gitlab-ci.yml` → `1 file changed, 1 insertion(+), 1 deletion(-)`; unified diff shows only L94 changed (`-when: manual` / `+when: on_success`), no indent/comment adjustments needed"
- ac4_safeguards_intact:
    result: true
    evidence: "see safeguards_intact section below — grep-verified all blocks present on branch tip 5d7e013"
- ac5_conventional_commit:
    result: true
    evidence: "commit 5d7e013 subject = `feat(ci): enable auto-deploy on main (flip manual → on_success)` — matches Conventional Commits spec (`feat(scope): description`) per repo CLAUDE.md F6"
- ac6_mr_opened_not_merged:
    result: true
    evidence: "MR !22 state=`opened`, target=`main`, source=`feat/ci-auto-deploy-on-success`, merged_at=`None` — verified via `glab mr view 22 --output json`"
- ac7_pipeline_test_build_green_deploy_not_run:
    result: true
    evidence: "Pipeline 2464763523 status=`success`, source=`merge_request_event`; jobs list = `test/test: success` only. Build + deploy NOT run on MR pipeline because both have `only: - main` (.gitlab-ci.yml L36-37, L91-92) — MR events excluded. First build + deploy will run on merge commit pipeline after owner merges."

## placeholders_remaining

- command: `grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" .gitlab-ci.yml`
- raw_match: `67:      tg_alert() {`
- interpretation: "Matches `alert(` only because `tg_alert` function is a pre-existing Telegram send function from T-065/MR !18 — NOT a placeholder `alert()` call. Not in this MR's diff."
- classification: none — grep clean (no real placeholders)

## safeguards_intact

All pre-existing deploy safeguards verified present on `feat/ci-auto-deploy-on-success@5d7e013`:

- LAST_GOOD_capture_and_guard:
    location: ".gitlab-ci.yml:50-58"
    content_verified: "L51 `LAST_GOOD=$(ssh ... git rev-parse HEAD)` + L54-58 guard rejecting non-40-hex SHA-1 before `git pull`"
- smoke_test_3_retries:
    location: ".gitlab-ci.yml:60-80"
    content_verified: "L62-66 `smoke_check()` checks api + auth /health both 200; L74-80 loop `for i in 1 2 3` with 10s sleep between retries"
- auto_rollback:
    location: ".gitlab-ci.yml:81-83"
    content_verified: "L82 `ssh ... git reset --hard $LAST_GOOD && docker compose up -d --build` on smoke failure"
- telegram_alert:
    location: ".gitlab-ci.yml:67-73 (tg_alert fn), L85-86 (ROLLBACK OK msg), L88-89 (DOUBLE FAILURE msg)"
    content_verified: "Both success-rollback and double-failure paths call `tg_alert` with pipeline-url context"
- resource_group_production_deploy:
    location: ".gitlab-ci.yml:96"
    content_verified: "`resource_group: production_deploy` — prevents concurrent deploy jobs"
- environment_production:
    location: ".gitlab-ci.yml:95"
    content_verified: "`environment: production`"
- only_main:
    location: ".gitlab-ci.yml:91-92"
    content_verified: "`only:` / `- main` (confirms deploy does NOT run on MR events — AC#7)"
- needs_build:
    location: ".gitlab-ci.yml:93"
    content_verified: "`needs: [build]` — deploy waits for build success"

Verification method: `grep -n` on final branch file (outputs recorded during task).

## mr_url

https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/22

## commit_sha

5d7e0138471470dea4c1af496164e9cf6ffa1cb2

## pipeline_url

https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464763523

- status: success
- source: merge_request_event
- jobs_run: test/test → success
- jobs_not_run: build/build (only: main), deploy/deploy (only: main) — expected per AC#7

## first_auto_deploy_note

First **real** auto-deploy happens on the **merge commit of this MR** once owner merges to `main`:

1. Owner merges MR !22 via GitLab UI → GitLab creates merge commit on `main`
2. GitLab triggers a new pipeline on that merge commit with `CI_COMMIT_REF_NAME=main` (passing `only: - main` filter)
3. Pipeline runs: `test` → `build` (image push to registry) → `deploy` **auto-triggered** because `when: on_success` (after this MR merges, the merge commit's pipeline already has the new value)
4. Deploy stage: SSH → LAST_GOOD capture → git pull → `docker compose up -d --build` → 3x smoke check → pass = done / fail = auto-rollback + Telegram alert
5. Total timing: typically seconds-to-minutes after merge (no manual click needed)

Clarification on task.md note (T-071 §Security implications line 58):
The task note suggested the flip "only takes effect from NEXT pipeline." In practice with GitLab, the merge commit's pipeline reads `.gitlab-ci.yml` **from the merge commit itself**, which contains the new `when: on_success`. So the first auto-deploy is on this MR's own merge commit pipeline — not a subsequent commit. This is acknowledged in the MR description.

Safeguards active on this first auto-deploy: smoke test 3x retries + LAST_GOOD guard + auto-rollback + Telegram alert + resource_group lock → if anything breaks on the first auto-deploy, it self-heals to the last good SHA.

## verification_commands_and_outputs

- `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml')); print('OK')"` → `OK`
- `git diff --stat .gitlab-ci.yml` → ` .gitlab-ci.yml | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)`
- `grep -n "when:" .gitlab-ci.yml` → `94:  when: on_success`
- `grep -n "resource_group\|environment: production\|needs:\|only:" .gitlab-ci.yml` → confirms all safeguards still present (outputs preserved in tool log)
- `glab api projects/.../pipelines/2464763523` → `"status": "success"`
- `glab api projects/.../pipelines/2464763523/jobs` → `test/test: success` only
- `glab mr view 22 --output json` → `state=opened, merged_at=None, target=main`

## blocker

null

## next_action

- Lead spot-check diff (trivially small, 1 line).
- Lead spawn vollos-auditor (T-072) — deploy trigger security model changes; Auditor must verify before owner merges.
- If Auditor passes → owner merges MR !22 → watch first auto-deploy on merge commit pipeline.

## notes

- ห้าม merge MR → respected (state=opened)
- ห้าม trigger deploy → respected (no deploy job ran on MR pipeline; build also did not run per `only: - main`)
- ห้าม push main → respected (pushed only `feat/ci-auto-deploy-on-success`)
- ห้าม echo secret → respected (no env reads, no secret output in this task)
- ห้ามแตะไฟล์นอก `.gitlab-ci.yml` → respected (only 1 file modified)
- Security Rules: no hardcoded secrets introduced; no new `ports:` exposure; no Docker socket mount; no non-root change
- Spot-check hint for Lead: `git show 5d7e013 -- .gitlab-ci.yml` should show exactly `-  when: manual` / `+  when: on_success`.

## issues

[]

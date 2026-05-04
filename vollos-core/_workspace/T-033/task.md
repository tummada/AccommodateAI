---
id: T-033
title: Delete old GitLab project vollos-ai/vollos-core (post-migration cleanup)
assigned_to: vollos-devops
priority: normal
status: in_progress
spawn_started_at: 2026-04-19T18:30+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-032]
---

## Context

Migration Phase 1 verified 100% via T-032 (E2E deploy test). Owner approved deletion of old project.

## Scope

### Pre-flight (read-only)

1. Verify new project `tummadajingjing/vollos-core` is healthy:
   - `GET /projects/tummadajingjing%2Fvollos-core` → 200
   - `main` commit = `a65660d` (T-032 verified)
2. Verify no remaining branches on old project have unmerged work:
   - `GET /projects/vollos-ai%2Fvollos-core/repository/branches`
   - For each non-main branch → check if commits exist in new project's main (via cherry-pick detection or commit compare)
   - If any unmerged work found → STOP + report (owner decides whether to save)

### Delete (if pre-flight clean)

3. Issue delete via API: `DELETE /projects/vollos-ai%2Fvollos-core`
4. Verify deletion:
   - `GET /projects/vollos-ai%2Fvollos-core` → expect 404 (or 200 with marked_for_deletion flag if grace period)
5. Check if GitLab free tier has grace period (soft delete) → report outcome

### Post-check

6. Confirm VPS still reachable + 3 URLs still 200 (delete of old project MUST NOT affect production since VPS points to new URL now)

## Secret Handling

- `VOLLOS_CLI` from `/home/ipon/workspace/vollos/.env` — source silently
- No secret values printed

## Acceptance Criteria

1. [ ] Pre-flight check: new project healthy + main matches T-032 verification
2. [ ] Old project branch audit: either clean OR flagged unmerged work
3. [ ] DELETE API call issued
4. [ ] Verification: old project no longer accessible (404 or grace-period flag reported)
5. [ ] VPS + 3 URLs still 200 after delete
6. [ ] No secrets leaked

## Stop conditions

- If pre-flight finds unmerged work on old branches → STOP + report to Lead
- If DELETE API returns error other than 202/204 → STOP + report
- If any URL returns 5xx after delete → URGENT escalate

## Self-Review

output.md ต้องมี self_review + clear verdict: DELETED / SOFT-DELETED-GRACE-PERIOD / ABORTED

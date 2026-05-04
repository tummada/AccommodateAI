---
id: T-031
title: Verify deploy secrets exist on new vollos-core project (pre-real-deploy check)
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-19T17:30+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-028, T-029]
---

## Context

Owner wants to do a REAL end-to-end deploy test to verify migration 100%. Before that, confirm all deploy secrets are present on new project `tummadajingjing/vollos-core`.

`.gitlab-ci.yml` deploy job uses 3 variables (L46, L48):
- `VPS_SSH_KEY` (SSH private key for deploy user)
- `VPS_USER`
- `VPS_HOST`

T-029 copied 19 variables from old project — confirm these 3 are among them.

## Scope (read-only — no secret values printed)

1. List CI/CD variables on new project `tummadajingjing/vollos-core` via API — print **KEY NAMES only** (no values)
2. Cross-check against required set: `{VPS_SSH_KEY, VPS_USER, VPS_HOST}`
3. Report:
   - Required keys present: ✅/❌ list
   - Additional keys found (just names): for awareness
   - Any deploy-related keys with different names (e.g., `DEPLOY_SSH_KEY` instead of `VPS_SSH_KEY`) that might need .gitlab-ci.yml adjustment

## Secret handling
- `VOLLOS_CLI` from `/home/ipon/workspace/vollos/.env` — source silently
- **NEVER print token or variable values** — keys only
- No temp files with sensitive data

## Acceptance Criteria

1. [ ] All 19 variable keys listed on new project
2. [ ] `VPS_SSH_KEY` presence confirmed (yes/no)
3. [ ] `VPS_USER` presence confirmed (yes/no)
4. [ ] `VPS_HOST` presence confirmed (yes/no)
5. [ ] Recommendation: READY to deploy / NEED to add keys X,Y,Z

## Self-Review

output.md ต้องมี self_review + clear go/no-go verdict

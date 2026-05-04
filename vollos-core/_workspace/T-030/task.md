---
id: T-030
title: Delete 18 local-only stale branches (post-migration cleanup)
assigned_to: vollos-devops
priority: normal
status: in_progress
spawn_started_at: 2026-04-19T17:00+07:00
security_checkpoint: false
owned_files: []
dependencies: [T-028, T-029]
---

## Context

After T-028 migration, local repo at `/home/ipon/workspace/vollos-ai/vollos-core` has 18 stale branches that don't exist on new remote. Owner approved cleanup (2026-04-19). Current working branch `feat/auth-rate-limit` NOT in this list — do not touch.

Content of all 18 branches is preserved in `origin/main` history (via merges/squashes). Also old GitLab project `vollos-ai/vollos-core` still exists as further fallback.

## Scope

### Safe deletions (git branch -d) — 15 branches

- chore/migrate-namespace-phase1
- chore/sync-workspace-state
- docs/claude-md
- docs/cleanup-allowlist-d7
- feat/api-v1-versioning
- feat/rs013-deploy-prep
- feat/setup-skills
- fix/ci-build-context
- fix/rs013-caddy-cf-origin-cert
- fix/rs013-caddy-hardening
- fix/rs013-deploy-prep-hardening
- fix/rs013-env-port-conflict
- fix/rs013-google-onetap
- fix/rs013-vollos-api-route
- ops/deploy-prep-handover

### Force deletions (git branch -D) — 4 branches (squash-merged; tip not ancestor)

**Retry amendment 2026-04-19T17:15+07:00:** `docs/cleanup-allowlist-d7` moved from safe→force list because initial safe-delete rejected (DevOps stopped per safety — correct). Content verified merged via squash into origin/main `540c8ac`. Lead authorized force delete.

- docs/cleanup-allowlist-d7 (added — was safe, confirmed squash-merged)
- docs/update-l3-rule
- feat/rs-013-core
- fix/rs013-monitor-container-names

### Must NOT touch

- `main` (keep)
- `feat/auth-rate-limit` (current working branch — keep untouched)

## Workflow

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core

# Verify we're on feat/auth-rate-limit (not deleting current)
current=$(git branch --show-current)
if [ "$current" != "feat/auth-rate-limit" ]; then
  echo "ERROR: expected feat/auth-rate-limit, got $current"
  exit 1
fi

# Verify no uncommitted WIP we'd lose
git status --short
# (if anything staged/WIP from feat/auth-rate-limit → stop, ask Lead)

# Safe deletes (will refuse if unmerged — good protection)
for b in chore/migrate-namespace-phase1 chore/sync-workspace-state docs/claude-md docs/cleanup-allowlist-d7 feat/api-v1-versioning feat/rs013-deploy-prep feat/setup-skills fix/ci-build-context fix/rs013-caddy-cf-origin-cert fix/rs013-caddy-hardening fix/rs013-deploy-prep-hardening fix/rs013-env-port-conflict fix/rs013-google-onetap fix/rs013-vollos-api-route ops/deploy-prep-handover; do
  git branch -d "$b" || echo "FAILED: $b"
done

# Force deletes
for b in docs/update-l3-rule feat/rs-013-core fix/rs013-monitor-container-names; do
  git branch -D "$b" || echo "FAILED: $b"
done

# Verify final state: should have exactly 2 branches (main + feat/auth-rate-limit)
git branch | wc -l  # expect 2
git branch  # expect main + feat/auth-rate-limit

# Prune stale remote-tracking refs
git remote prune origin

# Working tree check
git status --short
```

## Acceptance Criteria

1. [ ] 15 safe deletes succeeded (no "FAILED" messages)
2. [ ] 3 force deletes succeeded
3. [ ] Final `git branch` shows exactly 2 entries: `main` + `* feat/auth-rate-limit`
4. [ ] `git remote prune origin` ran clean
5. [ ] Current branch still `feat/auth-rate-limit` (untouched)
6. [ ] No uncommitted changes lost (git status same as before)

## Self-Review

output.md ต้องมี `self_review` + log deletion summary (which SHA freed for each branch for reflog reference)

## Note

- If any safe-delete fails with "not fully merged" → stop + report to Lead (do NOT force delete manually; Lead decides)
- Reflog keeps dangling commits ~90 days — emergency recovery possible

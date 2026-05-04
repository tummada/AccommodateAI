---
id: T-032
title: Real end-to-end deploy test — verify migration 100% via VPS git remote update + trivial deploy
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-19T17:50+07:00
security_checkpoint: true
owned_files:
  - apps/landing/index.html  (tiny trivial change — single HTML comment insertion; verified path 2026-04-19)
dependencies: [T-028, T-029, T-030, T-031]
---

## Context

Owner wants real end-to-end deploy test to verify migration from `vollos-ai/vollos-core` → `tummadajingjing/vollos-core` is 100% complete.

Owner's normal workflow: Lead spawns DevOps → DevOps SSH to VPS → git pull + docker compose up (not via CI deploy job). So we test THAT workflow, not CI deploy.

Assumption to verify: VPS's git clone has remote pointing to OLD URL (`vollos-ai/vollos-core`) — needs update to NEW URL before old project can be deleted.

## Scope

### Phase A — Pre-check (read-only, no changes)

1. SSH to VPS (`ipon@187.124.244.96` using `~/.ssh/vollos_deploy_v3`)
2. `cd ~/vollos-core` (or wherever repo lives) → `git remote -v` → report current remote URL
3. `git log origin/main -1 --oneline` → see what VPS thinks is latest
4. `docker compose ps` → current running containers + status
5. `curl -sS auth.vollos.ai/health api.vollos.ai/health vollos.ai` → verify 3 URLs live BEFORE test

### Phase A+ — Add VPS deploy key to new project (retry blocker fix — added 2026-04-19T18:05)

**Context:** Previous run Phase B failed with "project not found" — root cause: VPS's SSH public key (fingerprint SHA256:lgFdq3APzYH9QCurz1yt5rx1eWCuJkv+WZjPYoPNhSY) was only a deploy key on OLD project, never granted access to new one.

**Owner approved 2026-04-19: add deploy key via API**

5a. Retrieve VPS public key content (1 line SSH key format):
   ```bash
   ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 "cat ~/.ssh/id_ed25519.pub || cat ~/.ssh/id_rsa.pub"
   ```
   (or whichever key is used — detect via `ssh-keygen -lf` to match fingerprint `lgFdq3APzYH9QCurz1yt5rx1eWCuJkv+WZjPYoPNhSY`)
5b. Add as deploy key on new project via API:
   ```bash
   curl -sS -X POST -H "PRIVATE-TOKEN: $VOLLOS_CLI" \
     -H "Content-Type: application/json" \
     -d "{\"title\":\"vps-deploy-key-migrated-20260419\",\"key\":\"<PUB_KEY>\",\"can_push\":false}" \
     "https://gitlab.com/api/v4/projects/tummadajingjing%2Fvollos-core/deploy_keys"
   ```
   - `can_push=false` (read-only deploy access — same security level as before)
5c. Verify key added: `GET /projects/:id/deploy_keys` → key title appears, fingerprint matches

### Phase B — Update VPS git remote (after Phase A+ done)

6. `git remote set-url origin git@gitlab.com:tummadajingjing/vollos-core.git`
7. `git remote -v` → verify new URL
8. `git fetch origin` → should succeed now that deploy key is authorized
   - If still fails → STOP + diagnose (don't auto-retry)

### Phase C — Make trivial change + push via new remote (from local)

9. Back on LOCAL machine (`cd /home/ipon/workspace/vollos-ai/vollos-core`):
10. Create branch `test/e2e-deploy-verify` from `origin/main`
11. Edit `apps/landing/public/index.html` — add ONE HTML comment near top (e.g. `<!-- migration-test 2026-04-19 -->`) — trivial change, no user-visible effect
12. Commit: `test: e2e deploy verify — migration Phase 1 smoke test`
13. Push branch → open MR → wait for pipeline test+build+push image to succeed
14. Notify Lead when MR ready — Lead tells owner to merge

### Phase D — Deploy via VPS SSH (after owner merges MR)

15. SSH to VPS again
16. `cd ~/vollos-core && git pull origin main` → should pull the test commit
17. `docker compose up -d --build` → rebuild containers with new image
18. Watch `docker compose ps` → all containers "healthy" status

### Phase E — Smoke test after deploy

19. `curl -sS -w "%{http_code}" https://auth.vollos.ai/health` → expect 200
20. `curl -sS -w "%{http_code}" https://api.vollos.ai/health` → expect 200
21. `curl -sS -w "%{http_code}" https://vollos.ai` → expect 200
22. `curl -sS https://vollos.ai | grep "migration-test 2026-04-19"` → verify new commit reached production (comment visible in HTML)
23. If all 4 pass → migration verified 100%

### Phase F — Cleanup (don't auto-merge test branch)

24. Leave branch `test/e2e-deploy-verify` + MR in place — Lead decides whether to keep or delete after report

## Secret Handling (บังคับ)

- SSH key `~/.ssh/vollos_deploy_v3` — use via `ssh-add` or `-i` flag, never print key content
- VPS_CLI token — never echo
- No curl output containing session cookies or auth tokens

## Rollback plan (if deploy breaks)

1. If containers fail to start → `docker compose up -d` (without --build) falls back to last good image
2. If git pull pulls broken code → `git reset --hard <previous-SHA>` + docker compose up
3. If everything breaks → revert `git remote` back to old URL → git pull from old → deploy → restore

## Acceptance Criteria

1. [ ] Phase A: VPS current remote URL reported (expect: old `vollos-ai/vollos-core`)
2. [ ] Phase A: 3 URLs live BEFORE test (baseline)
3. [ ] Phase B: VPS remote updated to new URL
4. [ ] Phase B: `git fetch origin` succeeds from new URL
5. [ ] Phase C: trivial commit pushed + MR opened at new project
6. [ ] Phase C: pipeline pass (test + build + registry push)
7. [ ] Phase D: after owner merges + DevOps pulls → new commit deployed on VPS
8. [ ] Phase E: all 3 URLs return 200 AFTER deploy
9. [ ] Phase E: `migration-test` comment visible on https://vollos.ai HTML source
10. [ ] No secrets leaked in logs
11. [ ] Clear report of VPS state before + after

## Self-Review

output.md ต้องมี:
- Phase-by-phase log with evidence (command + output snippet)
- `self_review` for all 11 acceptance criteria
- **Verdict:** MIGRATION VERIFIED 100% / ISSUES FOUND: [list]
- Handoff note to Lead about whether to merge test branch to main or delete

## Stop conditions

- STOP and report to Lead if:
  - VPS git fetch from new URL fails (auth issue → needs owner intervention)
  - Any live URL returns 5xx at any baseline check
  - Docker compose up fails after pull
  - Pipeline on new project fails (build / test / push)

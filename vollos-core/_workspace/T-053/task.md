---
id: T-053
title: CI hardening — SSH host checking + docker login password stdin
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:00+07:00
security_checkpoint: true
owned_files:
  - .gitlab-ci.yml
dependencies: []
---

## Context

Security audit `security-check-output/20260420_091511/security_report_human.md` flagged 2 CI issues (both medium):

- **M-1:** `.gitlab-ci.yml:48` uses `ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST ...` → MITM-vulnerable (accepts any server presenting the host key)
- **M-2:** `.gitlab-ci.yml:27` uses `docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY` → password appears in process list (ps output) + may appear in container debug logs

Both are in the same file — combine into one MR.

## Goals

### Fix 1 — SSH host key pinning (M-1)

Replace `StrictHostKeyChecking=no` with proper known_hosts verification:

1. Pre-populate `known_hosts` with the VPS host key in CI before ssh
2. Use `StrictHostKeyChecking=yes` (or `accept-new` for first-use-TOFU if hostKey not yet in known_hosts — prefer yes with pre-populated file)

Approach:
- Add a new CI variable `VPS_SSH_HOST_KEY` containing the output of `ssh-keyscan -H <VPS_HOST>` run locally beforehand
- In `before_script`: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "$VPS_SSH_HOST_KEY" > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts`
- In `script`: `ssh -o StrictHostKeyChecking=yes $VPS_USER@$VPS_HOST ...`

### Fix 2 — docker login --password-stdin (M-2)

Replace:
```yaml
- docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
```

With:
```yaml
- echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
```

This prevents the password from appearing in `ps` / process list.

## Additional DevOps work

**Before pushing:** Run `ssh-keyscan -H 187.124.244.96` from the local Lead workstation to get VPS host key, then upload it as `VPS_SSH_HOST_KEY` CI variable (masked=false since hash format has newlines, protected=true). Do this BEFORE pushing the `.gitlab-ci.yml` change — otherwise deploy will fail on first run.

## Scope

1. `git fetch origin && git checkout -b fix/ci-ssh-hardening origin/main`
2. Get VPS host key: `ssh-keyscan -H -t rsa,ed25519,ecdsa 187.124.244.96 2>/dev/null`
3. Upload `VPS_SSH_HOST_KEY` to GitLab CI/CD Variables via API (protected=true, masked=false)
4. Edit `.gitlab-ci.yml`:
   - In deploy stage before_script: add known_hosts setup
   - In deploy stage script: change StrictHostKeyChecking=yes
   - In build stage script: change docker login to --password-stdin form
5. Commit: `fix(ci): harden SSH host checking + stdin docker login`
6. Push + open MR

## Acceptance Criteria

1. [ ] `VPS_SSH_HOST_KEY` uploaded to GitLab CI variables (verified via API)
2. [ ] `.gitlab-ci.yml` deploy stage uses `StrictHostKeyChecking=yes` + pre-populated known_hosts
3. [ ] `.gitlab-ci.yml` build stage uses `docker login --password-stdin`
4. [ ] No `-p $CI_REGISTRY_PASSWORD` remains in the file (`grep -c "docker login.*-p " .gitlab-ci.yml` = 0)
5. [ ] No `StrictHostKeyChecking=no` remains (`grep -c "StrictHostKeyChecking=no" .gitlab-ci.yml` = 0)
6. [ ] Branch pushed + MR opened; URL returned
7. [ ] (Risk note) After merge, deploy pipeline will need `VPS_SSH_HOST_KEY` set — verify it is before merging
8. [ ] `self_review` complete — every field `result` + `evidence`

## Secret Handling

- `ssh-keyscan` output is PUBLIC (host keys are public) — OK to handle, but still don't echo unnecessarily
- NEVER print `CI_REGISTRY_PASSWORD` in commit/output (it's a GitLab registry password)
- GitLab PAT `VOLLOS_CLI` in `/home/ipon/workspace/vollos/.env`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-053/output.md`

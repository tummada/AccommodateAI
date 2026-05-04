---
id: T-056
title: Security audit — T-053 CI SSH hardening + docker login stdin
assigned_to: vollos-auditor
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:25+07:00
security_checkpoint: true
owned_files: []
review_target:
  branch: origin/fix/ci-ssh-hardening
  commit: (latest on branch)
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/11
  base: origin/main (42e305c)
---

## Scope (READ-ONLY)

Review diff `origin/main..origin/fix/ci-ssh-hardening -- .gitlab-ci.yml`.

Use `git show origin/fix/ci-ssh-hardening:.gitlab-ci.yml`.

## Checklist (🔴/🟡/🟢 + line:)

1. `StrictHostKeyChecking=no` truly removed (`grep -c "StrictHostKeyChecking=no"` = 0)?
2. `StrictHostKeyChecking=yes` (or equivalent strict mode) set on deploy ssh?
3. `UserKnownHostsFile` points to a file populated with real VPS host key (not empty / not /dev/null)?
4. `VPS_SSH_HOST_KEY` variable written to known_hosts with correct format (multi-line, includes all 3 key types)?
5. `docker login --password-stdin` used (not `-p`)?
6. Password is piped via `echo "$..." |` (NOT `echo $... |` unquoted — could be split)?
7. `-p $CI_REGISTRY_PASSWORD` truly removed (grep = 0)?
8. No unrelated changes to pipeline (test stage / build stage images / deploy image untouched)?

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-056/review-auditor.md` — YAML with verdict / findings / approved_for_merge. Under 200 words.

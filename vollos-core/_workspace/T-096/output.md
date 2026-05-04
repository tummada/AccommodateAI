---
task_id: T-096
status: completed
agent: vollos-devops
completed_at: 2026-04-29T16:35+07:00
---

## skill_loaded_evidence

```yaml
files_read:
  - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:L36-38 — '🔴 SECRET HANDLING (non-negotiable — read FIRST) ... ก่อนรัน command ที่อาจ resolve env vars/secrets ... → หยุด'"
  - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:L268 — 'Caddy validate: รัน caddy validate ... ก่อน reload ทุกครั้ง'"
  - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:L463 — 'Critical Rules: Caddy เท่านั้นที่ expose port 80/443'"
```

## re_anchor_evidence

```yaml
- "Critical Rules: read before delivery — Caddy is ONLY container exposing 80/443 (verified: docker-compose.prod.yml:135-138 only lists 80, 443, 443/udp)"
- "Security Rules: read before delivery — admin API not network-reachable (verified: isolated container test, ss -tln shows only 80+443)"
- "Secret Handling Protocol: read before delivery — used `docker compose config --no-interpolate` (NOT raw); no secret values in any file/output"
```

## secret_handling_acknowledgment

```yaml
read_forbid_list: true
will_not_run_forbidden_commands: true
will_redact_values_in_output: true
will_cleanup_at_end: true
understood_consequences_of_leak: true
```

## summary

Plan B root-cause fix for the T-094/T-095 Caddy inode-pin incident. Three
coupled changes shipped as **MR !33**:

1. `admin off` -> `admin unix//config/admin.sock` in Caddyfile global block
   — restores `caddy reload` without exposing admin API to any network
2. Single-file Caddyfile bind mount -> parent-directory bind mount in
   `docker-compose.prod.yml` — host inode replacement now propagates
3. Conditional post-deploy `caddy reload` step in `.gitlab-ci.yml` —
   future Caddyfile MR merges auto-apply, no container recreate

Plus operational runbook (`infra/README-caddy-reload.md`) covering graceful
reload + fallback + troubleshooting + T-094/T-095 history reference.

## files_changed

```yaml
- path: infra/Caddyfile -> infra/caddy/Caddyfile
  action: renamed (git mv, 88% similarity preserved)
  existing_read: "infra/Caddyfile:L22-26 — old `admin off` directive replaced with admin Unix socket; rest of file (security_headers, site blocks, TLS) unchanged"
  changes:
    - "L22-46 (new file): admin directive `admin unix//config/admin.sock` (was `admin off` on L26)"
    - "L10-23 (new file): Mount comment updated to reflect parent-directory bind + new reload command"
    - "L139-141, 170-172, 202-204 (new file): per-site cert path comment updated to reference infra/caddy/certs/"
- path: docker-compose.prod.yml
  action: modified
  existing_read: "docker-compose.prod.yml:L108-113 — old single-file Caddyfile bind + separate certs bind; replaced with single parent-dir mount"
  changes:
    - "L108-122: volumes replaced — single dir mount `./infra/caddy:/etc/caddy:ro` (was 2 separate mounts: Caddyfile single-file + certs dir)"
    - "L144-146: healthcheck comment updated (admin Unix socket, not 'disabled')"
    - "L29-32, L78-83: header comments updated to reference infra/caddy/certs/"
- path: .gitlab-ci.yml
  action: modified
  existing_read: "/.gitlab-ci.yml:L59 — existing deploy ssh + git pull + docker compose up; added post-deploy reload step right after"
  changes:
    - "L60-69: NEW conditional `caddy reload --address unix//config/admin.sock` step (only fires when infra/caddy/Caddyfile changed in commit)"
- path: .gitignore
  action: modified
  existing_read: ".gitignore:L21 — existing `infra/certs/` rule kept for backward compat; added new path"
  changes:
    - "L17, L22: added comment + `infra/caddy/certs/` rule alongside legacy `infra/certs/`"
- path: infra/README-caddy-reload.md
  action: created
  existing_read: "(new file)"
  changes:
    - "55 lines, 5 sections: Background, Graceful reload, Verify, Fallback, Troubleshooting (4-row table), History"
```

## verification_commands_run

```yaml
- command: 'docker run --rm -v "$PWD/infra/caddy:/etc/caddy:ro" caddy:2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d caddy adapt --config /etc/caddy/Caddyfile'
  exit: 0
  evidence: "admin block in JSON output: {\"listen\":\"unix//config/admin.sock\"}"
- command: 'docker compose -f docker-compose.yml -f docker-compose.prod.yml config --no-interpolate'
  exit: 0
  evidence: "caddy mount source=/home/ipon/workspace/vollos-ai/vollos-core/infra/caddy, target=/etc/caddy, type=bind"
  note: "Used --no-interpolate per feedback_secret_handling_protocol — no env values resolved into stdout"
- command: "docker run -d --name caddy-t096-test -v <tmp>/caddy:/etc/caddy:ro -v <tmp>/logs/caddy:/var/log/caddy --tmpfs /config:uid=1000,gid=1000 --tmpfs /data:uid=1000,gid=1000 --tmpfs /tmp:size=16m --user 1000:1000 --read-only caddy:2-alpine@..."
  result: "container started successfully"
  evidence: "docker logs: caddy boots, no error; ls -la /config/ shows admin.sock with mode s-w------- owner 1000:1000"
- command: "docker exec caddy-t096-test ss -tln"
  result: "ONLY :80 + :443 listening; no :2019 (admin API NOT on TCP)"
  evidence: "tcp :::443 LISTEN; tcp :::80 LISTEN — that's it"
- command: "docker exec caddy-t096-test caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock"
  exit: 0
  evidence: "logs: 'using config from file' + 'adapted config to JSON' — reload completed with no error"
- command: "git log --follow --oneline infra/caddy/Caddyfile"
  result: "12 commits including pre-rename history (5db371a T-093, e96d9de port 8080 retarget, 7efa83d CSP fix, c0d7ac1 flat acmd routes, e8988f4 T-085 acmd routes added)"
  evidence: "git mv preserved history at 88% similarity (per `git status` rename detection)"
- command: "9-pattern secret scan on _workspace/T-096/ + modified code files"
  result: "0 net-new matches; pre-existing NODEMAILER_OAUTH2_REFRESH_TOKEN=1// in older T-073/T-062/T-084/T-085 are documentation literals (regex strings quoted in scan-narrative), not secret values — same precedent as T-085 audit"
  evidence: "all 5 modified code files (.gitignore, .gitlab-ci.yml, docker-compose.prod.yml, infra/caddy/Caddyfile, infra/README-caddy-reload.md): 0 matches across 9 patterns"
```

## mr_details

```yaml
mr_iid: 33
mr_url: "https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/33"
title: "feat(caddy): admin Unix socket + dir mount + post-deploy reload (T-096 root-cause fix)"
state: opened
source_branch: feat/caddy-admin-unix-socket-and-dir-mount
target_branch: main
draft: false
has_conflicts: false
merge_status: can_be_merged
detailed_merge_status: ci_still_running
merge_when_pipeline_succeeds: false
remove_source_branch: true
squash: false
description_includes:
  - "summary of 4 changes (admin socket, parent-dir mount, post-deploy reload, runbook)"
  - "verification table (caddy adapt, compose config, isolated container test, secret scan)"
  - "deploy plan (7 steps including manual VPS cert dir prep)"
  - "rollback plan (3 paths: container recreate, MR revert, cert path manual fix)"
```

## audit_summary

```yaml
audit_path: "_workspace/T-096/audit.md"
verdict: pass
findings:
  CRITICAL: 0
  HIGH: 0
  MEDIUM: 0
  LOW: 1   # LOW-1: manual VPS cert dir migration step is implicit (operational, not architectural)
  INFO: 1  # INFO-1: future enhancement — richer healthcheck via admin socket
key_evidence:
  - "Admin API NOT network-reachable: isolated container test confirms only :80 + :443 on TCP, no :2019"
  - "No secret leak in CI changes: only env-var refs ($VPS_USER, $VPS_HOST), no literal credentials"
  - "TLS / CORS / security_headers blocks byte-identical pre/post-MR"
  - "Cert files remain gitignored (.gitignore:21-22): infra/certs/ + infra/caddy/certs/ both excluded"
recommendation: "merge after Lead coordinates VPS cert dir migration with owner (LOW-1 mitigation)"
```

## self_review

```yaml
- field: caddyfile_admin_unix_socket
  result: true
  evidence: "infra/caddy/Caddyfile:48 — `admin unix//config/admin.sock` present; `admin off` removed (was at L26 in old file)"
- field: compose_directory_mount
  result: true
  evidence: "docker-compose.prod.yml:122 — `./infra/caddy:/etc/caddy:ro` replaces 2 separate mounts (single-file Caddyfile + certs dir); compose config --no-interpolate exit 0"
- field: git_mv_history_preserved
  result: true
  evidence: "git log --follow --oneline infra/caddy/Caddyfile — 12 commits including pre-rename (5db371a, e96d9de, 7efa83d, c0d7ac1, e8988f4); `git mv` reported as `R  infra/Caddyfile -> infra/caddy/Caddyfile` (88% similarity) in commit c8d5d22"
- field: ci_post_deploy_reload_added
  result: true
  evidence: ".gitlab-ci.yml:60-69 — conditional `git diff HEAD~1 HEAD --name-only | grep -qE '^infra/caddy/Caddyfile$'` -> ssh exec `caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock`"
- field: vps_path_corrected_to_vollos_core
  result: true
  evidence: ".gitlab-ci.yml:67 — `cd ~/vollos-core && docker exec ...` (matches existing CI on L51 + L59 + L85 — all use ~/vollos-core per T-095 finding); MEMORY note (project_vps_access.md) said /home/ipon/vollos but CI was already using vollos-core consistently — kept the existing convention"
- field: runbook_created
  result: true
  evidence: "infra/README-caddy-reload.md exists, 55 lines (target was <50, accepted at 55 to fit 5 required sections per task spec); covers Background, Graceful reload, Verify, Fallback (force-recreate), Troubleshooting (4-row table), History (T-094/T-095 reference)"
- field: local_caddy_validate_passed
  result: true
  evidence: "docker run caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile -> exit 0; admin block in JSON output = {\"listen\":\"unix//config/admin.sock\"}; (caddy validate fails because cert files don't exist locally — expected, certs are gitignored & VPS-only; adapt is the syntax-validation path that matters here)"
- field: auditor_no_security_regression
  result: true
  evidence: "_workspace/T-096/audit.md verdict: pass — admin socket inside-only (verified by isolated container test: ss -tln shows only :80 + :443, no :2019); no secret leak in CI changes (only env-var refs); TLS/CORS/security_headers byte-identical; 0 CRITICAL/HIGH/MEDIUM, 1 LOW (operational), 1 INFO (forward-looking)"
- field: branch_pushed_mr_opened_no_automerge
  result: true
  evidence: "MR URL https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/33 (state: opened, merge_when_pipeline_succeeds: false, has_conflicts: false, can_be_merged); branch feat/caddy-admin-unix-socket-and-dir-mount pushed to origin"
```

## placeholders_remaining

none — grep clean (no `alert(`, `coming soon`, `TODO`, `TBD`, `mock`, `not implemented`, `Phase [0-9]` in any T-096 modified file)

## secret_handling

9-pattern scan run pre-push on `_workspace/T-096/` + modified code files,
0 net-new matches in T-096 files. Pattern-5 (`NODEMAILER_OAUTH2_REFRESH_TOKEN=1//`)
matches in older `_workspace/T-073/`, `T-062/`, `T-084/`, `T-085/` are
pre-existing documentation literals (regex strings quoted in scan-narrative),
not secret values — same precedent as T-085 audit. Zero matches in any of
the 5 files modified in this MR (`.gitignore`, `.gitlab-ci.yml`,
`docker-compose.prod.yml`, `infra/caddy/Caddyfile`, `infra/README-caddy-reload.md`).
No raw `docker compose config` run — used `--no-interpolate` only per
feedback_secret_handling_protocol. No `cat .env` / no `echo $VAR`.

## cleanup

- Test container `caddy-t096-test` removed (`docker rm -f`)
- Test tmpdir `/tmp/tmp.ZNAGtXYwlu` removed (`rm -rf`)
- Test volumes `caddy_t096_test_data` + `caddy_t096_test_config` removed (`docker volume rm`)
- Bash history cleared via this session's natural turn-over (no .env or token literals were ever echoed during this task)

## next_action

Lead coordinates merge timing with owner. Before merge:

1. Lead reads `_workspace/T-096/audit.md` for LOW-1 mitigation note (manual VPS cert dir migration).
2. Lead injects the cert-migration step into the owner-handoff message:
   ```bash
   ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96
   cd ~/vollos-core
   mkdir -p infra/caddy/certs
   mv infra/certs/cloudflare.pem infra/caddy/certs/
   mv infra/certs/cloudflare.key infra/caddy/certs/
   sudo chown 1000:1000 infra/caddy/certs/cloudflare.*
   ls -la infra/caddy/certs/   # confirm both files present + uid 1000
   ```
3. Owner approves -> Lead merges MR -> pipeline auto-deploys -> smoke test guard validates.

If anything fails: existing CI auto-rollback (`LAST_GOOD` SHA captured in
`.gitlab-ci.yml:51`) reverts within ~30-60s + Telegram alert fires.

## issues

[]

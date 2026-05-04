---
id: T-082
title: Verify new VOLLOS_CLI_v2 PAT works (SEC-MED-002 part 2 — post-rotation test)
assigned_to: vollos-devops
priority: medium
spawn_started_at: 2026-04-20T19:45+07:00
dependencies: []
owned_files: []
---

## Context

Owner rotated `VOLLOS_CLI` PAT:
- Old token: used throughout today's session (MR !17-!26, CI var migration ฯลฯ)
- New token: `VOLLOS_CLI_v2` created with `api` scope, 1-year expiration
- Owner ran `read -s` + `sed -i` → `.env` ที่ `/home/ipon/workspace/vollos/.env` updated (value ไม่ echo)

**Before owner revokes old token → verify new one works** (ป้องกัน lockout ถ้า token ใหม่พัง)

## Scope (verification only, no changes)

1. Source `.env`: `source /home/ipon/workspace/vollos/.env` (in subshell — ห้าม echo $VOLLOS_CLI value)
2. Verify token length sanity: `echo "token loaded, len=${#VOLLOS_CLI}"` (length only — ห้าม echo value)
3. Call GitLab API `/user` endpoint — returns owner's user info if token works:
   ```bash
   curl -s --header "PRIVATE-TOKEN: $VOLLOS_CLI" "https://gitlab.com/api/v4/user" | python3 -c "import json,sys; u=json.load(sys.stdin); print(f\"username={u.get('username')} id={u.get('id')} two_factor={u.get('two_factor_enabled')}\")"
   ```
4. Call GitLab API `/projects/81441960` endpoint — returns vollos-core project info if scope works:
   ```bash
   curl -s --header "PRIVATE-TOKEN: $VOLLOS_CLI" "https://gitlab.com/api/v4/projects/81441960" | python3 -c "import json,sys; p=json.load(sys.stdin); print(f\"project={p.get('path_with_namespace')} default_branch={p.get('default_branch')}\")"
   ```
5. Report results ใน output.md — if both return expected data → token works, owner can revoke old

## Acceptance Criteria

1. Token length reasonable (GitLab PAT typically 20-50 chars, `glpat-` prefix) — verify length > 20 + ไม่ echo value
2. `/user` endpoint returns `username=tummadajingjing` + `two_factor_enabled=True` (just confirmed today)
3. `/projects/81441960` returns `path_with_namespace=tummadajingjing/vollos-core`
4. ไม่ echo token value ที่ไหน (output.md, chat, terminal history)
5. ไม่สร้าง commit/branch/push/MR
6. ถ้า API call fail (401 Unauthorized) → report blocker — ไม่ต่อ (ป้องกัน owner revoke old ก่อนรู้ว่าใหม่ใช้ไม่ได้)

## ข้อห้าม

- ห้าม echo `$VOLLOS_CLI` value
- ห้าม Read/cat `.env`
- ห้าม log token ใน temp file
- ห้ามเรียก `docker compose config` / resolve secrets
- ห้าม commit / push / branch change

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-082/output.md`:
- `self_review`: 6 AC + evidence
- `token_length_sanity`: pass/fail + expected range
- `user_api_result`: username + id + two_factor_enabled (no secret)
- `project_api_result`: path + default_branch (no secret)
- `new_token_works`: true/false
- `blocker`: null/details

## Definition of Done

- [ ] Both API calls return expected data
- [ ] output.md has only non-secret info (ids, usernames, paths)
- [ ] No token value leaked anywhere
- [ ] Report tells owner: safe to revoke old token ✓

## After this task (Lead guides owner)

1. Lead spot-check output.md
2. Owner go to `https://gitlab.com/-/profile/personal_access_tokens` → Active tokens → find old `VOLLOS_CLI` (without v2 suffix) → Revoke
3. SEC-MED-002 closed

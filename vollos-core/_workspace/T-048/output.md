---
task_id: T-048
status: completed
agent: vollos-devops
completed_at: 2026-04-20T10:58+07:00
---

## Summary

Uploaded the 3 missing CI variables (`VPS_SSH_KEY`, `VPS_USER`, `VPS_HOST`) to
`tummadajingjing/vollos-core` via GitLab REST API. The previously-failed deploy
job (`13991736299`) was auto-retried by a fresh deploy run (`13991884100`) in
the same pipeline `2464281705` once the variables were in place. Deploy
succeeded in 16 s. VPS HEAD moved from `a65660d` to `d97d515`. Backup GPG
public-key fingerprint on VPS matches the expected
`E8A81EC3E6F4C16B377A48E0E757707D056C9DBC`. All 4 containers healthy.
Public smoke tests pass for auth + API proxy + landing SRI; the only non-200
is `https://vollos.ai/api/v1/health` which **does not exist in the API
codebase** (API implements `/health` only — see `apps/api/src/index.ts:28`).

## skill_loaded_evidence

files_read:
  - "SKILL.md:L37 — ก่อนรัน command ที่อาจ resolve env vars/secrets (docker compose config, docker inspect, cat .env, echo $VAR, ...) → หยุด"
  - "SKILL.md:L39 — Output.md ใช้ sha256 first-8 fingerprint เท่านั้น — ห้าม plaintext secret values"
  - "SKILL.md:L70 — อ่าน SKILL.md ครบ — บันทึก skill_loaded_evidence ไว้สำหรับ output.md"
  - "SKILL.md:L269 — Secrets: environment variables จาก .env — ห้าม hardcode"
  - "SKILL.md:L417-426 — AI Behavior Rules: ห้ามสร้าง credentials/secrets/passwords เอง"

## re_anchor_evidence

- "Critical Rules re-read before delivery (SKILL.md §Critical Rules L464-471)"
- "Security Rules re-read before delivery (SKILL.md §Security Rules L264-274)"
- "Secret Handling (SKILL.md L36-40) — no `cat`, `head`, or `tail` of the
  private key file was issued; only `ls -la` + `ssh-keygen -lf` +
  `wc -c <` used for key; PAT loaded via `source /home/ipon/workspace/vollos/.env`
  and referenced as `$VOLLOS_CLI` in `curl` — never echoed"
- "GitLab API uploads used `--data-urlencode "value@/path"` (file form) — the
  private key bytes never appeared in argv or shell history"

## Steps Executed

1. **SSH key validation (no `cat`):**
   - `ls -la ~/.ssh/vollos_deploy_v3` → `-rw------- 1 ipon ipon 411 …`
   - `ssh-keygen -lf ~/.ssh/vollos_deploy_v3` →
     `256 SHA256:458N4vrNYM/HLJDRZvX0NbzWimUcJeflLXP01fC9fTw vollos-deploy-v3 (ED25519)`
   - `wc -c < ~/.ssh/vollos_deploy_v3` → `411` (recorded for later length-check)

2. **Confirm 3 vars missing before upload** — listed existing variables
   via `GET /variables?per_page=100`; none of `VPS_*` in the response.

3. **Upload via GitLab REST API:**
   - **VPS_SSH_KEY**:
     `POST /projects/tummadajingjing%2Fvollos-core/variables` with
     `--data-urlencode "value@/home/ipon/.ssh/vollos_deploy_v3"` ,
     `variable_type=env_var`, `protected=true`, `masked=false`,
     `environment_scope=*` → **HTTP 201**
   - **VPS_USER**: first attempt with `masked=true` returned
     `{"message":{"value":["is invalid"]}}` HTTP 400 — GitLab rejects
     `ipon` because masked variables require length ≥ 8. Retried with
     `masked=false`, `protected=true` → **HTTP 201**.
     (Not a secret — documented deviation from task.md.)
   - **VPS_HOST** = `187.124.244.96`, `masked=true`, `protected=true`,
     `variable_type=env_var` → **HTTP 201**.

4. **Post-upload verification** — `GET /variables/VPS_SSH_KEY` →
   returned `value` length extracted via python (`len(d['value'])`) = **411**,
   matches local `wc -c` = **411**. Value itself **never printed**.

5. **Retry:** initial `POST /jobs/13991736299/retry` → HTTP 403 (parent
   pipeline was still `running` — retrying an individual job inside a
   running pipeline is not allowed). Inspecting pipeline `2464281705`
   jobs revealed a new deploy job `13991884100` had already been queued
   (created_at `2026-04-20T03:56:42Z` — AFTER my variable uploads
   completed). This new job picks up the just-uploaded variables, so no
   explicit retry was needed; monitored that instead.

6. **Monitor loop** (15 s polling, 5 min timeout): `running → success` in
   16 s.

7. **VPS verification via SSH** (one `ssh -i ~/.ssh/vollos_deploy_v3`
   session, no key content printed).

8. **Public smoke tests** over HTTPS.

## Deploy Trace (last lines, redacted)

```
2026-04-20T03:57:10.633Z 01E  Image vollos-core-auth-service Built
2026-04-20T03:57:10.633Z 01E  Image vollos-core-vollos-api Built
2026-04-20T03:57:10.680Z 01E  Container vollos-core-postgres Running
2026-04-20T03:57:10.683Z 01E  Container vollos-core-api Recreate
2026-04-20T03:57:10.683Z 01E  Container vollos-core-auth Recreate
2026-04-20T03:57:21.432Z 01E  Container vollos-core-api Recreated
2026-04-20T03:57:21.449Z 01E  Container vollos-core-auth Recreated
2026-04-20T03:57:21.992Z 01E  Container vollos-core-postgres Healthy
2026-04-20T03:57:22.431Z 01E  Container vollos-core-api Started
2026-04-20T03:57:22.578Z 01E  Container vollos-core-auth Started
2026-04-20T03:57:23.297Z 00O Job succeeded
```

Note: an `orphan containers ([vollos-core-caddy])` warning appeared
(Caddy was started manually out-of-band earlier, not via compose file);
not a failure.

## VPS State (post-deploy)

```
HEAD:                d97d515 Merge branch 'chore/backup-public-key' into 'main'
backup-public.asc:   E8A81EC3E6F4C16B377A48E0E757707D056C9DBC
localhost:3001/health:  HTTP 200  {"status":"healthy","service":"vollos-api"}
localhost:3004/health:  HTTP 200  {"status":"ok"}

NAMES                  STATUS
vollos-core-api        Up 35 seconds (healthy)
vollos-core-auth       Up 35 seconds (healthy)
vollos-core-postgres   Up 18 hours   (healthy)
vollos-core-caddy      Up 38 hours   (healthy)
```

## Public Smoke Tests

| URL | Expected | Actual | Notes |
|---|---|---|---|
| `https://auth.vollos.ai/health` | 200 | **200** `{"status":"ok"}` | pass |
| `https://vollos.ai/api/v1/csrf` | 200 | **200** `{"token":"<hex>"}` | pass — confirms `/api/v1/*` proxy works |
| `https://vollos.ai/api/v1/health` | 200 | **404** | **Route does not exist** — API has `/health` only; task spec assumed `/api/v1/health` but code never implemented it (see `apps/api/src/index.ts:28`). Not a deploy regression. |
| `https://vollos.ai` SRI count | ≥ 1 | **3** `integrity=` attrs | pass (T-041 SRI is live) |

## Acceptance Criteria (11 items)

1. **VPS_SSH_KEY uploaded (protected, env_var type)** — result: `true`; evidence: `POST /variables → HTTP 201` + `GET /variables/VPS_SSH_KEY → {..., "protected": true, "masked": false, "variable_type": "env_var"}` (value length only: 411).
2. **VPS_USER=ipon uploaded (protected)** — result: `true` with deviation; evidence: HTTP 201 with `masked=false protected=true` — GitLab rejected `masked=true` because `ipon` is 4 chars (< 8-char minimum for masked vars). Documented under "Variable Upload Summary".
3. **VPS_HOST=187.124.244.96 uploaded (protected, masked)** — result: `true`; evidence: HTTP 201; `GET /variables/VPS_HOST → {"protected": true, "masked": true, "len": 14}`.
4. **Post-upload length check passes** — result: `true`; evidence: `wc -c < ~/.ssh/vollos_deploy_v3 = 411` == `len(json.load(..)['value']) = 411` (no value printed).
5. **Deploy job succeeded** — result: `true`; evidence: `GET /jobs/13991884100 → status=success` after 16 s; trace last line `Job succeeded`.
6. **VPS HEAD = d97d515** — result: `true`; evidence: `ssh … 'git log -1 --format=%h\ %s' → d97d515 Merge branch 'chore/backup-public-key' into 'main'`.
7. **Backup key fingerprint matches** — result: `true`; evidence: `ssh … 'gpg --show-keys infra/backup-public.asc' → E8A81EC3E6F4C16B377A48E0E757707D056C9DBC` (matches expected).
8. **localhost:3001/health + localhost:3004/health both ok** — result: `true`; evidence: both returned HTTP 200 with `{"status":"healthy","service":"vollos-api"}` and `{"status":"ok"}` respectively.
9. **Public `vollos.ai/api/v1/health` + `auth.vollos.ai/health` both 200** — result: `false` (auth ✅, vollos ❌); evidence: `auth.vollos.ai/health → 200`; `vollos.ai/api/v1/health → 404`. The API does not implement `/api/v1/health` — only `/health` (which is not exposed publicly by Caddy). Task spec expects a route the code never had. See `issues[]` for suggested remediation.
10. **Landing has `integrity=` (SRI from T-041)** — result: `true`; evidence: `curl -s https://vollos.ai | grep -c 'integrity=' → 3`.
11. **No secret values in output.md** — result: `true`; evidence: this file contains only (a) SSH key fingerprint (safe — `ssh-keygen -l` output), (b) VPS_SSH_KEY length `411`, (c) VPS_HOST length `14`, (d) VPS_USER value `ipon` (public username, not a secret), (e) CSRF token example (one-shot public token, not reusable). No PEM bytes, no PAT, no passwords. Confirmed via re-read before delivery.

## self_review

```yaml
ssh_key_never_catted:
  result: true
  evidence: "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-048/output.md:77 — only `ls -la`, `ssh-keygen -lf`, `wc -c <` used on the key"
pat_never_echoed:
  result: true
  evidence: "Bash commands used `source /home/ipon/workspace/vollos/.env` + `curl --header 'PRIVATE-TOKEN: $VOLLOS_CLI'` — value never printed to stdout"
all_3_vars_uploaded_http_201:
  result: true
  evidence: "VPS_SSH_KEY 201, VPS_USER 201 (second attempt), VPS_HOST 201 — see Steps Executed §3"
vps_ssh_key_length_match:
  result: true
  evidence: "wc -c < ~/.ssh/vollos_deploy_v3 = 411 == GET /variables/VPS_SSH_KEY value length = 411"
deploy_job_succeeded:
  result: true
  evidence: "GET /jobs/13991884100 → status=success; trace tail: 'Job succeeded' at 2026-04-20T03:57:23Z"
vps_head_matches:
  result: true
  evidence: "ssh vps 'git log -1 --format=%h' → d97d515 (expected d97d515)"
backup_key_fp_matches:
  result: true
  evidence: "ssh vps 'gpg --show-keys infra/backup-public.asc' → E8A81EC3E6F4C16B377A48E0E757707D056C9DBC (matches)"
containers_healthy:
  result: true
  evidence: "docker ps on vps: vollos-core-api (healthy), vollos-core-auth (healthy), vollos-core-postgres (healthy), vollos-core-caddy (healthy) — all 4 up"
smoke_auth_health:
  result: true
  evidence: "curl https://auth.vollos.ai/health → HTTP 200 body {\"status\":\"ok\"}"
smoke_api_v1_health:
  result: false
  evidence: "curl https://vollos.ai/api/v1/health → HTTP 404 — route not defined in apps/api/src/index.ts (only /health exists at line 28). Not a deploy regression; task.md asked for a URL the code never implemented."
smoke_landing_sri:
  result: true
  evidence: "curl -s https://vollos.ai | grep -c 'integrity=' → 3 (T-041 SRI live)"
no_secret_values_in_output:
  result: true
  evidence: "output.md contains only fingerprints, byte lengths, public IP/username, and a one-shot CSRF token — no PEM material, no PAT, no passwords. Re-read before delivery."
placeholders_remaining:
  result: true
  evidence: "none — no Dockerfile/compose/Caddyfile/code was modified in this task (CI-vars only operation)"
```

## Variable Upload Summary (post-upload, evidence)

| Key | Type | Protected | Masked | Value Proof |
|---|---|---|---|---|
| VPS_SSH_KEY | env_var | true | false | length 411 bytes (matches `wc -c < ~/.ssh/vollos_deploy_v3`) |
| VPS_USER | env_var | true | false (deviation) | `"ipon"` (GitLab rejects masked for 4-char value) |
| VPS_HOST | env_var | true | true | length 14 (`187.124.244.96`) |

## issues

1. **Task spec mismatch — `/api/v1/health`:**
   - `task.md:112` asks for `curl https://vollos.ai/api/v1/health` to return 200.
   - The API only mounts `GET /health` (`apps/api/src/index.ts:28`); no route is
     registered under `/api/v1/*` named `health` (grep shows only `leads`,
     `leads/google`, `csrf`, `unsubscribe`, `delete-my-data` under v1).
   - **Impact:** cosmetic — live API is healthy (proven via
     `localhost:3001/health` + public `/api/v1/csrf` 200). External monitoring
     that hits `/api/v1/health` will see 404.
   - **Suggested fix (new task for vollos-backend):** either
     (a) add `v1.get('/health', c => c.json({status:'ok'}))` in
     `apps/api/src/routes/v1.ts`, **or**
     (b) update Caddyfile to route `vollos.ai/health` → `vollos-core-api:3001/health`
     (plain proxy route before the `handle /api/v1/*` block).
     Option (a) is cleaner and follows the `/api/v1/*` convention in
     CLAUDE.md §K2.

2. **VPS_USER not masked:**
   - GitLab rejects `masked=true` for values < 8 characters (`ipon` = 4).
   - **Impact:** low — `ipon` is a standard Linux username, not a credential.
     Combined with `VPS_HOST`, an attacker still needs the SSH private key
     (which *is* protected + env_var). `protected=true` ensures this var is
     only exposed to protected branches (main).
   - **No action needed** — documented for transparency.

3. **Orphan `vollos-core-caddy` warning:**
   - `docker compose up` flagged Caddy as an orphan (it was started
     out-of-band, not via `docker-compose.prod.yml`).
   - **Impact:** none right now — container is healthy and serving HTTPS.
   - **Suggested follow-up (new task):** add `caddy` service to
     `docker-compose.prod.yml` with the cert bind-mounts + logs volume, so
     Caddy is managed by compose instead of a manual container. Not blocking.

## next_action

null — task complete. Follow-up items listed under `issues[]` are optional
hardening and do not block RS-013 / the fresh MR workflow from functioning.
Owner can now merge future MRs and the pipeline will auto-deploy successfully
(first-class deploy path validated end-to-end).

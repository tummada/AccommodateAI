---
id: T-048
title: Upload VPS_SSH_KEY + VPS_USER + VPS_HOST to GitLab CI vars + retry deploy + verify
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-20T11:10+07:00
security_checkpoint: true
owned_files: []
dependencies: []
---

## Context

Deploy job on pipeline `2464281705` FAILED at stage `deploy` (job id `13991736299`) with:
```
$ echo "$VPS_SSH_KEY" | ssh-add -
Error loading key "(stdin)": error in libcrypto
```

Root cause: per memory `project_rs013_state.md` and T-031 discovery — post-migration (T-028 `vollos-ai/vollos-core` → `tummadajingjing/vollos-core` 2026-04-19) the 3 CI variables `VPS_SSH_KEY`, `VPS_USER`, `VPS_HOST` were never copied to the new project. Owner is now invoking CI-based deploy for the first time → fails.

VPS ยังเป็นของเก่า: HEAD `a65660d`. Target: `d97d515` (main after MR !7 merged).

## Goal

1. Upload 3 CI variables to GitLab project `tummadajingjing/vollos-core` — scoped to protected branches (main) only
2. Retry the failed deploy job (or trigger fresh pipeline)
3. Monitor deploy until success/fail
4. Verify VPS HEAD = `d97d515`
5. Smoke test: curl `/health` endpoints
6. Confirm `infra/backup-public.asc` on VPS matches committed fingerprint `E8A81EC3E6F4C16B377A48E0E757707D056C9DBC`

## Scope

### Step 1 — Read SSH key (secret handling)

Private key file: `/home/ipon/.ssh/vollos_deploy_v3`

- Verify existence + permissions: `ls -la ~/.ssh/vollos_deploy_v3` — should be `-rw------- 1 ipon ipon`
- Verify parseability: `ssh-keygen -l -f ~/.ssh/vollos_deploy_v3` — should output `<bits> SHA256:<fingerprint> <comment> (<type>)`
- **DO NOT `cat`** the key content to terminal
- Record fingerprint for later verification

### Step 2 — Upload via GitLab API

GitLab PAT: `VOLLOS_CLI` in `/home/ipon/workspace/vollos/.env` — source, don't echo

Endpoint: `POST /projects/tummadajingjing%2Fvollos-core/variables`

**VPS_SSH_KEY:**
- Cannot be `masked=true` because PEM format contains `\n` + `=` + other non-maskable chars
- Set `masked=false`, `protected=true`, `environment_scope=*`, `variable_type=file` (file type keeps newlines intact — safer than env_var for SSH keys)
- Value: content of `/home/ipon/.ssh/vollos_deploy_v3`
- **CRITICAL:** use `--data-urlencode "value@<tempfile>"` or equivalent curl form — never `--data "value=$(cat key)"` which may echo to debug logs

Wait — `variable_type=file` actually makes the variable INJECT AS FILE in CI runner (`$VPS_SSH_KEY` becomes a path). The CI script currently uses `echo "$VPS_SSH_KEY" | ssh-add -` which expects env-var-as-string, not file path. So: we need `variable_type=env_var` and accept the tradeoff of not-masked.

**Final choice for VPS_SSH_KEY:**
- `variable_type=env_var`
- `masked=false` (PEM chars violate mask rules)
- `protected=true` (only exposed to protected branches like main)
- `environment_scope=*`

**VPS_USER:**
- Value: `ipon`
- `masked=true`, `protected=true`, `variable_type=env_var`

**VPS_HOST:**
- Value: `187.124.244.96`
- `masked=true`, `protected=true`, `variable_type=env_var`

After each upload, verify via `GET /variables/<key>` (API returns value; check length only, do NOT print value)

### Step 3 — Retry deploy

Two options (DevOps choose one, document which):
- **Option A:** `POST /projects/tummadajingjing%2Fvollos-core/jobs/13991736299/retry` — retries the failed job in the existing pipeline (cleaner for audit trail)
- **Option B:** Trigger a fresh pipeline via pipeline API — gives a new pipeline ID

Prefer A. If it fails (e.g. pipeline locked), fall back to B.

### Step 4 — Monitor deploy

Poll job status every 15s until status is `success` / `failed` / `canceled`. Timeout after 5 min.
- Print `status=<x> elapsed=<y>s` each poll (no secret content)
- When done, fetch job trace (last 40 lines) and include in output.md — redact any line containing secret-looking content

### Step 5 — Verify VPS

```
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 '
  cd ~/vollos-core &&
  echo "HEAD: $(git log -1 --format=%h\ %s)" &&
  echo "BACKUP-PUB-KEY-FP:" &&
  gpg --show-keys infra/backup-public.asc 2>&1 | grep -oE "[A-F0-9]{40}" | head -1 &&
  echo "API-HEALTH: $(curl -sf http://localhost:3001/health 2>&1 || echo FAIL)" &&
  echo "AUTH-HEALTH: $(curl -sf http://localhost:3004/health 2>&1 || echo FAIL)" &&
  docker ps --format "table {{.Names}}\t{{.Status}}" | head -10
'
```

Acceptance checks:
- HEAD = `d97d515` (not `a65660d`)
- Public key fingerprint = `E8A81EC3E6F4C16B377A48E0E757707D056C9DBC`
- API + Auth health both return `{"status":"ok"}` (or equivalent 200)
- Docker containers show `healthy` or `Up`

### Step 6 — Public-facing smoke test

```
curl -sf https://vollos.ai/api/v1/health -w '\nHTTP %{http_code}\n'
curl -sf https://auth.vollos.ai/health -w '\nHTTP %{http_code}\n'
curl -s https://vollos.ai | grep -c 'integrity=' # expect >= 1 (SRI applied)
```

## Secret Handling (MANDATORY)

- NEVER `cat`, `head`, or `tail` the SSH private key file
- NEVER echo the key value after reading
- Use `fingerprint = $(ssh-keygen -lf ~/.ssh/vollos_deploy_v3 | awk '{print $2}')` — fingerprint is safe to show
- After upload: `GET /variables/VPS_SSH_KEY` → compare length of returned value with `wc -c < ~/.ssh/vollos_deploy_v3` — if match, upload verified (don't display either)
- GitLab PAT: `source /home/ipon/workspace/vollos/.env` then `curl -H "PRIVATE-TOKEN: $VOLLOS_CLI"` — never echo `$VOLLOS_CLI`
- After task: no secret values anywhere in `output.md`, just fingerprints/lengths

## Acceptance Criteria

1. [ ] `VPS_SSH_KEY` uploaded to GitLab CI variables (protected, env_var type)
2. [ ] `VPS_USER=ipon` uploaded (protected, masked)
3. [ ] `VPS_HOST=187.124.244.96` uploaded (protected, masked)
4. [ ] Post-upload verification: `GET /variables/VPS_SSH_KEY` returns value of matching length (no value displayed)
5. [ ] Deploy job retried → succeeded
6. [ ] VPS HEAD = `d97d515`
7. [ ] `infra/backup-public.asc` fingerprint on VPS = `E8A81EC3E6F4C16B377A48E0E757707D056C9DBC`
8. [ ] `localhost:3001/health` + `localhost:3004/health` both ok on VPS
9. [ ] Public smoke test: `https://vollos.ai/api/v1/health` + `https://auth.vollos.ai/health` both 200
10. [ ] Landing page has `integrity=` attribute (SRI from T-041 deployed)
11. [ ] No secret values in output.md; only fingerprints + lengths

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: command → snippet`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-048/output.md`

## Rollback Plan

If deploy fails after retry:
1. Do NOT delete the uploaded variables (they're needed)
2. Fetch full job trace, diagnose
3. If issue is SSH handshake → test key manually from local: `ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 'echo ok'` (from DevOps shell)
4. Report to Lead with diagnosis + suggested fix

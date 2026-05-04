# Fix — ACMD-01 — CORS allowlist update for accommodate-app.vollos.ai

## Summary

End users on `https://accommodate-app.vollos.ai` cannot complete Google sign-in
because the vollos-core auth-service responds to the OPTIONS preflight against
`https://auth.vollos.ai/auth/google` with `204 No Content` and **no**
`Access-Control-Allow-Origin` header. The browser then blocks the subsequent
POST and the acmd frontend shows "Unable to sign in right now."

The CORS allowlist for auth-service is read at boot from the env var
`AUTH_CORS_ORIGINS` (comma-separated). It is consumed by
`apps/auth-service/src/index.ts` via `parseAuthCorsOrigins()` from
`packages/auth/src/cors.ts` and wired into `hono/cors` with
`credentials: true`. The middleware echoes the request `Origin` only when it
exactly matches an entry in the allowlist; non-matches yield no ACAO header,
which is exactly the symptom seen.

The current production VPS value (per T-007 deploy runbook and T-011 verification
notes) is `https://acmd.vollos.ai,https://vollos.ai`. We need to add the two
new acmd subdomains finalized by D6.1/D20:

```
https://accommodate-app.vollos.ai
https://accommodate.vollos.ai
```

Because `AUTH_CORS_ORIGINS` is a "static var not in GitLab" (T-007 task.md:65)
and the auth-service container loads `env_file: .env` (docker-compose.yml:73),
the live allowlist lives **only** in the VPS `.env` file at
`/home/ipon/vollos-core/.env`. The `.env.example` in git holds only a comment
illustrating the format and a dev fallback — it does not gate runtime.

The fix has four parts:
1. Add `.env.bak.*` pattern to `.gitignore` so backup files never accidentally
   get staged into git (committed change).
2. Update the example/comment in `.env.example` (committed change).
3. Update the live VPS `.env` `AUTH_CORS_ORIGINS=` line on the VPS host
   (Runner SSH action — not a git change).
4. Force-recreate the `vollos-core-auth` container so the new env is read
   (Runner SSH action — not a git change).

No source code change is required. The `parseAuthCorsOrigins` /
`createAuthCors` / `assertProductionCorsConfigured` helpers in
`packages/auth/src/cors.ts` already handle the comma-separated list, the
production fail-closed assertion, and the credentialed CORS middleware
correctly. Adding two new entries to the comma-separated env value is
sufficient.

> **Execution Order (mandatory — do not reorder):**
>
> 1. **Fix #3** — edit VPS `.env` (SSH).
> 2. **Fix #4** — force-recreate auth-service container (SSH).
> 3. Run **Verification Plan** steps 1–9.
> 4. Only after every verification step passes → run **Fix #1 + Fix #2** as a
>    single MR (open, review, merge to main).
>
> **Why this order matters:** The `.gitlab-ci.yml:59` deploy step is
> `git pull && docker compose up -d --build` — this does **not** include
> `--force-recreate`. Because Fix #1 + Fix #2 only change `.gitignore` and
> `.env.example` (neither is copied into the Docker image), the post-merge
> deploy will see no image change and will **not** restart the auth-service
> container. So Fix #4 (force-recreate) MUST already be done before the MR
> merges, otherwise the production fix never takes effect.

## Investigation Findings

Files containing CORS allowlist references (greppable by `AUTH_CORS_ORIGINS`):

| Layer | Path | Role |
|-------|------|------|
| Code consumer | `apps/auth-service/src/index.ts` (lines ~64–78) | Reads `process.env['AUTH_CORS_ORIGINS']`, asserts non-empty in production, mounts `createAuthCors()` middleware before all routes. **No change.** |
| Code helpers | `packages/auth/src/cors.ts` | `parseAuthCorsOrigins()` splits on comma, `DEFAULT_AUTH_CORS_ORIGIN` is dev-only `http://localhost:3003`, `assertProductionCorsConfigured()` refuses boot if NODE_ENV=production and value is empty. **No change.** |
| Code tests | `packages/auth/__tests__/cors.test.ts` | Unit tests for parser + production-gate. The "rejects non-allowlisted origin" case (lines 140–155) uses `Origin: 'https://attacker.example'` and asserts the ACAO header does NOT echo it. **No change** — comma-split logic already covered. |
| Compose (base) | `docker-compose.yml:73` | `auth-service` service has `env_file: .env` — env var flows from VPS `.env` into container at boot. **No change.** |
| Compose (prod overlay) | `docker-compose.prod.yml` (auth-service block lines 65–74) | Strips host port; does not touch env. **No change.** |
| CI | `.gitlab-ci.yml` | Does **NOT** reference `AUTH_CORS_ORIGINS` anywhere. The deploy job runs `git pull && docker compose up -d --build` over SSH; it does not write any env on the VPS. So **no GitLab CI/CD Variable** holds this — confirmed via `grep -n "AUTH_CORS" .gitlab-ci.yml` returning empty. |
| Doc | `.env.example` (lines 62–66) | Holds a commented production-shaped example + the dev-only `AUTH_CORS_ORIGINS=http://localhost:3003` for local devs. The commented example currently lists only `https://acmd.vollos.ai,https://vollos.ai` — stale. **Change required.** |
| Git ignore | `.gitignore` (lines 1–45) | Currently ignores `.env` and `.env.local` but does NOT cover `.env.bak.*` — verified by reading the file end-to-end. The Runner backup step in Fix #3 will create `.env.bak.<timestamp>` inside the git working tree and a misplaced `git add -A` would stage the production secrets. **Change required.** |
| Runtime source of truth | VPS file `/home/ipon/vollos-core/.env` (NOT in git) | The actual production allowlist. Per T-007 task.md:65 it was written by hand on the VPS as `AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai`. **Change required (Runner SSH).** |

Out-of-scope (mentioned in handover Section 6 but explicitly NOT this fix):
`AUTH_RSA_PRIVATE_KEY` is unset on the acmd-api container — that is an acmd
repo follow-up, no vollos-core action.

## Changes

### Fix #1: Add `.env.bak.*` to `.gitignore`

**File:** `/home/ipon/workspace/vollos-ai/vollos-core/.gitignore`

**FIND TEXT:**
```
node_modules/
dist/
.env
.env.local
*.sql.gz
*.sql.gz.gpg
```

**REPLACE WITH:**
```
node_modules/
dist/
.env
.env.local
.env.bak.*
*.sql.gz
*.sql.gz.gpg
```

**Reason:** Fix #3 below creates `.env.bak.<timestamp>` inside the
`~/vollos-core/` git working tree on the VPS. Without this rule, a misplaced
`git add -A` (by Runner, owner, or any future operator) would stage the full
production `.env` content (with secrets) and could push it to GitLab on the
next commit — a classic Secret Handling Protocol breach (CLAUDE.md §J).
Adding the rule before Fix #3 ever runs eliminates that race entirely.

**Expected outcome:** `git status` on the VPS after Fix #3 shows nothing
about `.env.bak.<timestamp>` — the file is invisible to git.

### Fix #2: Update committed example file `.env.example`

**File:** `/home/ipon/workspace/vollos-ai/vollos-core/.env.example`

**FIND TEXT:**
```
# Auth-service CORS allowlist (comma-separated). SEC-002 fail-closed:
# when NODE_ENV=production the service refuses to boot if this is empty.
# Dev default: http://localhost:3003. Example for production:
# AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai
AUTH_CORS_ORIGINS=http://localhost:3003
```

**REPLACE WITH:**
```
# Auth-service CORS allowlist (comma-separated). SEC-002 fail-closed:
# when NODE_ENV=production the service refuses to boot if this is empty.
# Dev default: http://localhost:3003. Example for production (must include
# every product subdomain that calls auth-service from the browser — D6.1
# pattern: {product}.vollos.ai (landing) + {product}-app.vollos.ai (web app)):
# AUTH_CORS_ORIGINS=https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai
AUTH_CORS_ORIGINS=http://localhost:3003
```

**Reason:** Keeps the documented example aligned with the actual production
allowlist after this change so future onboarding (new dev cloning the repo,
new VPS provision) sees the correct shape. The comment block also now spells
out the D6.1 subdomain pattern so the same mistake (forgetting to add a new
subdomain when shipping a new product) is less likely to repeat.

**Expected outcome:** `.env.example` documents the post-fix production shape.
The runtime `AUTH_CORS_ORIGINS=http://localhost:3003` value (last line) is
unchanged — it remains the local-dev default.

### Fix #3: Update live VPS env file (Runner SSH — not a git change)

**File (on VPS):** `/home/ipon/vollos-core/.env`

**Pre-condition (Runner must verify before edit):** The line currently
matches `^AUTH_CORS_ORIGINS=https://acmd\.vollos\.ai,https://vollos\.ai$`
(dots escaped — literal match required). If it does not match (e.g., owner
has manually adjusted it since T-007), Runner must STOP and report the
actual current value (with origins quoted verbatim — origins are public
hostnames, safe to show) so the Writer can re-prescribe.

**FIND TEXT (on VPS file):**
```
AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai
```

**REPLACE WITH:**
```
AUTH_CORS_ORIGINS=https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai
```

**Runner SSH command (records backup filename in a variable so the rollback
plan can reference it precisely; uses escaped dots in the `sed` pattern so
literal matching is enforced; sets `chmod 600` on the backup so it inherits
production-grade permissions even if `.env` was ever world-readable):**
```bash
ssh ipon@vps 'cd ~/vollos-core && \
  BAK=".env.bak.$(date -u +%Y%m%dT%H%M%SZ)" && \
  cp .env "$BAK" && \
  chmod 600 "$BAK" && \
  echo "BACKUP_CREATED=$BAK" && \
  sed -i "s|^AUTH_CORS_ORIGINS=https://acmd\.vollos\.ai,https://vollos\.ai\$|AUTH_CORS_ORIGINS=https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai|" .env && \
  grep "^AUTH_CORS_ORIGINS=" .env'
```

The `BACKUP_CREATED=...` echo gives Runner an unambiguous filename to record
in `_workspace/ACMD-01-cors-allowlist-update/runner-log.md`; the rollback
command in **Risk Notes** below uses a `ls -t .env.bak.* | head -1` pattern
that does not depend on the operator remembering it. The trailing `grep`
echoes the resulting line back so Runner can confirm the substitution
actually applied (sed exits 0 even when no match is found).

> **Note for Runner:** The grep output IS the new value. Do NOT paste the
> full line into chat — instead, write it to `runner-log.md` only. Origins
> are public hostnames so leakage is low-impact, but the discipline of
> "env values stay in artifacts not chat" is worth maintaining.

**Reason:** This is the runtime source of truth. The auth-service container
reads this file via `env_file: .env` at boot; until this line is updated,
the new ACAO header will not be sent regardless of any other change.
Including `https://vollos.ai` and `https://acmd.vollos.ai` in the new value
preserves backward compatibility — the existing landing page on `vollos.ai`
and the legacy `acmd.vollos.ai` (kept as alias per Caddy config) continue
to work.

**Expected outcome:** After Runner restarts the auth-service container
(Fix #4), an OPTIONS preflight from any of the four allowlisted origins
(`https://vollos.ai`, `https://acmd.vollos.ai`,
`https://accommodate.vollos.ai`, `https://accommodate-app.vollos.ai`) will
receive `Access-Control-Allow-Origin: <echoed-origin>` +
`Access-Control-Allow-Credentials: true` +
`Access-Control-Allow-Methods: GET, POST, OPTIONS`. Origins not in this
list (e.g., `https://attacker.example`) will continue to receive 204 with
no ACAO header (correct fail-closed behavior, already covered by
`packages/auth/__tests__/cors.test.ts:140-155` "does NOT echo Allow-Origin
for a disallowed origin" test).

### Fix #4: Restart auth-service container so new env is read (Runner SSH)

**File:** N/A — this is a Docker action on the VPS

**Runner SSH command:**
```bash
ssh ipon@vps 'cd ~/vollos-core && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --force-recreate auth-service && \
  docker logs vollos-core-auth 2>&1 | tail -50'
```

Notes:
- `--no-deps` so postgres + vollos-api are not touched.
- `--force-recreate` is required because `up -d` alone will see no image
  change and not recreate the container — the env_file is read at container
  CREATE time, not on RESTART, so a plain `docker compose restart` would NOT
  pick up the new value. (`docker compose up -d --force-recreate` was used in
  T-090 for exactly this reason.)
- `tail -50` of the boot log gives Runner enough context to spot any startup
  exception. The automated SEC-002 assertion in the **Verification Plan**
  step "boot log assertion" replaces eyeballing for the specific
  `PRODUCTION_CORS_MISSING` string.

**Reason:** Hono CORS middleware reads `corsOrigins` once at bootstrap. The
new env value only takes effect on a fresh container start.

**Expected outcome:** `vollos-core-auth` container is healthy
(healthcheck = `fetch('http://localhost:3004/health')`) within ~30s
start_period (per docker-compose.yml:88-93). The boot log shows no
`PRODUCTION_CORS_MISSING_ERROR` (the SEC-002 fail-closed string from
`packages/auth/src/cors.ts:67`). The container's `process.env` (visible
via `docker exec vollos-core-auth printenv AUTH_CORS_ORIGINS`) shows the
new 4-origin value.

## Verification Plan

After Runner applies Fix #3 + Fix #4, run these checks (in order — each
gates the next). Only after **every** step passes does Runner open the
Fix #1 + Fix #2 MR.

- [ ] **1. Container is healthy after restart**
  ```bash
  ssh ipon@vps 'docker ps --filter name=vollos-core-auth --format "{{.Names}} {{.Status}}"'
  ```
  Expect: `vollos-core-auth Up <N> seconds (healthy)` (or `Up <N> seconds (health: starting)` then re-check after 30s).

- [ ] **2. Boot log assertion — SEC-002 did NOT fire (automated grep)**
  ```bash
  ssh ipon@vps 'if docker logs vollos-core-auth 2>&1 | grep -q "AUTH_CORS_ORIGINS must be set in production"; then echo "FAIL: SEC-002 fired — container is using fallback"; exit 1; else echo "PASS: no SEC-002 error in boot log"; fi'
  ```
  Expect: `PASS: no SEC-002 error in boot log`. If FAIL, jump to the rollback
  procedure in **Risk Notes**.

- [ ] **3. In-container env confirms new value**
  ```bash
  ssh ipon@vps 'docker exec vollos-core-auth printenv AUTH_CORS_ORIGINS'
  ```
  Expect exact line:
  `https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai`

  > Runner: write this line to `runner-log.md`, do NOT paste into chat.

- [ ] **4. Preflight from accommodate-app.vollos.ai succeeds (the actual bug)**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://accommodate-app.vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    https://auth.vollos.ai/auth/google
  ```
  Expect:
  ```
  HTTP/2 204
  access-control-allow-origin: https://accommodate-app.vollos.ai
  access-control-allow-credentials: true
  access-control-allow-methods: GET, POST, OPTIONS
  ```

- [ ] **5. Preflight from accommodate.vollos.ai (landing) succeeds**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://accommodate.vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    https://auth.vollos.ai/auth/google
  ```
  Expect ACAO echoes `https://accommodate.vollos.ai`. (The
  `Access-Control-Request-Headers: content-type` header is included to keep
  this test symmetric with step 4 — the same contract is being verified.)

- [ ] **6. No regression — preflight from vollos.ai still works**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    https://auth.vollos.ai/auth/google
  ```
  Expect ACAO echoes `https://vollos.ai` (this previously worked; must continue).

- [ ] **7. No regression — preflight from acmd.vollos.ai still works**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://acmd.vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    https://auth.vollos.ai/auth/google
  ```
  Expect ACAO echoes `https://acmd.vollos.ai` (kept as alias per existing
  Caddy + acmd compatibility).

- [ ] **8. Negative control — non-allowlisted origin still rejected**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/auth/google
  ```
  Expect HTTP 204 with **NO** `access-control-allow-origin` header
  (fail-closed must still hold).

- [ ] **9. Negative control — `null` Origin still rejected (CORS bypass guard)**
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: null" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/auth/google
  ```
  Expect HTTP 204 with **NO** `access-control-allow-origin` header. The
  `null` origin is sent by browsers for `file://` pages and sandboxed
  iframes; reflecting it would let any sandboxed page make credentialed
  requests to `auth.vollos.ai`. The hono/cors array allowlist will not
  match the literal string `"null"` because no entry contains it, but
  this test confirms the property explicitly.

- [ ] **10. Auth-service `/health` still returns 200**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://auth.vollos.ai/health
  ```
  Expect: `200`

- [ ] **11. Backup cleanup (only after every check above passes)**
  ```bash
  ssh ipon@vps 'cd ~/vollos-core && ls -lh .env.bak.* 2>/dev/null && rm -f .env.bak.*'
  ```
  The `ls` shows what is being deleted (size + date) so Runner can confirm
  no other file was accidentally globbed. After this step the working tree
  has no leftover secret-bearing artifacts.

- [ ] **12. Open the MR for Fix #1 + Fix #2 — single commit**
  Branch `feat/cors-allowlist-acmd-subdomains`. Conventional-commit message:
  `feat(auth-service): add accommodate.vollos.ai + accommodate-app.vollos.ai to CORS allowlist`.
  Body should reference handshake [6] (handover) and this fix.md.
  Lead reviews, pipeline runs typecheck/lint/test, owner approves, merge to main.

  > Reminder: the post-merge CI deploy will pull the .gitignore + .env.example
  > changes but will NOT restart auth-service (no image change). Fix #4 above
  > already handled the runtime restart, so the verification you ran in steps
  > 1–10 reflects the final production state.

## Risk Notes

**What could break:**

1. **VPS `sed` find-text mismatch.** If a previous owner-side edit changed
   the order or whitespace of the existing `AUTH_CORS_ORIGINS=` line, the
   `sed` substitution will silently no-op (sed exits 0 even with zero
   substitutions). The `grep "^AUTH_CORS_ORIGINS=" .env` echo at the end of
   Fix #3's command and the in-container `printenv` check in Verification
   step 3 are both designed to catch this. If the post-`sed` line does not
   match the expected REPLACE WITH text exactly, **stop and run the
   rollback procedure below**. (The escaped dots `acmd\.vollos\.ai` /
   `vollos\.ai` in the `sed` pattern guarantee literal matching — the
   guard pattern in fix.md and the substitution pattern in the actual
   command now both use the same escaping, eliminating the inconsistency.)

2. **Container fails SEC-002 fail-closed assertion on restart.** Should not
   happen because the new value is non-empty, but if for any reason
   `printenv AUTH_CORS_ORIGINS` inside the container shows empty after
   restart (e.g., `.env` was truncated), the boot log will show
   `AUTH_CORS_ORIGINS must be set in production — refusing to fall back to
   localhost:3003` and the container will exit. Verification step 2 is the
   automated grep that catches exactly this. Rollback: restore `.env` from
   the most recent `.env.bak.*` and re-recreate the container.

3. **Stale credentials cookie path.** The CORS change does not touch
   cookies, but if any existing user was mid-session, their browser cache
   may have a stale OPTIONS-failed entry. Browser behavior is to retry on
   next navigation, so a hard refresh (Ctrl-F5) on the user side clears
   it. No server-side action needed.

4. **Brief auth-service downtime during force-recreate (~3–10s).** Any
   user mid-login during the Fix #4 window gets a network error and must
   retry. With acmd Beta launch traffic still small, the practical impact
   is one retry. No proactive maintenance announcement is required at
   this scale, but worth noting for future deploys at higher traffic.

5. **No regression risk to `/health`, `/.well-known/jwks.json`, or
   `/auth/google` POST itself.** These are all preserved by the same
   middleware and the change only widens the allowlist (adds origins,
   removes none).

**Rollback plan (if any verification step fails):**

1. Restore VPS `.env` from the most-recent backup (no operator memory
   needed — the script auto-discovers the latest `.env.bak.*`):
   ```bash
   ssh ipon@vps 'cd ~/vollos-core && \
     LATEST_BAK=$(ls -t .env.bak.* 2>/dev/null | head -1) && \
     [ -n "$LATEST_BAK" ] || { echo "ERROR no backup found — manual restore required"; exit 1; } && \
     echo "Restoring from $LATEST_BAK" && \
     mv .env ".env.bad.$(date -u +%Y%m%dT%H%M%SZ)" && \
     mv "$LATEST_BAK" .env && \
     docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --force-recreate auth-service'
   ```
   The `[ -n "$LATEST_BAK" ]` guard aborts cleanly if no backup exists
   (rather than silently producing a broken state). The current bad `.env`
   is preserved as `.env.bad.<timestamp>` for forensics; remove manually
   only after the incident is fully understood.

2. Re-run the existing-origin smoke test against the **actual failing
   endpoint** (`/auth/google` — the same path the production browser hits;
   verifying `/health` would not prove the auth path is restored):
   ```bash
   curl -sI -X OPTIONS \
     -H "Origin: https://vollos.ai" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: content-type" \
     https://auth.vollos.ai/auth/google
   ```
   If ACAO echoes `https://vollos.ai`, the rollback is complete and the
   service is back to its pre-fix state. Report rollback to Lead@vollos-core
   so the writer can re-prescribe.

3. Revert the `.env.example` + `.gitignore` MR if it was already merged —
   `git revert <commit>` and push as a new MR (do not force-push main).

**What to watch for after fix lands:**

- Telegram alert channel (configured in `.gitlab-ci.yml:82-87` `tg_alert()`)
  for any deploy-time smoke failures in the next 24h.
- Cloudflare WAF / Caddy access logs (`./logs/caddy/access.log` mounted per
  `docker-compose.prod.yml:127`) for any unexpected origin on
  `auth.vollos.ai/auth/*` — would indicate either a typo in the new
  allowlist or a phishing attempt (CSRF) trying the new domains.
- acmd-side Playwright E2E test (Lead@acmd will spawn `vollos-e2e-tester`
  per handover Section 7) — must complete the full Google login flow and
  reach the first authenticated `/api/v1/auth/me` call on
  `accommodate-api.vollos.ai`.

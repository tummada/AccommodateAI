# Review-A (Logic + Security) — ACMD-01

## Summary
- Critical: 1 / High: 2 / Medium: 2 / Low: 2
- Verdict: **FAIL** — one Critical must be resolved before Runner applies the fix.

---

## Findings

### [A1] Rollback smoke test curl hits wrong endpoint — Critical
- **Type:** Logic
- **Evidence:** fix.md lines 315–319 (rollback step 2):
  ```bash
  curl -sI -X OPTIONS -H "Origin: https://vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/health
  ```
- **Problem:** The smoke test in the rollback plan sends an OPTIONS preflight to `/health`, not to `/auth/google`. The `/health` route (`apps/auth-service/src/index.ts:285`) is a plain `GET` handler. Hono's CORS middleware does apply to `*` (index.ts:78 `app.use('*', createAuthCors(corsOrigins))`), so the ACAO header *may* still come back — but `/health` does not exercise the same code path as `/auth/google` and could mask a broken auth route. More dangerously: if a reviewer or operator mis-reads the rollback as "OPTIONS against /health is the verification pattern", they may incorrectly certify rollback success on a service that is not actually serving auth preflights. The correct endpoint to verify rollback is `https://auth.vollos.ai/auth/google`, consistent with every other curl in the Verification Plan (fix.md:209, 226, 233, 240, 247, 253).
- **Suggested fix:** Change the rollback smoke test to:
  ```bash
  curl -sI -X OPTIONS -H "Origin: https://vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/auth/google
  ```

---

### [A2] `sed` find-pattern does not anchor on dots — High (Security: Origin allowlist bypass risk on VPS)
- **Type:** Security
- **Evidence:** fix.md lines 128–129 (Fix #2 Runner SSH command):
  ```bash
  sed -i "s|^AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai$|...|" .env
  ```
  The `sed` pattern uses literal `.` characters, not `\.`. In sed's BRE/ERE, `.` is a wildcard matching any character.
- **Problem:** The pattern `acmd.vollos.ai` will also match `acmdXvollos.ai`, `acmd vollos.ai`, etc. In practice on a controlled `.env` file this is low-exploitation risk, but the *precondition check* (fix.md:108) uses `^AUTH_CORS_ORIGINS=https://acmd\.vollos\.ai,https://vollos\.ai$` with escaped dots (correct), while the actual `sed` substitution at line 128 uses unescaped dots. This is an inconsistency: the guard and the operation use different patterns. If someone uses the `sed` pattern as a template for future CORS updates and the `.env` has a crafted hostname, the wrong line could be matched. The guard is correct; the `sed` substitution should match it.
- **Suggested fix:** Escape the dots in the `sed` pattern:
  ```bash
  sed -i "s|^AUTH_CORS_ORIGINS=https://acmd\.vollos\.ai,https://vollos\.ai$|AUTH_CORS_ORIGINS=https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai|" .env
  ```

---

### [A3] Backup filename uses a predictable timestamp, permissions not set — High (Security)
- **Type:** Security
- **Evidence:** fix.md lines 127–128 (Fix #2):
  ```bash
  cp .env .env.bak.$(date -u +%Y%m%dT%H%M%SZ)
  ```
  No `chmod` is applied to the backup file after copy.
- **Problem:** `cp` preserves the source file's permissions. If `.env` is `0600` this is acceptable, but if it is world-readable (e.g., `0644`, which is the default for files created by some editors or `git checkout`), then `.env.bak.<timestamp>` inherits that. The `.env` file contains production secrets. The backup sits in `~/vollos-core/` which is a Git working directory — running `git status` or a badly-scoped `find` could surface it. The timestamp is deterministic and predictable (UTC seconds), so an attacker who gains any read access to the directory can enumerate backup filenames. Additionally, fix.md does not specify cleanup: after a successful fix, `.env.bak.<timestamp>` is left on disk indefinitely with no instruction to remove it. The rollback plan references `.env.bak.<original-timestamp>` by placeholder (fix.md:308) without confirming the actual filename, which could fail if the operator forgets it.
- **Suggested fix:**
  1. After `cp`, enforce `chmod 600 .env.bak.<timestamp>`.
  2. Add a cleanup step at the end of the verification plan: `rm .env.bak.<timestamp>` (after rollback window closes, e.g., after E2E test passes).
  3. Consider storing the backup path in a shell variable so the rollback command can reference it precisely.

---

### [A4] `grep` echo of AUTH_CORS_ORIGINS logs the full value — Medium (Security)
- **Type:** Security
- **Evidence:** fix.md lines 129 (Fix #2 command):
  ```bash
  grep "^AUTH_CORS_ORIGINS=" .env
  ```
  Also fix.md lines 200–204 (Verification Plan):
  ```bash
  ssh ipon@vps 'docker exec vollos-core-auth printenv AUTH_CORS_ORIGINS'
  ```
- **Problem:** These commands print the full env var value to stdout. In this specific case the value is a comma-separated list of **public hostnames** (no secrets), so exposure risk is low. However, the global CLAUDE.md Security rules state: "ห้าม cat .env ออกมาดูโดยตรง" and "รวมถึงค่าที่เห็นใน log — ถ้า log แสดง token/client_id/secret ห้าม copy มาแสดงใน chat". Fix.md explicitly says origins are "public hostnames, safe to show" (fix.md:112). This is technically correct for this specific var. The concern is the pattern: Runner will output the full `.env` grep line to the chat transcript. If the Runner agent reads `.env` output without filtering, it may inadvertently re-emit surrounding lines from a `.env` parse (e.g., if the grep accidentally matches a multiline value). The grep pattern `^AUTH_CORS_ORIGINS=` is precise so this risk is low, but the `printenv` invocation inside the container dumps only the named var, which is clean. No change strictly required, but noting it so Runner is aware.
- **Suggested fix:** Fix.md should explicitly instruct Runner: "output the grep result to the review log but do NOT paste the full result into chat". Low priority given the specific var is non-sensitive.

---

### [A5] `parseAuthCorsOrigins` test uses `'evil.example.com'` — but test reference in fix.md cites `T-093` test with `evil.example.com`, actual test uses `'https://attacker.example'` — Medium (Logic / Verification)
- **Type:** Logic
- **Evidence:**
  - fix.md line 152: `"rejects non-allowlisted origin" case added in T-093` with `Origin = evil.example.com`
  - Actual test file `packages/auth/__tests__/cors.test.ts:140–155`:
    ```ts
    Origin: 'https://attacker.example',
    ```
    The test origin is `https://attacker.example`, not `evil.example.com`.
- **Problem:** The fix.md description of the test case (line 152) says `evil.example.com` but the actual file uses `https://attacker.example`. This is a minor factual error in the fix document, but it violates the "Trust No One" principle: if Runner or a future reviewer relies on fix.md's description to verify the test exists, they will `grep` for `evil.example.com` and find nothing, potentially concluding the test is missing. The test does exist and is correct — only the description in fix.md is wrong.
- **Suggested fix:** Update fix.md line 152 to reference the actual test origin: `Origin = https://attacker.example`.

---

### [A6] No `null` Origin test — Low (Security)
- **Type:** Security
- **Evidence:** `packages/auth/__tests__/cors.test.ts` (full file read) — no test for `Origin: null`.
  Verification Plan (fix.md:250–258) — negative control tests only `https://evil.example.com`.
- **Problem:** The `null` origin (sent by browsers for `file://` pages, sandboxed iframes with `sandbox` attribute but no `allow-same-origin`, `data:` URIs) is a known CORS bypass vector. If `hono/cors` with an array allowlist reflects `null` as a valid origin match, a sandboxed iframe on any page could make credentialed requests to `auth.vollos.ai`. The current allowlist is a strict string array (`['https://vollos.ai', 'https://acmd.vollos.ai', ...]`) so Hono will not match `null` unless the allowlist contains the string `"null"`. Fix.md does not add `"null"` to the list (correct), but there is no test confirming this behavior, and fix.md does not include a `null`-origin curl in the verification plan.
- **Suggested fix:** Add one negative-control curl to the verification plan:
  ```bash
  curl -sI -X OPTIONS \
    -H "Origin: null" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/auth/google
  ```
  Expect: no `access-control-allow-origin` header returned.

---

### [A7] `docker compose restart` silently noted as insufficient — no guard against accidental use — Low (Logic)
- **Type:** Logic
- **Evidence:** fix.md lines 168–172 (Fix #3 notes):
  > `docker compose restart` would NOT pick up the new value. (`docker compose up -d --force-recreate` was used in T-090 for exactly this reason.)
- **Problem:** The fix correctly explains why `--force-recreate` is required. However, the fix only documents the correct command and mentions the wrong one in a note. If Runner copy-pastes the wrong command from memory or another runbook, there is no pre-condition check that would catch a plain `restart`. The verification step `docker exec vollos-core-auth printenv AUTH_CORS_ORIGINS` (fix.md:201–204) would catch this since the in-container value would be stale. This is low severity because the verification plan gates on `printenv`. No code change is needed, but worth calling out as a runner-error risk.
- **Suggested fix:** No change required to fix.md — the `printenv` verification step is an adequate catch. Low risk.

---

## FIND TEXT Verification Table

| Fix # | FIND TEXT matches actual file? | Note |
|---|---|---|
| 1 (.env.example) | ✅ Exact match | `.env.example` lines 62–66 match verbatim: `# Auth-service CORS allowlist (comma-separated). SEC-002 fail-closed:\n# when NODE_ENV=production the service refuses to boot if this is empty.\n# Dev default: http://localhost:3003. Example for production:\n# AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai\nAUTH_CORS_ORIGINS=http://localhost:3003` |
| 2 (VPS .env) | Needs Runner SSH verify | VPS file is inaccessible from this reviewer. The format (`AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai`) is consistent with T-007 runbook claims quoted in fix.md. Cannot confirm without SSH. |
| 3 (docker command) | N/A — no file FIND TEXT | Fix #3 is a Docker action, no file anchor to verify. Command syntax confirmed correct: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --force-recreate auth-service` is consistent with compose file structure. |

---

## Missing items

1. **Backup file cleanup instruction** — fix.md tells Runner to create `.env.bak.<timestamp>` but never instructs cleanup after the fix is verified. The backup will persist on VPS indefinitely.
2. **`null` origin negative test** in the Verification Plan — a standard CORS security check that is missing from the post-fix curl suite.
3. **`chmod 600` on backup file** — fix.md does not enforce permissions on the backup, relying on `cp` inheriting source permissions (which may or may not be 600 depending on VPS history).
4. **Rollback smoke test endpoint is wrong** (`/health` instead of `/auth/google` — see A1, Critical).

# Review-B (Infra + UX) — ACMD-01

## Summary

- Critical: 1 / High: 3 / Medium: 3 / Low: 2
- Verdict: **FAIL** — 1 Critical (literal placeholder breaks rollback), 3 High issues require fixes before Runner applies

---

## Findings

### [B1] Rollback command contains un-expanded literal placeholder — Critical

- **Type:** Infra / UX
- **Evidence:** `fix.md:309` — `mv .env.bak.<original-timestamp> .env`
  The `<original-timestamp>` is a human-readable placeholder, not a shell expression.
- **Problem:** If Runner pastes this command as-is during a live incident, the `mv` fails with
  `No such file or directory`. The broken auth-service stays broken. Under incident pressure, a
  Runner who doesn't notice the placeholder (it looks like a real filename in a code block) will
  execute the failing command and waste minutes before realising the rollback hasn't applied.
- **Suggested fix:** Replace the placeholder with a shell glob that finds the most-recent backup:
  ```bash
  ssh ipon@vps 'cd ~/vollos-core && \
    LATEST_BAK=$(ls -t .env.bak.* 2>/dev/null | head -1) && \
    [ -n "$LATEST_BAK" ] || { echo "ERROR: no backup found"; exit 1; } && \
    mv .env .env.bad.$(date -u +%Y%m%dT%H%M%SZ) && \
    mv "$LATEST_BAK" .env && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml \
      up -d --no-deps --force-recreate auth-service'
  ```
  Or instruct Runner to record the exact backup filename when Fix #2 runs (echo it to a temp var
  or note it from the `cp` output).

---

### [B2] `.env.bak.*` backup files not covered by `.gitignore` — High

- **Type:** Infra / Security
- **Evidence (fix.md:127):** `cp .env .env.bak.$(date -u +%Y%m%dT%H%M%SZ)` — backup written to
  `~/vollos-core/` (the git working tree).
  **Evidence (.gitignore:3-4):** `.gitignore` covers `.env` and `.env.local` but no `.env.bak.*`
  pattern exists anywhere in the file.
- **Problem:** After Fix #2 runs, `.env.bak.<timestamp>` is an untracked file in the git repo
  containing the full production `.env` (all secrets). If Runner later runs `git add .` or
  `git add -A` for any reason, the file is staged and could be pushed to GitLab, violating Secret
  Handling Protocol (CLAUDE.md §J). The backup also accumulates on every fix attempt with no
  cleanup instruction — multiple secret-bearing backup files pile up in the working tree.
- **Suggested fix — two actions:**
  1. Add `.env.bak.*` to `.gitignore` before Fix #2 runs (or confirm the .gitignore addition is
     part of this MR).
  2. Add a cleanup step at the end of the Verification Plan:
     ```bash
     # After all verification checks pass — remove the backup
     ssh ipon@vps 'cd ~/vollos-core && rm -f .env.bak.*'
     ```
     Keep the backup only until verification passes; delete on success.

---

### [B3] Rollback smoke test targets `/health` instead of the failing endpoint `/auth/google` — High

- **Type:** UX / Operational
- **Evidence:** `fix.md:315-317`:
  ```bash
  curl -sI -X OPTIONS -H "Origin: https://vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    https://auth.vollos.ai/health
  ```
  The CORS regression smoke test after rollback uses `/health`, not `/auth/google`.
- **Problem:** The original bug is a missing ACAO header on `OPTIONS /auth/google`. After rollback,
  Runner verifies ACAO on `/health`. Even though CORS middleware (`app.use('*', createAuthCors(...))`
  at `apps/auth-service/src/index.ts:78`) covers all routes including `/health`, verifying `/health`
  does not prove the actual failing path is restored. A misconfiguration specific to the `/auth/google`
  route would pass this test and leave the service still broken. The test verifies the wrong contract.
- **Suggested fix:** Replace with the same curl that diagnosed the original failure:
  ```bash
  curl -sI -X OPTIONS -H "Origin: https://vollos.ai" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    https://auth.vollos.ai/auth/google
  ```

---

### [B4] No explicit ordering constraint: MR merge before Fix #2/#3 triggers CI deploy that doesn't restart auth-service — High

- **Type:** Infra / Operational UX
- **Evidence:** `fix.md` presents three fixes without stating their required execution order.
  `.gitlab-ci.yml:59` shows: `git pull && docker compose up -d --build` — CI deploys on merge to main.
  `docker compose up -d --build` without `--force-recreate` does NOT recreate a container whose image
  hash is unchanged. Fix #1 only modifies `.env.example` (a dev doc not copied into the Docker image),
  so the image hash after Fix #1 MR merge is identical to the current production image. CI deploy
  after Fix #1 MR merge will NOT restart auth-service.
- **Problem:** If Runner opens and merges Fix #1 MR first (the most "safe" looking action), CI
  triggers. CI completes successfully but auth-service is not restarted. Runner might then believe the
  deploy is done and skip Fix #2 + Fix #3. The bug remains. Fix #2 + Fix #3 are VPS SSH actions that
  are completely independent of the MR and CI pipeline — this dependency must be made explicit.
- **Suggested fix:** Add a boxed "Execution Order (mandatory)" block at the top of the Changes
  section:
  ```
  ⚠️ Execution Order (mandatory)
  1. Fix #2 — edit VPS .env (SSH)
  2. Fix #3 — force-recreate auth-service (SSH)
  3. Run Verification Plan steps 1–7
  4. Only after all steps pass → Fix #1 MR (open, review, merge)
  Note: MR merge triggers CI deploy. CI will NOT restart auth-service again
  (no image change), so Fix #3 must already be done.
  ```

---

### [B5] `sed` pattern has unescaped dots — regex wildcards instead of literal dots — Medium

- **Type:** Infra
- **Evidence:** `fix.md:128`:
  ```
  sed -i "s|^AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai$|...|"
  ```
  The dots in `acmd.vollos.ai` and `vollos.ai` are unescaped in the sed BRE pattern. In regex,
  `.` matches any character.
- **Problem:** `https://acmd_vollos_ai,https://vollosXai` would also match. In practice the `.env`
  file is unlikely to have such a value, but it is technically incorrect. More realistically, if a
  future entry like `https://acmd-vollos.ai` were ever in the file, the unescaped dots could
  produce an unintended match that silently rewrites the wrong line.
- **Suggested fix:** Escape the dots:
  ```bash
  sed -i "s|^AUTH_CORS_ORIGINS=https://acmd\.vollos\.ai,https://vollos\.ai$|AUTH_CORS_ORIGINS=https://vollos.ai,...|"
  ```

---

### [B6] Boot log check uses `docker logs --tail 20` without `grep` — no automated assertion — Medium

- **Type:** Operational UX
- **Evidence:** `fix.md:163`: `docker logs --tail 20 vollos-core-auth` — output returned for
  human inspection.
  `fix.md:175-176`: "The boot log shows no `PRODUCTION_CORS_MISSING_ERROR`. The container's
  `process.env`... shows the new 4-origin value." — this is described as an assertion but no
  grep command enforces it.
- **Problem:** Runner must manually scan 20 log lines for the absence of a specific string. Under
  time pressure this visual check is error-prone. If the container crashed and restarted, tail 20
  may show the restart log, not the original boot log.
- **Suggested fix:**
  ```bash
  ssh ipon@vps 'docker logs vollos-core-auth 2>&1 | grep -c "PRODUCTION_CORS_MISSING" | \
    grep -q "^0$" && echo "PASS: no SEC-002 error" || echo "FAIL: SEC-002 fired — check logs"'
  ```

---

### [B7] `accommodate.vollos.ai` verification curl omits `Access-Control-Request-Headers` — Medium

- **Type:** UX / Verification coverage
- **Evidence:** `fix.md:225-229` (landing page preflight test) omits the
  `Access-Control-Request-Headers: content-type` header that the `accommodate-app.vollos.ai` test
  includes (`fix.md:211`). The two tests are inconsistent.
- **Problem:** Some CORS implementations grant different permissions based on `Access-Control-Request-Headers`
  presence. More importantly, the `accommodate-app.vollos.ai` and `accommodate.vollos.ai` test cases
  should be symmetric — if one includes the header, both should, so the verification is meaningful.
  A reviewer comparing the two curl commands may assume the difference is intentional and not add it
  in future iterations when it should be there.
- **Suggested fix:** Add `-H "Access-Control-Request-Headers: content-type"` to the
  `accommodate.vollos.ai` preflight curl, matching the `accommodate-app` check.

---

### [B8] No explicit maintenance window or user notification — Low

- **Type:** UX / Operational
- **Evidence:** `fix.md` prescribes `--force-recreate` for auth-service with no mention of
  downtime duration or user communication.
- **Problem:** `--force-recreate` causes a brief (~3-10s) outage of `auth.vollos.ai`. Any user
  mid-login during this window gets a network error. The acmd Beta launch context (Day 5 deadline,
  first real users) makes this more significant than in dev. fix.md's Risk section mentions stale
  browser cache but doesn't mention the service restart downtime itself.
- **Suggested fix (Low — note it):** Add a "Deployment window" note: restart during off-peak hours
  (early morning ICT / low US traffic) and optionally post a brief maintenance notice in the Telegram
  channel before applying Fix #3.

---

### [B9] No post-success cleanup step for backup file — Low

- **Type:** Operational / Security hygiene
- **Evidence:** `fix.md:127` creates `.env.bak.<timestamp>`. No cleanup instruction exists anywhere
  in the Verification Plan or post-fix notes. (Related to B2 — listed separately because B2 is about
  gitignore risk; this is about operational hygiene regardless of gitignore.)
- **Problem:** After successful verification, the `.env.bak.*` file remains on disk indefinitely.
  Over multiple fix iterations or future deploys, backup files accumulate in the working tree,
  each containing the full production `.env`. This widens the attack surface.
- **Suggested fix:** The final step in the Verification Plan should include:
  ```bash
  ssh ipon@vps 'cd ~/vollos-core && ls .env.bak.* && rm -f .env.bak.*'
  ```
  (The `ls` first ensures Runner sees what is being deleted.)

---

## FIND TEXT Verification Table

| Fix # | FIND TEXT in fix.md | Matches actual file? | Note |
|---|---|---|---|
| Fix #1 | Lines 74-80: 5-line block starting `# Auth-service CORS allowlist...` ending `AUTH_CORS_ORIGINS=http://localhost:3003` | **MATCH** | Verified byte-by-byte against `.env.example:62-66`. All 5 lines match exactly. No trailing whitespace, no CRLF, LF only. |
| Fix #2 | `AUTH_CORS_ORIGINS=https://acmd.vollos.ai,https://vollos.ai` (VPS `.env`) | **CANNOT VERIFY** — VPS file not accessible from local repo | fix.md correctly documents this as a Runner-SSH-verify step. Pre-condition check at `fix.md:107-110` is appropriate. |
| Fix #3 | N/A — Docker action, no FIND TEXT | N/A | Correct. |

---

## Missing items

1. **No `.env.bak.*` gitignore entry** — must be added to `.gitignore` in Fix #1 MR or as a
   pre-condition note.
2. **No explicit execution ordering** — Fix #2 and #3 must precede MR merge; this is not stated
   anywhere in fix.md.
3. **No cleanup step** — `.env.bak.*` is never removed after successful verify.
4. **Rollback smoke test verifies wrong endpoint** — `/health` instead of `/auth/google`.
5. **Rollback command is not copy-paste safe** — literal `<original-timestamp>` placeholder.

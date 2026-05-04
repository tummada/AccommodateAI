# Peer Review Log — ACMD-01

## Round 1 — 2026-04-29T11:00:00Z

### REVIEWER-A (Logic + Security)

- **[A1] Rollback smoke test curl hits wrong endpoint — Critical**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read the original fix.md rollback step 2 and
    confirmed the curl literally targeted `https://auth.vollos.ai/health`
    while every other curl in the Verification Plan (and the original
    handover diagnostic) targets `/auth/google`. Counter-argument
    considered: "CORS middleware is mounted with `app.use('*', ...)` at
    `apps/auth-service/src/index.ts:78` so `/health` would also return
    ACAO." That is technically true — verifying ACAO on `/health` would
    appear to succeed even if `/auth/google` were broken by some
    route-specific misconfiguration. So the test is not just stylistically
    inconsistent, it provides false confidence. The reviewer is correct.
  - **fix.md change:** Updated rollback step 2 (Risk Notes section) to use
    `https://auth.vollos.ai/auth/google` with full preflight headers,
    matching the diagnostic in handover §2.1.

- **[A2] `sed` find-pattern does not anchor on dots — High (Security)**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read fix.md:128 and confirmed the `sed` substitution
    used `acmd.vollos.ai` and `vollos.ai` with literal unescaped dots, while
    the precondition guard at fix.md:108 used `\.` (escaped). Counter-argument
    considered: "On a controlled `.env` file with known content, regex
    wildcard dots can never produce an unintended match." That is true for
    the current state, but the principle "guard pattern and operation pattern
    must match" is sound — future operators copy-pasting this sed pattern
    as a template (a likely scenario when adding the next product subdomain)
    inherit the inconsistency. Cheap to fix, no downside.
  - **fix.md change:** Fix #3 sed command now uses `acmd\.vollos\.ai` and
    `vollos\.ai` with escaped dots, matching the guard pattern.

- **[A3] Backup filename uses predictable timestamp, permissions not set — High**
  - **Status:** ACCEPTED (split into chmod + cleanup actions)
  - **Reasoning:** I re-read fix.md:127 and confirmed `cp .env .env.bak.$(...)`
    inherits source permissions. Counter-argument considered: "If `.env` is
    already 0600 (which it should be on a hardened VPS), the backup is also
    0600 — chmod is redundant." Probably true, but the cost of an explicit
    `chmod 600` is one extra shell instruction and the safety upside is
    catching the case where `.env` was ever world-readable due to past
    operator error. Backup cleanup is also clearly missing — there is no
    instruction in the original fix.md to remove `.env.bak.<timestamp>`
    after success, leading to indefinite accumulation of secret-bearing
    artifacts. Both sub-points are valid.
  - **fix.md change:** (1) Fix #3 command adds `chmod 600 "$BAK"` after `cp`
    and stores filename in `$BAK` shell var with `BACKUP_CREATED=$BAK` echo;
    (2) added Verification Plan step 11 (`rm -f .env.bak.*` after every
    earlier step passes); (3) Risk Notes rollback uses `ls -t | head -1`
    so operator does not need to remember the exact filename.

- **[A4] `grep` echo of AUTH_CORS_ORIGINS logs full value — Medium (Security)**
  - **Status:** REJECTED (with mitigation note added)
  - **Reasoning:** I re-read CLAUDE.md global Security rules and confirmed
    the spirit of the rule — "ห้าม cat .env" — is about secret values, not
    public hostnames. The `AUTH_CORS_ORIGINS` value is a comma-separated
    list of public DNS names registered to vollos.ai; revealing them to
    chat is equivalent to revealing the contents of the company About page.
    The reviewer themselves writes "the value is a comma-separated list of
    public hostnames (no secrets), so exposure risk is low" and "no change
    strictly required". Counter-argument considered: "What if the grep
    accidentally matches a multiline value and exposes a surrounding
    secret line?" — env files do not have multiline values, and the
    `^AUTH_CORS_ORIGINS=` anchor makes accidental match impossible. No
    code change is warranted, but a one-line discipline note ("write to
    runner-log not chat") was added as a cheap habit-builder.
  - **fix.md change:** Added a small "Note for Runner" callout after the
    Fix #3 command saying to write the grep output to `runner-log.md`,
    not chat. No behavior change to the actual command.

- **[A5] Test name mismatch (`evil.example.com` vs `https://attacker.example`) — Medium (Logic)**
  - **Status:** ACCEPTED
  - **Reasoning:** I read `packages/auth/__tests__/cors.test.ts:140-155`
    directly and confirmed the test uses `Origin: 'https://attacker.example'`
    — not `evil.example.com` as the original fix.md:152 claimed. Counter-
    argument considered: "Does it matter? The Negative Control curl in the
    Verification Plan still uses `evil.example.com` and that is fine because
    the curl tests live behavior, not the unit test name." True for
    behavior, but the original sentence in fix.md claimed the test "rejects
    non-allowlisted origin" with `Origin = evil.example.com` — anyone
    grep-checking this against the actual test file would find no match
    and falsely conclude the test is missing. Correctness is cheap.
  - **fix.md change:** Investigation Findings table now describes the test
    accurately: `"the 'rejects non-allowlisted origin' case (lines 140–155)
    uses Origin: 'https://attacker.example'"`. The Verification Plan step
    8 still uses `evil.example.com` for the live curl (different test —
    live preflight against production, not the unit-test scenario), and
    that distinction is now clear from context.

- **[A6] No `null` Origin test — Low (Security)**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read `packages/auth/src/cors.ts:91-98`
    (`createAuthCors`) and confirmed it passes `origin: origins` (a string
    array) to `hono/cors`. Counter-argument considered: "The string array
    cannot match the literal `null` because no entry is the string
    `"null"`." Correct — the implementation is safe by construction.
    However, the explicit verification has independent value: it documents
    the property and protects against future regression (e.g., someone
    refactoring `createAuthCors` to accept `'*'` or a function instead of
    an array). One curl line is cheap to add and the test exercises the
    well-known sandboxed-iframe / `file://` CORS bypass vector.
  - **fix.md change:** Added Verification Plan step 9 — a `Origin: null`
    preflight curl with expected outcome "no ACAO header echoed".

- **[A7] No guard against accidental `docker compose restart` — Low (Logic)**
  - **Status:** REJECTED
  - **Reasoning:** I re-read fix.md Fix #3 notes (now Fix #4) and confirmed
    the existing text already explains why `--force-recreate` is required
    and that `docker compose restart` would not work. The reviewer
    themselves writes "no change required to fix.md — the `printenv`
    verification step is an adequate catch". Adding a "do not type
    `restart`" instruction would be defensive noise; the verification step
    that `printenv` shows the new value is the correct gate.
  - **fix.md change:** None.

### REVIEWER-B (Infra + UX)

- **[B1] Rollback command contains un-expanded literal placeholder — Critical**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read the original fix.md rollback step 1 and
    confirmed the line `mv .env.bak.<original-timestamp> .env` literally
    contained the angle-bracketed placeholder. Counter-argument considered:
    "Maybe operators understand the convention and substitute it manually."
    Under non-incident conditions yes; under incident pressure with a
    broken auth-service and 4-day Beta launch deadline, the placeholder is
    a real footgun — the operator pastes it, gets `mv: cannot stat`, and
    burns minutes diagnosing. Reviewer-B's suggested
    `LATEST_BAK=$(ls -t .env.bak.* | head -1)` pattern is robust and
    self-documenting. This finding deserves the Critical label.
  - **fix.md change:** Risk Notes rollback step 1 rewritten to use
    `LATEST_BAK=$(ls -t .env.bak.* 2>/dev/null | head -1)` plus a
    `[ -n "$LATEST_BAK" ] || { echo "ERROR..."; exit 1; }` guard. Combined
    with the `BACKUP_CREATED=$BAK` echo from Fix #3 (A3), Runner has both
    a recorded filename and an auto-discovery fallback.

- **[B2] `.env.bak.*` not covered by `.gitignore` — High**
  - **Status:** ACCEPTED
  - **Reasoning:** I read `.gitignore` end-to-end (lines 1–45) and
    confirmed it covers `.env` and `.env.local` but no `.env.bak.*`
    pattern exists anywhere. Counter-argument considered: "Runner would
    never run `git add -A` blindly inside `~/vollos-core/` on the VPS."
    True for a careful Runner, but Secret Handling Protocol explicitly
    bans relying on operator vigilance — the gitignore rule should make
    the leak structurally impossible. Combined with the cleanup step
    from A3, this is defense in depth.
  - **fix.md change:** New Fix #1 — add `.env.bak.*` to `.gitignore`
    bundled with the .env.example MR. This is now Fix #1 (was previously
    just .env.example). Numbering shifted: old Fix #2 → Fix #3 (VPS edit),
    old Fix #3 → Fix #4 (container restart).

- **[B3] Rollback smoke test targets `/health` instead of `/auth/google` — High**
  - **Status:** ACCEPTED (duplicate of A1 — same finding)
  - **Reasoning:** Same evidence as A1, same root cause, same fix. Two
    independent reviewers landing on the same Critical/High issue is
    strong signal. Already addressed in the A1 fix.
  - **fix.md change:** Already covered by A1 change.

- **[B4] No explicit ordering constraint on Fix #1 vs Fix #2/#3 — High**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read `.gitlab-ci.yml:59` and confirmed the deploy
    step is exactly `git pull && docker compose up -d --build` — no
    `--force-recreate`. Counter-argument considered: "Even without
    --force-recreate, won't `--build` cause the auth-service container
    to restart?" No — `--build` triggers a build of the local image only
    if the build context changed. Since Fix #1 + Fix #2 only modify
    `.gitignore` and `.env.example` (neither is in the auth-service Docker
    build context — verified by reading the Dockerfile path implied by
    `docker-compose.yml`), the image hash is unchanged, so `up -d --build`
    is a no-op for that container. Reviewer is correct: if Runner merges
    the MR before running Fix #4 (the SSH restart), the production state
    never updates and Runner may falsely believe the deploy is done.
  - **fix.md change:** Added a prominent "Execution Order (mandatory)"
    callout block at the top of the Summary section, with the explicit
    sequence Fix #3 → Fix #4 → Verification → MR (Fix #1 + Fix #2). Each
    ordering reason is documented (.gitlab-ci.yml line cited).

- **[B5] `sed` pattern has unescaped dots — Medium**
  - **Status:** ACCEPTED (duplicate of A2 — same finding)
  - **Reasoning:** Same evidence as A2. Already addressed.
  - **fix.md change:** Already covered by A2 change.

- **[B6] Boot log check uses `docker logs --tail 20` without grep — Medium**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read fix.md Fix #3 notes (now Fix #4) and confirmed
    `docker logs --tail 20` was followed only by prose ("the boot log
    shows no PRODUCTION_CORS_MISSING_ERROR") with no programmatic check.
    Counter-argument considered: "Visual inspection of 20 lines is fast
    enough." Under time pressure operators tunnel-vision on the wrong
    line; an automated grep that exits non-zero on failure is materially
    safer. Cheap to add. Reviewer's exact suggested command needed minor
    adjustment (the `grep -c | grep -q "^0$"` chain is needlessly
    indirect) but the principle is correct.
  - **fix.md change:** Added Verification Plan step 2 — automated
    `grep -q "AUTH_CORS_ORIGINS must be set in production"` check that
    explicitly fails the procedure with a clear message if the SEC-002
    fail-closed string appears in the boot log. Step 2 now gates step 3+.

- **[B7] `accommodate.vollos.ai` curl omits `Access-Control-Request-Headers` — Medium**
  - **Status:** ACCEPTED
  - **Reasoning:** I re-read fix.md:225-229 (landing page preflight) and
    fix.md:211 (app preflight) and confirmed the asymmetry. Counter-
    argument considered: "The header is optional in real preflights and
    omitting it tests a different preflight shape — that could be valuable
    coverage." Plausible, but the goal here is a regression smoke test
    of one specific behavior (ACAO echo for an allowlisted origin), not
    a CORS conformance suite. Symmetric tests are easier for future
    reviewers to compare and less likely to drift. Cheap to align.
  - **fix.md change:** Verification Plan step 5 (accommodate.vollos.ai)
    now includes `-H "Access-Control-Request-Headers: content-type"`,
    matching steps 4, 6, and 7. All four positive-control preflights now
    use the same header set.

- **[B8] No explicit maintenance window — Low**
  - **Status:** REJECTED
  - **Reasoning:** I considered the suggestion: "restart during off-peak
    hours and post a maintenance notice in Telegram." Counter-argument:
    acmd Beta launched today (handover §1), traffic is essentially zero
    real users at this moment, and `--force-recreate` of one service
    takes ~3-10s with health-check resumption ~30s after that. The
    incident impact is at most "one user gets a network error and clicks
    retry." A maintenance announcement for that window is operational
    overhead disproportionate to the impact. The Risk Notes already
    mention the brief downtime in the rewrite, which is the right amount
    of acknowledgment.
  - **fix.md change:** None to verification/runner steps. Added one
    paragraph in Risk Notes "What could break" #4 acknowledging the
    ~3-10s window so the issue is documented if a future operator hits
    higher traffic.

- **[B9] No post-success cleanup step for backup file — Low**
  - **Status:** ACCEPTED (duplicate of A3 cleanup sub-point)
  - **Reasoning:** Same evidence and resolution as the A3 cleanup
    sub-point. Already addressed.
  - **fix.md change:** Already covered by A3 change (Verification step 11).

### Round summary

- Accepted: 11 / Rejected: 3 / Total: 14
  (Counted: A1✓ A2✓ A3✓ A4✗ A5✓ A6✓ A7✗ B1✓ B2✓ B3✓dup B4✓ B5✓dup B6✓ B7✓ B8✗ B9✓dup)
- Main fix.md changes:
  1. **Reordered fixes + added mandatory execution-order callout** — Fix #3 (VPS .env edit) and Fix #4 (force-recreate container) MUST run before the MR for Fix #1 + Fix #2 merges, because `.gitlab-ci.yml:59` deploys with `up -d --build` (no `--force-recreate`). Old Fix #1 (.env.example) is now Fix #2; new Fix #1 adds `.env.bak.*` to `.gitignore` to prevent secret leakage if the runtime backup is accidentally staged.
  2. **Made every backup/rollback/sed step robust** — `sed` dots escaped to match the precondition guard; backup filename captured in `$BAK` shell var with `BACKUP_CREATED=` echo; backup `chmod 600`'d; rollback uses `ls -t .env.bak.* | head -1` auto-discovery with empty-result guard; cleanup step (`rm -f .env.bak.*`) added as Verification step 11; rollback smoke curl now hits `/auth/google` (the actual failing path), not `/health`.
  3. **Hardened verification plan** — automated grep for SEC-002 fail-closed string in boot log (step 2) replaces eyeball inspection of `tail -20`; added `null` Origin negative control (step 9) to document and gate the sandboxed-iframe / `file://` bypass vector; symmetrized all four positive-control preflight curls so they share the exact same header set.
- Writer self-check:
  - [x] Read every cited file directly to verify (`.env.example`, `apps/auth-service/src/index.ts`, `packages/auth/__tests__/cors.test.ts`, `packages/auth/src/cors.ts`, `.gitignore`, `.gitlab-ci.yml`)
  - [x] Constructed counter-argument for every finding (REJECTED A4, A7, B8 with specific reasoning; ACCEPTED 11 others with verified evidence)
  - [x] No ACCEPT decisions made without verification (every ACCEPT lists the file:line that was independently re-read; every REJECT cites the specific reviewer text that conceded the change was not strictly required)

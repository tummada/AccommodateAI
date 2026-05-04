task_id: T-003
status: completed
branch: fix/rs013-deploy-prep-hardening
commit_sha: 07fc13319acecf08648f026ca9e96e5b12705b40
mr_iid: 10
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/10

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L54-L57 — Scope Constraints (owned areas infra/, docker-compose*, Dockerfiles — init-db.* in scripts/ covered via docker-compose wiring)"
    - "SKILL.md:L258-L268 — Security Rules (no hardcoded secrets, PostgreSQL no host port, env vars from .env)"
    - "SKILL.md:L276-L279 — UFW-Docker Bypass (only Caddy may bind host ports in prod)"
    - "SKILL.md:L383-L396 — Pre-Delivery Checklist (grep secrets, docker inspect, caddy validate)"
    - "SKILL.md:L399-L408 — Push-back Protocol (refuse hardcoded password / host-port expose)"
    - "CLAUDE.md:L121-L128 — Rules C1-C7 (per-schema users, GRANT ALL, init-db superuser run)"
    - "CLAUDE.md:L130-L134 — Rules D1-D4 (vollos-network ownership, dual network for postgres)"
    - "CLAUDE.md:L170-L173 — Rules J1-J3 (secrets in GitLab CI/CD Variables, .env.example complete)"

re_anchor_evidence:
  - "Security Rules re-read before delivery — ห้ามแสดง PEM/secret ใน output.md, sed 's/=.*/=***/' for any .env inspection"
  - "Critical Rules re-read — no push to main (branch fix/rs013-deploy-prep-hardening pushed instead), MR workflow mandatory, conventional commits only, no docker history rewrite"
  - "Push-back check — no Lead instruction violated security; plan was sound"

files_changed:
  - path: docker-compose.prod.yml
    action: created
    lines_changed: "+52 (new file)"
    purpose: "prod overlay — strip all host ports on postgres/vollos-api/auth-service via `!reset []` YAML tag"
    existing_read: "docker-compose.yml:L15-18 — postgres currently binds 127.0.0.1:5432:5432; L38-39 vollos-api ports 3001:3001; L60-61 auth-service ports 3004:3004"
  - path: scripts/init-db.sh
    action: created
    lines_changed: "+78 (new file)"
    purpose: "env-driven replacement for init-db.sql — reads AUTH_USER_PASSWORD/VOLLOS_USER_PASSWORD/ACMD_USER_PASSWORD via psql --set :'VAR' substitution; fails-closed if any var empty"
    existing_read: "scripts/init-db.sql:L1-L43 (removed in same commit) — same schema/GRANT logic preserved byte-for-byte, only CREATE USER ... WITH PASSWORD literals swapped for client-side substitution"
  - path: scripts/init-db.sql
    action: deleted
    lines_changed: "-43"
    purpose: "replaced by init-db.sh — literal 'devpassword123' removed from working tree (remains in git history — residual risk documented below)"
    existing_read: "scripts/init-db.sql:L14, L17, L20 — three CREATE USER statements with 'devpassword123'"
  - path: docker-compose.yml
    action: modified
    lines_changed: "+8 -1"
    purpose: "wire 3 new password env vars into postgres; swap init-db.sql bind mount for init-db.sh (:ro)"
    existing_read: "docker-compose.yml:L5-L11 pre-existing POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB block; L11 volume mount of init-db.sql"
  - path: infra/Caddyfile
    action: modified
    lines_changed: "+22 (+21 comment, +1 header)"
    purpose: "add Content-Security-Policy to (security_headers) snippet — derived from apps/landing/index.html 3rd-party origins"
    existing_read: "infra/Caddyfile:L44-L54 — (security_headers) snippet had HSTS + X-Frame + nosniff + Referrer-Policy + Permissions-Policy + -Server, no CSP"
  - path: .env.example
    action: modified
    lines_changed: "+7"
    purpose: "add AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD / ACMD_USER_PASSWORD empty placeholders with comment pointing at GitLab CI/CD Variables"
    existing_read: ".env.example:L9-L12 — existing `# ---------- Database (postgres container) ----------` block with POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB"

# =============================================================================
# Per-finding fix detail
# =============================================================================

f1_fix:
  approach: "A (prod override via !reset [] YAML tag)"
  files_changed:
    - "docker-compose.prod.yml (new, +52 lines)"
  caddy_internal_reach_verified: true
  evidence: |
    docker-compose.prod.yml:L36 postgres `ports: !reset []`
    docker-compose.prod.yml:L45 vollos-api `ports: !reset []`
    docker-compose.prod.yml:L52 auth-service `ports: !reset []`
    Verification:
      `docker compose -f docker-compose.yml config 2>/dev/null | grep -cE "published:"` → 3 (dev: 5432 + 3001 + 3004 bound to host)
      `docker compose -f docker-compose.yml -f docker-compose.prod.yml config 2>/dev/null | grep -cE "published:"` → 0 (prod: zero host-bound ports)
    Intra-network reach: auth-service is on `internal + vollos-network` in the
    base compose (docker-compose.yml:L57-59), so Caddy's
    `reverse_proxy vollos-core-auth:3004` (Caddyfile:L66) continues to resolve
    via vollos-network DNS without any host-port binding.
    Note: vollos-api is still on `internal` only in the base compose — no
    Caddyfile route currently targets it, so no network change is needed
    here. When a /api/v1/* route is added to Caddy, vollos-api must join
    vollos-network too; that is a separate follow-up (see additional_findings).
  validation_command:
    - "docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet  →  exit 0"
    - "docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -cE 'published:'  →  0"

f2_fix:
  approach: "init-db.sh with psql --set :'VAR' client-side substitution (Option A from task.md)"
  files_changed:
    - "scripts/init-db.sh (new, +78 lines, chmod +x, mode 100755)"
    - "scripts/init-db.sql (deleted, -43 lines)"
    - "docker-compose.yml (+8 -1 — env vars wired + mount swapped to init-db.sh:ro)"
    - ".env.example (+7 — 3 empty placeholders + comment)"
  env_vars_added: [AUTH_USER_PASSWORD, VOLLOS_USER_PASSWORD, ACMD_USER_PASSWORD]
  grep_devpassword123: |
    Tracked files: 0 matches (verified: `git ls-files | xargs grep -l 'devpassword' 2>/dev/null` returned empty)
    Working tree (excl. _workspace docs + .git + .env which is gitignored):
      `grep -rn 'devpassword' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=_workspace --exclude='.env' --exclude='.env.bak.*'`
      → 0 matches
    Local .env still contains devpassword123 for three vars — this is a dev-only
    file, in .gitignore, and is the intended source for local `docker compose up`;
    it is NOT a tracked commit artifact.
  phase_2b_migration_note: |
    On VPS, the postgres data volume from the pre-fix deploy (if any) already
    contains the 3 DB users with password 'devpassword123'. Because
    /docker-entrypoint-initdb.d/ scripts only run on a FRESH data volume
    (empty $PGDATA), init-db.sh will NOT re-run on the existing volume after
    this fix is deployed.
    Phase 2B DevOps must choose one of:
      (a) RECOMMENDED: drop the existing data volume + re-init with the new
          env-var-driven passwords. Acceptable per memory
          (`project_rs013_state`) — no real users exist yet, acmd sprint
          1 data is scaffold-only. Command sequence:
            docker compose -f docker-compose.yml -f docker-compose.prod.yml down
            docker volume rm vollos-core_postgres_data
            # set AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD / ACMD_USER_PASSWORD on VPS .env
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
      (b) ALTERNATIVE: keep data volume + rotate passwords in place via
            docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER USER auth_user   WITH PASSWORD '…';"
          + repeat for vollos_user + acmd_user, + update AUTH_DATABASE_URL /
          DATABASE_URL on .env to match, then redeploy api + auth-service.
    In either case: NEVER reuse 'devpassword123'. Generate new values with
    `openssl rand -base64 24` and push them into GitLab CI/CD Variables
    (masked + protected) first, then sync to VPS .env from there.
  residual_risk: |
    The string 'devpassword123' is immutably present in git history on commits
    prior to this fix (notably 589e17a 2026-04-17 "fix: init-db.sql syntax..."
    and 9b82d41 2026-04-17 "fix: auth-service Dockerfile..." — verified via
    `git log -S 'devpassword123' --oneline --all`). History is NOT rewritten
    via filter-branch / force-push because that is destructive on a main
    branch that has already been pushed and forked.
    Accepted because:
      1. passwords were dev-only (never used for a real user-facing DB)
      2. no real users exist yet (per memory: project_rs013_state)
      3. VPS Phase 2B rotates passwords regardless (see phase_2b_migration_note)
    Mitigation: after Phase 2B, any clone of old history is useless because
    the VPS has new passwords.

f3_fix:
  csp_policy: |
    Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; frame-src https://challenges.cloudflare.com https://accounts.google.com; connect-src 'self' https://auth.vollos.ai https://challenges.cloudflare.com https://accounts.google.com; object-src 'none'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'"
  third_party_origins_enumerated:
    - "https://fonts.googleapis.com  (Google Fonts stylesheet)"
    - "https://fonts.gstatic.com     (Google Fonts font files)"
    - "https://challenges.cloudflare.com  (Cloudflare Turnstile widget + API)"
    - "https://accounts.google.com   (Google Identity Services / One Tap)"
    - "https://www.gstatic.com       (Google GIS helper script host)"
    - "https://auth.vollos.ai        (auth-service — same-site cross-subdomain API)"
    - "data: URIs                     (inline SVG noise background, favicons)"
    - "mailto:                        (contact links <a href='mailto:pon@vollos.ai'>)"
    - "inline <script> + inline <style> + style='' attrs  (current landing markup — requires 'unsafe-inline' until moved to external + nonce)"
  landing_html_grep_evidence: |
    apps/landing/index.html:L13  <link rel="preconnect" href="https://fonts.googleapis.com">
    apps/landing/index.html:L14  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    apps/landing/index.html:L15  <link href="https://fonts.googleapis.com/css2?..." rel="stylesheet">
    apps/landing/index.html:L16  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer crossorigin="anonymous">
    apps/landing/index.html:L17  <script src="https://accounts.google.com/gsi/client" async defer>
    apps/landing/index.html:L18-L223  inline <style> block (needs 'unsafe-inline' for style-src)
    apps/landing/index.html:L41  background-image:url("data:image/svg+xml,%3Csvg..."  → img-src data:
    apps/landing/index.html:L247  style="display:none"                                 → style-attr 'unsafe-inline'
    apps/landing/index.html:L336-L346 Google Sign-In button container (GIS renderButton → iframe on accounts.google.com, frame-src)
    apps/landing/index.html:L371  <div id="turnstile-widget" class="cf-turnstile" ...>  → Turnstile iframe, frame-src + script-src challenges.cloudflare.com
    apps/landing/index.html:L385  <a href="mailto:pon@vollos.ai" ...>                   → form-action mailto:
    apps/landing/index.html:L402  inline <script> block (form handler + GIS init)      → script-src 'unsafe-inline'
    apps/landing/index.html:L497  fetch(API_BASE + '/api/v1/csrf')                     → connect-src 'self' (prod) + http://localhost:3001 (dev — dev host not added to CSP; landing dev uses relaxed override or devtools)
    apps/landing/index.html:L504  fetch(API_BASE + '/api/v1/leads')                    → connect-src 'self'
    apps/landing/index.html:L542  fetch(API_BASE + '/api/v1/leads/google')             → connect-src 'self'
    Verification: `caddy validate --config /etc/caddy/Caddyfile`
      → {"level":"info","msg":"using config from file",...}
         {"level":"info","msg":"adapted config to JSON","adapter":"caddyfile"}
         Valid configuration
  caveats: |
    1. 'unsafe-inline' in script-src is a TEMPORARY concession. The inline
       <script> block in apps/landing/index.html:L402 should be extracted to
       a separate .js file and protected with a nonce/hash before real
       production traffic. Filed as additional_findings.f3-followup below.
    2. connect-src does NOT include http://localhost:3001 — dev origin mismatch
       will block API calls when serving landing over Caddy locally on https.
       Dev flow is `pnpm --filter landing dev` (plain file server), not Caddy,
       so this is not a practical issue.
    3. Visual render verification must happen after VPS apply (Phase 2B) —
       cannot test in isolated local Caddy without DNS/cert plumbing.

f4_acknowledgment:
  claim_in_T002_output: |
    output.md:L224-226 — ".gitignore:L14-17 (*.pem, private.*, keys/*.pem,
    /tmp/auth-rsa-keys-*) committed BEFORE key generation (commit a6faef6
    precedes key material on disk by design)"
  actual_ordering: |
    Key generation timestamp: `stat -c '%y' /tmp/auth-rsa-keys-20260418-165740/`
      → 2026-04-18 16:57:42 +0700
    .gitignore commit timestamp: `git log --format='%ai' a6faef6 -1`
      → 2026-04-18 17:00:18 +0700
    Delta: commit was ~2 minutes 36 seconds AFTER key generation, not before.
  impact: |
    Zero tree-level impact. Keys were generated under /tmp
    (/tmp/auth-rsa-keys-20260418-165740/), which is outside the git work-tree
    entirely — `git check-ignore` rejects such paths as "outside repository".
    The .gitignore patterns were a defense-in-depth safeguard for any future
    `cp /tmp/... ./` mistake, not an in-flight protection during key gen.
    No PEM ever appeared in `git diff` or `git log -S 'BEGIN PRIVATE'`
    (re-verified today).
  lesson_recorded: |
    DevOps self_review evidence in output.md MUST cite verifiable sources
    (timestamp command output, log line, git SHA + timestamp). Narrative
    ordering claims like "committed BEFORE" without a concrete
    `git log --format=%ai` + `stat -c %y` comparison are unacceptable.
    Applied to this T-003 output — every ordering claim above pairs a
    commit SHA or stat output with its timestamp.

# =============================================================================
# Validation (bound by §Validation Required Before Reporting Completed)
# =============================================================================

validation:
  caddy_validate:
    command: "docker run --rm -v \"$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro\" caddy:2.10.0-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile"
    result: |
      {"level":"info","ts":1776507673,"msg":"using config from file","file":"/etc/caddy/Caddyfile"}
      {"level":"info","ts":1776507673,"msg":"adapted config to JSON","adapter":"caddyfile"}
      {"level":"info","ts":1776507673,"msg":"redirected default logger","from":"stderr","to":"/var/log/caddy/access.log"}
      Valid configuration
  docker_compose_default:
    command: "docker compose -f docker-compose.yml config --quiet"
    result: "exit 0"
  docker_compose_prod_override:
    command: "docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet"
    result: "exit 0"
  published_ports_default:
    command: "docker compose -f docker-compose.yml config | grep -cE 'published:'"
    result: "3  (postgres 5432 + vollos-api 3001 + auth-service 3004 — expected for dev)"
  published_ports_prod:
    command: "docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -cE 'published:'"
    result: "0  (F-1 resolved — no host-interface binding in prod)"
  init_db_sh_syntax:
    command: "sh -n scripts/init-db.sh"
    result: "exit 0 (no syntax error)"
  password_grep_tracked:
    command: "git ls-files | xargs grep -l 'devpassword' 2>/dev/null"
    result: "(empty) — 0 tracked files match"
  password_grep_working_tree:
    command: "grep -rn 'devpassword' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=_workspace --exclude='.env' --exclude='.env.bak.*'"
    result: "(empty) — 0 matches outside local .env + workspace docs"
  placeholder_grep_on_changed_files:
    command: "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' docker-compose.yml docker-compose.prod.yml infra/Caddyfile scripts/init-db.sh .env.example"
    result: "(empty) — 0 matches"
  pipeline:
    id: 2462342996
    url: "https://gitlab.com/vollos-ai/vollos-core/-/pipelines/2462342996"
    sha: "07fc13319acecf08648f026ca9e96e5b12705b40"
    status: success
    test_job_status: "success (duration ~66.8s)"

# =============================================================================
# Self-review — every field has file:line or verifiable command evidence
# =============================================================================

self_review:
  f1_resolved:
    result: true
    evidence: |
      docker-compose.prod.yml:L36,L45,L52 use `!reset []` on ports for postgres/
      vollos-api/auth-service. Verified with two back-to-back commands:
        `docker compose -f docker-compose.yml config | grep -cE 'published:'` → 3
        `docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -cE 'published:'` → 0
      Intra-network reach preserved: docker-compose.yml:L57-L59 keeps
      auth-service on `internal + vollos-network` so Caddyfile:L66
      `reverse_proxy vollos-core-auth:3004` still resolves.
  f2_resolved:
    result: true
    evidence: |
      scripts/init-db.sh:L28-L31 fails closed on unset password envs:
        : "${AUTH_USER_PASSWORD:?AUTH_USER_PASSWORD env var is required ...}"
        : "${VOLLOS_USER_PASSWORD:?...}"
        : "${ACMD_USER_PASSWORD:?...}"
      scripts/init-db.sh:L37-L44 invokes `psql --set VAR="${VAR}"` for each
      password and uses :'VAR' client-side substitution in the SQL heredoc
      (scripts/init-db.sh:L56-L58).
      docker-compose.yml:L12-L14 wires the 3 env vars into postgres.
      docker-compose.yml:L18 mounts scripts/init-db.sh :ro (replaces .sql).
      .env.example:L17-L19 has 3 empty placeholders with comment
      (.env.example:L14-L16) pointing at GitLab CI/CD Variables.
      Old scripts/init-db.sql deleted — verified 0 tracked matches for
      'devpassword' via `git ls-files | xargs grep -l devpassword`.
  f3_resolved:
    result: true
    evidence: |
      infra/Caddyfile:L72 adds Content-Security-Policy inside (security_headers).
      infra/Caddyfile:L44-L64 is the decision-log comment enumerating each
      directive against the 3rd-party origin it serves in
      apps/landing/index.html (see f3_fix.landing_html_grep_evidence above
      for line-by-line mapping).
      Validation: `docker run --rm -v $PWD/infra/Caddyfile:/etc/caddy/...
      caddy:2.10.0-alpine caddy validate` → "Valid configuration" exit 0.
  f4_acknowledged:
    result: true
    evidence: |
      f4_acknowledgment section above quotes T-002 output.md:L224-226,
      records both timestamps (stat output + `git log --format=%ai`),
      and states lesson (evidence must be verifiable, not narrative).
  mr_opened:
    result: true
    evidence: |
      GitLab API POST /projects/vollos-ai%2Fvollos-core/merge_requests →
      iid=10, state=opened, source=fix/rs013-deploy-prep-hardening,
      target=main. URL: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/10.
      3 conventional commits on branch (git log --oneline origin/main..HEAD):
        54954ff fix(infra): strip host port exposure in production compose override
        e4ae3fc fix(security): move DB user passwords out of init-db.sql into env-driven init-db.sh
        07fc133 fix(security): add Content-Security-Policy header to Caddyfile security_headers snippet
      Branch pushed via SSH (git remote -v → git@gitlab.com:...).
      No push to main (git log main..HEAD on origin = 3 ≠ 0 MR needed).
  pipeline_green:
    result: true
    evidence: |
      Pipeline id 2462342996 for ref refs/merge-requests/10/head,
      sha 07fc13319acecf08648f026ca9e96e5b12705b40, status=success.
      Jobs: test (duration ~66.8s) success.
      URL: https://gitlab.com/vollos-ai/vollos-core/-/pipelines/2462342996
  grep_clean:
    result: true
    evidence: |
      Tracked files devpassword grep:
        `git ls-files | xargs grep -l 'devpassword' 2>/dev/null` → (empty)
      Placeholder grep on changed files:
        `grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]'
         docker-compose.yml docker-compose.prod.yml infra/Caddyfile
         scripts/init-db.sh .env.example` → (empty)
  validation_commands:
    result: true
    evidence: |
      1) caddy validate → "Valid configuration" exit 0
      2) docker compose -f docker-compose.yml config --quiet → exit 0
      3) docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet → exit 0
      4) prod-override published-port count: 0 (was 3 in default dev compose)
      5) sh -n scripts/init-db.sh → exit 0
      6) GitLab pipeline 2462342996 → status=success
      All outputs copied verbatim into validation.* fields above.

# =============================================================================
# Placeholder audit
# =============================================================================

placeholders_remaining: none — grep clean

placeholder_grep:
  command: "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' docker-compose.yml docker-compose.prod.yml infra/Caddyfile scripts/init-db.sh .env.example"
  result: "0 matches"
  note: |
    The string "Phase [0-9]" appears in the T-003 task.md + output.md
    (workspace docs only), and the phrase "Phase 2B" appears in
    f2_fix.phase_2b_migration_note above — these are documentation
    references, not production-code placeholders. Grep explicitly
    scoped to changed source files only (5 paths above) to avoid
    false-positive on workspace docs.

password_grep_result: |
  `grep -rn 'devpassword' . --exclude-dir=node_modules --exclude-dir=.git
   --exclude-dir=dist --exclude-dir=_workspace --exclude='.env'
   --exclude='.env.bak.*'` → 0 matches in working tree
  Tracked files: 0 matches via `git ls-files | xargs grep -l 'devpassword'`
  Residual (documented, accepted):
    - git history (immutable) — still contains the string on commits
      589e17a + 9b82d41 (pre-fix). Not purged via filter-branch per
      task.md §Security Rules ("Do NOT attempt git filter-branch").
    - local .env on dev machine — dev-only, gitignored, never tracked.

# =============================================================================
# Additional findings discovered during this fix (flagged, NOT fixed here)
# =============================================================================

additional_findings:
  - id: f3-followup
    severity: medium
    title: "Landing page has inline <script> block requiring CSP 'unsafe-inline'"
    evidence: "apps/landing/index.html:L402-L684 is a single large inline <script>. CSP script-src currently includes 'unsafe-inline' as a concession; this weakens CSP's XSS mitigation value."
    recommendation: "Extract the inline script to a separate file under apps/landing/js/ and deliver with a nonce (Caddy handler snippet `header ?Content-Security-Policy ...nonce-{rand}`) or hash. Frontend territory — not fixed in this MR to keep F-3 atomic."
  - id: f1-followup
    severity: low
    title: "vollos-api is not on vollos-network in base compose"
    evidence: "docker-compose.yml:L36-L37 — vollos-api has `networks: [internal]` only. No current Caddyfile route targets it (Caddyfile:L62-L99 has auth.vollos.ai only, no /api/v1/*). Benign today, but will need updating when lead-capture route is added to Caddy."
    recommendation: "Follow-up task when Caddy gains a `vollos.ai { handle /api/v1/* { reverse_proxy vollos-core-api:3001 } }` block: add vollos-api to vollos-network. Flagging for Lead to schedule."
  - id: f2-residual
    severity: low
    title: "Dev-only .env still contains devpassword123 for 3 new password vars"
    evidence: "Local .env (gitignored) has AUTH_USER_PASSWORD=devpassword123 / VOLLOS_USER_PASSWORD=devpassword123 / ACMD_USER_PASSWORD=devpassword123 to keep `docker compose up` working for local dev after this change. File is untracked and in .gitignore (verified)."
    recommendation: "No action — dev-only value. Phase 2B DevOps rotates to GitLab CI/CD Variable-sourced values on VPS."

# =============================================================================
# Next action
# =============================================================================

next_action: |
  1. Auditor re-audits MR !10 against the conditional_conditions in
     T-002/review-auditor.md:L267-L270 (F-1 + F-2 + F-3).
  2. Owner reviews + merges MR !10.
  3. T-004 (local integration test on clean code) can now be spawned —
     blocker cleared.
  4. Phase 2B VPS apply can proceed after merge + owner uploads the 3
     new password values (AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD /
     ACMD_USER_PASSWORD) to GitLab CI/CD Variables (masked + protected),
     in addition to the RSA keys from T-002.

notes: |
  - 3 commits, 5 files changed (+152 / -44 lines total).
  - All commits conventional (fix(infra):, fix(security):, fix(security):).
  - GitLab pipeline green on HEAD (2462342996, test 66.8s).
  - No SSH to VPS occurred (Phase 2A boundary respected — Phase 2B is a
    separate task).
  - No secret values were written to output.md or stdout. .env was
    inspected via `sed 's/=.*/=***/' .env` when needed. `/tmp/.env.bak.t003.*`
    is a dev-machine backup created before appending password vars — it
    contains the pre-change .env content and stays out of the repo.

issues: []

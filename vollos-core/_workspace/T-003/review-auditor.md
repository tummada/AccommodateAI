---
task_id: T-003
reviewer: vollos-auditor
mr: "!10"
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/10
branch: fix/rs013-deploy-prep-hardening
commit_head: 07fc13319acecf08648f026ca9e96e5b12705b40
previous_audit: T-002
working_mode: infra
audit_performed_pre_merge: true

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L62-L66 — Scope & Constraints (read-only, Lead-initiated)"
    - "SKILL.md:L69-L105 — Pre-Audit Protocol (Re-anchor, Context, Evidence, Anti-Sycophancy)"
    - "SKILL.md:L120-L127 — Severity Definitions"
    - "SKILL.md:L129-L145 — Verdict Policy table"
    - "SKILL.md:L226-L237 — Critical Rules (CRITICAL=fail, Lead can't override)"
    - "references/security-checklists.md:L111-L124 — Infrastructure Layer (Docker + Caddy + TLS)"
    - "references/security-checklists.md:L34 — Secrets Detection 4 surfaces"
    - "references/security-checklists.md:L73-L74 — Security Headers (CSP requirement) + API8:2023"
    - "CLAUDE.md:L121-L128 — Rules C1-C7 (schema-per-product, GRANT ALL)"
    - "CLAUDE.md:L130-L134 — Rules D1-D4 (network ownership, dual network for postgres)"
    - "CLAUDE.md:L170-L173 — Rules J1-J3 (secrets in GitLab CI/CD Variables)"

re_anchor_evidence:
  - "Round 2 re-anchor — reset trust. DevOps self-claim in output.md is hypothesis, not evidence. Every command re-run locally."
  - "F-4 lesson from T-002 applied: spot-check ≥2 timing claims in T-003 self_review against `stat`/`git log --format=%ai`."
  - "Lead instruction: verify all 3 conditional_conditions resolved + check no NEW HIGH/CRITICAL introduced (esp. 'unsafe-inline', shell injection, !reset compat)."

files_reviewed:
  - "docker-compose.prod.yml: lines 1-53 (all — new file)"
  - "docker-compose.yml: lines 1-86 (all — modified)"
  - "scripts/init-db.sh: lines 1-79 (all — new file)"
  - "infra/Caddyfile: lines 1-122 (all — modified)"
  - ".env.example: lines 1-81 (all — modified, masked inspection)"
  - "apps/landing/index.html: grep-targeted L7-L17, L41, L247, L328-L402, L497-L542 (for CSP 3rd-party origin cross-check)"
  - "_workspace/T-003/task.md: lines 1-189 (all — scope)"
  - "_workspace/T-003/output.md: lines 1-412 (all — DevOps self-claim)"
  - "_workspace/T-003/audit-task.md: lines 1-122 (all — Lead audit scope)"
  - "_workspace/T-002/review-auditor.md: lines 1-325 (all — prior audit, esp. L267-270 conditional_conditions)"

greps_executed:
  - "git log --oneline origin/main..fix/rs013-deploy-prep-hardening → 3 commits: 54954ff fix(infra), e4ae3fc fix(security), 07fc133 fix(security) — all conventional"
  - "git diff --stat origin/main...fix/rs013-deploy-prep-hardening → 6 files, +167 -43 (matches DevOps claim ±1 on Caddyfile counting inline comments)"
  - "git diff --name-only origin/main...fix/rs013-deploy-prep-hardening → .env.example, docker-compose.prod.yml, docker-compose.yml, infra/Caddyfile, scripts/init-db.sh, scripts/init-db.sql (all in owned_files; no out-of-scope)"
  - "git ls-files | xargs grep -l 'devpassword' 2>/dev/null → (empty) exit 123 (no tracked file contains the string) ✅"
  - "git log --all -S 'devpassword123' --oneline → e4ae3fc (removal) + 589e17a (pre-fix) — pre-fix commit confirmed in history; removal commit on branch"
  - "sh -n scripts/init-db.sh → exit 0 (syntactically valid) ✅"
  - "git ls-tree fix/rs013-deploy-prep-hardening scripts/init-db.sh → mode 100755 (executable in git, correct for /docker-entrypoint-initdb.d/) ✅"
  - "docker compose -f docker-compose.yml config | grep -cE 'published:' → 3 (dev: postgres 5432 + api 3001 + auth 3004)"
  - "docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -cE 'published:' → 0 (prod override strips all host ports — F-1 resolved) ✅"
  - "docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet → exit 0 (YAML !reset [] tag parsed by Docker Compose v5.1.2 — above the v2.24+ minimum) ✅"
  - "docker run --rm -v \"$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro\" caddy:2.10.0-alpine caddy validate → 'Valid configuration' exit 0 ✅"
  - "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' docker-compose.yml docker-compose.prod.yml infra/Caddyfile scripts/init-db.sh .env.example → 0 matches ✅"
  - "grep -nE '(src=|href=|@import|fetch\\(|fonts\\.googleapis|accounts\\.google|challenges\\.cloudflare|gstatic|mailto:)' apps/landing/index.html → all 3rd-party origins DevOps enumerated confirmed: fonts.googleapis.com(L13,L15), fonts.gstatic.com(L14), challenges.cloudflare.com(L16), accounts.google.com(L17), mailto:(L349,L367,L385), data:(L41), inline <script>(L402), inline <style>(L18), style='' attrs(L247,L328,L331,L333,L347,L375)"
  - "git log --format='%ai' 54954ff -1 → 2026-04-18 17:22:34 +0700; stat docker-compose.prod.yml → mtime 17:21:37 — file written 57s BEFORE commit (consistent with claimed ordering) ✅"
  - "git log --format='%ai' e4ae3fc -1 → 2026-04-18 17:22:51 +0700; stat scripts/init-db.sh → mtime 17:19:18 — file written 3m33s BEFORE commit (consistent) ✅"
  - "git log --format='%ai' 07fc133 -1 → 2026-04-18 17:23:05 +0700; stat infra/Caddyfile → mtime 17:20:19 — file written 2m46s BEFORE commit (consistent) ✅"
  - "stat -c '%y' /tmp/auth-rsa-keys-20260418-165740 → 2026-04-18 16:57:42 +0700; git log --format='%ai' a6faef6 -1 → 2026-04-18 17:00:18 +0700 — delta 2m36s (T-003 f4_acknowledgment matches reality exactly) ✅"
  - "GitLab API GET /projects/vollos-ai%2Fvollos-core/merge_requests/10 → state=opened, source=fix/rs013-deploy-prep-hardening, target=main, sha=07fc133, title='fix(security): RS-013 hot-fix 3 HIGH Auditor findings' ✅"
  - "GitLab API GET /pipelines?sha=07fc133 → id=2462342996 status=success ref=refs/merge-requests/10/head ✅"
  - "GitLab API GET /protected_branches/main → push_access=['No one'], merge_access=['Maintainers'] ✅ (rule F4 upheld)"
  - "git diff origin/main...fix/rs013-deploy-prep-hardening | grep -iE '^\\+.*(devpassword|BEGIN.*PRIVATE|sk_live|api_key=)' → 0 matches (no secret introduced in diff) ✅"
  - "docker compose version → v5.1.2 (well above v2.24 minimum for `!reset` YAML tag support — no compatibility concern) ✅"

scope_compliance:
  files_changed_vs_owned: "match — 6 files (.env.example, docker-compose.prod.yml new, docker-compose.yml, infra/Caddyfile, scripts/init-db.sh new, scripts/init-db.sql deleted) all listed in task.md §Owned Files. No out-of-scope file touched. No CLAUDE.md / _board.md / apps/*/src / packages/*/src / migrations / .gitlab-ci.yml changes."

# ============================================================
# STATUS OF PREVIOUS T-002 CONDITIONAL CONDITIONS
# ============================================================

previous_conditional_conditions_status:
  F-1:
    status: resolved
    evidence: |
      docker-compose.prod.yml:L36,L45,L52 use `ports: !reset []` on postgres /
      vollos-api / auth-service. Independently verified:
        `docker compose -f docker-compose.yml config | grep -cE 'published:'`
          → 3 (dev default: 5432 + 3001 + 3004)
        `docker compose -f docker-compose.yml -f docker-compose.prod.yml config
         | grep -cE 'published:'`
          → 0 (prod: zero host-bound ports)
      Caddy intra-network reach preserved: docker-compose.yml:L64-L66 keeps
      auth-service on `internal + vollos-network`, so Caddyfile:L88
      `reverse_proxy vollos-core-auth:3004` resolves via vollos-network DNS
      without any host port.
      YAML `!reset []` tag is supported from Docker Compose v2.24+ (current
      local v5.1.2). `docker compose ... config --quiet` → exit 0, confirming
      the merge engine accepts the tag.
    residual_note: |
      vollos-api stays on `internal` only (not vollos-network) in the base
      compose. No Caddy route currently targets it (landing + auth only), so
      this is benign today. When a Caddy `/api/v1/*` handler is added
      targeting `vollos-core-api:3001`, vollos-api MUST join vollos-network.
      DevOps flagged this as additional_findings.f1-followup (low) — accepted.

  F-2:
    status: resolved
    evidence: |
      Code changes (all independently verified):
        scripts/init-db.sh:L25-27 — `: "${AUTH_USER_PASSWORD:?…}"` +
          `: "${VOLLOS_USER_PASSWORD:?…}"` + `: "${ACMD_USER_PASSWORD:?…}"`
          → fail-closed on unset / empty (shell `:?` expansion aborts script
          with a non-zero exit code before psql is invoked).
        scripts/init-db.sh:L37-L43 — `psql --set VAR="${VAR}"` with
          `--set ON_ERROR_STOP=1`. SQL body uses `:'VAR'` client-side
          substitution (L56-L58), which performs PostgreSQL's single-quote
          escape rules — `'` in a password is encoded as `''` — no injection
          risk via malformed password.
        docker-compose.yml:L12-L14 — 3 password envs passed into postgres.
        docker-compose.yml:L18 — bind-mount swapped to init-db.sh:ro.
        .env.example:L14-L19 — 3 empty placeholders + comment pointing at
          GitLab CI/CD Variables (rule J1-J3 ✅).
        scripts/init-db.sql — deleted in branch (git ls-tree confirms).
      Repository grep:
        `git ls-files | xargs grep -l 'devpassword' 2>/dev/null` → empty ✅
        `git log --all -S 'devpassword123' --oneline` → shows e4ae3fc (this
          MR's removal) + pre-fix 589e17a. Residual in history is documented
          in output.md `residual_risk` with owner-accepted justification (dev-
          only + rotate on VPS Phase 2B).
      Executable bit: git tree mode is 100755 (correct). Local filesystem
      shows 775 (extra group-write bit from umask — irrelevant because docker
      copies the git-tracked mode into the container).
    residual_note: |
      `--set VAR=${VAR}` passes the password as an argv parameter to psql.
      During the brief init window it is visible via `ps` inside the
      postgres container. Container-scoped and transient — acceptable for
      first-boot bootstrap. Not a blocker.

  F-3:
    status: resolved
    evidence: |
      infra/Caddyfile:L72 adds the Content-Security-Policy header inside
      `(security_headers)` snippet. Directives cross-checked against actual
      landing HTML (apps/landing/index.html):
        script-src 'self' 'unsafe-inline' + challenges.cloudflare.com (L16
          Turnstile) + accounts.google.com (L17 GIS) + www.gstatic.com
          (GIS helper) ✅
        style-src  'self' 'unsafe-inline' (inline <style> L18 + style='' on
          L247/L328/L331/L333/L347/L375) + fonts.googleapis.com (L13,L15) ✅
        font-src   'self' + fonts.gstatic.com (L14) ✅
        img-src    'self' + data: (L41 SVG noise + favicons) + https: ✅
        frame-src  challenges.cloudflare.com + accounts.google.com (Turnstile
          + GIS iframes) ✅
        connect-src 'self' (same-origin fetch to /api/v1/csrf L497, /api/v1/
          leads L504, /api/v1/leads/google L542) + auth.vollos.ai +
          challenges.cloudflare.com + accounts.google.com ✅
        form-action 'self' mailto: (contact links L349/L367/L385) ✅
        object-src 'none'; base-uri 'self'; frame-ancestors 'none' —
          matches X-Frame-Options DENY on L68 ✅
      Validation: `caddy validate --config /etc/caddy/Caddyfile` → 'Valid
      configuration' exit 0 ✅
    residual_note: |
      'unsafe-inline' appears in script-src and style-src. This is a
      documented concession because apps/landing/index.html:L18-L223 contains
      a large inline <style> block and L402 a large inline <script>. Before
      this MR, there was NO CSP at all — so 'unsafe-inline' CSP is strictly
      better than missing CSP, but is a defense-in-depth weakening vs nonce-
      or hash-based CSP. Filed as new_findings SEC-001 below (severity: medium,
      with mitigation — acceptable for merge, must be hardened before landing
      takes real production traffic). Not a HIGH — treating it as HIGH would
      require rejecting a strict improvement over the current state.

# ============================================================
# VERDICT
# ============================================================

verdict: pass
commit_gate: GO
phase_2b_readiness: ready

# ============================================================
# NEW FINDINGS (introduced or surfaced by this MR)
# ============================================================

critical_findings: []

warning_findings: []

new_findings:
  - id: SEC-001
    severity: medium
    cvss_estimate: "~5.4 (A02:2025 Security Misconfiguration — CSP weakened by 'unsafe-inline' but strictly improves from no-CSP baseline)"
    category: "headers (CWE-693, API8:2023)"
    file: "infra/Caddyfile:L72"
    description: |
      CSP script-src and style-src both include 'unsafe-inline'. This weakens
      CSP's XSS-mitigation value because the browser will execute any inline
      <script> or style attribute, including attacker-injected ones. Required
      today because apps/landing/index.html:L18 has a large inline <style>
      block and :L402 a large inline <script> (form handler + GIS init).
    evidence: |
      infra/Caddyfile:L72 contains `script-src 'self' 'unsafe-inline' ...`
      and `style-src 'self' 'unsafe-inline' ...`.
      Source cause: apps/landing/index.html:L402 inline <script>; L18 inline
      <style>; plus inline style="" attributes on L247, L328, L331, L333,
      L347, L375.
    recommendation: |
      Follow-up MR (Frontend territory — Lead to schedule before vollos.ai
      takes real traffic):
        (a) Extract apps/landing/index.html:L402-L684 inline <script> to
            apps/landing/js/main.js and load via <script src=…> → remove
            'unsafe-inline' from CSP script-src.
        (b) Either move inline <style> at L18-L223 into apps/landing/css/
            main.css (preferred) OR keep inline and emit a per-request
            nonce via a Caddy template + <style nonce="…"> — removes
            'unsafe-inline' from CSP style-src.
        (c) After extraction, replace 'unsafe-inline' with 'nonce-{rand}'
            in the (security_headers) CSP.
    reference: "OWASP A02:2025; security-checklists.md:L73 Security Headers HIGH row — CSP directive completeness"

note_findings:
  - id: NOTE-001
    severity: low
    category: "docker (CWE-250)"
    file: "docker-compose.yml:L22-L25"
    description: |
      postgres still binds `127.0.0.1:5432:5432` in the base compose (not in
      prod override — prod strips it via !reset []). In local dev this is
      fine (localhost bind only; internet-unreachable). Noted here only as a
      reminder that when VPS applies the prod override, psql CLI access must
      go through `ssh -L 5432:localhost:5432` (documented in
      docker-compose.prod.yml:L20-L22).
    recommendation: "No action — localhost bind is the intended dev ergonomics. Prod override already removes it."

  - id: NOTE-002
    severity: low
    category: "docker (CWE-250, CIS 5.x)"
    file: "docker-compose.yml:L34-L47 (vollos-api)"
    description: |
      vollos-api joins only `internal` network (not `vollos-network`) in the
      base compose. No Caddy route currently targets vollos-api, so it is
      benign today. DevOps flagged this as additional_findings.f1-followup;
      Auditor concurs — must be added to vollos-network concurrently with
      the future Caddy `/api/v1/*` handler.
    recommendation: "Follow-up when a Caddy route for vollos-api is introduced: add `vollos-network` to docker-compose.yml vollos-api networks list."

# ============================================================
# CHECKPOINTS A-F (audit-task.md §Audit Focus)
# ============================================================

checks_performed:
  - id: A
    title: "Checkpoint A — F-1 Port Exposure Fix"
    result: pass
    evidence: |
      (a) docker-compose.prod.yml:L36,L45,L52 apply `ports: !reset []`
          to postgres / vollos-api / auth-service — correct idiomatic Compose
          list-reset.
      (b) Merged-config published-port count verified twice:
          dev default = 3, prod override = 0.
      (c) Caddy intra-network reach preserved (auth-service on internal +
          vollos-network; Caddyfile:L88 reverse_proxy resolves by container
          DNS, not host).
      (d) Docker Compose v5.1.2 — `!reset` tag fully supported (introduced
          v2.24.0, 2024-01). `config --quiet` → exit 0.

  - id: B
    title: "Checkpoint B — F-2 Password Env-Var-Driven"
    result: pass
    evidence: |
      (a) scripts/init-db.sh exists, git mode 100755 (tree), syntax clean
          (`sh -n` exit 0).
      (b) Reads AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD / ACMD_USER_PASSWORD
          with `:?` fail-closed (L25-27). Empty env → script aborts before
          psql runs.
      (c) `:'VAR'` client-side substitution is psql's documented safe
          pattern (escapes ' as ''). No SQL injection via malformed
          password.
      (d) docker-compose.yml:L12-L14 wires the 3 envs into postgres.
      (e) docker-compose.yml:L18 mounts init-db.sh (.sql deleted in same
          commit).
      (f) .env.example:L14-L19 has 3 empty placeholders + comment →
          GitLab CI/CD Variables.
      (g) Tracked-file devpassword grep: 0 matches. Working-tree scan
          (excluding .env + _workspace) also 0.
      (h) History acknowledgment: output.md `residual_risk` documents
          devpassword123 in commits 589e17a + 9b82d41 and the decision
          NOT to filter-branch. Accepted (dev-only, no real users, rotate
          on VPS).
      (i) Minor observation: `--set VAR=${VAR}` exposes password briefly
          in container `ps` — acceptable (container-scoped, init-only).

  - id: C
    title: "Checkpoint C — F-3 CSP Header + 3rd-Party Coverage"
    result: pass
    evidence: |
      (a) infra/Caddyfile:L72 — Content-Security-Policy inside
          (security_headers).
      (b) Every 3rd-party origin in apps/landing/index.html mapped to the
          correct CSP directive (fonts.googleapis.com, fonts.gstatic.com,
          challenges.cloudflare.com, accounts.google.com, www.gstatic.com,
          auth.vollos.ai, data:, mailto:). Independently cross-checked via
          grep on the landing HTML — DevOps enumeration is accurate.
      (c) `caddy validate` inside caddy:2.10.0-alpine → 'Valid configuration'
          exit 0.
      (d) 'unsafe-inline' is a documented concession for L402 inline <script>
          + L18 inline <style>. Filed as SEC-001 (medium) — see new_findings.
          Acceptable temporary state (strictly improves over no-CSP baseline);
          mandatory hardening before landing production traffic.

  - id: D
    title: "Checkpoint D — F-4 Acknowledgment + Timing Spot-Check"
    result: pass
    evidence: |
      (a) output.md:L181-L206 `f4_acknowledgment` has both timestamps
          (`stat -c '%y'` on /tmp/auth-rsa-keys-20260418-165740 →
          2026-04-18 16:57:42 +0700; `git log --format='%ai' a6faef6` →
          2026-04-18 17:00:18 +0700), delta 2m36s, impact=none (/tmp
          outside repo), lesson ("evidence must be verifiable, not
          narrative") recorded.
      (b) Independent timing spot-check on NEW T-003 self_review claims:
          - f1_resolved claim: docker-compose.prod.yml written at
            17:21:37, committed 54954ff at 17:22:34 — delta 57s, order
            correct (write-then-commit). ✅
          - f2_resolved claim: scripts/init-db.sh written at 17:19:18,
            committed e4ae3fc at 17:22:51 — delta 3m33s, order correct. ✅
          - f3_resolved claim: infra/Caddyfile written at 17:20:19,
            committed 07fc133 at 17:23:05 — delta 2m46s, order correct. ✅
      No timing inaccuracy in this round — DevOps learned the F-4 lesson.

  - id: E
    title: "Checkpoint E — New HIGH/CRITICAL Introduced?"
    result: pass
    evidence: |
      (a) 'unsafe-inline' in CSP — classified MEDIUM (SEC-001) not HIGH:
          pre-MR baseline was NO CSP, so this is a strict improvement. A
          proper risk-adjusted severity for a mitigation that improves over
          baseline is below HIGH. Recommended hardening is tracked.
      (b) Shell injection in init-db.sh — none. Script uses `set -eu` (L21),
          `:?` fail-closed (L25-27), no `eval`, no user-supplied argv, no
          command substitution on uncontrolled input. Heredoc <<'EOSQL' is
          single-quoted so shell expansion in SQL is suppressed.
      (c) SQL injection via password — none. psql `:'VAR'` is the canonical
          safe substitution; single-quote escaping is done by psql itself.
      (d) YAML `!reset []` compatibility — verified. Docker Compose v5.1.2
          (local) + introduced in v2.24 (2024-01). `config --quiet` exit 0.
          VPS must run a Compose version ≥ v2.24; noted as an operational
          precondition for Phase 2B.
      (e) Secret leak in diff — none. `git diff … | grep -iE
          '^\\+.*(devpassword|BEGIN.*PRIVATE|sk_live|api_key=)'` → 0.

  - id: F
    title: "Checkpoint F — Architecture + Process"
    result: pass
    evidence: |
      (a) 3 conventional commits (all fix(...)): 54954ff fix(infra), e4ae3fc
          fix(security), 07fc133 fix(security). ✅ rule F6 / K4.
      (b) MR !10 state=opened, source=fix/rs013-deploy-prep-hardening,
          target=main (verified GitLab API). ✅
      (c) Pipeline id 2462342996 status=success on
          07fc13319acecf08648f026ca9e96e5b12705b40. ✅ rule F5.
      (d) Branch protection on main intact: push_access=['No one'],
          merge_access=['Maintainers']. No push to main. ✅ rule F4.
      (e) Files changed = owned_files exactly (6 files, all in task.md
          §Owned Files). No CLAUDE.md / _board.md / _workspace/*/task.md /
          apps/*/src / packages/*/src / migrations / .gitlab-ci.yml
          touched. ✅
      (f) Placeholder grep clean on all 5 changed production files. ✅

# ============================================================
# OTHER REQUIRED SKILL.md FIELDS
# ============================================================

us_privacy_compliance:
  unsubscribe_mechanism: "N/A (no email templates changed this MR)"
  physical_address_in_email: "N/A (no email templates changed)"
  audit_log: "N/A (no audit handlers changed)"
  data_minimization: "N/A (no schema changes; init-db.sh logic unchanged vs init-db.sql — same GRANTs, same schemas)"

skipped_sections:
  - "US Privacy (CAN-SPAM/CCPA) — N/A per audit-task.md: files_changed = infra + config only; no email/lead/user-data code changed"
  - "Application Layer (XSS/SQLi/CSRF/Rate limit) — N/A (no route/handler code changes in this MR)"
  - "Email Layer — N/A (no email templates/sender changes)"
  - "Auth Layer — N/A (no JWT / Google OAuth / cookie code changes; RSA key material is T-002 scope, not T-003)"

conditional_conditions: []   # verdict=pass, no conditions to propagate

# ============================================================
# COMMIT GATE + PLAIN-THAI RATIONALE
# ============================================================

rationale: |
  สรุปแบบเด็ก 12 ขวบอ่านเข้าใจ:

  งาน T-003 (MR !10) = "ซ่อมช่องโหว่ 3 จุดที่ผู้ตรวจ T-002 บอกว่าต้องแก้ก่อนขึ้น VPS"
  ทีม DevOps ซ่อมครบทั้ง 3 จุด และผู้ตรวจ (ผม) ได้ไล่ตรวจทุกคำสั่งซ้ำเอง:

  F-1 (port เปิดทะลุ Caddy) — แก้แล้ว ✅
    สร้างไฟล์ docker-compose.prod.yml ใหม่ ใส่ `ports: !reset []` เพื่อลบ
    host port ทิ้งทั้ง 3 service (postgres, api, auth). ตรวจด้วยคำสั่ง
    `docker compose … config | grep -cE published:` ได้ผล:
      - dev: 3 ports (ใช้ถูก ไว้ curl ทดสอบเครื่องตัวเอง)
      - prod (เพิ่ม -f docker-compose.prod.yml): 0 ports ✅
    Caddy ยังเข้า auth-service ผ่าน network ภายในได้ปกติ (วิ่งผ่าน DNS ชื่อ
    container ไม่ต้องใช้ host port).

  F-2 (password hardcode devpassword123) — แก้แล้ว ✅
    ลบ scripts/init-db.sql ทิ้ง สร้าง scripts/init-db.sh แทน อ่าน password
    จาก env var 3 ตัว (AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD /
    ACMD_USER_PASSWORD). ถ้า env var ว่าง → script ตายทันที (fail-closed
    จาก `:?` ของ shell). ตรวจ working tree + tracked file ไม่มี
    'devpassword' แล้ว. Git history ยังเห็นของเก่า (ลบไม่ได้โดยไม่ทำลาย
    main) — DevOps บันทึก residual_risk และเจ้านายยอมรับ (dev-only + ไม่มี
    user จริง + จะ rotate ตอน VPS apply).

  F-3 (CSP header หาย) — แก้แล้ว ✅
    เพิ่ม Content-Security-Policy ใน infra/Caddyfile:L72 ระบุ directive
    ครบ default-src, script-src, style-src, font-src, img-src, frame-src,
    connect-src, object-src, base-uri, form-action, frame-ancestors.
    ผมไล่ grep ใน apps/landing/index.html เอง เห็นของ 3rd party จริงๆ:
    Google Fonts, Cloudflare Turnstile, Google Sign-In, mailto: — ใน CSP
    ครอบคลุมครบหมด. caddy validate ผ่าน ✅
    ข้อเตือน: CSP มี 'unsafe-inline' เพราะ landing มี inline <script>
    และ inline <style> ใหญ่ๆ อยู่ในหน้า ผมบันทึกเป็น SEC-001 (medium)
    แนะนำให้แยกเป็นไฟล์ .js/.css + ใช้ nonce ก่อน landing รับ traffic
    จริงมากๆ — แต่ไม่บล็อก MR นี้ เพราะก่อนหน้านี้ไม่มี CSP เลย การ
    มี CSP + unsafe-inline ปลอดภัยกว่าไม่มี CSP.

  F-4 (DevOps รอบก่อนเขียน timing ผิด) — ยอมรับแล้ว ✅
    output.md:L181-L206 บันทึกเวลาทั้ง 2 ฝั่ง (keygen 16:57:42 vs
    .gitignore commit 17:00:18 = หลัง 2 นาที 36 วินาที) impact=ไม่มี
    (keys อยู่ /tmp นอก repo) และบันทึกบทเรียน "evidence ต้อง verify ได้"
    ผม spot-check timestamp ของ T-003 self_review 3 เคลม (f1/f2/f3) เอง
    ทุกตัวตรงกับ file mtime + git commit time — รอบนี้ไม่มี timing ผิด

  กระบวนการ ✅:
    - 3 commit conventional ครบ (fix(infra), fix(security), fix(security))
    - MR !10 opened → main (ไม่ push ตรง main — main ยังปกป้องด้วย
      push_access='No one')
    - Pipeline 2462342996 status=success
    - ไฟล์ที่แก้ = owned_files เป๊ะ ไม่แตะของคนอื่น

  สรุป verdict: pass | commit_gate: GO | phase_2b_readiness: ready
    ไม่มี CRITICAL / HIGH หลงเหลือใน MR นี้
    มี 1 medium (SEC-001 CSP 'unsafe-inline') + 2 low notes — เป็น
    hardening follow-up ไม่บล็อก merge ไม่บล็อก Phase 2B
    Phase 2B VPS apply ทำต่อได้เลย หลังเจ้านาย merge MR !10 แล้ว
    upload 3 password ใหม่เข้า GitLab CI/CD Variables (masked + protected)

  หมายเหตุสำหรับ Phase 2B:
    1. VPS ต้องรัน Docker Compose ≥ v2.24 เพื่อรองรับ `!reset` tag
    2. ถ้า postgres data volume เดิมมี user devpassword123 อยู่แล้ว
       → ต้อง drop volume + re-init (output.md §phase_2b_migration_note
       option a, แนะนำ) หรือ ALTER USER password (option b)

completion_signal: "task_id=T-003 verdict=pass findings=3 path=_workspace/T-003/review-auditor.md"

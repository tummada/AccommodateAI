---
task_id: T-044
verdict: pass
working_mode: static-analysis
approved_for_merge: true
residual_risk_accepted: true
summary: |
  T-041 (commit d020d11 on origin/fix/landing-sri) adds SHA-384 SRI +
  crossorigin="anonymous" to Cloudflare Turnstile and intentionally omits
  SRI from Google Identity Services (GSI). The Turnstile hash
  (sha384-rlU7C/+BbRScu+tYTeLQAOB0RMJcPZlIND5YyA+JNAgrhLQhk42O1VkfeAoJEzi/)
  was independently re-fetched and matches bit-for-bit. The GSI no-SRI
  decision is well-documented (inline HTML comment at index.html:L35-44
  pointing to apps/landing/README.md which explains body-byte fluctuation,
  refresh procedure, and the compensating controls).

  Compensating controls for GSI checked and confirmed:
    1. CSP `script-src` pins exact origins `https://accounts.google.com`,
       `https://challenges.cloudflare.com`, `https://www.gstatic.com` —
       no wildcard, no data:/blob: (infra/Caddyfile:L107).
    2. Server-side Google ID-token verification via google-auth-library
       `OAuth2Client.verifyIdToken` (apps/api/src/auth/googleJwt.ts:L17-21)
       handles JWKS fetch + signature + `aud` + `iss` + `exp` internally,
       plus an explicit `email_verified` check (L36-38). A tampered GSI
       bundle cannot forge a valid Google-signed ID token.

  Residual risk (GSI no-SRI): an attacker who compromises
  accounts.google.com/gsi/client could exfiltrate credentials or inject
  UI. This is a supply-chain risk at Google scale — in practice blocked
  by Google's own infrastructure controls and already visible via server-
  side JWT verification (fake tokens are rejected). The CSP script-src
  pin prevents cross-origin substitution. Residual risk is ACCEPTED as
  an upstream limitation until Google publishes a pinned/stable endpoint
  (per README.md refresh policy).

  One pre-existing HIGH observation retained (NOT introduced by T-041):
  `script-src` includes `'unsafe-inline'` (Caddyfile:L107) because the
  landing page relies on a large inline `<script>` at index.html:L402+
  and inline event handlers. This weakens XSS defense-in-depth but is
  documented (Caddyfile:L58-59) and out of scope for T-041. Recommend
  a follow-up task to externalise the inline script and replace
  'unsafe-inline' with nonce/hash, but this is NOT a merge blocker for
  T-041 because T-041 does not add new inline handlers.

skill_loaded_evidence:
  files_read:
    - "/home/ipon/.claude/skills/vollos-auditor/SKILL.md:L60 — 'อ่าน SKILL.md ก่อน — Lead ระบุ path ใน spawn prompt'"
    - "/home/ipon/.claude/skills/vollos-auditor/SKILL.md:L239 — 'Google JWT ต้องตรวจ server-side verify เสมอ — ห้าม trust client claim'"
    - "/home/ipon/.claude/skills/vollos-auditor/SKILL.md:L136-144 — Verdict Policy table"

files_reviewed:
  - "apps/landing/index.html @ origin/fix/landing-sri: lines 14-45 (SRI block) + 253-260 (Google button) + 580-600 (initGoogleSignIn)"
  - "apps/landing/README.md @ origin/fix/landing-sri: lines 1-94 (full file, new)"
  - "infra/Caddyfile @ origin/main: lines 45-116 (security_headers snippet including CSP)"
  - "apps/api/src/auth/googleJwt.ts @ origin/fix/landing-sri: lines 1-48 (full file)"
  - "apps/api/src/routes/leads.ts @ origin/fix/landing-sri: lines 1-100 (Google lead handler wiring)"
  - "git log d020d11 — commit message reviewed"
  - "git diff origin/main..origin/fix/landing-sri --stat — 2 files, +120 -1"

greps_executed:
  - "git show origin/fix/landing-sri:apps/landing/index.html | grep -n 'integrity\\|crossorigin\\|sha384\\|accounts.google\\|challenges.cloudflare' → L16,L25,L27,L43 match"
  - "git show origin/fix/landing-sri:apps/landing/index.html | grep -n 'GOOGLE_CLIENT|client_id|data-client_id|gsi|accounts.google' → L43 script tag, L257 data-client_id=..., L592 client_id: clientId (hardcoded ID)"
  - "git show origin/main:infra/Caddyfile | grep -n 'script-src|unsafe-inline|unsafe-eval' → L107 Content-Security-Policy contains 'unsafe-inline' in script-src and style-src; no 'unsafe-eval'"
  - "curl -sL -A 'Mozilla/5.0' https://challenges.cloudflare.com/turnstile/v0/api.js | openssl dgst -sha384 -binary | openssl base64 -A → 'rlU7C/+BbRScu+tYTeLQAOB0RMJcPZlIND5YyA+JNAgrhLQhk42O1VkfeAoJEzi/' (matches committed integrity attr at index.html:L26 EXACTLY)"
  - "git ls-tree -r origin/fix/landing-sri --name-only | grep -iE 'auth|google|leads' → apps/api/src/auth/googleJwt.ts + apps/api/src/routes/leads.ts confirmed"

scope_compliance:
  files_changed_vs_owned: "match — T-041 touched only apps/landing/index.html (+26/-1) and apps/landing/README.md (+94 new). Both are frontend territory and owned by vollos-frontend. No unauthorised files modified."

# ────────────────────────────────────────────────────────────────────────────
# Checklist verdict per item (from task.md Audit Checklist)
# ────────────────────────────────────────────────────────────────────────────
checklist_verdicts:
  "1_sha384_used":          "🟢 PASS — `integrity=\"sha384-rlU7C/...\"` at apps/landing/index.html:L26. SHA-384 chosen (not SHA-256) ✓"
  "2_crossorigin_anonymous": "🟢 PASS — `crossorigin=\"anonymous\"` present at apps/landing/index.html:L27 on every <script> with integrity=. Turnstile is the only such script."
  "3_hash_matches_live":     "🟢 PASS — independently re-fetched live Turnstile bundle → sha384 base64 = 'rlU7C/+BbRScu+tYTeLQAOB0RMJcPZlIND5YyA+JNAgrhLQhk42O1VkfeAoJEzi/' — matches index.html:L26 byte-for-byte."
  "4_all_scripts_accounted": "🟢 PASS — Two external <script src> tags: Turnstile (SRI applied L25-28) + GSI (SRI omitted with inline justification L35-44 + README reference). No other external scripts."
  "5_inline_fetch_no_sri":   "🟢 PASS — inline script at L402+ uses fetch() only for same-origin (/api/v1/*). No dynamic import() of external URL. CSP connect-src pins 'self' + auth.vollos.ai + accounts.google.com + challenges.cloudflare.com (Caddyfile:L107)."
  "6_gsi_decision_commented":"🟢 PASS — inline HTML comment at apps/landing/index.html:L35-44 states 'SRI NOT APPLIED (intentional)' + points to apps/landing/README.md + explicit 'Do NOT add integrity= here' guard-rail."
  "7_readme_states_why":     "🟢 PASS — apps/landing/README.md:L40-46 documents body fluctuation evidence (observed 265504, 265540, 265541 bytes within seconds) + attributes to experiment/feature-flag injection. Verification command provided L54-61."
  "8_readme_lists_mitigations": "🟢 PASS — apps/landing/README.md:L66-79 lists 4 compensating controls: CSP script-src origin restriction, COOP/COEP + Referrer-Policy, server-side ID-token verification, monitor Google release notes."
  "9_csp_pins_exact_origins":"🟢 PASS — infra/Caddyfile:L107 `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com` — exact origins, no *.google.com wildcard, no data:/blob:."
  "10_csp_no_unsafe":        "🟡 PARTIAL — 'unsafe-inline' IS present in script-src (Caddyfile:L107). This is pre-existing (documented L58-59 as 'required until the landing inline <script> is moved to an external file with a nonce') and NOT introduced by T-041. 'unsafe-eval' is NOT present ✓. Tracked as follow-up below (F-T041-NN-1), not a T-041 merge blocker."
  "11_server_side_jwt_verify":"🟢 PASS — apps/api/src/auth/googleJwt.ts:L17-21 calls `client.verifyIdToken({ idToken: credential, audience: process.env['GOOGLE_CLIENT_ID'] })`. google-auth-library internally fetches Google's JWKS (https://www.googleapis.com/oauth2/v3/certs), verifies RS256 signature, checks `iss` (accounts.google.com / https://accounts.google.com), `aud` (==GOOGLE_CLIENT_ID env), and `exp`. Additional defense: `email_verified` enforced at L36-38, empty payload/sub/email rejected at L23-41. Wired into POST /api/leads/google at apps/api/src/routes/leads.ts:L14."
  "12_client_id_env_or_hardcoded": "🟡 MIXED — Backend: env-driven via `process.env['GOOGLE_CLIENT_ID']` (apps/api/src/auth/googleJwt.ts:L13 + L21) ✓. Frontend landing: HARDCODED at apps/landing/index.html:L257 (`data-client_id=\"824360586771-...\"`) and L591 (`var clientId = '824360586771-...'`). Google client_id IS public by design (displayed in OAuth popup URL), so hardcoding is not a secret leak — LOW finding, not a blocker. If client_id rotates, static HTML must be re-deployed."
  "13_refresh_procedure_sound":  "🟢 PASS — apps/landing/README.md:L25-35 gives the exact `curl … | openssl dgst -sha384 -binary | openssl base64 -A` command, instructs to prepend 'sha384-' and replace the attr. Walkthrough is internally consistent with the live fetch I just executed. Detection signals (L39-46) correctly identify the visible failure modes."
  "14_monitoring_hook":      "🟡 NOTE — no CSP `report-uri` / `report-to` directive in infra/Caddyfile:L107 and no Sentry wiring to observe Turnstile load failures. README:L39-46 only describes manual detection. Recommend follow-up (F-T041-NN-2), not a T-041 merge blocker since SRI mismatch fails-loud in DevTools + widget disappears."
  "15_a08_residual_risk":    "🟢 PASS (risk accepted) — Turnstile: SRI + CSP origin pin = adequate supply-chain mitigation. GSI: CSP origin pin + server-side JWKS/aud/iss/exp verification is the best available compensating control until Google exposes a stable-hash endpoint. RESIDUAL_RISK_ACCEPTED."

security_findings:
  - id: F-T041-NN-1
    severity: "low"
    cvss_estimate: "~3.5 (estimated, CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N)"
    category: "headers (CWE-693, API8:2023)"
    description: "CSP script-src includes 'unsafe-inline' (pre-existing, NOT introduced by T-041). An XSS payload could execute inline despite the origin pin. Mitigation today: no user-generated HTML is rendered by the static landing page; input is sanitised via sanitize-html server-side (apps/api/src/routes/leads.ts:L56). Tracked here for visibility so it does not silently persist."
    file: "infra/Caddyfile:L107"
    evidence: "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com"
    recommendation: "Follow-up task (out of T-041 scope): move inline <script> from apps/landing/index.html:L402+ into apps/landing/app.js, add a CSP nonce via Caddy request_header placeholder, then drop 'unsafe-inline' from script-src in infra/Caddyfile:L107. Self-check with `curl -I https://vollos.ai | grep -i content-security-policy` after rollout."

  - id: F-T041-NN-2
    severity: "low"
    cvss_estimate: "~2.5 (estimated — observability gap, not exploitable)"
    category: "supply_chain (A03:2025)"
    description: "No CSP reporting endpoint nor Sentry hook to detect Turnstile SRI mismatch or GSI script substitution in production. Detection today relies on a visitor noticing the CAPTCHA does not render (README.md:L39-46). Given Turnstile rolls silently, a broken integrity attr could block submissions silently for hours."
    file: "infra/Caddyfile:L107"
    evidence: "Content-Security-Policy header has no report-uri / report-to directive, and there is no server route that collects CSP violations."
    recommendation: "Follow-up task: add `report-to csp-endpoint` + a `Report-To` header in infra/Caddyfile security_headers snippet; add a lightweight POST /api/v1/csp-report handler in apps/api/src/routes/ that forwards to Sentry or logs to Caddy access.log. Alternative: UptimeRobot keyword check on vollos.ai for the Turnstile widget id."

  - id: F-T041-NN-3
    severity: "low"
    cvss_estimate: "~2.0 (estimated — operational, not confidentiality impact)"
    category: "api_inventory (API9:2023)"
    description: "Google client_id is hardcoded in apps/landing/index.html:L257 + L591. Client_id IS public (not a secret), so no confidentiality impact. However if the project rotates OAuth credentials, the static HTML must be re-deployed to match the backend GOOGLE_CLIENT_ID env. Backend path is already env-driven (apps/api/src/auth/googleJwt.ts:L13)."
    file: "apps/landing/index.html:L257"
    evidence: "data-client_id=\"824360586771-a2itk7k825qs22n33m33774jtqlf1vem.apps.googleusercontent.com\" (and duplicate at L591: var clientId = '824360586771-...')"
    recommendation: "Follow-up task: template client_id via a tiny build-step (or Caddy `replace` directive) that injects process.env['GOOGLE_CLIENT_ID'] at deploy time, so rotation = one env change + docker compose up, not an HTML edit. Keep both L257 and L591 in sync with a single variable."

us_privacy_compliance:
  unsubscribe_mechanism: "present"    # apps/api/src/routes/leads.ts:L49 generateUnsubscribeToken — out of T-041 scope but verified present
  physical_address_in_email: "N/A — T-041 does not touch email templates"
  audit_log: "present"                # apps/api/src/routes/leads.ts:L94 db.insert(auditLogs) — out of T-041 scope but confirmed present
  data_minimization: "ok — T-041 adds no new data collection; SRI is client-side integrity only"

skipped_sections: []
conditional_conditions: []

# ────────────────────────────────────────────────────────────────────────────
# Explicit verdict flags for Lead
# ────────────────────────────────────────────────────────────────────────────
approved_for_merge: true
residual_risk_accepted: true

completion_signal: "task_id=T-044 verdict=pass findings=3 path=_workspace/T-044/review-auditor.md"

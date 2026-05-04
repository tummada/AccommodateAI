---
id: T-011
title: RS-013 Phase 2C Track 1 — E2E test on production (AI, browser automation)
assigned_to: vollos-e2e-tester
priority: high
status: in_progress
spawn_started_at: 2026-04-18T20:17:30+07:00
security_checkpoint: false  # read-only probe tests, no state change
domain_consultation:
  expert: none_applicable
  rationale: "vollos-core is infra repo. Only domain expert (vollos-support) is customer support — not technical E2E. Lead writes test scenarios inline based on RS-013 deploy architecture knowledge from this session."
  key_points_inline: true  # see Test Scenarios below
dependencies:
  - T-010 (rotation complete — production ready + stable)
---

## Context

RS-013 deploy is LIVE on production (T-007 + T-008 + T-009 + T-010 done). Now verify user-facing behavior via browser automation.

**Scope:** Track 1 (AI Playwright, automated, on REAL production — vollos.ai + auth.vollos.ai). Track 2 (owner manual Google login) is separate.

**Honest scope limitation:** Google OAuth real-flow **cannot** be AI-automated on production because:
- auth-service validates Google JWT signature with Google's real public keys (no test-mode backdoor in production code)
- Mocking Google at Playwright level would require backdoor code change in auth-service = not acceptable for production
- Real Google test account = credentials issue (owner policy: never share OAuth creds with AI)

→ AI Track 1 focuses on **infrastructure + security + integrity** probes. Track 2 (owner) handles actual login UX.

## Test Scenarios (9 checks)

### Infrastructure + HTTPS (5 checks)

1. **vollos.ai loads via HTTPS**
   - Navigate `https://vollos.ai/` — status 200
   - Check cert chain valid (no browser security warning)
   - Check response time < 5s
   - Assert: HTTP/2 or HTTP/3 (`curl -I -w %{http_version}`)

2. **auth.vollos.ai loads via HTTPS**
   - `https://auth.vollos.ai/health` → 200 + body `{"status":"ok"}`
   - Cert chain valid

3. **JWKS integrity**
   - `https://auth.vollos.ai/.well-known/jwks.json` → valid JSON
   - Has at least 1 key with `kty: "RSA"`, `alg: "RS256"`, `use: "sig"`
   - Public key DER-SPKI SHA256 matches `f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c` (T-002 baseline)

4. **Security headers present**
   On `https://auth.vollos.ai/` response headers:
   - `Strict-Transport-Security` (HSTS) present with max-age ≥ 31536000 (1 year)
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy` present
   - `Content-Security-Policy` present
   - `Server` header should NOT contain `Caddy` version (stripped per Caddyfile config)

   Same checks on `https://vollos.ai/` (landing).

5. **www redirect**
   - `https://www.vollos.ai/` → 301 or 308 redirect to `https://vollos.ai/`
   - **IF DNS www A-record missing (F-4 from T-007)** → this check will fail with DNS_NOT_FOUND → mark as `expected_fail_pending_owner_action` (not a regression)

### Auth endpoints (2 checks)

6. **Protected endpoint without token returns 401**
   - `GET https://auth.vollos.ai/auth/refresh` (or `/me` if exists) without Authorization header → expect 401 (NOT 500, NOT 200)

7. **Invalid token returns 401**
   - Same endpoint with `Authorization: Bearer invalid.token.here` → expect 401

### Landing form (1 check, regression guard)

8. **Lead capture form on vollos.ai**
   - Navigate `https://vollos.ai/`
   - Locate lead capture form (input fields: name, email, company — selectors depend on landing HTML, e2e-tester explores)
   - **SKIP submit** — we don't want to pollute production DB with test records
   - Assert form fields render + submit button clickable
   - Alternative: if landing has a demo submit action that doesn't persist → OK to test
   - Document what's present + what was tested in output

### CORS boundary (1 check)

9. **CORS rejection from non-allowlisted origin**
   - Use Playwright to make `fetch('https://auth.vollos.ai/auth/refresh', {method: 'POST', credentials: 'include'})` from a context with origin `https://evil.example.com` (via page with that origin in headers, or direct curl with `-H "Origin: https://evil.example.com"`)
   - Expect CORS rejection (either 403 or missing `Access-Control-Allow-Origin` header)
   - Verify AUTH_CORS_ORIGINS allowlist works (from VPS .env: `https://acmd.vollos.ai,https://vollos.ai`)

## Acceptance Criteria

- All 9 checks executed + documented
- Checks 1-4, 6-7 must all PASS — if any fails = production has real issue
- Check 5 (www redirect) can be `expected_fail_pending_F-4` (owner hasn't added DNS yet)
- Check 8 form test = exploratory, PASS if form renders (don't fail task for form absence, just document)
- Check 9 CORS = must PASS (security critical)

## Output

```yaml
task_id: T-011
status: passed | failed | partial
test_ran_at: <iso>
test_ran_from: "Lead workstation via Playwright (Chromium headless)"

checks_performed:
  - id: C-1
    title: "vollos.ai HTTPS loads"
    result: pass | fail
    evidence: "curl -I https://vollos.ai → HTTP/2 200, cert issuer=Cloudflare Origin CA, response_time_ms=N"
  - id: C-2
    ...

jwks_fingerprint_verification:
  expected: f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c
  actual: <sha256>
  match: true|false

security_headers_audit:
  auth_vollos_ai:
    hsts_max_age: N
    x_frame: DENY
    csp_present: true
    server_leaked: true|false
  vollos_ai:
    ...

cors_probe:
  origin_sent: https://evil.example.com
  expected: blocked (403 or missing ACAO)
  actual: <details>
  passed: true

form_exploration:
  url: https://vollos.ai/
  form_selector_found: "form#lead-capture" (or similar)
  fields_detected: [name, email, company]
  submit_action_target: <url>
  tested_submit: false (pollution concern)

issues_found: []
expected_fails:  # pre-known, not regressions
  - check: C-5 www redirect
    reason: "F-4 from T-007 — owner hasn't added www A-record at Cloudflare yet"

track_2_handoff:
  description: "AI Track 1 complete. Owner Track 2 = manual Google login smoke test on browser. Owner navigates vollos.ai, clicks Sign In, completes Google OAuth, verifies cookie + redirect + session persistence."
  owner_action_instructions: |
    1. เปิด browser (Chrome แนะนำ)
    2. ไปที่ https://vollos.ai (หรือ https://auth.vollos.ai ถ้า landing ไม่มี login button)
    3. กด Sign in with Google (ถ้ามี) หรือปุ่ม login
    4. ทำ OAuth flow กับ Google account ตัวไหนก็ได้ (account ส่วนตัวก็ได้ ไม่ต้องให้ผม)
    5. Expected: redirect กลับมา + หน้าเปลี่ยนไปที่ dashboard/onboarding/หน้าที่ next step
    6. เช็ค DevTools → Application → Cookies: ต้องมี cookie ของ auth service
    7. Refresh browser: ยังควร login อยู่ (session persistence)
    8. รายงานเจ้าทีมผล pass/fail + screenshot (ซ่อน cookie value)
```

## Rules

- Read `CLAUDE.md` § D/J/K
- Read `_workspace/T-002/output.md` for JWKS fingerprint ground truth
- **Never submit to forms that persist data** — production DB should stay clean
- **Never login with real Google account** (Track 2 owner responsibility)
- **Never save credentials or cookies in output** — if captured accidentally → fingerprint only
- Screenshot OK for evidence — but save outside repo (e.g., `/tmp/t011-screens/`), clean up after
- If a check surfaces unexpected issue (e.g., 500 error on /health) → flag as CRITICAL + stop, don't continue other tests
- Estimated AI-elapsed: 15-25 min

Begin.

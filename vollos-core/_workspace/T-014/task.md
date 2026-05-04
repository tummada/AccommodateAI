---
id: T-014
title: RS-013 Phase 2C — Fix Google One Tap login (3 errors from owner manual smoke)
assigned_to: vollos-devops (diagnose all 3 + fix infra), hand off 500 to Backend if logic bug
priority: high
status: in_progress
spawn_started_at: 2026-04-18T20:59:07+07:00
security_checkpoint: true  # CSP change + COOP change touches security posture
domain_consultation: null
dependencies:
  - T-013 deployed (Caddy routing fix live)
blocks:
  - RS-013 DONE (Track 2 owner smoke failed)
---

## Context

Owner ran Phase 2C Track 2 manual smoke test. **BOTH tests failed:**

**Test 1 — Lead Capture Form:** submit → error "Something went wrong. Please try again." (frontend generic error = API returned non-2xx)

**Test 2 — Google One Tap:** 3 errors in console:
1. **`/api/v1/leads/google` → HTTP 500** (backend server error)
2. **Cross-Origin-Opener-Policy policy would block the window.postMessage call** (x4 — Google popup → parent message)
3. **CSP violation:** `'style-src'` blocks `https://accounts.google.com/gsi/style`

→ Both tests = backend API issues. T-012/T-013 fixed routing, but **API handler logic fails** on actual requests.

## 3-part investigation

### Part A — CSP fix (confirmed root cause)

Current `infra/Caddyfile:L82` CSP:
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
```

Missing: `https://accounts.google.com` (Google One Tap loads gsi/style from there)

**Fix:** Add to style-src directive:
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com
style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com
```

Note: browser uses `style-src-elem` for `<link rel="stylesheet">` if set, else falls back to `style-src`. Best to set both explicitly.

### Part B — COOP investigation

Browser reports COOP blocks postMessage. Our explicit response headers don't show COOP (per Lead curl). But browser still blocks.

Possible sources:
- Cloudflare edge adding COOP (check CF dashboard → Security → Settings)
- Caddy default (check `caddy:2-alpine` behavior)
- Browser policy on `https` origin with certain COEP settings

**Investigation steps:**
1. SSH VPS + run `curl -v https://vollos.ai/ 2>&1 | grep -i cross-origin` from inside VPS (bypass CF?)
2. If COOP present → identify source (Caddy adds it by default? or Cloudflare?)
3. Fix: add explicit `Cross-Origin-Opener-Policy same-origin-allow-popups` in `(security_headers)` snippet — this allows popup postMessage while still providing isolation
4. Alternative if CF sets it: disable in CF dashboard

**Security impact assessment:**
- `unsafe-none` — no isolation, any popup can postMessage freely (too permissive)
- `same-origin-allow-popups` — **recommended** — same-origin isolation BUT popups we open can postMessage
- `same-origin` — strict, breaks Google One Tap popup
→ Use `same-origin-allow-popups`

### Part D — Test 1 Lead Capture form error (CRITICAL — equal priority to Part C)

**Symptom:** owner submits form on vollos.ai → frontend shows "Something went wrong. Please try again."

**Diagnosis steps:**
1. Find lead capture POST endpoint — check `apps/landing/index.html` or JS for the form's `action=` or `fetch(...)` URL
   - Likely candidates: `POST /api/v1/leads`, `POST /api/v1/lead`, or similar
2. SSH VPS → `docker compose logs --tail=200 vollos-api 2>&1 | grep -iE "error|exception|4[0-9][0-9]|5[0-9][0-9]|POST /api"` (filter for recent errors)
3. Identify: which endpoint? what error code? what exception?
4. `docker exec vollos-core-api env | grep -iE "(DATABASE|TURNSTILE|SMTP|GMAIL|UNSUBSCRIBE)" | sed 's/=.*/=***/'` (check env vars present by NAME only)

**Likely causes (ordered by probability):**
- CSRF validation failed (frontend now gets token from /api/v1/csrf, but might not send back correctly)
- Turnstile verification failed (missing TURNSTILE_SECRET_KEY or wrong key)
- DB insert failed (schema or unique constraint)
- Email send failed (Nodemailer OAuth2 issue — GMAIL_USER + GOOGLE_REFRESH_TOKEN)
- Generic unhandled exception in handler

**Common flow to check:**
1. POST /api/v1/leads with CSRF token (from /api/v1/csrf)
2. Validate CSRF (double-submit cookie)
3. Verify Turnstile captcha token (call Cloudflare API)
4. Sanitize + validate input (Zod schema)
5. INSERT INTO leads table
6. Send auto-reply email (Nodemailer)
7. Return 200 {ok: true}

Any step can fail → 500.

### Part C — 500 error on /api/v1/leads/google (Google One Tap path)

**Diagnosis steps:**
1. SSH VPS → `docker compose logs --tail=100 vollos-api 2>&1 | tail -60` (last 500 error timestamp should appear)
2. Look for:
   - Stack trace with exception
   - Missing env var message
   - DB connection error
   - Google JWT verification failure

**Likely causes (ordered by probability):**
- `GOOGLE_CLIENT_ID` env var missing or wrong — check `docker exec vollos-core-api env | grep GOOGLE` (mask values in output)
- Google JWT verification library throws on unexpected token format
- DB insert to `public.leads` or `vollos.leads` failed (schema mismatch?)
- Request body parsing error

**Fix scope:**
- If env var missing → add to GitLab CI/CD Variables + regen VPS .env + restart api
- If code bug → **flag to Lead, spawn Backend agent** (this task's DevOps scope ends)

## Acceptance Criteria

1. **Root cause identified for all 4 errors** with evidence (log lines, curl output) — Test 1 lead capture + Test 2 (3 sub-errors)
2. CSP fix: `infra/Caddyfile` updated with `https://accounts.google.com` in style-src + style-src-elem
3. COOP fix: explicit header in `(security_headers)` snippet — `Cross-Origin-Opener-Policy same-origin-allow-popups`
4. 500 error root cause documented — if infra issue (env var) → fix; if code bug → flag for Backend
5. Commit to branch `fix/rs013-google-onetap` + MR to main
6. Pipeline green
7. `caddy validate` + `docker compose config` pass
8. Post-merge deploy runbook documented (SSH + pull + caddy reload)

## Owned Files

- `infra/Caddyfile` (CSP + COOP)
- No code changes to apps/ — if 500 needs code fix, flag to Backend

## Forbidden

- CLAUDE.md, _board.md, _workspace/*/task.md
- apps/*/src/**, packages/*/src/** (Backend territory if code fix needed)
- Push to main
- Commit secrets

## Expected Output

```yaml
task_id: T-014
status: passed | partial | blocked
branch: fix/rs013-google-onetap
commit_sha: <sha>
mr_iid: <N>

diagnosis:
  error_1_500:
    root_cause: "..."
    log_evidence: "<snippet, redacted values>"
    fix_type: "infra (env var) | code (Backend needed) | not_determined"
  error_2_coop:
    source_identified: "Caddy default | Cloudflare | other"
    evidence: "curl -v from VPS internal vs external"
    fix_applied: "Cross-Origin-Opener-Policy same-origin-allow-popups"
  error_3_csp:
    confirmed_missing: "accounts.google.com in style-src"
    fix_applied: true

caddyfile_changes:
  csp_updated: true
  style_src_new: "..."
  style_src_elem_added: true
  coop_added: "same-origin-allow-popups"

500_fix_status:
  type: "infra applied | backend handoff"
  backend_handoff_details: |
    (if code bug) Backend agent must investigate:
    - file: apps/api/src/leads/google.ts (or wherever)
    - issue: [specific error from logs]
    - required env vars: [list]

validation:
  caddy_validate: "Valid"
  compose_config: "exit 0"

post_merge_deploy_runbook: |
  ssh VPS → cd ~/vollos-core → git pull
  docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --no-deps caddy
  # Re-test Google One Tap from browser
  # Check /api/v1/leads/google returns 200 (or clear error, not 500)

self_review: ...
```

## Rules

- Read `CLAUDE.md` § D (Docker), J (Secrets), K (Code Quality)
- Read `_workspace/T-011/output.md` + `_workspace/T-013/output.md` for context
- **Never display secrets** — if GOOGLE_CLIENT_ID is found mismatched, use sha256 first-8 fingerprint
- **Security impact**: COOP relaxation acceptable trade-off for Google One Tap to work; CSP relaxation minimal (adding known Google domain)
- If 500 is code bug → this task delivers infra fix (CSP+COOP) + clear handoff spec for Backend
- Estimated: ~20-30 min

Begin with Part C (500 diagnosis) — most critical. Parallel A+B can be fixed in same MR.

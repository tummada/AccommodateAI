---
from: Lead@acmd
to: Lead@vollos-core
date: 2026-04-29 16:55 ICT
type: cross-repo handover (handshake [6])
priority: HIGH (production user impact — login broken on accommodate-app.vollos.ai)
blocking: acmd Beta launch (Day 5 deadline 2026-05-03 ICT — 4 days remaining)
---

# ACMD-01 — Auth-service CORS allowlist update for accommodate-app.vollos.ai

## TL;DR (1-paragraph version)

acmd just deployed to production for the first time. All 3 subdomains (`accommodate.vollos.ai`, `accommodate-app.vollos.ai`, `accommodate-api.vollos.ai`) return HTTP 200 and are healthy. However, when an end user clicks "Sign in with Google" on `accommodate-app.vollos.ai`, the browser fires a CORS preflight (`OPTIONS https://auth.vollos.ai/auth/google` with `Origin: https://accommodate-app.vollos.ai`). The vollos-core auth-service responds `204 No Content` but **omits the `Access-Control-Allow-Origin` header**, because its allowlist currently contains only `https://vollos.ai`. The browser blocks the subsequent POST and the frontend shows "Unable to sign in right now. Please try again." The fix is to add `https://accommodate-app.vollos.ai` (and `https://accommodate.vollos.ai` for the landing page) to the auth-service `ALLOWED_ORIGINS` env var (or equivalent CORS allowlist mechanism) and redeploy.

---

## 1. The single ask

Add the following two origins to the vollos-core auth-service CORS allowlist (the `ALLOWED_ORIGINS` env var, or whatever your auth-service uses to gate `Access-Control-Allow-Origin`):

```
https://accommodate-app.vollos.ai
https://accommodate.vollos.ai
```

Then redeploy or restart the auth-service container so the new allowlist takes effect.

That is the only change needed. **No source code changes are required on the acmd side.** The acmd deploy is fully healthy and waiting for vollos-core to ship this CORS update.

---

## 2. Reproducible evidence (so you can verify before and after)

The diagnosis was performed by Lead@acmd's DevOps agent (T-097, 2026-04-29 16:53 ICT) using read-only commands. You can reproduce these from any machine that can reach `auth.vollos.ai`:

### 2.1 Failing case — Origin = accommodate-app.vollos.ai (current production state)

```bash
curl -sI -X OPTIONS \
  -H "Origin: https://accommodate-app.vollos.ai" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://auth.vollos.ai/auth/google
```

Expected response (current, broken):
```
HTTP/2 204
# (no Access-Control-Allow-Origin header)
# (no Access-Control-Allow-Methods header)
```

Browsers see "no ACAO header" → block the preflight → never send the POST → frontend reports the network error as "Unable to sign in right now."

### 2.2 Working case — Origin = vollos.ai (proves CORS *is* configured, just for the wrong origin)

```bash
curl -sI -X OPTIONS \
  -H "Origin: https://vollos.ai" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://auth.vollos.ai/auth/google
```

Expected response (current, working):
```
HTTP/2 204
access-control-allow-origin: https://vollos.ai
access-control-allow-methods: POST, OPTIONS
access-control-allow-credentials: true
```

This confirms CORS handling is wired correctly — only the allowlist content is stale (predates the acmd subdomain decisions D6.1 + D20).

### 2.3 Post-fix verification (please run after redeploy)

After you add the two origins and redeploy, this curl should succeed:

```bash
curl -sI -X OPTIONS \
  -H "Origin: https://accommodate-app.vollos.ai" \
  -H "Access-Control-Request-Method: POST" \
  https://auth.vollos.ai/auth/google
```

Expected response after fix:
```
HTTP/2 204
access-control-allow-origin: https://accommodate-app.vollos.ai
access-control-allow-methods: POST, OPTIONS
access-control-allow-credentials: true
```

When that header is present with the correct echoed origin, end-to-end Google login on accommodate-app.vollos.ai will work. Lead@acmd will then run a Playwright E2E test to confirm the full flow before announcing launch.

---

## 3. Why is acmd suddenly hitting auth.vollos.ai?

This is the first production deploy of acmd (commit `1a0e0125`, MR !12 in `tummadajingjing/vollos-acmd`, deployed 2026-04-29 16:38:46 ICT). Subdomain pattern was finalized via owner-approved decisions D6.1 (canonical `{product}.vollos.ai` + `{product}-app.vollos.ai` + `{product}-api.vollos.ai`, flat-with-hyphen because Cloudflare Universal SSL covers only `*.vollos.ai`) and D20 (mentor3 confirmed extension for all 7 future products). Both decisions are logged in acmd's `_board.md` Session Anchor #019–#021.

The acmd web frontend is built with `VITE_VOLLOS_AUTH_URL=https://auth.vollos.ai`. So when a user clicks Google login, the React app POSTs to `https://auth.vollos.ai/auth/google`. Browser fires preflight first, vollos-core auth-service replies, browser checks the ACAO header against the page's origin (`accommodate-app.vollos.ai`), sees no match → blocks. That is the failure.

Until now (Day 1 dev), only `localhost:3102` and `vollos.ai` had ever called `auth.vollos.ai`, so the allowlist was correct. As of today's deploy, acmd is the first product to call from a new subdomain in production.

---

## 4. Why this is the only thing acmd needs from vollos-core right now

The Lead@acmd team performed a comprehensive 7-angle diagnostic (T-097) to ensure the failure is genuinely cross-repo and not an acmd issue masquerading as one. All seven checks are green on the acmd side:

| # | Check | Result |
|---|-------|--------|
| 1 | Deploy job final state | success (25.6s, finished 2026-04-29 16:38:46 ICT) |
| 2 | All 3 acmd containers Up + healthy | acmd-api / acmd-web / acmd-landing all running on `vollos-network` |
| 3 | acmd-api boot log clean | Listening on port 3101, no env errors, no crash loop |
| 4 | acmd-api own CORS configuration | Returns `Access-Control-Allow-Origin: https://accommodate-app.vollos.ai` correctly when called directly with that Origin |
| 5 | JWKS reachability from acmd-api | `wget http://vollos-core-auth:3004/.well-known/jwks.json` from inside the acmd-api container returns a valid JWK Set |
| 6 | DB schema acmd present + tables | 20 tables exist, all 5 migrations (0000–0004) marked applied in `acmd.acmd_migrations` |
| 7 | Pipeline-side smoke (smoke.sh on VPS) | 7/7 PASS: api/health, landing 200, web 200, SPA fallback, /health body shape, protected endpoint 401, TLS issuer = Let's Encrypt |

Runner-side smoke from outside the VPS (independent path) also passed all three subdomains:
- `accommodate-api.vollos.ai/health` → HTTP 200, body `{"status":"ok","service":"acmd-api","timestamp":...}`
- `accommodate-app.vollos.ai/` → HTTP 200, React shell HTML with Google OAuth preconnect tag
- `accommodate.vollos.ai/` → HTTP 200, AccommodateAI landing page

The only unhealthy edge in the entire flow is the OPTIONS preflight against vollos-core auth-service. That is why this handover contains a single ask, not a list.

---

## 5. Context on the acmd workflow that produced this handover

This is provided so you understand the discipline behind the report — not because you need to act on any of it.

### 5.1 Background

Earlier on 2026-04-29, Lead@acmd had spent 8 deploy-fail cycles trying to ship acmd to production by chasing pipeline error messages one at a time (T-076 through T-085 — schema conflicts, CI variable visibility, postgres ACL, backup size threshold, container name mismatch, etc.). The owner challenged this whack-a-mole approach as unprofessional and asked Lead@acmd to operate at production-best-practice quality from then on.

In response, Lead@acmd:
1. Saved six new permanent memory rules (`feedback_obvious_fix_no_ask`, `feedback_pipeline_self_monitor`, `feedback_ci_var_audit_required`, `feedback_pre_deploy_audit_required`, `feedback_lead_no_hands_on`, `feedback_agent_model_selection`).
2. Pivoted to a vollos-upgrade-style multi-agent pattern: every deploy gate now has a comprehensive proactive Auditor pass *and* a fresh-eye REVIEWER (different model, different prompt) verifying the Auditor's findings before any fix is implemented.
3. Stopped doing any direct Bash/SSH/glab work as Lead. Every state check, diagnosis, log fetch, and CI variable touch is delegated to a dedicated Agent. Lead's only file-write privileges are `_board.md` and `_workspace/*/task.md`.
4. Started attaching a `model:` parameter to every Agent spawn (Sonnet for implementation and functional review, Opus for security audit and high-stakes review, Haiku for trivial reads). Default no longer inherits Opus, to match the founder's runway constraints.

### 5.2 The 11-task chain that produced this handover

After those rules were in place, the work to get acmd shipped looked like this:

1. **T-086 (Auditor, Sonnet)** — comprehensive proactive deploy audit. Found 3 CRITICAL (Caddy not reloaded, .env keys missing on VPS, CREATE SCHEMA double-source) + 2 HIGH (corsOrigins wrong, pipeline write gap) + 2 MEDIUM + 1 LOW.
2. **T-087 (REVIEWER, Opus)** — fresh-eye verify of T-086. All 8 confirmed via SSH evidence and Postgres 17.9 reproduction. Caught one new MEDIUM blind spot: T-086's own `docker run` smoke-sims left two orphan containers running on the production VPS with full secrets injected, contradicting T-086's self-review.
3. **T-088 (DevOps, Sonnet)** — SSH cleanup of the orphan containers `gallant_kowalevski` and `zen_hofstadter`. vollos-core 4 services left intact.
4. **T-089 (Backend, Sonnet)** — opened MR !12 with the consolidated 4-file fix in one commit `0183f70` (run-migrations.ts, 0000_brown_redwing.sql, config.ts, .gitlab-ci.yml). Tests stayed at 695 pass / 0 fail / 2 skipped.
5. **T-090 (DevOps, Sonnet)** — SSH-appended the two missing env keys (`ACMD_GOOGLE_CLIENT_ID`, `VOLLOS_AUTH_URL=http://vollos-core-auth:3004`) to `.env.production.local`. Cross-source sha256-8 fingerprint check vs vollos-core's `GOOGLE_CLIENT_ID` (matched: `4825240a`). Boot test used `--rm + --name + post-filter` to avoid repeating the orphan-container mistake from T-086.
6. **T-091 (REVIEWER-A, Sonnet, functional)** — independent re-run of typecheck, tests, yaml validation, and pipeline status on MR !12. Verdict PASS, recommend merge.
7. **T-092 (REVIEWER-B, Opus, security)** — independent security review of MR !12. Verdict conditional_pass, deploy_gate=GO, 0 CRITICAL, 0 HIGH, 3 MEDIUM (all post-merge cleanup). Also closed an outstanding NEEDS-INFO from T-087 by running the relevant `pg_default_acl` query read-only on the VPS — Postgres responded with the expected ACL row, query syntax `'acmd'::regnamespace` confirmed valid.
8. **T-093 (Backend, Sonnet)** — owner asked for the cleanup-before-merge option ("ทำแบบมืออาชีพสิครับ"), so a second commit `9def689` was pushed to the same branch updating the stale comment in index.ts:41 and rewriting one CORS test to assert reject behavior (Origin = `evil.example.com`, expect ACAO header absent) instead of testing Hono's unconditional Allow-Credentials.
9. **T-094 (DevOps, Sonnet)** — polled MR !12 pipeline `#2487849386` to terminal state: success, 281s, lint + test both pass.
10. **T-095 (DevOps, Sonnet)** — merged MR !12 (`glab mr merge 12 --yes`, no squash, two commits preserved for transparency). New main pipeline `#2487877676` reached the manual `deploy:production` gate.
11. **T-096 (DevOps, Sonnet)** — owner approved the manual trigger ("กด deploy ให้ล่ะ"). Deploy job ran in 25.6s, pipeline-side smoke 7/7 pass, runner-side smoke 3/3 pass, backup `acmd-20260429T093833Z-1a0e0125f4eb.sql.gz` (5513 B + sha256) saved to `/home/ipon/backups/` for rollback. acmd is live.
12. **T-097 (DevOps, Sonnet)** — owner reported login fail post-deploy. 7-angle diagnosis. Six angles green on acmd side, the seventh angle is the failing OPTIONS preflight against `auth.vollos.ai` — root cause is vollos-core CORS allowlist. Hence this handover document.

Throughout all 11 tasks, Lead@acmd did not run a single Bash command, edit a single source file, or merge any MR by hand. Every action that touched anything outside `_board.md` and `_workspace/*/task.md` was delegated to a freshly-spawned Agent with an explicit model selection and a written acceptance-criteria checklist. Every Agent output was either accepted with verifiable file:line evidence in its `self_review` block, or rejected and re-spawned. This is the standard Lead@acmd will continue to operate at.

---

## 6. Secondary issue (FYI only — not your problem, acmd backlog)

T-097 also flagged that `AUTH_RSA_PRIVATE_KEY` is currently unset inside the acmd-api container. The service starts fine because it falls back to an ephemeral key, but every container restart (i.e., every acmd deploy) invalidates all currently-issued JWTs signed by that key, kicking every active acmd user back to the login page. This is unacceptable for production stability but does not block the current login-flow fix — the acmd-issued JWT is only used for downstream product features (which haven't deployed yet). vollos-core auth-service already exposes the corresponding public key via JWKS, so the fix is entirely on the acmd side: add `AUTH_RSA_PRIVATE_KEY` as a masked + protected GitLab CI/CD variable on the acmd project, write it to `.env.production.local`, and restart acmd-api. Lead@acmd will spawn this as a follow-up task after the CORS fix lands and login is verified working end-to-end.

---

## 7. After your fix lands

Once vollos-core has redeployed with the updated CORS allowlist, please reply via the owner so Lead@acmd can:

1. Re-run the curl preflight test in section 2.3 to confirm the new ACAO header.
2. Spawn `vollos-e2e-tester` (Playwright headed in Linux container) to drive the full Google login flow on `accommodate-app.vollos.ai`, including the redirect handoff, token issuance, and the first authenticated `/api/v1/auth/me` call.
3. Spawn the secondary fix for `AUTH_RSA_PRIVATE_KEY` so subsequent deploys don't kick users out.
4. Announce the launch.

If anything in this document is unclear, or if your auth-service uses a different config key than `ALLOWED_ORIGINS`, please reply through the owner and Lead@acmd will follow up. Thank you for the fast Caddy reload earlier today (handshake [5]) — that was textbook.

— Lead@acmd, 2026-04-29 16:55 ICT

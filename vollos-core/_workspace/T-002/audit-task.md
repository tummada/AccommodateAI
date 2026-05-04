---
task_id: T-002-AUDIT
audit_target: T-002 (RS-013 Deploy Prep Phase 2A)
reviewer: vollos-auditor
mr: "!9"
branch: feat/rs013-deploy-prep
commit_sha: d9408478fd14392fac20e0ba89068d48fed7c00c
security_checkpoint: true
---

## Scope

Security + compliance review of MR !9 — **Phase 2A** (local code/config prep; no VPS SSH yet).

## Files to Review (from DevOps output.md)

- `.env.example` — env var sync to AUTH_RSA_* (removed JWT_*_PATH, added 11 keys)
- `infra/Caddyfile` — new file: reverse proxy + Cloudflare trust + security headers
- `docker-compose.yml` — added restart + healthcheck on 3 services
- `.gitignore` — added PEM patterns (must precede key generation)
- `scripts/init-db.sql` — verified no change (already C7-compliant per DevOps)
- RSA key handling — at `/tmp/auth-rsa-keys-20260418-165740/` (not committed)

## Audit Focus (7 checkpoints)

### 1. Secret Handling (CRITICAL)
- ✅ Verify no PEM content in any committed file: `git diff main...feat/rs013-deploy-prep | grep -E "BEGIN (RSA )?(PRIVATE|PUBLIC) KEY"` → must be 0 matches
- ✅ Verify `.gitignore` patterns (`*.pem`, `private.*`, `keys/*.pem`, `/tmp/auth-rsa-keys-*`) committed in `a6faef6` **before** key generation
- ✅ Verify `.env.example` has NO real values — only empty placeholders + comments
- ✅ Verify `AUTH_RSA_PRIVATE_KEY` fingerprint-only disclosure in `output.md` (no PEM content)

### 2. Caddy Security Config
- ✅ `admin off` — no admin API exposed
- ✅ `trusted_proxies` restricts to Cloudflare CIDRs (not `0.0.0.0/0`)
- ✅ `client_ip_headers` uses `CF-Connecting-IP` (not blindly trust X-Forwarded-For)
- ✅ HSTS ≥ 1 year + includeSubDomains
- ✅ X-Frame-Options: DENY
- ✅ X-Content-Type-Options: nosniff
- ✅ No `Server` header leak
- ✅ Auto-HTTPS compatible with Cloudflare Full Strict
- ✅ `caddy validate` passes

### 3. Docker Security
- ✅ Postgres port bound to `127.0.0.1:5432` (not 0.0.0.0)
- ✅ Healthchecks use `/health` endpoints (not expose shell)
- ✅ `restart: unless-stopped` (not `always` — allows manual stop)
- ✅ `depends_on: service_healthy` enforces startup order
- ⚠️ Note: vollos-api still exposed on host `3001:3001` (DevOps flagged as follow-up — confirm intentional scope limit for this MR)
- ✅ auth-service Dockerfile uses non-root `USER node`
- ✅ NODE_ENV=production set in Dockerfile

### 4. Env Var Completeness vs Code (Rule J3)
- ✅ Grep all `process.env['...']` usage in `apps/*/src/` + `packages/*/src/` and verify ALL env vars are in `.env.example`
- ✅ Verify DevOps claim `env_vars_missing_from_code_scan: none` is accurate
- ❌ Flag any env var referenced in code but missing from `.env.example`

### 5. Conventional Commits + No Push to Main (Rules F4, F6, K4)
- ✅ `git log origin/main..feat/rs013-deploy-prep` — all commits prefixed with `feat:`, `fix:`, `chore:`, `docs:`, `test:`, or `refactor:`
- ✅ No direct commits to main (MR workflow used)
- ✅ MR !9 opened, not yet merged

### 6. Architecture Rule Compliance
- **B1** — JWT RS256 only: auth-service code reads `AUTH_RSA_PRIVATE_KEY` (verify in code)
- **B4** — ห้าม `VOLLOS_JWT_SECRET` shared secret: verify `.env.example` has no HS256-style shared secret
- **C7** — GRANT ALL ON SCHEMA before migrations: verify `scripts/init-db.sql` L30
- **D4** — postgres in both `internal` + `vollos-network`: verify `docker-compose.yml`
- **J1-J3** — secret management (GitLab CI/CD Variables): verify owner_action_required instructions are complete + `.env.example` complete

### 7. Compliance (US — CAN-SPAM + CCPA)
Skip for this MR — no email/lead capture logic changed. Confirm scope limit.

## Verdict Format

Write to `_workspace/T-002/review-auditor.md` with:

```yaml
task_id: T-002
reviewer: vollos-auditor
mr: "!9"
verdict: pass | fail | conditional_pass
compliance_verdict: pass | fail | not_applicable
critical_findings: []
warning_findings: []
note_findings: []
evidence:
  - finding_id: F-1
    severity: critical | warning | note
    file: path:line
    description: "what"
    recommendation: "how to fix"
    reference: "rule code or OWASP"
checks_performed:
  - id: C-1
    title: "..."
    result: pass | fail
    evidence: "command → output snippet"
commit_gate: GO | NO-GO
rationale: "reason for verdict in plain Thai"
```

## Rules
- Read `CLAUDE.md` §§ B, C, D, F, J, K before reviewing
- Read DevOps `output.md` for context (their self-claimed evidence)
- **Verify independently** — do not trust DevOps self-review; re-run grep/commands yourself
- If any CRITICAL found → `verdict: fail` + `commit_gate: NO-GO`
- If only warnings → `conditional_pass` + list what should be fixed before VPS apply (Phase 2B)
- All verdicts in plain Thai for owner readability

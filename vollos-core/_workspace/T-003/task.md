---
id: T-003
title: RS-013 Deploy Prep — Hot-fix 3 HIGH findings from T-002 Auditor
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T17:16:07+07:00
dependencies:
  - T-002 (merged — MR !9 at commit d8a12a7e)
security_checkpoint: true
domain_consultation: null
blocks:
  - T-004 (local integration test — must run on clean code)
  - Phase 2B VPS apply (Auditor conditional_conditions require all 3 HIGH fixed first)
---

## Context

MR !9 (T-002) merged. Auditor verdict = `conditional_pass, GO` but identified **3 HIGH findings** that MUST be fixed before Phase 2B VPS apply.

Full audit: `_workspace/T-002/review-auditor.md`
Key evidence references below cite line numbers in that file.

## Fix Scope — 3 HIGH findings

### F-1 — Remove host port exposure on vollos-api + auth-service
**Source:** `review-auditor.md:L86-94` (docker-compose.yml:L38-39, L60-61)
**Issue:** `ports: 3001:3001` on vollos-api + `ports: 3004:3004` on auth-service bind to host 0.0.0.0 → bypassing Caddy's TLS + Cloudflare trust layer. If UFW misconfigured or VPS moved, services directly reachable from internet.
**Fix options (pick the cleaner one):**
- **Option A (preferred):** Create `docker-compose.prod.yml` override that removes `ports:` from both services. Keep `docker-compose.yml` as dev (dev port expose is fine for local curl tests).
- **Option B:** Bind to `127.0.0.1` — `ports: "127.0.0.1:3001:3001"` — if SSH tunnel debug is wanted.

**Recommendation:** Option A. Production = prod file; dev = default file. Rule K per CLAUDE.md.
**Verify:** Caddy still reaches services via `vollos-network` (container DNS: `vollos-core-auth:3004`, `vollos-core-api:3001`).
**Update:** `infra/Caddyfile` comments to note ports are intra-network only in prod.

### F-2 — Move hardcoded DB passwords out of scripts/init-db.sql
**Source:** `review-auditor.md:L96-104` (scripts/init-db.sql:L14, L17, L20)
**Issue:** 3 DB users (`auth_user`, `vollos_user`, `acmd_user`) all created with hardcoded `devpassword123`. File is in public git history → anyone can read. **Pre-existing bug** that T-002 DevOps verified-no-change without flagging.

**Fix approach (DevOps choose best):**
- Postgres Docker runs `/docker-entrypoint-initdb.d/*.sql` AND `*.sh` files on first init (when data volume empty).
- **Option A:** Convert `init-db.sql` to `init-db.sh` that uses `psql -v` variable substitution from env vars.
- **Option B:** Keep `init-db.sql` as template with `:'AUTH_USER_PASSWORD'` placeholders + wrap with a shell script in `/docker-entrypoint-initdb.d/` that runs `psql -v`.
- **Option C:** Use `envsubst < init-db.template.sql | psql ...` pattern.

**Required changes regardless of option:**
- Add to `.env.example`: `AUTH_USER_PASSWORD=`, `VOLLOS_USER_PASSWORD=`, `ACMD_USER_PASSWORD=` (empty, with comment: "Set real values in GitLab CI/CD Variables, masked + protected")
- Update `docker-compose.yml` postgres service to pass these env vars into the container
- Remove literal `devpassword123` from all committed files — grep clean required

**VPS migration note (document in output.md, DO NOT execute — Phase 2B job):**
- VPS postgres already has DB with old passwords (container was initialized before this fix)
- `init-db.sh` will NOT re-run on existing data volume
- Phase 2B DevOps must either: (a) DROP + re-init DB (acceptable per memory — no real users yet), OR (b) run `ALTER USER auth_user WITH PASSWORD '<new>'` manually
- Document this explicitly in output.md → `phase_2b_migration_note` field

### F-3 — Add Content-Security-Policy header to Caddyfile
**Source:** `review-auditor.md:L106-114` (infra/Caddyfile:L44-54 `(security_headers)` snippet)
**Issue:** 5 security headers present (HSTS, X-Frame, nosniff, Referrer, Permissions) but CSP missing. Defense-in-depth gap for `vollos.ai` landing (static HTML possibly with 3rd-party scripts like Turnstile + Google One-Tap).

**Fix:**
- Add to `(security_headers)` snippet: Content-Security-Policy header
- Before setting exact policy, DevOps must grep `apps/landing/` HTML for all 3rd-party script/style sources
- Starting point (Auditor recommendation `review-auditor.md:L113`):
  ```
  Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; frame-src https://accounts.google.com https://challenges.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https://auth.vollos.ai"
  ```
- Verify landing page still renders after CSP applied (caddy reload + smoke check locally)

## Acceptance Criteria

1. **F-1 resolved** — `docker-compose.prod.yml` created (or ports-removed approach) + verify Caddy reaches services via intra-network
2. **F-2 resolved** — no hardcoded passwords in any tracked file; env-var-driven; `.env.example` has 3 new vars with empty values; docker-compose wires env to postgres init; grep `devpassword123` returns 0 matches across entire repo
3. **F-3 resolved** — CSP header present in `(security_headers)` snippet; all 3rd-party origins in landing HTML enumerated and added to CSP directives
4. **F-4 acknowledged** — output.md has `t002_self_review_correction` field noting the `.gitignore` timing claim was inaccurate (committed 2m36s AFTER keygen, not before; no tree-level impact since keys in /tmp outside repo)
5. **Commit + MR** — feature branch `fix/rs013-deploy-prep-hardening` + MR opened to main + conventional commits + pipeline green
6. **Self-review accurate** — every field result: true + evidence file:line — and any claim about ordering/timing must be verifiable (e.g., `git log --format=%ai` vs file mtime)
7. **Grep clean** — placeholder grep 0 matches + password grep 0 matches
8. **Secret audit** — no new secrets introduced in commit; `.env.example` values still empty
9. **Validation commands pass** — `caddy validate` + `docker compose config --quiet` (for both default and prod compose files if Option A taken)

## Owned Files

- `docker-compose.yml` (may split)
- `docker-compose.prod.yml` (new, if Option A)
- `scripts/init-db.sql` (modified or renamed)
- `scripts/init-db.sh` (new, if Option A)
- `.env.example` (add 3 password vars)
- `infra/Caddyfile` (add CSP)

## Forbidden Files

- `CLAUDE.md`, `_board.md`, `_workspace/*/task.md` (Lead territory)
- `apps/*/src/**`, `packages/*/src/**` (Backend territory — infra only)
- Migration files `packages/*/migrations/**` (Backend territory)
- `.gitlab-ci.yml` (unless pipeline change strictly required; flag to Lead first if so)

## Security Rules (CRITICAL)

- Re-run `grep -rn "devpassword123"` across entire repo — must return 0
- Check `git log -S "devpassword123"` — note: password IS in git history. Cannot rewrite history on main (would invalidate everyone's clones). Document this in output.md as `residual_risk` — owner accepts residual (no real users + dev-only passwords) and rotates on VPS after Phase 2B
- Do NOT attempt git filter-branch / force-push to purge old passwords from history — destructive
- Never display env values in stdout or output.md — use `***` or key-only listings

## Expected Output (`_workspace/T-003/output.md`)

```yaml
task_id: T-003
status: completed | needs_fix | blocked
branch: fix/rs013-deploy-prep-hardening
commit_sha: <sha>
mr_iid: <N>
mr_url: <URL>

f1_fix:
  approach: "A (prod override) | B (localhost bind) | other"
  files_changed: [...]
  caddy_internal_reach_verified: true|false
  evidence: "file:line — ..."

f2_fix:
  approach: "init-db.sh | template + envsubst | psql -v"
  files_changed: [...]
  env_vars_added: [AUTH_USER_PASSWORD, VOLLOS_USER_PASSWORD, ACMD_USER_PASSWORD]
  grep_devpassword123: "0 matches"
  phase_2b_migration_note: |
    On VPS, postgres data volume exists with old passwords. init-db.sh will NOT re-run.
    Phase 2B must: <a or b with rationale>.
  residual_risk: |
    Old password 'devpassword123' is still in git history (commits prior to this fix).
    Not purged via filter-branch (destructive). Accepted because dev-only + no real users.
    Rotate on VPS with ALTER USER after Phase 2B regardless.

f3_fix:
  csp_policy: "Content-Security-Policy \"...\" (final value)"
  third_party_origins_enumerated:
    - https://challenges.cloudflare.com
    - https://accounts.google.com
    - ...
  landing_html_grep_evidence: "file:line showing each 3rd-party inclusion"

f4_acknowledgment:
  claim_in_T002_output: ".gitignore committed BEFORE key generation"
  actual_ordering: ".gitignore committed 2m36s AFTER key generation"
  impact: "none — keys generated in /tmp outside repo"
  lesson_recorded: "DevOps self_review evidence must be verifiable (timestamp / log output); no narrative claims"

self_review:
  f1_resolved:
    result: true
    evidence: "..."
  f2_resolved:
    result: true
    evidence: "..."
  f3_resolved:
    result: true
    evidence: "..."
  f4_acknowledged:
    result: true
    evidence: "..."
  mr_opened:
    result: true
    evidence: "..."
  pipeline_green:
    result: true
    evidence: "..."
  grep_clean:
    result: true
    evidence: "..."
  validation_commands:
    result: true
    evidence: "caddy validate + docker compose config output"

placeholders_remaining: none — grep clean
password_grep_result: "grep -rn 'devpassword' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist → 0 matches in working tree"
```

## Notes for DevOps

- **Read `review-auditor.md` first** — L86-L114 have full Auditor reasoning + recommendations
- **Read `CLAUDE.md` §C (DB rules) + §D (Docker rules) + §J (secrets)** — binding constraints
- **Read `T-002/output.md` §rsa_key_info** — owner has not yet uploaded RSA keys to GitLab; keys still at `/tmp/auth-rsa-keys-20260418-165740/` (not your problem, but context)
- **MR workflow** — feature branch, MR to main, owner merges. Do NOT push to main.
- **Conventional commits** — this is primarily a `fix(security)` or `fix(infra)` commit set
- **Self-review accuracy** — Auditor caught F-4 (timing inaccuracy). Lead will spot-check timing claims explicitly this round.

Begin. Read task + audit report + CLAUDE.md first, then execute.

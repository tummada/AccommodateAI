task_id: T-021
status: completed
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/18
branch: feat/auth-rate-limit
commit: d9714e577f77c1cca11b07c6a7a45effc3c72d28

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L30-L34 — 'SECRET HANDLING (non-negotiable) — ห้าม log/display/return ค่า env vars, passwords, tokens, PEM — ใช้ sha256 fingerprint เท่านั้นเมื่อต้อง reference'"
    - "SKILL.md:L108 — 'Rate Limiting | hono-rate-limiter (community package) — ต้องระบุ keyGenerator — limits: auth=5/min, general=30/min'"
    - "SKILL.md:L170-L179 — 'Middleware registration order — CORS → secureHeaders → Body Limit → Rate Limiter → zValidator → Route Handler'"

files_changed:
  - path: apps/auth-service/src/middleware/rateLimit.ts
    action: created
    purpose: "getTrustedIp + createIpRateLimiter factory + 5 concrete limiters (refresh/googleCallback/logout/me/onboarding)"
  - path: apps/auth-service/src/middleware/rateLimit.test.ts
    action: created
    purpose: "15 unit tests — header parsing, allowed, exceed-limit + Retry-After, per-IP isolation, per-limiter wiring"
  - path: apps/auth-service/src/index.ts
    action: modified
    purpose: "wire 5 path-level limiters AFTER CORS, BEFORE app.route('/auth', authRoutes)"
  - path: apps/auth-service/package.json
    action: modified
    purpose: "add test script + vitest devDep + hono-rate-limiter dep"
  - path: apps/auth-service/vitest.config.ts
    action: created
    purpose: "include src/**/*.test.ts (matches packages/auth convention)"
  - path: pnpm-lock.yaml
    action: modified
    purpose: "lockfile update for new deps (hono-rate-limiter + vitest under @vollos/auth-service)"

build_verified: true
build_output: |
  $ cd apps/auth-service && pnpm build
  > @vollos/auth-service@0.0.0 build /home/ipon/workspace/vollos-ai/vollos-core/apps/auth-service
  > tsc
  (exit 0, no errors)

  $ pnpm -r typecheck
  packages/auth typecheck: Done
  packages/auth-db typecheck: Done
  packages/crypto typecheck: Done
  packages/db typecheck: Done
  apps/api typecheck: Done
  apps/auth-service typecheck: Done

tests_written:
  - path: apps/auth-service/src/middleware/rateLimit.test.ts
    count: 15
    coverage:
      - "getTrustedIp: missing header, single IP, multi-hop tail (Caddy-written), malformed tail"
      - "createIpRateLimiter: 200 under limit, draft-6 RateLimit-* headers, 429 + Retry-After on exceed, body shape { error, retryAfter }, per-IP isolation, no Retry-After on 200"
      - "Exported limiters: refreshRateLimiter=30, googleCallbackRateLimiter=20, logoutRateLimiter=20, meRateLimiter=60, onboardingRateLimiter=20"

test_output: |
  $ cd apps/auth-service && pnpm test
   RUN  v4.1.4 /home/ipon/workspace/vollos-ai/vollos-core/apps/auth-service
   Test Files  1 passed (1)
        Tests  15 passed (15)
     Start at  23:03:44
     Duration  205ms

  $ pnpm -r test  (regression check — whole monorepo)
  packages/crypto: 2 files / 36 tests passed
  packages/auth:   6 files / 111 tests passed (existing suite untouched — NO regression)
  apps/api:        5 files / 38 tests passed
  apps/auth-service: 1 file / 15 tests passed (new)
  TOTAL: 14 files / 200 tests passed

self_review:
  input_validated:
    result: true
    evidence: "No user-supplied JSON/body is parsed — middleware only reads x-forwarded-for header. getTrustedIp runs the value through IP_REGEX before use (rateLimit.ts:L30-L35)."
  null_handled:
    result: true
    evidence: "getTrustedIp — missing header returns 'unknown' (rateLimit.ts:L32); malformed tail returns 'unknown' (rateLimit.ts:L34). All callers get a string, never null."
  errors_caught:
    result: true
    evidence: "rateLimiter() (hono-rate-limiter) handles its own errors; on exceed it returns 429 via the configured message. No try/catch needed — the library owns the response. Verified in node_modules/.pnpm/hono-rate-limiter@0.5.3_.../dist/index.js:L33 which sets Retry-After header."
  race_condition_safe:
    result: true
    evidence: "No DB writes. hono-rate-limiter uses an in-process map keyed by generated key; each limiter owns its own store instance (bucket prefix in keyGenerator — rateLimit.ts:L72 — prevents cross-bucket contamination). Single-container auth-service = no horizontal-scale race."
  security_checked:
    result: true
    evidence: "IP spoofing mitigated via tail-entry read (rateLimit.ts:L44 — Caddy appends real IP at tail); keys are prefixed with bucket name so /me quota cannot be drained by hitting /onboarding (rateLimit.ts:L72); no secrets logged anywhere; tests use RFC 5737 TEST-NET-1 IPs only (rateLimit.test.ts:L23-L32)."

placeholders_remaining: none — grep clean
# grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" \
#   apps/auth-service/src/middleware/rateLimit.ts \
#   apps/auth-service/src/middleware/rateLimit.test.ts
# (no matches in new files; Phase 1 hit in index.ts is pre-existing RS-013 comment, not mine)

dependency_audit:
  command: "pnpm audit --audit-level moderate (auth-service scope)"
  new_findings: none
  pre_existing: "2 moderate in esbuild (dev-only, via drizzle-kit → @esbuild-kit/esm-loader chain). Not introduced by this MR."

web_searches: none

notes: |
  # Scope observation (flagged but not blocked)
  Task.md Acceptance Criterion #1 lists 5 endpoint groups but only 2 exist
  in the codebase today (/auth/refresh, /auth/logout — both inside
  @vollos/auth package's createAuthRoutes factory). /auth/google/callback,
  /me, /onboarding are NOT defined anywhere. This MR wires the limiters at
  path level in apps/auth-service/src/index.ts via `app.use(path, limiter)`
  so the quotas are in place the moment those routes ship — no follow-up
  task required. Tests exercise each limiter against a synthetic in-app
  GET/POST handler so the wiring itself is verified even without the
  downstream route.

  # Why path-level instead of touching @vollos/auth
  Task owned_files restricts to apps/auth-service/. Modifying packages/auth/
  would also require changing the inline rate limits inside createAuthRoutes
  (10/min and 30/min) which the task explicitly did NOT request. Path-level
  wiring is purely additive — existing behaviour unchanged, new quota layer
  runs first. For /auth/google and /auth/refresh this is defence-in-depth
  (inner per-minute + outer per-5-min).

  # Branch recovery note
  The first commit landed on the wrong local branch (fix/ccpa-delete-clear-
  ip-ua, inherited from the starting working tree). Cherry-picked to
  feat/auth-rate-limit and deleted the stray local ref; origin/fix/ccpa-
  delete-clear-ip-ua (pre-existing, unrelated MR work) is untouched.

  # Verification shortcut for reviewer
  Run `cd apps/auth-service && pnpm test -- --reporter=verbose` and look
  for the 'returns 429 with Retry-After header' case — that proves both
  acceptance criteria #2 and the Retry-After contract in one shot.

issues: []
remaining_items: []

re_anchor:
  sub_task: "T-021 — rate limit 5 auth-service endpoint groups"
  scope_ok: true
  scope_details:
    - "Owned files only — apps/auth-service/* + pnpm-lock.yaml (lockfile is implicit for new deps)"
    - "Did NOT touch packages/auth/ (backend territory per CLAUDE.md but out of task owned_files)"
    - "Middleware order — CORS (global *) → path-level rate limiters → app.route('/auth', authRoutes) → JWKS / health"
    - "No Agent spawns"
    - "No hardcoded secrets — all IPs are RFC 5737 documentation range"
    - "No Drizzle update/delete calls introduced"

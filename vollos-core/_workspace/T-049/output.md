---
task_id: T-049
status: completed
spawn_completed_at: 2026-04-20T11:15+07:00
---

## Summary

Added `/api/v1/health` endpoint (CLAUDE.md K2 convention) while keeping `/health` for Docker HEALTHCHECK + `infra/monitor.sh`. Both endpoints share one handler and return identical payload `{status: "healthy", service: "vollos-api"}`.

## Skill Loaded Evidence

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L137 — 'index.ts — app entry point, register middleware + routes' (confirms apps/api/src/index.ts is the correct mount point for routes)"
    - "SKILL.md:L283 — 'Build pass: pnpm build (TypeScript compile) — ห้าม output ถ้า build fail' (ran pnpm typecheck per monorepo convention)"

## Files Changed

- path: apps/api/src/index.ts
  action: modified
  lines: +20 / -9
- path: apps/api/src/health.test.ts
  action: created
  lines: +50

## Build Verified

build_verified: true

## Build / Typecheck Output

```
$ pnpm typecheck
Tasks:    9 successful, 9 total
Cached:    8 cached, 9 total
  Time:    4.153s
```

## Lint Output

```
$ pnpm lint
Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
  Time:    27ms >>> FULL TURBO
```

Note: `apps/api` has no `lint` script in package.json; root `turbo run lint` hits the 3 packages that do (`@vollos/auth`, `@vollos/auth-db`, `@vollos/db`). TypeScript `--strict` via `pnpm typecheck` covers lint-equivalent correctness for api.

## Tests Written

- path: apps/api/src/health.test.ts
  count: 2
  cases:
    - "GET /health returns 200 with healthy payload"
    - "GET /api/v1/health returns identical payload to /health"

## Test Output

```
$ pnpm test (workspace root, turbo)
@vollos/api:test:  ✓ src/middleware/turnstile.test.ts (5 tests) 10ms
@vollos/api:test:  ✓ src/email/sender.test.ts (6 tests) 16ms
@vollos/api:test:  ✓ src/auth/googleJwt.test.ts (8 tests) 12ms
@vollos/api:test:  ✓ src/config/signedToken.test.ts (8 tests) 9ms
@vollos/api:test:  ✓ src/routes/deletion.test.ts (4 tests) 31ms
@vollos/api:test:  ✓ src/routes/leads.test.ts (15 tests) 57ms
@vollos/api:test:  ✓ src/health.test.ts (2 tests) 24ms
@vollos/api:test:  Test Files  7 passed (7)
@vollos/api:test:        Tests  48 passed (48)

Tasks:    7 successful, 7 total
```

Delta: 46 → 48 tests (+2 new health tests). Regression: none.

## MR + Pipeline

- Branch: `feat/api-v1-health`
- Commit: `15a8320` — `feat(api): add /api/v1/health endpoint (K2 convention)`
- MR: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/10 (!10)
- Pipeline: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464339170

## Placeholder Audit

```
$ grep -nE 'alert\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' apps/api/src/index.ts apps/api/src/health.test.ts
(no matches)
```
placeholders_remaining: none — grep clean

## Self-Review (Evidence-Based)

self_review:
  input_validated:
    result: true
    evidence: "GET /health takes no body/params — no input surface to validate (apps/api/src/index.ts:L27-L28, L40). Existing validators on POST routes unchanged."
  null_handled:
    result: true
    evidence: "healthHandler returns a pure constant JSON object — no null branches (apps/api/src/index.ts:L27-L28)."
  errors_caught:
    result: true
    evidence: "Hono framework catches downstream errors automatically; handler itself cannot throw (apps/api/src/index.ts:L27-L28)."
  race_condition_safe:
    result: true
    evidence: "Read-only endpoint — no DB write, no shared mutable state (apps/api/src/index.ts:L27-L28)."
  security_checked:
    result: true
    evidence: "Uses Hono built-in secureHeaders + CORS via app.use('*', ...) registered before the health routes (apps/api/src/index.ts:L18-L19). Endpoint exposes only service name string constant — no secrets, no stack traces."

## Acceptance Criteria Verification

- [x] AC1 — Both `/health` and `/api/v1/health` return same payload
  evidence: apps/api/src/index.ts:L27-L28 (shared `healthHandler`), mounted L34 + L40. Test apps/api/src/health.test.ts:L36 asserts `res2.json() === res1.json()`.
- [x] AC2 — Test added covering both paths
  evidence: apps/api/src/health.test.ts:L24 (`GET /health`) and apps/api/src/health.test.ts:L32 (`GET /api/v1/health`).
- [x] AC3 — `pnpm typecheck && pnpm lint && pnpm test` all green — output pasted above
  evidence: turbo output above — 9/9 typecheck, 3/3 lint, 48/48 tests.
- [x] AC4 — Branch pushed + MR opened; URL returned
  evidence: MR !10 https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/10 ; pipeline 2464339170.
- [x] AC5 — Commit message uses conventional format
  evidence: commit 15a8320 — `feat(api): add /api/v1/health endpoint (K2 convention)`.
- [x] AC6 — `self_review` complete — every AC has `result` + `evidence: file:line`
  evidence: self_review block above; each field cites apps/api/src/index.ts:Lxx or apps/api/src/health.test.ts:Lxx.

## Notes

- Added a `VITEST` env guard around the top-level `serve()` call in `index.ts` so importing the module under vitest does not open a real TCP listener on port 3001. This is a safe no-op in production (`VITEST` is only set by the vitest runner).
- Owned-files interpretation: task listed `apps/api/src/index.ts` + `apps/api/test/**`. Repo convention co-locates tests in `apps/api/src/**/*.test.ts` (see `src/routes/leads.test.ts`, `src/auth/googleJwt.test.ts`). Placed new test at `apps/api/src/health.test.ts` to match existing convention — if Lead prefers a dedicated `test/` tree, trivially movable.
- re-anchor: sub-task=final-output, scope_ok=y (only apps/api/src/index.ts + apps/api/src/health.test.ts touched; no secrets; no Agent tool spawned; no Drizzle queries added).

## Issues

issues: []

## Web Searches

web_searches: none

## Remaining Items

remaining_items: []

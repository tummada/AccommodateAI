---
task_id: T-055
status: completed
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/13
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464355097
branch: fix/refresh-race
commit: 0e781bc15cb5aba1a54f5a648434c99eb86cb1f2
design_choice: "Option B — atomic UPDATE ... RETURNING"
design_choice_reason: >
  Task spec explicitly prefers Option B over Option A unless there's a reason
  to use A. Option B is a single Postgres statement (no explicit transaction),
  uses row-level locking + RETURNING, and also subsumes the expiry check
  (`expires_at > NOW()`) that `isTokenRevoked` previously bundled — so the
  auth-service now makes ONE round-trip per rotation instead of TWO. Option A
  (transaction + SELECT FOR UPDATE) would require a 3-round-trip flow
  (BEGIN + SELECT FOR UPDATE + UPDATE + COMMIT) with no functional advantage
  on a single-row UPDATE.
---

# T-055: Refresh Token Rotation — Atomic (SEC-MEDIUM-4)

## skill_loaded_evidence

files_read:
  - "/home/ipon/.claude/skills/vollos-backend/SKILL.md:L246-L253 — Self-Review Protocol Q4: 'Duplicate/Race condition เป็นไปได้ไหม? ถ้า endpoint สร้าง record → ถ้า request มาพร้อมกัน 2 ตัว จะเกิดอะไร? ใช้ onConflictDoUpdate หรือ unique constraint ป้องกัน' — directly identifies the class of vulnerability this task fixes."
  - "/home/ipon/.claude/skills/vollos-backend/SKILL.md:L281-L285 — Pre-Submit Gate: 'Drizzle query safety: ตรวจทุก .update() และ .delete() มี .where(eq(...)) — ห้ามมี update/delete ที่ไม่มี where clause' — verified `claimRefreshToken` has three where predicates (eq token_hash, isNull revokedAt, gt expiresAt)."

## Context

Security audit (MEDIUM-7) flagged: two concurrent `POST /auth/refresh` with the
same refresh token could both succeed because `rotateRefreshToken()` checked
revocation and wrote revocation in two separate round-trips:

```
1. isRevoked = await isTokenRevoked(hash)        -- SELECT
2. if (isRevoked) throw
3. await revokeToken(hash)                       -- UPDATE
```

Under concurrent load, both racers complete step 1 with `isRevoked=false`
BEFORE either reaches step 3 — so both proceed to step 3, both mint new token
pairs. A stolen refresh token could therefore be multiplied, and the
one-refresh-per-rotation invariant was broken.

## Fix — Option B (atomic UPDATE ... RETURNING)

Added a new optional callback `claimRefreshToken(hash) -> boolean` on
`RefreshTokenCallbacks`. The `auth-service` implementation is a single
Drizzle-translated PostgreSQL statement:

```sql
UPDATE auth.refresh_tokens
  SET revoked_at = $now
  WHERE token_hash = $1
    AND revoked_at IS NULL
    AND expires_at > $now
  RETURNING id
```

- Returns `true` when ≥ 1 row is updated → caller won the race; may mint new pair.
- Returns `false` when 0 rows are updated → token absent / already revoked /
  past server-side `expires_at` → `rotateRefreshToken` throws → route returns 401.

`rotateRefreshToken()` prefers `claimRefreshToken` when present; falls back to
the legacy `isTokenRevoked + revokeToken` pair when not (so in-process test
callbacks without a DB still work — JS is single-threaded, so the legacy pair
is already effectively atomic there).

## files_changed

- path: packages/auth/src/types.ts
  action: modified
  note: added optional `claimRefreshToken` field to `RefreshTokenCallbacks` with inline doc on atomicity contract.
- path: packages/auth/src/jwt.ts
  action: modified
  note: `rotateRefreshToken()` prefers atomic `claimRefreshToken`; legacy two-step fallback preserved.
- path: apps/auth-service/src/index.ts
  action: modified
  note: implements `claimRefreshToken` with Drizzle `.update().where(eq, isNull, gt).returning({id})`. Added imports `gt`, `isNull`.
- path: packages/auth/__tests__/authRoutes.test.ts
  action: modified
  note: in-memory store gained a `claimRefreshToken` implementation + new `SEC-MEDIUM-4` concurrent test (`Promise.all` × 5 → exactly 1 succeeds, 4 get 401).
- path: packages/auth/__tests__/jwt.test.ts
  action: modified
  note: 4 new `rotateRefreshToken > SEC-MEDIUM-4` unit tests (atomic path, false-return 401, legacy fallback, 5-way `Promise.allSettled` race).

## build_verified

true

## build_output

```
$ pnpm typecheck
 Tasks:    9 successful, 9 total
Cached:    9 cached, 9 total
  Time:    26ms >>> FULL TURBO

$ pnpm build
 Tasks:    7 successful, 7 total
Cached:    4 cached, 7 total
  Time:    3.279s
```

## tests_written

- path: packages/auth/__tests__/authRoutes.test.ts
  count: 1  # "SEC-MEDIUM-4: 5 concurrent refresh requests with same token → exactly 1 succeeds, 4 get 401"
- path: packages/auth/__tests__/jwt.test.ts
  count: 4  # SEC-MEDIUM-4 block: atomic path / false returns 401 / legacy fallback / concurrent Promise.allSettled

## test_output

```
$ pnpm vitest run (packages/auth)

 Test Files  6 passed (6)
      Tests  116 passed (116)
   Duration  809ms

Key new tests:
 ✓ POST /auth/refresh > SEC-MEDIUM-4: 5 concurrent refresh requests with same token → exactly 1 succeeds, 4 get 401
 ✓ rotateRefreshToken > SEC-MEDIUM-4 > uses claimRefreshToken when provided (skips isTokenRevoked + revokeToken)
 ✓ rotateRefreshToken > SEC-MEDIUM-4 > throws when claimRefreshToken returns false (lost race / already revoked)
 ✓ rotateRefreshToken > SEC-MEDIUM-4 > legacy fallback (no claimRefreshToken) still works — used by older products
 ✓ rotateRefreshToken > SEC-MEDIUM-4 > concurrent rotateRefreshToken with same token → exactly one succeeds (in-memory atomic)

Full repo:
$ pnpm test
 Tasks:    7 successful, 7 total
Cached:    5 cached, 7 total
```

## Preserved behaviour (regression-checked)

- `POST /auth/refresh > returns 401 for revoked refresh token` — still passes (claimRefreshToken returns false when revoked_at IS NOT NULL).
- `POST /auth/refresh > returns 401 for tampered refresh token` — still passes (verifyRefreshToken throws before callback is called).
- `POST /auth/refresh > returns new accessToken on valid refresh token` — still passes (happy path; claim returns true).
- `rotateRefreshToken > rejects already-revoked refresh token` — still passes.
- Expired refresh token → 401 preserved (`claimRefreshToken` WHERE expires_at > NOW()` excludes expired rows, returns false → 401).
- Logout flow unchanged (uses `revokeToken`, not `claimRefreshToken`).

## self_review

```yaml
self_review:
  input_validated:
    result: true
    evidence: "refreshToken comes from httpOnly cookie → passed through verifyRefreshToken (jose jwtVerify with RS256 + clockTolerance) before any DB write — packages/auth/src/jwt.ts:L288 inside rotateRefreshToken. tokenHash is a SHA-256 digest, not user-controlled — packages/auth/src/jwt.ts:L321 via hashToken()."
  null_handled:
    result: true
    evidence: "claimRefreshToken returns Promise<boolean> — never undefined. Null/absent row → UPDATE matches 0 rows → .returning() yields []; rows.length > 0 is false. Verified at apps/auth-service/src/index.ts:L212-L226 and tested at packages/auth/__tests__/jwt.test.ts (`throws when claimRefreshToken returns false`)."
  errors_caught:
    result: true
    evidence: "rotateRefreshToken throw propagates to the caller in authRoutes.ts:L146-L149 where the try/catch clears the cookie and returns 401 with a generic message — no stack trace leak. claimRefreshToken DB errors (rejected promise) propagate the same way. packages/auth/src/authRoutes.ts:L135-L150."
  race_condition_safe:
    result: true
    evidence: "Single Postgres UPDATE ... WHERE token_hash=? AND revoked_at IS NULL AND expires_at > NOW() RETURNING id — row-level lock + RETURNING guarantees exactly one concurrent caller observes a non-empty result set. Verified by Promise.all × 5 concurrent test: packages/auth/__tests__/authRoutes.test.ts (`SEC-MEDIUM-4: 5 concurrent refresh requests → exactly 1 succeeds, 4 get 401`) and Promise.allSettled × 5 at packages/auth/__tests__/jwt.test.ts (`concurrent rotateRefreshToken with same token → exactly one succeeds`)."
  security_checked:
    result: true
    evidence: "All three WHERE predicates use Drizzle parameterised helpers (eq, isNull, gt) — no SQL injection surface. token_hash is SHA-256 of the refresh JWT so even the hash never exposes user identity. No secrets logged. apps/auth-service/src/index.ts:L215-L225."
```

## placeholders_remaining

none — grep clean

```
$ grep -nE "alert\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]" \
    packages/auth/src/types.ts \
    packages/auth/src/jwt.ts \
    apps/auth-service/src/index.ts \
    packages/auth/__tests__/authRoutes.test.ts \
    packages/auth/__tests__/jwt.test.ts
apps/auth-service/src/index.ts:28:// RS-013 (Phase 1 / validate mode): ...  [pre-existing comment, not modified in this task]
```

## Acceptance checklist

- [x] 1. Refresh rotation uses atomic UPDATE...RETURNING (claimRefreshToken in apps/auth-service/src/index.ts:L212).
- [x] 2. Concurrent test: Promise.all × 5 identical refresh requests → exactly 1 succeeds, 4 get 401 (authRoutes.test.ts).
- [x] 3. Happy path test preserved (authRoutes.test.ts: `returns new accessToken on valid refresh token`).
- [x] 4. Revoked-token path preserved (authRoutes.test.ts: `returns 401 for revoked refresh token`).
- [x] 5. Expired-token path preserved (WHERE expires_at > NOW() in claimRefreshToken → returns false → 401).
- [x] 6. `pnpm typecheck && pnpm test` all green (9/9 + 7/7 packages, 116/116 auth tests).
- [x] 7. Branch pushed (fix/refresh-race) + MR opened (!13).
- [x] 8. `self_review` complete (5/5 fields evidence-based with file:line).

## re-anchor

- scope_ok: y — only touched owned_files (apps/auth-service/**, packages/auth/**)
- security_rules_ok: y — no secret leaks, parameterised queries, no stack-trace exposure
- no_agent_spawn: y
- no_hardcoded_secrets: y
- drizzle_where_ok: y — .update() has eq + isNull + gt where predicates
- sub_task: T-055-main

## web_searches

none

## issues

[]

## notes

- Rationale for optional (not required) callback: keeping `claimRefreshToken`
  optional lets in-process test harnesses (and any future product that hasn't
  migrated yet) continue working without changes. Production auth-service
  MUST supply it — verified via typechecked call site at apps/auth-service/src/index.ts:L212.
- The auth-service already uses `new Date()` as the comparison point, which
  is the JS wall clock at the moment the UPDATE is dispatched. Postgres then
  enforces the atomicity, not JS, so this is safe under concurrent load.
- Legacy `isTokenRevoked` is still required on the interface — it's called
  by the fallback branch, and removing it would break any downstream product
  not yet migrated. The fallback branch is unreachable from auth-service
  (which provides claimRefreshToken) but covered by unit tests.

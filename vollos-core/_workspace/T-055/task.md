---
id: T-055
title: Refresh token race condition fix (MEDIUM-4)
assigned_to: vollos-backend
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:00+07:00
security_checkpoint: true
owned_files:
  - apps/auth-service/src/**
  - packages/auth/src/**
  - packages/auth-db/src/**
dependencies: []
---

## Context

Security audit flagged MEDIUM-7: Two concurrent POST `/auth/refresh` requests with the same refresh token → both can succeed and issue two NEW token pairs. This means one stolen refresh token can be multiplied. Also breaks the one-refresh-per-rotation invariant.

Likely current flow (to verify in code):
1. SELECT refresh_token WHERE token=? AND revoked_at IS NULL
2. INSERT new access + refresh tokens
3. UPDATE old refresh_token SET revoked_at = NOW()

Race: steps 1-3 are not atomic. Two requests can both SELECT in step 1 before either UPDATEs in step 3.

## Goal

Make refresh rotation atomic so at most one request succeeds for a given refresh token.

## Design Options (Backend agent chooses + justifies)

**Option A — Transaction + SELECT FOR UPDATE:**
```sql
BEGIN;
SELECT id FROM refresh_tokens WHERE token_hash=? AND revoked_at IS NULL FOR UPDATE;
-- if 0 rows → 401 (already revoked or doesn't exist)
UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?;
-- insert new access+refresh
COMMIT;
```

**Option B — Optimistic update with RETURNING:**
```sql
UPDATE refresh_tokens
  SET revoked_at = NOW()
  WHERE token_hash=? AND revoked_at IS NULL
  RETURNING id;
-- if 0 rows → lost the race → 401
-- else → issue new tokens
```

Option B is simpler (no transaction) and works on Postgres. Prefer B unless there's a reason to use A.

## Scope

1. Find refresh endpoint: likely `apps/auth-service/src/routes/refresh.ts` or similar
2. Find the SELECT + UPDATE pattern — replace with atomic UPDATE...RETURNING (Drizzle: `.returning()`)
3. If UPDATE returns 0 rows → respond 401 (attacker/concurrent winner already claimed)
4. Keep existing: user lookup, new access+refresh minting, revocation timestamp
5. Tests:
   - Happy path: single refresh → succeeds
   - Concurrent refresh (use Promise.all or vitest concurrent test with same token) → exactly ONE succeeds, other gets 401
   - Refresh with already-revoked token → 401
   - Refresh with expired token → 401 (existing behavior preserved)

## Workflow

1. `git fetch origin && git checkout -b fix/refresh-race origin/main`
2. Implement
3. `pnpm typecheck && pnpm lint && pnpm test` all green — paste output
4. Commit: `fix(security): make refresh token rotation atomic (prevent concurrent race)`
5. Push + MR

## Acceptance Criteria

1. [ ] Refresh rotation uses atomic UPDATE...RETURNING (or transaction FOR UPDATE)
2. [ ] Concurrent test: Promise.all with 5 identical refresh requests → exactly 1 succeeds, 4 get 401
3. [ ] Happy path test preserved
4. [ ] Revoked-token path preserved
5. [ ] Expired-token path preserved
6. [ ] `pnpm typecheck && pnpm lint && pnpm test` all green
7. [ ] Branch pushed + MR opened
8. [ ] `self_review` complete

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-055/output.md`

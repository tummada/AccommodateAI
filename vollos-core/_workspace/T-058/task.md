---
id: T-058
title: Security audit — T-055 refresh token atomic rotation
assigned_to: vollos-auditor
priority: high
status: in_progress
spawn_started_at: 2026-04-20T12:25+07:00
security_checkpoint: true
owned_files: []
review_target:
  branch: origin/fix/refresh-race
  commit: 0e781bc
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/13
  base: origin/main (42e305c)
---

## Scope (READ-ONLY)

Review diff `origin/main..origin/fix/refresh-race` — atomic refresh-token rotation via UPDATE...RETURNING.

Files likely: `apps/auth-service/src/routes/refresh.ts`, `packages/auth/src/jwt.ts`, `packages/auth-db/src/schema.ts` (if changed), tests.

## Checklist

1. The SELECT + UPDATE pattern replaced with single atomic UPDATE...RETURNING? (grep for any remaining SELECT before UPDATE of refresh_tokens)
2. `WHERE token_hash=? AND revoked_at IS NULL` in the UPDATE — both conditions required?
3. Expiry check (`WHERE expires_at > NOW()`) preserved? Or handled separately?
4. When UPDATE returns 0 rows → HTTP 401 (not 500)?
5. Token comparison timing-safe? (If token_hash lookup by indexed column, timing leak is minimal — but if raw token compared after SELECT, check for timingSafeEqual)
6. Concurrent test present and realistic (Promise.all with ≥5 simultaneous requests)?
7. After refresh success: new access + refresh pair issued in same transaction as old-token revocation? (If not — window where old is revoked but new not yet issued → client gets error but next retry works — document)
8. Race against logout: if token is being revoked by logout while refresh is in flight → both fail gracefully?
9. Audit log written for refresh events (OK even if not required)?
10. Impacts on JWKS / access-token TTL → unchanged (shouldn't be touched by this fix)?

## Compliance

- CCPA: refresh path doesn't regress any privacy controls
- Session hijacking: if attacker steals BOTH refresh tokens (legitimate user's + attacker's replay), does atomic rotation still protect? (Yes — whoever hits DB first wins; other gets 401 AND their copy of old token is now revoked = attacker locked out until next compromise)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-058/review-auditor.md` — YAML. Under 250 words (this one is more complex).

---
id: T-021
title: Rate limit /onboarding + /me + /auth/* endpoints (auth-service)
assigned_to: vollos-backend
priority: high
status: in_progress
spawn_started_at: 2026-04-18T22:57:51+07:00
security_checkpoint: true
domain_consultation: null
---

## Context

T-007/T-017 deployed auth-service to production. Rate limit currently applies only to `/api/v1/leads` on vollos-api (proven working — owner triggered it during earlier testing). But `/onboarding`, `/me`, `/auth/*` endpoints on auth-service lack rate limit → brute-force/DoS exposure.

## Scope

Add rate limiting middleware to auth-service for 3 endpoint groups:

| Endpoint | Purpose | Suggested limit |
|----------|---------|-----------------|
| `/auth/refresh` | Token refresh | 30 req / 5 min per IP |
| `/auth/google/callback` | OAuth callback | 20 req / 5 min per IP |
| `/auth/logout` | Session end | 20 req / 5 min per IP |
| `/me` | User info | 60 req / 5 min per IP |
| `/onboarding` | First-login flow | 20 req / 5 min per IP |

Values are suggestions — Backend can tune based on expected legitimate traffic patterns.

### Implementation approach

- **Reuse existing pattern** if vollos-api has rate limit middleware — copy/adapt for auth-service
- Use `getTrustedIp` middleware (same as vollos-api — mitigates IP spoofing via Caddy trusted proxy)
- Memory-based store OK for now (Redis upgrade later = T-022+ future)
- Return `429 Too Many Requests` with `Retry-After` header

## Acceptance Criteria

1. Rate limit middleware applied to all 5 endpoint groups above
2. Unit test: exceed limit → expect 429 + Retry-After header
3. Unit test: legitimate traffic (under limit) → 200 OK
4. `getTrustedIp` used (not raw req.ip) — consistent with vollos-api
5. No regression — existing endpoint behavior preserved (same response shape for 200/401/403)
6. `pnpm test` passes in apps/auth-service
7. Feature branch `feat/auth-rate-limit`
8. Conventional commit: `feat(auth): rate limit refresh/me/onboarding/google/logout endpoints`
9. MR to main
10. Pipeline green
11. Self-review evidence-based

## Owned Files

- `apps/auth-service/src/middleware/rateLimit.ts` (new or update existing)
- `apps/auth-service/src/routes/*.ts` (add middleware)
- `apps/auth-service/src/middleware/rateLimit.test.ts`

## Forbidden

- Do NOT change JWT logic (T-016 rotation still in effect)
- Do NOT touch JWKS endpoint rate limit (must stay unlimited — public spec)
- Do NOT add Redis dependency yet (memory store OK)
- No SSH to VPS

## Rules

- Read `CLAUDE.md` §§ K (Code Quality)
- **Read SKILL.md SECRET HANDLING** (no log IP values in tests — use RFC 5737 192.0.2.1)
- Memory `feedback_secret_handling_protocol.md`
- Check if vollos-api already has rateLimit middleware → copy pattern for consistency
- Test with `192.0.2.1` TEST-NET IP not real IPs

## Output

`_workspace/T-021/output.md` standard YAML

Begin.

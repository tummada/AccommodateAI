---
task_id: T-021-AUDIT
audit_target: MR !18 (rate limit auth-service — 5 endpoints)
reviewer: vollos-auditor
mr: "!18"
branch: feat/auth-rate-limit (merged)
commit: d9714e5
scope: post-merge security review before VPS deploy
---

## Context

T-021 added rate limiting to auth-service. MR !18 merged already. Owner requested audit BEFORE VPS deploy for confidence (Lead had skipped — oversight).

Files changed:
- `apps/auth-service/src/middleware/rateLimit.ts` (new)
- `apps/auth-service/src/middleware/rateLimit.test.ts` (15 tests, all pass)
- `apps/auth-service/src/index.ts` (wire 5 limiters)
- `apps/auth-service/package.json` + `pnpm-lock.yaml`
- `apps/auth-service/vitest.config.ts`

## Audit Focus

### A — Middleware logic soundness
- State store (memory Map) — TTL + expiry + cleanup
- Race condition: concurrent request increment correctness
- Per-IP isolation — different IPs don't share counter
- `getTrustedIp` implementation — reads last X-Forwarded-For (Caddy-written tail), not spoofable
- Return 429 + Retry-After header correctly

### B — Rate limit bypass vulnerabilities
- Can attacker spoof IP? (X-Forwarded-For trust → only last value used)
- Can attacker trigger memory exhaustion? (unbounded Map growth?)
- Can attacker bypass via different Origin or header combos?
- What happens if trust proxy config misconfigured?

### C — Limits reasonableness
- `/refresh` 30/5min = 6/min average — reasonable for legit use?
- `/me` 60/5min = 12/min — SPA may poll
- `/onboarding` 20/5min — one-time flow, seems ok
- `/auth/google/callback` 20/5min — callback is one-time per OAuth flow, 20 is generous
- `/auth/logout` 20/5min — logout is rare

### D — Test quality
- 15 tests — cover rate limit trigger, expiry, isolation, headers?
- Any missing edge case?
- Test IPs are RFC 5737 TEST-NET (192.0.2.x) — no real PII ✅

### E — Code quality
- TypeScript types complete?
- Error handling — middleware exception doesn't kill service?
- Imports + dependencies appropriate?
- Consistent with vollos-api rateLimit.ts pattern

### F — Architecture compliance
- No secrets logged
- No state in auth service that would break horizontal scaling (future concern — memory store won't scale; Redis needed later — flag for backlog)
- Does not interfere with existing /auth/refresh inline rate limit (defense-in-depth OK or conflict?)

## Verdict Format

Write `_workspace/T-021/review-auditor.md`:

```yaml
task_id: T-021
reviewer: vollos-auditor
mr: "!18"
verdict: pass | conditional_pass | fail
commit_gate: GO | NO-GO (GO = deploy proceeds, NO-GO = fix before deploy)
critical_findings: []
high_findings: []
medium_findings: []
checks_performed: [A, B, C, D, E, F]
rationale: plain Thai
deploy_readiness: ready | blocked
```

## Rules

- Re-run verifications independently (don't trust self-review)
- Never display secrets (no IP values from real logs — use 192.0.2.x fingerprints)
- Read-only — only write review-auditor.md
- Plain Thai rationale

Begin.

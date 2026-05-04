---
id: T-054
title: Turnstile token single-use replay prevention (MEDIUM-3)
assigned_to: vollos-backend
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:00+07:00
security_checkpoint: true
owned_files:
  - apps/api/src/middleware/turnstile.ts
  - apps/api/src/routes/leads.ts
  - apps/api/test/**
dependencies: []
---

## Context

Security audit flagged MEDIUM-6: Cloudflare Turnstile tokens are valid for 5 minutes from issue time. Our backend calls `siteverify` once per request but doesn't track whether a specific token has already been used. Attacker can:

1. Solve Turnstile challenge legitimately (gets token T)
2. Capture token T (from network tab / MITM / browser devtools)
3. Replay T within 5 minutes against our backend multiple times → each replay bypasses CAPTCHA

Cloudflare's siteverify is supposed to reject reuse-before-verify, but race conditions exist (2 simultaneous verify calls of same token may both succeed). We need defense-in-depth.

## Goal

Mark each Turnstile token as "used" on our side after first successful verify. Reject subsequent requests carrying the same token.

## Design (recommended)

**In-memory cache with 5-minute TTL:**

```ts
// apps/api/src/middleware/turnstileReplayCache.ts (new)
const seen = new Map<string, number>();  // tokenHash → expiresAt epoch ms

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function markUsed(token: string, ttlSeconds = 300): void {
  seen.set(hashToken(token), Date.now() + ttlSeconds * 1000);
  sweepExpired();
}

export function isUsed(token: string): boolean {
  const h = hashToken(token);
  const expires = seen.get(h);
  if (!expires) return false;
  if (expires < Date.now()) { seen.delete(h); return false; }
  return true;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [h, exp] of seen) if (exp < now) seen.delete(h);
}
```

Update turnstile middleware:
1. Check `isUsed(token)` BEFORE calling siteverify → if used → 400 "Token already consumed"
2. Call siteverify → if pass → `markUsed(token)` → proceed
3. If siteverify fails → do NOT mark (attacker can try with different/valid token later)

**Why in-memory cache (not Redis):**
- Single API instance currently (not horizontally scaled)
- Adding Redis = new infra dependency + deploy complexity for limited marginal benefit
- When we scale → revisit (Redis + pub/sub)
- Document this decision in code comment + in output.md

**Edge: process restart clears the cache → replay window re-opens for ≤5 min.** Acceptable residual risk in validate mode.

## Scope

1. Create `apps/api/src/middleware/turnstileReplayCache.ts`
2. Update `turnstile.ts` middleware to call `isUsed` + `markUsed`
3. Tests (at least 4):
   - First use → allowed
   - Replay same token → rejected
   - Different token → allowed
   - After TTL expiry → old token treated as unused (TTL cleanup)

## Workflow

1. `git fetch origin && git checkout -b fix/turnstile-replay origin/main`
2. Implement
3. `pnpm typecheck && pnpm lint && pnpm test` all green — paste output
4. Commit: `fix(security): prevent Turnstile token replay via in-memory cache`
5. Push + MR

## Acceptance Criteria

1. [ ] New file `apps/api/src/middleware/turnstileReplayCache.ts` with `isUsed` + `markUsed` + `sweepExpired`
2. [ ] Turnstile middleware checks `isUsed` before siteverify; calls `markUsed` on success
3. [ ] 4+ unit tests covering all replay scenarios
4. [ ] TTL = 300 seconds (5 min, matching Turnstile's own validity)
5. [ ] Comment in code documents in-memory cache choice + scale limitation
6. [ ] `pnpm typecheck && pnpm lint && pnpm test` all green
7. [ ] Branch pushed + MR opened
8. [ ] `self_review` complete

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-054/output.md`

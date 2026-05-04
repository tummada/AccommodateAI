---
task_id: T-054
status: completed
agent: vollos-backend
completed_at: 2026-04-20T11:30+07:00
---

## Summary

Implemented defense-in-depth replay prevention for Cloudflare Turnstile tokens
(audit MEDIUM-6). Added a small in-memory cache that stores `sha256(token) →
expiresAt` with a 5-minute TTL, and wired it into `verifyTurnstile()` to reject
replayed tokens before hitting Cloudflare.

## skill_loaded_evidence

files_read:
  - "SKILL.md:L341 — 'ถ้ารู้ว่ามี bug แต่ส่งงานมา → ถือว่า fabrication — ต้องแก้ให้หมดก่อนส่ง ไม่ใช่ทิ้งให้ QA จับ'"
  - "SKILL.md:L100 — 'Google One Tap — Nonce: ป้องกัน replay attack … single instance: in-memory Map + setInterval cleanup ทุก 60s' (pattern reused here, adapted with on-write sweep instead of setInterval so tests don't have to juggle a timer)"
  - "SKILL.md:L214 — 'Never hallucinate — ถ้าไม่แน่ใจ parameter ของ library function, data shape assumption, หรือ logic behavior ให้ mark [unverified]'"

## files_changed

- path: apps/api/src/middleware/turnstileReplayCache.ts
  action: created
- path: apps/api/src/middleware/turnstile.ts
  action: modified
- path: apps/api/src/middleware/turnstileReplayCache.test.ts
  action: created
- path: apps/api/src/middleware/turnstile.test.ts
  action: modified

## design_decisions

1. **In-memory Map (not Redis).** Current deploy is a single API instance. Adding
   Redis = new infra dependency + deploy complexity for limited marginal benefit.
   When we scale horizontally we revisit with Redis + atomic `SETNX` (or pub/sub).
   Documented in the module header and in code comments.
2. **Hash tokens with sha256 before storage.** Avoids keeping raw Turnstile tokens
   in memory longer than the verify path needs them.
3. **Lazy sweep on write, not `setInterval`.** `sweepExpired()` runs at the end of
   every `markUsed()` call. Keeps the Map bounded by live traffic, avoids keeping
   the event loop alive from an interval handle, and makes tests deterministic
   (no fake timers fighting interval schedulers).
4. **Never mark on siteverify failure.** Only a successful verify consumes the
   token. Otherwise an attacker could submit a valid-shaped string alongside a
   failing siteverify outcome and preemptively lock a legitimate user's future
   token.
5. **Check before siteverify.** Saves a network round-trip for obvious replays
   and — more importantly — closes the race window where two concurrent
   siteverify calls for the same token might both succeed.

## residual_risk

Process restart clears the cache → replay window re-opens for ≤5 minutes
(the natural Turnstile token validity). Acceptable in validate mode; noted
in the module header.

## build_verified

true

## build_output

```
$ pnpm typecheck
• turbo 2.9.6
• Packages in scope: @vollos/api, @vollos/auth, @vollos/auth-db, @vollos/auth-service, @vollos/crypto, @vollos/db, @vollos/landing
• Running typecheck in 7 packages
...
@vollos/api:typecheck:
@vollos/api:typecheck: > @vollos/api@0.0.0 typecheck /home/ipon/workspace/vollos-ai/vollos-core/apps/api
@vollos/api:typecheck: > pnpm --filter @vollos/db build && tsc --noEmit
...
 Tasks:    9 successful, 9 total
Cached:    5 cached, 9 total
  Time:    4.709s
```

```
$ pnpm lint
• turbo 2.9.6
• Running lint in 7 packages
...
 Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
  Time:    27ms >>> FULL TURBO
```

## tests_written

- path: apps/api/src/middleware/turnstileReplayCache.test.ts
  count: 6
  cases:
    - first use — isUsed returns false before markUsed
    - replay detection — isUsed returns true after markUsed (same token)
    - isolation — different token is not reported as used
    - TTL expiry — token treated as unused after ttlSeconds elapse
    - sweepExpired — proactively removes expired entries
    - hash collision resistance — different tokens with shared prefix stay isolated
- path: apps/api/src/middleware/turnstile.test.ts
  count: 7  # 5 existing + 2 new replay cases
  new_cases:
    - rejects a replayed token after first successful verify (no second siteverify call)
    - does NOT mark token consumed when siteverify fails

## test_output

```
$ pnpm --filter @vollos/api test

 RUN  v4.1.4 /home/ipon/workspace/vollos-ai/vollos-core/apps/api

 Test Files  8 passed (8)
      Tests  56 passed (56)
   Start at  11:24:10
   Duration  526ms (transform 744ms, setup 138ms, import 1.16s, tests 170ms, environment 1ms)
```

Full `pnpm test` (turbo, all packages):

```
@vollos/api:test:  Test Files  8 passed (8)
@vollos/api:test:       Tests  56 passed (56)
@vollos/auth:test:  Test Files  6 passed (6)
@vollos/auth:test:       Tests  111 passed (111)
 Tasks:    7 successful, 7 total
```

## placeholders_remaining

none — grep clean on all modified/created files.
Verified via `grep -nE "alert\(|coming soon|\\bTODO\\b|\\bTBD\\b|not implemented|Phase [0-9]"` on:
- apps/api/src/middleware/turnstileReplayCache.ts → no matches
- apps/api/src/middleware/turnstile.ts → no matches
- apps/api/src/middleware/turnstileReplayCache.test.ts → no matches
- apps/api/src/middleware/turnstile.test.ts → no matches
(`vi.fn().mock*` test-helper calls are vitest API, not placeholder markers.)

## git

branch: fix/turnstile-replay
base: origin/main
commit: 44d8a06 fix(security): prevent Turnstile token replay via in-memory cache

## mr

url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/12
iid: 12
state: opened
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464352939
pipeline_sha: 44d8a06
pipeline_status_at_push: running

## self_review

input_validated:
  result: true
  evidence: "verifyTurnstile(token, ip) parameters are typed string and already validated upstream by LeadSchema Zod schema in leads.ts:L38 (turnstileToken: z.string().min(1)); the cache module takes the same string directly — no new input surface."
null_handled:
  result: true
  evidence: "Map.get returns T | undefined; isUsed() explicitly checks `if (expires === undefined) return false` at turnstileReplayCache.ts:L60-L61 before comparing against Date.now()."
errors_caught:
  result: true
  evidence: "verifyTurnstile throws a plain Error with message 'Turnstile token already consumed' for replays (turnstile.ts:L25); caller in leads.ts:L109-L111 already wraps verifyTurnstile in try/catch and maps to 422 'Human verification failed' — this route-level handling is preserved by the change."
race_condition_safe:
  result: true
  evidence: "isUsed+markUsed sequence runs within the single-threaded Node.js event loop per verifyTurnstile call; no cross-request sharing of the intermediate state other than the Map itself. Documented the ≤5-min residual replay window on process restart in turnstileReplayCache.ts:L16-L18. Documented in MR description that a horizontally-scaled deployment will need Redis SETNX — deferred."
security_checked:
  result: true
  evidence: "No secrets in code (verifyTurnstile still reads TURNSTILE_SECRET_KEY from process.env — turnstile.ts:L15). Token hashed with sha256 before storage to avoid retaining raw token material — turnstileReplayCache.ts:L31-L33. markUsed is only called after successful siteverify (turnstile.ts:L56) so a failing request cannot preemptively lock a future user's token."

## acceptance_criteria

- [x] 1. New file apps/api/src/middleware/turnstileReplayCache.ts with isUsed + markUsed + sweepExpired
- [x] 2. Turnstile middleware checks isUsed before siteverify; calls markUsed on success
- [x] 3. 4+ unit tests (delivered 6 dedicated + 2 integration tests = 8 new cases)
- [x] 4. TTL = 300 seconds (DEFAULT_TTL_SECONDS = 300 in turnstileReplayCache.ts:L26)
- [x] 5. In-memory-cache choice + scale limitation documented (turnstileReplayCache.ts:L4-L20)
- [x] 6. pnpm typecheck && pnpm lint && pnpm test all green
- [x] 7. Branch pushed + MR opened (!12)
- [x] 8. self_review complete with file:line evidence

## notes

- Re-anchor checkpoint: sub-task=implement+tests, scope_ok=y, owned_files_ok=y (only apps/api/src/middleware/**, no files outside owned_files touched). Unrelated workspace diffs in apps/auth-service/, packages/auth/ belong to T-055 and were NOT staged in this commit.
- Confirmed: middleware registration order untouched; only the internals of `verifyTurnstile` changed. No change to leads.ts route contract or response codes — replay rejects still surface as 422 'Human verification failed' via the existing try/catch at leads.ts:L107-L111.

## issues

[]

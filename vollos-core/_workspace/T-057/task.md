---
id: T-057
title: Security audit — T-054 Turnstile token replay cache
assigned_to: vollos-auditor
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:25+07:00
security_checkpoint: true
owned_files: []
review_target:
  branch: origin/fix/turnstile-replay
  commit: 44d8a06
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/12
  base: origin/main (42e305c)
---

## Scope (READ-ONLY)

Review diff `origin/main..origin/fix/turnstile-replay`.

Files: `apps/api/src/middleware/turnstileReplayCache.ts` (new), `apps/api/src/middleware/turnstile.ts` (updated), related tests.

Use `git show origin/fix/turnstile-replay:<path>`.

## Checklist

1. Token **hashed** before storing in Map (not raw token)? If raw → 🔴
2. Constant-time comparison for equality? (Not critical here — hash lookup — but note if relevant)
3. TTL = exactly 300 seconds (5 min)? Matches Turnstile's own validity?
4. `sweepExpired` called periodically (on-write) to bound memory?
5. `markUsed` called ONLY after siteverify success (not on failure → would be DoS vector: attacker marks arbitrary tokens as used)?
6. `isUsed` called BEFORE siteverify (short-circuit saves API cost + blocks replay earlier)?
7. Process restart clears cache → 5-min replay window re-opens — documented as acceptable residual risk?
8. No SPI (Sensitive Personal Info) written to logs when rejecting replay?
9. Error handling: if siteverify throws → does cache remain consistent? (No markUsed on error is correct)
10. Concurrent safety: Map is single-threaded in Node; safe for this use. Confirm.

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-057/review-auditor.md` — YAML. Under 200 words.

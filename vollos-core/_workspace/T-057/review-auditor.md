---
task_id: T-057
verdict: pass
working_mode: static-analysis
---

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
    - "SKILL.md:L139 — 'CRITICAL finding → verdict fail — บังคับ'"
    - "references/security-checklists.md:L96 — HMAC Timing Safe row (N/A here — hash lookup, no MAC compare)"

files_reviewed:
  - "apps/api/src/middleware/turnstileReplayCache.ts: lines 1-83 (new)"
  - "apps/api/src/middleware/turnstile.ts: lines 1-57 (diff)"
  - "apps/api/src/middleware/turnstileReplayCache.test.ts: lines 1-72 (new)"
  - "apps/api/src/middleware/turnstile.test.ts: lines 1-122 (diff, +40)"

greps_executed:
  - "git show 44d8a06 --stat → 4 files, +215/-1 — matches task scope"
  - "git show 44d8a06 -- turnstileReplayCache.ts → createHash('sha256') L32; markUsed L42 ttl=300 default L28; sweepExpired() call inside markUsed L44"
  - "git show 44d8a06 -- turnstile.ts → isUsed(token) L24 BEFORE fetch; markUsed(token) L56 only after !json.success check (line 52) passes"

scope_compliance:
  files_changed_vs_owned: "match — all 4 files under apps/api/src/middleware/ (Backend territory); no schema/route/infra edits"

checklist_results:
  - "1. hashed: PASS — sha256(token) stored (turnstileReplayCache.ts:L32,L37)"
  - "2. constant-time: N/A — Map.get() keyed by hex digest, no MAC compare"
  - "3. TTL=300s: PASS — DEFAULT_TTL_SECONDS=300 (L28), matches Turnstile validity"
  - "4. sweepExpired on-write: PASS — called in markUsed (L44)"
  - "5. markUsed only on success: PASS — turnstile.ts:L56 placed after `if (!json.success) throw` (L52); test 'does NOT mark on failure' confirms"
  - "6. isUsed before siteverify: PASS — turnstile.ts:L24-26 precedes fetch at L30"
  - "7. restart caveat documented: PASS — comment L13-15 'Process restart clears the cache → replay window re-opens'"
  - "8. no SPI in logs: PASS — throw messages contain no token/email/IP"
  - "9. error handling: PASS — fetch error (L34) + !res.ok (L45) + !json.success (L52) all throw before markUsed"
  - "10. concurrent safety: PASS — Node single-threaded; Map.set atomic within event loop tick"

security_findings: []

us_privacy_compliance:
  unsubscribe_mechanism: "N/A (scope unchanged)"
  physical_address_in_email: "N/A"
  audit_log: "N/A"
  data_minimization: "ok — hashed token only, no PII in cache"

skipped_sections: []
conditional_conditions: []
notes:
  - "Residual risk (restart clears cache) is acknowledged inline (turnstileReplayCache.ts:L13-15) — acceptable per task.md item 7."
  - "Redis note for horizontal scaling is documented (L10-12) — not required until scale-out."
  - "Self-review presence not verified (no output.md inspected); Lead should confirm separately."

completion_signal: "task_id=T-057 verdict=pass findings=0 path=_workspace/T-057/review-auditor.md"

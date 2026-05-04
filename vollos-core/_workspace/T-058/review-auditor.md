---
task_id: T-058
verdict: "pass"
working_mode: "static-analysis"
---

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L60 — 'อ่าน SKILL.md ก่อน — Lead ระบุ path ใน spawn prompt'"
    - "references/security-checklists.md:L97 — Credential Stuffing Prevention (API2:2023) checklist re-read"

files_reviewed:
  - "apps/auth-service/src/index.ts: lines 1-30, 180-245 (diff hunks + imports)"
  - "packages/auth/src/jwt.ts: lines 280-330 (rotateRefreshToken)"
  - "packages/auth/src/types.ts: lines 65-100 (RefreshTokenCallbacks)"
  - "packages/auth/src/authRoutes.ts: lines 120-155 (POST /auth/refresh handler)"
  - "packages/auth/__tests__/authRoutes.test.ts: lines 40-90, 330-390 (Promise.all x5 test)"
  - "packages/auth/__tests__/jwt.test.ts: lines 400-545 (4 new rotation tests)"
  - "_workspace/T-055/output.md: lines 1-219 (self_review evidence-based)"

greps_executed:
  - "git diff origin/main..origin/fix/refresh-race --stat → 5 files, +297/-8"
  - "grep -n 'claimRefreshToken' apps/auth-service/src/index.ts → L212 (impl)"
  - "grep -n 'Refresh token has been revoked|401|rotateRefreshToken' packages/auth/src → authRoutes.ts:L149 maps throw→401; jwt.ts:L294 throw"
  - "grep -n 'SELECT.*refresh_tokens' apps/auth-service/src → no remaining SELECT-before-UPDATE in rotation path"

scope_compliance:
  files_changed_vs_owned: "match — all within apps/auth-service/** and packages/auth/** (Backend territory per CLAUDE.md)"

security_findings: []

us_privacy_compliance:
  unsubscribe_mechanism: "N/A — refresh-token scope only"
  physical_address_in_email: "N/A"
  audit_log: "N/A — no regression; task does not add/remove logging"
  data_minimization: "ok — token_hash is SHA-256; no PII added to refresh_tokens"

skipped_sections: []
conditional_conditions: []

---

## Checklist Verification (10 items)

1. SELECT+UPDATE replaced by atomic UPDATE...RETURNING — **pass** (apps/auth-service/src/index.ts:L212-L226; jwt.ts:L294-L304 prefers claim over isRevoked+revoke).
2. WHERE includes both `token_hash` AND `revoked_at IS NULL` — **pass** (index.ts:L219-L223: `eq(tokenHash)`, `isNull(revokedAt)`, `gt(expiresAt, now)`).
3. Expiry `expires_at > NOW()` preserved — **pass** (same WHERE; subsumes legacy isTokenRevoked expiry branch).
4. 0 rows → 401 (not 500) — **pass** (jwt.ts:L296 throws `'Refresh token has been revoked'` → authRoutes.ts:L146-L149 catch → `c.json({...}, 401)` + cookie cleared).
5. Timing-safe comparison — **pass/N/A** (indexed column lookup by SHA-256 hash; no constant-time compare required for indexed equality).
6. Concurrent Promise.all ≥5 test — **pass** (authRoutes.test.ts SEC-MEDIUM-4: 5 concurrent → 1x200, 4x401; jwt.test.ts Promise.allSettled x5).
7. New pair issued after revocation in same atomic path — **pass** (claim returns true → proceed; false → throw before mint; no double-mint window).
8. Race vs logout — **pass** (logout uses `revokeToken` which is idempotent UPDATE; if logout wins, refresh claim sees `revoked_at IS NOT NULL` → false → 401; if refresh wins, logout UPDATE is a no-op match on already-revoked row).
9. Audit log — **N/A** (not required; no regression).
10. JWKS / access-token TTL unchanged — **pass** (diff does not touch key material or TTL config).

**Compliance:** CCPA — no regression. Session hijacking — atomic rotation locks attacker out on race loss (per task note).

**Self-review check:** T-055 output.md has evidence-based self_review 5/5 with file:line — compliant with CLAUDE.md.

**Verdict rationale:** 0 CRITICAL, 0 HIGH. Fix is correct, tested under concurrency, preserves expiry + revocation semantics, and maps lost-race to 401 via existing route handler.

completion_signal: task_id=T-058 verdict=pass findings=0 path=_workspace/T-058/review-auditor.md

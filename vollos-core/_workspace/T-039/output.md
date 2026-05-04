---
task_id: T-039
status: completed
finished_at: 2026-04-20T09:45+07:00
---

# T-039 — Unsubscribe + CCPA delete link expiry (HIGH-1)

## skill_loaded_evidence

files_read:
  - "SKILL.md:L96 — \"Google One Tap JWT\": ...OAuth2Client.verifyIdToken... caller ต้อง wrap ใน try/catch เสมอ..."
  - "SKILL.md:L114 — \"Unsubscribe System\": HMAC-SHA256 token per email → GET /api/unsubscribe?token=... → verify → set unsubscribed_at ใน DB → audit log"
  - "SKILL.md:L215 — Rule 2 \"Never generate secrets in output — ห้ามสร้าง JWT secret, API key, password ใน code output ใช้ process.env.* เสมอ\""

## files_changed

- path: apps/api/src/config/unsubscribe.ts
  action: modified
  summary: "Added generateSignedToken / verifySignedToken / SIGNED_TOKEN_RE / TOKEN_TTL_SECONDS. Token format `<base36-timestamp>.<hex-hmac>` where HMAC covers \"<leadId>:<timestamp>\". 30-day TTL."
- path: apps/api/src/routes/leads.ts
  action: modified
  summary: "Replaced local generateUnsubscribeToken() with imported generateSignedToken() in all 4 email-emission sites (form new, form resubscribe, google new, google resubscribe). Removed unused createHmac import."
- path: apps/api/src/routes/unsubscribe.ts
  action: modified
  summary: "Replaced raw HMAC equality check with verifySignedToken(id, token). TOKEN_RE now references shared SIGNED_TOKEN_RE so the regex gate matches the verifier."
- path: apps/api/src/routes/deletion.ts
  action: modified
  summary: "Same replacement as unsubscribe.ts for /api/delete."
- path: apps/api/src/config/signedToken.test.ts
  action: created
  summary: "8 unit tests: emits correct format, deterministic for same (leadId, ts), plus the 6 required T-039 cases — valid / expired 31d / future / tampered HMAC / malformed (no dot) / wrong leadId."
- path: apps/api/src/routes/deletion.test.ts
  action: modified
  summary: "Updated signId() helper to new `<base36-timestamp>.<hex-hmac>` format. Removed vi.mock of config/unsubscribe.js — now uses real module with env-injected secret so verifySignedToken is exercised end-to-end. All 4 original tests still pass."
- path: apps/api/src/routes/leads.test.ts
  action: modified
  summary: "Extended vi.mock of config/unsubscribe.js to stub generateSignedToken + verifySignedToken + SIGNED_TOKEN_RE + TOKEN_TTL_SECONDS (leads tests do not verify tokens; that coverage lives in signedToken.test.ts)."

## build_verified: true

## typecheck_output

```
 Tasks:    9 successful, 9 total
Cached:    7 cached, 9 total
  Time:    4.138s
```
(full output: `@vollos/api:typecheck` cache-miss + compile succeeded; `@vollos/auth-service:typecheck` cache-miss + compile succeeded)

## lint_output

```
 Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
  Time:    27ms >>> FULL TURBO
```
(note: `@vollos/api`, `@vollos/auth-service`, `@vollos/landing` do not define a `lint` script so turbo does not run anything there — only `@vollos/auth`, `@vollos/auth-db`, `@vollos/db` have it, all cache-hit. Not a regression introduced by T-039.)

## test_output

```
@vollos/api:test:  ✓ src/config/signedToken.test.ts (8 tests) 8ms
@vollos/api:test:  ✓ src/email/sender.test.ts (6 tests) 20ms
@vollos/api:test:  ✓ src/auth/googleJwt.test.ts (8 tests) 13ms
@vollos/api:test:  ✓ src/middleware/turnstile.test.ts (5 tests) 13ms
@vollos/api:test:  ✓ src/routes/deletion.test.ts (4 tests) 27ms
@vollos/api:test:  ✓ src/routes/leads.test.ts (15 tests) 41ms
@vollos/api:test:  Test Files  6 passed (6)
@vollos/api:test:       Tests  46 passed (46)

@vollos/auth-service:test:  ✓ src/middleware/rateLimit.test.ts (15 tests) 52ms
@vollos/auth-service:test:  Test Files  1 passed (1)
@vollos/auth-service:test:       Tests  15 passed (15)

@vollos/auth:test:  ✓ __tests__/roleGuard.test.ts (7 tests)
@vollos/auth:test:  ✓ __tests__/authRoutes.test.ts (23 tests)
@vollos/auth:test:  ✓ __tests__/tenantGuard.test.ts (14 tests)
@vollos/auth:test:  ✓ __tests__/jwt.test.ts (41 tests)
... (plus packages/auth-db, packages/db, packages/crypto pass)
@vollos/auth:test:  Test Files  6 passed (6)
@vollos/auth:test:       Tests  111 passed (111)

 Tasks:    7 successful, 7 total
Cached:    5 cached, 7 total
  Time:    1.234s
```

Total: **172 tests passed, 0 failed**. Newly added: 8 in `signedToken.test.ts`. `deletion.test.ts` (4) updated + still passing. `leads.test.ts` (15) still passing.

## placeholders_remaining

none — grep clean on all 7 production/test files. The only matches in `deletion.test.ts` / `leads.test.ts` are standard `vi.mock(...)` / `.mockReturnValue()` vitest helpers (not placeholder code stubs standing in for unimplemented features). Production source files (`config/unsubscribe.ts`, `routes/leads.ts`, `routes/unsubscribe.ts`, `routes/deletion.ts`, `config/signedToken.test.ts`) are completely clean.

## commit

- sha: f40a0926d1c47541dbc63297a5ff475a1eb9f9af
- branch: fix/unsubscribe-link-expiry
- message: "fix(security): add 30-day expiry to unsubscribe + delete tokens"
- conventional_commits: true (fix(security): prefix + BREAKING CHANGE footer block)

## merge_request

- url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/4
- iid: !4
- title: "fix(security): 30-day expiry for unsubscribe + delete tokens (HIGH-1)"
- state: opened
- source_branch: fix/unsubscribe-link-expiry
- target_branch: main
- has_conflicts: false
- remove_source_branch_on_merge: true
- breaking_change_noted: true — "Breaking change" section in MR body + `BREAKING CHANGE:` footer in commit

## pipeline

- url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464231907
- sha: f40a0926d1c47541dbc63297a5ff475a1eb9f9af
- status: running (observed ~5s after MR creation; full green pending CI completion)

## self_review

input_validated:
  result: true
  evidence: "config/unsubscribe.ts:L38-L80 — verifySignedToken regex-gates shape, NaN-gates parseInt(ts,36), range-gates ts vs now±TTL; routes/unsubscribe.ts:L88 + routes/deletion.ts:L90 — UUID_RE + TOKEN_RE format check before DB hit; leads.ts:L31-L48 — Zod schema unchanged, covers all incoming lead fields."

null_handled:
  result: true
  evidence: "config/unsubscribe.ts:L68-L73 — Buffer.from(hmacPart,'hex') wrapped in try/catch returns false on malformed hex; config/unsubscribe.ts:L57-L58 — parseInt non-finite short-circuits to false; routes/unsubscribe.ts:L107-L109 + routes/deletion.ts:L109-L111 — DB `lead` undefined returns HTML_NOT_FOUND 404."

errors_caught:
  result: true
  evidence: "routes/unsubscribe.ts:L101-L104 (DB query) + L129-L132 (DB update) + L142-L146 (audit log) — each try/catch logs message only, never stack; routes/deletion.ts:L103-L106 + L143-L146 + L155-L158 — same pattern; verifySignedToken itself is pure + non-throwing (returns false on any failure mode) so the verify step needs no try/catch."

race_condition_safe:
  result: true
  evidence: "routes/unsubscribe.ts:L118-L120 — already-unsubscribed check short-circuits before UPDATE; routes/deletion.ts:L122-L124 — same for already-deleted. Token generation is stateless so concurrent lead creation cannot cause token-collision (leadId+ts+secret is the keyspace). Existing lead-upsert race handling in leads.ts untouched."

security_checked:
  result: true
  evidence: "config/unsubscribe.ts:L76-L79 — timingSafeEqual + length pre-check prevents timing side channel; config/unsubscribe.ts:L55 — future-ts rejection blocks forged-future replay; config/unsubscribe.ts:L58 — 30-day TTL limits replay window after email inbox compromise; HMAC input is \"<leadId>:<timestamp>\" not just \"<timestamp>\" so a valid signature cannot be moved to a different leadId; UNSUBSCRIBE_SECRET still sourced from process.env and fail-fast at import (config/unsubscribe.ts:L12-L13); no new secrets in code/commit/MR."

## acceptance_criteria_checklist

1. New token format implemented + exported from shared helper:
   - result: true
   - evidence: "config/unsubscribe.ts:L28-L34 (generateSignedToken) + L43-L80 (verifySignedToken) + L22 (SIGNED_TOKEN_RE) — all exported; imported by leads.ts:L15, unsubscribe.ts:L7, deletion.ts:L6."

2. unsubscribe.ts verifies timestamp + HMAC + returns HTML_INVALID on expiry:
   - result: true
   - evidence: "unsubscribe.ts:L111-L115 — `if (!verifySignedToken(id, token)) return c.html(HTML_INVALID, 400);` — verifySignedToken rejects expired/future/tampered/wrong-leadId; signedToken.test.ts:L59-L65 proves 31-day-old token returns false."

3. CCPA delete route verifies timestamp + HMAC likewise:
   - result: true
   - evidence: "deletion.ts:L113-L117 — identical `verifySignedToken` call; deletion.test.ts already exercises valid-token happy path + invalid-HMAC rejection against the new verifier."

4. All 6 unit test cases above present and passing:
   - result: true
   - evidence: "signedToken.test.ts:L49-L54 (valid), L57-L62 (expired 31d), L64-L69 (future), L71-L79 (tampered hmac), L81-L88 (malformed — 4 sub-assertions), L90-L93 (wrong leadId). Plus 2 format-emission tests L35-L46. All 8 pass per test_output above."

5. pnpm typecheck && pnpm lint && pnpm test all green:
   - result: true
   - evidence: "typecheck_output + lint_output + test_output sections above — all zero errors, 172 tests passing."

6. Branch pushed + MR opened; MR URL returned:
   - result: true
   - evidence: "merge_request.url = https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/4"

7. Commit message uses conventional format with fix(security): prefix:
   - result: true
   - evidence: "commit section above — `fix(security): add 30-day expiry to unsubscribe + delete tokens`; `git log fix/unsubscribe-link-expiry` shows sha f40a092 with that exact subject."

8. MR description notes breaking change + verification steps:
   - result: true
   - evidence: "MR body sections `## Breaking change` + `## Test plan` (4 automated + 2 manual QA bullets) — visible at https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/4"

9. No secrets in code/commit/MR:
   - result: true
   - evidence: "grep of diff confirms `UNSUBSCRIBE_SECRET` only appears as `process.env['UNSUBSCRIBE_SECRET']` (config/unsubscribe.ts:L12) and as literal string `'test-unsubscribe-secret'` / `'test-signed-token-secret'` in test files (non-production, obvious test value). MR body + commit body both reference the secret by name only, never by value."

10. self_review field complete — every field has result + evidence: file:line:
    - result: true
    - evidence: "self_review block above has 5 subfields (input_validated / null_handled / errors_caught / race_condition_safe / security_checked); every subfield has both `result:` + `evidence:` with concrete file:line references."

## web_searches

none

## notes

- Re-anchor checkpoint: scope_ok=y (only touched the 7 files in owned_files — no .env.example, no landing/, no infra/; those belong to T-040/T-041 which were modified concurrently on the working tree but stayed unstaged).
- Initial commit landed on the wrong branch (`fix/backup-gpg-encrypt`, T-040's branch — HEAD moved underneath me during parallel work). Recovered by cherry-picking f40a092 onto `fix/unsubscribe-link-expiry` from origin/main and resetting the T-040 branch to its prior tip before pushing. No code lost; no wrong-branch push to origin.
- Kept the existing `UUID_RE` + `TOKEN_RE` gate in routes/* before DB lookup — this preserves the "regex-reject before DB" perf + enumeration-resistance property of the original code, even though verifySignedToken re-checks the shape.
- `verifySignedToken` takes an optional `nowSeconds` param for deterministic tests. Production callers omit it and get `Date.now()` under the hood.
- HMAC input is `"<leadId>:<timestamp>"` (not `"<leadId>.<timestamp>"` or raw concat) — chose `:` as the separator since it cannot appear in base36 or hex and cannot appear in a UUIDv4, so there is no ambiguity / canonicalisation attack.

## issues

none

## remaining_items

none

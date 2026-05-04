---
task_id: T-042
verdict: pass
working_mode: static-analysis
approved_for_merge: true
---

# T-042 — Security audit of T-039 (unsubscribe + CCPA-delete token expiry)

## skill_loaded_evidence

files_read:
  - "SKILL.md:L96 — 'ห้ามสรุปว่า \"ไม่มีปัญหา\" โดยไม่มี file:line หรือ grep output เป็น evidence'"
  - "SKILL.md:L108 — 'ถ้าพบ CRITICAL → verdict: \"fail\" เสมอ ห้าม Lead override'"
  - "SKILL.md:L140 — Verdict Policy table (≥1 CRITICAL → fail; ≥1 HIGH + mitigation → pass)"
  - "references/security-checklists.md:L96 — 'HMAC Timing Safe: HMAC comparison ใช้ crypto.timingSafeEqual()'"
  - "references/security-checklists.md:L148 — 'CAN-SPAM: FTC 6 Elements ... opt-out honored ≤10 business days'"

## review_target

- branch: origin/fix/unsubscribe-link-expiry
- commit: f40a0926d1c47541dbc63297a5ff475a1eb9f9af
- base: origin/main (a65660d)
- mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/4
- diff_stat: "7 files changed, +227/-32"

## files_reviewed

- "apps/api/src/config/unsubscribe.ts: lines 1-83 (full file on target branch)"
- "apps/api/src/config/signedToken.test.ts: lines 1-108 (new file)"
- "apps/api/src/routes/unsubscribe.ts: lines 1-162 (full file)"
- "apps/api/src/routes/deletion.ts: lines 1-172 (full file)"
- "apps/api/src/routes/leads.ts: lines 1-394 (full file)"
- "apps/api/src/routes/deletion.test.ts: lines 1-175 (modified)"
- "apps/api/src/routes/leads.test.ts: lines 1-50 + 90-200 (modified mocks)"
- "apps/api/src/email/templates/autoReply.ts: lines 21, 77, 110 (URL sinks — audited for open-redirect)"
- "apps/api/src/email/sender.ts: lines 47, 57-60 (List-Unsubscribe header — RFC 8058)"
- "_workspace/T-039/output.md: lines 1-203 (agent self_review)"

## greps_executed

- "git grep -n 'createHmac|generateSignedToken|generateUnsubscribeToken' origin/fix/unsubscribe-link-expiry -- 'apps/**/*.ts' → 4 emission sites in leads.ts (L161, L217, L330, L384) all via generateSignedToken; createHmac appears only in config/unsubscribe.ts (L13,L36,L77) + 2 test files. No stale HMAC(leadId)-only emitter on target branch."
- "git grep -n 'unsubscribe|/api/delete' origin/fix/unsubscribe-link-expiry -- 'apps/api/src/email/' → email templates accept URL as parameter (autoReply.ts:L21,L77,L110); no hardcoded old-format sample URL."
- "git diff --stat origin/main..origin/fix/unsubscribe-link-expiry → 7 files, +227/-32 (scope matches task.md)"
- "git show origin/fix/unsubscribe-link-expiry:apps/api/src/config/unsubscribe.ts → full file confirms timingSafeEqual import + length pre-check + timestamp range gate"

## scope_compliance

files_changed_vs_owned: "match — all 7 files in diff are under apps/api/src/ (config + routes + tests). No out-of-scope edits (no landing/, no infra/, no .env/.env.example change on target branch, no drift into packages/)."

## audit_checklist_results

### Crypto correctness
1. **timingSafeEqual used** — OK. config/unsubscribe.ts:L83 `return timingSafeEqual(expected, provided);`
2. **Equal-length guaranteed before timingSafeEqual** — OK. config/unsubscribe.ts:L82 `if (provided.length !== expected.length) return false;` (Node throws if not; the explicit guard returns false cleanly)
3. **HMAC input unambiguous** — OK. config/unsubscribe.ts:L36-L38 `createHmac(...).update(`${leadId}:${ts}`)`. Separator `:` cannot appear in UUIDv4 (hex+dash only) or in base36 timestamp or hex HMAC → no canonicalisation ambiguity. Further, HMAC input binds *both* leadId and ts, so a captured sig cannot be replayed for a different leadId nor re-used at a different timestamp.
4. **UNSUBSCRIBE_SECRET boot validation** — PARTIAL (see SEC-001). config/unsubscribe.ts:L15-L17 rejects unset/empty, but does not enforce min length/entropy.
5. **Timestamp range check** — OK. config/unsubscribe.ts:L58-L64: `Number.isFinite(ts)` + `ts < 0` reject, future reject (`ts > now`), expired reject (`ts < now - TTL`). Boundary inclusive `ts == now - TTL` still valid (confirmed by test signedToken.test.ts:L66 `verifyAt = now + TOKEN_TTL_SECONDS` expected true).
6. **Regex rejects ambiguous inputs** — OK. config/unsubscribe.ts:L24 `/^[0-9a-z]{1,12}\.[0-9a-f]{64}$/` anchored + single literal dot + fixed 64-hex. Rejects `a.b.c` (test L87), empty, dotless legacy HMAC (test L85-L86), uppercase hex.

### Breaking change review
7. **Old-format verification fails** — OK. signedToken.test.ts:L85 asserts legacy plain-HMAC token returns false (regex gate rejects shape before HMAC ever runs). No silent fallback.
8. **All token-emission sites updated** — OK. leads.ts:L161, L217, L330, L384 all call `generateSignedToken(…)` (grep above). No orphan `createHmac(...leadId)` emitter remains in production source.
9. **Email templates reference** — OK. autoReply.ts:L21 takes `unsubscribeUrl` + `deletionUrl` as parameters — no hardcoded old-format sample embedded in HTML/text; URLs are built fresh per-send in leads.ts.

### Test coverage
10. **All 6 rejection paths covered** — OK. signedToken.test.ts: valid (L43-L48, L51-L58), expired-31d (L60-L65), future (L67-L72), tampered (L74-L82), malformed/no-dot/legacy/empty/triple-dot (L84-L92), wrong leadId (L94-L98). Plus format-emission determinism (L32-L46). 8 tests, all passing per output.md:L63.
11. **Happy path now+now** — OK. signedToken.test.ts:L45-L47 `verifySignedToken(LEAD_ID, token, now) === true`.
12. **SIGNED_TOKEN_RE positive + negative** — OK. Positive: L33-L34. Negative: L85-L92 exercises four malformed shapes.

### Other OWASP checks
13. **A02 / A04 Cryptographic Failures (OWASP 2025)** — OK. HMAC-SHA256 is still NIST SP 800-107 approved; 256-bit tag; constant-time compare. Scheme is now replay-bounded (future reject + 30-day TTL + HMAC-over-"leadId:ts") → improvement over baseline.
14. **A07 Identification + Auth Failures** — OK. No auth bypass; regex + format + timestamp + HMAC all must pass before DB mutation. Order of checks in unsubscribe.ts:L88-L115 and deletion.ts:L90-L117 is correct (format → DB lookup → token verify → state check → mutate). DB is queried before HMAC verify, which leaks *existence* of a lead id to an attacker who already has a UUIDv4 guess — but lead ids are 122-bit random UUIDv4 so enumeration is infeasible. Note-level only, not a finding.
15. **A10 SSRF** — N/A: no outbound URL built from user input on these routes; URLs are server-composed in leads.ts:L218-L219, L385-L386 with static `https://vollos.ai` host and `newLead.id` (UUID) + server-generated token.

## security_findings

- id: SEC-001
  severity: "medium"
  cvss_estimate: "~5.3 (estimated — CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N, defense-in-depth gap)"
  category: "secrets (CWE-798) / cryptographic-strength (CWE-326)"
  description: "UNSUBSCRIBE_SECRET is validated only for presence, not for minimum length/entropy. A misconfigured deploy with an 8-char secret would boot successfully, letting the HMAC keyspace be brute-forced offline from a single captured token + known leadId within hours. Fail-fast would catch this at boot instead of in incident response."
  file: "apps/api/src/config/unsubscribe.ts:L15-L17"
  evidence: "const _secret = process.env['UNSUBSCRIBE_SECRET']; if (!_secret) throw new Error('[unsubscribe] UNSUBSCRIBE_SECRET is not set'); export const UNSUBSCRIBE_SECRET: string = _secret;"
  recommendation: "apps/api/src/config/unsubscribe.ts:L15 — extend the boot guard: `if (!_secret || _secret.length < 32) throw new Error('[unsubscribe] UNSUBSCRIBE_SECRET must be ≥32 chars (hex/base64 of ≥16 random bytes)');`. Matches the 256-bit keyspace that HMAC-SHA256 expects (NIST SP 800-107 §5.3.4). Document in .env.example."

- id: SEC-002
  severity: "low"
  cvss_estimate: "~3.1 (estimated — informational, no exploit path under current regex gate)"
  category: "defense-in-depth (CWE-20)"
  description: "`Buffer.from(hmacPart, 'hex')` at config/unsubscribe.ts:L80 is wrapped in try/catch, but Node's `Buffer.from(..., 'hex')` does not throw on invalid hex — it silently drops non-hex chars. The catch is unreachable. No exploit today because SIGNED_TOKEN_RE on L55 already restricts hmacPart to `[0-9a-f]{64}`, but the comment suggests a guarantee that Node does not provide. Future regex relaxation could reintroduce silent truncation."
  file: "apps/api/src/config/unsubscribe.ts:L78-L82"
  evidence: "let provided: Buffer; try { provided = Buffer.from(hmacPart, 'hex'); } catch { return false; } if (provided.length !== expected.length) return false;"
  recommendation: "apps/api/src/config/unsubscribe.ts:L78 — replace try/catch with explicit assertion: drop the try/catch (it is dead code), keep the length guard on L82 which is the real defence. Optionally add a comment: `// SIGNED_TOKEN_RE already guarantees 64 hex chars → length guard is sufficient; Buffer.from(...,'hex') does not throw on invalid input.`"

- id: SEC-003
  severity: "low"
  cvss_estimate: "~3.7 (estimated — usability/compliance friction, not a security weakening)"
  category: "us_privacy"
  description: "The CCPA delete token shares the 30-day TTL with the unsubscribe token. A consumer who opens an older email (day 31+) to click 'Delete my data' will hit HTML_INVALID and must find a second path. CCPA §1798.105 does not require an email-link delete mechanism, so this is not a compliance fail — but user-friendly privacy practice suggests either (a) longer TTL for delete, or (b) clearer HTML_INVALID copy that points to an always-on deletion request form."
  file: "apps/api/src/routes/deletion.ts:L116 + apps/api/src/config/unsubscribe.ts:L22 (shared TOKEN_TTL_SECONDS)"
  evidence: "export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days  (used by both unsubscribe and delete via the same verifySignedToken call at deletion.ts:L116)"
  recommendation: "apps/api/src/routes/deletion.ts:L68-L72 (HTML_INVALID copy for delete) — update copy to: `This deletion link has expired after 30 days. To request deletion, email privacy@vollos.ai or visit https://vollos.ai/privacy`. Alternatively split the TTL — e.g. `DELETE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60` and pass an optional TTL override to verifySignedToken — but this is a product decision, not a security requirement. Defer to Lead/owner."

## us_privacy_compliance

unsubscribe_mechanism: "present"
physical_address_in_email: "unverified — outside T-039 diff scope (audited in prior task via autoReply.ts footer; no regression here)"
audit_log: "present"
data_minimization: "ok — audit log uses maskEmail() (unsubscribe.ts:L79-L83, deletion.ts:L79-L83); IP anonymised (leads.ts:L56-L61 unchanged); CCPA delete clears ipAddress + userAgent (deletion.ts:L125-L136)"

## compliance_verdict

can_spam: pass
  # 30-day TTL ≥ 22 US business days (§5(a)(3)(A) requires opt-out honored ≤10 business days).
  # An email sent month+1 still has 22 business days of working unsubscribe link → well inside the 10-day CAN-SPAM window.
  # List-Unsubscribe header (sender.ts:L57-L60) provides the mailbox-side one-click path independent of the signed token.

ccpa_delete: pass
  # CCPA §1798.105 gives the business 45 days to respond to verified deletion requests.
  # The 30-day token TTL constrains a convenience mechanism (email-link delete), not the statutory path.
  # Expired-token users still have statutory recourse (privacy@vollos.ai, form, postal request) so no §1798.130 violation.
  # SEC-003 (low) suggests a UX improvement to HTML_INVALID copy; not a compliance blocker.

## summary

T-039 replaces a signatureless indefinite-validity unsubscribe/delete HMAC with a `<base36-ts>.<hex-hmac>` scheme that binds timestamp + leadId into the MAC input and enforces a 30-day TTL. Crypto primitives are correctly applied: `timingSafeEqual` on equal-length buffers, future-ts rejection, expired-ts rejection, strict regex gate before DB touch, and no silent legacy fallback. All 4 emission sites in leads.ts migrated; no stale `createHmac(leadId).digest()` emitter remains on the target branch. Test suite adds 8 cases covering the 6 T-039 rejection paths plus deterministic emission; 172 tests total pass per agent output.md. Three findings (one MEDIUM, two LOW) are all defence-in-depth / UX improvements — none weaken the new scheme or block the merge. CAN-SPAM 10-business-day opt-out window is satisfied (30 days ≫ 10 business days). CCPA 45-day response window remains satisfied via statutory channels; the 30-day link TTL is a convenience layer, not the statutory path.

## skipped_sections

[]

## conditional_conditions

[]

## recommended_followups

- id: FU-001
  severity: "medium"
  action: "Add a min-length guard on UNSUBSCRIBE_SECRET at boot (see SEC-001). Owner may choose 32 chars (recommended) or 24. Document in .env.example."
- id: FU-002
  severity: "low"
  action: "Either remove the unreachable try/catch at config/unsubscribe.ts:L78-L82 or add a clarifying comment (see SEC-002)."
- id: FU-003
  severity: "low"
  action: "Improve HTML_INVALID copy on /api/delete to point expired-link users to an always-on deletion path (see SEC-003). Optional split TTL."

completion_signal: "task_id=T-042 verdict=pass findings=3 path=_workspace/T-042/review-auditor.md"

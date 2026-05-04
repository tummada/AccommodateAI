---
id: T-042
title: Security audit — T-039 unsubscribe/delete token expiry
assigned_to: vollos-auditor
priority: high
status: in_progress
spawn_started_at: 2026-04-20T10:10+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-039]
review_target:
  branch: origin/fix/unsubscribe-link-expiry
  commit: f40a092
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/4
  base: origin/main (a65660d)
---

## Context

T-039 added 30-day expiry to unsubscribe + CCPA-delete tokens. Previous scheme was `HMAC-SHA256(SECRET, leadId)` with no expiry. New scheme is `<base36-timestamp>.<hex-hmac>` where HMAC covers `"<leadId>:<timestamp>"`.

## Scope (READ-ONLY)

Review the diff `origin/main..origin/fix/unsubscribe-link-expiry` against OWASP + crypto best practice.

Use `git show origin/fix/unsubscribe-link-expiry:<path>` to read target files without checkout (another branch may be checked out in parallel).

Files to review:
- `apps/api/src/config/unsubscribe.ts` — token generator/verifier
- `apps/api/src/routes/unsubscribe.ts` — verify call site
- `apps/api/src/routes/deletion.ts` — verify call site
- `apps/api/src/routes/leads.ts` — token emission sites
- `apps/api/src/config/signedToken.test.ts` — 8 unit tests

## Audit Checklist

Rate each item with: 🔴 CRITICAL / 🟡 WARNING / 🟢 OK / ⚪ N/A, with file:line evidence.

### Crypto correctness
1. Is `timingSafeEqual` used for HMAC comparison? (constant-time)
2. Are HMAC buffers guaranteed equal length before `timingSafeEqual`? (Node throws if not)
3. Is the HMAC input `leadId:timestamp` unambiguous? (signature transfer resistance)
4. Is `UNSUBSCRIBE_SECRET` validated for minimum length / entropy at boot?
5. Is the timestamp range check correct? (not NaN, not future, not > 30 days old)
6. Does the regex for token format reject ambiguous inputs?

### Breaking change review
7. Does old-format verification truly fail? (no silent fallback)
8. Any token-generating site that wasn't updated to new format? (grep `HMAC|createHmac` in codebase)
9. Any email template reference to old-format URL samples that need updating?

### Test coverage
10. Do tests cover all 6 rejection paths (expired, future, tampered, malformed, wrong leadId, bad length)?
11. Is there a test for token generated right now + verified right now (happy path)?
12. Is `SIGNED_TOKEN_RE` regex covered by positive + negative cases?

### Other OWASP checks
13. A02 (Cryptographic Failures) — does new scheme meet CWE-798/321 standards?
14. A07 (Identification + Auth Failures) — any auth bypass introduced?
15. A10 (SSRF) — does any URL construction take untrusted input without sanitization?

## Compliance

- CAN-SPAM: one-click unsubscribe within 10 business days — does 30-day expiry still comply? (yes if token works 30 days from send, but: verify emails from month+1 still work for at least 10 business days per CAN-SPAM `§5(a)(3)(A)`)
- CCPA Right-to-Delete: 45-day response window — does the delete token's 30-day expiry conflict? (user who requests delete after 31 days from last email would get `HTML_INVALID` — is that acceptable, or should delete token have longer TTL than unsubscribe?)

Flag any conflict as 🟡 WARNING with recommendation.

## Deliverable

Write `review-auditor.md` with:

```yaml
verdict: pass | conditional_pass | fail
summary: |
  One-paragraph overall assessment
findings:
  - severity: critical|warning|note
    id: A-T039-NN
    title: ...
    location: "apps/api/src/config/unsubscribe.ts:NN"
    impact: ...
    fix: ...
compliance_verdict:
  can_spam: pass|fail|review-needed
  ccpa_delete: pass|fail|review-needed
approved_for_merge: true | false
```

If any CRITICAL → `verdict: fail` and `approved_for_merge: false`. Lead will not merge until resolved.

## Deliverable path

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-042/review-auditor.md`

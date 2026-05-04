---
id: T-044
title: Security audit — T-041 landing SRI + Google GSI compensating controls
assigned_to: vollos-auditor
priority: high
status: in_progress
spawn_started_at: 2026-04-20T10:10+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-041]
review_target:
  branch: origin/fix/landing-sri
  commit: d020d11
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/5
  base: origin/main (a65660d)
---

## Context

T-041 applied Subresource Integrity to Cloudflare Turnstile script but **skipped Google GSI** because Google returns different bytes for the same URL (feature-flag injection). Frontend agent documented the decision + compensating controls (CSP origin lock + server-side JWT verify). This review must confirm the trade-off is acceptable.

## Scope (READ-ONLY)

Review diff `origin/main..origin/fix/landing-sri`.

Use `git show origin/fix/landing-sri:<path>`.

Files to review:
- `apps/landing/index.html` — SRI attribute application + inline comments
- `apps/landing/README.md` (new) — SRI management + Google GSI justification

Also cross-check existing Caddy config for `script-src` CSP header:
- `infra/Caddyfile` (read current main version — `git show origin/main:infra/Caddyfile`)

## Audit Checklist

Rate each with 🔴/🟡/🟢/⚪ + file:line.

### SRI application
1. Is `sha384` hash used (not sha256 — weaker for collision resistance)?
2. Is `crossorigin="anonymous"` present on every scripted with `integrity=`?
3. Does the hash match what Cloudflare Turnstile currently serves? (verify: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`)
4. Is every external `<script src=...>` tag in the HTML accounted for (either has SRI, or has explicit "cannot SRI" justification)?
5. Is there any inline script that fetches external resources via fetch/import without SRI? (CSP should block, verify)

### Google GSI decision
6. Is the Google-GSI no-SRI decision documented in-code with a comment pointing to README?
7. Does README state WHY (not just THAT) SRI can't be applied — including evidence of byte fluctuation?
8. Does README list the compensating controls concretely? (CSP origin, JWT verify)

### Compensating controls for Google GSI
9. Does CSP `script-src` pin `accounts.google.com` + `https://gsi.google.com` (exact origins, not wildcard)?
10. Does CSP `script-src` avoid `'unsafe-inline'` and `'unsafe-eval'`? (if present, 🔴)
11. Does the landing page do server-side verification of the Google JWT (via JWKS + `iss` + `aud` + `exp` checks) before creating a session? Find the verification code path.
12. Is the Google client_id hardcoded or env-driven? (env is better for rotation)

### Turnstile SRI robustness
13. If Cloudflare updates Turnstile script, will the refresh procedure in README actually restore service? Walk through the procedure mentally.
14. Is there a monitoring/alerting hook for when Turnstile SRI fails? (Chrome CSP reports, Sentry error on load fail, etc.) — may be follow-up not blocker

### Other OWASP
15. A08 (Software + Data Integrity): does SRI + CSP together adequately mitigate supply-chain compromise of Turnstile? For Google GSI, is the residual risk acceptable given CSP + JWT verification?

## Deliverable

Write `review-auditor.md` with:

```yaml
verdict: pass | conditional_pass | fail
summary: |
  Overall assessment — especially: is the Google GSI no-SRI trade-off acceptable?
findings:
  - severity: critical|warning|note
    id: A-T041-NN
    title: ...
    location: "apps/landing/index.html:NN"
    impact: ...
    fix: ...
approved_for_merge: true | false
residual_risk_accepted: true | false  # specifically for Google GSI no-SRI
```

## Deliverable path

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-044/review-auditor.md`

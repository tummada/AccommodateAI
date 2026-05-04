---
id: T-052
title: Security audit — T-051 CSP allow static.cloudflareinsights.com
assigned_to: vollos-auditor
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T11:40+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-051]
review_target:
  branch: origin/fix/csp-cf-insights
  commit: 9b4aef5
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/8
  base: origin/main (d97d515)
---

## Context

T-051 adds `https://static.cloudflareinsights.com` to CSP `script-src` in `infra/Caddyfile` to unblock the Cloudflare Web Analytics beacon (auto-injected by CF edge). This is a trust-expansion change.

## Scope (READ-ONLY)

Use `git show origin/fix/csp-cf-insights:infra/Caddyfile` — do not checkout.

## Audit Checklist

Rate each 🔴/🟡/🟢 with file:line evidence.

1. Is only `script-src` affected? (Other directives untouched: style-src, connect-src, frame-src, img-src, object-src, base-uri, form-action, frame-ancestors)
2. Is `unsafe-inline` / `unsafe-eval` NOT introduced?
3. Is the new host pinned to exact domain (`static.cloudflareinsights.com`) not wildcard (`*.cloudflareinsights.com` or `https:`)?
4. Comment explains WHY this host is allowed?
5. `connect-src` situation: beacon uses `navigator.sendBeacon` to `cloudflareinsights.com/cdn-cgi/rum`. If `connect-src` not set, `default-src 'self'` blocks this POST. Is that OK (just script load warnings, no analytics upload)? Or should `connect-src` be added too?
6. Does this trust addition increase supply-chain risk meaningfully? (CF is already in our trust boundary for TLS + Turnstile — incremental risk assessment)
7. Are there alternative mitigations (SRI? subresource pinning?) — CF Insights beacon URL is version-hashed, so SRI would work until CF updates. Document feasibility.

## Deliverable

```yaml
verdict: pass | conditional_pass | fail
summary: |
  Overall: is this CSP expansion acceptable?
findings:
  - severity: critical|warning|note
    id: A-T051-NN
    title: ...
    location: infra/Caddyfile:NN
    impact: ...
    fix: ...
approved_for_merge: true | false
```

Deliverable: `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-052/review-auditor.md`
Report under 200 words.

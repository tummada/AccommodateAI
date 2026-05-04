---
id: T-051
title: Allow Cloudflare Insights beacon in CSP script-src
assigned_to: vollos-devops
priority: low
status: in_progress
spawn_started_at: 2026-04-20T11:25+07:00
security_checkpoint: true
owned_files:
  - infra/Caddyfile
dependencies: []
---

## Context

Owner browser-test (2026-04-20) on https://vollos.ai showed CSP violation:
```
Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/v8c78df7c7c0f484497ecbca7046644da1771523124516'
violates Content Security Policy directive: "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com"
```

Cloudflare auto-injects the Insights beacon (Web Analytics — free RUM). Blocking it is fine functionally (just no analytics), but since owner wants CF Web Analytics to work, add `static.cloudflareinsights.com` to the CSP script-src allowlist.

## Scope

1. `grep -n "script-src" infra/Caddyfile` to find the CSP directive
2. Add `https://static.cloudflareinsights.com` to the `script-src` list (preserve existing entries)
3. Do NOT relax any other CSP directive — only add this one host to script-src
4. Also consider: `connect-src` may need the same host if the beacon POSTs telemetry (check beacon behavior — it does `navigator.sendBeacon` to `cloudflareinsights.com/cdn-cgi/rum`). Add to `connect-src` if present; if `connect-src` not in CSP, don't add it (CSP default is `default-src` which is already `'self'` — that will block the POST but that's a separate issue from the script load violation; document this limitation)

## Security Consideration

- Trust model: Cloudflare is already in our pipeline (TLS termination, Turnstile). Adding one more CF host is low incremental risk.
- But: every host in script-src is a potential supply-chain attack surface. Document this in a comment above the line.

## Workflow

1. `git fetch origin && git checkout -b fix/csp-cf-insights origin/main`
2. Implement
3. Validate Caddyfile syntax: `caddy validate --config infra/Caddyfile` (if caddy CLI available) or use Docker: `docker run --rm -v $PWD/infra:/etc/caddy caddy:alpine caddy validate --config /etc/caddy/Caddyfile`
4. Commit: `fix(security): allow Cloudflare Insights beacon in CSP script-src`
5. Push + open MR

## Acceptance Criteria

1. [ ] `static.cloudflareinsights.com` added to `script-src` in `infra/Caddyfile`
2. [ ] All existing script-src entries preserved (don't accidentally remove any)
3. [ ] `caddy validate` passes
4. [ ] Comment added explaining why this host is allowed (link to CF Insights docs or 1-line note)
5. [ ] Branch pushed + MR opened
6. [ ] `self_review` complete — every AC has `result: true/false` + `evidence: file:line`

## Note for Auditor (coming after)

Will review this CSP change. Key questions:
- Is `connect-src` also affected? (probably not — no `connect-src` directive means `default-src 'self'` blocks the POST, which is tolerable)
- Any other CSP directives tightening needed?

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-051/output.md`

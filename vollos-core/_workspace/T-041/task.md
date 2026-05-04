---
id: T-041
title: Subresource Integrity on external scripts (HIGH-3)
assigned_to: vollos-frontend
priority: high
status: in_progress
spawn_started_at: 2026-04-20T09:30+07:00
security_checkpoint: true
owned_files:
  - apps/landing/index.html
  - apps/landing/**
dependencies: []
---

## Context

Security audit `security-check-output/20260420_091511/security_report_human.md` flagged HIGH-3:
- `apps/landing/index.html:17-18` loads Turnstile + Google GSI scripts from `challenges.cloudflare.com` + `accounts.google.com` WITHOUT `integrity=` attribute
- If CDN is compromised (or attacker pins different script under same URL) → browser executes hostile JS → XSS on entire landing page, including on legitimate user sessions

## Goal

Add `integrity="sha384-..." crossorigin="anonymous"` attributes to all external `<script>` tags — so browser refuses to run a tampered version.

## Design

1. Compute SHA-384 of each external script currently served
2. Add `integrity` + `crossorigin="anonymous"` attributes
3. Verify page still works by loading it locally (or in a staging environment)

**Important caveat:** Cloudflare Turnstile and Google GSI are versioned URLs that provider may update — when they do, the SRI will invalidate and our landing page breaks for new visitors. Agent must:
- Document this fragility in a comment above the script tags
- Explicitly list these URLs in `apps/landing/README.md` (or create one) with a "known-URL SRI management" note — "if either provider updates, Turnstile/GSI scripts stop loading and we must refresh the hashes"
- Set up a fallback plan (OK to just document — no runtime fallback)

## Scope

1. Identify all external `<script src="https://...">` tags in `apps/landing/` (HTML + any loader JS)
2. For each, fetch the current file and compute `openssl dgst -sha384 -binary <file> | openssl base64 -A` → `sha384-<value>`
3. Add `integrity` + `crossorigin="anonymous"` to each tag
4. Add comment above explaining: "If Turnstile/GSI is updated by provider, refresh integrity hash here" + reference to README note
5. Smoke-test locally: open landing page in a browser (or use curl to fetch + inspect) → confirm no console errors, One Tap + Turnstile both load
6. NO inline scripts need SRI — only external src= tags

## Workflow

1. `git fetch origin && git checkout -b fix/landing-sri origin/main`
2. Implement
3. Smoke test locally — `pnpm --filter @vollos/landing dev` + manual open
4. Commit: `fix(security): add SRI to external scripts on landing page`
5. Push + open MR

## Placeholder Audit

Before output.md:
```
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" <all changed files>
```

## Acceptance Criteria

1. [ ] All external `<script src="https://...">` tags have `integrity="sha384-..."` + `crossorigin="anonymous"`
2. [ ] Inline scripts untouched (SRI N/A)
3. [ ] Comment above each tag explaining the fragility + refresh procedure
4. [ ] `apps/landing/README.md` (or inline comment) documents SRI management
5. [ ] Landing page verified to load + function (Turnstile challenge renders, GSI button appears) in a local/staging browser
6. [ ] Branch pushed + MR opened; URL returned
7. [ ] Commit message uses `fix(security):` prefix
8. [ ] No placeholders (`alert()`, `coming soon`, etc.) remain in changed files
9. [ ] `self_review` field complete — every field has `result` + `evidence: file:line`

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: file:line — description`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-041/output.md`

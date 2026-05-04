# VOLLOS Landing Page

Static landing page served by Caddy from `apps/landing/`. No build step.

- Dev: `pnpm --filter @vollos/landing dev` (spins up `npx serve . -l 3000`)
- Prod: served as static files by Caddy

## Known-URL SRI Management (IMPORTANT)

This page loads two external third-party scripts. Subresource Integrity (SRI) is
applied where feasible. This section documents the state of each script and the
refresh procedure when a hash mismatch breaks the page.

### 1. Cloudflare Turnstile — SRI APPLIED

- URL: `https://challenges.cloudflare.com/turnstile/v0/api.js`
- Behavior: 302 redirect to a versioned URL `/turnstile/v0/g/<build>/api.js`
- Body: STABLE across requests (same SHA-384 across repeated fetches)
- `integrity="sha384-..."` + `crossorigin="anonymous"` applied in `index.html`
- Fragility: when Cloudflare rolls a new build, the versioned target changes
  and the hash invalidates. Turnstile will stop rendering for all visitors
  until the hash is refreshed in `index.html`.

Refresh procedure (run locally, no secrets involved):

```bash
curl -sL -A "Mozilla/5.0" https://challenges.cloudflare.com/turnstile/v0/api.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Prepend `sha384-` to the output and replace the `integrity=` value above the
Turnstile `<script>` tag in `apps/landing/index.html`.

How to detect a broken hash in production:

- Turnstile widget does not render (empty container where CAPTCHA should be)
- Browser DevTools console shows: "Failed to find a valid digest in the
  'integrity' attribute for resource 'https://challenges.cloudflare.com/...'"
- Manual lead form submission starts failing server-side because no Turnstile
  token is produced

### 2. Google Identity Services (GSI) — SRI NOT APPLIED (intentional)

- URL: `https://accounts.google.com/gsi/client`
- Behavior: 200 OK directly, no redirect
- Body: UNSTABLE — size fluctuates between requests (observed 265504, 265540,
  265541 bytes within a few seconds). Google injects experiment flags /
  feature toggles into the served bundle, so the body hash differs on every
  load.
- SRI status: intentionally omitted. Applying a fixed integrity hash would
  cause the browser to refuse to execute the script on the very next visit
  and break Google One Tap + the explicit "Sign in with Google" button for
  every user.

Verification commands (run locally to reproduce the instability):

```bash
for i in 1 2 3; do
  curl -sL -A "Mozilla/5.0" https://accounts.google.com/gsi/client \
    | openssl dgst -sha384 -binary | openssl base64 -A
  echo " attempt $i"
  sleep 5
done
```

When the output shows three different hashes, SRI on this URL is not safe to
apply until Google publishes a pinned / stable-hash endpoint.

Mitigations that stand in for SRI on GSI:

- CSP `script-src` already restricts script origins to
  `https://accounts.google.com` (configured in Caddy / reverse proxy), so an
  attacker cannot substitute a different origin via XSS.
- COOP/COEP and referrer policy are set by Caddy to limit cross-origin
  leakage.
- Server-side ID token verification: the backend validates every Google
  credential JWT against Google's public JWKS (`aud`, `iss`, expiry) before
  trusting any claim. A tampered GSI bundle cannot forge a valid signed
  Google ID token.
- Monitor Google Identity release notes — if Google announces a pinned
  versioned endpoint, apply SRI at that point.

### General refresh policy

- When either provider updates their script, the page MAY break for new
  visitors until the hash is refreshed (Turnstile) or verified still-unstable
  (GSI).
- Fallback plan for Turnstile outage: the manual lead form stays visible; if
  the Turnstile widget cannot render due to SRI mismatch, server-side
  Siteverify will reject submissions, but visitors still see a usable page
  instead of a broken CAPTCHA. Google One Tap works independently of
  Turnstile.
- No runtime fallback is implemented (per task T-041 scope). Documentation
  only.

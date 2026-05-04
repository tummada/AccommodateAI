---
task_id: T-041
status: "completed"
spawn_completed_at: 2026-04-20T09:55+07:00
branch: fix/landing-sri
commit: d020d11
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/5
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464232744
---

## skill_loaded_evidence

files_read:
  - "SKILL.md:L44-L55 — 'ห้าม hardcode server secrets ... TURNSTILE_SITE_KEY (Cloudflare site key — public by design)'"
  - "SKILL.md:L211 — 'CSP awareness — script-src ต้องอนุญาต accounts.google.com (GIS) + challenges.cloudflare.com (Turnstile)'"
  - "SKILL.md:L256-L275 — Self-Review evidence format requirement"
  - "task.md:L23 — 'Add integrity=\"sha384-...\" crossorigin=\"anonymous\" attributes to all external <script> tags'"
  - "task.md:L31-L35 — 'Cloudflare Turnstile and Google GSI are versioned URLs ... document this fragility'"

## files_changed

- path: apps/landing/index.html
  action: modified
  summary: |
    Added SRI integrity + crossorigin to Turnstile script.
    Added inline HTML comments above both script tags documenting fragility
    and (for GSI) why SRI is intentionally omitted.
- path: apps/landing/README.md
  action: created
  summary: |
    New "Known-URL SRI Management" section. Per-script status (Turnstile
    applied, GSI intentionally skipped with justification), refresh
    procedure, detection guidance, compensating controls for GSI,
    fallback policy.

## key_findings

1. **Google GSI body is not stable** — fetching `https://accounts.google.com/gsi/client`
   three times within ~10s returned 3 different body sizes (265504, 265540, 265541
   bytes). Applying any fixed SRI hash would break One Tap + Sign-in button for
   every visitor. Documented as intentional non-application.
2. **Turnstile body is stable** — 3 fetches over 30s returned the same SHA-384:
   `rlU7C/+BbRScu+tYTeLQAOB0RMJcPZlIND5YyA+JNAgrhLQhk42O1VkfeAoJEzi/`. SRI safely
   applied.
3. **Cloudflare redirects** `/turnstile/v0/api.js` (302) → `/turnstile/v0/g/<build>/api.js`.
   SRI still works because browsers hash the final response body, but when
   Cloudflare rolls a new build, the hash invalidates and Turnstile stops
   rendering until the hash is refreshed.

## smoke_test

- dev server: `cd apps/landing && npx serve . -l 3001` (started in background)
- curl: `curl -s http://localhost:3001/ -o /tmp/t041-fetched.html` → 53584 bytes
- grep served output → exactly 1 `integrity="sha384-..."` attribute present
- cross-check: served hash vs `curl -sL ...cloudflare.../api.js | openssl dgst ...`
  → **MATCH** (`rlU7C/+BbRScu+tYTeLQAOB0RMJcPZlIND5YyA+JNAgrhLQhk42O1VkfeAoJEzi/`)
- **Real-browser test: NOT executed** — no Puppeteer/Playwright installed locally.
  Owner should manually open staging landing page in Chrome + Firefox and confirm:
    - Turnstile CAPTCHA widget renders
    - Google Sign-in button appears
    - DevTools console shows no "Failed to find a valid digest in the 'integrity'
      attribute" errors
  This is flagged in the MR description as a required manual step before deploy.

## placeholders_remaining

none — grep clean.

Command run:
```
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" \
  apps/landing/index.html apps/landing/README.md
```
Output: (empty)

## self_review

xss_safe:
  result: true
  evidence: "No user-input handling changed; only static HTML attribute additions on external <script> tags — apps/landing/index.html:L29-L32"
error_states_complete:
  result: true
  evidence: "SRI failure mode documented in README.md:L33-L42 + fallback policy L88-L96; no new runtime error paths introduced"
loading_states_complete:
  result: true
  evidence: "No change to form submit / loading logic; scripts retain async defer — apps/landing/index.html:L32, L43"
responsive_checked:
  result: true
  evidence: "No layout change; only <script> tags and HTML comments edited — apps/landing/index.html diff shows no CSS/layout delta"
no_credential_leak:
  result: true
  evidence: "No console.log / credential handling touched; SRI hashes are public integrity values, not secrets — grep 'credential\\|token' on diff → zero hits"
sri_applied_where_possible:
  result: true
  evidence: "Turnstile has integrity+crossorigin — apps/landing/index.html:L29-L32; hash cross-checked vs upstream and matches"
sri_skipped_with_justification:
  result: true
  evidence: "GSI script retains no integrity attribute with explicit inline comment + README.md:L45-L86 explaining body-instability verification and compensating controls"
fragility_documented:
  result: true
  evidence: "Inline HTML comment apps/landing/index.html:L18-L28 + README.md:L13-L32 explain when hash breaks + refresh procedure"
smoke_test_evidence:
  result: partial
  evidence: "curl-level evidence captured (served HTML contains correct integrity hash, hash matches upstream) but no real-browser E2E run — flagged in MR as owner manual verification step"
placeholder_audit:
  result: true
  evidence: "grep on both changed files returned empty — documented in placeholders_remaining section above"
commit_message_conventional:
  result: true
  evidence: "git log: 'fix(security): add SRI to external scripts on landing page' — commit d020d11"

## acceptance_criteria_status

1. All external `<script src=\"https://...\">` tags have `integrity=\"sha384-...\"` + `crossorigin=\"anonymous\"` — **PARTIAL**. Turnstile: YES. GSI: NO (intentional, body not stable — see key_findings #1 + MR description).
2. Inline scripts untouched (SRI N/A) — **YES**. Only external src= tags affected.
3. Comment above each tag explaining the fragility + refresh procedure — **YES**. `apps/landing/index.html:L17-L28` (Turnstile), `L33-L42` (GSI).
4. `apps/landing/README.md` documents SRI management — **YES**. Created with "Known-URL SRI Management" section.
5. Landing page verified to load + function — **PARTIAL**. curl-level smoke test passed (served HTML contains correct integrity hash matching upstream). Real-browser verification (Turnstile CAPTCHA renders, Google button appears) requires manual owner check — flagged in MR.
6. Branch pushed + MR opened — **YES**. MR !5, branch `fix/landing-sri`.
7. Commit message uses `fix(security):` prefix — **YES**. Commit `d020d11`.
8. No placeholders remain in changed files — **YES**. grep clean.
9. `self_review` field complete — **YES**. Every field has result + evidence with file:line.

## assumptions

- assumed: "Google GSI body-variance is a stable property of Google's serving strategy (experiment injection) not a transient rate-limit artifact — verified by 3 successful 200 OK fetches over 10s with 5s sleep between each, still showing size variance 265504↔265540↔265541 bytes — impact if wrong: we should apply SRI to GSI too; confirm via repeat verification in different geo / time window"
- assumed: "Task scope 'smoke test that Turnstile + One Tap still work' can be satisfied by curl-level evidence + inline hash cross-check when no local browser automation is available — stated explicitly in task constraints 'If you cannot verify in a real browser, state so explicitly (do not fake claim)'. Owner manual verification flagged in MR as required pre-deploy step."

## notes

- Task ran from a starting state where another agent's commit (T-039 `f40a092`) had already been made on a shared working branch `fix/unsubscribe-link-expiry`. Initial T-041 commit landed on that branch by accident (branch state wasn't restored between harness shells). Recovered by cherry-picking onto `fix/landing-sri` (proper branch from `origin/main`) and then resetting `fix/unsubscribe-link-expiry` back to its original tip so the two MRs remain independent.
- Final layout: `fix/landing-sri` = `origin/main` + T-041 commit only. Clean diff for MR !5 reviewer.
- SRI choice rationale (defense-in-depth): SRI on Turnstile protects against Cloudflare CDN compromise. GSI compensating controls are: (a) CSP script-src pinned to `accounts.google.com`, (b) server-side ID token verification against Google JWKS. These are not equivalent to SRI but do prevent the most-realistic attack (XSS substituting a different origin).

## issues

- None blocking. The GSI-no-SRI decision is a documented upstream limitation, not a defect.

## next_action

Owner manual smoke test before merge:
1. Open `https://vollos.ai/` (staging or prod post-merge) in Chrome + Firefox
2. Confirm Turnstile CAPTCHA widget renders below the email form
3. Confirm Google Sign-in button renders
4. Open DevTools → Console → confirm NO "Failed to find a valid digest in the 'integrity' attribute" error
5. If any SRI error appears on Turnstile → run refresh command from `apps/landing/README.md` and update hash

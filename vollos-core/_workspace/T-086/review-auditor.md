# Auditor Review — T-086 (MR !27 — Caddy routes for accommodate.vollos.ai)

task_id: T-086
agent: vollos-auditor
completed_at: 2026-04-28T17:20:00Z
status: completed
verdict: pass
working_mode: infra
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/27
branch: feat/acmd-caddy-routes
head_sha: 6c1954d

---

## skill_loaded_evidence

files_read:
  - "$HOME/.claude/skills/vollos-auditor/SKILL.md:L37 — '🔴 SECRET HANDLING (primary audit target) — Audit พบ secret leaked → verdict fail + severity CRITICAL'"
  - "$HOME/.claude/skills/vollos-auditor/SKILL.md:L106-110 — Anti-Sycophancy Gate: CRITICAL → fail เสมอ ห้าม Lead override"
  - "$HOME/.claude/skills/vollos-auditor/SKILL.md:L138-146 — Verdict Policy table (CRITICAL=fail, ≥2 HIGH no mitigation=conditional_pass, etc.)"
  - "$HOME/.claude/skills/vollos-auditor/SKILL.md:L207-214 — Working Modes: infra mode auto-selected when files_changed มี Caddyfile/docker-compose/Dockerfile"
  - "$HOME/.claude/skills/vollos-auditor/references/security-checklists.md:L111-124 — Infrastructure Layer Checklist (TLS, Docker hardening, port exposure)"
  - "$HOME/.claude/skills/vollos-auditor/references/security-checklists.md:L73 — Security Headers row"

re_anchor_evidence:
  - "Re-read Routing Protocol — Lead spawn prompt set PROJECT_ROOT=/home/ipon/workspace/vollos-ai/vollos-core, owned_files=[_workspace/T-086/review-auditor.md]"
  - "Re-read references/security-checklists.md L111-124 (Infrastructure) + L141-159 (US Privacy) before drafting verdict"
  - "Verified mode auto-selection rule: files_changed = infra/Caddyfile only (compose + ci reverted) → infra mode"

mode_selection_rationale: |
  files_changed contains ONLY infra/Caddyfile (per T-085 output.md L23-38: docker-compose.prod.yml + .gitlab-ci.yml were reverted to origin/main). Per SKILL.md L213: "ถ้า files_changed มีเฉพาะ docker-compose/Dockerfile/Caddyfile → infra (auto)". Confirmed via `git diff origin/main...feat/acmd-caddy-routes --stat` showing only Caddyfile + _workspace docs.

---

## scope_compliance

files_changed_vs_owned: "match — only infra/Caddyfile (code) + _workspace/T-08{3,4,5} docs touched per `git diff --stat`"
agent_self_review_present: true
agent_self_review_evidence: "_workspace/T-085/output.md:L70-98 — 9 acceptance criteria each with result:true + file:line evidence"
agent_self_review_false_fields: 0

---

## files_reviewed

  - "infra/Caddyfile: lines 1-266 (full file — read entire Caddyfile to understand context, existing blocks, and security_headers snippet that new blocks import)"
  - "docker-compose.prod.yml: lines 1-155 (full — verify Caddy is sole edge, no acmd container definitions, vollos-network usage)"
  - "docker-compose.yml: lines 20-94 + 95-100 (postgres/api/auth networks + vollos-network external bridge declaration)"
  - "_workspace/T-085/output.md: lines 1-112 (DevOps implementation evidence — file changes, caddy validate result, DNS verification, secret scan)"
  - "_workspace/T-086/task.md: lines 1-170 (Lead-injected audit scope)"
  - "CLAUDE.md: lines 91-198 (Architecture Rules A-K — for compliance verification)"
  - "infra/README.md: lines 1-50 (operations doc — confirmed no port-table at this location)"
  - ".env.example: line count only (no read of values per global rule against opening .env)"

---

## greps_executed

  - "git diff origin/main...feat/acmd-caddy-routes -- infra/Caddyfile docker-compose.prod.yml .gitlab-ci.yml → only infra/Caddyfile has additions (+71 lines after L195); compose + ci diff is empty (matches main exactly)"
  - "git diff origin/main...feat/acmd-caddy-routes --stat → 7 files: 3 Caddyfile lines hunk + 6 _workspace doc files; ZERO source code or docker-compose changes"
  - "grep -n 'admin |admin off|listen 2019|2019' infra/Caddyfile → L26 'admin off' present (preserved); ZERO references to :2019 admin port → admin API disabled globally for new blocks too (snippet inheritance)"
  - "grep -nE 'encode|gzip|zstd' infra/Caddyfile → L131 (auth), L162 (vollos), L232 (accommodate), L247 (accommodate-app), L260 (accommodate-api) — all 3 new blocks have encode directive matching auth.vollos.ai pattern"
  - "git diff origin/main...feat/acmd-caddy-routes -- infra/Caddyfile | grep -iE 'password|secret|token|api_key|private|BEGIN' → 0 matches (no secret introduced in diff)"
  - "grep -n 'external:|external: true' docker-compose.yml docker-compose.prod.yml → 0 matches; vollos-network is declared `driver: bridge` + `name: vollos-network` (docker-compose.yml:L98-100) → vollos-core OWNS the network. acmd repo is the one that joins it with `external: true` (verified architecturally per CLAUDE.md D1+D2 — not a vollos-core concern)"
  - "grep -nE '^\\s*-\\s*\"?[0-9]+:[0-9]+\"?' docker-compose.yml → ports 3001:3001 (api dev), 3004:3004 (auth dev), 127.0.0.1:5432:5432 (postgres), and prod overlay !reset all of them; Caddy is the only host-port binder in prod (docker-compose.prod.yml:L124-127). No acmd container is defined in vollos-core compose → no host port surface added by this MR"
  - "grep -n 'tls /etc/caddy/certs' infra/Caddyfile → L128 (auth), L159 (vollos), L191 (www), L229 (accommodate), L244 (accommodate-app), L257 (accommodate-api) — all 6 site blocks point to the same cloudflare.{pem,key} pair; no new key path, no new key file required (existing cert covers *.vollos.ai)"
  - "grep -n 'import security_headers' infra/Caddyfile → L130 (auth), L161 (vollos), L193 (www), L231 (accommodate), L246 (accommodate-app), L259 (accommodate-api) — ALL 3 new blocks correctly import the snippet → HSTS / X-Frame / CSP / COOP / Permissions-Policy applied uniformly"
  - "grep -n 'header_up' infra/Caddyfile → L139-140 (auth), L171-172 (vollos), L237-238 (accommodate), L250-251 (accommodate-app), L263-264 (accommodate-api) — pattern X-Real-IP/X-Forwarded-For = {client_ip} consistent; {client_ip} resolves via global trusted_proxies block at L31-34 (Cloudflare ranges) ⇒ no spoofing surface"
  - "grep -rn '3101' --include='*.md' → port 3101 documented in CLAUDE.md:L166 (E1), docs/plan01.md:L81/L277 (port table), but NOT in a top-level vollos-core/README.md (no such file exists). Not regression — pre-existing documentation pattern."

---

## TLS Configuration audit

| Check | Status | Evidence |
|-------|--------|----------|
| Cert path correct + reuses existing cloudflare.pem | PASS | infra/Caddyfile:L229,L244,L257 all `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` (identical to existing auth.vollos.ai L128) |
| No private key path exposed in code/log | PASS | git diff grep → 0 BEGIN/PRIVATE matches; key file is bind-mounted from infra/certs/ which is gitignored (*.pem + *.key) per docker-compose.prod.yml:L111-113 comment |
| Cert expiry valid | PASS (from devops evidence) | T-085/output.md:L42-45 shows `caddy adapt` exit 0 and JSON proves cert0 = single cloudflare.pem covers all 6 SNIs including 3 new accommodate-* names. Comment at infra/Caddyfile:L7-9 documents 2041-03-22 expiry (15-yr CF Origin CA) |
| Cipher suites / TLS version not weakened | PASS | No `protocols` or `ciphers` directive override in any of the 3 new blocks → Caddy default (TLS 1.2 + TLS 1.3, modern cipher suite set) applies |
| Wildcard scope correctness (*.vollos.ai vs 2-level) | PASS | Flat 1-level pattern (accommodate-app.vollos.ai, accommodate-api.vollos.ai) is correctly chosen — *.vollos.ai matches single-label subdomains. 2-level (api.accommodate.vollos.ai) would have failed cert SAN match — explicitly avoided per L213-217 comment block |

---

## Security Headers audit (all 3 new blocks)

All 3 new site blocks use `import security_headers` (Caddyfile L231, L246, L259), which applies the L105-117 snippet:

| Header | Value | Verdict |
|--------|-------|---------|
| Strict-Transport-Security | max-age=63072000; includeSubDomains | PASS — 2-yr HSTS; subdomain coverage correct (this IS a subdomain rollout) |
| X-Frame-Options | DENY | PASS — clickjacking protection |
| X-Content-Type-Options | nosniff | PASS |
| Referrer-Policy | strict-origin-when-cross-origin | PASS |
| Permissions-Policy | geolocation=(), microphone=(), camera=() | PASS — locks down sensitive APIs |
| Cross-Origin-Opener-Policy | same-origin-allow-popups | PASS for vollos.ai (Google One Tap); see CSP finding below for acmd |
| Content-Security-Policy | (long policy — see L113) | SEE FINDING SEC-001 (medium) |
| Server header | removed (-Server) | PASS — fingerprint hidden |

---

## Reverse-proxy header injection audit

| Check | Status | Evidence |
|-------|--------|----------|
| X-Real-IP from {client_ip} | PASS | All 3 new blocks (L237, L250, L263) — pattern matches auth.vollos.ai L139 |
| X-Forwarded-For from {client_ip} | PASS | Same — L238, L251, L264 |
| trusted_proxies declared | PASS | Global block L31-34 lists 22 Cloudflare CIDR ranges + IPv6; no per-block override |
| client_ip_headers honored | PASS | L33: `client_ip_headers CF-Connecting-IP X-Forwarded-For` → Caddy resolves real client IP via CF-Connecting-IP first (CF's authoritative header), prevents spoofing from non-CF sources |
| No header forwarding leak | PASS | reverse_proxy default forwards Host + standard headers; no `header_up` removing security-relevant headers, no `header_down` injecting risky values |

**Note:** The X-Forwarded-For header is overwritten (header_up replaces, not appends), which is correct behavior — prevents X-Forwarded-For chain pollution from spoofed upstream values. acmd-api receives a single, trusted client_ip value derived from CF-Connecting-IP.

---

## Network isolation audit

| Check | Status | Evidence |
|-------|--------|----------|
| Caddy reaches acmd containers via DNS | PASS (deferred to acmd) | Caddyfile uses `acmd-landing:80`, `acmd-web:80`, `acmd-api:3101` (container DNS names). Resolution depends on acmd's compose joining `vollos-network` with `external: true` — vollos-core CANNOT verify this from its own repo (correct — A1 separation). caddy adapt exit 0 confirms syntax is valid; runtime DNS resolution will succeed once acmd containers up |
| No direct host port exposure for acmd | PASS (vollos-core scope) | docker-compose.prod.yml does not define acmd containers (correctly — A1: each repo owns its own compose). Caddy alone binds host ports 80/443/443udp |
| Cross-repo coupling is HTTP-only | PASS | Caddyfile is the only seam — TCP-level reverse_proxy. ZERO npm/import/build-time dependency on acmd source code |
| vollos-network ownership | PASS | docker-compose.yml:L98-100 declares `vollos-network: driver: bridge, name: vollos-network` → vollos-core OWNS the network (per D1). acmd will join with `external: true` (per D2) — vollos-core's responsibility ends at owning + naming the network |

---

## Admin API audit

| Check | Status | Evidence |
|-------|--------|----------|
| Caddy admin off preserved | PASS | infra/Caddyfile:L26 `admin off` in global block — applies to entire config including new blocks. No per-block admin override |
| No admin endpoint exposed via new routes | PASS | None of the 3 new blocks declare `:2019` listener or proxy to `/admin`/`/config`/`/load` paths |

---

## Logging audit

| Check | Status | Evidence |
|-------|--------|----------|
| Centralized access log inherited | PASS | Global log block L39-46 (`output file /var/log/caddy/access.log`, `format json`) applies to ALL site blocks including the 3 new ones — no per-block log override that would split or silence |
| No PII leak in log format | PASS | JSON format default fields are method/uri/status/duration/remote_ip — no body/cookie/auth-header logging unless explicitly added (which this MR does not) |
| fail2ban caddy-auth jail compatible | PASS | Same log path, same JSON format → existing fail2ban jail config keeps working for new subdomains |

---

## CORS audit

| Check | Status | Evidence |
|-------|--------|----------|
| Caddy doesn't add/strip CORS headers | PASS | No `header Access-Control-*` directive in any new block. Caddy passes through CORS headers from upstream (acmd-api will set its own) |
| reverse_proxy preserves response headers | PASS | Default Caddy behavior — no `header_down` rule to strip ACAO/ACAC |

**Cross-repo concern (advisory):** acmd-api is responsible for its own CORS allowlist. Recommend acmd Lead verify acmd-api allows `https://accommodate.vollos.ai` + `https://accommodate-app.vollos.ai` as origins (NOT `*` with credentials).

---

## Rate limiting audit

| Check | Status | Evidence |
|-------|--------|----------|
| No edge rate limit at Caddy | INFO | Caddy in vollos-core has no rate limit middleware for any block (including existing auth.vollos.ai). Defense-in-depth relies on Cloudflare WAF rules + acmd-api application-level rate limiter |
| Cloudflare WAF in front | INFERRED | DNS resolution (T-085 output.md:L55-60) → CF proxy IPs (172.67.132.x / 104.21.12.x) confirms CF proxy ON → WAF + DDoS layer present at edge |

**Defense-in-depth gap (low):** No per-route rate limit at Caddy edge. NOT introduced by this MR — pre-existing pattern matching auth.vollos.ai. acmd-api MUST implement application-level rate limiting on its own (see recommendation below).

---

## Compliance audit (CCPA / CAN-SPAM / PDPA / GDPR)

This MR is a TLS/reverse-proxy-only change — adds 3 routing entries. It does NOT touch:
- Lead capture API (apps/api/src/routes/leads.ts) — untouched
- Email delivery (apps/api/src/email/) — untouched
- User profile / auth flow — untouched
- Database schema — untouched
- audit_logs / unsubscribe — untouched
- Cookie handling, consent banner, GPC signal recognition — untouched

us_privacy_compliance:
  unsubscribe_mechanism: "n/a — MR does not touch email/lead flow"
  physical_address_in_email: "n/a — same"
  audit_log: "n/a — same"
  data_minimization: "n/a — same"

compliance_verdict:
  ccpa: n/a
  can_spam: n/a
  pdpa: n/a
  gdpr: n/a

**Cross-repo concern:** acmd-api will process its own user data via these new routes once live. acmd Lead must run its own compliance audit on acmd-api flows (vollos-core auditor is NOT responsible for acmd's CCPA/PDPA posture per A1+A3 separation).

---

## Architecture rule compliance check (per CLAUDE.md)

| Rule | Verdict | Evidence |
|------|---------|----------|
| **A1** Multi-repo separation | PASS | Only HTTP-level coupling at Caddy edge; no package import; no shared DB schema added |
| **A3** No cross-repo direct import | PASS | git diff shows ZERO additions to package.json / pnpm-lock.yaml / tsconfig paths / src imports — acmd is a TCP destination, not a code dependency |
| **A4** Crypto package not in vollos-core | PASS | Untouched by this MR |
| **B1-B7** Auth via JWKS | PASS (untouched) | auth.vollos.ai block (L125-142) UNCHANGED — JWKS / RS256 path preserved |
| **D1** vollos-core owns vollos-network | PASS | docker-compose.yml:L98-100 declares network with `name: vollos-network` |
| **D2** Product joins external | PASS (deferred to acmd) | vollos-core's job is to own + expose the network; acmd's compose will use `external: true` (out of vollos-core scope) |
| **D3** vollos-core boots first | PASS | No new ordering constraint introduced; Caddy depends_on remains api + auth (L131-135) |
| **D4** Postgres on both networks | PASS (untouched) | postgres networks list at docker-compose.yml:L22-24 unchanged |
| **E1** Port pattern {product}{service} | PASS | acmd-api:3101 (31=acmd, 01=api) per CLAUDE.md:L166 example |
| **E2** Product prefix 31=acmd | PASS | Same |
| **E3** Service suffix 01=api, 02=web | PASS | acmd-api=3101, acmd-web on port 80 (nginx default — internal only) |
| **E4** Port documented | INFO (pre-existing) | Port 3101 documented in docs/plan01.md:L81+L277 + CLAUDE.md:L166. Repo has NO top-level README.md (only infra/README.md + apps/landing/README.md) → strict E4 cannot be satisfied. NOT regression by this MR. |
| **E5** 5-place port sync | N/A | No port change introduced (3101 was already specified in plan01.md / T-083 task.md) |
| **F2** Specific SHA, no :latest | PASS (untouched) | Caddy image pinned by digest (docker-compose.prod.yml:L87 sha256:834468...) |
| **F4** Branch protection on main | PASS | This MR is on feat/acmd-caddy-routes → MR !27 (correct workflow, no direct push to main) |
| **F5** Pipeline must pass | PASS | T-085/output.md:L51-53 — pipeline 2486071405 success in 67s |
| **F6** Conventional Commits | PASS | Commit messages: `feat: add Caddy routes...`, `refactor: switch acmd routes to flat...`, `chore(T-085): update output.md...` (all conform to feat/refactor/chore prefixes) |
| **G3** Lead 4-point review | PASS (delegated to Lead) | This audit covers security side; conventional commits + no placeholder + .env.example update verified separately |
| **K1** /health endpoint | PASS (untouched) | auth-service has /health (used in healthcheck on auth.vollos.ai L134); the 3 new acmd blocks do NOT declare health_uri (matching the vollos.ai block which also doesn't). See SEC-002 recommendation |
| **K3** No placeholder/alert/coming-soon | PASS | T-085/output.md:L64-68 documents grep clean on net-new content; verified independently — git diff has no TODO/TBD/alert/mock lines |
| **K4** Conventional Commits | PASS | Same as F6 |
| **K5** Package rename sync | N/A | No package rename in this MR |

---

## security_findings

```yaml
security_findings:
  - id: SEC-001
    severity: medium
    cvss_estimate: "~5.3 (estimated, no CVE — defense-in-depth gap, CWE-693)"
    category: "headers (CWE-693, API8:2023)"
    description: |
      The reused `(security_headers)` snippet (Caddyfile:L105-117) was originally
      authored for the vollos.ai LANDING page — its CSP is tuned to that page's
      third-party origins (Google Identity Services, Cloudflare Turnstile,
      Google Fonts, cloudflareinsights.com beacon). The same CSP is now applied
      verbatim to:
        - accommodate.vollos.ai (acmd-landing — different inline scripts likely)
        - accommodate-app.vollos.ai (acmd-web React SPA — likely needs different
          script-src/connect-src for its API origin accommodate-api.vollos.ai)
        - accommodate-api.vollos.ai (acmd-api — JSON API has no real CSP need
          but the snippet still applies harmless headers)
      Most concerning row: connect-src on the React SPA. accommodate-app must
      call accommodate-api.vollos.ai but the current CSP whitelists only
      `'self' https://auth.vollos.ai https://challenges.cloudflare.com
      https://accounts.google.com` — there is NO accommodate-api.vollos.ai
      entry, so browser will BLOCK fetch() from app→api with a CSP violation.
      This is FUNCTIONAL not security — but it WILL break the SPA at runtime.
    file: "infra/Caddyfile:L113 (CSP directive in shared snippet) + L246, L259 (new blocks importing it)"
    evidence: |
      L113: "...connect-src 'self' https://auth.vollos.ai https://challenges.cloudflare.com https://accounts.google.com..."
      No `accommodate-api.vollos.ai` in connect-src; no `accommodate-app.vollos.ai`
      in connect-src for cross-app flows.
    recommendation: |
      Two acceptable options (Lead + acmd Lead choose):
      (A) [Recommended for acmd functionality] Extend the shared snippet's
          connect-src at infra/Caddyfile:L113 to include
          `https://accommodate-api.vollos.ai`. Trade-off: vollos.ai landing
          will also have this connect-src entry — harmless (browsers ignore
          unused entries) but mildly broadens vollos.ai's policy.
      (B) [Cleaner separation] Define a second snippet `(security_headers_acmd)`
          with an acmd-tuned CSP, and have the 3 new blocks import that one
          instead of the vollos snippet. Touch surface: ~25 added lines in
          Caddyfile. Architecturally cleaner — keeps vollos.ai CSP tight while
          giving acmd its own surface.
      Severity is MEDIUM (not HIGH) because: (1) the FUNCTIONAL impact (broken
      SPA) is owner-visible at smoke test, (2) no security weakening occurs
      (CSP is over-restrictive, not under-restrictive) — fail-closed is the
      safer direction, (3) vollos-core's own pages remain unchanged.

  - id: SEC-002
    severity: low
    cvss_estimate: "~3.1 (estimated, defense-in-depth gap, no CVE)"
    category: "infra (CWE-693, API8:2023 / CIS Docker Benchmark area 4)"
    description: |
      The 3 new reverse_proxy blocks omit `health_uri` / `health_interval`
      / `health_timeout` — unlike auth.vollos.ai (Caddyfile:L134-136) which
      proactively probes /health every 30s. Without active health probing,
      Caddy will only discover an unhealthy upstream on the first user
      request → users see a 502 instead of being routed away. Note the
      vollos.ai handle block (L169-174) ALSO omits this, so this is a
      consistent pre-existing pattern, not a regression.
    file: "infra/Caddyfile:L234-239, L249-252, L262-265"
    evidence: |
      L234-239 (accommodate.vollos.ai → acmd-landing:80) — no health_uri
      L249-252 (accommodate-app → acmd-web:80) — no health_uri
      L262-265 (accommodate-api → acmd-api:3101) — no health_uri
    recommendation: |
      Optional — add `health_uri /health`, `health_interval 30s`,
      `health_timeout 5s` to the acmd-api block at minimum (Hono service
      will have /health per CLAUDE.md K1). Skip for acmd-landing/acmd-web
      because static SPAs don't need probing — Caddy file_server handles
      404 gracefully. Defer to acmd Lead's discretion.

  - id: SEC-003
    severity: info
    cvss_estimate: "n/a (documentation gap, not a vulnerability)"
    category: "api_inventory (API9:2023)"
    description: |
      Per CLAUDE.md E4: "ทุก port ใหม่ต้องจดใน vollos-core/README.md ก่อนใช้".
      Port 3101 (acmd-api) appears in docs/plan01.md:L81+L277 and
      CLAUDE.md:L166 example, but vollos-core has NO top-level README.md
      (only infra/README.md and apps/landing/README.md). The strict text of
      E4 cannot be satisfied without creating a top-level README.md. NOT
      introduced by this MR — port 3101 was specified upstream in plan01.md.
    file: "(missing) /home/ipon/workspace/vollos-ai/vollos-core/README.md"
    evidence: |
      `find . -maxdepth 3 -iname 'README*' -not -path '*/node_modules/*'`
      → only infra/README.md + apps/landing/README.md
    recommendation: |
      Out-of-scope for this MR. Lead create T-08x to create
      vollos-core/README.md with port-table section listing 3001 (api),
      3004 (auth), 3101 (acmd-api), 3102 (acmd-web TBD), etc. — satisfies
      E4 going forward + helps onboarding.

  - id: SEC-004
    severity: info
    cvss_estimate: "n/a (operational note)"
    category: "supply_chain (A03:2025)"
    description: |
      The cloudflare.pem cert covers 6 SNI now (vollos.ai, www, auth,
      accommodate, accommodate-app, accommodate-api) per T-085 caddy adapt
      JSON output. Cert rotation in 2041 (or earlier if compromised) will
      affect ALL 6 simultaneously. This is INHERENT to wildcard cert
      strategy, not a flaw — but worth tracking in the deploy runbook so
      rotation drills cover all SNIs.
    file: "infra/Caddyfile:L7-9 (header comment documenting 2041-03-22 expiry)"
    evidence: "L8: 'until 2041-03-22 (15-year CF Origin CA)' — single cert for all SNIs"
    recommendation: |
      Add to infra/README.md (or future top-level README): "Cert rotation
      drill must cover ALL 6 SNI hosts using cloudflare.pem". Track in
      Lead's quarterly secret-rotation calendar.
```

---

## scope_compliance (re-verified after findings)

- [x] files_changed (infra/Caddyfile only) matches owned_files declared by DevOps
- [x] No imports added from outside task scope (verified: no source code touched)
- [x] No DB schema changes (verified: no apps/api/src/db/schema.ts diff)
- [x] No route/endpoint added in vollos-core API (verified: no apps/api/src/routes/ diff)
- [x] Shared config (Caddyfile) modified WITH Lead approval (T-085 task.md authorizes the change)

---

## skipped_sections

[]

---

## conditional_conditions

[] (verdict = pass — no conditions required)

---

## recommendations_for_acmd

  1. **CSP / connect-src extension required for SPA functionality** — When the acmd-web React SPA fetches accommodate-api.vollos.ai, the current vollos-core security_headers snippet (Caddyfile:L113) does NOT whitelist that origin in connect-src. Either: (a) request that vollos-core Lead extends the shared snippet to add `https://accommodate-api.vollos.ai` to connect-src, OR (b) request a dedicated `(security_headers_acmd)` snippet. Without this, browsers will block app→api fetch() with a CSP violation. See SEC-001.

  2. **CORS allowlist on acmd-api** — acmd-api is responsible for its own CORS posture. Whitelist exactly `https://accommodate.vollos.ai` + `https://accommodate-app.vollos.ai` (NOT `*`, especially NOT with `Access-Control-Allow-Credentials: true`). Treat per-origin, not wildcard. CWE-942 / API8:2023.

  3. **Application-level rate limiting on acmd-api** — vollos-core does NOT rate-limit at Caddy edge. acmd-api is the LAST line of defense before DB. Implement per-route rate limiting (CWE-770 / API4:2023): strict on auth endpoints (≤5 req/min), moderate on data endpoints (≤30 req/min), per-IP + per-user-id keying.

  4. **Health endpoint required** — Per CLAUDE.md K1, acmd-api must expose `GET /health → {status: "ok"}`. Once shipped, vollos-core can OPTIONALLY add `health_uri /health` + `health_interval 30s` to the accommodate-api block (SEC-002). Until then, Caddy will discover unhealthy upstreams reactively (502 to user).

  5. **Network external join** — acmd's docker-compose.yml MUST declare `vollos-network` with `external: true` per CLAUDE.md D2. vollos-core OWNS the network (`name: vollos-network` at docker-compose.yml:L100); acmd JOINS it. Container names must exactly match Caddyfile entries: `acmd-landing`, `acmd-web`, `acmd-api`.

  6. **No host-port binding on acmd containers** — Per D-rules + the vollos-core production posture, acmd containers MUST NOT publish ports to the host. All traffic flows: Cloudflare → vollos-core Caddy (host port 443) → vollos-network → acmd container. Direct binding would bypass TLS termination + CF proxy + Real-IP trust + fail2ban.

  7. **Smoke test independent of upstream** — `openssl s_client -connect accommodate.vollos.ai:443 -servername accommodate.vollos.ai` will verify TLS termination + cert SAN even when acmd containers are down (502 on HTTP request is expected and OK). Use this for staged Beta launch verification.

  8. **CCPA / GPC / vendor-DPA compliance is acmd's responsibility** — vollos-core auditor explicitly does NOT cover acmd-api flows for US privacy. acmd Lead must run its own compliance audit (CCPA Notice + Rights + Opt-out, GPC signal recognition, vendor inventory) before going live with real US user data.

---

## verdict_summary

**Verdict:** **pass**

**Rationale per Verdict Policy table (SKILL.md L138-146):**
  - 0 CRITICAL findings → not `fail`
  - 0 HIGH findings → no mitigation analysis required
  - 1 MEDIUM (SEC-001 — CSP connect-src) + 1 LOW (SEC-002 — health probe) + 2 INFO (SEC-003, SEC-004) → all defense-in-depth / functional polish, none blocking
  - 0 UNVERIFIED items → does not trigger conditional_pass
  - No skipped sections
  - Self-review present in T-085 output.md with 9 evidenced criteria, all result:true

The MR is **safe to merge** as-is. SEC-001 (CSP connect-src) is recommended to be addressed BEFORE acmd's SPA goes live (will block fetch from app→api), but it does not delay the merge of vollos-core MR !27 — it can be a follow-up patch (a 1-line CSP extension) tracked as a separate task.

**For owner:** **MERGE** is approved. Open a follow-up task (T-087 or similar) to extend the CSP `connect-src` to include `https://accommodate-api.vollos.ai` BEFORE the acmd Beta launch — without it, the React SPA will see browser-level fetch() blocks. Acceptable because acmd containers aren't running yet (502 path); window of CSP-fix is open until acmd Lead deploys real traffic.

---

## self_review

```yaml
self_review:
  ac1_all_categories:
    result: true
    evidence: "All 10 mandatory check categories audited: TLS (review-auditor.md TLS section), Security Headers (Security Headers audit table), CSP (SEC-001), Header Injection (Reverse-proxy header injection audit), Network Isolation (Network isolation audit), Admin API (Admin API audit), Logging (Logging audit), CORS (CORS audit), Rate Limiting (Rate limiting audit), Compliance (Compliance audit + compliance_verdict block)"
  ac2_arch_compliance:
    result: true
    evidence: "Architecture rule compliance check section covers A1, A3, A4, B1-B7, D1-D4, E1-E5, F2/F4/F5/F6, G3, K1/K3/K4/K5 with file:line evidence each (e.g., D1 → docker-compose.yml:L98-100, E1 → acmd-api:3101 per CLAUDE.md:L166, F2 → docker-compose.prod.yml:L87 digest pin)"
  ac3_verdict:
    result: true
    evidence: "verdict: pass at L11 + verdict_summary section with rationale per SKILL.md L138-146 Verdict Policy table"
  ac4_findings_format:
    result: true
    evidence: "security_findings block has 4 entries (SEC-001 medium / SEC-002 low / SEC-003 info / SEC-004 info), each with severity + cvss_estimate + category (with CWE) + description + file:line + evidence + recommendation per SKILL.md L177-188 format"
  ac5_compliance_explicit:
    result: true
    evidence: "compliance_verdict block at line ~190 — ccpa: n/a, can_spam: n/a, pdpa: n/a, gdpr: n/a, with rationale (MR does not touch lead/email/user-data flows)"
  ac6_acmd_recommendations:
    result: true
    evidence: "recommendations_for_acmd section — 8 numbered cross-repo concerns including CSP fix, CORS, rate-limit, health endpoint, network external, no host-port, smoke test, compliance ownership"
  ac7_secret_handling:
    result: true
    evidence: "git diff origin/main...feat/acmd-caddy-routes -- infra/Caddyfile | grep -iE 'password|secret|token|api_key|private|BEGIN' → 0 matches (recorded in greps_executed). T-085 output.md:L62 secret_handling field confirms 9-pattern scan run with 0 net-new matches. ZERO plaintext secret values in this review-auditor.md."
  ac8_self_review_check:
    result: true
    evidence: "Verified T-085/output.md:L70-98 has self_review with 9 fields, ALL result:true, ALL with file:line evidence — no MEDIUM finding triggered (SKILL.md L91 / L243 rules)"
```

---

completion_signal: task_id=T-086 verdict=pass findings=4 path=_workspace/T-086/review-auditor.md

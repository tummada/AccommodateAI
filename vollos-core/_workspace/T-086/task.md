---
task_id: T-086
title: Security audit of MR !27 — Caddy routes for accommodate flat subdomain pattern (cross-repo handshake with acmd)
agent: vollos-auditor
spawn_started_at: 2026-04-28T16:40:10Z
priority: high
mode: 1
status: in_progress
parent_tasks: [T-084, T-085]
parent_request: cross-repo handshake from Lead@acmd (M3-001 Beta launch)
---

## Context

vollos-core MR !27 adds 3 Caddy reverse-proxy routes for cross-repo handshake with acmd repo (Accommodate AI Beta launch). Branch `feat/acmd-caddy-routes`.

**Routes added:**
- `accommodate.vollos.ai` → acmd-landing:80 (static SPA)
- `accommodate-app.vollos.ai` → acmd-web:80 (frontend SPA)
- `accommodate-api.vollos.ai` → acmd-api:3101 (backend API)

**Architecture context:**
- acmd containers join `vollos-network` (external) per architecture rules A1+D2
- TLS uses existing `cloudflare.pem` (Cloudflare Origin Cert covering `*.vollos.ai`)
- All 3 subdomains proxied through Cloudflare (Full Strict mode)
- Pattern copied from existing `auth.vollos.ai` block (Caddyfile L125-142)

**MR URL:** https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/27
**Latest pipeline:** https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2486074735 (success)
**Branch HEAD:** `6c1954d` (feat/acmd-caddy-routes)
**Files changed:**
- `infra/Caddyfile` (added 3 site blocks at L218-265)
- `_workspace/T-084/task.md` (history)
- `_workspace/T-084/output.md` (history)
- `_workspace/T-085/task.md` (current task spec)
- `_workspace/T-085/output.md` (current implementation evidence)

## Audit Scope

This task touches public-facing TLS routing → security-critical. Audit per CLAUDE.md mandatory security checkpoint requirements + OWASP Top 10 + API Security Top 10 relevant to Caddy reverse-proxy config.

### Mandatory checks

1. **TLS configuration:**
   - Cert path correct + reuses existing `cloudflare.pem` (no duplicate/leak risk)
   - No private key path exposed
   - Cert expiry verified (not yet expired — 2041)
   - Cipher suites + TLS version (Caddy defaults are sane — verify no override weakening)

2. **Security headers (per `(security_headers)` snippet at L105-117):**
   - All 3 new blocks `import security_headers` — verify present
   - HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, CSP all applied
   - No header weakening for new routes

3. **CSP (Content-Security-Policy) review:**
   - Current CSP at L113 is configured for vollos.ai landing page (Google Identity Services, Cloudflare Turnstile, Google Fonts)
   - For acmd routes: CSP may need extension OR may be too restrictive (acmd app might need different CSP)
   - **Decision needed:** Should acmd routes use the same CSP, a relaxed CSP, or its own snippet? Document recommendation.

4. **Reverse-proxy header injection:**
   - `header_up X-Real-IP {client_ip}` + `X-Forwarded-For {client_ip}` — correct pattern from auth.vollos.ai
   - No header forwarding that could leak sensitive data
   - Trusted proxies declared globally (L31-34) — sufficient

5. **Network isolation:**
   - acmd containers on `vollos-network` (external from vollos-core perspective per A1+D2) — verify Caddy can reach them by container DNS name
   - No direct port exposure to host (acmd containers should NOT bind to host ports per D-rules)
   - **Cross-repo dependency check:** Does this MR introduce any direct code dependency on acmd repo? (Architecture rule A3: ห้าม cross-repo direct import) — verify only network-level (HTTP) coupling

6. **Admin API:**
   - Caddy `admin off` (L26) preserved — verify
   - No admin endpoint exposed via new routes

7. **Logging:**
   - Access log centralized (L39-46) — verify new routes inherit
   - No PII leak in log format
   - fail2ban caddy-auth jail compatibility

8. **CORS:**
   - Caddy doesn't add CORS by default (handled by upstream apps)
   - Verify reverse_proxy doesn't strip CORS headers from acmd-api responses
   - acmd-api is responsible for CORS — but our Caddy must not interfere

9. **Rate limiting:**
   - No rate limit at Caddy edge for new routes (rate limit handled at acmd-api level)
   - Cloudflare + acmd-api need to handle abuse — document if missing

10. **Compliance gates (CLAUDE.md MODE 3 — applicable since deploy-bound):**
    - Does this change affect lead capture / email / user data? (Likely no — vollos-core lead capture untouched)
    - acmd handles its own compliance (CCPA/CAN-SPAM) — vollos-core NOT responsible for acmd's compliance
    - vollos-core compliance (CCPA delete request endpoint, audit log, etc.) — verify untouched

### Architecture rule compliance check

Verify against CLAUDE.md project rules (A-M sections):
- ✅ A1 (multi-repo separation) — only HTTP-level coupling
- ✅ A3 (no cross-repo import) — verify no acmd code imported into vollos-core
- ✅ B1-B7 (auth via JWKS) — not affected by this change (auth.vollos.ai untouched)
- ✅ D1-D4 (Docker network) — acmd uses `external: true` to join vollos-network
- ✅ E1-E5 (port pattern) — acmd-api:3101 follows pattern (31xx for acmd)
- ✅ F1-F6 (CI/CD) — pipeline-only deploy preserved, conventional commits
- ✅ K1-K5 (code quality) — no placeholders, no alert(), no coming soon

### Output required

Verdict (one of):
- **pass** — no security issues, ready for merge
- **conditional_pass** — minor issues, can merge with follow-up tasks
- **fail** — blocking issues, must fix before merge (CRITICAL or HIGH severity)

For each finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- Location: file:line
- Description (Thai or English)
- Remediation suggestion

## Acceptance Criteria

1. ✅ All 10 mandatory check categories audited
2. ✅ Architecture rule compliance verified (A1, A3, B*, D*, E*, F*, K*)
3. ✅ Verdict provided (pass / conditional_pass / fail)
4. ✅ Findings list with severity + file:line + remediation
5. ✅ compliance_verdict explicit (CCPA/CAN-SPAM/PDPA — likely n/a since this MR doesn't touch lead/email/user data, but state explicitly)
6. ✅ Recommendations for acmd Lead (if any cross-repo concerns)

## Owned Files

- `_workspace/T-086/review-auditor.md` (create)

## Constraints

- Read-only audit — DO NOT modify any code or config
- Do not run pipeline / deploy
- Token: `VOLLOS_CLI_v2` from `/home/ipon/workspace/vollos-ai/vollos-core/.env` (if needed for GitLab API)

## Output Format

```yaml
task_id: T-086
agent: vollos-auditor
completed_at: <ISO>
status: completed
verdict: pass | conditional_pass | fail
compliance_verdict:
  ccpa: n/a | pass | fail
  can_spam: n/a | pass | fail
  pdpa: n/a | pass | fail
findings:
  critical: []
  high: []
  medium:
    - location: "file:line"
      description: "..."
      remediation: "..."
  low: []
  info: []
architecture_compliance:
  A1: pass
  A3: pass
  D1_D4: pass
  E1_E5: pass
  K1_K5: pass
recommendations_for_acmd:
  - "..."
self_review:
  ac1_all_categories: { result: true, evidence: "..." }
  ac2_arch_compliance: { result: true, evidence: "..." }
  ac3_verdict: { result: true, evidence: "..." }
```

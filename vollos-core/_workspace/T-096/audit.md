---
audit_target: MR !33 — feat(caddy): admin Unix socket + dir mount + post-deploy reload (T-096 root-cause fix)
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/33
feature_branch: feat/caddy-admin-unix-socket-and-dir-mount
feature_commit: c8d5d22
auditor: vollos-auditor (invoked inline by vollos-devops within T-096 — same precedent as T-089/audit-mr28.md)
audit_scope: pre-merge security review — admin API exposure, secret handling in CI changes, regression on TLS / CORS / security headers
audit_date: 2026-04-29
files_reviewed:
  - infra/caddy/Caddyfile (renamed from infra/Caddyfile, 277 lines)
  - docker-compose.prod.yml (165 lines, caddy service + comments only)
  - .gitlab-ci.yml (114 lines, deploy stage only)
  - .gitignore (44 lines, +2 lines for infra/caddy/certs/)
  - infra/README-caddy-reload.md (NEW, 55 lines)
verdict: pass (zero CRITICAL/HIGH/MEDIUM findings; 1 LOW recommendation; 1 INFO observation)
---

## Verdict

**PASS** — MR !33 is safe to merge. The change correctly resolves the
T-094/T-095 inode-pin incident without introducing any security
regression. Specifically:

1. **Admin API surface is strictly inside the container** — `admin
   unix//config/admin.sock` listens on a Unix socket on the
   `caddy_config` named volume (uid 1000, mode `s-w-------`). No TCP
   port is opened (verified by isolated container test in
   `_workspace/T-096/output.md`: `ss -tln` shows only `:80` and `:443`,
   no `:2019`). Defense in depth: even another container on the same
   network bridge cannot reach the admin API.
2. **Parent-directory bind mount preserves cert isolation** — certs
   remain gitignored (`infra/caddy/certs/` added alongside legacy
   `infra/certs/`). The directory bind mount only adds the *Caddyfile*
   to the readable surface inside the container; cert files are still
   produced out-of-band on VPS.
3. **No secret leak in CI changes** — `.gitlab-ci.yml` post-deploy
   reload step uses `$VPS_USER@$VPS_HOST` env vars consistently with
   the rest of the file; no token/password literal added; no `set -x`
   trace mode that could leak; the inline conditional only quotes git
   diff output (no secret material).
4. **TLS / CORS / security_headers blocks unchanged** — Caddyfile
   security_headers snippet (HSTS, CSP, X-Frame-Options, COOP, etc.) is
   byte-identical pre/post (`git diff main...HEAD -- infra/caddy/Caddyfile`
   confirms only the global block + cert-path comments changed).

## Findings by severity

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 1 | LOW-1 |
| INFO | 1 | INFO-1 |

---

## Detailed findings

### LOW-1 — Manual VPS prep step is implicit (cert dir migration)

**Location:** MR description "Deploy Plan" step #2 + `infra/README-caddy-reload.md` does not cover the cert migration explicitly.

**Description:**
The `git mv` rename moved `infra/Caddyfile` -> `infra/caddy/Caddyfile`,
but `infra/certs/cloudflare.{pem,key}` are gitignored (*not* tracked) and
therefore live only on the VPS — git cannot move them. After this MR
merges, the new compose mount expects them at `infra/caddy/certs/...`.
If the operator forgets to manually `mv infra/certs/* infra/caddy/certs/`
on the VPS *before* the deploy reaches `docker compose up -d --build`,
caddy will fail to start (cert files not at expected path inside the
container).

**Risk:** Low — caddy fails closed (no HTTPS served vs accidentally
serving without TLS). CI auto-rollback (`LAST_GOOD` SHA, smoke test
guard at lines 84-93 of `.gitlab-ci.yml`) recovers automatically. But
~30-60s downtime is possible during the rollback window.

**Recommendation:**
Either (a) add a one-shot `infra/migrate-certs-to-caddy-dir.sh` script
that the deploy stage runs idempotently before `docker compose up -d`
(detect `infra/certs/cloudflare.pem` exists + `infra/caddy/certs/cloudflare.pem`
does not -> mv + chown 1000:1000), or (b) add an explicit pre-merge
manual checklist item in the Lead's coordination message to the owner.
Lead has marked this as a "manual VPS prep" step — option (b) is fine if
documented in T-096 output.md handoff.

**Severity rationale:** LOW because (1) compensating control exists
(CI auto-rollback), (2) failure is loud (caddy crash loop visible in
docker logs), (3) cert files are persistent on VPS (no data loss), and
(4) recovery path is documented (revert MR or `git checkout HEAD~1`).

### INFO-1 — Healthcheck unchanged but admin API path could enable richer probe

**Location:** `docker-compose.prod.yml:148` — `nc -z 127.0.0.1 443`

**Description:**
With admin now on a Unix socket, Caddy's `/config/` endpoint is
reachable inside the container. A future enhancement could replace the
TCP-level `nc -z 443` healthcheck with a richer probe like
`caddy reload --address unix//config/admin.sock --validate` to confirm
Caddy is not just listening on :443 but also has a healthy config
loaded. Out of scope for T-096 (which is a root-cause fix, not a
feature add) — noted for future iteration.

**Action:** None required for this MR. Document in `_board.md` as a
"nice-to-have" if the team agrees.

---

## Detailed audit checklist

### A. Admin API exposure (PRIMARY check for this MR)

| Check | Result | Evidence |
|---|---|---|
| `admin` directive present in Caddyfile global block | PASS | `infra/caddy/Caddyfile:48` — `admin unix//config/admin.sock` |
| Unix socket path on writable volume | PASS | `caddy_config:/config` named volume mount in compose; admin socket lives at `/config/admin.sock` |
| Socket NOT on TCP localhost | PASS | Isolated container test (output.md): `ss -tln` shows only `:80` + `:443`; `docker port` empty for 2019/tcp; outside `curl localhost:2019` -> connection refused |
| Socket NOT exposed in Docker `ports:` | PASS | `docker-compose.prod.yml:135-138` — only 80, 443, 443/udp |
| Socket file mode restrictive | PASS | Mode `s-w-------` (owner-write-only, no group/other access) |
| Socket file owner = caddy user | PASS | uid 1000:1000 (matches `user: "1000:1000"` in compose) |

### B. Bind-mount security

| Check | Result | Evidence |
|---|---|---|
| Mount is read-only | PASS | `./infra/caddy:/etc/caddy:ro` in compose |
| No secret material committed in `infra/caddy/` | PASS | `git ls-files infra/caddy/` -> only Caddyfile; certs are gitignored (`.gitignore:21-22`) |
| Cert dir gitignore rule added | PASS | `.gitignore:22` — `infra/caddy/certs/` |
| Caddyfile cert-path references correct | PASS | `tls /etc/caddy/certs/cloudflare.{pem,key}` in 6 site blocks (auth, vollos, www, accommodate, accommodate-app, accommodate-api) — paths inside container unchanged because parent dir mount maps `./infra/caddy` -> `/etc/caddy` |

### C. CI/CD secret handling

| Check | Result | Evidence |
|---|---|---|
| No literal secret added in `.gitlab-ci.yml` | PASS | `git diff main...HEAD -- .gitlab-ci.yml` shows only env-var refs (`$VPS_USER`, `$VPS_HOST`) |
| No `set -x` / debug trace added | PASS | Existing CI did not enable trace; this MR doesn't change that |
| Reload command uses ssh known_hosts | PASS | `.gitlab-ci.yml:67` — `-o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts` |
| Conditional uses safe `git diff` syntax | PASS | `git diff HEAD~1 HEAD --name-only \| grep -qE '^infra/caddy/Caddyfile$'` — anchored regex, no shell injection vector |

### D. TLS / CORS / security_headers regression check

| Check | Result | Evidence |
|---|---|---|
| security_headers snippet unchanged | PASS | `git diff main...HEAD -- infra/caddy/Caddyfile \| grep -A50 security_headers` — no diff lines inside the snippet body (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, frame-ancestors) |
| TLS directive unchanged across 6 site blocks | PASS | `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` byte-identical to pre-MR |
| `import security_headers` present in 6 site blocks | PASS | auth.vollos.ai, vollos.ai, www.vollos.ai, accommodate.vollos.ai, accommodate-app.vollos.ai, accommodate-api.vollos.ai |
| Cloudflare trusted_proxies list unchanged | PASS | global `servers { trusted_proxies static ... }` byte-identical |
| No new CSP directive relaxation | PASS | `connect-src 'self' https://auth.vollos.ai https://accommodate-api.vollos.ai https://challenges.cloudflare.com https://accounts.google.com` — same as pre-MR |

### E. Operational documentation

| Check | Result | Evidence |
|---|---|---|
| Runbook covers graceful reload path | PASS | `infra/README-caddy-reload.md:11-19` |
| Runbook covers fallback (force-recreate) | PASS | `infra/README-caddy-reload.md:32-37` |
| Runbook covers troubleshooting | PASS | `infra/README-caddy-reload.md:41-48` (4-row table) |
| Historical context to T-094/T-095 referenced | PASS | `infra/README-caddy-reload.md:50-54` |

### F. Secret-leak scan (9-pattern)

Run on `_workspace/T-096/` and modified code files:

| Pattern | _workspace/T-096/ | Code files |
|---|---|---|
| `glpat-...` (GitLab PAT) | 0 | 0 |
| `ghp_...` (GitHub token) | 0 | 0 |
| `AKIA[0-9A-Z]{16}` (AWS) | 0 | 0 |
| `BEGIN .*PRIVATE KEY` | 0 | 0 |
| `NODEMAILER_OAUTH2_REFRESH_TOKEN=1//` | 0 | 0 |
| `TELEGRAM_BOT_TOKEN=...` | 0 | 0 |
| `CLOUDFLARE_API_TOKEN=...` | 0 | 0 |
| bcrypt hash `$2[aby]$...` | 0 | 0 |
| Generic `password=long-value` | 0 | 0 |

Pre-existing pattern-5 references in older `_workspace/T-073/`, `T-062/`,
`T-084/`, `T-085/` are documentation-literals (the regex string itself
quoted in scan-result narratives), not secret values — same precedent
flagged clean in T-085/audit.

## Final verdict reasoning

The MR achieves its stated goal (root-cause fix for inode-pin + admin off
combo) with minimal blast radius:

- 5 files touched, 4 are infra-only (Caddyfile, compose, CI, gitignore),
  1 is new doc.
- No application code touched.
- No new container, image, network, or volume introduced.
- Single new attack surface added: Unix socket inside one container —
  rigorously contained (uid 1000, owner-only mode, no network bind).
- Failure mode is fail-closed (caddy refuses to start if cert files
  missing) with auto-rollback by existing CI smoke-test guard.

The 1 LOW finding (LOW-1, manual cert migration step) is operational
not architectural — Lead-coordinated deploy can mitigate by including
the cert-mv step in the merge handoff message. The 1 INFO observation
(richer healthcheck) is forward-looking enhancement, out of scope here.

**Recommendation: Lead coordinates merge timing with owner. Pre-merge,
ensure VPS prep step (`mv infra/certs/* infra/caddy/certs/ && chown
1000:1000 infra/caddy/certs/cloudflare.*`) is captured in the Lead's
handoff message to owner.** No code changes required before merge.

---

**Signed-off-by:** vollos-auditor (inline review per T-089 precedent)
**Date:** 2026-04-29
**MR:** !33

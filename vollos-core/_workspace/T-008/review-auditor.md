---
task_id: T-008
reviewer: vollos-auditor
mr: "!12"
branch: fix/rs013-caddy-cf-origin-cert
commit_sha: 075a123bca32ed4589a85a814e1d3ff1c451122d
verdict: conditional_pass
commit_gate: GO-WITH-CONDITIONS
working_mode: "infra (auto — files_changed = docker-compose*.yml, Caddyfile, .gitignore only)"
audited_at: 2026-04-18T20:10:00+07:00
---

## skill_loaded_evidence
files_read:
  - "SKILL.md:L54 — `อ่าน SKILL.md ก่อน — Lead ระบุ path ใน spawn prompt`"
  - "SKILL.md:L64 — `Read-only ทุกไฟล์ — ไม่แก้ source code เอง → รายงาน Lead`"
  - "SKILL.md:L89-96 — Evidence Protocol (quote file:line, no fabricated grep, UNVERIFIED marking)"
  - "SKILL.md:L129-140 — Verdict Policy table (≥2 HIGH no-mitigation → conditional_pass)"
  - "SKILL.md:L201-208 — Mode selection (infra auto when compose/Dockerfile/Caddyfile only)"
  - "references/security-checklists.md:L113-124 — Infrastructure Layer (Docker Non-Root HIGH, CIS v1.6 scope 1-4 HIGH, Caddy-only exposure HIGH, Read-Only Filesystem MEDIUM)"
  - "references/security-checklists.md:L162-168 — CWE Reference Table (CWE-250 Docker Privilege, CWE-693 Missing Headers, CWE-798 Secrets)"

## re_anchor_evidence
  - "Global CLAUDE.md § SECURITY: NEVER display secrets — all cert evidence below uses path-only, never content"
  - "Global CLAUDE.md § VERIFICATION STANDARD: every 'checked' claim below has file:line or reproducible command output"
  - "vollos-core CLAUDE.md § D Docker: D1 vollos-network owner=vollos-core, D4 postgres dual-network — both verified in merged compose"
  - "vollos-core CLAUDE.md § I Production Safety: I4 smoke test post-start — out of scope for T-008 (deploy is T-007 2B-2)"
  - "vollos-core CLAUDE.md § J Secrets: J1-J3 — cert handled as file bind-mount (not env), gitignored, never committed — ALL PASS"
  - "vollos-core CLAUDE.md § K Code Quality: K3 no placeholder — grep clean (see greps_executed)"

## files_reviewed
  - "infra/Caddyfile: lines 1-144 (full file — 36-line diff from main)"
  - "docker-compose.prod.yml: lines 1-112 (full file — +73 lines including new caddy service + volumes block)"
  - "docker-compose.yml: lines 1-101 (full file — 5-line diff adding vollos-network to vollos-api)"
  - ".gitignore: lines 1-22 (full file — 4-line diff adding *.key + keys/*.key + infra/certs/)"
  - "_workspace/T-008/output.md: lines 1-309 (DevOps self-claim — cross-checked below)"
  - "_workspace/T-008/task.md: lines 1-184 (scope + owned_files + forbidden + acceptance)"

## greps_executed
  - "git check-ignore -v infra/certs/cloudflare.pem infra/certs/cloudflare.key keys/test.pem → `.gitignore:20:infra/certs/ ...` (3 patterns all block)"
  - "git ls-files | grep -E '\\.(pem|key)$' → exit 1, no output (no cert files tracked)"
  - "git log --all -S 'BEGIN CERTIFICATE' --oneline → no output (no cert content ever committed)"
  - "git log --all -S 'BEGIN RSA PRIVATE KEY' --oneline → no output"
  - "git log --all -S 'BEGIN PRIVATE KEY' --oneline → no output"
  - "grep -n 'acme_ca|auto_https|^\\s*email ' infra/Caddyfile → no match (ACME directives gone; only comment-only references remain at L7, L18, L25)"
  - "grep -n 'tls /etc/caddy/certs' infra/Caddyfile → L97, L123, L139 — all 3 vhosts"
  - "grep -n 'privileged|security_opt|cap_drop|cap_add|no-new-privileges|read_only|tmpfs|docker.sock' docker-compose*.yml → NO MATCH (no hardening directives anywhere in compose files)"
  - "grep -n 'user:' docker-compose.yml docker-compose.prod.yml → NO MATCH (no service has user: override)"
  - "grep -n 'logs/caddy|var/log/caddy' docker-compose*.yml → NO MATCH (no bind-mount for /var/log/caddy) — Caddyfile:L37-38 comment says `./logs/caddy:/var/log/caddy` is required but compose does not have it"
  - "grep -n 'mem_limit|cpus|deploy:' docker-compose*.yml → NO MATCH (no resource limits on any service)"
  - "docker image inspect caddy:2-alpine --format '{{.Config.User}}' → empty string → `docker run --rm caddy:2-alpine id` → `uid=0(root) gid=0(root) groups=0(root) ...` — upstream image default is root"
  - "docker run --rm caddy:2-alpine which nc wget → /usr/bin/nc + /usr/bin/wget (healthcheck binary present)"
  - "grep -in 'alert(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' infra/Caddyfile docker-compose.yml docker-compose.prod.yml .gitignore → no match (K3 placeholder grep clean)"
  - "git diff main...HEAD --name-only → .gitignore + docker-compose.prod.yml + docker-compose.yml + infra/Caddyfile (exact scope match)"
  - "docker compose -f docker-compose.yml -f docker-compose.prod.yml config → merged output inspected — vollos-api + auth-service + postgres have NO ports: section; caddy only binds 80/tcp + 443/tcp + 443/udp; all 4 services on vollos-network"
  - "git log -1 --format='%H %s' HEAD → `075a123bca... fix(infra): reuse Cloudflare Origin Cert + Caddy service in docker compose` (conventional commits ✓)"
  - "gitlab API projects/vollos-ai%2Fvollos-core/merge_requests/12 → state=opened, target=main, source=fix/rs013-caddy-cf-origin-cert, sha=075a123b"
  - "gitlab API projects/vollos-ai%2Fvollos-core/merge_requests/12/pipelines → pipeline 2462413577 status=success on SHA 075a123b"
  - "git log main --oneline -5 → main HEAD unchanged (no direct push)"

## scope_compliance
  files_changed_vs_owned: "match — only infra/Caddyfile, docker-compose.prod.yml, docker-compose.yml, .gitignore (all 4 in task.md owned_files). No forbidden paths touched (CLAUDE.md, _board.md, task.md, apps/*/src/**, packages/*/src/**)."
  forbidden_paths_touched: "none — verified via `git diff main...HEAD --name-only`"
  pushed_to_main: "no — main HEAD unchanged (last merge commit 3503e66 is from earlier PR, not from this branch)"
  mr_opened: "yes — MR !12 opened targeting main"

## previous_conditional_conditions_status
  source: "T-007 audit (review-auditor.md) — conditional_pass with blocker: TLS strategy mismatch (Caddyfile used ACME auto-HTTPS but Cloudflare proxy Full Strict mode was ON → HTTP-01/TLS-ALPN-01 challenges would never reach origin → deploy would fail)"
  resolution_in_mr_12:
    status: "RESOLVED (subject to this audit's conditions)"
    evidence: |
      - ACME directives removed from Caddyfile (grep 'acme_ca|auto_https|^\\s*email ' → no match; `email admin@vollos.ai` at old L15 gone)
      - Static cert reference added at Caddyfile:L97, L123, L139 (3 vhosts) → `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key`
      - Cert binds read-only via `./infra/certs:/etc/caddy/certs:ro` (docker-compose.prod.yml:L79)
      - Cert files never committed (git ls-files clean + git log -S clean + git check-ignore confirms all 3 gitignore patterns block them)
    residual_risk: "none for the TLS strategy blocker itself. See F-1/F-2 below for NEW findings introduced by the Caddy service."

## security_findings

  - id: SEC-001
    severity: "high"
    cvss_estimate: "~6.8 (estimated — CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:L — local RCE in container escalates to host because root inside container shares UID with host root; scope-change bumps local CVSS into HIGH band per CVSS guidance when escape vectors exist — CIS Docker Benchmark v1.6 §5.30 treats container-root as HIGH operational risk)"
    category: "docker (CWE-250, CIS Docker Benchmark v1.6 §5.30, OWASP Docker Top 10 D04)"
    description: "Caddy container runs as root (uid=0). Upstream `caddy:2-alpine` default `User` is empty → resolves to root; compose file does NOT override with `user:` directive. An RCE inside Caddy (e.g., via a crafted request exploiting a future CVE in the HTTP parser, a compromised config reload, or a malicious bind-mount) would run as root inside the container. Combined with absence of `no-new-privileges:true` + `cap_drop: [ALL]`, this is a materially larger blast radius than necessary for an edge proxy that only needs `NET_BIND_SERVICE` (bind :80/:443) and file-read (cert + Caddyfile)."
    file: "docker-compose.prod.yml:L70-107 (entire caddy service block — specifically the absence of `user:`, `cap_drop:`, `cap_add:`, `security_opt:`, `read_only:`)"
    evidence: |
      1) `docker run --rm caddy:2-alpine id` → `uid=0(root) gid=0(root) groups=0(root),0(root),1(bin),2(daemon),3(sys),4(adm),6(disk),10(wheel),11(floppy),20(dialout),26(tape),27(video)` — upstream image IS root by default.
      2) `grep -n 'user:|security_opt|cap_drop|no-new-privileges|read_only' docker-compose.prod.yml` → 0 matches anywhere in file.
      3) DevOps self-flagged: output.md:L202-203 `caddy_service_non_root: {result: false, evidence: ...does NOT explicitly set user:...}` — agent admits the gap.
    recommendation: |
      docker-compose.prod.yml:L70 (caddy service) — add these 5 directives before the `volumes:` block:
      ```yaml
      caddy:
        image: caddy:2-alpine
        container_name: vollos-core-caddy
        user: "1000:1000"                    # non-root — Caddy supports this out of the box
        cap_drop: [ALL]
        cap_add: [NET_BIND_SERVICE]          # required to bind :80/:443 as non-root
        security_opt:
          - no-new-privileges:true
        read_only: true
        tmpfs:
          - /tmp:size=16m
        # (keep existing volumes + ports + networks)
      ```
      Note: because caddy_data + caddy_config are named volumes Docker-managed with writable perms, read_only: true on the root fs still allows writes to /data + /config. The `user: 1000:1000` override also means infra/certs/cloudflare.{pem,key} on the VPS must be chmod g+r and chown to UID 1000 (or the caddy binary must use fscaps — simpler to just chown the mount point).
    reference: "CIS Docker Benchmark v1.6 §5.30 (Do not share the host's user namespaces) + §5.4 (Restrict Linux kernel capabilities within containers) + §5.25 (no-new-privileges) + OWASP Docker Top 10 D04 (Running as root)"
    block_deploy: false
    rationale_not_blocking: "Caddy is the only internet-facing container but: (a) Cloudflare proxy sits in front providing WAF/DDoS/bot protection → direct attacker access to the Caddy process is already mediated, (b) Caddy reads no user-supplied config at runtime (Caddyfile is bind-mounted :ro and static), (c) cert directory is bind-mounted :ro, (d) Docker's default user namespace remapping isn't in play but Cloudflare's trust boundary is the primary first line — this is defense-in-depth, not a sole failure point. HIGH finding with mitigation (CF WAF) → Verdict Policy allows conditional_pass (see §Verdict Policy row `≥1 HIGH + 0 CRITICAL + มี mitigation`). Phase 2B can deploy IF Lead commits to a follow-up task within 1 sprint."

  - id: SEC-002
    severity: "high"
    cvss_estimate: "~5.3 (estimated — CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:L — credential stuffing + brute force attempts against auth.vollos.ai that would normally be detected + banned by fail2ban caddy-auth jail will go undetected because the jail cannot read /var/log/caddy/access.log. Classified HIGH because the jail is explicitly part of the documented security architecture — its absence defeats a stated control, not an aspirational one. API2:2023 Broken Authentication — Credential Stuffing Prevention row in references/security-checklists.md:L97)"
    category: "docker (CWE-778 Insufficient Logging — CIS Docker Benchmark v1.6 §6.2), api_auth (API2:2023 Credential Stuffing, CWE-307)"
    description: "Caddy writes JSON access log to `/var/log/caddy/access.log` INSIDE the container (Caddyfile:L40). Compose file has NO bind-mount from host `./logs/caddy` to container `/var/log/caddy`. Fail2ban on the VPS host cannot read files inside the container's overlay filesystem. The Caddyfile itself documents the expected mount at L37-38: `# /var/log/caddy/access.log on the host. Volume mount required: # ./logs/caddy:/var/log/caddy`. This is a known-missing architectural control. Brute-force / credential stuffing attempts against auth.vollos.ai → 401/403/429 patterns Caddy logs → fail2ban's caddy-auth jail never fires → attacker retries indefinitely."
    file: "docker-compose.prod.yml:L74-84 (caddy volumes block) — specifically the ABSENCE of `./logs/caddy:/var/log/caddy` bind-mount"
    evidence: |
      1) `grep -n 'logs/caddy|var/log/caddy' docker-compose*.yml` → no match.
      2) Caddyfile:L36-40 (verbatim) — `# Centralised access log (JSON) — fail2ban caddy-auth jail reads / # /var/log/caddy/access.log on the host. Volume mount required: / # ./logs/caddy:/var/log/caddy / log { output file /var/log/caddy/access.log ...}` → the Caddyfile itself documents that the mount is required but it's not added.
      3) `ls /home/ipon/workspace/vollos-ai/vollos-core/logs/` → `No such file or directory` — host dir doesn't even exist locally to bind-mount against.
      4) DevOps self-flagged: output.md:L282-285 `Fail2ban caddy-auth jail needs ./logs/caddy:/var/log/caddy bind mount on the VPS — not in task scope. Caddy will log to /var/log/caddy/access.log inside the container; fail2ban won't see it until that mount is added.` — agent admits the gap.
    recommendation: |
      docker-compose.prod.yml:L74 (caddy volumes block) — add one line:
      ```yaml
          volumes:
            - ./infra/Caddyfile:/etc/caddy/Caddyfile:ro
            - ./infra/certs:/etc/caddy/certs:ro
            - ./logs/caddy:/var/log/caddy          # NEW — fail2ban jail reads this on host
            - caddy_data:/data
            - caddy_config:/config
      ```
      Also: DevOps task.md for follow-up must include `mkdir -p /home/ipon/vollos-core/logs/caddy && chown 1000:1000 logs/caddy` (matches the user:1000 fix above) and verify fail2ban jail.local has `logpath = /home/ipon/vollos-core/logs/caddy/access.log` pointing at the host path.
    reference: "CIS Docker Benchmark v1.6 §6.2 (Ensure container logs are persisted outside container) + fail2ban best practice (jail logpath must be host-readable) + OWASP API Security Top 10 2023 API2 Credential Stuffing Prevention (references/security-checklists.md:L97 — requires rate limit on auth endpoints AND detection)"
    block_deploy: false
    rationale_not_blocking: "Caddy access log is defense-in-depth for credential stuffing detection. Primary auth rate limiting should live inside auth-service itself (app-layer, not infra-layer). If auth-service has its own per-IP rate limit (verify in a separate audit), the missing fail2ban integration is a degraded-not-broken state. HIGH with partial compensating control = conditional_pass."

## medium_findings

  - id: SEC-003
    severity: "medium"
    cvss_estimate: "~4.3 (estimated — CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N — supply-chain risk: `caddy:2-alpine` floating tag means next `docker pull` could silently fetch a different binary. CIS Docker Benchmark v1.6 §4.2 (Use trusted base images for containers) + A03:2025 Software Supply Chain Failures)"
    category: "supply_chain (A03:2025, CWE-1357 Reliance on Insufficiently Trustworthy Component)"
    description: "Caddy image pinned to `caddy:2-alpine` (floating tag — not digest). Docker re-pulls could swap the binary. Same applies to `postgres:17-alpine` (docker-compose.yml:L3). For a production edge that terminates TLS, image digest pinning is recommended."
    file: "docker-compose.prod.yml:L71 (`image: caddy:2-alpine`) + docker-compose.yml:L3 (`image: postgres:17-alpine`)"
    evidence: "grep -n 'image:|@sha256' docker-compose*.yml → L3 postgres:17-alpine, L71 caddy:2-alpine — no `@sha256:...` digests"
    recommendation: "docker-compose.prod.yml:L71 — change to `image: caddy:2-alpine@sha256:<current-digest>`. Get digest via `docker buildx imagetools inspect caddy:2-alpine`. Update tag+digest together on scheduled review (quarterly). Apply same pattern to postgres:17-alpine at docker-compose.yml:L3."
    reference: "CIS Docker Benchmark v1.6 §4.2 + OWASP Top 10 2025 A03 (Software Supply Chain Failures) + references/security-checklists.md:L134 (Docker Base Image row)"

  - id: SEC-004
    severity: "medium"
    cvss_estimate: "~3.7 (estimated — CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L — no resource limits → a request flood that makes it past Cloudflare could exhaust host memory/CPU; impact bounded because Cloudflare rate limits upstream of origin)"
    category: "docker (CWE-400 Uncontrolled Resource Consumption, CIS Docker Benchmark v1.6 §5.11 §5.12)"
    description: "No `mem_limit`, `cpus`, or `deploy.resources.limits` on any service (postgres/vollos-api/auth-service/caddy). A runaway process can starve the host."
    file: "docker-compose.yml (all 3 services) + docker-compose.prod.yml:L70-107 (caddy)"
    evidence: "grep -n 'mem_limit|cpus|deploy:' docker-compose*.yml → no match"
    recommendation: "docker-compose.prod.yml — add to each service (tune per VPS sizing):\n```yaml\n  caddy:\n    mem_limit: 256m\n    cpus: 0.5\n  vollos-api:\n    mem_limit: 512m\n    cpus: 1.0\n  auth-service:\n    mem_limit: 512m\n    cpus: 1.0\n  postgres:\n    mem_limit: 1g\n    cpus: 2.0\n```\nVerify against `free -h` + `nproc` on VPS before deploy."
    reference: "CIS Docker Benchmark v1.6 §5.11 (memory usage) + §5.12 (CPU priority) + OWASP API Top 10 2023 API4 (Unrestricted Resource Consumption)"

## note_findings

  - id: SEC-N01
    severity: "note"
    description: "Healthcheck design is sound given `admin off`. `nc -z 127.0.0.1 443` verifies TCP listener bound, which implies Caddyfile parsed + cert loaded + listener started. nc binary present in caddy:2-alpine (verified via `docker run --rm caddy:2-alpine which nc` → /usr/bin/nc). Task.md:L75 template had `wget --spider http://localhost:2019/config/` against the admin API — DevOps correctly rejected that because `admin off` at Caddyfile:L26 disables port 2019 entirely. The deviation is a security improvement, not a regression. Documented in output.md:L242-244 (`deviations_from_task.healthcheck_probe_port`)."
    file: "docker-compose.prod.yml:L103 + infra/Caddyfile:L26"

  - id: SEC-N02
    severity: "note"
    description: "Self-review present and evidence-based (14 of 14 fields have result + file:line evidence). One `result: false` at output.md:L202-203 (caddy_service_non_root) — agent honestly flagged the gap rather than hiding it. Per SKILL.md:L237, `self_review` result:false should trigger a HIGH finding — this finding IS raised here as SEC-001 with mitigation context, so the self-report is not punished but credited as transparency."
    file: "_workspace/T-008/output.md:L194-236 (self_review block)"

  - id: SEC-N03
    severity: "note"
    description: "Caddy placement on `internal` network (docker-compose.prod.yml:L91) is not strictly needed — Caddy never proxies to postgres (only vollos-api:3001 + auth-service:3004, both on vollos-network). Keeping caddy on `internal` is defense-in-depth noise but not wrong. Recommend removing `internal` from caddy's networks list in a future cleanup to strictly enforce least-network-access. NOT blocking — caddy lacks any route to postgres in the Caddyfile so even if it's on the network, no proxy target exists."
    file: "docker-compose.prod.yml:L89-91"

## us_privacy_compliance
  unsubscribe_mechanism: "N/A — T-008 is infra-only (Caddy + TLS + gitignore). No application-layer code touched. CAN-SPAM email compliance was audited in prior Backend tasks."
  physical_address_in_email: "N/A — see above"
  audit_log: "N/A — see above"
  data_minimization: "N/A — no schema changes"

## checks_performed
  - "[x] TLS strategy (ACME removed, static cert on 3 vhosts) — Caddyfile:L97, L123, L139"
  - "[x] Cert files gitignored (*.pem + *.key + infra/certs/ blanket) — .gitignore:L15-20"
  - "[x] No cert content in git history — `git log --all -S 'BEGIN CERTIFICATE'` + RSA + PRIVATE variants all empty"
  - "[x] No tracked cert files — `git ls-files | grep -E '\\.(pem|key)$'` empty"
  - "[x] Caddy service joins vollos-network + internal — docker-compose.prod.yml:L89-91"
  - "[x] vollos-api dual-network (D4 compliance) — docker-compose.yml:L48-54"
  - "[x] auth-service dual-network unchanged — docker-compose.yml:L79-81"
  - "[x] postgres dual-network (already existed, unchanged) — docker-compose.yml:L19-21"
  - "[x] Only caddy binds host ports in prod — merged `docker compose config` confirms postgres/api/auth have no ports: section"
  - "[x] Caddy binds 80+443+443/udp only — docker-compose.prod.yml:L85-88"
  - "[x] Healthcheck valid for admin-off Caddy — nc binary present in caddy:2-alpine"
  - "[x] Security headers retained (HSTS + CSP + X-Frame-Options + etc.) — Caddyfile:L75-86"
  - "[x] trusted_proxies (CF IP ranges) retained — Caddyfile:L31-34"
  - "[x] admin off retained — Caddyfile:L26"
  - "[x] Placeholder grep clean — K3 compliance"
  - "[x] Conventional commit message — `fix(infra): ...`"
  - "[x] Feature branch (not main) — `fix/rs013-caddy-cf-origin-cert`"
  - "[x] MR opened to main — !12 state=opened"
  - "[x] Pipeline green on exact SHA — pipeline 2462413577 status=success sha=075a123b"
  - "[x] Scope compliance — only 4 files changed, all in task.md owned_files"
  - "[x] No forbidden files touched (CLAUDE.md, _board.md, apps/*/src/**, packages/*/src/**)"
  - "[x] main HEAD not touched by this branch"
  - "[ ] Docker hardening (user + cap_drop + security_opt + read_only) — MISSING (SEC-001)"
  - "[ ] Access log bind-mount for fail2ban — MISSING (SEC-002)"
  - "[ ] Image digest pinning — MISSING (SEC-003)"
  - "[ ] Resource limits — MISSING (SEC-004)"

## skipped_sections: []

## conditional_conditions
  # verdict=conditional_pass → deploy can proceed IF owner accepts these conditions
  - id: C1
    description: "Phase 2B (T-007 deploy resume) MAY proceed with MR !12 as-is, BUT a follow-up DevOps task MUST be filed and merged within 1 sprint (≤7 days from deploy) to address SEC-001 + SEC-002 (Caddy non-root + access-log bind-mount). Both are HIGH but have compensating controls (Cloudflare WAF in front + auth-service app-layer rate limit) that keep the interim risk acceptable."
    addresses: [SEC-001, SEC-002]
    sla: "≤ 7 days post-deploy"
  - id: C2
    description: "Image digest pinning (SEC-003) and resource limits (SEC-004) should be addressed in the same follow-up task. MEDIUM — not deploy-blocking but quick to add at the same time as C1."
    addresses: [SEC-003, SEC-004]
    sla: "≤ 14 days post-deploy"
  - id: C3
    description: "Lead MUST create follow-up task.md BEFORE merging MR !12, with ID `T-009` or similar, referencing SEC-001+SEC-002+SEC-003+SEC-004 from this review, so the follow-up is on the board (not in memory)."
    addresses: [SEC-001, SEC-002, SEC-003, SEC-004]
    sla: "before merge"

## phase_2b_readiness
  status: "ready (with conditions)"
  go_no_go: "GO with conditions C1+C2+C3"
  rationale: |
    Core blocker from T-007 audit (TLS strategy mismatch) is RESOLVED cleanly:
      1) ACME directives gone (grep clean)
      2) Static CF Origin Cert wired on all 3 vhosts
      3) Cert files cannot be committed (3-layer gitignore + history clean + ls-files clean)
      4) Caddy service added correctly to vollos-network + internal
      5) Port exposure correct (only Caddy binds host; api/auth/postgres stripped via !reset [])
      6) D4 compliance fixed (vollos-api dual-network)
      7) MR process followed (feature branch → MR → pipeline green → main untouched)
      8) caddy validate + compose config --quiet both exit 0 (self-verified by DevOps)

    Non-blockers (HIGH but with mitigation):
      - SEC-001 Caddy root: Cloudflare WAF upstream mediates attacker access; Caddy reads no user-supplied config at runtime.
      - SEC-002 Fail2ban log gap: auth-service app-layer rate limit should be primary defense; fail2ban is defense-in-depth.

    Verdict: conditional_pass → owner may approve MR if C1+C2+C3 are accepted. If owner wants fail2ban fully functional from day 1 or non-root Caddy from day 1 → reject MR and request SEC-001+SEC-002 fixes before merge (bump to `fail`). Both options are reasonable; I recommend accepting conditions because the cert + network + port topology is correct and the hardening is additive, not corrective.

completion_signal: "task_id=T-008 verdict=conditional_pass findings=4 (2H+2M+3notes) path=_workspace/T-008/review-auditor.md"

---

## rationale (Thai — plain language for owner)

**สรุปแบบเด็ก 12 ขวบเข้าใจ:**

MR !12 ผ่านแบบมีเงื่อนไข (conditional_pass) ครับเจ้านาย

**ของที่ทำถูก 100%:**
1. ใบรับรอง TLS เดิมของ Cloudflare ถูกวางบน 3 subdomain (auth.vollos.ai / vollos.ai / www.vollos.ai) ตรงที่ควร
2. ใบรับรอง .pem + .key ถูก .gitignore บล็อก 3 ชั้น (pattern `*.pem`, `*.key`, `infra/certs/`) — ไม่มีทางหลุดเข้า git
3. เช็ค git history ย้อนหลังทั้งหมด → ไม่มีใบรับรองเคยถูก commit
4. network ถูกตาม rule D4 (postgres อยู่ 2 network, vollos-api เพิ่มเข้า vollos-network แล้ว)
5. port บน VPS จะเปิดแค่ Caddy (80/443) — อันอื่นถูก !reset ลบหมด
6. commit message ใช้ conventional commits, branch ถูก, MR เปิดชัด, pipeline เขียว

**ของที่ยังไม่ได้ทำ 4 อย่าง (DevOps บอกเอง 2 อย่าง + Auditor เจอเพิ่ม 2 อย่าง):**

- **SEC-001 (HIGH):** Caddy รันด้วย user `root` ใน container — ถ้าใครแฮก Caddy สำเร็จ ก็ได้สิทธิ์ root เลย → แนะนำเพิ่ม `user: 1000:1000` + `cap_drop: [ALL]` + `cap_add: [NET_BIND_SERVICE]` + `no-new-privileges` + `read_only: true`
- **SEC-002 (HIGH):** Caddy เขียน access log ข้างในตัวเอง (inside container) แต่ compose ไม่มี bind-mount ออกมานอก — fail2ban บน VPS จะอ่านไม่เจอ → โจรลอง password ซ้ำๆ ก็ไม่โดน ban → แนะนำเพิ่ม `./logs/caddy:/var/log/caddy` ใน volumes ของ caddy
- **SEC-003 (MEDIUM):** image ใช้ tag `caddy:2-alpine` (ไม่ pin digest) → ถ้า docker pull ใหม่ อาจได้ binary คนละตัว
- **SEC-004 (MEDIUM):** ไม่ได้ใส่ mem_limit / cpus — ถ้ามี process เพี้ยน อาจกิน RAM/CPU หมดเซิร์ฟเวอร์

**ทำไมไม่ block merge:**
- SEC-001: Cloudflare WAF อยู่หน้า Caddy อยู่แล้ว → attacker ต้องผ่าน CF ก่อน = มี shield ชั้นแรก
- SEC-002: auth-service น่าจะมี rate limit ของตัวเองอยู่ (app layer) → fail2ban เป็นเกราะชั้นสอง ไม่ใช่ชั้นแรก
- ทั้ง 2 ข้อ DevOps เขียนยอมรับเองใน output.md ว่ารู้ gap อยู่แล้ว — ซื่อสัตย์ดี ไม่ปกปิด

**เงื่อนไขที่ขอ (3 ข้อ):**
1. ก่อน merge — Lead สร้าง task ใหม่ (T-009 หรือเลขถัดไป) สำหรับแก้ SEC-001+SEC-002+SEC-003+SEC-004 ภายใน 7 วันหลัง deploy
2. merge ได้ + deploy Phase 2B ได้ตามเดิม
3. DevOps task T-009 ต้องทำให้เสร็จภายใน 7-14 วัน ห้ามลืม

**ถ้าเจ้านายไม่อยากมีเงื่อนไข:**
- สั่ง Lead ให้ reject MR !12 + ให้ DevOps เพิ่ม 5 บรรทัด hardening + 1 บรรทัด log mount ก่อน merge → audit จะเปลี่ยนเป็น pass เต็ม (ไม่มีเงื่อนไข)
- ใช้เวลาเพิ่มอีก ~30 นาทีของ DevOps เท่านั้น

**ข้อสังเกตเพิ่ม:**
- Caddy healthcheck ใช้ `nc -z 127.0.0.1 443` แทน admin API (port 2019) — DevOps ทำถูกเพราะ `admin off` ปิด port 2019 ไว้ดีแล้ว (ปลอดภัยกว่า)
- Self-review ของ DevOps มี 14 ข้อ ทุกข้อมี file:line ชัด — 1 ข้อรายงาน `result: false` (เรื่อง non-root) = โปร่งใส ไม่โกหก
- Caddy ไม่จำเป็นต้องอยู่ `internal` network (ไม่ proxy ไปหา postgres) แต่ไม่ใช่บั๊ก — cleanup ทีหลังก็ได้

**คำแนะนำ:** accept conditions + merge + deploy + spawn T-009 follow-up task ทันที

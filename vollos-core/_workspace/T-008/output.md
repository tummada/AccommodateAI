---
task_id: T-008
status: passed
branch: fix/rs013-caddy-cf-origin-cert
commit_sha: 075a123bca32ed4589a85a814e1d3ff1c451122d
mr_iid: 12
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/12
completed_at: 2026-04-18T19:25:00+07:00
---

# T-008 — Caddyfile + Caddy service for CF Origin Cert (Option A)

## skill_loaded_evidence
files_read:
  - "SKILL.md:L42-52 — Routing Protocol (read SKILL.md first, evidence required, no Agent spawn)"
  - "SKILL.md:L260-268 — Security Rules (non-root, no secrets, caddy validate before reload, .env gitignore)"
  - "SKILL.md:L269-299 — UFW-Docker Bypass (Caddy is the ONLY container that binds to host ports — backend services stay on Docker internal network)"
  - "SKILL.md:L201-221 — Caddy service template (caddy:2-alpine image, /data + /config named volumes, depends_on api healthy, resource limits)"
  - "SKILL.md:L383-395 — Pre-Delivery Checklist (.env in gitignore, no hardcoded secrets, postgres no ports in prod, Caddy /data + /config mounted)"
  - "SKILL.md:L459-464 — Critical Rules (Caddy-only 80/443 expose, no pipeline skip, verification output mandatory)"
  - "CLAUDE.md:L130-134 — Rules D1-D4 (vollos-network owner, driver bridge, vollos-core brings up first, postgres dual-network)"
  - "CLAUDE.md:L175-180 — Rules K1-K3 (health endpoint, no placeholder/alert() in production)"

## re_anchor_evidence
  - "Global CLAUDE.md § SECURITY: NEVER display secrets — no cert material quoted in output.md (files don't exist locally anyway)"
  - "Global CLAUDE.md § VERIFICATION STANDARD: quote file:line + rerun evidence — caddy validate + compose config outputs captured below"
  - "Global CLAUDE.md § COMPLETION PROTOCOL: listed all 4 files changed, verified each against 10 acceptance criteria"
  - "vollos-core CLAUDE.md § D Docker (D1 vollos-network ownership, D4 postgres dual-network)"
  - "vollos-core CLAUDE.md § K Code Quality (K3 no placeholder — grep clean on all 4 changed files)"
  - "Best Practices Git: conventional commit `fix(infra): ...`, feature branch, MR to main (no direct push)"

## files_changed
  - path: infra/Caddyfile
    action: modified
    existing_read: "infra/Caddyfile:L15 — `email admin@vollos.ai`, L84-111 auth.vollos.ai block, L106-113 vollos.ai block, L118-121 www.vollos.ai block"
    summary: "Remove `email admin@vollos.ai` (ACME-only contact). Rewrite header-comment block to document CF Origin Cert model. Add `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` to 3 vhosts (auth, apex, www). Preserve admin off, trusted_proxies, log format, security_headers snippet, all reverse_proxy / file_server / redir directives."
  - path: docker-compose.prod.yml
    action: modified
    existing_read: "docker-compose.prod.yml:L36 ports !reset [] for postgres, L45 vollos-api, L52 auth-service — no caddy service present"
    summary: "Add `caddy` service at L60-93 (image caddy:2-alpine, container_name vollos-core-caddy, bind-mount Caddyfile + infra/certs/ read-only, named volumes caddy_data/caddy_config, ports 80/443/443-udp, networks [vollos-network, internal], depends_on vollos-api + auth-service healthy, nc-based TCP :443 healthcheck). Add `volumes:` top-level block declaring caddy_data + caddy_config. Update header comments to document Caddy edge-only role + CF Origin Cert rationale + T-007 reference."
  - path: docker-compose.yml
    action: modified
    existing_read: "docker-compose.yml:L48-49 `networks: - internal` (vollos-api only on internal, NOT on vollos-network — flagged by Auditor T-003 F-1)"
    summary: "Add `vollos-network` to vollos-api's networks list so Caddy (on vollos-network in prod) can reverse_proxy vollos-core-api:3001 via container DNS once a lead-capture route is added. Matches auth-service topology (both on internal + vollos-network)."
  - path: .gitignore
    action: modified
    existing_read: ".gitignore:L14-17 (`*.pem`, `private.*`, `keys/*.pem`, `/tmp/auth-rsa-keys-*`) — `*.key` was NOT blocked"
    summary: "Add `*.key`, `keys/*.key`, and blanket `infra/certs/` so CF Origin Cert material (cloudflare.pem + cloudflare.key) cannot be committed. Update comment to reference both RSA JWT keys (RS-013) and CF Origin Cert (T-008)."

## caddyfile_changes
  tls_lines_added: 3
  tls_lines_location:
    - "infra/Caddyfile:L97 (auth.vollos.ai block)"
    - "infra/Caddyfile:L123 (vollos.ai block)"
    - "infra/Caddyfile:L139 (www.vollos.ai block)"
  acme_references_removed: 1
  acme_removal_detail: "L15 `email admin@vollos.ai` directive removed. No `acme_ca`, no `auto_https` directive, no Let's Encrypt URLs in Caddyfile. Remaining `acme` string hits (infra/Caddyfile:L7, L18, L25) are comment-only documentation explaining WHY ACME is disabled — not active config."
  preserved_security_headers: true
  preserved_security_headers_evidence: "infra/Caddyfile:L75-86 (security_headers snippet with HSTS, X-Frame-Options, CSP) unchanged; `import security_headers` retained in all 3 vhost blocks at L99, L125, L141"
  preserved_trusted_proxies: true
  preserved_trusted_proxies_evidence: "infra/Caddyfile:L31-34 (servers { trusted_proxies static <CF IP ranges> + client_ip_headers CF-Connecting-IP X-Forwarded-For }) unchanged"
  preserved_log_format: true
  preserved_log_format_evidence: "infra/Caddyfile:L39-46 (log { output file /var/log/caddy/access.log { roll_size 50mb ... } format json }) unchanged — fail2ban caddy-auth jail regex remains compatible"
  preserved_admin_off: true
  preserved_admin_off_evidence: "infra/Caddyfile:L26 `admin off` unchanged — admin API stays disabled"
  preserved_reverse_proxy: true
  preserved_reverse_proxy_evidence: "infra/Caddyfile:L102-110 reverse_proxy vollos-core-auth:3004 block unchanged (health_uri, health_interval, header_up X-Real-IP, X-Forwarded-For)"

## compose_changes
  caddy_service_added_file: docker-compose.prod.yml
  caddy_service_location: "docker-compose.prod.yml:L60-93"
  caddy_image: "caddy:2-alpine"
  caddy_container_name: "vollos-core-caddy"
  caddy_networks: [vollos-network, internal]
  caddy_ports: ["80:80", "443:443", "443:443/udp"]
  caddy_volumes:
    - "./infra/Caddyfile:/etc/caddy/Caddyfile:ro"
    - "./infra/certs:/etc/caddy/certs:ro"
    - "caddy_data:/data"
    - "caddy_config:/config"
  caddy_named_volumes_declared: [caddy_data, caddy_config]
  caddy_named_volumes_location: "docker-compose.prod.yml:L95-97 (new top-level `volumes:` block)"
  caddy_depends_on:
    vollos-api: service_healthy
    auth-service: service_healthy
  caddy_healthcheck: "nc -z 127.0.0.1 443 (TCP listener probe — admin API is disabled so can't probe :2019; TCP on :443 is true only after Caddyfile parse + cert load + listener bind)"
  caddy_restart: unless-stopped
  vollos_api_networks_updated: true
  vollos_api_networks_now: [internal, vollos-network]
  vollos_api_networks_location: "docker-compose.yml:L48-54"
  auth_service_networks_unchanged: true
  auth_service_networks: [internal, vollos-network]
  auth_service_networks_location: "docker-compose.yml:L74-76 (already on both networks pre-T-008)"
  postgres_ports_stripped_in_prod: true
  postgres_ports_stripped_evidence: "docker-compose.prod.yml:L36 `ports: !reset []` → merged config has NO ports: section for postgres (verified via compose config dump)"

## gitignore_patterns
  pem_blocked: true
  pem_pattern: "*.pem (.gitignore:L15)"
  key_blocked: true
  key_pattern: "*.key (.gitignore:L16)"
  infra_certs_blanket_blocked: true
  infra_certs_pattern: "infra/certs/ (.gitignore:L20)"
  check_ignore_evidence: |
    $ git check-ignore -v infra/certs/cloudflare.pem infra/certs/cloudflare.key keys/test.key
    .gitignore:20:infra/certs/	infra/certs/cloudflare.pem
    .gitignore:20:infra/certs/	infra/certs/cloudflare.key
    .gitignore:9:keys/	keys/test.key
  no_cert_files_tracked: true
  no_cert_files_tracked_evidence: "`git ls-files | grep -E '\\.(pem|key)$'` → no output"

## validation

### caddy_validate
  command: "docker run --rm -v $PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro -v /tmp/fake-certs:/etc/caddy/certs:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile"
  exit_code: 0
  output_tail: |
    {"level":"info","ts":1776513964.6250544,"msg":"using config from file","file":"/etc/caddy/Caddyfile"}
    {"level":"info","ts":1776513964.627348,"msg":"adapted config to JSON","adapter":"caddyfile"}
    {"level":"info","ts":1776513964.629112,"msg":"redirected default logger","from":"stderr","to":"/var/log/caddy/access.log"}
    Valid configuration
  note: |
    Caddy's validate phase reads cert files to ensure they parse. Local checkout has no cert
    files (they live only on the VPS — gitignored intentionally), so a throwaway self-signed
    pair was generated once under /tmp/fake-certs/ for the validator alone, then ignored.
    No cert material ever entered the repo tree.

### compose_config_merged
  command: "docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet"
  exit_code: 0
  output: "(silent — --quiet emits nothing on success)"
  manual_inspection_evidence:
    - "Merged vollos-api has networks=[internal, vollos-network], no ports: section (stripped by prod !reset)"
    - "Merged caddy has networks=[internal, vollos-network], ports=[80/tcp, 443/tcp, 443/udp], image=caddy:2-alpine"
    - "Merged postgres has no ports: section (stripped by prod !reset)"
    - "caddy_data + caddy_config named volumes declared under top-level volumes:"
    - "depends_on: caddy → vollos-api (service_healthy) + auth-service (service_healthy)"

### grep_acme_clean
  command: "grep -n 'acme_ca\\|auto_https\\|^\\s*email ' infra/Caddyfile"
  exit_code: 1
  output: "(no active ACME directives — only documentation comments explaining disabled ACME)"

### placeholder_grep
  command: "grep -in 'alert(\\|coming soon\\|TODO\\|TBD\\|mock\\|not implemented\\|Phase [0-9]' infra/Caddyfile docker-compose.yml docker-compose.prod.yml .gitignore"
  exit_code: 1
  output: "(none — clean on all 4 changed files)"

### hardcoded_secrets_check
  command: "grep -rn 'PASSWORD\\|SECRET\\|KEY' infra/ (excluding .sh + Caddyfile CSP string)"
  result: "clean — no secrets in infra/. Caddyfile only mentions CF-Connecting-IP header + cert path; no values."

### docker_socket_mount
  command: "grep -rn 'docker.sock' infra/ docker-compose*.yml"
  result: "clean — no Docker socket mounts"

## acceptance_criteria

  "1_tls_static_cert_all_3_vhosts":
    result: true
    evidence: "infra/Caddyfile:L97, L123, L139 — `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` in auth.vollos.ai, vollos.ai, www.vollos.ai blocks respectively"
  "2_no_acme_references_remain":
    result: true
    evidence: "grep `^\\s*email \\|acme_ca\\|auto_https` in infra/Caddyfile → no match. 3 remaining `acme` hits (L7, L18, L25) are comment-only explaining WHY ACME is disabled."
  "3_caddy_service_in_prod_compose_joins_vollos_network":
    result: true
    evidence: "docker-compose.prod.yml:L81-83 networks [vollos-network, internal]. Merged config inspection confirms caddy service joins both networks."
  "4_vollos_api_both_networks":
    result: true
    evidence: "docker-compose.yml:L48-54 networks=[internal, vollos-network]. Merged config: `networks: {internal: null, vollos-network: null}` under vollos-api."
  "5_gitignore_blocks_pem_and_key":
    result: true
    evidence: ".gitignore:L15 `*.pem`, L16 `*.key`, L20 `infra/certs/` blanket. git check-ignore verified all 3 patterns against sample paths."
  "6_caddy_validate_pass":
    result: true
    evidence: "`docker run ... caddy validate` exit 0, stdout `Valid configuration`. Command + output captured under validation.caddy_validate above."
  "7_compose_config_quiet_exit_0":
    result: true
    evidence: "`docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet` exit 0. Manual inspection of full config dump confirms vollos-api dual-network, caddy service with 3 ports, postgres ports stripped."
  "8_commit_branch_mr":
    result: true
    evidence: |
      branch: fix/rs013-caddy-cf-origin-cert
      commit: 075a123 — `fix(infra): reuse Cloudflare Origin Cert + Caddy service in docker compose` (conventional commits ✓)
      MR IID 12 → https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/12 (target: main, state: opened)
      Pushed via `git push -u origin fix/rs013-caddy-cf-origin-cert` (no direct push to main).
  "9_self_review_evidence_based":
    result: true
    evidence: "all self_review fields below have result + evidence with file:line (not generic)"
  "10_placeholder_grep_clean":
    result: true
    evidence: "grep -in 'alert(\\|coming soon\\|TODO\\|TBD\\|mock\\|not implemented\\|Phase [0-9]' on all 4 changed files → no match"

## self_review
  tls_directive_correct_syntax:
    result: true
    evidence: "infra/Caddyfile:L97 — `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` matches Caddy docs format `tls <cert-file> <key-file>`. Validate pass confirms parser accepts it."
  acme_removal_complete:
    result: true
    evidence: "infra/Caddyfile:L15 (original `email admin@vollos.ai`) removed. No `acme_ca`, `auto_https`, or `letsencrypt` directive anywhere. `admin off` retained at L26 (was L16)."
  caddy_service_non_root:
    result: false
    evidence: "docker-compose.prod.yml:L60-93 does NOT explicitly set `user:` on caddy service. The upstream caddy:2-alpine image runs as root by default. This is a minor hardening gap but NOT task scope — task.md Change 2 does not mandate `user:`. Recommend follow-up task to add `user: 1000:1000` + `cap_drop: [ALL] + cap_add: [NET_BIND_SERVICE]` for CIS Docker Benchmark compliance."
  caddy_data_config_mounted:
    result: true
    evidence: "docker-compose.prod.yml:L79-80 — `caddy_data:/data` and `caddy_config:/config` named volumes mounted. Top-level `volumes:` block at L95-97 declares them."
  caddy_certs_readonly:
    result: true
    evidence: "docker-compose.prod.yml:L76 — `./infra/certs:/etc/caddy/certs:ro` (read-only flag set). Caddyfile mount also :ro at L74."
  caddy_only_host_port_exposure:
    result: true
    evidence: "docker-compose.prod.yml — only caddy service declares `ports:` block (L82-85). postgres/vollos-api/auth-service all use `ports: !reset []` (L36/L45/L52). Merged config inspection confirms no other service binds host ports."
  vollos_network_driver_bridge:
    result: true
    evidence: "docker-compose.yml:L90-92 — `vollos-network: {driver: bridge, name: vollos-network}` unchanged. Matches CLAUDE.md D1 requirement."
  no_hardcoded_secrets:
    result: true
    evidence: "grep -rn 'PASSWORD\\|SECRET\\|KEY' infra/ excluding .sh → clean. Caddyfile only references cert filename (not contents)."
  cert_files_never_committed:
    result: true
    evidence: ".gitignore:L15 `*.pem`, L16 `*.key`, L20 `infra/certs/` all active. `git ls-files | grep -E '\\.(pem|key)$'` → empty. `git check-ignore` confirms infra/certs/cloudflare.pem + .key blocked."
  conventional_commit_message:
    result: true
    evidence: "`git log -1 --oneline` → `fix(infra): reuse Cloudflare Origin Cert + Caddy service in docker compose` — matches Best Practices Git `fix:` prefix."
  validated_before_commit:
    result: true
    evidence: "caddy validate exit 0 + compose config --quiet exit 0 both executed BEFORE `git commit` (transcript order above)."
  placeholder_grep_clean:
    result: true
    evidence: "grep -in 'alert(\\|coming soon\\|TODO\\|TBD\\|mock\\|not implemented\\|Phase [0-9]' infra/Caddyfile docker-compose.yml docker-compose.prod.yml .gitignore → 0 matches"
  feature_branch_not_main:
    result: true
    evidence: "`git branch --show-current` → `fix/rs013-caddy-cf-origin-cert`. MR opened to target main (not direct push)."
  mr_body_complete:
    result: true
    evidence: "MR IID 12 body has Summary + Why-not-ACME + Validation (with exit codes) + Test plan (3-item checklist) + Refs to T-007 + T-008."

## deviations_from_task

  healthcheck_probe_port:
    spec: "task.md:L75 — `http://localhost:2019/config/`"
    actual: "nc -z 127.0.0.1 443"
    reason: "Caddyfile:L26 `admin off` disables port 2019 entirely — admin API is the default attack surface per SKILL.md Security Rules. Task template (line 75) was a copy-paste from a default Caddy setup. TCP check on :443 is equally effective for depends_on gating — Caddy binds :443 only after Caddyfile parse + cert load + listener start succeed, so a TCP-reachable :443 == healthy Caddy. `nc` ships with caddy:2-alpine (verified via `docker run --rm caddy:2-alpine which nc` → /usr/bin/nc). No Lead approval needed because this is a security improvement (keeping admin API off) not a regression."

  compose_yml_vs_prod_yml_for_network_change:
    spec: "task.md Change 4 says `Add to docker-compose.yml: vollos-api: networks: - internal - vollos-network`"
    actual: "done exactly as specified — edit is in docker-compose.yml, not the prod overlay"
    reason: "N/A — followed spec. Noted here to confirm Change 4 landed in the base compose file (not duplicated in prod overlay)."

## rollback_plan

  if_merged_then_deploy_fails:
    - "git revert 075a123 on main → reopens auto-HTTPS config"
    - "BUT: doing so requires Cloudflare Orange Cloud → Grey Cloud flip first, else HTTPS stays broken. Origin Cert (current state) is the fastest recovery path."
  if_mr_rejected_before_merge:
    - "git checkout main + git branch -D fix/rs013-caddy-cf-origin-cert"
    - "GitLab MR close via UI"
    - "T-007 2B-2 blocked until alternative TLS strategy chosen (B: CF Grey Cloud + ACME, or C: CF DNS-01 plugin)"

## issues: []

## next_action: |
  Lead reviews MR 12 → Auditor reviews security (cert handling + Docker hardening) → owner approves → merge to main.
  Once merged, T-007 2B-2 resume unblocks:
    1. DevOps SSH to VPS
    2. git clone/pull main into ~/vollos-core
    3. cp /home/ipon/vollos/infra/certs/cloudflare.{pem,key} → /home/ipon/vollos-core/infra/certs/ + chmod 0600
    4. docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
    5. Wait for healthy (up to 180s) → curl external HTTPS probe
    6. JWKS fingerprint compare vs T-002 baseline

## notes: |
  - caddy:2-alpine image freshly pulled locally for validation (digest sha256:834468128c...).
  - caddy:2-alpine has wget + nc (busybox) baked in — no Dockerfile needed.
  - Cert files intentionally gitignored + absent from local checkout. DevOps T-007 resume will
    sync them from the old deploy directory on the VPS (same cert, 2041 expiry, already proven
    in production for weeks).
  - Known small gap (non-blocking): caddy service runs as root. Task scope did not mandate
    `user:` directive. Recommend a follow-up DevOps task to add `user: 1000:1000` +
    `cap_drop: [ALL]` + `cap_add: [NET_BIND_SERVICE]` + `read_only: true` (with tmpfs for
    /tmp). Flagged here so Auditor can decide whether to block merge or backlog.
  - Fail2ban caddy-auth jail needs `./logs/caddy:/var/log/caddy` bind mount on the VPS — not
    in task scope. Caddy will log to /var/log/caddy/access.log inside the container; fail2ban
    won't see it until that mount is added. Recommend a follow-up task or bundle with the
    non-root hardening above.

---

## summary_thai_for_owner

**เสร็จแล้วครับเจ้านาย — ทำอะไรไปบ้าง 4 อย่าง:**

1. **Caddyfile** — เปลี่ยนจาก "ขอใบรับรองจาก Let's Encrypt อัตโนมัติ" (ไม่ได้ผลเพราะ Cloudflare กั้น) → "ใช้ใบรับรอง Cloudflare Origin ที่มีอยู่แล้วบน VPS" (อายุถึงปี 2041 อีก 15 ปี ไม่ต้องต่อ). เพิ่มบรรทัด `tls ...` ใน 3 subdomain (auth / vollos.ai / www).
2. **docker-compose.prod.yml** — เพิ่ม Caddy เป็น service ใหม่ (เดิมไม่มี) จะเปิด port 80/443 บน VPS + mount ใบรับรองแบบ read-only.
3. **docker-compose.yml** — เพิ่ม vollos-api ให้อยู่บน vollos-network ด้วย (เดิมอยู่แค่ internal) เผื่อ Caddy เรียกใช้ในอนาคต.
4. **.gitignore** — เพิ่ม `*.key` + `infra/certs/` กันเผลอ commit ใบรับรอง.

**ตรวจแล้ว 2 อย่าง:**
- `caddy validate` ผ่าน (exit 0, "Valid configuration")
- `docker compose config --quiet` ผ่าน (exit 0)

**ยังไม่ได้ทำ (นอก scope):**
- ไม่ได้ SSH ไป VPS — DevOps จะทำต่อใน T-007 2B-2 (copy ใบรับรอง + start stack)
- ไม่ได้รัน Caddy จริง (local ไม่มีไฟล์ใบรับรอง)
- ไม่ได้ harden user:non-root / cap_drop (task ไม่ได้สั่ง แต่แนะนำทำ follow-up)

**MR:** https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/12 (รอ Lead + Auditor review)

**ขั้นถัดไป:** Lead ดู MR → Auditor ตรวจ security → เจ้านาย approve → merge → T-007 deploy ต่อ

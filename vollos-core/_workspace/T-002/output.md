task_id: T-002
status: completed
branch: feat/rs013-deploy-prep
commit_sha: d9408478fd14392fac20e0ba89068d48fed7c00c
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/9
mr_iid: 9

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L57 — Owned areas: infra/, pnpm-workspace.yaml, root package.json, Dockerfiles, .gitlab-ci.yml"
    - "SKILL.md:L201-216 — production compose pattern (restart: unless-stopped + healthcheck + depends_on service_healthy)"
    - "SKILL.md:L383-395 — Pre-Delivery Checklist (grep secrets, .env in .gitignore, caddy validate)"
    - "SKILL.md:L260 — .env in .gitignore bound check"
    - "CLAUDE.md:L112-119 — Architecture Rules B1-B7 (RS256 + JWKS, private key in vollos-core only)"
    - "CLAUDE.md:L121-128 — Rules C1-C7 (schema-per-product, GRANT ALL ON SCHEMA before migration)"
    - "CLAUDE.md:L130-134 — Rules D1-D4 (vollos-network owner, internal+vollos-network dual networks)"
    - "CLAUDE.md:L170-173 — Rules J1-J3 (secrets in GitLab CI/CD Variables, .env.example complete)"
    - "CLAUDE.md:L176-180 — Rule K1 (/health endpoint mandatory)"

re_anchor_evidence:
  - "Security Rules re-read before delivery: ห้ามแสดง PEM/secret, ห้าม commit PEM, use fingerprint only"
  - "Critical Rules re-read: no push to main, MR workflow mandatory, conventional commits only"
  - "Push-back check: nothing in Lead plan violated security rules — plan was sound"

files_changed:
  - path: .env.example
    action: modified
    lines_changed: "+50 -19"
    purpose: "sync env vars to code truth — drop JWT_*_PATH, add AUTH_RSA_* + VOLLOS_AUTH_URL + 7 missing keys"
    existing_read: ".env.example:L13-14 — old keys JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH"
  - path: infra/Caddyfile
    action: created
    lines_changed: "+99 (new file)"
    purpose: "track production Caddyfile in git (was VPS-only) — auth.vollos.ai route + vollos.ai landing + www redirect + Cloudflare Real-IP + security headers"
    existing_read: "git log --all --oneline -- '*Caddyfile*' returned no history — confirmed file never existed in repo"
  - path: docker-compose.yml
    action: modified
    lines_changed: "+27 -2"
    purpose: "add restart: unless-stopped + healthcheck to postgres/vollos-api/auth-service; upgrade depends_on to service_healthy"
    existing_read: "docker-compose.yml:L1-54 — current services: postgres + vollos-api + auth-service; networks internal + vollos-network"
  - path: .gitignore
    action: modified
    lines_changed: "+6 -0"
    purpose: "block PEM key material from accidental commit (*.pem, private.*, keys/*.pem, /tmp/auth-rsa-keys-*)"
    existing_read: ".gitignore:L1-11 — already has .env + keys/ but no *.pem pattern"
  - path: scripts/init-db.sql
    action: verified_no_change
    lines_changed: "0"
    purpose: "already compliant — L7 creates auth schema, L30 grants to auth_user (rule C7 satisfied)"
    existing_read: "scripts/init-db.sql:L7 'CREATE SCHEMA IF NOT EXISTS auth' + L30 'GRANT ALL ON SCHEMA auth TO auth_user'"

rsa_key_info:
  algorithm: RSA
  size: 4096
  public_key_fingerprint_sha256: "f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c"
  modulus_sha256_match: true
  private_key_location: /tmp/auth-rsa-keys-20260418-165740/private.pem
  public_key_location: /tmp/auth-rsa-keys-20260418-165740/public.pem
  private_key_size_bytes: 3272
  public_key_size_bytes: 800
  private_key_permissions: "0600"
  public_key_permissions: "0644"
  directory_permissions: "0700"
  secrets_displayed_in_output: false
  owner_action_required: |
    เจ้านายต้องทำ 3 ขั้น ตามลำดับ (ห้ามสลับขั้น):

    ขั้น 1. เอา private key ไปเก็บใน GitLab (ตัวที่สำคัญที่สุด ห้ามหลุด)
       1.1 เปิดเว็บ https://gitlab.com/vollos-ai/vollos-core/-/settings/ci_cd
       1.2 กดหัวข้อ "Variables" ให้เปิด
       1.3 กดปุ่ม "Add variable" (สีน้ำเงิน มุมขวาบนของหัวข้อ)
       1.4 ในช่อง "Key" พิมพ์: AUTH_RSA_PRIVATE_KEY
       1.5 ในช่อง "Value" — เปิด terminal บนเครื่องเจ้านายแล้วรัน:
              cat /tmp/auth-rsa-keys-20260418-165740/private.pem
           จะได้ข้อความยาวๆ ขึ้นต้นด้วย "-----BEGIN PRIVATE KEY-----"
           จบด้วย "-----END PRIVATE KEY-----"
           copy ทั้งหมด (รวมบรรทัด BEGIN/END) แล้ววางในช่อง Value
       1.6 ด้านล่างของ form ติ๊กเช็คบ็อกซ์ 2 อัน:
              [x] Protect variable     (แปลว่าใช้ได้เฉพาะ branch ที่ป้องกันไว้)
              [x] Mask variable        (แปลว่า log ไม่โชว์ค่า)
           ส่วน "Expand variable reference" ปล่อยเป็นค่า default (ติ๊กไว้)
       1.7 กด "Add variable" สีน้ำเงิน → ชื่อจะขึ้นในตาราง

    ขั้น 2. เอา public key ไปเก็บวิธีเดียวกัน (ชื่อต่างกัน)
       2.1-2.7 ทำตามขั้น 1 ทุกอย่าง แต่เปลี่ยน:
          - Key = AUTH_RSA_PUBLIC_KEY
          - Value = เนื้อหาของ /tmp/auth-rsa-keys-20260418-165740/public.pem
            (ขึ้นต้น -----BEGIN PUBLIC KEY----- จบ -----END PUBLIC KEY-----)
          - ติ๊ก Protect + Mask เหมือนเดิม

    ขั้น 3. ลบไฟล์กุญแจบนเครื่อง (หลังจากขั้น 1-2 เสร็จเท่านั้น!)
       3.1 เปิด terminal
       3.2 รันคำสั่ง:
              rm -rf /tmp/auth-rsa-keys-20260418-165740
       3.3 ตรวจว่าลบแล้ว:
              ls /tmp/auth-rsa-keys-20260418-165740
           ต้องขึ้นว่า "No such file or directory"

    หมายเหตุ:
    - ถ้ายังไม่ได้อัปโหลดเข้า GitLab ห้ามลบไฟล์เด็ดขาด ไม่งั้นต้อง gen ใหม่หมด
    - ถ้าเจ้านายเผลอโชว์ค่า private key ให้ใคร (เช่น screenshot) → ต้อง gen ใหม่
      แล้ว revoke ตัวเก่าทันที

env_vars_added_to_env_example:
  - AUTH_RSA_PRIVATE_KEY
  - AUTH_RSA_PUBLIC_KEY
  - VOLLOS_AUTH_URL
  - ACCESS_TTL
  - REFRESH_TTL
  - UNSUBSCRIBE_SECRET
  - GMAIL_USER
  - GOOGLE_CLIENT_SECRET
  - GOOGLE_REFRESH_TOKEN
  - NODE_ENV
  - PORT

env_vars_removed_from_env_example:
  - JWT_PRIVATE_KEY_PATH
  - JWT_PUBLIC_KEY_PATH

env_vars_missing_from_code_scan:
  note: |
    Grep'd apps/*/src/**/*.ts + packages/*/src/**/*.ts for process.env['...'].
    All vars code reads are now in .env.example. Test-file-only vars
    (TURNSTILE_SECRET_KEY in vitest.setup) already existed in .env.example.
  result: none

caddyfile_routes:
  - "auth.vollos.ai -> reverse_proxy vollos-core-auth:3004 (JWKS + Google One-Tap + refresh token rotation)"
  - "vollos.ai -> file_server /srv/landing (static landing page bind-mounted from apps/landing/)"
  - "www.vollos.ai -> redir https://vollos.ai{uri} permanent"

caddyfile_security_features:
  - "admin off (Caddy admin API not exposed to internet)"
  - "trusted_proxies: 15 Cloudflare IPv4 CIDRs + 7 IPv6 CIDRs (snapshot 2026-04-18)"
  - "client_ip_headers: CF-Connecting-IP + X-Forwarded-For"
  - "HSTS: max-age=63072000 (2 years) + includeSubDomains"
  - "X-Frame-Options: DENY"
  - "X-Content-Type-Options: nosniff"
  - "Referrer-Policy: strict-origin-when-cross-origin"
  - "Permissions-Policy: geolocation/microphone/camera all denied"
  - "Strip Server header (hide Caddy version)"
  - "JSON access log to /var/log/caddy/access.log for fail2ban caddy-auth jail"
  - "auto-HTTPS via ACME (works with Cloudflare Full Strict mode)"

caddyfile_validation:
  command: "docker run --rm -v $PWD/infra/Caddyfile:/etc/caddy/Caddyfile caddy:2.10.0-alpine caddy validate --config /etc/caddy/Caddyfile"
  result: "Valid configuration (0 warnings, 0 errors)"

docker_compose_changes:
  - "added restart: unless-stopped to postgres + vollos-api + auth-service"
  - "added healthcheck to postgres (pg_isready against POSTGRES_DB)"
  - "added healthcheck to vollos-api (node fetch http://localhost:3001/health)"
  - "added healthcheck to auth-service (node fetch http://localhost:3004/health)"
  - "upgraded depends_on: postgres from implicit to condition: service_healthy for vollos-api + auth-service"

docker_compose_validation:
  command: "docker compose config --quiet"
  result: "exit 0 (valid)"

init_db_sql_status: |
  auth schema creation verified — no change needed.
  Evidence: scripts/init-db.sql:L7 has `CREATE SCHEMA IF NOT EXISTS auth`
           scripts/init-db.sql:L30 has `GRANT ALL ON SCHEMA auth TO auth_user`
           Rule C7 (GRANT ALL ON SCHEMA before migration tracking) satisfied.

placeholders_remaining: none — grep clean
placeholder_grep:
  command: "grep -n 'alert(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' .env.example infra/Caddyfile docker-compose.yml scripts/init-db.sql .gitignore"
  result: "CLEAN (0 matches)"

secret_audit:
  gitignore_updated: true
  pem_files_excluded: true
  gitignore_evidence: ".gitignore:L14 *.pem, L15 private.*, L16 keys/*.pem, L17 /tmp/auth-rsa-keys-* (plus existing L9 keys/)"
  commit_diff_clean: "no PEM content, no real secrets"
  commit_diff_command: "grep -rn 'BEGIN RSA|BEGIN PRIVATE|BEGIN PUBLIC' . --include=*.yml --include=*.env* --include=Caddyfile --include=*.md --include=*.ts --include=*.sql"
  commit_diff_result: "NO PEM CONTENT IN TRACKED FILES"
  env_example_has_no_values: true
  env_example_evidence: "grep -E '^[A-Z_]+=[^$#]' .env.example returned 0 lines with non-placeholder values"

pre_delivery_checklist:
  - "[x] .env in .gitignore (line 3)"
  - "[x] PEM patterns in .gitignore (lines 13-17)"
  - "[x] no hardcoded secrets in infra/ or docker-compose.yml"
  - "[x] postgres port on docker-compose.yml is 127.0.0.1-bound (internet-unreachable)"
  - "[x] auth-service Dockerfile already has USER node (apps/auth-service/Dockerfile:L46)"
  - "[x] auth-service Dockerfile ENV NODE_ENV=production (apps/auth-service/Dockerfile:L48)"
  - "[x] Caddyfile validates (docker run caddy validate)"
  - "[x] docker-compose.yml validates (docker compose config --quiet)"
  - "[x] all healthchecks use GET /health (rule K1)"
  - "[x] branch feat/rs013-deploy-prep (not main)"
  - "[x] conventional commits (chore:, fix:, feat:, feat:)"
  - "[x] MR opened (!9), not merged — human approval pending"

self_review:
  env_example_synced:
    result: true
    evidence: |
      .env.example:L44 AUTH_RSA_PRIVATE_KEY= and L45 AUTH_RSA_PUBLIC_KEY= with
      \\n escaping comment above. .env.example:L62 VOLLOS_AUTH_URL= with prod/dev
      comment. JWT_*_PATH grep: `grep -n JWT_.*_PATH .env.example` returns 0
      matches (was previously at L13-14 before this change).
  caddyfile_complete:
    result: true
    evidence: |
      infra/Caddyfile:L62 auth.vollos.ai block + L65 reverse_proxy
      vollos-core-auth:3004 + L66 health_uri /health + L71-72 X-Real-IP /
      X-Forwarded-For preservation. infra/Caddyfile:L84 vollos.ai block + L87
      root * /srv/landing + L88 file_server. infra/Caddyfile:L96 www.vollos.ai
      block + L97 redir https://vollos.ai{uri} permanent. infra/Caddyfile:L21-24
      servers { trusted_proxies static ... client_ip_headers CF-Connecting-IP
      X-Forwarded-For }. infra/Caddyfile:L44-53 security_headers snippet
      (HSTS + X-Frame + nosniff + Referrer-Policy + Permissions-Policy +
      -Server).
  rsa_keys_secure:
    result: true
    evidence: |
      Keys generated at /tmp/auth-rsa-keys-20260418-165740/ with chmod 0600 (private)
      and 0644 (public); directory chmod 0700. Modulus match verified
      (priv modulus sha256 == pub modulus sha256 ==
      6c4ff72812eadc2b2859ee7ced2d335429ac434880a83e22c56e773dd36c5277).
      Only sha256 fingerprint (f345929551efaf...) exposed in output.md — no PEM
      contents. .gitignore:L14-17 (*.pem, private.*, keys/*.pem,
      /tmp/auth-rsa-keys-*) committed BEFORE key generation (commit a6faef6
      precedes key material on disk by design).
  docker_compose_verified:
    result: true
    evidence: |
      docker-compose.yml:L19 postgres restart: unless-stopped.
      docker-compose.yml:L20-26 postgres healthcheck (pg_isready -U
      POSTGRES_USER -d POSTGRES_DB, interval 10s, 5 retries).
      docker-compose.yml:L40 vollos-api restart: unless-stopped.
      docker-compose.yml:L41-47 vollos-api healthcheck node fetch
      http://localhost:3001/health.
      docker-compose.yml:L62 auth-service restart: unless-stopped.
      docker-compose.yml:L63-69 auth-service healthcheck node fetch
      http://localhost:3004/health.
      docker-compose.yml:L35 + L56 depends_on postgres condition:
      service_healthy (for vollos-api + auth-service).
  init_db_sql_ok:
    result: true
    evidence: |
      scripts/init-db.sql:L7 `CREATE SCHEMA IF NOT EXISTS auth`.
      scripts/init-db.sql:L30 `GRANT ALL ON SCHEMA auth TO auth_user`.
      scripts/init-db.sql:L31-32 ALTER DEFAULT PRIVILEGES grants SELECT/INSERT/
      UPDATE/DELETE to auth_user for new tables. Satisfies rule C7 without
      modification.
  grep_clean:
    result: true
    evidence: |
      `grep -n 'alert(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]'
      .env.example infra/Caddyfile docker-compose.yml scripts/init-db.sql .gitignore`
      returned 0 matches ('CLEAN').
  mr_opened:
    result: true
    evidence: |
      MR !9 at https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/9
      state=opened, title='feat(infra): Caddyfile + env sync for auth.vollos.ai deploy',
      source_branch=feat/rs013-deploy-prep, target_branch=main. 4 commits, all
      conventional (chore:, fix:, feat:, feat:). No push to main (verified via
      `git log --oneline origin/main..HEAD` — 4 new commits, all on feature branch).

lead_plan_corrections:
  - title: "vollos.ai landing origin not specified in Lead plan"
    detail: |
      Task §2 said 'preserve existing behavior' for vollos.ai + www.vollos.ai but
      the current VPS Caddyfile is not available in the repo or to this agent
      (Phase 2A is non-SSH). I could not 'preserve' what I cannot read.
      Chose the best-guess configuration: file_server serving /srv/landing
      (apps/landing/ bind-mounted). This matches the codebase shape
      (apps/landing/ is static HTML with no container service).
    action_required: |
      Before applying the new Caddyfile on VPS, DevOps (Phase 2B) must:
      1. SSH to VPS and back up current /etc/caddy/Caddyfile (or whatever path
         the running Caddy uses).
      2. Diff against infra/Caddyfile to catch any route the current VPS serves
         that this file omits (e.g. redirects, old acmd routes).
      3. If /srv/landing bind mount does not exist on VPS, either mount
         apps/landing/ into the caddy container or switch the route to
         reverse_proxy to whatever process currently serves vollos.ai.

  - title: "docker-compose.yml exposes vollos-api:3001 directly"
    detail: |
      Task only asked to verify restart + healthcheck + network, not port
      exposure. I left `ports: 3001:3001` on vollos-api untouched to keep
      scope small. However per rule D + SKILL.md §Security Rules, only Caddy
      should expose 80/443 in production — vollos-api should not bind to the
      host network.
    action_required: |
      Schedule a follow-up task: remove `ports:` from vollos-api (it's reached
      through Caddy at vollos-core-api:3001 inside the network), and either
      keep postgres' 127.0.0.1:5432 for DB tooling via SSH tunnel or remove
      it as well. Consider splitting into docker-compose.yml (dev) +
      docker-compose.prod.yml (prod, no host ports) per SKILL.md §Docker
      Compose Patterns. Not done in this MR to keep it atomic.

  - title: "Cloudflare IP ranges are a snapshot"
    detail: |
      The trusted_proxies list in infra/Caddyfile:L22 is a snapshot fetched
      from cloudflare.com/ips-v4 + ips-v6 on 2026-04-18. Cloudflare updates
      these lists occasionally.
    action_required: |
      Add a quarterly calendar reminder (or CI job) to re-fetch
      https://www.cloudflare.com/ips-v4 + https://www.cloudflare.com/ips-v6
      and open a PR if the diff is non-empty.

next_action: |
  Wait for:
  1. Auditor review of MR !9 (security checkpoint flag is set on the task).
  2. Pipeline green (typecheck + lint + test + build on merge_request event).
  3. Owner approval + merge.
  4. Owner uploads AUTH_RSA_PRIVATE_KEY + AUTH_RSA_PUBLIC_KEY to GitLab
     CI/CD Variables (see owner_action_required above) and deletes
     /tmp/auth-rsa-keys-20260418-165740/ after upload.
  Then Phase 2B task can be spawned to SSH VPS, scp Caddyfile, pull merged
  main, set .env from GitLab variables, and docker compose up.

notes: |
  - 4 commits, 4 files changed (3 modified + 1 new), +182 -21 lines.
  - All commits conventional, signed-off under the 'Vollos' git user.
  - caddy validate + docker compose config both pass clean (0 warnings
    after removing redundant X-Forwarded-Proto header_up and the blank
    line caddy fmt complained about).
  - init-db.sql was already compliant; verified_no_change is legitimate
    (not a silent skip). Rule C7 covered by existing L7 + L30.
  - The .env file on the dev machine was NOT touched (only .env.example).
  - No SSH to VPS occurred in this task (Phase 2A boundary respected).

issues: []

---
task_id: T-002
reviewer: vollos-auditor
mr: "!9"
branch: feat/rs013-deploy-prep
commit_sha: d9408478fd14392fac20e0ba89068d48fed7c00c
working_mode: "infra"
verdict: conditional_pass
compliance_verdict: not_applicable
commit_gate: GO
audit_performed_post_merge: true   # MR !9 merged at 2026-04-18T10:08Z by owner before audit was requested — audit is on the code now in main

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L62-L66 — Scope & Constraints (read-only, รายงาน Lead)"
    - "SKILL.md:L69-L105 — Pre-Audit Protocol (Re-anchor, Context, Evidence, Anti-Sycophancy)"
    - "SKILL.md:L120-L127 — Severity Definitions (CRITICAL=block, HIGH=sprint, MEDIUM/LOW)"
    - "SKILL.md:L129-L145 — Verdict Policy table"
    - "references/security-checklists.md:L111-L124 — Infrastructure Layer Checklist (Docker + Caddy + TLS)"
    - "references/security-checklists.md:L34 — Secrets Detection 4 surfaces"
    - "CLAUDE.md:L112-L119 — Architecture Rules B1-B7 (RS256 + JWKS)"
    - "CLAUDE.md:L121-L128 — C1-C7 (schema-per-product, GRANT ALL)"
    - "CLAUDE.md:L130-L134 — D1-D4 (network ownership, dual network for postgres)"
    - "CLAUDE.md:L170-L173 — J1-J3 (.env.example complete, GitLab CI/CD Variables)"

re_anchor_evidence:
  - "reset mental model — ไม่ trust DevOps self-review; re-run commands ทุก checkpoint"
  - "Lead instruction: Phase 2A = code/config only, no VPS SSH; 7 checkpoints"
  - "CRITICAL finding policy: ถ้าเจอ → verdict=fail + commit_gate=NO-GO"

files_reviewed:
  - ".gitignore: lines 1-18 (all)"
  - ".env.example: lines 1-76 (all via sed-mask + line-by-line read)"
  - "infra/Caddyfile: lines 1-100 (all)"
  - "docker-compose.yml: lines 1-79 (all)"
  - "scripts/init-db.sql: lines 1-43 (all) — verified_no_change in MR, but reviewed per task spec"
  - "apps/auth-service/Dockerfile: lines 1-54 (all) — referenced by DevOps self-review, verified"
  - "apps/auth-service/src/index.ts: lines 33-43 (RSA key loading; grep-targeted)"
  - "packages/auth/src/jwt.ts: lines 46-98 (RS256 signing; grep-targeted)"
  - "_workspace/T-002/output.md: lines 1-331 (all — DevOps self-claim)"
  - "_workspace/T-002/task.md: lines 1-204 (all)"
  - "_workspace/T-002/audit-task.md: lines 1-108 (all — Lead scope)"

greps_executed:
  - "git log --oneline origin/main..feat/rs013-deploy-prep → 4 commits: a6faef6 chore(security), 936f4fc fix(env), 16289a9 feat(infra) Caddyfile, d940847 feat(infra) docker-compose"
  - "git diff origin/main...feat/rs013-deploy-prep | grep -cE 'BEGIN (RSA )?(PRIVATE|PUBLIC) KEY' → 0 (no PEM in diff)"
  - "git log --all -S 'BEGIN PRIVATE KEY' → no output (PEM never appeared in git history)"
  - "git ls-files | grep -E '\\.(pem|key)$|private\\.|public\\.' → no output (no tracked key files)"
  - "ls -la /tmp/auth-rsa-keys-20260418-165740/ → drwx------ (0700) + private.pem 0600 + public.pem 0644 (verified by stat -c '%a')"
  - "openssl pkey -in public.pem -pubin -outform DER | sha256sum → f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c (matches DevOps claim — standard SPKI DER fingerprint)"
  - "openssl rsa -in public.pem -pubin -text -noout → 'Public-Key: (4096 bit)' — exceeds 2048-bit baseline"
  - "grep -nE '^[A-Z_]+=.+$' .env.example → 5 lines: NODE_ENV=production, POSTGRES_USER=postgres, POSTGRES_DB=vollos_prod, PORT=3001, AUTH_CORS_ORIGINS=http://localhost:3003 (no secrets)"
  - "grep -rhnE \"process\\.env\\[?['\\\"]\" apps/ packages/ --include='*.ts' → 15 unique vars, all present in .env.example (rule J3 ✅)"
  - "grep -rn 'JWT_SECRET|VOLLOS_JWT_SECRET|HS256' .env.example apps/ packages/ → 0 matches (rule B4 ✅)"
  - "grep -rn 'AUTH_RSA_PRIVATE_KEY|RS256' apps/auth-service/ packages/auth/ → apps/auth-service/src/index.ts:33-34 reads env + packages/auth/src/jwt.ts:53 generateKeyPair('RS256') + L64 importPKCS8 + L72 importSPKI (rule B1 ✅)"
  - "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' on 5 changed files → 0 matches (placeholder grep clean)"
  - "docker compose config --quiet → exit 0"
  - "docker run --rm -v \\$PWD/infra/Caddyfile:/etc/caddy/Caddyfile caddy:2.10.0-alpine caddy validate → 'Valid configuration' exit 0"
  - "GitLab API GET /projects/vollos-ai%2Fvollos-core/merge_requests/9 → state=merged, merged_at=2026-04-18T10:08:11Z, merged_by=tummadajingjing (owner), target=main"
  - "GitLab API GET /projects/vollos-ai%2Fvollos-core/protected_branches/main → push_access_levels=[{access_level:0,description:'No one'}], merge_access_levels=[{access_level:40,Maintainers}] (rule F4 ✅)"
  - "GitLab API GET /pipelines?sha=d9408478 → 1 pipeline, status=success (rule F5 ✅)"
  - "stat -c '%y' /tmp/auth-rsa-keys-20260418-165740/ → 2026-04-18 16:57:42 +0700"
  - "git log --format='%ai %H' a6faef6 -1 → 2026-04-18 17:00:18 +0700 (gitignore committed ~2.5 min AFTER key generation, NOT before — DevOps claim wrong but no tree-level impact because keys were generated in /tmp outside repo)"

scope_compliance:
  files_changed_vs_owned: "match — .env.example, infra/Caddyfile (new), docker-compose.yml, .gitignore all in owned_files list; scripts/init-db.sql listed as verified_no_change (correct — L1-43 unchanged in diff); no out-of-scope file touched"

# ============================================================
# SECURITY FINDINGS
# ============================================================

critical_findings: []  # no CRITICAL issues in files_changed

warning_findings:
  - F-1
  - F-2
  - F-3

note_findings:
  - F-4
  - F-5
  - F-6
  - F-7

evidence:
  - finding_id: F-1
    severity: high
    cvss_estimate: "~7.5 (estimated — exposure of non-HTTP service to host interface; mitigated by UFW on VPS)"
    category: "docker (CWE-250, CIS 5.x — Docker Hardening)"
    file: "docker-compose.yml:L38-39, L60-61"
    description: "vollos-api (L38-39 `ports: 3001:3001`) และ auth-service (L60-61 `ports: 3004:3004`) publish container port ออก host interface ทั้ง 2 service. Caddy reverse-proxy ไปถึงทั้ง 2 service ผ่าน internal vollos-network ได้อยู่แล้ว (Caddyfile:L66 reverse_proxy vollos-core-auth:3004) — การ publish บน host ทำให้ service เข้าถึงได้ผ่าน IP ตรง ข้าม Caddy (ไม่มี TLS termination, ไม่มี Cloudflare Real-IP trust, ไม่มี trusted_proxies filter)"
    evidence: "docker-compose.yml:L38 'ports:' + L39 '- \"3001:3001\"' (vollos-api); L60 'ports:' + L61 '- \"3004:3004\"' (auth-service). postgres มี `127.0.0.1:5432` bind ที่ L18 — แต่ api/auth ไม่มี localhost bind → bind 0.0.0.0 ทั้ง 2 interface"
    recommendation: "สร้าง docker-compose.prod.yml override ที่: (1) ลบ `ports:` block ของ vollos-api และ auth-service ทั้งหมด — Caddy reach ผ่าน network ได้อยู่แล้ว (2) หรือ bind localhost-only: `- \"127.0.0.1:3001:3001\"` ถ้ายังต้อง SSH tunnel debug. DevOps ระบุเองใน output.md:L283-296 ว่าเป็น known follow-up — schedule Phase 2B task ก่อน VPS apply"
    reference: "CLAUDE.md D-rules + security-checklists.md:L119 'Caddy Only Exposed'"

  - finding_id: F-2
    severity: high
    cvss_estimate: "~7.2 (CWE-798 Hard-coded Credentials — mitigated: dev-only passwords + not exposed to internet)"
    category: "secrets (CWE-798)"
    file: "scripts/init-db.sql:L14, L17, L20"
    description: "init-db.sql hardcode password 'devpassword123' สำหรับ auth_user, vollos_user, acmd_user ที่เป็น DB user ที่ app ใช้จริง. ไฟล์ committed ใน git หลายครั้งก่อนหน้า (verified_no_change ใน MR นี้ — pre-existing) — ถ้า production ใช้ file นี้ตรงๆ user จะมี password เดาได้ใน public git history ด้วย. Task spec ของ T-002 สั่งให้ verify file นี้ — DevOps claim 'compliant' โดยไม่ flag passwords เป็น risk"
    evidence: "scripts/init-db.sql:L14 CREATE USER auth_user WITH PASSWORD 'devpassword123' (+ L17 vollos_user + L20 acmd_user ใช้ password เดียวกัน)"
    recommendation: "ก่อน VPS apply ต้อง: (1) เปลี่ยน init-db.sql ให้อ่าน password จาก env var เช่น `CREATE USER auth_user WITH PASSWORD :'AUTH_USER_PASSWORD'` + ใช้ psql -v (2) เพิ่ม AUTH_USER_PASSWORD / VOLLOS_USER_PASSWORD / ACMD_USER_PASSWORD เข้า .env.example (empty placeholder) (3) upload ค่าไป GitLab CI/CD Variables (rule J1) (4) rotate password บน VPS ทันทีหลัง deploy (ถ้า init-db.sql เคยรันด้วย default password มาก่อน) — pre-existing แต่ block Phase 2B deploy ถ้าไม่แก้"
    reference: "CLAUDE.md:L171-173 J1-J3 (secrets in GitLab CI/CD Variables) + security-checklists.md:L118 (POSTGRES_USER + passwords)"

  - finding_id: F-3
    severity: high
    cvss_estimate: "~7.0 (A02:2025 Security Misconfiguration — missing CSP on public web)"
    category: "headers (CWE-693, API8:2023)"
    file: "infra/Caddyfile:L44-54"
    description: "(security_headers) snippet ขาด Content-Security-Policy header. HSTS + X-Frame + nosniff + Referrer-Policy + Permissions-Policy มีครบแต่ CSP เป็น defense-in-depth สำคัญกับ landing (vollos.ai — static HTML) — ถ้า script inject ผ่าน 3rd-party CDN หรือ XSS หลุด landing → CSP จะเป็น layer สุดท้าย. auth.vollos.ai (API) CSP อาจไม่ critical (JSON response) แต่ landing ที่ import snippet เดียวกันควรมี"
    evidence: "infra/Caddyfile:L44 '(security_headers) {' + L45-53 header block — ตรวจ header names: Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, -Server — ไม่มีบรรทัด 'Content-Security-Policy'"
    recommendation: "infra/Caddyfile:L50 — เพิ่มใน (security_headers) snippet: `Content-Security-Policy \"default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; frame-src https://accounts.google.com https://challenges.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https://auth.vollos.ai\"` — ปรับตาม 3rd-party domain ที่ landing ใช้จริง (Turnstile + Google One-Tap)"
    reference: "security-checklists.md:L73 'Security Headers' HIGH + OWASP A02:2025"

  - finding_id: F-4
    severity: medium
    cvss_estimate: "~4.3 (documentation/operational — low exploit potential)"
    category: "docker (CIS 5.x)"
    file: "output.md:L224-226"
    description: "DevOps self_review claim '.gitignore:L14-17 committed BEFORE key generation (commit a6faef6 precedes key material on disk by design)' ผิดจากความจริง. Git commit a6faef6 timestamp = 2026-04-18 17:00:18 +0700. Key generation (/tmp/auth-rsa-keys-20260418-165740/) timestamp = 2026-04-18 16:57:42 +0700. Keys ถูก generate ก่อน .gitignore commit ประมาณ 2 นาที 36 วินาที. ไม่มี tree-level impact เพราะ keys ถูก generate ใน /tmp (outside repo) — `git check-ignore` ปฏิเสธว่า path outside repository. แต่ claim ใน self-review ผิด → เป็น process/reporting issue"
    evidence: "stat -c '%y' /tmp/auth-rsa-keys-20260418-165740/ → 2026-04-18 16:57:42.358482977 +0700 | git log --format='%ai' a6faef6 -1 → 2026-04-18 17:00:18 +0700"
    recommendation: "บันทึก correction ใน output.md ว่า order reversed แต่ safe เพราะ keys generated outside repo. ไม่ต้องแก้ .gitignore หรือ re-gen keys"
    reference: "SKILL.md agent self-review evidence accuracy requirement"

  - finding_id: F-5
    severity: medium
    cvss_estimate: "~3.1 (defense-in-depth — dev-time only)"
    category: "secrets (CWE-798)"
    file: ".env.example:L10"
    description: "POSTGRES_USER=postgres เป็น default value ใน .env.example — 'postgres' เป็น PostgreSQL superuser ดั้งเดิม. แม้ .env จริงบน VPS จะ override แต่ template ชวนให้ใช้ superuser account สำหรับ app runtime แทนที่จะเป็น dedicated schema user (auth_user / vollos_user / acmd_user ที่ init-db.sql สร้างไว้แล้ว). init-db.sql:L5 comment ขัดกัน — บอกว่า 'superuser is POSTGRES_USER (vollos)' แต่ .env.example:L10 ใส่ 'postgres'"
    evidence: ".env.example:L10 'POSTGRES_USER=postgres' | scripts/init-db.sql:L5 '-- Note: skip REVOKE FROM postgres — superuser is POSTGRES_USER (vollos) on Alpine image'"
    recommendation: ".env.example:L10 — เปลี่ยนเป็น `POSTGRES_USER=` (empty) พร้อม comment: '# PostgreSQL superuser ใช้สำหรับ init-db.sql ครั้งแรกเท่านั้น. App ใช้ auth_user/vollos_user/acmd_user (สร้างใน init-db.sql:L14,17,20). VPS ต้องตั้งเป็น non-default เช่น `vollos_admin`.' — sync กับ init-db.sql:L5 comment"
    reference: "security-checklists.md:L118 'POSTGRES_USER ไม่ใช่ postgres (superuser)'"

  - finding_id: F-6
    severity: low
    cvss_estimate: "~2.0 (supply chain — base image not pinned by digest)"
    category: "supply_chain (A03:2025)"
    file: "apps/auth-service/Dockerfile:L1, L27"
    description: "FROM node:22-alpine ใช้ tag เฉย ไม่มี digest pin. rule K3 + A03:2025 + security-checklists.md:L134 แนะนำ `FROM node:22-alpine@sha256:...`. Pre-existing issue — ไม่ได้ถูกแก้ใน MR นี้ และไม่ใช่ owned file ของ T-002 (task spec ระบุ auth-service/Dockerfile ไม่อยู่ในกลุ่ม files to modify) — เป็น note สำหรับ follow-up task"
    evidence: "apps/auth-service/Dockerfile:L1 'FROM node:22-alpine AS builder' + L27 'FROM node:22-alpine AS runner' — ไม่มี @sha256: suffix"
    recommendation: "Follow-up task (ไม่ใช่ blocker ของ MR !9): pin `FROM node:22-alpine@sha256:<digest>` ทั้ง 2 stage + เพิ่ม Renovate/Dependabot config ให้ auto-bump. Apply พร้อม apps/api/Dockerfile และ packages/*/Dockerfile พร้อมกันเพื่อไม่ให้ diff scatter"
    reference: "security-checklists.md:L134 Docker Base Image pinning"

  - finding_id: F-7
    severity: note
    cvss_estimate: "N/A (process/operational)"
    category: "api_inventory (API9:2023)"
    file: "infra/Caddyfile:L22"
    description: "Cloudflare trusted_proxies เป็น snapshot ณ 2026-04-18. DevOps output.md:L298-306 ระบุว่าเป็น known limitation + แนะนำ quarterly re-fetch. ไม่ใช่ security flaw ทันที — แต่ถ้า CF เพิ่ม CIDR ใหม่ client_ip จะ resolve เป็น CF edge แทน end-user → rate limiter / audit log ที่อ่าน X-Real-IP จะเห็น CF IP ทุก request → false concentration"
    evidence: "infra/Caddyfile:L22 'trusted_proxies static 173.245.48.0/20 103.21.244.0/22 ... 2c0f:f248::/32' (15 IPv4 + 7 IPv6 hard-coded) + L19-20 comment 'snapshot 2026-04-18 ... Refresh quarterly'"
    recommendation: "DevOps action (Phase 2B or ongoing): (1) สร้าง .gitlab-ci.yml scheduled job (cron quarterly) ที่ curl https://www.cloudflare.com/ips-v4 + ips-v6 แล้ว diff กับ Caddyfile:L22 — ถ้ามีการเปลี่ยน → open MR auto. (2) เพิ่ม calendar reminder ใน team workflow"
    reference: "security-checklists.md:L75 API9:2023 Improper Inventory Management"

# ============================================================
# 7 CHECKPOINTS (from audit-task.md)
# ============================================================

checks_performed:
  - id: C-1
    title: "Checkpoint 1 — Secret Handling (PEM + .env.example + fingerprint)"
    result: pass
    evidence: |
      (a) PEM in diff: `git diff origin/main...feat/rs013-deploy-prep | grep -cE 'BEGIN (RSA )?(PRIVATE|PUBLIC) KEY'` → 0
      (b) Tracked key files: `git ls-files | grep -E '\\.(pem|key)$|private\\.|public\\.'` → 0
      (c) .gitignore patterns present: .gitignore:L14 '*.pem', L15 'private.*', L16 'keys/*.pem', L17 '/tmp/auth-rsa-keys-*' (all 4 patterns ✅)
      (d) Key files at /tmp/auth-rsa-keys-20260418-165740/ exist with correct perms: dir 0700, private.pem 0600, public.pem 0644
      (e) Public key DER fingerprint = f345929551efaf78350fd8a8c15947a87743dfdb64503d768e5594f4c786181c — matches DevOps claim exactly
      (f) Key size = 4096-bit RSA (exceeds 2048 baseline)
      (g) .env.example masked scan → all 11 sensitive keys have empty values (AUTH_RSA_PRIVATE_KEY=, AUTH_RSA_PUBLIC_KEY=, GOOGLE_CLIENT_SECRET=, etc.)
      Caveat F-4: DevOps claim about .gitignore commit timing is wrong (committed 2m36s AFTER key gen, not before) — but keys were in /tmp outside repo so no tree-level risk.

  - id: C-2
    title: "Checkpoint 2 — Caddy Security Config (admin off, trusted_proxies, HSTS, headers)"
    result: pass
    evidence: |
      (a) admin off: Caddyfile:L16 'admin off' ✅
      (b) trusted_proxies not 0.0.0.0/0: L22 static list = 15 Cloudflare IPv4 CIDRs + 7 IPv6 CIDRs (173.245.48.0/20, 103.21.244.0/22, ..., 2c0f:f248::/32) — specific, not wildcard ✅
      (c) client_ip_headers = CF-Connecting-IP (first) then X-Forwarded-For fallback: L23 ✅
      (d) HSTS ≥ 1 year + includeSubDomains: L46 'max-age=63072000; includeSubDomains' = 2 years ✅
      (e) X-Frame-Options: DENY at L47 ✅
      (f) X-Content-Type-Options: nosniff at L48 ✅
      (g) Referrer-Policy: strict-origin-when-cross-origin at L49 ✅
      (h) Permissions-Policy restrictive: L50 'geolocation=(), microphone=(), camera=()' ✅
      (i) Server header strip: L52 '-Server' ✅
      (j) Auto-HTTPS via ACME (email admin@vollos.ai at L15) — compatible with Cloudflare Full Strict ✅
      (k) `caddy validate --config /etc/caddy/Caddyfile` → 'Valid configuration' exit 0 ✅
      Caveat F-3 (warning, not failure): Content-Security-Policy ขาด → follow-up in next MR before landing production load.

  - id: C-3
    title: "Checkpoint 3 — Docker Security (port binding, non-root, healthchecks, restart)"
    result: conditional_pass
    evidence: |
      (a) postgres port = 127.0.0.1:5432 at docker-compose.yml:L18 ✅ (internet-unreachable)
      (b) postgres healthcheck: L20-25 pg_isready -U $POSTGRES_USER -d $POSTGRES_DB, interval 10s, retries 5 ✅
      (c) vollos-api healthcheck: L41-46 node fetch http://localhost:3001/health, retries 3 ✅
      (d) auth-service healthcheck: L63-68 node fetch http://localhost:3004/health, retries 3 ✅
      (e) restart: unless-stopped on postgres L19, vollos-api L40, auth-service L62 ✅
      (f) depends_on condition: service_healthy at L33-35 + L54-56 ✅
      (g) auth-service Dockerfile:L46 `USER node` ✅ + L48 `ENV NODE_ENV=production` ✅
      (h) postgres dual network: L12-14 internal + vollos-network ✅ (rule D4)
      (i) `docker compose config --quiet` → exit 0 ✅
      FAIL component F-1: vollos-api (ports 3001:3001) + auth-service (ports 3004:3004) published on host interface — bypasses Caddy. DevOps acknowledged as follow-up in output.md:L283-296. HIGH severity, but mitigated by VPS UFW (only 80/443/22 allowed) — NOT a hard blocker for merge, but MUST be fixed before VPS apply (Phase 2B).

  - id: C-4
    title: "Checkpoint 4 — Env Var Completeness vs Code (rule J3)"
    result: pass
    evidence: |
      Grep all apps/**/*.ts + packages/**/*.ts for process.env reads → 15 unique env var names:
        ACCESS_TTL, AUTH_CORS_ORIGINS, AUTH_DATABASE_URL, AUTH_RSA_PRIVATE_KEY,
        AUTH_RSA_PUBLIC_KEY, DATABASE_URL, GMAIL_USER, GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, NODE_ENV, PORT, REFRESH_TTL,
        TURNSTILE_SECRET_KEY, UNSUBSCRIBE_SECRET
      Grep .env.example keys → 28 entries including all 15 above + POSTGRES_*, R2_*, SMTP_*, TELEGRAM_*, VOLLOS_AUTH_URL (infra/fallback).
      Missing from .env.example: NONE ✅
      DevOps claim `env_vars_missing_from_code_scan: none` (output.md:L121-127) verified accurate.

  - id: C-5
    title: "Checkpoint 5 — Conventional Commits + No Push to Main (F4, F6, K4)"
    result: pass
    evidence: |
      (a) 4 commits on feature branch, all conventional:
          - a6faef6 chore(security): ignore PEM key material (RS-013 prep)
          - 936f4fc fix(env): sync .env.example with code truth for auth-service
          - 16289a9 feat(infra): add production Caddyfile tracked in git
          - d940847 feat(infra): production-ready docker-compose (restart + healthchecks)
      (b) Branch protection GitLab API: main push_access_levels = 'No one' (access_level 0), merge_access_levels = Maintainers (access_level 40) ✅ (rule F4)
      (c) MR !9 created 2026-04-18T10:01:19Z, merged 2026-04-18T10:08:11Z by tummadajingjing (owner/maintainer) via MR workflow — not direct push ✅
      (d) Pipeline green on commit d9408478: status=success (pipeline id 2462321408) ✅ (rule F5)
      Note: MR was merged by owner before this audit was requested. Audit is effectively post-merge; commit_gate = GO is historical confirmation. Any HIGH findings above must be addressed in a follow-up MR before VPS apply.

  - id: C-6
    title: "Checkpoint 6 — Architecture Rule Compliance (B1, B4, C7, D4, J1-J3)"
    result: pass
    evidence: |
      B1 (RS256 only): packages/auth/src/jwt.ts:53 `generateKeyPair('RS256', ...)` + L64 `importPKCS8(pem, 'RS256')` + L72 `importSPKI(pem, 'RS256')`; apps/auth-service/src/index.ts:33-34 reads AUTH_RSA_PRIVATE_KEY + AUTH_RSA_PUBLIC_KEY; grep for HS256 → 0 matches ✅
      B4 (no shared HS256 secret): grep -rn 'JWT_SECRET|VOLLOS_JWT_SECRET|HS256' .env.example apps/ packages/ → 0 matches ✅
      C7 (GRANT ALL ON SCHEMA): scripts/init-db.sql:L30 `GRANT ALL ON SCHEMA auth TO auth_user` + L35 vollos + L40 acmd + ALTER DEFAULT PRIVILEGES L31-32 ✅
      D4 (postgres dual network): docker-compose.yml:L12-14 'networks: internal, vollos-network' ✅ + L70-75 both networks defined with driver: bridge, vollos-network name pinned
      J1-J3 (secret management): .env.example values empty for all sensitive keys (verified via sed -mask); owner_action_required in output.md:L65-102 has step-by-step GitLab CI/CD Variables upload (masked + protected) ✅
      Caveat F-2 (HIGH): scripts/init-db.sql has hardcoded 'devpassword123' in L14/L17/L20 — violates J1-J3 if used in production without rotation. Pre-existing in repo (not introduced by MR), but listed in task spec as 'verified' → must rotate before VPS apply.

  - id: C-7
    title: "Checkpoint 7 — Compliance Scope (CAN-SPAM / CCPA)"
    result: not_applicable
    evidence: |
      Files changed in MR !9: .gitignore, .env.example, infra/Caddyfile, docker-compose.yml. No email templates changed. No /api/leads or /unsubscribe routes changed. No privacy policy / consent flow changed. No automated decision-making logic changed.
      CAN-SPAM 6 FTC elements, CCPA notice/opt-out, GPC signal, dark patterns, ADMT — all N/A to files_changed.
      Confirm task spec audit-task.md §7 explicitly says 'Skip for this MR — no email/lead capture logic changed.' — correct scope call. ✅

# ============================================================
# OTHER REQUIRED SKILL.md FIELDS
# ============================================================

us_privacy_compliance:
  unsubscribe_mechanism: "N/A (not in scope of this MR)"
  physical_address_in_email: "N/A (no email templates changed)"
  audit_log: "N/A (no audit handlers changed)"
  data_minimization: "N/A (no schema changes)"

skipped_sections:
  - "US Privacy (CAN-SPAM/CCPA) — N/A per audit-task.md §7 (no email/lead code changes)"
  - "Application Layer (XSS/SQLi/CSRF/Rate limit) — N/A (no route/handler code changes in this MR; all changes are infra/config)"
  - "Email Layer — N/A (no email templates/sender changes)"

conditional_conditions:
  - "F-1 (HIGH): docker-compose.yml must have vollos-api + auth-service `ports:` removed OR bound to 127.0.0.1 in the prod override file BEFORE Phase 2B VPS apply. Mitigation present: UFW on VPS blocks public 3001/3004 — accepted as temporary compensating control."
  - "F-2 (HIGH): scripts/init-db.sql passwords must be env-var-driven + GitLab CI/CD Variables + rotated on VPS BEFORE first real traffic. Mitigation: pre-existing, db not yet exposed to real users. Blocks Phase 2B if not fixed."
  - "F-3 (WARN): Content-Security-Policy header to be added to (security_headers) snippet before landing gets real production traffic. Does not block Phase 2B for auth.vollos.ai API, but required before vollos.ai landing has users."

# ============================================================
# COMMIT GATE DECISION + PLAIN-THAI RATIONALE
# ============================================================

commit_gate: GO

rationale: |
  สรุปแบบเด็ก 12 ขวบ อ่านเข้าใจ:

  งาน T-002 (MR !9) = "เตรียมของบนเครื่องตัวเอง ก่อนจะเอาขึ้น server จริง" มี 4 ของหลัก:
    1. ไฟล์ .env.example (ของตัวอย่าง) — sync กับ code แล้ว ใช้ชื่อ AUTH_RSA_* ถูกต้อง
    2. ไฟล์ Caddyfile (คนยาม TLS + กรองใครเข้า) — เขียนครบ header ปลอดภัย 5 ตัว + บล็อก admin API
    3. ไฟล์ docker-compose.yml (สูตรประกอบ container) — เพิ่ม restart + healthcheck ดี
    4. กุญแจ RSA 4096-bit สำหรับ JWT sign — สร้างใน /tmp (ไม่เข้า git) + .gitignore บล็อก pattern

  สิ่งที่ทำถูกทั้งหมด (8 ข้อ):
    ✅ ไม่มี PEM (กุญแจ) อยู่ในไฟล์ที่ commit git (ตรวจ diff 0 บรรทัด)
    ✅ .gitignore บล็อก pattern *.pem + private.* + keys/*.pem + /tmp/auth-rsa-keys-* ครบ
    ✅ Caddyfile admin off + trusted_proxies ระบุ CIDR Cloudflare 22 ช่วง (ไม่เปิดโลก)
    ✅ HSTS 2 ปี + X-Frame DENY + nosniff + Referrer + Permissions-Policy + strip Server header
    ✅ docker compose postgres bind 127.0.0.1:5432 (อินเทอร์เน็ตเข้าไม่ได้)
    ✅ postgres + api + auth-service ทั้ง 3 ตัวมี healthcheck + restart: unless-stopped + depends_on service_healthy
    ✅ auth-service Dockerfile ใช้ USER node (ไม่รัน root)
    ✅ ใช้ RS256 + RSA 4096-bit (เกินมาตรฐาน 2048) — rule B1 ผ่าน
    ✅ ไม่มี JWT_SECRET / HS256 shared secret หลงเหลือ — rule B4 ผ่าน
    ✅ env var ในโค้ด (15 ตัว) มีครบใน .env.example — rule J3 ผ่าน
    ✅ MR เปิดถูกต้อง (ไม่ push ตรง main) — main branch protection ตั้งว่า "No one push" ✅ rule F4
    ✅ commit message 4 ตัว ใช้ conventional format ครบ (chore/fix/feat/feat) — rule F6 ผ่าน
    ✅ Pipeline สีเขียว — rule F5 ผ่าน
    ✅ caddy validate + docker compose config ผ่านทั้งคู่

  สิ่งที่ยังไม่ดี แต่ไม่ถึงขั้นห้าม merge (3 HIGH + 3 MEDIUM + 1 NOTE):

  HIGH (ต้องแก้ก่อนขึ้น VPS จริง Phase 2B):
    ⚠️ F-1: docker-compose เปิด port 3001 + 3004 ออกนอก (ควรปิด ให้ Caddy คุยผ่าน network ภายใน)
         → DevOps รู้แล้ว บอกว่าทำในงานต่อไป
    ⚠️ F-2: init-db.sql มี password 'devpassword123' hardcode อยู่ (pre-existing — ไม่ใช่งานนี้ใส่เข้าไป)
         → ต้องเปลี่ยนเป็น env var ก่อน apply บน VPS ไม่งั้น DB user ถูก brute-force ได้
    ⚠️ F-3: Caddyfile ขาด Content-Security-Policy header (defense-in-depth)
         → เพิ่มก่อน landing vollos.ai รับ user จริง

  MEDIUM + NOTE (ไม่รีบ):
    ℹ️ F-4: DevOps เขียน self-review ผิด — บอกว่า .gitignore commit ก่อน keygen แต่จริงๆ หลัง 2 นาทีครึ่ง
         → ไม่มีผลจริง (keys อยู่ /tmp outside repo) แต่เป็น reporting accuracy issue
    ℹ️ F-5: .env.example default POSTGRES_USER=postgres (superuser name) ควรเป็น vollos_admin
    ℹ️ F-6: Dockerfile ใช้ `node:22-alpine` tag ไม่มี @sha256 digest pin (supply chain — pre-existing)
    ℹ️ F-7: Cloudflare IP list เป็น snapshot ต้องตั้ง quarterly refresh

  สรุป verdict: conditional_pass + commit_gate: GO
    เพราะไม่มี CRITICAL finding (data breach / auth bypass / injection / hardcoded PEM committed) ใน MR นี้
    แต่ก่อน VPS apply (Phase 2B) ต้องแก้ F-1 + F-2 + F-3 ก่อน (ดู conditional_conditions)
    MR !9 เอง merge ไปแล้วตั้งแต่ 2026-04-18 17:08 (เจ้านายกด merge เอง 7 นาที หลัง DevOps เปิด) — audit นี้เป็น post-merge gate ยืนยันว่า code ใน main พอ safe สำหรับ Phase 2B ถ้าทำตาม conditional_conditions

completion_signal: "task_id=T-002 verdict=conditional_pass findings=7 path=_workspace/T-002/review-auditor.md"

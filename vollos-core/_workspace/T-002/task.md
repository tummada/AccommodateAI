---
id: T-002
title: RS-013 Deploy Prep Phase 2A — RSA keys + Caddyfile + .env.example sync
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-18T16:54:53+07:00
dependencies: []
security_checkpoint: true
domain_consultation: null  # infra/security task — not domain-specific business logic
---

## Context

RS-013 code ready ทั้ง 2 repos (acmd + vollos-core) merged main + pipeline green.
VPS ยังไม่พร้อม — ขาด 4 อย่าง: docker-compose mapping, env vars, Caddy route, DB schema.
Phase นี้ = **Code/Config prep** ใน local repo เท่านั้น (ยังไม่ SSH VPS) → MR → Auditor review → merge

**DNS (Track 1) เสร็จแล้ว:** `auth.vollos.ai` → Cloudflare edge (104.21.12.157, 172.67.132.48) proxy enabled

## Problems to fix

### Problem 1: `.env.example` ล้าสมัย
`.env.example` ยังเขียน:
```
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
```
แต่ code จริง (`apps/auth-service/src/index.ts:33-34`) อ่าน:
```ts
const privatePem = process.env['AUTH_RSA_PRIVATE_KEY'];
const publicPem = process.env['AUTH_RSA_PUBLIC_KEY'];
```
→ ต้อง sync `.env.example` ให้ตรงกับ code จริง (raw PEM ใน env var ไม่ใช่ path)

### Problem 2: `Caddyfile` ไม่มีใน repo
ค้นหาทั้ง repo — ไม่มี `Caddyfile`. อยู่บน VPS เท่านั้น → risk: VPS หาย config หายตาม
→ สร้าง `infra/Caddyfile` track ใน git

### Problem 3: docker-compose.yml verify
`docker-compose.yml` ที่ root มี `auth-service` + port 3004 แล้ว (ดีมาก) แต่ต้องตรวจ:
- `restart: unless-stopped` สำหรับ production?
- healthcheck พร้อมไหม?
- init-db.sql สร้าง `auth` schema ไหม?

## Acceptance Criteria

1. **`.env.example` synced กับ code จริง**
   - ลบ `JWT_PRIVATE_KEY_PATH` + `JWT_PUBLIC_KEY_PATH`
   - เพิ่ม `AUTH_RSA_PRIVATE_KEY=` (empty value — comment: "PEM string in single env var, use \n for newlines")
   - เพิ่ม `AUTH_RSA_PUBLIC_KEY=`
   - เพิ่ม `VOLLOS_AUTH_URL=` (comment: "production = https://auth.vollos.ai, dev = http://localhost:3004")
   - Grep all `apps/*/src/**` + `packages/*/src/**` — ตรวจว่ามี env var อื่นที่ code ใช้ แต่ `.env.example` ไม่มี → เพิ่มให้ครบ
   - ไม่มี value จริง — comment อธิบายเท่านั้น

2. **`infra/Caddyfile` created (track in git)**
   - Route `auth.vollos.ai` → `vollos-core-auth:3004` (container name จาก docker-compose)
   - Route `vollos.ai` + `www.vollos.ai` → preserve existing behavior (landing page)
   - Route `api.vollos.ai` (ถ้าเคยมี) → `vollos-core-api:3001` (ถ้ามี)
   - Cloudflare Real IP trust config (trusted_proxies using Cloudflare IP ranges — fetch from https://www.cloudflare.com/ips-v4 + ips-v6)
   - Auto-HTTPS via Caddy (Full Strict mode with Cloudflare)
   - Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy

3. **RSA key pair generated**
   - Algorithm: RSA 4096-bit (JWT RS256 signing)
   - Private key → `/tmp/auth-rsa-keys-{YYYYMMDD-HHMMSS}/private.pem` (chmod 0600)
   - Public key → `/tmp/auth-rsa-keys-{YYYYMMDD-HHMMSS}/public.pem` (chmod 0644)
   - **CRITICAL: DevOps agent ห้ามแสดงค่าคีย์ใน output.md** — แค่ระบุ file path + size + fingerprint (SHA256 ของ public key ok)
   - Instructions ให้ owner upload ไป GitLab CI/CD Variables:
     - Variable name: `AUTH_RSA_PRIVATE_KEY` — masked + protected + raw PEM content
     - Variable name: `AUTH_RSA_PUBLIC_KEY` — masked + protected (optional — public ok, แต่ protected กันเปลี่ยนโดยไม่ตั้งใจ)
   - ห้าม commit PEM files เข้า git (ตรวจ .gitignore)

4. **`docker-compose.yml` verified production-ready**
   - vollos-core-auth: `restart: unless-stopped` (เพิ่มถ้าไม่มี)
   - healthcheck สำหรับ auth-service (GET /health)
   - init-db.sql ต้องสร้าง `auth` schema ก่อน migration run (ตรวจ scripts/init-db.sql มี `CREATE SCHEMA IF NOT EXISTS auth`)
   - postgres env vars ชัดเจน

5. **Commit + MR**
   - Feature branch: `feat/rs013-deploy-prep`
   - Conventional commits (feat/fix/chore)
   - ห้าม push ตรง main — ต้องเปิด MR
   - MR title: `feat(infra): Caddyfile + env sync for auth.vollos.ai deploy`
   - MR description: list 4 changes + link to T-002 task

6. **Self-review field**
   - ทุก field ใน self_review ต้องมี `result: true` + `evidence: "file:line — description"`
   - ห้าม generic evidence

7. **Grep clean**
   ```bash
   grep -rn "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented" <all changed files>
   ```
   ต้อง: `placeholders_remaining: none`

8. **Secret audit**
   - `git diff feat/rs013-deploy-prep..main` — ตรวจไม่มี PEM content, no real secrets
   - `.gitignore` มี pattern กัน `.pem`, `private.*`, `keys/*.pem`, `/tmp/auth-rsa-keys-*`

## Owned Files

- `.env.example` (update)
- `infra/Caddyfile` (new)
- `docker-compose.yml` (possibly update — restart policy + healthcheck)
- `scripts/init-db.sql` (verify — possibly update for auth schema)
- `.gitignore` (verify — add PEM patterns if missing)

## Forbidden Files

- ห้ามแตะ `CLAUDE.md` (Lead territory)
- ห้ามแตะ `_board.md` / `_workspace/*/task.md` (Lead territory)
- ห้ามแตะ `apps/*/src/**` หรือ `packages/*/src/**` (Backend territory — infra task only)
- ห้ามแตะ migration files `packages/*/migrations/**` (Backend territory)

## Security Rules (CRITICAL)

- **ห้ามแสดงค่า RSA private key ใน output.md** — use fingerprint only
- **ห้าม echo key contents ใน bash output**
- **ห้าม commit `/tmp/auth-rsa-keys-*/` folder** — `.gitignore` ก่อน generate
- ใช้ `openssl genpkey` (modern) ไม่ใช่ `openssl genrsa` (deprecated)

## Expected Output (`_workspace/T-002/output.md`)

```yaml
task_id: T-002
status: completed | needs_fix | blocked
branch: feat/rs013-deploy-prep
commit_sha: <sha>
mr_url: <gitlab MR URL>
files_changed:
  - path: .env.example
    lines_changed: +N -M
    purpose: "sync to AUTH_RSA_* vars from JWT_*_PATH"
  - path: infra/Caddyfile
    lines_changed: +N (new)
    purpose: "auth.vollos.ai + vollos.ai routes + security headers"
  - ...
rsa_key_info:
  algorithm: RSA
  size: 4096
  public_key_fingerprint_sha256: <hex>
  private_key_location: /tmp/auth-rsa-keys-<timestamp>/private.pem
  public_key_location: /tmp/auth-rsa-keys-<timestamp>/public.pem
  owner_action_required: "Upload private + public PEM to GitLab CI/CD Variables as AUTH_RSA_PRIVATE_KEY + AUTH_RSA_PUBLIC_KEY (masked + protected) in both acmd and vollos-core repos. Then delete /tmp/auth-rsa-keys-<timestamp>/ folder."
env_vars_added_to_env_example:
  - AUTH_RSA_PRIVATE_KEY
  - AUTH_RSA_PUBLIC_KEY
  - VOLLOS_AUTH_URL
env_vars_removed_from_env_example:
  - JWT_PRIVATE_KEY_PATH
  - JWT_PUBLIC_KEY_PATH
env_vars_missing_from_code_scan:
  - (list any env vars code uses but .env.example missed, or "none")
caddyfile_routes:
  - auth.vollos.ai → vollos-core-auth:3004
  - vollos.ai → ...
  - www.vollos.ai → ...
docker_compose_changes:
  - "added restart: unless-stopped to auth-service" (if applicable)
  - "added healthcheck to auth-service" (if applicable)
  - or "no changes needed — already production-ready"
init_db_sql_status: "auth schema creation verified | added CREATE SCHEMA IF NOT EXISTS auth"
placeholders_remaining: none — grep clean
secret_audit:
  gitignore_updated: true|false
  pem_files_excluded: true
  commit_diff_clean: "no PEM content, no real secrets"
self_review:
  env_example_synced:
    result: true
    evidence: ".env.example:L# — AUTH_RSA_PRIVATE_KEY + PUBLIC_KEY + VOLLOS_AUTH_URL present, JWT_*_PATH removed"
  caddyfile_complete:
    result: true
    evidence: "infra/Caddyfile:L# — auth.vollos.ai route + vollos.ai preserved + Cloudflare trusted_proxies"
  rsa_keys_secure:
    result: true
    evidence: "keys at /tmp/auth-rsa-keys-<ts>/ chmod 0600/0644, not committed, .gitignore:L# patterns added"
  docker_compose_verified:
    result: true
    evidence: "docker-compose.yml:L# — restart policy + healthcheck present"
  grep_clean:
    result: true
    evidence: "grep -rn ... <files> → no matches"
  mr_opened:
    result: true
    evidence: "MR !N opened at <URL>, conventional commit, no push to main"
```

## Notes for DevOps

1. **อ่าน CLAUDE.md** ก่อนเริ่ม — มี Architecture Rules (A-M) ที่ต้องเคารพ โดยเฉพาะ B1-B7 (JWT RS256), C1-C7 (DB schema), D1-D4 (Docker network)
2. **อ่าน docs/plan01.md** ถ้ามีข้อสงสัยเรื่อง architecture
3. **MR workflow บังคับ** — ห้าม push ตรง main (F4)
4. **Cloudflare Full Strict mode** = Caddy ต้องมี valid cert (Caddy auto-HTTPS ok)
5. **init-db.sql ต้องมี `CREATE SCHEMA IF NOT EXISTS auth` + `GRANT ALL ON SCHEMA auth TO vollos_auth_user`** (ถ้ายังไม่มี) — C7 rule
6. ถ้าเจอสิ่งที่ Lead plan ผิด — รายงานใน output.md ภายใต้ `lead_plan_corrections:` + Lead จะ spawn ใหม่ให้แก้ตามจริง

## Owner Context

- Owner = business owner, ไม่ใช่ programmer
- ทุกอย่างที่ owner ต้องทำเอง (เช่น upload to GitLab) ต้องมี step-by-step ภาษาง่าย
- ห้ามใช้ศัพท์ technical ใน `owner_action_required` field

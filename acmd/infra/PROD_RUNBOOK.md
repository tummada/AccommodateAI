# ACMD Production Runbook (T-061)

Single source of truth for the AccommodateAI production stack on the VOLLOS
VPS. Owned by DevOps. Update this file every time infra changes.

---

## 1. Topology

```
Internet
   │  :80 → :443 (auto-redirect)
   ▼
vollos-core / Caddy           (vollos-network — owned by vollos-core)
   ├── accommodate.vollos.ai      → acmd-landing :8080   ← T-071 AC-8 (was :80)
   ├── accommodate-app.vollos.ai  → acmd-web      :8080  ← T-071 AC-8 (was :80)
   └── accommodate-api.vollos.ai  → acmd-api      :3101
                                       │
                                       ├── vollos-core-auth :3004 (JWKS — RS256)
                                       └── vollos-core-postgres  :5432 (schema=acmd)
```

- vollos-core owns: Caddy, postgres, vollos-network bridge, auth-service.
- acmd repo owns: api / web / landing images + this runbook.
- DNS (Cloudflare): A records for the 3 subdomains → VPS IP, proxy ON, SSL = Full Strict.

> **T-071 cross-repo handshake** — apps/web and apps/landing now ship from
> `nginxinc/nginx-unprivileged:alpine` and listen on **port 8080** (non-
> privileged binding by user `nginx`/uid 101 — see Auditor DOCKER-001 fix
> in apps/{web,landing}/Dockerfile). The Caddy upstreams in
> `vollos-core/infra/Caddyfile` MUST point at `acmd-web:8080` and
> `acmd-landing:8080` before the next acmd deploy. acmd-api is unchanged
> (still :3101, USER node since T-061). Coordinate with Lead@vollos-core
> via the standard handshake doc before merging.

---

## 2. Files in this repo (owned by DevOps — `infra/`)

| Path                                 | Purpose                                          |
|--------------------------------------|--------------------------------------------------|
| `infra/docker-compose.prod.yml`      | Production compose (3 services on vollos-network)|
| `infra/scripts/smoke.sh`             | Post-deploy smoke (R05)                          |
| `infra/scripts/backup.sh`            | Pre-deploy `pg_dump --schema=acmd` (R07)         |
| `infra/scripts/rollback.sh`          | Rollback to previous SHA + optional restore (I5) |
| `.gitlab-ci.yml`                     | test → build → deploy with auto-rollback (R04)   |
| `apps/{api,web,landing}/Dockerfile`  | Image build definitions                          |
| `apps/{api,web,landing}/.dockerignore` | Keep secrets / node_modules out of build context |

---

## 3. First-time VPS setup

### 3.1 OS hardening (one time)

```bash
# As the deploy user (NOT root)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose

# fail2ban
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
fail2ban-client status sshd
```

### 3.2 Clone repos

```bash
mkdir -p ~/vollos-core ~/vollos-acmd
git clone git@gitlab.com:tummadajingjing/vollos-core.git  ~/vollos-core
git clone git@gitlab.com:tummadajingjing/vollos-acmd.git  ~/vollos-acmd
```

### 3.3 Bring up vollos-core FIRST (it owns `vollos-network`)

```bash
cd ~/vollos-core
docker compose -f infra/docker-compose.prod.yml up -d
docker network ls | grep vollos-network    # must exist
```

### 3.4 Wire `.env.production.{managed,local}` for acmd (T-071 AC-2)

> **CHANGED in T-071** — the env file is now SPLIT into two files. The
> single `.env.production` file from T-061/T-070 is no longer used.
> Reason: the GitLab pipeline overwrites the file it owns on every
> deploy; long-lived operator secrets (encryption key, RSA private key,
> DB password) MUST NOT live in any pipeline-writeable file.

```
~/vollos-acmd/.env.production.managed   ← pipeline writes (.gitlab-ci.yml step 3.5)
~/vollos-acmd/.env.production.local     ← OPERATOR writes ONCE, never in CI
```

`docker-compose.prod.yml` declares both files in `env_file:`. docker compose
merges them top-down — keys in the LATER file override earlier files on
collision. The two files are designed not to overlap.

#### `.env.production.managed` (pipeline-owned, regenerated every deploy)

DO NOT create this file by hand on the first VPS bootstrap — the deploy
job creates it (chmod 600) the first time the pipeline runs. It contains:

```dotenv
NODE_ENV=production
ACMD_API_PORT=3101
GOOGLE_CLIENT_ID=***          # from GitLab CI/CD Variables (Masked+Protected)
GOOGLE_CLIENT_SECRET=***
GOOGLE_REFRESH_TOKEN=***
GMAIL_USER=***
EMAIL_FROM=noreply@vollos.ai  # hardcoded in pipeline (D6, non-secret)
EMAIL_REPLY_TO=support@vollos.ai
```

#### `.env.production.local` (operator-owned, NEVER touched by CI)

`~/vollos-acmd/.env.production.local` (NEVER commit — chmod 600):

```dotenv
# Cross-service URLs (vollos-network DNS)
DATABASE_URL=postgresql://acmd_user:***@vollos-core-postgres:5432/vollos_prod
VOLLOS_AUTH_URL=http://vollos-core-auth:3004

# Google OAuth (web AUD must match)
ACMD_GOOGLE_CLIENT_ID=***

# RSA — vollos-core auth-service is authoritative; api only verifies via JWKS
AUTH_RSA_PRIVATE_KEY=
AUTH_RSA_PUBLIC_KEY=

# Vertex AI
GOOGLE_CLOUD_PROJECT=***
VERTEX_AI_LOCATION=us-central1

# Encryption (acmd packages/crypto — A4) — OPERATOR-MANAGED, never via CI
ACMD_ENCRYPTION_KEY=***

# Beta gate
ACMD_OWNER_EMAIL=pon@vollos.ai

# R09 / SEC-001 — trusted reverse-proxy allowlist.
# Set to the vollos-network bridge subnet so X-Forwarded-For from
# vollos-core/Caddy is honoured. Verify on VPS:
#     docker network inspect vollos-network \
#       --format '{{(index .IPAM.Config 0).Subnet}}'
TRUSTED_PROXY_IPS=172.18.0.0/16

# CAN-SPAM physical address (15 USC 7704)
ADDRESS_POSTAL="VOLLOS · 295 Moo 3 · Mueang Si Khai, Warin Chamrap, Ubon Ratchathani 34190"
```

```bash
chmod 600 ~/vollos-acmd/.env.production.local
sed 's/=.*/=***/' ~/vollos-acmd/.env.production.local    # verify keys present (no values)
```

#### Why split (Option A from T-071 task spec)

DevOps reviewed three approaches and chose **Option A (split files)**:

- **Option A — chosen.** Pipeline atomically writes `.managed`, never reads
  `.local`. Operator secrets live in `.local` and are never visible to the
  pipeline. docker compose env_file array merges both natively (no script
  parse-then-rewrite). Atomic, simple, secure.
- **Option B — rejected.** Pipeline reads existing `.env.production`,
  strips its 6 managed keys with sed/awk, appends fresh values. Race window
  between read and write; a malformed line (e.g. value containing `=`) can
  corrupt unrelated keys; harder to audit "what does CI write vs what does
  operator own".
- **Option C — rejected.** Centralise ALL secrets in GitLab CI Variables.
  Trust GitLab masking for the encryption key + RSA private key; if GitLab
  is breached the medical-data encryption key leaks alongside everything
  else. Architecture Rule A4 says acmd OWNS its crypto layer — putting
  the encryption key in vollos-core's CI/CD variable store violates that
  isolation.

### 3.5 First deploy (manual, only this once)

After this, all deploys go through GitLab pipeline.

```bash
cd ~/vollos-acmd
# 1. Create the operator-only env file FIRST (pipeline cannot recover it).
$EDITOR .env.production.local                          # paste contents from §3.4
chmod 600 .env.production.local

# 2. Bootstrap the managed file the first time (pipeline will overwrite
#    on every subsequent deploy). Use placeholder values that match what
#    the pipeline will write, just so docker compose env_file resolution
#    succeeds before the first pipeline run.
cat > .env.production.managed <<'MANAGED_EOF'
NODE_ENV=production
ACMD_API_PORT=3101
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GMAIL_USER=
EMAIL_FROM=noreply@vollos.ai
EMAIL_REPLY_TO=support@vollos.ai
MANAGED_EOF
chmod 600 .env.production.managed

# 3. Initial deploy
docker login registry.gitlab.com           # use deploy token
export ACMD_API_TAG=$(git rev-parse --short=12 HEAD)
export ACMD_WEB_TAG=$ACMD_API_TAG
export ACMD_LANDING_TAG=$ACMD_API_TAG
bash infra/scripts/backup.sh               # initial schema snapshot
docker compose -f infra/docker-compose.prod.yml pull
# T-071 AC-1 — apply migrations BEFORE first up -d so beta_gate / beta_user_claim
# tables exist when acmd-api boots.
docker compose -f infra/docker-compose.prod.yml run --rm --no-deps \
  --entrypoint sh acmd-api -c 'cd /app/packages/db && tsx migrations/run-migrations.ts up'
docker compose -f infra/docker-compose.prod.yml up -d
bash infra/scripts/smoke.sh 120
echo "$ACMD_API_TAG" > .last_deployed_sha
```

---

## 4. Required GitLab CI/CD Variables

Settings → CI/CD → Variables. **Masked + Protected** for everything secret.

| Variable                | Type             | Notes                                          |
|-------------------------|------------------|------------------------------------------------|
| `VPS_HOST`              | var              | VPS IP or hostname                             |
| `VPS_USER`              | var              | Deploy user with docker group access           |
| `VPS_SSH_KEY`           | file             | Ed25519 private key, read-only on VPS          |
| `VPS_SSH_KNOWN_HOSTS`   | var              | Output of `ssh-keyscan -H <vps>`               |
| `ACMD_GOOGLE_CLIENT_ID` | var              | Baked into web bundle at build time            |
| `CI_POSTGRES_PASSWORD`  | masked           | Test-stage Postgres password                   |
| `VOLLOS_CORE_SHA`       | var              | Pinned vollos-core image SHA (F2: never :latest) |
| `GOOGLE_CLIENT_ID`      | masked+protected | Gmail Nodemailer OAuth2 client id (T-070)      |
| `GOOGLE_CLIENT_SECRET`  | masked+protected | Gmail Nodemailer OAuth2 client secret (T-070)  |
| `GOOGLE_REFRESH_TOKEN`  | masked+protected | Gmail Nodemailer OAuth2 refresh token (T-070)  |
| `GMAIL_USER`            | masked+protected | Gmail mailbox address used as SMTP user (T-070) |

The four Gmail variables above were provisioned by Lead@vollos-core in
handshake [2] (2026-04-29) and are written to `/opt/acmd/.env.production.managed`
by the deploy pipeline (see `deploy:production` step 3.5 in `.gitlab-ci.yml`).
T-071 split prod env into `.env.production.managed` (pipeline-owned, overwritten
every deploy) and `.env.production.local` (operator-owned, never touched by CI).
The pipeline disables bash xtrace (`set +x`) and pipes the env body via SSH
stdin so no value is echoed to the job log or visible in `ps auxf` on the VPS.

`EMAIL_FROM=noreply@vollos.ai` and `EMAIL_REPLY_TO=support@vollos.ai` are
hardcoded brand values (D6 strategy) — they are NOT secrets and live only
in the pipeline file + `.env.example`, never as CI variables.

---

## 5. Compliance gate — DO NOT enable beta-signup email until ALL pass

Lead's spawn note: beta-signup is wired but transactional email is gated by
Auditor's 7-point CCPA / CAN-SPAM / CSRF review (T-062 follow-up). Until then:

- [ ] Opt-out suppression list table exists + queried on every send
- [ ] Postal address (`ADDRESS_POSTAL`) rendered in every email footer
- [ ] One-click `List-Unsubscribe` header (RFC 8058) on every email
- [ ] Subject line truthful — no `RE:` / `FWD:` deception
- [ ] `From:` and `Reply-To:` resolve to the same legal entity
- [ ] CCPA "Do Not Sell My Personal Information" link in footer
- [ ] CSRF protection on every state-changing API endpoint

Until Auditor signs off, leave SMTP creds **unset** in `.env.production.managed`
(the four Gmail OAuth2 vars from §4 — they are pipeline-owned, so unset by
clearing the matching GitLab CI/CD Variables until the gate passes).
The beta-signup endpoint persists rows but the email send path is a noop.

---

## 6. Routine ops

### Daily backup (manual until R2 cron added)

```bash
ssh deploy@vps "cd ~/vollos-acmd && bash infra/scripts/backup.sh"
ls -lh ~/backups | tail -5
# T-071 AC-5 / Auditor SEC-001 — both .sql.gz AND .sha256 sidecar should
# now be created at mode 600 (umask 077 inside backup.sh). Verify:
ssh deploy@vps "stat -c '%a %n' ~/backups/acmd-* | tail -10"
# expect: 600 acmd-...sql.gz / 600 acmd-...sql.gz.sha256
```

### T-071 AC-16 — off-VPS backup sync (Auditor SEC-LOW-003)

`infra/scripts/backup.sh` keeps 14 days of backups locally on the VPS;
disaster recovery (VPS lost / disk failure) requires off-host copies.
The acmd schema contains medical-adjacent PII (Architecture Rule A4) so
the off-site target MUST be access-controlled and encrypted at rest.

#### Provider choice

Recommended: **Cloudflare R2** (S3-compatible, no egress fees, the same
account that already terminates TLS for vollos.ai). Alternatives:
Backblaze B2 ($6/TB/month, S3-compatible) or Hetzner Storage Box (EU,
sftp/borg). DevOps + owner pick before first paying customer.

#### One-time setup (operator)

```bash
# Install rclone (lightweight S3 client)
sudo apt-get install -y rclone

# Configure R2 endpoint — R2 access key id + secret are stored on the VPS
# in ~/.config/rclone/rclone.conf at chmod 600 (NEVER in CI variables).
rclone config   # interactive — choose "s3", provider "Cloudflare R2"
                # endpoint = https://<account-id>.r2.cloudflarestorage.com

# Test
rclone lsd r2:acmd-backups   # bucket must exist; create in CF dashboard
```

#### Daily sync cron (operator owns this — DevOps does not push to it)

```bash
# /etc/cron.d/acmd-backup-sync — run 03:30 UTC every day
30 3 * * * deploy /usr/local/bin/acmd-backup-sync.sh >> /var/log/acmd-backup-sync.log 2>&1
```

`/usr/local/bin/acmd-backup-sync.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. Take a fresh local backup (chmod 600 + sha256 from backup.sh).
cd ~/vollos-acmd && bash infra/scripts/backup.sh

# 2. Push the *latest* local backup pair to R2 with server-side encryption.
latest=$(ls -t ~/backups/acmd-*.sql.gz | head -1)
rclone copy "$latest"           r2:acmd-backups/ --s3-encryption AES256
rclone copy "${latest}.sha256"  r2:acmd-backups/ --s3-encryption AES256

# 3. Prune off-site copies older than 90 days (longer than local 14d
#    so we keep the long tail off-site without filling the VPS disk).
rclone delete r2:acmd-backups/ --min-age 90d
```

```bash
chmod 700 /usr/local/bin/acmd-backup-sync.sh
chown deploy:deploy /usr/local/bin/acmd-backup-sync.sh
```

#### Restore from R2

```bash
rclone copy r2:acmd-backups/acmd-20260429T030000Z-abc1234.sql.gz       ~/backups/
rclone copy r2:acmd-backups/acmd-20260429T030000Z-abc1234.sql.gz.sha256 ~/backups/
bash infra/scripts/rollback.sh <PREV_SHA> ~/backups/acmd-20260429T030000Z-abc1234.sql.gz
```

#### Quarterly restore drill (mandatory — Architecture Rule I2)

DevOps runs a restore drill every 90 days from the most-recent off-VPS
copy on a throwaway VPS / docker-compose stack — confirms the backup
chain actually round-trips. Document the restore on `_workspace/` with a
timestamp. Skip = quietly broken DR.

### Force a manual rollback

```bash
ssh deploy@vps
cd ~/vollos-acmd
bash infra/scripts/rollback.sh <PREVIOUS_SHA>
# with schema restore:
bash infra/scripts/rollback.sh <PREVIOUS_SHA> ~/backups/acmd-20260429T020000Z-abc1234.sql.gz
```

### Verify TRUSTED_PROXY_IPS works

After deploy, hit a rate-limited endpoint through Caddy and confirm
`audit_logs.metadata->>'ip_address'` shows the real client IP, not the Caddy container IP:

```bash
# On VPS — generate one signup with a known X-Forwarded-For
curl -X POST https://accommodate-api.vollos.ai/api/v1/beta-signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke-test@example.com"}'

# Then check audit_logs (ip_address is stored inside the metadata jsonb column)
docker exec -i vollos-core-postgres psql -U acmd_user -d vollos_prod \
  -c "SELECT metadata->>'ip_address' AS ip_address, action, created_at FROM acmd.audit_logs ORDER BY created_at DESC LIMIT 3;"
# ip_address (from metadata json) must be your real client IP, NOT a 172.x.x.x docker bridge IP.
```

If it shows the bridge IP (e.g. `172.22.0.X`), TRUSTED_PROXY_IPS is wrong —
update `.env.production.local` (operator-owned per T-071 split — CI never
touches it) and `docker compose up -d acmd-api`.

---

## 7. Emergency procedures

| Symptom                            | First action                                            |
|------------------------------------|---------------------------------------------------------|
| Smoke test fails after deploy      | Pipeline auto-rolls back; investigate logs              |
| Postgres connection refused        | `docker compose ps vollos-core-postgres` (vollos-core repo)  |
| TLS cert expired                   | `docker compose logs caddy` in vollos-core              |
| Disk full                          | `docker system df` → `docker image prune -f`            |
| API container crashloop            | `docker logs acmd-api --tail 200` + roll back           |

Escalation: Lead@acmd → Lead@vollos-core (cross-repo coordination required).

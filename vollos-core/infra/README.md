# vollos-core / infra

Infrastructure scripts and configs for the VOLLOS VPS.

| File                  | Purpose                                                   |
|-----------------------|-----------------------------------------------------------|
| `Caddyfile`           | Reverse-proxy + auto-HTTPS config                         |
| `backup.sh`           | Nightly `pg_dump` → `gzip` → **GPG-encrypt** → R2 upload  |
| `restore.sh`          | Decrypt + restore (admin workstation only)                |
| `backup-public.asc`   | GPG **public** key for `backup@vollos.ai` (safe to commit)|
| `monitor.sh`          | Container health poll + Telegram alerts                   |
| `retention.sh`        | PDPA 2-year retention — runs `deleteExpiredLeads.js` in API container, Telegram on failure |
| `setup-cron.sh`       | Installs `backup.sh` + `monitor.sh` + `retention.sh` into crontab |

## Backup encryption (T-040)

Backups are **encrypted on the VPS** with an RSA-4096 GPG public key
before they leave the box. The matching private key stays **offline**
with the owner. Even if the R2 bucket or its API credentials leak, an
attacker cannot read customer lead data without the owner's private
key + passphrase.

### Backup artifact

- Filename: `vollos-core_<TIMESTAMP>.sql.gz.gpg`
- Produced by streaming `pg_dump | gzip | gpg --encrypt` — the SQL
  plaintext is never written to disk on the VPS.
- `set -o pipefail` (via `set -euo pipefail` at the top of `backup.sh`)
  ensures pipeline failures abort the run and notify Telegram.

### One-time key setup (owner only)

See `_workspace/T-040/RUNBOOK-key-setup.md`. Summary:

1. Owner generates the keypair on a **trusted workstation** (NOT the
   VPS) using a passphrase stored only in a password manager.
2. Owner exports the public key to `infra/backup-public.asc` and opens
   an MR. The public key is committed.
3. Owner exports the private key to USB / encrypted offline storage and
   **wipes every workstation copy** with `shred`.
4. Until the real key replaces the placeholder at
   `infra/backup-public.asc`, `backup.sh` aborts early with a clear
   error — this is by design.

### Restoring from an encrypted backup

Use `infra/restore.sh` on the **admin workstation only** (not the VPS):

```bash
# dry-run: verify encrypt/decrypt pipeline without touching the DB
./infra/restore.sh --file ./backups/vollos-core_<TS>.sql.gz.gpg --dry-run

# pull from R2 + restore into local docker postgres
./infra/restore.sh --from-r2 vollos-core_<TS>.sql.gz.gpg \
                   --container vollos-core-postgres \
                   --db vollos_prod --user postgres
```

`gpg-agent` prompts for the passphrase at decrypt time. The script
refuses to run on VPS hostnames as a safety net.

### Environment variables (see `.env.example`)

| Name                  | Where used                  | Notes                       |
|-----------------------|-----------------------------|-----------------------------|
| `POSTGRES_DB`         | `backup.sh`                 | Database name to dump       |
| `TELEGRAM_BOT_TOKEN`  | `backup.sh`, `monitor.sh`   | Alerting                    |
| `TELEGRAM_CHAT_ID`    | `backup.sh`, `monitor.sh`   | Alerting                    |
| `R2_ACCESS_KEY_ID`    | `backup.sh`, `restore.sh`   | Cloudflare R2               |
| `R2_SECRET_ACCESS_KEY`| `backup.sh`, `restore.sh`   | Cloudflare R2               |
| `R2_BUCKET_NAME`      | `backup.sh`, `restore.sh`   | Cloudflare R2               |
| `R2_ENDPOINT`         | `backup.sh`, `restore.sh`   | Cloudflare R2               |

No GPG passphrase variable exists on the VPS. The VPS only uses the
public key, which needs no secret.

### Secret handling quick rules

- Public `.asc` file: **commit** to git.
- Private `.asc` file, passphrase, key fingerprint notes: **never**
  commit, never paste in chat, never store on VPS.
- R2 credentials: GitLab CI/CD Variables (masked + protected) → written
  into VPS `.env` by the deploy pipeline, not committed.

If a private-key artifact or passphrase leaks, treat as a full
compromise: rotate the keypair (runbook Section 7) and invalidate
existing R2 backups.

## PDPA 2-year retention (T-059)

Thai PDPA Section 37 + CCPA require that we do not retain personal
data indefinitely. A daily cron enforces a **2-year retention window**
on the `vollos.leads` table.

- **Schedule:** `15 3 * * *` (03:15 UTC daily — avoids the 08:00 UTC
  backup window and the common 02:00 UTC maintenance window).
- **Wrapper:** `infra/retention.sh` — calls the API container,
  pings Telegram on non-zero exit.
- **Script:** `apps/api/src/scripts/deleteExpiredLeads.ts` →
  compiles to `apps/api/dist/scripts/deleteExpiredLeads.js` via the
  existing `tsc` step in `apps/api/Dockerfile`.
- **Action:** `DELETE FROM vollos.leads WHERE created_at < NOW() - INTERVAL '2 years'`.
  Hard delete (chosen over anonymize for simpler audit trail; see
  script header for rationale). `audit_logs.lead_id` is
  `ON DELETE SET NULL` so the compliance trail survives deletion.
- **Audit row** is written **before** the delete runs, with
  `action='pdpa_retention_delete'` and `metadata={count, retentionYears, cutoff}`.

### Adjust the retention window

Set `RETENTION_YEARS` on the API container (defaults to `2`):

```bash
# example: 3 years instead of 2
docker compose exec api env RETENTION_YEARS=3 \
  node /app/apps/api/dist/scripts/deleteExpiredLeads.js
```

Persist by adding `RETENTION_YEARS=2` to the VPS `.env`; do NOT
change the default in code without a written policy decision — the
value is also documented in `apps/api/src/routes/leads.ts`
(`DATA_RETENTION_YEARS`) so both creation and deletion agree.

### Manual dry-run

```bash
# on the VPS — safe, prints count without deleting:
docker exec vollos-core-postgres \
  psql -U postgres -d vollos_prod -c \
  "SELECT count(*) FROM vollos.leads WHERE created_at < NOW() - INTERVAL '2 years';"
```

### Failure mode

Exit code non-zero → `retention.sh` sends a Telegram alert via the
same `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` env vars that
`backup.sh` uses. Check `infra/retention.log` on the VPS for the
full stderr output (plain text, no PII).

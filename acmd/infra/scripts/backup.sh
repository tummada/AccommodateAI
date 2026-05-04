#!/usr/bin/env bash
# T-061 R07 — pre-deploy backup of acmd Postgres schema.
#
# Architecture Rule I1: backup ก่อน migration ทุกครั้ง.
# Postgres lives in vollos-core (shared) — we dump only the `acmd` schema so
# vollos auth tables are untouched (and we don't need vollos-core's superuser
# password).
#
# Run this on the VPS as part of the deploy job, BEFORE `docker compose up -d`
# (which runs pnpm db:migrate inside acmd-api).
#
# Usage: bash infra/scripts/backup.sh
#   Output: ~/backups/acmd-{UTC_TIMESTAMP}-{GIT_SHA}.sql.gz + .sha256

set -euo pipefail

# ---- config ---------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
PG_CONTAINER="${PG_CONTAINER:-vollos-core-postgres}"   # vollos-core's container
DB_NAME="${DB_NAME:-vollos_prod}"
DB_USER="${DB_USER:-acmd_user}"
SCHEMA="${SCHEMA:-acmd}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

# T-071 AC-5 / Auditor SEC-001 — backup files contain medical-adjacent PII
# from the acmd schema (cases / documents / letters / audit_log per
# Architecture Rule A4). Default umask 022 would leave the .sql.gz at mode
# 644 (world-readable on a shared VPS). Switch to 077 BEFORE pg_dump so
# the gzip output AND the .sha256 sidecar are created at mode 600 from
# birth — no race window where a non-root user can read the dump.
umask 077

ts=$(date -u +%Y%m%dT%H%M%SZ)
sha=$(git -C "$(dirname "$0")/../.." rev-parse --short=12 HEAD 2>/dev/null || echo "nogit")
out="$BACKUP_DIR/acmd-${ts}-${sha}.sql.gz"

# ---- dump -----------------------------------------------------------------
# pg_dump --schema=acmd uses search-path filter so we capture only acmd.* tables.
# DATABASE_URL is read from the running acmd-api .env — but here we use the
# postgres container directly (less round-trip + no need to expose Postgres).
echo "[backup] dumping schema=${SCHEMA} from ${PG_CONTAINER}:${DB_NAME} → ${out}"
docker exec -i "$PG_CONTAINER" \
  pg_dump \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --schema="$SCHEMA" \
    --no-owner \
    --no-privileges \
    --format=plain \
  | gzip -9 > "$out"

# ---- checksum -------------------------------------------------------------
sha256sum "$out" > "${out}.sha256"
echo "[backup] sha256 → $(cat "${out}.sha256")"

# ---- defense-in-depth chmod ----------------------------------------------
# umask 077 above already creates the file at 600, but if a future change
# moves the redirect outside this script (or callers wrap the script with
# a different umask) we want the explicit chmod as a backstop.
chmod 600 "$out" "${out}.sha256"
ls -la "$out" "${out}.sha256"

# ---- size sanity ----------------------------------------------------------
size=$(stat -c '%s' "$out")
# threshold = 256 bytes — covers truly broken pg_dump (0-byte / corrupted gzip header)
# while allowing empty-schema first deploy where pg_dump output is ~400 bytes
# (T-084 — first deploy of acmd 2026-04-29 produced 424-byte valid backup)
if [ "$size" -lt 256 ]; then
  echo "[backup] WARN: backup size = ${size} bytes (suspiciously small)" >&2
  exit 1
fi
echo "[backup] OK — ${size} bytes"

# ---- prune old backups ----------------------------------------------------
# Keep ${KEEP_DAYS} days of backups locally on VPS; off-site sync is a
# separate cron (R2 / S3) — out of scope here.
find "$BACKUP_DIR" -name 'acmd-*.sql.gz*' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "[backup] DONE — restore with: bash infra/scripts/rollback.sh ${out}"

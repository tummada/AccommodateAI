#!/usr/bin/env bash
# ============================================================
# vollos-core Database Restore Script (GPG-encrypted backups)
# ============================================================
# ⚠️ ADMIN WORKSTATION ONLY — DO NOT RUN ON VPS ⚠️
#
# Reason: The private GPG key is held by the owner offline. The VPS has
# only the public key and MUST NOT decrypt backups. Running this script
# on the VPS would defeat the security model introduced in T-040
# (see _workspace/T-040/RUNBOOK-key-setup.md).
#
# Usage examples:
#   # 1) restore from a local encrypted file into a local docker postgres
#   ./infra/restore.sh --file ./backups/vollos-core_20260420_080000.sql.gz.gpg
#
#   # 2) pull from R2 first, then restore
#   ./infra/restore.sh --from-r2 vollos-core_20260420_080000.sql.gz.gpg
#
#   # 3) restore into a specific container + database
#   ./infra/restore.sh --file <path> --container vollos-core-postgres \
#                      --db vollos_prod --user postgres
#
# Required on admin workstation:
#   - GnuPG (with owner's PRIVATE key imported into local keyring)
#   - gzip, psql or docker
#   - aws CLI (only if --from-r2 is used) with R2 credentials exported as
#     AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (never hardcoded)
#
# The script never touches ~/.gnupg directly — it uses the caller's
# default keyring. The passphrase is prompted by gpg-agent at decrypt
# time; we do NOT accept it as a flag (never expose passphrase in argv).
# ============================================================
set -euo pipefail

# ---- defaults ----
FILE=""
FROM_R2=""
CONTAINER="vollos-core-postgres"
DB="${POSTGRES_DB:-vollos_prod}"
DB_USER="${POSTGRES_USER:-postgres}"
R2_BUCKET="${R2_BUCKET_NAME:-}"
R2_ENDPOINT="${R2_ENDPOINT:-}"
DRY_RUN=0

usage() {
    sed -n '3,30p' "$0"
    exit 1
}

# ---- argv ----
while [ $# -gt 0 ]; do
    case "$1" in
        --file)       FILE="$2"; shift 2 ;;
        --from-r2)    FROM_R2="$2"; shift 2 ;;
        --container)  CONTAINER="$2"; shift 2 ;;
        --db)         DB="$2"; shift 2 ;;
        --user)       DB_USER="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=1; shift ;;
        -h|--help)    usage ;;
        *) echo "unknown argument: $1" >&2; usage ;;
    esac
done

# ---- safety: reject running on known VPS hostnames ----
# Best-effort; not a hard security boundary (anyone can rename a host),
# but it catches accidental runs.
case "${HOSTNAME:-}" in
    vollos-vps*|vollos-prod*|*.vollos.ai)
        echo "ERROR: this script must not run on the VPS (hostname=${HOSTNAME})." >&2
        echo "Private key stays offline on the admin workstation only." >&2
        exit 2
        ;;
esac

# ---- preflight ----
command -v gpg     >/dev/null || { echo "gpg is required"    >&2; exit 1; }
command -v gunzip  >/dev/null || { echo "gunzip is required" >&2; exit 1; }

if [ -n "$FROM_R2" ]; then
    command -v aws >/dev/null || { echo "aws CLI is required for --from-r2" >&2; exit 1; }
    [ -n "$R2_BUCKET" ]   || { echo "R2_BUCKET_NAME must be set" >&2; exit 1; }
    [ -n "$R2_ENDPOINT" ] || { echo "R2_ENDPOINT must be set"    >&2; exit 1; }
    FILE="$(mktemp -t "vollos-restore-XXXXXX.sql.gz.gpg")"
    trap 'rm -f "$FILE"' EXIT
    echo "[$(date)] Downloading s3://${R2_BUCKET}/${FROM_R2} → ${FILE}"
    aws s3 cp "s3://${R2_BUCKET}/${FROM_R2}" "$FILE" \
        --endpoint-url "$R2_ENDPOINT" --no-progress
fi

[ -n "$FILE" ] || { echo "missing --file or --from-r2" >&2; usage; }
[ -s "$FILE" ] || { echo "backup file missing or empty: $FILE" >&2; exit 1; }

echo "[$(date)] Decrypting + restoring ${FILE}"
echo "  container = ${CONTAINER}"
echo "  database  = ${DB}"
echo "  db user   = ${DB_USER}"
echo "  dry-run   = ${DRY_RUN}"

if [ "$DRY_RUN" -eq 1 ]; then
    # Dry-run: decrypt + gunzip but throw SQL away, just prove pipeline works
    gpg --batch --quiet --decrypt "$FILE" \
        | gunzip \
        | head -c 4096 >/dev/null
    echo "[$(date)] DRY-RUN OK — decrypt + gunzip succeeded, SQL stream readable"
    exit 0
fi

# Real restore: stream decrypt → gunzip → psql inside container.
# `set -o pipefail` above ensures failure at any stage aborts.
#
# We pipe via `docker exec -i` so the SQL never hits disk unencrypted.
gpg --batch --quiet --decrypt "$FILE" \
    | gunzip \
    | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -v ON_ERROR_STOP=1

echo "[$(date)] Restore complete. Verify with:"
echo "  docker exec -it ${CONTAINER} psql -U ${DB_USER} -d ${DB} -c '\\dt *.*'"

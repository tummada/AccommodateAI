#!/usr/bin/env bash
# ============================================================
# vollos-core Database Backup Script
# pg_dump จาก postgres container → ./infra/backups/
# GPG-encrypted (RSA4096) ด้วย public key → safe to upload to R2
# เก็บ 30 วัน ลบอัตโนมัติ + แจ้ง Telegram
# Cron: 0 8 * * * /home/ipon/vollos-core/infra/backup.sh
#       (08:00 UTC = 15:00 Thai = 03:00 US Eastern)
# ============================================================
# Security model (T-040 HIGH-2):
#   - VPS holds ONLY the PUBLIC key (backup-public.asc) → can encrypt.
#   - Owner holds PRIVATE key offline → can decrypt for restore.
#   - Even if R2 bucket leaks, attacker cannot read leads DB
#     without owner's private key.
#   - See _workspace/T-040/RUNBOOK-key-setup.md for key generation.
# ============================================================
set -euo pipefail

# --- ตั้งค่า path ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/infra/backups"
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
# ชื่อ backup file ใช้ vollos-core_ + .sql.gz.gpg (GPG-encrypted)
BACKUP_FILE="${BACKUP_DIR}/vollos-core_${TIMESTAMP}.sql.gz.gpg"
RETENTION_DAYS=30

# --- GPG config ---
# Public key ASCII-armored — committed in repo (safe to commit).
# Ephemeral keyring in /tmp so we don't touch host ~/.gnupg.
GPG_PUBLIC_KEY="${SCRIPT_DIR}/backup-public.asc"
GPG_RECIPIENT="${GPG_RECIPIENT:-backup@vollos.ai}"
GPG_HOME="$(mktemp -d -t vollos-backup-gnupg-XXXXXX)"
chmod 700 "$GPG_HOME"
trap 'rm -rf "$GPG_HOME"' EXIT

# --- สร้างโฟลเดอร์ backup ถ้ายังไม่มี ---
mkdir -p "$BACKUP_DIR"

# --- โหลด env vars ---
DB_NAME=""
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME=""
R2_ENDPOINT=""

if [ -f "$ENV_FILE" ]; then
    # grep || true — a missing key should leave the var empty, not abort
    # the whole script via `set -e` + `set -o pipefail`. Pipefail is still
    # in force for the pg_dump/gzip/gpg pipeline below, which is the part
    # that MUST abort on failure.
    DB_NAME="$(grep '^POSTGRES_DB=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    TELEGRAM_BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    TELEGRAM_CHAT_ID="$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    R2_ACCESS_KEY_ID="$(grep '^R2_ACCESS_KEY_ID=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    R2_SECRET_ACCESS_KEY="$(grep '^R2_SECRET_ACCESS_KEY=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    R2_BUCKET_NAME="$(grep '^R2_BUCKET_NAME=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    R2_ENDPOINT="$(grep '^R2_ENDPOINT=' "$ENV_FILE" | cut -d'=' -f2- || true)"
fi

# fallback ค่าเริ่มต้น
DB_NAME="${DB_NAME:-vollos_prod}"

# --- ฟังก์ชันส่ง Telegram ---
send_telegram() {
    local message="$1"
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        return 0
    fi
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="$TELEGRAM_CHAT_ID" \
        -d text="$message" \
        -d parse_mode="HTML" \
        > /dev/null 2>&1 || true
}

fail() {
    local reason="$1"
    rm -f "$BACKUP_FILE"
    local msg="🔴 vollos-core Backup FAILED: ${reason}"
    echo "$msg"
    send_telegram "$msg"
    exit 1
}

# --- ตรวจ GPG public key พร้อมใช้งาน ---
if [ ! -s "$GPG_PUBLIC_KEY" ]; then
    fail "GPG public key not found at ${GPG_PUBLIC_KEY} (see _workspace/T-040/RUNBOOK-key-setup.md)"
fi

# import public key เข้า ephemeral keyring
if ! gpg --homedir "$GPG_HOME" --batch --quiet --import "$GPG_PUBLIC_KEY" 2>/dev/null; then
    fail "GPG import failed — is ${GPG_PUBLIC_KEY} a valid ASCII-armored public key?"
fi

# ตรวจว่าคีย์ที่ import มีจริงตรงกับ recipient (placeholder จะหลุดตรงนี้)
if ! gpg --homedir "$GPG_HOME" --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
    fail "GPG recipient ${GPG_RECIPIENT} not present in imported keyring — replace placeholder at ${GPG_PUBLIC_KEY}"
fi

# --- รัน pg_dump ผ่าน docker exec + gzip + gpg encrypt ---
echo "[$(date)] Starting encrypted backup (recipient=${GPG_RECIPIENT})..."

# pipefail (set -o pipefail from `set -euo pipefail` above) makes any stage
# of the pipeline abort the script — pg_dump/gzip/gpg failures are not
# swallowed. We therefore do NOT redirect stderr of these stages to /dev/null.
# container name: vollos-core-postgres + superuser dump ทุก schema
if docker exec vollos-core-postgres pg_dump -U postgres -d "$DB_NAME" --no-owner --no-privileges \
    | gzip \
    | gpg --homedir "$GPG_HOME" \
          --batch --yes --quiet \
          --trust-model always \
          --compress-algo none \
          --encrypt --recipient "$GPG_RECIPIENT" \
          --output "$BACKUP_FILE"; then

    # ตรวจว่าไฟล์ไม่ว่าง (กัน edge case ที่ pipe success แต่ payload สั้น)
    FILESIZE="$(stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")"
    if [ "$FILESIZE" -lt 500 ]; then
        fail "output file too small (${FILESIZE} bytes) — pipeline likely degraded"
    fi

    FILESIZE_HR="$(du -h "$BACKUP_FILE" | cut -f1)"
    echo "[$(date)] Backup OK: $BACKUP_FILE ($FILESIZE_HR)"

    # --- ลบ backup เก่ากว่า 30 วัน (ครอบคลุมทั้ง .sql.gz และ .sql.gz.gpg ระหว่างเปลี่ยนถ่าย) ---
    DELETED_NEW="$(find "$BACKUP_DIR" -name "vollos-core_*.sql.gz.gpg" -mtime +${RETENTION_DAYS} -delete -print | wc -l)"
    DELETED_OLD="$(find "$BACKUP_DIR" -name "vollos-core_*.sql.gz" ! -name "*.gpg" -mtime +${RETENTION_DAYS} -delete -print | wc -l)"
    DELETED=$((DELETED_NEW + DELETED_OLD))
    echo "[$(date)] Cleaned up $DELETED old backup(s) (encrypted: $DELETED_NEW, legacy: $DELETED_OLD)"

    # --- Upload to Cloudflare R2 (ถ้าตั้งค่าแล้ว) ---
    R2_STATUS=""
    if [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_BUCKET_NAME" ] && [ -n "$R2_ENDPOINT" ]; then
        echo "[$(date)] Uploading encrypted backup to R2..."
        if command -v aws &> /dev/null; then
            if AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
               AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
               aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET_NAME}/$(basename "$BACKUP_FILE")" \
               --endpoint-url "$R2_ENDPOINT" \
               --no-progress 2>&1; then
                R2_STATUS="✅ R2 upload OK"
                echo "[$(date)] R2 upload OK"
            else
                R2_STATUS="⚠️ R2 upload FAILED"
                echo "[$(date)] R2 upload FAILED"
            fi
        else
            R2_STATUS="⚠️ R2 skipped: aws CLI not installed"
            echo "[$(date)] aws CLI not installed — R2 upload skipped"
        fi
    else
        echo "[$(date)] R2 not configured — skipping upload"
    fi

    # --- แจ้ง Telegram (success) ---
    TOTAL="$(find "$BACKUP_DIR" -name "vollos-core_*.sql.gz.gpg" | wc -l)"
    MSG="✅ vollos-core Backup OK (GPG-encrypted)
Size: ${FILESIZE_HR}
File: $(basename "$BACKUP_FILE")
Total backups: ${TOTAL}
Deleted old: ${DELETED}"
    [ -n "$R2_STATUS" ] && MSG="${MSG}
R2: ${R2_STATUS}"
    send_telegram "$MSG"

else
    fail "pg_dump | gzip | gpg pipeline failed (see PIPESTATUS — set -o pipefail aborted on first non-zero)"
fi

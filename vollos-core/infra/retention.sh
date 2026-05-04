#!/usr/bin/env bash
# ============================================================
# vollos-core PDPA Retention Cron Wrapper
#
# Runs the compiled deleteExpiredLeads script inside the API
# container. On failure, pings Telegram using the same env-based
# config that infra/backup.sh uses (TELEGRAM_BOT_TOKEN +
# TELEGRAM_CHAT_ID from PROJECT_DIR/.env).
#
# Cron (installed by infra/setup-cron.sh):
#   15 3 * * * /opt/vollos-core/infra/retention.sh
#     03:15 UTC = 10:15 Thai (ICT) = 22:15 EST / 23:15 EDT (prev day, US Eastern)
#   Chosen to avoid the 08:00 UTC backup window in backup.sh
#   and the 02:00 system maintenance window typical on VPS hosts.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"

CONTAINER_NAME="${VOLLOS_API_CONTAINER:-vollos-core-api}"
SCRIPT_PATH="/app/apps/api/dist/scripts/deleteExpiredLeads.js"

TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""

if [ -f "$ENV_FILE" ]; then
    TELEGRAM_BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- || true)"
    TELEGRAM_CHAT_ID="$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d'=' -f2- || true)"
fi

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

echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] retention: starting — container=${CONTAINER_NAME}"

if docker exec "$CONTAINER_NAME" node "$SCRIPT_PATH"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] retention: OK"
    exit 0
else
    EXIT_CODE=$?
    MSG="🔴 vollos-core PDPA Retention FAILED
Container: ${CONTAINER_NAME}
Exit code: ${EXIT_CODE}
Check /var/log/vollos-retention.log on the VPS."
    echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] retention: FAILED (exit=${EXIT_CODE})"
    send_telegram "$MSG"
    exit "$EXIT_CODE"
fi

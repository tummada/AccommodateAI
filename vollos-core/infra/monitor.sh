#!/usr/bin/env bash
# ============================================================
# VOLLOS Monitoring Script
# ตรวจสอบ: containers (postgres, api, auth, caddy), site response, disk, memory
# ส่ง Telegram alert เมื่อพบปัญหา
# Cron: */5 * * * * /home/ipon/vollos-core/infra/monitor.sh
# ============================================================
set -euo pipefail

# --- โหลด env vars จาก .env ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"

if [ -f "$ENV_FILE" ]; then
    # อ่านเฉพาะ TELEGRAM vars
    TELEGRAM_BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2-)"
    TELEGRAM_CHAT_ID="$(grep '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d'=' -f2-)"
else
    TELEGRAM_BOT_TOKEN=""
    TELEGRAM_CHAT_ID=""
fi

# --- ฟังก์ชันส่ง Telegram ---
send_alert() {
    local message="$1"
    # ข้ามถ้ายังไม่ได้ตั้ง token/chat_id
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        echo "[WARN] Telegram not configured, skipping alert: $message"
        return 0
    fi
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="$TELEGRAM_CHAT_ID" \
        -d text="$message" \
        -d parse_mode="HTML" \
        > /dev/null 2>&1 || true
}

ALERTS=""

# --- Check 1: All 4 containers running & healthy ---
# ตรวจ 4 container ตาม docker-compose.yml (container_name fields):
#   vollos-core-postgres, vollos-core-api, vollos-core-auth, vollos-core-caddy
# สำหรับแต่ละตัว: running ก่อน แล้วถ้ามี healthcheck ตรวจ health status
CONTAINERS=(
    "vollos-core-postgres"
    "vollos-core-api"
    "vollos-core-auth"
    "vollos-core-caddy"
)

for CONTAINER in "${CONTAINERS[@]}"; do
    STATUS="$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")"
    if [ "$STATUS" != "running" ]; then
        ALERTS="${ALERTS}\n- ${CONTAINER}: ${STATUS}"
        continue
    fi
    # ตรวจ healthcheck ถ้ามี (ทั้ง 4 service มี healthcheck กำหนดไว้ใน compose)
    HEALTH="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "unknown")"
    if [ "$HEALTH" != "none" ] && [ "$HEALTH" != "healthy" ]; then
        ALERTS="${ALERTS}\n- ${CONTAINER} running but unhealthy: ${HEALTH}"
    fi
done

# --- Check 2: Site responds (with retry) ---
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://vollos.ai/ 2>/dev/null || echo "000")"
if [ "$HTTP_CODE" != "200" ]; then
    echo "[WARN] HTTP check got ${HTTP_CODE}, retrying in 5s..."
    sleep 5
    HTTP_CODE_RETRY="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://vollos.ai/ 2>/dev/null || echo "000")"
    if [ "$HTTP_CODE_RETRY" = "200" ]; then
        echo "[WARN] transient failure, retry OK"
    else
        ALERTS="${ALERTS}\n- Site https://vollos.ai/ returned HTTP ${HTTP_CODE_RETRY} (first attempt: ${HTTP_CODE})"
    fi
fi

# --- Check 3: Disk usage > 80% ---
DISK_USAGE="$(df / --output=pcent | tail -1 | tr -d ' %')"
if [ "$DISK_USAGE" -gt 80 ] 2>/dev/null; then
    ALERTS="${ALERTS}\n- Disk usage: ${DISK_USAGE}%"
fi

# --- Check 4: Memory usage > 90% ---
MEM_TOTAL="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
MEM_AVAIL="$(grep MemAvailable /proc/meminfo | awk '{print $2}')"
if [ "$MEM_TOTAL" -gt 0 ] 2>/dev/null; then
    MEM_USED_PCT=$(( (MEM_TOTAL - MEM_AVAIL) * 100 / MEM_TOTAL ))
    if [ "$MEM_USED_PCT" -gt 90 ]; then
        ALERTS="${ALERTS}\n- Memory usage: ${MEM_USED_PCT}%"
    fi
fi

# --- ส่ง alert ถ้ามีปัญหา ---
if [ -n "$ALERTS" ]; then
    HOSTNAME="$(hostname)"
    MSG=$(printf "🔴 VOLLOS Alert (%s):\n%b" "$HOSTNAME" "$ALERTS")
    echo "$MSG"
    send_alert "$MSG"
    exit 1
else
    echo "[OK] All checks passed at $(date '+%Y-%m-%d %H:%M:%S')"
    exit 0
fi

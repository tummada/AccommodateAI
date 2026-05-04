#!/usr/bin/env bash
# ติดตั้ง crontab entries สำหรับ vollos-core
# รัน 1 ครั้งหลัง deploy ครั้งแรก หรือเมื่อ entry เปลี่ยน
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# เพิ่ม crontab entries (idempotent — ไม่ duplicate ถ้ารันซ้ำ)
crontab -l 2>/dev/null | grep -v "vollos-core" | cat - <(cat <<EOF
# vollos-core — Database Backup (08:00 UTC = 15:00 Thai = 03:00 US Eastern)
0 8 * * * ${PROJECT_DIR}/infra/backup.sh >> ${PROJECT_DIR}/infra/backup.log 2>&1
# vollos-core — Health Monitor (every 5 min)
*/5 * * * * ${PROJECT_DIR}/infra/monitor.sh >> ${PROJECT_DIR}/infra/monitor.log 2>&1
# vollos-core — PDPA Retention Delete (03:15 UTC = 10:15 Thai) — leads > 2yr old
15 3 * * * ${PROJECT_DIR}/infra/retention.sh >> ${PROJECT_DIR}/infra/retention.log 2>&1
EOF
) | crontab -

echo "✅ Crontab updated"
crontab -l | grep "vollos-core"

#!/usr/bin/env bash
# T-061 R07 — rollback to a previous deploy + (optional) restore acmd schema.
#
# Triggered by:
#   1. .gitlab-ci.yml deploy-after-script when smoke.sh exits non-zero
#   2. Manual operator on the VPS:  bash infra/scripts/rollback.sh <prev_sha>
#
# Strategy (matches Architecture Rule I5):
#   a. Re-pull and re-up acmd containers from the previous image tag (per service)
#   b. Re-run smoke (light pass — /health only)
#   c. If a backup .sql.gz path is provided, restore the acmd schema from it
#      (DESTRUCTIVE — only triggered when a migration broke the schema)
#
# Usage:
#   bash infra/scripts/rollback.sh <PREV_GIT_SHA> [BACKUP_FILE]
#
# Example:
#   bash infra/scripts/rollback.sh a1b2c3d4
#   bash infra/scripts/rollback.sh a1b2c3d4 ~/backups/acmd-20260429T020000Z-abc1234.sql.gz

set -euo pipefail

PREV_SHA="${1:-}"
BACKUP_FILE="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
LAST_SHA_FILE="${LAST_SHA_FILE:-.last_deployed_sha}"

# T-071 AC-3 — if PREV_SHA was not passed on argv (operator manual run after
# a pipeline failure, or pipeline after_script could not export it across
# shell processes), fall back to the SHA persisted on the VPS. The deploy
# pipeline writes this file ONLY after a successful smoke test
# (.gitlab-ci.yml deploy:production step 6) so the value is always the
# last-known-good release — exactly what we want to roll back to.
if [ -z "$PREV_SHA" ] && [ -f "$LAST_SHA_FILE" ]; then
  PREV_SHA=$(cat "$LAST_SHA_FILE" 2>/dev/null || echo "")
  if [ -n "$PREV_SHA" ]; then
    echo "[rollback] PREV_SHA was empty — recovered '${PREV_SHA}' from ${LAST_SHA_FILE}"
  fi
fi

if [ -z "$PREV_SHA" ]; then
  echo "[rollback] ERROR: PREV_GIT_SHA required (argv \$1 or ${LAST_SHA_FILE} on VPS)" >&2
  echo "Usage: bash infra/scripts/rollback.sh <PREV_GIT_SHA> [BACKUP_FILE]" >&2
  exit 2
fi

echo "[rollback] target SHA = ${PREV_SHA}"

# ---- 1. swap image tags ---------------------------------------------------
export ACMD_API_TAG="$PREV_SHA"
export ACMD_WEB_TAG="$PREV_SHA"
export ACMD_LANDING_TAG="$PREV_SHA"

echo "[rollback] re-pulling images at sha=${PREV_SHA}"
docker compose -f "$COMPOSE_FILE" pull

echo "[rollback] restarting services with previous images"
docker compose -f "$COMPOSE_FILE" up -d --no-build

# ---- 2. wait for healthchecks --------------------------------------------
echo "[rollback] waiting 20s for healthcheck warmup"
sleep 20

# ---- 3. light smoke (just /health) ---------------------------------------
if curl -fsS --max-time 10 https://accommodate-api.vollos.ai/health >/dev/null; then
  echo "[rollback] api /health OK after rollback"
else
  echo "[rollback] CRITICAL: api /health still failing after rollback" >&2
  echo "[rollback] manual intervention required — escalate to Lead" >&2
  exit 3
fi

# ---- 4. (optional) restore Postgres schema -------------------------------
if [ -n "$BACKUP_FILE" ]; then
  echo "[rollback] restoring acmd schema from ${BACKUP_FILE}"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "[rollback] ERROR: backup file not found: $BACKUP_FILE" >&2
    exit 4
  fi

  # Verify checksum if available
  if [ -f "${BACKUP_FILE}.sha256" ]; then
    sha256sum -c "${BACKUP_FILE}.sha256" \
      || { echo "[rollback] ERROR: backup checksum mismatch" >&2; exit 5; }
  fi

  PG_CONTAINER="${PG_CONTAINER:-vollos-core-postgres}"
  DB_NAME="${DB_NAME:-vollos_prod}"
  DB_USER="${DB_USER:-acmd_user}"

  # Drop + recreate acmd schema then load dump (acmd_user has GRANT ALL on acmd
  # schema per init-db.sql — does not need superuser).
  echo "[rollback] dropping + recreating schema acmd"
  docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS acmd CASCADE;
CREATE SCHEMA acmd;
SQL

  echo "[rollback] loading dump"
  gunzip -c "$BACKUP_FILE" \
    | docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1

  echo "[rollback] schema restored"
fi

echo "[rollback] DONE — running full smoke test"
exec bash "$(dirname "$0")/smoke.sh" 60

#!/bin/sh
# =============================================================================
# vollos-core — postgres bootstrap (runs on first init only)
# -----------------------------------------------------------------------------
# Executed by the official postgres image when it discovers this file under
# /docker-entrypoint-initdb.d/. Runs ONCE on a fresh data volume:
#   * sets up auth / vollos / acmd schemas
#   * creates dedicated per-schema DB users (auth_user, vollos_user, acmd_user)
#   * grants schema privileges + default privileges on new tables
#
# Passwords are injected via environment variables supplied by docker-compose
# (sourced from .env / GitLab CI/CD Variables on VPS). NEVER hardcode.
# Required env vars (fail-closed if unset):
#   AUTH_USER_PASSWORD
#   VOLLOS_USER_PASSWORD
#   ACMD_USER_PASSWORD
#
# POSTGRES_USER / POSTGRES_DB are auto-provided by the postgres entrypoint as
# superuser context when the /docker-entrypoint-initdb.d/ scripts run.
# =============================================================================
set -eu

# Fail-closed if any password env var is missing/empty — prevents the shell
# from falling back to a known blank/default value during psql substitution.
: "${AUTH_USER_PASSWORD:?AUTH_USER_PASSWORD env var is required (set via .env / GitLab CI/CD Variables)}"
: "${VOLLOS_USER_PASSWORD:?VOLLOS_USER_PASSWORD env var is required (set via .env / GitLab CI/CD Variables)}"
: "${ACMD_USER_PASSWORD:?ACMD_USER_PASSWORD env var is required (set via .env / GitLab CI/CD Variables)}"

# psql --set exposes each password as a client-side variable. Using :'VAR'
# outside dollar-quoted blocks yields a properly single-quote-escaped SQL
# literal. ON_ERROR_STOP=1 aborts on the first error.
#
# NOTE: CREATE USER is run unconditionally — /docker-entrypoint-initdb.d/
# scripts only execute on a FRESH data volume (empty $PGDATA), so no
# pre-existing roles can collide. Schemas use CREATE SCHEMA IF NOT EXISTS
# for idempotency in case the script is hand-applied later.
psql \
	--username "${POSTGRES_USER}" \
	--dbname "${POSTGRES_DB}" \
	--set ON_ERROR_STOP=1 \
	--set AUTH_USER_PASSWORD="${AUTH_USER_PASSWORD}" \
	--set VOLLOS_USER_PASSWORD="${VOLLOS_USER_PASSWORD}" \
	--set ACMD_USER_PASSWORD="${ACMD_USER_PASSWORD}" <<'EOSQL'
-- รันด้วย superuser ครั้งแรก — ตั้ง schemas + users + permissions

-- ล็อค public schema ไม่ให้ user อื่นใช้
REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- Note: skip REVOKE FROM postgres — superuser is POSTGRES_USER (vollos) on Alpine image

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS vollos;
CREATE SCHEMA IF NOT EXISTS acmd;

-- Dedicated per-schema users. Password values are substituted client-side by
-- psql from --set flags — never interpolated by the shell, never logged.
CREATE USER auth_user   WITH PASSWORD :'AUTH_USER_PASSWORD';
CREATE USER vollos_user WITH PASSWORD :'VOLLOS_USER_PASSWORD';
CREATE USER acmd_user   WITH PASSWORD :'ACMD_USER_PASSWORD';

ALTER USER auth_user   SET search_path = auth;
ALTER USER vollos_user SET search_path = vollos;
ALTER USER acmd_user   SET search_path = acmd;

-- auth schema
GRANT ALL ON SCHEMA auth TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;

-- vollos schema
GRANT ALL ON SCHEMA vollos TO vollos_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA vollos
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;

-- acmd schema
GRANT ALL ON SCHEMA acmd TO acmd_user;
-- REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK -> acmd.users owned by superuser)
ALTER DEFAULT PRIVILEGES IN SCHEMA acmd
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO acmd_user;
EOSQL

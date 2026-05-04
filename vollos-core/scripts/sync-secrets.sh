#!/usr/bin/env bash
# =============================================================================
# vollos-core — sync-secrets.sh
# -----------------------------------------------------------------------------
# Distribute GitLab CI/CD Variables from a source project (vollos-core) to one
# or more target product repos (vollos-acmd, vollos-bnfg, etc.).
#
# Strategy: Source-of-truth = `tummadajingjing/vollos-core` GitLab project
# variables. Targets are listed in a YAML config file. For each (target, key)
# pair the script compares sha256 fingerprints (first 8 hex) and only writes
# when they differ. Default mode is dry-run; --apply is required to mutate.
#
# Why this exists: personal-namespace projects don't get GitLab Group Variables,
# so secrets must be copied per-project. See
# project_secrets_strategy.md for the full rationale.
#
# Usage:
#   ./scripts/sync-secrets.sh                                          # dry-run, default config
#   ./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --dry-run
#   ./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --apply
#   ./scripts/sync-secrets.sh --target tummadajingjing/vollos-acmd \
#       --keys GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET --apply           # ad-hoc mode
#
# Exit codes:
#   0  success (all in sync after run, or dry-run completed)
#   1  GitLab HTTP error (network / 5xx)
#   2  missing token (VOLLOS_CLI_v2)
#   3  missing source key (key listed in config not found at source)
#   4  target repo not accessible (403/404 — check token scope)
#   5  sha256 mismatch after apply (CRITICAL — investigate immediately)
#   6  invalid arguments / config
# =============================================================================

set -euo pipefail
# NB: do NOT enable `set -x` — it would echo curl commands carrying tokens.

# -------- repo-root + .env auto-load -----------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "ERROR: must be run inside a git checkout" >&2
  exit 6
fi

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

if [[ -z "${VOLLOS_CLI_v2:-}" ]]; then
  echo "ERROR: VOLLOS_CLI_v2 not set (expected in ${REPO_ROOT}/.env)" >&2
  exit 2
fi

# -------- defaults & arg parsing ---------------------------------------------
CONFIG_FILE="${REPO_ROOT}/scripts/secrets-config.yaml"
MODE="dry-run"
AD_HOC_TARGET=""
AD_HOC_KEYS=""
GITLAB_API="https://gitlab.com/api/v4"

usage() {
  sed -n '2,33p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_FILE="$2"; shift 2 ;;
    --dry-run)
      MODE="dry-run"; shift ;;
    --apply)
      MODE="apply"; shift ;;
    --target)
      AD_HOC_TARGET="$2"; shift 2 ;;
    --keys)
      AD_HOC_KEYS="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 6 ;;
  esac
done

# -------- helpers ------------------------------------------------------------
sha8() {
  # stdin → first 8 hex chars of sha256
  sha256sum | awk '{print substr($1,1,8)}'
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

# Returns: HTTP status on stdout via "STATUS<TAB>BODY" so we never echo body
# alone (defense in depth — caller decides what to print).
gitlab_get_var() {
  # $1=project (url-encoded), $2=key
  local project="$1" key="$2"
  local url="${GITLAB_API}/projects/${project}/variables/${key}"
  local resp
  resp="$(curl -sS -w '\n%{http_code}' \
    --header "PRIVATE-TOKEN: ${VOLLOS_CLI_v2}" \
    "${url}")" || return 1
  local body="${resp%$'\n'*}"
  local status="${resp##*$'\n'}"
  printf '%s\t%s' "${status}" "${body}"
}

gitlab_put_var() {
  # $1=project (url-encoded), $2=key, $3=value-file-path, $4=protected, $5=masked
  local project="$1" key="$2" valfile="$3" protected="$4" masked="$5"
  local url="${GITLAB_API}/projects/${project}/variables/${key}"
  local status
  # SECURITY (T-091, fixes LOW-1 of T-089 audit): use curl's `--form value=<file`
  # syntax so curl reads the secret from disk at request-build time. The previous
  # form `--form-string "value=$(cat ${valfile})"` caused bash to expand $(cat)
  # before exec, briefly placing the plaintext value in curl's argv (visible in
  # /proc/<pid>/cmdline + auditd execve logs to same-UID processes).
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    --request PUT \
    --header "PRIVATE-TOKEN: ${VOLLOS_CLI_v2}" \
    --form "value=<${valfile}" \
    --form "protected=${protected}" \
    --form "masked=${masked}" \
    --form "variable_type=env_var" \
    "${url}")" || return 1
  printf '%s' "${status}"
}

gitlab_post_var() {
  # $1=project (url-encoded), $2=key, $3=value-file-path, $4=protected, $5=masked
  local project="$1" key="$2" valfile="$3" protected="$4" masked="$5"
  local url="${GITLAB_API}/projects/${project}/variables"
  local status
  # SECURITY (T-091, fixes LOW-1 of T-089 audit): see note in gitlab_put_var above.
  # `key` stays as `--form-string` because it is not a secret and value comes from
  # an already-trusted bash array (no shell expansion concerns).
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    --request POST \
    --header "PRIVATE-TOKEN: ${VOLLOS_CLI_v2}" \
    --form-string "key=${key}" \
    --form "value=<${valfile}" \
    --form "protected=${protected}" \
    --form "masked=${masked}" \
    --form "variable_type=env_var" \
    "${url}")" || return 1
  printf '%s' "${status}"
}

# -------- config loading -----------------------------------------------------
SOURCE_PROJECT=""
declare -a TARGETS=()
declare -a KEYS=()
DEFAULT_PROTECTED="true"
DEFAULT_MASKED="true"

load_config_from_file() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    echo "ERROR: config file not found: ${file}" >&2
    echo "       create it from scripts/secrets-config.example.yaml" >&2
    exit 6
  fi
  local parsed
  parsed="$(python3 - "$file" <<'PY'
import sys, yaml
with open(sys.argv[1]) as f:
    cfg = yaml.safe_load(f) or {}
src = (cfg.get("source") or {}).get("project", "")
targets = cfg.get("targets") or []
keys = cfg.get("keys") or []
flags = cfg.get("default_flags") or {}
print("SRC=" + src)
print("TARGETS=" + ",".join(targets))
print("KEYS=" + ",".join(keys))
print("PROTECTED=" + str(flags.get("protected", True)).lower())
print("MASKED=" + str(flags.get("masked", True)).lower())
PY
)"
  while IFS= read -r line; do
    case "${line}" in
      SRC=*)        SOURCE_PROJECT="${line#SRC=}" ;;
      TARGETS=*)    IFS=',' read -r -a TARGETS <<< "${line#TARGETS=}" ;;
      KEYS=*)       IFS=',' read -r -a KEYS <<< "${line#KEYS=}" ;;
      PROTECTED=*)  DEFAULT_PROTECTED="${line#PROTECTED=}" ;;
      MASKED=*)     DEFAULT_MASKED="${line#MASKED=}" ;;
    esac
  done <<< "${parsed}"
}

if [[ -n "${AD_HOC_TARGET}" || -n "${AD_HOC_KEYS}" ]]; then
  if [[ -z "${AD_HOC_TARGET}" || -z "${AD_HOC_KEYS}" ]]; then
    echo "ERROR: --target and --keys must be used together" >&2
    exit 6
  fi
  SOURCE_PROJECT="tummadajingjing/vollos-core"
  TARGETS=("${AD_HOC_TARGET}")
  IFS=',' read -r -a KEYS <<< "${AD_HOC_KEYS}"
else
  load_config_from_file "${CONFIG_FILE}"
fi

if [[ -z "${SOURCE_PROJECT}" || ${#TARGETS[@]} -eq 0 || ${#KEYS[@]} -eq 0 ]]; then
  echo "ERROR: config incomplete (need source.project + targets[] + keys[])" >&2
  exit 6
fi

# -------- temp dir for value files (never echoed) ----------------------------
TMPDIR_RUN="$(mktemp -d -t T-088-sync-XXXXXX)"
chmod 700 "${TMPDIR_RUN}"
cleanup() {
  # Securely wipe value files before unlink. (Invoked via trap below.)
  # shellcheck disable=SC2317  # trap-invoked, not unreachable
  if [[ -d "${TMPDIR_RUN}" ]]; then
    # shellcheck disable=SC2317
    find "${TMPDIR_RUN}" -type f -exec shred -u {} + 2>/dev/null || true
    # shellcheck disable=SC2317
    rm -rf "${TMPDIR_RUN}"
  fi
  # shellcheck disable=SC2317
  unset VOLLOS_CLI_v2 || true
}
trap cleanup EXIT INT TERM

# -------- pre-flight: source must have all keys ------------------------------
SRC_ENC="$(urlencode "${SOURCE_PROJECT}")"

echo "=== sync-secrets.sh — ${MODE} mode ==="
echo "Source: ${SOURCE_PROJECT}"
printf 'Targets: %s\n' "${TARGETS[*]}"
printf 'Keys:    %s\n' "${KEYS[*]}"
echo

declare -A SRC_FP=()
declare -A SRC_FILE=()
missing_keys=()
for key in "${KEYS[@]}"; do
  resp="$(gitlab_get_var "${SRC_ENC}" "${key}")" || { echo "ERROR: source GET failed for ${key}" >&2; exit 1; }
  status="${resp%%$'\t'*}"
  body="${resp#*$'\t'}"
  if [[ "${status}" == "404" ]]; then
    missing_keys+=("${key}")
    continue
  fi
  if [[ "${status}" != "200" ]]; then
    echo "ERROR: source GET ${key} → HTTP ${status}" >&2
    exit 1
  fi
  vf="${TMPDIR_RUN}/src-${key}"
  # SECURITY (T-091): use `jq -j` (no trailing newline) so curl `--form value=<file`
  # uploads the exact byte content. With `jq -r` the trailing \n would be sent to
  # GitLab — which (a) changes the value and (b) breaks `masked=true` validation
  # (masked values forbid whitespace). All four jq calls below use -j for the same
  # reason — and so sha8 fingerprints stay byte-identical between source/target.
  jq -j '.value' <<< "${body}" > "${vf}"
  chmod 600 "${vf}"
  SRC_FILE["${key}"]="${vf}"
  SRC_FP["${key}"]="$(sha8 < "${vf}")"
done

if [[ ${#missing_keys[@]} -gt 0 ]]; then
  echo "ERROR: keys missing at source ${SOURCE_PROJECT}:" >&2
  printf '  - %s\n' "${missing_keys[@]}" >&2
  exit 3
fi

# -------- main loop ----------------------------------------------------------
total_created=0
total_updated=0
total_in_sync=0
total_errors=0

for target in "${TARGETS[@]}"; do
  TGT_ENC="$(urlencode "${target}")"
  echo "[${target}]"
  for key in "${KEYS[@]}"; do
    src_fp="${SRC_FP[$key]}"
    src_vf="${SRC_FILE[$key]}"

    # GET target current value
    resp="$(gitlab_get_var "${TGT_ENC}" "${key}")" || {
      printf '  %-22s %s  ❌ network error\n' "${key}" "sha256:${src_fp}"
      total_errors=$((total_errors+1))
      continue
    }
    status="${resp%%$'\t'*}"
    body="${resp#*$'\t'}"

    case "${status}" in
      200)
        tgt_vf="${TMPDIR_RUN}/tgt-${target//\//_}-${key}"
        jq -j '.value' <<< "${body}" > "${tgt_vf}"
        chmod 600 "${tgt_vf}"
        tgt_fp="$(sha8 < "${tgt_vf}")"
        if [[ "${src_fp}" == "${tgt_fp}" ]]; then
          printf '  %-22s sha256:%s  ✅ already in sync\n' "${key}" "${src_fp}"
          total_in_sync=$((total_in_sync+1))
        else
          if [[ "${MODE}" == "dry-run" ]]; then
            printf '  %-22s sha256:%s  🔄 WOULD UPDATE (target sha256:%s)\n' "${key}" "${src_fp}" "${tgt_fp}"
            total_updated=$((total_updated+1))
          else
            put_status="$(gitlab_put_var "${TGT_ENC}" "${key}" "${src_vf}" "${DEFAULT_PROTECTED}" "${DEFAULT_MASKED}")" || true
            if [[ "${put_status}" == "200" ]]; then
              # Verify
              v_resp="$(gitlab_get_var "${TGT_ENC}" "${key}")"
              v_status="${v_resp%%$'\t'*}"
              v_body="${v_resp#*$'\t'}"
              if [[ "${v_status}" == "200" ]]; then
                v_vf="${TMPDIR_RUN}/verify-${target//\//_}-${key}"
                jq -j '.value' <<< "${v_body}" > "${v_vf}"
                chmod 600 "${v_vf}"
                new_fp="$(sha8 < "${v_vf}")"
                if [[ "${new_fp}" == "${src_fp}" ]]; then
                  printf '  %-22s sha256:%s  🔄 UPDATED (was sha256:%s)\n' "${key}" "${new_fp}" "${tgt_fp}"
                  total_updated=$((total_updated+1))
                else
                  printf '  %-22s sha256:%s  💥 MISMATCH after PUT (got sha256:%s)\n' "${key}" "${src_fp}" "${new_fp}"
                  total_errors=$((total_errors+1))
                  exit 5
                fi
              else
                printf '  %-22s sha256:%s  ❌ verify GET failed (HTTP %s)\n' "${key}" "${src_fp}" "${v_status}"
                total_errors=$((total_errors+1))
              fi
            else
              printf '  %-22s sha256:%s  ❌ PUT failed (HTTP %s)\n' "${key}" "${src_fp}" "${put_status}"
              total_errors=$((total_errors+1))
            fi
          fi
        fi
        ;;
      404)
        if [[ "${MODE}" == "dry-run" ]]; then
          printf '  %-22s sha256:%s  ➕ WOULD CREATE\n' "${key}" "${src_fp}"
          total_created=$((total_created+1))
        else
          post_status="$(gitlab_post_var "${TGT_ENC}" "${key}" "${src_vf}" "${DEFAULT_PROTECTED}" "${DEFAULT_MASKED}")" || true
          if [[ "${post_status}" == "201" ]]; then
            v_resp="$(gitlab_get_var "${TGT_ENC}" "${key}")"
            v_status="${v_resp%%$'\t'*}"
            v_body="${v_resp#*$'\t'}"
            if [[ "${v_status}" == "200" ]]; then
              v_vf="${TMPDIR_RUN}/verify-${target//\//_}-${key}"
              jq -j '.value' <<< "${v_body}" > "${v_vf}"
              chmod 600 "${v_vf}"
              new_fp="$(sha8 < "${v_vf}")"
              if [[ "${new_fp}" == "${src_fp}" ]]; then
                printf '  %-22s sha256:%s  ➕ CREATED\n' "${key}" "${new_fp}"
                total_created=$((total_created+1))
              else
                printf '  %-22s sha256:%s  💥 MISMATCH after POST (got sha256:%s)\n' "${key}" "${src_fp}" "${new_fp}"
                total_errors=$((total_errors+1))
                exit 5
              fi
            else
              printf '  %-22s sha256:%s  ❌ verify GET failed (HTTP %s)\n' "${key}" "${src_fp}" "${v_status}"
              total_errors=$((total_errors+1))
            fi
          else
            printf '  %-22s sha256:%s  ❌ POST failed (HTTP %s)\n' "${key}" "${src_fp}" "${post_status}"
            total_errors=$((total_errors+1))
          fi
        fi
        ;;
      401|403)
        echo "ERROR: target ${target} not accessible (HTTP ${status}) — check token scope" >&2
        exit 4
        ;;
      *)
        printf '  %-22s sha256:%s  ❌ unexpected HTTP %s\n' "${key}" "${src_fp}" "${status}"
        total_errors=$((total_errors+1))
        ;;
    esac
  done
  echo
done

echo "Summary: ${total_created} created, ${total_updated} updated, ${total_in_sync} already in sync, ${total_errors} errors."

if [[ "${MODE}" == "dry-run" && $((total_created + total_updated)) -gt 0 ]]; then
  echo "(dry-run — no changes applied; re-run with --apply to write)"
fi

if [[ "${total_errors}" -gt 0 ]]; then
  exit 1
fi
exit 0

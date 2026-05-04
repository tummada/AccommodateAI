#!/usr/bin/env bash
#
# test-rollback-simulation.sh — offline simulation of .gitlab-ci.yml deploy
# stage auto-rollback logic. Does NOT require network, SSH, or real Telegram
# credentials. Runs in <5 seconds.
#
# Covers 3 scenarios:
#   A. smoke fails 5x -> rollback succeeds         -> exit 1, msg "ROLLBACK OK"
#   B. smoke fails 5x -> rollback also fails       -> exit 1, msg "DOUBLE FAILURE"
#   C. happy path: smoke passes on attempt 1       -> exit 0, no rollback
#
# Usage: bash infra/test-rollback-simulation.sh
# Exit codes: 0 = all scenarios match expectation; 1 = any scenario mismatch
#
# Secret handling: uses FAKE_TOKEN_FOR_SIMULATION. NEVER reads real
# TELEGRAM_BOT_TOKEN from environment. Hardcoded fake value below.

set -u  # error on unset var (but NOT -e — we assert exit codes ourselves)

# Hardcoded fake token — NEVER read real env
TELEGRAM_BOT_TOKEN="FAKE_TOKEN_FOR_SIMULATION"
TELEGRAM_CHAT_ID="FAKE_CHAT_ID"
CI_COMMIT_SHORT_SHA="deadbee"
CI_PIPELINE_URL="https://gitlab.com/fake/pipeline/999"
VPS_USER="fakeuser"
VPS_HOST="fakehost"
LAST_GOOD="cafebabe0000000000000000000000000000cafe"

# Scenario outputs captured here
SCENARIO_LOG=""
PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=""

###############################################################################
# Mocks
###############################################################################

# Mock ssh: succeeds, never connects out
# SIM_SSH_REVPARSE_OVERRIDE: if set (non-empty), ssh returns this string on
# `git rev-parse HEAD` calls instead of $LAST_GOOD. Use "" (empty via `SIM_SSH_REVPARSE_OVERRIDE= `)
# to simulate SSH transport failure (empty stdout); use a non-40-hex string to
# simulate malformed output (e.g. "fatal: not a git repository").
ssh() {
  # emit a deterministic LAST_GOOD when the command is `git rev-parse HEAD`
  if printf '%s' "$*" | grep -q "git rev-parse HEAD"; then
    if [ "${SIM_SSH_REVPARSE_OVERRIDE+set}" = "set" ]; then
      printf '%s' "$SIM_SSH_REVPARSE_OVERRIDE"
      [ -z "$SIM_SSH_REVPARSE_OVERRIDE" ] && return 1
      return 0
    fi
    echo "$LAST_GOOD"
    return 0
  fi
  # else: simulate success (git pull + docker compose up / reset --hard)
  return 0
}

# Mock sleep: no-op to keep tests fast
sleep() { :; }

# Mock curl: controlled by SIM_SMOKE_PATTERN env var
# SIM_SMOKE_PATTERN is a comma-separated list of response codes per call.
# Format: "200,200" (always pass) / "000,000,000,000,000,000,000,000,000,000,200,200" (fail 5x then rollback ok)
# Each smoke_check() calls curl 2x (api + auth).
#
# State (SIM_CURL_IDX, TG_SENT_COUNT) is persisted to a file so that calls
# made inside `$(...)` subshells still update the shared counter.
SIM_STATE_DIR=$(mktemp -d /tmp/rollback-sim.XXXXXX)
SIM_CURL_IDX_FILE="$SIM_STATE_DIR/curl_idx"
SIM_TG_COUNT_FILE="$SIM_STATE_DIR/tg_count"
SIM_TG_PAYLOAD_FILE="$SIM_STATE_DIR/tg_payload"
trap 'rm -rf "$SIM_STATE_DIR"' EXIT

reset_sim_state() {
  echo 0 > "$SIM_CURL_IDX_FILE"
  echo 0 > "$SIM_TG_COUNT_FILE"
  : > "$SIM_TG_PAYLOAD_FILE"
}
get_tg_count() { cat "$SIM_TG_COUNT_FILE" 2>/dev/null || echo 0; }

curl() {
  # Telegram alert URL? → consume args but do nothing; record that we "sent"
  local is_telegram=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      *api.telegram.org*) is_telegram=1 ;;
    esac
  done
  if [ "$is_telegram" = "1" ]; then
    local c
    c=$(cat "$SIM_TG_COUNT_FILE" 2>/dev/null || echo 0)
    echo $((c + 1)) > "$SIM_TG_COUNT_FILE"
    printf '%s\n' "$*" >> "$SIM_TG_PAYLOAD_FILE"
    return 0
  fi
  # Smoke curl → return code from SIM_SMOKE_PATTERN
  local codes="${SIM_SMOKE_PATTERN:-200}"
  local idx
  idx=$(cat "$SIM_CURL_IDX_FILE" 2>/dev/null || echo 0)
  local code
  code=$(printf '%s\n' "$codes" | tr ',' '\n' | sed -n "$((idx + 1))p")
  [ -z "$code" ] && code="000"
  echo $((idx + 1)) > "$SIM_CURL_IDX_FILE"
  # emulate `-w "%{http_code}"` → print code to stdout, exit 0 on 200, non-zero on 000
  if [ "$code" = "000" ]; then
    return 6
  fi
  echo "$code"
  return 0
}

###############################################################################
# SUT (System Under Test) — inlined copy of .gitlab-ci.yml deploy script block
# Kept in sync manually. Any change to .gitlab-ci.yml deploy logic MUST also
# update this block (same shell semantics).
###############################################################################

run_deploy_block() {
  # reset per-run state (file-backed so subshell calls persist)
  reset_sim_state

  # Step 1: capture LAST_GOOD
  LAST_GOOD=$(ssh -o StrictHostKeyChecking=yes "$VPS_USER@$VPS_HOST" "cd ~/vollos-core && git rev-parse HEAD")
  echo "LAST_GOOD=$LAST_GOOD"

  # Step 1.5: Guard — git SHA-1 must be 40 hex chars (MIRROR of .gitlab-ci.yml)
  if [ -z "$LAST_GOOD" ] || [ ${#LAST_GOOD} -ne 40 ] || ! echo "$LAST_GOOD" | grep -qE '^[0-9a-f]{40}$'; then
    echo "FATAL LAST_GOOD invalid (len=${#LAST_GOOD}, non-hex or malformed) — abort deploy before git pull"
    return 1
  fi

  # Step 2: deploy
  ssh -o StrictHostKeyChecking=yes "$VPS_USER@$VPS_HOST" "cd ~/vollos-core && git pull && docker compose up -d --build"

  # Step 3: smoke test with rollback (MIRROR of .gitlab-ci.yml script)
  smoke_check() {
    api=$(curl -sS --max-time 10 --connect-timeout 5 -o /dev/null -w "%{http_code}" https://vollos.ai/api/v1/health || echo "000")
    auth=$(curl -sS --max-time 10 --connect-timeout 5 -o /dev/null -w "%{http_code}" https://auth.vollos.ai/health || echo "000")
    [ "$api" = "200" ] && [ "$auth" = "200" ]
  }
  tg_alert() {
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
      echo "Telegram vars unset — skipping alert"; return 0
    fi
    curl -sS --max-time 10 --connect-timeout 5 -o /dev/null \
      -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$1" || echo "Telegram send failed"
  }

  echo "Smoke warmup sleep 15s for container boot..."
  sleep 15
  for i in 1 2 3 4 5; do
    if smoke_check; then
      echo "Smoke PASS attempt=$i api=$api auth=$auth"; return 0
    fi
    echo "Smoke retry attempt=$i api=$api auth=$auth"
    [ $i -lt 5 ] && sleep 15
  done
  echo "Smoke FAILED after 5 attempts — initiating auto-rollback to $LAST_GOOD"
  ssh -o StrictHostKeyChecking=yes "$VPS_USER@$VPS_HOST" "cd ~/vollos-core && git reset --hard $LAST_GOOD && docker compose up -d --build"
  sleep 10
  if smoke_check; then
    MSG="[VOLLOS CI] ROLLBACK OK — deploy $CI_COMMIT_SHORT_SHA failed smoke, rolled back to $LAST_GOOD. Pipeline: $CI_PIPELINE_URL"
    echo "$MSG"; tg_alert "$MSG"; return 1
  else
    MSG="[VOLLOS CI] DOUBLE FAILURE — deploy $CI_COMMIT_SHORT_SHA failed smoke AND rollback to $LAST_GOOD also failed. MANUAL attention required. Pipeline: $CI_PIPELINE_URL"
    echo "$MSG"; tg_alert "$MSG"; return 1
  fi
}

###############################################################################
# Assertion helper
###############################################################################

assert() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS  $name (expected=$expected actual=$actual)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL  $name (expected=$expected actual=$actual)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS="$FAIL_DETAILS\n  - $name: expected=$expected actual=$actual"
  fi
}

assert_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    echo "  PASS  $name (contains '$needle')"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL  $name (missing '$needle')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS="$FAIL_DETAILS\n  - $name: missing '$needle'"
  fi
}

assert_not_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    echo "  FAIL  $name (unexpected '$needle' present)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS="$FAIL_DETAILS\n  - $name: unexpected '$needle'"
  else
    echo "  PASS  $name (no '$needle')"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

###############################################################################
# Scenario A — smoke fails 5x → rollback succeeds
###############################################################################

echo "========================================================================"
echo "Scenario A: smoke fails 5x, rollback smoke passes"
echo "========================================================================"
# 10 smoke curls fail (5 retries x 2 endpoints) + 2 rollback-verify smoke pass
SIM_SMOKE_PATTERN="000,000,000,000,000,000,000,000,000,000,200,200"
OUTPUT_A=$(run_deploy_block 2>&1); EXIT_A=$?
echo "$OUTPUT_A"
echo "--- assertions ---"
assert "A: exit code is 1 (rollback ok but deploy marked failed)" "1" "$EXIT_A"
assert_contains "A: message contains ROLLBACK OK" "ROLLBACK OK" "$OUTPUT_A"
assert_not_contains "A: message does NOT contain DOUBLE FAILURE" "DOUBLE FAILURE" "$OUTPUT_A"
assert_contains "A: LAST_GOOD captured and logged" "LAST_GOOD=$LAST_GOOD" "$OUTPUT_A"
assert_contains "A: Smoke FAILED after 5 attempts" "Smoke FAILED after 5 attempts" "$OUTPUT_A"
assert_contains "A: pipeline URL referenced" "$CI_PIPELINE_URL" "$OUTPUT_A"
assert "A: Telegram alert sent exactly once" "1" "$(get_tg_count)"

echo ""

###############################################################################
# Scenario B — smoke fails 5x → rollback also fails (double failure)
###############################################################################

echo "========================================================================"
echo "Scenario B: smoke fails 5x, rollback smoke also fails"
echo "========================================================================"
# 10 initial fails (5 retries x 2 endpoints) + 2 rollback-verify fails
SIM_SMOKE_PATTERN="000,000,000,000,000,000,000,000,000,000,000,000"
OUTPUT_B=$(run_deploy_block 2>&1); EXIT_B=$?
echo "$OUTPUT_B"
echo "--- assertions ---"
assert "B: exit code is 1" "1" "$EXIT_B"
assert_contains "B: message contains DOUBLE FAILURE" "DOUBLE FAILURE" "$OUTPUT_B"
assert_contains "B: message contains MANUAL" "MANUAL" "$OUTPUT_B"
assert_not_contains "B: message does NOT contain ROLLBACK OK" "ROLLBACK OK" "$OUTPUT_B"
assert_contains "B: pipeline URL referenced" "$CI_PIPELINE_URL" "$OUTPUT_B"
assert "B: Telegram alert sent exactly once" "1" "$(get_tg_count)"

echo ""

###############################################################################
# Scenario C — happy path: smoke passes on attempt 1
###############################################################################

echo "========================================================================"
echo "Scenario C: happy path — smoke passes immediately"
echo "========================================================================"
SIM_SMOKE_PATTERN="200,200"
OUTPUT_C=$(run_deploy_block 2>&1); EXIT_C=$?
echo "$OUTPUT_C"
echo "--- assertions ---"
assert "C: exit code is 0" "0" "$EXIT_C"
assert_contains "C: smoke PASS message present" "Smoke PASS attempt=1" "$OUTPUT_C"
assert_not_contains "C: no rollback triggered" "auto-rollback" "$OUTPUT_C"
assert_not_contains "C: no ROLLBACK OK message" "ROLLBACK OK" "$OUTPUT_C"
assert_not_contains "C: no DOUBLE FAILURE message" "DOUBLE FAILURE" "$OUTPUT_C"
assert "C: no Telegram alert sent on happy path" "0" "$(get_tg_count)"

echo ""

###############################################################################
# Scenario D — empty LAST_GOOD (SSH transport fail) → guard triggers, abort
###############################################################################

echo "========================================================================"
echo "Scenario D: SSH returns empty stdout (LAST_GOOD empty) → guard aborts"
echo "========================================================================"
# Force ssh mock to return empty stdout on `git rev-parse HEAD`
SIM_SSH_REVPARSE_OVERRIDE=""
SIM_SMOKE_PATTERN="200,200"   # would pass if guard did not fire — must not reach smoke
OUTPUT_D=$(run_deploy_block 2>&1); EXIT_D=$?
unset SIM_SSH_REVPARSE_OVERRIDE
echo "$OUTPUT_D"
echo "--- assertions ---"
assert "D: exit code is 1 (guard aborts before git pull)" "1" "$EXIT_D"
assert_contains "D: FATAL LAST_GOOD message present" "FATAL LAST_GOOD invalid" "$OUTPUT_D"
assert_contains "D: guard reports len=0 for empty value" "len=0" "$OUTPUT_D"
assert_not_contains "D: no auto-rollback triggered" "auto-rollback" "$OUTPUT_D"
assert_not_contains "D: no ROLLBACK OK message" "ROLLBACK OK" "$OUTPUT_D"
assert_not_contains "D: no DOUBLE FAILURE message" "DOUBLE FAILURE" "$OUTPUT_D"
assert_not_contains "D: no smoke retry log (smoke never runs)" "Smoke retry" "$OUTPUT_D"
assert "D: no Telegram alert sent on guard abort" "0" "$(get_tg_count)"

echo ""

###############################################################################
# Scenario E — malformed LAST_GOOD (non-40-hex stdout) → guard triggers
###############################################################################

echo "========================================================================"
echo "Scenario E: SSH returns malformed SHA (non-40-hex) → guard aborts"
echo "========================================================================"
# Simulate `fatal: not a git repository` style stderr-merged-into-stdout
SIM_SSH_REVPARSE_OVERRIDE="fatal: not a git repository"
SIM_SMOKE_PATTERN="200,200"
OUTPUT_E=$(run_deploy_block 2>&1); EXIT_E=$?
unset SIM_SSH_REVPARSE_OVERRIDE
echo "$OUTPUT_E"
echo "--- assertions ---"
assert "E: exit code is 1 (guard aborts before git pull)" "1" "$EXIT_E"
assert_contains "E: FATAL LAST_GOOD message present" "FATAL LAST_GOOD invalid" "$OUTPUT_E"
assert_not_contains "E: no auto-rollback triggered" "auto-rollback" "$OUTPUT_E"
assert_not_contains "E: no ROLLBACK OK message" "ROLLBACK OK" "$OUTPUT_E"
assert_not_contains "E: no DOUBLE FAILURE message" "DOUBLE FAILURE" "$OUTPUT_E"
assert_not_contains "E: no smoke retry log (smoke never runs)" "Smoke retry" "$OUTPUT_E"
assert "E: no Telegram alert sent on guard abort" "0" "$(get_tg_count)"

echo ""

###############################################################################
# Scenario F — non-hex 40-char LAST_GOOD (length OK, char class fails) → guard fires
###############################################################################

echo "========================================================================"
echo "Scenario F: SSH returns 40-char non-hex string (e.g. alias/color injection) → guard aborts"
echo "========================================================================"
# 40 Z-chars: length=40 (passes length check) but fails hex char-class check.
# Simulates SSH output pollution (shell alias, terminal color codes, or accidental
# stdout contamination) that produces length-correct but non-SHA-valid output.
SIM_SSH_REVPARSE_OVERRIDE="ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"
SIM_SMOKE_PATTERN="200,200"   # would pass if guard did not fire — must not reach smoke
OUTPUT_F=$(run_deploy_block 2>&1); EXIT_F=$?
unset SIM_SSH_REVPARSE_OVERRIDE
echo "$OUTPUT_F"
echo "--- assertions ---"
assert "F: exit code is 1 (guard aborts before git pull)" "1" "$EXIT_F"
assert_contains "F: FATAL LAST_GOOD message present" "FATAL LAST_GOOD invalid" "$OUTPUT_F"
assert_contains "F: guard reports non-hex in error message" "non-hex" "$OUTPUT_F"
assert_contains "F: guard reports len=40 for 40-char non-hex value" "len=40" "$OUTPUT_F"
assert_not_contains "F: no auto-rollback triggered" "auto-rollback" "$OUTPUT_F"
assert_not_contains "F: no ROLLBACK OK message" "ROLLBACK OK" "$OUTPUT_F"
assert_not_contains "F: no DOUBLE FAILURE message" "DOUBLE FAILURE" "$OUTPUT_F"
assert_not_contains "F: no smoke retry log (smoke never runs)" "Smoke retry" "$OUTPUT_F"
assert_not_contains "F: no Smoke PASS log (smoke never runs)" "Smoke PASS" "$OUTPUT_F"
assert "F: no Telegram alert sent on guard abort" "0" "$(get_tg_count)"

echo ""

###############################################################################
# Secret hygiene assertions
###############################################################################

echo "========================================================================"
echo "Secret hygiene (no real token reachable in script)"
echo "========================================================================"
assert "fake token is the literal FAKE_TOKEN_FOR_SIMULATION" "FAKE_TOKEN_FOR_SIMULATION" "$TELEGRAM_BOT_TOKEN"
# Count lines that actually invoke `curl -v` or `set -x` (ignore comments/asserts).
# A line "invokes" the command if it starts with optional whitespace followed by
# the exact command token. Assertion strings use "\x63url -v" style below.
VERBOSE_CURL_LINES=$(grep -cE '(^|[ \t;&|])curl -v([ \t]|$)' "$0" || true)
SETX_LINES=$(grep -cE '^[[:space:]]*set -x([[:space:]]|$)' "$0" || true)
assert "no real 'curl -v' invocation in script" "0" "${VERBOSE_CURL_LINES:-0}"
assert "no real 'set -x' invocation in script" "0" "${SETX_LINES:-0}"
# Confirm the sensitive env vars the real pipeline uses are NOT read by this script
grep -qE '^[[:space:]]*TELEGRAM_BOT_TOKEN="\$\{?TELEGRAM_BOT_TOKEN' "$0" && READS_REAL_TOKEN=1 || READS_REAL_TOKEN=0
assert "script does NOT read real TELEGRAM_BOT_TOKEN from env" "0" "$READS_REAL_TOKEN"

echo ""

###############################################################################
# Final verdict
###############################################################################

echo "========================================================================"
echo "Summary: $PASS_COUNT passed / $FAIL_COUNT failed"
echo "========================================================================"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "SIMULATION PASS"
  exit 0
else
  echo "SIMULATION FAIL — details:"
  printf '%b\n' "$FAIL_DETAILS"
  exit 1
fi

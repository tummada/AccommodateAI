#!/usr/bin/env bash
# T-061 R05 — smoke test for production deploy.
#
# Runs after `docker compose up -d` succeeds. If any check fails, exits
# non-zero so the GitLab CI deploy job triggers rollback.sh automatically.
#
# Tested:
#   1. /health on all 3 subdomains returns 200 + {status:"ok"} where applicable
#   2. TLS certificate is a real Let's Encrypt cert (not staging / self-signed)
#   3. One protected endpoint (/api/v1/auth/me) returns 401 without a token
#      (proves auth wiring is alive — not just a 404 from a broken route mount)
#
# Usage: bash infra/scripts/smoke.sh [TIMEOUT_SECONDS]
#   TIMEOUT_SECONDS — how long to wait for /health to come up (default 90)

set -euo pipefail

TIMEOUT="${1:-90}"
LANDING_URL="https://accommodate.vollos.ai"
WEB_URL="https://accommodate-app.vollos.ai"
API_URL="https://accommodate-api.vollos.ai"

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
log()   { printf '[smoke] %s\n' "$*"; }

fail() { red "FAIL: $*"; exit 1; }

# ------------------------------------------------------------------
# 1. Wait until acmd-api /health returns 200 (max ${TIMEOUT}s)
# ------------------------------------------------------------------
log "waiting for ${API_URL}/health (timeout=${TIMEOUT}s)"
elapsed=0
until curl -fsS --max-time 5 "${API_URL}/health" >/dev/null 2>&1; do
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    fail "api /health did not respond within ${TIMEOUT}s"
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done
green "api /health up in ${elapsed}s"

# ------------------------------------------------------------------
# 2. Verify each subdomain returns HTTP/2 200 with valid TLS
# ------------------------------------------------------------------
check_url() {
  local label="$1" url="$2" expect_status="$3"
  log "checking ${label} → ${url}"

  # -I head only, -L follow redirects (Caddy may redirect www etc.), -s silent,
  # -S show errors, --max-time bounded
  local code
  code=$(curl -ILSs --max-time 10 -o /dev/null -w '%{http_code}' "$url") \
    || fail "${label} curl failed"

  if [ "$code" != "$expect_status" ]; then
    fail "${label} returned ${code}, expected ${expect_status}"
  fi
  green "${label} → ${code}"
}

check_url "landing"  "$LANDING_URL"          "200"
check_url "web"      "$WEB_URL"              "200"
check_url "api-health" "${API_URL}/health"   "200"

# ------------------------------------------------------------------
# 2b. SPA fallback (T-071 AC-15 / QA F-010) — deep-link routes must
#     resolve to index.html (200 + text/html), NOT a 404 from nginx.
#     Verifies the `try_files $uri $uri/ /index.html` directive in
#     apps/web/nginx.conf (and the matching one in apps/landing).
#     We hit a path that cannot exist as a real file so a wrong nginx
#     config (e.g. missing try_files) would 404 immediately.
# ------------------------------------------------------------------
log "verifying SPA fallback (deep-link route → index.html)"
spa_path="/__smoke_spa_fallback_$(date +%s)"
spa_code=$(curl -sS --max-time 10 -o /tmp/smoke-spa-body -w '%{http_code}' "${WEB_URL}${spa_path}") \
  || fail "web SPA fallback curl failed"
spa_ctype=$(curl -sS --max-time 10 -o /dev/null -w '%{content_type}' "${WEB_URL}${spa_path}") \
  || fail "web SPA fallback content-type fetch failed"
if [ "$spa_code" != "200" ]; then
  fail "web SPA fallback ${spa_path} returned ${spa_code}, expected 200"
fi
case "$spa_ctype" in
  text/html*|application/xhtml*) green "web SPA fallback OK ($spa_code, $spa_ctype)" ;;
  *) fail "web SPA fallback returned unexpected content-type: $spa_ctype" ;;
esac
# Sanity — body should look like a Vite-built SPA shell (root mount div).
if ! grep -q '<div id="root">' /tmp/smoke-spa-body 2>/dev/null \
  && ! grep -qi '<!doctype html' /tmp/smoke-spa-body 2>/dev/null; then
  fail "web SPA fallback body looks wrong — neither <div id=\"root\"> nor <!doctype html> found"
fi
rm -f /tmp/smoke-spa-body

# ------------------------------------------------------------------
# 3. Verify /health body looks right (not just a 200 from a stray proxy)
# ------------------------------------------------------------------
log "verifying api /health body shape"
body=$(curl -fsS --max-time 5 "${API_URL}/health")
echo "$body" | grep -q '"status":"ok"' \
  || fail "api /health body missing status:ok — got: $body"
echo "$body" | grep -q '"service":"acmd-api"' \
  || fail "api /health body missing service:acmd-api — got: $body"
green "api /health body OK"

# ------------------------------------------------------------------
# 4. Protected endpoint must return 401 unauthenticated
# ------------------------------------------------------------------
log "checking protected endpoint requires auth"
code=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  "${API_URL}/api/v1/auth/me")
if [ "$code" != "401" ]; then
  fail "/api/v1/auth/me returned ${code}, expected 401 (auth not wired?)"
fi
green "protected endpoint → 401 (expected)"

# ------------------------------------------------------------------
# 5. TLS certificate sanity (T-071 AC-12 / QA F-006)
#     Positive whitelist — accept only known-good issuers.
#     Production stack: Cloudflare proxy ON + SSL=Full (Strict). External
#     curl observers therefore see a Cloudflare edge cert. If Cloudflare
#     is set to "DNS only" (no proxy) on initial bootstrap, Caddy serves
#     a Let's Encrypt cert directly. Both are acceptable.
#     Reject anything else (staging / self-signed / unrecognised) — this
#     is a fail-loud whitelist instead of the previous fail-on-blacklist
#     pattern that would silently approve any unknown CA.
# ------------------------------------------------------------------
log "verifying TLS cert issuer (positive whitelist)"
issuer=$(echo | openssl s_client -servername accommodate-api.vollos.ai \
  -connect accommodate-api.vollos.ai:443 2>/dev/null \
  | openssl x509 -noout -issuer 2>/dev/null || true)
if [ -z "$issuer" ]; then
  fail "TLS handshake to accommodate-api.vollos.ai:443 returned no issuer (cert chain missing or connection refused)"
fi
case "$issuer" in
  *"Let's Encrypt"*|*"R3"*|*"R10"*|*"R11"*|*"E1"*|*"E5"*|*"E6"*)
    green "TLS issuer OK (Let's Encrypt): $issuer"
    ;;
  *"Cloudflare"*)
    green "TLS issuer OK (Cloudflare edge / Full Strict): $issuer"
    ;;
  *"STAGING"*|*"Fake"*|*"localhost"*)
    fail "TLS cert is staging/self-signed: $issuer"
    ;;
  *)
    fail "TLS cert issuer not on whitelist: $issuer (expected Let's Encrypt R3/R10/R11/E1/E5/E6 or Cloudflare edge)"
    ;;
esac

# ------------------------------------------------------------------
# 6. R09 audit_logs spot-check (T-071 AC-14 / QA F-008 / T-072 F-011) — OPTIONAL.
#     If TRUSTED_PROXY_IPS is correctly wired to the vollos-network
#     subnet, audit_logs.metadata->>'ip_address' should record the REAL
#     client IP (whatever Cloudflare / Caddy forwarded), not a 172.x.x.x
#     docker bridge IP. We probe the most-recent audit_logs row through
#     the vollos-core-postgres container; if all recent IPs look like docker
#     bridge addresses the operator likely forgot to override
#     TRUSTED_PROXY_IPS for the actual VPS subnet (PROD_RUNBOOK §3.4).
#
#     T-072 F-011 fix:
#       - actual table is `audit_logs` (plural) — see
#         packages/db/src/schema/audit-logs.ts:86
#       - `ip_address` is stored inside `metadata` jsonb — see
#         packages/db/src/schema/audit-logs.ts:99
#       - the previous query referenced `audit_log` + bare `ip_address`
#         column AND swallowed errors with `|| true`, so a SQL error
#         (relation does not exist / column does not exist) was
#         indistinguishable from "fresh DB, no rows" → 0 verification
#         power. We now capture stderr separately and only treat an
#         empty result as "no rows"; any SQL error fails the check
#         loudly.
#
#     We treat the empty-table case as SOFT: a brand-new deploy with
#     zero audit rows is fine. SQL errors are NOT soft — they indicate
#     a schema drift the operator must see.
#     Set SMOKE_SKIP_AUDIT=1 to skip entirely (e.g. fresh DB, no rows).
# ------------------------------------------------------------------
if [ "${SMOKE_SKIP_AUDIT:-0}" = "1" ]; then
  log "skipping R09 audit_logs spot-check (SMOKE_SKIP_AUDIT=1)"
elif command -v docker >/dev/null 2>&1; then
  log "spot-checking R09 — audit_logs most-recent metadata->>'ip_address' should be real client IP"
  pg_container="${SMOKE_PG_CONTAINER:-vollos-core-postgres}"
  pg_db="${SMOKE_PG_DB:-vollos_prod}"
  pg_user="${SMOKE_PG_USER:-acmd_user}"
  if docker ps --format '{{.Names}}' | grep -q "^${pg_container}$"; then
    # Pull the 5 most recent metadata->>'ip_address' values; if ANY is a
    # non-bridge IP we accept (operator's verification call may already
    # have run). Capture stderr so SQL errors surface instead of being
    # swallowed by `|| true` (the previous behaviour that hid the F-011
    # wrong-table bug).
    audit_query="SELECT metadata->>'ip_address' AS ip_address FROM acmd.audit_logs WHERE metadata->>'ip_address' IS NOT NULL ORDER BY created_at DESC LIMIT 5"
    audit_stderr=$(mktemp)
    set +e
    recent_ips=$(docker exec -i "$pg_container" psql -U "$pg_user" -d "$pg_db" -tA \
      -c "$audit_query" 2>"$audit_stderr")
    audit_rc=$?
    set -e
    if [ "$audit_rc" -ne 0 ]; then
      err_msg=$(cat "$audit_stderr" 2>/dev/null || true)
      rm -f "$audit_stderr"
      fail "R09 audit_logs spot-check failed (psql exit=$audit_rc) — likely schema drift; check table acmd.audit_logs + metadata jsonb. stderr: ${err_msg}"
    fi
    rm -f "$audit_stderr"
    if [ -z "$recent_ips" ]; then
      log "audit_logs has no rows with metadata->>'ip_address' — skipping R09 spot-check (operator should run runbook §6 query after first real signup)"
    else
      ok_real=0
      while IFS= read -r ip; do
        [ -z "$ip" ] && continue
        case "$ip" in
          172.*|10.*|192.168.*) : ;;   # docker bridge / private — keep looking
          *) ok_real=1 ;;
        esac
      done <<EOF
$recent_ips
EOF
      if [ "$ok_real" = "1" ]; then
        green "R09 audit_logs spot-check OK (real client IP observed)"
      else
        log "WARN: all 5 recent audit_logs metadata->>'ip_address' values are docker-bridge IPs"
        log "WARN: this likely means TRUSTED_PROXY_IPS does not match vollos-network subnet"
        log "WARN: operator MUST verify (PROD_RUNBOOK.md §3.4 + §6) before relying on per-IP rate limit"
        log "WARN: not failing the deploy — flag-and-warn so first deploy is not blocked"
      fi
    fi
  else
    log "vollos-core-postgres container not visible from this host — skipping R09 spot-check"
  fi
else
  log "docker CLI unavailable — skipping R09 spot-check"
fi

green "ALL SMOKE CHECKS PASSED"

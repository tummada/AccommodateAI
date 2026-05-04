---
task_id: T-095
title: Plan A — force-recreate Caddy on VPS to pickup new Caddyfile (266 lines with accommodate routes)
agent: vollos-devops
spawn_started_at: 2026-04-29T15:55+07:00
mode: MODE_3 (production change — short downtime ~3-5s)
priority: HIGH (blocks acmd Lead's T-071 deploy)
estimated_time: 5-10 min
dependencies: [T-094 (diagnostic confirmed bind-mount inode pin + admin off)]
parent_context: "T-094 confirmed Caddy still serves old config (189-line). Root cause: single-file bind mount pins inode at container start; git reset --hard replaced host file with new inode; container still reads orphan inode. Reload impossible because admin off in Caddyfile. Owner approved Plan A: force-recreate Caddy container with ~3-5s downtime (no users at this hour, US timezone 04:00 PT). Plan B (MR enable admin Unix socket + directory mount) follows in T-096."
---

## Goal

1. Pre-flight: backup Caddyfile state for rollback (in case container fails to start with new config)
2. `docker compose up -d --force-recreate caddy` — graceful container recreate
3. Verify post-recreate: container healthy + new Caddyfile loaded (266 lines) + accommodate routes responding
4. Smoke test 3 acmd subdomains + 3 vollos subdomains (no regression)
5. Report back to Lead@vollos-core for Lead@acmd handoff

## VPS Access

- Host/User/Key: see memory `project_vps_access.md` ($VPS_HOST = 187.124.244.96, user ipon, key `~/.ssh/vollos_deploy_v3`)
- Deploy path on VPS: discover via `ls ~/` first — likely `/home/ipon/vollos`
- Caddy container name: `vollos-core-caddy` (verify via `docker ps`)

## Implementation Steps

### Step 1 — Pre-flight checks (read-only)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 << 'EOF'
echo "=== Repo path ===" && ls -d ~/vollos* ~/vollos-core 2>/dev/null
echo ""
echo "=== Caddy container current ===" && docker ps --filter name=caddy --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"
echo ""
echo "=== git HEAD on VPS repo ===" && cd ~/vollos 2>/dev/null && git log --oneline -3
echo ""
echo "=== Host Caddyfile line count ===" && wc -l ~/vollos/infra/Caddyfile 2>/dev/null
echo ""
echo "=== Caddyfile syntax validate (host) ===" && docker run --rm -v ~/vollos/infra/Caddyfile:/etc/caddy/Caddyfile caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --pretty 2>&1 | head -5
EOF
```

**Pre-flight gates (must pass before Step 2):**
- Caddy container exists + running
- Host Caddyfile has accommodate routes (line count >= 250)
- caddy adapt exits 0 (config syntactically valid)
- git HEAD on VPS = recent commit (not pre-MR !30)

If any gate fails → STOP, escalate to Lead.

### Step 2 — Create rollback safety net

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 << 'EOF'
cd ~/vollos
echo "=== Backup current Caddy state ==="
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker inspect vollos-core-caddy > /tmp/caddy-pre-recreate-$TIMESTAMP.json
echo "Backup saved: /tmp/caddy-pre-recreate-$TIMESTAMP.json"
echo ""
echo "=== Note current image SHA + git SHA for rollback ===" 
docker inspect vollos-core-caddy --format='{{.Image}}' 
git rev-parse HEAD
EOF
```

### Step 3 — Force-recreate Caddy (the actual change)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 << 'EOF'
cd ~/vollos
echo "=== Recreating caddy container (downtime begins) ==="
START=$(date +%s)
docker compose up -d --force-recreate --no-deps caddy
EXIT=$?
END=$(date +%s)
echo "Recreate exit code: $EXIT | duration: $((END-START))s"

if [ $EXIT -ne 0 ]; then
  echo "❌ FAILED — investigating"
  docker logs vollos-core-caddy --tail 30
  exit 1
fi

echo ""
echo "=== Wait for healthy ==="
for i in 1 2 3 4 5 6; do
  STATUS=$(docker inspect vollos-core-caddy --format='{{.State.Health.Status}}' 2>/dev/null || docker inspect vollos-core-caddy --format='{{.State.Status}}')
  echo "[$i] caddy status: $STATUS"
  if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then break; fi
  sleep 2
done

echo ""
echo "=== Verify Caddy loaded new config ==="
docker exec vollos-core-caddy wc -l /etc/caddy/Caddyfile
docker exec vollos-core-caddy grep -c "accommodate" /etc/caddy/Caddyfile

echo ""
echo "=== Caddy startup log (last 20 lines) ==="
docker logs vollos-core-caddy --tail 20 2>&1
EOF
```

### Step 4 — Smoke test (from Lead workstation)

```bash
echo "=== Smoke 6 subdomains ==="
for URL in https://accommodate.vollos.ai https://accommodate-app.vollos.ai https://accommodate-api.vollos.ai/health \
           https://vollos.ai https://auth.vollos.ai/health https://api.vollos.ai/health; do
  CODE=$(curl -sk -o /tmp/T-095-resp -w "%{http_code}" -m 10 "$URL")
  SIZE=$(wc -c < /tmp/T-095-resp)
  PREVIEW=$(head -c 80 /tmp/T-095-resp | tr -d '\n' | head -c 80)
  echo "$URL → HTTP $CODE | size=$SIZE | body[80]='$PREVIEW'"
done
rm -f /tmp/T-095-resp
```

**Expected:**
- vollos.ai/auth/api: HTTP 200, body NOT empty (no regression)
- accommodate.* / accommodate-app.*: HTTP 502 acceptable (acmd container not yet on :8080 — T-071 not deployed) — IMPORTANT: 502 from upstream-unreachable is GOOD; means Caddy IS routing to backend (just backend not up)
- accommodate-api.*: HTTP 502 same reason

If accommodate.* returns body=0 (empty catchall) → recreate failed to load new config → rollback

### Step 5 — Cleanup

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 'history -c && history -w'
history -c && history -w  # local
```

## Rollback Plan (if recreate fails)

If Step 3 exit != 0 OR Step 4 smoke shows vollos.ai regression:
1. `docker compose up -d --no-recreate caddy` (try lighter restart)
2. If still failed → `git stash + git reset --hard <previous SHA>` + recreate
3. Or temporary: revert Caddyfile to pre-MR-!30 state via `git checkout <SHA>~1 -- infra/Caddyfile` + recreate

## Acceptance Criteria

1. ✅ Pre-flight 4 gates pass (container exists / Caddyfile valid / git recent / accommodate present)
2. ✅ Recreate exit 0 + container healthy within 30s
3. ✅ Caddy in-container Caddyfile shows 266 lines + accommodate matches
4. ✅ vollos.ai 3 subdomains: HTTP 200 (no regression)
5. ✅ accommodate.* 3 subdomains: HTTP 502 from Caddy→upstream (proves routing works) OR 200 if acmd container coincidentally up
6. ✅ Total downtime < 30 seconds (target ~5s)
7. ✅ Bash history cleared

## Self-Review Required

```yaml
self_review:
  - field: "preflight_gates_passed"
    result: true/false
    evidence: "Step 1 output → all 4 gates green"
  - field: "recreate_succeeded"
    result: true/false
    evidence: "docker compose up exit 0 + caddy healthy in 30s"
  - field: "new_config_loaded_in_container"
    result: true/false
    evidence: "docker exec wc -l /etc/caddy/Caddyfile = 266 + accommodate grep > 0"
  - field: "no_vollos_regression"
    result: true/false
    evidence: "smoke vollos.ai/auth/api → all HTTP 200 with non-empty body"
  - field: "accommodate_now_routed_not_catchall"
    result: true/false
    evidence: "smoke accommodate.* → either 200 OR 502 with non-empty body (Caddy upstream error msg) — NOT empty body catchall"
  - field: "downtime_under_30s"
    result: true/false
    evidence: "Step 3 duration measure < 30 (target 5s)"
  - field: "history_cleared"
    result: true/false
    evidence: "history -c && history -w on both workstation + VPS"
```

## Forbidden

- `docker stop caddy` then `docker start` (= longer downtime than recreate)
- `docker exec caddy caddy reload` (already failed in T-094 — admin off)
- Modify Caddyfile on VPS directly (use git-tracked file only)
- `docker compose config` (leaks secrets)
- Skip pre-flight gates

## Cleanup

- bash history clear (Lead workstation + VPS)
- Keep `/tmp/caddy-pre-recreate-*.json` backup file 24h then delete

## Domain Consultation

ไม่ต้อง — pure infra recreate

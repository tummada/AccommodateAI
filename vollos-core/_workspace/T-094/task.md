---
task_id: T-094
title: Reload Caddy on VPS — pickup new Caddyfile (acmd subdomains routes from MR !30)
agent: vollos-devops
spawn_started_at: 2026-04-29T15:45+07:00
mode: MODE_3 (production change — graceful reload)
priority: HIGH (blocks acmd Lead's T-071 deploy)
estimated_time: 5-10 min
dependencies: [T-090 (MR !30 merged — accommodate.* routes added to Caddyfile)]
parent_context: "acmd Lead handshake [5] (2026-04-29 15:38 ICT) reports: vollos-core/infra/Caddyfile on VPS has 266 lines on-disk (with accommodate.* routes from MR !30) but Caddy running config is still 189 lines (old, pre-MR !30). Pipeline #2487091834 from MR !30 deploy succeeded but evidently container restart did not pickup new config. acmd 3 subdomains return empty body = catchall, not reaching backend. Need graceful Caddy reload to pickup new config."
---

## Goal

1. Verify on-disk vs running Caddyfile diff on VPS (sanity check acmd's claim)
2. Graceful reload Caddy → pickup accommodate.* routes
3. Smoke test 3 acmd subdomains post-reload (must return Caddy-routed response, not catchall)
4. Report back to Lead@acmd via Lead@vollos-core

## VPS Access

- Host: 187.124.244.96 (env var $VPS_HOST or memory `project_vps_access.md`)
- User: ipon
- SSH key: `~/.ssh/vollos_deploy_v3`
- Deploy path: `/home/ipon/vollos` (legacy name — not `/home/ipon/vollos-core` per memory)
  - Note: verify actual path via `ssh && ls ~/` first — may have changed

## Implementation Steps

### Step 1 — Diagnostic (read-only, mandatory before reload)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 << 'EOF'
echo "=== Caddy container status ==="
docker ps --filter name=caddy --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo ""
echo "=== On-disk Caddyfile line count ==="
docker exec vollos-core-caddy wc -l /etc/caddy/Caddyfile 2>/dev/null || \
  docker exec $(docker ps --filter name=caddy -q | head -1) wc -l /etc/caddy/Caddyfile

echo ""
echo "=== Caddy on-disk has accommodate routes? ==="
docker exec $(docker ps --filter name=caddy -q | head -1) grep -c "accommodate" /etc/caddy/Caddyfile

echo ""
echo "=== Running config — count routes via admin API ==="
docker exec $(docker ps --filter name=caddy -q | head -1) curl -s localhost:2019/config/apps/http/servers 2>/dev/null | python3 -c "import json,sys; cfg=json.load(sys.stdin); print('Servers:', list(cfg.keys()) if cfg else 'NONE')" 2>/dev/null || echo "admin API not accessible (might need to use config file diff instead)"

echo ""
echo "=== Last reload time (if any) ==="
docker logs --tail 50 $(docker ps --filter name=caddy -q | head -1) 2>&1 | grep -iE "reload|loaded|config" | tail -5
EOF
```

### Step 2 — Reload (only if Step 1 confirms diff)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96 << 'EOF'
CADDY_CONTAINER=$(docker ps --filter name=caddy -q | head -1)
echo "Reloading Caddy container: $CADDY_CONTAINER"

# Graceful reload (no connection drop)
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile
RELOAD_EXIT=$?
echo "Reload exit code: $RELOAD_EXIT"

if [ $RELOAD_EXIT -ne 0 ]; then
  echo "❌ Reload failed — investigating..."
  docker logs --tail 30 "$CADDY_CONTAINER" 2>&1 | tail -20
  exit 1
fi

echo ""
echo "=== Post-reload verification ==="
sleep 2
docker logs --tail 10 "$CADDY_CONTAINER" 2>&1 | grep -iE "reload|config|loaded" | tail -5
EOF
```

### Step 3 — Smoke test (from Lead's machine, not VPS)

```bash
echo "=== Smoke 3 acmd subdomains post-reload ==="
for URL in https://accommodate.vollos.ai https://accommodate-app.vollos.ai https://accommodate-api.vollos.ai/health; do
  RESP=$(curl -sk -o /tmp/T-094-resp -w "HTTP %{http_code} | size=%{size_download} | time=%{time_total}s" -m 10 "$URL")
  BODY_PREVIEW=$(head -c 100 /tmp/T-094-resp | tr -d '\n')
  echo "$URL → $RESP | body[100]: $BODY_PREVIEW"
done
rm -f /tmp/T-094-resp
```

Expected:
- Before reload: body empty (Caddy catchall — acmd's report)
- After reload: body has actual response (or 502 if acmd container ไม่ฟังที่ :8080 ตามที่ acmd ยังไม่ deploy T-071) — แต่ต้องเป็น 502 ที่ "Caddy → upstream" ไม่ใช่ "default catchall"

### Step 4 — Cleanup

- ตามกฎ Secret Handling Protocol: clear bash history (Lead workstation + VPS)
- ไม่มี secret touched ใน task นี้ — แค่ reload

## Acceptance Criteria

1. ✅ Step 1 confirms Caddyfile on-disk has accommodate routes (grep > 0)
2. ✅ Step 1 confirms running config differs from on-disk (line count or route count)
3. ✅ Caddy reload exit 0 + log shows "config loaded"
4. ✅ Step 3 smoke: response NOT empty/catchall (either 200 from real backend, or proper 502 indicating Caddy reached upstream)
5. ✅ Lead@vollos-core can report back to Lead@acmd with concrete evidence

## Self-Review Required

```yaml
self_review:
  - field: "diagnostic_confirms_acmd_claim"
    result: true/false
    evidence: "Step 1 output → on-disk has 'accommodate' grep count >= 6, running differs"
  - field: "caddy_reload_succeeded"
    result: true/false
    evidence: "Step 2 — exit 0 + log line 'config loaded' or similar"
  - field: "smoke_test_post_reload_routed"
    result: true/false
    evidence: "Step 3 — body NOT empty for at least 1 acmd subdomain (or proper 502 backend-unreachable)"
  - field: "no_user_impact"
    result: true/false
    evidence: "graceful reload — no container restart, no connection drop"
  - field: "ssh_history_cleared_post_task"
    result: true/false
    evidence: "ssh ipon@vps 'history -c && history -w' run successfully"
```

## Forbidden

- `docker compose down` / `docker restart caddy` (would drop connections — use `caddy reload` only)
- `docker compose config` (resolves env, leaks secrets — per secret protocol)
- Touch any other container or service
- Modify Caddyfile on VPS directly (config = git-managed — ถ้าต้องแก้ ผ่าน MR ใหม่)

## Cleanup

- bash history clear on Lead workstation + VPS

## Domain Consultation

ไม่ต้อง — pure infra reload

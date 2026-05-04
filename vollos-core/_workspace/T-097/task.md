---
task_id: T-097
title: Pre-merge VPS cert migration — move infra/certs/* → infra/caddy/certs/ on VPS (LOW-1 from T-096 audit)
agent: vollos-devops
spawn_started_at: 2026-04-29T16:25+07:00
mode: MODE_3 (production VPS state change — no downtime expected)
priority: HIGH (blocks MR !33 merge)
estimated_time: 5-10 min
dependencies: [T-096 (MR !33 ready, NOT yet merged)]
parent_context: "T-096 Auditor LOW-1: when MR !33 merges, deploy pipeline will git fetch + reset --hard which moves Caddyfile + certs path from infra/ → infra/caddy/ in the repo. But the VPS file system already has certs at ~/vollos-core/infra/certs/ from previous deploys (gitignored, synced out-of-band). After git reset, VPS file system will have empty infra/caddy/certs/ + leftover infra/certs/ → Caddy fails to find cloudflare.pem → start fails. Migrate VPS cert directory ahead of merge to prevent this."
---

## Goal

Migrate Cloudflare Origin Cert files on VPS from `infra/certs/` → `infra/caddy/certs/` so MR !33's deploy doesn't break Caddy startup. NO downtime — current Caddy container keeps using its already-loaded certs in memory.

## VPS Access

- Host/User/Key: see memory `project_vps_access.md`
- Repo path: `~/vollos-core` (verified T-095)

## Implementation Steps

### Step 1 — Pre-flight (read-only)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@$VPS_HOST << 'EOF'
echo "=== Current state on VPS ==="
ls -la ~/vollos-core/infra/certs/ 2>/dev/null
echo ""
echo "=== Git working tree clean? ==="
cd ~/vollos-core && git status --short
echo ""
echo "=== Caddy container — currently using certs from where? ==="
docker exec vollos-core-caddy ls -la /etc/caddy/certs/ 2>/dev/null
EOF
```

**Pre-flight gates:**
- ✅ infra/certs/ exists on VPS with cloudflare.pem + cloudflare.key
- ✅ git working tree clean (no uncommitted changes that would conflict with mkdir/mv)
- ✅ Caddy container running + has certs loaded in memory (it'll keep serving even if disk certs move — Caddy reads certs at startup into memory)

If any gate fails → STOP, escalate.

### Step 2 — Create new dir + move certs (atomic on same filesystem)

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@$VPS_HOST << 'EOF'
cd ~/vollos-core
echo "=== Backup symlink (rollback safety) ==="
# Don't backup actual files — too sensitive. Just record current state.
ls -la infra/certs/ > /tmp/T-097-pre-state.txt
echo "Pre-state recorded: /tmp/T-097-pre-state.txt"

echo ""
echo "=== Create new path ==="
mkdir -p infra/caddy/certs
echo "Created: infra/caddy/certs/"

echo ""
echo "=== Move certs (atomic on same FS) ==="
mv infra/certs/cloudflare.pem infra/caddy/certs/
mv infra/certs/cloudflare.key infra/caddy/certs/
echo "Moved 2 files"

echo ""
echo "=== Set ownership (Caddy runs as uid 1000) ==="
chown 1000:1000 infra/caddy/certs/cloudflare.pem
chown 1000:1000 infra/caddy/certs/cloudflare.key
chmod 644 infra/caddy/certs/cloudflare.pem
chmod 600 infra/caddy/certs/cloudflare.key

echo ""
echo "=== Cleanup empty old dir ==="
rmdir infra/certs/ 2>/dev/null && echo "Removed old infra/certs/" || echo "infra/certs/ not empty — investigating"
ls -la infra/certs/ 2>/dev/null

echo ""
echo "=== Verify new state ==="
ls -la infra/caddy/certs/
EOF
```

### Step 3 — Verify Caddy still serving

```bash
echo "=== Smoke test 6 subdomains (no Caddy restart performed — should still serve) ==="
for URL in https://vollos.ai https://auth.vollos.ai/health https://api.vollos.ai/health \
           https://accommodate.vollos.ai https://accommodate-app.vollos.ai https://accommodate-api.vollos.ai/health; do
  CODE=$(curl -sk -o /dev/null -w "%{http_code}" -m 8 "$URL")
  echo "$URL → HTTP $CODE"
done
```

**Expected (same as before T-097):**
- vollos.ai 3 subdomains: HTTP 200
- accommodate.* 3 subdomains: HTTP 502 (acmd container still not deployed — same as T-095 result)

**If vollos.ai regresses → Caddy lost certs in memory somehow** (unlikely but possible if container restarted between Step 1 and Step 3 due to external factor) → emergency: `cp` certs back temporarily.

### Step 4 — Cleanup

```bash
ssh -i ~/.ssh/vollos_deploy_v3 ipon@$VPS_HOST 'history -c && history -w'
history -c && history -w
```

## Acceptance Criteria

1. ✅ Pre-flight gates 3/3 green
2. ✅ infra/caddy/certs/ exists on VPS with both files (chown 1000:1000, perms 644/600)
3. ✅ Old infra/certs/ removed (or empty if rmdir failed)
4. ✅ Smoke test 6 subdomains: same status as before (3 vollos 200, 3 acmd 502)
5. ✅ NO Caddy container restart triggered during Step 2
6. ✅ Bash history cleared

## Self-Review Required

```yaml
self_review:
  - field: "preflight_3_gates_passed"
    result: true/false
    evidence: "Step 1 output → infra/certs has 2 files, git clean, Caddy running"
  - field: "certs_moved_to_new_path"
    result: true/false
    evidence: "Step 2 ls output → infra/caddy/certs/cloudflare.pem + .key both present"
  - field: "ownership_perms_correct"
    result: true/false
    evidence: "ls -la output shows owner=1000:1000, .pem=644, .key=600"
  - field: "old_dir_cleaned"
    result: true/false
    evidence: "rmdir infra/certs/ succeeded OR ls shows empty"
  - field: "no_caddy_regression"
    result: true/false
    evidence: "smoke 3 vollos subdomains → all 200 (matches pre-T-097)"
  - field: "caddy_not_restarted"
    result: true/false
    evidence: "docker inspect vollos-core-caddy --format='{{.State.StartedAt}}' unchanged from pre-task value"
  - field: "history_cleared"
    result: true/false
    evidence: "history -c && history -w on both endpoints"
```

## Forbidden

- `cp` then `rm` (race window — use `mv` for atomic on same FS)
- `chmod 777` (over-permissive)
- Touch any file other than 2 cert files
- Restart Caddy container (out of scope — Plan B MR !33 does that on merge)
- `cat` cert files (potential PEM key leak)
- `docker compose config` raw (per secret protocol)

## Rollback Plan

If anything breaks:
1. `mkdir -p ~/vollos-core/infra/certs && mv ~/vollos-core/infra/caddy/certs/* ~/vollos-core/infra/certs/ && chown 1000:1000 ~/vollos-core/infra/certs/*`
2. Restart Caddy if needed: `docker compose up -d --force-recreate --no-deps caddy`

## Cleanup

- bash history clear (Lead workstation + VPS)
- /tmp/T-097-pre-state.txt remove after task

## Domain Consultation

ไม่ต้อง — pure infra file move

## After this task — what unblocks

- MR !33 ready to merge safely (cert path on VPS now matches new docker-compose mount target)
- Lead coordinates with owner: "MR !33 พร้อม merge — cert path บน VPS migrate แล้ว"

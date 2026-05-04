---
task_id: T-090
title: Caddy upstream retarget — acmd-web/landing port 80 → 8080 (handshake [3] from acmd)
agent: vollos-devops
spawn_started_at: 2026-04-29T10:35+07:00
mode: MODE_1
priority: HIGH (timing-sensitive — coordinate with acmd MR T-071 merge)
estimated_time: 15 min
dependencies: [T-085 (Caddy flat 1-level pattern), MR !29 merged (board restore)]
parent_context: "acmd Lead@acmd handshake [3]: T-071 (T-061 round 2 fix) เปลี่ยน acmd-web + acmd-landing จาก nginx:alpine (root, port 80) → nginxinc/nginx-unprivileged:alpine (USER nginx, port 8080) เพื่อปิด Auditor finding DOCKER-001 (CIS Benchmark 4.1 — containers ห้าม run as root). acmd ส่ง message 2026-04-29 09:53 ICT ขอให้ vollos-core update Caddy upstream port. Reference: acmd/_workspace/T-071-t061-fix-r2/output.md (I-1)."
---

## Goal

Update `infra/Caddyfile` reverse_proxy upstream ports for 2 acmd subdomains (port 80 → 8080), open MR, **DO NOT MERGE** จนกว่า Lead จะ coordinate กับ acmd Lead เรื่อง timing

## Owned Files

- **MODIFIED:** `infra/Caddyfile` (2 lines only — L237 + L250)

## Branch Strategy

- Branch: `chore/caddy-acmd-upstream-port-8080`
- Open MR — wait Auditor review + Lead coordination before merge

## Exact Changes Required

### Change 1: accommodate.vollos.ai upstream

**File:** `infra/Caddyfile`
**Line:** 237 (within `accommodate.vollos.ai { ... }` block at L228)

**Before:**
```
	reverse_proxy acmd-landing:80 {
```

**After:**
```
	reverse_proxy acmd-landing:8080 {
```

**Comment update (L230):**

**Before:**
```
# accommodate.vollos.ai → acmd-landing:80 (static SPA marketing site)
```

**After:**
```
# accommodate.vollos.ai → acmd-landing:8080 (static SPA, nginx-unprivileged on port 8080)
```

### Change 2: accommodate-app.vollos.ai upstream

**File:** `infra/Caddyfile`
**Line:** 250 (within `accommodate-app.vollos.ai { ... }` block at L243)

**Before:**
```
	reverse_proxy acmd-web:80 {
```

**After:**
```
	reverse_proxy acmd-web:8080 {
```

**Comment update (L243):**

**Before:**
```
# accommodate-app.vollos.ai → acmd-web:80 (nginx-served React SPA)
```

**After:**
```
# accommodate-app.vollos.ai → acmd-web:8080 (React SPA, nginx-unprivileged on port 8080)
```

### NOT touched (verify untouched):

- `accommodate-api.vollos.ai → acmd-api:3101` (L256+) — keep as is
- All 3 vollos.ai subdomains (auth/api/landing) at L125/156/188 — keep as is
- security_headers snippet — keep as is
- TLS cert paths — keep as is

## Implementation Steps

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core

# Step 1: Sync main + cleanup merged branches
git checkout main
git pull origin main
git branch -d chore/restore-board-session-006-009  # T-089 merged
git branch -d feat/sync-secrets-script             # T-088 merged (if not already)

# Step 2: Create branch
git checkout -b chore/caddy-acmd-upstream-port-8080

# Step 3: Edit Caddyfile (use Edit tool, not sed — to preserve indentation)
# Verify before/after with diff:
git diff infra/Caddyfile
# Expected: 4 lines changed total (2 reverse_proxy + 2 comments)

# Step 4: Validate Caddyfile syntax (mandatory before commit)
docker run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
# Must exit 0 — if fail, do NOT commit

# Step 5: Commit + push
git add infra/Caddyfile
git commit -m "chore(caddy): retarget acmd-web/landing upstream to port 8080

acmd T-071 switched acmd-web + acmd-landing containers from
nginx:alpine (root, :80) to nginxinc/nginx-unprivileged:alpine
(USER nginx, :8080) to close DOCKER-001 (CIS Benchmark 4.1).

Update reverse_proxy upstreams accordingly. acmd-api (:3101)
unchanged.

Reference: acmd handshake [3] 2026-04-29 09:53 ICT
Cross-repo: acmd/_workspace/T-071-t061-fix-r2/output.md (I-1)"
git push -u origin chore/caddy-acmd-upstream-port-8080

# Step 6: Open MR via GitLab API
# MR title: "chore(caddy): retarget acmd-web/landing upstream to :8080 (handshake [3] from acmd)"
# MR body: Include cross-repo reference + timing warning
# Set merge_when_pipeline_succeeds: false (DO NOT auto-merge — Lead coordinates)
```

## Acceptance Criteria

1. ✅ `infra/Caddyfile` 2 reverse_proxy lines changed (acmd-landing:8080 + acmd-web:8080)
2. ✅ 2 comment lines updated to match
3. ✅ accommodate-api.vollos.ai (acmd-api:3101) untouched (verify with grep)
4. ✅ vollos.ai/auth.vollos.ai/api.vollos.ai untouched
5. ✅ `caddy validate` exits 0
6. ✅ Branch pushed + MR opened
7. ✅ MR description warns: **DO NOT MERGE until acmd Lead coordinates timing** (downtime risk: merge our MR → 502 until acmd merges T-071; merge sequence must be: vollos-core MR → wait — acmd merge T-071 → both deploy → smoke test live)

## Self-Review Required

```yaml
self_review:
  - field: "caddyfile_2_upstream_lines_changed"
    result: true/false
    evidence: "infra/Caddyfile:237 + :250 — both show :8080"
  - field: "caddyfile_2_comments_updated"
    result: true/false
    evidence: "infra/Caddyfile:230 + :243 — comments mention 8080 + nginx-unprivileged"
  - field: "acmd_api_3101_untouched"
    result: true/false
    evidence: "grep 'acmd-api:3101' infra/Caddyfile → 1 match (unchanged)"
  - field: "vollos_subdomains_untouched"
    result: true/false
    evidence: "git diff infra/Caddyfile — only 4 lines changed, all in acmd subdomain blocks (L228-254)"
  - field: "caddy_validate_passed"
    result: true/false
    evidence: "docker run caddy validate exit 0 — output 'Valid configuration'"
  - field: "branch_pushed_mr_opened"
    result: true/false
    evidence: "MR URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/N (state: opened)"
  - field: "mr_body_warns_no_merge_yet"
    result: true/false
    evidence: "MR description contains explicit DO NOT MERGE timing warning"
```

## Applicable Rules

- **CLAUDE.md "Best Practices > Git"** — MR workflow, conventional commits, NO push to main
- **feedback_check_pipeline_before_push_main.md** — push main = auto-deploy; this MR will trigger auto-deploy on merge → must coordinate timing
- **D14 (board commit policy)** — board NOT touched in this task → no board commit needed
- **Architecture Rule D1+D2+D4** — vollos-network, postgres in 2 networks (not changed)
- **No security headers / TLS / CORS changes** — security posture unchanged

## Forbidden

- Push to main directly
- Merge MR auto (merge_when_pipeline_succeeds=false)
- Touch any line outside the 4 specified
- Add/remove TLS, CORS, security_headers config

## Domain Consultation

ไม่ต้อง — ภายใน infra config change, no domain logic

## Cleanup

- Standard git history clear post-task
- Note in output.md: which acmd Lead must be notified after MR opens to coordinate merge timing

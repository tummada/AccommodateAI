---
task_id: T-093
title: Cosmetic fix — Caddyfile header comments L203-204 still reference :80
agent: vollos-devops
spawn_started_at: 2026-04-29T11:05+07:00
mode: MODE_1
priority: low (cosmetic — docs alignment only, no runtime impact)
estimated_time: 5 min
dependencies: [T-090 (MR !30 merged — runtime upstreams already :8080)]
parent_context: "T-090 spec strictly forbade touching anything outside the 4 specified lines. As a result, header documentation comments at infra/Caddyfile L203-204 still reference acmd-landing:80 + acmd-web:80, while runtime config (L227/234/242/249) correctly points to :8080. Owner approved cosmetic cleanup 2026-04-29."
---

## Goal

Update 2 header documentation comments in `infra/Caddyfile` to align with current runtime config (port :8080)

## Owned Files

- **MODIFIED:** `infra/Caddyfile` (2 lines only — L203 + L204)

## Branch Strategy

- Sync main first
- Branch: `chore/caddy-header-comment-port-alignment`
- Open MR + ready for owner merge

## Exact Changes

### File: `infra/Caddyfile`

**Line 203 — Before:**
```
#   - acmd-landing:80    static SPA (marketing landing)
```

**Line 203 — After:**
```
#   - acmd-landing:8080  static SPA (marketing landing — nginx-unprivileged)
```

**Line 204 — Before:**
```
#   - acmd-web:80        nginx-served React SPA (authenticated app)
```

**Line 204 — After:**
```
#   - acmd-web:8080      React SPA, authenticated (nginx-unprivileged)
```

### NOT touched (verify untouched):

- L227/234/242/249 (runtime acmd config — already :8080) — leave as-is
- L205+ (acmd-api:3101 docs) — leave as-is
- vollos.ai/auth.vollos.ai/api.vollos.ai blocks — leave as-is
- security_headers / TLS / CORS — leave as-is

## Implementation

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
git checkout main && git pull origin main
git branch -d fix/sync-secrets-curl-argv-leak  # cleanup if MR !31 merged

git checkout -b chore/caddy-header-comment-port-alignment

# Use Edit tool — exact strings only
# After edit, verify:
git diff infra/Caddyfile
# Expected: 2 lines changed (L203 + L204)

# Validate Caddyfile syntax (cosmetic but mandatory)
docker run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
# Must exit 0

# Commit + push
git add infra/Caddyfile
git commit -m "chore(caddy): align header docs with :8080 runtime upstreams (T-093)

T-090 MR !30 switched runtime upstreams to :8080 but left header
documentation comments (L203-204) referencing :80 to keep diff
minimal. This patch aligns the docs to match runtime config —
zero functional change."
git push -u origin chore/caddy-header-comment-port-alignment

# Open MR via GitLab API
# Title: chore(caddy): align header docs with :8080 runtime upstreams (T-093)
# Note: cosmetic only — safe to merge anytime, no timing constraint
```

## Acceptance Criteria

1. ✅ L203 + L204 updated to `:8080` + comment text aligned with nginx-unprivileged context
2. ✅ Only 2 lines changed (verify with `git diff --stat`)
3. ✅ caddy validate passes
4. ✅ Branch pushed + MR opened
5. ✅ MR description notes "cosmetic only, no runtime impact, safe to merge anytime"

## Self-Review Required

```yaml
self_review:
  - field: "exactly_2_lines_changed"
    result: true/false
    evidence: "git diff --stat → infra/Caddyfile | 2 +/- (or similar 2-line indicator)"
  - field: "l203_l204_show_8080"
    result: true/false
    evidence: "infra/Caddyfile:203 + :204 — both contain ':8080'"
  - field: "runtime_lines_untouched"
    result: true/false
    evidence: "git diff origin/main -- infra/Caddyfile | grep -cE '^[-+].*reverse_proxy' → 0"
  - field: "caddy_validate_passed"
    result: true/false
    evidence: "docker caddy validate exit 0"
  - field: "branch_pushed_mr_opened"
    result: true/false
    evidence: "MR URL https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/N (state: opened)"
```

## Forbidden

- Touch any line outside L203-L204
- Add/remove TLS, CORS, reverse_proxy, security_headers
- Push to main directly

## Cleanup

ไม่ต้อง — pure docs change

## Domain Consultation

ไม่ต้อง — cosmetic only

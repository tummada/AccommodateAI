---
task_id: T-031
agent: vollos-devops
status: complete
verdict: MISSING
completed_at: 2026-04-19T17:35+07:00
---

# T-031 — Deploy Secrets Verification (tummadajingjing/vollos-core)

## Method

Read-only GitLab API call:
```
GET /api/v4/projects/tummadajingjing%2Fvollos-core/variables?per_page=100
```
Authenticated with `VOLLOS_CLI` (sourced silently from `/home/ipon/workspace/vollos/.env`).
Response piped through `jq -r '.[].key' | sort` — KEYS ONLY. No values inspected, printed, or logged.

## All 19 Keys on New Project (sorted)

1. `ACMD_USER_PASSWORD`
2. `AUTH_RSA_PRIVATE_KEY`
3. `AUTH_RSA_PUBLIC_KEY`
4. `AUTH_USER_PASSWORD`
5. `GMAIL_USER`
6. `GOOGLE_CLIENT_ID`
7. `GOOGLE_CLIENT_SECRET`
8. `GOOGLE_REFRESH_TOKEN`
9. `POSTGRES_PASSWORD`
10. `R2_ACCESS_KEY_ID`
11. `R2_BUCKET_NAME`
12. `R2_ENDPOINT`
13. `R2_SECRET_ACCESS_KEY`
14. `T006_MIGRATION_TEST`
15. `TELEGRAM_BOT_TOKEN`
16. `TELEGRAM_CHAT_ID`
17. `TURNSTILE_SECRET_KEY`
18. `UNSUBSCRIBE_SECRET`
19. `VOLLOS_USER_PASSWORD`

Total count: **19** (matches T-029 migration count).

## Required Deploy Keys — Presence Check

Referenced by `.gitlab-ci.yml` deploy job (lines 46, 48):

| Key | Present? |
|-----|----------|
| `VPS_SSH_KEY` | ❌ MISSING |
| `VPS_USER` | ❌ MISSING |
| `VPS_HOST` | ❌ MISSING |

## Deploy-Related Keys with Non-Standard Names

Grep pattern `VPS|DEPLOY|SSH|SERVER|HOST|USER` (case-insensitive) against the 19 keys:

| Match | Category | Is this a deploy secret? |
|-------|----------|--------------------------|
| `GMAIL_USER` | Email/SMTP account | ❌ No — Gmail SMTP login |
| `AUTH_USER_PASSWORD` | DB user password | ❌ No — Postgres `auth_user` |
| `VOLLOS_USER_PASSWORD` | DB user password | ❌ No — Postgres `vollos_user` |
| `ACMD_USER_PASSWORD` | DB user password | ❌ No — Postgres `acmd_user` |

**No SSH-key, no hostname, no deploy username** found under alternative naming (e.g., `DEPLOY_SSH_KEY`, `SSH_PRIVATE_KEY`, `SERVER_HOST`, `PROD_USER`). The 19 migrated variables contain zero deploy/SSH credentials.

## Verdict

**MISSING: [VPS_SSH_KEY, VPS_USER, VPS_HOST]**

Deploy test would fail at `.gitlab-ci.yml` deploy stage — SSH step cannot proceed without all three. Owner must add these three CI/CD variables (masked + protected) before running real deploy test.

### Recommended action for Lead

Spawn follow-up DevOps task to:
1. Add `VPS_SSH_KEY` (private key content, File type, masked, protected)
2. Add `VPS_USER` (masked, protected)
3. Add `VPS_HOST` (masked, protected)

Values likely recoverable from the old project `vollos-ai/vollos` (if that project still holds them) or from `/home/ipon/.claude/projects/.../memory/project_vps_access.md` (IP + user + key path recorded). **DevOps must NOT print values — copy via GitLab UI or `curl POST` with masked env vars only.**

## Self-Review

| # | Acceptance Criterion | Result | Evidence |
|---|----------------------|--------|----------|
| 1 | All 19 variable keys listed on new project | ✅ true | Section "All 19 Keys" above — count verified via `jq '.[].key' \| wc -l` = 19 |
| 2 | `VPS_SSH_KEY` presence confirmed | ✅ true (= absent) | Sorted list inspected line-by-line — key not present; section "Required Deploy Keys" row 1 |
| 3 | `VPS_USER` presence confirmed | ✅ true (= absent) | Same sorted list — `VPS_USER` not present (only `*_USER_PASSWORD` DB vars exist); section row 2 |
| 4 | `VPS_HOST` presence confirmed | ✅ true (= absent) | Same sorted list — no `HOST` keys at all; section row 3 |
| 5 | Verdict: READY / NEED to add | ✅ true | Verdict section above: `MISSING: [VPS_SSH_KEY, VPS_USER, VPS_HOST]` + recommended action |

### Additional Self-Checks

| Check | Result | Evidence |
|-------|--------|----------|
| No secret values printed | ✅ true | Only `.[].key` extracted via jq; values never fetched. Chat output masked by default (API returns values but jq drops them before display) |
| No temp files with secrets | ✅ true | No file writes other than this output.md (keys only) |
| Token not exposed | ✅ true | `VOLLOS_CLI` sourced via `set -a; source ... ; set +a` — never echoed |
| `placeholders_remaining` | none — grep clean | output.md is a report, no code/alerts/TODO |

## Notes for Lead

- `T006_MIGRATION_TEST` looks like a leftover test variable from T-006 migration work — could be cleaned up later but does not block deploy.
- All 4 database user password variables (`AUTH_USER_PASSWORD`, `ACMD_USER_PASSWORD`, `VOLLOS_USER_PASSWORD`, `POSTGRES_PASSWORD`) are present — DB migrations will work.
- `AUTH_RSA_PRIVATE_KEY` + `AUTH_RSA_PUBLIC_KEY` present — JWKS/RS256 auth will work (per rule B1).
- Missing pieces are **only** deploy-transport secrets — code/auth/DB side is complete.

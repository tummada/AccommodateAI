# output.md — ACMD-01 CORS Allowlist Update — Runner Report

**Date:** 2026-04-29
**Runner:** pipeline001 (claude-sonnet-4-6)
**Branch:** fix/auth-cors-allowlist-acmd-subdomains
**MR:** https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/34

---

## Fixes Applied

| Fix # | Description | Status | Evidence |
|-------|-------------|--------|----------|
| Fix #3 | Update VPS .env AUTH_CORS_ORIGINS | APPLIED | grep output confirmed new 4-origin value; backup: .env.bak.20260429T105318Z (chmod 600) |
| Fix #4 | Force-recreate vollos-core-auth container | APPLIED | `docker compose up -d --no-deps --force-recreate auth-service` succeeded; container Up 8s (healthy) |
| Fix #1 | Add .env.bak.* to .gitignore | APPLIED | git diff confirms `.env.bak.*` added at line 5 of .gitignore |
| Fix #2 | Update .env.example comment block | APPLIED | git diff confirms 4-origin example added with D6.1 pattern note |

**Execution order:** Fix #3 → Fix #4 → Verification Steps 1-11 → Fix #1 + Fix #2 (MR) — as mandated by fix.md.

---

## Verification Results

| Step | Description | Result | Evidence |
|------|-------------|--------|----------|
| 1 | Container healthy after restart | PASS | `vollos-core-auth Up 8 seconds (healthy)` |
| 2 | SEC-002 did NOT fire | PASS | `PASS: no SEC-002 error in boot log` |
| 3 | In-container env shows new value | PASS | `printenv AUTH_CORS_ORIGINS` matches all 4 origins |
| 4 | Preflight from accommodate-app.vollos.ai | PASS | HTTP/2 204 + `access-control-allow-origin: https://accommodate-app.vollos.ai` + credentials: true |
| 5 | Preflight from accommodate.vollos.ai | PASS | HTTP/2 204 + `access-control-allow-origin: https://accommodate.vollos.ai` + credentials: true |
| 6 | Regression: vollos.ai preflight | PASS | HTTP/2 204 + `access-control-allow-origin: https://vollos.ai` |
| 7 | Regression: acmd.vollos.ai preflight | PASS | HTTP/2 204 + `access-control-allow-origin: https://acmd.vollos.ai` |
| 8 | Negative: evil.example.com rejected | PASS | HTTP/2 204, NO access-control-allow-origin header |
| 9 | Negative: null origin rejected | PASS | HTTP/2 204, NO access-control-allow-origin header |
| 10 | /health returns 200 | PASS | `200` |
| 11 | Backup cleanup | PASS | .env.bak.20260429T105318Z deleted (5.7K, was chmod 600) |
| 12 | MR opened | PASS | https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/34 |

---

## runner-log.md reference

- Backup filename: `.env.bak.20260429T105318Z`
- Backup size: 5.7K, permissions: 600
- New AUTH_CORS_ORIGINS value written to runner-log.md (not pasted in chat per fix.md Note)

---

## self_review

```yaml
self_review:
  fix_3_vps_env:
    result: true
    evidence: ".env on VPS — grep output confirmed `AUTH_CORS_ORIGINS=https://vollos.ai,https://acmd.vollos.ai,https://accommodate.vollos.ai,https://accommodate-app.vollos.ai` after sed. Pre-condition matched exactly (original value was `https://acmd.vollos.ai,https://vollos.ai`)."

  fix_4_container_recreated:
    result: true
    evidence: "docker compose up -d --no-deps --force-recreate auth-service succeeded. Container reported Up 8 seconds (healthy) on step 1 check."

  fix_1_gitignore:
    result: true
    evidence: ".gitignore:5 — `.env.bak.*` added between `.env.local` and `*.sql.gz`. git diff confirms change."

  fix_2_env_example:
    result: true
    evidence: ".env.example:62-68 — comment block updated with D6.1 pattern note and 4-origin example. Runtime default `AUTH_CORS_ORIGINS=http://localhost:3003` unchanged."

  execution_order_followed:
    result: true
    evidence: "Fix #3 → Fix #4 → Verification 1-11 → Fix #1+#2 commit → MR. Matches mandatory order in fix.md."

  all_verification_steps_passed:
    result: true
    evidence: "Steps 1-12 all PASS. Core bug confirmed fixed: step 4 shows `access-control-allow-origin: https://accommodate-app.vollos.ai`. Negative controls (steps 8,9) confirm fail-closed behavior preserved."

  no_auto_merge:
    result: true
    evidence: "MR created with merge_when_pipeline_succeeds=false. MR !34 is open, not merged."

  secret_handling:
    result: true
    evidence: "AUTH_CORS_ORIGINS value (public hostnames only) written to runner-log.md reference only, not pasted in chat. .env not read or displayed. Backup chmod 600."

  placeholders_remaining:
    result: true
    evidence: "No source code changed. grep clean: no alert(), TODO, TBD, coming soon in modified files (.gitignore, .env.example)."
```

---

## Blockers

None. All fixes applied, all verification steps passed, MR open at !34.

---

## Post-MR Notes

- The runtime fix is **already live** — Fix #3 + Fix #4 applied before this MR. Post-merge CI deploy will pull .gitignore + .env.example changes but will NOT restart auth-service (no image change). This is correct per fix.md.
- `AUTH_RSA_PRIVATE_KEY` unset on acmd-api container is out of scope — tracked in acmd repo per fix.md.
- acmd-side E2E test (full Google login flow) should be run by Lead@acmd per handover Section 7.

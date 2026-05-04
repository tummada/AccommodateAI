---
id: T-060
title: Security audit — T-059 PDPA 2-year retention cron
assigned_to: vollos-auditor
priority: high
status: in_progress
spawn_started_at: 2026-04-20T12:55+07:00
security_checkpoint: true
owned_files: []
review_target:
  branch: origin/feat/pdpa-retention-cron
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/14
  base: origin/main (42e305c)
---

## Scope (READ-ONLY)

Review `origin/main..origin/feat/pdpa-retention-cron`:
- `apps/api/src/scripts/deleteExpiredLeads.ts`
- `apps/api/src/scripts/deleteExpiredLeads.test.ts`
- `infra/retention.sh`
- `infra/setup-cron.sh`
- `infra/README.md`
- Dockerfile changes if any

Use `git show origin/feat/pdpa-retention-cron:<path>`.

## Checklist

1. **Delete scope correct** — `WHERE created_at < NOW() - INTERVAL '2 years'`? Any other filter (e.g. unsubscribed_at) needed for compliance?
2. **Audit log written BEFORE delete commit?** (Must not delete-then-log — if log fails, nothing deleted but we have trail)
3. **No bulk delete without count cap?** (If 1M old leads suddenly expire, script could hang — consider batch size)
4. **Fail-safe exit codes** — exit 0 on success, non-zero on errors?
5. **Idempotent no-op** — if 0 rows match, script exits 0 cleanly?
6. **Telegram alert on failure** — reuses existing config, does NOT leak token, graceful if Telegram unreachable?
7. **Cron time chosen** avoids backup + traffic windows?
8. **`audit_logs.lead_id ON DELETE SET NULL`** — preserves audit trail even after delete? Verify schema or RETURNING pattern.
9. **Timezone correct** — cron `15 3 * * *` is VPS local time (UTC typically); does `NOW() - INTERVAL '2 years'` use DB server timezone (UTC)? Both aligned?
10. **Restore-from-backup impact** — if backup from day N-1 restored, would re-deleted leads reappear? Document.
11. **PII in logs** — script must NOT log lead emails / names, only counts + IDs?
12. **Compliance**: Does 2-year retention align with CCPA (longer if user didn't opt out) and PDPA (Thai)? If conflicting — does policy doc cover?

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-060/review-auditor.md` YAML. Under 250 words.

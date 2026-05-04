---
id: T-059
title: PDPA — auto-delete leads older than 2 years (MEDIUM-5)
assigned_to: vollos-backend
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T12:25+07:00
security_checkpoint: true
owned_files:
  - apps/api/src/scripts/**
  - infra/setup-cron.sh
  - infra/backup.sh
  - packages/db/src/**
  - apps/api/test/**
  - infra/README.md
dependencies: []
---

## Context

Security audit flagged MEDIUM-8: no retention policy enforcement. Per PDPA (Thailand) + CCPA, lead personal data should not be retained indefinitely. Owner's policy: **2-year retention** (aligns with Thai PDPA Section 37 guidelines).

## Goal

Add an automated job that, once a day, deletes lead records older than 2 years. Safe fail-open: if script errors, log + alert (Telegram), do NOT retry blindly.

## Design (recommended)

### Delete vs Anonymize

For leads older than 2 years, choose: **hard delete** (simpler, stronger privacy) vs **anonymize** (keep structure for stats, nullify PII).

Recommendation: **hard delete** — for validate mode + limited analytics value of 2+ year old leads. Easier to reason about + less audit complexity. Agent may propose anonymize with justification.

If hard delete:
```sql
DELETE FROM leads
WHERE created_at < NOW() - INTERVAL '2 years'
RETURNING id;
-- log count
```

Log before delete (audit trail):
```sql
INSERT INTO audit_logs (action, metadata)
VALUES ('pdpa_retention_delete', jsonb_build_object('count', N, 'threshold', '2 years'));
```

### Script Location

`apps/api/src/scripts/deleteExpiredLeads.ts`

Invocation pattern: `node apps/api/dist/scripts/deleteExpiredLeads.js` (built artifact) OR `tsx apps/api/src/scripts/deleteExpiredLeads.ts` (if tsx available).

### Cron Installation

Edit `infra/setup-cron.sh` (used at VPS provisioning) to add daily 03:15 UTC run:
```
15 3 * * * docker exec vollos-core-api node /app/dist/scripts/deleteExpiredLeads.js >> /var/log/vollos-retention.log 2>&1
```

### Failure handling

Script MUST:
- Exit 0 on success (even if 0 rows deleted — no drift)
- Exit non-zero on DB error, network error, etc.
- Log to stderr with clear message
- Attempt a Telegram alert on failure (reuse existing Telegram config from `infra/backup.sh`)

## Scope

1. Write `apps/api/src/scripts/deleteExpiredLeads.ts` — delete + audit + log
2. Unit test: set up 5 leads (3 old + 2 recent) → run script → assert only 3 deleted + audit log created
3. Add cron entry to `infra/setup-cron.sh`
4. Update `infra/README.md` — document retention policy + how to adjust threshold
5. Ensure Dockerfile builds `scripts/*.ts` into `dist/scripts/*.js`

## Workflow

1. `git fetch origin && git checkout -b feat/pdpa-retention-cron origin/main`
2. Implement
3. `pnpm typecheck && pnpm lint && pnpm test` — all green
4. Commit: `feat(privacy): PDPA 2-year retention — auto-delete old leads`
5. Push + MR

## Acceptance Criteria

1. [ ] `deleteExpiredLeads.ts` script exists + deletes leads where `created_at < NOW() - 2 years`
2. [ ] Audit log inserted with deleted count before delete commit
3. [ ] Unit test: 5 leads, only 3 old ones deleted, audit row present
4. [ ] Cron entry in `setup-cron.sh` — daily @ 03:15 UTC (choose time — avoid backup window around 02:00)
5. [ ] Script compiles to `dist/scripts/` via Dockerfile build
6. [ ] `infra/README.md` updated with retention doc
7. [ ] Exit code non-zero on error; Telegram alert on failure
8. [ ] `pnpm typecheck && pnpm lint && pnpm test` green — paste output
9. [ ] Placeholder audit clean
10. [ ] Branch pushed + MR opened
11. [ ] `self_review` complete

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-059/output.md`

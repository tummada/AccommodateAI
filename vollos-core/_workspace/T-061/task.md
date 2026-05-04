---
id: T-061
title: Fix T-060 findings — wrap retention delete in transaction + correct EST comment
assigned_to: vollos-backend
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T13:10+07:00
security_checkpoint: true
owned_files:
  - apps/api/src/scripts/deleteExpiredLeads.ts
  - apps/api/src/scripts/deleteExpiredLeads.test.ts
  - infra/retention.sh
  - infra/setup-cron.sh
dependencies: [T-059, T-060]
---

## Context

T-060 Auditor reviewed T-059 (PDPA retention cron — merged via MR !14 commit `8744a2d`) and returned `conditional_pass` with 4 findings. Owner accepted merge but requested fix for the 2 real issues:

- **SEC-001 MEDIUM** (`deleteExpiredLeads.ts:74-100`): audit_logs INSERT and DELETE of leads are NOT in a single transaction. If DELETE fails after audit commit → audit says "deleted N" but DB state shows 0 deletes. Compliance drift.
- **SEC-004 LOW** (`retention.sh:12`): EST/EDT time in comment is off by 1 hour. If cron is 03:15 UTC, that's 22:15 EST / 23:15 EDT, not "23:15 EST" as written.

Skipped (by owner decision):
- SEC-002 (batch cap) → Post-MVP
- SEC-003 (CCPA right-to-delete) → separate feature (already in Post-MVP Backlog)

## Goal

Single MR that wraps audit+delete in one transaction and corrects the EST comment.

## Design

### SEC-001 — Transaction wrap

Current (pseudo):
```ts
const count = await db.select(...);                             // count old rows
await db.insert(auditLogs).values({action:'pdpa_delete', count}); // commits independently
const deleted = await db.delete(leads).where(...);              // separate commit
```

Fix: use Drizzle's `db.transaction`:
```ts
await db.transaction(async (tx) => {
  const oldRows = await tx.select({id: leads.id}).from(leads).where(eq_old_filter);
  await tx.insert(auditLogs).values({
    action: 'pdpa_retention_delete',
    metadata: {count: oldRows.length, threshold: '2 years'}
  });
  const deleted = await tx.delete(leads).where(eq_old_filter).returning({id: leads.id});
  // Optional assertion: deleted.length === oldRows.length
});
```

Both inserts/deletes are in one tx → either both commit or both rollback.

### SEC-004 — Comment fix

Verify what the cron actually fires at (`setup-cron.sh` + `retention.sh`). If cron is at 03:15 UTC and comment says "23:15 EST", change to "22:15 EST / 23:15 EDT" or use clearer notation like "03:15 UTC (= 22:15 EST / 23:15 EDT / 10:15 ICT)".

### Tests

Update existing `deleteExpiredLeads.test.ts`:
- Add test: "rollback audit_log if delete fails" — mock db.delete to throw → verify audit_logs has no row AND leads unchanged
- Keep all existing tests passing

## Workflow

1. `git fetch origin && git checkout -b fix/pdpa-retention-transaction origin/main`
2. Implement
3. `pnpm typecheck && pnpm lint && pnpm test` all green — paste output
4. Commit: `fix(privacy): wrap retention delete + audit log in transaction`
5. Push + MR

## Acceptance Criteria

1. [ ] `deleteExpiredLeads.ts` uses `db.transaction(async tx => {...})`
2. [ ] Inside tx: count (or select of old rows) → audit_logs INSERT → DELETE returning
3. [ ] No audit row when DELETE fails (test: mock fail + assert 0 rows in audit_logs after)
4. [ ] `retention.sh` (or wherever SEC-004 comment lives) has correct EST/EDT annotation
5. [ ] `pnpm typecheck && pnpm lint && pnpm test` all green
6. [ ] Branch pushed + MR opened
7. [ ] Commit is conventional
8. [ ] `self_review` complete — every AC has `result` + `evidence: file:line`

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-061/output.md`

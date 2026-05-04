---
task_id: T-061
status: completed
spawn_started_at: 2026-04-20T13:10+07:00
completed_at: 2026-04-20T12:05Z
---

## skill_loaded_evidence

```yaml
skill_loaded_evidence:
  files_read:
    - "SKILL.md:L94 — 'Drizzle ORM | type-safe query builder — PK ใช้ generatedAlwaysAsIdentity()... duplicate leads: ใช้ .onConflictDoUpdate({ target: leads.email, set: {...} })'"
    - "SKILL.md:L285 — 'Drizzle query safety: ตรวจทุก .update() และ .delete() มี .where(eq(...)) — ห้ามมี update/delete ที่ไม่มี where clause'"
    - "SKILL.md:L249 — 'Duplicate/Race condition เป็นไปได้ไหม?' (self-review point 4 — transactions are the right tool)"
```

## files_changed

- path: apps/api/src/scripts/deleteExpiredLeads.ts
  action: modified
  summary: Wrapped count → audit insert → delete in single `db.transaction(async (tx) => {...})`. All operations now use `tx.` not `db.`. Updated docstring + header comment to describe atomic semantics.
- path: apps/api/src/scripts/deleteExpiredLeads.test.ts
  action: modified
  summary: Refactored `@vollos/db` mock to be transaction-aware (staged writes, commit on return, discard on throw). Added `failDelete` toggle + new rollback test. 7 tests (was 6).
- path: infra/retention.sh
  action: modified
  summary: Line 12 comment corrected — `03:15 UTC = 10:15 Thai (ICT) = 22:15 EST / 23:15 EDT (prev day, US Eastern)`.

## build_verified

true

## test_output

```
pnpm typecheck
 Tasks:    9 successful, 9 total
 Cached:    8 cached, 9 total
 Time:     3.99s

pnpm lint
 Tasks:    3 successful, 3 total
 Cached:    3 cached, 3 total
 Time:     27ms >>> FULL TURBO

pnpm test (aggregate)
@vollos/auth-service:test: Test Files  1 passed (1) | Tests  15 passed (15)
@vollos/api:test:          Test Files  9 passed (9) | Tests  63 passed (63)
 Tasks:    7 successful, 7 total
 Cached:    6 cached, 7 total
 Time:     1.194s

deleteExpiredLeads.test.ts specifically: ✓ 7 tests (12ms)
  - computeCutoff: subtracts retentionYears from now
  - computeCutoff: handles leap-year boundaries without drifting a day
  - runRetentionDelete — 5 leads, 2-year threshold: deletes only the 3 leads older than cutoff
  - runRetentionDelete — 5 leads, 2-year threshold: writes exactly one audit log row
  - runRetentionDelete — idempotent no-op: writes audit row even when 0 leads match
  - runRetentionDelete — custom retention window: honors a 1-year retention period
  - runRetentionDelete — SEC-001 transaction rollback (T-061): rolls back the audit row AND preserves leads when DELETE fails inside tx
```

## tests_written

- path: apps/api/src/scripts/deleteExpiredLeads.test.ts
  count: 1 (new rollback test) + mock rewrite to support `db.transaction`

## commit_and_mr

- branch: `fix/pdpa-retention-transaction` (from `origin/main` = `1ea588f`)
- commit: `1e8841d` — `fix(privacy): wrap retention delete + audit log in transaction`
- MR: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/15
- Pipeline: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464392501

## rollback_test_snippet

```ts
describe('runRetentionDelete — SEC-001 transaction rollback (T-061)', () => {
  it('rolls back the audit row AND preserves leads when DELETE fails inside tx', async () => {
    // Arrange: snapshot the starting lead set so we can assert no mutation.
    const before = buildLeads().map((l) => l.id).sort();
    failDelete = true;

    // Act + Assert: the tx must reject so the caller (main()) exits non-zero.
    await expect(runRetentionDelete(2, NOW)).rejects.toThrow(
      'simulated delete failure',
    );

    // Assert rollback: audit_logs did NOT gain a row (no phantom "deleted N").
    expect(state.auditInserts).toHaveLength(0);
    // Assert rollback: leads table is byte-for-byte unchanged.
    expect(state.leads.map((l) => l.id).sort()).toEqual(before);
  });
});
```

The mock's `transaction` implementation (test file, rewritten) clones `state` into a `staged` workspace, runs the callback against `staged`, and only swaps `state := staged` on successful return. Any throw (including the simulated `tx.delete.returning()` rejection) discards staging = rollback semantics matching PostgreSQL.

## placeholders_remaining

none — grep clean

```bash
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" \
  apps/api/src/scripts/deleteExpiredLeads.ts \
  apps/api/src/scripts/deleteExpiredLeads.test.ts \
  infra/retention.sh
# (only hits are the word "mock" in test-file comments describing the vi.mock setup — legitimate testing vocabulary, not placeholder code)
```

## self_review

```yaml
self_review:
  AC1_transaction_used:
    result: true
    evidence: "apps/api/src/scripts/deleteExpiredLeads.ts:76 — 'return db.transaction(async (tx) => {' wraps count + insert + delete"
  AC2_order_count_audit_delete:
    result: true
    evidence: "apps/api/src/scripts/deleteExpiredLeads.ts:L78-101 — order is (1) tx.select count L78-82, (2) tx.insert auditLogs L87-96, (3) tx.delete...returning L104-107"
  AC3_no_audit_on_delete_failure:
    result: true
    evidence: "apps/api/src/scripts/deleteExpiredLeads.test.ts:L201-218 — rollback test asserts `state.auditInserts.toHaveLength(0)` + `state.leads` unchanged; mock tx commits only on successful callback return (L91-106)"
  AC4_est_edt_comment_correct:
    result: true
    evidence: "infra/retention.sh:12 — '03:15 UTC = 10:15 Thai (ICT) = 22:15 EST / 23:15 EDT (prev day, US Eastern)' — 03:15 UTC minus 5h (EST) = 22:15 prev day; minus 4h (EDT) = 23:15 prev day — both correct"
  AC5_typecheck_lint_test_green:
    result: true
    evidence: "test_output section above — pnpm typecheck 9/9 pass, pnpm lint FULL TURBO 3/3 pass, pnpm test 63/63 pass (7 in deleteExpiredLeads.test.ts including new rollback case)"
  AC6_branch_pushed_mr_opened:
    result: true
    evidence: "MR !15 https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/15 — branch fix/pdpa-retention-transaction pushed, pipeline 2464392501 running"
  AC7_conventional_commit:
    result: true
    evidence: "git log commit 1e8841d — 'fix(privacy): wrap retention delete + audit log in transaction' — matches fix(scope): pattern per CLAUDE.md F6"
  AC8_self_review_complete:
    result: true
    evidence: "this block — AC1-AC8 all have result + file:line evidence per CLAUDE.md Agent Self-Review rule"
  input_validated:
    result: true
    evidence: "parseRetentionYears() still validates RETENTION_YEARS env — deleteExpiredLeads.ts:L37-46; no new user input introduced in this change"
  null_handled:
    result: true
    evidence: "countRow?.count ?? 0 — deleteExpiredLeads.ts:L84 preserved from T-059 (defensive against empty result)"
  errors_caught:
    result: true
    evidence: "main() try/catch wraps runRetentionDelete and exits 1 on throw — deleteExpiredLeads.ts:L130-142; tx rejection now propagates through correctly (test proves it)"
  race_condition_safe:
    result: true
    evidence: "db.transaction provides ACID atomicity — deleteExpiredLeads.ts:L76; count→audit→delete is now a single tx so concurrent cron runs cannot interleave a phantom audit with a failed delete"
  security_checked:
    result: true
    evidence: "no new user input; Drizzle parameterized queries preserved — .where(lt(leads.createdAt, cutoff)) on L81 + L106; sql`count(*)::int` is constant, not user-supplied"
```

## notes

- The test mock had to be reworked because `db.insert(...).values(...)` and `db.delete(...).where(...).returning(...)` are now called on `tx` rather than `db`. The rewrite introduces a staged workspace so commit/rollback semantics match Postgres: the callback runs against a clone, and only a successful return promotes the clone to the shared `state`. Any throw discards the clone — exactly the behavior Drizzle gives you with real transactions.
- `setup-cron.sh:11` and `backup.sh:8` both say "08:00 UTC = ... = 03:00 US Eastern" without distinguishing EST/EDT. That's the same category of bug as SEC-004 but scoped to the backup job, not retention — so it's outside T-061. Flagging for a future cleanup ticket if the Auditor cares.
- Re-anchor checkpoint: sub-task=transaction-wrap, scope_ok=y (only touched the 4 owned files, test mock wrote entirely inside existing test file).

## issues

[]

## remaining_items

[]

## web_searches

none

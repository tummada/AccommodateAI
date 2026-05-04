/**
 * ACMD-117 Phase A — Runtime bomb fix integration test.
 *
 * Exercises the full `tryAutoTransition` flow against a REAL local Postgres
 * (not mocked) to prove that migration 0032 added 'auto_status_transition'
 * to the `acmd_audit_action` pgEnum. Before migration 0032, this test would
 * fail at the audit-log INSERT with:
 *
 *   error: invalid input value for enum acmd_audit_action: "auto_status_transition"
 *
 * Guarded by `ACMD_INTEGRATION_DB=1` so it is skipped in CI / environments
 * without a local Postgres. Run locally with:
 *
 *   DATABASE_URL="postgres://..." ACMD_INTEGRATION_DB=1 \
 *     pnpm --filter @acmd/api test -- __tests__/autoTransitionIntegration.test.ts
 *
 * Fixtures are created inline and cleaned up in `afterAll` (no shared schema
 * between tests). The run-migrations.mjs script is not invoked — migration
 * 0032 is assumed to already be applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// NOTE: do NOT vi.mock('@acmd/db') here — we want the real client.
// DATABASE_URL is loaded by the runner; if unset we skip the whole suite.

const SHOULD_RUN = process.env['ACMD_INTEGRATION_DB'] === '1';

// Type-only imports — `typeof import(...)` is erased at compile time, so
// the underlying modules are NOT loaded until `beforeAll` does a real
// dynamic `import()` below. That preserves `describe.skipIf` semantics:
// when `ACMD_INTEGRATION_DB !== '1'` the module graph is never touched.
type DbModule = typeof import('@acmd/db');
type AutoTransitionModule = typeof import('../src/services/autoTransitionService.js');
type Db = DbModule['db'];
type AcmdAuditLogRow = DbModule['acmdAuditLogs']['$inferSelect'];

// Definite-assignment assertions: these are populated in `beforeAll` which
// only runs when the suite is not skipped. `describe.skipIf(!SHOULD_RUN)`
// guarantees neither hook nor test body executes otherwise.
let db!: Db;
let schema!: DbModule;
let tryAutoTransition!: AutoTransitionModule['tryAutoTransition'];

// Fixture IDs (scoped to this test run)
const TEST_TAG = `acmd117-${Date.now()}`;
let companyId: string;
let userId: string;
let employeeId: string;
let caseId: string;

describe.skipIf(!SHOULD_RUN)('ACMD-117 auto_status_transition — real DB', () => {
  beforeAll(async () => {
    // Lazy-import so the DB client isn't constructed when the suite is skipped.
    const dbMod: DbModule = await import('@acmd/db');
    db = dbMod.db;
    schema = dbMod;

    // Import service under test (autoTransitionService imports caseService
    // which pulls in the real @acmd/db client).
    const svc: AutoTransitionModule = await import('../src/services/autoTransitionService.js');
    tryAutoTransition = svc.tryAutoTransition;

    // -----------------------------------------------------------------
    // Seed minimal fixture: company → user → employee → case + checklist
    // -----------------------------------------------------------------
    const [company] = await db
      .insert(schema.acmdCompanies)
      .values({
        name: `ACMD-117 Test Co ${TEST_TAG}`,
        planTier: 'starter',
        subscriptionStatus: 'trialing',
        maxStates: 1,
      })
      .returning();
    companyId = company.id;

    const [user] = await db
      .insert(schema.acmdUsers)
      .values({
        companyId,
        name: 'ACMD-117 HR',
        email: `hr+${TEST_TAG}@acmd117.test`,
        role: 'hr',
      })
      .returning();
    userId = user.id;

    const [employee] = await db
      .insert(schema.acmdEmployees)
      .values({
        companyId,
        name: 'ACMD-117 Employee',
        email: `emp+${TEST_TAG}@acmd117.test`,
        employmentStatus: 'active',
      })
      .returning();
    employeeId = employee.id;

    const [caseRow] = await db
      .insert(schema.acmdCases)
      .values({
        companyId,
        employeeId,
        assignedTo: userId,
        // Start in interactive_process — valid transition target is 'review'.
        status: 'interactive_process',
        type: 'ada',
        requestDescription: 'ACMD-117 integration test case',
      })
      .returning();
    caseId = caseRow.id;

    // One required checklist item, already completed, so the
    // `checklist_complete` trigger is satisfied.
    await db.insert(schema.acmdChecklistItems).values({
      caseId,
      stepName: 'Initial intake',
      stepOrder: 1,
      required: true,
      completed: true,
      completedAt: new Date(),
      completedBy: userId,
    });
  });

  afterAll(async () => {
    if (!SHOULD_RUN || !companyId) return;
    // Clean up in FK-safe order. `acmd_audit_logs` is append-only (DB
    // trigger `acmd_audit_logs_immutable` blocks DELETE) so test rows are
    // dropped via the `cleanupTestAuditLogs` helper, which is gated by
    // `NODE_ENV !== 'production'` AND `ACMD_INTEGRATION_DB === '1'`. The
    // `session_replication_role = 'replica'` escape lives ONLY inside that
    // helper — do NOT inline it here (see SEC-001 / ACMD-118-C).
    const { eq } = await import('drizzle-orm');
    const { cleanupTestAuditLogs } = await import('./helpers/testCleanup.js');
    await cleanupTestAuditLogs(db, companyId);
    await db.delete(schema.acmdCases).where(eq(schema.acmdCases.id, caseId));
    await db.delete(schema.acmdEmployees).where(eq(schema.acmdEmployees.id, employeeId));
    await db.delete(schema.acmdUsers).where(eq(schema.acmdUsers.id, userId));
    await db.delete(schema.acmdCompanies).where(eq(schema.acmdCompanies.id, companyId));
  });

  it('writes audit log with action=auto_status_transition and updates case status', async () => {
    const result = await tryAutoTransition(
      caseId,
      companyId,
      'checklist_complete',
      userId,
      { source: 'acmd-117-integration-test' },
    );

    // (a) Transition succeeded — no DB constraint error thrown.
    expect(result.transitioned).toBe(true);
    expect(result.fromStatus).toBe('interactive_process');
    expect(result.toStatus).toBe('review');

    // (b) Case row status updated.
    const { eq } = await import('drizzle-orm');
    const [updated] = await db
      .select()
      .from(schema.acmdCases)
      .where(eq(schema.acmdCases.id, caseId))
      .limit(1);
    expect(updated.status).toBe('review');

    // (c) Audit log row exists with action 'auto_status_transition'.
    const auditRows = await db
      .select()
      .from(schema.acmdAuditLogs)
      .where(eq(schema.acmdAuditLogs.caseId, caseId));
    const autoRow = auditRows.find(
      (r: AcmdAuditLogRow) => r.action === 'auto_status_transition',
    );
    expect(autoRow).toBeDefined();
    expect(autoRow!.metadata).toMatchObject({
      from: 'interactive_process',
      to: 'review',
      trigger: 'checklist_complete',
      auto: true,
    });
  });
});

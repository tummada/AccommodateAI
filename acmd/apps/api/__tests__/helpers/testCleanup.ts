/**
 * Test-only cleanup helpers for ACMD integration tests.
 *
 * SECURITY CONTAINMENT (ACMD-118-C / SEC-001):
 * ---------------------------------------------
 * `acmd_audit_logs` is append-only in production — the DB trigger
 * `acmd_audit_logs_immutable` blocks DELETE/UPDATE to preserve the audit
 * trail (compliance requirement). Integration tests that own their fixture
 * rows need to drop those rows during teardown, so we rely on the
 * `session_replication_role = 'replica'` escape which temporarily suspends
 * user-defined triggers inside the current transaction.
 *
 * That pattern is dangerous if copy-pasted into production code (it would
 * disable the immutability trigger for the whole session). This helper is
 * the ONLY place in the repo where that pattern lives, and it is gated by
 * BOTH:
 *
 *   1. `NODE_ENV !== 'production'`      (hard refusal)
 *   2. `ACMD_INTEGRATION_DB === '1'`   (explicit opt-in flag used by the
 *                                        integration suite only)
 *
 * This file lives under `apps/acmd-api/__tests__/helpers/` which is NOT
 * part of `tsconfig.json`'s `include` (rootDir = ./src) — it is never
 * compiled into `dist/` and is not importable from `src/`.
 *
 * DO NOT move this file into `src/`. DO NOT import it from production code.
 * DO NOT widen the guards. DO NOT remove them.
 */

import type { DbOrTx } from '../../src/services/caseService.js';

/**
 * Delete all `acmd_audit_logs` + `acmd_notifications` rows that belong to
 * the given test company, bypassing the immutability trigger for the scope
 * of the transaction only.
 *
 * @throws Error if called outside an integration test environment.
 */
export async function cleanupTestAuditLogs(
  db: DbOrTx,
  companyId: string,
): Promise<void> {
  // Hard production guard — refuse to run anywhere near a prod env.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'cleanupTestAuditLogs: refusing to run with NODE_ENV=production',
    );
  }
  // Explicit opt-in — the integration suite sets this; unit suites do not.
  if (process.env['ACMD_INTEGRATION_DB'] !== '1') {
    throw new Error(
      'cleanupTestAuditLogs: requires ACMD_INTEGRATION_DB=1 (integration test env)',
    );
  }

  const { sql } = await import('drizzle-orm');

  // `db` may be either the top-level client or a tx handle — both expose
  // `.transaction`. We wrap in a transaction so `SET LOCAL` is scoped.
  await (db as { transaction: (fn: (tx: DbOrTx) => Promise<void>) => Promise<void> }).transaction(
    async (tx: DbOrTx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
      await tx.execute(
        sql`DELETE FROM acmd_audit_logs WHERE company_id = ${companyId}`,
      );
      await tx.execute(
        sql`DELETE FROM acmd_notifications WHERE company_id = ${companyId}`,
      );
    },
  );
}

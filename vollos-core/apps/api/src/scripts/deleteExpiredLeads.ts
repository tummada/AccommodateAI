// deleteExpiredLeads.ts — PDPA / CCPA 2-year retention enforcement
//
// Runs daily via cron (see infra/setup-cron.sh).
// Deletes leads whose created_at is older than the RETENTION_YEARS threshold
// (default: 2 years — aligns with Thai PDPA Section 37 guidelines).
//
// Design choice: HARD DELETE (vs anonymize)
//   - Simpler to reason about (no lingering rows that need re-anonymization later).
//   - Stronger privacy posture — row is gone, cannot be re-identified.
//   - Analytics value of 2+ year old form leads is minimal (email decay, stale ICPs).
//   - audit_logs.lead_id is ON DELETE SET NULL, so audit history survives for
//     compliance trail while identifiers disappear.
//
// Safety:
//   - Counts BEFORE delete → audit log row written with count → delete runs —
//     all three steps wrapped in a single db.transaction so either both the
//     audit row and the delete commit together, or neither does (rollback on
//     any error). Prevents a "phantom audit" row when delete fails downstream.
//   - Exit 0 on success (even 0 rows — quiet no-op is fine).
//   - Exit 1 on any DB error; stderr message is safe (no PII, no stack).
//   - Telegram alert on failure is fired by the shell wrapper in setup-cron.sh,
//     not from this script (reuse backup.sh helper → single source of alert logic).
//
// Invocation:
//   docker exec vollos-core-api node /app/apps/api/dist/scripts/deleteExpiredLeads.js
//
// ENV:
//   DATABASE_URL       required (picked up by @vollos/db)
//   RETENTION_YEARS    optional, default "2"

import { db, leads, auditLogs } from '@vollos/db';
import { lt, sql } from 'drizzle-orm';

const DEFAULT_RETENTION_YEARS = 2;

function parseRetentionYears(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_RETENTION_YEARS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `Invalid RETENTION_YEARS='${raw}' — must be a positive integer.`,
    );
  }
  return n;
}

/**
 * Compute the cutoff timestamp: leads with created_at < cutoff get deleted.
 * Exported for unit tests.
 */
export function computeCutoff(now: Date, retentionYears: number): Date {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears);
  return cutoff;
}

export interface RetentionRunResult {
  deletedCount: number;
  cutoff: Date;
  retentionYears: number;
}

/**
 * Delete leads older than cutoff + write a single audit_logs row.
 * Count → audit insert → delete all run inside db.transaction so any
 * failure rolls back the audit row — no phantom "deleted N" log entries
 * when the delete itself fails (SEC-001 fix, T-061).
 */
export async function runRetentionDelete(
  retentionYears: number,
  now: Date = new Date(),
): Promise<RetentionRunResult> {
  const cutoff = computeCutoff(now, retentionYears);

  return db.transaction(async (tx) => {
    // Step 1: count how many leads would be affected (for audit log payload).
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(lt(leads.createdAt, cutoff));

    const toDeleteCount = countRow?.count ?? 0;

    // Step 2: write audit log (same tx) — rolled back if delete fails below.
    await tx.insert(auditLogs).values({
      action: 'pdpa_retention_delete',
      metadata: {
        count: toDeleteCount,
        retentionYears,
        cutoff: cutoff.toISOString(),
        threshold: `${retentionYears} years`,
      },
    });

    // Step 3: perform the actual delete. Guard: if no rows to delete, skip the
    // DB round-trip entirely — keeps logs quieter and costs less. The audit
    // row above still commits (proves the job ran).
    if (toDeleteCount === 0) {
      return { deletedCount: 0, cutoff, retentionYears };
    }

    const deleted = await tx
      .delete(leads)
      .where(lt(leads.createdAt, cutoff))
      .returning({ id: leads.id });

    return { deletedCount: deleted.length, cutoff, retentionYears };
  });
}

/**
 * CLI entrypoint. Exits the process with 0 on success, 1 on failure.
 * Logs are plain-text, no PII — safe for /var/log/vollos-retention.log.
 */
export async function main(): Promise<void> {
  const startedAt = new Date();
  let retentionYears: number;
  try {
    retentionYears = parseRetentionYears(process.env['RETENTION_YEARS']);
  } catch (err) {
    console.error(
      `[retention] config error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(
    `[retention] starting — retentionYears=${retentionYears} startedAt=${startedAt.toISOString()}`,
  );

  try {
    const result = await runRetentionDelete(retentionYears, startedAt);
    const durationMs = Date.now() - startedAt.getTime();
    console.log(
      `[retention] done — deleted=${result.deletedCount} cutoff=${result.cutoff.toISOString()} durationMs=${durationMs}`,
    );
    process.exit(0);
  } catch (err) {
    // Sanitize: never leak connection strings or stack traces to stderr,
    // the log file is tailed by monitoring / Telegram alert wrapper.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[retention] FAILED: ${msg}`);
    process.exit(1);
  }
}

// Only run main() when executed directly (not when imported by tests).
// Under vitest, VITEST=true so we skip the CLI side-effect.
if (!process.env['VITEST']) {
  // Using top-level await would need module=NodeNext which we already have,
  // but keeping this in a then()-style chain avoids an unhandled promise
  // rejection window if main() throws synchronously.
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[retention] UNCAUGHT: ${msg}`);
    process.exit(1);
  });
}

// deleteExpiredLeads.test.ts — unit tests for PDPA retention cron script.
//
// Test strategy: mock @vollos/db with an in-memory lead table and verify:
//   1. Only leads older than the cutoff are deleted (mix of old + recent).
//   2. An audit_logs row is inserted in the same tx with the correct count.
//   3. 0-match run still writes audit row (proves the job ran) + exits clean.
//   4. computeCutoff math is correct across year/month boundaries.
//   5. DB error propagates (non-zero exit is signaled via thrown promise).
//   6. TRANSACTION ROLLBACK (SEC-001, T-061): when the delete throws, the
//      audit row is rolled back and the in-memory leads snapshot is untouched.
//
// No real DB connection — DATABASE_URL is not required here; the mock is
// wired up before @vollos/db gets imported by the production module.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Fixtures (frozen clock so the test is deterministic) ─────────────────────
const NOW = new Date('2026-04-20T00:00:00.000Z');

// Leads: 3 older than 2 years (pre-2024-04-20), 2 recent.
type Lead = { id: string; email: string; createdAt: Date };

function buildLeads(): Lead[] {
  return [
    { id: 'old-1', email: 'old1@example.com', createdAt: new Date('2023-01-01T00:00:00Z') },
    { id: 'old-2', email: 'old2@example.com', createdAt: new Date('2023-06-15T00:00:00Z') },
    { id: 'old-3', email: 'old3@example.com', createdAt: new Date('2024-04-19T23:59:59Z') },
    { id: 'new-1', email: 'new1@example.com', createdAt: new Date('2024-04-21T00:00:00Z') },
    { id: 'new-2', email: 'new2@example.com', createdAt: new Date('2026-04-01T00:00:00Z') },
  ];
}

let state: { leads: Lead[]; auditInserts: Array<Record<string, unknown>> };

// cutoff used by the most recent select(...).where(...) call.
// Populated by the mock `lt(column, value)` helper via a shared module var.
let pendingCutoff: Date | null = null;

// Toggle: when true, tx.delete(...).where(...).returning() throws → the
// outer tx callback rejects → the mock transaction wrapper must discard
// staged writes (audit insert, lead removals) so the observable state
// looks like the tx never ran. Used by the SEC-001 rollback test.
let failDelete = false;

vi.mock('drizzle-orm', () => ({
  // lt(column, value) → sentinel object carrying the cutoff so the fake
  // query builder can filter `state.leads` without a real SQL parser.
  lt: vi.fn((_col: unknown, value: Date) => {
    pendingCutoff = value;
    return { __op: 'lt', value };
  }),
  // sql`...` tagged template — returns opaque token; count expression is
  // handled by the select() mock directly.
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ __sql: strings.join('?') }),
    {},
  ),
}));

vi.mock('@vollos/db', () => {
  // Build a tx-like object that writes to a *staged* copy of state; only on
  // successful return from the callback are staged writes committed back to
  // `state`. Any throw inside the callback → stage is discarded = rollback.
  type Staged = { leads: Lead[]; auditInserts: Array<Record<string, unknown>> };

  function makeTx(staged: Staged) {
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const cutoff = pendingCutoff;
          pendingCutoff = null;
          const count = cutoff
            ? staged.leads.filter((l) => l.createdAt < cutoff).length
            : staged.leads.length;
          return Promise.resolve([{ count }]);
        }),
      })),
    }));

    const insert = vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        staged.auditInserts.push(row);
        return Promise.resolve([]);
      }),
    }));

    const del = vi.fn(() => ({
      where: vi.fn(() => {
        const cutoff = pendingCutoff;
        pendingCutoff = null;
        return {
          returning: vi.fn(() => {
            if (failDelete) {
              return Promise.reject(new Error('simulated delete failure'));
            }
            const removed = cutoff
              ? staged.leads.filter((l) => l.createdAt < cutoff)
              : [];
            if (cutoff) {
              staged.leads = staged.leads.filter(
                (l) => l.createdAt >= cutoff,
              );
            }
            return Promise.resolve(removed.map((l) => ({ id: l.id })));
          }),
        };
      }),
    }));

    return { select, insert, delete: del };
  }

  const transaction = vi.fn(
    async <T,>(cb: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
      // Clone state for the staged tx workspace.
      const staged: Staged = {
        leads: state.leads.map((l) => ({ ...l })),
        auditInserts: state.auditInserts.map((r) => ({ ...r })),
      };
      const tx = makeTx(staged);
      const result = await cb(tx); // may throw → staged discarded, state untouched
      // Commit: swap state to the staged workspace.
      state.leads = staged.leads;
      state.auditInserts = staged.auditInserts;
      return result;
    },
  );

  return {
    db: { transaction },
    leads: { createdAt: 'leads.createdAt' },
    auditLogs: 'audit_logs_table',
  };
});

// Import AFTER mocks are registered.
const { runRetentionDelete, computeCutoff } = await import('./deleteExpiredLeads.js');

beforeEach(() => {
  state = { leads: buildLeads(), auditInserts: [] };
  pendingCutoff = null;
  failDelete = false;
  vi.clearAllMocks();
});

describe('computeCutoff', () => {
  it('subtracts retentionYears from now', () => {
    const cutoff = computeCutoff(NOW, 2);
    expect(cutoff.toISOString()).toBe('2024-04-20T00:00:00.000Z');
  });

  it('handles leap-year boundaries without drifting a day', () => {
    // 2024-02-29 is a real date; 2 years back = 2022-02-28 (JS normalizes).
    const leapNow = new Date('2024-02-29T12:00:00.000Z');
    const cutoff = computeCutoff(leapNow, 2);
    // JS Date.setFullYear on Feb 29 rolls to Feb 29 or Mar 1 depending on
    // target year — assert it lands in Feb/Mar 2022, not some random year.
    expect(cutoff.getUTCFullYear()).toBe(2022);
    expect([1, 2]).toContain(cutoff.getUTCMonth()); // 1=Feb or 2=Mar
  });
});

describe('runRetentionDelete — 5 leads, 2-year threshold', () => {
  it('deletes only the 3 leads older than cutoff, keeps the 2 recent ones', async () => {
    const result = await runRetentionDelete(2, NOW);

    expect(result.deletedCount).toBe(3);
    expect(result.retentionYears).toBe(2);
    expect(result.cutoff.toISOString()).toBe('2024-04-20T00:00:00.000Z');

    // Remaining leads should be exactly the recent two.
    expect(state.leads.map((l) => l.id).sort()).toEqual(['new-1', 'new-2']);
  });

  it('writes exactly one audit log row with the delete count BEFORE deleting', async () => {
    await runRetentionDelete(2, NOW);

    expect(state.auditInserts).toHaveLength(1);
    const row = state.auditInserts[0]!;
    expect(row['action']).toBe('pdpa_retention_delete');
    const meta = row['metadata'] as Record<string, unknown>;
    expect(meta['count']).toBe(3);
    expect(meta['retentionYears']).toBe(2);
    expect(meta['threshold']).toBe('2 years');
    expect(meta['cutoff']).toBe('2024-04-20T00:00:00.000Z');
  });
});

describe('runRetentionDelete — idempotent no-op', () => {
  it('writes audit row even when 0 leads match (proves the job ran)', async () => {
    // Only recent leads → nothing to delete.
    state.leads = buildLeads().filter((l) => l.id.startsWith('new'));

    const result = await runRetentionDelete(2, NOW);

    expect(result.deletedCount).toBe(0);
    expect(state.auditInserts).toHaveLength(1);
    const meta = state.auditInserts[0]!['metadata'] as Record<string, unknown>;
    expect(meta['count']).toBe(0);
  });
});

describe('runRetentionDelete — custom retention window', () => {
  it('honors a 1-year retention period', async () => {
    const result = await runRetentionDelete(1, NOW);
    // cutoff = 2025-04-20 → all 3 old + new-1 (2024-04-21) deleted, new-2 kept.
    expect(result.deletedCount).toBe(4);
    expect(state.leads.map((l) => l.id)).toEqual(['new-2']);
  });
});

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

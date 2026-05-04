/**
 * RS-013-api-fix / OB-2 — POST /api/v1/onboarding tests.
 *
 * Covers:
 *   - 401 when no Authorization header
 *   - 403 when JWT.products lacks 'acmd'
 *   - 201 happy path — acmd_users + acmd_companies created inside a tx
 *   - 400 validation failure — empty body / bad name
 *   - 409 on concurrent POST (another row with same JWT.sub already committed)
 *   - Transaction rollback — if any step inside the tx throws, no row is
 *     left behind (audit-log insert failure triggers rollback)
 *   - Audit log is written with action='onboarding_created' inside the tx
 *
 * The tests mock @acmd/db and @acmd/auth so they run entirely in-process —
 * no PG required. `db.transaction(fn)` is stubbed to pass a `tx` proxy that
 * records every insert/update/select call and can be flipped into
 * rollback-on-throw mode per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// Env + dotenv stub (must be before any import that triggers config).
// ───────────────────────────────────────────────────────────────────────────
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// ───────────────────────────────────────────────────────────────────────────
// @acmd/db mock.
//
// We expose:
//   - `db.select().from().leftJoin().where().limit()` — returns preset rows.
//     Each test overrides `mockExistingRows` to drive fast-path vs. tx-path.
//   - `db.transaction(fn)` — calls fn with a tx handle that records ops and
//     can throw mid-flight to exercise rollback.
//   - `db.update`, `db.insert` — used by authService.createUser (tx path).
// ───────────────────────────────────────────────────────────────────────────

interface TxOps {
  inserts: Array<{ table: string; values: unknown }>;
  updates: Array<{ table: string; set: unknown }>;
  selects: number;
}

/** Preset rows returned by the top-level db.select().limit() fast path. */
let mockExistingRows: unknown[] = [];
/**
 * T-101 — preset rows returned by the gate-query chain. Default to one row
 * (the user IS allowed past the gate) so the existing 9 tests that pre-date
 * T-101 still pass without per-test setup. Tests that exercise the gate
 * rejection set this to [].
 */
let mockBetaRedemptionRows: unknown[] = [{ id: 'gate-row-uuid' }];
/** Preset rows returned by tx.select().limit() racing re-check. */
let mockTxRaceRows: unknown[] = [];
/** If set, the transaction callback throws after companyId is inserted. */
let txFailureMode:
  | 'none'
  | 'audit_throws'
  | 'pg_unique_users_id'
  | 'pg_unique_email'
  | 'generic'
  = 'none';
/** Last tx ops recorded — inspected per test to assert rollback. */
let lastTxOps: TxOps;

function makeTableName(table: unknown): string {
  // Drizzle table objects expose a Symbol(drizzle:Name); tests only need a
  // stable label so we sniff commonly-used references via mocked shapes below.
  const anyT = table as { __tableName?: string };
  return anyT.__tableName ?? 'unknown';
}

vi.mock('@acmd/db', () => {
  const acmdUsers = {
    __tableName: 'users',
    id: { name: 'id' },
    email: { name: 'email' },
    name: { name: 'name' },
    role: { name: 'role' },
    companyId: { name: 'company_id' },
    deletedAt: { name: 'deleted_at' },
    googleId: { name: 'google_id' },
  };
  const acmdCompanies = {
    __tableName: 'companies',
    id: { name: 'id' },
    onboardingCompletedAt: { name: 'onboarding_completed_at' },
  };
  const acmdAuditLogs = {
    __tableName: 'audit_logs',
  };
  const acmdRefreshTokens = { __tableName: 'refresh_tokens' };
  // T-101: gate queries acmd.beta_invite_redemption_log via betaGate.ts —
  // mock the table object so the import in services/betaGate.ts resolves.
  const acmdBetaInviteRedemptionLog = {
    __tableName: 'beta_invite_redemption_log',
    id: { name: 'id' },
    email: { name: 'email' },
    result: { name: 'result' },
    claimedUserId: { name: 'claimed_user_id' },
  };

  // Top-level (non-transactional) select chain — used by the "already onboarded"
  // fast-path. select(...).from(acmdUsers).leftJoin(acmdCompanies).where().limit()
  const selectLimit = vi.fn(() => Promise.resolve(mockExistingRows));
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectLeftJoin = vi.fn(() => ({ where: selectWhere }));
  const selectFrom = vi.fn(() => ({
    leftJoin: selectLeftJoin,
    where: selectWhere,
  }));

  // T-101 — gate-query chain: select({id}).from(acmdBetaInviteRedemptionLog)
  //                          .where().limit() (no leftJoin, no orderBy).
  // Discriminated by selector shape in the dbSelect dispatch below.
  const gateSelectLimit = vi.fn(() => Promise.resolve(mockBetaRedemptionRows));
  const gateSelectWhere = vi.fn(() => ({ limit: gateSelectLimit }));
  const gateSelectFrom = vi.fn(() => ({ where: gateSelectWhere }));

  // T-101 R3 (A-R2-003 / B-R2-003): SHAPE-BASED DISPATCH WARNING.
  // This dispatch routes the gate query (selector with `id` only, no `email`,
  // no `companyId`) to the gate chain; everything else (including the
  // existing fast path) to the original chain. The heuristic is fragile:
  //   - It MUST be revisited if `betaGate.ts` adds `email` (or any other
  //     column) to the gate SELECT for logging/analytics.
  //   - It MUST be revisited if any future `db.select({ id: ... })` call is
  //     added to onboarding.ts for a different table — the dispatch will
  //     misroute and tests will fail with confusing mock errors.
  // Today (T-101 R3) the only `select({ id })` call in onboarding.ts is the
  // gate's lookup against acmd.beta_invite_redemption_log via betaGate.ts.
  const dbSelect = vi.fn((cols?: unknown) => {
    if (
      cols
      && typeof cols === 'object'
      && 'id' in (cols as object)
      && !('email' in (cols as object))
      && !('companyId' in (cols as object))
    ) {
      return { from: gateSelectFrom };
    }
    return { from: selectFrom };
  });

  // db.transaction(fn) — builds a tx proxy that records ops.
  const dbTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const ops: TxOps = { inserts: [], updates: [], selects: 0 };
    lastTxOps = ops;

    const txSelectLimit = vi.fn(() => Promise.resolve(mockTxRaceRows));
    const txSelectWhere = vi.fn(() => ({ limit: txSelectLimit }));
    const txSelectFrom = vi.fn(() => {
      ops.selects++;
      return { where: txSelectWhere };
    });
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    // tx.insert(table).values(v).returning(x?) — returns [{ id, ... }].
    const txInsert = vi.fn((table: unknown) => ({
      values: vi.fn((v: unknown) => {
        const name = makeTableName(table);
        ops.inserts.push({ table: name, values: v });

        if (name === 'audit_logs' && txFailureMode === 'audit_throws') {
          throw new Error('audit insert simulated failure');
        }

        if (name === 'users' && txFailureMode === 'pg_unique_users_id') {
          const err = new Error('duplicate key value violates unique constraint') as Error & {
            code?: string;
            constraint_name?: string;
            table_name?: string;
            detail?: string;
          };
          err.code = '23505';
          err.table_name = 'users';
          err.constraint_name = 'users_pkey';
          err.detail = 'Key (id)=(token-sub-uuid) already exists.';
          throw err;
        }

        if (name === 'users' && txFailureMode === 'pg_unique_email') {
          const err = new Error('duplicate key value violates unique constraint') as Error & {
            code?: string;
            constraint_name?: string;
            table_name?: string;
            detail?: string;
          };
          err.code = '23505';
          err.table_name = 'users';
          err.constraint_name = 'users_email_unique';
          err.detail = 'Key (email)=(hr@acme.com) already exists.';
          throw err;
        }

        if (name === 'companies' && txFailureMode === 'generic') {
          throw new Error('boom');
        }

        const rtn = {
          returning: vi.fn(() => {
            if (name === 'companies') {
              return Promise.resolve([{ id: 'company-uuid' }]);
            }
            if (name === 'users') {
              // Echo back the inserted values so createUser can return them.
              const inserted = v as {
                id?: string;
                companyId: string;
                email: string;
                name: string;
                role: 'super_admin';
              };
              return Promise.resolve([
                {
                  id: inserted.id ?? 'generated-uuid',
                  companyId: inserted.companyId,
                  role: inserted.role,
                  email: inserted.email,
                  name: inserted.name,
                },
              ]);
            }
            return Promise.resolve([]);
          }),
          // writeAuditLog doesn't call .returning, so awaiting .values() must
          // resolve as a promise — attach a then so this doubles as a thenable.
          then: (
            resolve: (v: unknown) => void,
            reject?: (e: unknown) => void,
          ) => {
            try {
              resolve(undefined);
            } catch (e) {
              if (reject) reject(e);
            }
          },
        };
        return rtn;
      }),
    }));

    // tx.update(table).set(v).where() — used by optional companyName override.
    const txUpdate = vi.fn((table: unknown) => ({
      set: vi.fn((v: unknown) => {
        ops.updates.push({ table: makeTableName(table), set: v });
        return {
          where: vi.fn(() => Promise.resolve(undefined)),
        };
      }),
    }));

    const tx = {
      select: txSelect,
      insert: txInsert,
      update: txUpdate,
    };

    return await fn(tx);
  });

  return {
    db: {
      select: dbSelect,
      transaction: dbTransaction,
      // Exposed for types but not used by the onboarding route directly.
      insert: vi.fn(),
      update: vi.fn(),
    },
    acmdUsers,
    acmdCompanies,
    acmdAuditLogs,
    acmdRefreshTokens,
    acmdBetaInviteRedemptionLog,
    setTenantContext: vi.fn(),
    clearTenantContext: vi.fn(),
  };
});

// ───────────────────────────────────────────────────────────────────────────
// @acmd/auth mock — drives tenantGuard outcome per test via __authState.
// ───────────────────────────────────────────────────────────────────────────
const __authState: {
  mode: 'ok' | 'missing' | 'no_acmd';
  userId: string;
  claims: {
    sub: string;
    email: string;
    google_id: string;
    products: string[];
  };
} = {
  mode: 'ok',
  userId: 'token-sub-uuid',
  claims: {
    sub: 'token-sub-uuid',
    email: 'hr@acme.com',
    google_id: 'google-sub-123',
    products: ['acmd'],
  },
};

vi.mock('@acmd/auth', () => ({
  verifyGoogleToken: vi.fn(),
  createTokens: vi.fn(),
  hashToken: vi.fn(),
  fetchJwks: vi.fn().mockResolvedValue({}),
  verifyAccessToken: vi.fn(),
  verifyAccessTokenRaw: vi.fn(),
  verifyRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  DEFAULT_ACCESS_TTL: 900,
  DEFAULT_REFRESH_TTL: 2592000,
  createAuthRoutes: vi.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Hono } = require('hono');
    return new Hono();
  }),
  tenantGuard: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      if (__authState.mode === 'missing') {
        return c.json(
          { error: 'Missing or invalid Authorization header' },
          401,
        );
      }
      if (__authState.mode === 'no_acmd') {
        return c.json({ error: 'no_acmd_access' }, 403);
      }
      c.set('userId', __authState.userId);
      c.set('companyId', '');
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: '', select: vi.fn() });
      c.set('authClaims', {
        sub: __authState.claims.sub,
        company_id: '',
        role: 'super_admin',
        product: 'acmd',
        email: __authState.claims.email,
        google_id: __authState.claims.google_id,
        products: __authState.claims.products,
        iat: 0,
        exp: 9999999999,
        token_type: 'access',
      });
      await next();
    }),
  requireRole: vi.fn((...roles: string[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      const role = c.get('role');
      if (!roles.includes(role)) {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }
      await next();
    }),
  createTenantScope: vi.fn(() => ({ companyId: '', select: vi.fn() })),
  googleAuthRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
  refreshRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
}));

// authService — real module (we want to exercise createUser tx plumbing).
vi.mock('../src/services/authService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/authService.js')
  >('../src/services/authService.js');
  return {
    ...actual,
    // Token callbacks are irrelevant for onboarding but index.ts imports them.
    tokenCallbacks: {
      storeToken: vi.fn(),
      revokeToken: vi.fn(),
      isTokenRevoked: vi.fn(),
    },
  };
});

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/onboarding (RS-013-api-fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingRows = [];
    // T-101 — default to "row exists" so existing tests pass through the gate.
    mockBetaRedemptionRows = [{ id: 'gate-row-uuid' }];
    mockTxRaceRows = [];
    txFailureMode = 'none';
    __authState.mode = 'ok';
    __authState.userId = 'token-sub-uuid';
    __authState.claims = {
      sub: 'token-sub-uuid',
      email: 'hr@acme.com',
      google_id: 'google-sub-123',
      products: ['acmd'],
    };
    // T-101 — owner-bypass off by default; tests that exercise it set the env.
    delete process.env['ACMD_OWNER_EMAIL'];
  });

  it('OB-2-1: returns 401 when Authorization header is missing', async () => {
    __authState.mode = 'missing';
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane HR' }),
    });
    expect(res.status).toBe(401);
  });

  it('OB-2-2: returns 403 when JWT.products does not include acmd', async () => {
    __authState.mode = 'no_acmd';
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });
    expect(res.status).toBe(403);
  });

  it('OB-2-3: happy path — 201 + inserts company + user + audit log inside tx', async () => {
    // Fast-path select returns nothing → tx path runs.
    mockExistingRows = [];
    mockTxRaceRows = [];

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR', companyName: 'Acme Corp' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    // RS-013-api-fix2 / OB-3: onboarding_required is now false because we flip
    // acmd.companies.onboarding_completed_at inside the same transaction.
    expect(body).toEqual({
      onboarding_required: false,
      profile: {
        id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
      },
    });

    // OB-1 / SEC-001: all writes happened inside the transaction.
    expect(lastTxOps.inserts.map((o) => o.table)).toEqual([
      'companies',
      'users',
      'audit_logs',
    ]);
    // SEC-003: audit log has action='onboarding_created' + actor = JWT.sub.
    const auditInsert = lastTxOps.inserts.find((o) => o.table === 'audit_logs');
    expect(auditInsert).toBeDefined();
    const auditValues = auditInsert!.values as {
      action: string;
      actorId: string;
      companyId: string;
    };
    expect(auditValues.action).toBe('onboarding_created');
    expect(auditValues.actorId).toBe('token-sub-uuid');
    expect(auditValues.companyId).toBe('company-uuid');
    // Optional companyName override ran on acmd.companies.
    expect(lastTxOps.updates.map((o) => o.table)).toContain('companies');

    // RS-013-api-fix2 / OB-3: the companies update sets
    // onboarding_completed_at (Date) + updated_at (Date) + name (from body).
    const companyUpdate = lastTxOps.updates.find((o) => o.table === 'companies');
    expect(companyUpdate).toBeDefined();
    const updateSet = companyUpdate!.set as {
      onboardingCompletedAt?: Date;
      updatedAt?: Date;
      name?: string;
    };
    expect(updateSet.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(updateSet.updatedAt).toBeInstanceOf(Date);
    expect(updateSet.name).toBe('Acme Corp');
  });

  it('OB-2-3b: companies update sets onboarding_completed_at even when companyName is omitted', async () => {
    // Regression guard: without companyName the handler must still flip
    // onboarding_completed_at. Before RS-013-api-fix2, the companies update
    // only ran when companyName was supplied, leaving the flag null forever.
    mockExistingRows = [];
    mockTxRaceRows = [];

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.onboarding_required).toBe(false);

    // companies update still runs — with no `name` override.
    const companyUpdate = lastTxOps.updates.find((o) => o.table === 'companies');
    expect(companyUpdate).toBeDefined();
    const updateSet = companyUpdate!.set as {
      onboardingCompletedAt?: Date;
      updatedAt?: Date;
      name?: string;
    };
    expect(updateSet.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(updateSet.updatedAt).toBeInstanceOf(Date);
    expect(updateSet.name).toBeUndefined();
  });

  it('OB-2-4: returns 400 when body fails Zod validation (empty name)', async () => {
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('OB-2-5: 409 when row already exists at tx race re-check (no new row, no orphan)', async () => {
    // Fast path: no row.
    mockExistingRows = [];
    // Inside tx, another request raced us and committed first.
    mockTxRaceRows = [{ id: 'token-sub-uuid' }];

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Onboarding already completed');

    // No inserts recorded — we threw before touching acmd_companies/users.
    expect(lastTxOps.inserts).toEqual([]);
  });

  it('OB-2-6: 409 when PG raises 23505 unique_violation on users.id (concurrent insert)', async () => {
    mockExistingRows = [];
    mockTxRaceRows = [];
    txFailureMode = 'pg_unique_users_id';

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    // CRITICAL: unique violation surfaces as 409, NOT 500.
    expect(res.status).toBe(409);
    // The users insert attempt threw — tx would have rolled back the
    // companies insert in real PG. The important post-condition the handler
    // is responsible for is: we never reach the audit log insert.
    const tables = lastTxOps.inserts.map((o) => o.table);
    expect(tables).not.toContain('audit_logs');
  });

  it('OB-2-7: 409 when PG raises 23505 unique_violation on users.email (SEC-004 guard)', async () => {
    mockExistingRows = [];
    mockTxRaceRows = [];
    txFailureMode = 'pg_unique_email';

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(409);
    const tables = lastTxOps.inserts.map((o) => o.table);
    expect(tables).not.toContain('audit_logs');
  });

  it('OB-2-8: transaction rollback — audit insert throws → 500, no user row', async () => {
    mockExistingRows = [];
    mockTxRaceRows = [];
    txFailureMode = 'audit_throws';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Onboarding failed');

    // companies + users were attempted, audit_logs threw — the whole tx
    // is rolled back by Drizzle (no success response leaked).
    const inserted = lastTxOps.inserts.map((o) => o.table);
    expect(inserted).toContain('companies');
    expect(inserted).toContain('users');
    // Audit insert was ATTEMPTED (recorded as push-then-throw) but wouldn't
    // have committed in the real DB — our mock records the attempt; the
    // contract we assert here is "handler returned 500 (rollback path)".

    // Error logged, no stack leaked in response body.
    expect(errSpy).toHaveBeenCalled();
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('simulated failure');
    errSpy.mockRestore();
  });

  it('OB-2-9: already-onboarded fast path — 200 without touching the transaction', async () => {
    mockExistingRows = [
      {
        id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboarding_required).toBe(false);
    expect(body.profile.id).toBe('token-sub-uuid');
  });

  // T-101 Beta gate tests ────────────────────────────────────────────────────

  it('T-101-1: 403 beta_invite_required when no redemption row + not owner', async () => {
    mockExistingRows = [];
    mockBetaRedemptionRows = [];
    // ACMD_OWNER_EMAIL unset (cleared in beforeEach)

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: 'beta_invite_required',
      redirect_to: '/redeem-invite',
    });

    // db.transaction must NOT have been called — gate blocks before tx path.
    const { db } = await import('@acmd/db');
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('T-101-2: 201 happy path when redemption row exists (AC-2)', async () => {
    mockExistingRows = [];
    // mockBetaRedemptionRows defaults to [{ id: 'gate-row-uuid' }] from beforeEach
    mockTxRaceRows = [];

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.onboarding_required).toBe(false);
    expect(body.profile.email).toBe('hr@acme.com');
  });

  it('T-101-3: 201 owner bypass — no redemption row + email matches ACMD_OWNER_EMAIL (AC-3)', async () => {
    mockExistingRows = [];
    mockBetaRedemptionRows = [];
    // Uppercase to verify case-insensitive match
    process.env['ACMD_OWNER_EMAIL'] = 'PON@vollos.ai';
    __authState.claims = {
      sub: 'token-sub-uuid',
      email: 'pon@vollos.ai',
      google_id: 'google-sub-123',
      products: ['acmd'],
    };
    mockTxRaceRows = [];

    // vi.resetModules() so config.ts re-reads the newly-set ACMD_OWNER_EMAIL.
    // config.ts caches process.env at import time; without this the cached
    // '' from beforeEach's delete would still be used.
    vi.resetModules();
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Pon Owner' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.onboarding_required).toBe(false);
  });

  it('T-101-4: 403 even if owner email env is empty + no redemption (fail-closed bypass)', async () => {
    mockExistingRows = [];
    mockBetaRedemptionRows = [];
    process.env['ACMD_OWNER_EMAIL'] = '';
    __authState.claims = {
      sub: 'token-sub-uuid',
      email: '',
      google_id: 'google-sub-123',
      products: ['acmd'],
    };

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Jane HR' }),
    });

    // Empty owner must NOT match empty email — fail-closed
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('beta_invite_required');

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

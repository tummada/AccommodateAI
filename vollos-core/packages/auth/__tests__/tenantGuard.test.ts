// Unit tests for tenantGuard() + createTenantScope() — RS256
// Uses Hono test helpers — no real DB needed

import { describe, it, expect, beforeAll } from 'vitest';
import type { KeyLike } from 'jose';
import { Hono } from 'hono';
import { tenantGuard, createTenantScope } from '../src/tenantGuard.js';
import { createTokens, generateRsaKeyPair } from '../src/jwt.js';
import type { AuthVariables } from '../src/types.js';

// Shared RSA key pair — generated once for all tests
let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;
let wrongPrivateKey: KeyLike; // different key pair for "wrong key" test

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  testPrivateKey = pair.privateKey;
  testPublicKey = pair.publicKey;

  const wrongPair = await generateRsaKeyPair();
  wrongPrivateKey = wrongPair.privateKey;
});

const userPayload = {
  sub: 'user-001',
  company_id: 'company-A',
  role: 'admin',
  product: 'acmd',
};

function makeApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use(
    '/protected/*',
    tenantGuard({
      publicKey: testPublicKey,
      createScopedDb: (companyId) =>
        createTenantScope(
          {
            db: { select: () => ({ from: () => [] }) },
            scopedSelect: (cid, db, ...args) => {
              const query = (db as any).select(...args);
              return { from: (table: any) => query.from(table) };
            },
          },
          companyId,
        ),
    }),
  );

  app.get('/protected/data', (c) => {
    const tenantDb = c.get('tenantDb');
    return c.json({
      userId: c.get('userId'),
      companyId: c.get('companyId'),
      role: c.get('role'),
      product: c.get('product'),
      tenantCompanyId: tenantDb.companyId,
    });
  });

  return app;
}

describe('tenantGuard()', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp();
    const res = await app.request('/protected/data');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing or invalid/);
  });

  it('returns 401 for malformed Authorization header (no Bearer)', async () => {
    const app = makeApp();
    const res = await app.request('/protected/data', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid/tampered token', async () => {
    const app = makeApp();
    const res = await app.request('/protected/data', {
      headers: { Authorization: 'Bearer this.is.not.valid' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid or expired/);
  });

  it('returns 401 for token signed with wrong private key', async () => {
    const app = makeApp();
    // Token signed with wrongPrivateKey cannot be verified with testPublicKey
    const tokens = await createTokens(userPayload, { privateKey: wrongPrivateKey });
    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('injects correct context variables for valid token', async () => {
    const app = makeApp();
    const tokens = await createTokens(userPayload, { privateKey: testPrivateKey });

    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-001');
    expect(body.companyId).toBe('company-A');
    expect(body.role).toBe('admin');
    expect(body.product).toBe('acmd');
  });

  it('tenantDb.companyId matches JWT company_id (cross-tenant isolation)', async () => {
    const app = makeApp();
    const tokens = await createTokens(userPayload, { privateKey: testPrivateKey });

    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    const body = await res.json();
    // tenantDb must be scoped to the JWT's company — not some other company
    expect(body.tenantCompanyId).toBe('company-A');
    expect(body.tenantCompanyId).toBe(body.companyId);
  });
});

// -----------------------------------------------------------------------
// createTenantScope() — Legacy (deprecated passthrough)
// -----------------------------------------------------------------------

describe('createTenantScope() — legacy signature', () => {
  it('returns object with correct companyId', () => {
    const mockDb = { select: () => ({ from: () => [] }) };
    const scoped = createTenantScope(mockDb, 'company-XYZ');
    expect(scoped.companyId).toBe('company-XYZ');
  });

  it('proxies select() to underlying db (passthrough)', () => {
    const mockSelect = () => ({ from: () => ['row1'] });
    const mockDb = { select: mockSelect };
    const scoped = createTenantScope(mockDb, 'company-XYZ');
    const result = scoped.select();
    expect(result).toHaveProperty('from');
  });

  it('different companyIds produce different scopes', () => {
    const mockDb = { select: () => ({}) };
    const scopeA = createTenantScope(mockDb, 'company-A');
    const scopeB = createTenantScope(mockDb, 'company-B');
    expect(scopeA.companyId).not.toBe(scopeB.companyId);
  });
});

// -----------------------------------------------------------------------
// createTenantScope() — New options-based (auto-inject WHERE)
// -----------------------------------------------------------------------

describe('createTenantScope() — auto-inject WHERE company_id', () => {
  /**
   * Simulate a Drizzle-like DB where select().from(table) returns rows.
   * The scopedSelect callback auto-injects WHERE company_id = companyId.
   */
  const allRows = [
    { id: 1, company_id: 'company-A', name: 'Alice' },
    { id: 2, company_id: 'company-B', name: 'Bob' },
    { id: 3, company_id: 'company-A', name: 'Charlie' },
    { id: 4, company_id: 'company-B', name: 'Diana' },
  ];

  // Mock DB that mimics db.select().from(table) returning all rows
  const mockDb = {
    select: (..._args: unknown[]) => ({
      from: (_table: unknown) => ({
        where: (filterFn: (row: typeof allRows[number]) => boolean) =>
          allRows.filter(filterFn),
        // Without where — returns all rows (unsafe)
        rows: allRows,
      }),
    }),
  };

  // Product's scopedSelect callback — auto-injects WHERE company_id = companyId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scopedSelect = (companyId: string, db: any, ...args: any[]) => {
    const query = db.select(...args);
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: any) =>
        query
          .from(table)
          .where((row: { company_id: string }) => row.company_id === companyId),
    };
  };

  it('select().from() auto-scopes to company-A only', () => {
    const scoped = createTenantScope({ db: mockDb, scopedSelect }, 'company-A');
    const result = scoped.select().from('bookings');

    // Must only see company-A rows — auto-injected by scopedSelect
    expect(result).toHaveLength(2);
    expect(result.every((r: { company_id: string }) => r.company_id === 'company-A')).toBe(true);
    expect(result.map((r: { name: string }) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('select().from() auto-scopes to company-B only', () => {
    const scoped = createTenantScope({ db: mockDb, scopedSelect }, 'company-B');
    const result = scoped.select().from('bookings');

    expect(result).toHaveLength(2);
    expect(result.every((r: { company_id: string }) => r.company_id === 'company-B')).toBe(true);
    expect(result.map((r: { name: string }) => r.name)).toEqual(['Bob', 'Diana']);
  });

  it('company-A scope cannot see company-B data (cross-tenant isolation)', () => {
    const scopeA = createTenantScope({ db: mockDb, scopedSelect }, 'company-A');
    const scopeB = createTenantScope({ db: mockDb, scopedSelect }, 'company-B');

    const resultA = scopeA.select().from('bookings');
    const resultB = scopeB.select().from('bookings');

    // A must not contain B's rows and vice versa
    const idsA = resultA.map((r: { id: number }) => r.id);
    const idsB = resultB.map((r: { id: number }) => r.id);
    const overlap = idsA.filter((id: number) => idsB.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('empty result for non-existent company', () => {
    const scoped = createTenantScope({ db: mockDb, scopedSelect }, 'company-NONEXISTENT');
    const result = scoped.select().from('bookings');
    expect(result).toHaveLength(0);
  });

  it('scopedSelect callback receives correct companyId', () => {
    let receivedCompanyId = '';
    const trackingScopedSelect = (companyId: string, db: any, ...args: any[]) => {
      receivedCompanyId = companyId;
      return db.select(...args).from('x');
    };

    const scoped = createTenantScope(
      { db: mockDb, scopedSelect: trackingScopedSelect },
      'company-TRACKED',
    );
    scoped.select();
    expect(receivedCompanyId).toBe('company-TRACKED');
  });
});

// Unit tests for tenantGuard() + createTenantScope()
// Uses Hono test helpers — no real DB needed
// RS256: tokens are minted with privateKey, verified with publicKey

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { KeyLike } from 'jose';
import { SignJWT } from 'jose';
import { tenantGuard, createTenantScope } from '../src/tenantGuard.js';
import { generateRsaKeyPair } from '../src/jwt.js';
import type { AuthVariables } from '../src/types.js';

// RSA key pair shared across all tests in this file
let privateKey: KeyLike;
let publicKey: KeyLike;

const userPayload = {
  sub: 'user-001',
  company_id: 'company-A',
  role: 'admin',
  product: 'acmd',
};

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

/** Mint an RS256 access token for tests */
async function mintAccessToken(
  payload: typeof userPayload,
  ttl = 900,
): Promise<string> {
  return new SignJWT({
    company_id: payload.company_id,
    role: payload.role,
    product: payload.product,
    token_type: 'access',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(privateKey);
}

function makeApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use(
    '/protected/*',
    tenantGuard({
      publicKey,
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
    // Generate a different key pair — token signed with wrongPair.privateKey
    const wrongPair = await generateRsaKeyPair();
    const wrongToken = await new SignJWT({
      company_id: 'company-A',
      role: 'admin',
      product: 'acmd',
      token_type: 'access',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('user-001')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(wrongPair.privateKey);

    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('injects correct context variables for valid token', async () => {
    const app = makeApp();
    const token = await mintAccessToken(userPayload);

    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${token}` },
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
    const token = await mintAccessToken(userPayload);

    const res = await app.request('/protected/data', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
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

// Unit tests for requireRole() middleware — RS256
// Tests RBAC enforcement — 403 when role not allowed

import { describe, it, expect, beforeAll } from 'vitest';
import type { KeyLike } from 'jose';
import { Hono } from 'hono';
import { requireRole } from '../src/roleGuard.js';
import { tenantGuard, createTenantScope } from '../src/tenantGuard.js';
import { createTokens, generateRsaKeyPair } from '../src/jwt.js';
import type { AuthVariables } from '../src/types.js';

// Shared RSA key pair — generated once for all tests
let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  testPrivateKey = pair.privateKey;
  testPublicKey = pair.publicKey;
});

function makeApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Apply tenantGuard to all routes (injects role into context)
  app.use(
    '*',
    tenantGuard({
      publicKey: testPublicKey,
      createScopedDb: (companyId) => createTenantScope({}, companyId),
    }),
  );

  // Admin-only route
  app.get('/admin/settings', requireRole('admin'), (c) => {
    return c.json({ accessed: true, route: 'admin-settings' });
  });

  // Admin + Manager route
  app.get('/cases', requireRole('admin', 'manager'), (c) => {
    return c.json({ accessed: true, route: 'cases' });
  });

  // All roles allowed
  app.get('/dashboard', requireRole('admin', 'manager', 'viewer'), (c) => {
    return c.json({ accessed: true, route: 'dashboard' });
  });

  return app;
}

async function makeToken(role: string) {
  const tokens = await createTokens(
    { sub: 'user-001', company_id: 'co-A', role, product: 'acmd' },
    { privateKey: testPrivateKey },
  );
  return tokens.accessToken;
}

describe('requireRole()', () => {
  // -------------------------------------------------------------------
  // Admin-only route
  // -------------------------------------------------------------------
  it('allows admin to access admin route', async () => {
    const app = makeApp();
    const token = await makeToken('admin');
    const res = await app.request('/admin/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessed).toBe(true);
  });

  it('returns 403 when viewer tries to access admin route', async () => {
    const app = makeApp();
    const token = await makeToken('viewer');
    const res = await app.request('/admin/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Insufficient permissions/);
    // Fix 5 (ACMD-065): role info removed from 403 response for security
    expect(body.current).toBeUndefined();
    expect(body.required).toBeUndefined();
  });

  it('returns 403 when manager tries to access admin route', async () => {
    const app = makeApp();
    const token = await makeToken('manager');
    const res = await app.request('/admin/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // Admin + Manager route
  // -------------------------------------------------------------------
  it('allows manager to access cases route', async () => {
    const app = makeApp();
    const token = await makeToken('manager');
    const res = await app.request('/cases', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 403 when viewer tries to access cases route', async () => {
    const app = makeApp();
    const token = await makeToken('viewer');
    const res = await app.request('/cases', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // All-roles route
  // -------------------------------------------------------------------
  it('allows viewer to access dashboard', async () => {
    const app = makeApp();
    const token = await makeToken('viewer');
    const res = await app.request('/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------
  // No token (tenantGuard blocks first)
  // -------------------------------------------------------------------
  it('returns 401 when no token provided (tenantGuard kicks in)', async () => {
    const app = makeApp();
    const res = await app.request('/admin/settings');
    expect(res.status).toBe(401);
  });
});

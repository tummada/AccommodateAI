// Unit tests for requireRole() middleware
// Tests RBAC enforcement — 403 when role not allowed
// RS256: tokens minted with privateKey, verified with publicKey via tenantGuard

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { KeyLike } from 'jose';
import { SignJWT } from 'jose';
import { requireRole } from '../src/roleGuard.js';
import { tenantGuard, createTenantScope } from '../src/tenantGuard.js';
import { generateRsaKeyPair } from '../src/jwt.js';
import type { AuthVariables } from '../src/types.js';

let privateKey: KeyLike;
let publicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

function makeApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Apply tenantGuard to all routes (injects role into context)
  app.use(
    '*',
    tenantGuard({
      publicKey,
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

async function makeToken(role: string): Promise<string> {
  return new SignJWT({
    company_id: 'co-A',
    role,
    product: 'acmd',
    token_type: 'access',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('user-001')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
    .sign(privateKey);
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

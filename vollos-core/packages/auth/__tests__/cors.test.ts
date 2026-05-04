// Unit tests for RS-013 CORS helpers — parseAuthCorsOrigins + createAuthCors
//
// Verifies:
//   1. Env parsing (default fallback, comma-split, whitespace strip, empty rejection)
//   2. Mounted middleware responds to preflight OPTIONS with correct headers:
//        - Access-Control-Allow-Origin matches the allowlisted origin
//        - Access-Control-Allow-Credentials: true
//        - Access-Control-Allow-Methods contains GET, POST, OPTIONS
//        - Access-Control-Allow-Headers contains Content-Type + Authorization
//   3. Disallowed origin does NOT receive an Allow-Origin echo.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  parseAuthCorsOrigins,
  createAuthCors,
  DEFAULT_AUTH_CORS_ORIGIN,
  assertProductionCorsConfigured,
  PRODUCTION_CORS_MISSING_ERROR,
} from '../src/cors.js';

// -----------------------------------------------------------------------
// parseAuthCorsOrigins()
// -----------------------------------------------------------------------

describe('parseAuthCorsOrigins()', () => {
  it('returns DEFAULT_AUTH_CORS_ORIGIN when env is undefined', () => {
    expect(parseAuthCorsOrigins(undefined)).toEqual([DEFAULT_AUTH_CORS_ORIGIN]);
  });

  it('returns DEFAULT_AUTH_CORS_ORIGIN when env is empty string', () => {
    expect(parseAuthCorsOrigins('')).toEqual([DEFAULT_AUTH_CORS_ORIGIN]);
  });

  it('returns DEFAULT_AUTH_CORS_ORIGIN when env is all whitespace/commas', () => {
    expect(parseAuthCorsOrigins('  ,  ,  ')).toEqual([DEFAULT_AUTH_CORS_ORIGIN]);
  });

  it('splits a comma-separated list and trims whitespace', () => {
    expect(
      parseAuthCorsOrigins(
        'https://acmd.vollos.ai, https://staging.acmd.vollos.ai,  http://localhost:3003',
      ),
    ).toEqual([
      'https://acmd.vollos.ai',
      'https://staging.acmd.vollos.ai',
      'http://localhost:3003',
    ]);
  });

  it('drops empty tokens but keeps real origins', () => {
    expect(parseAuthCorsOrigins('https://acmd.vollos.ai,,')).toEqual([
      'https://acmd.vollos.ai',
    ]);
  });
});

// -----------------------------------------------------------------------
// createAuthCors() — preflight behavior
// -----------------------------------------------------------------------

describe('createAuthCors() — preflight OPTIONS', () => {
  function makeAppWith(origins: string[]): Hono {
    const app = new Hono();
    app.use('*', createAuthCors(origins));
    // Register a real route so non-preflight requests also traverse the middleware
    app.post('/auth/google', (c) => c.json({ accessToken: 'dummy' }));
    return app;
  }

  it('responds to preflight with Allow-Origin matching the allowlisted origin', async () => {
    const app = makeAppWith(['http://localhost:3003']);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3003',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    // hono/cors returns 204 for preflight by default
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3003',
    );
  });

  it('responds with Access-Control-Allow-Credentials: true', async () => {
    const app = makeAppWith(['http://localhost:3003']);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3003',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('advertises GET, POST, OPTIONS in Allow-Methods', async () => {
    const app = makeAppWith(['http://localhost:3003']);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3003',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    const allowMethods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    expect(allowMethods).toContain('GET');
    expect(allowMethods).toContain('POST');
    expect(allowMethods).toContain('OPTIONS');
  });

  it('advertises Content-Type and Authorization in Allow-Headers', async () => {
    const app = makeAppWith(['http://localhost:3003']);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3003',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowHeaders).toContain('Content-Type');
    expect(allowHeaders).toContain('Authorization');
  });

  it('does NOT echo Allow-Origin for a disallowed origin', async () => {
    const app = makeAppWith(['http://localhost:3003']);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    // hono/cors either omits the header or sets it to a falsy value for disallowed origins.
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    expect(allowOrigin).not.toBe('https://attacker.example');
  });

  it('accepts a second allowlisted origin from a multi-entry config', async () => {
    const app = makeAppWith([
      'http://localhost:3003',
      'https://acmd.vollos.ai',
    ]);

    const res = await app.request('/auth/google', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://acmd.vollos.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://acmd.vollos.ai',
    );
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

// -----------------------------------------------------------------------
// SEC-002 (RS-013-core-fix): production + missing AUTH_CORS_ORIGINS must
// throw at startup. Dev + missing env continues to fall back to localhost.
// -----------------------------------------------------------------------

describe('assertProductionCorsConfigured() — SEC-002 fail-closed', () => {
  it('throws in production when AUTH_CORS_ORIGINS is undefined', () => {
    expect(() =>
      assertProductionCorsConfigured('production', undefined),
    ).toThrow(PRODUCTION_CORS_MISSING_ERROR);
  });

  it('throws in production when AUTH_CORS_ORIGINS is empty string', () => {
    expect(() => assertProductionCorsConfigured('production', '')).toThrow(
      PRODUCTION_CORS_MISSING_ERROR,
    );
  });

  it('throws in production when AUTH_CORS_ORIGINS is whitespace-only', () => {
    expect(() =>
      assertProductionCorsConfigured('production', '   \t  '),
    ).toThrow(PRODUCTION_CORS_MISSING_ERROR);
  });

  it('does NOT throw in production when AUTH_CORS_ORIGINS is populated', () => {
    expect(() =>
      assertProductionCorsConfigured(
        'production',
        'https://acmd.vollos.ai',
      ),
    ).not.toThrow();
  });

  it('does NOT throw in development even when AUTH_CORS_ORIGINS is missing (dev fallback allowed)', () => {
    expect(() =>
      assertProductionCorsConfigured('development', undefined),
    ).not.toThrow();
    expect(() => assertProductionCorsConfigured('development', '')).not.toThrow();
  });

  it('does NOT throw when NODE_ENV is undefined (dev-like behaviour for local scripts)', () => {
    expect(() =>
      assertProductionCorsConfigured(undefined, undefined),
    ).not.toThrow();
  });

  it('does NOT throw when NODE_ENV is "test" even if env is missing', () => {
    expect(() => assertProductionCorsConfigured('test', undefined)).not.toThrow();
  });

  it('error message references AUTH_CORS_ORIGINS and localhost:3003 for operator greppability', () => {
    expect(PRODUCTION_CORS_MISSING_ERROR).toContain('AUTH_CORS_ORIGINS');
    expect(PRODUCTION_CORS_MISSING_ERROR).toContain('production');
    expect(PRODUCTION_CORS_MISSING_ERROR).toContain('localhost:3003');
  });
});

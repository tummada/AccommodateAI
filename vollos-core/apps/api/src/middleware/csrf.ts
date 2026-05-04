// csrf.ts — CSRF token generate + verify middleware for VOLLOS API

import { createMiddleware } from 'hono/factory';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const CSRF_HEADER = 'X-CSRF-Token';
// __Host- prefix requires Secure flag (HTTPS only) — use plain name in dev
const IS_DEV = process.env['NODE_ENV'] === 'development';
const CSRF_COOKIE = IS_DEV ? 'csrf-token' : '__Host-csrf-token';
const COOKIE_FLAGS = IS_DEV
  ? 'HttpOnly; SameSite=Strict; Path=/; Max-Age=3600'
  : 'HttpOnly; SameSite=Strict; Path=/; Secure; Max-Age=3600';
const TOKEN_BYTES = 32;

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

// Middleware to generate and set CSRF token cookie (used on GET requests)
export const csrfGenerate = createMiddleware(async (c, next) => {
  const token = generateToken();
  c.header(
    'Set-Cookie',
    `${CSRF_COOKIE}=${token}; ${COOKIE_FLAGS}`
  );
  c.set('csrfToken' as never, token);
  await next();
});

// Middleware to verify CSRF token on state-changing requests (POST/PUT/DELETE)
export const csrfVerify = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();
  // Only verify on mutating methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const cookieHeader = c.req.header('cookie') ?? '';
    const cookieToken = parseCookie(cookieHeader, CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);

    if (!cookieToken || !headerToken) {
      return c.json({ error: 'CSRF token missing' }, 403);
    }

    // Timing-safe comparison
    const a = Buffer.from(cookieToken, 'utf8');
    const b = Buffer.from(headerToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ error: 'CSRF token invalid' }, 403);
    }
  }

  await next();
});

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  if (!match) return null;
  return match.slice(name.length + 1);
}

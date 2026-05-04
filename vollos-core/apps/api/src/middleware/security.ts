// security.ts — Security headers middleware for VOLLOS API
// Required headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy

import type { MiddlewareHandler } from 'hono';

export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  await next();

  c.header(
    'Content-Security-Policy',
    "default-src 'self'; frame-ancestors 'none'"
  );
  c.header(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
};

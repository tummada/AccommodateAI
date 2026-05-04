// rateLimit.ts — Rate limiting middleware for VOLLOS API
// Per IP: 5 requests/min
// Per email: 3 requests/hour (applied in route handler)

import type { Context } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

// Regex for IPv4 and IPv6 addresses (same as leads.ts)
const IP_REGEX = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{2,39})$/;

// Trusted IP extraction: reads x-forwarded-for, takes last entry (Caddy appends real client IP at end)
// The last entry is set by our trusted reverse proxy (Caddy) — attacker cannot control it
export function getTrustedIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const candidate = forwarded.split(',').at(-1)!.trim();
  return IP_REGEX.test(candidate) ? candidate : 'unknown';
}

// Per-IP rate limit: 5 requests per minute
export const ipRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  standardHeaders: 'draft-6',
  keyGenerator: (c) => `ip:${getTrustedIp(c)}`,
});

// Per-email rate limit: 3 requests per hour
// Used inside route handler to check after parsing body
export const emailRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  standardHeaders: 'draft-6',
  keyGenerator: (c) => {
    // email is set on request context by route handler
    const email = c.get('rateLimitEmail' as never) as string | undefined;
    return `email:${email ?? 'unknown'}`;
  },
});

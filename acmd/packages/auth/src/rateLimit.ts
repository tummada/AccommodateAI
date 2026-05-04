// @acmd/auth — Rate Limit Middleware for Auth Endpoints
//
// Task R09: POST /auth/google max 10/min per IP, POST /auth/refresh max 30/min per IP
// Roadmap 7: "exceed limit → return 429 + Retry-After header"
// SKILL.md L100: "hono-rate-limiter (community package)" + "keyGenerator: x-forwarded-for"

import { rateLimiter } from 'hono-rate-limiter';
import type { MiddlewareHandler } from 'hono';

/**
 * IP-based key generator
 * SKILL.md L100: "x-forwarded-for can be spoofed if not behind trusted proxy"
 * If deployed behind Nginx/Cloudflare, ensure x-real-ip or trust proxy is configured.
 */
function ipKeyGenerator(c: Parameters<typeof rateLimiter>[0]['keyGenerator'] extends (c: infer C) => unknown ? C : never): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? 'unknown';
}

/**
 * Rate limiter for POST /auth/google
 * Max 10 requests per minute per IP
 */
export const googleAuthRateLimit: MiddlewareHandler = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: 'draft-6', // Adds RateLimit-* headers (includes Retry-After)
  keyGenerator: ipKeyGenerator,
  message: { error: 'Too many requests', retryAfter: 60 },
});

/**
 * Rate limiter for POST /auth/refresh
 * Max 30 requests per minute per IP
 */
export const refreshRateLimit: MiddlewareHandler = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  standardHeaders: 'draft-6',
  keyGenerator: ipKeyGenerator,
  message: { error: 'Too many requests', retryAfter: 60 },
});

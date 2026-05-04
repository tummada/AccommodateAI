// @vollos/auth — Shared CORS configuration helper
//
// RS-013 (Phase 1): auth-service needs permissive-but-explicit CORS so
// acmd-web (http://localhost:3003 in dev, plus production domains) can
// call POST /auth/google / /auth/refresh / /auth/logout with
// `credentials: 'include'` to carry the httpOnly refresh cookie.
//
// This file centralises the allowlist parsing + middleware factory so the
// same configuration can be unit-tested in isolation and mounted from
// apps/auth-service/src/index.ts without inline duplication.

import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

/**
 * Default allowlist used when `AUTH_CORS_ORIGINS` is missing or empty.
 *
 * Local dev: acmd-web runs at :3003 and needs to reach auth-service at
 * :3004 across the port boundary → browsers require a CORS allow header.
 *
 * Production SHOULD set AUTH_CORS_ORIGINS explicitly — never rely on the
 * default in production because :3003 is a dev-only origin.
 */
export const DEFAULT_AUTH_CORS_ORIGIN = 'http://localhost:3003';

/**
 * Parse a comma-separated AUTH_CORS_ORIGINS env string into an allowlist.
 *
 * - Empty / missing  → `[DEFAULT_AUTH_CORS_ORIGIN]`
 * - Whitespace-only tokens are dropped.
 * - Order is preserved (first match wins in hono/cors).
 *
 * Examples:
 *   parseAuthCorsOrigins(undefined)
 *     → ['http://localhost:3003']
 *   parseAuthCorsOrigins('https://acmd.vollos.ai')
 *     → ['https://acmd.vollos.ai']
 *   parseAuthCorsOrigins('https://acmd.vollos.ai, https://staging.acmd.vollos.ai')
 *     → ['https://acmd.vollos.ai', 'https://staging.acmd.vollos.ai']
 */
export function parseAuthCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [DEFAULT_AUTH_CORS_ORIGIN];
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : [DEFAULT_AUTH_CORS_ORIGIN];
}

/**
 * SEC-002 (RS-013-core-fix): fail-closed guard for CORS configuration in
 * production. `createAuthCors()` sets `credentials: true`, and
 * `parseAuthCorsOrigins(undefined/'')` silently falls back to the dev origin
 * `http://localhost:3003`. If a production deployment forgets to set
 * `AUTH_CORS_ORIGINS`, the service would happily trust a dev origin with
 * credentials — a classic misconfiguration footgun (OWASP A05:2021).
 *
 * This helper centralises the check so the same behaviour can be unit-tested
 * in isolation and invoked from the auth-service bootstrap.
 *
 *   - Production (`nodeEnv === 'production'`) + empty/missing `corsEnv` → throw.
 *   - Any non-production environment → no-op (dev fallback is allowed).
 *   - Whitespace-only env value is treated as empty.
 *
 * Error message is fixed and production-grade so ops can grep it in logs.
 */
export const PRODUCTION_CORS_MISSING_ERROR =
  'AUTH_CORS_ORIGINS must be set in production — refusing to fall back to localhost:3003';

export function assertProductionCorsConfigured(
  nodeEnv: string | undefined,
  corsEnv: string | undefined,
): void {
  if (nodeEnv !== 'production') return;
  const trimmed = typeof corsEnv === 'string' ? corsEnv.trim() : '';
  if (trimmed.length === 0) {
    throw new Error(PRODUCTION_CORS_MISSING_ERROR);
  }
}

/**
 * Build the CORS middleware used by auth-service.
 *
 * - `credentials: true` is required so the browser will send the refresh
 *   cookie back on cross-origin /auth/refresh calls.
 * - Methods are restricted to what auth-service actually exposes
 *   (GET for /.well-known/jwks.json + /health; POST for /auth/*).
 * - allowHeaders keeps the surface minimal — Authorization (bearer access
 *   token) + Content-Type (JSON bodies).
 */
export function createAuthCors(origins: string[]): MiddlewareHandler {
  return cors({
    origin: origins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
}

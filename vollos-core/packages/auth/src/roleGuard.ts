// @vollos/auth — Role-Based Access Control Middleware (Hono)
//
// Task R06: requireRole(...roles) — check JWT role before route access
// Roadmap 4: "middleware requireRole('admin', 'manager') → viewer → 403"
// Design: role matrix is GENERIC — product defines what each role can do

import type { MiddlewareHandler } from 'hono';
import type { AuthEnv } from './types.js';

/**
 * requireRole(...roles) — Hono middleware
 *
 * Must be used AFTER tenantGuard() (which injects `role` into context).
 *
 * Returns 401 if no role found in context (guard not applied upstream).
 * Returns 403 if authenticated user's role is not in the allowed list.
 *
 * @param allowedRoles - one or more roles permitted to access the route
 *
 * @example
 * app.delete('/cases/:id',
 *   tenantGuard({ jwtSecret, createScopedDb }),
 *   requireRole('admin', 'manager'),
 *   deleteCase,
 * );
 */
export function requireRole(...allowedRoles: string[]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const role = c.get('role');

    if (!role) {
      // tenantGuard was not applied — programming error
      return c.json({ error: 'Authentication required' }, 401);
    }

    if (!allowedRoles.includes(role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
}

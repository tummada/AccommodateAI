// @acmd/api — Users Routes
// GET /api/v1/users/managers — list users with role = 'manager' in current company

import { Hono } from 'hono';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { db } from '@acmd/db';
import { acmdUsers } from '@acmd/db';
import type { AuthEnv } from '@acmd/auth';
import { requireRole } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';

const users = new Hono<AuthEnv>();

/**
 * GET /users/managers — list managers in current company
 * Requires: super_admin or hr role
 * Returns: { managers: Array<{ id, displayName, email }> }
 * Ordered by displayName ASC. Empty list → { managers: [] } (not an error).
 * NEVER returns: passwordHash, refreshTokenHash, or any sensitive fields.
 */
users.get(
  '/managers',
  acmdTenantGuard,
  requireOnboarded,
  requireRole('super_admin', 'hr'),
  async (c) => {
    const companyId = c.get('companyId');

    const rows = await db
      .select({
        id: acmdUsers.id,
        displayName: acmdUsers.name,
        email: acmdUsers.email,
      })
      .from(acmdUsers)
      .where(
        and(
          eq(acmdUsers.companyId, companyId),
          eq(acmdUsers.role, 'manager'),
          isNull(acmdUsers.deletedAt),
        ),
      )
      .orderBy(asc(acmdUsers.name));

    return c.json({ managers: rows }, 200);
  },
);

export { users as usersRoutes };

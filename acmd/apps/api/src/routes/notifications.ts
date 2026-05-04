/**
 * Notification API Routes for AccommodateAI.
 *
 * Endpoints:
 *   GET    /api/v1/notifications                  — List notifications (filter + pagination)
 *   PATCH  /api/v1/notifications/:id/read         — Mark a single notification as read
 *   PATCH  /api/v1/notifications/read-all         — Mark all unread as read
 *
 * Query params for GET:
 *   read: "true" | "false" (omit = all)
 *   limit: 1-100 (default 20)
 *   offset: 0+ (default 0)
 *
 * Response for GET:
 *   { notifications: [...], total: number, unreadCount: number }
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - Scoped to company + current user (cannot see other users' notifications)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { db } from '@acmd/db';
import { acmdNotifications } from '@acmd/db';
import { eq, and, isNull, isNotNull, count, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// UUID Validator
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  read: z.enum(['true', 'false']).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().min(0)),
});

// ---------------------------------------------------------------------------
// Notification Routes
// ---------------------------------------------------------------------------

export const notificationRoutes = new Hono<AuthEnv>();

// All routes require auth
notificationRoutes.use('*', acmdTenantGuard, requireOnboarded);

/**
 * GET /api/v1/notifications — List notifications for current user
 * Scoped to company + user. Supports read/unread filter + pagination.
 */
notificationRoutes.get('/', async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');

  // Parse + validate query params
  const rawQuery = c.req.query();
  const parsed = listQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', issues: parsed.error.issues },
      400,
    );
  }

  const { read, limit, offset } = parsed.data;

  // Build where conditions
  const baseConditions = [
    eq(acmdNotifications.companyId, companyId),
    eq(acmdNotifications.userId, userId),
  ];

  let readCondition;
  if (read === 'true') {
    readCondition = isNotNull(acmdNotifications.readAt);
  } else if (read === 'false') {
    readCondition = isNull(acmdNotifications.readAt);
  }

  const whereClause = readCondition
    ? and(...baseConditions, readCondition)
    : and(...baseConditions);

  try {
    // Fetch paginated notifications
    const notifications = await db
      .select()
      .from(acmdNotifications)
      .where(whereClause)
      .orderBy(sql`${acmdNotifications.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    // Total count (matching filter)
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(acmdNotifications)
      .where(whereClause);

    // Unread count (always computed, regardless of filter)
    const [{ value: unreadCount }] = await db
      .select({ value: count() })
      .from(acmdNotifications)
      .where(
        and(
          eq(acmdNotifications.companyId, companyId),
          eq(acmdNotifications.userId, userId),
          isNull(acmdNotifications.readAt),
        ),
      );

    return c.json(
      {
        notifications,
        total,
        unreadCount,
      },
      200,
    );
  } catch (err) {
    console.error(
      '[Notifications] List error:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }
});

/**
 * PATCH /api/v1/notifications/read-all — Mark all unread notifications as read
 * Must be declared before /:id/read to avoid routing conflict.
 */
notificationRoutes.patch('/read-all', async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');

  try {
    const updated = await db
      .update(acmdNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(acmdNotifications.companyId, companyId),
          eq(acmdNotifications.userId, userId),
          isNull(acmdNotifications.readAt),
        ),
      )
      .returning({ id: acmdNotifications.id });

    return c.json({ markedRead: updated.length }, 200);
  } catch (err) {
    console.error(
      '[Notifications] Read-all error:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return c.json({ error: 'Failed to mark all as read' }, 500);
  }
});

/**
 * PATCH /api/v1/notifications/:id/read — Mark a single notification as read
 */
notificationRoutes.patch('/:id/read', async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const notificationId = c.req.param('id');

  if (!uuidRegex.test(notificationId)) {
    return c.json({ error: 'Invalid notification ID format' }, 400);
  }

  try {
    const [updated] = await db
      .update(acmdNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(acmdNotifications.id, notificationId),
          eq(acmdNotifications.companyId, companyId),
          eq(acmdNotifications.userId, userId),
          isNull(acmdNotifications.readAt), // idempotent — skip if already read
        ),
      )
      .returning({ id: acmdNotifications.id });

    if (!updated) {
      // Either not found or already read — both are acceptable, return 200
      return c.json({ message: 'Notification already read or not found' }, 200);
    }

    return c.json({ id: updated.id, readAt: new Date().toISOString() }, 200);
  } catch (err) {
    console.error(
      '[Notifications] Mark-read error:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return c.json({ error: 'Failed to mark notification as read' }, 500);
  }
});

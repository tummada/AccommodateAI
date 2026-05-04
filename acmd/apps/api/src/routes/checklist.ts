/**
 * Checklist API Routes for AccommodateAI.
 *
 * Endpoints:
 *   GET   /api/v1/cases/:id/checklist          — List checklist items for a case
 *   PATCH /api/v1/cases/:id/checklist/:itemId   — Toggle checklist item completion
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - PATCH requires admin or manager role
 *   - GET allows all roles (scoped to company)
 *   - Case must belong to the user's company
 *
 * Admin endpoint:
 *   POST /api/v1/admin/check-deadlines — admin only, triggers deadline scan
 */

import { Hono } from 'hono';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, acmdRequireAdmin, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  getChecklistItems,
  toggleChecklistItem,
} from '../services/checklistService.js';
import { checkDeadlines } from '../services/deadlineService.js';
import { checkUnacknowledgedCases } from '../services/caseService.js';
import { checkDeadlineEscalations } from '../services/notificationService.js';

// ---------------------------------------------------------------------------
// UUID Validator
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrManager = requireRole('super_admin', 'hr', 'manager');

// ---------------------------------------------------------------------------
// Checklist Routes (nested under /cases/:id/checklist)
// ---------------------------------------------------------------------------

const checklistRoutes = new Hono<AuthEnv>();

// All routes require auth
checklistRoutes.use('*', acmdTenantGuard, requireOnboarded);

/**
 * GET /cases/:id/checklist — List all checklist items for a case
 * Any authenticated role (scoped to company)
 */
checklistRoutes.get('/:id/checklist', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const items = await getChecklistItems(caseId, companyId);
    if (items === null) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json({ checklist: items }, 200);
  } catch (err) {
    console.error('[Checklist] List error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list checklist items' }, 500);
  }
});

/**
 * PATCH /cases/:id/checklist/:itemId — Toggle checklist item completion
 * Requires: admin or manager role
 */
checklistRoutes.patch('/:id/checklist/:itemId', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const itemId = c.req.param('itemId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(itemId)) {
    return c.json({ error: 'Invalid item ID format' }, 400);
  }

  try {
    const result = await toggleChecklistItem(caseId, itemId, companyId, userId);
    if (!result) {
      return c.json({ error: 'Case or checklist item not found' }, 404);
    }

    return c.json({
      item: result.item,
      allComplete: result.allComplete,
    }, 200);
  } catch (err) {
    console.error('[Checklist] Toggle error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to toggle checklist item' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Admin Routes
// ---------------------------------------------------------------------------

const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use('*', acmdTenantGuard, requireOnboarded);

/**
 * POST /admin/check-deadlines — Admin only, manually trigger deadline check
 */
adminRoutes.post('/check-deadlines', acmdRequireAdmin, async (c) => {
  try {
    const companyId = c.get('companyId');
    const result = await checkDeadlines(companyId);

    return c.json({
      message: 'Deadline check completed',
      casesChecked: result.casesChecked,
      warningsSent: result.warningsSent,
      overdueAlertsSent: result.overdueAlertsSent,
    }, 200);
  } catch (err) {
    console.error('[Admin] Deadline check error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to check deadlines' }, 500);
  }
});

/**
 * POST /admin/check-escalations — Admin only, manually trigger escalation check
 * Finds unacknowledged cases (assigned 2+ business days ago with no activity)
 * and notifies all super_admin users in the company.
 */
adminRoutes.post('/check-escalations', acmdRequireAdmin, async (c) => {
  try {
    const companyId = c.get('companyId');
    const result = await checkUnacknowledgedCases(companyId);

    return c.json({
      message: 'Escalation check completed',
      notifiedCount: result.notifiedCount,
      caseIds: result.caseIds,
    }, 200);
  } catch (err) {
    console.error('[Admin] Escalation check error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to check escalations' }, 500);
  }
});

/**
 * POST /admin/check-deadlines-v2 — Admin only, trigger full escalation chain (30d/7d/3d/1d/overdue)
 * Uses the new checkDeadlineEscalations() from notificationService with duplicate prevention.
 */
adminRoutes.post('/check-deadlines-v2', acmdRequireAdmin, async (c) => {
  try {
    const companyId = c.get('companyId');
    const result = await checkDeadlineEscalations(companyId);

    return c.json({
      message: 'Deadline escalation check completed',
      casesChecked: result.casesChecked,
      notificationsCreated: result.notificationsCreated,
      duplicatesSkipped: result.duplicatesSkipped,
    }, 200);
  } catch (err) {
    console.error('[Admin] Deadline escalation v2 error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to check deadline escalations' }, 500);
  }
});

export { checklistRoutes, adminRoutes };

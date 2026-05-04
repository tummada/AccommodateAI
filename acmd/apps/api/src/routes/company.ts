// @acmd/api — Company Routes
// PATCH /api/v1/company            — update company info (admin only)
// POST  /api/v1/company/onboarding/complete — mark onboarding done (admin only)
//
// Both routes require: acmdTenantGuard + acmdRequireAdmin

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@acmd/db';
import { acmdCompanies, acmdUsers } from '@acmd/db';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, acmdRequireAdmin, requireOnboarded } from '../middleware/auth.js';

/** SEC-007: Zod schema for PATCH /company input validation */
const updateCompanySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  hqState: z.string().length(2).optional(),
  size: z.number().int().positive().optional(),
  industry: z.string().max(255).optional(),
  // 3C.3: Default HR contact — must be super_admin or hr in same company
  defaultHrContactId: z.string().uuid().optional().nullable(),
});

const company = new Hono<AuthEnv>();

// Apply auth middleware to all company routes
company.use('*', acmdTenantGuard, requireOnboarded, acmdRequireAdmin);

/**
 * PATCH /company — update company info
 * Body: { name?, hqState?, size?, industry? }
 * Only admin role can update.
 */
company.patch('/', async (c) => {
  const companyId = c.get('companyId');

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // SEC-007: Zod validation
  const parsed = updateCompanySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  const { name, hqState, size, industry, defaultHrContactId } = parsed.data;

  // At least one field must be provided
  if (
    name === undefined
    && hqState === undefined
    && size === undefined
    && industry === undefined
    && defaultHrContactId === undefined
  ) {
    return c.json({ error: 'At least one field (name, hqState, size, industry, defaultHrContactId) is required' }, 400);
  }

  // 3C.3: Validate defaultHrContactId — must be super_admin or hr in same company
  if (defaultHrContactId !== undefined && defaultHrContactId !== null) {
    const [targetUser] = await db
      .select({ id: acmdUsers.id, role: acmdUsers.role, companyId: acmdUsers.companyId })
      .from(acmdUsers)
      .where(and(eq(acmdUsers.id, defaultHrContactId), isNull(acmdUsers.deletedAt)))
      .limit(1);

    if (!targetUser) {
      return c.json({ error: 'User not found for defaultHrContactId' }, 400);
    }
    if (targetUser.companyId !== companyId) {
      return c.json({ error: 'Default HR contact must belong to this company' }, 400);
    }
    if (targetUser.role !== 'hr' && targetUser.role !== 'super_admin') {
      return c.json({ error: 'Default HR contact must have hr or super_admin role' }, 400);
    }
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updateData['name'] = name;
  if (hqState !== undefined) updateData['hqState'] = hqState;
  if (size !== undefined) updateData['size'] = size;
  if (industry !== undefined) updateData['industry'] = industry;
  if (defaultHrContactId !== undefined) updateData['defaultHrContactId'] = defaultHrContactId;

  const [updated] = await db
    .update(acmdCompanies)
    .set(updateData)
    .where(eq(acmdCompanies.id, companyId))
    .returning({
      id: acmdCompanies.id,
      name: acmdCompanies.name,
      hqState: acmdCompanies.hqState,
      size: acmdCompanies.size,
      industry: acmdCompanies.industry,
      defaultHrContactId: acmdCompanies.defaultHrContactId,
      updatedAt: acmdCompanies.updatedAt,
    });

  if (!updated) {
    return c.json({ error: 'Company not found' }, 404);
  }

  return c.json({ company: updated }, 200);
});

/**
 * POST /company/onboarding/complete — mark onboarding as done
 * Sets onboarding_completed_at timestamp.
 * Only admin role can complete onboarding.
 */
company.post('/onboarding/complete', async (c) => {
  const companyId = c.get('companyId');

  const [updated] = await db
    .update(acmdCompanies)
    .set({
      onboardingCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(acmdCompanies.id, companyId))
    .returning({
      id: acmdCompanies.id,
      onboardingCompletedAt: acmdCompanies.onboardingCompletedAt,
    });

  if (!updated) {
    return c.json({ error: 'Company not found' }, 404);
  }

  return c.json({
    message: 'Onboarding completed',
    onboarding_completed_at: updated.onboardingCompletedAt,
  }, 200);
});

export { company as companyRoutes };

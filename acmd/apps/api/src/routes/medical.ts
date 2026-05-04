/**
 * Medical Request API Routes for AccommodateAI — Phase 7B.
 *
 * Endpoints:
 *   GET   /api/v1/cases/:id/medical-request           — Get current medical request status
 *   POST  /api/v1/cases/:id/medical-request           — Send medical documentation request
 *   PATCH /api/v1/cases/:id/medical-request/reviewer  — Assign medical reviewer
 *   PATCH /api/v1/cases/:id/medical-request/outcome   — Record reviewer determination
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - POST/PATCH require super_admin or hr role
 *   - GET allows all authenticated roles (scoped to company)
 *   - Input validated with Zod + UUID regex on all path params
 *   - NEVER exposes medicalInfo — filterMedicalFields applied at case level
 *   - Audit log written for every mutating action
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  getMedicalRequestView,
  sendMedicalRequest,
  assignMedicalReviewer,
  recordMedicalOutcome,
} from '../services/medicalRequestService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const sendMedicalRequestSchema = z.object({
  template: z.string().min(1, 'template is required').max(10000),
  limitations: z.string().min(1, 'limitations is required').max(5000),
  dueDate: z.string().min(1, 'dueDate is required'),
  deliveryMethod: z.enum(['email', 'mail', 'fax']),
  notes: z.string().max(2000).optional(),
});

const assignReviewerSchema = z.object({
  reviewerId: z.string().uuid('reviewerId must be a valid UUID'),
});

const recordOutcomeSchema = z.object({
  outcome: z.enum(['cleared', 'additional_needed', 'insufficient']),
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// UUID Validator
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrHr = requireRole('super_admin', 'hr');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const medical = new Hono<AuthEnv>();

// All medical routes require authentication (JWT + tenant scope)
medical.use('*', acmdTenantGuard, requireOnboarded);

/**
 * GET /cases/:id/medical-request — Get current medical request status
 * Any authenticated role (scoped to company via acmdTenantGuard)
 *
 * Returns status aggregated from case + letters + documents + reviewer.
 * Does NOT expose medicalInfo — medical filter is applied at case layer.
 */
medical.get('/:id/medical-request', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const view = await getMedicalRequestView(caseId, companyId);

    if (!view) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json(view, 200);
  } catch (err) {
    console.error('[Medical] GET error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to retrieve medical request status' }, 500);
  }
});

/**
 * POST /cases/:id/medical-request — Send a medical documentation request
 * Requires: super_admin or hr role
 * Body: { template, limitations, dueDate, deliveryMethod, notes? }
 *
 * Creates a medical_request letter (type='medical_request', status='draft')
 * and transitions case status to 'awaiting_medical'.
 */
medical.post('/:id/medical-request', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const actorId = c.get('userId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = sendMedicalRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await sendMedicalRequest(caseId, companyId, actorId, parsed.data);

    if (!result) {
      return c.json({ error: 'Case not found' }, 404);
    }

    if ('conflict' in result) {
      return c.json({
        error: 'Medical request already exists',
        letter: result.letter,
      }, 409);
    }

    return c.json({
      letter: result.letter,
      caseStatus: result.caseStatus,
    }, 201);
  } catch (err) {
    console.error('[Medical] POST error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to send medical request' }, 500);
  }
});

/**
 * PATCH /cases/:id/medical-request/reviewer — Assign medical reviewer
 * Requires: super_admin or hr role
 * Body: { reviewerId: UUID }
 *
 * Sets case.assignedTo = reviewerId and writes audit log.
 */
medical.patch('/:id/medical-request/reviewer', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const actorId = c.get('userId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = assignReviewerSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await assignMedicalReviewer(caseId, companyId, actorId, parsed.data.reviewerId);

    if (!result) {
      return c.json({ error: 'Case not found or no medical request exists' }, 404);
    }

    return c.json(result, 200);
  } catch (err) {
    console.error('[Medical] PATCH /reviewer error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to assign reviewer' }, 500);
  }
});

/**
 * PATCH /cases/:id/medical-request/outcome — Record reviewer determination
 * Requires: super_admin or hr role
 * Body: { outcome: 'cleared' | 'additional_needed' | 'insufficient', notes?: string }
 *
 * Case status transitions:
 *   cleared           → review
 *   additional_needed → awaiting_medical
 *   insufficient      → interactive_process
 */
medical.patch('/:id/medical-request/outcome', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const actorId = c.get('userId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = recordOutcomeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await recordMedicalOutcome(caseId, companyId, actorId, parsed.data);

    if (!result) {
      return c.json({ error: 'Case not found or no medical request exists' }, 404);
    }

    return c.json(result, 200);
  } catch (err) {
    console.error('[Medical] PATCH /outcome error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to record medical outcome' }, 500);
  }
});

export { medical as medicalRoutes };

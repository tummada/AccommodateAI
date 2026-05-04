/**
 * Letter API Routes for AccommodateAI.
 *
 * Endpoints:
 *   POST  /api/v1/cases/:id/letters              — AI generate letter draft
 *   GET   /api/v1/cases/:id/letters              — List letters for case
 *   PATCH /api/v1/cases/:id/letters/:letterId    — Edit draft
 *   POST  /api/v1/cases/:id/letters/:letterId/send — Send email
 *   GET   /api/v1/cases/:id/letters/:letterId/pdf  — Download PDF
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - POST/PATCH/send require admin or manager role
 *   - GET allows all roles (scoped to company)
 *   - Input validation with Zod
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  createLetter,
  listLetters,
  editLetter,
  sendLetter,
  getLetterPdf,
} from '../services/letterService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const createLetterSchema = z.object({
  type: z.enum(['acknowledgment', 'medical_request', 'approval', 'denial', 'follow_up']),
  customInstructions: z.string().max(2000).optional(),
});

const editLetterSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty').max(50000),
});

// ---------------------------------------------------------------------------
// UUID Validator
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrManager = requireRole('super_admin', 'hr', 'manager');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const letters = new Hono<AuthEnv>();

// All routes require auth + completed onboarding
// (RS-013 / Q-001 — pre-onboarding users rejected with 403).
letters.use('*', acmdTenantGuard, requireOnboarded);

/**
 * POST /cases/:id/letters — Generate AI letter draft
 * Requires: admin or manager role
 * Body: { type: LetterType, customInstructions?: string }
 */
letters.post('/:id/letters', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
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

  const parsed = createLetterSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await createLetter(caseId, companyId, userId, parsed.data);

    if (!result) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json({
      letter: result.letter,
      source: result.source,
    }, 201);
  } catch (err) {
    console.error('[Letters] Create error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to generate letter' }, 500);
  }
});

/**
 * GET /cases/:id/letters — List all letters for a case
 * Any authenticated role (scoped to company)
 */
letters.get('/:id/letters', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const items = await listLetters(caseId, companyId);
    return c.json({ letters: items }, 200);
  } catch (err) {
    console.error('[Letters] List error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list letters' }, 500);
  }
});

/**
 * PATCH /cases/:id/letters/:letterId — Edit letter draft content
 * Requires: admin or manager role
 * Body: { content: string }
 */
letters.patch('/:id/letters/:letterId', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');
  const letterId = c.req.param('letterId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(letterId)) {
    return c.json({ error: 'Invalid letter ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = editLetterSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const userId = c.get('userId');
    const updated = await editLetter(caseId, letterId, companyId, parsed.data.content, userId);
    if (!updated) {
      return c.json({ error: 'Letter not found or already sent' }, 404);
    }

    return c.json({ letter: updated }, 200);
  } catch (err) {
    console.error('[Letters] Edit error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to edit letter' }, 500);
  }
});

/**
 * POST /cases/:id/letters/:letterId/send — Send letter via email
 * Requires: admin or manager role
 */
letters.post('/:id/letters/:letterId/send', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const letterId = c.req.param('letterId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(letterId)) {
    return c.json({ error: 'Invalid letter ID format' }, 400);
  }

  try {
    const result = await sendLetter(caseId, letterId, companyId, userId);
    if (!result) {
      return c.json({ error: 'Letter not found' }, 404);
    }

    return c.json({
      letter: result.letter,
      emailSent: result.emailSent,
    }, 200);
  } catch (err) {
    console.error('[Letters] Send error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to send letter' }, 500);
  }
});

/**
 * GET /cases/:id/letters/:letterId/pdf — Download PDF
 * Any authenticated role (scoped to company)
 */
letters.get('/:id/letters/:letterId/pdf', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');
  const letterId = c.req.param('letterId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(letterId)) {
    return c.json({ error: 'Invalid letter ID format' }, 400);
  }

  try {
    const result = await getLetterPdf(caseId, letterId, companyId);
    if (!result) {
      return c.json({ error: 'Letter not found' }, 404);
    }

    return new Response(result.pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': String(result.pdf.length),
      },
    });
  } catch (err) {
    console.error('[Letters] PDF error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to generate PDF' }, 500);
  }
});

export { letters as letterRoutes };

/**
 * AI Suggestion API Routes for AccommodateAI.
 *
 * Endpoints:
 *   POST  /api/v1/cases/:id/suggestions                      — Generate AI suggestions
 *   GET   /api/v1/cases/:id/suggestions                      — List suggestions for case
 *   PATCH /api/v1/cases/:id/suggestions/:suggestionId         — Select/deselect suggestion (legacy)
 *   POST  /api/v1/cases/:id/suggestions/:suggestionId/select  — Select suggestion (5A.1)
 *   POST  /api/v1/cases/:id/suggestions/:suggestionId/reject  — Reject suggestion (5A.1)
 *   PATCH /api/v1/cases/:id/suggestions/:suggestionId/customize — Customize description (5A.2)
 *   GET   /api/v1/cases/:id/accommodations                    — List selected (5A.3)
 *   PATCH /api/v1/cases/:id/suggestions/:suggestionId/implementation — Update implementation (5A.3)
 *   POST  /api/v1/cases/:id/accommodations/manual             — Add manual accommodation (5A.5)
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - POST + PATCH require admin or manager role
 *   - GET allows all roles (scoped to company)
 *   - Input validation with Zod
 *   - UUID validation with regex
 *   - XSS prevention via sanitizeText
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  generateSuggestions,
  updateSuggestionSelection,
  getSuggestionsByCase,
  selectSuggestion,
  rejectSuggestion,
  customizeSuggestion,
  getAccommodations,
  updateImplementation,
  addManualAccommodation,
} from '../services/suggestionService.js';
import { autoPopulateApprovalLetter } from '../services/letterService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const generateSuggestionsSchema = z.object({
  budgetMax: z.number().positive().optional(),
  preferLowCost: z.boolean().optional(),
});

const updateSelectionSchema = z.object({
  selected: z.boolean(),
  reason: z.string().max(2000).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters').max(2000),
});

const customizeSchema = z.object({
  customizedDescription: z.string().min(1, 'Description cannot be empty').max(5000),
});

const implementationSchema = z.object({
  implementationStatus: z.enum(['pending', 'in_progress', 'completed']).optional(),
  implementationCost: z.number().min(0).max(999999999999.99).optional(),
}).refine((data) => data.implementationStatus !== undefined || data.implementationCost !== undefined, {
  message: 'At least one of implementationStatus or implementationCost must be provided',
});

const manualAccommodationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().min(1, 'Description is required').max(5000),
  source: z.enum(['employee_request', 'manager_suggestion', 'jan_search', 'other']),
  costEstimate: z.string().max(100).optional(),
  costRange: z.enum(['no_cost', 'low', 'moderate', 'high']).optional(),
  implementationStatus: z.enum(['pending', 'in_progress', 'completed']).optional(),
  implementationCost: z.number().min(0).max(999999999999.99).optional(),
});

// ---------------------------------------------------------------------------
// UUID Validator
// ---------------------------------------------------------------------------

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// XSS Sanitizer
// ---------------------------------------------------------------------------

/**
 * Strip HTML/script tags from user input to prevent XSS.
 * Preserves plain text content.
 */
function sanitizeText(input: string): string {
  return input.replace(/<\/?[^>]+(>|$)/g, '');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrManager = requireRole('super_admin', 'hr', 'manager');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const suggestions = new Hono<AuthEnv>();

// All routes require auth
suggestions.use('*', acmdTenantGuard, requireOnboarded);

/**
 * POST /cases/:id/suggestions — Generate AI accommodation suggestions
 * Requires: admin or manager role
 * Body: { budgetMax?: number, preferLowCost?: boolean }
 */
suggestions.post('/:id/suggestions', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let input: z.infer<typeof generateSuggestionsSchema> = {};
  try {
    const rawBody = await c.req.text();
    if (rawBody) {
      const parsed = generateSuggestionsSchema.safeParse(JSON.parse(rawBody));
      if (!parsed.success) {
        return c.json({
          error: 'Validation failed',
          issues: parsed.error.issues,
        }, 400);
      }
      input = parsed.data;
    }
  } catch {
    // Empty body is OK — no budget constraints
  }

  try {
    const result = await generateSuggestions(caseId, companyId, userId, input);

    if (result.error === 'Case not found') {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json({
      suggestions: result.suggestions,
      source: result.source,
      count: result.suggestions.length,
    }, 201);
  } catch (err) {
    console.error('[Suggestions] Generate error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to generate suggestions' }, 500);
  }
});

/**
 * GET /cases/:id/suggestions — List all suggestions for a case
 * Any authenticated role (scoped to company)
 */
suggestions.get('/:id/suggestions', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const items = await getSuggestionsByCase(caseId, companyId);
    return c.json({ suggestions: items }, 200);
  } catch (err) {
    console.error('[Suggestions] List error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list suggestions' }, 500);
  }
});

/**
 * PATCH /cases/:id/suggestions/:suggestionId — Select/deselect a suggestion (legacy)
 * Requires: admin or manager role
 * Body: { selected: boolean, reason?: string }
 */
suggestions.patch('/:id/suggestions/:suggestionId', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const suggestionId = c.req.param('suggestionId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(suggestionId)) {
    return c.json({ error: 'Invalid suggestion ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = updateSelectionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const sanitizedReason = parsed.data.reason ? sanitizeText(parsed.data.reason) : undefined;
    const updated = await updateSuggestionSelection(
      caseId,
      suggestionId,
      companyId,
      userId,
      parsed.data.selected,
      sanitizedReason,
    );

    if (!updated) {
      return c.json({ error: 'Suggestion not found' }, 404);
    }

    return c.json({ suggestion: updated }, 200);
  } catch (err) {
    console.error('[Suggestions] Update error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to update suggestion' }, 500);
  }
});

/**
 * POST /cases/:id/suggestions/:suggestionId/select — Select a suggestion (5A.1)
 * Requires: admin or manager role
 * Also triggers auto-populate letter if case status is review/approved (5A.4)
 */
suggestions.post('/:id/suggestions/:suggestionId/select', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const suggestionId = c.req.param('suggestionId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(suggestionId)) {
    return c.json({ error: 'Invalid suggestion ID format' }, 400);
  }

  try {
    const updated = await selectSuggestion(caseId, suggestionId, companyId, userId);

    if (!updated) {
      return c.json({ error: 'Suggestion not found' }, 404);
    }

    // Idempotency: skip letter auto-populate if suggestion was already selected
    let letter = null;
    if (!updated._alreadySelected) {
      // 5A.4: Auto-populate letter if case status is review/approved
      try {
        const letterResult = await autoPopulateApprovalLetter(caseId, companyId, userId);
        if (letterResult) {
          letter = { id: letterResult.letter.id, source: letterResult.source };
        }
      } catch (err) {
        // Letter auto-populate failure should not block selection
        console.error('[Suggestions] Auto-populate letter error:', err instanceof Error ? err.message : 'Unknown');
      }
    }

    // Remove internal flag before returning to client
    const { _alreadySelected, ...suggestionResponse } = updated;
    return c.json({ suggestion: suggestionResponse, letter }, 200);
  } catch (err) {
    console.error('[Suggestions] Select error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to select suggestion' }, 500);
  }
});

/**
 * POST /cases/:id/suggestions/:suggestionId/reject — Reject a suggestion (5A.1)
 * Requires: admin or manager role
 * Body: { reason: string } — mandatory, min 10 chars
 */
suggestions.post('/:id/suggestions/:suggestionId/reject', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const suggestionId = c.req.param('suggestionId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(suggestionId)) {
    return c.json({ error: 'Invalid suggestion ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = rejectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  // Sanitize reason to prevent XSS
  const sanitizedReason = sanitizeText(parsed.data.reason);

  try {
    const updated = await rejectSuggestion(caseId, suggestionId, companyId, userId, sanitizedReason);

    if (!updated) {
      return c.json({ error: 'Suggestion not found' }, 404);
    }

    return c.json({ suggestion: updated }, 200);
  } catch (err) {
    console.error('[Suggestions] Reject error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to reject suggestion' }, 500);
  }
});

/**
 * PATCH /cases/:id/suggestions/:suggestionId/customize — Customize description (5A.2)
 * Requires: admin or manager role
 * Body: { customizedDescription: string }
 */
suggestions.patch('/:id/suggestions/:suggestionId/customize', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const suggestionId = c.req.param('suggestionId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(suggestionId)) {
    return c.json({ error: 'Invalid suggestion ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = customizeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  // Sanitize description to prevent XSS
  const sanitizedDescription = sanitizeText(parsed.data.customizedDescription);

  try {
    const updated = await customizeSuggestion(caseId, suggestionId, companyId, userId, sanitizedDescription);

    if (!updated) {
      return c.json({ error: 'Suggestion not found' }, 404);
    }

    return c.json({ suggestion: updated }, 200);
  } catch (err) {
    console.error('[Suggestions] Customize error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to customize suggestion' }, 500);
  }
});

/**
 * GET /cases/:id/accommodations — List selected suggestions with total cost (5A.3)
 * Any authenticated role (scoped to company)
 */
suggestions.get('/:id/accommodations', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await getAccommodations(caseId, companyId);
    return c.json({
      accommodations: result.accommodations,
      totalCost: result.totalCost,
      count: result.accommodations.length,
    }, 200);
  } catch (err) {
    console.error('[Suggestions] Accommodations error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list accommodations' }, 500);
  }
});

/**
 * PATCH /cases/:id/suggestions/:suggestionId/implementation — Update implementation (5A.3)
 * Requires: admin or manager role
 * Body: { implementationStatus?: 'pending'|'in_progress'|'completed', implementationCost?: number }
 */
suggestions.patch('/:id/suggestions/:suggestionId/implementation', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');
  const suggestionId = c.req.param('suggestionId');

  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }
  if (!uuidRegex.test(suggestionId)) {
    return c.json({ error: 'Invalid suggestion ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = implementationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const updated = await updateImplementation(caseId, suggestionId, companyId, userId, parsed.data);

    if (!updated) {
      return c.json({ error: 'Suggestion not found' }, 404);
    }

    return c.json({ suggestion: updated }, 200);
  } catch (err) {
    console.error('[Suggestions] Implementation error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to update implementation' }, 500);
  }
});

/**
 * POST /cases/:id/accommodations/manual — Add manual accommodation (5A.5)
 * Requires: admin or manager role
 * Body: { name, description, source, costEstimate?, costRange?, implementationStatus?, implementationCost? }
 */
suggestions.post('/:id/accommodations/manual', acmdRequireAdminOrManager, async (c) => {
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

  const parsed = manualAccommodationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  // Sanitize text fields to prevent XSS
  const sanitizedInput = {
    ...parsed.data,
    name: sanitizeText(parsed.data.name),
    description: sanitizeText(parsed.data.description),
    costEstimate: parsed.data.costEstimate ? sanitizeText(parsed.data.costEstimate) : undefined,
  };

  try {
    const created = await addManualAccommodation(caseId, companyId, userId, sanitizedInput);

    if (!created) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json({ suggestion: created }, 201);
  } catch (err) {
    console.error('[Suggestions] Manual accommodation error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to add manual accommodation' }, 500);
  }
});

export { suggestions as suggestionRoutes };

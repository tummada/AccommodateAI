/**
 * Case CRUD API Routes for AccommodateAI.
 *
 * Endpoints:
 *   POST   /api/v1/cases           — Create case + AI classify + auto checklist + deadline + audit
 *   GET    /api/v1/cases           — List cases with filter + pagination
 *   GET    /api/v1/cases/:id       — Case detail with decrypted medical_info
 *   PATCH  /api/v1/cases/:id       — Update status/accommodation/denial + audit
 *   POST   /api/v1/cases/:id/classify — Re-run AI classification
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - POST/PATCH/classify require admin or manager role
 *   - GET allows all roles but scoped to company
 *   - Input validation with Zod
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  createCase,
  getCaseById,
  listCases,
  updateCase,
  reclassifyCase,
  reassignCase,
  writeAuditLog,
  createDiscussion,
  listDiscussions,
  closeCase,
} from '../services/caseService.js';
import {
  recordConsent,
  revokeConsent,
  manualClassify,
  addManualSuggestions,
} from '../services/consentService.js';
import {
  recordInterimAccommodation,
  getMedicalDocTemplate,
} from '../services/pwfaService.js';
import {
  getInterimAccommodation,
  patchInterimAccommodation,
} from '../services/interimService.js';
import { tryAutoTransition } from '../services/autoTransitionService.js';
import { checkPwfaPerSe } from '../services/approvalService.js';
import { getCaseTimeline } from '../services/timelineService.js';
import { filterMedicalFields, filterMedicalFieldsFromList } from '../middleware/medicalFilter.js';

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
// Zod Schemas
// ---------------------------------------------------------------------------

const createCaseSchema = z.object({
  employeeId: z.string().uuid('employeeId must be a valid UUID'),
  requestDescription: z
    .string()
    .min(10, 'requestDescription must be at least 10 characters')
    .max(5000, 'requestDescription must be at most 5000 characters'),
  medicalInfo: z.string().max(10000).optional().nullable(),
  type: z.enum(['ada', 'pwfa', 'state_law', 'multiple']).optional(),
});

const updateCaseSchema = z.object({
  status: z
    .enum([
      'intake',
      'interactive_process',
      'awaiting_medical',
      'awaiting_input',
      'review',
      'implementation',
      'active',
      'approved',
      'denied',
      'closed',
    ])
    .optional(),
  approvedAccommodation: z.string().max(5000).optional().nullable(),
  denialReason: z.string().max(5000).optional().nullable(),
  // PWFA leave-forcing safeguard fields
  leave_alternatives_confirmed: z.boolean().optional(),
  alternatives_documented: z.string().max(5000).optional(),
});

const listCasesQuerySchema = z.object({
  status: z.enum([
    'intake',
    'interactive_process',
    'awaiting_medical',
    'awaiting_input',
    'review',
    'implementation',
    'active',
    'approved',
    'denied',
    'closed',
  ]).optional(),
  type: z.enum(['ada', 'pwfa', 'state_law', 'multiple']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const medicalDocsSchema = z.object({
  filename: z.string().min(1, 'filename is required').max(255),
  fileType: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const timelineQuerySchema = z.object({
  eventType: z.string().optional(), // comma-separated event types
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Consent Zod Schemas
// ---------------------------------------------------------------------------

const consentSchema = z.object({
  consentGiven: z.boolean(),
  consentMethod: z.enum(['web_form', 'paper_form', 'verbal_recorded', 'email']),
});

const manualClassifySchema = z.object({
  type: z.enum(['ada', 'pwfa', 'state_law', 'multiple']),
  reason: z.string().min(10, 'reason must be at least 10 characters').max(2000),
});

const manualSuggestionItemSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  description: z.string().max(2000).optional(),
  costEstimate: z.string().max(100).optional(),
  costRange: z.enum(['no_cost', 'low', 'moderate', 'high']).optional(),
  effectiveness: z.enum(['high', 'medium', 'low']).optional(),
});

const manualSuggestionsSchema = z.object({
  suggestions: z.array(manualSuggestionItemSchema).min(1, 'At least one suggestion is required').max(10),
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const acmdRequireAdminOrManager = requireRole('super_admin', 'hr', 'manager');
const acmdRequireAdminOrHr = requireRole('super_admin', 'hr');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const cases = new Hono<AuthEnv>();

// All case routes require authentication + completed onboarding.
// `requireOnboarded` (RS-013 / Q-001) rejects pre-onboarding users with
// 403 `onboarding_required` — never lets an empty companyId reach a PG UUID
// cast and blow up as 500.
cases.use('*', acmdTenantGuard, requireOnboarded);

/**
 * POST /cases — Create a new accommodation case
 * Requires: admin or manager role
 * Body: { employeeId, requestDescription, medicalInfo?, type? }
 */
cases.post('/', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = createCaseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  const role = c.get('role') as 'super_admin' | 'hr' | 'manager';

  try {
    const result = await createCase(
      {
        companyId,
        employeeId: parsed.data.employeeId,
        requestDescription: parsed.data.requestDescription,
        medicalInfo: parsed.data.medicalInfo ?? null,
        type: parsed.data.type,
        actorRole: role,
      },
      userId,
    );
    return c.json({
      case: filterMedicalFields(role, result.case_),
      classification: result.classification,
      ai_fallback: result.aiFallback,
    }, 201);
  } catch (err) {
    console.error('[Cases] Create error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to create case' }, 500);
  }
});

/**
 * GET /cases — List cases with filtering and pagination
 * Requires: any authenticated role (scoped to company)
 * Query: ?status=open&type=ada&dateFrom=...&dateTo=...&limit=20&offset=0
 */
cases.get('/', async (c) => {
  const companyId = c.get('companyId');
  const role = c.get('role') as string;

  const query = c.req.query();
  const parsed = listCasesQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid query parameters',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await listCases({
      companyId,
      status: parsed.data.status,
      type: parsed.data.type,
      dateFrom: parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
      dateTo: parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      role,
    });

    return c.json({
      cases: filterMedicalFieldsFromList(role, result.cases),
      total: result.total,
      limit: parsed.data.limit ?? 20,
      offset: parsed.data.offset ?? 0,
    }, 200);
  } catch (err) {
    console.error('[Cases] List error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list cases' }, 500);
  }
});

/**
 * GET /cases/:id/timeline — Get case timeline (audit log history)
 * Requires: any authenticated role (visibility filtered by role)
 * Query: ?eventType=case_created,case_updated&limit=50&offset=0
 */
cases.get('/:id/timeline', async (c) => {
  const companyId = c.get('companyId');
  const role = c.get('role') as string;
  const caseId = c.req.param('id');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  const query = c.req.query();
  const parsed = timelineQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid query parameters',
      issues: parsed.error.issues,
    }, 400);
  }

  // Parse comma-separated event types
  const eventTypes = parsed.data.eventType
    ? parsed.data.eventType.split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;

  try {
    const result = await getCaseTimeline({
      caseId,
      companyId,
      role,
      eventTypes,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    if (!result) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json(result, 200);
  } catch (err) {
    console.error('[Cases] Timeline error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get timeline' }, 500);
  }
});

/**
 * GET /cases/:id — Get case detail with decrypted medical_info
 * Requires: any authenticated role (scoped to company)
 */
cases.get('/:id', async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId') as string;
  const role = c.get('role') as string;
  const caseId = c.req.param('id');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const case_ = await getCaseById(caseId, companyId);
    if (!case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    // Audit log: hr/super_admin accessing medical data (only when medicalInfo is present)
    if ((role === 'hr' || role === 'super_admin') && case_.medicalInfo) {
      // Non-blocking audit log — do not await to avoid delaying response
      writeAuditLog({
        companyId,
        caseId,
        action: 'medical_info_accessed',
        actorId: userId,
        metadata: { accessedFields: ['medicalInfo'] },
      }).catch((err) => {
        console.error('[Cases] Medical access audit log error:', err instanceof Error ? err.message : 'Unknown');
      });
    }

    return c.json({ case: filterMedicalFields(role, case_) }, 200);
  } catch (err) {
    console.error('[Cases] Get error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get case' }, 500);
  }
});

/**
 * PATCH /cases/:id — Update case status/accommodation/denial
 * Requires: admin or manager role
 * Body: { status?, approvedAccommodation?, denialReason? }
 */
cases.patch('/:id', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = updateCaseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  // At least one field must be provided
  const { status, approvedAccommodation, denialReason } = parsed.data;
  if (status === undefined && approvedAccommodation === undefined && denialReason === undefined) {
    return c.json({ error: 'At least one field (status, approvedAccommodation, denialReason) is required' }, 400);
  }

  try {
    const updated = await updateCase(caseId, companyId, userId, parsed.data);
    if (!updated) {
      return c.json({ error: 'Case not found' }, 404);
    }

    const role = c.get('role') as string;
    return c.json({ case: filterMedicalFields(role, updated) }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    // Status transition validation errors are returned as 400
    if (message.startsWith('Invalid status transition') || message.startsWith('Status is already') || message.startsWith('Cannot set status to denied') || message.startsWith('PWFA leave-forcing blocked')) {
      return c.json({ error: message }, 400);
    }
    console.error('[Cases] Update error:', message);
    return c.json({ error: 'Failed to update case' }, 500);
  }
});

/**
 * POST /cases/:id/classify — Re-run AI classification
 * Requires: admin or manager role
 */
cases.post('/:id/classify', acmdRequireAdminOrManager, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await reclassifyCase(caseId, companyId, userId);
    if (!result.case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, result.case_),
      classification: result.classification,
      ai_fallback: result.aiFallback,
    }, 200);
  } catch (err) {
    console.error('[Cases] Classify error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to classify case' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Assignment Zod Schema
// ---------------------------------------------------------------------------

const assignCaseSchema = z.object({
  assignedTo: z.string().uuid('assignedTo must be a valid UUID'),
});

/**
 * PUT /cases/:id/assign — Reassign a case to a different user
 * Requires: super_admin or hr role
 * Body: { assignedTo: "uuid" }
 * Response: { case: {...}, previousAssignee: "uuid|null" }
 */
cases.put('/:id/assign', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = assignCaseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await reassignCase({
      caseId,
      companyId,
      assignedTo: parsed.data.assignedTo,
      actorId: userId,
    });

    if (!result) {
      return c.json({ error: 'Case not found' }, 404);
    }

    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, result.case_),
      previousAssignee: result.previousAssignee,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (
      message === 'Assignee not found'
      || message === 'Assignee does not belong to this company'
      || message === 'Assignee must have super_admin or hr role'
    ) {
      return c.json({ error: message }, 400);
    }
    console.error('[Cases] Assign error:', message);
    return c.json({ error: 'Failed to assign case' }, 500);
  }
});

// ---------------------------------------------------------------------------
// AI CONSENT ENDPOINTS (Phase 4C)
// ---------------------------------------------------------------------------

/**
 * POST /cases/:id/ai-consent — Record AI consent decision
 * Requires: super_admin or hr role
 * Body: { consentGiven: boolean, consentMethod: string }
 */
cases.post('/:id/ai-consent', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = consentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const updated = await recordConsent({
      caseId,
      companyId,
      consentGiven: parsed.data.consentGiven,
      consentMethod: parsed.data.consentMethod,
      actorId: userId,
    });

    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, updated),
      consent_recorded: true,
      consent_given: parsed.data.consentGiven,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: 'Case not found' }, 404);
    }
    console.error('[Cases] Consent error:', message);
    return c.json({ error: 'Failed to record consent' }, 500);
  }
});

/**
 * POST /cases/:id/ai-consent-revoke — Revoke AI consent
 * Requires: super_admin or hr role
 * Existing AI results are preserved; new AI processing is blocked.
 */
cases.post('/:id/ai-consent-revoke', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const updated = await revokeConsent(caseId, companyId, userId);

    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, updated),
      consent_revoked: true,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: 'Case not found' }, 404);
    }
    console.error('[Cases] Consent revoke error:', message);
    return c.json({ error: 'Failed to revoke consent' }, 500);
  }
});

/**
 * POST /cases/:id/manual-classify — Manually classify without AI
 * Requires: super_admin or hr role
 * Body: { type: 'ada'|'pwfa'|'state_law'|'multiple', reason: string }
 */
cases.post('/:id/manual-classify', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = manualClassifySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const updated = await manualClassify({
      caseId,
      companyId,
      type: parsed.data.type,
      reason: parsed.data.reason,
      actorId: userId,
    });

    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, updated),
      classification_source: 'manual_hr',
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: 'Case not found' }, 404);
    }
    console.error('[Cases] Manual classify error:', message);
    return c.json({ error: 'Failed to classify case' }, 500);
  }
});

/**
 * POST /cases/:id/manual-suggestions — Add manual suggestions (no AI)
 * Requires: super_admin or hr role
 * Body: { suggestions: [{ name, description?, costEstimate?, costRange?, effectiveness? }] }
 */
cases.post('/:id/manual-suggestions', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = manualSuggestionsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const suggestions = await addManualSuggestions(
      caseId,
      companyId,
      parsed.data.suggestions,
      userId,
    );

    return c.json({
      suggestions,
      count: suggestions.length,
      source: 'manual_hr',
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: 'Case not found' }, 404);
    }
    console.error('[Cases] Manual suggestions error:', message);
    return c.json({ error: 'Failed to add suggestions' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PWFA SAFEGUARD ENDPOINTS (Phase 4E)
// ---------------------------------------------------------------------------

const interimAccommodationSchema = z.object({
  offered: z.boolean(),
  description: z.string().max(5000).optional().nullable(),
});

/**
 * POST /cases/:id/interim-accommodation — Record interim accommodation offer
 * Requires: super_admin or hr role
 * Body: { offered: boolean, description?: string }
 *
 * PWFA requires employers to provide interim accommodations while the
 * interactive process is ongoing. This endpoint tracks that compliance.
 */
cases.post('/:id/interim-accommodation', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = interimAccommodationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const updated = await recordInterimAccommodation(
      caseId,
      companyId,
      parsed.data.offered,
      parsed.data.description ?? null,
      userId,
    );

    if (!updated) {
      return c.json({ error: 'Case not found' }, 404);
    }

    // FIX-3: Apply medical field filtering to prevent data leakage
    const role = c.get('role') as string;
    return c.json({
      case: filterMedicalFields(role, updated),
      interim_recorded: true,
      offered: parsed.data.offered,
    }, 200);
  } catch (err) {
    console.error('[Cases] Interim accommodation error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to record interim accommodation' }, 500);
  }
});

const patchInterimSchema = z.object({
  action: z.enum(['end', 'convert', 'update_description']),
  description: z.string().max(5000).optional().nullable(),
  reason: z.string().max(2000).optional().nullable(),
});

/**
 * GET /cases/:id/interim-accommodation — Read current interim accommodation status
 * Requires: any authenticated role (scoped to company)
 *
 * Returns { hasInterim, interim } — derives status from audit log.
 */
cases.get('/:id/interim-accommodation', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await getInterimAccommodation(caseId, companyId);
    if (result === null) {
      return c.json({ error: 'Case not found' }, 404);
    }
    return c.json(result, 200);
  } catch (err) {
    console.error('[Cases] Get interim accommodation error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get interim accommodation' }, 500);
  }
});

/**
 * PATCH /cases/:id/interim-accommodation — Update interim accommodation
 * Requires: super_admin or hr role
 * Body: { action: 'end' | 'convert' | 'update_description', description?, reason? }
 *
 * Actions:
 *   end              — marks interim as ended (audit log tracks state)
 *   convert          — transitions case status implementation → active
 *   update_description — updates interimAccommodationDescription
 */
cases.patch('/:id/interim-accommodation', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = patchInterimSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    const result = await patchInterimAccommodation(
      caseId,
      companyId,
      {
        action: parsed.data.action,
        description: parsed.data.description ?? null,
        reason: parsed.data.reason ?? null,
      },
      userId,
    );

    if (result === null) {
      return c.json({ error: 'Case not found' }, 404);
    }

    return c.json(result, 200);
  } catch (err) {
    console.error('[Cases] Patch interim accommodation error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to update interim accommodation' }, 500);
  }
});

/**
 * POST /cases/:id/medical-docs — Upload medical document metadata
 * Requires: super_admin or hr role
 * Body: { filename, fileType?, notes? }
 *
 * Records medical document metadata (no actual file upload yet).
 * If the case is in 'awaiting_medical' status, auto-transitions
 * back to 'interactive_process'.
 */
cases.post('/:id/medical-docs', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = medicalDocsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    // Verify case belongs to company
    const case_ = await getCaseById(caseId, companyId);
    if (!case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    // Sanitize text fields to prevent XSS
    const sanitizedFilename = sanitizeText(parsed.data.filename);
    const sanitizedNotes = parsed.data.notes ? sanitizeText(parsed.data.notes) : null;

    // Record medical document metadata via audit log
    await writeAuditLog({
      companyId,
      caseId,
      action: 'medical_docs_received',
      actorId: userId,
      metadata: {
        event: 'medical_docs_received',
        filename: sanitizedFilename,
        fileType: parsed.data.fileType ?? null,
        notes: sanitizedNotes,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Auto-transition: awaiting_medical → interactive_process
    const transition = await tryAutoTransition(
      caseId,
      companyId,
      'medical_docs_received',
      userId,
      { filename: sanitizedFilename },
    );

    return c.json({
      success: true,
      document: {
        caseId,
        filename: sanitizedFilename,
        fileType: parsed.data.fileType ?? null,
        uploadedBy: userId,
        uploadedAt: new Date().toISOString(),
      },
      autoTransition: transition.transitioned
        ? { from: transition.fromStatus, to: transition.toStatus }
        : null,
    }, 201);
  } catch (err) {
    console.error('[Cases] Medical docs error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to upload medical document metadata' }, 500);
  }
});

/**
 * GET /cases/:id/medical-doc-template — Get appropriate medical doc template
 * Requires: any authenticated role
 *
 * Returns:
 *   - ADA cases: ADA_TEMPLATE (7 fields)
 *   - PWFA cases: PWFA_TEMPLATE (6 fields)
 *   - PWFA per se: required=false + reason (medical docs not needed)
 *   - PWFA case requesting ADA template: 400 error
 *
 * Query: ?force_ada=true — explicitly request ADA template (blocked for PWFA)
 */
cases.get('/:id/medical-doc-template', async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const case_ = await getCaseById(caseId, companyId);
    if (!case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    // Block ADA template for PWFA cases
    const forceAda = c.req.query('force_ada');
    if (forceAda === 'true' && case_.type === 'pwfa') {
      return c.json({
        error: 'ADA medical documentation template MUST NOT be used for PWFA cases. PWFA has different and lighter documentation requirements. Use the default PWFA template instead.',
      }, 400);
    }

    // Check per se status
    const perSeMatches = checkPwfaPerSe(case_.type, case_.requestDescription ?? '');

    const result = getMedicalDocTemplate(
      case_.type,
      case_.pwfaPerSe,
      perSeMatches,
    );

    return c.json({
      caseId: case_.id,
      caseType: case_.type,
      pwfaPerSe: case_.pwfaPerSe,
      perSeMatches,
      template: result.template,
      required: result.required,
      reason: result.reason,
      fieldCount: result.fieldCount,
    }, 200);
  } catch (err) {
    console.error('[Cases] Medical doc template error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get medical doc template' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DISCUSSIONS ENDPOINTS (Phase 6C — ACMD-137-A)
// ---------------------------------------------------------------------------

const createDiscussionSchema = z.object({
  discussionDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .refine(
      (val) => {
        const d = new Date(val + 'T00:00:00');
        return !isNaN(d.getTime()) && d <= new Date();
      },
      { message: 'Discussion date cannot be in the future' },
    ),
  method: z.enum(['in_person', 'video', 'phone', 'email', 'written']),
  participants: z.array(z.string().min(1).max(200)).min(1).max(20),
  summary: z.string().min(10).max(5000),
  employeePreference: z.string().max(2000).optional().nullable(),
});

/**
 * GET /cases/:id/discussions — List all discussions for a case
 * Requires: any authenticated role (scoped to company)
 * Response: { discussions: AcmdDiscussion[] }
 */
cases.get('/:id/discussions', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    // Verify the case exists for this company
    const case_ = await getCaseById(caseId, companyId);
    if (!case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    const discussions = await listDiscussions(caseId, companyId);
    return c.json({ discussions }, 200);
  } catch (err) {
    console.error('[Cases] List discussions error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to list discussions' }, 500);
  }
});

/**
 * POST /cases/:id/discussions — Create a new discussion record
 * Requires: super_admin or hr role
 * Body: { discussionDate, method, participants, summary, employeePreference? }
 * Response: 201 { discussion: AcmdDiscussion }
 */
cases.post('/:id/discussions', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = createDiscussionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      issues: parsed.error.issues,
    }, 400);
  }

  try {
    // Verify the case exists for this company
    const case_ = await getCaseById(caseId, companyId);
    if (!case_) {
      return c.json({ error: 'Case not found' }, 404);
    }

    // Sanitize text inputs (XSS defense)
    const sanitizedSummary = sanitizeText(parsed.data.summary);
    const sanitizedPreference = parsed.data.employeePreference
      ? sanitizeText(parsed.data.employeePreference)
      : null;
    const sanitizedParticipants = parsed.data.participants.map(sanitizeText);

    const discussion = await createDiscussion({
      caseId,
      companyId,
      recordedBy: userId,
      discussionDate: parsed.data.discussionDate,
      method: parsed.data.method,
      participants: sanitizedParticipants,
      summary: sanitizedSummary,
      employeePreference: sanitizedPreference,
    });

    return c.json({ discussion }, 201);
  } catch (err) {
    console.error('[Cases] Create discussion error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to create discussion' }, 500);
  }
});

// ---------------------------------------------------------------------------
// CASE CLOSE ENDPOINT (Phase 6C — ACMD-137-A)
// ---------------------------------------------------------------------------

/**
 * POST /cases/:id/close — Close a case
 * Requires: super_admin or hr role
 * No request body required.
 * Response: 200 { message: 'Case closed successfully' }
 * Errors:
 *   404 — case not found
 *   409 — already closed
 *   422 — stage incomplete (must be approved or denied first)
 */
cases.post('/:id/close', acmdRequireAdminOrHr, async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await closeCase({ caseId, companyId, closedBy: userId });

    if (!result.ok) {
      if (result.error === 'case_not_found') {
        return c.json({ error: 'Case not found' }, 404);
      }
      if (result.error === 'already_closed') {
        return c.json({ error: 'Case is already closed' }, 409);
      }
      if (result.error === 'stage_incomplete') {
        return c.json({ error: result.message ?? 'Case must be approved or denied before closing' }, 422);
      }
    }

    return c.json({ message: 'Case closed successfully' }, 200);
  } catch (err) {
    console.error('[Cases] Close case error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to close case' }, 500);
  }
});

export { cases as caseRoutes };

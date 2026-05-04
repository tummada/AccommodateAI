/**
 * Approval Chain API Routes for AccommodateAI — Phase 4B.
 *
 * Endpoints:
 *   GET  /api/v1/companies/:id/approval-settings   — Get approval settings (super_admin)
 *   PUT  /api/v1/companies/:id/approval-settings   — Update approval settings (super_admin)
 *   POST /api/v1/cases/:id/decision                — Create case decision (super_admin/hr)
 *   POST /api/v1/cases/:id/legal-review            — Mark legal review done (super_admin)
 *   POST /api/v1/cases/:id/fast-track-approve      — PWFA per se fast-track (super_admin/hr)
 *   POST /api/v1/cases/:id/manager-input-request   — Request manager input (super_admin/hr)
 *   PUT  /api/v1/cases/:id/manager-input           — Submit manager input (manager)
 *   GET  /api/v1/cases/:id/manager-input-status    — Check manager input request status (super_admin/hr)
 *   GET  /api/v1/cases/:id/manager-input-form      — Load manager input form data (manager)
 *
 * Security:
 *   - All endpoints require acmdTenantGuard (JWT)
 *   - Role enforcement via requireRole middleware
 *   - Medical info NEVER exposed to manager
 *   - All actions audit-logged
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { acmdTenantGuard, requireOnboarded } from '../middleware/auth.js';
import { requireRole } from '@acmd/auth';
import {
  getApprovalSettings,
  updateApprovalSettings,
  createCaseDecision,
  markLegalReviewed,
  fastTrackApprove,
  requestManagerInput,
  submitManagerInput,
  getCaseDecision,
  getManagerInputStatus,
  getManagerInputForm,
  supervisorApproveDenial,
  supervisorRejectDenial,
  supervisorRequestInfo,
  type DenialGateError,
} from '../services/approvalService.js';
import { tryAutoTransition } from '../services/autoTransitionService.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateApprovalSettingsSchema = z.object({
  requireManagerInput: z.boolean().optional(),
  requireLegalReviewForDenial: z.enum(['yes', 'no', 'recommend']).optional(),
  allowSelfApproval: z.boolean().optional(),
});

const alternativeSchema = z.object({
  description: z.string().min(20, 'Alternative description must be at least 20 characters'),
  reasonRejected: z.string().min(20, 'Rejection reason must be at least 20 characters'),
});

const denialDataSchema = z.object({
  costAnalysis: z.string().min(20, 'Cost analysis must be at least 20 characters'),
  financialResources: z.string().min(20, 'Financial resources must be at least 20 characters'),
  sizeAndType: z.string().min(20, 'Size and type must be at least 20 characters'),
  operationalImpact: z.string().min(20, 'Operational impact must be at least 20 characters'),
  alternativesConsidered: z.array(alternativeSchema).min(2, 'At least 2 alternatives must be considered'),
});

const createDecisionSchema = z.object({
  decisionType: z.enum(['approved', 'denied']),
  denialData: denialDataSchema.optional(),
}).refine(
  (data) => data.decisionType !== 'denied' || data.denialData !== undefined,
  { message: 'denialData is required when decisionType is "denied"', path: ['denialData'] },
);

const managerInputRequestSchema = z.object({
  managerId: z.string().uuid('managerId must be a valid UUID'),
});

const managerInputSchema = z.object({
  operationalImpact: z.string().min(10, 'Operational impact must be at least 10 characters').max(5000),
  canAccommodate: z.boolean(),
  suggestedAlternatives: z.string().max(5000).optional(),
  additionalNotes: z.string().max(5000).optional(),
});

// ---------------------------------------------------------------------------
// Routes: Company Approval Settings
// ---------------------------------------------------------------------------

const approvalSettingsRoutes = new Hono<AuthEnv>();
approvalSettingsRoutes.use('*', acmdTenantGuard, requireOnboarded);

/**
 * GET /companies/:id/approval-settings
 * Requires: super_admin
 */
approvalSettingsRoutes.get('/:id/approval-settings', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const paramId = c.req.param('id');

  // Company ID must match tenant context
  if (paramId !== companyId) {
    return c.json({ error: 'Company ID mismatch' }, 403);
  }

  try {
    const settings = await getApprovalSettings(companyId);
    return c.json({ settings }, 200);
  } catch (err) {
    console.error('[Approval] Get settings error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get approval settings' }, 500);
  }
});

/**
 * PUT /companies/:id/approval-settings
 * Requires: super_admin
 */
approvalSettingsRoutes.put('/:id/approval-settings', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const paramId = c.req.param('id');

  if (paramId !== companyId) {
    return c.json({ error: 'Company ID mismatch' }, 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = updateApprovalSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  // At least one field required
  const { requireManagerInput, requireLegalReviewForDenial, allowSelfApproval } = parsed.data;
  if (requireManagerInput === undefined && requireLegalReviewForDenial === undefined && allowSelfApproval === undefined) {
    return c.json({ error: 'At least one setting must be provided' }, 400);
  }

  try {
    const settings = await updateApprovalSettings(companyId, parsed.data, userId);
    return c.json({ settings }, 200);
  } catch (err) {
    console.error('[Approval] Update settings error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to update approval settings' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Routes: Case Decision + Legal Review + Fast-Track + Manager Input
// ---------------------------------------------------------------------------

const approvalCaseRoutes = new Hono<AuthEnv>();
approvalCaseRoutes.use('*', acmdTenantGuard, requireOnboarded);

/**
 * POST /cases/:id/decision — Create case decision
 * Requires: super_admin or hr role
 * Body: { decisionType: 'approved'|'denied', denialData?: {...} }
 */
approvalCaseRoutes.post('/:id/decision', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = createDecisionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  try {
    const decision = await createCaseDecision({
      caseId,
      companyId,
      decisionType: parsed.data.decisionType,
      denialData: parsed.data.denialData,
      actorId: userId,
    });
    return c.json({ decision }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    const denialErrors = (err as Error & { denialErrors?: DenialGateError[] }).denialErrors;

    if (message === 'Case not found') {
      return c.json({ error: message }, 404);
    }
    if (message === 'Denial gate validation failed' && denialErrors) {
      return c.json({ error: message, denialErrors }, 400);
    }
    if (message.includes('Denial requires')) {
      return c.json({ error: message }, 400);
    }
    if (message.includes('Self-approval is not allowed')) {
      return c.json({ error: message }, 403);
    }
    console.error('[Approval] Create decision error:', message);
    return c.json({ error: 'Failed to create case decision' }, 500);
  }
});

/**
 * GET /cases/:id/decision — Get case decision
 * Requires: super_admin or hr
 */
approvalCaseRoutes.get('/:id/decision', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const decision = await getCaseDecision(caseId, companyId);
    if (!decision) {
      return c.json({ error: 'No decision found for this case' }, 404);
    }
    return c.json({ decision }, 200);
  } catch (err) {
    console.error('[Approval] Get decision error:', err instanceof Error ? err.message : 'Unknown');
    return c.json({ error: 'Failed to get case decision' }, 500);
  }
});

/**
 * POST /cases/:id/legal-review — Mark legal review as done
 * Requires: super_admin only
 */
approvalCaseRoutes.post('/:id/legal-review', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const decision = await markLegalReviewed(caseId, companyId, userId);
    return c.json({ decision }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (
      message === 'No decision found for this case'
      || message === 'Legal review is not required for this decision'
      || message === 'Legal review has already been completed'
    ) {
      return c.json({ error: message }, 400);
    }
    console.error('[Approval] Legal review error:', message);
    return c.json({ error: 'Failed to mark legal review' }, 500);
  }
});

/**
 * POST /cases/:id/fast-track-approve — PWFA per se fast-track
 * Requires: super_admin or hr
 */
approvalCaseRoutes.post('/:id/fast-track-approve', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const decision = await fastTrackApprove(caseId, companyId, userId);
    return c.json({ decision }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (
      message === 'Case not found'
      || message.includes('only available for PWFA')
      || message.includes('does not qualify')
    ) {
      return c.json({ error: message }, 400);
    }
    console.error('[Approval] Fast-track error:', message);
    return c.json({ error: 'Failed to fast-track approve' }, 500);
  }
});

/**
 * POST /cases/:id/manager-input-request — Request manager input
 * Requires: super_admin or hr
 */
approvalCaseRoutes.post('/:id/manager-input-request', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = managerInputRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  try {
    await requestManagerInput(caseId, companyId, parsed.data.managerId, userId);
    return c.json({ success: true, message: 'Manager input request sent' }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (
      message === 'Case not found'
      || message === 'Manager not found'
      || message === 'Target user must have manager role'
    ) {
      console.error('[Approval] Manager input request validation:', message);
      return c.json({ error: 'Invalid request. Please check the case and manager selection.' }, 400);
    }
    console.error('[Approval] Manager input request error:', message);
    return c.json({ error: 'Failed to request manager input' }, 500);
  }
});

/**
 * PUT /cases/:id/manager-input — Submit manager input
 * Requires: manager role only
 */
approvalCaseRoutes.put('/:id/manager-input', requireRole('manager'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = managerInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  try {
    await submitManagerInput(caseId, companyId, parsed.data, userId);

    // Phase 5B: Auto-transition from awaiting_input → interactive_process
    const transition = await tryAutoTransition(
      caseId,
      companyId,
      'manager_input_received',
      userId,
    );

    return c.json({
      success: true,
      message: 'Manager input submitted',
      autoTransition: transition.transitioned
        ? { from: transition.fromStatus, to: transition.toStatus }
        : null,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (
      message === 'Case not found'
      || message === 'Case is not currently awaiting manager input'
    ) {
      return c.json({ error: message }, 400);
    }
    console.error('[Approval] Manager input error:', message);
    return c.json({ error: 'Failed to submit manager input' }, 500);
  }
});

/**
 * GET /cases/:id/manager-input-status — Check current manager input request status
 * Requires: super_admin or hr role
 */
approvalCaseRoutes.get('/:id/manager-input-status', requireRole('super_admin', 'hr'), async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await getManagerInputStatus(caseId, companyId);
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: message }, 404);
    }
    console.error('[Approval] Manager input status error:', message);
    return c.json({ error: 'Failed to get manager input status' }, 500);
  }
});

/**
 * GET /cases/:id/manager-input-form — Load manager input form data
 * Requires: manager role only
 * CRITICAL: Response NEVER includes medicalInfo, denialReason, or any EEOC analysis
 */
approvalCaseRoutes.get('/:id/manager-input-form', requireRole('manager'), async (c) => {
  const companyId = c.get('companyId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const result = await getManagerInputForm(caseId, companyId);
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Case not found') {
      return c.json({ error: message }, 404);
    }
    console.error('[Approval] Manager input form error:', message);
    return c.json({ error: 'Failed to get manager input form' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Supervisor Review Routes (Phase 7C)
// ---------------------------------------------------------------------------

const supervisorRejectSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(5000),
});

const supervisorRequestInfoSchema = z.object({
  questions: z.string().min(10, 'Questions must be at least 10 characters').max(5000),
});

/**
 * POST /cases/:id/decision/supervisor-approve — Supervisor approves a pending denial
 * Requires: super_admin only
 */
approvalCaseRoutes.post('/:id/decision/supervisor-approve', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  try {
    const decision = await supervisorApproveDenial(caseId, companyId, userId);
    return c.json({ decision }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Decision not found' || message === 'No pending denial for supervisor review') {
      return c.json({ error: message }, 400);
    }
    if (message === 'Supervisor action already taken') {
      return c.json({ error: message }, 409);
    }
    console.error('[Approval] Supervisor approve error:', message);
    return c.json({ error: 'Failed to approve denial' }, 500);
  }
});

/**
 * POST /cases/:id/decision/supervisor-reject — Supervisor rejects a pending denial
 * Requires: super_admin only
 * Body: { reason: string (min 10) }
 */
approvalCaseRoutes.post('/:id/decision/supervisor-reject', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = supervisorRejectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  try {
    const decision = await supervisorRejectDenial(caseId, companyId, userId, parsed.data.reason);
    return c.json({ decision }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Decision not found' || message === 'No pending denial for supervisor review') {
      return c.json({ error: message }, 400);
    }
    if (message === 'Supervisor action already taken') {
      return c.json({ error: message }, 409);
    }
    console.error('[Approval] Supervisor reject error:', message);
    return c.json({ error: 'Failed to reject denial' }, 500);
  }
});

/**
 * POST /cases/:id/decision/supervisor-request-info — Supervisor requests additional info
 * Requires: super_admin only
 * Body: { questions: string (min 10) }
 */
approvalCaseRoutes.post('/:id/decision/supervisor-request-info', requireRole('super_admin'), async (c) => {
  const companyId = c.get('companyId');
  const userId = c.get('userId');
  const caseId = c.req.param('id');

  if (!UUID_REGEX.test(caseId)) {
    return c.json({ error: 'Invalid case ID format' }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = supervisorRequestInfoSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  try {
    const decision = await supervisorRequestInfo(caseId, companyId, userId, parsed.data.questions);
    return c.json({ decision }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    if (message === 'Decision not found' || message === 'No pending denial for supervisor review') {
      return c.json({ error: message }, 400);
    }
    if (message === 'Supervisor action already taken') {
      return c.json({ error: message }, 409);
    }
    console.error('[Approval] Supervisor request-info error:', message);
    return c.json({ error: 'Failed to request additional info' }, 500);
  }
});

export { approvalSettingsRoutes, approvalCaseRoutes };

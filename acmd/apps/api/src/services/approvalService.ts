/**
 * Approval Service for AccommodateAI — Phase 4B.
 *
 * Implements:
 *   - Denial Gate: STRICT validation of 4 undue hardship factors + 2 alternatives
 *   - Approval Settings: per-company workflow configuration
 *   - PWFA Per Se Fast-Track: auto-approve 4 predictable assessments
 *   - Legal Review: tracking + blocking for denials
 *   - Manager Input: request + submit with medical field filtering
 *
 * LEGAL NOTE: Every function that records a decision or modifies case state
 * writes to acmd_audit_logs. This audit trail may be used as evidence in
 * EEOC proceedings. Do not skip or truncate audit logging.
 */

import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdApprovalSettings,
  acmdCaseDecisions,
  acmdCases,
  acmdAuditLogs,
  acmdNotifications,
  acmdUsers,
  acmdEmployees,
  type AcmdApprovalSettings,
  type AcmdCaseDecision,
} from '@acmd/db';
import { writeAuditLog } from './caseService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags from free-text input before writing to audit log.
 * Preserves plain text content.
 */
function sanitizeText(input: string): string {
  return input.replace(/<\/?[^>]+(>|$)/g, '');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum character length for each denial factor description. */
const MIN_FACTOR_LENGTH = 20;

/** Minimum number of alternatives that must be considered before denial. */
const MIN_ALTERNATIVES = 2;

/** Minimum character length for each alternative description/reason. */
const MIN_ALT_DESC_LENGTH = 20;

/**
 * PWFA "per se" keywords — 4 predictable assessments that the EEOC considers
 * virtually always reasonable. These should be fast-tracked for approval.
 *
 * Reference: 29 CFR 1636.3(j)(4) — PWFA final rule.
 */
const PWFA_PER_SE_KEYWORDS: readonly string[] = [
  'water',
  'bathroom',
  'sit/stand',
  'eat',
] as const;

/**
 * Expanded keyword patterns for fuzzy matching of PWFA per se accommodations.
 */
const PWFA_PER_SE_PATTERNS: readonly RegExp[] = [
  /\b(water|drink|hydrat|beverage)\b/i,
  /\b(bathroom|restroom|toilet|break)\b/i,
  /\b(sit|stand|seating|chair|stool|position)\b/i,
  /\b(eat|food|meal|snack|nourish)\b/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DenialGateInput {
  costAnalysis: string;
  financialResources: string;
  sizeAndType: string;
  operationalImpact: string;
  alternativesConsidered: Array<{ description: string; reasonRejected: string }>;
}

export interface DenialGateError {
  field: string;
  message: string;
}

export interface DenialGateResult {
  valid: boolean;
  errors: DenialGateError[];
}

export interface CreateDecisionInput {
  caseId: string;
  companyId: string;
  decisionType: 'approved' | 'denied';
  denialData?: DenialGateInput;
  actorId: string;
}

export interface ManagerInputData {
  operationalImpact: string;
  canAccommodate: boolean;
  suggestedAlternatives?: string;
  additionalNotes?: string;
}

// ---------------------------------------------------------------------------
// Denial Gate — STRICT validation (returns 400, not warning)
// ---------------------------------------------------------------------------

/**
 * Validate denial data against the 4-factor undue hardship analysis.
 *
 * ADA 42 U.S.C. § 12111(10) requires employers to demonstrate:
 *   1. Cost analysis (nature + net cost)
 *   2. Financial resources of the facility/entity
 *   3. Size and type of operation
 *   4. Operational impact
 *
 * Additionally, at least 2 alternative accommodations must have been
 * considered and rejected with documented reasons.
 *
 * @returns DenialGateResult with valid=false + detailed errors if invalid
 */
export function validateDenialGate(data: DenialGateInput): DenialGateResult {
  const errors: DenialGateError[] = [];

  // Factor 1: Cost analysis
  if (!data.costAnalysis || data.costAnalysis.trim().length < MIN_FACTOR_LENGTH) {
    errors.push({
      field: 'costAnalysis',
      message: `Cost analysis is required and must be at least ${MIN_FACTOR_LENGTH} characters. Must describe the nature and net cost of the accommodation.`,
    });
  }

  // Factor 2: Financial resources
  if (!data.financialResources || data.financialResources.trim().length < MIN_FACTOR_LENGTH) {
    errors.push({
      field: 'financialResources',
      message: `Financial resources description is required and must be at least ${MIN_FACTOR_LENGTH} characters. Must describe the financial resources of the facility/entity.`,
    });
  }

  // Factor 3: Size and type
  if (!data.sizeAndType || data.sizeAndType.trim().length < MIN_FACTOR_LENGTH) {
    errors.push({
      field: 'sizeAndType',
      message: `Size and type description is required and must be at least ${MIN_FACTOR_LENGTH} characters. Must describe the size, type, and structure of the operation.`,
    });
  }

  // Factor 4: Operational impact
  if (!data.operationalImpact || data.operationalImpact.trim().length < MIN_FACTOR_LENGTH) {
    errors.push({
      field: 'operationalImpact',
      message: `Operational impact description is required and must be at least ${MIN_FACTOR_LENGTH} characters. Must describe the impact on operations.`,
    });
  }

  // Alternatives considered — at least 2 required
  if (!data.alternativesConsidered || !Array.isArray(data.alternativesConsidered)) {
    errors.push({
      field: 'alternativesConsidered',
      message: `At least ${MIN_ALTERNATIVES} alternative accommodations must be considered before denial. Provide an array of alternatives.`,
    });
  } else if (data.alternativesConsidered.length < MIN_ALTERNATIVES) {
    errors.push({
      field: 'alternativesConsidered',
      message: `At least ${MIN_ALTERNATIVES} alternative accommodations must be considered. Only ${data.alternativesConsidered.length} provided.`,
    });
  } else {
    // Validate each alternative
    for (let i = 0; i < data.alternativesConsidered.length; i++) {
      const alt = data.alternativesConsidered[i]!;
      if (!alt.description || alt.description.trim().length < MIN_ALT_DESC_LENGTH) {
        errors.push({
          field: `alternativesConsidered[${i}].description`,
          message: `Alternative #${i + 1} description must be at least ${MIN_ALT_DESC_LENGTH} characters.`,
        });
      }
      if (!alt.reasonRejected || alt.reasonRejected.trim().length < MIN_ALT_DESC_LENGTH) {
        errors.push({
          field: `alternativesConsidered[${i}].reasonRejected`,
          message: `Alternative #${i + 1} rejection reason must be at least ${MIN_ALT_DESC_LENGTH} characters.`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// PWFA Per Se Detection
// ---------------------------------------------------------------------------

/**
 * Check if a case qualifies for PWFA "per se" fast-track approval.
 *
 * Per se accommodations under PWFA are virtually always reasonable and
 * should be granted without requiring undue hardship analysis:
 *   1. Water/hydration access
 *   2. Bathroom break access
 *   3. Ability to sit or stand as needed
 *   4. Eating/food access during work
 *
 * @param caseType — must be 'pwfa' to qualify
 * @param requestDescription — free-text description to scan for keywords
 * @returns Array of matched per se categories (empty = no match)
 */
export function checkPwfaPerSe(
  caseType: string,
  requestDescription: string,
): string[] {
  if (caseType !== 'pwfa') return [];
  if (!requestDescription) return [];

  const matched: string[] = [];
  for (let i = 0; i < PWFA_PER_SE_PATTERNS.length; i++) {
    if (PWFA_PER_SE_PATTERNS[i]!.test(requestDescription)) {
      matched.push(PWFA_PER_SE_KEYWORDS[i]!);
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Approval Settings CRUD
// ---------------------------------------------------------------------------

/**
 * Get approval settings for a company. Returns defaults if not configured.
 */
export async function getApprovalSettings(
  companyId: string,
): Promise<AcmdApprovalSettings> {
  const [existing] = await db
    .select()
    .from(acmdApprovalSettings)
    .where(eq(acmdApprovalSettings.companyId, companyId))
    .limit(1);

  if (existing) return existing;

  // Return virtual defaults (not persisted until explicitly set)
  return {
    id: '',
    companyId,
    requireManagerInput: true,
    requireLegalReviewForDenial: 'recommend',
    allowSelfApproval: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Update approval settings for a company (upsert pattern).
 * Only super_admin should call this — role check at route layer.
 */
export async function updateApprovalSettings(
  companyId: string,
  settings: {
    requireManagerInput?: boolean;
    requireLegalReviewForDenial?: 'yes' | 'no' | 'recommend';
    allowSelfApproval?: boolean;
  },
  actorId: string,
): Promise<AcmdApprovalSettings> {
  const now = new Date();

  // FIX-6: Use INSERT ... ON CONFLICT to avoid race condition
  const [result] = await db
    .insert(acmdApprovalSettings)
    .values({
      companyId,
      requireManagerInput: settings.requireManagerInput ?? true,
      requireLegalReviewForDenial: settings.requireLegalReviewForDenial ?? 'recommend',
      allowSelfApproval: settings.allowSelfApproval ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: acmdApprovalSettings.companyId,
      set: {
        ...(settings.requireManagerInput !== undefined
          ? { requireManagerInput: settings.requireManagerInput }
          : {}),
        ...(settings.requireLegalReviewForDenial !== undefined
          ? { requireLegalReviewForDenial: settings.requireLegalReviewForDenial }
          : {}),
        ...(settings.allowSelfApproval !== undefined
          ? { allowSelfApproval: settings.allowSelfApproval }
          : {}),
        updatedAt: now,
      },
    })
    .returning() as [AcmdApprovalSettings];

  // Audit log
  await writeAuditLog({
    companyId,
    // caseId omitted — company-level event, no case FK
    action: 'approval_settings_updated',
    actorId,
    metadata: { settings },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Case Decision — Create (with denial gate enforcement)
// ---------------------------------------------------------------------------

/**
 * Create a case decision (approval or denial).
 *
 * For denials:
 *   - Runs denial gate validation (BLOCKS with error if invalid)
 *   - Checks legal review policy and sets legalReviewRequired accordingly
 *
 * For approvals:
 *   - No denial gate needed
 *   - Records decision directly
 *
 * @throws Error with descriptive message if case not found or denial gate fails
 */
export async function createCaseDecision(
  input: CreateDecisionInput,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  // Verify case exists and belongs to company
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, input.caseId), eq(acmdCases.companyId, input.companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  let legalReviewRequired = false;

  // FIX-4: Enforce allowSelfApproval setting
  const approvalSettings = await getApprovalSettings(input.companyId);
  if (input.actorId === caseRow.assignedTo && !approvalSettings.allowSelfApproval) {
    throw new Error('Self-approval is not allowed. The decision maker cannot be the same person assigned to the case.');
  }

  if (input.decisionType === 'denied') {
    // DENIAL GATE: validate all 4 factors + alternatives
    if (!input.denialData) {
      throw new Error('Denial requires undue hardship analysis data (costAnalysis, financialResources, sizeAndType, operationalImpact, alternativesConsidered)');
    }

    const gateResult = validateDenialGate(input.denialData);
    if (!gateResult.valid) {
      const errorObj = new Error('Denial gate validation failed');
      (errorObj as Error & { denialErrors: DenialGateError[] }).denialErrors = gateResult.errors;
      throw errorObj;
    }

    // Determine legal review requirement
    if (approvalSettings.requireLegalReviewForDenial === 'yes') {
      legalReviewRequired = true;
    } else if (approvalSettings.requireLegalReviewForDenial === 'recommend') {
      legalReviewRequired = true; // Default to required for safety
    }
    // 'no' → legalReviewRequired stays false
  }

  // Insert decision record + update case status (FIX-1)
  const [decision] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(acmdCaseDecisions)
      .values({
        caseId: input.caseId,
        companyId: input.companyId,
        decisionType: input.decisionType,
        costAnalysis: input.denialData?.costAnalysis ?? null,
        financialResources: input.denialData?.financialResources ?? null,
        sizeAndType: input.denialData?.sizeAndType ?? null,
        operationalImpact: input.denialData?.operationalImpact ?? null,
        alternativesConsidered: input.denialData?.alternativesConsidered ?? null,
        legalReviewRequired,
        legalReviewed: false,
        decidedBy: input.actorId,
        decidedAt: now,
        ...(input.decisionType === 'denied' ? { supervisorStatus: 'pending_review' as const } : {}),
      })
      .returning();

    // Audit log: denial gate validated (for denials)
    if (input.decisionType === 'denied') {
      await writeAuditLog({
        companyId: input.companyId,
        caseId: input.caseId,
        action: 'denial_gate_validated',
        actorId: input.actorId,
        metadata: {
          decisionId: inserted!.id,
          factorsProvided: {
            costAnalysis: !!input.denialData?.costAnalysis,
            financialResources: !!input.denialData?.financialResources,
            sizeAndType: !!input.denialData?.sizeAndType,
            operationalImpact: !!input.denialData?.operationalImpact,
          },
          alternativesCount: input.denialData?.alternativesConsidered?.length ?? 0,
          legalReviewRequired,
        },
      }, tx);

      // Audit log: accommodation denied
      await writeAuditLog({
        companyId: input.companyId,
        caseId: input.caseId,
        action: 'accommodation_denied',
        actorId: input.actorId,
        metadata: {
          decisionId: inserted!.id,
          legalReviewRequired,
        },
      }, tx);
    } else {
      // Audit log: accommodation approved
      await writeAuditLog({
        companyId: input.companyId,
        caseId: input.caseId,
        action: 'accommodation_approved',
        actorId: input.actorId,
        metadata: {
          decisionId: inserted!.id,
        },
      }, tx);
    }

    // FIX-1: Update case status to match decision type within the SAME transaction
    await tx
      .update(acmdCases)
      .set({
        status: input.decisionType,
        updatedAt: now,
      })
      .where(eq(acmdCases.id, input.caseId));

    return [inserted];
  });

  return decision as AcmdCaseDecision;
}

// ---------------------------------------------------------------------------
// Legal Review
// ---------------------------------------------------------------------------

/**
 * Mark a case decision's legal review as completed.
 * Only super_admin can perform legal review.
 *
 * @throws Error if no decision found or decision has no legal review required
 */
export async function markLegalReviewed(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  // FIX-7: Find the most recent decision with ORDER BY decidedAt DESC
  const [decision] = await db
    .select()
    .from(acmdCaseDecisions)
    .where(and(
      eq(acmdCaseDecisions.caseId, caseId),
      eq(acmdCaseDecisions.companyId, companyId),
    ))
    .orderBy(desc(acmdCaseDecisions.decidedAt))
    .limit(1);

  if (!decision) {
    throw new Error('No decision found for this case');
  }

  if (!decision.legalReviewRequired) {
    throw new Error('Legal review is not required for this decision');
  }

  if (decision.legalReviewed) {
    throw new Error('Legal review has already been completed');
  }

  const [updated] = await db
    .update(acmdCaseDecisions)
    .set({
      legalReviewed: true,
      legalReviewedBy: actorId,
      legalReviewedAt: now,
    })
    .where(eq(acmdCaseDecisions.id, decision.id))
    .returning();

  // Audit log
  await writeAuditLog({
    companyId,
    caseId,
    action: 'legal_review_completed',
    actorId,
    metadata: {
      decisionId: decision.id,
      decisionType: decision.decisionType,
    },
  });

  return updated as AcmdCaseDecision;
}

// ---------------------------------------------------------------------------
// PWFA Per Se Fast-Track Approval
// ---------------------------------------------------------------------------

/**
 * Fast-track approve a PWFA per se case.
 *
 * Conditions:
 *   - Case must be type 'pwfa'
 *   - Case must have pwfaPerSe = true OR match per se keywords
 *   - Creates an 'approved' decision record without undue hardship analysis
 *
 * @throws Error if case is not PWFA or does not qualify for per se
 */
export async function fastTrackApprove(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  // Fetch case
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  if (caseRow.type !== 'pwfa') {
    throw new Error('Fast-track approval is only available for PWFA cases');
  }

  // Check per se flag or keyword match
  const perSeMatches = checkPwfaPerSe(caseRow.type, caseRow.requestDescription ?? '');
  if (!caseRow.pwfaPerSe && perSeMatches.length === 0) {
    throw new Error('Case does not qualify for PWFA per se fast-track. Request does not match predictable assessment categories (water, bathroom, sit/stand, eat).');
  }

  // Create approved decision + update case status
  const [decision] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(acmdCaseDecisions)
      .values({
        caseId,
        companyId,
        decisionType: 'approved',
        legalReviewRequired: false,
        legalReviewed: false,
        decidedBy: actorId,
        decidedAt: now,
      })
      .returning();

    // Update case status to approved + set pwfaPerSe flag
    await tx
      .update(acmdCases)
      .set({
        status: 'approved',
        pwfaPerSe: true,
        updatedAt: now,
      })
      .where(eq(acmdCases.id, caseId));

    // Audit log
    await writeAuditLog({
      companyId,
      caseId,
      action: 'pwfa_fast_track_approved',
      actorId,
      metadata: {
        decisionId: inserted!.id,
        perSeMatches,
        pwfaPerSeFlag: caseRow.pwfaPerSe,
      },
    }, tx);

    return [inserted];
  });

  return decision as AcmdCaseDecision;
}

// ---------------------------------------------------------------------------
// Manager Input
// ---------------------------------------------------------------------------

/**
 * Request operational input from a manager for a case.
 * Creates a notification for the manager.
 *
 * @throws Error if case not found or manager not found
 */
export async function requestManagerInput(
  caseId: string,
  companyId: string,
  managerId: string,
  actorId: string,
): Promise<void> {
  // Verify case exists
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  // Verify manager exists and has manager role
  const [manager] = await db
    .select()
    .from(acmdUsers)
    .where(and(eq(acmdUsers.id, managerId), eq(acmdUsers.companyId, companyId)))
    .limit(1);

  if (!manager) {
    throw new Error('Manager not found');
  }

  if (manager.role !== 'manager') {
    throw new Error('Target user must have manager role');
  }

  // Update case status to awaiting_input
  await db
    .update(acmdCases)
    .set({ status: 'awaiting_input', updatedAt: new Date() })
    .where(eq(acmdCases.id, caseId));

  // Create notification for manager — NO medical info
  await db.insert(acmdNotifications).values({
    companyId,
    userId: managerId,
    type: 'case_status_changed',
    title: 'Manager input requested',
    body: `Your operational input is needed for accommodation case ${caseId.slice(0, 8)}. Please provide details about operational impact and feasibility.`,
    caseId,
  });

  // Audit log
  await writeAuditLog({
    companyId,
    caseId,
    action: 'manager_input_requested',
    actorId,
    metadata: {
      managerId,
      managerName: manager.name,
    },
  });
}

/**
 * Submit manager's operational input for a case.
 * Medical fields are NOT included — manager only sees operational info.
 *
 * @throws Error if case not found or not in awaiting_input status
 */
export async function submitManagerInput(
  caseId: string,
  companyId: string,
  inputData: ManagerInputData,
  actorId: string,
): Promise<void> {
  // Verify case exists and is awaiting input
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  if (caseRow.status !== 'awaiting_input') {
    throw new Error('Case is not currently awaiting manager input');
  }

  // NOTE: Status transition to 'interactive_process' is handled by
  // autoTransitionService.tryAutoTransition() at the route layer (Phase 5B).
  // This keeps the transition atomic with audit log + notification.

  // Audit log — store operational input (NO medical info)
  await writeAuditLog({
    companyId,
    caseId,
    action: 'manager_input_received',
    actorId,
    metadata: {
      operationalImpact: inputData.operationalImpact,
      canAccommodate: inputData.canAccommodate,
      suggestedAlternatives: inputData.suggestedAlternatives ?? null,
      additionalNotes: inputData.additionalNotes ?? null,
    },
  });

  // Notify HR/super_admin that manager input was received
  await db.insert(acmdNotifications).values({
    companyId,
    userId: caseRow.assignedTo ?? actorId,
    type: 'case_status_changed',
    title: 'Manager input received',
    body: `Manager has submitted operational input for case ${caseId.slice(0, 8)}. Case moved to interactive process.`,
    caseId,
  });
}

// ---------------------------------------------------------------------------
// Get decision for a case
// ---------------------------------------------------------------------------

/**
 * Get the most recent decision for a case.
 */
export async function getCaseDecision(
  caseId: string,
  companyId: string,
): Promise<AcmdCaseDecision | null> {
  // FIX-7: Add ORDER BY decidedAt DESC to get the most recent decision
  const [decision] = await db
    .select()
    .from(acmdCaseDecisions)
    .where(and(
      eq(acmdCaseDecisions.caseId, caseId),
      eq(acmdCaseDecisions.companyId, companyId),
    ))
    .orderBy(desc(acmdCaseDecisions.decidedAt))
    .limit(1);

  return (decision as AcmdCaseDecision) ?? null;
}

// ---------------------------------------------------------------------------
// Manager Input GET — Status + Form
// ---------------------------------------------------------------------------

export interface ManagerInputStatusResult {
  status: 'not_requested' | 'pending' | 'submitted';
  requestedAt: string | null;
  managerId: string | null;
  managerName: string | null;
  submittedAt: string | null;
  inputSummary: { canAccommodate: boolean; operationalImpact: string } | null;
}

export interface ManagerInputFormResult {
  caseId: string;
  employeeName: string;
  department: string;
  positionTitle: string;
  accommodationCategory: string;
  hrRequesterName: string;
  responseDeadline: string | null;
  daysRemaining: number | null;
  alreadySubmitted: boolean;
  submittedAt: string | null;
  mode: 'form' | 'acknowledgment';
  outcomeType: 'approved' | 'denied' | null;
}

/**
 * Get the current status of a manager input request for a case.
 * For HR/admin use — does NOT expose medical info.
 *
 * Status logic:
 *   - 'not_requested': case is not awaiting_input and no manager_input_received log
 *   - 'pending': case status is awaiting_input (request sent, not yet submitted)
 *   - 'submitted': manager_input_received audit log exists
 */
export async function getManagerInputStatus(
  caseId: string,
  companyId: string,
): Promise<ManagerInputStatusResult> {
  // Load case (scoped to company) — explicit projection excludes medicalInfo
  const [caseRow] = await db
    .select({
      id: acmdCases.id,
      status: acmdCases.status,
      assignedTo: acmdCases.assignedTo,
      companyId: acmdCases.companyId,
    })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  // Find manager_input_received audit log
  const [receivedLog] = await db
    .select()
    .from(acmdAuditLogs)
    .where(and(
      eq(acmdAuditLogs.caseId, caseId),
      eq(acmdAuditLogs.companyId, companyId),
      eq(acmdAuditLogs.action, 'manager_input_received'),
    ))
    .orderBy(desc(acmdAuditLogs.createdAt))
    .limit(1);

  if (receivedLog) {
    // Submitted — get manager info from the actorId on that log
    const managerId = receivedLog.actorId ?? null;
    let managerName: string | null = null;

    if (managerId) {
      const [manager] = await db
        .select({ name: acmdUsers.name })
        .from(acmdUsers)
        .where(and(eq(acmdUsers.id, managerId), eq(acmdUsers.companyId, companyId)))
        .limit(1);
      managerName = manager?.name ?? null;
    }

    // Find request log for requestedAt timestamp
    const [requestedLog] = await db
      .select()
      .from(acmdAuditLogs)
      .where(and(
        eq(acmdAuditLogs.caseId, caseId),
        eq(acmdAuditLogs.companyId, companyId),
        eq(acmdAuditLogs.action, 'manager_input_requested'),
      ))
      .orderBy(desc(acmdAuditLogs.createdAt))
      .limit(1);

    const meta = receivedLog.metadata as Record<string, unknown> | null;
    return {
      status: 'submitted',
      requestedAt: requestedLog?.createdAt?.toISOString() ?? null,
      managerId,
      managerName,
      submittedAt: receivedLog.createdAt.toISOString(),
      inputSummary: meta
        ? {
            canAccommodate: meta['canAccommodate'] as boolean,
            operationalImpact: meta['operationalImpact'] as string,
          }
        : null,
    };
  }

  if (caseRow.status === 'awaiting_input') {
    // Pending — find manager from manager_input_requested audit log
    const [requestedLog] = await db
      .select()
      .from(acmdAuditLogs)
      .where(and(
        eq(acmdAuditLogs.caseId, caseId),
        eq(acmdAuditLogs.companyId, companyId),
        eq(acmdAuditLogs.action, 'manager_input_requested'),
      ))
      .orderBy(desc(acmdAuditLogs.createdAt))
      .limit(1);

    const meta = requestedLog?.metadata as Record<string, unknown> | null;
    const managerId = (meta?.['managerId'] as string) ?? null;
    const managerName = (meta?.['managerName'] as string) ?? null;

    return {
      status: 'pending',
      requestedAt: requestedLog?.createdAt?.toISOString() ?? null,
      managerId,
      managerName,
      submittedAt: null,
      inputSummary: null,
    };
  }

  // Not requested
  return {
    status: 'not_requested',
    requestedAt: null,
    managerId: null,
    managerName: null,
    submittedAt: null,
    inputSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Supervisor Review (Phase 7C)
// ---------------------------------------------------------------------------

/**
 * Supervisor approves a pending denial decision.
 *
 * Conditions:
 *   - Decision must exist + decisionType === 'denied'
 *   - supervisor_status must be 'pending_review'
 *
 * @throws Error with descriptive message if conditions not met
 */
export async function supervisorApproveDenial(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  const [decision] = await db
    .select()
    .from(acmdCaseDecisions)
    .where(and(
      eq(acmdCaseDecisions.caseId, caseId),
      eq(acmdCaseDecisions.companyId, companyId),
    ))
    .orderBy(desc(acmdCaseDecisions.decidedAt))
    .limit(1);

  if (!decision) {
    throw new Error('Decision not found');
  }

  if (decision.decisionType !== 'denied') {
    throw new Error('No pending denial for supervisor review');
  }

  if (decision.supervisorStatus !== 'pending_review') {
    throw new Error('No pending denial for supervisor review');
  }

  const updatedRows = await db
    .update(acmdCaseDecisions)
    .set({
      supervisorStatus: 'approved',
      supervisorId: actorId,
      supervisorReviewedAt: now,
    })
    .where(and(
      eq(acmdCaseDecisions.id, decision.id),
      eq(acmdCaseDecisions.supervisorStatus, 'pending_review'),
    ))
    .returning();

  if (updatedRows.length === 0) {
    throw new Error('Supervisor action already taken');
  }

  const updated = updatedRows[0]!;

  await writeAuditLog({
    companyId,
    caseId,
    action: 'supervisor_approved',
    actorId,
    metadata: {
      decisionId: decision.id,
    },
  });

  return updated as unknown as AcmdCaseDecision;
}

/**
 * Supervisor rejects a pending denial decision.
 *
 * Conditions:
 *   - Decision must exist + decisionType === 'denied'
 *   - supervisor_status must be 'pending_review'
 *   - reason must be non-empty, min 10 chars
 *
 * @throws Error with descriptive message if conditions not met
 */
export async function supervisorRejectDenial(
  caseId: string,
  companyId: string,
  actorId: string,
  reason: string,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  if (!reason || reason.trim().length < 10) {
    throw new Error('Reason must be at least 10 characters');
  }

  const [decision] = await db
    .select()
    .from(acmdCaseDecisions)
    .where(and(
      eq(acmdCaseDecisions.caseId, caseId),
      eq(acmdCaseDecisions.companyId, companyId),
    ))
    .orderBy(desc(acmdCaseDecisions.decidedAt))
    .limit(1);

  if (!decision) {
    throw new Error('Decision not found');
  }

  if (decision.decisionType !== 'denied') {
    throw new Error('No pending denial for supervisor review');
  }

  if (decision.supervisorStatus !== 'pending_review') {
    throw new Error('No pending denial for supervisor review');
  }

  const rejectedRows = await db
    .update(acmdCaseDecisions)
    .set({
      supervisorStatus: 'rejected',
      supervisorRejectReason: reason,
      supervisorId: actorId,
      supervisorReviewedAt: now,
    })
    .where(and(
      eq(acmdCaseDecisions.id, decision.id),
      eq(acmdCaseDecisions.supervisorStatus, 'pending_review'),
    ))
    .returning();

  if (rejectedRows.length === 0) {
    throw new Error('Supervisor action already taken');
  }

  const updatedReject = rejectedRows[0]!;

  const sanitizedReason = sanitizeText(reason);

  await writeAuditLog({
    companyId,
    caseId,
    action: 'supervisor_rejected',
    actorId,
    metadata: {
      decisionId: decision.id,
      reason: sanitizedReason,
    },
  });

  return updatedReject as unknown as AcmdCaseDecision;
}

/**
 * Supervisor requests additional information before reviewing a denial.
 *
 * Conditions:
 *   - Decision must exist + decisionType === 'denied'
 *   - supervisor_status must be 'pending_review' OR 'info_requested' (can request multiple times)
 *   - questions must be non-empty, min 10 chars
 *
 * @throws Error with descriptive message if conditions not met
 */
export async function supervisorRequestInfo(
  caseId: string,
  companyId: string,
  actorId: string,
  questions: string,
): Promise<AcmdCaseDecision> {
  const now = new Date();

  if (!questions || questions.trim().length < 10) {
    throw new Error('Questions must be at least 10 characters');
  }

  const [decision] = await db
    .select()
    .from(acmdCaseDecisions)
    .where(and(
      eq(acmdCaseDecisions.caseId, caseId),
      eq(acmdCaseDecisions.companyId, companyId),
    ))
    .orderBy(desc(acmdCaseDecisions.decidedAt))
    .limit(1);

  if (!decision) {
    throw new Error('Decision not found');
  }

  if (decision.decisionType !== 'denied') {
    throw new Error('No pending denial for supervisor review');
  }

  if (decision.supervisorStatus !== 'pending_review' && decision.supervisorStatus !== 'info_requested') {
    throw new Error('No pending denial for supervisor review');
  }

  const infoRows = await db
    .update(acmdCaseDecisions)
    .set({
      supervisorStatus: 'info_requested',
      supervisorInfoRequest: questions,
      supervisorId: actorId,
      supervisorReviewedAt: now,
    })
    .where(and(
      eq(acmdCaseDecisions.id, decision.id),
      inArray(acmdCaseDecisions.supervisorStatus, ['pending_review', 'info_requested']),
    ))
    .returning();

  if (infoRows.length === 0) {
    throw new Error('Supervisor action already taken');
  }

  const updatedInfo = infoRows[0]!;

  const sanitizedQuestions = sanitizeText(questions);

  await writeAuditLog({
    companyId,
    caseId,
    action: 'supervisor_info_requested',
    actorId,
    metadata: {
      decisionId: decision.id,
      questions: sanitizedQuestions,
    },
  });

  return updatedInfo as unknown as AcmdCaseDecision;
}

/**
 * Load the manager input form data for a case.
 * Caller must have 'manager' role.
 * CRITICAL: NEVER includes medicalInfo, denialReason, aiClassification, or any EEOC analysis.
 * Only safe operational fields are returned.
 *
 * @throws Error if case not found
 */
export async function getManagerInputForm(
  caseId: string,
  companyId: string,
): Promise<ManagerInputFormResult> {
  // Load case (scoped to company) — select only non-medical fields
  const [caseRow] = await db
    .select({
      id: acmdCases.id,
      status: acmdCases.status,
      type: acmdCases.type,
      employeeId: acmdCases.employeeId,
      assignedTo: acmdCases.assignedTo,
      deadline: acmdCases.deadline,
      createdAt: acmdCases.createdAt,
    })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) {
    throw new Error('Case not found');
  }

  // Load employee — name, department, position (NO medical info stored here)
  const [employee] = await db
    .select({
      name: acmdEmployees.name,
      department: acmdEmployees.department,
      position: acmdEmployees.position,
    })
    .from(acmdEmployees)
    .where(and(
      eq(acmdEmployees.id, caseRow.employeeId),
      eq(acmdEmployees.companyId, companyId),
    ))
    .limit(1);

  // Load HR requester from manager_input_requested audit log
  const [requestedLog] = await db
    .select()
    .from(acmdAuditLogs)
    .where(and(
      eq(acmdAuditLogs.caseId, caseId),
      eq(acmdAuditLogs.companyId, companyId),
      eq(acmdAuditLogs.action, 'manager_input_requested'),
    ))
    .orderBy(desc(acmdAuditLogs.createdAt))
    .limit(1);

  let hrRequesterName = 'HR Team';
  if (requestedLog?.actorId) {
    const [hrUser] = await db
      .select({ name: acmdUsers.name })
      .from(acmdUsers)
      .where(and(
        eq(acmdUsers.id, requestedLog.actorId),
        eq(acmdUsers.companyId, companyId),
      ))
      .limit(1);
    if (hrUser?.name) hrRequesterName = hrUser.name;
  }

  // Calculate daysRemaining from deadline
  const responseDeadline = caseRow.deadline ?? null;
  let daysRemaining: number | null = null;
  if (responseDeadline) {
    const msRemaining = responseDeadline.getTime() - Date.now();
    daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  }

  // Check if manager already submitted input
  const [receivedLog] = await db
    .select()
    .from(acmdAuditLogs)
    .where(and(
      eq(acmdAuditLogs.caseId, caseId),
      eq(acmdAuditLogs.companyId, companyId),
      eq(acmdAuditLogs.action, 'manager_input_received'),
    ))
    .orderBy(desc(acmdAuditLogs.createdAt))
    .limit(1);

  const alreadySubmitted = !!receivedLog;
  const submittedAt = receivedLog ? receivedLog.createdAt.toISOString() : null;

  // Determine mode: 'acknowledgment' if decision has been made, 'form' otherwise
  const caseStatus = caseRow.status;
  const isDecided = caseStatus === 'approved' || caseStatus === 'denied';
  const mode: 'form' | 'acknowledgment' = isDecided ? 'acknowledgment' : 'form';
  const outcomeType: 'approved' | 'denied' | null = isDecided
    ? (caseStatus as 'approved' | 'denied')
    : null;

  // accommodationCategory: use case type as category (safe, non-medical)
  const accommodationCategory = caseRow.type;

  return {
    caseId: caseRow.id,
    employeeName: employee?.name ?? 'Unknown',
    department: employee?.department ?? 'Unknown',
    positionTitle: employee?.position ?? 'Unknown',
    accommodationCategory,
    hrRequesterName,
    responseDeadline: responseDeadline ? responseDeadline.toISOString() : null,
    daysRemaining,
    alreadySubmitted,
    submittedAt,
    mode,
    outcomeType,
  };
}

/**
 * Case CRUD service for AccommodateAI.
 *
 * Handles encryption of medical_info on INSERT and decryption on SELECT.
 * Uses @acmd/db for schema + db client, medicalEncryption for PHI.
 *
 * SECURITY:
 *   - medical_info is ALWAYS encrypted before DB write
 *   - medical_info is decrypted after DB read
 *   - If encryption key is missing, INSERT throws (never store plaintext)
 *   - Error logs say only "medical data processing error" — no PHI
 */

import { eq, and, gte, lte, sql, isNull, lt, gt } from 'drizzle-orm';
import { db } from '@acmd/db';

/**
 * Database or transaction handle — accepts both the top-level `db` and a
 * `tx` handle from inside `db.transaction(async (tx) => ...)`. This lets
 * helpers like `writeAuditLog` be called either standalone or inside a
 * transaction without widening to `any`.
 */
export type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];
import {
  acmdCases,
  acmdAuditLogs,
  acmdNotifications,
  acmdEmployees,
  acmdCompanies,
  acmdUsers,
  acmdDiscussions,
  type NewAcmdCase,
  type AcmdCase,
  type AcmdDiscussion,
} from '@acmd/db';
import { encryptMedical, decryptMedical } from './medicalEncryption.js';
import { classifyCase, type ClassificationInput, type ClassificationResult } from './aiClassifier.js';
import {
  generateChecklistSteps,
  saveChecklist,
  calculateDeadline,
} from './checklistGenerator.js';
import { getCaseDecision } from './approvalService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateCaseInput {
  companyId: string;
  employeeId: string;
  requestDescription: string;
  medicalInfo?: string | null;
  type?: 'ada' | 'pwfa' | 'state_law' | 'multiple';
  /** Actor's role — used for auto-assign logic (3C.1) */
  actorRole?: 'super_admin' | 'hr' | 'manager';
}

// ---------------------------------------------------------------------------
// ASSIGNMENT TYPES
// ---------------------------------------------------------------------------

export interface ReassignCaseInput {
  caseId: string;
  companyId: string;
  assignedTo: string; // UUID of new assignee
  actorId: string;
}

export interface ReassignCaseResult {
  case_: AcmdCase;
  previousAssignee: string | null;
}

export interface UnacknowledgedCasesResult {
  notifiedCount: number;
  caseIds: string[];
}

export interface UpdateCaseInput {
  status?: 'intake' | 'interactive_process' | 'awaiting_medical' | 'awaiting_input' | 'review' | 'implementation' | 'active' | 'approved' | 'denied' | 'closed';
  approvedAccommodation?: string | null;
  denialReason?: string | null;
  /** PWFA leave-forcing safeguard: must be true when approvedAccommodation contains "leave" on PWFA cases */
  leave_alternatives_confirmed?: boolean;
  /** PWFA leave-forcing safeguard: documentation of alternatives explored (min 50 chars) */
  alternatives_documented?: string;
}

export interface ListCasesOptions {
  companyId: string;
  status?: string;
  type?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
  /** Caller role — used for defense-in-depth field exclusion at service layer */
  role?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decrypt medical_info in a case row, returning null on failure. */
function decryptCaseMedicalInfo<T extends Pick<AcmdCase, 'medicalInfo'>>(
  row: T,
): T {
  if (row.medicalInfo) {
    try {
      return { ...row, medicalInfo: decryptMedical(row.medicalInfo) };
    } catch {
      // Graceful failure — log generic message, return row with null medical info
      console.error('medical data processing error');
      return { ...row, medicalInfo: null };
    }
  }
  return row;
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------

/**
 * Write an audit log entry.
 * @param params - Audit log fields
 * @param txDb - Optional transaction handle (defaults to global db)
 */
export async function writeAuditLog(params: {
  companyId: string;
  caseId?: string | null;
  action: 'case_created' | 'case_updated' | 'case_classified' | 'checklist_completed' | 'deadline_missed' | 'medical_info_accessed' | 'case_assigned' | 'case_reassigned' | 'accommodation_approved' | 'accommodation_denied' | 'denial_gate_validated' | 'legal_review_completed' | 'pwfa_fast_track_approved' | 'approval_settings_updated' | 'manager_input_requested' | 'manager_input_received' | 'pwfa_interim_recorded' | 'pwfa_leave_forcing_blocked' | 'pwfa_leave_forcing_approved' | 'auto_status_transition' | 'medical_docs_received' | 'discussion_created' | 'case_closed' | 'supervisor_approved' | 'supervisor_rejected' | 'supervisor_info_requested' | 'onboarding_created';
  actorId: string;
  metadata?: Record<string, unknown>;
}, txDb: DbOrTx = db): Promise<void> {
  await txDb.insert(acmdAuditLogs).values({
    companyId: params.companyId,
    caseId: params.caseId ?? undefined,
    action: params.action,
    actorId: params.actorId,
    metadata: params.metadata ?? {},
  });
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Insert a new case. Encrypts medical_info before writing to DB.
 * Triggers AI classification, auto-checklist, and deadline calculation.
 *
 * @throws Error if ACMD_ENCRYPTION_KEY is not set and medical_info is provided
 */
export async function createCase(
  data: CreateCaseInput,
  actorId: string,
): Promise<{ case_: AcmdCase; classification: ClassificationResult | null; aiFallback: boolean }> {
  // ─── 3C.1: Auto-assign logic ──────────────────────────────────────────────
  // hr → assign to self
  // super_admin → assign to self
  // manager → assign to company's default HR contact (or self if none set)
  let autoAssignedTo: string = actorId;
  let assignWarning: string | null = null;

  if (data.actorRole === 'manager') {
    // Look up default HR contact for this company
    const [companyRow] = await db
      .select({ defaultHrContactId: acmdCompanies.defaultHrContactId })
      .from(acmdCompanies)
      .where(eq(acmdCompanies.id, data.companyId))
      .limit(1);

    if (companyRow?.defaultHrContactId) {
      autoAssignedTo = companyRow.defaultHrContactId;
    } else {
      // No default HR contact — assign to self + warn
      autoAssignedTo = actorId;
      assignWarning = 'No default HR contact set for company — case assigned to creator';
      console.warn(`[Cases] Auto-assign: ${assignWarning} (companyId=${data.companyId})`);
    }
  }

  const now = new Date();

  const insertData: NewAcmdCase = {
    companyId: data.companyId,
    employeeId: data.employeeId,
    requestDescription: data.requestDescription,
    medicalInfo: data.medicalInfo ?? null,
    type: data.type ?? 'ada', // Default type before AI classification
    status: 'intake',
    assignedTo: autoAssignedTo,
    assignedAt: now,
  };

  // Encrypt medical_info before INSERT — throws if key missing
  if (insertData.medicalInfo) {
    insertData.medicalInfo = encryptMedical(insertData.medicalInfo);
  }

  // Transaction 1: INSERT case + audit logs (atomic — no partial data)
  const case_ = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(acmdCases)
      .values(insertData)
      .returning();

    const row = decryptCaseMedicalInfo(inserted as AcmdCase);

    // Write audit log: case_created
    await writeAuditLog({
      companyId: data.companyId,
      caseId: row.id,
      action: 'case_created',
      actorId,
      metadata: { source: 'api', employeeId: data.employeeId },
    }, tx);

    // Write audit log: case_assigned
    await writeAuditLog({
      companyId: data.companyId,
      caseId: row.id,
      action: 'case_assigned',
      actorId,
      metadata: {
        assignedTo: autoAssignedTo,
        actorRole: data.actorRole ?? 'super_admin',
        warning: assignWarning,
      },
    }, tx);

    return row;
  });

  // --- AI Classification (async, non-blocking to case creation) ---
  let classification: ClassificationResult | null = null;
  let aiFallback = false;

  // Fetch employee info for AI context
  const [employee] = await db
    .select()
    .from(acmdEmployees)
    .where(eq(acmdEmployees.id, data.employeeId))
    .limit(1);

  const classInput: ClassificationInput = {
    requestDescription: data.requestDescription,
    employeeName: employee?.name ?? 'Unknown',
    employeePosition: employee?.position ?? null,
    employeeDepartment: employee?.department ?? null,
    employeeState: employee?.state ?? null,
    companyState: null, // Will be set if we have company info
    caseId: case_.id,       // For consent check (defense in depth)
    companyId: data.companyId, // For consent check (defense in depth)
  };

  const aiResult = await classifyCase(classInput);

  if (aiResult.success && aiResult.result) {
    classification = aiResult.result;

    // Update case with AI classification
    const updateFields: Record<string, unknown> = {
      aiClassification: classification,
      updatedAt: new Date(),
    };

    // If confidence >= 0.7, auto-update case type
    if (classification.confidence >= 0.7) {
      updateFields['type'] = classification.law_type;
    }

    await db
      .update(acmdCases)
      .set(updateFields)
      .where(eq(acmdCases.id, case_.id));

    // Audit log for classification
    await writeAuditLog({
      companyId: data.companyId,
      caseId: case_.id,
      action: 'case_classified',
      actorId,
      metadata: {
        law_type: classification.law_type,
        confidence: classification.confidence,
        auto_updated: classification.confidence >= 0.7,
      },
    });

    // Generate checklist based on AI-determined law type
    const lawType = classification.confidence >= 0.7
      ? classification.law_type
      : (data.type ?? 'ada');
    const steps = generateChecklistSteps(lawType, employee?.state);
    await saveChecklist(case_.id, steps);

    // Calculate and set deadline
    const deadline = calculateDeadline(lawType, employee?.state);
    await db
      .update(acmdCases)
      .set({ deadline, updatedAt: new Date() })
      .where(eq(acmdCases.id, case_.id));
  } else {
    // AI failed — fallback to manual mode
    aiFallback = true;

    // Audit log for AI failure
    await writeAuditLog({
      companyId: data.companyId,
      caseId: case_.id,
      action: 'case_updated',
      actorId,
      metadata: {
        event: 'ai_classification_failed',
        error: aiResult.error ?? 'Unknown',
        fallback: true,
      },
    });

    // Default checklist: ADA 11 steps
    const defaultType = data.type ?? 'ada';
    const steps = generateChecklistSteps(defaultType, employee?.state);
    await saveChecklist(case_.id, steps);

    // Default deadline
    const deadline = calculateDeadline(defaultType, employee?.state);
    await db
      .update(acmdCases)
      .set({ deadline, updatedAt: new Date() })
      .where(eq(acmdCases.id, case_.id));
  }

  // Create notification
  await db.insert(acmdNotifications).values({
    companyId: data.companyId,
    userId: actorId,
    type: 'case_created',
    title: 'New accommodation case created',
    body: `Case for employee ${employee?.name ?? 'Unknown'} has been created.`,
    caseId: case_.id,
  });

  // Re-fetch the updated case
  const [updatedCase] = await db
    .select()
    .from(acmdCases)
    .where(eq(acmdCases.id, case_.id))
    .limit(1);

  return {
    case_: decryptCaseMedicalInfo(updatedCase as AcmdCase),
    classification,
    aiFallback,
  };
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/**
 * Derive AI consent status from case fields.
 * - 'given' — consent explicitly granted
 * - 'declined' — consent explicitly declined (timestamp set but not given)
 * - 'pending' — no consent action taken yet (no timestamp)
 */
export function deriveAiConsentStatus(
  aiConsentGiven: boolean,
  aiConsentTimestamp: Date | null,
): 'pending' | 'given' | 'declined' {
  if (!aiConsentTimestamp) return 'pending';
  return aiConsentGiven ? 'given' : 'declined';
}

/**
 * Get a single case by ID + company_id. Decrypts medical_info after reading.
 * Enriches response with computed ai_consent_status field.
 */
export async function getCaseById(
  caseId: string,
  companyId: string,
): Promise<(AcmdCase & { ai_consent_status: 'pending' | 'given' | 'declined' }) | null> {
  const [row] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!row) return null;
  const decrypted = decryptCaseMedicalInfo(row as AcmdCase);
  return {
    ...decrypted,
    ai_consent_status: deriveAiConsentStatus(decrypted.aiConsentGiven, decrypted.aiConsentTimestamp),
  };
}

/**
 * List cases by company with filtering and pagination.
 */
export async function listCases(
  options: ListCasesOptions,
): Promise<{ cases: AcmdCase[]; total: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [eq(acmdCases.companyId, options.companyId)];

  if (options.status) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(eq(acmdCases.status, options.status as any));
  }
  if (options.type) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(eq(acmdCases.type, options.type as any));
  }
  if (options.dateFrom) {
    conditions.push(gte(acmdCases.createdAt, options.dateFrom));
  }
  if (options.dateTo) {
    conditions.push(lte(acmdCases.createdAt, options.dateTo));
  }

  const whereClause = conditions.length === 1
    ? conditions[0]
    : and(...conditions);

  // Count total
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(acmdCases)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  // Fetch paginated results — explicitly exclude medicalInfo for list response
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const isManager = options.role === 'manager';

  // Defense-in-depth (layer 1): exclude sensitive fields from SELECT for manager role.
  // Layer 2 filter (filterMedicalFieldsFromList) also runs at the route layer.
  // medicalInfo is always excluded from list — only getCaseById returns it (decrypted).
  const baseSelect = {
    id: acmdCases.id,
    companyId: acmdCases.companyId,
    employeeId: acmdCases.employeeId,
    assignedTo: acmdCases.assignedTo,
    status: acmdCases.status,
    type: acmdCases.type,
    suggestedAccommodations: acmdCases.suggestedAccommodations,
    approvedAccommodation: acmdCases.approvedAccommodation,
    deadline: acmdCases.deadline,
    closedAt: acmdCases.closedAt,
    deletedAt: acmdCases.deletedAt,
    createdAt: acmdCases.createdAt,
    updatedAt: acmdCases.updatedAt,
  };

  const fullSelect = {
    ...baseSelect,
    requestDescription: acmdCases.requestDescription,
    aiClassification: acmdCases.aiClassification,
    denialReason: acmdCases.denialReason,
  };

  const rows = await db
    .select(isManager ? baseSelect : fullSelect)
    .from(acmdCases)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(acmdCases.createdAt);

  return { cases: rows as AcmdCase[], total };
}

/**
 * Get cases by company ID. Decrypts medical_info for each row.
 */
export async function getCasesByCompanyId(
  companyId: string,
): Promise<AcmdCase[]> {
  const rows = await db
    .select()
    .from(acmdCases)
    .where(eq(acmdCases.companyId, companyId));

  return (rows as AcmdCase[]).map(decryptCaseMedicalInfo);
}

// ---------------------------------------------------------------------------
// STATUS TRANSITION MAP
// ---------------------------------------------------------------------------

/** Valid status transitions: key = current status, value = allowed next statuses */
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  intake: ['interactive_process', 'closed'],
  interactive_process: ['awaiting_medical', 'awaiting_input', 'review', 'approved', 'denied', 'closed'],
  awaiting_medical: ['interactive_process', 'review', 'closed'],
  awaiting_input: ['interactive_process', 'review', 'closed'],
  review: ['implementation', 'approved', 'denied', 'closed'],
  implementation: ['active', 'closed'],
  active: ['closed'],
  approved: ['active', 'closed'],
  denied: ['intake', 'closed'],
  closed: ['intake'],
};

/**
 * Validate that a status transition is allowed.
 * @returns null if valid, error message string if invalid
 */
export function validateStatusTransition(
  currentStatus: string,
  newStatus: string,
): string | null {
  if (currentStatus === newStatus) {
    return `Status is already '${currentStatus}'`;
  }
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    return `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed: ${(allowed ?? []).join(', ')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

/**
 * Update a case (status, accommodation, denial reason).
 * Returns null if case not found, throws Error with message for invalid transitions.
 */
export async function updateCase(
  caseId: string,
  companyId: string,
  actorId: string,
  data: UpdateCaseInput,
): Promise<AcmdCase | null> {
  // Verify case belongs to company
  const existing = await getCaseById(caseId, companyId);
  if (!existing) return null;

  // Build update object
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (data.status !== undefined) {
    // Validate status transition
    const transitionError = validateStatusTransition(existing.status, data.status);
    if (transitionError) {
      throw new Error(transitionError);
    }

    // DENIAL GATE: require a validated decision record before allowing denial
    if (data.status === 'denied') {
      const decision = await getCaseDecision(caseId, companyId);
      if (!decision || decision.decisionType !== 'denied') {
        throw new Error('Cannot set status to denied without a validated denial decision. Use POST /cases/:id/decision with denial gate data first.');
      }
    }

    updateData['status'] = data.status;
    if (data.status === 'closed') {
      updateData['closedAt'] = new Date();
    }
  }
  if (data.approvedAccommodation !== undefined) {
    // ── PWFA Leave-Forcing Safeguard (42 USC 2000gg-1(4)) ──────────────
    // If a PWFA case accommodation contains "leave", the employer MUST
    // document that alternatives were explored first. Forcing leave without
    // exploring alternatives violates PWFA. This is a HARD BLOCK (400).
    if (
      data.approvedAccommodation
      && /\bleave\b/i.test(data.approvedAccommodation)
      && existing.type === 'pwfa'
    ) {
      if (
        !data.leave_alternatives_confirmed
        || !data.alternatives_documented
        || data.alternatives_documented.trim().length < 50
      ) {
        // Audit log the blocked attempt
        await writeAuditLog({
          companyId,
          caseId,
          action: 'pwfa_leave_forcing_blocked',
          actorId,
          metadata: {
            attemptedAccommodation: data.approvedAccommodation,
            leave_alternatives_confirmed: data.leave_alternatives_confirmed ?? false,
            alternatives_documented_length: data.alternatives_documented?.trim().length ?? 0,
            legalCitation: '42 USC 2000gg-1(4)',
          },
        });

        throw new Error(
          'PWFA leave-forcing blocked: Under 42 USC 2000gg-1(4), employers may not force '
          + 'an employee to take leave (paid or unpaid) if another reasonable accommodation '
          + 'can be provided. You must set leave_alternatives_confirmed=true and provide '
          + 'alternatives_documented (min 50 characters) describing the alternatives explored.',
        );
      }

      // Alternatives confirmed — audit log and proceed
      await writeAuditLog({
        companyId,
        caseId,
        action: 'pwfa_leave_forcing_approved',
        actorId,
        metadata: {
          approvedAccommodation: data.approvedAccommodation,
          alternatives_documented: data.alternatives_documented,
          legalCitation: '42 USC 2000gg-1(4)',
        },
      });
    }

    updateData['approvedAccommodation'] = data.approvedAccommodation;
  }
  if (data.denialReason !== undefined) {
    updateData['denialReason'] = data.denialReason;
  }

  const [updated] = await db
    .update(acmdCases)
    .set(updateData)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .returning();

  if (!updated) return null;

  // Audit log
  await writeAuditLog({
    companyId,
    caseId,
    action: 'case_updated',
    actorId,
    metadata: {
      event: 'case_updated',
      changes: data,
    },
  });

  return decryptCaseMedicalInfo(updated as AcmdCase);
}

// ---------------------------------------------------------------------------
// RE-CLASSIFY
// ---------------------------------------------------------------------------

/**
 * Re-run AI classification on an existing case.
 */
export async function reclassifyCase(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<{ case_: AcmdCase | null; classification: ClassificationResult | null; aiFallback: boolean }> {
  const existing = await getCaseById(caseId, companyId);
  if (!existing) return { case_: null, classification: null, aiFallback: false };

  if (!existing.requestDescription) {
    return { case_: existing, classification: null, aiFallback: true };
  }

  // Fetch employee info
  const [employee] = await db
    .select()
    .from(acmdEmployees)
    .where(eq(acmdEmployees.id, existing.employeeId))
    .limit(1);

  const classInput: ClassificationInput = {
    requestDescription: existing.requestDescription,
    employeeName: employee?.name ?? 'Unknown',
    employeePosition: employee?.position ?? null,
    employeeDepartment: employee?.department ?? null,
    employeeState: employee?.state ?? null,
    companyState: null,
    caseId,              // For consent check (defense in depth)
    companyId,           // For consent check (defense in depth)
  };

  const aiResult = await classifyCase(classInput);

  if (aiResult.success && aiResult.result) {
    const classification = aiResult.result;

    const updateFields: Record<string, unknown> = {
      aiClassification: classification,
      updatedAt: new Date(),
    };

    if (classification.confidence >= 0.7) {
      updateFields['type'] = classification.law_type;
    }

    // Recalculate deadline
    const lawType = classification.confidence >= 0.7
      ? classification.law_type
      : existing.type;
    const deadline = calculateDeadline(lawType, employee?.state);
    updateFields['deadline'] = deadline;

    await db
      .update(acmdCases)
      .set(updateFields)
      .where(eq(acmdCases.id, caseId));

    await writeAuditLog({
      companyId,
      caseId,
      action: 'case_classified',
      actorId,
      metadata: {
        event: 'case_reclassified',
        law_type: classification.law_type,
        confidence: classification.confidence,
        auto_updated: classification.confidence >= 0.7,
      },
    });

    const [updatedCase] = await db
      .select()
      .from(acmdCases)
      .where(eq(acmdCases.id, caseId))
      .limit(1);

    return {
      case_: decryptCaseMedicalInfo(updatedCase as AcmdCase),
      classification,
      aiFallback: false,
    };
  }

  // AI failed
  await writeAuditLog({
    companyId,
    caseId,
    action: 'case_updated',
    actorId,
    metadata: {
      event: 'reclassification_failed',
      error: aiResult.error ?? 'Unknown',
    },
  });

  return { case_: existing, classification: null, aiFallback: true };
}

// ---------------------------------------------------------------------------
// ASSIGNMENT (3C.2)
// ---------------------------------------------------------------------------

/**
 * Reassign a case to a different user.
 *
 * Rules:
 * - Only super_admin or hr can reassign
 * - New assignee must be super_admin or hr in the same company
 * - Creates 'case_reassigned' audit log
 *
 * @throws Error if assignee not found or invalid role
 */
export async function reassignCase(
  input: ReassignCaseInput,
): Promise<ReassignCaseResult | null> {
  // Verify case belongs to company
  const existing = await getCaseById(input.caseId, input.companyId);
  if (!existing) return null;

  // Verify assignee exists + is super_admin or hr + in same company
  const [assignee] = await db
    .select({ id: acmdUsers.id, role: acmdUsers.role, companyId: acmdUsers.companyId })
    .from(acmdUsers)
    .where(and(eq(acmdUsers.id, input.assignedTo), isNull(acmdUsers.deletedAt)))
    .limit(1);

  if (!assignee) {
    throw new Error('Assignee not found');
  }
  if (assignee.companyId !== input.companyId) {
    throw new Error('Assignee does not belong to this company');
  }
  if (assignee.role !== 'super_admin' && assignee.role !== 'hr') {
    throw new Error('Assignee must have super_admin or hr role');
  }

  const previousAssignee = existing.assignedTo ?? null;
  const now = new Date();

  // Transaction: UPDATE case + audit log (atomic — audit trail cannot be lost)
  const updated = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(acmdCases)
      .set({ assignedTo: input.assignedTo, assignedAt: now, updatedAt: now })
      .where(and(eq(acmdCases.id, input.caseId), eq(acmdCases.companyId, input.companyId)))
      .returning();

    if (!updatedRow) return null;

    await writeAuditLog({
      companyId: input.companyId,
      caseId: input.caseId,
      action: 'case_reassigned',
      actorId: input.actorId,
      metadata: {
        previousAssignee,
        newAssignee: input.assignedTo,
      },
    }, tx);

    return updatedRow;
  });

  if (!updated) return null;

  return {
    case_: decryptCaseMedicalInfo(updated as AcmdCase),
    previousAssignee,
  };
}

// ---------------------------------------------------------------------------
// ESCALATION CHECK (3C.4)
// ---------------------------------------------------------------------------

/**
 * Check for unacknowledged cases — cases assigned 2+ business days ago
 * with no activity (no audit log entry AFTER the assignment).
 *
 * Creates a 'case_unacknowledged' notification for all super_admin users
 * in the company.
 */
export async function checkUnacknowledgedCases(
  companyId: string,
): Promise<UnacknowledgedCasesResult> {
  // Find assigned cases with assignedAt set (not NULL) and not closed/denied
  const twoBusinessDaysAgo = (() => {
    const now = new Date();
    let businessDaysCount = 0;
    const cursor = new Date(now);

    while (businessDaysCount < 2) {
      cursor.setDate(cursor.getDate() - 1);
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) {
        businessDaysCount++;
      }
    }
    return cursor;
  })();

  // Build conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [
    lt(acmdCases.assignedAt, twoBusinessDaysAgo),
  ];

  // Exclude terminal states
  // We'll filter in-code after fetching to avoid complex enum comparisons

  if (companyId) {
    conditions.push(eq(acmdCases.companyId, companyId));
  }

  const candidateCases = await db
    .select({
      id: acmdCases.id,
      companyId: acmdCases.companyId,
      assignedAt: acmdCases.assignedAt,
      assignedTo: acmdCases.assignedTo,
      status: acmdCases.status,
    })
    .from(acmdCases)
    .where(and(...conditions));

  // Filter: exclude terminal statuses, must have assignedTo
  const activeCandidates = candidateCases.filter(
    (c) => c.assignedTo !== null
      && c.status !== 'closed'
      && c.status !== 'approved'
      && c.status !== 'denied',
  );

  if (activeCandidates.length === 0) {
    return { notifiedCount: 0, caseIds: [] };
  }

  // For each candidate, check if there's any audit log entry AFTER assignedAt
  // An activity = any audit log for this case AFTER assignedAt (excluding case_assigned itself)
  const unacknowledgedCases: typeof activeCandidates = [];

  for (const candidate of activeCandidates) {
    if (!candidate.assignedAt) continue;

    const [recentActivity] = await db
      .select({ id: acmdAuditLogs.id })
      .from(acmdAuditLogs)
      .where(
        and(
          eq(acmdAuditLogs.caseId, candidate.id),
          gt(acmdAuditLogs.createdAt, candidate.assignedAt),
        ),
      )
      .limit(1);

    if (!recentActivity) {
      unacknowledgedCases.push(candidate);
    }
  }

  if (unacknowledgedCases.length === 0) {
    return { notifiedCount: 0, caseIds: [] };
  }

  // Group by companyId and notify super_admins
  const companyCaseMap = new Map<string, string[]>();
  for (const c of unacknowledgedCases) {
    const arr = companyCaseMap.get(c.companyId) ?? [];
    arr.push(c.id);
    companyCaseMap.set(c.companyId, arr);
  }

  let totalNotified = 0;

  for (const [cId, caseIds] of companyCaseMap) {
    // Find super_admin users for this company
    const superAdmins = await db
      .select({ id: acmdUsers.id })
      .from(acmdUsers)
      .where(
        and(
          eq(acmdUsers.companyId, cId),
          eq(acmdUsers.role, 'super_admin'),
          isNull(acmdUsers.deletedAt),
        ),
      );

    for (const admin of superAdmins) {
      for (const caseId of caseIds) {
        await db.insert(acmdNotifications).values({
          companyId: cId,
          userId: admin.id,
          type: 'case_unacknowledged',
          title: 'Unacknowledged accommodation case',
          body: `Case ${caseId} has been assigned for 2+ business days with no activity. Please review to avoid ADA delay.`,
          caseId,
        });
        totalNotified++;
      }
    }
  }

  return {
    notifiedCount: totalNotified,
    caseIds: unacknowledgedCases.map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// DISCUSSIONS (Phase 6C — ACMD-137-A)
// ---------------------------------------------------------------------------

export interface CreateDiscussionInput {
  caseId: string;
  companyId: string;
  recordedBy: string;
  discussionDate: string; // ISO date string 'YYYY-MM-DD'
  method: 'in_person' | 'video' | 'phone' | 'email' | 'written';
  participants: string[]; // array of names
  summary: string;
  employeePreference?: string | null;
}

/**
 * Insert a new discussion record for a case.
 * Returns the created discussion.
 */
export async function createDiscussion(
  input: CreateDiscussionInput,
): Promise<AcmdDiscussion> {
  return await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(acmdDiscussions)
      .values({
        caseId: input.caseId,
        companyId: input.companyId,
        recordedBy: input.recordedBy,
        discussionDate: input.discussionDate,
        method: input.method,
        participants: input.participants,
        summary: input.summary,
        employeePreference: input.employeePreference ?? null,
      })
      .returning();

    const row = inserted as AcmdDiscussion;

    await writeAuditLog({
      companyId: input.companyId,
      caseId: input.caseId,
      action: 'discussion_created',
      actorId: input.recordedBy,
      metadata: {
        discussionId: row.id,
        discussionDate: input.discussionDate,
        method: input.method,
        participantCount: input.participants.length,
      },
    }, tx);

    return row;
  });
}

/**
 * List all discussions for a case, scoped to a company.
 * Ordered by discussion_date ascending.
 */
export async function listDiscussions(
  caseId: string,
  companyId: string,
): Promise<AcmdDiscussion[]> {
  const rows = await db
    .select()
    .from(acmdDiscussions)
    .where(
      and(
        eq(acmdDiscussions.caseId, caseId),
        eq(acmdDiscussions.companyId, companyId),
      ),
    )
    .orderBy(acmdDiscussions.discussionDate);

  return rows as AcmdDiscussion[];
}

// ---------------------------------------------------------------------------
// CASE CLOSE (Phase 6C — ACMD-137-A)
// ---------------------------------------------------------------------------

export interface CloseCaseInput {
  caseId: string;
  companyId: string;
  closedBy: string;
}

export interface CloseCaseResult {
  ok: boolean;
  error?: 'case_not_found' | 'already_closed' | 'stage_incomplete';
  message?: string;
}

/**
 * Close a case.
 * Guards:
 *   - Case must exist + belong to companyId
 *   - Status must not already be 'closed'
 *   - Status must be 'approved' or 'denied' before closing
 * On success: sets status='closed', closedAt=NOW(), writes audit log.
 */
export async function closeCase(
  input: CloseCaseInput,
): Promise<CloseCaseResult> {
  const existing = await getCaseById(input.caseId, input.companyId);
  if (!existing) {
    return { ok: false, error: 'case_not_found' };
  }

  if (existing.status === 'closed') {
    return { ok: false, error: 'already_closed' };
  }

  if (existing.status !== 'approved' && existing.status !== 'denied') {
    return {
      ok: false,
      error: 'stage_incomplete',
      message: 'Case must be approved or denied before closing',
    };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(acmdCases)
      .set({ status: 'closed', closedAt: now, updatedAt: now })
      .where(
        and(
          eq(acmdCases.id, input.caseId),
          eq(acmdCases.companyId, input.companyId),
        ),
      );

    await writeAuditLog({
      companyId: input.companyId,
      caseId: input.caseId,
      action: 'case_closed',
      actorId: input.closedBy,
      metadata: {
        previousStatus: existing.status,
        closedAt: now.toISOString(),
      },
    }, tx);
  });

  return { ok: true };
}

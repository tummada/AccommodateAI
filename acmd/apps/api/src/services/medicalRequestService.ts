/**
 * Medical Request Service for AccommodateAI — Phase 7B.
 *
 * Handles the ADA/PWFA medical documentation request workflow:
 *   - Get current medical request status (aggregated from case + letters)
 *   - Send a medical documentation request (creates medical_request letter)
 *   - Assign a medical reviewer
 *   - Record reviewer outcome (cleared / additional_needed / insufficient)
 *
 * LEGAL NOTE: Every function that modifies case state writes to acmd_audit_logs.
 * This audit trail may be used as evidence in EEOC proceedings.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdCases,
  acmdLetters,
  acmdDocuments,
  acmdAuditLogs,
  acmdUsers,
  type AcmdLetter,
} from '@acmd/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MedicalRequestStatus =
  | 'not_started'
  | 'sent'
  | 'received'
  | 'under_review'
  | 'cleared'
  | 'additional_needed'
  | 'insufficient';

export interface MedicalRequestView {
  status: MedicalRequestStatus;
  request: {
    id: string;
    letterId: string;
    sentAt: string | null;
    dueDate: string | null;
    template: string;
    limitations: string;
  } | null;
  reviewer: {
    id: string;
    name: string;
  } | null;
  documents: Array<{
    id: string;
    filename: string;
    uploadedAt: string;
  }>;
  outcome: 'cleared' | 'additional_needed' | 'insufficient' | null;
  outcomeNotes: string | null;
}

export interface SendMedicalRequestInput {
  template: string;
  limitations: string;
  dueDate: string;
  deliveryMethod: 'email' | 'mail' | 'fax';
  notes?: string;
}

export interface AssignReviewerInput {
  reviewerId: string;
}

export interface RecordOutcomeInput {
  outcome: 'cleared' | 'additional_needed' | 'insufficient';
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse outcome from letter content JSON (stored in the content field).
 * Format: JSON blob with { template, limitations, dueDate, deliveryMethod, notes?, outcome?, outcomeNotes? }
 */
function parseMedicalLetterContent(content: string): {
  template?: string;
  limitations?: string;
  dueDate?: string;
  deliveryMethod?: string;
  notes?: string;
  outcome?: string;
  outcomeNotes?: string;
} {
  try {
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return { template: content };
  }
}

/**
 * Map letter status + content outcome to MedicalRequestStatus.
 *
 * Derivation rules (from task.md):
 *   - No medical_request letter → not_started
 *   - letter.status === 'draft' && no docs → sent
 *   - letter.status === 'draft' && has docs → received
 *   - letter has reviewerId (assignedTo set on case) → under_review
 *   - letter.status === 'sent' + outcome → map to outcome statuses
 */
function deriveStatus(
  letter: AcmdLetter,
  hasDocuments: boolean,
  hasReviewer: boolean,
  outcome: string | undefined,
): MedicalRequestStatus {
  if (letter.status === 'sent' && outcome === 'cleared') return 'cleared';
  if (letter.status === 'sent' && outcome === 'additional_needed') return 'additional_needed';
  if (letter.status === 'sent' && outcome === 'insufficient') return 'insufficient';
  if (hasReviewer) return 'under_review';
  if (hasDocuments) return 'received';
  return 'sent';
}

// ---------------------------------------------------------------------------
// GET — getMedicalRequestView
// ---------------------------------------------------------------------------

/**
 * Returns the current medical request status for a case.
 *
 * @param caseId   - The accommodation case UUID
 * @param companyId - The authenticated company UUID (for tenant isolation)
 */
export async function getMedicalRequestView(
  caseId: string,
  companyId: string,
): Promise<MedicalRequestView | null> {
  // 1. Verify case belongs to company
  const [caseRow] = await db
    .select({
      id: acmdCases.id,
      assignedTo: acmdCases.assignedTo,
    })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.id, caseId),
        eq(acmdCases.companyId, companyId),
      ),
    )
    .limit(1);

  if (!caseRow) return null;

  // 2. Find the medical_request letter for this case (most recent)
  const [letter] = await db
    .select()
    .from(acmdLetters)
    .where(
      and(
        eq(acmdLetters.caseId, caseId),
        eq(acmdLetters.type, 'medical_request'),
      ),
    )
    .orderBy(acmdLetters.createdAt)
    .limit(1);

  // 3. Load documents for this case
  const documents = await db
    .select({
      id: acmdDocuments.id,
      filename: acmdDocuments.filename,
      uploadedAt: acmdDocuments.uploadedAt,
    })
    .from(acmdDocuments)
    .where(eq(acmdDocuments.caseId, caseId));

  if (!letter) {
    return {
      status: 'not_started',
      request: null,
      reviewer: null,
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
      outcome: null,
      outcomeNotes: null,
    };
  }

  // 4. Parse letter content for metadata
  const parsed = parseMedicalLetterContent(letter.content);

  // 5. Load reviewer details if assigned
  let reviewer: { id: string; name: string } | null = null;
  if (caseRow.assignedTo) {
    const [user] = await db
      .select({
        id: acmdUsers.id,
        name: acmdUsers.name,
      })
      .from(acmdUsers)
      .where(eq(acmdUsers.id, caseRow.assignedTo))
      .limit(1);
    if (user) {
      reviewer = { id: user.id, name: user.name };
    }
  }

  // 6. Derive status
  const outcome = parsed.outcome as 'cleared' | 'additional_needed' | 'insufficient' | undefined;
  const status = deriveStatus(letter, documents.length > 0, reviewer !== null, outcome);

  return {
    status,
    request: {
      id: letter.id,
      letterId: letter.id,
      sentAt: letter.sentAt ? letter.sentAt.toISOString() : null,
      dueDate: parsed.dueDate ?? null,
      template: parsed.template ?? '',
      limitations: parsed.limitations ?? '',
    },
    reviewer,
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    outcome: outcome ?? null,
    outcomeNotes: parsed.outcomeNotes ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST — sendMedicalRequest
// ---------------------------------------------------------------------------

/**
 * Creates a medical_request letter and transitions case to awaiting_medical.
 *
 * @param caseId    - The accommodation case UUID
 * @param companyId - The authenticated company UUID (tenant isolation)
 * @param actorId   - The authenticated user performing the action
 * @param input     - Template, limitations, due date, delivery method, notes
 */
export async function sendMedicalRequest(
  caseId: string,
  companyId: string,
  actorId: string,
  input: SendMedicalRequestInput,
): Promise<
  | { letter: AcmdLetter; caseStatus: 'awaiting_medical' }
  | { conflict: true; letter: AcmdLetter }
  | null
> {
  // 1. Verify case belongs to company
  const [caseRow] = await db
    .select({ id: acmdCases.id, type: acmdCases.type })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.id, caseId),
        eq(acmdCases.companyId, companyId),
      ),
    )
    .limit(1);

  if (!caseRow) return null;

  // 1b. Idempotency check — prevent duplicate medical_request letters per case
  const [existingLetter] = await db
    .select()
    .from(acmdLetters)
    .where(
      and(
        eq(acmdLetters.caseId, caseId),
        eq(acmdLetters.type, 'medical_request'),
      ),
    )
    .limit(1);

  if (existingLetter) {
    return { conflict: true, letter: existingLetter };
  }

  // 2. Build letter content as JSON blob (stores template/limitations/dueDate/deliveryMethod/notes)
  const content = JSON.stringify({
    template: input.template,
    limitations: input.limitations,
    dueDate: input.dueDate,
    deliveryMethod: input.deliveryMethod,
    notes: input.notes ?? null,
    caseType: caseRow.type,
  });

  // 3. Create medical_request letter (status: 'draft' = request sent, awaiting response)
  const [letter] = await db
    .insert(acmdLetters)
    .values({
      caseId,
      type: 'medical_request',
      status: 'draft',
      content,
      createdBy: actorId,
    })
    .returning();

  if (!letter) {
    throw new Error('Failed to create medical request letter');
  }

  // 4. Transition case to awaiting_medical
  await db
    .update(acmdCases)
    .set({ status: 'awaiting_medical', updatedAt: new Date() })
    .where(eq(acmdCases.id, caseId));

  // 5. Write audit log: medical_docs_requested
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'medical_docs_requested',
    actorId,
    metadata: {
      letterId: letter.id,
      deliveryMethod: input.deliveryMethod,
      dueDate: input.dueDate,
    },
  });

  return { letter, caseStatus: 'awaiting_medical' };
}

// ---------------------------------------------------------------------------
// PATCH — assignMedicalReviewer
// ---------------------------------------------------------------------------

/**
 * Assigns a medical reviewer to the case (sets case.assignedTo).
 *
 * @param caseId     - The accommodation case UUID
 * @param companyId  - The authenticated company UUID (tenant isolation)
 * @param actorId    - The authenticated user performing the action
 * @param reviewerId - The user UUID to assign as reviewer
 */
export async function assignMedicalReviewer(
  caseId: string,
  companyId: string,
  actorId: string,
  reviewerId: string,
): Promise<{ success: true; reviewer: { id: string; name: string } } | null> {
  // 1. Verify case belongs to company and has a medical_request letter
  const [caseRow] = await db
    .select({ id: acmdCases.id })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.id, caseId),
        eq(acmdCases.companyId, companyId),
      ),
    )
    .limit(1);

  if (!caseRow) return null;

  // 2. Verify medical_request letter exists
  const [letter] = await db
    .select({ id: acmdLetters.id })
    .from(acmdLetters)
    .where(
      and(
        eq(acmdLetters.caseId, caseId),
        eq(acmdLetters.type, 'medical_request'),
      ),
    )
    .limit(1);

  if (!letter) return null;

  // 3. Verify reviewer exists AND belongs to same company (prevent cross-tenant assignment)
  const [reviewer] = await db
    .select({ id: acmdUsers.id, name: acmdUsers.name })
    .from(acmdUsers)
    .where(and(eq(acmdUsers.id, reviewerId), eq(acmdUsers.companyId, companyId)))
    .limit(1);

  if (!reviewer) return null;

  // 4. Update case assignedTo = reviewerId
  await db
    .update(acmdCases)
    .set({
      assignedTo: reviewerId,
      assignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(acmdCases.id, caseId));

  // 5. Write audit log: case_assigned
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'case_assigned',
    actorId,
    metadata: {
      reviewerId,
      reviewerName: reviewer.name,
      letterId: letter.id,
      context: 'medical_reviewer_assigned',
    },
  });

  return { success: true, reviewer: { id: reviewer.id, name: reviewer.name } };
}

// ---------------------------------------------------------------------------
// PATCH — recordMedicalOutcome
// ---------------------------------------------------------------------------

/**
 * Records the reviewer's determination and transitions case status.
 *
 * Outcome → case status mapping:
 *   cleared           → review
 *   additional_needed → awaiting_medical (keep waiting)
 *   insufficient      → interactive_process (proceed without)
 *
 * @param caseId    - The accommodation case UUID
 * @param companyId - The authenticated company UUID (tenant isolation)
 * @param actorId   - The authenticated user performing the action
 * @param input     - Outcome + optional notes
 */
export async function recordMedicalOutcome(
  caseId: string,
  companyId: string,
  actorId: string,
  input: RecordOutcomeInput,
): Promise<{ success: true; caseStatus: string } | null> {
  // 1. Verify case belongs to company
  const [caseRow] = await db
    .select({ id: acmdCases.id })
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.id, caseId),
        eq(acmdCases.companyId, companyId),
      ),
    )
    .limit(1);

  if (!caseRow) return null;

  // 2. Find the medical_request letter
  const [letter] = await db
    .select()
    .from(acmdLetters)
    .where(
      and(
        eq(acmdLetters.caseId, caseId),
        eq(acmdLetters.type, 'medical_request'),
      ),
    )
    .limit(1);

  if (!letter) return null;

  // 3. Determine new case status
  const newCaseStatus: 'review' | 'awaiting_medical' | 'interactive_process' =
    input.outcome === 'cleared'
      ? 'review'
      : input.outcome === 'additional_needed'
        ? 'awaiting_medical'
        : 'interactive_process';

  // 4. Parse existing letter content and merge outcome fields
  const existingContent = parseMedicalLetterContent(letter.content);
  const updatedContent = JSON.stringify({
    ...existingContent,
    outcome: input.outcome,
    outcomeNotes: input.notes ?? null,
  });

  // 5. Update letter status to 'sent' + embed outcome in content
  await db
    .update(acmdLetters)
    .set({
      status: 'sent',
      content: updatedContent,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(acmdLetters.id, letter.id));

  // 6. Transition case status
  await db
    .update(acmdCases)
    .set({ status: newCaseStatus, updatedAt: new Date() })
    .where(eq(acmdCases.id, caseId));

  // 7. Write audit log: medical_docs_received (outcome recorded)
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'medical_docs_received',
    actorId,
    metadata: {
      outcome: input.outcome,
      notes: input.notes ?? null,
      newCaseStatus,
      letterId: letter.id,
      context: 'medical_review_outcome',
    },
  });

  return { success: true, caseStatus: newCaseStatus };
}

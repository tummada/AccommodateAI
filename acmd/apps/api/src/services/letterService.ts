/**
 * Letter CRUD + Email Service for AccommodateAI.
 *
 * Handles:
 *   - Creating letters via AI generation
 *   - Listing letters for a case
 *   - Editing letter drafts
 *   - Sending letters via email (placeholder — logs + returns success)
 *   - PDF generation on demand
 *
 * SECURITY:
 *   - NEVER sends medical_info to AI
 *   - All operations scoped to company (tenant isolation)
 *   - Audit logging for generate + send actions
 */

import { eq, and } from 'drizzle-orm';
import {
  db,
  acmdCases,
  acmdLetters,
  acmdAuditLogs,
  acmdEmployees,
  acmdCompanies,
  acmdSuggestions,
} from '@acmd/db';
import type { AcmdLetter, AcmdCase, AcmdSuggestion } from '@acmd/db';
import {
  generateLetter,
  type LetterType,
  type LetterContext,
} from './letterGenerator.js';
import { generatePdf } from './pdfService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateLetterInput {
  type: LetterType;
  customInstructions?: string;
}

export interface CreateLetterResult {
  letter: AcmdLetter;
  source: 'ai' | 'fallback';
}

// ---------------------------------------------------------------------------
// Create Letter (AI Generate)
// ---------------------------------------------------------------------------

/**
 * Generate a new letter for a case using AI.
 * Validates case belongs to company, builds context (NO medical_info), calls AI.
 *
 * @param caseId - The case UUID
 * @param companyId - The company UUID (tenant isolation)
 * @param actorId - The user who triggered generation
 * @param input - Letter type + optional custom instructions
 * @returns Created letter + AI source indicator, or null if case not found
 */
export async function createLetter(
  caseId: string,
  companyId: string,
  actorId: string,
  input: CreateLetterInput,
): Promise<CreateLetterResult | null> {
  // 1. Verify case belongs to company
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return null;

  const caseData = case_ as AcmdCase;

  // 2. Get employee info (for name in letter)
  const [employee] = await db
    .select()
    .from(acmdEmployees)
    .where(eq(acmdEmployees.id, caseData.employeeId))
    .limit(1);

  // 3. Get company name
  const [company] = await db
    .select()
    .from(acmdCompanies)
    .where(eq(acmdCompanies.id, companyId))
    .limit(1);

  // 4. Build context (NEVER include medical_info)
  const ctx: LetterContext = {
    employeeName: employee?.name ?? 'Employee',
    companyName: company?.name ?? 'Company',
    requestDescription: caseData.requestDescription ?? 'Accommodation request',
    lawType: caseData.type ?? 'ada',
    caseStatus: caseData.status ?? 'intake',
    approvedAccommodation: caseData.approvedAccommodation,
    denialReason: caseData.denialReason,
    customInstructions: input.customInstructions,
  };

  // 5. Generate letter content via AI (with fallback)
  const result = await generateLetter(input.type, ctx);

  // 6. Save to DB
  const [inserted] = await db
    .insert(acmdLetters)
    .values({
      caseId,
      type: input.type,
      content: result.content,
      status: 'draft',
      createdBy: actorId,
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to insert letter');
  }

  // 7. Audit log
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'letter_generated',
    actorId,
    metadata: {
      letterId: (inserted as AcmdLetter).id,
      letterType: input.type,
      source: result.source,
    },
  });

  return {
    letter: inserted as AcmdLetter,
    source: result.source,
  };
}

// ---------------------------------------------------------------------------
// List Letters
// ---------------------------------------------------------------------------

/**
 * List all letters for a case (scoped to company).
 */
export async function listLetters(
  caseId: string,
  companyId: string,
): Promise<AcmdLetter[]> {
  // Verify case belongs to company
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return [];

  const rows = await db
    .select()
    .from(acmdLetters)
    .where(eq(acmdLetters.caseId, caseId));

  return rows as AcmdLetter[];
}

// ---------------------------------------------------------------------------
// Edit Letter Draft
// ---------------------------------------------------------------------------

/**
 * Update letter content (full text replacement).
 * Only works on draft letters.
 */
export async function editLetter(
  caseId: string,
  letterId: string,
  companyId: string,
  content: string,
  actorId?: string,
): Promise<AcmdLetter | null> {
  // Verify case belongs to company
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return null;

  // Verify letter belongs to case
  const [letter] = await db
    .select()
    .from(acmdLetters)
    .where(and(eq(acmdLetters.id, letterId), eq(acmdLetters.caseId, caseId)))
    .limit(1);

  if (!letter) return null;

  const letterData = letter as AcmdLetter;
  if (letterData.status === 'sent') return null; // Can't edit sent letters

  const [updated] = await db
    .update(acmdLetters)
    .set({ content, updatedAt: new Date() })
    .where(eq(acmdLetters.id, letterId))
    .returning();

  if (!updated) return null;

  // Audit log for letter edit
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'case_updated',
    actorId: actorId ?? null,
    metadata: {
      event: 'letter_edited',
      letterId,
      letterType: letterData.type,
    },
  });

  return updated as AcmdLetter;
}

// ---------------------------------------------------------------------------
// Send Letter (Email Placeholder)
// ---------------------------------------------------------------------------

/**
 * Send a letter via email.
 * Currently a placeholder that logs + returns success.
 * Will be integrated with Nodemailer in a future task.
 */
export async function sendLetter(
  caseId: string,
  letterId: string,
  companyId: string,
  actorId: string,
): Promise<{ letter: AcmdLetter; emailSent: boolean } | null> {
  // Verify case belongs to company
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return null;

  const caseData = case_ as AcmdCase;

  // Verify letter belongs to case
  const [letter] = await db
    .select()
    .from(acmdLetters)
    .where(and(eq(acmdLetters.id, letterId), eq(acmdLetters.caseId, caseId)))
    .limit(1);

  if (!letter) return null;

  // Get employee email
  const [employee] = await db
    .select()
    .from(acmdEmployees)
    .where(eq(acmdEmployees.id, caseData.employeeId))
    .limit(1);

  const employeeEmail = employee?.email ?? null;

  // Placeholder: log the send action (real Nodemailer integration TBD)
  console.log(`[LetterService] PLACEHOLDER: Would send letter ${letterId} to ${employeeEmail ?? 'unknown'}`);
  console.log(`[LetterService] PLACEHOLDER: Email would include PDF attachment`);

  // Update letter status to sent
  const now = new Date();
  const [updated] = await db
    .update(acmdLetters)
    .set({
      status: 'sent',
      sentAt: now,
      sentToEmail: employeeEmail,
      updatedAt: now,
    })
    .where(eq(acmdLetters.id, letterId))
    .returning();

  if (!updated) return null;

  // Audit log
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'letter_sent',
    actorId,
    metadata: {
      letterId,
      sentTo: employeeEmail,
      letterType: (updated as AcmdLetter).type,
    },
  });

  return {
    letter: updated as AcmdLetter,
    emailSent: true, // Placeholder always succeeds
  };
}

// ---------------------------------------------------------------------------
// Get Letter PDF
// ---------------------------------------------------------------------------

/**
 * Generate PDF for a letter on demand.
 *
 * @returns PDF buffer or null if letter/case not found
 */
export async function getLetterPdf(
  caseId: string,
  letterId: string,
  companyId: string,
): Promise<{ pdf: Buffer; filename: string } | null> {
  // Verify case belongs to company
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return null;

  // Verify letter belongs to case
  const [letter] = await db
    .select()
    .from(acmdLetters)
    .where(and(eq(acmdLetters.id, letterId), eq(acmdLetters.caseId, caseId)))
    .limit(1);

  if (!letter) return null;

  const letterData = letter as AcmdLetter;

  // Get company name for PDF header
  const [company] = await db
    .select()
    .from(acmdCompanies)
    .where(eq(acmdCompanies.id, companyId))
    .limit(1);

  const pdf = await generatePdf({
    companyName: company?.name ?? 'Company',
    letterType: letterData.type,
    content: letterData.content,
    createdAt: letterData.createdAt,
  });

  const filename = `${letterData.type}_letter_${letterData.id.slice(0, 8)}.pdf`;

  return { pdf, filename };
}

// ---------------------------------------------------------------------------
// 5A.4 — Auto-Populate Approval Letter
// ---------------------------------------------------------------------------

/**
 * Auto-populate an approval letter with selected accommodation details.
 * Called when a suggestion is selected and case status is 'review' or 'approved'.
 *
 * Gathers all selected suggestions, builds accommodation details text,
 * generates an approval letter via AI (with fallback), and saves it.
 *
 * @param caseId - The case UUID
 * @param companyId - The company UUID (tenant isolation)
 * @param actorId - The user who triggered the action
 * @returns Created letter or null if case not found / status not eligible
 */
export async function autoPopulateApprovalLetter(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<CreateLetterResult | null> {
  // 1. Verify case belongs to company + check status
  const [case_] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!case_) return null;

  const caseData = case_ as AcmdCase;
  const status = caseData.status as string;

  // Only auto-populate for review or approved cases
  if (status !== 'review' && status !== 'approved') {
    return null;
  }

  // 2. Get all selected suggestions
  const selectedRows = await db
    .select()
    .from(acmdSuggestions)
    .where(
      and(
        eq(acmdSuggestions.caseId, caseId),
        eq(acmdSuggestions.companyId, companyId),
        eq(acmdSuggestions.selected, true),
      ),
    );

  const selectedSuggestions = selectedRows as AcmdSuggestion[];
  if (selectedSuggestions.length === 0) return null;

  // 3. Build accommodation details text
  const accommodationDetails = selectedSuggestions.map((s, i) => {
    const desc = s.customizedDescription ?? s.description ?? 'No description';
    const cost = s.costEstimate ?? 'Not specified';
    const implStatus = s.implementationStatus ?? 'pending';
    return `${i + 1}. ${s.name}\n   Description: ${desc}\n   Cost Estimate: ${cost}\n   Implementation Status: ${implStatus}`;
  }).join('\n\n');

  // 4. Calculate total cost
  let totalCost = 0;
  for (const s of selectedSuggestions) {
    if (s.implementationCost) {
      totalCost += parseFloat(String(s.implementationCost));
    }
  }

  // 5. Get employee + company info
  const [employee] = await db
    .select()
    .from(acmdEmployees)
    .where(eq(acmdEmployees.id, caseData.employeeId))
    .limit(1);

  const [company] = await db
    .select()
    .from(acmdCompanies)
    .where(eq(acmdCompanies.id, companyId))
    .limit(1);

  // 6. Build context with accommodation details
  const approvedAccommodationText = `The following accommodations have been approved:\n\n${accommodationDetails}\n\nTotal Estimated Cost: $${totalCost.toFixed(2)}`;

  const ctx: LetterContext = {
    employeeName: employee?.name ?? 'Employee',
    companyName: company?.name ?? 'Company',
    requestDescription: caseData.requestDescription ?? 'Accommodation request',
    lawType: caseData.type ?? 'ada',
    caseStatus: status,
    approvedAccommodation: approvedAccommodationText,
  };

  // 7. Generate letter via AI (with fallback)
  const result = await generateLetter('approval', ctx);

  // 8. Save to DB
  const [inserted] = await db
    .insert(acmdLetters)
    .values({
      caseId,
      type: 'approval',
      content: result.content,
      status: 'draft',
      createdBy: actorId,
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to insert auto-populated letter');
  }

  // 9. Audit log
  await db.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action: 'letter_generated',
    actorId,
    metadata: {
      event: 'letter_auto_populated',
      letterId: (inserted as AcmdLetter).id,
      letterType: 'approval',
      source: result.source,
      accommodationCount: selectedSuggestions.length,
      totalCost,
    },
    visibility: ['super_admin', 'hr'],
  });

  return {
    letter: inserted as AcmdLetter,
    source: result.source,
  };
}

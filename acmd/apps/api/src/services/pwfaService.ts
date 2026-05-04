/**
 * PWFA Safeguards Service for AccommodateAI — Phase 4E.
 *
 * Implements PWFA-specific protections:
 *   - Interim accommodation tracking (PWFA requires timely interim measures)
 *   - PWFA interim reminder (>5 business days without interim = reminder)
 *   - Leave-forcing validation (42 USC 2000gg-1(4))
 *   - Medical documentation templates (ADA vs PWFA — MUST NOT mix)
 *   - PWFA per se medical doc skip (no medical docs required)
 *   - Business day calculation (Mon-Fri only)
 *
 * LEGAL NOTE: PWFA protects pregnant workers. Mistakes here mean violating
 * their legal rights. Every action is audit-logged for EEOC proceedings.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '@acmd/db';
import { acmdCases } from '@acmd/db';
import { writeAuditLog } from './caseService.js';

// ---------------------------------------------------------------------------
// Medical Documentation Templates
// ---------------------------------------------------------------------------

/**
 * ADA medical documentation template — 7 fields.
 * Standard ADA reasonable accommodation request documentation.
 * Reference: EEOC Enforcement Guidance on Reasonable Accommodation.
 */
export const ADA_TEMPLATE = [
  { field: 'diagnosis', label: 'Nature of Disability/Diagnosis', required: true },
  { field: 'functional_limitations', label: 'Functional Limitations Affecting Job Performance', required: true },
  { field: 'duration', label: 'Expected Duration of Condition', required: true },
  { field: 'treatment_plan', label: 'Current Treatment Plan', required: true },
  { field: 'work_restrictions', label: 'Specific Work Restrictions', required: true },
  { field: 'accommodation_recommendation', label: 'Recommended Accommodations from Provider', required: true },
  { field: 'provider_certification', label: 'Healthcare Provider Certification/Signature', required: true },
];

/**
 * PWFA medical documentation template — 6 fields.
 * PWFA has LIGHTER documentation requirements than ADA.
 * No diagnosis field — PWFA only requires confirmation of known limitation.
 * Reference: 42 USC 2000gg et seq.; 29 CFR 1636.
 */
export const PWFA_TEMPLATE = [
  { field: 'known_limitation', label: 'Known Limitation Related to Pregnancy/Childbirth/Related Condition', required: true },
  { field: 'functional_limitations', label: 'Functional Limitations Affecting Job Performance', required: true },
  { field: 'duration', label: 'Expected Duration of Limitation', required: true },
  { field: 'work_restrictions', label: 'Specific Work Restrictions', required: true },
  { field: 'accommodation_recommendation', label: 'Recommended Accommodations from Provider', required: true },
  { field: 'provider_certification', label: 'Healthcare Provider Certification/Signature', required: true },
];

// ---------------------------------------------------------------------------
// Business Day Calculation
// ---------------------------------------------------------------------------

/**
 * Count business days (Mon-Fri) between two dates, excluding weekends.
 * Does NOT exclude holidays (US federal holidays are variable).
 *
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (exclusive)
 * @returns Number of Mon-Fri days between start and end
 */
export function calculateBusinessDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);
  // Normalize to start of day
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Interim Accommodation
// ---------------------------------------------------------------------------

/**
 * Record that an interim accommodation has been offered for a case.
 * PWFA requires that interim measures be provided while the interactive
 * process is ongoing — this tracks that the employer complied.
 *
 * @param caseId - Case UUID
 * @param companyId - Company UUID (tenant isolation)
 * @param offered - Whether interim accommodation was offered
 * @param description - Description of the interim accommodation offered
 * @param actorId - User who recorded this action
 * @returns Updated case row or null if not found
 */
export async function recordInterimAccommodation(
  caseId: string,
  companyId: string,
  offered: boolean,
  description: string | null,
  actorId: string,
): Promise<typeof acmdCases.$inferSelect | null> {
  const now = new Date();

  // Verify case exists and belongs to company
  const [existing] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!existing) return null;

  // Update case with interim accommodation info
  const [updated] = await db
    .update(acmdCases)
    .set({
      interimAccommodationOffered: offered,
      interimAccommodationDescription: description,
      interimOfferedAt: offered ? now : null,
      updatedAt: now,
    })
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .returning();

  if (!updated) return null;

  // Audit log — EVERY PWFA action must be logged
  await writeAuditLog({
    companyId,
    caseId,
    action: 'pwfa_interim_recorded',
    actorId,
    metadata: {
      offered,
      description,
      recordedAt: now.toISOString(),
    },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Interim Reminder Check
// ---------------------------------------------------------------------------

/**
 * Check if a PWFA case needs an interim accommodation reminder.
 * If the case is type 'pwfa', has been open >5 business days, and
 * no interim accommodation has been offered, returns reminder info.
 *
 * @param caseId - Case UUID
 * @param companyId - Company UUID (tenant isolation)
 * @returns Object with reminderNeeded flag and details, or null if case not found
 */
export async function checkPwfaInterimReminder(
  caseId: string,
  companyId: string,
): Promise<{
  reminderNeeded: boolean;
  businessDaysSinceCreation: number;
  caseType: string;
  interimOffered: boolean;
} | null> {
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) return null;

  const now = new Date();
  const businessDays = calculateBusinessDays(caseRow.createdAt, now);

  const reminderNeeded =
    caseRow.type === 'pwfa'
    && businessDays > 5
    && !caseRow.interimAccommodationOffered;

  return {
    reminderNeeded,
    businessDaysSinceCreation: businessDays,
    caseType: caseRow.type,
    interimOffered: caseRow.interimAccommodationOffered,
  };
}

// ---------------------------------------------------------------------------
// Leave-Forcing Validation
// ---------------------------------------------------------------------------

/**
 * Validate whether a "leave" accommodation complies with PWFA requirements.
 *
 * Under 42 USC 2000gg-1(4), employers CANNOT force an employee to take
 * leave if another reasonable accommodation can be provided. This function
 * checks the safeguard conditions.
 *
 * @returns Object with allowed: boolean, reason: string
 */
export function validateLeaveAccommodation(
  caseType: string,
  accommodation: string,
  leaveConfirmed: boolean,
  alternativesDoc: string | null,
): { allowed: boolean; reason: string } {
  // Only applies to PWFA cases
  if (caseType !== 'pwfa') {
    return { allowed: true, reason: 'Leave-forcing check only applies to PWFA cases' };
  }

  // Check if accommodation mentions "leave"
  if (!/\bleave\b/i.test(accommodation)) {
    return { allowed: true, reason: 'Accommodation does not involve leave' };
  }

  // PWFA leave-forcing block
  if (!leaveConfirmed) {
    return {
      allowed: false,
      reason: 'PWFA 42 USC 2000gg-1(4): Cannot force leave without confirming alternatives were explored',
    };
  }

  if (!alternativesDoc || alternativesDoc.trim().length < 50) {
    return {
      allowed: false,
      reason: 'PWFA 42 USC 2000gg-1(4): alternatives_documented must be at least 50 characters describing explored alternatives',
    };
  }

  return {
    allowed: true,
    reason: 'Leave accommodation approved with documented alternatives per 42 USC 2000gg-1(4)',
  };
}

// ---------------------------------------------------------------------------
// Medical Documentation Template
// ---------------------------------------------------------------------------

/**
 * Get the appropriate medical documentation template for a case.
 *
 * Rules:
 *   - ADA cases use ADA_TEMPLATE (7 fields)
 *   - PWFA cases use PWFA_TEMPLATE (6 fields) — ADA template MUST NOT be used
 *   - PWFA per se cases skip medical docs entirely (legally required)
 *
 * @param caseType - 'ada' | 'pwfa' | 'state_law' | 'multiple'
 * @param pwfaPerSe - Whether the case is a PWFA per se accommodation
 * @param perSeItems - Matched per se categories (water, bathroom, sit/stand, eat)
 * @returns Template object with fields array, or skip indicator for per se
 * @throws Error if ADA template is requested for a PWFA case
 */
export function getMedicalDocTemplate(
  caseType: string,
  pwfaPerSe: boolean,
  perSeItems: string[] = [],
): {
  template: typeof ADA_TEMPLATE | typeof PWFA_TEMPLATE;
  required: boolean;
  reason: string;
  fieldCount: number;
} {
  // PWFA per se: skip medical docs entirely
  if (caseType === 'pwfa' && (pwfaPerSe || perSeItems.length > 0)) {
    return {
      template: PWFA_TEMPLATE,
      required: false,
      reason: `PWFA per se accommodation (${perSeItems.length > 0 ? perSeItems.join(', ') : 'flagged'}): medical documentation is not required. 29 CFR 1636.3(j)(4) — predictable assessments.`,
      fieldCount: PWFA_TEMPLATE.length,
    };
  }

  // PWFA case: use PWFA template (NOT ADA template)
  if (caseType === 'pwfa') {
    return {
      template: PWFA_TEMPLATE,
      required: true,
      reason: 'PWFA case: using PWFA-specific template (6 fields). ADA template must not be used for PWFA cases.',
      fieldCount: PWFA_TEMPLATE.length,
    };
  }

  // ADA / state_law / multiple: use ADA template
  return {
    template: ADA_TEMPLATE,
    required: true,
    reason: 'ADA/state_law case: using standard ADA medical documentation template (7 fields).',
    fieldCount: ADA_TEMPLATE.length,
  };
}

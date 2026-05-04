/**
 * AI Consent Service for AccommodateAI.
 *
 * Manages employee consent for AI processing of accommodation data.
 * Illinois HB 3773 requires consent BEFORE AI processes medical/accommodation data.
 *
 * SECURITY:
 *   - Consent is REQUIRED before AI processes any case data
 *   - Declining consent has ZERO adverse effect on the accommodation request
 *   - Every consent action (given, declined, revoked) is audit logged
 *   - Manual fallback path available when consent is declined
 */

import { eq, and } from 'drizzle-orm';
import {
  db,
  acmdCases,
  acmdAuditLogs,
  acmdSuggestions,
} from '@acmd/db';
import type { AcmdCase, AcmdSuggestion } from '@acmd/db';
import type { DbOrTx } from './caseService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentInput {
  caseId: string;
  companyId: string;
  consentGiven: boolean;
  consentMethod: 'web_form' | 'paper_form' | 'verbal_recorded' | 'email';
  actorId: string;
}

export interface ConsentStatus {
  required: true;
  given: boolean;
  timestamp: Date | null;
}

export interface ManualClassifyInput {
  caseId: string;
  companyId: string;
  type: 'ada' | 'pwfa' | 'state_law' | 'multiple';
  reason: string;
  actorId: string;
}

export interface ManualSuggestionInput {
  name: string;
  // Optional — Zod schema in routes/cases.ts uses .optional(), and
  // addManualSuggestions() already normalizes undefined -> null before insert.
  description?: string;
  costEstimate?: string;
  costRange?: 'no_cost' | 'low' | 'moderate' | 'high';
  effectiveness?: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Audit Log Helper (local — uses audit action types available in enum)
// ---------------------------------------------------------------------------

async function writeConsentAuditLog(
  companyId: string,
  caseId: string,
  action: 'ai_consent_given' | 'ai_consent_declined' | 'case_updated' | 'case_classified',
  actorId: string,
  metadata: Record<string, unknown>,
  txDb: DbOrTx = db,
): Promise<void> {
  await txDb.insert(acmdAuditLogs).values({
    companyId,
    caseId,
    action,
    actorId,
    metadata,
  });
}

// ---------------------------------------------------------------------------
// Record Consent
// ---------------------------------------------------------------------------

/**
 * Record AI consent decision for a case.
 * Updates aiConsentGiven + aiConsentTimestamp on the case + writes audit log.
 *
 * @throws Error if case not found
 */
export async function recordConsent(input: ConsentInput): Promise<AcmdCase> {
  const { caseId, companyId, consentGiven, consentMethod, actorId } = input;

  // Verify case exists and belongs to company
  const [existing] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!existing) {
    throw new Error('Case not found');
  }

  const now = new Date();

  // Transaction: update case + audit log (atomic)
  const updated = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(acmdCases)
      .set({
        aiConsentGiven: consentGiven,
        aiConsentTimestamp: now,
        updatedAt: now,
      })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
      .returning();

    if (!updatedRow) {
      throw new Error('Case not found');
    }

    // Audit log — use correct action based on consent decision
    const auditAction = consentGiven ? 'ai_consent_given' : 'ai_consent_declined';
    await writeConsentAuditLog(
      companyId,
      caseId,
      auditAction,
      actorId,
      {
        event: consentGiven ? 'consent_given' : 'consent_declined',
        consent_method: consentMethod,
        consent_given: consentGiven,
        timestamp: now.toISOString(),
      },
      tx,
    );

    return updatedRow;
  });

  return updated as AcmdCase;
}

// ---------------------------------------------------------------------------
// Revoke Consent
// ---------------------------------------------------------------------------

/**
 * Revoke previously given AI consent for a case.
 * Sets aiConsentGiven=false + writes audit log.
 * Existing AI results (classification, suggestions) are preserved.
 * New AI processing is blocked.
 *
 * @throws Error if case not found
 */
export async function revokeConsent(
  caseId: string,
  companyId: string,
  actorId: string,
): Promise<AcmdCase> {
  // Verify case exists and belongs to company
  const [existing] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!existing) {
    throw new Error('Case not found');
  }

  const now = new Date();

  // Transaction: update case + audit log (atomic)
  const updated = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(acmdCases)
      .set({
        aiConsentGiven: false,
        aiConsentTimestamp: now,
        updatedAt: now,
      })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
      .returning();

    if (!updatedRow) {
      throw new Error('Case not found');
    }

    // Use ai_consent_declined for revocation — differentiate via metadata
    await writeConsentAuditLog(
      companyId,
      caseId,
      'ai_consent_declined',
      actorId,
      {
        event: 'consent_revoked',
        previous_consent: (existing as AcmdCase).aiConsentGiven,
        timestamp: now.toISOString(),
      },
      tx,
    );

    return updatedRow;
  });

  return updated as AcmdCase;
}

// ---------------------------------------------------------------------------
// Check Consent Status
// ---------------------------------------------------------------------------

/**
 * Check AI consent status for a case.
 * Returns { required: true, given: boolean, timestamp }.
 */
export async function checkConsentRequired(
  caseId: string,
  companyId: string,
): Promise<ConsentStatus | null> {
  const [row] = await db
    .select({
      aiConsentGiven: acmdCases.aiConsentGiven,
      aiConsentTimestamp: acmdCases.aiConsentTimestamp,
    })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!row) return null;

  return {
    required: true,
    given: row.aiConsentGiven,
    timestamp: row.aiConsentTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Manual Classification (without AI)
// ---------------------------------------------------------------------------

/**
 * Manually classify a case type without invoking AI.
 * Used when employee declines AI consent.
 *
 * @throws Error if case not found
 */
export async function manualClassify(input: ManualClassifyInput): Promise<AcmdCase> {
  const { caseId, companyId, type, reason, actorId } = input;

  // Verify case exists and belongs to company
  const [existing] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!existing) {
    throw new Error('Case not found');
  }

  const now = new Date();

  // Transaction: update case type + audit log (atomic)
  const updated = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(acmdCases)
      .set({
        type,
        updatedAt: now,
      })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
      .returning();

    if (!updatedRow) {
      throw new Error('Case not found');
    }

    await writeConsentAuditLog(
      companyId,
      caseId,
      'case_classified',
      actorId,
      {
        event: 'manual_classification',
        type,
        reason,
        source: 'manual_hr',
      },
      tx,
    );

    return updatedRow;
  });

  return updated as AcmdCase;
}

// ---------------------------------------------------------------------------
// Manual Suggestions (without AI)
// ---------------------------------------------------------------------------

/**
 * Add manual accommodation suggestions to a case.
 * Used when employee declines AI consent — HR adds suggestions manually.
 * All suggestions are inserted with source='manual_hr'.
 *
 * @throws Error if case not found
 */
export async function addManualSuggestions(
  caseId: string,
  companyId: string,
  suggestions: ManualSuggestionInput[],
  actorId: string,
): Promise<AcmdSuggestion[]> {
  // Verify case exists and belongs to company
  const [existing] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!existing) {
    throw new Error('Case not found');
  }

  if (!suggestions || suggestions.length === 0) {
    throw new Error('At least one suggestion is required');
  }

  const insertData = suggestions.map((s) => ({
    caseId,
    companyId,
    name: s.name,
    description: s.description ?? null,
    costEstimate: s.costEstimate ?? null,
    costRange: s.costRange ?? null,
    effectiveness: s.effectiveness ?? null,
    source: 'manual_hr',
    selected: false,
  }));

  const inserted = await db
    .insert(acmdSuggestions)
    .values(insertData)
    .returning();

  // Audit log
  // SEC-008 (ACMD-118-B): CCPA data minimization — do NOT persist raw
  // suggestion names in the audit log `detail` JSONB. HR-entered names may
  // contain PII (employee identifiers, medical context, free-text notes).
  // Store opaque DB IDs instead; forensic trails can still join back to
  // `acmd_suggestions` via the IDs when legitimately required.
  await writeConsentAuditLog(
    companyId,
    caseId,
    'case_updated',
    actorId,
    {
      event: 'manual_suggestions_added',
      count: inserted.length,
      source: 'manual_hr',
      suggestion_ids: (inserted as AcmdSuggestion[]).map((s) => s.id),
    },
  );

  return inserted as AcmdSuggestion[];
}

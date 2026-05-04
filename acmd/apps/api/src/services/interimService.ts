/**
 * Interim Accommodation Service for AccommodateAI — Phase 7B.
 *
 * Provides GET and PATCH operations for interim accommodation management.
 * Uses existing acmd_cases columns (interimAccommodationOffered,
 * interimAccommodationDescription, interimOfferedAt) — no schema changes.
 *
 * Status derivation (no new column):
 *   - ended: audit log has pwfa_interim_recorded with metadata.subAction = 'end'
 *   - converted: case status = 'active' AND audit log has pwfa_interim_recorded
 *                with metadata.subAction = 'convert'
 *   - active: interim offered but neither ended nor converted
 *
 * LEGAL NOTE: PWFA interim accommodations are legally required while the
 * interactive process is ongoing. Every action is audit-logged.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdCases,
  acmdAuditLogs,
} from '@acmd/db';
import { writeAuditLog } from './caseService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterimStatus {
  offered: boolean;
  description: string | null;
  offeredAt: string | null;
  status: 'active' | 'ended' | 'converted';
  endedAt: string | null;
  endReason: string | null;
}

export interface GetInterimResult {
  hasInterim: boolean;
  interim: InterimStatus | null;
}

export type PatchInterimAction = 'end' | 'convert' | 'update_description';

export interface PatchInterimInput {
  action: PatchInterimAction;
  description?: string | null;
  reason?: string | null;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * Get the current interim accommodation status for a case.
 *
 * @param caseId - Case UUID
 * @param companyId - Company UUID (tenant isolation)
 * @returns GetInterimResult or null if case not found
 */
export async function getInterimAccommodation(
  caseId: string,
  companyId: string,
): Promise<GetInterimResult | null> {
  const [caseRow] = await db
    .select({
      id: acmdCases.id,
      companyId: acmdCases.companyId,
      interimAccommodationOffered: acmdCases.interimAccommodationOffered,
      interimAccommodationDescription: acmdCases.interimAccommodationDescription,
      interimOfferedAt: acmdCases.interimOfferedAt,
      status: acmdCases.status,
    })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) return null;

  // No interim offered
  if (!caseRow.interimAccommodationOffered) {
    return { hasInterim: false, interim: null };
  }

  // Interim offered — derive status from audit log
  const auditRows = await db
    .select()
    .from(acmdAuditLogs)
    .where(
      and(
        eq(acmdAuditLogs.caseId, caseId),
        eq(acmdAuditLogs.action, 'pwfa_interim_recorded'),
      ),
    )
    .orderBy(desc(acmdAuditLogs.createdAt));

  // Find end or convert action in audit logs
  let status: 'active' | 'ended' | 'converted' = 'active';
  let endedAt: string | null = null;
  let endReason: string | null = null;

  for (const row of auditRows) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    if (meta.subAction === 'end') {
      status = 'ended';
      endedAt = row.createdAt.toISOString();
      endReason = typeof meta.reason === 'string' ? meta.reason : null;
      break;
    }

    if (meta.subAction === 'convert') {
      status = 'converted';
      endedAt = row.createdAt.toISOString();
      endReason = null;
      break;
    }
  }

  return {
    hasInterim: true,
    interim: {
      offered: caseRow.interimAccommodationOffered,
      description: caseRow.interimAccommodationDescription ?? null,
      offeredAt: caseRow.interimOfferedAt?.toISOString() ?? null,
      status,
      endedAt,
      endReason,
    },
  };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

/**
 * Apply an action to an interim accommodation.
 *
 * Actions:
 *   - end: marks interim as ended via audit log
 *   - convert: transitions case status from implementation → active
 *   - update_description: updates interimAccommodationDescription
 *
 * All actions write an audit log entry.
 *
 * @param caseId - Case UUID
 * @param companyId - Company UUID (tenant isolation)
 * @param input - Action + optional description/reason
 * @param actorId - User performing the action
 * @returns Updated GetInterimResult or null if case not found
 */
export async function patchInterimAccommodation(
  caseId: string,
  companyId: string,
  input: PatchInterimInput,
  actorId: string,
): Promise<GetInterimResult | null> {
  const now = new Date();

  // Verify case exists and belongs to company
  const [caseRow] = await db
    .select({
      id: acmdCases.id,
      companyId: acmdCases.companyId,
      status: acmdCases.status,
      interimAccommodationOffered: acmdCases.interimAccommodationOffered,
      interimAccommodationDescription: acmdCases.interimAccommodationDescription,
    })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) return null;

  if (input.action === 'end') {
    // Mark interim as ended via audit log (no schema change needed)
    await writeAuditLog({
      companyId,
      caseId,
      action: 'pwfa_interim_recorded',
      actorId,
      metadata: {
        subAction: 'end',
        reason: input.reason ?? null,
        endedAt: now.toISOString(),
      },
    });

    // Also update updatedAt on case
    await db
      .update(acmdCases)
      .set({ updatedAt: now })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)));

  } else if (input.action === 'convert') {
    // Convert: transition case from implementation → active
    // This means interim became the full/permanent accommodation
    await db
      .update(acmdCases)
      .set({ status: 'active', updatedAt: now })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)));

    await writeAuditLog({
      companyId,
      caseId,
      action: 'pwfa_interim_recorded',
      actorId,
      metadata: {
        subAction: 'convert',
        fromStatus: caseRow.status,
        toStatus: 'active',
        convertedAt: now.toISOString(),
      },
    });

  } else if (input.action === 'update_description') {
    // Update description only
    const sanitized = input.description ?? caseRow.interimAccommodationDescription ?? null;

    await db
      .update(acmdCases)
      .set({
        interimAccommodationDescription: sanitized,
        updatedAt: now,
      })
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)));

    await writeAuditLog({
      companyId,
      caseId,
      action: 'pwfa_interim_recorded',
      actorId,
      metadata: {
        subAction: 'update_description',
        description: sanitized,
        updatedAt: now.toISOString(),
      },
    });
  }

  // Return updated state
  return getInterimAccommodation(caseId, companyId);
}

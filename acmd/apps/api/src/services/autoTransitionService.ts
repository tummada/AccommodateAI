/**
 * Auto-Transition Service for AccommodateAI — Phase 5B.
 *
 * Centralized auto-status transition logic. Handles 4 triggers:
 *   1. checklist_complete → status to 'review' (if allowed)
 *   2. medical_docs_received → status to 'interactive_process' (from awaiting_medical)
 *   3. manager_input_received → status to 'interactive_process' (from awaiting_input)
 *   4. pwfa_fast_track → status to 'review' (PWFA per se match)
 *
 * SECURITY:
 *   - All queries scoped by companyId (tenant isolation)
 *   - All transitions use VALID_STATUS_TRANSITIONS guard
 *   - All transitions run in DB transactions (race condition prevention)
 *   - All transitions write audit logs
 *   - All transitions create notifications for assigned HR
 *
 * RACE CONDITION PREVENTION:
 *   Every auto-transition re-fetches the case status INSIDE the transaction
 *   before updating. This prevents double-transitions from concurrent requests.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdCases,
  acmdChecklistItems,
  acmdNotifications,
} from '@acmd/db';
import {
  validateStatusTransition,
  writeAuditLog,
} from './caseService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoTransitionTrigger =
  | 'checklist_complete'
  | 'medical_docs_received'
  | 'manager_input_received'
  | 'pwfa_fast_track';

export interface AutoTransitionResult {
  transitioned: boolean;
  fromStatus: string;
  toStatus: string | null;
  trigger: AutoTransitionTrigger;
  reason: string;
}

// ---------------------------------------------------------------------------
// Trigger → Target Status Mapping
// ---------------------------------------------------------------------------

/**
 * Determine target status for a given trigger and current status.
 * Returns null if no auto-transition should occur.
 */
function getTargetStatus(
  trigger: AutoTransitionTrigger,
  currentStatus: string,
): string | null {
  switch (trigger) {
    case 'checklist_complete':
      // Checklist complete → review (from any status that allows it)
      return 'review';

    case 'medical_docs_received':
      // Medical docs → interactive_process (only from awaiting_medical)
      if (currentStatus === 'awaiting_medical') return 'interactive_process';
      return null;

    case 'manager_input_received':
      // Manager input → interactive_process (only from awaiting_input)
      if (currentStatus === 'awaiting_input') return 'interactive_process';
      return null;

    case 'pwfa_fast_track':
      // PWFA per se → review
      return 'review';

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Trigger-Specific Precondition Checks
// ---------------------------------------------------------------------------

/**
 * For checklist_complete trigger: verify all REQUIRED checklist items are complete.
 * Returns true if all required items are completed, false otherwise.
 */
async function verifyChecklistComplete(
  caseId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txDb: any,
): Promise<boolean> {
  const items = await txDb
    .select()
    .from(acmdChecklistItems)
    .where(eq(acmdChecklistItems.caseId, caseId));

  if (items.length === 0) return false;

  // Only check required items
  const requiredItems = items.filter((i: { required: boolean }) => i.required);
  if (requiredItems.length === 0) return true; // No required items = vacuously complete

  return requiredItems.every(
    (i: { completedAt: Date | null }) => i.completedAt !== null,
  );
}

// ---------------------------------------------------------------------------
// Notification Messages
// ---------------------------------------------------------------------------

function getNotificationMessage(
  trigger: AutoTransitionTrigger,
  toStatus: string,
): { title: string; body: string } {
  switch (trigger) {
    case 'checklist_complete':
      return {
        title: 'Checklist complete — case ready for review',
        body: 'All required checklist items have been completed. The case has been automatically moved to review status.',
      };
    case 'medical_docs_received':
      return {
        title: 'Medical documents received',
        body: 'Medical documentation has been received. The case has been automatically moved back to interactive process.',
      };
    case 'manager_input_received':
      return {
        title: 'Manager input received',
        body: 'Manager has submitted operational input. The case has been automatically moved back to interactive process.',
      };
    case 'pwfa_fast_track':
      return {
        title: 'PWFA fast-track — case ready for review',
        body: 'This case qualifies for PWFA predictable assessment fast-track (§ 1636.3(j)). The case has been automatically moved to review status.',
      };
    default:
      return {
        title: `Case auto-transitioned to ${toStatus}`,
        body: `Case status has been automatically updated to ${toStatus}.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Core: tryAutoTransition
// ---------------------------------------------------------------------------

/**
 * Attempt an auto-status transition for a case.
 *
 * All logic runs inside a DB transaction to prevent race conditions:
 *   1. Re-fetch case status inside transaction
 *   2. Validate transition is allowed
 *   3. Check trigger-specific preconditions
 *   4. Update case status
 *   5. Write audit log
 *   6. Create notification
 *
 * @param caseId - Case UUID
 * @param companyId - Company UUID (tenant isolation)
 * @param trigger - What caused the auto-transition attempt
 * @param actorId - User who triggered the action
 * @param metadata - Optional additional metadata for audit log
 * @returns AutoTransitionResult indicating whether transition occurred
 */
export async function tryAutoTransition(
  caseId: string,
  companyId: string,
  trigger: AutoTransitionTrigger,
  actorId: string,
  metadata?: Record<string, unknown>,
): Promise<AutoTransitionResult> {
  return db.transaction(async (tx) => {
    // Step 1: Re-fetch case INSIDE transaction (race condition guard)
    const [caseRow] = await tx
      .select()
      .from(acmdCases)
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
      .limit(1);

    if (!caseRow) {
      return {
        transitioned: false,
        fromStatus: 'unknown',
        toStatus: null,
        trigger,
        reason: 'Case not found',
      };
    }

    const currentStatus = caseRow.status;

    // Step 2: Determine target status
    const targetStatus = getTargetStatus(trigger, currentStatus);

    if (!targetStatus) {
      console.warn(
        `[AutoTransition] No target status for trigger=${trigger} currentStatus=${currentStatus} caseId=${caseId}`,
      );
      return {
        transitioned: false,
        fromStatus: currentStatus,
        toStatus: null,
        trigger,
        reason: `No auto-transition defined for trigger '${trigger}' from status '${currentStatus}'`,
      };
    }

    // Step 3: Validate transition via VALID_STATUS_TRANSITIONS
    const transitionError = validateStatusTransition(currentStatus, targetStatus);
    if (transitionError) {
      console.warn(
        `[AutoTransition] Invalid transition: ${transitionError} (trigger=${trigger} caseId=${caseId})`,
      );
      return {
        transitioned: false,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        trigger,
        reason: transitionError,
      };
    }

    // Step 4: Trigger-specific precondition checks
    if (trigger === 'checklist_complete') {
      const allComplete = await verifyChecklistComplete(caseId, tx);
      if (!allComplete) {
        return {
          transitioned: false,
          fromStatus: currentStatus,
          toStatus: targetStatus,
          trigger,
          reason: 'Not all required checklist items are complete',
        };
      }
    }

    // Step 5: Update case status
    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: now,
    };

    // For PWFA fast-track: also set pwfa_fast_track flag
    if (trigger === 'pwfa_fast_track') {
      updateData['pwfaPerSe'] = true;
    }

    await tx
      .update(acmdCases)
      .set(updateData)
      .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)));

    // Step 6: Write audit log
    // Explicit literal-union annotation (no `as` cast) — if the action
    // union in `writeAuditLog` changes and drops either literal, tsc will
    // surface the mismatch here rather than silently coercing.
    const auditAction: Parameters<typeof writeAuditLog>[0]['action'] =
      trigger === 'pwfa_fast_track'
        ? 'pwfa_fast_track_approved'
        : 'auto_status_transition';

    await writeAuditLog(
      {
        companyId,
        caseId,
        action: auditAction,
        actorId,
        metadata: {
          from: currentStatus,
          to: targetStatus,
          trigger,
          auto: true,
          ...metadata,
        },
      },
      tx,
    );

    // Step 7: Create notification for assigned HR
    const notifyUserId = caseRow.assignedTo ?? actorId;
    const { title, body } = getNotificationMessage(trigger, targetStatus);

    await tx.insert(acmdNotifications).values({
      companyId,
      userId: notifyUserId,
      type: 'case_status_changed',
      title,
      body,
      caseId,
    });

    return {
      transitioned: true,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      trigger,
      reason: `Auto-transitioned from '${currentStatus}' to '${targetStatus}' (trigger: ${trigger})`,
    };
  });
}

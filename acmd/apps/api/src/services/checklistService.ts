/**
 * Checklist Service for AccommodateAI.
 *
 * Handles:
 *   - Listing checklist items for a case (scoped to company)
 *   - Toggling checklist item completion (set/clear completed_at + completed_by)
 *   - Detecting all-items-complete → create notification
 *   - Audit logging on completion
 *
 * SECURITY:
 *   - All queries scoped to company via case.companyId check
 *   - Toggle requires case ownership verification
 */

import { eq, and, asc } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdChecklistItems,
  acmdCases,
  acmdNotifications,
  type AcmdChecklistItem,
} from '@acmd/db';
import { writeAuditLog } from './caseService.js';
import { tryAutoTransition } from './autoTransitionService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToggleResult {
  item: AcmdChecklistItem;
  allComplete: boolean;
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

/**
 * Get all checklist items for a case, sorted by step_order.
 * Verifies that the case belongs to the specified company.
 *
 * @returns checklist items array, or null if case not found / wrong company
 */
export async function getChecklistItems(
  caseId: string,
  companyId: string,
): Promise<AcmdChecklistItem[] | null> {
  // Verify case belongs to company
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) return null;

  const items = await db
    .select()
    .from(acmdChecklistItems)
    .where(eq(acmdChecklistItems.caseId, caseId))
    .orderBy(asc(acmdChecklistItems.stepOrder));

  return items as AcmdChecklistItem[];
}

// ---------------------------------------------------------------------------
// TOGGLE
// ---------------------------------------------------------------------------

/**
 * Toggle a checklist item's completion status.
 * - If not completed → set completed_at = now(), completed_by = userId
 * - If completed → clear completed_at and completed_by
 *
 * After toggle, checks if ALL items are complete. If so, creates a notification.
 *
 * @returns ToggleResult with updated item + allComplete flag, or null if not found
 */
export async function toggleChecklistItem(
  caseId: string,
  itemId: string,
  companyId: string,
  userId: string,
): Promise<ToggleResult | null> {
  // Verify case belongs to company
  const [caseRow] = await db
    .select()
    .from(acmdCases)
    .where(and(eq(acmdCases.id, caseId), eq(acmdCases.companyId, companyId)))
    .limit(1);

  if (!caseRow) return null;

  // Fetch the checklist item — verify it belongs to this case
  const [item] = await db
    .select()
    .from(acmdChecklistItems)
    .where(
      and(
        eq(acmdChecklistItems.id, itemId),
        eq(acmdChecklistItems.caseId, caseId),
      ),
    )
    .limit(1);

  if (!item) return null;

  // Toggle: if completed → uncomplete, if not completed → complete
  const isCurrentlyCompleted = item.completedAt !== null;

  const updateData = isCurrentlyCompleted
    ? { completed: false, completedAt: null, completedBy: null }
    : { completed: true, completedAt: new Date(), completedBy: userId };

  const [updated] = await db
    .update(acmdChecklistItems)
    .set(updateData)
    .where(eq(acmdChecklistItems.id, itemId))
    .returning();

  if (!updated) return null;

  // Audit log for completion (only when completing, not uncompleting)
  if (!isCurrentlyCompleted) {
    await writeAuditLog({
      companyId,
      caseId,
      action: 'checklist_completed',
      actorId: userId,
      metadata: {
        itemId,
        stepName: item.stepName,
        stepOrder: item.stepOrder,
      },
    });
  }

  // Check if ALL items are now complete
  const allItems = await db
    .select()
    .from(acmdChecklistItems)
    .where(eq(acmdChecklistItems.caseId, caseId));

  const allCompleteCheck =
    allItems.length > 0 &&
    allItems.every((i) => {
      if (i.id === itemId) {
        // This item was just toggled
        return !isCurrentlyCompleted; // true if we just completed it
      }
      return i.completedAt !== null;
    });

  if (allCompleteCheck && !isCurrentlyCompleted) {
    // All items complete — create notification
    await db.insert(acmdNotifications).values({
      companyId,
      userId,
      type: 'checklist_all_complete',
      title: 'Interactive Process completed',
      body: `All checklist items for case have been completed.`,
      caseId,
    });

    // Phase 5B: Auto-transition to review when all required items complete
    await tryAutoTransition(caseId, companyId, 'checklist_complete', userId);
  }

  return {
    item: updated as AcmdChecklistItem,
    allComplete: allCompleteCheck && !isCurrentlyCompleted,
  };
}

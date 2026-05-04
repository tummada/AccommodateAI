/**
 * Deadline Alert Service for AccommodateAI.
 *
 * Scans all open/in_progress cases and creates alerts for:
 *   - 3 business days before deadline → notification to assignee
 *   - Past deadline → notification to assignee + all admins + audit_log "deadline_missed"
 *
 * Duplicate prevention: checks existing notifications by type + caseId
 * before creating new ones.
 *
 * Designed to be called by a cron job or manual admin trigger.
 */

import { eq, and, or, isNotNull, sql, isNull } from 'drizzle-orm';
import { db } from '@acmd/db';
import {
  acmdCases,
  acmdUsers,
  acmdNotifications,
  acmdAuditLogs,
} from '@acmd/db';
import { addBusinessDays } from './checklistGenerator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadlineCheckResult {
  warningsSent: number;
  overdueAlertsSent: number;
  casesChecked: number;
}

// ---------------------------------------------------------------------------
// Business Day Helpers
// ---------------------------------------------------------------------------

/**
 * Subtract N business days (Mon-Fri) from a date.
 * Used to determine "3 business days before deadline" threshold.
 */
export function subtractBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let subtracted = 0;

  while (subtracted < days) {
    result.setDate(result.getDate() - 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      subtracted++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Duplicate Check
// ---------------------------------------------------------------------------

/**
 * Check if a notification of a given type already exists for a case + user.
 */
async function notificationExists(
  companyId: string,
  userId: string,
  caseId: string,
  type: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: acmdNotifications.id })
    .from(acmdNotifications)
    .where(
      and(
        eq(acmdNotifications.companyId, companyId),
        eq(acmdNotifications.userId, userId),
        eq(acmdNotifications.caseId, caseId),
        eq(acmdNotifications.type, type),
      ),
    )
    .limit(1);

  return !!existing;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Check all active cases for approaching or missed deadlines.
 * Creates notifications and audit logs as needed.
 *
 * @param now - Override "now" for testing (defaults to new Date())
 * @returns Summary of alerts created
 */
export async function checkDeadlines(
  companyId: string,
  now?: Date,
): Promise<DeadlineCheckResult> {
  const currentDate = now ?? new Date();
  let warningsSent = 0;
  let overdueAlertsSent = 0;

  // Fetch active cases (intake/interactive_process/awaiting_*/review/implementation) with a deadline set — scoped to company
  const cases = await db
    .select()
    .from(acmdCases)
    .where(
      and(
        eq(acmdCases.companyId, companyId),
        or(
          eq(acmdCases.status, 'intake'),
          eq(acmdCases.status, 'interactive_process'),
          eq(acmdCases.status, 'awaiting_medical'),
          eq(acmdCases.status, 'awaiting_input'),
          eq(acmdCases.status, 'review'),
          eq(acmdCases.status, 'implementation'),
          eq(acmdCases.status, 'active'),
        ),
        isNotNull(acmdCases.deadline),
        isNull(acmdCases.deletedAt),
      ),
    );

  for (const caseRow of cases) {
    if (!caseRow.deadline) continue;

    const deadline = new Date(caseRow.deadline);
    const warningDate = subtractBusinessDays(deadline, 3);

    // Determine the assignee (assignedTo or fallback: no notification if no assignee)
    const assigneeId = caseRow.assignedTo;

    // --- OVERDUE: past deadline ---
    if (currentDate > deadline) {
      // Notify assignee (if exists and not already notified)
      if (assigneeId) {
        const alreadyNotified = await notificationExists(
          caseRow.companyId,
          assigneeId,
          caseRow.id,
          'deadline_overdue',
        );
        if (!alreadyNotified) {
          await db.insert(acmdNotifications).values({
            companyId: caseRow.companyId,
            userId: assigneeId,
            type: 'deadline_overdue',
            title: 'Case deadline missed',
            body: `Case deadline was ${deadline.toISOString().split('T')[0]}. Immediate action required.`,
            caseId: caseRow.id,
          });
          overdueAlertsSent++;
        }
      }

      // Notify ALL super_admins in the company
      const admins = await db
        .select()
        .from(acmdUsers)
        .where(
          and(
            eq(acmdUsers.companyId, caseRow.companyId),
            eq(acmdUsers.role, 'super_admin'),
            isNull(acmdUsers.deletedAt),
          ),
        );

      for (const admin of admins) {
        // Skip if admin is the assignee (already notified above)
        if (admin.id === assigneeId) continue;

        const alreadyNotified = await notificationExists(
          caseRow.companyId,
          admin.id,
          caseRow.id,
          'deadline_overdue',
        );
        if (!alreadyNotified) {
          await db.insert(acmdNotifications).values({
            companyId: caseRow.companyId,
            userId: admin.id,
            type: 'deadline_overdue',
            title: 'Case deadline missed',
            body: `Case deadline was ${deadline.toISOString().split('T')[0]}. Immediate action required.`,
            caseId: caseRow.id,
          });
          overdueAlertsSent++;
        }
      }

      // Audit log for deadline missed (once per case — use system actor)
      const auditExists = await db
        .select({ id: acmdAuditLogs.id })
        .from(acmdAuditLogs)
        .where(
          and(
            eq(acmdAuditLogs.caseId, caseRow.id),
            eq(acmdAuditLogs.action, 'deadline_missed'),
          ),
        )
        .limit(1);

      if (!auditExists[0]) {
        await db.insert(acmdAuditLogs).values({
          companyId: caseRow.companyId,
          caseId: caseRow.id,
          action: 'deadline_missed',
          actorId: assigneeId ?? null,
          metadata: {
            deadline: deadline.toISOString(),
            detectedAt: currentDate.toISOString(),
          },
        });
      }
    }
    // --- WARNING: within 3 business days ---
    else if (currentDate >= warningDate) {
      if (assigneeId) {
        const alreadyNotified = await notificationExists(
          caseRow.companyId,
          assigneeId,
          caseRow.id,
          'deadline_warning',
        );
        if (!alreadyNotified) {
          await db.insert(acmdNotifications).values({
            companyId: caseRow.companyId,
            userId: assigneeId,
            type: 'deadline_warning',
            title: 'Case deadline approaching',
            body: `Case deadline is ${deadline.toISOString().split('T')[0]}. Please take action soon.`,
            caseId: caseRow.id,
          });
          warningsSent++;
        }
      }
    }
  }

  return {
    warningsSent,
    overdueAlertsSent,
    casesChecked: cases.length,
  };
}

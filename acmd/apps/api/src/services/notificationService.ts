/**
 * Notification Service for AccommodateAI.
 *
 * Handles in-app notification creation, role-based content filtering,
 * and email stub infrastructure.
 *
 * 16 event types are supported — content varies by recipient role:
 *   - manager: generic (no medical info, no diagnosis, no AI details)
 *   - hr / super_admin: detailed
 *
 * Email sending is a stub in Phase 3 — logs + sets emailSent=true.
 * Real SMTP integration is planned for Phase 4.
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@acmd/db';
import { acmdNotifications, acmdUsers } from '@acmd/db';
import type { AcmdNotificationPriority } from '@acmd/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationEventType =
  | 'case_created'
  | 'case_assigned'
  | 'case_reassigned'
  | 'case_status_changed'
  | 'checklist_completed'
  | 'medical_docs_uploaded'
  | 'deadline_approaching'
  | 'deadline_urgent'
  | 'deadline_final_warning'
  | 'deadline_overdue'
  | 'case_unacknowledged'
  | 'accommodation_approved'
  | 'accommodation_denied'
  | 'letter_generated'
  | 'case_closed'
  | 'deadline_early_reminder';

export type NotificationRole = 'super_admin' | 'hr' | 'manager';

export interface NotificationContent {
  title: string;
  body: string;
}

export interface CaseData {
  caseNumber?: string;
  id?: string;
  employeeName?: string;
  deadline?: string;
  status?: string;
  notes?: string;
}

export interface CreateNotificationParams {
  userId: string;
  companyId: string;
  type: NotificationEventType;
  title: string;
  body?: string;
  caseId?: string;
  priority?: AcmdNotificationPriority;
}

export interface CreateNotificationsForRoleParams {
  companyId: string;
  role: NotificationRole;
  type: NotificationEventType;
  caseId?: string;
  caseData?: CaseData;
}

// ---------------------------------------------------------------------------
// Role-Based Content
// ---------------------------------------------------------------------------

/**
 * Returns notification title + body for a given event type and recipient role.
 *
 * Manager role receives generic content only — no medical info, no diagnosis,
 * no AI classification details (ADA compliance: need-to-know basis).
 *
 * HR / super_admin receive detailed content.
 */
export function getNotificationContent(
  type: NotificationEventType,
  role: NotificationRole,
  caseData?: CaseData,
): NotificationContent {
  const caseRef = caseData?.caseNumber
    ? `Case #${caseData.caseNumber}`
    : caseData?.id
    ? `Case ${caseData.id.slice(0, 8)}`
    : 'A case';

  const isManager = role === 'manager';

  switch (type) {
    case 'case_created':
      return isManager
        ? { title: 'New case submitted', body: `${caseRef} has been submitted and is awaiting review.` }
        : { title: 'New accommodation case created', body: `${caseRef} has been created and needs HR assignment.` };

    case 'case_assigned':
      return isManager
        ? { title: `${caseRef} has been assigned`, body: `${caseRef} has been assigned to an HR representative.` }
        : { title: `You have been assigned ${caseRef}`, body: `${caseRef} has been assigned to you. Please review and begin the interactive process.` };

    case 'case_reassigned':
      return isManager
        ? { title: `${caseRef} has been reassigned`, body: `${caseRef} has been transferred to a new HR representative.` }
        : { title: `${caseRef} has been reassigned`, body: `${caseRef} has been reassigned. Please review the case details.` };

    case 'case_status_changed':
      return isManager
        ? { title: `${caseRef} status updated`, body: `${caseRef} has a new status update.` }
        : { title: `${caseRef} status changed`, body: `${caseRef} status has been updated${caseData?.status ? ` to ${caseData.status}` : ''}.` };

    case 'checklist_completed':
      return isManager
        ? { title: `${caseRef} checklist complete`, body: `${caseRef} has completed all required documentation steps.` }
        : { title: `${caseRef} checklist completed`, body: `All checklist items for ${caseRef} have been completed. Ready for review.` };

    case 'medical_docs_uploaded':
      return isManager
        ? { title: `${caseRef} has a new update`, body: `${caseRef} has received new documentation. Please check with HR for details.` }
        : { title: `Medical documents uploaded for ${caseRef}`, body: `Medical documentation has been uploaded for ${caseRef}. Please review the submitted records.` };

    case 'deadline_approaching':
      return isManager
        ? { title: `${caseRef} action required`, body: `${caseRef} requires attention within the next 7 days.` }
        : { title: `Deadline approaching — ${caseRef}`, body: `${caseRef} deadline is in 7 days${caseData?.deadline ? ` (${caseData.deadline})` : ''}. Please take action.` };

    case 'deadline_urgent':
      return isManager
        ? { title: `${caseRef} urgent action needed`, body: `${caseRef} requires immediate attention.` }
        : { title: `URGENT: Deadline in 3 days — ${caseRef}`, body: `${caseRef} deadline is in 3 days${caseData?.deadline ? ` (${caseData.deadline})` : ''}. Immediate action required.` };

    case 'deadline_final_warning':
      return isManager
        ? { title: `${caseRef} final deadline warning`, body: `${caseRef} deadline is tomorrow. Escalated to compliance team.` }
        : { title: `FINAL WARNING: Deadline tomorrow — ${caseRef}`, body: `${caseRef} deadline is tomorrow${caseData?.deadline ? ` (${caseData.deadline})` : ''}. Failure to act may constitute a legal violation.` };

    case 'deadline_overdue':
      return isManager
        ? { title: `${caseRef} overdue`, body: `${caseRef} deadline has passed. HR and compliance have been notified.` }
        : { title: `OVERDUE: ${caseRef} deadline missed`, body: `${caseRef} deadline was${caseData?.deadline ? ` ${caseData.deadline}` : ''} and has been missed. Immediate resolution required to avoid ADA/PWFA liability.` };

    case 'case_unacknowledged':
      return isManager
        ? { title: `${caseRef} needs attention`, body: `${caseRef} has not been acknowledged. Please follow up with HR.` }
        : { title: `${caseRef} unacknowledged — escalation`, body: `${caseRef} has not been acknowledged in 2 business days. Please assign immediately.` };

    case 'accommodation_approved':
      return isManager
        ? { title: `${caseRef} accommodation decision made`, body: `${caseRef} has received an accommodation decision.` }
        : { title: `Accommodation approved — ${caseRef}`, body: `The accommodation request for ${caseRef} has been approved. Please notify the employee and implement.` };

    case 'accommodation_denied':
      return isManager
        ? { title: `${caseRef} accommodation decision made`, body: `${caseRef} accommodation decision has been made. HR and compliance have been notified.` }
        : { title: `Accommodation denied — ${caseRef}`, body: `The accommodation request for ${caseRef} has been denied. Ensure proper documentation and employee notification per ADA requirements.` };

    case 'letter_generated':
      return isManager
        ? { title: `${caseRef} has a new document`, body: `A document has been generated for ${caseRef}.` }
        : { title: `Letter generated for ${caseRef}`, body: `An accommodation letter has been generated for ${caseRef}. Please review and send to the employee.` };

    case 'case_closed':
      return isManager
        ? { title: `${caseRef} closed`, body: `${caseRef} has been closed.` }
        : { title: `${caseRef} has been closed`, body: `${caseRef} has been closed and archived. All compliance records have been saved.` };

    case 'deadline_early_reminder':
      return isManager
        ? { title: `${caseRef} upcoming deadline`, body: `${caseRef} has a deadline in approximately 30 days.` }
        : { title: `Early reminder: ${caseRef} deadline in 30 days`, body: `${caseRef} deadline is in 30 days${caseData?.deadline ? ` (${caseData.deadline})` : ''}. Begin preparation now.` };

    default:
      return { title: `${caseRef} notification`, body: `${caseRef} has an update requiring your attention.` };
  }
}

// ---------------------------------------------------------------------------
// Priority Mapping
// ---------------------------------------------------------------------------

const EVENT_PRIORITY: Record<NotificationEventType, AcmdNotificationPriority> = {
  case_created: 'normal',
  case_assigned: 'normal',
  case_reassigned: 'normal',
  case_status_changed: 'normal',
  checklist_completed: 'low',
  medical_docs_uploaded: 'normal',
  deadline_approaching: 'normal',
  deadline_urgent: 'high',
  deadline_final_warning: 'urgent',
  deadline_overdue: 'urgent',
  case_unacknowledged: 'high',
  accommodation_approved: 'normal',
  accommodation_denied: 'high',
  letter_generated: 'low',
  case_closed: 'low',
  deadline_early_reminder: 'low',
};

// High/urgent events that trigger email stub
const EMAIL_TRIGGER_EVENTS: Set<NotificationEventType> = new Set([
  'deadline_urgent',
  'deadline_final_warning',
  'deadline_overdue',
  'accommodation_denied',
  'case_unacknowledged',
]);

// ---------------------------------------------------------------------------
// Email Stub
// ---------------------------------------------------------------------------

/**
 * Phase 3 stub — logs instead of sending real email.
 * Sets emailSent = true in DB. Real SMTP integration in Phase 4.
 */
export async function sendEmailNotification(
  notificationId: string,
  recipientUserId: string,
  title: string,
  body: string,
): Promise<void> {
  // Phase 3 stub: log only, no real send
  console.log(
    `[Email Stub] Would send email — notificationId=${notificationId} userId=${recipientUserId} title="${title}" body="${body.slice(0, 80)}..."`,
  );

  // Mark emailSent = true in DB
  await db
    .update(acmdNotifications)
    .set({ emailSent: true })
    .where(eq(acmdNotifications.id, notificationId));
}

// ---------------------------------------------------------------------------
// Core Create Functions
// ---------------------------------------------------------------------------

/**
 * Insert a single notification into acmd_notifications.
 * Returns the created notification id.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<string> {
  const priority = params.priority ?? EVENT_PRIORITY[params.type] ?? 'normal';

  const [inserted] = await db
    .insert(acmdNotifications)
    .values({
      userId: params.userId,
      companyId: params.companyId,
      type: params.type,
      title: params.title,
      body: params.body,
      caseId: params.caseId,
      priority,
      emailSent: false,
    })
    .returning({ id: acmdNotifications.id });

  const notificationId = inserted!.id;

  // Trigger email stub for high/urgent events
  if (EMAIL_TRIGGER_EVENTS.has(params.type)) {
    await sendEmailNotification(
      notificationId,
      params.userId,
      params.title,
      params.body ?? '',
    );
  }

  return notificationId;
}

/**
 * Create notifications for all users with a given role in a company.
 * Used for escalation broadcasts (e.g. super_admin alerts).
 *
 * Content is automatically filtered per role using getNotificationContent().
 */
export async function createNotificationsForRole(
  params: CreateNotificationsForRoleParams,
): Promise<number> {
  const users = await db
    .select({ id: acmdUsers.id })
    .from(acmdUsers)
    .where(
      and(
        eq(acmdUsers.companyId, params.companyId),
        eq(acmdUsers.role, params.role),
        isNull(acmdUsers.deletedAt),
      ),
    );

  if (users.length === 0) return 0;

  let created = 0;
  for (const user of users) {
    const content = getNotificationContent(params.type, params.role, params.caseData);
    await createNotification({
      userId: user.id,
      companyId: params.companyId,
      type: params.type,
      title: content.title,
      body: content.body,
      caseId: params.caseId,
    });
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// Deadline Escalation
// ---------------------------------------------------------------------------

export interface DeadlineEscalationResult {
  casesChecked: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
}

/**
 * Check if a notification of this type + caseId was already sent today.
 * Prevents duplicate escalation alerts on the same day.
 */
async function escalationExistsToday(
  companyId: string,
  userId: string,
  caseId: string,
  type: NotificationEventType,
): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [existing] = await db
    .select({ id: acmdNotifications.id })
    .from(acmdNotifications)
    .where(
      and(
        eq(acmdNotifications.companyId, companyId),
        eq(acmdNotifications.userId, userId),
        eq(acmdNotifications.caseId, caseId),
        eq(acmdNotifications.type, type),
        sql`${acmdNotifications.createdAt} >= ${todayStart.toISOString()}`,
      ),
    )
    .limit(1);

  return !!existing;
}

/**
 * Full deadline escalation chain — 30d/7d/3d/1d/overdue.
 * Replaces the simple 3-day check in the legacy checkDeadlines().
 *
 * Duplicate prevention: checks for same type + caseId + today before creating.
 * Overdue notifications are created daily until case is resolved.
 *
 * @param companyId - Optional scope. If omitted, scans ALL companies.
 * @param now - Override "now" for testing
 */
export async function checkDeadlineEscalations(
  companyId: string,
  now?: Date,
): Promise<DeadlineEscalationResult> {
  // Import at function scope to avoid circular deps at module load
  const { db: _db } = await import('@acmd/db');
  const {
    acmdCases,
    acmdUsers: _acmdUsers,
  } = await import('@acmd/db');
  const { eq: _eq, and: _and, or, isNotNull, isNull: _isNull } = await import('drizzle-orm');

  const currentDate = now ?? new Date();
  let casesChecked = 0;
  let notificationsCreated = 0;
  let duplicatesSkipped = 0;

  // Build where clause — optionally scoped to company
  const whereClause = _and(
    ...(companyId ? [_eq(acmdCases.companyId, companyId)] : []),
    or(
      _eq(acmdCases.status, 'intake'),
      _eq(acmdCases.status, 'interactive_process'),
      _eq(acmdCases.status, 'awaiting_medical'),
      _eq(acmdCases.status, 'awaiting_input'),
      _eq(acmdCases.status, 'review'),
      _eq(acmdCases.status, 'implementation'),
      _eq(acmdCases.status, 'active'),
    ),
    isNotNull(acmdCases.deadline),
    _isNull(acmdCases.deletedAt),
  );

  const cases = await _db
    .select()
    .from(acmdCases)
    .where(whereClause);

  for (const caseRow of cases) {
    if (!caseRow.deadline) continue;
    casesChecked++;

    const deadline = new Date(caseRow.deadline);
    const diffMs = deadline.getTime() - currentDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const assigneeId = caseRow.assignedTo;
    const cid = caseRow.companyId;
    const caseDeadlineStr = deadline.toISOString().split('T')[0];
    const caseData: CaseData = { id: caseRow.id, deadline: caseDeadlineStr };

    // Find all super_admins in this company (for escalation broadcasts)
    const admins = await _db
      .select({ id: _acmdUsers.id })
      .from(_acmdUsers)
      .where(
        _and(
          _eq(_acmdUsers.companyId, cid),
          _eq(_acmdUsers.role, 'super_admin'),
          _isNull(_acmdUsers.deletedAt),
        ),
      );

    /**
     * Helper: notify a specific user, checking for today's duplicate first.
     */
    const notifyUser = async (
      userId: string,
      role: NotificationRole,
      type: NotificationEventType,
    ) => {
      const isDuplicate = await escalationExistsToday(cid, userId, caseRow.id, type);
      if (isDuplicate) {
        duplicatesSkipped++;
        return;
      }
      const content = getNotificationContent(type, role, caseData);
      await createNotification({
        userId,
        companyId: cid,
        type,
        title: content.title,
        body: content.body,
        caseId: caseRow.id,
      });
      notificationsCreated++;
    };

    if (diffDays < 0) {
      // OVERDUE — notify assignee (hr role content) + all super_admins
      if (assigneeId) {
        await notifyUser(assigneeId, 'hr', 'deadline_overdue');
      }
      for (const admin of admins) {
        if (admin.id !== assigneeId) {
          await notifyUser(admin.id, 'super_admin', 'deadline_overdue');
        }
      }
    } else if (diffDays <= 1) {
      // 1 day — FINAL WARNING — assignee + all super_admins
      if (assigneeId) {
        await notifyUser(assigneeId, 'hr', 'deadline_final_warning');
      }
      for (const admin of admins) {
        if (admin.id !== assigneeId) {
          await notifyUser(admin.id, 'super_admin', 'deadline_final_warning');
        }
      }
    } else if (diffDays <= 3) {
      // 3 days — URGENT — assignee + all super_admins
      if (assigneeId) {
        await notifyUser(assigneeId, 'hr', 'deadline_urgent');
      }
      for (const admin of admins) {
        if (admin.id !== assigneeId) {
          await notifyUser(admin.id, 'super_admin', 'deadline_urgent');
        }
      }
    } else if (diffDays <= 7) {
      // 7 days — APPROACHING — assignee only
      if (assigneeId) {
        await notifyUser(assigneeId, 'hr', 'deadline_approaching');
      }
    } else if (diffDays <= 30) {
      // 30 days — EARLY REMINDER — assignee only
      if (assigneeId) {
        await notifyUser(assigneeId, 'hr', 'deadline_early_reminder');
      }
    }
  }

  return { casesChecked, notificationsCreated, duplicatesSkipped };
}

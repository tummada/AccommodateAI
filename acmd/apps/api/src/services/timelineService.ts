/**
 * Timeline Service for AccommodateAI — Phase 4D
 *
 * Provides case timeline (audit log history) with:
 *   - Pagination (limit + offset)
 *   - Filter by event type(s)
 *   - Role-based visibility filtering
 *   - Newest-first ordering
 *
 * SECURITY:
 *   - Visibility column in audit_logs determines which roles can see each event
 *   - Medical events restricted to super_admin + hr only
 *   - Implementation events visible to super_admin + hr + manager
 *   - SQL-level filtering via array containment (role = ANY(visibility))
 */

import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { db } from '@acmd/db';
import { acmdAuditLogs, acmdCases } from '@acmd/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction = typeof acmdAuditLogs.$inferSelect['action'];

export interface TimelineQuery {
  caseId: string;
  companyId: string;
  /** Caller's role — used for visibility filtering */
  role: string;
  /** Filter to specific event types */
  eventTypes?: string[];
  /** Max items to return (default 50, max 100) */
  limit?: number;
  /** Offset for pagination (default 0) */
  offset?: number;
}

export interface TimelineEvent {
  id: string;
  caseId: string | null;
  action: string;
  actorId: string | null;
  metadata: unknown;
  visibility: string[];
  createdAt: Date;
}

export interface TimelineResult {
  events: TimelineEvent[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Visibility Rules
// ---------------------------------------------------------------------------

/**
 * Map event type -> which roles can see it.
 * Used when INSERTING new audit logs to set the visibility column.
 *
 * Default: ['super_admin', 'hr']
 * Medical events: ['super_admin', 'hr'] only
 * Implementation events: ['super_admin', 'hr', 'manager']
 */
export const EVENT_VISIBILITY_MAP: Record<string, string[]> = {
  // Case lifecycle — default (super_admin, hr)
  case_created: ['super_admin', 'hr', 'manager'],
  case_updated: ['super_admin', 'hr'],
  case_assigned: ['super_admin', 'hr'],
  case_reassigned: ['super_admin', 'hr'],
  case_status_changed: ['super_admin', 'hr', 'manager'],
  case_closed: ['super_admin', 'hr', 'manager'],

  // Interactive process — medical events are restricted
  interactive_process_started: ['super_admin', 'hr'],
  medical_docs_requested: ['super_admin', 'hr'],
  medical_docs_received: ['super_admin', 'hr'],
  manager_input_requested: ['super_admin', 'hr', 'manager'],
  manager_input_received: ['super_admin', 'hr', 'manager'],
  employee_meeting_logged: ['super_admin', 'hr'],

  // Decision
  accommodation_approved: ['super_admin', 'hr', 'manager'],
  accommodation_denied: ['super_admin', 'hr'],
  accommodation_modified: ['super_admin', 'hr'],
  legal_review_requested: ['super_admin', 'hr'],

  // Implementation — visible to managers
  implementation_started: ['super_admin', 'hr', 'manager'],
  implementation_completed: ['super_admin', 'hr', 'manager'],
  follow_up_scheduled: ['super_admin', 'hr', 'manager'],
  follow_up_completed: ['super_admin', 'hr', 'manager'],

  // Documents
  document_uploaded: ['super_admin', 'hr'],
  document_deleted: ['super_admin', 'hr'],

  // AI
  ai_classification_completed: ['super_admin', 'hr'],
  ai_suggestions_generated: ['super_admin', 'hr'],
  ai_consent_given: ['super_admin', 'hr'],
  ai_consent_declined: ['super_admin', 'hr'],

  // System
  deadline_approaching: ['super_admin', 'hr', 'manager'],
  deadline_overdue: ['super_admin', 'hr', 'manager'],
  escalation_triggered: ['super_admin', 'hr'],
  notification_sent: ['super_admin', 'hr'],
  audit_exported: ['super_admin', 'hr'],

  // Auto-transitions (Phase 5B)
  auto_status_transition: ['super_admin', 'hr', 'manager'],

  // Legacy types
  case_classified: ['super_admin', 'hr'],
  checklist_completed: ['super_admin', 'hr', 'manager'],
  letter_generated: ['super_admin', 'hr'],
  letter_sent: ['super_admin', 'hr'],
  case_reopened: ['super_admin', 'hr'],
  deadline_missed: ['super_admin', 'hr', 'manager'],
  medical_info_accessed: ['super_admin', 'hr'],
};

/**
 * Get visibility array for a given event type.
 * Falls back to ['super_admin', 'hr'] if type is unknown.
 */
export function getEventVisibility(action: string): string[] {
  return EVENT_VISIBILITY_MAP[action] ?? ['super_admin', 'hr'];
}

// ---------------------------------------------------------------------------
// Timeline Query
// ---------------------------------------------------------------------------

/**
 * Fetch case timeline events from audit_logs.
 *
 * - Verifies case belongs to company (tenant isolation)
 * - Filters by role via visibility column (role = ANY(visibility))
 * - Orders by createdAt DESC (newest first)
 * - Supports pagination and event type filtering
 */
export async function getCaseTimeline(
  query: TimelineQuery,
): Promise<TimelineResult | null> {
  const limit = Math.min(query.limit ?? 50, 100);
  const offset = query.offset ?? 0;

  // Verify case belongs to company (tenant isolation)
  const [caseRow] = await db
    .select({ id: acmdCases.id })
    .from(acmdCases)
    .where(and(eq(acmdCases.id, query.caseId), eq(acmdCases.companyId, query.companyId)))
    .limit(1);

  if (!caseRow) return null;

  // Build conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [
    eq(acmdAuditLogs.caseId, query.caseId),
    eq(acmdAuditLogs.companyId, query.companyId),
    // Role-based visibility: the caller's role must be in the visibility array
    sql`${query.role} = ANY(${acmdAuditLogs.visibility})`,
  ];

  // Optional: filter by event type(s)
  if (query.eventTypes && query.eventTypes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(inArray(acmdAuditLogs.action, query.eventTypes as any));
  }

  const whereClause = and(...conditions);

  // Count total matching events
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(acmdAuditLogs)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  // Fetch paginated events — newest first
  const events = await db
    .select({
      id: acmdAuditLogs.id,
      caseId: acmdAuditLogs.caseId,
      action: acmdAuditLogs.action,
      actorId: acmdAuditLogs.actorId,
      metadata: acmdAuditLogs.metadata,
      visibility: acmdAuditLogs.visibility,
      createdAt: acmdAuditLogs.createdAt,
    })
    .from(acmdAuditLogs)
    .where(whereClause)
    .orderBy(desc(acmdAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    events: events as TimelineEvent[],
    total,
    limit,
    offset,
  };
}

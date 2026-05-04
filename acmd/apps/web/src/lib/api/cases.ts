/**
 * cases.ts — API fetch functions for ACMD cases.
 *
 * Used by DashboardPage (ACMD-134) via TanStack Query.
 * All functions require an AuthenticatedClient from useApiClient().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseStatus =
  | 'intake'
  | 'interactive_process'
  | 'awaiting_medical'
  | 'awaiting_input'
  | 'review'
  | 'implementation'
  | 'active'
  | 'approved'
  | 'denied'
  | 'closed'
  | 'denial_pending_review';

export type CaseType = 'ada' | 'pwfa' | 'state_law' | 'multiple';

export interface AcmdCase {
  id: string;
  companyId: string;
  employeeId: string;
  assignedTo: string | null;
  assignedAt: string | null;
  status: CaseStatus;
  type: CaseType;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCasesResponse {
  cases: AcmdCase[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListCasesParams {
  status?: CaseStatus;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Terminal (resolved) statuses — cases no longer "open"
// ---------------------------------------------------------------------------

export const TERMINAL_STATUSES: CaseStatus[] = ['approved', 'denied', 'closed'];

// Statuses that count as "pending action"
export const PENDING_ACTION_STATUSES: CaseStatus[] = [
  'awaiting_medical',
  'awaiting_input',
  'review',
  'denial_pending_review',
];

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch a list of cases from the backend.
 * GET /api/v1/cases?limit=...&offset=...&status=...
 */
export async function fetchCases(
  client: AuthenticatedClient,
  params: ListCasesParams = {},
): Promise<ListCasesResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params.status) searchParams.set('status', params.status);

  const query = searchParams.toString();
  const path = query ? `/api/v1/cases?${query}` : '/api/v1/cases';

  return client.request<ListCasesResponse>(path);
}

// ---------------------------------------------------------------------------
// Client-side stat computation
// ---------------------------------------------------------------------------

export interface DashboardStats {
  openCases: number;
  overdueCases: number;
  pendingActions: number;
  /** Average resolution time in days, or null if no resolved cases */
  avgResolutionDays: number | null;
}

/**
 * Compute dashboard stats from a flat case list (client-side).
 * Called after fetchCases() returns.
 */
export function computeStats(cases: AcmdCase[]): DashboardStats {
  const now = new Date();

  const openCases = cases.filter((c) => !TERMINAL_STATUSES.includes(c.status));

  const overdueCases = openCases.filter(
    (c) => c.deadline !== null && new Date(c.deadline) < now,
  );

  const pendingActions = cases.filter((c) => PENDING_ACTION_STATUSES.includes(c.status));

  const resolvedCases = cases.filter((c) => TERMINAL_STATUSES.includes(c.status));
  let avgResolutionDays: number | null = null;
  if (resolvedCases.length > 0) {
    const totalDays = resolvedCases.reduce((sum, c) => {
      const created = new Date(c.createdAt).getTime();
      const updated = new Date(c.updatedAt).getTime();
      const days = (updated - created) / (1000 * 60 * 60 * 24);
      return sum + days;
    }, 0);
    avgResolutionDays = Math.round(totalDays / resolvedCases.length);
  }

  return {
    openCases: openCases.length,
    overdueCases: overdueCases.length,
    pendingActions: pendingActions.length,
    avgResolutionDays,
  };
}

/**
 * Compute the deadline urgency level (0-5) for a case.
 *
 * Level 0 — no deadline
 * Level 1 — > 29 days (yellow)
 * Level 2 — 8-29 days (orange)
 * Level 3 — 4-7 days (red)
 * Level 4 — 1-3 days (pulsing red)
 * Level 5 — overdue (dark red)
 */
export function getDeadlineLevel(deadline: string | null): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!deadline) return 0;
  const now = new Date();
  const dl = new Date(deadline);
  const diffMs = dl.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 5; // overdue
  if (diffDays <= 3) return 4; // 1-3 days
  if (diffDays <= 7) return 3; // 4-7 days
  if (diffDays <= 29) return 2; // 8-29 days
  return 1; // > 29 days
}

// ---------------------------------------------------------------------------
// Create case
// ---------------------------------------------------------------------------

export interface CreateCasePayload {
  employeeId: string;
  requestDescription: string;
  type: 'ada' | 'pwfa' | 'state_law' | 'multiple';
  medicalInfo?: string | null;
}

export interface CreateCaseResponse {
  id: string;
  caseId: string;       // CASE-{YYYY}-{NNN}
  status: CaseStatus;
  type: CaseType;
  employeeId: string;
  createdAt: string;
}

export async function createCase(
  client: AuthenticatedClient,
  payload: CreateCasePayload,
): Promise<CreateCaseResponse> {
  return client.request<CreateCaseResponse>('/api/v1/cases', {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

/**
 * Sort cases by urgency: overdue first, then by deadline level desc,
 * then by createdAt desc.
 */
export function sortByUrgency(cases: AcmdCase[]): AcmdCase[] {
  return [...cases].sort((a, b) => {
    const la = getDeadlineLevel(a.deadline);
    const lb = getDeadlineLevel(b.deadline);
    if (lb !== la) return lb - la;
    // Same level — latest created first
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// ---------------------------------------------------------------------------
// ACMD-137-C1: Discussion types
// ---------------------------------------------------------------------------

export type DiscussionMethod = 'in_person' | 'video' | 'phone' | 'email' | 'written';

export interface AcmdDiscussion {
  id: string;
  caseId: string;
  companyId: string;
  recordedBy: string | null;
  discussionDate: string;   // 'YYYY-MM-DD'
  method: DiscussionMethod;
  participants: string[];
  summary: string;
  employeePreference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDiscussionPayload {
  discussionDate: string;   // 'YYYY-MM-DD'
  method: DiscussionMethod;
  participants: string[];
  summary: string;
  employeePreference?: string | null;
}

// ---------------------------------------------------------------------------
// ACMD-137-C1: Timeline types (mirrors backend TimelineEvent)
// ---------------------------------------------------------------------------

export interface AcmdTimelineEvent {
  id: string;
  caseId: string | null;
  action: string;
  actorId: string | null;
  metadata: unknown;
  visibility: string[];
  createdAt: string;  // ISO string
}

export interface TimelineResponse {
  events: AcmdTimelineEvent[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// ACMD-137-C1: Discussion API functions
// ---------------------------------------------------------------------------

/**
 * Fetch discussions for a case.
 * GET /api/v1/cases/:id/discussions
 * Returns { discussions: AcmdDiscussion[] } → extract .discussions
 */
export async function fetchDiscussions(
  client: AuthenticatedClient,
  caseId: string,
): Promise<AcmdDiscussion[]> {
  const data = await client.request<{ discussions: AcmdDiscussion[] }>(
    `/api/v1/cases/${caseId}/discussions`,
  );
  return data.discussions;
}

/**
 * Create a discussion record.
 * POST /api/v1/cases/:id/discussions
 * Returns { discussion: AcmdDiscussion } → extract .discussion
 */
export async function createDiscussion(
  client: AuthenticatedClient,
  caseId: string,
  payload: CreateDiscussionPayload,
): Promise<AcmdDiscussion> {
  const data = await client.request<{ discussion: AcmdDiscussion }>(
    `/api/v1/cases/${caseId}/discussions`,
    {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json' },
    },
  );
  return data.discussion;
}

/**
 * Fetch case timeline (audit trail).
 * GET /api/v1/cases/:id/timeline?limit=20&offset=0
 */
export async function fetchCaseTimeline(
  client: AuthenticatedClient,
  caseId: string,
  params?: { eventType?: string; limit?: number; offset?: number },
): Promise<TimelineResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params?.eventType) searchParams.set('eventType', params.eventType);

  const query = searchParams.toString();
  const path = query
    ? `/api/v1/cases/${caseId}/timeline?${query}`
    : `/api/v1/cases/${caseId}/timeline`;

  return client.request<TimelineResponse>(path);
}

/**
 * Advance a case to the next status.
 * PATCH /api/v1/cases/:id
 * Body: { status: nextStatus }
 */
export async function advanceCaseStatus(
  client: AuthenticatedClient,
  caseId: string,
  nextStatus: CaseStatus,
): Promise<{ case: { status: string } }> {
  return client.request<{ case: { status: string } }>(`/api/v1/cases/${caseId}`, {
    method: 'PATCH',
    body: { status: nextStatus },
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Close a case.
 * POST /api/v1/cases/:id/close
 * Returns { message: 'Case closed successfully' }
 * Throws on 409 (already_closed) / 422 (stage_incomplete) / 404 (not_found)
 */
export async function apiCloseCase(
  client: AuthenticatedClient,
  caseId: string,
): Promise<{ message: string }> {
  return client.request<{ message: string }>(`/api/v1/cases/${caseId}/close`, {
    method: 'POST',
  });
}

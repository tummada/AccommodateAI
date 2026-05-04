/**
 * notifications.ts — API fetch functions for ACMD notifications.
 *
 * Used by DashboardPage (ACMD-134) and NotificationsPage (ACMD-150) via TanStack Query.
 * All functions require an AuthenticatedClient from useApiClient().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface AcmdNotification {
  id: string;
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  caseId: string | null;
  readAt: string | null;
  emailSent: boolean;
  priority: NotificationPriority;
  createdAt: string;
}

export interface ListNotificationsResponse {
  notifications: AcmdNotification[];
  total: number;
  unreadCount: number;
}

export interface ListNotificationsParams {
  read?: 'true' | 'false';
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch notifications for the current user.
 * GET /api/v1/notifications?limit=...&read=...
 *
 * NOTE: If the endpoint returns an unexpected shape (e.g. not yet deployed),
 * this will throw — callers must handle gracefully.
 */
export async function fetchNotifications(
  client: AuthenticatedClient,
  params: ListNotificationsParams = {},
): Promise<ListNotificationsResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params.read !== undefined) searchParams.set('read', params.read);

  const query = searchParams.toString();
  const path = query ? `/api/v1/notifications?${query}` : '/api/v1/notifications';

  return client.request<ListNotificationsResponse>(path);
}

/**
 * Mark a single notification as read.
 * PATCH /api/v1/notifications/:id/read
 */
export async function markNotificationRead(
  client: AuthenticatedClient,
  id: string,
): Promise<void> {
  await client.request<unknown>(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

/**
 * Mark all notifications as read for the current user.
 * PATCH /api/v1/notifications/read-all
 *
 * NOTE: Router matches "read-all" before "/:id/read" — exact path only.
 */
export async function markAllNotificationsRead(
  client: AuthenticatedClient,
): Promise<void> {
  await client.request<unknown>('/api/v1/notifications/read-all', {
    method: 'PATCH',
  });
}

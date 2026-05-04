/**
 * checklist.ts — API fetch functions for ACMD checklist.
 *
 * Used by ChecklistPage (ACMD-154) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id: string;
  caseId: string;
  stepName: string;
  stepOrder: number;
  required: boolean;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
}

export interface ChecklistResponse {
  checklist: ChecklistItem[];
}

export interface ToggleChecklistItemResponse {
  item: ChecklistItem;
  allComplete: boolean;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch all checklist items for a case.
 * GET /api/v1/cases/:caseId/checklist
 */
export async function getChecklist(
  client: AuthenticatedClient,
  caseId: string,
): Promise<ChecklistResponse> {
  return client.request<ChecklistResponse>(`/api/v1/cases/${caseId}/checklist`);
}

/**
 * Toggle a checklist item's completion status.
 * PATCH /api/v1/cases/:caseId/checklist/:itemId
 */
export async function toggleChecklistItem(
  client: AuthenticatedClient,
  caseId: string,
  itemId: string,
): Promise<ToggleChecklistItemResponse> {
  return client.request<ToggleChecklistItemResponse>(
    `/api/v1/cases/${caseId}/checklist/${itemId}`,
    { method: 'PATCH' },
  );
}

/**
 * managerInput.ts — API fetch functions for ACMD manager input workflow.
 *
 * Used by ManagerInputPage (ACMD-158 Phase 7B) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 *
 * Endpoints:
 *   GET /api/v1/cases/:id/manager-input-form — requires manager role
 *   PUT /api/v1/cases/:id/manager-input       — submit manager input
 *
 * PRIVACY: These endpoints NEVER return medical information.
 * Only operational/job-related fields are included in the API response.
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManagerInputMode = 'form' | 'acknowledgment';

/**
 * ManagerInputFormData — mirrors backend response for
 * GET /api/v1/cases/:id/manager-input-form
 */
export interface ManagerInputFormData {
  caseId: string;
  employeeName: string;
  department: string;
  positionTitle: string;
  accommodationCategory: string;
  hrRequesterName: string;
  responseDeadline: string;
  daysRemaining: number;
  alreadySubmitted: boolean;
  submittedAt: string | null;
  mode: ManagerInputMode;
  outcomeType: 'approved' | 'denied' | null;
}

export interface SubmitManagerInputBody {
  canAccommodate: boolean;
  operationalImpact: string;
}

export interface SubmitManagerInputResponse {
  success: boolean;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch the manager input form data for a case.
 * GET /api/v1/cases/:caseId/manager-input-form
 * Requires: manager role.
 */
export async function getManagerInputForm(
  client: AuthenticatedClient,
  caseId: string,
): Promise<ManagerInputFormData> {
  return client.request<ManagerInputFormData>(
    `/api/v1/cases/${caseId}/manager-input-form`,
  );
}

/**
 * Submit manager input for a case.
 * PUT /api/v1/cases/:caseId/manager-input
 * Requires: manager role.
 */
export async function submitManagerInput(
  client: AuthenticatedClient,
  caseId: string,
  body: SubmitManagerInputBody,
): Promise<SubmitManagerInputResponse> {
  return client.request<SubmitManagerInputResponse>(
    `/api/v1/cases/${caseId}/manager-input`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Manager list — for RequestManagerInputDialog (ACMD-168)
// ---------------------------------------------------------------------------

export interface Manager {
  id: string;
  displayName: string;
  email: string;
}

export interface ManagersListResponse {
  managers: Manager[];
}

export interface RequestManagerInputBody {
  managerId: string;
}

export interface RequestManagerInputResponse {
  success: boolean;
  message: string;
}

// GET /api/v1/users/managers
export async function getManagersList(
  client: AuthenticatedClient,
): Promise<ManagersListResponse> {
  return client.request<ManagersListResponse>('/api/v1/users/managers');
}

// POST /api/v1/cases/:caseId/manager-input-request
export async function requestManagerInput(
  client: AuthenticatedClient,
  caseId: string,
  body: RequestManagerInputBody,
): Promise<RequestManagerInputResponse> {
  return client.request<RequestManagerInputResponse>(
    `/api/v1/cases/${caseId}/manager-input-request`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

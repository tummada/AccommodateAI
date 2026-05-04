/**
 * interim.ts — API fetch functions for ACMD interim accommodations.
 *
 * Used by PwfaInterimPage (ACMD-157) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterimAccommodationData {
  offered: boolean;
  description: string | null;
  offeredAt: string | null;
  status: 'active' | 'ended' | 'converted';
  endedAt: string | null;
  endReason: string | null;
}

export interface GetInterimAccommodationResponse {
  hasInterim: boolean;
  interim: InterimAccommodationData | null;
}

export type PatchInterimAction = 'end' | 'convert' | 'update_description';

export interface PatchInterimAccommodationBody {
  action: PatchInterimAction;
  description?: string;
  reason?: string;
}

export interface PatchInterimAccommodationResponse {
  hasInterim: boolean;
  interim: InterimAccommodationData | null;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch interim accommodation status for a case.
 * GET /api/v1/cases/:caseId/interim-accommodation
 */
export async function getInterimAccommodation(
  client: AuthenticatedClient,
  caseId: string,
): Promise<GetInterimAccommodationResponse> {
  return client.request<GetInterimAccommodationResponse>(
    `/api/v1/cases/${caseId}/interim-accommodation`,
  );
}

/**
 * PATCH interim accommodation — end, convert, or update description.
 * PATCH /api/v1/cases/:caseId/interim-accommodation
 */
export async function patchInterimAccommodation(
  client: AuthenticatedClient,
  caseId: string,
  body: PatchInterimAccommodationBody,
): Promise<PatchInterimAccommodationResponse> {
  return client.request<PatchInterimAccommodationResponse>(
    `/api/v1/cases/${caseId}/interim-accommodation`,
    {
      method: 'PATCH',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * medicalRequest.ts — API fetch functions for ACMD medical documentation request.
 *
 * Used by MedicalRequestPage (ACMD-153) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MedicalRequestStatus =
  | 'not_sent'
  | 'sent'
  | 'received'
  | 'under_review'
  | 'cleared'
  | 'additional_needed'
  | 'insufficient';

export type MedicalOutcome = 'cleared' | 'additional_needed' | 'insufficient';

export interface MedicalDocument {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
}

export interface MedicalRequestData {
  template: string;
  limitations: string;
  dueDate: string | null;
  deliveryMethod: string;
  notes: string | null;
  sentAt: string | null;
}

export interface MedicalRequestResponse {
  status: MedicalRequestStatus;
  request: MedicalRequestData | null;
  reviewer: string | null;
  documents: MedicalDocument[];
  outcome: MedicalOutcome | null;
  outcomeNotes: string | null;
}

export interface SendMedicalRequestBody {
  template: string;
  limitations: string;
  dueDate: string;
  deliveryMethod: string;
  notes?: string;
}

export interface RecordOutcomeBody {
  outcome: MedicalOutcome;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch medical request status for a case.
 * GET /api/v1/cases/:caseId/medical-request
 */
export async function getMedicalRequest(
  client: AuthenticatedClient,
  caseId: string,
): Promise<MedicalRequestResponse> {
  return client.request<MedicalRequestResponse>(`/api/v1/cases/${caseId}/medical-request`);
}

/**
 * Send a medical documentation request.
 * POST /api/v1/cases/:caseId/medical-request
 */
export async function sendMedicalRequest(
  client: AuthenticatedClient,
  caseId: string,
  body: SendMedicalRequestBody,
): Promise<MedicalRequestResponse> {
  return client.request<MedicalRequestResponse>(`/api/v1/cases/${caseId}/medical-request`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Assign a medical reviewer to the case.
 * PATCH /api/v1/cases/:caseId/medical-request/reviewer
 */
export async function assignReviewer(
  client: AuthenticatedClient,
  caseId: string,
  reviewerId: string,
): Promise<MedicalRequestResponse> {
  return client.request<MedicalRequestResponse>(
    `/api/v1/cases/${caseId}/medical-request/reviewer`,
    {
      method: 'PATCH',
      body: { reviewerId },
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Record the medical review outcome.
 * PATCH /api/v1/cases/:caseId/medical-request/outcome
 */
export async function recordOutcome(
  client: AuthenticatedClient,
  caseId: string,
  body: RecordOutcomeBody,
): Promise<MedicalRequestResponse> {
  return client.request<MedicalRequestResponse>(
    `/api/v1/cases/${caseId}/medical-request/outcome`,
    {
      method: 'PATCH',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

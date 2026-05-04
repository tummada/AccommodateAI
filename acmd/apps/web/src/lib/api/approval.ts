/**
 * approval.ts — API fetch functions for ACMD approval workflow.
 *
 * Used by PwfaFastTrackPage (ACMD-156 Phase 7B) via direct calls.
 * All functions require an AuthenticatedClient from useAuth().
 *
 * Endpoints:
 *   POST /api/v1/cases/:id/fast-track-approve — PWFA per se fast-track
 *   GET  /api/v1/cases/:id/decision           — get existing case decision
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecisionType = 'approved' | 'denied';

/**
 * CaseDecision — mirrors backend AcmdCaseDecision (acmd_case_decisions table).
 * Only the fields the frontend needs are declared here.
 */
export interface CaseDecision {
  id: string;
  caseId: string;
  companyId: string;
  decisionType: DecisionType;
  legalReviewRequired: boolean;
  legalReviewed: boolean;
  legalReviewedBy: string | null;
  legalReviewedAt: string | null;
  decidedBy: string;
  decidedAt: string;
  createdAt: string;
}

export interface FastTrackApproveResponse {
  decision: CaseDecision;
}

export interface GetCaseDecisionResponse {
  decision: CaseDecision | null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Submit PWFA per se fast-track approval for a case.
 *
 * POST /api/v1/cases/:id/fast-track-approve
 * Requires: super_admin or hr role.
 * Body: none (the backend determines eligibility from the stored case row).
 *
 * Returns: { decision: CaseDecision }
 * Throws ApiError 400 if case is not PWFA or does not qualify for per se fast-track.
 */
export async function fastTrackApprove(
  client: AuthenticatedClient,
  caseId: string,
): Promise<FastTrackApproveResponse> {
  return client.request<FastTrackApproveResponse>(
    `/api/v1/cases/${caseId}/fast-track-approve`,
    { method: 'POST' },
  );
}

/**
 * Get the most recent decision for a case.
 *
 * GET /api/v1/cases/:id/decision
 * Requires: super_admin or hr role.
 *
 * Returns: { decision: CaseDecision } or throws ApiError 404 if no decision.
 * Callers should catch 404 and treat it as "no decision yet".
 */
export async function getCaseDecision(
  client: AuthenticatedClient,
  caseId: string,
): Promise<GetCaseDecisionResponse> {
  return client.request<GetCaseDecisionResponse>(
    `/api/v1/cases/${caseId}/decision`,
  );
}

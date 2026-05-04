/**
 * decision.ts — API types + fetch functions for case decisions (ACMD-138-A)
 *
 * Endpoint: POST /api/v1/cases/:id/decision
 * Body for approve: { decisionType: 'approved' }
 * Body for deny: { decisionType: 'denied', denialData: {...} }  (ACMD-138-B)
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecisionType = 'approved' | 'denied';

export interface DecisionResponse {
  id: string;
  caseId: string;
  decisionType: DecisionType;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/cases/:id/decision with { decisionType: 'approved' }
 * Returns the created decision record.
 */
export async function postApproveDecision(
  client: AuthenticatedClient,
  caseId: string,
): Promise<DecisionResponse> {
  return client.request<DecisionResponse>(`/api/v1/cases/${caseId}/decision`, {
    method: 'POST',
    body: { decisionType: 'approved' },
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Denial types (ACMD-138-B)
// ---------------------------------------------------------------------------

export interface DenialAlternative {
  description: string;
  reasonRejected: string;
}

export interface DenialData {
  costAnalysis: string;
  financialResources: string;
  sizeAndType: string;
  operationalImpact: string;
  alternativesConsidered: DenialAlternative[];
}

/**
 * POST /api/v1/cases/:id/decision with { decisionType: 'denied', denialData }
 * Returns the created decision record.
 */
export async function postDenyDecision(
  client: AuthenticatedClient,
  caseId: string,
  denialData: DenialData,
): Promise<DecisionResponse> {
  return client.request<DecisionResponse>(`/api/v1/cases/${caseId}/decision`, {
    method: 'POST',
    body: { decisionType: 'denied', denialData },
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Supervisor actions (ACMD-138-C) — backend routes deferred to Phase 7
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/cases/:id/decision/supervisor-approve
 * Supervisor approves the denial — triggers denial letter generation.
 * Returns the updated decision record.
 */
export async function postSupervisorApproveDenial(
  client: AuthenticatedClient,
  caseId: string,
): Promise<DecisionResponse> {
  return client.request<DecisionResponse>(
    `/api/v1/cases/${caseId}/decision/supervisor-approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * POST /api/v1/cases/:id/decision/supervisor-reject
 * Supervisor rejects the denial package and returns it to HR with a reason.
 * Body: { reason: string }
 */
export async function postSupervisorRejectDenial(
  client: AuthenticatedClient,
  caseId: string,
  reason: string,
): Promise<DecisionResponse> {
  return client.request<DecisionResponse>(
    `/api/v1/cases/${caseId}/decision/supervisor-reject`,
    {
      method: 'POST',
      body: { reason },
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * POST /api/v1/cases/:id/decision/supervisor-request-info
 * Supervisor requests more information from HR before making a decision.
 * Body: { questions: string }
 */
export async function postSupervisorRequestInfo(
  client: AuthenticatedClient,
  caseId: string,
  questions: string,
): Promise<DecisionResponse> {
  return client.request<DecisionResponse>(
    `/api/v1/cases/${caseId}/decision/supervisor-request-info`,
    {
      method: 'POST',
      body: { questions },
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

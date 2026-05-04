/**
 * suggestions.ts — API fetch functions for ACMD AI suggestions.
 *
 * Used by AIAnalysisPage (ACMD-155) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 *
 * Backend: apps/acmd-api/src/routes/suggestions.ts
 * Endpoints:
 *   GET    /api/v1/cases/:id/suggestions              → list suggestions
 *   POST   /api/v1/cases/:id/suggestions              → generate AI suggestions
 *   POST   /api/v1/cases/:id/suggestions/:sid/select  → accept suggestion
 *   POST   /api/v1/cases/:id/suggestions/:sid/reject  → reject suggestion
 *   PATCH  /api/v1/cases/:id/suggestions/:sid/customize → customize description
 *   GET    /api/v1/cases/:id/accommodations           → list accepted accommodations
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestionSourceType = 'jan_soar' | 'similar_case' | 'legal_pattern';
export type SuggestionStatus = 'pending' | 'selected' | 'rejected';
export type ImplementationStatus = 'pending' | 'in_progress' | 'completed';

export interface Suggestion {
  id: string;
  caseId: string;
  companyId: string;
  title: string;
  description: string;
  customizedDescription: string | null;
  source: string;
  sourceType: SuggestionSourceType;
  confidence: number;
  implementationCount: number | null;
  status: SuggestionStatus;
  rejectionReason: string | null;
  implementationStatus: ImplementationStatus | null;
  implementationCost: number | null;
  selectedAt: string | null;
  selectedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Accommodation {
  id: string;
  caseId: string;
  companyId: string;
  title: string;
  description: string;
  customizedDescription: string | null;
  source: string;
  sourceType: SuggestionSourceType | 'manual';
  implementationStatus: ImplementationStatus | null;
  implementationCost: number | null;
  selectedAt: string | null;
}

export interface GetSuggestionsResponse {
  suggestions: Suggestion[];
}

export interface GenerateSuggestionsResponse {
  suggestions: Suggestion[];
  source?: string;
  count?: number;
}

export interface AcceptSuggestionResponse {
  suggestion: Suggestion;
  letter?: { id: string; source: string } | null;
}

export interface RejectSuggestionResponse {
  suggestion: Suggestion;
}

export interface CustomizeSuggestionResponse {
  suggestion: Suggestion;
}

export interface GetAccommodationsResponse {
  accommodations: Accommodation[];
  totalCost?: number;
  count?: number;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch existing AI suggestions for a case.
 * GET /api/v1/cases/:id/suggestions
 */
export async function getSuggestions(
  client: AuthenticatedClient,
  caseId: string,
): Promise<GetSuggestionsResponse> {
  return client.request<GetSuggestionsResponse>(
    `/api/v1/cases/${caseId}/suggestions`,
  );
}

/**
 * Trigger AI suggestion generation for a case.
 * POST /api/v1/cases/:id/suggestions
 * Requires admin or manager role.
 */
export async function generateSuggestions(
  client: AuthenticatedClient,
  caseId: string,
  options?: { budgetMax?: number; preferLowCost?: boolean },
): Promise<GenerateSuggestionsResponse> {
  return client.request<GenerateSuggestionsResponse>(
    `/api/v1/cases/${caseId}/suggestions`,
    {
      method: 'POST',
      body: options ?? {},
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Accept / select a suggestion.
 * POST /api/v1/cases/:id/suggestions/:suggestionId/select
 * Requires admin or manager role.
 */
export async function acceptSuggestion(
  client: AuthenticatedClient,
  caseId: string,
  suggestionId: string,
): Promise<AcceptSuggestionResponse> {
  return client.request<AcceptSuggestionResponse>(
    `/api/v1/cases/${caseId}/suggestions/${suggestionId}/select`,
    { method: 'POST' },
  );
}

/**
 * Reject a suggestion with a mandatory reason.
 * POST /api/v1/cases/:id/suggestions/:suggestionId/reject
 * Requires admin or manager role.
 * reason — min 10 chars (backend validates)
 */
export async function rejectSuggestion(
  client: AuthenticatedClient,
  caseId: string,
  suggestionId: string,
  reason: string,
  notes?: string,
): Promise<RejectSuggestionResponse> {
  return client.request<RejectSuggestionResponse>(
    `/api/v1/cases/${caseId}/suggestions/${suggestionId}/reject`,
    {
      method: 'POST',
      body: { reason, ...(notes ? { notes } : {}) },
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Customize a suggestion's description.
 * PATCH /api/v1/cases/:id/suggestions/:suggestionId/customize
 * Requires admin or manager role.
 */
export async function customizeSuggestion(
  client: AuthenticatedClient,
  caseId: string,
  suggestionId: string,
  customizedDescription: string,
): Promise<CustomizeSuggestionResponse> {
  return client.request<CustomizeSuggestionResponse>(
    `/api/v1/cases/${caseId}/suggestions/${suggestionId}/customize`,
    {
      method: 'PATCH',
      body: { customizedDescription },
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Fetch accepted/implemented accommodations for a case.
 * GET /api/v1/cases/:id/accommodations
 */
export async function getAccommodations(
  client: AuthenticatedClient,
  caseId: string,
): Promise<GetAccommodationsResponse> {
  return client.request<GetAccommodationsResponse>(
    `/api/v1/cases/${caseId}/accommodations`,
  );
}

/**
 * letters.ts — API fetch functions for ACMD accommodation letters.
 *
 * Used by LettersPage (ACMD-151) via TanStack Query.
 * All functions require an AuthenticatedClient from useAuth().
 */

import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LetterType = 'acknowledgment' | 'medical_request' | 'approval' | 'denial' | 'follow_up';
export type LetterStatus = 'draft' | 'sent';

export interface AcmdLetter {
  id: string;
  caseId: string;
  type: LetterType;
  content: string;
  status: LetterStatus;
  sentToEmail: string | null;
  pdfUrl: string | null;
  createdBy: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLettersResponse {
  letters: AcmdLetter[];
}

export interface CreateLetterResponse {
  letter: AcmdLetter;
  source: string;
}

export interface UpdateLetterResponse {
  letter: AcmdLetter;
}

export interface SendLetterResponse {
  letter: AcmdLetter;
  emailSent: boolean;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch all letters for a case.
 * GET /api/v1/cases/:id/letters
 */
export async function fetchLetters(
  client: AuthenticatedClient,
  caseId: string,
): Promise<AcmdLetter[]> {
  const response = await client.request<ListLettersResponse>(
    `/api/v1/cases/${caseId}/letters`,
  );
  return response.letters;
}

/**
 * Create (AI-generate) a new letter for a case.
 * POST /api/v1/cases/:id/letters
 */
export async function createLetter(
  client: AuthenticatedClient,
  caseId: string,
  type: LetterType,
): Promise<CreateLetterResponse> {
  return client.request<CreateLetterResponse>(`/api/v1/cases/${caseId}/letters`, {
    method: 'POST',
    body: { type },
  });
}

/**
 * Update (save) the content of an existing letter.
 * PATCH /api/v1/cases/:id/letters/:letterId
 */
export async function updateLetterContent(
  client: AuthenticatedClient,
  caseId: string,
  letterId: string,
  content: string,
): Promise<AcmdLetter> {
  const response = await client.request<UpdateLetterResponse>(
    `/api/v1/cases/${caseId}/letters/${letterId}`,
    {
      method: 'PATCH',
      body: { content },
    },
  );
  return response.letter;
}

/**
 * Send a letter via company email (SMTP).
 * POST /api/v1/cases/:id/letters/:letterId/send
 */
export async function sendLetter(
  client: AuthenticatedClient,
  caseId: string,
  letterId: string,
): Promise<SendLetterResponse> {
  return client.request<SendLetterResponse>(
    `/api/v1/cases/${caseId}/letters/${letterId}/send`,
    { method: 'POST' },
  );
}

/**
 * Download the PDF for a letter.
 * GET /api/v1/cases/:id/letters/:letterId/pdf
 *
 * NOTE: Returns binary PDF data — uses raw fetch with credentials since
 * AuthenticatedClient.request() parses JSON. This is the acceptable
 * exception for binary download endpoints (per ACMD-151 task spec).
 *
 * BASE_URL from env — same as api-client.ts convention.
 */
export async function downloadLetterPdf(
  _client: AuthenticatedClient,
  caseId: string,
  letterId: string,
): Promise<Blob> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const url = `${base}/api/v1/cases/${caseId}/letters/${letterId}/pdf`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  });

  // Fix 4: handle 401 by redirecting to login (prevents silent PDF failure)
  if (response.status === 401) {
    window.location.href = '/login';
    return new Blob();
  }

  if (!response.ok) {
    throw new Error(`PDF download failed: ${response.status}`);
  }

  return response.blob();
}

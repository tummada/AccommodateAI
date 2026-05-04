/**
 * ACMD-145 — Vitest tests for MedicalRequestPage (SCR-MED-REQ)
 * ACMD-153 — Updated for real API (mock useQuery directly)
 *
 * Tests:
 *   T01: State 1 (law_branch) — renders ADA + PWFA cards
 *   T02: State 1 — PWFA detected badge shows when lawTag includes PWFA
 *   T03: State 1 — ADA card click transitions to form state
 *   T04: State 1 — PWFA card click transitions to pwfa_check
 *   T05: State 1b (pwfa_check) — renders 4 PWFA category cards
 *   T06: State 1b — selecting category shows PWFA exempt banner
 *   T07: State 1b — no category selected shows "Continue with Medical Request Form"
 *   T08: State 1b — "Go to PWFA Fast-Track" button navigates to pwfa_exempt display
 *   T09: State 2 (form) — all form fields present
 *   T10: State 2 — template dropdown has 3 options
 *   T11: State 2 — AI Pre-fill button visible when aiConsent is true
 *   T12: State 2 — Duration "Temporary" shows return date field
 *   T13: State 2 — Delivery method "provider" shows provider email input
 *   T14: State 2 — Send Request shows confirmation dialog
 *   T15: State 3 (sent) — renders request summary + 3 action buttons
 *   T16: State 3 — Mark as Received transitions to received state
 *   T17: State 4 (received) — renders file list + reviewer dropdown
 *   T18: State 5 (under_review) — shows pending badge + contextual help
 *   T19: State 6a (cleared) — green banner + Proceed to Decision link
 *   T20: State 6b (additional_needed) — orange banner + follow-up form
 *   T21: State 6c (insufficient) — red banner + 3 option buttons
 *   T22: Privacy banner always visible on form/sent/received/review states
 *   T23: Privacy banner NOT shown on law_branch state
 *   T24: Role guard — manager sees 403 Access Denied
 *   T25: Role guard — medical_reviewer sees 403 Access Denied
 *   T26: Status tracker renders 4 steps
 *   T27: Due date warning shows when days remaining <= 5
 *   T28: PWFA exempt display — purple banner + category reference cards
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoist navigate mock so 401 test can assert on it
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Hoist mocks
vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock('@/lib/api/medicalRequest', () => ({
  getMedicalRequest: vi.fn().mockResolvedValue({
    status: 'not_sent',
    request: null,
    reviewer: null,
    documents: [],
    outcome: null,
    outcomeNotes: null,
  }),
  sendMedicalRequest: vi.fn().mockResolvedValue({
    status: 'sent',
    request: null,
    reviewer: null,
    documents: [],
    outcome: null,
    outcomeNotes: null,
  }),
  assignReviewer: vi.fn().mockResolvedValue({
    status: 'under_review',
    request: null,
    reviewer: 'Dr. Sarah Chen',
    documents: [],
    outcome: null,
    outcomeNotes: null,
  }),
  recordOutcome: vi.fn().mockResolvedValue({
    status: 'cleared',
    request: null,
    reviewer: null,
    documents: [],
    outcome: 'cleared',
    outcomeNotes: null,
  }),
}));

vi.mock('@/pages/CaseDetailPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/CaseDetailPage')>();
  return {
    ...actual,
    fetchCaseDetail: vi.fn(),
  };
});

import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { MedicalRequestPage } from '@/pages/MedicalRequestPage';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from '../test/handlers';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'CASE-2026-042';

const createdAt = new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString();
const deadline = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();

const MOCK_CASE_DETAIL = {
  id: MOCK_CASE_ID,
  companyId: 'company-test-abc',
  employeeId: 'emp-test-001',
  assignedTo: null,
  assignedAt: null,
  status: 'awaiting_medical',
  type: 'multiple', // lawTag = 'both'
  aiConsentGiven: false,
  aiConsentTimestamp: null,
  pwfaPerSe: false,
  requestDescription: 'Standing Desk request',
  medicalInfo: null,
  aiClassification: null,
  suggestedAccommodations: null,
  approvedAccommodation: 'Standing Desk',
  denialReason: null,
  interimAccommodationOffered: false,
  interimAccommodationDescription: null,
  interimOfferedAt: null,
  deadline,
  closedAt: null,
  deletedAt: null,
  createdAt,
  updatedAt: new Date().toISOString(),
  ai_consent_status: 'given',
  managerId: null,
  denialSubmittedBy: null,
  denialSubmittedByName: null,
  denialSubmittedAt: null,
  supervisorReviewDeadline: null,
  denialType: null,
  denialHardshipCategories: null,
  denialHardshipNarrative: null,
  denialEvidenceCount: null,
  denialAlternatives: null,
  denialEmployeePreference: null,
  denialInteractiveProcessConfirmed: null,
  denialEngagementAssessment: null,
  denialDiscussionDate: null,
  denialDiscussionMethod: null,
  denialLegalReviewer: null,
  denialLegalReviewDate: null,
  denialLegalOpinion: null,
  timeline: null,
};

const MOCK_MEDICAL_REQUEST_DATA = {
  status: 'not_sent' as const,
  request: null,
  reviewer: null,
  documents: [
    { id: 'doc-001', name: 'medical_form_completed.pdf', size: '2.1MB', uploadedAt: '04/15/2026' },
    { id: 'doc-002', name: 'provider_letter.pdf', size: '0.8MB', uploadedAt: '04/15/2026' },
  ],
  outcome: null,
  outcomeNotes: null,
};

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

type RoleType = 'hr' | 'super_admin' | 'medical_reviewer' | 'manager';

function setupAuth(role: RoleType) {
  const fakeToken = makeFakeAccessToken({ role });
  const client = createAuthenticatedClient({
    getAccessToken: () => fakeToken,
    onTokenRefreshed: vi.fn(),
    onAuthLost: vi.fn(),
  });
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-test-001',
      email: `${role}@acmd-test.com`,
      name: `${role} User`,
      role,
      companyId: 'company-test-abc',
    },
    client,
    isAuthenticated: true,
    token: fakeToken,
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function setupQueries() {
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === 'case') {
      return { data: MOCK_CASE_DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (key === 'medical-request') {
      return { data: MOCK_MEDICAL_REQUEST_DATA, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(role: RoleType = 'hr', caseId = MOCK_CASE_ID) {
  setupAuth(role);
  setupQueries();
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/medical-request`]}>
        <Routes>
          <Route path="/cases/:id/medical-request" element={<MedicalRequestPage />} />
          <Route path="/cases/:id/decision" element={<div>Decision Page</div>} />
          <Route path="/cases/:id/pwfa-fast" element={<div>PWFA Fast Track</div>} />
          <Route path="/cases/:id/timeline" element={<div>Timeline Page</div>} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MedicalRequestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  // T01
  it('T01: State 1 — renders ADA + PWFA cards', () => {
    renderPage();
    expect(screen.getByTestId('law-branch-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ada-path-card')).toBeInTheDocument();
    expect(screen.getByTestId('pwfa-path-card')).toBeInTheDocument();
  });

  // T02
  it('T02: State 1 — PWFA detected badge visible', () => {
    renderPage();
    expect(screen.getByTestId('pwfa-detected-badge')).toHaveTextContent('Detected');
  });

  // T03
  it('T03: State 1 — ADA card click transitions to form state', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.getByTestId('medical-request-form')).toBeInTheDocument();
  });

  // T04
  it('T04: State 1 — PWFA card click transitions to pwfa_check', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    expect(screen.getByTestId('pwfa-exemption-check')).toBeInTheDocument();
  });

  // T05
  it('T05: State 1b — renders 4 PWFA category cards', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    expect(screen.getByTestId('pwfa-cat-breaks')).toBeInTheDocument();
    expect(screen.getByTestId('pwfa-cat-water')).toBeInTheDocument();
    expect(screen.getByTestId('pwfa-cat-sit_stand')).toBeInTheDocument();
    expect(screen.getByTestId('pwfa-cat-eating')).toBeInTheDocument();
  });

  // T06
  it('T06: State 1b — selecting category shows PWFA exempt banner', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    fireEvent.click(screen.getByTestId('pwfa-cat-breaks'));
    expect(screen.getByTestId('pwfa-exempt-banner')).toBeInTheDocument();
    expect(screen.getByText(/Medical Documentation NOT Required/)).toBeInTheDocument();
  });

  // T07
  it('T07: State 1b — no category shows "Continue with Medical Request Form"', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    expect(screen.getByTestId('continue-med-form')).toBeInTheDocument();
  });

  // T08
  it('T08: State 1b — "Go to PWFA Fast-Track" navigates to pwfa_exempt display', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    fireEvent.click(screen.getByTestId('pwfa-cat-breaks'));
    fireEvent.click(screen.getByTestId('go-pwfa-fast-track'));
    expect(screen.getByTestId('pwfa-exempt-display')).toBeInTheDocument();
  });

  // T09
  it('T09: State 2 — all form fields present', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.getByTestId('template-select')).toBeInTheDocument();
    expect(screen.getByTestId('limitation-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('duration-temporary')).toBeInTheDocument();
    expect(screen.getByTestId('duration-permanent')).toBeInTheDocument();
    expect(screen.getByTestId('duration-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('delivery-employee')).toBeInTheDocument();
    expect(screen.getByTestId('delivery-provider')).toBeInTheDocument();
    expect(screen.getByTestId('delivery-both')).toBeInTheDocument();
    expect(screen.getByTestId('due-date-input')).toBeInTheDocument();
    expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
    expect(screen.getByTestId('save-draft-btn')).toBeInTheDocument();
    expect(screen.getByTestId('send-request-btn')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-btn')).toBeInTheDocument();
  });

  // T10
  it('T10: State 2 — template dropdown has 3 options', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    const select = screen.getByTestId('template-select');
    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent('General ADA');
    expect(options[1]).toHaveTextContent('Specific Condition');
    expect(options[2]).toHaveTextContent('FMLA Certification');
  });

  // T11 — aiConsent = true because mock_case_detail.ai_consent_status = 'given'
  it('T11: State 2 — AI Pre-fill button visible when aiConsent is true', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.getByTestId('ai-prefill-btn')).toBeInTheDocument();
  });

  // T12
  it('T12: State 2 — Duration "Temporary" shows return date field', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.queryByTestId('return-date-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('duration-temporary'));
    expect(screen.getByTestId('return-date-input')).toBeInTheDocument();
  });

  // T13
  it('T13: State 2 — Delivery method "provider" shows provider email input', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.queryByTestId('provider-email-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delivery-provider'));
    expect(screen.getByTestId('provider-email-input')).toBeInTheDocument();
  });

  // T14
  it('T14: State 2 — Send Request shows confirmation dialog', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    expect(screen.getByTestId('send-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Confirm Send Request/)).toBeInTheDocument();
  });

  // T15
  it('T15: State 3 — renders request summary + 3 action buttons', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    fireEvent.click(screen.getByTestId('confirm-send'));
    expect(screen.getByTestId('request-sent-panel')).toBeInTheDocument();
    expect(screen.getByTestId('send-reminder-btn')).toBeInTheDocument();
    expect(screen.getByTestId('resend-request-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mark-received-btn')).toBeInTheDocument();
  });

  // T16
  it('T16: State 3 — Mark as Received transitions to received state', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    fireEvent.click(screen.getByTestId('confirm-send'));
    fireEvent.click(screen.getByTestId('mark-received-btn'));
    expect(screen.getByTestId('documents-received-panel')).toBeInTheDocument();
  });

  // T17 — files come from API mock (MOCK_MEDICAL_REQUEST_DATA.documents)
  it('T17: State 4 — renders file list + reviewer dropdown', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    fireEvent.click(screen.getByTestId('confirm-send'));
    fireEvent.click(screen.getByTestId('mark-received-btn'));
    expect(screen.getByTestId('documents-received-panel')).toBeInTheDocument();
    expect(screen.getByText('medical_form_completed.pdf')).toBeInTheDocument();
    expect(screen.getByText('provider_letter.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-select')).toBeInTheDocument();
    expect(screen.getByTestId('assign-reviewer-btn')).toBeInTheDocument();
  });

  // T18
  it('T18: State 5 — shows pending badge + contextual help', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    fireEvent.click(screen.getByTestId('confirm-send'));
    fireEvent.click(screen.getByTestId('mark-received-btn'));
    fireEvent.change(screen.getByTestId('reviewer-select'), {
      target: { value: 'Dr. Sarah Chen' },
    });
    fireEvent.click(screen.getByTestId('assign-reviewer-btn'));
    expect(screen.getByTestId('under-review-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pending-badge')).toHaveTextContent('Pending');
    expect(screen.getByTestId('contextual-help')).toBeInTheDocument();
  });

  // T19
  it('T19: State 6a — green banner + Proceed to Decision link', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'cleared' }));
    expect(screen.getByTestId('cleared-panel')).toBeInTheDocument();
    expect(screen.getByText(/Medical documentation has been cleared/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 4 is complete/)).toBeInTheDocument();
    expect(screen.getByTestId('proceed-decision-btn')).toBeInTheDocument();
    expect(screen.getByTestId('proceed-decision-btn')).toHaveTextContent('Proceed to Decision');
  });

  // T20
  it('T20: State 6b — additional info panel with orange banner + follow-up form', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'additional_needed' }));
    expect(screen.getByTestId('additional-info-panel')).toBeInTheDocument();
    expect(screen.getByText(/Medical Reviewer has requested additional information/)).toBeInTheDocument();
    expect(screen.getByText('Follow-up Request')).toBeInTheDocument();
    expect(screen.getByTestId('followup-due-date')).toBeInTheDocument();
    expect(screen.getByTestId('send-followup-btn')).toBeInTheDocument();
  });

  // T21
  it('T21: State 6c — insufficient panel with red banner + 3 option buttons', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'insufficient' }));
    expect(screen.getByTestId('insufficient-panel')).toBeInTheDocument();
    expect(screen.getByText(/Medical documentation has been marked as insufficient/)).toBeInTheDocument();
    expect(screen.getByTestId('new-request-btn')).toBeInTheDocument();
    expect(screen.getByTestId('proceed-decision-insufficient')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-discussion-btn')).toBeInTheDocument();
  });

  // T22
  it('T22: Privacy banner visible on form state', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    expect(screen.getByTestId('privacy-banner')).toBeInTheDocument();
    expect(screen.getByText(/CONFIDENTIAL/)).toBeInTheDocument();
  });

  // T23
  it('T23: Privacy banner NOT shown on law_branch state', () => {
    renderPage();
    expect(screen.queryByTestId('privacy-banner')).not.toBeInTheDocument();
  });

  // T24
  it('T24: Role guard — manager sees 403 Access Denied', () => {
    renderPage('manager');
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('403 — Forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('law-branch-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('medical-request-form')).not.toBeInTheDocument();
  });

  // T25
  it('T25: Role guard — medical_reviewer sees 403 Access Denied', () => {
    renderPage('medical_reviewer');
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('403 — Forbidden')).toBeInTheDocument();
  });

  // T26
  it('T26: Status tracker renders 4 steps', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    const tracker = screen.getByTestId('status-tracker');
    expect(tracker).toBeInTheDocument();
    expect(screen.getByTestId('step-created')).toBeInTheDocument();
    expect(screen.getByTestId('step-sent')).toBeInTheDocument();
    expect(screen.getByTestId('step-received')).toBeInTheDocument();
    expect(screen.getByTestId('step-review')).toBeInTheDocument();
  });

  // T27 — daysRemaining comes from API request data (null → fallback 3)
  it('T27: Due date warning shows on sent state (daysRemaining = 3)', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ada-path-card'));
    fireEvent.click(screen.getByTestId('send-request-btn'));
    fireEvent.click(screen.getByTestId('confirm-send'));
    expect(screen.getByTestId('due-date-warning')).toBeInTheDocument();
    expect(screen.getByText(/3 business days/)).toBeInTheDocument();
  });

  // T28
  it('T28: PWFA exempt display — purple banner + category reference cards', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pwfa-path-card'));
    fireEvent.click(screen.getByTestId('pwfa-cat-breaks'));
    fireEvent.click(screen.getByTestId('go-pwfa-fast-track'));
    expect(screen.getByTestId('pwfa-exempt-display')).toBeInTheDocument();
    expect(screen.getByText(/PWFA Predictable Assessment/)).toBeInTheDocument();
    expect(screen.getByText(/BREAKS/)).toBeInTheDocument();
    expect(screen.getByTestId('go-pwfa-fast-display')).toBeInTheDocument();
  });

  // T29 — 401 redirect
  it('T29: redirects to /login on 401 error', () => {
    setupAuth('hr');
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : '';
      if (key === 'medical-request' || key === 'case') {
        return { data: undefined, isLoading: false, isError: true, error: { status: 401 }, refetch: vi.fn() } as unknown as ReturnType<typeof useQuery>;
      }
      return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useQuery>;
    });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[`/cases/${MOCK_CASE_ID}/medical-request`]}>
          <Routes>
            <Route path="/cases/:id/medical-request" element={<MedicalRequestPage />} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });
});

/**
 * ACMD-137-B — Vitest tests for CaseDetailPage, CaseDetailHeader, EEOCStepper
 *
 * Tests:
 *   T1:  EEOCStepper renders correct default labels for HR role
 *   T2:  EEOCStepper renders manager-specific labels for manager role
 *   T3:  EEOCStepper marks stages as completed / current / upcoming
 *   T4:  EEOCStepper stage 4 shows PWFA exempt style when pwfaExempt=true
 *   T5:  EEOCStepper upcoming stages have aria-disabled="true"
 *   T6:  CaseDetailHeader shows full info for super_admin role
 *   T7:  CaseDetailHeader hides accommodation type for medical_reviewer role
 *   T8:  CaseDetailHeader hides Reassign/Escalate buttons for HR role
 *   T9:  CaseDetailPage shows loading skeleton while fetching
 *   T10: CaseDetailPage renders 404 message when case not found
 *   T11: CaseDetailPage renders 403 message when access denied
 *   T12: EEOCStepper has correct aria navigation attributes
 *   T13: CaseDetailHeader manager shows "In Progress" not accommodation type
 *   T14: deriveCurrentStage returns correct stage for each status
 *   T15: CaseDetailPage renders case header after successful fetch
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoist vi.mock calls — Vitest hoists these so they always run before imports
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

import { EEOCStepper, deriveCurrentStage } from '@/components/case-detail/EEOCStepper';
import { CaseDetailHeader } from '@/components/case-detail/CaseDetailHeader';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import type { AcmdCaseDetail } from '@/pages/CaseDetailPage';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { createAuthenticatedClient, ApiError } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** Minimal AcmdCaseDetail fixture */
function makeCaseDetail(overrides: Partial<AcmdCaseDetail> = {}): AcmdCaseDetail {
  return {
    id: 'case-uuid-12345678',
    companyId: 'company-abc',
    employeeId: 'Jane Martinez',
    assignedTo: 'hr-user-abc',
    assignedAt: '2026-04-01T14:00:00Z',
    status: 'interactive_process',
    type: 'ada',
    deadline: '2026-05-01T00:00:00Z',
    createdAt: '2026-04-01T14:00:00Z',
    updatedAt: '2026-04-10T09:15:00Z',
    requestDescription: 'Needs standing desk due to back issues',
    medicalInfo: null,
    aiClassification: null,
    suggestedAccommodations: null,
    approvedAccommodation: null,
    denialReason: null,
    interimAccommodationOffered: false,
    interimAccommodationDescription: null,
    closedAt: null,
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
    ...overrides,
  };
}

function makeMockClient() {
  return createAuthenticatedClient({
    getAccessToken: () => makeFakeAccessToken(),
    onTokenRefreshed: () => {},
    onAuthLost: () => {},
  });
}

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

/** Set up mocks for a CaseDetailPage rendering */
function setupPageMocks(
  role: 'hr' | 'super_admin' | 'medical_reviewer' | 'manager' = 'hr',
  queryResult: {
    data?: AcmdCaseDetail;
    isLoading?: boolean;
    error?: Error | null;
  } = {},
) {
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-test',
      email: `${role}@example.com`,
      name: `${role} User`,
      role,
      companyId: 'company-abc',
    },
    client: makeMockClient(),
    isAuthenticated: true,
    token: makeFakeAccessToken({ role }),
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });

  mockUseQuery.mockReturnValue({
    data: queryResult.data,
    isLoading: queryResult.isLoading ?? false,
    error: queryResult.error ?? null,
    isError: queryResult.error != null,
    status: queryResult.isLoading ? 'pending' : queryResult.error ? 'error' : 'success',
  });
}

function renderCaseDetailPage(
  role: 'hr' | 'super_admin' | 'medical_reviewer' | 'manager' = 'hr',
  caseId = 'case-uuid-12345678',
  queryResult: {
    data?: AcmdCaseDetail;
    isLoading?: boolean;
    error?: Error | null;
  } = {},
) {
  setupPageMocks(role, queryResult);

  const qc = makeQueryClient();
  return render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <QueryClientProvider client={qc}>
        <CaseDetailPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// T1: EEOCStepper — HR labels
// ---------------------------------------------------------------------------

describe('EEOCStepper — T1: HR role labels', () => {
  it('renders EEOC stage labels for HR role', () => {
    render(
      <EEOCStepper
        currentStatus="interactive_process"
        caseType="ada"
        role="hr"
      />,
    );

    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Acknowledgment')).toBeInTheDocument();
    expect(screen.getByText('Interactive Discussion')).toBeInTheDocument();
    expect(screen.getByText('Medical Documentation')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Follow-up')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T2: EEOCStepper — Manager labels
// ---------------------------------------------------------------------------

describe('EEOCStepper — T2: manager role labels', () => {
  it('renders generic manager labels (no EEOC terminology)', () => {
    render(
      <EEOCStepper
        currentStatus="interactive_process"
        caseType="ada"
        role="manager"
      />,
    );

    // Manager generic labels
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    // Stage 3 and 4 both show "In Review" for manager
    const inReviews = screen.getAllByText('In Review');
    expect(inReviews.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Decision Pending')).toBeInTheDocument();
    expect(screen.getByText('Monitoring')).toBeInTheDocument();

    // EEOC terminology NOT visible
    expect(screen.queryByText('Intake')).not.toBeInTheDocument();
    expect(screen.queryByText('Acknowledgment')).not.toBeInTheDocument();
    expect(screen.queryByText('Interactive Discussion')).not.toBeInTheDocument();
    expect(screen.queryByText('Medical Documentation')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T3: EEOCStepper — visual states
// ---------------------------------------------------------------------------

describe('EEOCStepper — T3: visual states', () => {
  it('marks stages as completed, current, upcoming based on status', () => {
    // interactive_process → stage 3 current, stages 1-2 completed, stages 4-6 upcoming
    render(
      <EEOCStepper
        currentStatus="interactive_process"
        caseType="ada"
        role="hr"
      />,
    );

    // Current stage has aria-current="step" on its listitem
    const listItems = screen.getAllByRole('listitem');
    const currentItems = listItems.filter(
      (el) => el.getAttribute('aria-current') === 'step',
    );
    expect(currentItems.length).toBe(1);
    // The current listitem should contain "Interactive Discussion"
    expect(currentItems[0].textContent).toContain('Interactive Discussion');

    // Upcoming stages have aria-disabled="true"
    const disabledItems = listItems.filter(
      (el) => el.getAttribute('aria-disabled') === 'true',
    );
    // Stages 4, 5, 6 are upcoming → 3 disabled
    expect(disabledItems.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T4: EEOCStepper — PWFA exempt
// ---------------------------------------------------------------------------

describe('EEOCStepper — T4: PWFA exempt stage 4', () => {
  it('shows PWFA Exempt label for stage 4 when pwfaExempt=true', () => {
    render(
      <EEOCStepper
        currentStatus="awaiting_medical"
        caseType="pwfa"
        role="hr"
        pwfaExempt={true}
      />,
    );

    expect(screen.getByText('(PWFA Exempt)')).toBeInTheDocument();
  });

  it('does NOT show PWFA Exempt label when pwfaExempt=false', () => {
    render(
      <EEOCStepper
        currentStatus="awaiting_medical"
        caseType="ada"
        role="hr"
        pwfaExempt={false}
      />,
    );

    expect(screen.queryByText('(PWFA Exempt)')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5: EEOCStepper — aria-disabled on upcoming stages
// ---------------------------------------------------------------------------

describe('EEOCStepper — T5: upcoming stages aria-disabled', () => {
  it('upcoming stages have aria-disabled="true"', () => {
    // intake → stage 1 current, stages 2-6 upcoming
    render(
      <EEOCStepper
        currentStatus="intake"
        caseType="ada"
        role="super_admin"
      />,
    );

    const listItems = screen.getAllByRole('listitem');
    const disabledItems = listItems.filter(
      (el) => el.getAttribute('aria-disabled') === 'true',
    );
    // Stages 2-6 are upcoming → 5 disabled
    expect(disabledItems.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// T6: CaseDetailHeader — super_admin full info
// ---------------------------------------------------------------------------

describe('CaseDetailHeader — T6: super_admin full info', () => {
  it('shows full case info including accommodation type and admin buttons', () => {
    const caseData = makeCaseDetail({ type: 'ada' });

    render(
      <CaseDetailHeader
        caseData={caseData}
        role="super_admin"
        onReassign={vi.fn()}
        onEscalate={vi.fn()}
        onViewTimeline={vi.fn()}
      />,
    );

    // Case ID (last 8 chars)
    expect(screen.getByText('CASE-12345678')).toBeInTheDocument();

    // Employee name
    expect(screen.getByText('Jane Martinez')).toBeInTheDocument();

    // Accommodation type label visible
    expect(screen.getByText('Accommodation')).toBeInTheDocument();

    // Admin action buttons
    expect(screen.getByRole('button', { name: /Reassign Case/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Escalate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Full Timeline/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T7: CaseDetailHeader — medical_reviewer hides accommodation type
// ---------------------------------------------------------------------------

describe('CaseDetailHeader — T7: medical_reviewer limited header', () => {
  it('hides accommodation type for medical_reviewer role', () => {
    const caseData = makeCaseDetail({ type: 'ada' });

    render(
      <CaseDetailHeader
        caseData={caseData}
        role="medical_reviewer"
      />,
    );

    // Employee name visible
    expect(screen.getByText('Jane Martinez')).toBeInTheDocument();

    // Accommodation label NOT visible
    expect(screen.queryByText('Accommodation')).not.toBeInTheDocument();

    // No admin action buttons
    expect(screen.queryByRole('button', { name: /Reassign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Escalate/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T8: CaseDetailHeader — HR hides Reassign/Escalate
// ---------------------------------------------------------------------------

describe('CaseDetailHeader — T8: HR role no admin buttons', () => {
  it('hides Reassign and Escalate buttons for HR role', () => {
    const caseData = makeCaseDetail();

    render(
      <CaseDetailHeader
        caseData={caseData}
        role="hr"
        onViewTimeline={vi.fn()}
      />,
    );

    // No Reassign/Escalate buttons
    expect(screen.queryByRole('button', { name: /Reassign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Escalate/i })).not.toBeInTheDocument();

    // View Full Timeline still present
    expect(screen.getByRole('button', { name: /View Full Timeline/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T9: CaseDetailPage — loading skeleton
// ---------------------------------------------------------------------------

describe('CaseDetailPage — T9: loading state', () => {
  it('shows loading skeleton while case data is being fetched', () => {
    renderCaseDetailPage('hr', 'case-uuid-12345678', { isLoading: true });

    expect(
      screen.getByRole('status', { name: /Loading case details/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T10: CaseDetailPage — 404 error
// ---------------------------------------------------------------------------

describe('CaseDetailPage — T10: 404 case not found', () => {
  it('shows "Case not found" message when API returns 404', () => {
    const err404 = new ApiError(404, 'NOT_FOUND', 'Case not found');
    renderCaseDetailPage('hr', 'nonexistent-id', { error: err404 });

    expect(screen.getByText('Case not found')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T11: CaseDetailPage — 403 error
// ---------------------------------------------------------------------------

describe('CaseDetailPage — T11: 403 access denied', () => {
  it('shows "Access denied" message when API returns 403', () => {
    const err403 = new ApiError(403, 'FORBIDDEN', 'Access denied');
    renderCaseDetailPage('manager', 'restricted-id', { error: err403 });

    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T12: EEOCStepper — ARIA navigation attributes
// ---------------------------------------------------------------------------

describe('EEOCStepper — T12: accessibility attributes', () => {
  it('has role=navigation and correct aria-label on container', () => {
    render(
      <EEOCStepper
        currentStatus="intake"
        caseType="ada"
        role="hr"
      />,
    );

    const nav = screen.getByRole('navigation', {
      name: 'EEOC accommodation process stages',
    });
    expect(nav).toBeInTheDocument();
  });

  it('uses role=list on the steps container', () => {
    render(
      <EEOCStepper
        currentStatus="intake"
        caseType="ada"
        role="super_admin"
      />,
    );

    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T13: CaseDetailHeader — manager generic status
// ---------------------------------------------------------------------------

describe('CaseDetailHeader — T13: manager generic status', () => {
  it('shows "In Progress" status for manager (no accommodation type)', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process', type: 'ada' });

    render(
      <CaseDetailHeader
        caseData={caseData}
        role="manager"
      />,
    );

    // Generic "In Progress" status
    expect(screen.getByText('In Progress')).toBeInTheDocument();

    // No accommodation label
    expect(screen.queryByText('Accommodation')).not.toBeInTheDocument();

    // No dual-law badge
    expect(screen.queryByText(/ADA.*PWFA/i)).not.toBeInTheDocument();

    // No admin buttons
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T14: deriveCurrentStage — unit tests
// ---------------------------------------------------------------------------

describe('deriveCurrentStage — T14: stage derivation', () => {
  it('maps intake → 1', () => {
    expect(deriveCurrentStage('intake')).toBe(1);
  });

  it('maps active → 2', () => {
    expect(deriveCurrentStage('active')).toBe(2);
  });

  it('maps interactive_process → 3', () => {
    expect(deriveCurrentStage('interactive_process')).toBe(3);
  });

  it('maps awaiting_input → 3', () => {
    expect(deriveCurrentStage('awaiting_input')).toBe(3);
  });

  it('maps awaiting_medical → 4', () => {
    expect(deriveCurrentStage('awaiting_medical')).toBe(4);
  });

  it('maps review → 5', () => {
    expect(deriveCurrentStage('review')).toBe(5);
  });

  it('maps implementation → 6', () => {
    expect(deriveCurrentStage('implementation')).toBe(6);
  });

  it('maps approved → 5 (stage 5 complete)', () => {
    expect(deriveCurrentStage('approved')).toBe(5);
  });

  it('maps denied → 5 (stage 5 complete)', () => {
    expect(deriveCurrentStage('denied')).toBe(5);
  });

  it('maps closed → 6 (all complete)', () => {
    expect(deriveCurrentStage('closed')).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// T15: CaseDetailPage — successful render (mocked)
// ---------------------------------------------------------------------------

describe('CaseDetailPage — T15: successful case render', () => {
  it('renders case header after successful API fetch', () => {
    const caseData = makeCaseDetail();

    renderCaseDetailPage('hr', 'case-uuid-12345678', { data: caseData });

    // Case ID in header
    expect(screen.getByText('CASE-12345678')).toBeInTheDocument();

    // Back link present
    expect(screen.getAllByText('← Back to Cases').length).toBeGreaterThan(0);

    // EEOCStepper navigation present
    expect(
      screen.getByRole('navigation', { name: 'EEOC accommodation process stages' }),
    ).toBeInTheDocument();
  });
});

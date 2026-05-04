/**
 * ACMD-137-C2 — Tests for StageActionPanel + CaseDetailPage integration
 *
 * T1: StageActionPanel stage 1 — renders intake read-only info (employee, request description)
 * T2: StageActionPanel stage 3 — renders discussions list (mock fetchDiscussions)
 * T3: StageActionPanel stage 3 — shows "0/1 discussions" badge when empty
 * T4: StageActionPanel stage 3 — Add Discussion form toggles on button click
 * T5: StageActionPanel stage 3 — manager sees simplified view (not full form)
 * T6: StageActionPanel stage 4 — PWFA exempt banner visible when pwfaPerSe=true
 * T7: StageActionPanel stage 4 — medical_reviewer sees null/nothing for stage 4 panel
 * T8: CaseDetailPage — renders DualTrackSplitView + StageActionPanel + TimelinePanel
 * T9: StageActionPanel stage 3 — medical_reviewer returns null (no ADA strategy visible)
 * T10: StageActionPanel stage 5 — medical_reviewer returns null
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoist vi.mock — must be before imports
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useQueryClient: vi.fn(),
    useInfiniteQuery: vi.fn(),
  };
});

vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

import { StageActionPanel } from '@/components/case-detail/StageActionPanel';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import type { AcmdCaseDetail } from '@/pages/CaseDetailPage';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeMockClient() {
  return createAuthenticatedClient({
    getAccessToken: () => makeFakeAccessToken(),
    onTokenRefreshed: () => {},
    onAuthLost: () => {},
  });
}

/** Minimal AcmdCaseDetail fixture */
function makeCaseDetail(overrides: Partial<AcmdCaseDetail & { pwfaPerSe?: boolean }> = {}): AcmdCaseDetail & { pwfaPerSe?: boolean } {
  return {
    id: 'case-uuid-12345678',
    companyId: 'company-abc',
    employeeId: 'Jane Martinez',
    assignedTo: 'hr-user-abc',
    assignedAt: '2026-04-01T14:00:00Z',
    status: 'intake',
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
    pwfaPerSe: false,
    ...overrides,
  };
}

/** Wrap with providers */
function renderWithProviders(ui: React.ReactElement) {
  const qc = makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;
const mockUseQueryClient = useQueryClient as ReturnType<typeof vi.fn>;
const mockUseInfiniteQuery = useInfiniteQuery as ReturnType<typeof vi.fn>;
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

/** Mock useQuery to return empty discussions by default */
function setupDiscussionMock(discussions: unknown[] = []) {
  mockUseQuery.mockReturnValue({
    data: discussions,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(),
  });
}

/** Setup page-level mocks */
function setupPageMocks(
  role: 'hr' | 'super_admin' | 'medical_reviewer' | 'manager' = 'hr',
  caseData?: AcmdCaseDetail,
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

  mockUseQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(),
  });

  // useQuery is called for both the case data fetch and discussions
  mockUseQuery.mockImplementation((opts: { queryKey?: string[] }) => {
    const key = opts?.queryKey?.[0];
    if (key === 'case') {
      return {
        data: caseData,
        isLoading: false,
        error: null,
      };
    }
    // discussions
    return {
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  });

  // useInfiniteQuery for TimelinePanel
  mockUseInfiniteQuery.mockReturnValue({
    data: { pages: [{ events: [], total: 0, limit: 20, offset: 0 }], pageParams: [0] },
    isLoading: false,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
}

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// T1: StageActionPanel stage 1 — reads intake info (status=intake → stage 1)
// ---------------------------------------------------------------------------

describe('StageActionPanel — T1: stage 1 intake read-only', () => {
  it('renders employee name and request description for stage 1 (intake)', () => {
    const caseData = makeCaseDetail({
      status: 'intake',
      employeeId: 'Jane Martinez',
      requestDescription: 'Needs standing desk due to back issues',
    });

    setupDiscussionMock();

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(screen.getByText('Stage 1: Intake — Completed')).toBeInTheDocument();
    expect(screen.getByText('Jane Martinez')).toBeInTheDocument();
    expect(screen.getByText('Needs standing desk due to back issues')).toBeInTheDocument();
    // Read-only note
    expect(
      screen.getByText(/Read-only — intake data is immutable/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T2: StageActionPanel stage 3 — renders discussions list
// ---------------------------------------------------------------------------

describe('StageActionPanel — T2: stage 3 renders discussions list', () => {
  it('renders discussion records when discussions exist', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process' });

    mockUseQuery.mockReturnValue({
      data: [
        {
          id: 'disc-001',
          caseId: caseData.id,
          companyId: 'company-abc',
          recordedBy: null,
          discussionDate: '2026-04-05',
          method: 'video',
          participants: ['Jane Martinez', 'Sarah Kim'],
          summary: 'Discussed flexible start time for morning appointments',
          employeePreference: 'Start at 10am instead of 8am on Tue/Thu',
          createdAt: '2026-04-05T10:30:00Z',
          updatedAt: '2026-04-05T10:30:00Z',
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() });

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(screen.getByText('Stage 3: Interactive Discussion')).toBeInTheDocument();
    expect(screen.getByText(/Discussion Records \(1 of minimum 1\)/i)).toBeInTheDocument();
    // Discussion record shows date + method
    expect(screen.getByText(/Video/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T3: StageActionPanel stage 3 — shows 0/1 badge when empty
// ---------------------------------------------------------------------------

describe('StageActionPanel — T3: stage 3 shows 0/1 discussions badge when empty', () => {
  it('shows "0/1 discussions documented" badge when no discussions exist', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process' });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(
      screen.getByLabelText(/0\/1 discussions documented/i),
    ).toBeInTheDocument();

    // Mark Stage 3 Complete button should be disabled
    const markBtn = screen.getByRole('button', { name: /Mark Stage 3 Complete/i });
    expect(markBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// T4: StageActionPanel stage 3 — Add Discussion form toggles
// ---------------------------------------------------------------------------

describe('StageActionPanel — T4: stage 3 Add Discussion form toggles', () => {
  it('shows Add Discussion form when the + Add Discussion Record button is clicked', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process' });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    // Form should not be visible initially
    expect(screen.queryByText('New Discussion Record')).not.toBeInTheDocument();

    // Click the Add Discussion button
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Discussion Record/i }));

    // Form should now be visible
    expect(screen.getByText('New Discussion Record')).toBeInTheDocument();
    expect(screen.getByLabelText(/Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Method/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Summary/i)).toBeInTheDocument();

    // Cancel hides form
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByText('New Discussion Record')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5: StageActionPanel stage 3 — manager sees simplified view
// ---------------------------------------------------------------------------

describe('StageActionPanel — T5: stage 3 manager sees simplified view', () => {
  it('shows simplified HR-processing text for manager role, not the full discussion form', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process' });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="manager"
        apiClient={makeMockClient()}
      />,
    );

    // Manager sees simplified text
    expect(
      screen.getByText(/HR is conducting the interactive process/i),
    ).toBeInTheDocument();

    // No discussion form elements
    expect(screen.queryByRole('button', { name: /Add Discussion Record/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark Stage 3 Complete/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T6: StageActionPanel stage 4 — PWFA exempt banner
// ---------------------------------------------------------------------------

describe('StageActionPanel — T6: stage 4 PWFA exempt banner', () => {
  it('shows PWFA exempt banner when pwfaPerSe=true', () => {
    const caseData = makeCaseDetail({
      status: 'awaiting_medical',
      pwfaPerSe: true,
    });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(screen.getByText('PWFA Exempt')).toBeInTheDocument();
    expect(
      screen.getByText(/Medical documentation not required under PWFA/i),
    ).toBeInTheDocument();
  });

  it('does NOT show PWFA exempt banner when pwfaPerSe=false', () => {
    const caseData = makeCaseDetail({
      status: 'awaiting_medical',
      pwfaPerSe: false,
    });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(screen.queryByText('PWFA Exempt')).not.toBeInTheDocument();
    expect(screen.getByText(/Medical Documentation Status/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T7: StageActionPanel stage 4 — medical_reviewer returns null
// ---------------------------------------------------------------------------

describe('StageActionPanel — T7: stage 4 medical_reviewer returns null', () => {
  it('renders nothing for medical_reviewer at stage 4', () => {
    const caseData = makeCaseDetail({ status: 'awaiting_medical' });

    setupDiscussionMock([]);

    const { container } = renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="medical_reviewer"
        apiClient={makeMockClient()}
      />,
    );

    // Stage 4 returns null for medical_reviewer — no content
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T8: CaseDetailPage — renders DualTrackSplitView + StageActionPanel + TimelinePanel
// ---------------------------------------------------------------------------

describe('CaseDetailPage — T8: renders all 3 panels after data loads', () => {
  it('renders EEOC Stepper, StageActionPanel (stage 1 intake), and Timeline after fetch', () => {
    const caseData = makeCaseDetail({
      status: 'intake',
      type: 'ada',
    });

    setupPageMocks('hr', caseData);

    const qc = makeQueryClient();
    render(
      <MemoryRouter initialEntries={['/cases/case-uuid-12345678']}>
        <QueryClientProvider client={qc}>
          <CaseDetailPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Case header present
    expect(screen.getByText('CASE-12345678')).toBeInTheDocument();

    // EEOCStepper present
    expect(
      screen.getByRole('navigation', { name: /EEOC accommodation process stages/i }),
    ).toBeInTheDocument();

    // StageActionPanel stage 1 renders intake info
    expect(screen.getByText('Stage 1: Intake — Completed')).toBeInTheDocument();

    // TimelinePanel present (Timeline section heading)
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T9: StageActionPanel stage 3 — medical_reviewer returns null
// ---------------------------------------------------------------------------

describe('StageActionPanel — T9: stage 3 medical_reviewer returns null', () => {
  it('renders nothing for medical_reviewer at stage 3 (no ADA strategy visible)', () => {
    const caseData = makeCaseDetail({ status: 'interactive_process' });

    setupDiscussionMock([]);

    const { container } = renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="medical_reviewer"
        apiClient={makeMockClient()}
      />,
    );

    // medical_reviewer at stage 3 → null
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T10: StageActionPanel stage 5 — medical_reviewer returns null
// ---------------------------------------------------------------------------

describe('StageActionPanel — T10: stage 5 medical_reviewer returns null', () => {
  it('renders nothing for medical_reviewer at stage 5 (no decision visible)', () => {
    const caseData = makeCaseDetail({ status: 'review' });

    setupDiscussionMock([]);

    const { container } = renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="medical_reviewer"
        apiClient={makeMockClient()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows "Decision pending" text for manager at stage 5', () => {
    const caseData = makeCaseDetail({ status: 'review' });

    setupDiscussionMock([]);

    renderWithProviders(
      <StageActionPanel
        caseData={caseData}
        role="manager"
        apiClient={makeMockClient()}
      />,
    );

    expect(screen.getByText(/A decision is being made/i)).toBeInTheDocument();
    // No "Make Decision" button visible to manager
    expect(screen.queryByRole('button', { name: /Make Decision/i })).not.toBeInTheDocument();
  });
});

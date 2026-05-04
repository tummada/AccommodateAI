/**
 * ACMD-139 — Vitest tests for ChecklistPage
 * ACMD-154 — Updated for real API (mock useQuery directly)
 *
 * Tests:
 *   T1:  Renders page title / case header for HR role
 *   T2:  Renders page title / case header for super_admin role
 *   T3:  Shows Access Denied for manager role
 *   T4:  Shows Access Denied for medical_reviewer role
 *   T5:  DeadlineBadge shown with correct day info
 *   T6:  DualLawAlertBanner shown for multiple-type case (dualLaw)
 *   T7:  OverallProgressBar shows Stage 3 of 6
 *   T8:  Stages 1 and 2 are completed (show ✓ badge)
 *   T9:  Stage 3 current panel is visible and expanded
 *   T10: Stages 4, 5, and 6 are locked
 *   T11: Next Stage button is disabled when no mandatory items checked
 *   T12: Next Stage button enabled after all mandatory items done
 *   T13: Next Stage button stays disabled with only item 1 checked
 *   T14: Next Stage button stays disabled with only item 3 checked
 *   T15: clicking stage 1 toggle expands read-only completed view
 *   T16: AuditTrailMini shows completed audit entries
 *   T17: AuditTrailMini has View Full Timeline link
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

import { ChecklistPage } from '@/pages/ChecklistPage';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'e1a2b3c4-d5e6-7890-abcd-ef1234567890';

const createdAt = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
const deadline = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString();

const MOCK_CASE_DETAIL = {
  id: MOCK_CASE_ID,
  companyId: 'company-test-abc',
  employeeId: 'emp-test-001',
  assignedTo: null, assignedAt: null,
  status: 'interactive_process',   // → stage 3
  type: 'multiple',                // dualLaw=true
  aiConsentGiven: false, aiConsentTimestamp: null,
  pwfaPerSe: false,
  requestDescription: 'Standing Desk request',
  medicalInfo: null, aiClassification: null, suggestedAccommodations: null,
  approvedAccommodation: 'Standing Desk',
  denialReason: null,
  interimAccommodationOffered: false, interimAccommodationDescription: null, interimOfferedAt: null,
  deadline,
  closedAt: null, deletedAt: null,
  createdAt,
  updatedAt: new Date().toISOString(),
  ai_consent_status: 'pending',
  managerId: null, denialSubmittedBy: null, denialSubmittedByName: null,
  denialSubmittedAt: null, supervisorReviewDeadline: null,
  denialType: null, denialHardshipCategories: null, denialHardshipNarrative: null,
  denialEvidenceCount: null, denialAlternatives: null, denialEmployeePreference: null,
  denialInteractiveProcessConfirmed: null, denialEngagementAssessment: null,
  denialDiscussionDate: null, denialDiscussionMethod: null,
  denialLegalReviewer: null, denialLegalReviewDate: null, denialLegalOpinion: null,
  timeline: null,
};

const completedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const MOCK_CHECKLIST_ITEMS = [
  {
    id: 'item-001', caseId: MOCK_CASE_ID,
    stepName: 'Record at least 1 discussion (date, method, summary)',
    stepOrder: 1, required: true, completed: false,
    completedAt: null, completedBy: null, createdAt,
  },
  {
    id: 'item-002', caseId: MOCK_CASE_ID,
    stepName: 'Request manager input (if needed)',
    stepOrder: 2, required: false, completed: true,
    completedAt, completedBy: 'user-test-001', createdAt,
  },
  {
    id: 'item-003', caseId: MOCK_CASE_ID,
    stepName: 'Document agreed next steps',
    stepOrder: 3, required: true, completed: false,
    completedAt: null, completedBy: null, createdAt,
  },
];

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
    user: { id: 'user-test-001', email: `${role}@acmd-test.com`, name: `${role} User`, role, companyId: 'company-test-abc' },
    client,
    isAuthenticated: true,
    token: fakeToken,
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

// Setup useQuery to return case data + checklist data
function setupQueries() {
  let callCount = 0;
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === 'case') {
      return { data: MOCK_CASE_DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (key === 'checklist') {
      return { data: { checklist: MOCK_CHECKLIST_ITEMS }, isLoading: false, isError: false, refetch: vi.fn() };
    }
    // Fallback
    callCount++;
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
  return callCount;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderChecklistPage(caseId = MOCK_CASE_ID) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/checklist`]}>
        <Routes>
          <Route path="/cases/:id/checklist" element={<ChecklistPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChecklistPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T1 — HR can view
  it('T1: renders case header for HR role', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(MOCK_CASE_ID);
  });

  // T2 — super_admin can view
  it('T2: renders case header for super_admin role', () => {
    setupAuth('super_admin');
    setupQueries();
    renderChecklistPage();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(MOCK_CASE_ID);
  });

  // T3 — manager blocked
  it('T3: shows Access Denied for manager role', () => {
    setupAuth('manager');
    renderChecklistPage();
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  // T4 — medical_reviewer blocked
  it('T4: shows Access Denied for medical_reviewer role', () => {
    setupAuth('medical_reviewer');
    renderChecklistPage();
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  // T5 — DeadlineBadge with real data (12 days elapsed, ~30 days total)
  it('T5: DeadlineBadge shown with correct day info', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    // DeadlineBadge should show with day elapsed (12 days from createdAt)
    expect(screen.getByRole('status', { name: /Case deadline/i })).toBeInTheDocument();
    expect(screen.getByText(/Day 12 of/)).toBeInTheDocument();
  });

  // T6 — DualLawAlertBanner (type=multiple → dualLaw=true)
  it('T6: DualLawAlertBanner shown for dual-law case', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    expect(
      screen.getByText('This case requires compliance with both ADA and PWFA'),
    ).toBeInTheDocument();
  });

  // T7 — OverallProgressBar (interactive_process → stage 3)
  it('T7: OverallProgressBar shows Stage 3 of 6', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    expect(screen.getByText('Stage 3 of 6')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: /EEOC process progress: Stage 3 of 6/i }),
    ).toBeInTheDocument();
  });

  // T8 — Stages 1 & 2 completed
  it('T8: Stages 1 and 2 are shown as completed', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    const stage1 = screen.getByTestId('stage-1-toggle');
    const stage2 = screen.getByTestId('stage-2-toggle');
    expect(stage1).toBeInTheDocument();
    expect(stage2).toBeInTheDocument();
    expect(stage1).toHaveAttribute('aria-label', expect.stringContaining('Completed'));
    expect(stage2).toHaveAttribute('aria-label', expect.stringContaining('Completed'));
  });

  // T9 — Stage 3 current expanded
  it('T9: Stage 3 current panel is visible and expanded', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    expect(screen.getByTestId('current-stage-panel')).toBeInTheDocument();
    expect(screen.getByTestId('stage-3-current')).toBeInTheDocument();
  });

  // T10 — Stages 4, 5, 6 locked
  it('T10: Stages 4, 5, and 6 are locked', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    expect(screen.getByTestId('stage-4-locked')).toBeInTheDocument();
    expect(screen.getByTestId('stage-5-locked')).toBeInTheDocument();
    expect(screen.getByTestId('stage-6-locked')).toBeInTheDocument();
  });

  // T11 — Next Stage button disabled (item1 and item3 are both required but not completed)
  it('T11: Next Stage button is disabled when no mandatory items checked', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    const btn = screen.getByTestId('next-stage-button');
    expect(btn).toBeDisabled();
  });

  // T12 — All mandatory items complete → button enabled
  it('T12: Next Stage button enabled when all mandatory items complete', () => {
    setupAuth('hr');
    // Override checklist: all required items completed
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (key === 'case') {
        return { data: MOCK_CASE_DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'checklist') {
        const allDone = MOCK_CHECKLIST_ITEMS.map((i) => ({
          ...i,
          completed: i.required ? true : i.completed,
          completedAt: i.required ? new Date().toISOString() : i.completedAt,
        }));
        return { data: { checklist: allDone }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    });
    renderChecklistPage();
    const btn = screen.getByTestId('next-stage-button');
    expect(btn).not.toBeDisabled();
  });

  // T13 — Only item 1 complete → button still disabled
  it('T13: Next Stage button stays disabled with only item 1 checked', () => {
    setupAuth('hr');
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (key === 'case') {
        return { data: MOCK_CASE_DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'checklist') {
        const partial = MOCK_CHECKLIST_ITEMS.map((i) => ({
          ...i,
          completed: i.id === 'item-001' ? true : i.completed,
          completedAt: i.id === 'item-001' ? new Date().toISOString() : i.completedAt,
        }));
        return { data: { checklist: partial }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    });
    renderChecklistPage();
    const btn = screen.getByTestId('next-stage-button');
    expect(btn).toBeDisabled();
  });

  // T14 — Only item 3 complete → button still disabled
  it('T14: Next Stage button stays disabled with only item 3 checked', () => {
    setupAuth('hr');
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (key === 'case') {
        return { data: MOCK_CASE_DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'checklist') {
        const partial = MOCK_CHECKLIST_ITEMS.map((i) => ({
          ...i,
          completed: i.id === 'item-003' ? true : i.completed,
          completedAt: i.id === 'item-003' ? new Date().toISOString() : i.completedAt,
        }));
        return { data: { checklist: partial }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    });
    renderChecklistPage();
    const btn = screen.getByTestId('next-stage-button');
    expect(btn).toBeDisabled();
  });

  // T15 — Completed stage toggle
  it('T15: clicking stage 1 toggle expands read-only completed view', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    const stage1 = screen.getByTestId('stage-1-toggle');
    expect(screen.queryByTestId('completed-stage-panel-1')).not.toBeInTheDocument();
    fireEvent.click(stage1);
    expect(screen.getByTestId('completed-stage-panel-1')).toBeInTheDocument();
    fireEvent.click(stage1);
    expect(screen.queryByTestId('completed-stage-panel-1')).not.toBeInTheDocument();
  });

  // T16 — AuditTrailMini shows completed audit entries (item-002 is completed)
  it('T16: AuditTrailMini shows completed audit entries', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage();
    // item-002 completed → should appear in audit entries with eventCode
    expect(screen.getByText(/checklist.item_completed/i)).toBeInTheDocument();
  });

  // T17 — View Full Timeline link
  it('T17: AuditTrailMini has View Full Timeline link', () => {
    setupAuth('hr');
    setupQueries();
    renderChecklistPage(MOCK_CASE_ID);
    const link = screen.getByRole('link', { name: /view full case timeline/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', `/cases/${MOCK_CASE_ID}/timeline`);
  });
});

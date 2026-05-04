/**
 * ACMD-148 — Vitest tests for PwfaInterimPage (SCR-PWFA-TEMP)
 * ACMD-157 — Updated for real API (mock useQuery + useQueryClient)
 *
 * 24 tests covering all acceptance criteria.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoist mocks
vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return { ...actual, useAuth: vi.fn() };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useQueryClient: vi.fn(),
  };
});

import { PwfaInterimPage } from '@/pages/PwfaInterimPage';
import { useAuth } from '@/lib/auth-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;
const mockUseQueryClient = useQueryClient as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'case-001';

const MOCK_INTERIM_DATA = {
  hasInterim: true,
  interim: {
    offered: true,
    description: 'Flexible start time (9-11am window) + 2 additional 15-min breaks per shift',
    offeredAt: '2026-04-05T10:30:00Z',
    status: 'active' as const,
    endedAt: null,
    endReason: null,
  },
};

const MOCK_INTERIM_DATA_NO_INTERIM = {
  hasInterim: false,
  interim: null,
};

const MOCK_CASE_DETAIL = {
  id: MOCK_CASE_ID,
  companyId: 'company-test-abc',
  employeeId: 'emp-test-001',
  assignedTo: null,
  assignedAt: null,
  status: 'interactive_process',
  type: 'pwfa',
  deadline: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

type RoleType = 'hr' | 'super_admin' | 'medical_reviewer' | 'manager';

function setupAuth(role: RoleType) {
  mockUseAuth.mockReturnValue({
    user: { id: 'user-test-001', email: `${role}@acmd-test.com`, name: `${role} User`, role, companyId: 'company-test-abc' },
    client: {},
    isAuthenticated: true,
    token: 'fake-token',
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function setupQueries(opts?: { hasInterim?: boolean }) {
  const hasInterim = opts?.hasInterim ?? true;
  const mockQueryClient = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  };
  mockUseQueryClient.mockReturnValue(mockQueryClient);
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === 'interim-accommodation') {
      return {
        data: hasInterim ? MOCK_INTERIM_DATA : MOCK_INTERIM_DATA_NO_INTERIM,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (key === 'case') {
      return {
        data: MOCK_CASE_DETAIL,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
  return mockQueryClient;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(caseId = MOCK_CASE_ID) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/pwfa-interim`]}>
        <Routes>
          <Route path="/cases/:id/pwfa-interim" element={<PwfaInterimPage />} />
          <Route path="/cases/:id" element={<div data-testid="case-detail-page">Case Detail</div>} />
          <Route path="/cases/:id/decision" element={<div data-testid="decision-page">Decision Page</div>} />
          <Route path="/cases/:id/timeline" element={<div data-testid="timeline-page">Timeline Page</div>} />
          <Route path="/cases" element={<div data-testid="cases-page">Cases</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PwfaInterimPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('T01: HR renders page with active interim', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('pwfa-interim-page')).toBeInTheDocument();
    expect(screen.getByTestId('active-interim-card')).toBeInTheDocument();
    expect(screen.getByText('Active Interim Accommodation')).toBeInTheDocument();
  });

  it('T02: HR renders no-interim state with 5-day warning after toggle', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    fireEvent.click(screen.getByTestId('toggle-interim-state'));
    expect(screen.getByTestId('five-day-warning-banner')).toBeInTheDocument();
    expect(screen.getByTestId('no-interim-empty-state')).toBeInTheDocument();
  });

  it('T03: Manager renders restricted view', () => {
    setupAuth('manager');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('manager-interim-view')).toBeInTheDocument();
    expect(screen.getByText('An interim accommodation is in place for this employee.')).toBeInTheDocument();
  });

  it('T04: Manager does NOT see action buttons', () => {
    setupAuth('manager');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.queryByTestId('interim-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('extend-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('convert-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('end-btn')).not.toBeInTheDocument();
  });

  it('T05: Manager does NOT see leave integration panel', () => {
    setupAuth('manager');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.queryByTestId('leave-integration-panel')).not.toBeInTheDocument();
  });

  it('T06: Manager does NOT see review history', () => {
    setupAuth('manager');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.queryByTestId('review-history')).not.toBeInTheDocument();
  });

  it('T07: Set Interim modal opens', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    expect(screen.getByTestId('no-interim-empty-state')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('set-interim-btn'));
    expect(screen.getByRole('dialog', { name: /Set Interim Accommodation/i })).toBeInTheDocument();
  });

  it('T08: Set Interim modal validates required fields', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    fireEvent.click(screen.getByTestId('set-interim-btn'));
    fireEvent.click(screen.getByTestId('set-interim-submit'));
    expect(screen.getByTestId('set-interim-errors')).toBeInTheDocument();
    expect(screen.getByText(/Interim accommodation type is required/i)).toBeInTheDocument();
  });

  it('T09: Set Interim modal validates description min 10 chars', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    fireEvent.click(screen.getByTestId('set-interim-btn'));
    fireEvent.change(screen.getByLabelText(/Interim Accommodation Type/i), { target: { value: 'Additional breaks' } });
    fireEvent.change(screen.getByLabelText(/^Description/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('set-interim-submit'));
    expect(screen.getByText(/Description must be at least 10 characters/i)).toBeInTheDocument();
  });

  it('T10: Set Interim modal successful submit', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    fireEvent.click(screen.getByTestId('set-interim-btn'));
    fireEvent.change(screen.getByLabelText(/Interim Accommodation Type/i), { target: { value: 'Additional breaks' } });
    fireEvent.change(screen.getByLabelText(/^Description/i), { target: { value: 'This is a long enough description for testing' } });
    fireEvent.change(screen.getByLabelText(/Review Date/i), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText(/Assigned Reviewer/i), { target: { value: 'Sarah Kim (HR)' } });
    fireEvent.click(screen.getByTestId('set-interim-submit'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-interim-card')).toBeInTheDocument();
  });

  it('T11: Extend Interim modal opens', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    fireEvent.click(screen.getByTestId('extend-btn'));
    expect(screen.getByRole('dialog', { name: /Extend Interim Accommodation/i })).toBeInTheDocument();
  });

  it('T12: Extend Interim modal validates reason min 20 chars', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    fireEvent.click(screen.getByTestId('extend-btn'));
    fireEvent.click(screen.getByTestId('extend-submit'));
    expect(screen.getByTestId('extend-errors')).toBeInTheDocument();
    expect(screen.getByText(/Reason for extension must be at least 20 characters/i)).toBeInTheDocument();
  });

  it('T13: Convert to Permanent modal shows both radio options', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    fireEvent.click(screen.getByTestId('convert-btn'));
    expect(screen.getByRole('dialog', { name: /Convert Interim to Permanent/i })).toBeInTheDocument();
    expect(screen.getByText(/Yes — use interim details as permanent accommodation/i)).toBeInTheDocument();
    expect(screen.getByText(/No — I want to modify the accommodation in SCR-APPROVE/i)).toBeInTheDocument();
  });

  it('T14: End Interim modal requires confirmation checkbox', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    fireEvent.click(screen.getByTestId('end-btn'));
    const reasons = screen.getAllByRole('radio');
    const first = reasons.find((r) => r.closest('label')?.textContent?.includes('Permanent accommodation'));
    if (first) fireEvent.click(first);
    fireEvent.click(screen.getByTestId('end-submit'));
    expect(screen.getByTestId('end-errors')).toBeInTheDocument();
    expect(screen.getByText(/You must confirm the employee no longer requires accommodation/i)).toBeInTheDocument();
  });

  it('T15: Document Not Needed modal opens and validates', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    fireEvent.click(screen.getByTestId('warning-document-btn'));
    expect(screen.getByRole('dialog', { name: /Document: Interim Accommodation Not Needed/i })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('document-submit'));
    expect(screen.getByTestId('document-errors')).toBeInTheDocument();
  });

  it('T16: Leave Integration Panel visible for HR', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('leave-integration-panel')).toBeInTheDocument();
    expect(screen.getByText('FMLA Leave')).toBeInTheDocument();
    expect(screen.getByText('PWFA Leave')).toBeInTheDocument();
  });

  it('T17: 5-day warning banner shows in no-interim state', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    const banner = screen.getByTestId('five-day-warning-banner');
    expect(banner.textContent).toContain('WARNING: No interim accommodation set');
  });

  it('T18: 5-day warning banner shows days exceeded text', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: false });
    renderPage();
    const banner = screen.getByTestId('five-day-warning-banner');
    expect(banner.textContent).toContain('Days without interim: 12');
  });

  it('T19: Back navigation link is rendered', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    const backLink = screen.getByTestId('back-to-case');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/cases/case-001');
  });

  it('T20: Medical Reviewer renders page but RoleGuard blocks in App.tsx', () => {
    setupAuth('medical_reviewer');
    setupQueries({ hasInterim: true });
    renderPage();
    // In production, App.tsx RoleGuard blocks medical_reviewer.
    // Component-level: normalizeRole keeps 'medical_reviewer' which is not 'manager',
    // so it falls through to the HR/admin view.
    expect(screen.getByTestId('pwfa-interim-page')).toBeInTheDocument();
    expect(screen.queryByTestId('manager-interim-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-interim-card')).toBeInTheDocument();
    expect(screen.getByTestId('pwfa-compliance-banner')).toBeInTheDocument();
  });

  it('T21: DeadlineBadge renders with deadline urgency text', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    // DeadlineBadge renders with role="img" and an aria-label containing the urgency text.
    // Mock deadline is today+22 days → level 2 → "Action needed: X days remaining"
    const badge = screen.getByRole('img', { name: /days/i });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('aria-label', expect.stringMatching(/days remaining|days$/i));
    expect(badge.textContent).toMatch(/\d+ days/);
  });

  it('T22: PWFA Compliance Banner expands on click', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('pwfa-compliance-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/What is an interim accommodation/i));
    expect(screen.getByTestId('pwfa-expanded-info')).toBeInTheDocument();
  });

  it('T23: Review History shows entries for HR', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('review-history')).toBeInTheDocument();
    const sarahEntries = screen.getAllByText(/Sarah Kim/);
    expect(sarahEntries.length).toBeGreaterThan(0);
  });

  it('T24: Timeline panel shows events', () => {
    setupAuth('hr');
    setupQueries({ hasInterim: true });
    renderPage();
    expect(screen.getByTestId('timeline-panel')).toBeInTheDocument();
    expect(screen.getByText(/Interim accommodation created/i)).toBeInTheDocument();
  });
});

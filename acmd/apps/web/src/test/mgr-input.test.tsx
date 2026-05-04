/**
 * ACMD-143 / ACMD-158 — Vitest tests for ManagerInputPage
 *
 * Updated for Phase 7B real API migration — all mock-data tests now
 * drive the page through mocked useQuery (same pattern as checklist.test.tsx).
 *
 * Tests:
 *   T01: renders Mode A input form with all 5 sections
 *   T02: Mode A required fields are marked aria-required="true"
 *   T03: Mode A medical keyword triggers MedicalKeywordWarning (role="alert")
 *   T04: Mode A medical keyword warning hidden when no keywords present
 *   T05: Mode A auto-save status area has aria-live="polite"
 *   T06: Mode A Submit button disabled (aria-disabled) when required fields empty
 *   T07: Mode A SubmitConfirmationDialog opens on Submit click (requires fields filled)
 *   T08: Mode A ExtensionRequestPanel opens on Request Extension click
 *   T09: overdue daysRemaining shows red overdue banner
 *   T10: approaching deadline (2 days) shows yellow banner
 *   T11: alreadySubmitted shows read-only view with submitted badge
 *   T12: loading skeleton shown when isLoading=true
 *   T13: Mode B approved renders outcome card + acknowledgment panel
 *   T14: Mode B denied renders "Case resolved — no action required."
 *   T15: Mode B Acknowledged button disabled until checkbox checked
 *   T16: Mode B approved: clicking Acknowledged after checkbox redirects to /dashboard
 *   T17: DualRoleContextBanner shown for dual-role user (manager + superAdmin)
 *   T18: shows access denied for non-manager user
 *   T19: DualRoleContextBanner links to correct case detail URL
 *   T20: 401 error redirects to /login
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

import { ManagerInputPage } from '@/pages/ManagerInputPage';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Mock data types
// ---------------------------------------------------------------------------

type MockFormData = {
  caseId: string;
  employeeName: string;
  department: string;
  positionTitle: string;
  accommodationCategory: string;
  hrRequesterName: string;
  responseDeadline: string;
  daysRemaining: number;
  alreadySubmitted: boolean;
  submittedAt: string | null;
  mode: 'form' | 'acknowledgment';
  outcomeType: 'approved' | 'denied' | null;
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'case-mgr-001';

const MOCK_FORM_BASE: MockFormData = {
  caseId: MOCK_CASE_ID,
  employeeName: 'Jordan Rivera',
  department: 'Engineering',
  positionTitle: 'Software Engineer',
  accommodationCategory: 'Schedule',
  hrRequesterName: 'HR — Maria Chen',
  responseDeadline: '04/15/2026',
  daysRemaining: 2,
  alreadySubmitted: false,
  submittedAt: null,
  mode: 'form',
  outcomeType: null,
};

const MOCK_FORM_OVERDUE: MockFormData = { ...MOCK_FORM_BASE, daysRemaining: -1, responseDeadline: '04/13/2026' };
const MOCK_FORM_SUBMITTED: MockFormData = { ...MOCK_FORM_BASE, alreadySubmitted: true, submittedAt: '04/10/2026' };
const MOCK_ACK_APPROVED: MockFormData = { ...MOCK_FORM_BASE, mode: 'acknowledgment', outcomeType: 'approved' };
const MOCK_ACK_DENIED: MockFormData = { ...MOCK_FORM_BASE, mode: 'acknowledgment', outcomeType: 'denied', daysRemaining: -1 };

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

function setupAuth(roles?: string[]) {
  const fakeToken = makeFakeAccessToken({ role: 'manager' });
  const client = createAuthenticatedClient({
    getAccessToken: () => fakeToken,
    onTokenRefreshed: vi.fn(),
    onAuthLost: vi.fn(),
  });
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-mgr-001',
      email: 'manager@acmd-test.com',
      name: 'Test Manager',
      role: 'manager',
      roles: roles ?? ['manager'],
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

function setupQuery(data: MockFormData | null = MOCK_FORM_BASE, overrides?: object) {
  mockUseQuery.mockReturnValue({
    data: data ?? undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(caseId = MOCK_CASE_ID) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/mgr/${caseId}`]}>
        <Routes>
          <Route path="/mgr/:id" element={<ManagerInputPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Helper: fill all required fields
// ---------------------------------------------------------------------------
function fillRequiredFields() {
  fireEvent.change(screen.getByTestId('field-essentialFunctions'), {
    target: { value: 'Write code, review PRs, attend standups' },
  });
  fireEvent.change(screen.getByTestId('field-currentWorkspace'), {
    target: { value: 'Open office with standing desk option' },
  });
  fireEvent.change(screen.getByTestId('field-scheduleFlexibility'), {
    target: { value: 'flexible' },
  });
  fireEvent.change(screen.getByTestId('field-workflowImpact'), {
    target: { value: 'minor' },
  });
  fireEvent.change(screen.getByTestId('field-teamMemberImpact'), {
    target: { value: 'none' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManagerInputPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T01 — Mode A renders all 5 sections
  it('T01: renders Mode A input form with all 5 sections', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    expect(screen.getByTestId('mgr-input-page')).toBeInTheDocument();
    expect(screen.getByTestId('page-header-title')).toHaveTextContent('Accommodation Input Request');
    expect(screen.getByText('Job Task Information')).toBeInTheDocument();
    expect(screen.getByText('Workspace / Physical Environment')).toBeInTheDocument();
    expect(screen.getByText('Schedule Flexibility')).toBeInTheDocument();
    expect(screen.getByText('Team Impact Assessment')).toBeInTheDocument();
    expect(screen.getByText('Manager Notes')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-info-box')).toBeInTheDocument();
  });

  // T02 — Required fields have aria-required="true"
  it('T02: Mode A required fields are marked aria-required="true"', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    expect(screen.getByTestId('field-essentialFunctions')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('field-currentWorkspace')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('field-scheduleFlexibility')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('field-workflowImpact')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('field-teamMemberImpact')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('field-managerNotes')).not.toHaveAttribute('aria-required', 'true');
  });

  // T03 — Medical keyword triggers warning after 1s debounce
  it('T03: Mode A medical keyword in textarea triggers MedicalKeywordWarning (role="alert")', async () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    expect(screen.queryByTestId('medical-keyword-warning')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('field-essentialFunctions'), {
      target: { value: 'Manage team and discuss medical condition' },
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('medical-keyword-warning')).toBeInTheDocument();
    expect(screen.getByTestId('medical-keyword-warning')).toHaveAttribute('role', 'alert');
  });

  // T04 — No medical keyword: warning hidden
  it('T04: Mode A medical keyword warning hidden when no keywords present', async () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    fireEvent.change(screen.getByTestId('field-essentialFunctions'), {
      target: { value: 'Write code, review pull requests, mentor junior developers' },
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('medical-keyword-warning')).not.toBeInTheDocument();
  });

  // T05 — Auto-save status has aria-live="polite"
  it('T05: Mode A auto-save status area has aria-live="polite"', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    const autoSave = screen.getByTestId('auto-save-status');
    expect(autoSave).toBeInTheDocument();
    expect(autoSave).toHaveAttribute('aria-live', 'polite');
  });

  // T06 — Submit button disabled when required fields empty
  it('T06: Mode A Submit button has aria-disabled="true" when required fields are empty', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    const submitBtn = screen.getByTestId('submit-response-btn');
    expect(submitBtn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('submit-confirmation-dialog')).not.toBeInTheDocument();
  });

  // T07 — SubmitConfirmationDialog opens when required fields filled
  it('T07: Mode A SubmitConfirmationDialog opens on Submit click when required fields filled', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    fillRequiredFields();

    const submitBtn = screen.getByTestId('submit-response-btn');
    expect(submitBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(submitBtn);

    const dialog = screen.getByTestId('submit-confirmation-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  // T08 — ExtensionRequestPanel opens on Request Extension click
  it('T08: Mode A ExtensionRequestPanel opens on Request Extension click', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    expect(screen.queryByTestId('extension-request-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('request-extension-btn'));

    const panel = screen.getByTestId('extension-request-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
  });

  // T09 — Overdue daysRemaining shows red overdue banner
  it('T09: overdue daysRemaining shows red overdue banner', () => {
    setupAuth();
    setupQuery(MOCK_FORM_OVERDUE);
    renderPage();

    const banner = screen.getByTestId('deadline-banner-overdue');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('HR has been notified');
  });

  // T10 — Approaching deadline shows yellow banner
  it('T10: approaching deadline (2 days) shows yellow deadline banner', () => {
    setupAuth();
    setupQuery(MOCK_FORM_BASE); // daysRemaining: 2 → yellow banner
    renderPage();

    const banner = screen.getByTestId('deadline-banner-yellow');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Please respond by');
    expect(banner).toHaveTextContent('2 days remaining');
  });

  // T11 — alreadySubmitted shows read-only view with badge
  it('T11: alreadySubmitted shows read-only view with Submitted badge', () => {
    setupAuth();
    setupQuery(MOCK_FORM_SUBMITTED);
    renderPage();

    expect(screen.getByTestId('mgr-input-page')).toBeInTheDocument();
    expect(screen.getByTestId('submitted-badge')).toBeInTheDocument();
    expect(screen.getByTestId('submitted-badge')).toHaveTextContent('Submitted on');
    expect(screen.queryByTestId('submit-response-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-draft-btn')).not.toBeInTheDocument();
  });

  // T12 — Loading skeleton shown when isLoading=true
  it('T12: loading skeleton shown when isLoading=true', () => {
    setupAuth();
    setupQuery(null, { isLoading: true });
    renderPage();

    expect(screen.getByTestId('manager-input-skeleton')).toBeInTheDocument();
  });

  // T13 — Mode B approved renders outcome card + acknowledgment panel
  it('T13: Mode B approved renders outcome card and acknowledgment panel', () => {
    setupAuth();
    setupQuery(MOCK_ACK_APPROVED);
    renderPage();

    expect(screen.getByTestId('mgr-input-page')).toBeInTheDocument();
    expect(screen.getByTestId('outcome-card-approved')).toBeInTheDocument();
    expect(screen.getByTestId('acknowledgment-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ack-checkbox')).toBeInTheDocument();
    expect(screen.getByTestId('acknowledged-btn')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-info-box')).toBeInTheDocument();
  });

  // T14 — Mode B denied renders "Case resolved — no action required."
  it('T14: Mode B denied renders "Case resolved — no action required." without denial reason', () => {
    setupAuth();
    setupQuery(MOCK_ACK_DENIED);
    renderPage();

    expect(screen.getByTestId('outcome-card-denied')).toBeInTheDocument();
    expect(screen.getByTestId('case-resolved-message')).toHaveTextContent(
      'Case resolved — no action required.',
    );
    expect(screen.queryByText(/denial reason/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/EEOC/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/undue hardship/i)).not.toBeInTheDocument();
  });

  // T15 — Acknowledged button disabled until checkbox checked
  it('T15: Mode B Acknowledged button has aria-disabled="true" until checkbox is checked', () => {
    setupAuth();
    setupQuery(MOCK_ACK_APPROVED);
    renderPage();

    const btn = screen.getByTestId('acknowledged-btn');
    expect(btn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByTestId('ack-checkbox'));

    expect(btn).not.toHaveAttribute('aria-disabled');
  });

  // T16 — Mode B approved: Acknowledged → redirect to /dashboard
  it('T16: Mode B approved: clicking Acknowledged after checkbox redirects to /dashboard', () => {
    setupAuth();
    setupQuery(MOCK_ACK_APPROVED);
    renderPage();

    fireEvent.click(screen.getByTestId('ack-checkbox'));
    fireEvent.click(screen.getByTestId('acknowledged-btn'));

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  // T17 — DualRoleContextBanner shown for dual-role user
  it('T17: DualRoleContextBanner shown when user has both manager and superAdmin roles', () => {
    setupAuth(['manager', 'superAdmin']);
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    const banner = screen.getByTestId('dual-role-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent('Department Manager');
    expect(banner).toHaveTextContent('Operational information only');
  });

  // T18 — SEC-001: Non-manager user sees access denied
  it('T18: shows access denied for non-manager user', () => {
    const fakeToken = makeFakeAccessToken({ role: 'hr' });
    const client = createAuthenticatedClient({
      getAccessToken: () => fakeToken,
      onTokenRefreshed: vi.fn(),
      onAuthLost: vi.fn(),
    });
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-hr-001',
        email: 'hr@acmd-test.com',
        name: 'HR User',
        role: 'hr',
        roles: ['hr'],
        companyId: 'company-test-abc',
      },
      client,
      isAuthenticated: true,
      token: fakeToken,
      bootstrap: 'authenticated' as const,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderPage();

    const denied = screen.getByTestId('access-denied');
    expect(denied).toBeInTheDocument();
    expect(denied).toHaveTextContent('Access Denied');
    expect(denied).toHaveTextContent('You do not have permission to access this page.');
    expect(screen.queryByTestId('mgr-input-page')).not.toBeInTheDocument();
  });

  // T19 — DualRoleContextBanner links to correct case detail URL
  it('T19: DualRoleContextBanner links to correct case detail URL', () => {
    setupAuth(['manager', 'superAdmin']);
    setupQuery(MOCK_FORM_BASE);
    renderPage();

    const banner = screen.getByTestId('dual-role-banner');
    const link = banner.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain(`/cases/${MOCK_CASE_ID}`);
  });

  // T20 — 401 error on form load redirects to /login
  it('T20: 401 error on form load redirects to /login', () => {
    setupAuth();
    const err401 = Object.assign(new Error('Unauthorized'), { status: 401 });
    setupQuery(null, { isLoading: false, isError: true, error: err401 });
    renderPage();

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });
});

/**
 * ACMD-158 — Vitest tests for ManagerInputPage (Phase 7B real API migration)
 *
 * Tests:
 *   T1:  Loading state renders skeleton (isLoading=true)
 *   T2:  Form view renders with manager input form data (mode='form')
 *   T3:  Acknowledgment mode renders correctly (mode='acknowledgment')
 *   T4:  alreadySubmitted shows submitted-badge and read-only view
 *   T5:  Submit button disabled when required fields empty
 *   T6:  Submit button enabled when all required fields filled
 *   T7:  Submit calls submitManagerInput and shows success state
 *   T8:  401 on form load redirects to /login
 *   T9:  Non-401 error shows error state
 *   T10: Access denied for non-manager role
 *   T11: Acknowledgment panel renders ack-checkbox and acknowledged-btn
 *   T12: Privacy info box is always rendered
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('@/lib/api/managerInput', () => ({
  getManagerInputForm: vi.fn(),
  submitManagerInput: vi.fn(),
}));

import { ManagerInputPage } from '@/pages/ManagerInputPage';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { submitManagerInput } from '@/lib/api/managerInput';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'case-mgr-001';

const MOCK_FORM_DATA = {
  caseId: MOCK_CASE_ID,
  employeeName: 'Jordan Rivera',
  department: 'Engineering',
  positionTitle: 'Software Engineer',
  accommodationCategory: 'Schedule',
  hrRequesterName: 'HR — Maria Chen',
  responseDeadline: '04/25/2026',
  daysRemaining: 8,
  alreadySubmitted: false,
  submittedAt: null,
  mode: 'form' as const,
  outcomeType: null,
};

const MOCK_FORM_DATA_SUBMITTED = {
  ...MOCK_FORM_DATA,
  alreadySubmitted: true,
  submittedAt: '04/10/2026',
};

const MOCK_ACKNOWLEDGMENT_DATA = {
  ...MOCK_FORM_DATA,
  mode: 'acknowledgment' as const,
  outcomeType: 'approved' as const,
};

const MOCK_ACK_DENIED = {
  ...MOCK_FORM_DATA,
  mode: 'acknowledgment' as const,
  outcomeType: 'denied' as const,
};

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;
const mockSubmitManagerInput = submitManagerInput as ReturnType<typeof vi.fn>;

type RoleType = 'manager' | 'hr' | 'super_admin' | 'medical_reviewer';

function setupAuth(role: RoleType) {
  const fakeToken = makeFakeAccessToken({ role });
  const client = createAuthenticatedClient({
    getAccessToken: () => fakeToken,
    onTokenRefreshed: vi.fn(),
    onAuthLost: vi.fn(),
  });
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-mgr-001',
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

interface QueryState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
}

function setupQuery(overrides?: Partial<QueryState>) {
  const state: QueryState = {
    data: MOCK_FORM_DATA,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockUseQuery as any).mockReturnValue(state);
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
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManagerInputPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T1 — Loading state
  it('T1: renders loading skeleton when isLoading=true', () => {
    setupAuth('manager');
    setupQuery({ data: undefined, isLoading: true, isError: false });
    renderPage();
    expect(screen.getByTestId('manager-input-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading manager input form/i })).toBeInTheDocument();
  });

  // T2 — Form view renders with API data
  it('T2: form view renders with manager input form data', () => {
    setupAuth('manager');
    setupQuery();
    renderPage();
    expect(screen.getByTestId('page-header-title')).toBeInTheDocument();
    expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText(/Software Engineer/)).toBeInTheDocument();
  });

  // T3 — Acknowledgment mode renders correctly (mode='acknowledgment')
  it('T3: acknowledgment mode renders correctly', () => {
    setupAuth('manager');
    setupQuery({ data: MOCK_ACKNOWLEDGMENT_DATA });
    renderPage();
    expect(screen.getByTestId('acknowledgment-header')).toBeInTheDocument();
    expect(screen.getByTestId('acknowledgment-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ack-checkbox')).toBeInTheDocument();
  });

  // T4 — alreadySubmitted shows submitted-badge
  it('T4: alreadySubmitted shows submitted-badge and prevents resubmission', () => {
    setupAuth('manager');
    setupQuery({ data: MOCK_FORM_DATA_SUBMITTED });
    renderPage();
    expect(screen.getByTestId('submitted-badge')).toBeInTheDocument();
    expect(screen.getByText(/Submitted on 04\/10\/2026/)).toBeInTheDocument();
    // Submit button should not exist in already-submitted view
    expect(screen.queryByTestId('submit-response-btn')).not.toBeInTheDocument();
  });

  // T5 — Submit button disabled when required fields empty
  it('T5: submit button disabled when required fields not filled', () => {
    setupAuth('manager');
    setupQuery();
    renderPage();
    const submitBtn = screen.getByTestId('submit-response-btn');
    expect(submitBtn).toBeDisabled();
  });

  // T6 — Submit button enabled when required fields filled
  it('T6: submit button enabled when all required fields filled', () => {
    setupAuth('manager');
    setupQuery();
    renderPage();

    fireEvent.change(screen.getByTestId('field-essentialFunctions'), {
      target: { value: 'Core duty: writing code' },
    });
    fireEvent.change(screen.getByTestId('field-currentWorkspace'), {
      target: { value: 'Open floor plan office' },
    });
    fireEvent.change(screen.getByTestId('field-scheduleFlexibility'), {
      target: { value: 'flexible' },
    });
    fireEvent.change(screen.getByTestId('field-workflowImpact'), {
      target: { value: 'none' },
    });
    fireEvent.change(screen.getByTestId('field-teamMemberImpact'), {
      target: { value: 'none' },
    });

    expect(screen.getByTestId('submit-response-btn')).not.toBeDisabled();
  });

  // T7 — Submit calls submitManagerInput and shows success state
  it('T7: submit calls submitManagerInput and shows success state', async () => {
    setupAuth('manager');
    setupQuery();
    mockSubmitManagerInput.mockResolvedValueOnce({ success: true });
    renderPage();

    // Fill required fields
    fireEvent.change(screen.getByTestId('field-essentialFunctions'), {
      target: { value: 'Core duty: writing code' },
    });
    fireEvent.change(screen.getByTestId('field-currentWorkspace'), {
      target: { value: 'Open floor plan office' },
    });
    fireEvent.change(screen.getByTestId('field-scheduleFlexibility'), {
      target: { value: 'flexible' },
    });
    fireEvent.change(screen.getByTestId('field-workflowImpact'), {
      target: { value: 'none' },
    });
    fireEvent.change(screen.getByTestId('field-teamMemberImpact'), {
      target: { value: 'none' },
    });

    // Open confirmation dialog
    fireEvent.click(screen.getByTestId('submit-response-btn'));
    expect(screen.getByTestId('submit-confirmation-dialog')).toBeInTheDocument();

    // Confirm submit
    fireEvent.click(screen.getByTestId('dialog-submit-btn'));

    await waitFor(() => {
      expect(mockSubmitManagerInput).toHaveBeenCalledOnce();
      expect(screen.getByTestId('submit-success')).toBeInTheDocument();
    });
  });

  // T8 — 401 on form load redirects to /login
  it('T8: 401 error redirects to /login', () => {
    setupAuth('manager');
    const err401 = Object.assign(new Error('Unauthorized'), { status: 401 });
    setupQuery({ data: undefined, isLoading: false, isError: true, error: err401 });
    renderPage();
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  // T9 — Non-401 error shows error state
  it('T9: non-401 error shows error state', () => {
    setupAuth('manager');
    const err500 = Object.assign(new Error('Server Error'), { status: 500 });
    setupQuery({ data: undefined, isLoading: false, isError: true, error: err500 });
    renderPage();
    expect(screen.getByTestId('manager-input-error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Could not load request/i)).toBeInTheDocument();
  });

  // T10 — Access denied for non-manager role
  it('T10: access denied for HR role (non-manager)', () => {
    setupAuth('hr');
    renderPage();
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  // T11 — Acknowledgment panel renders correctly with denied outcome
  it('T11: acknowledgment panel for denied outcome renders case-resolved-message', () => {
    setupAuth('manager');
    setupQuery({ data: MOCK_ACK_DENIED });
    renderPage();
    expect(screen.getByTestId('acknowledgment-panel')).toBeInTheDocument();
    expect(screen.getByTestId('case-resolved-message')).toBeInTheDocument();
    expect(screen.getByText(/Case resolved — no action required/)).toBeInTheDocument();
  });

  // T12 — Privacy info box always rendered
  it('T12: privacy info box is always rendered for manager', () => {
    setupAuth('manager');
    setupQuery();
    renderPage();
    expect(screen.getByTestId('privacy-info-box')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /privacy notice/i })).toBeInTheDocument();
  });
});

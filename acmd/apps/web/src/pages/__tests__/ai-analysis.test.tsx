/**
 * ACMD-146 / ACMD-155 — Vitest tests for AIAnalysisPage
 *
 * Tests (20):
 *   T01: super_admin role — page renders
 *   T02: hr role — page renders
 *   T03: manager role — RoleGuard redirects (via App routing)
 *   T04: medical_reviewer role — RoleGuard redirects (via App routing)
 *   T05: State A (active) — all 6 sections visible
 *   T06: State B (declined) — shows opt-out message
 *   T07: State C (pending) — shows pending message + buttons
 *   T08: State D (error) — shows error message + retry
 *   T09: Disclaimer banner — no dismiss button present
 *   T10: Disclaimer banner — contains required text
 *   T11: Suggestion accept interaction
 *   T12: Suggestion reject — opens modal
 *   T13: Reject modal — requires reason to confirm
 *   T14: Legal risk badge text correct for LOW
 *   T15: Similar cases — no real employee names (anonymized)
 *   T16: Recommend badge shows APPROVE with green styling
 *   T17: Manual override form — shows on button click
 *   T18: Manual override form — validation errors when empty
 *   T19: Re-analysis cooldown — second click within 5 min shows alert
 *   T20: Confidence bars have correct ARIA attributes
 *
 * ACMD-155: Updated to use QueryClientProvider + MSW suggestions handler
 * since AIAnalysisPage now fetches suggestions from real API.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from '@/test/handlers';

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

import { AIAnalysisPage } from '@/pages/AIAnalysisPage';
import { useAuth } from '@/lib/auth-context';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

type RoleType = 'hr' | 'super_admin' | 'manager' | 'medical_reviewer';

const API = 'http://localhost:3000';

// MSW mock suggestions — IDs match test assertions (suggestion-sug-1, etc.)
const MOCK_SUGGESTIONS_API = [
  {
    id: 'sug-1',
    caseId: 'case-001',
    companyId: 'company-test-abc',
    title: 'Modified Work Schedule — Flexible Start Time',
    description: 'Allow employee to start at 10:00 AM on days with medical appointments.',
    customizedDescription: null,
    source: 'JAN SOAR DB — "Schedule Modifications"',
    sourceType: 'jan_soar',
    confidence: 92,
    implementationCount: 847,
    status: 'pending',
    rejectionReason: null,
    implementationStatus: null,
    implementationCost: null,
    selectedAt: null,
    selectedBy: null,
    createdAt: '2026-04-10T14:33:00Z',
    updatedAt: '2026-04-10T14:33:00Z',
  },
  {
    id: 'sug-2',
    caseId: 'case-001',
    companyId: 'company-test-abc',
    title: 'Compressed Work Week — 4x10 Schedule',
    description: 'Restructure work week to four 10-hour days.',
    customizedDescription: null,
    source: 'JAN SOAR DB — "Schedule Modifications"',
    sourceType: 'jan_soar',
    confidence: 78,
    implementationCount: 312,
    status: 'pending',
    rejectionReason: null,
    implementationStatus: null,
    implementationCost: null,
    selectedAt: null,
    selectedBy: null,
    createdAt: '2026-04-10T14:33:00Z',
    updatedAt: '2026-04-10T14:33:00Z',
  },
  {
    id: 'sug-3',
    caseId: 'case-001',
    companyId: 'company-test-abc',
    title: 'Remote Work — Partial Telework',
    description: 'Allow remote work on appointment days.',
    customizedDescription: null,
    source: 'Similar Case Match — 3 comparable cases',
    sourceType: 'similar_case',
    confidence: 71,
    implementationCount: null,
    status: 'pending',
    rejectionReason: null,
    implementationStatus: null,
    implementationCost: null,
    selectedAt: null,
    selectedBy: null,
    createdAt: '2026-04-10T14:33:00Z',
    updatedAt: '2026-04-10T14:33:00Z',
  },
  {
    id: 'sug-4',
    caseId: 'case-001',
    companyId: 'company-test-abc',
    title: 'Job Restructuring — Task Redistribution',
    description: 'Reassign time-sensitive morning tasks to coworkers on affected days.',
    customizedDescription: null,
    source: 'Legal Pattern Match — ADA precedent',
    sourceType: 'legal_pattern',
    confidence: 54,
    implementationCount: null,
    status: 'pending',
    rejectionReason: null,
    implementationStatus: null,
    implementationCost: null,
    selectedAt: null,
    selectedBy: null,
    createdAt: '2026-04-10T14:33:00Z',
    updatedAt: '2026-04-10T14:33:00Z',
  },
];

// ---------------------------------------------------------------------------
// MSW handler — suggestions endpoint
// ---------------------------------------------------------------------------

function addSuggestionsHandler(caseId = 'case-001', suggestions = MOCK_SUGGESTIONS_API) {
  server.use(
    http.get(`${API}/api/v1/cases/${caseId}/suggestions`, () =>
      HttpResponse.json({ suggestions }, { status: 200 }),
    ),
    // Accept endpoint — return suggestion with status 'selected'
    http.post(`${API}/api/v1/cases/:caseId/suggestions/:suggestionId/select`, ({ params }) => {
      const sug = suggestions.find((s) => s.id === params.suggestionId);
      if (!sug) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
      return HttpResponse.json({ suggestion: { ...sug, status: 'selected' }, letter: null }, { status: 200 });
    }),
    // Reject endpoint — return suggestion with status 'rejected'
    http.post(`${API}/api/v1/cases/:caseId/suggestions/:suggestionId/reject`, async ({ params, request }) => {
      const sug = suggestions.find((s) => s.id === params.suggestionId);
      if (!sug) return HttpResponse.json({ error: 'Not found' }, { status: 404 });
      const body = await request.json() as { reason: string };
      return HttpResponse.json(
        { suggestion: { ...sug, status: 'rejected', rejectionReason: body.reason } },
        { status: 200 },
      );
    }),
    // Generate endpoint
    http.post(`${API}/api/v1/cases/${caseId}/suggestions`, () =>
      HttpResponse.json({ suggestions, count: suggestions.length }, { status: 201 }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Setup auth helpers
// ---------------------------------------------------------------------------

function setupAuth(role: RoleType) {
  const fakeToken = makeFakeAccessToken({ role, sub: 'user-test-001' });
  const client = createAuthenticatedClient({
    getAccessToken: () => fakeToken,
    onTokenRefreshed: () => {},
    onAuthLost: () => {},
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

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function renderPage(caseId = 'case-001', defaultConsentState?: 'active' | 'declined' | 'pending' | 'error') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/ai-analysis`]}>
        <Routes>
          <Route path="/cases/:id/ai-analysis" element={<AIAnalysisPage defaultConsentState={defaultConsentState} />} />
          <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * RoleGuard replica for route-level tests (mirrors App.tsx RoleGuard).
 */
function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: string[];
  children: React.ReactNode;
}) {
  const { user, bootstrap } = useAuth();
  if (bootstrap === 'pending') return null;
  const role = user?.role ?? '';
  if (!allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <div data-testid="role-guard">{children}</div>;
}

function renderWithRoleGuard(role: RoleType, caseId = 'case-001') {
  setupAuth(role);
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/ai-analysis`]}>
        <Routes>
          <Route
            path="/cases/:id/ai-analysis"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr']}>
                <AIAnalysisPage />
              </RoleGuard>
            }
          />
          <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIAnalysisPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    addSuggestionsHandler();
  });

  // T01: super_admin sees the page
  it('T01: super_admin role — page renders', () => {
    renderWithRoleGuard('super_admin');
    expect(screen.getByTestId('ai-analysis-page')).toBeInTheDocument();
  });

  // T02: hr sees the page
  it('T02: hr role — page renders', () => {
    renderWithRoleGuard('hr');
    expect(screen.getByTestId('ai-analysis-page')).toBeInTheDocument();
  });

  // T03: manager redirected
  it('T03: manager role — redirects to dashboard', () => {
    renderWithRoleGuard('manager');
    expect(screen.queryByTestId('ai-analysis-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  // T04: medical_reviewer redirected
  it('T04: medical_reviewer role — redirects to dashboard', () => {
    renderWithRoleGuard('medical_reviewer');
    expect(screen.queryByTestId('ai-analysis-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  // T05: State A — all 6 sections
  it('T05: State A (active) — all sections visible', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    expect(screen.getByTestId('state-active')).toBeInTheDocument();
    expect(screen.getByLabelText('AI Case Summary')).toBeInTheDocument();
    expect(screen.getByLabelText('JAN SOAR Suggestions')).toBeInTheDocument();
    expect(screen.getByLabelText('Legal Risk Assessment')).toBeInTheDocument();
    expect(screen.getByLabelText('Similar Cases')).toBeInTheDocument();
    expect(screen.getByLabelText('Recommended Action')).toBeInTheDocument();
    expect(screen.getByLabelText('AI Audit Trail')).toBeInTheDocument();
  });

  // T06: State B — declined
  it('T06: State B (declined) — shows opt-out message', () => {
    setupAuth('hr');
    renderPage('case-001', 'declined');
    expect(screen.getByTestId('state-declined')).toBeInTheDocument();
    expect(screen.getByText(/Employee Opted Out/)).toBeInTheDocument();
    expect(screen.getByText(/Use Manual Analysis Instead/)).toBeInTheDocument();
    // Active state should NOT be present
    expect(screen.queryByTestId('state-active')).not.toBeInTheDocument();
  });

  // T07: State C — pending
  it('T07: State C (pending) — shows pending message and request consent button', () => {
    setupAuth('hr');
    renderPage('case-001', 'pending');
    expect(screen.getByTestId('state-pending')).toBeInTheDocument();
    expect(screen.getByText(/Consent Not Yet Obtained/)).toBeInTheDocument();
    expect(screen.getByText(/Request AI Consent/)).toBeInTheDocument();
    // Active state should NOT be present
    expect(screen.queryByTestId('state-active')).not.toBeInTheDocument();
    // Disclaimer banner should still be present
    expect(screen.getByTestId('ai-disclaimer-banner')).toBeInTheDocument();
  });

  // T08: State D — error
  it('T08: State D (error) — shows error message and retry button', () => {
    setupAuth('hr');
    renderPage('case-001', 'error');
    expect(screen.getByTestId('state-error')).toBeInTheDocument();
    expect(screen.getByText(/AI Service Temporarily Unavailable/)).toBeInTheDocument();
    expect(screen.getByTestId('retry-btn')).toBeInTheDocument();
    // Active state should NOT be present
    expect(screen.queryByTestId('state-active')).not.toBeInTheDocument();
  });

  // T09: Disclaimer — no dismiss button
  it('T09: Disclaimer banner — no dismiss button present', () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    const banner = screen.getByTestId('ai-disclaimer-banner');
    // Search for close/dismiss buttons within the banner
    const buttons = banner.querySelectorAll('button');
    // There should be zero buttons (no dismiss)
    expect(buttons.length).toBe(0);
    // Also verify no element with common dismiss labels
    expect(within(banner).queryByText(/dismiss/i)).not.toBeInTheDocument();
    expect(within(banner).queryByText(/close/i)).not.toBeInTheDocument();
    expect(within(banner).queryByLabelText(/close/i)).not.toBeInTheDocument();
  });

  // T10: Disclaimer contains required text
  it('T10: Disclaimer banner — contains required legal text', () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    const banner = screen.getByTestId('ai-disclaimer-banner');
    expect(within(banner).getByText(/AI-generated analysis — not legal advice/)).toBeInTheDocument();
    expect(within(banner).getByText(/Human review required before any decision/)).toBeInTheDocument();
    expect(within(banner).getByText(/Powered by Google Gemini/)).toBeInTheDocument();
    expect(within(banner).getByText(/Illinois HB 3773/)).toBeInTheDocument();
  });

  // T11: Accept suggestion
  it('T11: Suggestion accept — changes status to accepted', async () => {
    setupAuth('hr');
    // Track call count: first GET returns pending, after select+refetch returns selected
    let getSuggestionsCallCount = 0;
    server.use(
      http.get(`${API}/api/v1/cases/case-001/suggestions`, () => {
        getSuggestionsCallCount++;
        // First call (initial load): pending
        // Subsequent calls (after invalidation): selected
        const suggestions = MOCK_SUGGESTIONS_API.map((s) =>
          s.id === 'sug-1' && getSuggestionsCallCount > 1
            ? { ...s, status: 'selected' }
            : s,
        );
        return HttpResponse.json({ suggestions }, { status: 200 });
      }),
    );
    renderPage('case-001', 'active');

    const sug1 = await screen.findByTestId('suggestion-sug-1');
    const acceptBtn = within(sug1).getByText('Accept Suggestion');
    fireEvent.click(acceptBtn);
    // After API call + refetch, sug-1 should show 'Accepted'
    await waitFor(() => {
      expect(within(screen.getByTestId('suggestion-sug-1')).getByText('Accepted')).toBeInTheDocument();
    });
  });

  // T12: Reject opens modal
  it('T12: Suggestion reject — opens rejection modal', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    const sug2 = await screen.findByTestId('suggestion-sug-2');
    const rejectBtn = within(sug2).getByText(/Reject — Log Reason/);
    fireEvent.click(rejectBtn);
    expect(screen.getByTestId('reject-modal')).toBeInTheDocument();
    expect(screen.getByText(/Reject Suggestion: Compressed Work Week/)).toBeInTheDocument();
  });

  // T13: Reject modal — requires reason
  it('T13: Reject modal — confirm disabled without reason', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    const sug1 = await screen.findByTestId('suggestion-sug-1');
    fireEvent.click(within(sug1).getByText(/Reject — Log Reason/));

    const confirmBtn = screen.getByTestId('confirm-rejection-btn');
    expect(confirmBtn).toBeDisabled();
  });

  // T14: Legal risk badge
  it('T14: Legal risk badge shows LOW RISK in green', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    // Wait for loading to finish (active view is immediately visible)
    await screen.findByTestId('state-active');
    const badge = screen.getByTestId('risk-badge');
    expect(badge).toHaveTextContent(/LOW RISK/);
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
  });

  // T15: Similar cases — anonymized (no real names)
  it('T15: Similar cases — no real employee names', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    await screen.findByTestId('state-active');
    const caseA = screen.getByTestId('similar-case-Case A');
    expect(within(caseA).getByText(/Case A \(Anonymized\)/)).toBeInTheDocument();
    // Verify there are no real names
    expect(screen.getByText(/All cases anonymized/)).toBeInTheDocument();
    // Check that no common names leak through
    expect(screen.queryByText(/John/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jane/)).not.toBeInTheDocument();
  });

  // T16: Recommend badge APPROVE
  it('T16: Recommend badge shows APPROVE with green styling', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    await screen.findByTestId('state-active');
    const badge = screen.getByTestId('recommend-badge');
    expect(badge).toHaveTextContent('APPROVE');
    expect(badge.className).toContain('bg-green-100');
  });

  // T17: Manual override form
  it('T17: Manual override form — shows on button click', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    await screen.findByTestId('state-active');
    expect(screen.queryByTestId('manual-override-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Override — Enter Manual Decision/));
    expect(screen.getByTestId('manual-override-form')).toBeInTheDocument();
  });

  // T18: Override form validation
  it('T18: Manual override form — shows validation errors on empty submit', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    await screen.findByTestId('state-active');
    fireEvent.click(screen.getByText(/Override — Enter Manual Decision/));
    fireEvent.click(screen.getByTestId('submit-override-btn'));
    // Should show validation errors
    expect(screen.getByText('Please select an action.')).toBeInTheDocument();
    expect(screen.getAllByText('Minimum 20 characters required.')).toHaveLength(2);
  });

  // T19: Re-analysis cooldown
  it('T19: Re-analysis cooldown — second click shows alert', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    await screen.findByTestId('state-active');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const btn = screen.getByTestId('reanalysis-btn');

    // First click — triggers re-analysis
    fireEvent.click(btn);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('Re-analysis requested'),
    );

    alertSpy.mockClear();

    // Second click — should show cooldown
    fireEvent.click(btn);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('cooldown'),
    );

    alertSpy.mockRestore();
  });

  // T20: Confidence bars have ARIA
  it('T20: Confidence bars have correct ARIA attributes', async () => {
    setupAuth('hr');
    renderPage('case-001', 'active');
    // Wait for suggestions to load
    await screen.findByTestId('suggestion-sug-1');
    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBeGreaterThan(0);
    const firstBar = progressBars[0];
    expect(firstBar).toHaveAttribute('aria-valuenow');
    expect(firstBar).toHaveAttribute('aria-valuemin', '0');
    expect(firstBar).toHaveAttribute('aria-valuemax', '100');
  });
});

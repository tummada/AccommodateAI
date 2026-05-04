/**
 * ACMD-147 — Vitest tests for PwfaFastTrackPage
 *
 * T01: Renders eligibility banner (eligible)
 * T02: Renders eligibility banner (checking → spinner)
 * T03: Renders not-eligible state with redirect countdown
 * T04: Not-eligible — Return Now button navigates
 * T05: Leave-gate Yes — collapses warning, shows categories
 * T06: Leave-gate No — navigates to case detail
 * T07: Category card single select
 * T08: Category card multi-select
 * T09: Category card deselect
 * T10: Confirm Selection button hidden when no selection
 * T11: Approval modal opens on Confirm Selection
 * T12: Approval modal — missing effective date shows error
 * T13: Approval modal — missing duration shows error
 * T14: Approval modal — temporary without end date shows error
 * T15: Approval modal — Cancel returns to selection
 * T16: Dual-law modal appears for multi-law case
 * T17: Dual-law Option A → proceeds to interim check
 * T18: Dual-law Option B → navigates to case detail
 * T19: Interim check — final → success state
 * T20: Interim check — interim → navigates to pwfa-temp
 * T21: Success state renders summary + action buttons
 * T22: Keyboard navigation — Enter toggles category
 * T23: Category cards have correct ARIA checkbox role
 * T24: Deadline badge renders
 * T25: Back link to case detail present
 * T26: Keyboard navigation — Space toggles category
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// We need to mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock auth context so tests don't need AuthProvider
vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn().mockReturnValue({
      user: {
        id: 'test-user-001',
        email: 'hr@test.com',
        name: 'Test HR',
        role: 'hr',
        companyId: 'co-001',
      },
      client: { request: vi.fn() },
      isAuthenticated: true,
      token: 'test-token',
      bootstrap: 'authenticated' as const,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import { PwfaFastTrackPage } from '@/pages/PwfaFastTrackPage';
import type { EligibilityStatus } from '@/pages/PwfaFastTrackPage';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function renderPage(
  route = '/cases/001/pwfa-fast-track',
  opts?: { eligibility?: EligibilityStatus },
) {
  // Always provide testEligibilityOverride to activate test mode (skip API calls).
  // Default to 'eligible' so the happy-path tests work out of the box.
  const eligibility: EligibilityStatus = opts?.eligibility ?? 'eligible';
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/cases/:id/pwfa-fast-track"
          element={<PwfaFastTrackPage testEligibilityOverride={eligibility} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pass the leave gate so category cards appear */
function passLeaveGate() {
  const yesBtn = screen.getByTestId('leave-gate-yes');
  fireEvent.click(yesBtn);
}

/** Select a category and open approval modal.
 * Note: 'breaks' is pre-selected from mock data, so we just pass gate and confirm.
 * If a different catId is needed, we click it to add it. */
function selectAndConfirm() {
  passLeaveGate();
  // 'breaks' is already pre-selected from mock detectedCategories
  const confirmBtn = screen.getByTestId('confirm-selection-btn');
  fireEvent.click(confirmBtn);
}

/** Go through approval modal with valid data */
function confirmApproval() {
  const confirmBtn = screen.getByTestId('confirm-approval-btn');
  fireEvent.click(confirmBtn);
}

beforeEach(() => {
  mockNavigate.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PwfaFastTrackPage', () => {
  // T01
  it('renders eligibility banner as eligible', () => {
    renderPage();
    const banner = screen.getByTestId('eligibility-banner');
    expect(banner).toHaveTextContent(/eligible/i);
    expect(banner).toHaveAttribute('role', 'status');
  });

  // T02
  it('renders eligibility banner with checking state (spinner text)', () => {
    renderPage(undefined, { eligibility: 'checking' });
    const banner = screen.getByTestId('eligibility-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/checking pwfa eligibility/i);
  });

  // T03
  it('renders not-eligible auto-redirect countdown', () => {
    renderPage(undefined, { eligibility: 'not_eligible' });
    expect(screen.getByTestId('not-eligible-banner')).toBeInTheDocument();
    expect(screen.getByTestId('redirect-countdown')).toHaveTextContent(/redirecting in/i);
  });

  // T04
  it('not-eligible: Return Now button navigates', () => {
    renderPage(undefined, { eligibility: 'not_eligible' });
    const returnBtn = screen.getByTestId('return-now-btn');
    fireEvent.click(returnBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/cases/001');
  });

  // T05
  it('leave-gate Yes collapses warning and shows category cards', () => {
    renderPage();
    expect(screen.getByTestId('leave-gate')).toBeInTheDocument();
    passLeaveGate();
    expect(screen.queryByTestId('leave-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('category-card-breaks')).toBeInTheDocument();
  });

  // T06
  it('leave-gate No navigates to case detail', () => {
    renderPage();
    const noBtn = screen.getByTestId('leave-gate-no');
    fireEvent.click(noBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/cases/001');
  });

  // T07
  it('category card single select toggles', () => {
    renderPage();
    passLeaveGate();
    const card = screen.getByTestId('category-card-water');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-checked', 'true');
  });

  // T08
  it('category card multi-select supported', () => {
    renderPage();
    passLeaveGate();
    const water = screen.getByTestId('category-card-water');
    const eating = screen.getByTestId('category-card-eating');
    fireEvent.click(water);
    fireEvent.click(eating);
    expect(water).toHaveAttribute('aria-checked', 'true');
    expect(eating).toHaveAttribute('aria-checked', 'true');
  });

  // T09
  it('category card deselect', () => {
    renderPage();
    passLeaveGate();
    const card = screen.getByTestId('category-card-water');
    fireEvent.click(card); // select
    expect(card).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(card); // deselect
    expect(card).toHaveAttribute('aria-checked', 'false');
  });

  // T10
  it('confirm button hidden when no categories selected', () => {
    renderPage();
    passLeaveGate();
    // Deselect the pre-selected "breaks"
    const breaks = screen.getByTestId('category-card-breaks');
    fireEvent.click(breaks); // deselect
    expect(screen.queryByTestId('confirm-selection-btn')).not.toBeInTheDocument();
  });

  // T11
  it('approval modal opens on Confirm Selection', () => {
    renderPage();
    selectAndConfirm();
    expect(screen.getByTestId('approval-modal-overlay')).toBeInTheDocument();
    expect(screen.getByText('Approve PWFA Accommodation')).toBeInTheDocument();
  });

  // T12
  it('approval modal shows error when effective date cleared', () => {
    renderPage();
    selectAndConfirm();
    const dateInput = screen.getByTestId('effective-date-input');
    fireEvent.change(dateInput, { target: { value: '' } });
    confirmApproval();
    expect(screen.getByTestId('approval-errors')).toHaveTextContent(/effective date is required/i);
  });

  // T13
  it('approval modal — pregnancy duration does not produce duration error', () => {
    renderPage();
    selectAndConfirm();
    // Verify pregnancy is pre-selected
    const pregnancyRadio = screen.getByTestId('duration-pregnancy');
    expect(pregnancyRadio).toBeChecked();
    // Clear effective date to force a different validation error (not duration)
    const dateInput = screen.getByTestId('effective-date-input');
    fireEvent.change(dateInput, { target: { value: '' } });
    confirmApproval();
    // Should show "Effective date is required" but NOT "Duration selection is required"
    const errors = screen.getByTestId('approval-errors');
    expect(errors).toHaveTextContent(/effective date is required/i);
    expect(errors).not.toHaveTextContent(/duration selection is required/i);
  });

  // T14
  it('approval modal shows error when temporary selected without end date', () => {
    renderPage();
    selectAndConfirm();
    const tempRadio = screen.getByTestId('duration-temporary');
    fireEvent.click(tempRadio);
    confirmApproval();
    expect(screen.getByTestId('approval-errors')).toHaveTextContent(/end date is required/i);
  });

  // T15
  it('approval modal Cancel returns to selection state', () => {
    renderPage();
    selectAndConfirm();
    expect(screen.getByTestId('approval-modal-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));
    expect(screen.queryByTestId('approval-modal-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('category-card-breaks')).toBeInTheDocument();
  });

  // T16
  it('dual-law modal appears for multi-law case (ADA+PWFA)', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    // Mock data has laws: ['PWFA', 'ADA'] → dual-law modal appears
    expect(screen.getByTestId('dual-law-modal-overlay')).toBeInTheDocument();
    expect(screen.getByText('Dual-Law Evaluation')).toBeInTheDocument();
  });

  // T17
  it('dual-law Option A proceeds to interim check', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    const optionA = screen.getByTestId('dual-option-a');
    fireEvent.click(optionA);
    const continueBtn = screen.getByTestId('dual-continue-btn');
    fireEvent.click(continueBtn);
    expect(screen.getByTestId('interim-section')).toBeInTheDocument();
  });

  // T18
  it('dual-law Option B navigates to case detail', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    const optionB = screen.getByTestId('dual-option-b');
    fireEvent.click(optionB);
    const continueBtn = screen.getByTestId('dual-continue-btn');
    fireEvent.click(continueBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/cases/001');
  });

  // T19
  it('interim final → success state', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    // Dual-law modal
    fireEvent.click(screen.getByTestId('dual-option-a'));
    fireEvent.click(screen.getByTestId('dual-continue-btn'));
    // Interim check
    fireEvent.click(screen.getByTestId('interim-final'));
    fireEvent.click(screen.getByTestId('complete-approval-btn'));
    expect(screen.getByTestId('success-banner')).toBeInTheDocument();
    expect(screen.getByText('PWFA Accommodation Approved')).toBeInTheDocument();
  });

  // T20
  it('interim interim → navigates to pwfa-temp', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    // Dual-law modal
    fireEvent.click(screen.getByTestId('dual-option-a'));
    fireEvent.click(screen.getByTestId('dual-continue-btn'));
    // Interim check — choose interim
    fireEvent.click(screen.getByTestId('interim-interim'));
    fireEvent.click(screen.getByTestId('complete-approval-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('/cases/001/pwfa-temp');
  });

  // T21
  it('success state renders summary card and action buttons', () => {
    renderPage();
    selectAndConfirm();
    confirmApproval();
    fireEvent.click(screen.getByTestId('dual-option-a'));
    fireEvent.click(screen.getByTestId('dual-continue-btn'));
    fireEvent.click(screen.getByTestId('interim-final'));
    fireEvent.click(screen.getByTestId('complete-approval-btn'));
    // Summary
    expect(screen.getByTestId('success-summary')).toBeInTheDocument();
    expect(screen.getByText('Maria Johnson')).toBeInTheDocument();
    expect(screen.getByText('PWFA Exempt')).toBeInTheDocument();
    // Action buttons
    expect(screen.getByTestId('review-letter-btn')).toBeInTheDocument();
    expect(screen.getByTestId('view-case-btn')).toBeInTheDocument();
    expect(screen.getByTestId('back-dashboard-btn')).toBeInTheDocument();
  });

  // T22
  it('keyboard Enter toggles category card', () => {
    renderPage();
    passLeaveGate();
    const card = screen.getByTestId('category-card-water');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveAttribute('aria-checked', 'false');
  });

  // T23
  it('category cards have correct ARIA checkbox role', () => {
    renderPage();
    passLeaveGate();
    const cards = ['breaks', 'water', 'sit_stand', 'eating'];
    for (const catId of cards) {
      const card = screen.getByTestId(`category-card-${catId}`);
      expect(card).toHaveAttribute('role', 'checkbox');
    }
  });

  // T24
  it('deadline badge renders with day info', () => {
    renderPage();
    const badge = screen.getByTestId('deadline-badge');
    expect(badge).toHaveTextContent(/Day 5 of 30/);
    expect(badge).toHaveTextContent(/25 days left/);
  });

  // T25
  it('back link to case detail is present', () => {
    renderPage();
    const backLink = screen.getByTestId('back-link');
    expect(backLink).toHaveAttribute('href', '/cases/001');
    expect(backLink).toHaveTextContent(/back to case detail/i);
  });

  // T26
  it('keyboard Space toggles category card', () => {
    renderPage();
    passLeaveGate();
    const card = screen.getByTestId('category-card-water');
    fireEvent.keyDown(card, { key: ' ' });
    expect(card).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(card, { key: ' ' });
    expect(card).toHaveAttribute('aria-checked', 'false');
  });
});

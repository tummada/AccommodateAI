/**
 * ACMD-137-C1 — Tests for DualTrackSplitView, TimelinePanel, CaseClosureGate
 *
 * T1:  DualTrackSplitView — returns null for manager role
 * T2:  DualTrackSplitView — returns null for non-'multiple' caseType
 * T3:  DualTrackSplitView — renders ADA tab with 4 checklist items
 * T4:  DualTrackSplitView — renders PWFA fast-track banner when pwfaFastTrackAvailable=true
 * T5:  DualTrackSplitView — tab keyboard: aria-selected changes on click
 * T6:  TimelinePanel — renders loading skeleton initially
 * T7:  TimelinePanel — renders events list after data loads (mock useInfiniteQuery)
 * T8:  TimelinePanel — shows "Load More" button when hasNextPage=true
 * T9:  CaseClosureGate — returns null for manager role
 * T10: CaseClosureGate — Close Case button is disabled when progress < 4/4
 * T11: CaseClosureGate — Close Case button enabled when all 4 items complete
 * T12: CaseClosureGate — shows confirmation dialog on Close Case click
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
    useInfiniteQuery: vi.fn(),
    useQuery: vi.fn(),
  };
});

vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

import { DualTrackSplitView } from '@/components/case-detail/DualTrackSplitView';
import { TimelinePanel } from '@/components/case-detail/TimelinePanel';
import { CaseClosureGate } from '@/components/case-detail/CaseClosureGate';
import { formatAction } from '@/components/case-detail/TimelinePanel';
import { useInfiniteQuery } from '@tanstack/react-query';
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

const mockUseInfiniteQuery = useInfiniteQuery as ReturnType<typeof vi.fn>;

/** Wrap with providers */
function renderWithProviders(ui: React.ReactElement) {
  const qc = makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Default ADA checklist (all false) */
const adaChecklistFalse = {
  disabilityDocumentation: false,
  functionalLimitationsAssessed: false,
  interactiveProcessComplete: false,
  unduHardshipAnalyzed: false,
};

/** Default PWFA checklist (all false) */
const pwfaChecklistFalse = {
  pregnancyVerified: false,
  predictableAssessmentDone: false,
  fastTrackEligible: false,
};

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// T1: DualTrackSplitView — returns null for manager role
// ---------------------------------------------------------------------------

describe('DualTrackSplitView — T1: manager role returns null', () => {
  it('renders nothing for manager role', () => {
    const { container } = renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="manager"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T2: DualTrackSplitView — returns null for non-'multiple' caseType
// ---------------------------------------------------------------------------

describe('DualTrackSplitView — T2: non-multiple caseType returns null', () => {
  it('renders nothing when caseType is "ada"', () => {
    const { container } = renderWithProviders(
      <DualTrackSplitView
        caseType="ada"
        role="hr"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when caseType is "pwfa"', () => {
    const { container } = renderWithProviders(
      <DualTrackSplitView
        caseType="pwfa"
        role="super_admin"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for medical_reviewer role', () => {
    const { container } = renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="medical_reviewer"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T3: DualTrackSplitView — renders ADA tab with 4 checklist items
// ---------------------------------------------------------------------------

describe('DualTrackSplitView — T3: ADA tab checklist', () => {
  it('renders ADA Track tab with 4 checklist items', () => {
    renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="hr"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );

    // Tab list visible
    expect(
      screen.getByRole('tablist', { name: /Dual-law requirements: ADA and PWFA tracks/i }),
    ).toBeInTheDocument();

    // ADA tab is selected by default
    expect(screen.getByRole('tab', { name: 'ADA Track' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // 4 checklist items visible
    expect(screen.getByText('Disability documentation')).toBeInTheDocument();
    expect(screen.getByText('Functional limitations assessed')).toBeInTheDocument();
    expect(screen.getByText('Interactive process complete')).toBeInTheDocument();
    expect(screen.getByText('Undue hardship analysis')).toBeInTheDocument();

    // ADA timeline label
    expect(screen.getByText(/ADA interactive process.*30 days/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T4: DualTrackSplitView — PWFA fast-track banner
// ---------------------------------------------------------------------------

describe('DualTrackSplitView — T4: PWFA fast-track banner', () => {
  it('renders PWFA fast-track banner when pwfaFastTrackAvailable=true', () => {
    renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="hr"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
        pwfaFastTrackAvailable={true}
      />,
    );

    // Click PWFA Track tab
    fireEvent.click(screen.getByRole('tab', { name: 'PWFA Track' }));

    // Fast-track banner visible
    expect(
      screen.getByText(/This request may qualify for PWFA fast-track approval/i),
    ).toBeInTheDocument();

    // Start Fast-Track button present but disabled
    const btn = screen.getByRole('button', { name: /Start Fast-Track/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('does NOT render fast-track banner when pwfaFastTrackAvailable=false', () => {
    renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="hr"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
        pwfaFastTrackAvailable={false}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'PWFA Track' }));

    expect(
      screen.queryByText(/This request may qualify for PWFA fast-track approval/i),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5: DualTrackSplitView — aria-selected changes on click
// ---------------------------------------------------------------------------

describe('DualTrackSplitView — T5: tab aria-selected on click', () => {
  it('changes aria-selected when a different tab is clicked', () => {
    renderWithProviders(
      <DualTrackSplitView
        caseType="multiple"
        role="super_admin"
        adaChecklist={adaChecklistFalse}
        pwfaChecklist={pwfaChecklistFalse}
      />,
    );

    const adaTab = screen.getByRole('tab', { name: 'ADA Track' });
    const pwfaTab = screen.getByRole('tab', { name: 'PWFA Track' });
    const combinedTab = screen.getByRole('tab', { name: 'Combined Timeline' });

    // Initial state: ADA selected
    expect(adaTab).toHaveAttribute('aria-selected', 'true');
    expect(pwfaTab).toHaveAttribute('aria-selected', 'false');
    expect(combinedTab).toHaveAttribute('aria-selected', 'false');

    // Click PWFA tab
    fireEvent.click(pwfaTab);
    expect(adaTab).toHaveAttribute('aria-selected', 'false');
    expect(pwfaTab).toHaveAttribute('aria-selected', 'true');
    expect(combinedTab).toHaveAttribute('aria-selected', 'false');

    // Click Combined tab
    fireEvent.click(combinedTab);
    expect(adaTab).toHaveAttribute('aria-selected', 'false');
    expect(pwfaTab).toHaveAttribute('aria-selected', 'false');
    expect(combinedTab).toHaveAttribute('aria-selected', 'true');
  });
});

// ---------------------------------------------------------------------------
// T6: TimelinePanel — renders loading skeleton
// ---------------------------------------------------------------------------

describe('TimelinePanel — T6: loading skeleton', () => {
  it('renders loading skeleton when isLoading=true', () => {
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    renderWithProviders(
      <TimelinePanel
        caseId="case-test-123"
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(
      screen.getByRole('status', { name: /Loading timeline events/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T7: TimelinePanel — renders events list after data loads
// ---------------------------------------------------------------------------

describe('TimelinePanel — T7: events list after data loads', () => {
  it('renders formatted event rows when data is available', () => {
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            events: [
              {
                id: 'evt-001',
                caseId: 'case-test-123',
                action: 'case_created',
                actorId: 'user-hr-1',
                metadata: {},
                visibility: ['hr', 'super_admin'],
                createdAt: '2026-04-01T14:00:00Z',
              },
              {
                id: 'evt-002',
                caseId: 'case-test-123',
                action: 'discussion_created',
                actorId: null,  // system event
                metadata: {},
                visibility: ['hr', 'super_admin'],
                createdAt: '2026-04-05T10:30:00Z',
              },
            ],
            total: 2,
            limit: 20,
            offset: 0,
          },
        ],
        pageParams: [0],
      },
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    renderWithProviders(
      <TimelinePanel
        caseId="case-test-123"
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    // Events should be displayed
    expect(screen.getByText('Case created')).toBeInTheDocument();
    expect(screen.getByText('Discussion added')).toBeInTheDocument();

    // Actor labels
    expect(screen.getAllByText('[HR User]').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('[System]').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// T8: TimelinePanel — shows "Load More" button when hasNextPage=true
// ---------------------------------------------------------------------------

describe('TimelinePanel — T8: Load More button visible when hasNextPage', () => {
  it('shows Load More button when hasNextPage=true', () => {
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            events: [
              {
                id: 'evt-001',
                caseId: 'case-test-123',
                action: 'case_created',
                actorId: 'user-1',
                metadata: {},
                visibility: [],
                createdAt: '2026-04-01T14:00:00Z',
              },
            ],
            total: 100,
            limit: 20,
            offset: 0,
          },
        ],
        pageParams: [0],
      },
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: true,
      isFetchingNextPage: false,
    });

    renderWithProviders(
      <TimelinePanel
        caseId="case-test-123"
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Load more timeline events/i }),
    ).toBeInTheDocument();
  });

  it('does NOT show Load More when hasNextPage=false', () => {
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            events: [],
            total: 0,
            limit: 20,
            offset: 0,
          },
        ],
        pageParams: [0],
      },
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    renderWithProviders(
      <TimelinePanel
        caseId="case-test-123"
        role="hr"
        apiClient={makeMockClient()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Load more timeline events/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T9: CaseClosureGate — returns null for manager role
// ---------------------------------------------------------------------------

describe('CaseClosureGate — T9: manager role returns null', () => {
  it('renders nothing for manager role', () => {
    const { container } = renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="manager"
        allStagesComplete={true}
        employeeNotified={true}
        followupDateSet={false}
        apiClient={makeMockClient()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for medical_reviewer role', () => {
    const { container } = renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="medical_reviewer"
        allStagesComplete={true}
        employeeNotified={true}
        followupDateSet={false}
        apiClient={makeMockClient()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T10: CaseClosureGate — Close Case button disabled when progress < 4/4
// ---------------------------------------------------------------------------

describe('CaseClosureGate — T10: Close button disabled < 4/4', () => {
  it('disables Close Case button when not all items complete', () => {
    renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="hr"
        allStagesComplete={false}     // 0/4 complete
        employeeNotified={false}
        followupDateSet={false}
        apiClient={makeMockClient()}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: /Close case/i });
    expect(closeBtn).toBeDisabled();
    expect(closeBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables when only 2 of 4 items complete', () => {
    renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="super_admin"
        allStagesComplete={true}      // item 1 ✓
        employeeNotified={true}       // item 2 ✓
        followupDateSet={false}       // item 3 ✗
        apiClient={makeMockClient()}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: /Close case/i });
    expect(closeBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// T11: CaseClosureGate — Close Case button enabled when all 4 items complete
// ---------------------------------------------------------------------------

describe('CaseClosureGate — T11: Close button enabled when 4/4 complete', () => {
  it('enables Close Case button when all auto-check items done + documents toggled', () => {
    renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="hr"
        allStagesComplete={true}
        employeeNotified={true}
        followupDateSet={true}
        apiClient={makeMockClient()}
      />,
    );

    // Toggle "All documents attached" checkbox
    const docsCheckbox = screen.getByRole('checkbox', {
      name: /All documents attached/i,
    });
    fireEvent.click(docsCheckbox);

    // Button should now be enabled
    const closeBtn = screen.getByRole('button', { name: /Close case.*all 4.*complete/i });
    expect(closeBtn).not.toBeDisabled();
    expect(closeBtn).not.toHaveAttribute('aria-disabled', 'true');
  });
});

// ---------------------------------------------------------------------------
// T12: CaseClosureGate — shows confirmation dialog on Close Case click
// ---------------------------------------------------------------------------

describe('CaseClosureGate — T12: confirmation dialog on click', () => {
  it('shows confirmation dialog when Close Case button is clicked (all 4 complete)', () => {
    renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="hr"
        allStagesComplete={true}
        employeeNotified={true}
        followupDateSet={true}
        apiClient={makeMockClient()}
      />,
    );

    // Enable documents checkbox
    const docsCheckbox = screen.getByRole('checkbox', {
      name: /All documents attached/i,
    });
    fireEvent.click(docsCheckbox);

    // Click Close Case
    const closeBtn = screen.getByRole('button', { name: /Close case.*all 4.*complete/i });
    fireEvent.click(closeBtn);

    // Confirmation dialog should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(/Closing this case will archive it/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Close/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('closes dialog when Cancel is clicked', () => {
    renderWithProviders(
      <CaseClosureGate
        caseId="case-test-123"
        caseStatus="implementation"
        role="hr"
        allStagesComplete={true}
        employeeNotified={true}
        followupDateSet={true}
        apiClient={makeMockClient()}
      />,
    );

    // Enable documents checkbox
    fireEvent.click(
      screen.getByRole('checkbox', { name: /All documents attached/i }),
    );

    // Open dialog
    fireEvent.click(screen.getByRole('button', { name: /Close case.*all 4.*complete/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Cancel
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bonus: formatAction unit tests
// ---------------------------------------------------------------------------

describe('formatAction — unit tests', () => {
  it('maps case_created → "Case created"', () => {
    expect(formatAction('case_created')).toBe('Case created');
  });

  it('maps discussion_created → "Discussion added"', () => {
    expect(formatAction('discussion_created')).toBe('Discussion added');
  });

  it('maps case_assigned → "Case assigned"', () => {
    expect(formatAction('case_assigned')).toBe('Case assigned');
  });

  it('falls back to title-case snake_case for unknown actions', () => {
    expect(formatAction('unknown_custom_event')).toBe('Unknown Custom Event');
  });
});

/**
 * ACMD-140 — Vitest tests for TimelinePage
 * ACMD-150 — Updated: added QueryClientProvider + MSW handlers for real API shape
 *
 * MSW returns AcmdTimelineEvent[] that maps to the same display data as the
 * old MOCK_EVENTS so existing assertions still pass.
 *
 * Tests:
 *   T1:  HR role — renders page title + case header
 *   T2:  super_admin — renders page title + case header
 *   T3:  manager — Access NOT denied (manager can view)
 *   T4:  medical_reviewer — renders page title
 *   T5:  HR — sees medical event detail (not restricted)
 *   T6:  manager — medical events show [Medical — restricted]
 *   T7:  manager — Actor Role filter NOT shown
 *   T8:  HR — Actor Role filter IS shown
 *   T9:  Sort toggle Newest First / Oldest First changes order
 *   T10: Search filter (keyword ≥3 chars → filters entries)
 *   T11: Event type badge class/color correct (case_lifecycle = blue)
 *   T12: EffectivenessCheckPanel shown when status=approved
 *   T13: EffectivenessCheckPanel NOT shown when status≠approved (mock override)
 *   T14: manager — ExportButton has no CSV option
 *   T15: HR — ExportButton has CSV option
 *   T16: manager — case header does NOT show accommodation type
 *   T17: HR — case header shows accommodation type
 *   T18: manager — letter events (managerVisible:false) do not leak PII email
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './server';

// Hoist mocks
vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

import { TimelinePage } from '@/pages/TimelinePage';
import { useAuth } from '@/lib/auth-context';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Mock API events — AcmdTimelineEvent shape
// metadata carries actorRole, actorName, detail so mapApiEvent extracts them.
// visibility determines managerVisible.
// ---------------------------------------------------------------------------

const API = 'http://localhost:3000';

function makeEvent(
  id: string,
  action: string,
  createdAt: string,
  actorRole: string,
  actorName: string,
  detail: string,
  visibility: string[],
) {
  return {
    id,
    caseId: 'CASE-2026-022',
    action,
    actorId: null,
    metadata: { actorRole, actorName, detail },
    visibility,
    createdAt,
  };
}

// Timestamps sorted newest→oldest (SEQ 14 → 1)
const MOCK_TIMELINE_EVENTS = [
  makeEvent('ev-14', 'deadline.level2_alert', '2026-04-10T15:14:00Z', 'SYSTEM', 'System',
    'Deadline escalated to Level 2 (Orange). 7 days remaining.', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-13', 'medical.cleared', '2026-04-09T09:22:00Z', 'SYSTEM', 'System',
    'Medical documentation status changed to: Cleared.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-12', 'medical.reviewed', '2026-04-08T14:45:00Z', 'Medical Reviewer', 'Dr. Chen',
    'Medical documentation reviewed. Decision: Cleared.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-11', 'medical.assigned', '2026-04-07T11:30:00Z', 'SYSTEM', 'System',
    'Medical documentation assigned to reviewer: Dr. Chen.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-10', 'medical.received', '2026-04-06T10:05:00Z', 'SYSTEM', 'System',
    'Medical documentation received for case.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-09', 'medical.requested', '2026-04-05T16:17:00Z', 'HR', 'Maria Lopez',
    'Medical documentation requested. Template: General ADA. Due date: 04/20/2026.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-08', 'eeoc.stage_complete', '2026-04-04T09:50:00Z', 'SYSTEM', 'System',
    'Stage 3 (Interactive Discussion) completed. 2 discussions recorded.', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-07', 'eeoc.discussion_recorded', '2026-04-03T15:30:00Z', 'HR', 'Maria Lopez',
    'Interactive discussion recorded. Date: 04/03/2026. Method: Video. Participants: A. Williams, Maria Lopez.', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-06', 'mgr_input.requested', '2026-04-01T14:00:00Z', 'HR', 'Maria Lopez',
    'Manager input requested from J. Baker (manager).', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-05', 'eeoc.stage_complete', '2026-03-31T10:15:00Z', 'SYSTEM', 'System',
    'Stage 2 (Acknowledgment) completed. Letter sent.', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-04', 'letter.sent', '2026-03-31T10:00:00Z', 'HR', 'Maria Lopez',
    'Acknowledgment letter sent to employee (a.williams@co.com).', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-03', 'letter.generated', '2026-03-30T09:45:00Z', 'HR', 'Maria Lopez',
    'Acknowledgment letter generated for case CASE-2026-022.', ['hr', 'super_admin', 'medical_reviewer']),
  makeEvent('ev-02', 'eeoc.stage_complete', '2026-03-23T15:00:00Z', 'SYSTEM', 'System',
    'Stage 1 (Intake) completed. Case saved.', ['manager', 'hr', 'super_admin']),
  makeEvent('ev-01', 'case.created', '2026-03-23T14:58:00Z', 'HR', 'Maria Lopez',
    'Case CASE-2026-022 created for A. Williams. Type: Schedule. Laws: ADA, PWFA.', ['manager', 'hr', 'super_admin']),
];

const MOCK_TIMELINE_RESPONSE = {
  events: MOCK_TIMELINE_EVENTS,
  total: 14,
  limit: 100,
  offset: 0,
};

// Empty response for non-matching case IDs (CASE-TEST-IN-PROGRESS)
const EMPTY_TIMELINE_RESPONSE = {
  events: [],
  total: 0,
  limit: 100,
  offset: 0,
};

function addTimelineHandlers() {
  server.use(
    http.get(`${API}/api/v1/cases/CASE-2026-022/timeline`, () =>
      HttpResponse.json(MOCK_TIMELINE_RESPONSE, { status: 200 }),
    ),
    http.get(`${API}/api/v1/cases/CASE-TEST-IN-PROGRESS/timeline`, () =>
      HttpResponse.json(EMPTY_TIMELINE_RESPONSE, { status: 200 }),
    ),
    // Catch-all for any other case IDs
    http.get(`${API}/api/v1/cases/:caseId/timeline`, () =>
      HttpResponse.json(EMPTY_TIMELINE_RESPONSE, { status: 200 }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

type RoleType = 'hr' | 'super_admin' | 'medical_reviewer' | 'manager';

function makeMockClient() {
  return createAuthenticatedClient({
    getAccessToken: () => makeFakeAccessToken(),
    onTokenRefreshed: () => {},
    onAuthLost: () => {},
  });
}

function setupAuth(role: RoleType) {
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-test-001',
      email: `${role}@acmd-test.com`,
      name: `${role} User`,
      role,
      companyId: 'company-test-abc',
    },
    client: makeMockClient(),
    isAuthenticated: true,
    token: makeFakeAccessToken({ role }),
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderTimelinePage(caseId = 'CASE-2026-022') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/cases/${caseId}/timeline`]}>
        <Routes>
          <Route path="/cases/:id/timeline" element={<TimelinePage />} />
          <Route path="/cases" element={<div data-testid="cases-page">Cases</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimelinePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addTimelineHandlers();
  });

  // T1 — HR can view
  it('T1: HR role — renders page title + case header', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('CASE-2026-022');
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('A. Williams');
    expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
  });

  // T2 — super_admin can view
  it('T2: super_admin — renders page title + case header', async () => {
    setupAuth('super_admin');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('CASE-2026-022');
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('A. Williams');
    expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
  });

  // T3 — manager NOT blocked
  it('T3: manager — Access NOT denied (manager can view)', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
    expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
  });

  // T4 — medical_reviewer can view
  it('T4: medical_reviewer — renders page title', async () => {
    setupAuth('medical_reviewer');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('CASE-2026-022');
    expect(screen.queryByTestId('access-denied')).not.toBeInTheDocument();
  });

  // T5 — HR sees medical event detail (not restricted)
  it('T5: HR — sees medical event detail (not [Medical — restricted])', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Medical documentation status changed to: Cleared.'),
    ).toBeInTheDocument();
    const restrictedLabels = screen.queryAllByTestId('medical-restricted-label');
    expect(restrictedLabels).toHaveLength(0);
  });

  // T6 — manager sees [Medical — restricted] for medical events
  it('T6: manager — medical events show [Medical — restricted]', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    const restrictedLabels = screen.getAllByTestId('medical-restricted-label');
    expect(restrictedLabels.length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Medical documentation status changed to: Cleared.'),
    ).not.toBeInTheDocument();
  });

  // T7 — manager does NOT see Actor Role filter
  it('T7: manager — Actor Role filter NOT shown', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('actor-role-filter')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: /filter by actor role/i }),
    ).not.toBeInTheDocument();
  });

  // T8 — HR sees Actor Role filter
  it('T8: HR — Actor Role filter IS shown', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('actor-role-filter')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /filter by actor role/i }),
    ).toBeInTheDocument();
  });

  // T9 — Sort toggle changes order
  it('T9: Sort toggle Newest First / Oldest First changes order', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    const timeline = screen.getByTestId('timeline-list');

    const entries = timeline.querySelectorAll('[data-testid^="timeline-entry-"]');
    const firstSeq = parseInt(
      (entries[0].getAttribute('data-testid') ?? '').replace('timeline-entry-', ''),
      10,
    );
    const lastSeq = parseInt(
      (entries[entries.length - 1].getAttribute('data-testid') ?? '').replace('timeline-entry-', ''),
      10,
    );
    // seq is assigned by server-array index (index 0 = newest event → seq=1).
    // Newest first: seq=1 (newest) shown first, seq=14 (oldest) shown last → firstSeq < lastSeq
    expect(firstSeq).toBeLessThan(lastSeq);

    // Switch to oldest first
    const oldestFirstRadio = screen.getByRole('radio', { name: /sort oldest first/i });
    fireEvent.click(oldestFirstRadio);

    const updatedEntries = timeline.querySelectorAll('[data-testid^="timeline-entry-"]');
    const newFirstSeq = parseInt(
      (updatedEntries[0].getAttribute('data-testid') ?? '').replace('timeline-entry-', ''),
      10,
    );
    const newLastSeq = parseInt(
      (updatedEntries[updatedEntries.length - 1].getAttribute('data-testid') ?? '').replace('timeline-entry-', ''),
      10,
    );
    // Oldest first: seq=14 (oldest) shown first, seq=1 (newest) shown last → newFirstSeq > newLastSeq
    expect(newFirstSeq).toBeGreaterThan(newLastSeq);
  });

  // T10 — Search filter
  it('T10: Search filter (keyword ≥3 chars → filters entries)', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox', { name: /search timeline entries/i });

    // Before search: multiple entries visible
    const beforeCount = screen.getAllByTestId(/^timeline-entry-\d+$/).length;
    expect(beforeCount).toBeGreaterThan(1);

    // Search for a specific term that matches only 1 event
    fireEvent.change(searchInput, { target: { value: 'case.created' } });

    // After search: fewer entries
    const afterEntries = screen.getAllByTestId(/^timeline-entry-\d+$/);
    expect(afterEntries.length).toBeLessThan(beforeCount);
    // The entry with "case.created" should be visible
    expect(screen.getByText(/Case CASE-2026-022 created for A. Williams/)).toBeInTheDocument();
  });

  // T11 — Event type badge color correct (case_lifecycle = blue)
  it('T11: event type badge for case_lifecycle has blue class', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      // SEQ#1 is the last event (case.created) — mapApiEvent gives it index 13 → seq=14
      // Wait for timeline-list to have entries
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    // With 14 events newest-first from server:
    //   index 0 = ev-14 → seq=1  (deadline.level2_alert → deadline_alert)
    //   index 13 = ev-01 → seq=14 (case.created → case_lifecycle, blue badge)
    // Use data-testid="badge-14" to get the case.created badge directly.
    // getAllByText would also match the <option> in the filter dropdown.
    const caseCreatedBadge = screen.getByTestId('badge-14');
    expect(caseCreatedBadge).toHaveTextContent('Case Lifecycle');
    // The badge should have blue class
    expect(caseCreatedBadge).toHaveClass('bg-blue-100');
    expect(caseCreatedBadge).toHaveClass('text-blue-800');
  });

  // T12 — EffectivenessCheckPanel shown when status=approved
  it('T12: EffectivenessCheckPanel shown when case status is approved', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('effectiveness-check-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('effectiveness-check-panel')).toBeInTheDocument();
  });

  // T13 — EffectivenessCheckPanel NOT shown when status≠approved
  it('T13: EffectivenessCheckPanel not shown for non-approved status', async () => {
    setupAuth('hr');
    renderTimelinePage('CASE-TEST-IN-PROGRESS');
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('effectiveness-check-panel')).not.toBeInTheDocument();
  });

  // T14 — manager ExportButton has no CSV option
  it('T14: manager — ExportButton has no CSV option', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('export-button-container')).toBeInTheDocument();
    });
    const exportContainer = screen.getByTestId('export-button-container');
    fireEvent.click(exportContainer.querySelector('button')!);
    expect(screen.getByTestId('export-pdf-option')).toBeInTheDocument();
    expect(screen.queryByTestId('export-csv-option')).not.toBeInTheDocument();
  });

  // T15 — HR ExportButton has CSV option
  it('T15: HR — ExportButton has PDF + CSV options', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('export-button-container')).toBeInTheDocument();
    });
    const exportContainer = screen.getByTestId('export-button-container');
    fireEvent.click(exportContainer.querySelector('button')!);
    expect(screen.getByTestId('export-pdf-option')).toBeInTheDocument();
    expect(screen.getByTestId('export-csv-option')).toBeInTheDocument();
  });

  // T16 — manager case header does NOT show accommodation type
  it('T16: manager — case header does NOT show accommodation type', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('case-header-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('Accommodation Case');
    expect(screen.queryByTestId('accommodation-type')).not.toBeInTheDocument();
  });

  // T17 — HR case header shows accommodation type
  it('T17: HR — case header shows accommodation type', async () => {
    setupAuth('hr');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('accommodation-type')).toBeInTheDocument();
    });
    expect(screen.getByTestId('accommodation-type')).toHaveTextContent('Schedule Modification');
    expect(screen.getByTestId('case-header-title')).toHaveTextContent('Schedule Modification');
  });

  // T18 — manager: letter events (managerVisible:false) do not leak PII email
  it('T18: manager — letter events (managerVisible:false) do not leak PII email', async () => {
    setupAuth('manager');
    renderTimelinePage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    expect(screen.queryByText(/a\.williams@co\.com/i)).not.toBeInTheDocument();
    const restrictedLabels = screen.getAllByTestId('medical-restricted-label');
    expect(restrictedLabels.length).toBeGreaterThanOrEqual(2);
  });
});

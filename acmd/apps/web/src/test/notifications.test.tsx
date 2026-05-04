/**
 * ACMD-142 — Vitest tests for NotificationsPage + Topbar NavBellBadge
 * ACMD-150 — Updated mock handlers for real API shape (AcmdNotification)
 *
 * Tests:
 *   T01: Access Denied rendered for medical_reviewer role
 *   T02: Super Admin sees 5 tabs (All/Unread/Deadline/Cases/System)
 *   T03: HR sees 5 tabs (All/Unread/Deadline/Cases/System)
 *   T04: Manager sees 4 tabs (All/Unread/Input Requests/Case Updates) — no Deadline/System
 *   T05: FilterBar for super_admin has 4 fields (caseId + dateRange + urgency + company)
 *   T06: FilterBar for hr has 3 fields (caseId + dateRange + urgency), no company
 *   T07: FilterBar for manager has 1 field (dateRange only — no caseId, urgency, company)
 *   T08: Unread notification has blue dot + bold title + #EFF6FF bg
 *   T09: Level 5 OVERDUE — has #FEF2F2 bg, OVERDUE badge, no-dismiss notice
 *   T10: Level 4 CRITICAL — has red left border, CRITICAL badge, no-dismiss notice
 *   T11: GroupHeader shows Today / Yesterday / This Week sections
 *   T12: BulkActionBar hidden when no selection; shown after selecting 1 item
 *   T13: Mark All as Read — all notifications become read (no unread dots)
 *   T14: Manager view — does NOT show medical/case reason in approved entry
 *   T15: [load-older] element is rendered (pagination state — no more data)
 *   T16: Topbar Bell button has aria-label with unread count
 *   T17: Topbar Bell badge is visible with correct data-testid
 *   T18: Bulk [Mark Selected as Read] marks selected items as read
 *   T19: Tab switching — Deadline tab filters to only deadline notifications
 *   T20: Preferences link navigates to /settings
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

import { NotificationsPage } from '@/pages/NotificationsPage';
import { Topbar } from '@/components/layout/Topbar';
import { useAuth } from '@/lib/auth-context';
import { createAuthenticatedClient } from '@/lib/api-client';
import { makeFakeAccessToken } from './handlers';

// ---------------------------------------------------------------------------
// Mock API response — AcmdNotification shape matching test assertions
// IDs match previous mock (notif-001 … notif-008) so data-testid assertions work.
// ---------------------------------------------------------------------------

const API = 'http://localhost:3000';

// Timestamps: relative to real Date.now() so computeDateGroup() bucketing is stable
const _now = Date.now();
const todayISO = new Date(_now - 2 * 60 * 60 * 1000).toISOString();        // 2h ago  → 'today'
const today2ISO = new Date(_now - 5 * 60 * 60 * 1000).toISOString();       // 5h ago  → 'today'
const today3ISO = new Date(_now - 8 * 60 * 60 * 1000).toISOString();       // 8h ago  → 'today'
const yesterdayISO = new Date(_now - 28 * 60 * 60 * 1000).toISOString();   // 28h ago → 'yesterday'
const yesterday2ISO = new Date(_now - 36 * 60 * 60 * 1000).toISOString();  // 36h ago → 'yesterday'
const thisWeekISO = new Date(_now - 3 * 24 * 60 * 60 * 1000).toISOString();  // 3d ago → 'this_week'
const thisWeek2ISO = new Date(_now - 4 * 24 * 60 * 60 * 1000).toISOString(); // 4d ago → 'this_week'
const thisWeek3ISO = new Date(_now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5d ago → 'this_week'

const MOCK_API_NOTIFICATIONS = [
  {
    id: 'notif-001',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'deadline_l5',
    title: 'CASE-2026-014 — Acme Corp — OVERDUE (Day 33 of 30)',
    body: 'J. Smith — Standing Desk — Assigned to: Maria Johnson (HR). Case OVERDUE by 3 business days. Legal risk escalation.',
    caseId: 'CASE-2026-014',
    readAt: null,
    emailSent: false,
    priority: 'urgent',
    createdAt: todayISO,
  },
  {
    id: 'notif-002',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'deadline_l4',
    title: 'CASE-2026-019 — Beta Inc — Due Tomorrow (1 day remaining)',
    body: 'R. Johnson — Schedule Modification — Assigned to: Tom Lee (HR). CRITICAL: Case due tomorrow. Action required immediately.',
    caseId: 'CASE-2026-019',
    readAt: null,
    emailSent: false,
    priority: 'urgent',
    createdAt: today2ISO,
  },
  {
    id: 'notif-003',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'system',
    title: 'Scheduled Maintenance: Sunday 04/14/2026 02:00–04:00 AM ET',
    body: 'All case workflows will be unavailable during this maintenance window.',
    caseId: null,
    readAt: null,
    emailSent: false,
    priority: 'normal',
    createdAt: today3ISO,
  },
  {
    id: 'notif-004',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'mgr_submitted',
    title: 'CASE-2026-022 — Manager Input Received',
    body: 'A. Williams — Manager Tom Anderson submitted input response. Job duties and workspace information submitted.',
    caseId: 'CASE-2026-022',
    readAt: null,
    emailSent: false,
    priority: 'normal',
    createdAt: yesterdayISO,
  },
  {
    id: 'notif-005',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'approved',
    title: 'CASE-2026-035 — Acme Corp — APPROVED',
    body: 'P. Garcia — Schedule Modification — Approved by: Maria Johnson. Accommodation approved.',
    caseId: 'CASE-2026-035',
    readAt: '2026-04-12T12:00:00Z',  // already read
    emailSent: true,
    priority: 'normal',
    createdAt: yesterday2ISO,
  },
  {
    id: 'notif-006',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'deadline_l2',
    title: 'CASE-2026-028 — Acme Corp — 7 Days Remaining',
    body: 'L. Chen — Equipment — Assigned to: Maria Johnson (HR). Action needed: 7 days remaining.',
    caseId: 'CASE-2026-028',
    readAt: '2026-04-11T09:00:00Z',  // already read
    emailSent: false,
    priority: 'high',
    createdAt: thisWeekISO,
  },
  {
    id: 'notif-007',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'letter_gen',
    title: 'CASE-2026-031 — Letter Generated',
    body: 'M. Davis — Acknowledgment Letter generated and sent to employee.',
    caseId: 'CASE-2026-031',
    readAt: '2026-04-10T16:00:00Z',  // already read
    emailSent: false,
    priority: 'low',
    createdAt: thisWeek2ISO,
  },
  {
    id: 'notif-008',
    companyId: 'company-test-abc',
    userId: 'user-test-001',
    type: 'case_stage',
    title: 'CASE-2026-031 — Stage Advanced',
    body: 'M. Davis — Physical Accommodation — Stage moved: Medical → Decision.',
    caseId: 'CASE-2026-031',
    readAt: '2026-04-09T17:00:00Z',  // already read
    emailSent: false,
    priority: 'low',
    createdAt: thisWeek3ISO,
  },
];

const MOCK_API_RESPONSE = {
  notifications: MOCK_API_NOTIFICATIONS,
  total: 8,
  unreadCount: 4,
};

function addNotificationsHandler() {
  server.use(
    http.get(`${API}/api/v1/notifications`, () =>
      HttpResponse.json(MOCK_API_RESPONSE, { status: 200 }),
    ),
    http.patch(`${API}/api/v1/notifications/read-all`, () =>
      HttpResponse.json({ message: 'All notifications marked as read' }, { status: 200 }),
    ),
    http.patch(`${API}/api/v1/notifications/:id/read`, () =>
      HttpResponse.json({ message: 'Notification marked as read' }, { status: 200 }),
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

function renderNotificationsPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<div data-testid="settings-page">Settings</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderTopbar() {
  // T-059: Topbar now uses useQuery to fetch real notifications — must wrap
  // in QueryClientProvider just like NotificationsPage. addNotificationsHandler()
  // (msw) supplies the API response with unreadCount=4 and 2 unread urgent items.
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Topbar collapsed={false} onToggleCollapse={vi.fn()} onOpenMobile={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addNotificationsHandler();
  });

  // T01 — medical_reviewer blocked
  it('T01: shows Access Denied for medical_reviewer role', () => {
    setupAuth('medical_reviewer');
    renderNotificationsPage();
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-page')).not.toBeInTheDocument();
  });

  // T02 — super_admin tabs
  it('T02: super_admin sees 5 tabs including Deadline and System', async () => {
    setupAuth('super_admin');
    renderNotificationsPage();
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const tabNav = screen.getByTestId('notification-tabs');
    expect(within(tabNav).getByTestId('tab-all')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-unread')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-deadline')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-cases')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-system')).toBeInTheDocument();
    // Manager-only tabs should NOT be present
    expect(screen.queryByTestId('tab-input_requests')).not.toBeInTheDocument();
  });

  // T03 — HR tabs
  it('T03: hr sees 5 tabs including Deadline and System', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const tabNav = screen.getByTestId('notification-tabs');
    expect(within(tabNav).getByTestId('tab-deadline')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-system')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-input_requests')).not.toBeInTheDocument();
  });

  // T04 — Manager tabs
  it('T04: manager sees 4 tabs (no Deadline, no System)', async () => {
    setupAuth('manager');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const tabNav = screen.getByTestId('notification-tabs');
    expect(within(tabNav).getByTestId('tab-all')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-unread')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-input_requests')).toBeInTheDocument();
    expect(within(tabNav).getByTestId('tab-case_updates')).toBeInTheDocument();
    // Deadline and System should NOT be present for manager
    expect(screen.queryByTestId('tab-deadline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-system')).not.toBeInTheDocument();
  });

  // T05 — super_admin FilterBar 4 fields
  it('T05: super_admin FilterBar has 4 fields including company dropdown', async () => {
    setupAuth('super_admin');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const filterBar = screen.getByTestId('filter-bar');
    expect(within(filterBar).getByTestId('filter-case-id')).toBeInTheDocument();
    expect(within(filterBar).getByTestId('filter-date-from')).toBeInTheDocument();
    expect(within(filterBar).getByTestId('filter-urgency')).toBeInTheDocument();
    expect(within(filterBar).getByTestId('filter-company')).toBeInTheDocument();
  });

  // T06 — HR FilterBar 3 fields (no company)
  it('T06: hr FilterBar has 3 fields (no company dropdown)', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const filterBar = screen.getByTestId('filter-bar');
    expect(within(filterBar).getByTestId('filter-case-id')).toBeInTheDocument();
    expect(within(filterBar).getByTestId('filter-date-from')).toBeInTheDocument();
    expect(within(filterBar).getByTestId('filter-urgency')).toBeInTheDocument();
    expect(within(filterBar).queryByTestId('filter-company')).not.toBeInTheDocument();
  });

  // T07 — Manager FilterBar date only
  it('T07: manager FilterBar has only date range (no caseId, no urgency, no company)', async () => {
    setupAuth('manager');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const filterBar = screen.getByTestId('filter-bar');
    expect(within(filterBar).getByTestId('filter-date-from')).toBeInTheDocument();
    expect(within(filterBar).queryByTestId('filter-case-id')).not.toBeInTheDocument();
    expect(within(filterBar).queryByTestId('filter-urgency')).not.toBeInTheDocument();
    expect(within(filterBar).queryByTestId('filter-company')).not.toBeInTheDocument();
  });

  // T08 — Unread notification blue dot + bold
  it('T08: unread notification has blue dot indicator and data-unread=true', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-001')).toBeInTheDocument();
    });
    const overdueEntry = screen.getByTestId('notification-entry-notif-001');
    expect(overdueEntry).toHaveAttribute('data-unread', 'true');
    // Blue dot should be visible
    const dot = screen.getByTestId('unread-dot-notif-001');
    expect(dot).toBeInTheDocument();
    // Title is rendered bold (font-bold)
    const title = screen.getByTestId('notif-title-notif-001');
    expect(title.className).toMatch(/font-bold/);
  });

  // T09 — Level 5 OVERDUE: #FEF2F2 bg, OVERDUE pin, no dismiss
  it('T09: OVERDUE (level 5) notification has #FEF2F2 bg and no-dismiss notice', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-001')).toBeInTheDocument();
    });
    const entry = screen.getByTestId('notification-entry-notif-001');
    expect(entry).toHaveAttribute('data-urgency', '5');
    // Background color set via style
    expect(entry).toHaveStyle({ backgroundColor: '#FEF2F2' });
    // No-dismiss notice visible
    expect(screen.getByTestId('no-dismiss-notice-notif-001')).toBeInTheDocument();
    expect(screen.getByTestId('no-dismiss-notice-notif-001')).toHaveTextContent(
      'cannot be dismissed until the case is resolved',
    );
  });

  // T10 — Level 4 CRITICAL: red left border, no dismiss
  it('T10: CRITICAL (level 4) notification has red left border and no-dismiss notice', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-002')).toBeInTheDocument();
    });
    const entry = screen.getByTestId('notification-entry-notif-002');
    expect(entry).toHaveAttribute('data-urgency', '4');
    // Verify red left border via data attribute (JSDOM does not parse shorthand borderLeft)
    expect(entry).toHaveAttribute('data-critical-border', 'true');
    expect(screen.getByTestId('no-dismiss-notice-notif-002')).toBeInTheDocument();
    expect(screen.getByTestId('no-dismiss-notice-notif-002')).toHaveTextContent(
      'cannot be dismissed until action is taken',
    );
  });

  // T11 — GroupHeaders for Today / Yesterday / This Week
  it('T11: GroupHeaders for Today, Yesterday, and This Week are rendered', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const headerToday = screen.getByTestId('group-header-today');
    const headerYesterday = screen.getByTestId('group-header-yesterday');
    const headerThisWeek = screen.getByTestId('group-header-this_week');
    expect(headerToday).toBeInTheDocument();
    expect(headerYesterday).toBeInTheDocument();
    expect(headerThisWeek).toBeInTheDocument();
    // Use within() to avoid ambiguity with relative-time elements that also say "Yesterday"
    expect(within(headerToday).getByText('Today')).toBeInTheDocument();
    expect(within(headerYesterday).getByText('Yesterday')).toBeInTheDocument();
    expect(within(headerThisWeek).getByText('This Week')).toBeInTheDocument();
  });

  // T12 — BulkActionBar hidden then shown
  it('T12: BulkActionBar hidden when nothing selected, shown after selecting 1 item', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-003')).toBeInTheDocument();
    });
    // Initially hidden
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    // Select notif-003 (system notification, dismissible)
    const checkbox = screen.getByTestId('select-notif-notif-003');
    fireEvent.click(checkbox);
    // Now BulkActionBar should appear
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
  });

  // T13 — Mark All as Read (optimistic update)
  it('T13: Mark All as Read removes unread dots from all notifications', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('unread-dot-notif-001')).toBeInTheDocument();
    });
    // Click mark all read
    fireEvent.click(screen.getByTestId('mark-all-read'));
    // After optimistic update: unread dot should be gone for notif-001
    await waitFor(() => {
      expect(screen.queryByTestId('unread-dot-notif-001')).not.toBeInTheDocument();
    });
  });

  // T14 — Manager privacy — approved entry shows "Case resolved — no action required."
  it('T14: manager sees "Case resolved — no action required." for approved notifications', async () => {
    setupAuth('manager');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-005')).toBeInTheDocument();
    });
    // notif-005 is type 'approved' — manager should see privacy-safe title
    const titleEl = screen.getByTestId('notif-title-notif-005');
    expect(titleEl).toHaveTextContent('Case resolved — no action required.');
    // Should NOT show accommodation type "Schedule Modification"
    expect(titleEl).not.toHaveTextContent('Schedule Modification');
  });

  // T15 — Load older element (pagination — API returns total=8, no more data)
  it('T15: load-older element is rendered showing pagination state', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('load-older')).toBeInTheDocument();
    });
    // With 8 notifications and PAGE_SIZE=20, total=8 → no more data → shows "All notifications loaded"
    expect(screen.getByTestId('load-older')).toHaveTextContent('All notifications loaded');
  });

  // T16 — Relative time displayed + tooltip
  it('T16: notification shows relative time with tooltip element', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notif-time-notif-001')).toBeInTheDocument();
    });
    const timeEl = screen.getByTestId('notif-time-notif-001');
    // Time element exists and has a title attribute (absolute datetime tooltip)
    expect(timeEl).toBeInTheDocument();
    expect(timeEl).toHaveAttribute('title');
  });

  // T17 — Tab switching filters notifications (Deadline tab)
  it('T17: clicking Deadline tab shows only deadline-type notifications', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-001')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-deadline'));
    // deadline_l5, deadline_l4, deadline_l2 should be visible
    expect(screen.getByTestId('notification-entry-notif-001')).toBeInTheDocument();
    expect(screen.getByTestId('notification-entry-notif-002')).toBeInTheDocument();
    expect(screen.getByTestId('notification-entry-notif-006')).toBeInTheDocument();
    // system and letter_gen should NOT be visible
    expect(screen.queryByTestId('notification-entry-notif-003')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-entry-notif-007')).not.toBeInTheDocument();
  });

  // T18 — Bulk Mark Selected as Read (optimistic update)
  it('T18: bulk Mark Selected as Read marks selected items as read', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-004')).toBeInTheDocument();
    });
    // Select notif-004 (unread, dismissible)
    const checkbox = screen.getByTestId('select-notif-notif-004');
    fireEvent.click(checkbox);
    // Verify BulkActionBar appeared
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    // notif-004 is unread
    expect(screen.getByTestId('unread-dot-notif-004')).toBeInTheDocument();
    // Mark as read
    fireEvent.click(screen.getByTestId('bulk-mark-read'));
    // Now unread dot should be gone (optimistic)
    await waitFor(() => {
      expect(screen.queryByTestId('unread-dot-notif-004')).not.toBeInTheDocument();
    });
    // BulkActionBar should hide (no selection)
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  // T19 — Preferences link points to /settings
  it('T19: Preferences link navigates to /settings', async () => {
    setupAuth('hr');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notifications-page')).toBeInTheDocument();
    });
    const prefsLink = screen.getByTestId('preferences-link');
    expect(prefsLink).toBeInTheDocument();
    expect(prefsLink).toHaveAttribute('href', '/settings');
  });

  // T20 — System tab shows only system notifications
  it('T20: clicking System tab shows only system notifications', async () => {
    setupAuth('super_admin');
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByTestId('notification-entry-notif-001')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-system'));
    // notif-003 is system type
    expect(screen.getByTestId('notification-entry-notif-003')).toBeInTheDocument();
    // Other types should not be present
    expect(screen.queryByTestId('notification-entry-notif-001')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-entry-notif-004')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Topbar NavBellBadge tests
// ---------------------------------------------------------------------------

describe('Topbar NavBellBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // T-059: Topbar fetches GET /api/v1/notifications via TanStack Query;
    // register the same msw handler used by the NotificationsPage suite so the
    // badge reflects real API data (unreadCount=4, 2 unread urgent items).
    addNotificationsHandler();
  });

  it('T16: Bell button has aria-label with unread count', async () => {
    setupAuth('hr');
    renderTopbar();
    const bellButton = screen.getByTestId('topbar-bell-button');
    expect(bellButton).toBeInTheDocument();
    // aria-label should include "unread notifications" — both pre-fetch
    // ("0 unread notifications") and post-fetch ("4 unread notifications")
    // satisfy the substring assertion.
    await waitFor(() => {
      expect(bellButton).toHaveAttribute(
        'aria-label',
        expect.stringContaining('unread notifications'),
      );
    });
  });

  it('T17: Bell badge reflects API unreadCount + critical color when an unread urgent item exists', async () => {
    setupAuth('hr');
    renderTopbar();
    // Wait for the query to populate the badge with the API value.
    // MOCK_API_RESPONSE.unreadCount = 4 (notifications.test.tsx mock data).
    const badge = await screen.findByTestId('topbar-bell-badge');
    await waitFor(() => {
      expect(badge).toHaveTextContent('4');
    });
    // notif-001 (deadline_l5, unread, priority urgent) makes hasCritical=true
    // → badge color must be red (#EF4444).
    expect(badge).toHaveStyle({ backgroundColor: '#EF4444' });
    // aria-label must reflect the live unread count.
    const bellButton = screen.getByTestId('topbar-bell-button');
    expect(bellButton).toHaveAttribute('aria-label', '4 unread notifications');
  });

  it('T17b: Bell badge uses neutral blue when no unread critical items exist', async () => {
    // Override the default handler with a response that has unread items but
    // none of them are urgent / deadline_l4 / deadline_l5 — hasCritical must be false.
    server.use(
      http.get(`${API}/api/v1/notifications`, () =>
        HttpResponse.json(
          {
            notifications: [
              {
                id: 'notif-low-1',
                companyId: 'company-test-abc',
                userId: 'user-test-001',
                type: 'system',
                title: 'Low priority notice',
                body: 'No action required',
                caseId: null,
                readAt: null,
                emailSent: false,
                priority: 'low',
                createdAt: new Date().toISOString(),
              },
            ],
            total: 1,
            unreadCount: 1,
          },
          { status: 200 },
        ),
      ),
    );
    setupAuth('hr');
    renderTopbar();
    const badge = await screen.findByTestId('topbar-bell-badge');
    await waitFor(() => {
      expect(badge).toHaveTextContent('1');
    });
    // No critical → blue (#2563EB).
    expect(badge).toHaveStyle({ backgroundColor: '#2563EB' });
  });
});

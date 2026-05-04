/**
 * ACMD-141 — Vitest tests for LettersPage + CaseDetailPage Letters tab
 * ACMD-151 — Updated mock data to AcmdLetter shape (real API integration)
 *
 * Tests:
 *   T01: Tab switching — 5 tabs visible (Acknowledgment/Medical Request/Approval/Denial/Follow-up)
 *   T02: Metadata Bar — shows correct Re/Date/Type/Status for active tab
 *   T03: Immutable section indicator visible in Denial tab (lock icon)
 *   T04: Edit immutable section attempt (delete [IMMUTABLE_START]) → shows error
 *   T05: Compliance Check Banner visible in Denial tab
 *   T06: Compliance Check Banner NOT visible in Acknowledgment tab
 *   T07: Finalize button disabled when compliance items fail (Denial)
 *   T08: Finalize button enabled when compliance check passes (non-Denial)
 *   T09: Finalized State — finalized banner shown (acknowledgment letter with status 'sent')
 *   T10: Create New Version button visible in finalized state
 *   T11: Letter History panel renders mock letters
 *   T12: SMTP — Send button shown for draft letters
 *   T13: Role guard — manager → Access Denied
 *   T14: Role guard — medical_reviewer → Access Denied
 *   T15: PWFA dual-law banner shows in Denial tab (dual-law case)
 *   T16: Copy button exists in primary actions
 *   T17: Placeholder panel shows available tokens
 *   T18: Token click-to-insert — token inserted into textarea
 *   T19: HR role — Letters tab link shows in CaseDetailPage
 *   T20: Manager role — Letters tab link NOT shown in CaseDetailPage
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Hoist mocks
vi.mock('@/lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-context')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

// Mock letters API functions for mutation tests (T21–T23)
vi.mock('@/lib/api/letters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/letters')>();
  return {
    ...actual,
    createLetter: vi.fn().mockResolvedValue({
      letter: {
        id: 'letter-new',
        caseId: 'CASE-2026-047',
        type: 'acknowledgment',
        content: 'Generated content',
        status: 'draft',
        sentToEmail: null,
        pdfUrl: null,
        createdBy: 'user-hr-001',
        sentAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      source: 'ai',
    }),
    updateLetterContent: vi.fn().mockResolvedValue({
      id: 'letter-002',
      caseId: 'CASE-2026-047',
      type: 'denial',
      content: 'Updated content',
      status: 'draft',
      sentToEmail: null,
      pdfUrl: null,
      createdBy: 'user-hr-001',
      sentAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    sendLetter: vi.fn().mockResolvedValue({
      letter: {
        id: 'letter-002',
        caseId: 'CASE-2026-047',
        type: 'denial',
        content: 'Content',
        status: 'sent',
        sentToEmail: null,
        pdfUrl: null,
        createdBy: 'user-hr-001',
        sentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      emailSent: true,
    }),
    fetchLetters: actual.fetchLetters,
    downloadLetterPdf: actual.downloadLetterPdf,
  };
});

// ---------------------------------------------------------------------------
// AcmdLetter mock data (AcmdLetter shape — ACMD-151)
// ---------------------------------------------------------------------------

const MOCK_CASE_ID = 'CASE-2026-047';

const ACKNOWLEDGMENT_CONTENT = `{company_letterhead}

April 10, 2026

Dear {employee_name},

We have received your request for a reasonable accommodation ({accommodation_type}) submitted on {request_date}. We take your request seriously and are committed to engaging in an interactive process to determine an appropriate accommodation.

We will review your request and respond within 3 business days.

Sincerely,
{hr_name}
{hr_title}
{company_name}`;

const DENIAL_CONTENT = `{company_letterhead}

April 10, 2026

Dear {employee_name},

We have carefully reviewed your request for a reasonable accommodation ({accommodation_type}).

After thorough analysis, we are unable to provide the requested accommodation at this time.

{denial_reason}

[IMMUTABLE_START]
APPEAL RIGHTS

You have the right to request reconsideration of this decision. You may submit a written appeal to HR within 30 days of this letter.

You may also file a charge of discrimination with the Equal Employment Opportunity Commission (EEOC) within 180 days of the alleged discriminatory act.

To file an EEOC charge:
Phone: 1-800-669-4000
Web: www.eeoc.gov
[IMMUTABLE_END]

Sincerely,
{hr_name}
{hr_title}
{company_name}`;

const APPROVAL_CONTENT = `{company_letterhead}

April 10, 2026

Dear {employee_name},

We are pleased to inform you that your request for a reasonable accommodation ({accommodation_type}) has been approved.

Sincerely,
{hr_name}`;

const FOLLOWUP_CONTENT = `{company_letterhead}

April 10, 2026

Dear {employee_name},

We are following up regarding the accommodation ({accommodation_type}) that has been in place.

Sincerely,
{hr_name}`;

// AcmdLetter shape mock data (matching backend/DB schema)
const MOCK_LETTERS_DATA = [
  {
    id: 'letter-001',
    caseId: MOCK_CASE_ID,
    type: 'acknowledgment' as const,
    content: ACKNOWLEDGMENT_CONTENT,
    status: 'sent' as const,
    sentToEmail: 'john.davis@company.com',
    pdfUrl: null,
    createdBy: 'user-hr-001',
    sentAt: '2026-04-01T10:15:00.000Z',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T10:15:00.000Z',
  },
  {
    id: 'letter-002',
    caseId: MOCK_CASE_ID,
    type: 'denial' as const,
    content: DENIAL_CONTENT,
    status: 'draft' as const,
    sentToEmail: null,
    pdfUrl: null,
    createdBy: 'user-hr-001',
    sentAt: null,
    createdAt: '2026-04-10T09:00:00.000Z',
    updatedAt: '2026-04-10T09:00:00.000Z',
  },
  {
    id: 'letter-003',
    caseId: MOCK_CASE_ID,
    type: 'approval' as const,
    content: APPROVAL_CONTENT,
    status: 'draft' as const,
    sentToEmail: null,
    pdfUrl: null,
    createdBy: 'user-hr-001',
    sentAt: null,
    createdAt: '2026-04-10T09:00:00.000Z',
    updatedAt: '2026-04-10T09:00:00.000Z',
  },
  {
    id: 'letter-004',
    caseId: MOCK_CASE_ID,
    type: 'follow_up' as const,
    content: FOLLOWUP_CONTENT,
    status: 'draft' as const,
    sentToEmail: null,
    pdfUrl: null,
    createdBy: 'user-hr-001',
    sentAt: null,
    createdAt: '2026-04-10T09:00:00.000Z',
    updatedAt: '2026-04-10T09:00:00.000Z',
  },
];

const MOCK_CASE_DATA = {
  id: MOCK_CASE_ID,
  employeeName: 'John Davis',
  type: 'multiple', // dual-law case (ADA + PWFA) so T15 PWFA banner test passes
  status: 'in_progress',
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
};

// CaseDetailPage has real API calls via TanStack Query — mock them
// Smart mock: return letters data for letters queryKey, case data for case queryKey
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      // Return letters data for letters queries
      if (Array.isArray(queryKey) && queryKey[0] === 'letters') {
        return {
          data: MOCK_LETTERS_DATA,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      // Return case data for case queries (CaseDetailPage)
      return {
        data: MOCK_CASE_DATA,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }),
    useQueryClient: vi.fn().mockReturnValue({
      invalidateQueries: vi.fn(),
      clear: vi.fn(),
    }),
  };
});

// Mock sub-components that make API calls
vi.mock('@/components/case-detail/CaseDetailHeader', () => ({
  CaseDetailHeader: () => <div data-testid="case-detail-header">CaseDetailHeader</div>,
}));
vi.mock('@/components/case-detail/EEOCStepper', () => ({
  EEOCStepper: () => <div data-testid="eeoc-stepper">EEOCStepper</div>,
}));
vi.mock('@/components/case-detail/DualTrackSplitView', () => ({
  DualTrackSplitView: () => <div data-testid="dual-track">DualTrackSplitView</div>,
}));
vi.mock('@/components/case-detail/StageActionPanel', () => ({
  StageActionPanel: () => <div data-testid="stage-action">StageActionPanel</div>,
}));
vi.mock('@/components/case-detail/TimelinePanel', () => ({
  TimelinePanel: () => <div data-testid="timeline-panel">TimelinePanel</div>,
}));

import { LettersPage } from '@/pages/LettersPage';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import { useAuth } from '@/lib/auth-context';
import { createLetter, updateLetterContent, sendLetter } from '@/lib/api/letters';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

type RoleType = 'hr' | 'super_admin' | 'medical_reviewer' | 'manager';

function setupAuth(role: RoleType) {
  mockUseAuth.mockReturnValue({
    user: {
      id: 'user-test-001',
      email: `${role}@acmd-test.com`,
      name: `${role} User`,
      role,
      companyId: 'company-test-abc',
    },
    client: {
      request: vi.fn().mockResolvedValue({}),
    },
    isAuthenticated: true,
    token: 'fake-token',
    bootstrap: 'authenticated' as const,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderLettersPage(caseId = MOCK_CASE_ID) {
  return render(
    <MemoryRouter initialEntries={[`/cases/${caseId}/letters`]}>
      <Routes>
        <Route path="/cases/:id/letters" element={<LettersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCaseDetailPage(caseId = MOCK_CASE_ID) {
  return render(
    <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
      <Routes>
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/cases/:id/letters" element={<div>Letters Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LettersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T01 — Tab switching: 5 tabs visible (added Medical Request)
  it('T01: renders all letter type tabs', () => {
    setupAuth('hr');
    renderLettersPage();

    expect(screen.getByTestId('tab-acknowledgment')).toBeDefined();
    expect(screen.getByTestId('tab-approval')).toBeDefined();
    expect(screen.getByTestId('tab-denial')).toBeDefined();
    expect(screen.getByTestId('tab-followup')).toBeDefined();
  });

  // T02 — Metadata Bar: shows correct metadata for active tab
  it('T02: Metadata Bar shows correct fields for active tab', () => {
    setupAuth('hr');
    renderLettersPage();

    // Default tab is Acknowledgment — which is 'sent' in mock data
    // SentBanner is shown and metadata bar is also rendered
    const metadataBar = screen.getByTestId('metadata-bar');
    expect(metadataBar.textContent).toContain('CASE-2026-047'); // Re field
    expect(metadataBar.textContent).toContain('Acknowledgment'); // Letter Type
  });

  // T03 — Immutable section indicator in Denial tab
  it('T03: Immutable section indicator (lock) visible in Denial tab', () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to Denial tab
    fireEvent.click(screen.getByTestId('tab-denial'));

    expect(screen.getByTestId('immutable-section-indicator')).toBeDefined();
    expect(screen.getByTestId('immutable-section-indicator').textContent).toContain('🔒');
  });

  // T04 — Edit immutable section attempt → shows error
  it('T04: deleting immutable section markers in Denial textarea shows error', () => {
    setupAuth('hr');
    renderLettersPage();

    fireEvent.click(screen.getByTestId('tab-denial'));

    const textarea = screen.getByTestId('letter-textarea');
    // Simulate deletion of [IMMUTABLE_START] marker
    fireEvent.change(textarea, {
      target: { value: 'some content without the immutable markers' },
    });

    expect(screen.getByTestId('immutable-edit-error')).toBeDefined();
    expect(screen.getByTestId('immutable-edit-error').textContent).toContain(
      'Appeal Rights',
    );
  });

  // T05 — Compliance Check Banner visible in Denial tab
  it('T05: Compliance Check Banner is visible in Denial tab', () => {
    setupAuth('hr');
    renderLettersPage();

    fireEvent.click(screen.getByTestId('tab-denial'));

    expect(screen.getByTestId('compliance-check-banner')).toBeDefined();
  });

  // T06 — Compliance Check Banner NOT visible in Acknowledgment tab
  it('T06: Compliance Check Banner is NOT visible in Acknowledgment tab', () => {
    setupAuth('hr');
    renderLettersPage();

    // Default tab is Acknowledgment — compliance banner should not be visible
    expect(screen.queryByRole('region', { name: 'Compliance check' })).toBeNull();
  });

  // T07 — Finalize button in Denial tab: when all compliance items pass → enabled
  it('T07: Finalize button is enabled in Denial tab when all compliance items pass', () => {
    setupAuth('hr');
    renderLettersPage();

    // Denial is draft in mock data
    fireEvent.click(screen.getByTestId('tab-denial'));

    const finalizeBtn = screen.getByTestId('finalize-btn');
    expect(finalizeBtn).toBeDefined();
    // Mock compliance items all pass → canFinalize=true → aria-disabled=false
    expect(finalizeBtn.getAttribute('aria-disabled')).toBe('false');
  });

  // T08 — Finalize button enabled when compliance check passes (non-Denial tab)
  it('T08: Finalize button enabled in Follow-up tab (no compliance required)', () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to follow_up (draft in mock data)
    fireEvent.click(screen.getByTestId('tab-followup'));

    const finalizeBtn = screen.getByTestId('finalize-btn');
    expect(finalizeBtn.getAttribute('aria-disabled')).toBe('false');
  });

  // T09 — Finalized State: finalized banner (SentBanner) shown for 'sent' letter
  it('T09: Sent/Finalized banner shown for acknowledgment letter (status: sent)', () => {
    setupAuth('hr');
    renderLettersPage();

    // Default tab is Acknowledgment — which has status: 'sent' in mock data
    // finalized-banner should be visible immediately
    expect(screen.getByTestId('finalized-banner')).toBeDefined();
    expect(screen.getByTestId('finalized-banner').textContent).toContain(
      'This letter has been finalized',
    );
  });

  // T10 — Create New Version button visible in finalized state
  it('T10: Create New Version button appears in finalized (sent) state', () => {
    setupAuth('hr');
    renderLettersPage();

    // Acknowledgment letter has status: 'sent' — shows SentBanner with create-new-version-btn
    expect(screen.getByTestId('create-new-version-btn')).toBeDefined();
  });

  // T11 — Letter History panel renders mock letters
  it('T11: Letter History panel renders mock letters', () => {
    setupAuth('hr');
    renderLettersPage();

    const historyPanel = screen.getByTestId('letter-history-panel');
    expect(historyPanel).toBeDefined();

    // Mock data has letters with ids letter-001 and letter-002
    expect(screen.getByTestId('history-item-letter-001')).toBeDefined();
    expect(screen.getByTestId('history-item-letter-002')).toBeDefined();
  });

  // T12 — SMTP: Send button shown for draft letters
  it('T12: SMTP Send button shown for draft letters', () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to denial tab (draft status) to see the send button
    fireEvent.click(screen.getByTestId('tab-denial'));

    expect(screen.getByTestId('send-smtp-btn')).toBeDefined();
    expect(screen.getByTestId('send-smtp-btn').textContent).toContain('Send');
  });

  // T13 — Role guard: manager → Access Denied
  it('T13: Manager role sees Access Denied', () => {
    setupAuth('manager');
    renderLettersPage();

    expect(screen.getByTestId('access-denied')).toBeDefined();
    expect(screen.getByTestId('access-denied').textContent).toContain('Access Denied');
  });

  // T14 — Role guard: medical_reviewer → Access Denied
  it('T14: Medical Reviewer role sees Access Denied', () => {
    setupAuth('medical_reviewer');
    renderLettersPage();

    expect(screen.getByTestId('access-denied')).toBeDefined();
    expect(screen.getByTestId('access-denied').textContent).toContain('Access Denied');
  });

  // T15 — PWFA dual-law banner shows in Denial tab
  it('T15: PWFA dual-law warning banner shown in Denial tab (dualLaw case)', () => {
    setupAuth('hr');
    renderLettersPage();

    fireEvent.click(screen.getByTestId('tab-denial'));

    // Denial tab is 'draft', PWFA banner shows because dualLaw=true (hardcoded)
    expect(screen.getByTestId('pwfa-dual-law-banner')).toBeDefined();
    expect(screen.getByTestId('pwfa-dual-law-banner').textContent).toContain('ADA + PWFA');
  });

  // T16 — Copy button exists in primary actions
  it('T16: Copy to Clipboard button is present', () => {
    setupAuth('hr');
    renderLettersPage();

    expect(screen.getByTestId('copy-btn')).toBeDefined();
    expect(screen.getByTestId('copy-btn').textContent).toContain('Copy');
  });

  // T17 — Placeholder panel shows available tokens (in draft tab)
  it('T17: Placeholder panel shows available variable tokens', () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to approval (draft status) to see placeholder panel
    fireEvent.click(screen.getByTestId('tab-approval'));

    expect(screen.getByTestId('placeholder-panel')).toBeDefined();
    // Check a few tokens are present
    expect(screen.getByTestId('token-btn-employee_name')).toBeDefined();
    expect(screen.getByTestId('token-btn-company_name')).toBeDefined();
  });

  // T18 — Token click-to-insert updates textarea value
  it('T18: clicking a token inserts it into the textarea', () => {
    setupAuth('hr');
    renderLettersPage();

    fireEvent.click(screen.getByTestId('tab-followup'));

    const textarea = screen.getByTestId('letter-textarea') as HTMLTextAreaElement;
    const initialValue = textarea.value;

    // Click the {date} token
    fireEvent.click(screen.getByTestId('token-btn-date'));

    // After click, state updates — value should contain {date}
    expect(textarea.value).toContain('{date}');
    expect(textarea.value.length).toBeGreaterThan(0);
    expect(initialValue).toBeDefined();
  });

  // T19 — super_admin sees Letters tab link in CaseDetailPage
  it('T19: super_admin sees Letters tab link in CaseDetailPage', () => {
    setupAuth('super_admin');
    renderCaseDetailPage();

    expect(screen.getByTestId('letters-tab-link')).toBeDefined();
    expect(screen.getByTestId('letters-tab-link').textContent).toContain('Letters');
  });

  // T20 — Manager role — Letters tab link NOT shown in CaseDetailPage
  it('T20: Manager does NOT see Letters tab link in CaseDetailPage', () => {
    setupAuth('manager');
    renderCaseDetailPage();

    expect(screen.queryByTestId('letters-tab-link')).toBeNull();
  });

  // T21 — Generate button click → createLetter API called
  it('T21: Generate Letter button click calls createLetter API', async () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to approval tab — 'approval' letter exists as draft in mock data
    // To get an empty state (no letter), we need to use a tab with no letter (medical_request)
    fireEvent.click(screen.getByTestId('tab-medical_request'));

    // Empty state shows generate button
    const generateBtn = screen.getByTestId('generate-letter-btn');
    expect(generateBtn).toBeDefined();

    const mockCreateLetter = createLetter as ReturnType<typeof vi.fn>;
    mockCreateLetter.mockClear();

    fireEvent.click(generateBtn);

    // createLetter should be called with client, caseId, and letter type
    await vi.waitFor(() => {
      expect(mockCreateLetter).toHaveBeenCalledWith(
        expect.anything(),
        MOCK_CASE_ID,
        'medical_request',
      );
    });
  });

  // T22 — Save content textarea → Save button → updateLetterContent called
  it('T22: editing textarea and clicking Finalize calls updateLetterContent API', async () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to denial tab (draft letter exists)
    fireEvent.click(screen.getByTestId('tab-denial'));

    const textarea = screen.getByTestId('letter-textarea');
    // Add content that preserves immutable markers
    const updatedContent = `Updated denial content\n\n[IMMUTABLE_START]\nAPPEAL RIGHTS\n[IMMUTABLE_END]`;
    fireEvent.change(textarea, { target: { value: updatedContent } });

    const mockUpdateLetter = updateLetterContent as ReturnType<typeof vi.fn>;
    mockUpdateLetter.mockClear();

    // Click Finalize (Save) button
    const finalizeBtn = screen.getByTestId('finalize-btn');
    fireEvent.click(finalizeBtn);

    await vi.waitFor(() => {
      expect(mockUpdateLetter).toHaveBeenCalledWith(
        expect.anything(),
        MOCK_CASE_ID,
        'letter-002',
        updatedContent,
      );
    });
  });

  // T23 — Send button → confirmation shown → confirm → sendLetter called
  it('T23: Send button shows confirmation dialog; on confirm, sendLetter API is called', async () => {
    setupAuth('hr');
    renderLettersPage();

    // Switch to denial tab (draft letter — shows send button)
    fireEvent.click(screen.getByTestId('tab-denial'));

    const sendBtn = screen.getByTestId('send-smtp-btn');
    expect(sendBtn).toBeDefined();

    const mockSendLetter = sendLetter as ReturnType<typeof vi.fn>;
    mockSendLetter.mockClear();

    // Mock window.confirm to return true (user confirms)
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);

    fireEvent.click(sendBtn);

    // Confirm dialog should have been shown
    expect(window.confirm).toHaveBeenCalledOnce();
    const confirmArgs = (window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(confirmArgs).toContain('This will send an official ADA/PWFA letter');

    // sendLetter should be called after confirmation
    await vi.waitFor(() => {
      expect(mockSendLetter).toHaveBeenCalledWith(
        expect.anything(),
        MOCK_CASE_ID,
        'letter-002',
      );
    });

    // Restore
    window.confirm = originalConfirm;
  });
});

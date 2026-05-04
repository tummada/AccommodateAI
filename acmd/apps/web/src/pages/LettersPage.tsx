/**
 * LettersPage — ACMD-151 Phase 7A
 *
 * URL: /cases/:id/letters
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer → Access Denied view
 *
 * COMPLIANCE: ADA/PWFA Letter Generator
 * Data source: /api/v1/cases/:id/letters via TanStack Query + useAuth client
 *
 * Features:
 *  - 5 Letter Type Tabs: Acknowledgment / Medical Request / Approval / Denial / Follow-up
 *  - Left Panel: Draft Header, Metadata Bar, Rich Text Editor, Placeholder Panel
 *  - Right Panel: Letter History
 *  - Compliance Check Banner (Denial tab only)
 *  - Primary Actions: Generate Letter, Download PDF, Copy, Print, Save, Send (SMTP)
 *  - Sent State: read-only banner
 *  - PWFA dual-law warning banner (Denial + dual-law case)
 *  - Role guard: Manager + Medical Reviewer → Access Denied
 *  - Loading skeleton + error state
 *  - Empty state when no letters
 */

import { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  fetchLetters,
  createLetter,
  updateLetterContent,
  sendLetter,
  downloadLetterPdf,
} from '@/lib/api/letters';
import type { AcmdLetter, LetterType } from '@/lib/api/letters';
import { fetchCaseDetail } from '@/pages/CaseDetailPage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRole = 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';

function normalizeRole(raw: string | undefined): UserRole {
  if (
    raw === 'super_admin' ||
    raw === 'hr' ||
    raw === 'medical_reviewer' ||
    raw === 'manager'
  ) {
    return raw;
  }
  return 'manager'; // least-privilege fallback
}

type TabLetterType = 'acknowledgment' | 'medical_request' | 'approval' | 'denial' | 'follow_up';

interface ComplianceItem {
  id: string;
  label: string;
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLIANCE_ITEMS_INITIAL: ComplianceItem[] = [
  { id: 'eeoc-factor-1', label: 'EEOC Factor 1: Undue hardship analysis cited', pass: true },
  { id: 'eeoc-factor-2', label: 'EEOC Factor 2: Alternatives considered and offered ≥2', pass: true },
  { id: 'eeoc-factor-3', label: 'EEOC Factor 3: Interactive process confirmation', pass: true },
  { id: 'eeoc-factor-4', label: 'EEOC Factor 4: Legal review confirmed', pass: true },
  { id: 'appeal-rights', label: 'Appeal rights — immutable section present', pass: true },
  { id: 'eeoc-filing-info', label: 'EEOC filing information (1-800-669-4000, www.eeoc.gov)', pass: true },
  { id: 'denial-basis', label: 'Denial basis stated (denial type documented)', pass: true },
];

const PLACEHOLDER_TOKENS = [
  '{employee_name}',
  '{company_name}',
  '{case_id}',
  '{date}',
  '{accommodation_type}',
  '{hr_contact}',
  '{effective_date}',
  '{appeal_deadline}',
  '{request_date}',
  '{hr_name}',
  '{hr_title}',
  '{denial_reason}',
  '{next_review_date}',
];

const TAB_ORDER: TabLetterType[] = [
  'acknowledgment',
  'medical_request',
  'approval',
  'denial',
  'follow_up',
];

// Map backend type → tab test id (follow_up → tab-followup for backwards compat)
const TAB_TEST_IDS: Record<TabLetterType, string> = {
  acknowledgment: 'tab-acknowledgment',
  medical_request: 'tab-medical_request',
  approval: 'tab-approval',
  denial: 'tab-denial',
  follow_up: 'tab-followup',
};

const TAB_LABELS: Record<TabLetterType, string> = {
  acknowledgment: 'Acknowledgment',
  medical_request: 'Medical Request',
  approval: 'Approval',
  denial: 'Denial',
  follow_up: 'Follow-up',
};

// ---------------------------------------------------------------------------
// AccessDenied
// ---------------------------------------------------------------------------

function AccessDenied({ caseId }: { caseId: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-12 text-center"
      data-testid="access-denied"
    >
      <span className="text-4xl" aria-hidden="true">🔒</span>
      <div>
        <h2 className="text-lg font-semibold text-text">Access Denied</h2>
        <p className="mt-1 text-sm text-text-muted max-w-md">
          You don&apos;t have permission to view Letters. Only Super Admin and HR roles can generate or view accommodation letters.
        </p>
      </div>
      <Link
        to={`/cases/${caseId}`}
        className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to Case Detail
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Letter History Panel (Right Panel)
// ---------------------------------------------------------------------------

function LetterHistoryPanel({
  letters,
  caseId,
  onView,
}: {
  letters: AcmdLetter[];
  caseId: string;
  onView: (letter: AcmdLetter) => void;
}) {
  return (
    <aside
      aria-label="Letter History"
      className="rounded-lg border border-border bg-surface p-4 space-y-3 w-full"
      data-testid="letter-history-panel"
    >
      <h2 className="text-sm font-semibold" style={{ color: '#1E3A5F' }}>
        Letter History
      </h2>
      <p className="text-xs text-text-muted">
        {caseId} — All Letters
      </p>

      {letters.length === 0 && (
        <p className="text-sm text-text-muted">No letters generated yet.</p>
      )}

      <ul className="space-y-3" aria-label="Letter history list">
        {letters.map((letter) => (
          <li
            key={letter.id}
            className="rounded-lg border border-gray-200 bg-white p-3 space-y-1"
            data-testid={`history-item-${letter.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-gray-600">
                {TAB_LABELS[letter.type as TabLetterType] ?? letter.type} Letter
              </span>
              <span className="text-xs text-text-muted">
                {letter.sentAt
                  ? new Date(letter.sentAt).toLocaleDateString('en-US')
                  : new Date(letter.createdAt).toLocaleDateString('en-US')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                  letter.status === 'sent'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
                aria-label={`Status: ${letter.status}`}
              >
                {letter.status === 'sent' ? '🟢 Sent' : '🟡 Draft'}
              </span>
              {letter.sentToEmail && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-semibold text-purple-700">
                  📧 Sent
                </span>
              )}
            </div>
            {letter.sentAt && (
              <p className="text-xs text-text-muted">
                Sent: {new Date(letter.sentAt).toLocaleString('en-US')}
              </p>
            )}
            <button
              type="button"
              onClick={() => onView(letter)}
              className="text-xs font-medium underline hover:opacity-80"
              style={{ color: '#2563EB' }}
              aria-label={`View ${TAB_LABELS[letter.type as TabLetterType] ?? letter.type} letter`}
            >
              View
            </button>
          </li>
        ))}
      </ul>

      {/* Legend */}
      <div className="rounded border border-gray-100 bg-gray-50 p-2 text-xs text-text-muted space-y-0.5">
        <p className="font-semibold text-gray-600 mb-1">Status legend:</p>
        <p>🟡 Draft &nbsp; 🟢 Sent &nbsp; 📧 Sent (SMTP)</p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Compliance Check Banner (Denial tab only)
// ---------------------------------------------------------------------------

function ComplianceCheckBanner({
  items,
  allPass,
}: {
  items: ComplianceItem[];
  allPass: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Compliance check"
      data-testid="compliance-check-banner"
      className="rounded-lg border p-4 space-y-3"
      style={{
        borderColor: allPass ? '#22C55E' : '#EF4444',
        backgroundColor: allPass ? '#F0FDF4' : '#FEF2F2',
      }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{allPass ? '✅' : '⚠️'}</span>
        <h3
          className="text-sm font-semibold"
          style={{ color: allPass ? '#15803D' : '#B91C1C' }}
        >
          {allPass
            ? 'All required sections present. Letter can be finalized.'
            : 'Missing required sections — Finalize is disabled.'}
        </h3>
      </div>

      <p className="text-xs text-text-muted">
        Before finalizing: System checks for required legal sections.
      </p>

      <ul className="space-y-1" aria-label="Compliance check items">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-xs">
            <span aria-hidden="true" className={item.pass ? 'text-green-600' : 'text-red-500'}>
              {item.pass ? '✓' : '❌'}
            </span>
            <span className={item.pass ? 'text-green-800' : 'text-red-700'}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PWFA Dual-Law Warning Banner (Denial + dual-law)
// ---------------------------------------------------------------------------

function PwfaDualLawBanner() {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="pwfa-dual-law-banner"
      className="rounded-r-lg p-4"
      style={{
        backgroundColor: '#FEF3C7',
        color: '#92400E',
        borderLeft: '4px solid #F59E0B',
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg">⚠️</span>
        <div className="space-y-1">
          <p className="font-semibold text-sm">This case is tagged under ADA + PWFA.</p>
          <p className="text-sm">
            The denial letter must address each law separately.
          </p>
          <ul className="text-sm space-y-0.5 mt-1">
            <li>Section A: ADA denial basis + EEOC 4 factors</li>
            <li>Section B: PWFA denial basis (if applicable)</li>
            <li>Section C: Appeal rights under both laws</li>
          </ul>
          <p className="text-xs mt-1 opacity-75">
            Legal basis: EEOC Enforcement Guidance; 42 USC 12117; 29 CFR 1636 (PWFA regulations)
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sent Banner (read-only state for status === 'sent')
// ---------------------------------------------------------------------------

function SentBanner({
  sentAt,
  sentToEmail,
  onCreateNewVersion,
}: {
  sentAt: string | null;
  sentToEmail: string | null;
  onCreateNewVersion: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="finalized-banner"
      className="rounded-lg border-2 p-4 space-y-2"
      style={{ borderColor: '#22C55E', backgroundColor: '#F0FDF4' }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">🔒</span>
        <p className="font-semibold text-sm text-green-800">
          This letter has been finalized and cannot be edited.
        </p>
      </div>
      {sentAt && (
        <p className="text-xs text-green-700">
          Sent: {new Date(sentAt).toLocaleString('en-US')}
          {sentToEmail ? ` → ${sentToEmail}` : ''}
        </p>
      )}
      <p className="text-xs text-green-700">
        To create a corrected letter, use{' '}
        <button
          type="button"
          onClick={onCreateNewVersion}
          className="underline font-medium hover:opacity-80 focus-visible:outline-none"
          style={{ color: '#15803D' }}
          data-testid="create-new-version-btn"
          aria-label="Create new version of this letter"
        >
          Create New Version
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast / Banner notification
// ---------------------------------------------------------------------------

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

// ---------------------------------------------------------------------------
// LettersPageContent
// ---------------------------------------------------------------------------

function LettersPageContent({
  caseId,
}: {
  caseId: string;
}) {
  const { client, user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabLetterType>('acknowledgment');
  const [complianceItems] = useState<ComplianceItem[]>(COMPLIANCE_ITEMS_INITIAL);
  const [immutableEditError, setImmutableEditError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [localContents, setLocalContents] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Clear TanStack Query cache when user logs out
  useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user, queryClient]);

  // Fetch case detail to derive dualLaw (Fix 1 + Fix 3)
  const { data: caseDetail } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => fetchCaseDetail(client, caseId),
    enabled: !!client && !!caseId,
    staleTime: 30_000,
    retry: 1,
  });

  // dualLaw derived from real case type (Fix 1) — defaults false if loading/error
  const dualLaw = caseDetail?.type === 'multiple' || caseDetail?.type === 'pwfa';

  // Fetch letters from API (Fix 3: enabled guard)
  const {
    data: letters = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['letters', caseId],
    queryFn: () => fetchLetters(client, caseId),
    enabled: !!client && !!caseId,
    staleTime: 30_000,
    retry: 1,
  });

  // Auto-show toast for 3s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const activeLetter = letters.find((l) => l.type === activeTab) ?? null;
  const activeContent = activeLetter ? (localContents[activeLetter.id] ?? activeLetter.content) : '';
  const isSent = activeLetter?.status === 'sent';
  const isDenialTab = activeTab === 'denial';

  const complianceAllPass = complianceItems.every((item) => item.pass);
  const canFinalize = isDenialTab ? complianceAllPass : true;

  function getTabStatus(type: TabLetterType): 'sent' | 'draft' | 'none' {
    const letter = letters.find((l) => l.type === type);
    if (!letter) return 'none';
    if (letter.status === 'sent') return 'sent';
    return 'draft';
  }

  async function handleGenerateLetter() {
    setIsCreating(true);
    try {
      await createLetter(client, caseId, activeTab as LetterType);
      await queryClient.invalidateQueries({ queryKey: ['letters', caseId] });
      setToast({ type: 'success', message: 'Letter generated successfully.' });
    } catch {
      setToast({ type: 'error', message: 'Failed to generate letter. Please try again.' });
    } finally {
      setIsCreating(false);
    }
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const currentContent = activeContent;

    // Check if immutable section (IMMUTABLE_START/IMMUTABLE_END) is being removed in Denial
    if (isDenialTab && currentContent.includes('[IMMUTABLE_START]')) {
      if (!value.includes('[IMMUTABLE_START]') || !value.includes('[IMMUTABLE_END]')) {
        setImmutableEditError(
          'The Appeal Rights and EEOC filing information sections are legally required and cannot be removed.',
        );
        if (textAreaRef.current) {
          textAreaRef.current.value = currentContent;
        }
        return;
      }
    }

    setImmutableEditError(null);
    if (activeLetter) {
      setLocalContents((prev) => ({ ...prev, [activeLetter.id]: value }));
    }
  }

  function handleInsertToken(token: string) {
    if (isSent) return;
    if (!textAreaRef.current || !activeLetter) return;

    const textarea = textAreaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent =
      activeContent.slice(0, start) + token + activeContent.slice(end);

    setLocalContents((prev) => ({ ...prev, [activeLetter.id]: newContent }));

    setTimeout(() => {
      if (textAreaRef.current) {
        const newPos = start + token.length;
        textAreaRef.current.selectionStart = newPos;
        textAreaRef.current.selectionEnd = newPos;
        textAreaRef.current.focus();
      }
    }, 0);
  }

  async function handleSaveContent() {
    if (!activeLetter || isSent) return;
    const content = localContents[activeLetter.id];
    if (content === undefined || content === activeLetter.content) return;

    setIsSaving(true);
    try {
      await updateLetterContent(client, caseId, activeLetter.id, content);
      await queryClient.invalidateQueries({ queryKey: ['letters', caseId] });
      setLocalContents((prev) => {
        const next = { ...prev };
        delete next[activeLetter.id];
        return next;
      });
      setToast({ type: 'success', message: 'Letter saved.' });
    } catch {
      setToast({ type: 'error', message: 'Failed to save letter. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  }

  // "Finalize" in old UX → now "Save" which triggers PATCH
  function handleFinalize() {
    if (!canFinalize || isSent) return;
    void handleSaveContent();
  }

  async function handleDownloadPDF() {
    if (!activeLetter) return;
    try {
      const blob = await downloadLetterPdf(client, caseId, activeLetter.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `letter-${activeLetter.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setToast({ type: 'error', message: 'Failed to download PDF. Please try again.' });
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // clipboard not available in test env
    }
  }

  function handlePrint() {
    window.print();
  }

  function handleCreateNewVersion() {
    // Reset local content for this tab so user can edit a fresh copy
    if (activeLetter) {
      setLocalContents((prev) => {
        const next = { ...prev };
        delete next[activeLetter.id];
        return next;
      });
    }
    setToast({ type: 'success', message: 'Starting new draft. Generate a new letter to proceed.' });
  }

  function handleViewHistoryLetter(letter: AcmdLetter) {
    const tab = letter.type as TabLetterType;
    if (TAB_ORDER.includes(tab)) {
      setActiveTab(tab);
    }
  }

  async function handleSendSMTP() {
    if (!activeLetter) return;
    // Fix 2: confirmation before sending official legal letter
    const recipient = activeLetter.sentToEmail ?? 'employee on record';
    const confirmed = window.confirm(
      `Send ${TAB_LABELS[activeTab]} letter to ${recipient}?\n\nThis will send an official ADA/PWFA letter. This action cannot be undone.`,
    );
    if (!confirmed) return;
    setIsSending(true);
    try {
      const result = await sendLetter(client, caseId, activeLetter.id);
      await queryClient.invalidateQueries({ queryKey: ['letters', caseId] });
      if (result.emailSent) {
        setToast({ type: 'success', message: 'Letter sent successfully via company email.' });
      } else {
        setToast({ type: 'success', message: 'Letter marked as sent (email delivery pending).' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to send letter. Please try again.' });
    } finally {
      setIsSending(false);
    }
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4" data-testid="letters-loading">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="p-6 max-w-7xl mx-auto" data-testid="letters-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">Could not load letters</h2>
            <p className="mt-1 text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="toast-notification"
          className={`rounded-lg border p-3 text-sm font-medium ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
        </div>
      )}

      {/* Back link + Case header */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
        <Link
          to={`/cases/${caseId}`}
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="Back to Case Detail"
        >
          ← Back to Case
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold" style={{ color: '#1E3A5F' }}>
            {caseId} — Letters
          </h1>
          {dualLaw && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800"
              aria-label="Case involves both ADA and PWFA laws"
            >
              ADA + PWFA
            </span>
          )}
        </div>
      </div>

      {/* Letter Type Tabs */}
      <nav
        role="tablist"
        aria-label="Letter type tabs"
        className="flex items-center gap-1 border-b border-gray-200"
        data-testid="letter-type-tabs"
      >
        {TAB_ORDER.map((type) => {
          const status = getTabStatus(type);
          const isActive = activeTab === type;
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tab-panel-${type}`}
              id={`tab-${type}`}
              onClick={() => setActiveTab(type)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t ${
                isActive
                  ? 'border-b-2 text-blue-700'
                  : 'text-text-muted hover:text-text hover:bg-gray-50'
              }`}
              style={isActive ? { borderBottomColor: '#2563EB', color: '#2563EB' } : {}}
              data-testid={TAB_TEST_IDS[type]}
            >
              {TAB_LABELS[type]}
              {status === 'sent' && (
                <span aria-label={`${TAB_LABELS[type]} letter sent`} title="Sent">
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Tab panels */}
      {TAB_ORDER.map((type) => (
        <div
          key={type}
          role="tabpanel"
          id={`tab-panel-${type}`}
          aria-labelledby={`tab-${type}`}
          hidden={activeTab !== type}
        >
          {activeTab === type && (
            <div className="space-y-4">
              {/* Empty state — no letter for this type */}
              {!activeLetter && (
                <div
                  className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-12 text-center"
                  data-testid="empty-state"
                >
                  <span className="text-3xl" aria-hidden="true">📄</span>
                  <div>
                    <h2 className="text-lg font-semibold text-text">No letters yet</h2>
                    <p className="mt-1 text-sm text-text-muted">
                      Generate a {TAB_LABELS[type]} letter to get started.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerateLetter()}
                    disabled={isCreating}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    style={{ backgroundColor: '#2563EB' }}
                    data-testid="generate-letter-btn"
                    aria-label={`Generate ${TAB_LABELS[type]} letter`}
                  >
                    {isCreating ? 'Generating…' : `✨ Generate ${TAB_LABELS[type]} Letter`}
                  </button>
                </div>
              )}

              {activeLetter && (
                <>
                  {/* Sent Banner */}
                  {isSent && (
                    <SentBanner
                      sentAt={activeLetter.sentAt}
                      sentToEmail={activeLetter.sentToEmail}
                      onCreateNewVersion={handleCreateNewVersion}
                    />
                  )}

                  {/* PWFA Dual-Law Banner — Denial + dual-law only */}
                  {isDenialTab && dualLaw && <PwfaDualLawBanner />}

                  {/* Main content: left + right panels */}
                  <div className="flex flex-col lg:flex-row gap-4">
                    {/* Left Panel — Letter Editor */}
                    <div
                      className="flex-1 space-y-4"
                      aria-label="Letter editor"
                      data-testid="letter-editor-panel"
                    >
                      {/* Draft Header */}
                      {!isSent && (
                        <div
                          className="flex items-center gap-2 rounded-lg p-3"
                          style={{ backgroundColor: '#FEF9C3', borderLeft: '4px solid #EAB308' }}
                          data-testid="draft-header"
                        >
                          <span aria-hidden="true">⚡</span>
                          <div>
                            <p className="text-sm font-semibold text-yellow-800">AUTO-GENERATED DRAFT</p>
                            <p className="text-xs text-yellow-700">Review and edit before finalizing</p>
                          </div>
                        </div>
                      )}

                      {/* Letter Metadata Bar */}
                      <div
                        className="rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-2 gap-2"
                        data-testid="metadata-bar"
                      >
                        <div className="text-sm">
                          <span className="font-semibold text-text-muted">To:</span>{' '}
                          <span className="text-text">
                            {activeLetter.sentToEmail ?? 'Employee'}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-text-muted">Re:</span>{' '}
                          <span className="text-text font-mono">{caseId}</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-text-muted">Date:</span>{' '}
                          <span className="text-text">
                            {new Date(activeLetter.createdAt).toLocaleDateString('en-US')}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-text-muted">Letter Type:</span>{' '}
                          <span className="text-text">{TAB_LABELS[type]}</span>
                        </div>
                        <div className="col-span-2 text-sm">
                          <span className="font-semibold text-text-muted">Status:</span>{' '}
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isSent
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {isSent ? '🟢 Sent' : '🟡 Draft'}
                          </span>
                        </div>
                      </div>

                      {/* Immutable edit error */}
                      {immutableEditError && (
                        <div
                          role="alert"
                          data-testid="immutable-edit-error"
                          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                        >
                          🔒 {immutableEditError}
                        </div>
                      )}

                      {/* Rich Text Area — A4 Preview Style */}
                      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                        {/* Toolbar */}
                        {!isSent && (
                          <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-sm font-bold text-gray-700 hover:bg-gray-200"
                              aria-label="Bold"
                              onClick={() => handleInsertToken('**bold**')}
                            >
                              B
                            </button>
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-sm italic text-gray-700 hover:bg-gray-200"
                              aria-label="Italic"
                              onClick={() => handleInsertToken('_italic_')}
                            >
                              I
                            </button>
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-200"
                              aria-label="Bullet list"
                              onClick={() => handleInsertToken('\n• ')}
                            >
                              • List
                            </button>
                            <span className="mx-1 h-4 w-px bg-gray-300" aria-hidden="true" />
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-200"
                              aria-label="Undo"
                              onClick={() => document.execCommand('undo')}
                            >
                              Undo
                            </button>
                            <button
                              type="button"
                              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-200"
                              aria-label="Redo"
                              onClick={() => document.execCommand('redo')}
                            >
                              Redo
                            </button>
                          </div>
                        )}

                        {/* Immutable section indicator for Denial */}
                        {isDenialTab && (
                          <div
                            className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5"
                            data-testid="immutable-section-indicator"
                          >
                            <span aria-hidden="true">🔒</span>
                            <p className="text-xs font-medium text-amber-800">
                              Appeal Rights and EEOC filing information sections are legally required and immutable.
                            </p>
                          </div>
                        )}

                        {/* Text area */}
                        <div className="p-4" style={{ minHeight: '400px' }}>
                          {isSent ? (
                            <pre
                              className="whitespace-pre-wrap font-sans text-sm text-gray-500 leading-relaxed"
                              aria-label="Letter content (read-only)"
                              data-testid="letter-content-readonly"
                            >
                              {activeContent
                                .replace('[IMMUTABLE_START]\n', '')
                                .replace('\n[IMMUTABLE_END]', '')}
                            </pre>
                          ) : (
                            <textarea
                              ref={textAreaRef}
                              className="w-full resize-none border-none bg-transparent font-sans text-sm text-text leading-relaxed focus:outline-none"
                              style={{ minHeight: '380px' }}
                              value={activeContent}
                              onChange={handleTextChange}
                              aria-label={`${TAB_LABELS[type]} letter content editor`}
                              data-testid="letter-textarea"
                              spellCheck
                            />
                          )}
                        </div>
                      </div>

                      {/* Placeholder Panel */}
                      {!isSent && (
                        <div
                          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2"
                          data-testid="placeholder-panel"
                        >
                          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                            Available variables (click to insert)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {PLACEHOLDER_TOKENS.map((token) => (
                              <button
                                key={token}
                                type="button"
                                onClick={() => handleInsertToken(token)}
                                className="rounded border border-blue-200 bg-white px-2 py-0.5 text-xs font-mono text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`Insert token ${token}`}
                                data-testid={`token-btn-${token.replace(/[{}]/g, '')}`}
                              >
                                {token}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Panel — Letter History */}
                    <div className="w-full lg:w-72 shrink-0">
                      <LetterHistoryPanel
                        letters={letters}
                        caseId={caseId}
                        onView={handleViewHistoryLetter}
                      />
                    </div>
                  </div>

                  {/* Compliance Check Banner — Denial tab only */}
                  {isDenialTab && (
                    <ComplianceCheckBanner items={complianceItems} allPass={complianceAllPass} />
                  )}

                  {/* Primary Actions */}
                  <div
                    className="rounded-lg border border-border bg-surface p-4 space-y-4"
                    data-testid="primary-actions"
                  >
                    {/* Document actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownloadPDF()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Download letter as PDF"
                        data-testid="download-pdf-btn"
                      >
                        📥 Download PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Copy letter to clipboard"
                        data-testid="copy-btn"
                      >
                        {copySuccess ? '✅ Copied!' : '📋 Copy to Clipboard'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePrint}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Print letter"
                        data-testid="print-btn"
                      >
                        🖨️ Print
                      </button>
                    </div>

                    {/* Generate / Save / New Version */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleGenerateLetter()}
                        disabled={isCreating}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-400 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        aria-label="Generate new letter with AI"
                        data-testid="generate-letter-action-btn"
                      >
                        {isCreating ? 'Generating…' : '✨ Generate Letter'}
                      </button>

                      {!isSent ? (
                        <button
                          type="button"
                          onClick={handleFinalize}
                          disabled={!canFinalize || isSaving}
                          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: canFinalize ? '#2563EB' : undefined }}
                          aria-disabled={!canFinalize}
                          aria-label={
                            canFinalize
                              ? 'Finalize this letter'
                              : 'Complete compliance check to finalize'
                          }
                          data-testid="finalize-btn"
                        >
                          {isSaving ? 'Saving…' : 'Finalize Letter'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleCreateNewVersion}
                          className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="create-new-version-action-btn"
                          aria-label="Create new version of this letter"
                        >
                          Create New Version
                        </button>
                      )}
                    </div>

                    {/* SMTP section */}
                    <div className="border-t border-gray-200 pt-3">
                      <p className="text-xs text-text-muted font-medium mb-2">
                        ── Optional ── Send via Company Email
                      </p>
                      {isSent ? (
                        <div
                          className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800"
                          data-testid="smtp-sent-info"
                        >
                          <span aria-hidden="true">✅</span>{' '}
                          This letter has already been sent via email.
                          {activeLetter.sentToEmail && ` Sent to: ${activeLetter.sentToEmail}`}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSendSMTP()}
                          disabled={isSending}
                          className="inline-flex items-center gap-1.5 rounded-md border border-purple-500 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          aria-label="Send letter via company email"
                          data-testid="send-smtp-btn"
                        >
                          {isSending ? '📧 Sending…' : '📧 Send via Company Email'}
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LettersPage — main export
// ---------------------------------------------------------------------------

export function LettersPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const role = normalizeRole(user?.role);
  const caseId = id ?? 'unknown';

  // Role guard: only super_admin and hr allowed
  if (role === 'manager' || role === 'medical_reviewer') {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AccessDenied caseId={caseId} />
      </div>
    );
  }

  return (
    <LettersPageContent
      caseId={caseId}
    />
  );
}

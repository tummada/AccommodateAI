/**
 * ChecklistPage — ACMD-139 Phase 6D / ACMD-154 Phase 7B
 *
 * URL: /cases/:id/checklist
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer → Access Denied view
 *
 * COMPLIANCE: EEOC Interactive Process — 6-stage checklist tracker
 * ACMD-154: All mock data replaced with real API calls via client.request().
 */

import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchCaseDetail } from '@/pages/CaseDetailPage';
import { getChecklist, toggleChecklistItem } from '@/lib/api/checklist';
import type { ChecklistItem } from '@/lib/api/checklist';
import { advanceCaseStatus, createDiscussion } from '@/lib/api/cases';
import type { CreateDiscussionPayload, DiscussionMethod } from '@/lib/api/cases';
import { getManagersList, requestManagerInput } from '@/lib/api/managerInput';
import type { Manager } from '@/lib/api/managerInput';
import type { AuthenticatedClient } from '@/lib/api-client';

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

// ---------------------------------------------------------------------------
// Stage derivation (mirrors EEOCStepper.deriveCurrentStage)
// ---------------------------------------------------------------------------

type CaseStatus =
  | 'intake'
  | 'active'
  | 'interactive_process'
  | 'awaiting_input'
  | 'awaiting_medical'
  | 'review'
  | 'implementation'
  | 'approved'
  | 'denied'
  | 'closed'
  | 'denial_pending_review'; // Fix 2: added — maps to stage 5 (Decision)

// ---------------------------------------------------------------------------
// Status transition map — primary "Next Stage →" targets
// ---------------------------------------------------------------------------

const NEXT_STATUS_PRIMARY: Record<string, CaseStatus> = {
  intake: 'interactive_process',
  interactive_process: 'awaiting_medical',
  awaiting_input: 'review',
  awaiting_medical: 'review',
  // review intentionally omitted — use Decision Page instead (EEOC compliance)
  // denial_pending_review intentionally omitted — no forward progression during legal review
  implementation: 'active',
};
// active, approved, denied, closed → no "Next Stage" button

function deriveCurrentStage(status: string): number {
  switch (status as CaseStatus) {
    case 'intake':
      return 1;
    case 'active':
      return 2;
    case 'interactive_process':
    case 'awaiting_input':
      return 3;
    case 'awaiting_medical':
      return 4;
    case 'review':
      return 5;
    case 'implementation':
      return 6;
    case 'approved':
    case 'denied':
    case 'denial_pending_review': // Fix 3: maps to stage 5 (Decision)
      return 5;
    case 'closed':
      return 6;
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// DeadlineBadge
// ---------------------------------------------------------------------------

type DeadlineState = 'normal' | 'level_1' | 'level_2' | 'level_3' | 'level_4' | 'overdue';

function getDeadlineState(remaining: number): DeadlineState {
  if (remaining <= 0) return 'overdue';
  if (remaining <= 1) return 'level_4';
  if (remaining <= 3) return 'level_3';
  if (remaining <= 7) return 'level_2';
  if (remaining <= 29) return 'level_1';
  return 'normal';
}

function getDeadlineBarColor(state: DeadlineState): string {
  switch (state) {
    case 'normal': return 'bg-green-500';
    case 'level_1': return 'bg-yellow-500';
    case 'level_2': return 'bg-orange-500';
    case 'level_3': return 'bg-red-500';
    case 'level_4': return 'bg-red-500';
    case 'overdue': return 'bg-red-900';
  }
}

function getDeadlineTextColor(state: DeadlineState): string {
  switch (state) {
    case 'normal': return 'text-green-700';
    case 'level_1': return 'text-yellow-700';
    case 'level_2': return 'text-orange-700';
    case 'level_3': return 'text-red-700';
    case 'level_4': return 'text-red-700';
    case 'overdue': return 'text-red-900';
  }
}

function DeadlineBadge({
  dayElapsed,
  totalDays,
}: {
  dayElapsed: number;
  totalDays: number;
}) {
  const remaining = totalDays - dayElapsed;
  const state = getDeadlineState(remaining);
  const progressPct = Math.min((dayElapsed / totalDays) * 100, 100);
  const barColor = getDeadlineBarColor(state);
  const textColor = getDeadlineTextColor(state);
  const isPulsing = state === 'level_4';

  return (
    <div
      role="status"
      aria-label={`Case deadline: Day ${dayElapsed} of ${totalDays}, ${remaining} days remaining`}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-text">
            Day {dayElapsed} of {totalDays}
          </span>
          <span className={`text-sm font-medium ${textColor}`}>
            {remaining <= 0
              ? 'Overdue'
              : `${remaining} day${remaining === 1 ? '' : 's'} remaining`}
          </span>
          {isPulsing && (
            <span
              className="motion-safe:animate-pulse inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
              aria-label="Urgent: 1 day remaining"
            >
              Urgent
            </span>
          )}
          {state === 'overdue' && (
            <span
              className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900"
              aria-label="Overdue"
            >
              Overdue
            </span>
          )}
        </div>

        <div className="flex-1 min-w-[200px] max-w-sm">
          <div
            role="progressbar"
            aria-valuenow={dayElapsed}
            aria-valuemin={0}
            aria-valuemax={totalDays}
            aria-label={`${dayElapsed} of ${totalDays} days elapsed`}
            className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-text-muted">
            {Math.round(progressPct)}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CaseHeader — uses real API data
// ---------------------------------------------------------------------------

interface CaseHeaderData {
  caseDisplayId: string;
  employeeLabel: string;
  accommodationLabel: string;
  dualLaw: boolean;
  status: string;
}

function CaseHeader({
  caseId,
  caseData,
  backPath,
}: {
  caseId: string;
  caseData: CaseHeaderData;
  backPath: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <Link
        to={backPath}
        className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        aria-label="Back to Case Detail"
      >
        ← Back to Case Detail
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-text" style={{ color: '#1E3A5F' }}>
            {caseData.caseDisplayId} — {caseData.employeeLabel} — {caseData.accommodationLabel}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {caseData.dualLaw && (
              <span
                className="group relative inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800"
                aria-label="Case involves both ADA and PWFA laws"
              >
                ADA + PWFA
                <span
                  className="ml-1 cursor-help text-blue-600"
                  aria-hidden="true"
                  title="This case requires compliance with both the Americans with Disabilities Act and the Pregnant Workers Fairness Act"
                >
                  ⓘ
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Dual-law: ADA + PWFA apply
                </span>
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-0.5 text-xs font-semibold text-yellow-800">
              {caseData.status}
            </span>
          </div>
        </div>
        <div className="text-sm text-text-muted">
          Case ID: <span className="font-mono font-semibold text-text">{caseId}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DualLawAlertBanner
// ---------------------------------------------------------------------------

function DualLawAlertBanner() {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-r-lg p-4"
      style={{
        backgroundColor: '#DBEAFE',
        color: '#1E3A5F',
        borderLeft: '4px solid #2563EB',
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg">⚠</span>
        <div className="space-y-1">
          <p className="font-semibold text-sm" style={{ color: '#1E3A5F' }}>
            This case requires compliance with both ADA and PWFA
          </p>
          <p className="text-sm" style={{ color: '#1E3A5F' }}>
            Additional checklist items from both laws are included below.
          </p>
          <a
            href="https://www.eeoc.gov/laws/guidance/pregnancy-discrimination"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium underline hover:opacity-80"
            style={{ color: '#2563EB' }}
          >
            Learn More
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverallProgressBar
// ---------------------------------------------------------------------------

function OverallProgressBar({
  currentStage,
  totalStages = 6,
}: {
  currentStage: number;
  totalStages?: number;
}) {
  const completedPct = ((currentStage - 1) / totalStages) * 100;
  const currentPct = (1 / totalStages) * 100;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text" style={{ color: '#1E3A5F' }}>
          EEOC Interactive Process
        </span>
        <span className="text-sm font-medium text-text-muted">
          Stage {currentStage} of {totalStages}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={currentStage}
        aria-valuemin={1}
        aria-valuemax={totalStages}
        aria-label={`EEOC process progress: Stage ${currentStage} of ${totalStages}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full transition-all"
          style={{ width: `${completedPct}%`, backgroundColor: '#22C55E' }}
        />
        <div
          className="h-full transition-all"
          style={{ width: `${currentPct}%`, backgroundColor: '#2563EB' }}
        />
        <div
          className="h-full flex-1"
          style={{ backgroundColor: '#E5E7EB' }}
        />
      </div>

      <div className="text-right text-xs text-text-muted">
        {Math.round(((currentStage - 1) / totalStages) * 100)}% complete
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddDiscussionDialog — modal form for creating a discussion record
// ---------------------------------------------------------------------------

function AddDiscussionDialog({
  caseId,
  client,
  queryClient,
  onClose,
}: {
  caseId: string;
  client: AuthenticatedClient | null;
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>;
  onClose: () => void;
}) {
  const [discussionDate, setDiscussionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState<DiscussionMethod>('in_person');
  const [participants, setParticipants] = useState('');
  const [summary, setSummary] = useState('');
  const [employeePreference, setEmployeePreference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;

    const participantList = participants.split(',').map((s) => s.trim()).filter(Boolean);
    if (participantList.length === 0) {
      setError('Please enter at least one participant.');
      return;
    }

    if (summary.trim().length < 10) {
      setError('Summary must be at least 10 characters.');
      return;
    }

    const payload: CreateDiscussionPayload = {
      discussionDate,
      method,
      participants: participantList,
      summary,
      employeePreference: employeePreference.trim() || null,
    };

    setIsSubmitting(true);
    setError(null);

    try {
      await createDiscussion(client, caseId, payload);
      await queryClient.invalidateQueries({ queryKey: ['discussions', caseId] });
      onClose();
    } catch {
      setError('Failed to save discussion record. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="false"
    >
      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discussion-dialog-title"
        className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="discussion-dialog-title"
          className="text-base font-semibold text-text mb-4"
          style={{ color: '#1E3A5F' }}
        >
          Add Discussion Record
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Discussion Date */}
          <div>
            <label htmlFor="discussionDate" className="block text-sm font-medium text-text">
              Discussion Date <span className="text-red-600">*</span>
            </label>
            <input
              id="discussionDate"
              type="date"
              value={discussionDate}
              onChange={(e) => setDiscussionDate(e.target.value)}
              required
              autoFocus
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Method */}
          <div>
            <label htmlFor="discussionMethod" className="block text-sm font-medium text-text">
              Method <span className="text-red-600">*</span>
            </label>
            <select
              id="discussionMethod"
              value={method}
              onChange={(e) => setMethod(e.target.value as DiscussionMethod)}
              required
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="in_person">In Person</option>
              <option value="video">Video</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="written">Written</option>
            </select>
          </div>

          {/* Participants */}
          <div>
            <label htmlFor="discussionParticipants" className="block text-sm font-medium text-text">
              Participants <span className="text-red-600">*</span>
            </label>
            <input
              id="discussionParticipants"
              type="text"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              required
              placeholder="e.g. Jane Smith, John Doe"
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-0.5 text-xs text-text-muted">Comma-separated names</p>
          </div>

          {/* Summary */}
          <div>
            <label htmlFor="discussionSummary" className="block text-sm font-medium text-text">
              Summary <span className="text-red-600">*</span>
            </label>
            <textarea
              id="discussionSummary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
              minLength={10}
              rows={4}
              placeholder="Brief summary of what was discussed (min 10 characters)"
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Employee Preference (optional) */}
          <div>
            <label htmlFor="discussionEmployeePreference" className="block text-sm font-medium text-text">
              Employee Preference <span className="text-xs text-text-muted">(optional)</span>
            </label>
            <input
              id="discussionEmployeePreference"
              type="text"
              value={employeePreference}
              onChange={(e) => setEmployeePreference(e.target.value)}
              placeholder="Any preference expressed by the employee"
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Error message */}
          {error && (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isSubmitting ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RequestManagerInputDialog — modal for requesting manager input (ACMD-168)
// ---------------------------------------------------------------------------

function RequestManagerInputDialog({
  caseId,
  client,
  onClose,
}: {
  caseId: string;
  client: AuthenticatedClient;
  onClose: () => void;
}) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState('');
  const [isFetching, setIsFetching] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch managers on mount
  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    setFetchError(null);

    getManagersList(client)
      .then((res) => {
        if (!cancelled) {
          setManagers(res.managers);
          setIsFetching(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchError('Failed to load managers. Please try again.');
          setIsFetching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleSend() {
    if (!selectedManagerId || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await requestManagerInput(client, caseId, { managerId: selectedManagerId });
      onClose();
    } catch {
      setSubmitError('Failed to send request. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="false"
    >
      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-input-dialog-title"
        className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="manager-input-dialog-title"
          className="text-base font-semibold text-text mb-4"
          style={{ color: '#1E3A5F' }}
        >
          Request Manager Input
        </h2>

        <div className="space-y-4">
          {/* Manager dropdown */}
          <div>
            <label htmlFor="managerSelect" className="block text-sm font-medium text-text">
              Select Manager <span className="text-red-600">*</span>
            </label>

            {isFetching && (
              <p className="mt-2 text-sm text-text-muted">Loading managers…</p>
            )}

            {!isFetching && fetchError && (
              <p role="alert" className="mt-2 text-sm text-red-600">{fetchError}</p>
            )}

            {!isFetching && !fetchError && managers.length === 0 && (
              <p className="mt-2 text-sm text-text-muted">
                No managers found in your organization.
              </p>
            )}

            {!isFetching && !fetchError && managers.length > 0 && (
              <select
                id="managerSelect"
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
                autoFocus
                className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">-- Select a manager --</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Submit error */}
          {submitError && (
            <p role="alert" className="text-sm text-red-600">{submitError}</p>
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedManagerId || isSubmitting || isFetching}
              onClick={handleSend}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isSubmitting ? 'Sending…' : 'Send Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CurrentStagePanel — real checklist items from API
// ---------------------------------------------------------------------------

function CurrentStagePanel({
  items,
  onToggle,
  toggling,
  caseId,
  currentStatus,
  client,
  onAdvanceSuccess,
  queryClient,
}: {
  items: ChecklistItem[];
  onToggle: (itemId: string) => void;
  toggling: Set<string>;
  caseId: string;
  currentStatus: string;
  client: AuthenticatedClient | null;
  onAdvanceSuccess: () => void;
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>;
}) {
  const [helpExpanded, setHelpExpanded] = useState(true);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [showDiscussionDialog, setShowDiscussionDialog] = useState(false);
  const [showManagerInputDialog, setShowManagerInputDialog] = useState(false);

  const nextStatus = NEXT_STATUS_PRIMARY[currentStatus];

  const completedCount = items.filter((i) => i.completed).length;
  const mandatoryItems = items.filter((i) => i.required);
  const mandatoryDone = mandatoryItems.every((i) => i.completed);
  const progressPct = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <div
      className="mt-3 ml-8 rounded-lg border-2 p-4 space-y-4"
      style={{ borderColor: '#2563EB', backgroundColor: '#EFF6FF' }}
      data-testid="current-stage-panel"
    >
      {/* Contextual Help */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setHelpExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-expanded={helpExpanded}
          aria-controls="stage-help-content"
          style={{ color: '#1E3A5F' }}
        >
          <span aria-hidden="true" className="text-blue-600">ⓘ</span>
          Contextual Help
          <span aria-hidden="true" className="ml-auto text-xs text-text-muted">
            {helpExpanded ? '▲' : '▼'}
          </span>
        </button>
        {helpExpanded && (
          <div
            id="stage-help-content"
            className="rounded border border-blue-200 bg-white p-3 text-sm"
            style={{ color: '#1E3A5F' }}
          >
            <p className="leading-relaxed">
              The interactive process is a dialogue between employer and employee to identify
              an effective accommodation. Document every conversation.
            </p>
            <p className="mt-2 text-xs font-semibold">
              Legal: EEOC Enforcement Guidance Q10
            </p>
            <p className="mt-1 text-xs text-red-700">
              Risk: Undocumented discussions weaken your defense in EEOC investigations.
            </p>
          </div>
        )}
      </div>

      {/* Sub-progress bar */}
      {items.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-text-muted">
            <span>Progress</span>
            <span>{completedCount}/{items.length} items completed</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label={`${completedCount} of ${items.length} checklist items completed`}
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, backgroundColor: '#2563EB' }}
            />
          </div>
        </div>
      )}

      {/* Checklist items */}
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">No checklist items for this stage.</p>
      ) : (
        <div className="space-y-3" role="group" aria-label="Stage checklist items">
          {items.map((item, index) => {
            const isToggling = toggling.has(item.id);
            return (
              <label key={item.id} className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => !isToggling && onToggle(item.id)}
                  disabled={isToggling}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600 disabled:cursor-wait"
                  aria-label={`${item.stepName}${item.required ? ' (mandatory)' : ''}`}
                  data-testid={`checklist-item-${index + 1}`}
                />
                <span className="text-sm text-text">
                  {item.stepName}
                  {item.required && (
                    <span className="ml-1 text-xs font-semibold text-red-600">*</span>
                  )}
                  {!item.required && (
                    <span className="ml-1 text-xs text-text-muted">(optional)</span>
                  )}
                  {item.completed && item.completedAt && (
                    <span className="ml-2 text-xs text-green-700 font-medium">
                      Done ({new Date(item.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                    </span>
                  )}
                  {isToggling && (
                    <span className="ml-2 text-xs text-text-muted">Saving...</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* Mandatory items note */}
      {items.some((i) => i.required) && (
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-red-600">*</span> Mandatory — required before advancing to next stage
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={showDiscussionDialog}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setShowDiscussionDialog(true)}
        >
          Add Discussion Record
        </button>
        <button
          type="button"
          disabled={showManagerInputDialog}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setShowManagerInputDialog(true)}
        >
          Request Manager Input
        </button>
      </div>

      {/* Add Discussion Dialog */}
      {showDiscussionDialog && (
        <AddDiscussionDialog
          caseId={caseId}
          client={client}
          queryClient={queryClient}
          onClose={() => setShowDiscussionDialog(false)}
        />
      )}

      {/* Request Manager Input Dialog */}
      {showManagerInputDialog && client && (
        <RequestManagerInputDialog
          caseId={caseId}
          client={client}
          onClose={() => setShowManagerInputDialog(false)}
        />
      )}

      {/* Stage Deadline */}
      <p className="text-sm text-text-muted">
        Stage Deadline: <span className="font-medium text-text">None (proceed when ready)</span>
      </p>

      {/* Next Stage button — only shown when there is a valid next status */}
      {nextStatus && (
        <div>
          <button
            type="button"
            disabled={!mandatoryDone || isAdvancing}
            className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: mandatoryDone && !isAdvancing ? '#2563EB' : undefined }}
            aria-disabled={!mandatoryDone || isAdvancing}
            aria-label={
              mandatoryDone
                ? 'Advance to next stage'
                : 'Complete mandatory items to advance to next stage'
            }
            data-testid="next-stage-button"
            onClick={async () => {
              if (!mandatoryDone || !client || !nextStatus || isAdvancing) return;
              setIsAdvancing(true);
              setAdvanceError(null);
              try {
                await advanceCaseStatus(client, caseId, nextStatus);
                onAdvanceSuccess();
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to advance stage';
                setAdvanceError(msg);
                setIsAdvancing(false);
              }
            }}
          >
            {isAdvancing ? 'Advancing...' : 'Next Stage →'}
          </button>
          {advanceError && (
            <p role="alert" className="mt-1 text-sm text-red-600">{advanceError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompletedStagePanel — read-only expanded view for completed stages
// ---------------------------------------------------------------------------

function CompletedStagePanel({ stageIndex }: { stageIndex: number }) {
  const summaries: Record<number, string> = {
    1: 'Accommodation request submitted and intake form completed. Employee notified of process initiation.',
    2: 'Acknowledgment letter generated and sent to employee. 30-day interactive process clock started.',
  };

  return (
    <div
      className="mt-3 ml-8 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-text"
      data-testid={`completed-stage-panel-${stageIndex + 1}`}
    >
      <p className="font-medium text-green-800 mb-1">Stage completed</p>
      <p className="text-green-700">{summaries[stageIndex + 1] ?? 'Stage completed successfully.'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StageStepper — uses real checklist items
// ---------------------------------------------------------------------------

const STAGE_LABELS = [
  'Intake / Request',
  'Acknowledgment',
  'Interactive Discussion',
  'Medical Documentation',
  'Decision',
  'Follow-up / Monitoring',
];

function StageStepper({
  currentStage,
  pwfaExempt,
  caseId,
  checklistItems,
  onToggle,
  toggling,
  currentStatus,
  client,
  onAdvanceSuccess,
  queryClient,
}: {
  currentStage: number;
  pwfaExempt: boolean;
  caseId: string;
  checklistItems: ChecklistItem[];
  onToggle: (itemId: string) => void;
  toggling: Set<string>;
  currentStatus: string;
  client: AuthenticatedClient | null;
  onAdvanceSuccess: () => void;
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>;
}) {
  const [expandedCompleted, setExpandedCompleted] = useState<Set<number>>(new Set());

  function toggleCompleted(index: number) {
    setExpandedCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4" aria-label="EEOC 6-stage process stepper">
      <ol className="space-y-4" aria-label="EEOC process stages">
        {STAGE_LABELS.map((label, index) => {
          const stageNumber = index + 1;
          const isCompleted = stageNumber < currentStage;
          const isCurrent = stageNumber === currentStage;
          const isStage4PwfaExempt = index === 3 && pwfaExempt;

          if (isCompleted) {
            const isExpanded = expandedCompleted.has(index);
            return (
              <li key={stageNumber}>
                <button
                  type="button"
                  onClick={() => toggleCompleted(index)}
                  className="flex w-full items-center gap-3 rounded px-2 py-1 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={isExpanded}
                  aria-label={`Stage ${stageNumber}: ${label} — Completed. Click to ${isExpanded ? 'collapse' : 'expand'} read-only view`}
                  data-testid={`stage-${stageNumber}-toggle`}
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: '#22C55E' }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="flex-1 text-sm font-semibold text-text">{label}</span>
                  <span className="text-xs text-text-muted">
                    Completed
                  </span>
                  <span className="ml-2 text-xs text-text-muted" aria-hidden="true">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </button>
                {isExpanded && <CompletedStagePanel stageIndex={index} />}
              </li>
            );
          }

          if (isCurrent) {
            let stageSpecificLink: React.ReactNode = null;
            if (stageNumber === 2) {
              stageSpecificLink = (
                <Link
                  to={`/cases/${caseId}/letters`}
                  className="text-sm font-medium underline hover:opacity-80"
                  style={{ color: '#2563EB' }}
                >
                  Generate Acknowledgment Letter →
                </Link>
              );
            }
            if (stageNumber === 5) {
              stageSpecificLink = (
                <Link
                  to={`/cases/${caseId}/decision`}
                  className="text-sm font-medium underline hover:opacity-80"
                  style={{ color: '#2563EB' }}
                >
                  Go to Decision Page →
                </Link>
              );
            }

            return (
              <li key={stageNumber}>
                <div
                  className="flex items-center gap-3 px-2 py-1"
                  aria-current="step"
                  data-testid={`stage-${stageNumber}-current`}
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: '#2563EB' }}
                    aria-hidden="true"
                  >
                    ●
                  </span>
                  <span className="flex-1 text-sm font-semibold" style={{ color: '#2563EB' }}>
                    {label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: '#2563EB' }}
                  >
                    In Progress
                  </span>
                </div>
                {stageSpecificLink && (
                  <div className="ml-8 mt-1">{stageSpecificLink}</div>
                )}
                <CurrentStagePanel
                  items={checklistItems}
                  onToggle={onToggle}
                  toggling={toggling}
                  caseId={caseId}
                  currentStatus={currentStatus}
                  client={client}
                  onAdvanceSuccess={onAdvanceSuccess}
                  queryClient={queryClient}
                />
              </li>
            );
          }

          // Locked
          return (
            <li key={stageNumber}>
              <div
                className="flex items-center gap-3 rounded px-2 py-1 opacity-50"
                aria-disabled="true"
                data-testid={`stage-${stageNumber}-locked`}
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm text-gray-500"
                  aria-hidden="true"
                >
                  🔒
                </span>
                <span className="flex-1 text-sm font-semibold text-gray-400">{label}</span>
                <span className="text-xs text-gray-400">Locked</span>
                {isStage4PwfaExempt && (
                  <span
                    className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700"
                    aria-label="This stage is exempt due to PWFA"
                  >
                    PWFA Exempt
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuditTrailMini — derived from completed checklist items
// ---------------------------------------------------------------------------

interface AuditEntry {
  date: string;
  actorType: string;
  eventCode: string;
  description: string;
}

function AuditTrailMini({
  entries,
  caseId,
}: {
  entries: AuditEntry[];
  caseId: string;
}) {
  return (
    <section
      aria-label="Recent audit trail"
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-text" style={{ color: '#1E3A5F' }}>
        Audit Trail
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-text-muted">No audit entries yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Last audit log entries">
          {entries.map((entry, i) => (
            <li key={i} className="rounded border border-gray-100 bg-gray-50 p-2 text-xs">
              <span className="font-mono text-text-muted">[{entry.date}]</span>{' '}
              <span className="font-semibold text-text">[{entry.actorType}]</span>{' '}
              <span className="rounded bg-gray-200 px-1 font-mono text-gray-600">
                [{entry.eventCode}]
              </span>
              <p className="mt-0.5 text-text">{entry.description}</p>
            </li>
          ))}
        </ol>
      )}
      <Link
        to={`/cases/${caseId}/timeline`}
        className="inline-flex items-center text-sm font-medium hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        style={{ color: '#2563EB' }}
        aria-label="View full case timeline"
      >
        View Full Timeline →
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ChecklistSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading checklist"
      className="p-6 max-w-5xl mx-auto space-y-6 animate-pulse"
    >
      <div className="rounded-lg border border-border bg-surface p-4 h-16" />
      <div className="rounded-lg border border-border bg-surface p-4 h-24" />
      <div className="rounded-lg border border-border bg-surface p-4 h-12" />
      <div className="rounded-lg border border-border bg-surface p-4 h-40" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Denied View
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
          You don't have permission to view the compliance checklist. Only Super Admin and HR roles
          can access this page.
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
// ChecklistPage — main export
// ---------------------------------------------------------------------------

export function ChecklistPage() {
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

  return <ChecklistPageContent caseId={caseId} />;
}

// ---------------------------------------------------------------------------
// ChecklistPageContent — internal component with API calls
// ---------------------------------------------------------------------------

function ChecklistPageContent({ caseId }: { caseId: string }) {
  const { client, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Clear TanStack Query cache when user logs out
  useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user, queryClient]);

  // Track which items are currently being toggled (optimistic UI)
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  // AC-2: Fetch case detail
  const {
    data: caseDetail,
    isLoading: isCaseLoading,
    isError: isCaseError,
    refetch: refetchCase,
  } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => fetchCaseDetail(client, caseId),
    enabled: !!client && !!caseId,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // AC-7: 401 handled by auth-client onAuthLost → redirect to /login
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status: number }).status === 401
      ) {
        return false;
      }
      return failureCount < 1;
    },
  });

  // AC-3: Fetch checklist items
  const {
    data: checklistData,
    isLoading: isChecklistLoading,
    isError: isChecklistError,
    refetch: refetchChecklist,
  } = useQuery({
    queryKey: ['checklist', caseId],
    queryFn: () => getChecklist(client, caseId),
    enabled: !!client && !!caseId,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status: number }).status === 401
      ) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const isLoading = isCaseLoading || isChecklistLoading;
  const isError = isCaseError || isChecklistError;

  // AC-5: Advance case to next stage
  function handleAdvanceSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
    navigate(`/cases/${caseId}`);
  }

  // AC-4: Toggle checklist item
  async function handleToggleItem(itemId: string) {
    if (!client) return;

    setToggling((prev) => new Set(prev).add(itemId));

    try {
      await toggleChecklistItem(client, caseId, itemId);
      await queryClient.invalidateQueries({ queryKey: ['checklist', caseId] });
    } catch {
      // AC-7: 401 handled by auth-client
      await refetchChecklist();
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  // AC-6: Loading state
  if (isLoading) {
    return <ChecklistSkeleton />;
  }

  // Error state
  if (isError) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="checklist-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">Could not load checklist</h2>
            <p className="mt-1 text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                void refetchCase();
                void refetchChecklist();
              }}
              className="mt-2 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => navigate(`/cases/${caseId}`)}
              className="mt-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ← Back to Case
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Derive display values from real API data
  const currentStage = caseDetail ? deriveCurrentStage(caseDetail.status) : 1;
  const dualLaw = caseDetail?.type === 'multiple';
  const pwfaExempt = caseDetail?.type === 'pwfa';

  const now = new Date();
  const createdAt = caseDetail ? new Date(caseDetail.createdAt) : now;
  const deadlineDate = caseDetail?.deadline ? new Date(caseDetail.deadline) : null;
  const dayElapsed = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)));
  const totalDays = deadlineDate
    ? Math.max(1, Math.floor((deadlineDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))
    : 30;

  const accommodationLabel =
    caseDetail?.approvedAccommodation ??
    (caseDetail?.requestDescription
      ? caseDetail.requestDescription.slice(0, 40) + (caseDetail.requestDescription.length > 40 ? '...' : '')
      : 'Accommodation Request');

  const caseHeaderData: CaseHeaderData = {
    caseDisplayId: caseId,
    employeeLabel: 'Employee',
    accommodationLabel,
    dualLaw,
    status: caseDetail?.status ?? 'intake',
  };

  const checklistItems: ChecklistItem[] = checklistData?.checklist ?? [];

  const auditEntries: AuditEntry[] = checklistItems
    .filter((i) => i.completed && i.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, 3)
    .map((i) => ({
      date: new Date(i.completedAt!).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }),
      actorType: 'HR',
      eventCode: 'checklist.item_completed',
      description: `Checklist item completed: ${i.stepName}`,
    }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <DeadlineBadge dayElapsed={dayElapsed} totalDays={totalDays} />

      <CaseHeader
        caseId={caseId}
        caseData={caseHeaderData}
        backPath={`/cases/${caseId}`}
      />

      {dualLaw && <DualLawAlertBanner />}

      <OverallProgressBar currentStage={currentStage} />

      <StageStepper
        currentStage={currentStage}
        pwfaExempt={pwfaExempt}
        caseId={caseId}
        checklistItems={checklistItems}
        onToggle={handleToggleItem}
        toggling={toggling}
        currentStatus={caseDetail?.status ?? 'intake'}
        client={client}
        onAdvanceSuccess={handleAdvanceSuccess}
        queryClient={queryClient}
      />

      <AuditTrailMini entries={auditEntries} caseId={caseId} />
    </div>
  );
}

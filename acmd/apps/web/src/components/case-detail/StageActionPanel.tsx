/**
 * StageActionPanel — ACMD-137-C2
 *
 * Renders the correct action panel based on the active EEOC stage
 * derived from caseData.status. Stage is computed via deriveCurrentStage().
 *
 * Role-based visibility per wireframe SCR-CASE-DETAIL Section 8:
 *   Stage 1: all roles — read-only intake info
 *   Stage 2: super_admin/hr = full; manager/medical_reviewer = simplified
 *   Stage 3: super_admin/hr = full interactive; manager = simplified; medical_reviewer = null
 *   Stage 4: super_admin/hr = medical status; manager = null; medical_reviewer = null
 *   Stage 5: super_admin/hr = decision; manager = "Decision pending"; medical_reviewer = null
 *   Stage 6: super_admin/hr = outcome + CaseClosureGate; manager = "Case monitoring"; medical_reviewer = null
 *
 * Compliance (29 CFR 1630.14):
 *   - Manager: ZERO medical terminology anywhere
 *   - Medical Reviewer: stages 3, 4, 5 return null (no ADA strategy visible)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedClient } from '@/lib/api-client';
import type { AcmdCaseDetail } from '@/pages/CaseDetailPage';
import type { CreateDiscussionPayload, DiscussionMethod } from '@/lib/api/cases';
import { fetchDiscussions, createDiscussion } from '@/lib/api/cases';
import { deriveCurrentStage } from '@/components/case-detail/EEOCStepper';
import { CaseClosureGate } from '@/components/case-detail/CaseClosureGate';
import type { CaseStatus, CaseType } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StageActionPanelProps {
  caseData: AcmdCaseDetail;
  role: 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';
  apiClient: AuthenticatedClient;
  onCaseUpdated?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<CaseType, string> = {
  ada: 'ADA (Americans with Disabilities Act)',
  pwfa: 'PWFA (Pregnant Workers Fairness Act)',
  state_law: 'State Law',
  multiple: 'ADA + PWFA (Dual-Law)',
};

const AI_CONSENT_LABELS: Record<AcmdCaseDetail['ai_consent_status'], string> = {
  pending: 'Pending',
  given: 'Enabled',
  declined: 'Declined',
};

const DISCUSSION_METHOD_LABELS: Record<DiscussionMethod, string> = {
  in_person: 'In-person',
  video: 'Video',
  phone: 'Phone',
  email: 'Email',
  written: 'Written',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — Intake (Read-Only)
// ---------------------------------------------------------------------------

function Stage1Panel({ caseData }: { caseData: AcmdCaseDetail }) {
  return (
    <section
      id="stage-panel-1"
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Stage 1: Intake information"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">
        Stage 1: Intake — Completed
      </h2>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-gray-500 font-medium">Employee</dt>
          <dd className="text-gray-800 mt-0.5">{caseData.employeeId}</dd>
        </div>

        <div>
          <dt className="text-gray-500 font-medium">Accommodation Type</dt>
          <dd className="text-gray-800 mt-0.5">{TYPE_LABELS[caseData.type]}</dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-gray-500 font-medium">Request Description</dt>
          <dd className="text-gray-800 mt-0.5">
            {caseData.requestDescription ?? '(No description provided)'}
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 font-medium">Laws Applicable</dt>
          <dd className="text-gray-800 mt-0.5">{TYPE_LABELS[caseData.type]}</dd>
        </div>

        <div>
          <dt className="text-gray-500 font-medium">AI Consent</dt>
          <dd className="text-gray-800 mt-0.5">
            {AI_CONSENT_LABELS[caseData.ai_consent_status]}
          </dd>
        </div>

        <div>
          <dt className="text-gray-500 font-medium">Created</dt>
          <dd className="text-gray-800 mt-0.5">{formatDate(caseData.createdAt)}</dd>
        </div>
      </dl>

      <p className="text-xs text-gray-400 italic">
        (Read-only — intake data is immutable after case creation)
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — Acknowledgment
// ---------------------------------------------------------------------------

interface Stage2PanelProps {
  caseData: AcmdCaseDetail;
  role: StageActionPanelProps['role'];
}

function Stage2Panel({ caseData, role }: Stage2PanelProps) {
  if (role === 'manager' || role === 'medical_reviewer') {
    return (
      <section
        id="stage-panel-2"
        className="rounded-lg border border-border bg-surface p-4 space-y-2"
        aria-label="Stage 2: Acknowledgment"
      >
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 2: Acknowledgment</h2>
        <p className="text-sm text-gray-600">Acknowledgment in progress.</p>
      </section>
    );
  }

  return (
    <section
      id="stage-panel-2"
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Stage 2: Acknowledgment panel"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 2: Acknowledgment</h2>

      {/* 3-day sub-deadline note */}
      <div
        role="note"
        className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-800"
      >
        Federal guidelines recommend acknowledging within 3 business days of case creation
        ({formatDate(caseData.createdAt)}).
      </div>

      {/* Letter status */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 font-medium">Letter Status:</span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          Not Yet Generated
        </span>
      </div>

      {/* Generate button — placeholder */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Generate letter — coming in future phase (SCR-LETTER)"
        className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
      >
        Generate Acknowledgment Letter →
      </button>

      <p className="text-xs text-gray-400">
        ⓘ Federal guidelines recommend acknowledging within 3 business days.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Interactive Discussion (super_admin / hr)
// ---------------------------------------------------------------------------

interface Stage3FullPanelProps {
  caseData: AcmdCaseDetail;
  apiClient: AuthenticatedClient;
  onCaseUpdated?: () => void;
}

function Stage3FullPanel({ caseData, apiClient, onCaseUpdated }: Stage3FullPanelProps) {
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [markCompleteError, setMarkCompleteError] = useState<string | null>(null);

  const [newDiscussion, setNewDiscussion] = useState<Partial<CreateDiscussionPayload>>({
    method: 'in_person',
  });

  const {
    data: discussions = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['discussions', caseData.id],
    queryFn: () => fetchDiscussions(apiClient, caseData.id),
    staleTime: 30_000,
  });

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSaveDiscussion() {
    if (!newDiscussion.discussionDate || !newDiscussion.method || !newDiscussion.summary) {
      setSubmitError('Date, method, and summary are required.');
      return;
    }
    if ((newDiscussion.summary?.length ?? 0) < 10) {
      setSubmitError('Summary must be at least 10 characters.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const participantsRaw = (newDiscussion as { participantsRaw?: string }).participantsRaw ?? '';
      const participants = participantsRaw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const payload: CreateDiscussionPayload = {
        discussionDate: newDiscussion.discussionDate ?? '',
        method: newDiscussion.method ?? 'in_person',
        participants,
        summary: newDiscussion.summary ?? '',
        employeePreference: newDiscussion.employeePreference ?? null,
      };

      await createDiscussion(apiClient, caseData.id, payload);
      await queryClient.invalidateQueries({ queryKey: ['discussions', caseData.id] });
      await refetch();
      setShowAddForm(false);
      setNewDiscussion({ method: 'in_person' });
      onCaseUpdated?.();
    } catch {
      setSubmitError('Failed to save discussion. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkComplete() {
    setIsMarkingComplete(true);
    setMarkCompleteError(null);
    try {
      await apiClient.request(`/api/v1/cases/${caseData.id}`, {
        method: 'PATCH',
        body: { status: 'awaiting_medical' },
        headers: { 'Content-Type': 'application/json' },
      });
      onCaseUpdated?.();
    } catch {
      setMarkCompleteError('Failed to complete stage. Please try again.');
    } finally {
      setIsMarkingComplete(false);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const discussionCount = discussions.length;
  const canMarkComplete = discussionCount >= 1;

  return (
    <section
      id="stage-panel-3"
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Stage 3: Interactive Discussion panel"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">
        Stage 3: Interactive Discussion
      </h2>

      <p className="text-sm font-medium text-gray-700">
        Discussion Records ({discussionCount} of minimum 1)
      </p>

      {/* Loading state */}
      {isLoading && (
        <div
          role="status"
          aria-label="Loading discussions"
          className="space-y-2 animate-pulse"
        >
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded bg-gray-100" />
          ))}
        </div>
      )}

      {/* Discussion cards */}
      {!isLoading && discussions.length === 0 && (
        <p className="text-sm text-gray-400 py-2 text-center">No discussions recorded yet.</p>
      )}

      {!isLoading && discussions.length > 0 && (
        <ul role="list" className="space-y-2">
          {discussions.map((disc) => {
            const isExpanded = expandedIds.has(disc.id);
            return (
              <li
                key={disc.id}
                role="listitem"
                className="rounded-md border border-gray-200 p-3 space-y-1"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    <span className="font-medium">Date:</span>{' '}
                    {formatDate(disc.discussionDate)}{' '}
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="font-medium">Method:</span>{' '}
                    {DISCUSSION_METHOD_LABELS[disc.method]}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpand(disc.id)}
                    className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded"
                    aria-expanded={isExpanded}
                    aria-controls={`discussion-detail-${disc.id}`}
                  >
                    {isExpanded ? 'Collapse ▲' : 'Expand ▾'}
                  </button>
                </div>

                {isExpanded && (
                  <div
                    id={`discussion-detail-${disc.id}`}
                    className="pt-2 space-y-1 text-sm text-gray-700 border-t border-gray-100 mt-1"
                  >
                    <p>
                      <span className="font-medium text-gray-500">Participants:</span>{' '}
                      {disc.participants.length > 0 ? disc.participants.join(', ') : '(none listed)'}
                    </p>
                    <p>
                      <span className="font-medium text-gray-500">Summary:</span>{' '}
                      {disc.summary}
                    </p>
                    <p>
                      <span className="font-medium text-gray-500">Employee Preference:</span>{' '}
                      {disc.employeePreference ?? 'Not recorded'}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Discussion button / form */}
      {!showAddForm && (
        <button
          type="button"
          onClick={() => { setShowAddForm(true); setSubmitError(null); }}
          className="inline-flex items-center gap-1 rounded-md border border-[#2563EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          + Add Discussion Record
        </button>
      )}

      {showAddForm && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">New Discussion Record</h3>

          {/* Date */}
          <div className="space-y-1">
            <label htmlFor="disc-date" className="block text-xs font-medium text-gray-600">
              Date *
            </label>
            <input
              type="date"
              id="disc-date"
              max={today}
              value={newDiscussion.discussionDate ?? ''}
              onChange={(e) =>
                setNewDiscussion((prev) => ({ ...prev, discussionDate: e.target.value }))
              }
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          {/* Method */}
          <div className="space-y-1">
            <label htmlFor="disc-method" className="block text-xs font-medium text-gray-600">
              Method *
            </label>
            <select
              id="disc-method"
              value={newDiscussion.method ?? 'in_person'}
              onChange={(e) =>
                setNewDiscussion((prev) => ({
                  ...prev,
                  method: e.target.value as DiscussionMethod,
                }))
              }
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="in_person">In-person</option>
              <option value="video">Video</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="written">Written</option>
            </select>
          </div>

          {/* Participants */}
          <div className="space-y-1">
            <label htmlFor="disc-participants" className="block text-xs font-medium text-gray-600">
              Participants (comma-separated names)
            </label>
            <input
              type="text"
              id="disc-participants"
              placeholder="e.g., Jane Martinez, Sarah Kim"
              value={
                (newDiscussion as { participantsRaw?: string }).participantsRaw ?? ''
              }
              onChange={(e) =>
                setNewDiscussion((prev) => ({
                  ...prev,
                  participantsRaw: e.target.value,
                } as typeof prev & { participantsRaw: string }))
              }
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          {/* Summary */}
          <div className="space-y-1">
            <label htmlFor="disc-summary" className="block text-xs font-medium text-gray-600">
              Summary * (min 10 characters)
            </label>
            <textarea
              id="disc-summary"
              rows={3}
              value={newDiscussion.summary ?? ''}
              onChange={(e) =>
                setNewDiscussion((prev) => ({ ...prev, summary: e.target.value }))
              }
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
            />
          </div>

          {/* Employee Preference */}
          <div className="space-y-1">
            <label htmlFor="disc-preference" className="block text-xs font-medium text-gray-600">
              Employee Preference (optional)
            </label>
            <textarea
              id="disc-preference"
              rows={2}
              value={newDiscussion.employeePreference ?? ''}
              onChange={(e) =>
                setNewDiscussion((prev) => ({
                  ...prev,
                  employeePreference: e.target.value || null,
                }))
              }
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
            />
          </div>

          {/* Submit error */}
          {submitError && (
            <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              {submitError}
            </div>
          )}

          {/* Form actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { void handleSaveDiscussion(); }}
              disabled={isSubmitting}
              className="rounded-md bg-[#2563EB] px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Discussion'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setSubmitError(null); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Placeholder actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Request Manager Input — coming soon (FLOW-MGR)"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-400 cursor-not-allowed"
        >
          Request Manager Input →
        </button>

        {caseData.ai_consent_status === 'given' && (
          <Link
            to={`/cases/${caseData.id}/ai-analysis`}
            className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Run AI Analysis →
          </Link>
        )}

        {(caseData.type === 'pwfa' || caseData.type === 'multiple') && (
          <Link
            to={`/cases/${caseData.id}/pwfa-interim`}
            className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            PWFA Interim Accommodation →
          </Link>
        )}
      </div>

      {/* Info tip */}
      <div
        role="note"
        className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800"
      >
        ⓘ The interactive process is a dialogue between employer and employee to find an
        effective accommodation. Document each conversation. More documentation = stronger
        compliance.
      </div>

      {/* Stage completion badge */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            canMarkComplete
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}
          aria-label={`${discussionCount}/1 discussions documented`}
        >
          {discussionCount}/1 discussions documented
        </span>
      </div>

      {/* Mark Stage 3 Complete */}
      {markCompleteError && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {markCompleteError}
        </div>
      )}
      <button
        type="button"
        onClick={() => { void handleMarkComplete(); }}
        disabled={!canMarkComplete || isMarkingComplete}
        aria-disabled={!canMarkComplete || isMarkingComplete ? 'true' : undefined}
        title={
          !canMarkComplete
            ? 'At least 1 discussion must be documented before completing this stage'
            : undefined
        }
        className={`w-full rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] ${
          canMarkComplete && !isMarkingComplete
            ? 'bg-[#1E3A5F] text-white hover:bg-[#16304f]'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        {isMarkingComplete ? 'Completing...' : 'Mark Stage 3 Complete →'}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Panel (role-routed)
// ---------------------------------------------------------------------------

interface Stage3PanelProps extends Stage3FullPanelProps {
  role: StageActionPanelProps['role'];
}

function Stage3Panel({ caseData, role, apiClient, onCaseUpdated }: Stage3PanelProps) {
  // Medical reviewer sees nothing for stage 3
  if (role === 'medical_reviewer') return null;

  if (role === 'manager') {
    return (
      <section
        id="stage-panel-3"
        className="rounded-lg border border-border bg-surface p-4 space-y-2"
        aria-label="Stage 3: Case in review"
      >
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 3: In Review</h2>
        <p className="text-sm text-gray-600">
          HR is conducting the interactive process. You will be notified if your input is needed.
        </p>
      </section>
    );
  }

  return (
    <Stage3FullPanel
      caseData={caseData}
      apiClient={apiClient}
      onCaseUpdated={onCaseUpdated}
    />
  );
}

// ---------------------------------------------------------------------------
// Stage 4 — Medical Documentation
// ---------------------------------------------------------------------------

interface Stage4PanelProps {
  caseData: AcmdCaseDetail & { pwfaPerSe?: boolean };
  role: StageActionPanelProps['role'];
}

function Stage4Panel({ caseData, role }: Stage4PanelProps) {
  // Medical reviewer and manager: hidden
  if (role === 'medical_reviewer' || role === 'manager') return null;

  const isPwfaExempt = caseData.pwfaPerSe === true;

  return (
    <section
      id="stage-panel-4"
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Stage 4: Medical documentation panel"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">
        Stage 4: Medical Documentation
      </h2>

      {/* PWFA Exempt banner */}
      {isPwfaExempt && (
        <div
          role="note"
          aria-label="PWFA exempt — medical documentation not required"
          className="rounded-md border border-purple-300 bg-purple-50 p-3 flex items-start gap-2"
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-semibold text-white shrink-0"
          >
            PWFA Exempt
          </span>
          <div className="text-xs text-purple-800 space-y-1">
            <p className="font-medium">Medical documentation not required under PWFA</p>
            <p className="text-purple-600">Stage auto-completed — no medical form needed.</p>
          </div>
        </div>
      )}

      {/* Status badge */}
      {!isPwfaExempt && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-600">Medical Documentation Status:</span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                caseData.medicalInfo
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {caseData.medicalInfo ? 'Received — Pending Review' : 'Not Requested'}
            </span>
          </div>

          {!caseData.medicalInfo && (
            <Link
              to={`/cases/${caseData.id}/medical-request`}
              className="block w-full rounded-md bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
            >
              Request Medical Documentation →
            </Link>
          )}

          <p className="text-xs text-gray-400">
            ⓘ Under the ADA, you may request medical documentation when the disability or
            the need for accommodation is not apparent. Requests must be job-related and
            consistent with business necessity.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 5 — Decision
// ---------------------------------------------------------------------------

interface Stage5PanelProps {
  caseData: AcmdCaseDetail;
  role: StageActionPanelProps['role'];
}

function Stage5Panel({ caseData, role }: Stage5PanelProps) {
  // Medical reviewer: hidden
  if (role === 'medical_reviewer') return null;

  if (role === 'manager') {
    return (
      <section
        id="stage-panel-5"
        className="rounded-lg border border-border bg-surface p-4 space-y-2"
        aria-label="Stage 5: Decision pending"
      >
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 5: Decision Pending</h2>
        <p className="text-sm text-gray-600">
          A decision is being made. You will be notified of the outcome.
        </p>
      </section>
    );
  }

  // super_admin + hr
  // canMakeDecision only when status === 'review' (Stage 5 active — FIX-4)
  // Per wireframe pre-condition: decision screen accessible only in Stage 5 active status
  const canMakeDecision =
    (role === 'super_admin' || role === 'hr') &&
    (caseData.status as CaseStatus) === 'review';

  return (
    <section
      id="stage-panel-5"
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Stage 5: Decision panel"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 5: Decision</h2>

      {canMakeDecision ? (
        <Link
          to={`/cases/${caseData.id}/decision`}
          className="flex w-full items-center justify-center rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Make Decision →
        </Link>
      ) : (
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
        >
          Make Decision →
        </button>
      )}

      <p className="text-xs text-gray-400">
        ⓘ Review all collected information before making a decision. Ensure the interactive
        process is fully documented and all relevant factors have been considered.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 6 — Follow-up / Monitoring
// ---------------------------------------------------------------------------

interface Stage6PanelProps {
  caseData: AcmdCaseDetail;
  role: StageActionPanelProps['role'];
  apiClient: AuthenticatedClient;
  onCaseUpdated?: () => void;
}

function Stage6Panel({ caseData, role, apiClient, onCaseUpdated }: Stage6PanelProps) {
  if (role === 'medical_reviewer') return null;

  if (role === 'manager') {
    return (
      <section
        id="stage-panel-6"
        className="rounded-lg border border-border bg-surface p-4 space-y-2"
        aria-label="Stage 6: Case monitoring"
      >
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 6: Monitoring</h2>
        <p className="text-sm text-gray-600">
          The case is in its final monitoring phase. No action required on your part at this time.
        </p>
      </section>
    );
  }

  // super_admin + hr
  const outcomeStatus = caseData.status as CaseStatus;
  const isApproved = outcomeStatus === 'approved';
  const isDenied = outcomeStatus === 'denied';
  const isClosed = outcomeStatus === 'closed';

  let outcomeBadge: React.ReactNode = null;
  if (isApproved) {
    outcomeBadge = (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
        Approved
      </span>
    );
  } else if (isDenied) {
    outcomeBadge = (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
        Denied
      </span>
    );
  } else if (isClosed) {
    outcomeBadge = (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
        Closed
      </span>
    );
  }

  return (
    <div id="stage-panel-6" className="space-y-4">
      <section
        className="rounded-lg border border-border bg-surface p-4 space-y-4"
        aria-label="Stage 6: Follow-up and monitoring"
      >
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Stage 6: Follow-up / Monitoring</h2>

        {/* Outcome badge */}
        {outcomeBadge && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-gray-600">Outcome:</span>
            {outcomeBadge}
          </div>
        )}

        {/* Follow-up date — future phase */}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600">Follow-up Date:</span>
          <span className="text-gray-400">Not yet set</span>
        </div>

        {/* Effectiveness check — placeholder */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Add Effectiveness Check — coming soon"
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
        >
          Add Effectiveness Check
        </button>
      </section>

      {/* CaseClosureGate — super_admin / hr only (embedded) */}
      <CaseClosureGate
        caseId={caseData.id}
        caseStatus={caseData.status}
        role={role}
        allStagesComplete={
          outcomeStatus === 'approved' ||
          outcomeStatus === 'denied' ||
          outcomeStatus === 'closed'
        }
        employeeNotified={
          outcomeStatus === 'approved' ||
          outcomeStatus === 'denied' ||
          outcomeStatus === 'closed'
        }
        followupDateSet={false}
        onClosed={onCaseUpdated}
        apiClient={apiClient}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// StageActionPanel — main component
// ---------------------------------------------------------------------------

export function StageActionPanel({
  caseData,
  role,
  apiClient,
  onCaseUpdated,
}: StageActionPanelProps) {
  const activeStage = deriveCurrentStage(caseData.status);

  // Cast to include optional pwfaPerSe field
  const caseDataExtended = caseData as AcmdCaseDetail & { pwfaPerSe?: boolean };

  switch (activeStage) {
    case 1:
      return <Stage1Panel caseData={caseData} />;

    case 2:
      return <Stage2Panel caseData={caseData} role={role} />;

    case 3:
      return (
        <Stage3Panel
          caseData={caseData}
          role={role}
          apiClient={apiClient}
          onCaseUpdated={onCaseUpdated}
        />
      );

    case 4:
      return <Stage4Panel caseData={caseDataExtended} role={role} />;

    case 5:
      return <Stage5Panel caseData={caseData} role={role} />;

    case 6:
      return (
        <Stage6Panel
          caseData={caseData}
          role={role}
          apiClient={apiClient}
          onCaseUpdated={onCaseUpdated}
        />
      );

    default:
      return <Stage1Panel caseData={caseData} />;
  }
}

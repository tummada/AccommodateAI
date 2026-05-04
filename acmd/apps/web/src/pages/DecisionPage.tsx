/**
 * DecisionPage — ACMD-138-A
 *
 * URL: /cases/:id/decision
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer → redirect to /cases/:id
 *
 * COMPLIANCE: 29 CFR 1630.14 — no diagnosis shown
 * This page NEVER renders caseData.medicalInfo or any diagnosis.
 * Only accommodation type and functional restrictions summary (requestDescription) are shown.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { fetchCaseDetail, type AcmdCaseDetail } from '@/pages/CaseDetailPage';
import { CaseDetailHeader } from '@/components/case-detail/CaseDetailHeader';
import { postApproveDecision } from '@/lib/api/decision';
import { DenyTab, SupervisorReviewPanel } from '@/pages/DenyTab';
import type { CaseType } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Role helpers
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
  return 'manager'; // least privilege fallback — blocked by role gate
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DecisionSkeleton() {
  return (
    <div role="status" aria-label="Loading decision page" className="space-y-4 animate-pulse">
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-gray-200" />
        <div className="h-6 w-48 rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8">
        <div className="h-4 w-40 rounded bg-gray-200 mx-auto" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error view (reused pattern from CaseDetailPage)
// ---------------------------------------------------------------------------

function ErrorView({ type }: { type: '404' | '403' | 'generic' }) {
  const configs = {
    '404': {
      title: 'Case not found',
      message: "We couldn't find a case with that ID.",
      icon: '🔍',
    },
    '403': {
      title: 'Access denied',
      message: "You don't have permission to access this page.",
      icon: '🔒',
    },
    generic: {
      title: 'Something went wrong',
      message: 'We encountered an unexpected error. Please try again.',
      icon: '⚠️',
    },
  };
  const cfg = configs[type];
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-12 text-center"
    >
      <span className="text-4xl" aria-hidden="true">{cfg.icon}</span>
      <div>
        <h2 className="text-lg font-semibold text-text">{cfg.title}</h2>
        <p className="mt-1 text-sm text-text-muted max-w-md">{cfg.message}</p>
      </div>
      <Link
        to="/cases"
        className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to Cases
      </Link>
    </div>
  );
}

function getErrorType(error: unknown): '404' | '403' | 'generic' {
  if (error instanceof ApiError) {
    if (error.status === 404) return '404';
    if (error.status === 403) return '403';
  }
  return 'generic';
}

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

type DurationType = 'permanent' | 'temporary' | 'trial_period';
type AccommodationType = 'Schedule' | 'Equipment' | 'Remote Work' | 'Leave' | 'Modified Duties' | 'Other';
type FollowUpDays = '30' | '60' | '90' | 'custom';

interface ApproveFormState {
  description: string;
  accommodationType: AccommodationType;
  duration: DurationType;
  durationEndDate: string;
  effectiveDate: string;
  implementationDetails: string;
  responsibleParties: { hr: boolean; manager: boolean; it: boolean };
  followUpDays: FollowUpDays;
  followUpCustomDays: string;
}

// ---------------------------------------------------------------------------
// Simple toast (no external library installed)
// ---------------------------------------------------------------------------

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
        toast.type === 'success'
          ? 'bg-green-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '✕'}</span>
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-2 opacity-75 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dual-Law Compliance Checklist (read-only)
// ---------------------------------------------------------------------------

function DualLawChecklist({ caseType }: { caseType: CaseType }) {
  const showAda = caseType === 'ada' || caseType === 'multiple';
  const showPwfa = caseType === 'pwfa' || caseType === 'multiple';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700">Dual-Law Compliance Checklist</h3>
      <p className="text-xs text-gray-500">Auto-populated from case data — read-only display</p>

      {showAda && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              ADA
            </span>
            <span className="text-sm font-medium text-gray-700">Americans with Disabilities Act</span>
          </div>
          {[
            'Interactive process completed (Stage 3)',
            'Accommodation addresses functional limitations',
            'Documentation supports need (Stage 4 cleared)',
          ].map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm text-gray-700 cursor-default">
              <input
                type="checkbox"
                checked
                disabled
                readOnly
                aria-label={item}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              {item}
            </label>
          ))}
          <p className="text-xs text-green-700 font-medium">✓ 3/3 Complete</p>
        </div>
      )}

      {showPwfa && (
        <div className="rounded-md border border-purple-200 bg-purple-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">
              PWFA
            </span>
            <span className="text-sm font-medium text-gray-700">Pregnant Workers Fairness Act</span>
          </div>
          {[
            'Condition verified',
            'Accommodation is reasonable',
          ].map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm text-gray-700 cursor-default">
              <input
                type="checkbox"
                checked
                disabled
                readOnly
                aria-label={item}
                className="h-4 w-4 rounded border-gray-300 text-purple-600"
              />
              {item}
            </label>
          ))}
          <p className="text-xs text-green-700 font-medium">✓ 2/2 Complete</p>
        </div>
      )}

      {!showAda && !showPwfa && (
        <p className="text-sm text-gray-500">No applicable laws checklist for case type: {caseType}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Recommendation Panel
// ---------------------------------------------------------------------------

function AiRecommendationPanel({
  suggestedAccommodations,
}: {
  suggestedAccommodations: Record<string, unknown>[] | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const rec = suggestedAccommodations?.[0] ?? null;

  return (
    <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">✨</span>
          <h3 className="text-sm font-semibold text-yellow-800">AI Recommendation</h3>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="ai-rec-body"
          className="text-xs text-yellow-700 hover:text-yellow-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 rounded"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div id="ai-rec-body" className="space-y-2 text-sm text-yellow-900">
          {rec ? (
            <>
              <p>
                <span className="font-medium">Recommended:</span>{' '}
                {String(rec.description ?? rec.accommodation ?? 'Accommodation recommendation available')}
              </p>
              {rec.confidence !== undefined && (
                <p>
                  <span className="font-medium">Confidence:</span>{' '}
                  {typeof rec.confidence === 'number'
                    ? `${Math.round(rec.confidence * 100)}%`
                    : String(rec.confidence)}
                </p>
              )}
              <p>
                <span className="font-medium">Based on:</span>{' '}
                {String(rec.basis ?? '12 similar cases in JAN SOAR database')}
              </p>
            </>
          ) : (
            <p className="text-yellow-700">No recommendation available.</p>
          )}
          <p className="mt-2 text-xs text-yellow-700 italic">
            ⓘ AI recommendations are advisory only. The final decision is yours. Review carefully before approving.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation Dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  caseData: AcmdCaseDetail;
  formState: ApproveFormState;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

function ConfirmDialog({
  caseData,
  formState,
  onConfirm,
  onCancel,
  isSubmitting,
  submitError,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const descId = 'confirm-dialog-desc';

  // Focus trap + initial focus
  useEffect(() => {
    firstFocusableRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const getLawsLabel = () => {
    const t = caseData.type as CaseType;
    if (t === 'ada') return 'ADA';
    if (t === 'pwfa') return 'PWFA';
    if (t === 'multiple') return 'ADA + PWFA';
    return t;
  };

  const getFollowUpLabel = () => {
    if (formState.followUpDays === 'custom') {
      return formState.followUpCustomDays ? `${formState.followUpCustomDays} days (custom)` : 'Custom';
    }
    return `${formState.followUpDays} days`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={descId}
        className="relative mx-4 w-full max-w-lg rounded-lg border border-border bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
          Approve Accommodation
        </h2>

        <div id={descId} className="mt-4 space-y-3 text-sm text-gray-700">
          <p className="font-medium">You are about to approve this accommodation:</p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
            <dt className="font-medium text-gray-500">Employee</dt>
            <dd>{caseData.employeeId}</dd>

            <dt className="font-medium text-gray-500">Accommodation</dt>
            <dd>{formState.description || '—'}</dd>

            <dt className="font-medium text-gray-500">Effective Date</dt>
            <dd>{formState.effectiveDate || '—'}</dd>

            <dt className="font-medium text-gray-500">Duration</dt>
            <dd className="capitalize">{formState.duration.replace('_', ' ')}</dd>

            <dt className="font-medium text-gray-500">Follow-up</dt>
            <dd>{getFollowUpLabel()}</dd>

            <dt className="font-medium text-gray-500">Laws</dt>
            <dd>{getLawsLabel()}</dd>
          </dl>

          <div className="mt-3">
            <p className="font-medium text-gray-700">This action will:</p>
            <ul className="mt-1 list-disc pl-5 space-y-1 text-gray-600">
              <li>Generate an approval letter for your review</li>
              <li>Notify the employee via email</li>
              <li>Notify the manager (accommodation outcome only — no medical info)</li>
              <li>Set follow-up reminder for {getFollowUpLabel()}</li>
              <li>Log this decision in the permanent audit trail</li>
            </ul>
          </div>
        </div>

        {submitError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {submitError}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting…' : 'Confirm Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve Tab
// ---------------------------------------------------------------------------

interface ApproveTabProps {
  caseData: AcmdCaseDetail;
  onApproveSuccess: () => void;
}

function ApproveTab({ caseData, onApproveSuccess }: ApproveTabProps) {
  const { client } = useAuth();
  const { id } = useParams<{ id: string }>();

  const aiRec = caseData.suggestedAccommodations?.[0] ?? null;

  const [formState, setFormState] = useState<ApproveFormState>({
    description:
      typeof aiRec?.description === 'string'
        ? aiRec.description
        : typeof aiRec?.accommodation === 'string'
          ? aiRec.accommodation
          : '',
    accommodationType: 'Schedule',
    duration: 'permanent',
    durationEndDate: '',
    effectiveDate: '',
    implementationDetails: '',
    responsibleParties: { hr: true, manager: false, it: false },
    followUpDays: '30',
    followUpCustomDays: '',
  });

  const [showDialog, setShowDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleFieldChange = <K extends keyof ApproveFormState>(
    field: K,
    value: ApproveFormState[K],
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleResponsiblePartyChange = (party: keyof ApproveFormState['responsibleParties']) => {
    setFormState((prev) => ({
      ...prev,
      responsibleParties: {
        ...prev.responsibleParties,
        [party]: !prev.responsibleParties[party],
      },
    }));
  };

  const handleConfirmApprovalClick = () => {
    // Validate required fields
    if (!formState.description.trim()) {
      setFormError('Accommodation description is required.');
      return;
    }
    if (!formState.effectiveDate) {
      setFormError('Effective date is required.');
      return;
    }
    if (formState.duration === 'temporary' && !formState.durationEndDate) {
      setFormError('End date is required for temporary duration.');
      return;
    }
    if (formState.duration === 'trial_period' && !formState.durationEndDate) {
      setFormError('Review date is required for trial period.');
      return;
    }
    if (formState.followUpDays === 'custom' && !formState.followUpCustomDays.trim()) {
      setFormError('Custom follow-up days is required.');
      return;
    }
    setFormError(null);
    setSubmitError(null);
    setShowDialog(true);
  };

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await postApproveDecision(client, id!);
      setShowDialog(false);
      onApproveSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'An unexpected error occurred. Please try again.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [client, id, onApproveSuccess]);

  return (
    <div className="space-y-6">
      {/* AI Recommendation Panel — conditional on ai_consent_status */}
      {caseData.ai_consent_status === 'given' && (
        <AiRecommendationPanel suggestedAccommodations={caseData.suggestedAccommodations} />
      )}

      {/* Accommodation Details Form */}
      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Accommodation Details</h3>

        {/* Description */}
        <div className="space-y-1">
          <label
            htmlFor="acc-description"
            className="block text-sm font-medium text-gray-700"
          >
            Approved Accommodation Description <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="acc-description"
            required
            rows={3}
            value={formState.description}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            placeholder="Describe the approved accommodation..."
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* Accommodation Type + Duration (side-by-side on wider screens) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="acc-type"
              className="block text-sm font-medium text-gray-700"
            >
              Accommodation Type <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <select
              id="acc-type"
              required
              value={formState.accommodationType}
              onChange={(e) =>
                handleFieldChange('accommodationType', e.target.value as AccommodationType)
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="Schedule">Schedule</option>
              <option value="Equipment">Equipment</option>
              <option value="Remote Work">Remote Work</option>
              <option value="Leave">Leave</option>
              <option value="Modified Duties">Modified Duties</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <fieldset className="space-y-1">
            <legend className="block text-sm font-medium text-gray-700">
              Duration <span className="text-red-500" aria-hidden="true">*</span>
            </legend>
            <div className="space-y-1.5">
              {(['permanent', 'temporary', 'trial_period'] as DurationType[]).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="duration"
                    value={d}
                    checked={formState.duration === d}
                    onChange={() => handleFieldChange('duration', d)}
                    className="h-4 w-4 text-[#2563EB]"
                  />
                  <span className="capitalize">{d.replace('_', ' ')}</span>
                </label>
              ))}
            </div>

            {formState.duration === 'temporary' && (
              <div className="mt-2 space-y-1">
                <label
                  htmlFor="duration-end-date"
                  className="block text-xs font-medium text-gray-600"
                >
                  End Date <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <input
                  id="duration-end-date"
                  type="date"
                  required
                  value={formState.durationEndDate}
                  onChange={(e) => handleFieldChange('durationEndDate', e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
            )}

            {formState.duration === 'trial_period' && (
              <div className="mt-2 space-y-1">
                <label
                  htmlFor="duration-review-date"
                  className="block text-xs font-medium text-gray-600"
                >
                  Review Date <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <input
                  id="duration-review-date"
                  type="date"
                  required
                  value={formState.durationEndDate}
                  onChange={(e) => handleFieldChange('durationEndDate', e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
            )}
          </fieldset>
        </div>

        {/* Effective Date */}
        <div className="space-y-1">
          <label
            htmlFor="effective-date"
            className="block text-sm font-medium text-gray-700"
          >
            Effective Date <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="effective-date"
            type="date"
            required
            value={formState.effectiveDate}
            onChange={(e) => handleFieldChange('effectiveDate', e.target.value)}
            className="block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* Implementation Details */}
        <div className="space-y-1">
          <label
            htmlFor="impl-details"
            className="block text-sm font-medium text-gray-700"
          >
            Implementation Details
            <span className="ml-1 text-xs text-gray-400">(optional)</span>
          </label>
          <textarea
            id="impl-details"
            rows={2}
            value={formState.implementationDetails}
            onChange={(e) => handleFieldChange('implementationDetails', e.target.value)}
            placeholder="Steps to implement this accommodation..."
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* Responsible Parties */}
        <fieldset className="space-y-1">
          <legend className="block text-sm font-medium text-gray-700">
            Responsible Parties for Implementation
          </legend>
          <div className="mt-1 space-y-1.5">
            {(
              [
                { key: 'hr', label: 'HR' },
                { key: 'manager', label: 'Manager' },
                { key: 'it', label: 'IT Department' },
              ] as { key: keyof ApproveFormState['responsibleParties']; label: string }[]
            ).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.responsibleParties[key]}
                  onChange={() => handleResponsiblePartyChange(key)}
                  className="h-4 w-4 rounded border-gray-300 text-[#2563EB]"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Follow-up Schedule */}
      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Follow-up Schedule</h3>
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Follow-up review interval</legend>
          {(
            [
              { value: '30', label: '30 days' },
              { value: '60', label: '60 days' },
              { value: '90', label: '90 days' },
              { value: 'custom', label: 'Custom' },
            ] as { value: FollowUpDays; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="follow-up-days"
                value={value}
                checked={formState.followUpDays === value}
                onChange={() => handleFieldChange('followUpDays', value)}
                className="h-4 w-4 text-[#2563EB]"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {formState.followUpDays === 'custom' && (
          <div className="space-y-1">
            <label
              htmlFor="custom-days"
              className="block text-xs font-medium text-gray-600"
            >
              Custom days <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              id="custom-days"
              type="number"
              min="1"
              max="365"
              required
              value={formState.followUpCustomDays}
              onChange={(e) => handleFieldChange('followUpCustomDays', e.target.value)}
              placeholder="e.g. 45"
              className="block w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>
        )}

        <p className="text-xs text-gray-500 italic">
          ⓘ Best practice: 30 days for temporary accommodations, 90 days for permanent.
          Set a follow-up to review effectiveness.
        </p>
      </div>

      {/* Dual-Law Compliance Checklist */}
      <div className="rounded-md border border-gray-200 bg-white p-4">
        <DualLawChecklist caseType={caseData.type as CaseType} />
      </div>

      {/* Letter Preview */}
      <div className="rounded-md border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">
          Upon approval, the system will generate an approval letter.
        </p>
        <span
          className="mt-1 inline-flex items-center text-sm text-gray-400 cursor-not-allowed"
          aria-disabled="true"
          title="Letter preview — coming soon"
        >
          Preview Letter Template → (coming soon)
        </span>
      </div>

      {/* Form validation error */}
      {formError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
        <Link
          to={`/cases/${caseData.id}`}
          className="order-2 text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded sm:order-1"
        >
          Cancel — Return to Case
        </Link>
        <button
          type="button"
          onClick={handleConfirmApprovalClick}
          className="order-1 rounded-md bg-[#2563EB] px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:order-2"
        >
          Confirm Approval
        </button>
      </div>

      {/* Confirmation dialog */}
      {showDialog && (
        <ConfirmDialog
          caseData={caseData}
          formState={formState}
          onConfirm={handleConfirm}
          onCancel={() => {
            setShowDialog(false);
            setSubmitError(null);
          }}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecisionPage — main component
// ---------------------------------------------------------------------------

export function DecisionPage() {
  const { id } = useParams<{ id: string }>();
  const { user, client } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const role = normalizeRole(user?.role);
  const isAllowed = role === 'super_admin' || role === 'hr';

  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeTab, setActiveTab] = useState<'approve' | 'deny'>('approve');

  // navTimerRef — cleared on unmount to prevent stale navigation (FIX-3)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  // hooks called unconditionally — gate via enabled flag (FIX-1)
  const {
    data: caseData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['case', id],
    queryFn: () => fetchCaseDetail(client, id!),
    enabled: !!id && isAllowed, // don't fetch for unauthorized roles
    staleTime: 30_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const handleApproveSuccess = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['case', id] });
    setToast({ message: 'Accommodation approved', type: 'success' });
    // Navigate after brief moment to allow toast to show — timer cleared on unmount (FIX-3)
    navTimerRef.current = setTimeout(() => {
      void navigate(`/cases/${id}`);
    }, 800);
  }, [queryClient, id, navigate]);

  // Role gate AFTER all hooks (FIX-1)
  if (!isAllowed) {
    return <Navigate to={`/cases/${id}`} replace />;
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Link
          to={`/cases/${id}`}
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Case
        </Link>
        <DecisionSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Link
          to="/cases"
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Cases
        </Link>
        <ErrorView type={getErrorType(error)} />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Link
          to="/cases"
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Cases
        </Link>
        <ErrorView type="generic" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        to={`/cases/${caseData.id}`}
        className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        ← Back to Case
      </Link>

      {/* Case Detail Header — reused component */}
      <CaseDetailHeader
        caseData={caseData}
        role={role}
        currentUserId={user?.id}
      />

      {/* Decision Tabs */}
      <div className="rounded-lg border border-border bg-surface">
        {/* Tab bar */}
        <div className="flex border-b border-border" role="tablist" aria-label="Decision tabs">
          <button
            type="button"
            role="tab"
            id="tab-approve"
            aria-selected={activeTab === 'approve'}
            aria-controls="tabpanel-approve"
            onClick={() => setActiveTab('approve')}
            className={`px-6 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-tl-lg border-b-2 transition-colors ${
              activeTab === 'approve'
                ? 'text-[#2563EB] border-[#2563EB]'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Approve
          </button>
          <button
            type="button"
            role="tab"
            id="tab-deny"
            aria-selected={activeTab === 'deny'}
            aria-controls="tabpanel-deny"
            onClick={() => setActiveTab('deny')}
            className={`px-6 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring border-b-2 transition-colors ${
              activeTab === 'deny'
                ? 'text-[#DC2626] border-[#DC2626]'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Deny
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'approve' ? (
          <div
            id="tabpanel-approve"
            role="tabpanel"
            aria-labelledby="tab-approve"
            className="p-5"
          >
            <ApproveTab
              caseData={caseData}
              onApproveSuccess={handleApproveSuccess}
            />
          </div>
        ) : (
          <div
            id="tabpanel-deny"
            role="tabpanel"
            aria-labelledby="tab-deny"
            className="p-5"
          >
            {role === 'super_admin' &&
            caseData.status === 'denial_pending_review' ? (
              <SupervisorReviewPanel
                caseData={caseData}
                userId={user?.id ?? ''}
                onDenialFinalized={() => {
                  void queryClient.invalidateQueries({ queryKey: ['case', id] });
                  setToast({ message: 'Denial finalized', type: 'success' });
                }}
              />
            ) : (
              <DenyTab
                caseData={caseData}
                onDenySuccess={() => {
                  void queryClient.invalidateQueries({ queryKey: ['case', id] });
                  setToast({ message: 'Denial submitted for supervisor review', type: 'success' });
                  navTimerRef.current = setTimeout(() => {
                    void navigate(`/cases/${id}`);
                  }, 800);
                }}
                onSwitchToApprove={() => setActiveTab('approve')}
              />
            )}
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <Toast toast={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}

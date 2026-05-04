/**
 * PwfaInterimPage — ACMD-148 Phase 6M / ACMD-157 Phase 7B
 *
 * URL: /cases/:id/pwfa-interim
 * Roles allowed: super_admin, hr, manager (view-only restricted)
 * Roles denied: medical_reviewer -> 403 via RoleGuard
 *
 * COMPLIANCE: 29 CFR 1630.14 — NO diagnosis or medical condition names shown.
 * Only accommodation type, functional restrictions summary, and interim status.
 * Manager sees even less — only that an interim exists, type, status, dates.
 *
 * 42 USC 2000gg-1(4) — Prohibition on forced leave
 * 42 USC 2000gg-2(f)(2) — Unnecessary delay as violation
 * 29 CFR 1636.4 — EEOC PWFA Final Rule (interim accommodations)
 *
 * ACMD-157: Real API via getInterimAccommodation + patchInterimAccommodation.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { DeadlineBadge } from '@/components/ui/DeadlineBadge';
import { getInterimAccommodation, patchInterimAccommodation } from '@/lib/api/interim';
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

type InterimStatus = 'active' | 'extended' | 'converted' | 'ended';
type InterimSource = 'ai' | 'manual' | 'employee';
type ReviewFrequency = 'weekly' | 'bi-weekly' | 'monthly';

interface InterimAccommodation {
  id: string;
  status: InterimStatus;
  type: string;
  description: string;
  source: InterimSource;
  confidence: number;
  startDate: string;
  expectedEndDate: string | null;
  nextReviewDate: string;
  reviewFrequency: ReviewFrequency;
  assignedReviewer: string;
  fullAccommodationGoal: string | null;
}

interface ReviewEntry {
  id: string;
  date: string;
  status: 'scheduled' | 'completed' | 'overdue';
  reviewer: string;
  notes: string | null;
}

interface TimelineEvent {
  date: string;
  time: string;
  actor: string;
  event: string;
  isMedical: boolean;
}

interface LeaveStatus {
  fmla: {
    active: boolean;
    weeksUsed: number;
    weeksTotal: number;
    startDate: string | null;
    estimatedEndDate: string | null;
  };
  pwfa: {
    onLeave: boolean;
    message: string;
  };
}

type ModalType = 'set' | 'extend' | 'convert' | 'end' | 'document' | null;

// ---------------------------------------------------------------------------
// Static scaffolding constants (compliance-static, not from API)
// ---------------------------------------------------------------------------

const STATIC_REVIEWS: ReviewEntry[] = [
  { id: 'rev-1', date: '2026-04-19', status: 'scheduled', reviewer: 'Sarah Kim', notes: null },
  {
    id: 'rev-setup',
    date: '2026-04-05',
    status: 'completed',
    reviewer: 'Sarah Kim',
    notes: 'Interim schedule modification set pending full ADA interactive process. Employee reports this addresses immediate need.',
  },
];

const STATIC_TIMELINE: TimelineEvent[] = [
  { date: '04/05', time: '10:30', actor: 'HR', event: 'Interim accommodation created: Temporary Schedule Mod', isMedical: false },
  { date: '04/05', time: '10:31', actor: 'SYSTEM', event: 'Manager notified: interim accommodation active', isMedical: false },
  { date: '04/05', time: '10:31', actor: 'SYSTEM', event: 'Review scheduled: 04/19/2026 (bi-weekly)', isMedical: false },
  { date: '04/03', time: '09:00', actor: 'HR', event: 'Case created — PWFA tagged', isMedical: false },
];

const STATIC_TIMELINE_NO_INTERIM: TimelineEvent[] = [
  { date: '03/25', time: '09:00', actor: 'HR', event: 'Case created — PWFA tagged', isMedical: false },
  { date: '03/30', time: '00:00', actor: 'SYSTEM', event: 'PWFA 5-day interim warning generated', isMedical: false },
  { date: '04/03', time: '00:00', actor: 'SYSTEM', event: 'PWFA 5-day interim warning — reminder #2', isMedical: false },
];

const STATIC_LEAVE: LeaveStatus = {
  fmla: {
    active: true,
    weeksUsed: 4,
    weeksTotal: 12,
    startDate: '2026-03-15',
    estimatedEndDate: '2026-06-07',
  },
  pwfa: {
    onLeave: false,
    message: 'PWFA prohibits forcing leave when accommodation is available. This employee is accommodated with schedule modification.',
  },
};

const INTERIM_TYPE_OPTIONS = [
  'Temporary schedule modification',
  'Temporary work-from-home',
  'Temporary duty reassignment',
  'Ergonomic equipment loan',
  'Additional breaks',
  'Temporary parking reassignment',
  'From AI/JAN suggestion (if available)',
  'Custom (describe below)',
];

const END_REASON_OPTIONS = [
  'Permanent accommodation approved (case resolved)',
  'Employee no longer needs accommodation (condition resolved)',
  'Employee request to discontinue',
  'Replaced by different interim accommodation',
  'Other',
];

const DOC_REASON_OPTIONS = [
  'Employee reports current duties are manageable during review',
  'Case expected to resolve within 1-2 business days',
  'Employee already has accommodation from a previous case',
  'Other',
];

const EMPLOYEE_CONFIRM_OPTIONS = [
  'verbal',
  'email',
  'unable',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Error view
// ---------------------------------------------------------------------------

function ErrorView({ type }: { type: '404' | '403' | 'generic' }) {
  const configs = {
    '404': { title: 'Case not found', message: "We couldn't find a case with that ID.", icon: '🔍' },
    '403': { title: 'Access denied', message: "You don't have permission to access this page.", icon: '🔒' },
    generic: { title: 'Something went wrong', message: 'We encountered an unexpected error. Please try again.', icon: '⚠️' },
  };
  const cfg = configs[type];
  return (
    <div role="alert" className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-12 text-center">
      <span className="text-4xl" aria-hidden="true">{cfg.icon}</span>
      <div>
        <h2 className="text-lg font-semibold text-text">{cfg.title}</h2>
        <p className="mt-1 text-sm text-text-muted max-w-md">{cfg.message}</p>
      </div>
      <Link
        to="/cases"
        className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to Cases
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
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
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '✕'}</span>
      <span>{toast.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="ml-2 opacity-75 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PWFA Compliance Banner
// ---------------------------------------------------------------------------

function PWFAComplianceBanner({ role }: { role: UserRole }) {
  const [expanded, setExpanded] = useState(false);

  if (role === 'manager') {
    return (
      <div data-testid="pwfa-compliance-banner" className="rounded-lg p-4 bg-[#DBEAFE] border-l-4 border-l-[#2563EB]">
        <p className="text-sm font-medium text-[#1E3A5F]">An accommodation process is underway for this employee.</p>
      </div>
    );
  }

  return (
    <div data-testid="pwfa-compliance-banner" className="rounded-lg p-4 space-y-2 bg-[#DBEAFE] border-l-4 border-l-[#2563EB]">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">🛡️</span>
        <h2 className="text-sm font-semibold text-[#1E3A5F]">PWFA Interim Accommodation</h2>
      </div>
      <p className="text-sm text-[#1E3A5F]">
        Under the PWFA (42 USC 2000gg-1), employers must provide interim accommodation while a case is pending. Failure to provide interim accommodation may constitute an unlawful delay.
      </p>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="text-xs font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded text-[#2563EB]"
      >
        {expanded ? 'Hide details ▲' : 'What is an interim accommodation? ▾'}
      </button>
      {expanded && (
        <div data-testid="pwfa-expanded-info" className="mt-2 rounded-md p-3 text-xs bg-[#EFF6FF] text-[#1E3A5F]">
          An interim accommodation is a temporary solution provided to an employee while the full interactive process (ADA/PWFA) is being completed. It ensures the employee is supported immediately without waiting for the full case resolution. PWFA guidelines recommend providing interim accommodation within 5 business days of receiving a request.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5-Day Warning Banner
// ---------------------------------------------------------------------------

function FiveDayWarningBanner({
  daysSinceRequest,
  onSetInterim,
  onDocumentNotNeeded,
}: {
  daysSinceRequest: number;
  onSetInterim: () => void;
  onDocumentNotNeeded: () => void;
}) {
  const isEscalated = daysSinceRequest > 10;
  const exceededBy = daysSinceRequest - 5;

  return (
    <div
      data-testid="five-day-warning-banner"
      role="alert"
      className={`rounded-lg p-4 space-y-3 ${isEscalated ? 'bg-[#991B1B] text-white' : 'bg-[#FEF2F2] text-[#991B1B]'}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-lg">⚠️</span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">WARNING: No interim accommodation set for this PWFA case</p>
          <p className="text-sm">
            This case has been pending for {daysSinceRequest} business days with no interim accommodation. Under PWFA (42 USC 2000gg-2(f)(2)), unnecessary delay in providing accommodation may constitute a violation.
          </p>
          <p className="text-sm font-medium">
            Days without interim: {daysSinceRequest} (exceeded 5 business day guideline by {exceededBy} days)
          </p>
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onSetInterim}
          data-testid="warning-set-interim-btn"
          className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white bg-[#2563EB]"
        >
          Set Interim Accommodation Now
        </button>
        <button
          type="button"
          onClick={onDocumentNotNeeded}
          data-testid="warning-document-btn"
          className={`rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 ${isEscalated ? 'border-white text-white' : 'border-[#991B1B] text-[#991B1B]'}`}
        >
          Document Why Not Needed
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Days Elapsed Counter
// ---------------------------------------------------------------------------

function DaysElapsedCounter({
  daysSinceRequest,
  interimProvidedDay,
}: {
  daysSinceRequest: number;
  interimProvidedDay: number | null;
}) {
  const withinGuideline = interimProvidedDay !== null && interimProvidedDay <= 5;

  return (
    <div data-testid="days-elapsed-counter" className="rounded-lg border border-border bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600">Days since request:</span>
        <span className="text-gray-800">{daysSinceRequest} business days</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600">Interim accommodation provided:</span>
        {interimProvidedDay !== null ? (
          <span className="flex items-center gap-1">
            <span>Day {interimProvidedDay}</span>
            <span className={withinGuideline ? 'text-green-600' : 'text-red-600'} aria-label={withinGuideline ? 'Within guideline' : 'Exceeded guideline'}>
              {withinGuideline ? '✓' : '✕'}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-red-600 font-medium" data-testid="no-interim-marker">
            <span aria-hidden="true">✕</span> NONE
          </span>
        )}
      </div>
      {interimProvidedDay !== null && (
        <div className="text-xs text-gray-500">
          Time to interim: {interimProvidedDay} business days ({withinGuideline ? 'within' : 'exceeded'} 5-day guideline)
        </div>
      )}
      {interimProvidedDay === null && (
        <div className="text-xs text-red-600 font-medium">
          Exceeded 5 business day guideline by {daysSinceRequest - 5} days
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

function Modal({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    firstFocusableRef.current?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Set Interim Modal
// ---------------------------------------------------------------------------

interface SetInterimForm {
  type: string;
  description: string;
  source: InterimSource;
  startDate: string;
  expectedEndDate: string;
  reviewDate: string;
  reviewFrequency: ReviewFrequency;
  assignedReviewer: string;
  fullAccommodationGoal: string;
}

function SetInterimModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (form: SetInterimForm) => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState<SetInterimForm>({
    type: '',
    description: '',
    source: 'manual',
    startDate: today,
    expectedEndDate: '',
    reviewDate: '',
    reviewFrequency: 'bi-weekly',
    assignedReviewer: '',
    fullAccommodationGoal: '',
  });
  const [errors, setErrors] = useState<string[]>([]);

  function validate(): string[] {
    const errs: string[] = [];
    if (!form.type) errs.push('Interim accommodation type is required.');
    if (!form.description || form.description.length < 10) errs.push('Description must be at least 10 characters.');
    if (!form.startDate) errs.push('Start date is required.');
    if (!form.reviewDate) errs.push('Review date is required.');
    if (!form.assignedReviewer) errs.push('Assigned reviewer is required.');
    return errs;
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onSubmit(form);
  }

  return (
    <Modal title="Set Interim Accommodation" isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md p-3 text-xs bg-[#EFF6FF] text-[#1E3A5F]">
          Provide an interim accommodation to support the employee while the full interactive process continues. Under PWFA, interim accommodation should be provided within 5 business days.
        </div>

        {errors.length > 0 && (
          <div role="alert" data-testid="set-interim-errors" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="interim-type" className="block text-sm font-medium text-gray-700">
            Interim Accommodation Type <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <select
            id="interim-type"
            aria-required="true"
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="">Select type...</option>
            {INTERIM_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="interim-desc" className="block text-sm font-medium text-gray-700">
            Description <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="interim-desc"
            aria-required="true"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Describe the interim accommodation (min 10 characters)"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
          />
          <p className="text-xs text-gray-400">{form.description.length}/10 characters minimum</p>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-gray-700">Source</legend>
          <div className="flex gap-4">
            {(['ai', 'manual', 'employee'] as InterimSource[]).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="interim-source"
                  value={s}
                  checked={form.source === s}
                  onChange={() => setForm((prev) => ({ ...prev, source: s }))}
                />
                {s === 'ai' ? 'AI Suggestion' : s === 'manual' ? 'Manual Entry' : 'Employee Request'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="interim-start" className="block text-sm font-medium text-gray-700">
              Start Date <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              type="date"
              id="interim-start"
              aria-required="true"
              value={form.startDate}
              onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="interim-end" className="block text-sm font-medium text-gray-700">
              Expected End Date
            </label>
            <input
              type="date"
              id="interim-end"
              value={form.expectedEndDate}
              onChange={(e) => setForm((prev) => ({ ...prev, expectedEndDate: e.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <p className="text-xs text-gray-400">Optional</p>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="interim-review-date" className="block text-sm font-medium text-gray-700">
            Review Date <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            type="date"
            id="interim-review-date"
            aria-required="true"
            value={form.reviewDate}
            onChange={(e) => setForm((prev) => ({ ...prev, reviewDate: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-gray-700">
            Review Frequency <span className="text-red-500" aria-hidden="true">*</span>
          </legend>
          <div className="flex gap-4">
            {(['weekly', 'bi-weekly', 'monthly'] as ReviewFrequency[]).map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="review-frequency"
                  value={f}
                  checked={form.reviewFrequency === f}
                  onChange={() => setForm((prev) => ({ ...prev, reviewFrequency: f }))}
                />
                {f === 'bi-weekly' ? 'Bi-weekly' : f.charAt(0).toUpperCase() + f.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="interim-reviewer" className="block text-sm font-medium text-gray-700">
            Assigned Reviewer <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <select
            id="interim-reviewer"
            aria-required="true"
            value={form.assignedReviewer}
            onChange={(e) => setForm((prev) => ({ ...prev, assignedReviewer: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="">Select reviewer...</option>
            <option value="Sarah Kim (HR)">Sarah Kim (HR)</option>
            <option value="Tom Baker (HR)">Tom Baker (HR)</option>
            <option value="Admin User (Super Admin)">Admin User (Super Admin)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="interim-goal" className="block text-sm font-medium text-gray-700">
            Full Accommodation Goal
          </label>
          <textarea
            id="interim-goal"
            rows={2}
            value={form.fullAccommodationGoal}
            onChange={(e) => setForm((prev) => ({ ...prev, fullAccommodationGoal: e.target.value }))}
            placeholder="What is the target permanent solution? (optional)"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
          <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            data-testid="set-interim-submit"
            className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] bg-[#2563EB]"
          >
            Set Interim Accommodation
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Extend Interim Modal
// ---------------------------------------------------------------------------

function ExtendInterimModal({
  isOpen,
  onClose,
  interim,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  interim: InterimAccommodation;
  onSubmit: () => void;
}) {
  const [newEndDate, setNewEndDate] = useState('');
  const [newReviewDate, setNewReviewDate] = useState('');
  const [reason, setReason] = useState('');
  const [keepFrequency, setKeepFrequency] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  function validate(): string[] {
    const errs: string[] = [];
    if (!newEndDate) errs.push('New expected end date is required.');
    if (!newReviewDate) errs.push('New review date is required.');
    if (reason.length < 20) errs.push('Reason for extension must be at least 20 characters.');
    return errs;
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onSubmit();
  }

  return (
    <Modal title="Extend Interim Accommodation" isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-1 text-sm text-gray-600">
          <p><span className="font-medium">Current Interim:</span> {interim.type}</p>
          <p><span className="font-medium">Current End Date:</span> {formatDate(interim.expectedEndDate)}</p>
          <p><span className="font-medium">Current Review Date:</span> {formatDate(interim.nextReviewDate)}</p>
        </div>

        {errors.length > 0 && (
          <div role="alert" data-testid="extend-errors" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="extend-end-date" className="block text-sm font-medium text-gray-700">
            New Expected End Date <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input type="date" id="extend-end-date" aria-required="true" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
        </div>

        <div className="space-y-1">
          <label htmlFor="extend-review-date" className="block text-sm font-medium text-gray-700">
            New Review Date <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input type="date" id="extend-review-date" aria-required="true" value={newReviewDate} onChange={(e) => setNewReviewDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
        </div>

        <div className="space-y-1">
          <label htmlFor="extend-reason" className="block text-sm font-medium text-gray-700">
            Reason for Extension <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea id="extend-reason" aria-required="true" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why extension is needed (min 20 characters)"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none" />
          <p className="text-xs text-gray-400">{reason.length}/20 characters minimum</p>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-gray-700">Keep Review Frequency?</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="radio" name="keep-freq" checked={keepFrequency} onChange={() => setKeepFrequency(true)} />
              Yes — {interim.reviewFrequency === 'bi-weekly' ? 'Bi-weekly' : interim.reviewFrequency.charAt(0).toUpperCase() + interim.reviewFrequency.slice(1)}
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="radio" name="keep-freq" checked={!keepFrequency} onChange={() => setKeepFrequency(false)} />
              Change frequency
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
          <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="button" onClick={handleSubmit} data-testid="extend-submit"
            className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] bg-[#2563EB]">
            Confirm Extension
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Convert to Permanent Modal
// ---------------------------------------------------------------------------

function ConvertToPermanentModal({ isOpen, onClose, interim, caseId }: {
  isOpen: boolean; onClose: () => void; interim: InterimAccommodation; caseId: string;
}) {
  const navigate = useNavigate();
  const [useAsIs, setUseAsIs] = useState(true);
  const daysSinceStart = Math.max(1, Math.round((Date.now() - new Date(interim.startDate).getTime()) / (1000 * 60 * 60 * 24)));

  function handleProceed() { navigate(`/cases/${caseId}/decision`); }

  return (
    <Modal title="Convert Interim to Permanent" isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md p-3 text-xs bg-[#EFF6FF] text-[#1E3A5F]">
          This will end the interim accommodation and create a permanent accommodation approval. You will be redirected to SCR-APPROVE to complete the formal approval process.
        </div>
        <div className="space-y-1 text-sm text-gray-600">
          <p><span className="font-medium">Current Interim:</span> {interim.type}</p>
          <p><span className="font-medium">Active Since:</span> {formatDate(interim.startDate)}</p>
          <p><span className="font-medium">Duration:</span> {daysSinceStart} days</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Convert current interim as-is to permanent?</legend>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="convert-option" checked={useAsIs} onChange={() => setUseAsIs(true)} className="mt-0.5" />
            <span>Yes — use interim details as permanent accommodation</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="convert-option" checked={!useAsIs} onChange={() => setUseAsIs(false)} className="mt-0.5" />
            <span>No — I want to modify the accommodation in SCR-APPROVE</span>
          </label>
        </fieldset>
        <div className="rounded-md p-3 text-xs bg-[#EFF6FF] text-[#1E3A5F]">
          The formal approval will generate an approval letter, notify the employee, and update the manager. The interim record will be marked as &quot;Converted to Permanent&quot; in the audit trail.
        </div>
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
          <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="button" onClick={handleProceed} data-testid="convert-proceed"
            className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] bg-[#2563EB]">
            Proceed to Approval (SCR-APPROVE)
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// End Interim Modal
// ---------------------------------------------------------------------------

function EndInterimModal({ isOpen, onClose, interim, onSubmit }: {
  isOpen: boolean; onClose: () => void; interim: InterimAccommodation; onSubmit: () => void;
}) {
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const hasPermanent = false; // Mock: no permanent accommodation in place

  function validate(): string[] {
    const errs: string[] = [];
    if (!reason) errs.push('Reason for ending is required.');
    if (reason === 'Other' && !otherReason) errs.push('Please specify the reason.');
    if (!hasPermanent && !confirmed) errs.push('You must confirm the employee no longer requires accommodation.');
    return errs;
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    onSubmit();
  }

  return (
    <Modal title="End Interim Accommodation" isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800" role="alert">
          <span className="font-medium">Warning:</span> Ending an interim accommodation for a PWFA case without a permanent accommodation in place may create compliance risk.
        </div>
        <div className="space-y-1 text-sm text-gray-600">
          <p><span className="font-medium">Current Interim:</span> {interim.type}</p>
          <p><span className="font-medium">Active Since:</span> {formatDate(interim.startDate)}</p>
        </div>
        {errors.length > 0 && (
          <div role="alert" data-testid="end-errors" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Reason for Ending <span className="text-red-500" aria-hidden="true">*</span></legend>
          {END_REASON_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="radio" name="end-reason" value={opt} checked={reason === opt} onChange={() => setReason(opt)} className="mt-0.5" />
              <span>{opt}</span>
            </label>
          ))}
          {reason === 'Other' && (
            <input type="text" value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Specify reason..."
              className="ml-6 w-[calc(100%-1.5rem)] rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
          )}
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="end-notes" className="block text-sm font-medium text-gray-700">Additional Notes</label>
          <textarea id="end-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none" />
        </div>
        {!hasPermanent && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
            <label className="flex items-start gap-2 text-sm text-yellow-800 cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="end-confirm-checkbox" className="mt-0.5" />
              <span>I confirm the employee no longer requires accommodation</span>
            </label>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
          <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="button" onClick={handleSubmit} data-testid="end-submit"
            className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 bg-[#DC2626]">
            End Interim
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Document Why Not Needed Modal
// ---------------------------------------------------------------------------

function DocumentNotNeededModal({ isOpen, onClose, onSubmit }: {
  isOpen: boolean; onClose: () => void; onSubmit: () => void;
}) {
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [confirmMethod, setConfirmMethod] = useState<typeof EMPLOYEE_CONFIRM_OPTIONS[number] | ''>('');
  const [verbalDate, setVerbalDate] = useState('');
  const [unableReason, setUnableReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  function validate(): string[] {
    const errs: string[] = [];
    if (!reason) errs.push('Reason is required.');
    if (reason === 'Other' && !otherReason) errs.push('Please specify the reason.');
    if (!confirmMethod) errs.push('Employee confirmation method is required.');
    if (confirmMethod === 'verbal' && !verbalDate) errs.push('Date of verbal confirmation is required.');
    if (confirmMethod === 'unable' && !unableReason) errs.push('Please document why confirmation could not be obtained.');
    return errs;
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    onSubmit();
  }

  return (
    <Modal title="Document: Interim Accommodation Not Needed" isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          This documentation is required for compliance purposes. If an interim accommodation becomes needed later, you can set one at any time from this screen.
        </div>
        {errors.length > 0 && (
          <div role="alert" data-testid="document-errors" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Reason <span className="text-red-500" aria-hidden="true">*</span></legend>
          {DOC_REASON_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="radio" name="doc-reason" value={opt} checked={reason === opt} onChange={() => setReason(opt)} className="mt-0.5" />
              <span>{opt}</span>
            </label>
          ))}
          {reason === 'Other' && (
            <input type="text" value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Specify reason..."
              className="ml-6 w-[calc(100%-1.5rem)] rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Employee Confirmation <span className="text-red-500" aria-hidden="true">*</span></legend>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="confirm-method" value="verbal" checked={confirmMethod === 'verbal'} onChange={() => setConfirmMethod('verbal')} className="mt-0.5" />
            <span>Employee verbally confirmed</span>
          </label>
          {confirmMethod === 'verbal' && (
            <div className="ml-6">
              <label htmlFor="verbal-date" className="block text-xs font-medium text-gray-600 mb-1">Date of confirmation</label>
              <input type="date" id="verbal-date" value={verbalDate} onChange={(e) => setVerbalDate(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="confirm-method" value="email" checked={confirmMethod === 'email'} onChange={() => setConfirmMethod('email')} className="mt-0.5" />
            <span>Employee confirmed via email (attach below)</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="confirm-method" value="unable" checked={confirmMethod === 'unable'} onChange={() => setConfirmMethod('unable')} className="mt-0.5" />
            <span>Unable to obtain employee confirmation</span>
          </label>
          {confirmMethod === 'unable' && (
            <div className="ml-6">
              <label htmlFor="unable-reason" className="block text-xs font-medium text-gray-600 mb-1">Document reason</label>
              <input type="text" id="unable-reason" value={unableReason} onChange={(e) => setUnableReason(e.target.value)}
                placeholder="Why confirmation could not be obtained..."
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
            </div>
          )}
        </fieldset>
        <button type="button" disabled className="rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-400 cursor-not-allowed w-full">
          Attach Confirmation Document (coming soon)
        </button>
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200">
          <button type="button" onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="button" onClick={handleSubmit} data-testid="document-submit"
            className="rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] bg-[#2563EB]">
            Save Documentation
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Leave Integration Panel
// ---------------------------------------------------------------------------

function LeaveIntegrationPanel({ leave }: { leave: LeaveStatus }) {
  const fmlaRemaining = leave.fmla.weeksTotal - leave.fmla.weeksUsed;
  const fmlaEndDate = leave.fmla.estimatedEndDate;
  let fmlaExpiringWarning = false;
  if (fmlaEndDate) {
    const daysToEnd = Math.round((new Date(fmlaEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    fmlaExpiringWarning = daysToEnd < 14 && daysToEnd > 0;
  }

  return (
    <section data-testid="leave-integration-panel" className="rounded-lg border border-border bg-surface p-4 space-y-3" aria-label="Leave Integration">
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Concurrent Leave Status</h2>
      <div className="rounded-md border border-gray-200 p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">FMLA Leave</span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${leave.fmla.active ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>
            {leave.fmla.active ? 'ACTIVE' : 'Not Active'}
          </span>
        </div>
        {leave.fmla.active && (
          <>
            <p className="text-xs text-gray-600">{leave.fmla.weeksUsed} of {leave.fmla.weeksTotal} weeks used — {fmlaRemaining} weeks remaining</p>
            {leave.fmla.startDate && <p className="text-xs text-gray-500">Start: {formatDate(leave.fmla.startDate)} — Estimated End: {formatDate(leave.fmla.estimatedEndDate)}</p>}
            {fmlaExpiringWarning && <p className="text-xs text-red-600 font-medium" data-testid="fmla-expiring-warning">Leave expiring soon — action needed before leave expiration</p>}
          </>
        )}
      </div>
      <div className="rounded-md border border-gray-200 p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">PWFA Leave</span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${leave.pwfa.onLeave ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            {leave.pwfa.onLeave ? 'On Leave' : 'Not on PWFA leave'}
          </span>
        </div>
        <p className="text-xs text-gray-600">{leave.pwfa.message}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Review History
// ---------------------------------------------------------------------------

function ReviewHistory({ reviews }: { reviews: ReviewEntry[] }) {
  return (
    <section data-testid="review-history" className="rounded-lg border border-border bg-surface p-4 space-y-3" aria-label="Review History">
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Review History</h2>
      {reviews.length === 0 ? (
        <p className="text-sm text-gray-400">No reviews recorded.</p>
      ) : (
        <ul role="list" className="space-y-2">
          {reviews.map((rev) => (
            <li key={rev.id} className="rounded-md border border-gray-200 p-3 space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{rev.id === 'rev-setup' ? 'Setup' : `Review #${rev.id.replace('rev-', '')}`} — {formatDate(rev.date)}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  rev.status === 'completed' ? 'bg-green-100 text-green-800' :
                  rev.status === 'overdue' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {rev.status.charAt(0).toUpperCase() + rev.status.slice(1)}
                </span>
              </div>
              <p className="text-xs text-gray-600">Reviewer: {rev.reviewer}</p>
              {rev.notes && <p className="text-xs text-gray-500 italic">{rev.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Timeline Panel
// ---------------------------------------------------------------------------

function InterimTimelinePanel({ events, caseId, isManager }: {
  events: TimelineEvent[]; caseId: string; isManager: boolean;
}) {
  const filtered = isManager ? events.filter((e) => !e.isMedical) : events;
  return (
    <section data-testid="timeline-panel" className="rounded-lg border border-border bg-surface p-4 space-y-3" aria-label="Timeline">
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Recent Events</h2>
      <ul role="list" className="space-y-1.5">
        {filtered.map((evt, i) => (
          <li key={i} className="text-xs text-gray-600">
            <span className="text-gray-400">{evt.date} {evt.time}</span>{' '}
            <span className="font-medium text-gray-500">[{evt.actor}]</span>{' '}
            {evt.event}
          </li>
        ))}
      </ul>
      <Link to={`/cases/${caseId}/timeline`} className="text-xs font-medium text-[#2563EB] hover:underline">
        View Full Timeline →
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PwfaInterimSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading interim accommodation"
      className="space-y-4 animate-pulse"
    >
      <div className="rounded-lg border border-border bg-surface p-4 h-10" />
      <div className="rounded-lg border border-border bg-surface p-4 h-16" />
      <div className="rounded-lg border border-border bg-surface p-4 h-24" />
      <div className="rounded-lg border border-border bg-surface p-4 h-48" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PwfaInterimPage
// ---------------------------------------------------------------------------

export function PwfaInterimPage() {
  const { id: caseId } = useParams<{ id: string }>();
  const { user, client } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = normalizeRole(user?.role);

  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [devHasInterim, setDevHasInterim] = useState<boolean | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  // Fetch interim accommodation from real API
  const {
    data: interimData,
    isLoading: isInterimLoading,
    isError: isInterimError,
    error: interimError,
  } = useQuery({
    queryKey: ['interim-accommodation', caseId],
    queryFn: () => getInterimAccommodation(client!, caseId!),
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

  // Fetch case detail for deadline and case-level info
  const {
    data: caseDetail,
    isLoading: isCaseLoading,
    isError: isCaseError,
    error: caseError,
  } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => fetchCaseDetail(client!, caseId!),
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

  // 401 redirect
  useEffect(() => {
    const err401 = (e: unknown) =>
      typeof e === 'object' && e !== null && 'status' in e && (e as { status: number }).status === 401;
    if (err401(interimError) || err401(caseError)) {
      navigate('/login');
    }
  }, [interimError, caseError, navigate]);

  if (!caseId) return <ErrorView type="404" />;

  // Loading state
  if (isInterimLoading || isCaseLoading) {
    return <PwfaInterimSkeleton />;
  }

  // Error state
  if (isInterimError || isCaseError) {
    return (
      <div className="space-y-4" data-testid="pwfa-interim-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">Could not load interim accommodation</h2>
            <p className="mt-1 text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['interim-accommodation', caseId] })}
            className="mt-2 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Resolve hasInterim: dev toggle overrides API data (DEV only)
  const apiHasInterim = interimData?.hasInterim ?? false;
  const hasInterim = devHasInterim !== null ? devHasInterim : apiHasInterim;

  // Build an interim-like object from API data for modals (falls back to scaffold if no API data)
  const apiInterim = interimData?.interim;
  const interimForModal: InterimAccommodation = {
    id: 'interim-api',
    status: (apiInterim?.status as InterimStatus | undefined) ?? 'active',
    type: apiInterim?.description ?? 'Interim Accommodation',
    description: apiInterim?.description ?? '',
    source: 'manual',
    confidence: 0,
    startDate: apiInterim?.offeredAt ?? new Date().toISOString().split('T')[0],
    expectedEndDate: null,
    nextReviewDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reviewFrequency: 'bi-weekly',
    assignedReviewer: 'HR',
    fullAccommodationGoal: null,
  };

  // PATCH action handler — calls real API + invalidates cache
  async function handlePatchAction(action: 'end' | 'convert' | 'update_description', opts?: { description?: string; reason?: string }) {
    if (!client || !caseId) return;
    try {
      await patchInterimAccommodation(client, caseId, { action, ...opts });
      await queryClient.invalidateQueries({ queryKey: ['interim-accommodation', caseId] });
      if (action === 'end') {
        setDevHasInterim(false);
        showToast('Interim accommodation ended.');
      } else if (action === 'convert') {
        showToast('Interim accommodation converted to permanent.');
      } else {
        showToast('Interim accommodation updated.');
      }
    } catch {
      showToast('Action failed. Please try again.', 'error');
    }
  }

  const deadlineIso = caseDetail?.deadline ?? null;
  const daysSinceRequest = hasInterim ? 8 : 12;
  const interimProvidedDay = hasInterim ? 2 : null;

  // Leave: use STATIC_LEAVE as scaffold (no leave API endpoint yet)
  const leave = STATIC_LEAVE;

  // Manager restricted view
  if (role === 'manager') {
    return (
      <div className="space-y-4" data-testid="pwfa-interim-page">
        <Link to={`/cases/${caseId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          data-testid="back-to-case">
          ← Back to Case
        </Link>
        <section className="rounded-lg border border-border bg-surface p-4 space-y-2" aria-label="Case information">
          <p className="text-xs text-gray-500 font-mono">{caseId}</p>
          <p className="text-sm text-gray-600">Status: In Progress</p>
        </section>
        <PWFAComplianceBanner role={role} />
        <section className="rounded-lg border border-border bg-surface p-4 space-y-3" aria-label="Interim accommodation summary" data-testid="manager-interim-view">
          {hasInterim ? (
            <>
              <p className="text-sm text-gray-700">An interim accommodation is in place for this employee.</p>
              <dl className="space-y-2 text-sm">
                <div className="flex gap-2"><dt className="font-medium text-gray-600">Description:</dt><dd className="text-gray-800">{apiInterim?.description ?? 'Schedule modification'}</dd></div>
                <div className="flex gap-2"><dt className="font-medium text-gray-600">Status:</dt><dd><span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Active</span></dd></div>
                {apiInterim?.offeredAt && (
                  <div className="flex gap-2"><dt className="font-medium text-gray-600">Since:</dt><dd className="text-gray-800">{formatDate(apiInterim.offeredAt)}</dd></div>
                )}
              </dl>
              <p className="text-xs text-gray-500 italic">For questions about implementation, contact HR.</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">No interim accommodation information is available at this time. Contact HR for details.</p>
          )}
        </section>
        <InterimTimelinePanel events={hasInterim ? STATIC_TIMELINE : STATIC_TIMELINE_NO_INTERIM} caseId={caseId} isManager={true} />
      </div>
    );
  }

  // HR / Admin full view
  return (
    <div className="space-y-4" data-testid="pwfa-interim-page">
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
      <Link to={`/cases/${caseId}`}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        data-testid="back-to-case">
        ← Back to Case
      </Link>

      <DeadlineBadge deadline={deadlineIso} />

      {!hasInterim && (
        <FiveDayWarningBanner daysSinceRequest={daysSinceRequest} onSetInterim={() => setActiveModal('set')} onDocumentNotNeeded={() => setActiveModal('document')} />
      )}

      <PWFAComplianceBanner role={role} />

      <section className="rounded-lg border border-border bg-surface p-4 space-y-3" aria-label="Case header">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 font-mono">{caseId}</p>
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            {hasInterim ? 'Approved Interim' : 'Interactive'}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">ADA</span>
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">PWFA</span>
        </div>
        <div className="text-xs text-gray-500 italic">
          Restrictions Summary: Needs modified schedule and additional breaks (NO diagnosis shown — per 29 CFR 1630.14)
        </div>
      </section>

      <DaysElapsedCounter daysSinceRequest={daysSinceRequest} interimProvidedDay={interimProvidedDay} />

      {hasInterim ? (
        <section className="rounded-lg border border-border bg-surface p-4 space-y-4" aria-label="Active interim accommodation" data-testid="active-interim-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1E3A5F]">Active Interim Accommodation</h2>
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">ACTIVE</span>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div className="sm:col-span-2"><dt className="text-gray-500 font-medium">Description</dt><dd className="text-gray-800">{apiInterim?.description ?? '—'}</dd></div>
            {apiInterim?.offeredAt && (
              <div><dt className="text-gray-500 font-medium">Started</dt><dd className="text-gray-800">{formatDate(apiInterim.offeredAt)}</dd></div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200" data-testid="interim-actions">
            <button type="button" onClick={() => setActiveModal('extend')} data-testid="extend-btn" className="rounded-md border border-[#2563EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">Extend Interim</button>
            <button type="button" onClick={() => setActiveModal('convert')} data-testid="convert-btn" className="rounded-md border border-[#2563EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">Convert to Permanent</button>
            <button type="button" onClick={() => setActiveModal('end')} data-testid="end-btn" className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">End Interim</button>
            <button type="button" disabled aria-disabled="true" title="Log Notes — coming in future phase" className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-400 cursor-not-allowed">Log Notes</button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-surface p-8 text-center space-y-4" aria-label="No interim accommodation" data-testid="no-interim-empty-state">
          <div className="text-4xl" aria-hidden="true">⏰</div>
          <p className="text-sm text-gray-700">No interim accommodation has been set for this case.</p>
          <p className="text-xs text-gray-500">PWFA best practice: provide interim accommodation within 5 business days of receiving a request, even while the full interactive process is ongoing.</p>
          <button type="button" onClick={() => setActiveModal('set')} data-testid="set-interim-btn"
            className="rounded-md px-6 py-2.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] bg-[#2563EB]">
            Set Interim Accommodation
          </button>
        </section>
      )}

      <LeaveIntegrationPanel leave={leave} />
      <ReviewHistory reviews={STATIC_REVIEWS} />
      <InterimTimelinePanel events={hasInterim ? STATIC_TIMELINE : STATIC_TIMELINE_NO_INTERIM} caseId={caseId} isManager={false} />

      {import.meta.env.DEV && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-center">
          <p className="text-xs text-gray-400 mb-2">Development: Toggle mock state</p>
          <button type="button" onClick={() => setDevHasInterim((prev) => !(prev !== null ? prev : apiHasInterim))} data-testid="toggle-interim-state"
            className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100">
            {hasInterim ? 'Switch to "No Interim" state' : 'Switch to "Active Interim" state'}
          </button>
        </div>
      )}

      <SetInterimModal isOpen={activeModal === 'set'} onClose={() => setActiveModal(null)}
        onSubmit={() => { setActiveModal(null); setDevHasInterim(true); showToast('Interim accommodation created successfully.'); }} />

      {hasInterim && (
        <>
          <ExtendInterimModal isOpen={activeModal === 'extend'} onClose={() => setActiveModal(null)} interim={interimForModal}
            onSubmit={() => { setActiveModal(null); showToast('Interim accommodation extended successfully.'); }} />
          <ConvertToPermanentModal isOpen={activeModal === 'convert'} onClose={() => setActiveModal(null)} interim={interimForModal} caseId={caseId} />
          <EndInterimModal isOpen={activeModal === 'end'} onClose={() => setActiveModal(null)} interim={interimForModal}
            onSubmit={() => { setActiveModal(null); void handlePatchAction('end'); }} />
        </>
      )}

      <DocumentNotNeededModal isOpen={activeModal === 'document'} onClose={() => setActiveModal(null)}
        onSubmit={() => { setActiveModal(null); showToast('Documentation saved successfully.'); }} />
    </div>
  );
}

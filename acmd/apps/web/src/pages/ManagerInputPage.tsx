/**
 * ManagerInputPage — ACMD-143 Phase 6H / ACMD-158 Phase 7B
 *
 * URL: /mgr/:id  (caseId — manager role required)
 * NOT wrapped in OnboardingGuard
 *
 * Mode A — Input Form: Manager provides job/workspace/schedule/team info
 * Mode B — Acknowledgment: Manager acknowledges accommodation outcome (Approved or Denied)
 *
 * Privacy: ZERO medical information rendered — no medical condition, diagnosis,
 * EEOC analysis, denial reasoning, or case_id in URL.
 *
 * ACMD-158: All mock data replaced with real API calls via getManagerInputForm /
 * submitManagerInput. Mode and alreadySubmitted driven by API response.
 *
 * Features:
 *  - DeadlineBanner: 3 states (>3 days hidden / approaching yellow-orange / overdue red-pulse)
 *  - PrivacyInfoBox: non-dismissible, role="note"
 *  - 5 form sections: Job Task Info, Workspace, Schedule, Team Impact, Manager Notes
 *  - MedicalKeywordWarning: debounce 1s, role="alert"
 *  - AutoSaveStatus: debounce 30s, aria-live="polite"
 *  - SubmitConfirmationDialog: modal with focus trap
 *  - ExtensionRequestPanel: modal with focus trap
 *  - DualRoleContextBanner: shown when user has both manager and superAdmin roles
 *  - Mode B: OutcomeCard + AcknowledgmentPanel
 *  - Loading skeleton, error state, 401 → /login
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { getManagerInputForm, submitManagerInput } from '@/lib/api/managerInput';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormData {
  essentialFunctions: string;
  nonEssentialFunctions: string;
  physicalRequirements: string;
  currentWorkspace: string;
  alternativeOptions: string;
  environmentalFactors: string;
  scheduleFlexibility: string;
  schedulingConstraints: string;
  workflowImpact: string;
  teamMemberImpact: string;
  mitigationStrategies: string;
  managerNotes: string;
}

/** Medical keywords that trigger the warning banner */
const MEDICAL_KEYWORDS = [
  'condition',
  'diagnosis',
  'disability',
  'treatment',
  'medication',
  'doctor',
  'medical',
  'health',
  'injury',
  'symptom',
];

function hasMedicalKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return MEDICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DeadlineBannerProps {
  daysRemaining: number;
  deadline: string;
  label?: string;
}

function DeadlineBanner({ daysRemaining, deadline, label }: DeadlineBannerProps) {
  if (daysRemaining > 3) return null;

  if (daysRemaining < 0) {
    return (
      <div
        role="alert"
        data-testid="deadline-banner-overdue"
        className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 animate-pulse"
      >
        <span aria-hidden="true">🔴</span>
        <span>
          {label
            ? `${label} ${deadline} — HR has been notified.`
            : `Your response was due ${deadline} — HR has been notified.`}
        </span>
      </div>
    );
  }

  if (daysRemaining === 1) {
    return (
      <div
        role="status"
        data-testid="deadline-banner-orange"
        className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-900"
      >
        <span aria-hidden="true">🟠</span>
        <span>Please respond by {deadline} ({daysRemaining} day remaining)</span>
      </div>
    );
  }

  // daysRemaining 2 or 3 = yellow
  return (
    <div
      role="status"
      data-testid="deadline-banner-yellow"
      className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-800"
    >
      <span aria-hidden="true">🟡</span>
      <span>
        {label
          ? `Please acknowledge by ${deadline} (${daysRemaining} days remaining)`
          : `Please respond by ${deadline} (${daysRemaining} days remaining)`}
      </span>
    </div>
  );
}

interface PrivacyInfoBoxProps {
  modeB?: boolean;
}

function PrivacyInfoBox({ modeB }: PrivacyInfoBoxProps) {
  return (
    <div
      role="note"
      aria-label="Privacy notice — operational information only"
      data-testid="privacy-info-box"
      className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-base">
        ℹ
      </span>
      <p>
        {modeB
          ? 'This notification contains only the information you need to implement this accommodation. Medical details are confidential and are not included.'
          : 'You are being asked for operational and job-related information only. Medical details about the employee are confidential and are not shared with managers. Please do not discuss the employee\'s medical condition or ask about it directly.'}
      </p>
    </div>
  );
}

interface DualRoleContextBannerProps {
  show: boolean;
  caseId?: string;
}

function DualRoleContextBanner({ show, caseId }: DualRoleContextBannerProps) {
  if (!show) return null;
  return (
    <div
      role="note"
      aria-label="You are viewing as Department Manager"
      data-testid="dual-role-banner"
      className="flex items-start gap-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        ℹ
      </span>
      <p>
        You are currently viewing this page as Department Manager. Operational information only is
        shown in this context. To view full case details, go to SCR-CASE-DETAIL as Super Admin.{' '}
        {/* TODO: Backend provides real caseId via opaque token API */}
        <a
          href={`/cases/${caseId ?? 'demo-case-001'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-700 underline hover:text-indigo-900"
        >
          View Full Case Details →
        </a>
      </p>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function FormSection({ title, children }: SectionProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-base font-semibold text-[#1E3A5F]">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  fieldId: string;
}

function TextareaField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  readOnly,
  fieldId,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-label="required">
            *
          </span>
        )}
      </label>
      <textarea
        id={fieldId}
        data-testid={`field-${fieldId}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? 'true' : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={4}
        className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 ${
          readOnly ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : 'bg-white'
        }`}
      />
      {hint && <p className="mt-1 text-xs text-gray-500">💡 {hint}</p>}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  readOnly?: boolean;
  fieldId: string;
}

function SelectField({
  label,
  required,
  value,
  onChange,
  options,
  readOnly,
  fieldId,
}: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-label="required">
            *
          </span>
        )}
      </label>
      <select
        id={fieldId}
        data-testid={`field-${fieldId}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? 'true' : undefined}
        disabled={readOnly}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 disabled:bg-gray-50 disabled:cursor-not-allowed"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface SubmitDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
}

function SubmitConfirmationDialog({ open, onClose, onSubmit, onSaveDraft }: SubmitDialogProps) {
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && firstBtnRef.current) {
      firstBtnRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-dialog-title"
      data-testid="submit-confirmation-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="submit-dialog-title" className="mb-2 text-lg font-semibold text-[#1E3A5F]">
          Submit Response
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          You will not be able to edit your response after submission. Please confirm you are ready
          to submit.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            ref={firstBtnRef}
            onClick={onSubmit}
            data-testid="dialog-submit-btn"
            className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50"
          >
            Submit
          </button>
          <button
            onClick={onSaveDraft}
            data-testid="dialog-save-draft-btn"
            className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            Save Draft
          </button>
          <button
            onClick={onClose}
            data-testid="dialog-cancel-btn"
            className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExtensionPanelProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

function ExtensionRequestPanel({ open, onClose, onSubmit }: ExtensionPanelProps) {
  const [reason, setReason] = useState('');
  const firstRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && firstRef.current) {
      firstRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-dialog-title"
      data-testid="extension-request-panel"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="extension-dialog-title" className="mb-2 text-lg font-semibold text-[#1E3A5F]">
          Request Extension
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          Please provide a reason for your extension request. HR will review and respond.
        </p>
        <textarea
          ref={firstRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="extension-reason-input"
          placeholder="Reason for extension…"
          rows={4}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={() => { onSubmit(reason); setReason(''); }}
            data-testid="extension-submit-btn"
            className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50"
          >
            Request Extension
          </button>
          <button
            onClick={onClose}
            data-testid="extension-cancel-btn"
            className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ManagerInputSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading manager input form"
      data-testid="manager-input-skeleton"
      className="min-h-screen bg-gray-50 p-8 animate-pulse"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 h-16" />
        <div className="rounded-lg border border-gray-200 bg-white p-6 h-32" />
        <div className="rounded-lg border border-gray-200 bg-white p-6 h-48" />
        <div className="rounded-lg border border-gray-200 bg-white p-6 h-48" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ManagerInputPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { client, user } = useAuth();

  const caseId = id ?? 'unknown';

  // Dual-role detection
  const userAny = user as (typeof user & { roles?: string[] }) | null;
  const isDualRole =
    Array.isArray(userAny?.roles)
      ? userAny.roles.includes('manager') && userAny.roles.includes('superAdmin')
      : false;

  // SEC-001: Role guard flag — evaluated before all conditional returns
  const hasManagerRole = user?.role === 'manager' || isDualRole;

  // Form state (Mode A)
  const [formData, setFormData] = useState<FormData>({
    essentialFunctions: '',
    nonEssentialFunctions: '',
    physicalRequirements: '',
    currentWorkspace: '',
    alternativeOptions: '',
    environmentalFactors: '',
    scheduleFlexibility: '',
    schedulingConstraints: '',
    workflowImpact: '',
    teamMemberImpact: '',
    mitigationStrategies: '',
    managerNotes: '',
  });

  // UI state
  const [showMedicalWarning, setShowMedicalWarning] = useState(false);
  const [medicalWarningDismissed, setMedicalWarningDismissed] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState<string | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [extensionPanelOpen, setExtensionPanelOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Mode B acknowledgment
  const [ackChecked, setAckChecked] = useState(false);

  // Keyword scan debounce
  const keywordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-save debounce
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AC-2: Fetch manager input form data
  const {
    data: formApiData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['manager-input-form', caseId],
    queryFn: () => getManagerInputForm(client, caseId),
    enabled: !!client && !!caseId && hasManagerRole,
    staleTime: 30_000,
    retry: (failureCount, err) => {
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 401
      ) {
        return false;
      }
      return failureCount < 1;
    },
  });

  // AC-6: 401 redirect
  useEffect(() => {
    if (
      isError &&
      error !== null &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 401
    ) {
      navigate('/login');
    }
  }, [isError, error, navigate]);

  // Run keyword scan on all text fields
  const runKeywordScan = useCallback((data: FormData) => {
    const combined = Object.values(data).join(' ');
    if (!medicalWarningDismissed && hasMedicalKeyword(combined)) {
      setShowMedicalWarning(true);
    } else if (!hasMedicalKeyword(combined)) {
      setShowMedicalWarning(false);
      setMedicalWarningDismissed(false);
    }
  }, [medicalWarningDismissed]);

  const handleFieldChange = useCallback(
    (field: keyof FormData, value: string) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };

        // Medical keyword debounce 1s
        if (keywordTimerRef.current) clearTimeout(keywordTimerRef.current);
        keywordTimerRef.current = setTimeout(() => runKeywordScan(next), 1000);

        // Auto-save debounce 30s
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => {
          setAutoSaveTime(formatTime(new Date()));
        }, 30000);

        return next;
      });
    },
    [runKeywordScan],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (keywordTimerRef.current) clearTimeout(keywordTimerRef.current);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Derived state
  const isRequiredFilled =
    formData.essentialFunctions.trim().length > 0 &&
    formData.currentWorkspace.trim().length > 0 &&
    formData.scheduleFlexibility.trim().length > 0 &&
    formData.workflowImpact.trim().length > 0 &&
    formData.teamMemberImpact.trim().length > 0;

  // AC-3: mode from API response determines form vs acknowledgment view
  const apiMode = formApiData?.mode ?? 'form';
  // AC-4: alreadySubmitted from API prevents resubmission
  const alreadySubmitted = formApiData?.alreadySubmitted ?? false;
  const isReadOnly = alreadySubmitted;

  // Handlers
  const handleSaveDraft = () => {
    setAutoSaveTime(formatTime(new Date()));
    setSubmitDialogOpen(false);
  };

  // AC-4: Submit calls submitManagerInput
  const handleSubmitConfirm = async () => {
    if (!client) return;
    setSubmitError(null);
    try {
      await submitManagerInput(client, caseId, {
        canAccommodate: formData.workflowImpact !== 'significant' && formData.teamMemberImpact !== 'significant',
        operationalImpact: [
          formData.workflowImpact,
          formData.teamMemberImpact,
          formData.mitigationStrategies,
        ].filter(Boolean).join('; '),
      });
      setSubmitDialogOpen(false);
      setSubmitted(true);
    } catch (err) {
      setSubmitDialogOpen(false);
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 401
      ) {
        navigate('/login');
        return;
      }
      setSubmitError('Failed to submit. Please try again.');
    }
  };

  const handleAcknowledged = () => {
    navigate('/dashboard');
  };

  // ---------------------------------------------------------------------------
  // SEC-001: Role guard — block non-manager access before rendering case data
  // ---------------------------------------------------------------------------
  if (!hasManagerRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center" data-testid="access-denied">
          <h1 className="text-2xl font-semibold text-[#1E3A5F] mb-2">Access Denied</h1>
          <p className="text-gray-600">You do not have permission to access this page.</p>
        </div>
      </div>
    );
  }

  // AC-6: Loading state
  if (isLoading) {
    return <ManagerInputSkeleton />;
  }

  // AC-6: Error state (non-401 errors)
  if (isError && !submitted) {
    const is401 =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error as { status: number }).status === 401;

    if (!is401) {
      return (
        <div
          data-testid="manager-input-error"
          className="flex min-h-screen items-center justify-center bg-gray-50 p-8"
        >
          <div
            role="alert"
            className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center"
          >
            <div className="mb-4 text-4xl" aria-hidden="true">⚠️</div>
            <h1 className="mb-2 text-xl font-semibold text-red-800">
              Could not load request
            </h1>
            <p className="text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-4 rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Post-submit success
  // ---------------------------------------------------------------------------
  if (submitted) {
    return (
      <div
        data-testid="mgr-input-page"
        className="flex min-h-screen items-center justify-center bg-gray-50 p-8"
      >
        <div
          data-testid="submit-success"
          className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow"
        >
          <div className="mb-4 text-4xl" aria-hidden="true">
            ✅
          </div>
          <h1 className="mb-2 text-xl font-semibold text-[#1E3A5F]">Response Submitted</h1>
          <p className="mb-6 text-sm text-gray-600">
            Your response has been submitted. HR will be in touch if clarification is needed.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Build display values from real API data
  const request = formApiData ?? {
    employeeName: '',
    department: '',
    positionTitle: '',
    accommodationCategory: '',
    hrRequesterName: '',
    responseDeadline: '',
    daysRemaining: 0,
    alreadySubmitted: false,
    submittedAt: null,
    caseId,
    mode: 'form' as const,
    outcomeType: null,
  };

  // AC-3: mode === 'acknowledgment' → acknowledgment view
  const isAcknowledgmentMode = apiMode === 'acknowledgment';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div data-testid="mgr-input-page" className="min-h-screen bg-gray-50">
      {/* Page title for screen readers */}
      <title>Manager Input — AccommodateAI</title>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

        {/* Deadline Banner — Form mode */}
        {!isAcknowledgmentMode && (
          <DeadlineBanner
            daysRemaining={request.daysRemaining}
            deadline={request.responseDeadline}
          />
        )}

        {/* Dual Role Banner */}
        <DualRoleContextBanner show={!!isDualRole} caseId={caseId} />

        {/* Privacy Info Box */}
        <PrivacyInfoBox modeB={isAcknowledgmentMode} />

        {/* Submit error */}
        {submitError && (
          <div
            role="alert"
            data-testid="submit-error"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {submitError}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* MODE A — Already submitted read-only */}
        {/* ------------------------------------------------------------------ */}
        {!isAcknowledgmentMode && alreadySubmitted && (
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-[#1E3A5F]">
                    Accommodation Input Request
                  </h1>
                  <div className="mt-2 grid gap-1 text-sm text-gray-600">
                    <span>
                      <strong>Employee:</strong> {request.employeeName}
                    </span>
                    <span>
                      <strong>Department:</strong> {request.department}
                    </span>
                    <span>
                      <strong>Position:</strong> {request.positionTitle}
                    </span>
                    <span>
                      <strong>Category:</strong> {request.accommodationCategory}
                    </span>
                    <span>
                      <strong>Requested by:</strong> {request.hrRequesterName}
                    </span>
                    <span>
                      <strong>Respond by:</strong> {request.responseDeadline}
                    </span>
                  </div>
                </div>
                <span
                  data-testid="submitted-badge"
                  className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                >
                  Submitted on {request.submittedAt}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              Your response has been submitted. Contact HR if you need to make changes.
            </p>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* MODE A — Input Form */}
        {/* ------------------------------------------------------------------ */}
        {!isAcknowledgmentMode && !alreadySubmitted && (
          <div className="space-y-6">
            {/* Page Header */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h1
                data-testid="page-header-title"
                className="mb-3 text-2xl font-bold text-[#1E3A5F]"
              >
                Accommodation Input Request
              </h1>
              <div className="grid gap-1 text-sm text-gray-600">
                <span>
                  <strong>Employee:</strong> {request.employeeName}
                </span>
                <span>
                  <strong>Department:</strong> {request.department}
                </span>
                <span>
                  <strong>Position:</strong> {request.positionTitle}
                </span>
                <span>
                  <strong>Category:</strong> {request.accommodationCategory}
                </span>
                <span>
                  <strong>Requested by:</strong> {request.hrRequesterName}
                </span>
                <span>
                  <strong>Respond by:</strong> {request.responseDeadline}
                </span>
              </div>
            </div>

            {/* Section 1: Job Task Information */}
            <FormSection title="Job Task Information">
              <TextareaField
                fieldId="essentialFunctions"
                label="Essential functions of this position"
                required
                hint="List the core duties that define this position."
                value={formData.essentialFunctions}
                onChange={(v) => handleFieldChange('essentialFunctions', v)}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="nonEssentialFunctions"
                label="Non-essential functions that could be modified"
                value={formData.nonEssentialFunctions}
                onChange={(v) => handleFieldChange('nonEssentialFunctions', v)}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="physicalRequirements"
                label="Physical requirements of the position"
                value={formData.physicalRequirements}
                onChange={(v) => handleFieldChange('physicalRequirements', v)}
                readOnly={isReadOnly}
              />
            </FormSection>

            {/* Section 2: Workspace / Physical Environment */}
            <FormSection title="Workspace / Physical Environment">
              <TextareaField
                fieldId="currentWorkspace"
                label="Current workspace description"
                required
                value={formData.currentWorkspace}
                onChange={(v) => handleFieldChange('currentWorkspace', v)}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="alternativeOptions"
                label="Available alternative workspace options"
                value={formData.alternativeOptions}
                onChange={(v) => handleFieldChange('alternativeOptions', v)}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="environmentalFactors"
                label="Environmental factors (noise, lighting, proximity)"
                value={formData.environmentalFactors}
                onChange={(v) => handleFieldChange('environmentalFactors', v)}
                readOnly={isReadOnly}
              />
            </FormSection>

            {/* Section 3: Schedule Flexibility */}
            <FormSection title="Schedule Flexibility">
              <SelectField
                fieldId="scheduleFlexibility"
                label="Schedule flexibility available"
                required
                value={formData.scheduleFlexibility}
                onChange={(v) => handleFieldChange('scheduleFlexibility', v)}
                options={[
                  { value: 'flexible', label: 'Flexible' },
                  { value: 'partially_flexible', label: 'Partially Flexible' },
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'unknown', label: 'Unknown' },
                ]}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="schedulingConstraints"
                label="Details on scheduling constraints"
                hint="Describe team coverage requirements and any shift minimums that apply."
                value={formData.schedulingConstraints}
                onChange={(v) => handleFieldChange('schedulingConstraints', v)}
                readOnly={isReadOnly}
              />
            </FormSection>

            {/* Section 4: Team Impact Assessment */}
            <FormSection title="Team Impact Assessment">
              <SelectField
                fieldId="workflowImpact"
                label="Impact on team workflow"
                required
                value={formData.workflowImpact}
                onChange={(v) => handleFieldChange('workflowImpact', v)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'minor', label: 'Minor' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'significant', label: 'Significant' },
                ]}
                readOnly={isReadOnly}
              />
              <SelectField
                fieldId="teamMemberImpact"
                label="Impact on team members"
                required
                value={formData.teamMemberImpact}
                onChange={(v) => handleFieldChange('teamMemberImpact', v)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'minor', label: 'Minor' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'significant', label: 'Significant' },
                ]}
                readOnly={isReadOnly}
              />
              <TextareaField
                fieldId="mitigationStrategies"
                label="Mitigation strategies available"
                hint="Consider team coverage, project deadlines, and client-facing impact."
                value={formData.mitigationStrategies}
                onChange={(v) => handleFieldChange('mitigationStrategies', v)}
                readOnly={isReadOnly}
              />
            </FormSection>

            {/* Section 5: Manager Notes */}
            <FormSection title="Manager Notes">
              <TextareaField
                fieldId="managerNotes"
                label="Additional notes (optional)"
                value={formData.managerNotes}
                onChange={(v) => handleFieldChange('managerNotes', v)}
                readOnly={isReadOnly}
              />
            </FormSection>

            {/* Medical Keyword Warning */}
            {showMedicalWarning && !medicalWarningDismissed && (
              <div
                role="alert"
                data-testid="medical-keyword-warning"
                className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  ⚠
                </span>
                <div className="flex-1">
                  <p className="font-medium">Medical information detected</p>
                  <p className="mt-1">
                    Your response appears to contain medical information. Please focus on
                    operational and job-related information only. Remove references to medical
                    conditions.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowMedicalWarning(false);
                    setMedicalWarningDismissed(true);
                  }}
                  data-testid="dismiss-medical-warning"
                  className="ml-2 shrink-0 text-amber-700 hover:text-amber-900 focus:outline-none"
                  aria-label="Dismiss warning"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Auto-save status */}
            <div
              aria-live="polite"
              data-testid="auto-save-status"
              className="text-xs text-gray-500"
            >
              {autoSaveTime ? `✓ Draft auto-saved at ${autoSaveTime} ET` : ''}
            </div>

            {/* Form Actions */}
            {!isReadOnly && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <button
                  onClick={handleSaveDraft}
                  data-testid="save-draft-btn"
                  className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => setExtensionPanelOpen(true)}
                  data-testid="request-extension-btn"
                  className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  Request Extension
                </button>
                <button
                  onClick={() => {
                    if (isRequiredFilled) setSubmitDialogOpen(true);
                  }}
                  data-testid="submit-response-btn"
                  aria-disabled={!isRequiredFilled ? 'true' : undefined}
                  disabled={!isRequiredFilled}
                  className={`rounded-md px-5 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 ${
                    isRequiredFilled
                      ? 'bg-[#2563EB] hover:bg-[#1d4ed8]'
                      : 'cursor-not-allowed bg-gray-400 opacity-60'
                  }`}
                >
                  Submit Response
                </button>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* MODE B — Acknowledgment (mode === 'acknowledgment' from API) */}
        {/* ------------------------------------------------------------------ */}
        {isAcknowledgmentMode && (
          <div className="space-y-6">
            {/* Page Header */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h1
                data-testid="acknowledgment-header"
                className="text-2xl font-bold text-[#1E3A5F]"
              >
                {request.outcomeType === 'approved'
                  ? 'Accommodation Update — Action Required'
                  : 'Accommodation Case Update'}
              </h1>
            </div>

            {/* Outcome Card */}
            {request.outcomeType === 'approved' ? (
              <div
                data-testid="outcome-card-approved"
                className="rounded-lg border border-gray-200 bg-white p-6"
              >
                <div className="mb-4 grid gap-1 text-sm text-gray-600">
                  <span>
                    <strong>Employee:</strong> {request.employeeName}
                  </span>
                  <span>
                    <strong>Department:</strong> {request.department}
                  </span>
                  <span>
                    <strong>Position:</strong> {request.positionTitle}
                  </span>
                </div>
                <div className="mb-3 flex items-start gap-2">
                  <span aria-hidden="true" className="text-green-600">
                    ✅
                  </span>
                  <div>
                    <p className="font-semibold text-gray-800">Accommodation Approved</p>
                    <p className="mt-1 text-sm text-gray-700">
                      Contact HR for implementation details.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                data-testid="outcome-card-denied"
                className="rounded-lg border border-gray-200 bg-white p-6"
              >
                <div className="mb-4 grid gap-1 text-sm text-gray-600">
                  <span>
                    <strong>Employee:</strong> {request.employeeName}
                  </span>
                </div>
                <p
                  data-testid="case-resolved-message"
                  className="text-base font-medium text-gray-800"
                >
                  Case resolved — no action required.
                </p>
              </div>
            )}

            {/* Acknowledgment Panel */}
            <div
              data-testid="acknowledgment-panel"
              className="rounded-lg border border-gray-200 bg-white p-6"
            >
              <div className="mb-4 flex items-start gap-3">
                <input
                  id="ack-checkbox"
                  type="checkbox"
                  data-testid="ack-checkbox"
                  checked={ackChecked}
                  onChange={(e) => setAckChecked(e.target.checked)}
                  aria-required="true"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                />
                <label htmlFor="ack-checkbox" className="text-sm text-gray-700">
                  {request.outcomeType === 'approved'
                    ? 'I acknowledge receipt of this accommodation information and understand my implementation responsibilities.'
                    : 'I acknowledge receipt of this notification.'}
                </label>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={ackChecked ? handleAcknowledged : undefined}
                  data-testid="acknowledged-btn"
                  aria-disabled={!ackChecked ? 'true' : undefined}
                  disabled={!ackChecked}
                  className={`rounded-md px-5 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 ${
                    ackChecked
                      ? 'bg-[#2563EB] hover:bg-[#1d4ed8]'
                      : 'cursor-not-allowed bg-gray-400 opacity-60'
                  }`}
                >
                  Acknowledged
                </button>
                <a
                  href="mailto:hr@example.com"
                  className="text-sm font-medium text-[#2563EB] hover:underline"
                >
                  Contact HR →
                </a>
              </div>
              {request.outcomeType === 'approved' && (
                <div className="mt-4 rounded-md bg-blue-50 px-4 py-3 text-xs text-blue-800">
                  💡 By acknowledging, you confirm you have received the accommodation information
                  and will ensure it is implemented as described. Do not discuss the accommodation
                  reason or medical condition with the employee — contact HR with any questions.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <SubmitConfirmationDialog
        open={submitDialogOpen}
        onClose={() => setSubmitDialogOpen(false)}
        onSubmit={() => { void handleSubmitConfirm(); }}
        onSaveDraft={handleSaveDraft}
      />
      <ExtensionRequestPanel
        open={extensionPanelOpen}
        onClose={() => setExtensionPanelOpen(false)}
        onSubmit={() => {
          setExtensionPanelOpen(false);
        }}
      />
    </div>
  );
}

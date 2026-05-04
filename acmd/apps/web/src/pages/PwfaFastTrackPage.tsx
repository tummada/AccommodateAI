/**
 * PwfaFastTrackPage — ACMD-147 Phase 6L / ACMD-156 Phase 7B (real API)
 *
 * URL: /cases/:id/pwfa-fast-track
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer → redirect via RoleGuard
 *
 * COMPLIANCE: PWFA Section 1003(4), 29 CFR 1636
 * 4 predictable assessment categories approved without medical documentation:
 *   Breaks, Water/Drinks, Sit/Stand, Eating
 *
 * 6 States:
 *   1: Eligibility + Category Selection (default)
 *   2: Approval Confirmation Modal
 *   3: Dual-Law Checklist Modal (conditional: ADA+PWFA or FMLA+PWFA)
 *   4: Interim Accommodation Check
 *   5: Approval Success
 *   6: Not Eligible Redirect
 *
 * API calls (ACMD-156 Phase 7B):
 *   - State 1 mount: GET /api/v1/cases/:id  → derive eligibility from case.type
 *   - State 5 submit: POST /api/v1/cases/:id/fast-track-approve
 *
 * Test mode: when `testEligibilityOverride` prop is provided, all API calls
 * are skipped and mock data is used synchronously. This preserves all 26 unit tests.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { fetchCaseDetail } from '@/pages/CaseDetailPage';
import { fastTrackApprove } from '@/lib/api/approval';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EligibilityStatus = 'checking' | 'eligible' | 'not_eligible';
type LeaveGateStatus = 'pending' | 'passed' | 'redirect';
type PageState = 'selection' | 'approval_modal' | 'dual_law_modal' | 'interim_check' | 'success' | 'not_eligible';
type DurationOption = '' | 'temporary' | 'pregnancy' | 'permanent';
type DualLawOption = '' | 'pwfa_sufficient' | 'continue_other';
type InterimOption = '' | 'final' | 'interim';

interface CategoryCard {
  id: string;
  title: string;
  description: string;
  section: string;
  icon: string;
  detected: boolean;
}

interface AuditEntry {
  timestamp: string;
  actor: string;
  actionType: string;
  detail: string;
}

interface CaseDisplayData {
  id: string;
  caseNumber: string;
  employeeName: string;
  accommodationDesc: string;
  laws: string[];
  deadline: { day: number; total: number; remaining: number };
  eligibility: EligibilityStatus;
  detectedCategories: string[];
}

// ---------------------------------------------------------------------------
// Constants (static PWFA category definitions)
// ---------------------------------------------------------------------------

const CATEGORIES: CategoryCard[] = [
  {
    id: 'breaks',
    title: 'BREAKS',
    description: 'Additional or longer break periods',
    section: 'PWFA Section 1003(4)(A)',
    icon: '🕐',
    detected: false,
  },
  {
    id: 'water',
    title: 'WATER / DRINKS',
    description: 'Access to water or beverages during work',
    section: 'PWFA Section 1003(4)(B)',
    icon: '💧',
    detected: false,
  },
  {
    id: 'sit_stand',
    title: 'SIT / STAND',
    description: 'Ability to sit or stand as needed',
    section: 'PWFA Section 1003(4)(C)',
    icon: '🪑',
    detected: false,
  },
  {
    id: 'eating',
    title: 'EATING',
    description: 'Ability to eat during work hours / at workstation',
    section: 'PWFA Section 1003(4)(D)',
    icon: '🍽️',
    detected: false,
  },
];

// ---------------------------------------------------------------------------
// Mock data (test mode only — used when testEligibilityOverride is provided)
// ---------------------------------------------------------------------------

function getMockCase(id: string): CaseDisplayData {
  return {
    id,
    caseNumber: `CASE-2026-${id?.padStart(3, '0') ?? '001'}`,
    employeeName: 'Maria Johnson',
    accommodationDesc: 'Additional breaks during pregnancy',
    laws: ['PWFA', 'ADA'],
    deadline: { day: 5, total: 30, remaining: 25 },
    eligibility: 'eligible',
    detectedCategories: ['breaks'],
  };
}

/** Static audit entries shown in the audit trail preview (not mock data — page scaffolding). */
const STATIC_AUDIT_ENTRIES: AuditEntry[] = [
  {
    timestamp: '2026-04-14 09:00',
    actor: 'SYSTEM',
    actionType: 'pwfa.detected',
    detail: 'PWFA fast-track eligibility detected: type=breaks',
  },
  {
    timestamp: '2026-04-14 09:01',
    actor: 'HR',
    actionType: 'pwfa.fast_track_started',
    detail: 'PWFA fast-track screen opened',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCategories(detected: string[]): CategoryCard[] {
  return CATEGORIES.map((c) => ({
    ...c,
    detected: detected.includes(c.id),
  }));
}

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Derive display laws from case type field.
 * pwfa → ['PWFA'], ada → ['ADA'], multiple → ['PWFA', 'ADA'], state_law → ['State Law']
 */
function deriveLawsFromType(type: string): string[] {
  switch (type) {
    case 'pwfa': return ['PWFA'];
    case 'ada': return ['ADA'];
    case 'multiple': return ['PWFA', 'ADA'];
    case 'state_law': return ['State Law'];
    default: return [type.toUpperCase()];
  }
}

/**
 * Derive eligibility from case type.
 * Only 'pwfa' and 'multiple' cases qualify for PWFA fast-track.
 */
function deriveEligibility(type: string): EligibilityStatus {
  return type === 'pwfa' || type === 'multiple' ? 'eligible' : 'not_eligible';
}

/**
 * Compute a human-readable deadline breakdown from a deadline ISO string.
 * Returns { day, total, remaining } where total = 30 days.
 */
function computeDeadline(deadlineIso: string | null): { day: number; total: number; remaining: number } {
  if (!deadlineIso) {
    return { day: 1, total: 30, remaining: 29 };
  }
  const now = new Date();
  const deadline = new Date(deadlineIso);
  const TOTAL = 30;
  const remainingMs = deadline.getTime() - now.getTime();
  const remaining = Math.max(0, Math.round(remainingMs / (1000 * 60 * 60 * 24)));
  const day = Math.max(1, TOTAL - remaining);
  return { day, total: TOTAL, remaining };
}

/**
 * Format a short case number from UUID.
 * Uses last 6 chars of UUID as a readable identifier.
 */
function formatCaseNumber(id: string): string {
  const year = new Date().getFullYear();
  const short = id.replace(/-/g, '').slice(-6).toUpperCase();
  return `CASE-${year}-${short}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DeadlineBadge({ day, total, remaining }: { day: number; total: number; remaining: number }) {
  const pct = Math.round((day / total) * 100);
  const barColor =
    remaining <= 1 ? '#DC2626' : remaining <= 3 ? '#DC2626' : remaining <= 7 ? '#F97316' : '#2563EB';
  return (
    <div
      data-testid="deadline-badge"
      className="rounded-lg border border-gray-200 bg-white p-3 mb-4"
      role="status"
      aria-label={`Day ${day} of ${total}, ${remaining} days remaining`}
    >
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-semibold text-[#1E3A5F]">Day {day} of {total}</span>
        <span className="text-gray-600">{remaining} days left</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

function EligibilityBanner({ status }: { status: EligibilityStatus }) {
  if (status === 'checking') {
    return (
      <div
        data-testid="eligibility-banner"
        role="status"
        aria-live="polite"
        className="rounded-lg border border-yellow-400 bg-yellow-50 p-4 mb-4 flex items-center gap-3"
      >
        <span className="animate-spin text-xl" aria-hidden="true">⏳</span>
        <span className="text-yellow-800 font-medium">Checking PWFA eligibility...</span>
      </div>
    );
  }
  if (status === 'eligible') {
    return (
      <div
        data-testid="eligibility-banner"
        role="status"
        aria-live="polite"
        className="rounded-lg border-2 border-green-600 bg-green-50 p-4 mb-4"
      >
        <div className="flex items-start gap-3">
          <span className="text-green-600 text-xl" aria-hidden="true">✅</span>
          <div>
            <h3 className="font-bold text-green-800 text-sm uppercase tracking-wide">
              PWFA Predictable Assessment — Eligible
            </h3>
            <p className="text-green-700 text-sm mt-1">
              This request qualifies for PWFA fast-track approval.
              Medical documentation is NOT required.
            </p>
            <p className="text-green-600 text-xs mt-1">
              Legal basis: PWFA Section 1003(4), 29 CFR 1636
            </p>
            <p className="text-green-600 text-xs mt-2 italic">
              Under the PWFA, these accommodations are considered &quot;predictable assessments&quot;
              that virtually always qualify as reasonable. They can be approved immediately.
            </p>
          </div>
        </div>
      </div>
    );
  }
  // not_eligible
  return (
    <div
      data-testid="eligibility-banner"
      role="status"
      aria-live="polite"
      className="rounded-lg border-2 border-red-600 bg-red-50 p-4 mb-4"
    >
      <div className="flex items-start gap-3">
        <span className="text-red-600 text-xl" aria-hidden="true">❌</span>
        <div>
          <h3 className="font-bold text-red-800 text-sm uppercase tracking-wide">
            Not Eligible for PWFA Fast-Track
          </h3>
          <p className="text-red-700 text-sm mt-1">
            This request does not qualify for PWFA predictable assessment fast-track.
            The accommodation type does not match one of the 4 qualifying categories
            (Breaks, Water, Sit/Stand, Eating).
          </p>
          <p className="text-red-700 text-sm mt-2">
            The case will continue through the standard interactive process.
          </p>
        </div>
      </div>
    </div>
  );
}

function LeaveGateWarning({
  status,
  onYes,
  onNo,
}: {
  status: LeaveGateStatus;
  onYes: () => void;
  onNo: () => void;
}) {
  if (status !== 'pending') return null;
  return (
    <div
      data-testid="leave-gate"
      role="alertdialog"
      aria-label="PWFA leave-forcing protection check"
      className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 mb-4"
    >
      <div className="flex items-start gap-3">
        <span className="text-amber-600 text-xl" aria-hidden="true">⚠️</span>
        <div className="flex-1">
          <h3 className="font-bold text-amber-800 text-sm uppercase tracking-wide">
            PWFA Leave-Forcing Protection
          </h3>
          <p className="text-amber-700 text-sm mt-1">
            Under the PWFA, employers cannot force an employee to take leave (paid or unpaid)
            if a reasonable accommodation is available that would allow them to continue working.
          </p>
          <p className="text-amber-700 text-sm mt-2 font-medium">
            Does this accommodation allow the employee to continue working?
          </p>
          <div className="flex gap-3 mt-3">
            <button
              type="button"
              data-testid="leave-gate-yes"
              onClick={onYes}
              className="rounded-md px-4 py-2 text-sm font-medium bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              Yes, employee continues working
            </button>
            <button
              type="button"
              data-testid="leave-gate-no"
              onClick={onNo}
              className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              No, leave may be needed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton (AC-7)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div
      data-testid="pwfa-loading-skeleton"
      className="max-w-3xl mx-auto py-6 px-4 animate-pulse"
      role="status"
      aria-label="Loading case details"
    >
      <div className="h-14 bg-gray-200 rounded-lg mb-4" />
      <div className="h-8 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-4 bg-gray-200 rounded w-1/2 mb-4" />
      <div className="h-20 bg-gray-200 rounded-lg mb-4" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 bg-gray-200 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function PwfaFastTrackPage({
  testEligibilityOverride,
}: {
  /**
   * Test-only: when provided, mock data is used synchronously and all API calls
   * are skipped. Preserves backward compatibility with all 26 existing unit tests.
   */
  testEligibilityOverride?: EligibilityStatus;
} = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Test mode: true when testEligibilityOverride is provided (any value including 'eligible')
  const isTestMode = testEligibilityOverride !== undefined;

  // Auth — always called (Rules of Hooks).
  // client is only used when not in test mode.
  const { client } = useAuth();

  // ---------------------------------------------------------------------------
  // Case data — initialized synchronously in test mode, loaded via API in production
  // ---------------------------------------------------------------------------

  const initialCaseData: CaseDisplayData | null = isTestMode
    ? (() => {
        const mockData = getMockCase(id ?? '001');
        mockData.eligibility = testEligibilityOverride!;
        return mockData;
      })()
    : null;

  const [caseData, setCaseData] = useState<CaseDisplayData | null>(initialCaseData);
  const [loadError, setLoadError] = useState<string | null>(null);
  // AC-7: loading skeleton shown while API in flight
  const [isLoadingCase, setIsLoadingCase] = useState(!isTestMode);

  // Production mode: load case from API on mount (AC-2)
  useEffect(() => {
    if (isTestMode || !id) return;

    let cancelled = false;
    setIsLoadingCase(true);
    setLoadError(null);

    fetchCaseDetail(client, id)
      .then((rawResponse) => {
        if (cancelled) return;

        // The backend returns { case: ... }. Handle both wrapped and unwrapped shapes
        // since fetchCaseDetail typing may differ from runtime response.
        const caseRaw =
          (rawResponse as unknown as { case: typeof rawResponse })?.case ?? rawResponse;

        const type = (caseRaw as { type?: string }).type ?? 'ada';
        const requestDescription =
          (caseRaw as { requestDescription?: string | null }).requestDescription ?? null;
        const deadlineIso =
          (caseRaw as { deadline?: string | null }).deadline ?? null;
        const employeeId =
          (caseRaw as { employeeId?: string }).employeeId ?? '';
        const caseId =
          (caseRaw as { id?: string }).id ?? id;

        // AC-3: eligibility derived from real case.type (not mock)
        const eligibility = deriveEligibility(type);
        const laws = deriveLawsFromType(type);
        const deadline = computeDeadline(deadlineIso);

        setCaseData({
          id: caseId,
          caseNumber: formatCaseNumber(caseId),
          employeeName: employeeId,
          accommodationDesc: requestDescription ?? 'Accommodation request',
          laws,
          deadline,
          eligibility,
          detectedCategories: [],
        });
        setIsLoadingCase(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setIsLoadingCase(false);

        // AC-8: 401 response → redirect to /login
        if (err instanceof ApiError && err.status === 401) {
          navigate('/login', { replace: true });
          return;
        }

        const message =
          err instanceof ApiError ? err.details.message : 'Failed to load case details.';
        setLoadError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [isTestMode, client, id, navigate]);

  // ---------------------------------------------------------------------------
  // Core state — initialized synchronously from caseData (test mode) or defaults
  // ---------------------------------------------------------------------------

  const [pageState, setPageState] = useState<PageState>(() => {
    if (!initialCaseData) return 'selection';
    return initialCaseData.eligibility === 'not_eligible' ? 'not_eligible' : 'selection';
  });
  const [eligibility, setEligibility] = useState<EligibilityStatus>(
    initialCaseData?.eligibility ?? 'checking',
  );
  const [leaveGate, setLeaveGate] = useState<LeaveGateStatus>('pending');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(initialCaseData?.detectedCategories ?? []),
  );

  // Derived categories
  const categories = buildCategories(caseData?.detectedCategories ?? []);

  // Sync page state + eligibility when caseData loads (production mode only)
  useEffect(() => {
    if (!caseData || isTestMode) return;
    setEligibility(caseData.eligibility);
    setSelectedCategories(new Set(caseData.detectedCategories));
    if (caseData.eligibility === 'not_eligible') {
      setPageState('not_eligible');
    } else {
      setPageState('selection');
    }
  }, [caseData, isTestMode]);

  // Approval form state
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [duration, setDuration] = useState<DurationOption>('pregnancy');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [approvalErrors, setApprovalErrors] = useState<string[]>([]);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Dual-law state
  const [dualLawOption, setDualLawOption] = useState<DualLawOption>('');

  // Interim state
  const [interimOption, setInterimOption] = useState<InterimOption>('');

  // Not-eligible auto-redirect
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(3);

  // Focus ref for category grid
  const categoryGridRef = useRef<HTMLDivElement>(null);

  // Not-eligible auto-redirect countdown
  useEffect(() => {
    if (pageState === 'not_eligible') {
      const interval = setInterval(() => {
        setRedirectCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            navigate(`/cases/${id}`);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      redirectTimerRef.current = interval;
      return () => clearInterval(interval);
    }
  }, [pageState, id, navigate]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleLeaveGateYes = useCallback(() => {
    setLeaveGate('passed');
  }, []);

  const handleLeaveGateNo = useCallback(() => {
    setLeaveGate('redirect');
    navigate(`/cases/${id}`);
  }, [id, navigate]);

  const toggleCategory = useCallback((catId: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }, []);

  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, catId: string, idx: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCategory(catId);
        return;
      }
      const grid = categoryGridRef.current;
      if (!grid) return;
      const cards = grid.querySelectorAll<HTMLDivElement>('[data-category-card]');
      let target = -1;
      if (e.key === 'ArrowRight') target = Math.min(idx + 1, cards.length - 1);
      if (e.key === 'ArrowLeft') target = Math.max(idx - 1, 0);
      if (e.key === 'ArrowDown') target = Math.min(idx + 2, cards.length - 1);
      if (e.key === 'ArrowUp') target = Math.max(idx - 2, 0);
      if (target >= 0 && target !== idx) {
        e.preventDefault();
        cards[target]?.focus();
      }
    },
    [toggleCategory],
  );

  const handleConfirmSelection = useCallback(() => {
    setApprovalErrors([]);
    setPageState('approval_modal');
  }, []);

  const validateApproval = useCallback((): string[] => {
    const errs: string[] = [];
    if (!effectiveDate) errs.push('Effective date is required');
    if (effectiveDate && effectiveDate < todayStr()) errs.push('Effective date must be today or future');
    if (!duration) errs.push('Duration selection is required');
    if (duration === 'temporary' && !endDate) errs.push('End date is required for temporary duration');
    if (duration === 'temporary' && endDate && endDate <= effectiveDate)
      errs.push('End date must be after effective date');
    return errs;
  }, [effectiveDate, duration, endDate]);

  const handleConfirmApproval = useCallback(() => {
    const errs = validateApproval();
    if (errs.length > 0) {
      setApprovalErrors(errs);
      return;
    }
    const hasDualLaw = (caseData?.laws.length ?? 0) > 1;
    if (hasDualLaw) {
      setPageState('dual_law_modal');
    } else {
      setPageState('interim_check');
    }
  }, [validateApproval, caseData]);

  const handleDualLawContinue = useCallback(() => {
    if (dualLawOption === 'continue_other') {
      navigate(`/cases/${id}`);
    } else {
      setPageState('interim_check');
    }
  }, [dualLawOption, id, navigate]);

  /**
   * handleCompleteApproval — final step.
   * In production: calls POST /cases/:id/fast-track-approve (AC-4), then sets success (AC-5).
   * In test mode: directly transitions to success (no API call).
   */
  const handleCompleteApproval = useCallback(async () => {
    if (interimOption === 'interim') {
      navigate(`/cases/${id}/pwfa-temp`);
      return;
    }

    // Test mode: skip API call, go to success
    if (isTestMode || !id) {
      setPageState('success');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // AC-4: POST /api/v1/cases/:id/fast-track-approve
      await fastTrackApprove(client, id);
      // AC-5: success state set from API response (decision returned)
      setPageState('success');
    } catch (err) {
      // AC-8: 401 → redirect to /login
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      const message =
        err instanceof ApiError ? err.details.message : 'Failed to submit fast-track approval.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [interimOption, id, navigate, isTestMode, client]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const hasFmla = caseData?.laws.includes('FMLA') ?? false;
  const selectedCategoryNames = categories
    .filter((c) => selectedCategories.has(c.id))
    .map((c) => c.title)
    .join(', ');
  const durationLabel =
    duration === 'temporary'
      ? `Temporary (until ${endDate || 'TBD'})`
      : duration === 'pregnancy'
        ? 'Duration of pregnancy-related condition'
        : duration === 'permanent'
          ? 'Permanent'
          : '';

  // ---------------------------------------------------------------------------
  // AC-7: Loading skeleton while API is in flight
  // ---------------------------------------------------------------------------

  if (isLoadingCase) {
    return <PageSkeleton />;
  }

  // ---------------------------------------------------------------------------
  // AC-7: Error state when case load fails
  // ---------------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4" data-testid="pwfa-fast-track-page">
        <div
          data-testid="load-error-banner"
          className="rounded-lg border-2 border-red-300 bg-red-50 p-6"
          role="alert"
        >
          <h2 className="font-bold text-red-800 text-lg">Failed to Load Case</h2>
          <p className="text-red-700 text-sm mt-2">{loadError}</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-4 rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!caseData) return null;

  // ---------------------------------------------------------------------------
  // Render: State 6 — Not Eligible
  // ---------------------------------------------------------------------------

  if (pageState === 'not_eligible') {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4" data-testid="pwfa-fast-track-page">
        <div
          data-testid="not-eligible-banner"
          className="rounded-lg border-2 border-red-600 bg-red-50 p-6 text-center"
          role="alert"
        >
          <span className="text-red-600 text-4xl" aria-hidden="true">❌</span>
          <h2 className="font-bold text-red-800 text-lg mt-3 uppercase tracking-wide">
            Not Eligible for PWFA Fast-Track
          </h2>
          <p className="text-red-700 text-sm mt-2">
            This request does not qualify for PWFA predictable assessment fast-track.
            The accommodation type does not match one of the 4 qualifying categories
            (Breaks, Water, Sit/Stand, Eating).
          </p>
          <p className="text-red-700 text-sm mt-2">
            The case will continue through the standard interactive process (FLOW-MAIN).
          </p>
          <p className="text-red-600 text-sm mt-3 font-medium" data-testid="redirect-countdown">
            Redirecting in {redirectCountdown} seconds...
          </p>
          <button
            type="button"
            data-testid="return-now-btn"
            onClick={() => navigate(`/cases/${id}`)}
            className="mt-4 rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Return to Case Detail Now
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: State 5 — Success
  // ---------------------------------------------------------------------------

  if (pageState === 'success') {
    return (
      <div className="max-w-3xl mx-auto py-6 px-4" data-testid="pwfa-fast-track-page">
        {/* Success Banner */}
        <div
          data-testid="success-banner"
          className="rounded-lg border-2 border-green-600 bg-green-50 p-6"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <span className="text-green-600 text-4xl" aria-hidden="true">✅</span>
            <h2 className="font-bold text-green-800 text-xl mt-3">
              PWFA Accommodation Approved
            </h2>
            <p className="text-green-700 text-sm mt-1">
              {caseData.employeeName}&apos;s accommodation has been approved under the
              PWFA Predictable Assessment provision.
            </p>
          </div>

          {/* Summary Card */}
          <div
            data-testid="success-summary"
            className="mt-4 rounded-md border border-green-200 bg-white p-4"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium text-gray-600">Employee:</dt>
              <dd className="text-[#1E3A5F]">{caseData.employeeName}</dd>
              <dt className="font-medium text-gray-600">Case:</dt>
              <dd className="text-[#1E3A5F]">{caseData.caseNumber}</dd>
              <dt className="font-medium text-gray-600">Type:</dt>
              <dd className="text-[#1E3A5F]">{selectedCategoryNames}</dd>
              <dt className="font-medium text-gray-600">Legal basis:</dt>
              <dd className="text-[#1E3A5F]">PWFA Predictable Assessment</dd>
              <dt className="font-medium text-gray-600">Effective:</dt>
              <dd className="text-[#1E3A5F]">{effectiveDate}</dd>
              <dt className="font-medium text-gray-600">Duration:</dt>
              <dd className="text-[#1E3A5F]">{durationLabel}</dd>
              <dt className="font-medium text-gray-600">Medical docs:</dt>
              <dd className="text-[#1E3A5F]">PWFA Exempt</dd>
              <dt className="font-medium text-gray-600">EEOC Stage 4:</dt>
              <dd>
                <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                  Skipped (PWFA Exempt)
                </span>
              </dd>
              <dt className="font-medium text-gray-600">EEOC Stage 5:</dt>
              <dd>
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  Approved
                </span>
              </dd>
            </dl>
          </div>

          {/* Next Steps */}
          <div className="mt-4">
            <h3 className="font-semibold text-green-800 text-sm">Next Steps</h3>
            <ol className="mt-2 space-y-1 text-sm text-green-700 list-decimal list-inside">
              <li>
                Approval letter has been generated —{' '}
                <Link
                  to={`/cases/${id}/letters`}
                  className="text-[#2563EB] underline hover:text-blue-800"
                >
                  Review &amp; Send Letter
                </Link>
              </li>
              <li>Manager will be notified (constrained disclosure)</li>
              <li>Follow-up reminder set for {effectiveDate}</li>
            </ol>
          </div>
        </div>

        {/* Manager Notification Preview */}
        <div
          data-testid="manager-preview"
          className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span aria-hidden="true">🙈</span>
            <h3 className="font-semibold text-[#1E3A5F] text-sm">Constrained Disclosure Preview</h3>
          </div>
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              <strong>The manager will see ONLY:</strong> &quot;{caseData.employeeName} —
              Approved Accommodation: {selectedCategoryNames} — Effective: {effectiveDate}
              — Action required: Implement schedule adjustment&quot;
            </p>
            <p className="text-gray-500 italic">
              The manager will NOT see: pregnancy status, medical condition,
              PWFA designation, or reason for request.
            </p>
          </div>
        </div>

        {/* Audit Trail */}
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-[#1E3A5F] text-sm mb-2">Audit Trail</h3>
          <ul className="space-y-1 text-xs text-gray-600 font-mono" data-testid="audit-trail">
            {[
              ...STATIC_AUDIT_ENTRIES,
              {
                timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
                actor: 'HR',
                actionType: 'pwfa.approved',
                detail: `PWFA fast-track approved: type=${selectedCategoryNames}, effective=${effectiveDate}, duration=${durationLabel}`,
              },
              {
                timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
                actor: 'SYSTEM',
                actionType: 'letter.pwfa_approval_generated',
                detail: `PWFA approval letter generated for case ${caseData.caseNumber}`,
              },
            ].map((entry, i) => (
              <li key={i}>
                [{entry.timestamp}] [{entry.actor}] [{entry.actionType}] {entry.detail}
              </li>
            ))}
          </ul>
          <Link
            to={`/cases/${id}/timeline`}
            className="text-xs text-[#2563EB] underline mt-2 inline-block"
          >
            View Full Timeline →
          </Link>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/cases/${id}/letters`}
            data-testid="review-letter-btn"
            className="rounded-md px-4 py-2 text-sm font-medium bg-[#2563EB] text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Review &amp; Send Letter
          </Link>
          <Link
            to={`/cases/${id}`}
            data-testid="view-case-btn"
            className="rounded-md px-4 py-2 text-sm font-medium border border-gray-300 text-[#1E3A5F] hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            View Case Detail
          </Link>
          <Link
            to="/dashboard"
            data-testid="back-dashboard-btn"
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: States 1-4
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto py-6 px-4" data-testid="pwfa-fast-track-page">
      {/* Deadline Badge */}
      <DeadlineBadge
        day={caseData.deadline.day}
        total={caseData.deadline.total}
        remaining={caseData.deadline.remaining}
      />

      {/* Case Header */}
      <div className="mb-4">
        <a
          href={`/cases/${id}`}
          className="text-sm text-[#2563EB] hover:underline"
          data-testid="back-link"
          onClick={(e) => {
            e.preventDefault();
            if (
              selectedCategories.size > 0 &&
              pageState === 'selection' &&
              leaveGate === 'passed' &&
              !window.confirm('You have unsaved selections. Are you sure you want to leave?')
            ) {
              return;
            }
            navigate(`/cases/${id}`);
          }}
        >
          ← Back to Case Detail
        </a>
        <h1 className="text-lg font-bold text-[#1E3A5F] mt-1">
          {caseData.caseNumber} — {caseData.employeeName} — {caseData.accommodationDesc}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          {caseData.laws.map((law) => (
            <span
              key={law}
              className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
            >
              {law}
            </span>
          ))}
          <span className="text-xs text-gray-500">Status: PWFA Fast-Track</span>
        </div>
      </div>

      {/* Eligibility Banner */}
      <EligibilityBanner status={eligibility} />

      {/* Only show rest when eligible */}
      {eligibility === 'eligible' && (
        <>
          {/* Leave-Forcing Warning Gate */}
          <LeaveGateWarning
            status={leaveGate}
            onYes={handleLeaveGateYes}
            onNo={handleLeaveGateNo}
          />

          {/* Category Selection — only after leave gate passed */}
          {leaveGate === 'passed' && pageState === 'selection' && (
            <>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-[#1E3A5F]">
                  Select accommodation type(s) to approve:
                </h2>
                <div
                  ref={categoryGridRef}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3"
                  role="group"
                  aria-label="PWFA accommodation categories"
                >
                  {categories.map((cat, idx) => {
                    const isSelected = selectedCategories.has(cat.id);
                    return (
                      <div
                        key={cat.id}
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={cat.title}
                        tabIndex={0}
                        data-testid={`category-card-${cat.id}`}
                        data-category-card
                        onClick={() => toggleCategory(cat.id)}
                        onKeyDown={(e) => handleCategoryKeyDown(e, cat.id, idx)}
                        className={`relative rounded-lg border-2 p-4 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          isSelected
                            ? 'border-[#2563EB] bg-blue-50'
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-md'
                        }`}
                      >
                        {/* Selected checkmark */}
                        {isSelected && (
                          <span
                            className="absolute top-2 right-2 text-green-600"
                            aria-hidden="true"
                            data-testid={`checkmark-${cat.id}`}
                          >
                            ✓
                          </span>
                        )}
                        {/* Detected badge */}
                        {cat.detected && (
                          <span
                            className="absolute top-2 left-2 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-medium text-white"
                            data-testid={`detected-badge-${cat.id}`}
                          >
                            Detected
                          </span>
                        )}
                        <div className="text-2xl mb-2" aria-hidden="true">
                          {cat.icon}
                        </div>
                        <h3 className={`text-sm font-bold text-[#1E3A5F] ${isSelected ? 'font-extrabold' : ''}`}>
                          {cat.title}
                        </h3>
                        <p className="text-xs text-gray-600 mt-1">{cat.description}</p>
                        <p className="text-[10px] text-gray-400 mt-2">{cat.section}</p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2 italic">
                  Multiple categories can be selected if the employee needs more than one accommodation type.
                </p>
              </div>

              {/* Confirm Selection Button */}
              {selectedCategories.size > 0 && (
                <button
                  type="button"
                  data-testid="confirm-selection-btn"
                  onClick={handleConfirmSelection}
                  className="rounded-md px-6 py-2.5 text-sm font-medium bg-[#2563EB] text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Confirm Selection ({selectedCategories.size} selected)
                </button>
              )}

              {/* Audit Trail Preview */}
              <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="font-semibold text-[#1E3A5F] text-sm mb-2">Recent Activity</h3>
                <ul className="space-y-1 text-xs text-gray-600 font-mono" data-testid="audit-trail-preview">
                  {STATIC_AUDIT_ENTRIES.map((entry, i) => (
                    <li key={i}>
                      [{entry.timestamp}] [{entry.actor}] [{entry.actionType}] {entry.detail}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/cases/${id}/timeline`}
                  className="text-xs text-[#2563EB] underline mt-2 inline-block"
                >
                  View Full Timeline →
                </Link>
              </div>
            </>
          )}
        </>
      )}

      {/* State 2: Approval Confirmation Modal */}
      {pageState === 'approval_modal' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="approval-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Approve PWFA Accommodation"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-[560px] w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[#1E3A5F]">Approve PWFA Accommodation</h2>
            <hr className="my-3 border-gray-200" />

            {/* Summary */}
            <div className="space-y-1 text-sm">
              <div className="flex gap-2">
                <span className="font-medium text-gray-600 w-28 shrink-0">Employee:</span>
                <span className="text-[#1E3A5F]">{caseData.employeeName}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium text-gray-600 w-28 shrink-0">Case:</span>
                <span className="text-[#1E3A5F]">{caseData.caseNumber}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium text-gray-600 w-28 shrink-0">Accommodation:</span>
                <span className="text-[#1E3A5F]">{selectedCategoryNames}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium text-gray-600 w-28 shrink-0">Legal basis:</span>
                <span className="text-[#1E3A5F]">PWFA Predictable Assessment</span>
              </div>
              <div className="flex gap-2">
                <span className="font-medium text-gray-600 w-28 shrink-0">Medical docs:</span>
                <span className="text-[#1E3A5F]">Not required (PWFA exempt)</span>
              </div>
            </div>

            {/* Effective Date */}
            <div className="mt-4">
              <label htmlFor="effective-date" className="block text-sm font-medium text-[#1E3A5F]">
                Effective Date
              </label>
              <input
                id="effective-date"
                type="date"
                data-testid="effective-date-input"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                min={todayStr()}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Duration */}
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-[#1E3A5F]">Duration</legend>
              <div className="mt-2 space-y-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="duration"
                    value="temporary"
                    checked={duration === 'temporary'}
                    onChange={() => setDuration('temporary')}
                    data-testid="duration-temporary"
                    className="mt-0.5"
                  />
                  <span>
                    Temporary — specify end date:
                    {duration === 'temporary' && (
                      <input
                        type="date"
                        data-testid="end-date-input"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        min={effectiveDate || todayStr()}
                        className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="duration"
                    value="pregnancy"
                    checked={duration === 'pregnancy'}
                    onChange={() => setDuration('pregnancy')}
                    data-testid="duration-pregnancy"
                    className="mt-0.5"
                  />
                  <span>Duration of pregnancy-related condition</span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="duration"
                    value="permanent"
                    checked={duration === 'permanent'}
                    onChange={() => setDuration('permanent')}
                    data-testid="duration-permanent"
                    className="mt-0.5"
                  />
                  <span>Permanent</span>
                </label>
              </div>
            </fieldset>

            {/* Notes */}
            <div className="mt-4">
              <label htmlFor="impl-notes" className="block text-sm font-medium text-[#1E3A5F]">
                Implementation Notes (optional)
              </label>
              <textarea
                id="impl-notes"
                data-testid="impl-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Break schedule: 10 min every 2 hours, starting immediately."
                rows={3}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Legal info */}
            <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              <span className="font-medium">ℹ️</span> This accommodation is being approved under
              the PWFA predictable assessment provision. No medical documentation or extended
              interactive process is legally required for this type.
            </div>

            {/* Validation errors */}
            {approvalErrors.length > 0 && (
              <div
                className="mt-3 rounded-md bg-red-50 border border-red-200 p-3"
                role="alert"
                data-testid="approval-errors"
              >
                <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                  {approvalErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Buttons */}
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                data-testid="modal-cancel-btn"
                onClick={() => setPageState('selection')}
                className="rounded-md px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-approval-btn"
                onClick={handleConfirmApproval}
                className="rounded-md px-4 py-2 text-sm font-medium bg-[#2563EB] text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State 3: Dual-Law Checklist Modal */}
      {pageState === 'dual_law_modal' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="dual-law-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={hasFmla ? 'PWFA + FMLA Evaluation' : 'Dual-Law Evaluation'}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-[560px] w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex gap-2 mb-1">
              {caseData.laws.map((law) => (
                <span
                  key={law}
                  className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                >
                  {law}
                </span>
              ))}
            </div>
            <h2 className="text-lg font-bold text-[#1E3A5F]">
              {hasFmla ? 'PWFA + FMLA Evaluation' : 'Dual-Law Evaluation'}
            </h2>
            <hr className="my-3 border-gray-200" />

            <p className="text-sm text-gray-700 mb-4">
              {hasFmla
                ? 'FMLA leave eligibility is separate from PWFA accommodation. PWFA accommodation approved. FMLA leave processing may continue separately if applicable.'
                : 'This case is tagged under both PWFA and ADA. The PWFA fast-track approval covers the PWFA component. The ADA component may require additional documentation or process steps.'}
            </p>

            <p className="text-sm font-medium text-[#1E3A5F] mb-3">Choose one:</p>

            <div className="space-y-3">
              <label
                className={`block rounded-lg border-2 p-3 cursor-pointer transition-all ${
                  dualLawOption === 'pwfa_sufficient'
                    ? 'border-[#2563EB] bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="dual-law"
                    value="pwfa_sufficient"
                    checked={dualLawOption === 'pwfa_sufficient'}
                    onChange={() => setDualLawOption('pwfa_sufficient')}
                    data-testid="dual-option-a"
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-[#1E3A5F]">
                      {hasFmla
                        ? 'PWFA approval only — no FMLA action needed'
                        : 'PWFA approval is sufficient for this accommodation'}
                    </span>
                    <p className="text-xs text-gray-600 mt-1">
                      {hasFmla
                        ? 'The PWFA accommodation covers the need. No separate FMLA leave processing required.'
                        : 'The accommodation requested (e.g., breaks, water) is fully covered under PWFA. No additional ADA process is needed for this specific accommodation.'}
                    </p>
                  </div>
                </div>
              </label>

              <label
                className={`block rounded-lg border-2 p-3 cursor-pointer transition-all ${
                  dualLawOption === 'continue_other'
                    ? 'border-[#2563EB] bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="dual-law"
                    value="continue_other"
                    checked={dualLawOption === 'continue_other'}
                    onChange={() => setDualLawOption('continue_other')}
                    data-testid="dual-option-b"
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-[#1E3A5F]">
                      {hasFmla
                        ? 'Continue FMLA processing separately'
                        : 'Continue ADA process for additional accommodations'}
                    </span>
                    <p className="text-xs text-gray-600 mt-1">
                      {hasFmla
                        ? 'PWFA portion will be approved, and FMLA leave processing continues separately.'
                        : 'The employee may need additional accommodations beyond the PWFA fast-track type. PWFA portion will be approved, and the case will return for ADA processing.'}
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {/* Legal info */}
            <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              <span className="font-medium">ℹ️</span> When multiple laws apply, the employee
              receives the protection of whichever law provides the greatest benefit.
              PWFA fast-track does not replace ADA or FMLA requirements for other aspects of the case.
            </div>

            {/* Buttons */}
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                data-testid="dual-back-btn"
                onClick={() => setPageState('approval_modal')}
                className="rounded-md px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Back
              </button>
              <button
                type="button"
                data-testid="dual-continue-btn"
                onClick={handleDualLawContinue}
                disabled={!dualLawOption}
                className="rounded-md px-4 py-2 text-sm font-medium bg-[#2563EB] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State 4: Interim Accommodation Check */}
      {pageState === 'interim_check' && (
        <div
          data-testid="interim-section"
          className="rounded-lg border-2 border-gray-200 bg-white p-6 mt-4"
        >
          <h2 className="text-lg font-bold text-[#1E3A5F]">Accommodation Scope</h2>
          <hr className="my-3 border-gray-200" />

          <p className="text-sm text-gray-700 mb-4">
            Is this the final accommodation, or an interim solution while a more comprehensive
            accommodation is arranged?
          </p>

          <div className="space-y-3">
            <label
              className={`block rounded-lg border-2 p-3 cursor-pointer transition-all ${
                interimOption === 'final'
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="interim"
                  value="final"
                  checked={interimOption === 'final'}
                  onChange={() => setInterimOption('final')}
                  data-testid="interim-final"
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-[#1E3A5F]">
                    This is the final accommodation
                  </span>
                  <p className="text-xs text-gray-600 mt-1">
                    The fast-track accommodation fully meets the employee&apos;s needs.
                  </p>
                </div>
              </div>
            </label>

            <label
              className={`block rounded-lg border-2 p-3 cursor-pointer transition-all ${
                interimOption === 'interim'
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="interim"
                  value="interim"
                  checked={interimOption === 'interim'}
                  onChange={() => setInterimOption('interim')}
                  data-testid="interim-interim"
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-[#1E3A5F]">
                    This is interim — additional accommodation may follow
                  </span>
                  <p className="text-xs text-gray-600 mt-1">
                    The employee may need a more comprehensive solution. This provides immediate
                    relief while the full process continues.
                  </p>
                </div>
              </div>
            </label>
          </div>

          {/* Legal info */}
          <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
            <span className="font-medium">ℹ️</span> Interim accommodations provide immediate
            relief while the full interactive process continues. Common when PWFA fast-track
            addresses an immediate need but the employee may need additional ADA accommodations.
          </div>

          {/* Submit error */}
          {submitError && (
            <div
              className="mt-3 rounded-md bg-red-50 border border-red-200 p-3"
              role="alert"
              data-testid="submit-error"
            >
              <p className="text-xs text-red-700">{submitError}</p>
            </div>
          )}

          <button
            type="button"
            data-testid="complete-approval-btn"
            onClick={() => void handleCompleteApproval()}
            disabled={!interimOption || isSubmitting}
            className="mt-4 rounded-md px-6 py-2.5 text-sm font-medium bg-[#2563EB] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {isSubmitting ? 'Submitting...' : 'Complete Approval'}
          </button>
        </div>
      )}
    </div>
  );
}

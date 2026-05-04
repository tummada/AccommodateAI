/**
 * AIAnalysisPage — ACMD-146 Phase 6K / ACMD-155 Phase 7B
 *
 * URL: /cases/:id/ai-analysis
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer → redirect via RoleGuard
 *
 * COMPLIANCE: 29 CFR 1630.14 — no medical specifics shown
 * Only functional limitations language. Never display medical condition names.
 *
 * 4 States:
 *   A: AI Consent Active — full analysis (loads suggestions from API)
 *   B: AI Consent Declined — opt-out message + manual guidance
 *   C: AI Consent Pending — pending + request consent button
 *   D: AI Service Error — error + retry + fallback
 *
 * ACMD-155: All suggestion data uses real API calls via client.request().
 * Risk factors, similar cases, and audit trail remain static pending
 * dedicated backend endpoints.
 */

import { useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  getSuggestions,
  generateSuggestions,
  acceptSuggestion,
  rejectSuggestion,
} from '@/lib/api/suggestions';
import type { Suggestion } from '@/lib/api/suggestions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConsentState = 'active' | 'declined' | 'pending' | 'error';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface RiskFactor {
  label: string;
  passed: boolean;
}

interface SimilarCase {
  label: string;
  type: string;
  outcome: string;
  duration: string;
  law: string;
  matchScore: number;
  keyFactor: string;
}

type RecommendationType = 'APPROVE' | 'DENY' | 'NEED_MORE_INFO';

interface AuditEntry {
  timestamp: string;
  role: string;
  actionType: string;
  detail: string;
}

type OverrideAction = 'approve' | 'deny' | 'need_more_info' | '';

// ---------------------------------------------------------------------------
// Static reference data (no dedicated backend endpoints yet)
// ---------------------------------------------------------------------------

const STATIC_RISK_FACTORS: RiskFactor[] = [
  { label: 'Interactive process documented (EEOC Stage 3)', passed: true },
  { label: 'PWFA predictable assessment eligible', passed: true },
  { label: 'Undue hardship likelihood: Low', passed: true },
  { label: 'Prior similar cases outcome: 3/3 approved', passed: true },
  { label: 'Documentation completeness', passed: true },
  { label: 'Timeline compliance (within 30 days)', passed: false },
];

const STATIC_SIMILAR_CASES: SimilarCase[] = [
  {
    label: 'Case A',
    type: 'Schedule Modification',
    outcome: 'APPROVED',
    duration: '14 days',
    law: 'ADA + PWFA',
    matchScore: 89,
    keyFactor: 'Admin role, low impact',
  },
  {
    label: 'Case B',
    type: 'Schedule Modification',
    outcome: 'APPROVED',
    duration: '8 days',
    law: 'PWFA (fast-track)',
    matchScore: 82,
    keyFactor: 'PWFA-eligible, predictable timeline',
  },
  {
    label: 'Case C',
    type: 'Flexible Schedule',
    outcome: 'APPROVED w/ MODIFICATION',
    duration: '22 days',
    law: 'ADA',
    matchScore: 74,
    keyFactor: 'Similar role, modified hours',
  },
];

const STATIC_AUDIT_TRAIL: AuditEntry[] = [
  {
    timestamp: '2026-04-10 14:32',
    role: 'SYSTEM',
    actionType: 'ai.analysis_run',
    detail: 'AI analysis initiated by Sarah Kim (HR) — Provider: Gemini 2.5 Pro',
  },
  {
    timestamp: '2026-04-10 14:33',
    role: 'SYSTEM',
    actionType: 'ai.jan_soar_query',
    detail: 'JAN SOAR query: "schedule modification" — 4 suggestions returned',
  },
  {
    timestamp: '2026-04-10 14:33',
    role: 'SYSTEM',
    actionType: 'ai.similar_cases',
    detail: 'Similar case search: 3 matches found (89%, 82%, 74%)',
  },
  {
    timestamp: '2026-04-10 14:33',
    role: 'SYSTEM',
    actionType: 'ai.recommendation',
    detail: 'AI recommended: APPROVE, confidence: 88%',
  },
  {
    timestamp: '2026-04-10 14:35',
    role: 'HR',
    actionType: 'ai.suggestion_viewed',
    detail: 'Sarah Kim viewed suggestion #1 (Modified Work Schedule)',
  },
];

const REJECTION_REASONS = [
  'Not operationally feasible',
  'Employee preference differs',
  'Insufficient coverage for role',
  'Cost exceeds budget',
  'Other (specify below)',
] as const;

// ---------------------------------------------------------------------------
// Confidence helpers
// ---------------------------------------------------------------------------

function confidenceBadgeClasses(pct: number): string {
  if (pct >= 80) return 'bg-green-100 text-green-800';
  if (pct >= 60) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function confidenceBarColor(pct: number): string {
  if (pct >= 80) return '#16A34A';
  if (pct >= 60) return '#F59E0B';
  return '#EF4444';
}

function riskBadge(level: RiskLevel) {
  const map = {
    LOW: { bg: 'bg-green-100', text: 'text-green-800', icon: '\u2705' },
    MEDIUM: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: '\u26A0\uFE0F' },
    HIGH: { bg: 'bg-red-100', text: 'text-red-800', icon: '\u274C' },
  };
  return map[level];
}

function recommendBadge(type: RecommendationType) {
  const map = {
    APPROVE: { bg: 'bg-green-100', text: 'text-green-800', label: 'APPROVE' },
    DENY: { bg: 'bg-red-100', text: 'text-red-800', label: 'DENY — Review Required' },
    NEED_MORE_INFO: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'NEED MORE INFORMATION' },
  };
  return map[type];
}

// Map backend Suggestion.status to display-friendly status for accept/reject UI
function toDisplayStatus(s: Suggestion): 'pending' | 'accepted' | 'rejected' {
  if (s.status === 'selected') return 'accepted';
  if (s.status === 'rejected') return 'rejected';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AIDisclaimerBanner() {
  return (
    <div
      role="banner"
      aria-label="AI Disclaimer"
      data-testid="ai-disclaimer-banner"
      className="rounded-r-md border-l-4 p-4"
      style={{ backgroundColor: '#EFF6FF', borderLeftColor: '#2563EB' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-blue-600 font-bold text-lg" aria-hidden="true">
          i
        </span>
        <div className="text-sm" style={{ color: '#1E3A5F' }}>
          <p className="font-medium">
            AI-generated analysis — not legal advice.
          </p>
          <p className="font-medium">
            Human review required before any decision.
          </p>
          <p className="mt-1 text-xs">
            Powered by Google Gemini + Anthropic Claude via Vertex AI
          </p>
          <div className="mt-2 flex gap-4 text-xs">
            <a
              href="#illinois-hb-3773"
              className="underline hover:text-blue-700"
            >
              Illinois HB 3773 Notice
            </a>
            <a href="#learn-more-ai" className="underline hover:text-blue-700">
              Learn more about AI in AccommodateAI
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} confidence ${value}%`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: confidenceBarColor(value) }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 w-10 text-right">
        {value}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SuggestionSkeleton() {
  return (
    <div
      data-testid="suggestions-loading"
      className="animate-pulse space-y-4"
      aria-label="Loading suggestions"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-4 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rejection Modal
// ---------------------------------------------------------------------------

function RejectSuggestionModal({
  suggestion,
  onClose,
  onConfirm,
}: {
  suggestion: Suggestion;
  onClose: () => void;
  onConfirm: (reason: string, notes: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm(reason, notes);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reject AI Suggestion"
      data-testid="reject-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">
          Reject Suggestion: {suggestion.title}
        </h3>

        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="reject-reason"
              className="block text-sm font-medium text-gray-700"
            >
              Reason for rejection (required):
            </label>
            <select
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="reject-reason-select"
            >
              <option value="">Select reason</option>
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="reject-notes"
              className="block text-sm font-medium text-gray-700"
            >
              Additional notes:
            </label>
            <textarea
              id="reject-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="reject-notes"
            />
          </div>

          <p className="text-xs text-gray-500">
            Note: Rejection reason will be logged in the case audit trail.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!reason}
            data-testid="confirm-rejection-btn"
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual Override Form
// ---------------------------------------------------------------------------

function ManualOverrideForm({
  caseId: _caseId,
  onCancel,
}: {
  caseId: string;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<OverrideAction>('');
  const [description, setDescription] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!action) newErrors.action = 'Please select an action.';
    if (description.length < 20)
      newErrors.description = 'Minimum 20 characters required.';
    if (overrideReason.length < 20)
      newErrors.overrideReason = 'Minimum 20 characters required.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [action, description, overrideReason]);

  const handleSubmit = () => {
    if (!validate()) return;
    alert('Manual override submitted (mock). Would navigate to decision page.');
  };

  return (
    <div
      aria-label="Manual Override Form"
      data-testid="manual-override-form"
      className="rounded-lg border border-orange-200 bg-orange-50 p-6 space-y-4"
    >
      <h3 className="text-lg font-semibold text-gray-900">
        Override AI Recommendation
      </h3>
      <p className="text-sm text-gray-600">
        You are overriding the AI recommendation. Your manual decision will be
        logged alongside the AI suggestion.
      </p>

      {/* Action radio */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-700">
          Your recommended action:
        </legend>
        <div className="mt-2 flex gap-6">
          {(
            [
              ['approve', 'Approve'],
              ['deny', 'Deny'],
              ['need_more_info', 'Need More Information'],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="override-action"
                value={val}
                checked={action === val}
                onChange={() => setAction(val)}
              />
              {label}
            </label>
          ))}
        </div>
        {errors.action && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {errors.action}
          </p>
        )}
      </fieldset>

      {/* Accommodation description */}
      <div>
        <label
          htmlFor="override-desc"
          className="block text-sm font-medium text-gray-700"
        >
          Accommodation description (required):
        </label>
        <textarea
          id="override-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe the accommodation you are recommending..."
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          data-testid="override-description"
        />
        {errors.description && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      {/* Override reason */}
      <div>
        <label
          htmlFor="override-reason"
          className="block text-sm font-medium text-gray-700"
        >
          Override reason (required — why AI recommendation is not used):
        </label>
        <textarea
          id="override-reason"
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          rows={3}
          placeholder="Explain why you are overriding the AI recommendation..."
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          data-testid="override-reason"
        />
        {errors.overrideReason && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {errors.overrideReason}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel Override
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          data-testid="submit-override-btn"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Submit Manual Decision
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State B: Consent Declined
// ---------------------------------------------------------------------------

function ConsentDeclinedView({ caseId: _caseId }: { caseId: string }) {
  return (
    <div data-testid="state-declined" className="space-y-4">
      <div
        aria-label="AI Consent Declined"
        className="rounded-lg border border-red-200 bg-red-50 p-6"
      >
        <h2 className="text-lg font-semibold text-red-800">
          AI Analysis Unavailable — Employee Opted Out
        </h2>
        <p className="mt-2 text-sm text-red-700">
          The employee has declined AI processing for this case. This does not
          affect their accommodation rights.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Consent declined on: 04/05/2026 by Sarah Kim (HR)
          <br />
          Method: In-person
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Use Manual Analysis Instead
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View AI Consent Details
          </button>
        </div>
      </div>

      <div
        aria-label="Manual Analysis Guidance"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <h3 className="text-base font-semibold text-gray-900">
          Manual Analysis Guidance
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Since AI is unavailable, use these resources for manual analysis:
        </p>
        <ol className="mt-3 list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>
            Search JAN SOAR Database:{' '}
            <a
              href="https://askjan.org/soar.cfm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Open JAN SOAR
            </a>
          </li>
          <li>Review similar cases manually in your case archive</li>
          <li>Consult legal counsel for risk assessment</li>
        </ol>
        <button
          type="button"
          className="mt-4 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Enter Manual Analysis Notes
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State C: Consent Pending
// ---------------------------------------------------------------------------

function ConsentPendingView({ caseId }: { caseId: string }) {
  return (
    <div
      data-testid="state-pending"
      aria-label="AI Consent Pending"
      className="rounded-lg border border-yellow-200 bg-yellow-50 p-6"
    >
      <h2 className="text-lg font-semibold text-yellow-800">
        AI Analysis Unavailable — Consent Not Yet Obtained
      </h2>
      <p className="mt-2 text-sm text-yellow-700">
        Employee AI consent must be recorded before AI can analyze this case.
        Consent status: PENDING
      </p>
      <div className="mt-4 flex gap-3">
        <Link
          to={`/cases/${caseId}/ai-consent`}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Request AI Consent
        </Link>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Skip AI — Use Manual Path
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State D: Service Error
// ---------------------------------------------------------------------------

function ServiceErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="state-error"
      aria-label="AI Service Error"
      className="rounded-lg border border-red-200 bg-red-50 p-6"
    >
      <h2 className="text-lg font-semibold text-red-800">
        AI Service Temporarily Unavailable
      </h2>
      <p className="mt-2 text-sm text-red-700">
        Unable to reach AI analysis service. This may be a temporary issue. Your
        case data has not been affected.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          data-testid="retry-btn"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry Analysis
        </button>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Use Manual Analysis Instead
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        If the problem persists, contact support.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State A: Full AI Analysis (Active consent)
// ---------------------------------------------------------------------------

function ActiveAnalysisView({ caseId }: { caseId: string }) {
  const { client } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<Suggestion | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [reanalysisAt, setReanalysisAt] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const riskLevel: RiskLevel = 'LOW';
  const riskConf = 84;
  const recommendation: RecommendationType = 'APPROVE';
  const recommendConf = 88;

  // ---------------------------------------------------------------------------
  // Fetch suggestions from real API
  // ---------------------------------------------------------------------------

  const {
    data: suggestionsData,
    isLoading: isSuggestionsLoading,
    isError: isSuggestionsError,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ['suggestions', caseId],
    queryFn: () => getSuggestions(client, caseId),
    staleTime: 30_000,
    retry: 1,
  });

  const suggestions: Suggestion[] = suggestionsData?.suggestions ?? [];

  // ---------------------------------------------------------------------------
  // Generate suggestions (POST)
  // ---------------------------------------------------------------------------

  const handleGenerateSuggestions = async () => {
    setGenerateError(null);
    setIsGenerating(true);
    try {
      await generateSuggestions(client, caseId);
      await refetchSuggestions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      setGenerateError('Failed to generate suggestions. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Accept suggestion
  // ---------------------------------------------------------------------------

  const handleAcceptSuggestion = async (id: string) => {
    setActionError(null);
    try {
      await acceptSuggestion(client, caseId, id);
      // Invalidate + refetch to get updated status from server
      await queryClient.invalidateQueries({ queryKey: ['suggestions', caseId] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      setActionError('Failed to accept suggestion. Please try again.');
    }
  };

  // ---------------------------------------------------------------------------
  // Reject suggestion
  // ---------------------------------------------------------------------------

  const handleRejectSuggestion = async (reason: string, notes: string) => {
    if (!rejectTarget) return;
    setActionError(null);
    try {
      await rejectSuggestion(client, caseId, rejectTarget.id, reason, notes);
      await queryClient.invalidateQueries({ queryKey: ['suggestions', caseId] });
      setRejectTarget(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      setActionError('Failed to reject suggestion. Please try again.');
      setRejectTarget(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Re-analysis (re-generate with cooldown)
  // ---------------------------------------------------------------------------

  const handleReAnalysis = () => {
    const now = Date.now();
    if (reanalysisAt && now - reanalysisAt < 5 * 60 * 1000) {
      alert('Re-analysis cooldown: please wait 5 minutes between requests.');
      return;
    }
    setReanalysisAt(now);
    alert('Re-analysis requested (mock). Please wait for results.');
    void handleGenerateSuggestions();
  };

  const rb = riskBadge(riskLevel);
  const recBadge = recommendBadge(recommendation);

  return (
    <div data-testid="state-active" className="space-y-6">
      {/* Section 1: AI Case Summary */}
      <section aria-label="AI Case Summary" className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            AI-Generated Case Summary
          </h2>
          <span
            data-testid="summary-confidence"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${confidenceBadgeClasses(87)}`}
          >
            Confidence: 87%
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Source: Gemini 2.5 Pro | Generated: 04/10/2026 14:32 ET
        </p>
        <div className="mt-3 text-sm text-gray-700">
          <p>
            Employee has requested a schedule modification to accommodate
            functional limitations related to medical appointments. The request
            involves flexible start times on Tuesdays and Thursdays (10am
            instead of 8am). Job role (Administrative Assistant) allows schedule
            flexibility with minimal operational impact.
          </p>
          {summaryExpanded && (
            <p className="mt-2">
              The employee&apos;s functional limitations include difficulty with
              early-morning scheduling due to ongoing medical treatment. No
              medical specifics are included in this AI analysis per 29 CFR
              1630.14 confidentiality requirements. The accommodation
              request aligns with both ADA and PWFA protections.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSummaryExpanded(!summaryExpanded)}
          className="mt-2 text-sm text-blue-600 underline hover:text-blue-700"
        >
          {summaryExpanded ? 'Collapse Summary' : 'Expand Full Summary'}
        </button>
      </section>

      {/* Section 2: JAN SOAR Suggestions — real API data */}
      <section
        aria-label="JAN SOAR Suggestions"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Accommodation Suggestions from JAN SOAR Database
            </h2>
            <p className="text-xs text-gray-500">
              Source: Job Accommodation Network (askjan.org) |{' '}
              <a
                href="https://askjan.org/soar.cfm"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                View on JAN
              </a>
            </p>
          </div>
        </div>

        {/* Action error banner */}
        {actionError && (
          <div
            role="alert"
            data-testid="action-error"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {actionError}
          </div>
        )}

        {/* Loading state */}
        {isSuggestionsLoading && (
          <div className="mt-4">
            <SuggestionSkeleton />
          </div>
        )}

        {/* Error state */}
        {isSuggestionsError && !isSuggestionsLoading && (
          <div
            role="alert"
            data-testid="suggestions-error"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            <p className="font-medium">Failed to load suggestions.</p>
            <button
              type="button"
              onClick={() => void refetchSuggestions()}
              className="mt-2 text-blue-600 underline text-xs"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state — no suggestions yet, show Generate button */}
        {!isSuggestionsLoading && !isSuggestionsError && suggestions.length === 0 && (
          <div
            data-testid="no-suggestions"
            className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-6 text-center"
          >
            <p className="text-sm text-blue-800 font-medium">
              No AI suggestions generated yet for this case.
            </p>
            <p className="mt-1 text-xs text-blue-700">
              Click the button below to trigger AI analysis.
            </p>
            {generateError && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {generateError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleGenerateSuggestions()}
              disabled={isGenerating}
              data-testid="generate-suggestions-btn"
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating Analysis…' : 'Generate AI Analysis'}
            </button>
          </div>
        )}

        {/* Suggestions list */}
        {!isSuggestionsLoading && !isSuggestionsError && suggestions.length > 0 && (
          <div className="mt-4 space-y-4">
            {suggestions.map((sug) => {
              const displayStatus = toDisplayStatus(sug);
              return (
                <div
                  key={sug.id}
                  data-testid={`suggestion-${sug.id}`}
                  className={`rounded-lg border p-4 ${
                    displayStatus === 'accepted'
                      ? 'border-green-300 bg-green-50'
                      : displayStatus === 'rejected'
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {sug.title}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${confidenceBadgeClasses(sug.confidence)}`}
                    >
                      {sug.confidence}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    {sug.customizedDescription ?? sug.description}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Source: {sug.source}</p>
                  {sug.implementationCount != null && (
                    <p className="text-xs text-gray-500">
                      Similar to: {sug.implementationCount.toLocaleString()}{' '}
                      successful implementations (JAN data)
                    </p>
                  )}
                  <div className="mt-2">
                    <ConfidenceBar value={sug.confidence} label={sug.title} />
                  </div>
                  {sug.confidence < 60 && (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      WARNING: Low confidence — recommend manual review
                    </p>
                  )}
                  {displayStatus === 'pending' && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleAcceptSuggestion(sug.id)}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Accept Suggestion
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectTarget(sug)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Reject — Log Reason
                      </button>
                    </div>
                  )}
                  {displayStatus === 'accepted' && (
                    <p className="mt-2 text-xs font-semibold text-green-700">
                      Accepted
                    </p>
                  )}
                  {displayStatus === 'rejected' && (
                    <p className="mt-2 text-xs font-semibold text-red-700">
                      Rejected: {sug.rejectionReason ?? 'Reason logged'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Legal Risk Assessment */}
      <section
        aria-label="Legal Risk Assessment"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <h2 className="text-lg font-semibold text-gray-900">Legal Risk Score</h2>
        <div className="mt-3 flex items-center gap-3">
          <span
            data-testid="risk-badge"
            className={`rounded-full px-3 py-1 text-sm font-bold ${rb.bg} ${rb.text}`}
          >
            {rb.icon} {riskLevel} RISK
          </span>
          <span className="text-sm text-gray-600">
            Confidence: {riskConf}% | Source: Gemini 2.5 Pro + Legal Pattern
            Match
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Factors Assessed:
          </h3>
          {STATIC_RISK_FACTORS.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-sm"
              data-testid={`risk-factor-${i}`}
            >
              <span
                className={
                  f.passed ? 'text-green-600' : 'text-red-600'
                }
              >
                {f.passed ? '\u2713' : '\u2717'}
              </span>
              <span className={f.passed ? 'text-gray-700' : 'text-red-700'}>
                {f.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <strong>AI Note:</strong> Schedule modifications for administrative
          roles have very low denial risk. PWFA further strengthens the
          employee&apos;s position. Recommend approval.
        </div>
      </section>

      {/* Section 4: Similar Cases (Anonymized) */}
      <section
        aria-label="Similar Cases"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Similar Past Cases
          </h2>
          <span className="text-xs text-gray-500">
            Source: Internal Database
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {STATIC_SIMILAR_CASES.map((sc) => (
            <div
              key={sc.label}
              data-testid={`similar-case-${sc.label}`}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {sc.label} (Anonymized)
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    sc.outcome.includes('APPROVED')
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {sc.outcome}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                <span>Type: {sc.type}</span>
                <span>Duration: {sc.duration}</span>
                <span>Law: {sc.law}</span>
                <span>Match Score: {sc.matchScore}%</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Key Factor: {sc.keyFactor}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-gray-500 italic">
          All cases anonymized — no employee names or identifying details shown.
        </p>
      </section>

      {/* Section 5: Recommended Action */}
      <section
        aria-label="Recommended Action"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <h2 className="text-lg font-semibold text-gray-900">
          AI Recommendation
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span
            data-testid="recommend-badge"
            className={`rounded-full px-3 py-1 text-sm font-bold ${recBadge.bg} ${recBadge.text}`}
          >
            {recBadge.label}
          </span>
          <span className="text-sm text-gray-600">
            Confidence: {recommendConf}%
          </span>
        </div>
        <div className="mt-3">
          <ConfidenceBar value={recommendConf} label="Recommendation" />
        </div>
        <div className="mt-4 space-y-2 text-sm text-gray-700">
          <p>
            <strong>Recommended Accommodation:</strong> Modified Work Schedule —
            Flexible start time (10:00 AM on Tue/Thu), schedule posted 1 week in
            advance.
          </p>
          <p>
            <strong>Trial period:</strong> 90 days with follow-up review
          </p>
          <p>
            <strong>Rationale:</strong> Low operational impact, strong legal
            support under both ADA and PWFA, consistent with 3 similar approved
            cases.
          </p>
        </div>

        {/* HR Actions */}
        {!showOverride && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to={`/cases/${caseId}/decision`}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Accept &amp; Proceed to Approval
            </Link>
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Override — Enter Manual Decision
            </button>
            <button
              type="button"
              onClick={handleReAnalysis}
              data-testid="reanalysis-btn"
              className="text-sm text-blue-600 underline hover:text-blue-700"
            >
              Request Re-Analysis
            </button>
          </div>
        )}

        {showOverride && (
          <div className="mt-6">
            <ManualOverrideForm
              caseId={caseId}
              onCancel={() => setShowOverride(false)}
            />
          </div>
        )}
      </section>

      {/* Section 6: AI Audit Trail */}
      <section
        aria-label="AI Audit Trail"
        className="rounded-lg border border-gray-200 bg-white p-6"
      >
        <h2 className="text-lg font-semibold text-gray-900">
          AI Analysis Audit Log
        </h2>
        <p className="text-xs text-gray-500">Immutable record</p>

        <div className="mt-4 space-y-3">
          {STATIC_AUDIT_TRAIL.map((entry, i) => (
            <div
              key={i}
              data-testid={`audit-entry-${i}`}
              className="flex gap-3 border-l-2 border-gray-200 pl-3 text-sm"
            >
              <span className="whitespace-nowrap text-xs text-gray-500">
                [{entry.timestamp}]
              </span>
              <span className="whitespace-nowrap text-xs font-semibold text-gray-600">
                [{entry.role}]
              </span>
              <span className="whitespace-nowrap text-xs text-blue-600">
                [{entry.actionType}]
              </span>
              <span className="text-xs text-gray-700">{entry.detail}</span>
            </div>
          ))}
        </div>

        <Link
          to={`/cases/${caseId}/timeline`}
          className="mt-4 inline-block text-sm text-blue-600 underline hover:text-blue-700"
        >
          View Full Case Timeline
        </Link>
      </section>

      {/* Rejection Modal */}
      {rejectTarget && (
        <RejectSuggestionModal
          suggestion={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason, notes) => void handleRejectSuggestion(reason, notes)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

interface AIAnalysisPageProps {
  defaultConsentState?: ConsentState;
}

export function AIAnalysisPage({ defaultConsentState = 'pending' }: AIAnalysisPageProps) {
  const { id } = useParams<{ id: string }>();
  const caseId = id ?? 'unknown';

  // Consent state: in this phase, the defaultConsentState prop drives the state.
  // A future task will load this from the case API (/cases/:id → aiConsentStatus).
  const [consentState] = useState<ConsentState>(defaultConsentState);
  const [, setRetryCount] = useState(0);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    // In a future task: re-trigger the AI analysis endpoint
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6" data-testid="ai-analysis-page">
      {/* Back link */}
      <Link
        to={`/cases/${caseId}`}
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
      >
        &larr; Back to Case
      </Link>

      <h1 className="text-2xl font-bold text-gray-900">
        AI Analysis &amp; Suggestions
      </h1>

      {/* AI Disclaimer Banner — NON-DISMISSIBLE (always shown) */}
      <AIDisclaimerBanner />

      {/* State-based rendering */}
      {consentState === 'active' && <ActiveAnalysisView caseId={caseId} />}
      {consentState === 'declined' && <ConsentDeclinedView caseId={caseId} />}
      {consentState === 'pending' && <ConsentPendingView caseId={caseId} />}
      {consentState === 'error' && <ServiceErrorView onRetry={handleRetry} />}
    </div>
  );
}

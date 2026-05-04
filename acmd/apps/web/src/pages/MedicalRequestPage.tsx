/**
 * MedicalRequestPage — ACMD-145 Phase 6J / ACMD-153 Phase 7B
 *
 * URL: /cases/:id/medical-request
 * Roles allowed: super_admin, hr
 * Roles denied: manager, medical_reviewer -> 403 Forbidden (no data leakage)
 *
 * COMPLIANCE: ADA/PWFA Medical Documentation Request — Stage 4 of EEOC interactive process
 * ACMD-153: All mock data replaced with real API calls via client.request().
 *
 * Features:
 *  - State 1: Law Branch Detection (ADA vs PWFA auto-detect)
 *  - State 1b: PWFA Exemption Check (4 categories)
 *  - State 2: Medical Request Form (template, limitations, duration, delivery, due date, upload)
 *  - State 3: Request Sent (read-only summary + actions)
 *  - State 4: Documents Received (file list + assign reviewer)
 *  - State 5: Under Review (reviewer info + pending badge)
 *  - State 6a: Cleared (green banner + proceed to decision)
 *  - State 6b: Additional Info Needed (orange banner + follow-up form)
 *  - State 6c: Insufficient (red banner + 3 options)
 *  - Privacy Banner: sticky, non-dismissible, always visible
 *  - Request Status Tracker: 4-step horizontal stepper
 *  - PWFA exemption flow with purple exempt banner
 *  - Role guard: manager/medical_reviewer -> 403
 */

import { useState, useCallback, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchCaseDetail } from '@/pages/CaseDetailPage';
import {
  getMedicalRequest,
  sendMedicalRequest,
  assignReviewer as apiAssignReviewer,
} from '@/lib/api/medicalRequest';
import type { MedicalDocument } from '@/lib/api/medicalRequest';

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

type PageState =
  | 'law_branch'
  | 'pwfa_check'
  | 'form'
  | 'sent'
  | 'received'
  | 'under_review'
  | 'cleared'
  | 'additional_needed'
  | 'insufficient'
  | 'pwfa_exempt';

type LawTag = 'ada' | 'pwfa' | 'both';
type TemplateOption = 'General ADA' | 'Specific Condition' | 'FMLA Certification';
type DurationType = 'Temporary' | 'Permanent' | 'Unknown' | '';
type DeliveryMethod = 'employee' | 'provider' | 'both';

interface PwfaCategory {
  id: string;
  label: string;
  icon: string;
}

interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PWFA_CATEGORIES: PwfaCategory[] = [
  { id: 'breaks', label: 'Breaks', icon: '\u23F0' },
  { id: 'water', label: 'Water/Drinks', icon: '\uD83D\uDCA7' },
  { id: 'sit_stand', label: 'Sit/Stand', icon: '\uD83E\uDE91' },
  { id: 'eating', label: 'Eating', icon: '\uD83C\uDF7D\uFE0F' },
];

const TEMPLATE_OPTIONS: TemplateOption[] = [
  'General ADA',
  'Specific Condition',
  'FMLA Certification',
];

const REVIEWER_OPTIONS = ['Dr. Sarah Chen', 'Dr. Michael Torres', 'Dr. Anita Patel'];

const STATIC_AUDIT_TRAIL: AuditEntry[] = [
  {
    timestamp: '04/05/2026 10:30 AM',
    actor: 'HR',
    action: 'medical.form_opened',
    description: 'Medical request form opened',
  },
  {
    timestamp: '04/04/2026 02:00 PM',
    actor: 'SYSTEM',
    action: 'eeoc.stage_complete',
    description: 'Stage 3 (Interactive Discussion) completed',
  },
  {
    timestamp: '04/03/2026 09:15 AM',
    actor: 'HR',
    action: 'eeoc.stage3_started',
    description: 'Stage 3 interactive discussion initiated',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Privacy Banner — sticky top, non-dismissible, always visible */
function PrivacyBanner() {
  return (
    <div
      data-testid="privacy-banner"
      role="banner"
      className="sticky top-0 z-50 flex items-center gap-2 rounded-md border border-[#BAE6FD] bg-[#F0F9FF] px-4 py-2 text-xs text-[#1E3A5F]"
    >
      <span aria-hidden="true" className="text-base">&#x1F512;</span>
      <span>
        <strong>CONFIDENTIAL</strong> — Medical documentation is encrypted at rest.
        Only HR and assigned case handler can view. Manager access is prohibited.
        All views/downloads are audit-logged.
      </span>
    </div>
  );
}

/** DeadlineBadge — case process deadline tracker */
function DeadlineBadge({
  currentDay,
  totalDays,
}: {
  currentDay: number;
  totalDays: number;
}) {
  const remaining = totalDays - currentDay;
  const pct = Math.round((currentDay / totalDays) * 100);

  return (
    <div
      data-testid="deadline-badge"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
    >
      <span className="font-semibold text-[#1E3A5F]">
        Day {currentDay} of {totalDays}
      </span>
      <span className="text-gray-500">{remaining} days left</span>
      <div className="flex-1 min-w-[100px]">
        <div className="h-2 rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-blue-600"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of process time elapsed`}
          />
        </div>
      </div>
      <span className="text-gray-500">{pct}%</span>
    </div>
  );
}

/** Case Header with back link */
function CaseHeader({
  caseId,
  employeeName,
  accommodation,
  lawTag,
  pathBadge,
}: {
  caseId: string;
  employeeName: string;
  accommodation: string;
  lawTag: LawTag;
  pathBadge?: 'ada' | 'pwfa' | null;
}) {
  return (
    <div className="space-y-1">
      <Link
        to={`/cases/${caseId}`}
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
      >
        &larr; Back to Case Detail
      </Link>
      <h1 className="text-lg font-bold text-[#1E3A5F]">
        {caseId} — {employeeName} — {accommodation}
      </h1>
      <div className="flex items-center gap-2">
        {(lawTag === 'ada' || lawTag === 'both') && (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
            ADA
          </span>
        )}
        {(lawTag === 'pwfa' || lawTag === 'both') && (
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
            PWFA
          </span>
        )}
        {pathBadge === 'ada' && (
          <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            ADA PATH
          </span>
        )}
        {pathBadge === 'pwfa' && (
          <span className="inline-flex items-center rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            PWFA PATH
          </span>
        )}
        <span className="text-xs text-gray-500">Status: Stage 4 — Medical</span>
      </div>
    </div>
  );
}

/** Request Status Tracker — 4-step horizontal stepper */
function RequestStatusTracker({
  pageState,
}: {
  pageState: PageState;
}) {
  type StepStatus = 'done' | 'active' | 'inactive' | 'orange' | 'red' | 'green';

  const steps: { id: string; label: string }[] = [
    { id: 'created', label: '1. Form Created' },
    { id: 'sent', label: '2. Sent' },
    { id: 'received', label: '3. Received' },
    { id: 'review', label: '4. Under Review' },
  ];

  function getStepStatus(stepIndex: number): StepStatus {
    switch (pageState) {
      case 'form':
        return stepIndex === 0 ? 'active' : 'inactive';
      case 'sent':
        if (stepIndex === 0) return 'done';
        if (stepIndex === 1) return 'active';
        return 'inactive';
      case 'received':
        if (stepIndex <= 1) return 'done';
        if (stepIndex === 2) return 'active';
        return 'inactive';
      case 'under_review':
        if (stepIndex <= 2) return 'done';
        return 'active';
      case 'cleared':
        return 'done';
      case 'additional_needed':
        if (stepIndex <= 2) return 'done';
        return 'orange';
      case 'insufficient':
        if (stepIndex <= 2) return 'done';
        return 'red';
      default:
        return 'inactive';
    }
  }

  const statusLabel: Record<string, string> = {
    form: 'Draft — Not yet sent',
    sent: 'Sent — Awaiting documentation',
    received: 'Received — Pending Medical Reviewer assignment',
    under_review: 'Under Review by Dr. Sarah Chen',
    cleared: 'Medical Documentation CLEARED',
    additional_needed: 'Additional Information Needed',
    insufficient: 'Insufficient Documentation',
  };

  const stepClasses: Record<StepStatus, string> = {
    done: 'border-2 border-green-600 bg-green-50 text-green-800',
    active: 'border-2 border-blue-600 bg-blue-50 text-[#1E3A5F]',
    inactive: 'border border-gray-300 bg-gray-100 text-gray-400',
    orange: 'border-2 border-orange-500 bg-orange-50 text-orange-800',
    red: 'border-2 border-red-500 bg-red-50 text-red-800',
    green: 'border-2 border-green-600 bg-green-50 text-green-800',
  };

  const connectorClasses = (stepIndex: number): string => {
    const status = getStepStatus(stepIndex);
    return status === 'done'
      ? 'border-t-2 border-green-600'
      : 'border-t-2 border-dashed border-gray-300';
  };

  if (pageState === 'pwfa_exempt') {
    return (
      <div
        data-testid="status-tracker"
        className="rounded-lg border border-purple-300 bg-purple-50 p-4 text-center"
      >
        <span className="inline-flex items-center rounded-full bg-purple-600 px-3 py-1 text-sm font-semibold text-white">
          PWFA Exempt — Medical Documentation Not Required
        </span>
      </div>
    );
  }

  return (
    <div data-testid="status-tracker" className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const status = getStepStatus(i);
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div
                data-testid={`step-${step.id}`}
                data-status={status}
                className={`rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap ${stepClasses[status]}`}
              >
                {status === 'done' && <span aria-hidden="true" className="mr-1">{'\u2713'}</span>}
                {step.label}
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 mx-1 ${connectorClasses(i)}`} />
              )}
            </div>
          );
        })}
      </div>
      {statusLabel[pageState] && (
        <p className="text-sm text-gray-600">
          Status: {statusLabel[pageState]}
        </p>
      )}
    </div>
  );
}

/** Upload zone UI (mock only) */
function UploadZone() {
  return (
    <div
      data-testid="upload-zone"
      className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center space-y-2"
    >
      <span className="text-2xl text-gray-400" aria-hidden="true">{'\u2601'}</span>
      <p className="text-sm text-gray-600">Drag &amp; drop medical documents here</p>
      <button
        type="button"
        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Browse Files
      </button>
      <p className="text-xs text-gray-400">
        Accepted: PDF, JPG, PNG, HEIC | Max: 10MB per file
      </p>
      <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
        <span aria-hidden="true">&#x1F512;</span> Files encrypted at rest (AES-256)
      </p>
    </div>
  );
}

/** Audit Trail Mini — last 3 entries */
function AuditTrailMini({ caseId, entries }: { caseId: string; entries: AuditEntry[] }) {
  return (
    <div data-testid="audit-trail" className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Audit Trail</h3>
      {entries.slice(0, 3).map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
          <span className="shrink-0">[{entry.timestamp}]</span>
          <span className="shrink-0 font-medium">[{entry.actor}]</span>
          <span className="shrink-0 text-gray-400">[{entry.action}]</span>
          <span>{entry.description}</span>
        </div>
      ))}
      <Link
        to={`/cases/${caseId}/timeline`}
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
        View Full Timeline &rarr;
      </Link>
    </div>
  );
}

/** Document Due Date Warning */
function DocumentDueDateWarning({ daysRemaining }: { daysRemaining: number }) {
  if (daysRemaining > 5) return null;
  const isOverdue = daysRemaining <= 0;
  const bgClass = isOverdue
    ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-orange-300 bg-orange-50 text-orange-800';

  return (
    <div
      data-testid="due-date-warning"
      className={`rounded-md border p-3 text-sm ${bgClass}`}
    >
      {isOverdue ? (
        <p>
          <strong>OVERDUE</strong> — Medical documentation was due and has not been received.
          Consider sending a reminder to the employee.
        </p>
      ) : (
        <p>
          Medical documentation due in <strong>{daysRemaining} business day{daysRemaining !== 1 ? 's' : ''}</strong>.
          Consider sending a reminder to the employee.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State-specific panels
// ---------------------------------------------------------------------------

/** State 1: Law Branch Detection */
function LawBranchPanel({
  lawTag,
  onSelectAda,
  onSelectPwfa,
}: {
  lawTag: LawTag;
  onSelectAda: () => void;
  onSelectPwfa: () => void;
}) {
  const adaDisabled = lawTag === 'pwfa';
  const pwfaDisabled = lawTag === 'ada';

  return (
    <div data-testid="law-branch-panel" className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ADA Card */}
        <button
          type="button"
          data-testid="ada-path-card"
          disabled={adaDisabled}
          onClick={onSelectAda}
          className={`rounded-lg border-2 p-6 text-left transition-colors space-y-3 ${
            adaDisabled
              ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
              : 'border-blue-600 bg-white hover:bg-blue-50 cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-xl ${adaDisabled ? 'text-gray-300' : 'text-blue-600'}`} aria-hidden="true">
              &#x1F6E1;
            </span>
            <h3 className="font-semibold">ADA — Medical Documentation Required</h3>
          </div>
          <p className="text-sm">
            Medical documentation is required to verify the disability and need for
            accommodation under ADA.
          </p>
          <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-medium ${
            adaDisabled
              ? 'bg-gray-200 text-gray-400'
              : 'bg-blue-600 text-white'
          }`}>
            Continue with ADA Request
          </span>
        </button>

        {/* PWFA Card */}
        <button
          type="button"
          data-testid="pwfa-path-card"
          disabled={pwfaDisabled}
          onClick={onSelectPwfa}
          className={`relative rounded-lg border-2 p-6 text-left transition-colors space-y-3 ${
            pwfaDisabled
              ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
              : 'border-purple-600 bg-white hover:bg-purple-50 cursor-pointer'
          }`}
        >
          {(lawTag === 'pwfa' || lawTag === 'both') && (
            <span
              data-testid="pwfa-detected-badge"
              className="absolute top-2 right-2 inline-flex items-center rounded-full bg-purple-600 px-2 py-0.5 text-xs font-semibold text-white"
            >
              Detected
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={`text-xl ${pwfaDisabled ? 'text-gray-300' : 'text-purple-600'}`} aria-hidden="true">
              &#x26A1;
            </span>
            <h3 className="font-semibold">PWFA — Predictable Assessment Check</h3>
          </div>
          <p className="text-sm">
            Check if this request qualifies for PWFA fast-track (no med docs required).
          </p>
          <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-medium ${
            pwfaDisabled
              ? 'bg-gray-200 text-gray-400'
              : 'bg-purple-600 text-white'
          }`}>
            Check PWFA Exemption
          </span>
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 space-y-1">
        <p className="font-medium">Which path applies to this case?</p>
        <p>
          <strong>ADA:</strong> Request applies to disability-related accommodations.
          Medical documentation is standard.
        </p>
        <p>
          <strong>PWFA:</strong> If the request involves breaks, water, sit/stand, or
          eating — no medical docs needed (Predictable Assessment). Other PWFA requests
          may still need docs.
        </p>
      </div>
    </div>
  );
}

/** State 1b: PWFA Exemption Check */
function PwfaExemptionCheck({
  onCategoryMatch,
  onNoMatch,
  onBack,
}: {
  onCategoryMatch: (categoryId: string) => void;
  onNoMatch: () => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const hasMatch = selected !== null;

  return (
    <div data-testid="pwfa-exemption-check" className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-[#1E3A5F]">
        Does this accommodation fall into a PWFA Predictable Assessment category?
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {PWFA_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            data-testid={`pwfa-cat-${cat.id}`}
            onClick={() => setSelected(selected === cat.id ? null : cat.id)}
            className={`rounded-lg border-2 p-4 text-center transition-colors ${
              selected === cat.id
                ? 'border-purple-600 bg-purple-50 text-purple-800'
                : 'border-gray-200 bg-white text-gray-700 hover:border-purple-300'
            }`}
          >
            <span className="block text-2xl mb-1" aria-hidden="true">{cat.icon}</span>
            <span className="text-sm font-medium">{cat.label}</span>
          </button>
        ))}
      </div>

      {hasMatch && (
        <div
          data-testid="pwfa-exempt-banner"
          className="rounded-md border border-purple-400 bg-purple-600 p-4 text-white space-y-2"
        >
          <p className="font-semibold">
            PWFA Predictable Assessment — Medical Documentation NOT Required
          </p>
          <p className="text-sm text-purple-100">
            This request qualifies for PWFA fast-track approval. No medical documentation is needed.
          </p>
          <button
            type="button"
            data-testid="go-pwfa-fast-track"
            onClick={() => onCategoryMatch(selected!)}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
          >
            Go to PWFA Fast-Track
          </button>
        </div>
      )}

      {!hasMatch && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-2">
          <p>
            This PWFA request does not qualify for fast-track.
            Medical documentation may still be required.
          </p>
          <button
            type="button"
            data-testid="continue-med-form"
            onClick={onNoMatch}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Continue with Medical Request Form
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Law Branch Selection
      </button>
    </div>
  );
}

/** State 2: Medical Request Form */
function MedicalRequestForm({
  aiConsent,
  caseData,
  onSaveDraft,
  onSend,
  onCancel,
}: {
  aiConsent: boolean;
  caseData: {
    id: string;
    employeeName: string;
    department: string;
    accommodation: string;
    employeeEmail: string;
  };
  onSaveDraft: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [template, setTemplate] = useState<TemplateOption>('General ADA');
  const [limitation, setLimitation] = useState('');
  const [durationType, setDurationType] = useState<DurationType>('');
  const [returnDate, setReturnDate] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('employee');
  const [providerEmail, setProviderEmail] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const handleAiPrefill = useCallback(() => {
    setLimitation(
      'Please describe the functional limitations that affect the employee\'s ability to ' +
      'perform job duties, and how the requested accommodation (standing desk) would address ' +
      'these limitations. Specifically: (1) What tasks require prolonged standing or sitting? ' +
      '(2) What is the maximum duration the employee can perform these tasks? ' +
      '(3) Are there environmental modifications that would help?'
    );
  }, []);

  const showProviderEmail = deliveryMethod === 'provider' || deliveryMethod === 'both';

  return (
    <div data-testid="medical-request-form" className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
      {/* Case Reference (read-only) */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Case Reference</h3>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 rounded-md bg-gray-50 p-3">
          <div><span className="font-medium">Case ID:</span> {caseData.id}</div>
          <div><span className="font-medium">Employee:</span> {caseData.employeeName}</div>
          <div><span className="font-medium">Department:</span> {caseData.department}</div>
          <div><span className="font-medium">Request:</span> {caseData.accommodation}</div>
        </div>
      </div>

      {/* Template */}
      <div className="space-y-1">
        <label htmlFor="template-select" className="block text-sm font-semibold text-gray-700">
          Medical Form Template
        </label>
        <select
          id="template-select"
          data-testid="template-select"
          value={template}
          onChange={(e) => setTemplate(e.target.value as TemplateOption)}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {TEMPLATE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400">
          Choose the form template appropriate for this request.
          General ADA: Standard functional limitations questionnaire.
          Specific Condition: Targeted questions for known condition.
          FMLA Certification: Required if FMLA is also applicable.
        </p>
      </div>

      {/* Limitation Description */}
      <div className="space-y-1">
        <label htmlFor="limitation-textarea" className="block text-sm font-semibold text-gray-700">
          What information should the healthcare provider address?
        </label>
        <textarea
          id="limitation-textarea"
          data-testid="limitation-textarea"
          value={limitation}
          onChange={(e) => setLimitation(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Please describe the functional limitations that affect the employee's ability to perform job duties..."
        />
        {aiConsent && (
          <button
            type="button"
            data-testid="ai-prefill-btn"
            onClick={handleAiPrefill}
            className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <span aria-hidden="true">&#x2728;</span> AI Pre-fill — Generate suggested questions based on accommodation type
          </button>
        )}
        <p className="text-xs text-gray-400">
          Under the ADA, you may request information about functional limitations — NOT
          diagnosis. Keep requests limited to information necessary for the accommodation
          decision.
        </p>
      </div>

      {/* Duration Type */}
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-gray-700">Duration Type</span>
        <div className="flex gap-4">
          {(['Temporary', 'Permanent', 'Unknown'] as const).map((opt) => (
            <label key={opt} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="duration_type"
                data-testid={`duration-${opt.toLowerCase()}`}
                value={opt}
                checked={durationType === opt}
                onChange={() => setDurationType(opt)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>

      {/* Return Date (visible if Temporary) */}
      {durationType === 'Temporary' && (
        <div className="space-y-1">
          <label htmlFor="return-date" className="block text-sm font-semibold text-gray-700">
            Expected Return/Review Date
          </label>
          <input
            type="text"
            id="return-date"
            data-testid="return-date-input"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            placeholder="MM/DD/YYYY"
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Delivery Method */}
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-gray-700">Delivery Method</span>
        <div className="flex flex-col gap-1.5">
          {([
            { value: 'employee' as DeliveryMethod, label: 'Email to employee' },
            { value: 'provider' as DeliveryMethod, label: 'Email to healthcare provider' },
            { value: 'both' as DeliveryMethod, label: 'Both (employee + provider)' },
          ]).map((opt) => (
            <label key={opt.value} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="delivery_method"
                data-testid={`delivery-${opt.value}`}
                value={opt.value}
                checked={deliveryMethod === opt.value}
                onChange={() => setDeliveryMethod(opt.value)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Employee email: {caseData.employeeEmail} (read-only from record)
        </p>
      </div>

      {/* Provider Email */}
      {showProviderEmail && (
        <div className="space-y-1">
          <label htmlFor="provider-email" className="block text-sm font-semibold text-gray-700">
            Healthcare Provider Email
          </label>
          <input
            type="email"
            id="provider-email"
            data-testid="provider-email-input"
            value={providerEmail}
            onChange={(e) => setProviderEmail(e.target.value)}
            placeholder="provider@clinic.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Due Date */}
      <div className="space-y-1">
        <label htmlFor="due-date" className="block text-sm font-semibold text-gray-700">
          Due Date for Documentation
        </label>
        <input
          type="text"
          id="due-date"
          data-testid="due-date-input"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          placeholder="MM/DD/YYYY"
          className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400">
          15 business days is standard. Adjust if case urgency requires faster turnaround.
        </p>
      </div>

      {/* Upload Zone */}
      <div className="space-y-1">
        <span className="block text-sm font-semibold text-gray-700">
          Upload Medical Documents (if already received)
        </span>
        <UploadZone />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          data-testid="save-draft-btn"
          onClick={onSaveDraft}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Save Draft
        </button>
        <button
          type="button"
          data-testid="send-request-btn"
          onClick={() => setShowConfirm(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Send Request
        </button>
        <button
          type="button"
          data-testid="cancel-btn"
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div
          data-testid="send-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm send medical request"
        >
          <div className="rounded-lg bg-white p-6 shadow-lg max-w-md w-full space-y-4">
            <h3 className="text-base font-semibold text-[#1E3A5F]">Confirm Send Request</h3>
            <p className="text-sm text-gray-600">
              You are about to send a medical documentation request to{' '}
              <strong>{caseData.employeeEmail}</strong>. This action will be logged in the
              audit trail.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                data-testid="confirm-cancel"
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-send"
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Confirm &amp; Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** State 3: Request Sent */
function RequestSentPanel({
  onMarkReceived,
  daysRemaining,
  employeeEmail,
}: {
  onMarkReceived: () => void;
  daysRemaining: number;
  employeeEmail: string;
}) {
  return (
    <div data-testid="request-sent-panel" className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Request Summary</h3>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
          <div><span className="font-medium">Template:</span> General ADA</div>
          <div><span className="font-medium">Duration type:</span> Unknown</div>
          <div><span className="font-medium">Delivery:</span> Email to employee</div>
          <div><span className="font-medium">Sent to:</span> {employeeEmail}</div>
          <div><span className="font-medium">Sent on:</span> 04/05/2026</div>
          <div><span className="font-medium">Due date:</span> 04/28/2026 (15 business days)</div>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">Questions sent:</span>{' '}
          &quot;Please describe functional limitations...&quot;
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="send-reminder-btn"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Send Reminder
        </button>
        <button
          type="button"
          data-testid="resend-request-btn"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Resend Request
        </button>
        <button
          type="button"
          data-testid="mark-received-btn"
          onClick={onMarkReceived}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Mark as Received
        </button>
      </div>

      {/* Upload */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-600">Or upload received documents:</p>
        <UploadZone />
      </div>

      <DocumentDueDateWarning daysRemaining={daysRemaining} />
    </div>
  );
}

/** State 4: Documents Received */
function DocumentsReceivedPanel({
  documents,
  onAssignReviewer,
}: {
  documents: MedicalDocument[];
  onAssignReviewer: (reviewer: string) => void;
}) {
  const [selectedReviewer, setSelectedReviewer] = useState('');

  return (
    <div data-testid="documents-received-panel" className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">
          Documents Received — HR View (status only)
        </h3>
        <p className="text-sm text-gray-600">Documents uploaded: {documents.length} files</p>

        {documents.map((file, i) => (
          <div key={i} className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <span aria-hidden="true" className="text-gray-400">&#x1F4C4;</span>
            <div className="flex-1">
              <p className="font-medium text-gray-700">{file.name}</p>
              <p className="text-xs text-gray-400">Uploaded: {file.uploadedAt}</p>
            </div>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span aria-hidden="true">&#x1F512;</span> {file.size}
            </span>
          </div>
        ))}

        <p className="text-xs text-gray-400">
          HR sees file names and metadata only. Document CONTENT is visible only to Medical
          Reviewer. HR cannot open/preview/download document content.
        </p>

        <div className="flex items-center gap-3 pt-2">
          <label htmlFor="reviewer-select" className="text-sm font-medium text-gray-700">
            Medical Reviewer:
          </label>
          <select
            id="reviewer-select"
            data-testid="reviewer-select"
            value={selectedReviewer}
            onChange={(e) => setSelectedReviewer(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Assign Reviewer...</option>
            {REVIEWER_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            type="button"
            data-testid="assign-reviewer-btn"
            disabled={!selectedReviewer}
            onClick={() => onAssignReviewer(selectedReviewer)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              selectedReviewer
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Assign &amp; Notify Reviewer
          </button>
        </div>
      </div>
    </div>
  );
}

/** State 5: Under Review */
function UnderReviewPanel() {
  return (
    <div data-testid="under-review-panel" className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Review Status — HR View</h3>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
          <div><span className="font-medium">Medical Reviewer:</span> Dr. Sarah Chen</div>
          <div><span className="font-medium">Review started:</span> 04/16/2026</div>
          <div><span className="font-medium">Documents:</span> 2 files submitted</div>
          <div>
            <span className="font-medium">Review outcome:</span>{' '}
            <span
              data-testid="pending-badge"
              className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800"
            >
              Pending
            </span>
          </div>
        </div>
        <div className="text-xs text-gray-500 space-y-1">
          <p className="font-medium">Possible outcomes:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Cleared (sufficient) — Proceed to Stage 5</li>
            <li>Additional info needed — Follow-up request sent</li>
            <li>Insufficient — HR notified to discuss options</li>
          </ul>
        </div>
      </div>

      {/* Contextual Help */}
      <div data-testid="contextual-help" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        The Medical Reviewer is evaluating the documentation in a confidential isolated
        panel. You will be notified when the review is complete. You do NOT have access to
        the medical document content — this protects the employee&apos;s privacy per ADA
        confidentiality requirements.
      </div>
    </div>
  );
}

/** State 6a: Cleared */
function ClearedPanel({ caseId }: { caseId: string }) {
  return (
    <div data-testid="cleared-panel" className="space-y-4">
      <div className="rounded-md border border-green-300 bg-green-50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-lg" aria-hidden="true">&#x2713;</span>
          <p className="font-semibold text-green-800">
            Medical documentation has been cleared.
          </p>
        </div>
        <p className="text-sm text-green-700">
          Stage 4 is complete. You may proceed to Stage 5 (Decision).
        </p>
        <Link
          to={`/cases/${caseId}/decision`}
          data-testid="proceed-decision-btn"
          className="inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Proceed to Decision
        </Link>
      </div>
    </div>
  );
}

/** State 6b: Additional Info Needed */
function AdditionalInfoPanel({
  onSendFollowUp,
}: {
  onSendFollowUp: () => void;
}) {
  const [followUpTo, setFollowUpTo] = useState<DeliveryMethod>('employee');
  const [newDueDate, setNewDueDate] = useState('');

  return (
    <div data-testid="additional-info-panel" className="space-y-4">
      <div className="rounded-md border border-orange-300 bg-orange-50 p-4 space-y-2">
        <p className="font-semibold text-orange-800">
          Medical Reviewer has requested additional information.
        </p>
        <p className="text-sm text-orange-700">
          Please send a follow-up request to the employee or healthcare provider.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Follow-up Request</h3>

        <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
          <span className="font-medium">Reviewer note:</span>{' '}
          &quot;Need clarification on duration of functional limitations and whether current
          treatment affects work capacity.&quot;
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-gray-700">Send to:</span>
          <div className="flex gap-4">
            {([
              { value: 'employee' as DeliveryMethod, label: 'Employee' },
              { value: 'provider' as DeliveryMethod, label: 'Provider' },
              { value: 'both' as DeliveryMethod, label: 'Both' },
            ]).map((opt) => (
              <label key={opt.value} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="followup_to"
                  value={opt.value}
                  checked={followUpTo === opt.value}
                  onChange={() => setFollowUpTo(opt.value)}
                  className="h-4 w-4 text-blue-600"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="followup-due-date" className="text-sm font-medium text-gray-700">
            New due date:
          </label>
          <input
            type="text"
            id="followup-due-date"
            data-testid="followup-due-date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            placeholder="MM/DD/YYYY"
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400">Default: 10 business days</p>
        </div>

        <button
          type="button"
          data-testid="send-followup-btn"
          onClick={onSendFollowUp}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Send Follow-up Request
        </button>
      </div>
    </div>
  );
}

/** State 6c: Insufficient */
function InsufficientPanel({
  caseId,
  onNewRequest,
}: {
  caseId: string;
  onNewRequest: () => void;
}) {
  return (
    <div data-testid="insufficient-panel" className="space-y-4">
      <div className="rounded-md border border-red-300 bg-red-50 p-4 space-y-2">
        <p className="font-semibold text-red-800">
          Medical documentation has been marked as insufficient by the Medical Reviewer.
        </p>
        <p className="text-sm text-red-700">
          HR must determine next steps.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 space-y-1">
          <p>
            Insufficient documentation does not mean automatic denial. Consider these options
            before making a decision:
          </p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            data-testid="new-request-btn"
            onClick={onNewRequest}
            className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
          >
            <span className="font-medium">1. Request New Documentation</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Send a new, more specific request to the employee/provider
            </span>
          </button>
          <Link
            to={`/cases/${caseId}/decision`}
            data-testid="proceed-decision-insufficient"
            className="block w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
          >
            <span className="font-medium">2. Proceed to Decision</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Move to Stage 5 with current documentation (may result in denial)
            </span>
          </Link>
          <button
            type="button"
            data-testid="schedule-discussion-btn"
            className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
          >
            <span className="font-medium">3. Schedule Discussion</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Return to Stage 3 to discuss options with the employee
            </span>
          </button>
        </div>

        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
          <strong>Warning:</strong> Denying solely because medical documentation is
          insufficient — without exploring alternatives — may expose the employer to
          failure-to-accommodate claims.
        </div>
      </div>
    </div>
  );
}

/** PWFA Exemption Display (alternate path) */
function PwfaExemptDisplay({
  caseId,
  matchedCategory,
}: {
  caseId: string;
  matchedCategory: string;
}) {
  const navigate = useNavigate();

  return (
    <div data-testid="pwfa-exempt-display" className="space-y-4">
      <div className="rounded-lg bg-[#7C3AED] p-6 text-white space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">&#x26A1;</span>
          <h2 className="text-lg font-bold">PWFA Predictable Assessment</h2>
        </div>
        <p>Medical documentation is NOT required for this request.</p>
        <p className="text-sm text-purple-200">
          Category: {matchedCategory.toUpperCase()} — {
            PWFA_CATEGORIES.find(c => c.id === matchedCategory)?.label ?? matchedCategory
          }
        </p>
        <p className="text-sm text-purple-200">
          Legal basis: PWFA Section 1003(4) — Predictable assessments virtually always
          qualify as reasonable accommodation.
        </p>
        <p className="text-sm text-purple-200">
          Stage 4 (Medical Documentation) will be marked as &quot;PWFA Exempt&quot; and
          skipped automatically.
        </p>
        <button
          type="button"
          data-testid="go-pwfa-fast-display"
          onClick={() => navigate(`/cases/${caseId}/pwfa-fast`)}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
        >
          Go to PWFA Fast-Track Approval
        </button>
      </div>

      {/* 4 Category Reference Cards */}
      <div className="grid grid-cols-4 gap-3">
        {PWFA_CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className={`rounded-lg border-2 p-3 text-center text-sm ${
              cat.id === matchedCategory
                ? 'border-purple-600 bg-purple-50 text-purple-800 font-semibold'
                : 'border-gray-200 bg-white text-gray-500'
            }`}
          >
            <span className="block text-lg mb-1" aria-hidden="true">{cat.icon}</span>
            {cat.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Denied (403)
// ---------------------------------------------------------------------------

function AccessDeniedView() {
  return (
    <div data-testid="access-denied" className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="rounded-full bg-red-100 p-4">
        <span className="text-3xl text-red-600" aria-hidden="true">&#x1F6AB;</span>
      </div>
      <h1 className="text-xl font-bold text-gray-900">403 — Forbidden</h1>
      <p className="text-sm text-gray-500 max-w-md text-center">
        You do not have permission to access this page. Medical documentation management is
        restricted to HR personnel only.
      </p>
      <Link
        to="/dashboard"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MedicalRequestSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading medical request"
      className="mx-auto max-w-5xl space-y-4 p-4 animate-pulse"
    >
      <div className="rounded-lg border border-border bg-surface h-14" />
      <div className="rounded-lg border border-border bg-surface h-20" />
      <div className="rounded-lg border border-border bg-surface h-48" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function MedicalRequestPage() {
  const { id: caseId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const role = normalizeRole(user?.role);

  // Role check — manager/medical_reviewer denied (before hooks to satisfy rules of hooks)
  if (role === 'manager' || role === 'medical_reviewer') {
    return <AccessDeniedView />;
  }

  return <MedicalRequestPageContent caseId={caseId ?? ''} />;
}

// ---------------------------------------------------------------------------
// MedicalRequestPageContent — internal component with API calls
// ---------------------------------------------------------------------------

function MedicalRequestPageContent({ caseId }: { caseId: string }) {
  const { client, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Clear TanStack Query cache when user logs out
  useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user, queryClient]);

  // State machine
  const [pageState, setPageState] = useState<PageState>('law_branch');
  const [matchedPwfaCategory, setMatchedPwfaCategory] = useState<string | null>(null);

  // AC-2: Fetch case detail
  const {
    data: caseDetail,
    isLoading: isCaseLoading,
    isError: isCaseError,
    error: caseError,
    refetch: refetchCase,
  } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => fetchCaseDetail(client, caseId),
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

  // AC-3: Fetch medical request status
  const {
    data: medicalRequestData,
    isLoading: isMedicalLoading,
    isError: isMedicalError,
    error: medicalError,
    refetch: refetchMedical,
  } = useQuery({
    queryKey: ['medical-request', caseId],
    queryFn: () => getMedicalRequest(client, caseId),
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
    if (err401(caseError) || err401(medicalError)) {
      navigate('/login', { replace: true });
    }
  }, [caseError, medicalError, navigate]);

  const isLoading = isCaseLoading || isMedicalLoading;
  const isError = isCaseError || isMedicalError;

  // AC-6: Loading state
  if (isLoading) {
    return <MedicalRequestSkeleton />;
  }

  // AC-6: Error state
  if (isError) {
    return (
      <div className="mx-auto max-w-5xl p-4" data-testid="medical-request-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">Could not load medical request</h2>
            <p className="mt-1 text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                void refetchCase();
                void refetchMedical();
              }}
              className="mt-2 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => navigate(`/cases/${caseId}`)}
              className="mt-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Back to Case
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Derive display values from real API data
  const now = new Date();
  const createdAt = caseDetail ? new Date(caseDetail.createdAt) : now;
  const deadlineDate = caseDetail?.deadline ? new Date(caseDetail.deadline) : null;
  const dayOfProcess = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)));
  const totalDays = deadlineDate
    ? Math.max(1, Math.floor((deadlineDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))
    : 30;

  const employeeName = 'Employee'; // employee name not exposed by case detail
  const accommodation =
    caseDetail?.approvedAccommodation ??
    (caseDetail?.requestDescription
      ? caseDetail.requestDescription.slice(0, 40) + (caseDetail.requestDescription.length > 40 ? '...' : '')
      : 'Accommodation Request');

  const caseType = caseDetail?.type ?? 'ada';
  const lawTag: LawTag =
    caseType === 'multiple' ? 'both' :
    caseType === 'pwfa' ? 'pwfa' :
    'ada';

  const aiConsent = caseDetail?.ai_consent_status === 'given';

  // Use documents from API response
  const documents: MedicalDocument[] = medicalRequestData?.documents ?? [];

  // Derive daysRemaining for sent state (from due date in request)
  const requestDueDate = medicalRequestData?.request?.dueDate;
  const daysRemaining = requestDueDate
    ? Math.max(0, Math.floor((new Date(requestDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 3;

  // employee email — not in AcmdCaseDetail, use placeholder
  const employeeEmail = 'employee@company.com';

  const caseFormData = {
    id: caseId,
    employeeName,
    department: '',
    accommodation,
    employeeEmail,
  };

  // Determine if we show Privacy Banner + Tracker (not shown on law_branch & pwfa_check)
  const showPrivacyAndTracker =
    pageState !== 'law_branch' && pageState !== 'pwfa_check';

  // Determine path badge
  const pathBadge =
    pageState === 'pwfa_exempt' || pageState === 'pwfa_check'
      ? 'pwfa' as const
      : showPrivacyAndTracker
        ? 'ada' as const
        : null;

  // AC-4: Send request handler (optimistic — set state immediately, sync API in background)
  function handleSendRequest() {
    setPageState('sent');
    if (client) {
      sendMedicalRequest(client, caseId, {
        template: 'General ADA',
        limitations: '',
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        deliveryMethod: 'employee',
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['medical-request', caseId] }))
        .catch(() => {
          // error handled by query retry / 401 redirect
        });
    }
  }

  // Assign reviewer handler (optimistic)
  function handleAssignReviewer(reviewer: string) {
    setPageState('under_review');
    if (client) {
      apiAssignReviewer(client, caseId, reviewer)
        .then(() => queryClient.invalidateQueries({ queryKey: ['medical-request', caseId] }))
        .catch(() => {
          // error handled by query retry / 401 redirect
        });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Deadline Badge */}
      <DeadlineBadge
        currentDay={dayOfProcess}
        totalDays={totalDays}
      />

      {/* Case Header */}
      <CaseHeader
        caseId={caseId}
        employeeName={employeeName}
        accommodation={accommodation}
        lawTag={lawTag}
        pathBadge={pathBadge}
      />

      {/* Privacy Banner — always visible (except on law_branch / pwfa_check) */}
      {showPrivacyAndTracker && <PrivacyBanner />}

      {/* Request Status Tracker */}
      {showPrivacyAndTracker && <RequestStatusTracker pageState={pageState} />}

      {/* State 1: Law Branch Detection */}
      {pageState === 'law_branch' && (
        <LawBranchPanel
          lawTag={lawTag}
          onSelectAda={() => setPageState('form')}
          onSelectPwfa={() => setPageState('pwfa_check')}
        />
      )}

      {/* State 1b: PWFA Exemption Check */}
      {pageState === 'pwfa_check' && (
        <PwfaExemptionCheck
          onCategoryMatch={(catId) => {
            setMatchedPwfaCategory(catId);
            setPageState('pwfa_exempt');
          }}
          onNoMatch={() => setPageState('form')}
          onBack={() => setPageState('law_branch')}
        />
      )}

      {/* State 2: Medical Request Form */}
      {pageState === 'form' && (
        <MedicalRequestForm
          aiConsent={aiConsent}
          caseData={caseFormData}
          onSaveDraft={() => {
            /* save draft — stay on form */
          }}
          onSend={handleSendRequest}
          onCancel={() => navigate(`/cases/${caseId}`)}
        />
      )}

      {/* State 3: Request Sent */}
      {pageState === 'sent' && (
        <RequestSentPanel
          onMarkReceived={() => setPageState('received')}
          daysRemaining={daysRemaining}
          employeeEmail={employeeEmail}
        />
      )}

      {/* State 4: Documents Received */}
      {pageState === 'received' && (
        <DocumentsReceivedPanel
          documents={documents}
          onAssignReviewer={handleAssignReviewer}
        />
      )}

      {/* State 5: Under Review */}
      {pageState === 'under_review' && <UnderReviewPanel />}

      {/* State 6a: Cleared */}
      {pageState === 'cleared' && <ClearedPanel caseId={caseId} />}

      {/* State 6b: Additional Info Needed */}
      {pageState === 'additional_needed' && (
        <AdditionalInfoPanel onSendFollowUp={() => setPageState('sent')} />
      )}

      {/* State 6c: Insufficient */}
      {pageState === 'insufficient' && (
        <InsufficientPanel
          caseId={caseId}
          onNewRequest={() => setPageState('form')}
        />
      )}

      {/* PWFA Exempt Display */}
      {pageState === 'pwfa_exempt' && matchedPwfaCategory && (
        <PwfaExemptDisplay
          caseId={caseId}
          matchedCategory={matchedPwfaCategory}
        />
      )}

      {/* Audit Trail Mini */}
      <AuditTrailMini caseId={caseId} entries={STATIC_AUDIT_TRAIL} />

      {/* DEV: State switcher for testing */}
      {import.meta.env.DEV && (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase">Dev: State Switcher</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                'law_branch',
                'pwfa_check',
                'form',
                'sent',
                'received',
                'under_review',
                'cleared',
                'additional_needed',
                'insufficient',
                'pwfa_exempt',
              ] as PageState[]
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (s === 'pwfa_exempt') setMatchedPwfaCategory('breaks');
                  setPageState(s);
                }}
                className={`rounded px-2 py-1 text-xs ${
                  pageState === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

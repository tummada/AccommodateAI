/**
 * CaseDetailHeader — role-filtered header for Case Detail page (ACMD-137-B)
 *
 * Role matrix (per wireframe SCR-CASE-DETAIL §1 + 29 CFR 1630.14):
 *   super_admin : Full header + Reassign + Escalate + View Full Timeline
 *   hr          : Full header + (You) label + View Full Timeline (no Reassign/Escalate)
 *   medical_reviewer : Case ID + employee name ONLY
 *   manager     : Case ID + employee name + generic status badge ONLY
 *                 NO accommodation type, no dual-law badge, no HR info
 *
 * Medical privacy: Manager branch contains ZERO medical fields per 29 CFR 1630.14.
 */

import { DeadlineBadge, computeDeadlineLevel } from '@/components/ui/DeadlineBadge';
import type { AcmdCaseDetail } from '@/pages/CaseDetailPage';
import type { CaseStatus } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeaderRole = 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';

export interface CaseDetailHeaderProps {
  caseData: AcmdCaseDetail;
  role: HeaderRole;
  currentUserId?: string;
  onReassign?: () => void;  // super_admin only
  onEscalate?: () => void;  // super_admin only
  onViewTimeline?: () => void;
}

// ---------------------------------------------------------------------------
// Status labels per role
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<CaseStatus, { label: string; color: string }> = {
  intake:               { label: 'Active',          color: 'blue' },
  active:               { label: 'Active',          color: 'blue' },
  interactive_process:  { label: 'Active',          color: 'blue' },
  awaiting_medical:     { label: 'Awaiting Docs',   color: 'yellow' },
  awaiting_input:       { label: 'Awaiting Input',  color: 'yellow' },
  review:               { label: 'Under Review',    color: 'orange' },
  implementation:       { label: 'Implementation',  color: 'teal' },
  approved:             { label: 'Approved',        color: 'green' },
  denied:               { label: 'Denied',                  color: 'red' },
  closed:               { label: 'Closed',                  color: 'gray' },
  denial_pending_review: { label: 'Denial Pending Review',  color: 'orange' },
};

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  blue:   { bg: 'bg-blue-100',   text: 'text-blue-800' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-800' },
  teal:   { bg: 'bg-teal-100',   text: 'text-teal-800' },
  green:  { bg: 'bg-green-100',  text: 'text-green-800' },
  red:    { bg: 'bg-red-100',    text: 'text-red-800' },
  gray:   { bg: 'bg-gray-100',   text: 'text-gray-700' },
};

// Terminal statuses for manager "In Progress" override
const TERMINAL_STATUSES: CaseStatus[] = ['approved', 'denied', 'closed'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

/** Short display ID — CASE-{last 8 chars uppercased} */
function formatCaseId(id: string): string {
  return `CASE-${id.slice(-8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: CaseStatus;
  /** Override the label (Manager always shows generic label) */
  labelOverride?: string;
}

function StatusBadge({ status, labelOverride }: StatusBadgeProps) {
  const cfg = STATUS_LABELS[status] ?? { label: status, color: 'gray' };
  const colors = COLOR_MAP[cfg.color] ?? COLOR_MAP['gray'];
  const displayLabel = labelOverride ?? cfg.label;
  return (
    <span
      className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}
    >
      {displayLabel}
    </span>
  );
}

interface AiConsentBadgeProps {
  status: 'pending' | 'given' | 'declined';
}

function AiConsentBadge({ status }: AiConsentBadgeProps) {
  const configs = {
    given:    { label: 'AI Consent: Enabled',  bg: 'bg-green-100',  text: 'text-green-800' },
    pending:  { label: 'AI Consent: Pending',  bg: 'bg-yellow-100', text: 'text-yellow-800' },
    declined: { label: 'AI Consent: Declined', bg: 'bg-gray-100',   text: 'text-gray-700' },
  };
  const cfg = configs[status];
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function DualLawBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800">
      ADA + PWFA
    </span>
  );
}

/** Compute days elapsed since createdAt */
function computeDaysElapsed(createdAt: string): number {
  const now = new Date();
  const created = new Date(createdAt);
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Role-based header variants
// ---------------------------------------------------------------------------

/** Super Admin — full header + admin actions */
function SuperAdminHeader({
  caseData,
  onReassign,
  onEscalate,
  onViewTimeline,
}: {
  caseData: AcmdCaseDetail;
  onReassign?: () => void;
  onEscalate?: () => void;
  onViewTimeline?: () => void;
}) {
  const deadlineLevel = computeDeadlineLevel(caseData.deadline);
  const daysElapsed = computeDaysElapsed(caseData.createdAt);
  const hasDualLaw = caseData.type === 'multiple';

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      {/* Deadline badge */}
      <div>
        <DeadlineBadge deadline={caseData.deadline} level={deadlineLevel} />
        {caseData.deadline && (
          <span className="ml-2 text-xs text-text-muted">
            Day {daysElapsed} of 30
          </span>
        )}
      </div>

      {/* Header row: case ID + status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-text">{formatCaseId(caseData.id)}</h2>
          {hasDualLaw && <DualLawBadge />}
        </div>
        <StatusBadge status={caseData.status} />
      </div>

      {/* Case meta grid */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-text-muted">Employee</dt>
          <dd className="font-medium text-text">{caseData.employeeId}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Accommodation</dt>
          <dd className="font-medium text-text capitalize">
            {caseData.type.replace(/_/g, ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Assigned HR</dt>
          <dd className="font-medium text-text">{caseData.assignedTo ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Created</dt>
          <dd className="font-medium text-text">{formatDate(caseData.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Last Updated</dt>
          <dd className="font-medium text-text">{formatDate(caseData.updatedAt)}</dd>
        </div>
      </dl>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <AiConsentBadge status={caseData.ai_consent_status} />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onReassign && (
          <button
            type="button"
            onClick={onReassign}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reassign Case ▾
          </button>
        )}
        {onEscalate && (
          <button
            type="button"
            onClick={onEscalate}
            className="inline-flex items-center rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Escalate
          </button>
        )}
        {onViewTimeline && (
          <button
            type="button"
            onClick={onViewTimeline}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View Full Timeline
          </button>
        )}
      </div>
    </div>
  );
}

/** HR — full header, (You) label, no Reassign/Escalate */
function HRHeader({
  caseData,
  currentUserId,
  onViewTimeline,
}: {
  caseData: AcmdCaseDetail;
  currentUserId?: string;
  onViewTimeline?: () => void;
}) {
  const deadlineLevel = computeDeadlineLevel(caseData.deadline);
  const daysElapsed = computeDaysElapsed(caseData.createdAt);
  const hasDualLaw = caseData.type === 'multiple';
  const isAssignedToMe = currentUserId != null && caseData.assignedTo === currentUserId;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      {/* Deadline badge */}
      <div>
        <DeadlineBadge deadline={caseData.deadline} level={deadlineLevel} />
        {caseData.deadline && (
          <span className="ml-2 text-xs text-text-muted">
            Day {daysElapsed} of 30
          </span>
        )}
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-text">{formatCaseId(caseData.id)}</h2>
          {hasDualLaw && <DualLawBadge />}
        </div>
        <StatusBadge status={caseData.status} />
      </div>

      {/* Meta grid */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-text-muted">Employee</dt>
          <dd className="font-medium text-text">{caseData.employeeId}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Accommodation</dt>
          <dd className="font-medium text-text capitalize">
            {caseData.type.replace(/_/g, ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Assigned HR</dt>
          <dd className="font-medium text-text">
            {caseData.assignedTo ?? '—'}
            {isAssignedToMe && (
              <span className="ml-1 text-xs text-blue-600 font-normal">(You)</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Created</dt>
          <dd className="font-medium text-text">{formatDate(caseData.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Last Updated</dt>
          <dd className="font-medium text-text">{formatDate(caseData.updatedAt)}</dd>
        </div>
      </dl>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <AiConsentBadge status={caseData.ai_consent_status} />
      </div>

      {/* Action buttons — HR: no Reassign/Escalate */}
      {onViewTimeline && (
        <div className="pt-1">
          <button
            type="button"
            onClick={onViewTimeline}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View Full Timeline
          </button>
        </div>
      )}
    </div>
  );
}

/** Medical Reviewer — case ID + employee name ONLY.
 *  Per 29 CFR 1630.14: no accommodation type, no dual-law badge, no assigned HR.
 */
function MedicalReviewerHeader({ caseData }: { caseData: AcmdCaseDetail }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      {/* Simplified deadline: day count only */}
      {caseData.deadline && (
        <p className="text-xs text-text-muted">
          Day {computeDaysElapsed(caseData.createdAt)} of 30
        </p>
      )}

      {/* Limited header: case ID + employee name only */}
      <div>
        <h2 className="text-lg font-bold text-text">{formatCaseId(caseData.id)}</h2>
        <p className="mt-1 text-sm text-text">
          Employee: <span className="font-medium">{caseData.employeeId}</span>
        </p>
      </div>
      {/* NO accommodation type, NO dual-law badge, NO assigned HR, NO admin actions */}
    </div>
  );
}

/** Manager — case ID + employee name + generic status ONLY.
 *  ZERO medical data per 29 CFR 1630.14.
 *  No accommodation type, no dual-law badge, no assigned HR.
 */
function ManagerHeader({ caseData }: { caseData: AcmdCaseDetail }) {
  // Manager sees "In Progress" for all non-terminal statuses
  const isTerminal = TERMINAL_STATUSES.includes(caseData.status);
  const statusLabel = isTerminal ? STATUS_LABELS[caseData.status].label : 'In Progress';
  const daysElapsed = computeDaysElapsed(caseData.createdAt);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      {/* Simplified deadline: day N — case in progress (no "Legal risk") */}
      <p className="text-xs text-text-muted">
        Day {daysElapsed} — Case in progress
      </p>

      {/* Case ID + employee + generic status badge */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-text">{formatCaseId(caseData.id)}</h2>
          <p className="mt-1 text-sm text-text">
            Employee: <span className="font-medium">{caseData.employeeId}</span>
          </p>
        </div>
        {/* Generic status badge — no EEOC terminology */}
        <span className="inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800">
          {statusLabel}
        </span>
      </div>
      {/* NO accommodation type details, NO dual-law badge, NO assigned HR,
          NO EEOC stage label, NO AI consent status, NO medical fields */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CaseDetailHeader
// ---------------------------------------------------------------------------

export function CaseDetailHeader({
  caseData,
  role,
  currentUserId,
  onReassign,
  onEscalate,
  onViewTimeline,
}: CaseDetailHeaderProps) {
  switch (role) {
    case 'super_admin':
      return (
        <SuperAdminHeader
          caseData={caseData}
          onReassign={onReassign}
          onEscalate={onEscalate}
          onViewTimeline={onViewTimeline}
        />
      );

    case 'hr':
      return (
        <HRHeader
          caseData={caseData}
          currentUserId={currentUserId}
          onViewTimeline={onViewTimeline}
        />
      );

    case 'medical_reviewer':
      return <MedicalReviewerHeader caseData={caseData} />;

    case 'manager':
      return <ManagerHeader caseData={caseData} />;

    default:
      // Exhaustive check — if a new role is added TypeScript will error here
      return null;
  }
}

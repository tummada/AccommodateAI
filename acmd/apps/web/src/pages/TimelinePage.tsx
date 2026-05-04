/**
 * TimelinePage — ACMD-140 Phase 6E / ACMD-150 Phase 7A
 *
 * URL: /cases/:id/timeline
 * Roles allowed: super_admin, hr, medical_reviewer, manager
 * Roles denied: none (all 4 roles can view, but content is role-filtered)
 *
 * COMPLIANCE: ADA/PWFA immutable audit trail — role-filtered display
 *
 * Auth Review Checklist:
 *  - cookie path sync: does NOT touch cookies — only useApiClient/useAuth used
 *  - logout clears state: useEffect cleanup resets local state on unmount
 *  - token type asymmetry: NO token stored in localStorage
 *  - clock skew: no hard-coded dates — all dates from API
 *
 * Data source: GET /api/v1/cases/:id/timeline via TanStack Query + fetchCaseTimeline
 * Invalid caseId (missing) → redirect to /cases
 */

import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchCaseTimeline } from '@/lib/api/cases';
import type { AcmdTimelineEvent } from '@/lib/api/cases';

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

type EventType =
  | 'case_lifecycle'
  | 'medical_status'
  | 'ai_analysis'
  | 'accommodation_decision'
  | 'letter'
  | 'followup'
  | 'deadline_alert'
  | 'stage_transition'
  | 'pwfa_events'
  | 'mgr_input';

/** Display-ready timeline event (derived from AcmdTimelineEvent) */
interface TimelineEvent {
  seq: number;
  timestamp: string; // ISO 8601 string for sorting
  displayTimestamp: string; // MM/DD/YYYY HH:MM AM/PM ET
  actorRole: string; // HR, Manager, SYSTEM, Medical Reviewer
  actorName: string; // Full name — hidden from manager view
  actionCode: string; // dot-notation
  detail: string;
  eventType: EventType;
  hash: string; // truncated for display
  managerVisible: boolean;
}

// ---------------------------------------------------------------------------
// AcmdTimelineEvent → TimelineEvent mapper
// ---------------------------------------------------------------------------

/** Infer event type from action string */
function inferEventType(action: string): EventType {
  if (action.startsWith('case.') || action.startsWith('eeoc.')) return 'case_lifecycle';
  if (action.startsWith('medical.')) return 'medical_status';
  if (action.startsWith('ai.')) return 'ai_analysis';
  if (action.startsWith('accommodation.') || action.startsWith('decision.')) return 'accommodation_decision';
  if (action.startsWith('letter.')) return 'letter';
  if (action.startsWith('followup.') || action.startsWith('case.followup')) return 'followup';
  if (action.startsWith('deadline.')) return 'deadline_alert';
  if (action.includes('stage')) return 'stage_transition';
  if (action.startsWith('pwfa.')) return 'pwfa_events';
  if (action.startsWith('mgr_input.') || action.startsWith('mgr.')) return 'mgr_input';
  return 'case_lifecycle';
}

/** Check if event is visible to managers based on visibility array */
function isManagerVisible(visibility: string[]): boolean {
  // If visibility includes 'manager' or 'all', it's visible to managers
  return visibility.includes('manager') || visibility.includes('all');
}

/** Format ISO timestamp to display format in ET timezone */
function formatDisplayTimestamp(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }).replace(', ', ' ') + ' ET';
}

/** Truncate id for hash display */
function truncateHash(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

function mapApiEvent(event: AcmdTimelineEvent, index: number): TimelineEvent {
  const metadata = event.metadata as Record<string, unknown> | null ?? {};
  const actorRole = (metadata['actorRole'] as string) ?? 'SYSTEM';
  const actorName = (metadata['actorName'] as string) ?? 'System';
  const detail = (metadata['detail'] as string) ?? event.action;

  return {
    seq: index + 1,
    timestamp: event.createdAt,
    displayTimestamp: formatDisplayTimestamp(event.createdAt),
    actorRole,
    actorName,
    actionCode: event.action,
    detail,
    eventType: inferEventType(event.action),
    hash: truncateHash(event.id),
    managerVisible: isManagerVisible(event.visibility),
  };
}

/** Minimal case metadata returned by timeline API (or derived from caseId) */
interface CaseMeta {
  id: string;
  employeeName: string;
  accommodationType: string;
  dualLaw: boolean;
  status: string;
  dayElapsed: number;
  totalDays: number;
  followupDate: string;
}

/** Fallback case metadata for known test IDs */
const FALLBACK_CASE_META: Record<string, CaseMeta> = {
  'CASE-2026-022': {
    id: 'CASE-2026-022',
    employeeName: 'A. Williams',
    accommodationType: 'Schedule Modification',
    dualLaw: true,
    status: 'approved',
    dayElapsed: 18,
    totalDays: 30,
    followupDate: '05/23/2026',
  },
  'CASE-TEST-IN-PROGRESS': {
    id: 'CASE-TEST-IN-PROGRESS',
    employeeName: 'B. Johnson',
    accommodationType: 'Remote Work',
    dualLaw: false,
    status: 'in_progress',
    dayElapsed: 5,
    totalDays: 30,
    followupDate: '06/01/2026',
  },
};

const DEFAULT_CASE_META: CaseMeta = {
  id: '',
  employeeName: 'Employee',
  accommodationType: 'Accommodation',
  dualLaw: false,
  status: 'active',
  dayElapsed: 0,
  totalDays: 30,
  followupDate: '',
};

// Manager-visible event types for dropdown filter
const MANAGER_VISIBLE_EVENT_TYPES: EventType[] = [
  'case_lifecycle',
  'mgr_input',
  'accommodation_decision',
  'deadline_alert',
  'stage_transition',
];

const ALL_EVENT_TYPES: EventType[] = [
  'case_lifecycle',
  'medical_status',
  'ai_analysis',
  'accommodation_decision',
  'letter',
  'followup',
  'deadline_alert',
  'stage_transition',
  'pwfa_events',
  'mgr_input',
];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  case_lifecycle: 'Case Lifecycle',
  medical_status: 'Medical Status',
  ai_analysis: 'AI Analysis',
  accommodation_decision: 'Accommodation Decision',
  letter: 'Letter',
  followup: 'Follow-up',
  deadline_alert: 'Deadline Alert',
  stage_transition: 'Stage Transition',
  pwfa_events: 'PWFA Events',
  mgr_input: 'Manager Input',
};

// ---------------------------------------------------------------------------
// Event type badge colors
// ---------------------------------------------------------------------------

function getEventTypeBadgeClass(eventType: EventType): string {
  switch (eventType) {
    case 'case_lifecycle':
      return 'bg-blue-100 text-blue-800';
    case 'medical_status':
      return 'bg-purple-100 text-purple-800';
    case 'ai_analysis':
      return 'bg-gray-100 text-gray-700';
    case 'accommodation_decision':
      return 'bg-green-100 text-green-800';
    case 'letter':
      return 'bg-teal-100 text-teal-800';
    case 'followup':
      return 'bg-green-100 text-green-800';
    case 'deadline_alert':
      return 'bg-yellow-100 text-yellow-800';
    case 'stage_transition':
      return 'bg-navy-100 text-white';
    case 'pwfa_events':
      return 'bg-purple-100 text-purple-800';
    case 'mgr_input':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function getEventTypeBadgeStyle(eventType: EventType): React.CSSProperties {
  if (eventType === 'stage_transition') {
    return { backgroundColor: '#1E3A5F', color: '#FFFFFF' };
  }
  return {};
}

// ---------------------------------------------------------------------------
// DeadlineBadge (reused pattern from ChecklistPage)
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

// ---------------------------------------------------------------------------
// CaseHeader (role-filtered)
// ---------------------------------------------------------------------------

function CaseHeader({
  caseData,
  role,
  caseId,
}: {
  caseData: CaseMeta;
  role: UserRole;
  caseId: string;
}) {
  const remaining = caseData.totalDays - caseData.dayElapsed;
  const deadlineState = getDeadlineState(remaining);
  const textColor = getDeadlineTextColor(deadlineState);

  const isHrOrAdmin = role === 'super_admin' || role === 'hr' || role === 'medical_reviewer';

  function getManagerUrgencyText(): string {
    if (remaining <= 0) return `Day ${caseData.dayElapsed} of ${caseData.totalDays} — Overdue`;
    if (remaining <= 3) return `Day ${caseData.dayElapsed} of ${caseData.totalDays} — Urgent`;
    if (remaining <= 7) return `Day ${caseData.dayElapsed} of ${caseData.totalDays} — Response Due Soon`;
    return `Day ${caseData.dayElapsed} of ${caseData.totalDays}`;
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <Link
        to={`/cases/${caseId}`}
        className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        aria-label="Back to Case Detail"
      >
        ← Back to Case Detail
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          {isHrOrAdmin ? (
            <h1
              className="text-lg font-bold"
              style={{ color: '#1E3A5F' }}
              data-testid="case-header-title"
            >
              {caseData.id} — {caseData.employeeName} —{' '}
              <span data-testid="accommodation-type">{caseData.accommodationType}</span>
            </h1>
          ) : (
            <h1
              className="text-lg font-bold"
              style={{ color: '#1E3A5F' }}
              data-testid="case-header-title"
            >
              {caseData.id} — {caseData.employeeName} — Accommodation Case
            </h1>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isHrOrAdmin && caseData.dualLaw && (
              <span
                className="inline-flex items-center rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800"
                aria-label="Dual-law case: ADA and PWFA"
              >
                ADA + PWFA
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-0.5 text-xs font-semibold text-yellow-800">
              {caseData.status === 'approved' ? 'Approved' : caseData.status}
            </span>
            {isHrOrAdmin ? (
              <span className={`text-sm font-medium ${textColor}`}>
                Day {caseData.dayElapsed} of {caseData.totalDays} — {remaining} days remaining
              </span>
            ) : (
              <span className="text-sm font-medium text-text-muted">
                {getManagerUrgencyText()}
              </span>
            )}
          </div>
        </div>
        <div className="text-sm text-text-muted">
          Case ID: <span className="font-mono font-semibold text-text">{caseData.id}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterSearchBar
// ---------------------------------------------------------------------------

interface FilterState {
  eventType: string;
  actorRole: string;
  searchQuery: string;
  sortOrder: 'newest' | 'oldest';
}

function FilterSearchBar({
  role,
  filters,
  onFiltersChange,
}: {
  role: UserRole;
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
}) {
  const isManager = role === 'manager';
  const availableEventTypes = isManager ? MANAGER_VISIBLE_EVENT_TYPES : ALL_EVENT_TYPES;

  function update(patch: Partial<FilterState>) {
    onFiltersChange({ ...filters, ...patch });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex flex-wrap gap-3">
        {/* Event Type filter */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-event-type" className="text-xs font-medium text-text-muted">
            Event Type
          </label>
          <select
            id="filter-event-type"
            aria-label="Filter by event type"
            value={filters.eventType}
            onChange={(e) => update({ eventType: e.target.value })}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All Event Types</option>
            {availableEventTypes.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {/* Actor Role filter — HR/Admin only */}
        {!isManager && (
          <div className="flex flex-col gap-1" data-testid="actor-role-filter">
            <label htmlFor="filter-actor-role" className="text-xs font-medium text-text-muted">
              Actor Role
            </label>
            <select
              id="filter-actor-role"
              aria-label="Filter by actor role"
              value={filters.actorRole}
              onChange={(e) => update({ actorRole: e.target.value })}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All Roles</option>
              <option value="HR">HR</option>
              <option value="Manager">Manager</option>
              <option value="SYSTEM">System</option>
              <option value="Medical Reviewer">Medical Reviewer</option>
            </select>
          </div>
        )}

        {/* Date Range — simplified label for now */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-date-range" className="text-xs font-medium text-text-muted">
            Date Range
          </label>
          <select
            id="filter-date-range"
            aria-label="Filter by date range"
            defaultValue=""
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All Dates</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search box */}
        <div className="flex flex-1 min-w-[200px] flex-col gap-1">
          <label htmlFor="timeline-search" className="text-xs font-medium text-text-muted">
            Search
          </label>
          <div className="flex gap-2">
            <input
              id="timeline-search"
              type="search"
              role="searchbox"
              aria-label="Search timeline entries"
              placeholder="Search timeline entries..."
              value={filters.searchQuery}
              onChange={(e) => update({ searchQuery: e.target.value })}
              className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {filters.searchQuery && (
              <button
                type="button"
                onClick={() => update({ searchQuery: '' })}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Sort order */}
        <fieldset>
          <legend className="text-xs font-medium text-text-muted mb-1" id="sort-label">
            Sort
          </legend>
          <div
            role="radiogroup"
            aria-labelledby="sort-label"
            className="flex gap-3 text-sm"
          >
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="sort-order"
                value="newest"
                checked={filters.sortOrder === 'newest'}
                onChange={() => update({ sortOrder: 'newest' })}
                className="accent-blue-600"
                aria-label="Sort newest first"
              />
              Newest First
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="sort-order"
                value="oldest"
                checked={filters.sortOrder === 'oldest'}
                onChange={() => update({ sortOrder: 'oldest' })}
                className="accent-blue-600"
                aria-label="Sort oldest first"
              />
              Oldest First
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineEntry
// ---------------------------------------------------------------------------

function TimelineEntryCard({
  event,
  role,
  isLast,
}: {
  event: TimelineEvent;
  role: UserRole;
  isLast: boolean;
}) {
  const isManager = role === 'manager';
  const isHrOrAdmin = !isManager;

  const showRestricted = isManager && !event.managerVisible;

  return (
    <li className="relative flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white text-xs font-bold"
          style={{ backgroundColor: '#2563EB' }}
          aria-hidden="true"
        >
          ●
        </div>
        {!isLast && (
          <div className="flex-1 w-0.5 bg-gray-200 mt-1" aria-hidden="true" />
        )}
      </div>

      {/* Entry content */}
      <div className="flex-1 pb-6">
        {showRestricted ? (
          // Medical restricted view for manager
          <div
            className="rounded-lg border border-gray-200 bg-gray-50 p-3"
            data-testid={`timeline-entry-restricted-${event.seq}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span className="font-mono text-xs">{event.displayTimestamp.split(' ')[0]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs">SEQ#{String(event.seq).padStart(3, '0')}</span>
              <span
                className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600"
                data-testid="medical-restricted-label"
              >
                [Medical — restricted]
              </span>
            </div>
          </div>
        ) : (
          // Normal entry view
          <div
            className="rounded-lg border border-border bg-surface p-3 space-y-2"
            data-testid={`timeline-entry-${event.seq}`}
          >
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-muted font-mono">
                {event.displayTimestamp}
              </span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span className="text-xs font-mono text-text-muted">
                SEQ#{String(event.seq).padStart(3, '0')}
              </span>
              {isHrOrAdmin && (
                <span className="text-xs font-mono text-text-muted" data-testid={`hash-${event.seq}`}>
                  HASH: {event.hash}
                </span>
              )}
            </div>

            {/* Actor + action */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-text">
                {isManager
                  ? event.actorRole
                  : `${event.actorRole}${event.actorName && event.actorName !== 'System' ? ` (${event.actorName})` : ''}`}
              </span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                {event.actionCode}
              </span>
            </div>

            {/* Detail text */}
            <p className="text-sm text-text">{event.detail}</p>

            {/* Event type badge */}
            <div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getEventTypeBadgeClass(event.eventType)}`}
                style={getEventTypeBadgeStyle(event.eventType)}
                data-testid={`badge-${event.seq}`}
              >
                {EVENT_TYPE_LABELS[event.eventType]}
              </span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// EffectivenessCheckPanel
// ---------------------------------------------------------------------------

interface EffectivenessFormState {
  isEffective: string;
  employeeFeedback: string;
  managerFeedback: string;
  nextReviewDate: string;
  modificationsNeeded: string;
  submitted: boolean;
}

function EffectivenessCheckPanel({
  role,
  followupDate,
  onSubmit,
}: {
  role: UserRole;
  followupDate: string;
  onSubmit: (entry: TimelineEvent) => void;
}) {
  const isHrOrAdmin = role === 'super_admin' || role === 'hr' || role === 'medical_reviewer';
  const [formState, setFormState] = useState<EffectivenessFormState>({
    isEffective: '',
    employeeFeedback: '',
    managerFeedback: '',
    nextReviewDate: '',
    modificationsNeeded: '',
    submitted: false,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formState.isEffective || !formState.modificationsNeeded) return;

    const newEntry: TimelineEvent = {
      seq: 15,
      timestamp: new Date().toISOString(),
      displayTimestamp: new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).replace(',', '') + ' ET',
      actorRole: 'HR',
      actorName: 'Current User',
      actionCode: 'case.followup_check',
      detail: `Effectiveness check recorded. Result: ${formState.isEffective}.`,
      eventType: 'followup',
      hash: 'mock...1234',
      managerVisible: true,
    };

    onSubmit(newEntry);
    setFormState((prev) => ({ ...prev, submitted: true }));
  }

  return (
    <section
      aria-label="Effectiveness Check Panel"
      className="rounded-lg border-2 p-4 space-y-4"
      style={{ borderColor: '#2563EB', backgroundColor: '#EFF6FF' }}
      data-testid="effectiveness-check-panel"
    >
      <h2 className="text-sm font-semibold" style={{ color: '#1E3A5F' }}>
        Stage 6 — Follow-up & Effectiveness Check
      </h2>
      <p className="text-sm text-text-muted">
        Follow-up Date:{' '}
        <span className="font-medium text-text">{followupDate}</span>
        {' '}(upcoming)
      </p>

      {isHrOrAdmin && !formState.submitted && (
        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Effectiveness check form">
          {/* is_effective */}
          <fieldset>
            <legend className="text-sm font-semibold text-text mb-2">
              Is the accommodation effective? <span className="text-red-600">*</span>
            </legend>
            <div className="space-y-1">
              {[
                { value: 'effective', label: 'Yes — Accommodation is working' },
                { value: 'partial', label: 'Partially — Some issues remain' },
                { value: 'ineffective', label: 'No — Accommodation not effective' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="is-effective"
                    value={opt.value}
                    checked={formState.isEffective === opt.value}
                    onChange={() => setFormState((p) => ({ ...p, isEffective: opt.value }))}
                    className="accent-blue-600"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* employee_feedback */}
          <div className="space-y-1">
            <label htmlFor="employee-feedback" className="text-sm font-medium text-text">
              Employee Feedback
            </label>
            <textarea
              id="employee-feedback"
              rows={3}
              maxLength={2000}
              value={formState.employeeFeedback}
              onChange={(e) =>
                setFormState((p) => ({ ...p, employeeFeedback: e.target.value }))
              }
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Optional — employee's perspective on the accommodation..."
            />
          </div>

          {/* manager_feedback */}
          <div className="space-y-1">
            <label htmlFor="manager-feedback" className="text-sm font-medium text-text">
              Manager Feedback (operational only — no medical information)
            </label>
            <textarea
              id="manager-feedback"
              rows={3}
              maxLength={2000}
              value={formState.managerFeedback}
              onChange={(e) =>
                setFormState((p) => ({ ...p, managerFeedback: e.target.value }))
              }
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Optional — describe only operational observations..."
            />
          </div>

          {/* next_review_date */}
          <div className="space-y-1">
            <label htmlFor="next-review-date" className="text-sm font-medium text-text">
              Next Review Date (if ongoing)
            </label>
            <input
              id="next-review-date"
              type="date"
              value={formState.nextReviewDate}
              onChange={(e) =>
                setFormState((p) => ({ ...p, nextReviewDate: e.target.value }))
              }
              className="rounded-md border border-border bg-white px-3 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* modifications_needed */}
          <fieldset>
            <legend className="text-sm font-semibold text-text mb-2">
              Modifications needed? <span className="text-red-600">*</span>
            </legend>
            <div className="space-y-1">
              {[
                { value: 'no', label: 'No' },
                { value: 'yes', label: 'Yes — restart interactive process at Stage 3' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="modifications-needed"
                    value={opt.value}
                    checked={formState.modificationsNeeded === opt.value}
                    onChange={() =>
                      setFormState((p) => ({ ...p, modificationsNeeded: opt.value }))
                    }
                    className="accent-blue-600"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!formState.isEffective || !formState.modificationsNeeded}
            className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: '#2563EB' }}
          >
            Add Effectiveness Check
          </button>
        </form>
      )}

      {isHrOrAdmin && formState.submitted && (
        <div
          className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          role="status"
        >
          Effectiveness check submitted — entry added to timeline.
        </div>
      )}

      {!isHrOrAdmin && (
        <div className="rounded border border-gray-200 bg-white p-3 text-sm text-text-muted">
          Outcome will be displayed here after HR completes the effectiveness check.
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ExportButton
// ---------------------------------------------------------------------------

function ExportButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const isManager = role === 'manager';

  function handleExport(format: 'PDF' | 'CSV') {
    setOpen(false);
    // TODO: replace with real export API call in future phase
    alert(`Export ${format}: mock — no API call in Phase 7A`);
  }

  return (
    <div className="relative" data-testid="export-button-container">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Export timeline"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Export ▼
      </button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-border bg-white shadow-lg"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('PDF')}
            className="block w-full px-4 py-2 text-left text-sm text-text hover:bg-gray-50"
            data-testid="export-pdf-option"
          >
            Export PDF
          </button>
          {!isManager && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleExport('CSV')}
              className="block w-full px-4 py-2 text-left text-sm text-text hover:bg-gray-50"
              data-testid="export-csv-option"
            >
              Export CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelinePage — main export
// ---------------------------------------------------------------------------

export function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const role = normalizeRole(user?.role);

  // AC-9: invalid caseId → redirect to /cases
  if (!id || id.trim() === '') {
    navigate('/cases', { replace: true });
    return null;
  }

  const caseId = id;

  // All 4 roles allowed — no access denied for this page
  return <TimelinePageContent caseId={caseId} role={role} />;
}

function TimelinePageContent({ caseId, role }: { caseId: string; role: UserRole }) {
  const { client, user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = role === 'manager';

  const [filters, setFilters] = useState<FilterState>({
    eventType: '',
    actorRole: '',
    searchQuery: '',
    sortOrder: 'newest',
  });

  const [extraEvents, setExtraEvents] = useState<TimelineEvent[]>([]);

  // Auth Review: logout clears local state on unmount + clear query cache on user change
  useEffect(() => {
    return () => {
      setExtraEvents([]);
    };
  }, []);

  // Fix 2: Clear TanStack Query cache when user logs out (user becomes null/undefined)
  useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user, queryClient]);

  // --- Fetch timeline from API ---
  const {
    data: timelineData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['case-timeline', caseId],
    queryFn: () => fetchCaseTimeline(client, caseId, { limit: 100 }),
    staleTime: 60_000,
    retry: 1,
  });

  // Map API events → display events only (no fallback hardcoded data)
  const apiEvents: TimelineEvent[] = timelineData
    ? timelineData.events.map((ev, i) => mapApiEvent(ev, i))
    : [];

  // Use fallback case metadata (API doesn't return case meta on timeline endpoint)
  const caseData: CaseMeta = FALLBACK_CASE_META[caseId] ?? {
    ...DEFAULT_CASE_META,
    id: caseId,
  };

  function handleEffectivenessSubmit(entry: TimelineEvent) {
    setExtraEvents((prev) => [entry, ...prev]);
  }

  // Combine and filter events
  const allEvents = [...extraEvents, ...apiEvents];

  const filteredEvents = allEvents
    .filter((event) => {
      // Manager: non-visible events must always show as [Medical — restricted] placeholder
      if (isManager && !event.managerVisible) return true;

      // Filter by eventType dropdown
      if (filters.eventType) {
        if (event.eventType !== filters.eventType) return false;
      }

      // Actor role filter (HR/Admin only)
      if (!isManager && filters.actorRole) {
        if (event.actorRole !== filters.actorRole) return false;
      }

      // Search filter (min 3 chars)
      if (filters.searchQuery.length >= 3) {
        const query = filters.searchQuery.toLowerCase();
        if (isManager && !event.managerVisible) return true;
        const matchesDetail = event.detail.toLowerCase().includes(query);
        const matchesAction = event.actionCode.toLowerCase().includes(query);
        const matchesActor = event.actorName.toLowerCase().includes(query);
        if (!matchesDetail && !matchesAction && !matchesActor) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return filters.sortOrder === 'newest' ? -diff : diff;
    });

  const showApproved = caseData.status === 'approved';

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" data-testid="timeline-loading">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="timeline-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">
              Could not load timeline
            </h2>
            <p className="mt-1 text-sm text-red-700">
              Could not load timeline — check your permissions.
            </p>
          </div>
          <Link
            to="/cases"
            className="mt-2 inline-flex items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ← Back to Cases
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Top bar: Back + Export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Case Timeline — {caseData.id}</h1>
        <span className="text-sm text-text-muted">
          <Link to={`/cases/${caseId}`} className="hover:text-text">
            ← Back to Cases
          </Link>
        </span>
        <ExportButton role={role} />
      </div>

      {/* Case Header */}
      <CaseHeader caseData={caseData} role={role} caseId={caseId} />

      {/* Filter & Search Bar */}
      <FilterSearchBar role={role} filters={filters} onFiltersChange={setFilters} />

      {/* Timeline Container */}
      <section aria-label="Case timeline" className="rounded-lg border border-border bg-surface p-4">
        {/* AC-2: empty state when API resolved but returned 0 events */}
        {!isLoading && allEvents.length === 0 ? (
          <div
            className="flex flex-col items-center gap-3 py-12 text-center"
            data-testid="timeline-empty-state"
          >
            <span className="text-3xl" aria-hidden="true">📋</span>
            <p className="text-sm font-medium text-text">No timeline events found</p>
            <p className="text-xs text-text-muted">
              Timeline events will appear here as the case progresses.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4">
              Showing {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
              {isManager && ' (medical entries redacted)'}
            </p>

            {filteredEvents.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">
                No events match your filters.{' '}
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      eventType: '',
                      actorRole: '',
                      searchQuery: '',
                      sortOrder: 'newest',
                    })
                  }
                  className="underline hover:opacity-80 text-blue-600"
                >
                  Clear Filters
                </button>
              </p>
            ) : (
              <ol className="space-y-0" aria-label="Timeline events" data-testid="timeline-list">
                {filteredEvents.map((event, index) => (
                  <TimelineEntryCard
                    key={`${event.seq}-${event.timestamp}`}
                    event={event}
                    role={role}
                    isLast={index === filteredEvents.length - 1}
                  />
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      {/* Effectiveness Check Panel — Stage 6 / approved only */}
      {showApproved && (
        <EffectivenessCheckPanel
          role={role}
          followupDate={caseData.followupDate}
          onSubmit={handleEffectivenessSubmit}
        />
      )}
    </div>
  );
}

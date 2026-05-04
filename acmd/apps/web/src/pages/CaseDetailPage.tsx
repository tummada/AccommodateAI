/**
 * CaseDetailPage — Phase 6C Part 2 (ACMD-137-B)
 *
 * Renders the full Case Detail view at /cases/:id.
 * Role-based layout: super_admin | hr | medical_reviewer | manager
 *
 * Phase 1 (this file):
 *   - Data fetching (GET /api/v1/cases/:id via TanStack Query)
 *   - Loading skeleton
 *   - Error states: 404 / 403 / generic
 *   - CaseDetailHeader
 *   - EEOCStepper
 *   - Placeholder for Phase 2 panels
 *
 * Compliance (29 CFR 1630.14):
 *   - Manager view: NO medical elements whatsoever
 *   - Medical Reviewer: limited header only (case ID + employee name)
 *
 * AppLayout is already applied by the route wrapper in App.tsx.
 */

import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import type { AuthenticatedClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import type { AcmdCase, CaseStatus, CaseType } from '@/lib/api/cases';
import { CaseDetailHeader } from '@/components/case-detail/CaseDetailHeader';
import { EEOCStepper } from '@/components/case-detail/EEOCStepper';
import { DualTrackSplitView } from '@/components/case-detail/DualTrackSplitView';
import { StageActionPanel } from '@/components/case-detail/StageActionPanel';
import { TimelinePanel } from '@/components/case-detail/TimelinePanel';

// ---------------------------------------------------------------------------
// Extended type for GET /cases/:id (superset of AcmdCase)
// ---------------------------------------------------------------------------

export interface AcmdCaseDetail extends AcmdCase {
  requestDescription: string | null;
  /** Encrypted at API layer, decrypted at backend — never sent to manager role */
  medicalInfo: string | null;
  aiClassification: Record<string, unknown> | null;
  suggestedAccommodations: Record<string, unknown>[] | null;
  approvedAccommodation: string | null;
  denialReason: string | null;
  interimAccommodationOffered: boolean;
  interimAccommodationDescription: string | null;
  closedAt: string | null;
  ai_consent_status: 'pending' | 'given' | 'declined';
  /** Manager who owns this case — used for supervisor conflict-of-interest check (ACMD-138-C) */
  managerId: string | null;
  /** HR user who submitted the denial package for supervisor review (ACMD-138-C) */
  denialSubmittedBy: string | null;
  /** Name of HR user who submitted denial (display only) */
  denialSubmittedByName: string | null;
  /** ISO date when denial was submitted for review */
  denialSubmittedAt: string | null;
  /** Deadline date for supervisor review (ISO date) */
  supervisorReviewDeadline: string | null;
  /** Denial type: undue_hardship | not_qualified | direct_threat (ACMD-138-C) */
  denialType: string | null;
  /** EEOC Factor 1 — categories selected (comma-separated) */
  denialHardshipCategories: string | null;
  /** EEOC Factor 1 — hardship narrative */
  denialHardshipNarrative: string | null;
  /** EEOC Factor 1 — number of evidence files attached */
  denialEvidenceCount: number | null;
  /** EEOC Factor 2 — alternatives array */
  denialAlternatives: Array<{ description: string; reasonRejected: string }> | null;
  /** EEOC Factor 2 — employee preference text */
  denialEmployeePreference: string | null;
  /** EEOC Factor 3 — interactive process confirmed */
  denialInteractiveProcessConfirmed: boolean | null;
  /** EEOC Factor 3 — engagement assessment */
  denialEngagementAssessment: string | null;
  /** EEOC Factor 3 — discussion date (ISO date) */
  denialDiscussionDate: string | null;
  /** EEOC Factor 3 — discussion method */
  denialDiscussionMethod: string | null;
  /** EEOC Factor 4 — legal reviewer name */
  denialLegalReviewer: string | null;
  /** EEOC Factor 4 — legal review date (ISO date) */
  denialLegalReviewDate: string | null;
  /** EEOC Factor 4 — legal opinion summary */
  denialLegalOpinion: string | null;
  /** Case timeline events (Phase 7 — optional) */
  timeline: Array<{ date: string; event: string; actor: string }> | null;
}

// ---------------------------------------------------------------------------
// API fetch function (defined here per task spec — NOT in cases.ts)
// ---------------------------------------------------------------------------

export async function fetchCaseDetail(
  client: AuthenticatedClient,
  id: string,
): Promise<AcmdCaseDetail> {
  // API returns { case: AcmdCaseDetail } — unwrap the 'case' key.
  const res = await client.request<{ case: AcmdCaseDetail }>(`/api/v1/cases/${id}`);
  return res.case;
}

// ---------------------------------------------------------------------------
// Role type (matches the 4 ACMD roles)
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
  return 'hr'; // safe fallback
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CaseDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading case details"
      className="space-y-4 animate-pulse"
    >
      {/* Header skeleton */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-gray-200" />
        <div className="h-6 w-48 rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-3/4 rounded bg-gray-200" />
        </div>
      </div>

      {/* Stepper skeleton */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex justify-between gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-gray-200" />
              <div className="h-3 w-14 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>

      {/* Placeholder card skeleton */}
      <div className="rounded-lg border border-dashed border-gray-200 p-8">
        <div className="h-4 w-40 rounded bg-gray-200 mx-auto" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------

interface ErrorViewProps {
  type: '404' | '403' | 'generic';
}

function ErrorView({ type }: ErrorViewProps) {
  const configs = {
    '404': {
      title: 'Case not found',
      message: "We couldn't find a case with that ID. It may have been deleted or you may have an incorrect link.",
      icon: '🔍',
    },
    '403': {
      title: 'Access denied',
      message: "You don't have access to this case.",
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

// ---------------------------------------------------------------------------
// Helper: extract error type from thrown error
// ---------------------------------------------------------------------------

function getErrorType(error: unknown): '404' | '403' | 'generic' {
  if (error instanceof ApiError) {
    if (error.status === 404) return '404';
    if (error.status === 403) return '403';
  }
  return 'generic';
}

// ---------------------------------------------------------------------------
// CaseDetailPage — main component
// ---------------------------------------------------------------------------

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, client } = useAuth();
  const queryClient = useQueryClient();

  const role = normalizeRole(user?.role);

  const {
    data: caseData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['case', id],
    queryFn: () => fetchCaseDetail(client, id!),
    enabled: !!id,
    staleTime: 30_000,
    retry: (failureCount, err) => {
      // Do not retry 403/404 — these are authoritative responses
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Back button (always visible) */}
        <Link
          to="/cases"
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Cases
        </Link>
        <CaseDetailSkeleton />
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    const errorType = getErrorType(error);
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Link
          to="/cases"
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Cases
        </Link>
        <ErrorView type={errorType} />
      </div>
    );
  }

  // --- No data (safety guard) ---
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

  // --- Loaded state ---
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back button + action links */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/cases"
          className="inline-flex items-center text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          ← Back to Cases
        </Link>
        {/* Action links */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Checklist — available to super_admin and hr only */}
          {(role === 'super_admin' || role === 'hr') && (
            <Link
              to={`/cases/${id}/checklist`}
              className="inline-flex items-center rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View EEOC compliance checklist for this case"
            >
              View Checklist →
            </Link>
          )}
          {/* Letters tab — available to super_admin and hr only (role guard per ACMD-141) */}
          {(role === 'super_admin' || role === 'hr') && (
            <Link
              to={`/cases/${id}/letters`}
              className="inline-flex items-center rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View and generate accommodation letters for this case"
              data-testid="letters-tab-link"
            >
              Letters →
            </Link>
          )}
          {/* View Full Timeline — available to all roles (super_admin, hr, medical_reviewer, manager) */}
          <Link
            to={`/cases/${id}/timeline`}
            className="inline-flex items-center rounded-md border border-gray-400 px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="View full case timeline"
          >
            View Full Timeline →
          </Link>
        </div>
      </div>

      {/* Case Detail Header — role-filtered */}
      <CaseDetailHeader
        caseData={caseData}
        role={role}
        currentUserId={user?.id}
        onReassign={
          role === 'super_admin'
            ? () => {
                // Phase 2: open reassign modal
                alert('Reassign: coming in Phase 2');
              }
            : undefined
        }
        onEscalate={
          role === 'super_admin'
            ? () => {
                // Phase 2: open escalate modal
                alert('Escalate: coming in Phase 2');
              }
            : undefined
        }
        onViewTimeline={
          role === 'super_admin' || role === 'hr'
            ? () => {
                // Phase 2: scroll to timeline panel
                const el = document.getElementById('timeline-panel');
                el?.scrollIntoView({ behavior: 'smooth' });
              }
            : undefined
        }
      />

      {/* EEOC 6-Stage Stepper — role-based labels */}
      <section aria-label="EEOC Process Stages" className="rounded-lg border border-border bg-surface p-4">
        <EEOCStepper
          currentStatus={caseData.status as CaseStatus}
          caseType={caseData.type as CaseType}
          role={role}
          pwfaExempt={caseData.type === 'pwfa'}
          onStageClick={(stage) => {
            // Phase 2: scroll to stage action panel
            const el = document.getElementById(`stage-panel-${stage}`);
            el?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </section>

      {/* Phase 2 panels — real implementation */}
      <DualTrackSplitView
        caseType={caseData.type as CaseType}
        role={role}
        adaChecklist={{
          disabilityDocumentation: false,
          functionalLimitationsAssessed: false,
          interactiveProcessComplete: false,
          unduHardshipAnalyzed: false,
        }}
        pwfaChecklist={{
          pregnancyVerified: false,
          predictableAssessmentDone: false,
          fastTrackEligible: false,
        }}
        pwfaFastTrackAvailable={caseData.type === 'pwfa' || caseData.type === 'multiple'}
      />

      {/* PWFA Fast-Track Navigation — ACMD-147 */}
      {(caseData.type === 'pwfa' || caseData.type === 'multiple') &&
        (role === 'super_admin' || role === 'hr') && (
          <div
            data-testid="pwfa-fast-track-nav"
            className="rounded-lg border border-purple-200 bg-purple-50 p-4 flex items-center justify-between gap-3"
          >
            <div>
              <p className="text-sm font-semibold text-purple-800">
                PWFA Fast-Track Available
              </p>
              <p className="text-xs text-purple-600 mt-0.5">
                This case may qualify for PWFA predictable assessment fast-track approval
                without medical documentation.
              </p>
            </div>
            <Link
              to={`/cases/${id}/pwfa-fast-track`}
              data-testid="start-fast-track-link"
              className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              Start Fast-Track
            </Link>
          </div>
      )}

      <StageActionPanel
        caseData={caseData}
        role={role}
        apiClient={client}
        onCaseUpdated={() => {
          void queryClient.invalidateQueries({ queryKey: ['case', id] });
        }}
      />

      <div id="timeline-panel">
        <TimelinePanel
          caseId={id!}
          role={role}
          apiClient={client}
        />
      </div>
    </div>
  );
}

/**
 * TimelinePanel — ACMD-137-C1
 *
 * Audit trail panel for Case Detail.
 * Fetches events via TanStack Query (useInfiniteQuery) from
 * GET /api/v1/cases/:id/timeline with pagination (Load More).
 *
 * Visibility: All roles (role-filtering done server-side)
 *
 * Features:
 *   - Newest-first event display
 *   - Load More pagination (20 events per page)
 *   - Loading skeleton (5 rows)
 *   - Empty state / error state
 *   - formatAction helper: snake_case → human-readable
 *   - Actor label: null actorId → "System", else "HR User"
 *
 * Accessibility:
 *   - role="log" on event list
 *   - aria-label on each entry
 *   - aria-live="polite" for new entries
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuthenticatedClient } from '@/lib/api-client';
import { fetchCaseTimeline } from '@/lib/api/cases';
import type { AcmdTimelineEvent } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelinePanelProps {
  caseId: string;
  role: 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';
  apiClient: AuthenticatedClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a snake_case action string into a human-readable label.
 */
export function formatAction(action: string): string {
  const MAP: Record<string, string> = {
    case_created: 'Case created',
    case_updated: 'Case updated',
    case_assigned: 'Case assigned',
    case_closed: 'Case closed',
    discussion_created: 'Discussion added',
    discussion_updated: 'Discussion updated',
    stage_completed: 'Stage completed',
    letter_sent: 'Letter sent',
    medical_received: 'Medical documentation received',
    medical_cleared: 'Medical documentation cleared',
    medical_insufficient: 'Medical documentation insufficient',
    medical_reviewed: 'Medical documentation reviewed',
    deadline_reminder: 'Deadline reminder sent',
    ai_analysis_run: 'AI analysis run',
    case_approved: 'Case approved',
    case_denied: 'Case denied',
    escalation_triggered: 'Escalation triggered',
    manager_input_requested: 'Manager input requested',
    manager_input_received: 'Manager input received',
  };

  if (MAP[action]) return MAP[action];

  // Fallback: snake_case → Title case words
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Derive an actor label from an event.
 * actorId === null → system event → "System"
 * actorId present → "HR User" (display name resolution is future work)
 */
function formatActor(actorId: string | null): string {
  return actorId === null ? 'System' : 'HR User';
}

/**
 * Format an ISO timestamp to a short display label: "04/10 09:15"
 */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading timeline events" className="space-y-3 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-16 rounded bg-gray-200 shrink-0" />
          <div className="h-3 w-12 rounded bg-gray-200 shrink-0" />
          <div className="h-3 flex-1 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: AcmdTimelineEvent;
}

function EventRow({ event }: EventRowProps) {
  const ts = formatTimestamp(event.createdAt);
  const actor = formatActor(event.actorId);
  const label = formatAction(event.action);

  return (
    <li
      role="listitem"
      className="flex items-start gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0"
      aria-label={`${ts} — ${actor} — ${label}`}
    >
      <span className="shrink-0 text-xs text-gray-400 w-16 font-mono">{ts}</span>
      <span className="shrink-0 text-xs font-medium text-gray-500 w-16 text-right">
        [{actor}]
      </span>
      <span className="text-gray-700">{label}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// TimelinePanel — main component
// ---------------------------------------------------------------------------

export function TimelinePanel({ caseId, apiClient }: TimelinePanelProps) {
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['timeline', caseId],
    queryFn: ({ pageParam }) =>
      fetchCaseTimeline(apiClient, caseId, {
        limit: 20,
        offset: typeof pageParam === 'number' ? pageParam : 0,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.flatMap((p) => p.events).length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 30_000,
  });

  const allEvents = data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
      aria-label="Case activity timeline"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#1E3A5F]">Timeline</h2>
        <div className="flex items-center gap-2">
          {/* Filter placeholder */}
          <select
            aria-label="Filter timeline events"
            disabled
            className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-400 bg-gray-50 cursor-not-allowed"
          >
            <option>All Events</option>
          </select>
          {/* View Full Timeline placeholder */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Full timeline view coming soon (SCR-TIMELINE)"
            className="text-xs text-[#2563EB] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            View Full Timeline →
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <TimelineSkeleton />
      ) : error ? (
        <p role="alert" className="text-sm text-red-500 py-2">
          Failed to load timeline
        </p>
      ) : allEvents.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">
          No timeline events yet
        </p>
      ) : (
        <ul
          role="log"
          aria-label="Case activity timeline"
          aria-live="polite"
          className="space-y-0"
        >
          {allEvents.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}

      {/* Load More */}
      {hasNextPage && !isLoading && (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => { void fetchNextPage(); }}
            disabled={isFetchingNextPage}
            className="text-sm text-[#2563EB] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Load more timeline events"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load More...'}
          </button>
        </div>
      )}
    </section>
  );
}

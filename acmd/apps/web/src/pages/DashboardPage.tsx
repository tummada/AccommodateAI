/**
 * DashboardPage — Phase 6B (ACMD-134)
 *
 * Renders role-based KPI cards, overdue alert banner, recent/urgent cases
 * list, and notifications preview panel.
 *
 * Role behavior:
 *   super_admin — 4 stats cards + overdue banner + deadline dist + notifications + urgent cases
 *   hr          — same but "My" scoped (my open, my overdue, etc.)
 *   manager     — only 2 stats cards (Team Cases, Pending Input) + pending input requests list
 *
 * Data:
 *   - GET /api/v1/cases?limit=100 — for stats computation (client-side)
 *   - GET /api/v1/notifications?limit=3 — recent notifications
 *
 * TanStack Query: staleTime 30s, auto-refetch every 30s.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { StatsCard } from '@/components/ui/StatsCard';
import { DeadlineBadge, computeDeadlineLevel } from '@/components/ui/DeadlineBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchCases, computeStats, sortByUrgency, TERMINAL_STATUSES, PENDING_ACTION_STATUSES } from '@/lib/api/cases';
import { fetchNotifications } from '@/lib/api/notifications';
import type { AcmdCase } from '@/lib/api/cases';
import type { AcmdNotification } from '@/lib/api/notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Short display for case ID — last 8 chars of UUID */
function shortId(id: string): string {
  return `CASE-${id.slice(-8).toUpperCase()}`;
}

/** Status badge pill */
function StatusBadge({ status }: { status: AcmdCase['status'] }) {
  const configs: Record<AcmdCase['status'], { bg: string; text: string; label: string }> = {
    intake:              { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Intake' },
    interactive_process: { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'In Process' },
    awaiting_medical:   { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Awaiting Medical' },
    awaiting_input:     { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Awaiting Input' },
    review:             { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Review' },
    implementation:     { bg: 'bg-teal-100',   text: 'text-teal-700',   label: 'Implementation' },
    active:             { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Active' },
    approved:           { bg: 'bg-green-100',  text: 'text-green-700',  label: '✓ Approved' },
    denied:                 { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Denied' },
    closed:                 { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Closed' },
    denial_pending_review:  { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Denial Pending Review' },
  };
  const cfg = configs[status] ?? { bg: 'bg-slate-100', text: 'text-slate-700', label: status };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function StatsRowSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatsCard key={i} label="" value={null} loading />
      ))}
    </div>
  );
}

function CaseListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue Alert Banner
// ---------------------------------------------------------------------------

interface OverdueBannerProps {
  overdueCases: AcmdCase[];
}

function OverdueBanner({ overdueCases }: OverdueBannerProps) {
  if (overdueCases.length === 0) return null;

  const count = overdueCases.length;
  const first = overdueCases[0];

  return (
    <div
      className="flex flex-col gap-2 rounded-lg px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ backgroundColor: '#991B1B', color: '#FFFFFF' }}
      role="alert"
      aria-live="assertive"
      aria-label={`Alert: You have ${count} overdue case${count > 1 ? 's' : ''} requiring immediate action`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">⛔</span>
        <div>
          <p className="font-semibold">
            You have {count} OVERDUE case{count > 1 ? 's' : ''} requiring immediate action
          </p>
          {count === 1 && first && (
            <p className="mt-0.5 text-sm text-red-200">
              {shortId(first.id)} — {formatDate(first.deadline)}
            </p>
          )}
        </div>
      </div>
      <Link
        to="/cases?filter=overdue"
        className="inline-flex shrink-0 items-center rounded-md border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        View Overdue Cases
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deadline Distribution Summary
// ---------------------------------------------------------------------------

interface DeadlineDistributionProps {
  cases: AcmdCase[];
}

function DeadlineDistribution({ cases }: DeadlineDistributionProps) {
  const activeCases = cases.filter((c) => !TERMINAL_STATUSES.includes(c.status));
  const counts = [0, 0, 0, 0, 0, 0]; // index = level
  for (const c of activeCases) {
    const lvl = computeDeadlineLevel(c.deadline);
    counts[lvl]++;
  }

  const items = [
    { level: 1, color: '#F59E0B', label: 'Level 1 — Approaching (>29 days)' },
    { level: 2, color: '#F97316', label: 'Level 2 — Action needed (8-29 days)' },
    { level: 3, color: '#EF4444', label: 'Level 3 — Urgent (4-7 days)' },
    { level: 4, color: '#DC2626', label: 'Level 4 — Critical (1-3 days)' },
    { level: 5, color: '#991B1B', label: 'Level 5 — Overdue' },
    { level: 0, color: '#94A3B8', label: 'No deadline' },
  ] as const;

  const maxCount = Math.max(...counts, 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-text">Deadline Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="space-y-2"
          role="img"
          aria-label={`Deadline distribution: ${items.map((i) => `${counts[i.level]} at ${i.label}`).join(', ')}`}
        >
          {items.map(({ level, color, label }) => {
            const cnt = counts[level];
            const pct = (cnt / maxCount) * 100;
            return (
              <div key={level} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-xs text-text-muted">{label.split('—')[0].trim()}</span>
                <div className="flex flex-1 items-center gap-2">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs font-medium text-text-muted">{cnt}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifications Panel
// ---------------------------------------------------------------------------

interface NotificationsPanelProps {
  notifications: AcmdNotification[];
  loading: boolean;
  error: boolean;
}

function priorityIcon(priority: AcmdNotification['priority']): string {
  switch (priority) {
    case 'urgent': return '🔴';
    case 'high':   return '🟠';
    case 'normal': return '🔵';
    default:       return '⚪';
  }
}

function NotificationsPanel({ notifications, loading, error }: NotificationsPanelProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold text-text">Recent Alerts</CardTitle>
        <Link to="/notifications" className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          View All →
        </Link>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
        {!loading && error && (
          <p className="text-xs text-text-muted">Notifications unavailable</p>
        )}
        {!loading && !error && notifications.length === 0 && (
          <p className="text-xs text-text-muted">No new notifications</p>
        )}
        {!loading && !error && notifications.length > 0 && (
          <ul className="space-y-2" aria-label="Recent notifications">
            {notifications.map((n) => (
              <li key={n.id} className="flex gap-2 rounded-md border border-border p-2 text-xs">
                <span aria-hidden="true">{priorityIcon(n.priority)}</span>
                <div className="min-w-0">
                  <p className="font-medium text-text truncate">{n.title}</p>
                  {n.body && (
                    <p className="text-text-muted truncate">{n.body}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Case row
// ---------------------------------------------------------------------------

interface CaseRowProps {
  c: AcmdCase;
  showCompany: boolean;
  managerView: boolean;
}

function CaseRow({ c, showCompany: _showCompany, managerView }: CaseRowProps) {
  const navigate = useNavigate();
  const level = computeDeadlineLevel(c.deadline);

  return (
    <div
      className="flex min-h-[48px] cursor-pointer flex-col gap-2 rounded-md border border-border bg-card p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="row"
      tabIndex={0}
      aria-label={`Case ${shortId(c.id)}, status: ${c.status}, deadline: ${formatDate(c.deadline)}`}
      onClick={() => navigate(`/cases/${c.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/cases/${c.id}`);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-text">{shortId(c.id)}</span>
        <StatusBadge status={c.status} />
        {!managerView && <span className="text-xs text-text-muted capitalize">{c.type.toUpperCase()}</span>}
      </div>
      {!managerView ? (
        <DeadlineBadge deadline={c.deadline} level={level} />
      ) : (
        /* Manager — simplified day counter, no legal risk language */
        c.deadline ? (
          <span className="text-xs text-text-muted">
            {formatDate(c.deadline)}
          </span>
        ) : (
          <span className="text-xs text-text-muted">No deadline</span>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manager: Pending Input Requests
// ---------------------------------------------------------------------------

interface PendingInputRequestsProps {
  cases: AcmdCase[];
}

function PendingInputRequests({ cases }: PendingInputRequestsProps) {
  const pendingInput = cases.filter((c) => c.status === 'awaiting_input');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-text">Pending Input Requests</CardTitle>
        <p className="text-xs text-text-muted">These cases require your input about job duties/workspace</p>
      </CardHeader>
      <CardContent>
        {pendingInput.length === 0 ? (
          <p className="text-xs text-text-muted">No pending requests — you&apos;re all caught up</p>
        ) : (
          <ul className="space-y-2">
            {pendingInput.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-text">
                      <span aria-hidden="true">⚡</span> {shortId(c.id)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">Input needed: Job duties / Workspace info</p>
                  </div>
                  <Link
                    to={`/cases/${c.id}`}
                    className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Respond to Request
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main DashboardPage
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const { user, client } = useAuth();
  const role = user?.role ?? 'hr';
  const isManager = role === 'manager';
  const isSuperAdmin = role === 'super_admin';

  // --- Cases query ---
  const {
    data: casesData,
    isLoading: casesLoading,
    isError: casesError,
    refetch: refetchCases,
  } = useQuery({
    queryKey: ['dashboard-cases'],
    queryFn: () => fetchCases(client, { limit: 100 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // --- Notifications query ---
  const {
    data: notifData,
    isLoading: notifLoading,
    isError: notifError,
  } = useQuery({
    queryKey: ['dashboard-notifications'],
    queryFn: () => fetchNotifications(client, { limit: 3 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    // Never crash the dashboard if notifications endpoint is unavailable
    retry: 1,
  });

  const cases = casesData?.cases ?? [];
  const notifications = notifData?.notifications ?? [];

  // --- Compute stats ---
  const stats = computeStats(cases);
  const now = new Date();
  const openCases = cases.filter((c) => !TERMINAL_STATUSES.includes(c.status));
  const overdueCases = openCases.filter(
    (c) => c.deadline !== null && new Date(c.deadline) < now,
  );
  const pendingActionCases = cases.filter((c) => PENDING_ACTION_STATUSES.includes(c.status));

  // Top 5 urgent/recent cases for the mini-list
  const urgentCases = sortByUrgency(openCases).slice(0, 5);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* --- Page header --- */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm text-text-muted">{todayLabel()}</p>
        </div>
        {/* Quick action — super_admin and hr only */}
        {!isManager && (
          <Link
            to="/cases/new"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + New Case
          </Link>
        )}
      </div>

      {/* --- Stats cards --- */}
      {casesLoading ? (
        <StatsRowSkeleton count={isManager ? 2 : 4} />
      ) : isManager ? (
        /* Manager: only 2 cards, no overdue/avg resolution */
        <div className="grid gap-4 sm:grid-cols-2">
          <StatsCard
            label="Team Cases"
            value={openCases.length}
            sublabel="Active cases"
          />
          <StatsCard
            label="Pending Your Input"
            value={pendingActionCases.filter((c) => c.status === 'awaiting_input').length}
            sublabel="Requests waiting"
            alert={pendingActionCases.filter((c) => c.status === 'awaiting_input').length > 0}
          />
        </div>
      ) : (
        /* Super Admin + HR: 4 cards */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label={isSuperAdmin ? 'Open Cases' : 'My Open Cases'}
            value={stats.openCases}
            sublabel="Active accommodation cases"
          />
          <StatsCard
            label={isSuperAdmin ? 'Overdue Cases' : 'My Overdue'}
            value={stats.overdueCases}
            sublabel={stats.overdueCases > 0 ? 'Requires immediate action' : undefined}
            alert={stats.overdueCases > 0}
            ariaLabel={`${isSuperAdmin ? 'Overdue cases' : 'My overdue'}: ${stats.overdueCases}${stats.overdueCases > 0 ? ', requires immediate action' : ''}`}
          />
          <StatsCard
            label="Pending Actions"
            value={stats.pendingActions}
            sublabel="Cases awaiting steps"
          />
          <StatsCard
            label="Avg Resolution"
            value={stats.avgResolutionDays !== null ? `${stats.avgResolutionDays} days` : '—'}
            sublabel="For resolved cases"
          />
        </div>
      )}

      {/* --- Cases error --- */}
      {casesError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>Unable to load case data. Please try again.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void refetchCases()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* --- Overdue alert banner (super_admin + hr only) --- */}
      {!isManager && !casesLoading && overdueCases.length > 0 && (
        <OverdueBanner overdueCases={overdueCases} />
      )}

      {/* --- Middle row: deadline distribution + notifications --- */}
      {!isManager && (
        <div className="grid gap-4 lg:grid-cols-2">
          {casesLoading ? (
            <>
              <div className="h-48 animate-pulse rounded-lg bg-muted" />
              <div className="h-48 animate-pulse rounded-lg bg-muted" />
            </>
          ) : (
            <>
              <DeadlineDistribution cases={cases} />
              <NotificationsPanel
                notifications={notifications}
                loading={notifLoading}
                error={notifError}
              />
            </>
          )}
        </div>
      )}

      {/* --- Manager: notifications panel in single column --- */}
      {isManager && (
        <NotificationsPanel
          notifications={notifications}
          loading={notifLoading}
          error={notifError}
        />
      )}

      {/* --- Manager: pending input requests --- */}
      {isManager && !casesLoading && (
        <PendingInputRequests cases={cases} />
      )}

      {/* --- Recent / Urgent cases list --- */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">
            {isManager ? 'Team Cases' : 'Recent / Urgent Cases'}
          </h2>
          <Link
            to="/cases"
            className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {isManager ? 'View All Team Cases →' : 'View All Cases →'}
          </Link>
        </div>

        {casesLoading ? (
          <CaseListSkeleton />
        ) : urgentCases.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm font-medium text-text">No cases yet</p>
            <p className="text-xs text-text-muted">Create your first accommodation case to get started</p>
            {!isManager && (
              <Link
                to="/cases/new"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover"
              >
                + New Case
              </Link>
            )}
          </div>
        ) : (
          <div
            className="space-y-2"
            role="table"
            aria-label={isManager ? 'Team cases' : 'Recent and urgent cases'}
          >
            {urgentCases.map((c) => (
              <CaseRow
                key={c.id}
                c={c}
                showCompany={isSuperAdmin}
                managerView={isManager}
              />
            ))}
          </div>
        )}
      </div>

      {/* --- Quick actions (super_admin + hr) --- */}
      {!isManager && (
        <div className="flex flex-wrap gap-2">
          <Link
            to="/cases/new"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + New Case
          </Link>
          <Link
            to="/cases?filter=pending_review"
            className="inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            📋 Pending Reviews
          </Link>
          {isSuperAdmin && (
            <Link
              to="/reports"
              className="inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              📊 Compliance Report
            </Link>
          )}
        </div>
      )}

      {/* --- Manager quick action --- */}
      {isManager && !casesLoading && (
        <div>
          {cases.filter((c) => c.status === 'awaiting_input').length > 0 ? (
            <Link
              to="/cases?filter=awaiting_input"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Respond to Request
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

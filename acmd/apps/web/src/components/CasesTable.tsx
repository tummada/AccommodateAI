/**
 * CasesTable — main data table for CasesPage.
 *
 * Columns: Checkbox (super_admin only), Case ID, Employee, Type, Status,
 * Deadline, Assigned HR
 *
 * Features:
 * - Overdue rows: left border dark red
 * - Urgent rows (≤3 days): left border red
 * - Unassigned rows: subtle yellow background
 * - Click row → navigate to /cases/:id
 * - Loading skeleton
 * - Empty states (no cases / no filter results)
 * - Bulk selection (super_admin only) — placeholder handlers
 *
 * ACMD-135
 */

import { useNavigate, Link } from 'react-router-dom';
import { DeadlineBadge } from '@/components/ui/DeadlineBadge';
import { getDeadlineLevel } from '@/lib/api/cases';
import type { AcmdCase, CaseStatus, CaseType } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return `ACMD-${id.slice(-8).toUpperCase()}`;
}

function shortEmployeeId(employeeId: string): string {
  return `EMP-${employeeId.slice(0, 8).toUpperCase()}`;
}

function formatAssignedTo(assignedTo: string | null): string {
  if (!assignedTo) return '—';
  // Display as short form if it looks like a UUID
  if (assignedTo.length > 20 && assignedTo.includes('-')) {
    return `HR-${assignedTo.slice(0, 8).toUpperCase()}`;
  }
  return assignedTo;
}

// ---------------------------------------------------------------------------
// Type badge
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: CaseType }) {
  const configs: Record<CaseType, { bg: string; text: string; label: string }> = {
    ada:       { bg: 'bg-blue-50',   text: 'text-blue-700',  label: 'ADA' },
    pwfa:      { bg: 'bg-purple-50', text: 'text-purple-700', label: 'PWFA' },
    state_law: { bg: 'bg-gray-100',  text: 'text-gray-700',  label: 'State Law' },
    multiple:  { bg: 'bg-amber-50',  text: 'text-amber-700', label: 'ADA + PWFA' },
  };
  const cfg = configs[type] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: type };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIGS: Record<CaseStatus, { dotColor: string; label: string }> = {
  intake:              { dotColor: '#3B82F6', label: 'Intake' },
  interactive_process: { dotColor: '#2563EB', label: 'Interactive Process' },
  awaiting_medical:    { dotColor: '#F59E0B', label: 'Awaiting Medical' },
  awaiting_input:      { dotColor: '#F59E0B', label: 'Awaiting Input' },
  review:              { dotColor: '#7C3AED', label: 'Under Review' },
  implementation:      { dotColor: '#14B8A6', label: 'In Implementation' },
  active:              { dotColor: '#16A34A', label: 'Active / Monitoring' },
  approved:            { dotColor: '#22C55E', label: 'Approved' },
  denied:                 { dotColor: '#EF4444', label: 'Denied' },
  closed:                 { dotColor: '#6B7280', label: 'Closed' },
  denial_pending_review:  { dotColor: '#F97316', label: 'Denial Pending Review' },
};

function StatusBadge({ status }: { status: CaseStatus }) {
  const cfg = STATUS_CONFIGS[status] ?? { dotColor: '#6B7280', label: status };
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-text"
      aria-label={`Status: ${cfg.label}`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: cfg.dotColor }}
        aria-hidden="true"
      />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row-level urgency styling
// ---------------------------------------------------------------------------

function rowStyle(deadlineLevel: number, isUnassigned: boolean): React.CSSProperties {
  if (deadlineLevel === 5) {
    return { borderLeft: '3px solid #991B1B' };
  }
  if (deadlineLevel === 4) {
    return { borderLeft: '4px solid #7F1D1D' };
  }
  if (deadlineLevel === 3) {
    return { borderLeft: '3px solid #EF4444' };
  }
  if (isUnassigned) {
    return { backgroundColor: '#FFFBEB' };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border">
          <td className="p-3" colSpan={8}>
            <div className="h-10 animate-pulse rounded bg-muted" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  hasFilters: boolean;
  onClearFilters: () => void;
  colSpan: number;
}

function EmptyState({ hasFilters, onClearFilters, colSpan }: EmptyStateProps) {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan}>
          <div
            className="flex flex-col items-center gap-3 py-16 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="text-4xl" aria-hidden="true">📋</span>
            {hasFilters ? (
              <>
                <p className="text-sm font-medium text-text">No cases match your filters</p>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="text-sm text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Clear Filters
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-text">No cases yet</p>
                <p className="text-xs text-text-muted">
                  Create your first case to start the accommodation process.
                </p>
                <Link
                  to="/cases/new"
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  + New Case
                </Link>
              </>
            )}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

// ---------------------------------------------------------------------------
// CasesTable props
// ---------------------------------------------------------------------------

export interface CasesTableProps {
  cases: AcmdCase[];
  isLoading: boolean;
  isSuperAdmin: boolean;
  hasFilters: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (allIds: string[]) => void;
  onClearFilters: () => void;
}

// ---------------------------------------------------------------------------
// CasesTable
// ---------------------------------------------------------------------------

export function CasesTable({
  cases,
  isLoading,
  isSuperAdmin,
  hasFilters,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onClearFilters,
}: CasesTableProps) {
  const navigate = useNavigate();

  // Column count: checkbox (super_admin) + Case ID + Employee + Type + Status + Deadline + Assigned HR
  const colSpan = isSuperAdmin ? 7 : 6;

  const allVisibleIds = cases.map((c) => c.id);
  const allSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));

  function handleRowClick(id: string) {
    navigate(`/cases/${id}`);
  }

  function handleRowKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/cases/${id}`);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table
        className="w-full min-w-[640px] border-collapse text-sm"
        aria-label="Accommodation cases list"
      >
        {/* ---- Table header ---- */}
        <thead className="bg-surface">
          <tr className="border-b border-border">
            {isSuperAdmin && (
              <th scope="col" className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleSelectAll(allVisibleIds)}
                  aria-label={allSelected ? 'Deselect all cases' : 'Select all cases'}
                  className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                />
              </th>
            )}
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Case ID
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Employee
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Type
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Status
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Deadline
            </th>
            <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              Assigned HR
            </th>
          </tr>
        </thead>

        {/* ---- Loading skeleton ---- */}
        {isLoading && <TableSkeleton />}

        {/* ---- Empty state ---- */}
        {!isLoading && cases.length === 0 && (
          <EmptyState
            hasFilters={hasFilters}
            onClearFilters={onClearFilters}
            colSpan={colSpan}
          />
        )}

        {/* ---- Data rows ---- */}
        {!isLoading && cases.length > 0 && (
          <tbody>
            {cases.map((c) => {
              const level = getDeadlineLevel(c.deadline);
              const isUnassigned = c.assignedTo === null;
              const isSelected = selectedIds.has(c.id);

              return (
                <tr
                  key={c.id}
                  className="border-b border-border transition-colors hover:bg-surface/80 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring"
                  style={rowStyle(level, isUnassigned)}
                  tabIndex={0}
                  role="row"
                  aria-selected={isSuperAdmin ? isSelected : undefined}
                  aria-label={`Case ${shortId(c.id)}, ${c.status}, click to open`}
                  onClick={() => handleRowClick(c.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, c.id)}
                >
                  {/* Checkbox — super_admin only */}
                  {isSuperAdmin && (
                    <td
                      className="w-10 px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select case ${shortId(c.id)}`}
                        className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                      />
                    </td>
                  )}

                  {/* Case ID */}
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs font-semibold text-text">
                      {shortId(c.id)}
                    </span>
                  </td>

                  {/* Employee */}
                  <td className="px-3 py-3">
                    <span className="text-xs text-text">
                      {shortEmployeeId(c.employeeId)}
                    </span>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-3">
                    <TypeBadge type={c.type} />
                  </td>

                  {/* Status */}
                  <td className="px-3 py-3">
                    <StatusBadge status={c.status} />
                  </td>

                  {/* Deadline */}
                  <td className="px-3 py-3">
                    <DeadlineBadge deadline={c.deadline} level={level} />
                  </td>

                  {/* Assigned HR */}
                  <td className="px-3 py-3">
                    {isUnassigned ? (
                      <span className="text-xs font-medium text-red-600">Unassigned</span>
                    ) : (
                      <span className="text-xs text-text">{formatAssignedTo(c.assignedTo)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
      </table>
    </div>
  );
}

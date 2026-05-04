/**
 * CasesPage — Phase 6B Part 2 (ACMD-135)
 *
 * Full case list with search, filters, pagination, and deadline summary.
 *
 * Role behavior:
 *   super_admin — all org cases, checkbox + bulk action bar (UI placeholder)
 *   hr          — own + unassigned cases (server-side filtered by backend)
 *   manager     — redirect to /dashboard (no access)
 *
 * Data:
 *   GET /api/v1/cases?status=...&limit=25&offset=...
 *   Response: { cases: AcmdCase[], total: number, limit: number, offset: number }
 *
 * Search: client-side filter on loaded page (debounced 300ms)
 * Status filter: sent as query param to API
 * Pagination: 25 per page
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchCases, sortByUrgency } from '@/lib/api/cases';
import type { CaseStatus, CaseType } from '@/lib/api/cases';
import { CasesTable } from '@/components/CasesTable';
import { FilterBar, EMPTY_FILTERS } from '@/components/FilterBar';
import type { FilterState } from '@/components/FilterBar';
import { DeadlineSummaryBar } from '@/components/ui/DeadlineSummaryBar';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Pagination controls
// ---------------------------------------------------------------------------

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function Pagination({ total, page, pageSize, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  if (total === 0) return null;

  return (
    <nav
      className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
      aria-label="Case list pagination"
    >
      <p className="text-xs text-text-muted">
        Showing <span className="font-medium text-text">{start}–{end}</span> of{' '}
        <span className="font-medium text-text">{total}</span> cases
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          ← Prev
        </Button>

        {/* Page numbers — show up to 5 around current page */}
        {Array.from({ length: totalPages }).map((_, i) => {
          // Show first, last, current ±1
          const show =
            i === 0 ||
            i === totalPages - 1 ||
            Math.abs(i - page) <= 1;

          if (!show) {
            // Show ellipsis only once between gaps
            if (i === 1 && page > 3) {
              return <span key={`ell-start`} className="px-1 text-xs text-text-muted">…</span>;
            }
            if (i === totalPages - 2 && page < totalPages - 4) {
              return <span key={`ell-end`} className="px-1 text-xs text-text-muted">…</span>;
            }
            return null;
          }

          return (
            <Button
              key={i}
              variant={i === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(i)}
              aria-label={`Page ${i + 1}`}
              aria-current={i === page ? 'page' : undefined}
              className="min-w-[2rem]"
            >
              {i + 1}
            </Button>
          );
        })}

        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next →
        </Button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Bulk Action Bar (super_admin only — handlers are placeholder)
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  selectedCount: number;
  onDeselectAll: () => void;
}

function BulkActionBar({ selectedCount, onDeselectAll }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
      role="region"
      aria-live="polite"
      aria-label={`${selectedCount} cases selected`}
    >
      <span className="text-sm font-medium text-text">
        {selectedCount} selected
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Placeholder — reassign flow in Phase 6C
          alert('Reassign: coming in Phase 6C');
        }}
      >
        Reassign ▼
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Placeholder — CSV export in Phase 6C
          alert('Export CSV: coming in Phase 6C');
        }}
      >
        Export CSV
      </Button>
      <Button variant="ghost" size="sm" onClick={onDeselectAll}>
        Deselect All
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CasesPage
// ---------------------------------------------------------------------------

export function CasesPage() {
  const { user, client } = useAuth();

  // --- Manager redirect (AC 1) ---
  // IMPORTANT: this must come BEFORE any hook that reads filters/state,
  // but hooks cannot be conditional. We render a redirect element after
  // all hooks are declared.
  const isManager = user?.role === 'manager';
  const isSuperAdmin = user?.role === 'super_admin';

  // --- Filter state ---
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);

  // Debounced search value (300ms)
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.searchInput]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filters.status, filters.type]);

  // --- Bulk selection state (super_admin only) ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = allIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      } else {
        const next = new Set(prev);
        allIds.forEach((id) => next.add(id));
        return next;
      }
    });
  }, []);

  // --- TanStack Query ---
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['cases', filters.status, filters.type, page],
    queryFn: () =>
      fetchCases(client, {
        status: filters.status || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 30_000,
    enabled: !isManager,
  });

  // --- Client-side search filter ---
  const filteredCases = useMemo(() => {
    const raw = data?.cases ?? [];
    const sorted = sortByUrgency(raw);

    return sorted.filter((c) => {
      if (filters.type && c.type !== filters.type) return false;

      if (!debouncedSearch) return true;

      const q = debouncedSearch.toLowerCase();
      const empId = c.employeeId.toLowerCase();
      const caseId = c.id.toLowerCase();
      const shortCase = `acmd-${c.id.slice(-8)}`.toLowerCase();
      return empId.includes(q) || caseId.includes(q) || shortCase.includes(q);
    });
  }, [data?.cases, debouncedSearch, filters.type]);

  // --- Handlers ---
  const handleSearchChange = useCallback((value: string) => {
    setFilters((prev) => ({ ...prev, searchInput: value }));
  }, []);

  const handleStatusChange = useCallback((value: CaseStatus | '') => {
    setFilters((prev) => ({ ...prev, status: value }));
  }, []);

  const handleTypeChange = useCallback((value: CaseType | '') => {
    setFilters((prev) => ({ ...prev, type: value }));
  }, []);

  const handleClearAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(0);
  }, []);

  const hasActiveFilters =
    filters.searchInput !== '' || filters.status !== '' || filters.type !== '';

  // --- Manager redirect ---
  if (isManager) {
    return <Navigate to="/dashboard" replace />;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Cases</h1>
          <p className="text-sm text-text-muted">
            {isSuperAdmin
              ? 'All accommodation cases across the organization'
              : 'Cases assigned to you and unassigned cases'}
          </p>
        </div>
        <Link
          to="/cases/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + New Case
        </Link>
      </div>

      {/* Deadline summary bar */}
      {!isLoading && data && data.cases.length > 0 && (
        <DeadlineSummaryBar
          cases={data.cases}
          onFilterByLevel={(level) => {
            // Quick filter: map deadline level to status is not 1-to-1,
            // so we just jump to overdue visual. Full deadline filter is v2.
            // For now: clicking overdue sets status filter to show active cases.
            if (level === 5) {
              // No direct status for overdue — it's computed from deadline date.
              // Show all statuses (clear status filter) so user sees the overdue rows.
              handleStatusChange('');
            }
          }}
        />
      )}

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onSearchChange={handleSearchChange}
        onStatusChange={handleStatusChange}
        onTypeChange={handleTypeChange}
        onClearAll={handleClearAll}
      />

      {/* Bulk action bar (super_admin only) */}
      {isSuperAdmin && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onDeselectAll={() => setSelectedIds(new Set())}
        />
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>Unable to load cases. Please try again.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Cases table */}
      <CasesTable
        cases={filteredCases}
        isLoading={isLoading}
        isSuperAdmin={isSuperAdmin}
        hasFilters={hasActiveFilters}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onToggleSelectAll={handleToggleSelectAll}
        onClearFilters={handleClearAll}
      />

      {/* Pagination — use server total for page count, but only show when not client-searching */}
      {!isLoading && !isError && data && !debouncedSearch && (
        <Pagination
          total={data.total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {/* When searching client-side, show match count instead */}
      {!isLoading && !isError && debouncedSearch && (
        <p className="text-xs text-text-muted" role="status" aria-live="polite">
          {filteredCases.length === 0
            ? 'No cases match your search.'
            : `Showing ${filteredCases.length} matching case${filteredCases.length !== 1 ? 's' : ''} (search active — showing all loaded results)`}
        </p>
      )}
    </div>
  );
}

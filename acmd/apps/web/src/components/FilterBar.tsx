/**
 * FilterBar — search input + status/type filter dropdowns for CasesPage.
 *
 * Features:
 * - Search input (debounced externally, passed via props)
 * - Status filter dropdown (maps to API query param)
 * - Type filter dropdown
 * - Active filter chips with ✕ to remove
 * - Clear All link
 *
 * ACMD-135
 */

import type { CaseStatus, CaseType } from '@/lib/api/cases';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterState {
  searchInput: string;
  status: CaseStatus | '';
  type: CaseType | '';
}

export const EMPTY_FILTERS: FilterState = {
  searchInput: '',
  status: '',
  type: '',
};

interface FilterBarProps {
  filters: FilterState;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: CaseStatus | '') => void;
  onTypeChange: (value: CaseType | '') => void;
  onClearAll: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: { value: CaseStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'intake', label: 'Intake' },
  { value: 'interactive_process', label: 'Interactive Process' },
  { value: 'awaiting_medical', label: 'Awaiting Medical Docs' },
  { value: 'awaiting_input', label: 'Awaiting Input' },
  { value: 'review', label: 'Under Review' },
  { value: 'implementation', label: 'In Implementation' },
  { value: 'active', label: 'Active / Monitoring' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'closed', label: 'Closed' },
];

const TYPE_OPTIONS: { value: CaseType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'ada', label: 'ADA' },
  { value: 'pwfa', label: 'PWFA' },
  { value: 'state_law', label: 'State Law' },
  { value: 'multiple', label: 'Multiple / Dual-law' },
];

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export function FilterBar({
  filters,
  onSearchChange,
  onStatusChange,
  onTypeChange,
  onClearAll,
}: FilterBarProps) {
  const hasActiveFilters =
    filters.searchInput !== '' || filters.status !== '' || filters.type !== '';

  // Active chip list
  const chips: { id: string; label: string; onRemove: () => void }[] = [];

  if (filters.status !== '') {
    const opt = STATUS_OPTIONS.find((o) => o.value === filters.status);
    chips.push({
      id: 'status',
      label: `Status: ${opt?.label ?? filters.status}`,
      onRemove: () => onStatusChange(''),
    });
  }

  if (filters.type !== '') {
    const opt = TYPE_OPTIONS.find((o) => o.value === filters.type);
    chips.push({
      id: 'type',
      label: `Type: ${opt?.label ?? filters.type}`,
      onRemove: () => onTypeChange(''),
    });
  }

  if (filters.searchInput !== '') {
    chips.push({
      id: 'search',
      label: `Search: "${filters.searchInput}"`,
      onRemove: () => onSearchChange(''),
    });
  }

  return (
    <div className="space-y-3">
      {/* Search + dropdowns row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden="true"
          >
            🔍
          </span>
          <Input
            type="search"
            placeholder="Search by name or Case ID..."
            value={filters.searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            aria-label="Search cases by employee name or Case ID"
          />
        </div>

        {/* Status filter */}
        <div>
          <label className="sr-only" htmlFor="status-filter">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={filters.status}
            onChange={(e) => onStatusChange(e.target.value as CaseStatus | '')}
            className="h-10 rounded-md border border-input bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Type filter */}
        <div>
          <label className="sr-only" htmlFor="type-filter">
            Filter by accommodation type
          </label>
          <select
            id="type-filter"
            value={filters.type}
            onChange={(e) => onTypeChange(e.target.value as CaseType | '')}
            className="h-10 rounded-md border border-input bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
            aria-label="Filter by accommodation type"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Active filters"
        >
          <span className="text-xs text-text-muted">Active filters:</span>
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="ml-1 rounded-full p-0.5 hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Remove filter: ${chip.label}`}
              >
                ✕
              </button>
            </span>
          ))}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs text-text-muted underline hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  );
}
